# Elevate Fitness

Private, iPhone-installable workout planning and tracking PWA.

## Local Development

```bash
npm install
npm run dev
```

Without Supabase env vars the app opens in preview mode for UI testing only. Preview data persists only in the current browser tab using sessionStorage, including across reloads. It is isolated from the signed-in account and makes no cloud writes.

## Supabase Setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL editor.
3. Create Tarae's private auth user in Supabase Auth.
4. Disable public signups in Supabase Auth settings. The app also sends magic links with account creation disabled.
5. Copy `.env.example` to `.env` and fill in:

```bash
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_ALLOWED_EMAILS=
```

There is no public signup screen in the app. Supabase row-level security restricts all user data to the signed-in user, and magic-link requests do not create new accounts.

## Upgrade Scope

- Planned daily workouts
- Large preset exercise database plus custom exercises
- Active workout sessions with exercise cards, set rows, previous performance, checkoffs, add set, swap exercise, collapse/expand, and finish workout
- Exercise detail tabs: How To, History, My Notes
- Workout-level notes
- InBody scans with Weight, SMM, PBF, and Body Fat Mass
- Full JSON export for AI planning and manual backup
- Read-only migration from legacy `elevate_workouts`, `elevate_habits`, and `elevate_metrics` localStorage keys
- Before phone deployment, create/polish the final Home Screen app logo.

## Workout companion update

- Today opens with a saved plan or a resumable active session. Completed sessions can be repeated as new editable plans.
- Save named routines from history or the planner. Routines are existing `planned_workouts` rows with `status: routine`; routine names live in the workoutDetails JSONB metadata. They are excluded from daily plans.
- Mark optional exercises in the planner to make a shorter version without altering the saved routine.
- Each checked set starts its exercise's rest timer. Set rest to zero to turn automatic timing off for that exercise. Pause, add 30 seconds, restart, skip, and undo are supported. Sound is opt-in per page session.
- Timer deadlines and actual start time are persisted in the session metadata. The countdown catches up after backgrounding or reload; background/lock-screen sound is not guaranteed. Use a device timer when a locked-phone alert is required.
- The active workout puts sets first, remembers individual set weights, supports time-only exercises, and keeps warm-up and personal setup cues available.
- Assisted pull-up progress uses completed sessions and numeric performed reps only. The best 3 x 8 milestone means the lowest recorded assistance at one consistent assistance level. It does not infer clean technique or strict unassisted capacity.
- User-scoped device snapshots and a durable outbox retain edits across connection interruptions. Writes are serialized, rapid edits coalesce, and failed writes remain queued. Reconnect, foreground, and Retry sync trigger retries. Status distinguishes device storage from cloud sync. Pending writes block sign-out. Storage failures surface an error instead of claiming success.
- The service worker caches only same-origin app shell/assets. Auth and API responses are excluded.

No AI API integration, new paid service, or database migration is required. Existing workout IDs, exercise IDs, and the external planning bridge remain compatible. Avoid concurrently editing the same session on multiple devices; cloud records retain the existing last-write-wins behavior.

Run `npm test` for timer, repeat, recovery, metadata, progression, and outbox checks. Run `npm run build` for the production bundle.
