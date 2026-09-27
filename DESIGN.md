---
name: Carby
description: Diabetes logging that is legible at 3 AM and ready for the clinic.
colors:
  canvas: "#f5f7fc"
  surface: "#ffffff"
  surface-sunken: "#eef3fa"
  ink: "#1c2940"
  ink-muted: "#5b6c85"
  ink-faint: "#8a9bb2"
  line: "#dfe6f0"
  line-strong: "#c7d3e3"
  accent-solid: "#3457e5"
  accent-deep: "#2f51d5"
  accent-wash: "#edf1ff"
  accent-wash-ink: "#2348c8"
  on-accent-solid: "#ffffff"
  focus-ring: "#6b8eff"
  chart-panel-bg: "#2f51d5"
  chart-panel-ink: "#ffffff"
  chart-panel-ink-muted: "#d7e2ff"
  chart-sensor: "#a6e7f4"
  chart-alert-high: "#ffc37e"
  chart-alert-low: "#ffb6da"
  chart-device: "#e7c8ff"
  chart-review: "#ffe3a6"
  success-ink: "#1c7a4c"
  warning-bg: "#fff3d6"
  warning-ink: "#7a4a06"
  danger-strong: "#b03e3e"
  danger-ink: "#9b362f"
typography:
  display:
    fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "62px"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-2px"
  headline:
    fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.85px"
  title:
    fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "20px"
    fontWeight: 650
    letterSpacing: "-0.45px"
  body:
    fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "11px"
    fontWeight: 650
    letterSpacing: "1.35px"
  scale:
    caption: "12px"
    small: "13px"
    ui: "14px"
rounded:
  swatch: "2px"
  mark: "3px"
  mark-bar: "4px"
  flag: "6px"
  control-inner: "7px"
  input: "8px"
  button: "9px"
  nav: "10px"
  tile: "12px"
  panel: "17px"
  hero: "19px"
  pill: "999px"
spacing:
  hairline: "2px"
  gap: "8px"
  row: "12px"
  section: "17px"
  panel: "23px"
components:
  button:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.button}"
    padding: "10px 13px"
    height: "42px"
  button-primary:
    backgroundColor: "{colors.accent-solid}"
    textColor: "{colors.on-accent-solid}"
    rounded: "{rounded.button}"
    padding: "10px 13px"
    height: "42px"
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.accent-wash-ink}"
    rounded: "{rounded.button}"
    padding: "10px 13px"
    height: "42px"
  button-subtle:
    textColor: "{colors.ink-muted}"
    rounded: "{rounded.button}"
    padding: "10px 13px"
    height: "42px"
  text-button:
    textColor: "{colors.accent-solid}"
    padding: "10px 0"
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.input}"
    padding: "10px 11px"
    height: "43px"
  panel:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.panel}"
    padding: "23px"
  glucose-panel:
    backgroundColor: "{colors.chart-panel-bg}"
    textColor: "{colors.chart-panel-ink}"
    rounded: "{rounded.hero}"
    padding: "26px 27px 16px"
  nav-tab-active:
    backgroundColor: "{colors.accent-wash}"
    textColor: "{colors.accent-wash-ink}"
    rounded: "{rounded.nav}"
    padding: "10px 14px"
    height: "44px"
---

# Design System: Carby

## Overview

**Creative North Star: "The Bedside Monitor"**

Carby is read by someone who is tired, worried or unwell: at 3 AM, on a phone, between a meal and a dose. Like a good bedside monitor, one saturated panel carries the vital sign, the current glucose and its trace. Everything around it stays quiet and orderly and steps back. The interface earns trust by being calm and exact, not by decorating.

Density is moderate. Screens are grouped panels on a pale canvas with clear headings, tabular numbers and generous touch targets. Colour carries meaning, never mood:

- the chart panel is the heartbeat;
- event hues name kinds of record (food, insulin, device, review);
- danger and warning stay unmistakable in every theme.

Five themes (light, dark, blood, amoled, sugar) are personal covers over the same token names. Blood and sugar are playful surfaces, but they must never blur a warning into the accent.

**Key Characteristics:**

- One filled, saturated panel per screen: the glucose card, drawn in `chart-panel` tokens.
- Flat, bordered surfaces. Real shadow belongs to the hero panel and floating layers.
- Tabular numerals wherever values line up.
- Motion is short ease-out state changes, plus one spring on the chart's range switch.
- Every value shown is recorded or computed from the plan. Missing data is drawn as missing.

## Colors

Cool, clinical neutrals around a single confident blue, with a pastel event palette that lives on the dark chart panel. The values below are the light theme; the other themes remap the same names.

### Primary

