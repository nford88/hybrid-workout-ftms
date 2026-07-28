# External Research Synthesis (2026-07-28)

Four parallel research tracks. Byte-level details live in PROTOCOLS.md; this file keeps
the narrative findings and **all sources** so future sessions can re-verify claims.

---

## Track 1 — How Zwift implements virtual shifting

1. **Native mechanism = proprietary "Zwift protocol", not FTMS.** "Supporting Zwift's
   virtual shifting requires adding support for Zwift Protocol… FTMS compatibility alone
   doesn't enable virtual shifting" (Zwift Insider). On shift, the app sends the trainer
   a protobuf `HubCommand` with the new **gear ratio ×10000** (plus grade, wind, Crr,
   CWa, bike/rider weight); trainer firmware computes resistance locally (makinolo).
2. **Pre-native / third-party era used app-side approximations**: recompute target power
   and drive ERG, or rewrite the SIM grade — workable on any FTMS trainer but with felt
   latency; makinolo explicitly contrasts "sluggish" app-side vs "much, much more
   efficient" in-firmware computation. Rouvy adopted Zwift's own protocol in Feb 2025.
3. **The Click never talks to the trainer.** Click → app → trainer. Virtual shifting
   requires BLE/WiFi/Direct Connect (not ANT+).
4. **Math**: virtual speed = `(cadence/60) × gear_ratio × wheel_circumference`; road
   force = gravity + rolling + aero; power = force × speed; the trainer reports a
   **virtual** speed remapped through the ratio (SHIFTR docs, makinolo). Zwift's 24
   ratios span 0.75–5.49.
5. **Seamlessness** is architecture, not a filter: resistance loop runs in firmware; the
   chain/flywheel never move during a shift; only brake force is recomputed. DCR measured
   shifts as instant under full load. No public source documents a smoothing constant
   (INFERRED: flywheel momentum continuity + possibly a firmware ramp).
6. **Zwift Cog** = single 14 t cog + chain guides replacing the cassette; pins the
   physical ratio so firmware has one known flywheel↔pedal mapping; Zwift auto-detects
   the chainring. Works with a normal cassette left in one gear too (= our 34/17
   convention).
7. **Trainer support list** (Zwift Insider): Zwift Hub/Hub One; **Wahoo KICKR CORE**
   (+ Core 2 / Zwift One / KICKR v6 / Move — v4/v5 cannot); Tacx NEO 2/2T/3M; Elite
   Direto/Suito/Avanti/Justo; JetBlack Victory/Volt v2; Van Rysel D100.
8. **KICKR Core specifics**: firmware **v1.3.17 (2024-02-08)** added virtual shifting to
   all existing Cores; enabled platform-wide by Zwift Feb 7–8 2024. FTMS + Zwift service
   are advertised in parallel; ERG via FTMS still works for other apps with the Cog on.

Sources:
- https://zwiftinsider.com/virtual-shifting/
- https://zwiftinsider.com/virtual-shifting-support-status/
- https://zwiftinsider.com/kickr-core-firmware-v1-3-17/
- https://www.makinolo.com/blog/2024/10/20/zwift-trainer-protocol/
- https://www.makinolo.com/blog/2023/11/06/virtual-gear-shifting-in-indoor-training/
- https://github.com/JuergenLeber/SHIFTR + /blob/main/VirtualShifting.md
- https://www.dcrainmaker.com/2023/10/zwift-clicks-review.html
- https://www.dcrainmaker.com/2024/02/wahoo-kickr-review.html
- https://www.dcrainmaker.com/2025/02/rouvy-adds-zwift-cog-click-ride-virtual-shifting-battle-royale-begins.html
- https://support.zwift.com/en_us/virtual-shifting-faq-r16UiRFlT

## Track 2 — qdomyos-zwift (QZ): the working open-source implementation

Repo `cagnulein/qdomyos-zwift` @ master, 2026-07-28.

