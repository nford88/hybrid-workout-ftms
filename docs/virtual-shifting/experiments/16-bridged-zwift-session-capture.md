# 16 — The bridged Zwift session, captured: the real handshake, and H28 falsified

**Date**: 2026-07-29
**Type**: Live capture + offline analysis. Zwift **game on the Mac**, bridged through Zwift
**Companion** on the phone, which held the BLE links to the KICKR Core and **both** Click V2
units. Two simultaneous taps: Android HCI snoop (BLE) and `tcpdump` on the Mac (the LAN leg).

**Evidence**:
- BLE: `captures/20260729-163837-bridge-ride.btsnoop` (+ manifest, + auto-generated report).
  36,620 frames / 127.6 min. Nine link sessions across three devices.
- LAN: `captures/zwift-bridge.pcap` — 7,141 packets / 72 s, phone ↔ Mac only.

**Reproduce**:

```bash
tools/ble-lab/android-capture.py --dir <bugreport-dir> --device f4:c4:59:81:d9:a1
```

This is the capture design from [`15`](15-zwift-app-click-session.md) §6.0, and it worked:
the bridge put an **authorised game session's** BLE traffic on the phone, where our capture
route is proven.

---

## Verdict on the five pre-registered predictions

| # | Prediction | Result |
|---|---|---|
| P1 | A **write to `0100` and/or `0101`** appears | ❌ **FALSIFIED.** Zero payload writes to `0100`/`0101`/`0102` on any of the four Click links. All three characteristics only ever receive a **CCCD subscribe** (`0100` to handles `0x0024`/`0x0028`/`0x002c`) |
| P2 | A `RideOn` write to `0003` and an **indication back on `0004`** | ✅ **CONFIRMED — and it corrects our own docs.** Zwift writes **`RideOn 02 03`** (8 bytes, not the bare 6), and the Click indicates **`RideOn 02 03`** back on `0004` |
| P3 | **Button notifications on `0002`** carrying `0x23` frames per `04`'s mapping | ✅ **CONFIRMED exactly.** Idle `23 08 ff ff ff ff 0f`; presses clear `0x01` LEFT, `0x02` UP, `0x04` RIGHT, `0x08` DOWN, `0x20` Right "+" |
| P4 | The link **survives past 90 s** with the game session live | ✅ **CONFIRMED, decisively.** 310 s / 127 s / 110 s, all three still up at capture end, and **not one supervision timeout in the entire bridged session** |
| P5 | `0102` stays silent | ✅ **CONFIRMED.** Zero notifications or indications on `0102` across all four Click links; only its CCCD is ever touched |

---

## 1. H28 is falsified — and H16's mechanism is not what we thought either

The Click that stayed connected (`f4:c4:59:81:d9:a1`, ACL handle `0x0004`) went **225.8 seconds
with zero ATT traffic in either direction** — from `+17.0 s` (right after its `RideOn`) to
`+242.9 s` (the first button press) — **and did not drop.** It was still up when the capture
ended, 310 s after connecting.

> **H28 (the Click sleeps its radio when no ZAP traffic flows) is FALSIFIED.** 226 s of total
> silence is three times the 73.5 s drop and four times the bottom of the 44–90 s band. Traffic
> volume is not what keeps the link alive.

Nor is it a phone-side or authorisation-timer effect in the way H16 framed it. Compare the two
Companion sessions in the *same* snoop file:

| Session | `RideOn` sent? | Idle time | Outcome |
|---|---|---|---|
| 14:46, Companion alone, no game | **no — never sent** | 70 s | **dropped at 73.5 s, HCI `0x08`** |
| 16:31, Companion bridging a live game | **yes, `RideOn 02 03` at +17 s** | **226 s** | **still up at +310 s** |

Every other teardown in the bridged session was `0x16` **Connection Terminated By Local Host** —
Companion deliberately hanging up during pairing churn — plus one `0x3e` failed-to-establish.
**The only `0x08` supervision timeout in the whole 127-minute file is the handshake-less
14:46 session.**

### H29 — the handshake is the keep-alive

> **H29**: what keeps a Click V2 link alive is **completing the ZAP handshake**, not an
> authcode, not a Zwift-server session, and not traffic volume. A connection that subscribes
> but never writes `RideOn` is dropped by the device in the 44–90 s band; one that completes
> the handshake survives long idle periods.

