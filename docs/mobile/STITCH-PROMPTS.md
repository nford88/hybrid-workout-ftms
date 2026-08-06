# Google Stitch prompts — UI skeletons

Paste-ready prompts. Written layout-first with concrete pixel sizes, named zones with
proportions, exact hex values and an explicit "do not" list — generators drift toward generic
SaaS dashboards without those.

**Revision 3** — the design target is now the **laptop screen** (decided 2026-08-06). A Garmin Edge
already shows power/cadence/HR, so the HUD is a **workout-and-drivetrain** display, not a vitals
display. Video plays separately on the iPad, so there's one ride layout, not two.

**Run prompt 2.** Prompt 1 (cinema band) needs an embedded video and is parked; prompt 4 (phone) is
descoped. Prompt 3 (settings) is still live and useful.

**Shared design system** — repeat verbatim in every prompt (from [src/css/main.css](../../src/css/main.css)):

```
Background      #0d0f18
Surface         #161929
Surface raised  #1e2235
Border          #2a2f47   (1px, all cards)
Body text       #e5e7eb
Muted text      #6b7280
Corner radius   12px cards, 8px controls
Accents — Gear #fb923c (orange) · Gear clamped #fbbf24 (amber) · Power #22d3ee (cyan)
          Speed #4ade80 (green) · Cadence #facc15 (yellow) · Time #c084fc (purple)
          ERG step #22d3ee · SIM step #fb923c
          Gradient up #f87171 · down #60a5fa · flat #4ade80
          Live/connected #4ade80 · Disconnected/stop #dc2626
Numerals        tabular / monospaced figures, never proportional
```

---

## Prompt 1 — Cinema mode (video primary, HUD band on top)

This is the mode modelled on the in-game HUD reference.

> **CONDITIONAL — probably don't run this one yet.** Cinema mode only exists if the video is
> embedded in our app, and the recommendation in `TABLET-PWA-PLAN.md` §0.1 is to play it in the
> iPad's native YouTube app instead. Kept because it's the right design *if* an Android tablet
> happens later.

**Canvas — an iPad 6 is 1024 × 768 logical, not 1280 × 800.** If you do run this, change the
canvas line to `1024 x 768 px landscape`, the band to `190px`, and the video area to `578px`.
Region A drops to 170px wide and Region C to 260px; the type sizes still hold.

**The 4:3 ratio is a real gift here.** A 16:9 video at 1024 wide is 1024×576, leaving **192px of
letterbox** in a 768px screen. The HUD band fits in space that would otherwise be black bars — it
costs *nothing* in video size. Tell Stitch that explicitly; it justifies the band instead of making
it look like an imposition on the video.

