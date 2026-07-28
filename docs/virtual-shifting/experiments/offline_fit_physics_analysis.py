#!/usr/bin/env python3
"""Offline, full-precision re-analysis of the FTMS virtual-shifting drivetrain physics
model (rider mass, Crr, Cw) from real outdoor FIT files.

Replaces the intervals.icu JS-sandbox approach
(intervals-icu-power-model-chart.js / intervals-icu-calibration-field.js), which hit real
precision limits: downsampling to 300-800 samples and a coarse 15x11 (chart) / 6x6 (field)
discrete Crr/Cw grid for Method C. See experiments/09-outdoor-stream-physics-regression.md
for the full history and experiments/10-offline-fit-physics-analysis.md for this script's
results.

Model (docs/VIRTUAL_SHIFTING_DESIGN.md #4.3), reproduced exactly from the JS scripts:
    P = m*g*v*(sin(theta) + Crr*cos(theta)) + Cw*v^3,   theta = atan(grade/100)

Three fitting methods, same logic as the JS scripts (Method A naive regression, Method B
flat-segment sweep, Method C Chung/virtual-elevation), with two precision upgrades:
  - no downsampling (every valid sample used; these FIT files are 4-8k samples, well under
    the >50,000 threshold where downsampling would even be considered)
  - Method C is a continuous joint (mass, Crr, Cw) optimization via scipy.optimize, not a
    discrete grid search

Usage:
    python3 offline_fit_physics_analysis.py <fit_file.fit> [<fit_file.fit> ...]
    python3 offline_fit_physics_analysis.py --fixed-mass=97.0 <fit_file.fit> [...]

--fixed-mass=<kg>: hold rider+bike mass at this independently-known value (e.g. a scale
reading) instead of treating it as a free Method C search parameter. Reruns Method C
with only Crr/Cw optimized; this is the top follow-up from experiments/10's root-cause
finding (mass->infinity is a degenerate direction in the free 3-parameter search).

Never commit raw FIT files, per-second CSV dumps, or GPS/location fields (position_lat/
position_long are read only to be discarded) — see docs/VIRTUAL_SHIFTING_DESIGN.md
"Constraints". This script only prints aggregate numbers and writes aggregate PNG plots.
"""

import sys
import os
import json
import numpy as np
from scipy.optimize import minimize
import fitparse

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
except ImportError:
    plt = None

# ---- Config (mirrors intervals-icu-power-model-chart.js's MODEL constants) ----
G = 9.80665
V_MIN_MS = 1.0  # coasting/near-stop guard (design doc #4.3), matches the JS scripts
FLAT_GRADE_PCT = 0.5
TRAINER_M, TRAINER_CRR, TRAINER_CW = 93.3, 0.004, 0.51  # HW-V8 trainer-side regression
CLIMB_GRADE_PCT = 2.0
MIN_CLIMB_SAMPLES = 20
CURVE_BIN_PCT = 1.0
CURVE_MIN_BIN_SAMPLES = 5
MIN_CHART_GRADE_PCT = 0.0  # exclude descents from curve/residual panels, same as JS
GAP_MAX_S = 10  # recording gap guard, matches JS
STRIDE_THRESHOLD = 50_000  # only downsample above this many raw samples (none of ours do)

MASS_BOUNDS = (40.0, 150.0)
CRR_BOUNDS = (0.001, 0.02)
CW_BOUNDS = (0.05, 0.7)

ALT_SMOOTH_SECONDS = 15  # centered moving-average window, in seconds (adapted to actual
                          # sample rate below, per-ride) -- matches JS's ALT_SMOOTH_PTS=15
                          # at ~1Hz
GRADE_HALF_WINDOW_SECONDS = 5  # matches JS's fixed w=5 at ~1Hz

# Rider mass seed for Method C: intervals.icu's JS scripts seed from
# icu.wellness.weight + BIKE_MASS_KG, which isn't available from a bare FIT file (FIT
# records carry no rider/bike mass field). Seeding instead from this session's own prior
# Method C results (98.2kg, 98.0kg on two earlier rides, 97.0/97.2kg on three more via the
# coarse grid) -- consistent, plausible, and an honest documented assumption rather than a
# guess (see the findings doc's "Assumptions" section).
RIDER_MASS_SEED = 97.0
CRR_SEED = 0.006  # between the trainer's 0.004 and the prior fits' 0.0085-0.016
CW_SEED = 0.30  # neutral: literature midpoint and where all 3 coarse-grid rides landed

# Previously-logged sandboxed results (experiments/09), for before/after comparison where
# a FIT file's date genuinely matches one of these.
KNOWN_RIDES = [
    {"label": "Ride A (coarse field script)", "date": "2026-07-13", "mass": 97.0,
     "crr": 0.011, "cw": 0.30, "samples": 300, "note": "6x6 grid"},
    {"label": "Ride A (fine chart script)", "date": "2026-07-13", "mass": 97.0,
     "crr": 0.009, "cw": 0.35, "samples": 800, "note": "15x11=165-combo grid"},
    {"label": "Ride B (coarse field script)", "date": "2026-07-03", "mass": 97.2,
     "crr": 0.016, "cw": 0.30, "samples": 300, "note": "6x6 grid"},
    {"label": "Ride C (coarse field script)", "date": "2026-06-23", "mass": 113.2,
     "crr": 0.0085, "cw": 0.30, "samples": 300,
     "note": "mass search hit its boundary -- unreliable"},
]


