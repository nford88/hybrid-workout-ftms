"""Human-readable rendering, optimised for reading live at the bike.

Design constraints that drove this, in priority order:
1. One line per operation, columns aligned, so the eye can scan down a column
   rather than re-parsing each line.
2. Direction must be visible peripherally — an arrow glyph, not a word.
3. Repeated keepalives collapse into a counter, because 300 identical lines
   hide the one line that matters.
4. Delta-time from the previous line, because ordering *and interval* are both
   findings (is that keepalive 1 Hz or 5 Hz?).
"""

from __future__ import annotations

import sys
import time

from . import pbinfer, uuids
from .dissect import AttOp
from .timeline import Phase, PhaseClassifier, Step, summarise

# Direction glyphs: TX is us->device, RX is device->us.
TX = "──>"
RX = "<──"

ANSI = {
    "reset": "\x1b[0m",
    "dim": "\x1b[2m",
    "bold": "\x1b[1m",
    "red": "\x1b[31m",
    "green": "\x1b[32m",
    "yellow": "\x1b[33m",
    "blue": "\x1b[34m",
    "magenta": "\x1b[35m",
    "cyan": "\x1b[36m",
}

PHASE_COLOR = {
    Phase.ADVERTISING: "dim",
    Phase.CONNECT: "green",
    Phase.LINK_SETUP: "dim",
    Phase.MTU: "cyan",
    Phase.PAIRING: "red",
    Phase.DISCOVERY: "dim",
    Phase.SUBSCRIBE: "blue",
    Phase.HANDSHAKE: "magenta",
    Phase.STEADY: "reset",
    Phase.TEARDOWN: "yellow",
    Phase.UNKNOWN: "yellow",
}


def supports_color(stream=sys.stdout) -> bool:
    return hasattr(stream, "isatty") and stream.isatty()


def paint(text: str, color: str, enabled: bool) -> str:
    if not enabled or color == "reset":
        return text
    return f"{ANSI.get(color, '')}{text}{ANSI['reset']}"


def ascii_gloss(data: bytes, width: int = 16) -> str:
    """Printable-ASCII view. Catches embedded strings like 'RideOn' and the
    device serial the 0xFF frames carry."""
    if not data:
        return ""
    chars = "".join(chr(b) if 0x20 <= b < 0x7F else "." for b in data[:width])
    return chars


def hex_preview(data: bytes, width: int = 20) -> str:
    if not data:
        return ""
    shown = data[:width]
    s = shown.hex(" ")
    return s + (f" +{len(data) - width}B" if len(data) > width else "")


HEADER = (
    f"{'time':>9} {'Δt':>7} {'dir':^3} {'phase':<11} {'uuid':<8} "
    f"{'op':<26} {'len':>4} hex / gloss"
)


class LiveRenderer:
    """Stateful because collapsing repeats and Δt both need the previous line."""

    def __init__(self, color: bool | None = None, collapse: bool = True, t0: float | None = None):
        self.color = supports_color() if color is None else color
        self.collapse = collapse
        self.t0 = t0
        self._prev_ts: float | None = None
        self._last_key: str | None = None
        self._repeat = 0
        self._repeat_line = ""
        self.counts: dict[str, int] = {}
        # Same classifier the offline timeline uses, so the live view and the
        # report never disagree about which phase an operation belongs to.
        self._classifier = PhaseClassifier()

    def _flush_repeat(self) -> None:
        if self._repeat > 1:
            note = paint(f"    ⤶ (×{self._repeat} identical)", "dim", self.color)
            print(note, flush=True)
        self._repeat = 0

    def header(self) -> None:
        print(paint(HEADER, "bold", self.color), flush=True)
        print(paint("─" * len(HEADER), "dim", self.color), flush=True)

    def marker(self, label: str, detail: str = "") -> None:
        self._flush_repeat()
        self._last_key = None
        text = f"◆ ACTION: {label}" + (f" — {detail}" if detail else "")
        print(paint(text, "bold", self.color), flush=True)

    def op(self, op: AttOp) -> None:
        if self.t0 is None:
            self.t0 = op.ts
        phase = self._classifier.classify(op)
        summary, detail = summarise(op)
        key = f"{op.direction}|{phase.value}|{summary}|{op.handle}|{op.value.hex()}"

        if self.collapse and key == self._last_key and phase == Phase.STEADY:
            self._repeat += 1
            return
        self._flush_repeat()
        self._last_key = key
        self._repeat = 1

        rel = op.ts - self.t0
        dt = (op.ts - self._prev_ts) if self._prev_ts is not None else 0.0
        self._prev_ts = op.ts
        self.counts[summary] = self.counts.get(summary, 0) + 1

        glyph = TX if op.sent else RX
        uuid_col = uuids.short(op.uuid) if op.uuid else (
            f"h{op.handle:04x}" if op.handle is not None else "-"
        )
        line = (
            f"{rel:9.3f} {dt:7.3f} {glyph:^3} "
            f"{phase.value:<11} {uuid_col:<8} {summary[:26]:<26} "
            f"{len(op.value):>4} {hex_preview(op.value)}"
        )
        gloss = ascii_gloss(op.value)
        if gloss and any(0x20 <= b < 0x7F for b in op.value):
            line += f"  |{gloss}|"
        print(paint(line, PHASE_COLOR.get(phase, "reset"), self.color), flush=True)
        if detail:
            print(paint(f"{'':>21}↳ {detail[:150]}", "dim", self.color), flush=True)

    def finish(self) -> None:
        self._flush_repeat()
        if not self.counts:
            print("\n(no operations seen)", flush=True)
            return
        print(paint("\n── operation counts ──", "bold", self.color), flush=True)
        for name, n in sorted(self.counts.items(), key=lambda kv: -kv[1]):
            print(f"  {n:>5}  {name}", flush=True)


