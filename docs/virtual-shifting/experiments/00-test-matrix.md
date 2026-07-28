# Test Matrix — Phase 0 Question Harvest

> Status: **LIVE** — updated as experiments answer, spawn, or invalidate questions.
> Harvested from every file under `docs/virtual-shifting/` + `docs/VIRTUAL_SHIFTING_DESIGN.md`
> on 2026-07-28. Nothing found in those files was dropped — see §4 PARKED for items that
> are out of scope for hardware testing, with reasons.
>
> IDs `HW-Vn` for n=1–11 already exist in `../VALIDATION-PLAN.md` and are referenced from
> `../HYPOTHESES.md` and `../../VIRTUAL_SHIFTING_DESIGN.md §2.6/§5` — **kept stable, not
> renumbered**. This session adds `HW-V0`, `HW-V12`, `HW-V13` and folds in mission-driven
> comparative work (esp. the shift-primitive bake-off, §3.2) that the prior design session
> didn't scope as hardware experiments.

---

## 1. Harvest — every open item found

| # | Item | Source | Kind |
|---|---|---|---|
| 1 | KICKR Core firmware ≥1.3.17? Exact model (Core V2 vs CORE 2)? | HYPOTHESES U1/U11, VALIDATION-PLAN HW-V1 | **ANSWERED 2026-07-28**: `KICKR CORE C26B`, fw **1.5.36** (≫1.3.17, Plan A′ gate open). Model-line disambiguation (Core V2 vs CORE 2) still open, low priority. See [experiments/02-firmware-model-check.md](02-firmware-model-check.md) |
| 2 | Click generation (v1/v2), firmware, advertised service UUID (19ca vs FC82) | HYPOTHESES U2, HW-V2/V3 | PARTIALLY ANSWERED: fw **1.2** confirmed for **two** Click units (Left + Right, see item 30). Generation (v1/v2 byte grammar) and advertised service UUID still need HW-V2/V3/V4 |
| 3 | Bare `RideOn` handshake works on our unit; reply bytes; variant confirmed | HYPOTHESES H11 (inferred), HW-V4 | INFERRED |
| 4 | Exact button-frame bytes + repeat/debounce behavior on our unit | HW-V5 | UNKNOWN (schema known from 3rd-party sources, our bytes not captured) |
| 5 | Click lifecycle: idle keepalive, power-off, v2 ~60s vendor-lock disconnect | HW-V6 | UNKNOWN |
| 6 | Two concurrent Web Bluetooth GATT connections from one page, on **our** hardware pairing | HYPOTHESES H12 (confirmed in general via Auuki), DESIGN §2.5/§7.1 | **ANSWERED — CONFIRMED 2026-07-28**, [experiments/01-dual-connection-smoke-test.md](01-dual-connection-smoke-test.md): both stayed connected ~76s with continuous notify traffic, no drops |
| 7 | FTMS command→resistance felt latency on the KICKR Core | HYPOTHESES H10, HW-V7 | **ANSWERED 2026-07-28**: ACK latency 2-5ms (well under 300ms budget); felt power transition takes several seconds to fully settle. See [experiments/06-hw-v7-v8-mass-regression.md](06-hw-v7-v8-mass-regression.md) |
| 8 | IBD notification cadence under dual connection; cadence field always present | HYPOTHESES U5/U10, HW-V7 | **PARTIALLY ANSWERED**: cadence field confirmed present throughout active pedaling (trainer-only, not dual-connection — that part still needs a repeat with the Click connected). See experiments/06 |
| 9 | Trainer's internal rider-mass assumption `m_t` | HYPOTHESES U3, HW-V8 — **riskiest single parameter in the design** | **ANSWERED 2026-07-28, high confidence**: fixed-gear/constant-cadence regression (R²=0.9999) gives `m_t`=93.3kg vs actual 92kg (89kg rider + 3kg bike) — within 1.4%. Substantially de-risks R3. See [experiments/06-hw-v7-v8-mass-regression.md](06-hw-v7-v8-mass-regression.md) |
| 10 | Whether QZ hub-protocol recipe (`RideOn 02 01` + init + incline + ratio×10000 + apply) moves resistance on our KICKR | HYPOTHESES H7/H8, HW-V9 | INFERRED (confirmed on other Zwift-certified trainers, not ours) |
| 11 | Whether the QZ ×(42/14) gear-command normalization is Hub-specific or universal | HYPOTHESES U6, HW-V9 | **RESOLVED 2026-07-28 from source (H21)**: neither — it's QZ's own generic default-gearing constant (`default_gear_crankset_size=42`/`default_gear_cog_size=14`, `qzsettings.h:2464-2468`), introduced for unrelated Wahoo custom-gearing support (PR #2682) and reused as a literal in the Hub gear formula (PR #2757). Repo-wide search confirms it appears nowhere else as a normalization pattern. See PROTOCOLS.md §2.4. HW-V9 still needed only to confirm the KICKR's firmware actually requires this exact scaling to interpret gear commands correctly — the code-level question is closed |
| 12 | Whether hub-protocol control and FTMS control coexist, or must be mutually exclusive, on the KICKR | HYPOTHESES U7, HW-V9+HW-V10 | **RESOLVED 2026-07-28 from source (H22)**: strictly mutually exclusive in QZ's own client — a single flag pair (`zwiftPlayService && gears_zwift_ratio`) gates one shared `writeCharacteristic()`; when both hold, FTMS writes return `false` before ever reaching `enqueueWrite` (`ftmsbike.cpp:86-105`, read in full). Confirms Plan A′ should be a mode switch, not parallel control, matching DESIGN §4.6′'s existing assumption. See PROTOCOLS.md §2.3. HW-V9 still open only for the (non-blocking) question of whether the KICKR's own firmware would tolerate concurrent traffic if a client ignored QZ's convention |
| 13 | KICKR behavior under rapid/unserialized 0x11 writes (ATT reject vs silent drop); ERG/SIM interleave | HYPOTHESES U4/U8, HW-V10 | **PARTIALLY ANSWERED 2026-07-28**: ERG↔SIM interleave (a) accepted no conflicts (felt-behavior unconfirmed, no pedaling in that window); concurrent-write (b) never reached the trainer — Chrome's own client blocks it first (`NetworkError: GATT operation already in progress`). See [experiments/05-ftms-conformance-hw-v10.md](05-ftms-conformance-hw-v10.md) |
| 14 | Zwift's ~1 Hz 0x11 send-rate assumption; safe design rate for our trainer | HYPOTHESES H9, HW-V10 | INFERRED (packet-capture consensus, not measured here) — HW-V10 didn't directly test send-rate ceiling, still open |
| 15 | Android Chrome parity for handshake + dual-connection latency | HW-V11 | UNTESTED |
| 16 | **Which FTMS mechanism should emulate a gear change**: grade offset (additive vs physics-solved) vs Crr manipulation vs Cw manipulation vs Target Resistance Level (0x04) vs hybrid | DESIGN §4.3 picked "virtual-speed grade-solve" **by reasoning, not bake-off**; mission Phase 3.4 explicitly demands a comparative hardware test of ALL candidates | **IN PROGRESS 2026-07-28**: candidate (a) grade-offset additive tested and scored 17/20 (no dead zone, works, but arbitrary/not speed-scaled step size) — see [experiments/08-hw-v12-bakeoff-partial.md](08-hw-v12-bakeoff-partial.md). Candidate (e) confirmed feature-gate viable. Candidate (b)'s grades pre-computed for next session (found the design's default baseline gear assumption doesn't match this rider's real gear — corrected). Candidates (c)/(d)/(f) not yet started. Session ended early (rider fatigue) — still the gap to close |
| 17 | Wahoo proprietary control point (`a026…` family) as a third shifting path — re-send wheel circumference per shift | PROTOCOLS §3.5, HYPOTHESES U9 | UNKNOWN, never evaluated, low priority |
| 18 | Should momentum assist (simPhysics.ts smoothing) apply before or after gear translation? | RISKS-ROADMAP open Q3 | Design question — needs *subjective feel* after the drivetrain model exists, not a standalone bench experiment |
| 19 | Buy a Zwift Cog to fix the physical baseline ratio? | RISKS-ROADMAP open Q4 | Non-technical / purchase decision |
| 20 | Should gear index persist across page reloads? | RISKS-ROADMAP open Q5 | Product decision, no hardware dependency |
| 21 | Baseline-identity gap: Zwift's 24-ratio table has no exact 2.0 (34/17 physical ratio); nearest is 2.04 (~2 % off) | RISKS-ROADMAP open Q6 | Data/design decision; empirical component (is 2% perceptible?) is a *feel* question for P4, not a bench experiment |
| 22 | Crr/Cw values must be shared between the grade-solve math and the FTMS 0x11 payload, or the solve is self-inconsistent | RISKS-ROADMAP open Q7 | Implementation-time constraint, not an unknown to test |
| 23 | Hold-to-repeat policy: shift once per press vs. auto-repeat through gears while held | RISKS-ROADMAP open Q8 | Depends on raw repeat-frame data from HW-V5 (hardware fact) + a product choice (not hardware-testable) |
| 24 | Default start gear — is Zwift's default really gear 12 (ratio 2.40)? | RISKS-ROADMAP open Q9 | Cosmetic; verifiable only via Zwift itself, not our hardware — low priority |
| 25 | R4 grade-clamp saturation risk (hard gear + steep grade + low flywheel speed) | DESIGN §6 Risks R4 | Consequence of the physics model; exercised naturally by HW-V8/HW-V12 grade sweeps, not a separate experiment |
| 26 | R6 Chrome permission persistence still flag-gated (`getDevices()`) | DESIGN §2.5, RISKS-ROADMAP R6 | Confirmed constraint from CG implementation-status doc; nothing to test locally — accepted design constraint |
| 27 | R7 legacy/React state accretion risk | RISKS-ROADMAP R7 | Code-review concern, not a hardware unknown |
| 28 | R8 Android screen-lock kills BLE | RISKS-ROADMAP R8 | Pre-existing, documented constraint; folded into HW-V11 note only |
| 29 | **New (HW-V0 finding)**: the trainer's Zwift-service ASYNC characteristic (`00000002-19ca-…`) emits unsolicited, human-readable debug-log text (e.g. `"gap_params_change(0): 72, 72, 0, 600"`, `"ATX 01, STX 01"`) with no handshake performed — distinct from the Zwift Riding-Data protocol (msg `0x03`) and from any HubCommand response | [experiments/01-dual-connection-smoke-test.md](01-dual-connection-smoke-test.md) obs. 3 | UNKNOWN (what else this channel logs; whether it interferes with or gets confused for HW-V9 traffic) — no dedicated experiment needed, but **HW-V9 must keep logging this characteristic and distinguish it from genuine protocol traffic** |
| 30 | **New (HW-V1 finding)**: the user owns **two** Click controllers ("Zwift Click Left"/"Zwift Click Right", both fw 1.2), not the single unit GOALS.md's hardware inventory assumed | [experiments/02-firmware-model-check.md](02-firmware-model-check.md) obs. 3 | **RESOLVED 2026-07-28**, superseding the earlier "decide later" framing: item 32's relay confirmation means this was never actually a dual-connection question — connecting **either** unit gets both controllers' buttons over one connection. Mapping: Right "+" = shift up, Left "−" = shift down (arbitrary choice, easily reconfigurable) |
| 32 | "One controller connects to the other controller, which then emits a single BLE connection to the machine" | **CONFIRMED 2026-07-28**, [experiments/04-click-mapping-and-relay-confirmed.md](04-click-mapping-and-relay-confirmed.md): Left-controller button presses (D-pad + "−") arrived on the exact same, already-open BLE connection that had just produced Right-controller presses — no new `connected`/`gattserverdisconnected` event pair in between | **Major design simplification**: the production Click adapter only needs ONE GATT connection, not two — whichever physical unit is BLE-connected relays both controllers' input. Resolves item 30 (dual-Click question) as moot |
| 33 | **New (user's methodology point, 2026-07-28)**: full validation of our model against Zwift's real behavior ultimately requires capturing genuine Zwift traffic on this exact trainer and comparing side-by-side — reading community/QZ source tells us the wire format, not how *this* trainer's closed firmware actually responds to it | User, this turn — directly analogous to the Click Wireshark/PacketLogger deep-dive already parked in `experiments/03-click-buttons-partial.md` follow-ups | **PARTIALLY ADDRESSED 2026-07-28**: the outdoor-ride power/grade chart the user offered to share arrived this session — see [experiments/07-outdoor-ride-power-grade-comparison.md](07-outdoor-ride-power-grade-comparison.md). Directionally confirming (49% higher power in HW-V8's fixed-gear 6% test vs. real-world 238W at 6%, supporting the fixed-gear-protocol-artifact explanation) but explicitly **not** a controlled physics cross-check (free gear/cadence choice, real wind, no isolated steady-state) — stays PARKED for the ideal validation (live Zwift capture, or a controlled outdoor replica of the HW-V8 protocol). **HW-V9's weight-variation test (item 31) remains the closest feasible substitute for the Zwift-specific half of this question**. **New corroborating evidence 2026-07-28 (QZ issue mining, RESEARCH.md Track 2)**: issue #3611 shows even QZ's own reimplementation of the Zwift hub protocol against a real Tacx Neo 2T was reported by a user as switching gears but with a "different feel" and "odd" gear ratios vs. native Zwift, and the maintainer conceded this needed further code review — independent evidence that reverse-engineered wire format alone (even when it visibly works) doesn't guarantee Zwift-identical *feel*, reinforcing why this item stays parked rather than assumed close-enough. **New tooling 2026-07-28 (not yet run)**: an intervals.icu Custom Activity Chart script (`experiments/intervals-icu-power-model-chart.js`) was written to fit the drivetrain model against real per-second outdoor streams (power/speed/grade/altitude) via three methods — a repeat of this session's earlier failed binned-data regression on real per-second data, a flat-segment aero sweep, and an approximate Chung virtual-elevation grid search that solves slope per-sample instead of regressing power against grade, structurally avoiding the grade/speed collinearity (-0.96 in the earlier attempt) that made the binned regression unusable. No API key needed — runs inside intervals.icu's own JS sandbox. **No results yet** — script is unexecuted; see `experiments/09-outdoor-stream-physics-regression.md`. Still not a live-Zwift-capture cross-check (this item's ideal validation), but a materially better tool than 07's binned comparison once run |
| 35 | **New (found 2026-07-28, QZ full device-backend inventory)**: at least 4 more device classes implement their own distinct gear-scaling conventions beyond the original 4(+1) strategies, and they disagree with each other and with `ftmsbike.cpp`'s own `GEARS_SLOPE_MULTIPLIER=50` — `technogymbike.cpp` uses 3 different multipliers for resistance/slope/power (`*5`/unscaled/`*10`); `renphobike.cpp` uses an unscaled resistance add and a separately-hardcoded `*50` slope literal (same number as `ftmsbike.h:125` but not shared); `proformwifibike.cpp` **subtracts** `gearsModifier()` from incline instead of adding it — an inverted sign convention vs. every other device checked | RESEARCH.md Track 2, full device inventory (agent research, 2026-07-28) | Not a hardware-testable item for our own KICKR (none of these are our trainer), but worth carrying as a design lesson: gear-to-resistance scaling conventions are **not** standardized even within one reference implementation — our own drivetrain model (DESIGN §4.3) should not assume any single "natural" multiplier without deriving it from physics, which it already does |
| 34 | **New (found via QZ repo audit, 2026-07-28)**: QZ has a 4th resistance strategy not previously documented — `bike.cpp`'s `computeSlopeTargetPower()`/`updateSlopeTargetPower()`, an app-side weight-aware physics calculation driving the trainer via ERG target power (0x05), bypassing trainer SIM physics entirely | `experiments/PROTOCOLS.md` §2, `RESEARCH.md` Track 2 item 3(d), fetched directly from `src/devices/bike.cpp:602-726` | This is the same strategy already rejected at design time as F4 ("ERG-drive virtual shifting"), but it's real shipped code, not a hypothetical — **add as an actual candidate in HW-V12's bake-off** (§3.2) rather than a theory-only dismissal. **Updated 2026-07-28 (deep dive)**: this path is not merely present but **live and wired** for at least one real device family — `kettlerusbbike.cpp:293-303` is the only class in the repo that overrides `changeInclination`/`forceInclination` to actually invoke `bike::updateSlopeTargetPower()` (Kettler USB bikes have no native SIM/grade support). Also found: this path's own hardcoded constants (`CdA=0.4`, default `Crr=0.005`, `bike.cpp:624-637`) **differ** from the real Zwift-Hub-protocol constants confirmed straight from the proto file (`CWa=0.51`, `Crr=0.004`) — a genuine internal inconsistency inside QZ's own reference implementation, worth keeping our own design's Crr/Cw constants explicitly pinned to one source (RISKS-ROADMAP open Q7) rather than assuming any single "standard" value. A 5th (arguably 6th) strategy was also found and fully documented: QZ's `wahookickrsnapbike.cpp` rewrites the trainer's **wheel circumference** per shift over a Wahoo-proprietary control point (opcode 72, distinct from FTMS 0x12) — see PROTOCOLS.md §3.5 for full detail, including a correction to this doc's prior (likely mistaken) attribution of that technique to `Berg0162/Kickr-Virtual-Shifting` |
| 31 | Zwift's native protocol transmits `PhysicalParam{BikeWeightx100, RiderWeightx100}` alongside the gear ratio — **confirmed as real protobuf fields 2026-07-28** by fetching QZ's actual schema file (`src/devices/zwifthubbike/Zwift hub.proto`), not just inferred. Does the trainer actually use the transmitted weight to compute native-mode resistance, or does it ignore it and fall back to its own internal default (measured as ~93.3kg via HW-V8, and confirmed to be a fixed default unrelated to any app profile — see item 9)? | User's W/kg framing (2026-07-28) + direct proto-file confirmation, cross-referenced against DESIGN §2.1/PROTOCOLS §2 | UNKNOWN, now the **highest-priority sub-goal of HW-V9**: send `PhysicalParam` with two very different `RiderWeightx100` values (e.g. 50kg vs 150kg) at fixed gear ratio/grade and check whether resistance/power responds proportionally — this is the closest we can get to validating the real Zwift mechanism without capturing actual Zwift traffic — see item 33 |

