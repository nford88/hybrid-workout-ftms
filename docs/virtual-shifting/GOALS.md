# Goals — Virtual Shifting

## Problem statement

The app already does ERG workouts and SIM (route-gradient) simulation over FTMS. During
SIM riding there is no good way to modulate effort the way a real bike does: the rider's
physical gear sets a resistance floor/ceiling, and the current "virtual gearing"
(gradient × multiplier) feels wrong — it does nothing on flat road, inverts on descents,
and requires a fragile calibration ritual.

**Goal: seamless virtual shifting, comparable to Zwift's, controllable from a Zwift
Click (and other inputs), implemented browser-first over Web Bluetooth.**

**Scope clarification (2026-07-28, user-driven, supersedes earlier framing below where
they conflict):** this is explicitly an FTMS-only reimplementation of the *effect* of
Zwift's virtual shifting, not a reverse-engineering of Zwift's proprietary protocol —
hacking Zwift's own wire format is out of scope (see "Non-goals"). Perfect physical
accuracy is also explicitly not the bar — the model will never exactly match every
rider's real-world power curve (it varies by weight, size, position). The bar is a
**validated, per-rider-calibratable curve**: a rider who shifts into "their 10%-grade
gear" indoors should feel roughly the power they'd produce on a real 10% climb, given
their own real riding data as the calibration source (see "Personalized calibration"
below). Once validated against one rider's data, the same calibration method must
generalize to any rider.

## Requirements

1. **Shift input abstraction** — device-agnostic event model; adapters:
   - Zwift Click over Web Bluetooth (primary; hardware is on hand)
   - Keyboard (exists today, to be migrated into the abstraction)
   - Gamepad API (fallback for devices Web Bluetooth can't reach)
2. **Physically correct drivetrain model** — shifting must change felt resistance on
   flats, climbs, and descents; the default/baseline gear must be exact with **no
   calibration**; gear tables are data (default: Zwift's 24 ratios 0.75–5.49).
3. **Composes with existing modes** — SIM: gear translation applied *after* route-grade
   smoothing; ERG: shifting is a no-op on resistance (gear state retained), matching
   Zwift behavior.
4. **Two concurrent BLE devices** — trainer + controller from one Chrome page, each with
   its own user-gesture chooser; in-session auto-reconnect.
5. **Responsive shifts** — bounded by trainer physics (~1–1.5 s felt on the FTMS path);
   command layer must not add avoidable latency (request control once, coalescing queue).
6. **State persistence** — gear index, gear table choice, rider mass, physical baseline
   ratio, controller identity.
7. **Testable** — pure-function drivetrain math and frame parsers with byte fixtures.
8. **Trainer Difficulty (trim)** — a user-facing 0-100% slider matching Zwift's real
   feature of the same name: scales the grade sent to the trainer
   (`grade_to_trainer = post-gear-translation grade × trim_fraction`) so climbs feel
   easier at lower settings. **Matches real Zwift's actual behavior, not a simplified
   version**: route progress (distance/speed) is computed from the rider's real measured
   power against the **real, un-trimmed** grade via the existing SIM physics
   (`simPhysics.ts`) — trim only affects felt resistance, never the route simulation.
   Applied *after* the drivetrain gear-translation step (§4.3), as its own independent
   multiplier — do not conflate with the mass/Crr/Cw **calibration** trim factor (R3),
   which is a per-rider correction, not a difficulty setting. See
   `VIRTUAL_SHIFTING_DESIGN.md` §4.8.
9. **Personalized calibration** — the drivetrain model's physics constants (rider mass,
   Crr, Cw) must be derivable from a rider's own real outdoor riding data (via
   intervals.icu or equivalent), not just the project's own hardcoded defaults
   (92kg/0.004/0.51). Validate the calibration method against one rider's data first
   (this project's own), then generalize so any user can produce their own working
   curve. See `experiments/09-outdoor-stream-physics-regression.md` for the tooling.

## Non-goals (for v1)

- Zwift Click **v2** vendor-unlock challenge replay. **Confirmed 2026-07-28** (see
  `experiments/03-click-buttons-partial.md` and `04-click-mapping-and-relay-confirmed.md`):
  this Click needs to be paired/synced in the real Zwift Companion app **at least once**
  before third-party BLE clients get a stable, long-lived connection — without it,
  connections drop every ~45–90s. Treat this as a **required one-time onboarding step**
  in the UX (surface clear instructions), not an edge case to merely detect.
- WebHID adapter (no concrete target device; Gamepad covers fallbacks).
- Native/WebSocket bridge (**explicitly not needed** — Web Bluetooth reaches the Click).
- Encrypted ZAP (ECDH/HKDF/AES-CCM) — plaintext mode works on all current firmware.
- ANT+ anything (Zwift virtual shifting itself is BLE/WiFi/DirectConnect only).
- **Reverse-engineering/reimplementing Zwift's proprietary hub protocol ("Plan A′",
  HW-V9) — explicitly out of scope (2026-07-28, user decision).** The goal is an
  FTMS-only equivalent *feel*, not Zwift-protocol compatibility. Previously scoped as an
  optional flag-gated stretch goal (see history in `RISKS-ROADMAP.md`); now formally
  dropped rather than merely deprioritized. Do not spend further session time on
  HW-V9 unless this decision is explicitly revisited.

## Hardware inventory

- **Trainer**: Wahoo KICKR Core V2 — exposes FTMS *and* the Zwift custom service
  (`00000001-19ca-4651-86e5-fa29dcdd09d1`), confirmed in past device logs. Firmware
  version must be checked (needs ≥ 1.3.17 for native virtual shifting) — HW-V1.
- **Controller**: Zwift Click — generation (v1 vs v2) unknown until HW-V2.
- **Bike**: Shimano 105 2×11 (50/34 × 11-28); convention: park in 34/17 for a fixed
  physical ratio (~2.0) and straight chainline.
- **Rider**: FTP ≈ 220 W (used only for display/zones now — the new model doesn't need it).

## Success criteria

- Shifting from the Click changes felt resistance within ~1.5 s in SIM mode, on flats
  and descents, not just climbs.
- Baseline gear reproduces plain route grade exactly (identity property).
- Keyboard and Click can be used interchangeably mid-workout.
- Trainer + Click stay concurrently connected for a full workout (Chrome desktop; then
  Android).
- Trainer Difficulty slider changes felt resistance without changing route
  speed/distance for a given real power output (matches real Zwift behavior).
- A rider's own real ride data (e.g. intervals.icu history) can be used to derive
  mass/Crr/Cw values that make indoor gear choices at a given grade feel like that
  rider's own real-world effort at that grade — validated on at least one rider before
  considered generalizable.
