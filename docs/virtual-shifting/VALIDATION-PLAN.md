# Hardware Validation Plan

Ordered checklist for the bench sessions with the real Zwift Click + KICKR Core V2.
Each experiment converts an UNKNOWN/INFERRED row in HYPOTHESES.md into a fact.
Run on Chrome desktop (macOS) first, repeat key items on Android (HW-V11).
**Record every result in HYPOTHESES.md §E with raw evidence (hex logs).**

Tooling suggestion: a new throwaway page `src/dev/click-probe.html` (or the browser
console against the deployed dev pages) — keep raw hex logging like the existing
prototypes did; those logs were what made this design possible.

---

## HW-V1 — Trainer firmware version + model identification
- **Do**: open the Wahoo app → KICKR Core → record firmware version **and exact model /
  hardware revision** (also check whether the app exposes a rider-weight setting — feeds
  HW-V8).
- **Expect**: firmware ≥ 1.3.17 (Feb 2024); model clarifies "Core V2" vs "CORE 2"
  ambiguity.
- **Decides**: U1, U11 — whether Plan A′ is possible; which support/firmware line applies.

## HW-V2 — Click identification
- **Do**: press a Click button (wakes it), then in Chrome:
  `navigator.bluetooth.requestDevice({ filters:[{namePrefix:'Zwift Click'}], optionalServices:['00000001-19ca-4651-86e5-fa29dcdd09d1', 0xfc82, 'battery_service', 'device_information'] })`.
  Connect; read Device Information 0x2A26 (firmware revision string).
- **Expect**: chooser lists "Zwift Click"; firmware string readable.
- **Decides**: U2 — Click generation + firmware era.

## HW-V3 — Which service the firmware exposes
- **Do**: `getPrimaryService(0xfc82)`; on failure `getPrimaryService('00000001-19ca-…')`.
- **Expect**: exactly one succeeds (FC82 ⇒ post-Jan-2025 firmware).
- **Decides**: U2 — connect-flow branch order.

## HW-V4 — Handshake
- **Do**: startNotifications on `…0002` and `…0004`; write `52 69 64 65 4F 6E` ("RideOn",
  6 bytes, without-response) to `…0003`; log everything hex.
- **Expect**: `…0004` indicates `RideOn` + 2 bytes (`01 03` ⇒ Click v1, `02 03` ⇒ v2);
  ASYNC `…0002` starts flowing (0x15 idle ~1 Hz).
- **Decides**: H5/H11 on our unit — unencrypted mode + variant via frames.
- **Failure mode**: no frames within 10 s ⇒ firmware too old for plaintext (update via
  Zwift Companion app).

## HW-V5 — Button frame capture
- **Do**: press / hold (>2 s) / release each button; log ASYNC frames with timestamps.
- **Expect (v1)**: up `37 08 00 10 01`, down `37 08 01 10 00`, idle `37 08 01 10 01`;
  repeats while held. **(v2)**: `23 08 <bitmap varint>` active-low.
- **Decides**: exact parser fixtures (save the hex dumps as unit-test fixtures).

## HW-V6 — Lifecycle
- **Do**: leave connected idle 5 min; then disconnect and leave unconnected 2 min.
- **Expect**: v1 stays connected (0x15 heartbeat); unconnected ⇒ powers off ~1 min.
- **Decides**: watchdog thresholds + reconnect UX copy. **If it drops at ~60 s while
  connected ⇒ Click v2 vendor-lock (U2)** — document, apply the "pair once with real
  Zwift" workaround, re-test.

## HW-V7 — Dual connection + FTMS latency
- **Do**: connect trainer + Click concurrently. Pedal steadily. Send 0x11 grade steps
  0 → 2 → 4 % (serialized on ACK). Timestamp: write → 0x80 indication → felt change /
  power-trace inflection. Watch IBD notification cadence for gaps, and **log the IBD
  flag bits** to confirm the cadence field is consistently present (U10).
- **Expect**: ACK < 300 ms; felt change 0.5–1.5 s; IBD uninterrupted; cadence flag set
  in every frame while pedaling.
- **Decides**: U5, U10, H10, H13 — latency budget; dual-connection IBD health; cadence
  availability for the drivetrain model.

## HW-V8 — Trainer's internal mass (the riskiest parameter)
- **Do**: constant cadence and speed; sweep grades 0/2/4/6 % (0x11), ≥60 s each; record
  average power at each grade.
- **Analyze**: regress P vs sin(atan(G/100)): slope ≈ `m_t·g·v` ⇒ solve `m_t`.
- **Decides**: U3 — the mass to use in the drivetrain grade-solve (or the trim factor).
- **Note**: check whether the Wahoo app has a rider-weight setting first; if so, record
  it and test whether changing it moves the regression slope.

## HW-V9 — Plan A′ probe: native Zwift-protocol shifting
- **Do** (on the **trainer's** Zwift service, FTMS CP quiet): handshake `RideOn 02 01` →
  QZ `zwiftPlayInit()`-equivalent writes → send 0.4 % inclination (protobuf
  SimulationParam) → while pedaling, send gear command ratio 0.75, wait 5 s, then 5.49
  (`10000×ratio`, try **with and without** the ×(42/14) normalization) each followed by
  apply bytes `00 08 88 04`.
- **Expect**: resistance clearly drops then rises within ~1 s of each gear command.
- **Decides**: H7/H8/U6/U7 — whether browser-driven native shifting works; correct ratio
  encoding; whether FTMS must stay suppressed.
- **Reference**: QZ `ftmsbike.cpp:203-240, 411-427, 559-612` (see PROTOCOLS.md §2).

## HW-V10 — FTMS conformance probing
- **Do**: (a) send 0x05 (150 W) then 0x11 (4 %) then 0x05 again, observing which wins;
  (b) send a second 0x11 *without* waiting for the first's 0x80;
  (c) after Reset (0x01), try 0x11 without re-requesting control.
- **Expect**: (a) last-write-wins; (b) ATT "Procedure Already In Progress" or silent
  drop — record which; (c) result 0x05 Control Not Permitted.
- **Decides**: U4/U8 — queue/retry policy and step-transition handling.

## HW-V11 — Android parity
- **Do**: repeat HW-V4 and HW-V7 on Android Chrome, screen kept on.
- **Expect**: identical behavior.
- **Decides**: U5 on Android; confirms the platform matrix in GOALS.md.
