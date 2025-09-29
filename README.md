# FTMS Hybrid Workout App

A modern web application for controlling FTMS-compatible smart trainers, featuring both ERG (fixed power) and SIM (Garmin Segment route gradient simulation) modes with comprehensive workout tracking.

**🌐 Live App**: https://nford88.github.io/hybrid-workout-ftms/

## Why?
I wanted to do specific segments as part of my training alongside fixed periods of ERG mode for base training. To do this a Garmin head unit as part of a Garmin workout is a bit messy and you cannot load specific segments, you have load the whole course (or create a course from the specific segment) and you have to manually change the course mid workout. 

This small web app allows you to build a specific hyrbid workout by create a "SIM Sandwich" (SIM steps surrounded by ERG steps) in one place, allowing a simpler and much granular control of the workout without having to pay for applications such as Zwift. 

You can use any Garmin segment available (public or private), you can run this from the browser on the live link or serve locally. It uses the FTMS protocol and operate over BLE. It can also work from Chrome on Android, albeit the screen will have to be unlocked at all times to keep the BLE connected.


## 🚴‍♂️ Features

### Core Functionality
- **FTMS Bluetooth Integration**: Connect to compatible smart trainers using Web Bluetooth API
- **Dual Training Modes**:
  - **ERG Mode**: Fixed power target training
  - **SIM Mode**: Route-based gradient simulation with realistic physics
- **Garmin Route Import**: Load GPX route data from Garmin devices
- **Real-time Metrics**: Power, speed, cadence, time, and gradient display
- **Workout Builder**: Create custom multi-step training sessions
- **Progress Tracking**: Comprehensive workout summaries and performance metrics

### Advanced SIM Mode Features
- **Distance-driven gradient changes**: Realistic route progression
- **Momentum simulation**: Speed-based difficulty adjustment
- **Route completion detection**: Automatic tracking when route segments finish
- **Gradient smoothing**: Prevents jarring transitions, limits changes to 1.5% per 10m
- **Physics-based resistance**: Accounts for rolling resistance and aerodynamics

## 🛠️ Technical Stack

- **Frontend**: Vanilla JavaScript (ES6+), HTML5, Tailwind CSS
- **Bluetooth**: Web Bluetooth API with FTMS protocol implementation
- **Testing**: Vitest with comprehensive unit and integration tests (45 tests)
- **Architecture**: Modular design with clean separation of concerns

## 📁 Project Structure

```
ftms-hybrid-workout/
├── .github/
│   └── workflows/
│       └── deploy.yml         # GitHub Pages deployment
├── src/                       # Source files
│   ├── index.html            # Main application interface
│   ├── js/                   # JavaScript modules
│   │   ├── main.js          # Core application logic
│   │   └── ftms.js          # FTMS Bluetooth implementation
│   └── dev/                 # Development tools
│       └── bluetooth-test.html
├── tests/                    # Test suite
│   ├── unit/                # Unit tests
│   ├── integration/         # Integration tests
│   └── mocks/               # Test mocks
├── public/                   # Static assets
├── dist/                     # Built files (generated)
├── package.json             # Dependencies and scripts
├── vite.config.js           # Build configuration
├── vitest.config.js         # Test configuration
├── index.html               # Redirect to src/ (development)
└── README.md               # This file
```

## 🚀 Getting Started

### Prerequisites
- Modern web browser with Web Bluetooth support (Chrome, Edge, Opera)
- FTMS-compatible smart trainer (tested with Wahoo KICKR)
- Node.js 18+ (for running tests)

### Installation & Development

1. **Clone the repository**:
   ```bash

   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start development server**:
   ```bash
   npm run dev
   ```
   This opens `http://localhost:3000` with hot reload

4. **Run tests**:
   ```bash
   npm test
   ```


## Running the Application

**Live URL:**
https://nford88.github.io/hybrid-workout-ftms/

**Development Mode:**
- Clone and run the project:
  ```bash
  git clone https://github.com/nford88/hybrid-workout-ftms
  cd hybrid-workout-ftms
  npm run dev
  ```
- Hot reload, source maps, and development tools

**Production Mode:**
- Run `npm run build` and then `npm run preview`
- Or serve the `dist/` folder with any static file server

## How to Use

1. **Connect your trainer**:
   - Put your FTMS-compatible trainer in pairing mode
   - Ensure trainer isn't connected to other devices
   - Click "Connect Trainer" in the app
   - Grant Bluetooth permissions when prompted

2. **Import a Garmin route** (optional):
   - Export route data from Garmin Connect as JSON
   - Paste the JSON data into the route import field
   - Click "Import Route"

