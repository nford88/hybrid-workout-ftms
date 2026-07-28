# External Research Synthesis (2026-07-28)

Four parallel research tracks. Byte-level details live in PROTOCOLS.md; this file keeps
the narrative findings and **all sources** so future sessions can re-verify claims.

---

## Track 1 — How Zwift implements virtual shifting

1. **Native mechanism = proprietary "Zwift protocol", not FTMS.** "Supporting Zwift's
   virtual shifting requires adding support for Zwift Protocol… FTMS compatibility alone
   doesn't enable virtual shifting" (Zwift Insider). On shift, the app sends the trainer
   a protobuf `HubCommand` with the new **gear ratio ×10000** (plus grade, wind, Crr,
   CWa, bike/rider weight); trainer firmware computes resistance locally (makinolo).
2. **Pre-native / third-party era used app-side approximations**: recompute target power
   and drive ERG, or rewrite the SIM grade — workable on any FTMS trainer but with felt
   latency; makinolo explicitly contrasts "sluggish" app-side vs "much, much more
   efficient" in-firmware computation. Rouvy adopted Zwift's own protocol in Feb 2025.
3. **The Click never talks to the trainer.** Click → app → trainer. Virtual shifting
   requires BLE/WiFi/Direct Connect (not ANT+).
4. **Math**: virtual speed = `(cadence/60) × gear_ratio × wheel_circumference`; road
   force = gravity + rolling + aero; power = force × speed; the trainer reports a
   **virtual** speed remapped through the ratio (SHIFTR docs, makinolo). Zwift's 24
   ratios span 0.75–5.49.
5. **Seamlessness** is architecture, not a filter: resistance loop runs in firmware; the
   chain/flywheel never move during a shift; only brake force is recomputed. DCR measured
   shifts as instant under full load. No public source documents a smoothing constant
   (INFERRED: flywheel momentum continuity + possibly a firmware ramp).
6. **Zwift Cog** = single 14 t cog + chain guides replacing the cassette; pins the
   physical ratio so firmware has one known flywheel↔pedal mapping; Zwift auto-detects
   the chainring. Works with a normal cassette left in one gear too (= our 34/17
   convention).
7. **Trainer support list** (Zwift Insider): Zwift Hub/Hub One; **Wahoo KICKR CORE**
   (+ Core 2 / Zwift One / KICKR v6 / Move — v4/v5 cannot); Tacx NEO 2/2T/3M; Elite
   Direto/Suito/Avanti/Justo; JetBlack Victory/Volt v2; Van Rysel D100.
8. **KICKR Core specifics**: firmware **v1.3.17 (2024-02-08)** added virtual shifting to
   all existing Cores; enabled platform-wide by Zwift Feb 7–8 2024. FTMS + Zwift service
   are advertised in parallel; ERG via FTMS still works for other apps with the Cog on.

Sources:
- https://zwiftinsider.com/virtual-shifting/
- https://zwiftinsider.com/virtual-shifting-support-status/
- https://zwiftinsider.com/kickr-core-firmware-v1-3-17/
- https://www.makinolo.com/blog/2024/10/20/zwift-trainer-protocol/
- https://www.makinolo.com/blog/2023/11/06/virtual-gear-shifting-in-indoor-training/
- https://github.com/JuergenLeber/SHIFTR + /blob/main/VirtualShifting.md
- https://www.dcrainmaker.com/2023/10/zwift-clicks-review.html
- https://www.dcrainmaker.com/2024/02/wahoo-kickr-review.html
- https://www.dcrainmaker.com/2025/02/rouvy-adds-zwift-cog-click-ride-virtual-shifting-battle-royale-begins.html
- https://support.zwift.com/en_us/virtual-shifting-faq-r16UiRFlT

## Track 2 — qdomyos-zwift (QZ): the working open-source implementation

Repo `cagnulein/qdomyos-zwift` @ master, 2026-07-28.

