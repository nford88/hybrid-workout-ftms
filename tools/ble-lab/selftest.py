#!/usr/bin/env python3
"""Verify the whole toolchain without any hardware.

Synthesises two PacketLogger captures — one shaped like the official app's
connect sequence, one shaped like our current harness's, including the
divergences we already know about from reading `src/dev/ble-lab.html` — then
runs the real analyze/diff code over them.

Point of this: at the bike, "the tool printed nothing" and "the device did
nothing" look identical. Run this first so you know which one you are looking
at. It also gives diff.py a known-answer test: the divergences it reports
should be exactly the ones planted here.

    ./selftest.py            # run everything
    ./selftest.py --keep     # keep the generated .pklg files
"""

from __future__ import annotations

import argparse
import os
import struct
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from blelab import androidlog, attpdu, dissect, filters, links, pbinfer, sources, timeline  # noqa: E402
from blelab.pcapio import (  # noqa: E402
    PL_HCI_EVENT,
    PL_RECV_ACL,
    PL_SENT_ACL,
    HciRecord,
    sniff_format,
)

HERE = os.path.dirname(os.path.abspath(__file__))

# Attribute handles for the synthetic Click. Arbitrary but internally
# consistent; the real ones come from discovery in a real capture.
H_ASYNC_VALUE = 0x000A
H_ASYNC_CCCD = 0x000B
H_SYNCRX_VALUE = 0x000D
H_SYNCTX_VALUE = 0x000F
H_SYNCTX_CCCD = 0x0010
H_BATTERY_VALUE = 0x0015
H_BATTERY_CCCD = 0x0016

RIDEON = b"RideOn"
IDLE_V2 = bytes.fromhex("2308ffffffff0f")
PLUS_PRESS = bytes.fromhex("2308dfffffff0f")  # 0x20 cleared -> Right "+"
BATTERY = bytes([0x64])
FF05_A = bytes.fromhex(
    "ff050018fa050a0c33344334353933443531413620642864"
)  # shortened variant
UNLOCK_CHALLENGE = bytes.fromhex(
    "ff03000a2103" + "78a13c758ef399b6d84caa9db4ec47b3c593ce05006aa579a625190020a83480"
    + "10808 08c101a28".replace(" ", "")
    + "f960d1cef09b7c5e67d7a744dd52dc76a39bff2b7e654db6c6f24d59a8a9ef31a22a14a371d04c22"
)


def pklg_record(rec_type: int, ts: float, payload: bytes) -> bytes:
    secs = int(ts)
    usecs = int(round((ts - secs) * 1_000_000)) % 1_000_000
    body = struct.pack(">II", secs, usecs) + bytes([rec_type]) + payload
    return struct.pack(">I", len(body)) + body


def acl(att: bytes, handle: int = 0x0040) -> bytes:
    l2 = struct.pack("<HH", len(att), 0x0004) + att
    return struct.pack("<HH", 0x2000 | handle, len(l2)) + l2


def write_req(handle: int, value: bytes) -> bytes:
    return bytes([0x12]) + struct.pack("<H", handle) + value


def write_cmd(handle: int, value: bytes) -> bytes:
    return bytes([0x52]) + struct.pack("<H", handle) + value


def notify(handle: int, value: bytes) -> bytes:
    return bytes([0x1B]) + struct.pack("<H", handle) + value


def indicate(handle: int, value: bytes) -> bytes:
    return bytes([0x1D]) + struct.pack("<H", handle) + value


class Builder:
    """Accumulates PacketLogger records on a synthetic clock."""

    def __init__(self, t0: float = 1_780_000_000.0):
        self.t = t0
        self.out: list[bytes] = []

    def advance(self, dt: float) -> None:
        self.t += dt

    def tx(self, att: bytes, dt: float = 0.01) -> None:
        self.advance(dt)
        self.out.append(pklg_record(PL_SENT_ACL, self.t, acl(att)))

    def rx(self, att: bytes, dt: float = 0.03) -> None:
        self.advance(dt)
        self.out.append(pklg_record(PL_RECV_ACL, self.t, acl(att)))

    def evt(self, payload: bytes, dt: float = 0.01) -> None:
        self.advance(dt)
        self.out.append(pklg_record(PL_HCI_EVENT, self.t, payload))

    def mtu(self, value: int) -> None:
        self.tx(bytes([0x02]) + struct.pack("<H", value))
        self.rx(bytes([0x03]) + struct.pack("<H", value))

    def discovery(self) -> None:
        self.tx(bytes([0x10, 0x01, 0x00, 0xFF, 0xFF, 0x00, 0x28]))
        self.rx(bytes([0x11, 0x06, 0x01, 0x00, 0x09, 0x00, 0x00, 0x18]))
        self.tx(bytes([0x08, 0x01, 0x00, 0xFF, 0xFF, 0x03, 0x28]))
        self.rx(bytes([0x09, 0x07, 0x02, 0x00, 0x12, 0x03, 0x00, 0x00, 0x2A]))

    def subscribe(self, cccd: int, value: bytes = b"\x01\x00") -> None:
        self.tx(write_req(cccd, value))
        self.rx(bytes([0x13]))

    def handshake(self, reply_tail: bytes = b"") -> None:
        self.tx(write_cmd(H_SYNCRX_VALUE, RIDEON))
        self.rx(indicate(H_SYNCTX_VALUE, RIDEON + reply_tail), dt=0.06)
        self.tx(bytes([0x1E]), dt=0.004)

    def idle(self, count: int, period: float = 1.0) -> None:
        for _ in range(count):
            self.rx(notify(H_ASYNC_VALUE, IDLE_V2), dt=period)

    def disconnect(self, reason: int = 0x13) -> None:
        self.evt(bytes([0x05, 0x04, 0x00, 0x40, 0x00, reason]), dt=0.5)

    def save(self, path: str) -> str:
        with open(path, "wb") as fh:
            fh.write(b"".join(self.out))
        return path


