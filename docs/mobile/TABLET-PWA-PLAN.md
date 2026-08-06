# Mobile / Tablet / PWA Plan

Status: **§2 (the laptop HUD) is BUILT — see the work-items table in §2.7. Everything else is still plan.** Claims are labelled CONFIRMED / INFERRED / UNKNOWN
per the repo convention (see `docs/virtual-shifting/HYPOTHESES.md`).

**Revision 2** — rewritten after clarifications: a Garmin Edge already covers live vital
signs; the HUD's job is workout/gear/graph; curated non-commercial video; our own
"mock fullscreen" rather than YouTube's; two layout modes; and **in-ride interaction should be
Zwift Click, not touch**.

Goal: a bar-mounted tablet running the app in a browser with Web Bluetooth, showing what the
Garmin can't, with an embedded curated video playlist, and driven almost entirely from the Click.

---

## 0. Platform: the iPad problem — READ FIRST

**CONFIRMED by platform policy, not something we need to test: Chrome on iPad cannot do Web
Bluetooth.** Every browser on iOS/iPadOS is required to use WebKit, and WebKit has never
implemented Web Bluetooth — Apple declined it on fingerprinting/privacy grounds. Chrome for iOS
is a WebKit shell. So on an iPad, `navigator.bluetooth` is simply `undefined`: **no trainer, no
Click, nothing.** The EU's DMA (2024) permits alternative engines on iOS, but Chrome has not
shipped a non-WebKit iOS build, so it doesn't rescue this.

`CLAUDE.md` and `GOALS.md` already scope to "Chrome desktop, then Android". The iPad is outside
that scope, and this plan cannot be built for it as written.

**Decided 2026-08-06:** the target device is an **iPad 6th generation (2018)**, and this was not
known when the plan was written. So the platform needs choosing before any tablet work starts.

### 0.0 What the iPad 6 specifically means

| Property | Value | Consequence |
|---|---|---|
| Logical resolution | **1024 × 768** | Not much more usable width than a laptop screen. Every canvas size in `STITCH-PROMPTS.md` was specced at 1280×800 and needs redoing. |
| SoC | A10 Fusion (2018) | Video decode is fine. Our JS app *plus* a BLE bridge *plus* a YouTube iframe on an 8-year-old tablet is genuinely marginal. |
| Max OS | **iPadOS 17** — iPadOS 18 requires A12 | **Permanent ceiling.** Whatever WebKit ships in 17 is the last WebKit this device will ever have. No future browser API arrives, ever. |
| Tailwind v4 floor | Safari 16.4+ | iPadOS 17 ≈ Safari 17, so it **clears it — but only just.** Had this been an iPadOS 16 device, Tailwind v4 output wouldn't render at all. |
| Screen Wake Lock | Safari 16.4+, so present in Safari on iPadOS 17 | Whether a third-party WKWebView browser (Bluefy) exposes it is **UNKNOWN**. |
| Web Bluetooth | Absent from WebKit, permanently | The blocker. Unchanged by OS version. |

**The 1024×768 aspect ratio is genuinely helpful for cinema mode:** a 16:9 video at full width is
1024×576, leaving **192px of letterbox** in a 768px-tall screen. The HUD band fits in space that
would otherwise be black bars — it costs *nothing* in video size. Better than the ~156px a newer
iPad would give.

The "permanent ceiling" row is the one that should drive the decision. Building the primary ride
interface on a device that can never receive another browser API is a bet against your own future
requirements.

### Options

| Option | What it costs | Verdict |
|---|---|---|
| **a) Bluefy (or WebBLE) on the iPad** | A third-party WebKit browser that implements Web Bluetooth over a native BLE bridge. Paid app. Not Chrome, so PWA install/manifest behaviour differs and remote debugging changes. **Two concurrent BLE devices: UNKNOWN** (that's `GOALS.md` req. 4 — trainer *and* Click at once). **Screen Wake Lock: UNKNOWN. YouTube iframe performance and autoplay policy: UNKNOWN.** | **Try first — it's nearly free and decisive.** |
| **b) Android tablet** | New hardware | **Everything in this plan works as written**, and it's the platform `VALIDATION-PLAN.md` HW-V11 already targets. Lowest risk. |
| **c) Split the devices** — iPad plays video in the *native* YouTube app; HUD runs on the laptop or an Android tablet | Loses the integrated HUD-over-video look | **Genuinely worth considering — see §0.1.** |
| d) iPad as a display for our app, BLE host elsewhere | Cross-device state sync: a new subsystem and a second mid-ride failure domain | Not recommended |

### Recommended order — REVISED for the iPad 6, and it costs £0

**The zero-spend answer is (c), and on this hardware it stops being a compromise and becomes the
right call.** Split the two jobs across devices you already own:

