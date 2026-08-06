# 18 — Crr/Cw paired toggle (pre-registration)

**Drafted:** 2026-08-06 · **Status:** pre-registration, not yet ridden
**Hardware:** Wahoo KICKR CORE C26B fw 1.5.36, Zwift Click pair fw 1.2, Zwift Cog 34/14, 97 kg
**Answers:** H31 properly (17 only got it directionally) · supersedes 17's design, not its findings

---

## 1. Why not just repeat 17

17 established the direction — Crr is honoured, ~84% of the road-model prediction — but could not
pin the magnitude, and left Cw unresolved. Three reasons, all design rather than execution:

1. **One lap per condition.** "The trainer honoured the byte" and "the rider pushed harder that
   lap" are the same observation. Per-bin scatter reached **±190 W** against an ~85 W effect.
2. **40% of grade writes never arrived** (`GATT operation already in progress`, 64 of 159). Fixed
   since — the Control Point is now serialised — but it means 17's numbers came from a trainer
   that was frequently acting on a stale grade.
3. **Block B was not comparable to block A.** It follows the 6% climb, so the rider was recovering:
   73-116 W versus 172-257 W at the same grade and gear.

## 2. The design

**Toggle the condition every 90 s inside one continuous effort**, holding one gear and one cadence
throughout. Each A/B pair is then 90 seconds apart rather than a lap apart, so fatigue and thermal
drift — both slow — cancel in the pairing instead of having to be modelled. This is the standard
answer to a slow-drift confound and it is what 17 lacked.

|             |                                                                            |
| ----------- | -------------------------------------------------------------------------- |
| Route       | 8 km at **exactly 0%** — grade term vanishes, resistance is Crr + Cw alone |
| Rider state | **gear 12 (ratio 2.40), 75 rpm, no shifting, nothing touched**             |
| Phase 1     | Crr toggles **0.004 ↔ 0.020**, Cw pinned 0.51                              |
| Phase 2     | Cw toggles **0.51 ↔ 0.20**, Crr pinned 0.004                               |
| Block       | 90 s · 8 blocks per phase · 4 pairs per phase                              |
| Total       | 5 min warm-up + 12 + 3 rest + 12 + 5 cool-down ≈ **37 min**                |

75 rpm rather than 17's 85: at 85 the 0% target was ~211 W against an FTP of 220, unholdable for
12 unbroken minutes. At 75 rpm `v_virt` = 6.29 m/s and the baseline target is ~150 W, while the
predicted Crr effect stays large (**97 × 9.81 × 0.016 × v**, so ~83 W at the trainer's own
5.5 m/s). One variable at a time, always.

**The route is deliberately far longer than the session.** A SIM step ends on route completion, so
an 8 km route at ~6 m/s cannot finish inside 12 minutes and cannot auto-advance underneath the
schedule. The script ends each phase itself after 8 blocks, so both sides get equal _time_
regardless of how fast the rider goes.

## 3. Why this needs a script at all

**Changing Crr does not change the grade, and `setSimGrade` only writes when the grade moves 0.3%
or 3 s have elapsed.** On a dead-flat route a condition change would therefore never be
transmitted at all. Every toggle forces a write
([main.js](../../../src/js/main.js), `forceUpdate: true`). In 17 this was masked because each lap
began with `startSimStep`'s ramp, which wrote the new values as a side effect — a lucky accident
that does not survive a mid-step toggle.

## 4. Artifacts

| File                                                           | Use                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| [`18-install-toggle-workout.js`](18-install-toggle-workout.js) | Paste into the console — installs route + 5-step workout, reloads         |
| [`18-auto-toggle.js`](18-auto-toggle.js)                       | Paste into the console — toggling schedule **and** the on-bike HUD in one |
| [`18-flat-8km-route.json`](18-flat-8km-route.json)             | The route (origin (0,0), synthetic, no personal location)                 |
| [`make_toggle_route.py`](make_toggle_route.py)                 | Regenerates the route                                                     |

## 5. Running it

1. `npm run dev`, open in Chrome.
2. Paste `18-install-toggle-workout.js` → reloads with route + 5 steps.
3. Connect the trainer. Connect the Click.
4. **Verify the Click before starting**: press a paddle and watch the console for
   `[CLICK] shiftDown → performed`. That logging is new — 17 could not tell a dead link from an
   ignored press, which is exactly the hole that made the paddle failure unexplainable.
5. `rideLog.resetRideLog()` for a clean export.
6. Paste `18-auto-toggle.js`. HUD appears, condition set to side A.
7. Garmin recording on → **Start Workout**.
8. **Hold gear 12 at 75 rpm for 12 minutes. Do not shift. Do not touch anything.** The HUD goes
   red if either drifts. Easy 3 min rest, then the second phase, same rules.
9. Export the ride log JSON **and** the FIT.

## 6. Pre-registered predictions

- **P1 — Crr honoured.** Paired A→B power difference **+80 to +90 W**, consistent in sign across
  all 4 pairs in phase 1. Confirms 17 and pins the magnitude.
- **P2 — Cw honoured.** Paired difference **−30 to −50 W** (Δcw·v³ at v ≈ 5.5-6.3 m/s), consistent
  in sign across all 4 pairs in phase 2. 17 could not establish this at all.
- **P3 — Cw ignored.** Phase 2 differences scatter around zero and are smaller than the
  within-side spread. Equally decisive: it would mean the trainer implements rolling resistance
  and not aero, which is worth knowing and is not documented anywhere we have found.
- **P4 — grade invariance, again.** Sent grade stays ≈0 and condition-invariant throughout, as it
  did in 17 (within 0.10 pp). If it does not, the gear drifted off baseline.
- **P5 — writes now land.** Near-zero `GATT operation already in progress` in the console, versus
  64 of 159 in 17. This validates the serialisation fix on hardware.

## 7. What makes this analysable that 17 was not

The ride log now records, on **every 1 Hz sample**: power (17 recorded `0` throughout — a
field-name bug), route distance, gear index and ratio, sent grade, and the Crr/Cw in force. 17's
analysis had to reconstruct distance by re-integrating cadence and step-hold the rest from ten
`sim` events per lap. Nothing in 18 needs reconstructing.

Analysis: [`17_analyse_sweep.py`](17_analyse_sweep.py) is the starting point, but a paired design
wants a simpler statistic — mean power per 90 s block, differenced within consecutive A/B pairs,
discarding the first ~20 s of each block for the resistance change to settle.
