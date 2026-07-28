# Risks, Open Questions, Roadmap

## Risks

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | Reverse-engineered protocol drift — Zwift changed the Click's advertised UUID in Jan 2025 and could change framing again | Click adapter breaks after a firmware update | Probe both service UUIDs; detect variant from frame type; keyboard/gamepad adapters always work |
| R2 | Click v2 vendor lock (~60 s disconnect without recent real-Zwift unlock) | Sessions unusable on a v2 unit | **Confirmed 2026-07-28, and confirmed mandatory (not optional) by the user**: Zwift Companion pairing is "the sync process" — required first-run onboarding, not a fallback for when things break. UX must walk new users through pairing their Click in Companion once before first use of this feature. Challenge replay (skipping Companion entirely) still out of scope for v1. **Worse than initially scoped**: user reports needing to re-sync in Companion after routine dev-side page reloads, suggesting the unlock grace period may be short enough that ordinary session churn (tab reload, browser restart) could force a re-sync in the real feature too — worth a dedicated timing test later (how long does the unlock actually last?) |
| R3 | Trainer's internal rider mass is a **fixed default, not personalized** (U3) | **MEASURED 2026-07-28** (`experiments/06-hw-v7-v8-mass-regression.md`): `m_t`=93.3kg regressed, vs actual 92kg (1.4% off) — but the Wahoo app's own rider-weight profile is 81kg, matching neither figure. Since FTMS has no channel to transmit rider mass (L9), 93.3kg must be a fixed trainer-side default applied to every rider regardless of actual weight or app profile. For this rider it happens to be close; for a meaningfully lighter/heavier rider it would not be, with no automatic correction possible. **Still the riskiest assumption in the whole design for the general user population** — the single-number trim factor is now confirmed as a required calibration step, not an optional nicety | HW-V8 measurement; user-adjustable trim factor is the only available correction (no automatic per-rider fix exists over plain FTMS); baseline gear is exact regardless (identity property) |
| R4 | Grade clamp saturation (hard gear + steep grade + low flywheel speed ⇒ `G_send` beyond trainer range) | Feel flattens at extremes | Clamp + "at limit" UI hint. ~~Plan A′ eliminates the class~~ **Plan A′ is out of scope (2026-07-28 decision, see GOALS.md) — this is now a permanently accepted limitation of the FTMS-only path, not a temporary one** |
| R5 | App-side latency ceiling ~1–1.5 s felt (trainer-bound) | Shifts respond but not Zwift-instant | Accepted for v1. ~~Plan A′ (firmware-side) is the only true fix~~ **Plan A′ is out of scope — this latency ceiling is now permanent for this project, not a v1-only gap** |
| R6 | Chrome permission persistence still flag-gated | Chooser click needed after every reload | Accepted; revisit when Chrome ships the new permissions backend by default |
| R7 | Legacy/React split — new state accreting onto `window.Hybrid` | Architecture debt compounds | New code lives in typed services + contexts only; StrictMode double-mount already bit once (TrainerContext.tsx:34-47) |
| R8 | Android screen-lock kills BLE | Workout interruption on mobile | Pre-existing constraint (README); note in UX; HW-V11 |

## Open questions

1. Does the KICKR FTMS path tolerate 2 Hz 0x11 bursts around shifts? (HW-V10)
2. ~~Is QZ's ×(42/14) hub-command normalization Hub-specific or universal? (HW-V9)~~
   **Moot — Plan A′/HW-V9 is out of scope (2026-07-28 decision, GOALS.md).** Already
   resolved from source anyway (H21/H22) before being dropped.
