# 02 — Firmware/Model Identification (HW-V1)

**Date**: 2026-07-28
**Method**: user checked device info directly (Wahoo app for the trainer; presumably the
Click's own companion/pairing flow or a BLE info screen for the controllers) — not
captured via the harness for this one, reported directly.

## Hypothesis

Trainer firmware is ≥1.3.17 (gates Plan A′ entirely); exact model/hardware revision
disambiguates the "KICKR Core V2" vs "KICKR CORE 2" naming ambiguity (U11).

## Raw reported data

- **Trainer**: `KICKR CORE C26B`, firmware **1.5.36**.
- **Controller(s)**: **two** physical units reported — `Zwift Click Left` and
  `Zwift Click Right`, both firmware **1.2**. MAC addresses were also offered by the user
  but not yet recorded here (not obviously useful until/unless we need to disambiguate
  the two units at the BLE layer beyond their advertised names — noted as available if
  needed).

## Observations

1. **Firmware 1.5.36 ≫ 1.3.17** — comfortably past the threshold Zwift Insider cites for
   native virtual-shifting support being added to all existing Cores (2024-02-08 release).
   **Plan A′ (HW-V9) is gated open** — nothing here blocks attempting it.
2. **"C26B" is a BLE-advertised name suffix, not a hardware-revision string** — doesn't by
   itself resolve whether this unit is the hardware Wahoo internally calls "Core V2" vs.
   the 2025 "CORE 2" product. Low priority per the design doc (U11 was already flagged
   low-stakes); parking further disambiguation unless it becomes relevant.
3. **Unplanned discovery: the user owns *two* Click controllers, not one** — "Zwift Click
   Left" and "Zwift Click Right", both fw 1.2. This wasn't in the original hardware
   inventory (GOALS.md lists a single Click). Two real possibilities, not yet
   distinguished: (a) these are just two independently-purchased Click units the user
   happens to have (e.g. one per hand on drop bars), functionally identical, or (b) some
   other left/right-specific pairing behavior. Firmware matching (1.2/1.2) is consistent
   with (a) — two ordinary units. **This changes scope for HW-V2 onward**: both units
   should be identified/characterized (at least confirm they share the same byte grammar),
   and it raises a new design question — see follow-ups.
4. No firmware-era inference was attempted from "1.2" for the Click's advertised-service
   split (legacy `19ca...` vs `0xFC82`, the Jan-2025 change) — that's what HW-V3 is for;
   don't guess from the version number alone.

## Conclusion

**HW-V1: ANSWERED.** Firmware clears the Plan A′ gate. Model-string ambiguity (U11)
remains open but is low priority. New fact: two Click units on the bench, not one.

## Confidence

**CONFIRMED** for firmware version and Plan A′ gate (direct user report from the Wahoo
app). **UNKNOWN** for the model-line disambiguation (U11 stays open, low priority).

## Follow-ups

- Run HW-V2/V3/V4 against **both** Click units (sequentially — the harness currently has
  one controller slot; reconnect the second unit into the same slot after finishing the
  first) to confirm they share byte grammar and firmware behavior.
- **New open design question, not a hardware unknown**: does the production feature need
  to support *two simultaneous* Click controllers (e.g. either hand can shift), or is one
  sufficient for v1 and the second treated as a spare/redundant unit? Needs a product
  decision from the user, not a bench experiment — parked pending that answer, doesn't
  block current characterization work.
- Rider-mass discussion (below) ties into HW-V8 and adds a new consideration for HW-V9 —
  see the updated notes in `00-test-matrix.md` items 9 and 16, and `HYPOTHESES.md` U3.
