# Hypotheses — Tested vs Untested

Living document. When an experiment resolves a row, move it to "Tested" with the result,
date, and evidence. Keep the design doc's ledger (../VIRTUAL_SHIFTING_DESIGN.md §2.6)
in sync.

## A. Tested — CONFIRMED (evidence in hand)

| ID | Hypothesis | Result | Evidence |
|---|---|---|---|
| H1 | The KICKR Core V2 exposes the Zwift custom service `00000001-19ca-…` alongside FTMS | ✅ TRUE | Feb-2026 device scan logs baked into `src/dev/zwift-virtual-shifting.html:973-975, 1002-1005` |
| H2 | FTMS wheel-circumference manipulation can fake gearing on the KICKR Core | ❌ FALSE | Feature bit absent; commands rejected (`zwift-virtual-shifting.html:846-860`). Also the prototype used opcode 0x13 (= Spin Down); wheel circumference is 0x12 — wrong opcode either way, but the feature flag settles it |
| H3 | The trainer accepts and ACKs RideOn-prefixed writes on its Zwift service | ✅ TRUE (but see H7) | ACK `52 69 64 65 4F 6E 02 02` + riding-data notifications observed (`zwift-virtual-shifting.html:318-331`) |
| H4 | Zwift virtual shifting = gear ratio sent to trainer; firmware computes resistance | ✅ TRUE | makinolo trainer-protocol RE; zwiftinsider (RESEARCH.md Track 1) |
| H5 | Zwift Click speaks unencrypted after bare `RideOn`; buttons are plain protobuf (0x37 v1 / 0x23 v2) | ✅ TRUE | ajchellew PR#3, QZ, BikeControl — three independent clients (RESEARCH.md Track 3) |
| H6 | Zwift Click is reachable from Web Bluetooth in a browser | ✅ TRUE | lord's working web demo; BikeControl shipped web build (RESEARCH.md Track 3) |
| H12 | One Chrome page can hold trainer + controller GATT connections simultaneously | ✅ TRUE (in general, AND now confirmed on our specific pairing) | Web Bluetooth spec #195; Auuki in production. Our pairing: **HW-V0, 2026-07-28** — both connected ~76s with continuous notify traffic, zero drops (`experiments/01-dual-connection-smoke-test.md`). Sustained-load/pedaling re-confirmation still HW-V7's job |
| H13 | FTMS control permission persists after one Request Control (per-command 0x00 unnecessary) | ✅ TRUE (spec) | FTMS v1.0 §4.16.2.1 — behavioral check on KICKR folded into HW-V7/V10 |
| H14 | (New, unplanned) The KICKR Core's Zwift-service ASYNC characteristic (`00000002-19ca-…`) pushes unsolicited notifications with no handshake | ✅ TRUE (raw observation); **INFERRED** that it's firmware debug/log telemetry (interpretation of the decoded ASCII, not verified against any source) | `experiments/01-dual-connection-smoke-test.md`, 2026-07-28 — 3 frames decoded to `"ATX 01, STX 00"`, `"ATX 01, STX 01"`, `"gap_params_change(0): 72, 72, 0, 600"`, all before any write was sent to the trainer's Zwift service |
| H15 | Our Click unit(s) are v2/Ride-family (type `0x23` bitmap frames), not v1 (`0x37`) | ✅ TRUE | Live capture, 2026-07-28: RideOn handshake echoed bare (no status-byte suffix, unlike documented `01 03`/`02 03`), then all ASYNC frames were type `0x23`. Idle/all-released = `23 08 ff ff ff ff 0f` exactly as documented |
| H16 | Click v2's ~60s-without-real-Zwift-unlock disconnect (R2) affects our units, and pairing once with the real Zwift app fixes it | ✅ **LIKELY TRUE — and user confirms this is a required first step, not just a fix-it-if-broken workaround.** Zwift Companion pairing is "the sync process" that must happen before third-party BLE clients (our web harness included) get a usable connection at all. **Filed as base validation BV2** (`experiments/00-test-matrix.md` §6) — one clean before/after pair, not yet a repeated controlled trial | Live capture, 2026-07-28: pre-sync, repeated connect→disconnect cycles at ~44–90s intervals (e.g. 13:51:21→13:52:29 = 68s). Post-sync (paired both units in Zwift Companion once), the next connection held **5+ minutes straight** with zero drops (`experiments/03-click-buttons-partial.md`). User confirmation, this turn: treat Companion sync as mandatory onboarding, not optional |
| H17 | The Left/Right Click pair has a primary/secondary relay relationship — only one physical unit needs a BLE connection to receive both controllers' button events | ✅ **CONFIRMED** | Live capture, 2026-07-28: Left D-pad + "−" presses arrived on the exact same BLE connection already serving Right's buttons, with zero new connect/disconnect events in between (`experiments/04-click-mapping-and-relay-confirmed.md`). **Major simplification**: production adapter needs one GATT connection, not two |
| H18 | Full Left/Right button→bit mapping | ✅ **CONFIRMED for what we need** | `experiments/04-click-mapping-and-relay-confirmed.md`: Right "+"=`0x20`, Left "−"=`0x100` (neither matches the community-borrowed "SHFT_UP_R"/"SHFT_DN_L" names); D-pad (Left) and Y/Z/A (Right) match the community table exactly. "B" unconfirmed (likely mixed up with adjacent "+" paddle) |
| H19 | KICKR Core's Reset (0x01) opcode revokes control (per FTMS §4.16.2.1) | ❌ **FALSE, for the ATT-level claim only** — Reset ack'd Success, then a Sim Params write with no re-Request-Control was ALSO accepted (`80 11 01`, not the spec-predicted `80 11 05` Control Not Permitted). This part is a solid protocol fact. **Corrected** (user challenge, same session): the follow-on claim that this also produced a *genuine, confound-free* resistance change (based on a power-trace rise) was overreach from a single uncontrolled trial — rider effort isn't controlled for. Demoted to a base validation, BV1 in `experiments/00-test-matrix.md` §6, pending a Machine-Status-based or blinded-repeat retest | `experiments/05-ftms-conformance-hw-v10.md`, 2026-07-28 + addendum |
| H20 | A Web Bluetooth client can provoke a real "concurrent unserialized write" race against the trainer (to test its ATT-level conflict handling) | ❌ **FALSE, structurally** | `experiments/05-ftms-conformance-hw-v10.md`: Chrome's own GATT layer rejects the second same-characteristic write client-side (`NetworkError: GATT operation already in progress`) before it reaches the peripheral — the race the test wanted to observe can't happen from one Chrome tab. Would need two independent BLE clients |
| H21 (resolves U6) | The `×(42/14)` gear-ratio normalization in QZ's hub gear command (`ftmsbike.cpp:574`) is a Zwift-Hub-protocol-specific requirement | ❌ **FALSE — it is QZ's own generic default-gearing constant, reused, not Hub-specific** | 2026-07-28 QZ source deep dive: repo-wide `gh api search/code` for `42.0/14.0` returns only `ftmsbike.cpp:574`; the actual constants are `QZSettings::default_gear_crankset_size=42`/`default_gear_cog_size=14` (`qzsettings.h:2464-2468`), QZ's app-wide default reference-bike gearing used for *any* device's `original_ratio`, not just the Hub path. Provenance: `default_gear_*` introduced in PR #2682 "Wahoo Custom gearing ranges/ratios" (2024-10-31, unrelated to Zwift), reused as a hardcoded literal by PR #2757 "Zwift hub gear custom" (2024-11-13). Whether 42T/14T itself has any real-world/Zwift-internal significance beyond "QZ's own default" remains UNKNOWN — see PROTOCOLS.md §2.4 |
| H22 (resolves U7) | Hub-protocol control and FTMS control cannot coexist on the code path QZ implements — the suppression at `ftmsbike.cpp:89-105` fully excludes FTMS writes, not just some of them | ✅ **TRUE, definitively — single flag pair, mode switch not coexistence** | 2026-07-28 QZ source deep dive, `ftmsbike.cpp:86-105` read in full: every FTMS caller goes through one shared `writeCharacteristic()`; when `zwiftPlayService && gears_zwift_ratio` both hold, it returns `false` immediately before `enqueueWrite` — no structurally separate FTMS path, no queueing. Confirms `VIRTUAL_SHIFTING_DESIGN.md` §4.6′'s "suppress FTMS CP writes while active" assumption was already correct. See PROTOCOLS.md §2.3. (Still UNKNOWN whether *our* KICKR's own firmware, independent of QZ's client-side choice, would tolerate concurrent hub+FTMS traffic if a client tried it anyway — HW-V9 remains the hardware-side half of this question) |
| H23 | `VIRTUAL_SHIFTING_DESIGN.md` §4.3's small-angle approximation (`cos θ'≈1` when inverse-solving grade from target power) introduces negligible error, even at steep grades, because the approximated term is scaled by the tiny `Crr` coefficient | ✅ **TRUE — proven analytically, not just empirically** | 2026-07-28 math derivation (this session): for a "true" grade solved exactly forward and then round-tripped through the design's approximate inverse, the induced error is exactly `sin θ' = sin θ_true − Crr·(1 − cos θ_true)`, independent of mass/speed/Cw. Numerically (Crr=0.004): 6%→error 0.0007 percentage points; 10%→0.0021pp; 15%→0.0044pp; 20%→0.0069pp — all smaller than the FTMS 0x11 grade field's own 0.01-percentage-point wire quantization. See full derivation and design recommendation in §F below |
| H24 | None of the other independently-implemented virtual-shifting/grade-simulation projects cited in RESEARCH.md (Berg0162/Kickr-Virtual-Shifting, Berg0162/simcline, doudar/SmartSpin2k) compute gravity+rolling+aero physics locally, so none constitute independent-reimplementation evidence for exact-trig vs. small-angle | ✅ **TRUE** | 2026-07-28 cross-validation deep dive (RESEARCH.md Track 2/5): Kickr-Virtual-Shifting applies a gradient-multiplier ("geared grade") and forwards via standard FTMS SIM params/CPS resistance — no local force/power formula, no trig at all. simcline linearly maps received grade to actuator position — Crr/Cw parsed but unused. SmartSpin2k maps incline linearly to stepper position via an empirical power-table regression — no gravity/rolling/aero formula. QZ's `bike.cpp::computeSlopeTargetPower()` remains the **only** exact-trig physics implementation found across all sources checked to date |
| H25 | Candidate (a) (grade-offset additive, flat ±0.5%/gear) produces a clearly differentiated, monotonic power response with no zero-grade dead zone | ✅ **TRUE** | HW-V12 (partial), 2026-07-28: 2% baseline harder=175.3W vs easier=135.1W (40.2W gap); 0% baseline harder=85.4W vs easier=58.9W (26.5W gap, confirms no dead zone). Scored 17/20 on the bake-off rubric (loses points only on "feel" — step size is arbitrary/not speed-scaled). `experiments/08-hw-v12-bakeoff-partial.md` |

