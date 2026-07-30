# Virtual Shifting Design — FTMS Hybrid Workout App

> Date: 2026-07-28 · Status: DESIGN (no code changes in this session)
> Deliverable of a deep-dive session: codebase comprehension → external protocol research →
> gap analysis → design. Every codebase claim cites `file:line`; every external claim cites
> its source. Claims are labeled **CONFIRMED** / **INFERRED** / **UNKNOWN**.
>
> **Companion knowledge base**: [virtual-shifting/](virtual-shifting/README.md) — the same
> material split into focused files for future sessions: [goals](virtual-shifting/GOALS.md),
> [current architecture](virtual-shifting/ARCHITECTURE-CURRENT-STATE.md),
> [byte-level protocols](virtual-shifting/PROTOCOLS.md),
> [research + sources](virtual-shifting/RESEARCH.md),
> [tested/untested hypotheses](virtual-shifting/HYPOTHESES.md),
> [hardware validation plan](virtual-shifting/VALIDATION-PLAN.md),
> [risks + roadmap](virtual-shifting/RISKS-ROADMAP.md).
> When hardware experiments run, update HYPOTHESES.md **and** the ledger in §2.6 here.

---

## Table of contents

1. [Current-state architecture](#1-current-state-architecture-confirmed-from-source)
2. [Protocol findings + evidence ledger](#2-protocol-findings-external-research)
3. [Gap analysis](#3-gap-analysis)
4. [Proposed design](#4-proposed-design)
5. [Hardware validation plan](#5-hardware-validation-plan)
6. [Risks, open questions, phased outline](#6-risks-open-questions-implementation-phases)
7. [Adversarial self-review](#7-adversarial-self-review)

---

## 1. Current-State Architecture (CONFIRMED from source)

### 1.1 Module topology

The app is a **React 19 + TypeScript shell wrapped around a legacy vanilla-JS core**,
bridged by `window` globals and CustomEvents:

- `src/main.tsx` mounts `TrainerProvider → RouteProvider → WorkoutProvider → AppShell`.
- `AppShell.tsx:30` dynamically imports `src/js/main.js` **after** React mounts so the
  legacy code can find the DOM IDs that React components render (e.g.
  `VirtualGearSettings.tsx` renders `#ftp-input`, `#baseline-gear-select` for main.js to bind).
- `src/js/main.js` (1374 lines) is an IIFE chain populating `window.Hybrid`:
  `H.state`, `H.route`, `H.savedWorkouts`, `H.ui`, `H.graph`, `H.erg`, `H.sim`, `H.handlers`.
- `src/js/ftms.js` (1062 lines) creates `window.ftms = new FTMSClient()` and
  `window.ftms.virtualGear = new VirtualGear()` (ftms.js:1056-1061).
- React contexts listen to CustomEvents (`ftmsConnected`, `workoutStarted`,
  `simDistanceUpdated`, …) and to `window.ftms.on('ibd', …)` (TrainerContext.tsx:37-67).
- Extracted pure services (TypeScript): `services/simPhysics.ts`, `routeService.ts`,
  `storage.ts`, `graphService.ts`, `workoutService.ts`; types in `src/types.ts`.
- NOTE: `README.md` still describes the pre-React architecture; it is stale.

### 1.2 FTMS/BLE layer (`src/js/ftms.js`)

- **Services/characteristics** (ftms.js:19-31): FTMS `0x1826` with Feature `0x2ACC` (read),
  Indoor Bike Data `0x2AD2` (notify), Training Status `0x2AD3`, Control Point `0x2AD9`
  (write+indicate), Machine Status `0x2ADA`. Additionally the **Zwift custom service
  `00000001-19ca-4651-86e5-fa29dcdd09d1`** is already in `optionalServices` and probed on
  the trainer (ftms.js:94-98, 133-153) with RD `…0002` (notify), CP `…0003` (write),
  SyncTX `…0004` (indicate) — currently only hex-logged (ftms.js:202-215).
- **Connection**: `requestDevice` filtered on FTMS service (or namePrefix); single device;
  `gattserverdisconnected` → emits `disconnected`; no auto-reconnect, no `getDevices()`
  persistence (ftms.js:89-108).
- **Control Point discipline** (ftms.js:344-395): every public op sends
  Request Control (0x00), waits for its 0x80 indication ACK, then writes the actual opcode
  and waits again. **Each ERG/SIM command therefore costs two write+indicate round trips.**
- **ACK handling** (ftms.js:303-341, 402-418): a single `_pendingAck` slot; issuing a new
  command while one is in flight rejects the prior waiter (`'Replaced by new command'`).
  There is **no command queue** — rapid callers race.
- **Commands implemented**: `setErgWatts` → opcode 0x05 + u16le watts (ftms.js:224-231);
  `setSim` → opcode 0x11 + wind s16 (0.01 m/s)¹ + grade s16 (0.01 %) + Crr u8 (0.0001) +
  Cw u8 (0.01 kg/m) (ftms.js:237-262); `rampSim` = loop of `setSim` with dwell
  (ftms.js:267-294). No 0x12 (wheel circumference), no Spin Down (0x13), no Reset (0x01).
  ¹ Note: the spec unit for wind speed is **0.001 m/s** (FTMS v1.0 Table 4.20); ftms.js:241
  encodes at 0.01 m/s — a latent 10× wind-speed bug, harmless today because wind is always 0.
- **IBD parsing** (ftms.js:420-513): flag-aware parse of speed (0.01 km/h), cadence
  (0.5 rpm), resistance level, power (s16 W).

### 1.3 SIM-mode pipeline (gradient → trainer resistance)

```
IBD notify (speed) ──2 s throttle──▶ H.handlers.handleFtmsData (main.js:985-1004)
  ─▶ H.sim.updateSimMode (main.js:883-977): integrate distance = v·dt,
       detect route completion, look up route grade at distance
  ─▶ H.sim.setSimGrade (main.js:783-853):
       calculateRealisticGrade (simPhysics.ts:12-59)
         • ramp: ≥10 m between grade targets, ≤1.5 %/ramp, ≤0.5 %/s slew
         • momentum: up to −25 % grade reduction, scaling to full at ≥12 kph
         • floor at −2 %
       virtualGear.applyToGradient (ftms.js:836-844): grade × multiplier, clamp [−10, +20]
       throttle: 3 s min interval + 0.3 % deadband, bypassed by forceUpdate (main.js:813-826)
  ─▶ ftms.setSim (0x11) with crr=0.003, cwa=0.45, wind=0
```

ERG steps: `setErgWatts(step.power)` once per step + `setTimeout` for duration
(main.js:1110-1119). SIM-step entry does `setErgWatts(0)`, 250 ms wait, then
`rampSim` into the first grade (main.js:1146-1154).

### 1.4 Virtual gearing as it exists today

- **`VirtualGear` class** (ftms.js:736-1045): 22-gear Shimano 105 2×11 table
  (34/50 × 11-28) with ratios 1.21–4.55 (ftms.js:739-762); current/baseline gear index
  (default 5 = 34/17); `shiftUp()/shiftDown()`; event emitter for `gearChange`.
- **Resistance model = multiplier on the baseline**, sourced from one of:
  1. `CALIBRATION_V1` hardcoded measured power curve (FTP 220 W, baseline 34/17, tested
     2026-02-19, 8 measured + 14 interpolated gears; multipliers 0.47–4.31)
     (ftms.js:524-734), loaded in the constructor (ftms.js:783);
  2. an FTP-based Coggan cadence-power model (`generateFTPBasedCurve`, ftms.js:858-900) —
     **which overwrites the calibrated curve on boot**, because
     `initVirtualGearingSettings` always calls `setFTP()` (main.js:521-529);
  3. fallback pure gear-ratio ratio (ftms.js:830-833).
- **Application points**: SIM `applyToGradient(grade) = grade × multiplier`
  (ftms.js:836-844); ERG `applyToPower(power) = power × multiplier`, clamp [50, 2000] W
  (ftms.js:847-855) — not wired into the ERG step path (only the POC uses it).
- **Input**: keyboard only — `←`/`[` shift down, `→`/`]` shift up, active only while a
  SIM step is running (main.js:625-643). On shift, `forceSimGradeUpdate()` re-sends the
  current grade immediately with `forceUpdate: true` (main.js:1339-1350).
- **Persistence**: FTP + baseline gear index in localStorage (storage.ts:100-110);
  the current gear index is NOT persisted.
- **UI**: legacy `#target-display` text appended with gear info (main.js:1324-1337);
  `VirtualGearSettings.tsx` renders the FTP/baseline form; no React gear indicator.

### 1.5 Prior hardware experiments (dev prototypes, KICKR Core V2)

Recorded results inside `src/dev/zwift-virtual-shifting.html` (test-notes sections,
lines 250-399) — evidence from a past live session against this trainer:

- The KICKR Core V2 **exposes the Zwift custom service** `00000001-19ca-…` itself
  (lines 973-975, 1002-1005: "found on your trainer!").
- Writing RideOn-prefixed protobuf frames (SET_GEAR_TEST_DATA 0xFF04 patterns, Data
  Object IDs 529/532/547, simulated-gear-ratio messages) to the trainer's Zwift CP:
  commands are **ACKed** (`52 69 64 65 4F 6E 02 02`) and Riding Data notifications flow,
  but **no physical resistance change ever occurred** (lines 318-331).
- FTMS wheel-circumference commands failed; the trainer's feature bits show the target
  unsupported (lines 846-860). (The prototype used opcode 0x13 — per FTMS v1.0 Table 4.15
  wheel circumference is actually **0x12** and 0x13 is Spin Down, so those experiments
  were also sending the wrong opcode; either way the feature bit is absent.)
- Recorded conclusion (lines 333-346): the working approach is qdomyos-style —
  *parse gear input → compute resistance app-side → send standard FTMS*; sending
  Zwift-**controller** commands to the trainer's Zwift service was the wrong model.
  §2.2 below shows there is also a correct **hub-protocol** command family the
  prototype never tried.
- `src/dev/virtual-shifting-poc.html` then implemented the app-level approach on top of
  `VirtualGear` with a debounced auto-apply, a `commandInProgress` mutex and a
  `pendingGearChange` retry (lines ~481-700) — a useful precedent for the shift-command
  serialization the real feature needs.
- `ble_env/` is an abandoned Python venv (pyobjc; no project scripts) — ignore.

### 1.6 Test coverage relevant to shifting

- Covered: sim physics smoothing/momentum (tests/unit/sim-mode.test.js), ERG flow,
  route processing, storage, workout flow/transitions, graph.
- **Not covered**: `VirtualGear` (no unit tests at all), shift handlers, FTMS command
  serialization/ACK behavior under rapid commands, `applyToGradient` clamping.
  E2E mocks stub `virtualGear = null` (tests/e2e/workout.spec.js:13).

### 1.7 Critical evaluation of the current model

The current **gradient-multiplier** model (implemented in `VirtualGear`, and formerly
described in two since-deleted working notes, `VIRTUAL_GEARING_WORKFLOW.md` and
`AI_PROMPT_TEMPLATE.md`, whose workflow was: run an 8-gear power calibration → paste the
data into ChatGPT/Claude → paste the returned multiplier curve into `ftms.js`). Problems:

1. **Zero-grade dead zone**: `effectiveGrade = grade × multiplier` ⇒ shifting has *no
   effect on flat road* (0 × anything = 0) and near-zero effect at small grades. Real
   gearing changes resistance everywhere, including flats.
2. **Descent inversion**: on −5 %, a harder gear (×1.76) makes the grade *more negative*
   (−8.8 %) → *less* resistance. The note frames this as anti-spinout, but a harder gear
   on a real descent gives you *more* to push against at a given wheel speed.
3. **Calibration coupling**: multipliers derived from measured *power at self-selected
   cadence* conflate the rider's power-cadence preference with the machine's
   speed-resistance curve; the "paste into ChatGPT" interpolation step adds unauditable
   error and is not reproducible.
4. **ERG interaction**: `applyToPower` changes the ERG target on shift — but ERG's point
   is cadence-independent fixed power; Zwift disables gear feel in ERG.

These motivate replacing the multiplier model with the physically grounded
**virtual-speed model** (§4.3), which needs *no* per-gear calibration.

---

## 2. Protocol findings (external research)

### 2.1 How Zwift actually implements virtual shifting — CONFIRMED

- **Mechanism**: virtual shifting requires the proprietary **"Zwift protocol"** over the
  custom BLE service — *not* FTMS. "FTMS compatibility alone doesn't enable virtual
  shifting" ([zwiftinsider.com/virtual-shifting-support-status](https://zwiftinsider.com/virtual-shifting-support-status/)).
- **What is transmitted**: reverse engineering of the trainer-side protocol shows Zwift
  sends a protobuf `HubCommand` (message 0x04) containing `SimulationParam { Wind,
  InclineX100, CWa, Crr }` **plus** `PhysicalParam { GearRatioX10000, BikeWeightX100,
  RiderWeightX100 }`. On a shift, the app sends the **new gear ratio ×10000**; the
  trainer firmware combines ratio + grade + mass and computes resistance locally
  ([makinolo.com Zwift Trainer protocol](https://www.makinolo.com/blog/2024/10/20/zwift-trainer-protocol/)).
  Zwift pins the sim constants (wind 0, CWa 0.51, Crr 0.004) and owns aero/draft in-game.
- **Trainer reports virtual speed**: the Zwift-service riding-data message (0x03) carries
  a *calculated virtual speed* (flywheel state remapped through the current virtual
  ratio), unlike FTMS IBD speed (same source).
- **Why it feels seamless**: the resistance loop runs *inside the firmware* (no BLE round
  trip per physics tick), and the chain/flywheel never physically move during a shift —
  only the brake force is recomputed. DC Rainmaker measured shifts as effectively
  instant, under full load ([dcrainmaker.com Zwift Click review](https://www.dcrainmaker.com/2023/10/zwift-clicks-review.html)).
  No public source documents an explicit smoothing constant (INFERRED: continuity comes
  from flywheel momentum + proportional force change, possibly a firmware ramp).
- **Zwift Cog** = single 14 t cog replacing the cassette; it pins the physical ratio to
  chainring/14 t so firmware has one known flywheel↔pedal mapping; Zwift auto-detects the
  chainring. Virtual shifting also works with a normal cassette left in one gear
  ([zwiftinsider.com/virtual-shifting](https://zwiftinsider.com/virtual-shifting/)).
- **Zwift's gear table**: 24 ratios, 0.75 → 5.49
  (0.75, 0.87, 0.99, 1.11, 1.23, 1.38, 1.53, 1.68, 1.86, 2.04, 2.22, 2.40, 2.61, 2.82,
  3.03, 3.24, 3.49, 3.74, 3.99, 4.24, 4.54, 4.84, 5.14, 5.49) — confirmed both in
  SHIFTR's docs ([JuergenLeber/SHIFTR VirtualShifting.md](https://github.com/JuergenLeber/SHIFTR/blob/main/VirtualShifting.md))
  and as hardcoded varints in qdomyos-zwift
  (`src/characteristics/characteristicwriteprocessor0003.cpp:60-125`).
- **KICKR Core (this project's trainer)**: firmware **v1.3.17 (2024-02-08)** added Zwift
  virtual shifting to all existing Cores
  ([zwiftinsider.com/kickr-core-firmware-v1-3-17](https://zwiftinsider.com/kickr-core-firmware-v1-3-17/)).
  This explains why the trainer already exposes the Zwift service (§1.5). FTMS and the
  Zwift service are advertised **in parallel**; power/cadence agree across them.
- **The shift path runs through the app**: Click → app → trainer. The Click never talks
  to the trainer directly ([dcrainmaker.com](https://www.dcrainmaker.com/2023/10/zwift-clicks-review.html)).

### 2.2 qdomyos-zwift (QZ) — the working open-source implementation — CONFIRMED

Repo `cagnulein/qdomyos-zwift`, inspected at master (2026-07-28):

- **Zwift Click/Play client**: `src/zwift_play/` (ported from ajchellew's zaplibrary,
  PR #2089, Feb 2024). Plain `RideOn` (no key) written to SYNC RX ⇒ **unencrypted mode**;
  full AES-CCM/ECDH code exists but is `#if 0`-ed out (`abstractZapDevice.h:10-15`).
  Click frame type 0x37: `bytes[2]==0` → shift-up pressed, `bytes[4]==0` → shift-down
  (inverse logic), 500 ms auto-repeat, optional debounce (`abstractZapDevice.h:51-295`).
  Haptic ack: write `12 12 08 0A 06 08 02 10 00 18 <pattern>` to SYNC RX.
- **Gear state**: `double m_gears` in `src/devices/bike.h:111`; `setGears()` clamps 1–24
  in Zwift-ratio mode and **immediately re-sends the last resistance/inclination**
  (`bike.cpp:208-314`).
- **Three resistance paths** (`src/devices/ftmsbike/ftmsbike.cpp`):
  - **(a) FTMS grade offset (default)**: rewrite the 0x11 grade —
    `slope += gearsModifier() × 50` (0.01 % units ⇒ **+0.5 % grade per gear step**;
    `ftmsbike.h:125`, `ftmsbike.cpp:1815-1950`). Additive, not multiplicative — works on
    flats. Crude but universal.
  - **(b) Resistance-level offset** for resistance-mode devices.
  - **(c) Trainer-native Zwift hub protocol** (`gears_zwift_ratio`): when the *trainer*
    has the Zwift service, QZ performs the **hub handshake `RideOn 0x02 0x01` + init
    writes** (`zwiftPlayInit()`, ftmsbike.cpp:203-240), sends inclination as protobuf
    `SimulationParam` (`sendZwiftPlayInclination()`, :411-427), and on shift sends the
    protobuf gear command `gear_value = 10000 × (ratio/original_ratio) × (42/14)` followed
    by "gearApply" bytes `00 08 88 04` (:559-612). Quirk: a 0.4 % inclination command must
    precede the first gear command (:560-565). FTMS control-point writes are **suppressed**
    in this mode (:89-105).
- **Why the Feb-2026 prototype failed** (INFERRED, high confidence): it sent
  **controller-family** messages (`SET_GEAR_TEST_DATA` 0xFF04, Data-Object IDs 529/532)
  with a bare/controller handshake to the **trainer's** Zwift service, instead of the
  **hub-family** command (0x04 + ratio×10000) with the hub handshake (`RideOn 02 01`) and
  init sequence. The trainer politely ACKed unknown messages and ignored them.

### 2.3 Zwift Click BLE protocol (for a Web Bluetooth client) — CONFIRMED

Sources: [ajchellew/zwiftplay](https://github.com/ajchellew/zwiftplay),
[makinolo.com Play protocol](https://www.makinolo.com/blog/2023/10/08/connecting-to-zwift-play-controllers/),
[makinolo.com Ride protocol](https://www.makinolo.com/blog/2024/07/26/zwift-ride-protocol/),
[OpenBikeControl/bikecontrol](https://github.com/OpenBikeControl/bikecontrol) (formerly
SwiftControl), [lord's Web Bluetooth gist](https://gist.github.com/lord/7a4e1fccf4ceb25943a5e08abe4a7f34).

- **Advertisement**: device name exactly **"Zwift Click"**; manufacturer data company ID
  0x094A ("Zwift, Inc"), byte 0 = device type (0x09 Click v1; 0x0A/0x0B Click v2 R/L —
  v2 codes unconfirmed across sources). Service UUID in the advertisement is
  **firmware-dependent**: `00000001-19ca-4651-86e5-fa29dcdd09d1` on older firmware,
  replaced by 16-bit **`0xFC82`** (`0000fc82-0000-1000-8000-00805f9b34fb`) after a
  Jan-2025 firmware update. **Characteristic UUIDs stay `0000000{2,3,4}-19ca-…` under
  both services.** A client must probe both.
- **Characteristics**: `…0002` ASYNC (notify — buttons/idle/battery), `…0003` SYNC RX
  (write — handshake/commands), `…0004` SYNC TX (indicate — handshake response). Plus
  standard Battery (0x180F) and Device Information (0x180A) services.
- **Handshake**: write the 6 bytes `RideOn` (`52 69 64 65 4F 6E`) to SYNC RX with **no
  key appended** ⇒ unencrypted mode on all current firmware (discovery credited to
  cagnulein, Feb 2024, [zwiftplay PR #3](https://github.com/ajchellew/zwiftplay/pull/3)).
  Device replies on SYNC TX with `RideOn` + 2 status bytes (Click v1 `01 03`, v2 `02 03`).
  The encrypted variant (RideOn + 2 bytes + 64-byte P-256 key → ECDH/HKDF/AES-CCM) exists
  but is **never needed** by third-party clients today.
- **Button frames** (ASYNC, plain protobuf, byte 0 = type):
  - **Click v1, type `0x37`**: `37 08 <up> 10 <down>`, **inverse logic** (0 = pressed):
    idle `37 08 01 10 01`; up-pressed `37 08 00 10 01`; down-pressed `37 08 01 10 00`.
    Frames repeat while held — dedupe client-side.
  - **Click v2 / Play fw2 / Ride, type `0x23`**: field 1 = 32-bit active-low button
    bitmap varint (all-released payload `08 FF FF FF FF 0F`); shift-up/down masks exist
    per side (e.g. 0x200/0x400 left, 0x2000/0x4000 right).
  - **Play fw1, type `0x07`**: PlayKeyPadStatus protobuf (fields for pads, shift, analog).
  - Type `0x15` = ~1 Hz idle keepalive (device→client); `0x19` = battery level
    (`19 08 <level>`); `0x2A` = initial status.
- **Keepalive**: none required client→device for Click v1. **Click v2 caveat**: it
  disconnects ~1 min after connection unless it has recently (≲24 h) completed a
  proprietary vendor "unlock" (0xFF-family challenge) with the real Zwift app; BikeControl
  replays the captured challenge ([swiftcontrol TROUBLESHOOTING](https://github.com/jonasbark/swiftcontrol/blob/main/TROUBLESHOOTING.md), bikecontrol issue #68).
- **Idle power-off**: Click powers off ~1 min when unconnected; a button press wakes it
  and it advertises for a short window.
- **Web Bluetooth prior art — it works**: (a) lord's gist is a complete working
  single-file Web Bluetooth page for the Ride/Click family (requestDevice → getPrimaryService
  FC82 → RideOn → parse 0x23); (b) BikeControl ships a working Flutter-**web** build that
  reads Click/Play buttons in the browser. On web, manufacturer data is not available at
  chooser time, so device *variant* detection must come from the frames themselves
  (0x37 vs 0x23), not the advertisement.

### 2.4 FTMS spec details relevant to shifting — CONFIRMED (FTMS v1.0)

- **0x11 Set Indoor Bike Simulation Parameters** (§4.16.2.18, Table 4.20): wind sint16
  @ **0.001 m/s**, grade sint16 @ 0.01 %, Crr uint8 @ 0.0001, Cw uint8 @ 0.01 kg/m
  (Cw ≡ lumped ½ρ·Cd·A). No app-visible valid-range characteristic; out-of-range ⇒
  result 0x03 Invalid Parameter. Zwift observed sending Crr byte 51, Cw byte 41
  ([ftmsemu.github.io](https://ftmsemu.github.io/)).
- **ERG↔SIM precedence** (§4.16.2.22): last-write-wins — a 0x11 aborts a prior 0x05
  target and vice versa ("should", so firmware latitude exists).
- **Control** (§4.16.2.1): Request Control (0x00) once; permission persists until
  disconnect, Machine Status `0xFF Control Permission Lost`, or Reset (0x01) — Reset also
  **relinquishes control**. ⇒ Per-command 0x00 (current ftms.js behavior) is unnecessary.
- **Rate limiting** (§4.16.3-4): one procedure at a time; a write while a procedure is in
  progress must be rejected ATT "Procedure Already In Progress". Correct client = strict
  serialization on the 0x80 indication. Zwift sends 0x11 continuously (~1 Hz / on-change,
  INFERRED from packet observations); Zwift implements its own retry + "request took too
  long → reset trainer" logic. Felt latency from command to resistance change on real
  hardware ≈ **1–1.5 s** ([Berg0162/simcline](https://github.com/Berg0162/simcline)).
- **0x12 Set Wheel Circumference** (uint16 @ 0.1 mm) is the correct opcode (0x13 is Spin
  Down Control). Feature-gated; absent on the KICKR Core per §1.5 experiments.
- **Trainer-side physics** (convention, not in the spec; documented by
  [ftmsemu.github.io](https://ftmsemu.github.io/) and consistent with the FE-C model):
  `F = m·g·sin(atan(G)) + m·g·cos(atan(G))·Crr + Cw·(v+v_wind)²`, `P = F·v`; the trainer
  measures flywheel speed and sets brake force so the rider must produce `P`. **Rider
  mass is NOT transmitted in FTMS** — the trainer uses its own configured/default mass.
  (Zwift's proprietary `PhysicalParam` exists precisely to fix this.)

### 2.5 Web platform feasibility — CONFIRMED

- **Two simultaneous GATT connections from one page: yes.** Spec has no limit
  ([web-bluetooth #195](https://github.com/WebBluetoothCG/web-bluetooth/issues/195));
  production proof: [Auuki](https://github.com/dvmarinoff/Auuki) connects trainer + PM +
  HRM concurrently in Chrome on macOS/Windows/Android. OS ceilings (Android 7 GATT
  clients; macOS ~7) are far above 2.
- **User gestures**: each `requestDevice()` chooser needs its own transient activation —
  two separate button clicks; chaining a second chooser off one click fails. Within a page
  session, a retained `BluetoothDevice.gatt.connect()` works without a new chooser.
- **Permission persistence**: `getDevices()` / `watchAdvertisements()` exist since
  Chrome 83/85 but remain **behind flags** (`#enable-web-bluetooth-new-permissions-backend`)
  per the [CG implementation-status](https://github.com/WebBluetoothCG/web-bluetooth/blob/main/implementation-status.md)
  — do not design reconnect-without-chooser as the default path.
- **Custom 128-bit services** must be pre-declared in `optionalServices` (or be the
  filter service) or `getPrimaryService` throws SecurityError.
- **Write variants**: `writeValueWithResponse/WithoutResponse` shipped Chrome 85+.
- **Throughput caveat**: macOS Chrome drops notifications at high rates (~100 Hz streams
  halved; [web-bluetooth #447](https://lists.w3.org/Archives/Public/public-web-bluetooth-log/2019Jul/0001.html)) —
  irrelevant at Click (~1 Hz idle + presses) and FTMS (≤4 Hz) rates.
- **Out of scope for Web Bluetooth**: L2CAP channels, pairing/bonding initiation, link
  security control. Click and FTMS trainers need none of these (unencrypted GATT). ⇒
  **No native bridge (Plan B) is required**; a bridge would only become relevant if a
  future Click firmware mandated encrypted ZAP *and* Chrome couldn't bond — no evidence
  of that today.

### 2.6 Evidence ledger (summary)

| # | Claim | Status |
|---|---|---|
| L1 | Zwift virtual shifting = gear ratio ×10000 via proprietary Zwift BLE service; trainer firmware computes resistance | CONFIRMED (makinolo, zwiftinsider) |
| L2 | KICKR Core supports this since fw 1.3.17 (Feb 2024); exposes Zwift service alongside FTMS | CONFIRMED (zwiftinsider + §1.5 device logs); **our unit confirmed 2026-07-28**: `KICKR CORE C26B`, fw **1.5.36** — Plan A′ gate open. See `virtual-shifting/experiments/02-firmware-model-check.md` |
| L3 | Zwift 24-gear ratio table 0.75–5.49 | CONFIRMED (SHIFTR, QZ source) |
| L4 | Click speaks unencrypted ZAP after bare `RideOn`; buttons = 0x37 (v1) / 0x23 (v2) inverse-logic protobuf | CONFIRMED (ajchellew, QZ, bikecontrol) |
| L5 | Click is reachable from Web Bluetooth in the browser | CONFIRMED (lord gist, BikeControl web build) |
| L6 | Click advertised service = `…19ca…` OR `0xFC82` depending on firmware (Jan 2025 change) | CONFIRMED (makinolo, bikecontrol) |
| L7 | Two concurrent BLE devices from one Chrome page | CONFIRMED (spec, Auuki); **re-confirmed on our own hardware pairing 2026-07-28** — see `virtual-shifting/experiments/01-dual-connection-smoke-test.md` (HW-V0: ~76s stable, zero drops) |
| L8 | FTMS 0x11 field layout; 0x00 control persists; serialize on 0x80; ERG/SIM last-write-wins | CONFIRMED (FTMS v1.0 spec). **HW-V10, 2026-07-28** (`virtual-shifting/experiments/05-ftms-conformance-hw-v10.md`): on our KICKR, control persistence goes further than spec-required — Reset (0x01) does NOT revoke it either (spec deviation). ERG/SIM interleave accepted with no conflicts. Concurrent-write serialization untestable from one Web Bluetooth client — Chrome's own GATT layer blocks it before it reaches the trainer |
| L9 | Trainer solves resistance from sim params + measured flywheel speed using standard road physics; mass is trainer-internal | CONFIRMED (ftmsemu; formula is convention, not spec) |
| L10 | QZ hub-protocol recipe (handshake `RideOn 02 01` + 8 more init writes, 0.4 % incline first, ratio×10000×(42/14) + `00 08 88 04`) drives trainer-native shifting | CONFIRMED in QZ source, **byte-level decode completed 2026-07-28** (`virtual-shifting/PROTOCOLS.md` §2.2 — full 11-write handshake, one write of unknown command code `0x41` flagged as new UNKNOWN); the `00 08 88 04` bytes are a `HubRequest{DataId=520}` verification poll, not a distinct "apply" message (§2.2.1 — corrects the prior framing). U6 (42/14 normalization) and U7 (FTMS/hub coexistence) both **resolved from source** this session — see `virtual-shifting/HYPOTHESES.md` H21/H22. Still UNKNOWN on this KICKR specifically (HW-V9) |
| L11 | Feb-2026 prototype failed because it sent controller-family, not hub-family, messages | INFERRED (high confidence) |
| L12 | Zwift 0x11 cadence ≈ 1 Hz; KICKR-specific FTMS command-drop quirks | INFERRED / UNKNOWN (no primary source) |
| L13 | Trainer's assumed rider mass value on KICKR Core (affects grade-solve accuracy) | **CONFIRMED 2026-07-28**: `m_t`=93.3kg regressed (R²=0.9999) vs actual 92kg (89kg rider + 3kg bike) — within 1.4%. **But this is a fixed trainer-side default, not a personalized value** — the Wahoo app's own rider-weight profile is 81kg, matching neither number, and FTMS has no protocol channel to transmit rider mass (confirmed by this same claim's own text below). See `virtual-shifting/experiments/06-hw-v7-v8-mass-regression.md`. Every rider gets this same fixed default regardless of actual weight; R3's trim factor is the only correction available |
| L14 | Click v2 vendor-unlock requirement applies to the user's specific Click | **RE-OPENED 2026-07-29** — the *disconnects* are confirmed; their *cause* is not. Originally "CONFIRMED, likely" from repeated ~44–90s drops pre-workaround vs 5+ min stable after pairing once in Zwift Companion (`virtual-shifting/experiments/03-click-buttons-partial.md`). Zwift **Companion** has now been captured losing a Click V2 link at **73.5 s** on HCI reason `0x08` (supervision timer expired) after 70 s of zero traffic, followed by 12 failed reconnects. Because Companion is *not* the app BikeControl says performs the unlock, that capture **does not discriminate** H16 (authorisation timeout) from **H28** (plain idle timeout) — both predict it. An earlier claim here that it favoured H28 is **retracted**. Two tests settle the mechanism: `experiments/15` §6.1 (unauthorised, browser-only, 10 min) and §6.0 P4 (authorised, via Companion **bridged** to the real game on a laptop, which keeps the BLE on the phone where our capture route works). See `virtual-shifting/experiments/15-zwift-app-click-session.md` §3/§6 |
| L18 | Click V2's full attribute table, including the `0100`/`0101`/`0102` characteristics our code and docs had never touched | **CONFIRMED 2026-07-29** from Zwift Companion's own GATT discovery: `virtual-shifting/experiments/15-zwift-app-click-session.md` §1, capture `captures/20260729-1448-zwift-app-click-session.btsnoop`. Companion subscribes to all three plus ASYNC/SYNC-TX/battery (6 CCCDs) and wrote **no payload to any of them** in that session, so the unlock write remains uncaptured — plausibly because no game session was running for it to bridge. Also corrects two earlier readings taken from tshark's labels rather than raw PDUs: there is exactly **one** `2A19` (not three) and **no** `2A5D` on the Click |
| L21 | The Click V2 "44–90 s drop" is **unit-specific, and looks like a relay-role effect (H30)**, not a protocol or authorisation one | **2026-07-29, `virtual-shifting/experiments/16` Phases 2–3.** Five browser runs on `f4:c4:59:81:d9:a1`: **60.5–61.2 s every time** regardless of handshake form or `ff 04 00`. The same browser on `f4:c4:59:3d:51:a6` held **20+ minutes**. The dropping unit publishes nothing at all — no buttons, no battery, no initial-status — after a correct, correctly-echoed handshake, and its `FF 05` status frame carries entirely different protobuf fields. **Falsifies H29 and `13`'s `FF 04 00` keep-awake prediction**, and makes `CONNECTION-RECIPE.md` step 10 dead. If H30 holds, the design answer is simply *connect the primary unit* |
| L19 | Real Zwift's ZAP handshake is **`RideOn 02 03`** (8 bytes), not the bare 6 we send; Click V2 echoes `02 03`, the KICKR answers `02 02` | **CONFIRMED 2026-07-29** — `virtual-shifting/experiments/16-bridged-zwift-session-capture.md` §2, raw PDUs on three links. Corrects `PROTOCOLS.md` §1.3 and H15, whose "bare echo" reading was an artefact of our own 6-byte write. **Leading candidate for the 44–90 s drop problem** (H29): a bridged session that sent `RideOn 02 03` survived 226 s of complete silence, while one that never handshook died at 73.5 s |
| L20 | Zwift can drive a KICKR Core with **no FTMS Control Point writes at all** — control over the Zwift hub service + the Wahoo proprietary `a026e037` characteristic, FTMS used only for data | **CONFIRMED for the 127 s captured** (`experiments/16` §4): `2AD9` subscribed and never written; 123 `2AD2` notifications consumed; `RideOn 02 03` → `00 08 00`/`00 08 10` → `41 08 05` on the Zwift service, plus `33`/`3c 02` on `a026e037`. Also settles half of `U14`: **`41 08 05` is genuinely sent by Zwift** (not a QZ invention) and the trainer replies `3e 08 41 10 02`. Bears on `U9`. NOT evidence that Zwift never uses FTMS control in longer/hillier sessions |
| L15 | Felt latency budget app-side FTMS shift ≈ 1–1.5 s on real trainers | CONFIRMED for other hardware (simcline); UNKNOWN for KICKR Core (HW-V7) |
| L16 | The user's two Click units (Left/Right) form a relay pair — only one needs a BLE connection to receive both controllers' button events | **CONFIRMED 2026-07-28**: `virtual-shifting/experiments/04-click-mapping-and-relay-confirmed.md`. Simplifies §4.6's connection-management design — the controller side needs only one GATT slot, not two |
| L17 | The shift-primitive bake-off (§5 HW-V12) — candidate (a) grade-offset additive works cleanly (no dead zone, monotonic, stable) but scores only 17/20 (arbitrary/non-speed-scaled step size); candidates (b)-(f) still untested | **PARTIAL 2026-07-28**: `virtual-shifting/experiments/08-hw-v12-bakeoff-partial.md` — 2% baseline 175.3W(harder)/135.1W(easier); 0% baseline 85.4W(harder)/58.9W(easier). Session ended early (rider fatigue); candidate (b)'s corrected target grades pre-computed for the next session using this session's own measured baseline gear ratio (found the design's illustrative default r_phys=2.40 does not match this rider's actual gear — real ≈1.85) |

Conflicts surfaced during research (kept, not silently resolved):
- Handshake status bytes after `RideOn` differ across sources (`01 02`/`01 01` captures vs
  `00 09` docs) — empirically don't-care on send; device replies vary by model.
- ajchellew README says AES-**GCM**; his code and makinolo say AES-**CCM** — CCM is correct.
- Click v2 manufacturer-data type codes differ between QZ and BikeControl heuristics.
- Encryption "removed" (makinolo) vs "always optional" (cagnulein) — moot: bare RideOn ⇒
  plaintext on all current firmware.

---

## 3. Gap analysis

What Zwift-quality shifting requires vs. what exists:

| Requirement | Current state | Gap |
|---|---|---|
| Shift input from real hardware | Keyboard only (main.js:625-643) | Zwift Click adapter over Web Bluetooth; input abstraction |
| Physically correct gear feel | Gradient × multiplier (dead at 0 %, inverted downhill, needs calibration) | Virtual-speed model: solve effective grade from gear ratio + physics (§4.3); no per-gear calibration |
| Gear table | 22-gear Shimano 105 table + measured multipliers | Zwift-style 24 sequential ratios (0.75–5.49) as default; drivetrain emulation optional |
| Sub-second shift response | 2 round trips/command (0x00 every time), 3 s throttle, single-slot ACK race | Request control once; FIFO/coalescing command queue; shift bypasses throttle (exists) |
| Works on flats and descents | No (dead zone/inversion) | Virtual-speed model handles all grades; coast detection for cadence≈0 |
| ERG compatibility | applyToPower distorts ERG targets | Shifting = no-op in ERG (gear retained, resistance unchanged) |
| Two concurrent BLE devices | Single-device FTMSClient | Second device manager + connection UI (two gestures) |
| Reconnect story | None | In-session `device.gatt.connect()` retry; chooser fallback; document flag-gated `getDevices()` |
| Trainer-native (firmware) shifting | Wrong message family attempted; failed | Optional Plan A′ experiment: QZ hub-protocol recipe (§4.6) |
| State persistence | FTP + baseline gear only | + gear index, gear-table choice, controller identity (name) |
| Tests | None for gearing | Unit tests for drivetrain math, frame parsers (byte fixtures exist in research), queue serialization |

Interaction with the momentum/physics model: `calculateRealisticGrade` smoothing should
continue to apply to the **route grade only**. A shift must *not* be routed through the
1.5 %/10 m ramp (it would feel mushy); it changes the *translation* of grade → command,
applied immediately (the existing `forceUpdate` path already does this).

---

## 4. Proposed design (browser-first)

### 4.1 Architecture overview

```
                 ┌────────────────────────────────────────────────┐
                 │                 React UI (gear display,        │
                 │        connect buttons, settings, workout)     │
                 └───────▲────────────────────────▲───────────────┘
                         │ events/state           │
┌──────────────┐  shift  │                ┌───────┴────────┐  0x11/0x05   ┌─────────┐
│ ShiftInput    │ events ┌┴─────────────┐ │ FTMS command   │  serialized  │ KICKR   │
│ sources:      ├───────▶│ Drivetrain    │▶│ queue (new)    ├─────────────▶│ Core    │
│ ZwiftClick    │        │ model (new)   │ └────────────────┘   GATT #1   │ (FTMS)  │
│ Keyboard      │        │ gear state +  │                                └─────────┘
│ Gamepad       │        │ grade solver  │◀── route grade (simPhysics) 
└──────▲───────┘        └───────────────┘◀── speed/cadence (IBD)
       │ GATT #2 (Zwift Click over Web Bluetooth)
```

New modules (all framework-agnostic TS in `src/services/` + thin adapters):

1. `services/shiftInput.ts` — input abstraction + adapters
2. `services/drivetrain.ts` — gear state + physics (pure, unit-testable)
3. `services/ftmsQueue.ts` — control-point serialization (wraps/replaces ftms.js ACK slot)
4. `services/zwiftClick.ts` — ZAP client over Web Bluetooth
5. React: `GearIndicator`, `ControllerPanel` components; `ControllerContext`

### 4.2 Shift input abstraction

```ts
// services/shiftInput.ts
export type ShiftEvent =
  | { type: 'shift'; direction: 'up' | 'down'; source: string; ts: number }
  | { type: 'battery'; level: number; source: string }
  | { type: 'connection'; state: 'connected' | 'disconnected' | 'connecting'; source: string }

export interface ShiftInputSource {
  readonly id: string                    // 'zwift-click' | 'keyboard' | 'gamepad'
  readonly displayName: string
  connect(): Promise<void>               // must be called from a user gesture for BLE
  disconnect(): Promise<void>
  on(handler: (e: ShiftEvent) => void): () => void
  feedback?(kind: 'shift-ok' | 'limit'): void   // optional (Click haptics)
}
```

Semantics: sources emit **edge-triggered** `shift` events (press, not release; one event
per press). Hold-to-repeat is a source-level policy (Click adapter: repeat every 500 ms
while held, matching QZ). A small `ShiftInputManager` fans multiple concurrent sources
into one stream (keyboard + Click can coexist) and applies a global min-interval
(~150 ms) to absorb duplicates.

Adapters:
- **ZwiftClickAdapter** (primary) — §4.5.
- **KeyboardAdapter** — extract the existing `keydown` handler (main.js:625-643);
  remove the "only during SIM step" restriction from the *input* (the drivetrain decides
  what a shift does; UI shows gear even when idle).
- **GamepadAdapter** — poll `navigator.getGamepads()` on rAF; map two configurable
  buttons; covers generic Bluetooth remotes/controllers Web Bluetooth can't reach.
- **WebHID** — *not* in scope: no evidence of a relevant HID shifter; Gamepad covers the
  practical fallbacks. (Revisit only if a concrete device demands it.)

### 4.3 Virtual drivetrain model — the core change

Replace the gradient-multiplier with the **virtual-speed model** (the same physics
trainer firmware uses — L1/L9):

State: `gearIndex` into a ratio table; default table = **Zwift's 24 ratios 0.75–5.49**
(L3), start gear 12 (ratio 2.40, ≈ Zwift default). Optional "2×11 emulation" table for
realism; tables are data, not code.

Inputs each update: route grade `G` (after existing simPhysics smoothing), rider cadence
`c` (rpm, from IBD), measured speed `v_fly` (from IBD, m/s), config: wheel circumference
`C` (default 2.096 m), total mass `m` (rider+bike, user setting), physical baseline ratio
`r_phys` (chainring/cog the bike actually sits in), Crr/Cw (existing constants).

```
v_virt = (c / 60) × r_gear × C                    // speed you'd do in the virtual gear
F_road(G, v) = m·g·(sin θ + cos θ·Crr) + Cw·v²    // θ = atan(G/100)
P_target = F_road(G, v_virt) × v_virt              // power the rider should have to produce

// Solve the grade to SEND so the trainer's own model demands P_target at ITS speed:
// P_target = [m_t·g·(sin θ' + cos θ'·Crr) + Cw·v_fly²] × v_fly    →  solve θ'
sin θ' ≈ (P_target / v_fly − Cw·v_fly² − m_t·g·Crr) / (m_t·g)      // small-angle, cos θ'≈1
G_send = 100 × tan(asin(clamp(sin θ', −0.35, 0.35)))
```

- **Small-angle approximation, quantified (2026-07-28 deep dive)**: the `cos θ'≈1`
  substitution above only affects the `Crr` term when solving; the final `G_send` is
  still exact trig (`tan(asin(·))`). Algebraically the induced error reduces to
  `sin θ' = sin θ_true − Crr·(1−cos θ_true)`, independent of mass/speed/Cw — numerically
  negligible even at 20% grade (~0.007 percentage points, below the FTMS wire format's own
  0.01%-resolution quantization floor). **No change needed**; full derivation, numbers,
  and comparison against QZ's exact-trig forward calculation (`bike.cpp::
  computeSlopeTargetPower`) in `virtual-shifting/HYPOTHESES.md` §F.
- `m_t` is the mass the **trainer** assumes (UNKNOWN L13 → hardware experiment HW-V8;
  until measured, assume `m_t = m` and expose a single trim factor).
- **Baseline identity**: when `r_gear = r_phys` and `m_t = m`, the equation collapses to
  `G_send = G` exactly — no calibration needed to make the default gear honest. This is
  the key property the multiplier model lacked.
- **Coasting guard**: if `c < 15 rpm` or `v_fly < 1 m/s`, send `G_send = G` (real grade,
  no gear translation) — avoids the divide-by-v_fly singularity and matches real coasting.
- **Clamps**: `G_send` limited to trainer-plausible range (±25 % configurable); when the
  clamp engages the rider feels less than the model demands — display an "at limit" hint.
- Works on flats (harder gear at same cadence ⇒ higher `v_virt` ⇒ aero term demands more
  power ⇒ positive `G_send` even when `G = 0`) and on descents (harder gear adds
  resistance rather than steepening the descent).
- **No per-gear calibration, no AI-in-the-loop.** `CALIBRATION_V1` (ftms.js:524-734) and
  the old calibration workflow become obsolete (its working-note files are deleted); keep
  `power-curve-calibration.html` only as a validation harness (compare predicted vs
  measured power per gear).
- **`v_fly` is derived from CADENCE, not from the trainer's reported speed** (added
  2026-07-29 after the first ride + Garmin/console cross-analysis, `experiments/17`). The
  trainer is set to auto-calculate speed, so what it reports is the output of *its own* road
  model — whose input is the grade we send. Feeding that back into the solve closes a loop with
  no fixed point whenever the rider is under target: a genuine 5% grade is asked for as 4.7%,
  then 5.8%, 6.9%, … 18.7% by the twelfth iteration, then pinned at the clamp. Measured, and
  regression-tested. `v_fly = cadence × r_phys × C` instead — cadence is a real measurement and,
  for a fixed drivetrain (a Zwift Cog especially), that product *is* the flywheel speed. The
  design's `v_fly` term always meant this; the ambiguity was assuming the trainer's speed
  channel reported it.
- **Speed and distance come from `v_virt`, NOT from the trainer's reported speed**
  (added 2026-07-29 during implementation). The trainer derives its speed from the grade we
  send it, and we send a steeper grade to manufacture a harder gear's resistance — so
  integrating trainer speed makes a harder gear cover *less* ground, which is backwards. A
  harder gear at the same cadence means you are travelling faster. `virtualDistanceM()`
  integrates `v_virt`; the SIM loop falls back to trainer speed while coasting or when
  virtual shifting is off. This matches Zwift, whose in-game speed under virtual shifting
  comes from the game's own physics, not the trainer's speed channel.
- **`r_phys` is CONFIGURED (chainring/cog), not inferred** (added 2026-07-29). With a Zwift
  Cog it is fixed at chainring/14 and cannot change mid-ride — this bike is **34/14 =
  2.4286**, nearest table gear **12/24 (2.40)**. An earlier implementation back-solved it
  from speed÷cadence, which is unsound whenever the trainer derives speed from power rather
  than flywheel revolutions; that is exactly why `U16` measured ≈1.85 for a nominal 2.4286.
  The inferred value is retained as a **diagnostic cross-check** only.
- **ERG steps**: `shift` events update `gearIndex` (and UI) but do not alter the 0x05
  target — matches Zwift behavior (§2.1).
- Update cadence: recompute `G_send` on (a) shift (immediate, bypass throttle — existing
  `forceUpdate` semantics), (b) each smoothed route-grade update, (c) significant speed/
  cadence drift (>10 %). Wire protocol stays plain FTMS 0x11 ⇒ works on any FTMS trainer.

### 4.4 FTMS command layer changes

- **Request Control once** per connection, immediately after subscribe; re-request only
  on Machine Status `0xFF Control Permission Lost` (subscribe to 0x2ADA, currently
  ignored — ftms.js:195-197). Halves per-command latency (spec-backed, L8).
- **Command queue**: FIFO with **coalescing** — queued-but-unsent `setSim` commands are
  replaced by the newest values (last-write-wins mirrors the spec's own precedence rule);
  `setErgWatts` and mode-transition commands are barriers (never coalesced away).
  Serialize strictly on the 0x80 indication; timeout 2 s → one retry → surface error.
  This replaces the single-slot `_pendingAck` race (ftms.js:303-341) and subsumes the
  POC's `commandInProgress`/`pendingGearChange` pattern.
- **Rate**: steady-state ≤1 Hz 0x11 (Zwift-like, L12); shift-triggered sends are extra
  but the queue+coalescing bounds outstanding commands at 1.
- Fix the latent wind-speed unit bug (0.01 → 0.001 m/s, §1.2) while touching `setSim`.
- **HW-V10 update (2026-07-28)**: the queue's serialize-on-0x80 discipline must also
  catch and retry `NetworkError: GATT operation already in progress` — this is Web
  Bluetooth's own client-side concurrency guard firing when a second write to the same
  characteristic is issued before the first resolves; it's a confirmed real error shape,
  not hypothetical (`virtual-shifting/experiments/05-ftms-conformance-hw-v10.md`). Also:
  don't assume Reset relinquishes control on all trainers — it didn't on our KICKR
  (deviation from spec), but re-Request-Control after Reset defensively for portability.

### 4.5 Zwift Click adapter (Web Bluetooth)

```ts
const ZWIFT_SVC   = '00000001-19ca-4651-86e5-fa29dcdd09d1'
const ZWIFT_SVC_2 = 0xfc82                       // post-Jan-2025 firmware (L6)
navigator.bluetooth.requestDevice({
  filters: [{ namePrefix: 'Zwift Click' }],       // name is stable across firmware
  optionalServices: [ZWIFT_SVC, ZWIFT_SVC_2, 'battery_service', 'device_information'],
})
```

Connect flow: `getPrimaryService(FC82) → fallback getPrimaryService(19ca…)` → get chars
`…0002` (notify), `…0003` (write), `…0004` (indicate) → `startNotifications` on both 2
and 4 → write `RideOn` (6 bytes, without-response) to `…0003` → expect `RideOn xx xx` on
`…0004` (don't validate the 2 status bytes — they vary; L4/conflicts).

Frame parser (pure function, unit-tested against captured fixtures):
- `0x37` → Click v1 two-varint schema, inverse logic (`08 00` = up pressed,
  `10 00` = down pressed); track previous state, emit on release→press edge only;
  re-emit every 500 ms while held.
- `0x23` → v2/Ride bitmap: varint field 1, active-low; map SHFT_UP/SHFT_DN bits of either
  side to up/down.
- `0x07` → Play pads (support opportunistically; user has a Click).
- `0x15` idle → connection liveness watchdog (no frame for >5 s ⇒ suspect link);
  `0x19`/Battery Service → battery events.
- `feedback('shift-ok')` → write `12 12 08 0A 06 08 02 10 00 18 20` (QZ/BikeControl
  vibrate pattern) — optional, behind a setting.

Variant detection happens from the **first frame type** (0x37 vs 0x23), not the
advertisement (Web Bluetooth hides manufacturer data at chooser time, L5). If the device
turns out to be a Click v2 and drops after ~60 s (L14), surface the known workaround
message ("pair once with real Zwift to unlock, then retry") — do not attempt to replay
vendor challenges in v1 of this feature.

### 4.6 Connection management (two devices)

- Two independent device slots: `trainer` (existing FTMSClient) and `controller` (new).
  **Two separate connect buttons** — each `requestDevice` needs its own user gesture
  (L7/§2.5); connecting the Click is optional and can happen before or during a workout.
- In-session reconnect: keep the `BluetoothDevice` object; on `gattserverdisconnected`,
  retry `device.gatt.connect()` with backoff (3 attempts) — no chooser needed within the
  page session. Cross-reload reconnect: show the chooser again (persistent permissions
  are flag-gated, L8/§2.5); remember the device *name* to preselect messaging.
- Wake handling: a sleeping Click stops advertising — instruct "press a button, then
  Connect" in the UI copy.
- Order independence: controller events are buffered/no-op until the drivetrain exists;
  trainer commands never depend on controller state.

### 4.6′ Plan A′ — DROPPED (2026-07-28, user decision; kept for historical context only)

**Out of scope.** This project's goal is an FTMS-only equivalent *feel*, not
reverse-engineering/reimplementing Zwift's proprietary protocol (GOALS.md non-goals).
The section below is preserved as-written from the original design session for
historical reference — do not resume HW-V9 or build `services/zwiftHub.ts` unless this
decision is explicitly revisited. §4.8 (Trainer Difficulty) and the personalized
calibration pipeline (`experiments/09-outdoor-stream-physics-regression.md`) are this
project's actual answer to "how do we get Zwift-like feel," in place of Plan A′.

Not required for the deliverable feel, but the KICKR Core supports firmware-side shifting
(L2) and QZ documents the exact recipe (L10). Behind a dev flag, on the **trainer's**
Zwift service: handshake `RideOn 02 01` → `zwiftPlayInit()`-equivalent writes → send a
0.4 % `SimulationParam` inclination → protobuf gear command
`ratio×10000 × (42/14 normalization)` + apply bytes `00 08 88 04`; suppress FTMS CP
writes while active (QZ does; L10). If HW-V9 validates it, this becomes the premium path:
firmware-computed resistance, no app-side physics loop, Zwift-identical feel. The
drivetrain model (§4.3) remains the universal fallback for any other FTMS trainer.
**Plan B (native/WebSocket bridge) is explicitly NOT needed** — Web Bluetooth reaches
both devices (L5, L7).

### 4.7 Integration with existing app

- `H.handlers.shiftGearUp/Down` (main.js:1286-1322) become thin calls into the drivetrain;
  `VirtualGear.applyToGradient/applyToPower` are retired (kept temporarily behind a
  "legacy multiplier" setting for A/B feel comparison during validation).
- `setSimGrade` (main.js:783-853) keeps route smoothing + throttle, but the gear
  translation moves after smoothing: `G_send = drivetrain.translate(realisticGrade,
  ibd)` replacing `virtualGear.applyToGradient` (main.js:809-811).
- Gear/controller state exposed via a `ControllerContext` (mirroring `TrainerContext`);
  new `GearIndicator` in `ActiveView`; persistence adds `gearIndex`, `gearTableId`,
  `riderMassKg`, `physicalRatio`, `controllerName` to `storage.ts`.
- Tests to add: drivetrain math (baseline identity, flat/descent behavior, coast guard,
  clamps), ZAP frame parser (byte fixtures from §2.3), command-queue coalescing/serialization
  (extend tests/mocks/ftms-mock.js), shift-during-ERG no-op.

### 4.8 Trainer Difficulty (trim) — added 2026-07-28, user-driven scope clarification

Matches real Zwift's "Trainer Difficulty" setting (0-100%, Zwift default 50%) exactly,
not a simplified variant:

```
grade_to_trainer = drivetrain_G_send(gear-translated grade) × trim_fraction
```

Applied as the **last** step before the FTMS 0x11 write — after gear translation (§4.3),
after route-grade smoothing (`calculateRealisticGrade`, simPhysics.ts). `trim_fraction`
is a single user setting (0.0-1.0), independent of, and not to be confused with, the
mass/Crr/Cw **calibration** trim factor (design §6 Risk R3) — that one corrects for the
trainer's fixed internal mass assumption; this one is a felt-difficulty preference.
Consider distinct setting names in the UI/storage layer to avoid the collision (e.g.
`trainerDifficulty` vs `massCalibrationTrim`).

**Critical behavioral requirement, confirmed against real Zwift's actual behavior
(not assumed)**: route simulation — distance covered, reported speed, workout
progress — is computed from the rider's **real measured power** against the **real,
un-trimmed** route grade, via the existing SIM physics pipeline
(`simPhysics.ts`/`H.sim.updateSimMode`) completely unchanged. Trainer Difficulty affects
only what resistance the trainer presents to the rider's legs; it must never leak into
distance/speed/route-progress math, or the route and the felt effort would silently
drift apart from what a real Zwift rider expects.

No new hardware unknowns — this is a pure software multiplier on an already-designed
signal path, needs no HW-Vn experiment of its own.

### 4.9 Personalized calibration (the actual "working curve" validation) — added 2026-07-28

**This section is the current core deliverable** (superseding Plan A′'s former role as
"the premium path"). The rider mass/Crr/Cw constants used in §4.3's model must be
derivable from a specific rider's own real outdoor riding data, not permanently fixed at
this project's own measured defaults (92kg/0.004/0.51). Validate on one rider's data
first (this project's), then generalize.

- **Tooling**: `experiments/intervals-icu-power-model-chart.js` — an intervals.icu
  Custom Activity Chart script (built 2026-07-28, run twice against two real rides) that
  fits mass/Crr/Cw from a ride's per-second power/speed/grade/altitude streams via three
  methods (naive regression, flat-segment aero sweep, Chung virtual-elevation grid
  search) — chosen because a naive whole-ride regression on binned data was tried first
  and failed from grade/speed collinearity (`experiments/07`, `09` full writeup). Both
  runs gave a plausible, mutually-consistent mass estimate (~98kg) from the Chung method
  only; Crr/Cw did not yet reproduce across the two rides. The climb-only R² breakout
  this validation actually needs (see "Success bar" below) has code in place but no run
  yet — `experiments/09` has the full detail and is the source of truth, not this bullet.
- **Success bar**: the fitted constants, forward-run through §4.3's steady-state
  formula, should predict a rider's measured power at a given grade close enough that
  gear choices "feel right" — not perfect, physically-exact reproduction (explicitly not
  the goal — GOALS.md).
- **Path to generalization** (clarified 2026-07-28, RISKS-ROADMAP.md open question 11):
  the intended near-term mechanism is AI-assisted, not a new app feature — run a
  calibration script against ~5 of a rider's real rides, copy each ride's
  `calibrationJson` summary (mass/Crr/Cw/fit-quality), paste them into a chat, and have
  them averaged into one settings file. That settings file still needs a landing spot in
  the app (manual entry vs. settings import vs. a deeper integration is still undecided).
- **First real validation result, 3 rides (2026-07-28) — currently negative, not a green
  light.** Full detail in `experiments/09`, headline here: on **every one of 3 real
  rides**, the fixed HW-V8 trainer constants (93.3kg/0.004/0.51) beat the rider's own
  outdoor-fitted model on climb-only (`grade>2%`) R² **and** MAE, by 6-33W and widening
  ride to ride. **This is the opposite of what this section's validation was hoping to
  confirm.** Two real confounds were identified at the time but not yet ruled out: a
  coarsened Crr/Cw search grid (cut to fix a sandbox memory limit) that may be too coarse
  to resolve Cw at all, and a mismatch between Method C's fitting objective (includes an
  acceleration term) and the evaluation metric used here (does not).
- **Offline full-precision re-fit (2026-07-28, same day, `experiments/10`) — both
  confounds above substantially disentangled; headline verdict unchanged, still
  negative, but now much better understood.** Re-ran the fit on 3 real FIT files (no
  downsampling, Method C as a continuous joint `scipy.optimize` over mass/Crr/Cw instead
  of a discrete grid) instead of the intervals.icu sandbox. **Removing the grid did not
  converge Cw** — it moved to a *wider* spread (0.050-0.436 across 3 rides) than the
  coarse grid's suspicious identical-0.30, and 2 of 3 rides' mass optimum hit the search's
  150kg physical bound. Verified via a profile-likelihood mass scan (RMSE keeps improving
  well past 150kg) that this is a genuine unconstrained optimum, not a narrow-search-
  window artifact — and traced the mechanism analytically: as mass→∞ in the Chung solve,
  `sinθ → −Crr − a/g`, independent of power, so the fit can substitute measured
  acceleration (which correlates with real slope) for power at implausible masses. This
  is a real non-identifiability in single-ride Chung fitting, not a resolution problem.
  **Climb-only breakout evaluated under both the steady-state formula AND an
  acceleration-inclusive variant** (`P_accel = P_steady + m·a·v`, matching what Method C
  itself optimizes) — the trainer constants beat the fitted model **on every ride, under
  both formulas**, directly refuting the fit-objective/evaluation-metric mismatch as a
  sufficient explanation on its own. One ride did show real improvement from full
  precision alone (climb MAE 99.8W→65.9W vs. its sandboxed coarse-grid result), but the
  trainer model still won outright on that ride too (53.5W MAE, the only positive climb
  R² anywhere in the analysis). **Until a multi-ride joint fit or a mass-held-fixed
  variant is tried (see `experiments/10`'s follow-ups), treat single-ride personalized
  calibration as methodologically unable to beat the fixed defaults for this rider's
  data** — not merely "unvalidated pending a better grid" as the earlier framing had it.
  The "path to generalization" mechanism above is still the intended one *if* a future
  fitting method resolves this; the fitted numbers this method currently produces are not
  just unproven but actively unstable (mass hitting a physical search boundary on 2 of 3
  rides), and should not be averaged into a settings file as-is.
- **Same-day correction**: a coarse-grid companion run the user supplied afterward
  confirmed all 3 FIT files above (not just one) are paired with a fresh coarse-grid
  fit of the same rides. The headline verdict is unchanged (trainer constants still win
  on climb-only accuracy on every ride), but the coarse grid's narrow, seed-centered
  mass window turned out to produce more physically plausible masses on all 3 rides
  than the continuous optimizer's wider bound did — and on the ride with the widest
  divergence, the continuous optimizer's *lower* fitting-objective error corresponded to
  a *worse* climb-power prediction. See `experiments/10`'s "Matched coarse-grid
  comparison" section for the full ride-by-ride numbers.
- **Same-day major update**: the user then supplied their actual known mass (89kg
  rider + 8kg bike = 97kg), which the earlier analysis did not have (it had only used
  97kg as an optimizer *seed*, still free to drift — which is why it drifted to 150kg
  on 2 of 3 rides). Re-fitting with mass **locked** at 97kg and only Crr/Cw free
  eliminated the mass-boundary degeneracy entirely, converged Crr to a tight
  physically-sensible range (0.0152-0.0200), and **collapsed the climb-only MAE gap to
  the trainer constants from 12-66W down to under 7W on every ride — with the fitted
  model winning outright on one of the 3 rides**. Cw still did not converge
  (0.050-0.259), consistent with the root cause being specifically in the mass
  dimension. **This meaningfully upgrades the outlook: personalized calibration is no
  longer a clear loss against the fixed defaults — it's now roughly competitive**,
  though not yet a clear win (n=3, Cw still unresolved). See `experiments/10`'s
  "Update (same day): fixed-mass refit" section for full numbers.

---

## 5. Hardware validation plan

Ordered; each converts an UNKNOWN into a fact. Use Chrome desktop first, then Android.
Record results in this file.

| # | Experiment | Expected observation | Decides |
|---|---|---|---|
| HW-V1 | Wahoo app → check KICKR Core firmware version | ≥ 1.3.17 | Whether Plan A′ is even possible (L2) |
| HW-V2 | Press a Click button; `requestDevice({namePrefix:'Zwift Click'})`; inspect `device.name`, then connect and read Device Info 0x2A26 (firmware) | Chooser shows "Zwift Click"; fw string readable | Which Click generation/firmware you own (L6, L14) |
| HW-V3 | `getPrimaryService(0xFC82)` then fallback `…19ca…` | Exactly one succeeds | Which service UUID your firmware exposes (L6) |
| HW-V4 | Write bare `RideOn` to `…0003`; log `…0004` indication | `52 69 64 65 4F 6E` + 2 bytes (`01 03` ⇒ v1, `02 03` ⇒ v2) | Unencrypted mode works; variant confirmation (L4) |
| HW-V5 | Press/hold/release both buttons; log ASYNC frames | v1: `37 08 00 10 01` / `37 08 01 10 00`, repeats while held, `0x15` ~1 Hz when idle | Frame schema + repeat policy for the parser (L4) |
| HW-V6 | Leave Click connected idle 5 min; then unconnected 2 min | v1: stays connected; unconnected → powers off ~1 min | Watchdog + reconnect UX; Click v2 unlock issue if it drops at ~60 s (L14) |
| HW-V7 | With trainer + Click both connected: pedal steadily, send 0x11 grade steps (0→2→4 %); timestamp write→0x80→felt change (power trace) | ACK < 300 ms; felt change 0.5–1.5 s | Real shift latency budget; whether dual connection degrades IBD (L7, L15) |
| HW-V8 | Constant cadence, sweep grades 0/2/4/6 % at fixed speed; regress measured power vs `sin θ` | Slope ≈ `m_t·g·v` ⇒ back out `m_t` | Trainer's assumed mass → drivetrain accuracy (L13) |
| HW-V9 | Plan A′ probe: hub handshake `RideOn 02 01` + init + 0.4 % incline + gear command (ratio 0.75 then 5.49) + `00 08 88 04` while pedaling | Resistance clearly drops/rises within ~1 s | Whether trainer-native shifting works from the browser (L10/L11) |
| HW-V10 | Interleave 0x05 (150 W) and 0x11 (4 %) rapidly; also send 0x11 while a procedure is in flight without waiting | Last-write-wins; unserialized write → ATT "Procedure Already In Progress" | KICKR's spec conformance; queue necessity (L8, L12) |
| HW-V11 | Android Chrome repeat of HW-V4/V7 with screen on | Same behavior | Android parity (README already notes screen-lock constraint) |

---

## 6. Risks, open questions, implementation phases

### Risks

1. **Reverse-engineered protocol drift** — Zwift changed the Click's advertised UUID in
   Jan 2025 (L6) and could change framing again. Mitigation: probe both UUIDs, detect by
   frame type, keep the keyboard/gamepad adapters as always-working fallbacks.
2. **Click v2 vendor lock** (L14) — if the user's Click is v2, sessions may cap at ~60 s
   without the Zwift-app unlock. Mitigation: detect + surface the known workaround; v1
   scope excludes challenge replay.
3. **Trainer-mass unknown** (L13) skews the grade-solve proportionally. Mitigation:
   HW-V8 measurement + a single user-visible "feel" trim (one number, not 22 multipliers).
4. **Grade clamp saturation** — hardest gears at steep grades + low flywheel speed can
   demand `G_send` beyond the trainer's range; feel flattens. Mitigation: clamp + UI hint;
   Plan A′ eliminates this class entirely.
5. **App-side latency ceiling** (~1–1.5 s felt, L15) — physics-instant shifts are only
   possible firmware-side. Accepted for v1; Plan A′ is the upgrade path.
6. **Chrome permission persistence still flag-gated** — reconnect after reload always
   costs a chooser click. Accepted; revisit when Chrome ships the new permissions backend.
7. **Legacy/React split** — new state must live in one place (services + contexts), not
   another `window.Hybrid` accretion; StrictMode double-mount already forced the
   `subscribedRef` workaround (TrainerContext.tsx:34-47).

### Open questions

- Does the KICKR Core FTMS path tolerate 2 Hz 0x11 bursts around shifts? (HW-V10)
- Is the QZ 42/14 normalization in the hub gear command KICKR-correct, or Hub-specific?
  (HW-V9 variant: try with and without.)
- Should SIM "difficulty" (momentum assist, simPhysics.ts:48-53) apply before or after
  gear translation? Design says before (route feel) — validate subjectively.
- Zwift Cog purchase: irrelevant to protocol, but a fixed 14 t cog would remove
  cross-chaining noise; the 34/17 baseline convention already achieves the fixed-ratio
  requirement.

### Phased implementation outline (future sessions)

- **P1 — Foundations**: `drivetrain.ts` (pure math + tests), `ftmsQueue.ts`
  (control-once + coalescing queue + tests), retire multiplier behind a legacy flag.
- **P2 — Input**: `shiftInput.ts` + Keyboard adapter migration + Gamepad adapter;
  `GearIndicator` + `ControllerContext` in React.
- **P3 — Zwift Click**: `zwiftClick.ts` adapter + parser fixtures from HW-V4/V5;
  connection UI, watchdog, reconnect.
- **P4 — Validation + tuning**: run HW-V7/V8, set `m_t`/trim, A/B legacy-vs-new feel,
  update this doc's ledger.
- **P5 (optional) — Plan A′**: hub-protocol spike behind a dev flag (HW-V9); if it works,
  add as premium path with automatic FTMS fallback.

---

## 7. Adversarial self-review

Attacks mounted against this design and their outcomes:

1. **"Web Bluetooth can't hold two connections / needs one gesture per device"** —
   Confirmed workable: two-gesture UX is designed in (§4.6); Auuki proves multi-device in
   production (L7). *Survives; UI must never try to chain choosers off one click.*
2. **"The Click might require encryption Chrome can't do"** — Bare-RideOn plaintext mode
   is confirmed across three independent clients incl. two browser implementations (L4,
   L5). Residual risk is future firmware (Risk 1). *Survives; bridge Plan B correctly
   dropped rather than speculatively built.*
3. **"The virtual-speed model needs the trainer's internal mass, which you don't know"**
   — Real weakness. Changed the design: added the baseline-identity property (default
   gear always exact), HW-V8 to measure `m_t`, and a single trim factor. *Modified.*
4. **"Solving grade at low flywheel speed divides by ~0"** — Added the coasting guard and
   clamps (§4.3). *Modified.*
5. **"Per-command Request Control + 3 s throttle makes shifts feel drunk"** — Addressed
   with control-once + coalescing queue (§4.4) and the existing forceUpdate bypass;
   worst-case felt latency remains trainer-bound ~1 s (Risk 5). *Survives with known
   ceiling; Plan A′ documented as the only true fix.*
6. **"You're rebuilding what the trainer firmware already does better"** — True; that's
   why Plan A′ exists. But firmware-path is UNKNOWN until HW-V9, is KICKR-specific, and
   QZ shows even Zwift-certified trainers need per-model quirks. FTMS-universal first is
   the right order for a design whose fallback must work everywhere. *Survives.*
7. **"Old prototype already 'proved' the Zwift service ignores you"** — Re-examined: it
   sent controller-family frames (L11); the hub-family recipe was never tried. The
   negative result does not condemn Plan A′. *Survives, reframed as HW-V9.*
8. **"Gradient multiplier is simpler and already built"** — It is dead at 0 % grade,
   inverted on descents, and requires an unreproducible AI calibration loop (§1.7). The
   virtual-speed model is ~30 lines of pure math with a no-calibration baseline. *Rejected
   alternative stands rejected.*
9. **"macOS Chrome drops notifications"** — Only at ~100 Hz; Click idles at ~1 Hz and
   FTMS ≤4 Hz (§2.5). *No design impact.*
10. **"Android screen-lock kills BLE"** — Pre-existing app constraint (README); unchanged
    by this feature; note added to HW-V11. *Accepted.*
