# 03 — Zwift Click Button Mapping (Partial — Paused)

**Date**: 2026-07-28
**Status**: **PAUSED, not abandoned.** Deprioritized in favor of trainer-side FTMS/shift-
primitive work (the mission's core deliverable). Resume as a deep-dive later. Raw data
below is real and worth keeping — don't re-derive from scratch next time.

## Hardware

Two Click v2-family units confirmed (see `02-firmware-model-check.md`): "Zwift Click
Left" (MAC `...5106`, physical layout: D-pad + "−" paddle) and "Zwift Click Right" (MAC
`...D9a1`, physical layout: Y/Z/A/B face buttons + "+" paddle) — see user-provided product
photo, 2026-07-28. Both fw 1.2.

## What got confirmed

1. **Frame grammar is v2/Ride-family (type `0x23` bitmap), not v1 (`0x37`)** — resolves
   part of U2. Idle/all-released frame observed as `23 08 ff ff ff ff 0f` (bitmap
   `0xFFFFFFFF`), exactly matching the documented all-released value.
2. **RideOn handshake echoes bare** — writing `52 69 64 65 4f 6e` to SYNC RX produced an
   indication on SYNC TX of the *same 6 bytes*, no status-byte suffix (docs expected
   `RideOn` + 2 bytes, e.g. `02 03` for v2). Minor discrepancy from community sources;
   low-stakes since those bytes were already documented as don't-care.
3. **Right controller's "+" paddle = bit `0x20`** — confirmed twice, clean single-press
   signature (~180ms high→low→high), at `2026-07-28T13:41:49.282Z` and
   `2026-07-28T13:53:10.248Z`. Notably, `0x20` is labeled `B` in the community mask table
   (borrowed from Zwift Play reverse-engineering) — **the physical "+" paddle on this
   Click hardware does not use the community-documented `SHFT_UP_R` bit (`0x2000`) at
   all.** Zwift appears to have wired Click's two dedicated paddles onto bit positions
   that Play's reverse-engineers had named for face buttons. Don't trust the borrowed
   names — build our own truth table from captured fixtures once we resume this.
4. **A recurring single-bit blip, `0x1000` (named `ONOFF_L` in the borrowed table),
   appears every ~5–20s during idle**, always clearing then immediately reverting within
   1-2 frames. Very likely an idle-heartbeat artifact riding in the bitmap frame format,
   not a real button press — nobody was pressing anything during most of its occurrences.
5. **Other bits observed but not confidently attributed to a specific button/press**,
   because multiple reconnects happened between presses and it was never fully clear
   which physical unit (Left or Right) was connected at each moment: `0x80`, `0x40`,
   `0x10`, `0x100` (each seen as a clean tap-shaped transition). `0x100` appeared twice in
   one otherwise-clean session (2026-07-28T14:02:13–18Z, tap then ~1s hold) with no `0x20`
   alongside it — plausibly Left's "−" paddle, given it was a different session than the
   confirmed-Right ones, but **this was never confirmed** (session disconnected before the
   user could confirm which unit was connected).

## What got in the way

- **Web Bluetooth only connects one physical device per `requestDevice()` gesture** —
  confirmed operationally (not just from docs). Characterizing both Left and Right
  requires two entirely separate connect actions, and the harness only has one
  "controller" GATT slot, so switching between them mid-session is manual and error-prone
  (easy to lose track of which unit is actually connected, since `device.name` reports the
  same generic `"Zwift Click"` regardless of which physical unit).
- **Frequent disconnects, ~44–90s after connecting**, with heavy `requestDevice()` chooser
  friction in between (repeated cancelled-chooser errors). Timing is consistent with the
  documented Click v2 "~60s without a recent real-Zwift-app unlock" vendor-lock behavior
  (R2/U2/HYPOTHESES H16), though this was never isolated as a clean single-variable test.
