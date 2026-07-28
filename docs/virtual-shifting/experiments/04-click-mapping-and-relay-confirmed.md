# 04 — Click Button Mapping Confirmed + Relay Architecture Resolved

**Date**: 2026-07-28
**Supersedes**: the open questions in `03-click-buttons-partial.md` regarding full
button mapping and the Left/Right relay-architecture question (item 32 in the test
matrix). That file's disconnect-cadence findings and follow-ups still stand; only the
mapping/architecture parts are superseded here.

## Hypothesis

1. The full Left + Right button-to-bitmap mapping can be captured cleanly now that the
   connection is stable (post real-Zwift-app unlock, see `03`).
2. Whether the Left/Right pair has a primary/secondary relay relationship (user's
   architecture theory from earlier in the session — see test-matrix item 32).

## Setup

Same harness (`src/dev/ble-lab.html`), one Click already connected (bonded since
`2026-07-28T14:01:39.590Z`, confirmed via device photo to be wired to Right based on
prior "+"=`0x20` captures), connection stable 20+ minutes at time of this experiment.

## Exact steps performed

1. Right controller, isolated single presses in order: **Y, Z, A, "+"** (a prior round in
   this same session already established this order/timing).
2. Right controller, one more isolated press labeled "B" — see ambiguity note below.
3. **No new connect action taken.** User then pressed, on the **Left** physical
   controller: **top (D-pad up), left, right, bottom (D-pad down), "−"** — five presses,
   in that order, with pauses between.

## Raw captured data

Bitmap transitions (all frames type `0x23`, all-released baseline = `0xFFFFFFFF` =
`23 08 ff ff ff ff 0f`), in order, with exact hex:

| Time | Button (as pressed) | Hex frame | Bitmap | XOR vs. all-released |
|---|---|---|---|---|
| 14:18:52.070Z | Right Y | (not re-extracted; bit confirmed via XOR) | 4294967231 | `0x40` |
| 14:18:56.538Z | Right Z | — | 4294967167 | `0x80` |
| 14:19:04.008Z | Right A | — | 4294967279 | `0x10` |
| 14:19:07.791Z | Right "+" | — | 4294967263 | `0x20` |
| 14:20:57.082Z | Right "B" (isolated) | — | 4294967263 | `0x20` (same as "+", see ambiguity note) |
| 14:22:02.514Z | Left "top" | `23 08 fd ff ff ff 0f` | 4294967293 | `0x2` |
| 14:22:07.494Z | Left "left" | `23 08 fe ff ff ff 0f` | 4294967294 | `0x1` |
| 14:22:09.394Z | Left "right" | `23 08 fb ff ff ff 0f` | 4294967291 | `0x4` |
| 14:22:11.783Z | Left "bottom" | `23 08 f7 ff ff ff 0f` | 4294967287 | `0x8` |
| 14:22:14.424Z | Left "−" | `23 08 ff fd ff ff 0f` | 4294967039 | `0x100` |
| 14:22:37.435Z | (repeat, unexplained) | `23 08 ff fd ff ff 0f` | 4294967039 | `0x100` again, 23s later |

**No `gattserverdisconnected` or `connected` system event occurred anywhere in this
window** — confirmed by grepping the full session log between the Right and Left
sequences. The Left presses arrived on the exact same, already-open GATT connection that
had just produced the Right presses.

Also captured incidentally: a high-entropy 79-byte frame, type `0xff` sub-type `0x03`
(`ff 03 00 0a 21 03 78 a1 3c 75 8e f3 99 b6 d8 4c aa 9d b4 ec 47 b3 c5 93 ce 05 00 6a a5
79 a6 25 19 00 20 a8 34 80 10 80 80 8c 10 1a 28 f9 60 d1 ce f0 9b 7c 5e 67 d7 a7 44 dd 52
dc 76 a3 9b ff 2b 7e 65 4d b6 c6 f2 4d 59 a8 a9 ef 31 a2 2a 14 a3 71 d0 4c 22`) — content
looks cryptographically random, not text. Plausibly part of the encrypted-ZAP key
exchange machinery mentioned in PROTOCOLS.md §1.3 (unencrypted mode is what we actually
use; this may be background protocol noise). Not decoded further — out of scope.

