# 08 — HW-V12 Shift-Primitive Bake-off (partial: candidate (a) only)

**Date**: 2026-07-28
**Hardware**: KICKR CORE C26B, fw 1.5.36. Rider on trainer, one fixed physical gear for
the whole session (protocol from `06-hw-v7-v8-mass-regression.md`).
**Status**: **Session ended early (rider fatigue/time) after candidate (a) only.**
Candidates (b)-(f) not yet run — see "Next session" below for the exact grades to send,
already computed.

This is `experiments/00-test-matrix.md` §3.2's HW-V12 bake-off — the comparative
evaluation the whole virtual-shifting design rests on. Full protocol there; this file
records what was actually measured.

## Setup

- Feature-gate check (0x2ACC) confirmed **candidate (e) Target Resistance Level is
  viable** before starting: `resistanceTargetSupported=true, powerTargetSupported=true,
  simParamsSupported=true` (raw `03 40 00 00 0c 60 00 00`). All 6 candidates stayed in
  scope.
- Request Control (0x00) sent once at session start; not re-sent per command (per design
  §4.4 — persists until disconnect/reset).
- One fixed gear held for the whole session. Baseline route grade 2%, then repeated at
  0% flat per protocol. 5s lead-in + 15s measurement window per step (standard protocol,
  `06-hw-v7-v8-mass-regression.md`).
- Measurement method this session: no live UI reading — all IBD notifications were
  captured from the browser console log (`[BLE-LAB] {...}` lines, mirrored via
  `list_console_messages`) and decoded offline against the same flag-aware parser as
  `src/js/ftms.js:_parseIbd` (bit layout confirmed identical). Averages computed with a
  scratch Python script, not saved to the repo (throwaway).

## Candidate (a) — grade-offset additive (`slope_sent = slope_route + 0.5% × gear_step`)

The qdomyos-zwift default convention (HYPOTHESES.md F5): flat ±0.5% grade per gear step,
not speed-scaled.

### 2% baseline

| Step | Grade sent | Avg power | Avg cadence | Avg speed | n |
|---|---|---|---|---|---|
| Harder | 2.5% | **175.3 W** | 78.3 rpm | 18.39 km/h | 15 |
| Easier | 1.5% | **135.1 W** | 81.2 rpm | 19.10 km/h | 16 |

Gap: 40.2 W. First attempt at the "easier" step was discarded — cadence dropped to
~1 rpm right after the command (rider paused/adjusted position) and swept back through
27→83 rpm with a power spike to 407W over the window; clearly a real-world transient,
not a resistance response, and not usable. Retaken cleanly after confirming the rider
was back to steady cadence (see raw log timestamps 17:30:38-17:30:59 for the discarded
attempt vs 17:32:41-17:33:01 for the clean retake).

### 0% baseline (dead-zone check)

| Step | Grade sent | Avg power | Avg cadence | Avg speed | n |
|---|---|---|---|---|---|
| Harder | 0.5% | **85.4 W** | 81.1 rpm | 18.97 km/h | 15 |
| Easier | −0.5% | **58.9 W** | 82.9 rpm | 19.33 km/h | 15 |

Gap: 26.5 W. **No dead zone** — as expected for an additive (not multiplicative) model,
unlike the superseded `VirtualGear.applyToGradient` (design doc §1.7).

### Candidate (a) scoring (rubric: 1-5, `00-test-matrix.md` §3.2)

| Dimension | Score | Notes |
|---|---|---|
| Latency | 5 | ACK 2-5ms every command (consistent with HW-V7/V10), no ATT errors |
| Feel | 3 | Harder clearly felt harder at both 0% and 2%, no dead zone. But the step size (flat 0.5%) is arbitrary and not speed-scaled — the qdomyos criticism (HYPOTHESES F5: "+0.5% feels different at 15 vs 40 kph") wasn't directly testable this session (speed stayed ~18-19 km/h throughout, no wide speed range tested) |
| Metric accuracy | 4 | Power and speed responded monotonically and plausibly with grade in both directions |
| Stability | 5 | Zero ATT errors, zero disconnects, clean ACKs throughout |

**Total: 17/20.** Candidate (a) works as a cheap fallback exactly as HYPOTHESES.md F5
predicted — functional, no dead zone, but arbitrary step size with no physical grounding.