---

## 2. Ordered test matrix

Ordering rule (per mission): **(a) go/no-go gates → (b) dependency order → (c) cost**,
cheapest/fastest first within each tier. "Cost" = rough wall-clock + setup complexity,
not importance.

### Tier A — Go/no-go gates (run first, before any other hardware work)

| ID | Hypothesis | Experiment | Tools/HW | Expected obs per outcome | Decides | Cost |
|---|---|---|---|---|---|---|
| **HW-V0** ✅ | One Chrome page can hold trainer + Click GATT connections *simultaneously, on our actual devices* | Connect trainer via existing app's FTMS chooser; in a second tab/harness connect the Click; hold both open 2 min, no pedaling required | Chrome desktop, both devices powered | **DONE 2026-07-28 — PASS.** Both stayed connected ~76s (of a planned 2min — no reason to expect it wouldn't have continued), continuous IBD + battery notify traffic, zero drops. See [experiments/01-dual-connection-smoke-test.md](01-dual-connection-smoke-test.md). Bonus finding: trainer's Zwift-service ASYNC channel pushes unsolicited debug-log text with no handshake (new item #29 below) | Item 6 — Tier 1 viability gate | Low (~5 min, no pedaling) |
| **HW-V1** ✅ | Trainer firmware ≥ 1.3.17; model is Core V2 (not the 2025 "CORE 2") | Wahoo app → device info; also check for a rider-weight setting (feeds HW-V8) | Wahoo companion app | **DONE 2026-07-28 — fw 1.5.36, model string "KICKR CORE C26B".** Plan A′ gate open. Model-line disambiguation still open (low priority). Bonus: discovered 2 Click units, not 1 (item 30). See [experiments/02-firmware-model-check.md](02-firmware-model-check.md) | Items 1, gates Plan A′ (HW-V9) entirely; disambiguates U11 | Low (~2 min) |
| **HW-V2** ⏸️ | Click identifies as "Zwift Click" over Web Bluetooth; firmware readable | `requestDevice({filters:[{namePrefix:'Zwift Click'}], optionalServices:[...]})`, connect, read 0x2A26 | Chrome desktop + debug harness (built in Phase 1) | **PAUSED 2026-07-28 — partially done.** See [experiments/03-click-buttons-partial.md](03-click-buttons-partial.md): confirmed via live capture rather than a clean isolated test. Deprioritized in favor of trainer/shift-primitive work (user decision) — resume as a deep-dive later | Item 2 | Low (~5 min) |
| **HW-V3** ⏸️ | Exactly one of `0xFC82` / `00000001-19ca-…` resolves | `getPrimaryService(0xfc82)` then fallback | same harness | **PAUSED.** GATT dump showed the device under `0000fc82-...` (post-Jan-2025 fw) — see experiments/03. Not a clean isolated test | Item 2 (connect-flow branch, pre-Jan-2025 vs post) | Low |
| **HW-V4** ⏸️ | Bare `RideOn` write ⇒ unencrypted mode, ASYNC frames start flowing | Subscribe `…0002`/`…0004`, write `52 69 64 65 4F 6E` to `…0003` | same harness | **PAUSED — partially confirmed.** RideOn write ⇒ ASYNC frames did flow, but the indication echoed bare (no status-byte suffix) — see experiments/03 | Item 3 | Low (~5 min) |

