# 13 — Decoding the 0xFF-Family Frames: Is There an Authcode, and Is There a Keep-Awake?

**Date**: 2026-07-29
**Type**: Offline re-analysis of bytes **already captured** in `03` and `04`. No new
hardware run, no new BLE traffic — this is a decode of data that has been sitting in
the repo undecoded since 2026-07-28.

**Why now**: the user's question for this session is specifically *"are there
keep-awake signals or an authcode involved in the handshake, and can we reuse the
authcode from Web Bluetooth?"* The three frames that `03` and `04` recorded but
explicitly declined to decode are exactly the frames that would answer it.

---

## Hardware & firmware

Not re-verified this session; inherited from the sessions that captured the bytes.
Zwift Click v2-family pair (Left `…5106` / Right `…D9a1`), fw 1.2, connected from
`src/dev/ble-lab.html` over Web Bluetooth on macOS Chrome.

The `0xFF05` frames come from the **post-Companion-sync connection that held 5+
minutes** (established `2026-07-28T14:01:39.590Z`) — i.e. from a *working, unlocked*
session, which is what makes them worth decoding.

---

## Hypothesis

**H26** — The `0xFF`-family frames are `FF <subtype> 00` + protobuf, and their decoded
contents will show either (a) an authentication challenge/response, (b) a
session/unlock countdown, or (c) both — thereby explaining the ~45–90 s disconnects
(H16) that a Companion sync fixes.

Prior sessions' stated positions, which this either confirms or overturns:
- `03` on the two `0xFF05` frames: *"plus small integer fields (one decodes to 496)
  that are plausibly some kind of unlock/session countdown — **not decoded further**"*.
- `04` on the 79-byte frame: *"content looks cryptographically random, not text.
  Plausibly part of the encrypted-ZAP key exchange machinery… **Not decoded further —
  out of scope**."*

---

## Setup

`tools/ble-lab/blelab/pbinfer.py`, run against the verbatim hex strings transcribed in
`03` and `04`. The classifier scans candidate header lengths 0–3 and accepts a parse
only if the remaining bytes form well-formed protobuf **consuming every byte to the
exact end of the buffer**. That full-consumption requirement is what makes a
successful parse evidence rather than wishful thinking: random or encrypted bytes
essentially never terminate cleanly.

---

## Exact steps performed

1. Copied the three frames' hex verbatim out of `03` and `04`.
2. Ran `pbinfer.classify()` on each.
3. For the 79-byte frame, checked whether its first length-delimited field has the
   size and leading byte of an elliptic-curve point.
4. Checked the small integers against plausible physical units.

---

## Raw captured data

Input hex (verbatim from the prior experiment files):

```
FF05-A  ff 05 00 fa 05 18 0a 0c 33 34 43 34 35 39 33 44 35 31 41 36 20 64 28 64
        30 af 16 38 af 16                                                  (30 B)

FF05-B  ff 05 00 ea 05 19 0a 0c 33 34 43 34 35 39 33 44 35 31 41 36 10 00 18 f0
        03 20 01 28 04 30 00                                               (31 B)

FF03    ff 03 00 0a 21 03 78 a1 3c 75 8e f3 99 b6 d8 4c aa 9d b4 ec 47 b3 c5 93
        ce 05 00 6a a5 79 a6 25 19 00 20 a8 34 80 10 80 80 8c 10 1a 28 f9 60 d1
        ce f0 9b 7c 5e 67 d7 a7 44 dd 52 dc 76 a3 9b ff 2b 7e 65 4d b6 c6 f2 4d
        59 a8 a9 ef 31 a2 2a 14 a3 71 d0 4c 22                             (85 B)
```

Decoder output:

```
FF05-A (30B) mode=skip3 hdr=ff0500
  95:len[24]{ 1:len[12]="34C4593D51A6"  4:varint=100  5:varint=100
              6:varint=2863  7:varint=2863 }

FF05-B (31B) mode=skip3 hdr=ff0500
  93:len[25]{ 1:len[12]="34C4593D51A6"  2:varint=0  3:varint=496
              4:varint=1  5:varint=4  6:varint=0 }

FF03  (85B) mode=skip3 hdr=ff0300
  field 1: len=33   0378a13c758ef399b6d84caa9db4ec47b3c593ce05006aa579a625190020a83480
  field 2: varint=33751040  = 0x02030000  → big-endian bytes 02 03 00 00
  field 3: len=40   f960d1cef09b7c5e67d7a744dd52dc76a39bff2b7e654db6c6f24d59a8a9ef31
                    a22a14a371d04c22
```

Derived checks:

```
FF03 field 1 length      = 33  = 1 prefix byte + 32-byte coordinate
FF03 field 1 prefix byte = 0x03 = VALID compressed-EC-point prefix (odd Y)
FF03 field 3 length      = 40  = 32 + 8
2863 as millivolts       = 2.863 V   (CR2032 nominal 3.0 V)
496  as seconds          = 8 min 16 s
```

---

## Observations

### 1. All three frames are `FF <subtype> 00` followed by protobuf — H26's structural claim CONFIRMED

Every one parses to the exact end of the buffer after a 3-byte header, and none parses
with a 0-, 1-, or 2-byte header. The 3-byte header form independently matches
`PROTOCOLS.md` §1.5's already-documented client→device write **`FF 04 00`** — same
shape, different subtype. So `0xFF` is a framed sub-protocol family with a 1-byte
subtype and a `00` byte, carrying protobuf.

The nesting is the strongest single piece of evidence: inside both `FF05` frames, a
length-delimited field decodes to the exact 12-character ASCII string
`"34C4593D51A6"` — a device serial. A misaligned parse does not accidentally produce a
correctly-length-prefixed 12-byte printable serial in two independent frames.

**Caveat, stated because it is real**: field numbers 95 and 93 are unusually high for a
hand-written schema. Either the wire really does use a wide `oneof`-style
discriminator (plausible — `PROTOCOLS.md` §2.0 records `HubRequest.DataId` values
scattered up to 534), or the true framing is `FF 05` + a 1-byte length/selector and my
"field number" is actually that selector. **Both readings agree on every byte of
payload content below**; they disagree only about what to call the outer wrapper. I am
not claiming to know which.

### 2. `FF03` carries a compressed P-256 public key — this is the authcode exchange

Field 1 is 33 bytes beginning `0x03`. That is precisely the SEC1 *compressed* point
encoding for a 256-bit curve: one prefix byte (`0x02` even-Y / `0x03` odd-Y) plus a
32-byte X coordinate. Getting a valid prefix byte *and* exactly 33 bytes by chance is
unlikely; combined with field 3 being exactly 40 bytes (32 + 8, the shape of a
MAC/tag-suffixed blob), the frame reads as a **key-agreement / challenge message**.

Field 2 = `0x02030000` is conspicuously *not* random — four bytes reading `02 03 00 00`,
the shape of a version or capability tuple, sitting between two high-entropy blobs.
Random data does not look like that.

This overturns `04`'s framing. That session saw high entropy and concluded
"cryptographically random, not text… out of scope." It is not undifferentiated random
data: it is **a structured protobuf message with three fields, two of which carry
crypto material**. The entropy is in the *fields*, not the frame.

Note also that `PROTOCOLS.md` §1.3 documents encrypted ZAP as using a **64-byte
uncompressed** P-256 key. This is a **33-byte compressed** key in a different frame
family. So this is not the documented optional-encryption handshake — it is a
**separate vendor exchange**, which is consistent with it being the Click v2 unlock
(H16) rather than ZAP payload encryption.

### 3. The direction matters, and it is the good news

`FF03` was observed **inbound** (device → client, a notification on ASYNC) on our own
Web Bluetooth connection, with our harness having sent nothing but a bare `RideOn`.
The Click **volunteers** this frame to any client.

