# 07 — Outdoor Ride Power-vs-Grade Comparison (ground-truth cross-check)

**Date**: 2026-07-28 (data shared mid-HW-V12-prep session)
**Source**: user-provided chart, one real outdoor ride, 0.5%-grade bins, avg power (W) +
time-in-bin per bin. Not this project's own capture — a screenshot of an existing
ride-analysis chart. Rider is the same person as all other hardware tests in this
knowledge base (FTP ≈ 220W per GOALS.md; ~250W self-reported sustained-effort ceiling
from `06-hw-v7-v8-mass-regression.md`).

This is the follow-up flagged in `06-hw-v7-v8-mass-regression.md` ("compare this
trainer's simulated power-vs-grade relationship against a real outdoor ride") and test
matrix item 33 (parked: "requires... real outdoor ride power/grade data the user has
offered to share").

## Raw data (transcribed from chart)

| Grade % | Avg power (W) | Time in bin |
|---|---|---|
| 0 | 125 | 3m18s |
| 0.5 | 107 | 4m25s |
| 1 | 127 | 7m8s |
| 1.5 | 173 | 4m11s |
| 2 | 163 | 6m49s |
| 2.5 | 180 | 7m6s |
| 3 | 184 | 6m20s |
| 3.5 | 209 | 5m27s |
| 4 | 215 | 5m49s |
| 4.5 | 223 | 5m25s |
| 5 | 231 | 3m53s |
| 5.5 | 247 | 3m17s |
| 6 | 238 | 3m11s |
| 6.5 | 254 | 2m52s |
| 7 | 242 | 3m15s |
| 7.5 | 248 | 3m16s |
| 8 | 251 | 3m20s |
| 8.5 | 251 | 3m13s |
| 9 | 247 | 2m22s |
| 9.5 | 249 | 1m1s |
| 10 | 275 | 50s |
| 10.5 | 249 | 53s |
| 11 | 251 | 57s |
| 11.5 | 259 | 37s |
| 12 | 259 | 29s |
| 12.5 | 265 | 33s |
| 13 | 266 | 24s |
| 13.5 | 266 | 20s |
| 14 | 284 | 7s |
| 14.5 | 333 | 9s |
| 15 | 320 | 6s |
| 15.5 | 301 | 12s |
| 16 | 295 | 8s |
| 16.5 | 283 | 5s |
| 17 | (no data) | — |
| 17.5 | (no data) | — |
| 18.5 | 303 | 5s |

Rider's own annotation: cadence not captured in the chart; **"after 5% I am pretty much
just using my lowest gear ratio"** — i.e. above ~5% the rider has run out of downshifts
and cadence necessarily starts dropping as grade increases further (unlike the HW-V8
trainer protocol, which deliberately held one fixed gear and constant cadence for the
whole sweep).

## Observations

1. **Power vs. grade is strongly sub-linear / saturating, not linear** — rises from
   125W (0%) to ~250-266W by 8-13.5%, then stays roughly flat in that band (247-266W)
   across a 5.5-percentage-point range, before the very short (≤12s) bins at 14%+ show
   higher, noisier values (284-333W). This is qualitatively different from the trainer's
   clean **linear** power-vs-grade fit in `06-hw-v7-v8-mass-regression.md`
   (slope 47.66 W/%, R²=0.9999) — expected, since outdoor riding lets the rider shift
   gears freely to manage effort, while the trainer test deliberately locked one gear.
2. **The flat ~247-266W band across 8-13.5% is strong independent corroboration of the
   ~250W sustained-effort ceiling** already reported by the rider in HW-V8 (fatigue at
   sustained >~250W). This is the rider's own natural, real-world, freely-chosen-gearing
   behavior converging on almost exactly the same number reported once, subjectively,
   on a stationary trainer — not the same measurement repeated, but two independent
   signals agreeing. Raises confidence that ~250W is a real physiological/preference
   ceiling for this rider on sustained (≥~20s) efforts, useful for picking HW-V12 step
   sizes.
3. **Direct comparison at 6% grade — the number that matters most, given HW-V8's "felt
   like 15%" report**: outdoor 6% = **238W** (freely geared, 3m11s sustained). HW-V8's
   fixed-gear trainer test at 6% = **353.8W** (15s window, one held gear, ~80rpm). Ratio
   353.8/238 = **1.49** — the fixed-gear trainer test demanded **~49% more power** than
   this rider's real-world 6% climbing power. This is concrete, quantitative support for
   `HYPOTHESES.md` §F's conclusion that the "6% felt like 15%" report was a **fixed-gear
   test-protocol artifact** (the rider had no recourse to shift down, unlike on the
   road), not evidence of a broken physics model, wrong Crr/Cw constants, or an
   incorrect trainer mass assumption. It does not, by itself, prove the trainer's
   defaults are perfectly realistic — see caveats below — but it rules out "grossly
   wrong physics" as the explanation for that one subjective report.
4. **The <15s bins above 14% are not comparable to anything in this project** — durations
   that short are dominated by short punchy efforts (partly anaerobic, likely standing),
   not steady-state climbing; treat 14%+ as noise for cross-checking purposes.

## Why this is NOT a clean quantitative physics cross-check (caveats)

Unlike HW-V8's controlled protocol (one fixed gear, constant cadence, constant speed,
grade the only varying input), this outdoor data has multiple uncontrolled, simultaneously
varying factors per grade bin:
- **Free gear/cadence choice** — the rider optimizes gearing per grade, so power reflects
  *preferred effort at that grade*, not *the power physics demands at a fixed gear/speed*.
  This is the main reason the curves look so different in shape, and is expected, not a
  discrepancy to resolve.
- **Real wind, drafting (none, solo), road surface, and pacing/fatigue** across a whole
  ride, vs. an isolated ~20s trainer trial.
- **Time-in-bin weighting** — a "6% grade" bin on a real climb blends brief transients
  (accelerating into/out of the grade) with steady-state riding; the trainer test isolated
  pure steady-state.
- No independent read on this rider's real Crr/Cw/mass from this chart alone (would need
  paired speed + power + grade + wind data, not just power + grade).

