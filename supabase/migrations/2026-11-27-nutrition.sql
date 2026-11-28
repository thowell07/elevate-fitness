-- Nutrition tracking: meal entries, saved staple foods, and daily targets.
-- Safe to run more than once. Run in the Supabase SQL editor before (or after) the app update ships;
-- the app shows "Nutrition needs a one-time database update" until these tables exist.

create table if not exists public.food_entries (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  logged_at timestamptz not null,
  meal text check (meal is null or meal in ('breakfast', 'lunch', 'dinner', 'snack')),
  source_text text,
  items jsonb not null default '[]'::jsonb,
  kcal numeric not null default 0,
  protein numeric not null default 0,
  carbs numeric not null default 0,
  fat numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.my_foods (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  aliases text[] not null default '{}',
  serving_label text,
  serving_grams numeric,
  kcal_per_100g numeric not null,
  protein_per_100g numeric not null,
  carbs_per_100g numeric not null,
  fat_per_100g numeric not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.nutrition_targets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  kcal numeric,
  protein numeric,
  carbs numeric,
  fat numeric,
  updated_at timestamptz not null default now()
);

alter table public.food_entries enable row level security;
alter table public.my_foods enable row level security;
alter table public.nutrition_targets enable row level security;

drop policy if exists "Users manage own food entries" on public.food_entries;
create policy "Users manage own food entries" on public.food_entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users manage own foods" on public.my_foods;
create policy "Users manage own foods" on public.my_foods
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users manage own nutrition targets" on public.nutrition_targets;
create policy "Users manage own nutrition targets" on public.nutrition_targets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists food_entries_user_date_idx on public.food_entries (user_id, date desc, logged_at desc);
create index if not exists my_foods_user_name_idx on public.my_foods (user_id, name);

-- PostgREST caches the schema; this makes the new tables visible to the app right away.
notify pgrst, 'reload schema';

-- InBody: trunk fat mass in pounds (the abdominal trend metric). Safe to re-run.
alter table public.metric_scans add column if not exists trunk_fat_mass numeric;

-- Reload again so the new column is visible right away.
notify pgrst, 'reload schema';