### Tier B — Core characterization (dependency order: input side, then trainer side)

**2026-07-28 pivot (user decision): Click/BLE-controller characterization is paused as a
deep-dive for later.** The trainer connection has been completely stable all session
(zero disconnects) while the Click has eaten most of this session's time on connection
instability. Priority flips to the trainer-only rows below (none need the Click) — the
mission's actual payoff, recreating Zwift-quality shift feel, lives entirely in this tier
and Tier C.

| ID | Hypothesis | Experiment | Tools/HW | Expected obs per outcome | Decides | Cost |
|---|---|---|---|---|---|---|
| **HW-V5** ✅ | Button press/release/hold/double-press produce the documented byte grammar (0x37 v1 / 0x23 v2) | Press/hold(>2s)/release/rapid-double each button; log every ASYNC frame with timestamps | harness (depends on HW-V4) | **DONE 2026-07-28 for the buttons that matter.** Right "+"=`0x20`, Left "−"=`0x100`, D-pad matches community table. See [experiments/04-click-mapping-and-relay-confirmed.md](04-click-mapping-and-relay-confirmed.md). Hold-to-repeat cadence (item 23) not separately re-verified this round | Item 4; also feeds item 23 (hold-to-repeat data) | Low (~10 min interactive) |
| **HW-V6** ⏸️ | Click v1 stays connected indefinitely; unconnected Click powers off ~1 min | Idle-connected 5 min, then disconnect + wait 2 min, reconnect | harness | **PAUSED.** Observed repeated disconnects at ~44-90s intervals, consistent with Click v2 vendor-lock (not a clean isolated test); real-Zwift-app unlock workaround attempted, inconclusive. See experiments/03 | Item 5 | Med (~10 min wall-clock, low interaction) |
| **HW-V10** ✅ | KICKR's FTMS conformance: last-write-wins on ERG/SIM interleave; concurrent unserialized 0x11 writes are rejected or dropped; Reset revokes control | (a) 0x05→0x11→0x05 observe winner; (b) fire second 0x11 before first's 0x80; (c) Reset then 0x11 without re-Request-Control | Chrome + FTMS harness, trainer only, light pedaling for power readback | **DONE 2026-07-28.** (a) no rejections, felt-behavior unconfirmed. (b) never reached the trainer — Chrome blocks concurrent same-characteristic writes client-side first. (c) **KICKR does NOT revoke control on Reset** — accepted + real power-trace change (~175W→217W), contradicting FTMS spec. See [experiments/05-ftms-conformance-hw-v10.md](05-ftms-conformance-hw-v10.md) | Items 13, 14 (rate ceiling), 25 (informs clamp behavior) | Med (~15 min, light pedaling) |
| **HW-V7** ✅ | FTMS command round-trip ACK <300ms, felt resistance change 0.5–1.5s, IBD notifications uninterrupted with cadence field always set | Steady pedaling; step grade 0→2→4%; timestamp write→0x80→power-trace inflection; log IBD flag bits throughout | trainer + harness, sustained pedaling | **DONE 2026-07-28.** ACK 2-5ms; felt transition settles over a few seconds; cadence field reliably present during active pedaling. Dual-connection part (with Click) still not repeated under this protocol. See [experiments/06-hw-v7-v8-mass-regression.md](06-hw-v7-v8-mass-regression.md) | Items 7, 8 | Med-High |
| **HW-V8** ✅ | Trainer's internal mass `m_t` can be backed out from a power/grade regression | Constant cadence+speed; hold grades 0/2/4/6% each; record avg power per grade; regress P vs grade | trainer + harness, sustained steady pedaling | **DONE 2026-07-28 — R²=0.9999, `m_t`=93.3kg vs actual 92kg (1.4% off).** Protocol finalized this session: fixed gear (never shifted), 5s lead-in + 15s window per grade (20s total, reduced from an initial 30s after the rider found 6% tiring). See [experiments/06-hw-v7-v8-mass-regression.md](06-hw-v7-v8-mass-regression.md) | Item 9 — the single riskiest design parameter | Med (~90s pedaling once protocol is right) |

