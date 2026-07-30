# Zwift Click Connection Recipe — Web Bluetooth

> **What this is**: a step-by-step connection state machine for the Zwift Click, each
> step classified by whether Web Bluetooth can reproduce it, with the evidence behind
> it and the failure mode if you skip it.
>
> **Scope**: the Click *controller* only. Reverse-engineering Zwift's proprietary
> **trainer-side** hub protocol is out of scope by standing decision
> ([`GOALS.md`](GOALS.md) non-goals). The FTMS trainer path appears here only as the
> control experiment that validates the method.

---

## Replay verdict — stated plainly, up front

> ### ⚠️ **NOT YET RUN.**
>
> No plain webpage has yet been driven through this recipe end to end and observed to
> connect, handshake, and receive button notifications while surviving a reconnect.
>
> The falsification instrument exists and is verified against synthetic fixtures
> (`tools/ble-lab/replay.py --serve`, self-test now 98/98), but it has not been
> pointed at hardware.
>
> **A capture of the official app now exists** (2026-07-29, Android HCI snoop —
> [`experiments/15`](experiments/15-zwift-app-click-session.md)), and it settles the
> *discovery and subscription* half of this recipe while leaving the handshake open.
> What Zwift actually did: full discovery → read manufacturer/serial/hw/fw → **six CCCD
> subscriptions** (notify on `0002`, `0100`, `0101`, `0102`, `2A19`; **indicate** on
> `0004`) → read `0004`, which returned **zero bytes** → MTU exchange (517 asked, 251
> granted, *after* the subscriptions) → nothing further. **No write to any
> characteristic, no `RideOn`, no notifications.** So steps 1–7 of the table below are
> now corroborated by the official app, and the handshake steps still are not.
>
> Two concrete deltas for our recipe: Zwift **subscribes to `0100`/`0101`/`0102`**, which
> we have never done, and it takes `0004` by **indicate**, not notify.
>
> Steps 1–9 below are nonetheless **individually evidenced** — every one has been
> executed successfully against our own Click in a browser across
> [`experiments/01`](experiments/01-dual-connection-smoke-test.md),
> [`03`](experiments/03-click-buttons-partial.md), and
> [`04`](experiments/04-click-mapping-and-relay-confirmed.md). What has never been done
> is running them as one deliberate, ordered, automated sequence and measuring the
> result. Step 10 is new and untested.
>
> **The known-broken part**: connections established this way have dropped after
> ~45–90 s unless the Click was recently synced in Zwift Companion
> ([`03`](experiments/03-click-buttons-partial.md), H16). Step 10 is one candidate fix.
>
> ⚠️ **The drop's cause is still open, and cheaper tests come before the unlock work.** The
> same capture caught **Zwift Companion** losing a Click V2 link at **73.5 s** on HCI reason
> `0x08` (supervision timer expired) after 70 s of zero traffic. Companion is *not* the app
> BikeControl says performs the unlock, so that neither confirms nor refutes H16 — but it
> leaves an **idle timeout** (H28) equally consistent with every drop we have seen. Run
> [`experiments/15` §6.1](experiments/15-zwift-app-click-session.md)'s idle-vs-active A/B
> **before** the `ff 04 00` test: if traffic alone keeps the link up, a keepalive fixes this
> and no unlock is needed at all.

---

## The two questions this document is trying to answer

1. **Is there a keep-awake signal?** Does the official app periodically send something
   we do not?
2. **Is there an authcode?** Is there an authentication exchange around the handshake,
   and can a browser reproduce the client's half?

**Current best answers** (from
[`experiments/13-ff-family-frame-decode.md`](experiments/13-ff-family-frame-decode.md),
which decoded frames captured in `03`/`04`):

- **Keep-awake: no client→device keepalive is evidenced.** Three independent sources
  (`PROTOCOLS.md` §1.6, `RESEARCH.md`, and our own `01`, where a connection stayed
  healthy while our harness sent nothing) agree none is required. But a candidate
  **countdown** exists — a `0xFF05` frame field holding `496`, which would be 8 min
  16 s if seconds. Unresolved; two captures settle it.