def render_steps(steps: list[Step], color: bool | None = None, show_wb: bool = False) -> str:
    """Static rendering of an analysed timeline (used by analyze.py)."""
    use_color = supports_color() if color is None else color
    if not steps:
        return "(no steps)"
    t0 = steps[0].ts
    lines = [paint(HEADER, "bold", use_color), paint("─" * len(HEADER), "dim", use_color)]
    prev = None
    current_phase = None
    for s in steps:
        if s.phase != current_phase:
            current_phase = s.phase
            cls = f"[{s.classification}]"
            lines.append(
                paint(
                    f"\n══ {s.phase.value.upper()} {cls}",
                    PHASE_COLOR.get(s.phase, "reset"),
                    use_color,
                )
            )
            if show_wb and s.web_bluetooth:
                for chunk in _wrap(s.web_bluetooth, 92):
                    lines.append(paint(f"   {chunk}", "dim", use_color))
        rel = s.ts - t0
        dt = (s.ts - prev) if prev is not None else 0.0
        prev = s.ts
        glyph = TX if s.direction == "TX" else RX
        uuid_col = uuids.short(s.uuid) if s.uuid else (
            f"h{s.handle:04x}" if s.handle is not None else "-"
        )
        rep = f" ×{s.repeat_count}" if s.repeat_count > 1 else ""
        marker = f"  ◆{s.marker}" if s.marker else ""
        lines.append(
            f"{rel:9.3f} {dt:7.3f} {glyph:^3} {'':<11} {uuid_col:<8} "
            f"{(s.summary + rep)[:26]:<26} {len(s.value):>4} {hex_preview(s.value)}{marker}"
        )
        if s.detail:
            lines.append(paint(f"{'':>21}↳ {s.detail[:150]}", "dim", use_color))
    return "\n".join(lines)


def _wrap(text: str, width: int) -> list[str]:
    words = text.split()
    out: list[str] = []
    line = ""
    for w in words:
        if len(line) + len(w) + 1 > width:
            out.append(line)
            line = w
        else:
            line = f"{line} {w}".strip()
    if line:
        out.append(line)
    return out


def hexdump(data: bytes, indent: str = "  ") -> str:
    out = []
    for off in range(0, len(data), 16):
        chunk = data[off : off + 16]
        out.append(f"{indent}{off:04x}  {chunk.hex(' '):<47}  |{ascii_gloss(chunk)}|")
    return "\n".join(out)


def describe_payload(data: bytes) -> str:
    """Full multi-line explanation of one payload, for analyze/diff reports."""
    if not data:
        return "(empty)"
    lines = [hexdump(data)]
    verdict = pbinfer.classify(data)
    lines.append(f"  protobuf: {verdict.mode} — {verdict.note}")
    if verdict.message and verdict.message.valid:
        lines.append(f"  fields:   {verdict.message.describe()}")
    return "\n".join(lines)


def now_stamp() -> str:
    return time.strftime("%Y%m%d-%H%M%S")
