"""Protobuf structure inference for opaque BLE payloads.

Why this is worth having: ZAP frames are ``<1-byte message type><protobuf>``
(docs/virtual-shifting/PROTOCOLS.md §1.4). "Do these bytes parse as valid
protobuf, and if so with what field numbers and wire types?" is a strong
automatic classifier — a random or encrypted payload will essentially never
parse cleanly to the exact end of the buffer, while a real protobuf message
always will.

So the useful output is a *verdict* plus the field skeleton, not a decode
against a known schema. We deliberately do not guess at semantics.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

WIRE_VARINT = 0
WIRE_64BIT = 1
WIRE_LEN = 2
WIRE_GROUP_START = 3  # deprecated
WIRE_GROUP_END = 4  # deprecated
WIRE_32BIT = 5

WIRE_NAMES = {
    WIRE_VARINT: "varint",
    WIRE_64BIT: "i64",
    WIRE_LEN: "len",
    WIRE_GROUP_START: "grp{",
    WIRE_GROUP_END: "}grp",
    WIRE_32BIT: "i32",
}


class DecodeError(ValueError):
    pass


def read_varint(buf: bytes, pos: int) -> tuple[int, int]:
    value = 0
    shift = 0
    start = pos
    while True:
        if pos >= len(buf):
            raise DecodeError(f"varint truncated at offset {start}")
        if shift > 63:
            raise DecodeError(f"varint too long at offset {start}")
        b = buf[pos]
        value |= (b & 0x7F) << shift
        pos += 1
        if not b & 0x80:
            return value, pos
        shift += 7


def zigzag(n: int) -> int:
    """Protobuf sint32/sint64 decoding. Applied opportunistically, since a
    field's signedness is a schema fact we do not have."""
    return (n >> 1) ^ -(n & 1)


@dataclass
class PbField:
    number: int
    wire: int
    value: Any
    offset: int
    nested: "PbMessage | None" = None
    text: str | None = None

    def describe(self) -> str:
        w = WIRE_NAMES.get(self.wire, str(self.wire))
        if self.wire == WIRE_VARINT:
            z = zigzag(self.value)
            extra = f" (zigzag {z})" if z != self.value and abs(z) < 1 << 31 else ""
            return f"{self.number}:{w}={self.value}{extra}"
        if self.wire == WIRE_LEN:
            body = f"{self.number}:{w}[{len(self.value)}]"
            if self.nested and self.nested.valid:
                return f"{body}{{{self.nested.describe()}}}"
            if self.text is not None:
                return f'{body}="{self.text}"'
            return f"{body}={self.value.hex()}"
        return f"{self.number}:{w}={self.value}"


@dataclass
class PbMessage:
    valid: bool
    fields: list[PbField] = field(default_factory=list)
    error: str | None = None
    consumed: int = 0

    def describe(self) -> str:
        return " ".join(f.describe() for f in self.fields)


def _printable(raw: bytes) -> str | None:
    """Return the string if the bytes look like intentional text.

    Threshold is deliberately strict: ZAP embeds ASCII device serials in
    length-delimited fields (see experiments/03), and we want those found,
    but not every 2-byte blob reinterpreted as text.
    """
    if not raw or len(raw) < 3:
        return None
    printable = sum(1 for b in raw if 0x20 <= b < 0x7F)
    if printable / len(raw) >= 0.9:
        try:
            return raw.decode("ascii")
        except UnicodeDecodeError:
            return None
    return None


