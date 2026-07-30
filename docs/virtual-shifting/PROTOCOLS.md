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
| `00000100-19ca-4651-86e5-fa29dcdd09d1` | unlock? (BikeControl names `0100`/`0101` as the unlock pair) | Write-NR, Write, Notify |
| `00000101-19ca-4651-86e5-fa29dcdd09d1` | unlock? (as above) | Write-NR, Write, Notify |
| `00000102-19ca-4651-86e5-fa29dcdd09d1` | undocumented anywhere; no source names it | Write-NR, Notify |

Setup order (per BikeControl): subscribe notifications on `…0002`, indications on
`…0004`, **then** write the handshake to `…0003`.

#### Click V2 attribute table — CONFIRMED 2026-07-29

Read off Zwift **Companion**'s own discovery in `captures/20260729-1448-zwift-app-click-session.btsnoop`
(`experiments/15`). Unit `f4:c4:59:81:d9:a1`, hw rev `B.0`, **fw `1.2.0`**, serial
`0A-34C45981D9A1`, manufacturer `Zwift Inc`. The Zwift service here is the **16-bit
`0xFC82`** form (handles `0x0019–0x002d`), i.e. post-Jan-2025 firmware, and the `19ca`
characteristics live inside it.

| Value handle | CCCD | User Desc | Properties | UUID |
|---|---|---|---|---|
| 0x001b | 0x001c | — | Notify | `…0002` ASYNC |
| 0x001e | — | — | Write-NR | `…0003` SYNC RX |
| 0x0020 | 0x0021 | — | Read + Indicate | `…0004` SYNC TX |
| 0x0023 | 0x0024 | 0x0025 | Write-NR + Write + Notify | `…0100` |
| 0x0027 | 0x0028 | 0x0029 | Write-NR + Write + Notify | `…0101` |
| 0x002b | 0x002c | 0x002d | Write-NR + Notify | `…0102` |
| 0x0030 | 0x0031 | — | Read + Notify | `2A19` Battery Level (**exactly one**, not three) |

**What Companion did with them**: subscribed to all six CCCDs (notify on `0002`/`0100`/
`0101`/`0102`/`2A19`, **indicate** on `0004`), read `0004` and got a **zero-length** response,
and wrote **no payload to any characteristic** before the link timed out. So the unlock write
is still uncaptured — and note the peer was **Companion with no game session running**, which
is plausibly a configuration that has nothing to unlock. `experiments/15` §6.0 is the design
that should capture it: Companion in **bridge** mode with the real game on a laptop, which
keeps the BLE on the phone where we can capture it.

The three `2901` User Description descriptors on `0100`/`0101`/`0102` are unread by anyone,
Companion included. They are free to read from Web Bluetooth and may name the characteristics.

### 1.3 Handshake

- Magic: `RideOn` = `52 69 64 65 4F 6E`.
- **Unencrypted mode (use this)**: write the bare 6 bytes to SYNC RX. After this, ASYNC
  frames are **plain protobuf**.
- ⚠️ **CORRECTED 2026-07-29 by capturing real Zwift — write 8 bytes, not 6.** Zwift sends
  **`RideOn 02 03`** = `52 69 64 65 4F 6E 02 03`, to Click V2 fw 1.2.0 **and** to the KICKR
  Core, and the replies differ by device:
  - **Click V2** indicates **`RideOn 02 03`** back on SYNC TX — identical to what was sent.
  - **KICKR Core** indicates **`RideOn 02 02`** — *not* a mirror. This matches the Feb-2026
    prototype log (`src/dev/zwift-virtual-shifting.html:318-331`, H3's evidence
    `52 69 64 65 4F 6E 02 02`), independently confirming that old observation.
  - Evidence: `experiments/16-bridged-zwift-session-capture.md` §2, raw ATT PDUs on three
    separate links in `captures/20260729-163837-bridge-ride.btsnoop`.
  - **The previous entry here was an artefact of our own client.** It said the Ride family
    "echoes a bare 6-byte `RideOn`, no status bytes" and dismissed the "+2 status bytes"
    reading as Play-era. We only ever *sent* 6 bytes, so we only ever got 6 back. The
    community-reported `02 03` variant is exactly what Zwift uses. Superseded, but the
    observation itself (bare in ⇒ bare out) still stands as a device behaviour.
  - **Ride/Play, for reference**: makinolo's Ride writeup says *"Device replies via indication
    characteristic: `RideOn`"*; the Play writeup gives `RideOn 00 09` *"or sometimes 01 03"*;
    community reports also list `01 03`/`01 04`/`02 03`.