3. **Build your workout**:
   - Add ERG steps for fixed power intervals
   - Add SIM steps to follow imported route gradients
   - Mix and match as needed

4. **Start your workout**:
   - Click "Start Workout" 
   - Begin pedaling to see live metrics and start your training session

5. **Enjoy your training!**

## 🔧 Configuration

Defaults below should be a good starting point, feel free to tweak if needed
These were mainly to smooth the the changes in SIM commands as to not "jolt" too dramatically between distance/gradient/trainer response. 

### SIM Mode Physics Constants
```javascript
// In main.js - sim module
const GRADIENT_RAMP_DISTANCE = 10;        // Change grade every 10m
const MAX_GRADE_CHANGE_PER_RAMP = 1.5;    // Max 1.5% change per ramp
const MAX_CHANGE_PER_SECOND = 0.5;        // Time-based smoothing
const MOMENTUM_FACTOR_DIVISOR = 12;       // Speed-based momentum calc
const MOMENTUM_REDUCTION = 0.25;          // Up to 25% easier with speed
```

### FTMS Parameters
```javascript
// Default simulation parameters
{
  gradePct: calculatedGrade,
  crr: 0.003,                // Rolling resistance
  cwa: 0.45,                 // Aerodynamic drag
  windMps: 0.0               // Wind speed
}
```

#### Deployment Process:
- ✅ Installs dependencies with `npm ci`
- ✅ Runs all 45 tests with `npm test`
- ✅ Builds optimized files with `npm run build`
- ✅ Deploys `/dist` folder to GitHub Pages
- ✅ Available at: `https://nford88.github.io/hybrid-workout-ftms/`

### Building for Production

```bash
# Build optimized files to dist/
npm run build

# Preview the build locally
npm run preview
```

### GitHub Actions Workflow for GitHub Pages

This project is configured for automatic deployment to GitHub Pages using GitHub Actions.

**Enable GitHub Pages**:
   - Go to your repository → Settings → Pages
   - Source: "GitHub Actions"
   - The workflow will automatically build and deploy

## 🧪 Testing

The project includes a comprehensive test suite with 45 tests covering:

### Run Tests
```bash
# Run all tests
npm test

# Run with UI
npm run test:ui

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch

# Use the convenience script
./run-tests.js [test|ui|coverage|watch]
```

### Test Coverage
- **Route Processing**: GPX parsing, distance calculations, gradient extraction
- **SIM Mode Logic**: Distance-driven progression, gradient smoothing, route completion
- **Workout Flow**: Step transitions, timing, state management
- **Integration**: End-to-end workout scenarios

## 📊 Workout Data

The app tracks comprehensive workout metrics:

- **Per-step data**: Duration, distance, average speed, power targets
- **Route progress**: For SIM steps, tracks route completion percentage
- **Overall summary**: Total time, distance, average speed
- **Garmin-compatible**: Data structure designed for easy export

Example workout summary:
```javascript
{
  totalTime: 1847,           // seconds
  totalDistance: 8350,       // meters  
  averageSpeed: 16.3,        // kph
  steps: [/* detailed step data */],
  timestamp: "2025-09-29T14:30:00.000Z"
}
```



## 🤝 Contributing

1. **Fork** the repository
2. **Create** a feature branch
3. **Add tests** for new functionality
4. **Ensure** all tests pass: `npm test`
5. **Submit** a pull request

## 📱 Browser Compatibility

- ✅ Chrome 56+
- ✅ Edge 79+
- ✅ Opera 43+
- ❌ Firefox (Web Bluetooth not supported)
- ❌ Safari (Web Bluetooth not supported)

## 🐛 Troubleshooting

### Common Issues

**"Bluetooth not available"**
- Ensure you're using a supported browser
- Check that Bluetooth is enabled on your device
- Try refreshing the page

**"Failed to connect to trainer"**
- Put trainer in pairing mode
- Ensure trainer isn't connected to other devices
- Try power cycling the trainer

**"Route import failed"**
- Verify JSON format from Garmin Connect export
- Check that the JSON contains `name` and `geoPoints` fields

## 📄 License

This project is open source. Feel free to use, modify, and distribute.

## 🏆 Acknowledgments

- **[FTMS Protocol](https://www.bluetooth.com/specifications/specs/fitness-machine-service-1-0/)**: Fitness Machine Service Bluetooth specification
- **[Web Bluetooth](https://webbluetoothcg.github.io/web-bluetooth/)**: W3C Web Bluetooth Community Group
- **[Vitest](https://vitest.dev/)**: Fast and lightweight testing framework
- **[Tailwind CSS](https://tailwindcss.com/)**: Utility-first CSS framework

---

**Happy Training! 🚴‍♂️💪**