create extension if not exists "uuid-ossp";

create type public.task_status as enum (
  'pending',
  'in_progress',
  'completed',
  'failed'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  phone_number text,
  created_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  target_vendor_phone text,
  max_budget numeric,
  status public.task_status not null default 'pending',
  created_at timestamptz not null default now()
);

create table public.call_logs (
  id uuid primary key default uuid_generate_v4(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  vapi_call_id text unique,
  transcript text,
  summary text,
  agreed_price numeric,
  call_duration integer,
  status text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.tasks enable row level security;
alter table public.call_logs enable row level security;

create policy "Users can view their own tasks"
  on public.tasks
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own tasks"
  on public.tasks
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can view their own call logs"
  on public.call_logs
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.tasks
      where public.tasks.id = call_logs.task_id
        and public.tasks.user_id = (select auth.uid())
    )
  );