- **iPad 6 = video.** Native YouTube app, mounted near the bars. No Bluefy, no embed, no autoplay
  policy, no A10 running our JS, no battery contention with BLE. The native app is strictly
  *better* at video than any iframe we could build.
- **Laptop = HUD + BLE.** It already runs the app perfectly in Chrome, with full Web Bluetooth,
  wake lock, and a browser that gets updates.
- **Click = the only control surface**, which is the stated goal anyway.

**The insight that makes this work:** the handoff's constraint was "the rider cannot reach the
laptop mid-effort" — but under Click-first control **you never need to reach it.** The laptop only
needs to be *visible*. That was the entire reason for wanting a tablet, and it dissolves.

So the tablet-view design work keeps its value — it becomes a **laptop-screen glanceable HUD**
(§2.4, HUD mode). Cinema mode, the whole of §3, and C2/C3 in §4 drop off the plan.

### If you do want the integrated look later

1. **Try Bluefy anyway** — it's one cheap app against a 20-minute spike, which is noise next to
   buying hardware. Even a partial result is informative. Check first that it still supports
   iPadOS 17; that isn't guaranteed. Then: trainer + Click concurrently for five minutes, and does
   the screen stay awake. **Set expectations low** — A10 + a permanently-frozen WebKit + a BLE
   bridge + iframe video is a lot to ask of a 2018 tablet.
2. **A budget Android tablet is the only clean path** to the fully integrated vision. Worth it
   only if the split-device setup actually annoys you in practice — try the free thing first, for
   a few rides, and let real use decide.

Everything in §2 (HUD), §4 (Click) and §5 (settings) is platform-agnostic and proceeds either way.
§1 (lifecycle) and §6 (PWA) depend on this choice — and under the split-device setup **both get
much simpler**, because the laptop doesn't lock, doesn't app-switch, and doesn't need a PWA at all.

### 0.1 The option that deletes most of §3

Worth naming plainly, because it may be what you actually want: **the video and the HUD don't have
to be on the same screen.**

The reference HUD integrates them because Zwift *renders the game* — the HUD has to overlay it.
But slow TV and cycling footage is **ambient**. Nothing about it needs to be spatially unified
with the gear number.

Playing the playlist in the iPad's native YouTube app, with the HUD on a separate screen, deletes:

- the IFrame Player API and its StrictMode singleton problem
- embed-disabled videos as a concern (native app, no embedding at all)
- the autoplay/user-gesture constraint (§4.3) entirely
- cinema mode, the mock-fullscreen resize, and the never-remount-the-iframe discipline
- the Click media bindings (`toggleCinema`, `mediaNext`, `mediaMute`)
- video/BLE battery contention on one device

That's most of §3 and a meaningful slice of §4, in exchange for the integrated look. It also
sidesteps the iPad Web Bluetooth problem for the *video* half, leaving only the HUD to place.

**Revised after learning the device is an iPad 6:** this is now the *recommended* path, not merely
an option. On a 2018 tablet with a permanently frozen WebKit and no Web Bluetooth, the integrated
embed buys a look and costs a platform. Splitting the devices costs nothing, uses hardware you
already own, and hands the video job to an app that does it better than we could.

The integrated Zwift-style HUD stays the aspirational target — it just needs an Android tablet to
be worth building, and that decision can wait until the free version has annoyed you in practice.

---

## 1. Does the connection survive lock / app switch?

### 1.1 What the code does today — CONFIRMED

**A mid-ride disconnect is invisible to the entire app.**

