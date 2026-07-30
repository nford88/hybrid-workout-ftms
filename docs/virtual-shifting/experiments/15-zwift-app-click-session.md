# 15 — Zwift **Companion**'s Click V2 session, captured: the attribute table, what Companion wrote, and a 73.5 s drop

**Date**: 2026-07-29
**Type**: Offline analysis of a real Android HCI snoop capture (Zwift **Companion** ↔ Click V2),
cross-correlated with the phone's own logcat, plus the four toolkit defects the capture exposed.

> ## ⚠️ CORRECTION, same day — read this before the rest
>
> The first version of this document said the peer was **"the official Zwift app"** and built
> its central argument on that. **It was Zwift Companion** (`com.zwift.android.prod`; the game
> app is `com.zwift.zwiftgame` and is *not installed* on this phone). The user caught it.
>
> That matters because [`14`](14-clickv2-unlock-current-state.md) records BikeControl's
> instruction as *"Open Zwift (**not** the Companion)"* for the unlock. So the client here was
> **not** the authorised one, and the 73.5 s drop is **no longer evidence against H16**. The
> §3 reframe has been rewritten accordingly: this capture **does not discriminate** H16
> (authorisation timeout) from H28 (idle timeout).
>
> A second over-claim is also corrected in §3: HCI reason `0x08` was reported here as
> *"the Click stopped responding"* with CONFIRMED confidence. `0x08` means the link lapsed;
> on its own it does not name the side at fault. A phone-side radio stall would produce the
> same code. What rules that out is a **control in the same capture** — see §3.2 — not the
> reason code by itself.
>
> Everything in §1, §2, §4 and §5 is unaffected: the attribute table, what was written, the
> unit identification and the toolkit defects were all read off raw PDUs and stand as
> recorded.

**Evidence**: `captures/20260729-1448-zwift-app-click-session.btsnoop`
(+ `.manifest.json`) — pulled with `adb bugreport` from the phone at 14:48, snoop mode
`FULL`. 7,209 frames / 1,174.7 s total; the Click link occupies 1035.8–1109.5 s.

**Reproduce the analysis**:

```bash
cd tools/ble-lab && ./analyze.py \
    --file ../../captures/20260729-1448-zwift-app-click-session.btsnoop \
    --device f4:c4:59:81:d9:a1
```

---

## What this was supposed to answer

`12`'s pre-registration and the session handoff asked three questions of the first capture
containing a real Click session:

| | Question | Answer |
|---|---|---|
| (a) | Any write to `0100`/`0101`/`0102` — the unlock, and the authcode question | **No.** Companion enabled notifications on all three but wrote no payload to any of them |
| (b) | The `RideOn` exchange on `0003`/`0004` | **No.** `0003` was never written; `0004` was *read* and returned **zero bytes**. Not one notification or indication arrived on the Click link |
| (c) | Does the connection survive past 90 s? | **No — 73.5 s**, on `HCI reason 0x08` (supervision timer expired). Which side went silent first is not settled by that code; see §3 |

So the handshake is still uncaptured — and the reason is now clear: the peer was
**Companion with no game session behind it**, which is exactly the configuration that would
not need to unlock anything. §6.0 fixes that by using Companion in **bridge** mode, with the
real game on a laptop, which keeps the BLE on the phone where we can capture it.

---

## 1. The Click's real attribute table

From Companion's own discovery, decoded from raw ATT PDUs (not from tshark's labels — see §4).
Zwift service is the **16-bit `0xFC82`** primary service spanning handles `0x0019–0x002d`;
its characteristics are the `000000NN-19ca-4651-86e5-fa29dcdd09d1` family.

| Decl | Value | CCCD | Properties | UUID | Companion subscribed? |
|---|---|---|---|---|---|
| 0x001a | 0x001b | 0x001c | Notify | `00000002-19ca-…` (ZAP ASYNC) | ✅ notify |
| 0x001d | 0x001e | — | WriteNoRsp | `00000003-19ca-…` (ZAP SYNC RX) | n/a (write-only) |
| 0x001f | 0x0020 | 0x0021 | Read + Indicate | `00000004-19ca-…` (ZAP SYNC TX) | ✅ **indicate** (`02 00`) |
| 0x0022 | 0x0023 | 0x0024 | WriteNoRsp + Write + Notify | `00000100-19ca-…` | ✅ notify |
| 0x0026 | 0x0027 | 0x0028 | WriteNoRsp + Write + Notify | `00000101-19ca-…` | ✅ notify |
| 0x002a | 0x002b | 0x002c | WriteNoRsp + Notify | `00000102-19ca-…` | ✅ notify |
| 0x002f | 0x0030 | 0x0031 | Read + Notify | `2A19` Battery Level | ✅ notify, read `0x64` = 100% |

