-- Genlixs 13 · Admin catalog upgrade, functions: configuration-level supplier cost and price math, the credit
-- economy (conservative revenue per credit, 30 %/50 % commission scenarios), bulk pricing batches with stale-preview
-- protection, availability checks, private staff tests, provider balance and usage, and the customer catalog/quote
-- changes. Every admin RPC re-checks the caller's staff capability and writes its own audit row.

-- =====================================================================================================
-- Configuration math
-- =====================================================================================================

create or replace function app_private.model_category(p_tool text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p_tool = 'video' then 'video' else 'image' end;
$$;

-- Key of one configuration: option values in dimension order joined by "|" (numbers as text, strings unquoted).
create or replace function app_private.option_key(p_dims jsonb, p_options jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select coalesce(string_agg(coalesce(p_options ->> d.value, ''), '|' order by d.ord), '')
  from jsonb_array_elements_text(coalesce(p_dims, '[]'::jsonb)) with ordinality as d(value, ord);
$$;

create or replace function app_private.spec_defaults(p_spec jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(o.key, o.value -> 'default'), '{}'::jsonb)
  from jsonb_each(coalesce(p_spec -> 'options', '{}'::jsonb)) o;
$$;

create or replace function app_private.latest_cost_version(p_model_id text)
returns app_private.supplier_cost_versions
language sql
stable
set search_path = ''
as $$
  select * from app_private.supplier_cost_versions where model_id = p_model_id order by version desc limit 1;
$$;

-- Options that select a price: the cost schedule's dimensions plus the duration for per-second schedules.
create or replace function app_private.price_dims(p_schedule jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when p_schedule ->> 'unit' = 'second'
    then coalesce(p_schedule -> 'dims', '[]'::jsonb) || to_jsonb(coalesce(p_schedule ->> 'durationOption', 'duration'))
    else coalesce(p_schedule -> 'dims', '[]'::jsonb) end;
$$;

-- Every combination of the offered values of the given dimensions. A dimension the model does not offer yields no
-- configuration at all (the schedule and the capability disagree; callers report it).
create or replace function app_private.price_configs(p_spec jsonb, p_dims jsonb)
returns setof jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_set jsonb[] := array['{}'::jsonb];
  v_next jsonb[];
  d text;
  c jsonb;
  val jsonb;
begin
  for d in select value from jsonb_array_elements_text(coalesce(p_dims, '[]'::jsonb)) loop
    if not coalesce(p_spec -> 'options' ? d, false) then
      return;
    end if;
    v_next := array[]::jsonb[];
    foreach c in array v_set loop
      for val in select value from jsonb_array_elements(p_spec -> 'options' -> d -> 'values') loop
        v_next := v_next || (c || jsonb_build_object(d, val));
      end loop;
    end loop;
    v_set := v_next;
  end loop;
  foreach c in array v_set loop
    return next c;
  end loop;
end;
$$;

-- KIE credits for one configuration, all applicable charges once: rate × (seconds) × outputs + extra references.
-- NULL means the cost is unknown; it is never zero by default.
create or replace function app_private.supplier_credits(p_schedule jsonb, p_options jsonb, p_ref_count int default 0, p_outputs int default 1)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_rate numeric;
  v_secs numeric;
  v_extra numeric := 0;
begin
  if p_schedule is null then
    return null;
  end if;
  v_rate := (p_schedule -> 'rates' ->> app_private.option_key(p_schedule -> 'dims', p_options))::numeric;
  if v_rate is null then
    return null;
  end if;
  if p_schedule ->> 'unit' = 'second' then
    v_secs := (p_options ->> coalesce(p_schedule ->> 'durationOption', 'duration'))::numeric;
    if v_secs is null or v_secs <= 0 then
      return null;
    end if;
    v_rate := v_rate * v_secs;
  end if;
  if p_schedule ? 'extraReference' then
    v_extra := greatest(coalesce(p_ref_count, 0) - coalesce((p_schedule -> 'extraReference' ->> 'free')::int, 0), 0)
               * coalesce((p_schedule -> 'extraReference' ->> 'credits')::numeric, 0);
  end if;
  return v_rate * greatest(coalesce(p_outputs, 1), 1) + v_extra;
end;
$$;

-- Customer credit units for a configuration. Table rules (bulk/manual prices) list every configuration; the
-- launch "base + add" format is still read for older versions. NULL = no price for this combination.
create or replace function app_private.price_units_for(p_rules jsonb, p_options jsonb, p_ref_count int default 0)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v bigint;
begin
  if p_rules ->> 'format' = 'table' then
    v := (p_rules -> 'units' ->> app_private.option_key(p_rules -> 'dims', p_options))::bigint;
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

-- =====================================================================================================
-- Credit economy
-- =====================================================================================================

-- Revenue per usable Genlixs credit for each applicable package: published packages when any exist, otherwise the
-- latest drafts (labelled). Package revenue is the list price before tax — the same base commissions use. The
-- conservative basis is the LOWEST revenue per credit. p_overrides = {"<key>": {"amountMinor": n, "credits": n}}.
create or replace function app_private.revenue_basis(p_overrides jsonb default null)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_source text := case when exists (select 1 from app_private.product_versions where state = 'published') then 'published' else 'draft' end;
  v_rows jsonb := '[]'::jsonb;
  v_excluded jsonb := '[]'::jsonb;
  v_min numeric;
  v_min_row jsonb;
  v_row jsonb;
  v_amount bigint;
  v_credits bigint;
  v_rpc numeric;
  r record;
begin
  for r in
    select distinct on (pv.product_key) pv.*
    from app_private.product_versions pv
    where pv.state = v_source
    order by pv.product_key, pv.version desc
  loop
    v_amount := coalesce((p_overrides -> r.product_key ->> 'amountMinor')::bigint, r.amount_minor);
    v_credits := coalesce((p_overrides -> r.product_key ->> 'credits')::bigint, r.credits);
    if r.currency <> 'USD' then
      v_excluded := v_excluded || jsonb_build_array(jsonb_build_object('key', r.product_key, 'name', r.name,
        'reason', 'Priced in ' || r.currency || '; no verified exchange rate is configured.'));
      continue;
    end if;
    if v_amount <= 0 or v_credits <= 0 then
      v_excluded := v_excluded || jsonb_build_array(jsonb_build_object('key', r.product_key, 'name', r.name, 'reason', 'Price and credits must be positive.'));
      continue;
    end if;
    v_rpc := round((v_amount::numeric / 100) / v_credits, 10);
    v_row := jsonb_build_object('key', r.product_key, 'name', r.name, 'kind', r.kind, 'version', r.version, 'state', r.state,
      'productVersionId', r.id, 'currency', r.currency, 'amountMinor', v_amount::text, 'credits', v_credits::text,
      'revenuePerCredit', v_rpc, 'overridden', coalesce(p_overrides ? r.product_key, false));
    v_rows := v_rows || jsonb_build_array(v_row);
    if v_min is null or v_rpc < v_min then
      v_min := v_rpc;
      v_min_row := v_row;
    end if;
  end loop;
  return jsonb_build_object(
    'source', case when v_min is null then 'none' else v_source end,
    'currency', 'USD',
    'minRevenuePerCredit', v_min,
    'conservative', v_min_row,
    'products', v_rows,
    'excluded', v_excluded,
    'note', 'Revenue per usable credit = package price before tax ÷ credits granted. The lowest value is used so every package covers the price.'
  );
end;
$$;

create or replace function app_private.pricing_assumptions()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'usdPerKieCredit', (app_private.setting('kie_usd_per_credit') #>> '{}')::numeric,
    'paymentFeeBps', (app_private.setting('pricing_payment_fee_bps') #>> '{}')::numeric,
    'paymentFixedFeeUsd', (app_private.setting('pricing_payment_fixed_fee_usd') #>> '{}')::numeric,
    'operatingCostUsdPerJob', (app_private.setting('pricing_operating_cost_usd_per_job') #>> '{}')::numeric,
    'staleDays', coalesce((app_private.setting('supplier_cost_stale_days') #>> '{}')::int, 30),
    'affiliate', coalesce((
      select jsonb_build_object('source', a.state, 'version', a.version, 'baseBps', a.base_rate_bps, 'upliftBps', a.uplift_rate_bps,
        'threshold', a.uplift_threshold)
      from public.affiliate_agreement_versions a where a.state in ('published', 'draft')
      order by (a.state = 'published') desc, a.version desc limit 1),
      jsonb_build_object('source', 'default', 'version', null, 'baseBps', 3000, 'upliftBps', 5000, 'threshold', 10))
  );
$$;

-- Estimated contribution of one generation (USD). Unknown fees/costs are left out and listed in "excludes";
-- the result is then "contribution before those costs", never net profit.
create or replace function app_private.contribution(p_units numeric, p_supplier_usd numeric, p_basis jsonb, p_assump jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_rpc numeric := (p_basis ->> 'minRevenuePerCredit')::numeric;
  v_pack numeric := (p_basis -> 'conservative' ->> 'credits')::numeric;
  v_fee numeric := (p_assump ->> 'paymentFeeBps')::numeric;
  v_fixed numeric := (p_assump ->> 'paymentFixedFeeUsd')::numeric;
  v_op numeric := (p_assump ->> 'operatingCostUsdPerJob')::numeric;
  v_base numeric := coalesce((p_assump -> 'affiliate' ->> 'baseBps')::numeric, 3000);
  v_up numeric := coalesce((p_assump -> 'affiliate' ->> 'upliftBps')::numeric, 5000);
  v_rev numeric;
  v_costs numeric;
  v_excl text[] := '{}';
begin
  if v_rpc is null or p_units is null or p_supplier_usd is null then
    return null;
  end if;
  v_rev := p_units * v_rpc;
  v_costs := p_supplier_usd
    + coalesce(case when v_fixed is not null and v_pack > 0 then v_fixed / v_pack * p_units end, 0)
    + coalesce(v_op, 0);
  if v_fee is null then v_excl := v_excl || 'variable payment fees'; end if;
  if v_fixed is null then v_excl := v_excl || 'fixed payment fees'; end if;
  if v_op is null then v_excl := v_excl || 'operating costs'; end if;
  return jsonb_build_object(
    'revenueUsd', round(v_rev, 6),
    'direct', round(v_rev * (1 - coalesce(v_fee, 0) / 10000) - v_costs, 6),
    'affiliateBase', round(v_rev * (1 - v_base / 10000 - coalesce(v_fee, 0) / 10000) - v_costs, 6),
    'affiliateUplift', round(v_rev * (1 - v_up / 10000 - coalesce(v_fee, 0) / 10000) - v_costs, 6),
    'excludes', to_jsonb(v_excl)
  );
end;
$$;

create or replace function app_private.markup_bps(p_percent numeric)
returns int
language plpgsql
set search_path = ''
as $$
begin
  if p_percent is null or p_percent < 0 or p_percent > 2000 then
    perform app_private.fail('INVALID_MARKUP', 'Enter a markup between 0 % and 2000 % above the KIE cost.');
  end if;
  if p_percent * 100 <> trunc(p_percent * 100) then
    perform app_private.fail('INVALID_MARKUP', 'Use at most two decimals for the markup.');
  end if;
  return (p_percent * 100)::int;
end;
$$;

-- =====================================================================================================
-- Per-model price table (current, draft and proposed) and bulk pricing
-- =====================================================================================================

-- One model's configurations with supplier cost, current/draft charges and — when p_markup_bps is given — the
-- proposed charge: ceil(cost × (1 + markup) ÷ conservative revenue per credit), at least 1 credit.
create or replace function app_private.model_price_table(p_model_id text, p_markup_bps int, p_basis jsonb, p_assump jsonb, p_include_overrides boolean default false)
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
  dr app_private.price_versions;
  cur app_private.price_versions;
  v_rpc numeric := (p_basis ->> 'minRevenuePerCredit')::numeric;
  v_dims jsonb;
  v_defaults jsonb;
  v_refs int;
  v_outputs int;
  v_rows jsonb := '[]'::jsonb;
  v_units jsonb := '{}'::jsonb;
  v_rules jsonb;
  cfg jsonb;
  v_full jsonb;
  v_key text;
  v_sc numeric;
  v_susd numeric;
  v_target numeric;
  v_new bigint;
  v_old bigint;
  v_draft bigint;
  v_n int := 0;
  v_missing int := 0;
  v_loss int := 0;
  v_direct_loss int := 0;
  v_status text := 'ok';
  v_stale boolean := false;
  v_override boolean := false;
  v_extra jsonb;
  v_extra_units bigint;
  v_contrib jsonb;
  v_min_s numeric; v_max_s numeric; v_min_n bigint; v_max_n bigint; v_worst numeric;
begin
  select * into m from app_private.model_catalog where id = p_model_id;
  if not found then
    return null;
  end if;
  c := app_private.capability_for(m.id);
  sc := app_private.latest_cost_version(m.id);
  select * into pub from app_private.price_versions where model_id = m.id and state = 'published';
  select * into dr from app_private.price_versions where model_id = m.id and state = 'draft' order by version desc limit 1;
  cur := coalesce(pub, dr);
  v_override := cur.id is not null and cur.source in ('manual', 'restore');
  v_defaults := app_private.spec_defaults(c.spec);
  v_refs := coalesce((c.spec -> 'references' ->> 'min')::int, 0);
  v_outputs := coalesce((c.spec -> 'output' ->> 'count')::int, 1);

  if sc.id is null then
    v_status := 'missing_cost';
  else
    v_stale := sc.source_checked_at < now() - make_interval(days => coalesce((p_assump ->> 'staleDays')::int, 30));
    v_dims := app_private.price_dims(sc.schedule);
    for cfg in select * from app_private.price_configs(c.spec, v_dims) loop
      v_n := v_n + 1;
      v_full := v_defaults || cfg;
      v_key := app_private.option_key(v_dims, cfg);
      v_sc := app_private.supplier_credits(sc.schedule, cfg, v_refs, v_outputs);
      v_susd := round(v_sc * sc.usd_per_credit, 8);
      if v_sc is null then
        v_missing := v_missing + 1;
      end if;
      v_new := null;
      if p_markup_bps is not null and v_susd is not null and v_rpc is not null and v_rpc > 0 then
        v_target := round(v_susd * (10000 + p_markup_bps) / 10000, 8);
        v_new := greatest(ceil(round(v_target / v_rpc, 12))::bigint, 1);
        v_units := v_units || jsonb_build_object(v_key, v_new);
      end if;
      v_old := case when pub.id is not null and pub.capability_version_id = c.id then app_private.price_units_for(pub.rules, v_full, v_refs) end;
      v_draft := case when dr.id is not null and dr.capability_version_id = c.id then app_private.price_units_for(dr.rules, v_full, v_refs) end;
      v_contrib := app_private.contribution(coalesce(v_new, v_old, v_draft), v_susd, p_basis, p_assump);
      if v_contrib is not null and (v_contrib ->> 'affiliateUplift')::numeric < 0 then v_loss := v_loss + 1; end if;
      if v_contrib is not null and (v_contrib ->> 'direct')::numeric < 0 then v_direct_loss := v_direct_loss + 1; end if;
      v_min_s := least(v_min_s, v_sc); v_max_s := greatest(v_max_s, v_sc);
      v_min_n := least(v_min_n, coalesce(v_new, v_old, v_draft)); v_max_n := greatest(v_max_n, coalesce(v_new, v_old, v_draft));
      v_worst := least(v_worst, (v_contrib ->> 'affiliateUplift')::numeric);
      v_rows := v_rows || jsonb_build_array(jsonb_build_object(
        'key', v_key, 'options', cfg,
        'supplierCredits', v_sc, 'supplierUsd', v_susd,
        'currentUnits', v_old, 'draftUnits', v_draft,
        'targetUsd', case when v_new is not null then v_target end, 'proposedUnits', v_new,
        'contribution', v_contrib,
        'currentContribution', case when v_old is not null then app_private.contribution(v_old, v_susd, p_basis, p_assump) end
      ));
    end loop;
    if v_n = 0 or v_missing > 0 then
      v_status := 'incomplete_cost';
    elsif v_rpc is null then
      v_status := 'no_revenue_basis';
    elsif v_override and not coalesce(p_include_overrides, false) and p_markup_bps is not null then
      v_status := 'manual_override';
    end if;
    -- Extra input images, when the supplier bills them and the model accepts more than the free number.
    v_extra := sc.schedule -> 'extraReference';
    if v_extra is not null and coalesce((c.spec -> 'references' ->> 'max')::int, 0) > coalesce((v_extra ->> 'free')::int, 0)
       and p_markup_bps is not null and v_rpc is not null then
      v_extra_units := greatest(ceil(round((v_extra ->> 'credits')::numeric * sc.usd_per_credit * (10000 + p_markup_bps) / 10000 / v_rpc, 12))::bigint, 1);
    end if;
  end if;

  if p_markup_bps is not null and v_status in ('ok', 'manual_override') then
    v_rules := jsonb_build_object('format', 'table', 'dims', v_dims, 'units', v_units)
      || case when v_extra_units is not null then jsonb_build_object('perExtraReference', jsonb_build_object('free', (v_extra ->> 'free')::int, 'units', v_extra_units)) else '{}'::jsonb end;
  end if;

  return jsonb_build_object(
    'modelId', m.id, 'name', m.public_name, 'tool', m.tool, 'category', app_private.model_category(m.tool), 'state', m.state,
    'capabilityVersionId', c.id, 'capabilityVersion', c.version,
    'status', v_status, 'selectable', v_status = 'ok' or (v_status = 'manual_override' and false),
    'override', v_override, 'currentSource', cur.source,
    'cost', case when sc.id is not null then jsonb_build_object('versionId', sc.id, 'version', sc.version, 'unit', sc.schedule ->> 'unit',
      'sourceKind', sc.source_kind, 'sourceUrl', sc.source_url, 'checkedAt', sc.source_checked_at, 'usdPerCredit', sc.usd_per_credit,
      'stale', v_stale, 'note', sc.note) end,
    'published', case when pub.id is not null then jsonb_build_object('id', pub.id, 'version', pub.version, 'source', pub.source,
      'effectiveAt', pub.effective_at, 'currentCapability', pub.capability_version_id = c.id) end,
    'draft', case when dr.id is not null then jsonb_build_object('id', dr.id, 'version', dr.version, 'source', dr.source,
      'currentCapability', dr.capability_version_id = c.id) end,
    'configs', v_rows, 'configCount', v_n, 'missingCost', v_missing,
    'summary', jsonb_build_object('minSupplierCredits', v_min_s, 'maxSupplierCredits', v_max_s, 'minUnits', v_min_n, 'maxUnits', v_max_n,
      'worstUpliftContribution', v_worst, 'lossConfigsUplift', v_loss, 'lossConfigsDirect', v_direct_loss),
    'proposedRules', v_rules, 'perExtraReferenceUnits', v_extra_units
  );
end;
$$;

create or replace function app_private.pricing_scope(p_scope text, p_model_ids text[])
returns text[]
language plpgsql
stable
set search_path = ''
as $$
declare
  v text[];
begin
  if p_scope = 'all' then
    select array_agg(id order by tool, sort_order) into v from app_private.model_catalog;
  elsif p_scope = 'images' then
    select array_agg(id order by tool, sort_order) into v from app_private.model_catalog where tool in ('image', 'edit');
  elsif p_scope = 'videos' then
    select array_agg(id order by tool, sort_order) into v from app_private.model_catalog where tool = 'video';
  elsif p_scope = 'selected' then
    select array_agg(id order by tool, sort_order) into v from app_private.model_catalog where id = any (coalesce(p_model_ids, '{}'));
    if coalesce(cardinality(v), 0) <> coalesce(cardinality(p_model_ids), 0) then
      perform app_private.fail('NOT_FOUND', 'One of the selected models does not exist.');
    end if;
  else
    perform app_private.fail('INVALID_SCOPE', 'Choose all models, images, videos or selected rows.');
  end if;
  if coalesce(cardinality(v), 0) = 0 then
    perform app_private.fail('INVALID_SCOPE', 'Select at least one model.');
  end if;
  return v;
end;
$$;

-- Full preview; "revision" fingerprints every input (prices, drafts, costs, capabilities, packages, assumptions,
-- markup) so applying a stale preview is refused.
create or replace function app_private.pricing_preview(p_models text[], p_markup_bps int, p_include_overrides boolean)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_basis jsonb := app_private.revenue_basis(null);
  v_assump jsonb := app_private.pricing_assumptions();
  v_models jsonb := '[]'::jsonb;
  v_fp jsonb := '[]'::jsonb;
  v_row jsonb;
  mid text;
begin
  foreach mid in array p_models loop
    v_row := app_private.model_price_table(mid, p_markup_bps, v_basis, v_assump, p_include_overrides);
    v_row := v_row || jsonb_build_object('selectable', v_row ->> 'status' = 'ok'
      or (v_row ->> 'status' = 'manual_override' and coalesce(p_include_overrides, false)));
    v_models := v_models || jsonb_build_array(v_row);
    v_fp := v_fp || jsonb_build_array(jsonb_build_array(mid, v_row ->> 'capabilityVersionId', v_row -> 'cost' ->> 'versionId',
      v_row -> 'published' ->> 'id', v_row -> 'draft' ->> 'id', v_row -> 'proposedRules'));
  end loop;
  return jsonb_build_object(
    'revision', md5(jsonb_build_object('m', v_fp, 'b', v_basis, 'a', v_assump, 'k', p_markup_bps, 'o', coalesce(p_include_overrides, false))::text),
    'markupBps', p_markup_bps, 'includeOverrides', coalesce(p_include_overrides, false),
    'basis', v_basis, 'assumptions', v_assump, 'models', v_models, 'generatedAt', now()
  );
end;
$$;

create or replace function public.admin_pricing_preview(p_scope text, p_model_ids text[], p_markup_percent numeric, p_include_overrides boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('pricing.review');
begin
  return app_private.pricing_preview(app_private.pricing_scope(p_scope, p_model_ids), app_private.markup_bps(p_markup_percent), p_include_overrides)
    || jsonb_build_object('scope', p_scope);
end;
$$;

-- Applies a reviewed preview to the selected rows in ONE transaction: every selected row gets a new immutable
-- version (draft, or published replacing the current one), or nothing changes at all.
create or replace function public.admin_pricing_apply(p_scope text, p_model_ids text[], p_markup_percent numeric, p_include_overrides boolean,
  p_preview_revision text, p_action text, p_selected text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_cap text;
  v_bps int := app_private.markup_bps(p_markup_percent);
  v_models text[] := app_private.pricing_scope(p_scope, p_model_ids);
  v_preview jsonb;
  v_row jsonb;
  v_batch uuid;
  v_ref text;
  v_new uuid;
  v_ver int;
  v_items jsonb := '[]'::jsonb;
  pub app_private.price_versions;
  mid text;
begin
  if p_action = 'publish' then
    v_cap := 'catalog.publish';
  elsif p_action = 'draft' then
    v_cap := 'pricing.review';
  else
    perform app_private.fail('INVALID_ACTION', 'Choose save drafts or publish.');
  end if;
  v_actor := app_private.require_capability(v_cap);
  if coalesce(cardinality(p_selected), 0) = 0 then
    perform app_private.fail('NOTHING_SELECTED', 'Select at least one row to apply.');
  end if;
  -- One pricing change at a time; a concurrent apply sees the other's result and a changed revision.
  perform pg_advisory_xact_lock(hashtext('genlixs:pricing'));
  v_preview := app_private.pricing_preview(v_models, v_bps, p_include_overrides);
  if v_preview ->> 'revision' is distinct from p_preview_revision then
    perform app_private.fail('PREVIEW_STALE', 'Prices, supplier costs or packages changed since this preview. Review the refreshed preview before applying.');
  end if;
  foreach mid in array p_selected loop
    select x into v_row from jsonb_array_elements(v_preview -> 'models') x where x ->> 'modelId' = mid;
    if v_row is null then
      perform app_private.fail('NOT_IN_PREVIEW', 'A selected row is not part of this preview.', jsonb_build_object('modelId', mid));
    end if;
    if not (v_row ->> 'selectable')::boolean then
      perform app_private.fail('ROW_NOT_APPLICABLE', 'A selected row cannot be priced from this preview: ' || (v_row ->> 'name') || ' (' || (v_row ->> 'status') || ').',
        jsonb_build_object('modelId', mid, 'status', v_row ->> 'status'));
    end if;
  end loop;

  insert into app_private.pricing_batches (kind, action, scope, markup_bps, include_overrides, preview_revision, basis, actor_id)
  values ('generation', p_action, jsonb_build_object('scope', p_scope, 'modelIds', to_jsonb(v_models), 'selected', to_jsonb(p_selected)),
    v_bps, coalesce(p_include_overrides, false), p_preview_revision,
    jsonb_build_object('revenue', v_preview -> 'basis', 'assumptions', v_preview -> 'assumptions'), v_actor)
  returning id, short_ref into v_batch, v_ref;

  foreach mid in array p_selected loop
    select x into v_row from jsonb_array_elements(v_preview -> 'models') x where x ->> 'modelId' = mid;
    perform 1 from app_private.model_catalog where id = mid for update;
    select * into pub from app_private.price_versions where model_id = mid and state = 'published' for update;
    select coalesce(max(version), 0) + 1 into v_ver from app_private.price_versions where model_id = mid;
    insert into app_private.price_versions (model_id, capability_version_id, version, state, rules, supplier_cost_snapshot, cost_evidence,
      created_by, source, batch_id, supplier_cost_version_id, markup_bps, basis)
    values (mid, (v_row ->> 'capabilityVersionId')::uuid, v_ver, 'draft', v_row -> 'proposedRules', v_row -> 'cost',
      'Bulk markup +' || trim_scale(round(v_bps / 100.0, 2))::text || ' % on KIE cost v' || (v_row -> 'cost' ->> 'version')
        || ' (' || (v_row -> 'cost' ->> 'sourceKind') || ', checked ' || to_char((v_row -> 'cost' ->> 'checkedAt')::timestamptz, 'YYYY-MM-DD') || '), batch ' || v_ref,
      v_actor, 'bulk', v_batch, (v_row -> 'cost' ->> 'versionId')::uuid, v_bps,
      jsonb_build_object('minRevenuePerCredit', v_preview -> 'basis' -> 'minRevenuePerCredit', 'basisSource', v_preview -> 'basis' ->> 'source',
        'conservative', v_preview -> 'basis' -> 'conservative'))
    returning id into v_new;
    -- Older unpublished drafts of this model are superseded (kept as retired history).
    update app_private.price_versions set state = 'retired' where model_id = mid and state = 'draft' and id <> v_new;
    if p_action = 'publish' then
      update app_private.price_versions set state = 'retired' where model_id = mid and state = 'published';
      update app_private.price_versions set state = 'published', effective_at = now(), published_by = v_actor where id = v_new;
    end if;
    insert into app_private.pricing_batch_items (batch_id, model_id, old_price_version_id, new_price_version_id, old_rules, new_rules,
      supplier_cost_version_id, summary)
    values (v_batch, mid, pub.id, v_new, pub.rules, v_row -> 'proposedRules', (v_row -> 'cost' ->> 'versionId')::uuid, v_row -> 'summary');
    v_items := v_items || jsonb_build_array(jsonb_build_object('modelId', mid, 'name', v_row ->> 'name', 'priceVersionId', v_new, 'version', v_ver,
      'oldPriceVersionId', pub.id, 'summary', v_row -> 'summary'));
    pub := null;
  end loop;

  perform app_private.audit(v_actor, v_cap, 'pricing.batch_' || p_action, 'pricing_batch', v_batch::text,
    (case p_action when 'publish' then 'Published' else 'Saved drafts for' end) || ' ' || cardinality(p_selected) || ' model price(s) at +'
      || trim_scale(round(v_bps / 100.0, 2))::text || ' % above KIE cost (batch ' || v_ref || ')',
    null, jsonb_build_object('items', v_items, 'markupBps', v_bps));
  return jsonb_build_object('batchId', v_batch, 'ref', v_ref, 'action', p_action, 'markupBps', v_bps, 'items', v_items, 'createdAt', now());
end;
$$;

-- Manual price for one model: an explicit credit charge for every configuration (a "manual override").
create or replace function public.admin_save_price_draft(p_model_id text, p_units jsonb, p_extra_reference_units int default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('pricing.review');
  c app_private.model_capability_versions := app_private.capability_for(p_model_id);
  sc app_private.supplier_cost_versions := app_private.latest_cost_version(p_model_id);
  v_dims jsonb;
  v_units jsonb := '{}'::jsonb;
  v_rules jsonb;
  v_key text;
  v_val jsonb;
  cfg jsonb;
  v_n int := 0;
  v_id uuid;
  v_ver int;
begin
  if c.id is null then perform app_private.fail('NOT_FOUND', 'Model not found.'); end if;
  if sc.id is null then
    perform app_private.fail('COST_SCHEDULE_REQUIRED', 'Record the KIE cost schedule for this model first; prices are set per configuration.');
  end if;
  if jsonb_typeof(p_units) <> 'object' then perform app_private.fail('INVALID_INPUT', 'Enter a credit charge for every configuration.'); end if;
  v_dims := app_private.price_dims(sc.schedule);
  for cfg in select * from app_private.price_configs(c.spec, v_dims) loop
    v_n := v_n + 1;
    v_key := app_private.option_key(v_dims, cfg);
    v_val := p_units -> v_key;
    if v_val is null or jsonb_typeof(v_val) <> 'number' or (v_val #>> '{}')::numeric <> trunc((v_val #>> '{}')::numeric)
       or (v_val #>> '{}')::numeric < 1 or (v_val #>> '{}')::numeric > 1000000 then
      perform app_private.fail('INVALID_PRICE', 'Every configuration needs a whole number of credits (at least 1).', jsonb_build_object('configuration', v_key));
    end if;
    v_units := v_units || jsonb_build_object(v_key, (v_val #>> '{}')::bigint);
  end loop;
  if v_n = 0 then perform app_private.fail('INCOMPLETE_COST', 'The cost schedule does not match this model''s options.'); end if;
  if (select count(*) from jsonb_object_keys(p_units)) <> v_n then
    perform app_private.fail('INVALID_PRICE', 'The price lists configurations this model does not offer.');
  end if;
  if p_extra_reference_units is not null and p_extra_reference_units < 0 then
    perform app_private.fail('INVALID_PRICE', 'Extra reference charge cannot be negative.');
  end if;
  v_rules := jsonb_build_object('format', 'table', 'dims', v_dims, 'units', v_units)
    || case when p_extra_reference_units is not null and sc.schedule ? 'extraReference'
         then jsonb_build_object('perExtraReference', jsonb_build_object('free', (sc.schedule -> 'extraReference' ->> 'free')::int, 'units', p_extra_reference_units))
         else '{}'::jsonb end;
  perform 1 from app_private.model_catalog where id = p_model_id for update;
  select coalesce(max(version), 0) + 1 into v_ver from app_private.price_versions where model_id = p_model_id;
  insert into app_private.price_versions (model_id, capability_version_id, version, state, rules, supplier_cost_snapshot, cost_evidence, created_by,
    source, supplier_cost_version_id)
  values (p_model_id, c.id, v_ver, 'draft', v_rules,
    jsonb_build_object('versionId', sc.id, 'version', sc.version, 'checkedAt', sc.source_checked_at, 'usdPerCredit', sc.usd_per_credit),
    coalesce(nullif(trim(p_note), ''), 'Manual price on KIE cost v' || sc.version), v_actor, 'manual', sc.id)
  returning id into v_id;
  update app_private.price_versions set state = 'retired' where model_id = p_model_id and state = 'draft' and id <> v_id;
  perform app_private.audit(v_actor, 'pricing.review', 'price.draft', 'price_version', v_id::text,
    'Saved manual price draft v' || v_ver || ' for ' || p_model_id, null, v_rules);
  return jsonb_build_object('priceVersionId', v_id, 'version', v_ver, 'state', 'draft');
end;
$$;

-- Publication: the version must cover every configuration of the current capability. Selling below the KIE cost
-- (direct loss) is an exceptional override and needs a typed reason; routine publications are described automatically.
create or replace function public.admin_publish_price_version(p_price_version_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('catalog.publish');
  p app_private.price_versions;
  c app_private.model_capability_versions;
  sc app_private.supplier_cost_versions;
  v_basis jsonb := app_private.revenue_basis(null);
  v_rpc numeric;
  v_dims jsonb;
  v_defaults jsonb;
  v_refs int;
  v_units bigint;
  v_cost numeric;
  v_below jsonb := '[]'::jsonb;
  cfg jsonb;
  v_old uuid;
begin
  select * into p from app_private.price_versions where id = p_price_version_id for update;
  if not found or p.state <> 'draft' then perform app_private.fail('INVALID_STATE', 'Only a draft price version can be published.'); end if;
  c := app_private.capability_for(p.model_id);
  if p.capability_version_id <> c.id then
    perform app_private.fail('STALE_CAPABILITY', 'This price was drafted for an older set of model options. Create a new price.');
  end if;
  v_rpc := (v_basis ->> 'minRevenuePerCredit')::numeric;
  sc := app_private.latest_cost_version(p.model_id);
  v_defaults := app_private.spec_defaults(c.spec);
  v_refs := coalesce((c.spec -> 'references' ->> 'min')::int, 0);
  v_dims := case when p.rules ->> 'format' = 'table' then p.rules -> 'dims' else app_private.price_dims(sc.schedule) end;
  if v_dims is null then
    v_dims := (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(coalesce(c.spec -> 'options', '{}'::jsonb)) k);
  end if;
  for cfg in select * from app_private.price_configs(c.spec, v_dims) loop
    v_units := app_private.price_units_for(p.rules, v_defaults || cfg, v_refs);
    if v_units is null or v_units <= 0 then
      perform app_private.fail('PRICE_INCOMPLETE', 'This price has no valid charge for one of the model''s configurations.',
        jsonb_build_object('configuration', app_private.option_key(v_dims, cfg)));
    end if;
    if sc.id is not null and v_rpc is not null then
      v_cost := app_private.supplier_credits(sc.schedule, v_defaults || cfg, v_refs, coalesce((c.spec -> 'output' ->> 'count')::int, 1)) * sc.usd_per_credit;
      if v_cost is not null and v_units * v_rpc < v_cost then
        v_below := v_below || jsonb_build_array(app_private.option_key(v_dims, cfg));
      end if;
    end if;
  end loop;
  if jsonb_array_length(v_below) > 0 and coalesce(trim(p_reason), '') = '' then
    perform app_private.fail('LOSS_REASON_REQUIRED', 'Some configurations would sell below the KIE cost at the lowest package rate. Type a reason to publish anyway.',
      jsonb_build_object('configurations', v_below));
  end if;
  select id into v_old from app_private.price_versions where model_id = p.model_id and state = 'published';
  update app_private.price_versions set state = 'retired' where model_id = p.model_id and state = 'published';
  update app_private.price_versions set state = 'retired' where model_id = p.model_id and state = 'draft' and id <> p.id and version < p.version;
  update app_private.price_versions set state = 'published', effective_at = now(), published_by = v_actor where id = p.id;
  perform app_private.audit(v_actor, 'catalog.publish', 'price.publish', 'price_version', p.id::text,
    coalesce(nullif(trim(p_reason), ''), 'Published price v' || p.version || ' for ' || p.model_id),
    jsonb_build_object('previousPublished', v_old), jsonb_build_object('rules', p.rules, 'belowCost', v_below));
  return jsonb_build_object('priceVersionId', p.id, 'state', 'published', 'belowCost', v_below);
end;
$$;
revoke execute on function public.admin_publish_price_version(uuid, text) from public, anon;
grant execute on function public.admin_publish_price_version(uuid, text) to authenticated;

-- Restoring an earlier price publishes a NEW version that copies it; history is never edited.
create or replace function public.admin_restore_price_version(p_price_version_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('catalog.publish');
  src app_private.price_versions;
  v_ver int;
  v_new uuid;
  v_batch uuid;
  v_ref text;
  pub app_private.price_versions;
begin
  select * into src from app_private.price_versions where id = p_price_version_id;
  if not found then perform app_private.fail('NOT_FOUND', 'Price version not found.'); end if;
  if src.state = 'published' then perform app_private.fail('INVALID_STATE', 'This version is already the current price.'); end if;
  if src.capability_version_id <> (app_private.capability_for(src.model_id)).id then
    perform app_private.fail('STALE_CAPABILITY', 'This version was made for an older set of model options and cannot be restored.');
  end if;
  perform pg_advisory_xact_lock(hashtext('genlixs:pricing'));
  perform 1 from app_private.model_catalog where id = src.model_id for update;
  select * into pub from app_private.price_versions where model_id = src.model_id and state = 'published' for update;
  insert into app_private.pricing_batches (kind, action, scope, markup_bps, basis, actor_id)
  values ('restore', 'publish', jsonb_build_object('modelIds', jsonb_build_array(src.model_id), 'restoredFrom', src.id), src.markup_bps,
    jsonb_build_object('revenue', app_private.revenue_basis(null)), v_actor)
  returning id, short_ref into v_batch, v_ref;
  select coalesce(max(version), 0) + 1 into v_ver from app_private.price_versions where model_id = src.model_id;
  insert into app_private.price_versions (model_id, capability_version_id, version, state, rules, supplier_cost_snapshot, cost_evidence, created_by,
    source, batch_id, supplier_cost_version_id, markup_bps, basis, restored_from)
  values (src.model_id, src.capability_version_id, v_ver, 'draft', src.rules, src.supplier_cost_snapshot,
    'Restored from v' || src.version || ' (batch ' || v_ref || ')', v_actor, 'restore', v_batch, src.supplier_cost_version_id, src.markup_bps, src.basis, src.id)
  returning id into v_new;
  update app_private.price_versions set state = 'retired' where model_id = src.model_id and state in ('published', 'draft') and id <> v_new;
  update app_private.price_versions set state = 'published', effective_at = now(), published_by = v_actor where id = v_new;
  insert into app_private.pricing_batch_items (batch_id, model_id, old_price_version_id, new_price_version_id, old_rules, new_rules, supplier_cost_version_id)
  values (v_batch, src.model_id, pub.id, v_new, pub.rules, src.rules, src.supplier_cost_version_id);
  perform app_private.audit(v_actor, 'catalog.publish', 'price.restore', 'price_version', v_new::text,
    coalesce(nullif(trim(p_reason), ''), 'Restored price v' || src.version || ' as v' || v_ver || ' for ' || src.model_id || ' (batch ' || v_ref || ')'),
    jsonb_build_object('previousPublished', pub.id), jsonb_build_object('restoredFrom', src.id));
  return jsonb_build_object('priceVersionId', v_new, 'version', v_ver, 'batchRef', v_ref, 'state', 'published');
end;
$$;

-- =====================================================================================================
-- Availability
-- =====================================================================================================

-- Readiness checks shown in the dashboard and enforced when enabling. Server credentials are checked by the API
-- route (the database cannot see them) and added to this list there.
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
  dr app_private.price_versions;
  acc app_private.provider_accounts;
  v_checks jsonb := '[]'::jsonb;
  v_complete boolean;
  v_dims jsonb;
  cfg jsonb;
  v_defaults jsonb;
  v_refs int;
  v_n int := 0;
  v_missing int := 0;
begin
  select * into m from app_private.model_catalog where id = p_model_id;
  c := app_private.capability_for(m.id);
  sc := app_private.latest_cost_version(m.id);
  select * into pub from app_private.price_versions where model_id = m.id and state = 'published' and capability_version_id = c.id;
  select * into dr from app_private.price_versions where model_id = m.id and state = 'draft' and capability_version_id = c.id order by version desc limit 1;
  select * into acc from app_private.provider_accounts where id = m.provider_account_id;
  v_defaults := app_private.spec_defaults(c.spec);
  v_refs := coalesce((c.spec -> 'references' ->> 'min')::int, 0);

  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'adapter', 'ok', exists (select 1 from app_private.provider_adapters a where a.adapter = m.adapter),
    'label', 'Integration implemented', 'detail', case when exists (select 1 from app_private.provider_adapters a where a.adapter = m.adapter)
      then 'Adapter ' || m.adapter || ' is part of this release.' else 'This release has no adapter for this model.' end));
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'schema', 'ok', c.id is not null and c.spec ? 'options' and c.spec ? 'output',
    'label', 'Supported options defined', 'detail', 'Option schema version ' || coalesce(c.version::text, '—') || '.'));
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'provider_account', 'ok', acc.enabled and not acc.paused,
    'label', 'Provider account active', 'detail', case when acc.paused then 'The KIE account is paused in Genlixs.' when not acc.enabled then 'The KIE account is disabled.' else 'KIE account is active.' end));

  if sc.id is not null then
    v_dims := app_private.price_dims(sc.schedule);
    for cfg in select * from app_private.price_configs(c.spec, v_dims) loop
      v_n := v_n + 1;
      if app_private.supplier_credits(sc.schedule, cfg, v_refs, 1) is null then v_missing := v_missing + 1; end if;
    end loop;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'supplier_cost', 'ok', sc.id is not null and v_n > 0 and v_missing = 0,
    'label', 'KIE cost known for every configuration', 'fix', case when sc.id is null or v_n = 0 or v_missing > 0 then 'edit_cost' end,
    'detail', case when sc.id is null then 'No cost schedule recorded.' when v_n = 0 or v_missing > 0 then v_missing || ' configuration(s) without a cost.'
      else 'Cost v' || sc.version || ' (' || sc.source_kind || ', checked ' || to_char(sc.source_checked_at, 'YYYY-MM-DD') || ').' end));

  v_complete := false;
  if pub.id is not null then
    v_complete := true;
    if pub.rules ->> 'format' = 'table' then
      for cfg in select * from app_private.price_configs(c.spec, pub.rules -> 'dims') loop
        if app_private.price_units_for(pub.rules, v_defaults || cfg, v_refs) is null then v_complete := false; end if;
      end loop;
    end if;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'price', 'ok', v_complete,
    'label', 'Published price for every configuration',
    'fix', case when v_complete then null when dr.id is not null then 'publish_draft' else 'set_price' end,
    'draftPriceVersionId', dr.id,
    'detail', case when v_complete then 'Price v' || pub.version || ' is published.' when pub.id is not null then 'The published price misses some configurations.'
      when dr.id is not null then 'Draft v' || dr.version || ' is ready to publish.'
      when exists (select 1 from app_private.price_versions o where o.model_id = m.id and o.state = 'published')
        then 'The published price was set for an older set of options. Set a new price.'
      else 'No price yet. Use Edit pricing or Bulk pricing.' end));
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'verification', 'warning', true,
    'ok', (m.verification_status = 'verified_by_test' and m.verified_capability_version_id = c.id) or m.verification_status = 'manual_evidence',
    'label', 'Verified with a real test', 'fix', case when m.verification_status not in ('verified_by_test', 'manual_evidence') then 'run_test' end,
    'detail', case
      when m.verification_status = 'verified_by_test' and m.verified_capability_version_id = c.id then 'A private test completed and its output was validated.'
      when m.verification_status = 'verified_by_test' then 'Verified for an older option schema; test the current one.'
      when m.verification_status = 'manual_evidence' then 'Manual evidence recorded (not an integrated test).'
      when m.verification_status = 'test_failed' then 'The latest private test failed.'
      else 'Untested. The owner may still enable it using the documented KIE cost.' end));
  return jsonb_build_object('checks', v_checks, 'capabilityVersionId', c.id,
    'blocking', (select count(*) from jsonb_array_elements(v_checks) x where not (x ->> 'ok')::boolean and not coalesce((x ->> 'warning')::boolean, false)));
end;
$$;

-- Returns NULL when the change is allowed, otherwise {code, message, details}. Used by single and bulk changes.
create or replace function app_private.availability_blocker(p_actor uuid, p_model_id text, p_state text, p_accept_untested boolean)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  m app_private.model_catalog;
  v_ready jsonb;
  x jsonb;
begin
  select * into m from app_private.model_catalog where id = p_model_id;
  if not found then
    return jsonb_build_object('code', 'NOT_FOUND', 'message', 'Model not found.');
  end if;
  if p_state not in ('enabled', 'experimental') then
    return null;
  end if;
  v_ready := app_private.model_readiness(p_model_id);
  for x in select value from jsonb_array_elements(v_ready -> 'checks') loop
    if not (x ->> 'ok')::boolean and not coalesce((x ->> 'warning')::boolean, false) then
      return jsonb_build_object('code', case x ->> 'key' when 'price' then 'MODEL_NOT_PRICED' when 'adapter' then 'ADAPTER_NOT_IMPLEMENTED'
          when 'supplier_cost' then 'COST_UNKNOWN' when 'provider_account' then 'PROVIDER_PAUSED' else 'NOT_READY' end,
        'message', m.public_name || ': ' || (x ->> 'detail'), 'details', jsonb_build_object('modelId', m.id, 'check', x ->> 'key',
          'fix', x ->> 'fix', 'draftPriceVersionId', x ->> 'draftPriceVersionId'));
    end if;
  end loop;
  if not ((m.verification_status = 'verified_by_test' and m.verified_capability_version_id = (v_ready ->> 'capabilityVersionId')::uuid)
          or m.verification_status = 'manual_evidence') then
    if not app_private.has_capability(p_actor, 'catalog.publish') then
      return jsonb_build_object('code', 'MODEL_UNTESTED', 'message', m.public_name || ' has no successful test. Run a test, or ask the owner to enable it using the documented KIE cost.',
        'details', jsonb_build_object('modelId', m.id, 'fix', 'run_test'));
    end if;
    if not coalesce(p_accept_untested, false) then
      return jsonb_build_object('code', 'UNTESTED_CONFIRMATION_REQUIRED', 'message', m.public_name || ' has no successful test. Confirm to enable it using the documented KIE cost.',
        'details', jsonb_build_object('modelId', m.id));
    end if;
  end if;
  return null;
end;
$$;

-- One coherent availability control: disabled (hidden, no new quotes or submissions), maintenance (visible with a
-- note, no new quotes), experimental (selectable, labelled) or enabled. Running jobs always continue.
create or replace function public.admin_set_model_availability(p_model_id text, p_state text, p_note text default null,
  p_accept_untested boolean default false, p_publish_price_version_id uuid default null, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('catalog.operate');
  m app_private.model_catalog;
  v_block jsonb;
  v_basis text;
  v_cap uuid;
  v_published jsonb;
begin
  if p_state is null or p_state not in ('enabled', 'experimental', 'maintenance', 'disabled') then
    perform app_private.fail('INVALID_INPUT', 'Choose disabled, maintenance, experimental or enabled.');
  end if;
  select * into m from app_private.model_catalog where id = p_model_id for update;
  if not found then perform app_private.fail('NOT_FOUND', 'Model not found.'); end if;
  if p_publish_price_version_id is not null then
    if not exists (select 1 from app_private.price_versions where id = p_publish_price_version_id and model_id = m.id) then
      perform app_private.fail('NOT_FOUND', 'That price draft belongs to another model.');
    end if;
    v_published := public.admin_publish_price_version(p_publish_price_version_id, p_reason);
  end if;
  v_block := app_private.availability_blocker(v_actor, m.id, p_state, p_accept_untested);
  if v_block is not null then
    perform app_private.fail(v_block ->> 'code', v_block ->> 'message', coalesce(v_block -> 'details', '{}'::jsonb));
  end if;
  v_cap := (app_private.capability_for(m.id)).id;
  v_basis := case
    when p_state not in ('enabled', 'experimental') then m.enable_basis
    when m.verification_status = 'verified_by_test' and m.verified_capability_version_id = v_cap then 'verified_test'
    when m.verification_status = 'manual_evidence' then 'manual_evidence'
    else 'documented_cost' end;
  update app_private.model_catalog
  set state = p_state, availability_note = nullif(trim(coalesce(p_note, '')), ''), enable_basis = v_basis,
      availability_changed_at = now(), availability_changed_by = v_actor
  where id = m.id;
  perform app_private.audit(v_actor, 'catalog.operate', 'model.availability', 'model', m.id,
    coalesce(nullif(trim(p_reason), ''), 'Set ' || m.public_name || ' to ' || p_state
      || case when p_state in ('enabled', 'experimental') and v_basis = 'documented_cost' then ' using the documented KIE cost (untested)' else '' end),
    jsonb_build_object('state', m.state, 'enableBasis', m.enable_basis),
    jsonb_build_object('state', p_state, 'enableBasis', v_basis, 'verificationStatus', m.verification_status, 'note', nullif(trim(coalesce(p_note, '')), ''),
      'publishedPrice', v_published));
  return jsonb_build_object('modelId', m.id, 'state', p_state, 'enableBasis', v_basis, 'verificationStatus', m.verification_status, 'publishedPrice', v_published);
end;
$$;

-- Kept for the earlier console: same rules, reason recorded as given.
create or replace function public.admin_set_model_state(p_model_id text, p_state text, p_note text, p_reason text)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.admin_set_model_availability(p_model_id, p_state, p_note, false, null, p_reason);
$$;
revoke execute on function public.admin_set_model_state(text, text, text, text) from public, anon;
grant execute on function public.admin_set_model_state(text, text, text, text) to authenticated;

-- Bulk change: all selected models change, or none (the reply lists every blocker).
create or replace function public.admin_bulk_set_availability(p_model_ids text[], p_state text, p_accept_untested boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('catalog.operate');
  v_blocked jsonb := '[]'::jsonb;
  v_block jsonb;
  v_done jsonb := '[]'::jsonb;
  mid text;
begin
  if coalesce(cardinality(p_model_ids), 0) = 0 then perform app_private.fail('NOTHING_SELECTED', 'Select at least one model.'); end if;
  if p_state is null or p_state not in ('enabled', 'experimental', 'maintenance', 'disabled') then
    perform app_private.fail('INVALID_INPUT', 'Choose disabled, maintenance, experimental or enabled.');
  end if;
  foreach mid in array p_model_ids loop
    v_block := app_private.availability_blocker(v_actor, mid, p_state, p_accept_untested);
    if v_block is not null then
      v_blocked := v_blocked || jsonb_build_array(jsonb_build_object('modelId', mid, 'code', v_block ->> 'code', 'message', v_block ->> 'message'));
    end if;
  end loop;
  if jsonb_array_length(v_blocked) > 0 then
    perform app_private.fail('BULK_BLOCKED', jsonb_array_length(v_blocked) || ' of ' || cardinality(p_model_ids)
      || ' selected models cannot be set to ' || p_state || '. Nothing was changed.', jsonb_build_object('blocked', v_blocked));
  end if;
  foreach mid in array p_model_ids loop
    v_done := v_done || jsonb_build_array(public.admin_set_model_availability(mid, p_state, null, p_accept_untested, null, null));
  end loop;
  return jsonb_build_object('state', p_state, 'changed', v_done);
end;
$$;

create or replace function public.admin_update_model_display(p_model_id text, p_name text, p_purpose text, p_badges text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('catalog.publish');
  m app_private.model_catalog;
begin
  if char_length(trim(coalesce(p_name, ''))) not between 2 and 60 or char_length(trim(coalesce(p_purpose, ''))) not between 5 and 200 then
    perform app_private.fail('INVALID_INPUT', 'Use a display name of 2–60 characters and a description of 5–200 characters.');
  end if;
  if not (coalesce(p_badges, '{}') <@ array['recommended', 'premium', 'budget', 'fast', 'long']::text[]) then
    perform app_private.fail('INVALID_INPUT', 'Unknown badge.');
  end if;
  select * into m from app_private.model_catalog where id = p_model_id for update;
  if not found then perform app_private.fail('NOT_FOUND', 'Model not found.'); end if;
  update app_private.model_catalog set public_name = trim(p_name), purpose = trim(p_purpose), badges = coalesce(p_badges, '{}') where id = m.id;
  perform app_private.audit(v_actor, 'catalog.publish', 'model.display', 'model', m.id, 'Updated customer-facing name, description or badges',
    jsonb_build_object('name', m.public_name, 'purpose', m.purpose, 'badges', m.badges),
    jsonb_build_object('name', trim(p_name), 'purpose', trim(p_purpose), 'badges', coalesce(p_badges, '{}')));
  return jsonb_build_object('modelId', m.id);
end;
$$;

-- Manual evidence (separately identified from integrated tests); never marks the model "verified by test".
create or replace function public.admin_record_model_verification(p_model_id text, p_evidence text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('catalog.publish');
  m app_private.model_catalog;
begin
  if char_length(trim(coalesce(p_evidence, ''))) < 10 then
    perform app_private.fail('EVIDENCE_REQUIRED', 'Describe the evidence: date, task id, cost and what was checked.');
  end if;
  select * into m from app_private.model_catalog where id = p_model_id for update;
  if not found then perform app_private.fail('NOT_FOUND', 'Model not found.'); end if;
  insert into app_private.model_verification_evidence (model_id, capability_version_id, kind, outcome, note, recorded_by)
  values (m.id, (app_private.capability_for(m.id)).id, 'manual', 'recorded', left(trim(p_evidence), 1000), v_actor);
  if not (m.verification_status = 'verified_by_test' and m.verified_capability_version_id = (app_private.capability_for(m.id)).id) then
    update app_private.model_catalog set verification_status = 'manual_evidence', verified_at = now(),
      verification_note = 'Manual evidence: ' || left(trim(p_evidence), 900) where id = m.id;
  end if;
  perform app_private.audit(v_actor, 'catalog.publish', 'model.manual_evidence', 'model', m.id, left(trim(p_evidence), 500));
  return jsonb_build_object('modelId', m.id, 'kind', 'manual');
end;
$$;
revoke execute on function public.admin_record_model_verification(text, text) from public, anon;
grant execute on function public.admin_record_model_verification(text, text) to authenticated;

-- =====================================================================================================
-- Supplier cost updates (sourced, manual; there is no documented KIE pricing API)
-- =====================================================================================================

create or replace function public.admin_save_supplier_cost(p_model_id text, p_rates jsonb, p_source_kind text, p_source_url text,
  p_checked_at timestamptz, p_note text default null, p_extra_reference jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('pricing.review');
  c app_private.model_capability_versions := app_private.capability_for(p_model_id);
  prev app_private.supplier_cost_versions := app_private.latest_cost_version(p_model_id);
  v_schedule jsonb;
  v_rates jsonb := '{}'::jsonb;
  cfg jsonb;
  v_key text;
  v_val jsonb;
  v_n int := 0;
  v_id uuid;
  v_ver int;
begin
  if c.id is null then perform app_private.fail('NOT_FOUND', 'Model not found.'); end if;
  if prev.id is null then perform app_private.fail('COST_STRUCTURE_MISSING', 'This model has no cost structure yet; add it with a migration.'); end if;
  if p_source_kind not in ('documented', 'manual', 'observed') then perform app_private.fail('INVALID_INPUT', 'Choose where the cost comes from.'); end if;
  if p_source_url is not null and p_source_url !~ '^https://' then perform app_private.fail('INVALID_INPUT', 'The source link must start with https://.'); end if;
  if p_checked_at is null or p_checked_at > now() + interval '1 day' then perform app_private.fail('INVALID_INPUT', 'Enter the date the source was checked.'); end if;
  if jsonb_typeof(p_rates) <> 'object' then perform app_private.fail('INVALID_INPUT', 'Enter a KIE credit rate for every configuration.'); end if;
  for cfg in select * from app_private.price_configs(c.spec, prev.schedule -> 'dims') loop
    v_n := v_n + 1;
    v_key := app_private.option_key(prev.schedule -> 'dims', cfg);
    v_val := p_rates -> v_key;
    if v_val is null or jsonb_typeof(v_val) <> 'number' or (v_val #>> '{}')::numeric <= 0 or (v_val #>> '{}')::numeric > 100000
       or round((v_val #>> '{}')::numeric, 4) <> (v_val #>> '{}')::numeric then
      perform app_private.fail('INVALID_COST', 'Every configuration needs a positive KIE credit rate (up to 4 decimals).', jsonb_build_object('configuration', v_key));
    end if;
    v_rates := v_rates || jsonb_build_object(v_key, v_val);
  end loop;
  if (select count(*) from jsonb_object_keys(p_rates)) <> v_n then
    perform app_private.fail('INVALID_COST', 'The cost lists configurations this model does not offer.');
  end if;
  v_schedule := (prev.schedule - 'rates' - 'extraReference') || jsonb_build_object('rates', v_rates);
  if p_extra_reference is not null then
    if jsonb_typeof(p_extra_reference -> 'free') <> 'number' or jsonb_typeof(p_extra_reference -> 'credits') <> 'number'
       or (p_extra_reference ->> 'credits')::numeric < 0 then
      perform app_private.fail('INVALID_COST', 'Extra reference cost needs a free count and a non-negative credit rate.');
    end if;
    v_schedule := v_schedule || jsonb_build_object('extraReference', jsonb_build_object('free', (p_extra_reference ->> 'free')::int,
      'credits', (p_extra_reference ->> 'credits')::numeric));
  elsif prev.schedule ? 'extraReference' then
    v_schedule := v_schedule || jsonb_build_object('extraReference', prev.schedule -> 'extraReference');
  end if;
  v_ver := prev.version + 1;
  insert into app_private.supplier_cost_versions (model_id, version, schedule, usd_per_credit, source_kind, source_url, source_checked_at, note, created_by)
  values (p_model_id, v_ver, v_schedule, coalesce((app_private.setting('kie_usd_per_credit') #>> '{}')::numeric, prev.usd_per_credit),
    p_source_kind, p_source_url, p_checked_at, nullif(trim(coalesce(p_note, '')), ''), v_actor)
  returning id into v_id;
  update app_private.model_catalog set source_checked_at = p_checked_at where id = p_model_id;
  perform app_private.audit(v_actor, 'pricing.review', 'supplier_cost.update', 'model', p_model_id,
    'Recorded KIE cost v' || v_ver || ' (' || p_source_kind || ', checked ' || to_char(p_checked_at, 'YYYY-MM-DD') || ')',
    jsonb_build_object('version', prev.version, 'rates', prev.schedule -> 'rates'), jsonb_build_object('version', v_ver, 'rates', v_rates));
  return jsonb_build_object('costVersionId', v_id, 'version', v_ver);
end;
$$;

create or replace function public.admin_set_pricing_assumptions(p_fee_bps numeric, p_fixed_fee_usd numeric, p_operating_cost_usd numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('pricing.review');
  v_before jsonb := app_private.pricing_assumptions();
begin
  if (p_fee_bps is not null and (p_fee_bps < 0 or p_fee_bps > 3000)) or (p_fixed_fee_usd is not null and (p_fixed_fee_usd < 0 or p_fixed_fee_usd > 100))
     or (p_operating_cost_usd is not null and (p_operating_cost_usd < 0 or p_operating_cost_usd > 100)) then
    perform app_private.fail('INVALID_INPUT', 'Fees and costs must be non-negative (fee rate up to 30 %).');
  end if;
  update app_private.settings set value = coalesce(to_jsonb(p_fee_bps), 'null'::jsonb), updated_by = v_actor, updated_at = now() where key = 'pricing_payment_fee_bps';
  update app_private.settings set value = coalesce(to_jsonb(p_fixed_fee_usd), 'null'::jsonb), updated_by = v_actor, updated_at = now() where key = 'pricing_payment_fixed_fee_usd';
  update app_private.settings set value = coalesce(to_jsonb(p_operating_cost_usd), 'null'::jsonb), updated_by = v_actor, updated_at = now() where key = 'pricing_operating_cost_usd_per_job';
  perform app_private.audit(v_actor, 'pricing.review', 'pricing.assumptions', 'setting', 'pricing_assumptions', 'Updated pricing cost assumptions',
    v_before, app_private.pricing_assumptions());
  return app_private.pricing_assumptions();
end;
$$;

-- Package edits: impact of hypothetical price/credit changes on the conservative revenue per credit and on the
-- loss-making configurations (50 % commission scenario) of current prices. Nothing is saved.
create or replace function public.admin_package_impact(p_changes jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('pricing.review');
  v_before jsonb := app_private.revenue_basis(null);
  v_after jsonb := app_private.revenue_basis(coalesce(p_changes, '{}'::jsonb));
  v_assump jsonb := app_private.pricing_assumptions();
  v_models jsonb := '[]'::jsonb;
  t_before jsonb;
  t_after jsonb;
  m record;
begin
  for m in select id from app_private.model_catalog order by tool, sort_order loop
    t_before := app_private.model_price_table(m.id, null, v_before, v_assump, false);
    t_after := app_private.model_price_table(m.id, null, v_after, v_assump, false);
    if t_before -> 'published' is not null or t_before -> 'draft' is not null then
      v_models := v_models || jsonb_build_array(jsonb_build_object('modelId', m.id, 'name', t_before ->> 'name',
        'priceState', case when t_before -> 'published' is not null then 'published' else 'draft' end,
        'lossBefore', (t_before -> 'summary' ->> 'lossConfigsUplift')::int, 'lossAfter', (t_after -> 'summary' ->> 'lossConfigsUplift')::int,
        'directLossAfter', (t_after -> 'summary' ->> 'lossConfigsDirect')::int,
        'worstAfter', t_after -> 'summary' -> 'worstUpliftContribution'));
    end if;
  end loop;
  return jsonb_build_object('before', v_before, 'after', v_after, 'assumptions', v_assump, 'models', v_models);
end;
$$;

-- Package publication: routine, so the reason is optional (described automatically). Paid orders keep their snapshot.
create or replace function public.admin_publish_product_version(p_product_version_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('catalog.publish');
  pv app_private.product_versions;
  v_old app_private.product_versions;
begin
  select * into pv from app_private.product_versions where id = p_product_version_id for update;
  if not found or pv.state <> 'draft' then perform app_private.fail('INVALID_STATE', 'Only a draft product can be published.'); end if;
  select * into v_old from app_private.product_versions where product_key = pv.product_key and state = 'published';
  update app_private.product_versions set state = 'retired' where product_key = pv.product_key and state = 'published';
  update app_private.product_versions set state = 'published', effective_at = now(), published_by = v_actor where id = pv.id;
  perform app_private.audit(v_actor, 'catalog.publish', 'product.publish', 'product_version', pv.id::text,
    coalesce(nullif(trim(p_reason), ''), 'Published ' || pv.name || ' v' || pv.version || ': ' || pv.currency || ' ' || to_char(pv.amount_minor / 100.0, 'FM999999990.00')
      || ' for ' || pv.credits || ' credits'),
    case when v_old.id is not null then jsonb_build_object('version', v_old.version, 'amountMinor', v_old.amount_minor, 'credits', v_old.credits) end,
    jsonb_build_object('version', pv.version, 'amountMinor', pv.amount_minor, 'credits', pv.credits));
  return jsonb_build_object('productVersionId', pv.id, 'state', 'published');
end;
$$;
revoke execute on function public.admin_publish_product_version(uuid, text) from public, anon;
grant execute on function public.admin_publish_product_version(uuid, text) to authenticated;

-- =====================================================================================================
-- Shared input validation (customer quotes and staff tests)
-- =====================================================================================================

create or replace function app_private.normalize_generation_input(p_uid uuid, p_model_id text, p_spec jsonb, p_prompt text, p_options jsonb,
  p_reference_asset_ids uuid[])
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_prompt text := trim(coalesce(p_prompt, ''));
  v_opts jsonb := '{}'::jsonb;
  v_refs uuid[] := coalesce((select array_agg(distinct x order by x) from unnest(coalesce(p_reference_asset_ids, '{}')) x), '{}');
  k text;
  v_spec jsonb;
  v_val jsonb;
begin
  if char_length(v_prompt) < coalesce((p_spec -> 'prompt' ->> 'min')::int, 1) then
    perform app_private.fail('PROMPT_TOO_SHORT', 'Describe what you want in a few more words.');
  end if;
  if char_length(v_prompt) > coalesce((p_spec -> 'prompt' ->> 'max')::int, 4000) then
    perform app_private.fail('PROMPT_TOO_LONG', 'The prompt is longer than this model accepts.', jsonb_build_object('max', p_spec -> 'prompt' -> 'max'));
  end if;
  for k in select jsonb_object_keys(coalesce(p_options, '{}'::jsonb)) loop
    if not coalesce(p_spec -> 'options' ? k, false) then
      perform app_private.fail('UNSUPPORTED_OPTION', 'This model does not support one of the selected settings.', jsonb_build_object('option', k));
    end if;
  end loop;
  for k, v_spec in select * from jsonb_each(coalesce(p_spec -> 'options', '{}'::jsonb)) loop
    v_val := coalesce(p_options -> k, v_spec -> 'default');
    if not exists (select 1 from jsonb_array_elements(v_spec -> 'values') e where e = v_val) then
      perform app_private.fail('UNSUPPORTED_OPTION', 'This model does not support the selected setting.', jsonb_build_object('option', k, 'value', v_val));
    end if;
    v_opts := v_opts || jsonb_build_object(k, v_val);
  end loop;
  if cardinality(v_refs) < coalesce((p_spec -> 'references' ->> 'min')::int, 0) then
    perform app_private.fail('REFERENCE_REQUIRED', 'Add a reference image to edit.');
  end if;
  if cardinality(v_refs) > coalesce((p_spec -> 'references' ->> 'max')::int, 0) then
    perform app_private.fail('TOO_MANY_REFERENCES', 'This model accepts fewer reference images.');
  end if;
  if cardinality(v_refs) > 0 and (
    select count(*) from public.assets a
    where a.id = any (v_refs) and a.user_id = p_uid and a.kind = 'input' and a.state = 'validated'
      and (a.retention_until is null or a.retention_until > now())
      and a.mime in (select jsonb_array_elements_text(p_spec -> 'references' -> 'mime'))
  ) <> cardinality(v_refs) then
    perform app_private.fail('REFERENCE_INVALID', 'The reference image is missing, expired or not accepted. Upload it again.');
  end if;
  return jsonb_build_object('input', jsonb_build_object('modelId', p_model_id, 'prompt', v_prompt, 'options', v_opts, 'referenceAssetIds', to_jsonb(v_refs)),
    'options', v_opts, 'refCount', cardinality(v_refs));
end;
$$;

-- Customer quote: same checks as before, now with configuration-level (table) prices and reference counts.
create or replace function public.create_generation_quote(
  p_model_id text, p_prompt text, p_options jsonb default '{}'::jsonb, p_reference_asset_ids uuid[] default '{}'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_active_user();
  m app_private.model_catalog;
  c app_private.model_capability_versions;
  p app_private.price_versions;
  v_norm jsonb;
  v_opts jsonb;
  v_units bigint;
  v_input jsonb;
  v_hash text;
  v_id uuid;
  v_expires timestamptz;
begin
  if coalesce((app_private.setting('generation_paused'))::text, 'false') = 'true' then
    perform app_private.fail('GENERATION_PAUSED', 'Generation is paused right now. Your draft is saved; try again later.');
  end if;
  if (select count(*) from public.generation_quotes where user_id = v_uid and created_at > now() - interval '1 minute')
     >= coalesce((app_private.setting('max_quotes_per_minute'))::text, '30')::int then
    perform app_private.fail('RATE_LIMITED', 'Too many price checks in a minute. Wait a moment and try again.');
  end if;

  select * into m from app_private.model_catalog where id = p_model_id;
  if not found or m.state not in ('enabled', 'experimental') then
    perform app_private.fail('MODEL_UNAVAILABLE', 'This model is not available right now. Choose another model.');
  end if;
  if exists (select 1 from app_private.provider_accounts a where a.id = m.provider_account_id and (a.paused or not a.enabled)) then
    perform app_private.fail('MODEL_UNAVAILABLE', 'This model is temporarily unavailable. Your draft is saved.');
  end if;
  if not exists (select 1 from public.tools t where t.id = m.tool and t.enabled) then
    perform app_private.fail('TOOL_UNAVAILABLE', 'This tool is not available right now.');
  end if;

  c := app_private.capability_for(m.id);
  select * into p from app_private.price_versions where model_id = m.id and state = 'published';
  if not found or p.capability_version_id <> c.id then
    perform app_private.fail('MODEL_NOT_PRICED', 'This model has no approved price yet.');
  end if;

  v_norm := app_private.normalize_generation_input(v_uid, m.id, c.spec, p_prompt, p_options, p_reference_asset_ids);
  v_opts := v_norm -> 'options';
  v_units := app_private.price_units_for(p.rules, v_opts, (v_norm ->> 'refCount')::int);
  if v_units is null or v_units <= 0 then
    perform app_private.fail('PRICE_INVALID', 'This combination has no valid price. Choose different settings.');
  end if;

  v_input := v_norm -> 'input';
  v_hash := encode(extensions.digest(v_input::text, 'sha256'), 'hex');
  v_expires := now() + make_interval(secs => coalesce((app_private.setting('quote_ttl_seconds'))::text, '300')::int);

  insert into public.generation_quotes (user_id, tool, model_id, capability_version_id, price_version_id, normalized_input, input_hash, units, expires_at)
  values (v_uid, m.tool, m.id, c.id, p.id, v_input, v_hash, v_units, v_expires)
  returning id into v_id;

  return jsonb_build_object(
    'quoteId', v_id, 'creditUnits', v_units::text, 'displayCredits', v_units::text, 'expiresAt', v_expires,
    'priceVersionId', p.id, 'modelCapabilityVersionId', c.id, 'inputHash', v_hash, 'deliveryPolicy', 'complete-output-set',
    'tool', m.tool, 'modelId', m.id, 'options', v_opts, 'availableUnits', app_private.spendable_units(v_uid)::text
  );
end;
$$;
revoke execute on function public.create_generation_quote(text, text, jsonb, uuid[]) from public, anon;
grant execute on function public.create_generation_quote(text, text, jsonb, uuid[]) to authenticated;

-- Customer catalog: enabled, experimental and maintenance entries (maintenance is shown as unavailable with its note).
-- "priced" requires a published price for the CURRENT option schema. No supplier or admin data is exposed.
create or replace function public.get_catalog()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'generationPaused', coalesce((app_private.setting('generation_paused'))::text, 'false') = 'true',
    'tools', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'label', t.label, 'enabled', t.enabled) order by t.sort_order), '[]') from public.tools t),
    'models', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'tool', m.tool,
        'category', app_private.model_category(m.tool),
        'name', m.public_name,
        'family', m.family,
        'variant', m.variant_label,
        'badges', to_jsonb(m.badges),
        'purpose', m.purpose,
        'state', m.state,
        'note', m.availability_note,
        'capabilityVersion', c.version,
        'options', c.spec -> 'options',
        'prompt', c.spec -> 'prompt',
        'references', c.spec -> 'references',
        'output', jsonb_build_object('kind', c.spec -> 'output' -> 'kind', 'count', c.spec -> 'output' -> 'count'),
        'fixed', c.spec -> 'fixed',
        'priced', p.id is not null,
        'priceRules', case when p.id is not null then p.rules end
      ) order by m.sort_order)
      from app_private.model_catalog m
      cross join lateral app_private.capability_for(m.id) c
      left join app_private.price_versions p on p.model_id = m.id and p.state = 'published' and p.capability_version_id = c.id
      where m.state <> 'disabled'
    ), '[]')
  );
$$;
revoke execute on function public.get_catalog() from public;
grant execute on function public.get_catalog() to anon, authenticated;

-- Customer library never lists private staff tests.
create or replace function public.list_generations(
  p_before timestamptz default null, p_limit int default 24, p_tool text default null, p_state text default null, p_favorites boolean default false
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(app_private.job_snapshot(x.id) order by x.created_at desc), '[]')
  from (
    select j.id, j.created_at from public.generation_jobs j
    where j.user_id = (select auth.uid()) and j.hidden_at is null and j.purpose = 'customer'
      and (p_before is null or j.created_at < p_before)
      and (p_tool is null or j.tool = p_tool)
      and (p_state is null
           or (p_state = 'ready' and j.state = 'succeeded')
           or (p_state = 'running' and j.state not in ('succeeded', 'failed', 'cancelled'))
           or (p_state = 'failed' and j.state in ('failed', 'cancelled')))
      and (not coalesce(p_favorites, false) or j.favorite)
    order by j.created_at desc
    limit least(greatest(coalesce(p_limit, 24), 1), 100)
  ) x;
$$;
revoke execute on function public.list_generations(timestamptz, int, text, text, boolean) from public, anon;
grant execute on function public.list_generations(timestamptz, int, text, text, boolean) to authenticated;

-- Staff tests have no reservation: settlement is a no-op for them (customer jobs keep the strict behaviour).
create or replace function app_private.capture_reservation(p_job uuid, p_reason text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_res public.credit_reservations;
  a record;
begin
  select * into v_res from public.credit_reservations where job_id = p_job;
  if not found then
    if exists (select 1 from public.generation_jobs j where j.id = p_job and j.purpose = 'staff_test') then
      return 'captured';
    end if;
    perform app_private.fail('RESERVATION_NOT_FOUND', 'No credit reservation exists for this job.');
  end if;
  perform app_private.lock_wallet(v_res.user_id);
  select * into v_res from public.credit_reservations where id = v_res.id for update;
  if v_res.state <> 'open' then
    return v_res.state;
  end if;
  for a in select * from app_private.credit_reservation_allocations where reservation_id = v_res.id order by lot_id for update loop
    update public.credit_lots set reserved_units = reserved_units - a.units, spent_units = spent_units + a.units where id = a.lot_id;
    update app_private.credit_reservation_allocations set disposition = 'captured' where reservation_id = a.reservation_id and lot_id = a.lot_id;
    insert into public.credit_ledger (user_id, lot_id, event_type, event_key, idempotency_key, d_reserved, d_spent, job_id, reservation_id, note)
    values (v_res.user_id, a.lot_id, 'capture', 'capture:' || p_job, 'capture:' || p_job || ':' || a.lot_id, -a.units, a.units, p_job, v_res.id, p_reason);
  end loop;
  update public.credit_reservations set state = 'captured', settled_at = now(), settlement_reason = p_reason where id = v_res.id;
  perform app_private.wallet_apply(v_res.user_id, 0, -v_res.units, v_res.units, 0, 0);
  return 'captured';
end;
$$;

create or replace function app_private.release_reservation(p_job uuid, p_reason text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_res public.credit_reservations;
  a record;
  v_expired boolean;
  v_back bigint := 0;
  v_exp bigint := 0;
begin
  select * into v_res from public.credit_reservations where job_id = p_job;
  if not found then
    if exists (select 1 from public.generation_jobs j where j.id = p_job and j.purpose = 'staff_test') then
      return 'released';
    end if;
    perform app_private.fail('RESERVATION_NOT_FOUND', 'No credit reservation exists for this job.');
  end if;
  perform app_private.lock_wallet(v_res.user_id);
  select * into v_res from public.credit_reservations where id = v_res.id for update;
  if v_res.state <> 'open' then
    return v_res.state;
  end if;
  for a in
    select x.*, l.expires_at from app_private.credit_reservation_allocations x
    join public.credit_lots l on l.id = x.lot_id
    where x.reservation_id = v_res.id order by x.lot_id for update of x
  loop
    v_expired := a.expires_at is not null and a.expires_at <= now();
    if v_expired then
      update public.credit_lots set reserved_units = reserved_units - a.units, expired_units = expired_units + a.units where id = a.lot_id;
      insert into public.credit_ledger (user_id, lot_id, event_type, event_key, idempotency_key, d_reserved, d_expired, job_id, reservation_id, note)
      values (v_res.user_id, a.lot_id, 'release', 'release:' || p_job, 'release:' || p_job || ':' || a.lot_id, -a.units, a.units, p_job, v_res.id,
              p_reason || ' (lot expired while reserved)');
      v_exp := v_exp + a.units;
    else
      update public.credit_lots set reserved_units = reserved_units - a.units, available_units = available_units + a.units where id = a.lot_id;
      insert into public.credit_ledger (user_id, lot_id, event_type, event_key, idempotency_key, d_available, d_reserved, job_id, reservation_id, note)
      values (v_res.user_id, a.lot_id, 'release', 'release:' || p_job, 'release:' || p_job || ':' || a.lot_id, a.units, -a.units, p_job, v_res.id, p_reason);
      v_back := v_back + a.units;
    end if;
    update app_private.credit_reservation_allocations set disposition = case when v_expired then 'expired' else 'released' end
    where reservation_id = a.reservation_id and lot_id = a.lot_id;
  end loop;
  update public.credit_reservations set state = 'released', settled_at = now(), settlement_reason = p_reason where id = v_res.id;
  perform app_private.wallet_apply(v_res.user_id, v_back, -v_res.units, 0, v_exp, 0);
  return 'released';
end;
$$;

-- =====================================================================================================
-- Private staff tests
-- =====================================================================================================

-- Starts a paid test through the normal durable pipeline (same adapter, queue, attempt tracking, callback/polling,
-- safe import and private storage). Works while the model is disabled for customers. One open test per model and the
-- idempotency key make a repeated click or a retried request return the same job instead of a second submission.
create or replace function public.admin_create_model_test(p_model_id text, p_prompt text, p_options jsonb, p_reference_asset_ids uuid[],
  p_idempotency_key text, p_confirm_spend boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_capability('catalog.test');
  m app_private.model_catalog;
  c app_private.model_capability_versions;
  sc app_private.supplier_cost_versions;
  acc app_private.provider_accounts;
  v_existing public.generation_jobs;
  v_open public.generation_jobs;
  v_norm jsonb;
  v_est numeric;
  v_quote uuid;
  v_job uuid := gen_random_uuid();
  v_hash text;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then
    perform app_private.fail('INVALID_IDEMPOTENCY_KEY', 'Missing or invalid Idempotency-Key.');
  end if;
  perform pg_advisory_xact_lock(hashtext('genlixs:test:' || coalesce(p_model_id, '')));
  select * into v_existing from public.generation_jobs where user_id = v_uid and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.purpose = 'staff_test' and v_existing.model_id = p_model_id then
      return jsonb_build_object('job', app_private.job_snapshot(v_existing.id), 'replayed', true);
    end if;
    perform app_private.fail('IDEMPOTENCY_CONFLICT', 'This request key was already used for a different request.');
  end if;
  if not coalesce(p_confirm_spend, false) then
    perform app_private.fail('SPEND_CONFIRMATION_REQUIRED', 'Confirm that this test spends credits from the KIE account.');
  end if;
  select * into m from app_private.model_catalog where id = p_model_id;
  if not found then perform app_private.fail('NOT_FOUND', 'Model not found.'); end if;
  if not exists (select 1 from app_private.provider_adapters a where a.adapter = m.adapter) then
    perform app_private.fail('ADAPTER_NOT_IMPLEMENTED', 'This release has no integration for this model, so it cannot be tested.');
  end if;
  select * into v_open from public.generation_jobs
  where purpose = 'staff_test' and model_id = m.id and state not in ('succeeded', 'failed', 'cancelled')
  order by created_at desc limit 1;
  if found then
    perform app_private.fail('TEST_IN_PROGRESS', 'A test of this model is still running (' || v_open.short_ref || '). Wait for it to finish.',
      jsonb_build_object('jobId', v_open.id, 'ref', v_open.short_ref));
  end if;
  select * into acc from app_private.provider_accounts where id = m.provider_account_id;
  if acc.paused or not acc.enabled then
    perform app_private.fail('PROVIDER_PAUSED', 'The KIE account is paused in Genlixs; tests are not sent.');
  end if;
  if coalesce((app_private.setting('generation_paused'))::text, 'false') = 'true' then
    perform app_private.fail('GENERATION_PAUSED', 'Generation is paused (emergency stop); tests are not sent either.');
  end if;

  c := app_private.capability_for(m.id);
  v_norm := app_private.normalize_generation_input(v_uid, m.id, c.spec, p_prompt, p_options, p_reference_asset_ids);
  sc := app_private.latest_cost_version(m.id);
  v_est := app_private.supplier_credits(sc.schedule, v_norm -> 'options', (v_norm ->> 'refCount')::int, coalesce((c.spec -> 'output' ->> 'count')::int, 1));
  v_hash := encode(extensions.digest((v_norm -> 'input')::text, 'sha256'), 'hex');

  insert into public.generation_quotes (user_id, tool, model_id, capability_version_id, price_version_id, normalized_input, input_hash, units,
    expires_at, consumed_at, purpose)
  values (v_uid, m.tool, m.id, c.id, null, v_norm -> 'input', v_hash, 0, now(), now(), 'staff_test')
  returning id into v_quote;

  insert into public.generation_jobs (
    id, user_id, quote_id, tool, model_id, model_name, capability_version_id, price_version_id, adapter, adapter_version,
    prompt, options, reference_asset_ids, title, units, idempotency_key, request_hash, state, settlement_state, next_action_at,
    delayed_after_at, customer_deadline_at, purpose
  ) values (
    v_job, v_uid, v_quote, m.tool, m.id, m.public_name, c.id, null, m.adapter, m.adapter_version,
    v_norm -> 'input' ->> 'prompt', v_norm -> 'options',
    coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(v_norm -> 'input' -> 'referenceAssetIds') x), '{}'),
    left('Test · ' || regexp_replace(v_norm -> 'input' ->> 'prompt', '\s+', ' ', 'g'), 60), 0, p_idempotency_key,
    encode(extensions.digest(v_quote::text || ':' || v_hash, 'sha256'), 'hex'), 'queued', 'released', now(),
    now() + make_interval(mins => coalesce((app_private.setting('delayed_after_minutes'))::text, '30')::int),
    now() + make_interval(hours => coalesce((app_private.setting('reservation_deadline_hours'))::text, '24')::int),
    'staff_test'
  );
  insert into app_private.model_test_runs (job_id, model_id, capability_version_id, adapter, adapter_version, requested_by, input,
    supplier_cost_version_id, estimated_supplier_credits)
  values (v_job, m.id, c.id, m.adapter, m.adapter_version, v_uid, v_norm -> 'input', sc.id, v_est);
  perform app_private.job_event(v_job, 'queued', 'Staff test queued. No customer credits are reserved or charged.');
  perform app_private.enqueue_work('genlixs_control', 'job_submit', v_job, 'submit:' || v_job || ':1', now(), '{}'::jsonb);
  perform app_private.audit(v_uid, 'catalog.test', 'model.test_started', 'model', m.id,
    'Started a paid private test' || coalesce(' (about ' || trim_scale(round(v_est, 4))::text || ' KIE credits, estimated from cost v' || sc.version || ')', ''),
    null, jsonb_build_object('jobId', v_job, 'options', v_norm -> 'options'));
  return jsonb_build_object('job', app_private.job_snapshot(v_job), 'replayed', false, 'estimatedSupplierCredits', v_est);
end;
$$;

-- When a test job settles: record the evidence once. Only a delivered, validated output counts as a passed test,
-- and only the tested model entry (never a sibling variant) becomes "verified by test".
create or replace function app_private.on_staff_test_settled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  t app_private.model_test_runs;
  v_task text;
  v_obs numeric;
begin
  if new.state not in ('succeeded', 'failed', 'cancelled') then
    return null;
  end if;
  select * into t from app_private.model_test_runs where job_id = new.id;
  if not found or t.status <> 'running' then
    return null;
  end if;
  select provider_task_id into v_task from app_private.provider_attempts where job_id = new.id and provider_task_id is not null order by ordinal desc limit 1;
  select credits_consumed into v_obs from app_private.provider_observations where job_id = new.id and credits_consumed is not null order by observed_at desc limit 1;
  update app_private.model_test_runs set
    status = case new.state when 'succeeded' then 'succeeded' when 'cancelled' then 'cancelled' else 'failed' end,
    task_id = v_task, observed_supplier_credits = v_obs,
    cost_provenance = case when v_obs is not null then 'observed: KIE task detail creditsConsumed'
                           when t.estimated_supplier_credits is not null then 'estimated: documented cost schedule'
                           else 'unknown' end,
    failure_code = new.failure_code, completed_at = now()
  where job_id = new.id;
  if new.state = 'succeeded' then
    insert into app_private.model_verification_evidence (model_id, capability_version_id, kind, outcome, test_job_id, task_id, note, recorded_by)
    values (t.model_id, t.capability_version_id, 'integrated_test', 'passed', new.id, v_task,
      'Private test ' || new.short_ref || ' delivered a validated output' || coalesce('; KIE reported ' || v_obs || ' credits', '') || '.', t.requested_by);
    update app_private.model_catalog set verification_status = 'verified_by_test', verified_capability_version_id = t.capability_version_id,
      verified_at = now(), verification_note = 'Private test ' || new.short_ref || coalesce(' (task ' || v_task || ')', '') || ' delivered a validated output.'
    where id = t.model_id;
  elsif new.state = 'failed' then
    insert into app_private.model_verification_evidence (model_id, capability_version_id, kind, outcome, test_job_id, task_id, note, recorded_by)
    values (t.model_id, t.capability_version_id, 'integrated_test', 'failed', new.id, v_task,
      'Private test ' || new.short_ref || ' failed: ' || coalesce(new.failure_code, 'unknown') || '.', t.requested_by);
    update app_private.model_catalog set verification_status = 'test_failed'
    where id = t.model_id and not (verification_status = 'verified_by_test' and verified_capability_version_id = t.capability_version_id);
  end if;
  return null;
end;
$$;
revoke execute on function app_private.on_staff_test_settled() from public, anon, authenticated;

create trigger generation_jobs_staff_test_settled after update of state on public.generation_jobs
  for each row when (new.purpose = 'staff_test' and new.state is distinct from old.state)
  execute function app_private.on_staff_test_settled();

create or replace function public.admin_authorize_test_output(p_asset_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_capability('admin.access');
  r record;
begin
  if not (app_private.has_capability(v_uid, 'catalog.test') or app_private.has_capability(v_uid, 'catalog.publish')) then
    perform app_private.fail('FORBIDDEN', 'Your role does not allow this action.');
  end if;
  select a.bucket, a.object_path, a.mime into r
  from public.assets a join public.generation_jobs j on j.id = a.job_id
  where a.id = p_asset_id and a.purpose = 'staff_test' and j.purpose = 'staff_test' and a.state = 'ready';
  if not found then perform app_private.fail('NOT_FOUND', 'Test output not found.'); end if;
  return jsonb_build_object('bucket', r.bucket, 'path', r.object_path, 'mime', r.mime);
end;
$$;

-- =====================================================================================================
-- Admin reads
-- =====================================================================================================

create or replace function app_private.model_tests_json(p_model_id text, p_limit int)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'jobId', t.job_id, 'ref', j.short_ref, 'jobState', j.state, 'status', t.status, 'requestedBy', p.email,
      'prompt', t.input ->> 'prompt', 'options', t.input -> 'options', 'capabilityVersion', cv.version,
      'createdAt', t.created_at, 'submittedAt', j.submitted_at, 'completedAt', t.completed_at,
      'taskId', coalesce(t.task_id, (select a.provider_task_id from app_private.provider_attempts a where a.job_id = t.job_id and a.provider_task_id is not null order by a.ordinal desc limit 1)),
      'estimatedSupplierCredits', t.estimated_supplier_credits, 'observedSupplierCredits', t.observed_supplier_credits,
      'costProvenance', t.cost_provenance, 'failureCode', coalesce(t.failure_code, j.failure_code), 'failureMessage', j.failure_message,
      'outputs', (select coalesce(jsonb_agg(jsonb_build_object('assetId', a.id, 'mime', a.mime, 'width', a.width, 'height', a.height,
          'durationMs', a.duration_ms, 'bytes', a.bytes::text)), '[]') from public.assets a where a.job_id = t.job_id and a.kind = 'output' and a.state = 'ready'),
      'events', (select coalesce(jsonb_agg(jsonb_build_object('message', e.message, 'at', e.created_at) order by e.created_at), '[]')
          from public.generation_job_events e where e.job_id = t.job_id)
    ) order by t.created_at desc), '[]')
  from (select * from app_private.model_test_runs where model_id = p_model_id order by created_at desc limit p_limit) t
  join public.generation_jobs j on j.id = t.job_id
  join app_private.model_capability_versions cv on cv.id = t.capability_version_id
  left join public.profiles p on p.user_id = t.requested_by;
$$;

-- Catalog workspace listing. Supplier costs and margins only for roles that review prices or read provider data.
create or replace function public.admin_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('admin.access');
  v_cost boolean := app_private.has_capability(v_actor, 'pricing.review') or app_private.has_capability(v_actor, 'catalog.publish')
                    or app_private.has_capability(v_actor, 'provider.read');
  v_basis jsonb := app_private.revenue_basis(null);
  v_assump jsonb := app_private.pricing_assumptions();
  v_models jsonb := '[]'::jsonb;
  v_t jsonb;
  m app_private.model_catalog;
  c app_private.model_capability_versions;
begin
  for m in select * from app_private.model_catalog order by sort_order, id loop
    c := app_private.capability_for(m.id);
    v_t := app_private.model_price_table(m.id, null, v_basis, v_assump, false);
    v_models := v_models || jsonb_build_array(jsonb_build_object(
      'id', m.id, 'tool', m.tool, 'category', app_private.model_category(m.tool), 'name', m.public_name, 'family', m.family,
      'variant', m.variant_label, 'badges', to_jsonb(m.badges), 'purpose', m.purpose,
      'providerModelId', m.provider_model_id, 'adapter', m.adapter, 'adapterVersion', m.adapter_version,
      'adapterImplemented', exists (select 1 from app_private.provider_adapters a where a.adapter = m.adapter),
      'state', m.state, 'note', m.availability_note, 'enableBasis', m.enable_basis, 'availabilityChangedAt', m.availability_changed_at,
      'verifiedAt', m.verified_at, 'verificationNote', m.verification_note, 'verificationStatus', m.verification_status,
      'verifiedCurrent', m.verified_capability_version_id = c.id,
      'docsUrl', m.provider_docs_url, 'pricingUrl', m.provider_pricing_url, 'sourceCheckedAt', m.source_checked_at,
      'capability', jsonb_build_object('id', c.id, 'version', c.version, 'spec', c.spec),
      'prices', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'version', p.version, 'state', p.state, 'rules', p.rules, 'source', p.source,
          'supplierCost', case when v_cost then p.supplier_cost_snapshot end, 'evidence', case when v_cost then p.cost_evidence end,
          'effectiveAt', p.effective_at, 'currentCapability', p.capability_version_id = c.id) order by p.version desc), '[]')
        from app_private.price_versions p where p.model_id = m.id),
      'pricing', jsonb_build_object('published', v_t -> 'published', 'draft', v_t -> 'draft', 'minUnits', v_t -> 'summary' -> 'minUnits',
        'maxUnits', v_t -> 'summary' -> 'maxUnits', 'configCount', v_t -> 'configCount'),
      'cost', case when v_cost then (v_t -> 'cost') || jsonb_build_object('minCredits', v_t -> 'summary' -> 'minSupplierCredits',
        'maxCredits', v_t -> 'summary' -> 'maxSupplierCredits', 'complete', v_t ->> 'status' not in ('missing_cost', 'incomplete_cost'),
        'lossConfigsUplift', v_t -> 'summary' -> 'lossConfigsUplift') end,
      'lastTest', (select jsonb_build_object('status', t.status, 'at', coalesce(t.completed_at, t.created_at), 'ref', j.short_ref, 'jobId', t.job_id)
        from app_private.model_test_runs t join public.generation_jobs j on j.id = t.job_id where t.model_id = m.id order by t.created_at desc limit 1),
      'readiness', app_private.model_readiness(m.id)
    ));
  end loop;
  return jsonb_build_object(
    'models', v_models,
    'products', (select coalesce(jsonb_agg(jsonb_build_object('id', pv.id, 'key', pv.product_key, 'version', pv.version, 'kind', pv.kind, 'name', pv.name,
        'description', pv.description, 'currency', pv.currency, 'amountMinor', pv.amount_minor::text, 'credits', pv.credits::text, 'interval', pv.billing_interval,
        'creditExpiryDays', pv.credit_expiry_days, 'state', pv.state, 'gatewayMapping', pv.gateway_mapping, 'effectiveAt', pv.effective_at,
        'createdAt', pv.created_at) order by pv.sort_order, pv.version desc), '[]')
      from app_private.product_versions pv),
    'agreements', (select coalesce(jsonb_agg(to_jsonb(v) - 'published_by' order by v.version desc), '[]') from public.affiliate_agreement_versions v),
    'settings', (select coalesce(jsonb_object_agg(s.key, s.value), '{}') from app_private.settings s where s.key not in ('owner_bootstrap_open')),
    'economics', case when v_cost then jsonb_build_object('basis', v_basis, 'assumptions', v_assump) end,
    'access', jsonb_build_object(
      'canSeeCosts', v_cost,
      'canPrice', app_private.has_capability(v_actor, 'pricing.review'),
      'canPublish', app_private.has_capability(v_actor, 'catalog.publish'),
      'canOperate', app_private.has_capability(v_actor, 'catalog.operate'),
      'canTest', app_private.has_capability(v_actor, 'catalog.test'),
      'canReadProvider', app_private.has_capability(v_actor, 'provider.read'),
      'canManageSettings', app_private.has_capability(v_actor, 'settings.manage'))
  );
end;
$$;
revoke execute on function public.admin_catalog() from public, anon;
grant execute on function public.admin_catalog() to authenticated;

create or replace function public.admin_model_detail(p_model_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('admin.access');
  v_cost boolean := app_private.has_capability(v_actor, 'pricing.review') or app_private.has_capability(v_actor, 'catalog.publish')
                    or app_private.has_capability(v_actor, 'provider.read');
  m app_private.model_catalog;
  c app_private.model_capability_versions;
begin
  select * into m from app_private.model_catalog where id = p_model_id;
  if not found then perform app_private.fail('NOT_FOUND', 'Model not found.'); end if;
  c := app_private.capability_for(m.id);
  return jsonb_build_object(
    'model', jsonb_build_object('id', m.id, 'tool', m.tool, 'category', app_private.model_category(m.tool), 'name', m.public_name,
      'family', m.family, 'variant', m.variant_label, 'badges', to_jsonb(m.badges), 'purpose', m.purpose, 'state', m.state,
      'note', m.availability_note, 'enableBasis', m.enable_basis, 'verificationStatus', m.verification_status,
      'verifiedCurrent', m.verified_capability_version_id = c.id, 'verifiedAt', m.verified_at, 'verificationNote', m.verification_note,
      'providerModelId', m.provider_model_id, 'adapter', m.adapter, 'adapterVersion', m.adapter_version,
      'docsUrl', m.provider_docs_url, 'pricingUrl', m.provider_pricing_url, 'sourceCheckedAt', m.source_checked_at,
      'capability', jsonb_build_object('id', c.id, 'version', c.version, 'spec', c.spec)),
    'readiness', app_private.model_readiness(m.id),
    'table', case when v_cost then app_private.model_price_table(m.id, null, app_private.revenue_basis(null), app_private.pricing_assumptions(), false) end,
    'costVersions', case when v_cost then (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'version', s.version, 'schedule', s.schedule,
        'usdPerCredit', s.usd_per_credit, 'sourceKind', s.source_kind, 'sourceUrl', s.source_url, 'checkedAt', s.source_checked_at, 'note', s.note,
        'createdBy', pp.email, 'createdAt', s.created_at) order by s.version desc), '[]')
      from app_private.supplier_cost_versions s left join public.profiles pp on pp.user_id = s.created_by where s.model_id = m.id) end,
    'prices', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'version', p.version, 'state', p.state, 'source', p.source, 'rules', p.rules,
        'effectiveAt', p.effective_at, 'createdAt', p.created_at, 'publishedBy', pb.email, 'createdBy', pc.email, 'markupBps', p.markup_bps,
        'batchRef', b.short_ref, 'restoredFromVersion', (select r.version from app_private.price_versions r where r.id = p.restored_from),
        'evidence', case when v_cost then p.cost_evidence end, 'capabilityVersion', cv.version, 'currentCapability', p.capability_version_id = c.id)
        order by p.version desc), '[]')
      from app_private.price_versions p
      join app_private.model_capability_versions cv on cv.id = p.capability_version_id
      left join app_private.pricing_batches b on b.id = p.batch_id
      left join public.profiles pb on pb.user_id = p.published_by
      left join public.profiles pc on pc.user_id = p.created_by
      where p.model_id = m.id),
    'tests', app_private.model_tests_json(m.id, 20),
    'evidence', (select coalesce(jsonb_agg(jsonb_build_object('kind', e.kind, 'outcome', e.outcome, 'note', e.note, 'taskId', e.task_id,
        'recordedBy', pe.email, 'at', e.recorded_at) order by e.recorded_at desc), '[]')
      from app_private.model_verification_evidence e left join public.profiles pe on pe.user_id = e.recorded_by where e.model_id = m.id),
    'activity', (select coalesce(jsonb_agg(jsonb_build_object('action', l.action, 'reason', l.reason, 'actor', pa.email, 'at', l.created_at,
        'targetKind', l.target_kind, 'targetId', l.target_id, 'before', l.before_state, 'after', l.after_state) order by l.created_at desc), '[]')
      from (select * from app_private.admin_audit_logs l0
            where (l0.target_kind = 'model' and l0.target_id = m.id)
               or (l0.target_kind = 'price_version' and l0.target_id in (select id::text from app_private.price_versions where model_id = m.id))
               or (l0.target_kind = 'pricing_batch' and l0.target_id in (select batch_id::text from app_private.pricing_batch_items where model_id = m.id))
            order by l0.created_at desc limit 50) l
      left join public.profiles pa on pa.user_id = l.actor_id),
    'access', jsonb_build_object('canSeeCosts', v_cost, 'canPrice', app_private.has_capability(v_actor, 'pricing.review'),
      'canPublish', app_private.has_capability(v_actor, 'catalog.publish'), 'canOperate', app_private.has_capability(v_actor, 'catalog.operate'),
      'canTest', app_private.has_capability(v_actor, 'catalog.test'))
  );
