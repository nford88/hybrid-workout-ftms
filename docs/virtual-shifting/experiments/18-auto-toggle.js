// Experiment 18 — paired Crr/Cw toggle, with an on-bike HUD. Paste into the console before
// pressing Start Workout. One paste does everything: schedule + display.
//
// The design point: 17 gave ONE lap per condition, so "the trainer honoured the byte" and "the
// rider pedalled harder that lap" were indistinguishable — per-bin scatter reached ±190 W against
// an ~85 W effect. Here the condition flips every 90 s while the rider holds ONE gear and ONE
// cadence continuously, so each A/B pair is 90 s apart. Fatigue and thermal drift are slow; in a
// paired design they cancel instead of needing to be modelled.
//
// Phase 1 toggles Crr (0.004 ↔ 0.020) with Cw pinned. Phase 2 toggles Cw (0.51 ↔ 0.20) with Crr
// pinned. Only ever one variable at a time.
//
// CRITICAL, and the reason this needs a script at all: changing Crr does NOT change the grade, and
// `setSimGrade` only writes when the grade moves 0.3% or 3 s have passed — on a dead-flat route a
// condition change would otherwise never be transmitted. Every toggle therefore forces a write.
;(() => {
  const TOGGLE_MS = 90_000
  /**
   * 8 blocks of 90 s = 12 min per phase = 4 A/B pairs.
   *
   * The script ends the phase itself rather than letting the route run out: a SIM step ends on
   * route completion, so phase length would otherwise depend on how fast the rider pedalled, and
   * a paired design wants equal TIME per side. The route is 8 km — far longer than 12 min of
   * riding — precisely so it never completes and never auto-advances underneath us.
   */
  const BLOCKS_PER_PHASE = 8
  const CADENCE_TARGET = 75 // gentler than 17's 85, because this is held for 12 minutes straight
  const CADENCE_TOL = 6
  const REQUIRED_GEAR = 12

  const PHASES = [
    { name: 'Crr', a: { crr: 0.004, cw: 0.51 }, b: { crr: 0.02, cw: 0.51 } },
    { name: 'Cw', a: { crr: 0.004, cw: 0.51 }, b: { crr: 0.004, cw: 0.2 } },
  ]

  const H = window.Hybrid
  if (!H || !H.state) {
    console.error('[18] window.Hybrid missing — let the app finish loading, then re-paste.')
    return
  }
  if (window.__auto18) {
    window.__auto18.stop()
    console.warn('[18] replacing a previously armed toggle')
  }

  let simStepSeen = 0 // which SIM step we are in: 1 = Crr phase, 2 = Cw phase
  let toggleIndex = 0
  let phase = null
  let sideIsB = false
  let nextToggleAt = 0
  let timer = null

  function applyCondition(cond, why) {
    H.state.simPhysics = { crr: cond.crr, cw: cond.cw }
    // The tyre/position presets are what `sendGradeFor` reads, so keep them consistent or the
    // model and the trainer would be told different things.
    const tire =
      cond.crr === 0.004 ? 'trainer-smooth' : cond.crr === 0.011 ? 'road-average' : 'gravel'
    const pos = cond.cw === 0.51 ? 'trainer-default' : cond.cw === 0.36 ? 'hoods' : 'aero-bars'
    localStorage.setItem('tireType', JSON.stringify(tire))
    localStorage.setItem('ridingPosition', JSON.stringify(pos))

    if (window.rideLog) {
      window.rideLog.logNote('physicsApplied', {
        ...cond,
        tireType: tire,
        ridingPosition: pos,
        phase: phase?.name,
        toggleIndex,
        side: sideIsB ? 'B' : 'A',
        auto: true,
      })
    }
    // Force the write: a Crr change moves no grade, and the 0.3%/3 s gate would swallow it.
    if (H.sim && H.state.ftmsConnected) {
      H.sim
        .setSimGrade(H.state.workout.currentGrade ?? 0, {
          currentSpeed: H.state.lastSpeedKph ?? 0,
          currentDistance: H.state.workout.simDistanceTraveled ?? 0,
          forceUpdate: true,
        })
        .catch((e) => console.warn('[18] forced grade write failed:', e.message))
    }
    console.log(
      `%c[18] ${phase?.name} phase · toggle ${toggleIndex} · side ${sideIsB ? 'B' : 'A'} → Crr ${cond.crr} / Cw ${cond.cw}  (${why})`,
      'color:#4ade80;font-weight:bold'
    )
  }

  function toggle() {
    if (!phase) return
    if (toggleIndex + 1 >= BLOCKS_PER_PHASE) {
      // Phase complete — hand back to the workout, which moves us into the ERG rest.
      if (timer) {
        clearInterval(timer)
        timer = null
      }
      console.log(
        `%c[18] ${phase.name} phase complete — ${BLOCKS_PER_PHASE} blocks. Advancing to the rest step.`,
        'color:#fbbf24;font-weight:bold'
      )
      if (window.rideLog) {
        window.rideLog.logNote('phaseComplete', { phase: phase.name, blocks: BLOCKS_PER_PHASE })
      }
      phase = null
      H.handlers?.skipStep?.()
      return
    }
    sideIsB = !sideIsB
    toggleIndex += 1
    nextToggleAt = Date.now() + TOGGLE_MS
    applyCondition(sideIsB ? phase.b : phase.a, 'scheduled toggle')
  }

  function onStep(e) {
    const idx = e.detail?.stepIndex
    const step = H.state.workoutPlan[idx]
    if (timer) {
      clearInterval(timer)
      timer = null
    }
    if (!step || step.type !== 'sim') {
      phase = null
      return
    }
    // Phase is derived from the step's POSITION IN THE PLAN, not from a counter.
    //
    // `simStepSeen += 1` was wrong and cost a 34-minute ride on 2026-08-06: it survives across
    // workout restarts within a single paste, so a Start → abort → Start sequence advanced the
    // counter past the Crr phase and ran Cw twice. The whole Crr arm was lost and nobody could tell
    // from the HUD, because the label was consistent with what it had (wrongly) decided.
    //
    // Counting SIM steps before `idx` is stateless: the same step index always yields the same
    // phase, no matter how many times the workout is started.
    const simOrdinal = H.state.workoutPlan
      .slice(0, idx)
      .filter((s) => s && s.type === 'sim').length
    simStepSeen = simOrdinal + 1
    phase = PHASES[Math.min(simOrdinal, PHASES.length - 1)]
    toggleIndex = 0
    sideIsB = false
    nextToggleAt = Date.now() + TOGGLE_MS
    applyCondition(phase.a, `${phase.name} phase started`)
    timer = setInterval(toggle, TOGGLE_MS)
  }

  // ── HUD ────────────────────────────────────────────────────────────────────
  document.getElementById('hud18')?.remove()
  const el = document.createElement('div')
  el.id = 'hud18'
  el.style.cssText =
    'position:fixed;top:8px;left:8px;z-index:2147483647;background:rgba(5,8,14,0.94);' +
    'border:2px solid #334155;border-radius:12px;padding:14px 18px;min-width:440px;' +
    'font:600 20px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace;color:#e2e8f0;' +
    'pointer-events:none;box-shadow:0 8px 32px rgba(0,0,0,0.6)'
  document.body.appendChild(el)

  function render() {
    const W = H.state.workout
    const g = window.virtualDrivetrain.getVirtualGear()
    const gear = g.gearIndex + 1
    const cad = Math.round(H.state.lastCadenceRpm || 0)
    const { crr, cw } = H.state.simPhysics || {}
    const gearOk = gear === REQUIRED_GEAR
    const cadOk = Math.abs(cad - CADENCE_TARGET) <= CADENCE_TOL
    const row = (l, v, c = '#e2e8f0') =>
      `<div style="display:flex;justify-content:space-between;gap:18px">` +
      `<span style="color:#94a3b8">${l}</span><span style="color:${c}">${v}</span></div>`

    if (!W.isRunning) {
      el.innerHTML =
        `<div style="font-size:15px;color:#60a5fa">EXPERIMENT 18 — armed, not started</div>` +
        `<div style="font-size:30px;color:#fbbf24">PRESS START</div>` +
        row('Gear', `${gear} · ${g.gearRatio.toFixed(2)}`, gearOk ? '#4ade80' : '#f87171')
      return
    }
    if (!phase) {
      el.innerHTML =
        `<div style="font-size:15px;color:#60a5fa">EXPERIMENT 18</div>` +
        `<div style="font-size:30px;color:#38bdf8">REST — pedal easy</div>` +
        `<div style="font-size:16px;color:#94a3b8">next SIM step starts the ${PHASES[Math.min(simStepSeen, PHASES.length - 1)]?.name ?? ''} phase</div>` +
        row('Cadence', `${cad} rpm`)
      return
    }
    const left = Math.max(0, Math.round((nextToggleAt - Date.now()) / 1000))
    const ok = gearOk && cadOk
    el.innerHTML =
      `<div style="font-size:15px;color:#60a5fa">EXP 18 · ${phase.name} PHASE · toggle ${toggleIndex} · side ${sideIsB ? 'B' : 'A'}</div>` +
      `<div style="font-size:32px;color:${ok ? '#4ade80' : '#f87171'}">` +
      `${ok ? `HOLD — GEAR 12 @ ${CADENCE_TARGET}` : !gearOk ? 'SHIFT TO GEAR 12' : `CADENCE → ${CADENCE_TARGET}`}</div>` +
      `<div style="font-size:16px;color:#94a3b8">do not shift · do not change anything</div>` +
      `<div style="margin-top:8px;font-size:19px">` +
      row('Gear', `${gear} · ${g.gearRatio.toFixed(2)}`, gearOk ? '#4ade80' : '#f87171') +
      row('Cadence', `${cad} rpm`, cadOk ? '#4ade80' : '#f87171') +
      row('Condition', `Crr ${crr} · Cw ${cw}`) +
      row('Next toggle in', `${left} s`) +
      `</div><div style="margin-top:8px;font-size:14px;color:#64748b">[ = easier &nbsp; ] = harder</div>`
  }

  window.addEventListener('workoutStepChanged', onStep)
  const hudTimer = setInterval(render, 400)
  render()
  window.__auto18 = {
    onStep,
    // Exposed so a DRY RUN can assert which phase a given step selects, without riding.
    // The 2026-08-06 ride lost its Crr arm to a bug that one headless pass would have caught.
    phaseName: () => phase?.name ?? null,
    PHASES,
    stop() {
      window.removeEventListener('workoutStepChanged', onStep)
      if (timer) clearInterval(timer)
      clearInterval(hudTimer)
      el.remove()
    },
  }
  // Start on the A side so the panel is correct before Start Workout is pressed.
  phase = PHASES[0]
  applyCondition(PHASES[0].a, 'armed')
  phase = null
  console.log(
    `%c[18] armed — ${PHASES.length} phases, toggling every ${TOGGLE_MS / 1000}s. Hold gear 12 at ${CADENCE_TARGET} rpm and touch nothing.`,
    'color:#60a5fa;font-weight:bold'
  )
})()
