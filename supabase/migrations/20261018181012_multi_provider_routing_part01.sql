-- Genlixs 25 · Multi-provider routing (18 Oct 2026).
--
-- One public model (app_private.model_catalog) can now be served by several supplier offers. The server routes each
-- job to the cheapest eligible offer for its exact settings, records why, and keeps an internal supplier-cost ledger.
-- Keys are stored in Supabase Vault through owner-only functions; only the service role can read a decrypted key.
--
-- Additive and behaviour-preserving: every existing model gets one "legacy primary" KIE offer whose cost comes from
-- the existing supplier cost versions, so routing picks KIE exactly as before until an owner activates another offer.
-- Old jobs, attempts, outputs, credit ledgers and customer prices are untouched. The previous submit function
-- (worker_begin_submission) stays for the release that is still running while this migration is applied.

-- ================================================================ providers

alter table app_private.provider_accounts drop constraint provider_accounts_provider_check;
alter table app_private.provider_accounts add constraint provider_accounts_provider_check
  check (provider in ('kie', 'fake', 'duomi', 'poyo', 'nezhagate', 'cuddler', 'apimart'));
alter table app_private.provider_adapters drop constraint provider_adapters_provider_check;
alter table app_private.provider_adapters add constraint provider_adapters_provider_check
  check (provider in ('kie', 'fake', 'duomi', 'poyo', 'nezhagate', 'cuddler', 'apimart'));

-- Conversion of each supplier unit to USD, versioned. "units_per_usd" keeps the published ratio exact
-- (200 KIE credits = 1 USD; 6.70 CNY = 1 USD is an illustration, not a live rate).
create table app_private.cost_unit_versions (
  id uuid primary key default gen_random_uuid(),
  unit text not null check (unit ~ '^[a-z][a-z0-9_]{1,30}$'),
  version int not null,
  label text not null,
  units_per_usd numeric(24, 10) not null check (units_per_usd > 0),
  basis text not null check (basis in ('fixed', 'documented', 'illustrative', 'manual')),
  source_url text,
  checked_at timestamptz not null,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (unit, version)
);
create trigger cost_unit_versions_immutable before update or delete on app_private.cost_unit_versions
  for each row execute function app_private.forbid_mutation();
alter table app_private.cost_unit_versions enable row level security;

insert into app_private.cost_unit_versions (unit, version, label, units_per_usd, basis, source_url, checked_at, note) values
  ('usd', 1, 'US dollar', 1, 'fixed', null, '2026-10-18', null),
  ('kie_credit', 1, 'KIE credit', 200, 'documented', 'https://kie.ai/pricing', '2026-10-18', 'Standard rate $0.005 per credit; top-up bonuses are not assumed.'),
  ('poyo_credit', 1, 'PoYo credit', 200, 'documented', 'https://poyo.ai/pricing', '2026-10-18', 'Model pages quote credits with the same $0.005 conversion.'),
  ('apimart_credit', 1, 'APIMart credit', 10, 'documented', 'https://docs.apimart.ai/en/api-reference/account/user-balance', '2026-10-18',
    'Gold-tier display prices; the balance reply shows 100.0 balance = 1000 credits.'),
  ('cny', 1, 'Chinese yuan', 6.70, 'illustrative', null, '2026-10-18', 'Illustrative USD 1 = CNY 6.70 from the research brief, not a live exchange rate. Replace with the rate actually paid.'),
  ('duomi_point', 1, 'Duomi point', 6700, 'illustrative', 'https://duomiapi.com/doc/85', '2026-10-18',
    'Duomi documents 1,000 points = CNY 1 (50 points ≈ CNY 0.05); USD value follows the illustrative CNY rate.');

create or replace function app_private.cost_unit(p_unit text)
returns app_private.cost_unit_versions
language sql
stable
set search_path = ''
as $$
  select * from app_private.cost_unit_versions where unit = p_unit order by version desc limit 1;
$$;

