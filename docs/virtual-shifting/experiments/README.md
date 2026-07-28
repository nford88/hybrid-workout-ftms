# Experiment Log — Index

One line per experiment file, in execution order, with the one-line outcome. Full detail
lives in each `NN-short-slug.md` file (template: Date / Hardware & firmware / Hypothesis /
Setup / Exact steps performed / Raw captured data / Observations / Conclusion / Confidence
/ Follow-ups). The live test matrix (question → scenario → decision) is
[00-test-matrix.md](00-test-matrix.md).

| # | File | Experiment | Outcome |
|---|---|---|---|
| 00 | [00-test-matrix.md](00-test-matrix.md) | Phase 0 question harvest + test matrix (not a hardware experiment) | Live doc |
| 01 | [01-dual-connection-smoke-test.md](01-dual-connection-smoke-test.md) | HW-V0 — dual Web Bluetooth connection (trainer + Click) on real hardware | **PASS** — both stayed connected ~76s, no drops. Bonus: trainer's Zwift-service ASYNC channel emits unsolicited debug-log text |
| 02 | [02-firmware-model-check.md](02-firmware-model-check.md) | HW-V1 — trainer + Click firmware/model ID | KICKR CORE C26B fw 1.5.36 (Plan A′ gate open); Click fw 1.2. Bonus: **two** Click units on hand (Left+Right), not one |
| 03 | [03-click-buttons-partial.md](03-click-buttons-partial.md) | HW-V2/V3/V4/V5/V6 — Click button mapping | **PAUSED, partial** (disconnect-cadence root cause). Mapping/architecture parts superseded by 04 |
| 04 | [04-click-mapping-and-relay-confirmed.md](04-click-mapping-and-relay-confirmed.md) | Full Click button mapping + relay architecture | **CONFIRMED.** Right "+"=0x20, Left "−"=0x100, D-pad matches community table. Left/Right pair relays through ONE BLE connection — only need to connect one unit, big adapter simplification |
| 05 | [05-ftms-conformance-hw-v10.md](05-ftms-conformance-hw-v10.md) | HW-V10 — FTMS Control Point conformance (ERG/SIM interleave, concurrent write, Reset) | **ANSWERED.** Chrome itself blocks concurrent same-characteristic writes client-side (trainer's own ATT conflict handling untested). KICKR does NOT revoke control on Reset — contradicts spec, confirmed by both ATT code and real power-trace change |
