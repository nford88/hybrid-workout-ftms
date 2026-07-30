#!/usr/bin/env python3
"""Watch-it-happen view: one aligned line per ATT/GATT operation, in real time.

Pipeline: source (Android snoop socket, or a growing .pklg) -> pcap on stdin ->
``tshark -l`` -> Python renderer. tshark does the dissection; this script does
the presentation, because reading a capture live at the bike is a
pattern-recognition task and the default tshark output is not optimised for it.

Presentation choices, all in service of that:
  * columns aligned so the eye scans a column, not a line
  * direction as an arrow glyph, visible peripherally
  * repeated keepalives collapsed into a counter
  * Δt from the previous line, because intervals are findings too
  * ASCII gloss alongside hex, which is how you spot 'RideOn' and the device
    serial embedded in the 0xFF frames

Examples
--------
    ./live.py --backend android
    ./live.py --backend pklg --file ~/cap.pklg --tail
    ./live.py --backend pklg --file ~/cap.pklg --filter-uuid zap
"""

from __future__ import annotations

import argparse
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from blelab import dissect, filters, sources  # noqa: E402
from blelab.render import LiveRenderer  # noqa: E402

log = logging.getLogger("live")

def open_records(args: argparse.Namespace):
    """Return (kind, iterable). kind is 'records' (needs conversion) or 'bytes'.

    'bytes' sources are already in a format tshark reads (btsnoop, pcap), so
    they go straight through with no conversion — fewer moving parts, and it
    supports datalink types our own parser deliberately does not (notably
    BlueZ's monitor format from `btmon -w`).
    """
    if args.backend == "android":
        return "records", sources.iter_android_live()
    if args.backend == "macos-record":
        if not args.out:
            raise sources.SourceError("--backend macos-record requires --out PATH.pklg")
        path = sources.record_packetlogger(args.out, sudo=not args.no_sudo)
        return "recorded", path
    if args.backend == "macos":
        if not args.out:
            raise sources.SourceError(
                "--backend macos requires --out PATH.pklg (the capture is written "
                "there and tailed live; the raw file is the evidence)"
            )
        return "bytes", sources.iter_packetlogger_cli(args.out, sudo=not args.no_sudo)
    if args.backend == "stdin":
        return "bytes", sources.iter_raw_stdin()
    if args.backend == "ssh":
        if not args.ssh_host:
            raise sources.SourceError("--backend ssh requires --ssh-host")
        return "bytes", sources.iter_ssh(
            args.ssh_host, args.ssh_command, sudo=not args.no_sudo
        )
    if args.backend in ("pklg", "file"):
        if not args.file:
            raise sources.SourceError(f"--backend {args.backend} requires --file")
        if args.tail:
            return "records", sources.iter_tail(args.file, from_start=not args.since_now)
        return "bytes", sources.iter_file_bytes(args.file)
    raise sources.SourceError(f"unknown backend {args.backend!r}")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument(
        "--backend",
        default="android",
        choices=["macos-record", "macos", "android", "ssh", "stdin", "pklg", "file"],
        help="where records come from (default: android)",
    )
    p.add_argument("--file", help="capture file, for --backend pklg/file")
    p.add_argument("--ssh-host", help="[user@]host for --backend ssh (a LINUX host)")
    p.add_argument(
        "--ssh-command",
        default=sources.BTMON_STREAM_CMD,
        help=f"remote capture command (default: {sources.BTMON_STREAM_CMD!r})",
    )
    p.add_argument("--no-sudo", action="store_true", help="do not prefix the remote command with sudo -n")
    p.add_argument("--tail", action="store_true", help="follow the file as it grows")
    p.add_argument(
        "--since-now",
        action="store_true",
        help="with --tail, skip existing content and show only new records",
    )
    p.add_argument(
        "--preset",
        default="no-telemetry",
        choices=sorted(filters.PRESETS),
        help="display-filter preset (default: no-telemetry)",
    )
    p.add_argument("--device", help="restrict to one peer Bluetooth address (AA:BB:CC:DD:EE:FF)")
    p.add_argument("--handle", type=lambda v: int(v, 0), help="restrict to one ACL connection handle")
    p.add_argument("--filter", help="extra raw tshark display filter, ANDed with the preset")
    p.add_argument("--filter-uuid", help="restrict to a UUID: 'zap', 'ftms', or a literal UUID")
    p.add_argument("--no-collapse", action="store_true", help="show every repeated frame")
    p.add_argument("--no-color", action="store_true")
    p.add_argument("--out", help="[--backend macos] write the .pklg capture here (required)")
    p.add_argument("--save-pcap", help="also write the converted pcap stream here")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )

    try:
        kind, source = open_records(args)
    except sources.SourceError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 2

    display_filter = filters.build(
        preset=args.preset, device=args.device, uuid=args.filter_uuid,
        handle=args.handle, extra=args.filter,
    )
    log.info("display filter: %s", display_filter or "(none)")

    if kind == "recorded":
        # Nothing streamed; decode the finished file and render it in one pass.
        ops = dissect.batch_file(source, display_filter)
        print(f"\n  decoded {len(ops)} operations from {source}\n", file=sys.stderr)
    elif kind == "bytes":
        if args.save_pcap:
            source = _tee_bytes(source, args.save_pcap)
        ops = dissect.stream_bytes(source, display_filter)
    else:
        if args.save_pcap:
            source = _tee_pcap(source, args.save_pcap)
        ops = dissect.stream(source, display_filter)

    renderer = LiveRenderer(
        color=not args.no_color,
        collapse=not args.no_collapse,
    )
    print()
    renderer.header()

    n = 0
    try:
        for op in ops:
            renderer.op(op)
            n += 1
    except KeyboardInterrupt:
        pass
    except sources.SourceError as exc:
        print(f"\nsource error: {exc}", file=sys.stderr)
        return 2
    finally:
        renderer.finish()
        if n == 0:
            print(
                "\nNo operations decoded. Causes, in the order they actually happen:\n"
                "\n"
                "  1. THERE WAS NOTHING TO CAPTURE. A connected-but-idle BLE link\n"
                "     emits almost no HCI traffic, and a button press only generates\n"
                "     traffic if something is SUBSCRIBED to that device. This is the\n"
                "     most common cause and it is not a fault.\n"
                "     Smoke test: toggle Bluetooth off/on — that always emits dozens\n"
                "     of HCI commands. If they appear, the pipeline is fine.\n"
                "  2. (macOS) Another packetlogger/PacketLogger held the HCI tap.\n"
                "     Check: pgrep -lf packetlogger\n"
                "  3. (macOS) packetlogger buffered its pipe. Use capture-then-\n"
                "     analyse: sudo packetlogger convert -o FILE, Ctrl-C, analyze.py\n"
                "  4. (Android) snoop log enabled but Bluetooth not toggled off/on\n"
                "     afterwards, so the stack never reopened its sink.\n"
                "  5. The display filter excluded everything — try --preset all.",
                file=sys.stderr,
            )
    return 0


def _tee_pcap(records, path: str):
    """Write the pcap stream to disk while yielding records onward."""
    from blelab.pcapio import pcap_global_header, pcap_record

    fh = open(path, "wb")
    fh.write(pcap_global_header())
    log.info("also saving pcap to %s", path)
    try:
        for rec in records:
            fh.write(pcap_record(rec))
            fh.flush()
            yield rec
    finally:
        fh.close()


def _tee_bytes(chunks, path: str):
    """Save a raw capture stream verbatim while passing it through.

    Verbatim rather than re-encoded: the raw bytes are the evidence, and for an
    SSH/btmon stream this file is the only copy that will exist.
    """
    fh = open(path, "wb")
    log.info("also saving the raw capture stream to %s", path)
    try:
        for chunk in chunks:
            fh.write(chunk)
            fh.flush()
            yield chunk
    finally:
        fh.close()


if __name__ == "__main__":
    sys.exit(main())
