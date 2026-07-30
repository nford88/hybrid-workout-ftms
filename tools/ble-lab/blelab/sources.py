"""Capture backends. Each yields ``HciRecord``s; live sources block.

Backends, in the order Phase 0 ranked them (see
docs/virtual-shifting/experiments/11-capture-backend-selection.md):

``android``
    Live stream of the on-device HCI snoop log over ``adb``. Host-side, so
    ATT payloads are plaintext regardless of link encryption.
``pklg``
    macOS PacketLogger ``.pklg`` file, either complete (offline) or tailed
    while it grows (live-ish).
``file``
    Any capture tshark can already read: ``.pklg``, ``btsnoop``, ``.pcap``.
    Used by analyze.py/diff.py so they never care which backend produced it.
"""

from __future__ import annotations

import logging
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
from typing import Iterator

from .pcapio import (
    Annotation,
    BtsnoopParser,
    HciRecord,
    PacketLoggerParser,
    read_btsnoop,
    read_packetlogger,
    sniff_format,
)

log = logging.getLogger("blelab.sources")

# Android exposes the live snoop log as an abstract-namespace unix socket that
# `adb forward` can bridge to a local TCP port. This is the same mechanism
# Wireshark's androiddump extcap uses for its "Bluetooth Btsnoop Net"
# interface; we reimplement it in ~30 lines so we do not depend on androiddump,
# which is broken in the current Homebrew wireshark build (its extcap binaries
# have an incorrect @rpath and cannot find libwiretap).
ANDROID_BTSNOOP_SOCKET = "localabstract:btsnoop"
ANDROID_BTSNOOP_PORT = 8872


class SourceError(RuntimeError):
    pass


# ──────────────────────────────────────────────────────────────────────────
# offline / file
# ──────────────────────────────────────────────────────────────────────────


def iter_file(path: str) -> Iterator[HciRecord]:
    """Yield records from a capture file, auto-detecting the format."""
    fmt = sniff_format(path)
    log.info("reading %s as %s", path, fmt)
    if fmt == "btsnoop":
        with open(path, "rb") as fh:
            yield from read_btsnoop(fh)
    elif fmt == "pklg":
        with open(path, "rb") as fh:
            yield from read_packetlogger(fh)
    else:
        raise SourceError(
            f"{path} is already a {fmt}; feed it to tshark directly "
            "(analyze.py --pcap) rather than through a converting source"
        )


def file_annotations(path: str) -> list[Annotation]:
    """PacketLogger note/config lines, if the capture has any."""
    if sniff_format(path) != "pklg":
        return []
    parser = PacketLoggerParser()
    with open(path, "rb") as fh:
        while True:
            data = fh.read(65536)
            if not data:
                break
            parser.feed(data)
    return parser.annotations


# ──────────────────────────────────────────────────────────────────────────
# tail a growing file (macOS PacketLogger auto-save, Android pulled log)
# ──────────────────────────────────────────────────────────────────────────


def iter_tail(path: str, poll: float = 0.2, from_start: bool = True) -> Iterator[HciRecord]:
    """Follow a capture file as it grows.

    Works for .pklg and btsnoop. Both are append-only record streams, so a
    naive tail is correct as long as we buffer partial records — which the
    incremental parsers do.
    """
    fmt = sniff_format(path)
    if fmt == "btsnoop":
        parser: BtsnoopParser | PacketLoggerParser = BtsnoopParser()
    elif fmt == "pklg":
        parser = PacketLoggerParser()
    else:
        raise SourceError(f"cannot tail a {fmt} file")

    log.info("tailing %s as %s", path, fmt)
    with open(path, "rb") as fh:
        if not from_start:
            fh.seek(0, os.SEEK_END)
        while True:
            data = fh.read(65536)
            if data:
                yield from parser.feed(data)
            else:
                time.sleep(poll)


# ──────────────────────────────────────────────────────────────────────────
# Android live
# ──────────────────────────────────────────────────────────────────────────


def _adb(*args: str, check: bool = True) -> str:
    exe = shutil.which("adb")
    if not exe:
        raise SourceError("adb not found on PATH (brew install --cask android-platform-tools)")
    proc = subprocess.run([exe, *args], capture_output=True, text=True)
    if check and proc.returncode != 0:
        raise SourceError(f"adb {' '.join(args)} failed: {proc.stderr.strip()}")
    return proc.stdout


