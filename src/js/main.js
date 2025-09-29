// FTMS Hybrid Workout App - Main JavaScript Module

// Import FTMS Bluetooth module
import { ftms } from './ftms.js';

// 1) GLOBAL VARS / STATE / UTILS
(function (H) {

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
        connectionStatus: document.getElementById('connection-status'),

        powerDisplay: document.getElementById('power-display'),
        speedDisplay: document.getElementById('speed-display'),
        cadenceDisplay: document.getElementById('cadence-display'),
        timeDisplay: document.getElementById('time-display'),
        gradientDisplay: document.getElementById('gradient-display'),
        stepDistanceDisplay: document.getElementById('step-distance-display'),

        workoutProgressText: document.getElementById('workout-progress-text'),
        progressBar: document.getElementById('progress-bar'),
        targetDisplay: document.getElementById('target-display'),
        simSegmentSelect: document.getElementById('sim-segment')
    };

    // ---- FTMS instance
    H.ftms = ftms;

    // ---- app state
    H.state = {
        garminRoute: null,
        preprocessedRoute: [],
        workoutPlan: JSON.parse(localStorage.getItem('workoutPlan') || '[]') || [],

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
            targetGrade: 0,  // Target grade from route
            lastGradeUpdate: 0,
            lastGradeDistance: 0, // Track distance for gradient ramping
            gradeHistory: [] // Track recent grades for smoothing
        }
    };

    // ---- timers
    H.timers = { ergTimeout: null, simInterval: null, totalWorkoutTimeInterval: null };

    // ---- utils
    H.utils = {
        // Math utilities
        clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)),
        
        // Earth radius for route calculations
        R: 6371e3,
        
        // Haversine distance calculation for route processing
        haversineDistance: (lat1, lon1, lat2, lon2) => {
            const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
            const Δφ = (lat2 - lat1) * Math.PI / 180;
            const Δλ = (lon2 - lon1) * Math.PI / 180;
            const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
            return H.utils.R * c;
        },
        
        // UI utilities
        showError: (m) => { H.dom.errorText.textContent = m; H.dom.errorDiv.classList.remove('hidden'); },
        hideError: () => H.dom.errorDiv.classList.add('hidden'),
        
        // Format time for display
        formatTime: (seconds) => {
            const minutes = Math.floor(seconds / 60);
            const secs = seconds % 60;
            return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
        }
    };
})(window.Hybrid = window.Hybrid || {});


