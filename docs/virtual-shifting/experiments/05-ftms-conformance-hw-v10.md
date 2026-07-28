# 05 — FTMS Control Point Conformance (HW-V10)

**Date**: 2026-07-28
**Hardware & firmware**: Wahoo KICKR Core `KICKR CORE C26B`, fw 1.5.36 (see
`02-firmware-model-check.md`). Chrome desktop (macOS), `src/dev/ble-lab.html`, driven
entirely via Chrome DevTools MCP `evaluate_script` calling a small debug hook
(`window.__bleLab.sendRaw`/`encodeSim`) added to the harness for hands-free operation —
the user was on the bike pedaling and could not operate the laptop.

## Hypothesis

(a) Last-write-wins between ERG (0x05) and SIM (0x11) targets. (b) A second 0x11 sent
without waiting for the first's 0x80 ACK is rejected (ATT "Procedure Already In Progress")
or silently dropped. (c) After Reset (0x01), a subsequent 0x11 without re-Request-Control
is rejected with result 0x05 (Control Not Permitted).

## Setup

Trainer connected via the harness's own chooser (user gesture); `Request Control` (0x00)
sent and acknowledged (`80 00 01` = Success) before any of the three sub-tests. All
commands after that were sent by the agent via `evaluate_script` calling
`window.__bleLab.sendRaw(bytes)` / `.encodeSim(opts)` — no further manual interaction
needed. User pedaled lightly and intermittently throughout (noted per sub-test below).

## Exact steps performed

**(a) Last-write-wins**: `sendRaw([0x05, 0x64, 0x00])` (Target Power 100W) → wait 3s →
`sendRaw(encodeSim({gradePct: 4}))` → wait 3s → `sendRaw([0x05, 0x64, 0x00])` again.

**(b) Concurrent unserialized write**: fired two `sendRaw` calls back-to-back in the same
synchronous script, the second NOT awaiting the first:
`encodeSim({gradePct: 2})` then immediately `encodeSim({gradePct: 6})`, `Promise.allSettled`
on both.

**(c) Reset then re-command without re-Request-Control**: `sendRaw([0x01])` (Reset) → wait
1.5s → `sendRaw(encodeSim({gradePct: 3}))`, deliberately skipping a fresh 0x00.

## Raw captured data

All Control Point write/indicate pairs, in order (indication format `80 <req-opcode>
<result>`; result `0x01` = Success):

```
14:40:57.322Z write   00                          (Request Control)
14:40:57.326Z indicate 80 00 01                    Success

--- (a) ---
14:41:25.406Z write   05 64 00                     (Target Power 100W)
14:41:25.413Z indicate 80 05 01                     Success
14:41:28.643Z write   11 00 00 90 01 28 33          (Sim Params, grade=0x0190=400→4.00%)
14:41:28.646Z indicate 80 11 01                     Success
14:41:31.793Z write   05 64 00                     (Target Power 100W again)
14:41:31.799Z indicate 80 05 01                     Success

--- (b) ---
14:41:59.592Z write-error  11 00 00 58 02 28 33     grade=0x0258=600→6.00% (2nd call, p2)
              NetworkError: GATT operation already in progress. [CLIENT-SIDE rejection —
              never reached the trainer]
14:41:59.694Z write   11 00 00 c8 00 28 33          grade=0x00c8=200→2.00% (1st call, p1)
14:41:59.695Z indicate 80 11 01                     Success

--- (c) ---
14:43:09.357Z write   01                            (Reset)
14:43:09.361Z indicate 80 01 01                     Success
14:43:10.975Z write   11 00 00 2c 01 28 33          grade=0x012c=300→3.00% — NO re-0x00 sent
14:43:10.977Z indicate 80 11 01                     Success  (expected: 0x05 Control Not Permitted)
```

Indoor Bike Data around test (c) (flags `0x0044` = speed+cadence+power present; fields:
speed u16 @0.01km/h, cadence u16 @0.5rpm, power s16 W), constant cadence ~85-86rpm,
roughly constant speed ~20km/h, power over the ~9s spanning Reset + the post-Reset grade
command:

```
14:43:08.366Z  speed=20.17kmh cadence=85rpm power=175W   (pre-Reset baseline)
14:43:09.362Z  speed=20.10kmh cadence=85rpm power=175W   (right after Reset ack)
14:43:10.344Z  speed=20.57kmh cadence=86rpm power=196W   (before the 0x11 write lands)
14:43:11.335Z  speed=20.56kmh cadence=86rpm power=187W
14:43:12.324Z  speed=20.24kmh cadence=87rpm power=197W
14:43:13.321Z  speed=20.19kmh cadence=87rpm power=200W
14:43:14.305Z  speed=20.23kmh cadence=86rpm power=216W
14:43:15.295Z  speed=20.23kmh cadence=86rpm power=223W
14:43:16.284Z  speed=20.20kmh cadence=85rpm power=226W
14:43:17.365Z  speed=20.03kmh cadence=86rpm power=217W    (settled)
```

(Test (a) happened during a window where the rider had stopped pedaling — IBD was all
zeros throughout, `44 00 00 00 00 00 00 00` — so no felt-resistance comparison is
available for that sub-test, only the ATT-level accept/reject outcomes.)

## Observations