end;
$$;

create or replace function public.admin_pricing_batches(p_limit int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('pricing.review');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'ref', b.short_ref, 'kind', b.kind, 'action', b.action, 'markupBps', b.markup_bps,
      'includeOverrides', b.include_overrides, 'actor', p.email, 'createdAt', b.created_at, 'scope', b.scope,
      'minRevenuePerCredit', b.basis -> 'revenue' -> 'minRevenuePerCredit',
      'items', (select coalesce(jsonb_agg(jsonb_build_object('modelId', i.model_id, 'name', mc.public_name,
          'oldVersion', (select v.version from app_private.price_versions v where v.id = i.old_price_version_id),
          'newVersion', nv.version, 'newState', nv.state, 'newPriceVersionId', i.new_price_version_id, 'summary', i.summary,
          'oldRules', i.old_rules, 'newRules', i.new_rules)), '[]')
        from app_private.pricing_batch_items i
        join app_private.model_catalog mc on mc.id = i.model_id
        join app_private.price_versions nv on nv.id = i.new_price_version_id
        where i.batch_id = b.id)) order by b.created_at desc)
    from (select * from app_private.pricing_batches order by created_at desc limit least(greatest(coalesce(p_limit, 30), 1), 100)) b
    left join public.profiles p on p.user_id = b.actor_id), '[]');
