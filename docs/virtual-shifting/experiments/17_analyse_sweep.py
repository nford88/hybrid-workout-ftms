#!/usr/bin/env python3
"""Experiment 17 analysis — does the KICKR honour the FTMS Crr/Cw bytes? (H31)

Joins the app's ride log to a Garmin FIT on absolute epoch timestamps, restricts to the two 0%
measurement blocks of each lap, and compares power across the six swept conditions at matched
cadence.

Run with the FIT venv (fitparse + numpy + scipy):
    .venv-fit/bin/python docs/virtual-shifting/experiments/17_analyse_sweep.py LOG.json ACTIVITY.fit

Why route distance is RECONSTRUCTED rather than read: `routeDistanceM` exists only on `sim`
events, and `setSimGrade`'s 0.3% deadband suppressed writes so hard that a whole lap produced
ten of them. Distance is therefore rebuilt at 1 Hz the same way the app integrates it — from
cadence through the drivetrain — and cross-checked against the sim events that do exist.
"""

import json
import sys
import datetime
import numpy as np
from fitparse import FitFile

WHEEL_M = 2.096
BLOCKS = {'A': (350, 745), 'B': (1300, 1700)}
BASELINE_GEAR = 12
CADENCE_MIN, CADENCE_MAX = 60, 105  # exclude coasting and spin-ups, keep the honest range
REF_CADENCE = 85.0


def load_log(path):
    d = json.load(open(path))
    ev = d['events']
    session = next(e['session'] for e in ev if e['type'] == 'session')
    steps = [e for e in ev if e['type'] == 'step']
    laps = []
    n = 0
    for i, s in enumerate(steps):
        if s['stepType'] != 'sim':
            continue
        n += 1
        end = steps[i + 1]['t'] if i + 1 < len(steps) else ev[-1]['t']
        laps.append({'lap': n, 't0': s['t'], 't1': end})
    conds = {
        e['data']['lap']: (e['data']['crr'], e['data']['cw'])
        for e in ev
        if e['type'] == 'note' and e['note'] == 'physicsApplied' and 'lap' in (e.get('data') or {})
    }
    for l in laps:
        l['crr'], l['cw'] = conds.get(l['lap'], (None, None))
    return d, ev, session, laps


def load_fit(path):
    """1 Hz arrays keyed by epoch seconds. FIT timestamps are naive UTC."""
    out = {}
    for rec in FitFile(path).get_messages('record'):
        f = {x.name: x.value for x in rec}
        ts = f.get('timestamp')
        if ts is None:
            continue
        epoch = ts.replace(tzinfo=datetime.timezone.utc).timestamp()
        out[int(epoch)] = {
            'power': f.get('power'),
            'cadence': f.get('cadence'),
            'speed': f.get('enhanced_speed') or f.get('speed'),
            'hr': f.get('heart_rate'),
        }
    return out


def build_samples(ev, laps, fit):
    """One row per 1 Hz telemetry event, with reconstructed route distance and the gear/condition
    in force. Gear and sent grade are step-held from the most recent `sim` event."""
    tel = [e for e in ev if e['type'] == 'telemetry']
    sims = [e for e in ev if e['type'] == 'sim']
    rows = []
    for lap in laps:
        t0, t1 = lap['t0'], lap['t1']
        lap_tel = [e for e in tel if t0 <= e['t'] < t1]
        lap_sims = [e for e in sims if t0 <= e['t'] < t1]
        dist = 0.0
        prev_t = t0
        for e in lap_tel:
            dt = (e['t'] - prev_t) / 1000.0
            prev_t = e['t']
            # The app's own integration: v_virt = cadence x ratio x circumference.
            held = [s for s in lap_sims if s['t'] <= e['t']]
            ratio = held[-1]['gearRatio'] if held else (lap_sims[0]['gearRatio'] if lap_sims else 2.4)
            gear = (held[-1]['gearIndex'] + 1) if held else None
            sent = held[-1]['sentGradePct'] if held else None
            raw = held[-1]['rawGradePct'] if held else None
            v = (e['cadenceRpm'] / 60.0) * ratio * WHEEL_M
            if 0 < dt < 10:
                dist += v * dt
            fr = fit.get(int(e['t'] / 1000), {})
            rows.append(
                {
                    'lap': lap['lap'],
                    'crr': lap['crr'],
                    'cw': lap['cw'],
                    't': e['t'],
                    'distM': dist,
                    'gear': gear,
                    'ratio': ratio,
                    'sent': sent,
                    'raw': raw,
                    'cadence': e['cadenceRpm'],
                    'power': e['powerW'],
                    'trainerKph': e['speedKph'],
                    'pw': fr.get('power') if fr.get('power') else (e['powerW'] or None),
                    'pwSrc': 'fit' if fr.get('power') else 'log',
                    'fitPower': fr.get('power'),
                    'fitCadence': fr.get('cadence'),
                    'fitHr': fr.get('hr'),
                }
            )
    return rows