- **Authcode: there is a challenge, we already receive it, and we probably do not need
  to answer it cryptographically.** The 85-byte frame that `04` dismissed as
  "cryptographically random" in fact decodes as structured protobuf behind a 3-byte
  `FF 03 00` header, carrying a **33-byte compressed P-256 public key** (prefix `0x03`,
  a valid SEC1 odd-Y point), a version-shaped `02 03 00 00`, and a 40-byte (32+8) blob.
  It arrived **unsolicited, on a plain Web Bluetooth connection**, after nothing but a
  bare `RideOn`.

  So the browser can *receive* the challenge. The open question is only what the app
  writes **back** — and `PROTOCOLS.md` §1.5 already documents the likely answer as
  **`FF 04 00`**, a 3-byte frame with an *empty* protobuf body. That is not a secret;
  it reads as *"proceed, I am already unlocked"*, with the unlock state persisted in
  the Click itself by the one-time Companion sync.

  **We have never sent it.** Step 10.

### Can we "use the authcode" from Web Bluetooth?

Almost certainly **not by replaying a captured response**, and almost certainly **not
needing to**:

- If the 33-byte field is an *ephemeral* key, a recorded reply authenticates nothing
  later. Testable: capture `FF03` twice and diff field 1. `diff.py` classifies a
  varying high-entropy field as nonce/key material automatically.
- If it is *static per device*, replay becomes viable — this is the mechanism
  BikeControl is described as using.
- But the empty-bodied `FF 04 00` suggests third-party clients never do the crypto at
  all. **Test that before assuming the hard problem exists.**

---

## The state machine, in one table

Direction is from our client's point of view. "Class" is Web Bluetooth
reproducibility: ✅ reproducible · 🔵 implicit (browser/OS does it) · ❌ unreachable.

| # | Phase | Dir | What happens | Class | Web Bluetooth call | Evidence | If skipped |
|---|---|---|---|---|---|---|---|
| 0 | wake | — | Press a Click button. A sleeping Click stops advertising after ~60 s unconnected. | ❌ | none — must be UX copy | `PROTOCOLS.md` §1.6; `01` step log | Device never appears in the chooser |
| 1 | advertising | RX | Local Name `Zwift Click`; mfr company ID `0x094A`; advertised service `0xFC82` (fw ≥ Jan-2025) or `…19ca…` | ❌ **content unreadable** | `requestDevice({filters:[{namePrefix:'Zwift Click'}]})` — name only | `PROTOCOLS.md` §1.1; `03` GATT dump showed `0000fc82-…` | Wrong filter ⇒ device not offered |
| 2 | connect | TX | LE connection established; interval/latency/timeout chosen by the OS | ✅ (partially) | `device.gatt.connect()` | `01` (both devices, ~76 s stable) | — |
| 3 | link setup | ↔ | LE feature exchange, data-length extension, connection-parameter update | 🔵 | none | `01` observed `gap_params_change(0): 72, 72, 0, 600` ⇒ 90 ms interval, 6 s supervision timeout | — |
| 4 | MTU | ↔ | ATT MTU exchange | 🔵 | none — **not readable** | inferred; never measured on our hardware | Writes > MTU−3 fail |
| 5 | pairing | ↔ | **Expected: none.** No SMP, no bonding, no encryption | 🔵 / ❌ if required | **none exists** | `01`/`03`/`04`: reached ZAP chars with no pairing prompt | If actually required ⇒ **Tier 2** |
| 6 | discovery | TX | Probe service `0xFC82`, fall back to `…19ca…`; get chars `…0002` / `…0003` / `…0004` | ✅ | `getPrimaryService()` → `getCharacteristic()` | `PROTOCOLS.md` §1.1–1.2; `03` | `SecurityError` if UUID not pre-declared |
| 7 | subscribe | TX | CCCD on **ASYNC `…0002`** (notify), **then SYNC TX `…0004`** (indicate) | ✅ | `characteristic.startNotifications()` | `PROTOCOLS.md` §1.2 | Handshake reply is an **indication** — subscribe after the write and it is lost |
| 8 | handshake | TX | Write exactly `52 69 64 65 4f 6e` ("RideOn", 6 B, no key) to **SYNC RX `…0003`** | ✅ | `writeValueWithoutResponse()` | `PROTOCOLS.md` §1.3; `03` | No plaintext mode ⇒ no ASYNC frames |
| 9 | handshake | RX | Indication on SYNC TX. **Our hardware echoes a BARE 6-byte `RideOn`** — no status bytes | ✅ | `characteristicvaluechanged` | `03` (contradicts community "+2 bytes") | **Do not validate the status bytes** |
| 10 | **unlock assert** | TX | **Write `ff 04 00` to SYNC RX** — 3 bytes, empty protobuf body | ✅ | `writeValueWithoutResponse()` | `PROTOCOLS.md` §1.5 (BikeControl); **UNTESTED by us** | **Hypothesised cause of the ~45–90 s drops** |
| 11 | steady | RX | ASYNC frames: `0x23` bitmaps, `0x15` idle ≈1 Hz, battery ≈5 s, `0xFF`-family status | ✅ | notification events | `01`, `03`, `04` | — |
| 12 | steady | TX | **Nothing required.** No client keepalive evidenced | ✅ (nothing to do) | — | `PROTOCOLS.md` §1.6; `01` | — |
| 13 | liveness | — | Watchdog: no ASYNC frame for > 5 s ⇒ suspect the link | ✅ | app-side timer | design §4.5 | Silent death goes unnoticed |
| 14 | teardown | ↔ | Disconnect. HCI reason code distinguishes clean / timeout / sleep | ✅ to *cause*, ❌ to *diagnose* | `gatt.disconnect()`; `gattserverdisconnected` | `01`; reason codes never seen from JS | One reconnect policy must serve all causes |
| 15 | reconnect | TX | In-session: retain the `BluetoothDevice`, retry `gatt.connect()` with backoff. Across reloads: chooser again | ✅ / ⚠️ | `device.gatt.connect()`; `getDevices()` is **flag-gated** | design §4.6; `PROTOCOLS.md` §4 | — |

