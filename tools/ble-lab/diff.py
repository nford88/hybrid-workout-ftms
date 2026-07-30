#!/usr/bin/env python3
"""Align two or more runs and report what is stable versus what varies.

Two questions, answered separately because they have different answers:

**Step-level** — which whole steps appear in every run, and which only in some?
A step present in the official app's run and absent from ours is either a bug
in our connect() or a browser limitation. That is the centrepiece comparison.

**Byte-level** — for payloads that appear in the same step position across
runs, which byte offsets are identical and which change? Varying offsets are
candidate counters, sequence numbers, nonces, or device IDs, and the tool
guesses which by how they vary (monotonic ⇒ counter; different-per-device but
stable-within-run ⇒ ID; uniformly random ⇒ nonce).

    ./diff.py app.pklg ours.pklg --label app --label ours
    ./diff.py cold.pklg warm.pklg --label cold --label warm --phase-only
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from collections import Counter, defaultdict

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from blelab import dissect, filters, sources, timeline  # noqa: E402
from blelab.timeline import Phase, Step  # noqa: E402

log = logging.getLogger("diff")


def load_run(path: str, display_filter: str | None) -> list[Step]:
    ops = dissect.batch_file(path, display_filter)
    return timeline.build(ops, [], collapse_noise=True)


def phase_diff(runs: dict[str, list[Step]]) -> list[str]:
    labels = list(runs)
    lines = ["| Phase | " + " | ".join(labels) + " | verdict |",
             "|---|" + "---|" * (len(labels) + 1)]
    all_phases: list[Phase] = []
    for steps in runs.values():
        for s in steps:
            if s.phase not in all_phases:
                all_phases.append(s.phase)
    for phase in all_phases:
        counts = [sum(s.repeat_count for s in runs[l] if s.phase == phase) for l in labels]
        present = [c > 0 for c in counts]
        if all(present):
            verdict = "in all runs"
        elif not any(present):
            verdict = "in none"
        else:
            have = [l for l, p in zip(labels, present) if p]
            lack = [l for l, p in zip(labels, present) if not p]
            verdict = f"**only in {', '.join(have)}** (missing from {', '.join(lack)})"
        lines.append(f"| `{phase.value}` | " + " | ".join(str(c) for c in counts) + f" | {verdict} |")
    return lines


def step_diff(runs: dict[str, list[Step]]) -> list[str]:
    """Set-difference on step keys — the actionable comparison."""
    labels = list(runs)
    keysets = {l: {s.key for s in runs[l]} for l in labels}
    universe: list[str] = []
    for l in labels:
        for s in runs[l]:
            if s.key not in universe:
                universe.append(s.key)

    common = set.intersection(*keysets.values()) if keysets else set()
    lines = [f"**{len(common)} step kinds common to all runs.**", ""]

    unique_lines = []
    for l in labels:
        others = set.union(*[keysets[o] for o in labels if o != l]) if len(labels) > 1 else set()
        only = [k for k in universe if k in keysets[l] and k not in others]
        if only:
            unique_lines.append(f"- **only in `{l}`** ({len(only)}):")
            for k in only:
                example = next(s for s in runs[l] if s.key == k)
                unique_lines.append(
                    f"  - `{k}` — pkt {example.packet}, "
                    f"{len(example.value)}B `{example.value.hex(' ')[:60]}`"
                )
    if unique_lines:
        lines.append("### Steps present in some runs but not others")
        lines.append("")
        lines += unique_lines
    else:
        lines.append("_No step kind is unique to any single run._")
    return lines


def byte_diff(runs: dict[str, list[Step]], min_runs: int = 2) -> list[str]:
    """Per-step-key byte stability across runs."""
    labels = list(runs)
    by_key: dict[str, dict[str, list[bytes]]] = defaultdict(lambda: defaultdict(list))
    for l in labels:
        for s in runs[l]:
            if s.value:
                by_key[s.key][l].append(s.value)

    lines: list[str] = []
    for key, per_run in sorted(by_key.items()):
        if len(per_run) < min_runs:
            continue
        # Compare the first occurrence in each run: that is the same position
        # in the sequence, which is what makes the comparison meaningful.
        firsts = {l: v[0] for l, v in per_run.items()}
        lengths = {len(v) for v in firsts.values()}
        if len(lengths) > 1:
            lines.append(
                f"- `{key}`: **length varies** "
                + ", ".join(f"{l}={len(v)}B" for l, v in firsts.items())
            )
            continue
        length = lengths.pop()
        stable, varying = [], []
        for off in range(length):
            vals = {v[off] for v in firsts.values()}
            (stable if len(vals) == 1 else varying).append(off)
        if not varying:
            lines.append(f"- `{key}`: **byte-identical** across all runs ({length}B)")
            continue
        lines.append(
            f"- `{key}`: {len(stable)}/{length} bytes stable; "
            f"varying at offsets {_ranges(varying)}"
        )
        for l, v in firsts.items():
            marked = " ".join(
                (f"[{v[o]:02x}]" if o in varying else f"{v[o]:02x}") for o in range(length)
            )
            lines.append(f"  - `{l}`: {marked}")
        lines.append(f"  - {_guess(firsts, varying)}")
    if not lines:
        lines.append("_No step key appears with a payload in enough runs to compare._")
    return lines


def _ranges(offsets: list[int]) -> str:
    if not offsets:
        return "-"
    out, start, prev = [], offsets[0], offsets[0]
    for o in offsets[1:]:
        if o == prev + 1:
            prev = o
            continue
        out.append(f"{start}" if start == prev else f"{start}-{prev}")
        start = prev = o
    out.append(f"{start}" if start == prev else f"{start}-{prev}")
    return ",".join(out)


def _guess(firsts: dict[str, bytes], varying: list[int]) -> str:
    """Classify a varying field. Deliberately conservative wording."""
    if not varying:
        return ""
    span = max(varying) - min(varying) + 1
    values = [int.from_bytes(bytes(v[o] for o in varying), "little") for v in firsts.values()]
    distinct = len(set(values))
    if distinct == 1:
        return "candidate: not actually varying once read as one field"
    if span == 1:
        return "candidate: 1-byte counter, flag, or status code"
    if sorted(values) == values or sorted(values, reverse=True) == values:
        return f"candidate: **monotonic counter / sequence number** ({span} bytes)"
    high_entropy = all(len(set(bytes(v[o] for o in varying))) > span * 0.7 for v in firsts.values())
    if high_entropy and span >= 8:
        return f"candidate: **nonce / key material / random** ({span} bytes)"
    if span in (6, 12, 16):
        return f"candidate: **device address or identifier** ({span} bytes)"
    return f"candidate: session-varying field ({span} bytes) — needs a third run to classify"


def ordering_diff(runs: dict[str, list[Step]]) -> list[str]:
    """Compare phase *order*, not just presence — ordering is a constraint."""
    lines = []
    for label, steps in runs.items():
        seq: list[str] = []
        for s in steps:
            if not seq or seq[-1] != s.phase.value:
                seq.append(s.phase.value)
        lines.append(f"- `{label}`: " + " → ".join(seq))
    orders = {tuple(l.split(" → ")) for l in [x.split(": ", 1)[1] for x in lines]}
    if len(orders) == 1:
        lines.append("")
        lines.append("**Phase order is identical across all runs.**")
    else:
        lines.append("")
        lines.append(
            "**Phase order DIFFERS between runs.** Ordering is a real protocol "
            "constraint here (the handshake reply is an indication, so the CCCD "
            "write must come first) — treat any reordering as a finding, not noise."
        )
    return lines


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("files", nargs="+", help="two or more capture files")
    p.add_argument(
        "--label",
        action="append",
        default=[],
        help="label for each file, in order (default: basename)",
    )
    p.add_argument("--filter", help="tshark display filter applied to every run")
    p.add_argument("--device", help="restrict to one peer Bluetooth address (AA:BB:CC:DD:EE:FF)")
    p.add_argument("--handle", type=lambda v: int(v, 0), help="restrict to one ACL connection handle")
    p.add_argument("--filter-uuid", help="restrict to a UUID group: 'zap', 'ftms', or a literal UUID")
    p.add_argument("--preset", choices=sorted(filters.PRESETS), help="display-filter preset")
    p.add_argument("--phase-only", action="store_true", help="skip the byte-level diff")
    p.add_argument("--report", help="write markdown here instead of stdout")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )

    if len(args.files) < 2:
        print("error: need at least two capture files to diff", file=sys.stderr)
        return 2

    labels = args.label or []
    while len(labels) < len(args.files):
        labels.append(os.path.basename(args.files[len(labels)]).rsplit(".", 1)[0])

    display_filter = filters.build(
        preset=args.preset, device=args.device, uuid=args.filter_uuid,
        handle=args.handle, extra=args.filter,
    )
    if display_filter:
        log.info("display filter: %s", display_filter)

    runs: dict[str, list[Step]] = {}
    for label, path in zip(labels, args.files):
        try:
            runs[label] = load_run(path, display_filter)
        except (sources.SourceError, dissect.TsharkError, OSError, ValueError) as exc:
            print(f"error reading {path}: {exc}", file=sys.stderr)
            return 2
        log.info("%s: %d steps", label, len(runs[label]))

    out: list[str] = []
    a = out.append
    a("# Run diff: " + ", ".join(f"`{l}`" for l in labels))
    a("")
    for label, path in zip(labels, args.files):
        a(f"- `{label}` = `{path}` ({len(runs[label])} steps)")
    a("")
    a("## Phase presence")
    a("")
    out += phase_diff(runs)
    a("")
    a("## Phase ordering")
    a("")
    out += ordering_diff(runs)
    a("")
    a("## Step-level differences")
    a("")
    out += step_diff(runs)
    a("")
    if not args.phase_only:
        a("## Byte-level stability")
        a("")
        a("_Offsets in `[brackets]` differ between runs._")
        a("")
        out += byte_diff(runs)
        a("")

    text = "\n".join(out)
    if args.report:
        os.makedirs(os.path.dirname(os.path.abspath(args.report)) or ".", exist_ok=True)
        with open(args.report, "w") as fh:
            fh.write(text + "\n")
        print(f"wrote {args.report}", file=sys.stderr)
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
