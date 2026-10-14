-- Genlixs 01 · Foundation: extensions, private schema, settings, identity, staff capabilities, audit.
-- Conventions (backend guide §8): UUID ids, UTC timestamptz, integer credit units (bigint) and integer
-- minor money units, append-only journals. Customer-visible tables live in `public` behind RLS;
-- raw provider/billing/queue/staff data lives in `app_private`, which the Data API roles cannot reach.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pgmq;
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to service_role;

-- Functions created by the migration owner are not executable by everyone unless granted on purpose.
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema app_private revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------- helpers

create or replace function app_private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function app_private.forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'append-only journal: % on % is not allowed', tg_op, tg_table_name
    using errcode = 'P0001';
end;
$$;

-- Raises a business error the API maps to an HTTP status (code is read from the message prefix).
create or replace function app_private.fail(p_code text, p_message text, p_details jsonb default '{}'::jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%', p_code
    using errcode = 'P0001', detail = p_message, hint = p_details::text;
end;
$$;

-- Short human-friendly reference, e.g. J-7Q2KD (not a security token).
create or replace function app_private.short_ref(p_prefix text)
returns text
language sql
volatile
set search_path = ''
as $$
  select p_prefix || '-' || upper(substr(translate(encode(extensions.gen_random_bytes(6), 'base64'), '+/=0O1Il', 'XYZABCDE'), 1, 6));
$$;

-- ------------------------------------------------------------ settings

-- Operational switches and versioned policy values. Business prices and rates live in their own
-- versioned tables; these are intake controls and engineering defaults (guide §1.3, §6).
create table app_private.settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

insert into app_private.settings (key, value, description) values
  ('generation_paused', 'false', 'Emergency stop for new quotes and submissions'),
  ('quote_ttl_seconds', '300', 'Quote validity (proposed default: 5 minutes)'),
  ('reservation_deadline_hours', '24', 'Maximum unresolved customer reservation (proposed)'),
  ('delayed_after_minutes', '30', 'Show "taking longer than usual" after (proposed)'),
  ('max_active_jobs_per_user', '3', 'Concurrent queued/running jobs per customer'),
  ('max_quotes_per_minute', '30', 'Quote requests per customer per minute'),
  ('provider_create_budget_per_10s', '10', 'Account-wide KIE create budget (documented limit is 20 per 10 s)'),
  ('output_retention_days', '90', 'Stored customer outputs (proposed)'),
  ('reference_retention_days', '7', 'Reference uploads after the last dependent job ends (proposed)'),
  ('promo_credit_days', '7', 'Promotional credit expiry (proposed)'),
  ('owner_bootstrap_open', 'true', 'One-time owner bootstrap switch; closes after first use');

create or replace function app_private.setting(p_key text)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select value from app_private.settings where key = p_key;
$$;

-- ------------------------------------------------------------ profiles

-- user_id equals auth.users.id at creation. There is deliberately no cascading FK to auth.users:
-- deleting an Auth identity must never erase payment, credit, commission or payout evidence (§22.2).
create table public.profiles (
  user_id uuid primary key,
  email text,
  display_name text check (char_length(display_name) <= 80),
  locale text not null default 'en' check (locale in ('en', 'ar', 'fr')),
  account_status text not null default 'active' check (account_status in ('active', 'suspended', 'deleted')),
  suspension_reason text,
  marketing_opt_in boolean not null default false,
  email_notifications boolean not null default true,
  goal text check (goal in ('social', 'product', 'concepts', 'other')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_touch before update on public.profiles
  for each row execute function app_private.touch_updated_at();

alter table public.profiles enable row level security;

create policy profiles_owner_read on public.profiles
  for select to authenticated
  using ((select auth.uid()) = user_id);

-- Customers change only allowlisted fields, through update_my_profile().
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

-- ------------------------------------------------------- staff and roles

create table app_private.staff_capabilities (
  role text not null check (role in ('support', 'operations', 'finance', 'owner')),
  capability text not null,
  primary key (role, capability)
);

insert into app_private.staff_capabilities (role, capability)
select r, c from (values
  ('support', 'admin.access'), ('support', 'support.read'), ('support', 'support.reply'), ('support', 'jobs.read'),
  ('support', 'users.read'),
  ('operations', 'admin.access'), ('operations', 'jobs.read'), ('operations', 'jobs.operate'), ('operations', 'catalog.operate'),
  ('operations', 'support.read'), ('operations', 'users.read'), ('operations', 'reports.read'), ('operations', 'affiliates.fraud'),
  ('finance', 'admin.access'), ('finance', 'jobs.read'), ('finance', 'credits.adjust'), ('finance', 'billing.read'),
  ('finance', 'billing.refund'), ('finance', 'pricing.review'), ('finance', 'affiliates.review'), ('finance', 'payouts.prepare'),
  ('finance', 'payouts.approve'), ('finance', 'reports.read'), ('finance', 'users.read'), ('finance', 'audit.read')
) as t(r, c);

-- The owner holds every capability, including staff management and catalog publication.
insert into app_private.staff_capabilities (role, capability)
select distinct 'owner', capability from app_private.staff_capabilities
union select 'owner', c from (values ('staff.manage'), ('catalog.publish'), ('audit.read'), ('settings.manage')) v(c)
on conflict do nothing;

create table app_private.staff_memberships (
  user_id uuid not null,
  role text not null check (role in ('support', 'operations', 'finance', 'owner')),
  active boolean not null default true,
  assigned_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, role)
);

create trigger staff_memberships_touch before update on app_private.staff_memberships
  for each row execute function app_private.touch_updated_at();

-- Never derived from email domains, routes or editable user metadata (§7.1).
create or replace function app_private.has_capability(p_user uuid, p_capability text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1
    from app_private.staff_memberships m
    join app_private.staff_capabilities c on c.role = m.role
    where m.user_id = p_user and m.active and c.capability = p_capability
  );
$$;

create or replace function public.my_capabilities()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct c.capability order by c.capability), '{}')
  from app_private.staff_memberships m
  join app_private.staff_capabilities c on c.role = m.role
  where m.user_id = (select auth.uid()) and m.active;