```
Design a dark-theme HUD BAND for an indoor cycling app on a 10-inch Android tablet in
landscape, mounted on bicycle handlebars, read at 60-100 cm while pedalling hard. A video
fills the screen beneath the band. The band is a compact status strip, NOT a dashboard.

IMPORTANT CONTEXT: the rider has a separate bike computer already showing power, cadence,
heart rate and time. So this HUD must NOT foreground those. It shows what the bike computer
cannot: the virtual GEAR, the current WORKOUT STEP, and progress through the workout.

CANVAS: 1280 x 800 px landscape. The band occupies the top 150px, full width. The remaining
650px is a single dark video area — render it as a flat #000000 rectangle with a small
centered play glyph, nothing else. Do not design the video content.

COLOR SYSTEM (use exactly): background #0d0f18, band surface #161929, raised #1e2235,
1px borders #2a2f47, text #e5e7eb, muted #6b7280. Gear #fb923c orange, SIM step #fb923c,
ERG step #22d3ee, gradient climbing #f87171, power #22d3ee, cadence #facc15,
connected dot #4ade80. Card radius 12px.

BAND LAYOUT — three regions left to right, 16px gaps, 16px outer padding:

REGION A — GEAR, fixed 200px wide, full band height, raised card #1e2235.
  Label "GEAR" 11px uppercase letterspaced muted, top-left.
  Value "12" in orange #fb923c at 76px, extra bold, tabular numerals, dominant.
  Immediately right of it, baseline-aligned, "/24" at 28px in muted grey.
  Below: "ratio 2.50" 15px tabular, muted.
  This is the largest single number in the band. It is what the rider acts on.

REGION B — WORKOUT PROGRESS, flexible, fills all remaining width between A and C.
  Row 1 (28px tall): a small pill badge "SIM" in orange on translucent orange, then the
    segment name "Richmond climb" 18px semibold, then right-aligned "2:14 left" 18px
    tabular.
  Row 2 (14px tall): STEP progress bar, full width, 8px tall, rounded ends, track #2a2f47,
    fill orange #fb923c at 62% width.
  Row 3 (22px tall): "OVERALL" 11px uppercase muted on the left, right-aligned "38:12"
    18px tabular purple #c084fc.
  Row 4 (14px tall): OVERALL progress bar, full width, 8px tall, track #2a2f47,
    fill cyan #22d3ee at 44% width.
  Row 5 (24px tall) — TERTIARY LIVENESS LINE, all small, 14px, muted-weight:
    "+3.2%" in red #f87171 · a thin vertical divider · "100 W" in cyan · "85 rpm" in yellow
    · then two 8px status dots labelled "TRN" and "CLK", both green #4ade80.
    This row is deliberately the smallest thing in the band.

REGION C — ROUTE PROFILE, fixed 300px wide, full band height, card.
  A horizontal elevation profile chart: a filled area in muted blue-grey #3b4257 against
  the card background, with a bright red #f87171 1px vertical position marker at 44% along,
  topped with a small red dot.
  Bottom-right corner overlay: "12.4 / 28.0 km" 13px tabular muted.
  No axes, no gridlines, no legend, no labels.

CRITICAL CONSTRAINTS:
  - The GEAR number is the visual anchor. Nothing may compete with it.
  - Power and cadence must be SMALL. They are duplicates of a device the rider already has;
    they exist here only to prove the data feed is alive.
  - All numerals tabular/monospaced so digits do not shift as values change.
  - The band must total no more than 150px tall. Video real estate is the point.
  - No hover states, no tooltips. Barely any touch either — this is driven by a handlebar
    remote.
  - Do NOT add: a sidebar, hamburger, search field, avatar, settings gear, breadcrumbs,
    chart axes, chart legend, video playback controls, a playlist queue, or a heart-rate
    reading.
  - No gradients on backgrounds, no glassmorphism, no drop shadows, no glow except a faint
    cyan glow permitted on the active step badge.
  - No decorative illustration and no filler.
```

---

## Prompt 2 — Laptop ride HUD — **START HERE. This is the design target.**

The only ride screen being built (decided 2026-08-06). Runs fullscreen on the laptop; video plays
separately on the iPad; the Zwift Click does the driving.