end;
$$;

-- =====================================================================================================
-- Provider balance, spend and operations
-- =====================================================================================================

-- Claims the right to make ONE live balance read (shared by all staff and tabs). Concurrent or too-frequent
-- refreshes get the cached value instead of another KIE request.
create or replace function public.admin_begin_balance_refresh()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('provider.read');
  v_min int := coalesce((app_private.setting('provider_balance_min_refresh_seconds') #>> '{}')::int, 30);
  v_id uuid;
begin
  update app_private.provider_accounts set last_balance_attempt_at = now()
  where provider = 'kie' and label = 'primary'
    and (last_balance_attempt_at is null or last_balance_attempt_at < now() - make_interval(secs => v_min))
  returning id into v_id;
  return jsonb_build_object('proceed', v_id is not null, 'minIntervalSeconds', v_min);
end;
$$;

-- Records a real balance read (service only). A failure keeps the last good value and its time; it is never zero.
create or replace function public.record_provider_balance_result(p_ok boolean, p_credits numeric, p_error text, p_source text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  acc app_private.provider_accounts;
begin
  select * into acc from app_private.provider_accounts where provider = 'kie' and label = 'primary' for update;
  insert into app_private.provider_balance_snapshots (provider_account_id, ok, credits, error_code, source)
  values (acc.id, p_ok, case when p_ok then p_credits end, case when not p_ok then left(coalesce(p_error, 'UNKNOWN'), 120) end,
    case when p_source in ('admin', 'auto', 'worker') then p_source else 'worker' end);
  if p_ok then
    update app_private.provider_accounts set last_balance = p_credits, last_balance_at = now(), last_balance_error = null, last_balance_error_at = null
    where id = acc.id;
  else
    update app_private.provider_accounts set last_balance_error = left(coalesce(p_error, 'UNKNOWN'), 120), last_balance_error_at = now() where id = acc.id;
  end if;
end;
$$;
revoke execute on function public.record_provider_balance_result(boolean, numeric, text, text) from public, anon, authenticated;
grant execute on function public.record_provider_balance_result(boolean, numeric, text, text) to service_role;

-- The worker's periodic read goes through the same history.
create or replace function public.record_provider_balance(p_balance numeric)
returns void
language sql
security definer
set search_path = ''
as $$
  select public.record_provider_balance_result(true, p_balance, null, 'worker');
$$;
revoke execute on function public.record_provider_balance(numeric) from public, anon, authenticated;
grant execute on function public.record_provider_balance(numeric) to service_role;

create or replace function public.admin_set_low_balance_threshold(p_credits numeric)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('catalog.operate');
  acc app_private.provider_accounts;
begin
  if p_credits is not null and (p_credits < 0 or p_credits > 100000000) then
    perform app_private.fail('INVALID_INPUT', 'Enter a non-negative number of KIE credits, or clear the warning.');
  end if;
  select * into acc from app_private.provider_accounts where provider = 'kie' and label = 'primary' for update;
  update app_private.provider_accounts set low_balance_threshold = p_credits where id = acc.id;
  perform app_private.audit(v_actor, 'catalog.operate', 'provider.low_balance_threshold', 'provider_account', acc.id::text,
    case when p_credits is null then 'Cleared the low-balance warning' else 'Set the low-balance warning to ' || p_credits || ' KIE credits' end,
    jsonb_build_object('threshold', acc.low_balance_threshold), jsonb_build_object('threshold', p_credits));
  return jsonb_build_object('threshold', p_credits);
end;
$$;

-- Supplier spend is what KIE reported per task (creditsConsumed); jobs without a reading are counted, not guessed.
-- The committed figure is an ESTIMATE for in-flight work from the documented schedules and is never subtracted from
-- the balance KIE reports.
create or replace function public.admin_provider_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('provider.read');
  acc app_private.provider_accounts;
  v_usd numeric := (app_private.setting('kie_usd_per_credit') #>> '{}')::numeric;
begin
  select * into acc from app_private.provider_accounts where provider = 'kie' and label = 'primary';
  return jsonb_build_object(
    'generatedAt', now(),
    'balance', jsonb_build_object('credits', acc.last_balance, 'observedAt', acc.last_balance_at, 'lastAttemptAt', acc.last_balance_attempt_at,
      'lastError', acc.last_balance_error, 'lastErrorAt', acc.last_balance_error_at, 'threshold', acc.low_balance_threshold,
      'low', acc.last_balance is not null and acc.low_balance_threshold is not null and acc.last_balance < acc.low_balance_threshold,
      'paused', acc.paused, 'usdPerCredit', v_usd,
      'approxUsd', case when acc.last_balance is not null and v_usd is not null then round(acc.last_balance * v_usd, 2) end),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('ok', s.ok, 'credits', s.credits, 'error', s.error_code, 'source', s.source, 'at', s.observed_at)
        order by s.observed_at desc), '[]')
      from (select * from app_private.provider_balance_snapshots where provider_account_id = acc.id order by observed_at desc limit 20) s),
    'spend', (
      with obs as (
        select distinct on (o.job_id) o.job_id, o.credits_consumed, o.observed_at
        from app_private.provider_observations o
        where o.observed_at > now() - interval '30 days' and o.credits_consumed is not null
        order by o.job_id, o.observed_at desc
      ), settled as (
        select j.id, j.purpose, j.model_id, j.completed_at, obs.credits_consumed
        from public.generation_jobs j left join obs on obs.job_id = j.id
        where j.completed_at > now() - interval '30 days' and j.state in ('succeeded', 'failed')
          and exists (select 1 from app_private.provider_attempts a where a.job_id = j.id and a.provider_task_id is not null)
      )
      select jsonb_build_object(
        'timezone', 'UTC',
        'today', jsonb_build_object(
          'customerCredits', coalesce(sum(credits_consumed) filter (where purpose = 'customer' and completed_at >= date_trunc('day', now())), 0),
          'testCredits', coalesce(sum(credits_consumed) filter (where purpose = 'staff_test' and completed_at >= date_trunc('day', now())), 0),
          'unmeasuredJobs', count(*) filter (where credits_consumed is null and completed_at >= date_trunc('day', now()))),
        'days7', jsonb_build_object(
          'customerCredits', coalesce(sum(credits_consumed) filter (where purpose = 'customer' and completed_at >= now() - interval '7 days'), 0),
          'testCredits', coalesce(sum(credits_consumed) filter (where purpose = 'staff_test' and completed_at >= now() - interval '7 days'), 0),
          'unmeasuredJobs', count(*) filter (where credits_consumed is null and completed_at >= now() - interval '7 days')),
        'days30', jsonb_build_object(
          'customerCredits', coalesce(sum(credits_consumed) filter (where purpose = 'customer'), 0),
          'testCredits', coalesce(sum(credits_consumed) filter (where purpose = 'staff_test'), 0),
          'unmeasuredJobs', count(*) filter (where credits_consumed is null)),
        'byModel30d', (select coalesce(jsonb_agg(jsonb_build_object('modelId', x.model_id, 'name', mc.public_name, 'customerCredits', x.cc,
            'testCredits', x.tc, 'jobs', x.n, 'unmeasuredJobs', x.um) order by (x.cc + x.tc) desc), '[]')
          from (select model_id, coalesce(sum(credits_consumed) filter (where purpose = 'customer'), 0) cc,
                       coalesce(sum(credits_consumed) filter (where purpose = 'staff_test'), 0) tc, count(*) n,
                       count(*) filter (where credits_consumed is null) um
                from settled group by model_id) x
          left join app_private.model_catalog mc on mc.id = x.model_id)
      ) from settled
    ),
    'jobs', (select jsonb_build_object(
        'queued', count(*) filter (where state = 'queued'),
        'submitting', count(*) filter (where state in ('submitting', 'submission_unknown')),
        'running', count(*) filter (where state in ('provider_pending', 'importing')),
        'delayed', count(*) filter (where state = 'processing_delayed'),
        'review', count(*) filter (where state = 'review_required'),
        'failed24h', count(*) filter (where state = 'failed' and completed_at > now() - interval '24 hours'),
        'succeeded24h', count(*) filter (where state = 'succeeded' and completed_at > now() - interval '24 hours'),
        'failed7d', count(*) filter (where state = 'failed' and completed_at > now() - interval '7 days'),
        'succeeded7d', count(*) filter (where state = 'succeeded' and completed_at > now() - interval '7 days'),
        'tests7d', count(*) filter (where purpose = 'staff_test' and created_at > now() - interval '7 days'))
      from public.generation_jobs where state not in ('succeeded', 'failed', 'cancelled') or completed_at > now() - interval '7 days'),
    'processing7d', (select coalesce(jsonb_agg(jsonb_build_object('modelId', x.model_id, 'name', mc.public_name, 'succeeded', x.ok, 'failed', x.ko,
        'successRate', case when x.ok + x.ko > 0 then round(x.ok::numeric / (x.ok + x.ko), 4) end,
        'p50Seconds', x.p50, 'p95Seconds', x.p95) order by mc.sort_order), '[]')
      from (select model_id, count(*) filter (where state = 'succeeded') ok, count(*) filter (where state = 'failed') ko,
                   percentile_cont(0.5) within group (order by extract(epoch from completed_at - coalesce(submitted_at, created_at))) filter (where state = 'succeeded') p50,
                   percentile_cont(0.95) within group (order by extract(epoch from completed_at - coalesce(submitted_at, created_at))) filter (where state = 'succeeded') p95
            from public.generation_jobs where completed_at > now() - interval '7 days' and state in ('succeeded', 'failed') group by model_id) x
      left join app_private.model_catalog mc on mc.id = x.model_id),
    'committed', (select jsonb_build_object('jobs', count(*),
        'estimatedCredits', coalesce(sum(app_private.supplier_credits((app_private.latest_cost_version(j.model_id)).schedule, j.options,
          cardinality(j.reference_asset_ids), 1)), 0),
        'unknownCostJobs', count(*) filter (where app_private.supplier_credits((app_private.latest_cost_version(j.model_id)).schedule, j.options,
          cardinality(j.reference_asset_ids), 1) is null),
        'note', 'Estimate from documented cost schedules for queued and running work. KIE may already have deducted part of it; it is not subtracted from the balance shown.')
      from public.generation_jobs j where j.state in ('queued', 'submitting', 'submission_unknown', 'provider_pending', 'processing_delayed')),
    'billingUrl', 'https://kie.ai/billing'
  );
end;
$$;

-- Overview: customer metrics exclude private staff tests (counted separately).
create or replace function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('admin.access');
  v_fin boolean := app_private.has_capability(v_actor, 'billing.read') or app_private.has_capability(v_actor, 'reports.read');
  v_provider boolean := app_private.has_capability(v_actor, 'provider.read');
begin
  return jsonb_build_object(
    'generatedAt', now(),
    'service', jsonb_build_object(
      'generationPaused', coalesce((app_private.setting('generation_paused'))::text, 'false') = 'true',
      'watchdogHeartbeat', (app_private.setting('watchdog_heartbeat')) #>> '{}',
      'queues', (select coalesce(jsonb_agg(jsonb_build_object('queue', m.queue_name, 'length', m.queue_length, 'oldestSeconds', m.oldest_msg_age_sec)), '[]')
        from pgmq.metrics_all() m where m.queue_name like 'genlixs_%'),
      'oldestDueWorkSeconds', (select extract(epoch from now() - min(due_at))::int from app_private.job_work_items where state = 'pending' and due_at < now()),
      'deadLetters', (select count(*) from app_private.job_work_items where state = 'dead'),
      'providerBalance', case when v_provider then (select jsonb_build_object('value', last_balance, 'observedAt', last_balance_at, 'paused', paused,
          'lastError', last_balance_error, 'lastErrorAt', last_balance_error_at, 'threshold', low_balance_threshold)
        from app_private.provider_accounts where provider = 'kie' and label = 'primary') end,
      'models', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', public_name, 'state', state, 'verifiedAt', verified_at,
          'verificationStatus', verification_status) order by sort_order), '[]') from app_private.model_catalog)
    ),
    'jobs24h', (select jsonb_build_object(
        'total', count(*), 'succeeded', count(*) filter (where state = 'succeeded'), 'failed', count(*) filter (where state = 'failed'),
        'running', count(*) filter (where state not in ('succeeded', 'failed', 'cancelled')),
        'delayed', count(*) filter (where state = 'processing_delayed'),
        'unknownSubmissions', count(*) filter (where state = 'submission_unknown'),
        'reviewRequired', count(*) filter (where state = 'review_required'),
        'p50Seconds', percentile_cont(0.5) within group (order by extract(epoch from completed_at - created_at)) filter (where state = 'succeeded'),
        'p95Seconds', percentile_cont(0.95) within group (order by extract(epoch from completed_at - created_at)) filter (where state = 'succeeded'))
      from public.generation_jobs where created_at > now() - interval '24 hours' and purpose = 'customer'),
    'tests24h', (select count(*) from public.generation_jobs where created_at > now() - interval '24 hours' and purpose = 'staff_test'),
    'actionQueue', jsonb_build_object(
      'reviewJobs', (select count(*) from public.generation_jobs where state in ('review_required', 'submission_unknown')),
      'pendingAffiliateApplications', (select count(*) from public.affiliate_accounts where state = 'applied'),
      'openTickets', (select count(*) from public.support_tickets where status in ('open', 'in_progress')),
      'unprocessedBillingReceipts', (select count(*) from app_private.billing_event_receipts where state = 'received' and received_at < now() - interval '5 minutes'),
      'failedBillingReceipts', (select count(*) from app_private.billing_event_receipts where state = 'failed'),
      'payoutBatchesOpen', (select count(*) from public.payout_batches where state in ('draft', 'reviewed', 'submitting', 'submission_unknown'))
    ),
    'finance', case when v_fin then jsonb_build_object(
      'collected30d', (select coalesce(jsonb_object_agg(currency, total), '{}') from (
          select currency, sum(amount_minor)::text as total from public.billing_transactions
          where kind = 'payment' and created_at > now() - interval '30 days' group by currency) x),
      'refunded30d', (select coalesce(jsonb_object_agg(currency, total), '{}') from (
          select currency, (-sum(amount_minor))::text as total from public.billing_transactions
          where kind = 'refund' and created_at > now() - interval '30 days' group by currency) x),
      'commissionsOutstanding', (select coalesce(jsonb_object_agg(currency, total), '{}') from (
          select currency, sum(amount_minor - reversed_minor)::text as total from public.commission_entries
          where state in ('pending_hold', 'eligible', 'reserved_for_payout') group by currency) x),
      'commissionsPaid', (select coalesce(jsonb_object_agg(currency, total), '{}') from (
          select currency, sum(amount_minor)::text as total from public.commission_entries where state = 'paid' group by currency) x),
      'supplierCredits30d', (select jsonb_build_object('measured', coalesce(sum(credits_consumed), 0), 'unknownCount', count(*) filter (where credits_consumed is null))
          from (select distinct on (job_id) job_id, credits_consumed from app_private.provider_observations
                where normalized_state in ('success', 'fail') and observed_at > now() - interval '30 days' order by job_id, observed_at desc) o),
      'creditsGranted30d', (select coalesce(sum(d_available), 0)::text from public.credit_ledger where event_type = 'grant' and created_at > now() - interval '30 days'),
      'creditsConsumed30d', (select coalesce(sum(d_spent), 0)::text from public.credit_ledger where event_type = 'capture' and created_at > now() - interval '30 days'),
      'note', 'Collected revenue, supplier consumption and commissions are reported separately; this is not net profit.'
    ) end,
    'recentActivity', (select coalesce(jsonb_agg(jsonb_build_object('action', l.action, 'targetKind', l.target_kind, 'targetId', l.target_id,
        'reason', l.reason, 'at', l.created_at)), '[]')
      from (select * from app_private.admin_audit_logs order by created_at desc limit 10) l)
  );
