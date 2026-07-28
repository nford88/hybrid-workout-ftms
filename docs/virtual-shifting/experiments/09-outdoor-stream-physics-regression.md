# 09 — Outdoor Per-Second Stream Physics Regression

**Date**: 2026-07-28
**Status**: **Run twice (two different rides), real numbers in hand from both. Climb-only
breakout, a rebuilt curve chart, and a copy-pasteable calibration JSON all added this
session but not yet executed — pending a third run.**

**The actual end-to-end workflow this tooling serves (clarified by the user this
session, superseding any narrower framing below)**: the user runs this chart against
~5 of their own rides in intervals.icu, copies the small `calibrationJson` line each
run prints, and pastes all ~5 into a chat with an AI (this project). The AI averages
the rides' fitted mass/Crr/Cw (and fit-quality numbers, to weight or sanity-check the
average) into one settings file — the rider's personalized calibration, matching
DESIGN §4.9's "path to generalization" question about how a rider's fitted numbers get
into the app. **Not yet exercised**: no 5-ride average has been performed; this file
documents the tooling that a real multi-ride pass will use, not a completed
calibration.

**A real usability blocker surfaced once the chart actually rendered correctly**: the
`calibrationJson` line lives in the Plotly chart *title*, which renders as SVG `<text>`
— not normal, reliably copy-pasteable HTML text in every browser. The fix is a second
file, [`intervals-icu-calibration-field.js`](intervals-icu-calibration-field.js), using
a *different* intervals.icu JS extension point ("Computed Activity Fields," type Text)
whose entire purpose is producing a plain value attached to the activity, displayed in
the normal activity-summary UI — ordinary text, not part of a chart image. It
deliberately duplicates the fitting logic (Methods A/B/C, climb stats, the
`calibrationJson` shape) from the chart script, since intervals.icu's JS extension
points can't import or share code with each other; the two files' config constants and
JSON shape must be kept in sync by hand. **Not yet run** — same status as everything
else this session.

The script hit two infrastructure bugs on the way to a first working run — a Java/JS
interop type error, then a sandbox memory-limit failure requiring several rounds of
cutting the search space — both fixed (see design-decisions section). That first run's
chart also rendered illegibly (wide-short container mismatch with a stacked-subplot
layout); fixed to side-by-side. A second run (different ride) surfaced a real
methodological bug in Method C's mass-refinement step — also fixed this session (see Task 2
analysis below). Once that second run's chart was actually legible, its own scatter panel
turned out to be low-value (a diffuse, hard-to-read point cloud that confirmed "fits
badly" without showing why) — replaced with a binned power-vs-grade curve (measured vs.
both models, overlaid) that directly shows whether the fitted curve tracks reality. The
climb-only R²/MAE/residual-std breakout (added per DESIGN §4.9's actual validation
question — whole-ride R² is dominated by descents, where riders coast and the
steady-state formula has no coasting term) and the calibration-JSON summary line are
both new this session and **have not been exercised against real data yet** — next step
is a third run.

## Why this exists

Follow-up to `06-hw-v7-v8-mass-regression.md` (trainer-side regression: fixed gear/fixed
cadence, `m_t=93.3kg`, Crr/Cw sent as 0.004/0.51, R²=0.9999) and
`07-outdoor-ride-power-grade-comparison.md` (first outdoor cross-check, but only
0.5%-grade-binned power averages — no speed data, so it could only compare shapes, not fit
the model). Test matrix item 33 asks for a genuine controlled physics cross-check against
real outdoor data; item 33's own text notes the July session's attempt at this (a
3-parameter least-squares fit `P = A·(grade/100)·v + B·v + C·v³` across 53 points derived
from 0.5%-binned power+cadence data, using the rider's stated fixed gear/wheel size to
back out speed from cadence) **failed informatively**: `corr(grade, v) = -0.96` across the
dataset, because in a fixed gear, cadence necessarily drops as grade rises — the
regression couldn't separate "power needed for grade" from "power needed for speed," and
returned nonsense (negative Cw, 25-53kg "mass"). Fixing Crr/Cw to literature values and
solving mass alone gave a mass estimate that drifted hard with grade band (143kg at
3-5% → 96kg at 10-11.5%), which is the real finding from that attempt: a
fixed-mass/fixed-Crr/fixed-Cw model doesn't cleanly explain 0.5%-binned outdoor averages.

Raw per-second stream data has two things the binned averages didn't: ~100x more points,
and enough natural noise (pacing variation, wind gusts, brief coasting, transient
accelerations) to partially decorrelate grade from speed within a single climb. This
session's deliverable pulls that raw stream via **intervals.icu's Custom Activity Chart
JS extension point** (runs server-side inside the user's own authenticated session — no
API key needed, sidestepping that whole concern) and applies three complementary fitting
methods instead of the one collinearity-doomed regression tried before.

## What was built