### Tier C — Comparative candidate evaluation (the core ruling; needs Tier B done first) — **the actual "recreate the app's virtual shifting" deliverable**

| ID | Hypothesis | Experiment | Tools/HW | Expected obs per outcome | Decides | Cost |
|---|---|---|---|---|---|---|
| **HW-V12** ⏸️ | Among grade-offset (additive and physics-solved), Crr manipulation, Cw manipulation, and Target Resistance Level (0x04, if supported), one mechanism is clearly best on latency/feel/metric-accuracy/stability | See §3.2 below for full protocol | trainer + harness, sustained pedaling, ~40-50 min total (5 candidates × ~8-10 min each) | Scored table per candidate; a clear winner or a documented tie/hybrid recommendation | **Item 16 — the core ruling the whole spec rests on**; also exercises item 25 (clamp saturation) naturally | High — **PAUSED 2026-07-28, candidate (a) done (17/20), see [experiments/08-hw-v12-bakeoff-partial.md](08-hw-v12-bakeoff-partial.md)** |

### Tier D — Optional / stretch (only after Tier A-C are done; gated by HW-V1)

| ID | Hypothesis | Experiment | Tools/HW | Expected obs per outcome | Decides | Cost |
|---|---|---|---|---|---|---|
| **HW-V9** (gate cleared — fw 1.5.36) | QZ's hub-protocol recipe drives native trainer-side shifting on our KICKR; the ×(42/14) normalization is needed (or not); **and (elevated priority 2026-07-28) whether the trainer honors transmitted `PhysicalParam.RiderWeightx100` at all** | On trainer's Zwift service: handshake `RideOn 02 01` → init → 0.4% incline → gear cmd ratio 0.75 then 5.49 (with and without ×42/14) + apply bytes, while pedaling; FTMS CP quiet during the test. **Note (item 29)**: the trainer's ASYNC channel (`…0002`) is already known to push unsolicited debug-log text unprompted — keep logging it and don't mistake that traffic for a HubCommand ack. **Note (item 31, now high-priority)**: at fixed gear ratio/grade, send `PhysicalParam` with `RiderWeightx100` for e.g. 50kg then 150kg and compare resulting resistance/power — this directly tests whether the trainer's firmware uses transmitted mass or ignores it in favor of its own fixed FTMS-path default (measured 93.3kg, HW-V8) | trainer + harness, pedaling, gated on HW-V1 = fw ≥1.3.17 (✅ satisfied) | Resistance clearly drops/rises within ~1s per gear command; compare with/without normalization; compare weight-correct vs weight-wrong — a clear proportional response to weight would be strong evidence the hub protocol's mass field is real and used, not decorative | Items 10, 11, 12, 31 — Plan A′ premium-path viability | High (fiddly protobuf construction, ~30+ min incl. debugging) |
| **HW-V13** | Wahoo's proprietary `a026…` control point offers a usable third shifting path (wheel-circumference re-send per shift) | GATT-map the `a026…` characteristics found in the Feb-2026 scan; attempt a wheel-circumference write per Berg0162/QZ's `wahookickrsnapbike.cpp` pattern | trainer + harness | Either a usable resistance-changing primitive, or rejection/no-op | Item 17 — low priority, only if time remains after V9 | Med (exploratory, no committed recipe) |
| **HW-V11** | Android Chrome repeats HW-V4/HW-V7 behavior | Same steps on Android Chrome, phone screen on | Android phone + Chrome + both devices | Same as V4/V7 | Item 15 — Android parity claim in GOALS.md | Med (needs phone bench setup) |

