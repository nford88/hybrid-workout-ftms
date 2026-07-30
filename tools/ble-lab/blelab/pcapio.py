"""Readers for host-side HCI log formats, and a writer for the one format
tshark can dissect from a stream.

Design note (why this module exists at all)
-------------------------------------------
We do NOT hand-roll HCI/L2CAP/ATT dissection — tshark does that far more
reliably than we ever would. But tshark cannot *stream* btsnoop or
PacketLogger files (both need seeking / a settled file). So every backend
here is normalised to a common in-memory record::

    HciRecord(ts_unix: float, sent: bool, h4: bytes)

and then re-emitted as a pcap stream with link type 201
(``LINKTYPE_BLUETOOTH_HCI_H4_WITH_PHDR``), which tshark reads happily from
stdin. One pipeline serves live view and offline analysis alike.

Verified 2026-07-29 against tshark 4.4.9: a synthesized DLT-201 pcap
containing an ATT Write Request dissects with correct ``btatt.opcode`` /
``btatt.handle`` / ``btatt.value`` and correct Sent/Rcvd direction.
"""

from __future__ import annotations

import struct
from dataclasses import dataclass
from typing import BinaryIO, Iterator

# ── H4 packet types (Bluetooth Core, UART transport) ───────────────────────
H4_COMMAND = 0x01
H4_ACL = 0x02
H4_SCO = 0x03
H4_EVENT = 0x04

PCAP_MAGIC = 0xA1B2C3D4
DLT_BLUETOOTH_HCI_H4_WITH_PHDR = 201

# btsnoop epoch: microseconds from 0000-01-01 to 1970-01-01 (Wireshark btsnoop.c).
BTSNOOP_UNIX_EPOCH_US = 0x00DCDDB30F2F8000

BTSNOOP_DLT_H1 = 1001  # unencapsulated HCI, no H4 type byte
BTSNOOP_DLT_H4 = 1002  # HCI UART, payload starts with the H4 type byte
BTSNOOP_DLT_BCSP = 1003
BTSNOOP_DLT_H5 = 1004

# ── PacketLogger record types (Wireshark packetlogger.c) ───────────────────
PL_HCI_COMMAND = 0x00
PL_HCI_EVENT = 0x01
PL_SENT_ACL = 0x02
PL_RECV_ACL = 0x03
PL_SENT_SCO = 0x08
PL_RECV_SCO = 0x09
PL_NOTE = 0xFC

# PacketLogger types we surface as human-readable annotations rather than packets.
PL_TEXT_TYPES = {0xF7, 0xF8, 0xF9, 0xFA, 0xFB, 0xFC, 0xFD, 0xFE}


@dataclass(frozen=True)
class HciRecord:
    """One HCI transport record, normalised across backends.

    ``sent`` is True for host->controller (what our client asked for) and
    False for controller->host (what the peer actually did). Getting this
    right is the whole point: a connection recipe is a sequence of things
    *we* send, so direction is the primary axis of the analysis.
    """

    ts_unix: float
    sent: bool
    h4: bytes

    @property
    def h4_type(self) -> int:
        return self.h4[0] if self.h4 else 0


@dataclass(frozen=True)
class Annotation:
    """A non-packet log line embedded in the capture (PacketLogger notes)."""

    ts_unix: float
    kind: str
    text: str


# ──────────────────────────────────────────────────────────────────────────
# pcap writer
# ──────────────────────────────────────────────────────────────────────────


def pcap_global_header() -> bytes:
    return struct.pack(
        "<IHHiIII",
        PCAP_MAGIC,
        2,  # version major
        4,  # version minor
        0,  # thiszone
        0,  # sigfigs
        262144,  # snaplen
        DLT_BLUETOOTH_HCI_H4_WITH_PHDR,
    )


def pcap_record(rec: HciRecord) -> bytes:
    """Wrap one HciRecord as a pcap record with the DLT-201 pseudo-header.

    The pseudo-header is a 4-byte big-endian direction word: 0 = sent
    (host->controller), 1 = received.
    """
    payload = struct.pack(">I", 0 if rec.sent else 1) + rec.h4
    secs = int(rec.ts_unix)
    usecs = int(round((rec.ts_unix - secs) * 1_000_000))
    if usecs >= 1_000_000:  # rounding can carry
        secs += 1
        usecs -= 1_000_000
    return struct.pack("<IIII", secs, usecs, len(payload), len(payload)) + payload


# ──────────────────────────────────────────────────────────────────────────
# btsnoop reader (Android HCI snoop log, and the /dev/socket/btsnoop stream)
# ──────────────────────────────────────────────────────────────────────────