## B. Tested — FALSIFIED approaches (do not retry as-is)

| ID | What was tried (Feb 2026) | Why it failed |
|---|---|---|
| F1 | Sending Zwift **controller**-family messages (`SET_GEAR_TEST_DATA` 0xFF04, Data-Object IDs 529/532/547, "simulated gear ratio" patterns) to the **trainer's** Zwift service | Wrong message family — those are controller↔app messages. Trainer ACKed and ignored; zero resistance change (`zwift-virtual-shifting.html:318-346`). The correct **hub**-family command (0x04 + ratio×10000 + apply bytes) was never tried → became H8/HW-V9 |
| F2 | FTMS wheel-circumference gearing (H2) | Unsupported feature + wrong opcode |
| F3 | Gradient-multiplier model (`grade × multiplier`) as the drivetrain | Dead at 0 % grade, inverted on descents, requires unreproducible calibration (design doc §1.7). Superseded by the virtual-speed model |

## B2. Rejected at design time (no hardware test — reasoning only; reconsider triggers noted)

| ID | Alternative | Why rejected | Reconsider when |
|---|---|---|---|
| F4 | **ERG-drive virtual shifting**: recompute a target power every tick from gear + grade + speed and drive the trainer with 0x05 (the app-side approach makinolo describes pre-dating the native protocol) | Trainers are sluggish adjusting power targets; the ERG control loop is cadence-coupled (low-cadence "spiral of death" — trainer raises force as you slow, opposite of SIM feel); freewheeling/descents feel dead in ERG; and it fights the existing SIM pipeline instead of composing with it | If HW-V7 shows the KICKR responds to 0x05 dramatically faster than 0x11 (unlikely — same control point) |
| F5 | **qdomyos default additive offset** (`grade += 0.5 % × gears`) | Not speed-scaled: +0.5 % feels different at 15 vs 40 kph, and the step size is arbitrary rather than derived from a gear ratio. It *is* dead-simple and has no unknowns though | As an emergency fallback if the virtual-speed solve misbehaves on real hardware — it's ~3 lines and could ship behind a setting |
| F6 | WebHID adapter | No concrete HID shifter device identified; Gamepad API covers generic controllers | A real WebHID-only device shows up |
| F7 | Native/WebSocket bridge (original "Plan B") | Web Bluetooth confirmed sufficient for both devices (H5/H6/H12); a bridge adds install friction and kills the browser-only value prop | Future Click firmware mandates encrypted ZAP *and* Chrome can't bond |
| F8 | Implementing encrypted ZAP (ECDH/HKDF/AES-CCM) | Plaintext mode works on all current firmware; encrypted path has an unresolved counter-endianness question and no client needs it | A firmware update removes the plaintext fallback (would hit QZ/BikeControl too — watch their issue trackers) |

