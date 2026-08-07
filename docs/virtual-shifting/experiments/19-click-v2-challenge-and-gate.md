# 19 — The FF 03 challenge, the FF 04 answer, and what actually closes the keypad gate

**Date**: 2026-08-07
**Type**: Offline re-analysis of raw bytes in three captures we already hold, plus a
current-source review. **No new hardware run.** Everything below is re-derived from the
`.btsnoop` files with `tshark`, not from the generated `.report.md` files — because §1 shows
one of those reports is truncated and the truncation has already been written into a commit
message and into the investigation brief.

**Reproduce** (needs `/opt/homebrew/bin` on `PATH`; `tshark` is not on the default one):

```bash
export PATH=/opt/homebrew/bin:$PATH DYLD_LIBRARY_PATH=/opt/homebrew/lib
cd captures
tshark -r 20260807-112224-click-drop-with-trainer.btsnoop -n -Y btatt \
  -T fields -e frame.time_relative -e bthci_acl.chandle -e btatt.value | tr -d ':'
```

---

## 0. Summary

| Question from the brief | Answer |
|---|---|
| Is there an unlock/authorisation message the official software writes that we do not? | **Yes — and we now have its bytes.** An `FF 04` write to SYNC RX `00000003`, sent ~0.45 s after each inbound `FF 03` challenge on ASYNC `00000002`. Seen twice: once with an **empty** body (`ff 04 00`) and once with a **21-byte** body. |
| Is it replayable? | **No for the 21-byte form.** The challenge carries a fresh ephemeral P-256 point every connection, and BikeControl — the only live third-party implementation — does not compute the answer either; it proxies the real Zwift app. The **empty** form is trivially replayable and has never been tested as a reply. |
| Is there a periodic keep-alive? | **No.** In 786 s of working Click link the client wrote 9 times, 7 of them in the first 6 s. The only ongoing obligation is answering challenges. |
| Is `FF05` field 3 a countdown? | **No. Falsified.** It *rose* 15 → 900 across the failure. Experiment 13's "496 ≈ 8 min 16 s" reading is dead. |
| Can the browser do it? | **Not the real unlock.** Two browser-viable workarounds exist and are pre-registered as arms B and C below. |

---

## 0.5 ⚡ PHASE 1 RESULT (bench, 2026-08-07 12:35–13:08 UTC) — arm B falsified, arm D passes

Four runs, all in the **lapsed** state (last Zwift contact 2026-07-29, nine days). Evidence:
`captures/localhost-dump_all_arms.log` (console dump, both page sessions) and
`captures/ble-lab-log-all_arms.json` (export, **second page session only** — see the warning at
the end of this section).

Units identified from the frames, not from memory: the **LEFT** unit self-identifies by the
ASCII serial `34C4593D51A6` in its own `FF 05` frames; the **RIGHT** unit emits no `FF 05` at
all, so it is identified by exclusion plus its `0x1000` ("+") paddle bit.

| Run | Unit | Answered? | Challenges | Cues hit | Gate |
|---|---|---|---|---|---|
| 1 (arm A) | **LEFT** `34C4593D51A6` | no | 2 | 6/24 | **CLOSED at +60.8 s** |
| 2 (arm B btn) | **RIGHT** | n/a — none arrived | **0** | **30/30** | **open, 300 s** |
| 3 (arm B) | **LEFT** `34C4593D51A6` | **yes ×2** | 2 | 6/30 | **CLOSED at +60.4 s** |
| 4 (arm D btn) | **RIGHT** | n/a — none arrived | **0** | **24/24** | **open, 240 s** |

All times are **relative to the handshake**, which is the only comparable clock — see the
measurement defect at the end.

### ★ Arm B is FALSIFIED, and the device did not merely reject our answer — it ignored it

The left unit's two runs are a within-session paired control differing in exactly one thing:
whether we replied `ff 04 00` to each challenge.

| | Arm A — no answer | Arm B — answered ×2 |
|---|---|---|
| challenge 1 | +5.4 s, body **85** | +4.5 s, body **85** |
| challenge 2 | +21.8 s, body **103** | +20.0 s, body **103** |
| retry interval | **16.4 s** | **15.5 s** |
| gate closed | **+60.8 s** | **+60.4 s** |
| cues hit before closure | **6** | **6** |

**Answering changed nothing measurable**: 0.4 s on the closure, 0.9 s on the retry, identical
body lengths, identical hit count. And the retry interval is the tell that §7 arm B
pre-registered — *"note the re-challenge's field-3 length; 40 → 58 was the unanswered pattern"*:

| Client behaviour | Next challenge after |
|---|---|
| Zwift, answer **accepted** (07-29, `FF 04` + 21-byte body) | **265.8 s** |
| our client, **no answer** (08-07 capture, and arm A) | 15.5 s / **16.4 s** |
| our client, **answered `ff 04 00`** (arm B) | **15.5 s** |

Our reply lands in the *unanswered* column. The empty `ff 04 00` is not a weak answer, it is a
**non-answer** — exactly what BikeControl's `if (isPersistedUnlocked)` guard implies: an
assertion that is only valid once already unlocked. **H33 is FALSIFIED for the empty form.**

That leaves only the 21-byte body, which §3 and §6 argue we cannot compute.

### ★★ Arm D PASSES — the right unit is never challenged at all

Two runs, **9 minutes**, **54/54 cues hit, zero misses, zero `FF 03` challenges, gate never
closed.** Its frame profile is categorically different from the left's:

| Frame | LEFT (`34C4593D51A6`) | RIGHT |
|---|---|---|
| `23 08 …` keypad | 64 | **360 / 288** |
| `19 10 …` + `2A19` battery | 62 + 68 | **0** |
| `2a …` initial status | 1 | **0** |
| `FF 05` status/serial | 3 | **0** |
| `FF 03` challenge | **2** | **0** |

The right unit streams keypad frames and nothing else. **No challenge is ever issued to it, so
there is nothing to answer and nothing to expire.** This is §7.-0.5's option 1, and it needs no
unlock, no reset cycle and no 24 h window.

⚠️ **Not yet a product answer.** The rider pressed only "+" (`0x1000` = `SHIFT_UP`), so we have
**one** control. `clickButtons.ts` puts `A` `0x10`, `B` `0x20`, `Y` `0x40`, `Z` `0x80` on the
right unit too, but none has been observed firing from it. **The gating test is now: connect the
right unit alone and press every button on it.** If a second bit fires, shift-down maps onto it
and the Click V2 lock stops mattering for this project entirely.

### H30 has the two units the wrong way round

`H30` records `3d:51:a6` as the **primary** that "holds a browser link 20+ minutes and streams
buttons", and `81:d9:a1` as the **secondary** that "publishes nothing at all" and dies on a hard
~61 s timer. Today the serial-confirmed `3d:51:a6` is the one that **gates at ~60.5 s**, and the
other unit is the one that runs indefinitely.

The reconciliation, **INFERRED**: `H30`'s 20-minute run was 2026-07-29 — *inside* the
authorisation window, where the left unit works fine. Nine days later it does not. So `H30`
measured a real asymmetry but attributed it to relay role rather than to which unit carries the
authorisation. Note also that `experiments/16`'s "silent unit" figure of **60.5–61.2 s** is the
same number we now measure for the LEFT unit's gate (**60.4 / 60.8 s**) — worth chasing, but
they are different observables (a link drop there, a live-link gate here), so this is a lead and
not a finding.

