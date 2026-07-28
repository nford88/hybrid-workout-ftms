# Protocol Reference — Byte-Level

Everything needed to implement BLE code, consolidated from reverse-engineering sources.
Statuses: **CONFIRMED** unless marked otherwise. Full source list in RESEARCH.md.

---

## 1. Zwift Accessory Protocol (ZAP) — Zwift Click / Play / Ride controllers

### 1.1 Advertisement & identification

- Device name: exactly **`Zwift Click`** (also `Zwift Play`, `Zwift Ride`; some Ride
  firmware reports `Zwift SF2`).
- Manufacturer data: company ID **0x094A** (Zwift, Inc). Byte 0 = device type:
  `0x02` Play Right, `0x03` Play Left, `0x09` **Click v1**, `0x0A`/`0x0B` Click v2 R/L
  (v2 codes unconfirmed — QZ and BikeControl use different heuristics), `0x07`/`0x08`
  Ride R/L, `0x0E` Play fw2. Then 2-byte short address.
  ⚠️ Web Bluetooth does **not** expose manufacturer data at chooser time — detect the
  variant from the first ASYNC frame type instead (0x37 ⇒ v1, 0x23 ⇒ v2/Ride-protocol).
- Advertised service is **firmware-dependent**:
  - pre-Jan-2025 firmware: `00000001-19ca-4651-86e5-fa29dcdd09d1`
  - post-Jan-2025 firmware: 16-bit **`0xFC82`** (`0000fc82-0000-1000-8000-00805f9b34fb`)
  - Characteristic UUIDs are the same under both services. Probe FC82 first, then 19ca.
- Also present: Generic Access 0x1800 (Appearance 964 "Gamepad"), Device Info 0x180A
  (0x2A26 firmware revision), Battery 0x180F (0x2A19), Nordic DFU 0xFE59 (on MAC+1).

### 1.2 Characteristics

| UUID | Role | Properties |
|---|---|---|
| `00000002-19ca-4651-86e5-fa29dcdd09d1` | ASYNC — device→client stream (buttons/idle/battery) | Notify |
| `00000003-19ca-4651-86e5-fa29dcdd09d1` | SYNC RX — client→device (handshake, commands) | Write, Write-NR |
| `00000004-19ca-4651-86e5-fa29dcdd09d1` | SYNC TX — device→client (handshake response) | Indicate, Read |
| `00000006-19ca-…` | unknown/unused (possibly DFU) | mixed |

Setup order (per BikeControl): subscribe notifications on `…0002`, indications on
`…0004`, **then** write the handshake to `…0003`.

### 1.3 Handshake

- Magic: `RideOn` = `52 69 64 65 4F 6E`.
- **Unencrypted mode (use this)**: write the bare 6 bytes to SYNC RX. Device replies on
  SYNC TX: `RideOn` + 2 status bytes — observed `01 03` (Click v1), `01 04` (Play),
  `02 03` (Click v2). The 2 bytes are effectively don't-care on send; don't validate
  strictly on receive. After this, ASYNC frames are **plain protobuf**.
- Encrypted mode (not needed): `RideOn` + 2 bytes + 64-byte uncompressed P-256 public
  key → ECDH secp256r1 → HKDF-SHA256 (salt = devicePub‖clientPub, 36 bytes = 32-byte
  AES key + 4-byte IV base) → AES-256-**CCM**, nonce = IV base ‖ 32-bit counter, 4-byte
  MIC; wire = counter ‖ ciphertext ‖ MAC. (ajchellew README says GCM — his code and
  makinolo say CCM; CCM is correct. Counter endianness on client→device writes: UNKNOWN.)
- Old firmware speaks **only** encrypted — if no ASYNC frames arrive within ~10 s after
  bare RideOn, firmware is too old (QZ shows "UPGRADE THE FIRMWARE!" toast).

### 1.4 ASYNC frame formats (unencrypted; byte 0 = message type)

**Click v1 — type `0x37`** (ClickNotification; two protobuf varints; INVERSE logic,
0 = pressed, 1 = released):

| Frame | Meaning |
|---|---|
| `37 08 01 10 01` | idle (both released) |
| `37 08 00 10 01` | **shift-up (+/plus) pressed** |
| `37 08 01 10 00` | **shift-down (−/minus) pressed** |

Frames repeat while held — emit on release→press edge; QZ auto-repeats every 500 ms held.

**Click v2 / Ride / Play fw2 — type `0x23`** (keypad status): field 1 (tag `0x08`) =
32-bit **active-low** button bitmap varint; all-released = `23 08 FF FF FF FF 0F`.
Bit masks: LEFT 0x1, UP 0x2, RIGHT 0x4, DOWN 0x8, A 0x10, B 0x20, Y 0x40, Z 0x100,
**SHFT_UP_L 0x200, SHFT_DN_L 0x400**, POWERUP_L 0x800, ONOFF_L 0x1000,
**SHFT_UP_R 0x2000, SHFT_DN_R 0x4000**, POWERUP_R 0x10000, ONOFF_R 0x20000.
Fields 2/3 = nested analog paddle messages (zigzag sint, −100…100). Type `0x2A` =
initial status snapshot.