- **Monitor Blue** (`accent-solid`): primary buttons, links, active text. It is tuned for text and small controls, never for filling large areas.
- **Deep Monitor Blue** (`accent-deep`): the light theme's chart panel and in-range data.
- **Blue Wash** (`accent-wash`, with `accent-wash-ink` text): active navigation tabs and selected soft states.

### Secondary

- **Chart Panel** (`chart-panel-bg`, `chart-panel-ink`, `chart-panel-ink-muted`): the glucose card, the night card and the insights headline. Every large filled panel uses these, never an accent.
- **Sensor Cyan** (`chart-sensor`): the CGM trace.
- **Event pastels on the panel:** high amber (`chart-alert-high`), low pink (`chart-alert-low`), device and illness lilac (`chart-device`), review cream (`chart-review`). Each theme retunes them so they stay distinct from its own panel.

### Neutral

- **Canvas** (`canvas`): the page background.
- **Surface** (`surface`) and **Sunken Surface** (`surface-sunken`): panels, inputs, and troughs such as segmented controls.
- **Ink** (`ink`), **Muted Ink** (`ink-muted`) and **Faint Ink** (`ink-faint`): body text, secondary text and placeholders.
- **Line** (`line`, `line-strong`): 1px borders and dividers.

### Named Rules

**The One Heartbeat Rule.** Only the glucose card (and its siblings, the night card and the insights headline) is a saturated filled panel, and it uses `chart-panel` tokens. Nothing else gets a filled accent background larger than a button.

**The Distinct Alarm Rule.** Danger and warning tokens are chosen per theme to differ from that theme's accent. In blood, danger is amber with a pale ring, not another red. Never signal an alert with the accent colour.

**The Warning Ink Rule.** Pale `chart-review` is unreadable as text on light surfaces, so warning text uses `warning-ink`. `chart-review` text is allowed only on the chart panel.

**The Token-Only Rule.** Colour comes from `app/theme.css` tokens, never literal hex values in components. The clinician report uses only `--report-*` tokens, and printing always restores white paper.

## Typography

**Display font:** Inter, falling back to the system UI sans. It is not self-hosted, so most devices render the system sans.
**Body font:** the same stack.

**Character:** one neutral grotesque at a few firm weights (400, 600, 650, 700), with slightly tightened large sizes. Hierarchy comes from size and weight steps, not from a second family.

### Hierarchy

- **Display** (650, 62px, line-height 1.3, tracking -2px): the current glucose value. It shrinks to 56px at 780px and 42px on phones.
- **Headline** (700, 30px, line-height 1.15, tracking -0.85px): page titles. The legacy `h1` is 38px.
- **Title** (650, 20px, tracking -0.45px): section and panel headings.
- **Body** (400, 16px, line-height 1.5): text and inputs. Inputs stay at 16px so iOS never zooms on focus.
- **UI** (14px): button, tab and field labels.
- **Small** (13px): helper text, table text and text buttons.
- **Caption** (12px): chart details, period flags, chips and stacked phone tab labels.
- **Label** (650, 11px, tracking 1.35px, upper case): overline labels on the chart panel, such as "Latest logged · Today". Chart legend group names use the same treatment at a smaller size.

### Named Rules

**The Tabular Rule.** Numbers that sit in columns or change in place (readings, units, times, dates in the chart) use `font-variant-numeric: tabular-nums`.

## Layout

- **Page:** a centred column with a 1480px maximum width, 24px side padding and 28px top padding. The topbar is a single row that wraps: the brand, the workspace tabs, then tools pushed to the right. Tabs never shrink below their labels; the tools wrap to a new line instead.
- **Today view:** a main column (the reading card with its chart, then the daily log) beside a side column of reminders and quick actions. They stack below 999px.
- **Breakpoints:** 999px (columns stack), 780px (chart tooltip becomes static, controls enlarge), 680px (phone header), 480px (tab icons stack above labels).
- **Spacing rhythm:** 8px minimum between any two controls, 12px between rows, about 17px under section headings, 23px panel padding.

### Named Rules

**The Eight-Pixel Rule.** Adjacent buttons never touch. Button groups are flex or grid containers with a gap of at least 8px and wrapping, at every width. No margins on individual buttons and no non-breaking spaces.

## Elevation & Depth

Hybrid, mostly flat. Resting surfaces are separated by 1px `line` borders on a `canvas` background, and some list items add a barely visible 1–2% lift. Real shadow marks only three things: the hero panel, floating layers, and a selected state that sits above a trough.

### Shadow Vocabulary

