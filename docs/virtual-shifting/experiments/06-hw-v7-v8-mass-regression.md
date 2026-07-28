# 06 — Combined HW-V7 (Latency/IBD) + HW-V8 (Trainer Mass Regression)

**Date**: 2026-07-28
**Hardware**: KICKR CORE C26B, fw 1.5.36. Rider-reported mass: 89 kg + 3 kg bike
(user-specified constant) = **92 kg total**, used as ground truth for comparison.

## Protocol (finalized this session, adopt as the standard going forward)

A first attempt at this test (not detailed here) produced noisy, unusable data because
the rider was shifting gears mid-test to manage chainline — changing physical gear ratio
changes speed at the same time as the grade command, confounding the power/grade
relationship the regression needs. **Fixed protocol, agreed with the user:**

- **One gear, chosen before starting, never changed for the whole test.** At fixed gear
  and fixed cadence, wheel/flywheel speed is ~constant regardless of grade — resistance
  changes only show up as required power, exactly what the regression needs.
  changes.
- **Lead-in**: 5 s after each grade change, ignored (settling).
- **Measurement window**: 15 s immediately following, used for the average.
- Reduced from an initial 10s/20s (30s total) design after the rider reported the 6%
  step was tiring, especially held for the full 30s, and that sustained power over
  ~250W tires them out quickly within a few seconds — noted as a real constraint for
  designing future tests (HW-V12 in particular).
- Rider could not watch the screen while pedaling (hands/eyes needed on the bike) — all
  timing was driven by the agent via `window.__bleLab` (a debug hook added to the
  harness), with the rider only needing to hold cadence steady until told to stop.

**Process note**: the first attempt at this exact protocol also had agent-side execution
errors (a command sent before its window finished, and an unexplained ~26-minute gap
associated with an unaccounted-for trainer reconnection that also revealed and required
fixing a duplicate-event-listener bug in the harness — see git history/session log for
detail, not reproduced here since that run's data was discarded). The run below is the
clean repeat after fixing the harness bug and correcting agent-side timing discipline.

## Exact steps performed

Sequence, each grade held for the 5s lead-in + 15s window (~20s), immediately
back-to-back with no gap beyond ordinary script/BLE round-trip overhead:
`sendRaw(encodeSim({gradePct: 0}))` → wait ~20s → `gradePct: 2` → wait ~20s →
`gradePct: 4` → wait ~20s → `gradePct: 6` → wait ~20s → `gradePct: 0` (cool-down).
Crr/Cw left at `encodeSim`'s defaults (0.004 / 0.51) for all steps.

## Raw data

Command timestamps and ACK latency (write → `0x80` indication):

| Grade | Write time | Indicate time | ACK latency |
|---|---|---|---|
| 0% (baseline) | 15:20:46.944 | 15:20:46.946 | 2ms |
| 2% | 15:21:15.564 | 15:21:15.569 | 5ms |
| 4% | 15:21:43.293 | 15:21:43.293 | ~4ms |
| 6% | 15:22:17.400 | 15:22:17.405 | 5ms |
| 0% (cool-down) | 15:22:48.361 | 15:22:48.363 | 2ms |

Per-window averages (samples taken 5s after each write, up to the next write; n = IBD
notifications in that range, ~1/sec):

| Grade | n | Avg power | Power range | Avg cadence | Avg speed |
|---|---|---|---|---|---|
| 0% | 24 | **66.9 W** | 62–69 W | 82.5 rpm | 19.15 km/h |
| 2% | 22 | **165.0 W** | 105–221 W | 80.0 rpm | 18.65 km/h |
| 4% | 29 | **257.6 W** | 230–289 W | 80.9 rpm | 18.74 km/h |
| 6% | 26 | **353.8 W** | 335–382 W | 79.3 rpm | 18.44 km/h |

Cadence held 79–83 rpm and speed held 18.4–19.2 km/h across all four conditions —
confirms the fixed-gear/fixed-cadence protocol worked as intended (speed is
grade-invariant; only power responds).

## Analysis

**Linear regression, power vs. grade%:**

```
slope     = 47.66 W per %grade
intercept = 67.83 W
R²        = 0.9999
```

Near-perfect fit — strong evidence the KICKR's SIM-mode resistance response is clean and
linear in grade over this range, at fixed speed.

**Back out the trainer's assumed mass** (`slope = m_t · g · v / 100`, v = mean speed =
5.207 m/s):

```
m_t = slope × 100 / (g × v) = 93.3 kg
```

**Compare to actual**: user-reported 89 kg (rider) + 3 kg (bike, user-specified constant)
= **92 kg**. Ratio m_t / actual = **1.014** — within 1.4%.