### ⚠️ Measurement defects this run exposed (both fixed)

1. **`uptimeAtGateCloseS` was measured from *connect*, not from the handshake.** The operator
   pressed "Run arm" between 8.5 s and 64 s after connecting, so the same 60 s failure was
   reported as 124.8 s in one run and 95.5 s in another. The runner now records
   `gateCloseSinceHandshakeS` and the verdict line prefers it. **Without this the two left-unit
   runs look 30 s apart instead of 0.4 s apart, and the headline comparison above is invisible.**
2. **The `FF 03 CHALLENGE received` log line always read `answered: false`**, because it is
   emitted before the reply is sent; only the arm-result array was correct. Now says
   `pending — see the ANSWERED line below`.

### ⚠️ And a process defect: the JSON export covered only half the session

`ble-lab-log-all_arms.json` starts at 12:48:57Z and contains **three** runs. The console dump
starts at 12:35:31Z and contains **four** — the page was reloaded between run 1 and run 2, which
resets `logEntries`. Reading the export alone, arm A appears never to have run and the operator's
account of four runs looks mistaken. **It was not: every unit label the rider gave was correct.**

Two consequences: the "do not reload" instruction in §7.0 is now load-bearing rather than a
convenience, and **an export must be checked for completeness before its absences are treated as
evidence** — this document's §1 is the same failure mode on a different file.

---

## 0.6 ⚡ The right unit's full button map — the lock is now avoidable

**2026-08-07 13:34, right unit alone.** Evidence: `captures/right-unit-button-map.json`.
134 entries, **111 `23` frames and nothing else** — no battery, no `FF 05`, no `FF 03`, no serial.

| Bit | Control | Presses |
|---|---|---|
| `0x0010` | A | 3 |
| `0x0020` | B | 3 |
| `0x0040` | Y | 3 |
| `0x0080` | **Z** | 3 |
| `0x1000` | **"+" paddle** → `shiftUp` ×3 | 3 |

**Five controls on a unit that is never challenged and never gated.** This is the first hardware
confirmation of `clickButtons.ts`'s `CLICK_UNIT` right-side map (A/B/Y/Z/SHIFT_UP) — every entry
correct, none missing, nothing unexpected.

**Two shift directions are therefore available from one unconditioned unit**: `0x1000` for
shift-up, and any of A/B/Y/Z for shift-down. No unlock, no `FF 04`, no reset cycle, no 24 h
window, no Zwift.

### The relay is one-directional — H17 needs qualifying

> **With only the right unit connected, the LEFT unit's presses do NOT arrive.** Operator
> observation, corroborated by the log: only the five right-unit bits ever fired.

`H17`/`04` established a relay from the *other* unit onto the **primary's** connection, and
`experiments/16` §7.1 flagged the untested half. It is now tested in this direction and the
answer is no: the relay flows **toward the left unit**, not away from it. So "connect the right
unit" costs the D-pad and the "−" paddle entirely — they are unreachable without also connecting
the left, which is the unit that gates.

### ⚠️ The instrument mislabelled this run, and it has been fixed

`0x80` was reported as `*** UNKNOWN BIT — new finding ***`. It is not new: `clickButtons.ts` has
had it as `Z` since commit `7b0a754`. `ble-lab.html`'s hint table was the **community** table,
which our own docs already record as wrong about our hardware in at least three places — it also
labelled `0x20` as *"our RIGHT +"* and `0x1000` as *"ONOFF_L"*, both contradicting
`clickButtons.ts`. The table now carries our confirmed names with the community names in
brackets, so `UNKNOWN BIT` once again means unknown.

### What this changes

`§7.-0.5` ranked the product options; option 1 has now landed. The remaining work is a mapping
decision, not a protocol one:

| | Reachable | Gates? |
|---|---|---|
| **Right unit alone** | A, B, Y, Z, "+" paddle | **never** |
| **Left unit alone** | D-pad ×4, "−" paddle, ✅ *plus the right's presses via the relay* | **yes, ~60.5 s after handshake when lapsed** |
| **Both, two links** | everything | left half only |

> ### ✅ The "left alone relays the right" row is now MEASURED (2026-08-07, live SIM workout)
>
> It was the one row resting on `experiments/04` plus the rider's recollection rather than a log.
> A real SIM workout inside the authorisation window drove **both** shift directions repeatedly
> across most of the gear range, on a **single** Click link — `clickBle.ts:87` performs one
> `requestDevice` and holds one `device`, so two Clicks is not possible, and
> `clickButtons.ts:23-24` puts `SHIFT_DOWN 0x100` on the **left** paddle and `SHIFT_UP 0x1000` on
> the **right**. Both fired, so the right unit's presses crossed onto the left unit's connection.
> It cannot have been the right unit connected: arm D above shows the right alone receives only
> its own five bits, so `0x100` would never have appeared.
>
> **So one link is enough for both gears today.** The catch is the one this document exists for:
> that link is the unit that gates, and since both directions ride it, a closure removes **both**
> at once. Hence "shifting stopped", never "half of shifting stopped".

Connecting **both** as separate links is what Zwift itself does (`experiments/16` §3) and would
degrade gracefully — shifting survives on the right link even after the left one gates, costing
only the D-pad. That is a strictly better end state than either unit alone, and it needs no new
protocol knowledge.

**Not yet done**: `clickBle.ts` connects exactly one Click and hard-maps `SHIFT_DOWN` to `0x100`,
which lives on the left unit. Whichever option is chosen, that mapping has to become
configurable, and the choice of which right-unit button carries shift-down is an ergonomic one
for the rider rather than a technical one.

---

## 1. ⚠️ First: a truncated report has been propagating as fact

`captures/20260807-112224-click-drop-with-trainer.report.md` §5 ends at **+57.627 s** with a
battery frame, and commit `0bf477c` and the investigation brief both state that this is *"the
last packet in the capture"*. **It is not.** `analyze.py`'s step list is capped; the raw file
continues.

The Click link (ACL `0x0003`) carries **21 more frames** after the last keypad frame, at
~5.6 s intervals, ending at report-relative **+158.876 s**:

```
+52.591  19 10 5a          battery
+52.603  ff 05 00 ea 05 …  state frame (see §4)
+57.627  19 10 5a          ← where the report stops
+63.028  19 10 5a
   … 18 more, every ~5.6 s …
+158.876 19 10 5a          ← the real last frame on this link
```

So the gap between the last keypad frame and the end of the Click's traffic is **106.4 s**,
not 6 s. **This makes the gating finding stronger, not weaker**, and it is the one correction
in this document that changes a published number. Two derived claims should be re-read with
this in mind, and §5 §7 of that report should be regenerated with `--no-collapse`.

---

## 2. ★ The keypad stream is PRESS-gated with a ~1.0 s hold-off — and this invalidates a whole class of reasoning

This is the single most important methodological finding here, because it means **"the keypad
frames stopped" is the normal end of every burst and proves nothing on its own.**

Measured over every `23`-frame burst in two captures. Within a burst the device streams at
~11 Hz (0.09 s spacing). Every burst ends a fixed interval after the last *non-idle* bitmap:

| Capture | Bursts | Tail after last press — min / max |
|---|---|---|
| `20260729-164954` (working) | 20 | **0.90 s / 1.23 s** |
| `20260807-112224` (failing) | 9 | **0.98 s / 1.05 s** |

Twenty-nine bursts, two hosts, two clients, zero exceptions. The device streams the full
bitmap at ~11 Hz while a button is down and for ~1.0 s after release, then goes silent.

The consequence is uncomfortable. In the **working** session the keypad stream has silences of
**105.3 s, 108.1 s, 128.0 s and 136.5 s** — all perfectly healthy, all just the rider not
touching the paddles. The failing session's 106.4 s of silence is *within that normal range*.

> **Frame absence is not evidence of gating. The only evidence is "a press produced nothing",
> and that rests entirely on the rider's report** — because the capture manifest's operator
> notes were never filled in (`"trainer first at HH:MM:SS, click at HH:MM:SS, last press at
> HH:MM:SS"` is the literal recorded value). Nobody wrote down when the paddles were pressed.

This is fixable for free and §7 fixes it: **the runner cues each press and scores it**. A cued
press every 10 s timestamps the stimulus as well as the response, so a miss is a measurement
rather than a recollection.

It also means the last burst of the failing session — `217.72 → 221.81`, ending 1.05 s after
the press at 220.75 — **is not a cut-off mid-stream.** It is an ordinary burst ending
ordinarily. Whatever closed the gate did so *between* bursts.

---

## 3. ★★ The outbound `0xFF` write exists, and we have its bytes

The brief asks whether the official client writes any `0xFF` frame. It does. Every prior
session recorded only inbound `0xFF` frames; the working capture has been in the repo since
2026-07-29 with two outbound ones in it.

Both are on the LEFT / primary unit `f4:c4:59:3d:51:a6` (serial `34C4593D51A6`, ACL `0x000a`)
in `captures/20260729-164954-bridge-ride.btsnoop`, written to **SYNC RX `00000003`** as a
Write Command, in direct reply to an inbound `FF 03` on **ASYNC `00000002`**:

```
+7557.042  RX  0002   ff 03 00 0a 21 03 ce78f431… 10 80808c10 1a 28 <40 bytes>
+7557.479  TX  0003   ff 04 00                                    ← Δ 0.437 s, EMPTY body

+7822.813  RX  0002   ff 03 00 0a 21 02 13ecb9be… 10 80808c10 1a 2b <43 bytes>
+7823.317  TX  0003   ff 04 00 0a 15 a5 6d ef 98 b0 95 57 7f 39 a5 3c
                      1f 0e 0e 39 64 2f 6e 29 15 d9                ← Δ 0.504 s, 21-byte body
```

The 21-byte reply decodes as `hdr=ff0400` + protobuf `1:len[21]=a56def98b095577f39a53c1f0e0e39642f6e2915d9`.
**It has never been recorded anywhere in this knowledge base or in any public source.**

Structure of the challenge, constant across every `FF 03` ever observed (6 frames, 2 units,
3 hosts):

| Field | Value | Note |
|---|---|---|
| 1 | 33 bytes, prefix `0x02` or `0x03` | SEC1 **compressed** P-256 point. Fresh every connection (exp 16 confirmed ephemerality) |
| 2 | `0x02030000` | **invariant** — a version tuple, matching the `RideOn 02 03` suffix |
| 3 | 40 / 43 / 58 bytes | varies; 40 on every *first* challenge, longer on re-challenges |

### The failing session never answered, and the timing is suggestive

```
abs 169.34   link up, discovery
abs 176.12   FF 03 #1  (field 3 = 40 bytes)          — no reply
abs 191.60   FF 03 #2  (field 3 = 58 bytes)          — no reply,  Δ 15.48 s after #1
abs 221.81   last keypad frame                        — 45.7 s after #1, 30.2 s after #2
abs 221.94   FF 05 state frame, field 2 flips 0 → 1   — 0.136 s later
abs 328.22   last battery frame; ACL still up
```

Compare the answered case: challenge #1 answered → next challenge **265.8 s** later. Unanswered
→ re-challenge in **15.5 s**, with a *longer* field 3, then nothing.

**INFERRED, and this is the lead**: the device challenges, tolerates a non-answer for ~30–45 s
across one retry, then closes the keypad gate. **CONFIRMED** is only the byte sequence and the
timings above.

### Nine bursts survived challenge #1, six survived challenge #2

Worth stating plainly because it constrains the mechanism: keypad bursts continued at 179.7,
181.9, 191.2, 199.7, 205.6, 209.0, 214.5 and 217.7 — i.e. **the gate did not close when the
challenge went unanswered; it closed on a delay.** Any explanation that predicts an immediate
cut-off is wrong.

---

## 4. The countdown question, answered: there is no countdown

`FF 05` is two different messages sharing a subtype, distinguished by the first protobuf tag.
BikeControl's `constants.dart:41-43` names both — `RESPONSE_STOPPED_CLICK_V2_VARIANT_1` =
`ff 05 00 ea 05`, `VARIANT_2` = `ff 05 00 fa 05` — though our captures show both also arriving
at connect time, so "stopped" is that project's label, not a proven meaning.

**`fa 05` (field 95) — battery telemetry for the relay pair:**

| Capture | f4 | f5 | f6 | f7 | reading |
|---|---|---|---|---|---|
| 20260729 working | 100 | 100 | 2934 | 2910 | both units present, % and mV |
| 20260807 failing | 90 | **255** | 2863 | **0** | **partner unit absent/unknown** |

**`ea 05` (field 93) — state. This is the one experiment 13 called a countdown:**

| When | f2 | f3 | f4 | f5 | f6 |
|---|---|---|---|---|---|
| exp 13, 2026-07-28 (macOS, held 5+ min) | 0 | **496** | 1 | 4 | 0 |
| 20260729 working, +7554.7 | 0 | **248** | 2 | 4 | 0 |
| 20260807 failing, +173.8 (before) | 0 | **15** | 8 | 9 | 19 |
| 20260807 failing, +221.9 (after) | **1** | **900** | 8 | 9 | 19 |

> **Field 3 is not a countdown. FALSIFIED.** Across the one boundary that matters it **rose**,
> 15 → 900, in 48 s. Across sessions it takes 496 / 248 / 15 / 900 with no monotone trend and no
> relation to elapsed time. Experiment 13's *"496 s = 8 min 16 s, plausibly a session countdown"*
> and its stated decisive test (*"if the value falls between observations, it is a timer"*) are
> both answered: it does not fall, so it is not a timer.

What *does* look like a marker is **field 2, which flipped 0 → 1 and arrived 0.136 s after the
last keypad frame**. Fields 4/5/6 are session-constant (8/9/19 for the whole failing run, 2/4/0
and 1/4/0 for the working ones), so f2 and f3 are the varying state and f4–f6 are properties of
the session. **n = 1. Do not build on it until §7 arm A reproduces it.**

---

## 5. There is no keep-alive

Every client→device write on the working Click link, all 786 s of it:

```
+7552.20  52 69 64 65 4f 6e 02 03   RideOn 02 03   (sent twice)
+7552.38  00 08 00                  HubRequest DataId 0
+7552.39  41 08 05                  the "mystery" command (exp 16 §4)
+7552.62  00 08 10                  HubRequest DataId 0x10
+7552.87  00 08 80 08               HubRequest DataId 0x408
+7553.11  00 08 83 06               HubRequest DataId 0x303
+7557.48  ff 04 00                  ← challenge answer
+7823.32  ff 04 00 0a 15 …          ← challenge answer
```

Nine writes; seven inside the first second of the handshake. **No periodic write of any kind.**
This is a fourth independent corroboration of `PROTOCOLS.md` §1.6, and it settles the brief's
question 2: the client owes the device nothing on a timer.

---

## 6. What the current external sources say, and where they agree with our bytes

Full source report and quotes: research pass of 2026-08-07 against `OpenBikeControl/bikecontrol`
@ `c7efca5` (v6.3.0, 2026-07-21) and `cagnulein/qdomyos-zwift` @ `d06b630`.

| Claim | Source | Do our bytes agree? |
|---|---|---|
| `_clickV2UnlockCharacteristics` = `…0100`/`…0101`, **write-only, never answered** | `zwift_profiles.dart:191`, and the repo's own design doc: *"writes accepted, never answered"* | ✅ consistent — exp 16 P1 found zero payload writes to them in an authorised session |
| The unlock is a **live negotiation**, not a token: `BleSecureConnectionStatus{NONE, INPROGRESS, ACTIVE, REJECTED}`, `BleSecureConnectionWindowStatus{CLOSED, OPEN}`, `PAGE_BLE_SECURITY = 64` | `prop_public/lib/protocol/zp.pbenum.dart` | ✅ consistent with a 33-byte ephemeral P-256 point per connection |
| BikeControl **does not compute the answer** — it proxies the real Zwift app over the LAN, and caches the inbound `FF 03` to *"replay it **to Zwift**"* | `zwift_clickv2.dart:34-36,152-164`; `unlock.dart:90-97` | ✅ explains why the 21-byte reply is uncomputable for us |
| `FF 04 00` is sent **only** `if (isPersistedUnlocked \|\| hasScript)` — an assertion, not an unlock | `zwift_clickv2.dart:114-120` | ✅ matches exp 13's reading and the empty first reply |
| The shipping default workaround is **`Opcode.RESET` = 24 = `0x18`, every ~60 s**, rebooting the left unit | `zp.pbenum.dart:28`; `connection.dart:655`; `intl_en.arb` *"Restart device every minute"* | untested by us — **arm C** |
| It is the **left** unit that locks; the right needs no unlock | `intl_en.arb` `unlock_rightSideNeedsNoUnlock`; qdomyos-zwift#4456 (`bug`+`wontfix`) | ⚠️ **conflicts with our H30** — see below |
| Unlock lasts ~24 h and needs the **Zwift game, not Companion**, connected 10–30 s | `TROUBLESHOOTING.md`; BikeControl blog | ✅ and it reconciles our ground truth — see §6.1 |

### The left/right conflict is real and unresolved

Our exp 16 found the opposite polarity to the vendor's account. Our **chatty** unit
`f4:c4:59:3d:51:a6` is the one that streams buttons, and exp 16's Phase 1 button map
(D-pad + "−" paddle) identifies it as the **LEFT** unit. Our **silent** unit
`f4:c4:59:81:d9:a1` (RIGHT) published nothing at all on five direct connections and died at
60.5–61.2 s each time.

So: BikeControl says *the left one locks and the right one is free*; we measure *the left one
works and the right one is inert*. Both cannot be simply true. The likeliest reconciliation is
that BikeControl's "new unlock handling" (CHANGELOG 6.1.0) connects the two as **separate
controllers** with a right-specific setup we have not implemented — `zwift_clickv2_right_side.dart`
exists and is distinct from the left. **UNKNOWN**, and §7 arm D is the cheap test.

### 6.1 This finally reconciles the ground truth

The rider completed a **full workout on 2026-07-29 at ~19:21** with our client. That is
**~2.5 hours after** the authorised bridged Zwift game session captured in
`20260729-164954-bridge-ride.btsnoop` (16:38–16:50). The failure is **2026-08-07 — nine days
later**, with no Zwift session in between.

A ~24-hour authorisation window explains both observations without contradiction, and it
explains why the challenge exists in both captures but was only *enforced* in one:

> **INFERRED model.** The Click V2 left unit holds an authorisation context granted by a real
> Zwift session. While it holds, any client that completes `RideOn` gets keypad frames and an
> unanswered `FF 03` costs nothing. Once it lapses, the challenge is enforced and the keypad
> gate closes ~30–45 s later. Nothing about our client changed between 07-29 and 08-07; the
> device's stored state did.

**This is the explanation that must be beaten, not assumed.** It predicts that arm A below
reproduces the gate closing today, and that a Zwift session immediately makes everything work
regardless of what we write.

---

## 7. Physical test plan — pre-registered

Four arms across **two authorisation states**. Run them in order; each is gated on the previous
one's result. ~50 minutes today, ~10 minutes tomorrow.

### 7.-1 The design: a paired 2×2, not a one-sided control

Original framing (mine) treated the ~24 h Zwift window purely as a **confound to avoid**:
wait 24 h, then measure. The rider's framing is better — make it a **measured variable**, by
running the same arms either side of a deliberate authorisation. Same unit, same client, same
cue schedule; only time-since-Zwift differs. That is the paired-difference shape `experiments/18`
adopted after `17` showed one-condition-per-lap couldn't separate the effect from the noise.

| | **A — don't answer** | **B — answer `ff 04 00`** |
|---|---|---|
| **Lapsed** (today, *before* any Zwift) | expect **GATE CLOSED** — reproduces 08-07 | ⭐ **the decisive cell** |
| **Authorised** (today, after a Zwift ride) | expect **GATE OPEN** — the positive control | redundant; skip |
| **Lapsed again** (tomorrow, ≥25 h) | expect **GATE CLOSED** — window is reversible | only if today's B passed |

> ### ⚠️ Ordering is time-critical: do the lapsed arms FIRST
>
> The device is lapsed **right now** — that is what the 2026-08-07 11:22 capture demonstrates.
> Opening Zwift destroys that condition for ~24 h, and the lapsed state is the *only* state in
> which arms A, B, C and D mean anything: while authorised, everything passes regardless of
> what we write, which is precisely the confound that made `experiments/16` arm 0 unusable.
>
> **Do not open Zwift, or let Companion connect the Click, until phase 1 is finished.** Quit
> Companion on the phone first — it grabs the Click opportunistically.
>
> If Zwift *has* already been opened since the 11:22 capture, phase 1 is void: skip to phase 2
> and do the lapsed arms tomorrow instead.

**Phase 1 — lapsed (today, before Zwift).** Arm A, then arm B. Then arm D. Arm C only if B
fails. This is where the project's open question actually gets answered.

**Phase 2 — authorise (today).** Open Zwift on the Mac and **stay on the pairing screen** —
**no ride, no subscription needed** (see the box below; this is measured, not assumed). Pair the
trainer and the Click, press the paddles a few times so you can see them register, then **sit
there ~10 minutes** and quit Zwift. Either BLE route works: bridged through Companion, or the
Mac's own Bluetooth. **Write down the wall-clock time you disconnect** — that timestamp is the
zero of the window, and every later result is dated against it. If you take the bridged route,
capture it; the last box below says why that is worth doing.