# ---------------------------------------------------------------------------
# FIT parsing
# ---------------------------------------------------------------------------

def parse_fit(path):
    fit = fitparse.FitFile(path)
    records = list(fit.get_messages("record"))
    n = len(records)
    time = np.full(n, np.nan)
    watts = np.full(n, np.nan)
    v = np.full(n, np.nan)
    alt = np.full(n, np.nan)
    dist = np.full(n, np.nan)
    grade_direct = np.full(n, np.nan)
    cadence = np.full(n, np.nan)

    field_names_seen = set()
    start_ts = None
    for i, rec in enumerate(records):
        d = {f.name: f.value for f in rec}
        field_names_seen.update(d.keys())
        ts = d.get("timestamp")
        if ts is not None:
            if start_ts is None:
                start_ts = ts
            time[i] = ts.timestamp()
        p = d.get("power")
        if p is not None:
            watts[i] = p
        vv = d.get("enhanced_speed")
        if vv is None:
            vv = d.get("speed")
        if vv is not None:
            v[i] = vv
        a = d.get("enhanced_altitude")
        if a is None:
            a = d.get("altitude")
        if a is not None:
            alt[i] = a
        dd = d.get("distance")
        if dd is not None:
            dist[i] = dd
        g = d.get("grade")
        if g is not None:
            grade_direct[i] = g
        c = d.get("cadence")
        if c is not None:
            cadence[i] = c

    return {
        "time": time, "watts": watts, "v": v, "alt": alt, "dist": dist,
        "grade_direct": grade_direct, "cadence": cadence,
        "start_ts": start_ts, "n": n, "field_names_seen": sorted(field_names_seen),
    }


def match_known_ride(start_ts):
    """Match a FIT start timestamp to a previously-logged sandboxed ride by calendar date.
    FIT `timestamp` fields are UTC; intervals.icu's start_date_local is local wall-clock,
    so an exact-hour match isn't expected -- same calendar date (allowing a same-day UTC/
    local offset) is the bar."""
    date_str = start_ts.strftime("%Y-%m-%d")
    matches = [r for r in KNOWN_RIDES if r["date"] == date_str]
    return matches


# ---------------------------------------------------------------------------
# Signal processing (grade derivation, moving-average) -- mirrors the JS scripts' logic
# ---------------------------------------------------------------------------

