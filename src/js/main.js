// FTMS Hybrid Workout App - Main JavaScript Module

// Import ftms module to ensure it's loaded before main.js runs
import './ftms.js'
import { haversineDistance } from '../utils/geo.js'
import { clamp } from '../utils/math.js'
import { formatTime } from '../utils/time.js'
import {
  loadRoute,
  saveRoute as persistRoute,
  loadWorkoutPlan,
  saveWorkoutPlan,
  clearWorkoutPlan,
  getSavedList,
  saveToList,
  loadFromList,
  deleteFromList,
  loadGearSettings,
  saveGearSettings,
} from '../services/storage.js'
import { preprocessRouteData, getGradeForDistance } from '../services/routeService.js'
import { calculateRealisticGrade } from '../services/simPhysics.js'
import {
  GRAPH_CONFIG,
  calculateWorkoutMetrics,
  generateErgPaths,
  generateSimPaths,
  generateStepDividers,
  calculatePositionFraction,
} from '../services/graphService.js'
import { buildStepSummary, buildWorkoutSummary } from '../services/workoutService.js'

// 1) GLOBAL VARS / STATE / UTILS
;(function (H) {
  // ---- dom
  H.dom = {
    garminDataTextarea: document.getElementById('garmin-data'),
    saveRouteButton: document.getElementById('save-route-button'),
    routeInputContainer: document.getElementById('route-input-container'),
    routeInfoDiv: document.getElementById('route-info'),
    segmentNameSpan: document.getElementById('segment-name'),
    totalDistanceSpan: document.getElementById('total-distance'),
    averageGradeSpan: document.getElementById('average-grade'),
    errorDiv: document.getElementById('error-message'),
    errorText: document.getElementById('error-text'),

    stepTypeSelect: document.getElementById('step-type'),
    ergInputsDiv: document.getElementById('erg-inputs'),
    simInputsDiv: document.getElementById('sim-inputs'),
    ergDurationInput: document.getElementById('erg-duration'),
    ergPowerInput: document.getElementById('erg-power'),
    addStepButton: document.getElementById('add-step-button'),
    workoutListDiv: document.getElementById('workout-list'),
    clearWorkoutButton: document.getElementById('clear-workout-button'),
    noStepsMessage: document.getElementById('no-steps'),

    connectButton: document.getElementById('connect-button'),
    startWorkoutButton: document.getElementById('start-workout-button'),
    skipStepButton: document.getElementById('skip-step-button'),
    debugBluetoothButton: document.getElementById('debug-bluetooth-button'),
    workoutProgressText: document.getElementById('workout-progress-text'),
    targetDisplay: document.getElementById('target-display'),
    simSegmentSelect: document.getElementById('sim-segment'),

    // Workout graph elements
    workoutGraph: document.getElementById('workout-graph'),
    graphPositionMarker: document.getElementById('graph-position-marker'),
    graphStepDividers: document.getElementById('graph-step-dividers'),
    graphEmptyMessage: document.getElementById('graph-empty-message'),
    graphZeroLine: document.getElementById('graph-zero-line'),

    // Saved workouts elements
    savedWorkoutsSelect: document.getElementById('saved-workouts-select'),
    loadWorkoutButton: document.getElementById('load-workout-button'),
    deleteSavedWorkoutButton: document.getElementById('delete-saved-workout-button'),
    saveWorkoutName: document.getElementById('save-workout-name'),
    saveWorkoutButton: document.getElementById('save-workout-button'),
    savedWorkoutsCount: document.getElementById('saved-workouts-count'),

    // Virtual gearing settings elements
    ftpInput: document.getElementById('ftp-input'),
    baselineGearSelect: document.getElementById('baseline-gear-select'),
    applyFtpButton: document.getElementById('apply-ftp-button'),
    powerCurveStatus: document.getElementById('power-curve-status'),
  }

  // ---- FTMS instance (getter to always reference window.ftms)
  Object.defineProperty(H, 'ftms', {
    get() {
      return window.ftms
    },
  })

  // ---- app state
  H.state = {
    garminRoute: null,
    preprocessedRoute: [],
    workoutPlan: loadWorkoutPlan(),

    ftmsConnected: false,

    workout: {
      isRunning: false,
      currentStepIndex: 0,
      stepStartTime: 0,
      workoutStartTime: 0,
      totalWorkoutDuration: 0,
      simDistanceTraveled: 0,
      lastSimUpdateTs: 0,
      stepSummary: [], // Track each step's performance
      stepSimDistance: 0, // Track distance within current SIM step only
      summary: null, // Store workout summary here instead of global

      // Enhanced SIM mode state for realistic gradients
      currentGrade: 0, // Currently applied grade
      targetGrade: 0, // Target grade from route
      lastGradeUpdate: null,
      lastGradeDistance: 0, // Track distance for gradient ramping
      gradeHistory: [], // Track recent grades for smoothing

      // Virtual gearing for on-the-fly difficulty adjustment
      virtualGearEnabled: true,
      currentGear: 5, // Baseline gear (34/17, calibration baseline)
    },
  }

  // ---- timers
  H.timers = { ergTimeout: null, simInterval: null, totalWorkoutTimeInterval: null }

  // ---- utils
  H.utils = {
    clamp,
    haversineDistance,
    formatTime,

    // UI utilities (DOM-coupled — stays here until Step 7)
    showError: (m, type = 'error') => {
      H.dom.errorText.textContent = m
      H.dom.errorDiv.classList.remove('hidden')

      // Update styling based on type
      if (type === 'success') {
        H.dom.errorDiv.classList.remove('bg-red-100', 'border-red-400', 'text-red-700')
        H.dom.errorDiv.classList.add('bg-green-100', 'border-green-400', 'text-green-700')
      } else {
        H.dom.errorDiv.classList.remove('bg-green-100', 'border-green-400', 'text-green-700')
        H.dom.errorDiv.classList.add('bg-red-100', 'border-red-400', 'text-red-700')
      }

      // Auto-hide after 3 seconds
      setTimeout(() => H.utils.hideError(), 3000)
    },
    hideError: () => H.dom.errorDiv.classList.add('hidden'),
  }
})((window.Hybrid = window.Hybrid || {}))

