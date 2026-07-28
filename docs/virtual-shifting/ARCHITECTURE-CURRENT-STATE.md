# Current-State Architecture (as of 2026-07-28)

All claims CONFIRMED from source; citations are `file:line` at commit `9de1af1`.

## 1. Module topology — React shell over a legacy vanilla-JS core

- `src/main.tsx` mounts `TrainerProvider → RouteProvider → WorkoutProvider → AppShell`.
- `AppShell.tsx:30` dynamically imports `src/js/main.js` **after** React mounts, so legacy
  code can bind to DOM IDs that React components render (e.g. `VirtualGearSettings.tsx`
  renders `#ftp-input` / `#baseline-gear-select` for main.js).
- `src/js/main.js` (1374 lines): IIFE chain populating `window.Hybrid` — `H.state`,
  `H.route`, `H.savedWorkouts`, `H.ui`, `H.graph`, `H.erg`, `H.sim`, `H.handlers`.
- `src/js/ftms.js` (1062 lines): creates `window.ftms = new FTMSClient()` and
  `window.ftms.virtualGear = new VirtualGear()` (ftms.js:1056-1061).
- Bridge = CustomEvents (`ftmsConnected`, `workoutStarted`, `simDistanceUpdated`, …) +
  `window.ftms.on('ibd', …)` (TrainerContext.tsx:37-67). React StrictMode double-mount is
  worked around with `subscribedRef` (TrainerContext.tsx:34-47).
- Pure TS services: `services/simPhysics.ts`, `routeService.ts`, `storage.ts`,
  `graphService.ts`, `workoutService.ts`; shared types in `src/types.ts`.
- ⚠️ `README.md` describes the pre-React architecture — stale.
- `ble_env/` is an abandoned Python venv (pyobjc, no project scripts) — ignore.

## 2. FTMS/BLE layer (`src/js/ftms.js`)

- UUIDs (ftms.js:19-31): FTMS `0x1826`; Feature `0x2ACC` (read), Indoor Bike Data
  `0x2AD2` (notify), Training Status `0x2AD3`, Control Point `0x2AD9` (write+indicate),
  Machine Status `0x2ADA` (subscribed but **ignored** — ftms.js:195-197). The Zwift
  custom service `00000001-19ca-…` is already in `optionalServices` and probed on the
  trainer (ftms.js:94-98, 133-153); its notifications are only hex-logged
  (ftms.js:202-215).
- Connection: `requestDevice` filtered on FTMS service or namePrefix; single device; no
  auto-reconnect; no `getDevices()` (ftms.js:89-108).
- **Control-point discipline**: every public op = Request Control (0x00) → wait 0x80 ACK
  → actual opcode → wait ACK (ftms.js:344-395). Two write+indicate round trips per
  command. Per the FTMS spec this is unnecessary — control persists (see PROTOCOLS.md §3).
- **ACK handling**: single `_pendingAck` slot; a new command rejects the in-flight waiter
  (`'Replaced by new command'`, ftms.js:303-341, 402-418). **No queue — rapid callers race.**
- Commands: `setErgWatts` = 0x05 + u16le watts (ftms.js:224-231); `setSim` = 0x11 + wind
  s16 + grade s16 + Crr u8 + Cw u8 (ftms.js:237-262); `rampSim` = setSim loop with dwell
  (ftms.js:267-294). Not implemented: 0x12 wheel circumference, 0x13 spin down, 0x01 reset.
- ⚠️ **Latent bug**: ftms.js:241 encodes wind at 0.01 m/s; spec says 0.001 m/s
  (harmless while wind is always 0 — fix when touching `setSim`).
- IBD parsing (ftms.js:420-513): flag-aware; speed 0.01 km/h, cadence 0.5 rpm,
  resistance level, power s16 W.

## 3. SIM-mode pipeline (gradient → resistance)

```
IBD notify (speed) ──2 s throttle──▶ handleFtmsData (main.js:985-1004)
  ─▶ updateSimMode (main.js:883-977): distance += v·dt; route-completion detection;
       route grade lookup at distance
  ─▶ setSimGrade (main.js:783-853):
       calculateRealisticGrade (simPhysics.ts:12-59)
         • ramp: ≥10 m between targets, ≤1.5 %/ramp, ≤0.5 %/s slew
         • momentum: −25 %·min(1, kph/12) grade reduction; floor −2 %
       virtualGear.applyToGradient (ftms.js:836-844): grade × multiplier, clamp [−10,+20]
       throttle: 3 s min interval + 0.3 % deadband; bypass via forceUpdate (main.js:813-826)
  ─▶ ftms.setSim(0x11) with crr=0.003, cwa=0.45, wind=0
```