So the authcode question splits cleanly in two, and only the second half is open:

- *Can we receive the challenge from a browser?* **Yes — already demonstrated.** It
  arrived in `04` on a plain Web Bluetooth connection.
- *What does the official app write back?* **Unknown. This is the one thing the
  capture must find.** No client→device `0xFF` write has ever been observed by this
  project.

### 4. Directly answering "can we reuse the authcode?" — probably not by replaying it, and that is fine

If field 1 is an ephemeral public key, the exchange is challenge–response and a
recorded response is not reusable: a fresh key per session means a captured reply
authenticates nothing later. Replay would only work if the key is *static per device*
— testable by capturing `FF03` twice and diffing field 1 (`diff.py` reports exactly
this, and classifies a varying high-entropy field as nonce/key material).

**But replay is probably not what we need**, because of what `PROTOCOLS.md` §1.5
already documents:

> Click v2 post-handshake (BikeControl, when previously unlocked): `FF 04 00`

`FF 04 00` is a 3-byte frame whose protobuf body is **empty**. That is not an
authcode — it carries no secret at all. It reads as *"proceed; I am already
unlocked"*. Which fits every observation we have: the unlock state lives **in the
Click's own non-volatile memory**, written once by the real Zwift app (our Companion
sync), and a third-party client only needs to *assert* it, not prove it.

**This makes the highest-value hypothesis of the whole session testable in a browser
today, with no capture at all**: our harness has never written `FF 04 00`. If sending
it after `RideOn` converts a ~45–90 s connection into a long-lived one, the
"authcode problem" was never a cryptography problem — it was a missing 3-byte write.

### 5. The keep-awake question — no client-side keepalive is visible yet, but there is a countdown

On the keep-awake half of the question:

- **Nothing in these three frames is a client→device keepalive.** All three are
  inbound. Consistent with `PROTOCOLS.md` §1.6 ("No client→device keepalive needed")
  and with `RESEARCH.md`'s "No client keepalive needed".
- ~~**But `FF05-B` field 3 = 496 looks like a countdown**, and 496 s = 8 min 16 s is a
  plausible session/unlock remaining-time.~~ ❌ **FALSIFIED 2026-08-07 —
  see [`19`](19-click-v2-challenge-and-gate.md) §4.** The decisive test this paragraph
  named was run against the captures that now exist: the value does **not** fall. Across
  the 2026-08-07 failure boundary it **rose 15 → 900** in 48 s, and across four sessions
  it takes 496 / 248 / 15 / 900 with no trend and no relation to elapsed time. It is not
  a timer. What does track the gate closing is **field 2**, which flipped 0 → 1 and
  arrived 0.136 s after the last keypad frame (n=1, unreplicated).
- **`FF05-A` reads as battery telemetry for both relay-paired units**: `(100, 100,
  2863, 2863)` is the shape of (percent, percent, millivolts, millivolts), and 2.863 V
  is a sensible partly-used coin cell. Two identical pairs fits H17's confirmed
  Left/Right relay pair reporting through the one connected unit. Speculative, but it
  makes `FF05-A` uninteresting for the lock question and stops us chasing it.

### 6. A methodological note worth keeping

Two prior sessions recorded these bytes carefully and moved on, twice using the phrase
"not decoded further." The bytes were sufficient the whole time; what was missing was
a ~120-line protobuf classifier. **Cost to decode, once the tool existed: one
function call.** Transcribing raw bytes into experiment records — which those sessions
did diligently — is what made this possible a day later with no hardware.

---

## Conclusion

**H26: CONFIRMED for structure, and it reframes the session's central question.**

1. The `0xFF` family is `FF <subtype> 00` + protobuf. Three previously-undecoded
   frames now decode fully. (Decode: **CONFIRMED** — deterministic from the bytes.)
