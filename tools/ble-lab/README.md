# ble-lab — BLE connection capture & analysis

Tooling for one question: **what should our Web Bluetooth `connect()` function do
differently?**

Everything here exists to turn a host-side HCI capture of the official Zwift apps
talking to a Zwift Click into a step-by-step connection recipe our browser code can
implement — plus an honest list of the steps Web Bluetooth *cannot* reproduce.

Read [`docs/virtual-shifting/CONNECTION-RECIPE.md`](../../docs/virtual-shifting/CONNECTION-RECIPE.md)
for the output. Read
[`experiments/11-capture-backend-selection.md`](../../docs/virtual-shifting/experiments/11-capture-backend-selection.md)
for why the backends are ranked the way they are.

---

## Install

Python 3.10+, standard library only. Two external binaries:

```bash
brew install wireshark                          # tshark — does all HCI/ATT dissection
brew install --cask android-platform-tools      # adb — only for the Android backend
```

`wireshark` is the big one and it is not optional: **we do not dissect HCI
ourselves.** tshark's Bluetooth dissectors track ATT handle→UUID bindings across a
capture, which is precisely the correlation a hand-rolled parser gets wrong. This
toolkit's job is to normalise capture formats into something tshark can stream, and
to present the result for human pattern recognition.

macOS host-side capture additionally needs **PacketLogger.app**, which ships inside
*Additional Tools for Xcode* — a separate download behind a (free) Apple ID sign-in,
so no script can install it:
<https://developer.apple.com/download/all/?q=Additional%20Tools> → mount the DMG →
`Hardware/PacketLogger.app`.

### Known Homebrew issue

Homebrew's `wireshark 4.4.9` ships extcap binaries with a broken `@rpath`, so
`tshark -D` prints `dyld: Library not loaded: @rpath/libwiretap.15.dylib`. Harmless
for us (we never use extcap), and this toolkit sets `DYLD_LIBRARY_PATH` internally
so the noise disappears. It is why `live.py`'s Android backend talks to `adb`
directly instead of going through Wireshark's `androiddump`.

### Verify before you go to the bike

```bash
./selftest.py
```

Synthesises two capture files — one shaped like the official app's connect sequence,
one shaped like our current harness's, with the divergences a code read of
`src/dev/ble-lab.html` predicts — then runs the real analyze/diff code over them and
asserts the planted divergences are the ones reported. 45 checks, no hardware.

At the bike, "the tool printed nothing" and "the device did nothing" look identical.
Run this first so you know which one you are looking at.

---

## The six tools

| Script | Does |
|---|---|
| `capture.py` | Runs one scenario: prints its prediction, prompts each physical action with a countdown, writes precisely timestamped action markers + a manifest |
| `live.py` | Watch-it-happen view — one aligned line per ATT operation, in real time |
| `analyze.py` | Offline pass — reconstructs the connection as a phase-labelled state machine, attributes packets to markers, infers protobuf, emits a markdown report |
| `diff.py` | Aligns two or more runs; reports which steps and which byte offsets are stable vs varying |
| `replay.py` | Serves the Web Bluetooth harness and collects its per-step pass/fail verdict |
| `android-capture.py` | The Android route end to end: checks phone readiness, pulls the bugreport, turns the phone's **own logs** into action markers, then analyses — one command |

All standalone, all `--help`, all `-v` for verbose. No state is remembered between
runs — every invocation re-reads its inputs from disk.

### How much of the dissection is tshark's, and how much is ours

tshark does **HCI/L2CAP framing, reassembly and layer identification** — the stateful,
format-specific work. We decode the **ATT PDU** ourselves, from the raw bytes tshark hands
us (`btatt_raw`), because two of its behaviours cost us real findings on the 2026-07-29
Click capture (`docs/virtual-shifting/experiments/15-zwift-app-click-session.md` §4):

- **`btatt.value` is empty whenever tshark recognises the attribute type.** It exports the
  payload under a type-specific name instead — `btatt.battery_level`,
  `btatt.firmware_revision_string`, `btatt.characteristic_configuration_client` — so a fixed
  field list silently loses the bytes for most reads, writes and notifications.