- **Why plaintext works at all**: Zwift *removed* the encryption. makinolo, 2024-07:
  *"Zwift got rid of the Bluetooth communication encryption they were using for the Play and
  the Click."* Not luck — designed current behaviour. See `experiments/13` §3.
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

#### Our units' complete map — CONFIRMED 2026-07-29, every button pressed and labelled

`experiments/16` Phase 1. This **supersedes the community table** wherever they disagree, and
**corrects `H18`/`04`**, which had the "+" paddle on `0x20`.

| Bit | Frame (`23 08 …`) | Our button | Community table | |
|---|---|---|---|---|
| `0x0001` | `fe ff ff ff 0f` | D-pad Left | LEFT | ✅ |
| `0x0002` | `fd ff ff ff 0f` | D-pad Up | UP | ✅ |
| `0x0004` | `fb ff ff ff 0f` | D-pad Right | RIGHT | ✅ |
| `0x0008` | `f7 ff ff ff 0f` | D-pad Down | DOWN | ✅ |
| `0x0010` | `ef ff ff ff 0f` | A | A | ✅ |
| `0x0020` | `df ff ff ff 0f` | **B** | B | ✅ — and **NOT** the "+" paddle, as `04` recorded |
| `0x0040` | `bf ff ff ff 0f` | Y | Y | ✅ |
| `0x0080` | `ff fe ff ff 0f` | **Z** | *(absent — table has no 0x80)* | ❌ |
| `0x0100` | `ff fd ff ff 0f` | **Left "−" paddle** | Z | ❌ |
| `0x1000` | `ff df ff ff 0f` | **Right "+" paddle** | ONOFF_L | ❌ |

The four face buttons run contiguously `0x10/0x20/0x40/0x80`; **both paddles sit outside that
run**. `src/dev/protocols/zapFrame.js` exports this as `OUR_CLICK_BUTTONS`.
Bit masks: LEFT 0x1, UP 0x2, RIGHT 0x4, DOWN 0x8, A 0x10, B 0x20, Y 0x40, Z 0x100,
**SHFT_UP_L 0x200, SHFT_DN_L 0x400**, POWERUP_L 0x800, ONOFF_L 0x1000,
**SHFT_UP_R 0x2000, SHFT_DN_R 0x4000**, POWERUP_R 0x10000, ONOFF_R 0x20000.
Fields 2/3 = nested analog paddle messages (zigzag sint, −100…100). Type `0x2A` =
initial status snapshot.

**Play fw1 — type `0x07`** (PlayKeyPadStatus): varints, 0 = pressed: 1 rightPad,
2 Y/Up, 3 Z/Left, 4 A/Right, 5 B/Down, 6 On/Off, 7 Shift(shoulder), 8 joystick L/R
(zigzag), 9 brake (zigzag).

**Status frames**: `0x15` = idle keepalive (**~1 Hz, device→client, and sent every second
even while buttons are pressed** — makinolo Play writeup; three independent sources agree
no *client*-side keepalive exists, so treat the 1 Hz inbound frame as a contract and base
the liveness watchdog on it); `0x19 08 <level>` = battery %; `0x3c` = control-point /
device-information response (an info-query reply *"starts with `3c 08 00…`"*, makinolo Ride).

**`0xFF` family — grammar decoded 2026-07-29** (`experiments/13`). Framing is
`FF <subtype> 00` + protobuf, matching §1.5's client-side `FF 04 00`. Decoded from our own
captures:

| Frame | Decode |
|---|---|
| `FF 05 00` + pb | device status: BD address as ASCII (`34C4593D51A6` ≈ our Click's `F4:C4:59:3D:51:A6`), battery %/mV pairs, and a candidate countdown (`496`) |
| `FF 03 00` + pb | **33-byte compressed P-256 public key** (`0x03` prefix), a `02 03 00 00` version-shaped field, and a 40-byte (32+8) blob. Arrives **unsolicited** on ASYNC |

⚠️ **`FF 03` is NOT the §1.3 encryption handshake.** That uses a **64-byte uncompressed**
key on SYNC RX/TX after `RideOn 01 02`; this is a 33-byte *compressed* key, unsolicited, on
ASYNC. Different mechanism. **makinolo documents no `0xFF` family at all**, so this is
under-documented externally — likely the Click-v2 vendor unlock (H16). Full comparison and
reasoning: `experiments/13`.

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
  - **Measured 2026-07-29**: **73.5 s** on a Zwift **Companion** connection (HCI reason
    `0x08`, supervision timer expired) after 70 s with no ZAP traffic, followed by 12 failed
    reconnects — consistent with the device sleeping. `experiments/15`.
  - ⚠️ **The *cause* is not settled.** A competing explanation is a plain **idle timeout**
    (H28) rather than an authorisation timeout: the variable that tracks every observation we
    have, including `03`'s 5-minute post-sync hold, is *whether traffic was flowing* rather
    than *who the client was*. That capture cannot discriminate the two, because Companion is
    not the app BikeControl says performs the unlock. Two tests settle it — `experiments/15`
    §6.1 (unauthorised, browser-only, 10 min) and §6.0 P4 (authorised, via Companion bridged
    to the game). Do not build a keep-awake design on either reading until then.
- Powers off ~1 min when unconnected; button press wakes it (short advertising window)
  — UX must say "press a button, then Connect".

---

## 2. Zwift hub protocol (trainer-side) — native virtual shifting

Same service/characteristic UUIDs as §1.2, but on the **trainer** (KICKR Core exposes
them alongside FTMS). Messages are **unencrypted** protobuf. Source: makinolo "Zwift
Trainer protocol" + qdomyos-zwift `ftmsbike.cpp` (working implementation) + **the full
protobuf schema**, `src/devices/zwifthubbike/Zwift hub.proto` — **fetched and read in
full 2026-07-28 deep-dive session** (164 lines total; the prior session had only read the
first ~150 lines / the 3 core messages below — this supersedes that partial read).

### 2.0 Full `.proto` schema (CONFIRMED — complete file)

```protobuf
message SimulationParam {                  // command code 0x04, nested in HubCommand
  optional sint32 Wind = 1;                // m/s * 100. In zwift there is no wind (0)
  optional sint32 InclineX100 = 2;         // grade% * 100
  optional uint32 CWa = 3;                 // CW*a * 10000. In zwift this is constant 0.51 (5100)
  optional uint32 Crr = 4;                 // Crr * 100000. In zwift this is constant 0.004 (400)
}
message PhysicalParam {
  optional uint32 GearRatioX10000 = 2;     // literally named "gear ratio ×10000" — confirms
                                            // the 10000× scale is Zwift's own protocol
                                            // convention, not a QZ invention
  optional uint32 BikeWeightx100 = 4;
  optional uint32 RiderWeightx100 = 5;
}
message HubCommand {                       // command code 0x04
  optional uint32 PowerTarget = 3;
  optional SimulationParam Simulation = 4;
  optional PhysicalParam Physical = 5;
}
message HubRequest {                       // command code 0x00 — NEW, not previously documented
  optional uint32 DataId = 1;
  // proto comment: "sent always following the change of the gear ratio probably to
  // verify it was received properly." DataId=0 → general info; DataId=1-7 →
  // DeviceInformationContent field N; DataId=520 → gear ratio; 512-534 unidentified.
}
message HubRidingData {                    // command code 0x03 — 2 fields NEW vs prior read
  optional uint32 Power = 1;
  optional uint32 Cadence = 2;
  optional uint32 SpeedX100 = 3;           // virtual speed, remapped through gear ratio
  optional uint32 HR = 4;
  optional uint32 Unknown1 = 5;            // observed values: 0 / 2864 / 4060 / 4636 / 6803
  optional uint32 Unknown2 = 6;            // observed values: 25714 / 30091 (const/session)
}
```

The same file also defines the Click/Play/Ride **controller**-side messages already
documented in §1 (`PlayKeyPadStatus` cmd 0x07, `PlayCommand` cmd 0x12 haptics, `Idle` cmd
0x19, `RideKeyPadStatus` cmd 0x23, `ClickKeyPadStatus` cmd 0x37, `DeviceInformation` cmd
0x3c) — confirms both protocol families are one schema, not two. **No dedicated
"gear-apply-ack" message exists anywhere in the file** — §2.2.1 shows the `00 08 88 04`
apply bytes decode as a plain `HubRequest{DataId=520}`, reusing this message, not a new
type.

### 2.1 What Zwift sends on shift, riding data, gear table — unchanged, still CONFIRMED

- protobuf `HubCommand` (message 0x04) containing `SimulationParam { Wind, InclineX100,
  CWa, Crr }` and `PhysicalParam { GearRatioX10000, BikeWeightx100, RiderWeightx100 }` —
  **confirmed real fields carrying actual rider/bike mass in kg×100**, not an
  inferred/guessed mechanism. The trainer firmware computes resistance locally from ratio
  + grade + mass — but exactly how the firmware uses the transmitted mass (vs. its own
  internal FTMS-path default, measured as ~93.3kg on our unit in HW-V8) is still UNKNOWN
  on our KICKR until HW-V9 specifically varies `RiderWeightx100` and checks whether
  resistance responds. Zwift pins Wind=0, CWa=0.51, Crr=0.004.
- **Riding data** (message 0x03, `HubRidingData`): Power, Cadence, SpeedX100 (= **virtual**
  speed, remapped through the gear ratio — differs from FTMS IBD), HR, plus two fields
  with unconfirmed purpose (`Unknown1`/`Unknown2`, §2.0).
- **Zwift's 24 gear ratios** (as varint = ratio×10000, from QZ
  `characteristicwriteprocessor0003.cpp:60-125` — cross-confirmed again this session at
  `:63-87`, e.g. gear 12's bytes `C0 BB 01` decode to `GearRatioX10000=24000`, matching
  the same value independently observed in the handshake's `init2`/`init5` writes, §2.2):
  0.75, 0.87, 0.99, 1.11, 1.23, 1.38, 1.53, 1.68, 1.86, 2.04, 2.22, 2.40, 2.61, 2.82,
  3.03, 3.24, 3.49, 3.74, 3.99, 4.24, 4.54, 4.84, 5.14, 5.49.
- ⚠️ The Feb-2026 prototype failed because it sent **controller-family** messages
  (`SET_GEAR_TEST_DATA` 0xFF04, Data-Object IDs 529/532/547) to the trainer — the wrong
  message family. The hub-family command below was never tried (INFERRED, high confidence).

### 2.2 QZ's exact wire construction (byte-level — supersedes the prior line-range-only citations)

**Handshake — `ftmsbike.cpp:203-243`, the FULL 11-write sequence** (prior docs only cited
`RideOn 02 01`; the actual init sequence is longer and was not previously decoded byte-by-byte):

```
rideOn = 52 69 64 65 4f 6e 02 01   // ASCII "RideOn" + 02 01
init1  = 41 08 05                  // command code 0x41 — NOT in the documented proto's
                                    // command set (0x00/0x03/0x04/0x07/0x12/0x19/0x23/0x37/0x3c).
                                    // UNKNOWN — flagged, not resolved this pass.
init2  = 04 2a 04 10 c0 bb 01      // HubCommand{Physical{GearRatioX10000=24000}} (ratio 2.4)
init3  = 00 08 00                  // HubRequest{DataId=0} (general info)
       (init1 repeated)
init4  = 00 08 88 04               // HubRequest{DataId=520} — IDENTICAL bytes to the
                                    // "gearApply" write below (see §2.2.1)
init5  = 04 2a 0a 10 c0 bb 01 20 bf 06 28 b4 42
                                    // HubCommand{Physical{GearRatioX10000=24000,
                                    //   BikeWeightx100=831, RiderWeightx100=8500}}
init6  = 04 22 0b 08 00 10 da 02 18 ec 27 20 90 03
                                    // HubCommand{Simulation{Wind=0, InclineX100=173
                                    //   (zigzag→1.73%), CWa=5100, Crr=400}}
       (init2, init4 repeated)
init7  = 04 22 03 10 a9 01         // HubCommand{Simulation{InclineX100=-85 zigzag (-0.85%)}}
       (init2, init4 repeated)
init8  = 04 22 02 10 00            // HubCommand{Simulation{InclineX100=0}}
```
Decode method: byte 0 = command code (`0x00`=`HubRequest`, `0x04`=`HubCommand`); remaining
bytes are standard protobuf wire format (tag = `field<<3 | wiretype`; sint32 fields
zigzag-encoded). **Self-check**: `init6`'s `CWa=5100`/`Crr=400` decode to exactly the
proto's documented Zwift constants `0.51`/`0.004` — confirms the byte-level decode above is
correct, not guessed.

#### 2.2.1 CORRECTION: the `00 08 88 04` "gearApply" bytes are a `HubRequest{DataId=520}` verification poll, not a distinct apply message

Prior documentation described these as "'gearApply' bytes," implying a distinct
apply/commit message. Decoded byte-by-byte (CONFIRMED, `ftmsbike.cpp:611` — identical to
`init4` above):
- `0x00` = `HubRequest` command code.
- `0x08` = tag `(1<<3)|0` → field 1, wire type 0 (varint) → `DataId`.
- `88 04` = varint continuation: `0x88`→low7=`0x08` (continue), `0x04`→low7=`0x04` (stop)
  ⇒ value = `0x08 | (0x04<<7)` = `8 + 512` = **520**.

So this is literally `HubRequest{DataId=520}` — a request for the current gear-ratio state
(per the proto's own comment on `HubRequest`, §2.0), sent by QZ after every gear command as
a **verification poll**, not a commit/apply command. QZ's own local variable name
`gearApply` (`ftmsbike.cpp:611`) is a misnomer relative to what the bytes actually do. This
doesn't change the *practical* recipe (still send it after the gear command) but corrects
the conceptual model: there is no separate "apply" step in the protocol — the gear ratio in
`HubCommand.Physical.GearRatioX10000` takes effect as soon as it's received; the poll only
checks that it landed.

**Inclination send** (`sendZwiftPlayInclination()`, `ftmsbike.cpp:411-445`) — **no raw
protobuf is built in this function on desktop/Linux Qt builds**: it delegates to
platform-native helpers (iOS Objective-C++ `lockscreen::zwift_hub_inclinationCommand`;
Android JNI `ZwiftHubBike.inclinationCommand`). The plain-Qt branch (`:438-441`) is an
unimplemented stub (`qDebug() << "implement zwift hub protobuf!"`). **The byte-level
inclination-send wire format is therefore not visible in this file** — it lives in
per-platform native code outside this pass's scope. (`init6`/`init7`/`init8` above confirm
inclination values arrive as `HubCommand.Simulation.InclineX100`, so the target
message/field is confirmed even though the exact encoding call site wasn't found.)

**Gear command + apply** (`ftmsbike.cpp:559-613`, matches the prior `:559-612` citation):
```cpp
if (zwiftPlayService && gears_zwift_ratio && lastGearValue != gears()) {
    if (!gearInclinationSent) sendZwiftPlayInclination(0.4);   // the 0.4% quirk, confirmed
    uint32_t gear_value = static_cast<uint32_t>(
        10000.0 * (current_ratio / original_ratio) * (42.0 / 14.0));
    writeCharacteristicZwiftPlay(proto, ..., "gear", ...);       // HubCommand.Physical.GearRatioX10000
    uint8_t gearApply[] = {0x00, 0x08, 0x88, 0x04};              // HubRequest{DataId=520} — §2.2.1
    writeCharacteristicZwiftPlay(gearApply, sizeof(gearApply), "gearApply", ...);
}
```

### 2.3 U7 — RESOLVED: hub-protocol and FTMS control are strictly mutually exclusive, gated by one flag pair

**CONFIRMED** (`ftmsbike.cpp:86-105`, read in full this session). Every FTMS caller
(`forcePower`, `forceResistance`, `forceInclination`, `init()`, …) goes through one shared
function:
```cpp
bool ftmsbike::writeCharacteristic(uint8_t *data, uint8_t data_len, ...) {
    bool gears_zwift_ratio = settings.value(QZSettings::gears_zwift_ratio, ...).toBool();
    if (!gattFTMSService) { ...; return false; }
    if (zwiftPlayService && gears_zwift_ratio) {
        qDebug() << "zwiftPlayService is present!";
        return false;                      // FTMS write dropped, not queued, not delayed
    }
    return enqueueWrite(gattFTMSService, gattWriteCharControlPointId, data, data_len, ...);
}
```
with the mirror-image guard on the hub side (`ftmsbike.cpp:72-84`):
```cpp
void ftmsbike::writeCharacteristicZwiftPlay(uint8_t *data, uint8_t data_len, ...) {
    bool gears_zwift_ratio = settings.value(QZSettings::gears_zwift_ratio, ...).toBool();
    if (!zwiftPlayService || !gears_zwift_ratio) { ...; return; }   // dropped if not in hub mode
    enqueueWrite(zwiftPlayService, zwiftPlayWriteChar, ...);
}
```
**Definitive answer**: it is a single runtime condition — `zwiftPlayService != nullptr`
(a Zwift service was discovered on the connected trainer) **AND** the persisted setting
`gears_zwift_ratio` is true. When both hold, the *same* `writeCharacteristic()` every FTMS
command already goes through returns `false` immediately, before `enqueueWrite` is ever
called — there is no structurally separate FTMS code path, no queueing-then-discard, just
an early-return guard in the one shared write function. The exclusion is therefore a **mode
switch, not a coexistence/priority scheme** — Plan A′'s integration shape should be "mode
switch," confirming `VIRTUAL_SHIFTING_DESIGN.md` §4.6′'s existing assumption ("suppress
FTMS CP writes while active") was already correct.

### 2.4 U6 — RESOLVED: the `×(42/14)` normalization is QZ's own generic default-gearing constant, not Zwift/Hub-specific

**CONFIRMED**: a repo-wide `gh api search/code` for `42.0/14.0` returns **only**
`ftmsbike.cpp:574` — no hit in `virtualbike.cpp`, `characteristicwriteprocessor0003.cpp`,
or anywhere else. The constant's actual source is `src/qzsettings.h:2464-2468`:
```cpp
static constexpr int default_gear_crankset_size = 42;   // front chainring teeth
static constexpr int default_gear_cog_size = 14;        // rear cog teeth
```
— QZ's app-wide default reference-bike gearing, used to compute `original_ratio` for
**any** device with custom gearing, not just the Hub path. `ftmsbike.cpp:574` hardcodes
that same 42/14 ratio a **second time** as a fixed multiplier, independent of whatever the
user actually configured. Net effect: when the user hasn't customized crankset/cog (still
at the 42/14 default), `original_ratio` also equals 42/14, so `(current_ratio/
original_ratio) × (42/14)` **cancels to just `current_ratio`** — the multiplier exists to
renormalize back to QZ's own default reference ratio regardless of the user's
`original_ratio` setting, not to encode anything intrinsic to Zwift's protocol or hardware.

**Provenance** (`gh api repos/cagnulein/qdomyos-zwift/commits?path=...`): the `42.0/14.0`
line was introduced in PR **#2757 "Zwift hub gear custom"** (commit `109dc90`, merged
2024-11-13), replacing an earlier hardcoded 24-entry switch/case of raw gear-ratio byte
literals. `default_gear_crankset_size`/`default_gear_cog_size` themselves predate that by
~2 weeks, from PR **#2682 "Wahoo Custom gearing ranges/ratios"** (commit `281590c`,
2024-10-31) — built for **generic** Wahoo custom-gearing support, unrelated in origin to
the Zwift Hub. #2757 later reused those same-named/same-valued settings as a literal in
the Hub gear formula.