def android_devices() -> list[str]:
    out = _adb("devices")
    serials = []
    for line in out.splitlines()[1:]:
        parts = line.split()
        if len(parts) >= 2 and parts[1] == "device":
            serials.append(parts[0])
    return serials


def android_preflight() -> dict[str, str]:
    """Report the device state that determines whether snooping will work.

    Deliberately reports rather than fixes: whether HCI snoop is enabled is a
    Developer-options toggle that needs a human, and silently toggling
    settings on someone's phone is not this tool's job.
    """
    serials = android_devices()
    if not serials:
        raise SourceError(
            "no Android device in 'adb devices'. Connect by USB, unlock the "
            "phone, and accept the USB-debugging prompt."
        )
    info: dict[str, str] = {"serial": serials[0]}
    if len(serials) > 1:
        info["warning"] = f"{len(serials)} devices attached, using {serials[0]}"
    for label, prop in (
        ("android_release", "ro.build.version.release"),
        ("android_sdk", "ro.build.version.sdk"),
        ("model", "ro.product.model"),
    ):
        try:
            info[label] = _adb("-s", serials[0], "shell", "getprop", prop).strip() or "(unset)"
        except SourceError:
            info[label] = "(unreadable)"

    # The legacy persist.bluetooth.btsnoop* properties are unset on modern
    # Android (verified on Android 16 / SDK 36). The authoritative runtime state
    # is in dumpsys: `sSnoopLogSettingAtEnable`.
    try:
        dump = _adb("-s", serials[0], "shell",
                    "dumpsys bluetooth_manager | grep -i snoop", check=False)
        for line in dump.splitlines():
            if "sSnoopLogSettingAtEnable" in line:
                info["snoop_mode"] = line.split("=", 1)[-1].strip()
    except SourceError:
        pass
    info.setdefault("snoop_mode", "(unknown)")

    # Does the live snoop socket actually exist? `adb forward` succeeds even when
    # it does not (the mapping is registered lazily), so the only honest check is
    # to look for the listener. Samsung's Android 16 build does NOT create it,
    # despite the INIT_gd_hal_snoop_logger_socket feature flag reading true.
    try:
        socks = _adb("-s", serials[0], "shell",
                     "cat /proc/net/unix | grep -i snoop", check=False)
        info["snoop_socket_present"] = "yes" if socks.strip() else "no"
    except SourceError:
        info["snoop_socket_present"] = "unknown"
    return info


def iter_android_live(port: int = ANDROID_BTSNOOP_PORT, timeout: float = 10.0) -> Iterator[HciRecord]:
    """Stream the live HCI snoop log off an Android device via adb forward.

    Requires Developer options -> Enable Bluetooth HCI snoop log = Enabled
    (or "Filtered"), then Bluetooth toggled off and on so the stack reopens
    its snoop sink. Without the toggle the socket exists but stays silent —
    the single most common reason this returns nothing.
    """
    info = android_preflight()
    log.info("android device: %s", info)
    if info.get("snoop_socket_present") == "no":
        raise SourceError(
            "this device has NO live snoop socket, so streaming is impossible.\n"
            f"  snoop mode:     {info.get('snoop_mode')}\n"
            f"  device:         {info.get('model')} / Android {info.get('android_release')} "
            f"(SDK {info.get('android_sdk')})\n"
            "  /proc/net/unix: no listener matching 'snoop'\n"
            "\nSnoop logging IS running (see the mode above) — it just writes to a file "
            "that is unreadable without root, with no socket to tap.\n"
            "Confirmed absent on Samsung Android 16 despite the "
            "INIT_gd_hal_snoop_logger_socket flag reading true.\n"
            "\nUse the bug-report route instead — the zip contains the FULL log:\n"
            "    adb bugreport out.zip\n"
            "    unzip -o out.zip -d out && find out -name 'btsnoop*'\n"
            "    ./analyze.py --file out/FS/data/misc/bluetooth/logs/btsnoop_hci.log\n"
            "\nNote: the btsnooz log embedded in `dumpsys bluetooth_manager` is NOT a "
            "substitute — it is filtered and contains no device addresses or ATT payloads."
        )
    serial = info["serial"]
    _adb("-s", serial, "forward", f"tcp:{port}", ANDROID_BTSNOOP_SOCKET)
    log.info("adb forward tcp:%d -> %s", port, ANDROID_BTSNOOP_SOCKET)
    try:
        sock = socket.create_connection(("127.0.0.1", port), timeout=timeout)
    except OSError as exc:
        _adb("-s", serial, "forward", "--remove", f"tcp:{port}", check=False)
        raise SourceError(
            f"could not connect to the forwarded snoop socket ({exc}). "
            "Is 'Enable Bluetooth HCI snoop log' on, and was Bluetooth "
            "toggled off/on after enabling it?"
        ) from exc

    parser = BtsnoopParser()
    got_any = False
    try:
        sock.settimeout(None)
        while True:
            data = sock.recv(65536)
            if not data:
                if not got_any:
                    raise SourceError(
                        "the phone accepted then immediately closed the connection "
                        "with ZERO bytes.\n"
                        "That almost always means the snoop socket does not exist. "
                        "`adb forward` succeeds regardless — it registers the mapping "
                        "lazily — so check for the real error:\n"
                        "    adb logcat -d | grep btsnoop\n"
                        "  A line like \"adbd: failed to connect to socket "
                        "'localabstract:btsnoop'\" confirms it.\n"
                        "Verify no listener exists:\n"
                        "    adb shell cat /proc/net/unix | grep -i snoop\n"
                        "\nKnown affected: Samsung Android 16 (SDK 36) — the socket is "
                        "absent even with snoop logging set to FULL and the\n"
                        "INIT_gd_hal_snoop_logger_socket flag true.\n"
                        "Use the bug-report route instead:\n"
                        "    adb bugreport out.zip   (then extract "
                        "FS/data/misc/bluetooth/logs/btsnoop_hci.log)"
                    )
                log.warning("snoop socket closed by device after %d records", 0)
                break
            got_any = True
            yield from parser.feed(data)
    finally:
        try:
            sock.close()
        finally:
            _adb("-s", serial, "forward", "--remove", f"tcp:{port}", check=False)


