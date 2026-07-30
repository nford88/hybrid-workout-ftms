#!/usr/bin/env python3
"""Pull an Android BLE capture off the phone and analyse it in one command.

The Android route is the only capture backend that actually works on this hardware
(`experiments/11`: macOS PacketLogger receives zero packets, the live snoop socket does not
exist on Android 16, `dumpsys` btsnooz carries no addresses). It has one wrinkle: no
operator is sitting there pressing enter to mark actions, so packets would be
unattributed — except the phone narrates itself in logcat, which this reads
(`blelab/androidlog.py`).

    ./android-capture.py --pull --scenario bridge-ride --device f4:c4:59:81:d9:a1
    ./android-capture.py --dir ~/Desktop/click --device f4:c4:59:81:d9:a1

BEFORE the ride, once per phone (both verified by --check):

    adb shell settings put system screen_off_timeout 1800000   # 30 min; 30 s cut a run short
    adb shell dumpsys bluetooth_manager | grep sSnoopLogSettingAtEnable   # want FULL

The snoop log is a rolling ~7-minute buffer, so run this IMMEDIATELY after the activity.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import shutil
import subprocess
import sys
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from blelab import androidlog, dissect, links, render  # noqa: E402

log = logging.getLogger("android-capture")
HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))


def adb(*args: str, timeout: int = 300) -> subprocess.CompletedProcess:
    return subprocess.run(["adb", *args], capture_output=True, text=True, timeout=timeout)


def check_phone() -> bool:
    """Verify the two settings that silently ruin a capture. Neither is default."""
    ok = True
    devices = adb("devices").stdout.strip().splitlines()[1:]
    attached = [d for d in devices if d.strip() and "device" in d]
    if not attached:
        print("✗ no adb device attached", file=sys.stderr)
        return False
    print(f"✓ adb device: {attached[0].split()[0]}")

    snoop = adb("shell", "dumpsys", "bluetooth_manager").stdout
    if "sSnoopLogSettingAtEnable = FULL" in snoop:
        print("✓ btsnoop mode is FULL")
    else:
        state = next(
            (l.strip() for l in snoop.splitlines() if "sSnoopLogSettingAtEnable" in l),
            "not reported",
        )
        print(f"✗ btsnoop not FULL ({state})", file=sys.stderr)
        print("   Developer options → Enable Bluetooth HCI snoop log → Enabled/FULL, "
              "then toggle Bluetooth off/on.", file=sys.stderr)
        ok = False

    timeout = adb("shell", "settings", "get", "system", "screen_off_timeout").stdout.strip()
    try:
        secs = int(timeout) / 1000
    except ValueError:
        secs = -1
    if secs >= 0 and secs < 300:
        print(f"⚠ screen timeout is {secs:.0f}s — it fired mid-session on 2026-07-29 and "
              f"became a confound.\n   adb shell settings put system screen_off_timeout 1800000")
        ok = False
    elif secs >= 300:
        print(f"✓ screen timeout {secs:.0f}s")
    return ok


def watch(addresses: list[str]) -> int:
    """Live connect/disconnect events, to confirm the PHONE holds the BLE links.

    This is the one thing that can waste a whole bench session: with Companion bridging to
    Zwift on a laptop, the *laptop* may connect the trainer and controllers over its own
    Bluetooth instead of using the bridge — and then the traffic never crosses the phone and
    the capture is empty. Watching the phone's event log while pairing tells you immediately
    which side won.

    Note the live wording differs from the bugreport's: a bugreport has
    `BLUETOOTH_DEVICE_EVENT` lines with full addresses, but **live logcat has none of those**.
    Live, a connect is two non-adjacent `BluetoothDeviceBatteryManager` lines with the address
    redacted to `F4C459_1`, which is why this uses `androidlog.AclWatcher` rather than the
    offline `parse_lines`. Both are fixture-tested against real captured log text.
    """
    # Android redacts the middle of the address in live logs, so expectations are matched
    # against that form as well as the device name.
    want = {androidlog.redact(a) for a in addresses if a}
    print("watching the phone's logs for BLE connect/disconnect events — Ctrl-C to stop.",
          flush=True)
    print("Pair the devices in Companion now. Each device should appear below;")
    print("if a device never appears, the Mac grabbed it directly over its own Bluetooth")
    print("and the phone will capture nothing for it.\n")
    if want:
        print("expecting: " + ", ".join(sorted(want))
              + "  (Android redacts the middle bytes)\n")
    seen: set[str] = set()
    year = int(subprocess.run(
        ["adb", "shell", "date", "+%Y"], capture_output=True, text=True,
    ).stdout.strip() or 0) or None
    # errors="replace": logcat carries raw bytes from native logs and is NOT valid UTF-8
    # (a 0xc0 byte crashed this on the first real run). A mangled character in an unrelated
    # log line must never take down the watch.
    # -T 1 starts from the tail: the log buffer holds hours of history, and replaying an
    # earlier session's connects would declare success before anything was paired.
    proc = subprocess.Popen(
        ["adb", "logcat", "-b", "all", "-v", "time", "-T", "1"],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        text=True, encoding="utf-8", errors="replace", bufsize=1,
    )
    assert proc.stdout
    acl = androidlog.AclWatcher()
    satisfied = False
    try:
        for line in proc.stdout:
            m = acl.feed(line, year or 2026)
            if m is None:
                continue
            addr = m.detail.replace("address ", "").strip().upper()
            import datetime as _dt
            when = _dt.datetime.fromtimestamp(m.ts).strftime("%H:%M:%S") if m.ts else "--:--:--"
            mark = "" if not want else ("  ← expected" if addr in want else "")
            print(f"  {when}  {m.label:<40} {addr}{mark}", flush=True)
            if "CONNECTED" in m.label and "DISCONNECTED" not in m.label:
                seen.add(addr)
            if want and not satisfied and want <= seen:
                satisfied = True
                print("\n✓ every expected device connected via the PHONE — the capture will "
                      "see them.\n  Ride now, then run --pull immediately afterwards. "
                      "Leaving the watch running is fine.\n", flush=True)
    except KeyboardInterrupt:
        print()
    finally:
        proc.terminate()
    if not seen:
        print("\n⚠ no BLE connect events seen while watching. Either nothing was paired, or "
              "this phone words them differently — in which case pair anyway and check the "
              "analysis afterwards: the report's 'Link sessions' section lists every link the "
              "phone actually held.")
        return 1
    missing = want - seen
    if missing:
        print(f"\n⚠ never saw: {', '.join(sorted(missing))} — if the Mac connected it "
              f"directly, unpair it there and re-pair in Companion.")
        return 1
    return 0


def pull_bugreport(dest_zip: str) -> str:
    """adb bugreport, then extract. Returns the extracted directory."""
    os.makedirs(os.path.dirname(os.path.abspath(dest_zip)) or ".", exist_ok=True)
    print(f"pulling bugreport to {dest_zip} (takes a couple of minutes)…", file=sys.stderr)
    r = adb("bugreport", dest_zip, timeout=900)
    if r.returncode != 0:
        raise SystemExit(f"adb bugreport failed: {r.stderr.strip()[:300]}")
    out_dir = dest_zip[:-4] if dest_zip.endswith(".zip") else dest_zip + ".d"
    if os.path.isdir(out_dir):
        shutil.rmtree(out_dir)
    with zipfile.ZipFile(dest_zip) as z:
        z.extractall(out_dir)
    return out_dir


def build_manifest(scenario: str, snoop: str, markers, notes: str) -> dict:
    return {
        "scenario": scenario,
        "backend": "android-bugreport",
        "operator_notes": notes,
        "hardware": {"capture_host": "Android phone (adb)"},
        "firmware": {},
        "environment": {"platform": "Android", "snoop_mode": "FULL"},
        "software": {"official_app": "Zwift Companion / Zwift game (bridged)"},
        "markers": [m.as_manifest_marker() for m in markers],
        "capture_files": [os.path.basename(snoop)],
        "marker_source": (
            "the phone's own logcat (blelab/androidlog.py), not a human at a keyboard — "
            "same clock as the rest of the phone, and available retroactively"
        ),
    }


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    src = p.add_mutually_exclusive_group()
    src.add_argument("--pull", action="store_true", help="take a fresh bugreport over adb")
    src.add_argument("--dir", help="an already-extracted bugreport directory")
    src.add_argument("--zip", help="an already-downloaded bugreport .zip")
    p.add_argument("--check", action="store_true", help="only verify phone readiness, then exit")
    p.add_argument("--watch", action="store_true",
                   help="live connect/disconnect events while you pair, to confirm the PHONE "
                        "holds the links and not the laptop; Ctrl-C to stop")
    p.add_argument("--expect", action="append", default=[], metavar="ADDR",
                   help="address --watch should wait for (repeatable)")
    p.add_argument("--scenario", default="android-session", help="name recorded in the manifest")
    p.add_argument("--device", help="peer address to focus the analysis on")
    p.add_argument("--notes", default="", help="operator notes for the manifest")
    p.add_argument("--out", help="directory for the copied capture + manifest "
                                "(default: <repo>/captures)")
    p.add_argument("--no-analyze", action="store_true", help="stop after writing the manifest")
    p.add_argument("-v", "--verbose", action="store_true")
    args = p.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(levelname)s %(name)s: %(message)s", stream=sys.stderr,
    )

    if args.watch:
        check_phone()
        expect = args.expect or ([args.device] if args.device else [])
        return watch(expect)

    if args.check or not (args.pull or args.dir or args.zip):
        ready = check_phone()
        if args.check:
            return 0 if ready else 1
        if not (args.pull or args.dir or args.zip):
            print("\nnothing to do — pass --pull, --dir or --zip", file=sys.stderr)
            return 1

    if args.pull:
        if not check_phone():
            print("\nphone not ready; fix the above and retry (or --dir an old capture)",
                  file=sys.stderr)
            return 1
        stamp = render.now_stamp()
        root = pull_bugreport(os.path.expanduser(f"~/Desktop/bugreport-{stamp}.zip"))
    elif args.zip:
        z = os.path.expanduser(args.zip)
        root = z[:-4] if z.endswith(".zip") else z + ".d"
        if os.path.isdir(root):
            shutil.rmtree(root)
        with zipfile.ZipFile(z) as zf:
            zf.extractall(root)
    else:
        root = os.path.expanduser(args.dir)

    snoop, dumpstate = androidlog.find_bugreport_parts(root)
    if not snoop:
        print(f"error: no btsnoop_hci.log under {root}", file=sys.stderr)
        return 2
    print(f"snoop log : {snoop} ({os.path.getsize(snoop) / 1e6:.1f} MB)")
    print(f"dumpstate : {dumpstate or '(none — markers unavailable)'}")

    markers = []
    if dumpstate:
        print("reading the phone's logs for markers…", file=sys.stderr)
        markers = androidlog.read_markers(dumpstate)
        offset = 0.0
        try:
            epochs = dissect.capture_epochs(snoop)
            offset = androidlog.time_offset(epochs, markers)
        except (dissect.TsharkError, OSError) as exc:
            log.warning("could not read capture timestamps (%s); markers left uncorrected", exc)
        for m in markers:
            m.ts += offset
        print(f"\n{len(markers)} marker(s) from the phone's own logs:")
        for m in markers:
            import datetime as _dt
            when = _dt.datetime.fromtimestamp(m.ts - offset).strftime("%H:%M:%S")
            print(f"  {when}  [{m.kind}] {m.label}" + (f" — {m.detail}" if m.detail else ""))

    out_dir = args.out or os.path.join(REPO, "captures")
    os.makedirs(out_dir, exist_ok=True)
    stamp = render.now_stamp()
    base = f"{stamp}-{args.scenario}"
    kept = os.path.join(out_dir, base + ".btsnoop")
    shutil.copy2(snoop, kept)
    manifest_path = os.path.join(out_dir, base + ".manifest.json")
    with open(manifest_path, "w") as fh:
        json.dump(build_manifest(args.scenario, kept, markers, args.notes), fh, indent=2)
    print(f"\ncapture  : {kept}\nmanifest : {manifest_path}")

    # Link lifetimes first — on a drop investigation this is the whole answer.
    try:
        for s in links.sessions(kept):
            print(f"  link {s.describe()}")
    except (dissect.TsharkError, OSError) as exc:
        log.warning("link summary unavailable: %s", exc)

    if args.no_analyze:
        return 0
    cmd = [sys.executable, os.path.join(HERE, "analyze.py"), "--file", kept,
           "--manifest", manifest_path]
    if args.device:
        cmd += ["--device", args.device]
    report = os.path.join(out_dir, base + ".report.md")
    cmd += ["--report", report]
    print(f"\nanalysing → {report}", file=sys.stderr)
    r = subprocess.run(cmd)
    return r.returncode


if __name__ == "__main__":
    sys.exit(main())
