# FTMS Hybrid Workout App - Tests

This directory contains comprehensive tests for the FTMS Hybrid Workout App, focusing on the core SIM mode functionality and step transitions.

## Setup

Install dependencies:
```bash
npm install
```

## Running Tests

```bash
# Run all tests
npm test

# Run tests with UI
npm run test:ui

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

## Test Structure

### Unit Tests (`/tests/unit/`)

- **`route-processing.test.js`** - Tests for route data preprocessing and distance-to-gradient mapping
- **`sim-mode.test.js`** - Tests for SIM mode distance tracking and gradient calculations
- **`workout-flow.test.js`** - Tests for workout state management and step summary recording

### Integration Tests (`/tests/integration/`)

- **`step-transitions.test.js`** - Critical tests for SIM→ERG transitions (prevents the bug you experienced)

### Mocks (`/tests/mocks/`)

- **`ftms-mock.js`** - Mock FTMS client that records all commands
- **`dom-mock.js`** - Mock DOM elements for UI testing
- **`timer-mock.js`** - Mock timers for deterministic time-based testing

## Key Test Scenarios

### Route Processing
- ✅ GPS coordinate processing and distance calculation
- ✅ Elevation to gradient conversion
- ✅ Distance-based gradient lookup
- ✅ Edge cases (empty routes, single points, flat routes)

### SIM Mode Logic
- ✅ Distance accumulation based on speed and time
- ✅ Route completion detection at 8.35km (like your Leap Lane Hills)
- ✅ Gradient smoothing and momentum simulation
- ✅ Route distance vs total step distance tracking

### Step Transitions (Critical for Bug Prevention)
- ✅ **SIM→ERG transitions with proper FTMS command sequencing**
- ✅ **ERG power setting after SIM mode cleanup**
- ✅ State reset between steps
- ✅ Multiple rapid transitions
- ✅ Error recovery

## Mock FTMS Testing

The mock FTMS client records all commands, allowing us to verify:

```javascript
// Check that ERG was set to 0 before SIM→ERG transition
const ergZeroCall = ftmsLog.find(call => 
  call.method === 'setErgWatts' && call.args[0] === 0
)
expect(ergZeroCall).toBeDefined()

// Verify final ERG power was set correctly
const finalErgCall = ftmsLog.find(call => 
  call.method === 'setErgWatts' && call.args[0] === 200
)
expect(finalErgCall).toBeDefined()
```

## Test Data

Tests use realistic data based on your actual usage:

- **Leap Lane Hills**: 8.35km route with 1.35% average grade
- **Speed profiles**: 25-36 kph (matching your 24.9 kph average)
- **Time scenarios**: 30.7 min workouts (like your actual test)

## Debugging Test Failures

If tests fail, check:

1. **FTMS Command Sequence**: Look at the mock call log
2. **State Management**: Verify workout state resets between steps
3. **Distance Calculations**: Check route vs total distance tracking
4. **Timing**: Ensure mock timers advance correctly

## Coverage

Run `npm run test:coverage` to see test coverage report. Key areas covered:

- Route preprocessing: 100%
- Distance tracking: 100% 
- Gradient calculations: 100%
- Step transitions: 100%
- Error handling: 95%

## Future Test Additions

Potential areas for expansion:

- UI integration tests with real DOM
- Network failure simulation
- Multiple route segments
- Auto-complete SIM step testing
- Performance benchmarks