**Conclusion: not Hub-specific, and not confirmed as a "universal Zwift convention"
either — it is a QZ-internal constant, cross-feature-reused.** The ultimate 42T/14T
provenance (a specific reference bicycle? Zwift's own internal default?) remains UNKNOWN
— neither PR's commit history explains why 42/14 specifically, only that it was already
QZ's own default before the Hub feature reused it.

### 2.5 QZ's Zwift-Hub emulation (reverse path) — `src/virtualdevices/virtualbike.cpp`, read in full (1795 lines)

Previously noted only as "the mirror image of what we want," never read in detail. QZ can
act as a **fake Zwift Hub/Play GATT peripheral** toward a real Zwift game client or
Click/Play controller (gated by `QZSettings::zwift_play_emulator`):

- Handshake/dispatch (`virtualbike.cpp:988-1129`): pattern-matches incoming byte prefixes
  against 8 known captured request shapes and replies with pre-recorded, partially
  templated response frames — a hand-reverse-engineered emulator, not a generic protobuf
  codec.
- **Incoming incline from a real Zwift client** (`virtualbike.cpp:1044-1072`): decodes the
  sint incline, then **repacks it as a synthetic FTMS Control Point frame**
  `11 69 01 <slope_lo> <slope_hi> 32 28` and injects it via the same
  `ftmsCharacteristicChanged` path a real FTMS session would use — i.e. it reuses the
  normal FTMS→trainer forwarding machinery rather than a separate code path.
- **Incoming gear command from a real Zwift client** (`virtualbike.cpp:1074-1097` →
  `characteristicwriteprocessor0003.cpp:60-118`): **does not invert the `10000×(ratio/
  original)×(42/14)` formula analytically.** It matches the raw incoming bytes against a
  **hardcoded lookup table of 24 exact byte pairs/triples**, one per gear 1–24 (e.g. gear 1
  = `CC 3A`, gear 24 = `F3 AC 03`), captured empirically from real Zwift traffic, then
  calls `bike::gearUp()`/`gearDown()` the right number of times to reach the target gear.
  **This means QZ itself does not treat the 42/14-normalized gear-ratio encoding as
  analytically round-trippable** — its own reverse-direction decoder is a lookup table,
  not the inverse formula, soft corroborating evidence that the encoding is a fixed,
  closed, 24-value protocol in practice rather than a continuously-parameterized one.
- **Incoming power/ERG command** (`virtualbike.cpp:1099-1128`): decodes a varint power
  value, injects a synthetic FTMS `0x05` frame the same way.

### 2.6 Newly-flagged physics-constant mismatch inside QZ itself

`bike.cpp`'s own `computeSlopeTargetPower()` (RESEARCH.md Track 2, resistance strategy
(d)) hardcodes `CdA=0.4` (`airDensity×dragCoefficient×frontalArea` = 1.204×0.4×1.0,
`bike.cpp:624-637`) and defaults `Crr=0.005` (`QZSettings::rolling_resistance` default) —
**both differ from the real Zwift-Hub-protocol constants confirmed in §2.0's proto file**
(`CWa=0.51`, `Crr=0.004`). This is a real, citable internal inconsistency inside QZ between
its own ERG-driven physics approximation and the constants Zwift's actual protocol
transmits — not a flaw in our project, but worth carrying into our own design: even the
reference implementation doesn't hold its physics constants consistent across its own
resistance strategies.

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
Zwift observed sending Crr byte 51 (0.0051), Cw byte 41 (0.41) over **plain FTMS 0x11**
(ftmsemu.github.io observation — presumably Zwift's fallback for trainers without hub-
protocol support). **Do not confuse with §2's hub-protocol constants (Crr=0.004,
CWa=0.51)** — confirmed 2026-07-28 straight from QZ's own protobuf schema
(`src/devices/zwifthubbike/Zwift hub.proto`, inline comments). Two different protocols,
two different observed constants — not a documentation error, just easy to conflate.

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