- **Its handle→UUID bindings are global, so they leak between connections.** In a capture
  holding a trainer *and* a controller, the second device's handles inherit the first's
  UUIDs. `blelab/attpdu.py`'s `AttributeTable` learns bindings **per connection** from that
  connection's own declarations and overrides tshark; where discovery was not captured it
  reports nothing rather than guessing.

An ATT PDU is self-describing (Core v5.x Vol 3 Part F §3.4), so decoding it needs no
cross-frame state and cannot inherit either error. This **supersedes** the decision recorded
in `experiments/11` ("we never hand-roll ATT dissection because tshark tracks handle→UUID
bindings") — that tracking is precisely what breaks on our captures.

### `analyze.py` report sections

1 state machine · **2 link sessions** · 3 what Web Bluetooth cannot reproduce · 4 findings ·
5 ordered step list · 6 payload catalogue + protobuf · 7 timing · 8 marker attribution ·
9 capture-embedded log lines.

**Section 2 is the one to read first on any drop investigation.** It reports each link's
duration and the **HCI reason code** for its teardown, attributed to *peer stopped
responding* (`0x08`/`0x22` supervision timeout) vs *peer hung up deliberately*
(`0x13`/`0x15`) vs *we hung up* (`0x16`). Web Bluetooth's `gattserverdisconnected` carries no
reason at all, so this distinction can only ever come from a capture — it is what turned
"the Click dropped us again" into "the link lapsed on a supervision timeout at 73.5 s, while
the trainer's idle link on the same phone survived 2 min 15 s".
It is always computed **unfiltered**, because HCI events carry no ACL address and a
`--device` filter would exclude every one of them.

---

## Capture backends

| Backend | Sees decrypted ATT? | Cost | Use for |
|---|---|---|---|
| `android` | Yes — host-side, taps above the link layer | free (`adb`) | Primary. Live streaming. |
| `pklg` | Yes — host-side | free, but PacketLogger is a login-walled download | macOS; the only backend that can capture the official app *and* our Chrome harness on one clock |
| over-the-air sniffer | Only if it catches pairing, and never under LE Secure Connections | ~$12–40 hardware | Not recommended — see the Phase 0 record |

Plus two raw-stream backends that need no format conversion, because tshark reads
btsnoop and pcap straight from stdin:

| Backend | Source |
|---|---|
| `stdin` | anything piped in: `ssh box 'sudo btmon -w /dev/stdout' \| live.py --backend stdin` |
| `ssh` | the same thing, managed for you: `live.py --backend ssh --ssh-host box` |

The ranking follows from where each tool taps. **Link-layer encryption is applied by
the Bluetooth controller, below HCI.** A host-side HCI log therefore shows plaintext
ATT payloads regardless of whether the link is encrypted. An over-the-air sniffer
sees the encrypted link layer and, under LE Secure Connections, cannot derive the
key even with a perfect capture of the pairing exchange. That asymmetry, not
convenience, is why host-side wins.

### The corollary that decides where you run the capture

A host-side HCI log shows **only that host's own controller's traffic**. It is not a
radio scanner. So:

> **You must capture on the machine that is one endpoint of the connection you want to
> see.** To capture the official app talking to the Click, the capture has to run on
> the device running the app. To capture our page talking to the Click, it has to run
> on the device running Chrome.

A third machine that merely has a Bluetooth adapter and is sitting nearby sees
**nothing** of a connection between two other devices. Standard BLE controllers have no
promiscuous mode for established connections — following an active connection means
tracking its channel-hop sequence, which requires sniffer firmware (nRF Sniffer,
Sniffle), not a normal adapter.

This is also why "one host for both sides" is worth engineering for: it is what makes
`diff.py app ours` a clean comparison on a shared clock.

---

## All-on-the-Mac runbook (recommended if you install Zwift for Mac)

This is the **best** version of the app-vs-us comparison, because the Mac is one
endpoint of *both* connections: Zwift for Mac talks to the Click, and Chrome talks to
the Click, and PacketLogger sees both through the same `bluetoothd`. One tool, one
clock, no phone involved.

### Installs (both free)

1. **PacketLogger** — <https://developer.apple.com/download/all/?q=Additional%20Tools>
   → mount the DMG → `Hardware/PacketLogger.app` → **drag to `/Applications` in
   Finder, then eject the DMG**, and launch it only from `/Applications`.
   Needs a (free) Apple ID. Full Xcode is *not* required.

   > **Launching it straight from the DMG is the #1 way to get a silent failure.**
   > macOS App Translocation runs a quarantined app from a randomised read-only
   > mount, and that copy cannot install the privileged helper it needs — so you
   > get an empty window and no error. Check with `pgrep -lf PacketLogger`: any
   > path containing `AppTranslocation` is the bad copy.

   **Use the CLI instead of the GUI.** PacketLogger ships a command-line binary
   inside its bundle that captures live, needs no helper, and is scriptable:

   ```bash
   sudo /Applications/PacketLogger.app/Contents/Resources/packetlogger \
       convert -o capture.pklg          # capture to a file
   ```

   It refuses without root (`Error: Live traces require root privilege`). Piped
   into the live view — PacketLogger format on stdout, which tshark reads
   directly:

   > ### ⚠️ Two measured facts about this tool, both non-obvious
   >
   > **1. `--output FILE` buffers the whole capture in memory and writes nothing
   > until the process exits.** The file stays 0 bytes for the entire run.
   > Verified with two devices connected and traffic flowing. So you cannot tail
   > it, and a 0-byte file mid-capture does *not* mean the capture is failing.
   > **It flushes only on SIGINT** — `Ctrl-C`, or
   > `sudo pkill -INT -f "packetlogger convert"`. Any other signal loses the lot.
   >
   > **2. Only one process may hold the macOS HCI tap.** A second instance
   > attaches, records nothing, and writes a single `Disconnected from OS X
   > Device` note — a capture that looks fine and contains zero packets. Always
   > `pgrep -lf packetlogger` first. `--backend macos` refuses to start if
   > anything else holds the tap, and `analyze.py` recognises the notes-only
   > signature rather than reporting confidently about nothing.

   **The reliable path — capture, then analyse:**

   ```bash
   PL=/Applications/PacketLogger.app/Contents/Resources/packetlogger
   sudo "$PL" convert -o ../../captures/run.pklg     # Ctrl-C when done — this
                                                     # is when it writes
   ./analyze.py --file ../../captures/run.pklg
   ```

   **Best-effort live view** (`--stdout` streams, but may still block-buffer on
   the pipe, so a quiet capture can lag):

   ```bash
   ./live.py --backend macos --out ../../captures/run.pklg --preset all
   ```

   It tees a verbatim copy to `--out` while displaying, and if no bytes arrive
   within 20 s it says so and names the fallback above rather than sitting
   silent. **For a genuinely reliable live view, use the Android or `ssh`/`btmon`
   backend** — neither buffers like this.

   `./capture.py --backend macos` prints a readiness check that reports whether
   the GUI helper is installed, whether a translocated copy is running, and the
   exact CLI command for your machine.
2. **Zwift for Mac** — <https://zwift.com/download> and a free account.
   **No subscription needed**: the device-pairing screen sits before the ride paywall,
   and pairing is where the whole connect + handshake happens.

### Verify before investing effort (2 minutes)

Open Zwift, log in, reach the pairing screen, and confirm the Click appears and connects.
**This is the one load-bearing unknown** — Zwift's Click support on macOS has not been
verified by this project. If the Click does not show up there, stop: fall back to
Android, and record the finding.

### Find the Click's address once, so you can filter by it

A Mac capture is *mostly other traffic* — a Magic Mouse and Magic Keyboard produce a
continuous stream of Bluetooth HID reports, and the Click's handshake is a handful of
packets buried in it. Capture once unfiltered, find the address, then filter every later
analysis by `--device`.

```bash
./analyze.py --file first-capture.pklg --preset connection | head -40   # spot the address
```

### Capture 1 — Zwift → Click

Two terminals. Terminal A records packets, terminal B records what you physically did.

```bash
# Terminal A — start this FIRST and leave it running
pgrep -lf packetlogger || echo "tap is free"      # must print nothing but this
PL=/Applications/PacketLogger.app/Contents/Resources/packetlogger
sudo "$PL" convert -o ../../captures/zwift-click.pklg

# Terminal B — the marker recorder
./capture.py --scenario handshake --backend macos --app "Zwift for Mac <version>"
./capture.py --scenario buttons   --backend macos --app "Zwift for Mac <version>"
```

**Ctrl-C terminal A when done — that is the only moment it writes.** The file will
read 0 bytes for the whole run; that is normal, not a failure.

### Capture 2 — Chrome → Click

**Quit Zwift completely first.** Only one client can hold a GATT connection, so while
Zwift has the Click, Chrome cannot get it.

```bash
# Terminal A
sudo "$PL" convert -o ../../captures/chrome-click.pklg
# Terminal B
./replay.py --serve --open --out ../../captures/replay-01.json
```

### Compare — the actual goal

```bash
./diff.py ../../captures/zwift-click.pklg ../../captures/chrome-click.pklg \
    --label zwift --label chrome --device AA:BB:CC:DD:EE:FF
```

Read the output in this order: **phase presence** (did Zwift do a phase we skip?),
**phase ordering** (did it do them in a different order?), then **step-level
differences** — that last section is the answer. Every entry under *"only in `zwift`"* is
either a bug in our connect code, a browser limitation, or a step we are missing.

The line to look hardest for is any `zwift`-only **write** to SYNC RX (`…0003`). That is
the keep-awake-or-authcode question answered directly. `analyze.py` also surfaces it as a
top-level finding: *"The app WROTE a 0xFF-family frame: …"*.

### Gotchas, in the order they bite

1. **Wake the Click** with a button press before every connect — asleep, it does not
   advertise and will not appear.
2. **Quit the other client** completely between captures.
3. **The phone's logs word connects two different ways.** A **bugreport** carries
   `BLUETOOTH_DEVICE_EVENT 1 deviceAddress=F4:C4:59:81:D9:A1, deviceName=Zwift Click` (full
   address, in an *indented* event-log section — anchoring a timestamp regex at start-of-line
   loses every one of them). **Live logcat has no such line**: a connect is two non-adjacent
   `BluetoothDeviceBatteryManager` lines and the address is redacted to `F4C459_1` (OUI +
   final hex digit). `blelab/androidlog.py` handles both, and `--expect` takes a full address
   and redacts it for you.
4. **btsnoop timestamps are not necessarily the phone's wall clock.** On the 2026-07-29 phone
   they ran exactly **+1 h** (Android writes local time; tshark reads btsnoop as UTC).
   `androidlog.time_offset` measures the whole-hour shift that lands the most markers inside
   the capture and refuses to correlate if none fits — never assume the clocks agree.
5. **Start PacketLogger before connecting.** tshark resolves device addresses from the
   HCI connection-complete event, so `--device` only works if the capture includes the
   connection being established. Missed it? Use `--handle` instead.
   `--device` now resolves the address to its ACL handle(s) and filters on those, because an
   address filter is *incomplete*: tshark cannot bind an address to every ACL frame, and on
   the 2026-07-29 Click capture it returned 100 ATT frames where the handle filter returned
   102 — one of the two lost frames being a discovery response, which cost the attribute
   table a whole service. If you see `no connection-complete event for …, falling back to an
   address filter`, expect gaps and prefer `--handle`.
4. **Do not "forget" the Click in Zwift** yet — that discards the Companion-sync unlock
   state that currently makes our harness usable at all. Only the `cold-connect` scenario
   wants that, and it should be run last.

---

## Using a Linux box (e.g. a home server) — what it can and cannot do

`btmon` on Linux is the best BLE debugging tool in existence, better than PacketLogger,
and it writes btsnoop that this toolkit reads directly. But be clear about the role.

### ❌ It cannot sniff the app↔Click connection

Per the corollary above, unless the Zwift app runs *on that box*. It does not: there is
no Linux Zwift client, and Companion is Android/iOS only. A server in the same room is
still a bystander.

### ✅ It can do the advertisement baseline, for free

Scanning for advertisements *is* something any adapter does. This replaces the
nRF-Connect-on-a-phone suggestion and is better because it is scriptable and logged:

```bash
# terminal 1 — capture
ssh box 'sudo btmon -w /dev/stdout' | ./live.py --backend stdin --preset all \
    --save-pcap ../../captures/adv-baseline.btsnoop
# terminal 2 — make it scan
ssh box 'bluetoothctl --timeout 60 scan on'
```

Gives full AD structures including the `0x094A` manufacturer data and the device-type
byte — none of which Web Bluetooth can ever see, so treat it as reference only.

### ✅ Its best use: an unrestricted BLE client, as the oracle

This is the genuinely valuable role, and it may beat capturing the app outright for the
authcode/keep-awake question.

Web Bluetooth is a deliberately narrow abstraction. A Linux client is not: it can pair
and bond, set the MTU, read the disconnect reason code, tune connection intervals, and
send arbitrary bytes at arbitrary times — while `btmon` records a complete HCI trace of
everything it did.

That makes it a **control for the browser's limitations**. If a full-control native
client holds the Click connection indefinitely and Chrome drops it at 90 s, the
difference between the two traces isolates exactly what the browser is missing. And if
the native client *also* drops at 90 s, the browser was never the problem — which would
retire a whole branch of this investigation.

```bash
# terminal 1
ssh -t box 'sudo btmon -w /dev/stdout' | ./live.py --backend stdin --preset all
# terminal 2 — drive the Click by hand and watch it land in terminal 1
ssh box
  bluetoothctl
    scan on                      # press a Click button first; it must be awake
    connect AA:BB:CC:DD:EE:FF
    menu gatt
    select-attribute <SYNC RX 00000003-19ca-...>
    write "0x52 0x69 0x64 0x65 0x4f 0x6e"        # RideOn
    write "0xff 0x04 0x00"                       # the experiment from experiments/13
```

Two practical caveats before relying on this:

1. **Range.** The server has to be within BLE range of the Click. A server in a cupboard
   two rooms from the bike will not connect, and a marginal link produces drops that
   look exactly like the vendor-lock behaviour we are trying to characterise.
2. **Contention.** Only one client can hold a GATT connection at a time. If the server
   is connected, Chrome cannot be, and vice versa.

### ✅ It is the natural host for an OTA sniffer — and that is worth £12 if host-side proves awkward

An always-on Linux box with an **nRF52840 dongle** (£10.45 ex-VAT) is the tidiest
possible sniffer rig, and it is the *only* setup that captures **both** endpoints from
one point on one clock — no Apple ID download, no Zwift install, no phone developer
options.

Sequencing, not principle, is why it is not the first move: run the free `FF 04 00` test
from
[`experiments/13`](../../docs/virtual-shifting/experiments/13-ff-family-frame-decode.md)
first, because if a 3-byte write fixes the drop cadence there is nothing left to
capture. If it does not, buy the dongle and put it here. See the revised recommendation
in
[`experiments/11`](../../docs/virtual-shifting/experiments/11-capture-backend-selection.md).

### Server prerequisites

```bash
ssh box 'which btmon || sudo apt install bluez'   # btmon ships with bluez
ssh box 'bluetoothctl show'                       # adapter present and powered?
```

`btmon` needs `CAP_NET_RAW`, so it runs under `sudo`. The `ssh` backend uses `sudo -n`
(non-interactive) and will fail fast rather than hang if a password is required —
configure passwordless sudo for `btmon`, or use `ssh -t` with the `stdin` backend.

---

## Typical session

### 1. Capture

Start the backend first, then run the scenario alongside it.

**macOS:** open PacketLogger, `Cmd-N` for a new capture window, then:

```bash
./capture.py --scenario warm-reconnect --backend pklg --out ../../captures
```

**Android:** enable *Developer options → Enable Bluetooth HCI snoop log*, then
**toggle Bluetooth off and on** — without that the socket exists but stays silent,
which is the single most common reason you get nothing. Then, in two terminals:

```bash
./live.py --backend android --save-pcap ../../captures/run.pcap   # terminal 1
./capture.py --scenario warm-reconnect --backend android          # terminal 2
```

`capture.py` prints the scenario's *prediction* before the first prompt. Read it
before acting — that is the only moment a prediction is still falsifiable.

Press ENTER at the exact instant you perform each physical action; that writes the
marker. Markers are flushed to disk after every step, so an aborted run keeps what
it got.

### 2. Watch it happen

```bash
./live.py --backend android --filter-uuid zap
./live.py --backend pklg --file ~/cap.pklg --tail --preset connection
```

Presets: `all`, `att`, `gatt`, `connection`, `writes`, `notifications`,
`no-telemetry` (default — drops the high-rate Indoor Bike Data and battery streams).

Repeated identical keepalives collapse into `⤶ (×N identical)`, because 300 identical
lines hide the one line that matters. `--no-collapse` if you want them all.

### 3. Analyse

```bash
./analyze.py --file ~/cap.pklg --manifest ../../captures/*-warm-reconnect.manifest.json \
    --report ../../docs/virtual-shifting/experiments/NN-warm-reconnect.md
```

Produces the phase table (each row classified reproducible / implicit / unreachable
for Web Bluetooth), the unreachable list, findings phrased as changes to our
`connect()`, the ordered step list with packet numbers, every distinct payload with
its protobuf verdict, measured intervals, and marker attribution.

### 4. Diff

```bash
./diff.py app.pklg ours.pklg --label app --label ours
./diff.py cold.pklg warm.pklg --label cold --label warm    # isolates one-time bonding
```

The centrepiece comparison is `app` vs `ours`. Every divergence is one of three
things and the report is structured to make you say which: a bug in our connect
code, a browser-imposed limitation, or a step we are missing entirely.

### 5. Replay and falsify

```bash
./replay.py --serve --open --out ../../captures/replay-01.json
```

Serves `harness/index.html` on `http://localhost:8765`. The harness must be served
rather than opened from disk: Web Bluetooth needs a secure context, and `file://`
pages have no `navigator.bluetooth` at all.

The page executes the recipe step by step and reports PASS/FAIL per step, then
answers the one question that matters — *did a plain webpage connect and receive
button events?* Its last few steps are *expected* to fail: reading the negotiated
MTU, reading manufacturer data, and initiating pairing are all recorded as failures
so the Unreachable list is **generated by the harness rather than asserted in prose**.

Click *Run recipe* yourself — the chooser needs a real user gesture, so the page
cannot self-start.

---

## Layout

```
tools/ble-lab/
  capture.py  live.py  analyze.py  diff.py  replay.py   # CLIs
  selftest.py                                           # no-hardware verification
  harness/index.html                                    # Web Bluetooth replay harness
  blelab/
    pcapio.py    format readers (btsnoop, PacketLogger) + DLT-201 pcap writer
    sources.py   backends: Android live, file, tail; preflight checks
    dissect.py   tshark subprocess wrapper (streaming + batch)
    timeline.py  the phase state machine and the Web Bluetooth mapping table
    pbinfer.py   protobuf structure inference / classification
    render.py    aligned live output and static step rendering
    uuids.py     UUID → name, scoped to this project's devices
    markers.py   action markers, manifests, attribution
```

`blelab/timeline.py` holds the reproducible/implicit/unreachable mapping **in code**,
next to the phase definitions, so it cannot drift from prose in a document.

### Why one shared package rather than five self-contained scripts

The scripts are standalone to *run* — no shared state, no config file, no database,
nothing remembered between invocations. But they share a package because the
alternative is five copies of the PacketLogger parser, and the moment one copy fixes
a record-length bug the others silently disagree with it.

---

## Raw data policy

Captures are personal BLE traffic and can be large, so `captures/` is gitignored.
**Manifests are committed; pcaps are not.** A manifest records the hardware,
firmware, scenario, environment, and every action marker — enough to interpret an
analysis six months later, and enough to know exactly what to re-capture if the raw
file is gone.

---

## Scope

Interoperability work on hardware we own, observing local BLE traffic between our own
devices on our own machines — the same thing qdomyos-zwift and swiftcontrol do
openly. Nothing here touches Zwift's servers, accounts, or licensing, and nothing
here attacks or evades a protection mechanism: every backend is a *passive observer*
of a link we are one endpoint of.

Note the standing project decision that reverse-engineering Zwift's proprietary
**trainer-side hub protocol** is out of scope
([`GOALS.md`](../../docs/virtual-shifting/GOALS.md) non-goals). The Click *controller*
adapter is in scope and is what this toolkit serves; the `trainer-control` scenario
captures only the standard FTMS path, as a control experiment.