> ~60 s would authorise perfectly well — the 10 minutes are for the **capture**, and only if you
> are taking the bridged route. The 21-byte `FF 04` body arrives at **+270.6 s**, behind the
> *second* challenge; a one-minute session yields only the empty `ff 04 00` we already hold. See
> the ⚠️ sub-box in "Capture phase 2" below. Running the sequence under
> `tools/ble-lab/capture.py --scenario authorise` prompts each step and, more usefully, writes
> the quit marker into a committed manifest so the phase-4 clock is not a note on paper.

**Phase 3 — authorised baseline (today, right after phase 2).** Re-run **arm A only**. This is
the positive control and it is the half of the comparison we have never actually measured with
our own client. Two things to read off it:

- Does the gate stay open for the full 240 s? If it does **not**, H32 is in serious trouble and
  the 24 h window is not what gates the keypad.
- **Do `FF 03` challenges still arrive while authorised, and are they tolerated unanswered?**
  Genuinely unknown, and it discriminates sharply: challenges arriving *and* being ignored *and*
  the gate staying open would mean the challenge is not itself the gate — H33 weakens, H32
  strengthens.

**Phase 4 — cold start (tomorrow, ≥25 h after the phase-2 timestamp).** Re-run **arm A**. A
closed gate confirms the window expired and is reversible, which converts H32 from "fits the
evidence" to "measured on our own hardware". A gate still open at 25 h is also a result: the
window is longer than BikeControl documents.

> ### ✅ The pairing screen is enough — no ride, no subscription
>
> **This project exists because the rider has no Zwift subscription**, so "enter a ride" was
> never an available step. It turns out not to be a required one either, and the capture we
> already hold proves it three ways.
>
> **1. The timing rules out a ride.** On the Click link in `20260729-164954-bridge-ride.btsnoop`:
> `RideOn 02 03` at **+7552.196**, and the first `FF 04` answer at **+7557.479** — the
> challenge/answer exchange starts **5.3 seconds after the handshake.** Nobody enters a ride in
> five seconds.
>
> (**Corrected 2026-08-07**: an earlier draft said the exchange *completes* at +5.3 s. It does
> not. That first answer is the **empty** `ff 04 00`; the 21-byte body does not arrive until the
> **second** challenge, at **+270.6 s** after the handshake. See the capture box below — it
> changes how long phase 2 has to sit on the pairing screen. It does not weaken this argument:
> a ride is still ruled out by point 2.)
>
> **2. The trainer link proves no ride was ever running.** That session made **22 client writes
> to the trainer, all inside the first 17 seconds** (discovery, `RideOn 02 03`, a handful of
> `00 08 xx` info queries, `41 08 05`) — and then **not one write for the remaining ~780 s.** A
> ride in progress streams resistance/gradient commands continuously. This was the pairing
> screen, with the rider pressing paddles to watch them register — which is exactly what the 20
> keypad bursts, separated by gaps of up to 136 s, look like.
>
> **3. The vendor says so.** `experiments/14` §5 quotes BikeControl: the unlock needs the Zwift
> app, but *"**a paid subscription is not required for this step**"*; and its `TROUBLESHOOTING.md`
> recipe is *"connect trainer → connect Click v2 → keep connected ~10–30 seconds → close Zwift"*
> — no ride anywhere in it.
>
> **Consequence for the ground truth**: the rider's working 2026-07-29 ~19:21 workout followed a
> **pairing-screen-only** Zwift session at 16:38–16:50. A pairing-screen touch authorised the
> device for at least 2.5 hours.
>
> ### ⚠️ And the BLE route does not matter either
>
> **Corrected 2026-08-07** after the rider described how the bridge actually works. An earlier
> draft of this section said "use the game, not Companion". That was wrong as stated, and our
> own capture disproves it.
>
> **Companion in bridge mode is a BLE proxy.** It holds the links to the trainer and *both* Click
> units and relays a single encrypted stream to the game over the LAN; it exists because some
> Apple devices expose only a couple of usable BLE slots. Every detail of that matches what we
> measured: `experiments/16` §3 found both Clicks on **separate concurrent ACL links from the
> phone**, and §5 measured the LAN leg as **TCP/21588, 4-byte length framing, entropy 7.74/7.91
> bits/byte** — i.e. one encrypted stream.
>
> So the protocol decisions are the **game's** and Companion only moves the bytes. And the proof
> is in §3: **both `FF 04` writes were sent from the phone's own radio, by Companion, while it
> bridged a live game.** Verify it yourself —
> `tshark -r 20260729-164954-bridge-ride.btsnoop -n -Y btatt -T fields -e btatt.value -e _ws.col.info`
> shows both as `Sent Write Command`. **The bridge authorises.**
>
> What `experiments/15` actually measured is narrower than "Companion does not unlock":
> Companion **with no game session behind it** wrote no payload at all. That is exactly the case
> BikeControl's `unlock_openZwift` string warns about — a user opening Companion *instead of*
> Zwift — and it also **dissolves the `14` §6 conflict**, where `03`/`GOALS.md` credited
> Companion. Both records are right: Companion works when a game is behind it.
>
> **Requirement: Zwift open on its pairing screen with the Click connected.** No ride, no
> subscription, either BLE route.
>
> If phase 3 shows the gate closing anyway, suspect the authorisation did not take before
> suspecting anything else, and repeat phase 2 sitting on the pairing screen for longer.

> ### ⭐ Capture phase 2 — it directly tests this document's "not replayable" headline
>
> Take the **bridged** route and pull an `adb bugreport`, and phase 2 costs nothing extra while
> collecting the highest-value bytes available to this project.
>
> §0 says the 21-byte `FF 04` body is not replayable. That rests on two things — the challenge is
> ephemeral, and BikeControl proxies rather than computes — but **we have seen exactly one
> 21-byte reply.** A second one settles it outright:
>
> - **Identical to `a5 6d ef 98 b0 95 57 7f 39 a5 3c 1f 0e 0e 39 64 2f 6e 29 15 d9`** ⇒ a static
>   per-device token, replay is viable, and §0's headline is **overturned** — which would make a
>   browser fix possible after all.
> - **Different** ⇒ derived from the ephemeral challenge, replay is dead, §0 stands.
>
> Two more things to read off the same capture, both currently n=1: whether the *first* challenge
> of a session always draws the **empty** `ff 04 00` and only a later one draws a body, and
> whether field 3's "40 bytes on a first challenge, longer on a re-challenge" pattern holds.
>
> ```bash
> tools/ble-lab/android-capture.py --pull --scenario authorise --device f4:c4:59:3d:51:a6
> ```
>
> #### ⚠️ 60 seconds on the pairing screen collects nothing new — sit for ~10 minutes
>
> **Added 2026-08-07**, from re-reading the 07-29 capture before running phase 2. The step-list
> above used to say "sit ~60 s, quit", which would have failed this box's own purpose. On the
> LEFT unit's link (`chandle 0x000a`), measured:
>
> | +s from RideOn | Frame | Body |
> |---|---|---|
> | 0.0 | `RideOn 02 03` | handshake |
> | **+4.8** | challenge #1 | `ff 03 …` 40-byte field 3 |
> | +5.3 | answer #1 | **`ff 04 00` — empty** |
> | **+270.6** | challenge #2 | `ff 03 …` longer field 3 |
> | +271.1 | answer #2 | **the 21-byte body** |
>
> So the decisive bytes live behind the **second** challenge, ~4.5 minutes in — a one-minute
> session captures only the empty answer, which we already hold. **Sit ~10 minutes**, which also
> buys challenge #3 at ~+9 min and therefore a *second* body inside the same session. That is a
> strictly better experiment than the two-session comparison alone: two bodies from one session
> separate **per-session** derivation from **per-challenge** derivation, which the cross-session
> comparison cannot do on its own.
>
> **Buffer headroom is not the constraint it was thought to be.** `android-capture.py`'s docstring
> and the handoff both warn of a "rolling ~7-minute buffer". Measured on the artefact we actually
> hold, that bugreport carried **138.9 minutes** — the cap is on bytes, not minutes, and a
> pairing screen is far quieter than the ride that produced the 7-minute figure. Still run
> `--pull` promptly, but a 10-minute sit is not the risk.
>
> **This does not change what authorises.** Phase 1 showed `ff 04 00` is a non-answer, and the
> 07-29 link's accepted-cadence (265.8 s vs the lapsed 15.5 s) was already set at challenge #1 —
> i.e. the device was authorised *before* any body was sent. BikeControl's "10–30 seconds"
> recipe stands. The extra 9 minutes buy **bytes**, not authorisation.
>
> **Do not let this cost you the authorisation.** If the bridge does not come up within a few
> minutes — `experiments/15` §6.0's failure mode is the Mac grabbing the BLE directly, leaving the
> capture empty — fall back to direct Mac Bluetooth and skip the capture. Phase 4 needs the
> window open more than we need the bytes.