$$;
revoke execute on function public.my_capabilities() from public, anon;
grant execute on function public.my_capabilities() to authenticated;

create or replace function app_private.require_capability(p_capability text)
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    perform app_private.fail('UNAUTHENTICATED', 'Sign in to continue.');
  end if;
  if not app_private.has_capability(v_uid, p_capability) then
    perform app_private.fail('FORBIDDEN', 'Your role does not allow this action.', jsonb_build_object('capability', p_capability));
  end if;
  return v_uid;
end;
$$;

-- ------------------------------------------------------------------ audit

create table app_private.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  capability text,
  action text not null,
  target_kind text not null,
  target_id text,
  reason text,
  before_state jsonb,
  after_state jsonb,
  request_id text,
  created_at timestamptz not null default now()
);
create index admin_audit_logs_target_idx on app_private.admin_audit_logs (target_kind, target_id, created_at desc);
create index admin_audit_logs_created_idx on app_private.admin_audit_logs (created_at desc);

create trigger admin_audit_logs_append_only before update or delete on app_private.admin_audit_logs
  for each row execute function app_private.forbid_mutation();

create or replace function app_private.audit(
  p_actor uuid, p_capability text, p_action text, p_target_kind text, p_target_id text,
  p_reason text, p_before jsonb default null, p_after jsonb default null
) returns void
language sql
set search_path = ''
as $$
  insert into app_private.admin_audit_logs (actor_id, capability, action, target_kind, target_id, reason, before_state, after_state)
  values (p_actor, p_capability, p_action, p_target_kind, p_target_id, p_reason, p_before, p_after);
$$;

-- One-time owner bootstrap (§7.2). Run once from the SQL editor/MCP after the owner signs up:
--   select app_private.bootstrap_owner('owner@example.com');
-- It closes itself; later role changes go through admin_set_staff_role() with audit.
create or replace function app_private.bootstrap_owner(p_email text)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_uid uuid;
begin
  if coalesce((app_private.setting('owner_bootstrap_open'))::text, 'false') <> 'true' then
    raise exception 'owner bootstrap is closed';
  end if;
  select id into v_uid from auth.users where lower(email) = lower(p_email) and email_confirmed_at is not null;
  if v_uid is null then
    raise exception 'no verified account with that email';
  end if;
  insert into app_private.staff_memberships (user_id, role, active, assigned_by) values (v_uid, 'owner', true, v_uid)
    on conflict (user_id, role) do update set active = true;
  update app_private.settings set value = 'false', updated_at = now() where key = 'owner_bootstrap_open';
  perform app_private.audit(v_uid, 'bootstrap', 'staff.bootstrap_owner', 'user', v_uid::text, 'one-time owner bootstrap');
  return v_uid;
end;
$$;
