// Intervals.icu Computed Activity Field — outdoor drivetrain-physics calibration JSON
//
// Companion to intervals-icu-power-model-chart.js. That chart embeds the same JSON in its
// title as plain SVG text, which turns out not to be reliably copy-pasteable in a browser
// (Plotly renders titles as SVG <text>, not normal selectable HTML). Custom Activity Charts
// have no other output channel — so this is a SEPARATE intervals.icu extension point,
// "Computed Activity Fields," whose whole purpose is producing a plain value (Text/Number/
// Select field types all exist; Text is what's used here) attached to the activity and
// displayed in the normal activity-summary UI, which should be ordinary selectable text.
//
// Setup: create a new custom activity field (type: Text) under Settings, then paste this
// whole block into that field's "computed from JS" script editor. Unlike the chart script,
// there's no `chart = ...` assignment convention here — the BLOCK'S LAST BARE EXPRESSION
// becomes the field's stored value (confirmed from intervals.icu's own README example for
// this extension point, e.g. `{ let v = ...; v }`), which is why this file ends with a
// bare `output` reference instead of an assignment.
//
// IMPORTANT — MODEL logic kept in sync manually, PERFORMANCE constants deliberately do
// NOT match: intervals.icu's JS extension points cannot import or share code with each
// other, so all of the physics-fitting logic below (Methods A/B/C, climb-only stats,
// calibrationJson shape) is a deliberate near-duplicate of intervals-icu-power-model-
// chart.js. If you change the MODEL (formula, method selection, JSON fields) in one
// file, change it in the other too, or the chart's title and this field will silently
// disagree. But a real run of this field hit "Memory limit exceeded" even though the
// chart script — sharing the same already-fixed single-pass downsampling, at
// MAX_FIT_SAMPLES=800 and a 165-combo grid — renders fine. Computed Activity Fields are
// plausibly evaluated in bulk (e.g. during sync, across many activities at once) rather
// than on-demand for one viewed activity like a chart, and likely get a tighter
// resource budget as a result — unconfirmed, but consistent with the evidence. So this
// file's MAX_FIT_SAMPLES/grid resolution are cut much harder than the chart's, on
// purpose, and the two files' performance constants are NOT expected to match.
//
// Purpose/model/field-name sourcing: see intervals-icu-power-model-chart.js's header —
// identical here, not repeated.

