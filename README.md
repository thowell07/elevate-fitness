# Elevate Fitness

Private, iPhone-installable workout planning and tracking PWA.

## Local Development

```bash
npm install
npm run dev
```

Without Supabase env vars the app opens in preview mode for UI testing only. Preview mode does not persist or back up data.

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
