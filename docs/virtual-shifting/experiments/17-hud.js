// Experiment 17 — on-bike HUD. Paste into the console (or inject over CDP) before riding.
//
// Why this exists: the protocol's demands are per-SECTION ("gear 12 at 85 rpm from 355 m to
// 745 m, free everywhere else") but the app's own display only says "SIM". The rider was left
// holding a five-row table in their head while pedalling, and the first attempt was ridden two
// gears off baseline for 200 m as a direct result. An instruction the rider cannot see is an
// instruction that will not be followed.
//
// Reads state only — never writes. Safe to inject or remove mid-ride.
;(() => {
  const SECTIONS = [
    {
      from: 0,
      to: 350,
      grade: '3%',
      name: 'CLIMB — settle',
      hold: false,
      note: 'get into gear 12',
    },
    { from: 350, to: 745, grade: '0%', name: 'BLOCK A', hold: true, note: 'MEASUREMENT' },
    { from: 745, to: 1000, grade: '6%', name: 'CLIMB', hold: false, note: 'any gear' },
    { from: 1000, to: 1300, grade: '−2%', name: 'DESCENT', hold: false, note: 'any gear' },
    { from: 1300, to: 1700, grade: '0%', name: 'BLOCK B', hold: true, note: 'MEASUREMENT' },
  ]
  const REQUIRED_GEAR = 12
  const REQUIRED_RATIO = 2.4
  const CADENCE_TARGET = 85
  const CADENCE_TOL = 7

  document.getElementById('hud17')?.remove()
  const el = document.createElement('div')
  el.id = 'hud17'
  el.style.cssText = [
    'position:fixed',
    'top:8px',
    'left:8px',
    'z-index:2147483647',
    'background:rgba(5,8,14,0.94)',
    'border:2px solid #334155',
    'border-radius:12px',
    'padding:14px 18px',
    'font:600 20px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace',
    'color:#e2e8f0',
    'min-width:430px',
    'pointer-events:none',
    'box-shadow:0 8px 32px rgba(0,0,0,0.6)',
  ].join(';')
  document.body.appendChild(el)

  const big = (t, c) => `<div style="font-size:34px;line-height:1.15;color:${c}">${t}</div>`
  const row = (l, v, c = '#e2e8f0') =>
    `<div style="display:flex;justify-content:space-between;gap:18px"><span style="color:#7c8persistent">${l}</span><span style="color:${c}">${v}</span></div>`.replace(
      '#7c8persistent',
      '#94a3b8'
    )

  function render() {
    const H = window.Hybrid
    if (!H || !H.state) {
      el.innerHTML = 'waiting for the app…'
      return
    }
    const W = H.state.workout
    const plan = H.state.workoutPlan || []
    const step = plan[W.currentStepIndex]
    const g = window.virtualDrivetrain.getVirtualGear()
    const gear = g.gearIndex + 1
    const cad = Math.round(H.state.lastCadenceRpm || 0)
    const lap = window.__auto17?.applied ?? '?'
    const { crr, cw } = H.state.simPhysics || {}

    const head =
      `<div style="font-size:15px;color:#60a5fa;margin-bottom:6px">` +
      `LAP ${lap}/6 &nbsp;·&nbsp; Crr ${crr} &nbsp;·&nbsp; Cw ${cw} &nbsp;·&nbsp; step ${W.currentStepIndex + 1}/${plan.length}</div>`

    if (!W.isRunning) {
      el.innerHTML =
        head + big('NOT RUNNING', '#fbbf24') + row('Gear', `${gear} · ${g.gearRatio.toFixed(2)}`)
      return
    }

    if (!step || step.type !== 'sim') {
      // ERG rest / warm-up / cool-down: nothing is measured here.
      el.innerHTML =
        head +
        big('REST — pedal easy', '#38bdf8') +
        `<div style="font-size:16px;color:#94a3b8;margin-top:4px">conditions change automatically · touch nothing</div>` +
        row('Gear', `${gear} · ${g.gearRatio.toFixed(2)}`) +
        row('Cadence', `${cad} rpm`)
      return
    }

    const d = Math.round(W.simDistanceTraveled || 0)
    const sec = SECTIONS.find((s) => d >= s.from && d < s.to) || SECTIONS[SECTIONS.length - 1]
    const toGo = Math.max(0, sec.to - d)
    const gearOk = gear === REQUIRED_GEAR
    const cadOk = Math.abs(cad - CADENCE_TARGET) <= CADENCE_TOL

    let banner, sub
    if (sec.hold) {
      const ok = gearOk && cadOk
      banner = big(
        ok ? `HOLD — GEAR 12 @ 85` : `${!gearOk ? `SHIFT TO GEAR 12` : `CADENCE → 85`}`,
        ok ? '#4ade80' : '#f87171'
      )
      sub = `<div style="font-size:16px;color:${ok ? '#4ade80' : '#f87171'}">${sec.grade} ${sec.name} — ${sec.note} · do not shift</div>`
    } else {
      banner = big(`FREE — ${sec.grade} ${sec.name}`, '#cbd5e1')
      sub = `<div style="font-size:16px;color:#94a3b8">${sec.note}</div>`
    }

    el.innerHTML =
      head +
      banner +
      sub +
      `<div style="margin-top:8px;font-size:19px">` +
      row('Gear', `${gear} · ${g.gearRatio.toFixed(2)}`, gearOk ? '#4ade80' : '#f87171') +
      row('Cadence', `${cad} rpm`, sec.hold ? (cadOk ? '#4ade80' : '#f87171') : '#e2e8f0') +
      row('Route', `${d} / 1700 m`) +
      row(sec.hold ? 'Block ends in' : 'Next section in', `${toGo} m`) +
      `</div>` +
      `<div style="margin-top:8px;font-size:14px;color:#64748b">[ = easier &nbsp; ] = harder</div>`
  }

  render()
  const id = setInterval(render, 400)
  window.__hud17 = {
    stop() {
      clearInterval(id)
      el.remove()
    },
  }
  console.log('[17] HUD on. window.__hud17.stop() to remove.')
})()
