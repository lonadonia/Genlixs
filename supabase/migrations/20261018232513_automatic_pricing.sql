-- Automatic KIE-based pricing: one global policy prices every model.
--
--   B = documented KIE reference cost of the exact request in USD: the model's maintained KIE credit schedule (version,
--       resolution, duration, audio, reference images, output count, billed input seconds) at the documented USD price
--       of a KIE credit (cost unit kie_credit).
--   M = global markup on B (basis points; 10000 = +100 %, i.e. selling for twice the KIE reference).
--   V = USD value of one Genlixs credit: the existing credit-value reference (no second setting).
--   credits = ceil(round(round(B × (1 + M), 8) ÷ V, 12)), at least 1, rounded once for the whole request.
--
-- The selling price never depends on the supplier that serves a job; a cheaper supplier only raises Genlixs's effective
-- markup. Prices stay materialised as immutable price versions (one table per model and capability), so quotes, the
-- stale-quote check before a job, the reservation and the final debit keep using the same server-side numbers, and job
-- history keeps the version it was charged with. Only the policy writes them: saving the policy, a new KIE cost version,
-- a new capability, a new credit value or a new documented KIE credit price re-prices automatically, and only models
-- whose table changes get a new version. Per-model and bulk retail editing are retired. On first apply the policy
-- (+100 % at the current credit value) reproduces every published price, so no price changes.

-- ===================================================================== schema

create table app_private.pricing_policy_versions (
  id uuid primary key default gen_random_uuid(),
  version int not null unique check (version > 0),
  markup_bps int not null check (markup_bps between 0 and 200000),
  credit_reference_id uuid not null references app_private.pricing_reference_versions (id),
  kie_unit_version_id uuid not null references app_private.cost_unit_versions (id),
  reason text not null,
  created_by uuid,
  created_at timestamptz not null default now()
);
alter table app_private.pricing_policy_versions enable row level security;
create trigger pricing_policy_versions_append_only before delete or update on app_private.pricing_policy_versions
  for each row execute function app_private.forbid_mutation();

alter table app_private.price_versions drop constraint price_versions_source_check;
alter table app_private.price_versions add constraint price_versions_source_check
  check (source in ('seed', 'manual', 'bulk', 'restore', 'capability', 'policy'));
alter table app_private.price_versions add column policy_version_id uuid references app_private.pricing_policy_versions (id);

-- ===================================================================== engine