**Change one thing before pasting:** the canvas says `1512 x 982` (a 14" MacBook Pro) at **1.2 m**
viewing distance. Swap both for your actual laptop and how far it sits from your eyes — every type
size below derives from that distance, and getting it wrong is the difference between an instrument
and an unreadable web page.

```
Design a dark-theme FULLSCREEN instrument cluster for an indoor cycling app, running in a
browser on a laptop that sits on a desk roughly 1.2 METRES from the rider's eyes while they
pedal hard on an indoor trainer. The rider glances at it for about 200 milliseconds at a
time. This is a glanceable instrument panel, NOT a dashboard and NOT an analytics page.

CANVAS: 1512 x 982 px, landscape, fullscreen with no browser chrome, no scrolling.

CRITICAL CONTEXT THAT DRIVES THE WHOLE HIERARCHY:
  The rider has a separate bike computer on the handlebars already showing power, cadence,
  heart rate, speed and time. So this screen must NOT foreground any of those — they are
  duplicates. Its job is the three things the bike computer cannot show:
    1. the VIRTUAL GEAR (a software gear, 1-24, with a ratio)
    2. the CURRENT WORKOUT STEP and its target
    3. the WORKOUT GRAPH with position
  The rider controls everything from a handlebar remote, so there is almost nothing to click.
  Because the screen is 1.2 m away, type must be MUCH larger than normal desktop UI.

COLOR SYSTEM (use exactly): page background #0d0f18, card surface #161929, raised surface
#1e2235, 1px borders #2a2f47, primary text #e5e7eb, muted text #9ca3af (note: muted is
lightened for distance legibility). Gear #fb923c orange, gear-warning #fbbf24 amber,
power #22d3ee cyan, cadence #facc15 yellow, speed #4ade80 green, time #c084fc purple,
SIM step #fb923c, ERG step #22d3ee, gradient climbing #f87171 red, connected #4ade80,
stop #dc2626. Card radius 12px.

LAYOUT — four rows, top to bottom, percentages of the 982px height:

ROW 1 — STATUS STRIP, full width, 6% (~60px), no card, sits on the page background.
  Left: two pills "TRAINER" and "SHIFTER", each with a 10px green #4ade80 dot, 15px labels.
  Center-left: a "LIVE" pill, green text on translucent green.
  Right, in order: elapsed time "38:12" 28px tabular purple; a fullscreen-exit icon button;
  and "build a4b0126" in 12px muted monospace.

ROW 2 — HERO ROW, full width, 46% (~450px), two cards side by side at 38% / 62%, 24px gap.
  CARD A — GEAR. This is the largest thing on the screen.
    Label "GEAR" 16px uppercase letterspaced muted, top-left.
    Value "12" in orange #fb923c at 260px, extra bold, tabular numerals, optically centered
      in the card.
    Baseline-aligned to its right: "/24" at 72px in muted grey.
    Beneath, two lines: "ratio 2.50" 26px tabular muted, "physical 2.48" 18px tabular muted.
  CARD B — CURRENT STEP.
    Top row: a pill badge "SIM" in orange on translucent orange, then the segment name
      "Richmond climb" at 34px semibold.
    Center: the step target "+3.2" in red #f87171 at 150px extra bold tabular, with the unit
      "% gradient" at 26px muted directly beneath.
    Then: "2:14 left" at 44px tabular, and a full-width 12px progress bar with rounded ends,
      track #2a2f47, fill orange #fb923c at 62% width.
    Bottom line, smaller and muted at 20px: "next: ERG 210 W in 2:14".

ROW 3 — WORKOUT GRAPH, full width, 40% (~390px), single card. Give it real height; this is
  the second most important element on the screen.
  Title "WORKOUT" 14px uppercase letterspaced muted, top-left.
  A horizontal workout profile: about 9 adjacent vertical blocks of varying height
  representing step intensity, filling the card width and most of its height. ERG blocks are
  cyan #22d3ee, SIM blocks orange #fb923c, all at about 70% opacity.
  The 4th block is ACTIVE: full opacity, 1px cyan border, faint cyan outer glow.
  A bright red #f87171 vertical position marker line crosses the full chart height at 44%
  along, with a small red dot at its top.
  Bottom-right overlay: "12.4 / 28.0 km" 18px tabular muted.
  No axes, no gridlines, no legend, no tick labels.

ROW 4 — LIVENESS AND FALLBACK STRIP, full width, 8% (~78px), one card, deliberately the
  least prominent row on the screen.
  Left half, a single horizontal line of three small readouts separated by thin vertical
  dividers, each as "value unit" with a 12px uppercase muted label above:
    "31.2 kph" green (label "SPEED (VIRTUAL)"), "100 W" cyan (label "POWER"),
    "85 rpm" yellow (label "CADENCE"). Values at 28px tabular maximum.
  Right half, right-aligned: four small outline buttons, 40px tall, muted grey borders, each
  with a tiny monospaced keyboard-shortcut chip beneath or beside its label:
    "GEAR −  [" · "GEAR +  ]" · "SKIP  →" · "END" (END in red #dc2626).
  These buttons must read as a de-emphasised fallback, never as the primary interface.

CRITICAL CONSTRAINTS:
  - GEAR is the visual anchor. The step target is second. The graph is third. NOTHING else
    may compete.
  - Power, cadence and speed must stay at 28px or smaller. They are duplicates of the bike
    computer and exist here only to prove the data feed is still alive.
  - The gear value must not be smaller than 220px. It is read from 1.2 metres away.
  - All numerals tabular/monospaced so digits do not shift as values change.
  - Muted text must be light enough to read at 1.2 m — use #9ca3af, never #6b7280 or darker.
  - No hover states, no tooltips: the rider cannot reach the trackpad mid-effort.
  - Do NOT add: a sidebar, hamburger, nav drawer, top navbar, search field, avatar, settings
    gear, breadcrumbs, chart axes, chart legend, heart rate, calories, a map, a video player,
    or a large prominent button bar.
  - No background gradients, no glassmorphism, no drop shadows. The only permitted glow is
    the faint cyan one on the active workout block.
  - No decorative illustration, no empty-space filler, no marketing copy.

ALSO PRODUCE this variant of the GEAR card, as a second frame:
  The "CLAMPED" state — the software wants more resistance than the trainer can deliver.
  The gear value turns amber #fbbf24, and a small warning glyph plus the word "CLAMPED"
  appears in the card. The state must be readable WITHOUT relying on the color change alone.
  - No background gradients, no glassmorphism, no drop shadows.
```

---

## Prompt 3 — Settings screen (tablet)

```
Design a dark-theme settings screen for an indoor cycling app that controls a smart bicycle
trainer over Bluetooth. Laptop browser, mouse and keyboard. Used BEFORE and AFTER a ride at
normal desk distance, never during it — so unlike the ride screen it can be dense, use
normal desktop type sizes, and rely on hover states.

CANVAS: 1512 x 982 px landscape.

COLOR SYSTEM: background #0d0f18, card surface #161929, raised #1e2235, 1px borders
#2a2f47, text #e5e7eb, muted #6b7280, focus accent #06b6d4 cyan, destructive #dc2626.
Card radius 12px, control radius 8px.

LAYOUT — two columns:

LEFT SIDEBAR, 280px wide, full height, background #161929, 1px right border.
  Header: a back arrow and "Settings" in 22px semibold.
  Six navigation rows, each 56px tall, each with a leading 20px icon, a label, and a 12px
  muted one-line description:
    1. Trainer — "Connection, FTP, calibration"
    2. Drivetrain — "Gear table, ratios, baseline gear"
    3. Controls — "Remote buttons, keyboard shortcuts"  [ACTIVE: 3px cyan left border,
       raised #1e2235 background, cyan label]
    4. Rider — "Weight, rolling resistance, drag"
    5. Media — "Video playlist"
    6. Data — "Ride log export, diagnostics"

RIGHT CONTENT PANEL, remaining width, 32px padding, showing "Controls":
  Heading "Controls" 24px semibold with a one-sentence muted subtitle.

  SUB-CARD 1 — "HANDLEBAR REMOTE":
    A connection row: device name, green status dot, battery "84%", and a "Disconnect"
    secondary button right-aligned, minimum 44px tall.
    Beneath, a two-column binding table with 10 rows. Left column: the physical button name
    in monospaced text on a raised #1e2235 chip (e.g. "+ paddle", "− paddle", "D-pad Up",
    "A", "B", "Y", "Z"). Right column: a dropdown select 44px tall showing the assigned
    action, background #1e2235, 1px border #2a2f47, cyan border on focus.
    THREE of the rows must show a small amber #fbbf24 warning chip reading "not wired yet"
    between the two columns — some actions are declared but not implemented, and the UI
    must say so rather than look configured.

  SUB-CARD 2 — "KEYBOARD":
    Same two-column shape, 5 rows, keys shown as monospaced keycap chips.

  SUB-CARD 3 — "DIAGNOSTICS":
    A dark scrolling log area 140px tall, monospaced 12px, 5 lines of bracketed log output
    in muted green and grey.
    Right-aligned beneath: "Copy log" secondary button, and "Clear" in destructive red.

CONSTRAINTS:
  - Minimum 44px touch targets for every control.
  - Form controls: dark fill #1e2235, 1px border #2a2f47, cyan #06b6d4 border on focus.
    No inner shadows, no pill-shaped inputs.
  - Do NOT add: a top navbar, breadcrumbs, search, avatar or account menu, a light/dark
    toggle, or a "Save" bar — settings apply immediately.
  - No illustrations, no empty-state art, no marketing copy.
  - Do not substitute toggle switches for the action dropdowns.
```

---

## Prompt 4 — Phone ride view — PARKED

**Descoped 2026-08-06.** The phone is where the lock/app-switch lifecycle problems are worst and
the payoff smallest, and with a Garmin Edge on the bars it's largely redundant. Kept here rather
than deleted, since the brief won't change if it's revived.

```
Design a dark-theme ride screen for the same indoor cycling app on an Android PHONE in
portrait, bar-mounted, read at 40-60 cm while pedalling hard. Ruthlessly minimal.

IMPORTANT CONTEXT: a separate bike computer already shows power, cadence, heart rate and
time. This screen shows the virtual GEAR and the current WORKOUT STEP. Nothing else earns
its place.

CANVAS: 390 x 844 px portrait, no scroll, safe-area aware.

COLOR SYSTEM: background #0d0f18, surface #161929, raised #1e2235, borders #2a2f47,
text #e5e7eb, muted #6b7280. Gear #fb923c, gradient #f87171, power #22d3ee,
cadence #facc15, time #c084fc, connected #4ade80, stop #dc2626.

LAYOUT, top to bottom:
  1. A minimal 40px status row: trainer dot and remote dot on the left, "38:12" tabular on
     the right. No title, no logo.
  2. GEAR, full width, 220px, sitting directly on the page background with no card border.
     Label "GEAR" 11px uppercase muted. Value "12" orange at 150px extra bold tabular,
     with "/24" at 44px baseline-aligned beside it. "ratio 2.50" 16px muted beneath.
  3. CURRENT STEP card, full width, 180px. "SIM" pill badge plus segment name 17px.
     Target "+3.2" red at 72px with "% gradient" beneath. "2:14 left" 22px tabular, and a
     full-width 8px step progress bar, orange fill at 62%.
  4. A 64px route strip: a thin elevation profile, muted blue-grey fill, red position
     marker at 44%, and "12.4 / 28.0 km" right-aligned 13px tabular.
  5. A single 56px row of three tiny liveness readouts, 11px labels and 24px tabular
     values: POWER 100 cyan, CADENCE 85 yellow, SPEED 31.2 green.
  6. A minimal fallback control bar pinned to the bottom, 72px including safe area,
     background #1e2235, 1px top border: [ GEAR − ] [ GEAR + ] [ END ] — 48px tall,
     muted outline style, END in red. De-emphasised: the handlebar remote is the intended
     control path and these exist only for when it fails.

CONSTRAINTS:
  - No video player on the phone. It competes for scarce pixels and battery.
  - No bottom tab bar, no hamburger, no nav drawer, no header title.
  - Minimum 48px touch height on the fallback buttons.
  - Tabular numerals everywhere.
  - Do not make the gear value smaller than 120px, and do not make power/cadence/speed
    larger than 24px.
  - No hover states, no tooltips, no swipe-to-reveal for anything safety-relevant.
```

---

## Using the output

Stitch gives visual direction, not code to paste. Keep the composition and proportions and
rewrite the styling against the real tokens — Stitch will invent hex values *close to but not
equal to* the ones above, and matching them by eye is exactly how design drift starts. Then run
`/normalize` to realign anything that slipped from the `@theme` tokens and the existing
`.metric-card-compact` / `.section-card` / `.btn-*` / `.form-*` component classes.

Two things worth generating variants of, because the brief is unusual and the first attempt
probably won't nail it:

- **The cinema band.** Fitting gear, step, two progress bars, a profile chart and a liveness row
  into 150px is the hardest constraint in the set. Ask for 3 variants.
- **The gear treatment.** It carries a fourth state beyond the value — "clamped", when the model
  wants more resistance than the ±25% grade limit can deliver. Ask explicitly for that state:
  amber, plus a glyph, since colour alone must never be the only channel.
</content>
