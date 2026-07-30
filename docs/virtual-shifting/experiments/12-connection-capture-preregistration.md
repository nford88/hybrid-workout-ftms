# 12 — Phase 2 Capture Scenarios: Pre-Registration

**Date**: 2026-07-29
**Type**: Pre-registration. **No scenario here has been run.** Predictions are recorded
*before* any data exists so they can be scored honestly afterwards.

**Status**: BLOCKED on the blockers in
[`11-capture-backend-selection.md`](11-capture-backend-selection.md) — a backend
install and someone physically at the bike.

Each scenario below is also encoded in `tools/ble-lab/capture.py`, which prints the
prediction on screen before the first prompt. That duplication is deliberate: a
prediction you read at the bike, before acting, is the only kind that can still be
falsified.

```bash
tools/ble-lab/capture.py --list
tools/ble-lab/capture.py --scenario trainer-control --backend android
```

---

## What this session is actually trying to find out

The user's own statement of the goal, 2026-07-29 — three steps:

> 1. Sniff the connection between the BLE controllers and the Zwift app while they are
>    connected, and view the connection **when the buttons are pressed**.
> 2. Then connect the controllers directly to a Web BLE Chrome page and inspect the
>    same connection processes.
> 3. **Compare the packets and interactions.**

And the specific thing being looked for:

> …to inspect the handshake protocol to see if there are **keep-awake signals** or an
> **authcode** involved in the handshake. We can then compare this to the Web BLE
> handshake and see where it looks different / if we can use the authcode for the Web
> BLE process.

Mapped onto this document: step 1 is scenarios `warm-reconnect` + `buttons`, step 2 is
`our-harness`, step 3 is `diff.py app.pklg ours.pklg`. So the three-way structure is
one pipeline, and every scenario is scored against two questions — anything answering
neither is lower priority than the scenario list order suggests:

- **Q-KEEP** — does the official app send anything *periodically* to the Click that we
  do not? If yes, what bytes and at what interval?
- **Q-AUTH** — is there an authentication exchange in or around the handshake, and if
  so is the client's half reproducible from a browser?

[`13-ff-family-frame-decode.md`](13-ff-family-frame-decode.md) already advances both
from bytes we captured last session, and produces a browser-only test that should be
run **before** any of this. If that test passes, most of Phase 2 becomes optional.

---

## Execution order, and why it is not the mission's order

| Run | Scenario | Serves | Why here |
|---|---|---|---|
| 0 | *(the `ff 04 00` browser test from `13`)* | Q-AUTH, Q-KEEP | No install, no capture, minutes. May answer the session's question outright. |
| 1 | `trainer-control` | method validation | **The control.** Our FTMS connection demonstrably works, so any divergence the method reports here is a false positive *in the method*. Validate the instrument on a known-good case before trusting it on the Click. |
| 2 | `warm-reconnect` | Q-KEEP, Q-AUTH | The sequence our app actually needs. Highest information per run. |
| 3 | `steady-state` | **Q-KEEP** | The dedicated keep-awake experiment. |
| 4 | `handshake` | **Q-AUTH** | Byte-exact handshake + the ordering constraint. |
| 5 | `our-harness` | both | ★ The centrepiece diff. Needs 2 or 4 to diff against. |
| 6 | `cold-connect` | Q-AUTH | Most likely to contain something unreproducible — but costs a forget/re-pair, so not first. |
| 7 | `teardown` | Q-KEEP | Quantifies what we give up by not seeing disconnect reason codes. |
| 8 | `buttons` | confirmation | Mostly already answered by `04`. |
| 9 | `advertisement-baseline` | reference only | Last: Web Bluetooth can never see advertisements, so nothing here changes our code. Free from nRF Connect for Mobile. |

Running `trainer-control` first is the single most important ordering choice. Without
it, a divergence found in `our-harness` is ambiguous between "our Click code is wrong"
and "the tool lies."

---

## The constraint the comparison imposes: pick a host that can capture *both* sides

Step 3 (diff the app against our page) only works if both captures exist. `diff.py`
will align captures from different hosts, but a shared clock and a single backend make
the comparison far cleaner — and halve the setup. So the real decision is **which host
can run the Zwift app and Chrome's Web Bluetooth**:

| Setup | App side | Our side | Backend | Extra installs | Notes |
|---|---|---|---|---|---|
| **All-Android** | Zwift Companion (or the Android app) | **Android Chrome** — Web Bluetooth works there | one btsnoop log | **none** beyond a Developer-options toggle | Cheapest complete path. Incidentally closes **HW-V11** (Android parity), untested since it was written |
| **All-macOS** | Zwift for Mac | Desktop Chrome | one PacketLogger capture | PacketLogger (Apple ID) **+** Zwift for Mac (multi-GB) | Best fidelity; the environment we actually develop in |
| **Split** | phone | Mac | two different backends | both of the above | Most work, no shared clock. Avoid unless forced |

