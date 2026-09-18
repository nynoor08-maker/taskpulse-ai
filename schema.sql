create extension if not exists "uuid-ossp";

create type public.task_status as enum (
  'pending',
  'in_progress',
  'completed',
  'failed'
);

create type public.payment_status as enum (
  'unpaid',
  'paid'
);

create type public.organization_role as enum (
  'owner',
  'admin',
  'member'
);

create type public.profile_role as enum (
  'customer',
  'vendor',
  'admin'
);

create type public.task_category as enum (
  'plumbing',
  'hvac',
  'electrical',
  'roofing',
  'landscaping',
  'cleaning',
  'general_handyman'
);

create type public.task_urgency as enum (
  'emergency_immediate',
  'same_day',
  'scheduled_week'
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  phone_number text,
  role public.profile_role not null default 'customer',
  is_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create unique index profiles_phone_number_unique_idx
  on public.profiles (phone_number)
  where phone_number is not null;

create table public.organizations (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  custom_domain text unique,
  logo_url text,
  primary_color text not null default '#0f172a'
    check (primary_color ~ '^#[0-9A-Fa-f]{6}$'),
  stripe_customer_id text unique,
  created_at timestamptz not null default now()
);

create table public.organization_members (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.organization_role not null default 'member',
  created_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create table public.organization_telephony_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  vapi_api_key_secret_id uuid not null,
  vapi_phone_number_id_secret_id uuid not null,
  twilio_phone_number_secret_id uuid,
  updated_at timestamptz not null default now()
);

create table public.api_keys (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  created_by_user_id uuid not null references public.profiles(id) on delete restrict,
  key_hash text not null unique,
  name text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create table public.webhook_subscriptions (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  target_url text not null check (target_url ~ '^https://'),
  secret text not null,
  events text[] not null check (cardinality(events) > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.webhook_logs (
  id uuid primary key default uuid_generate_v4(),
  subscription_id uuid not null references public.webhook_subscriptions(id) on delete cascade,
  event_type text not null,
  payload jsonb not null,
  response_status integer,
  created_at timestamptz not null default now()
);

create table public.prompt_variants (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  system_prompt text not null,
  traffic_weight integer not null default 0 check (traffic_weight between 0 and 100),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.app_settings (
  key text primary key check (key = 'dispatch'),
  dispatch_paused boolean not null default false,
  updated_at timestamptz not null default now()
);

insert into public.app_settings (key, dispatch_paused)
values ('dispatch', false);

create table public.idempotency_keys (
  key text primary key,
  source text not null,
  created_at timestamptz not null default now()
);

create table public.tasks (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  description text,
  category public.task_category,
  urgency public.task_urgency,
  location_street_address text,
  location_zip_code text check (location_zip_code ~ '^\d{5}$'),
  location_city text,
  target_vendor_phone text,
  max_budget numeric,
  callback_url text,
  status public.task_status not null default 'pending',
  payment_status public.payment_status not null default 'unpaid',
  source text not null default 'web' check (source in ('web', 'api', 'inbound_call')),
  created_at timestamptz not null default now()
);

create table public.call_logs (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid references public.organizations(id) on delete cascade,
  task_id uuid not null references public.tasks(id) on delete cascade,
  vapi_call_id text unique,
  prompt_variant_id uuid references public.prompt_variants(id) on delete set null,
  vendor_phone text,
  transcript text,
  summary text,
  agreed_price numeric,
  available_time text,
  call_duration integer,
  status text,
  fallback_dispatched boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.tool_call_logs (
  id uuid primary key default uuid_generate_v4(),
  call_log_id uuid not null references public.call_logs(id) on delete cascade,
  tool_call_id text not null unique,
  tool_name text not null,
  succeeded boolean not null,
  created_at timestamptz not null default now()
);

create table public.call_monitor_credentials (
  call_log_id uuid primary key references public.call_logs(id) on delete cascade,
  vapi_control_url text not null,
  vapi_listen_url text
);

create table public.call_interventions (
  id uuid primary key default uuid_generate_v4(),
  call_log_id uuid not null references public.call_logs(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  initiated_by_user_id uuid not null references public.profiles(id) on delete restrict,
  action text not null check (action in ('takeover', 'mute_assistant', 'unmute_assistant', 'end_call')),
  destination_phone text,
  created_at timestamptz not null default now()
);

create table public.call_analytics (
  id uuid primary key default uuid_generate_v4(),
  call_log_id uuid not null unique references public.call_logs(id) on delete cascade,
  vendor_sentiment text not null check (vendor_sentiment in ('positive', 'neutral', 'aggressive', 'resistant')),
  negotiation_friction_points text[] not null default '{}',
  agent_politeness_score integer not null check (agent_politeness_score between 1 and 10),
  deal_closed boolean not null,
  created_at timestamptz not null default now()
);

create table public.vendors (
  id uuid primary key default uuid_generate_v4(),
  organization_id uuid references public.organizations(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  business_name text not null,
  phone_number text not null unique,
  email text,
  category public.task_category,
  service_zip_codes text[],
  hourly_rate numeric not null check (hourly_rate >= 0),
  is_accepting_jobs boolean not null default true,
  accepts_emergency_dispatch boolean not null default true,
  business_hours text,
  created_at timestamptz not null default now()
);

create table public.vendor_slots (
  id uuid primary key default uuid_generate_v4(),
  vendor_id uuid not null references public.vendors(id) on delete cascade,
  requested_date date not null,
  start_time time not null,
  end_time time not null,
  is_available boolean not null default true,
  check (end_time > start_time),
  unique (vendor_id, requested_date, start_time, end_time)
);

create index vendor_slots_vendor_id_requested_date_idx
  on public.vendor_slots (vendor_id, requested_date, start_time);

create index vendors_category_accepting_idx
  on public.vendors (category)
  where is_accepting_jobs;

create index tasks_organization_id_created_at_idx
  on public.tasks (organization_id, created_at desc);

create index call_logs_organization_id_created_at_idx
  on public.call_logs (organization_id, created_at desc);

create index tool_call_logs_call_log_id_created_at_idx
  on public.tool_call_logs (call_log_id, created_at desc);

create index call_interventions_call_log_id_created_at_idx
  on public.call_interventions (call_log_id, created_at desc);

create index prompt_variants_organization_id_idx
  on public.prompt_variants (organization_id, is_active);

create index api_keys_organization_id_idx
  on public.api_keys (organization_id);

create index webhook_subscriptions_organization_events_idx
  on public.webhook_subscriptions (organization_id)
  where is_active;

create index webhook_logs_subscription_id_created_at_idx
  on public.webhook_logs (subscription_id, created_at desc);

create type public.chat_message_role as enum (
  'user',
  'assistant',
  'system'
);

create table public.chats (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.chat_messages (
  id uuid primary key default uuid_generate_v4(),
  chat_id uuid not null references public.chats(id) on delete cascade,
  role public.chat_message_role not null,
  content text not null,
  created_at timestamptz not null default now()
);

create index chats_user_id_updated_at_idx
  on public.chats (user_id, updated_at desc);

create index chat_messages_chat_id_created_at_idx
  on public.chat_messages (chat_id, created_at asc);

create or replace function public.set_chat_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger chats_set_updated_at
  before update on public.chats
  for each row
  execute function public.set_chat_updated_at();

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.organization_telephony_settings enable row level security;
alter table public.api_keys enable row level security;
alter table public.webhook_subscriptions enable row level security;
alter table public.webhook_logs enable row level security;
alter table public.app_settings enable row level security;
alter table public.idempotency_keys enable row level security;
alter table public.tasks enable row level security;
alter table public.call_logs enable row level security;
alter table public.tool_call_logs enable row level security;
alter table public.call_monitor_credentials enable row level security;
alter table public.call_interventions enable row level security;
alter table public.prompt_variants enable row level security;
alter table public.call_analytics enable row level security;
alter table public.vendors enable row level security;
alter table public.vendor_slots enable row level security;
alter table public.chats enable row level security;
alter table public.chat_messages enable row level security;

create or replace function public.launch_readiness_rls_status()
returns table (table_name text, rls_enabled boolean)
language sql
stable
security definer
set search_path = public, pg_catalog
as $$
  select tablename::text, rowsecurity
  from pg_tables
  where schemaname = 'public'
    and tablename in (
      'organizations', 'organization_members', 'profiles', 'tasks', 'vendors', 'call_logs',
      'prompt_variants', 'call_analytics', 'webhook_subscriptions', 'api_keys',
      'app_settings', 'idempotency_keys'
    )
  order by tablename;
$$;

revoke all on function public.launch_readiness_rls_status() from public;
grant execute on function public.launch_readiness_rls_status() to service_role;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_admin from public.profiles where id = (select auth.uid())),
    false
  );
$$;

create or replace function public.is_organization_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members
    where organization_id = p_organization_id
      and user_id = (select auth.uid())
  );
$$;

create or replace function public.can_manage_organization(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_members
    where organization_id = p_organization_id
      and user_id = (select auth.uid())
      and role in ('owner', 'admin')
  );
$$;

create policy "Anyone can view organization branding"
  on public.organizations
  for select
  using (true);

create policy "Users can view their own profile"
  on public.profiles
  for select
  to authenticated
  using ((select auth.uid()) = id);

create policy "Users can insert their own profile"
  on public.profiles
  for insert
  to authenticated
  with check (
    (select auth.uid()) = id
    and role = 'customer'
    and is_admin = false
  );

create policy "Users can update their own profile"
  on public.profiles
  for update
  to authenticated
  using ((select auth.uid()) = id)
  with check (
    (select auth.uid()) = id
    and role = (select role from public.profiles where id = (select auth.uid()))
    and is_admin = (select is_admin from public.profiles where id = (select auth.uid()))
  );

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, is_admin)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    'customer',
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row
  execute function public.handle_new_user();

update public.profiles
set role = 'admin'
where is_admin = true;

create policy "Members can view their organization memberships"
  on public.organization_members
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Organization managers can manage memberships"
  on public.organization_members
  for all
  to authenticated
  using ((select public.can_manage_organization(organization_id)))
  with check ((select public.can_manage_organization(organization_id)));

create policy "Organization managers can view telephony settings"
  on public.organization_telephony_settings
  for select
  to authenticated
  using ((select public.can_manage_organization(organization_id)));

create policy "Organization managers can view API keys"
  on public.api_keys
  for select
  to authenticated
  using ((select public.can_manage_organization(organization_id)));

create policy "Organization managers can manage prompt variants"
  on public.prompt_variants
  for all
  to authenticated
  using ((select public.can_manage_organization(organization_id)))
  with check ((select public.can_manage_organization(organization_id)));

create policy "Organization members can view call analytics"
  on public.call_analytics
  for select
  to authenticated
  using (
    exists (
      select 1 from public.call_logs
      where call_logs.id = call_analytics.call_log_id
        and public.is_organization_member(call_logs.organization_id)
    )
  );

create policy "Organization managers can view call interventions"
  on public.call_interventions
  for select
  to authenticated
  using ((select public.can_manage_organization(organization_id)));

create policy "Organization managers can revoke API keys"
  on public.api_keys
  for delete
  to authenticated
  using ((select public.can_manage_organization(organization_id)));

create policy "Organization managers can manage webhook subscriptions"
  on public.webhook_subscriptions
  for all
  to authenticated
  using ((select public.can_manage_organization(organization_id)))
  with check ((select public.can_manage_organization(organization_id)));

create policy "Organization managers can view webhook logs"
  on public.webhook_logs
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.webhook_subscriptions
      where webhook_subscriptions.id = webhook_logs.subscription_id
        and public.can_manage_organization(webhook_subscriptions.organization_id)
    )
  );

create policy "Organization members can view organization tasks"
  on public.tasks
  for select
  to authenticated
  using ((select public.is_organization_member(organization_id)));

create policy "Organization members can create organization tasks"
  on public.tasks
  for insert
  to authenticated
  with check ((select public.is_organization_member(organization_id)));

create policy "Organization members can view organization call logs"
  on public.call_logs
  for select
  to authenticated
  using ((select public.is_organization_member(organization_id)));

create policy "Organization members can view organization vendors"
  on public.vendors
  for select
  to authenticated
  using ((select public.is_organization_member(organization_id)));

create policy "Organization managers can manage organization vendors"
  on public.vendors
  for all
  to authenticated
  using ((select public.can_manage_organization(organization_id)))
  with check ((select public.can_manage_organization(organization_id)));

create or replace function public.update_organization_telephony(
  p_organization_id uuid,
  p_vapi_api_key text,
  p_vapi_phone_number_id text,
  p_twilio_phone_number text default null
)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_vapi_api_key_secret_id uuid;
  v_vapi_phone_number_id_secret_id uuid;
  v_twilio_phone_number_secret_id uuid;
begin
  if not public.can_manage_organization(p_organization_id) then
    raise exception 'Organization administrator access is required.';
  end if;

  select vault.create_secret(
    p_vapi_api_key,
    'organization-' || p_organization_id || '-vapi-api-key',
    'Tenant Vapi API key'
  ) into v_vapi_api_key_secret_id;
  select vault.create_secret(
    p_vapi_phone_number_id,
    'organization-' || p_organization_id || '-vapi-phone-number-id',
    'Tenant Vapi phone number ID'
  ) into v_vapi_phone_number_id_secret_id;

  if p_twilio_phone_number is not null then
    select vault.create_secret(
      p_twilio_phone_number,
      'organization-' || p_organization_id || '-twilio-phone-number',
      'Tenant Twilio sender phone number'
    ) into v_twilio_phone_number_secret_id;
  end if;

  insert into public.organization_telephony_settings (
    organization_id,
    vapi_api_key_secret_id,
    vapi_phone_number_id_secret_id,
    twilio_phone_number_secret_id
  )
  values (
    p_organization_id,
    v_vapi_api_key_secret_id,
    v_vapi_phone_number_id_secret_id,
    v_twilio_phone_number_secret_id
  )
  on conflict (organization_id) do update
  set
    vapi_api_key_secret_id = excluded.vapi_api_key_secret_id,
    vapi_phone_number_id_secret_id = excluded.vapi_phone_number_id_secret_id,
    twilio_phone_number_secret_id = excluded.twilio_phone_number_secret_id,
    updated_at = now();
end;
$$;

create or replace function public.get_organization_telephony(
  p_organization_id uuid
)
returns table (
  vapi_api_key text,
  vapi_phone_number_id text,
  twilio_phone_number text
)
language sql
security definer
set search_path = public, vault
as $$
  select
    vapi_key.secret as vapi_api_key,
    vapi_phone.secret as vapi_phone_number_id,
    twilio_phone.secret as twilio_phone_number
  from public.organization_telephony_settings settings
  join vault.decrypted_secrets vapi_key
    on vapi_key.id = settings.vapi_api_key_secret_id
  join vault.decrypted_secrets vapi_phone
    on vapi_phone.id = settings.vapi_phone_number_id_secret_id
  left join vault.decrypted_secrets twilio_phone
    on twilio_phone.id = settings.twilio_phone_number_secret_id
  where settings.organization_id = p_organization_id;
$$;

revoke all on function public.get_organization_telephony(uuid) from public;
grant execute on function public.get_organization_telephony(uuid) to service_role;

create policy "Admins can view application settings"
  on public.app_settings
  for select
  to authenticated
  using ((select public.is_admin()));

create policy "Admins can update application settings"
  on public.app_settings
  for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "Users can view their own tasks"
  on public.tasks
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can insert their own tasks"
  on public.tasks
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and (
      organization_id is null
      or (select public.is_organization_member(organization_id))
    )
  );

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

create policy "Users can view their own tool call logs"
  on public.tool_call_logs
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.call_logs
      join public.tasks on tasks.id = call_logs.task_id
      where call_logs.id = tool_call_logs.call_log_id
        and tasks.user_id = (select auth.uid())
    )
  );

