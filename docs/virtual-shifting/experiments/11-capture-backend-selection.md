# 11 — Capture Backend Selection (Phase 0) + `tools/ble-lab/` Toolchain

**Date**: 2026-07-29
**Type**: Environment probe + tooling build. **Not a BLE hardware experiment** — no
device was connected, no packet of real traffic was captured. What was measured is
the *capture host*: which of the three candidate backends can actually run on this
machine today.

**Status**: **Phase 0 ANSWERED. Phases 2–3 BLOCKED on two manual installs and one
unknown (see Blockers).** Toolchain built and verified against synthetic captures.

---

## Hardware & firmware

| Thing | Value | Source |
|---|---|---|
| Capture host | MacBook (Apple Silicon), macOS 26.5.2 build 25F84 | `sw_vers` |
| Host BT controller | Apple BCM_4387, addr `BC:D0:74:81:F6:07`, fw 23.5.636.5344 | `system_profiler SPBluetoothDataType` |
| Trainer | Wahoo KICKR CORE C26B, fw 1.5.36 | `02-firmware-model-check.md` (not re-checked) |
| Controller | Zwift Click ×2 (Left `…5106`, Right `…D9a1`), fw 1.2 | `02`/`03` (not re-checked) |
| tshark | 4.4.9 (Git 18457223d1eb), Homebrew | `tshark -v` |
| python3 | 3.14.6, Homebrew | `python3 -VV` |
| adb | present, `android-platform-tools` cask | `command -v adb` |

---

## Hypothesis

Restating the mission's Phase 0 prediction so it can be scored:

> **H-P0a** — macOS PacketLogger with Zwift for Mac is the primary backend: decrypted,
> host-side, no extra hardware.
> **H-P0b** — Host-side HCI logs expose plaintext ATT payloads regardless of link
> encryption, because link-layer encryption is applied below HCI; an over-the-air
> sniffer must catch pairing and may still fail under LE Secure Connections.
> Therefore host-side outranks over-the-air on data quality, not merely convenience.
> **H-P0c** — An unsubscribed Zwift account still reaches the device-pairing screen,
> which performs a full connect + handshake, so no paid access or in-progress ride is
> needed.
> **H-P0d** — Zwift Companion's device-bridging path may or may not carry the Click
> connection; this must be determined empirically.

---

## Setup

No BLE devices involved. Commands run against the capture host only.

---

## Exact steps performed

1. Searched for PacketLogger.app in all three standard locations plus a Spotlight
   query (`mdfind -name "PacketLogger.app"`).
2. Searched for a Zwift installation (`/Applications`, `~/Applications`, `mdfind`).
3. Checked for Xcode vs Command Line Tools (`xcode-select -p`).
4. Probed for `tshark`, `wireshark`, `python3`, `adb`, `brew`, `nrfutil`.
5. `adb devices -l`.
6. `tshark -D` to enumerate capture interfaces.
7. Grepped `libwiretap.15.dylib` for the file-format readers this pipeline depends
   on (`btsnoop`, `PACKETLOGGER`).
8. Sampled the macOS unified log for the Bluetooth subsystem for 4 s, to test
   whether it is a viable PacketLogger substitute.
