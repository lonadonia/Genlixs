-- Genlixs 15 · Simplified admin controls and explicit credit pricing.
--
-- * Two reference values, versioned and append-only: what one KIE credit costs Genlixs (a purchase: USD paid and KIE
--   credits received) and the USD reference value of one Genlixs credit (a base amount and a credit quantity).
--   Generation charges are calculated from these two values; packages are compared against them. The rule that valued
--   credits at the cheapest package is no longer used for pricing.
-- * Changing a reference value never touches wallets, ledger entries, orders, quotes, running jobs or published prices.
--   Recalculating future prices is a separate, explicit action.
-- * Packages: bonus credits (part of the usable credits granted) and one-step editing that creates a new version.
-- * Prices: one-step save (a new immutable published version), optional draft, audited acceptance below the KIE cost.
-- * Availability: a model with an implemented adapter, a known KIE cost and a published price can be switched on
--   without a paid test or an extra confirmation. Its verification status stays as it is; untested stays untested.
-- Additive: new table, new columns with defaults, new functions and replaced function bodies (same signatures).

-- =====================================================================================================
-- Reference values
-- =====================================================================================================

create table app_private.pricing_reference_versions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('kie_purchase', 'credit_value')),
  version int not null,
  amount_usd numeric(14, 2) not null check (amount_usd > 0),
  -- KIE: credits received for the amount (bonus included). Genlixs: the credit quantity the amount buys.
  credits numeric(16, 2) not null check (credits > 0),
  -- KIE only: how many of the credits received were a top-up bonus (shown as an assumption).
  bonus_credits numeric(16, 2) not null default 0 check (bonus_credits >= 0),
  usd_per_credit numeric generated always as (round(amount_usd / credits, 10)) stored,
  source_url text check (source_url is null or source_url ~ '^https://'),
  note text,
  -- Illustrative starting value that the owner has not confirmed yet.
  is_example boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (kind, version),
  check (bonus_credits < credits),
  check (kind = 'kie_purchase' or bonus_credits = 0),
  check (kind = 'kie_purchase' or credits = trunc(credits))
);
create trigger pricing_reference_versions_append_only before update or delete on app_private.pricing_reference_versions
  for each row execute function app_private.forbid_mutation();
alter table app_private.pricing_reference_versions enable row level security;

insert into app_private.pricing_reference_versions (kind, version, amount_usd, credits, source_url, note, is_example) values
  ('kie_purchase', 1, 5, 1000, 'https://kie.ai/pricing',
   'KIE standard rate: $0.005 per credit (pricing page, checked 2026-10-14). Larger top-ups add bonus credits; enter your own purchase to use its rate.', false),
  ('credit_value', 1, 5, 250, null,
   'Illustrative starting value ($5 for 250 credits = $0.02 per credit). Confirm or change it. It does not change packages or prices.', true);

create or replace function app_private.current_reference(p_kind text)
returns app_private.pricing_reference_versions
language sql
stable
set search_path = ''
as $$
  select * from app_private.pricing_reference_versions where kind = p_kind order by version desc limit 1;
$$;

create or replace function app_private.reference_json(r app_private.pricing_reference_versions)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select case when r.id is null then null else jsonb_build_object(
    'id', r.id, 'kind', r.kind, 'version', r.version, 'amountUsd', r.amount_usd, 'credits', r.credits, 'bonusCredits', r.bonus_credits,
    'usdPerCredit', r.usd_per_credit, 'sourceUrl', r.source_url, 'note', r.note, 'isExample', r.is_example, 'createdAt', r.created_at,
    'createdBy', (select p.email from public.profiles p where p.user_id = r.created_by)) end;
$$;