alter table app_private.provider_accounts
  add column display_name text,
  add column sort_order int not null default 100,
  -- 0 = no Admin key (KIE keeps reading its environment secret named by secret_ref).
  add column credential_version int not null default 0,
  add column key_hint text,
  add column key_set_at timestamptz,
  add column key_set_by uuid,
  add column connection_state text not null default 'untested'
    check (connection_state in ('untested', 'ok', 'failed', 'unauthorized', 'unsupported')),
  add column connection_checked_at timestamptz,
  add column connection_message text,
  add column native_unit text not null default 'usd',
  -- Funding terms actually paid: a card fee is added once (×(1+fee)); a credit bonus divides (÷(1+bonus)).
  add column funding_fee_bps numeric(8, 2) not null default 0 check (funding_fee_bps between 0 and 5000),
  add column funding_bonus_bps numeric(8, 2) not null default 0 check (funding_bonus_bps between 0 and 10000),
  add column funding_note text,
  add column funding_version int not null default 1,
  add column daily_spend_cap_usd numeric(14, 4) check (daily_spend_cap_usd is null or daily_spend_cap_usd >= 0),
  -- Accounts that draw on the same wallet share a group, so their balance is never counted twice.
  add column wallet_group text,
  add column balance_available numeric,
  add column balance_held numeric,
  add column balance_unit text,
  add column balance_scope text check (balance_scope is null or balance_scope in ('wallet', 'key')),
  add column balance_source text check (balance_source is null or balance_source in ('api', 'manual')),
  add column key_quota_unlimited boolean,
  add column balance_note text;

update app_private.provider_accounts
set display_name = 'KIE', native_unit = 'kie_credit', balance_unit = 'kie_credit', balance_scope = 'wallet',
    balance_source = case when last_balance is not null then 'api' end, sort_order = 10
where provider = 'kie';

-- New accounts start switched off and without a key; the owner adds the key and switches them on in Admin.
insert into app_private.provider_accounts (provider, label, display_name, enabled, secret_ref, native_unit, balance_unit, sort_order, funding_fee_bps, funding_note)
values
  ('duomi', 'primary', 'Duomi', false, 'admin-vault', 'duomi_point', 'duomi_point', 20, 0, null),
  ('poyo', 'primary', 'PoYo', false, 'admin-vault', 'poyo_credit', 'poyo_credit', 30, 0, null),
  ('nezhagate', 'primary', 'NezhaGate', false, 'admin-vault', 'usd', 'usd', 40, 0, null),
  ('cuddler', 'primary', 'Cuddler', false, 'admin-vault', 'usd', 'usd', 50, 550, 'Published 5.5 % card top-up fee; change it if the account is funded another way.'),
  ('apimart', 'primary', 'APIMart', false, 'admin-vault', 'apimart_credit', 'apimart_credit', 60, 0, 'Gold-tier prices; no membership discount assumed.')
on conflict (provider, label) do nothing;

-- Every key version saved from Admin. The value lives only in Vault; this row keeps its masked hint.
create table app_private.provider_credentials (
  provider_account_id uuid not null references app_private.provider_accounts (id),
  version int not null check (version > 0),
  secret_id uuid,
  key_hint text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  purged_at timestamptz,
  primary key (provider_account_id, version)
);
alter table app_private.provider_credentials enable row level security;

-- ===================================================================== offers

