"""Action markers and run manifests.

The point of markers: a packet capture alone cannot tell you which byte
sequence was the app reacting to *you pressing the shift paddle* versus
background chatter. capture.py prompts for each physical action and stamps a
precise timestamp; analyze.py then attributes packets to the action that
preceded them.

Timestamps are ``time.time()`` (Unix epoch, float seconds) so they share a
clock with both PacketLogger and btsnoop records without conversion.
"""

from __future__ import annotations

import json
import os
import platform
import subprocess
import time
from dataclasses import asdict, dataclass, field
from typing import Any


@dataclass
class Marker:
    ts: float
    label: str
    kind: str = "action"  # action | note | phase
    detail: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Manifest:
    """Everything needed to interpret a capture six months from now."""

    scenario: str
    started_at: float
    backend: str
    operator_notes: str = ""
    hardware: dict[str, str] = field(default_factory=dict)
    firmware: dict[str, str] = field(default_factory=dict)
    environment: dict[str, str] = field(default_factory=dict)
    software: dict[str, str] = field(default_factory=dict)
    markers: list[Marker] = field(default_factory=list)
    finished_at: float | None = None
    capture_files: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["markers"] = [m.to_dict() for m in self.markers]
        d["started_at_iso"] = iso(self.started_at)
        if self.finished_at:
            d["finished_at_iso"] = iso(self.finished_at)
        return d


def iso(ts: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(ts)) + f".{int((ts % 1) * 1000):03d}Z"


def host_environment() -> dict[str, str]:
    """Auto-captured context. Cheap to collect, expensive to reconstruct later."""
    env = {
        "platform": platform.platform(),
        "machine": platform.machine(),
        "python": platform.python_version(),
        "hostname": platform.node(),
        "tz": time.strftime("%Z%z"),
    }
    try:
        out = subprocess.run(
            ["tshark", "-v"], capture_output=True, text=True, timeout=10
        ).stdout
        env["tshark"] = out.splitlines()[0] if out else "(unknown)"
    except Exception:
        env["tshark"] = "(not found)"
    if platform.system() == "Darwin":
        try:
            env["macos_bt_firmware"] = _macos_bt_firmware()
        except Exception:
            pass
    return env


def _macos_bt_firmware() -> str:
    out = subprocess.run(
        ["system_profiler", "SPBluetoothDataType"],
        capture_output=True,
        text=True,
        timeout=30,
    ).stdout
    parts = []
    for line in out.splitlines():
        s = line.strip()
        if s.startswith(("Chipset:", "Firmware Version:", "Address:")):
            parts.append(s)
        if len(parts) >= 3:
            break
    return "; ".join(parts)


def write_manifest(path: str, manifest: Manifest) -> None:
    os.makedirs(os.path.dirname(os.path.abspath(path)) or ".", exist_ok=True)
    with open(path, "w") as fh:
        json.dump(manifest.to_dict(), fh, indent=2)
        fh.write("\n")


def read_manifest(path: str) -> dict[str, Any]:
    with open(path) as fh:
        return json.load(fh)


def read_markers(path: str) -> list[Marker]:
    """Load markers from either a manifest or a bare marker sidecar."""
    data = read_manifest(path)
    raw = data.get("markers", data if isinstance(data, list) else [])
    return [
        Marker(
            ts=float(m["ts"]),
            label=m.get("label", "?"),
            kind=m.get("kind", "action"),
            detail=m.get("detail", ""),
        )
        for m in raw
    ]


def attribute(markers: list[Marker], ts: float, window: float = 3.0) -> Marker | None:
    """Return the most recent marker at or before ``ts``, within ``window`` s.

    A window rather than "nearest marker" on purpose: attributing a packet to
    an action that happened 40 seconds earlier is worse than admitting the
    packet is unattributed.
    """
    best: Marker | None = None
    for m in markers:
        if m.ts <= ts and (best is None or m.ts > best.ts):
            best = m
    if best is None or ts - best.ts > window:
        return None
    return best