**Assumption worth stating**: that our own connections do not themselves refresh the window. We
never perform the negotiation, so they should not — but if phase 4 finds the gate still open
after a day of our own testing, this is the first thing to doubt.

### 7.-0.5 Authorising is a test instrument, not the proposed fix

Worth separating, because the rider raised it and it is the right objection: **this app exists so
that Zwift is not required.** "Open Zwift once a day" is a poor answer for it, subscription or
not, and phase 2 is not a recommendation of that workflow — it is how we obtain the *authorised*
half of §7.-1's paired comparison. Without it there is no control.

If H32 survives — the gate is a ~24 h window and answering the challenge does not help — then the
daily-Zwift path is the thing we are trying to avoid, and the remaining product options are, in
order of preference:

1. **Arm D** — the right unit as its own controller, if it genuinely needs no unlock. Costs
   nothing, needs no workaround, and would make this whole thread moot. Remap shift-down onto a
   right-unit button (`B` = `0x20`).
2. **Arm C** — the `0x18` reset cycle, which is what BikeControl ships *by default* precisely
   because its users will not open Zwift daily either. Costs a ~2 s input gap per minute.
3. Daily Zwift pairing-screen touch — last resort, and contrary to the project's premise.

That ordering is why arm D is worth running today even though it is the cheapest arm, and why a
negative result on arm B does not end the investigation.

### Instrument (already built, this session)

`src/dev/ble-lab.html` gained three things. `npm run dev:ble`.

- **Auto-answer the FF 03 challenge** — checkbox. Off = arm A, on = arm B. Logs every inbound
  `FF 03` with its uptime and the gap since the previous challenge, whether or not it answers.
- **Keypad gate** readout — seconds since the last `23` frame, with a loud
  `KEYPAD GATE CLOSED` log line past 15 s and a `KEYPAD GATE REOPENED` line if it recovers.
  This is what §2 says was missing.
- **Reset cycle** — `window.__bleLab.click.resetCycle(50)` writes `0x18` every 50 s (arm C).

Headless driving: `window.__bleLab.click.{answerChallenges, challengeStats, gateQuietSeconds,
resetCycle, uptime, serial}`.

### 7.0 Bench card — the run is automated; you press the paddle

**What is and is not automated.** The paddle press cannot be automated — there is no actuator,
and §2 shows only a physical press makes the device emit a `23` frame. Everything else is:
connect, handshake, challenge answering, the press schedule, scoring, the verdict, and the
cooldown between arms.

And cueing the press is not merely convenience. §2's problem was that nobody recorded *when*
the rider pressed, so a 106 s silence could not be told from an idle rider. A cued run
**timestamps every press and scores it hit or miss**, which converts the central observable
from "the frames went quiet" — worthless on its own — into a per-press series. That is a
better experiment than the metronome version, not just an easier one.

**The day before**

- Confirm **no Zwift session in the last 24 h**, on *any* device — the game **and** Companion,
  phone **and** Mac. This is the one control that cannot be recovered afterwards.
- Do not open Zwift again until all four arms are done.

**Setup, once**

- `export PATH="$HOME/.nvm/versions/node/v24.11.1/bin:/opt/homebrew/bin:$PATH"`
- `npm run dev:ble` — opens `src/dev/ble-lab.html` in Chrome. Firefox and Safari have no
  Web Bluetooth.
- Trainer **off / not connected** for arms A, B and D.
- Wake **only** the unit under test, with one press of its own paddle. Do not touch the other.
- Press **Connect Click** once and pick `Zwift Click`. This is the only manual connect —
  `requestDevice` needs a user gesture, but everything after it reconnects on its own.
- Check the **Serial** line (sniffed passively off the first `FF 05` frame, so it costs nothing):
  - `34C4593D51A6 → f4:c4:59:3d:51:a6` = **primary / LEFT** — arms A, B, C
  - `34C45981D9A1 → f4:c4:59:81:d9:a1` = **secondary / RIGHT** — arm D
  - Wrong one? Disconnect and reconnect, choosing the other chooser entry. Do **not** press
    *Identify unit* — it is an extra write and it perturbs the measurement.

**Running an arm**

1. Press **Run arm A** (or B, or D). It handles the reconnect, the handshake, and the answer
   policy — including setting that policy *before* the handshake, since the first challenge
   lands ~7 s after it.
2. Watch the big banner. Every 10 s it goes green and says **PRESS**, with a beep and a
   countdown. **Press the paddle on the cue** — the "−" paddle on the left unit, "+" on the
   right. Anywhere within ~3 s counts.
3. That is the whole job. The arm ends itself at 240 s (B: 300 s) and prints its own verdict.
4. **Export log** and save it as `arm-A.json` etc.
5. **Abort** stops a run cleanly; an aborted or link-dropped arm is reported as
   `⚠️ ENDED EARLY` and never as a clean result.

**Between arms: press Disconnect and wait ~90 s. Do not reload the page and do not clear the
log.**

- **Disconnect is load-bearing, and now enforced.** Starting an arm on a link that has already
  run one is refused, because it would silently corrupt two things: arm A ends with the gate
  *closed*, so arm B on the same link measures whether an answer **reopens** a shut gate — a
  different question, reading as a false negative — and `uptimeAtGateCloseS` is measured from
  connect, so a reused link carries the previous arm's clock forward. `linkReady()` reports
  whether the current link can start an arm.
- **Do not reload.** A reload drops the device permission, so every arm would need the chooser
  again and the serial re-verified — more steps and more chances to run an arm against the wrong
  unit.
