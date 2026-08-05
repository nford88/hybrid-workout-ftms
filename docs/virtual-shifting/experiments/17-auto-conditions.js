// Experiment 17 — apply the Crr/Cw condition schedule automatically. Paste into the console.
//
// Why: the protocol needs five preset changes at five specific moments in a 42-minute ride. Done
// by hand that means reaching the laptop mid-effort five times, and the Apply button silently
// discards the change if FTP/rider weight/bike weight are not all valid — so a fumbled change
// voids a whole lap and you would not know until the export. This arms once, before you start,
// and then touches nothing but the settings the rider physics panel would have set.
//
// It applies the condition for lap N when the step BEFORE lap N begins (the ERG rest), so the
// values are in force well ahead of the first grade write of that lap, and the `physicsApplied`
// note lands ~90 s clear of any measurement block.
//
// What it writes is exactly what the Apply button writes:
//   localStorage tireType/ridingPosition — read live by sendGradeFor() on every solve
//   H.state.simPhysics                   — the crr/cw handed to ftms.setSim()
//   the two <select>s                    — so the UI agrees, and a stray manual Apply cannot
//                                          revert the condition to a stale dropdown value
// plus a `physicsApplied` ride-log note, the boundary the analysis splits laps on.
;(() => {
  const SCHEDULE = [
    { lap: 1, role: 'A — baseline', tireType: 'trainer-smooth', ridingPosition: 'trainer-default' },
    { lap: 2, role: 'B — Crr high', tireType: 'gravel', ridingPosition: 'trainer-default' },
    {
      lap: 3,
      role: 'A — drift check',
      tireType: 'trainer-smooth',
      ridingPosition: 'trainer-default',
    },
    { lap: 4, role: 'C — Cw low', tireType: 'trainer-smooth', ridingPosition: 'aero-bars' },
    { lap: 5, role: 'D — mid-point', tireType: 'road-average', ridingPosition: 'hoods' },
    {
      lap: 6,
      role: 'A — closing check',
      tireType: 'trainer-smooth',
      ridingPosition: 'trainer-default',
    },
  ]

  const H = window.Hybrid
  if (!H || !H.state) {
    console.error(
      '[17] window.Hybrid is not there yet — let the app finish loading, then re-paste.'
    )
    return
  }

  // Re-arming must not stack listeners, or one step change would apply several conditions.
  if (window.__auto17) {
    window.removeEventListener('workoutStepChanged', window.__auto17.onStep)
    window.removeEventListener('workoutStarted', window.__auto17.onStarted)
    console.warn('[17] replacing a previously armed schedule')
  }

  let applied = 0 // highest lap number whose condition is in force

  function apply(entry, why) {
    const settings = {
      riderWeightKg: parseFloat(document.getElementById('rider-weight-input')?.value) || null,
      bikeWeightKg: parseFloat(document.getElementById('bike-weight-input')?.value) || null,
      tireType: entry.tireType,
      ridingPosition: entry.ridingPosition,
    }

    // Same two keys storage.ts owns; sendGradeFor re-reads them on every solve.
    localStorage.setItem('tireType', JSON.stringify(entry.tireType))
    localStorage.setItem('ridingPosition', JSON.stringify(entry.ridingPosition))

    // Keep the dropdowns honest, so the panel shows the truth and a manual Apply is harmless.
    for (const [id, value] of [
      ['tire-type-select', entry.tireType],
      ['riding-position-select', entry.ridingPosition],
    ]) {
      const el = document.getElementById(id)
      if (el) {
        el.value = value
        el.dispatchEvent(new Event('change', { bubbles: true }))
      }
    }

    // resolvePhysicsConstants is not reachable from the console, so map the presets here. These
    // must match riderPhysics.ts TIRE_CRR_PRESETS / POSITION_CW_PRESETS.
    const CRR = {
      'trainer-smooth': 0.004,
      'road-slick': 0.005,
      'road-average': 0.011,
      'road-worn': 0.017,
      gravel: 0.02,
    }
    const CW = {
      'aero-bars': 0.2,
      drops: 0.28,
      hoods: 0.36,
      upright: 0.45,
      'trainer-default': 0.51,
    }
    const crr = CRR[entry.tireType]
    const cw = CW[entry.ridingPosition]
    if (crr === undefined || cw === undefined) {
      console.error('[17] unknown preset id, NOT applying', entry)
      return false
    }
    H.state.simPhysics = { crr, cw }

    if (window.rideLog) {
      window.rideLog.logNote('physicsApplied', {
        tireType: entry.tireType,
        ridingPosition: entry.ridingPosition,
        crr,
        cw,
        riderWeightKg: settings.riderWeightKg,
        bikeWeightKg: settings.bikeWeightKg,
        auto: true,
        lap: entry.lap,
      })
    }

    applied = entry.lap
    console.log(
      `%c[17] lap ${entry.lap} (${entry.role}) — Crr ${crr}, Cw ${cw}  ← ${why}`,
      'color:#4ade80;font-weight:bold'
    )
    return true
  }

  // The lap a given step index belongs to, or is about to start: the ordinal of the next SIM
  // step at or after `stepIndex`. Derived from the plan rather than hardcoded, so the schedule
  // survives a change to the ERG bookends or rest lengths.
  function upcomingLap(stepIndex) {
    const plan = H.state.workoutPlan || []
    let lap = 0
    for (let i = 0; i < plan.length; i += 1) {
      if (plan[i].type === 'sim') {
        lap += 1
        if (i >= stepIndex) return lap
      }
    }
    return null // past the last lap — the cool-down
  }

  function onStep(e) {
    const stepIndex = e.detail?.stepIndex
    if (typeof stepIndex !== 'number') return
    const lap = upcomingLap(stepIndex)
    if (lap === null) {
      console.log('[17] past the last lap — schedule complete, nothing further to apply')
      return
    }
    if (lap <= applied) return // already in force; a re-entered step must not re-log
    const entry = SCHEDULE.find((s) => s.lap === lap)
    if (!entry) {
      console.warn(`[17] no schedule entry for lap ${lap} — leaving settings alone`)
      return
    }
    apply(entry, `step ${stepIndex + 1} began`)
  }

  // Lap 1 is applied at arm time, which is BEFORE Start Workout calls startRideLog() — so its
  // note goes into a log that is then replaced, and the export would carry five notes for six
  // laps. `workoutStarted` fires just after the new session opens, so re-log there and every lap
  // is represented identically. (Lap 1 would still be attributable from the session header and
  // the per-sample crr/cw; this is so the analysis needs only one rule, not two.)
  function onStarted() {
    const entry = SCHEDULE.find((s) => s.lap === upcomingLap(0))
    if (!entry) return
    applied = 0 // force the re-log; apply() puts it straight back
    apply(entry, 'workout started')
  }

  window.addEventListener('workoutStepChanged', onStep)
  window.addEventListener('workoutStarted', onStarted)
  window.__auto17 = {
    onStep,
    onStarted,
    SCHEDULE,
    get applied() {
      return applied
    },
  }

  const laps = (H.state.workoutPlan || []).filter((s) => s.type === 'sim').length
  if (laps !== SCHEDULE.length) {
    console.warn(
      `[17] plan has ${laps} SIM steps but the schedule has ${SCHEDULE.length} conditions — ` +
        `install 17-crr-cw-sweep-workout.json first if that is not deliberate`
    )
  }

  // Lap 1's condition is applied now, so the panel is correct before Start Workout is pressed.
  apply(SCHEDULE[0], 'armed')
  console.log(
    `%c[17] armed — ${SCHEDULE.length - 1} further changes will apply themselves. ` +
      `Do not touch the physics panel during the ride.`,
    'color:#60a5fa;font-weight:bold'
  )
})()