{
  // ---- Config — MODEL constants match intervals-icu-power-model-chart.js; PERFORMANCE
  // constants (below the blank line) are deliberately much smaller — see header note ----
  const G = 9.80665
  const BIKE_MASS_KG = 8
  const V_MIN_MS = 1.0
  const FLAT_GRADE_PCT = 0.5
  const TRAINER_M = 93.3, TRAINER_CRR = 0.004, TRAINER_CW = 0.51
  const MASS_SCAN_RADIUS = 20, MASS_SCAN_STEP = 4
  const CLIMB_GRADE_PCT = 2

  const ALT_SMOOTH_PTS = 15
  const MAX_FIT_SAMPLES = 300 // chart uses 800; cut further — see header note
  const CRR_MIN = 0.001, CRR_MAX = 0.015, CRR_STEP = 0.0025 // 6 steps (chart: 15)
  const CW_MIN = 0.10, CW_MAX = 0.60, CW_STEP = 0.1 // 6 steps (chart: 11) — 36 combos
  // total, vs the chart's 165; combined with fewer samples, roughly 15x cheaper per
  // grid-search call than the chart's already-working configuration
  const MIN_CLIMB_SAMPLES = 20

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

  function rangeStep(min, max, step) {
    let out = []
    for (let x = min; x <= max + step / 2; x += step) out.push(Math.round(x * 1e6) / 1e6)
    return out
  }

  function solveLinearSystem(A, b) {
    let n = b.length
    let M = A.map((row, i) => row.slice().concat([b[i]]))
    for (let col = 0; col < n; col++) {
      let piv = col
      for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r
      if (Math.abs(M[piv][col]) < 1e-12) return null
      let tmp = M[col]; M[col] = M[piv]; M[piv] = tmp
      for (let r = 0; r < n; r++) {
        if (r === col) continue
        let f = M[r][col] / M[col][col]
        for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c]
      }
    }
    return M.map((row, i) => row[n] / row[i])
  }

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

  function centeredMovingAvg(series, points) {
    let n = series.length, half = Math.floor(points / 2), out = new Array(n)
    for (let i = 0; i < n; i++) {
      let lo = Math.max(0, i - half), hi = Math.min(n - 1, i + half), s = 0, c = 0
      for (let j = lo; j <= hi; j++) { let v = series[j]; if (v != null) { s += v; c++ } }
      out[i] = c ? s / c : series[i]
    }
    return out
  }

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

  function round(x, d) { return isFinite(x) ? Math.round(x * Math.pow(10, d)) / Math.pow(10, d) : null }

  let output
  build: {
    let s = icu.streams
    let time = s.time
    let watts = s.interpolated_watts || s.watts || s.fixed_watts
    let vRaw = s.velocity_smooth
    let gradeRaw = s.grade_smooth
    let altRaw = s.altitude || s.fixed_altitude
    let movingRaw = s.moving

    if (!time || !watts || !vRaw) {
      output = 'ERROR: missing required streams (time/watts/velocity_smooth) for this activity'
      break build
    }

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
      output = 'ERROR: no grade_smooth stream and no altitude+distance to derive grade from'
      break build
    }
    let alt = altRaw

    let n = time.length
    let stride = Math.max(1, Math.round(n / MAX_FIT_SAMPLES))
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
      if (dt <= 0 || dt > 10) continue
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
    flushBlock()

    if (validSampleCount < 30) {
      output = 'ERROR: fewer than 30 usable moving samples — activity too short/stationary for this fit'
      break build
    }
    let m = P.length

    let gradeSpeedCorr = corr(Grade, V)
    let riderMassEstimate = (icu.wellness.weight || icu.activity.icu_weight || icu.athlete.icu_weight || icu.athlete.weight || 75) + BIKE_MASS_KG

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

    let flatIdx = []
    for (let i = 0; i < m; i++) if (Math.abs(Grade[i]) < FLAT_GRADE_PCT) flatIdx.push(i)
    let flatFit = null, flatCrr = null, flatCw = null
    if (flatIdx.length >= 20) {
      let fv = flatIdx.map(i => V[i]), fp = flatIdx.map(i => P[i])
      flatFit = leastSquaresNoIntercept([fv, fv.map(v => v * v * v)], fp)
      if (flatFit) { flatCrr = flatFit.coeffs[0] / (riderMassEstimate * G); flatCw = flatFit.coeffs[1] }
    }

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

      let round1 = gridSearchCrrCw(m0)
      let bestMass = m0, bestMassRmse = round1.rmse
      for (let dm = -MASS_SCAN_RADIUS; dm <= MASS_SCAN_RADIUS; dm += MASS_SCAN_STEP) {
        let mass = m0 + dm
        if (mass < 40) continue
        let rmse = veRmse(mass, round1.crr, round1.cw)
        if (rmse < bestMassRmse) { bestMassRmse = rmse; bestMass = mass }
      }
      let massScanAtBoundary = Math.abs(bestMass - (m0 - MASS_SCAN_RADIUS)) < 1e-6 || Math.abs(bestMass - (m0 + MASS_SCAN_RADIUS)) < 1e-6
      let round2 = gridSearchCrrCw(bestMass)
      veResult = { mass: bestMass, crr: round2.crr, cw: round2.cw, rmseBefore: round1.rmse, rmseAfter: round2.rmse, m0, massScanAtBoundary }
    }

    let fittedLabel = veResult ? 'Chung/VE grid' : (flatFit ? 'flat-sweep' : (naive && !naiveDegenerate ? 'naive regression' : 'none'))
    let fitted = veResult ||
      (flatFit ? { mass: riderMassEstimate, crr: flatCrr, cw: flatCw } : null) ||
      (naive && !naiveDegenerate ? { mass: naiveMass, crr: naiveCrr, cw: naiveCw } : null)
    let predictedFitted = fitted ? V.map((v, i) => predictPowerSteady(fitted.mass, fitted.crr, fitted.cw, v, Grade[i])) : null
    let predictedTrainer = V.map((v, i) => predictPowerSteady(TRAINER_M, TRAINER_CRR, TRAINER_CW, v, Grade[i]))

    function sumSq(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) * (a[i] - b[i]); return s }
    function sumSqDev(a) { let mu = mean(a), s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - mu) * (a[i] - mu); return s }
    let r2Fitted = predictedFitted ? (1 - sumSq(P, predictedFitted) / sumSqDev(P)) : NaN
    let r2Trainer = 1 - sumSq(P, predictedTrainer) / sumSqDev(P)

    let climbIdx = []
    for (let i = 0; i < m; i++) if (Grade[i] > CLIMB_GRADE_PCT) climbIdx.push(i)
    let climbFitted = predictedFitted ? subsetStats(P, predictedFitted, climbIdx) : null
    let climbTrainer = subsetStats(P, predictedTrainer, climbIdx)
    let climbUsable = climbIdx.length >= MIN_CLIMB_SAMPLES

    output = JSON.stringify({
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
  }
  output
}