// 2) ROUTE: ADD / STEP / EXTRACT
(function (H) {

    function preprocessRouteData(geoPoints) {
        const out = []; let total = 0;
        if (geoPoints.length) out.push({ distance: 0, elevation: geoPoints[0].elevation, grade: 0 });
        for (let i = 0; i < geoPoints.length - 1; i++) {
            const p1 = geoPoints[i], p2 = geoPoints[i + 1];
            const seg = H.utils.haversineDistance(p1.latitude, p1.longitude, p2.latitude, p2.longitude);
            total += seg;
            const elevΔ = p2.elevation - p1.elevation;
            const grade = seg > 0 ? (elevΔ / seg) * 100 : 0;
            out.push({ distance: total, elevation: p2.elevation, grade });
        }
        return out;
    }

    function getGradeForDistance(distance) {
        const arr = H.state.preprocessedRoute;
        if (!arr || !arr.length) return 0;
        if (distance <= 0) return arr[0].grade;
        if (distance >= arr[arr.length - 1].distance) return arr[arr.length - 1].grade;
        for (let i = 0; i < arr.length - 1; i++) {
            if (distance >= arr[i].distance && distance < arr[i + 1].distance) return arr[i + 1].grade;
        }
        return 0;
    }

    function updateRouteDisplay() {
        const { garminRoute } = H.state;
        const D = H.dom;
        if (garminRoute) {
            D.routeInputContainer.classList.add('hidden');
            D.routeInfoDiv.classList.remove('hidden');
            D.segmentNameSpan.textContent = garminRoute.name;
            D.totalDistanceSpan.textContent = `${(garminRoute.totalDistance / 1000).toFixed(2)} km (${garminRoute.totalDistance.toFixed(2)} meters)`;
            D.averageGradeSpan.textContent = `${garminRoute.averageGrade.toFixed(2)}%`;
        } else {
            D.routeInputContainer.classList.remove('hidden');
            D.routeInfoDiv.classList.add('hidden');
        }
    }

    function saveRoute() {
        const D = H.dom;
        try {
            const json = JSON.parse(D.garminDataTextarea.value.trim());
            if (!json.name || !Array.isArray(json.geoPoints)) throw new Error("Invalid Garmin JSON: need 'name' and 'geoPoints'.");

            H.state.preprocessedRoute = preprocessRouteData(json.geoPoints);
            const totalDistance = H.state.preprocessedRoute[H.state.preprocessedRoute.length - 1].distance;
            const totalElevationChange = json.geoPoints[json.geoPoints.length - 1].elevation - json.geoPoints[0].elevation;
            const averageGrade = (totalElevationChange / totalDistance) * 100;

            H.state.garminRoute = { name: json.name, geoPoints: json.geoPoints, totalDistance, averageGrade };
            localStorage.setItem('garminRoute', JSON.stringify(H.state.garminRoute));

            updateRouteDisplay(); H.utils.hideError();
            D.stepTypeSelect.querySelector('option[value="sim"]').disabled = false;
            D.simSegmentSelect.innerHTML = `<option value="${H.state.garminRoute.name}">${H.state.garminRoute.name}</option>`;
        } catch (e) {
            console.error(e);
            H.utils.showError(e.message);
            H.state.garminRoute = null;
            D.stepTypeSelect.querySelector('option[value="sim"]').disabled = true;
            D.routeInfoDiv.classList.add('hidden');
            D.routeInputContainer.classList.remove('hidden');
        }
    }

    function addStep() {
        const D = H.dom, S = H.state;
        const stepType = D.stepTypeSelect.value;
        let step = null;

        if (stepType === 'erg') {
            const duration = parseFloat(D.ergDurationInput.value);
            const power = parseFloat(D.ergPowerInput.value);
            if (isNaN(duration) || isNaN(power) || duration <= 0 || power <= 0) return H.utils.showError('Enter positive numbers for duration and power.');
            step = { type: 'erg', duration, power };
            D.ergDurationInput.value = ''; D.ergPowerInput.value = '';
        } else if (stepType === 'sim') {
            if (!S.garminRoute) return H.utils.showError('Import a Garmin route first to add a SIM step.');
            step = { type: 'sim', segmentName: S.garminRoute.name };
        }

        if (step) {
            S.workoutPlan.push(step);
            localStorage.setItem('workoutPlan', JSON.stringify(S.workoutPlan));
            renderWorkoutPlan(); H.utils.hideError();
        }
    }

    function renderWorkoutPlan() {
        const D = H.dom, S = H.state;
        D.workoutListDiv.innerHTML = '';
        S.workout.totalWorkoutDuration = 0;

        if (!S.workoutPlan.length) {
            D.noStepsMessage.classList.remove('hidden');
            D.clearWorkoutButton.classList.add('hidden');
            return;
        }
        D.noStepsMessage.classList.add('hidden');
        D.clearWorkoutButton.classList.remove('hidden');

        S.workoutPlan.forEach((step, index) => {
            const el = document.createElement('div');
            el.className = 'flex items-center justify-between p-4 bg-white rounded-lg border border-gray-200 shadow-sm';
            let content = '';
            if (step.type === 'erg') { content = `<span class="font-bold text-gray-800">ERG:</span> ${step.duration} min at ${step.power}W`; S.workout.totalWorkoutDuration += step.duration * 60; }
            else if (step.type === 'sim') { content = `<span class="font-bold text-gray-800">SIM:</span> ${step.segmentName}`; }
            el.innerHTML = `
        <div><span class="text-gray-500 font-medium">Step ${index + 1}:</span> ${content}</div>
        <button class="remove-step-button text-red-600 hover:text-red-800 transition-colors" data-index="${index}">&times;</button>`;
            D.workoutListDiv.appendChild(el);
        });

        D.workoutListDiv.querySelectorAll('.remove-step-button').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = parseInt(e.target.dataset.index, 10);
                H.state.workoutPlan.splice(idx, 1);
                localStorage.setItem('workoutPlan', JSON.stringify(H.state.workoutPlan));
                renderWorkoutPlan();
            });
        });
    }

    function clearWorkout() {
        H.state.workoutPlan = [];
        localStorage.removeItem('workoutPlan');
        renderWorkoutPlan();
    }

    H.route = { preprocessRouteData, getGradeForDistance, updateRouteDisplay, saveRoute, addStep, renderWorkoutPlan, clearWorkout };
})(window.Hybrid);