`0x0024`/`0x0028`/`0x002c` also each carry a `2901` User Description descriptor
(`0x0025`/`0x0029`/`0x002d`) that Companion discovered but never read — reading those three
strings is free from Web Bluetooth and may well name the characteristics outright.
**Cheapest single lead in this document.**

Device Information (`0x180a`, handles `0x0010–0x0018`), all read by Companion:

| Handle | Characteristic | Value |
|---|---|---|
| 0x0012 | `2A29` Manufacturer Name | `Zwift Inc` |
| 0x0014 | `2A25` Serial Number | `0A-34C45981D9A1` |
| 0x0016 | `2A27` Hardware Revision | `B.0` |
| 0x0018 | `2A26` Firmware Revision | `1.2.0` |

Plus GAP `0x0001–0x000b` (`2A00`, `2A01`, `2A04`, `2AA6`, `2AC9`) and GATT `0x000c–0x000f`
(`2A05` Service Changed, Indicate).

ATT MTU: Companion asked **517**, the Click answered **251**. No SMP, no bonding, no encryption
anywhere on this link — consistent with the `btsmp: 0` count across the whole capture.

### Two corrections to previously recorded findings

- **"Three separate `2A19` Battery Level characteristics"** (recorded in the session
  handoff): **wrong — there is exactly one.** That claim came from tshark's cross-connection
  UUID leakage (§4): the KICKR is in the same capture, and tshark attributed some of its
  attributes to the Click.
- **`2A5D` (Sensor Location) on the Click**: also **not present**. Same cause — tshark
  labelled Click handle `0x0026` "Sensor Location" while the raw declaration says
  `00000101-19ca-…`.

---

## 2. What Companion actually did, in order

```
+0.0 – 2.0 s   full discovery: services, characteristics, descriptors
+2.1 – 2.3 s   read manufacturer / serial / hw rev / fw rev
+2.5 s         CCCD notify on ZAP 0002
+2.5 s         READ ZAP 0004  ->  zero-length response
+2.6 s         CCCD indicate on ZAP 0004
+2.6 – 2.8 s   CCCD notify on 0100, 0101, 0102
+2.8 s         read battery (0x64), CCCD notify on 2A19
+2.9 s         ATT MTU exchange (517 asked / 251 granted)
+3.0 – 3.2 s   re-read hw rev, fw rev, battery
   ...         70 seconds of complete silence, both directions
+73.5 s        Disconnection Complete, reason 0x08 (supervision timer expired)
```

Two details worth keeping:

- **The MTU exchange came *after* the subscriptions**, not before. Ordering we would not
  have guessed, and not something Web Bluetooth lets us control anyway (the browser does
  MTU implicitly) — noted so a future diff does not flag it as a divergence.
- **`0004` read back empty.** A readable-but-empty SYNC TX characteristic means "no reply
  pending", which is consistent with the handshake being a write-then-indicate exchange
  rather than a read.

### This is a partial session, and that is the main caveat

Companion subscribed and then did nothing at all. No unlock write, no `RideOn`, no button
notifications — meaning **no paddle was pressed during the window**, and pairing was almost
certainly never confirmed in the app's UI — and, critically, **no Zwift game session was
running anywhere**, so there was nothing for Companion to bridge. The honest reading is
*"Companion connected the Click on its pairing screen and the phone was left alone"*, not
*"Zwift never sends an unlock"*. Question (a) is **not** settled by this capture — §6.0 is
the design that should settle it.

---

## 3. The 73.5 s drop — what it does and does not show

### 3.1 The full timeline, from the phone's own logs

The bugreport carries logcat as well as the snoop log, so the BLE trace can be correlated
with what the phone was doing. **The btsnoop timestamps are exactly +1 h from the phone's
wall clock** (Android wrote local time; tshark reads it as UTC and re-localises), verified by
matching `BLUETOOTH_DEVICE_EVENT 1` to the connection-complete frame. Real times below.

