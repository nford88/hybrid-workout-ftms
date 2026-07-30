"""Turn an Android bugreport's own logs into capture markers.

The Android capture route has no `capture.py` operator sitting at a keyboard pressing
enter, so its packets would be unattributed — except that the phone narrates itself.
A bugreport carries logcat next to the snoop log, and logcat records exactly the events
we would otherwise ask an operator to mark: when the screen went on and off, when each
device connected and disconnected, and by name.

That is strictly better than hand-recorded markers: it is timestamped by the same clock
as the rest of the phone, it cannot drift, and it is already there in captures taken
before anyone thought to mark them.

Two things it caught on the first capture it was written for (2026-07-29, `experiments/15`):

- the phone's 30-second screen timeout fired **mid-session**, 47.5 s before the link
  dropped — a confound nobody had considered, invisible in the BLE trace alone;
- the snoop log's timestamps are **exactly one hour off** the phone's wall clock, because
  Android wrote local time and tshark reads btsnoop as UTC. `time_offset()` below measures
  that offset from the data instead of assuming it, so correlation cannot be silently wrong.
"""

from __future__ import annotations

import logging
import os
import re
from dataclasses import dataclass
from datetime import datetime

log = logging.getLogger("blelab.androidlog")

# logcat's default format: "MM-DD HH:MM:SS.mmm  pid  tid  prio TAG: message".
# Leading whitespace is allowed because the bugreport's event-log sections are indented,
# and that is exactly where the BLUETOOTH_DEVICE_EVENT lines live — anchoring hard at the
# start of the line silently loses every connect/disconnect marker.
LOGCAT_TS = re.compile(r"^\s*(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{3})\s")

# Samsung/AOSP event-log line for a GATT connect/disconnect, with the device named.
# "BLUETOOTH_DEVICE_EVENT 1 deviceAddress=F4:.., deviceName=Zwift Click"  (1=up, 2=down)
BT_DEVICE_EVENT = re.compile(
    r"BLUETOOTH_DEVICE_EVENT (\d+) deviceAddress=([0-9A-Fa-f:]{17}), deviceName=(.*?)\s*$"
)

SCREEN_MARKERS = (
    # (regex, label, kind)
    (re.compile(r"Going to sleep due to (\w+)"), "screen OFF", "environment"),
    (re.compile(r"Waking up power group from \w+ \(.*?reason=(\w+)"), "screen ON", "environment"),
    (re.compile(r"setActualDisplayState: \w+ -> (OFF)\b"), "display OFF", "environment"),
)

DEVICE_EVENT_NAMES = {1: "CONNECTED", 2: "DISCONNECTED"}


@dataclass
class LogMarker:
    ts: float  # unix seconds, phone wall clock
    label: str
    kind: str  # 'action' | 'environment'
    detail: str = ""

    def as_manifest_marker(self) -> dict:
        return {"ts": self.ts, "label": self.label, "kind": self.kind, "detail": self.detail}


# LIVE logcat does NOT carry BLUETOOTH_DEVICE_EVENT — that line only exists in a
# bugreport's event-log section. Live, a connect looks like two lines from
# BluetoothDeviceBatteryManager, with unrelated lines interleaved between them:
#   I/BluetoothDeviceBatteryManager: action: android.bluetooth.device.action.ACL_CONNECTED
#   I/BluetoothDeviceBatteryManager: # Alias(Zwift Click) / Address(F4C459_1)
# The address is redacted to OUI + '_' + final hex digit, so matching has to allow for that.
ACL_ACTION = re.compile(r"android\.bluetooth\.device\.action\.ACL_(CONNECTED|DISCONNECTED)\s*$")
ACL_ALIAS = re.compile(r"#\s*Alias\((.*?)\)\s*/\s*Address\(([0-9A-Fa-f]{6}_[0-9A-Fa-f])\)")


def redact(address: str) -> str:
    """Full BLE address -> the redacted form Android logs live ('F4C459_1').

    Lets `--expect f4:c4:59:81:d9:a1` match a log line that never prints the middle bytes.
    """
    flat = address.replace(":", "").replace("-", "").upper()
    if len(flat) < 12:
        return flat
    return f"{flat[:6]}_{flat[-1]}"


class AclWatcher:
    """Stateful pairing of a live ACL action line with the Alias line that names it.

    Stateful because the two lines are not adjacent — the system log interleaves other
    tags between them — so a per-line parser cannot join them.
    """

    def __init__(self, max_gap: float = 3.0):
        self.max_gap = max_gap
        self._pending: tuple[float, str] | None = None

    def feed(self, line: str, year: int) -> LogMarker | None:
        ts = _ts(line, year)
        m = ACL_ACTION.search(line)
        if m:
            self._pending = (ts if ts is not None else 0.0, m.group(1))
            return None
        m = ACL_ALIAS.search(line)
        if m and self._pending:
            pend_ts, action = self._pending
            if ts is not None and pend_ts and abs(ts - pend_ts) > self.max_gap:
                self._pending = None
                return None
            self._pending = None
            name, addr = m.group(1).strip(), m.group(2).upper()
            return LogMarker(
                ts=pend_ts or (ts or 0.0),
                label=f"{name or 'device'} {action}",
                kind="action",
                detail=f"address {addr}",
            )
        return None