create table app_private.provider_offers (
  id uuid primary key default gen_random_uuid(),
  provider_account_id uuid not null references app_private.provider_accounts (id),
  -- The public model this offer can serve; null = review inventory only (never routed, never shown).
  model_id text references app_private.model_catalog (id),
  product_key text not null check (product_key ~ '^[a-z0-9][a-z0-9.:/_-]{1,99}$'),
  product_label text not null,
  tool text check (tool in ('image', 'edit', 'video')),
  operation text not null,
  upstream_model_id text,
  -- Request builder in this release; null = not integrated yet (the offer can never be routed).
  adapter text references app_private.provider_adapters (adapter),
  -- {"inherit": true} = exactly the public model's capability (the KIE routes the specs were written for). Otherwise
  -- explicit lists: {"options": {name: [values] | {"min","max"}}, "modes": [...], "inputs": {slot: {"max", "maxTotalSeconds"}},
  -- "maxPromptChars": n, "notes": [...]} . A request setting that is not listed makes the offer incompatible.
  capabilities jsonb not null default '{}'::jsonb check (jsonb_typeof(capabilities) = 'object'),
  status text not null default 'discovered' check (status in (
    'discovered', 'pricing_unverified', 'capabilities_unverified', 'configured', 'eligible', 'disabled', 'stale', 'unavailable')),
  decision text not null default 'unresolved' check (decision in ('eligible', 'dominated', 'incompatible', 'unavailable', 'unresolved')),
  decision_reason text,
  decided_at timestamptz,
  blocker text,
  routing_enabled boolean not null default false,
  is_legacy_primary boolean not null default false,
  source_url text,
  docs_url text,
  verification_note text,
  verified_at timestamptz,
  verified_by uuid,
  -- Audited permission to keep routing on a price older than the freshness policy.
  price_override_until timestamptz,
  sort_order int not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_account_id, product_key)
);
create index provider_offers_model_idx on app_private.provider_offers (model_id);
create trigger provider_offers_touch before update on app_private.provider_offers
  for each row execute function app_private.touch_updated_at();
alter table app_private.provider_offers enable row level security;

-- Versioned supplier prices. Schedule (amounts in the native unit, as numbers or decimal text):
--   {"basis": "output" | "request" | "output_second" | "io_second",
--    "dims": ["resolution", ...], "rates": {"<values joined by |>": rate},
--    "seconds": {"option": "duration"} | {"fixed": 30}, "minSeconds": n, "roundSeconds": "ceil", "secondsFactor": n,
--    "inputSeconds": {"slots": ["reference_video"], "round": "ceil"},           -- io_second: input + output seconds
--    "extraImages": {"slots": ["reference_images"], "free": 1, "rate": r},     -- per image beyond the free ones
--    "roundDecimals": n}                                                        -- provider billing boundary
-- A configuration without a rate has no known cost: never zero.
create table app_private.provider_offer_prices (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid not null references app_private.provider_offers (id),
  version int not null,
  unit text not null,
  schedule jsonb not null check (schedule ? 'basis' and schedule ? 'rates' and schedule ? 'dims'),
  confidence text not null check (confidence in ('authoritative', 'documented', 'estimate', 'conflicting', 'unverified')),
  source_kind text not null check (source_kind in ('documented', 'account_quote', 'manual', 'observed', 'research')),
  source_url text,
  checked_at timestamptz not null,
  effective_at timestamptz,
  expires_at timestamptz,
  account_tier text,
  promotion boolean not null default false,
  assumptions text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (offer_id, version)
);
create trigger provider_offer_prices_immutable before update or delete on app_private.provider_offer_prices
  for each row execute function app_private.forbid_mutation();
alter table app_private.provider_offer_prices enable row level security;

-- Staff tests of one specific offer (private; customers never see routing).
create table app_private.job_route_pins (
  job_id uuid primary key references public.generation_jobs (id),
  offer_id uuid not null references app_private.provider_offers (id),
  created_by uuid not null,
  created_at timestamptz not null default now()
);
alter table app_private.job_route_pins enable row level security;

-- Each attempt keeps the route it was sent with: in-flight work never follows later Admin changes.
alter table app_private.provider_attempts
  add column offer_id uuid references app_private.provider_offers (id),
  add column credential_version int,
  add column route jsonb;
create index provider_attempts_offer_idx on app_private.provider_attempts (offer_id);

-- ======================================================== supplier cost ledger