| Wall clock | Event | Source |
|---|---|---|
| 14:46:00 | screen already off / dozing | `DisplayPowerController` |
| 14:46:08.1 | **power button** → screen ON | `PowerManagerService: wakeUp … (power_button)` |
| 14:46:37 | **KICKR** connects, handle `0x0002` | HCI conn complete |
| 14:46:39.9 | **Click** connects, handle `0x0003` | HCI + `BLUETOOTH_DEVICE_EVENT 1` |
| 14:46:42.9 | Click ATT traffic **ends** (discovery + 6 subscriptions done) | ATT |
| 14:46:43 | KICKR ATT traffic ends | ATT |
| 14:47:05.9 | **screen OFF** — 30 s inactivity timeout | `Going to sleep due to timeout (screenOffTimeout=30000)` |
| 14:47:53.4 | **Click link drops, reason `0x08`** | HCI + `BLUETOOTH_DEVICE_EVENT 2` |
| 14:47:53 → 14:48:34 | **12 failed reconnect attempts**, all `status 0x02 Unknown Connection Identifier` | HCI LE Enhanced Conn Complete |
| 14:48:58 | capture ends — **KICKR link still up** | HCI (no disconnect for `0x0002`) |

Link lifetime **73.5 s**; 70.5 s of that was silent. The 12 failed retries immediately after
are consistent with the Click having stopped advertising — i.e. it went to sleep, matching
the documented *"powers off ~1 min when unconnected"*.

### 3.2 Android doze is largely exonerated — by a control in the same capture

The screen went off 47.5 s before the drop, so "the phone locked and killed the link" is a
live hypothesis. The same capture contains its control:

> **The KICKR's link was also idle, on the same phone, through the same screen-off — and it
> survived.** Up at 14:46:37, last traffic 14:46:43, and there is **no Disconnection Complete
> for handle `0x0002` anywhere in the capture**: still up at 14:48:58, i.e. **2 min 15 s
> idle** and counting. Meanwhile the stack logged 550 HCI frames after screen-off and was
> actively attempting connections. The radio was awake and maintaining idle links.

So doze did not indiscriminately kill idle BLE links here. **The drop is Click-specific.**
That said, it is not fully excluded either: Android could plausibly treat a *foreground-app's*
GATT client differently from the trainer's, and `0x08` on its own names no culprit — it means
the supervision timer expired, which a stall on either side produces. Removing the confound
outright is one `settings put system screen_off_timeout` away (§6.1), so there is no reason to
keep arguing about it.

### 3.3 Why this does NOT discriminate H16 from H28

The client was **Companion**, and [`14`](14-clickv2-unlock-current-state.md) records
BikeControl's instruction as *"Open Zwift (**not** the Companion)"* for the unlock. So this
was **not** an authorised session, and both hypotheses predict exactly what we saw:

| Hypothesis | Prediction for *this* session | Consistent? |
|---|---|---|
| H16 — authorisation timeout, Companion is not the unlocking app | drops in the ~60 s band | ✅ |
| H28 — plain idle timeout, no ZAP traffic for 70 s | drops in the ~60 s band | ✅ |

**Corrected claim**: the first version of this document argued that "the drop happened to
Zwift itself, so authorisation cannot be the cause". That argument is void — the peer was
Companion, not the game. H16 stands undamaged, and H28 remains an untested competing
explanation rather than a favoured one.

### 3.4 One thing this capture *does* contribute to the question

**Companion wrote nothing to the Click on this connection** — discovery, six CCCD
subscriptions, four reads, and not one payload write (§2). If Companion never writes to the
Click, Companion cannot be performing a BLE unlock handshake, which makes `03`'s
"synced in Companion → then it held 5+ minutes" hard to explain *as a BLE unlock delivered by
Companion*. Either the unlock is delivered by the game (as BikeControl says), or `03`'s
5-minute hold had another cause — and the obvious candidate is the paddle presses in that
window, which is H28.

Stated carefully, because this is one observation of one reconnect: **Companion wrote nothing
on a re-connect with no game session running.** It may well write during first-time pairing,
or when bridging to a live game — which is exactly what §6 now goes after.

---

## 4. Four toolkit defects this capture exposed (all fixed)

Every one of these silently *degraded a report* rather than failing loudly, which is the
dangerous kind. The first analysis run of this capture rendered every operation as
`len 0` with an empty payload column, showed no `subscribe` phase, and reported no teardown
at all.