// 3) UI-SPECIFIC UPDATES
(function (H) {
    
    // Update workout-specific displays (gradient, step distance)
    function updateWorkoutDisplays() {
        const D = H.dom;
        const S = H.state.workout;
        const plan = H.state.workoutPlan;
        
        if (!S.isRunning || !plan.length) {
            D.gradientDisplay.textContent = '—';
            D.stepDistanceDisplay.textContent = '—';
            return;
        }
        
        const currentStep = plan[S.currentStepIndex];
        if (!currentStep) return;
        
        if (currentStep.type === 'sim') {
            // Show current gradient from route
            const routeGrade = H.route.getGradeForDistance(S.simDistanceTraveled || 0);
            const gradePct = Number.isFinite(routeGrade) ? routeGrade : 0;
            
            if (Math.abs(gradePct) >= 0.1) { // Only show if gradient is significant
                D.gradientDisplay.textContent = `${gradePct > 0 ? '+' : ''}${gradePct.toFixed(1)}`;
                D.gradientDisplay.className = gradePct > 0 ? 'text-3xl font-bold text-red-600' : 
                                              gradePct < 0 ? 'text-3xl font-bold text-blue-600' : 
                                              'text-3xl font-bold text-green-600';
            } else {
                D.gradientDisplay.textContent = '0.0';
                D.gradientDisplay.className = 'text-3xl font-bold text-green-600';
            }
            
            // Show distance progress: route distance vs total step distance
            const route = H.state.garminRoute;
            const routeDistance = Math.round(S.simDistanceTraveled || 0);
            const totalDistance = Math.round(S.stepSimDistance || 0);
            
            if (route && S.routeCompleted) {
                // Show route completed with extra distance
                const extraDistance = totalDistance - route.totalDistance;
                D.stepDistanceDisplay.textContent = `${route.totalDistance.toFixed(0)}+${extraDistance.toFixed(0)}`;
            } else if (route) {
                // Show route progress
                const progress = ((routeDistance / route.totalDistance) * 100).toFixed(0);
                D.stepDistanceDisplay.textContent = `${routeDistance}m (${progress}%)`;
            } else {
                // Fallback: just show total distance
                D.stepDistanceDisplay.textContent = Math.round(S.stepSimDistance || 0);
            }
        } else {
            // ERG mode - no gradient
            D.gradientDisplay.textContent = '—';
            
            // Show elapsed time converted to distance estimate (using current speed)
            const stepElapsedSec = (Date.now() - S.stepStartTime) / 1000;
            const currentSpeedKph = parseFloat(D.speedDisplay.textContent) || 0;
            const estimatedDistance = (currentSpeedKph / 3.6) * stepElapsedSec; // meters
            D.stepDistanceDisplay.textContent = Math.round(estimatedDistance);
        }
    }
    
    function updateWorkoutTime() {
        const D = H.dom, S = H.state.workout;
        if (!S.isRunning) return;
        const now = Date.now();
        const elapsedOverallSec = Math.floor((now - S.workoutStartTime) / 1000);
        D.timeDisplay.textContent = H.utils.formatTime(elapsedOverallSec);
        const totalDurationSec = H.state.workoutPlan.reduce((sum, step) => sum + (step.duration || 0), 0) * 60;
        D.progressBar.style.width = totalDurationSec > 0 ? `${Math.min(100, (elapsedOverallSec / totalDurationSec) * 100)}%` : '0%';
    }

    function boot() {
        const D = H.dom;
        const storedRoute = localStorage.getItem('garminRoute');
        if (storedRoute) {
            H.state.garminRoute = JSON.parse(storedRoute);
            H.state.preprocessedRoute = H.route.preprocessRouteData(H.state.garminRoute.geoPoints);
            H.route.updateRouteDisplay();
            D.stepTypeSelect.querySelector('option[value="sim"]').disabled = false;
            D.simSegmentSelect.innerHTML = `<option value="${H.state.garminRoute.name}">${H.state.garminRoute.name}</option>`;
        } else {
            H.route.updateRouteDisplay();
        }
        H.route.renderWorkoutPlan();

        // UI events
        D.saveRouteButton.addEventListener('click', H.route.saveRoute);
        D.addStepButton.addEventListener('click', H.route.addStep);
        D.clearWorkoutButton.addEventListener('click', H.route.clearWorkout);
        D.connectButton.addEventListener('click', H.handlers.connectTrainer);
        D.startWorkoutButton.addEventListener('click', H.handlers.startWorkout);
        D.skipStepButton.addEventListener('click', H.handlers.skipStep);
        D.debugBluetoothButton.addEventListener('click', H.handlers.openBluetoothDebug);

        D.stepTypeSelect.addEventListener('change', () => {
            if (D.stepTypeSelect.value === 'erg') { D.ergInputsDiv.classList.remove('hidden'); D.simInputsDiv.classList.add('hidden'); }
            else { D.ergInputsDiv.classList.add('hidden'); D.simInputsDiv.classList.remove('hidden'); }
        });

        // workout clock
        if (H.timers.totalWorkoutTimeInterval) clearInterval(H.timers.totalWorkoutTimeInterval);
        H.timers.totalWorkoutTimeInterval = setInterval(updateWorkoutTime, 1000);
    }

    document.addEventListener('DOMContentLoaded', boot);

    H.ui = { updateWorkoutTime, updateWorkoutDisplays, boot };
})(window.Hybrid);


// 4) ERG CONTROLS (using ftms module)
(function (H) {
    async function setErgModePower(power) {
        if (!H.state.ftmsConnected) { 
            console.error("FTMS not connected."); 
            return; 
        }
        try {
            const pwr = Math.max(0, Math.min(2000, Math.round(power)));
            await H.ftms.setErgWatts(pwr);
            console.log(`ERG power set to ${pwr}W`);
        } catch (e) {
            console.error('Failed to set ERG power:', e);
        }
    }

    H.erg = { setErgModePower };
})(window.Hybrid);


