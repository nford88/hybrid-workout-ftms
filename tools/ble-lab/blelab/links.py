"""Per-link lifetime and teardown reason, from HCI connection events.

This exists because of a blind spot that cost us a real finding. `analyze.py`'s
`--device` filter builds an ACL-address display filter, and HCI *events* carry
no ACL address, so filtering to one device silently drops every
Connection/Disconnection Complete. The report then shows no teardown phase at
all and cannot say how long the link lasted or why it ended — which is the
central question of the virtual-shifting connection work (does the Click drop
us at ~90 s, and who hangs up?).

So link sessions are always computed from an UNFILTERED pass, and matched to a
device afterwards by the address in the connection-complete event.

The reason code is the part Web Bluetooth can never see: `gattserverdisconnected`
fires with no reason, so 'the device slept', 'we hung up' and 'the link was
lost' are indistinguishable from JS. In a capture they are three different
numbers, and telling them apart is the whole point.
"""

from __future__ import annotations

import logging
import subprocess
from dataclasses import dataclass

from .dissect import _env, tshark_path

log = logging.getLogger("blelab.links")

# HCI error codes, Core v5.x Vol 4 Part E §1.3 — only those a BLE link
# realistically ends with.
HCI_REASONS = {
    0x02: "Unknown Connection Identifier",
    0x05: "Authentication Failure",
    0x08: "Connection Timeout",
    0x13: "Remote User Terminated Connection",
    0x14: "Remote Device Terminated (Low Resources)",
    0x15: "Remote Device Terminated (Power Off)",
    0x16: "Connection Terminated By Local Host",
    0x1A: "Unsupported Remote Feature",
    0x22: "LL Response Timeout",
    0x28: "Instant Passed",
    0x3B: "Unacceptable Connection Parameters",
    0x3D: "Connection Terminated due to MIC Failure",
    0x3E: "Connection Failed to be Established",
}

# Who ended the link. The distinction that matters: a supervision timeout means
# the peer stopped answering (it slept or walked away) without saying goodbye,
# whereas 0x13/0x15 mean it chose to hang up, and 0x16 means we did.
LINK_LOSS = "peer stopped responding (supervision timeout)"
PEER_HUNG_UP = "peer terminated deliberately"
WE_HUNG_UP = "local host terminated"
NEVER_UP = "connection never established"

REASON_ACTOR = {
    0x08: LINK_LOSS,
    0x22: LINK_LOSS,
    0x3E: NEVER_UP,
    0x13: PEER_HUNG_UP,
    0x14: PEER_HUNG_UP,
    0x15: PEER_HUNG_UP,
    0x16: WE_HUNG_UP,
}


@dataclass
class LinkSession:
    handle: int
    address: str | None
    opened_at: float | None
    closed_at: float | None
    reason: int | None = None
    open_packet: int = 0
    close_packet: int = 0

    @property
    def duration(self) -> float | None:
        if self.opened_at is None or self.closed_at is None:
            return None
        return self.closed_at - self.opened_at

    @property
    def reason_name(self) -> str:
        if self.reason is None:
            return "still up at end of capture"
        return HCI_REASONS.get(self.reason, f"reason 0x{self.reason:02x}")

    @property
    def actor(self) -> str:
        if self.reason is None:
            return "n/a — link outlived the capture"
        return REASON_ACTOR.get(self.reason, "unclassified reason code")

    def describe(self) -> str:
        dur = f"{self.duration:.1f}s" if self.duration is not None else "?"
        who = f"0x{self.handle:04x}" + (f" {self.address}" if self.address else "")
        if self.reason is None:
            when = f"+{self.opened_at:.1f}s" if self.opened_at is not None else "before the capture"
            return f"{who}: came up at {when}, still up when the capture ended"
        return (
            f"{who}: {dur}, ended {self.reason_name} "
            f"(0x{self.reason:02x}) — {self.actor}"
        )


EVENT_FIELDS = (
    "frame.number",
    "frame.time_relative",
    "bthci_evt.code",
    "bthci_evt.le_meta_subevent",
    "bthci_evt.bd_addr",
    "bthci_evt.connection_handle",
    "bthci_evt.reason",
)


def _first(value: str) -> str:
    return value.split(",")[0].strip() if value else ""


def _to_int(value: str) -> int | None:
    v = _first(value)
    if not v:
        return None
    try:
        return int(v, 16) if v.lower().startswith("0x") else int(v)
    except ValueError:
        return None


def parse_rows(rows: list[list[str]]) -> list[LinkSession]:
    """Build link sessions from tshark event rows. Pure — testable without tshark.

    Rows are (frame, rel_time, evt_code, le_subevent, bd_addr, conn_handle,
    reason) as strings, in capture order.
    """
    open_by_handle: dict[int, LinkSession] = {}
    sessions: list[LinkSession] = []
    for row in rows:
        row = (row + [""] * len(EVENT_FIELDS))[: len(EVENT_FIELDS)]
        num, ts_s, code_s, sub_s, addr_s, handle_s, reason_s = row
        try:
            ts = float(ts_s) if ts_s else 0.0
        except ValueError:
            ts = 0.0
        code = _to_int(code_s)
        sub = _to_int(sub_s)
        handle = _to_int(handle_s)
        addr = _first(addr_s) or None
        packet = _to_int(num) or 0

        # LE Connection Complete (0x01) / LE Enhanced Connection Complete (0x0a).
        # Handle 0 with an all-zero address is another subevent whose fields
        # happen to collide in tshark's flat output — ignore those.
        if code == 0x3E and sub in (0x01, 0x0A):
            if not handle or not addr or addr == "00:00:00:00:00:00":
                continue
            session = LinkSession(
                handle=handle, address=addr, opened_at=ts, closed_at=None,
                open_packet=packet,
            )
            open_by_handle[handle] = session
            sessions.append(session)
        elif code == 0x05 and handle is not None:
            session = open_by_handle.pop(handle, None)
            if session is None:
                # Link was already up when the capture started.
                session = LinkSession(
                    handle=handle, address=None, opened_at=None, closed_at=ts,
                )
                sessions.append(session)
            session.closed_at = ts
            session.reason = _to_int(reason_s)
            session.close_packet = packet
    return sessions


def sessions(path: str) -> list[LinkSession]:
    """Read a capture file and return its link sessions.

    Deliberately runs with NO display filter: an address filter would exclude
    the very HCI events this reads.
    """
    cmd = [tshark_path(), "-r", path, "-n", "-T", "fields", "-E", "separator=/t",
           "-Y", "bthci_evt.code==0x05 || bthci_evt.code==0x3e"]
    for f in EVENT_FIELDS:
        cmd += ["-e", f]
    proc = subprocess.run(cmd, capture_output=True, env=_env())
    if proc.returncode != 0:
        log.warning("tshark could not read events from %s", path)
        return []
    rows = [
        line.split("\t")
        for line in proc.stdout.decode("utf-8", "replace").splitlines()
        if line.strip()
    ]
    return parse_rows(rows)


def for_device(all_sessions: list[LinkSession], address: str | None) -> list[LinkSession]:
    if not address:
        return all_sessions
    want = address.lower()
    return [s for s in all_sessions if (s.address or "").lower() == want]
