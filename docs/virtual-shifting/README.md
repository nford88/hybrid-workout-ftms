# Virtual Shifting — Knowledge Base

> Created 2026-07-28 in a design-only deep-dive session (no app code changed).
> Purpose: give any future session full context on the virtual shifting effort —
> what we know, how we know it, what's designed, and what must be tested on hardware.

## Reading order for a fresh session

| File | What it contains | Read when |
|---|---|---|
| [GOALS.md](GOALS.md) | Problem statement, requirements, non-goals, hardware inventory | Always — start here |
| [ARCHITECTURE-CURRENT-STATE.md](ARCHITECTURE-CURRENT-STATE.md) | How the codebase works today, with `file:line` citations | Before touching any code |
| [PROTOCOLS.md](PROTOCOLS.md) | Byte-level reference: Zwift Click (ZAP), Zwift hub protocol, FTMS opcodes | When implementing BLE code |
| [RESEARCH.md](RESEARCH.md) | External research synthesis with all sources/URLs | When you need to re-verify a claim |
| [HYPOTHESES.md](HYPOTHESES.md) | Tested vs untested: evidence ledger, past experiment results, conflicts | Before running hardware experiments |
| [../VIRTUAL_SHIFTING_DESIGN.md](../VIRTUAL_SHIFTING_DESIGN.md) | The full design document (master deliverable) | Before implementing |
| [VALIDATION-PLAN.md](VALIDATION-PLAN.md) | Ordered hardware experiments HW-V1…V11 with expected results | At the bench with Click + trainer |
| [CONNECTION-RECIPE.md](CONNECTION-RECIPE.md) | Click connection state machine, the captured-step → Web Bluetooth mapping, and the Reproducible/Implicit/Unreachable classification (Tier 1 vs Tier 2 evidence) | Before writing any `connect()` code |
| [RISKS-ROADMAP.md](RISKS-ROADMAP.md) | Risks, open questions, phased implementation plan P1–P5 | When planning the next session |

## One-paragraph summary

**Scope note (2026-07-28, supersedes the "Plan A′" framing below): this project builds
an FTMS-only equivalent of Zwift's virtual-shifting *feel*, not a reimplementation of
Zwift's proprietary protocol** — hacking that protocol is explicitly out of scope (see
GOALS.md non-goals). Perfect physical accuracy isn't the bar either, since it will never
match every rider exactly; the bar is a curve **calibrated per-rider from their own real
riding data** (see `VIRTUAL_SHIFTING_DESIGN.md` §4.9, `experiments/09-*`).

Zwift-quality virtual shifting is **not** achieved by multiplying the SIM gradient (the
repo's current model — it's dead at 0 % grade and inverted on descents). Zwift sends the
trainer a **gear ratio** over a proprietary BLE service and the trainer firmware computes
resistance locally — useful context for *why* the old multiplier model is wrong, but not
a path this project pursues (see scope note above). Our design: (1) a device-agnostic
shift-input abstraction with a **Zwift Click over Web Bluetooth** adapter (proven
feasible — unencrypted `RideOn` handshake, plain protobuf button frames); (2) a
**virtual-speed drivetrain model** that solves the FTMS 0x11 grade so the trainer demands
the power the rider would need in the virtual gear — physically correct everywhere, zero
per-gear calibration, with mass/Crr/Cw calibratable per-rider (§4.9); (3) an FTMS command
queue (request control once, coalesce, serialize on ACK); (4) a Zwift-matching **Trainer
Difficulty** trim (§4.8). No native bridge is needed — Web Bluetooth reaches both devices
concurrently.

## Session log

- **2026-07-28** — Initial deep dive. Codebase mapped; 4 parallel research agents
  (Zwift shifting model, qdomyos-zwift internals, Zwift Click BLE protocol, FTMS spec +
  Web Bluetooth feasibility); design doc + this knowledge base written. Key discovery:
  the Feb-2026 prototype failed because it sent *controller-family* Zwift messages to the
  trainer instead of the *hub-family* gear command (see HYPOTHESES.md H7/H8).