**File 1**: [`intervals-icu-power-model-chart.js`](intervals-icu-power-model-chart.js) —
paste the whole file into Settings → Custom Activity Charts in intervals.icu. It re-runs
per activity viewed (one chart per ride, as requested), reading `icu.streams.{time,
watts, velocity_smooth, grade_smooth, altitude, distance, moving}`,
`icu.wellness.weight`/`icu.athlete.weight`/`icu.activity.icu_weight` for a mass estimate.
Field names are taken verbatim from intervals.icu's own generated TypeScript data model
(`github.com/intervals-icu/js-data-model`, `dist/index.d.ts`), fetched and read directly
this session — not guessed, per the explicit instruction not to trust possibly-stale
training-data field names.

**File 2**: [`intervals-icu-calibration-field.js`](intervals-icu-calibration-field.js) —
paste into a new **Computed Activity Field** (type: Text) instead of a chart. Setup: must
be done from an actual activity's page, not a generic Settings page in isolation —
testing a field script requires an activity context to evaluate against (confirmed from
intervals.icu's own docs: "click the play button to execute your script in the context
of the selected activity to test"; a first attempt without that context threw
`activityId is required`, an intervals.icu platform message, not a bug in the script).
The documented path is the **"Custom"** section under an activity's timeline chart.
Produces the exact same `calibrationJson` as File 1's chart title, but as the field's
stored value — displayed as plain text in the activity summary UI, not as part of an SVG
chart, specifically so it can actually be copy-pasted.