**All-Android is the recommendation**, and it is a genuinely useful consequence of the
user's framing: because the comparison needs *both* endpoints on one capture host, and
because Android Chrome speaks Web Bluetooth, a single phone with one Developer-options
toggle covers the entire three-step goal with **zero downloads and no subscription**
(Companion is free, and `03` already proves it connects and unlocks our Clicks).

The one cost: our production harness is a desktop page, so an all-Android run tests
Android Chrome's Web Bluetooth rather than macOS Chrome's. That is a *feature* here —
it is HW-V11 — but a divergence found on Android should be re-checked on desktop before
being blamed on our code.

---

## Predictions

### 1. `trainer-control` — the control experiment

**Predict**: connect → MTU → discovery → CCCD on Indoor Bike Data `0x2AD2`, FTMS
Control Point `0x2AD9`, **and Machine Status `0x2ADA`** → CP writes `0x00` Request
Control, `0x07` Start, then repeated `0x11` at roughly 1 Hz.

**The one divergence I expect to be real**: `ARCHITECTURE-CURRENT-STATE.md` and the
design doc record that our `ftms.js` **does not subscribe to Machine Status
(`0x2ADA`)** and therefore ignores `0xFF Control Permission Lost`. If the app
subscribes and we do not, that is a genuine gap surfaced by the control run — which
would be a pleasant surprise, since the run's purpose was only to validate the method.

**Would falsify the method**: divergences in areas we know are already correct (e.g.
the tool claiming we never send Request Control, which we demonstrably do).

**Scope note**: capture only the standard FTMS path. Zwift's proprietary trainer-side
hub protocol is out of scope by standing decision (`GOALS.md` non-goals); the trainer's
Zwift service will emit unsolicited debug text regardless (H14 / test-matrix item 29)
and must not be mistaken for protocol traffic.

---

### 2. `warm-reconnect` — the sequence our app actually needs

**Predict**: strictly shorter than a cold connect. No SMP. Possibly no full service
discovery if the OS cached the attribute table. **CCCD writes and the SYNC RX
handshake must both still appear** — those are app-level and cannot be cached.

**Q-AUTH**: if a `0xFF`-family client→device write appears here, in a *warm* connect,
it is part of the routine per-connection sequence rather than one-time bonding. That
would be the strongest possible result: it means we can send it too.

**Would surprise me**: any SMP pairing traffic. Our Web Bluetooth client reaches these
characteristics with no pairing prompt (`01`, `03`, `04`), which is hard to reconcile
with the app needing authentication for the same characteristics.

---

### 3. `steady-state` — the keep-awake experiment

**Predict**: **nothing client→device is required.** `PROTOCOLS.md` §1.6 and
`RESEARCH.md` both say no keepalive is needed; `01` observed a healthy connection with
our harness sending nothing at all. Device→client, expect `0x15` idle frames at ~1 Hz
and battery notifications about every 5 s (matching `01`).

**The result that would change everything**: any *periodic* client→device write. That
would directly explain the ~45–90 s drops (H16) as our app failing to send a keepalive,
rather than a vendor lock at all — a much better problem to have, since a timer is
trivial to add.

**Watch specifically for**: a `0xFF05`-family frame recurring, so its field 3 (496 in
`03`) can be diffed across observations. Falling ⇒ countdown, and its rate gives the
units. This is the cleanest available handle on the lock timer.

**Duration matters**: 5 minutes minimum. The whole question lives at the 60–90 s mark
and a 76-second window (all `01` managed) cannot see it.

---

### 4. `handshake` — byte-exact, and the ordering constraint

**Predict**: subscribe **first**, then write. Forced by the protocol, not just
convention: the reply arrives as an *indication* on SYNC TX `0004`, so a client that
writes before subscribing loses it. `PROTOCOLS.md` §1.2 agrees.

**Predict**: the write is exactly `52 69 64 65 4f 6e`, 6 bytes, no key appended.

**Open conflict this arbitrates**: community sources say the device replies `RideOn` +
2 status bytes (`02 03` for v2). Our own `03` observed a **bare** 6-byte echo. Per the
mission's standing rule, *our capture overrides community docs on conflict* — so if the
app also sees a bare echo, `PROTOCOLS.md` §1.3 should be corrected, and either way our
client must not validate those bytes.

**Q-AUTH is decided here**: whatever the app writes to SYNC RX between subscribing and
steady state *is* the handshake. If that is only `RideOn`, there is no authcode in the
handshake and the lock must live elsewhere.