1. **Zwift controller client**: `src/zwift_play/` (ported from ajchellew's zaplibrary,
   PR #2089 Feb 2024). Plain `RideOn` ⇒ unencrypted; full AES-CCM/ECDH code present but
   `#if 0`-ed (`abstractZapDevice.h:10-15`). Click 0x37 parsing at
   `abstractZapDevice.h:51-295`; 500 ms auto-repeat; haptic ack via
   `12 12 08 0A 06 08 02 10 00 18 <pattern>`.
2. **Gear state**: `double m_gears` (`bike.h:111`); `setGears()` clamps 1–24 in
   Zwift-ratio mode and immediately re-sends the last resistance/inclination
   (`bike.cpp:208-314`).
3. **Three resistance paths** (`src/devices/ftmsbike/ftmsbike.cpp`):
   - (a) default: rewrite FTMS 0x11 grade, `slope += gearsModifier() × 50` ⇒ **+0.5 %
     grade per gear step** (additive — unlike our multiplicative model) (:1815-1950,
     `ftmsbike.h:125`);
   - (b) resistance-level offset for resistance-mode devices;
   - (c) **trainer-native Zwift hub protocol** when the trainer has the Zwift service
     (`gears_zwift_ratio`): hub handshake `RideOn 02 01` + `zwiftPlayInit()` (:203-240),
     protobuf `SimulationParam` inclination (:411-427), gear command
     `10000 × (ratio/original) × (42/14)` + apply `00 08 88 04` (:559-612); 0.4 %
     inclination must precede first gear cmd (:560-565); FTMS CP writes suppressed
     (:89-105).
   - Related: Wahoo-proprietary path re-sends wheel circumference per shift
     (`wahookickrsnapbike.cpp:332-388`).
4. **QZ can also emulate a Zwift Hub** (`virtualbike.cpp`, `zwift_play_emulator`):
   advertises the Zwift service to the real Zwift app and translates Zwift's gear/slope/
   power protobufs into FTMS for any trainer — the mirror image of what we want.
5. Gear ratio table presets incl. "Reality Bender (24 even spaced)" = Zwift's ratios
   (`gears.qml:191-218`); same ratios as protobuf varints in
   `characteristicwriteprocessor0003.cpp:60-125`.

Sources:
- https://github.com/cagnulein/qdomyos-zwift — key files: `src/zwift_play/*`,
  `src/devices/bike.{h,cpp}`, `src/devices/ftmsbike/ftmsbike.{h,cpp}`,
  `src/devices/wahookickrsnapbike/wahookickrsnapbike.cpp`, `src/wheelcircumference.h`,
  `src/virtualdevices/virtualbike.cpp`, `src/characteristics/characteristicwriteprocessor0003.cpp`,
  `src/gears.qml`; PR #2089; issues #2099, #3611, #3952, #4018, #4545, #4743, #4746
- https://robertoviola.cloud/2024/02/06/revolutionizing-indoor-cycling-qz-apps-integration-with-zwift-click/
- https://robertoviola.cloud/2024/09/16/zwift-ride-with-mywhoosh-indievelo-rouvy-and-much-more/

## Track 3 — Zwift Click BLE protocol (details → PROTOCOLS.md §1)

Headlines:
1. Service UUID verified char-for-char; **advertised UUID changed to 0xFC82 in Jan-2025
   firmware** (characteristics unchanged) — probe both.
2. Bare `RideOn` ⇒ unencrypted mode on all current firmware (discovery credited to
   cagnulein, Feb 2024); encryption is optional-by-handshake, AES-**CCM** (not GCM).
3. Click v1 buttons = type 0x37 frames, inverse logic; v2/Ride = 0x23 bitmap.
4. No client keepalive needed; **Click v2 has a ~60 s vendor-unlock disconnect** unless
   recently paired with real Zwift; Click powers off ~1 min unconnected.
5. **Web Bluetooth prior art exists and works**: lord's single-file web demo
   (requestDevice → FC82 → RideOn → parse 0x23) and BikeControl's shipped Flutter-web
   build (reads Click/Play buttons in-browser). On web, manufacturer data is unavailable
   at chooser time ⇒ detect variant from frame type.
   ⚠️ Do not misread BikeControl's README caveat "No controlling possible [in browser],
   though" — that refers to their *output* side (emulating a BLE peripheral / injecting
   keystrokes into Zwift), which browsers can't do. Our use case is central-role only
   (read Click, write trainer) and is fully supported.
6. No npm package exists for this (gap we'd fill in-repo).

Sources:
- https://github.com/ajchellew/zwiftplay (README; zaplibrary: ZapBleUuids.kt,
  ZapConstants.kt, AbstractZapDevice.kt, ZapCrypto.kt, ClickNotification.kt,
  ZwiftClickTest.kt) + PR #3 discussion (unencrypted-mode discovery, Click frames)