- **Do not clear the log.** Every arm writes `ARM <name> START` and `ARM <name> RESULT` markers
  on one continuous timebase, so a cumulative log splits cleanly per arm. Exporting after each
  arm without clearing means each file is a superset of the last, which is a free backup if one
  export goes missing.

Or run the decision rule itself, which stops after A if the failure did not reproduce —
because arm B is uninterpretable without it:

```js
await __bleLab.click.runPlan()   // arm A, 90 s cooldown, then arm B — keep pressing on the cue
```

**Reading the verdict.** Printed in the results pane and written to the log:

| Verdict | Meaning |
|---|---|
| `GATE CLOSED at <n>s uptime — N missed cues in a row, link STILL UP` | ✅ the failure reproduced; this is arm A's pass |
| `gate stayed OPEN for 240s — 24/24 cues hit` | no failure. In arm A that means **stop** (§7 arm A); in arm B it is the result we want |
| `⚠️ NO CUE EVER HIT` | the gate never *opened* — wrong unit, or presses not landing. A different diagnosis, deliberately not merged with "closed" |
| `⚠️ ENDED EARLY` | link dropped or aborted; the arm measured nothing |

An isolated fumbled press is not scored as a closure — only a trailing run of ≥3 misses is.

**Recorded automatically** — arm, cues/hits/misses, trailing misses, uptime at gate closure,
median press latency, every challenge with its uptime and whether it was answered, whether the
link survived, and the sniffed serial. **The one thing you must write down yourself: the time
since the last Zwift session.** The run is void without it.

**The rig is verified.** `scoreCues`/`verdictLine` are pure and unit-tested
(`tests/unit/arm-score.test.js`, 13 cases incl. the all-miss and fumbled-press traps), and the
cue/scoring path was driven end-to-end in a browser on a compressed 300 ms schedule — which is
how the `NaN` in the uptime field and a 3 s duration overstatement were found and fixed before
the bench rather than after. `__bleLab.click.runArm({dryRun: true, …})` re-runs that check.

### Controls that are load-bearing — get these wrong and the run is worthless

1. **≥ 24 h since any Zwift session, on any device.** Exp 16's arm 0 was confounded by a
   45-minute-old one. If the device is inside its window, *every arm will pass and prove
   nothing*. Record the date of the last Zwift session in the run notes.
2. **The LEFT unit, `34C4593D51A6` / `f4:c4:59:3d:51:a6`.** Confirm from the serial readout,
   which sniffs it passively off the `FF 05` frames — do **not** press "Identify unit", it is
   an extra write.
3. **Wake only the left unit**, matching the failing capture (whose `FF 05` showed the partner
   at 255/0, i.e. absent). Changing this changes two things at once.
4. **Press the paddle on every cue.** The runner drives a 10 s cue; you respond to it. Without
   press timestamps the run cannot distinguish a closed gate from an idle rider, which is
   exactly the hole in the 08-07 capture.
5. Trainer **not** connected for A/B/D. Add it only in a confirmation run, since 08-07 had it
   and exp 16's bench runs did not.
6. Ceiling **240 s** per arm — Zwift's own answered link went 265.8 s between challenges, so
   240 s meaningfully covers the first challenge cycle without covering the second. Arm B runs
   to **300 s** instead, to cover the second challenge.
7. ⚠️ **The lab is not byte-identical to the app.** `dumpAndSubscribe` subscribes to *every*
   notify/indicate characteristic it finds — `0002`, `0004`, `0100`, `0101`, `0102`, `2A19` —
   i.e. Zwift's seven CCCDs, where `clickBle.ts` subscribes to **two**. So if arm A fails to
   reproduce the gate, the subscription set is a live suspect and the next run should be the
   app itself with an Android capture. If arm A *does* reproduce it, we have simultaneously
   learned the extra subscriptions do not matter — which is `experiments/15` §6.3 answered
   for free.

### Arm A — negative control: reproduce the gate closing

Auto-answer **OFF**, 240 s. Run it **first, today, before any Zwift contact** (§7.-1), and again
in phase 3 and phase 4 unchanged — it is the one arm that appears in all three states, which is
what makes the comparison paired.

| Outcome | Reading |
|---|---|
| `KEYPAD GATE CLOSED` fires, link still up, ≥1 unanswered `FF 03` logged | ✅ the failure reproduces on the bench and B is interpretable. **Record the uptime at closure and the challenge timings.** |
| Gate never closes for 240 s | The device is still inside its authorisation window, or the trainer's presence matters. **Stop** — B and C would prove nothing. Re-run after 24 h, then with the trainer. |
| No `FF 03` ever arrives | The challenge is not unconditional. Big finding on its own; it would mean §3's mechanism cannot be the explanation. |

### Arm B — the cheap shot: answer with the empty `ff 04 00`

**The decisive cell of §7.-1's 2×2, and only meaningful in the lapsed state.** Run it today,
before Zwift, immediately after A. Same as A with auto-answer **ON**, variant `ff 04 00`.

Run to 300 s, not 240 — the answered case in the capture re-challenged at **265.8 s**, so a
240 s arm would stop just short of the one event that tests whether the answer *keeps* working.

This is the test exp 16 believed it had already run and had not. Its run 5 wrote `ff 04 00`
twice — but on the **silent/right** unit, which issues no `FF 03` at all, so it was an
unsolicited write to a device that had asked nothing. Its verdict *"FF 04 00 is FALSIFIED as a
keep-awake"* does not bear on answering a live challenge on the left unit.

| Outcome | Reading |
|---|---|
| Gate stays open past A's closing time, and past 240 s | 🎯 **The fix is three bytes**, sent as a reply. Patch `clickBle.ts` per §8 and re-run for 10 min. |
| Gate closes at the same uptime as A | The empty assertion is not accepted when the device is genuinely locked — consistent with BikeControl's `isPersistedUnlocked` guard. Go to C. |
| Device re-challenges within ~15 s of our answer | Our reply was rejected. Note the re-challenge's field-3 length: 40 → 58 was the unanswered pattern; something else means the reply was parsed. |

Optional B2, one extra minute: variant `echo33`, which replies `ff 04 00 0a 21 <the challenge's
own 33 bytes>`. It tests only whether the device checks that we *read* the frame rather than
that we can do the key agreement. Low prior, near-zero cost.

### Arm C — does `0x18` reset the device at all?

**Scope deliberately smaller than "run the cycle".** `ble-lab.html` has **no auto-reconnect** —
`attachDisconnectListener` logs the drop and stops the clock, nothing more. Only `clickBle.ts`
reconnects. So the lab cannot test the *cycle*; it can test the *primitive*, which is the part
we are actually unsure about, and it takes two minutes.

Steps: connect and handshake as above, wait ~20 s, then type `18` into **Raw hex to SYNC RX**
and press Send. Watch for a disconnect and for the LED.

Two independent sources put `0x18` at reset (makinolo's Play command list; BikeControl's
`Opcode.RESET = 24` plus its `[opcode, ...body]` framing), so the byte is solid; that it is
**a bare single byte with no body** is inferred from the framing rule, since BikeControl's call
site is in its private submodule. If `0x18` alone does nothing, that inference is the first
thing to doubt.