def android_pull_snoop(dest: str) -> str:
    """Pull the on-device snoop log file (post-hoc alternative to streaming)."""
    serial = android_preflight()["serial"]
    candidates = [
        "/data/misc/bluetooth/logs/btsnoop_hci.log",
        "/data/log/bt/btsnoop_hci.log",
        "/sdcard/btsnoop_hci.log",
    ]
    for path in candidates:
        out = _adb("-s", serial, "shell", "ls", path, check=False)
        if path in out and "No such file" not in out:
            _adb("-s", serial, "pull", path, dest)
            log.info("pulled %s -> %s", path, dest)
            return dest
    raise SourceError(
        "no snoop log found in any known location; on unrooted modern "
        "Android the file is not world-readable — use the live stream "
        "(--backend android) instead, or a bug report "
        "(adb bugreport, then extract FS/data/misc/bluetooth/logs/)"
    )


# ──────────────────────────────────────────────────────────────────────────
# macOS PacketLogger discovery
# ──────────────────────────────────────────────────────────────────────────

PACKETLOGGER_PATHS = (
    "/Applications/PacketLogger.app",
    os.path.expanduser("~/Applications/PacketLogger.app"),
    "/Applications/Utilities/PacketLogger.app",
)

APPLE_BT_LOG_DIRS = (
    "/Library/Logs/Bluetooth",
    os.path.expanduser("~/Library/Logs/Bluetooth"),
)


