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
| 7 | FTMS command→resistance felt latency on the KICKR Core | HYPOTHESES H10, HW-V7 | INFERRED (via simcline on other hw) |
| 8 | IBD notification cadence under dual connection; cadence field always present | HYPOTHESES U5/U10, HW-V7 | UNKNOWN |
| 9 | Trainer's internal rider-mass assumption `m_t` | HYPOTHESES U3, HW-V8 — **riskiest single parameter in the design** | UNKNOWN. User's framing (2026-07-28): in-game, higher W/kg → faster accumulated virtual distance for the same power — consistent with our own physics model (§4.3: `F_road` scales with mass `m`, so `P_target` for a given speed scales with mass too). This is a sanity-check on the *model shape*, not new evidence on `m_t`'s value — HW-V8 is still the only way to measure it |
| 10 | Whether QZ hub-protocol recipe (`RideOn 02 01` + init + incline + ratio×10000 + apply) moves resistance on our KICKR | HYPOTHESES H7/H8, HW-V9 | INFERRED (confirmed on other Zwift-certified trainers, not ours) |
| 11 | Whether the QZ ×(42/14) gear-command normalization is Hub-specific or universal | HYPOTHESES U6, HW-V9 | UNKNOWN |
| 12 | Whether hub-protocol control and FTMS control coexist, or must be mutually exclusive, on the KICKR | HYPOTHESES U7, HW-V9+HW-V10 | UNKNOWN |
| 13 | KICKR behavior under rapid/unserialized 0x11 writes (ATT reject vs silent drop); ERG/SIM interleave | HYPOTHESES U4/U8, HW-V10 | **PARTIALLY ANSWERED 2026-07-28**: ERG↔SIM interleave (a) accepted no conflicts (felt-behavior unconfirmed, no pedaling in that window); concurrent-write (b) never reached the trainer — Chrome's own client blocks it first (`NetworkError: GATT operation already in progress`). See [experiments/05-ftms-conformance-hw-v10.md](05-ftms-conformance-hw-v10.md) |
| 14 | Zwift's ~1 Hz 0x11 send-rate assumption; safe design rate for our trainer | HYPOTHESES H9, HW-V10 | INFERRED (packet-capture consensus, not measured here) — HW-V10 didn't directly test send-rate ceiling, still open |
| 15 | Android Chrome parity for handshake + dual-connection latency | HW-V11 | UNTESTED |
| 16 | **Which FTMS mechanism should emulate a gear change**: grade offset (additive vs physics-solved) vs Crr manipulation vs Cw manipulation vs Target Resistance Level (0x04) vs hybrid | DESIGN §4.3 picked "virtual-speed grade-solve" **by reasoning, not bake-off**; mission Phase 3.4 explicitly demands a comparative hardware test of ALL candidates | **Design decision made without a comparative experiment — gap this session must close** |
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
| 31 | **New (HW-V1 discussion)**: Zwift's native protocol transmits `PhysicalParam{BikeWeightX100, RiderWeightX100}` alongside the gear ratio (already CONFIRMED in DESIGN §2.1/Track 1) — but the QZ hub-recipe steps documented in PROTOCOLS.md §2 only mention sending `SimulationParam` (incline) + the gear-ratio command, not weight. Does the trainer need accurate weight sent to compute correct native-mode resistance, or does it fall back to a default? | User's W/kg framing (2026-07-28), cross-referenced against DESIGN §2.1/PROTOCOLS §2 | UNKNOWN — fold into **HW-V9**: send `PhysicalParam` with a deliberately-wrong weight once and see if resistance/feel changes, in addition to the planned gear-ratio-only trials |

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
| **HW-V7** (Click parts skippable) | FTMS command round-trip ACK <300ms, felt resistance change 0.5–1.5s, IBD notifications uninterrupted with cadence field always set | Steady pedaling; step grade 0→2→4%; timestamp write→0x80→power-trace inflection; log IBD flag bits throughout. **Trainer-only version**: skip the dual-connection part (already covered by HW-V0), just run the latency/IBD measurement | trainer + harness, sustained pedaling ~10 min | Latency numbers; any IBD gaps/drops; cadence-flag presence % | Items 7, 8 | Med-High (~15-20 min pedaling) |
| **HW-V8** | Trainer's internal mass `m_t` can be backed out from a power/grade regression | Constant cadence+speed; hold grades 0/2/4/6% ≥60s each; record avg power per grade; regress P vs sin(atan(G/100)), slope ≈ `m_t·g·v` | trainer + harness, sustained steady pedaling ~5 min/step | Clean linear fit → `m_t`; compare against any Wahoo-app rider-weight setting found in HW-V1 | Item 9 — the single riskiest design parameter | High (~25-30 min steady pedaling, 4 held grades) |

