# 14 — Click V2 Unlock: Current (2026) State, and a Correction to 13

**Date**: 2026-07-29
**Type**: Literature/source review of **current** material. No hardware run.

**Trigger**: the user challenged `13`'s reliance on makinolo's writeups — *"Those articles
were written 2 years ago, who knows what the protocol is now."* Correct, and acting on it
overturned one of `13`'s conclusions and produced two findings that change the project's
plan.

---

## Hypothesis being tested

**H27** — makinolo's 2023-10 and 2024-07 writeups remain an accurate description of our
Click V2 (fw 1.2) as of 2026-07.

**Result: ❌ FALSE for Click V2 specifically.** They remain accurate for Zwift **Ride** and
for the older **Play**, which is what they actually documented. Click V2 diverged.

---

## Sources (all current)

- [BikeControl — Zwift Click V2 with Other Trainer Apps](https://bikecontrol.app/blog/zwift-click-v2-with-other-trainer-apps/)
- [OpenBikeControl/bikecontrol](https://github.com/OpenBikeControl/bikecontrol) — source, incl. `CHANGELOG.md` **6.1.0 dated 19-06-2026** (five weeks before this session)
- [GPLama — Zwift Play firmware 2.0.1, bonded Bluetooth](https://gplama.com/2026/05/24/zwift-play-controller-firmware-2-0-1-bonded-bluetooth-update/) (2026-05)

---

## Observations

### 1. Click V2 is NOT the open protocol makinolo documented

> *"The Click V2 ships with proprietary firmware that **expects to talk to Zwift's servers
> regularly**, unlike the original Zwift Click (V1) which speaks a fairly open Bluetooth
> protocol."*

> *"The device requires an **encryption handshake that has to be refreshed roughly every 24
> hours** to keep delivering button events to third-party apps. Once the Click V2 leaves
> Zwift's session, the encryption context times out, and if you don't refresh it, the
> device will likely **stop sending button events after roughly a minute** of being
> connected."*

**This is H16, described by the vendor's own integrator.** The ~1-minute figure matches our
measured 44–90 s drops (`03`) closely enough to call it the same phenomenon. H16 moves from
"our single-trial observation, uncorroborated" to **externally corroborated**.

### 2. Correction to `13` §3 — my causal claim was wrong

`13` §3 said plaintext works "because Zwift removed encryption", citing makinolo. That
statement is about **Ride** (and the older Play). For **Click V2** the opposite holds: there
is an encryption/authorisation context, and it is exactly what expires.

Reconciling with what we actually measured: we *do* get plaintext ASYNC frames after a bare
`RideOn`, and they *do* stop after ~a minute. So the mechanism is **not payload encryption
of button frames** — it is an **authorisation context with a timeout** that gates whether
the device keeps streaming at all. Both observations were right; my explanation joining them
was not.

**`13` §3 is corrected in place. Do not cite it in its original form.**

### 3. ★ The RIGHT-side controller needs no unlock at all

From BikeControl's own UI strings (`lib/i10n/intl_en.arb`):

> `unlock_rightSideNeedsNoUnlock`: *"You could use this controller without the left
> controller, as this one needs **no unlocking or restarts**."*

> `unlock_newMethodDescription`: *"Connect the left and right side as **separate
> controllers**. The right side needs no unlock. Disable to use a single combined
> controller."*

And `CHANGELOG.md` 6.1.0 (19-06-2026): *"Zwift Click V2: the new unlock handling is now
available to everyone."*

**This is the most actionable finding in this session.** It says the lock applies to the
**left** unit, and that connecting the **right** unit as its own controller sidesteps the
entire problem — no unlock, no 24-hour refresh, no ~1-minute drop.

We already know from `04` that **Right "+" = `0x20`** (confirmed 4×). If the right unit
alone gives a usable shift-up input with no lock behaviour, H16 stops being a blocker for
this project rather than needing to be solved.

**Tension with our own H17 to resolve**: `04` confirmed a *relay* — Left's presses arrived
on the connection serving Right. BikeControl's "new method" instead treats them as separate
controllers. Both can be true (the relay is a firmware feature; connecting separately is a
client choice), but which unit our harness actually bonded to in `03`/`04` was never
established, and `device.name` is `"Zwift Click"` for both. **If we were connected to the
LEFT unit, that alone explains the drops.**

### 4. Two unlock characteristics we have never touched

`lib/bluetooth/emulation/profiles/zwift_profiles.dart`:

```dart
const _clickV2UnlockCharacteristics = [
  '00000100-19ca-4651-86e5-fa29dcdd09d1',
  '00000101-19ca-4651-86e5-fa29dcdd09d1',
];
```

Built as **write / write-without-response** characteristics, described as *"optional extra
writable characteristics (Click V2 unlock)"*.

`PROTOCOLS.md` §1.2 documents only `…0002`/`…0003`/`…0004`/`…0006`. **`0100` and `0101` are
absent from our knowledge base and our code has never written to them.** This is where the
unlock traffic lives, and it is *not* the SYNC RX channel we have been focused on.

Immediately checkable: our harness's `dumpAndSubscribe` prints the whole GATT tree, so the
next connect will show whether our unit exposes them.

### 5. The unlock cannot be synthesised offline — and BikeControl keeps it closed

- *"The unlock **requires Zwift's servers**. Users must open the Zwift app and connect their
  device for 10-30 seconds… No offline method is documented."* Notably: *"a paid
  subscription is not required for this step."*
  > ✅ **CONFIRMED on our own hardware 2026-08-07** ([`19`](19-click-v2-challenge-and-gate.md)
  > §7). Both claims hold: no subscription **and no ride**. In
  > `20260729-164954-bridge-ride.btsnoop` the first `FF 04` answer lands **5.3 s after the
  > handshake** (the empty `ff 04 00`; the 21-byte body follows at +270.6 s, behind the second
  > challenge), and the trainer received **zero writes after +17 s** across the whole session — so
  > that authorisation happened on Zwift's **pairing screen**. This matters: the rider has no
  > subscription, and it is why the two-day experiment is runnable at all.
- `unlock_bikecontrolAndZwiftNetwork`: *"BikeControl and Zwift must be on the same network or
  device."* ⇒ BikeControl **proxies**: it presents a fake Zwift-compatible peripheral, lets
  the real Zwift app (which holds server auth) perform the unlock, then retains the session.
  It is not a crypto replay.
- `prop_public/lib/emulators/definitions/zwift_click_definition.dart`: *"The full
  implementation drives the Zwift Click/Play unlock handshake. **This stub keeps the public
  surface so the app compiles.**"* The repo is otherwise open; the unlock specifically is
  proprietary.

**So the answer to this session's core question — "can we use the authcode for the Web BLE
process?" — is NO, not by any means available to us.** It needs the real Zwift app plus
Zwift's servers. The most capable third-party integrator in this space has not found an
offline path, and deliberately does not publish what it did find. That is about as strong a
negative as literature can give.

### 6. Correction: it is Zwift, **not** Companion

`unlock_openZwift`: *"**Open Zwift (not the Companion)** on this or another device."*

`03`, `GOALS.md` non-goals and `RISKS-ROADMAP.md` R2 all record **Zwift Companion** as the
sync step that fixed our drops. Either Companion also works, or that observation was
confounded (BV2 was always a single uncontrolled before/after). ~~**Flagged as a genuine
conflict between our own record and the current external source.**~~

> ✅ **RESOLVED 2026-08-07** — see [`19`](19-click-v2-challenge-and-gate.md) §7.-1. Both records
> are right, because **Companion in bridge mode is a BLE proxy for the game**: it holds the links
> to the trainer and both Click units and relays one encrypted stream to the game over the LAN
> (`16` §5 measured that leg — TCP/21588, entropy 7.74/7.91). The protocol decisions are the
> game's; Companion only moves the bytes.
>
> Proof from our own capture: **both `FF 04` writes in `20260729-164954-bridge-ride.btsnoop` are
> `Sent` from the phone's radio — written by Companion, while it bridged a live game.**
>
> So `unlock_openZwift`'s "not the Companion" means *Companion alone is not enough*, which is
> exactly the configuration `15` measured writing no payload at all. With a game behind it,
> Companion authorises. **The requirement is a live game session, not a particular BLE route.**

### 7. `FF 04 00` — hypothesis survives, but conditionally

`13` proposed `FF 04 00` as the missing write. Still plausible, but now clearly conditional:
`PROTOCOLS.md` §1.5 already qualifies it *"when previously unlocked"*. So it likely asserts
an existing unlock rather than establishing one. **Expect it to work only within ~24 h of a
real Zwift session** — which the A/B test must control for, and previously did not.

---

## Conclusion

**H27 FALSE.** Click V2 is materially different from what the 2023/2024 writeups describe,
and the user's skepticism was well founded. Net effect on the project:

| Question | Before | Now |
|---|---|---|
| Is there an authcode? | inferred from our `FF03` decode | **CONFIRMED** — an auth/encryption context with a ~24 h life |
| Can we reproduce it? | open | **NO** — needs Zwift's servers; no offline method exists |
| Is H16 real? | our single trial, uncorroborated | **corroborated externally**, ~1 minute |
| Is it a blocker? | assumed yes | **maybe not — the right-side unit reportedly needs no unlock** |
| Where does unlock traffic go? | assumed SYNC RX | **`…0100`/`…0101`**, which we have never touched |

The strategic shift: **stop trying to defeat the lock, and check whether we can avoid it.**

---

## Confidence

**CONFIRMED** (documentary, from current primary sources)
- `_clickV2UnlockCharacteristics` = `…0100`, `…0101`, write/write-without-response.
- BikeControl's unlock is proprietary; the public repo ships a stub.
- The unlock requires the Zwift app + servers; no subscription needed.
- BikeControl's UI states the right-side controller needs no unlocking or restarts.
- CHANGELOG 6.1.0, 19-06-2026.

**INFERRED**
- The ~1-minute drop BikeControl describes is the same phenomenon as our 44–90 s drops.
- `FF03` is part of this unlock exchange (from `13`'s decode + this family's association).
- BikeControl unlocks by proxying to a real Zwift app rather than replaying crypto.

**UNKNOWN**
- **Whether OUR right-side unit actually needs no unlock.** Vendor UI copy, not our
  measurement. **The single most valuable thing to test next, and it is free.**
- Which physical unit our `03`/`04` sessions were bonded to.
- Whether our unit even exposes `…0100`/`…0101`.
- Whether Companion suffices, or only full Zwift.
- Byte-level unlock content — and per §5, likely unobtainable.

---

## Addendum — source currency audit, and BikeControl 6.3

Checked *when* each of our reference implementations last moved. This should have been the
first thing done, not the last.

| Source | Last activity | Verdict for Click V2 |
|---|---|---|
| makinolo, Play post | 2023-10-08 | pre-dates Click V2 |
| makinolo, Ride post | 2024-07-26 | describes **Ride**, not Click V2 |
| **ajchellew/zwiftplay** | **last commit 2024-02-11** — dead 2.5 years | **stale.** Its Click support was added 2024-02-10 (*"unencrypted and click device support (untested by me) thanks to cagnulein"*) — that is **Click V1**, before V2 shipped |
| **OpenBikeControl/bikecontrol** | **release 6.3, 2026-07-10** — 3 weeks ago | **current.** The only live source |

**So three of our four external sources pre-date the device we own.** `PROTOCOLS.md` §1
is built substantially on the two makinolo posts plus ajchellew, and the Click-v2 rows in
it are therefore weaker than their CONFIRMED labels imply. The user's challenge was right
twice over: not just "the protocol may have changed" but "our whole reference set is stale
except one."

### ajchellew is still useful for exactly one thing: the Android capture method

Its README documents the free path, and it is what we should use now that macOS is dead
(`11` fourth addendum):

> Enable *"Enable Bluetooth HCI snoop log"* in Developer Options → generate a **bug
> report** to extract the log file → open the captured log in **Wireshark**.

Two ways in, both already implemented in `tools/ble-lab/`:
- `live.py --backend android` — live stream via `adb forward tcp:8872 localabstract:btsnoop`
- `sources.android_pull_snoop()` — pulls the on-device file, with the bug-report route
  documented as the fallback for unrooted devices (which is ajchellew's method)

It also records another handshake-reply variant, worth adding to §1.3's family table:
Zwift writes `52 69 64 65 4f 6e 01 02`, controller replies **`52 69 64 65 4f 6e 01 01`**.
And it says AES-**GCM** — `PROTOCOLS.md` §1.3 already flags this as an error in that README
(his own code and makinolo both say CCM). Unchanged.

### BikeControl 6.3 (2026-07-10) — the "interesting" recent release

> *"**SRAM AXS**: After a lot of tinkering, SRAM AXS levers are now fully supported — all
> individual buttons are supported now."*
> *"**WHEELTOP EDS** shifters (beta): use your EDS OX or TX shifter as a controller — top/
> bottom buttons shift up/down by default and are fully remappable."*

Plus 6.1.0 (19-06-2026), the new Click V2 unlock handling covered above.

**Why this matters strategically.** `03`'s own follow-up said: *"Seriously reconsider a
generic BLE HID (HOGP) remote as the primary shift-input device… a standard HID remote has
none of ZAP's vendor-lock friction, and the whole point of this project is
interoperability on open protocols."*

There is now a **live, maintained precedent for driving virtual shifting from real
non-Zwift bike shifters** — SRAM AXS levers and WHEELTOP EDS — which by construction carry
no Zwift authorisation context, no ~24 h refresh, and no server dependency. That is a
categorically better input story than fighting the Click V2 lock, and it is no longer
hypothetical.

**Not scoped here** — we own a Click, not AXS levers, and buying shifters is a bigger
decision than a £12 dongle. But it belongs in `GOALS.md`'s input-adapter thinking as a
first-class option rather than a fallback, and the protocol AXS uses is worth a look before
committing further effort to defeating the Click lock.

## Follow-ups — revised priority

1. **Connect the RIGHT unit alone and time the connection.** Free, minutes, no dongle, no
   Zwift. If it holds well past 90 s with no recent Zwift contact, H16 stops being our
   problem. Highest value per minute in this knowledge base.
2. **Read the GATT dump for `…0100`/`…0101`** on that same connect. Zero extra effort.
3. **Establish which physical unit is connected**, finally — `04`'s follow-up asked for this
   and §3 shows it may have been the whole story.
4. Re-run the `FF 04 00` A/B **controlling for time since the last Zwift session**, which
   the earlier design did not.
5. Re-test whether Companion actually suffices (§6), settling BV2 properly.
6. Add `…0100`/`…0101` to `PROTOCOLS.md` §1.2 and H27 to `HYPOTHESES.md`.
7. **Reconsider the dongle's urgency.** Still the right tool for capture, but if (1)
   succeeds the capture becomes confirmatory rather than load-bearing. Nothing to cancel —
   just don't block on it.
