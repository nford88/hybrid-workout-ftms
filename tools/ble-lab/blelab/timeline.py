"""Reconstruct a connection as an ordered state machine.

This is the analytical core. Every other module moves bytes around; this one
answers the actual question: *in what order did the official app do things,
and which of those steps can Web Bluetooth reproduce?*

Phases follow the BLE connection lifecycle. A step is assigned to a phase by
what it is, not by when it happened, so an out-of-order capture surfaces as a
phase appearing twice rather than being silently reordered.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

from . import pbinfer, uuids
from .dissect import AttOp
from .markers import Marker, attribute


class Phase(str, Enum):
    ADVERTISING = "advertising"
    CONNECT = "connect"
    LINK_SETUP = "link-setup"  # feature exchange, data length, connection update
    MTU = "mtu"
    PAIRING = "pairing"  # SMP / encryption
    DISCOVERY = "discovery"
    SUBSCRIBE = "subscribe"  # CCCD writes
    HANDSHAKE = "handshake"  # app-level: RideOn and its reply
    STEADY = "steady"  # notifications, keepalives, polling
    TEARDOWN = "teardown"
    UNKNOWN = "unknown"


# Web Bluetooth reproducibility classification. This is the deliverable's
# spine, so the mapping lives next to the phase definitions rather than in
# prose that can drift from the code.
REPRODUCIBLE = "reproducible"  # maps to a Web Bluetooth API call
IMPLICIT = "implicit"  # the browser/OS does it for us
UNREACHABLE = "unreachable"  # Web Bluetooth cannot do this at all


@dataclass
class Step:
    ts: float
    phase: Phase
    direction: str  # TX | RX
    summary: str
    detail: str = ""
    packet: int = 0
    value: bytes = b""
    handle: int | None = None
    uuid: str | None = None
    marker: str | None = None
    classification: str = ""
    web_bluetooth: str = ""
    repeat_count: int = 1

    @property
    def key(self) -> str:
        """Identity for diffing across runs: stable under timing changes."""
        u = uuids.short(self.uuid) if self.uuid else (f"h{self.handle:04x}" if self.handle is not None else "-")
        return f"{self.phase.value}|{self.direction}|{self.summary}|{u}"


# ── Web Bluetooth mapping table ────────────────────────────────────────────
#
# Keyed by (phase, ATT opcode or pseudo-op). The classification is the honest
# one, not the hopeful one: anything the JS API has no surface for is
# UNREACHABLE even if the browser happens to do it under the hood — unless we
# can point at the specific automatic behaviour, in which case it is IMPLICIT.
WB_MAPPING: dict[str, tuple[str, str]] = {
    "advertising": (
        UNREACHABLE,
        "No raw advertisement access. requestDevice() filters match name/service "
        "only; manufacturer data and advertising interval are never exposed. "
        "(manufacturerData filters exist behind a flag and still do not surface "
        "the bytes.)",
    ),
    "connect": (
        REPRODUCIBLE,
        "device.gatt.connect() — but the connection parameters (interval, "
        "latency, supervision timeout) are chosen by the OS, not by us.",
    ),
    "link-setup": (
        IMPLICIT,
        "LE feature exchange / data-length extension / connection-parameter "
        "update are performed by the OS stack. Not observable or tunable from JS.",
    ),
    "mtu": (
        IMPLICIT,
        "Chrome/CoreBluetooth negotiate ATT MTU automatically on connect. No JS "
        "API to request a value or read the result; writes larger than the "
        "negotiated MTU simply fail.",
    ),
    "pairing": (
        UNREACHABLE,
        "Web Bluetooth cannot initiate pairing or bonding, set IO capabilities, "
        "or require encryption. If a characteristic demands authentication the "
        "OS may prompt — outside the page's control and not scriptable.",
    ),
    "discovery": (
        REPRODUCIBLE,
        "getPrimaryService(s)/getCharacteristic(s) — but only for UUIDs "
        "pre-declared in requestDevice's filters or optionalServices. Anything "
        "else throws SecurityError, so the app's discovery may legitimately be "
        "broader than ours.",
    ),
    "subscribe": (
        REPRODUCIBLE,
        "characteristic.startNotifications() writes the CCCD. Note it cannot "
        "choose notify-vs-indicate: the browser picks based on the "
        "characteristic's properties (indicate wins if both are present).",
    ),
    "handshake": (
        REPRODUCIBLE,
        "characteristic.writeValueWithoutResponse() / writeValueWithResponse() "
        "with the exact bytes, then read the reply from the subscribed "
        "characteristic's characteristicvaluechanged event.",
    ),
    "steady": (
        REPRODUCIBLE,
        "Incoming notifications arrive as events. Outgoing periodic writes are "
        "ordinary writes on a timer.",
    ),
    "teardown": (
        REPRODUCIBLE,
        "device.gatt.disconnect(); the gattserverdisconnected event reports the "
        "peer going away — but the ATT/HCI disconnect *reason code* is not "
        "exposed, so we cannot distinguish 'device slept' from 'link lost' from "
        "'peer rejected us'.",
    ),
}


def classify_phase(phase: Phase) -> tuple[str, str]:
    return WB_MAPPING.get(phase.value, (UNREACHABLE, "unclassified"))


# CCCD values, per Bluetooth Core Vol 3 Part G §3.3.3.3.
CCCD_NOTIFY = b"\x01\x00"
CCCD_INDICATE = b"\x02\x00"
CCCD_BOTH = b"\x03\x00"
CCCD_OFF = b"\x00\x00"

RIDEON = b"RideOn"


def _is_cccd_write(op: AttOp) -> bool:
    if op.opcode not in (0x12, 0x52):
        return False
    if op.value in (CCCD_NOTIFY, CCCD_INDICATE, CCCD_BOTH, CCCD_OFF):
        return True
    # Some stacks write the CCCD as a single byte.
    return len(op.value) == 1 and op.value[0] in (0x00, 0x01, 0x02, 0x03)


def _cccd_meaning(value: bytes) -> str:
    if value in (CCCD_NOTIFY,) or value == b"\x01":
        return "notify on"
    if value in (CCCD_INDICATE,) or value == b"\x02":
        return "indicate on"
    if value in (CCCD_BOTH,) or value == b"\x03":
        return "notify+indicate on"
    return "subscriptions off"


DISCOVERY_OPCODES = {0x04, 0x05, 0x08, 0x09, 0x10, 0x11, 0x06, 0x07}
READ_OPCODES = {0x0A, 0x0B, 0x0C, 0x0D, 0x0E, 0x0F}

# ATT is strictly serialised: one request outstanding at a time (Core Vol 3
# Part F §3.3.2). So a response always belongs to the phase of the request
# immediately before it — a Write Response to a CCCD write is part of
# `subscribe`, not a steady-state write. Classifying responses on their own
# opcode puts them in the wrong phase and corrupts the phase *ordering*, which
# is one of the things we are trying to measure.
RESPONSE_TO_REQUEST = {
    0x01: None,  # Error Response — pairs with whatever was outstanding
    0x03: 0x02,
    0x05: 0x04,
    0x07: 0x06,
    0x09: 0x08,
    0x0B: 0x0A,
    0x0D: 0x0C,
    0x0F: 0x0E,
    0x11: 0x10,
    0x13: 0x12,
    0x17: 0x16,
    0x19: 0x18,
    0x1E: 0x1D,  # Confirmation pairs with the Indication it acknowledges
}


class PhaseClassifier:
    """Stateful phase assignment: remembers the outstanding request.

    Stateful on purpose. A stateless classifier cannot know that a bare
    `Write Response` (which carries no handle and no value) was the answer to
    a CCCD write rather than to a control-point command.
    """

    def __init__(self) -> None:
        self._pending: Phase | None = None

    def classify(self, op: AttOp) -> Phase:
        if op.layer == "att" and op.opcode in RESPONSE_TO_REQUEST:
            if self._pending is not None:
                phase = self._pending
                self._pending = None
                return phase
        phase = phase_for(op)
        if op.layer == "att" and op.opcode in RESPONSE_TO_REQUEST.values():
            self._pending = phase
        elif op.layer == "att" and op.opcode == 0x1D:
            self._pending = phase
        return phase


def phase_for(op: AttOp) -> Phase:
    """Stateless phase assignment for a single operation.

    Use PhaseClassifier when processing a sequence — responses need context.
    """
    if op.layer == "smp":
        return Phase.PAIRING
    if op.layer == "hci":
        name = op.opcode_name
        info = op.info
        if "Disconnect" in name or "Disconnect" in info:
            return Phase.TEARDOWN
        if "Encryption" in name:
            return Phase.PAIRING
        if "Advertising Report" in info:
            return Phase.ADVERTISING
        if "Connection Complete" in info or "Create Connection" in info:
            return Phase.CONNECT
        if any(k in info for k in ("Data Length", "Read Remote Features", "Connection Update", "PHY")):
            return Phase.LINK_SETUP
        return Phase.UNKNOWN
    if op.layer != "att":
        return Phase.UNKNOWN
    if op.opcode in (0x02, 0x03):
        return Phase.MTU
    if op.opcode in DISCOVERY_OPCODES:
        return Phase.DISCOVERY
    if _is_cccd_write(op):
        return Phase.SUBSCRIBE
    if op.opcode in (0x12, 0x52, 0x13):
        # An app-level write. RideOn (or any write to a ZAP SYNC RX handle) is
        # the handshake; everything else is steady-state control traffic.
        if op.value.startswith(RIDEON):
            return Phase.HANDSHAKE
        return Phase.STEADY
    if op.opcode in (0x1B, 0x1D, 0x1E):
        if op.value.startswith(RIDEON):
            return Phase.HANDSHAKE
        return Phase.STEADY
    if op.opcode in READ_OPCODES:
        return Phase.DISCOVERY
    if op.opcode == 0x01:
        return Phase.UNKNOWN
    return Phase.UNKNOWN


def summarise(op: AttOp) -> tuple[str, str]:
    """(summary, detail) for one op. Detail carries the protobuf verdict."""
    if op.layer == "smp":
        return op.opcode_name, op.info
    if op.layer == "hci":
        return op.opcode_name, op.info
    name = op.opcode_name
    if op.opcode in (0x02, 0x03) and op.mtu:
        # The MTU lives in its own field, not btatt.value, so it would
        # otherwise render as a zero-length payload — and the negotiated MTU is
        # exactly one of the facts this whole exercise is trying to pin down.
        return name, f"MTU {op.mtu} bytes (max single write {op.mtu - 3})"
    if _is_cccd_write(op):
        return f"CCCD write ({_cccd_meaning(op.value)})", f"handle 0x{op.handle or 0:04x}"
    detail = ""
    if op.value:
        if op.value.startswith(RIDEON):
            tail = op.value[len(RIDEON) :]
            detail = (
                f'"RideOn" + {tail.hex() or "(nothing)"}'
                + (" — bare echo, no status bytes" if not tail else f" ({len(tail)} status bytes)")
            )
        else:
            verdict = pbinfer.classify(op.value)
            detail = verdict.describe()
    # Discovery responses carry their payload as structured records, not a
    # single value, so without the decoded gloss they render as empty lines and
    # the attribute table the app just read stays invisible.
    if not detail and op.gloss:
        detail = op.gloss
    return name, detail


def build(
    ops: list[AttOp],
    markers: list[Marker] | None = None,
    collapse_noise: bool = True,
) -> list[Step]:
    """Turn dissected ops into an ordered, phase-labelled, deduplicated list.

    ``collapse_noise`` merges consecutive identical steady-state frames into
    one step with a repeat count — without it, a 5-minute idle capture is
    300 lines of the same keepalive and the actual signal is invisible.
    """
    markers = markers or []
    steps: list[Step] = []
    classifier = PhaseClassifier()
    for op in ops:
        phase = classifier.classify(op)
        summary, detail = summarise(op)
        cls, wb = classify_phase(phase)
        m = attribute(markers, op.ts)
        step = Step(
            ts=op.ts,
            phase=phase,
            direction=op.direction,
            summary=summary,
            detail=detail,
            packet=op.number,
            value=op.value,
            handle=op.handle,
            uuid=op.uuid,
            marker=m.label if m else None,
            classification=cls,
            web_bluetooth=wb,
        )
        if (
            collapse_noise
            and steps
            and phase == Phase.STEADY
            and steps[-1].phase == Phase.STEADY
            and steps[-1].key == step.key
            and steps[-1].value == step.value
            and steps[-1].marker == step.marker
        ):
            steps[-1].repeat_count += 1
            continue
        steps.append(step)
    return steps


@dataclass
class PhaseSummary:
    phase: Phase
    first_ts: float
    last_ts: float
    step_count: int
    classification: str
    web_bluetooth: str
    notes: list[str] = field(default_factory=list)

    @property
    def duration(self) -> float:
        return self.last_ts - self.first_ts


def phase_summary(steps: list[Step]) -> list[PhaseSummary]:
    """Collapse steps into per-phase rows, preserving first-appearance order."""
    order: list[Phase] = []
    buckets: dict[Phase, list[Step]] = {}
    for s in steps:
        if s.phase not in buckets:
            buckets[s.phase] = []
            order.append(s.phase)
        buckets[s.phase].append(s)
    out = []
    for phase in order:
        group = buckets[phase]
        cls, wb = classify_phase(phase)
        out.append(
            PhaseSummary(
                phase=phase,
                first_ts=group[0].ts,
                last_ts=group[-1].ts,
                step_count=sum(s.repeat_count for s in group),
                classification=cls,
                web_bluetooth=wb,
            )
        )
    return out


def findings(steps: list[Step]) -> list[str]:
    """Assertions about the capture that bear directly on our connect() code.

    Each line is phrased as something you could act on, because a finding that
    does not change the code is not worth printing.
    """
    out: list[str] = []
    phases = [s.phase for s in steps]

    if Phase.PAIRING in phases:
        out.append(
            "PAIRING/ENCRYPTION observed. Web Bluetooth cannot initiate this — "
            "if the ZAP characteristics require it, browser-only is impossible "
            "and this is Tier 2 (Expo native BLE) evidence."
        )
    else:
        out.append(
            "No SMP pairing or encryption in this capture: the app reached the "
            "characteristics over an unencrypted link. Good news for "
            "browser-only — nothing here needs bonding."
        )

    mtu_steps = [s for s in steps if s.phase == Phase.MTU]
    if mtu_steps:
        out.append(
            f"ATT MTU exchanged ({len(mtu_steps)} PDU(s)). Browser does this for "
            "us but gives no API to read the result — keep every write under 20 "
            "bytes to stay safe on the default-23 MTU."
        )

    subs = [s for s in steps if s.phase == Phase.SUBSCRIBE and s.direction == "TX"]
    hs = [s for s in steps if s.phase == Phase.HANDSHAKE]
    if subs and hs:
        first_sub = min(s.ts for s in subs)
        first_hs = min(s.ts for s in hs)
        if first_sub < first_hs:
            out.append(
                f"ORDERING: all CCCD subscriptions preceded the handshake by "
                f"{first_hs - first_sub:.3f}s. Our connect() must subscribe first, "
                "then write — the documented order is confirmed by capture."
            )
        else:
            out.append(
                f"ORDERING: handshake was written {first_sub - first_hs:.3f}s BEFORE "
                "the first CCCD write. This contradicts PROTOCOLS.md §1.2 — "
                "re-check, and if it holds, our connect() order is wrong."
            )
    elif hs and not subs:
        out.append(
            "Handshake seen with no CCCD write in the capture — either the "
            "subscriptions predate the capture window, or the device was already "
            "bonded and the stack restored them."
        )

    echoes = [s for s in steps if s.phase == Phase.HANDSHAKE and s.direction == "RX"]
    for e in echoes:
        tail = e.value[len(RIDEON) :] if e.value.startswith(RIDEON) else b""
        if e.value.startswith(RIDEON):
            if not tail:
                out.append(
                    "Handshake reply was a BARE RideOn echo (no status bytes) — "
                    "matches our own experiments/03 observation and contradicts "
                    "the community-documented 'RideOn + 2 bytes'. Do not validate "
                    "the status bytes."
                )
            else:
                out.append(
                    f"Handshake reply carried {len(tail)} status byte(s): "
                    f"{tail.hex()}. Log but do not validate strictly."
                )

    teardown = [s for s in steps if s.phase == Phase.TEARDOWN]
    if teardown:
        reasons = {s.detail for s in teardown if s.detail}
        out.append(
            "Teardown observed: "
            + ("; ".join(sorted(reasons)) if reasons else "no reason recorded")
            + ". Web Bluetooth does not expose the disconnect reason code, so our "
            "app cannot distinguish these cases — plan reconnect policy "
            "accordingly."
        )

    ff_frames = [
        s
        for s in steps
        if s.value[:1] == b"\xff" and s.direction == "RX"
    ]
    if ff_frames:
        out.append(
            f"{len(ff_frames)} frame(s) in the 0xFF vendor family observed — this "
            "is the family associated with the Click v2 unlock/lock timer "
            "(HYPOTHESES H16). Check whether the official app WRITES any 0xFF "
            "frame; if it does and we do not, that write is the unlock we are "
            "missing."
        )

    ff_writes = [s for s in steps if s.value[:1] == b"\xff" and s.direction == "TX"]
    if ff_writes:
        out.append(
            "The app WROTE a 0xFF-family frame: "
            + ", ".join(sorted({s.value.hex() for s in ff_writes}))
            + ". This is the single most important byte sequence in the capture — "
            "it is a candidate for the vendor unlock our client never sends."
        )

    unknown = [s for s in steps if s.phase == Phase.UNKNOWN]
    if unknown:
        out.append(
            f"{len(unknown)} step(s) could not be assigned to a phase — inspect "
            "them manually rather than assuming they are noise."
        )
    return out
