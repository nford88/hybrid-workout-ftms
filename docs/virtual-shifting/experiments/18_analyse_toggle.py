#!/usr/bin/env python3
"""
Experiment 18 — paired A/B difference analyser.

Usage:
    .venv-fit/bin/python docs/virtual-shifting/experiments/18_analyse_toggle.py RIDE_LOG.json [ACTIVITY.fit]

Why paired differences and nothing else
---------------------------------------
17 compared absolute power against the road model and got the sign of the Crr result WRONG before
being corrected: the model over-predicts absolute power by ~63 W at baseline (MAE ~120 W, negative
R² for every variant), so any absolute comparison is dominated by model error. Per-bin scatter
reached ±190 W against an ~85 W effect.

This analyser therefore never compares power to a prediction. It compares power to power, 90 s
apart, within a single continuous effort at fixed gear and cadence. Slow drift — fatigue, thermal,
tyre warm-up — is common to both members of a pair and cancels in the difference.

Design decisions that are load-bearing
--------------------------------------
* **Blocks come from the log's own `physicsApplied` notes**, not from wall-clock arithmetic. The
  note is written at the moment the condition is transmitted, so it is the ground truth for when
  each block began; assuming 90 s spacing would silently absorb any scheduling jitter.
* **The first `SETTLE_S` of every block is discarded.** The trainer ramps to a new resistance and
  the rider's power lags it; including the transient biases every block toward its predecessor.
* **Pairs are consecutive (A,B) blocks within one phase.** Comparing across a phase boundary would
  span the 3-minute rest and reintroduce the drift the design exists to remove.
* **Conditions are audited from per-sample telemetry, not from the notes.** `54f511a` and the
  reconstruction hack in 17 both came from trusting a summary over the samples. If the telemetry
  disagrees with the notes, the telemetry wins and the run is reported as deviating.
"""

import json
import sys
from collections import defaultdict
from statistics import fmean, median, stdev

SETTLE_S = 20.0  # discard after each condition change, for the resistance to take effect
MIN_SAMPLES = 15  # a block with fewer usable samples than this is not trustworthy


def load(path):
    with open(path) as fh:
        doc = json.load(fh)
    return doc["events"] if isinstance(doc, dict) else doc


def audit_conditions(telemetry):
    """What was actually SENT, per sample. The notes say what we asked for; this says what stuck."""
    pairs = defaultdict(int)
    for s in telemetry:
        if s.get("crr") is not None and s.get("cw") is not None:
            pairs[(round(s["crr"], 5), round(s["cw"], 3))] += 1
    return dict(sorted(pairs.items(), key=lambda kv: -kv[1]))


def build_blocks(events):
    """One block per `physicsApplied` note, closed by the next note or the end of the ride."""
    notes = [
        e
        for e in events
        if e.get("type") == "note" and e.get("note") == "physicsApplied" and e.get("data", {}).get("auto")
    ]
    telemetry = [e for e in events if e.get("type") == "telemetry"]

    # A block ends at the NEXT toggle *or* at `phaseComplete`, whichever comes first. Closing the
    # last block of a phase at the next toggle instead ran it through the 3-minute ERG rest that
    # follows: the first version of this script reported those blocks at 270-408 s and ~88 W, and
    # the resulting +30 W "differences" were an artefact of the rest step, not the condition.
    phase_ends = sorted(
        e["t"] for e in events if e.get("type") == "note" and e.get("note") == "phaseComplete"
    )
    end_t = max((e["t"] for e in events), default=0)

    def block_stop(start, next_start):
        after = [t for t in phase_ends if t > start]
        candidates = [t for t in (next_start, after[0] if after else None, end_t) if t is not None]
        return min(candidates)

    blocks = []
    for i, n in enumerate(notes):
        d = n["data"]
        start = n["t"]
        stop = block_stop(start, notes[i + 1]["t"] if i + 1 < len(notes) else None)
        window = [
            s
            for s in telemetry
            if start + SETTLE_S * 1000 <= s["t"] < stop
            and s.get("powerW") is not None
            and s.get("cadenceRpm") is not None
        ]
        blocks.append(
            {
                "phase": d.get("phase"),
                "side": d.get("side"),
                "toggleIndex": d.get("toggleIndex"),
                "crr": d.get("crr"),
                "cw": d.get("cw"),
                "start": start,
                "duration_s": (stop - start) / 1000.0,
                "n": len(window),
                "power": fmean([s["powerW"] for s in window]) if window else None,
                "cadence": fmean([s["cadenceRpm"] for s in window]) if window else None,
                "speed": fmean([s["speedKph"] for s in window]) if window else None,
                "gears": sorted({s["gearIndex"] + 1 for s in window if s.get("gearIndex") is not None}),
                "grades": sorted({round(s["sentGradePct"], 2) for s in window if s.get("sentGradePct") is not None}),
            }
        )
    return blocks, telemetry


