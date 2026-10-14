-- Genlixs 11 · Admin catalog upgrade, schema part: model metadata and verification status, implemented adapters,
-- immutable supplier cost versions, price-version provenance, pricing batches, private staff test runs, provider
-- balance history, new staff capabilities and pricing assumptions. Additive only; existing rows keep their meaning.

-- ------------------------------------------------------------ capabilities

-- catalog.test: run paid private tests (spends the owner's KIE balance). provider.read: KIE balance, spend, costs.
-- Customers and partners never hold staff capabilities.
insert into app_private.staff_capabilities (role, capability) values
  ('operations', 'catalog.test'), ('owner', 'catalog.test'),
  ('operations', 'provider.read'), ('finance', 'provider.read'), ('owner', 'provider.read')
on conflict do nothing;

-- ---------------------------------------------------------- model metadata

alter table app_private.model_catalog
  add column family text,
  add column variant_label text,
  add column badges text[] not null default '{}',
  add column provider_docs_url text,
  add column provider_pricing_url text,
  add column source_checked_at timestamptz,
  -- Real verification state. Only a completed integrated test (or separately identified manual evidence) changes it.
  add column verification_status text not null default 'untested',
  add column verified_capability_version_id uuid references app_private.model_capability_versions (id),
  -- Why the model was last made available: a verified test, manual evidence, or the owner's documented-cost decision.
  add column enable_basis text,
  add column availability_changed_at timestamptz,
  add column availability_changed_by uuid;

alter table app_private.model_catalog
  add constraint model_catalog_verification_status_check
    check (verification_status in ('untested', 'verified_by_test', 'manual_evidence', 'test_failed')),
  add constraint model_catalog_badges_check
    check (badges <@ array['recommended', 'premium', 'budget', 'fast', 'long']::text[]),
  add constraint model_catalog_enable_basis_check
    check (enable_basis is null or enable_basis in ('verified_test', 'manual_evidence', 'documented_cost'));

-- Adapters implemented by the application release that ships with this migration. Enabling and testing require
-- the model's adapter to be listed here (a contract test keeps this list equal to the code).
create table app_private.provider_adapters (
  adapter text primary key,
  provider text not null check (provider in ('kie', 'fake')),
  description text not null,
  added_at timestamptz not null default now()
);

insert into app_private.provider_adapters (adapter, provider, description) values
  ('kie-market-image', 'kie', 'Market text-to-image: prompt, aspect_ratio, resolution'),
  ('kie-market-image-edit', 'kie', 'Market image edit: prompt, input_urls, aspect_ratio, resolution'),
  ('kie-market-veo', 'kie', 'Veo 3.1 text-to-video: tier, aspect_ratio, resolution, duration'),
  ('kie-nano-banana', 'kie', 'Nano Banana: prompt, image_input, aspect_ratio, resolution, output_format'),
  ('kie-flux-2', 'kie', 'FLUX.2: prompt, input_urls, aspect_ratio, resolution, nsfw_checker'),
  ('kie-seedream-5', 'kie', 'Seedream 5.0: prompt, image_urls, aspect_ratio, size, output_format, nsfw_checker'),
  ('kie-kling-3', 'kie', 'Kling 3.0 single-shot: prompt, mode, sound, duration, aspect_ratio'),
  ('kie-seedance-2', 'kie', 'Seedance 2.x text-to-video: prompt, resolution, generate_audio, duration, aspect_ratio'),
  ('kie-wan-2-6', 'kie', 'Wan 2.6 text-to-video: prompt, resolution, duration');

alter table app_private.provider_adapters enable row level security;

-- ------------------------------------------------------ supplier costs

-- Supplier cost schedule in KIE credits, versioned and immutable. A change is a new version with its own source.
-- schedule = {
--   "unit": "output" | "second",            -- per delivered output, or per output second (uses durationOption)
--   "durationOption": "duration",           -- option holding seconds when unit = second
--   "dims": ["resolution", ...],            -- options that select the rate
--   "rates": {"<dim values joined by |>": <KIE credits>},
--   "extraReference": {"free": 1, "credits": 0.5}   -- optional per additional input image
-- }
-- A configuration without a rate has NO known cost; it is never treated as zero.
create table app_private.supplier_cost_versions (
  id uuid primary key default gen_random_uuid(),
  model_id text not null references app_private.model_catalog (id),
  version int not null,
  schedule jsonb not null,
  usd_per_credit numeric(12, 6) not null check (usd_per_credit > 0),
  source_kind text not null check (source_kind in ('documented', 'manual', 'observed')),
  source_url text,
  source_checked_at timestamptz not null,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (model_id, version),
  check (schedule ? 'rates' and schedule ? 'unit' and schedule ? 'dims')
);
create trigger supplier_cost_versions_immutable before update or delete on app_private.supplier_cost_versions
  for each row execute function app_private.forbid_mutation();
alter table app_private.supplier_cost_versions enable row level security;

-- ------------------------------------------------------- price provenance

alter table app_private.price_versions
  add column source text not null default 'manual' check (source in ('seed', 'manual', 'bulk', 'restore')),
  add column batch_id uuid,
  add column supplier_cost_version_id uuid references app_private.supplier_cost_versions (id),
  add column markup_bps int check (markup_bps is null or markup_bps >= 0),
  add column basis jsonb,
  add column restored_from uuid references app_private.price_versions (id);

-- The launch drafts were placeholders, not owner decisions: mark them so bulk pricing may replace them.
update app_private.price_versions set source = 'seed' where state = 'draft' and cost_evidence like 'DRAFT%';

-- -------------------------------------------------------- pricing batches

create table app_private.pricing_batches (
  id uuid primary key default gen_random_uuid(),
  short_ref text not null unique default app_private.short_ref('PB'),
  kind text not null check (kind in ('generation', 'restore', 'manual')),
  action text not null check (action in ('draft', 'publish')),
  scope jsonb not null,
  markup_bps int,
  include_overrides boolean not null default false,
  preview_revision text,
  basis jsonb not null default '{}'::jsonb,
  actor_id uuid not null,
  created_at timestamptz not null default now()
);
create trigger pricing_batches_append_only before update or delete on app_private.pricing_batches
  for each row execute function app_private.forbid_mutation();

create table app_private.pricing_batch_items (
  batch_id uuid not null references app_private.pricing_batches (id),
  model_id text not null references app_private.model_catalog (id),
  old_price_version_id uuid references app_private.price_versions (id),
  new_price_version_id uuid not null references app_private.price_versions (id),
  old_rules jsonb,
  new_rules jsonb not null,
  supplier_cost_version_id uuid references app_private.supplier_cost_versions (id),
  summary jsonb not null default '{}'::jsonb,
  primary key (batch_id, model_id)
);
create index pricing_batch_items_model_idx on app_private.pricing_batch_items (model_id);
create index pricing_batch_items_new_idx on app_private.pricing_batch_items (new_price_version_id);
create index pricing_batch_items_old_idx on app_private.pricing_batch_items (old_price_version_id);
create index pricing_batch_items_cost_idx on app_private.pricing_batch_items (supplier_cost_version_id);
create trigger pricing_batch_items_append_only before update or delete on app_private.pricing_batch_items
  for each row execute function app_private.forbid_mutation();
alter table app_private.pricing_batches enable row level security;
alter table app_private.pricing_batch_items enable row level security;

alter table app_private.price_versions
  add constraint price_versions_batch_fk foreign key (batch_id) references app_private.pricing_batches (id);
create index price_versions_batch_idx on app_private.price_versions (batch_id);
create index price_versions_cost_idx on app_private.price_versions (supplier_cost_version_id);
create index price_versions_restored_idx on app_private.price_versions (restored_from);
create index supplier_cost_versions_model_idx on app_private.supplier_cost_versions (model_id, version desc);

-- --------------------------------------------------------- staff tests

-- Private staff tests reuse quotes, jobs, queues, attempts, observations and imports. They never reserve or
-- charge a customer wallet (units = 0, no reservation), create no billing order and generate no commission.
alter table public.generation_quotes
  add column purpose text not null default 'customer' check (purpose in ('customer', 'staff_test'));
alter table public.generation_jobs
  add column purpose text not null default 'customer' check (purpose in ('customer', 'staff_test'));
alter table public.assets
  add column purpose text not null default 'customer' check (purpose in ('customer', 'staff_test'));

alter table public.generation_quotes
  add constraint generation_quotes_units_purpose_check check (units > 0 or (purpose = 'staff_test' and units = 0)),
  add constraint generation_quotes_price_purpose_check check (price_version_id is not null or purpose = 'staff_test');
alter table public.generation_jobs
  add constraint generation_jobs_units_purpose_check check (units > 0 or (purpose = 'staff_test' and units = 0)),
  add constraint generation_jobs_price_purpose_check check (price_version_id is not null or purpose = 'staff_test');
alter table public.generation_quotes drop constraint generation_quotes_units_check;
alter table public.generation_jobs drop constraint generation_jobs_units_check;
alter table public.generation_quotes alter column price_version_id drop not null;
alter table public.generation_jobs alter column price_version_id drop not null;

create index generation_jobs_staff_test_idx on public.generation_jobs (model_id, created_at desc) where purpose = 'staff_test';

create table app_private.model_test_runs (
  job_id uuid primary key references public.generation_jobs (id),
  model_id text not null references app_private.model_catalog (id),
  capability_version_id uuid not null references app_private.model_capability_versions (id),
  adapter text not null,
  adapter_version int not null,
  requested_by uuid not null,
  input jsonb not null,
  supplier_cost_version_id uuid references app_private.supplier_cost_versions (id),
  estimated_supplier_credits numeric,
  status text not null default 'running' check (status in ('running', 'succeeded', 'failed', 'cancelled')),
  task_id text,
  observed_supplier_credits numeric,
  cost_provenance text,
  failure_code text,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index model_test_runs_model_idx on app_private.model_test_runs (model_id, created_at desc);
create index model_test_runs_cost_idx on app_private.model_test_runs (supplier_cost_version_id);
create index model_test_runs_cap_idx on app_private.model_test_runs (capability_version_id);
alter table app_private.model_test_runs enable row level security;

-- A finished test run is evidence: it can be written once when the job settles, then never changed.
create or replace function app_private.model_test_runs_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'test runs are evidence and cannot be deleted';
  end if;
  if old.status <> 'running' then
    raise exception 'a settled test run is immutable';
  end if;
  if new.job_id <> old.job_id or new.model_id <> old.model_id or new.input <> old.input
     or new.estimated_supplier_credits is distinct from old.estimated_supplier_credits then
    raise exception 'test run inputs are immutable';
  end if;
  return new;
end;
$$;
create trigger model_test_runs_guard before update or delete on app_private.model_test_runs
  for each row execute function app_private.model_test_runs_guard();

-- Verification evidence, append-only. Integrated tests and manual/imported evidence stay separately identified.
create table app_private.model_verification_evidence (
  id uuid primary key default gen_random_uuid(),
  model_id text not null references app_private.model_catalog (id),
  capability_version_id uuid references app_private.model_capability_versions (id),
  kind text not null check (kind in ('integrated_test', 'manual')),
  outcome text not null check (outcome in ('passed', 'failed', 'recorded')),
  test_job_id uuid references public.generation_jobs (id),
  task_id text,
  note text,
  recorded_by uuid,
  recorded_at timestamptz not null default now()
);
create index model_verification_evidence_model_idx on app_private.model_verification_evidence (model_id, recorded_at desc);
create index model_verification_evidence_job_idx on app_private.model_verification_evidence (test_job_id);
create index model_verification_evidence_cap_idx on app_private.model_verification_evidence (capability_version_id);
create trigger model_verification_evidence_append_only before update or delete on app_private.model_verification_evidence
  for each row execute function app_private.forbid_mutation();
alter table app_private.model_verification_evidence enable row level security;

-- Test outputs are marked so customer views (library, shares) never list them.
create or replace function app_private.assets_mark_staff_test()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.job_id is not null and exists (select 1 from public.generation_jobs j where j.id = new.job_id and j.purpose = 'staff_test') then
    new.purpose := 'staff_test';
  end if;
  return new;
end;
$$;
create trigger assets_mark_staff_test before insert on public.assets
  for each row execute function app_private.assets_mark_staff_test();

-- Staff tests never send customer notifications ("your image is ready", "generation failed").
create or replace function app_private.notifications_skip_staff_tests()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.event_key ~ '^job_[a-z_]+:[0-9a-f-]{36}$'
     and exists (select 1 from public.generation_jobs j where j.id = split_part(new.event_key, ':', 2)::uuid and j.purpose = 'staff_test') then
    return null;
  end if;
  return new;
end;
$$;
create trigger notifications_skip_staff_tests before insert on public.notifications
  for each row execute function app_private.notifications_skip_staff_tests();

-- ---------------------------------------------------- provider balance

alter table app_private.provider_accounts
  add column last_balance_attempt_at timestamptz,
  add column last_balance_error text,
  add column last_balance_error_at timestamptz;

-- Every real balance read, successful or not. A failed read stores the error, never a zero.
create table app_private.provider_balance_snapshots (
  id bigint generated always as identity primary key,
  provider_account_id uuid not null references app_private.provider_accounts (id),
  ok boolean not null,
  credits numeric,
  error_code text,
  source text not null check (source in ('admin', 'auto', 'worker')),
  observed_at timestamptz not null default now(),
  check ((ok and credits is not null) or (not ok and credits is null))
);
create index provider_balance_snapshots_idx on app_private.provider_balance_snapshots (provider_account_id, observed_at desc);
alter table app_private.provider_balance_snapshots enable row level security;

-- ------------------------------------------------------ pricing settings

-- Unknown values are JSON null and are shown as unknown, never as zero.
insert into app_private.settings (key, value, description) values
  ('kie_usd_per_credit', '0.005', 'KIE standard rate per credit (kie.ai pricing and billing pages, checked 2026-10-14). Larger top-ups add 5–10 % bonus credits, so the effective rate paid can be lower.'),
  ('pricing_payment_fee_bps', 'null', 'Variable payment fee in basis points of the package price (unknown until a gateway is chosen)'),
  ('pricing_payment_fixed_fee_usd', 'null', 'Fixed payment fee per order in USD (unknown until a gateway is chosen)'),
  ('pricing_operating_cost_usd_per_job', 'null', 'Estimated operating cost per generation in USD (storage, bandwidth, compute); unknown until measured'),
  ('supplier_cost_stale_days', '30', 'Supplier cost sources older than this are highlighted as stale'),
  ('provider_balance_min_refresh_seconds', '30', 'Minimum interval between live KIE balance reads (shared by all staff)')
on conflict (key) do nothing;
