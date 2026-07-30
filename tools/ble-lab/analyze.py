#!/usr/bin/env python3
"""Offline pass: reconstruct the connection as an ordered state machine.

Produces, in order:
  1. the phase table — advertisement -> connect -> MTU -> discovery ->
     pairing -> CCCD subscriptions -> handshake -> steady state -> teardown,
     each row classified reproducible / implicit / unreachable for Web Bluetooth
  2. link sessions — how long each link lasted and which side ended it, with the
     HCI reason code (the one fact Web Bluetooth can never observe)
  3. the full step list, with packet numbers and marker attribution
  4. protobuf inference on every distinct payload
  5. findings — assertions phrased as changes to our connect() code

Every claim carries a packet number so it can be re-checked against the pcap.

    ./analyze.py --file cap.pklg --manifest run.manifest.json
    ./analyze.py --file cap.pklg --report ../../docs/.../experiments/NN-x.md
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from blelab import dissect, filters, links, pbinfer, render, sources, timeline, uuids  # noqa: E402
from blelab.markers import Marker, iso, read_manifest, read_markers  # noqa: E402
from blelab.timeline import IMPLICIT, REPRODUCIBLE, UNREACHABLE, Phase  # noqa: E402

log = logging.getLogger("analyze")


def _diagnose_empty(path: str) -> str:
    """Say *why* a capture yielded nothing. The macOS failure mode is specific
    and worth naming: a second packetlogger instance cannot get the HCI tap, so
    it produces a file containing one 'Disconnected from OS X Device' note and
    no packets at all."""
    try:
        size = os.path.getsize(path)
    except OSError:
        return f"error: cannot stat {path}"
    if size == 0:
        return (
            f"error: {path} is 0 bytes — nothing was captured.\n"
            "  * Another packetlogger/PacketLogger instance held the HCI tap "
            "(pgrep -lf packetlogger), or\n"
            "  * the capture was stopped without SIGINT so it never flushed, or\n"
            "  * no Bluetooth device was connected."
        )
    raw = dissect.batch_file(path)
    if raw and all(o.layer == "other" for o in raw):
        notes = "; ".join(sorted({o.info[:60] for o in raw})[:3])
        return (
            f"error: {path} contains {len(raw)} record(s) but no HCI packets — "
            f"only log notes: {notes}\n"
            "  This is the signature of a SECOND packetlogger instance: it "
            "attaches, gets no packets because another process holds the HCI "
            "tap, and writes only its own disconnect note.\n"
            "  Fix: sudo pkill -INT -f 'packetlogger convert'  (and killall "
            "PacketLogger if the GUI is open), then capture again."
        )
    return (
        f"error: no operations dissected from {path} ({size} bytes). Did the "
        "display filter exclude everything? Try without --preset/--device."
    )


def load(args) -> tuple[list[dissect.AttOp], list[Marker], dict]:
    # Hand the file to tshark directly rather than converting it ourselves.
    # tshark natively reads PacketLogger, btsnoop (any datalink, including the
    # BlueZ monitor format `btmon -w` produces), pcap and pcapng — converting
    # first would only narrow what we accept.
    # Resolve --device to its ACL handle(s) first. An address filter drops ACL
    # frames tshark did not manage to bind an address to, and losing a single
    # discovery response costs the attribute table a whole service.
    device_handles: list[int] = []
    if args.device:
        try:
            device_handles = [
                s.handle for s in links.for_device(links.sessions(args.file), args.device)
            ]
        except (dissect.TsharkError, OSError):
            device_handles = []
        if device_handles:
            log.info(
                "%s -> ACL handle(s) %s",
                args.device, ", ".join(f"0x{h:04x}" for h in device_handles),
            )
        else:
            log.warning(
                "no connection-complete event for %s; falling back to an address "
                "filter, which may drop frames", args.device,
            )

    display_filter = filters.build(
        preset=args.preset, device=args.device, uuid=args.filter_uuid,
        handle=args.handle, extra=args.filter, device_handles=device_handles,
    )
    if display_filter:
        log.info("display filter: %s", display_filter)
    ops = dissect.batch_file(args.file, display_filter)
    log.info("%d dissected operations from %s", len(ops), args.file)

    markers: list[Marker] = []
    manifest: dict = {}
    if args.manifest:
        manifest = read_manifest(args.manifest)
        markers = read_markers(args.manifest)
        log.info("%d markers from %s", len(markers), args.manifest)
    return ops, markers, manifest


def phase_table(summaries) -> list[str]:
    rows = [
        "| # | Phase | First (rel s) | Steps | Web Bluetooth | Reason / API |",
        "|---|---|---|---|---|---|",
    ]
    if not summaries:
        return rows + ["| — | (no phases) | | | | |"]
    t0 = summaries[0].first_ts
    icon = {REPRODUCIBLE: "✅ reproducible", IMPLICIT: "🔵 implicit", UNREACHABLE: "❌ unreachable"}
    for i, s in enumerate(summaries, start=1):
        rows.append(
            f"| {i} | `{s.phase.value}` | {s.first_ts - t0:.3f} | {s.step_count} | "
            f"{icon.get(s.classification, s.classification)} | {s.web_bluetooth} |"
        )
    return rows


def payload_catalogue(steps) -> list[str]:
    """Every distinct payload once, with its protobuf verdict.

    Deduplicated because a 5-minute capture has thousands of frames and maybe
    a dozen distinct payload shapes; the shapes are the finding.
    """
    seen: dict[bytes, dict] = {}
    for s in steps:
        if not s.value:
            continue
        entry = seen.setdefault(
            s.value,
            {"count": 0, "dirs": set(), "phases": set(), "uuids": set(), "first": s.packet},
        )
        entry["count"] += s.repeat_count
        entry["dirs"].add(s.direction)
        entry["phases"].add(s.phase.value)
        if s.uuid:
            entry["uuids"].add(uuids.short(s.uuid))

    lines = []
    for value, meta in sorted(seen.items(), key=lambda kv: -kv[1]["count"]):
        verdict = pbinfer.classify(value)
        dirs = "/".join(sorted(meta["dirs"]))
        where = ",".join(sorted(meta["uuids"])) or "-"
        lines.append(
            f"- `{value.hex(' ')}` "
            f"(×{meta['count']}, {dirs}, {where}, first pkt {meta['first']}, "
            f"phases {','.join(sorted(meta['phases']))})"
        )
        lines.append(f"  - protobuf: **{verdict.mode}** — {verdict.note}")
        if verdict.message and verdict.message.valid:
            lines.append(f"  - fields: `{verdict.message.describe()}`")
        gloss = render.ascii_gloss(value, width=64)
        if any(0x20 <= b < 0x7F for b in value):
            lines.append(f"  - ascii: `{gloss}`")
    return lines


def timing_analysis(steps) -> list[str]:
    """Intervals that constrain our implementation: keepalive rate, gaps."""
    lines = []
    by_key: dict[str, list[float]] = {}
    for s in steps:
        by_key.setdefault(s.key, []).append(s.ts)
    for key, times in sorted(by_key.items()):
        if len(times) < 3:
            continue
        gaps = [b - a for a, b in zip(times, times[1:])]
        mean = sum(gaps) / len(gaps)
        if mean <= 0:
            continue
        lines.append(
            f"- `{key}` ×{len(times)}: mean interval {mean:.3f}s "
            f"(min {min(gaps):.3f}, max {max(gaps):.3f}) ≈ {1 / mean:.2f} Hz"
        )
    if not lines:
        lines.append("- no operation repeated often enough to measure an interval")
    return lines


def marker_attribution(steps, markers: list[Marker]) -> list[str]:
    if not markers:
        return ["_(no manifest supplied — packets are unattributed)_"]
    lines = []
    for m in markers:
        attributed = [s for s in steps if s.marker == m.label]
        lines.append(f"- **{iso(m.ts)}** — {m.label}")
        if not attributed:
            lines.append("  - no packets within the attribution window")
            continue
        counts = Counter(f"{s.direction} {s.summary}" for s in attributed)
        for what, n in counts.most_common(6):
            lines.append(f"  - {n}× {what}")
    return lines


def link_sessions(path: str, device: str | None) -> list[str]:
    """How long each link lasted and who ended it.

    Always read unfiltered: a --device filter is an ACL-address filter, and HCI
    events carry no ACL address, so filtering hides every connect/disconnect.
    This section is the only place a capture answers 'did the link survive, and
    if not, did the peer stop responding or did we hang up?' — the reason code
    is invisible to Web Bluetooth, so it can only ever come from a capture.
    """
    try:
        found = links.sessions(path)
    except (dissect.TsharkError, OSError) as exc:
        return [f"- could not read HCI events: {exc}"]
    if not found:
        return ["- no LE connection events in this capture"]

    lines = []
    mine = links.for_device(found, device)
    if device and not mine:
        lines.append(
            f"- no connection-complete event for `{device}` — the link was "
            "already up when the capture started, or the address is wrong"
        )
        mine = found
    for s in mine:
        lines.append(f"- `{s.describe()}`"
                     + (f" [pkts {s.open_packet}..{s.close_packet}]"
                        if s.close_packet else ""))
        d = s.duration
        if d is not None and s.reason is not None and d < 120:
            lines.append(
                f"  - **the link did not survive 2 minutes** ({d:.1f}s). "
                f"{s.actor}."
            )
    return lines


def unreachable_summary(summaries) -> list[str]:
    lines = []
    for s in summaries:
        if s.classification == UNREACHABLE:
            lines.append(f"- **{s.phase.value}** ({s.step_count} steps) — {s.web_bluetooth}")
    if not lines:
        lines.append(
            "- **Nothing in this capture is unreachable from Web Bluetooth.** "
            "Every step maps to an API call or is done implicitly by the browser. "
            "This is the strongest possible Tier 1 (browser-only) evidence."
        )
    return lines


def build_report(args, ops, markers, manifest) -> str:
    steps = timeline.build(ops, markers, collapse_noise=not args.no_collapse)
    summaries = timeline.phase_summary(steps)
    out: list[str] = []
    a = out.append

    a(f"# Connection analysis — `{os.path.basename(args.file)}`")
    a("")
    if manifest:
        a(f"- **Scenario**: `{manifest.get('scenario', '?')}`")
        a(f"- **Captured**: {manifest.get('started_at_iso', '?')}")
        a(f"- **Backend**: {manifest.get('backend', '?')}")
        hw = manifest.get("hardware", {})
        fw = manifest.get("firmware", {})
        a(f"- **Hardware**: {hw.get('trainer', '?')} (fw {fw.get('trainer', '?')}); "
          f"{hw.get('controller', '?')} (fw {fw.get('controller', '?')})")
        env = manifest.get("environment", {})
        a(f"- **Host**: {env.get('platform', '?')}, {env.get('tshark', '?')}")
        if manifest.get("software", {}).get("official_app"):
            a(f"- **Official app**: {manifest['software']['official_app']}")
        if manifest.get("operator_notes"):
            a(f"- **Notes**: {manifest['operator_notes']}")
    else:
        a("_No manifest supplied; hardware/firmware context unknown._")
    a("")
    a(f"- {len(ops)} dissected operations → {len(steps)} steps in {len(summaries)} phases")
    a("")

    a("## 1. Connection state machine")
    a("")
    out += phase_table(summaries)
    a("")

    a("## 2. Link sessions — lifetime and who hung up")
    a("")
    out += link_sessions(args.file, args.device)
    a("")

    a("## 3. What Web Bluetooth cannot reproduce")
    a("")
    out += unreachable_summary(summaries)
    a("")

    a("## 4. Findings — what should `connect()` do differently")
    a("")
    for f in timeline.findings(steps):
        a(f"- {f}")
    a("")

    a("## 5. Ordered step list")
    a("")
    a("```")
    a(render.render_steps(steps, color=False, show_wb=args.explain))
    a("```")
    a("")

    a("## 6. Distinct payloads and protobuf inference")
    a("")
    out += payload_catalogue(steps)
    a("")

    a("## 7. Timing")
    a("")
    out += timing_analysis(steps)
    a("")

    a("## 8. Action attribution")
    a("")
    out += marker_attribution(steps, markers)
    a("")

    try:
        anns = sources.file_annotations(args.file)
    except (ValueError, OSError):
        anns = []
    if anns:
        a("## 9. Capture-embedded log lines")
        a("")
        a("_PacketLogger note/config records — the OS stack narrating its own decisions._")
        a("")
        a("```")
        for ann in anns[: args.max_annotations]:
            a(f"{iso(ann.ts_unix)} [{ann.kind}] {ann.text}")
        if len(anns) > args.max_annotations:
            a(f"... {len(anns) - args.max_annotations} more")
        a("```")
        a("")

    return "\n".join(out)


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("--file", required=True, help="capture file (.pklg, btsnoop)")
    p.add_argument("--manifest", help="manifest/marker sidecar from capture.py")
    p.add_argument("--report", help="write the markdown report here (default: stdout)")
    p.add_argument("--filter", help="tshark display filter applied before analysis")
    p.add_argument("--device", help="restrict to one peer Bluetooth address (AA:BB:CC:DD:EE:FF)")
    p.add_argument("--handle", type=lambda v: int(v, 0), help="restrict to one ACL connection handle")
    p.add_argument("--filter-uuid", help="restrict to a UUID group: 'zap', 'ftms', or a literal UUID")
    p.add_argument("--preset", choices=sorted(filters.PRESETS), help="display-filter preset")
    p.add_argument("--no-collapse", action="store_true", help="do not merge repeated frames")
    p.add_argument("--explain", action="store_true", help="include the full Web Bluetooth mapping prose")
    p.add_argument("--max-annotations", type=int, default=40)
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )

    try:
        ops, markers, manifest = load(args)
    except (sources.SourceError, dissect.TsharkError, OSError, ValueError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    # A capture holding only log-note records is the macOS "second instance"
    # failure mode, not a real capture. Catch it here rather than emitting a
    # confident-looking report about nothing.
    if not ops or all(o.layer == "other" for o in ops):
        print(_diagnose_empty(args.file), file=sys.stderr)
        return 1

    report = build_report(args, ops, markers, manifest)
    if args.report:
        os.makedirs(os.path.dirname(os.path.abspath(args.report)) or ".", exist_ok=True)
        with open(args.report, "w") as fh:
            fh.write(report + "\n")
        print(f"wrote {args.report}", file=sys.stderr)
    else:
        print(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