**Ordering constraints that are real** (not stylistic):

1. **7 before 8.** The reply is an indication; subscribing afterwards loses it.
2. **8 before 10.** `FF 04 00` is documented as a *post-handshake* write.
3. **0 before 1.** A sleeping Click does not advertise.

Everything else is order-insensitive as far as current evidence shows.

---

## Classification summary

### ✅ Reproducible (11 of 16 steps)

Connect, service/characteristic discovery, CCCD subscription, the `RideOn` write, the
reply, the `FF 04 00` write, notification receipt, the liveness watchdog, causing a
disconnect, and in-session reconnect. **The entire application-level protocol is
reachable from a browser.**

### 🔵 Implicit — the browser does it, but we cannot see or steer it

- **Link setup** (step 3): feature exchange, data-length extension,
  connection-parameter update. `01` only learned the parameters because the *trainer*
  happened to log them as debug text on its own Zwift ASYNC characteristic (H14) — a
  fluke, not an API.
- **MTU** (step 4): negotiated automatically, **not readable**. Practical consequence:
  keep every write ≤ 20 bytes to be safe on a default 23-byte MTU. Every byte sequence
  in this recipe is ≤ 6 bytes, so this never binds.
- **Pairing** (step 5): only "implicit" in the sense that the OS *may* prompt if a
  characteristic demands authentication. Not scriptable, not controllable. Evidence
  says the Click needs none.

### ❌ Unreachable — Web Bluetooth cannot do this at all