| Outcome | Reading |
|---|---|
| Link drops within a second or two; the unit re-advertises | ✅ `0x18` is the reset. The cycle then becomes a `clickBle.ts` change — a 50 s timer feeding the reconnect path that already exists — and **that** is where the unattended-reconnect question gets answered. |
| Nothing observable | Wrong framing. Try `18 00`, then makinolo's `18 05`. If none work, the private-submodule inference is wrong and arm C is dead. |
| The write itself throws | Note the Chrome error verbatim; `writeValueWithoutResponse` on a 1-byte payload should never fail. |

Only worth running if arm B fails, since a reset cycle costs a ~2 s input gap every minute and
answering a challenge costs nothing.

### Arm D — the right unit as a separate controller

Cheapest of all and it may make the whole thread moot. Wake **only** the right unit
(`34C45981D9A1`), connect, `RideOn 02 03`, press its "+" paddle every 10 s for 240 s.

Exp 16 ran essentially this five times and got silence plus a hard 61 s drop — but it was
looking for a *link drop*, before we knew the failure mode is a *gate*, and it did not press
buttons on a schedule. BikeControl and qdomyos-zwift both state the right side needs no unlock,
which directly contradicts our measurement, and one of the two is wrong.

If frames arrive: map shift-down onto a right-unit button (`B` = `0x20`, per `clickButtons.ts`)
and the product needs no unlock, no reset cycle, and no 24 h refresh.

---

## 8. Patch proposal for `src/services/clickBle.ts`

**Do not patch yet.** Arm B decides between two very different changes, and both are small.

The parser is the blocker either way: `parseClickFrame` collapses every `0xff` frame to
`{ type: 'status' }` (`clickButtons.ts:160`), discarding the challenge body. Whatever arm B
shows, that has to change — the challenge must at least be *visible* to `clickBle.ts`.

**If arm B passes** — add a `challenge` frame type carrying the raw bytes, and in `onAsync`
reply `ff 04 00` on SYNC RX. ~15 lines, no new state, no timer. Keep the SYNC RX characteristic
on the connection object; `attach()` currently drops it after the handshake.

**If arm B fails and C passes** — a 50 s interval writing `0x18`, plus the existing reconnect
path. Note this makes `MAX_RECONNECTS = 60` a ~50-minute ceiling rather than an hour-plus one,
since resets are now deliberate; raise it or stop counting intentional resets.

**Either way**, three comments in `clickBle.ts` are now wrong and should go when it is next
touched:

- lines 121-124: *"frames stop at ~70 s and the host tears the link down at 78.4 s — a
  supervision timeout, i.e. the device stops answering"*. On Android the ACL stayed up 106 s
  past the gate closing. The macOS teardown is a **consequence** of the gate, and the code's
  own commit `0bf477c` says so.
- lines 31-38: the `FRAME_STARVATION_MS = 8000` rationale says *"the primary streams battery
  every ~5 s ... so silence beyond ~8 s is the device going quiet"*. That is right for battery
  but §2 shows keypad silence of 136 s is normal on a healthy link. The watchdog is sound; the
  comment invites the wrong inference from a keypad gap.
- line 11: *"if nothing arrives within a few seconds, you are on the pair's SECONDARY unit"* —
  fine as a heuristic, but §6 shows the left/right polarity is contested.

---

## 9. Confidence

**CONFIRMED** — deterministic from raw ATT PDUs, reproducible with the command in the header

- The `23` stream ends 0.90–1.23 s after the last non-idle bitmap, in all 29 bursts of both
  captures. Working-session keypad silences reach 136.5 s with no fault.
- `20260807` carries 21 further battery frames after the last keypad frame, to +158.876 s; the
  committed *"final packet at +57.627"* is a report-truncation artefact.
- Two outbound `FF 04` writes exist on `00000003`, at +7557.479 (`ff 04 00`) and +7823.317
  (`ff 04 00 0a 15` + 21 bytes), each ~0.45 s after an inbound `FF 03` on `00000002`.
- `FF 03` field 2 = `0x02030000` in all six observed frames; field 1 is 33 bytes with a valid
  compressed-point prefix; field 3 is 40 bytes on first challenges, 43/58 on re-challenges.
- The failing session's two challenges were unanswered; the gate closed 45.7 s after the first
  and 30.2 s after the second; nine bursts occurred *after* the first unanswered challenge.
- `FF 05 / ea 05` field 3 took 15 → 900 across the failure boundary, and 496 / 248 across other
  sessions. It does not decrease.
- Nine client writes in 786 s of working link, seven of them within the first second. No
  periodic write.
- Our client subscribes 2 CCCDs; Zwift subscribes 7 (`2A05`, `0002`, `0004`, `0100`, `0101`,
  `0102`, `2A19`).
- `20260807` is our own client: 2 CCCDs, `RideOn 02 03`, then no further write — byte-for-byte
  what `clickBle.ts` does.

**INFERRED**

- The gate closes because the challenge went unanswered. Fits the timings; not tested. The
  competing explanation in §6.1 (a lapsed 24 h authorisation) fits the same evidence *and*
  explains the 07-29 ground truth, so it is currently the stronger of the two.
- `FF 05 / ea 05` field 2 = 1 marks the closed gate. n = 1, 0.136 s after the last keypad frame.
- `FF 05 / fa 05` fields 4–7 are (this %, partner %, this mV, partner mV); the failing session's
  255/0 means the partner unit was absent.
- `Opcode.RESET` on the wire is the single byte `0x18`.
- The empty `ff 04 00` is an "already unlocked" assertion rather than a proof.

**UNKNOWN**

- How the 21-byte `FF 04` body is computed. Almost certainly not by us: the challenge key is
  ephemeral per connection and BikeControl proxies rather than computes.
- Whether the device would accept the empty `ff 04 00` as a reply when genuinely locked. **Arm B.**
- Whether the left/right polarity in our H30 or in BikeControl's UI copy is the wrong one. **Arm D.**
- What `FF 05 / ea 05` fields 3–6 mean.
- Whether Zwift's extra subscriptions (`0100`/`0101`/`0102`) or its five hub-query writes matter.
- Whether the ~24 h window is real for *our* unit. Every arm above measures it as a side effect.

---

## 10. Follow-ups

1. **Run arm A.** Nothing else in this document is interpretable until the failure reproduces
   on the bench with timestamped presses.
2. Regenerate `20260807-…report.md` with `--no-collapse`, and add a cap warning to
   `analyze.py`'s step list so a truncated report cannot be mistaken for a complete one again.
   That defect cost this investigation its central premise.
3. Fold the `FF 03` / `FF 04` exchange into `PROTOCOLS.md` §1.5, which currently lists only the
   empty `FF 04 00` from a secondary source. We now have first-party bytes for both forms.
4. Retract experiment 13's countdown hypothesis in place (§4) and mark H26's countdown clause
   falsified in `HYPOTHESES.md`.
5. Add the four `FF 03`/`FF 04`/`FF 05` frames here as byte fixtures to
   `tests/unit/zap-frame-parser.test.js`, and make `parseClickFrame` return the challenge body
   rather than collapsing it to `{ type: 'status' }`.
6. Record `RESPONSE_STOPPED_CLICK_V2_VARIANT_1/2` (`ff 05 00 ea 05` / `ff 05 00 fa 05`) in
   `PROTOCOLS.md` as BikeControl's names for these frames, with the caveat that we observe both
   at connect time too.
