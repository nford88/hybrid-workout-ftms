#!/usr/bin/env python3
"""Run one capture scenario end to end: manifest, prompts, action markers.

This script does NOT capture packets itself. It owns the part a packet capture
cannot reconstruct: a precise, machine-readable record of *what a human
physically did, when*. Every prompt writes a marker stamped with `time.time()`,
the same clock PacketLogger and btsnoop records use, so analyze.py can attribute
packets to physical actions afterwards.

Run it alongside the capture, in a second terminal.

On macOS, capture with the CLI rather than the GUI:

    sudo /Applications/PacketLogger.app/Contents/Resources/packetlogger \\
        convert -o capture.pklg

The GUI needs a privileged helper installed via SMJobBless on first launch; if
that never happened it shows an empty window with no error at all. The CLI just
needs sudo. `--backend macos` reports which of these applies.

    ./capture.py --scenario warm-reconnect --out ../../captures/
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from blelab import sources  # noqa: E402
from blelab.markers import (  # noqa: E402
    Manifest,
    Marker,
    host_environment,
    iso,
    write_manifest,
)

log = logging.getLogger("capture")


# ──────────────────────────────────────────────────────────────────────────
# Scenario definitions — Phase 2 of the mission, one variable at a time.
#
# Each scenario carries its *prediction* alongside its steps. Writing the
# prediction into the tool (rather than only into the doc) means the operator
# sees it at the bike, before acting, which is the only time a prediction can
# still be falsified honestly.
# ──────────────────────────────────────────────────────────────────────────

SCENARIOS: dict[str, dict] = {
    "advertisement-baseline": {
        "title": "Advertisement baseline — Click powered, nothing connected",
        "question": "What must our requestDevice() filters match?",
        "prediction": (
            "Local Name exactly 'Zwift Click'; manufacturer data company ID 0x094A; "
            "advertised service 0xFC82 (post-Jan-2025 fw) NOT the 19ca 128-bit UUID; "
            "advertising interval in the 20-200ms range while awake, stopping "
            "entirely ~60s after the last button press."
        ),
        "steps": [
            ("Make sure NOTHING is connected to the Click (quit Zwift, close all browser tabs)", 5),
            ("Press any Click button to wake it — do not connect", 3),
            ("Hold still and let it advertise", 20),
            ("Do nothing at all; we are timing how long until it stops advertising", 90),
        ],
        "note": (
            "Web Bluetooth cannot see advertisements at all, so this scenario is "
            "captured for reference only — the actionable output is which filter "
            "keys are even available. If you have no sniffer, nRF Connect for "
            "Mobile shows all of this for free."
        ),
    },
    "cold-connect": {
        "title": "Cold connect by the official app — first-ever pairing",
        "question": "Which steps in a first connection can Web Bluetooth not reproduce?",
        "prediction": (
            "No SMP pairing at all (ZAP characteristics are plaintext-readable from "
            "Web Bluetooth today, which would be impossible if they required "
            "authentication). Expect: LE connect, feature exchange, ATT MTU "
            "exchange to ~185-517, full service discovery, CCCD writes on ASYNC "
            "(0002) and SYNC TX (0004), then a write to SYNC RX (0003). If SMP "
            "DOES appear, browser-only is dead and this is the Tier 2 trigger."
        ),
        "steps": [
            ("In the official app, FORGET/unpair the Click if it is remembered", 5),
            ("Quit the official app completely", 5),
            ("Start your capture backend NOW (PacketLogger: Cmd-N; or live.py)", 10),
            ("Launch the official app and log in", 30),
            ("Navigate to the device-pairing screen — do not start a ride", 15),
            ("Press a Click button to wake it", 3),
            ("Pair/connect the Click in the app's pairing screen", 20),
            ("Leave it connected, touching nothing", 30),
        ],
    },
    "warm-reconnect": {
        "title": "Warm reconnect — already-known device",
        "question": "What does OUR app's connect() actually need to do? (the real target)",
        "prediction": (
            "Strictly shorter than cold-connect: no pairing, and possibly no full "
            "service discovery if the OS cached the attribute table. The CCCD "
            "writes and the SYNC RX handshake write must both still be present — "
            "those are app-level and cannot be cached."
        ),
        "steps": [
            ("Confirm the Click is already known/paired to the official app", 5),
            ("Quit the official app completely", 5),
            ("Press a Click button, wait for it to sleep again (~90s)", 95),
            ("Start your capture backend NOW", 10),
            ("Press a Click button to wake it", 3),
            ("Launch the official app, go to the pairing screen, connect the Click", 30),
            ("Leave it connected, touching nothing", 30),
        ],
    },
    "handshake": {
        "title": "The handshake itself — byte-exact, and its ordering constraint",
        "question": "Does the handshake precede or follow CCCD subscription?",
        "prediction": (
            "Subscription FIRST, then the handshake write — because the reply "
            "arrives as an indication on SYNC TX (0004) and would be lost "
            "otherwise. Community docs (PROTOCOLS.md §1.2) say the same. Expect "
            "the write to be exactly 6 bytes 52 69 64 65 4f 6e, possibly with 2 "
            "trailing status bytes. Our own experiments/03 saw a BARE echo back, "
            "contradicting the documented 'RideOn + 2 bytes' — this capture "
            "arbitrates."
        ),
        "steps": [
            ("Click asleep, official app closed, capture backend running", 10),
            ("Press a Click button to wake it", 3),
            ("Connect the Click in the official app's pairing screen", 25),
            ("Do nothing — we only need the connect sequence", 20),
        ],
    },
    "steady-state": {
        "title": "Steady state — keepalives, battery, polling",
        "question": "What must our app send to avoid being dropped, and how often?",
        "prediction": (
            "Nothing client->device is required (PROTOCOLS.md §1.6 says no "
            "keepalive needed). Expect device->client 0x15 idle frames at ~1 Hz "
            "and battery notifications every ~5s (matching experiments/01). If "
            "the app writes anything periodically, that is a keepalive we are "
            "missing and a candidate cause of the ~45-90s drops."
        ),
        "steps": [
            ("Click connected in the official app, capture running", 5),
            ("Now leave everything completely alone for 3 minutes", 180),
            ("Still nothing — we are watching for the ~60s vendor-lock window", 120),
        ],
    },
    "buttons": {
        "title": "Button events during a connected session",
        "question": "Do notifications flow after the handshake? (not a full decode)",
        "prediction": (
            "Handle Value Notifications on ASYNC (0002) carrying type-0x23 bitmap "
            "frames. Right '+' clears bit 0x20, Left '-' clears bit 0x100 "
            "(confirmed in experiments/04)."
        ),
        "steps": [
            ("Click connected in the official app, capture running", 5),
            ("Press the RIGHT '+' paddle once, then release", 4),
            ("Press the LEFT '-' paddle once, then release", 4),
            ("HOLD the RIGHT '+' paddle for about 3 seconds, then release", 6),
            ("Do nothing", 10),
        ],
    },
    "teardown": {
        "title": "Teardown — clean disconnect vs out-of-range vs sleep",
        "question": "What does reconnect require after each kind of disconnect?",
        "prediction": (
            "Clean disconnect: HCI Disconnect with reason 0x13 (remote user "
            "terminated) or 0x16 (local host terminated). Out-of-range: 0x08 "
            "(connection timeout) after the 6s supervision timeout observed in "
            "experiments/01. Device sleep should look like the remote terminating. "
            "Web Bluetooth exposes NONE of these reason codes, so our app cannot "
            "tell them apart — this scenario quantifies what we are giving up."
        ),
        "steps": [
            ("Click connected in the official app, capture running", 5),
            ("Disconnect the Click from within the app (clean disconnect)", 15),
            ("Reconnect it in the app", 20),
            ("Now WALK AWAY with the Click, ~15m or behind a wall, until it drops", 40),
            ("Come back and reconnect in the app", 25),
            ("Disconnect in the app, then leave the Click alone until it sleeps", 100),
        ],
    },
    "trainer-control": {
        "title": "Trainer side — the control experiment that validates the method",
        "question": "Does our FTMS connect path match the app's? (we know ours works)",
        "prediction": (
            "The app should do: connect, MTU, discovery, CCCD on Indoor Bike Data "
            "(0x2AD2) + FTMS Control Point (0x2AD9) + Machine Status (0x2ADA), then "
            "CP writes 0x00 (Request Control) and 0x07 (Start). Our ftms.js is "
            "known NOT to subscribe to Machine Status (0x2ADA) — if the app does, "
            "that is a real gap. Since our trainer connection demonstrably works, "
            "any divergence found here is a false positive in the method, which is "
            "exactly what makes this the control."
        ),
        "steps": [
            ("Official app closed, capture backend running, trainer powered", 5),
            ("Launch the official app and go to the pairing screen", 30),
            ("Pair the KICKR Core as the power source / controllable trainer", 25),
            ("Start a ride or activity so it sends control commands", 30),
            ("Pedal steadily for 30 seconds", 30),
            ("Stop and end the activity", 20),
        ],
    },
    "our-harness": {
        "title": "★ CENTREPIECE — our Web Bluetooth harness, same backend",
        "question": "Where does our connect sequence diverge from the app's?",
        "prediction": (
            "Expected divergences, all of which we should be able to name in "
            "advance: (a) we subscribe to EVERY notify/indicate characteristic "
            "including battery and DFU, the app probably subscribes selectively; "
            "(b) our subscription ORDER is whatever getCharacteristics() returns, "
            "not deliberately 0002-then-0004; (c) our RideOn write is a separate "
            "manual click, so the subscribe->handshake gap will be seconds not "
            "milliseconds; (d) we never write any 0xFF-family frame. (d) is the "
            "one that could explain the ~45-90s drops."
        ),
        "steps": [
            ("Close the official app entirely. Capture backend running", 10),
            ("Press a Click button to wake it", 3),
            ("In Chrome open the harness (src/dev/ble-lab.html or replay.py --serve)", 15),
            ("Click 'Connect Click' and pick the device in the chooser", 20),
            ("Click 'Write RideOn handshake'", 10),
            ("Press the RIGHT '+' paddle once", 4),
            ("Leave it alone — we are timing how long the connection survives", 180),
        ],
    },
}


def countdown(seconds: int, label: str, quiet: bool = False) -> None:
    """Visible countdown so the operator knows how long to hold still."""
    if quiet or seconds <= 0:
        time.sleep(max(0, seconds))
        return
    end = time.monotonic() + seconds
    while True:
        remaining = end - time.monotonic()
        if remaining <= 0:
            break
        mins, secs = divmod(int(remaining) + 1, 60)
        bar_width = 30
        done = int(bar_width * (1 - remaining / seconds))
        bar = "█" * done + "░" * (bar_width - done)
        sys.stdout.write(f"\r    [{bar}] {mins:d}:{secs:02d} remaining   ")
        sys.stdout.flush()
        time.sleep(min(0.25, remaining))
    sys.stdout.write("\r" + " " * 70 + "\r")
    sys.stdout.flush()


def prompt_step(index: int, total: int, text: str) -> None:
    print(f"\n\033[1m[{index}/{total}] {text}\033[0m")
    print("    Press ENTER at the exact moment you perform this action.", end="")
    try:
        input()
    except EOFError:
        print(" (stdin closed, continuing)")


def run_scenario(args: argparse.Namespace) -> int:
    scenario = SCENARIOS[args.scenario]
    started = time.time()

    manifest = Manifest(
        scenario=args.scenario,
        started_at=started,
        backend=args.backend,
        operator_notes=args.notes or "",
        hardware={
            "trainer": args.trainer,
            "controller": args.controller,
            "capture_host": args.host or "this machine",
        },
        firmware={"trainer": args.trainer_fw, "controller": args.controller_fw},
        environment=host_environment(),
        software={"official_app": args.app, "our_harness": args.harness},
    )

    print("=" * 78)
    print(f"  SCENARIO: {scenario['title']}")
    print("=" * 78)
    print(f"\n  Question this answers:\n    {scenario['question']}")
    print("\n  \033[1mPREDICTION (read this BEFORE acting — it is only falsifiable now):\033[0m")
    for line in _wrap(scenario["prediction"], 72):
        print(f"    {line}")
    if scenario.get("note"):
        print("\n  Note:")
        for line in _wrap(scenario["note"], 72):
            print(f"    {line}")

    print("\n" + "-" * 78)
    print("  Backend readiness check")
    print("-" * 78)
    _readiness(args.backend)

    print("\n" + "-" * 78)
    print(f"  {len(scenario['steps'])} steps. Markers are written as you go.")
    print("-" * 78)

    total = len(scenario["steps"])
    for i, (text, hold) in enumerate(scenario["steps"], start=1):
        prompt_step(i, total, text)
        ts = time.time()
        manifest.markers.append(
            Marker(ts=ts, label=text, kind="action", detail=f"step {i}/{total}")
        )
        print(f"    ◆ marker @ {iso(ts)}")
        # Write incrementally: a crashed or aborted run must not lose markers.
        write_manifest(args.manifest, manifest)
        if hold:
            countdown(hold, text, quiet=args.quiet)

    manifest.finished_at = time.time()
    if args.capture_file:
        manifest.capture_files = [args.capture_file]
    write_manifest(args.manifest, manifest)

    print("\n" + "=" * 78)
    print(f"  DONE — {len(manifest.markers)} markers over "
          f"{manifest.finished_at - started:.1f}s")
    print(f"  Manifest: {args.manifest}")
    print("=" * 78)
    print("\n  Next steps:")
    print("    1. Stop and SAVE your capture (PacketLogger: Cmd-S as .pklg).")
    print("    2. Analyse it:")
    print(f"         ./analyze.py --file <capture> --manifest {args.manifest} \\")
    print(f"             --report ../../docs/virtual-shifting/experiments/NN-{args.scenario}.md")
    print("    3. Write the experiment record BEFORE running the next scenario.")
    return 0


def _readiness(backend: str) -> None:
    if backend == "android":
        try:
            info = sources.android_preflight()
            print(f"    device: {info.get('model')} (Android {info.get('android_release')})")
            snoop = info.get("snoop_enabled", "(unset)")
            if snoop not in ("true", "1"):
                print(f"    \033[33m! persist.bluetooth.btsnoopenable = {snoop}\033[0m")
                print("      Enable Developer options -> Bluetooth HCI snoop log,")
                print("      then toggle Bluetooth OFF and ON so the stack reopens the sink.")
            else:
                print("    HCI snoop log: enabled")
        except sources.SourceError as exc:
            print(f"    \033[31m! {exc}\033[0m")
    elif backend in ("pklg", "packetlogger", "macos"):
        info = sources.macos_preflight()
        if not info["packetlogger_installed"]:
            print("    \033[31m! PacketLogger.app not installed\033[0m")
            print(f"      {info['hint']}")
            return
        print(f"    PacketLogger found: {info['packetlogger_paths'][0]}")

        if info.get("running_instances"):
            print("    \033[31m! packetlogger is ALREADY RUNNING\033[0m")
            for line in info["running_instances"]:
                print(f"      {line[:100]}")
            print("      Only ONE process can hold the macOS HCI tap. A second one")
            print("      captures NOTHING and writes a single 'Disconnected from OS X")
            print("      Device' note — an empty capture that looks successful.")
            print("      Stop it first:  sudo pkill -INT -f 'packetlogger convert'")

        if info.get("translocated_instances"):
            print("    \033[31m! A stale App-Translocated copy is running\033[0m")
            for line in info["translocated_instances"]:
                print(f"      {line[:100]}")
            print("      That is a quarantined copy launched from the DMG. It can hold")
            print("      the HCI tap so the /Applications copy captures nothing.")
            print("      Fix: quit ALL PacketLogger instances, then relaunch from")
            print("      /Applications only.")

        if info.get("packetlogger_cli"):
            print("    \033[1mRecommended: use the CLI, not the GUI.\033[0m Run in another terminal:")
            print(f"      sudo {info['packetlogger_cli']} convert -o capture.pklg")
            print("    ...or capture and watch it live in one step:")
            print("      ./live.py --backend macos --out ../../captures/run.pklg --preset all")

        if not info.get("gui_helper_installed"):
            print("    \033[33m! The GUI's privileged helper is NOT installed\033[0m")
            print("      (com.apple.bluetooth.PacketLoggerHelper absent from")
            print("      /Library/PrivilegedHelperTools and /Library/LaunchDaemons)")
            print("      This is why the GUI shows an empty window with no error.")
            print("      Either accept the admin prompt on a clean relaunch from")
            print("      /Applications, or just use the CLI above — it only needs sudo.")

        if info["rolling_pklg_logs"]:
            print(f"    {len(info['rolling_pklg_logs'])} rolling .pklg log(s) present")
    else:
        print(f"    backend '{backend}': no automated check; make sure it is recording.")


def _wrap(text: str, width: int) -> list[str]:
    words, out, line = text.split(), [], ""
    for w in words:
        if len(line) + len(w) + 1 > width:
            out.append(line)
            line = w
        else:
            line = f"{line} {w}".strip()
    if line:
        out.append(line)
    return out


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="Scenarios:\n"
        + "\n".join(f"  {k:<24} {v['title']}" for k, v in SCENARIOS.items()),
    )
    p.add_argument("--scenario", choices=sorted(SCENARIOS), help="which scenario to run")
    p.add_argument("--list", action="store_true", help="list scenarios and exit")
    p.add_argument(
        "--backend",
        default="macos",
        choices=["macos", "pklg", "android", "other"],
        help="capture backend you are running alongside this script (default: pklg)",
    )
    p.add_argument("--out", default="../../captures", help="directory for the manifest")
    p.add_argument("--manifest", help="explicit manifest path (overrides --out)")
    p.add_argument("--capture-file", help="path of the capture file, recorded in the manifest")
    p.add_argument("--trainer", default="Wahoo KICKR CORE C26B", help="trainer identification")
    p.add_argument("--trainer-fw", default="1.5.36", help="trainer firmware version")
    p.add_argument("--controller", default="Zwift Click (Left+Right pair)", help="controller id")
    p.add_argument("--controller-fw", default="1.2", help="controller firmware version")
    p.add_argument("--app", default="", help="official app name + version, if used")
    p.add_argument("--harness", default="src/dev/ble-lab.html", help="our harness under test")
    p.add_argument("--host", default="", help="capture host description")
    p.add_argument("--notes", default="", help="free-text operator notes")
    p.add_argument("--quiet", action="store_true", help="no countdown animation")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
    )

    if args.list or not args.scenario:
        print("Scenarios:\n")
        for key, s in SCENARIOS.items():
            print(f"  \033[1m{key}\033[0m — {s['title']}")
            print(f"      Q: {s['question']}")
            print(f"      {len(s['steps'])} steps, "
                  f"~{sum(h for _, h in s['steps'])}s of holds\n")
        if not args.scenario:
            print("Pick one with --scenario NAME")
            return 1 if not args.list else 0
        return 0

    if not args.manifest:
        os.makedirs(args.out, exist_ok=True)
        stamp = time.strftime("%Y%m%d-%H%M%S")
        args.manifest = os.path.join(args.out, f"{stamp}-{args.scenario}.manifest.json")

    try:
        return run_scenario(args)
    except KeyboardInterrupt:
        print("\n\nInterrupted. Markers written so far are in:")
        print(f"  {args.manifest}")
        return 130


if __name__ == "__main__":
    sys.exit(main())
