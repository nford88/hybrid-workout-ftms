# 10 — Offline, Full-Precision FIT Physics Analysis

**Date**: 2026-07-28
**Status**: Complete, with a same-day update that meaningfully improves the outlook.
Three real outdoor rides re-fit offline at full precision (`offline_fit_physics_analysis.py`,
`fitparse`/`numpy`/`scipy`), replacing the intervals.icu JS-sandbox's downsampling and coarse
discrete grid search for Method C with every valid sample and a continuous 3-parameter
(mass, Crr, Cw) optimization -- this first pass answered both of this task's open questions,
more informatively but more negatively than the sandboxed session. **A follow-up same-day
update, using the user's actual known mass (97kg) to fix that parameter instead of
free-searching it, closed most of the climb-power gap to the trainer defaults** -- see
"Update (same day): fixed-mass refit" below, which supersedes the initial free-mass
verdict as the more important result.

## Why this exists

Follow-up to `09-outdoor-stream-physics-regression.md`, whose Multi-Ride Result table (3
rides, coarse `intervals-icu-calibration-field.js`) found the HW-V8 trainer constants
beating the rider's own outdoor-fitted model on climb-only R²/MAE on **every** ride, and
flagged two unresolved confounds: (1) all 3 rides' Cw landed on the identical coarse grid
point (0.30), suggesting under-resolution rather than convergence, and (2) Method C's
fitting objective (virtual-elevation RMSE, which includes an acceleration/KE term) doesn't
match the evaluation metric used for the climb comparison (steady-state, no acceleration
term) — a possible fit-objective/evaluation-metric mismatch. This session removes both the
downsampling and the discrete grid to test whether either confound explains the negative
result, using real FIT files from Garmin-recorded outdoor rides instead of intervals.icu's
JS sandbox.

## Setup

- `fitparse` 1.2.0, `numpy` 2.0.2, `scipy` 1.13.1 (already present), `matplotlib` 3.9.4
  (installed this session for plotting).
- Three FIT files supplied by the user (from Garmin Connect activity exports), unzipped to
  a scratch directory — **never committed**, per this project's constraint on raw ride
  data.
- Script: [`offline_fit_physics_analysis.py`](offline_fit_physics_analysis.py), committed.
  Run: `python3 offline_fit_physics_analysis.py <fit1> <fit2> <fit3>`.

### FIT field inspection (done before assuming any field names, per instructions)

All 3 files are from the same Garmin device (`file_id.serial_number = 3405698318`,
`garmin_product = 3121`), sport `cycling`/`road`. `record` message fields available:
`timestamp, power, speed, enhanced_speed, altitude, enhanced_altitude, distance, cadence,
heart_rate, temperature, accumulated_power, fractional_cadence, left/right_torque_
effectiveness, left/right_pedal_smoothness, left_right_balance, position_lat,
position_long`, plus device-specific `unknown_NN` fields. **No `grade` field in any of
the 3 files** — grade is derived from altitude+distance in all cases (see below).
`enhanced_speed`/`enhanced_altitude` present and preferred over `speed`/`altitude` per the
task's instruction. Sample rate: median `dt = 1.00s` in all 3 files (a few recording gaps
up to 283-2626s, correctly skipped, not integrated across). `position_lat`/`position_long`
were read only to confirm ride identity/timezone and are **not** used in any computation
or output — never printed, plotted, or written to any output file.

### Ride-matching result

The task expected each of the 3 supplied FIT files to match one of the 3
previously-logged sandboxed rides (Ride A/B/C, `experiments/09`) by start timestamp.
**Only one did directly** — `23585214399` (2026-07-13) matches Ride A. `23515207634`
(2026-07-07) and `23491180709` (2026-07-05) don't match Ride B (2026-07-03) or Ride C
(2026-06-23), so initially these were treated as new, previously-unfit rides.

**Update, same day**: the user subsequently re-ran the coarse-grid
`intervals-icu-calibration-field.js` companion script against these exact same 3 FIT
files (not Ride B/C) and pasted the resulting `calibrationJson` for each. The pasted
`date` fields match this script's own parsed FIT timestamps **exactly**, to the second,
once a single consistent +1h (local-vs-UTC) offset is applied to all 3:

| FIT file | FIT start (UTC, this script) | Pasted `calibrationJson` date (local) | Offset |
|---|---|---|---|
| `23585214399` | 2026-07-13 15:49:01 | 2026-07-13T16:49:01 | +1:00:00 |
| `23515207634` | 2026-07-07 17:19:47 | 2026-07-07T18:19:47 | +1:00:00 |
| `23491180709` | 2026-07-05 15:46:37 | 2026-07-05T16:46:37 | +1:00:00 |

All 3 files also share the same device serial number. **This means all 3 rides now have
a genuine paired coarse-grid-vs-full-precision before/after comparison** — not just the
one that happened to match the old Ride A/B/C table. The earlier framing above (only
Ride A comparable) is superseded by the matched comparison in the next section; Ride
B/C from `experiments/09` remain genuinely different, earlier rides with no FIT file in
this batch. Rides are labeled by date throughout: **2026-07-13** (= Ride A),
**2026-07-07**, **2026-07-05**.

## What was built

`offline_fit_physics_analysis.py` mirrors `intervals-icu-power-model-chart.js`'s model and
Method A/B/C logic exactly (same formula, same regressors, same flat-segment threshold,
same climb-grade threshold), with two precision upgrades:

1. **No downsampling.** All 3 rides are 4,680–8,017 valid moving samples after filtering
   — far under the 50,000-sample threshold at which the task's instructions call for any
   downsampling at all. Every valid sample is used in every method.
2. **Method C (Chung/virtual-elevation) is a continuous joint optimization**, not a
   discrete grid. The per-sample `sinθ` solve doesn't actually depend on the running
   virtual-elevation total (`h[i-1]`) — only on that sample's own power/speed/acceleration
   and the candidate (mass, Crr, Cw) — so the whole virtual-elevation trace is a single
   `numpy` cumulative sum rather than a genuine sequential recurrence. This was verified
   against a literal port of the JS loop on synthetic data (bit-for-bit RMSE match to
   1e-10) before trusting it, then used to make `scipy.optimize.minimize` (Nelder-Mead +
   L-BFGS-B, 5 multi-start seeds, bounds mass∈[40,150]kg / Crr∈[0.001,0.02] /
   Cw∈[0.05,0.7]) practical — each optimization run takes milliseconds instead of the
   grid search's fixed combinatorial cost.
3. **Grade derivation**: none of the 3 files have a direct `grade` field, so all 3 use the
   JS scripts' fallback (centered moving-average smooth of altitude, window adapted from a
   fixed sample count to actual seconds via the measured median `dt`, then a finite
   difference against distance over a similar window) — same logic, adapted to work at
   whatever the real sample rate turns out to be rather than assuming ~1Hz.
4. **Climb-only breakout, all 4 combinations**: for `grade > 2%`, R²/MAE/residual-σ for
   {fitted, trainer} × {steady-state formula, acceleration-inclusive formula
   (`P_accel = P_steady + m·a·v`)} — this directly tests the fit-objective/evaluation-metric
   mismatch hypothesis from `experiments/09`.
5. **Closed-loop check**: first/last smoothed-altitude difference, flagged closed if
   ≤20m. All 3 rides qualify (deltas +5.7m, −5.9m, +11.9m over rides with 475-831m of
   total ascent) — **note the limitation**: only this simple elevation-closure check was
   implemented, not genuine repeated-lap-segment detection (would need matching repeated
   cumulative-distance intervals, not attempted this session; flagged as a follow-up).

## Results

### Method A (naive whole-ride regression) and Method B (flat-segment sweep)

Both degenerate on all 3 rides, same qualitative failure mode as the sandboxed session
(implausible or negative Cw):

| Ride | Method A mass/Crr/Cw | Method A verdict | Method B (n) Crr/Cw |
|---|---|---|---|
| 2026-07-13 | 54.1kg / 0.0498 / 0.011 | degenerate | (502) 0.0229 / **−0.024** |
| 2026-07-07 | 67.9kg / 0.0301 / 0.123 | degenerate | (211) 0.0227 / **−0.036** |
| 2026-07-05 | 40.3kg / 0.0845 / **−0.158** | degenerate | (436) 0.0226 / **−0.086** |