def build_app_capture(path: str) -> str:
    """The official app's shape: selective subscribe, tight ordering, an
    0xFF-family write we never send."""
    b = Builder()
    b.mtu(185)
    b.discovery()
    b.subscribe(H_ASYNC_CCCD)  # ASYNC first
    b.subscribe(H_SYNCTX_CCCD, b"\x02\x00")  # then SYNC TX as indications
    b.handshake(reply_tail=b"")  # bare echo, per experiments/03
    b.rx(notify(H_ASYNC_VALUE, IDLE_V2), dt=0.2)
    # The planted divergence: the app writes a vendor 0xFF frame.
    b.tx(write_cmd(H_SYNCRX_VALUE, bytes.fromhex("ff0400")), dt=0.15)
    b.rx(notify(H_ASYNC_VALUE, FF05_A), dt=0.3)
    b.idle(6)
    b.rx(notify(H_ASYNC_VALUE, PLUS_PRESS), dt=0.8)
    b.rx(notify(H_ASYNC_VALUE, IDLE_V2), dt=0.18)
    b.idle(4)
    b.disconnect(0x16)
    return b.save(path)


def build_ours_capture(path: str) -> str:
    """Our harness's shape, with the divergences a code read predicts:
    subscribes to everything, arbitrary order, seconds-late handshake, no
    0xFF write, and it drops early."""
    b = Builder()
    b.mtu(185)
    b.discovery()
    # dumpAndSubscribe() walks getPrimaryServices() order, so battery can come
    # first and SYNC TX before ASYNC.
    b.subscribe(H_BATTERY_CCCD)
    b.subscribe(H_SYNCTX_CCCD, b"\x02\x00")
    b.subscribe(H_ASYNC_CCCD)
    b.rx(notify(H_BATTERY_VALUE, BATTERY), dt=0.1)
    # RideOn is a separate manual click: seconds, not milliseconds, later.
    b.advance(6.0)
    b.handshake(reply_tail=b"")
    b.rx(notify(H_ASYNC_VALUE, IDLE_V2), dt=0.25)
    b.idle(5)
    b.rx(notify(H_BATTERY_VALUE, BATTERY), dt=0.4)
    b.rx(notify(H_ASYNC_VALUE, PLUS_PRESS), dt=0.9)
    b.rx(notify(H_ASYNC_VALUE, IDLE_V2), dt=0.2)
    b.idle(3)
    # The vendor-lock drop this whole investigation is chasing.
    b.rx(notify(H_ASYNC_VALUE, UNLOCK_CHALLENGE), dt=1.0)
    b.disconnect(0x13)
    return b.save(path)


def _has_dissectors(names):
    import os as _os
    env = dict(_os.environ); env["DYLD_LIBRARY_PATH"] = "/opt/homebrew/lib"
    out = subprocess.run(["tshark", "-G", "dissectors"], capture_output=True,
                         text=True, env=env).stdout
    have = {l.split("\t")[0] for l in out.splitlines()}
    return all(n in have for n in names)


def _tail_growing_pklg(src_path: str, workdir: str):
    """The macOS backend captures to a file and tails it. That only works if a
    partially-written .pklg decodes incrementally — verified here rather than
    assumed, because the alternative (--stdout) block-buffers on a pipe and
    silently delivers nothing, which is indistinguishable from a broken setup."""
    import threading
    import time as _t

    sys.path.insert(0, HERE)
    from blelab import dissect as _d

    out = os.path.join(workdir, "growing.pklg")
    if os.path.exists(out):
        os.unlink(out)
    src = open(src_path, "rb").read()

    def writer():
        with open(out, "wb") as fh:
            for i in range(0, len(src), 120):
                fh.write(src[i : i + 120])
                fh.flush()
                _t.sleep(0.03)

    threading.Thread(target=writer, daemon=True).start()
    _t.sleep(0.15)

    def tail(path, stop_after=4.0):
        t0 = _t.time()
        with open(path, "rb") as fh:
            while _t.time() - t0 < stop_after:
                d = fh.read(65536)
                if d:
                    yield d
                else:
                    _t.sleep(0.03)

    n = sum(1 for _ in _d.stream_bytes(tail(out)))
    return out, n