1. **(a) All three commands accepted, in order, no rejections.** Cannot confirm the
   *felt* last-write-wins behavior (no pedaling data during this window), but at minimum
   the KICKR raises no protocol objection to ERG→SIM→ERG in quick succession.
2. **(b) The "concurrent unserialized write" scenario never reached the trainer.**
   Chrome's own Web Bluetooth implementation serializes GATT operations per
   characteristic client-side: the second `writeValueWithResponse` call, issued without
   awaiting the first, was rejected **synchronously by the browser** with
   `NetworkError: GATT operation already in progress` — before any bytes went over the
   air. The first call's write/indicate pair completed normally ~100ms later. **This
   means HW-V10(b) as originally scoped can't be run from a single compliant Web
   Bluetooth client** — the platform itself prevents the race the test matrix wanted to
   provoke. The KICKR's own ATT-level "Procedure Already In Progress" handling remains
   untested (would need two independent GATT clients/connections to actually race it).
3. **(c) Reset did NOT return the spec-predicted rejection.** The FTMS spec (§4.16.2.1)
   states Reset "returns defaults and relinquishes control," which would predict result
   `0x05` (Control Not Permitted) for the subsequent 0x11 without a fresh Request
   Control. Instead: **Success (`0x01`)**. This ATT-level result is a solid, deterministic
   fact — it's a status byte the trainer returned, not a measurement subject to rider
   variability, so there's no confound here: the KICKR did not reject the command.
   ~~**CORRECTED (see addendum below)**~~ I additionally claimed the IBD power rise
   (~175W→217W over ~7s) *proved* the command had a genuine physical effect — that claim
   does not hold up and has been walked back; see the addendum.

## Conclusion

**HW-V10: ANSWERED**, with one item (b) redefined by what was actually discovered:

- (a) No conflicts in ERG↔SIM interleave; felt-behavior confirmation deferred (need a
  pedaling window for a repeat).
- (b) **Not testable as originally scoped from a single Web Bluetooth client** — Chrome's
  own concurrency guard fires first. Design implication: our `ftmsQueue.ts` still needs
  to exist (for ordering/coalescing so we don't drop the second command outright, and to
  handle the `NetworkError` gracefully with a retry), but the specific "does the KICKR
  itself reject overlapping procedures" question would need either two independent tabs/
  connections or a non-browser BLE client to test properly. Low priority to pursue further
  — the practical takeaway (must handle `NetworkError: GATT operation already in
  progress` in the client) is what matters for implementation either way.
- (c) **This KICKR's Control Point does not return the spec-predicted rejection after
  Reset.** That specific ATT-level fact is solid. Whether the command also produced a
  *genuine, verifiable* resistance change is a separate, weaker claim — demoted to a
  **base validation** pending a confound-free retest (see addendum).

## Addendum — self-correction (user challenge, same session)

The original observation 3 / conclusion (c) treated the IBD power rise (~175W→217W over
~7s, roughly constant cadence/speed) as confirmation that the post-Reset grade command
had a real physical effect, not just an accepted no-op. **This is unjustified as stated**:
a human rider's own effort can drift upward over a 7-9 second window for reasons that
have nothing to do with the trainer — there was no control condition (e.g. an equivalent
window with no command sent) and no blinding (the rider wasn't kept unaware of when
commands were sent, so even subconscious reaction to "something changing" can't be ruled
out). One correlated trial is not evidence strong enough to rule out coincidence or
voluntary effort change. This is exactly the kind of single-trial conclusion that
shouldn't be treated as validated — filed as a **base validation, queued for revalidation**
in `00-test-matrix.md` §6, with a redesigned protocol that removes the effort confound
(primarily: check Machine Status 0x2ADA for an independent, effort-blind confirmation
that the trainer applied the new sim params, rather than inferring it from power).

**What remains solid from this experiment**: the ATT result code itself (`80 11 01`,
not `80 11 05`) — that's a deterministic protocol fact, unaffected by rider effort.
**What's now demoted to "base, needs revalidation"**: the claim that this also reflects
a genuine, confirmed physical resistance change.

## Confidence

**CONFIRMED**: (b)'s client-side blocking behavior; (c)'s ATT result code (Success, not
the spec-predicted Control Not Permitted) — protocol-level fact only.
**INFERRED**: (a)'s felt last-write-wins behavior (accepted at the protocol level, not
confirmed by resistance feel — no pedaling data in that window).
**BASE VALIDATION, NEEDS REVALIDATION**: (c)'s claim that the post-Reset command produced
a genuine, non-effort-confounded resistance change (power-trace evidence alone is
insufficient — see addendum and `00-test-matrix.md` §6).

## Follow-ups

- Repeat (a) with active pedaling throughout to get a felt-resistance comparison.
- If (b) is worth pursuing further, it needs two independent BLE clients/connections
  (e.g. a second laptop or nRF Connect) racing the same characteristic — not achievable
  from one Chrome tab.
- `ftmsQueue.ts` (P1 roadmap item) should catch and gracefully retry
  `NetworkError: GATT operation already in progress` rather than treating it as a hard
  failure — this is now a confirmed real error shape to handle, not a hypothetical.
- Update `VIRTUAL_SHIFTING_DESIGN.md` §4.4 (FTMS command layer) to note Reset's
  control-persistence behavior is trainer-specific — don't assume re-Request-Control is
  unnecessary on other hardware just because it was on this KICKR.