| Thing | Consequence for us | Severity |
|---|---|---|
| **Advertisement content** — manufacturer data (company ID `0x094A`, device-type byte), advertising interval, raw AD structures | Cannot detect Click v1 vs v2 from the advertisement. **Workaround exists**: detect from the first ASYNC frame type (`0x37` ⇒ v1, `0x23` ⇒ v2). | Low — workaround is solid |
| **Waking the device** | Cannot; must be UX copy ("press a button, then Connect") | Low — cosmetic |
| **Pairing / bonding / link security** | If the Click ever required encryption we could not comply | **Fatal if it happens** — but no evidence it does |
| **MTU value** | Cannot verify a large write will fit | Nil at our payload sizes |
| **Connection interval / latency / supervision timeout** | Cannot tune responsiveness or power | Low — `01` measured 90 ms, fine for ~1 Hz traffic |
| **Disconnect reason code** | Cannot distinguish sleep / out-of-range / rejection | **Medium** — forces one reconnect policy for all causes, and makes diagnosing the H16 drops harder from inside the app |
| **Persistent device permission across reloads** (`getDevices()`) | A chooser click after every page load | Medium — UX friction, flag-gated in Chrome |
| **Two devices from one user gesture** | Two separate button clicks for trainer + Click | Low — already designed for |
| **Reading `2A25` Serial Number String** — CONFIRMED 2026-07-29 | It is on the [Web Bluetooth GATT blocklist](https://github.com/WebBluetoothCG/registries) as a device identifier, so Chrome refuses the read (`SecurityError`) **and hides the characteristic from `getCharacteristics()`** — the Device Information service looks like it contains only `2A26`/`2A27`/`2A29`, while the phone's capture shows `2A25` at handle `0x0014` holding `0A-34C45981D9A1`. **Consequence: a browser cannot tell which of two identically-named Click units it is connected to by this route.** Workarounds, both in `src/dev/ble-lab.html`: `device.id` (opaque, origin-scoped, stable per unit) and sniffing the serial out of `FF 05`/`3c` frames, which carry it over the air anyway (`experiments/16` §6b) | **Medium** — it is a real Tier-1 gap, but both workarounds are solid |

---

## Tier 1 (browser-only, GitHub Pages) vs Tier 2 (Expo native BLE)

**Current assessment: stay Tier 1.** Nothing on the Unreachable list blocks the
feature.

Read the list again by *what it costs*:

- Nothing unreachable sits on the **control path**. Every byte we need to send and
  every byte we need to receive is reproducible.
- The unreachable items are **diagnostics and ergonomics**: we cannot read the MTU we
  do not need, cannot see advertisement data we have a workaround for, cannot tune
  connection parameters that are already adequate, and cannot read a disconnect reason
  code — which costs us diagnostic precision, not capability.
- The one genuinely fatal item, **pairing**, is contradicted by three of our own
  experiments: we reach the ZAP characteristics from Chrome with no pairing prompt and
  no bond. A device requiring authentication for those characteristics could not
  behave that way.

**The single finding that would flip this to Tier 2**: a capture showing the official
app performing an SMP exchange, *or* writing a `0xFF`-family frame whose contents are
cryptographically derived from the `FF03` challenge with an ephemeral key. The first
is unreproducible outright. The second is unreproducible in practice — a browser cannot
bond, and while it *could* do P-256 via WebCrypto, it cannot obtain whatever
device-specific secret the derivation needs.

**What is not a Tier 2 argument**: the ~45–90 s drop. It is currently unexplained, and
the leading hypothesis (step 10, a 3-byte write we never send) is a *bug in our client*,
not a platform limit. Do not spend a native port on it before testing a 3-byte write.

The Companion-sync requirement is likewise not a Tier 2 argument — it is one-time
onboarding, already accepted as mandatory UX (`GOALS.md` non-goals,
`RISKS-ROADMAP.md` R2). Native BLE would not remove it either; the unlock appears to
live in the Click.

---

## Divergences between this recipe and our current code

From reading [`src/dev/ble-lab.html`](../../src/dev/ble-lab.html). These are
predictions to be confirmed by the `our-harness` capture, not observed facts:

| # | Current behaviour | Recipe says | Why it might matter |
|---|---|---|---|
| a | `dumpAndSubscribe()` subscribes to **every** notify/indicate characteristic found (`ble-lab.html:292-331`) | Subscribe to ASYNC and SYNC TX; battery optional | Extra traffic; may subscribe to Nordic DFU |
| b | Subscription **order** is whatever `getPrimaryServices()`/`getCharacteristics()` returns | ASYNC `…0002` **then** SYNC TX `…0004` | Ordering is load-bearing (step 7) |
| c | `RideOn` is a **separate manual button click** (`ble-lab.html:607-610`), seconds after subscribe | Immediately after subscribing | A post-subscribe window, if one exists, is missed |
| d | **No `0xFF`-family write is ever sent** | Step 10: `ff 04 00` | **Candidate cause of the drops** |
| e | No handshake-reply timeout; no 10 s ASYNC-arrival check | Steps 9, 13 | Silent failure indistinguishable from a slow device |
| f | `gattserverdisconnected` only logs; no reconnect (`ble-lab.html:485-493`) | Step 15: retry with backoff | Every drop ends the session |
| g | Nothing distinguishes which physical unit is connected (`device.name` is always `Zwift Click`) | — | Cost `03` most of a session; H17 makes it mostly moot |

Production code should also fix, in `src/js/ftms.js` (trainer side, already known):
the wind-speed unit (0.001 m/s, not 0.01 — noted fixed 2026-07-28) and the absent
Machine Status `0x2ADA` subscription, so `0xFF Control Permission Lost` stops being
ignored.

---

## The recipe as code

`tools/ble-lab/harness/index.html` implements exactly the table above, one harness step
per row, reporting PASS/FAIL each. Steps 4, 1, and 5 are coded to **fail deliberately**
so the Unreachable list is *generated by the harness rather than asserted in prose*.

```bash
tools/ble-lab/replay.py --serve --open --out captures/replay-01.json
```

Must be served, not opened from disk: Web Bluetooth needs a secure context and
`file://` pages have no `navigator.bluetooth`.

### The one experiment to run first — now the idle-vs-active A/B, not `ff 04 00`

Both are free browser tests, but the idle-vs-active arm discriminates *between two
mechanisms* whereas `ff 04 00` only tests one candidate fix for one of them. Run
[`experiments/15` §6.1](experiments/15-zwift-app-click-session.md) first: right-side Click
alone, two 180 s arms — idle vs. a paddle press every 30 s, both with no recent Zwift
contact. If B holds and A drops, the answer is a keepalive and the rest of this section is
moot. Log the unit's **address**, since `15` §5 showed our harness and the phone have been
using two different physical Clicks.

Then, if still needed: step 10 is a 3-byte write, and testing it needs no capture, no
PacketLogger, no Android device, and no subscription:

1. Wake the Click; run the recipe with the **`ff 04 00`** checkbox **checked** and the
   watch window at 180 s. Record the survival time.
2. Repeat with the checkbox **unchecked** — the control condition.
3. Compare.

**If survival improves**, the "authcode problem" was a missing 3-byte write, and most
of the capture plan becomes optional. **If it does not**, there really is a
challenge–response to reproduce, the capture is required, and
[`experiments/12`](experiments/12-connection-capture-preregistration.md) has the plan.

Run both conditions with and without a recent Companion sync and you also finally close
base validation **BV2** (`experiments/00-test-matrix.md` §6), which has been waiting for
a controlled before/after since 2026-07-28, and answer `RISKS-ROADMAP.md` R2's "how
long does the unlock actually last?".

---

## Status ledger

| Claim | Status |
|---|---|
| Steps 1–9 each work individually from a browser | **CONFIRMED** — `01`, `03`, `04` |
| Steps 1–9 work as one automated ordered sequence | **UNTESTED** |
| Subscribe must precede the handshake write | **CONFIRMED by protocol** (indication), community-documented; not yet seen in an app capture |
| Our hardware echoes a bare `RideOn`, no status bytes | **CONFIRMED** — `03` |
| No SMP pairing is required for the ZAP characteristics | **CONFIRMED** by absence across `01`/`03`/`04`; not yet corroborated by an app capture |
| No client→device keepalive is required | **INFERRED** — three sources agree; `01`'s window was only 76 s |
| `FF03` is a structured key-agreement/challenge frame | **CONFIRMED as structure**, INFERRED as purpose — `13` |
| `FF 04 00` fixes the drop cadence | **UNTESTED** — the hypothesis to falsify |
| Companion sync is required once before third-party clients work | **CONFIRMED by user report**; single-trial as evidence (BV2 open) |
| Web Bluetooth cannot pair, read MTU, or see advertisements | **CONFIRMED** — spec/implementation status, `PROTOCOLS.md` §4 |
| Tier 1 (browser-only) is sufficient | **INFERRED**, on the reasoning above. Flips only on SMP or an ephemeral-key challenge appearing in a capture |
| **A plain webpage connected, handshook, received buttons, survived reconnect** | ⚠️ **NOT YET RUN** |
