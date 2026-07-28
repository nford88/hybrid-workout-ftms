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
| H12 | One Chrome page can hold trainer + controller GATT connections simultaneously | ✅ TRUE (in general) | Web Bluetooth spec #195; Auuki in production. Our specific pairing: HW-V7 |
| H13 | FTMS control permission persists after one Request Control (per-command 0x00 unnecessary) | ✅ TRUE (spec) | FTMS v1.0 §4.16.2.1 — behavioral check on KICKR folded into HW-V7/V10 |

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
| U1 | KICKR Core firmware version on hand (≥ 1.3.17?) | Gates Plan A′ entirely | HW-V1 |
| U2 | Click generation (v1 vs v2) + firmware; which service UUID it advertises (19ca vs FC82) | Parser + connect flow; v2 has the 60 s vendor-unlock disconnect | HW-V2/V3 |
| U3 | **Trainer's internal rider-mass assumption `m_t`** | The virtual-speed grade-solve scales with it; the single riskiest parameter in the design | HW-V8 |
| U4 | KICKR behavior under rapid/unserialized 0x11 writes (ATT Procedure-in-Progress? silent drops?) | Sizes the command queue + retry policy | HW-V10 |
| U5 | Whether dual BLE connections degrade IBD notification cadence on macOS/Android Chrome | Could affect the speed/cadence inputs to the drivetrain model | HW-V7/V11 |
| U6 | Whether the 42/14 normalization in QZ's hub gear command is Hub-specific or universal | Correct ratio encoding for Plan A′ | HW-V9 |
| U7 | Whether hub-protocol control and FTMS control can coexist on the KICKR (QZ suppresses FTMS while native-shifting) | Plan A′ integration shape (mode switch vs parallel) | HW-V9 + HW-V10 |
| U8 | ERG↔SIM interleave behavior on the KICKR (spec says last-write-wins, "should"-level) | Step-transition robustness in hybrid workouts | HW-V10 |
| U9 | Whether the KICKR Core's **Wahoo proprietary control point** (A026-family characteristics; used by Berg0162/Kickr-Virtual-Shifting and QZ's `wahookickrsnapbike` wheel-circumference path) offers a usable third shifting path — never evaluated in this project, though the Feb-2026 scanner special-cased `a026` services (`zwift-virtual-shifting.html:938`) | A possible middle path: proprietary but simpler than the Zwift hub protocol | Optional side-quest during HW-V9; low priority — FTMS + Plan A′ likely dominate |
| U10 | Whether IBD **cadence** is always present in the KICKR's notifications (the drivetrain model needs it for `v_virt`) | If absent/flaky, fall back to deriving cadence from speed ÷ (r_phys × circumference) | HW-V7 (log IBD flag bits) |
| U11 | Exact trainer model on hand: "KICKR CORE" vs the 2025 "KICKR CORE 2" product (prototype notes say "Core V2", which is ambiguous) | Support lists and firmware lines differ per model | HW-V1 (record model + hardware revision, not just firmware) |

## E. Result log

> Append entries as experiments run. Format:
> `YYYY-MM-DD · HW-Vn · result · raw evidence (log file / screenshot / hex dump)`

- _(empty — no hardware experiments run since 2026-02-19's F1/F2)_