def macos_preflight() -> dict[str, object]:
    """Report whether the macOS host-side path is actually usable.

    PacketLogger ships in "Additional Tools for Xcode", a separate download
    behind an Apple ID sign-in — it cannot be installed by a script, so this
    only ever reports.
    """
    found = [p for p in PACKETLOGGER_PATHS if os.path.exists(p)]
    rolling = []
    for d in APPLE_BT_LOG_DIRS:
        if os.path.isdir(d):
            rolling += [
                os.path.join(d, f) for f in sorted(os.listdir(d)) if f.endswith(".pklg")
            ]
    cli = ""
    try:
        cli = packetlogger_cli_path()
    except SourceError:
        pass
    # The GUI needs this privileged helper (installed via SMJobBless on first
    # launch, which prompts for admin). If it is absent the GUI shows an empty
    # window with no error — the single most confusing failure mode here. The
    # CLI does not need it, only sudo.
    helper_installed = any(
        os.path.exists(os.path.join(d, f))
        for d in ("/Library/PrivilegedHelperTools", "/Library/LaunchDaemons")
        for f in ("com.apple.bluetooth.PacketLoggerHelper",
                  "com.apple.bluetooth.PacketLoggerHelper.plist")
    )
    stale = []
    try:
        out = subprocess.run(["pgrep", "-lf", "PacketLogger"], capture_output=True, text=True).stdout
        stale = [l for l in out.splitlines() if "AppTranslocation" in l]
    except Exception:
        pass
    running = packetlogger_running()
    return {
        "packetlogger_installed": bool(found),
        "packetlogger_paths": found,
        "packetlogger_cli": cli,
        "gui_helper_installed": helper_installed,
        "translocated_instances": stale,
        "running_instances": running,
        "rolling_pklg_logs": rolling,
        "hint": (
            "install PacketLogger from Additional Tools for Xcode: "
            "https://developer.apple.com/download/all/?q=Additional%20Tools "
            "(free Apple ID; the DMG's Hardware/ folder holds PacketLogger.app)"
        )
        if not found
        else "",
    }


# ──────────────────────────────────────────────────────────────────────────
# raw byte streams (already in a format tshark reads: btsnoop / pcap)
# ──────────────────────────────────────────────────────────────────────────

# What `btmon` on a Linux host should be told to do. It writes btsnoop, which
# tshark reads from stdin, so nothing needs converting.
#
# Note btmon's btsnoop uses BlueZ's *monitor* datalink (2001), not HCI-UART
# (1002). tshark handles it; our own BtsnoopParser deliberately does not, which
# is exactly why this path bypasses the parser.
BTMON_STREAM_CMD = "btmon -w /dev/stdout"
BTMON_FILE_CMD = "btmon -w {path}"


def iter_raw_stdin(chunk: int = 65536) -> Iterator[bytes]:
    """Yield raw bytes from stdin, for `... | live.py --backend stdin`."""
    stream = sys.stdin.buffer
    log.info("reading a raw capture stream from stdin")
    while True:
        data = stream.read(chunk)
        if not data:
            break
        yield data


def iter_ssh(host: str, command: str = BTMON_STREAM_CMD, sudo: bool = True,
             ssh_options: list[str] | None = None) -> Iterator[bytes]:
    """Stream a capture off a remote Linux host over SSH.

    The remote host must be the machine whose Bluetooth controller is doing the
    talking — a host-side HCI log only ever shows its *own* controller's
    traffic. A bystander machine with a Bluetooth adapter sees nothing of a
    connection between two other devices, because standard BLE controllers have
    no promiscuous mode for established connections.
    """
    exe = shutil.which("ssh")
    if not exe:
        raise SourceError("ssh not found on PATH")
    remote = f"sudo -n {command}" if sudo else command
    argv = [exe]
    if ssh_options:
        argv += ssh_options
    argv += [host, remote]
    log.info("ssh %s :: %s", host, remote)
    proc = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=0)
    assert proc.stdout
    got_any = False
    try:
        while True:
            data = proc.stdout.read(65536)
            if not data:
                break
            got_any = True
            yield data
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=3)
            except subprocess.TimeoutExpired:  # pragma: no cover
                proc.kill()
        err = b""
        if proc.stderr:
            err = proc.stderr.read()
        if not got_any:
            detail = err.decode("utf-8", "replace").strip()[:400]
            raise SourceError(
                f"no capture data from {host}. {detail or '(no stderr)'}\n"
                "Checks, in the order they usually fail:\n"
                "  1. Is btmon installed?      ssh "
                f"{host} 'which btmon || sudo apt install bluez'\n"
                "  2. Passwordless sudo? btmon needs CAP_NET_RAW; 'sudo -n' fails\n"
                "     silently if a password is required.\n"
                "  3. Is the adapter up?       ssh "
                f"{host} 'bluetoothctl show'\n"
                "  4. Remember: this captures the SERVER's own Bluetooth traffic.\n"
                "     It cannot see a connection between two other devices."
            )
        elif err:
            for line in err.decode("utf-8", "replace").splitlines():
                if line.strip():
                    log.warning("ssh stderr: %s", line)


