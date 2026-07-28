# Goals — Virtual Shifting

## Problem statement

The app already does ERG workouts and SIM (route-gradient) simulation over FTMS. During
SIM riding there is no good way to modulate effort the way a real bike does: the rider's
physical gear sets a resistance floor/ceiling, and the current "virtual gearing"
(gradient × multiplier) feels wrong — it does nothing on flat road, inverts on descents,
and requires a fragile calibration ritual.

**Goal: seamless virtual shifting, comparable to Zwift's, controllable from a Zwift
Click (and other inputs), implemented browser-first over Web Bluetooth.**

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

## Non-goals (for v1)

- Zwift Click **v2** vendor-unlock challenge replay (detect + surface workaround only).
- WebHID adapter (no concrete target device; Gamepad covers fallbacks).
- Native/WebSocket bridge (**explicitly not needed** — Web Bluetooth reaches the Click).
- Encrypted ZAP (ECDH/HKDF/AES-CCM) — plaintext mode works on all current firmware.
- ANT+ anything (Zwift virtual shifting itself is BLE/WiFi/DirectConnect only).

## Stretch goal (flag-gated "Plan A′")

Trainer-native shifting via the KICKR Core's Zwift hub protocol (firmware-side
resistance computation = Zwift-identical instant feel). Depends on hardware experiment
HW-V9 (see VALIDATION-PLAN.md).

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
