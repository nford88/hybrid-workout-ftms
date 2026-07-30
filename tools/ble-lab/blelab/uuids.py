"""UUID -> human name resolution, scoped to the devices in this project.

Kept deliberately small and hand-curated rather than pulling the full
Bluetooth SIG assigned-numbers list: in this project's captures, an
unrecognised UUID is a *finding*, and a 4000-entry table would let it slide
past unnoticed.

Sources for the non-SIG entries: docs/virtual-shifting/PROTOCOLS.md §1.2
(Zwift Accessory Protocol) and §3 (FTMS).
"""

from __future__ import annotations

BASE_SUFFIX = "-0000-1000-8000-00805f9b34fb"

# ── Zwift Accessory Protocol (ZAP), used by Click AND by the KICKR ─────────
ZWIFT_SVC_LEGACY = "00000001-19ca-4651-86e5-fa29dcdd09d1"  # pre-Jan-2025 firmware
ZWIFT_SVC_FC82 = "0000fc82" + BASE_SUFFIX  # post-Jan-2025 firmware
ZAP_ASYNC = "00000002-19ca-4651-86e5-fa29dcdd09d1"  # notify: buttons/idle/battery
ZAP_SYNC_RX = "00000003-19ca-4651-86e5-fa29dcdd09d1"  # write: handshake/commands
ZAP_SYNC_TX = "00000004-19ca-4651-86e5-fa29dcdd09d1"  # indicate: handshake reply
ZAP_UNKNOWN_6 = "00000006-19ca-4651-86e5-fa29dcdd09d1"
# Click V2 only. Present on fw 1.2.0 (hw B.0), CONFIRMED by the 2026-07-29
# bugreport capture of Zwift's own discovery — see experiments/15. Zwift
# subscribed to all three and wrote none of them in that session, so what they
# carry is still UNKNOWN; 0100/0101 are BikeControl's named unlock pair and 0102
# is undocumented anywhere.
ZAP_UNLOCK_0100 = "00000100-19ca-4651-86e5-fa29dcdd09d1"
ZAP_UNLOCK_0101 = "00000101-19ca-4651-86e5-fa29dcdd09d1"
ZAP_UNLOCK_0102 = "00000102-19ca-4651-86e5-fa29dcdd09d1"

# ── FTMS ───────────────────────────────────────────────────────────────────
FTMS_SVC = "00001826" + BASE_SUFFIX
FTMS_INDOOR_BIKE_DATA = "00002ad2" + BASE_SUFFIX
FTMS_CONTROL_POINT = "00002ad9" + BASE_SUFFIX
FTMS_MACHINE_STATUS = "00002ada" + BASE_SUFFIX
FTMS_FEATURE = "00002acc" + BASE_SUFFIX