## C. Untested — INFERRED (high confidence, verify opportunistically)

| ID | Hypothesis | Basis | Verify via |
|---|---|---|---|
| H7 | F1 failed *because of the message family*, not because the trainer refuses third-party Zwift-protocol control | QZ drives trainers natively with the hub recipe | HW-V9 |
| H8 | The QZ hub recipe (handshake `RideOn 02 01` → init → 0.4 % incline → `ratio×10000 ×(42/14)` + `00 08 88 04`) will move resistance on our KICKR Core | Works in QZ across Zwift-certified trainers incl. KICKR Core users | HW-V9 (try with and without the 42/14 normalization) |
| H9 | Zwift sends 0x11 at ~1 Hz / on-change; ≤1 Hz steady-state is a safe design rate | Packet observations (ftmsemu), community consensus; no primary measured interval | HW-V10 |
| H10 | Felt shift latency on the FTMS path will be ~1–1.5 s on the KICKR Core | simcline measured on comparable hardware | **ANSWERED 2026-07-28**: ACK 2-5ms (protocol-level, near-instant); felt power transition to new steady-state takes several seconds to fully settle, roughly consistent with ~1-1.5s for the *initial* response. `experiments/06-hw-v7-v8-mass-regression.md` |
| H11 | Our Click's variant can be detected from the first ASYNC frame type (0x37 vs 0x23) | BikeControl web build does exactly this | HW-V4/V5 |

## D. Untested — UNKNOWN (must be measured; blocking design parameters)