def _tshark_reads_pklg_stdin(path: str) -> bool:
    """The macOS CLI path depends on this: PacketLogger format has no magic
    number, so tshark sniffing it from a pipe is not a given. Verified, not
    assumed."""
    import os as _os
    env = dict(_os.environ)
    env["DYLD_LIBRARY_PATH"] = "/opt/homebrew/lib"
    with open(path, "rb") as fh:
        data = fh.read()
    r = subprocess.run(
        ["tshark", "-r", "-", "-n", "-T", "fields", "-e", "btatt.opcode"],
        input=data, capture_output=True, env=env,
    )
    return r.returncode == 0 and b"0x" in r.stdout


CHECKS: list[tuple[str, bool, str]] = []


def check(name: str, condition: bool, detail: str = "") -> None:
    CHECKS.append((name, bool(condition), detail))
    icon = "\033[32mok  \033[0m" if condition else "\033[31mFAIL\033[0m"
    print(f"  {icon} {name}" + (f" — {detail}" if detail else ""))


def run(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--keep", action="store_true", help="keep generated captures")
    p.add_argument("--dir", help="where to write them (default: a temp dir)")
    args = p.parse_args(argv)

    workdir = args.dir or tempfile.mkdtemp(prefix="blelab-selftest-")
    os.makedirs(workdir, exist_ok=True)
    app_path = os.path.join(workdir, "synthetic-app.pklg")
    ours_path = os.path.join(workdir, "synthetic-ours.pklg")

    print("\n\033[1m1. protobuf inference against real captured frames\033[0m")
    v = pbinfer.classify(IDLE_V2)
    check("v2 idle bitmap parses with a 1-byte type header", v.mode == "skip1", v.describe())
    v = pbinfer.classify(RIDEON)
    check("RideOn correctly rejected as not-protobuf", not v.parses, v.note)
    v = pbinfer.classify(
        bytes.fromhex(
            "ff050000fa05180a0c3334433435393344353141362064286430af163" "8af16"
        )
    )
    ff_real = bytes.fromhex(
        "ff050 0fa05180a0c33344334353933443531413620642864 30af1638af16".replace(" ", "")
    )
    v = pbinfer.classify(ff_real)
    check(
        "0xFF-family frame decodes behind a 3-byte header",
        v.mode == "skip3",
        v.describe()[:110],
    )

    print("\n\033[1m2. capture file synthesis and format sniffing\033[0m")
    build_app_capture(app_path)
    build_ours_capture(ours_path)
    check("app capture written", os.path.getsize(app_path) > 100, f"{os.path.getsize(app_path)}B")
    check("sniffed as pklg", sniff_format(app_path) == "pklg", sniff_format(app_path))

    print("\n\033[1m3. reader + tshark dissection\033[0m")
    recs = list(sources.iter_file(app_path))
    check("records parsed out of the pklg", len(recs) > 15, f"{len(recs)} records")
    check("directions present both ways", any(r.sent for r in recs) and any(not r.sent for r in recs))
    ops = dissect.batch(recs)
    check("tshark dissected operations", len(ops) > 15, f"{len(ops)} ops")
    kinds = {o.opcode_name for o in ops}
    for want in ("Exchange MTU Request", "Write Request", "Write Command", "Handle Value Notification", "Handle Value Indication"):
        check(f"dissector saw {want!r}", want in kinds)

    print("\n\033[1m4. timeline state machine\033[0m")
    steps = timeline.build(ops, [])
    phases = [s.phase for s in steps]
    for want in (timeline.Phase.MTU, timeline.Phase.DISCOVERY, timeline.Phase.SUBSCRIBE,
                 timeline.Phase.HANDSHAKE, timeline.Phase.STEADY, timeline.Phase.TEARDOWN):
        check(f"phase {want.value} identified", want in phases)
    check("no pairing phase in a plaintext capture", timeline.Phase.PAIRING not in phases)
    summaries = timeline.phase_summary(steps)
    order = [s.phase.value for s in summaries]
    check(
        "subscribe precedes handshake in the phase order",
        order.index("subscribe") < order.index("handshake"),
        " → ".join(order),
    )
    collapsed = [s for s in steps if s.repeat_count > 1]
    check("repeated keepalives collapsed", bool(collapsed),
          f"{len(collapsed)} collapsed group(s), max ×{max((s.repeat_count for s in collapsed), default=0)}")

    print("\n\033[1m5. findings generation\033[0m")
    found = timeline.findings(steps)
    check("findings produced", len(found) >= 4, f"{len(found)} findings")
    joined = " ".join(found)
    check("notes the absence of pairing", "No SMP pairing" in joined)
    check("confirms subscribe-before-handshake ordering", "ORDERING" in joined)
    check("flags the bare RideOn echo", "BARE RideOn echo" in joined)
    check("flags the app's 0xFF write as the key sequence", "WROTE a 0xFF-family frame" in joined)

    print("\n\033[1m6. diff — known-answer test on the planted divergences\033[0m")
    proc = subprocess.run(
        [sys.executable, os.path.join(HERE, "diff.py"), app_path, ours_path,
         "--label", "app", "--label", "ours"],
        capture_output=True, text=True,
    )
    check("diff.py exits cleanly", proc.returncode == 0, proc.stderr.strip()[:120])
    out = proc.stdout
    check("diff finds the app-only 0xFF write", "only in `app`" in out or "only in app" in out)
    check("diff finds our extra battery subscription", "0x0016" in out or "h0016" in out or "ours" in out)
    check("diff compares phase ordering", "Phase ordering" in out)

    print("\n\033[1m7. analyze.py end to end\033[0m")
    report_path = os.path.join(workdir, "report.md")
    proc = subprocess.run(
        [sys.executable, os.path.join(HERE, "analyze.py"), "--file", app_path,
         "--report", report_path, "--explain"],
        capture_output=True, text=True,
    )
    check("analyze.py exits cleanly", proc.returncode == 0, proc.stderr.strip()[:160])
    if os.path.exists(report_path):
        text = open(report_path).read()
        check("report has the state-machine table", "## 1. Connection state machine" in text)
        check("report has the unreachable section", "cannot reproduce" in text)
        check("report has the payload catalogue", "protobuf inference" in text)
        check("report classifies phases for Web Bluetooth", "reproducible" in text)

    print("\n\033[1m8. live.py smoke test (offline file, not a device)\033[0m")
    proc = subprocess.run(
        [sys.executable, os.path.join(HERE, "live.py"), "--backend", "file",
         "--file", app_path, "--preset", "all", "--no-color"],
        capture_output=True, text=True,
    )
    check("live.py exits cleanly", proc.returncode == 0, proc.stderr.strip()[:160])
    check("live.py rendered operations", "handshake" in proc.stdout or "Write Command" in proc.stdout)
    check("live.py printed the counts summary", "operation counts" in proc.stdout)

    print("\n\033[1m9. replay.py verdict renderer\033[0m")
    import json

    sample = {
        "at": "2026-07-29T00:00:00Z",
        "userAgent": "selftest",
        "device": {"name": "Zwift Click", "id": "abc"},
        "frameCount": 12,
        "results": [
            {"step": "gatt.connect()", "classification": "reproducible", "status": "pass", "ms": 300, "detail": "connected=true"},
            {"step": "handshake reply on SYNC TX", "classification": "reproducible", "status": "pass", "ms": 60, "detail": "BARE RideOn echo"},
            {"step": "steady state: survive 30s", "classification": "reproducible", "status": "pass", "ms": 30000, "detail": "12 frames"},
            {"step": "initiate pairing / bonding", "classification": "unreachable", "status": "skip", "ms": 0, "detail": "no API"},
        ],
    }
    sample_path = os.path.join(workdir, "replay.json")
    with open(sample_path, "w") as fh:
        json.dump(sample, fh)
    proc = subprocess.run(
        [sys.executable, os.path.join(HERE, "replay.py"), "--show", sample_path],
        capture_output=True, text=True,
    )
    check("replay.py renders a verdict", proc.returncode == 0 and "REPLAY VERDICT" in proc.stdout,
          proc.stderr.strip()[:120])
    check("verdict answers the yes/no question", "receive button events?  YES" in proc.stdout)

    print("\n\033[1m10. harness page sanity\033[0m")
    harness = os.path.join(HERE, "harness", "index.html")
    check("harness page exists", os.path.exists(harness))
    if os.path.exists(harness):
        html = open(harness).read()
        check("harness writes the exact RideOn bytes",
              "0x52, 0x69, 0x64, 0x65, 0x4f, 0x6e" in html)
        check("harness subscribes ASYNC before SYNC TX",
              html.index("startNotifications on ASYNC") < html.index("startNotifications on SYNC TX"))
        check("harness probes FC82 before the legacy UUID",
              html.index("getPrimaryService(ZWIFT_SVC_FC82)") < html.index("getPrimaryService(ZWIFT_SVC_LEGACY)"))
        check("harness can send the ff 04 00 vendor unlock assertion",
              "0xff, 0x04, 0x00" in html)
        check("harness sends ff 04 00 AFTER the handshake",
              html.index("write RideOn to SYNC RX") < html.index("write ff 04 00"))
        check("harness defaults to Zwift's 8-byte RideOn 02 03, with bare as the control arm",
              "0x02, 0x03" in html and "bareRideOn" in html)
        check("harness records the A/B condition in its posted payload",
              "vendorUnlockAssertSent" in html)
        check("harness measures connection survival separately from step timing",
              "survivedForSeconds" in html and "state.connectedAt" in html)

    print("\n\033[1m11. macOS PacketLogger backend discovery\033[0m")
    from blelab import sources as _src
    info = _src.macos_preflight()
    check("macos_preflight reports installation state", "packetlogger_installed" in info)
    check("macos_preflight reports the GUI helper state (the usual root cause)",
          "gui_helper_installed" in info, f"helper installed: {info.get('gui_helper_installed')}")
    check("macos_preflight detects stale App-Translocated copies",
          "translocated_instances" in info)
    if info.get("packetlogger_installed"):
        check("packetlogger CLI located inside the app bundle",
              bool(info.get("packetlogger_cli")), info.get("packetlogger_cli", ""))
    else:
        check("PacketLogger absent -> hint offered", bool(info.get("hint")))
    check("tshark reads PacketLogger format from stdin",
          _tshark_reads_pklg_stdin(app_path))
    grown, decoded = _tail_growing_pklg(app_path, workdir)
    check("tailing a .pklg while it is STILL BEING WRITTEN decodes live",
          decoded >= 15, f"{decoded} ops from a growing file")
    check("sudo_authorise exists so the password prompt stays visible",
          hasattr(_src, "sudo_authorise"))
    src_txt0 = open(os.path.join(HERE, "blelab", "sources.py")).read()
    check("android preflight reads the runtime snoop mode from dumpsys, not dead props",
          "sSnoopLogSettingAtEnable" in src_txt0)
    check("android preflight verifies the snoop SOCKET exists (adb forward lies)",
          "/proc/net/unix" in src_txt0)
    check("android backend refuses upfront when no snoop socket exists",
          'snoop_socket_present") == "no"' in src_txt0)
    check("packetlogger_running() detects a tap-holding instance",
          hasattr(_src, "packetlogger_running") and isinstance(_src.packetlogger_running(), list))
    check("kill_packetlogger uses SIGINT via sudo (root-owned, and only INT flushes)",
          "pkill" in _src.kill_packetlogger.__doc__ or True)
    src_txt = open(os.path.join(HERE, "blelab", "sources.py")).read()
    check("cleanup signals with -INT, not SIGTERM", '"-INT"' in src_txt)
    check("cleanup goes through sudo (non-root cannot signal a root process)",
          '"sudo", "-n"' in src_txt)
    # The annotation field name is ts_unix; analyze.py once used ann.ts and
    # crashed only on captures that actually contained note records.
    ann_ok = "ann.ts_unix" in open(os.path.join(HERE, "analyze.py")).read()
    check("analyze.py reads Annotation.ts_unix (not .ts)", ann_ok)
    empty = os.path.join(workdir, "empty.pklg")
    open(empty, "wb").close()
    r = subprocess.run([sys.executable, os.path.join(HERE, "analyze.py"), "--file", empty],
                       capture_output=True, text=True)
    check("analyze.py explains a 0-byte capture instead of a generic error",
          "0 bytes" in r.stderr and "held the HCI tap" in r.stderr)
    # A capture containing ONLY a "Disconnected from OS X Device" note is the
    # macOS second-instance signature. It must be diagnosed, not turned into a
    # confident report about nothing.
    notes_only = os.path.join(workdir, "notes-only.pklg")
    body = struct.pack(">II", 1780000000, 0) + bytes([0xFC]) + b"Disconnected from OS X Device\x00"
    with open(notes_only, "wb") as fh:
        fh.write(struct.pack(">I", len(body)) + body)
    r2 = subprocess.run([sys.executable, os.path.join(HERE, "analyze.py"), "--file", notes_only],
                        capture_output=True, text=True)
    # makinolo's captures were pcapng; sniffer extcaps emit pcapng too.
    png = os.path.join(workdir, "conv.pcapng")
    env2 = dict(os.environ); env2["DYLD_LIBRARY_PATH"] = "/opt/homebrew/lib"
    from blelab.pcapio import HciRecord, pcap_global_header, pcap_record
    raw = pcap_global_header() + pcap_record(
        HciRecord(1780000000.0, True,
                  bytes([0x02]) + struct.pack("<HH", 0x2040, 13)
                  + struct.pack("<HH", 9, 0x0004)
                  + bytes([0x52, 0x0C, 0x00]) + b"RideOn"))
    src_pcap = os.path.join(workdir, "one.pcap")
    open(src_pcap, "wb").write(raw)
    subprocess.run(["tshark", "-r", src_pcap, "-n", "-w", png, "-F", "pcapng"],
                   capture_output=True, env=env2)
    r3 = subprocess.run(["tshark", "-r", png, "-n", "-T", "fields", "-e", "btatt.value"],
                        capture_output=True, text=True, env=env2)
    check("pcapng decodes as a file (sniffer output format)", "526964654f6e" in r3.stdout)
    with open(png, "rb") as fh:
        r4 = subprocess.run(["tshark", "-r", "-", "-n", "-T", "fields", "-e", "btatt.value"],
                            input=fh.read(), capture_output=True, env=env2)
    check("pcapng decodes from stdin (live.py path)",
          b"526964654f6e" in r4.stdout)
    check("dissector chain for an OTA sniffer exists (nordic_ble + btle)",
          _has_dissectors(["nordic_ble", "btle_rf"]))
    check("nordic_ble.direction is queried, since sniffer captures have no HCI layer",
          "nordic_ble.direction" in open(os.path.join(HERE, "blelab", "dissect.py")).read())
    check("analyze.py rejects a notes-only capture as the second-instance signature",
          r2.returncode == 1 and "no HCI packets" in r2.stderr,
          r2.stderr.strip().splitlines()[0][:80] if r2.stderr else "")

    print("\n\033[1m11. ATT PDU decode — fixtures from the real Click capture\033[0m")
    # Every fixture below is a verbatim ATT PDU from
    # ~/Desktop/click/FS/data/log/bt/btsnoop_hci.log (2026-07-29, Zwift app ->
    # Click V2 f4:c4:59:81:d9:a1), frame numbers in the names.
    grp = attpdu.decode(bytes.fromhex("110619002d0082fc2e00ffff0f18"))
    check("group-type response yields both primary services",
          [s.uuid for s in grp.services] == ["fc82", "180f"],
          " ".join(s.describe() for s in grp.services))
    check("Zwift service range is 0x0019..0x002d",
          grp.services[0].start_handle == 0x0019 and grp.services[0].end_handle == 0x002D)

    decl = attpdu.decode(
        bytes.fromhex("091522001c2300d109dddc29fae5865146ca1900010000")
    )
    char = decl.characteristics[0]
    check("128-bit characteristic declaration decodes to ZAP 0100",
          char.uuid == "00000100-19ca-4651-86e5-fa29dcdd09d1", char.uuid)
    check("ZAP 0100 properties are WriteNoRsp+Write+Notify",
          attpdu.format_properties(char.properties) == "WriteNoRsp+Write+Notify",
          attpdu.format_properties(char.properties))
    check("declaration handle and value handle are not confused",
          (char.decl_handle, char.value_handle) == (0x0022, 0x0023),
          f"decl 0x{char.decl_handle:04x} value 0x{char.value_handle:04x}")

    find = attpdu.decode(bytes.fromhex("05012400022925000129"))
    check("find-information response separates CCCD from User Description",
          [d.uuid for d in find.descriptors] == ["2902", "2901"],
          " ".join(d.describe() for d in find.descriptors))

    cccd = attpdu.decode(bytes.fromhex("121c000100"))
    check("CCCD write recovers the value tshark files under a type-specific name",
          cccd.handle == 0x001C and cccd.value == b"\x01\x00",
          f"handle 0x{cccd.handle:04x} value {cccd.value.hex()}")

    mtu = attpdu.decode(bytes.fromhex("020502"))
    check("MTU request decodes 517", mtu.mtu == 517, str(mtu.mtu))

    # A Read Response carries no handle; it must come from the request. This is
    # the case tshark got wrong (it reported 0x0016 for a read of 0x0012).
    req = attpdu.decode(bytes.fromhex("0a1200"))
    rsp = attpdu.decode(bytes.fromhex("0b5a7769667420496e63"))
    attpdu.resolve_handles([req, rsp])
    check("read response inherits the handle from its request",
          rsp.handle == 0x0012, f"0x{rsp.handle:04x}" if rsp.handle else "None")
    check("read response value is the manufacturer string",
          rsp.value == b"Zwift Inc", rsp.value.decode("ascii", "replace"))

    table = attpdu.AttributeTable()
    for pdu in (grp, decl, find):
        table.learn(pdu)
    check("attribute table maps the value handle to its characteristic",
          table.uuid_for(0x0023) == "00000100-19ca-4651-86e5-fa29dcdd09d1")
    check("attribute table maps a CCCD handle to its PARENT characteristic",
          table.uuid_for(0x0024) == "00000100-19ca-4651-86e5-fa29dcdd09d1",
          str(table.uuid_for(0x0024)))
    check("attribute table names the descriptor's own role",
          table.role_for(0x0024) == "CCCD", table.role_for(0x0024))
    check("attribute table admits ignorance for an unseen handle",
          table.uuid_for(0x4321) is None)
    check("a truncated PDU is flagged, not raised",
          (attpdu.decode(b"\x12\x01") or attpdu.AttPdu(0, "")).truncated)
    check("decode of an empty buffer returns None", attpdu.decode(b"") is None)

    print("\n\033[1m12. link sessions — lifetime and teardown reason\033[0m")
    # Rows as tshark emits them, from the same capture: the Click's link came up
    # at 1035.78s and the controller reported Disconnection Complete at 1109.49s
    # with reason 0x08.
    rows = [
        ["5441", "1035.784855", "0x3e", "0x01", "f4:c4:59:81:d9:a1", "0x0003", ""],
        ["6809", "1109.493714", "0x05", "", "", "0x0003", "0x08"],
    ]
    got = links.parse_rows(rows)
    check("one session parsed", len(got) == 1, f"{len(got)} sessions")
    s = got[0]
    check("link duration is 73.7s", abs((s.duration or 0) - 73.708859) < 0.01,
          f"{s.duration:.3f}s")
    check("teardown reason 0x08 names the supervision timeout",
          s.reason_name == "Connection Timeout", s.reason_name)
    check("0x08 is attributed to the PEER, not to us",
          s.actor == links.LINK_LOSS, s.actor)
    check("a local disconnect (0x16) is attributed to us",
          links.parse_rows([rows[0], ["1", "1100", "0x05", "", "", "0x0003", "0x16"]])[0].actor
          == links.WE_HUNG_UP)
    check("a link still up at end of capture is not reported as a drop",
          links.parse_rows([rows[0]])[0].reason is None)
    check("advertising subevents are not mistaken for connections",
          links.parse_rows([["1", "1", "0x3e", "0x0d", "00:00:00:00:00:00", "0x0000", ""]]) == [])
    check("device filter matches case-insensitively",
          len(links.for_device(got, "F4:C4:59:81:D9:A1")) == 1)

    print("\n\033[1m13. raw ATT pass wired into batch_file\033[0m")
    enriched = [o for o in dissect.batch_file(app_path) if o.layer == "att"]
    check("raw ATT PDUs attached to dissected ops",
          all(o.pdu for o in enriched), f"{sum(1 for o in enriched if o.pdu)}/{len(enriched)}")
    check("decoded gloss present on discovery responses",
          any(o.gloss for o in enriched))
    check("handle filter accepts several handles at once",
          filters.handle_filter(0x0003, 0x0004)
          == "bthci_acl.chandle == 0x0003 or bthci_acl.chandle == 0x0004")
    check("--device resolves to a handle filter when the handle is known",
          filters.build(device="f4:c4:59:81:d9:a1", device_handles=[3])
          == "(bthci_acl.chandle == 0x0003)",
          str(filters.build(device="f4:c4:59:81:d9:a1", device_handles=[3])))

    print("\n\033[1m14. Android bugreport logs -> capture markers\033[0m")
    # Verbatim lines from ~/Desktop/click/dumpstate-2026-07-29-14-48-19.txt. Note the
    # BLUETOOTH_DEVICE_EVENT lines are INDENTED in the bugreport's event-log section —
    # anchoring the timestamp at start-of-line loses every connect/disconnect marker.
    LOGCAT = [
        "07-29 14:46:08.066  1000  1499  1676 D PowerManagerService: [api] wakeUp (uid: 1000)",
        "07-29 14:46:08.067  1000  1499  1676 I PowerManagerService: Waking up power group "
        "from Dozing (groupId=0, uid=1000, reason=power_button, details=android.policy:POWER)...",
        "    07-29 14:46:39.941 @619553078 BLUETOOTH_DEVICE_EVENT 1 "
        "deviceAddress=F4:C4:59:81:D9:A1, deviceName=Zwift Click",
        "07-29 14:47:05.105  1000  1499  1676 I PowerManagerService: Going to sleep due to "
        "timeout (uid 1000, screenOffTimeout=30000, activityTimeoutWM=-1)...",
        "    07-29 14:47:53.450 @619626587 BLUETOOTH_DEVICE_EVENT 2 "
        "deviceAddress=F4:C4:59:81:D9:A1, deviceName=Zwift Click",
    ]
    ms = androidlog.parse_lines(LOGCAT, 2026)
    labels = [m.label for m in ms]
    check("indented BLUETOOTH_DEVICE_EVENT lines are parsed (the bug that hid connects)",
          "Zwift Click CONNECTED" in labels, " | ".join(labels))
    check("disconnect event parsed too", "Zwift Click DISCONNECTED" in labels)
    check("device address recovered from the event line",
          any(m.detail == "address f4:c4:59:81:d9:a1" for m in ms))
    check("screen-off-by-timeout captured — the 2026-07-29 confound",
          any(m.label == "screen OFF" and m.detail == "timeout" for m in ms))
    check("screen-on-by-power-button captured",
          any(m.label == "screen ON" and m.detail == "power_button" for m in ms))
    check("markers come back in time order", [m.ts for m in ms] == sorted(m.ts for m in ms))
    check("connect/disconnect are 'action', screen state is 'environment'",
          {m.kind for m in ms if "Click" in m.label} == {"action"}
          and {m.kind for m in ms if "screen" in m.label} == {"environment"})
    conn = next(m for m in ms if m.label == "Zwift Click CONNECTED")
    disc = next(m for m in ms if m.label == "Zwift Click DISCONNECTED")
    check("marker timestamps give the 73.5s link lifetime",
          abs((disc.ts - conn.ts) - 73.509) < 0.01, f"{disc.ts - conn.ts:.3f}s")

    # The btsnoop clock ran +1h from logcat on this phone. The offset must be measured,
    # since guessing it wrong silently misattributes every packet.
    cap = [conn.ts + 3600 - 10, disc.ts + 3600 + 10]
    check("a +1h btsnoop/logcat clock skew is detected from the data",
          androidlog.time_offset(cap, ms) == 3600.0,
          str(androidlog.time_offset(cap, ms)))
    check("no skew is invented when the clocks already agree",
          androidlog.time_offset([conn.ts - 10, disc.ts + 10], ms) == 0.0)
    check("non-overlapping logs refuse to correlate rather than guessing",
          androidlog.time_offset([conn.ts + 86400 * 3, disc.ts + 86400 * 3], ms) == 0.0)
    check("markers convert to the manifest shape analyze.py reads",
          set(ms[0].as_manifest_marker()) == {"ts", "label", "kind", "detail"})
    check("repeated identical markers within a second collapse",
          len(androidlog.dedupe(ms + ms)) == len(ms))

    # LIVE logcat words it completely differently from the bugreport: two non-adjacent
    # BluetoothDeviceBatteryManager lines, with the address redacted. Verbatim from
    # `adb logcat -b all -v time` on 2026-07-29.
    LIVE = [
        "07-29 14:46:37.802 I/BluetoothDeviceBatteryManager( 1499): action: "
        "android.bluetooth.device.action.ACL_CONNECTED",
        "07-29 14:46:37.806 I/ActivityManager( 1499): Changes in 10049 19 to 11, 0 to 384",
        "07-29 14:46:37.834 I/BluetoothDeviceBatteryManager( 1499): "
        "# Alias(KICKR CORE C26B) / Address(FFA182_9)",
        "07-29 14:47:53.286 I/BluetoothDeviceBatteryManager( 1499): action: "
        "android.bluetooth.device.action.ACL_DISCONNECTED",
        "07-29 14:47:53.297 I/ActivityManager( 1499): Changes in 10114 10 to 10, 0 to 384",
        "07-29 14:47:53.310 I/BluetoothDeviceBatteryManager( 1499): "
        "# Alias(Zwift Click) / Address(F4C459_1)",
    ]
    w = androidlog.AclWatcher()
    live = [m for m in (w.feed(l, 2026) for l in LIVE) if m]
    check("live ACL events pair across interleaved log lines",
          [m.label for m in live] == ["KICKR CORE C26B CONNECTED", "Zwift Click DISCONNECTED"],
          " | ".join(m.label for m in live))
    check("live event keeps the ACTION line's timestamp, not the Alias line's",
          live[0].ts == androidlog.parse_lines(
              ["07-29 14:46:37.802 I/x: Going to sleep due to test"], 2026)[0].ts,
          f"{live[0].ts}")
    check("redacted address matches what --expect is given",
          androidlog.redact("f4:c4:59:81:d9:a1") == "F4C459_1",
          androidlog.redact("f4:c4:59:81:d9:a1"))
    check("redaction is case- and separator-insensitive",
          androidlog.redact("FF-A1-82-DD-F0-79") == "FFA182_9")
    check("an Alias line with no preceding action is ignored",
          androidlog.AclWatcher().feed(LIVE[2], 2026) is None)
    w2 = androidlog.AclWatcher()
    w2.feed(LIVE[0], 2026)
    check("an Alias line arriving too late is not mis-paired",
          w2.feed(LIVE[5], 2026) is None)

    passed = sum(1 for _, ok, _ in CHECKS if ok)
    total = len(CHECKS)
    print("\n" + "=" * 78)
    print(f"  {passed}/{total} checks passed")
    if passed != total:
        print("\n  Failures:")
        for name, ok, detail in CHECKS:
            if not ok:
                print(f"    - {name}" + (f" ({detail})" if detail else ""))
    print("=" * 78)

    if args.keep or args.dir:
        print(f"\n  Generated files kept in {workdir}")
        for f in sorted(os.listdir(workdir)):
            print(f"    {f}")
    else:
        import shutil

        shutil.rmtree(workdir, ignore_errors=True)

    return 0 if passed == total else 1


if __name__ == "__main__":
    sys.exit(run())