# ──────────────────────────────────────────────────────────────────────────
# macOS PacketLogger CLI  (the good path — scriptable, no GUI)
# ──────────────────────────────────────────────────────────────────────────
#
# PacketLogger.app ships an undocumented-ish command-line binary inside its
# bundle. `packetlogger convert` with no --input captures live, and --stdout
# emits PacketLogger format, which tshark reads from stdin. That makes macOS
# capture fully scriptable and sidesteps the GUI entirely.
#
# Two things to know:
#   * It requires root: "Error: Live traces require root privilege."
#   * The GUI needs a privileged helper (com.apple.bluetooth.PacketLoggerHelper,
#     installed via SMJobBless on first launch) to get the same access. If that
#     helper was never installed the GUI silently shows nothing — whereas the
#     CLI just needs sudo. This is why the CLI is the recommended path.
PACKETLOGGER_CLI_RELATIVE = "Contents/Resources/packetlogger"


def packetlogger_cli_path() -> str:
    """Locate the packetlogger CLI inside an installed PacketLogger.app."""
    for app in PACKETLOGGER_PATHS:
        candidate = os.path.join(app, PACKETLOGGER_CLI_RELATIVE)
        if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
            return candidate
    raise SourceError(
        "packetlogger CLI not found. It lives inside PacketLogger.app at "
        f"{PACKETLOGGER_CLI_RELATIVE}; install the app from Additional Tools "
        "for Xcode: https://developer.apple.com/download/all/?q=Additional%20Tools"
    )


def packetlogger_running() -> list[str]:
    """Any live packetlogger capture processes, GUI or CLI.

    Load-bearing check: **only one process can hold the macOS HCI tap.** A
    second instance attaches, receives nothing, and on exit writes a single
    "Disconnected from OS X Device" note record — a capture that looks
    successful and contains no packets. Detecting this beforehand is much
    kinder than debugging an empty trace afterwards.
    """
    out: list[str] = []
    for pattern in ("packetlogger convert", "PacketLogger.app/Contents/MacOS"):
        try:
            res = subprocess.run(["pgrep", "-lf", pattern], capture_output=True, text=True)
            for line in res.stdout.splitlines():
                if line.strip() and "pgrep" not in line:
                    out.append(line.strip())
        except Exception:  # pragma: no cover - defensive
            pass
    # De-duplicate while preserving order; the sudo wrapper and its child both
    # match, and reporting both is noise.
    seen, uniq = set(), []
    for line in out:
        pid = line.split(None, 1)[0]
        if pid not in seen:
            seen.add(pid)
            uniq.append(line)
    return uniq


def kill_packetlogger(match: str, sudo: bool = True) -> None:
    """Stop a root-owned packetlogger with SIGINT.

    Two details, both learned from an empty capture:

    * It must be **SIGINT**, not SIGTERM. packetlogger flushes its output
      buffer on interrupt; killed any other way the file stays empty.
    * It must go through **sudo**. The process runs as root, so a non-root
      parent's ``Popen.terminate()`` is silently refused — which is how four
      orphaned captures ended up competing for the HCI tap.
    """
    try:
        if sudo:
            # -n first (silent if the timestamp is still valid), then an
            # interactive retry: a sudo timestamp expires after ~5 minutes, and a
            # long capture will outlive it. Leaving the process alive is the worst
            # outcome — it holds the HCI tap and silently ruins the next capture.
            res = subprocess.run(["sudo", "-n", "pkill", "-INT", "-f", match],
                                 capture_output=True, timeout=10)
            if res.returncode not in (0, 1):
                log.info("sudo timestamp expired; asking for your password to stop the capture")
                subprocess.run(["sudo", "pkill", "-INT", "-f", match], timeout=60)
        else:
            subprocess.run(["pkill", "-INT", "-f", match], capture_output=True, timeout=10)
    except Exception as exc:  # pragma: no cover - defensive
        log.warning(
            "could not stop packetlogger (%s). Do it by hand or the next capture "
            "will silently record nothing:\n"
            "  sudo pkill -INT -f 'packetlogger convert'", exc)


def sudo_authorise() -> None:
    """Get a sudo timestamp with the prompt VISIBLE, before we pipe anything.

    Necessary because ``sudo`` writes its password prompt to stderr. If the
    capture subprocess is started with ``stderr=PIPE`` (so we can report its
    errors) the prompt is swallowed and the tool appears to hang with no
    explanation. Prompting up front, with stdio inherited, avoids that.
    """
    if os.geteuid() == 0:
        return
    log.info("requesting sudo authorisation (packetlogger needs root)")
    proc = subprocess.run(["sudo", "-v"])
    if proc.returncode != 0:
        raise SourceError(
            "sudo authorisation failed. packetlogger refuses to capture without "
            "root ('Live traces require root privilege'), so there is no "
            "unprivileged path here."
        )


