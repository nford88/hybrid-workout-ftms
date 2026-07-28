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
| H10 | Felt shift latency on the FTMS path will be ~1–1.5 s on the KICKR Core | simcline measured on comparable hardware | HW-V7 |
| H11 | Our Click's variant can be detected from the first ASYNC frame type (0x37 vs 0x23) | BikeControl web build does exactly this | HW-V4/V5 |

## D. Untested — UNKNOWN (must be measured; blocking design parameters)

| ID | Unknown | Why it matters | Experiment |
|---|---|---|---|
| U1 | ~~KICKR Core firmware version on hand (≥ 1.3.17?)~~ **ANSWERED 2026-07-28**: `KICKR CORE C26B`, fw **1.5.36** | Gates Plan A′ entirely — **gate is open** | HW-V1 (`experiments/02-firmware-model-check.md`) |
| U2 | Click generation (v1 vs v2) + firmware; which service UUID it advertises (19ca vs FC82). **Partially answered**: fw **1.2** confirmed for **two** physical units ("Zwift Click Left", "Zwift Click Right") — generation/service-UUID still open, and now needs checking for both units | Parser + connect flow; v2 has the 60 s vendor-unlock disconnect | HW-V2/V3 (run against both units) |
| U3 | **Trainer's internal rider-mass assumption `m_t`** | The virtual-speed grade-solve scales with it; the single riskiest parameter in the design. User's framing (2026-07-28): in-game, higher W/kg → more virtual distance for the same power — consistent with `F_road` scaling with mass in our own model (DESIGN §4.3); doesn't change what needs measuring, just confirms *why* it matters | HW-V8 |
| U4 | ~~KICKR behavior under rapid/unserialized 0x11 writes~~ **PARTIALLY ANSWERED**: untestable as originally scoped — Chrome's own client blocks concurrent same-characteristic writes before they reach the trainer (H20). The queue still needs to handle the resulting `NetworkError` gracefully | Sizes the command queue + retry policy | `experiments/05-ftms-conformance-hw-v10.md` |
| U5 | Whether dual BLE connections degrade IBD notification cadence on macOS/Android Chrome | Could affect the speed/cadence inputs to the drivetrain model | HW-V7/V11 |
| U6 | Whether the 42/14 normalization in QZ's hub gear command is Hub-specific or universal | Correct ratio encoding for Plan A′ | HW-V9 |
| U7 | Whether hub-protocol control and FTMS control can coexist on the KICKR (QZ suppresses FTMS while native-shifting) | Plan A′ integration shape (mode switch vs parallel) | HW-V9 + HW-V10 |
| U8 | ERG↔SIM interleave behavior on the KICKR (spec says last-write-wins, "should"-level) | Step-transition robustness in hybrid workouts | **PARTIALLY ANSWERED**: 0x05→0x11→0x05 all accepted with no conflicts (`experiments/05-ftms-conformance-hw-v10.md`); felt-resistance confirmation of "last wins" still needs a repeat with active pedaling |
| U9 | Whether the KICKR Core's **Wahoo proprietary control point** (A026-family characteristics; used by Berg0162/Kickr-Virtual-Shifting and QZ's `wahookickrsnapbike` wheel-circumference path) offers a usable third shifting path — never evaluated in this project, though the Feb-2026 scanner special-cased `a026` services (`zwift-virtual-shifting.html:938`) | A possible middle path: proprietary but simpler than the Zwift hub protocol | Optional side-quest during HW-V9; low priority — FTMS + Plan A′ likely dominate |
| U10 | Whether IBD **cadence** is always present in the KICKR's notifications (the drivetrain model needs it for `v_virt`) | If absent/flaky, fall back to deriving cadence from speed ÷ (r_phys × circumference) | HW-V7 (log IBD flag bits) |
| U11 | Exact trainer model on hand: "KICKR CORE" vs the 2025 "KICKR CORE 2" product (prototype notes say "Core V2", which is ambiguous) | Support lists and firmware lines differ per model | HW-V1 recorded fw 1.5.36 + BLE name "KICKR CORE C26B" (`experiments/02-firmware-model-check.md`) — **still doesn't resolve Core V2 vs CORE 2**; remains open, low priority |
| U12 | (New) Whether the trainer needs an accurate `PhysicalParam.RiderWeightX100`/`BikeWeightX100` in the hub protocol to compute correct native-mode resistance, or defaults to something if omitted — QZ's documented recipe (PROTOCOLS.md §2) doesn't clearly send weight, only `SimulationParam` + gear ratio | Affects whether Plan A′ needs a weight-sending step we haven't scoped yet | HW-V9 (trial with deliberately-wrong weight) |
| U13 | ~~Whether the two Click units have some left/right-specific behavior~~ **ANSWERED**: they're a relay pair (H17) — one unit's BLE connection carries both controllers' button events | Scopes the input adapter's connection model | `experiments/04-click-mapping-and-relay-confirmed.md` |

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
- 2026-07-28 · HW-V10 · ANSWERED — Chrome blocks concurrent same-characteristic writes
  client-side (trainer's own ATT conflict handling untested); KICKR does NOT revoke
  control on Reset (spec deviation, confirmed by ATT code + real power-trace change) ·
  `experiments/05-ftms-conformance-hw-v10.md`