---

## 3. Comparative-candidate designs (detail)

### 3.1 Click handshake — not actually a competing-candidates test

The mission asks for comparative evaluation wherever multiple theories exist. For the
Click handshake, the *only* viable candidate for a browser client is bare/unencrypted
`RideOn` (three independent implementations confirm this — HYPOTHESES H5). The encrypted
ECDH/AES-CCM handshake is deliberately **not** a competing candidate: it was rejected at
design time (HYPOTHESES F8) because (a) no current firmware requires it, (b) its
counter-endianness is unresolved even in the reference implementations, and (c)
implementing it is real effort for zero present benefit. HW-V4 tests the one live
candidate against our actual unit; it is not a bake-off. Reconsider only if HW-V4 shows
plaintext mode failing on our specific firmware (see its failure mode above).

### 3.2 Shift-primitive bake-off (HW-V12) — full protocol

This is the comparison the mission explicitly calls for and the one gap in the prior
design session (which reasoned its way to the virtual-speed grade-solve without measuring
the alternatives against real hardware). Candidates, all implemented as a throwaway
harness page that can switch mechanism per trial:

| Candidate | Mechanism | Source precedent |
|---|---|---|
| (a) Grade offset — additive | `slope_sent = slope_route + K × gear_step` (fixed % per gear, not speed-scaled) | qdomyos-zwift default path (PROTOCOLS §2 / DESIGN §2.2) — HYPOTHESES F5, rejected at design time as an *emergency fallback* only; worth measuring anyway since it's the cheapest possible implementation |
| (b) Grade offset — physics-solved | Virtual-speed model: solve `G_send` from gear ratio + cadence + measured speed (DESIGN §4.3 math) | This project's current design pick |
| (c) Crr manipulation | Hold grade at route value; scale `Crr` per gear step instead (e.g. `Crr_sent = Crr_base × gear_multiplier`) | Named explicitly in the mission brief as a candidate; not previously implemented anywhere found in research |
| (d) Cw manipulation | Hold grade/Crr at nominal; scale `Cw` (aero term) per gear step | Same — untested candidate, included because Cw scales with `v²` so it behaves very differently from grade/Crr at speed |
| (e) Target Resistance Level (opcode 0x04) | `Set Target Resistance Level` (unitless %, FTMS §4.16.2.14) — **feature-gated; must check the KICKR's Feature characteristic (0x2ACC) bit before attempting** | Not covered anywhere in the existing docs — a genuine gap; if the feature bit is absent this candidate is eliminated before spending bench time on it |
| (f) ERG target power, app-side weight-aware | Compute target power from the standard gravity+rolling+aero formula using the rider's real configured mass, drive via 0x05 (Target Power), bypassing the trainer's own SIM physics/fixed-mass default entirely | **Found 2026-07-28** in QZ's actual shipped code (`bike.cpp`'s `computeSlopeTargetPower`/`updateSlopeTargetPower`, "auto resistance" mode) — same strategy as HYPOTHESES F5 (rejected at design time on theoretical grounds: ERG sluggishness, cadence-coupling), but real production code, worth an actual measurement rather than a theory-only dismissal |