create policy "Admins can view all tasks"
  on public.tasks
  for select
  to authenticated
  using ((select public.is_admin()));

create policy "Admins can view all call logs"
  on public.call_logs
  for select
  to authenticated
  using ((select public.is_admin()));

create policy "Users can view their own vendors"
  on public.vendors
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can manage their own vendors"
  on public.vendors
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can view slots for their own vendors"
  on public.vendor_slots
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.vendors
      where public.vendors.id = vendor_slots.vendor_id
        and public.vendors.user_id = (select auth.uid())
    )
  );

create policy "Users can manage slots for their own vendors"
  on public.vendor_slots
  for all
  to authenticated
  using (
    exists (
      select 1
      from public.vendors
      where public.vendors.id = vendor_slots.vendor_id
        and public.vendors.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.vendors
      where public.vendors.id = vendor_slots.vendor_id
        and public.vendors.user_id = (select auth.uid())
    )
  );

create policy "Users can view their own chats"
  on public.chats
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own chats"
  on public.chats
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own chats"
  on public.chats
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own chats"
  on public.chats
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can view messages in their own chats"
  on public.chat_messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.chats
      where public.chats.id = chat_messages.chat_id
        and public.chats.user_id = (select auth.uid())
    )
  );

create policy "Users can create messages in their own chats"
  on public.chat_messages
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.chats
      where public.chats.id = chat_messages.chat_id
        and public.chats.user_id = (select auth.uid())
    )
  );
