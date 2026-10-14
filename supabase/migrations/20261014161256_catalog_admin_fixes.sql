-- Genlixs 14 · Fixes found while testing the admin catalog functions (rolled-back SQL tests).

-- Unknown-cost labels were appended to a text[] without a cast ("malformed array literal").
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
  if v_fee is null then v_excl := array_append(v_excl, 'variable payment fees'::text); end if;
  if v_fixed is null then v_excl := array_append(v_excl, 'fixed payment fees'::text); end if;
  if v_op is null then v_excl := array_append(v_excl, 'operating costs'::text); end if;
  return jsonb_build_object(
    'revenueUsd', round(v_rev, 6),
    'direct', round(v_rev * (1 - coalesce(v_fee, 0) / 10000) - v_costs, 6),
    'affiliateBase', round(v_rev * (1 - v_base / 10000 - coalesce(v_fee, 0) / 10000) - v_costs, 6),
    'affiliateUplift', round(v_rev * (1 - v_up / 10000 - coalesce(v_fee, 0) / 10000) - v_costs, 6),
    'excludes', to_jsonb(v_excl)
  );
end;
$$;

-- Scopes list models in catalog order (images, edits, videos) rather than alphabetically by tool.
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
    select array_agg(id order by sort_order, id) into v from app_private.model_catalog;
  elsif p_scope = 'images' then
    select array_agg(id order by sort_order, id) into v from app_private.model_catalog where tool in ('image', 'edit');
  elsif p_scope = 'videos' then
    select array_agg(id order by sort_order, id) into v from app_private.model_catalog where tool = 'video';
  elsif p_scope = 'selected' then
    select array_agg(id order by sort_order, id) into v from app_private.model_catalog where id = any (coalesce(p_model_ids, '{}'));
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

-- Customer-facing copy must not mention supplier costs.
update app_private.model_catalog
set purpose = 'OpenAI''s quality-optimised image model: finer detail and closer instruction following than Flare.'
where id = 'gpt-sunburst-image';

-- A row variable with no row found is not a SQL NULL, so coalesce(pub, dr) always returned "pub": the current
-- price (published, otherwise latest draft) is now chosen explicitly, which makes manual overrides detectable.
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
  if pub.id is not null then
    cur := pub;
  else
    cur := dr;
  end if;
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