**MODEL logic is kept in sync manually** with File 1 (there is no way to share code
between intervals.icu's JS extension points) — but its **performance-tuning constants
deliberately do NOT match** File 1's. A real run hit `Memory limit exceeded` even though
File 1's chart, sharing the identical already-fixed single-pass downsampling, renders
fine at `MAX_FIT_SAMPLES=800` / a 165-combo grid. Computed Activity Fields are plausibly
evaluated in bulk (e.g. during sync, across many activities) rather than on-demand for
one viewed activity, and likely get a tighter resource budget as a result — unconfirmed,
but consistent with the evidence, and the safest assumption without more information.
Cut to `MAX_FIT_SAMPLES=300` and a 6×6=36-combo Crr/Cw grid (chart: 15×11=165) — roughly
15x cheaper per grid-search call than the chart's own already-working configuration.
**Not yet re-verified** whether this is enough headroom, or still too much.

### Three fitting methods, in increasing order of how well they handle the collinearity problem

1. **Method A — naive whole-ride 3-parameter regression.** Exactly this session's earlier
   failed approach (`P = m·g·sinθ·v + m·g·Crr·cosθ·v + Cw·v³`, solved via ordinary least
   squares, no intercept), but on real per-second-ish data instead of 0.5%-grade bins. This
   satisfies the task's fallback instruction ("at minimum redo this session's regression
   with real per-second data... report the new grade/speed correlation coefficient"). The
   script reports `corr(grade%, speed)` for the actual ride alongside the fit, and flags
   the fit **degenerate** if the implied mass/Crr/Cw fall outside plausible physical bounds
   (mass ∉ [40,150]kg, Crr<0, Cw<0) — the same red flags that exposed the earlier failure.
2. **Method B — flat-segment sweep.** Filters to samples where `|grade| < 0.5%`, where the
   grade term is negligible and `P ≈ m·g·Crr·v + Cw·v³` — a real aerodynamics-testing
   technique (isolates Cw from a speed sweep at constant near-zero grade), independent of
   any climbing data or its grade/speed collinearity.
3. **Method C — approximate Chung "virtual elevation" method.** The one built specifically
   to break the collinearity structurally rather than statistically: for a candidate
   `(mass, Crr, Cw)`, it solves `sinθ` **per sample** from that sample's own power, speed,
   and measured acceleration (not from a regression across samples against grade), then
   integrates `v·sinθ·dt` into a virtual elevation profile and compares it to the ride's
   actual altitude stream. A two-round coordinate-descent grid search (Crr×Cw at an
   assumed mass → refine mass → refine Crr×Cw again) picks the parameters whose virtual
   elevation best matches reality. Because each sample's slope is solved independently from
   that instant's own physics, this method does not depend on grade and speed varying
   independently across the dataset the way a cross-sample regression does — it is the
   established real-world technique for exactly this problem (used by GoldenCheetah/AeroLab
   for CdA/Crr testing), implemented here as a practical coordinate-descent approximation
   rather than a from-source port of any specific published implementation.

The three methods feed a fallback chain (`veResult → flatFit → naive-if-plausible → none`)
so the chart still renders a best-effort "fitted model" line even on rides missing an
altitude stream, while being explicit in the on-chart annotation about which method won.

### Chart output

A single Plotly figure, **side-by-side subplots** (revised from an initial stacked-row
layout after the first real run rendered illegibly in intervals.icu's wide-and-short
container — see design-decisions section):
- **Left — power-vs-grade curve** (revised from an initial measured-vs-predicted scatter
  that a real run showed to be a diffuse, ~800-point cloud confirming "fits badly" without
  showing why): grade binned into `CURVE_BIN_PCT`-wide buckets (default 1%, dropping bins
  with fewer than `CURVE_MIN_BIN_SAMPLES` samples), three overlaid lines — measured average
  power, the outdoor-fitted model's average predicted power, and the HW-V8 trainer
  constants' (`m=93.3kg, Crr=0.004, Cw=0.51`) average predicted power, each forward-run
  through the FTMS **steady-state** formula (`VIRTUAL_SHIFTING_DESIGN.md §4.3`, no
  acceleration term — deliberately, since that's what the app's drivetrain design actually
  sends to a trainer). Directly shows whether either model's curve tracks the real one.
- **Right — residual vs. grade**: unchanged from the original design; a real run showed
  this concentrates heavily below 0% grade (coasting, the steady-state formula's known
  blind spot) and tightens above ~2-3% (climbing) — kept because it was genuinely
  diagnostic, unlike the scatter it replaced alongside.
- **Title** (4 lines, revised — see "Real bug found and fixed" below): the main title;
  the winning method's fitted mass/Crr/Cw vs. the HW-V8 trainer reference; a whole-ride
  R² / climb-only breakout / grade-speed-correlation summary line; and a monospace
  `calibrationJson` line — `{date, method, massKg, crr, cw, massScanAtBoundary,
  wholeRideR2, climb, corrGradeSpeed, samples}` — meant to be copied directly out of the
  chart and pasted into a chat, one per ride, for the multi-ride averaging workflow
  described at the top of this file.

**Real bug found and fixed this session**: the first version put the R²-summary and
`calibrationJson` text in two footer *annotations* positioned via `yref:'paper', y:-0.4`
and `y:-0.56`. A real run confirmed they never appeared at all — only the title and
legend rendered. Root cause: annotation `y` in `yref:'paper'` is a *fraction of the
plot's own axis height*, not a fixed pixel offset, and this chart's actual rendered axis
height turned out far taller (that run's exported image was 1384px tall) than the
~500px this was tuned against — so the same fractional offsets landed hundreds of
pixels outside the fixed `margin.b` pixel budget and were clipped. The legend, by
contrast, rendered fine at a similarly negative `y` — Plotly auto-reserves canvas space
for a legend, but not for arbitrary annotations placed outside the declared margin.
**Fixed** by moving all of that text into the chart title instead (proven reliable —
a 2-line title rendered correctly in that same run) and dropping the `annotations` array
and its `margin.b` allocation entirely.

### Design decisions worth recording

- **`icu.stats.calcCenteredMovingAvg` is not used, despite being documented and initially
  used in an earlier draft** — first real-world run threw
  `TypeError: invokeMember (calcCenteredMovingAvg) ... Cannot convert 'Double' to Java type
  'float': Invalid or lossy primitive coercion`. The host function is backed by a Java
  method taking a `float[]` parameter; GraalJS's polyglot interop refuses to auto-narrow
  our computed (block-averaged) JS doubles to Java `float`, even though the TS types
  declare plain `number[]`. Fixed by reimplementing centered-moving-average as pure JS
  (`centeredMovingAvg` in the script) so no JS-computed array ever crosses the Java
  interop boundary as a function argument — only stream data read *from* `icu.streams`
  crosses that boundary, which is the safe direction. Worth remembering for any future
  intervals.icu script: passing derived/computed numbers into a documented `icu.*` helper
  is not guaranteed as safe as reading `icu.streams.*` directly, regardless of the
  TypeScript type declarations.
- **Single-pass streaming aggregation, not a materialized index array** — the second
  real-world run hit `Memory limit exceeded` before producing a chart. The likely cause in
  the draft at that point: it built a full-length `idx` array of every valid raw-stream
  index across the *entire* ride before downsampling, plus a temporary sub-array per
  downsample block via `.map()` (4 of them, per block). For a long enough activity that's
  real memory pressure in a memory-constrained sandbox, not just extra CPU — `MAX_FIT_SAMPLES`
  only bounded the *output* arrays, not the intermediate ones. Fixed by rewriting the whole
  filter+downsample step as one forward pass with scalar accumulators (sums and counts, no
  per-block arrays) that flushes a downsampled sample every `stride` valid raw samples —
  memory use is now bounded by the output size (`MAX_FIT_SAMPLES`) regardless of how long
  the source ride is, with no intermediate structure scaling with raw ride length at all.
- **The memory limit persisted even after that fix**, on a third run — meaning the raw
  index array wasn't the only (or wasn't the) cause. Rather than continue guessing blind
  (no stack trace or memory figure was available from the sandbox, only the bare error
  string), the response was to aggressively cut every remaining scaling knob at once:
  `MAX_FIT_SAMPLES` 2500→800; the Crr×Cw grid 29×26=754 combos→15×11=165; the two-round
  coordinate descent (grid → mass refine → grid again) collapsed to one round (grid → mass
  refine, done); and `icu.streams.distance` is now read lazily (only inside the
  grade-derivation fallback, not unconditionally up front) in case merely *accessing* a
  stream property forces the platform to materialize/compute it server-side. Combined,
  this is roughly a 25-30x cut in total grid-search inner-loop iterations versus the
  version that failed. All of these are named constants at the top of the script
  specifically so they can be raised again if a real run turns out to have more headroom
  than these conservative defaults assume — but the defaults now favor "produces a chart
  at reduced fit resolution" over "fails outright."
- **CPU-bounding**: intervals.icu's own docs warn that `icu.stats.piecewiseLinearRegression`
  risks exceeding script CPU limits at just 2 breakpoints and 500 points — the sandbox's
  budget is evidently tight. The Chung grid search avoids transcendental function calls in
  its hot loop (the `sinθ` solve is pure arithmetic; `asin`/`tan` are only needed once, at
  the end, for display — and even then replaced by the algebraic identity
  `tan(asin(x)) = x/√(1−x²)` where used) and downsamples via block-averaging to a
  configurable `MAX_FIT_SAMPLES` (default 800, cut down from an initial 2500 after two
  memory-limit failures — see below) regardless of ride length. If the script times out or
  hits the memory limit in practice, the fix is lowering `MAX_FIT_SAMPLES` and/or the
  Crr/Cw grid resolution further — both are named constants at the top of the file.
- **Cw grid range (0.10–0.60 kg/m)** deliberately spans both typical outdoor road-position
  literature values (~0.15–0.25 kg/m at sea-level air density) and Zwift's own pinned
  constant (0.51) — this session's own earlier attempt used 0.20 as a "typical" assumption,
  but there was no principled reason to assume this rider's real outdoor position sits
  there rather than closer to Zwift's value; the grid search decides rather than assumes.
- **Mass estimate is a search seed, not an input**: `icu.wellness.weight ||
  icu.activity.icu_weight || icu.athlete.icu_weight || icu.athlete.weight` (+ a
  configurable bike-mass constant) only seeds the coordinate descent; Method C searches
  ±20kg around it. `icu.wellness.weight` was added to the front of this chain this
  session — it's the day-specific weight recorded for the activity's own date (e.g. from a
  smart scale), documented on `ActivityJsData.wellness` as "weight, resting HR etc. on the
  day of the activity," which should be more accurate/current than a static profile field
  that can go stale. Whether `athlete.weight` (the fallback) is stored in kg regardless of
  the athlete's display-unit preference is **INFERRED, not confirmed** from the data model
  docs (the `Activity` interface's doc comment states "all fields are metric,"
  `Athlete.weight_pref_lb` looks like a display-only flag by convention, but this wasn't
  independently verified against a live account) — worth a sanity check on first run,
  flagged here rather than silently assumed correct.
- **Bike mass has no data-model source and stays a manual constant**: checked
  `StravaGear` directly against the generated TypeScript types — it only exposes an `id`,
  no weight field — so there's no way to pull actual bike weight automatically the way
  wellness weight covers rider weight. `BIKE_MASS_KG` (default 8kg) stays a top-of-file
  constant the user edits directly if they know their actual bike+pedals+accessories
  weight; there's no in-chart UI to customize it since this is a headless script, not an
  app feature.
- **Descents are excluded from both visual panels (`MIN_CHART_GRADE_PCT = 0`), not just
  de-emphasized**: DESIGN §4.9's actual question is about climbs; descents are dominated
  by coasting (near-zero measured power against a formula with no coasting term, which
  demands a specific negative "braking" power at that speed/grade instead) — ride #2's
  residual plot showed this as a stark ±700W scatter below 0% grade that added noise
  without adding insight. Whole-ride statistics (R², corr(grade,speed), the naive/flat-sweep
  fits) are still computed on the full ride including descents — only the curve and
  residual panels are filtered.
- **The classical Chung method is normally applied to a loop route that returns to its
  start elevation**, which removes an ambiguity: without that closure, a genuinely wrong
  Crr/Cw combination could partly compensate for real net elevation change by fitting a
  spurious linear drift into the virtual-elevation comparison instead of matching the
  profile's shape. This script compares the **whole profile via RMSE**, which is more
  general (works on any route) but doesn't have that closure guarantee. Noted as a known
  limitation of this approximation, not fixed this session — a real Chung-method purist
  implementation would look for closed-loop segments within a ride first.

## First real result — ride #1 (2026-07-28, chart legibility not yet re-confirmed)

Transcribed from the (at-the-time illegible, since fixed) chart's annotation text on its
first successful run:

- **Samples used**: 755 (downsample stride 8, from 6037 moving/filtered samples)
- **corr(grade%, speed) this ride**: **-0.755** — meaningfully less collinear than the
  binned-data session's **-0.96**, confirming the hypothesis that real per-second data
  partially decorrelates grade from speed. **Not enough on its own**, though: see Method A.
- **Method A (naive whole-ride regression)**: mass=3.0kg, Crr=1.0274, Cw=-0.206, R²=-0.048
  — **degenerate** (flagged automatically: implausible mass, negative Cw). Even at -0.755
  correlation, the naive 3-parameter regression still fails, same failure mode as the
  binned-data attempt, just less extreme.
- **Method B (flat-segment sweep, |grade|<0.5%, n=53)**: Crr=0.0366, Cw=-0.346, R²=0.054 —
  also implausible (negative Cw) and a very weak fit (R²=0.054). Likely too few flat
  samples (53) on this particular ride for a reliable 2-parameter fit.
- **Method C (Chung/virtual-elevation grid search)**: **mass=98.2kg, Crr=0.0140,
  Cw=0.200**, VE-RMSE 44.4m → 43.5m after mass refinement. This is the one method that
  produced a physically plausible result: the mass lands close to the rider's actual mass
  range from HW-V8 (~92-99kg total), and Cw=0.200 sits right in the typical outdoor
  road-position literature range this doc's design section flagged as one of two plausible
  regimes — notably **not** close to Zwift/HW-V8's pinned 0.51, a real and interesting
  divergence worth further scrutiny (see interpretation below). Crr=0.014 is higher than
  the trainer's assumed 0.004, plausible for real road surface vs. a smooth trainer
  flywheel. The VE-RMSE only improved modestly (44.4→43.5m) from the mass refinement step,
  meaning even this best-of-three fit's virtual-elevation profile still doesn't match the
  real altitude trace tightly — a real ~43m RMSE over a ride is not a great fit in absolute
  terms, just the least-bad of the three methods tried.
- **Whole-ride R² (measured vs. steady-state-predicted power)**: outdoor-fitted=**-2.78**,
  trainer-model=**-1.97**. **Both strongly negative** — worse than just predicting the
  mean power for every sample. This looks alarming at first glance but has a specific,
  plausible explanation, not "the model is broken": both forward predictions here
  deliberately use the **steady-state** formula (no acceleration/KE term, matching exactly
  what `VIRTUAL_SHIFTING_DESIGN.md §4.3` sends to a trainer), while real outdoor power on a
  per-second basis is dominated by transient, behavioral effects the steady-state formula
  was never meant to capture — surges, coasting, braking for corners, drafting, standing
  starts. Method C's own *fitting* step does include an acceleration term specifically to
  avoid attributing those transients to a wrong Crr/Cw/mass (see design section above); the
  negative R² here is evidence that instantaneous outdoor power variance is mostly
  behavioral, not gradient/aero physics — informative, not a sign the fitted parameters are
  wrong. This matches, and adds a second independent line of evidence to, this session's
  running theme that a fixed-parameter *steady-state* model doesn't cleanly explain raw
  outdoor data — now via forward-prediction R² rather than a regression-collinearity
  failure or a grade-banded mass drift.

## Second real result — ride #2 (2026-07-28, different ride)

- **Samples used**: 802 (downsample stride 10, from 8019 moving samples).
- **corr(grade%, speed) this ride**: **-0.832** — again less collinear than the binned-data
  session's -0.96, and roughly in line with ride #1's -0.755. Still not enough for the
  naive regression, same as before.
- **Method A (naive whole-ride regression)**: mass=16.4kg, Crr=0.1862, Cw=-0.087, R²=-0.112
  — correctly flagged **degenerate** by the script's own plausibility bounds.
- **Method B (flat-segment sweep, n=54)**: Crr=0.0254, Cw=-0.110, R²=-0.010 — also
  degenerate (negative Cw), same failure mode as ride #1's Method B (n=53 there).
- **Method C (Chung/virtual-elevation grid search)**: **mass=98.0kg, Crr=0.0090, Cw=0.350**,
  VE-RMSE 29.3m → 29.3m (**zero movement** in the mass-refinement step) — see the dedicated
  analysis below (Task 2).
- **Whole-ride R²**: outdoor-fitted=**-1.696**, trainer-model=**-1.200**. Both negative
  again, consistent with ride #1. The residual-vs-grade subplot shows the same qualitative
  pattern as ride #1's implied explanation, now directly visible: **huge scatter below 0%
  grade (residuals up to ±700W) and tight residuals above ~2-3% grade**. This is a clean,
  visual confirmation of the "steady-state formula can't model coasting" explanation —
  descents are where real riders mostly coast (near-zero power), while the formula demands
  a specific *negative* power at that speed/grade combination (net braking work), producing
  huge, systematic residuals exactly where coasting happens. Above ~2-3% grade, where
  pedaling against gravity dominates and coasting is rare, residuals tighten up
  substantially — this is the direct visual evidence behind Task 1's climb-only breakout
  (below): the model may well be much more useful specifically on the terrain where SIM-mode
  gear-shifting actually matters.

**Cross-ride observation worth flagging**: Method C's fitted **mass** landed at 98.2kg
(ride #1) and 98.0kg (ride #2) — independently, from two different rides' data, essentially
the same number. That's a meaningful consistency signal (the gravitational/KE term the VE
method solves against is apparently well-constrained by this method). **Crr and Cw did
not reproduce** (0.014/0.200 vs 0.009/0.350) — real ride-to-ride differences (wind,
position, road surface) are plausible, but so is the grid search's known lack of
route-closure guarantee (see design section above) leaving Crr/Cw under-constrained even
when mass is well-pinned. Not enough data (n=2 rides) to say which explanation dominates.

## Task 2 analysis — why Method C's mass-refinement step found zero improvement (both rides)

Both rides showed the identical pattern: the mass-refinement scan's best result was
**exactly** the unmoved seed mass (`m0`), giving `rmseBefore == rmseAfter`. The task
framed this as two possibilities — (a) genuine convergence, or (b) a search-boundary cap —
and asked which one it was, fixing (b) if so.

**Neither, exactly — a third explanation, found by reading the code, not guessing**: the
single-round version of Method C (in place since the memory-limit fixes) fits Crr/Cw once
at the seed mass `m0`, then scans candidate masses **while holding those same Crr/Cw
fixed**. But Crr/Cw were chosen specifically because they minimize RMSE *at* `m0` — so
re-testing other masses with them is structurally biased toward finding `m0` still best,
regardless of where the true joint (mass, Crr, Cw) optimum actually sits. This is not a
grid-boundary artifact (ruled out directly: both rides' winning mass was exactly the
*unmoved center* of the search window, not either edge — a boundary cap would produce
`m0 ± MASS_SCAN_RADIUS`, not `m0` unchanged) and it is not necessarily genuine convergence
either, since the test was never a fair one.

**Fix applied**: restored the second Crr/Cw grid pass at the refined mass (the two-round
coordinate descent this file's design section already described as "an earlier version"
before it was cut for compute reasons). This is now affordable: the memory-limit fixes
already cut total grid-search work ~25-30x (`MAX_FIT_SAMPLES` 2500→800, grid 754→165
combos), so running the 165-combo grid twice plus the mass scan is still roughly 65x
cheaper than the version that originally failed with "Memory limit exceeded." Also added:
an explicit `massScanAtBoundary` flag (checks whether the winning mass sits at either edge
of the ±20kg search window) so a genuine boundary-capping case — a real, distinct failure
mode from the one diagnosed here — is surfaced on the chart automatically in any future
run, rather than requiring this same manual investigation each time.

**Not yet re-verified**: this fix hasn't been run against real data yet. The next run
should show `rmseBefore` and `rmseAfter` (and possibly `mass`/`Crr`/`Cw`) actually differing
when round 2 finds a better joint fit than round 1's Crr/Cw at the refined mass — if they
are still identical after this fix, that would be a much stronger, cleaner signal of
genuine convergence than either ride's single-round result was.

## Task 1 — climb-only breakout (added this session, not yet run)

DESIGN §4.9's actual validation question — does a rider's own fitted physics predict their
real *climbing* power better than the trainer's generic defaults — is not well answered by
whole-ride R², which (per ride #2's residual plot, above) is dominated by descent/coasting
error the steady-state formula was never meant to model. Added: a `CLIMB_GRADE_PCT = 2`
(%) filter and a `subsetStats()` helper computing, for samples with `grade > 2%` only —
for both the outdoor-fitted and trainer-constant models — R², mean absolute residual, and
residual standard deviation, gated by a `MIN_CLIMB_SAMPLES = 20` floor (below which the
chart reports "too few samples" rather than a statistically hollow number). Surfaced as a
new line in the chart's annotation and ready to report in full once run.

**Not yet executed against real data** — no actual climb-only R²/MAE/σ numbers exist yet
for either ride. This is the single most important pending step: it's the number that
actually tells us whether the personalization pipeline (DESIGN §4.9) is worth wiring into
the app, and nothing in this file should be read as answering that until a real run
produces it. **If** a future run shows the outdoor-fitted model (currently ~98kg mass,
Crr/Cw varying by ride) meaningfully beating the trainer-constant model on climbing
residuals, that is significant evidence for DESIGN §4.9 and should be flagged prominently
there — not asserted here without the numbers in hand.

## Multi-ride result — 3 rides via the Computed Activity Field (2026-07-28)

The user ran `intervals-icu-calibration-field.js` (post memory-limit fix,
`MAX_FIT_SAMPLES=300`, 6×6=36-combo grid) against 3 real rides and pasted the resulting
`calibrationJson` for each. **This directly answers DESIGN §4.9's validation question for
the first time with real climb-only numbers — and the honest answer right now is no.**

| Ride | Mass (kg) | Crr | Cw | Boundary? | Climb R² fitted/trainer | Climb MAE fitted/trainer |
|---|---|---|---|---|---|---|
| 1 (2026-07-13) | 97.0 | 0.0110 | 0.30 | no | -0.945 / **-0.658** | 99.8W / **93.4W** |
| 2 (2026-07-03) | 97.2 | 0.0160 | 0.30 | no | -1.375 / **-0.771** | 128.3W / **113.2W** |
| 3 (2026-06-23) | 113.2 | 0.0085 | 0.30 | **yes** | -2.580 / **-1.349** | 169.2W / **135.9W** |

**Headline finding**: the HW-V8 trainer constants (93.3kg/0.004/0.51) beat the
outdoor-fitted model on *every single ride*, on *both* climb-only R² and MAE — not
marginally (6-33W MAE gap, growing ride to ride). Test matrix / DESIGN §4.9 asked
whether a rider's own fitted physics predicts their real climbing power better than the
trainer's generic defaults; across these 3 rides, **it currently does not**. This is a
real, useful negative result, not a bug to paper over — logged honestly, per this
project's discipline, in `HYPOTHESES.md` and `VIRTUAL_SHIFTING_DESIGN.md §4.9`.

**Two confounds identified, either or both of which could explain the gap** (not yet
disentangled from a genuine "the model doesn't work" conclusion):
1. **Ride 3's mass hit the mass-scan boundary** (`massScanAtBoundary: true` — exactly
   `seed + MASS_SCAN_RADIUS`, i.e. the search wanted to go higher than 113.2kg and got
   capped). Round 2 then re-fit Crr/Cw *at that capped mass*, so ride 3's Crr/Cw are
   likely contaminated too, not just its mass — its whole row is suspect. Rides 1 and 2
   (not boundary-capped) still show the same trainer-beats-fitted pattern, though, so
   this alone doesn't explain the finding.
2. **Cw = 0.30 identically across all 3 independent rides** — a real red flag. Crr
   varies meaningfully ride to ride (0.0085-0.016), consistent with genuine fitting; Cw
   landing on the *exact same* one of only 6-7 grid points three times running strongly
   suggests the coarsened grid (cut from the chart's 165 combos to 36-37 to fix the
   field's memory limit) is now too coarse to actually resolve Cw, rather than 0.3 being
   a real converged value.
3. **Fitting-objective / evaluation-metric mismatch (the more fundamental suspect)**:
   Method C fits by minimizing VE-RMSE, which *includes* an acceleration term (needed to
   correctly separate grade-implied slope from kinetic-energy effects). But both models
   are *evaluated* here using the acceleration-free steady-state formula (matching what
   the app's drivetrain design actually sends to a trainer). Optimizing one objective and
   evaluating on a different one is a real, structural reason the fitted parameters might
   not be the best steady-state predictors even if the VE fit itself is reasonable — this
   is exactly the follow-up flagged earlier ("add an acceleration-inclusive
   forward-prediction variant... to isolate 'is Crr/Cw/mass plausible' from 'does
   dropping the acceleration term explain the negative R²'"), now backed by concrete
   evidence motivating actually doing it rather than a hypothetical concern.

**Operational note, not a script bug**: Computed Activity Fields don't auto-evaluate
retroactively — each activity has to be opened individually and the field re-run via its
play button. Real friction for a repeated multi-ride workflow, but a platform behavior,
not something the script can fix.

**Not done**: averaging rides 1+2's mass (~97.1kg) into a "final settings file" was
deliberately not done — given the Cw-grid-coarseness concern and the fact that neither
model predicts climbing power well in an absolute sense, presenting a confident average
right now would overstate how settled these numbers are.

## What's still open (this is the honest part)

- **Climb-only breakout not yet run.** The single most important open item — see Task 1
  above. Everything else in this list is secondary to getting one real run of the current
  script and reporting the climb-only R²/MAE/σ numbers back.
- **Round-2 restoration (Task 2 fix) not yet re-verified.** Need a run where `rmseBefore`
  and `rmseAfter` (or `mass`/`Crr`/`Cw`) actually move, confirming round 2 does something
  different from round 1 now.
- **Chart legibility fix confirmed working** as of the second run (the annotation text was
  readable in the task's transcription) — the side-by-side layout appears to have resolved
  the first run's overlap problem. Still worth a direct visual look once the climb-only line
  is added to the annotation, since that's a third line of text competing for the same
  vertical space.
- **n=2 rides now, not yet enough for confidence.** Mass converged closely (98.2kg, 98.0kg)
  across two independent rides — an encouraging consistency signal — but Crr/Cw did not
  (0.014/0.200 vs 0.009/0.350). Not enough data to say whether that's real ride-to-ride
  variation (wind, position) or the grid search's known route-closure limitation leaving
  Crr/Cw under-constrained (see design section). A real Chung-method practitioner would
  want several more rides, ideally with a genuine closed-loop route, before trusting either
  parameter individually.
- **Follow-up worth doing**: add a second forward-prediction variant that *does* include
  the acceleration term (for both the fitted and trainer models), to isolate "is Crr/Cw/mass
  plausible" from "does dropping the acceleration term explain the negative whole-ride R²"
  — right now those two questions are conflated in the single whole-ride R² figure. The new
  climb-only breakout partially addresses this (climbs have less coasting-driven
  acceleration noise) but doesn't fully separate the two questions.
- **Method B's small flat-sample count (n=53-54) on both rides** suggests the flat-sweep
  method needs either a longer/flatter ride to be trustworthy, or a looser grade threshold —
  worth trying `FLAT_GRADE_PCT` at 1.0% instead of 0.5% on a future run to see if more
  samples changes its (currently implausible, negative-Cw, on both rides) sign.

## Confidence

**CONFIRMED**: the intervals.icu Custom Activity Chart JS API and all stream/object field
names cited above and used in the script, verified directly against
`github.com/intervals-icu/js-data-model`'s generated `dist/index.d.ts` (fetched this
session) plus the feature's own forum thread — not assumed from training data. The script
runs end-to-end against real data and produces the numbers transcribed above.
**CONFIRMED, two rides**: corr(grade,speed) = -0.755 and -0.832 respectively, and all three
methods' point estimates as transcribed above for each ride. The side-by-side layout and
its footer annotations were legible as of the second run — but that was the
scatter+residual version. The next version (curve+residual, plus the calibrationJson
line) rendered its curve/residual panels and title correctly but silently dropped both
footer annotations entirely (see "Real bug found and fixed," Chart output section) — a
real, now-fixed bug, not a re-confirmation of the annotation approach in general.
**CONFIRMED**: Method C's mass estimate is consistent across both independent rides
(98.2kg, 98.0kg) — a real, if still small-n, reproducibility signal.
**INFERRED**: Method C's Crr/Cw are NOT confirmed consistent across rides (0.014/0.200 vs
0.009/0.350) — either real ride-to-ride variation or an under-constrained fit; n=2 is not
enough to distinguish these.
**CONFIRMED**: the single-round Method C design had a real methodological bias in its
mass-refinement step (Crr/Cw held fixed at values fit specifically for the seed mass,
structurally favoring "no improvement") — diagnosed from the code, not guessed, and fixed
by restoring a second Crr/Cw grid pass at the refined mass (Task 2 analysis above).
**INFERRED, moderate-high confidence**: the negative whole-ride R² is explained by the
steady-state formula's inability to capture real transient/behavioral power variance
(especially coasting on descents, visually confirmed in ride #2's residual-vs-grade plot),
rather than by wrong Crr/Cw/mass — supported by Method C's own mass parameter looking
plausible and reproducible even though the downstream whole-ride R² is bad, but not yet
confirmed by either the acceleration-inclusive forward-prediction variant proposed as a
follow-up, or by real climb-only numbers (see Task 1).
**Still UNKNOWN**: the actual climb-only R²/MAE/σ numbers (code exists, unexecuted) — this
is the number DESIGN §4.9 actually needs; whether the round-2 fix changes anything in
practice; whether Crr/Cw will converge with more rides.

## Follow-ups

- **Highest priority — figure out why the trainer beats the fitted model on climbs.**
  Three confounds identified this session (Cw-grid coarseness, ride 3's boundary
  contamination, the fit-objective/evaluation-metric mismatch) — none yet isolated as
  *the* explanation. Concretely: (a) re-run ride 3 with `MASS_SCAN_RADIUS` widened (try
  40) and see if its numbers stop looking like an outlier; (b) run the *chart* script
  (finer 165-combo grid, already proven to work at that resolution) against the same 3
  rides to check whether Cw resolves to something other than 0.30 with better
  resolution; (c) add the acceleration-inclusive forward-prediction variant (flagged as
  a follow-up twice now) to test whether the fitted model wins once evaluated on the
  same objective it was fit against.
- Collect 2 more rides to reach the original ~5-ride target, once (a)-(c) above suggest
  the numbers are trustworthy enough to be worth averaging.
- Confirm the Computed Activity Field's value actually displays as plain, selectable
  text in the activity summary UI — that's the whole reason it exists, and hasn't been
  visually confirmed yet (only that the script executes and returns a JSON string).
- Confirm File 2's numbers match File 1's chart exactly for the same ride — they share
  identical model logic by construction but different grid resolution (deliberately, for
  the memory-limit fix), so their *outputs* are expected to differ in precision, not
  necessarily disagree in the design-logic sense; worth a real side-by-side check.