end;
$$;
revoke execute on function public.admin_overview() from public, anon;
grant execute on function public.admin_overview() to authenticated;

create or replace function public.admin_list_jobs(p_state text default null, p_model text default null, p_q text default null,
  p_before timestamptz default null, p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('jobs.read');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', j.id, 'ref', j.short_ref, 'customer', p.email, 'tool', j.tool, 'modelId', j.model_id,
      'purpose', j.purpose, 'state', j.state, 'settlementState', j.settlement_state, 'units', j.units::text, 'createdAt', j.created_at,
      'waitSeconds', extract(epoch from coalesce(j.completed_at, now()) - j.created_at)::int,
      'taskId', (select t.provider_task_id from app_private.provider_attempts t where t.job_id = j.id order by t.ordinal desc limit 1),
      'supplierCredits', (select o.credits_consumed from app_private.provider_observations o where o.job_id = j.id and o.credits_consumed is not null
                          order by o.observed_at desc limit 1),
      'failureCode', j.failure_code) order by j.created_at desc)
    from (
      select * from public.generation_jobs j0
      where (p_state is null or j0.state = p_state
             or (p_state = 'attention' and j0.state in ('submission_unknown', 'review_required', 'processing_delayed'))
             or (p_state = 'tests' and j0.purpose = 'staff_test'))
        and (p_model is null or j0.model_id = p_model)
        and (p_before is null or j0.created_at < p_before)
        and (p_q is null or j0.short_ref ilike p_q || '%' or j0.id::text = p_q
             or exists (select 1 from app_private.provider_attempts t where t.job_id = j0.id and t.provider_task_id = p_q)
             or exists (select 1 from public.profiles pp where pp.user_id = j0.user_id and pp.email ilike p_q || '%'))
      order by j0.created_at desc
      limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) j join public.profiles p on p.user_id = j.user_id
  ), '[]');