## Candidates (b)-(f): NOT YET RUN — grades pre-computed for next session

Session ended before candidate (b) could be tested. To save setup time next time, the
physics-solved grades for candidate (b) were pre-computed from this session's own
measured baseline cadence/speed (no pedaling required for this calculation):

**Key finding while preparing (b)**: naively assuming the design's default baseline
gear (Zwift table gear 12, ratio 2.40 — `VIRTUAL_SHIFTING_DESIGN.md` §4.3) does **not**
match this rider's actual physical gear on the trainer. Back-solving `r_phys` from this
session's own measured baseline (speed÷(cadence×circumference)) gives **r_phys ≈ 1.85**
(closest Zwift-table entry: 1.86) — using the wrong assumed baseline ratio (2.40 instead
of ~1.85) breaks the design's baseline-identity property and produces wildly
inflated target power (≈355W at "baseline") purely from the aero term (`Cw·v_virt²`)
being oversized when virtual speed is computed against the wrong gear. **This is a
real, generalizable methodology note**: candidate (b)'s physics-solve needs the rider's
actual current physical gear ratio as an input — it cannot assume a fixed table default.
Once corrected using this session's own measured baseline, the computed steps land in a
sensible, comparable range to candidate (a):

| Baseline | Step | r_gear | Computed P_target | **G_send to test** |
|---|---|---|---|---|
| 2% (cadence≈80rpm, speed≈18.6km/h) | Harder | 2.04 (one Zwift-table step up from ~1.85) | 217.9 W | **2.72%** |
| 2% | Easier | 1.68 (one step down) | 154.4 W | **1.38%** |
| 0% (cadence≈81rpm, speed≈18.8km/h) | Harder | 2.04 | 118.9 W | **0.57%** |
| 0% | Easier | 1.68 | 71.9 W | **−0.41%** |

Constants used: `m=92kg` (89kg rider + 3kg bike, established prior sessions), `m_t=93.3kg`
(HW-V8 trainer-mass regression), `Crr=0.004`, `Cw=0.51`, wheel circumference `2.096m`
(design default). Computation script (throwaway, not in repo):
`compute_physics_solved.py`, logic mirrors `VIRTUAL_SHIFTING_DESIGN.md` §4.3 exactly
(forward `v_virt`/`P_target`, then the documented small-angle inverse solve for
`G_send`, HYPOTHESES.md §F already proved this approximation negligible).

**Candidates (c), (d), (e), (f) — not yet computed or run.** For (c)/(d), the mechanism
is simpler (hold grade at baseline, scale Crr or Cw directly) and doesn't need a
physics-solve — just pick a scale factor per gear step before the next session. (e) is
confirmed feasible (feature bit) but no trial run. (f) needs a target-power formula via
0x05 using the rider's real mass, similar prep to (b).

## Next session checklist

1. Reconnect trainer, Request Control (0x00) once.
2. Re-verify current physical gear ratio hasn't changed — if a different gear is used,
   re-derive `r_phys` from a quick baseline measurement rather than reusing 1.85 blind.
3. Run candidate (b) using the pre-computed grades above (2% baseline: 2.72%/1.38%; 0%
   baseline: 0.57%/−0.41%).
4. Pick Crr/Cw scale factors for (c)/(d) before starting (not yet decided).
5. Run (e) Target Resistance Level (0x04) — feature confirmed supported.
6. Run (f) ERG weight-aware (0x05) — needs a target-power formula prepared in advance.
7. Score all against (a)'s baseline (17/20) using the same rubric.
8. Update `HYPOTHESES.md`, `00-test-matrix.md` item 16, and
   `VIRTUAL_SHIFTING_DESIGN.md` §2.6 with the complete bake-off once all 6 are scored.

## Confidence

**CONFIRMED**: candidate (a)'s measured power/cadence/speed figures (clean protocol,
one discarded+retaken window documented above, all other windows free of visible
transients).
**CONFIRMED (computed, not yet hardware-verified)**: candidate (b)'s target grades —
correct application of the already-validated design formula (HYPOTHESES.md §F) to this
session's own measured inputs; the numbers themselves haven't been sent to the trainer
yet, so the *feel* and *metric accuracy* dimensions remain UNKNOWN until run.
**UNKNOWN**: candidates (c)-(f) entirely — no computation or measurement done yet.