3. Should momentum assist (simPhysics.ts:48-53) apply before or after gear translation?
   Design says before (it's route feel, not drivetrain feel) — validate subjectively.
4. ~~Buy a Zwift Cog? Not protocol-relevant; would remove cross-chain noise. The 34/17
   parking convention already gives a fixed physical ratio.~~ **RESOLVED 2026-07-28**:
   bought. Confirmed 14-tooth cog (Zwift's own product page + ZwiftInsider — search
   results initially disagreed, 14t confirmed as the correct spec after cross-checking
   both sources against Zwift's own copy). With this rider's 34T front chainring,
   `r_phys = 34/14 = 2.4286` — supersedes the old 34/17-parking-convention assumption
   (`r_phys = 2.0`). Not yet wired into any calculation (drivetrain model, §4.3, isn't
   implemented) — documented here for when it is.
5. Should gear state persist across page reloads or reset to baseline? (Design: persist
   `gearIndex`; revisit after riding with it.)
6. **Baseline-identity gap in the Zwift-24 table**: the identity property (`G_send = G`
   exactly) holds only when a gear's ratio equals the physical ratio `r_phys`. With the
   34/17 convention `r_phys = 2.0`, but Zwift's 24 ratios skip 2.0 (nearest: 2.04) — so
   no gear is *exactly* neutral. Options: (a) insert `r_phys` as an extra gear, (b) snap
   the nearest table entry to `r_phys`, (c) accept the ~2 % error. Decide in P1; the
   drivetrain unit tests should encode whichever choice is made.
7. ~~**Crr/Cw consistency**: the grade-solve must use the *same* Crr/Cw constants that
   are transmitted in 0x11, or the solve is self-inconsistent. App currently sends
   crr=0.003 / cwa=0.45 (main.js:970-975); Zwift sends 0.0051 / 0.41.~~ **RESOLVED
   2026-07-28**: that Zwift figure was a documentation error in this file — Zwift's
   real pinned constants are **Crr=0.004, CWa=0.51**, confirmed byte-level from the
   Zwift Hub protocol's own `.proto` file comments (`PROTOCOLS.md` §2.0's self-check:
   `CWa=5100`/`Crr=400` decode to exactly 0.51/0.004) and corroborated by an
   independent open-source repo (Kickr-Virtual-Shifting: Crr=0.00415, Cw=0.51). The
   app's 3 hardcoded SIM-mode call sites (main.js) now read `H.state.simPhysics`,
   populated from a new "Rider & Bike Physics" settings panel
   (`src/services/riderPhysics.ts`) whose default preset resolves to exactly these
   Zwift-matching values — still shared in one place (`riderPhysics.ts`), just not
   `drivetrain.ts` yet since that module doesn't exist.
8. **Hold-to-repeat policy**: the Click streams repeat frames while held (QZ re-shifts
   every 500 ms). Should holding a shifter auto-repeat through gears, or shift once per
   press? Zwift's own hold behavior unverified. Start with once-per-press + 500 ms
   repeat behind a setting; revisit after riding.
9. Default start gear: design says index 12 (ratio 2.40) "≈ Zwift default" — that Zwift
   defaults to gear 12 is INFERRED, not verified. Cosmetic; confirm if convenient.
10. **(New, 2026-07-28) Trainer Difficulty UI**: where does the slider live (global
    settings vs per-workout), does it persist across sessions, and what's the default
    (real Zwift defaults to 50%)? Product decision, no hardware dependency.
11. **(New, 2026-07-28) Personalized calibration pipeline shape**: is the intervals.icu
    Custom Activity Chart script (`experiments/intervals-icu-power-model-chart.js`) a
    one-off analysis tool, or does its fitted mass/Crr/Cw need a path *into* the app
    itself (e.g. a settings import, manual entry of the fitted numbers, or a future
    direct API integration)? Not decided — first priority is validating the fit method
    works at all (see experiments/09), the import path can be designed after.

## Roadmap (future sessions — no code was written in the design session)

### P1 — Foundations (pure logic, no BLE)
- `services/drivetrain.ts`: gear tables (Zwift-24 default), virtual-speed model,
  coast guard, clamps + unit tests (baseline identity, flat/descent behavior).
- `services/ftmsQueue.ts`: request-control-once, FIFO + coalescing (setSim last-write-
  wins; ERG/mode commands are barriers), serialize on 0x80, timeout+retry + unit tests
  against an extended `tests/mocks/ftms-mock.js`.
- Fix wind-speed unit bug in `setSim` (0.001 m/s).
- Retire multiplier model behind a `legacyMultiplier` setting for A/B comparison.

### P2 — Input abstraction
- `services/shiftInput.ts` (+ manager with fan-in and 150 ms min-interval).
- Migrate keyboard handler out of main.js; add Gamepad adapter.
- React: `ControllerContext`, `GearIndicator` in `ActiveView`; persistence additions
  (`gearIndex`, `gearTableId`, `riderMassKg`, `physicalRatio`, `controllerName`).

### P3 — Zwift Click adapter
- Bench: run HW-V1…V6 first; save hex dumps as parser fixtures.
- `services/zwiftClick.ts`: dual-UUID probe, RideOn handshake, 0x37/0x23/0x07 parser,
  0x15 liveness watchdog, battery events, optional haptic ack, reconnect-with-backoff.
- Connection UI: second connect button (own user gesture), status, battery.

### P4 — Validation & tuning
- HW-V7/V8/V10/V11; set `m_t`/trim; A/B legacy vs virtual-speed feel on a real route;
  update HYPOTHESES.md + design-doc ledger.
- HW-V12 shift-primitive bake-off (in progress, candidate (a) scored — see
  `experiments/08-hw-v12-bakeoff-partial.md`) — determines which FTMS mechanism (grade
  offset, Crr/Cw scale, Target Resistance, ERG) carries the drivetrain model's output to
  the trainer.

### P5 — Personalized calibration + Trainer Difficulty (supersedes the old "Plan A′" slot)

**Plan A′ (Zwift hub-protocol reverse engineering) is dropped, not deferred** — see
GOALS.md non-goals, 2026-07-28 decision. This phase now covers the two mechanics that
replaced it as the project's actual "how do we get Zwift-like feel" answer:

- **Trainer Difficulty**: implement the grade-only trim multiplier (GOALS.md
  requirement 8, `VIRTUAL_SHIFTING_DESIGN.md` §4.8) — applied after gear translation,
  route physics stays keyed to the real grade.
- **Personalized calibration**: validate the intervals.icu-based fitting method
  (`experiments/09-outdoor-stream-physics-regression.md` — built, not yet run) against
  real ride data; once it produces physically plausible mass/Crr/Cw, decide the import
  path into the app (open question 11) and update the drivetrain's default constants
  story from "one hardcoded set" to "per-rider calibratable."

## Top 5 findings that shaped the design (from the 2026-07-28 session)

1. Zwift virtual shifting = gear ratio ×10000 over a proprietary BLE service; trainer
   firmware computes resistance (not FTMS, not grade manipulation).
2. The KICKR Core supports that protocol natively since fw 1.3.17 — and the Feb-2026
   prototype failed only because it sent controller-family instead of hub-family messages.
3. The Zwift Click is fully speakable from Web Bluetooth (working prior art), via bare
   `RideOn` → plaintext protobuf; mind the FC82 advertisement change (Jan 2025 firmware).
4. Two concurrent GATT devices from one Chrome page is proven; two user gestures needed;
   permission persistence still flag-gated.
5. The gradient-multiplier model is physically wrong (dead at 0 %, inverted downhill);
   the virtual-speed model needs no calibration and collapses to identity in the
   baseline gear.

**Single riskiest assumption**: that the KICKR's internal rider-mass assumption is close
to ours (R3/U3) — measure it first (HW-V8) before implementing the drivetrain solve.