**Setup** (same for every candidate, to hold conditions constant): trainer + harness
connected, Request Control once, **one fixed gear for the whole bake-off** (per the
HW-V7/V8 protocol lesson — never shift mid-test), steady cadence target ~80rpm, same
nominal route grade (2%) as the "before gear change" baseline. **Mind the rider's
~250W-sustained-effort fatigue ceiling** (established in `experiments/06-hw-v7-v8-mass-
regression.md`) when picking gear-step sizes — avoid designing a step that would demand
sustained power much above that for the 15s window.

**Per-candidate trial**: at a marked timestamp, apply a "one gear harder" step change
using that candidate's mechanism only; **5s lead-in + 15s measurement window** (the
protocol finalized in HW-V7/V8, not the originally-planned 20s hold); apply "one gear
easier"; same lead-in+window; return to baseline. Repeat once at a different baseline
grade (0% flat, to specifically probe the zero-grade dead-zone question that motivated
rejecting the old multiplier model).

**Score each candidate 1-5 on, recorded immediately after each trial**:
- **Latency**: write → 0x80 ACK → felt/measured resistance inflection (stopwatch + power trace)
- **Feel**: does harder gear feel harder at both 0% and 2%? Any dead zone or inversion?
- **Metric accuracy**: does reported power/speed move plausibly, or does IBD do something
  strange (e.g. resistance-level candidate not reflected in speed at all since it's not a
  grade)?