def main():
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    events = load(sys.argv[1])
    blocks, telemetry = build_blocks(events)

    session = next((e["session"] for e in events if e.get("type") == "session"), {})
    print("=" * 78)
    print("EXPERIMENT 18 — PAIRED A/B DIFFERENCE")
    print("=" * 78)
    print(
        f"mass {session.get('massKg')} kg · drivetrain {session.get('chainringTeeth')}/"
        f"{session.get('cogTeeth')} (ratio {session.get('physicalRatio', 0):.3f}) · "
        f"{len(telemetry)} telemetry samples"
    )
    print(f"settle discarded: {SETTLE_S:.0f} s per block\n")

    print("-- CONDITIONS ACTUALLY SENT (per-sample telemetry) " + "-" * 27)
    for (crr, cw), n in audit_conditions(telemetry).items():
        print(f"   crr={crr:<7} cw={cw:<5} {n:5d} samples")
    print()

    # Grouped by phase NAME and then into separate RUNS, detected by `toggleIndex` resetting to 0.
    # Both phases of this ride reported the same name, so keying on name alone silently merged two
    # 12-minute efforts either side of a rest into one 16-block sequence.
    by_phase = defaultdict(list)
    for b in blocks:
        runs = by_phase[b["phase"]]
        if not runs or (b["toggleIndex"] == 0 and runs[-1]):
            runs.append([])
        runs[-1].append(b)

    print("-- BLOCKS " + "-" * 67)
    hdr = f"{'run':<4} {'#':>2} {'side':<4} {'crr':<7} {'cw':<5} {'n':>4} {'dur':>5} {'power':>7} {'cad':>6} {'kph':>6} gear"
    print(hdr)
    for phase, runs in by_phase.items():
      for run_no, bs in enumerate(runs, start=1):
        for b in bs:
            flag = "" if b["n"] >= MIN_SAMPLES else "  <-- TOO FEW SAMPLES"
            if abs(b["duration_s"] - 90) > 15:
                flag += f"  <-- DURATION {b['duration_s']:.0f}s, not 90s"
            print(
                f"{phase}{run_no:<3} {b['toggleIndex']:>2} {b['side']:<4} {b['crr']:<7} {b['cw']:<5} "
                f"{b['n']:>4} {b['duration_s']:>5.0f} "
                f"{(b['power'] or 0):>7.1f} {(b['cadence'] or 0):>6.1f} {(b['speed'] or 0):>6.1f} "
                f"{b['gears']}{flag}"
            )
    print()

    print("-- PAIRED DIFFERENCES (B - A, non-overlapping consecutive pairs) " + "-" * 14)
    any_pairs = False
    for phase, runs in by_phase.items():
      for run_no, bs in enumerate(runs, start=1):
        usable = [b for b in bs if b["power"] is not None and b["n"] >= MIN_SAMPLES]
        diffs, rows = [], []
        # NON-OVERLAPPING pairs: (0,1), (2,3), (4,5), (6,7) — 8 blocks give 4 pairs, which is the
        # pre-registered design. Sliding the window instead reused every block twice and inflated
        # 16 blocks into 15 "pairs", making the sample look larger than it is.
        for i in range(0, len(usable) - 1, 2):
            x, y = usable[i], usable[i + 1]
            if x["side"] == y["side"]:
                continue  # not an A/B pair
            a, b_ = (x, y) if x["side"] == "A" else (y, x)
            d = b_["power"] - a["power"]
            diffs.append(d)
            rows.append((a["toggleIndex"], b_["toggleIndex"], a["power"], b_["power"], d,
                         b_["cadence"] - a["cadence"],
                         fmean([a["speed"], b_["speed"]]), b_["cw"] - a["cw"]))
        if not rows:
            print(f"  {phase} run {run_no}: no usable pairs")
            continue
        any_pairs = True
        print(f"\n  PHASE {phase} — RUN {run_no}  ({len(rows)} pairs)")
        print(f"    {'A#':>3} {'B#':>3} {'A power':>8} {'B power':>8} {'B-A':>8} {'Δcad':>6}")
        for r in rows:
            print(f"    {r[0]:>3} {r[1]:>3} {r[2]:>8.1f} {r[3]:>8.1f} {r[4]:>+8.1f} {r[5]:>+6.1f}")
        # Predicted effect, from the TRAINER's own reported speed — not v_virt. Using v_virt is the
        # error that made 17's Crr result read as 53% of prediction before correction; the trainer
        # integrates its own speed through its road model, so that is the speed the model must use.
        # FTMS wind-resistance coefficient has units kg/m, so drag power = Cw * v^3.
        v = fmean([r[6] for r in rows]) / 3.6
        dcw = fmean([r[7] for r in rows])
        pred = dcw * v ** 3
        mean_d = fmean(diffs)
        print(f"    predicted {pred:+.1f} W  (Δcw {dcw:+.3f} at trainer speed {v:.2f} m/s)")
        if abs(pred) > 1e-9:
            print(f"    observed / predicted = {100 * mean_d / pred:+.1f}%")
        print(f"    mean {mean_d:+.1f} W · median {median(diffs):+.1f} W", end="")
        if len(diffs) > 1:
            sd = stdev(diffs)
            print(f" · sd {sd:.1f} W · sem {sd / len(diffs) ** 0.5:.1f} W", end="")
        print()
        signs = {d > 0 for d in diffs}
        print(f"    consistent in sign: {'YES' if len(signs) == 1 else 'NO'} "
              f"({sum(d > 0 for d in diffs)}/{len(diffs)} positive)")

    if not any_pairs:
        print("  nothing pairable — check the blocks table above")

    # Execution quality: the protocol's whole validity rests on gear and cadence being held.
    print("\n-- EXECUTION " + "-" * 64)
    cads = [s["cadenceRpm"] for s in telemetry if s.get("cadenceRpm")]
    gears = sorted({s["gearIndex"] + 1 for s in telemetry if s.get("gearIndex") is not None})
    if cads:
        print(f"cadence: mean {fmean(cads):.1f} rpm, sd {stdev(cads):.1f}, "
              f"range {min(cads):.0f}-{max(cads):.0f} (target 75 ± 6)")
    print(f"gears seen in telemetry: {gears} (protocol requires 12 only)")
    grades = sorted({round(s["sentGradePct"], 2) for s in telemetry if s.get("sentGradePct") is not None})
    print(f"sent grades: {grades} (flat route — should be ~0)")


if __name__ == "__main__":
    main()