// 2) ROUTE: ADD / STEP / EXTRACT
;(function (H) {
  function getGradeForDistanceFn(distance) {
    return getGradeForDistance(distance, H.state.preprocessedRoute)
  }

  function updateRouteDisplay() {
    const { garminRoute } = H.state
    const D = H.dom
    if (garminRoute) {
      D.routeInputContainer.classList.add('hidden')
      D.routeInfoDiv.classList.remove('hidden')
      D.segmentNameSpan.textContent = garminRoute.name
      D.totalDistanceSpan.textContent = `${(garminRoute.totalDistance / 1000).toFixed(2)} km (${garminRoute.totalDistance.toFixed(2)} meters)`
      D.averageGradeSpan.textContent = `${garminRoute.averageGrade.toFixed(2)}%`
    } else {
      D.routeInputContainer.classList.remove('hidden')
      D.routeInfoDiv.classList.add('hidden')
    }
  }

  function saveRoute() {
    const D = H.dom
    try {
      const json = JSON.parse(D.garminDataTextarea.value.trim())
      if (!json.name || !Array.isArray(json.geoPoints))
        throw new Error("Invalid Garmin JSON: need 'name' and 'geoPoints'.")

      H.state.preprocessedRoute = preprocessRouteData(json.geoPoints)
      const totalDistance = H.state.preprocessedRoute[H.state.preprocessedRoute.length - 1].distance
      const totalElevationChange =
        json.geoPoints[json.geoPoints.length - 1].elevation - json.geoPoints[0].elevation
      const averageGrade = (totalElevationChange / totalDistance) * 100

      H.state.garminRoute = {
        name: json.name,
        geoPoints: json.geoPoints,
        totalDistance,
        averageGrade,
      }
      persistRoute(H.state.garminRoute)
      window.dispatchEvent(new CustomEvent('routeLoaded'))

      updateRouteDisplay()
      H.utils.hideError()
      D.stepTypeSelect.querySelector('option[value="sim"]').disabled = false
      D.simSegmentSelect.innerHTML = `<option value="${H.state.garminRoute.name}">${H.state.garminRoute.name}</option>`
    } catch (e) {
      console.error(e)
      H.utils.showError(e.message)
      H.state.garminRoute = null
      D.stepTypeSelect.querySelector('option[value="sim"]').disabled = true
      D.routeInfoDiv.classList.add('hidden')
      D.routeInputContainer.classList.remove('hidden')
    }
  }

  function addStep() {
    const D = H.dom,
      S = H.state
    const stepType = D.stepTypeSelect.value
    let step = null

    if (stepType === 'erg') {
      const duration = parseFloat(D.ergDurationInput.value)
      const power = parseFloat(D.ergPowerInput.value)
      if (isNaN(duration) || isNaN(power) || duration <= 0 || power <= 0)
        return H.utils.showError('Enter positive numbers for duration and power.')
      step = { type: 'erg', duration, power }
      D.ergDurationInput.value = ''
      D.ergPowerInput.value = ''
    } else if (stepType === 'sim') {
      if (!S.garminRoute) return H.utils.showError('Import a Garmin route first to add a SIM step.')
      step = { type: 'sim', segmentName: S.garminRoute.name }
    }

    if (step) {
      S.workoutPlan.push(step)
      saveWorkoutPlan(S.workoutPlan)
      window.dispatchEvent(new CustomEvent('workoutPlanUpdated'))
      renderWorkoutPlan()
      H.utils.hideError()
    }
  }

  function renderWorkoutPlan() {
    const D = H.dom,
      S = H.state
    D.workoutListDiv.innerHTML = ''
    S.workout.totalWorkoutDuration = 0

    if (!S.workoutPlan.length) {
      D.noStepsMessage.classList.remove('hidden')
      D.clearWorkoutButton.classList.add('hidden')
      return
    }
    D.noStepsMessage.classList.add('hidden')
    D.clearWorkoutButton.classList.remove('hidden')

    S.workoutPlan.forEach((step, index) => {
      const el = document.createElement('div')
      el.className =
        'flex items-center justify-between p-3 sm:p-4 bg-surface-elevated rounded-lg border border-border text-sm sm:text-base'
      let content = ''
      if (step.type === 'erg') {
        content = `<span class="font-bold text-cyan-400">ERG:</span> ${step.duration} min at ${step.power}W`
        S.workout.totalWorkoutDuration += step.duration * 60
      } else if (step.type === 'sim') {
        content = `<span class="font-bold text-orange-400">SIM:</span> <span class="hidden xs:inline">${step.segmentName}</span><span class="xs:hidden">Route</span>`
      }
      el.innerHTML = `
        <div class="flex-1 min-w-0 text-gray-200"><span class="text-gray-400 font-medium">Step ${index + 1}:</span> ${content}</div>
        <button class="remove-step-button text-red-500 hover:text-red-400 transition-colors ml-2 text-lg sm:text-xl flex-shrink-0" data-index="${index}">&times;</button>`
      D.workoutListDiv.appendChild(el)
    })

    D.workoutListDiv.querySelectorAll('.remove-step-button').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.index, 10)
        H.state.workoutPlan.splice(idx, 1)
        saveWorkoutPlan(H.state.workoutPlan)
        window.dispatchEvent(new CustomEvent('workoutPlanUpdated'))
        renderWorkoutPlan()
      })
    })

    // Update workout graph when plan changes
    if (H.graph && H.graph.renderWorkoutGraph) {
      H.graph.renderWorkoutGraph()
    }
  }

  function clearWorkout() {
    H.state.workoutPlan = []
    clearWorkoutPlan()
    window.dispatchEvent(new CustomEvent('workoutPlanUpdated'))
    renderWorkoutPlan()
  }

  H.route = {
    preprocessRouteData,
    getGradeForDistance: getGradeForDistanceFn,
    updateRouteDisplay,
    saveRoute,
    addStep,
    renderWorkoutPlan,
    clearWorkout,
  }
})(window.Hybrid)