def _ts(line: str, year: int) -> float | None:
    m = LOGCAT_TS.match(line)
    if not m:
        return None
    mo, d, h, mi, s, ms = (int(x) for x in m.groups())
    try:
        return datetime(year, mo, d, h, mi, s, ms * 1000).timestamp()
    except ValueError:
        return None


def parse_lines(lines, year: int) -> list[LogMarker]:
    """Extract markers from logcat lines. Pure — no filesystem, no adb."""
    out: list[LogMarker] = []
    for line in lines:
        ts = _ts(line, year)
        if ts is None:
            continue
        m = BT_DEVICE_EVENT.search(line)
        if m:
            code, addr, name = int(m.group(1)), m.group(2), m.group(3)
            out.append(LogMarker(
                ts=ts,
                label=f"{name or 'device'} {DEVICE_EVENT_NAMES.get(code, f'event {code}')}",
                kind="action",
                detail=f"address {addr.lower()}",
            ))
            continue
        for pattern, label, kind in SCREEN_MARKERS:
            m = pattern.search(line)
            if m:
                # Collapse the DOZE/DOZE_SUSPEND flicker of always-on-display: only the
                # real transitions are interesting, and they are already covered by the
                # PowerManagerService lines.
                if label == "display OFF" and any(
                    x.label in ("screen OFF", "display OFF") and abs(x.ts - ts) < 5 for x in out
                ):
                    break
                out.append(LogMarker(ts=ts, label=label, kind=kind, detail=m.group(1)))
                break
    out.sort(key=lambda m: m.ts)
    return out


def dedupe(markers: list[LogMarker], window: float = 1.0) -> list[LogMarker]:
    """Drop repeats of the same label within `window` seconds."""
    kept: list[LogMarker] = []
    for m in markers:
        if any(k.label == m.label and abs(k.ts - m.ts) < window for k in kept):
            continue
        kept.append(m)
    return kept


def find_bugreport_parts(root: str) -> tuple[str | None, str | None]:
    """(btsnoop path, dumpstate path) inside an extracted bugreport directory.

    The snoop log lives at `FS/data/log/bt/btsnoop_hci.log` — NOT the
    `FS/data/misc/bluetooth/logs/` that every guide cites.
    """
    snoop = os.path.join(root, "FS", "data", "log", "bt", "btsnoop_hci.log")
    if not os.path.exists(snoop):
        snoop = None
        for dirpath, _dirs, files in os.walk(root):
            for f in files:
                if f.startswith("btsnoop_hci") and not f.endswith(".last"):
                    snoop = os.path.join(dirpath, f)
                    break
            if snoop:
                break
    dumpstate = None
    for f in sorted(os.listdir(root)) if os.path.isdir(root) else []:
        if f.startswith("dumpstate-") and f.endswith(".txt"):
            dumpstate = os.path.join(root, f)
            break
    return snoop, dumpstate


def read_markers(dumpstate_path: str, year: int | None = None) -> list[LogMarker]:
    """Stream a (very large) dumpstate file and pull markers out of it.

    Bugreport dumpstate files run to hundreds of MB, so this never slurps.
    """
    if year is None:
        m = re.search(r"dumpstate-(\d{4})-", os.path.basename(dumpstate_path))
        year = int(m.group(1)) if m else datetime.now().year
    markers: list[LogMarker] = []
    with open(dumpstate_path, "r", errors="replace") as fh:
        for chunk in _chunks(fh):
            markers += parse_lines(chunk, year)
    # Sort globally, not per chunk: a bugreport keeps its event log in a different section
    # from logcat, so chunk order is not time order.
    markers.sort(key=lambda m: m.ts)
    return dedupe(markers)


def _chunks(fh, size: int = 20000):
    buf: list[str] = []
    for line in fh:
        buf.append(line)
        if len(buf) >= size:
            yield buf
            buf = []
    if buf:
        yield buf


def time_offset(capture_epochs: list[float], markers: list[LogMarker]) -> float:
    """Seconds to ADD to logcat times to land on the capture's timescale.

    Measured, not assumed. Android writes btsnoop timestamps in local time while tshark
    reads btsnoop as UTC, so on the 2026-07-29 phone the capture reads exactly +1 h from
    logcat — but that depends on the phone's zone and on DST, and guessing it wrong ruins
    every correlation *silently*, which is the worst way to be wrong.

    The error can only ever be a whole number of hours, so we simply try each candidate and
    keep the one that lands the most markers inside the capture's own time span. That needs
    no assumption about which marker corresponds to what, and it self-checks: if no shift
    puts any marker inside the capture, we return 0 and say so rather than inventing one.
    """
    if not capture_epochs or not markers:
        return 0.0
    start, end = min(capture_epochs), max(capture_epochs)
    best_hours, best_score = 0, -1
    for hours in range(-14, 15):
        shift = hours * 3600
        score = sum(1 for m in markers if start <= m.ts + shift <= end)
        # Ties go to the smaller shift: 0 wins over 12 h when both explain the data.
        if score > best_score or (score == best_score and abs(hours) < abs(best_hours)):
            best_hours, best_score = hours, score
    if best_score <= 0:
        log.warning(
            "no whole-hour shift places any of the %d marker(s) inside the capture's span — "
            "the phone's logs and the snoop log do not overlap, so markers are NOT correlated",
            len(markers),
        )
        return 0.0
    if best_hours:
        log.info(
            "capture timestamps run %+d h from logcat (%d/%d markers land inside the "
            "capture); correcting", best_hours, best_score, len(markers),
        )
    return best_hours * 3600.0
