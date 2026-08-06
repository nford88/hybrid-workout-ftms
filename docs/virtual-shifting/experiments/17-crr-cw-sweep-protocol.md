# 17 — Crr/Cw sweep protocol (pre-registration)

**Date drafted:** 2026-08-04 · **Ridden:** 2026-08-05 · **Status:** RESULTS IN — see §10
**Hardware:** Wahoo KICKR CORE C26B fw 1.5.36, Zwift Click pair fw 1.2, Zwift Cog 34/14
**Answers:** H31 (new, below) · advances handoff next-steps 2, 3 and 5

---

## 1. The question

Handoff next-step 3 — _"confirm whether the KICKR's road model is our formula"_ — could not be
answered from ride 1 because a single ride varies grade and gear together and holds nothing
constant. The last attempt could only assume a flat 0%, produced a median error of 3.88 kph and a
**negative** correlation, so it is genuinely unresolved.

This protocol answers a sharper and more tractable question first:

> **H31 — does the KICKR use the `Crr` and `Cw` bytes we send in the FTMS Set Indoor Bike
> Simulation Parameters write (0x11), or does it only use the grade?**

That question is worth answering before any power-curve comparison because it decides whether
half of what we transmit means anything at all, and because it settles the open Crr 0.017 vs
0.004 argument (Decisions item 6 in the handoff) by measurement instead of preference.

## 2. Why this design is clean — the measured reason

Crr and Cw enter our pipeline **twice**, in opposite directions:

1. `roadPowerW(routeGrade, v_virt, m, crr, cw)` → the power the road should demand
   ([virtualDrivetrain.ts:182](../../../src/services/virtualDrivetrain.ts#L182))
2. `solveSendGrade(target, v_fly, m_trainer, crr, cw)` → the grade that makes the trainer's
   _assumed_ road model demand that power ([virtualDrivetrain.ts:183](../../../src/services/virtualDrivetrain.ts#L183))

In the baseline gear those two cancel — the design's baseline-identity property. **Measured on the
real model 2026-08-04** (`window.virtualDrivetrain`, 85 rpm, `trainer-default` Cw), sweeping
Crr 0.004 → 0.020, i.e. the full preset range:

| Gear (0-based index)       | Ratio    | Δ sent grade @0% | Δ sent grade @3% |
| -------------------------- | -------- | ---------------- | ---------------- |
| 3                          | 1.11     | **−0.870 pp**    | −0.870 pp        |
| 7                          | 1.68     | −0.493 pp        | −0.493 pp        |
| **11** (≈ baseline 2.4286) | **2.40** | **−0.019 pp**    | −0.020 pp        |
| 14                         | 3.03     | +0.397 pp        | +0.399 pp        |

And for Cw, `aero-bars` 0.20 → `trainer-default` 0.51:

| Gear   | Δ sent grade @0% | Δ our target power |
| ------ | ---------------- | ------------------ |
| 7      | −1.326 pp        | +38.5 W            |
| **11** | **−0.069 pp**    | +112.2 W           |
| 14     | +1.867 pp        | +225.7 W           |

Two consequences, and they are the whole basis of the protocol:

- **In gear index 11 the sent grade is invariant to Crr and Cw** — 0.019 pp and 0.069 pp are both
  well inside `setSimGrade`'s 0.3% deadband ([main.js:884](../../../src/js/main.js#L884)), so a
  condition change will not even trigger a new write. **Therefore every observable effect of the
  sweep is on the trainer side.** One causal pathway, not two. That is what makes H31 decisive.
- **Off baseline it is not invariant, and the sign flips either side of it** (−0.87 pp at gear 3,
  +0.40 pp at gear 14). A rider shifting freely during a measurement block injects a
  gear-dependent grade confound that is _perfectly correlated with the swept variable_. This is
  not noise that averages out — it is bias.

## 3. Predicted effect sizes

At **97 kg** — this rider's own saved settings, 89 rider + 8 bike, not the 75+8 defaults — 85 rpm
in gear index 11 ⇒ `v_virt` = 25.66 kph = 7.13 m/s, on the 0% block where the grade term vanishes
entirely and resistance is Crr + Cw _alone_:

| Sweep             | Predicted Δ power if the KICKR honours the byte     | Model's own Δ target |
| ----------------- | --------------------------------------------------- | -------------------- |
| Crr 0.004 → 0.020 | `m·g·ΔCrr·v` = 97 × 9.81 × 0.016 × 7.13 ≈ **109 W** | 211.7 → 320.2 W      |
| Cw 0.51 → 0.20    | `Δcw·v³` = 0.31 × 362.5 ≈ **112 W**                 | 211.7 → 99.5 W       |

Hand-computed and model-measured agree to 0.1 W, as they must. Note the Crr figure scales with
mass and the Cw figure does not — the aero term has no mass in it — so 97 kg moves the Crr
prediction from 93 W to 109 W while leaving Cw at 112 W.

Both effects are 7–11× typical rider power noise (±10–15 W), so the test has ample power to detect
them. **A null result is therefore as informative as a positive one**, which is the property a good
experiment needs.

Re-measured at 97 kg 2026-08-05, the baseline invariance of §2 still holds: sweeping Crr moves the
sent grade by **0.019 pp** and Cw by **0.059 pp**, both far inside the 0.3% deadband. That is
expected — the identity is mass-independent — but it is now confirmed on the settings that will
actually be ridden rather than on defaults.

Byte encoding checked — no clipping, all presets distinguishable
([ftms.js:237-248](../../../src/js/ftms.js#L237-L248)): Crr u8 @1/10000 → 40/50/110/170/200;
Cw u8 @1/100 → 20/28/36/45/51.

## 4. The route and the workout

| Artifact                                                                                        | Use                                                                                                                         |
| ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [`17-crr-cw-sweep-route.json`](17-crr-cw-sweep-route.json)                                      | Paste into **Import Garmin Route**. 1.70 km, avg 1.147%, 35 points                                                          |
| [`17-crr-cw-sweep-workout.json`](17-crr-cw-sweep-workout.json)                                  | Route **and** the 13-step plan in one file. `route` is what the import textarea accepts; `workout` is a `SavedWorkoutEntry` |
| [`17-install-sweep-workout.js`](17-install-sweep-workout.js)                                    | **Paste into the console** — installs both and reloads. Skips the 13-step click-through                                     |
| [`17-auto-conditions.js`](17-auto-conditions.js)                                                | **Paste into the console** — applies all six conditions on schedule so the ride is hands-free                               |
| [`make_sweep_route.py`](make_sweep_route.py) / [`make_sweep_workout.py`](make_sweep_workout.py) | Regenerate, in that order                                                                                                   |

13 steps: `ERG 5 min @120 W` warm-up, then **6 × (SIM lap + ERG 1.5 min @100 W)**, the last rest
being a 5 min cool-down. ~42 min.

The rest steps exist so the whole protocol is **one continuous workout**. Each is 90 unhurried
seconds to change the two presets and click Apply, without stopping and pressing Start Workout
again per condition. Nothing in an ERG step is analysed — the log tags every step with its type,
so they are dropped by inspection. The ERG powers are deliberately easy: lap 1 is a baseline
condition whose only job is to be comparable with laps 3 and 6, so arriving tired defeats the
design.

**If you do stop and restart per lap, that is now safe too** — but it wasn't. Every Start Workout
calls `startRideLog`, which cleared the log outright, so six laps ridden as six runs exported as
**one**, with five silently destroyed. `startRideLog` now archives a non-empty run into
`earlierRuns` in the export instead ([rideLog.ts](../../../src/services/rideLog.ts)), and the panel
counter says `N earlier runs kept` so you can see it happening. The continuous plan is still
preferable: one clock, one file, nothing to forget.

There is no "import workout" UI — only Save Current / Load / Delete against localStorage — and a
saved workout stores `routeName` **without** the route's geoPoints
([types.ts:81-86](../../../src/types.ts#L81-L86)). So the single-file bundle is a convenience
wrapper whose two members are each byte-for-byte a shape the app already reads; the installer
writes the four keys from [storage.ts:20-33](../../../src/services/storage.ts#L20-L33)
(`garminRoute`, `workoutPlan`, `savedWorkout_<name>`, `savedWorkoutsIndex`) and reloads, because
the legacy boot path reads route and plan once at startup.

The route's origin is pinned at **(0, 0)** and it contains no recorded ride: only point _spacing_
reaches `haversineDistance`, so the origin is free, and `.gitignore` excludes `*-route.json`
precisely because real routes are personal GPS data. This one carries none, which is why it is the
single documented exception to that rule rather than a file you must regenerate to follow the
protocol.

Constant-grade plateaus, **not** a shortened Leap Lane Hills. `preprocessRouteData` makes one
constant-grade segment per point pair, `getGradeForDistance` is a step function over those, and
`setSimGrade` rewrites the trainer on a 3 s timer with a 0.3% deadband. A recorded outdoor route's
grade wanders faster than the app can send it, so no sample is attributable to a known grade.
Plateaus that outlast the throttle are what make per-condition regression possible.

Verified 2026-08-04 — installer run in the app, reload, route reads "1.70 km / 1.15%", all 8 steps
render, workout appears in the Saved Workouts dropdown; grades below walked with the app's own
`H.route.getGradeForDistance`:

| Grade | Distance      | Purpose                                                               |
| ----- | ------------- | --------------------------------------------------------------------- |
| 3%    | 0 → 350 m     | **Transition.** Change the presets here, settle, absorb the ramp-in   |
| 0%    | 355 → 745 m   | **Measurement block A.** No grade term ⇒ resistance is Crr + Cw alone |
| 6%    | 750 → 995 m   | Steep, deliberately short; shift freely                               |
| −2%   | 1000 → 1300 m | Descent / coasting path (the old multiplier model got this backwards) |
| 0%    | 1305 → 1700 m | **Measurement block B.** Repeat of A inside the same lap              |

The climb leads deliberately. A lap boundary is when the rider changes presets and clicks Apply,
and `startSimStep` also `rampSim`s into the lap's first grade — so the opening block cannot be a
measurement block. Leading with 3% buys ~90 s of don't-care riding and puts both 0% blocks clear
of the boundary. (An earlier draft opened with block A at 0 → 400 m; it was unrideable as
specified.)

400 m ≈ 60 s at 24 kph, so each measurement block spans at least one full throttle period even if
you ride it slower than planned. Two blocks per lap give a within-lap replicate, which is what
separates condition effects from drift.

**Laps come free:** `runWorkoutStep` resets `simDistanceTraveled` per SIM step
([main.js:1281-1285](../../../src/js/main.js#L1281-L1285)), so **N SIM steps = N laps** of the same
route, each auto-advancing 5 s after completion, each emitting a `step` event the analysis splits
on.

## 5. Condition schedule

Six laps, **one variable changed at a time from baseline**, with baseline ridden three times
spread through the session. The A-B-A-C-D-A shape is deliberate: ordering conditions monotonically
would make fatigue drift indistinguishable from a Crr effect, and fatigue over ~40 minutes is
guaranteed.

| Lap | Tyre preset           | Crr   | Position preset       | Cw   | Role                               |
| --- | --------------------- | ----- | --------------------- | ---- | ---------------------------------- |
| 1   | Smooth trainer/indoor | 0.004 | HW-V8 trainer default | 0.51 | **A** — baseline                   |
| 2   | Gravel / knobby       | 0.020 | HW-V8 trainer default | 0.51 | **B** — Crr high (max contrast)    |
| 3   | Smooth trainer/indoor | 0.004 | HW-V8 trainer default | 0.51 | **A** — drift check                |
| 4   | Smooth trainer/indoor | 0.004 | Aero bars / TT        | 0.20 | **C** — Cw low (max contrast)      |
| 5   | Standard road tire    | 0.011 | Hoods, normal         | 0.36 | **D** — mid-point, tests linearity |
| 6   | Smooth trainer/indoor | 0.004 | HW-V8 trainer default | 0.51 | **A** — closing drift check        |

~1.7 km × 6 ≈ 10 km, roughly 30–40 min plus a warm-up ERG step. If you have to cut it short, drop
lap 5 first (linearity is a refinement), then lap 6. **Never drop lap 3** — without a mid-session
baseline the whole thing is uninterpretable.

## 6. Execution

**Before starting:**

1. Install route + plan: paste [`17-install-sweep-workout.js`](17-install-sweep-workout.js) into
   the console (it reloads itself). Manual alternative: paste the route JSON into **Import Garmin
   Route**, then Add Step × 8 by hand.
2. Rider physics panel: set lap 1's presets, valid FTP / rider weight / bike weight, click
   **Apply**. Confirm the success toast.
3. Start the Garmin recording _before_ pressing Start Workout, and note the wall-clock time.
4. Check the Zwift Click panel counter starts climbing (`N events · N grade decisions · N shifts`).
   It polls at 1 Hz as of 2026-08-04; before that fix it only refreshed on a shift and could read
   "nothing recorded yet" through an entire healthy ride.

**During each measurement block (the two 0% sections):**

- **Hold gear index 11 / ratio 2.40** — "gear 12" in 1-based UI terms, the honest 34/14 baseline.
  This is the one hard constraint. Off baseline, our model injects its own Crr/Cw effect (§2).
- **Hold cadence as steady as you can, ~85 rpm.** `v_virt` is derived from cadence, so cadence
  _is_ our speed input; a cadence swing moves the sent grade directly.
- Shift and sit however you like on the 3%, 6% and −2% sections. Comfort there costs nothing.

You can see where you are: the metrics row shows **Gear** and **Gradient**, and Step Distance
reads `Nm (P%)`. Gradient flipping to 0% with Step Distance past ~355 m is the start of block A.

### Hands-free alternative (preferred)

Paste [`17-auto-conditions.js`](17-auto-conditions.js) into the console **before** pressing Start
Workout and the five changes apply themselves — nothing to touch after that but the pedals and the
Click. It writes exactly what Apply writes (both localStorage keys, `H.state.simPhysics`, both
`<select>`s) plus the `physicsApplied` note, applying lap N's condition when the ERG rest before
lap N begins, ~90 s clear of any measurement block.

This removes the protocol's biggest execution risk. Five manual changes mid-effort is five chances
to fumble a dropdown or miss the toast, and a silently-discarded Apply voids a whole lap that you
would only discover in the export.

Verified 2026-08-05 by driving all 13 steps through the real `skipStep` path with the BLE surface
stubbed: six `physicsApplied` notes (laps 1–6, one each, all inside the session), the four expected
Crr/Cw pairs reaching `ftms.setSim`, no change on the cool-down, and pasting the script three times
still applies each condition exactly once.

**Manual alternative:** change the presets and click **Apply** during the **90 s ERG rest step** that
follows each lap. If you miss it, the next lap's 3% opener is a second chance — anywhere in the
first 350 m is fine, since the `physicsApplied` note timestamps the moment exactly and the
analysis splits on that, not on the lap boundary. What you cannot do is change presets inside a
0% block.

Before pressing Start Workout for the protocol run, `rideLog.resetRideLog()` in the console
guarantees the export contains only this session and no earlier experimenting.

> ⚠️ **The trap:** the tyre/position change is applied by the _same_ button that validates FTP,
> rider weight and bike weight, and it `return`s early on any invalid field **before** saving the
> physics ([main.js:554-586](../../../src/js/main.js#L554-L586)). If any of those three fields is
> blank or out of range, your condition change is silently discarded. The success toast is the
> confirmation; the `physicsApplied` note in the ride log is the permanent record.

Applying mid-ride is otherwise safe: the handler re-resolves `H.state.simPhysics` and
`sendGradeFor` re-reads rider physics from storage on every call, and it does **not** call
`reloadDrivetrain`, so your current gear survives. Its `setFTP`/`setBaselineGear` calls land on the
superseded legacy `VirtualGear`, which the SIM path no longer consults.

**After:** export the ride log (Zwift Click panel → **Download ride log (JSON)**) and the Garmin
FIT. Both, from the same session.

## 7. Analysis plan (pre-registered, so it is a test and not a fishing trip)

Join ride-log `sim`/`telemetry` events to FIT records on absolute epoch timestamps. Segment by
`step` events (laps) and `note: physicsApplied` events (conditions). Then, restricted to the 0%
blocks, at held gear and cadence:

- **P1 — H31 positive.** Measured power at matched cadence rises with Crr, ≈93 W across the full
  sweep, and falls with lower Cw, ≈112 W. ⇒ The KICKR honours the bytes; fit its coefficients and
  the road model is largely identified.
- **P2 — H31 null.** Measured power is flat across all conditions within drift (judge against the
  lap-1/3/6 baseline spread, not against zero). ⇒ **The KICKR uses grade only.** Crr/Cw then affect
  nothing but our own speed/distance maths, the 0.017-vs-0.004 debate stops being about feel
  entirely, and `setSim`'s Crr/Cw arguments are documentation, not control.
- **P3 — intermediate.** An effect smaller than predicted ⇒ the trainer applies the bytes through a
  different formula or scales them; fit the exponent on `v` to tell a Crr-shaped term (∝v) from a
  Cw-shaped one (∝v³).
- **P4 — sent-grade invariance holds in the log.** `sentGradePct` in the 0% blocks should be
  essentially identical across conditions (§2 predicts within 0.07 pp). If it is _not_, the rider
  drifted off the baseline gear and those blocks must be discarded — this doubles as the
  protocol's own compliance check.
- **P5 — road-model check (next-step 3).** With grade pinned at 0% and both Crr and Cw swept, the
  trainer's reported speed-vs-power relationship is being probed at several points on one curve
  rather than one point, which is what ride 1 lacked.

The lap-1/3/6 baseline spread is the noise floor every claim above is judged against. If that
spread is itself comparable to 93 W, the session is inconclusive and the honest report is
"inconclusive".

## 8. Threats to validity, stated in advance

- **The rider is the uncontrolled input.** In SIM the trainer sets resistance and the human
  produces whatever power they produce. Cadence discipline in the 0% blocks is the only control;
  where cadence drifts, compare at matched cadence rather than by lap mean.
- **Fatigue** — mitigated by A-B-A-C-D-A, measured by the lap-1/3/6 spread, not assumed absent.
- **A single Apply failure** silently voids a lap (§6). Check the `physicsApplied` notes in the
  export before trusting any lap.
- **Trainer thermal drift** over 40 min is unquantified for this unit and confounds slow trends;
  the repeated baselines are the only defence.
- **Known latent bug, not fixed:** `setSim`'s `windMps` is scaled 0.001 m/s per the FTMS spec,
  which is believed correct, but wind is 0 throughout this protocol so it cannot matter here.

## 9. Follow-ups

- Results go to [`HYPOTHESES.md`](../HYPOTHESES.md) §E **and** the ledger in
  [`VIRTUAL_SHIFTING_DESIGN.md`](../../VIRTUAL_SHIFTING_DESIGN.md) §2.6, per the repo rule.
- If P2 (null), reopen the distance-model decision (handoff Decisions item 5) with the knowledge
  that Crr/Cw are ours alone to choose, since only our maths consumes them.
- Handoff next-step 5 (is gear 12 rideable now?) is answered as a by-product: six laps' worth of
  baseline-gear 0% and 3% blocks at Crr 0.004 is exactly that measurement.

---

## 10. RESULTS — ridden 2026-08-05

**Executed as designed.** All 6 laps, all 6 conditions applied automatically at the right
moments by [`17-auto-conditions.js`](17-auto-conditions.js), 33.2 min, 2006 events, both
archived earlier runs preserved. Lap 1 was ridden with free shifting (gears 6-20) before the
HUD existed and is excluded from the gear-12 comparisons; laps 2-6 held gear 12 throughout.

### P4 CONFIRMED — the design's central assumption held

Sent grade in the 0% blocks, by condition: **−0.003%, −0.092%, −0.042%, −0.104%**. All ≈ 0 and
all within 0.10 pp of each other across a full Crr and Cw sweep. The deadband suppressed writes
so completely that a whole lap produced **10** `sim` events. The trainer therefore received
effectively the same grade in every condition, so any power difference is attributable to the
Crr/Cw bytes alone. One causal pathway, as designed.

### P1 PARTIALLY CONFIRMED for Crr — the KICKR does honour the byte

Speed-matched within block (same 0.5 m/s trainer-speed bin, gear 12, |sent| < 0.4), Crr
0.004 → 0.020:

| Block | v bin   | Δ observed | Δ predicted |
| ----- | ------- | ---------- | ----------- |
| A     | 5.0-5.5 | +19 W      | +80 W       |
| A     | 5.5-6.0 | +190 W     | +85 W       |
| B     | 5.5-6.0 | +82 W      | +85 W       |
| B     | 6.5-7.0 | +6 W       | +104 W      |

**Positive in every bin**, mean **+74 W against +88 W predicted ≈ 84%**. Direction is
unambiguous; magnitude is consistent with the road model but scatters widely.

### Cw NOT ESTABLISHED

Cw 0.51 → 0.20 gave **−11, −35, −9, −7, +6 W** across five bins against predictions of −49 to
−98 W — mostly the right sign, roughly 5-47% of magnitude, and smaller than the scatter. Either
the trainer applies a much smaller aero coefficient than the road model, or it ignores the byte
and this is noise. **Not resolved.**

### Prediction correction — use the TRAINER's speed, not `v_virt`

§3 predicted 109 W using `v_virt` = 7.13 m/s. The trainer's own road model integrates _its own_
speed, which was 5.1-6.8 m/s, giving 80-104 W. Recomputed against the trainer's speed the Crr
result lands at 84% of prediction instead of 53%. **`v_virt` is the wrong `v` for any prediction
about trainer-side behaviour.**

### Step 3 still negative — the model does not predict ABSOLUTE power

Across all 1292 pedalling samples the road model at the trainer's reported speed gives
**MAE ≈ 120 W and negative R²** for every variant (swept, fixed, grade-only). It over-predicts
baseline power by ~63 W. Differences-in-differences (speed-matched deltas) are sound; absolute
residual comparisons are not, and an early pass that compared absolute residuals appeared to
show the opposite Crr conclusion for exactly that reason.

### Instrument validation

The Garmin FIT and the browser console's own IBD lines agree to **0.2 W on mean pedalling power**
(121.1 vs 121.3 W, n≈2300 each; quantiles within 6 W; cadence 84.2 vs 84.4 rpm). The FIT power
channel is the trainer's power.

### Two bugs this ride exposed

1. **The ride log recorded `power: 0` for every sample of every run.** `handleFtmsData` read
   `data.power`; the IBD parser emits `powerW` ([ftms.js:505](../../../src/js/ftms.js#L505)).
   One word, and the single channel the experiment measures was zeroed. **The FIT saved this
   ride; nothing in the app would have.** Fixed.
2. **The Zwift Click stops responding the moment a workout starts.** Confirmed by the rider on
   the bike and by the console log: every Click-dispatched action in the 2026-08-05 log sits at
   lines 322-342, and both workouts start at lines 640 and 1609 — **nothing from the Click after
   either**. Keyboard shifting worked throughout, which is what the ride actually used.

   ⚠️ **A first diagnosis here was WRONG and is retracted.** It claimed `ClickSettings` unmounts
   when the active view appears and its cleanup disconnects the GATT link. `AppShell` in fact
   renders **both views permanently** and hides one with CSS ([AppShell.tsx:61-66](../../../src/components/layout/AppShell.tsx#L61-L66)),
   so the panel never unmounts and that cleanup never runs. The mistake came from reading
   `document.body.innerText`, which omits CSS-hidden elements — the panel looked absent because
   it was invisible, not because it was gone. Bindings and bit decode were also checked and are
   correct (`SHIFT_DOWN: 0x100`, `SHIFT_UP: 0x1000`, matching the H18 correction).

   **Mechanism still UNKNOWN, and the log cannot settle it**: `ClickSettings` never passed
   `onLog` to `connectClick`, so not one byte of the Click path reached the console. Leading
   candidate is BLE-stack saturation from the unserialised FTMS writes below — 64 failed writes
   plus a RequestControl before every one is a lot of contention for a shared radio. Fixed for
   tomorrow: the Click now logs connect, disconnect and every dispatched action, so the next run
   discriminates a dropped link from a press that arrived and was ignored.

3. **40% of SIM grade writes never reached the trainer.** 64 of 159 failed with
   `NetworkError: GATT operation already in progress`. The FTMS Control Point had no mutex, and
   each `_writeCpAndWaitAck` is really two writes (RequestControl, then payload) with three
   independent callers — the 3 s SIM loop, ERG step transitions, and a shift's forced re-send.
   Interleaved they trip Chrome's one-op-at-a-time rule and cancel each other's pending ACK via
   "Replaced by new command". **The trainer never received 40% of the grades the app believed it
   had sent**, which is invisible from inside the app and is the most likely source of the wide
   per-bin scatter in §10. Now serialised through a promise chain, with 5 regression tests.

4. Minor: the drivetrain started in gear **13** (2.61), not the baseline 12, so the first 200 m
   of lap 1 were ridden off baseline and sending 3.32% for a 3.0% road.

### What the next run needs

- **Replication.** One lap per non-baseline condition cannot separate "the trainer honoured the
  byte" from "the rider pushed harder". Per-bin scatter reached ±190 W where the effect is ~80 W.
  Two laps per condition, or a longer 0% block.
- **Block B is not comparable to block A** — it follows the 6% climb, so the rider is recovering
  in it (73-116 W vs 172-257 W at the same grade and gear). Compare within block only, or move
  block B away from the climb.
- **Control cadence harder, or control power.** An ERG-mode variant that pins power and measures
  the _speed_ the trainer reports would remove the rider from the loop entirely and is probably
  the better experiment for H31.