// 2.5) SAVED WORKOUTS - Manage multiple workout plans
;(function (H) {
  // Save current workout with a name
  function saveWorkout(name) {
    if (!name || !name.trim()) {
      H.utils.showError('Please enter a workout name')
      return false
    }
    const trimmedName = name.trim()
    const plan = H.state.workoutPlan
    if (!plan || plan.length === 0) {
      H.utils.showError('No workout steps to save')
      return false
    }

    saveToList(trimmedName, { plan, routeName: H.state.garminRoute?.name || null })

    console.log(`Saved workout: "${trimmedName}" with ${plan.length} steps`)
    H.utils.hideError()
    updateSavedWorkoutsUI()
    return true
  }

  // Load a saved workout by name
  function loadWorkout(name) {
    if (!name) return false
    const workoutData = loadFromList(name)
    if (!workoutData) {
      H.utils.showError(`Workout "${name}" not found`)
      return false
    }

    H.state.workoutPlan = workoutData.plan || []
    saveWorkoutPlan(H.state.workoutPlan)
    H.route.renderWorkoutPlan()
    console.log(`Loaded workout: "${name}" with ${H.state.workoutPlan.length} steps`)

    if (
      workoutData.routeName &&
      (!H.state.garminRoute || H.state.garminRoute.name !== workoutData.routeName)
    ) {
      H.utils.showError(
        `Note: This workout uses route "${workoutData.routeName}" which may need to be imported`
      )
      setTimeout(() => H.utils.hideError(), 5000)
    } else {
      H.utils.hideError()
    }
    return true
  }

  // Delete a saved workout
  function deleteWorkout(name) {
    if (!name) return false
    deleteFromList(name)
    console.log(`Deleted workout: "${name}"`)
    updateSavedWorkoutsUI()
    return true
  }

  // Update the saved workouts dropdown and count
  function updateSavedWorkoutsUI() {
    const D = H.dom
    if (!D.savedWorkoutsSelect) return

    const list = getSavedList()

    D.savedWorkoutsSelect.innerHTML = '<option value="">— Select saved workout —</option>'

    list.forEach((name) => {
      const data = loadFromList(name)
      const stepCount = data?.plan?.length || 0
      const option = document.createElement('option')
      option.value = name
      option.textContent = `${name} - ${stepCount} steps`
      D.savedWorkoutsSelect.appendChild(option)
    })

    // Update count
    if (D.savedWorkoutsCount) {
      D.savedWorkoutsCount.textContent =
        list.length === 0
          ? 'No saved workouts'
          : `${list.length} saved workout${list.length > 1 ? 's' : ''}`
    }

    // Update button states
    updateButtonStates()
  }

  // Update load/delete button states based on selection
  function updateButtonStates() {
    const D = H.dom
    const hasSelection = D.savedWorkoutsSelect && D.savedWorkoutsSelect.value !== ''

    if (D.loadWorkoutButton) {
      D.loadWorkoutButton.disabled = !hasSelection
    }
    if (D.deleteSavedWorkoutButton) {
      D.deleteSavedWorkoutButton.disabled = !hasSelection
    }
  }

  // Initialize saved workouts UI
  function initSavedWorkouts() {
    const D = H.dom

    // Update UI on load
    updateSavedWorkoutsUI()

    // Event: Selection change
    if (D.savedWorkoutsSelect) {
      D.savedWorkoutsSelect.addEventListener('change', updateButtonStates)
    }

    // Event: Save button
    if (D.saveWorkoutButton) {
      D.saveWorkoutButton.addEventListener('click', () => {
        const name = D.saveWorkoutName.value
        if (saveWorkout(name)) {
          D.saveWorkoutName.value = ''
        }
      })
    }

    // Event: Load button
    if (D.loadWorkoutButton) {
      D.loadWorkoutButton.addEventListener('click', () => {
        const name = D.savedWorkoutsSelect.value
        if (name && confirm(`Load workout "${name}"? This will replace your current workout.`)) {
          loadWorkout(name)
        }
      })
    }

    // Event: Delete button
    if (D.deleteSavedWorkoutButton) {
      D.deleteSavedWorkoutButton.addEventListener('click', () => {
        const name = D.savedWorkoutsSelect.value
        if (name && confirm(`Delete workout "${name}"? This cannot be undone.`)) {
          deleteWorkout(name)
        }
      })
    }

    // Event: Enter key in name input
    if (D.saveWorkoutName) {
      D.saveWorkoutName.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          D.saveWorkoutButton.click()
        }
      })
    }
  }

  H.savedWorkouts = {
    getSavedWorkoutsList: getSavedList,
    saveWorkout,
    loadWorkout,
    deleteWorkout,
    updateSavedWorkoutsUI,
    initSavedWorkouts,
  }
})(window.Hybrid)

