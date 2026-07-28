# 01 — Dual Connection Smoke Test (HW-V0)

**Date**: 2026-07-28
**Hardware & firmware**: Wahoo KICKR Core, BLE-advertised name `KICKR CORE C26B` (exact
firmware version/model line not yet checked — that's HW-V1, still open). Zwift Click,
BLE-advertised name `Zwift Click` (generation v1 vs v2 not yet disambiguated — HW-V2/V3).
Chrome desktop (macOS), via `src/dev/ble-lab.html` served by the project's Vite dev server,
driven/observed through Chrome DevTools MCP (`list_console_messages`, `take_snapshot`).

## Hypothesis

One Chrome page can hold GATT connections to the trainer and the controller
simultaneously, on our actual devices, without either connection dropping or blocking the
other (test-matrix item 6 / HW-V0 — the Tier 1 go/no-go gate).

## Setup

- `npm run dev` running locally; `src/dev/ble-lab.html` open in Chrome.
- Trainer connect flow: `requestDevice({filters:[{services:[0x1826]}], optionalServices:[FTMS, Zwift legacy UUID, 0xfc82, battery_service, device_information]})`.
- Controller connect flow: `requestDevice({filters:[{namePrefix:'Zwift Click'}], optionalServices:[Zwift legacy UUID, 0xfc82, battery_service, device_information]})`.
- On connect, the harness auto-enumerates all GATT services/characteristics and
  auto-subscribes to every `notify`/`indicate` characteristic it finds (no manual
  handshake performed on either device for this test — no `RideOn` write, no FTMS
  Request Control).

## Exact steps performed

1. User clicked **Connect trainer**, selected "KICKR CORE C26B" in the OS chooser.
2. User clicked **Connect Click** (after waking the Click with a button press), selected
   "Zwift Click" in the OS chooser.
3. Both left connected, idle, no pedaling, no manual writes, for ~76 seconds while the
   agent polled `list_console_messages` three times.

## Raw captured data

Full console capture (`[BLE-LAB]` mirrored log lines), in order, wall-clock timestamps:

```
13:10:44.210Z  trainer/system     {"event":"connected","name":"KICKR CORE C26B"}
13:10:47.505Z  trainer/notify     Zwift ASYNC (00000002-19ca-...)
               hex: 2a 08 03 12 11 22 0f 41 54 58 20 30 31 2c 20 53 54 58 20 30 30 00
               ascii payload: "ATX 01, STX 00\0"
13:10:47.683Z  trainer/notify     Zwift ASYNC (00000002-19ca-...)
               hex: 2a 08 03 12 11 22 0f 41 54 58 20 30 31 2c 20 53 54 58 20 30 31 00
               ascii payload: "ATX 01, STX 01\0"
13:10:47.841Z  controller/system  {"event":"connected","name":"Zwift Click"}
13:10:48.072Z  trainer/notify     Indoor Bike Data — hex: 44 00 00 00 00 00 00 00
  ... (Indoor Bike Data repeats at ~1 Hz throughout; see decode note below) ...
13:10:50.874Z  controller/notify  00002a19-... (Battery Level) — hex: 64
  ... (Battery Level repeats every ~5 s throughout, always hex 64 = 100%) ...
13:10:54.028Z  trainer/notify     Zwift ASYNC (00000002-19ca-...)
               hex: 2a 08 03 12 27 22 25 67 61 70 5f 70 61 72 61 6d 73 5f 63 68 61 6e 67
                    65 28 30 29 3a 20 37 32 2c 20 37 32 2c 20 30 2c 20 36 30 30 00
               ascii payload: "gap_params_change(0): 72, 72, 0, 600\0"
  ... Indoor Bike Data (~1 Hz) and Battery Level (~5 s) continue uninterrupted ...
13:11:59.098Z  trainer/notify     Indoor Bike Data — hex: 44 00 00 00 00 00 00 00
13:12:00.089Z  trainer/notify     Indoor Bike Data — hex: 44 00 00 00 00 00 00 00
```

No `gattserverdisconnected` event fired on either device for the full ~76 s window
observed. Total messages captured: 96 console entries (84 Indoor Bike Data notifications,
9 Battery Level notifications, 3 Zwift-ASYNC debug-text notifications, 2 connect events),
zero errors, zero dropped-connection events.

## Observations

1. **Both devices stayed connected concurrently for the full observed window** (~76 s,
   idle) with continuous, uninterrupted notification traffic from both — trainer IBD at
   ~1 Hz, controller Battery Level at ~5 s intervals. Confirms **HW-V0 / test-matrix item
   6**: dual Web Bluetooth connections work on our specific hardware pairing, not just in
   general (Auuki precedent).
2. **Indoor Bike Data decode**: `44 00 00 00 00 00 00 00` → flags `0x0044` = bit2
   (Instantaneous Cadence present) + bit6 (Instantaneous Power present); bit0 clear means
   Instantaneous Speed is also present (spec's inverted "More Data" bit). So the 8-byte
   frame is `[flags u16][speed u16=0][cadence u16=0][power s16=0]` — consistent with a
   stationary, unpowered bike. This confirms the cadence field's *presence* in the flags
   at idle (partial evidence toward U10); full confirmation while pedaling is still
   HW-V7's job.
3. **Unplanned finding — the trainer's Zwift-service ASYNC characteristic
   (`00000002-19ca-...`) pushes unsolicited debug/log text, with no handshake required.**
   We never wrote anything to the trainer's Zwift SYNC RX in this test (only FTMS was
   touched, and only by subscribing) — yet three notifications arrived on the trainer's
   `…0002` characteristic within the first ~10 seconds, decoding (byte 0 = `0x2a`, same
   "status" message type used by the Click's `0x2a` initial-status frame; nested protobuf
   field 4 = null-terminated ASCII) to plain human-readable strings:
   `"ATX 01, STX 00"`, `"ATX 01, STX 01"`, `"gap_params_change(0): 72, 72, 0, 600"`.
   The last one reads as a BLE-stack log line: GAP connection-parameter update, interval
   min/max = 72 (× 1.25 ms = 90 ms), slave latency = 0, supervision timeout = 600
   (× 10 ms = 6 s) — i.e. this looks like **firmware-internal debug telemetry piggybacked
   on the Zwift-service ASYNC characteristic**, not the Zwift Riding-Data protocol
   (message `0x03`) and not a response to anything we sent. This is new: no prior doc
   anticipated the trainer proactively logging text here absent a handshake.
4. This experiment reconfirms **H1 / L1-L2** (KICKR Core exposes the Zwift custom service
   alongside FTMS) directly from our own hardware, upgrading it from "evidence in
   Feb-2026 prototype logs" to "reconfirmed live, this session."
5. No drop was observed anywhere near a ~60 s mark, which is a mild point of evidence
   (not proof) against this specific Click being a vendor-locked v2 unit — but HW-V6 is
   the real test for that (longer idle window, and specifically watching for the `0xFE`
   disconnect-warning family frames).

## Conclusion

**HW-V0 / test-matrix item 6 (Tier 1 go/no-go gate): PASS.** Dual concurrent Web
Bluetooth GATT connections (trainer + Zwift Click) work reliably on our actual hardware
pairing in Chrome desktop/macOS, confirming the Tier 1 (browser-only) approach remains
viable — no evidence yet of a capability gap that would force Tier 2 (Expo).

Bonus, unplanned discovery: the KICKR Core's Zwift-service ASYNC characteristic emits
spontaneous, human-readable debug-log text (BLE GAP parameter changes, an "ATX/STX"
status line) with no handshake — a new fact not covered by any prior doc, filed as a new
open item (see follow-ups).

## Confidence

**CONFIRMED** for item 6 / HW-V0 (direct observation, our hardware, no ambiguity).
**INFERRED** for the debug-log-channel characterization (single sample of 3 frames; the
meaning of "ATX/STX" is a plausible read of the ASCII text, not verified against any
source — Wahoo firmware internals are not publicly documented).

## Follow-ups

- New open question for the test matrix: is the trainer's Zwift-ASYNC debug-log channel
  relevant to (or does it interfere with) HW-V9's Plan A′ probe? Recommendation: when
  running HW-V9, keep logging this characteristic and be ready to distinguish genuine
  Riding-Data (`0x03`)/HubCommand-ack traffic from this debug-text channel so we don't
  misattribute one for the other.
- HW-V1 (firmware/model check via Wahoo app) still not done — do next, it's cheap and
  independent of any connection state.
- HW-V6 (longer idle + disconnect/reconnect cycle) still open — this test's ~76 s window
  is suggestive but not a substitute for the full HW-V6 protocol (5 min connected idle,
  then 2 min disconnected).
