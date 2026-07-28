// Intervals.icu Custom Activity Chart — outdoor drivetrain-physics model fit
//
// Paste this whole block into Settings > Custom Activity Charts (a new chart, any sport
// with power data). Re-runs per activity you view — one chart per ride, no API key needed
// (runs server-side inside your own authenticated intervals.icu session).
//
// Purpose: fit the FTMS virtual-shifting drivetrain model,
//   P = m*g*v*(sin(theta) + Crr*cos(theta)) + Cw*v^3, theta = atan(grade/100)
// (docs/VIRTUAL_SHIFTING_DESIGN.md §4.3) against this ride's real per-second power/speed/
// grade stream, and compare the fit against the trainer-side regression in
// experiments/06-hw-v7-v8-mass-regression.md (m_t=93.3kg, Crr=0.004, Cw=0.51).
//
// Field names below are taken from the intervals.icu JS data model
// (github.com/intervals-icu/js-data-model, dist/index.d.ts) — not guessed.
//
// Background this script exists to fix: a same-session attempt at fitting this model from
// 0.5%-grade-binned power/cadence data failed because corr(grade, speed) = -0.96 in a
// fixed-gear ride (cadence necessarily drops as grade rises), making it impossible to
// separate the grade term from the aero term by regression alone. Raw per-second data has
// enough natural noise (pacing, wind gusts, brief coasting) to partially break that
// collinearity, and the "Chung virtual elevation" method below sidesteps it structurally:
// it solves slope from each individual sample's power/speed/acceleration rather than
// regressing power against grade across samples.