// 5) SIM CONTROLS (using ftms module)
(function (H) {
    // Distance-based gradient smoothing with momentum simulation
    function calculateRealisticGrade(rawGradePct, currentSpeedKph, currentDistance) {
        const W = H.state.workout;
        const now = Date.now();
        
        // Initialize if first call
        if (!W.lastGradeUpdate) {
            W.currentGrade = rawGradePct;
            W.targetGrade = rawGradePct;
            W.lastGradeUpdate = now;
            W.lastGradeDistance = currentDistance || 0;
            return rawGradePct;
        }
        
        // Calculate distance-based gradient smoothing
        const distanceTraveled = (currentDistance || 0) - (W.lastGradeDistance || 0);
        const GRADIENT_RAMP_DISTANCE = 10; // Change grade every 10 meters
        
        // Only update target grade if we've traveled enough distance
        if (distanceTraveled >= GRADIENT_RAMP_DISTANCE) {
            // Smooth the target grade to prevent GPS noise spikes
            const gradeDiff = rawGradePct - W.currentGrade;
            
            // Limit grade changes to realistic increments
            const MAX_GRADE_CHANGE_PER_RAMP = 1.5; // Max 1.5% change per 10m
            const smoothedGradeDiff = H.utils.clamp(gradeDiff, -MAX_GRADE_CHANGE_PER_RAMP, MAX_GRADE_CHANGE_PER_RAMP);
            
            W.targetGrade = W.currentGrade + smoothedGradeDiff;
            W.lastGradeDistance = currentDistance;
            
            console.log(`[GRADE RAMP] ${distanceTraveled.toFixed(0)}m: ${W.currentGrade.toFixed(1)}% -> ${W.targetGrade.toFixed(1)}% (raw: ${rawGradePct.toFixed(1)}%)`);
        } else {
            // If we haven't traveled enough distance, keep the target at current grade
            W.targetGrade = W.currentGrade;
        }
        
        // Apply time-based smoothing to the target grade
        const timeSinceUpdate = now - W.lastGradeUpdate;
        const MAX_CHANGE_PER_SECOND = 0.5; // Slower grade changes: 0.5% per second
        
        // If we just updated the target grade due to distance, apply the change more aggressively
        const justUpdatedTarget = distanceTraveled >= GRADIENT_RAMP_DISTANCE;
        const maxChange = justUpdatedTarget ? 
            Math.abs(W.targetGrade - W.currentGrade) : // Apply the full distance-based change
            Math.max(0.1, (timeSinceUpdate / 1000) * MAX_CHANGE_PER_SECOND); // Ensure minimum change for tests
        
        const gradeDiff = W.targetGrade - W.currentGrade;
        const actualChange = H.utils.clamp(gradeDiff, -maxChange, maxChange);
        
        // Calculate momentum factor (higher speed = more momentum assistance)
        const momentumFactor = Math.min(1.0, currentSpeedKph / 12); // Adjusted for more realistic speeds
        const momentumReduction = 0.25 * momentumFactor; // Up to 25% easier with momentum
        
        // Apply momentum-assisted grade
        const newGrade = W.currentGrade + actualChange;
        const momentumAssistedGrade = newGrade * (1 - momentumReduction);
        
        // Prevent negative grades from being too easy (keep some downhill resistance)
        const finalGrade = Math.max(-2, momentumAssistedGrade); // Allow slight negative grades
        
        W.currentGrade = newGrade; // Track actual grade
        W.lastGradeUpdate = now;
        
        return finalGrade;
    }

    async function setSimGrade(rawGradePct, opts = {}) {
        if (!H.state.ftmsConnected) { 
            console.warn("SIM: FTMS not connected."); 
            return; 
        }

        const { windMS = 0.0, crr = 0.003, cw = 0.45, currentSpeed = 0, currentDistance = 0 } = opts;

        // Calculate realistic grade with momentum simulation and distance-based ramping
        const realisticGrade = calculateRealisticGrade(rawGradePct, currentSpeed, currentDistance);

        // More conservative throttling for smoother experience
        const now = Date.now();
        if (!setSimGrade.__lastTs) setSimGrade.__lastTs = 0;
        if (now - setSimGrade.__lastTs < 3000) return; // 3 second throttle for smoother changes
        
        // Check if the grade change is significant enough to warrant an update
        if (setSimGrade.__lastGrade !== undefined) {
            const gradeDiff = Math.abs(realisticGrade - setSimGrade.__lastGrade);
            if (gradeDiff < 0.3) return; // Smaller threshold for smoother experience
        }
        
        setSimGrade.__lastTs = now;
        setSimGrade.__lastGrade = realisticGrade;

        try {
            await H.ftms.setSim({ 
                gradePct: realisticGrade, 
                crr, 
                cwa: cw, 
                windMps: windMS 
            });
            console.log(`[SIM] Raw: ${rawGradePct.toFixed(1)}% -> Applied: ${realisticGrade.toFixed(1)}% (momentum assist) | speed=${currentSpeed.toFixed(1)}kph`);
        } catch (err) { 
            console.warn('SIM: grade setting failed:', err); 
        }
    }

    // smooth step into first route grade using ftms rampSim
    async function startSimStep() {
        const S = H.state.workout;

        const dist0 = Math.max(0, S.simDistanceTraveled || 0);
        const routeGradeNow = H.route.getGradeForDistance(dist0) || 0;
        const targetPct = Number.isFinite(routeGradeNow) ? routeGradeNow : 0;

        console.log(`[SIM] Starting SIM step, ramping to grade: ${targetPct.toFixed(2)}%`);

        try {
            // Use ftms rampSim for smooth grade transition
            const fromPct = Math.sign(targetPct) * Math.max(0, Math.abs(targetPct) - 2);
            await window.ftms.rampSim({ 
                fromPct, 
                toPct: targetPct, 
                stepPct: 1, 
                dwellMs: 1800,
                crr: 0.003, 
                cwa: 0.45, 
                windMps: 0.0 
            });
        } catch (err) {
            console.warn('SIM: ramp failed, setting direct grade:', err);
            await setSimGrade(targetPct);
        }
    }

    function updateSimMode(currentSpeedKph) {
        const S = H.state.workout;
        const plan = H.state.workoutPlan;
        const step = plan[S.currentStepIndex];
        
        // Only run if we're actually in a SIM step
        if (!step || step.type !== 'sim') return;
        
        // Don't interfere if we're not running a workout
        if (!S.isRunning) return;

        const now = Date.now();
        if (!S.lastSimUpdateTs) S.lastSimUpdateTs = now;

        // Get route info for completion detection
        const route = H.state.garminRoute;
        const routeMaxDistance = route ? route.totalDistance : Infinity;
        
        if (Number.isFinite(currentSpeedKph)) {
            const dtSec = Math.max(0, (now - S.lastSimUpdateTs) / 1000);
            const mps = (currentSpeedKph * 1000) / 3600;
            const distanceIncrement = mps * dtSec;
            
            // Always update total step distance (for recording purposes)
            S.stepSimDistance = (S.stepSimDistance || 0) + distanceIncrement;
            
            // Only update route position if we haven't completed the route
            const currentRouteDistance = S.simDistanceTraveled || 0;
            if (currentRouteDistance < routeMaxDistance) {
                const newRouteDistance = currentRouteDistance + distanceIncrement;
                S.simDistanceTraveled = Math.min(newRouteDistance, routeMaxDistance);
                
                // Check if we just completed the route
                if (S.simDistanceTraveled >= routeMaxDistance && currentRouteDistance < routeMaxDistance) {
                    console.log(`🏁 [SIM ROUTE COMPLETE] Finished ${route.name} at ${routeMaxDistance.toFixed(0)}m! Continuing with final gradient...`);
                    S.routeCompleted = true;
                    
                    // TODO: Add auto-complete option here if desired
                    // For now, let the user manually skip when they want to end the step
                    // setTimeout(() => { H.handlers.skipStep(); }, 5000); // Auto-skip after 5 seconds
                }
            }
        }
        S.lastSimUpdateTs = now;

        // Get gradient based on route position (will freeze at end when route completed)
        const routeGrade = H.route.getGradeForDistance(S.simDistanceTraveled || 0);
        const gradePct = Number.isFinite(routeGrade) ? routeGrade : 0;

        // Enhanced logging with route completion status
        if (!updateSimMode.__lastLog || now - updateSimMode.__lastLog > 3000) {
            const routeStatus = S.routeCompleted ? ' [ROUTE COMPLETE]' : '';
            const routeProgress = routeMaxDistance < Infinity ? 
                ` (${((S.simDistanceTraveled / routeMaxDistance) * 100).toFixed(1)}%)` : '';
            console.log(`[SIM] route=${(S.simDistanceTraveled || 0).toFixed(0)}m${routeProgress} | total=${(S.stepSimDistance || 0).toFixed(0)}m | grade=${gradePct.toFixed(2)}%${routeStatus}`);
            updateSimMode.__lastLog = now;
        }

        // This will be throttled by setSimGrade to prevent conflicts
        setSimGrade(gradePct, { 
            windMS: 0.0, 
            crr: 0.003, 
            cw: 0.45, 
            currentSpeed: currentSpeedKph,
            currentDistance: S.simDistanceTraveled || 0
        });
    }

    H.sim = { setSimGrade, updateSimMode, startSimStep };
})(window.Hybrid);