-- One row per attempt (Genlixs-attributed supplier spending). Customer credits stay in the existing wallet ledger.
create table app_private.provider_cost_ledger (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null unique references app_private.provider_attempts (id),
  job_id uuid not null references public.generation_jobs (id),
  user_id uuid not null,
  purpose text not null,
  provider_account_id uuid not null references app_private.provider_accounts (id),
  offer_id uuid references app_private.provider_offers (id),
  model_id text not null,
  upstream_model_id text,
  options jsonb,
  quantities jsonb,
  native_unit text,
  unit_version_id uuid references app_private.cost_unit_versions (id),
  units_per_usd numeric,
  funding jsonb,
  price_ref jsonb,
  estimated_native numeric,
  estimated_usd numeric,
  estimated_effective_usd numeric,
  confirmed_native numeric,
  confirmed_usd numeric,
  confirmed_effective_usd numeric,
  state text not null check (state in (
    'reserved', 'submission_unknown', 'not_charged', 'pending_confirmation', 'confirmed', 'failed', 'refunded', 'unknown_historical')),
  source text not null check (source in ('route', 'backfill')),
  confirmation_source text,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  confirmed_at timestamptz
);
create index provider_cost_ledger_account_idx on app_private.provider_cost_ledger (provider_account_id, created_at desc);
create index provider_cost_ledger_job_idx on app_private.provider_cost_ledger (job_id);
create index provider_cost_ledger_state_idx on app_private.provider_cost_ledger (state) where state in ('reserved', 'submission_unknown', 'pending_confirmation');
create trigger provider_cost_ledger_touch before update on app_private.provider_cost_ledger
  for each row execute function app_private.touch_updated_at();
alter table app_private.provider_cost_ledger enable row level security;

-- Refunds, corrections and account-level amounts not tied to one attempt. Never assigned to customers.
create table app_private.provider_cost_adjustments (
  id uuid primary key default gen_random_uuid(),
  provider_account_id uuid not null references app_private.provider_accounts (id),
  ledger_id uuid references app_private.provider_cost_ledger (id),
  kind text not null check (kind in ('refund', 'correction', 'unattributed')),
  native_amount numeric not null,
  native_unit text not null,
  usd_amount numeric,
  occurred_at timestamptz not null,
  note text not null,
  created_by uuid,
  created_at timestamptz not null default now()
);
create trigger provider_cost_adjustments_append_only before update or delete on app_private.provider_cost_adjustments
  for each row execute function app_private.forbid_mutation();
alter table app_private.provider_cost_adjustments enable row level security;

-- Account-level usage as reported by a provider's usage endpoint (may include other applications on the account).
create table app_private.provider_usage_reports (
  id bigint generated always as identity primary key,
  provider_account_id uuid not null references app_private.provider_accounts (id),
  scope text not null check (scope in ('key', 'account')),
  period_start timestamptz not null,
  period_end timestamptz not null,
  timezone text not null,
  amount_usd numeric,
  native_amount numeric,
  native_unit text,
  requests int,
  fetched_at timestamptz not null default now(),
  check (period_end > period_start)
);
create index provider_usage_reports_idx on app_private.provider_usage_reports (provider_account_id, fetched_at desc);
alter table app_private.provider_usage_reports enable row level security;

-- ============================================================ balances

alter table app_private.provider_balance_snapshots
  add column available numeric,
  add column held numeric,
  add column unit text,
  add column scope text check (scope is null or scope in ('wallet', 'key')),
  add column kind text not null default 'api' check (kind in ('api', 'manual')),
  add column unlimited boolean,
  add column note text,
  add column entered_by uuid;
alter table app_private.provider_balance_snapshots drop constraint provider_balance_snapshots_check;
alter table app_private.provider_balance_snapshots add constraint provider_balance_snapshots_check
  check ((ok and (credits is not null or available is not null or coalesce(unlimited, false))) or (not ok and credits is null and available is null));
alter table app_private.provider_balance_snapshots drop constraint provider_balance_snapshots_source_check;
alter table app_private.provider_balance_snapshots add constraint provider_balance_snapshots_source_check
  check (source in ('admin', 'auto', 'worker', 'manual'));
update app_private.provider_balance_snapshots s set unit = 'kie_credit', scope = 'wallet'
from app_private.provider_accounts a where a.id = s.provider_account_id and a.provider = 'kie';

-- ============================================================ settings and roles