- **2026-07-28 (later same day)** — Hardware validation sessions (HW-V0 through V12
  partial); see `experiments/README.md` for the full index. **Scope correction this
  session**: Plan A′ (Zwift hub-protocol reverse engineering, HW-V9) dropped as
  explicitly out of scope — see GOALS.md non-goals and `VIRTUAL_SHIFTING_DESIGN.md`
  §4.6′. Added Trainer Difficulty (§4.8) and elevated personalized per-rider calibration
  via intervals.icu (§4.9) as the actual core deliverable in its place.
- **2026-07-29** — Connection-handshake sniffing effort started. Goal: capture how the
  official app connects to the Zwift Click, capture our own Web Bluetooth page doing
  the same, and diff them — specifically hunting for **keep-awake signals** and an
  **authcode** in the handshake. Phase 0 done (backend ranked, `tools/ble-lab/` built
  and self-verified); Phase 2 capture **blocked** on a backend install and bench time.
  **Best result came without any capture**: the three `0xFF`-family frames that `03`/`04`
  recorded and left undecoded now decode fully (`experiments/13`), showing a compressed
  P-256 public key we already receive in-browser, and pointing at a 3-byte write
  (`FF 04 00`) we have never sent as the likely cause of the ~45-90 s drops. See
  [CONNECTION-RECIPE.md](CONNECTION-RECIPE.md) and `experiments/11`-`13`.
- **2026-07-29 (later same day)** — The capture happened after all, via `adb bugreport`:
  **Zwift Companion connecting a Click V2** (`experiments/15`,
  `captures/20260729-1448-zwift-app-click-session.btsnoop`). It confirmed the **full Click
  V2 attribute table** — including the `0100`/`0101`/`0102` characteristics our code and docs
  had never touched, and three **unread `2901` User Description** descriptors on them — and
  showed Companion subscribing to six CCCDs while writing **no payload at all**, so the
  handshake is still uncaptured. The link died at **73.5 s** on HCI reason `0x08` (supervision
  timer expired). ⚠️ **Corrected mid-session after the user caught it**: the peer was
  **Companion**, not the Zwift game — which is *not* the app BikeControl says performs the
  unlock, so this does **not** discriminate H16 (authorisation) from **H28** (idle timeout);
  an earlier claim that it favoured H28 is retracted. The phone's own logs also showed its
  **30 s screen timeout firing mid-session**; doze is largely exonerated because the trainer's
  idle link survived the same window for 2 min 15 s. **The user then identified the right
  capture design**: Companion has a documented **bridge** mode, so pairing everything to
  Companion and running the real game on a laptop puts an authorised session's BLE on the
  phone, where our proven capture route already works (`experiments/15` §6.0, with five
  pre-registered predictions). The capture also exposed **four silent
  `tools/ble-lab` defects** (lost ATT payloads, cross-device UUID leakage, a lossy address
  filter, and HCI events excluded so the whole connection lifecycle was invisible) — fixed,
  self-test 70/70 → **111/111** — and overturned `11`'s "tshark does all ATT dissection" decision.
- **(next)** — Two tracks. **Free/browser**: the H28 idle-vs-active A/B (`experiments/15`
  §6.1, ~10 min), read the three `2901` User Descriptions (§6.2), subscribe to
  `0100`/`0101`/`0102` as Companion does (§6.3), then the `FF 04 00` A/B from `13`.
  **The capture that gets the unlock**: the bridged-Companion session in §6.0 —
  `tools/ble-lab/android-capture.py --pull` does the pull, marker extraction and analysis in
  one command, and `--check` verifies the two phone settings that have already bitten us.
  Independently: resume HW-V12 (candidates (b)-(f), see
  `experiments/08-hw-v12-bakeoff-partial.md`); run the intervals.icu calibration script
  (`experiments/intervals-icu-power-model-chart.js`) against real ride data.

## Conventions

- Every claim is labeled **CONFIRMED** (evidence in hand), **INFERRED** (plausible,
  needs validation), or **UNKNOWN** (must be tested on real hardware).
- Codebase claims cite `file:line`. External claims cite a URL.
- Hardware experiment IDs `HW-Vn` are stable — reference them from commits/PRs.
- When an experiment resolves an UNKNOWN, update HYPOTHESES.md **and** the ledger in
  ../VIRTUAL_SHIFTING_DESIGN.md §2.6.