def centered_moving_avg(arr, points):
    n = len(arr)
    half = max(1, points // 2)
    out = np.empty(n)
    for i in range(n):
        lo = max(0, i - half)
        hi = min(n - 1, i + half)
        window = arr[lo:hi + 1]
        valid = window[~np.isnan(window)]
        out[i] = valid.mean() if len(valid) else arr[i]
    return out


def derive_grade_from_altitude(alt, dist, median_dt):
    """Centered-moving-average smooth of altitude, then a finite difference against
    distance over a similar window -- exact port of the JS scripts' fallback grade
    derivation, with the window sizes adapted from a fixed sample count (assumes ~1Hz) to
    an actual-seconds duration (works at any real FIT sample rate)."""
    n = len(alt)
    smooth_pts = max(3, round(ALT_SMOOTH_SECONDS / median_dt))
    half_w = max(1, round(GRADE_HALF_WINDOW_SECONDS / median_dt))

    alt_fill = alt.copy()
    nanmask = np.isnan(alt_fill)
    if nanmask.any() and not nanmask.all():
        good_idx = np.flatnonzero(~nanmask)
        alt_fill[nanmask] = np.interp(np.flatnonzero(nanmask), good_idx, alt_fill[good_idx])

    alt_smooth = centered_moving_avg(alt_fill, smooth_pts)
    grade = np.zeros(n)
    w = half_w
    for i in range(w, n - w):
        if np.isnan(dist[i + w]) or np.isnan(dist[i - w]):
            continue
        dd = dist[i + w] - dist[i - w]
        if dd > 0.5:
            grade[i] = 100 * (alt_smooth[i + w] - alt_smooth[i - w]) / dd
    return grade, smooth_pts, half_w


# ---------------------------------------------------------------------------
# Build the working (filtered, moving-only, coasting-guarded) sample set.
# No downsampling: every valid sample is kept (all 3 rides are well under the 50,000-
# sample stride threshold where the JS scripts' memory/CPU concerns would even apply).
# ---------------------------------------------------------------------------

def build_samples(d, grade):
    time, watts, v, alt, cadence = d["time"], d["watts"], d["v"], d["alt"], d["cadence"]
    n = d["n"]
    P, V, A, Gr, T, Alt, Cad = [], [], [], [], [], [], []
    for i in range(1, n):
        dt = time[i] - time[i - 1]
        if not (0 < dt <= GAP_MAX_S):
            continue
        if np.isnan(v[i]) or np.isnan(watts[i]) or np.isnan(grade[i]):
            continue
        if v[i] < V_MIN_MS:
            continue
        a = (v[i] - v[i - 1]) / dt if not np.isnan(v[i - 1]) else 0.0
        P.append(watts[i]); V.append(v[i]); A.append(a); Gr.append(grade[i])
        T.append(time[i])
        Alt.append(alt[i] if not np.isnan(alt[i]) else None)
        Cad.append(cadence[i] if not np.isnan(cadence[i]) else None)
    return (np.array(P), np.array(V), np.array(A), np.array(Gr), np.array(T),
            Alt, Cad, n)


def mean(a):
    return float(np.mean(a)) if len(a) else float("nan")


def corr(a, b):
    a, b = np.asarray(a), np.asarray(b)
    if len(a) < 2:
        return float("nan")
    sa, sb = a.std(), b.std()
    if sa == 0 or sb == 0:
        return float("nan")
    return float(np.corrcoef(a, b)[0, 1])


# ---------------------------------------------------------------------------
# Physics model
# ---------------------------------------------------------------------------

def predict_power_steady(m, crr, cw, v, grade_pct):
    theta = np.arctan(grade_pct / 100.0)
    return m * G * v * (np.sin(theta) + crr * np.cos(theta)) + cw * v ** 3


def predict_power_accel(m, crr, cw, v, grade_pct, a):
    """Acceleration-inclusive variant: P_accel = P_steady + m*a*v (kinetic-energy term)."""
    return predict_power_steady(m, crr, cw, v, grade_pct) + m * a * v


# ---------------------------------------------------------------------------
# Method A -- naive whole-ride 3-parameter regression (P = m*g*sinT*v + m*g*Crr*cosT*v + Cw*v^3)
# ---------------------------------------------------------------------------

def method_a_naive(P, V, Gr):
    theta = np.arctan(Gr / 100.0)
    reg1 = np.sin(theta) * V
    reg2 = np.cos(theta) * V
    reg3 = V ** 3
    X = np.column_stack([reg1, reg2, reg3])
    coeffs, _, _, _ = np.linalg.lstsq(X, P, rcond=None)
    pred = X @ coeffs
    ss_res = np.sum((P - pred) ** 2)
    ss_tot = np.sum((P - P.mean()) ** 2)
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else float("nan")
    mass = coeffs[0] / G
    crr = coeffs[1] / coeffs[0] if coeffs[0] != 0 else float("nan")
    cw = coeffs[2]
    degenerate = not (40 < mass < 150 and 0 < crr < 0.02 and 0 < cw < 2)
    return {"mass": mass, "crr": crr, "cw": cw, "r2": r2, "degenerate": degenerate}


# ---------------------------------------------------------------------------
# Method B -- flat-segment sweep (|grade| < FLAT_GRADE_PCT): P ~ m*g*Crr*v + Cw*v^3
# ---------------------------------------------------------------------------

def method_b_flat(P, V, Gr, rider_mass_estimate):
    flat_mask = np.abs(Gr) < FLAT_GRADE_PCT
    n_flat = int(flat_mask.sum())
    if n_flat < 20:
        return {"n": n_flat, "crr": None, "cw": None, "r2": None}
    fv, fp = V[flat_mask], P[flat_mask]
    X = np.column_stack([fv, fv ** 3])
    coeffs, _, _, _ = np.linalg.lstsq(X, fp, rcond=None)
    pred = X @ coeffs
    ss_res = np.sum((fp - pred) ** 2)
    ss_tot = np.sum((fp - fp.mean()) ** 2)
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else float("nan")
    crr = coeffs[0] / (rider_mass_estimate * G)
    cw = coeffs[1]
    return {"n": n_flat, "crr": crr, "cw": cw, "r2": r2}


# ---------------------------------------------------------------------------
# Method C -- Chung/virtual-elevation, continuous joint (mass, Crr, Cw) optimization.
# Replaces the JS scripts' discrete grid search + separate mass-scan coordinate descent
# with a single scipy.optimize.minimize call over all 3 parameters jointly.
# ---------------------------------------------------------------------------

# Precompute once per ride: dt[i] and a validity mask (v>=V_MIN_MS, dt>0), i=1..n-1.
# sin_theta[i] depends only on P[i], V[i], A[i] and the candidate (mass, Crr, Cw) -- NOT
# on the running altitude h[i-1] -- so the whole trace is a single cumulative sum, not a
# genuine sequential recurrence. This lets the hot inner loop (called many times by the
# optimizer) run as vectorized numpy instead of a per-sample Python loop, which is what
# makes a continuous (gradient-based/multi-start) optimizer practical here instead of the
# JS scripts' discrete grid (their reason for a grid in the first place was the sandbox's
# CPU budget for a scalar hot loop -- vectorizing removes that constraint entirely).

def _ve_prep(P, V, A, T):
    n = len(P)
    dt = np.diff(T)
    valid = (V[1:] >= V_MIN_MS) & (dt > 0)
    return {
        "n": n, "dt": dt, "valid": valid,
        "P": P[1:], "V": V[1:], "A": A[1:],
    }


def _ve_delta_h(mass, crr, cw, prep):
    """Per-step contribution v*sin_theta*dt for i=1..n-1 (0 where invalid)."""
    P, V, A, dt, valid = prep["P"], prep["V"], prep["A"], prep["dt"], prep["valid"]
    with np.errstate(divide="ignore", invalid="ignore"):
        sin_theta = (P / V - cw * V * V - mass * G * crr - mass * A) / (mass * G)
    sin_theta = np.where(np.isfinite(sin_theta), sin_theta, 0.0)
    sin_theta = np.clip(sin_theta, -1.0, 1.0)
    step = V * sin_theta * dt
    return np.where(valid, step, 0.0), valid


def ve_trace(mass, crr, cw, P, V, A, T, h0):
    """Integrate the per-sample virtual-elevation trace for a given (mass, Crr, Cw)."""
    prep = _ve_prep(P, V, A, T)
    step, _ = _ve_delta_h(mass, crr, cw, prep)
    h = np.empty(len(P))
    h[0] = h0
    h[1:] = h0 + np.cumsum(step)
    return h


def method_c_continuous(P, V, A, T, alt_smooth, seeds):
    """Joint 3-parameter continuous optimization minimizing virtual-elevation RMSE.
    Multi-start (several seeds) to reduce the risk of a non-convex/non-smooth local
    minimum (the sin_theta clamp makes the loss surface non-smooth at the clamp
    boundaries) -- the JS grid search's global-ish coverage is otherwise lost by
    switching to a local optimizer."""
    h0 = alt_smooth[0]
    prep = _ve_prep(P, V, A, T)

    def ve_rmse(params):
        mass, crr, cw = params
        step, valid = _ve_delta_h(mass, crr, cw, prep)
        h = h0 + np.cumsum(step)
        diff = h - alt_smooth[1:]
        diff = diff[valid]
        return np.sqrt(np.mean(diff ** 2)) if len(diff) else np.inf

    bounds = [MASS_BOUNDS, CRR_BOUNDS, CW_BOUNDS]
    best = None
    for x0 in seeds:
        res = minimize(ve_rmse, x0, method="Nelder-Mead", bounds=bounds,
                        options={"xatol": 1e-4, "fatol": 1e-4, "maxiter": 4000,
                                 "maxfev": 4000})
        if best is None or res.fun < best.fun:
            best = res
        res_lb = minimize(ve_rmse, x0, method="L-BFGS-B", bounds=bounds)
        if res_lb.fun < best.fun:
            best = res_lb

    mass, crr, cw = best.x
    at_boundary = any(
        abs(x - lo) < 1e-4 or abs(x - hi) < 1e-4
        for x, (lo, hi) in zip(best.x, bounds)
    )
    trace = ve_trace(mass, crr, cw, P, V, A, T, h0)
    return {
        "mass": float(mass), "crr": float(crr), "cw": float(cw),
        "rmse": float(best.fun), "at_boundary": at_boundary, "trace": trace,
    }


def method_c_fixed_mass(mass, P, V, A, T, alt_smooth, seeds_crr_cw):
    """Same Chung/VE fit as method_c_continuous, but with mass held at an
    independently-known value (e.g. a scale reading) instead of being a free search
    parameter. Only Crr/Cw are optimized. This directly targets the mass -> infinity
    degenerate direction identified in method_c_continuous: fixing mass removes that
    entire failure mode by construction, rather than just making it less likely."""
    h0 = alt_smooth[0]
    prep = _ve_prep(P, V, A, T)

    def ve_rmse(params):
        crr, cw = params
        step, valid = _ve_delta_h(mass, crr, cw, prep)
        h = h0 + np.cumsum(step)
        diff = h - alt_smooth[1:]
        diff = diff[valid]
        return np.sqrt(np.mean(diff ** 2)) if len(diff) else np.inf

    bounds = [CRR_BOUNDS, CW_BOUNDS]
    best = None
    for x0 in seeds_crr_cw:
        res = minimize(ve_rmse, x0, method="Nelder-Mead", bounds=bounds,
                        options={"xatol": 1e-5, "fatol": 1e-5, "maxiter": 4000,
                                 "maxfev": 4000})
        if best is None or res.fun < best.fun:
            best = res
        res_lb = minimize(ve_rmse, x0, method="L-BFGS-B", bounds=bounds)
        if res_lb.fun < best.fun:
            best = res_lb

    crr, cw = best.x
    at_boundary = any(
        abs(x - lo) < 1e-4 or abs(x - hi) < 1e-4
        for x, (lo, hi) in zip(best.x, bounds)
    )
    trace = ve_trace(mass, crr, cw, P, V, A, T, h0)
    return {
        "mass": float(mass), "crr": float(crr), "cw": float(cw),
        "rmse": float(best.fun), "at_boundary": at_boundary, "trace": trace,
    }


# ---------------------------------------------------------------------------
# Climb-only breakout: both steady-state and acceleration-inclusive evaluation, for both
# the fitted and trainer-constant models -- 4 combinations total.
# ---------------------------------------------------------------------------

def subset_stats(measured, predicted, mask):
    n = int(mask.sum())
    if n < 2:
        return {"n": n, "r2": float("nan"), "mae": float("nan"), "resid_std": float("nan")}
    m_meas, m_pred = measured[mask], predicted[mask]
    resid = m_meas - m_pred
    ss_tot = np.sum((m_meas - m_meas.mean()) ** 2)
    ss_res = np.sum(resid ** 2)
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else float("nan")
    return {"n": n, "r2": float(r2), "mae": float(np.mean(np.abs(resid))),
            "resid_std": float(resid.std())}


def climb_breakout(P, V, Gr, A, fitted, trainer):
    climb_mask = Gr > CLIMB_GRADE_PCT
    n_climb = int(climb_mask.sum())
    if n_climb < MIN_CLIMB_SAMPLES:
        return {"n": n_climb, "usable": False}

    pred_fitted_steady = predict_power_steady(fitted["mass"], fitted["crr"], fitted["cw"], V, Gr)
    pred_trainer_steady = predict_power_steady(TRAINER_M, TRAINER_CRR, TRAINER_CW, V, Gr)
    pred_fitted_accel = predict_power_accel(fitted["mass"], fitted["crr"], fitted["cw"], V, Gr, A)
    pred_trainer_accel = predict_power_accel(TRAINER_M, TRAINER_CRR, TRAINER_CW, V, Gr, A)

    return {
        "n": n_climb, "usable": True,
        "fitted_steady": subset_stats(P, pred_fitted_steady, climb_mask),
        "trainer_steady": subset_stats(P, pred_trainer_steady, climb_mask),
        "fitted_accel": subset_stats(P, pred_fitted_accel, climb_mask),
        "trainer_accel": subset_stats(P, pred_trainer_accel, climb_mask),
    }


# ---------------------------------------------------------------------------
# Binned power-vs-grade curve (measured vs fitted vs trainer), grade >= MIN_CHART_GRADE_PCT
# ---------------------------------------------------------------------------

def bin_by_grade(grade, series_dict, bin_width, min_samples):
    keys = np.round(grade / bin_width).astype(int)
    uniq = np.unique(keys)
    x, out = [], {name: [] for name in series_dict}
    counts = []
    for k in uniq:
        mask = keys == k
        cnt = int(mask.sum())
        if cnt < min_samples:
            continue
        x.append(k * bin_width)
        counts.append(cnt)
        for name, arr in series_dict.items():
            out[name].append(arr[mask].mean() if arr is not None else None)
    return np.array(x), counts, out


# ---------------------------------------------------------------------------
# Closed-loop / repeated-segment detection (route-closure check for the Chung method)
# ---------------------------------------------------------------------------

def detect_closed_loop(alt_smooth, dist):
    valid = ~np.isnan(dist)
    if not valid.any():
        return {"closed_loop": False, "elevation_delta_m": None, "note": "no distance stream"}
    delta = float(alt_smooth[-1] - alt_smooth[0])
    closed = abs(delta) <= 20.0
    return {"closed_loop": closed, "elevation_delta_m": round(delta, 1),
            "note": "first/last-altitude closure check only "
                    "(repeated-lap-distance detection not implemented -- see findings doc)"}


# ---------------------------------------------------------------------------
# Per-ride analysis pipeline
# ---------------------------------------------------------------------------

def analyze_ride(path, fixed_mass=None):
    d = parse_fit(path)
    n = d["n"]
    if n > STRIDE_THRESHOLD:
        stride = max(1, round(n / STRIDE_THRESHOLD))
        print(f"  NOTE: {n} raw samples > {STRIDE_THRESHOLD}, downsampling stride={stride}")
        # (not exercised by these 3 rides; included per task spec if a future ride is huge)
        idx = np.arange(0, n, stride)
        for key in ("time", "watts", "v", "alt", "dist", "grade_direct", "cadence"):
            d[key] = d[key][idx]
        d["n"] = len(idx)
        n = d["n"]

    dt_all = np.diff(d["time"])
    dt_all = dt_all[(dt_all > 0) & (dt_all <= GAP_MAX_S)]
    median_dt = float(np.median(dt_all)) if len(dt_all) else 1.0

    has_direct_grade = np.isfinite(d["grade_direct"]).any()
    if has_direct_grade:
        grade = d["grade_direct"]
        grade_source = "direct FIT grade field"
        smooth_pts = half_w = None
    else:
        grade, smooth_pts, half_w = derive_grade_from_altitude(d["alt"], d["dist"], median_dt)
        grade_source = f"derived from altitude+distance (smooth={smooth_pts}pt, half-window={half_w}pt)"

    P, V, A, Gr, T, Alt, Cad, n_raw = build_samples(d, grade)
    n_valid = len(P)

    grade_speed_corr = corr(Gr, V)

    alt_arr = np.array([a if a is not None else np.nan for a in Alt])
    alt_available = np.isfinite(alt_arr).all() and len(alt_arr) > 0
    alt_smooth = None
    closed_loop = None
    if alt_available:
        alt_smooth_pts = max(3, round(5 / median_dt))
        alt_smooth = centered_moving_avg(alt_arr, alt_smooth_pts)
        closed_loop = detect_closed_loop(alt_smooth, d["dist"])

    naive = method_a_naive(P, V, Gr)
    flat = method_b_flat(P, V, Gr, RIDER_MASS_SEED)

    method_c = None
    method_c_fixed = None
    if alt_available:
        seeds = [
            (RIDER_MASS_SEED, CRR_SEED, CW_SEED),
            (RIDER_MASS_SEED, 0.004, 0.51),      # trainer-constant seed
            (RIDER_MASS_SEED - 10, 0.010, 0.25),
            (RIDER_MASS_SEED + 10, 0.008, 0.35),
            (90.0, 0.005, 0.20),
        ]
        method_c = method_c_continuous(P, V, A, T, alt_smooth, seeds)

        if fixed_mass is not None:
            seeds_crr_cw = [
                (CRR_SEED, CW_SEED),
                (0.004, 0.51),
                (0.010, 0.25),
                (0.008, 0.35),
                (0.005, 0.20),
            ]
            method_c_fixed = method_c_fixed_mass(fixed_mass, P, V, A, T, alt_smooth, seeds_crr_cw)

    fitted = None
    fitted_label = "none"
    if method_c_fixed is not None:
        fitted = {"mass": method_c_fixed["mass"], "crr": method_c_fixed["crr"], "cw": method_c_fixed["cw"]}
        fitted_label = f"Chung/VE fixed-mass ({fixed_mass:.1f}kg)"
    elif method_c is not None:
        fitted = {"mass": method_c["mass"], "crr": method_c["crr"], "cw": method_c["cw"]}
        fitted_label = "Chung/VE continuous"
    elif flat["crr"] is not None and flat["cw"] is not None and flat["crr"] > 0 and flat["cw"] > 0:
        fitted = {"mass": RIDER_MASS_SEED, "crr": flat["crr"], "cw": flat["cw"]}
        fitted_label = "flat-sweep"
    elif not naive["degenerate"]:
        fitted = {"mass": naive["mass"], "crr": naive["crr"], "cw": naive["cw"]}
        fitted_label = "naive regression"

    climb = None
    if fitted is not None:
        climb = climb_breakout(P, V, Gr, A, fitted, {"mass": TRAINER_M, "crr": TRAINER_CRR, "cw": TRAINER_CW})

    pred_fitted_steady = predict_power_steady(fitted["mass"], fitted["crr"], fitted["cw"], V, Gr) if fitted else None
    pred_trainer_steady = predict_power_steady(TRAINER_M, TRAINER_CRR, TRAINER_CW, V, Gr)
    ss_tot = np.sum((P - P.mean()) ** 2)
    r2_fitted_whole = (1 - np.sum((P - pred_fitted_steady) ** 2) / ss_tot) if fitted else float("nan")
    r2_trainer_whole = 1 - np.sum((P - pred_trainer_steady) ** 2) / ss_tot

    matches = match_known_ride(d["start_ts"])

    return {
        "path": path,
        "start_ts": d["start_ts"],
        "field_names_seen": d["field_names_seen"],
        "grade_source": grade_source,
        "median_dt": median_dt,
        "n_raw": n_raw,
        "n_valid": n_valid,
        "grade_speed_corr": grade_speed_corr,
        "naive": naive,
        "flat": flat,
        "method_c": method_c,
        "method_c_fixed": method_c_fixed,
        "fitted": fitted,
        "fitted_label": fitted_label,
        "climb": climb,
        "r2_fitted_whole": r2_fitted_whole,
        "r2_trainer_whole": r2_trainer_whole,
        "known_ride_matches": matches,
        "closed_loop": closed_loop,
        "P": P, "V": V, "A": A, "Gr": Gr, "T": T,
        "alt_arr": alt_arr, "alt_smooth": alt_smooth,
        "alt_available": alt_available,
    }


# ---------------------------------------------------------------------------
# Plots
# ---------------------------------------------------------------------------

def make_plots(results, outdir):
    if plt is None:
        print("matplotlib not available -- skipping plots")
        return
    os.makedirs(outdir, exist_ok=True)

    for r in results:
        label = r["start_ts"].strftime("%Y-%m-%d")
        P, V, Gr = r["P"], r["V"], r["Gr"]
        fitted = r["fitted"]

        chart_mask = Gr >= MIN_CHART_GRADE_PCT
        cGr, cP = Gr[chart_mask], P[chart_mask]
        pred_fitted = predict_power_steady(fitted["mass"], fitted["crr"], fitted["cw"], V, Gr) if fitted else None
        pred_trainer = predict_power_steady(TRAINER_M, TRAINER_CRR, TRAINER_CW, V, Gr)
        cFitted = pred_fitted[chart_mask] if pred_fitted is not None else None
        cTrainer = pred_trainer[chart_mask]

        series = {"measured": cP, "trainer": cTrainer}
        if cFitted is not None:
            series["fitted"] = cFitted
        x, counts, curve = bin_by_grade(cGr, series, CURVE_BIN_PCT, CURVE_MIN_BIN_SAMPLES)

        fig, axes = plt.subplots(1, 2, figsize=(12, 5))
        axes[0].plot(x, curve["measured"], "o-", color="#333", label="Measured (binned avg)")
        if "fitted" in curve:
            axes[0].plot(x, curve["fitted"], "o-", color="#2a7fce", label="Outdoor-fitted (steady-state)")
        axes[0].plot(x, curve["trainer"], "o-", color="#e08214", label="HW-V8 trainer (steady-state)")
        axes[0].set_xlabel("Grade (%)"); axes[0].set_ylabel("Average power (W)")
        axes[0].set_title(f"Power vs grade — {label}"); axes[0].legend(fontsize=8)

        if cFitted is not None:
            axes[1].scatter(cGr, cP - cFitted, s=8, alpha=0.4, color="#2a7fce", label="Residual (fitted)")
        axes[1].scatter(cGr, cP - cTrainer, s=8, alpha=0.3, color="#e08214", label="Residual (trainer)")
        axes[1].axhline(0, color="#888", linestyle=":")
        axes[1].set_xlabel("Grade (%)"); axes[1].set_ylabel("Residual, measured - predicted (W)")
        axes[1].set_title(f"Residuals vs grade — {label}"); axes[1].legend(fontsize=8)

        fig.tight_layout()
        fname = os.path.join(outdir, f"10-power-grade-{label}.png")
        fig.savefig(fname, dpi=130)
        plt.close(fig)
        print(f"  wrote {fname}")

        if r["alt_available"] and r["method_c"] is not None:
            fig2, ax = plt.subplots(figsize=(10, 4))
            t_rel = (r["T"] - r["T"][0]) / 60.0
            ax.plot(t_rel, r["alt_smooth"], color="#333", label="Actual altitude (smoothed)")
            ax.plot(t_rel, r["method_c"]["trace"], color="#2a7fce", label="Chung-fitted virtual elevation")
            ax.set_xlabel("Time (min)"); ax.set_ylabel("Elevation (m)")
            ax.set_title(f"Virtual-elevation profile overlay — {label}")
            ax.legend(fontsize=8)
            fig2.tight_layout()
            fname2 = os.path.join(outdir, f"10-virtual-elevation-{label}.png")
            fig2.savefig(fname2, dpi=130)
            plt.close(fig2)
            print(f"  wrote {fname2}")

    fitted_rides = [r for r in results if r["fitted"] is not None]
    if fitted_rides:
        fig3, axes3 = plt.subplots(1, 3, figsize=(13, 4))
        labels = [r["start_ts"].strftime("%Y-%m-%d") for r in fitted_rides]
        masses = [r["fitted"]["mass"] for r in fitted_rides]
        crrs = [r["fitted"]["crr"] for r in fitted_rides]
        cws = [r["fitted"]["cw"] for r in fitted_rides]

        mean_mass, std_mass = np.mean(masses), np.std(masses)
        mean_crr, std_crr = np.mean(crrs), np.std(crrs)
        mean_cw, std_cw = np.mean(cws), np.std(cws)

        for ax, vals, mean_v, std_v, title, hline in zip(
            axes3, [masses, crrs, cws], [mean_mass, mean_crr, mean_cw],
            [std_mass, std_crr, std_cw], ["Mass (kg)", "Crr", "Cw"],
            [TRAINER_M, TRAINER_CRR, TRAINER_CW],
        ):
            xs = list(range(len(vals))) + [len(vals)]
            ys = vals + [mean_v]
            colors = ["#2a7fce"] * len(vals) + ["#333"]
            ax.bar(xs, ys, color=colors)
            ax.axhline(hline, color="#e08214", linestyle="--", label="HW-V8 trainer")
            ax.set_xticks(xs)
            ax.set_xticklabels(labels + ["mean"], rotation=45, ha="right", fontsize=7)
            ax.set_title(title)
            ax.errorbar([len(vals)], [mean_v], yerr=[std_v], color="black", capsize=4)
            ax.legend(fontsize=7)
        fig3.suptitle("Cross-ride fitted mass/Crr/Cw vs HW-V8 trainer constants")
        fig3.tight_layout()
        fname3 = os.path.join(outdir, "10-cross-ride-comparison.png")
        fig3.savefig(fname3, dpi=130)
        plt.close(fig3)
        print(f"  wrote {fname3}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def fmt(x, nd=4):
    return "n/a" if x is None or not np.isfinite(x) else f"{x:.{nd}f}"


def print_report(results):
    print("\n" + "=" * 78)
    print("OFFLINE FULL-PRECISION FIT PHYSICS ANALYSIS -- REPORT")
    print("=" * 78)

    for r in results:
        print(f"\n--- Ride: {r['path']} ---")
        print(f"  start_ts (FIT, UTC): {r['start_ts']}")
        if r["known_ride_matches"]:
            for m in r["known_ride_matches"]:
                print(f"  MATCHES previously-logged: {m['label']} "
                      f"(mass={m['mass']}, Crr={m['crr']}, Cw={m['cw']}, n={m['samples']})")
        else:
            print("  NO MATCH to any previously-logged ride (A/B/C) by calendar date "
                  "-- treated as a new independent ride")
        print(f"  fields seen in FIT 'record' messages: {r['field_names_seen']}")
        print(f"  grade source: {r['grade_source']}")
        print(f"  median dt: {r['median_dt']:.2f}s, raw samples: {r['n_raw']}, "
              f"valid moving samples: {r['n_valid']}")
        print(f"  corr(grade%, speed): {fmt(r['grade_speed_corr'], 3)}")
        if r["closed_loop"] is not None:
            print(f"  closed-loop check: {r['closed_loop']}")

        na = r["naive"]
        print(f"  Method A (naive regression): mass={fmt(na['mass'],1)}kg Crr={fmt(na['crr'])} "
              f"Cw={fmt(na['cw'],3)} R2={fmt(na['r2'],3)} "
              f"{'DEGENERATE' if na['degenerate'] else 'plausible'}")

        fl = r["flat"]
        if fl["crr"] is not None:
            print(f"  Method B (flat-sweep, n={fl['n']}): Crr={fmt(fl['crr'])} "
                  f"Cw={fmt(fl['cw'],3)} R2={fmt(fl['r2'],3)}")
        else:
            print(f"  Method B (flat-sweep): insufficient flat samples (n={fl['n']})")

        mc = r["method_c"]
        if mc is not None:
            print(f"  Method C (Chung/VE, continuous, mass free): mass={fmt(mc['mass'],1)}kg "
                  f"Crr={fmt(mc['crr'])} Cw={fmt(mc['cw'],3)} VE-RMSE={fmt(mc['rmse'],2)}m "
                  f"{'AT BOUNDARY' if mc['at_boundary'] else ''}")
        else:
            print("  Method C (mass free): skipped (no altitude stream)")

        mcf = r.get("method_c_fixed")
        if mcf is not None:
            print(f"  Method C (Chung/VE, mass FIXED at {mcf['mass']:.1f}kg): "
                  f"Crr={fmt(mcf['crr'])} Cw={fmt(mcf['cw'],3)} VE-RMSE={fmt(mcf['rmse'],2)}m "
                  f"{'AT BOUNDARY (Crr/Cw)' if mcf['at_boundary'] else ''}")

        print(f"  Winning fit: {r['fitted_label']}")
        print(f"  Whole-ride R2 (steady-state): fitted={fmt(r['r2_fitted_whole'],3)} "
              f"trainer={fmt(r['r2_trainer_whole'],3)}")

        climb = r["climb"]
        if climb and climb["usable"]:
            print(f"  Climb-only (grade>{CLIMB_GRADE_PCT}%, n={climb['n']}):")
            for key, title in [("fitted_steady", "fitted  steady "),
                                ("trainer_steady", "trainer steady "),
                                ("fitted_accel", "fitted  accel  "),
                                ("trainer_accel", "trainer accel  ")]:
                s = climb[key]
                print(f"    {title}: R2={fmt(s['r2'],3)} MAE={fmt(s['mae'],1)}W "
                      f"sigma={fmt(s['resid_std'],1)}W")
        else:
            n = climb["n"] if climb else 0
            print(f"  Climb-only: too few samples (n={n} < {MIN_CLIMB_SAMPLES})")

    print("\n" + "=" * 78)
    print("CROSS-RIDE SYNTHESIS")
    print("=" * 78)
    fitted_rides = [r for r in results if r["fitted"] is not None]
    if fitted_rides:
        masses = [r["fitted"]["mass"] for r in fitted_rides]
        crrs = [r["fitted"]["crr"] for r in fitted_rides]
        cws = [r["fitted"]["cw"] for r in fitted_rides]
        print(f"  n rides fitted: {len(fitted_rides)}")
        print(f"  mass: mean={np.mean(masses):.1f}kg std={np.std(masses):.1f}kg "
              f"range=[{min(masses):.1f},{max(masses):.1f}]")
        print(f"  Crr:  mean={np.mean(crrs):.4f} std={np.std(crrs):.4f} "
              f"range=[{min(crrs):.4f},{max(crrs):.4f}]")
        print(f"  Cw:   mean={np.mean(cws):.3f} std={np.std(cws):.3f} "
              f"range=[{min(cws):.3f},{max(cws):.3f}]")

        climb_usable = [r for r in fitted_rides if r["climb"] and r["climb"]["usable"]]
        if climb_usable:
            fitted_wins_steady = sum(
                1 for r in climb_usable
                if r["climb"]["fitted_steady"]["mae"] < r["climb"]["trainer_steady"]["mae"]
            )
            fitted_wins_accel = sum(
                1 for r in climb_usable
                if r["climb"]["fitted_accel"]["mae"] < r["climb"]["trainer_accel"]["mae"]
            )
            print(f"  Climb-only MAE: fitted beats trainer on {fitted_wins_steady}/"
                  f"{len(climb_usable)} rides (steady-state), {fitted_wins_accel}/"
                  f"{len(climb_usable)} rides (acceleration-inclusive)")


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    args = sys.argv[1:]
    fixed_mass = None
    paths = []
    for a in args:
        if a.startswith("--fixed-mass="):
            fixed_mass = float(a.split("=", 1)[1])
        else:
            paths.append(a)
    if not paths:
        print(__doc__)
        sys.exit(1)

    results = [analyze_ride(p, fixed_mass=fixed_mass) for p in paths]
    print_report(results)

    outdir = os.path.join(os.path.dirname(os.path.abspath(__file__)))
    make_plots(results, outdir)

    # Machine-readable summary (aggregate numbers only, no personal/GPS data) for the
    # findings doc -- written to the scratchpad, not committed.
    summary = []
    for r in results:
        summary.append({
            "path": os.path.basename(r["path"]),
            "start_ts_utc": r["start_ts"].isoformat(),
            "known_ride_matches": [m["label"] for m in r["known_ride_matches"]],
            "n_valid": r["n_valid"],
            "grade_speed_corr": r["grade_speed_corr"],
            "fitted_label": r["fitted_label"],
            "fitted": r["fitted"],
            "method_c": {k: v for k, v in (r["method_c"] or {}).items() if k != "trace"} if r["method_c"] else None,
            "method_c_fixed": {k: v for k, v in (r["method_c_fixed"] or {}).items() if k != "trace"} if r.get("method_c_fixed") else None,
            "r2_fitted_whole": r["r2_fitted_whole"],
            "r2_trainer_whole": r["r2_trainer_whole"],
            "climb": {k: v for k, v in r["climb"].items()} if r["climb"] else None,
            "closed_loop": r["closed_loop"],
        })
    summary_path = os.path.join(os.path.dirname(outdir), "offline_fit_summary.json")
    with open("/tmp/offline_fit_summary.json", "w") as f:
        json.dump(summary, f, indent=2, default=str)
    print("\nMachine-readable summary written to /tmp/offline_fit_summary.json (not committed)")


if __name__ == "__main__":
    main()