This is much better news than either H16 or H28, because **our harness already sends `RideOn`**
— it just sends a *different* one. See §2.

**The one loose end**: `03`'s pre-sync drops happened to a harness that *did* send bare
`RideOn` and still dropped at 44–90 s. If H29 is right, the 2-byte difference in §2 is the
explanation. If a bare `RideOn` also holds the link, then H29 is incomplete and something else
in Zwift's sequence matters (candidates, in order: the `02 03` suffix, the `0300` CCCD values,
or the `FF 04 00` write of §3).

---

## 2. Zwift sends `RideOn 02 03`, not a bare `RideOn` — correcting PROTOCOLS §1.3 and H15

Observed on **both** Click units and on the **trainer**:

```
CLICK  (h0x004f equivalent, char 0003)  TX  52 69 64 65 4F 6E 02 03   "RideOn" + 02 03
CLICK  (char 0004, indication)          RX  52 69 64 65 4F 6E 02 03   echoed identically
TRAINER (char 0003)                     TX  52 69 64 65 4F 6E 02 03   same 8 bytes
TRAINER (char 0004, indication)         RX  52 69 64 65 4F 6E 02 02   ← 02 02, NOT a mirror
```

Our `PROTOCOLS.md` §1.3 and H15 record that *"our Clicks echo a **bare** 6-byte `RideOn`, no
status bytes"*, and dismiss the "+2 status bytes" reading as *"Play-era"*. Both statements are
**artefacts of our own client**: we send 6 bytes, so we get 6 back. Zwift sends 8. The
community-reported `02 03` variant our docs set aside is exactly what Zwift uses on Click V2
fw 1.2.0.

