#!/usr/bin/env python3
"""Serve the Web Bluetooth harness and collect its per-step verdict.

Why a server at all: Web Bluetooth requires a secure context, which
``http://localhost`` satisfies but ``file://`` does not — opening the harness
directly from disk gives you a page with no ``navigator.bluetooth``. Serving it
also gives the page somewhere to POST results, so the replay verdict lands in a
file next to the captures instead of in a browser console.

The actual replay runs in the browser (only the browser has Web Bluetooth).
This script's job is to host it, receive the result, and print the verdict in
the same shape the recipe document needs.

    ./replay.py --serve
    ./replay.py --serve --out ../../captures/replay-01.json --open
"""

from __future__ import annotations

import argparse
import http.server
import json
import logging
import os
import socketserver
import sys
import threading
import time
import webbrowser

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

log = logging.getLogger("replay")

HARNESS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "harness")

CLASS_ICON = {"reproducible": "✅", "implicit": "🔵", "unreachable": "❌"}
STATUS_ICON = {"pass": "PASS", "fail": "FAIL", "skip": "skip"}


class Handler(http.server.SimpleHTTPRequestHandler):
    results_path: str = ""
    on_result = None

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=HARNESS_DIR, **kwargs)

    def log_message(self, fmt, *args):  # quieter than the default
        log.debug("%s - %s", self.address_string(), fmt % args)

    def do_POST(self) -> None:  # noqa: N802 (stdlib naming)
        if self.path != "/result":
            self.send_error(404)
            return
        length = int(self.headers.get("content-length") or 0)
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError as exc:
            self.send_error(400, f"bad JSON: {exc}")
            return

        if self.results_path:
            os.makedirs(os.path.dirname(os.path.abspath(self.results_path)) or ".", exist_ok=True)
            with open(self.results_path, "w") as fh:
                json.dump(data, fh, indent=2)
                fh.write("\n")

        body = f"stored {len(data.get('results', []))} step results".encode()
        self.send_response(200)
        self.send_header("content-type", "text/plain")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

        print()
        print(render_verdict(data))
        if self.results_path:
            print(f"\nSaved to {self.results_path}")
        if callable(type(self).on_result):
            type(self).on_result()


def render_verdict(data: dict) -> str:
    results = data.get("results", [])
    lines: list[str] = []
    a = lines.append
    a("=" * 82)
    a("  REPLAY VERDICT")
    a("=" * 82)
    dev = data.get("device") or {}
    a(f"  device      : {dev.get('name', '(none)')}")
    a(f"  at          : {data.get('at', '?')}")
    ua = data.get("userAgent", "")
    a(f"  browser     : {ua[:70]}")
    a(f"  ASYNC frames: {data.get('frameCount', 0)}")
    cond = data.get("condition") or {}
    if cond:
        sent = cond.get("vendorUnlockAssertSent")
        a(f"  condition   : ff 04 00 {'SENT' if sent else 'NOT sent (control)'}"
          f", watch {cond.get('watchWindowSeconds', '?')}s")
    survived = data.get("survivedForSeconds")
    if survived is not None:
        a(f"  survival    : {survived:.1f}s "
          f"{'(DROPPED)' if data.get('dropped') else '(still connected)'}")
    a("")
    a(f"  {'#':>2}  {'':2} {'status':<6} {'ms':>6}  step / detail")
    a("  " + "-" * 78)
    for i, r in enumerate(results, start=1):
        icon = CLASS_ICON.get(r.get("classification", ""), " ")
        status = STATUS_ICON.get(r.get("status", ""), r.get("status", "?"))
        a(f"  {i:>2}  {icon:2} {status:<6} {r.get('ms', 0):>6}  {r.get('step', '?')}")
        detail = r.get("detail") or ""
        if detail:
            a(f"  {'':>2}  {'':2} {'':<6} {'':>6}    ↳ {detail[:96]}")
    a("")

    required = [r for r in results if r.get("status") != "skip"]
    failed = [r for r in required if r.get("status") == "fail"]
    frames = data.get("frameCount", 0)
    handshook = any(
        r.get("step", "").startswith("handshake reply") and r.get("status") == "pass"
        for r in results
    )
    survived = any(
        r.get("step", "").startswith("steady state") and r.get("status") == "pass"
        for r in results
    )

    ok = not failed and frames > 0 and handshook
    a("  " + ("─" * 78))
    a(f"  Did a plain webpage connect and receive button events?  "
      f"{'YES' if ok else 'NO'}")
    a(f"    subscribed .................. {'yes' if handshook else 'no'}")
    a(f"    handshaken .................. {'yes' if handshook else 'no'}")
    a(f"    notifications arriving ...... {'yes' if frames else 'no'} ({frames} frames)")
    a(f"    survived the steady-state window {'yes' if survived else 'no'}")
    if failed:
        a("")
        a("  Failed required steps:")
        for r in failed:
            a(f"    - {r.get('step')}: {r.get('detail')}")
    a("")
    a("  Steps recorded as impossible (the Unreachable list, generated not asserted):")
    unreachable = [r for r in results if r.get("classification") == "unreachable"]
    implicit = [r for r in results if r.get("classification") == "implicit"]
    for r in unreachable + implicit:
        a(f"    {CLASS_ICON.get(r['classification'])} {r.get('step')} — {r.get('detail')}")
    a("=" * 82)
    return "\n".join(lines)


def serve(args: argparse.Namespace) -> int:
    Handler.results_path = args.out or ""
    done = threading.Event()
    if args.once:
        Handler.on_result = done.set

    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", args.port), Handler) as httpd:
        url = f"http://localhost:{args.port}/"
        print("=" * 82)
        print("  ble-lab replay harness")
        print("=" * 82)
        print(f"  Serving {HARNESS_DIR}")
        print(f"  Open:   {url}")
        print()
        print("  Before you click Run recipe:")
        print("    1. Quit every other app that talks to the Click (Zwift, Companion,")
        print("       other browser tabs). Two clients cannot share one GATT link.")
        print("    2. Press a Click button to wake it — a sleeping Click does not")
        print("       advertise and will not appear in the chooser.")
        print("    3. If you are also capturing, start the capture backend first.")
        print()
        print("  The chooser needs a real user gesture, so the page cannot")
        print("  self-start; click Run recipe yourself.")
        print()
        print("  Ctrl-C to stop." if not args.once else "  Will exit after the first POST.")
        print("=" * 82)
        if args.open:
            threading.Timer(0.6, lambda: webbrowser.open(url)).start()

        thread = threading.Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            while not done.is_set():
                time.sleep(0.2)
        except KeyboardInterrupt:
            print("\nstopped")
        finally:
            httpd.shutdown()
    return 0


def show(args: argparse.Namespace) -> int:
    with open(args.show) as fh:
        data = json.load(fh)
    print(render_verdict(data))
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("--serve", action="store_true", help="serve the harness on localhost")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--out", help="write the posted results JSON here")
    p.add_argument("--open", action="store_true", help="open the browser automatically")
    p.add_argument("--once", action="store_true", help="exit after the first posted result")
    p.add_argument("--show", help="re-render a previously saved results JSON and exit")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
    )

    if args.show:
        return show(args)
    if args.serve:
        return serve(args)
    p.print_help()
    print("\nNothing to do: pass --serve (to run the replay) or --show FILE.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
