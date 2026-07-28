# Risks, Open Questions, Roadmap

## Risks

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| R1 | Reverse-engineered protocol drift — Zwift changed the Click's advertised UUID in Jan 2025 and could change framing again | Click adapter breaks after a firmware update | Probe both service UUIDs; detect variant from frame type; keyboard/gamepad adapters always work |
| R2 | Click v2 vendor lock (~60 s disconnect without recent real-Zwift unlock) | Sessions unusable on a v2 unit | Detect + surface the "pair once with real Zwift" workaround; challenge replay out of scope for v1 |
| R3 | Trainer's internal rider mass unknown (U3) | Grade-solve error scales proportionally — **the riskiest assumption in the whole design** | HW-V8 measurement; single user-visible "feel" trim factor; baseline gear is exact regardless (identity property) |
| R4 | Grade clamp saturation (hard gear + steep grade + low flywheel speed ⇒ `G_send` beyond trainer range) | Feel flattens at extremes | Clamp + "at limit" UI hint; Plan A′ eliminates the class |
| R5 | App-side latency ceiling ~1–1.5 s felt (trainer-bound) | Shifts respond but not Zwift-instant | Accepted for v1; Plan A′ (firmware-side) is the only true fix |
| R6 | Chrome permission persistence still flag-gated | Chooser click needed after every reload | Accepted; revisit when Chrome ships the new permissions backend by default |
| R7 | Legacy/React split — new state accreting onto `window.Hybrid` | Architecture debt compounds | New code lives in typed services + contexts only; StrictMode double-mount already bit once (TrainerContext.tsx:34-47) |
| R8 | Android screen-lock kills BLE | Workout interruption on mobile | Pre-existing constraint (README); note in UX; HW-V11 |

## Open questions

1. Does the KICKR FTMS path tolerate 2 Hz 0x11 bursts around shifts? (HW-V10)
2. Is QZ's ×(42/14) hub-command normalization Hub-specific or universal? (HW-V9)
3. Should momentum assist (simPhysics.ts:48-53) apply before or after gear translation?
   Design says before (it's route feel, not drivetrain feel) — validate subjectively.
4. Buy a Zwift Cog? Not protocol-relevant; would remove cross-chain noise. The 34/17
   parking convention already gives a fixed physical ratio.
5. Should gear state persist across page reloads or reset to baseline? (Design: persist
   `gearIndex`; revisit after riding with it.)
6. **Baseline-identity gap in the Zwift-24 table**: the identity property (`G_send = G`
   exactly) holds only when a gear's ratio equals the physical ratio `r_phys`. With the
   34/17 convention `r_phys = 2.0`, but Zwift's 24 ratios skip 2.0 (nearest: 2.04) — so
   no gear is *exactly* neutral. Options: (a) insert `r_phys` as an extra gear, (b) snap
   the nearest table entry to `r_phys`, (c) accept the ~2 % error. Decide in P1; the
   drivetrain unit tests should encode whichever choice is made.
7. **Crr/Cw consistency**: the grade-solve must use the *same* Crr/Cw constants that are
   transmitted in 0x11, or the solve is self-inconsistent. App currently sends
   crr=0.003 / cwa=0.45 (main.js:970-975); Zwift sends 0.0051 / 0.41. Values are a feel
   choice, but define them in one place shared by `drivetrain.ts` and the FTMS layer.
8. **Hold-to-repeat policy**: the Click streams repeat frames while held (QZ re-shifts
   every 500 ms). Should holding a shifter auto-repeat through gears, or shift once per
   press? Zwift's own hold behavior unverified. Start with once-per-press + 500 ms
   repeat behind a setting; revisit after riding.
9. Default start gear: design says index 12 (ratio 2.40) "≈ Zwift default" — that Zwift
   defaults to gear 12 is INFERRED, not verified. Cosmetic; confirm if convenient.

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

### P5 — Plan A′ (optional, flag-gated)
- HW-V9 spike on the trainer's Zwift service (hub handshake, init, gear ratio commands).
- If it works: `services/zwiftHub.ts` premium path with automatic FTMS fallback;
  FTMS CP suppressed while native mode is active (QZ precedent).

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