class BtsnoopParser:
    """Incremental btsnoop parser.

    Incremental rather than file-at-once because the Android backend reads a
    live socket where records arrive mid-boundary. ``feed()`` returns only
    the records that are fully available.
    """

    HEADER = b"btsnoop\x00"
    REC_HDR_LEN = 24

    def __init__(self) -> None:
        self._buf = bytearray()
        self._header_done = False
        self.datalink: int | None = None
        self.version: int | None = None

    def feed(self, data: bytes) -> list[HciRecord]:
        self._buf += data
        out: list[HciRecord] = []

        if not self._header_done:
            if len(self._buf) < 16:
                return out
            if bytes(self._buf[:8]) != self.HEADER:
                raise ValueError(
                    f"not a btsnoop stream (magic {bytes(self._buf[:8])!r})"
                )
            self.version, self.datalink = struct.unpack(">II", self._buf[8:16])
            if self.version != 1:
                raise ValueError(f"btsnoop version {self.version} unsupported")
            del self._buf[:16]
            self._header_done = True

        while True:
            if len(self._buf) < self.REC_HDR_LEN:
                break
            orig_len, incl_len, flags, _drops, ts = struct.unpack(
                ">IIIIq", self._buf[: self.REC_HDR_LEN]
            )
            total = self.REC_HDR_LEN + incl_len
            if len(self._buf) < total:
                break
            payload = bytes(self._buf[self.REC_HDR_LEN : total])
            del self._buf[:total]

            received = bool(flags & 0x01)
            is_cmd_or_evt = bool(flags & 0x02)
            h4 = self._to_h4(payload, received, is_cmd_or_evt)
            if h4 is None:
                continue
            ts_unix = (ts - BTSNOOP_UNIX_EPOCH_US) / 1_000_000.0
            out.append(HciRecord(ts_unix=ts_unix, sent=not received, h4=h4))
        return out

    def _to_h4(self, payload: bytes, received: bool, is_cmd_or_evt: bool) -> bytes | None:
        if not payload:
            return None
        if self.datalink == BTSNOOP_DLT_H4:
            # Payload already carries the H4 type byte.
            return payload
        if self.datalink == BTSNOOP_DLT_H1:
            # No type byte; reconstruct it from the flags.
            if is_cmd_or_evt:
                t = H4_EVENT if received else H4_COMMAND
            else:
                t = H4_ACL
            return bytes([t]) + payload
        raise ValueError(
            f"btsnoop datalink type {self.datalink} unsupported "
            "(need 1001 H1 or 1002 H4)"
        )


def read_btsnoop(fh: BinaryIO, chunk: int = 65536) -> Iterator[HciRecord]:
    parser = BtsnoopParser()
    while True:
        data = fh.read(chunk)
        if not data:
            break
        yield from parser.feed(data)


# ──────────────────────────────────────────────────────────────────────────
# PacketLogger reader (macOS .pklg)
# ──────────────────────────────────────────────────────────────────────────


class PacketLoggerParser:
    """Incremental macOS PacketLogger (.pklg) parser.

    Record layout (Wireshark packetlogger.c): 4-byte big-endian length,
    then ``length`` bytes of [ts_secs u32][ts_usecs u32][type u8][payload].
    So payload length is ``length - 9``.

    Non-packet record types (notes, config, power) are surfaced through
    ``annotations`` rather than dropped — PacketLogger's own note lines are
    genuinely useful for spotting where the OS stack made a decision.
    """

    REC_LEN_FIELD = 4
    REC_META_LEN = 9  # ts_secs + ts_usecs + type

    def __init__(self) -> None:
        self._buf = bytearray()
        self.annotations: list[Annotation] = []

    def feed(self, data: bytes) -> list[HciRecord]:
        self._buf += data
        out: list[HciRecord] = []
        while True:
            if len(self._buf) < self.REC_LEN_FIELD:
                break
            (length,) = struct.unpack(">I", self._buf[: self.REC_LEN_FIELD])
            if length < self.REC_META_LEN or length > (1 << 24):
                raise ValueError(
                    f"implausible PacketLogger record length {length}; "
                    "file may be truncated, byte-swapped, or not a .pklg"
                )
            total = self.REC_LEN_FIELD + length
            if len(self._buf) < total:
                break
            body = bytes(self._buf[self.REC_LEN_FIELD : total])
            del self._buf[:total]

            ts_secs, ts_usecs = struct.unpack(">II", body[:8])
            rec_type = body[8]
            payload = body[9:]
            ts_unix = ts_secs + ts_usecs / 1_000_000.0

            if rec_type in PL_TEXT_TYPES:
                try:
                    text = payload.decode("utf-8", errors="replace").rstrip("\x00\n")
                except Exception:  # pragma: no cover - defensive
                    text = repr(payload)
                self.annotations.append(
                    Annotation(ts_unix=ts_unix, kind=f"pklg-0x{rec_type:02x}", text=text)
                )
                continue

            mapping = {
                PL_HCI_COMMAND: (True, H4_COMMAND),
                PL_HCI_EVENT: (False, H4_EVENT),
                PL_SENT_ACL: (True, H4_ACL),
                PL_RECV_ACL: (False, H4_ACL),
                PL_SENT_SCO: (True, H4_SCO),
                PL_RECV_SCO: (False, H4_SCO),
            }
            if rec_type not in mapping:
                continue
            sent, h4_type = mapping[rec_type]
            out.append(
                HciRecord(ts_unix=ts_unix, sent=sent, h4=bytes([h4_type]) + payload)
            )
        return out


def read_packetlogger(fh: BinaryIO, chunk: int = 65536) -> Iterator[HciRecord]:
    parser = PacketLoggerParser()
    while True:
        data = fh.read(chunk)
        if not data:
            break
        yield from parser.feed(data)


# ──────────────────────────────────────────────────────────────────────────
# format sniffing
# ──────────────────────────────────────────────────────────────────────────


def sniff_format(path: str) -> str:
    """Return 'btsnoop', 'pklg', or 'pcap' by looking at the magic bytes."""
    with open(path, "rb") as fh:
        head = fh.read(8)
    if head.startswith(b"btsnoop\x00"):
        return "btsnoop"
    if len(head) >= 4:
        (magic,) = struct.unpack("<I", head[:4])
        if magic in (0xA1B2C3D4, 0xD4C3B2A1, 0xA1B23C4D, 0x4D3CB2A1):
            return "pcap"
        if head[:4] == b"\x0a\x0d\x0d\x0a":
            return "pcapng"
    # PacketLogger has no magic; a plausible first length field is the tell.
    if len(head) >= 4:
        (length,) = struct.unpack(">I", head[:4])
        if 9 <= length <= (1 << 20):
            return "pklg"
    raise ValueError(f"cannot identify capture format of {path}")