**Play fw1 — type `0x07`** (PlayKeyPadStatus): varints, 0 = pressed: 1 rightPad,
2 Y/Up, 3 Z/Left, 4 A/Right, 5 B/Down, 6 On/Off, 7 Shift(shoulder), 8 joystick L/R
(zigzag), 9 brake (zigzag).

**Status frames**: `0x15` = idle keepalive (~1 Hz, device→client — use as liveness
watchdog); `0x19 08 <level>` = battery %; `0xFE` = disconnect warning family
(Click v2: `FF 05 00 EA 05` / `FF 05 00 FA 05` before its unlock-timeout disconnect).

### 1.5 Client→device commands (SYNC RX)

- **Vibrate/haptic**: `12 12 08 0A 06 08 02 10 00 18 <pattern>` — pattern `0x20` = ok
  buzz, `0x60` = "gear limit" buzz (QZ usage).
- Reset: `18 05` (makinolo).
- Click v2 post-handshake (BikeControl, when previously unlocked): `FF 04 00`.

### 1.6 Lifecycle quirks

- No client→device keepalive needed (v1/Play/Ride).
- **Click v2**: disconnects ~60 s after connect unless it completed a proprietary
  vendor unlock (0xFF-family challenge) with the real Zwift app within ~24 h.
  Workaround: pair once with real Zwift, then use third-party clients.
- Powers off ~1 min when unconnected; button press wakes it (short advertising window)
  — UX must say "press a button, then Connect".

---

## 2. Zwift hub protocol (trainer-side) — native virtual shifting

Same service/characteristic UUIDs as §1.2, but on the **trainer** (KICKR Core exposes
them alongside FTMS). Messages are **unencrypted** protobuf. Source: makinolo "Zwift
Trainer protocol" + qdomyos-zwift `ftmsbike.cpp` (working implementation).

- **What Zwift sends on shift**: protobuf `HubCommand` (message 0x04) containing
  `SimulationParam { Wind, InclineX100, CWa, Crr }` and
  `PhysicalParam { GearRatioX10000, BikeWeightX100, RiderWeightX100 }`.
  The trainer firmware computes resistance locally from ratio + grade + mass.
  Zwift pins Wind=0, CWa=0.51, Crr=0.004.
- **Riding data** (message 0x03): Power, Cadence, SpeedX100 (= **virtual** speed,
  remapped through the gear ratio — differs from FTMS IBD), HR.
- **Zwift's 24 gear ratios** (as varint = ratio×10000, from QZ
  `characteristicwriteprocessor0003.cpp:60-125`):
  0.75, 0.87, 0.99, 1.11, 1.23, 1.38, 1.53, 1.68, 1.86, 2.04, 2.22, 2.40, 2.61, 2.82,
  3.03, 3.24, 3.49, 3.74, 3.99, 4.24, 4.54, 4.84, 5.14, 5.49.
- **QZ recipe to drive it** (`ftmsbike.cpp`; UNKNOWN on our KICKR until HW-V9):
  1. Handshake to trainer's SYNC RX: `RideOn 02 01` (hub variant), then
     `zwiftPlayInit()` init writes (ftmsbike.cpp:203-240).
  2. Send inclination as protobuf `SimulationParam` (`sendZwiftPlayInclination()`,
     :411-427) — a **0.4 % inclination must precede the first gear command** (:560-565).
  3. On shift: gear command with `gear_value = 10000 × (ratio/original_ratio) × (42/14)`
     followed by "gearApply" bytes `00 08 88 04` (:559-612).
     (Whether the 42/14 normalization is Hub-specific or universal: UNKNOWN — test both.)
  4. **Suppress FTMS control-point writes while in this mode** (:89-105).
- ⚠️ The Feb-2026 prototype failed because it sent **controller-family** messages
  (`SET_GEAR_TEST_DATA` 0xFF04, Data-Object IDs 529/532/547) to the trainer — the wrong
  message family. The hub-family command above was never tried (INFERRED, high confidence).

---

## 3. FTMS (Fitness Machine Service 1.0) — facts that matter here

Spec citations from FTMS v1.0 (mirror: onelap.cn/pdf/FTMS_v1.0.pdf).

### 3.1 Control Point (0x2AD9) opcodes used/relevant

| Opcode | Name | Parameters |
|---|---|---|
| 0x00 | Request Control | — |
| 0x01 | Reset | — (returns defaults **and relinquishes control**) |
| 0x05 | Set Target Power (ERG) | sint16 W |
| 0x07 | Start/Resume | — |
| 0x11 | Set Indoor Bike Simulation Parameters | see below |
| 0x12 | Set Wheel Circumference | uint16 @ **0.1 mm** (2096 mm ⇒ 20960). Feature-gated; **absent on KICKR Core** |
| 0x13 | Spin Down Control | uint8 0x01 start / 0x02 ignore |