{
  // ---- Config (tune these if the script times out, or if numbers look implausible) ----
  const G = 9.80665
  // Customize this if you know your actual bike+pedals+accessories weight — there's no
  // gear-weight field in intervals.icu's data model to pull it from automatically
  // (`StravaGear` only exposes an `id`, checked directly against the generated TS types,
  // not guessed), so this stays a manually-edited constant. It only seeds Method C's mass
  // search (±MASS_SCAN_RADIUS below), not a fixed input.
  const BIKE_MASS_KG = 8
  const V_MIN_MS = 1.0 // coasting/near-stop guard (design doc §4.3) — below this, dividing
                        // by v to solve for slope blows up; matches the app's own guard
  const FLAT_GRADE_PCT = 0.5 // |grade| below this counts as "flat" for the aero-only sweep
  // DESIGN §4.9's actual question is about climbs, and descents are dominated by coasting
  // (near-zero measured power) that the steady-state formula can't represent at all — so
  // the charts below don't plot grade < this threshold at all, not just de-emphasize it.
  const MIN_CHART_GRADE_PCT = 0
  // Kept deliberately small — the sandbox's resource limit (memory and/or cumulative
  // allocation, not just wall-clock CPU) turned out tight enough that a 2500-sample /
  // 754-combo-grid / two-round-refinement version failed with "Memory limit exceeded"
  // even after removing the one clearly-oversized intermediate array (see the doc's
  // design-decisions section). These defaults trade fit resolution for headroom; raise
  // them if a run succeeds comfortably under this budget.
  const MAX_FIT_SAMPLES = 800 // downsample target — bounds both memory and grid-search cost
  const ALT_SMOOTH_PTS = 15 // centered moving-average window (samples) for the actual-altitude
                             // comparison trace, to reduce GPS/barometric noise vs our smooth
                             // virtual-elevation integration
  // Trainer-side reference to compare against (experiments/06-hw-v7-v8-mass-regression.md):
  const TRAINER_M = 93.3, TRAINER_CRR = 0.004, TRAINER_CW = 0.51
  // Grid ranges for the Chung/virtual-elevation search. Cw spans both typical outdoor
  // road-position literature values (~0.15-0.25 kg/m) and Zwift's own pinned constant
  // (0.51) since we don't know a priori which regime this rider's real position falls in.
  // Coarser than an initial draft (15/11 steps = 165 combos, not 29/26 = 754) specifically
  // to fit the sandbox's resource budget.
  const CRR_MIN = 0.001, CRR_MAX = 0.015, CRR_STEP = 0.001
  const CW_MIN = 0.10, CW_MAX = 0.60, CW_STEP = 0.05
  const MASS_SCAN_RADIUS = 20, MASS_SCAN_STEP = 4 // coordinate-descent mass refinement, +/- kg
  // Climb-only breakout (DESIGN §4.9): SIM-mode gear-shifting matters most on climbs, so a
  // whole-ride R² — dominated by descents where riders mostly coast and the steady-state
  // formula has no coasting term — is the wrong number to judge personalization value by.
  const CLIMB_GRADE_PCT = 2 // % — samples steeper than this count as "climbing"
  const MIN_CLIMB_SAMPLES = 20 // below this, report sample count only, not a hollow R²
  // Binned power-vs-grade curve (replaces a measured-vs-predicted scatter that turned out
  // to be a diffuse, hard-to-read point cloud — a per-bin averaged curve is what actually
  // answers "does the model's curve match reality" at a glance).
  const CURVE_BIN_PCT = 1 // % grade width per bin
  const CURVE_MIN_BIN_SAMPLES = 5 // drop bins with fewer samples than this — too noisy

  function rangeStep(min, max, step) {
    let out = []
    for (let x = min; x <= max + step / 2; x += step) out.push(Math.round(x * 1e6) / 1e6)
    return out
  }

  function mean(a) {
    let s = 0
    for (let i = 0; i < a.length; i++) s += a[i]
    return a.length ? s / a.length : NaN
  }

  function corr(a, b) {
    let ma = mean(a), mb = mean(b), sa = 0, sb = 0, sab = 0
    for (let i = 0; i < a.length; i++) {
      let da = a[i] - ma, db = b[i] - mb
      sab += da * db; sa += da * da; sb += db * db
    }
    return (sa === 0 || sb === 0) ? NaN : sab / Math.sqrt(sa * sb)
  }

  // Bins samples by grade (bin width `binWidth`, integer bin keys to avoid float drift) and
  // averages each named series per bin. A `series` entry may be null (e.g. no fitted model)
  // — its output is just an array of nulls, same length as the other series, for easy trace
  // building. Not a hot loop: runs once over <=MAX_FIT_SAMPLES points already in memory.
  function binByGrade(gradeArr, series, binWidth, minSamples) {
    let bins = {}
    for (let i = 0; i < gradeArr.length; i++) {
      let key = Math.round(gradeArr[i] / binWidth)
      if (!bins[key]) bins[key] = { count: 0, sums: {} }
      bins[key].count++
      for (let name in series) {
        if (!series[name]) continue
        bins[key].sums[name] = (bins[key].sums[name] || 0) + series[name][i]
      }
    }
    let keys = Object.keys(bins).map(Number).sort((a, b) => a - b)
    let x = [], counts = [], out = {}
    for (let name in series) out[name] = []
    for (let k = 0; k < keys.length; k++) {
      let b = bins[keys[k]]
      if (b.count < minSamples) continue
      x.push(keys[k] * binWidth)
      counts.push(b.count)
      for (let name in series) out[name].push(series[name] ? b.sums[name] / b.count : null)
    }
    return { x, counts, series: out }
  }

  // Solve a small (2x2 or 3x3) linear system via Gaussian elimination with partial pivoting.
  function solveLinearSystem(A, b) {
    let n = b.length
    let M = A.map((row, i) => row.slice().concat([b[i]]))
    for (let col = 0; col < n; col++) {
      let piv = col
      for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r
      if (Math.abs(M[piv][col]) < 1e-12) return null // singular — degenerate/collinear inputs
      let tmp = M[col]; M[col] = M[piv]; M[piv] = tmp
      for (let r = 0; r < n; r++) {
        if (r === col) continue
        let f = M[r][col] / M[col][col]
        for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c]
      }
    }
    return M.map((row, i) => row[n] / row[i])
  }

  // Ordinary least squares, no intercept: y ~ sum(coeffs[k] * regressors[k][i]).
  function leastSquaresNoIntercept(regressors, y) {
    let k = regressors.length, n = y.length
    let XtX = Array.from({ length: k }, () => new Array(k).fill(0))
    let Xty = new Array(k).fill(0)
    for (let i = 0; i < n; i++) {
      for (let a = 0; a < k; a++) {
        Xty[a] += regressors[a][i] * y[i]
        for (let bIdx = 0; bIdx < k; bIdx++) XtX[a][bIdx] += regressors[a][i] * regressors[bIdx][i]
      }
    }
    let coeffs = solveLinearSystem(XtX, Xty)
    if (!coeffs) return null
    let ym = mean(y), ssTot = 0, ssRes = 0
    for (let i = 0; i < n; i++) {
      let pred = 0
      for (let a = 0; a < k; a++) pred += coeffs[a] * regressors[a][i]
      ssRes += (y[i] - pred) * (y[i] - pred)
      ssTot += (y[i] - ym) * (y[i] - ym)
    }
    return { coeffs, r2: ssTot > 0 ? 1 - ssRes / ssTot : NaN }
  }

  function predictPowerSteady(m, crr, cw, v, gradePct) {
    let theta = Math.atan(gradePct / 100)
    return m * G * v * (Math.sin(theta) + crr * Math.cos(theta)) + cw * v * v * v
  }

  // Local reimplementation of icu.stats.calcCenteredMovingAvg — the host version is a Java
  // method taking a float[] parameter, and GraalJS's polyglot interop refuses to auto-narrow
  // our computed (block-averaged) JS numbers to Java float, throwing
  // "Cannot convert '...'(Double) to Java type 'float': Invalid or lossy primitive coercion"
  // even though the TS types say number[]. Staying pure-JS sidesteps the interop boundary
  // entirely. Semantics match the host version: `points`-wide window, centered on i.
  function centeredMovingAvg(series, points) {
    let n = series.length, half = Math.floor(points / 2), out = new Array(n)
    for (let i = 0; i < n; i++) {
      let lo = Math.max(0, i - half), hi = Math.min(n - 1, i + half), s = 0, c = 0
      for (let j = lo; j <= hi; j++) { let v = series[j]; if (v != null) { s += v; c++ } }
      out[i] = c ? s / c : series[i]
    }
    return out
  }

  let result
  build: {
    let s = icu.streams
    let time = s.time
    let watts = s.interpolated_watts || s.watts || s.fixed_watts
    let vRaw = s.velocity_smooth
    let gradeRaw = s.grade_smooth
    let altRaw = s.altitude || s.fixed_altitude
    let movingRaw = s.moving

    if (!time || !watts || !vRaw) {
      result = { data: [], layout: { title: { text: 'Missing required streams (time/watts/velocity_smooth) for this activity — cannot fit the physics model. stream_types: ' + (icu.activity.stream_types || []).join(', ') } } }
      break build
    }

    // Derive grade from altitude+distance if grade_smooth isn't stored for this activity.
    // `s.distance` is only read here, lazily — most GPS rides already have grade_smooth,
    // so this avoids materializing/computing a stream we'd otherwise never touch.
    let grade = gradeRaw
    if (!grade && altRaw) {
      let distRaw = s.distance
      if (distRaw) {
        let altSmooth = centeredMovingAvg(altRaw, ALT_SMOOTH_PTS)
        let w = 5
        grade = new Array(altSmooth.length).fill(0)
        for (let i = w; i < altSmooth.length - w; i++) {
          let dd = distRaw[i + w] - distRaw[i - w]
          grade[i] = dd > 0.5 ? 100 * (altSmooth[i + w] - altSmooth[i - w]) / dd : 0
        }
      }
    }
    if (!grade) {
      result = { data: [], layout: { title: { text: 'No grade_smooth stream and no altitude+distance to derive grade from — cannot separate the grade term from the aero term for this activity.' } } }
      break build
    }
    let alt = altRaw // may still be null; VE method is skipped below if so

    // ---- Build the working (filtered, moving-only, coasting-guarded, downsampled) sample
    // set in a SINGLE pass over the raw streams. Deliberately avoids materializing a
    // full-length index array or per-block sub-arrays (an earlier version did both, via
    // `idx.push(i)` over the whole ride plus `block.map(...)` per downsample block) — on a
    // long enough ride that's real memory pressure in a sandboxed script, not just a CPU
    // cost; a single pass with scalar accumulators never holds more than one block's sums
    // and the final downsampled arrays (bounded by MAX_FIT_SAMPLES) at once.
    let n = time.length
    let stride = Math.max(1, Math.round(n / MAX_FIT_SAMPLES)) // estimated from raw length;
    // exact target sample count isn't important, only that output stays bounded
    let P = [], V = [], A = [], Grade = [], T = [], AltActual = []
    let sumP = 0, sumV = 0, sumG = 0, sumAlt = 0, altCount = 0, blockCount = 0
    let blockFirstIdx = -1, blockLastIdx = -1, validSampleCount = 0

    function flushBlock() {
      if (blockCount === 0) return
      let dtBlock = time[blockLastIdx] - time[blockFirstIdx - 1]
      P.push(sumP / blockCount)
      V.push(sumV / blockCount)
      Grade.push(sumG / blockCount)
      A.push(dtBlock > 0 ? (vRaw[blockLastIdx] - vRaw[blockFirstIdx - 1]) / dtBlock : 0)
      T.push(time[blockLastIdx])
      AltActual.push(altCount > 0 ? sumAlt / altCount : null)
      sumP = sumV = sumG = sumAlt = altCount = blockCount = 0
    }

    for (let i = 1; i < n; i++) {
      let dt = time[i] - time[i - 1]
      if (dt <= 0 || dt > 10) continue // gap/pause — don't integrate across it
      if (vRaw[i] == null || watts[i] == null || grade[i] == null) continue
      if (vRaw[i] < V_MIN_MS) continue
      if (movingRaw && movingRaw[i] === false) continue

      validSampleCount++
      if (blockCount === 0) blockFirstIdx = i
      blockLastIdx = i
      sumP += watts[i]; sumV += vRaw[i]; sumG += grade[i]
      if (alt && alt[i] != null) { sumAlt += alt[i]; altCount++ }
      blockCount++
      if (blockCount >= stride) flushBlock()
    }
    flushBlock() // trailing partial block, if any

    if (validSampleCount < 30) {
      result = { data: [], layout: { title: { text: 'Fewer than 30 usable moving samples after filtering — activity too short/stationary for this fit.' } } }
      break build
    }
    let m = P.length

    // ---- Diagnostic: grade/speed collinearity for this ride, per-sample (not binned) ----
    let gradeSpeedCorr = corr(Grade, V)

    // Rider+bike mass estimate used to seed Methods B and C (not a fixed input — Method C
    // searches around it; Method B only needs it to split Crr out of a combined m*g*Crr term).
    // `icu.wellness.weight` — the day-specific weight recorded for this activity's date
    // (e.g. from a smart scale) — comes first: it's more accurate and current than the
    // static profile fields, which can go stale. Falls back to activity/athlete profile
    // weight, then a generic default, only if no wellness weight was ever logged.
    let riderMassEstimate = (icu.wellness.weight || icu.activity.icu_weight || icu.athlete.icu_weight || icu.athlete.weight || 75) + BIKE_MASS_KG

    // ---- Method A: naive whole-ride 3-parameter regression (this session's original,
    // failed approach — repeated here on real per-second data as the requested sanity check) ----
    let sinT = Grade.map(g => Math.sin(Math.atan(g / 100)))
    let cosT = Grade.map(g => Math.cos(Math.atan(g / 100)))
    let reg1 = sinT.map((s2, i) => s2 * V[i])
    let reg2 = cosT.map((c, i) => c * V[i])
    let reg3 = V.map(v => v * v * v)
    let naive = leastSquaresNoIntercept([reg1, reg2, reg3], P)
    let naiveMass = null, naiveCrr = null, naiveCw = null, naiveDegenerate = true
    if (naive) {
      naiveMass = naive.coeffs[0] / G
      naiveCrr = naive.coeffs[0] !== 0 ? naive.coeffs[1] / naive.coeffs[0] : NaN
      naiveCw = naive.coeffs[2]
      naiveDegenerate = !(naiveMass > 40 && naiveMass < 150 && naiveCrr > 0 && naiveCrr < 0.02 && naiveCw > 0 && naiveCw < 2)
    }

    // ---- Method B: flat-segment sweep — isolates Cw (+ Crr at an assumed mass) from
    // samples where grade ~ 0, so P ~ m*g*Crr*v + Cw*v^3 with no grade term to confound it ----
    let flatIdx = []
    for (let i = 0; i < m; i++) if (Math.abs(Grade[i]) < FLAT_GRADE_PCT) flatIdx.push(i)
    let flatFit = null, flatCrr = null, flatCw = null
    if (flatIdx.length >= 20) {
      let fv = flatIdx.map(i => V[i]), fp = flatIdx.map(i => P[i])
      flatFit = leastSquaresNoIntercept([fv, fv.map(v => v * v * v)], fp)
      if (flatFit) { flatCrr = flatFit.coeffs[0] / (riderMassEstimate * G); flatCw = flatFit.coeffs[1] }
    }

    // ---- Method C: approximate Chung "virtual elevation" method — for each candidate
    // (Crr, Cw, mass), solve sin(theta) per sample from P, v, and measured acceleration
    // (not from a cross-sample regression against grade — this is what breaks the
    // grade/speed collinearity that killed the binned-data attempt), integrate to a virtual
    // elevation profile, and pick the parameters whose profile best matches real altitude.
    // Two-round coordinate descent (Crr,Cw | mass | Crr,Cw) rather than a full 3-D grid, to
    // keep the search cheap enough for the sandboxed script's CPU budget.
    let veAvailable = alt && AltActual.every(a => a != null)
    let veResult = null
    if (veAvailable) {
      let altSmoothed = centeredMovingAvg(AltActual, 5)
      let m0 = riderMassEstimate

      function veRmse(mass, crr, cw) {
        let h = altSmoothed[0], sumSq = 0, count = 0
        for (let i = 1; i < m; i++) {
          let v = V[i], dt = T[i] - T[i - 1]
          if (v < V_MIN_MS || dt <= 0) continue
          let sinTheta = (P[i] / v - cw * v * v - mass * G * crr - mass * A[i]) / (mass * G)
          if (sinTheta > 1 || sinTheta < -1 || !isFinite(sinTheta)) sinTheta = 0
          h += v * sinTheta * dt
          let diff = h - altSmoothed[i]
          sumSq += diff * diff; count++
        }
        return count ? Math.sqrt(sumSq / count) : Infinity
      }

      function gridSearchCrrCw(mass) {
        let best = { crr: null, cw: null, rmse: Infinity }
        let crrGrid = rangeStep(CRR_MIN, CRR_MAX, CRR_STEP)
        let cwGrid = rangeStep(CW_MIN, CW_MAX, CW_STEP)
        for (let ci = 0; ci < crrGrid.length; ci++) {
          for (let wi = 0; wi < cwGrid.length; wi++) {
            let rmse = veRmse(mass, crrGrid[ci], cwGrid[wi])
            if (rmse < best.rmse) best = { crr: crrGrid[ci], cw: cwGrid[wi], rmse }
          }
        }
        return best
      }

      // Two-round coordinate descent, RESTORED after diagnosing a real methodological bug
      // in a since-removed single-round version: that version fit Crr/Cw once at the seed
      // mass m0, then scanned candidate masses while holding those same Crr/Cw fixed — but
      // Crr/Cw were chosen BECAUSE they minimize RMSE at m0, so of course m0 tends to look
      // best when re-tested with them; the mass scan was structurally biased toward finding
      // "no improvement," independent of where the true joint optimum actually sits. Two
      // ride runs both showed the mass scan landing exactly back on the unmoved seed
      // (29.3m -> 29.3m, mass unchanged) — consistent with that bias, not necessarily with
      // "already optimal." The fix is this round-2 re-optimization of Crr/Cw at whatever
      // mass the scan settles on, which the compute budget can afford now: the earlier
      // memory-limit fixes (MAX_FIT_SAMPLES 2500->800, grid 754->165 combos) already cut
      // total grid-search work by ~25-30x, so running the 165-combo grid twice (round1 +
      // round2) plus the mass scan is still roughly 65x cheaper than the version that
      // originally failed on "Memory limit exceeded."
      let round1 = gridSearchCrrCw(m0)
      let bestMass = m0, bestMassRmse = round1.rmse
      for (let dm = -MASS_SCAN_RADIUS; dm <= MASS_SCAN_RADIUS; dm += MASS_SCAN_STEP) {
        let mass = m0 + dm
        if (mass < 40) continue
        let rmse = veRmse(mass, round1.crr, round1.cw)
        if (rmse < bestMassRmse) { bestMassRmse = rmse; bestMass = mass }
      }
      // If the winning mass sits at the very edge of the searched window, the true optimum
      // may lie further out and the window is silently capping it — surface that explicitly
      // rather than letting a boundary-limited result look identical to genuine convergence
      // (bestMass landing back at the unmoved seed m0 is a DIFFERENT symptom — see the
      // round-2 comment above for why that specific pattern is not, on its own, evidence of
      // a correct global optimum either).
      let massScanAtBoundary = Math.abs(bestMass - (m0 - MASS_SCAN_RADIUS)) < 1e-6 || Math.abs(bestMass - (m0 + MASS_SCAN_RADIUS)) < 1e-6
      let round2 = gridSearchCrrCw(bestMass)
      veResult = { mass: bestMass, crr: round2.crr, cw: round2.cw, rmseBefore: round1.rmse, rmseAfter: round2.rmse, m0, massScanAtBoundary }
    }

    // ---- Forward predictions for the scatter/residual charts. Uses the STEADY-STATE
    // formula (no acceleration term) because that's the formula the app's drivetrain design
    // actually sends to the trainer (VIRTUAL_SHIFTING_DESIGN.md §4.3) — so residuals here
    // legitimately include real-world acceleration transients the app's model doesn't
    // attempt to capture; that's expected, not a fit failure (see accompanying doc). ----
    let fittedLabel = veResult ? 'Chung/VE grid' : (flatFit ? 'flat-sweep' : (naive && !naiveDegenerate ? 'naive regression' : 'none'))
    let fitted = veResult ||
      (flatFit ? { mass: riderMassEstimate, crr: flatCrr, cw: flatCw } : null) ||
      (naive && !naiveDegenerate ? { mass: naiveMass, crr: naiveCrr, cw: naiveCw } : null)
    let predictedFitted = fitted ? V.map((v, i) => predictPowerSteady(fitted.mass, fitted.crr, fitted.cw, v, Grade[i])) : null
    let predictedTrainer = V.map((v, i) => predictPowerSteady(TRAINER_M, TRAINER_CRR, TRAINER_CW, v, Grade[i]))

    let r2Fitted = predictedFitted ? (1 - sumSq(P, predictedFitted) / sumSqDev(P)) : NaN
    let r2Trainer = 1 - sumSq(P, predictedTrainer) / sumSqDev(P)

    function sumSq(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) * (a[i] - b[i]); return s }
    function sumSqDev(a) { let mu = mean(a), s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - mu) * (a[i] - mu); return s }

    // ---- Climb-only breakout (DESIGN §4.9) — the personalization-relevant comparison.
    // Not a hot loop (runs once over <=MAX_FIT_SAMPLES points already in memory), so no
    // CPU-budget concern the way the grid search has.
    function subsetStats(measured, predicted, idxList) {
      let n = idxList.length
      if (n < 2) return { n, r2: NaN, mae: NaN, residStd: NaN }
      let sumAbs = 0, sumResid = 0, ssRes = 0, muMeasured = 0
      for (let k = 0; k < n; k++) muMeasured += measured[idxList[k]]
      muMeasured /= n
      let ssTot = 0
      for (let k = 0; k < n; k++) {
        let resid = measured[idxList[k]] - predicted[idxList[k]]
        sumAbs += Math.abs(resid); sumResid += resid; ssRes += resid * resid
        ssTot += (measured[idxList[k]] - muMeasured) * (measured[idxList[k]] - muMeasured)
      }
      let muResid = sumResid / n, varResid = 0
      for (let k = 0; k < n; k++) {
        let resid = measured[idxList[k]] - predicted[idxList[k]]
        varResid += (resid - muResid) * (resid - muResid)
      }
      return { n, r2: ssTot > 0 ? 1 - ssRes / ssTot : NaN, mae: sumAbs / n, residStd: Math.sqrt(varResid / n) }
    }

    let climbIdx = []
    for (let i = 0; i < m; i++) if (Grade[i] > CLIMB_GRADE_PCT) climbIdx.push(i)
    let climbFitted = predictedFitted ? subsetStats(P, predictedFitted, climbIdx) : null
    let climbTrainer = subsetStats(P, predictedTrainer, climbIdx)

    let accelHover = A.map(a => 'accel=' + a.toFixed(2) + ' m/s²')

    // Both charts below only plot grade >= MIN_CHART_GRADE_PCT (default 0) — descents are
    // dominated by coasting (near-zero measured power against a formula that has no
    // coasting term and demands negative "braking" power at that speed/grade), which isn't
    // what this project's climb/gear-shifting question needs and just adds noise to look
    // at. Whole-ride stats (R², corr, naive/flat-sweep fits) upstream are computed on the
    // full ride including descents — only the two visual panels are filtered.
    let chartIdx = []
    for (let i = 0; i < m; i++) if (Grade[i] >= MIN_CHART_GRADE_PCT) chartIdx.push(i)
    let chartGrade = chartIdx.map(i => Grade[i])
    let chartP = chartIdx.map(i => P[i])
    let chartFitted = predictedFitted ? chartIdx.map(i => predictedFitted[i]) : null
    let chartTrainer = chartIdx.map(i => predictedTrainer[i])
    let chartAccelHover = chartIdx.map(i => accelHover[i])

    // Left panel: binned power-vs-grade curve, not a measured-vs-predicted scatter — a
    // scatter of ~800 overlapping points turned out to be an unreadable cloud that
    // confirmed "this fits badly" without showing why or where. A curve directly answers
    // "does the model's shape match reality" the way this project's own earlier binned
    // chart (experiments/07) did, now with the fitted and trainer model curves overlaid
    // on the real measured curve for direct comparison.
    let curve = binByGrade(chartGrade, { measured: chartP, fitted: chartFitted, trainer: chartTrainer }, CURVE_BIN_PCT, CURVE_MIN_BIN_SAMPLES)
    let curveHover = curve.counts.map(c => 'n=' + c + ' samples')

    let traces = []
    traces.push({
      x: curve.x, y: curve.series.measured, mode: 'lines+markers', type: 'scatter', name: 'Measured (binned avg)',
      line: { color: '#333' }, marker: { size: 5 }, text: curveHover, hoverinfo: 'x+y+text',
      xaxis: 'x', yaxis: 'y'
    })
    if (chartFitted) {
      traces.push({
        x: curve.x, y: curve.series.fitted, mode: 'lines+markers', type: 'scatter', name: 'Outdoor-fitted model (binned avg)',
        line: { color: '#2a7fce' }, marker: { size: 5 }, text: curveHover, hoverinfo: 'x+y+text',
        xaxis: 'x', yaxis: 'y'
      })
    }
    traces.push({
      x: curve.x, y: curve.series.trainer, mode: 'lines+markers', type: 'scatter', name: 'HW-V8 trainer model (binned avg)',
      line: { color: '#e08214' }, marker: { size: 5 }, text: curveHover, hoverinfo: 'x+y+text',
      xaxis: 'x', yaxis: 'y'
    })

    if (chartFitted) {
      let residual = chartP.map((p, i) => p - chartFitted[i])
      traces.push({
        x: chartGrade, y: residual, mode: 'markers', type: 'scatter', name: 'Residual (measured - fitted), outdoor model',
        marker: { color: '#2a7fce', size: 5, opacity: 0.6 }, text: chartAccelHover, hoverinfo: 'x+y+text',
        xaxis: 'x2', yaxis: 'y2'
      })
    }
    let residualTrainer = chartP.map((p, i) => p - chartTrainer[i])
    traces.push({
      x: chartGrade, y: residualTrainer, mode: 'markers', type: 'scatter', name: 'Residual (measured - trainer model)',
      marker: { color: '#e08214', size: 5, opacity: 0.4 }, text: chartAccelHover, hoverinfo: 'x+y+text',
      xaxis: 'x2', yaxis: 'y2'
    })
    traces.push({ x: [Math.min.apply(null, chartGrade), Math.max.apply(null, chartGrade)], y: [0, 0], mode: 'lines', type: 'scatter', name: 'zero residual', line: { color: '#888', dash: 'dot' }, xaxis: 'x2', yaxis: 'y2' })

    // A real run showed footer annotations positioned via negative `yref:'paper'` y-values
    // (e.g. y=-0.4) DON'T reliably render: that coordinate is a FRACTION of the plot's own
    // axis height, not a fixed pixel offset, and this chart's actual rendered axis height
    // turned out much taller than the ~500px this was first tuned against — so the same
    // fractional offset landed far outside the fixed-pixel `margin.b` budget and got
    // clipped, invisible in the exported image (confirmed: a real chart's legend, which
    // Plotly auto-reserves space for, rendered fine; the two custom annotations below it
    // did not appear at all). Titles don't have this problem — a 2-line title rendered
    // correctly in that same run — so all of the summary text below now lives in the
    // title (which can hold as many `<br>`-separated lines as needed) instead of
    // fragile paper-coordinate annotations.
    let fittedStr = fitted ? ('mass=' + fitted.mass.toFixed(1) + 'kg, Crr=' + fitted.crr.toFixed(4) + ', Cw=' + fitted.cw.toFixed(3)) : 'no usable fit'
    if (veResult && veResult.massScanAtBoundary) fittedStr += ' [mass search hit its ±' + MASS_SCAN_RADIUS + 'kg boundary — widen MASS_SCAN_RADIUS and re-run]'

    function climbStr(stats) {
      if (!stats) return 'no usable fit'
      return climbIdx.length < MIN_CLIMB_SAMPLES ? 'n/a'
        : 'R²=' + (isFinite(stats.r2) ? stats.r2.toFixed(2) : 'n/a') + ' MAE=' + stats.mae.toFixed(0) + 'W σ=' + stats.residStd.toFixed(0) + 'W'
    }
    let climbLine = climbIdx.length < MIN_CLIMB_SAMPLES
      ? 'Climbing only (grade>' + CLIMB_GRADE_PCT + '%): only ' + climbIdx.length + ' of ' + m + ' samples — too few for a meaningful breakout'
      : 'Climbing only (grade>' + CLIMB_GRADE_PCT + '%, n=' + climbIdx.length + '): fitted ' + climbStr(climbFitted) + '  vs  trainer ' + climbStr(climbTrainer)

    let summaryLine = 'R² (whole ride): outdoor-fitted=' + (isFinite(r2Fitted) ? r2Fitted.toFixed(2) : 'n/a') + ', trainer-model=' + r2Trainer.toFixed(2) +
      (r2Fitted < 0 && r2Trainer < 0 ? ' (both negative — neither model beats guessing the mean)' : '') + '  ·  ' + climbLine + '<br>' +
      'corr(grade%, speed): ' + (isFinite(gradeSpeedCorr) ? gradeSpeedCorr.toFixed(3) : 'n/a') + ' (binned-data session: -0.96)' +
      '  ·  n=' + m + ' (stride ' + stride + ' of ' + validSampleCount + ')' +
      '  ·  flat-sweep n=' + flatIdx.length + (flatFit ? ', Crr=' + flatCrr.toFixed(4) + ', Cw=' + flatCw.toFixed(3) : ' insufficient') +
      (naive ? '  ·  naive regression: ' + (naiveDegenerate ? 'degenerate' : 'plausible') : '')

    // Structured, copy-pasteable summary of THIS ride's fit — the actual deliverable for
    // the multi-ride calibration workflow: run this chart on ~5 rides, paste each ride's
    // JSON line into a chat, and have the numbers averaged into a personalized settings
    // file (DESIGN §4.9) instead of retyping/re-deriving figures from a screenshot by hand.
    function round(x, d) { return isFinite(x) ? Math.round(x * Math.pow(10, d)) / Math.pow(10, d) : null }
    let climbUsable = climbIdx.length >= MIN_CLIMB_SAMPLES
    let calibrationJson = JSON.stringify({
      date: icu.activity.start_date_local || null,
      method: fittedLabel,
      massKg: fitted ? round(fitted.mass, 1) : null,
      crr: fitted ? round(fitted.crr, 4) : null,
      cw: fitted ? round(fitted.cw, 3) : null,
      massScanAtBoundary: veResult ? veResult.massScanAtBoundary : null,
      wholeRideR2: { fitted: round(r2Fitted, 3), trainer: round(r2Trainer, 3) },
      climb: {
        gradeThresholdPct: CLIMB_GRADE_PCT,
        samples: climbIdx.length,
        r2: { fitted: climbUsable && climbFitted ? round(climbFitted.r2, 3) : null, trainer: climbUsable ? round(climbTrainer.r2, 3) : null },
        maeW: { fitted: climbUsable && climbFitted ? round(climbFitted.mae, 1) : null, trainer: climbUsable ? round(climbTrainer.mae, 1) : null }
      },
      corrGradeSpeed: round(gradeSpeedCorr, 3),
      samples: m
    })

    let titleText = 'Drivetrain physics fit vs. real ride data' +
      '<br><span style="font-size:12px">Fitted (' + fittedLabel + '): ' + fittedStr +
      '  —  HW-V8 trainer: mass=93.3kg, Crr=0.004, Cw=0.51</span>' +
      '<br><span style="font-size:10px">' + summaryLine + '</span>' +
      '<br><span style="font-size:9px;font-family:monospace">Copy for AI calibration: ' + calibrationJson + '</span>'

    result = {
      data: traces,
      layout: {
        title: { text: titleText, font: { size: 15 } },
        xaxis: { title: { text: 'Grade (%), ' + CURVE_BIN_PCT + '%-binned' }, domain: [0, 0.46], anchor: 'y' },
        yaxis: { title: { text: 'Average power (W)' }, domain: [0, 1], anchor: 'x' },
        xaxis2: { title: { text: 'Grade (%)' }, domain: [0.54, 1], anchor: 'y2' },
        yaxis2: { title: { text: 'Residual, measured - predicted (W)' }, domain: [0, 1], anchor: 'x2' },
        margin: { b: 50, t: 210 },
        legend: { orientation: 'h', y: -0.15, font: { size: 10 } }
      }
    }
  }
  chart = result
}