**Conclusion: directionally corroborating, not a replacement for a controlled outdoor
test.** If a genuinely rigorous cross-check is wanted later, the ideal design would mirror
HW-V8's method outdoors: one fixed gear, a flat-to-moderate real climb, steady cadence,
still air, GPS-grade + power + speed logged together — not required for this project's
current decisions.

## Conclusion

**CONFIRMED (as real ground-truth data, at face value)**: this rider's real-world
power-vs-grade behavior saturates around 250-266W from ~8% grade onward, matching the
~250W sustained-effort ceiling already used to design HW-V8's and HW-V12's step sizes.
**INFERRED, high confidence**: the HW-V8 "6% felt like 15%" report is attributable to the
fixed-gear test protocol (49% higher power than this rider's real 6% climbing power),
not a physics-model or constant error — consistent with, and now backed by real numbers
supporting, the reasoning already in `HYPOTHESES.md` §F.
**Not established by this data**: whether the trainer's Crr/Cw/mass defaults (0.004/0.51,
93.3kg) are individually accurate for this rider — this chart can't isolate that (see
caveats). Test matrix item 33 stays parked for a true controlled outdoor comparison;
this experiment is logged as a partial, directionally-useful substitute, not a closure.

## Confidence

**CONFIRMED**: the raw chart data as transcribed (at face value — a screenshot read, not
independently re-derived).
**INFERRED, high-moderate confidence**: the "fixed-gear protocol artifact, not physics
error" explanation for HW-V8's 6%-felt-like-15% report — strengthened by this data but
still resting on comparing two different measurement conditions, not a controlled A/B.

## Follow-ups

- If the rider shares additional outdoor rides (offered, not yet provided), repeat this
  comparison to check whether the ~250-266W saturation band and the sub-linear shape
  reproduce, or were specific to this one ride's conditions (wind, fatigue that day).
- Not blocking HW-V12 or HW-V9 — logged for the knowledge base, no design change implied.