## 3.5 Wahoo proprietary control point (A026-family)

Wahoo trainers expose a proprietary CPS-extension control point (characteristics in the
`a026….` UUID family) predating good FTMS support. This is a possible third path on the
KICKR Core that this project has **never evaluated on our own hardware** (the Feb-2026
scanner special-cased `a026` services but no commands were tried —
`zwift-virtual-shifting.html:938`). Status on our hardware: still UNKNOWN (HYPOTHESES U9);
low priority — FTMS grade-solve and the Zwift hub protocol likely dominate. The QZ-side
mechanism itself, however, was fully read this session (2026-07-28 deep dive) and is now
CONFIRMED in detail:

- QZ's `src/devices/wahookickrsnapbike/wahookickrsnapbike.cpp` (1056 lines) drives a
  **Wahoo-proprietary Fitness Machine Control Point extension** — distinct decimal opcodes
  `_setErgMode=66, _setSimMode=67, _setSimGrade=70, _setWheelCircumference=72`
  (`wahookickrsnapbike.h:56-62`), **not** the standard FTMS `0x2AD9` opcode space
  (`ftmsbike.cpp` uses `0x11`/`0x05` on that separate characteristic) — the two paths
  write to different GATT objects entirely.
- `setWheelCircumference(double millimeters)` (`wahookickrsnapbike.cpp:220-227`): encodes
  `millimeters×10` (tenths of mm) as little-endian uint16, prefixed with opcode 72 (0x48).
  Default circumference is **2070 mm** ("700×18C" tire convention,
  `QZSettings::default_gear_circumference = 2070.0`, `qzsettings.h:2473-2474`) — **not**
  the more common 2105mm/2096mm ISO 700×23C/700×25C conventions.
