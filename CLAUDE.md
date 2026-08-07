# FTMS Hybrid Workout App — Claude Context

Browser-only Web Bluetooth app for controlling FTMS smart trainers (ERG + SIM modes),
tested against a Wahoo KICKR Core V2. Deployed to GitHub Pages.

## Commands

```bash
npm run dev          # Vite dev server (localhost:3000)
npm test             # Vitest unit + integration
npm run test:e2e     # Playwright
npm run lint         # ESLint
npm run typecheck    # tsc --noEmit
npm run format       # Prettier
npm run build        # production build to dist/
```

Run `npm test`, `npm run lint`, and `npm run typecheck` before considering a change done.

A dev server is normally **already running on :3000** — check before starting one
(`curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/`). Open
`http://localhost:3000/dev/ble-lab.html` rather than spawning a second server on another port:
Web Bluetooth device permissions and `device.id` are **origin-scoped**, so a device permitted on
:3000 is not permitted on another port, and you would be testing a different origin from the one
in front of you.

## Architecture (important — README.md is stale on this)

React 19 + TypeScript shell over a legacy vanilla-JS core, bridged by `window` globals
and CustomEvents:

- `src/main.tsx` → contexts (`src/context/`) → `AppShell`, which dynamically imports
  `src/js/main.js` **after** mount (legacy code binds to DOM IDs React renders).
- `src/js/ftms.js` — FTMS BLE client (`window.ftms`) + legacy `VirtualGear` class.
- `src/js/main.js` — IIFE modules on `window.Hybrid` (workout flow, SIM pipeline, handlers).
- `src/services/*.ts` — pure, unit-tested logic (simPhysics, routeService, storage,
  graphService, workoutService). New logic goes here, typed — do not grow `window.Hybrid`.
- `src/dev/*.html` — standalone BLE prototype/debug pages; they contain recorded
  hardware experiment logs — treat as evidence, don't delete casually.
- Full current-state map with `file:line` citations:
  [docs/virtual-shifting/ARCHITECTURE-CURRENT-STATE.md](docs/virtual-shifting/ARCHITECTURE-CURRENT-STATE.md)

## Virtual shifting effort (active project)

Design is complete; implementation has NOT started. Before touching anything
gear/shift/BLE related, read:

- [docs/VIRTUAL_SHIFTING_DESIGN.md](docs/VIRTUAL_SHIFTING_DESIGN.md) — master design
- [docs/virtual-shifting/README.md](docs/virtual-shifting/README.md) — knowledge base
  index (goals, protocols, research, hypotheses, validation plan, roadmap)

Rules for that effort:
- The legacy gradient-multiplier model (`VirtualGear.applyToGradient`) is **superseded**
  — do not extend it; the replacement is the virtual-speed model (design §4.3).
- Claims are labeled CONFIRMED / INFERRED / UNKNOWN. Hardware experiment results go in
  [docs/virtual-shifting/HYPOTHESES.md](docs/virtual-shifting/HYPOTHESES.md) §E **and**
  the ledger in the design doc §2.6.
- Known latent bugs to fix when touching `ftms.js` `setSim`: wind-speed unit (0.001 m/s,
  not 0.01) and `setFTP()` overwriting calibration on boot (main.js:521-529).

## Constraints & gotchas

- Web Bluetooth: Chrome/Edge only (no Firefox/Safari); `requestDevice` needs a user
  gesture per device; custom service UUIDs must be listed in `optionalServices`.
- BLE code can't be exercised in CI — keep protocol parsers/math as pure functions with
  byte-fixture unit tests; hardware verification follows
  [docs/virtual-shifting/VALIDATION-PLAN.md](docs/virtual-shifting/VALIDATION-PLAN.md).
- React StrictMode double-mounts: guard subscriptions (see TrainerContext.tsx:34-47).
- `ble_env/` is an abandoned Python venv — ignore it.
- Docs live under `docs/` (knowledge base in `docs/virtual-shifting/`); don't create
  loose markdown at repo root.