// 3) UI-SPECIFIC UPDATES
;(function (H) {
  function updateWorkoutTime() {
    const S = H.state.workout
    if (!S.isRunning) return
    const now = Date.now()

    // Backup auto-advance: ensures ERG steps advance even if setTimeout was
    // throttled by the browser (background tab, device sleep).
    const plan = H.state.workoutPlan
    if (plan.length > 0 && S.currentStepIndex < plan.length) {
      const currentStep = plan[S.currentStepIndex]
      if (currentStep.type === 'erg' && currentStep.duration) {
        const stepDurationSec = currentStep.duration * 60
        const stepElapsedSec = Math.floor((now - S.stepStartTime) / 1000)
        if (stepElapsedSec >= stepDurationSec) {
          console.log(
            `[ERG] Step duration exceeded (${stepElapsedSec}s >= ${stepDurationSec}s), auto-advancing...`
          )
          if (H.timers.ergTimeout) {
            clearTimeout(H.timers.ergTimeout)
            H.timers.ergTimeout = null
          }
          setTimeout(() => H.handlers.skipStep(), 0)
        }
      }
    }

    // Update graph position marker
    if (H.graph && H.graph.updatePositionMarker) {
      H.graph.updatePositionMarker()
    }
  }

  // Initialize virtual gearing settings UI
  function initVirtualGearingSettings() {
    const D = H.dom

    const { ftp: savedFTP, baselineGear: savedBaselineGear } = loadGearSettings()

    if (savedFTP) {
      D.ftpInput.value = savedFTP
    }
    if (savedBaselineGear) {
      D.baselineGearSelect.value = savedBaselineGear
    }

    // Apply saved settings to VirtualGear on boot
    if (window.ftms && window.ftms.virtualGear) {
      const ftp = parseInt(D.ftpInput.value) || 250
      const baselineGear = parseInt(D.baselineGearSelect.value) || 3

      window.ftms.virtualGear.setFTP(ftp)
      window.ftms.virtualGear.setBaselineGear(baselineGear)

      updatePowerCurveStatus()
    }

    // Apply button event listener
    D.applyFtpButton.addEventListener('click', () => {
      const ftp = parseInt(D.ftpInput.value)
      const baselineGear = parseInt(D.baselineGearSelect.value)

      if (!ftp || ftp < 100 || ftp > 500) {
        H.utils.showError('Please enter a valid FTP between 100-500W')
        return
      }

      if (window.ftms && window.ftms.virtualGear) {
        window.ftms.virtualGear.setFTP(ftp)
        window.ftms.virtualGear.setBaselineGear(baselineGear)

        saveGearSettings({ ftp, baselineGear })

        updatePowerCurveStatus()
        H.utils.showError('Virtual gearing settings applied!', 'success')
      }
    })
  }

  // Update power curve status text
  function updatePowerCurveStatus() {
    const D = H.dom
    if (!window.ftms || !window.ftms.virtualGear) return

    const vg = window.ftms.virtualGear
    const method = vg.calibration.method
    const ftp = vg.calibration.userFTP
    const baselineGear = vg.gearTable[vg.baselineGearIndex]

    if (method === 'calibrated') {
      D.powerCurveStatus.textContent = `Using calibrated power curve (baseline: ${baselineGear.front}/${baselineGear.rear})`
    } else if (method === 'ftp-based') {
      D.powerCurveStatus.textContent = `Using FTP-based model (${ftp}W, baseline: ${baselineGear.front}/${baselineGear.rear})`
    } else {
      D.powerCurveStatus.textContent = `Using ratio-based model (baseline: ${baselineGear.front}/${baselineGear.rear})`
    }
  }

  function boot() {
    const D = H.dom
    const storedRoute = loadRoute()
    if (storedRoute) {
      H.state.garminRoute = storedRoute
      H.state.preprocessedRoute = H.route.preprocessRouteData(H.state.garminRoute.geoPoints)
      H.route.updateRouteDisplay()
      D.stepTypeSelect.querySelector('option[value="sim"]').disabled = false
      D.simSegmentSelect.innerHTML = `<option value="${H.state.garminRoute.name}">${H.state.garminRoute.name}</option>`
    } else {
      H.route.updateRouteDisplay()
    }
    H.route.renderWorkoutPlan()

    // UI events
    D.saveRouteButton.addEventListener('click', H.route.saveRoute)
    D.addStepButton.addEventListener('click', H.route.addStep)
    D.clearWorkoutButton.addEventListener('click', H.route.clearWorkout)
    D.connectButton.addEventListener('click', H.handlers.connectTrainer)
    D.startWorkoutButton.addEventListener('click', H.handlers.startWorkout)
    D.skipStepButton.addEventListener('click', H.handlers.skipStep)
    D.debugBluetoothButton.addEventListener('click', H.handlers.openBluetoothDebug)

    D.stepTypeSelect.addEventListener('change', () => {
      if (D.stepTypeSelect.value === 'erg') {
        D.ergInputsDiv.classList.remove('hidden')
        D.simInputsDiv.classList.add('hidden')
      } else {
        D.ergInputsDiv.classList.add('hidden')
        D.simInputsDiv.classList.remove('hidden')
      }
    })

    // workout clock
    if (H.timers.totalWorkoutTimeInterval) clearInterval(H.timers.totalWorkoutTimeInterval)
    H.timers.totalWorkoutTimeInterval = setInterval(updateWorkoutTime, 1000)

    // Render workout graph on boot (after a short delay to ensure graph module is loaded)
    setTimeout(() => {
      if (H.graph && H.graph.renderWorkoutGraph) {
        H.graph.renderWorkoutGraph()
      }
    }, 100)

    // Initialize saved workouts feature
    if (H.savedWorkouts && H.savedWorkouts.initSavedWorkouts) {
      H.savedWorkouts.initSavedWorkouts()
    }

    // Initialize virtual gearing settings
    initVirtualGearingSettings()

    // Keyboard shortcuts for virtual gearing during workouts
    document.addEventListener('keydown', (e) => {
      // Only handle if workout is active and in SIM mode
      if (!H.state.workout.isRunning) return

      const currentStep = H.state.workoutPlan[H.state.workout.currentStepIndex]
      if (!currentStep || currentStep.type !== 'sim') return
      if (!H.state.workout.virtualGearEnabled) return

      // Left Arrow or '[' = Shift Down (easier)
      if (e.key === 'ArrowLeft' || e.key === '[') {
        e.preventDefault()
        H.handlers.shiftGearDown()
      }
      // Right Arrow or ']' = Shift Up (harder)
      else if (e.key === 'ArrowRight' || e.key === ']') {
        e.preventDefault()
        H.handlers.shiftGearUp()
      }
    })
  }

  document.addEventListener('DOMContentLoaded', boot)

  H.ui = { updateWorkoutTime, boot }
})(window.Hybrid)