1. **Zwift controller client**: `src/zwift_play/` (ported from ajchellew's zaplibrary,
   PR #2089 Feb 2024). Plain `RideOn` ⇒ unencrypted; full AES-CCM/ECDH code present but
   `#if 0`-ed (`abstractZapDevice.h:10-15`). Click 0x37 parsing at
   `abstractZapDevice.h:51-295`; 500 ms auto-repeat; haptic ack via
   `12 12 08 0A 06 08 02 10 00 18 <pattern>`.
2. **Gear state**: `double m_gears` (`bike.h:111`); `setGears()` clamps 1–24 in
   Zwift-ratio mode and immediately re-sends the last resistance/inclination
   (`bike.cpp:208-314`).
3. **Four resistance paths, not three** (correcting/extending the prior session's count):
   - (a) default (`ftmsbike.cpp`): rewrite FTMS 0x11 grade, `slope += gearsModifier() × 50`
     ⇒ **+0.5 % grade per gear step** (additive — unlike our multiplicative model)
     (:1815-1950, `ftmsbike.h:125`);
   - (b) resistance-level offset for resistance-mode devices;
   - (c) **trainer-native Zwift hub protocol** when the trainer has the Zwift service
     (`gears_zwift_ratio`): hub handshake `RideOn 02 01` + `zwiftPlayInit()` (:203-240),
     protobuf `SimulationParam` inclination (:411-427), gear command
     `10000 × (ratio/original) × (42/14)` + apply `00 08 88 04` (:559-612); 0.4 %
     inclination must precede first gear cmd (:560-565); FTMS CP writes suppressed
     (:89-105). **Confirmed 2026-07-28** against the actual protobuf schema,
     `src/devices/zwifthubbike/Zwift hub.proto` — see PROTOCOLS.md §2 for the verbatim
     field definitions (`PhysicalParam.RiderWeightx100`/`BikeWeightx100` are real fields,
     not inferred).
   - (d) **NEW, found 2026-07-28 — `bike.cpp`'s `computeSlopeTargetPower()` /
     `updateSlopeTargetPower()` ("auto resistance" mode)**: computes target power
     app-side from QZ's own configured rider+bike weight (`QZSettings::weight`,
     `QZSettings::bike_weight`) via the standard gravity+rolling+aero physics formula,
     then drives the trainer via **ERG target power (0x05)** — bypassing the trainer's
     own SIM physics and fixed-mass assumption entirely. This is the same strategy our
     design rejected as F4 ("ERG-drive virtual shifting") in HYPOTHESES.md, but it's a
     real shipped code path, not a hypothetical — worth an empirical comparison point in
     HW-V12, not a theory-only dismissal.
   - **(e) NEW, found 2026-07-28 (full detail, corrects/expands the prior "related" note)
     — Wahoo-proprietary wheel-circumference rewrite**: `wahookickrsnapbike.cpp` drives a
     Wahoo Fitness Machine Control Point *extension* — distinct decimal opcodes
     `_setErgMode=66, _setSimMode=67, _setSimGrade=70, _setWheelCircumference=72`
     (`wahookickrsnapbike.h:56-62`), **not** the standard FTMS `0x2AD9` opcode space.
     `setWheelCircumference()` (`:220-227`) encodes millimeters×10 behind opcode 72;
     default circumference **2070mm** ("700×18C", `qzsettings.h:2473-2474`). Per-shift
     behavior is **branched by device flag** — for literal KICKR SNAP hardware this same
     class instead re-sends grade (`:332-341`); the wheel-circumference rewrite applies
     only to the *other* Wahoo devices this shared class handles. Underlying formula,
     `wheelCircumference::gearsToWheelDiameter()` (`src/wheelcircumference.h:29-38`):
     `(gear_circumference / original_ratio) × current_ratio`, same `original_ratio =
     42/14` reference constant as the Hub gear formula (§ below) — the only caller of
     this function in the repo. Full detail, including a **correction** to this doc's
     prior wheel-circumference attribution to `Berg0162/Kickr-Virtual-Shifting` (not
     confirmed — see Track 5), is in PROTOCOLS.md §3.5.
4. **QZ can also emulate a Zwift Hub** (`virtualbike.cpp`, `zwift_play_emulator`, 1795
   lines, read in full 2026-07-28): advertises the Zwift service to the real Zwift app and
   translates Zwift's gear/slope/power protobufs into FTMS for any trainer — the mirror
   image of what we want. Notably, **its own gear-command decoder does not invert the
   `10000×(ratio/original)×(42/14)` formula analytically** — it matches incoming bytes
   against a hardcoded lookup table of the 24 exact byte pairs/triples captured from real
   Zwift traffic (`characteristicwriteprocessor0003.cpp:60-118`), then calls
   `gearUp()`/`gearDown()` repeatedly. Full wire-level detail in PROTOCOLS.md §2.5.
5. Gear ratio table presets incl. "Reality Bender (24 even spaced)" = Zwift's ratios
   (`gears.qml:191-218`); same ratios as protobuf varints in
   `characteristicwriteprocessor0003.cpp:60-125`.
6. **NEW, found 2026-07-28 — full device-backend inventory (54 classes inherit `bike`,
   confirmed via repo-wide code search)**: only `ftmsbike.cpp` and `wahookickrsnapbike.cpp`
   implement anything beyond the shared `bike::changeResistance()` base gear-modifier
   application, and `kettlerusbbike.cpp` is the sole class wiring `bike::
   updateSlopeTargetPower()` (strategy (d)) to a real device. At least 4 more classes
   implement their **own, mutually inconsistent** gear-scaling conventions, none matching
   `ftmsbike.h:125`'s `GEARS_SLOPE_MULTIPLIER=50`:
   - `technogymbike.cpp`: 3 different multipliers for 3 different modes — resistance
     `gearsModifier()×5` (`:171`), slope unscaled (`:572-573`), power `gearsModifier()×10`
     (`:596-597`).
   - `renphobike.cpp`: resistance is an unscaled add (`:151`); slope uses its own
     hardcoded `×50` literal (`:582`) — numerically identical to `ftmsbike.h:125` but a
     separate constant, not a shared one.
   - `proformwifibike.cpp`: **subtracts** `gearsModifier()` from incline (`:511,521`) —
     the only device found with an inverted sign convention vs. every other device
     checked; a real correctness risk if virtual shifting were ever extended to it.
   - `stagesbike.cpp`, `bkoolbike.cpp`, `computrainerbike.cpp`,
     `cycleopsphantombike.cpp`: plain unscaled additive `gearsModifier()`, no multiplier.
   - `nordictrackifitadbbike.cpp`: hardware-specific linear incline→motor-position
     calibration curves (e.g. `y2 = 616.18 − 17.223×(inc+gearsModifier())`, `:362-371`) —
     a per-device calibration fit, not a shared grade/gear model.
   - The remaining ~43 `*bike.cpp` classes have no gear-modifier logic of their own at
     all — inclination/SIM mode is not gear-adjusted for these devices unless they
     implement it themselves; they rely solely on the shared `bike::changeResistance()`.
   - **Design lesson for our own drivetrain model**: even QZ's own reference
     implementation has no single "natural" gear-to-resistance convention across its 54
     device backends — reinforces that our physics-derived virtual-speed model (DESIGN
     §4.3), not an arbitrary per-device multiplier, is the right approach.
7. **`src/wheelcircumference.h` (125 lines, read in full 2026-07-28)**: default
   circumference 2070mm ("700×18C"), default reference gear ratio 42T/14T
   (`qzsettings.h:2464-2468`). Its `gearsToWheelDiameter()` formula computes a synthetic
   *effective wheel circumference* for the trainer's own onboard circumference control —
   it has **no cadence input** and does not compute `v_virt` in software the way our own
   `v_virt = (cadence/60) × r_gear × wheel_circumference` convention (DESIGN §4.3) does;
   instead it lets the trainer's firmware do `speed = wheel_rps × effective_circumference`
   once it receives the rewritten circumference value. Same overall multiplicative
   structure, different locus of computation (hardware vs. our software). Full comparison
   in PROTOCOLS.md §3.5.
8. **A physics-constant mismatch found inside QZ itself**: `bike.cpp`'s own
   `computeSlopeTargetPower()` (strategy (d)) hardcodes `CdA=0.4` and defaults `Crr=0.005`
   (`bike.cpp:604-637`) — both differ from the real Zwift-Hub-protocol constants
   `CWa=0.51`/`Crr=0.004` confirmed straight from the `.proto` file's own comments
   (PROTOCOLS.md §2.0). Even QZ's reference implementation doesn't hold its physics
   constants consistent across its own resistance strategies.

Sources:
- https://github.com/cagnulein/qdomyos-zwift — key files: `src/zwift_play/*`,
  `src/devices/bike.{h,cpp}` (728 lines, read in full 2026-07-28),
  `src/devices/ftmsbike/ftmsbike.{h,cpp}` (2334 lines, read in full 2026-07-28),
  `src/devices/wahookickrsnapbike/wahookickrsnapbike.{h,cpp}` (read in full 2026-07-28),
  `src/wheelcircumference.h` (125 lines, read in full 2026-07-28), `src/qzsettings.h`
  (relevant sections), `src/virtualdevices/virtualbike.cpp` (1795 lines, read in full
  2026-07-28), `src/characteristics/characteristicwriteprocessor0003.cpp` (316 lines,
  read in full 2026-07-28), `src/gears.qml`; plus, for the 2026-07-28 device-inventory
  pass: `src/devices/kettlerusbbike/kettlerusbbike.cpp`,
  `src/devices/technogymbike/technogymbike.cpp`, `src/devices/renphobike/renphobike.cpp`,
  `src/devices/proformwifibike/proformwifibike.cpp`,
  `src/devices/stagesbike/stagesbike.cpp`, `src/devices/tacxneo2/tacxneo2.cpp`,
  `src/devices/bkoolbike/bkoolbike.cpp`, `src/devices/computrainerbike/computrainerbike.cpp`,
  `src/devices/cycleopsphantombike/cycleopsphantombike.cpp`,
  `src/devices/nordictrackifitadbbike/nordictrackifitadbbike.cpp` (plus a repo-wide
  `gh api search/code` confirming 54 total `public bike` subclasses and no `42.0/14.0`
  hits outside `ftmsbike.cpp:574`); PR #2089 (Zwift Click client), PR #2757 "Zwift hub gear
  custom" (commit `109dc90`, 2024-11-13 — introduces the `×(42/14)` literal), PR #2682
  "Wahoo Custom gearing ranges/ratios" (commit `281590c`, 2024-10-31 — introduces the
  `default_gear_crankset_size`/`default_gear_cog_size` settings later reused by #2757);
  issues #2099, #3611, #3952, #4018, #4545, #4743, #4746 (mining results: Track 6 below)
  — plus, fetched directly 2026-07-28 via `gh api`:
  `src/devices/zwifthubbike/Zwift hub.proto` — **the full 164-line file**, not just the
  first ~150 lines / 3 core messages read in the prior session (see PROTOCOLS.md §2.0 for
  the newly-found `HubRequest`/`HubRidingData` extra fields) — and `src/devices/bike.cpp`
  lines 602-728 (`computeSlopeTargetPower`/`updateSlopeTargetPower`, item 3(d) above)
- https://robertoviola.cloud/2024/02/06/revolutionizing-indoor-cycling-qz-apps-integration-with-zwift-click/
- https://robertoviola.cloud/2024/09/16/zwift-ride-with-mywhoosh-indievelo-rouvy-and-much-more/

## Track 5 — Cross-validation against other independent open-source reimplementations (2026-07-28)

Checked whether QZ's `bike.cpp::computeSlopeTargetPower()` exact-trig gravity+rolling+aero
formula is corroborated by other independently-implemented virtual-shifting/grade-
simulation projects already cited in this doc's sources.

- **[Berg0162/Kickr-Virtual-Shifting](https://github.com/Berg0162/Kickr-Virtual-Shifting)**:
  no independent physics formula. It's a BLE bridge terminating Zwift's `0xFC82` Virtual
  Shifting service and re-emitting to a real KICKR. Its own gear model,
  `UTILS::calculateGearedZwiftGrade` (`src/Utilities.cpp:105-128`), is a **gradient-
  multiplier with a non-linear perceptual power-law scaling**:
  `effectiveGrade = realGrade × pow(gearRatio/defaultGearRatio, alpha) × difficultyFactor`,
  clamped 0.4–1.6× — structurally the **same category as this project's own superseded
  `VirtualGear.applyToGradient`** (DESIGN §1.7), not force/power physics. No `sin`/`cos`/
  `atan` anywhere in the force/power path; `gravity`/`pi` constants are declared
  (`Utilities.cpp:12-13`) but never used. Reuses Zwift's own 24-ratio table verbatim
  (`Utilities.cpp:22-23`). **CORRECTION**: this doc previously attributed the Wahoo
  wheel-circumference-per-shift technique (PROTOCOLS.md §3.5) to this repo — a direct read
  of its physics-relevant files found no such mechanism; treat that attribution as
  unconfirmed/likely mistaken (HYPOTHESES U15).
- **[Berg0162/simcline](https://github.com/Berg0162/simcline)**: no independent physics
  formula, as expected given its actual purpose (mechanical incline actuator, MITM on
  FTMS SIM params). Grade is linearly mapped to actuator position
  (`esp32_FTMS_Simcline_v015.ino:535,881`); Crr/Cw are parsed/logged but never used in any
  local force/power equation. **Confirms the "1–1.5s felt latency" claim (L15, H10) at its
  actual source**: its own README states *"The delay between the initial command (by
  Zwift) and the feel on the bike is 1 to 1.5 seconds... Simcline is a MITM and is the
  first to receive changes in road grade"* — an author observation, not a derived figure,
  but legitimate first-party evidence for that number.
- **[doudar/SmartSpin2k](https://github.com/doudar/SmartSpin2k)**: no independent gravity+
  rolling+aero formula. Grade/incline is applied as a linear multiplier on stepper-motor
  position (`src/Stepper.cpp:46`), calibrated against an **empirical power-table
  regression** (`src/Power_Table.cpp`/`PowerTable_Helpers.cpp`) — the only `sqrt()` found
  is quadratic curve-fit interpolation, unrelated to physics. Rolling/wind-resistance
  bytes are parsed off the FTMS wire but explicitly unused
  (`src/BLE_Fitness_Machine_Service.cpp:294-295`).

**Synthesis**: none of these three repos compute local gravity+rolling+aero physics at
all — they're grade-passthrough/actuator-position layers (forwarding to a real trainer's
firmware, mapping linearly to a mechanical actuator, or driving a calibrated stepper-
position table), not physics engines. **This means the exact-trig-vs-small-angle question
literally doesn't arise in any of them** — it's not evidence for either approach, one way
or the other. QZ's `bike.cpp::computeSlopeTargetPower()` remains the **only** exact-trig
local-physics implementation found across every source checked to date (updates H24 in
HYPOTHESES.md). Where these repos do state Crr/Cw defaults (Kickr-Virtual-Shifting:
Crr=0.00415, Cw=0.51), the values are close to QZ's own hub-protocol constants — consistent
with everyone ultimately sourcing defaults from Zwift's published numbers, but that's
agreement on **constants**, not on **formula structure**.

## Track 6 — Real-world shift-feel evidence from QZ's GitHub issues (2026-07-28)

Mined the 7 issues/PRs already cited above as sources. **3 of the 7 are pull requests
about Zwift Click Bluetooth pairing/crypto (#2099, #4743, #4746) — off-topic for
resistance-strategy comparison, flagged rather than forced into a shift-feel narrative.**
#3952 is a documentation-request issue with no empirical content. The remaining 3 carry
real signal:

- **#3611** ("[REQ] Emulation of Zwift virtual shifting... for Tacx Neo 2T native virtual
  shifting")** — strategy (c), trainer-native hub protocol. OP found native Zwift hub
  shifting on a real Tacx Neo 2T "really neat." QZ's own reimplementation of the same
  protocol against that trainer, once working, was reported as switching gears but with
  a "different feel" and "odd" gear ratios vs. real Zwift — maintainer `cagnulein`
  conceded this needed further code review. (Corroborates test-matrix item 33 — reverse-
  engineered wire format working ≠ Zwift-identical feel.)
- **#4018** ("Delayed Resistance Changes when Virtual Shifting") — the most substantive
  thread, on a Wahoo KICKR (2018), same trainer family as our KICKR Core V2. Strategy (a)
  default grade-offset: multi-gear shifts took ~6–10s to settle; rapid multi-clicks were
  effectively ignored until clicking stopped; one 14-mile-ride report showed shifting
  delays growing to 30s–1min with a ~50W resistance ceiling despite gear 24. A same-ride,
  same-log comparison showed gradient(SIM)-driven grade changes were fast while gear-
  driven ones were sluggish on the same hardware — maintainer attributed this to either
  the trainer's actuator settling time on large steps, or QZ's one-command-per-gear-step
  queuing during rapid shifts (proposed a debounce fix), and stated explicitly *"it's not
  a zwift play or a zwift channel communication issue, it's just the trainer."* Strategy
  (b) resistance-offset mode was reported as non-functional in this user's tests (either
  unrideable or fully unresponsive) — unresolved, possibly config/bug rather than
  inherent.
- **#4545** ("[REQ] Custom gear resistance table") — strategy (a)'s **linear** step size
  on a Magene T300 Plus: *"QZ adds a linear, fixed resistance step for every gear
  click... to get enough heavy resistance to sprint, I have to click 12-15 times"*, but
  raising the gain broke fine cruising control. Maintainer shipped a **custom per-gear
  table** feature (non-linear steps) in response; user confirmed *"Tested in a race
  today, worked as expected"* after iteration. Same user explicitly preferred manual gear
  control over strategy (d)'s auto/ERG mode, but gave no experiential detail on it.

**Synthesis**: the evidence does not support ranking all strategies — no single user
issue compares all four. What it does support: strategy (a)'s default **linear** step is
the one with the most numerically-detailed complaints (multi-second-to-multi-minute lag,
hard resistance ceilings, a step-size tradeoff mitigated only by a custom non-linear
table); strategy (b) was reported outright broken in one user's testing; strategy (c)
(QZ's own hub-protocol reimplementation) "works" but doesn't reproduce native Zwift's
feel even by the maintainer's own admission; strategy (d) has zero direct user evidence
in this set. Treat these as isolated, trainer-specific data points, not a validated
cross-strategy ranking.

## Track 3 — Zwift Click BLE protocol (details → PROTOCOLS.md §1)

Headlines:
1. Service UUID verified char-for-char; **advertised UUID changed to 0xFC82 in Jan-2025
   firmware** (characteristics unchanged) — probe both.
2. Bare `RideOn` ⇒ unencrypted mode on all current firmware (discovery credited to
   cagnulein, Feb 2024); encryption is optional-by-handshake, AES-**CCM** (not GCM).
3. Click v1 buttons = type 0x37 frames, inverse logic; v2/Ride = 0x23 bitmap.
4. No client keepalive needed; **Click v2 has a ~60 s vendor-unlock disconnect** unless
   recently paired with real Zwift; Click powers off ~1 min unconnected.
5. **Web Bluetooth prior art exists and works**: lord's single-file web demo
   (requestDevice → FC82 → RideOn → parse 0x23) and BikeControl's shipped Flutter-web
   build (reads Click/Play buttons in-browser). On web, manufacturer data is unavailable
   at chooser time ⇒ detect variant from frame type.
   ⚠️ Do not misread BikeControl's README caveat "No controlling possible [in browser],
   though" — that refers to their *output* side (emulating a BLE peripheral / injecting
   keystrokes into Zwift), which browsers can't do. Our use case is central-role only
   (read Click, write trainer) and is fully supported.
6. No npm package exists for this (gap we'd fill in-repo).

Sources:
- https://github.com/ajchellew/zwiftplay (README; zaplibrary: ZapBleUuids.kt,
  ZapConstants.kt, AbstractZapDevice.kt, ZapCrypto.kt, ClickNotification.kt,
  ZwiftClickTest.kt) + PR #3 discussion (unencrypted-mode discovery, Click frames)
- https://www.makinolo.com/blog/2023/10/08/connecting-to-zwift-play-controllers/
- https://www.makinolo.com/blog/2024/07/26/zwift-ride-protocol/
- https://gist.github.com/lord/7a4e1fccf4ceb25943a5e08abe4a7f34 (working Web Bluetooth demo)
- https://github.com/jonasbark/swiftcontrol → https://github.com/OpenBikeControl/bikecontrol
  (constants.dart, zwift_device.dart, zwift_click*.dart, controller_keep_alive.dart,
  TROUBLESHOOTING.md, issue #68); web build: https://openbikecontrol.github.io/bikecontrol/

## Track 4 — FTMS spec + Web Bluetooth feasibility (details → PROTOCOLS.md §3–4)

Headlines:
1. FTMS v1.0 spec obtained (mirror onelap.cn/pdf/FTMS_v1.0.pdf) — 0x11 layout, control
   persistence, procedure serialization, ERG/SIM last-write-wins, Machine Status 0xFF,
   0x12 = wheel circumference (0x13 = spin down).
2. Trainer physics formula is convention (ftmsemu.github.io), not spec; **mass is
   trainer-internal** — the single biggest unknown for our grade-solve accuracy.
3. Zwift sends 0x11 ~continuously (~1 Hz, INFERRED); implements its own retry/timeout;
   felt latency 1–1.5 s (Berg0162/simcline). No primary source for a Wahoo-specific
   command-drop quirk.
4. Web Bluetooth: multi-device from one page proven (Auuki); one gesture per chooser;
   `getDevices()` persistence still flag-gated; custom UUIDs must be in
   `optionalServices`; macOS high-rate notification drops irrelevant at our rates;
   L2CAP/bonding out of scope (and not needed).

Sources:
- FTMS v1.0 spec mirror: https://www.onelap.cn/pdf/FTMS_v1.0.pdf
- https://ftmsemu.github.io/
- https://github.com/doudar/SmartSpin2k/discussions/296 (Zwift opcode sequences)
- https://github.com/Berg0162/Kickr-Virtual-Shifting (grade-remap virtual shifting)
- https://github.com/Berg0162/simcline (1–1.5 s latency measurements)
- https://blog.zwiftalizer.com/post/releasenotes-2022-02-24/ (FTMS resends)
- https://forums.zwift.com/t/lost-connections-log-entry-ftms-request-took-too-long-resetting-trainer-writing-for-help-w-multiple-recent-dropped-zc-to-zwift-app-connection/581285
- https://github.com/WebBluetoothCG/web-bluetooth/issues/195 (multi-connection)
- https://github.com/dvmarinoff/Auuki (production multi-device Web Bluetooth cycling app)
- https://github.com/WebBluetoothCG/web-bluetooth/blob/main/implementation-status.md
- https://developer.chrome.com/docs/capabilities/bluetooth
- https://github.com/electron/electron/issues/37090 (gesture consumption)
- https://lists.w3.org/Archives/Public/public-web-bluetooth-log/2019Jul/0001.html (#447 macOS drops)
- https://github.com/WebBluetoothCG/web-bluetooth/issues/137 (pairing gap)
- Android GATT limit: https://support.google.com/android/thread/43071437/

## Source conflicts (kept explicit, not silently resolved)

| Conflict | Resolution used |
|---|---|
| Handshake status bytes after `RideOn`: `01 02`/`01 01` (captures) vs `00 09` (decompiled docs) vs "don't matter" (ajchellew code comment) | Treat as don't-care on send; don't validate strictly on receive |
| AES-GCM (ajchellew README) vs AES-CCM (his code + makinolo) | CCM (code beats prose) |
| Click v2 manufacturer-data type codes: QZ heuristic vs BikeControl 0x0A/0x0B | Unresolved; irrelevant on web (no mfg data) — detect via frame type |
| Encryption "removed" (makinolo) vs "always optional" (cagnulein) | Moot: bare RideOn ⇒ plaintext on all current firmware |
| Encrypted-frame counter endianness LE (on-air) vs BE (ajchellew encrypt path) | Unresolved; encrypted mode is out of scope |
| Ride device name "Zwift Ride" vs "Zwift SF2" | Firmware-version difference; Click is consistently "Zwift Click" |
| KICKR v4/v5 virtual-shifting support: DCR (Feb 2024) "future/uncertain" vs Zwift Insider "cannot support the required protocols" | Zwift Insider is later and definitive; support never shipped. Irrelevant to the Core but shows support lists drift — re-check before citing them |
| Trainer naming: prototype notes say "KICKR Core V2" (hardware revision?) vs Wahoo's 2025 product "KICKR CORE 2" | Ambiguous which unit is on hand — HW-V1 records model + hardware revision (HYPOTHESES U11) |