| ID | Unknown | Why it matters | Experiment |
|---|---|---|---|
| U1 | ~~KICKR Core firmware version on hand (≥ 1.3.17?)~~ **ANSWERED 2026-07-28**: `KICKR CORE C26B`, fw **1.5.36** | Gates Plan A′ entirely — **gate is open** | HW-V1 (`experiments/02-firmware-model-check.md`) |
| U2 | Click generation (v1 vs v2) + firmware; which service UUID it advertises (19ca vs FC82). **Partially answered**: fw **1.2** confirmed for **two** physical units ("Zwift Click Left", "Zwift Click Right") — generation/service-UUID still open, and now needs checking for both units | Parser + connect flow; v2 has the 60 s vendor-unlock disconnect | HW-V2/V3 (run against both units) |
| U3 | ~~Trainer's internal rider-mass assumption `m_t`~~ **ANSWERED 2026-07-28**: `m_t` = 93.3kg regressed (R²=0.9999, fixed-gear/constant-cadence protocol) vs actual 92kg — within 1.4%, BUT corrected same session: the Wahoo app's rider-weight profile is 81kg, matching neither figure, and FTMS has no channel to convey personalized mass (L9) — so 93.3kg is a **fixed trainer-side default**, not a reading of any profile. Coincidentally close for this rider; would not be for a rider of meaningfully different mass. Trim factor (R3) is a required calibration, not optional | `experiments/06-hw-v7-v8-mass-regression.md` |
| U4 | ~~KICKR behavior under rapid/unserialized 0x11 writes~~ **PARTIALLY ANSWERED**: untestable as originally scoped — Chrome's own client blocks concurrent same-characteristic writes before they reach the trainer (H20). The queue still needs to handle the resulting `NetworkError` gracefully | Sizes the command queue + retry policy | `experiments/05-ftms-conformance-hw-v10.md` |
| U5 | Whether dual BLE connections degrade IBD notification cadence on macOS/Android Chrome | Could affect the speed/cadence inputs to the drivetrain model | HW-V7/V11 |
| U6 | ~~Whether the 42/14 normalization in QZ's hub gear command is Hub-specific or universal~~ **RESOLVED 2026-07-28 (source, not hardware)**: it's QZ's own generic default-gearing constant, cross-feature-reused, not Hub-specific — see H21 / PROTOCOLS.md §2.4. Whether our KICKR specifically *requires* this exact normalization to interpret gear commands correctly is still HW-V9's job | Correct ratio encoding for Plan A′ | HW-V9 (hardware confirmation only; code-level question closed) |
| U7 | ~~Whether hub-protocol control and FTMS control can coexist on the KICKR (QZ suppresses FTMS while native-shifting)~~ **RESOLVED 2026-07-28 (source, not hardware)**: QZ's own client-side implementation makes them strictly mutually exclusive via one flag pair — see H22 / PROTOCOLS.md §2.3. Plan A′ should be built as a mode switch. Whether the KICKR's *firmware* itself would also reject/ignore concurrent hub+FTMS traffic if a client tried it anyway remains untested | Plan A′ integration shape (mode switch vs parallel) — **now settled: mode switch** | HW-V9 (only for firmware-level curiosity, not blocking) |
| U8 | ERG↔SIM interleave behavior on the KICKR (spec says last-write-wins, "should"-level) | Step-transition robustness in hybrid workouts | **PARTIALLY ANSWERED**: 0x05→0x11→0x05 all accepted with no conflicts (`experiments/05-ftms-conformance-hw-v10.md`); felt-resistance confirmation of "last wins" still needs a repeat with active pedaling |
| U9 | Whether the KICKR Core's **Wahoo proprietary control point** (A026-family characteristics; used by Berg0162/Kickr-Virtual-Shifting and QZ's `wahookickrsnapbike` wheel-circumference path) offers a usable third shifting path — never evaluated in this project, though the Feb-2026 scanner special-cased `a026` services (`zwift-virtual-shifting.html:938`) | A possible middle path: proprietary but simpler than the Zwift hub protocol | Optional side-quest during HW-V9; low priority — FTMS + Plan A′ likely dominate |
| U10 | Whether IBD **cadence** is always present in the KICKR's notifications (the drivetrain model needs it for `v_virt`) | If absent/flaky, fall back to deriving cadence from speed ÷ (r_phys × circumference) | **ANSWERED for single-connection case**: cadence field confirmed present throughout active pedaling (`experiments/06-hw-v7-v8-mass-regression.md`). Dual-connection (with Click) repeat still open |
| U11 | Exact trainer model on hand: "KICKR CORE" vs the 2025 "KICKR CORE 2" product (prototype notes say "Core V2", which is ambiguous) | Support lists and firmware lines differ per model | HW-V1 recorded fw 1.5.36 + BLE name "KICKR CORE C26B" (`experiments/02-firmware-model-check.md`) — **still doesn't resolve Core V2 vs CORE 2**; remains open, low priority |
| U12 | (New) Whether the trainer needs an accurate `PhysicalParam.RiderWeightX100`/`BikeWeightX100` in the hub protocol to compute correct native-mode resistance, or defaults to something if omitted — QZ's documented recipe (PROTOCOLS.md §2) doesn't clearly send weight, only `SimulationParam` + gear ratio | Affects whether Plan A′ needs a weight-sending step we haven't scoped yet | HW-V9 (trial with deliberately-wrong weight) |
| U13 | ~~Whether the two Click units have some left/right-specific behavior~~ **ANSWERED**: they're a relay pair (H17) — one unit's BLE connection carries both controllers' button events | Scopes the input adapter's connection model | `experiments/04-click-mapping-and-relay-confirmed.md` |
| U14 | (New, 2026-07-28) QZ's hub handshake sends a command with code `0x41` (`init1 = 41 08 05`, `ftmsbike.cpp:203-243`) that does not correspond to any command code in the full `Zwift hub.proto` file (`0x00/0x03/0x04/0x07/0x12/0x19/0x23/0x37/0x3c`) | Unknown whether this write is required for the KICKR to accept the subsequent gear commands, or is a no-op/vestige; affects whether Plan A′'s handshake can be simplified or must replicate it exactly | HW-V9 (try the recipe with and without `init1`) |
| U16 | (New, 2026-07-28) `VIRTUAL_SHIFTING_DESIGN.md` §4.3's baseline-identity property (`r_gear=r_phys` ⇒ `G_send=G` exactly) requires knowing the rider's actual current physical gear ratio — the design's example default (Zwift table gear 12, ratio 2.40) is just an illustrative starting point, not a measured value, and this session found it does NOT match the test rider's actual trainer gear (back-solved from measured speed/cadence: real `r_phys≈1.85`, closest table entry 1.86). Using the wrong assumed `r_phys` breaks the baseline-identity property and inflates candidate (b)'s computed target power dramatically (≈355W vs a corrected ≈218W) purely via the aero term on an over-large virtual speed | Confirms the drivetrain implementation must derive `r_phys` from an initial calibration/measurement step (e.g. from IBD speed+cadence at a stable moment), not assume any fixed default — a real implementation requirement, not just a bench-test artifact | Will be implicitly re-verified when HW-V12 candidate (b) is actually run next session using the corrected `r_phys≈1.85`; `experiments/08-hw-v12-bakeoff-partial.md` |
| U15 | (New, 2026-07-28) The prior-session attribution of the Wahoo-proprietary wheel-circumference-per-shift technique to `Berg0162/Kickr-Virtual-Shifting` — a direct code read this session found that repo instead uses a gradient-multiplier forwarded via standard FTMS SIM params/CPS resistance, with no reference to a Wahoo proprietary control point in the files checked | Whether this is a genuine correction (the repo never did this) or an incomplete read (a Wahoo-specific file exists but wasn't checked) | A targeted follow-up read of that repo's full file tree, if this path is ever pursued for real |

## E. Result log

> Append entries as experiments run. Format:
> `YYYY-MM-DD · HW-Vn · result · raw evidence (log file / screenshot / hex dump)`

- 2026-07-28 · HW-V0 · PASS — dual connection (trainer + Click) stable ~76s, zero drops,
  continuous notify traffic from both · `experiments/01-dual-connection-smoke-test.md`
- 2026-07-28 · HW-V1 · ANSWERED — trainer `KICKR CORE C26B` fw 1.5.36 (Plan A′ gate open);
  Click fw 1.2 × 2 units (Left/Right) · `experiments/02-firmware-model-check.md`
- 2026-07-28 · HW-V5 (partial, paused) · Right "+"=`0x20`, v2 frame grammar confirmed,
  disconnect cadence unresolved · `experiments/03-click-buttons-partial.md`
- 2026-07-28 · HW-V5 (completed) + relay architecture · Full mapping confirmed (Right
  "+"=`0x20`, Left "−"=`0x100`, D-pad matches community table); Left/Right relay through
  ONE BLE connection — major adapter simplification ·
  `experiments/04-click-mapping-and-relay-confirmed.md`
- 2026-07-28 · HW-V10 · ANSWERED, self-corrected — Chrome blocks concurrent same-
  characteristic writes client-side; KICKR's ATT response to post-Reset command was
  Success (confirmed); the "genuine resistance change" claim was overreach from one
  trial, demoted to base validation BV1 · `experiments/05-ftms-conformance-hw-v10.md`
- 2026-07-28 · HW-V7+HW-V8 · ANSWERED — fixed-gear/constant-cadence protocol (developed
  this session), power-vs-grade R²=0.9999, trainer mass 93.3kg vs actual 92kg (1.4%
  off); ACK latency 2-5ms · `experiments/06-hw-v7-v8-mass-regression.md`
- 2026-07-28 · (correction, same day) · User checked the Wahoo app: rider-weight profile
  is 81kg, matching neither 93.3kg nor 92kg — confirms 93.3kg is a fixed trainer-side
  default (FTMS has no channel for personalized mass, L9), not a coincidental match to a
  configured profile. Trim factor (R3) reclassified as a required calibration step for
  the general rider population, not an optional nicety
- 2026-07-28 · Ground-truth cross-check (user-provided outdoor ride chart, not a live BLE
  experiment) · Real 6% grade (freely geared) = 238W vs HW-V8's fixed-gear trainer test
  at 6% = 353.8W — 49% higher, strong support that the "6% felt like 15%" report was a
  fixed-gear-protocol artifact, not a physics/constant error. Outdoor power saturates
  ~250-266W from 8% grade onward, independently corroborating the rider's self-reported
  ~250W sustained-effort ceiling from HW-V8 · `experiments/07-outdoor-ride-power-grade-
  comparison.md`
- 2026-07-28 · HW-V12 (partial — candidate (a) only, session ended early) · Feature-gate
  check confirmed candidate (e) viable (`resistanceTargetSupported=true`). Candidate (a)
  grade-offset additive scored 17/20: 2% baseline harder=175.3W/easier=135.1W (40.2W
  gap), 0% baseline harder=85.4W/easier=58.9W (26.5W gap, no dead zone). One measurement
  window discarded and retaken after a real mid-test pedaling interruption (cadence
  dropped to ~1rpm, confirmed as a real event, not a resistance artifact). Found the
  design's default baseline gear ratio (2.40) doesn't match this rider's actual trainer
  gear (real ≈1.85, see U16) — corrected grades for candidate (b) pre-computed for next
  session · `experiments/08-hw-v12-bakeoff-partial.md`
- 2026-07-28 · QZ deep-dive (research only, no hardware) · Resolved U6/U7 from source
  (H21/H22); found and decoded the full hub-protocol handshake byte-for-byte, corrected
  the "gearApply" bytes to `HubRequest{DataId=520}` (§F is unrelated — see PROTOCOLS.md
  §2.2.1); proved the small-angle approximation's error is negligible (H23); cross-
  validated against 3 other open-source repos (H24); mined 7 GitHub issues for shift-feel
  evidence (RESEARCH.md Track 2); found a 5th+ resistance strategy (Wahoo wheel-
  circumference rewrite) and a dozen+ device-specific gear-scaling conventions, several
  disagreeing with each other (RESEARCH.md Track 2) · this session, no experiment file
  (pure source/literature research — see PROTOCOLS.md §2, RESEARCH.md Track 2, §F below)
- 2026-07-28 · Outdoor per-second stream physics tooling — built, run twice, real numbers ·
  Built an intervals.icu Custom Activity Chart script
  (`experiments/intervals-icu-power-model-chart.js`) implementing three fits against real
  per-second outdoor streams — a repeat of the session's earlier failed 3-parameter
  regression (now on real per-second data), a flat-segment (|grade|<0.5%) aero sweep, and
  an approximate Chung virtual-elevation grid search that solves slope per-sample from
  power/speed/acceleration instead of regressing power against grade — the structural fix
  for the grade/speed collinearity problem. Field names verified against intervals.icu's
  own generated TypeScript model (`github.com/intervals-icu/js-data-model`), not assumed.
  **Ride #1** (755 samples): corr(grade,speed)=-0.755, naive/flat-sweep degenerate,
  Chung/VE gave mass=98.2kg/Crr=0.014/Cw=0.200, whole-ride R² fitted=-2.78/trainer=-1.97.
  **Ride #2** (802 samples): corr(grade,speed)=-0.832, naive/flat-sweep again degenerate,
  Chung/VE gave mass=98.0kg/Crr=0.009/Cw=0.350, whole-ride R² fitted=-1.70/trainer=-1.20.
  **Cross-ride signal**: Method C's mass converged closely (98.2 vs 98.0kg) across two
  independent rides; Crr/Cw did not (0.014/0.200 vs 0.009/0.350) — n=2 too small to say
  whether that's real variation or an under-constrained fit. Both rides' whole-ride R² were
  strongly negative for both models; ride #2's residual-vs-grade plot showed this
  concentrates almost entirely below 0% grade (coasting, up to ±700W residual) and tightens
  sharply above ~2-3% (climbing) — the steady-state formula has no coasting term, so
  descent residuals dominate a whole-ride R² that was never the right number for judging
  climbing/gear-shifting relevance (DESIGN §4.9) · `experiments/09-outdoor-stream-physics-
  regression.md`
- 2026-07-28 · Same-session follow-up — climb-only breakout added, a real methodology bug
  found and fixed · Added a `grade>2%`-filtered R²/mean-absolute-residual/residual-std-dev
  breakout (DESIGN §4.9's actual validation question) to the existing script — **not yet
  run**, no climb-only numbers exist yet. Separately, diagnosed why ride #1 and ride #2 both
  showed Method C's mass-refinement step finding zero improvement (VE-RMSE unchanged
  before/after): not a grid-boundary cap (ruled out — both rides' result landed exactly at
  the unmoved seed mass, not at either edge of the ±20kg search window) but a real
  methodological bias in the since-removed second grid round — Crr/Cw were fit specifically
  to minimize error *at* the seed mass, so re-testing other masses with those same,
  mass-specific-fit Crr/Cw values was structurally biased toward finding the seed still
  best, independent of where the true joint optimum sits. Fixed by restoring the two-round
  coordinate descent (grid → mass-refine → grid again) that an earlier memory-limit fix had
  collapsed to one round; affordable now since the other memory-limit cuts already reduced
  total grid-search cost ~25-30x. Also added an explicit `massScanAtBoundary` flag so a
  genuine boundary-capping case (a different, real failure mode) self-reports on any future
  chart rather than needing this same manual investigation each time. **Fix not yet
  re-verified against real data** · `experiments/09-outdoor-stream-physics-regression.md`
- 2026-07-28 · **First real multi-ride result, 3 rides — DESIGN §4.9's validation question
  answered, currently negative** · Built a second intervals.icu script,
  `intervals-icu-calibration-field.js` (a "Computed Activity Field," type Text — chosen
  because the chart's calibrationJson lives in SVG title text, which turned out not to be
  reliably copy-pasteable in a browser). Hit its own `Memory limit exceeded` despite
  sharing the chart's already-fixed downsampling — cut its grid/sample budget much harder
  (`MAX_FIT_SAMPLES` 800→300, grid 165→36 combos), on the working theory that Computed
  Fields run in a tighter/bulk-evaluation sandbox than on-demand charts. User then ran it
  against 3 real rides: mass=97.0/97.2/113.2kg, Crr=0.011/0.016/0.0085, **Cw=0.30 on all
  three, identically** — a red flag for the coarsened grid being unable to resolve Cw
  rather than genuine convergence. Ride 3's mass hit the mass-scan boundary exactly
  (`massScanAtBoundary: true`, value = seed+20kg), meaning its whole fit (mass **and**
  the round-2 Crr/Cw refit at that capped mass) is suspect. **Headline finding**: on
  every one of the 3 rides, the HW-V8 trainer's fixed constants (93.3kg/0.004/0.51) beat
  the rider's own outdoor-fitted model on climb-only (`grade>2%`) R² **and** MAE — by
  6-33W MAE, worsening ride to ride. This directly answers this project's core
  personalization question, and the honest current answer is **not yet validated** —
  the opposite of hoped-for. Leading suspect: Method C fits by minimizing an
  acceleration-inclusive VE-RMSE objective, but both models are *evaluated* here with
  the acceleration-free steady-state formula — a real mismatch between what was
  optimized and what's measured, not yet disentangled from "the model doesn't work" ·
  `experiments/09-outdoor-stream-physics-regression.md`
- 2026-07-28 · **Offline full-precision re-fit, 3 real FIT files — both open confounds
  from the sandboxed session substantially disentangled, headline result unchanged
  (still negative)** · Built `offline_fit_physics_analysis.py` (fitparse/numpy/scipy,
  no downsampling, Method C as a continuous joint scipy.optimize over mass/Crr/Cw instead
  of a discrete grid) and ran it against 3 real Garmin FIT files. Only 1 of 3 matched a
  previously-logged sandboxed ride by timestamp (2026-07-13 = Ride A; the other two FIT
  files are new rides not previously fit, from 2026-07-07 and 2026-07-05). **Cw did not
  converge once the grid was removed — it moved to a wider spread (0.050-0.436) than the
  coarse grid's suspicious identical-0.30, and 2 of 3 rides' mass optimum hit the search's
  150kg physical upper bound.** Verified this is a genuine unconstrained optimum (RMSE
  keeps improving well past 150kg via a profile-likelihood scan), not a narrow-window
  artifact like the sandboxed session's ±20kg mass-scan radius. Root cause traced
  analytically: as mass→∞ in the Chung solve, `sinθ → −Crr − a/g`, independent of power —
  the fit degenerates into using measured acceleration (which correlates with real slope)
  as a substitute for power at implausible masses. All 3 rides pass a simple
  elevation-closure check, so route non-closure alone doesn't explain this either.
  **Climb-only breakout, all 4 combinations (steady-state × acceleration-inclusive, for
  both fitted and trainer models)**: the HW-V8 trainer constants beat the fitted model on
  **every ride, under both formulas** — directly refuting the fit-objective/evaluation-
  metric-mismatch hypothesis as a sufficient explanation on its own (the accel-inclusive
  evaluation, matching what Method C actually optimizes, still loses). One ride (2026-07-
  13, the one with a genuine interior-optimum fit) showed real, substantial improvement
  from full precision alone (climb MAE 99.8W→65.9W, R² −0.945→−0.311 vs its sandboxed
  coarse-grid result) — but the trainer model still wins outright on that ride too (53.5W
  MAE, R²=+0.076, the only positive climb R² in the whole analysis). **Headline verdict
  unchanged from experiments/09: personalized calibration does not yet beat the HW-V8
  trainer defaults on climb-only accuracy** — but the reason is now much better
  understood (single-ride Chung-method non-identifiability, not grid coarseness or a
  metric mismatch), pointing at concrete next steps (hold mass fixed from an
  independently-known value; fit multiple rides jointly) rather than "try again with a
  finer grid" · `experiments/10-offline-fit-physics-analysis.md`
- 2026-07-28 · **Same-day correction to the above** — a coarse-grid companion run the
  user supplied afterward confirmed all 3 FIT files (not just the one matching Ride A)
  are the same rides as a fresh `intervals-icu-calibration-field.js` pass, timestamps
  matching to the second via a consistent +1h offset. This gives a genuine paired
  coarse-vs-continuous comparison on all 3 rides. Headline verdict unchanged (trainer
  still wins on every ride), but with a new nuance: the coarse grid's narrow,
  seed-centered mass window produced more physically plausible masses on all 3 rides
  (93-101kg) than the continuous optimizer's wider bound (2 of 3 hit 150kg) — and on the
  ride with the widest divergence (2026-07-05), the continuous fit's *lower* VE-RMSE
  corresponded to a *worse* climb-power prediction (66W trainer-gap vs. the coarse fit's
  3.4W gap). Minimizing the fitting objective more precisely is not the same as producing
  a better predictive model here — a caution for any future personalization method ·
  `experiments/10-offline-fit-physics-analysis.md`
- 2026-07-28 · **Same-day follow-up — fixed-mass refit using the user's real known
  weight (89kg rider + 8kg bike = 97kg), MAJOR result** · The user supplied their
  actual mass (not previously available -- the 97kg seed used earlier was only an
  optimizer starting point, still free to wander, which is why it drifted to 150kg on
  2 of 3 rides). Added a `--fixed-mass` flag to `offline_fit_physics_analysis.py` that
  locks mass and fits only Crr/Cw. Result: **the mass-boundary degeneracy vanished on
  all 3 rides by construction, Crr converged to a tight, physically sensible range
  (0.0152-0.0200, mean 0.0171 -- consistent with real road tires having higher rolling
  resistance than a smooth trainer flywheel), and the climb-only MAE gap to the HW-V8
  trainer constants collapsed from 12-66W down to under 7W on every ride** -- with the
  fitted model **winning outright on one ride** (2026-07-07: 40.9W vs 47.3W MAE, R²
  +0.004 vs -0.160). Cw did **not** converge (still 0.050-0.259) -- consistent with the
  root-cause analysis, since the degenerate direction was specifically in the mass
  dimension, not Cw. **This substantially upgrades the outlook for DESIGN §4.9's
  personalization question** from "currently negative" to "roughly competitive with
  defaults once mass is supplied independently, not clear-cut either way yet" ·
  `experiments/10-offline-fit-physics-analysis.md`

- 2026-07-28 · **Same-day follow-up — today's physics learnings wired into the real
  app (not just the ble-lab.html debug page), plus 2 real bug fixes** · Added a
  "Rider & Bike Physics" settings panel to `VirtualGearSettings.tsx` (rider/bike
  weight, tire-type→Crr preset, riding-position→Cw preset — new
  `src/services/riderPhysics.ts`, persisted via `storage.ts`), and wired the app's 3
  hardcoded SIM-mode call sites in `main.js` (previously `crr=0.003, cw=0.45`,
  arbitrary and never calibrated) to read from it instead. Default preset resolves to
  **Zwift's own real pinned constants (Crr=0.004, CWa=0.51)** — resolved a real
  discrepancy in this project's own docs in the process: `RISKS-ROADMAP.md` open
  question #7 had cited the wrong Zwift figures (0.0051/0.41); confirmed via
  `PROTOCOLS.md` §2.0's byte-level `.proto`-file self-check that 0.004/0.51 is
  correct, and corrected that doc. Also fixed two confirmed latent bugs while in this
  code: (1) `ftms.js`'s wind-speed encoding used 0.01 m/s resolution, should be 0.001
  per the FTMS spec (matches this project's own already-correct debug-harness parser);
  (2) `initVirtualGearingSettings()` was unconditionally calling `virtualGear.setFTP()`
  on every boot, which silently discarded the bench-measured `CALIBRATION_V1` curve
  for a generic FTP-based approximation every single app load — removed the boot-time
  call, kept the explicit Apply-button one. `r_phys=2.4286` (34T front / Zwift Cog's
  confirmed 14T) is documented (`RISKS-ROADMAP.md` open question #4, now resolved) but
  not wired into any calculation yet — no consumer exists until the drivetrain model
  (§4.3) is built · this session, no new experiment file (application code + doc
  corrections, not a hardware experiment)

## F. Small-angle approximation analysis (2026-07-28 deep dive)

**Question**: `VIRTUAL_SHIFTING_DESIGN.md` §4.3 solves the inverse problem — given a
target power `P_target` and measured flywheel speed `v_fly`, find the grade `θ'` to send
the trainer so its own (assumed exact-trig) physics model demands `P_target`:
```
sin θ' ≈ (P_target / v_fly − Cw·v_fly² − m_t·g·Crr) / (m_t·g)      // small-angle, cos θ'≈1
G_send = 100 × tan(asin(clamp(sin θ', −0.35, 0.35)))
```
QZ's `bike.cpp::computeSlopeTargetPower()` (a *forward* calculation: grade→power) uses
**exact** trig (`sinTheta = slope/sqrt(1+slope²)`, `cosTheta = 1/sqrt(1+slope²)`, no
small-angle shortcut) — raising the question of whether our own *inverse* solve should
drop its small-angle assumption too.

**Derivation (CONFIRMED by direct algebra, not simulation)**: the exact forward equation
is `P(θ) = m·g·v·sinθ + m·g·v·Crr·cosθ + Cw·v³`. Suppose `P_target` is generated by
plugging some "true" angle `θ_true` into this exact equation, then fed back through the
design's approximate inverse (which substitutes `cos θ'≈1` only in the `Crr` term, then
solves the rest — `sinθ'`, and the final `tan(asin(·))` step — exactly). Substituting and
simplifying, **all mass/speed/Cw terms cancel**:
```
sin θ' = sin θ_true − Crr · (1 − cos θ_true)
```
The approximation's entire induced error is this one term, and it is suppressed twice:
once by `Crr` (~0.004, already a small coefficient), and again by `(1−cosθ)`, which is
itself second-order-small in `θ`. Numerically (`Crr = 0.004`, matching Zwift's own hub
constant):

| Grade | `sin θ_true` | `sin θ'` (approx) | `G_send` sent | Error (pp) | Error (relative) |
|---|---|---|---|---|---|
| 6% | 0.059892 | 0.059885 | 5.99928% | −0.00072 | −0.012% |
| 10% | 0.099504 | 0.099484 | 9.99799% | −0.00201 | −0.020% |
| 15% | 0.148340 | 0.148296 | 14.99542% | −0.00458 | −0.031% |
| 20% | 0.196116 | 0.196038 | 19.99176% | −0.00824 | −0.041% |

**For context**: the FTMS 0x11 grade field itself only has **0.01 percentage-point**
resolution (sint16 @ 0.01%, PROTOCOLS.md §3.2) — at every grade tested, the small-angle
approximation's error is at or below the wire protocol's own quantization noise floor. It
is not a meaningfully "small-angle" approximation in the sense of introducing risk; it's
provably negligible at any grade this design will plausibly clamp to (±35%, §4.3).

**Recommendation (explicit, feeds the design decision)**: **keep the current formula as
implemented** — do not spend implementation effort replacing it with QZ-style exact trig
or a fully-exact closed-form inverse solve (one exists too, via the harmonic-addition
identity `A sinθ + B cosθ = R sin(θ+φ)`, `R = A√(1+Crr²)`, `φ = atan(Crr)` — since `Crr` is
tiny, `φ ≈ 0.23°` and `R ≈ A×1.000008`, i.e. even the "fully exact" version is
indistinguishable from the current one in practice). The code comment `// small-angle,
cos θ'≈1` should be updated to note the error is quantified as negligible (cite this
section), so a future reader doesn't mistake it for an open risk.

**On the rider's HW-V8 report that 6% "felt like a real 15% climb"**: this analysis rules
out the small-angle approximation as the explanation — the induced grade error at 6% is
~0.0007 percentage points, physically imperceptible. The far more likely explanation,
consistent with `experiments/06-hw-v7-v8-mass-regression.md`'s own numbers: that test held
a **single fixed gear** for the entire sweep (by design, to avoid confounding the mass
regression) and hit **353.8 W at 6%** — for a rider with FTP ≈ 220 W (GOALS.md), that's
**~161% of FTP**, a genuinely hard effort by any measure. A real 6% climb ridden with the
freedom to shift to an easier gear would not demand anywhere near that power at the same
cadence/speed. **The "felt like 15%" report is very likely an artifact of the fixed-gear
test protocol removing the rider's normal recourse (shifting down), not evidence of a
physics-model or approximation error.** This should be read as a methodology note for
future fixed-gear power tests (HW-V12 in particular already flags the rider's ~250W
sustained-effort ceiling for exactly this reason), not as a data point against the
small-angle formula.