def block_of(distM):
    for name, (lo, hi) in BLOCKS.items():
        if lo <= distM < hi:
            return name
    return None


def fmt(ln):
    return f"{ln['at_ref']:7.1f}" if ln else '      —'


def fit_line(x, y):
    """Least-squares slope/intercept, plus the value at REF_CADENCE."""
    if len(x) < 8 or np.std(x) < 1.0:
        return None
    A = np.vstack([x, np.ones(len(x))]).T
    slope, icpt = np.linalg.lstsq(A, y, rcond=None)[0]
    return {'slope': slope, 'intercept': icpt, 'at_ref': slope * REF_CADENCE + icpt}


def main():
    log_path = sys.argv[1] if len(sys.argv) > 1 else None
    fit_path = sys.argv[2] if len(sys.argv) > 2 else None
    if not log_path or not fit_path:
        print(__doc__)
        sys.exit(2)

    d, ev, session, laps = load_log(log_path)
    fit = load_fit(fit_path)
    rows = build_samples(ev, laps, fit)

    print('=' * 96)
    print('EXPERIMENT 17 — Crr/Cw sweep, H31')
    print('=' * 96)
    print(
        f"session: mass {session['massKg']} kg · phys ratio {session['physicalRatio']:.4f} "
        f"({session['chainringTeeth']}/{session['cogTeeth']}) · wheel {session['wheelCircumferenceM']} m"
    )
    print(f"ride log: {len(ev)} events, {len(d.get('earlierRuns', []))} archived earlier runs")
    print(f"FIT: {len(fit)} records")
    matched = sum(1 for r in rows if r['fitPower'] is not None)
    print(f"join: {matched}/{len(rows)} telemetry samples matched a FIT record on absolute time")
    if matched:
        dp = [r['power'] - r['fitPower'] for r in rows if r['fitPower'] is not None]
        print(f"      trainer-vs-FIT power agreement: median {np.median(dp):+.1f} W, "
              f"p95 |Δ| {np.percentile(np.abs(dp), 95):.1f} W")

    # ── distance reconstruction sanity ────────────────────────────────────────
    print('\n' + '-' * 96)
    print('DISTANCE RECONSTRUCTION CHECK (reconstructed vs the sim events that recorded it)')
    print('-' * 96)
    sims = [e for e in ev if e['type'] == 'sim']
    for lap in laps:
        ls = [s for s in sims if lap['t0'] <= s['t'] < lap['t1'] and s['routeDistanceM']]
        if not ls:
            continue
        errs = []
        for s in ls:
            near = min((r for r in rows if r['lap'] == lap['lap']), key=lambda r: abs(r['t'] - s['t']))
            errs.append(near['distM'] - s['routeDistanceM'])
        print(f"  lap {lap['lap']}: n={len(ls):2}  median error {np.median(errs):+7.1f} m  "
              f"max |err| {max(abs(e) for e in errs):6.1f} m  "
              f"reconstructed end {max(r['distM'] for r in rows if r['lap']==lap['lap']):.0f} m")

    # ── per-lap measurement blocks ────────────────────────────────────────────
    print('\n' + '=' * 96)
    print(f'MEASUREMENT BLOCKS — 0% only, gear {BASELINE_GEAR} only, cadence {CADENCE_MIN}-{CADENCE_MAX}')
    print('=' * 96)
    hdr = (f"{'lap':>3} {'crr':>6} {'cw':>5} {'blk':>4} {'n':>4} {'cad':>6} {'powW':>7} "
           f"{'sd':>5} {'P@85':>7} {'sent%':>7} {'raw%':>6}")
    print(hdr)
    per_cond = {}
    for lap in laps:
        for blk in BLOCKS:
            sel = [
                r for r in rows
                if r['lap'] == lap['lap']
                and block_of(r['distM']) == blk
                and r['gear'] == BASELINE_GEAR
                and CADENCE_MIN <= r['cadence'] <= CADENCE_MAX
                and r['pw'] is not None
                and r['pw'] > 0
            ]
            if len(sel) < 5:
                print(f"{lap['lap']:>3} {lap['crr']:>6} {lap['cw']:>5} {blk:>4} {len(sel):>4}   "
                      f"(too few samples)")
                continue
            cad = np.array([r['cadence'] for r in sel], float)
            pw = np.array([r['pw'] for r in sel], float)
            ln = fit_line(cad, pw)
            key = (lap['crr'], lap['cw'])
            per_cond.setdefault(key, []).append((lap['lap'], blk, cad, pw))
            print(
                f"{lap['lap']:>3} {lap['crr']:>6} {lap['cw']:>5} {blk:>4} {len(sel):>4} "
                f"{cad.mean():6.1f} {pw.mean():7.1f} {pw.std():5.1f} "
                f"{fmt(ln)} "
                f"{np.mean([r['sent'] for r in sel]):+7.3f} {np.mean([r['raw'] for r in sel]):+6.3f}"
            )

    # ── condition-level comparison ────────────────────────────────────────────
    print('\n' + '=' * 96)
    print('CONDITION SUMMARY (both blocks pooled, cadence-matched via regression to 85 rpm)')
    print('=' * 96)
    print(f"{'crr':>6} {'cw':>5} {'laps':>10} {'n':>5} {'cad':>6} {'mean W':>7} {'P@85':>7} {'sd':>6}")
    summary = {}
    for key in sorted(per_cond):
        chunks = per_cond[key]
        cad = np.concatenate([c[2] for c in chunks])
        pw = np.concatenate([c[3] for c in chunks])
        ln = fit_line(cad, pw)
        lapset = sorted({c[0] for c in chunks})
        summary[key] = {'n': len(pw), 'cad': cad.mean(), 'mean': pw.mean(),
                        'at85': ln['at_ref'] if ln else None, 'sd': pw.std(), 'laps': lapset}
        print(f"{key[0]:>6} {key[1]:>5} {str(lapset):>10} {len(pw):>5} {cad.mean():6.1f} "
              f"{pw.mean():7.1f} {fmt(ln)} {pw.std():6.1f}")

    # ── the actual test ───────────────────────────────────────────────────────
    print('\n' + '=' * 96)
    print('H31 VERDICT')
    print('=' * 96)
    base = summary.get((0.004, 0.51))
    if not base:
        print('no baseline condition found — cannot test')
        return
    # Baseline drift: laps 1/3/6 all sit at the baseline condition.
    base_laps = {}
    for lap, blk, cad, pw in per_cond[(0.004, 0.51)]:
        base_laps.setdefault(lap, []).append(pw)
    drift = {l: float(np.concatenate(v).mean()) for l, v in base_laps.items()}
    print(f"baseline (Crr 0.004 / Cw 0.51) per-lap mean power: "
          + ', '.join(f'lap {l} = {p:.1f} W' for l, p in sorted(drift.items())))
    spread = (max(drift.values()) - min(drift.values())) if len(drift) > 1 else float('nan')
    print(f"  → baseline spread = {spread:.1f} W. This is the noise floor; every claim below is "
          f"judged against it.")

    tests = [
        ('Crr sweep 0.004 → 0.020', (0.02, 0.51), 109.0),
        ('Cw sweep 0.51 → 0.20', (0.004, 0.2), -112.0),
        ('mid-point 0.011 / 0.36', (0.011, 0.36), None),
    ]
    print()
    for label, key, predicted in tests:
        s = summary.get(key)
        if not s:
            print(f"{label}: condition not present")
            continue
        d_mean = s['mean'] - base['mean']
        d_ref = (s['at85'] - base['at85']) if (s['at85'] and base['at85']) else float('nan')
        verdict = ''
        if predicted is not None:
            frac = d_ref / predicted if predicted else float('nan')
            if abs(d_ref) < spread:
                verdict = 'NULL — inside the baseline noise floor'
            elif 0.5 <= frac <= 1.5:
                verdict = f'HONOURED — {frac*100:.0f}% of predicted'
            elif frac > 0:
                verdict = f'PARTIAL — same sign, {frac*100:.0f}% of predicted'
            else:
                verdict = f'WRONG SIGN — {frac*100:.0f}% of predicted'
        print(f"{label}")
        print(f"   Δ mean power   {d_mean:+8.1f} W")
        print(f"   Δ at 85 rpm    {d_ref:+8.1f} W" + (f"   (predicted {predicted:+.0f} W)" if predicted else ""))
        print(f"   verdict        {verdict}")
        print()

    # P4 — sent-grade invariance actually observed
    print('-' * 96)
    print('P4 — sent grade in the 0% blocks (should be condition-INVARIANT within 0.07 pp)')
    print('-' * 96)
    for key in sorted(per_cond):
        sel = [r for r in rows
               if (r['crr'], r['cw']) == key and block_of(r['distM']) in BLOCKS
               and r['gear'] == BASELINE_GEAR and r['sent'] is not None]
        if sel:
            v = [r['sent'] for r in sel]
            print(f"  Crr {key[0]:<6} Cw {key[1]:<5} sent grade mean {np.mean(v):+.3f}%  "
                  f"(min {min(v):+.3f}, max {max(v):+.3f}, n={len(v)})")


if __name__ == '__main__':
    main()
