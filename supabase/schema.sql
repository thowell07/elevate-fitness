create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.custom_exercises (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  group_name text not null,
  equipment text,
  primary_muscles text[] not null default '{}',
  secondary_muscles text[] not null default '{}',
  instructions text,
  default_sets integer not null default 3,
  default_reps text,
  default_rest_seconds integer not null default 90,
  tracking text not null default 'weight_reps',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.planned_workouts (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  title text not null,
  status text not null default 'planned',
  notes text,
  exercises jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workout_sessions (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  planned_workout_id text references public.planned_workouts(id) on delete set null,
  date_started timestamptz not null,
  date_completed timestamptz,
  status text not null default 'active',
  notes text,
  exercise_logs jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.exercise_notes (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  exercise_id text not null,
  note text,
  updated_at timestamptz not null default now()
);

create table if not exists public.metric_scans (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  weight numeric,
  skeletal_muscle_mass numeric,
  percent_body_fat numeric,
  body_fat_mass numeric,
  created_at timestamptz not null default now()
);

create table if not exists public.habit_logs (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  habit_id text not null,
  completed boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (user_id, date, habit_id)
);

alter table public.profiles enable row level security;
alter table public.custom_exercises enable row level security;
alter table public.planned_workouts enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.exercise_notes enable row level security;
alter table public.metric_scans enable row level security;
alter table public.habit_logs enable row level security;

create policy "Users can read own profile" on public.profiles
  for select using (auth.uid() = id);
create policy "Users can update own profile" on public.profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "Users manage own custom exercises" on public.custom_exercises
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage own planned workouts" on public.planned_workouts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage own workout sessions" on public.workout_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage own exercise notes" on public.exercise_notes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage own metric scans" on public.metric_scans
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "Users manage own habit logs" on public.habit_logs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (new.id, new.email, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create index if not exists planned_workouts_user_date_idx on public.planned_workouts (user_id, date desc);
create index if not exists workout_sessions_user_started_idx on public.workout_sessions (user_id, date_started desc);
create index if not exists metric_scans_user_date_idx on public.metric_scans (user_id, date desc);
create index if not exists habit_logs_user_date_idx on public.habit_logs (user_id, date desc);