## Observations

1. **Full confirmed mapping**:
   - Left D-pad: top(UP)=`0x2`, left=`0x1`, right=`0x4`, bottom(DOWN)=`0x8` — **these
     match the community-sourced mask table exactly** (`V2_BUTTON_MASK.UP/LEFT/RIGHT/DOWN`
     in `zapFrame.js`).
   - Left "−" paddle = `0x100` — does **not** match the community table's `SHFT_DN_L`
     (`0x400`).
   - Right "+" paddle = `0x20` (4th independent confirmation) — does **not** match the
     community table's `SHFT_UP_R` (`0x2000`).
   - Right face buttons: Y=`0x40`, Z=`0x80`, A=`0x10` (these DO match the community
     table's Y/Z/A positions).
   - **Pattern**: the four-button diamond (D-pad on Left, Y/Z/A/B on Right) uses the
     community/Play-derived bit positions correctly; only the two dedicated shift
     **paddles** are wired to different bits than their borrowed names suggest. Consistent
     with the theory in `03`: Click's hardware likely reuses Play's firmware/bit
     enumeration, but the physical paddle buttons (unique to this Click-with-paddles
     variant) got wired to whichever bits were convenient/unused in Play's original
     scheme, not the ones Play reverse-engineers labeled "shift."
   - "B" is not cleanly confirmed — the isolated press produced the same bit as "+"
     (`0x20`), most likely a physical mix-up given B sits directly above the "+" paddle in
     the diamond layout (see product photo, prior turn). Not pursued further; B isn't
     needed for the shifting feature.
2. **Relay architecture: CONFIRMED.** Left's button presses were received without any new
   `requestDevice()`/connect action and without any `gattserverdisconnected` /`connected`
   event pair in between. The only physical BLE connection this session has open is bonded
   to one unit (established at `14:01:39.590Z`); pressing buttons on the *other* physical
   controller still produces frames on that same connection. This resolves test-matrix
   item 32 from "inferred against a pure single-relay theory" (based on indirect MAC
   evidence) to **directly confirmed by observed behavior**: the Left/Right pair has an
   internal link (of some kind — not characterized further; possibly the same short-range
   RF the Zwift Play pair uses) and only one unit needs to be BLE-connected to receive
   input from both.

## Conclusion

**HW-V5 (button mapping): DONE for the buttons that matter** (both paddles + D-pad).
**Test-matrix item 32 (relay architecture): CONFIRMED**, upgraded from inferred.

**Design implication (significant simplification)**: the production Click adapter only
ever needs to manage **one** GATT connection, not two. Whichever physical unit ends up
BLE-connected (Left or Right — doesn't matter which, since presumably either can be the
"primary" that talks to the phone/PC) delivers events from both controllers' buttons.
This removes the "two controller GATT slots" complexity from `GOALS.md`'s hardware
inventory update (item 30) — the earlier open question "does v1 need simultaneous
dual-Click support" is now moot: a single connection already gets both.

## Confidence

**CONFIRMED**: Left D-pad mapping, Left "−" = `0x100`, Right "+" = `0x20` (4th
confirmation), relay architecture (single BLE connection serves both controllers).
**INFERRED**: "B"'s exact bit (contaminated by likely mix-up with "+").
**UNKNOWN**: the exact mechanism of the Left↔Right internal link (not BLE-visible to us);
content/purpose of the high-entropy `0xff 0x03` frame.

## Follow-ups

- Update `src/dev/protocols/zapFrame.js` with our own confirmed constants for the two
  buttons we actually need (Right "+" = `0x20`, Left "−" = `0x100`), clearly distinguished
  from the borrowed community table.
- No further Left/Right connection-juggling needed in future sessions — connect whichever
  unit the chooser offers and both controllers' input will be visible.
- The unexplained repeat of the Left "−" bit 23 seconds after the first (with no user
  action reported in between) is unresolved — could be an incidental second press, or a
  new category of idle artifact on that specific bit. Low priority; note if it recurs.