-- USD of a number of KIE credits at the documented KIE credit price (8 decimals, as in the KIE cost displays).
create or replace function app_private.kie_reference_usd(p_kie_credits numeric, p_kie_units_per_usd numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when p_kie_credits is null or p_kie_units_per_usd is null or p_kie_units_per_usd <= 0 then null
    else round(p_kie_credits / p_kie_units_per_usd, 8) end;
$$;

-- The one retail formula: Genlixs credits for a whole request from its KIE reference B (USD), the markup M (basis
-- points) and the credit value V (USD). Rounded up once, never below one credit.
create or replace function app_private.policy_units(p_kie_usd numeric, p_markup_bps int, p_usd_per_credit numeric)
returns bigint
language sql
immutable
set search_path = ''
as $$
  select case when p_kie_usd is null or p_markup_bps is null or p_usd_per_credit is null or p_usd_per_credit <= 0 then null
    else greatest(ceil(round(round(p_kie_usd * (10000 + p_markup_bps) / 10000, 8) / p_usd_per_credit, 12))::bigint, 1) end;
$$;

-- Effective markup (%) of a charged reference value on what the serving supplier costs: (charged − C) ÷ C × 100.
create or replace function app_private.effective_markup_pct(p_charged_usd numeric, p_cost_usd numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when p_charged_usd is null or p_cost_usd is null or p_cost_usd <= 0 then null
    else trim_scale(round((p_charged_usd - p_cost_usd) / p_cost_usd * 100, 2)) end;
$$;

create or replace function app_private.current_pricing_policy()
returns app_private.pricing_policy_versions
language sql
stable
set search_path = ''
as $$
  select * from app_private.pricing_policy_versions order by version desc limit 1;
$$;

-- The numbers a policy version prices with.
create or replace function app_private.policy_terms(p app_private.pricing_policy_versions)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('policyId', p.id, 'version', p.version, 'markupBps', p.markup_bps,
    'usdPerCredit', (select trim_scale(r.usd_per_credit) from app_private.pricing_reference_versions r where r.id = p.credit_reference_id),
    'kieUnitsPerUsd', (select trim_scale(u.units_per_usd) from app_private.cost_unit_versions u where u.id = p.kie_unit_version_id),
    'creditReferenceId', p.credit_reference_id, 'kieUnitVersionId', p.kie_unit_version_id);
$$;

create or replace function app_private.policy_json(p app_private.pricing_policy_versions)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case when p.id is null then null else app_private.policy_terms(p) || jsonb_build_object(
    'markupPercent', trim_scale(round(p.markup_bps / 100.0, 2)),
    'kieUsdPerCredit', (select trim_scale(round(1 / u.units_per_usd, 10)) from app_private.cost_unit_versions u where u.id = p.kie_unit_version_id),
    'reason', p.reason, 'createdAt', p.created_at,
    'createdBy', (select pr.email from public.profiles pr where pr.user_id = p.created_by)) end;
$$;

-- One model's automatic price table: every configuration of its KIE cost schedule, and every reference-image count when
-- KIE bills extra images, so each whole request is rounded once. A configuration without a KIE rate stays unpriced.
create or replace function app_private.policy_model_rules(p_model_id text, p_markup_bps int, p_usd_per_credit numeric, p_kie_units_per_usd numeric)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  c app_private.model_capability_versions := app_private.capability_for(p_model_id);
  sc app_private.supplier_cost_versions := app_private.latest_cost_version(p_model_id);
  v_dims jsonb;
  v_extra jsonb;
  v_refs_min int;
  v_refs_max int;
  v_outputs int;
  v_ref_dim boolean;
  cfg jsonb;
  n int;
  v_units bigint;
  v_table jsonb := '{}'::jsonb;
  v_configs int := 0;
  v_missing int := 0;
  v_min bigint;
  v_max bigint;
begin
  if c.id is null then
    return jsonb_build_object('status', 'kie_reference_needed', 'reason', 'Model not found');
  end if;
  if sc.id is null then
    return jsonb_build_object('status', 'kie_reference_needed', 'reason', 'No KIE reference price for this model', 'capabilityVersionId', c.id);
  end if;
  v_dims := app_private.price_dims(sc.schedule);
  v_extra := sc.schedule -> 'extraReference';
  v_refs_min := coalesce((c.spec -> 'references' ->> 'min')::int, 0);
  v_refs_max := greatest(coalesce((c.spec -> 'references' ->> 'max')::int, 0), v_refs_min);
  v_outputs := coalesce((c.spec -> 'output' ->> 'count')::int, 1);
  v_ref_dim := v_extra is not null and v_refs_max > coalesce((v_extra ->> 'free')::int, 0);
  for cfg in select * from app_private.price_configs(c.spec, v_dims) loop
    for n in select generate_series(v_refs_min, case when v_ref_dim then v_refs_max else v_refs_min end) loop
      v_configs := v_configs + 1;
      v_units := app_private.policy_units(
        app_private.kie_reference_usd(app_private.supplier_credits(sc.schedule, cfg, n, v_outputs), p_kie_units_per_usd),
        p_markup_bps, p_usd_per_credit);
      if v_units is null then
        v_missing := v_missing + 1;
        continue;
      end if;
      v_table := v_table || jsonb_build_object(case when v_ref_dim
          then app_private.option_key(v_dims || '["_refs"]'::jsonb, cfg || jsonb_build_object('_refs', n))
          else app_private.option_key(v_dims, cfg) end, v_units);
      v_min := least(v_min, v_units);
      v_max := greatest(v_max, v_units);
    end loop;
  end loop;
  -- "rules" is present only when at least one configuration is priced (callers test r -> 'rules' is null).
  return jsonb_build_object(
    'status', case when v_table = '{}'::jsonb then 'kie_reference_needed' when v_missing > 0 then 'partial' else 'ok' end,
    'reason', case when v_table = '{}'::jsonb then 'The KIE reference does not cover this model''s settings'
      when v_missing > 0 then v_missing || ' setting(s) without a KIE reference' end,
    'configs', v_configs, 'missing', v_missing, 'minUnits', v_min, 'maxUnits', v_max,
    'capabilityVersionId', c.id, 'costVersionId', sc.id, 'costVersion', sc.version)
    || case when v_table <> '{}'::jsonb then jsonb_build_object('rules', jsonb_build_object('format', 'table',
         'dims', case when v_ref_dim then v_dims || '["_refs"]'::jsonb else v_dims end, 'units', v_table)) else '{}'::jsonb end;
end;
$$;

-- Table lookup used by quotes and the final debit. A "_refs" dimension (policy tables of models whose KIE schedule bills
-- extra reference images) is matched with the request's reference count; earlier versions keep their own format.
create or replace function app_private.price_units_for(p_rules jsonb, p_options jsonb, p_ref_count integer default 0)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v bigint;
begin
  if p_rules ->> 'format' = 'table' then
    v := (p_rules -> 'units' ->> app_private.option_key(p_rules -> 'dims',
      case when coalesce(p_rules -> 'dims' ? '_refs', false)
        then coalesce(p_options, '{}'::jsonb) || jsonb_build_object('_refs', coalesce(p_ref_count, 0)) else p_options end))::bigint;
    if v is null then
      return null;
    end if;
    if p_rules ? 'perExtraReference' then
      v := v + greatest(coalesce(p_ref_count, 0) - coalesce((p_rules -> 'perExtraReference' ->> 'free')::int, 0), 0)
               * coalesce((p_rules -> 'perExtraReference' ->> 'units')::bigint, 0);
    end if;
    return v;
  end if;
  return app_private.price_units(p_rules, p_options);
end;
$$;

-- Unchanged except that a "_refs" dimension is not iterated as a model option (the lookup adds the reference count).
create or replace function app_private.below_cost_configs(p_model_id text, p_rules jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  c app_private.model_capability_versions := app_private.capability_for(p_model_id);
  sc app_private.supplier_cost_versions := app_private.latest_cost_version(p_model_id);
  v_rpc numeric := (app_private.credit_basis() ->> 'usdPerCredit')::numeric;
  v_kie numeric := app_private.kie_usd_per_credit();
  v_defaults jsonb;
  v_refs int;
  v_outputs int;
  v_dims jsonb;
  cfg jsonb;
  v_units bigint;
  v_cost numeric;
  v_out jsonb := '[]'::jsonb;
begin
  if sc.id is null or v_rpc is null or v_kie is null then
    return v_out;
  end if;
  v_defaults := app_private.spec_defaults(c.spec);
  v_refs := coalesce((c.spec -> 'references' ->> 'min')::int, 0);
  v_outputs := coalesce((c.spec -> 'output' ->> 'count')::int, 1);
  v_dims := case when p_rules ->> 'format' = 'table' then (p_rules -> 'dims') - '_refs' else app_private.price_dims(sc.schedule) end;
  for cfg in select * from app_private.price_configs(c.spec, v_dims) loop
    v_units := app_private.price_units_for(p_rules, v_defaults || cfg, v_refs);
    v_cost := app_private.supplier_credits(sc.schedule, v_defaults || cfg, v_refs, v_outputs) * v_kie;
    if v_units is not null and v_cost is not null and v_units * v_rpc < v_cost then
      v_out := v_out || jsonb_build_array(app_private.option_key(v_dims, cfg));
    end if;
  end loop;
  return v_out;
end;
$$;

-- Prices one model under a policy version: a new published version only when its table or capability changed.
create or replace function app_private.policy_apply_model(p_model_id text, p_policy app_private.pricing_policy_versions, p_actor uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  t jsonb := app_private.policy_terms(p_policy);
  r jsonb := app_private.policy_model_rules(p_model_id, p_policy.markup_bps, (t ->> 'usdPerCredit')::numeric, (t ->> 'kieUnitsPerUsd')::numeric);
  pub app_private.price_versions;
  v_ver int;
  v_id uuid;
begin
  perform 1 from app_private.model_catalog where id = p_model_id for update;
  select * into pub from app_private.price_versions where model_id = p_model_id and state = 'published' for update;
  -- Drafts of the earlier per-model editor can never be published now.
  update app_private.price_versions set state = 'retired' where model_id = p_model_id and state = 'draft';
  if r -> 'rules' is null then
    -- No KIE reference: never invent a price or borrow another supplier's.
    if pub.id is not null then
      update app_private.price_versions set state = 'retired' where id = pub.id;
    end if;
    return jsonb_build_object('modelId', p_model_id, 'outcome', case when pub.id is not null then 'unpriced' else 'kie_reference_needed' end,
      'reason', r ->> 'reason');
  end if;
  if pub.id is not null and pub.capability_version_id = (r ->> 'capabilityVersionId')::uuid and pub.rules = r -> 'rules' then
    return jsonb_build_object('modelId', p_model_id, 'outcome', 'unchanged', 'priceVersionId', pub.id, 'version', pub.version, 'status', r ->> 'status');
  end if;
  if pub.id is not null then
    update app_private.price_versions set state = 'retired' where id = pub.id;
  end if;
  select coalesce(max(version), 0) + 1 into v_ver from app_private.price_versions where model_id = p_model_id;
  insert into app_private.price_versions (model_id, capability_version_id, version, state, rules, cost_evidence, effective_at, published_by, created_by,
    source, supplier_cost_version_id, markup_bps, basis, policy_version_id)
  values (p_model_id, (r ->> 'capabilityVersionId')::uuid, v_ver, 'published', r -> 'rules',
    'Global pricing policy v' || p_policy.version || ': +' || trim_scale(round(p_policy.markup_bps / 100.0, 2))::text
      || ' % on the KIE reference (KIE cost v' || (r ->> 'costVersion') || ', '
      || app_private.fmt_usd(round(1 / (t ->> 'kieUnitsPerUsd')::numeric, 10)) || ' per KIE credit) at '
      || app_private.fmt_usd((t ->> 'usdPerCredit')::numeric) || ' per Genlixs credit',
    now(), p_actor, p_actor, 'policy', (r ->> 'costVersionId')::uuid, p_policy.markup_bps,
    t || jsonb_build_object('status', r ->> 'status', 'missing', (r ->> 'missing')::int), p_policy.id)
  returning id into v_id;
  return jsonb_build_object('modelId', p_model_id, 'outcome', 'repriced', 'priceVersionId', v_id, 'version', v_ver,
    'previousVersion', pub.version, 'status', r ->> 'status');
end;
$$;

-- Prices every model under a policy version. Returns what changed.
create or replace function app_private.policy_apply_all(p_policy app_private.pricing_policy_versions, p_actor uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  m record;
  r jsonb;
  v_repriced jsonb := '[]'::jsonb;
  v_needs jsonb := '[]'::jsonb;
  v_unpriced jsonb := '[]'::jsonb;
  v_partial jsonb := '[]'::jsonb;
  v_unchanged int := 0;
begin
  for m in select id, public_name from app_private.model_catalog order by sort_order, id loop
    r := app_private.policy_apply_model(m.id, p_policy, p_actor);
    if r ->> 'outcome' = 'repriced' then
      v_repriced := v_repriced || jsonb_build_array(jsonb_build_object('modelId', m.id, 'name', m.public_name, 'version', r -> 'version'));
    elsif r ->> 'outcome' = 'unchanged' then
      v_unchanged := v_unchanged + 1;
    elsif r ->> 'outcome' = 'unpriced' then
      v_unpriced := v_unpriced || jsonb_build_array(jsonb_build_object('modelId', m.id, 'name', m.public_name, 'reason', r ->> 'reason'));
    else
      v_needs := v_needs || jsonb_build_array(jsonb_build_object('modelId', m.id, 'name', m.public_name, 'reason', r ->> 'reason'));
    end if;
    if r ->> 'status' = 'partial' then
      v_partial := v_partial || jsonb_build_array(jsonb_build_object('modelId', m.id, 'name', m.public_name));
    end if;
  end loop;
  return jsonb_build_object('repriced', v_repriced, 'unchanged', v_unchanged, 'needsKieReference', v_needs, 'unpriced', v_unpriced,
    'partial', v_partial);
end;
$$;

-- A new policy version on the current documented KIE credit price.
create or replace function app_private.new_pricing_policy(p_markup_bps int, p_credit_reference_id uuid, p_actor uuid, p_reason text)
returns app_private.pricing_policy_versions
language plpgsql
set search_path = ''
as $$
declare
  v_unit uuid := (app_private.cost_unit('kie_credit')).id;
  v app_private.pricing_policy_versions;
begin
  if v_unit is null then
    perform app_private.fail('KIE_RATE_MISSING', 'The documented price of a KIE credit is missing.');
  end if;
  insert into app_private.pricing_policy_versions (version, markup_bps, credit_reference_id, kie_unit_version_id, reason, created_by)
  values (coalesce((select max(version) from app_private.pricing_policy_versions), 0) + 1, p_markup_bps, p_credit_reference_id, v_unit,
    left(p_reason, 500), p_actor)
  returning * into v;
  return v;
end;
$$;

-- USD value of one Genlixs credit entered on the policy panel (more than 0, at most $100, at most 6 decimals).
create or replace function app_private.policy_credit_value(p numeric)
returns numeric
language plpgsql
set search_path = ''
as $$
begin
  if p is null or p <= 0 or p > 100 or round(p, 6) <> p then
    perform app_private.fail('INVALID_CREDIT_VALUE', 'Enter the USD value of one Genlixs credit (more than 0, at most 6 decimals).');
  end if;
  return p;
end;
$$;

-- ================================================================ follow changes

-- A new KIE cost version or a new capability re-prices that model under the current policy, in the same transaction.
create or replace function app_private.policy_follow_change()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  p app_private.pricing_policy_versions := app_private.current_pricing_policy();
begin
  if p.id is not null then
    perform pg_advisory_xact_lock(hashtext('genlixs:pricing'));
    perform app_private.policy_apply_model(new.model_id, p, nullif(to_jsonb(new) ->> 'created_by', '')::uuid);
  end if;
  return new;
end;
$$;

create trigger supplier_cost_versions_policy after insert on app_private.supplier_cost_versions
  for each row execute function app_private.policy_follow_change();
create trigger model_capability_versions_policy after insert on app_private.model_capability_versions
  for each row execute function app_private.policy_follow_change();

-- A new documented KIE credit price is a new policy version (same markup and credit value) applied to every model.
create or replace function app_private.policy_follow_kie_rate()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  p app_private.pricing_policy_versions := app_private.current_pricing_policy();
  np app_private.pricing_policy_versions;
begin
  if new.unit = 'kie_credit' and p.id is not null then
    perform pg_advisory_xact_lock(hashtext('genlixs:pricing'));
    np := app_private.new_pricing_policy(p.markup_bps, p.credit_reference_id, new.created_by,
      'The documented price of a KIE credit changed to ' || app_private.fmt_usd(round(1 / new.units_per_usd, 10)));
    perform app_private.policy_apply_all(np, new.created_by);
  end if;
  return new;
end;
$$;

create trigger cost_unit_versions_policy after insert on app_private.cost_unit_versions
  for each row execute function app_private.policy_follow_kie_rate();

-- ===================================================================== admin API

-- Current policy (pricing roles and supplier readers).
create or replace function public.admin_pricing_policy()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('admin.access');
begin
  if not (app_private.has_capability(v_actor, 'pricing.review') or app_private.has_capability(v_actor, 'catalog.publish')
          or app_private.has_capability(v_actor, 'provider.read')) then
    perform app_private.fail('FORBIDDEN', 'Your role cannot see pricing.');
  end if;
  return jsonb_build_object('policy', app_private.policy_json(app_private.current_pricing_policy()),
    'creditReference', app_private.reference_json(app_private.current_reference('credit_value')),
    'canPreview', app_private.has_capability(v_actor, 'pricing.review'),
    'canApply', app_private.has_capability(v_actor, 'catalog.publish') and app_private.has_capability(v_actor, 'pricing.review'),
    'history', (select coalesce(jsonb_agg(app_private.policy_json(x) order by x.version desc), '[]'::jsonb)
      from (select * from app_private.pricing_policy_versions order by version desc limit 10) x));
end;
$$;

-- What a markup and credit value would change, without saving anything: how many models get a new price table, and the
-- default request of a few models before and after.
create or replace function public.admin_preview_pricing_policy(p_markup_percent numeric, p_usd_per_credit numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('pricing.review');
  v_bps int := app_private.markup_bps(p_markup_percent);
  v_v numeric := app_private.policy_credit_value(p_usd_per_credit);
  p app_private.pricing_policy_versions := app_private.current_pricing_policy();
  v_cur_v numeric := (app_private.policy_terms(app_private.current_pricing_policy()) ->> 'usdPerCredit')::numeric;
  v_upu numeric := (app_private.cost_unit('kie_credit')).units_per_usd;
  m record;
  r jsonb;
  pub app_private.price_versions;
  c app_private.model_capability_versions;
  sc app_private.supplier_cost_versions;
  ex jsonb;
  v_refs int;
  v_changed int := 0;
  v_same int := 0;
  v_needs jsonb := '[]'::jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_before bigint;
  v_after bigint;
begin
  for m in select id, public_name, tool, state from app_private.model_catalog order by sort_order, id loop
    r := app_private.policy_model_rules(m.id, v_bps, v_v, v_upu);
    if r -> 'rules' is null then
      v_needs := v_needs || jsonb_build_array(jsonb_build_object('modelId', m.id, 'name', m.public_name, 'reason', r ->> 'reason'));
      continue;
    end if;
    pub := null;
    select * into pub from app_private.price_versions where model_id = m.id and state = 'published';
    c := app_private.capability_for(m.id);
    sc := app_private.latest_cost_version(m.id);
    if pub.id is not null and pub.capability_version_id = c.id and pub.rules = r -> 'rules' then
      v_same := v_same + 1;
    else
      v_changed := v_changed + 1;
    end if;
    ex := app_private.example_request(c.spec);
    v_refs := coalesce((ex -> 'quantities' -> 'counts' ->> '_references')::int, 0);
    v_before := case when pub.id is not null and pub.capability_version_id = c.id then app_private.price_units_for(pub.rules, ex -> 'options', v_refs) end;
    v_after := app_private.price_units_for(r -> 'rules', ex -> 'options', v_refs);
    v_rows := v_rows || jsonb_build_array(jsonb_build_object('modelId', m.id, 'name', m.public_name, 'tool', m.tool,
      'live', m.state in ('enabled', 'experimental'), 'options', ex -> 'options',
      'kieUsd', app_private.kie_reference_usd(app_private.supplier_credits(sc.schedule, ex -> 'options', v_refs,
        coalesce((c.spec -> 'output' ->> 'count')::int, 1)), v_upu),
      'before', v_before, 'beforeUsd', v_before * v_cur_v, 'after', v_after, 'afterUsd', v_after * v_v));
  end loop;
  return jsonb_build_object(
    'current', app_private.policy_json(p),
    'proposed', jsonb_build_object('markupPercent', trim_scale(round(v_bps / 100.0, 2)), 'markupBps', v_bps, 'usdPerCredit', v_v,
      'kieUsdPerCredit', trim_scale(round(1 / v_upu, 10))),
    'affectedModels', v_changed, 'unchangedModels', v_same, 'needsKieReference', v_needs,
    -- a few representative default requests: live models whose charge changes first, one per type where possible
    'examples', (select coalesce(jsonb_agg(x.e order by x.rank_changed, x.rank_tool, x.ord), '[]'::jsonb) from (
        select e, ord, (case when (e ->> 'before') is distinct from (e ->> 'after') then 0 else 1 end) as rank_changed,
          row_number() over (partition by e ->> 'tool', (e ->> 'before') is distinct from (e ->> 'after') order by ord) as rank_tool
        from jsonb_array_elements(v_rows) with ordinality as t(e, ord)
        where (e ->> 'live')::boolean
        order by 3, 4, 2 limit 4) x),
    'note', 'Nothing was saved. Quotes already taken, running jobs, wallets and packages are not repriced.');
end;
$$;

-- Saves the markup and the credit value as a new policy version and re-prices every model in one transaction. Only
-- models whose table changes get a new price version; their earlier quotes must be refreshed before a job is accepted.
create or replace function public.admin_apply_pricing_policy(p_markup_percent numeric, p_usd_per_credit numeric, p_expected_policy_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('catalog.publish');
  v_bps int := app_private.markup_bps(p_markup_percent);
  v_v numeric := app_private.policy_credit_value(p_usd_per_credit);
  p app_private.pricing_policy_versions;
  np app_private.pricing_policy_versions;
  cur app_private.pricing_reference_versions;
  v_ref uuid;
  v_credits numeric;
  v_res jsonb;
begin
  perform app_private.require_capability('pricing.review');
  perform pg_advisory_xact_lock(hashtext('genlixs:pricing'));
  p := app_private.current_pricing_policy();
  if p.id is distinct from p_expected_policy_id then
    perform app_private.fail('POLICY_CHANGED', 'The pricing policy was changed meanwhile. Reload and check the preview again.');
  end if;
  cur := app_private.current_reference('credit_value');
  v_ref := cur.id;
  if cur.id is null or cur.usd_per_credit is distinct from v_v then
    -- The credit value keeps its single home (the credit-value reference): a new version holding exactly V.
    v_credits := case when cur.id is not null and round(v_v * cur.credits, 2) = v_v * cur.credits then cur.credits else 10000 end;
    insert into app_private.pricing_reference_versions (kind, version, amount_usd, credits, bonus_credits, note, created_by)
    values ('credit_value', coalesce(cur.version, 0) + 1, v_v * v_credits, v_credits, 0, 'Set on the global pricing policy', v_actor)
    returning id into v_ref;
  end if;
  if p.id is not null and p.markup_bps = v_bps and p.credit_reference_id = v_ref and p.kie_unit_version_id = (app_private.cost_unit('kie_credit')).id then
    np := p;
  else
    np := app_private.new_pricing_policy(v_bps, v_ref, v_actor,
      'Markup +' || trim_scale(round(v_bps / 100.0, 2))::text || ' % on the KIE reference at ' || app_private.fmt_usd(v_v) || ' per Genlixs credit');
  end if;
  v_res := app_private.policy_apply_all(np, v_actor);
  if np.id is not distinct from p.id and jsonb_array_length(v_res -> 'repriced') = 0 and jsonb_array_length(v_res -> 'unpriced') = 0 then
    return jsonb_build_object('policy', app_private.policy_json(np), 'newVersion', false, 'unchanged', true, 'result', v_res);
  end if;
  perform app_private.audit(v_actor, 'catalog.publish', 'pricing.policy', 'pricing_policy', np.id::text,
    'Global pricing policy v' || np.version || ': +' || trim_scale(round(v_bps / 100.0, 2))::text || ' % on the KIE reference at '
      || app_private.fmt_usd(v_v) || ' per Genlixs credit; ' || jsonb_array_length(v_res -> 'repriced') || ' model(s) repriced, '
      || (v_res ->> 'unchanged') || ' unchanged. Quotes already taken, running jobs, wallets and packages were not changed.',
    app_private.policy_json(p), app_private.policy_json(np) || jsonb_build_object('result', v_res));
  return jsonb_build_object('policy', app_private.policy_json(np), 'newVersion', np.id is distinct from p.id, 'unchanged', false, 'result', v_res);
end;
$$;

revoke execute on function public.admin_pricing_policy() from public, anon;
grant execute on function public.admin_pricing_policy() to authenticated;
revoke execute on function public.admin_preview_pricing_policy(numeric, numeric) from public, anon;
grant execute on function public.admin_preview_pricing_policy(numeric, numeric) to authenticated;
revoke execute on function public.admin_apply_pricing_policy(numeric, numeric, uuid) from public, anon;
grant execute on function public.admin_apply_pricing_policy(numeric, numeric, uuid) to authenticated;

-- ============================================== reference values follow the policy

-- The credit value is V: saving it re-prices every model under the current markup. The KIE purchase reference records
-- what Genlixs paid KIE (cost analytics only); it never moves selling prices, which follow the documented KIE price.
create or replace function public.admin_save_pricing_reference(p_kind text, p_amount_usd numeric, p_credits numeric, p_bonus_credits numeric,
  p_source_url text, p_note text, p_expected_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('pricing.review');
  cur app_private.pricing_reference_versions;
  v_new app_private.pricing_reference_versions;
  v_bonus numeric := coalesce(p_bonus_credits, 0);
  v_url text := nullif(trim(coalesce(p_source_url, '')), '');
  v_note text := nullif(trim(coalesce(p_note, '')), '');
  p app_private.pricing_policy_versions;
  np app_private.pricing_policy_versions;
  v_res jsonb;
begin
  if p_kind is null or p_kind not in ('kie_purchase', 'credit_value') then
    perform app_private.fail('INVALID_INPUT', 'Choose the KIE purchase or the Genlixs credit value.');
  end if;
  -- The credit value now re-prices every model, so it takes the same right as publishing prices.
  if p_kind = 'credit_value' then
    perform app_private.require_capability('catalog.publish');
  end if;
  if p_amount_usd is null or p_amount_usd <= 0 or p_amount_usd > 1000000 or round(p_amount_usd, 2) <> p_amount_usd then
    perform app_private.fail('INVALID_INPUT', 'Enter the amount in USD (more than 0, at most 2 decimals).');
  end if;
  if p_credits is null or p_credits <= 0 or p_credits > 100000000 or round(p_credits, 2) <> p_credits
     or (p_kind = 'credit_value' and p_credits <> trunc(p_credits)) then
    perform app_private.fail('INVALID_INPUT', case when p_kind = 'credit_value' then 'Enter a whole number of Genlixs credits (at least 1).'
      else 'Enter the KIE credits received (more than 0, at most 2 decimals).' end);
  end if;
  if v_bonus < 0 or v_bonus >= p_credits or round(v_bonus, 2) <> v_bonus or (p_kind = 'credit_value' and v_bonus <> 0) then
    perform app_private.fail('INVALID_INPUT', 'Bonus credits must be less than the credits received.');
  end if;
  if v_url is not null and v_url !~ '^https://' then
    perform app_private.fail('INVALID_INPUT', 'The source link must start with https://.');
  end if;
  if p_kind = 'credit_value' then
    -- V is used exactly as the policy panel takes it (more than 0, at most 6 decimals).
    perform app_private.policy_credit_value(round(p_amount_usd / p_credits, 10));
  end if;
  perform pg_advisory_xact_lock(hashtext('genlixs:pricing'));
  cur := app_private.current_reference(p_kind);
  if cur.id is distinct from p_expected_version_id then
    perform app_private.fail('REFERENCE_CHANGED', 'This value was changed by someone else since you opened it. Reload to see the latest value.');
  end if;
  if cur.id is not null and cur.amount_usd = p_amount_usd and cur.credits = p_credits and cur.bonus_credits = v_bonus
     and cur.source_url is not distinct from v_url and cur.note is not distinct from v_note and not cur.is_example then
    return jsonb_build_object('unchanged', true, 'reference', app_private.reference_json(cur));
  end if;
  insert into app_private.pricing_reference_versions (kind, version, amount_usd, credits, bonus_credits, source_url, note, created_by)
  values (p_kind, coalesce(cur.version, 0) + 1, p_amount_usd, p_credits, v_bonus, v_url, v_note, v_actor)
  returning * into v_new;
  if p_kind = 'kie_purchase' then
    -- Kept in step for readers of the documented setting (new KIE cost versions record it).
    update app_private.settings set value = to_jsonb(v_new.usd_per_credit), updated_by = v_actor, updated_at = now() where key = 'kie_usd_per_credit';
  else
    p := app_private.current_pricing_policy();
    if p.id is not null then
      np := app_private.new_pricing_policy(p.markup_bps, v_new.id, v_actor,
        'Genlixs credit value changed to ' || app_private.fmt_usd(v_new.usd_per_credit));
      v_res := app_private.policy_apply_all(np, v_actor);
    end if;
  end if;
  perform app_private.audit(v_actor, case when p_kind = 'credit_value' then 'catalog.publish' else 'pricing.review' end,
    'pricing.reference', 'pricing_reference', v_new.id::text,
    case when p_kind = 'kie_purchase'
      then 'Set the KIE purchase reference to ' || app_private.fmt_usd(p_amount_usd) || ' for ' || trim_scale(p_credits)::text || ' KIE credits ('
        || app_private.fmt_usd(v_new.usd_per_credit) || ' per KIE credit'
        || case when v_bonus > 0 then ', including ' || trim_scale(v_bonus)::text || ' bonus credits' else '' end || ')'
        || '. Selling prices follow the documented KIE price and were not changed.'
      else 'Set the Genlixs credit value to ' || app_private.fmt_usd(p_amount_usd) || ' for ' || trim_scale(p_credits)::text || ' credits ('
        || app_private.fmt_usd(v_new.usd_per_credit) || ' per credit). Model prices follow the global pricing policy ('
        || coalesce(jsonb_array_length(v_res -> 'repriced'), 0) || ' model(s) repriced); quotes already taken, running jobs, wallets and purchases were not changed.' end,
    app_private.reference_json(cur), app_private.reference_json(v_new));
  return jsonb_build_object('unchanged', false, 'reference', app_private.reference_json(v_new), 'previous', app_private.reference_json(cur),
    'pricing', v_res);
end;
$$;

-- ============================================== per-model and bulk retail editing retired

create or replace function app_private.pricing_is_automatic()
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform app_private.fail('PRICING_AUTOMATIC',
    'Model prices follow the global pricing policy (KIE reference × markup ÷ credit value). Change the markup or the credit value in Admin › Models & pricing.');
end;
$$;

create or replace function public.admin_save_model_price(p_model_id text, p_units jsonb, p_extra_reference_units integer, p_publish boolean,
  p_accept_loss boolean, p_expected_price_version_id uuid, p_note text default null::text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.require_capability('pricing.review');
  perform app_private.pricing_is_automatic();
  return null;
end;
$$;

create or replace function public.admin_save_price_draft(p_model_id text, p_units jsonb, p_extra_reference_units integer default null::integer,
  p_note text default null::text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.require_capability('pricing.review');
  perform app_private.pricing_is_automatic();
  return null;
end;
$$;

create or replace function public.admin_create_price_version(p_model_id text, p_rules jsonb, p_supplier_cost jsonb, p_evidence text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.require_capability('pricing.review');
  perform app_private.pricing_is_automatic();
  return null;
end;
$$;

create or replace function public.admin_publish_price_version(p_price_version_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.require_capability('catalog.publish');
  perform app_private.pricing_is_automatic();
  return null;
end;
$$;

create or replace function public.admin_restore_price_version(p_price_version_id uuid, p_reason text default null::text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.require_capability('catalog.publish');
  perform app_private.pricing_is_automatic();
  return null;
end;
$$;

create or replace function public.admin_pricing_preview(p_scope text, p_model_ids text[], p_markup_percent numeric, p_include_overrides boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.require_capability('pricing.review');
  perform app_private.pricing_is_automatic();
  return null;
end;
$$;

create or replace function public.admin_pricing_apply(p_scope text, p_model_ids text[], p_markup_percent numeric, p_include_overrides boolean,
  p_preview_revision text, p_action text, p_selected text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.require_capability('pricing.review');
  perform app_private.pricing_is_automatic();
  return null;
end;
$$;

create or replace function public.admin_pricing_save(p_scope text, p_model_ids text[], p_markup_percent numeric, p_include_overrides boolean,
  p_preview_revision text, p_selected text[], p_excluded jsonb default '{}'::jsonb, p_publish boolean default true, p_accept_loss boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.require_capability('pricing.review');
  perform app_private.pricing_is_automatic();
  return null;
end;
$$;

create or replace function public.admin_reference_impact(p_kind text, p_amount_usd numeric, p_credits numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app_private.require_capability('pricing.review');
  perform app_private.pricing_is_automatic();
  return null;
end;
$$;

-- ===================================================================== readiness

-- Same checks as before; the price is now automatic, so a missing KIE reference is what blocks a model.
create or replace function app_private.model_readiness(p_model_id text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  m app_private.model_catalog;
  c app_private.model_capability_versions;
  sc app_private.supplier_cost_versions;
  pub app_private.price_versions;
  acc app_private.provider_accounts;
  v_checks jsonb := '[]'::jsonb;
  v_complete boolean;
  cfg jsonb;
  v_defaults jsonb;
  v_refs int;
  v_n int := 0;
  v_missing int := 0;
  v_adapter boolean;
begin
  select * into m from app_private.model_catalog where id = p_model_id;
  c := app_private.capability_for(m.id);
  sc := app_private.latest_cost_version(m.id);
  select * into pub from app_private.price_versions where model_id = m.id and state = 'published' and capability_version_id = c.id;
  select * into acc from app_private.provider_accounts where id = m.provider_account_id;
  v_defaults := app_private.spec_defaults(c.spec);
  v_refs := coalesce((c.spec -> 'references' ->> 'min')::int, 0);
  v_adapter := exists (select 1 from app_private.provider_adapters a where a.adapter = m.adapter);

  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'adapter', 'ok', v_adapter,
    'label', 'Integration implemented', 'detail', case when v_adapter then 'Adapter ' || m.adapter || ' is part of this release.'
      else 'This release cannot send work to this model yet.' end));
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'schema', 'ok', c.id is not null and c.spec ? 'options' and c.spec ? 'output',
    'label', 'Supported options defined', 'detail', 'Option schema version ' || coalesce(c.version::text, '—') || '.'));
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'provider_account', 'ok', acc.enabled and not acc.paused,
    'label', 'KIE account active', 'detail', case when acc.paused then 'The KIE account is paused in Genlixs.' when not acc.enabled then 'The KIE account is disabled.' else 'KIE account is active.' end));

  if sc.id is not null then
    for cfg in select * from app_private.price_configs(c.spec, app_private.price_dims(sc.schedule)) loop
      v_n := v_n + 1;
      if app_private.supplier_credits(sc.schedule, cfg, v_refs, 1) is null then v_missing := v_missing + 1; end if;
    end loop;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'supplier_cost', 'ok', sc.id is not null and v_n > 0 and v_missing = 0,
    'label', 'KIE reference price', 'fix', case when sc.id is null or v_n = 0 or v_missing > 0 then 'edit_cost' end,
    'detail', case when sc.id is null then 'KIE reference needed: no KIE price is recorded for this model.'
      when v_n = 0 or v_missing > 0 then 'KIE reference needed for ' || greatest(v_missing, 1) || ' setting(s).'
      else 'KIE price list v' || sc.version || ' (' || sc.source_kind || ', checked ' || to_char(sc.source_checked_at, 'YYYY-MM-DD') || ').' end));

  v_complete := false;
  if pub.id is not null then
    v_complete := true;
    if pub.rules ->> 'format' = 'table' then
      -- "_refs" (reference-image count) is not a model option; the lookup adds it from the request.
      for cfg in select * from app_private.price_configs(c.spec, (pub.rules -> 'dims') - '_refs') loop
        if app_private.price_units_for(pub.rules, v_defaults || cfg, v_refs) is null then v_complete := false; end if;
      end loop;
    end if;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'price', 'ok', v_complete,
    'label', 'Automatic price', 'fix', case when v_complete then null when sc.id is null or v_n = 0 or v_missing > 0 then 'edit_cost' else 'apply_policy' end,
    'draftPriceVersionId', null,
    'detail', case when v_complete then 'Price v' || pub.version || ' follows the global pricing policy.'
      when sc.id is null or v_n = 0 or v_missing > 0 then
        case when pub.id is not null then 'Some settings have no price: KIE reference needed.' else 'No price yet: KIE reference needed.' end
      else 'No price yet. Save & apply the global pricing policy to price it.' end));
  -- Informational only: a paid private test is optional and never blocks switching a model on.
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'verification', 'warning', true,
    'ok', (m.verification_status = 'verified_by_test' and m.verified_capability_version_id = c.id) or m.verification_status = 'manual_evidence',
    'label', 'Private test (optional)', 'fix', null,
    'detail', case
      when m.verification_status = 'verified_by_test' and m.verified_capability_version_id = c.id then 'A private test completed and its output was validated.'
      when m.verification_status = 'verified_by_test' then 'Tested with older options.'
      when m.verification_status = 'manual_evidence' then 'Manual evidence recorded (not an integrated test).'
      when m.verification_status = 'test_failed' then 'The latest private test failed.'
      else 'Not tested yet.' end));
  return jsonb_build_object('checks', v_checks, 'capabilityVersionId', c.id,
    'blocking', (select count(*) from jsonb_array_elements(v_checks) x where not (x ->> 'ok')::boolean and not coalesce((x ->> 'warning')::boolean, false)));
end;
$$;

-- ============================================================ supplier view with prices

-- admin_catalog_supply (provider.read) adds the policy and, per model, the price of its default request: the KIE
-- reference B, the target B × (1 + M), the credits charged and their value, and whether the published table follows the
-- policy. Everything else is unchanged.
create or replace function public.admin_catalog_supply()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('provider.read');
  pol app_private.pricing_policy_versions := app_private.current_pricing_policy();
  t jsonb := app_private.policy_terms(app_private.current_pricing_policy());
  v_bps int := (t ->> 'markupBps')::int;
  v_v numeric := (t ->> 'usdPerCredit')::numeric;
  v_upu numeric := (t ->> 'kieUnitsPerUsd')::numeric;
begin
  return jsonb_build_object(
    'generatedAt', now(),
    'policy', app_private.policy_json(pol),
    'suppliers', (select coalesce(jsonb_agg(jsonb_build_object('provider', a.provider, 'name', coalesce(a.display_name, a.provider),
        'on', a.enabled and not a.paused, 'hasKey', a.credential_version > 0 or a.secret_ref = 'KIE_API_KEY') order by a.sort_order), '[]'::jsonb)
      from app_private.provider_accounts a where a.provider <> 'fake'),
    'models', (select coalesce(jsonb_agg(x.j order by x.sort_order), '[]'::jsonb) from (
      select m.sort_order, jsonb_build_object(
        'id', m.id,
        'example', ex.e,
        -- Genlixs credits charged for the default request by the published price (null when not priced).
        'defaultUnits', du.units,
        'pricing', jsonb_build_object(
          'status', g.r ->> 'status', 'reason', g.r ->> 'reason',
          'followsPolicy', coalesce(pub.id is not null and pub.capability_version_id = cv.id and pub.rules = g.r -> 'rules', false),
          'priceVersion', pub.version, 'priceSource', pub.source,
          'policyVersion', (select pp.version from app_private.pricing_policy_versions pp where pp.id = pub.policy_version_id),
          'kieUsd', trim_scale(kb.usd), 'targetUsd', trim_scale(round(kb.usd * (10000 + v_bps) / 10000, 8)),
          'chargedUsd', trim_scale(du.units * v_v),
          'cost', case when sc.id is not null then jsonb_build_object('version', sc.version, 'sourceKind', sc.source_kind, 'sourceUrl', sc.source_url,
            'checkedAt', sc.source_checked_at) end),
        'route', jsonb_build_object('status', ch.r ->> 'status', 'explanation', ch.r ->> 'explanation',
            'offerId', ch.r -> 'chosen' ->> 'offerId', 'provider', ch.r -> 'chosen' ->> 'provider', 'providerName', ch.r -> 'chosen' ->> 'providerLabel',
            'legacy', (ch.r -> 'chosen' ->> 'legacy')::boolean, 'native', (ch.r -> 'chosen' ->> 'native')::numeric, 'unit', ch.r -> 'chosen' ->> 'unit',
            'usd', (ch.r -> 'chosen' ->> 'effectiveUsd')::numeric,
            -- effective markup on what the serving supplier costs: (charged value − C) ÷ C
            'effectiveMarkupPct', app_private.effective_markup_pct(du.units * v_v, (ch.r -> 'chosen' ->> 'effectiveUsd')::numeric)),
        'quotes', (select coalesce(jsonb_agg(q.j order by (q.j ->> 'usd')::numeric nulls last, q.sort), '[]'::jsonb) from (
            select f.sort_order as sort, jsonb_build_object(
              'offerId', f.id, 'provider', a.provider, 'providerName', coalesce(a.display_name, a.provider), 'legacy', f.is_legacy_primary,
              'status', f.status, 'decision', f.decision, 'decisionReason', f.decision_reason, 'blocker', f.blocker,
              'routingEnabled', f.routing_enabled, 'supplierOn', a.enabled and not a.paused,
              'hasKey', a.credential_version > 0 or a.secret_ref = 'KIE_API_KEY', 'integrated', f.adapter is not null,
              'confidence', pp.p ->> 'confidence', 'unit', pp.p ->> 'unit', 'unitBasis', cu.basis,
              'incompatible', inc.v, 'native', nat.v,
              'usd', app_private.effective_usd(nat.v, cu.units_per_usd, a.funding_fee_bps, a.funding_bonus_bps),
              'markupIfServedPct', app_private.effective_markup_pct(du.units * v_v,
                app_private.effective_usd(nat.v, cu.units_per_usd, a.funding_fee_bps, a.funding_bonus_bps)),
              'current', f.id::text = ch.r -> 'chosen' ->> 'offerId',
              -- The first step still missing before this offer can serve customers (in the order they are done).
              'stage', case
                when f.id::text = ch.r -> 'chosen' ->> 'offerId' then 'serving'
                when f.adapter is null then 'needs_integration'
                when pp.p is null or pp.p ->> 'confidence' in ('conflicting', 'unverified') then 'price_unverified'
                when not (a.credential_version > 0 or a.secret_ref = 'KIE_API_KEY') then 'needs_key'
                when f.status <> 'eligible' then 'needs_test'
                when not a.enabled or a.paused then 'supplier_off'
                when not f.routing_enabled then 'routing_off'
                else 'standby' end) as j
            from app_private.provider_offers f
            join app_private.provider_accounts a on a.id = f.provider_account_id
            cross join lateral (select app_private.offer_price(f.id) as p) pp
            left join lateral (select * from app_private.cost_unit(pp.p ->> 'unit')) cu on true
            cross join lateral (select app_private.offer_incompatibility(f.capabilities, ex.e -> 'options', ex.e ->> 'mode', ex.e -> 'quantities') as v) inc
            cross join lateral (select case when inc.v is null and pp.p is not null
                then app_private.offer_native_cost(pp.p -> 'schedule', ex.e -> 'options', ex.e -> 'quantities') end as v) nat
            where f.model_id = m.id) q)
      ) as j
      from app_private.model_catalog m
      cross join lateral (select * from app_private.capability_for(m.id)) cv
      cross join lateral (select app_private.example_request(cv.spec) as e) ex
      left join lateral (select * from app_private.latest_cost_version(m.id)) sc on true
      left join app_private.price_versions pub on pub.model_id = m.id and pub.state = 'published'
      cross join lateral (select case when pub.id is not null and pub.capability_version_id = cv.id
          then app_private.price_units_for(pub.rules, ex.e -> 'options', coalesce((ex.e -> 'quantities' -> 'counts' ->> '_references')::int, 0)) end as units) du
      cross join lateral (select app_private.kie_reference_usd(app_private.supplier_credits(sc.schedule, ex.e -> 'options',
          coalesce((ex.e -> 'quantities' -> 'counts' ->> '_references')::int, 0), coalesce((cv.spec -> 'output' ->> 'count')::int, 1)), v_upu) as usd) kb
      cross join lateral (select app_private.policy_model_rules(m.id, v_bps, v_v, v_upu) as r) g
      cross join lateral (select app_private.route_choose(m.id, ex.e -> 'options', ex.e ->> 'mode', ex.e -> 'quantities') as r) ch
    ) x),
    'products', (select coalesce(jsonb_agg(g.j order by g.tool, g.product_key), '[]'::jsonb) from (
      select f.product_key, min(f.tool) as tool, jsonb_build_object('productKey', f.product_key, 'tool', min(f.tool), 'operation', min(f.operation),
        'offers', jsonb_agg(jsonb_build_object('offerId', f.id, 'provider', a.provider, 'providerName', coalesce(a.display_name, a.provider),
            'label', f.product_label, 'status', f.status, 'decision', f.decision, 'decisionReason', f.decision_reason, 'blocker', f.blocker,
            'integrated', f.adapter is not null, 'confidence', pp.p ->> 'confidence', 'unit', pp.p ->> 'unit', 'unitBasis', cu.basis,
            'basis', pp.p -> 'schedule' ->> 'basis', 'dims', pp.p -> 'schedule' -> 'dims', 'sourceUrl', f.source_url,
            -- USD per output, per second or per request for each listed configuration (funding terms applied).
            'ratesUsd', (select jsonb_object_agg(r.key, app_private.effective_usd(app_private.num(r.value), cu.units_per_usd, a.funding_fee_bps, a.funding_bonus_bps))
                from jsonb_each(coalesce(pp.p -> 'schedule' -> 'rates', '{}'::jsonb)) r),
            'fromUsd', (select min(app_private.effective_usd(app_private.num(r.value), cu.units_per_usd, a.funding_fee_bps, a.funding_bonus_bps))
                from jsonb_each(coalesce(pp.p -> 'schedule' -> 'rates', '{}'::jsonb)) r))
          order by a.sort_order)) as j
      from app_private.provider_offers f
      join app_private.provider_accounts a on a.id = f.provider_account_id
      cross join lateral (select app_private.offer_price(f.id) as p) pp
      left join lateral (select * from app_private.cost_unit(pp.p ->> 'unit')) cu on true
      where f.model_id is null
      group by f.product_key
    ) g)
  );
end;
$$;

-- ===================================================================== first policy

-- +100 % on the KIE reference at the current Genlixs credit value: the published prices were built that way, so every
-- model is expected to be unchanged (only models whose table differs get a new version).
do $$
declare
  p app_private.pricing_policy_versions;
begin
  if (app_private.current_reference('credit_value')).id is null then
    raise exception 'Set the Genlixs credit value before enabling automatic pricing';
  end if;
  p := app_private.new_pricing_policy(10000, (app_private.current_reference('credit_value')).id, null,
    'Automatic pricing: +100 % on the KIE reference at the current Genlixs credit value');
  perform app_private.policy_apply_all(p, null);
end;
$$;