end;
$$;
revoke execute on function public.admin_list_jobs(text, text, text, timestamptz, int) from public, anon;
grant execute on function public.admin_list_jobs(text, text, text, timestamptz, int) to authenticated;

-- The launch placeholder drafts were never approved prices; retire them (kept as history) so they cannot be
-- published by mistake now that publication no longer requires a pasted paid-test note.
update app_private.price_versions set state = 'retired' where state = 'draft' and source = 'seed';

-- =====================================================================================================
-- Grants for the new admin entry points (authenticated callers; each checks its own capability)
-- =====================================================================================================

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.admin_pricing_preview(text, text[], numeric, boolean)',
    'public.admin_pricing_apply(text, text[], numeric, boolean, text, text, text[])',
    'public.admin_save_price_draft(text, jsonb, int, text)',
    'public.admin_restore_price_version(uuid, text)',
    'public.admin_set_model_availability(text, text, text, boolean, uuid, text)',
    'public.admin_bulk_set_availability(text[], text, boolean)',
    'public.admin_update_model_display(text, text, text, text[])',
    'public.admin_save_supplier_cost(text, jsonb, text, text, timestamptz, text, jsonb)',
    'public.admin_set_pricing_assumptions(numeric, numeric, numeric)',
    'public.admin_package_impact(jsonb)',
    'public.admin_create_model_test(text, text, jsonb, uuid[], text, boolean)',
    'public.admin_authorize_test_output(uuid)',
    'public.admin_model_detail(text)',
    'public.admin_pricing_batches(int)',
    'public.admin_begin_balance_refresh()',
    'public.admin_set_low_balance_threshold(numeric)',
    'public.admin_provider_summary()'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end;
$$;