2. `FF03` is a **structured key-agreement/challenge frame** carrying a 33-byte
   compressed P-256 public key, a `02 03 00 00` version-shaped field, and a 40-byte
   (32+8) blob — not "random noise". (Structure **CONFIRMED**; that it is specifically
   the v2 unlock challenge is **INFERRED**.)
3. **We already receive the challenge from a browser.** The open question is only what
   the app writes *back*.
4. The likely answer is that no cryptographic reply is needed from third-party
   clients: `PROTOCOLS.md` §1.5's documented **`FF 04 00`** is an empty-bodied
   assertion, and the unlock state appears to persist in the Click itself. **Our
   harness has never sent it.** (**INFERRED**, but testable in the browser in minutes.)
5. No client→device keep-awake frame is evidenced. ~~`FF05-B` field 3 = 496 is a clean
   candidate countdown; two captures settle it.~~ ❌ **Settled and FALSIFIED** — see §5
   above and [`19`](19-click-v2-challenge-and-gate.md) §4. The "no keepalive" half stands:
   `19` §5 counts nine client writes in 786 s of a working link, none periodic.

> **Postscript, 2026-08-07.** §3's *"the open question is only what the app writes back"*
> was the right question, and the answer was already in the repo. `20260729-164954-bridge-ride.btsnoop`
> contains **two outbound `FF 04` writes** to SYNC RX, each ~0.45 s after an inbound `FF 03`:
> `ff 04 00` (empty) and `ff 04 00 0a 15 <21 bytes>`. See [`19`](19-click-v2-challenge-and-gate.md) §3.

### Immediate action this unlocks — no capture required

`src/dev/ble-lab.html` already has a raw-hex send box wired to Click SYNC RX
(`click-raw-send`, line ~615). So:

1. Wake the Click, connect in the harness, click **Write RideOn handshake**.
2. In the Click raw-hex box send **`ff 04 00`**.
3. Leave it strictly alone and watch the clock.

**Pass** = the connection outlives the ~45–90 s pre-sync cadence documented in `03`
(watch specifically past 90 s and past 3 min). **Fail** = it still drops on schedule,
which promotes the real capture from "worth doing" to "required", because then there
genuinely is a challenge–response we have to reproduce.

Run it both **with** and **without** a recent Companion sync — that also finally
gives BV2 (`00-test-matrix.md` §6) the repeated controlled before/after it has been
waiting for, and answers `RISKS-ROADMAP.md` R2's "how long does the unlock actually
last?" as a side effect.

---

## Confidence

**CONFIRMED**
- All three frames parse as protobuf behind a 3-byte `FF <sub> 00` header, consuming
  every byte; none parses with a 0/1/2-byte header. Reproduce:
  `python3 -c "from blelab import pbinfer; print(pbinfer.classify(bytes.fromhex('…')))"`.
- Both `FF05` frames contain the exact ASCII serial `34C4593D51A6` in a
  length-delimited field.
- `FF03` field 1 is 33 bytes with leading byte `0x03`; field 2 is `0x02030000`;
  field 3 is 40 bytes.
- `FF03` was received on a plain Web Bluetooth connection whose only prior write was a
  bare `RideOn` (`04`).
- `FF 04 00` is documented as a client→device Click-v2 post-handshake write
  (`PROTOCOLS.md` §1.5, from BikeControl) and our code has never sent it
  (`ble-lab.html` sends only `RideOn` and the haptic frame).

**INFERRED**
- `FF03` is the Click v2 vendor-unlock challenge (structure + the 0xFF family's
  documented association with the lock timer, H16).
- Field 1 is an ephemeral rather than static device key — the usual construction, but
  untested. If static, replay becomes viable; two captures decide it.
- `FF 04 00` is an "already unlocked, proceed" assertion and may by itself fix the
  drop cadence.
- `FF05-B` field 3 (496) is a countdown; units unknown.
- `FF05-A` `(100, 100, 2863, 2863)` is per-unit battery percent + millivolts for the
  relay pair.

**UNKNOWN**
- What the official app writes to SYNC RX in the `0xFF` family, and whether it is
  derived from `FF03`. **This is the question the capture exists to answer.**