def iter_packetlogger_cli(
    out_path: str,
    sudo: bool = True,
    buffered: bool = False,
    poll: float = 0.2,
    first_data_timeout: float = 20.0,
) -> Iterator[bytes]:
    """Capture live HCI on macOS via the PacketLogger CLI, yielding raw bytes.

    Reads ``--stdout`` and *also* tees to ``out_path``, rather than using
    ``--output`` and tailing the file. Measured behaviour, not a guess:
    **``--output`` buffers the entire capture in memory and writes nothing until
    the process exits** — the file stays 0 bytes for the whole run, so tailing it
    can never show anything. Verified against a live capture with two devices
    connected.

    ``--stdout`` may still block-buffer (standard C stdio on a pipe, typically
    4 KB), so a low-traffic capture can lag. If no bytes arrive within
    ``first_data_timeout`` we say so explicitly and name the reliable fallback,
    rather than sitting silent — silence here is indistinguishable from a broken
    setup, which has already cost several runs.
    """
    cli = packetlogger_cli_path()
    out_path = os.path.abspath(out_path)
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    if os.path.exists(out_path):
        raise SourceError(
            f"{out_path} already exists. Refusing to overwrite a capture — "
            "pick another path or move it aside."
        )

    existing = packetlogger_running()
    if existing:
        raise SourceError(
            "a packetlogger/PacketLogger process is already running:\n  "
            + "\n  ".join(existing)
            + "\n\nOnly ONE process can hold the macOS HCI tap. A second one "
            "attaches, captures nothing, and writes a single 'Disconnected from "
            "OS X Device' note — an empty capture that looks like it worked.\n"
            "Stop it first:\n"
            "  sudo pkill -INT -f 'packetlogger convert'\n"
            "  killall PacketLogger        # if the GUI is also open"
        )

    if sudo:
        sudo_authorise()
    argv = (["sudo"] if sudo else []) + [cli, "convert", "--stdout"]
    if buffered:
        argv.append("--bufferedPackets")
    log.info("running: %s", " ".join(argv))
    log.info("saving a verbatim copy to %s", out_path)

    # stderr inherited on purpose: whatever packetlogger complains about should
    # land in front of the operator rather than in a pipe we might never drain.
    proc = subprocess.Popen(argv, stdout=subprocess.PIPE, bufsize=0)
    assert proc.stdout

    # Warn from a side thread if nothing arrives. Cannot be done inline because
    # the read below blocks.
    warned = threading.Event()

    def nag() -> None:
        if warned.wait(first_data_timeout):
            return
        log.warning(
            "no capture data after %.0fs. Before assuming the tool is broken, "
            "note that this may be CORRECT:\n"
            "\n"
            "  A connected-but-idle BLE link produces almost no HCI traffic. The\n"
            "  empty link-layer keepalives happen inside the controller and never\n"
            "  cross the HCI boundary. And a Click button press only generates\n"
            "  traffic if some client is SUBSCRIBED to its notifications — with\n"
            "  nothing subscribed, pressing buttons produces nothing to capture.\n"
            "\n"
            "  Unambiguous smoke test — toggle Bluetooth OFF then ON (System\n"
            "  Settings, or the Control Centre). That emits dozens of HCI commands\n"
            "  and events immediately. If those appear, the pipeline works and the\n"
            "  silence was real.\n"
            "\n"
            "  To capture something useful, do something that talks to the device:\n"
            "  open the app's pairing screen, or connect from the harness.\n"
            "\n"
            "  If the smoke test shows nothing either, packetlogger is buffering\n"
            "  its pipe; use capture-then-analyse instead:\n"
            "    sudo %s convert -o %s     # Ctrl-C when done — that is when it writes\n"
            "    ./analyze.py --file %s",
            first_data_timeout,
            cli,
            out_path,
            out_path,
        )

    threading.Thread(target=nag, daemon=True).start()

    try:
        with open(out_path, "wb") as sink:
            while True:
                data = proc.stdout.read(65536)
                if not data:
                    break
                warned.set()
                sink.write(data)
                sink.flush()
                yield data
    finally:
        warned.set()
        # SIGINT via sudo, not Popen.terminate(): the process runs as root, so a
        # non-root parent cannot signal it, and only SIGINT makes it flush.
        if proc.poll() is None:
            log.info("stopping capture (SIGINT via sudo so it flushes)")
            kill_packetlogger(out_path, sudo=sudo)
            try:
                proc.wait(timeout=8)
            except subprocess.TimeoutExpired:  # pragma: no cover
                log.warning(
                    "packetlogger did not exit. Stop it by hand or the next "
                    "capture will silently record nothing:\n"
                    "  sudo pkill -INT -f 'packetlogger convert'"
                )
        size = os.path.getsize(out_path) if os.path.exists(out_path) else 0
        log.info("capture stopped; %s is %d bytes", out_path, size)
        if size == 0:
            log.warning(
                "the capture file is EMPTY. The HCI tap produced nothing — this "
                "is not a decoding failure. Check, in order:\n"
                "  1. Another packetlogger/PacketLogger instance held the tap: "
                "pgrep -lf packetlogger\n"
                "  2. Nothing was connected over Bluetooth: "
                "system_profiler SPBluetoothDataType | grep -A3 '^ *Connected'\n"
                "  3. It was stopped without SIGINT, so it never flushed."
            )
        elif size < 512:
            log.warning(
                "%s is only %d bytes. If it decodes to a single 'Disconnected "
                "from OS X Device' note, another process held the HCI tap and "
                "this capture is empty of real packets.",
                out_path,
                size,
            )


