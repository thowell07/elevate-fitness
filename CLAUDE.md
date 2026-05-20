# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

Elevate is a mobile-first fitness tracking PWA-style app (workouts, habits, body metrics). The entire application lives in a single file: `index.html`.

## Running the app

There is no build step, package manager, test runner, or linter. To run:

- Open `index.html` directly in a browser, or
- Serve the directory with any static server (e.g. `python3 -m http.server`).

React, ReactDOM, Babel Standalone, and Tailwind are all loaded from CDNs. JSX is compiled in the browser at runtime via `<script type="text/babel">`.

## Architecture

Everything is one `<script type="text/babel">` block inside `index.html`. Treat that block as the entire codebase.

- **Component tree**: `ElevateApp` owns all state and routes between five tab views via a single `activeTab` string — `home` (`HomeDashboard`), `track` (`WorkoutTracker`), `history` (`HistoryView`), `habits` (`HabitTracker`), `metrics` (`Biometrics`). `BottomNav` switches tabs. No router.
- **State**: three top-level pieces of state (`workouts`, `habits`, `metrics`) are lazily initialized from `localStorage` and written back via `useEffect` on every change. Storage keys: `elevate_workouts`, `elevate_habits`, `elevate_metrics`. This is the only persistence layer.
- **Data shapes**:
  - workout: `{ id, date: ISO string, movement, lift, sets: [{ reps, weight }] }`
  - metric: `{ id, date: ISO string, weight, muscle, fat }`
  - habits: `{ [dateKey]: [habitId, ...] }` — note `dateKey` is `new Date().toLocaleDateString()` (locale-dependent), not ISO. Workouts are grouped in `HistoryView` by `toLocaleDateString()` too, so the two formats are intentionally consistent within the UI but differ from the stored `date` field on workouts/metrics.
  - The five default habits are hard-coded inside `HabitTracker` (`defaultHabits`); habit IDs 1–5 are referenced by position.
- **Icons**: all SVG icons are inlined as React components (`HomeIcon`, `PlusIcon`, etc.) built on a shared `Icon` wrapper — no icon library. Add new icons the same way.
- **Styling**: Tailwind utility classes only (via CDN). The layout is constrained to `max-w-md` (mobile-only design) and uses `env(safe-area-inset-bottom)` plus a fixed bottom nav, so all scrollable views need `pb-24` to avoid being hidden behind the nav.

## Conventions when editing

- Keep everything in `index.html`. There is no module system; do not introduce `import`/`export` or split files without also introducing a build step (and discuss that first — it would change the entire deployment model).
- New components go inside the same `<script type="text/babel">` block, before `ElevateApp`. State that needs to persist across tabs must be lifted into `ElevateApp` and given its own `localStorage` key + `useEffect`.
- `confirm()` and other browser globals are used directly (see `deleteWorkout`); there is no abstraction layer.