### Tier C — Comparative candidate evaluation (the core ruling; needs Tier B done first) — **the actual "recreate the app's virtual shifting" deliverable**

| ID | Hypothesis | Experiment | Tools/HW | Expected obs per outcome | Decides | Cost |
|---|---|---|---|---|---|---|
| **HW-V12** | Among grade-offset (additive and physics-solved), Crr manipulation, Cw manipulation, and Target Resistance Level (0x04, if supported), one mechanism is clearly best on latency/feel/metric-accuracy/stability | See §3.2 below for full protocol | trainer + harness, sustained pedaling, ~40-50 min total (5 candidates × ~8-10 min each) | Scored table per candidate; a clear winner or a documented tie/hybrid recommendation | **Item 16 — the core ruling the whole spec rests on**; also exercises item 25 (clamp saturation) naturally | High |

### Tier D — Optional / stretch (only after Tier A-C are done; gated by HW-V1)

| ID | Hypothesis | Experiment | Tools/HW | Expected obs per outcome | Decides | Cost |
|---|---|---|---|---|---|---|
| **HW-V9** (gate cleared — fw 1.5.36) | QZ's hub-protocol recipe drives native trainer-side shifting on our KICKR; the ×(42/14) normalization is needed (or not) | On trainer's Zwift service: handshake `RideOn 02 01` → init → 0.4% incline → gear cmd ratio 0.75 then 5.49 (with and without ×42/14) + apply bytes, while pedaling; FTMS CP quiet during the test. **Note (item 29)**: the trainer's ASYNC channel (`…0002`) is already known to push unsolicited debug-log text unprompted — keep logging it and don't mistake that traffic for a HubCommand ack. **Note (item 31)**: also trial sending `PhysicalParam` with an intentionally-wrong rider weight to see if it changes native-mode resistance/feel | trainer + harness, pedaling, gated on HW-V1 = fw ≥1.3.17 (✅ satisfied) | Resistance clearly drops/rises within ~1s per gear command; compare with/without normalization; compare weight-correct vs weight-wrong | Items 10, 11, 12, 31 — Plan A′ premium-path viability | High (fiddly protobuf construction, ~30+ min incl. debugging) |
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

**Setup** (same for every candidate, to hold conditions constant): trainer + harness
connected, Request Control once, steady cadence target (e.g. 85 rpm) called out loud
before each trial, same nominal route grade (2%) as the "before gear change" baseline.

**Per-candidate trial**: at a marked timestamp, apply a "one gear harder" step change
using that candidate's mechanism only; hold 20s; apply "one gear easier"; hold 20s; return
to baseline. Repeat once at a different baseline grade (0% flat, to specifically probe
the zero-grade dead-zone question that motivated rejecting the old multiplier model).

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
5. HW-V7 (trainer-only latency/IBD measurement — dual-connection part already covered by
   HW-V0, so this just needs pedaling + grade steps) — **next up**
6. HW-V8 (trainer mass regression, needs sustained pedaling — most physically demanding
   single test)
7. HW-V12 (shift-primitive bake-off — the core ruling; needs Tier B's harness and
   pedaling stamina already warmed up)
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