Consistent, cross-validating evidence that the naive/flat-sweep methods' collinearity
failure isn't a sandbox artifact — it reproduces at full precision on real per-second
data from a completely different data source (FIT vs. intervals.icu streams).

### Method C (Chung/virtual-elevation, continuous) — the headline result

| Ride | mass (kg) | Crr | Cw | VE-RMSE (m) | At bound? |
|---|---|---|---|---|---|
| 2026-07-13 (= Ride A) | **123.4** | 0.0046 | 0.436 | 22.4 | no |
| 2026-07-07 | **150.0** | 0.0010 | 0.182 | 93.4 | **yes (mass, Crr)** |
| 2026-07-05 | **150.0** | 0.0162 | 0.050 | 26.7 | **yes (mass, Cw)** |

**This directly answers task question #1 ("does Cw converge near 0.3-0.35, or move
somewhere else entirely once discretization is removed?") — it moves somewhere else
entirely, and drags mass with it.** Cw ranges 0.050–0.436 across the 3 rides (no
convergence at all — wider spread than the coarse grid's suspicious identical-0.30
result, not narrower), and 2 of 3 rides' mass optimum sits at the search's upper physical
bound (150kg — already an extreme total rider+bike mass).

**This is not a search-window artifact the way the sandboxed session's ±20kg mass-scan
radius was.** I verified this directly: holding Crr/Cw at their per-mass optimum (a
profile-likelihood scan), VE-RMSE for the 2026-07-07 and 2026-07-05 rides keeps improving
as mass is pushed further, past even 150kg — up to ~200-300kg before turning back up —
while Ride 2026-07-13's optimum is a genuine interior minimum around 123kg (worse both
below 80kg and above 150-200kg). Widening the mass bound wouldn't converge these two rides
on a plausible number; it would just move the boundary hit to an even less plausible mass.

**Root cause, traced analytically, not just observed**: in the Chung solve,
`sinθ = (P/v − Cw·v² − mass·g·Crr − mass·a) / (mass·g)`. As `mass → ∞`, the two
`power`-dependent terms (`P/(v·mass·g)` and `Cw·v²/(mass·g)`) vanish, leaving
`sinθ → −Crr − a/g` — **independent of power entirely**. At large mass the fit is no
longer explaining the altitude profile via measured power at all; it's using the
measured *acceleration* (which naturally correlates with real slope in outdoor riding —
speed drops climbing, rises descending) as a free proxy for slope instead. This is a
genuine degenerate direction in the virtual-elevation objective for a single,
non-power-meter-validated outdoor ride — a **stronger and more precise diagnosis** than
"the grid is too coarse to resolve Cw": the grid wasn't just imprecise, its narrow
±20kg-around-a-97kg-seed mass window was *accidentally* preventing exactly this
degenerate direction from being explored. Removing that artificial narrowing exposed a
real identifiability failure, not a converged answer the grid was too blunt to find.
Notably, **all 3 rides pass the simple elevation-closure check** (≤12m first/last
altitude delta over 475-831m of climbing) — satisfying the classical Chung-method route
closure criterion does **not**, on this evidence, rescue the joint fit from this
degeneracy.

#### Matched coarse-grid comparison, all 3 rides (added post-hoc — see "Ride-matching result" above)

The user separately re-ran the coarse-grid `intervals-icu-calibration-field.js`
companion script against these same 3 FIT files and pasted the resulting
`calibrationJson`. This gives a genuine paired before/after comparison for **all 3**
rides, not just the one (2026-07-13) that happened to match the old Ride A/B/C table:

| Ride | Coarse mass/Crr/Cw | Coarse whole-R² (fit/trainer) | Coarse climb n / MAE (fit/trainer) | Continuous mass/Crr/Cw | Continuous whole-R² (fit/trainer) | Continuous climb n / MAE (fit/trainer) |
|---|---|---|---|---|---|---|
| 2026-07-13 | 97.0 / 0.011 / 0.30 | −1.978 / −1.175 | 151 / 99.8W / 93.4W | 123.4 / 0.0046 / 0.436 | −0.427 / −0.099 | 4149 / 65.9W / 53.5W |
| 2026-07-07 | 101.2 / 0.011 / **0.60†** | −1.885 / −0.665 | 154 / 89.1W / 78.4W | **150.0‡** / **0.0010‡** / 0.182 | −4.793 / −0.203 | 2457 / 67.8W / 47.3W |
| 2026-07-05 | 93.2 / 0.011 / 0.30 | −2.216 / −1.959 | 142 / 128.8W / 125.4W | **150.0‡** / 0.0162 / **0.050‡** | −4.274 / −0.461 | 2850 / 122.7W / 56.7W |