- **The real-Zwift-app-pairing workaround: now looks like it actually worked.** User
  paired both units in Zwift Companion, disconnected there, and reconnected via the
  harness at `14:01:39`. That connection **held for 5+ minutes straight** (steady battery
  notifications every ~5s, zero drops through at least `14:07:02`) — far past every prior
  session's ~45-90s cutoff. One brief scare (a cancelled-chooser error at `14:04:50` from
  an unrelated second connect attempt) didn't affect it. **New raw evidence captured
  right after this connection's RideOn handshake** — the documented "0xFE disconnect-
  warning family" frames (PROTOCOLS.md §1.4), byte-for-byte:
  - `ff 05 00 fa 05 18 0a 0c 33 34 43 34 35 39 33 44 35 31 41 36 20 64 28 64 30 af 16 38 af 16`
  - `ff 05 00 ea 05 19 0a 0c 33 34 43 34 35 39 33 44 35 31 41 36 10 00 18 f0 03 20 01 28 04 30 00`
  Both embed the ASCII hex string `34C4593D51A6` (12 hex chars — a device serial/ID,
  wrapped in a length-delimited protobuf field), plus small integer fields (one decodes to
  496) that are plausibly some kind of unlock/session countdown — not decoded further, but
  this is exactly the frame family the docs predicted precedes a lock-related disconnect,
  captured intact for once instead of just seeing the disconnect itself.

## Conclusion

**HW-V2/V3/V4/V5/V6 (Click characterization): PAUSED, partially answered.** Enough is
known to build a *provisional* input adapter later (v2 bitmap grammar, RideOn handshake,
Right "+" = `0x20`), but the full Left/Right button table and a real fix for the
disconnect behavior are open. Not blocking the higher-priority work below.

## Confidence

**CONFIRMED**: frame grammar (v2/`0x23`), RideOn echo behavior, Right "+" = `0x20`.
**INFERRED**: `0x1000` = idle heartbeat artifact; `0x100` = possibly Left "−"; the
real-Zwift-app unlock workaround extends session life (strong positive signal — one
clean before/after pair, not a controlled repeated test).
**UNKNOWN**: full Left button table; exact meaning of the `0xff05`/`0xff...ea05` frame's
numeric fields; root cause of the original disconnect cadence.

## Addendum (user confirmation, later in session)

The user confirmed this isn't just a workaround for when connections happen to be flaky —
**pairing/syncing the Click in the real Zwift Companion app is a required first step**
before any third-party BLE client (including our harness) gets a usable connection at
all. Treat as mandatory onboarding UX for the eventual production feature, not an
edge-case fallback. Updated in `GOALS.md` non-goals and `RISKS-ROADMAP.md` R2.

## Follow-ups (for whenever this deep-dive resumes)

- Redo Left characterization with the harness modified to show which MAC/unit is
  connected (or at minimum, log the exact button pressed immediately in the chat before
  checking, to avoid the attribution ambiguity that cost most of this session).
- Consider extending the harness with a second controller GATT slot so Left and Right can
  both stay connected simultaneously (we already know 2 concurrent BLE connections work
  fine from HW-V0 — a 3rd, trainer+Left+Right, is untested but plausible).
- Re-test the real-Zwift-app unlock workaround as a clean before/after (connection
  lifetime with vs. without a recent Companion-app pairing), since this session's attempt
  wasn't conclusive.
- Build the actual Left/Right → bit-position table from fresh captures, then update
  `src/dev/protocols/zapFrame.js`'s mask table to match OUR hardware's real wiring instead
  of the borrowed Play-derived names, with fixtures from this session's confirmed bytes.
- **Wireshark/macOS PacketLogger deep dive (user, 2026-07-28, planned for later)**: get a
  ground-truth packet capture of a full Click session — handshake, buttons, and especially
  the disconnect/lock-timer sequence — since Web Bluetooth's own view may be hiding
  link-layer detail relevant to the vendor-lock behavior (H16).
- **Cross-reference makinolo's Zwift Ride protocol writeup against QZ's connection-
  management code** specifically for keepalive/unlock/disconnect handling (not just frame
  grammar, which RESEARCH.md Track 3 already cites this same article for) — QZ's
  `zaplibrary`-derived client presumably has to solve the exact vendor-lock problem we hit
  today; see what recipe it uses (https://www.makinolo.com/blog/2024/07/26/zwift-ride-protocol/).
- **Seriously reconsider a generic BLE HID (HOGP) remote as the primary shift-input
  device, not just a fallback.** GOALS.md already scopes a Gamepad/HID adapter as a
  first-class citizen; today's session is a live demonstration of exactly why — a
  standard HID remote has none of ZAP's vendor-lock friction, and the whole point of this
  project is interoperability on open protocols. Worth weighing against Click support
  once the drivetrain/FTMS side (the current priority) is further along.