// 3.5) WORKOUT GRAPH - Visual representation of workout profile
;(function (H) {
  // Update Y-axis labels based on workout content
  function updateYLabels(metrics) {
    const { steps, maxPower } = metrics
    const hasErg = steps.some((s) => s.type === 'erg')
    const hasSim = steps.some((s) => s.type === 'sim')

    const leftLabels = document.getElementById('graph-y-labels-left')
    if (leftLabels) {
      if (hasErg) {
        leftLabels.innerHTML = `
                    <text x="45" y="20" text-anchor="end" font-weight="bold" fill="#3b82f6">W</text>
                    <text x="45" y="35" text-anchor="end" fill="#3b82f6">${maxPower}</text>
                    <text x="45" y="140" text-anchor="end" fill="#3b82f6">0</text>
                `
        leftLabels.style.opacity = '1'
      } else {
        leftLabels.style.opacity = '0.3'
      }
    }

    const rightLabels = document.getElementById('graph-y-labels-right')
    if (rightLabels) {
      if (hasSim) {
        rightLabels.innerHTML = `
                    <text x="755" y="20" text-anchor="start" font-weight="bold" fill="#f97316">%</text>
                    <text x="755" y="35" text-anchor="start" fill="#f97316">+15</text>
                    <text x="755" y="78" text-anchor="start" fill="#f97316">0</text>
                    <text x="755" y="140" text-anchor="start" fill="#f97316">-10</text>
                `
        rightLabels.style.opacity = '1'
      } else {
        rightLabels.style.opacity = '0.3'
      }
    }
  }

  // Render the complete workout graph
  function renderWorkoutGraph() {
    const D = H.dom
    const ergProfiles = document.getElementById('graph-erg-profiles')
    const simProfiles = document.getElementById('graph-sim-profiles')

    if (!ergProfiles || !simProfiles) return

    const plan = H.state.workoutPlan

    if (!plan || plan.length === 0) {
      if (D.graphEmptyMessage) D.graphEmptyMessage.style.display = 'block'
      ergProfiles.innerHTML = ''
      simProfiles.innerHTML = ''
      if (D.graphStepDividers) D.graphStepDividers.innerHTML = ''
      if (D.graphPositionMarker) D.graphPositionMarker.style.display = 'none'
      return
    }

    if (D.graphEmptyMessage) D.graphEmptyMessage.style.display = 'none'

    const metrics = calculateWorkoutMetrics(plan, H.state.garminRoute)

    ergProfiles.innerHTML = generateErgPaths(metrics)
    simProfiles.innerHTML = generateSimPaths(
      metrics,
      GRAPH_CONFIG,
      H.state.preprocessedRoute,
      getGradeForDistance
    )

    if (D.graphStepDividers) D.graphStepDividers.innerHTML = generateStepDividers(metrics)

    updateYLabels(metrics)

    if (D.graphPositionMarker) {
      D.graphPositionMarker.setAttribute('transform', `translate(${GRAPH_CONFIG.paddingLeft}, 0)`)
      D.graphPositionMarker.style.display = 'none'
    }

    H.state.graphMetrics = metrics
  }

  // Update position marker during workout
  function updatePositionMarker() {
    const D = H.dom
    const S = H.state.workout
    const metrics = H.state.graphMetrics

    if (!D.graphPositionMarker || !metrics || !S.isRunning) {
      if (D.graphPositionMarker) D.graphPositionMarker.style.display = 'none'
      return
    }

    const stepElapsed = (Date.now() - S.stepStartTime) / 1000
    const fraction = calculatePositionFraction(
      metrics,
      S.currentStepIndex,
      stepElapsed,
      S.simDistanceTraveled,
      H.state.garminRoute
    )
    const x =
      GRAPH_CONFIG.paddingLeft +
      fraction * (GRAPH_CONFIG.width - GRAPH_CONFIG.paddingLeft - GRAPH_CONFIG.paddingRight)

    D.graphPositionMarker.setAttribute('transform', `translate(${x}, 0)`)
    D.graphPositionMarker.style.display = 'block'
  }

  H.graph = { renderWorkoutGraph, updatePositionMarker, calculateWorkoutMetrics, GRAPH_CONFIG }
})(window.Hybrid)

// 4) ERG CONTROLS (using ftms module)
;(function (H) {
  async function setErgModePower(power) {
    if (!H.state.ftmsConnected) {
      console.error('FTMS not connected.')
      return
    }
    try {
      const pwr = Math.max(0, Math.min(2000, Math.round(power)))
      await H.ftms.setErgWatts(pwr)
      console.log(`ERG power set to ${pwr}W`)
    } catch (e) {
      console.error('Failed to set ERG power:', e)
    }
  }

  H.erg = { setErgModePower }
})(window.Hybrid)