⚠️ Historical confusion in this repo: the old prototype used 0x13 for wheel
circumference — 0x13 is Spin Down; wheel circumference is **0x12**.

### 3.2 0x11 — Set Indoor Bike Simulation Parameters (Table 4.20)

7 bytes total, little-endian:

| Offset | Field | Type | Unit/resolution |
|---|---|---|---|
| 0 | opcode 0x11 | u8 | — |
| 1 | Wind Speed | s16 | **0.001 m/s** (⚠️ ftms.js:241 currently encodes 0.01 — latent bug) |
| 3 | Grade | s16 | 0.01 % |
| 5 | Crr | u8 | 0.0001 (unitless) |
| 6 | Cw | u8 | 0.01 kg/m (≡ lumped ½ρ·Cd·A) |

No supported-range characteristic exists for these; out-of-range ⇒ result 0x03.
Zwift observed sending Crr byte 51 (0.0051), Cw byte 41 (0.41).

### 3.3 Control rules (the parts that change our client design)

- **Request Control once** — permission persists until disconnect, Machine Status
  `0xFF Control Permission Lost`, or Reset (0x01). Per-command 0x00 (current ftms.js
  behavior) is unnecessary overhead.
- **One procedure at a time**: a CP write while a procedure is in flight must be rejected
  ATT "Procedure Already In Progress". Correct client = serialize writes on the `0x80`
  indication (`[0x80, req_opcode, result]`; results: 0x01 Success, 0x02 Not Supported,
  0x03 Invalid Param, 0x04 Failed, 0x05 Control Not Permitted).
- **ERG↔SIM precedence**: last write wins — 0x11 aborts a prior 0x05 target and vice
  versa (§4.16.2.22, "should"-level).
- **Machine Status (0x2ADA)** mirrors changes: 0x08 target power changed, 0x12 sim params
  changed, 0x13 wheel circ changed, 0x14 spin-down status, **0xFF control lost** — we
  should subscribe and honor 0xFF (currently ignored, ftms.js:195-197).
- Observed Zwift sequences: ERG `0x00,0x01,0x00,0x07` then repeated 0x05; SIM
  `0x00,0x01,0x00,0x07` then continuous 0x11 (~1 Hz / on-change, INFERRED); Zwift layers
  its own retry/timeout ("request took too long → reset trainer").
- Felt latency command→resistance on real trainers ≈ **1–1.5 s** (simcline measurements).

### 3.4 Trainer-side physics (convention — NOT in the spec)

```
θ = atan(grade/100)
F = m·g·sin θ  +  m·g·cos θ·Crr  +  Cw·(v + v_wind)²
P = F · v            // v = trainer-measured flywheel speed
```

The trainer solves for brake force so the rider must produce `P` at its measured `v`.
**Rider mass `m` is trainer-internal** (configured or default — FTMS never transmits it;
Zwift's `PhysicalParam` exists precisely to fix that). Our KICKR's assumed mass:
UNKNOWN → HW-V8.

---

## 3.5 Unexplored: Wahoo proprietary control point (A026-family)

Wahoo trainers expose a proprietary CPS-extension control point (characteristics in the
`a026….` UUID family) predating good FTMS support. Two projects implement virtual
shifting over it by re-sending a **wheel circumference** per shift:
[Berg0162/Kickr-Virtual-Shifting](https://github.com/Berg0162/Kickr-Virtual-Shifting)
and QZ's `wahookickrsnapbike.cpp:332-388`. This is a possible third path on the KICKR
Core that this project has **never evaluated** (the Feb-2026 scanner special-cased
`a026` services but no commands were tried — `zwift-virtual-shifting.html:938`).
Status: UNKNOWN (HYPOTHESES U9); low priority — FTMS grade-solve and the Zwift hub
protocol likely dominate. Recorded so it isn't re-discovered from scratch.

## 4. Web Bluetooth constraints (Chrome)

- Custom services must be pre-listed in `optionalServices` at `requestDevice` time, or
  `getPrimaryService` throws SecurityError. For the Click list **both**
  `00000001-19ca-…` and `0xFC82` (+ `battery_service`, `device_information`).
- One `requestDevice` chooser per user gesture — two devices ⇒ two button clicks
  (chaining a second chooser off one click fails).
- Multiple simultaneous GATT connections: supported, proven in production (Auuki).
  OS ceilings (Android 7, macOS ~7) are far above our 2.
- In-session reconnect: retained `BluetoothDevice.gatt.connect()` needs no chooser.
  Across reloads: `getDevices()`/persistent permissions are **still behind Chrome flags**
  — design for a re-chooser.
- `writeValueWithResponse/WithoutResponse`: Chrome 85+. FTMS CP: with-response;
  Click SYNC RX: without-response is fine.
- macOS Chrome drops notifications at ~100 Hz rates — irrelevant here (Click ~1 Hz,
  FTMS ≤4 Hz).
- Out of scope for Web Bluetooth: L2CAP, RFCOMM, pairing/bonding initiation, link
  security control. Neither the Click (plaintext GATT) nor FTMS needs any of these ⇒
  **no native bridge required**.