- [ftms.js:115-117](../../src/js/ftms.js#L115-L117) registers `gattserverdisconnected` and emits
  `'disconnected'` on the internal emitter. **Nothing subscribes to it.**
- `grep` for `ftmsDisconnected` finds exactly one dispatch site: [main.js:1183-1186](../../src/js/main.js#L1183-L1186),
  inside the **catch block of `connectTrainer`** — it fires only when the *initial* connect
  fails, never on a mid-ride drop.
- Consequences: `H.state.ftmsConnected` stays `true`; `TrainerContext.isConnected` stays `true`,
  so the metrics **freeze at their last value instead of blanking**; the workout clock keeps
  advancing; the SIM pipeline keeps writing grade to a dead GATT; **and the ride log keeps
  appending stale samples.**

That last point is the one that matters. This repo has already been burned by exactly this
class of silent-bad-data failure — commit `54f511a`, "the sweep ride recorded 0 W throughout".
Fixing the disconnect wiring is a prerequisite to any mobile work, independent of the UI.

Also CONFIRMED absent by grep across `src/`: no `visibilitychange` or Page Lifecycle handling,
no `navigator.wakeLock` call (**the screen sleeps on its normal timeout mid-ride**), and no
reconnect path — recovery needs `requestDevice`, which needs a user gesture.

### 1.2 What the platform does — INFERRED, not measured

| Event | Expected behaviour | Confidence |
|---|---|---|
| Screen locks | Document → hidden. A wake lock (if held) is **auto-released** on hidden. Chrome then **freezes** the renderer: no timers, no JS, so no grade writes and no telemetry. The GATT link may briefly survive; the app is inert regardless. | INFERRED |
| Long background | Chrome may **discard** the tab, destroying JS state and the `BluetoothDevice` handle. Unambiguous connection loss. | INFERRED |
| App switch | Same family as lock, different timing. Nothing *steals* the trainer — FTMS holds one central — so the risk is our page being frozen, not contention. | INFERRED |
| Trainer reaction to writes stopping | Many FTMS trainers run a control-point watchdog and revert to a default resistance. **KICKR Core V2: UNKNOWN.** | UNKNOWN |

**Practical answer: yes, treat both as ride-ending today.** Proposed additions to
`VALIDATION-PLAN.md` (HW-V11 "Android parity" exists and has never been run):

- **HW-V14 — lock/resume.** Ride 5 min, lock, wait 30 s / 2 min / 10 min, unlock. Record whether
  GATT survives, whether the ride log gaps or goes stale, whether resistance changes while frozen.
- **HW-V15 — app switch.** Same ladder, switching apps instead of locking.
- **HW-V16 — wake lock efficacy.** Confirm no auto-sleep across a 60 min ride, and that a
  *manual* lock still releases it.

### 1.3 Mitigations that are real

1. **Wire `ftms.on('disconnected')` to real state** — stop the clock, blank the metrics, mark the
   ride log. Prerequisite, not a nice-to-have.
2. **Screen Wake Lock** — prevents *automatic* sleep only. Cheap, high value. (Support in Bluefy
   is UNKNOWN — part of the spike.)
3. **Flush on `hidden`/`freeze`** — the ride log already has a restart-safe archive (`a4b0126`);
   extend it so a discard costs nothing.
4. **Installed PWA in `fullscreen`** reduces accidental app switching. It does not make BLE
   survive a discard.
5. **Nothing keeps BLE alive through a tab discard.** Design target: **fail loudly, recover in
   one tap** — not "survive anything".

**A mounted tablet in fullscreen, wake-locked, doing nothing else won't lock or app-switch.** The
lifecycle problem is largely self-inflicted on a phone and largely absent on a mount. Your
tablet-first instinct was right.

---

## 2. The HUD — what it's for, now that the Garmin exists

### 2.1 The premise inverted

The Garmin Edge already gives you power, cadence, speed, HR, elapsed, distance, kJ and W/kg,
live, at a glance. **So the HUD should not be a power display.** Revision 1 of this plan made
power a 130px hero; that was wrong given the Garmin, and it would have spent the best pixels on
a duplicate.

What **only this app can show**:

- **Virtual gear** — number, ratio, and the amber "clamped" state ([MetricsRow.tsx:57](../../src/components/metrics/MetricsRow.tsx#L57))
- **Current workout step** — type (ERG/SIM), target, time elapsed/remaining *in the step*
- **Overall workout progress** — and the **graph**, which you asked for explicitly
- **Route position and the gradient we are sending** (the Garmin only knows grade if it has the
  course loaded; ours is the commanded value, which is the interesting one)
- **Connection health** of the trainer and the Click

**One deliberate exception:** keep a *small* power and cadence readout. Not for pacing — the
Garmin owns that — but as a **liveness indicator**. Given §1.1, frozen numbers are the only
on-screen symptom of a dead link, and a small pair of digits that stop moving is the cheapest
possible detector. That's a justification, not decoration.

### 2.2 DESIGN TARGET: laptop mode (decided 2026-08-06)

Hardware is deferred — the iPad / Android-tablet question gets settled later. **The HUD is
designed for the laptop screen now**, and specced fluidly so a tablet slots in later without a
redesign.

**Laptop mode is materially different from a bar-mounted tablet, and mostly better:**

| Factor | Laptop | Consequence for the design |
|---|---|---|
| Viewing distance | ~1–1.5 m (vs 60–100 cm on a mount) | **Type must be bigger, not smaller.** Further away beats closer only because the screen is larger; the net legibility budget is similar and the type scale must be set from distance, not screen size. |
| Aspect | 16:10 / 16:9 widescreen | More horizontal room, proportionally less vertical than the iPad's 4:3. **Favour horizontal composition** over the 4-row stack that 768px height suggested. |
| Touch | **None** | Touch-target sizing is irrelevant. That frees real pixels — no 64px minimums, no thumb zones. More room for information. |
| Keyboard | **Fully available** | The `[` / `]` bindings in [useKeyboardActions.ts](../../src/hooks/useKeyboardActions.ts) **actually work here.** See §2.2.1 — this is a bigger deal than it looks. |
| Screen lock / app switch | Not a realistic mid-ride risk | §1's lifecycle concerns largely evaporate. Wake lock still worth having — macOS will sleep the display. |
| Browser chrome | URL bar eats vertical space | Add a **Fullscreen API** button on the ride view (`requestFullscreen()`, needs a gesture — fine, it's a pre-ride tap). Cheap, and it's the one thing that makes a laptop HUD feel like an instrument rather than a web page. |
| PWA | Not needed | §6 drops entirely. |

**One mode, not two.** Cinema mode was a consequence of embedding video; with video on a separate
device there's a single full-screen HUD layout. §2.3 is kept for reference only.

#### 2.2.1 The keyboard fallback de-risks the Click bug

On a tablet, the Click dying mid-workout is unrecoverable — there's no other input. **On a laptop
it isn't:** the handoff confirms the keyboard worked throughout the 2026-08-05 ride while the Click
was dead. So `[` / `]` are a *proven* working fallback on this platform.

That doesn't excuse the bug (C5) — it's still on the critical path, and reaching the keyboard
mid-effort is exactly what we're trying to avoid. But it changes the risk from "ride abandoned" to
"ride degraded", which is worth knowing before deciding how much to spend on C5 versus the HUD.

Design consequence: **surface the bound key next to each on-screen action.** `keyForAction()` in
[clickBindings.ts](../../src/services/clickBindings.ts) already exists for exactly this and is unused
in the ride view.

### 2.3 Cinema-mode band — REFERENCE ONLY (needs an embedded video)

Mapped onto the reference HUD's structure — left cluster, centre strip with progress bars,
right-hand contextual panel:

```
┌─────────────────────────────────────────────────────────────────────────┐
│ ┌─────────┐  SIM  Richmond climb          ┌──────────────────────────┐  │ ~150px
│ │  GEAR   │  ███████████░░░░░░  2:14 left │  workout graph, compact  │  │
│ │  12/24  │  overall ████████░░░░  38:12  │  with position marker    │  │
│ │  2.50   │  +3.2%   ·   100 W   85 rpm ● └──────────────────────────┘  │
│ └─────────┘                                                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│                     VIDEO — fills all remaining height                  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

- **Left:** gear as the single biggest element in the band — it's the thing you act on and the
  thing nothing else displays.
- **Centre:** step type + name, step progress bar with time remaining, overall progress bar with
  total elapsed, then a thin tertiary line: gradient, and the small power/cadence liveness pair
  with connection dots.
- **Right:** the compact workout graph with its position marker — our equivalent of the
  reference's minimap.

The band is where the reference layout earns its keep: it proves ~150px of a 800px-tall screen
is enough for genuinely rich state, if the hierarchy is disciplined.

### 2.4 The laptop HUD — the layout we're building

Widescreen, fluid, no fixed pixel canvas. Three rows:

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ TRN ●  CLK ●   LIVE          38:12 elapsed           ⛶ fullscreen   build#    │  ~6%
├──────────────────────────┬────────────────────────────────────────────────────┤
│                          │  SIM   Richmond climb                              │
│         GEAR             │  ████████████░░░░░░░░  2:14 left                   │
│          12  /24         │                                                    │  ~46%
│                          │      +3.2 %  gradient                              │
│       ratio 2.50         │                                                    │
│       phys  2.48         │  next: ERG 210 W in 2:14                           │
├──────────────────────────┴────────────────────────────────────────────────────┤
│  WORKOUT                                                          12.4/28.0km │
│  ▁▃▅█▆▃▁▂▄  ← blocks, active one outlined, red position marker              │  ~40%
├───────────────────────────────────────────────────────────────────────────────┤
│  31.2 kph (virtual)   ·   100 W   ·   85 rpm        [ − ] gear [ + ]   ⏭  ⏹   │  ~8%
└───────────────────────────────────────────────────────────────────────────────┘
```

- **Row 1 — status.** Connections, LIVE, elapsed, fullscreen toggle, build hash. Small.
- **Row 2 — the hero pair.** Gear left (the single largest element — it's what you act on and
  what nothing else shows), current step right with its target, name, progress bar and
  time-remaining. `next:` prefigures the upcoming step so you can prepare rather than react.
- **Row 3 — the graph**, full width and *given real height*. The `max-height: 200px` cap in
  [main.css](../../src/css/main.css) is a desktop-page constraint and should lift here — this is the
  thing you asked for and it's been squeezed into 200px.
- **Row 4 — liveness + fallback controls**, deliberately the smallest row. Speed/power/cadence are
  duplicates of the Garmin and exist only to prove the feed is alive (§2.1). The gear ± / skip /
  end controls sit here with their **bound keys shown** (§2.2.1), de-emphasised because the Click
  is the intended path.

**Fluid, not fixed.** Type scales with `clamp()` against viewport width so the same layout works on
a 13" laptop, a 16" one, and later a tablet — the hardware question stops mattering. Row heights as
percentages, not pixels.

**Gear needs a fourth state.** Beyond the value it carries "clamped" — the model wants more
resistance than the ±25% grade limit can deliver ([MetricsRow.tsx:57](../../src/components/metrics/MetricsRow.tsx#L57)).
Amber **plus a glyph**; colour must never be the only channel.

### 2.5 Blockers found in the current setup

**`tailwind.config.js` is dead config — CONFIRMED.** Tailwind v4 with `@import 'tailwindcss'` and
no `@config` directive never loads the JS config. Proof: `375px` appears **0 times** in
`dist/assets/main-*.css`.

- Fallout: the `xs:` breakpoint does not exist, so [main.js:284](../../src/js/main.js#L284)'s
  `hidden xs:inline` / `xs:hidden` means the SIM **segment name is permanently hidden and "Route"
  always shows, at every screen size**. Minor bug, but it proves the config is inert.
- **Adding `lg:`/`xl:` classes would fail the same silent way.** Declare breakpoints the v4 way —
  `--breakpoint-*` in `@theme` in [main.css](../../src/css/main.css) — and delete or `@config`-wire
  the JS file. This blocks all responsive work.

**`max-w-4xl` caps the app at 896px** ([AppShell.tsx:48](../../src/components/layout/AppShell.tsx#L48)).
A landscape tablet wastes ~40% of its width.

**Both views always mounted, hidden with CSS** — load-bearing, and mistaking it for a bug is one
of the two retracted diagnoses in the handoff. Preserve it.

**`ActiveView` is 11 lines** (`MetricsRow` + `WorkoutProgress`), so the tablet view is mostly new
composition rather than refactor.

### 2.6 Legibility — set the scale from distance, not screen size

Glances last ~200 ms and the rider's eyes are moving. The current `text-[9px]` labels and
`md:text-3xl` values are **desk-work sizes** — someone sitting 50 cm from the screen using a mouse.
A laptop across the room while you're at threshold is a different problem.

**Rule of thumb: legible height scales linearly with distance.** Type that works at 50 cm needs
roughly 2–3× the size at 1.2–1.5 m. So the gear value wants to be *enormous* — several hundred
pixels of a 1512-wide screen, not a `text-3xl`.

`tabular-nums` (already used in `.metric-value`) should be universal so digits never shift. Contrast
matters more than density: the existing `text-gray-600` on `--color-surface` is fine at desk
distance and marginal at 1.5 m — muted labels should move up a step or two.

**This is the one number I need from you: how far is the laptop from your eyes when riding?** Every
size in the design derives from it. Until then the Stitch prompt assumes **1.2 m**, which is a
laptop on a desk directly in front of the trainer.

### 2.7 Work items

| # | Item | Status |
|---|---|---|
| T1 | Fix the dead Tailwind config; breakpoints in `@theme` | DONE `51df698` — config file deleted so it cannot mislead again |
| T2 | Fix the `xs:` fallout at `main.js:284` | DONE `51df698` — fixed by T1 |
| T3 | Disconnect wiring (§1.3 item 1) | DONE `51df698` |
| T4 | Wake lock on workout start | DONE — released on end, re-acquired on `visibilitychange`, and failures are shown rather than swallowed |
| T5 | Fluid type scale — `clamp()` tokens set from **viewing distance** | DONE `51df698`; hero retuned 17vw → 15vw for vertical fit |
| T6 | `RideHud` — status strip + gear/step hero pair | DONE, plus `describeCurrentStep` in `workoutService` (pure, 13 tests) |
| T7 | `LaptopRideView` — the §2.4 four-row layout | DONE; `MetricsRow` reused as row 4, `WorkoutProgress` deleted as redundant |
| T8 | Lift the workout-graph height cap | DONE — 200px → 24vh, scoped to `.hud-graph` |
| T9 | Fullscreen toggle via the Fullscreen API | DONE `7d81ff9` |
| T10 | Show bound keys next to on-screen actions | DONE `7d81ff9` |
| T11 | Gear "clamped" state — amber **plus a glyph** | DONE `7d81ff9`, and on the HUD hero |

**Screenshot-verified at 1512×982: all four rows fit one screen with no scrolling.** That took four
iterations of the vertical budget, and the lesson is worth recording: **rows must be sized to add
up to less than the viewport, not to fight over it.**

- `flex-1` + `min-h-0` on a row whose content cannot shrink (a 227px numeral) makes it *overlap*
  its neighbour rather than shrink.
- Constraining the graph's HEIGHT makes its fixed-aspect 800×150 SVG letterbox *horizontally*,
  throwing away the width. Let width drive and cap the height instead.

Two things landed that were found while building rather than planned:

- **`ConnectionPanel` gained a `compact` mode.** The full card cost ~180px of vertical space
  mid-ride. Its buttons are hidden, never unmounted — `main.js` holds references to
  `#connect-button`, `#start-workout-button` and `#skip-step-button` from import time.
- **`AppShell` widens to 1600px and sheds padding while riding.** `max-w-4xl` wasted ~40% of a
  1512px screen — the §2.5 blocker, which the first HUD build walked straight into.

---

## 3. Media panel

### 3.1 Your content choice removes the main risk

Curated cycling / slow TV / non-commercial content largely defuses the biggest caveat from
revision 1: **embed-disabled videos**. That restriction is concentrated in commercial music and
broadcast content; creator-uploaded cycling and slow-TV footage is usually embeddable. It's still
per-video and still the uploader's choice, so the error state must exist — but it stops being a
design-shaping problem.

Long-form content also changes the shape: **continuous playback matters, a visible queue doesn't.**
Drop the playlist sidebar from revision 1.

### 3.2 Remaining real constraints

- **Autoplay needs `mute=1`** for the *first* unmuted play without a gesture. See §4.3 — this
  interacts with Click control in a way that needs one deliberate tap.
- **Never call the Fullscreen API**; set `fs=0`. Cinema mode is our own CSS resize (§2.2).
- **Battery is the dominant cost.** Video decode plus the BLE pipeline plus the rAF graph, for
  2 hours — put the tablet on mains power. Worth saying in the UI, not just here.
- **Offline:** the IFrame API is an external runtime script, so the media panel won't work
  offline. Acceptable — the app *shell* still will. The SW must not attempt to cache it.
- Use `youtube-nocookie.com`. No CSP is set today, so nothing blocks the iframe. The iframe is
  cross-origin and cannot touch `navigator.bluetooth`, so there's no BLE risk.

### 3.3 Approach

IFrame Player API (not a bare iframe) — we need programmatic `playVideo` / `pauseVideo` /
`nextVideo` / `mute` for Click control, which a bare iframe can't give.

Plus a pasted-playlist-URL parser in a new `src/services/youtube.ts` — pure, unit-testable, which
is the repo's rule for new logic, and it keeps the untestable iframe surface thin.

**StrictMode:** the IFrame API is a global singleton with a global ready callback, and React 19
double-mounts. Needs the guard pattern from [TrainerContext.tsx:34-47](../../src/context/TrainerContext.tsx#L34-L47).

| # | Item |
|---|---|
| Y1 | `services/youtube.ts` — parse and validate playlist/video IDs, unit tests |
| Y2 | `MediaPanel` — persistent iframe, IFrame API wrapper, StrictMode-safe |
| Y3 | Playlist config in Settings → Media, persisted via `services/storage.ts` |
| Y4 | Error states: embed-disabled, offline, none configured |
| Y5 | Cinema-mode container resize (CSS only — must not remount the iframe) |

---

## 4. Click-first control

This is now a major section rather than a detail, because "minimally interacting with the tablet"
makes the Click the primary interface rather than a convenience.

### 4.1 The button budget — CONFIRMED from the code

Ten buttons ([clickButtons.ts](../../src/services/clickButtons.ts), bit map confirmed on your own
hardware 2026-07-29): D-pad ×4 and `SHIFT_DOWN` on the **left** unit; A/B/Y/Z and `SHIFT_UP` on
the **right**.

Current defaults ([clickBindings.ts:56-66](../../src/services/clickBindings.ts#L56-L66)) versus
what's actually wired ([clickActions.ts](../../src/services/clickActions.ts) `IMPLEMENTED_ACTIONS`):

| Button | Bound to | Implemented? |
|---|---|---|
| `SHIFT_UP` / `SHIFT_DOWN` | shiftUp / shiftDown | ✅ |
| `DPAD_RIGHT` | nextStep | ✅ |
| `A` | startWorkout | ✅ |
| `DPAD_UP` / `DPAD_DOWN` | increaseTarget / decreaseTarget | ❌ **no-op** |
| `DPAD_LEFT` | previousStep | ❌ **no-op** |
| `B`, `Y`, `Z` | `none` | — free |

**So three bound buttons currently do nothing on the bike**, and three more are unassigned.
`clickActions.ts` is explicit that this is the failure mode it fears — "a binding that looks
configured, shows up in the UI, and silently does nothing on the bike" — and guards it with a
test asserting `IMPLEMENTED_ACTIONS`. That guard is a feature: any new action must be added to
both the vocabulary and the implemented list, or CI fails.

**Six buttons are available** for media and mode control (B, Y, Z plus the three no-op D-pad
directions if you'd rather have media there than targets). That's ample.

### 4.2 Proposed additions

New `ClickAction` members, each wired and added to `IMPLEMENTED_ACTIONS`:

- `toggleCinema` — swap HUD ⇄ cinema mode
- `mediaPlayPause`
- `mediaNext`
- `mediaMute`

Suggested map: `Z` → `toggleCinema`, `Y` → `mediaNext`, `B` → `mediaMute`. Keeps all media
control on the right unit, away from the shifting paddle on the left. Plus implement the three
existing no-ops (`increaseTarget`, `decreaseTarget`, `previousStep`) so the D-pad stops lying.

### 4.3 The gesture constraint — this one is easy to miss

**A BLE notification is not a user gesture.** Chrome's autoplay policy gates unmuted playback on
user activation, so a `mediaMute`/`playVideo` call arriving from a Click button press may be
*refused* — the browser has no idea a human pressed anything.

Chrome grants **sticky activation** after one real touch/click, and it persists for the document's
lifetime. So the design is:

> **One deliberate "Start media" tap at ride start unlocks audio for the whole session.** After
> that, Click-driven play/pause/next/mute works.

That single tap is consistent with "minimal interaction" — it happens while you're stationary,
alongside connecting the trainer. Without it, expect silent refusals. **Needs a hardware check on
whichever browser wins** (§0) — Bluefy's autoplay behaviour is UNKNOWN.

### 4.4 The uncomfortable part

**The Click currently dies at workout start.** Confirmed, reproducible, mechanism UNKNOWN
(handoff §Gotchas: paddles work before the workout, stop once it starts; the keyboard works
throughout). Leading candidate is BLE-stack contention from the now-fixed unserialised FTMS
writes (`01a6971`), and run 2's log will discriminate a dropped link from an ignored press.

**"Everything via Click" rests on a control path that is known broken mid-workout.** That
promotes the Click bug from experiment nuisance to **critical path for the whole tablet concept**.
Two consequences:

1. The Click diagnosis should be resolved — or at least understood — before T6/T7 are built.
2. On-screen fallback controls must exist even though the goal is not to touch them: gear ±,
   next step, end. On a bar-mounted tablet they're reachable, and they're the difference between
   a salvaged ride and an abandoned one.

| # | Item |
|---|---|
| C1 | Implement `increaseTarget`, `decreaseTarget`, `previousStep` — stop the D-pad lying |
| C2 | Add `toggleCinema`, `mediaPlayPause`, `mediaNext`, `mediaMute` + bindings UI + tests |
| C3 | "Start media" one-tap activation gate, with a clear pre-ride prompt |
| C4 | Minimal on-screen fallback bar (gear ±, next, end), de-emphasised by design |
| C5 | Resolve the Click-dies-at-workout-start bug — **now on the critical path** |

---

## 5. Settings behind a route

`SetupView` is 26 lines stacking six panels into **one** card: `RouteImport`, `WorkoutBuilder`,
`SavedWorkouts`, `VirtualGearSettings` (125 lines), `ClickSettings` (**479 lines**),
`WorkoutPlan`. `ClickSettings` alone carries pairing, bindings, gear config *and* the ride-log
download — the most important debug affordance in the app, buried at the bottom of the longest
component.

**Router — DECIDED 2026-08-06: a hand-rolled hash router,** ~30 lines, no dependency. None is
installed today (deps are `react`, `react-dom` only), and for four flat routes a library isn't
justified. Hash-based is forced regardless of choice: GitHub Pages serves `/hybrid-workout-ftms/`
with no SPA rewrite, so `BrowserRouter` deep links 404.

Scope it deliberately so it stays 30 lines: `useHashRoute()` returning the current route plus a
`navigate()`, `hashchange` listener, and a default. **No** nested routes, params, or guards — if
those turn out to be needed, that's the signal to adopt `react-router` rather than grow this.

**The constraint that will bite:** `main.js` binds DOM IDs at import time and several panels are
main.js-bound; **`ClickSettings` must never unmount.** So **routing is presentational at first** —
keep every legacy-bound panel mounted and toggle container visibility with CSS, exactly as
`AppShell` does; the "route" only picks which container is visible. True unmount-on-navigate comes
only after those panels stop being main.js-bound. This is the single most likely way to
reintroduce the Click bug and deserves a code comment, not just a doc line.

| Route | Contents |
|---|---|
| `#/ride` | The HUD. Default while a workout runs. |
| `#/setup` | Route import, workout builder, saved workouts, plan |
| `#/settings` | Trainer (incl. the `setFTP()`-overwrites-calibration bug at `main.js:521-529`) · Drivetrain · Controls · Rider · Media · Data & Diagnostics |
| `#/dev` | Optional — diagnostics, links to `src/dev/` pages |

**Migration order:** router + containers with zero components moved → pure-React panels
(`VirtualGearSettings`, rider physics) → route/workout panels, checking every `main.js` ID →
**`ClickSettings` last**, verified on hardware before and after.

---

## 6. PWA — gated on §0

| Item | Detail |
|---|---|
| Manifest | `public/manifest.webmanifest`, `display: fullscreen`, `orientation: any` — **don't lock**; a mount can be either way |
| `start_url` / `scope` | Must respect `base: '/hybrid-workout-ftms/'`. The classic Pages-PWA failure. |
| Icons | 192 / 512 + maskable. **None exist** — `public/` is empty. |
| Service worker | Precache the shell only. Asset names already carry content + build hash, so cache-first on `assets/*` is safe; **HTML must be network-first** or you'll ship stale builds — and the footer shows a build hash, so version confusion has a real debugging cost. |
| Never cache | Ride logs, BLE state, the YouTube API script |
| **If iPad + Bluefy** | Install/manifest behaviour and wake lock are **UNKNOWN**. Resolve the §0 spike before investing here. |

---

## 7. Sequencing

**Do not land the router/settings refactor before experiment 18 is ridden.** The experiment
workflow depends on pasting scripts into the desktop console and on `window.Hybrid`,
`window.rideLog`, `window.virtualDrivetrain`, and on `main.js`'s DOM-ID bindings — exactly the
surface a settings refactor touches. Experiment 18 is built, verified, and waiting on a ride.
Keep its rig frozen until the data is in.

**Now, in parallel** (none of it touches the SIM pipeline or the legacy bindings):

Design target is the **laptop screen** (§2.2). Hardware for a mounted tablet stays open and gets
addressed as we go; the fluid type scale in T5 means that decision doesn't force a redesign.

Build order:

1. **T1/T2** — dead Tailwind config. Blocks everything else in the HUD, and silently.
2. **T3** — disconnect wiring. Urgent regardless of any of this; it protects ride-log integrity.
3. **T5** — fluid `clamp()` type scale in `@theme`, set from viewing distance.
4. **T6/T7** — `RideHud` + `LaptopRideView`, the §2.4 four-row layout.
5. **T8/T9/T10/T11** — graph height, fullscreen toggle, bound-key hints, gear clamped state.
6. **C1** — implement the three no-op Click actions.
7. **C4** — the de-emphasised fallback control strip.
8. **C5** — the Click bug. Still on the critical path, but §2.2.1 downgrades it from
   ride-ending to ride-degrading on this platform, since `[` / `]` demonstrably work.
9. Router migration in §5 order — **only after experiment 18 is ridden.**

**Not being built** on this path: all of §3 (media panel), §6 (PWA — a laptop needs none of it),
cinema mode (§2.3), C2/C3 (Click media bindings), **Y1** (`youtube.ts` parser). Revive only if a
mounted Android tablet happens later.

**Steps 1–3 are safe to start now** — none of them touch the SIM pipeline, `window.Hybrid`, or the
legacy DOM bindings that experiment 18's rig depends on.

### Verification

```bash
npm test && npm run lint && npm run typecheck && npm run build
npm run test:e2e
```

Hardware items (HW-V11, proposed HW-V14/15/16, and the §0 spike) cannot run in CI.

### Decisions log

| Date | Question | Decision |
|---|---|---|
| 2026-08-06 | Target device | **iPad 6th gen (2018)** — no Web Bluetooth in any browser, and a permanent iPadOS 17 ceiling. §0.0 |
| 2026-08-06 | Platform approach | **Split the devices, £0.** iPad = video in the native YouTube app; laptop = HUD + BLE; Click = the only control. §0.1 |
| 2026-08-06 | Design target | **Laptop screen.** Fluid `clamp()` scale so a mounted tablet can slot in later without a redesign. Mounted-tablet hardware stays open. §2.2 |
| 2026-08-06 | Router | **Hand-rolled hash router**, ~30 lines, no dependency. §5 |
| 2026-08-06 | Phone ride view | **Descoped.** Worst lifecycle problems, smallest payoff, and largely redundant with the Garmin on the bars. Stitch prompt 4 is parked, not deleted. |

### Still open

1. **Laptop model and viewing distance.** The one number the whole type scale derives from (§2.6).
   Assumed for now: **1512 × 982 at 1.2 m** (14" MacBook Pro on a desk in front of the trainer).
   Wrong by a factor of two and the design is unreadable or comical.
2. **Mounted-tablet hardware** — deferred by agreement, revisit after a few rides on the laptop
   HUD. §0 has the options costed; the fluid type scale means it's not a redesign when it happens.