def record_packetlogger(out_path: str, sudo: bool = True) -> str:
    """Capture to a file until Ctrl-C, then return the path. No live view.

    The one macOS workflow with no ambiguity in it. ``--output`` buffers the
    whole capture in memory and writes on SIGINT, so there is nothing to stream
    and nothing that can be lost to a pipe buffer: you either get a file with
    packets in it or you get proof that packetlogger cannot receive on this
    machine. After three inconclusive live attempts, that distinction is worth
    more than a live view.
    """
    cli = packetlogger_cli_path()
    out_path = os.path.abspath(out_path)
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    if os.path.exists(out_path):
        raise SourceError(f"{out_path} already exists; move it aside first")

    existing = packetlogger_running()
    if existing:
        raise SourceError(
            "packetlogger is already running:\n  " + "\n  ".join(existing)
            + "\n\nOnly one process can hold the HCI tap. Stop it first:\n"
            "  sudo pkill -INT -f 'packetlogger convert'"
        )

    if sudo:
        sudo_authorise()
    argv = (["sudo"] if sudo else []) + [cli, "convert", "--output", out_path]
    log.info("running: %s", " ".join(argv))
    print(
        "\n  Recording. The file will read 0 bytes until you stop it — that is\n"
        "  normal for this tool, not a failure.\n"
        "\n  Do the thing you want captured, then press Ctrl-C ONCE.\n",
        flush=True,
    )
    proc = subprocess.Popen(argv)
    try:
        proc.wait()
    except KeyboardInterrupt:
        print("\n  stopping (SIGINT so it flushes)...", flush=True)
    finally:
        if proc.poll() is None:
            kill_packetlogger(out_path, sudo=sudo)
            try:
                proc.wait(timeout=15)
            except subprocess.TimeoutExpired:  # pragma: no cover
                log.warning(
                    "packetlogger did not exit; stop it by hand or the next "
                    "capture records nothing:\n"
                    "  sudo pkill -INT -f 'packetlogger convert'"
                )
    size = os.path.getsize(out_path) if os.path.exists(out_path) else 0
    log.info("%s is %d bytes", out_path, size)
    return out_path


def iter_file_bytes(path: str, chunk: int = 65536) -> Iterator[bytes]:
    """Yield a capture file's raw bytes (for the stream-through path)."""
    with open(path, "rb") as fh:
        while True:
            data = fh.read(chunk)
            if not data:
                break
            yield data


def open_source(backend: str, path: str | None = None, tail: bool = False) -> Iterator[HciRecord]:
    """Factory used by every CLI so backend selection is uniform."""
    if backend == "android":
        return iter_android_live()
    if backend in ("pklg", "file"):
        if not path:
            raise SourceError(f"backend '{backend}' needs --file")
        return iter_tail(path) if tail else iter_file(path)
    raise SourceError(f"unknown backend {backend!r}")