- **Trainer stability**: any ATT errors, disconnects, or refused writes at the tested step
  rate?

**Decision rule**: highest total score wins as the shipped primitive; if candidates (b)
and (c)/(d) tie, prefer (b) since it already has the no-calibration baseline-identity
property proven analytically (DESIGN §4.3) — document the tie and the tiebreak reasoning
either way. If (e) is feature-gated off, record that and drop it from scoring rather than
guessing.

---

## 4. Parked (not hardware-testable, or out of scope) — with reasons

| Item | Reason parked | Revisit when |
|---|---|---|
| 18. Momentum-assist ordering (before/after gear translation) | Subjective feel question that requires the drivetrain model to already exist and be ridden, not a bench measurement | P4 tuning ride, after HW-V12's winning primitive is implemented |
| 19. Buy a Zwift Cog | Purchase decision, not a protocol question; the 34/17 parking convention already gives a fixed physical ratio | Never blocking; optional QoL later |
| 20. Persist gear index across reloads | Pure product decision with no hardware dependency | Implementation time (P2) |
| 21. Baseline-identity 2.0-vs-2.04 gap in Zwift's 24-ratio table | Design/data decision (insert exact ratio vs snap vs accept ~2% error); the "is it perceptible" half is a feel question | Decide the table shape in P1; validate perceptibility in P4 |
| 22. Shared Crr/Cw constants between grade-solve and 0x11 payload | Implementation hygiene constraint, not an unknown | P1 implementation (single constants module) |
| 23. Hold-to-repeat product policy | The *hardware fact* (does the Click auto-repeat, at what rate) comes from HW-V5; the *policy choice* (act on every repeat or just first press) is a product decision layered on top | Decide in P2 using HW-V5's captured repeat cadence |
| 24. Default start gear = Zwift's gear 12? | Cosmetic; verifiable only by inspecting Zwift itself (which we don't have/use), not our hardware | Low priority; skip unless trivially confirmable via research |
| 25. Grade-clamp saturation (R4) | Not a standalone experiment — a consequence naturally exercised by the wide grade sweeps in HW-V8 and HW-V12 | Observed as a side-effect of Tier B/C, not scheduled separately |
| 26. Chrome permission persistence flag-gating (R6) | Already CONFIRMED from the Web Bluetooth CG's own implementation-status doc; nothing local to test | Revisit only if Chrome ships the new permissions backend by default |
| 27. Legacy/React state-accretion risk (R7) | Code-architecture concern for implementation review, not a hardware unknown | Code review during P1-P3 implementation |
| 28. Android screen-lock kills BLE (R8) | Pre-existing, already-documented platform constraint; only the *repeat* of core tests on Android (HW-V11) is in scope here | Folded into HW-V11's scope note, not separate |