- ERG steps: one `setErgWatts(step.power)` + `setTimeout` for duration (main.js:1110-1119).
- SIM-step entry: `setErgWatts(0)` → 250 ms → `rampSim` into first grade (main.js:1146-1154).

## 4. Virtual gearing as implemented today (to be replaced)

- `VirtualGear` (ftms.js:736-1045): 22-gear Shimano 105 table, ratios 1.21–4.55
  (ftms.js:739-762); default/baseline index 5 = 34/17; `shiftUp()/shiftDown()`;
  `gearChange` emitter.
- Resistance model = **multiplier vs baseline**, sourced from:
  1. `CALIBRATION_V1` hardcoded measured curve (FTP 220 W, baseline 34/17, tested
     2026-02-19; multipliers 0.47–4.31) loaded in constructor (ftms.js:524-734, 783);
  2. FTP-based Coggan curve (`generateFTPBasedCurve`, ftms.js:858-900) — ⚠️ **overwrites
     the calibrated curve on boot** because `initVirtualGearingSettings` always calls
     `setFTP()` (main.js:521-529);
  3. raw ratio fallback (ftms.js:830-833).
- Application: SIM `applyToGradient = grade × multiplier` (ftms.js:836-844); ERG
  `applyToPower = power × multiplier` (ftms.js:847-855) — not wired into ERG steps
  (only the POC page uses it).
- Input: keyboard only — `←`/`[` down, `→`/`]` up, only while a SIM step runs
  (main.js:625-643). On shift, `forceSimGradeUpdate()` re-sends grade immediately
  (main.js:1339-1350).
- Persistence: FTP + baseline gear in localStorage (storage.ts:100-110). Gear index is
  NOT persisted.
- UI: legacy `#target-display` text (main.js:1324-1337); `VirtualGearSettings.tsx`
  settings form; no React gear indicator.

### Why this model is being replaced (critique)

1. **Zero-grade dead zone**: `grade × multiplier` ⇒ no shift effect at 0 %.
2. **Descent inversion**: harder gear × negative grade = steeper descent = *less*
   resistance.
3. **Calibration coupling**: multipliers bake the rider's cadence preference into the
   machine model, via an unreproducible "paste into ChatGPT" interpolation step (the
   workflow the deleted `VIRTUAL_GEARING_WORKFLOW.md`/`AI_PROMPT_TEMPLATE.md` notes
   described; `power-curve-calibration.html` was its data-collection page).
4. **ERG distortion**: scaling the ERG target contradicts ERG's purpose; Zwift disables
   gear feel in ERG.

## 5. Dev prototypes (`src/dev/`) — prior hardware experiments

See HYPOTHESES.md for the experiment ledger. Files:

- `zwift-virtual-shifting.html` (2822 lines) — Feb-2026 live experiments vs the KICKR
  Core V2. Recorded results at lines 250-399: trainer exposes the Zwift service; ACKs
  RideOn frames (`52 69 64 65 4F 6E 02 02`) but **no resistance change**; FTMS
  wheel-circumference unsupported (feature bit absent, lines 846-860 — and the prototype
  used opcode 0x13, which is actually Spin Down; wheel circumference is 0x12).
- `zwift-virtual-shifting-backup.html` — older revision of the same.
- `virtual-shifting-poc.html` (796 lines) — app-level multiplier POC; has the useful
  `commandInProgress` mutex + `pendingGearChange` retry pattern (lines ~481-700).
- `power-curve-calibration.html` — 8-gear calibration test (feeds the obsolete
  multiplier model; keep only as a validation harness).
- `bluetooth-test.html`, `ftms-calibration-test.html` — generic BLE/FTMS debug pages.

## 6. Test coverage relevant to shifting

- Covered: sim physics (tests/unit/sim-mode.test.js), ERG flow, route processing,
  storage, workout flow, step transitions, graph.
- **Not covered**: `VirtualGear` (zero tests), shift handlers, FTMS ACK behavior under
  rapid commands. E2E mocks stub `virtualGear = null` (tests/e2e/workout.spec.js:13).
- Useful mock to extend: `tests/mocks/ftms-mock.js`.