**(1) `btatt.value` is empty whenever tshark recognises the attribute type.**
tshark exports a recognised attribute's payload under a *type-specific* field name —
`btatt.battery_level`, `btatt.firmware_revision_string`,
`btatt.characteristic_configuration_client` — and never in `btatt.value`. Our fixed field
list therefore lost the bytes for most reads, writes and notifications. The manufacturer
string `Zwift Inc`, the firmware `1.2.0`, the battery `0x64` and all six CCCD values were
all present in the capture and all missing from the report.
*Fix*: new `blelab/attpdu.py` decodes the ATT PDU from tshark's raw `btatt_raw` bytes.

**(2) tshark's handle→UUID bindings are global, so they leak between connections.**
With the KICKR and the Click in one capture, Click frames were labelled with the KICKR's
`a026e002`, and the response to a read of handle `0x0012` was reported as handle `0x0016`.
This is the source of both corrections in §1.
*Fix*: `attpdu.AttributeTable` learns handle→UUID **per connection** from that connection's
own declarations, and overrides tshark. Where discovery was not captured it reports nothing
rather than guessing.

**(3) `--device` silently dropped frames.** The address filter returned 100 ATT frames where
the ACL-handle filter returned 102 — tshark cannot bind an address to every ACL frame. One
of the two lost frames was the Device Information declaration response, so the attribute
table came out missing four handles.
*Fix*: `--device` now resolves to its ACL handle(s) via the connection-complete event and
filters on the handle, falling back to the address filter with a warning.

**(4) `--device` hid the entire connection lifecycle.** HCI events carry no ACL address, so
an address filter excludes every Connection/Disconnection Complete. The report had no
teardown phase and could not state how long the link lasted or why it ended — *the central
question of this whole thread*. The 73.5 s finding was invisible in the first run.
*Fix*: new `blelab/links.py` + report section 2 "Link sessions", always computed
**unfiltered**, naming the HCI reason code and attributing the teardown to peer / us /
link loss.

Consequence of (1) worth noting on its own: because CCCD write values came back empty, the
phase classifier could not recognise them as subscriptions and filed all six as `steady`.
The report claimed a steady-state phase 2.5 s into a connection that never reached steady
state.

### This overturns a decision recorded in `11`

`11` recorded: *"tshark does all HCI/ATT dissection; we never hand-roll it — tshark tracks
ATT handle→UUID bindings across a capture, which a hand-rolled parser would get wrong."*

The premise is backwards for our actual captures. Tracking bindings *across a capture* is
precisely what breaks when the capture holds two devices. Revised division of labour:

> tshark does HCI/L2CAP framing, reassembly and layer identification — all the stateful,
> format-specific work. We decode the **ATT PDU**, which is self-describing (Core v5.x
> Vol 3 Part F §3.4), needs no cross-frame state, and therefore cannot inherit that error.

Verification: `cd tools/ble-lab && python3 selftest.py` → **98/98** (was 70/70; 28 new
checks, every ATT fixture a verbatim PDU from this capture). Project suite unaffected:
179 tests, typecheck clean.

---

## 5. Which physical Click is which — resolved as a side effect

The serial read here is `0A-34C45981D9A1`, on the device advertising
`f4:c4:59:81:d9:a1`. Those differ only in the first byte: `34` vs `F4`. `0xF4 = 0x34 | 0xC0`
— the two high bits a BLE **static random address** must have set. So the serial's tail is
the device's real address with those bits cleared, and the mapping is mechanical:

| Serial tail | Advertised address | Seen by |
|---|---|---|
| `34C45981D9A1` | `f4:c4:59:81:d9:a1` | **the phone** (this capture) |
| `34C4593D51A6` | `f4:c4:59:3d:51:a6` | **macOS / our harness** (`13`'s `FF05` frames) |

`13` decoded the ASCII serial `34C4593D51A6` out of the `FF05` frames captured in `03`/`04`.
That is the **other physical unit**. So our Web Bluetooth harness has been talking to a
different Click than the phone has — which answers `04`'s outstanding follow-up, and means
any comparison between our harness's behaviour and this capture is **also** a
between-units comparison until we pin the address on both sides.

It also explains one difference that would otherwise look important: no unsolicited
`0xFF`-family frame appeared on Zwift's Click link here, whereas `03`/`04` received them
unsolicited on a plain Web Bluetooth connection. Different unit, possibly different state —
not yet a finding either way.

---

## 6. Follow-ups

### 6.0 The capture that actually gets the unlock: Companion as a **bridge** ⭐

This came from the user and it supersedes the earlier "install Zwift on the phone" idea.

**Zwift Companion has a documented bridge mode**: you pair the trainer, controllers and HR
*to Companion* on the phone, and the Zwift **game** — running on a laptop or Apple TV on the
same Wi-Fi — uses them as if they were its own. It exists because Apple TV has only ~2 usable
BLE channels ([Zwift support](https://support.zwift.com/using-the-zwift-companion-app-as-a-bridge-ByAnUzlLj),
[Zwift Insider](https://zwiftinsider.com/apple-tv-connection-limit/)), and controller
bridging is explicitly supported.

Why this is the right capture, and better than putting the game on the phone:

1. **In bridge mode the phone is the BLE central for the Click.** Every ZAP byte — unlock
   included, whoever originates it — must cross the air at the phone, which is the one place
   we have a *proven* capture route (`adb bugreport` → btsnoop).
2. **It gives us a real, authorised game session** — the condition BikeControl says the unlock
   requires — without needing Zwift installed on the phone at all.
3. **No new capture backend, no nRF dongle, no login-walled macOS download.** The blocked
   Phase-2 backend problem from `11` disappears.
4. As a bonus it captures the **trainer** side of a real Zwift session at the same time, which
   is the `trainer-control` control experiment `12` wants to run first, for free.

**⚠️ The failure mode that would waste the whole session**: the phone→game link is over
**Wi-Fi, not Bluetooth** — there is no Bluetooth pairing between phone and Mac. And if the Mac
connects the trainer/Clicks over *its own* Bluetooth, the BLE never crosses the phone and the
capture is empty. So the devices must be paired **in Companion**, and in Zwift's pairing screen
you must select the entries that come via Companion, not direct-BLE ones. `--watch` below
confirms the phone actually holds each link before you commit to a ride.

**Runbook** (each step exists because something already bit us):

```bash
cd tools/ble-lab

# 0. Phone readiness. --check enforces both settings, incl. the 30 s screen timeout that
#    ended the 2026-07-29 session early (§3.1).
./android-capture.py --check
adb shell settings get system screen_off_timeout           # record it, to restore afterwards
adb shell settings put system screen_off_timeout 1800000   # 30 min

# 1. Watch the phone while you pair, so you can see the links land on the PHONE.
./android-capture.py --watch --expect f4:c4:59:81:d9:a1 --expect ff:a1:82:dd:f0:79
```

2. Wake the Clicks with a paddle press (asleep they do not advertise).
3. In **Companion** on the phone, pair the **trainer and the Click(s)**. Watch them appear in
   the `--watch` output. If one never appears, the Mac took it — unpair it there first.
4. Start the Zwift **game on the Mac**, same Wi-Fi. In its pairing screen choose the
   **bridged** entries (they show a phone/trainer icon). Pair trainer + Click and **enter a
   ride** — the unlock, if it is a thing, happens for a real session, not a pairing screen.
5. **Spin the wheel** and **press the paddles several times**; confirm power and gear changes
   register in-game. The paddle presses are also the H28 active arm.
6. Stay in the ride **past 3 minutes** — long enough to pass the 44–90 s band twice.
7. **Immediately** pull it — the snoop buffer is a rolling ~7 minutes, so anything older is
   gone:

```bash
./android-capture.py --pull --scenario bridge-ride --device f4:c4:59:81:d9:a1
adb shell settings put system screen_off_timeout <the value from step 0>
```

That one command checks the phone, takes the bugreport, extracts the snoop log, turns the
phone's own logcat into action markers (connect/disconnect per device, screen on/off),
measures and corrects the btsnoop clock skew, writes capture + manifest into `captures/`,
prints every link's lifetime and teardown reason, and emits the full analysis report.

**Read first in the report**: §2 Link sessions (did anything drop, and who hung up), then
§5's step list for writes to `0100`/`0101`/`0102` and `0003`.

Then analyse — `android-capture.py` does the pull, the logcat correlation and the report in
one command (see `tools/ble-lab/README.md`):

```bash
tools/ble-lab/android-capture.py --pull --scenario bridge-ride --device f4:c4:59:81:d9:a1
```

**Predictions, registered now** (per `12`'s convention — write them before looking):

| # | Prediction | Falsified if |
|---|---|---|
| P1 | A **write to `0100` and/or `0101`** appears, which we have never seen | no payload write to any ZAP characteristic, as in this capture |
| P2 | A `RideOn` write to `0003` and an **indication back on `0004`** (which read empty here) | `0003` stays unwritten |
| P3 | **Button notifications on `0002`** carrying `0x23` frames, matching `04`'s mapping | frames arrive on a different characteristic or in a different grammar |
| P4 | The link **survives past 90 s** with the game session live | it drops in the 44–90 s band anyway — which would point at H28 and away from H16 |
| P5 | `0102` stays silent (no traffic either way) | it carries something — a genuinely new finding, since no source documents it |

P4 is the one that discriminates H16 from H28 *in the authorised condition*, and §6.1
discriminates it in the unauthorised one. Together they settle the mechanism.

#### The second tap: the LAN leg, captured on the Mac

Bridge mode splits the path in two, and each half needs a different tap:

```
Click / trainer  ──BLE──▶  phone (Companion)  ──Wi-Fi──▶  Mac (Zwift game)  ──TLS──▶  Zwift
                 ▲                            ▲                            ▲
        btsnoop on the phone          tshark on the Mac              not observable
```

The Wi-Fi leg is worth capturing **concurrently**, and it costs one command. Capture on the
**Mac**, not the router: the Mac is one endpoint, so its own interface sees the whole
conversation. (Router/monitor-mode Wi-Fi sniffing would need the WPA2 PSK plus the 4-way
handshake plus channel locking — all unnecessary here. It would only be required if the game
ran on an Apple TV instead.)

```bash
# Use the BUILT-IN tcpdump, and an ABSOLUTE output path. phone = 192.168.1.1.
sudo tcpdump -i en0 -s 0 -w /Users/nford/Playground/ftms/captures/zwift-bridge.pcap \
     host 192.168.1.1
```

Three traps, all hit on the first attempt:

- **Relative output paths.** `-w captures/...` resolves against the shell's cwd, and the
  runbook above leaves you in `tools/ble-lab`, where no `captures/` exists — tshark reports
  `could not be opened: No such file or directory`. Use an absolute path.
- **Homebrew tshark spews `dyld: Library not loaded: @rpath/libwsutil.16.dylib`** for every
  extcap binary (`sshdump`, `androiddump`, `wifidump`, …) whenever it enumerates interfaces.
  It is the known broken-`@rpath` bug and completely harmless — but it buries the real error.
  `tcpdump` is built into macOS, has no extcap directory, and avoids it entirely. If you do
  want tshark, silence it with `sudo DYLD_LIBRARY_PATH=/opt/homebrew/lib tshark …` (the
  toolkit's own CLIs set this internally, which is why they are quiet).
- **`sudo` is required**: `/dev/bpf*` is root-only here and this user is not in `access_bpf`
  (Wireshark's ChmodBPF helper is not installed).

`host 192.168.1.1` alone is sufficient, and simpler than filtering on both endpoints: a
non-promiscuous capture on `en0` only ever sees traffic involving this Mac, plus broadcast and
multicast — so this yields exactly phone↔Mac plus the phone's discovery broadcasts, and nothing
else on the LAN.

**What this leg can and cannot answer:**

- ✅ **Is the bridge actually carrying the devices?** If sensor data flows phone→Mac, the
  bridge is definitively live — a stronger check than `--watch`'s heuristic.
- ✅ **The game→Companion direction, which is the prize.** If the game obtains the Click's
  authcode from Zwift's servers and hands it to Companion to write over BLE, that handoff
  crosses *this* link. If it is not encrypted, the authcode is visible here — the exact thing
  `14` concluded we could not reproduce. **UNKNOWN whether this leg is plaintext**; the capture
  is how we find out.
- ✅ **Correlation.** LAN timestamps against BLE timestamps turn "Companion wrote these bytes"
  into "the game asked for X, then Companion wrote Y" — far stronger than either alone.
- ❌ **Not the ZAP bytes.** Those are on the air between phone and Click; that is what the
  btsnoop capture is for. The two taps are complementary, not alternatives.
- ❌ **Nothing the Mac fetched from Zwift's servers** — TLS.

**Ordering after the ride**: pull the bugreport **first**. The snoop buffer is a rolling ~7
minutes; the pcap on disk has no expiry.

**Assumption to check at the bench** (not verified from sources): that Companion bridges
**Click v2** specifically, and that it must stay foregrounded. Zwift Insider notes Companion
bridging "doesn't stay connected" for some users, so if the bridge itself is flaky, fall back
to §6.1 — it needs none of this.

*Aside, for the record*: a **KICKR CORE 2** on fw 2.5.4/3.5.4 (Jan 2026) can bridge Click v2
**through the trainer** ([Zwift Insider](https://zwiftinsider.com/kickr-core-2-254/)). Our
unit reports `KICKR CORE C26B` fw **1.5.36**, which does not match that firmware line, so it
is probably not a CORE 2 — `U11` (Core V2 vs CORE 2) is still open. Trainer-side bridging
would also be *worse* for capture, since the BLE would move inside the trainer where we cannot
see it.

### 6.1 The H28 discriminator (no capture, no phone, ~10 minutes)

Connect the **right-side** Click alone from `src/dev/ble-lab.html` and run two arms of
180 s, both with no recent Zwift contact:

- **arm A (idle)**: subscribe, then touch nothing.
- **arm B (active)**: subscribe, then press a paddle every 30 s.

| Result | Reading |
|---|---|
| A drops ~45–90 s, B holds | **H28 confirmed** — idle timeout. Fix is a keepalive or a periodic read; the unlock question becomes optional |
| Both drop | Authorisation timeout survives (H16), and it is time-based regardless of traffic |
| Neither drops | The right unit needs no unlock at all, as BikeControl's UI claims (`14`) — and this whole thread is moot for the right unit |

Log which physical unit by address (§5), and log time since the last Zwift session — the
earlier `FF 04 00` design did not control for it.

### 6.2 Read the three `2901` User Descriptions

`0x0025`, `0x0029`, `0x002d` describe `0100`, `0101`, `0102`. Free from Web Bluetooth, and
they may name the unlock characteristics outright. Nothing anywhere in our sources or
BikeControl's has these strings.

### 6.3 Subscribe to `0100`/`0101`/`0102` in our harness

Zwift subscribes to all three; we have never touched them (they were not even in
`blelab/uuids.py` until this session). Notifications may arrive unprompted, exactly as the
`0xFF` frames did. Concrete change to `connect()`, no protocol knowledge required.

### 6.4 If a capture is still wanted, mark it

Re-run with `capture.py` driving so the packets are attributed, and **complete the pairing
in the Zwift UI** — the whole gap in this capture is that nobody confirmed the device. Then
(a) and (b) get real answers.

---

## Confidence

| Claim | Confidence |
|---|---|
| The attribute table in §1, incl. `0100`/`0101`/`0102` and their properties | **CONFIRMED** — raw ATT declarations, packet numbers in the report |
| **Companion** subscribed to 6 CCCDs and wrote no payload on this connection | **CONFIRMED** — every write in the link is a CCCD write |
| Link lasted 73.5 s and ended when the supervision timer expired (`0x08`) | **CONFIRMED** — HCI Disconnection Complete, packet 6809, corroborated by the phone's own `BLUETOOTH_DEVICE_EVENT 2` at 14:47:53.450 |
| *Which side* went silent first | **NOT ESTABLISHED by the reason code.** `0x08` names no culprit. The Click is the better bet because the KICKR's idle link survived the same window (§3.2) and 12 reconnects then failed with `0x02` — but a foreground-app-specific doze effect is not excluded |
| The two corrections in §1 (one `2A19`, no `2A5D`) | **CONFIRMED** — raw declarations vs tshark's labels |
| Serial↔address mapping identifying the two units (§5) | **INFERRED, strong** — the `0xC0` static-random-address rule accounts for the single-byte difference exactly, on both units |
| Android doze/screen-lock caused the drop | **UNLIKELY** — the KICKR's idle link survived the same screen-off for 2 min 15 s, and the stack stayed busy (§3.2). Eliminated outright by raising the screen timeout next run |
| H28 (idle timeout) vs H16 (authorisation timeout) | **UNDISCRIMINATED.** Both predict this session's outcome, because the client was Companion — not the authorised game (§3.3). The original claim that this capture favoured H28 was **wrong and is retracted** |
| "Zwift never writes an unlock" | **NOT ESTABLISHED.** No game session was running, and the peer was Companion |