-- USD cost of one KIE credit: the current KIE purchase reference (the documented setting only if none exists).
create or replace function app_private.kie_usd_per_credit()
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce((app_private.current_reference('kie_purchase')).usd_per_credit, (app_private.setting('kie_usd_per_credit') #>> '{}')::numeric);
$$;

-- Valuation basis for generation charges: the Genlixs credit reference value. Same shape as the former package basis
-- ("minRevenuePerCredit" is still the field the price table and contribution functions read).
create or replace function app_private.credit_basis()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  r app_private.pricing_reference_versions := app_private.current_reference('credit_value');
begin
  if r.id is null then
    return jsonb_build_object('source', 'none', 'currency', 'USD', 'minRevenuePerCredit', null, 'usdPerCredit', null, 'conservative', null,
      'reference', null, 'products', '[]'::jsonb, 'excluded', '[]'::jsonb, 'note', 'Set the Genlixs credit value before pricing models.');
  end if;
  return jsonb_build_object(
    'source', 'reference', 'currency', 'USD',
    'minRevenuePerCredit', r.usd_per_credit,
    'usdPerCredit', r.usd_per_credit,
    'conservative', jsonb_build_object('name', 'Genlixs credit value', 'credits', r.credits::bigint::text, 'amountMinor', (r.amount_usd * 100)::bigint::text),
    'reference', app_private.reference_json(r),
    'products', '[]'::jsonb, 'excluded', '[]'::jsonb,
    'note', 'Charges are valued at the Genlixs credit value (USD per credit). Packages are compared against it.');
end;
$$;

create or replace function app_private.pricing_assumptions()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'usdPerKieCredit', app_private.kie_usd_per_credit(),
    'kieReference', app_private.reference_json(app_private.current_reference('kie_purchase')),
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

create or replace function app_private.fmt_usd(p numeric)
returns text
language sql
immutable
set search_path = ''
as $$
  select '$' || trim_scale(p)::text;
$$;

-- =====================================================================================================
-- Price table: KIE cost at the KIE reference rate; summary of the published price's actual markup
-- =====================================================================================================

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
  v_kie numeric;
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
  v_below int := 0;
  v_status text := 'ok';
  v_stale boolean := false;
  v_override boolean := false;
  v_extra jsonb;
  v_extra_units bigint;
  v_contrib jsonb;
  v_mk numeric;
  v_min_s numeric; v_max_s numeric; v_min_n bigint; v_max_n bigint; v_worst numeric; v_mk_min numeric; v_mk_max numeric;
begin
  select * into m from app_private.model_catalog where id = p_model_id;
  if not found then
    return null;
  end if;
  c := app_private.capability_for(m.id);
  sc := app_private.latest_cost_version(m.id);
  v_kie := coalesce((p_assump ->> 'usdPerKieCredit')::numeric, sc.usd_per_credit);
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
      v_susd := round(v_sc * v_kie, 8);
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
      -- Actual markup of the published charge at the given credit value (before payment fees and commission).
      if v_old is not null and v_susd is not null and v_susd > 0 and v_rpc is not null then
        v_mk := round(v_old * v_rpc / v_susd - 1, 6);
        v_mk_min := least(v_mk_min, v_mk); v_mk_max := greatest(v_mk_max, v_mk);
        if v_old * v_rpc < v_susd then v_below := v_below + 1; end if;
      end if;
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
      v_extra_units := greatest(ceil(round((v_extra ->> 'credits')::numeric * v_kie * (10000 + p_markup_bps) / 10000 / v_rpc, 12))::bigint, 1);
    end if;
  end if;

  if p_markup_bps is not null and v_status in ('ok', 'manual_override') then
    v_rules := jsonb_build_object('format', 'table', 'dims', v_dims, 'units', v_units)
      || case when v_extra_units is not null then jsonb_build_object('perExtraReference', jsonb_build_object('free', (v_extra ->> 'free')::int, 'units', v_extra_units)) else '{}'::jsonb end;
  end if;

  return jsonb_build_object(
    'modelId', m.id, 'name', m.public_name, 'tool', m.tool, 'category', app_private.model_category(m.tool), 'state', m.state,
    'capabilityVersionId', c.id, 'capabilityVersion', c.version,
    'status', v_status, 'selectable', v_status = 'ok',
    'override', v_override, 'currentSource', cur.source,
    'cost', case when sc.id is not null then jsonb_build_object('versionId', sc.id, 'version', sc.version, 'unit', sc.schedule ->> 'unit',
      'sourceKind', sc.source_kind, 'sourceUrl', sc.source_url, 'checkedAt', sc.source_checked_at, 'usdPerCredit', v_kie,
      'documentedUsdPerCredit', sc.usd_per_credit, 'stale', v_stale, 'note', sc.note,
      'extraReference', case when v_extra is not null and coalesce((c.spec -> 'references' ->> 'max')::int, 0) > coalesce((v_extra ->> 'free')::int, 0) then v_extra end) end,
    'published', case when pub.id is not null then jsonb_build_object('id', pub.id, 'version', pub.version, 'source', pub.source,
      'effectiveAt', pub.effective_at, 'currentCapability', pub.capability_version_id = c.id,
      'perExtraReference', pub.rules -> 'perExtraReference') end,
    'draft', case when dr.id is not null then jsonb_build_object('id', dr.id, 'version', dr.version, 'source', dr.source,
      'currentCapability', dr.capability_version_id = c.id, 'perExtraReference', dr.rules -> 'perExtraReference') end,
    'configs', v_rows, 'configCount', v_n, 'missingCost', v_missing,
    'summary', jsonb_build_object('minSupplierCredits', v_min_s, 'maxSupplierCredits', v_max_s, 'minUnits', v_min_n, 'maxUnits', v_max_n,
      'worstUpliftContribution', v_worst, 'lossConfigsUplift', v_loss, 'lossConfigsDirect', v_direct_loss,
      'markupMin', v_mk_min, 'markupMax', v_mk_max, 'belowCostConfigs', v_below),
    'proposedRules', v_rules, 'perExtraReferenceUnits', v_extra_units
  );
end;
$$;

-- Configurations of a price whose charge is worth less than the KIE cost at the current reference values.
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
  v_dims := case when p_rules ->> 'format' = 'table' then p_rules -> 'dims' else app_private.price_dims(sc.schedule) end;
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

-- Preview of bulk markup prices, valued at the Genlixs credit value. "revision" fingerprints every input (prices,
-- drafts, costs, capabilities, both reference values, assumptions and the markup).
create or replace function app_private.pricing_preview(p_models text[], p_markup_bps int, p_include_overrides boolean)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_basis jsonb := app_private.credit_basis();
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

-- =====================================================================================================
-- Reference values: save (new version) and impact preview
-- =====================================================================================================

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
begin
  if p_kind is null or p_kind not in ('kie_purchase', 'credit_value') then
    perform app_private.fail('INVALID_INPUT', 'Choose the KIE purchase or the Genlixs credit value.');
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
  end if;
  perform app_private.audit(v_actor, 'pricing.review', 'pricing.reference', 'pricing_reference', v_new.id::text,
    case when p_kind = 'kie_purchase'
      then 'Set the KIE purchase reference to ' || app_private.fmt_usd(p_amount_usd) || ' for ' || trim_scale(p_credits)::text || ' KIE credits ('
        || app_private.fmt_usd(v_new.usd_per_credit) || ' per KIE credit'
        || case when v_bonus > 0 then ', including ' || trim_scale(v_bonus)::text || ' bonus credits' else '' end || ')'
      else 'Set the Genlixs credit value to ' || app_private.fmt_usd(p_amount_usd) || ' for ' || trim_scale(p_credits)::text || ' credits ('
        || app_private.fmt_usd(v_new.usd_per_credit) || ' per credit)' end
      || '. Wallets, purchases, quotes, running jobs and published prices were not changed.',
    app_private.reference_json(cur), app_private.reference_json(v_new));
  return jsonb_build_object('unchanged', false, 'reference', app_private.reference_json(v_new), 'previous', app_private.reference_json(cur));
end;
$$;
revoke execute on function public.admin_save_pricing_reference(text, numeric, numeric, numeric, text, text, uuid) from public, anon;
grant execute on function public.admin_save_pricing_reference(text, numeric, numeric, numeric, text, text, uuid) to authenticated;

-- What a reference change would mean for the published prices (actual markup and charges below the KIE cost).
-- Nothing is saved.
create or replace function public.admin_reference_impact(p_kind text, p_amount_usd numeric, p_credits numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('pricing.review');
  v_basis jsonb := app_private.credit_basis();
  v_assump jsonb := app_private.pricing_assumptions();
  v_basis2 jsonb;
  v_assump2 jsonb;
  v_rate numeric;
  v_models jsonb := '[]'::jsonb;
  t1 jsonb;
  t2 jsonb;
  m record;
begin
  if p_kind is null or p_kind not in ('kie_purchase', 'credit_value') or p_amount_usd is null or p_amount_usd <= 0
     or p_credits is null or p_credits <= 0 then
    perform app_private.fail('INVALID_INPUT', 'Enter a positive amount and credit quantity.');
  end if;
  v_rate := round(p_amount_usd / p_credits, 10);
  v_basis2 := v_basis;
  v_assump2 := v_assump;
  if p_kind = 'credit_value' then
    v_basis2 := v_basis || jsonb_build_object('minRevenuePerCredit', v_rate, 'usdPerCredit', v_rate);
  else
    v_assump2 := v_assump || jsonb_build_object('usdPerKieCredit', v_rate);
  end if;
  for m in select id from app_private.model_catalog order by sort_order, id loop
    t1 := app_private.model_price_table(m.id, null, v_basis, v_assump, false);
    if t1 -> 'published' is null or not coalesce((t1 -> 'published' ->> 'currentCapability')::boolean, false) then
      continue;
    end if;
    t2 := app_private.model_price_table(m.id, null, v_basis2, v_assump2, false);
    v_models := v_models || jsonb_build_array(jsonb_build_object('modelId', m.id, 'name', t1 ->> 'name', 'state', t1 ->> 'state',
      'minUnits', t1 -> 'summary' -> 'minUnits', 'maxUnits', t1 -> 'summary' -> 'maxUnits',
      'before', jsonb_build_object('markupMin', t1 -> 'summary' -> 'markupMin', 'markupMax', t1 -> 'summary' -> 'markupMax',
        'belowCost', t1 -> 'summary' -> 'belowCostConfigs'),
      'after', jsonb_build_object('markupMin', t2 -> 'summary' -> 'markupMin', 'markupMax', t2 -> 'summary' -> 'markupMax',
        'belowCost', t2 -> 'summary' -> 'belowCostConfigs')));
  end loop;
  return jsonb_build_object('kind', p_kind, 'usdPerCredit', v_rate,
    'currentUsdPerCredit', case when p_kind = 'credit_value' then v_basis -> 'usdPerCredit' else v_assump -> 'usdPerKieCredit' end,
    'models', v_models,
    'note', 'Nothing was saved. Wallet balances, purchases, quotes, running jobs and published prices do not change when a reference value changes.');
end;
$$;
revoke execute on function public.admin_reference_impact(text, numeric, numeric) from public, anon;
grant execute on function public.admin_reference_impact(text, numeric, numeric) to authenticated;