† at the coarse grid's own `CW_MAX=0.60` upper bound — an unflagged boundary hit (the
JS script's `massScanAtBoundary` diagnostic only checks mass, not Cw, a limitation of
that script worth noting for any future revision). ‡ at this script's physical bound,
as discussed above.

Two things this comparison adds beyond the single-ride comparison above:

- **The coarse grid's narrow, seed-centered mass window (±20kg around a ~97-101kg
  seed) produced physically plausible masses on all 3 rides (93-101kg) where the
  continuous optimizer's much wider, still-physical [40,150]kg bound found 2 of 3
  pushed all the way to its edge.** This is consistent with — not contradicting — the
  root-cause finding above: the narrow window didn't correctly resolve the true
  optimum, it happened to sit near enough to a locally-reasonable answer that its
  bias (toward the seed) accidentally acted as a regularizer against the degenerate
  high-mass direction. Whether "coarse-but-plausible" or "precise-but-degenerate" is
  more useful depends entirely on whether the seed itself was trustworthy — it wasn't
  independently verified (see Assumptions).
- **Ride 2026-07-05 is the clearest illustration of this trade-off.** The coarse grid's
  physically-plausible fit (93.2kg) produced a climb MAE (128.8W) nearly competitive
  with the trainer constants (125.4W, only a 3.4W gap) — whereas the continuous
  optimizer's lower-VE-RMSE-but-boundary-degenerate fit (150kg) produced a climb MAE
  (122.7W) against a trainer MAE of just 56.7W, a 66W gap. (Sample counts differ, 142
  vs. 2850, since the coarse script's own downsampling limits its climb subset — not a
  perfectly apples-to-apples n, but the direction is unambiguous.) **The optimizer that
  more precisely minimizes its own fitting objective (VE-RMSE) is not the one that
  produces the more useful power-prediction model** — direct, ride-level evidence that
  chasing a lower VE-RMSE without a plausibility constraint on mass actively hurts the
  real target metric (climb power prediction), not just a theoretical concern.

### Climb-only breakout — both evaluation variants (task question #2)

`grade > 2%`, all 4 combinations:

| Ride | fitted steady MAE/R² | trainer steady MAE/R² | fitted accel MAE/R² | trainer accel MAE/R² |
|---|---|---|---|---|
| 2026-07-13 | 65.9W / −0.311 | **53.5W / 0.076** | 72.8W / −0.794 | **58.4W / −0.215** |
| 2026-07-07 | 67.8W / −1.293 | **47.3W / −0.160** | 72.5W / −1.795 | **49.9W / −0.415** |
| 2026-07-05 | 122.7W / −3.033 | **56.7W / −0.078** | 139.4W / −5.097 | **68.6W / −0.950** |

**The HW-V8 trainer constants beat the rider's own full-precision-fitted model on
every ride, on both R² and MAE, under BOTH the steady-state formula AND the
acceleration-inclusive formula.** This directly tests and **refutes** the
fit-objective/evaluation-metric-mismatch hypothesis as the (sole) explanation: if that
mismatch were the real cause, evaluating with the same acceleration-inclusive formula
Method C actually optimizes against should have closed the gap, or at least narrowed it.
Instead the fitted model's MAE gets *worse* under the accel-inclusive formula on all 3
rides (real transient noise the accel term adds is not compensated by a better-fitting
base model), and the gap to the trainer model's MAE widens or stays similar in every
case. The trainer model's own accel-inclusive R² also drops (as expected — the
steady-state formula is what the app actually sends, so that comparison, not the
accel-inclusive one, is what matters for DESIGN §4.9's real question) but it still
comfortably beats the fitted model in both variants.