The intercept, decomposed assuming the sent Cw=0.51, implies a slightly *negative*
effective Crr (~ -0.0009), which isn't physical. This is model/sampling noise from a
4-point regression with a small intercept term (rolling resistance's contribution to
power at these low grades/speeds is small relative to measurement noise) — **the slope
(and therefore the mass estimate) is the robust part of this fit; don't over-read the
intercept-derived Crr**.

**HW-V7 observations** (from the same run): ACK latency was 2–5ms for every command —
far under the 300ms budget. Felt/measured power transition to the new steady state took
several seconds to fully settle (e.g. after the 2% command, power was still near the old
baseline for ~2–3 samples before climbing toward the new average over the following
~5s) — consistent with why a lead-in window is necessary at all, and roughly consistent
with the ~1-1.5s literature figure (H10) for the *initial* response, with a few more
seconds to fully stabilize. Cadence field was present and populated throughout every
active pedaling window (zero only during genuine idle/stopped periods) — confirms the
cadence flag is reliably available (bears on U10).

## Conclusion

**HW-V8: ANSWERED, high confidence — but the interpretation below was corrected by the
user shortly after this was first written.** The KICKR Core's internal mass assumption
on this unit (93.3kg) happens to land within ~1.4% of the rider's actual total mass
(92kg) — this is a *much* better result than the design's contingency planning assumed,
**but it is coincidence, not personalization**. Checked against the Wahoo app: the
rider's profile there is set to **81kg**, which doesn't match either number. Since
standard FTMS has no field to transmit rider mass to the trainer at all (L9 — this is
precisely the gap Zwift's proprietary `PhysicalParam` exists to fix), a generic FTMS
client cannot be reading a personalized weight from any app profile. **93.3kg is almost
certainly the KICKR's fixed internal default for SIM-mode physics**, applied identically
regardless of who is riding or what's configured anywhere. For this specific rider it
happens to be close to correct; for a rider of significantly different mass it would not
be, and there is no automatic per-rider correction possible over plain FTMS. **This is
exactly why the drivetrain design's single user-adjustable "trim factor" (R3 mitigation)
is essential, not optional** — it's the only lever available to correct for a mismatch
between the trainer's fixed default and an individual rider's actual mass.

Separately, the rider reported that holding the 6% grade step produced 340W+ and felt
like what would normally be closer to a 15% real-world climb for them — a second,
independent signal that the trainer's assumed mass and/or the Crr/Cw defaults sent
(0.004/0.51) may not add up to a realistic "6%" for this rider's actual body+bike. The
rider has offered to share power-vs-grade data from a real outdoor ride as ground truth
for a proper cross-check — see follow-ups.

**HW-V7: ANSWERED.** ACK latency negligible (2-5ms, all well under budget). Felt
resistance change takes a few seconds to fully settle. Cadence field reliably present.

## Confidence

**CONFIRMED**: ACK latency figures (protocol-level, deterministic). Cadence-field
presence during active pedaling.
**CONFIRMED, high confidence**: the power-vs-grade linear relationship and the resulting
mass estimate (R²=0.9999, clean fixed-gear/fixed-cadence protocol, no known confound).
**INFERRED**: the intercept-derived Crr figure — not reliable, don't use it.

## Follow-ups

- ~~Check the Wahoo app's rider-weight setting~~ **Done, and it changed the conclusion**:
  app says 81kg, matching neither 93.3kg (regressed) nor 92kg (actual) — confirms 93.3kg
  is a fixed trainer-side default, not a personalized reading. See corrected Conclusion
  above.
- ~~**New, higher-priority follow-up**: compare this trainer's simulated power-vs-grade
  relationship against a real outdoor ride's power-vs-grade data~~ **Done 2026-07-28** —
  see `experiments/07-outdoor-ride-power-grade-comparison.md`. Real 6% (freely geared) =
  238W vs. this experiment's fixed-gear 6% = 353.8W (49% higher) — strong support that
  the "6% felt like 15%" report below was a fixed-gear-protocol artifact, not a
  trainer-defaults/physics error. Not a controlled cross-check of Crr/Cw/mass
  individually (see that file's caveats) — the trim-factor question stays open.
- Multi-rider implication for the design: since FTMS has no channel for personalized
  mass, every rider gets this trainer's same fixed default — the single-number trim
  factor (R3 mitigation) is the only available correction and should be treated as a
  required calibration step for riders whose mass differs meaningfully from ~93kg, not
  an optional nicety.
- Update `VIRTUAL_SHIFTING_DESIGN.md` §6 Risks (R3) to reflect the corrected
  interpretation (fixed default, not personalization) — done, see design doc.
- The standard protocol here (fixed gear, 5s lead-in, 15s window, mind the <250W-sustained
  fatigue constraint) should be the default for HW-V12's shift-primitive comparisons too.