- **Hero glow** (`box-shadow: 0 10px 25px color-mix(in srgb, var(--chart-panel-bg) 8.6%, transparent)`): the glucose card.
- **Floating layer** (`box-shadow: 0 10px 24px rgb(var(--shadow-rgb) / 14.1%)`): popovers, tooltips and callouts over content.
- **Raised selection** (`box-shadow: inset 0 0 0 1px var(--chart-panel-border), 0 2px 4px rgb(var(--shadow-rgb) / 13.3%)`): the selected segment in a segmented control.

## Shapes

Soft, consistent rounding that grows with the element:

- 2px for legend swatch bars;
- 3–4px for chart marks and the in-range band swatch;
- 6px for period flags on the chart;
- 7px for segments inside a control;
- 8px for inputs;
- 9px for buttons;
- 10–12px for tabs and tiles;
- 17px for panels;
- 18–19px for dialogs and the hero card.

Full pills (999px) are only for small status chips. Chart marks are small rounded bars and circles. A HIGH or LOW run is a rounded bar along the plot edge, never a fabricated point.

## Components

### Buttons

- **Shape:** gently rounded (9px), at least 42px tall (44px on phones), 14px/600 label, with an icon gap of 8px.
- **Primary:** `accent-solid` fill with `on-accent-solid` text. There is exactly one per view or dialog.
- **Outline and subtle:** a `surface` or transparent fill with a `line` border. Use these for every secondary action.
- **Text button:** an inline link-style action in `accent-solid`, with no horizontal padding, so its container supplies the gap.
- **Danger:** a `danger-strong` fill, used only as the confirm button inside an alert dialog.
- **Focus:** a 3px `focus-ring` outline with a 3px offset.
- **Disabled:** 50% opacity with a not-allowed cursor.
- **Busy:** a spinning `Loader2` icon and a label like "Saving…".

### Chips

- **Legend layer chips:** these sit on the chart panel. Each is a small rounded chip with a swatch or icon and a label. It toggles its layer: switched off, it shows a dashed outline with a dimmed swatch. Hover or focus previews the layer by fading every other layer.
- **Segmented range switch:** a sunken trough with transparent segments. One raised pill springs to the selected segment.
- **Status and period chips:** small rounded or full-pill tags in event tokens.

### Cards / Containers

- **Panel:** `surface` fill, 1px `line` border, 17px corners, 23px padding.
- **Glucose card:** `chart-panel` fill, 19px corners, the hero glow. It holds the reading, the chart, the legend and the data-quality row.
- **Tiles and tables:** 12–13px corners on `surface` or `canvas`, with tabular numbers.

### Inputs / Fields

- **Style:** labelled fields (14px muted label above), 43px tall, 8px corners, `line` border, 16px text.
- **Focus:** the border shifts to `focus-ring` with a 3px low-opacity accent halo.
- **Error:** the field is marked, and the message names the problem.

### Navigation

- **Workspace tabs:** 44px tall, 14px/650 labels with an icon. The active tab gets the Blue Wash fill and hover gets `surface-sunken`. On phones the tabs share the row equally, and below 480px each stacks its icon above a 12px label.

### Glucose Chart (signature component)

- **Layers:** the CGM trace sits over an in-range band (the plan's range, shown as a faint ink wash).
- **Status runs:** HIGH and LOW runs are drawn as edge bars.
- **Event lanes:** logged events sit in labelled Food, Insulin and Other lanes under the time axis. Crowded marks spread apart, with hairline ticks back to their true time.
- **Periods:** each period is a lilac wash and top strip, named by a flag standing on the strip. Hovering the flag deepens the wash.
- **Motion:** range and zoom changes glide the time axis with a quartic ease-out over about 320ms.
- **Input:** it is fully keyboard-operable (arrows, +/−, 0, Escape), and a records table lists every plotted mark.

## Do's and Don'ts

### Do:

- **Do** fill large panels with `chart-panel` tokens and keep accents for text and controls.
- **Do** check every change in light, dark, blood, amoled and sugar, including contrast of any text on the chart panel.
- **Do** keep at least 8px between buttons at 780px, 999px and phone widths.
- **Do** use `lucide-react` icons at 15–19px. Decorative icons get `aria-hidden`, and icon-only buttons get an `aria-label`.
- **Do** keep state transitions short (0.15–0.2s ease-out) and turn motion off under `prefers-reduced-motion`.

### Don't:

- **Don't** hardcode hex colours or restyle a single button inline. Use the existing button classes.
- **Don't** use `.notice` for healthy or neutral status. It is styled as an amber warning.
- **Don't** plot a HI/LO or High/Low status as a number, or draw over a data gap.
- **Don't** add a second primary action to a view or dialog.
- **Don't** colour a warning or danger state with the theme's accent.