NAMES: dict[str, str] = {
    # GATT / GAP
    "00001800" + BASE_SUFFIX: "Generic Access",
    "00001801" + BASE_SUFFIX: "Generic Attribute",
    "00002a00" + BASE_SUFFIX: "Device Name",
    "00002a01" + BASE_SUFFIX: "Appearance",
    "00002a04" + BASE_SUFFIX: "Peripheral Preferred Conn Params",
    "00002a05" + BASE_SUFFIX: "Service Changed",
    # Device Information
    "0000180a" + BASE_SUFFIX: "Device Information",
    "00002a24" + BASE_SUFFIX: "Model Number",
    "00002a25" + BASE_SUFFIX: "Serial Number",
    "00002a26" + BASE_SUFFIX: "Firmware Revision",
    "00002a27" + BASE_SUFFIX: "Hardware Revision",
    "00002a28" + BASE_SUFFIX: "Software Revision",
    "00002a29" + BASE_SUFFIX: "Manufacturer Name",
    # Battery
    "0000180f" + BASE_SUFFIX: "Battery",
    "00002a19" + BASE_SUFFIX: "Battery Level",
    # Descriptors
    "00002902" + BASE_SUFFIX: "CEP",
    "00002901" + BASE_SUFFIX: "User Description",
    "00002902" + BASE_SUFFIX: "Client Char Config (CCCD)",
    "00002903" + BASE_SUFFIX: "Server Char Config",
    "00002904" + BASE_SUFFIX: "Char Presentation Format",
    # Nordic DFU
    "0000fe59" + BASE_SUFFIX: "Nordic DFU",
    # Cycling Power / Speed & Cadence (the KICKR advertises these too)
    "00001818" + BASE_SUFFIX: "Cycling Power",
    "00002a63" + BASE_SUFFIX: "Cycling Power Measurement",
    "00002a65" + BASE_SUFFIX: "Cycling Power Feature",
    "00002a66" + BASE_SUFFIX: "Cycling Power Control Point",
    "00001816" + BASE_SUFFIX: "Cycling Speed and Cadence",
    # FTMS
    FTMS_SVC: "FTMS",
    FTMS_FEATURE: "FTMS Feature",
    FTMS_INDOOR_BIKE_DATA: "Indoor Bike Data",
    FTMS_CONTROL_POINT: "FTMS Control Point",
    FTMS_MACHINE_STATUS: "FTMS Machine Status",
    "00002ad6" + BASE_SUFFIX: "Supported Speed Range",
    "00002ad8" + BASE_SUFFIX: "Supported Power Range",
    # ZAP
    ZWIFT_SVC_LEGACY: "Zwift Svc (19ca, pre-2025fw)",
    ZWIFT_SVC_FC82: "Zwift Svc (FC82, post-2025fw)",
    ZAP_ASYNC: "ZAP ASYNC (notify)",
    ZAP_SYNC_RX: "ZAP SYNC RX (write)",
    ZAP_SYNC_TX: "ZAP SYNC TX (indicate)",
    ZAP_UNKNOWN_6: "ZAP 0006 (undocumented)",
    ZAP_UNLOCK_0100: "ZAP 0100 (unlock?)",
    ZAP_UNLOCK_0101: "ZAP 0101 (unlock?)",
    ZAP_UNLOCK_0102: "ZAP 0102 (undocumented)",
    # Wahoo proprietary (PROTOCOLS.md §3.5) — never exercised by this project
    "a026e005-0a7d-4ab3-97fa-f1500f9feb8b": "Wahoo proprietary CP",
    "a026e002-0a7d-4ab3-97fa-f1500f9feb8b": "Wahoo proprietary (e002)",
}

# Characteristics whose traffic is the actual subject of this investigation.
OF_INTEREST = {ZAP_ASYNC, ZAP_SYNC_RX, ZAP_SYNC_TX, FTMS_CONTROL_POINT, FTMS_MACHINE_STATUS}

# High-rate telemetry we normally want collapsed rather than printed per frame.
NOISY = {FTMS_INDOOR_BIKE_DATA, "00002a63" + BASE_SUFFIX, "00002a19" + BASE_SUFFIX}


def normalise(uuid: str | None) -> str | None:
    """Lower-case, expand 16/32-bit shorthand to the full 128-bit form."""
    if not uuid:
        return None
    u = uuid.strip().lower().replace("0x", "")
    if len(u) == 4:
        return f"0000{u}{BASE_SUFFIX}"
    if len(u) == 8 and "-" not in u:
        return f"{u}{BASE_SUFFIX}"
    return u


def name_for(uuid: str | None) -> str:
    u = normalise(uuid)
    if not u:
        return "?"
    if u in NAMES:
        return NAMES[u]
    # Unrecognised: show the distinguishing 16-bit chunk plus a marker so it
    # is visually obvious in a live trace that we do not know what this is.
    if u.endswith(BASE_SUFFIX):
        return f"<16bit {u[4:8]}>"
    return f"<128bit {u[:8]}…>"


def short(uuid: str | None) -> str:
    """Compact display form for aligned live output."""
    u = normalise(uuid)
    if not u:
        return "-"
    if u.endswith(BASE_SUFFIX):
        return u[4:8]
    return u[:8]


def is_zap_service(uuid: str | None) -> bool:
    return normalise(uuid) in (ZWIFT_SVC_LEGACY, ZWIFT_SVC_FC82)
