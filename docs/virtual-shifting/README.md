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
| [RISKS-ROADMAP.md](RISKS-ROADMAP.md) | Risks, open questions, phased implementation plan P1–P5 | When planning the next session |

## One-paragraph summary

Zwift-quality virtual shifting is **not** achieved by multiplying the SIM gradient (the
repo's current model — it's dead at 0 % grade and inverted on descents). Zwift sends the
trainer a **gear ratio** over a proprietary BLE service and the trainer firmware computes
resistance locally. Our design: (1) a device-agnostic shift-input abstraction with a
**Zwift Click over Web Bluetooth** adapter (proven feasible — unencrypted `RideOn`
handshake, plain protobuf button frames); (2) a **virtual-speed drivetrain model** that
solves the FTMS 0x11 grade so the trainer demands the power the rider would need in the
virtual gear — physically correct everywhere, zero per-gear calibration; (3) an FTMS
command queue (request control once, coalesce, serialize on ACK). A flag-gated "Plan A′"
targets the KICKR Core's native Zwift-protocol shifting (supported since fw 1.3.17).
No native bridge is needed — Web Bluetooth reaches both devices concurrently.

## Session log

- **2026-07-28** — Initial deep dive. Codebase mapped; 4 parallel research agents
  (Zwift shifting model, qdomyos-zwift internals, Zwift Click BLE protocol, FTMS spec +
  Web Bluetooth feasibility); design doc + this knowledge base written. Key discovery:
  the Feb-2026 prototype failed because it sent *controller-family* Zwift messages to the
  trainer instead of the *hub-family* gear command (see HYPOTHESES.md H7/H8).
- **(next)** — Run VALIDATION-PLAN.md HW-V1…V5 with the physical Zwift Click; record
  results in HYPOTHESES.md.

## Conventions

- Every claim is labeled **CONFIRMED** (evidence in hand), **INFERRED** (plausible,
  needs validation), or **UNKNOWN** (must be tested on real hardware).
- Codebase claims cite `file:line`. External claims cite a URL.
- Hardware experiment IDs `HW-Vn` are stable — reference them from commits/PRs.
- When an experiment resolves an UNKNOWN, update HYPOTHESES.md **and** the ledger in
  ../VIRTUAL_SHIFTING_DESIGN.md §2.6.