// 5) SIM CONTROLS (using ftms module)
;(function (H) {
  async function setSimGrade(rawGradePct, opts = {}) {
    if (!H.state.ftmsConnected) {
      console.warn('SIM: FTMS not connected.')
      return
    }

    const {
      windMS = 0.0,
      crr = 0.003,
      cw = 0.45,
      currentSpeed = 0,
      currentDistance = 0,
      forceUpdate = false,
    } = opts

    // Calculate realistic grade with momentum simulation and distance-based ramping
    const realisticGrade = calculateRealisticGrade(
      rawGradePct,
      currentSpeed,
      currentDistance,
      H.state.workout,
      Date.now()
    )

    // Apply virtual gearing multiplier if enabled
    let finalGrade = realisticGrade
    if (H.state.workout.virtualGearEnabled && window.ftms && window.ftms.virtualGear) {
      finalGrade = window.ftms.virtualGear.applyToGradient(realisticGrade)
    }

    // More conservative throttling for smoother experience (skip if force update)
    if (!forceUpdate) {
      const now = Date.now()
      if (!setSimGrade.__lastTs) setSimGrade.__lastTs = 0
      if (now - setSimGrade.__lastTs < 3000) return // 3 second throttle for smoother changes

      // Check if the grade change is significant enough to warrant an update
      if (setSimGrade.__lastGrade !== undefined) {
        const gradeDiff = Math.abs(finalGrade - setSimGrade.__lastGrade)
        if (gradeDiff < 0.3) return // Smaller threshold for smoother experience
      }

      setSimGrade.__lastTs = now
    }

    setSimGrade.__lastGrade = finalGrade

    try {
      await H.ftms.setSim({
        gradePct: finalGrade,
        crr,
        cwa: cw,
        windMps: windMS,
      })

      // Log with gear info if enabled
      if (H.state.workout.virtualGearEnabled && window.ftms && window.ftms.virtualGear) {
        const gear = window.ftms.virtualGear.getCurrentGear()
        const multiplier = window.ftms.virtualGear.getMultiplier()
        console.log(
          `[SIM] Raw: ${rawGradePct.toFixed(1)}% -> Realistic: ${realisticGrade.toFixed(1)}% -> Gear ${gear.index + 1} (${multiplier.toFixed(2)}x): ${finalGrade.toFixed(1)}% | speed=${currentSpeed.toFixed(1)}kph`
        )
      } else {
        console.log(
          `[SIM] Raw: ${rawGradePct.toFixed(1)}% -> Applied: ${finalGrade.toFixed(1)}% (momentum assist) | speed=${currentSpeed.toFixed(1)}kph`
        )
      }
    } catch (err) {
      console.warn('SIM: grade setting failed:', err)
    }
  }

  // smooth step into first route grade using ftms rampSim
  async function startSimStep() {
    const S = H.state.workout

    const dist0 = Math.max(0, S.simDistanceTraveled || 0)
    const routeGradeNow = H.route.getGradeForDistance(dist0) || 0
    const targetPct = Number.isFinite(routeGradeNow) ? routeGradeNow : 0

    console.log(`[SIM] Starting SIM step, ramping to grade: ${targetPct.toFixed(2)}%`)

    try {
      // Use ftms rampSim for smooth grade transition
      const fromPct = Math.sign(targetPct) * Math.max(0, Math.abs(targetPct) - 2)
      await window.ftms.rampSim({
        fromPct,
        toPct: targetPct,
        stepPct: 1,
        dwellMs: 1800,
        crr: 0.003,
        cwa: 0.45,
        windMps: 0.0,
      })
    } catch (err) {
      console.warn('SIM: ramp failed, setting direct grade:', err)
      await setSimGrade(targetPct)
    }
  }

  function updateSimMode(currentSpeedKph) {
    const S = H.state.workout
    const plan = H.state.workoutPlan
    const step = plan[S.currentStepIndex]

    // Only run if we're actually in a SIM step
    if (!step || step.type !== 'sim') return

    // Don't interfere if we're not running a workout
    if (!S.isRunning) return

    const now = Date.now()
    if (!S.lastSimUpdateTs) S.lastSimUpdateTs = now

    // Get route info for completion detection
    const route = H.state.garminRoute
    const routeMaxDistance = route ? route.totalDistance : Infinity

    if (Number.isFinite(currentSpeedKph)) {
      const dtSec = Math.max(0, (now - S.lastSimUpdateTs) / 1000)
      const mps = (currentSpeedKph * 1000) / 3600
      const distanceIncrement = mps * dtSec

      // Always update total step distance (for recording purposes)
      S.stepSimDistance = (S.stepSimDistance || 0) + distanceIncrement

      // Only update route position if we haven't completed the route
      const currentRouteDistance = S.simDistanceTraveled || 0
      if (currentRouteDistance < routeMaxDistance) {
        const newRouteDistance = currentRouteDistance + distanceIncrement
        S.simDistanceTraveled = Math.min(newRouteDistance, routeMaxDistance)
        window.dispatchEvent(
          new CustomEvent('simDistanceUpdated', {
            detail: {
              simDistanceTraveled: S.simDistanceTraveled,
              stepSimDistance: S.stepSimDistance || 0,
              routeCompleted: S.routeCompleted || false,
            },
          })
        )

        // Check if we just completed the route
        if (S.simDistanceTraveled >= routeMaxDistance && currentRouteDistance < routeMaxDistance) {
          console.log(
            `🏁 [SIM ROUTE COMPLETE] Finished ${route.name} at ${routeMaxDistance.toFixed(0)}m! Auto-advancing in 5 seconds...`
          )
          S.routeCompleted = true

          // Auto-advance after route completion with 5 second delay
          setTimeout(() => {
            console.log(`🚀 [AUTO-ADVANCE] Moving to next step after route completion`)
            H.handlers.skipStep()
          }, 5000) // Auto-skip after 5 seconds
        }
      }
    }
    S.lastSimUpdateTs = now

    // Notify React contexts of updated SIM distance
    window.dispatchEvent(
      new CustomEvent('simDistanceUpdated', {
        detail: {
          simDistanceTraveled: S.simDistanceTraveled,
          stepSimDistance: S.stepSimDistance || 0,
          routeCompleted: S.routeCompleted || false,
        },
      })
    )

    // Get gradient based on route position (will freeze at end when route completed)
    const routeGrade = H.route.getGradeForDistance(S.simDistanceTraveled || 0)
    const gradePct = Number.isFinite(routeGrade) ? routeGrade : 0

    // Enhanced logging with route completion status
    if (!updateSimMode.__lastLog || now - updateSimMode.__lastLog > 3000) {
      const routeStatus = S.routeCompleted ? ' [ROUTE COMPLETE]' : ''
      const routeProgress =
        routeMaxDistance < Infinity
          ? ` (${((S.simDistanceTraveled / routeMaxDistance) * 100).toFixed(1)}%)`
          : ''
      console.log(
        `[SIM] route=${(S.simDistanceTraveled || 0).toFixed(0)}m${routeProgress} | total=${(S.stepSimDistance || 0).toFixed(0)}m | grade=${gradePct.toFixed(2)}%${routeStatus}`
      )
      updateSimMode.__lastLog = now
    }

    // This will be throttled by setSimGrade to prevent conflicts
    setSimGrade(gradePct, {
      windMS: 0.0,
      crr: 0.003,
      cw: 0.45,
      currentSpeed: currentSpeedKph,
      currentDistance: S.simDistanceTraveled || 0,
    })
  }

  H.sim = { setSimGrade, updateSimMode, startSimStep }
})(window.Hybrid)

