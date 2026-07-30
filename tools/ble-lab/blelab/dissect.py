"""tshark integration: feed it a pcap stream, get dissected ATT/SMP/HCI back.

We shell out to tshark rather than dissecting HCI ourselves. That is a
deliberate trade: tshark's Bluetooth dissectors are mature and, importantly,
track ATT handle -> UUID bindings across a capture, which is exactly the
correlation a hand-rolled parser would get wrong.

Homebrew's wireshark 4.4.9 ships extcap binaries with a broken @rpath, which
makes ``tshark -D`` spew dyld errors. Setting DYLD_LIBRARY_PATH to the
Homebrew lib dir fixes it, so we always set it — harmless elsewhere.
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
from dataclasses import dataclass, field
from typing import Iterable, Iterator

from . import attpdu
from .pcapio import HciRecord, pcap_global_header, pcap_record

log = logging.getLogger("blelab.dissect")

HOMEBREW_LIB = "/opt/homebrew/lib"

# Fields pulled for the live one-line view. Order matters — it is the tuple
# order that _parse_fields_line unpacks.
LIVE_FIELDS = (
    "frame.number",
    "frame.time_epoch",
    "bthci_acl.chandle",
    "btatt.opcode",
    "btatt.handle",
    "btatt.uuid128",
    "btatt.uuid16",
    "btatt.value",
    "btatt.client_rx_mtu",
    "btatt.server_rx_mtu",
    "btsmp.opcode",
    "bthci_evt.code",
    "bthci_cmd.opcode",
    "bthci_evt.reason",
    # Over-the-air sniffer captures (nRF Sniffer, LINKTYPE_NORDIC_BLE) carry no
    # HCI layer at all, so there is no "Sent"/"Rcvd" in the info column. The
    # link-layer direction bit is the only signal available.
    "nordic_ble.direction",
    "_ws.col.info",
)


class TsharkError(RuntimeError):
    pass


def tshark_path() -> str:
    exe = shutil.which("tshark")
    if not exe:
        raise TsharkError("tshark not found on PATH (brew install wireshark)")
    return exe


def _env() -> dict[str, str]:
    env = dict(os.environ)
    existing = env.get("DYLD_LIBRARY_PATH", "")
    if HOMEBREW_LIB not in existing.split(":"):
        env["DYLD_LIBRARY_PATH"] = f"{HOMEBREW_LIB}:{existing}".rstrip(":")
    return env


@dataclass
class AttOp:
    """One dissected ATT / SMP / HCI operation, backend-agnostic."""

    number: int
    ts: float
    sent: bool
    layer: str  # 'att' | 'smp' | 'hci' | 'other'
    opcode: int | None = None
    opcode_name: str = ""
    handle: int | None = None
    uuid: str | None = None
    value: bytes = b""
    mtu: int | None = None
    info: str = ""
    raw_fields: dict[str, str] = field(default_factory=dict)
    pdu: bytes = b""  # raw ATT PDU, when the source could supply it
    gloss: str = ""  # decoded from `pdu`; carries what btatt.* fields drop

    @property
    def direction(self) -> str:
        return "TX" if self.sent else "RX"


# ── ATT opcode table (Bluetooth Core v5.x, Vol 3 Part F §3.4.8) ────────────
ATT_OPCODES = {
    0x01: "Error Response",
    0x02: "Exchange MTU Request",
    0x03: "Exchange MTU Response",
    0x04: "Find Information Request",
    0x05: "Find Information Response",
    0x06: "Find By Type Value Request",
    0x07: "Find By Type Value Response",
    0x08: "Read By Type Request",
    0x09: "Read By Type Response",
    0x0A: "Read Request",
    0x0B: "Read Response",
    0x0C: "Read Blob Request",
    0x0D: "Read Blob Response",
    0x0E: "Read Multiple Request",
    0x0F: "Read Multiple Response",
    0x10: "Read By Group Type Request",
    0x11: "Read By Group Type Response",
    0x12: "Write Request",
    0x13: "Write Response",
    0x16: "Prepare Write Request",
    0x17: "Prepare Write Response",
    0x18: "Execute Write Request",
    0x19: "Execute Write Response",
    0x1B: "Handle Value Notification",
    0x1D: "Handle Value Indication",
    0x1E: "Handle Value Confirmation",
    0x52: "Write Command",
    0xD2: "Signed Write Command",
}

SMP_OPCODES = {
    0x01: "Pairing Request",
    0x02: "Pairing Response",
    0x03: "Pairing Confirm",
    0x04: "Pairing Random",
    0x05: "Pairing Failed",
    0x06: "Encryption Information",
    0x07: "Master Identification",
    0x08: "Identity Information",
    0x09: "Identity Address Information",
    0x0A: "Signing Information",
    0x0B: "Security Request",
    0x0C: "Pairing Public Key",
    0x0D: "Pairing DHKey Check",
    0x0E: "Pairing Keypress Notification",
}

# HCI events that mark a connection-lifecycle transition.
HCI_EVENTS = {
    0x05: "Disconnection Complete",
    0x08: "Encryption Change",
    0x0E: "Command Complete",
    0x0F: "Command Status",
    0x30: "Encryption Key Refresh Complete",
    0x3E: "LE Meta Event",
    0x57: "Authenticated Payload Timeout Expired",
}


def _hex_to_bytes(value: str) -> bytes:
    v = value.strip().replace(":", "")
    if not v:
        return b""
    try:
        return bytes.fromhex(v)
    except ValueError:
        return b""


def _int_or_none(value: str) -> int | None:
    v = value.strip()
    if not v:
        return None
    try:
        return int(v, 16) if v.lower().startswith("0x") else int(v)
    except ValueError:
        return None


def _first(value: str) -> str:
    """tshark joins repeated field occurrences with commas; take the first."""
    return value.split(",")[0] if value else ""


def _direction_from_info(info: str) -> bool:
    """Recover host->controller direction from tshark's info column.

    Used when tshark reads a capture file directly, where we have no record of
    our own ordering to consult. `bluetooth.src_str`/`dst_str` would be nicer
    but come back empty for both PacketLogger and btsnoop captures (verified
    against tshark 4.4.9), whereas the info column reliably carries
    "Sent"/"Rcvd" for both. The BlueZ monitor format uses "Tx"/"Rx" instead.
    """
    if info.startswith("Sent") or " Sent " in info:
        return True
    if info.startswith("Rcvd") or " Rcvd " in info:
        return False
    if info.startswith("Tx") or " Tx " in info:
        return True
    if info.startswith("Rx") or " Rx " in info:
        return False
    # Unknown. Reported as inbound rather than guessed outbound: mistaking a
    # device notification for something *we sent* would invent a client step
    # that never happened, which is the worse error for a connection recipe.
    return False


def _parse_fields_line(line: str, sent_hint: dict[int, bool]) -> AttOp | None:
    parts = line.rstrip("\n").split("\t")
    if len(parts) < len(LIVE_FIELDS):
        parts += [""] * (len(LIVE_FIELDS) - len(parts))
    (
        num_s,
        ts_s,
        chandle_s,
        att_op_s,
        att_handle_s,
        uuid128_s,
        uuid16_s,
        value_s,
        crx_s,
        srx_s,
        smp_op_s,
        evt_code_s,
        cmd_op_s,
        reason_s,
        nordic_dir_s,
        info,
    ) = parts[: len(LIVE_FIELDS)]

    number = _int_or_none(num_s) or 0
    try:
        ts = float(ts_s) if ts_s else 0.0
    except ValueError:
        ts = 0.0
    if number in sent_hint:
        sent = sent_hint[number]
    elif _first(nordic_dir_s):
        # Sniffer capture: 1 = central -> peripheral, i.e. what the app sent.
        # POLARITY UNVERIFIED against real hardware — confirm on the first real
        # sniffer capture by checking that the RideOn write shows as TX.
        sent = _first(nordic_dir_s).strip() in ("1", "True", "true")
    else:
        sent = _direction_from_info(info)

    att_op = _int_or_none(_first(att_op_s))
    smp_op = _int_or_none(_first(smp_op_s))
    if att_op is not None:
        uuid = _first(uuid128_s) or None
        if not uuid and _first(uuid16_s):
            u16 = _int_or_none(_first(uuid16_s))
            uuid = f"{u16:04x}" if u16 is not None else None
        return AttOp(
            number=number,
            ts=ts,
            sent=sent,
            layer="att",
            opcode=att_op,
            opcode_name=ATT_OPCODES.get(att_op, f"ATT 0x{att_op:02x}"),
            handle=_int_or_none(_first(att_handle_s)),
            uuid=uuid,
            value=_hex_to_bytes(_first(value_s)),
            mtu=_int_or_none(_first(crx_s)) or _int_or_none(_first(srx_s)),
            info=info,
            raw_fields={"chandle": _first(chandle_s)},
        )
    if smp_op is not None:
        return AttOp(
            number=number,
            ts=ts,
            sent=sent,
            layer="smp",
            opcode=smp_op,
            opcode_name=SMP_OPCODES.get(smp_op, f"SMP 0x{smp_op:02x}"),
            info=info,
        )
    evt = _int_or_none(_first(evt_code_s))
    cmd = _int_or_none(_first(cmd_op_s))
    if evt is not None or cmd is not None:
        if evt is not None:
            name = HCI_EVENTS.get(evt, f"HCI Event 0x{evt:02x}")
        else:
            name = f"HCI Cmd 0x{cmd:04x}"
        return AttOp(
            number=number,
            ts=ts,
            sent=sent,
            layer="hci",
            opcode=evt if evt is not None else cmd,
            opcode_name=name,
            info=info,
            raw_fields={"reason": _first(reason_s)},
        )
    if info:
        return AttOp(number=number, ts=ts, sent=sent, layer="other", info=info)
    return None


# ──────────────────────────────────────────────────────────────────────────
# streaming
# ──────────────────────────────────────────────────────────────────────────


def stream(records: Iterable[HciRecord], display_filter: str | None = None) -> Iterator[AttOp]:
    """Pipe records through tshark and yield dissected ops as they appear.

    The direction bit is authoritative from the source record, but tshark
    frame numbers are assigned by tshark, so we track our own counter and hand
    the mapping to the line parser rather than re-deriving direction from
    tshark's column text.
    """
    cmd = [
        tshark_path(),
        "-r", "-",
        "-l",
        "-n",
        "-T", "fields",
        "-E", "separator=/t",
    ]
    for f in LIVE_FIELDS:
        cmd += ["-e", f]
    if display_filter:
        cmd += ["-Y", display_filter]

    log.debug("tshark: %s", " ".join(cmd))
    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=_env(),
        text=False,
        bufsize=0,
    )
    assert proc.stdin and proc.stdout

    sent_hint: dict[int, bool] = {}
    counter = 0
    try:
        proc.stdin.write(pcap_global_header())
        proc.stdin.flush()
        for rec in records:
            counter += 1
            sent_hint[counter] = rec.sent
            try:
                proc.stdin.write(pcap_record(rec))
                proc.stdin.flush()
            except BrokenPipeError:
                break
            # Drain whatever tshark has emitted so far. tshark is line
            # buffered under -l, so a readline here does not deadlock as long
            # as we only read when we expect output; instead of guessing, we
            # poll non-blockingly via the OS buffer using readline with a
            # short-circuit on availability.
            while True:
                line = _readline_available(proc.stdout)
                if line is None:
                    break
                op = _parse_fields_line(line.decode("utf-8", "replace"), sent_hint)
                if op:
                    yield op
        try:
            proc.stdin.close()
        except BrokenPipeError:
            pass
        for raw in proc.stdout:
            op = _parse_fields_line(raw.decode("utf-8", "replace"), sent_hint)
            if op:
                yield op
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:  # pragma: no cover
                proc.kill()
        if proc.stderr:
            err = proc.stderr.read().decode("utf-8", "replace").strip()
            if err:
                for line in err.splitlines():
                    if "dyld" in line or not line:
                        continue
                    log.warning("tshark: %s", line)


def _readline_available(fh) -> bytes | None:
    """Read a line only if one is already buffered, else return None."""
    import select

    r, _, _ = select.select([fh], [], [], 0)
    if not r:
        return None
    line = fh.readline()
    return line or None


def batch(records: Iterable[HciRecord], display_filter: str | None = None) -> list[AttOp]:
    """Dissect a whole capture at once. Simpler and faster than streaming."""
    recs = list(records)
    payload = pcap_global_header() + b"".join(pcap_record(r) for r in recs)
    cmd = [tshark_path(), "-r", "-", "-n", "-T", "fields", "-E", "separator=/t"]
    for f in LIVE_FIELDS:
        cmd += ["-e", f]
    if display_filter:
        cmd += ["-Y", display_filter]
    proc = subprocess.run(cmd, input=payload, capture_output=True, env=_env())
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", "replace")
        raise TsharkError(f"tshark failed ({proc.returncode}): {err.strip()[:400]}")
    sent_hint = {i + 1: r.sent for i, r in enumerate(recs)}
    ops: list[AttOp] = []
    for raw in proc.stdout.decode("utf-8", "replace").splitlines():
        op = _parse_fields_line(raw, sent_hint)
        if op:
            ops.append(op)
    return ops


def batch_file(path: str, display_filter: str | None = None) -> list[AttOp]:
    """Dissect a capture file by handing it to tshark directly — no conversion.

    Strongly preferred over converting via HciRecord for offline analysis:
    tshark natively reads PacketLogger, btsnoop (every datalink type, including
    BlueZ's monitor format 2001 that `btmon -w` produces), pcap and pcapng.
    Round-tripping through our own reader would only add a way to be wrong, and
    would reject formats tshark handles fine.

    A second pass then re-reads the raw ATT bytes and decodes them locally. The
    field list alone is not enough: tshark exports a recognised attribute's
    payload under a type-specific field name rather than `btatt.value`, so
    fields-mode loses the bytes for most reads, writes and notifications. See
    `blelab.attpdu`.
    """
    cmd = [tshark_path(), "-r", path, "-n", "-T", "fields", "-E", "separator=/t"]
    for f in LIVE_FIELDS:
        cmd += ["-e", f]
    if display_filter:
        cmd += ["-Y", display_filter]
    proc = subprocess.run(cmd, capture_output=True, env=_env())
    if proc.returncode != 0:
        err = proc.stderr.decode("utf-8", "replace")
        raise TsharkError(f"tshark could not read {path}: {err.strip()[:400]}")
    ops: list[AttOp] = []
    for raw in proc.stdout.decode("utf-8", "replace").splitlines():
        op = _parse_fields_line(raw, {})
        if op:
            ops.append(op)
    enrich_from_raw(ops, raw_att_pdus(path, display_filter))
    return ops


def capture_epochs(path: str) -> list[float]:
    """Every frame's absolute timestamp, for correlating against an external log."""
    cmd = [tshark_path(), "-r", path, "-n", "-T", "fields", "-e", "frame.time_epoch"]
    proc = subprocess.run(cmd, capture_output=True, env=_env())
    if proc.returncode != 0:
        raise TsharkError(f"tshark could not read {path}")
    out: list[float] = []
    for line in proc.stdout.decode("utf-8", "replace").splitlines():
        try:
            out.append(float(line.strip()))
        except ValueError:
            continue
    return out


def raw_att_pdus(path: str, display_filter: str | None = None) -> dict[int, bytes]:
    """frame number -> raw ATT PDU bytes, via tshark's `-x` raw layer output.

    `btatt_raw` is the exact ATT layer as tshark delimited it, so we inherit its
    HCI/L2CAP framing (including reassembly) without inheriting its
    handle -> UUID bindings, which leak across connections in a multi-device
    capture.
    """
    cmd = [tshark_path(), "-r", path, "-n", "-T", "json", "-x"]
    if display_filter:
        cmd += ["-Y", display_filter]
    proc = subprocess.run(cmd, capture_output=True, env=_env())
    if proc.returncode != 0:
        log.warning("raw ATT pass failed for %s; payloads may be incomplete", path)
        return {}
    try:
        frames = json.loads(proc.stdout.decode("utf-8", "replace") or "[]")
    except json.JSONDecodeError:
        log.warning("could not parse tshark JSON for the raw ATT pass")
        return {}
    out: dict[int, bytes] = {}
    for frame in frames:
        layers = frame.get("_source", {}).get("layers", {})
        raw = layers.get("btatt_raw")
        number = layers.get("frame", {}).get("frame.number")
        if not raw or number is None:
            continue
        hexstr = raw[0] if isinstance(raw, list) else raw
        try:
            out[int(number)] = bytes.fromhex(hexstr)
        except (TypeError, ValueError):
            continue
    return out


def enrich_from_raw(ops: list[AttOp], pdus: dict[int, bytes]) -> None:
    """Attach decoded ATT PDUs to ops, in place.

    Only ever *adds* information: an existing `value` from tshark is left alone
    so this cannot regress a capture the field list already handled.
    """
    if not pdus:
        return
    by_connection: dict[str, list] = {}
    for op in ops:
        pdu_bytes = pdus.get(op.number)
        if op.layer != "att" or not pdu_bytes:
            continue
        op.pdu = pdu_bytes
        decoded = attpdu.decode(pdu_bytes)
        if decoded is None:
            continue
        by_connection.setdefault(op.raw_fields.get("chandle", ""), []).append((op, decoded))

    for pairs in by_connection.values():
        decoded_list = [d for _, d in pairs]
        attpdu.resolve_handles(decoded_list)
        table = attpdu.AttributeTable()
        for d in decoded_list:
            table.learn(d)
        for op, decoded in pairs:
            op.gloss = decoded.describe()
            if not op.value and decoded.value:
                op.value = decoded.value
            # The decoded handle wins whenever we have one: it is either in the
            # PDU bytes or derived from the matching request on this same
            # connection. tshark's handle on a *response* is inferred from its
            # global binding table and is wrong in a multi-device capture — it
            # reported 0x0016 for the response to a read of 0x0012.
            if decoded.handle is not None:
                op.handle = decoded.handle
            # Our per-connection table OVERRIDES tshark's UUID: tshark binds
            # handles globally, so in a two-device capture it attributes this
            # device's handles to the other one's characteristics.
            learned = table.uuid_for(op.handle)
            if learned:
                op.uuid = learned
                role = table.role_for(op.handle)
                if role and role != "value":
                    op.gloss = f"{role} of {learned}" + (
                        f"  {op.gloss}" if op.gloss else ""
                    )
            elif not op.uuid:
                found = decoded.uuids
                if len(found) == 1:
                    op.uuid = found[0]


def stream_bytes(chunks: Iterable[bytes], display_filter: str | None = None) -> Iterator[AttOp]:
    """Pipe an already-tshark-readable byte stream (btsnoop, pcap) to tshark.

    tshark reads btsnoop and pcap from stdin, so a live source that already
    emits one of those formats needs no conversion at all. This is the path for
    `btmon -w /dev/stdout` over SSH, and for Android's snoop socket.
    """
    cmd = [tshark_path(), "-r", "-", "-l", "-n", "-T", "fields", "-E", "separator=/t"]
    for f in LIVE_FIELDS:
        cmd += ["-e", f]
    if display_filter:
        cmd += ["-Y", display_filter]

    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        env=_env(),
        bufsize=0,
    )
    assert proc.stdin and proc.stdout
    try:
        for chunk in chunks:
            try:
                proc.stdin.write(chunk)
                proc.stdin.flush()
            except BrokenPipeError:
                break
            while True:
                line = _readline_available(proc.stdout)
                if line is None:
                    break
                op = _parse_fields_line(line.decode("utf-8", "replace"), {})
                if op:
                    yield op
        try:
            proc.stdin.close()
        except BrokenPipeError:
            pass
        for raw in proc.stdout:
            op = _parse_fields_line(raw.decode("utf-8", "replace"), {})
            if op:
                yield op
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:  # pragma: no cover
                proc.kill()
        if proc.stderr:
            err = proc.stderr.read().decode("utf-8", "replace").strip()
            for line in err.splitlines():
                if line and "dyld" not in line:
                    log.warning("tshark: %s", line)


def json_tree(records: Iterable[HciRecord], display_filter: str | None = None) -> list[dict]:
    """Full protocol tree, for questions the flat field list cannot answer."""
    recs = list(records)
    payload = pcap_global_header() + b"".join(pcap_record(r) for r in recs)
    cmd = [tshark_path(), "-r", "-", "-n", "-T", "json"]
    if display_filter:
        cmd += ["-Y", display_filter]
    proc = subprocess.run(cmd, input=payload, capture_output=True, env=_env())
    if proc.returncode != 0:
        raise TsharkError(f"tshark failed: {proc.stderr.decode('utf-8', 'replace')[:400]}")
    try:
        return json.loads(proc.stdout.decode("utf-8", "replace") or "[]")
    except json.JSONDecodeError as exc:
        raise TsharkError(f"could not parse tshark JSON: {exc}") from exc