---

### 5. `our-harness` — ★ the centrepiece

Predicted divergences, named in advance so the diff is a test and not a fishing trip.
All four come from reading `src/dev/ble-lab.html`, not from a capture:

| # | Predicted divergence | Evidence | If confirmed |
|---|---|---|---|
| (a) | We subscribe to **every** notify/indicate characteristic, including battery and possibly Nordic DFU. The app almost certainly subscribes selectively. | `dumpAndSubscribe()`, `ble-lab.html:292-331` | Harmless but noisy. Cheap to fix. |
| (b) | Our subscription **order** is whatever `getPrimaryServices()`/`getCharacteristics()` returns — not deliberately ASYNC-then-SYNC-TX. | same function; order is never asserted | Ordering is a real constraint here. Make it explicit. |
| (c) | Our `RideOn` is a **separate manual button click**, so the subscribe→handshake gap is seconds, not milliseconds. | `click-rideon` handler, `ble-lab.html:607-610` | If the device has a post-subscribe window, we miss it. Automate the write into connect. |
| (d) | **We never write any `0xFF`-family frame.** | only `RideOn` and the haptic frame are ever sent | **This is the candidate cause of the drops.** See `13`. |

(d) is the one that matters. (a)–(c) are tidiness.

**Method check built in**: because the predictions are written down, the diff either
finds these and I learn the tool works, or finds something else entirely and I learn
more. The failure mode to guard against is a diff that reports *only* trivia — which
would suggest the filter is hiding the interesting traffic.

---

### 6. `cold-connect` — most likely to contain something unreproducible

**Predict**: no SMP pairing at all, for the reason in scenario 2. If SMP **does**
appear, browser-only is dead for the Click and this is the Tier 2 (Expo native BLE)
trigger — the single highest-stakes prediction in this document.

**Predict**: any one-time exchange (a vendor unlock write, a bonding step) appears
*here* and not in `warm-reconnect`. Diffing 6 against 2 is what separates one-time
bonding from the per-connection handshake, which is why both exist.

**Cost**: requires forgetting the Click in the official app, which throws away the
Companion-sync unlock state that currently makes our harness usable. **Do not run this
until the browser-only tests in `13` are done** — it may cost a re-sync to recover.

---

### 7. `teardown`

**Predict**: clean disconnect ⇒ HCI reason `0x13`/`0x16`; out-of-range ⇒ `0x08`
connection timeout after the 6 s supervision timeout `01` observed
(`gap_params_change(0): 72, 72, 0, 600`); sleep ⇒ looks like the remote terminating.

**Predict**: **Web Bluetooth exposes none of these.** `gattserverdisconnected` carries
no reason code. So our app cannot distinguish "device slept" from "walked out of
range" from "peer rejected us" — which means one reconnect policy has to serve all
three. Quantifying that is this scenario's whole value.

---

### 8. `buttons`

**Predict**: notifications on ASYNC `0002` carrying type-`0x23` bitmap frames; Right
"+" clears `0x20`, Left "−" clears `0x100` (`04`, confirmed 4× and 1×). Confirmation
only — a full decode belongs to the button-mapping work, already done in `04`.

---

### 9. `advertisement-baseline`

**Predict**: Local Name exactly `Zwift Click`; manufacturer company ID `0x094A`;
advertised service `0xFC82` rather than the 128-bit `…19ca…` (fw 1.2 is post-Jan-2025,
and `03`'s GATT dump already showed the device under `0000fc82-…`); advertising stops
roughly 60 s after the last button press.

**Explicitly low value**: Web Bluetooth cannot read advertisement content at all
(`PROTOCOLS.md` §1.1, §4), so none of this can change our code. The only actionable
output is which filter keys exist — `namePrefix` works, manufacturer data does not.
Get it free from nRF Connect for Mobile rather than buying a sniffer.

---

## Scoring these afterwards

For each scenario, write its own `NN-<slug>.md` record **before** running the next one,
using the established template (Date / Hardware & firmware / Hypothesis / Setup / Exact
steps / Raw captured data / Observations / Conclusion / Confidence / Follow-ups), and
add a one-line outcome to [`README.md`](README.md).

`analyze.py --report` generates a first draft with the state-machine table, the
unreachable list, findings, and marker attribution already filled in — but the
**prediction-vs-outcome scoring is manual and is the part that matters.** State plainly
where a prediction above was wrong; a pre-registration that only ever gets confirmed is
a pre-registration nobody is reading honestly.

Per `00-test-matrix.md` §6: connection timing and environment are exactly the class of
thing where **a single trial is a base validation, not a settled fact.** Anything about
drop cadence or unlock lifetime needs a controlled repeat before it goes in as
CONFIRMED.