9. Checked `/Library/Logs/Bluetooth` and `~/Library/Logs/Bluetooth` for rolling
   `.pklg` logs (as written by Apple's Bluetooth logging profile).
10. Synthesised a DLT-201 (`LINKTYPE_BLUETOOTH_HCI_H4_WITH_PHDR`) pcap containing a
    hand-built ATT Write Request and Handle Value Notification, and fed it to tshark
    both as a file and on stdin with `-l`, to validate the intended pipeline.
11. Built `tools/ble-lab/` and ran its 45-check `selftest.py`.

---

## Raw captured data

### PacketLogger / Zwift / Xcode

```
=== PacketLogger ===
(no matches in /Applications, ~/Applications, /Applications/Utilities;
 mdfind -name "PacketLogger.app" returned nothing)
=== Zwift ===
(no matches)
=== Xcode ===
/Library/Developer/CommandLineTools
(no Xcode.app in /Applications)
```

### Tool availability

```
tshark     /opt/homebrew/bin/tshark
wireshark  MISSING          (CLI-only install; the GUI is not needed)
python3    /opt/homebrew/bin/python3
adb        /opt/homebrew/bin/adb
brew       /opt/homebrew/bin/brew
nrfutil    MISSING
```

### Android

```
$ adb devices -l
* daemon not running; starting now at tcp:5037
* daemon started successfully
List of devices attached
                          ← empty: no device attached
```

### `tshark -D` — and a Homebrew packaging bug

Raw first attempt (abridged; the same error repeats for every extcap binary):

```
dyld[58755]: Library not loaded: @rpath/libwiretap.15.dylib
  Referenced from: .../wireshark/4.4.9/lib/wireshark/extcap/androiddump
  Reason: tried: '.../lib/wireshark/extcap/../lib/libwiretap.15.dylib' (no such file)
```

The libraries do exist, one directory level up from where the extcap binaries look:

```
/opt/homebrew/Cellar/wireshark/4.4.9/lib/libwiretap.15.dylib      ← exists
.../lib/wireshark/extcap/../lib/libwiretap.15.dylib               ← searched, absent
```

`DYLD_LIBRARY_PATH=/opt/homebrew/lib tshark -D` then lists interfaces cleanly. **No
Bluetooth interface is offered on macOS** (only `en0`, `awdl0`, `utun*`, `lo0`, …) —
CoreBluetooth exposes no HCI capture device to Wireshark, which is exactly why
PacketLogger is required rather than optional on this platform.

### File-format readers present in libwiretap

```
btsnoop        *btsnoop        Symbian OS btsnoop
PACKETLOGGER   packetlogger    "Apple Bluetooth PacketLogger"   pklg
WTAP_ENCAP_PACKETLOGGER        register_packetlogger
```

### macOS unified log as a PacketLogger substitute — tested, insufficient

```
$ log stream --style compact --predicate 'subsystem == "com.apple.bluetooth"'
2026-07-29 11:12:37.576 Df bluetoothd[54674:b72673]
    [com.apple.bluetooth:Server.MacCoex] Posting Bluetooth Status Notification <private>
2026-07-29 11:12:40.901 Df bluetoothd[54674:84e3be]
    [com.apple.bluetooth:Server.Core] [MacUserClient][NotificationEventHandler]
    -- Received Heart Beat notification -- HIDShim
```

Two lines in 4 s, both `<private>`-redacted, neither packet-level.
`/Library/Logs/Bluetooth` and `~/Library/Logs/Bluetooth` do not exist, so no rolling
`.pklg` logs are being written either.

### Pipeline validation — synthetic DLT-201 pcap through tshark

```
$ tshark -r att.pcap
1   0.000000 localhost () → remote ()   ATT 18 Sent Write Request, Handle: 0x000c
2   0.400000    remote () → localhost() ATT 19 Rcvd Handle Value Notification, Handle: 0x000a

$ tshark -r att.pcap -T fields -e frame.number -e btatt.opcode -e btatt.handle -e btatt.value
1|0x12|0x000c|526964654f6e
2|0x1b|0x000a|2308ffffffff0f

$ cat att.pcap | tshark -r - -l -T fields ...     ← streaming from stdin also works
1|0x12|526964654f6e
2|0x1b|2308ffffffff0f
```

### Toolchain self-test

`tools/ble-lab/selftest.py`: **45/45 checks passed**, including a known-answer test
where `diff.py` recovers exactly the divergences planted into a synthetic
"our harness" capture.

---

## Observations

### 1. H-P0b is CONFIRMED, and it is the decisive argument

The reasoning, stated properly because the whole ranking rests on it:

- Bluetooth LE link-layer encryption (AES-CCM over the LL payload) is performed **by
  the controller**, below the HCI transport boundary.
- Both host-side backends tap **at or above HCI** — PacketLogger records HCI
  commands/events and ACL data as they cross that boundary; Android's btsnoop log
  records the same thing inside the host stack.
- Therefore ATT PDUs in a host-side log are **always plaintext**, whether or not the
  link is encrypted. Encryption is applied after the log point on the way out, and
  removed before the log point on the way in.
- An over-the-air sniffer sees the **encrypted link layer**. Under LE Legacy pairing
  it can derive the LTK if it captures the whole pairing exchange (the legacy STK
  derivation is passively breakable). Under **LE Secure Connections** the key comes
  from an ECDH P-256 exchange, and a passive observer cannot derive it *even with a
  flawless capture of every pairing packet* — that is the specific property LESC was
  introduced to provide.

So over-the-air is not merely less convenient, it is **capability-strictly-worse**
for this task, with an additional failure mode (channel-hopping desync, missed
packets) that host-side does not have.

**One honest caveat that cuts the other way**: our own prior sessions reached the
Click's ZAP characteristics from Web Bluetooth with no pairing prompt and no bonding
(`01`, `03`, `04`). That is strong evidence the link is *unencrypted*, which would
mean an over-the-air sniffer would in fact decode it fine. The ranking still holds —
host-side gives the same data for free and with certainty — but the argument for
ranking OTA last is "no advantage, real cost", not "it would not work".

### 2. H-P0a is REFUTED as stated — macOS is not the primary backend *today*

Not because the method is wrong (it is the best method) but because it is the only
option that **cannot be made to run without two login-walled manual downloads**:

- **PacketLogger.app is absent** and ships only inside *Additional Tools for Xcode*,
  a separate DMG behind an Apple ID sign-in. No script can fetch it. Confirmed absent
  by Spotlight, not just by a path check.
- **Zwift for Mac is not installed** (multi-GB download).
- The macOS unified log was tested as a substitute and is **not** one: redacted and
  not packet-level.
- macOS offers **no Wireshark capture interface** for Bluetooth, so there is no third
  path on this platform.

### 3. Android should be the primary backend — with one unknown gating it

- `adb` is already installed.
- HCI snoop is a Developer-options toggle: no account, no download, no purchase.
- **Crucially, H-P0d is already ANSWERED by evidence in hand, and the answer is yes.**
  `03-click-buttons-partial.md` records that the user paired/synced *both* Click units
  **in Zwift Companion**, and that this is what unlocked them for third-party clients.
  Companion therefore demonstrably establishes a real BLE connection to the Click and
  completes whatever vendor exchange the unlock requires. The mission asked whether
  Companion's device-bridging path carries the Click connection "or only the main app
  does" — our own prior session already proves Companion does. **This is the single
  most useful Phase 0 finding: the cold-connect and unlock sequences we most want are
  reachable on a phone, without Zwift for Mac and without a subscription.**
- **The gating unknown**: no Android device is attached, and nothing in the repo
  records whether the phone running Companion is Android or iOS. If it is iOS, this
  backend is unavailable and macOS becomes primary by elimination (iOS HCI logging
  needs a PacketLogger-adjacent profile on a tethered device — i.e. it still requires
  the same Apple download).

### 4. The `androiddump` breakage changed the tool design

Homebrew's wireshark 4.4.9 has an extcap `@rpath` bug, so Wireshark's own
`androiddump` — the normal way to live-capture from Android — is broken. Rather than
depend on a `DYLD_LIBRARY_PATH` workaround propagating correctly into a
tshark-spawned child process, `live.py` implements the ~30 lines of
`adb forward tcp:8872 localabstract:btsnoop` + socket-read + btsnoop-parse directly.
Fewer moving parts and it works on a stock install.

### 5. Scenario 1 needs no sniffer at all

The advertisement baseline (interval, local name, service UUIDs, manufacturer data)
is fully visible in **nRF Connect for Mobile** (free, iOS and Android). Since Web
Bluetooth cannot see advertisement content under any circumstances
(`PROTOCOLS.md` §1.1, §4), the *only* actionable output of that scenario is "which
filter keys exist at all" — which a free phone app answers. **Buying hardware to
capture advertisements would be spending money to learn something we cannot use.**

### 6. Sniffer hardware price, for the record

- **nRF52840 Dongle (PCA10059)** — £10.45 ex-VAT / £12.54 inc-VAT, RS Online UK,
  checked 2026-07-29. Works with the free nRF Sniffer for BLE Wireshark extcap.
  Cheap.
- **Sniffle** requires TI CC1352/CC26x2 hardware (e.g. `LAUNCHXL-CC1352P`). TI's tool
  page shows no price; historically these boards are several times the Nordic
  dongle's cost. Not verified — check at order time if it ever matters.
- Setup time: ~1–2 h including firmware flashing and extcap wiring.

**Recommendation as first written: do not buy** — see the Addendum, which **revises this
to "not yet"** once a Linux host is in play. Not on cost, but because it is dominated —
host-side gives guaranteed-plaintext ATT for free, and the one thing OTA uniquely
provides is obtainable from a free phone app.

### 7. H-P0c — subscription question — remains INFERRED, with a decisive test

Zwift accounts are free and the pairing screen sits before the ride paywall, so
reaching it should not require a subscription. I could not verify this without
installing and logging in. It is also now **largely moot**: if Companion is the
capture target (Observation 3), the pairing/device screen is Companion's main
surface. Decisive test, ~2 minutes: open the app, reach the pairing screen, confirm
the Click connects and reports a battery level. Do that before committing to any
larger download.

---

## Conclusion

**Backend ranking (revised from the mission's proposed order, with reasons):**

| Rank | Backend | Why | State |
|---|---|---|---|
| **1** | **Android HCI snoop log**, via Zwift Companion and/or the main Android app | Host-side ⇒ plaintext ATT guaranteed. Zero-cost, zero-download. Companion is already **proven** to connect and unlock our Clicks (`03`). | Blocked only on "is the phone Android?" |
| **2** | **macOS PacketLogger + Zwift for Mac** | Best data quality, and the **only** backend that can capture the official app *and* our Chrome harness on one host with one clock — a real advantage for the scenario-9 centrepiece diff. | Blocked on 2 manual downloads (Apple ID; multi-GB Zwift) |
| **3** | Over-the-air sniffer (nRF52840 / Sniffle) | Cannot guarantee decryption under LESC, adds packet-loss risk, and its advertisement-reading ability is free from `btmon` on any Linux box (Addendum). **But** it is the only backend that captures *both* endpoints from one point — see the revision in the Addendum. | **Do not buy *yet*** (revised) |

**Pipeline decision (validated, not assumed)**: normalise every backend to
`(timestamp, direction, H4 bytes)`, re-emit as a DLT-201 pcap stream, and let
**tshark** do all HCI/L2CAP/ATT/SMP dissection. Confirmed working end to end,
including streaming from stdin under `-l`. libwiretap has both `btsnoop` and
`PACKETLOGGER` readers, so raw capture files from either backend are also directly
readable.

**Toolchain delivered**: `tools/ble-lab/` — `capture.py`, `live.py`, `analyze.py`,
`diff.py`, `replay.py`, a Web Bluetooth replay harness, and a 45-check `selftest.py`
that needs no hardware. See [`tools/ble-lab/README.md`](../../../tools/ble-lab/README.md).

### Blockers (nothing in Phase 2–3 can run until these clear)

1. **Is the Zwift Companion phone Android or iOS?** Decides backend 1 vs 2. If
   Android: attach by USB, enable *Developer options → Enable Bluetooth HCI snoop
   log*, **then toggle Bluetooth off and on** (the stack only reopens its snoop sink
   on a Bluetooth restart — the most common cause of an empty capture).
2. **PacketLogger.app** — only needed if the answer to (1) is iOS, or if the
   scenario-9 same-host diff is wanted:
   <https://developer.apple.com/download/all/?q=Additional%20Tools> → mount →
   `Hardware/PacketLogger.app`.
3. **Physical actions.** Every Phase 2 scenario requires someone at the bike pressing
   paddles, walking out of range, and waiting out sleep timers. `capture.py`
   sequences and timestamps those actions but cannot perform them.

---

## Confidence

**CONFIRMED**
- Environment state: PacketLogger absent, Zwift absent, no Xcode, no Android device
  attached, tshark 4.4.9 present, `adb` present.
- Host-side HCI taps above the link layer ⇒ plaintext ATT regardless of link
  encryption (protocol-architecture fact, Bluetooth Core).
- macOS exposes no Wireshark Bluetooth capture interface; the unified log is a
  redacted, non-packet-level substitute (tested).
- libwiretap reads both `btsnoop` and `.pklg`.
- The DLT-201 → tshark pipeline dissects ATT correctly with correct direction, from a
  file and from stdin (tested with hand-built PDUs).
- Homebrew wireshark 4.4.9 extcap `@rpath` bug, and that `DYLD_LIBRARY_PATH` fixes it.
- nRF52840 Dongle price £10.45 ex-VAT (RS Online UK, 2026-07-29).
- Zwift Companion does establish a real BLE connection to our Clicks — from `03`'s
  record of the unlock happening through Companion.
- Toolchain correctness to the extent synthetic fixtures can show it: 45/45 checks,
  including the diff known-answer test.

**INFERRED**
- An unsubscribed account reaches the pairing screen and that screen performs a full
  connect + handshake (H-P0c). Standard app structure; not verified here.
- Passive LESC key derivation is impossible, so an OTA sniffer *could* fail — but our
  own evidence suggests this link is unencrypted, so it probably would not. The
  ranking does not depend on which way this falls.
- Android's live snoop socket is exposed at `localabstract:btsnoop` on this
  (unidentified) phone's Android version. Standard across modern AOSP; the path has
  moved before, so `live.py` reports clearly if the connect fails.

**UNKNOWN**
- Whether the Companion phone is Android (blocker 1) — the one fact that decides the
  whole plan.
- Whether Zwift for Mac supports the Click over BLE on Apple Silicon at all.
- Everything in Phase 2 and Phase 3. **No real BLE traffic has been captured. The
  replay verdict is NOT YET RUN and must not be reported as anything else.**

---

## Addendum (same day) — a Linux host is available; what it is and is not good for

The user has an SSH-accessible home server with Bluetooth. Assessed rather than
assumed, because the answer turns on one property of host-side logging.

### The governing fact

**A host-side HCI log shows only that host's own controller's traffic.** It is not a
radio scanner. Both PacketLogger and btsnoop record what crosses *their* HCI boundary.
Consequence, stated as a rule:

> The capture must run on a machine that is **one endpoint** of the connection you want
> to see.

A third machine with a Bluetooth adapter sitting nearby observes **nothing** of a
connection between two other devices. Standard BLE controllers have no promiscuous mode
for established connections — following an active link means tracking its channel-hop
sequence, which needs sniffer firmware, not a normal adapter. (This is the same fact
that makes an OTA sniffer a *different category of tool* rather than a cheaper one.)

### So: ❌ the server cannot sniff the app↔Click link

It would have to be running the Zwift app. There is no Linux Zwift client, and Companion
is Android/iOS only.

### ✅ But it has three real roles, one of which may be better than the app capture

1. **Advertisement baseline (scenario 1), free.** Scanning for advertisements *is*
   something any adapter does. `btmon` + `bluetoothctl scan on` yields full AD
   structures including the `0x094A` manufacturer data — superseding this record's
   earlier "use nRF Connect for Mobile" suggestion, and better because it is scriptable
   and logged. Still reference-only: Web Bluetooth can never read any of it.

2. **★ An unrestricted BLE client, as the oracle.** The highest-value role, and possibly
   more decisive than capturing the app at all. Web Bluetooth is a deliberately narrow
   abstraction; a Linux client is not — it can pair and bond, set the MTU, read the
   disconnect reason code, tune connection intervals, and send arbitrary bytes at
   arbitrary times, with `btmon` recording a complete HCI trace throughout.

   That makes it a **control for the browser's limitations**, which is precisely the
   axis this whole investigation is stuck on. Two outcomes, both informative:
   - Native client holds the connection, Chrome drops at ~90 s ⇒ the trace difference
     isolates exactly what the browser is missing, and the Unreachable list acquires a
     measured consequence instead of a theoretical one.
   - **Native client also drops at ~90 s ⇒ the browser was never the problem**, which
     retires a whole branch of this investigation and points at the Click's own lock
     state. Given `03`'s evidence that a Companion sync is what fixes it, this is the
     outcome I would bet on.

   It is also the cheapest way to test the `FF 04 00` hypothesis
   ([`13`](13-ff-family-frame-decode.md)) with full visibility, since `bluetoothctl`'s
   GATT menu can write arbitrary bytes and `btmon` shows the device's exact reaction.

3. **The natural host for an OTA sniffer** — and this revisits the "do not buy" call
   below. See the revision immediately following.

### Revision to the sniffer recommendation (same day, prompted by the Linux host)

The Phase 0 conclusion ranked an over-the-air sniffer last and said "do not buy." That
reasoning assumed the alternative was free *and* frictionless. With a Linux host in the
picture, the second half no longer holds, so the call is worth restating honestly.

**Why someone would reasonably want the sniffer here**: a host-side log has to run on
*each endpoint*, which means the app capture and the our-harness capture are two
different setups on two different machines. An nRF52840 dongle in the always-on Linux
box collapses that to **one capture point, one clock, both connections**, driven over
SSH — with no Apple ID download, no multi-GB Zwift install, and no fiddling with a
phone's developer options.

**Cost**: £10.45 ex-VAT, verified. The nRF Sniffer extcap firmware is free.

**The risk that made it rank last still exists but probably does not bite**: a radio
sniffer sees the encrypted link layer and cannot always decrypt. But our own evidence
says this link is almost certainly *unencrypted* — Chrome reaches the ZAP
characteristics with no pairing prompt across `01`/`03`/`04`, which a link requiring
authentication could not permit. So a sniffer would very likely see everything in the
clear. Residual risks are ordinary sniffer risks: it must catch the connection request,
and it can drop packets.

**Revised recommendation**: *do not buy **yet***, on sequencing grounds rather than
principle. Run the free `FF 04 00` test from [`13`](13-ff-family-frame-decode.md) first
— if a 3-byte write fixes the drop cadence there is nothing left to capture. If it does
not, and the host-side setup on either endpoint proves awkward, **£12 for the dongle in
the Linux box is a sound purchase** and the tidiest rig available. That is a change from
this record's original "strictly dominated, do not buy."

### Tooling added for this

`live.py --backend ssh --ssh-host box` and `--backend stdin`. No format conversion is
involved: `btmon -w` writes btsnoop, and **tshark reads btsnoop from stdin** (verified
this session), so the bytes go straight through.

This also fixed a latent bug the server plan exposed. `btmon -w` writes btsnoop with
BlueZ's **monitor** datalink type (2001), not HCI-UART (1002), and our own
`BtsnoopParser` only handles 1001/1002 — it would have thrown. `analyze.py` and
`diff.py` now hand capture files to **tshark directly** instead of converting them
first, which is both more robust and less code: tshark natively reads PacketLogger,
btsnoop of any datalink, pcap and pcapng. The converter is retained only for the
Android snoop socket and file-tailing.

### Second addendum (same day) — the user will install Zwift for Mac; macOS becomes rank 1

The user's decision resolves **blocker 1** by making it irrelevant: with Zwift for Mac
installed, macOS satisfies the "capture must run on an endpoint" rule for **both** halves
of the comparison, because the Mac runs Zwift *and* Chrome. `bluetoothd` serves both, so
one PacketLogger session sees both.

**Revised ranking: macOS PacketLogger is now rank 1**, not rank 2. The only thing that
demoted it was the two manual installs, and the user is accepting them. Everything that
recommended it on quality still stands, and it is the only backend giving a same-host,
same-clock app-vs-our-harness diff without involving a phone at all.

**Still-open unknown, now load-bearing**: whether Zwift for Mac supports the Zwift Click
over BLE. This project has never verified it. It is a 2-minute check (reach the pairing
screen, see whether the Click appears) and it should be done **before** any capture
effort. If it fails, fall back to Android and record the finding — it would be a
genuinely useful negative result, since it would also mean the Mac can never be the
single-host capture point.

**Subscription: confirmed not required, by structure** — the pairing screen precedes the
ride paywall, and pairing is where the entire connect + handshake occurs. Combined with
the Companion evidence (Observation 3), the subscription question is closed for practical
purposes.

**New tooling this prompted**: `blelab/filters.py`, with `--device` (peer Bluetooth
address) and `--handle` (ACL connection handle) across `live.py`, `analyze.py` and
`diff.py`. This is not a nicety on macOS. A host-side Mac capture records *all* the
host's Bluetooth traffic, and this host has a Magic Mouse and Magic Keyboard
(`system_profiler`, above) generating continuous HID reports — the Click's handshake is a
handful of packets inside that. Note `--device` depends on tshark resolving addresses
from the HCI connection-complete event, so **the capture must start before the
connection**; `--handle` is the fallback when it did not.

### Third addendum (same day) — PacketLogger installed but capturing nothing: root-caused, and it has a CLI

The user installed PacketLogger, connected the devices, and saw an empty window. Two
distinct causes, both found by inspection rather than guesswork, plus a discovery that
changes the recommended macOS workflow.

**Evidence:**

```
$ pgrep -lf PacketLogger
77685 /private/var/folders/.../AppTranslocation/8D12A47D-.../d/PacketLogger.app/...
78888 /Applications/PacketLogger.app/Contents/MacOS/PacketLogger

$ xattr -l /Applications/PacketLogger.app
com.apple.quarantine: 01c1;6a69e098;Chrome;92FE4901-...

$ ls /Library/PrivilegedHelperTools /Library/LaunchDaemons | grep -i packet
(nothing)

$ ls /Applications/PacketLogger.app/Contents/Library/LaunchServices/
com.apple.bluetooth.PacketLoggerHelper        ← present in the bundle, never installed
```

**Cause 1 — App Translocation.** PID 77685 ran from an `AppTranslocation` mount: macOS
runs a still-quarantined app from a randomised read-only path. That copy came from the
DMG, not `/Applications`, and a translocated app cannot reliably install a privileged
helper. Two instances were also competing for a single HCI tap.

**Cause 2 (the real one) — the privileged helper was never installed.** PacketLogger's
GUI reaches the HCI stream through `com.apple.bluetooth.PacketLoggerHelper`, installed
via `SMJobBless` on first launch (which prompts for admin). It is present inside the
bundle and absent from both `/Library/PrivilegedHelperTools` and
`/Library/LaunchDaemons`. **With no helper the GUI shows an empty window and no error
whatsoever** — the most confusing possible failure mode. Version was fine (26.0.0 on
macOS 26.5), so this was never a compatibility problem.

**The discovery: PacketLogger.app contains a CLI**, at
`Contents/Resources/packetlogger`, with a `PacketLogger.8` man page. `packetlogger
convert` *captures* as well as converts:

```
convert [options]:            Capture or convert HCI traces
  -s, --stdout                  Output to stdout
  -o, --output FILE.[PKLG|TXT]  Output ... HCI file
  -b, --bufferedPackets         Include buffered packets
  -u, --udid udid               iOS device udid to capture HCI from   ← also does iOS
```

Run unprivileged it reports `Error: Live traces require root privilege`. Under `sudo` it
works, and **needs no helper** — which makes it strictly better than the GUI here:
scriptable, no save step, no silent-failure mode.

Also verified: **tshark reads PacketLogger format from stdin** (worth checking, since
`.pklg` has no magic number and format sniffing from a pipe is not a given). So this
pipes straight through with no conversion:

```bash
sudo /Applications/PacketLogger.app/Contents/Resources/packetlogger convert --stdout \
    | ./live.py --backend stdin --preset all
```

**Revised macOS recommendation: use the CLI, not the GUI.**

Tooling added: `--backend macos` in `live.py` (locates the binary and runs it under
sudo), and `macos_preflight()` now reports `packetlogger_cli`, `gui_helper_installed`
and `translocated_instances`, so `capture.py --backend macos` diagnoses this class of
failure instead of leaving the operator staring at an empty window. Five self-test
checks cover it, including the tshark-reads-pklg-from-stdin assumption.

**Incidental finding worth keeping**: `--udid` means this same CLI captures HCI from a
**tethered iOS device**. If the Zwift Companion phone turns out to be an iPhone, that is
a viable backend and one this record previously assumed required a separate profile
install.

### Fourth addendum (same day) — **macOS PacketLogger FAILS on this machine. Buy the dongle.**

After exhausting every configuration, `packetlogger` **cannot receive HCI packets on this
Mac at all**. This supersedes the second and third addenda's "macOS is rank 1" call.

**The decisive test** (all confounds removed):

| Confound | Removed how |
|---|---|
| Competing instances holding the HCI tap | `pgrep -lf packetlogger` clean before starting |
| Pipe block-buffering | used `--output FILE`, which buffers in memory and flushes on SIGINT — no pipe |
| Nothing to capture | toggled Bluetooth OFF then ON, which emits dozens of HCI commands/events |
| Wrong stop signal losing the buffer | stopped with SIGINT via the terminal |

**Result: 260 bytes, one record, zero packets** — the same
`Disconnected from OS X Device` note every time:

```
$ tshark -r captures/smoke.pklg -n
1  0.000000  →  PKTLOG 248 Disconnected from OS X Device
```

So the tool attaches to the HCI source and receives nothing. Root is not sufficient: it
gates on root (`Error: Live traces require root privilege`) and then still gets no packet
flow. Leading explanation is the **missing privileged helper**
(`com.apple.bluetooth.PacketLoggerHelper`, absent from `/Library/PrivilegedHelperTools`
and `/Library/LaunchDaemons`) — the entitlement to receive the HCI stream appears to live
with the helper, not with uid 0. The one untried remedy is launching the GUI from
`/Applications` and accepting the `SMJobBless` admin prompt; not attempted because the
user opted for the sniffer instead.

Also worth recording: `sudo xattr -dr com.apple.quarantine /Applications/PacketLogger.app`
fails with `Operation not permitted` **even as root**, because of macOS 14+ **App
Management** protection on signed apps. Terminal would need App Management permission in
Privacy & Security. It is irrelevant to the failure — the CLI runs fine while quarantined.

**Cost of this branch**: ~6 failed capture attempts across three distinct bugs (two of
them mine — see the third addendum), all producing empty files.

### Revised recommendation, third time: **buy the nRF52840 dongle**

Now the sound purchase, on evidence rather than preference:

- macOS host-side is **empirically dead** on this machine.
- Android host-side remains untried, but requires knowing the phone is Android and
  fiddling with developer options.
- The Linux box cannot sniff a third-party link (governing fact, first addendum) — it can
  only be an unrestricted-client oracle.
- The dongle is the **only** option that captures *both* endpoints from one point, and it
  turns the Linux box into the tidy always-on host it is well suited to be.
- **£10.45 ex-VAT**, verified.

**Pipeline support verified before recommending the spend** (2026-07-29, this tshark
4.4.9):

```
tshark -G dissectors  →  nordic_ble   NORDIC_BLE       ✅
                         btle_rf      BTLE RF          ✅
btle fields present   →  303                           ✅
libwiretap            →  WTAP_ENCAP_NORDIC_BLE         ✅  (LINKTYPE 272)
```

So `nordic_ble → btle → btl2cap → btatt` will populate the same `btatt.opcode/handle/value`
fields the rest of this toolkit already keys off, and `analyze.py`/`diff.py` work unchanged.

**One toolkit change was needed and is done**: sniffer captures have **no HCI layer**, so
there is no `Sent`/`Rcvd` in the info column and direction must come from
`nordic_ble.direction`. That field is now queried and used.
⚠️ **Its polarity is UNVERIFIED** — confirm on the first real capture by checking that the
`RideOn` write appears as **TX**, and flip it in `dissect.py` if not.

**The residual risk, stated plainly**: an over-the-air sniffer sees the *encrypted* link
and cannot decrypt under LE Secure Connections. Our evidence says this link is almost
certainly unencrypted (Chrome reaches the ZAP characteristics with no pairing prompt
across `01`/`03`/`04`), so it should read in the clear — but this is the one way the £12
could be wasted. Secondary risks are ordinary: the sniffer must catch the CONNECT_IND to
follow the connection, and it can drop packets.

**Still cheaper than any of this**: the `FF 04 00` browser test
([`13`](13-ff-family-frame-decode.md)) needs no capture at all.

### Fifth addendum (2026-07-29) — the reference writeups both used an OTA sniffer, which independently validates the dongle

Checked how the two authoritative sources for this protocol actually captured it:

- [Zwift Ride protocol](https://www.makinolo.com/blog/2024/07/26/zwift-ride-protocol/):
  *"…who not only has a Zwift Ride but also knows how to launch a **Bluetooth sniffer** and
  filter the traffic through **Wireshark**, I was able to get a complete communication
  dump"* — a **.pcapng** file.
- [Connecting to Zwift Play controllers](https://www.makinolo.com/blog/2023/10/08/connecting-to-zwift-play-controllers/):
  *"the only way was **sniffing BLE traffic** between Zwift App and the device."*

**Neither used host-side HCI logging.** No PacketLogger, no `btmon`, no Android snoop log
mentioned in either. The entire external documentation of this protocol was produced with
an over-the-air sniffer plus Wireshark — the exact method this record originally ranked
last and now recommends buying.

That is independent validation of the fourth addendum's flip, arrived at from a different
direction: not "host-side failed so fall back", but "the sniffer is the method that
demonstrably produced these results on this protocol."

**It also substantially de-risks the encryption concern** — the one way the £12 could be
wasted. makinolo (Ride post): *"Zwift got rid of the Bluetooth communication encryption
they were using for the Play and the Click."* So Ride-family firmware, which ours is
(H15), transmits in the clear and a passive sniffer will read it. Encryption was only ever
a risk for the older Play-era scheme.

**Pipeline confirmed for what a sniffer actually emits** (tested this session): the
toolkit reads **pcapng** through both paths — `analyze.py`'s file-direct route and
`live.py`'s raw-bytes-to-stdin route — decoding `btatt.opcode`/`value` correctly from a
pcapng in both cases. Combined with the fourth addendum's `nordic_ble`/`btle`/
`WTAP_ENCAP_NORDIC_BLE` checks, nothing in the toolchain needs changing when the dongle
arrives beyond confirming the `nordic_ble.direction` polarity.

**One caveat the sniffer inherits and host-side did not**: it must catch the
`CONNECT_IND` to follow a connection, so **start the sniffer before connecting**. Our
`--device` filter has the same requirement for a different reason (address resolution), so
the operating rule is uniform: capture first, connect second.

### Sixth addendum (2026-07-29) — **Android also FAILS. The dongle is the only path left.**

Phone identified and tested: **Samsung SM-S711B (Galaxy S23 FE), Android 16, SDK 36**,
serial `RZCX111AEGD`. Blocker 1 resolved — it *is* Android — but both Android routes fail.

**Route A — live snoop socket: the socket does not exist.**

`adb forward` succeeds and then the phone closes the connection with zero bytes, because
forwards are registered lazily. `adb logcat` gives the real error:

```
E adbd: failed to connect to socket 'localabstract:btsnoop':
        could not connect to localabstract address 'localabstract:btsnoop'
```

And no listener exists — the complete abstract-socket list (`/proc/net/unix`) contains
nothing Bluetooth-related. This is despite:
- `sSnoopLogSettingAtEnable = FULL` (snoop logging *is* on; the Developer-options toggle worked)
- `persist.device_config.aconfig_flags.bluetooth.INIT_gd_hal_snoop_logger_socket = true`

**The legacy properties everyone documents are dead**: `persist.bluetooth.btsnoopenable`
and `persist.bluetooth.btsnooplogmode` are both unset on Android 16. The authoritative
runtime state is `dumpsys bluetooth_manager | grep sSnoopLogSettingAtEnable`.

**Route B — `dumpsys` embedded btsnooz: decodable, but filtered to uselessness.**

`dumpsys bluetooth_manager` embeds a base64 btsnooz v2 log. Decoding it needs no root:

```python
raw = base64.b64decode(body)          # after --- BEGIN:BTSNOOP_LOG_SUMMARY ---
version, last_ts = struct.unpack_from("<bQ", raw, 0)   # version == 2
data = zlib.decompress(raw[9:])       # 62,289 bytes, matching the declared size
```

But it contains **no device addresses at all** — not the Click's, not the KICKR's, not even
the host's — and no `RideOn`. Useless for our purpose.

**Route C — `adb bugreport`: the real log is there, and it is payload-filtered.**

`adb bugreport` (29 MB) does contain a genuine btsnoop file at
`FS/data/log/bt/btsnoop_hci.log` — note the path, **not** the
`/data/misc/bluetooth/logs/` that every guide cites. 593 KB, magic `btsnoop\0`, datalink
1002 (H4), 3,779 frames, read by tshark without complaint.

**And zero of them are ATT:**

| Layer | Frames |
|---|---|
| `bthci_cmd` / `bthci_evt` | 2,783 |
| `bthci_acl` | 996 |
| `btl2cap` | 996 |
| **`btatt`** | **0** |

> ### ⚠️ SELF-CORRECTION — I over-concluded here, and the user caught it
>
> I first wrote that this proved the ACL payloads are stripped. **It does not.** The
> bugreport was taken while **nothing was doing GATT** — no Click session had been
> attempted, and `dumpsys` confirms zero devices connected during the window.
>
> All 996 ACL frames dissect as *"Connection oriented channel"* — L2CAP **CoC**, which is a
> genuinely different channel type from ATT (CID 0x0004). tshark classified them
> successfully, which is evidence the payloads were **present and parseable**, not stripped.
> Zero `btatt` frames is exactly what an idle-GATT window should look like.
>
> **The ATT question is therefore UNTESTED, not answered.** What this run actually proved:
> the bugreport contains a real btsnoop file at a non-obvious path, our pipeline reads it,
> and rich HCI-level detail survives. Whether ATT payloads survive is still open.
>
> Corrected before acting on it. The "filtered" reading remains *possible* —
> `INIT_gd_hal_snoop_logger_filtering = true` is set — but it is not what this evidence shows.

**The operational constraint this run DID establish**, and it is the thing most likely to
silently ruin a real capture: **the snoop log is a rolling buffer of roughly the last 7
minutes** (593 KB spanning 15:29:23 → 15:36:38, ending at the bugreport). So the bugreport
must be run **immediately** after the activity you want. Wait too long and the session rolls
out of the window, producing a perfectly valid log of nothing.

**Validating the route without burning a Click session**: the phone has 23 bonded devices
including a **Galaxy Watch4** and a **(BLE)Edge 530**, both of which use GATT heavily. Let
one reconnect, run a bugreport straight away, and count `btatt` frames. Non-zero ⇒ payloads
survive and the Click capture will work. Zero, *with a GATT device demonstrably connected*
⇒ genuinely filtered, and Android is dead. That is the test to run before anything else.

**Verdict: macOS and the live-socket routes are exhausted; the bugreport route is
UNVALIDATED, not failed.**

| Backend | Outcome |
|---|---|
| macOS PacketLogger | attaches, receives **0 packets** (missing privileged helper) — 4th addendum |
| Android live socket | **socket absent** on this build |
| Android btsnooz (`dumpsys`) | decodable, **no addresses, no payloads** |
| Android bugreport btsnoop | real log, **0 ATT frames — payloads filtered** |
| Linux home server | cannot sniff a third-party link (1st addendum) |
| **nRF52840 dongle** | **the only remaining path** |

Three independent confirmations now point the same way, and the user reached this decision
before the evidence did. Toolkit support was verified in advance (4th/5th addenda:
`nordic_ble`/`btle` dissectors, `WTAP_ENCAP_NORDIC_BLE`, pcapng through both paths).

**Tooling hardened from this session**: `android_preflight()` now reads the real runtime
snoop mode from `dumpsys` and verifies via `/proc/net/unix` that the socket actually
exists; `--backend android` refuses upfront with that diagnosis rather than reporting a
misleading "socket closed by device". Three self-test checks added (70/70).

### Caveats to check before relying on the server

- **BLE range.** It must be within radio range of the Click. A marginal link produces
  drops that look exactly like the vendor-lock behaviour we are trying to characterise —
  a genuine confound, not a nuisance.
- **Contention.** One GATT client at a time. While the server holds the Click, Chrome
  cannot, and vice versa.
- **`sudo`.** `btmon` needs `CAP_NET_RAW`. The `ssh` backend uses `sudo -n` and fails
  fast rather than hanging if a password is required.

---

## Follow-ups

1. Answer blocker 1 (phone OS). Everything else is downstream.
2. Run `tools/ble-lab/selftest.py` on the machine that will do the capturing, to
   separate tool failure from device silence before the first real run.
3. Run the ~2-minute pairing-screen check to settle H-P0c before any large download.
4. Run scenarios in the order given in
   [`12-connection-capture-preregistration.md`](12-connection-capture-preregistration.md)
   — `trainer-control` **first**. It is the control experiment: our FTMS connection
   demonstrably works, so any divergence the method reports there is a false positive
   in the method itself. Validating the instrument on a known-good case before
   trusting it on the Click is the whole reason that scenario exists.
5. Two findings from this session's protobuf work belong in `PROTOCOLS.md` §1.4/§1.5
   and are recorded in
   [`13-ff-family-frame-decode.md`](13-ff-family-frame-decode.md) — the 0xFF-family
   frames from `03`/`04`, previously left undecoded, parse cleanly as
   `FF <sub> 00` + protobuf.
6. If Android turns out to be the backend, consider capturing the **macOS** side
   separately for scenario 9 rather than losing the same-clock advantage — or accept
   that our harness runs on Android Chrome for that one comparison (which also
   incidentally covers HW-V11's Android-parity question).