// 6) UNIVERSAL HANDLERS (BLE, DATA PARSERS, WORKOUT FLOW)
(function (H) {
    const D = H.dom;

    // FTMS data handler - called by our correct parsing
    function handleFtmsData(data) {
        const D = H.dom;
        
        // Since we're using the correct parser from trainer_debug.html, 
        // the data should be reliable. Just basic sanity checks.
        const isValidPower = data.powerW !== null && data.powerW !== undefined && data.powerW >= -500 && data.powerW <= 2000;
        const isValidCadence = data.cadenceRpm !== null && data.cadenceRpm !== undefined && data.cadenceRpm >= 0 && data.cadenceRpm <= 250;
        const isValidSpeed = data.speedKph !== null && data.speedKph !== undefined && data.speedKph >= 0 && data.speedKph <= 80;
        
        // Update displays with data from our correct parser
        if (isValidPower) {
            D.powerDisplay.textContent = data.powerW;
        }
        if (isValidCadence) {
            D.cadenceDisplay.textContent = Math.round(data.cadenceRpm);
        }
        if (isValidSpeed) {
            D.speedDisplay.textContent = data.speedKph.toFixed(1);
            
            // Update SIM mode if active - but throttle to prevent conflicts
            const currentStep = H.state.workoutPlan[H.state.workout.currentStepIndex];
            if (H.state.workout.isRunning && currentStep?.type === 'sim') {
                // Only update SIM mode every 2 seconds to prevent command conflicts
                const now = Date.now();
                if (!handleFtmsData._lastSimUpdate || now - handleFtmsData._lastSimUpdate > 2000) {
                    handleFtmsData._lastSimUpdate = now;
                    H.sim.updateSimMode(data.speedKph);
                }
            }
        }
        
        // Display null values as dashes like trainer_debug.html
        if (data.powerW === null) D.powerDisplay.textContent = '—';
        if (data.cadenceRpm === null) D.cadenceDisplay.textContent = '—';
        if (data.speedKph === null) D.speedDisplay.textContent = '—';
        
        // Update gradient and step distance displays
        H.ui.updateWorkoutDisplays();
    }

    async function connectTrainer() {
        console.clear();
        console.info("--- Starting Bluetooth Trainer Connection ---");
        try {
            D.connectionStatus.textContent = 'Status: Connecting...';
            
            await H.ftms.connect({ 
                nameHint: 'KICKR',  // You can adjust this or make it configurable
                log: (msg) => console.log('[FTMS]', msg)
            });
            
            // Set up event listeners for FTMS data
            H.ftms.on('ibd', H.handlers.handleFtmsData);
            
            // No need for custom parsing - ftms.js is now fixed!
            
            H.state.ftmsConnected = true;
            D.connectionStatus.textContent = `Status: Connected! Please start pedaling to see your metrics.`;
            H.utils.hideError();
        } catch (e) {
            console.error('Bluetooth connection failed:', e);
            D.connectionStatus.textContent = 'Status: Disconnected';
            H.state.ftmsConnected = false;
            H.utils.showError('Failed to connect to trainer. Ensure Bluetooth is on and trainer is in pairing mode.');
        }
    }


    H.workout = {
        startWorkout,
        runWorkoutStep,
        skipStep,
        endWorkout,
        recordStepSummary,
        calculateErgStepDistance,
        generateWorkoutSummary
    };

    // ------- WORKOUT FLOW -------
    function startWorkout() {
        const S = H.state;
        const W = S.workout;

        if (!Array.isArray(S.workoutPlan) || S.workoutPlan.length === 0) {
            H.utils.showError('Please build a workout plan first.');
            return;
        }
        if (!S.ftmsConnected) {
            H.utils.showError('Please connect to a trainer first.');
            return;
        }
        if (W.isRunning) return;

        W.isRunning = true;
        W.currentStepIndex = 0;
        W.workoutStartTime = Date.now();
        W.lastSimUpdateTs = 0;
        W.simDistanceTraveled = 0;
        W.stepSimDistance = 0;
        W.stepSummary = []; // Reset workout summary
        W.routeCompleted = false; // Reset route completion status

        console.log('=== WORKOUT STARTED ===');
        console.log(`Total steps: ${S.workoutPlan.length}`);

        runWorkoutStep();

        if (H.timers.totalWorkoutTimeInterval) clearInterval(H.timers.totalWorkoutTimeInterval);
        H.timers.totalWorkoutTimeInterval = setInterval(H.ui.updateWorkoutTime, 1000);
    }

    function runWorkoutStep() {
        const S = H.state;
        const W = S.workout;
        const plan = S.workoutPlan;
        const Dom = H.dom;

        if (W.currentStepIndex >= plan.length) { endWorkout(); return; }

        if (H.timers.ergTimeout) clearTimeout(H.timers.ergTimeout);
        if (H.timers.simInterval) clearInterval(H.timers.simInterval);

        const currentStep = plan[W.currentStepIndex];
        Dom.workoutProgressText.textContent = `Step ${W.currentStepIndex + 1}: ${currentStep.type.toUpperCase()}`;
        W.stepStartTime = Date.now();

        console.log(`--- STEP ${W.currentStepIndex + 1}/${plan.length}: ${currentStep.type.toUpperCase()} ---`);

        if (currentStep.type === 'erg') {
            H.erg.setErgModePower(currentStep.power);
            Dom.targetDisplay.textContent = `Target: ${currentStep.power}W`;
            console.log(`ERG: ${currentStep.power}W for ${currentStep.duration} minutes`);
            H.timers.ergTimeout = setTimeout(() => { skipStep(); }, currentStep.duration * 60 * 1000);

        } else if (currentStep.type === 'sim') {
            // Reset SIM-specific distance tracking for this step
            W.stepSimDistance = 0;
            W.simDistanceTraveled = 0; // Reset route position
            W.lastSimUpdateTs = 0;
            W.routeCompleted = false; // Reset route completion for this step
            
            // Reset gradient state for smooth transitions
            W.currentGrade = 0;
            W.targetGrade = 0;
            W.lastGradeUpdate = Date.now();
            W.lastGradeDistance = 0;
            W.gradeHistory = [];
            
            // Display route info in target
            const route = H.state.garminRoute;
            if (route) {
                Dom.targetDisplay.textContent = `Route: ${(route.totalDistance/1000).toFixed(2)}km`;
                console.log(`SIM: Following route gradient "${currentStep.segmentName}" (${route.totalDistance.toFixed(0)}m total)`);
            } else {
                Dom.targetDisplay.textContent = `Grade: Route`;
                console.log(`SIM: Following route gradient (${currentStep.segmentName})`);
            }
            
            (async () => {
                try { await H.erg.setErgModePower(0); } catch { }
                await new Promise(r => setTimeout(r, 250));
                await H.sim.startSimStep(); // smooth ramp into first grade
            })();
        }
    }

    function skipStep() {
        const S = H.state;
        const W = S.workout;
        const plan = S.workoutPlan;

        if (!Array.isArray(plan) || plan.length === 0) { try { endWorkout(); } catch { } return; }

        // Record step summary before moving to next step
        recordStepSummary();

        W.currentStepIndex++;
        if (W.currentStepIndex >= plan.length) { try { endWorkout(); } catch { } }
        else { runWorkoutStep(); }
    }

    function recordStepSummary() {
        const S = H.state;
        const W = S.workout;
        const plan = S.workoutPlan;

        if (W.currentStepIndex >= plan.length) return;

        const currentStep = plan[W.currentStepIndex];
        const stepEndTime = Date.now();
        const stepDurationSec = (stepEndTime - W.stepStartTime) / 1000;
        const stepDistanceMeters = currentStep.type === 'sim' ? 
            (W.stepSimDistance || 0) : 
            calculateErgStepDistance();
        
        // Validate distance calculation - prevent negative distances
        const validatedDistance = Math.max(0, stepDistanceMeters);
        if (validatedDistance !== stepDistanceMeters) {
            console.warn(`⚠️  Negative distance detected for step ${W.currentStepIndex + 1}: ${stepDistanceMeters.toFixed(2)}m -> corrected to ${validatedDistance.toFixed(2)}m`);
            if (currentStep.type === 'sim') {
                console.warn(`SIM debug: stepSimDistance=${W.stepSimDistance}, simDistanceTraveled=${W.simDistanceTraveled}`);
            }
        }

        const summary = {
            stepNumber: W.currentStepIndex + 1,
            type: currentStep.type,
            plannedDuration: currentStep.duration ? currentStep.duration * 60 : null, // seconds
            actualDuration: stepDurationSec,
            distance: validatedDistance,
            averageSpeed: validatedDistance > 0 ? (validatedDistance / stepDurationSec) * 3.6 : 0, // kph
            target: currentStep.type === 'erg' ? `${currentStep.power}W` : 'Route Grade',
            segmentName: currentStep.segmentName || null,
            // For SIM steps, add route-specific info
            routeDistance: currentStep.type === 'sim' ? (W.simDistanceTraveled || 0) : null,
            routeCompleted: currentStep.type === 'sim' ? (W.routeCompleted || false) : null
        };

        W.stepSummary.push(summary);
        
        // Enhanced logging for SIM vs ERG steps
        if (summary.type === 'sim' && summary.routeDistance !== null) {
            const routeInfo = summary.routeCompleted ? 
                `${(summary.routeDistance/1000).toFixed(2)}km COMPLETE` : 
                `${(summary.routeDistance/1000).toFixed(2)}km route`;
            console.log(`STEP ${summary.stepNumber} COMPLETE: ${summary.type.toUpperCase()} | Duration: ${(summary.actualDuration/60).toFixed(1)}min | Total: ${(summary.distance/1000).toFixed(2)}km | Route: ${routeInfo} | Avg Speed: ${summary.averageSpeed.toFixed(1)}kph`);
        } else {
            console.log(`STEP ${summary.stepNumber} COMPLETE: ${summary.type.toUpperCase()} | Duration: ${(summary.actualDuration/60).toFixed(1)}min | Distance: ${(summary.distance/1000).toFixed(2)}km | Avg Speed: ${summary.averageSpeed.toFixed(1)}kph`);
        }
    }

    function calculateErgStepDistance() {
        // For ERG steps, estimate distance based on average speed during the step
        const stepDurationSec = (Date.now() - H.state.workout.stepStartTime) / 1000;
        const currentSpeedKph = parseFloat(H.dom.speedDisplay.textContent) || 0;
        return (currentSpeedKph / 3.6) * stepDurationSec; // rough estimate in meters
    }

    async function endWorkout() {
        const W = H.state.workout;
        const Dom = H.dom;

        // Record the final step if workout completed normally
        if (W.currentStepIndex < H.state.workoutPlan.length) {
            recordStepSummary();
        }

        W.isRunning = false;
        Dom.workoutProgressText.textContent = "Workout complete!";
        Dom.targetDisplay.textContent = '';
        Dom.progressBar.style.width = '100%';
        
        // Reset displays
        Dom.gradientDisplay.textContent = '—';
        Dom.stepDistanceDisplay.textContent = '—';

        if (H.timers.ergTimeout) clearTimeout(H.timers.ergTimeout);
        if (H.timers.simInterval) clearInterval(H.timers.simInterval);
        if (H.timers.totalWorkoutTimeInterval) clearInterval(H.timers.totalWorkoutTimeInterval);

        try { await H.erg.setErgModePower(0); } catch { }

        // Generate workout summary
        generateWorkoutSummary();
    }

    function generateWorkoutSummary() {
        const W = H.state.workout;
        const totalWorkoutTime = (Date.now() - W.workoutStartTime) / 1000; // seconds
        const totalDistance = W.stepSummary.reduce((sum, step) => sum + step.distance, 0);
        const avgSpeed = totalDistance > 0 ? (totalDistance / totalWorkoutTime) * 3.6 : 0;

        console.log('');
        console.log('=== WORKOUT SUMMARY (Garmin Compatible) ===');
        console.log(`Total Time: ${(totalWorkoutTime/60).toFixed(1)} minutes`);
        console.log(`Total Distance: ${(totalDistance/1000).toFixed(2)} km`);
        console.log(`Average Speed: ${avgSpeed.toFixed(1)} kph`);
        console.log(`Steps Completed: ${W.stepSummary.length}`);
        console.log('');
        
        console.log('Step-by-Step Breakdown:');
        W.stepSummary.forEach((step, index) => {
            const ergInfo = step.type === 'erg' ? ` @ ${step.target}` : '';
            const segInfo = step.segmentName ? ` (${step.segmentName})` : '';
            console.log(`${index + 1}. ${step.type.toUpperCase()}${ergInfo}${segInfo}`);
            
            if (step.type === 'sim' && step.routeDistance !== null) {
                const routeInfo = step.routeCompleted ? 
                    ` | Route: ${(step.routeDistance/1000).toFixed(2)}km COMPLETE` : 
                    ` | Route: ${(step.routeDistance/1000).toFixed(2)}km (incomplete)`;
                console.log(`   Time: ${(step.actualDuration/60).toFixed(1)}min | Total: ${(step.distance/1000).toFixed(2)}km${routeInfo} | Avg Speed: ${step.averageSpeed.toFixed(1)}kph`);
            } else {
                console.log(`   Time: ${(step.actualDuration/60).toFixed(1)}min | Distance: ${(step.distance/1000).toFixed(2)}km | Avg Speed: ${step.averageSpeed.toFixed(1)}kph`);
            }
        });
        
        console.log('');
        console.log('=== END WORKOUT SUMMARY ===');
        
        // Store Garmin-like summary object in our state for potential export
        W.summary = {
            totalTime: totalWorkoutTime,
            totalDistance: totalDistance,
            averageSpeed: avgSpeed,
            steps: W.stepSummary,
            timestamp: new Date().toISOString()
        };
        
        // Also expose on window for easy console access
        window.lastWorkoutSummary = W.summary;
        console.log('Workout summary saved to H.state.workout.summary (also available as window.lastWorkoutSummary)');
    }

    H.handlers = {
        connectTrainer,
        handleFtmsData,
        startWorkout: H.workout.startWorkout,
        runWorkoutStep: H.workout.runWorkoutStep,
        skipStep: H.workout.skipStep,
        endWorkout: H.workout.endWorkout,
        openBluetoothDebug: () => {
            // Open the Bluetooth debug page in a new tab/window
            window.open('dev/bluetooth-test.html', '_blank', 'width=800,height=600');
        }
    };
})(window.Hybrid);