The trainer's `02 02` reply is an independent cross-check on an old observation: the Feb-2026
prototype log baked into `src/dev/zwift-virtual-shifting.html:318-331` recorded
`52 69 64 65 4F 6E 02 02` from the trainer (H3's evidence). That number was right, and the
reply is **not** a simple echo — the trainer answers `02 02` to a `02 03` request.

**Immediate action**: change our handshake write from `RideOn` to `RideOn 02 03` and re-time the
drop. Two bytes, and it is the leading candidate for the whole 44–90 s problem.

---

## 3. `FF 04 00` is real — `13`'s central prediction confirmed

On the other unit (`f4:c4:59:3d:51:a6`, handle `0x000a`), after the handshake and a set of
hub-style queries:

```
+8.18  RX  NOTIFY 0002   ff 03 00 0a 21 03 ce78f431…   ← 33-byte compressed P-256 key (0x21 03)
+8.61  TX  WRITE  0003   ff 04 00                       ← Companion's reply
```

[`13`](13-ff-family-frame-decode.md) decoded the `FF 03` frame from our own captures and argued
that `PROTOCOLS.md` §1.5's `FF 04 00` was *"an empty-bodied assertion we have never sent"*,
testable in minutes. **It is now confirmed as real Zwift behaviour**, sent in direct response to
the device's `FF 03` challenge, ~0.4 s later.

Note the asymmetry between the two units: `3d:51:a6` received the full sequence (`RideOn 02 03`
→ hub queries → `FF 03`/`FF 04 00` → buttons → battery), while `81:d9:a1` got only
`RideOn 02 03` → buttons. **Both units were connected simultaneously**, each on its own ACL
link — Zwift does not rely on the Left/Right relay that `04` found; it connects both directly.

---

## 4. The trainer: Zwift used the hub protocol and Wahoo proprietary, not FTMS

The bridged trainer link (`0x0009`, 127 s) subscribed to **everything** — FTMS (`2AD2`, `2AD9`,
`2ADA`, `2AD3`), Cycling Power (`2A63`, `2A66`), Wahoo proprietary (`a026e002/e004/e005/e023/
e037`) and the Zwift service (`0002/0003/0004`) — then:

```
+5.88  TX  Zwift 0003   52 69 64 65 4F 6E 02 03      RideOn 02 03
+6.00  RX  Zwift 0004   52 69 64 65 4F 6E 02 02      RideOn 02 02
+5.88  TX  Wahoo e037   33                            proprietary cmd 0x33
+6.00  RX  Wahoo e037   fe 33 01 26 00000026 000000   response: fe <cmd> 01 <data>
+6.12  TX  Zwift 0003   00 08 00                      HubRequest
+6.13  TX  Wahoo e037   3c 02                         proprietary cmd 0x3c
+6.39  RX  Zwift 0004   3c 08 00 12 2d … "KICKR CORE" … "40244902"   device info
+6.48  RX  Wahoo e037   fe 3c 01 02 39 98
+6.63  TX  Zwift 0003   00 08 10   (×3, to +8.57)     HubRequest DataId 0x10
+20.88 TX  Zwift 0003   41 08 05                      ← the mystery 0x41 command
+21.06 RX  Zwift 0004   3e 08 41 10 02                ← response referencing cmd 0x41
```

Two findings for the ledger:

- **`41 08 05` is genuinely sent by Zwift.** `U14` flagged it as a command code appearing in
  QZ's recipe that matches nothing in the `Zwift hub.proto` schema, and asked whether it is
  required or vestigial. It is **not a QZ invention** — real Zwift sends it, and the trainer
  answers `3e 08 41 10 02` (a `0x3e` response carrying field 1 = `0x41`, field 2 = `0x02`).
  Whether it is *required* is still open.
- **The FTMS Control Point (`2AD9`) was never written** — subscribed for indications and
  nothing else. In the 127 s captured, Zwift read data over FTMS `2AD2` (123 notifications) but
  did all *control* over the Zwift service and the Wahoo proprietary characteristic.
  ⚠️ **Do not over-read this**: 127 s of what may have been flat, un-shifted riding is not
  proof that Zwift never uses FTMS control on this trainer. It does establish that FTMS control
  is not required for a working Zwift session on a KICKR Core, which bears on `U9`.

---

## 5. The LAN leg is encrypted

The Companion↔game bridge, measured on the Mac:

| Property | Value |
|---|---|
| Transport | **TCP**, phone listens on **port 21588**, the Mac connects from an ephemeral port |
| Framing | 4-byte **big-endian length prefix**, then payload (`00000072` → 114 bytes, `00000046` → 70) |
| Volume | 3,381 segments / 482 KB phone→Mac; 352 segments / 39 KB Mac→phone, over 72 s |
| Keepalive | 1,486 single-byte `00` segments, phone→Mac |
| TLS? | **No** — not one segment starts with a TLS record header |
| **Entropy** | **7.74 bits/byte** phone→Mac, **7.91** Mac→phone — **encrypted or compressed** |
| Plaintext markers | `RideOn`: 0. `0x23` button frames: 0. Device serials: 0 |

So the bridge is **encrypted at the application layer** — no plaintext authcode, and the ZAP
frames are not relayed verbatim. The hope from `15` §6.0 that the game might hand Companion an
authcode in the clear does not survive.

⚠️ **Caveat on the timing**: the two captures do **not overlap**. The pcap runs 16:44:19–16:45:31
and the BLE capture ended 16:37:02, so the LAN capture shows **steady-state bridging, not the
pairing moment** where a handoff would occur. The encryption finding holds regardless and makes
capturing that moment unpromising — but strictly, "no authcode crosses the LAN at pair time"
is untested.

---

## 6. Correction: the snoop buffer is far bigger than "~7 minutes"

Recorded in `11` and repeated in every runbook since: *"the snoop log is a rolling ~7-minute
buffer — run the bugreport immediately."* **This capture is 5.6 MB spanning 127.6 minutes**, and
it contains the 14:46 session from two hours earlier. The rollover is evidently size-based and
the practical window is far more forgiving. Keep pulling promptly — but a few minutes' delay is
not fatal, and an old session may still be recoverable.

---

## 6b. Two things found while building the H29 test rig

**`2A25` Serial Number String is unreachable from Web Bluetooth — permanently.** It is on the
[Web Bluetooth GATT blocklist](https://github.com/WebBluetoothCG/registries) as a device
identifier, so Chrome refuses the read (`SecurityError`) *and* hides the characteristic from
`getCharacteristics()`. The Device Information service therefore appears to contain only
`2A26`/`2A27`/`2A29` in a browser, while the phone's capture shows `2A25` sitting right there at
handle `0x0014` with the value `0A-34C45981D9A1`. This is a genuine Tier-1/Tier-2 difference to
record in `CONNECTION-RECIPE.md`: **a browser cannot read the Click's serial, so it cannot
identify which physical unit it is talking to by that route.**

Two routes that do work, both now in `src/dev/ble-lab.html`:

- `device.id` — Chrome's opaque, origin-scoped device identifier. Not an address, but stable
  per unit, which is all the A/B needs ("same unit as the last arm?").
- **Sniff the serial off the air.** `FF 05` frames carry it as bare ASCII hex and the `3c`
  device-information reply carries it as `0A-…`/`0B-…` (§3, §4). Passive — no extra writes, so
  it cannot perturb a survival measurement. Verified against both real captured frames:
  `34C4593D51A6` → `f4:c4:59:3d:51:a6`.

**A pre-existing bug in the debug page's GATT tree**: it printed `[]` for every
characteristic's properties. `BluetoothCharacteristicProperties` is a WebIDL platform object
whose attributes live on the prototype, so `Object.entries()` returns nothing. Every GATT dump
this page has ever produced had an empty properties column — including the ones used to reason
about which characteristics are writable. Fixed by naming the nine properties explicitly.

## 7. Follow-ups

1. **⭐ The H29 A/B from our own harness** (§2). `npm run dev:ble`. **Three** arms, not two —
   the middle one was missed in the first design and is the actual control:

   | Arm | What the harness does | Predicted by H29 | Result |
   |---|---|---|---|
   | **0 — no handshake** | connect + subscribe, write nothing | drops in the 44–90 s band (replicates both `03` and the 14:46 Companion session) | ✅ **dropped after 60.4 s** (2026-07-29, ~45 min after the authorised Zwift session; LED still flashing; no `FF05`/`3c` frame ever arrived) |
   | **A — bare `RideOn`** | connect + subscribe + the 6-byte write every earlier experiment used | ambiguous: this is what `03` did, and `03` dropped | ⏳ run on the chatty unit only — see below |
   | **B — `RideOn 02 03`** | connect + subscribe + the 8 bytes Zwift sends | **holds past 90 s idle** | _to fill — needs the silent unit_ |

   **Second bench run, chatty unit `f4:c4:59:3d:51:a6` (2026-07-29 16:22–16:28).** Connected
   16:22:10.7; **no handshake written for the first 316.6 s**, and the link stayed up the whole
   time on nothing but its own ~5.1 s battery notifications. A bare 6-byte `RideOn` was then
   written at 16:27:27.3 and the link was still up at 356 s.

   - **H29 is not universal.** This unit needs **no handshake at all** to hold a link for 5+
     minutes — 5× the silent unit's 60.4 s. Whatever holds a link up, it is not *only* the
     handshake, and the two units differ at baseline in exactly the way §"THE UNIT IS A
     VARIABLE" describes. The decisive B arm must be run on the **silent** unit.
   - **A bare `RideOn` is functionally sufficient.** Before it: battery notifications only.
     Within 0.5 s of it: the `2a` initial-status frame, an `FF 05` frame carrying the serial,
     and then continuous `0x23` button frames at ~10 Hz. Button bits decode exactly per `04`
     (`0x01` LEFT, `0x02` UP, `0x04` RIGHT, `0x08` DOWN). So the 8-byte form is **not** required
     to get working button input — whatever `02 03` buys, it is not basic function.
   - **The echo mirrors the request, confirmed from our side**: we wrote 6 bytes, the device
     indicated exactly 6 back. §2's reading holds.
   - **The `FF 03` challenge is ephemeral, and it fires for us too.** It arrived 4.5 s after our
     bare handshake: `ff 03 00 0a 21 02 08 33 0d 0a 51 67 96 …` — again a 33-byte compressed
     P-256 point, but with parity prefix **`02`** where the bridged capture saw **`03`**, and
     entirely different key bytes. A fresh ephemeral key per session, not a static device
     identity. **We have never answered it**; Zwift answers `ff 04 00` within 0.43 s (§3).

   Arm 0 matters because without it, "A dropped" cannot be distinguished from "connecting at all
   drops". Run each arm with **no paddle presses** (idle survival is the measurement) and a
   ~240 s ceiling — Zwift's own link held 226 s idle, so 240 s is a meaningful ceiling rather
   than an arbitrary one. Note time since the last Zwift session, which is H16's variable.

   Outcomes: **0 and A drop, B holds** ⇒ H29 confirmed and the drop problem is solved.
   **All three hold** ⇒ confounded by recent authorisation; repeat after ~24 h.
   **All three drop** ⇒ H29 dead; next candidates are the `0300` (notify+indicate) CCCD values
   Zwift uses on `0002`/`0004`, then the `FF 04 00` write of §3.

   **Arm 0 lands a second blow on H16.** The unit had completed a fully authorised Zwift game
   session **~45 minutes earlier**, and the link still died at 60.4 s from our harness. If
   authorisation recency were what holds a link up, this one should have held. It did not — so
   the "pair once with real Zwift and third-party clients work" mechanism cannot be the whole
   story, and, usefully, **the recent-authorisation confound that would have muddied arms A and
   B is gone**: whatever they show is not an artefact of the Click being freshly authorised.
   Arms A and B are therefore interpretable now, without waiting 24 h.

   Also worth noting: **no `FF 05` or `3c` frame arrived in those 60 s**, so passive unit
   identification never fired. Consistent with `16` §3, where those frames only appeared *after*
   the handshake and hub queries — identification should start working once a handshake lands.

   **THE UNIT IS A VARIABLE — the two Clicks behave differently at baseline** (2026-07-29,
   discovered mid-run). Arm 0 was repeated on the *other* physical unit and did **not**
   reproduce:

   | Unit (`device.id`, origin-scoped) | Self-generated traffic | Arm 0 (no handshake) | LED |
   |---|---|---|---|
   | `Q6UrXvg0R0qL…` — silent unit | **none at all** in 60 s | **dropped at 60.4 s** | kept flashing |
   | `FRE0NVCUqf1o…` — chatty unit (user's "LEFT") | **`2A19` battery notification every ~5.1 s, unprompted** | **still up past 84 s** | **went solid, with no handshake sent** |

   The chatty unit's ~5.1 s battery cadence matches `3d:51:a6` in the bridged capture (§3), and
   the silent unit's total quiet matches `81:d9:a1` there — so this is the same asymmetry seen
   over the air, not a browser artefact.

   Three consequences:

   - **The A/B must be run per unit.** A survival number from one unit cannot be compared with
     one from the other, and the first arm-0 result (60.4 s) belongs to the silent unit only.
   - **The silent unit is the better test bed**: it has a clean, reproducible ~60 s failure and
     generates no traffic of its own, so an idle window is genuinely idle. The chatty unit's
     unprompted battery stream makes "idle survival" unmeasurable on it by construction.
   - **The LED is not a handshake indicator.** It went solid on the chatty unit with **no
     handshake written**, so it tracks something closer to "connected and claimed" than "ZAP
     session established". Do not use it as a proxy for handshake state.

   This also refines the H28/H29 picture rather than settling it. The honest current reading:
   **either self-generated traffic or a completed handshake appears sufficient to hold a link,
   and the silent unit with neither dies at ~60 s.** That is consistent with every observation
   so far — including the capture's 226 s idle hold, which followed a handshake on the silent
   unit — but it means H29 is only established once arms A and B run **on the silent unit**.

   ⚠️ `device.id` is opaque and **origin-scoped**: it is stable for a unit on
   `http://localhost:3000` but will change if site data is cleared or the origin differs. Record
   it per session rather than treating these two strings as permanent names.

   **Third bench run, same chatty unit, 2026-07-29 16:22–16:43+.** The link reached
   **20.6 minutes** and was still up — with only a bare `RideOn` written at +317 s. On this
   unit the drop problem simply does not exist.

   - **First end-to-end shift decode from a browser this session**: `23 08 ff fd ff ff 0f` →
     bitmap `0xFFFFFDFF`, i.e. bit **`0x100`** cleared → `shiftDown`. That matches `H18`/`04`
     exactly (Left "−" = `0x100`, *not* the community table's `SHFT_DN_L` `0x400`), and
     `zapFrame.js`'s `OUR_CLICK_PADDLES` mapping produced the right answer unmodified.
   - **The `ff 04 00` test did NOT happen**, though the log looks like it did. At 16:41:58 a
     `[controller/write] Zwift SYNC RX (write)` line appears **with an empty payload**: the hex
     box was empty, `parseHexInput` returned a zero-length array, and a legal **zero-byte write**
     went to the device. `toHex([])` is `''`, so the log line is indistinguishable from a
     successful send. **`ff 04 00` remains unsent from a browser.**

   Three defects fixed as a result (`src/dev/ble-lab.html`):

   1. **Empty hex box → silent zero-byte write.** Now refused with
      `nothing to send — the hex box is empty`.
   2. **Odd digit count → silently corrupted final byte** (`parseInt` of one nibble, `NaN` → 0
      in a `Uint8Array`). Now refused, naming the digit count.
   3. **A literal `NUL` byte in the serial sniffer's placeholder string** (`: '\0'` where a
      space was intended). Functionally harmless — `NUL` still separates hex runs for the
      regex — but it broke Vite's HTML parsing outright: `Unable to parse HTML; parse5 error
      code unexpected-null-character`. Both raw-hex handlers, controller and trainer, now go
      through the validating parser.

   **Phase 1 button map — LEFT unit `f4:c4:59:3d:51:a6`, 2026-07-29 16:53** (browser, after
   `RideOn 02 03`; every press counted exactly once despite ~10 Hz frames, so the edge
   detection is validated on real hardware):

   | Bit | Physical control (observed) | Community table says | Agrees? |
   |---|---|---|---|
   | `0x1` | D-pad **Left** | LEFT | ✅ |
   | `0x2` | D-pad **Up** | UP | ✅ |
   | `0x4` | D-pad **Right** | RIGHT | ✅ |
   | `0x8` | D-pad **Down** | DOWN | ✅ |
   | `0x100` | **"−" paddle** (fires `shiftDown`) | **Z** | ❌ — it is the paddle, not a face button |

   That completes the Left unit: four D-pad directions plus the "−" paddle, five bits, and no
   others fired. It re-confirms `H18`/`04` independently (Left "−" = `0x100`, *not* the
   community `SHFT_DN_L` = `0x400`).

   **It also exposes a conflict inside our own docs.** `zapFrame.js` comments say *"the
   D-pad/face-button entries (LEFT/UP/RIGHT/DOWN/Y/Z/A) do match our captures"*, but the
   community table assigns **`Z = 0x100`** — and `0x100` is demonstrably our Left "−" paddle,
   twice over. So either the Right unit has no button on `0x100`, or the "Y/Z/A match" claim is
   wrong. **Pressing the RIGHT unit's buttons while connected only to the Left settles it, and
   simultaneously re-tests `H17`'s relay claim** — that half of Phase 1 has not been run yet.

   Also confirmed this run: `RideOn 02 03` written from a browser is echoed back **identically**
   (8 bytes each way), and the `FF 03` key differs again from both previous observations
   (`0a 21 02 06 25 8a b5 …`), so it is ephemeral per *connection*, not per session or per unit.

   ### Phases 2–3 RESULT — H29 falsified, `FF 04 00` falsified, and a hard ~61 s timer

   Silent unit `f4:c4:59:81:d9:a1`, five consecutive runs, 2026-07-29 16:56–17:02. Every
   handshake was written successfully and **echoed back correctly** (`02 03` → `02 03`, bare →
   bare), so the device was responsive in every run.

   | # | Handshake written | Extra writes | **Link held** |
   |---|---|---|---|
   | 1 | `RideOn 02 03` @ +9.7 s | — | **60.7 s** |
   | 2 | `02 03` @ +2.9 s, then **bare** @ +11.2 s | — | **60.8 s** |
   | 3 | `RideOn 02 03` @ +3.7 s | — | **60.5 s** |
   | 4 | **bare** `RideOn` @ +3.6 s | — | **61.0 s** |
   | 5 | `RideOn 02 03` @ +5.1 s | **`ff 04 00` @ +9.4 s and +37.1 s** | **61.2 s** |

   - **H29 is FALSIFIED.** The handshake keeps nothing alive on this unit. `02 03` and bare
     produce identical outcomes, and the §2 two-byte difference — the most promising lead this
     project had — buys **nothing**.
   - **`FF 04 00` is FALSIFIED as a keep-awake.** Run 5 sent it twice, from a browser, on a
     live handshaken link, and the drop came at 61.2 s like every other run. This kills
     [`13`](13-ff-family-frame-decode.md)'s central actionable prediction and
     `CONNECTION-RECIPE.md`'s step 10.
   - **The drop is a hard timer, not flakiness**: 60.5 / 60.7 / 60.8 / 61.0 / 61.2 s — a spread
     of **0.7 s across five runs**. Nothing that varied (handshake form, write count, time to
     first write) moved it. That is a designed timeout being enforced.

   ### The real difference is the unit, and it looks like the relay role

   The silent unit, after a *correct* handshake with a *correct* echo, published **nothing**:
   no `0x23` button frames, no battery notifications, not even the `2a` initial-status frame the
   other unit sends within 0.5 s. It emitted exactly one `FF 05` frame and then went quiet until
   the timer fired. The two units' `FF 05` status frames do not merely differ in value — they
   carry **different protobuf fields entirely**:

   | | serial | f2 | f3 | f4 | f5 | f6 | f7 |
   |---|---|---|---|---|---|---|---|
   | **Silent** `81:d9:a1` | `34C45981D9A1` | **8** | **95** | — | — | — | — |
   | **Chatty** `3d:51:a6` | `34C4593D51A6` | — | — | **100** (= its battery %) | 255 | 2844 | 0 |

   > **H30 (new, leading)**: the silent unit is the **secondary of the relay pair** described by
   > `H17`/`04`, and the chatty unit is the **primary**. A direct connection to the secondary has
   > no role — its inputs are published through the primary — so the device treats the link as
   > idle and sleeps it on a ~61 s timer. The 44–90 s "drop problem" that has driven this entire
   > investigation may simply be **the symptom of connecting to the wrong Click**.

   Supporting fit: the primary streams buttons at ~10 Hz, battery every ~5 s, and has now held a
   browser link for **20+ minutes**; the secondary streams nothing and dies at 61 s every time.
   `04` already found that pressing the *other* unit's buttons produces frames on the primary's
   connection.

   **The one measurement that settles it** is the half of Phase 1 not yet run: with a browser
   connected **only to the primary**, press the **secondary's** buttons and see whether they
   arrive. If they do, the product answer is simply *"connect the primary"*, no unlock, no
   keepalive, no authcode — and `R2`/`H16` stop being risks at all.

   **Free session-state indicator, spotted at the bench**: the Click's **blue LED flashes** while
   it is advertising / unclaimed, even while a GATT link is established and subscribed. If it
   goes solid after a handshake, the LED is a direct physical read-out of the very session state
   H29 posits — worth recording per arm alongside the survival time.
2. **`15` §6.1's idle-vs-active A/B is no longer needed as stated** — H28 is already falsified by
   §1. Re-scope it to *handshake* vs *no handshake*, which is what actually varies.
3. **Read the three `2901` User Descriptions** (`15` §6.2) — still unread by anyone, and now
   more interesting: Zwift subscribes to all three of `0100`/`0101`/`0102` and writes to none of
   them, so what are they for?
4. **A longer trainer capture with real gradient changes**, to settle whether Zwift ever uses
   FTMS control on this KICKR (§4) and to see gear-ratio commands on the wire.
5. If the LAN leg is ever revisited, capture **from before Companion pairs**, so the pcap covers
   the handoff moment (§5 caveat).

---

## Confidence

| Claim | Confidence |
|---|---|
| P1 falsified — no payload write to `0100`/`0101`/`0102` in an authorised session | **CONFIRMED** — all writes resolved to CCCD handles `0x0024`/`0x0028`/`0x002c` |
| Zwift writes `RideOn 02 03`; Click echoes `02 03`, trainer answers `02 02` | **CONFIRMED** — raw ATT PDUs on three separate links |
| H28 (idle timeout) falsified | **CONFIRMED** — 225.8 s of zero ATT traffic with no drop, same file, same phone |
| H29 (handshake is the keep-alive) | **INFERRED, strong but untested.** Two sessions differing in exactly this respect, one dropped and one did not — but n=1 each way, and `03`'s bare-`RideOn` drops are unexplained until §7.1 runs |
| `FF 04 00` is real Zwift behaviour, replying to `FF 03` | **CONFIRMED** — packet-level, 0.43 s apart |
| `41 08 05` sent by real Zwift, trainer responds | **CONFIRMED** |
| FTMS Control Point never written | **CONFIRMED for the 127 s captured**; NOT evidence about longer/hillier sessions |
| Both Click units connect simultaneously, treated differently | **CONFIRMED** — separate concurrent ACL links, different message sequences |
| LAN bridge is encrypted, TCP/21588, 4-byte length framing | **CONFIRMED** — entropy 7.74/7.91 bits/byte, zero plaintext markers |
| "No authcode crosses the LAN" | **NOT ESTABLISHED** — the pcap misses the pairing moment (§5) |