- https://www.makinolo.com/blog/2023/10/08/connecting-to-zwift-play-controllers/
- https://www.makinolo.com/blog/2024/07/26/zwift-ride-protocol/
- https://gist.github.com/lord/7a4e1fccf4ceb25943a5e08abe4a7f34 (working Web Bluetooth demo)
- https://github.com/jonasbark/swiftcontrol → https://github.com/OpenBikeControl/bikecontrol
  (constants.dart, zwift_device.dart, zwift_click*.dart, controller_keep_alive.dart,
  TROUBLESHOOTING.md, issue #68); web build: https://openbikecontrol.github.io/bikecontrol/

## Track 4 — FTMS spec + Web Bluetooth feasibility (details → PROTOCOLS.md §3–4)

Headlines:
1. FTMS v1.0 spec obtained (mirror onelap.cn/pdf/FTMS_v1.0.pdf) — 0x11 layout, control
   persistence, procedure serialization, ERG/SIM last-write-wins, Machine Status 0xFF,
   0x12 = wheel circumference (0x13 = spin down).
2. Trainer physics formula is convention (ftmsemu.github.io), not spec; **mass is
   trainer-internal** — the single biggest unknown for our grade-solve accuracy.
3. Zwift sends 0x11 ~continuously (~1 Hz, INFERRED); implements its own retry/timeout;
   felt latency 1–1.5 s (Berg0162/simcline). No primary source for a Wahoo-specific
   command-drop quirk.
4. Web Bluetooth: multi-device from one page proven (Auuki); one gesture per chooser;
   `getDevices()` persistence still flag-gated; custom UUIDs must be in
   `optionalServices`; macOS high-rate notification drops irrelevant at our rates;
   L2CAP/bonding out of scope (and not needed).

Sources:
- FTMS v1.0 spec mirror: https://www.onelap.cn/pdf/FTMS_v1.0.pdf
- https://ftmsemu.github.io/
- https://github.com/doudar/SmartSpin2k/discussions/296 (Zwift opcode sequences)
- https://github.com/Berg0162/Kickr-Virtual-Shifting (grade-remap virtual shifting)
- https://github.com/Berg0162/simcline (1–1.5 s latency measurements)
- https://blog.zwiftalizer.com/post/releasenotes-2022-02-24/ (FTMS resends)
- https://forums.zwift.com/t/lost-connections-log-entry-ftms-request-took-too-long-resetting-trainer-writing-for-help-w-multiple-recent-dropped-zc-to-zwift-app-connection/581285
- https://github.com/WebBluetoothCG/web-bluetooth/issues/195 (multi-connection)
- https://github.com/dvmarinoff/Auuki (production multi-device Web Bluetooth cycling app)
- https://github.com/WebBluetoothCG/web-bluetooth/blob/main/implementation-status.md
- https://developer.chrome.com/docs/capabilities/bluetooth
- https://github.com/electron/electron/issues/37090 (gesture consumption)
- https://lists.w3.org/Archives/Public/public-web-bluetooth-log/2019Jul/0001.html (#447 macOS drops)
- https://github.com/WebBluetoothCG/web-bluetooth/issues/137 (pairing gap)
- Android GATT limit: https://support.google.com/android/thread/43071437/

## Source conflicts (kept explicit, not silently resolved)

| Conflict | Resolution used |
|---|---|
| Handshake status bytes after `RideOn`: `01 02`/`01 01` (captures) vs `00 09` (decompiled docs) vs "don't matter" (ajchellew code comment) | Treat as don't-care on send; don't validate strictly on receive |
| AES-GCM (ajchellew README) vs AES-CCM (his code + makinolo) | CCM (code beats prose) |
| Click v2 manufacturer-data type codes: QZ heuristic vs BikeControl 0x0A/0x0B | Unresolved; irrelevant on web (no mfg data) — detect via frame type |
| Encryption "removed" (makinolo) vs "always optional" (cagnulein) | Moot: bare RideOn ⇒ plaintext on all current firmware |
| Encrypted-frame counter endianness LE (on-air) vs BE (ajchellew encrypt path) | Unresolved; encrypted mode is out of scope |
| Ride device name "Zwift Ride" vs "Zwift SF2" | Firmware-version difference; Click is consistently "Zwift Click" |
| KICKR v4/v5 virtual-shifting support: DCR (Feb 2024) "future/uncertain" vs Zwift Insider "cannot support the required protocols" | Zwift Insider is later and definitive; support never shipped. Irrelevant to the Core but shows support lists drift — re-check before citing them |
| Trainer naming: prototype notes say "KICKR Core V2" (hardware revision?) vs Wahoo's 2025 product "KICKR CORE 2" | Ambiguous which unit is on hand — HW-V1 records model + hardware revision (HYPOTHESES U11) |
