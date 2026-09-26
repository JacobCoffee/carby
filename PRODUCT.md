# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two primary users, equally first-class:

- **People with diabetes** logging their own care.
- **Caregivers** logging for someone else, such as a parent logging for a child.

Copy stays neutral about who is logging. Both use it in the moment (a meal, a dose, a low, an overnight check, a sick day) and again before a clinic visit, when the logbook and the clinician report matter most.

The care team reads what Carby produces (the printed clinician report, the logbook, Clarity PDFs) but does not use the app.

## Product Purpose

Carby is a diabetes logging web app. It records glucose, food, insulin, exercise, low treatments, reminders, illness and other periods, and appointments. It turns them into a clinic-style logbook, CGM insights and a printable clinician report. It can pull readings from Dexcom Share (live) and Dexcom Clarity (full history, gap backfill and monthly PDF archive).

Success means every entry is quick to make under stress, the record is complete and honest, and a clinic visit needs nothing but what Carby prints.

## Positioning

- **The care plan is the only clinical authority.** Carby ships no clinical defaults. Thresholds, ratios, targets, ranges, pattern rules and instructions all come from the user's own plan, and anything missing is asked for, never assumed.
- **Built around the clinic's own artifacts:** the logbook grid, the clinician report and the pattern rule the care team actually uses.
- **Live and retrospective CGM data in one record.** Share covers what's happening now, and Clarity fills in what Share missed.
- **The user's data stays theirs.** Carby is self-hosted, every record is scoped to its owner, and backups and export are complete.

## Operating Context

- Phones and desktops. Phones are used in the moment, often one-handed, at night or while unwell. Desktops are used for review and printing.
- The CGM (Dexcom G7) runs through the Dexcom app on another device or a receiver. When that device goes out of range, Share stops and Clarity later backfills.
- Clinic visits: the user prints the clinician report and brings the logbook. Printing always uses a fixed white-paper palette.
- Sick days, travel across time zones, and overnight checks are routine situations, not edge cases.

## Capabilities and Constraints

- **Not a medical device.** Nothing Carby shows is dosing advice. UI copy never generates treatment advice; it shows only text the user entered or existing generic guidance.
- **Insulin calculator.** It performs the care plan's own carb-ratio and correction arithmetic, shows the working, and records the dose given. It is labelled "Plan math only, not dosing advice".
- **Never fabricates values.** Meter HI/LO and CGM High/Low readings are kept as statuses, not plotted as numbers. Gaps stay visible as gaps.
- **Glucose ranges are display-only.** The consensus ranges (54/70/180/250) are the headline CGM metrics. The plan's own ranges drive the chart band and a "time in plan range" line.
- **Every record is scoped to its owner,** and every change is audited.
- **Unofficial Dexcom interfaces.** Share and Clarity are accessed through interfaces Dexcom does not officially support, so they may break.
- **No security audit yet.** The README tells users to use synthetic data until their deployment meets `docs/hosting-migration.md`.
- **Open decision: hosting Carby for other people.** Today Carby is personal and self-hostable (FSL-1.1 with an MIT future license; Cabotage is the recommended host). A service others sign up for is undecided and is blocked on three open questions:
  - the regulatory status of the insulin calculator when it is offered to others;
  - replacing the unofficial Dexcom access with Dexcom's partner API;
  - health-data privacy and breach-notice duties (FTC Health Breach Notification Rule, state health-data laws, GDPR), which a disclaimer does not remove.

## Brand Commitments

- **Name and mark:** the name is Carby, and the wordmark is the `CarbyWordmark` component.
- **Five themes, all first-class:** light, dark, blood, amoled and sugar. Danger and warning colours must stay distinct from each theme's accent.
- **Voice:** plain, short, sentence case. Buttons say what they do. The app is calm and factual about glucose and never alarmist or cute about risk. The error pages are the one place for glucose-themed play ("off the chart", "signal lost").

## Evidence on Hand

- Product screenshot: `docs/images/dashboard.webp`.
- There are no testimonials, user counts, clinical validation, accuracy claims or security audit. Future work must not imply any of them.

## Product Principles

1. **The plan decides, Carby records.** No clinical value exists unless the user entered it.
2. **Legible under stress.** The critical reading and the next action must be clear at 3 AM, on a phone, while sick.
3. **Honest data.** Show what was recorded, show where data is missing, and never smooth over either.
4. **Clinic-ready by default.** Anything a clinician reads must print cleanly and match the clinic's own conventions.
5. **The owner's data.** Everything stays scoped to its owner, exportable and restorable.

## Accessibility & Inclusion

- Every screen works in all five themes with readable contrast. Printing always uses white paper.
- Touch targets are about 44px on phones. Button groups keep at least 8px gaps at every width.
- The glucose chart is keyboard-operable with an equivalent records table.
- Motion respects `prefers-reduced-motion`.