**Notable partial improvement, Ride 2026-07-13 (the one with a genuine interior mass
optimum, and the one directly comparable to the prior sandboxed run)**: full-precision
fitting materially improved the outdoor model versus the sandboxed coarse-grid version —
climb MAE 99.8W → 65.9W, R² −0.945 → −0.311 (see `experiments/09`'s Multi-Ride table for
the coarse-grid numbers). **This is real, meaningful progress from removing the
downsampling and grid discretization** — but the trainer model still wins outright on
this ride too (53.5W MAE, and the *only* positive climb R² of any model/ride/formula
combination in this whole analysis: 0.076). The other two rides, whose Method C fit hit
the mass boundary and is therefore not physically trustworthy, show no such improvement
(122.7W MAE on 2026-07-05 is worse than any of the 3 sandboxed rides' fitted MAE).

## Update (same day): fixed-mass refit using a real known weight

The user provided their actual mass — 89kg rider + 8kg bike = **97kg total** — which
was not available earlier in this session (the 97.0kg used above was only a *search
seed* for a still-free optimizer, not a locked value; that's why it still drifted to
150kg on 2 of 3 rides). `offline_fit_physics_analysis.py` gained a `--fixed-mass=<kg>`
flag that holds mass constant and re-fits only Crr/Cw via the same continuous
optimizer, directly testing the #1 follow-up identified above.

| Ride | Free-mass Crr/Cw | Fixed-mass (97kg) Crr/Cw | Free-mass climb MAE (fit/trainer) | Fixed-mass climb MAE (fit/trainer) |
|---|---|---|---|---|
| 2026-07-13 | 0.0046 / 0.436 | 0.0162 / 0.252 | 65.9W / 53.5W (−12.4W) | 54.3W / 53.5W (−0.8W) |
| 2026-07-07 | 0.0010 / 0.182 (at bound) | 0.0152 / 0.050 | 67.8W / 47.3W (−20.5W) | **40.9W / 47.3W (+6.4W — fitted wins)** |
| 2026-07-05 | 0.0162 / 0.050 (at bound) | 0.0200 / 0.259 | 122.7W / 56.7W (−66.0W) | 58.1W / 56.7W (−1.4W) |

**This is the single largest result of this whole investigation.** Fixing mass at a
real, independently-known value:

- **Eliminated the mass-boundary degeneracy entirely** (`at_boundary` no longer applies
  to mass on any ride, by construction).
- **Collapsed the climb-MAE gap to the trainer constants from 12–66W down to under
  7W on every ride**, and the fitted model now **wins outright on 2026-07-07** (both
  lower MAE and higher R²: +0.004 vs the trainer's −0.160).
- **Converged Crr to a tight, physically sensible range** (0.0152–0.0200, mean 0.0171,
  ~5x tighter relative spread than the free-mass Crr) — real road-tire rolling
  resistance genuinely is higher than the trainer's smooth-flywheel assumption
  (0.004), and this is the first time that's shown up consistently across rides
  rather than as an artifact of a runaway mass search.
- **Did not converge Cw** — it's still 0.050–0.259 across the 3 rides even with mass
  fixed, so Cw remains the least-resolved parameter. This matches the mechanistic
  expectation: the root-cause analysis above showed the *mass* dimension was the
  specific source of the degenerate direction, not Cw directly — fixing mass was
  never expected to fully resolve Cw on its own.
- As expected, the fixed-mass fit's own VE-RMSE is *worse* than the free-mass fit's on
  every ride (e.g. ride 2026-07-07: 93.4m free vs. 131.8m fixed) — the free optimizer's
  lower VE-RMSE was achieved by exploiting the acceleration-driven shortcut, not by
  genuinely explaining the ride better. This is further direct confirmation of the
  earlier finding that a lower fitting-objective value does not imply a better
  predictive model.

**Revised headline verdict**: personalized calibration is no longer a clear loss — it's
now roughly competitive with the fixed trainer defaults (statistically tied on 2 of 3
rides, ahead on 1 of 3) **once mass is supplied from an independent source rather than
fitted**. This does not yet mean it's ready to ship (n=3 rides, Cw still unresolved,
and "roughly tied" isn't "clearly better"), but it substantially upgrades the outlook
from `experiments/09`'s and this file's earlier "currently negative" framing. The
clear next step is more rides at fixed mass to see whether Cw converges the way Crr
just did.

## Cross-ride synthesis

| Ride | Continuous mass (kg) | Crr | Cw | Coarse-grid mass/Crr/Cw (same ride, see above) |
|---|---|---|---|---|
| 2026-07-13 | 123.4 | 0.0046 | 0.436 | 97.0 / 0.011 / 0.30 |
| 2026-07-07 | 150.0† | 0.0010† | 0.182 | 101.2 / 0.011 / 0.60‡ |
| 2026-07-05 | 150.0† | 0.0162 | 0.050† | 93.2 / 0.011 / 0.30 |

† at this script's physical search bound — not a trustworthy point estimate, see
root-cause analysis above. ‡ at the coarse script's own grid bound — also not fully
trustworthy, though unflagged by that script's own diagnostics.

**Combined estimate (mean ± std across all 3 rides, reported honestly per this project's
uncertainty-disclosure convention — not to be read as a converged answer)**:
mass = 141.1 ± 12.6 kg, Crr = 0.0073 ± 0.0065, Cw = 0.223 ± 0.160. The spread on Crr and Cw
is enormous relative to the mean (Crr coefficient of variation ~89%, Cw ~72%) — **this is
not a usable personalized-calibration output**, and averaging it into a settings file
would be actively worse than doing nothing, per this project's convention against
presenting a confident average that overstates how settled the numbers are.

**Does Cw converge once discretization is removed? No — the opposite.** The old Ride
A/B/C table's identical Cw=0.30 across 3 (different) rides (a red flag for
under-resolution, per `experiments/09`) is not repeated exactly on this batch's own
coarse-grid companion run either — Cw came back 0.30/0.60/0.30, with the 0.60 sitting at
that script's own grid bound — but it's still just 2 distinct values across 3 rides, a
narrower spread than the wide range full precision then produced (0.050–0.436). Full
precision did not reveal a hidden true Cw the grid was too blunt to find; it revealed
that a single ride's VE-RMSE objective doesn't pin down Cw (or mass, or Crr) reliably at
all — and, per the matched comparison above, the coarse grid's narrowness may have been
accidentally protective (steering the fit away from the degenerate high-mass direction)
rather than merely imprecise.

**Headline verdict — does the fitted-average model beat the HW-V8 trainer constants on
climb-only R²/MAE? No, on every ride, on both evaluation formulas.** This is a confirmed
negative result, consistent with (and strengthening) `experiments/09`'s finding. The two
confounds `experiments/09` flagged as unresolved are now substantially disentangled:

1. **Grid coarseness**: ruled out as the (sole) explanation. Removing it didn't converge
   Cw to a better value — it exposed a genuine non-identifiability that the coarse grid's
   narrow mass window had accidentally been masking.
2. **Fit-objective/evaluation-metric mismatch**: ruled out as the (sole) explanation. The
   acceleration-inclusive evaluation, which matches Method C's actual fitting objective,
   still loses to the trainer constants on every ride.
3. **The remaining, best-supported explanation**: a single outdoor ride's power/speed/
   altitude stream, fit via the Chung virtual-elevation method without an independent
   power-meter cross-check or a genuinely closed/repeated-segment route, does not reliably
   identify (mass, Crr, Cw) as a real physical triple — the objective has a degenerate
   direction (traced analytically above) that a continuous optimizer will find and a
   coarse grid will only avoid by accident. This is a methodological limitation of
   single-ride Chung fitting for this rider's data, not evidence that personalized
   calibration is impossible in principle — likely mitigations (untested this session,
   see Follow-ups) include fitting jointly across multiple rides simultaneously (shared
   mass/Crr/Cw, many altitude profiles constrain the degenerate direction differently per
   ride) or holding mass fixed at an independently-known value (a smart scale reading, per
   the JS scripts' `icu.wellness.weight` source) rather than treating it as a free
   Chung-fit parameter at all.
4. **A subtler point, from the matched coarse-vs-continuous comparison above**: minimizing
   the fitting objective (VE-RMSE) more precisely is not the same as producing a better
   power-prediction model. Ride 2026-07-05's continuous fit achieves a *lower* VE-RMSE
   than any grid point the coarse script could reach, yet its climb MAE gap to the
   trainer constants (66W) is far wider than the coarse-grid fit's gap on the same ride
   (3.4W). A search that optimizes VE-RMSE without a plausibility constraint on mass can
   make the fit-quality number look better while making the thing that actually matters
   (climb power prediction) worse — a caution against treating VE-RMSE alone as the
   success metric for any future personalization method, continuous or discrete.

## Plots

Not committed — this project's convention (per `experiments/07`'s handling of an
external chart) is findings transcribed as data/prose, not binary image files; no image
has ever been committed under `experiments/`. Regenerate locally any time by re-running
`python3 offline_fit_physics_analysis.py <fit files>` (writes PNGs alongside the script,
gitignored) — the analysis itself doesn't depend on having the images on hand, only the
numbers already transcribed throughout this doc.

- **Power-vs-grade curve + residual scatter**, per ride: binned power-vs-grade (measured/
  fitted/trainer) and residual-vs-grade scatter. Confirmed visually that ride 2026-07-07
  (the one where the fitted model wins on MAE) tracks the measured curve closely across
  nearly the whole grade range, consistent with its numeric result.
- **Virtual-elevation profile overlay**, per ride: actual (smoothed) altitude vs. the
  Chung-fitted virtual-elevation trace — a standard aero-testing diagnostic
  (GoldenCheetah/AeroLab), new this session. Ride 2026-07-13's overlay tracked the real
  profile closely (RMSE 22.4m over a ride with ~500m of net climbing on its main ascent)
  — visual confirmation that a genuine, well-behaved interior optimum produces a
  materially better-looking fit than a boundary-degenerate one; the other two rides'
  overlays were visually worse despite comparable or lower RMSE numbers, consistent with
  those fits using the acceleration-driven degenerate shortcut described above rather
  than genuinely explaining the profile via power.
- **Cross-ride comparison**: mass/Crr/Cw per ride + mean±std, vs. the HW-V8 trainer
  constants — the bar-chart form of the tables already in this doc.

No raw per-second data, GPS coordinates, or FIT files are included in any of the above —
aggregate curves and fitted numbers only.

## Assumptions made explicitly (per this task's autonomous-work instruction)

- **Rider mass seed for Method C** (97.0kg) — intervals.icu's `icu.wellness.weight` isn't
  available from a bare FIT file (no rider/bike mass field exists in the FIT record
  schema), so the optimizer was seeded from this project's own prior Method C results
  (98.2kg, 98.0kg from `experiments/09`'s two chart-script runs) rather than a generic
  default. This only affects which local optimum a given seed lands in for the
  non-monotonic ride (2026-07-13); it does not affect the boundary-hitting rides, whose
  RMSE improves monotonically well past any reasonable seed.
- **Closed-loop detection** implemented as a simple first/last-altitude check only, not
  genuine repeated-lap-segment detection — documented as a limitation, not attempted this
  session (would require matching repeated cumulative-distance intervals within a ride).
- **Ride-to-known-ride matching** used calendar-date equality (allowing a same-day UTC/
  local offset), not exact-hour matching, when first checked against `experiments/09`'s
  old Ride A/B/C table — the FIT `timestamp` field is UTC and intervals.icu's
  `start_date_local` is local wall-clock. This correctly found only 1 of 3 matches
  against that specific table; a subsequent user-supplied coarse-grid run against these
  same 3 FIT files (not Ride B/C) confirmed all 3 to the second via a consistent +1h
  offset, superseding the earlier "only one match" framing — see "Ride-matching result"
  and the matched-comparison table under Method C above.

## Confidence

**CONFIRMED**: FIT field names and the absence of a direct `grade` field, verified by
inspecting the first several `record` messages per file before assuming any schema (per
this project's "verify API fields, don't guess" discipline) — not carried over from the
intervals.icu field-name assumptions.
**CONFIRMED**: the vectorized Method C implementation matches a literal port of the JS
loop's semantics bit-for-bit on synthetic data (verified directly, not assumed from the
refactor being "obviously equivalent").
**CONFIRMED**: Method A/B degenerate on all 3 rides (implausible or negative Cw), same
qualitative failure as the sandboxed session, on an independent full-precision dataset.
**CONFIRMED**: Method C's mass/Crr/Cw do not converge across rides at full precision —
Cw spans 0.050-0.436, wider than the coarse grid's suspicious identical-0.30 result.
**CONFIRMED**: 2 of 3 rides' Method C fit hits the mass search's upper physical bound
(150kg), and this is a genuine unconstrained-optimum behavior (verified via a
profile-likelihood mass scan out to 1000kg), not a narrow-search-window artifact.
**CONFIRMED**: the HW-V8 trainer constants beat the fitted model on climb-only MAE/R² on
all 3 rides, under both the steady-state and acceleration-inclusive evaluation formulas —
directly refuting the fit-objective/evaluation-metric-mismatch hypothesis as a sufficient
explanation on its own.
**INFERRED, high confidence**: the root cause of the non-identifiability is the
`sinθ → −Crr − a/g` degenerate direction as mass→∞ (derived analytically from the Chung
solve's own equation and consistent with the observed monotonic-then-plateauing RMSE
profile), meaning the fit can substitute measured acceleration for measured power at
implausible mass values. Not independently confirmed by, e.g., a controlled synthetic-data
experiment with a known ground-truth mass this session (a natural follow-up, see below).
**Still UNKNOWN**: whether a multi-ride joint fit (shared parameters, multiple altitude
profiles constraining the degenerate direction differently per ride) or a mass-held-fixed
variant would resolve the non-identifiability — untested this session.
**CONFIRMED**: all 3 FIT files match a user-supplied coarse-grid companion run's
timestamps exactly (to the second, after a consistent +1h offset), giving a genuine
paired coarse-vs-continuous comparison for all 3 rides, not just the one that matched
the older Ride A/B/C table.
**CONFIRMED**: on the one ride (2026-07-05) where the coarse grid's narrow mass window
and the continuous optimizer's wide bound diverge most (93.2kg vs. 150kg), the
continuous fit's *lower* VE-RMSE corresponds to a *worse* climb-power prediction (66W
trainer-gap vs. the coarse fit's 3.4W gap) — direct evidence that minimizing the fitting
objective more precisely does not imply a better predictive model here.

## Follow-ups

- **DONE (same day, see "Update" section above)**: holding mass fixed at a real known
  value (97kg) and fitting only Crr/Cw resolved the mass-boundary degeneracy and
  converged Crr to a tight range — but did **not** converge Cw, which is still
  0.050-0.259 across the 3 rides. Cw remains the open parameter.
- **New highest priority**: repeat the fixed-mass fit on more rides (5+) to see whether
  Cw converges with a larger sample the way Crr already has, and/or whether the
  remaining Cw spread is real ride-to-ride variation (wind, position) vs. still some
  residual under-identification.
- **Closely related, cheaper to try first**: tighten the mass *bound* itself (e.g. to a
  literature-plausible ±15-20kg around an independently-known weight) rather than the
  generous [40,150]kg physical bound used this session — the matched comparison above
  shows the coarse grid's narrow, seed-centered window produced more plausible numbers
  on all 3 rides than the wide-but-physical bound did, even though the mechanism was a
  side effect (an under-explored search space) rather than a deliberate regularizer. A
  deliberately narrow, principled bound might capture that same benefit without the
  coarse grid's discretization cost.
- Test a genuine multi-ride joint fit (shared mass/Crr/Cw across all rides' VE-RMSE
  simultaneously) — a real methodological upgrade over any per-ride fit, whether coarse or
  continuous, and directly suggested by this session's own finding that per-ride fits are
  underdetermined.
- Validate the root-cause claim with a synthetic-data experiment: generate a ride with
  known ground-truth mass/Crr/Cw plus realistic acceleration noise, confirm the continuous
  optimizer reproduces the degenerate direction, and check whether fixing mass eliminates
  it in that controlled setting before trusting the fix on real data.
- Implement genuine repeated-lap/closed-segment detection (beyond the simple first/last
  altitude check used here) if more rides with actual repeated segments become available.
- Collect more of this rider's outdoor rides (ideally with an independent power meter or
  known scale-measured mass) to test whether the multi-ride joint fit converges where
  per-ride fits don't.