- The outer wrapper's true grammar (high field numbers vs. a length/selector byte).
- Whether the unlock persists in the Click's NVM, on Zwift's servers, or in the app —
  though the observed behaviour (sync once in Companion, then third-party clients work
  for a long time) points at the Click.
- Field semantics for everything except the serial.

---

## Addendum (2026-07-29) — cross-checked against makinolo, and the result is decisive

This is the follow-up `03` asked for: *"Cross-reference makinolo's Zwift Ride protocol
writeup against QZ's connection-management code specifically for keepalive/unlock/
disconnect handling."* Both relevant posts read this session:

- [Connecting to Zwift Play controllers](https://www.makinolo.com/blog/2023/10/08/connecting-to-zwift-play-controllers/) (2023-10-08) — the encryption writeup
- [Zwift Ride protocol](https://www.makinolo.com/blog/2024/07/26/zwift-ride-protocol/) (2024-07-26)

### 1. The `FF03` frame is NOT the documented ZAP encryption handshake — CONFIRMED by construction

The two differ in every structural respect:

| | Documented ZAP encryption (makinolo, Play) | Our `FF03` frame |
|---|---|---|
| Trigger | `RideOn` + `01 02` written by the **client** | **unsolicited**, device→client |
| Characteristic | SYNC RX / SYNC TX (`…0003`/`…0004`) | ASYNC (`…0002`) notification |
| Key encoding | **64-byte uncompressed** (65-byte point, `0x04` prefix stripped) | **33-byte compressed**, `0x03` prefix retained |
| Framing | raw bytes after the magic | `FF 03 00` + protobuf, 3 fields |
| Extra fields | none | `02 03 00 00`; a 40-byte (32+8) blob |

makinolo is explicit about the key format: *"We want the uncompressed and it will come
prefixed with a byte of value 4 that indicates it's uncompressed. We need to remove that
first byte."* A 33-byte `0x03`-prefixed point is the *opposite* encoding. These are two
different mechanisms, not two views of one.

**And makinolo documents no `0xFF` family at all.** The Play post enumerates the message
types it found — `0x07` keypress, `0x15` idle, and client commands `0x12` haptic, `0x18`
reset, plus `0x02`/`0x08`/`0x0A` unknown — with **no mention of `0xFE`, `0xFF`, a vendor
unlock, or a challenge/response**. Neither does the Ride post. Combined with
`PROTOCOLS.md` §1.5's `FF 04 00` (sourced from BikeControl, not makinolo), the `0xFF`
family looks **genuinely under-documented**, and this decode may be the fullest one
written down anywhere.

That raises the value of the capture rather than lowering it: the one thing we most need
— what the app *writes* in the `0xFF` family — is not obtainable from the literature.

### 2. The bare `RideOn` echo is EXPECTED, not an anomaly — conflict resolved

`03` flagged our bare 6-byte echo as a discrepancy against community docs' "`RideOn` + 2
status bytes". Both readings are right, for different device families:

- **Play** (makinolo, encrypted era): client sends `RideOn 01 02`; device replies
  `RideOn 00 09`, *"or sometimes `01 03`"*.
- **Ride family**: *"Write to write characteristic: `RideOn`… Device replies via
  indication characteristic: `RideOn`"* — **no trailing status bytes**.

Our Clicks are Ride-family (H15: `0x23` bitmap frames), so a bare echo is exactly the
documented Ride behaviour. **This upgrades H15's coherence** — the frame grammar and the
handshake reply now agree on family — and closes the `RESEARCH.md` conflict row about
status bytes: they are family-dependent, and must not be validated either way.

### 3. ~~Plaintext works because Zwift *removed* encryption for this family~~ ⚠️ **CORRECTED — see [`14`](14-clickv2-unlock-current-state.md) §2**

> **This subsection's causal claim is WRONG for Click V2.** makinolo's "encryption was
> removed" statement describes **Ride** (and the older Play). **Click V2 has an
> authorisation context that expires** — current vendor-integrator documentation
> (2026) describes it explicitly, and it is what causes our drops. Both of our
> *observations* stand (plaintext ASYNC frames after bare `RideOn`; frames stop after
> ~a minute); the explanation joining them below does not. Read §3 as superseded.



makinolo, Ride post: *"Zwift got rid of the Bluetooth communication encryption they were
using for the Play and the Click."* Meanwhile the Play post states the opposite for Play:
*"The device uses encryption for this service, meaning you need to first do some kind of a
handshake to exchange public keys before the unit starts broadcasting data."*

So our plaintext-after-bare-`RideOn` observation is not us getting lucky — it is the
current firmware's designed behaviour. Reinforces `HYPOTHESES.md` F8 (don't implement
encrypted ZAP).

**But note the tension this creates**, and it is the interesting one: encryption was
removed, yet our unit still volunteers a frame containing a P-256 public key. So the
`0xFF` family is **something other than payload encryption** — consistent with it being
the vendor unlock (H16), which is the one behaviour makinolo never observed.

### 4. No client keepalive — third independent corroboration

Play post: idle `0x15` *"at around 1Hz"*, and *"Every second and idle message (0x15) is
sent even if buttons are pressed."* Ride post: *"you'll get a periodic 0x19 or 0x15."*
Both describe device→client only; neither documents any client-side keepalive write.
Together with `PROTOCOLS.md` §1.6 and our own `01`, that is three independent sources.

**Design consequence**: the ~1 Hz `0x15` is a *contract*, not an incidental. It makes the
`>5 s silence ⇒ suspect the link` watchdog (design §4.5) well-founded.

### 5. Neither post mentions a lock timer or a Companion-pairing requirement — H16 is ours alone

Explicitly checked for. Neither writeup describes disconnect timeouts, a lock timer, or
needing to pair with the official app first. So our ~45–90 s drop cadence and its
Companion-sync fix (H16, still a single-trial base validation BV2) is **not corroborated
by the best external sources** — it is either newer firmware behaviour than they
documented, or specific to our units.

Two readings, and I cannot yet separate them:
- It is real and new ⇒ the capture matters a lot, and `FF 04 00` is the lead.
- It is an artefact of our harness (subscribing to everything, a seconds-late handshake —
  divergences (a)–(c) in `CONNECTION-RECIPE.md`) ⇒ fixing our `connect()` fixes it, no
  vendor mechanism involved.

**The `FF 04 00` A/B test discriminates between these**, which is another reason to run it
before buying anything.

### 6. Bonus: `0x3c`

Ride post: `0x3c` is a *"control point response"*, and an information-query response
*"starts with `3c 08 00…`"*. `PROTOCOLS.md` §2.0 lists `DeviceInformation` as cmd `0x3c`
from QZ's proto but gives no wire example; this supplies one.

---

## Follow-ups

1. **Run the `FF 04 00` browser test above.** Highest value per minute of anything in
   this knowledge base right now, and it needs no PacketLogger, no Android, no
   subscription.
2. If it fails, capture a real session and find the app's `0xFF` write.
   `analyze.py` emits *"The app WROTE a 0xFF-family frame: …"* as a top-level finding
   precisely for this.
3. Capture `FF03` twice and diff field 1. Static ⇒ replayable; varying ⇒ ephemeral and
   replay is dead.
4. Capture `FF05-B` twice, ≥60 s apart, and diff field 3 to settle the countdown.
5. Fold the frame grammar into `PROTOCOLS.md` §1.4/§1.5 (currently `0xFE`/`0xFF` are
   described only as "disconnect warning family") and add H26 to `HYPOTHESES.md` §A
   plus the design-doc §2.6 ledger.
6. Add these three frames as byte fixtures to
   `tests/unit/zap-frame-parser.test.js` — they are our own hardware's bytes, which is
   what that file's header says it is waiting for.