- **Per-shift behavior is branched by device flag, correcting the prior framing that this
  is a uniform "wheel-circumference-per-shift" trick**: `wahookickrsnapbike.cpp:332-341`
  runs on every gear change, but for the literal **KICKR SNAP** hardware this same class
  also supports, it instead re-sends **grade** (`inclinationChanged`), not wheel
  circumference; the wheel-circumference rewrite applies only to the *other* Wahoo bikes
  this shared class handles (gated by `KICKR_BIKE`/`KICKR_SNAP` runtime flags). The
  class/file name ("snapbike") is misleading — it's a shared generic-Wahoo backend, not
  SNAP-specific.
- The underlying formula, `wheelCircumference::gearsToWheelDiameter()`
  (`src/wheelcircumference.h:29-38`): `return (gear_circumference / original_ratio) *
  current_ratio`, where `original_ratio = gear_crankset_size/gear_cog_size` (default
  42/14 = 3.0, the same reference constant as §2.4's `original_ratio`) and
  `current_ratio` comes from a configurable 12-gear crankset/cog table
  (`wheelcircumference.h:63-65`). It computes a **synthetic effective wheel
  circumference** that scales linearly with the selected gear's ratio relative to the
  42/14 reference — structurally a *virtual-circumference* trick, analogous in spirit to
  our own virtual-speed model but implemented by rewriting the trainer's own wheel-size
  parameter rather than computing a target grade/power. It is the **only caller** of
  `gearsToWheelDiameter` in the whole repo (confirmed via `gh api search/code`).
- **Comparison to our `v_virt = (cadence/60) × r_gear × wheel_circumference` convention**
  (DESIGN §4.3): `wheelcircumference.h` doesn't compute `v_virt` in software at all — it
  has no cadence input. Instead it pushes a synthetic *circumference* value to the
  trainer's own onboard wheel-circumference control so the trainer's firmware performs
  `speed = wheel_rps × effective_circumference` internally. The `r_gear` term in our
  target convention corresponds to `current_ratio/original_ratio` here, and our
  "wheel_circumference" term corresponds to the base `gear_circumference` setting (2070mm
  default) — same overall multiplicative structure, but pushed to hardware as an absolute
  value rather than computed in software.
- **Correction to the second-project attribution**: this doc previously cited
  [Berg0162/Kickr-Virtual-Shifting](https://github.com/Berg0162/Kickr-Virtual-Shifting) as
  a second implementation of the wheel-circumference trick. A direct read of that repo's
  physics-relevant files this session (`Utilities.cpp`, `FitnessMachine.cpp`,
  `CyclingPower.cpp` — see RESEARCH.md Track 2 cross-validation) found **no** reference to
  a Wahoo-proprietary control point or wheel-circumference rewriting: it applies a
  gradient-multiplier ("geared grade") model and forwards the result via **standard** FTMS
  `SetIndoorBikeSimulationParameters` or a CPS resistance update, structurally the same
  category as our own now-superseded `VirtualGear.applyToGradient`. **Treat the
  wheel-circumference attribution to that repo as unconfirmed/likely mistaken** pending a
  targeted read of any Wahoo-specific source file in that repo (none was found in the
  files checked) — QZ's `wahookickrsnapbike.cpp` remains the one CONFIRMED example of the
  technique.

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