insert into app_private.settings (key, value, description) values
  ('routing_fallback_max_pct', 'null', 'More expensive emergency fallback: allowed extra cost in percent over the cheapest eligible offer (null = cheapest only)'),
  ('routing_fallback_max_usd', 'null', 'More expensive emergency fallback: allowed extra cost in USD per job (null = cheapest only)'),
  ('provider_price_stale_days', '30', 'Supplier prices checked longer ago than this are stale and stop routing until re-verified or overridden'),
  ('provider_balance_stale_minutes', '60', 'A balance read older than this is shown as stale and is not used to block routing'),
  ('provider_check_min_seconds', '10', 'Minimum interval between connection tests of one provider account')
on conflict (key) do nothing;

-- Owner-only: keys, provider switches, supplier prices, routing policy.
insert into app_private.staff_capabilities (role, capability) values ('owner', 'provider.manage')
on conflict do nothing;

-- New adapters shipped with this release (request builders per provider family).
insert into app_private.provider_adapters (adapter, provider, description) values
  ('poyo-kling-motion', 'poyo', 'PoYo Kling 3.0 Motion Control: input.image_urls, input.video_urls, character_orientation, resolution'),
  ('apimart-video', 'apimart', 'APIMart /v1/videos/generations: model, prompt, duration, resolution, size, generate_audio, image_with_roles, video_urls'),
  ('apimart-image', 'apimart', 'APIMart /v1/images/generations: model, prompt, size, resolution, image_urls'),
  ('nezhagate-video', 'nezhagate', 'NezhaGate /v1/videos/generations: model, prompt, duration, resolution, size, images, video_references'),
  ('nezhagate-image', 'nezhagate', 'NezhaGate /v1/images/generations and /edits: model, prompt, size, resolution, image'),
  ('cuddler-video', 'cuddler', 'Cuddler POST /v1/videos: model, mode, variant, max_usd, prompt, duration, resolution, aspect_ratio, generate_audio, frames, references'),
  ('cuddler-image', 'cuddler', 'Cuddler POST /v1/images: model, mode, variant, max_usd, prompt, resolution, aspect_ratio, reference_images'),
  ('duomi-nano-banana', 'duomi', 'Duomi /api/gemini/nano-banana(-edit): model, prompt, aspect_ratio, image_size, image_urls')
on conflict (adapter) do nothing;

-- =============================================================== cost engine

-- A JSON number or decimal text as an exact numeric; anything else is NULL (unknown), never zero.
create or replace function app_private.num(p jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case jsonb_typeof(p)
    when 'number' then (p #>> '{}')::numeric
    when 'string' then case when (p #>> '{}') ~ '^\s*-?\d+(\.\d+)?\s*$' then trim(p #>> '{}')::numeric end
  end;
$$;

-- Billable quantities of one normalized request: outputs, files per input slot, seconds of media per slot, prompt size.
-- "_references" counts the reference images of the older image-edit input.
create or replace function app_private.request_quantities(p_spec jsonb, p_input jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_counts jsonb := '{}'::jsonb;
  v_secs jsonb := '{}'::jsonb;
  s record;
  v_s numeric;
begin
  for s in select key, value from jsonb_each(coalesce(p_input -> 'inputs', '{}'::jsonb)) loop
    if jsonb_typeof(s.value) <> 'array' then
      continue;
    end if;
    v_counts := v_counts || jsonb_build_object(s.key, jsonb_array_length(s.value));
    if p_spec -> 'inputs' -> s.key ->> 'kind' in ('video', 'audio') then
      select round(sum(a.duration_ms)::numeric / 1000, 3) into v_s
      from jsonb_array_elements_text(s.value) x(id)
      join public.assets a on a.id::text = x.id;
      v_secs := v_secs || jsonb_build_object(s.key, coalesce(v_s, 0));
    end if;
  end loop;
  if jsonb_typeof(p_input -> 'referenceAssetIds') = 'array' and jsonb_array_length(p_input -> 'referenceAssetIds') > 0 then
    v_counts := v_counts || jsonb_build_object('_references', jsonb_array_length(p_input -> 'referenceAssetIds'));
  end if;
  return jsonb_build_object('outputs', coalesce((p_spec -> 'output' ->> 'count')::int, 1), 'counts', v_counts, 'seconds', v_secs,
    'promptChars', char_length(coalesce(p_input ->> 'prompt', '')));
end;
$$;