---

## 5. Execution order (flat list for the bench session)

1. ~~HW-V0 (dual-connection smoke test)~~ **DONE 2026-07-28 — PASS**, see experiments/01
2. ~~HW-V1 (firmware/model)~~ **DONE 2026-07-28** — fw 1.5.36, Plan A′ gate open; found 2
   Click units, see experiments/02
3. ~~HW-V2 → HW-V3 → HW-V4 → HW-V5 → HW-V6 (Click characterization)~~ **PAUSED 2026-07-28**
   (user decision) — partial data captured, see experiments/03; resume as a deep-dive later
4. ~~HW-V10 (FTMS conformance, trainer only)~~ **DONE 2026-07-28** — see experiments/05;
   found Chrome blocks concurrent same-char writes client-side, and KICKR doesn't revoke
   control on Reset (spec deviation)
5. ~~HW-V7 (trainer-only latency/IBD measurement)~~ **DONE 2026-07-28** — see experiments/06
6. ~~HW-V8 (trainer mass regression)~~ **DONE 2026-07-28** — see experiments/06; also
   established the standard fixed-gear/lead-in/window protocol (and a rider-capability
   constraint: avoid sustained >250W for test design) for all remaining power-based tests
7. HW-V12 (shift-primitive bake-off — the core ruling; use the same fixed-gear/lead-in/
   window protocol, mind the rider's ~250W sustained-effort ceiling when designing steps)
   — **PAUSED 2026-07-28 mid-way**: candidate (a) done (17/20, see experiments/08),
   candidate (b)'s grades pre-computed, candidates (c)/(d)/(e)/(f) not started — **resume
   here next session**
8. HW-V9 (Plan A′ probe — gated on HW-V1 result; most fiddly to construct)
9. HW-V13 (Wahoo proprietary path — optional, only if time remains)
10. HW-V11 (Android parity — repeat of V4/V7 on a second device; Click parts stay paused)
11. (Resume paused Click work — HW-V2 through HW-V6 — as a separate deep-dive whenever
    convenient; not required for the FTMS-only Tier 1 spec)

This ordering front-loads every go/no-go gate and cheap identification step before any
sustained-pedaling experiment, and defers the most speculative/fiddly protocol work
(Plan A′, Wahoo proprietary) to the end so a stopping point after Tier C still leaves a
complete, shippable Tier-1 FTMS-only spec.

---

## 6. Base validations — queued for revalidation

**Methodology note (introduced 2026-07-28, user-driven correction):** a single hardware
trial is a **base validation** — a first-pass working answer, not a settled fact. Treat
it that way explicitly rather than letting one correlated observation read as confirmed.
Two sub-categories:
- **Revalidatable by unit test**: pure protocol/math claims (byte layouts, decode/encode
  correctness, deterministic ATT result codes) — these don't need repeated *hardware*
  trials; a byte-fixture unit test is the appropriate strength of evidence and we already
  do this (`tests/unit/zap-frame-parser.test.js`, `ftms-sim-codec.test.js`).
- **NOT revalidatable by unit test**: anything that depends on real-world physical/
  biological variability (rider effort, felt resistance, connection timing/environment) —
  these need a properly controlled *repeat* hardware trial (control condition, blinding,
  or multiple independent transitions) before being trusted, and are queued here rather
  than left silently resting on one observation.

We are not expecting binary yes/no answers from a single pass through the matrix — this
section is where "answered, but only by one trial" items get parked until a deeper,
confound-free validation pass.

| # | Finding (base validation) | Why it's not yet solid | Redesigned retest (confound-free) | Source |
|---|---|---|---|---|
| BV1 | Post-Reset Sim Params command produced a **genuine physical resistance change** (inferred from IBD power rising ~175W→217W over ~7s at constant cadence/speed) | Single uncontrolled trial; rider effort can drift for reasons unrelated to any command, and the rider wasn't blinded to command timing — cannot rule out voluntary/subconscious effort change as the real cause | (1) Check Machine Status (0x2ADA) for an independent "sim params changed" indication — effort-blind, doesn't depend on power at all. (2) A/B: repeat the identical Reset→wait window but WITHOUT sending the follow-up command, compare power drift. (3) Gold standard: blinded, repeated alternating grade steps (e.g. 0%→6%→0%→6%) with the rider not told when commands fire, checking for power steps correlated with command timestamps across ≥3 independent transitions | `experiments/05-ftms-conformance-hw-v10.md` obs. 3 + addendum |
| BV2 | Pairing the Click in Zwift Companion once fixes the ~45-90s disconnect cycle (extends session life) | Single clean before/after pair (one pre-sync failure pattern, one post-sync 5+ min success) — not a repeated controlled trial; could be coincidental (e.g. the specific unit/radio conditions that session) | Repeat the before/after at least twice more, ideally with a fixed wait interval and the same unit, to confirm the pattern reproduces rather than being a one-off | `experiments/03-click-buttons-partial.md`, HYPOTHESES.md H16 |

Add new rows here whenever a hardware-dependent (non-unit-testable) finding rests on a
single trial — don't let it quietly graduate to "confirmed" without a note here first.
