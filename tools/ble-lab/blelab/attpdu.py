"""Decode the ATT layer from raw PDU bytes.

Why this exists, given `dissect.py` already asks tshark for `btatt.*` fields:
tshark only populates `btatt.value` when it does *not* recognise the attribute
type. The moment it thinks it knows the type it exports the payload under a
type-specific name instead — `btatt.battery_level`,
`btatt.firmware_revision_string`, `btatt.characteristic_configuration_client` —
so a fixed field list silently loses the bytes. Worse, in a capture holding
more than one device tshark's handle -> UUID bindings leak between
connections, so it recognises types *wrongly*: in the 2026-07-29 Click capture
it labelled a read of handle 0x0012 as a firmware revision on 0x0016 and put
the manufacturer string "Zwift Inc" in `btatt.firmware_revision_string`.

The ATT PDU is fully self-describing (Core v5.x Vol 3 Part F §3.4), so decoding
it needs no cross-frame state and cannot inherit that error. tshark still does
all HCI/L2CAP framing and layer identification; we decode only this one layer,
from the exact bytes it hands us via `btatt_raw`.

Pure functions over bytes — unit-tested with fixtures, no hardware needed.
"""

from __future__ import annotations

from dataclasses import dataclass, field

ATT_NAMES = {
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

ATT_ERRORS = {
    0x01: "Invalid Handle",
    0x02: "Read Not Permitted",
    0x03: "Write Not Permitted",
    0x04: "Invalid PDU",
    0x05: "Insufficient Authentication",
    0x06: "Request Not Supported",
    0x07: "Invalid Offset",
    0x08: "Insufficient Authorization",
    0x09: "Prepare Queue Full",
    0x0A: "Attribute Not Found",
    0x0B: "Attribute Not Long",
    0x0C: "Insufficient Encryption Key Size",
    0x0D: "Invalid Attribute Value Length",
    0x0E: "Unlikely Error",
    0x0F: "Insufficient Encryption",
    0x10: "Unsupported Group Type",
    0x11: "Insufficient Resources",
}

# GATT-defined attribute types, used to gloss request type filters.
GATT_TYPES = {
    0x2800: "PrimaryService",
    0x2801: "SecondaryService",
    0x2802: "Include",
    0x2803: "Characteristic",
    0x2900: "CharExtProps",
    0x2901: "UserDescription",
    0x2902: "CCCD",
    0x2903: "ServerCharConfig",
    0x2904: "PresentationFormat",
}

PROP_BITS = (
    (0x01, "Broadcast"),
    (0x02, "Read"),
    (0x04, "WriteNoRsp"),
    (0x08, "Write"),
    (0x10, "Notify"),
    (0x20, "Indicate"),
    (0x40, "SignedWrite"),
    (0x80, "ExtProps"),
)

# Requests that carry no handle of their own but whose response is a value.
# ATT permits only one outstanding request per bearer (Vol 3 Part F §3.3.2),
# so a response always belongs to the most recent request — see resolve_handles.
RESPONSE_OF = {0x0B: 0x0A, 0x0D: 0x0C, 0x13: 0x12}


def format_properties(props: int) -> str:
    return "+".join(name for bit, name in PROP_BITS if props & bit) or "none"


def format_uuid(raw: bytes) -> str:
    """2-byte UUIDs render as 4 hex digits; 16-byte as a dashed UUID.

    128-bit UUIDs are little-endian on the wire, hence the reversal.
    """
    if len(raw) == 2:
        return f"{int.from_bytes(raw, 'little'):04x}"
    if len(raw) == 4:
        return f"{int.from_bytes(raw, 'little'):08x}"
    if len(raw) == 16:
        b = raw[::-1]
        return f"{b[0:4].hex()}-{b[4:6].hex()}-{b[6:8].hex()}-{b[8:10].hex()}-{b[10:16].hex()}"
    return raw.hex()


def _type_name(uuid: str) -> str:
    if len(uuid) == 4:
        return GATT_TYPES.get(int(uuid, 16), uuid)
    return uuid


@dataclass
class Characteristic:
    decl_handle: int
    value_handle: int
    properties: int
    uuid: str

    def describe(self) -> str:
        return (
            f"decl 0x{self.decl_handle:04x} val=0x{self.value_handle:04x} "
            f"[{format_properties(self.properties)}] {self.uuid}"
        )


@dataclass
class Service:
    start_handle: int
    end_handle: int
    uuid: str

    def describe(self) -> str:
        return f"svc 0x{self.start_handle:04x}..0x{self.end_handle:04x} {self.uuid}"


@dataclass
class Descriptor:
    handle: int
    uuid: str

    def describe(self) -> str:
        return f"0x{self.handle:04x}={_type_name(self.uuid)}"


@dataclass
class AttPdu:
    """One decoded ATT PDU. `handle`/`value` are populated only when the PDU
    itself carries them — a Read Response carries a value but no handle."""

    opcode: int
    name: str
    handle: int | None = None
    value: bytes = b""
    mtu: int | None = None
    handle_range: tuple[int, int] | None = None
    type_uuid: str | None = None
    error: tuple[int, int, int] | None = None  # (on_opcode, on_handle, code)
    services: list[Service] = field(default_factory=list)
    characteristics: list[Characteristic] = field(default_factory=list)
    descriptors: list[Descriptor] = field(default_factory=list)
    truncated: bool = False

    @property
    def uuids(self) -> list[str]:
        return (
            [s.uuid for s in self.services]
            + [c.uuid for c in self.characteristics]
            + [d.uuid for d in self.descriptors]
        )

    def describe(self) -> str:
        """One-line gloss of whatever this PDU actually carries."""
        if self.error:
            op, handle, code = self.error
            return (
                f"on {ATT_NAMES.get(op, hex(op))} handle 0x{handle:04x} -> "
                f"{ATT_ERRORS.get(code, f'0x{code:02x}')}"
            )
        if self.mtu is not None:
            return f"MTU {self.mtu} bytes (max single write {self.mtu - 3})"
        parts: list[str] = []
        if self.handle_range:
            parts.append(f"0x{self.handle_range[0]:04x}..0x{self.handle_range[1]:04x}")
        if self.type_uuid:
            parts.append(f"type={_type_name(self.type_uuid)}")
        for group in (self.services, self.characteristics, self.descriptors):
            parts += [item.describe() for item in group]
        if self.handle is not None and not self.handle_range:
            parts.append(f"handle 0x{self.handle:04x}")
        if self.value:
            parts.append(f"value={self.value.hex()}")
        if self.truncated:
            parts.append("(TRUNCATED PDU)")
        return "  ".join(parts)


def _records(body: bytes, size: int):
    """Split a length-prefixed record list, ignoring a trailing partial."""
    if size <= 0:
        return
    for off in range(0, len(body) - size + 1, size):
        yield body[off : off + size]


def decode(pdu: bytes) -> AttPdu | None:
    """Decode one ATT PDU. Returns None for an empty buffer.

    Malformed or short PDUs come back flagged `truncated` rather than raising:
    a capture with a clipped frame should degrade one line of a report, not
    abort the analysis.
    """
    if not pdu:
        return None
    op = pdu[0]
    out = AttPdu(opcode=op, name=ATT_NAMES.get(op, f"ATT 0x{op:02x}"))
    body = pdu[1:]

    try:
        if op == 0x01:
            if len(body) < 4:
                out.truncated = True
            else:
                out.error = (body[0], int.from_bytes(body[1:3], "little"), body[3])
        elif op in (0x02, 0x03):
            out.mtu = int.from_bytes(body[0:2], "little")
        elif op == 0x04:
            out.handle_range = (
                int.from_bytes(body[0:2], "little"),
                int.from_bytes(body[2:4], "little"),
            )
        elif op in (0x08, 0x10, 0x06):
            out.handle_range = (
                int.from_bytes(body[0:2], "little"),
                int.from_bytes(body[2:4], "little"),
            )
            if len(body) > 4:
                out.type_uuid = format_uuid(body[4:20] if len(body) >= 20 else body[4:])
        elif op == 0x05:
            fmt = body[0]
            size = 4 if fmt == 0x01 else 18
            for rec in _records(body[1:], size):
                out.descriptors.append(
                    Descriptor(int.from_bytes(rec[0:2], "little"), format_uuid(rec[2:]))
                )
        elif op == 0x09:
            size = body[0]
            for rec in _records(body[1:], size):
                if size in (7, 21):  # characteristic declaration
                    out.characteristics.append(
                        Characteristic(
                            decl_handle=int.from_bytes(rec[0:2], "little"),
                            properties=rec[2],
                            value_handle=int.from_bytes(rec[3:5], "little"),
                            uuid=format_uuid(rec[5:]),
                        )
                    )
                else:
                    out.descriptors.append(
                        Descriptor(int.from_bytes(rec[0:2], "little"), format_uuid(rec[2:]))
                    )
        elif op == 0x11:
            size = body[0]
            for rec in _records(body[1:], size):
                out.services.append(
                    Service(
                        int.from_bytes(rec[0:2], "little"),
                        int.from_bytes(rec[2:4], "little"),
                        format_uuid(rec[4:]),
                    )
                )
        elif op in (0x0A, 0x0C):
            out.handle = int.from_bytes(body[0:2], "little")
            if op == 0x0C and len(body) >= 4:
                out.value = body[2:4]  # offset
        elif op in (0x0B, 0x0D):
            out.value = body
        elif op in (0x12, 0x52, 0x1B, 0x1D, 0xD2):
            if len(body) < 2:
                out.truncated = True
            else:
                out.handle = int.from_bytes(body[0:2], "little")
                out.value = body[2:]
        elif op == 0x16:
            out.handle = int.from_bytes(body[0:2], "little")
            out.value = body[4:]
        else:
            out.value = body
    except (IndexError, ValueError):
        out.truncated = True
    return out


class AttributeTable:
    """Handle -> UUID, learned from the discovery traffic of ONE connection.

    This replaces tshark's binding rather than trusting it. tshark keeps a
    single global binding table, so in a capture with two peers the second
    device's handles inherit the first device's UUIDs: in the 2026-07-29 capture
    it labelled Click frames with the KICKR's `a026e002`. Ours is per
    connection, so it cannot make that mistake — and if discovery was not
    captured it simply knows nothing rather than guessing.
    """

    def __init__(self) -> None:
        self._values: dict[int, str] = {}  # value handle -> characteristic UUID
        self._decls: dict[int, str] = {}  # declaration handle -> UUID
        self._descriptors: dict[int, str] = {}  # descriptor handle -> its own UUID

    def learn(self, pdu: AttPdu | None) -> None:
        if pdu is None:
            return
        for char in pdu.characteristics:
            self._values[char.value_handle] = char.uuid
            self._decls[char.decl_handle] = char.uuid
        for desc in pdu.descriptors:
            self._descriptors[desc.handle] = desc.uuid

    def uuid_for(self, handle: int | None) -> str | None:
        """The characteristic UUID a handle belongs to.

        A descriptor resolves to its *parent* characteristic, because 'CCCD of
        ZAP 0100' is the useful label; the descriptor's own type is reported
        separately by role_for().
        """
        if handle is None:
            return None
        if handle in self._values:
            return self._values[handle]
        if handle in self._decls:
            return self._decls[handle]
        if handle in self._descriptors:
            parents = [h for h in self._values if h < handle]
            if parents:
                return self._values[max(parents)]
        return None

    def role_for(self, handle: int | None) -> str:
        if handle is None:
            return ""
        if handle in self._values:
            return "value"
        if handle in self._decls:
            return "declaration"
        own = self._descriptors.get(handle)
        if own:
            return _type_name(own)
        return ""

    def known(self, handle: int | None) -> bool:
        return handle is not None and (
            handle in self._values or handle in self._decls or handle in self._descriptors
        )


def resolve_handles(decoded: list[AttPdu | None]) -> None:
    """Fill in the handle a Read/Write Response refers to, in place.

    A Read Response carries only a value; the handle lives in the request. ATT
    allows one outstanding request per bearer, so the answer is unambiguously
    the most recent preceding request of the matching opcode. Pass PDUs from a
    SINGLE connection in capture order — interleaving two links would pair a
    response with the wrong request.
    """
    pending: dict[int, int] = {}  # request opcode -> handle
    for pdu in decoded:
        if pdu is None:
            continue
        if pdu.opcode in (0x0A, 0x0C, 0x12) and pdu.handle is not None:
            pending[pdu.opcode] = pdu.handle
        req = RESPONSE_OF.get(pdu.opcode)
        if req is not None and pdu.handle is None and req in pending:
            pdu.handle = pending.pop(req)