// 6) UNIVERSAL HANDLERS (BLE, DATA PARSERS, WORKOUT FLOW)
;(function (H) {
  // FTMS data handler - called by our correct parsing
  function handleFtmsData(data) {
    const isValidSpeed =
      data.speedKph !== null &&
      data.speedKph !== undefined &&
      data.speedKph >= 0 &&
      data.speedKph <= 80
    if (isValidSpeed) H.state.lastSpeedKph = data.speedKph

    if (isValidSpeed) {
      // Update SIM mode if active - but throttle to prevent conflicts
      const currentStep = H.state.workoutPlan[H.state.workout.currentStepIndex]
      if (H.state.workout.isRunning && currentStep?.type === 'sim') {
        const now = Date.now()
        if (!handleFtmsData._lastSimUpdate || now - handleFtmsData._lastSimUpdate > 2000) {
          handleFtmsData._lastSimUpdate = now
          H.sim.updateSimMode(data.speedKph)
        }
      }
    }
  }

  async function connectTrainer() {
    console.clear()
    console.info('--- Starting Bluetooth Trainer Connection ---')
    window.dispatchEvent(new CustomEvent('ftmsConnecting'))
    try {
      // Connect to any FTMS-compatible device
      await window.ftms.connect({
        // nameHint removed - scans for all FTMS devices
        log: (msg) => console.log('[FTMS]', msg),
      })

      // Set up event listeners for FTMS data
      H.ftms.on('ibd', H.handlers.handleFtmsData)

      // No need for custom parsing - ftms.js is now fixed!

      H.state.ftmsConnected = true
      H.utils.hideError()
      window.dispatchEvent(new CustomEvent('ftmsConnected'))
    } catch (e) {
      console.error('Bluetooth connection failed:', e)
      H.state.ftmsConnected = false
      window.dispatchEvent(new CustomEvent('ftmsDisconnected'))
      H.utils.showError(
        'Failed to connect to trainer. Ensure Bluetooth is on and trainer is in pairing mode.'
      )
    }
  }

  H.workout = {
    startWorkout,
    runWorkoutStep,
    skipStep,
    endWorkout,
    recordStepSummary,
    generateWorkoutSummary,
  }

  // ------- WORKOUT FLOW -------
  function startWorkout() {
    const S = H.state
    const W = S.workout

    if (!Array.isArray(S.workoutPlan) || S.workoutPlan.length === 0) {
      H.utils.showError('Please build a workout plan first.')
      return
    }
    if (!S.ftmsConnected) {
      H.utils.showError('Please connect to a trainer first.')
      return
    }
    if (W.isRunning) return

    // FIX: Reset stepStartTime BEFORE setting isRunning to prevent race condition
    // where updateWorkoutTime could use stale stepStartTime from previous workout
    const now = Date.now()
    W.stepStartTime = now // Initialize to prevent stale time issues
    W.workoutStartTime = now

    W.isRunning = true
    W.currentStepIndex = 0
    W.lastSimUpdateTs = 0
    W.simDistanceTraveled = 0
    W.stepSimDistance = 0
    W.stepSummary = [] // Reset workout summary
    W.routeCompleted = false // Reset route completion status

    console.log('=== WORKOUT STARTED ===')
    console.log(`Total steps: ${S.workoutPlan.length}`)
    window.dispatchEvent(new CustomEvent('workoutStarted'))

    // Show position marker on graph
    if (H.graph && H.dom.graphPositionMarker) {
      H.dom.graphPositionMarker.style.display = 'block'
    }

    runWorkoutStep()

    if (H.timers.totalWorkoutTimeInterval) clearInterval(H.timers.totalWorkoutTimeInterval)
    H.timers.totalWorkoutTimeInterval = setInterval(H.ui.updateWorkoutTime, 1000)
  }

  function runWorkoutStep() {
    const S = H.state
    const W = S.workout
    const plan = S.workoutPlan
    const Dom = H.dom

    if (W.currentStepIndex >= plan.length) {
      endWorkout()
      return
    }

    if (H.timers.ergTimeout) clearTimeout(H.timers.ergTimeout)
    if (H.timers.simInterval) clearInterval(H.timers.simInterval)

    const currentStep = plan[W.currentStepIndex]
    Dom.workoutProgressText.textContent = `Step ${W.currentStepIndex + 1}/${plan.length}: ${currentStep.type.toUpperCase()}`
    W.stepStartTime = Date.now()

    console.log(
      `--- STEP ${W.currentStepIndex + 1}/${plan.length}: ${currentStep.type.toUpperCase()} ---`
    )

    if (currentStep.type === 'erg') {
      H.erg.setErgModePower(currentStep.power)
      Dom.targetDisplay.textContent = `Target: ${currentStep.power}W`
      console.log(`ERG: ${currentStep.power}W for ${currentStep.duration} minutes`)
      H.timers.ergTimeout = setTimeout(
        () => {
          skipStep()
        },
        currentStep.duration * 60 * 1000
      )
    } else if (currentStep.type === 'sim') {
      // Reset SIM-specific distance tracking for this step
      W.stepSimDistance = 0
      W.simDistanceTraveled = 0 // Reset route position
      W.lastSimUpdateTs = 0
      W.routeCompleted = false // Reset route completion for this step

      // Reset gradient state for smooth transitions
      W.currentGrade = 0
      W.targetGrade = 0
      W.lastGradeUpdate = Date.now()
      W.lastGradeDistance = 0
      W.gradeHistory = []

      // Display route info in target
      const route = H.state.garminRoute
      if (route) {
        Dom.targetDisplay.textContent = `Route: ${(route.totalDistance / 1000).toFixed(2)}km`
        console.log(
          `SIM: Following route gradient "${currentStep.segmentName}" (${route.totalDistance.toFixed(0)}m total)`
        )
      } else {
        Dom.targetDisplay.textContent = `Grade: Route`
        console.log(`SIM: Following route gradient (${currentStep.segmentName})`)
      }

      ;(async () => {
        try {
          await H.erg.setErgModePower(0)
        } catch (_e) {
          /* noop */
        }
        await new Promise((r) => setTimeout(r, 250))
        await H.sim.startSimStep() // smooth ramp into first grade
      })()
    }
  }

  function skipStep() {
    const S = H.state
    const W = S.workout
    const plan = S.workoutPlan

    if (!Array.isArray(plan) || plan.length === 0) {
      try {
        endWorkout()
      } catch (_e) {
        /* noop */
      }
      return
    }

    // Record step summary before moving to next step
    recordStepSummary()

    W.currentStepIndex++
    window.dispatchEvent(
      new CustomEvent('workoutStepChanged', { detail: { stepIndex: W.currentStepIndex } })
    )
    if (W.currentStepIndex >= plan.length) {
      try {
        endWorkout()
      } catch (_e) {
        /* noop */
      }
    } else {
      runWorkoutStep()
    }
  }

  function recordStepSummary() {
    const S = H.state
    const W = S.workout
    const plan = S.workoutPlan

    if (W.currentStepIndex >= plan.length) return

    const step = plan[W.currentStepIndex]
    const speedKph = H.state.lastSpeedKph || 0
    const summary = buildStepSummary(step, W.currentStepIndex, W, speedKph, Date.now())

    W.stepSummary.push(summary)

    if (summary.type === 'sim' && summary.routeDistance !== null) {
      const routeInfo = summary.routeCompleted
        ? `${(summary.routeDistance / 1000).toFixed(2)}km COMPLETE`
        : `${(summary.routeDistance / 1000).toFixed(2)}km route`
      console.log(
        `STEP ${summary.stepNumber} COMPLETE: SIM | Duration: ${(summary.actualDuration / 60).toFixed(1)}min | Total: ${(summary.distance / 1000).toFixed(2)}km | Route: ${routeInfo} | Avg Speed: ${summary.averageSpeed.toFixed(1)}kph`
      )
    } else {
      console.log(
        `STEP ${summary.stepNumber} COMPLETE: ERG | Duration: ${(summary.actualDuration / 60).toFixed(1)}min | Distance: ${(summary.distance / 1000).toFixed(2)}km | Avg Speed: ${summary.averageSpeed.toFixed(1)}kph`
      )
    }
  }

  async function endWorkout() {
    const W = H.state.workout

    // Record the final step if workout completed normally
    if (W.currentStepIndex < H.state.workoutPlan.length) {
      recordStepSummary()
    }

    W.isRunning = false
    window.dispatchEvent(new CustomEvent('workoutEnded'))

    if (H.timers.ergTimeout) clearTimeout(H.timers.ergTimeout)
    if (H.timers.simInterval) clearInterval(H.timers.simInterval)
    if (H.timers.totalWorkoutTimeInterval) clearInterval(H.timers.totalWorkoutTimeInterval)

    try {
      await H.erg.setErgModePower(0)
    } catch (_e) {
      /* noop */
    }

    // Hide position marker on graph (keep it at final position)
    // Position marker stays visible but stops updating

    // Generate workout summary
    generateWorkoutSummary()
  }

  function generateWorkoutSummary() {
    const W = H.state.workout
    const now = Date.now()
    const result = buildWorkoutSummary(W.stepSummary, W.workoutStartTime, now)

    console.log('')
    console.log('=== WORKOUT SUMMARY (Garmin Compatible) ===')
    console.log(`Total Time: ${(result.totalTime / 60).toFixed(1)} minutes`)
    console.log(`Total Distance: ${(result.totalDistance / 1000).toFixed(2)} km`)
    console.log(`Average Speed: ${result.averageSpeed.toFixed(1)} kph`)
    console.log(`Steps Completed: ${W.stepSummary.length}`)
    console.log('')
    console.log('Step-by-Step Breakdown:')
    W.stepSummary.forEach((step, index) => {
      const ergInfo = step.type === 'erg' ? ` @ ${step.target}` : ''
      const segInfo = step.segmentName ? ` (${step.segmentName})` : ''
      console.log(`${index + 1}. ${step.type.toUpperCase()}${ergInfo}${segInfo}`)
      if (step.type === 'sim' && step.routeDistance !== null) {
        const routeInfo = step.routeCompleted
          ? ` | Route: ${(step.routeDistance / 1000).toFixed(2)}km COMPLETE`
          : ` | Route: ${(step.routeDistance / 1000).toFixed(2)}km (incomplete)`
        console.log(
          `   Time: ${(step.actualDuration / 60).toFixed(1)}min | Total: ${(step.distance / 1000).toFixed(2)}km${routeInfo} | Avg Speed: ${step.averageSpeed.toFixed(1)}kph`
        )
      } else {
        console.log(
          `   Time: ${(step.actualDuration / 60).toFixed(1)}min | Distance: ${(step.distance / 1000).toFixed(2)}km | Avg Speed: ${step.averageSpeed.toFixed(1)}kph`
        )
      }
    })
    console.log('')
    console.log('=== END WORKOUT SUMMARY ===')

    W.summary = { ...result, timestamp: new Date().toISOString() }
    window.lastWorkoutSummary = W.summary
    console.log(
      'Workout summary saved to H.state.workout.summary (also available as window.lastWorkoutSummary)'
    )
  }

  // ===== VIRTUAL GEARING HANDLERS =====
  function shiftGearUp() {
    if (!window.ftms || !window.ftms.virtualGear) return

    const shifted = window.ftms.virtualGear.shiftUp()
    if (shifted) {
      H.state.workout.currentGear = window.ftms.virtualGear.currentGearIndex
      const gear = window.ftms.virtualGear.getCurrentGear()
      console.log(
        `⬆️  SHIFTED UP to gear ${gear.index + 1}/22 (${gear.display}, ratio ${gear.ratio.toFixed(2)})`
      )

      // Update UI
      updateGearDisplay()

      // Immediately apply new gradient with updated gear
      forceSimGradeUpdate()
    }
  }

  function shiftGearDown() {
    if (!window.ftms || !window.ftms.virtualGear) return

    const shifted = window.ftms.virtualGear.shiftDown()
    if (shifted) {
      H.state.workout.currentGear = window.ftms.virtualGear.currentGearIndex
      const gear = window.ftms.virtualGear.getCurrentGear()
      console.log(
        `⬇️  SHIFTED DOWN to gear ${gear.index + 1}/22 (${gear.display}, ratio ${gear.ratio.toFixed(2)})`
      )

      // Update UI
      updateGearDisplay()

      // Immediately apply new gradient with updated gear
      forceSimGradeUpdate()
    }
  }

  function updateGearDisplay() {
    if (!window.ftms || !window.ftms.virtualGear) return

    const gear = window.ftms.virtualGear.getCurrentGear()
    const multiplier = window.ftms.virtualGear.getMultiplier()

    // Update target display with gear info
    const D = H.dom
    const currentStep = H.state.workoutPlan[H.state.workout.currentStepIndex]
    if (currentStep && currentStep.type === 'sim') {
      const baseText = D.targetDisplay.textContent.split('Gear')[0].trim()
      D.targetDisplay.textContent = `${baseText} | Gear ${gear.index + 1}/22 (${gear.display}) ${multiplier.toFixed(2)}x`
    }
  }

  async function forceSimGradeUpdate() {
    // Force immediate gradient update with new gear multiplier
    const currentStep = H.state.workoutPlan[H.state.workout.currentStepIndex]
    if (!currentStep || currentStep.type !== 'sim') return

    const W = H.state.workout
    // Use the current grade that's already being applied
    const currentGrade = W.currentGrade || 0

    // Reapply with new gear multiplier
    await H.sim.setSimGrade(currentGrade, { forceUpdate: true })
  }

  H.handlers = {
    connectTrainer,
    handleFtmsData,
    startWorkout: H.workout.startWorkout,
    runWorkoutStep: H.workout.runWorkoutStep,
    skipStep: H.workout.skipStep,
    endWorkout: H.workout.endWorkout,
    shiftGearUp,
    shiftGearDown,
    openBluetoothDebug: () => {
      // Open the Bluetooth debug page in a new tab/window
      window.open('dev/bluetooth-test.html', '_blank', 'width=800,height=600')
    },
  }
})(window.Hybrid)

// All IIFEs have now run — safe to boot.
// Supports both normal page load and dynamic import after React renders.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => window.Hybrid.ui.boot())
} else {
  window.Hybrid.ui.boot()
}