def parse(buf: bytes, depth: int = 0, max_depth: int = 4) -> PbMessage:
    """Try to parse ``buf`` as a protobuf message.

    ``valid`` is True only if every byte was consumed by well-formed fields —
    partial parses are treated as failures, which is what makes this a useful
    classifier rather than a wishful one.
    """
    msg = PbMessage(valid=False)
    if not buf:
        return PbMessage(valid=False, error="empty")
    pos = 0
    try:
        while pos < len(buf):
            offset = pos
            tag, pos = read_varint(buf, pos)
            number = tag >> 3
            wire = tag & 0x07
            if number == 0:
                raise DecodeError(f"field number 0 at offset {offset}")
            if wire in (WIRE_GROUP_START, WIRE_GROUP_END):
                raise DecodeError(f"deprecated group wire type {wire} at offset {offset}")
            if wire == WIRE_VARINT:
                value, pos = read_varint(buf, pos)
                msg.fields.append(PbField(number, wire, value, offset))
            elif wire == WIRE_64BIT:
                if pos + 8 > len(buf):
                    raise DecodeError(f"i64 truncated at offset {offset}")
                msg.fields.append(
                    PbField(number, wire, int.from_bytes(buf[pos : pos + 8], "little"), offset)
                )
                pos += 8
            elif wire == WIRE_32BIT:
                if pos + 4 > len(buf):
                    raise DecodeError(f"i32 truncated at offset {offset}")
                msg.fields.append(
                    PbField(number, wire, int.from_bytes(buf[pos : pos + 4], "little"), offset)
                )
                pos += 4
            elif wire == WIRE_LEN:
                length, pos = read_varint(buf, pos)
                if length > len(buf) - pos:
                    raise DecodeError(
                        f"length-delimited field {number} claims {length} bytes, "
                        f"{len(buf) - pos} remain (offset {offset})"
                    )
                raw = buf[pos : pos + length]
                pos += length
                nested = None
                if depth < max_depth and raw:
                    candidate = parse(raw, depth + 1, max_depth)
                    if candidate.valid:
                        nested = candidate
                msg.fields.append(
                    PbField(number, wire, raw, offset, nested=nested, text=_printable(raw))
                )
            else:  # pragma: no cover - all 8 wire values covered above
                raise DecodeError(f"unknown wire type {wire}")
    except DecodeError as exc:
        msg.error = str(exc)
        msg.consumed = pos
        return msg
    msg.valid = True
    msg.consumed = pos
    return msg


@dataclass
class Verdict:
    """The classification result for one payload."""

    prefix_len: int  # bytes of non-protobuf header before the message; -1 = no parse
    message: PbMessage | None
    prefix: bytes
    note: str

    @property
    def parses(self) -> bool:
        return self.prefix_len >= 0

    @property
    def mode(self) -> str:
        if self.prefix_len < 0:
            return "none"
        return "whole" if self.prefix_len == 0 else f"skip{self.prefix_len}"

    def describe(self) -> str:
        if not self.message or not self.message.valid:
            return f"not protobuf ({self.note})"
        head = f"hdr={self.prefix.hex()} " if self.prefix else ""
        return f"{head}{self.message.describe()}"


# How many leading non-protobuf header bytes to try skipping.
#
# 1 covers the documented ZAP `<message type><protobuf>` framing
# (PROTOCOLS.md §1.4). 3 is needed for the 0xFF-family frames, which are
# `FF <sub> 00` + protobuf — inferred here, and consistent with PROTOCOLS.md
# §1.5's `FF 04 00` Click-v2 post-handshake write. Going beyond 3 starts
# producing coincidental parses on short payloads, so it is capped.
MAX_PREFIX = 3


def classify(payload: bytes, max_prefix: int = MAX_PREFIX) -> Verdict:
    """Decide how a payload relates to protobuf.

    Scans candidate header lengths 0..max_prefix and returns the *smallest*
    header for which the remainder parses as protobuf consuming every byte.
    Requiring full consumption is what makes this a classifier rather than
    wishful thinking: random or encrypted bytes essentially never parse to an
    exact buffer end.

    Reporting *which* header length worked is itself a finding — a nonzero
    prefix_len is positive evidence of a framed protocol on top of protobuf.
    """
    if not payload:
        return Verdict(-1, None, b"", "empty payload")

    first_error = None
    for skip in range(0, min(max_prefix, len(payload) - 1) + 1):
        body = payload[skip:]
        if not body:
            break
        msg = parse(body)
        if skip == 0:
            first_error = msg.error
        if msg.valid:
            note = (
                "valid as bare protobuf"
                if skip == 0
                else f"valid after a {skip}-byte header"
            )
            return Verdict(skip, msg, payload[:skip], note)

    reason = first_error or "unparseable"
    entropy_hint = ""
    if len(payload) >= 16:
        distinct = len(set(payload))
        if distinct / len(payload) > 0.85:
            entropy_hint = "; high byte entropy — possibly encrypted/random"
    return Verdict(-1, None, b"", f"{reason}{entropy_hint}")
