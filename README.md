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

### Account loading recovery

Account reads use a bounded retry budget with per-attempt timeouts. Before the first successful load, a failed connection shows a recovery screen instead of zero workouts or scans. A failed refresh keeps the last device snapshot visible with a stale-data notice. Try again, returning to the app, reconnecting, and a 15-second retry check recover failed reads as well as queued saves. Save-queue success alone never clears a stale-read status. The InBody date field is constrained to its grid track for narrow Safari layouts.

## Meal logging server function

`api/log-meal.js` is a Vercel Node function served on the same origin at `POST /api/log-meal`. It takes the dictated meal (`text`), an optional `draft` to correct, and the saved foods (`myFoods`), and returns food items with grams, a weighed or eyeballed basis, the data source, and per-100 g values. Per-item macros and meal totals are computed in code from per-100 g values and grams; the model never supplies them.

- Auth: the `Authorization: Bearer <Supabase access token>` header is checked with Supabase `auth.getUser`. When `VITE_ALLOWED_EMAILS` is set, the user's email must be on it.
- Flow: a bounded tool loop (at most six model turns and 40 seconds, under the app's 45 second client timeout; `maxDuration` 60). Saved foods match first, then USDA FoodData Central lookups (Foundation, SR Legacy, Survey FNDDS), then web search for restaurant or branded items only (at most two searches), then the model's own estimate. The final answer arrives as a strict `submit_meal` tool call and is validated in code before anything is returned.
- Code lives in `api/_lib/` (`auth.js`, `usda.js`, `prompt.js`, `mealAgent.js`, `validate.js`, `macros.js`). Tests are in `tests/logMeal.test.js` and use a fake model client, so `npm test` makes no paid calls.

Server environment variables (set in Vercel, never with a `VITE_` prefix):

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Required. Claude API key. |
| `FDC_API_KEY` | USDA FoodData Central key. Falls back to `DEMO_KEY`, which is limited to a few requests per hour. |
| `MEAL_MODEL` | Default `claude-haiku-5-5`. |
| `MEAL_EFFORT` | Default `low`. Also `medium` or `high`. |
| `MEAL_WEB_SEARCH` | Set to `off` to remove web search. |
| `MEAL_WEB_SEARCH_TOOL` | Optional override of the web search tool version. |

The function also reads `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` and `VITE_ALLOWED_EMAILS`, which the project already has.

To step up to Sonnet 5.5, set `MEAL_MODEL=claude-sonnet-5-5` and redeploy. No code changes. Haiku uses the basic `web_search_20250305` tool and Sonnet uses `web_search_20260209` (dynamic filtering).

`vite dev` does not serve `/api`. Use `vercel dev` to run the function locally, or use the app's preview mode, which uses a canned parser instead of this function.
