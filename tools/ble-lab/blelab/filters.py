"""tshark display-filter construction.

Exists because a real host-side capture is mostly other people's traffic. A Mac
with a Magic Mouse and Magic Keyboard produces a continuous stream of Bluetooth
HID reports; the Click's handshake is a handful of packets buried in it. Getting
the filter right is the difference between a readable trace and a wall of noise.

Filters are composed by ANDing every supplied constraint, so `--preset` /
`--device` / `--filter-uuid` / `--filter` narrow together rather than fighting.
"""

from __future__ import annotations

from . import uuids

# Named presets, so nobody has to remember tshark filter syntax at the bike.
PRESETS: dict[str, str | None] = {
    "all": None,
    "att": "btatt",
    "gatt": "btatt or btsmp",
    # The connection lifecycle: pairing, disconnects, encryption changes, LE
    # meta events (connect/params), and the ATT MTU exchange.
    "connection": (
        "btsmp or bthci_evt.code == 0x05 or bthci_evt.code == 0x08 "
        "or bthci_evt.code == 0x3e or btatt.opcode == 0x02 or btatt.opcode == 0x03"
    ),
    "writes": "btatt.opcode == 0x12 or btatt.opcode == 0x52",
    "notifications": "btatt.opcode == 0x1b or btatt.opcode == 0x1d",
    # Drops the high-rate Indoor Bike Data and battery streams but keeps
    # everything structural.
    "no-telemetry": (
        "(btatt and not btatt.handle_uuid16 == 0x2ad2 "
        "and not btatt.handle_uuid16 == 0x2a19) or btsmp "
        "or bthci_evt.code == 0x05 or bthci_evt.code == 0x08 or bthci_evt.code == 0x3e"
    ),
}

UUID_GROUPS = {
    "zap": (uuids.ZAP_ASYNC, uuids.ZAP_SYNC_RX, uuids.ZAP_SYNC_TX),
    "ftms": (
        uuids.FTMS_CONTROL_POINT,
        uuids.FTMS_MACHINE_STATUS,
        uuids.FTMS_INDOOR_BIKE_DATA,
    ),
}


def uuid_filter(spec: str) -> str:
    """'zap' | 'ftms' | a literal UUID -> a display filter."""
    wanted = UUID_GROUPS.get(spec) or (uuids.normalise(spec) or spec,)
    clauses = []
    for u in wanted:
        if not u:
            continue
        if u.endswith(uuids.BASE_SUFFIX):
            clauses.append(f"btatt.uuid16 == 0x{u[4:8]}")
        else:
            clauses.append(f"btatt.uuid128 == {u.replace('-', ':')}")
    return " or ".join(clauses) if clauses else "btatt"


def device_filter(addr: str) -> str:
    """Restrict to one peer device by Bluetooth address.

    Matches either direction, because src/dst swap between what we sent and
    what the peer sent. tshark resolves these from the HCI connection-complete
    event, so they are only populated if the capture includes the connection
    being established — start the capture *before* connecting.
    """
    a = addr.strip().lower().replace("-", ":")
    return f"bthci_acl.src.bd_addr == {a} or bthci_acl.dst.bd_addr == {a}"


def handle_filter(*handles: int) -> str:
    """Restrict to one or more ACL connection handles.

    Preferred over `device_filter` whenever the handles are known. An address
    filter relies on tshark having an address bound to every ACL frame, and it
    does not: filtering the 2026-07-29 Click capture by address returned 100 ATT
    frames where the handle filter returned 102, and one of the two lost frames
    was the Device Information declaration response — so the attribute table
    came out missing four handles. Handles are on every ACL frame by
    construction.
    """
    return " or ".join(f"bthci_acl.chandle == 0x{h:04x}" for h in handles)


def build(
    preset: str | None = None,
    device: str | None = None,
    uuid: str | None = None,
    handle: int | None = None,
    extra: str | None = None,
    device_handles: list[int] | None = None,
) -> str | None:
    """AND together every supplied constraint. Returns None if unconstrained.

    `device_handles` is the resolved ACL handle list for `device`; when supplied
    it replaces the address filter, which is less complete.
    """
    parts: list[str] = []
    if preset:
        expr = PRESETS.get(preset)
        if expr:
            parts.append(f"({expr})")
    if device_handles:
        parts.append(f"({handle_filter(*device_handles)})")
    elif device:
        parts.append(f"({device_filter(device)})")
    if handle is not None:
        parts.append(f"({handle_filter(handle)})")
    if uuid:
        parts.append(f"({uuid_filter(uuid)})")
    if extra:
        parts.append(f"({extra})")
    return " and ".join(parts) if parts else None
