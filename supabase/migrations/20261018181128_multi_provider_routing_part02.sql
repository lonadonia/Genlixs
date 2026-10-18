-- Native supplier amount for one whole request, all documented charges once. NULL = unknown for these settings.
create or replace function app_private.offer_native_cost(p_schedule jsonb, p_options jsonb, p_qty jsonb)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_basis text := coalesce(p_schedule ->> 'basis', 'output');
  v_rate numeric;
  v_out numeric;
  v_in numeric := 0;
  v_total numeric;
  v_imgs int := 0;
  v_free int;
  v_extra_rate numeric;
  v_slot text;
begin
  if p_schedule is null or jsonb_typeof(p_schedule -> 'rates') <> 'object' then
    return null;
  end if;
  v_rate := app_private.num(p_schedule -> 'rates' -> app_private.option_key(p_schedule -> 'dims', p_options));
  if v_rate is null or v_rate < 0 then
    return null;
  end if;
  if v_basis in ('output_second', 'io_second') then
    v_out := coalesce(app_private.num(p_schedule -> 'seconds' -> 'fixed'),
      app_private.num(p_options -> coalesce(p_schedule -> 'seconds' ->> 'option', 'duration')));
    if v_out is null or v_out <= 0 then
      return null;
    end if;
    if p_schedule ->> 'roundSeconds' = 'ceil' then
      v_out := ceil(v_out);
    end if;
    v_out := greatest(v_out, coalesce(app_private.num(p_schedule -> 'minSeconds'), 0))
             * coalesce(app_private.num(p_schedule -> 'secondsFactor'), 1);
    if v_basis = 'io_second' then
      for v_slot in select jsonb_array_elements_text(coalesce(p_schedule -> 'inputSeconds' -> 'slots', '[]'::jsonb)) loop
        v_in := v_in + coalesce(app_private.num(p_qty -> 'seconds' -> v_slot), 0);
      end loop;
      if p_schedule -> 'inputSeconds' ->> 'round' = 'ceil' then
        v_in := ceil(v_in);
      end if;
    end if;
    v_total := v_rate * (v_out + v_in);
  elsif v_basis = 'request' then
    v_total := v_rate;
  elsif v_basis = 'output' then
    v_total := v_rate * greatest(coalesce((p_qty ->> 'outputs')::int, 1), 1);
  else
    return null;
  end if;
  if p_schedule ? 'extraImages' then
    for v_slot in select jsonb_array_elements_text(coalesce(p_schedule -> 'extraImages' -> 'slots', '["_references"]'::jsonb)) loop
      v_imgs := v_imgs + coalesce((p_qty -> 'counts' ->> v_slot)::int, 0);
    end loop;
    v_free := coalesce((p_schedule -> 'extraImages' ->> 'free')::int, 0);
    if v_imgs > v_free then
      v_extra_rate := app_private.num(p_schedule -> 'extraImages' -> 'rate');
      if v_extra_rate is null then
        -- A documented surcharge with no known amount: the whole request has no known cost.
        return null;
      end if;
      v_total := v_total + (v_imgs - v_free) * v_extra_rate;
    end if;
  end if;
  if p_schedule ? 'roundDecimals' then
    v_total := round(v_total, (p_schedule ->> 'roundDecimals')::int);
  end if;
  return v_total;
end;
$$;

-- Nominal and effective (funded) USD. A card fee is added once; a credit bonus divides (10 % bonus = ÷ 1.10).
create or replace function app_private.effective_usd(p_native numeric, p_units_per_usd numeric, p_fee_bps numeric, p_bonus_bps numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when p_native is null or p_units_per_usd is null then null
    else round(p_native / p_units_per_usd * (1 + coalesce(p_fee_bps, 0) / 10000) / (1 + coalesce(p_bonus_bps, 0) / 10000), 10) end;
$$;

-- The KIE cost schedule of the existing catalog in the offer schedule format (same arithmetic as supplier_credits).
create or replace function app_private.schedule_from_supplier_cost(s jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when s is null then null else jsonb_strip_nulls(jsonb_build_object(
    'basis', case s ->> 'unit' when 'second' then 'output_second' else 'output' end,
    'dims', coalesce(s -> 'dims', '[]'::jsonb),
    'rates', s -> 'rates',
    'seconds', case when s ->> 'unit' = 'second' then jsonb_build_object('option', coalesce(s ->> 'durationOption', 'duration')) end,
    'secondsFactor', s -> 'secondsFactor',
    'extraImages', case when s ? 'extraReference' then jsonb_build_object('slots', '["_references"]'::jsonb,
      'free', coalesce(s -> 'extraReference' -> 'free', '0'::jsonb), 'rate', s -> 'extraReference' -> 'credits') end)) end;
$$;

-- Current price of an offer: its latest own version, or for a legacy KIE offer the latest supplier cost version.
create or replace function app_private.offer_price(p_offer_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  o app_private.provider_offers;
  pr app_private.provider_offer_prices;
  sc app_private.supplier_cost_versions;
begin
  select * into o from app_private.provider_offers where id = p_offer_id;
  if not found then
    return null;
  end if;
  select * into pr from app_private.provider_offer_prices where offer_id = o.id order by version desc limit 1;
  if found then
    return jsonb_build_object('kind', 'offer', 'id', pr.id, 'version', pr.version, 'unit', pr.unit, 'schedule', pr.schedule,
      'confidence', pr.confidence, 'sourceKind', pr.source_kind, 'sourceUrl', pr.source_url, 'checkedAt', pr.checked_at,
      'effectiveAt', pr.effective_at, 'expiresAt', pr.expires_at, 'assumptions', pr.assumptions, 'promotion', pr.promotion);
  end if;
  if o.is_legacy_primary and o.model_id is not null then
    sc := app_private.latest_cost_version(o.model_id);
    if sc.id is not null then
      return jsonb_build_object('kind', 'supplier_cost', 'id', sc.id, 'version', sc.version, 'unit', 'kie_credit',
        'schedule', app_private.schedule_from_supplier_cost(sc.schedule),
        'confidence', case sc.source_kind when 'observed' then 'authoritative' when 'documented' then 'documented' else 'unverified' end,
        'sourceKind', sc.source_kind, 'sourceUrl', sc.source_url, 'checkedAt', sc.source_checked_at, 'expiresAt', null,
        'assumptions', sc.note);
    end if;
  end if;
  return null;
end;
$$;

-- NULL when the offer can do exactly this request; otherwise the reason it cannot. Settings the offer does not list
-- make it incompatible: a supplier that would ignore a requested setting must not take the job.
create or replace function app_private.offer_incompatibility(p_caps jsonb, p_options jsonb, p_mode text, p_qty jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  k text;
  v jsonb;
  allowed jsonb;
  lim jsonb;
  n numeric;
begin
  if coalesce((p_caps ->> 'inherit')::boolean, false) then
    return null;
  end if;
  for k, v in select key, value from jsonb_each(coalesce(p_options, '{}'::jsonb)) loop
    allowed := p_caps -> 'options' -> k;
    if allowed is null then
      return format('setting "%s" is not supported', k);
    end if;
    if jsonb_typeof(allowed) = 'array' then
      if not (allowed @> jsonb_build_array(v) or allowed @> jsonb_build_array(v #>> '{}')
              or (app_private.num(v) is not null and allowed @> jsonb_build_array(app_private.num(v)))) then
        return format('%s %s is not supported', k, v #>> '{}');
      end if;
    elsif jsonb_typeof(allowed) = 'object' then
      n := app_private.num(v);
      if n is null or n < coalesce(app_private.num(allowed -> 'min'), n) or n > coalesce(app_private.num(allowed -> 'max'), n) then
        return format('%s %s is outside the supported range', k, v #>> '{}');
      end if;
    else
      return format('setting "%s" is not supported', k);
    end if;
  end loop;
  if p_mode is not null and not coalesce(p_caps -> 'modes' @> jsonb_build_array(p_mode), false) then
    return format('the "%s" input mode is not supported', p_mode);
  end if;
  for k, v in select key, value from jsonb_each(coalesce(p_qty -> 'counts', '{}'::jsonb)) loop
    if coalesce((v #>> '{}')::int, 0) > 0 then
      lim := p_caps -> 'inputs' -> k;
      if lim is null then
        return format('input "%s" is not supported', k);
      end if;
      if (v #>> '{}')::int > coalesce((lim ->> 'max')::int, 0) then
        return format('at most %s file(s) for "%s"', coalesce(lim ->> 'max', '0'), k);
      end if;
      if lim ? 'maxTotalSeconds' and coalesce(app_private.num(p_qty -> 'seconds' -> k), 0) > app_private.num(lim -> 'maxTotalSeconds') then
        return format('"%s" is longer than %s s in total', k, lim ->> 'maxTotalSeconds');
      end if;
    end if;
  end loop;
  if p_caps ? 'maxPromptChars' and coalesce((p_qty ->> 'promptChars')::int, 0) > (p_caps ->> 'maxPromptChars')::int then
    return 'the prompt is longer than this supplier accepts';
  end if;
  return null;
end;
$$;

-- ==================================================================== routing

-- Pending local reservations of an account in its native unit since its last balance read (submitted work whose charge
-- is not confirmed yet), so concurrent submissions cannot all spend the same stale balance.
create or replace function app_private.account_pending_native(p_account_id uuid, p_since timestamptz)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(estimated_native), 0) from app_private.provider_cost_ledger
  where provider_account_id = p_account_id and state in ('reserved', 'submission_unknown', 'pending_confirmation')
    and (p_since is null or created_at >= p_since);
$$;

-- Genlixs spending of an account today (UTC): confirmed amounts where known, estimates otherwise.
create or replace function app_private.account_spent_today_usd(p_account_id uuid)
returns numeric
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(coalesce(confirmed_effective_usd, estimated_effective_usd)), 0) from app_private.provider_cost_ledger
  where provider_account_id = p_account_id and created_at >= date_trunc('day', now() at time zone 'UTC') at time zone 'UTC'
    and state not in ('not_charged', 'failed', 'refunded');
$$;

-- Every offer of a model evaluated for one exact request. `excluded` is NULL for an eligible offer; `health` marks an
-- exclusion that is temporary (circuit breaker, spending cap, low balance) rather than structural.
-- p_runtime (worker only) lists the environment secrets present: {"envSecrets": ["KIE_API_KEY"]}.
-- p_pin restricts the evaluation to one offer (private staff test of that offer).
create or replace function app_private.route_evaluate(
  p_model_id text, p_options jsonb, p_mode text, p_qty jsonb,
  p_runtime jsonb default null, p_pin uuid default null, p_staff_test boolean default false
) returns table (
  offer_id uuid, account_id uuid, provider text, provider_label text, adapter text, upstream_model_id text, legacy boolean,
  account_order int, offer_order int, native numeric, unit text, unit_version_id uuid, units_per_usd numeric,
  fee_bps numeric, bonus_bps numeric, funding_version int, nominal_usd numeric, effective_usd numeric, price jsonb,
  credential_version int, credential_source text, excluded text, health text
)
language plpgsql
stable
set search_path = ''
as $$
declare
  o record;
  v_price jsonb;
  v_cu app_private.cost_unit_versions;
  v_stale_days int := coalesce((app_private.setting('provider_price_stale_days') #>> '{}')::int, 30);
  v_bal_stale int := coalesce((app_private.setting('provider_balance_stale_minutes') #>> '{}')::int, 60);
  v_why text;
  v_avail numeric;
begin
  for o in
    select f.*, a.provider as a_provider, coalesce(a.display_name, a.provider) as a_label, a.enabled as a_enabled, a.paused as a_paused,
      a.credential_version as a_cred, a.secret_ref as a_secret_ref, a.connection_state as a_conn, a.submit_blocked_until as a_blocked,
      a.funding_fee_bps as a_fee, a.funding_bonus_bps as a_bonus, a.funding_version as a_fver, a.sort_order as a_order,
      a.daily_spend_cap_usd as a_cap, a.last_balance as a_total, a.balance_available as a_available, a.balance_unit as a_bunit,
      a.balance_source as a_bsource, a.last_balance_at as a_bat, a.key_quota_unlimited as a_unlimited, a.id as a_id
    from app_private.provider_offers f
    join app_private.provider_accounts a on a.id = f.provider_account_id
    where f.model_id = p_model_id and (p_pin is null or f.id = p_pin)
    order by f.id
  loop
    offer_id := o.id; account_id := o.a_id; provider := o.a_provider; provider_label := o.a_label; adapter := o.adapter;
    upstream_model_id := o.upstream_model_id; legacy := o.is_legacy_primary; account_order := o.a_order; offer_order := o.sort_order;
    native := null; unit := null; unit_version_id := null; units_per_usd := null; nominal_usd := null; effective_usd := null;
    fee_bps := o.a_fee; bonus_bps := o.a_bonus; funding_version := o.a_fver; price := null; health := null; excluded := null;
    credential_version := o.a_cred;
    credential_source := case when o.a_cred > 0 then 'vault' when o.a_secret_ref = 'KIE_API_KEY' then 'environment' else 'none' end;

    -- structural checks
    if o.adapter is null then
      excluded := 'No integration for this offer in this release';
    elsif p_pin is null and not o.routing_enabled then
      excluded := 'Switched off for routing';
    elsif p_pin is null and o.status <> 'eligible' then
      excluded := 'Not verified for routing (' || replace(o.status, '_', ' ') || ')';
    elsif p_pin is not null and o.status in ('disabled', 'unavailable') then
      excluded := 'Offer is ' || o.status;
    elsif p_pin is null and not o.a_enabled then
      excluded := 'Provider switched off';
    elsif o.a_paused then
      excluded := 'Provider paused';
    elsif credential_source = 'none' then
      excluded := 'No API key saved';
    elsif credential_source = 'environment' and p_runtime is not null and not coalesce(p_runtime -> 'envSecrets' ? o.a_secret_ref, false) then
      excluded := 'Server key missing in this deployment';
    elsif o.a_conn = 'unauthorized' then
      excluded := 'Key refused by the provider at the last connection test';
    end if;

    if excluded is null then
      v_why := app_private.offer_incompatibility(o.capabilities, p_options, p_mode, p_qty);
      if v_why is not null then
        excluded := 'Incompatible: ' || v_why;
      end if;
    end if;

    if excluded is null then
      v_price := app_private.offer_price(o.id);
      price := v_price;
      if v_price is null then
        if not o.is_legacy_primary then
          excluded := 'No supplier price';
        end if;
      else
        unit := v_price ->> 'unit';
        v_cu := app_private.cost_unit(unit);
        unit_version_id := v_cu.id;
        units_per_usd := v_cu.units_per_usd;
        native := app_private.offer_native_cost(v_price -> 'schedule', p_options, p_qty);
        if v_cu.id is null then
          excluded := 'No conversion for unit ' || unit;
        elsif native is null and not o.is_legacy_primary then
          excluded := 'No price for these settings';
        elsif not o.is_legacy_primary and v_price ->> 'confidence' in ('conflicting', 'unverified') then
          excluded := 'Price ' || (v_price ->> 'confidence');
        elsif not o.is_legacy_primary and (v_price ->> 'expiresAt')::timestamptz < now() then
          excluded := 'Price expired';
        elsif not o.is_legacy_primary and (v_price ->> 'checkedAt')::timestamptz < now() - make_interval(days => v_stale_days)
              and coalesce(o.price_override_until, '-infinity'::timestamptz) < now() then
          excluded := 'Price evidence is stale (checked ' || to_char((v_price ->> 'checkedAt')::timestamptz, 'YYYY-MM-DD') || ')';
        end if;
        if native is not null then
          nominal_usd := round(native / units_per_usd, 10);
          effective_usd := app_private.effective_usd(native, units_per_usd, o.a_fee, o.a_bonus);
        end if;
      end if;
    end if;

    -- temporary (health) checks
    if excluded is null then
      if o.a_blocked > now() and not p_staff_test then
        excluded := 'Provider refusing new jobs until ' || to_char(o.a_blocked at time zone 'UTC', 'HH24:MI') || ' UTC';
        health := 'blocked';
      elsif o.a_cap is not null and effective_usd is not null and app_private.account_spent_today_usd(o.a_id) + effective_usd > o.a_cap then
        excluded := 'Daily spending cap reached';
        health := 'cap';
      elsif native is not null and o.a_bsource = 'api' and o.a_bat > now() - make_interval(mins => v_bal_stale)
            and not coalesce(o.a_unlimited, false) and o.a_bunit = unit then
        v_avail := coalesce(o.a_available, o.a_total);
        if v_avail is not null and v_avail - app_private.account_pending_native(o.a_id, o.a_bat) < native then
          excluded := 'Balance too low for this job';
          health := 'balance';
        end if;
      end if;
    end if;
    return next;
  end loop;
end;
$$;

-- Chooses the route for one request. Returns {status: ok | blocked | unavailable, chosen, candidates, explanation}.
-- Cheapest-only by default: a more expensive offer is used while the cheapest is temporarily unavailable only within the
-- configured fallback ceiling. An offer with unknown cost is used only when it is the model's original route and no
-- offer with a known cost exists for these settings.
create or replace function app_private.route_choose(
  p_model_id text, p_options jsonb, p_mode text, p_qty jsonb,
  p_runtime jsonb default null, p_pin uuid default null, p_staff_test boolean default false
) returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_rows jsonb;
  v_chosen jsonb;
  v_floor numeric;
  v_pct numeric := app_private.num(app_private.setting('routing_fallback_max_pct'));
  v_abs numeric := app_private.num(app_private.setting('routing_fallback_max_usd'));
  v_ceiling numeric;
  v_blocked_until timestamptz;
  v_status text;
  v_expl text;
  v_settings text;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'offerId', e.offer_id, 'accountId', e.account_id, 'provider', e.provider, 'providerLabel', e.provider_label, 'adapter', e.adapter,
      'upstreamModelId', e.upstream_model_id, 'legacy', e.legacy, 'native', e.native, 'unit', e.unit, 'unitVersionId', e.unit_version_id,
      'unitsPerUsd', e.units_per_usd, 'feeBps', e.fee_bps, 'bonusBps', e.bonus_bps, 'fundingVersion', e.funding_version,
      'nominalUsd', e.nominal_usd, 'effectiveUsd', e.effective_usd,
      'price', case when e.price is not null then jsonb_build_object('kind', e.price ->> 'kind', 'id', e.price ->> 'id', 'version', (e.price ->> 'version')::int,
        'confidence', e.price ->> 'confidence', 'checkedAt', e.price ->> 'checkedAt', 'sourceUrl', e.price ->> 'sourceUrl') end,
      'credentialVersion', e.credential_version, 'credentialSource', e.credential_source, 'excluded', e.excluded, 'health', e.health)
    order by (e.excluded is not null), (e.effective_usd is null), e.effective_usd, e.legacy desc, e.account_order, e.offer_order, e.offer_id), '[]'::jsonb)
  into v_rows
  from app_private.route_evaluate(p_model_id, p_options, p_mode, p_qty, p_runtime, p_pin, p_staff_test) e;

  -- Cheapest known cost among offers that are eligible or only temporarily unavailable.
  select min((r ->> 'effectiveUsd')::numeric) into v_floor
  from jsonb_array_elements(v_rows) r where (r ->> 'excluded' is null or r ->> 'health' is not null) and r ->> 'effectiveUsd' is not null;

  v_ceiling := case when v_floor is null then null
    else greatest(v_floor, coalesce(v_floor * (1 + v_pct / 100), v_floor), coalesce(v_floor + v_abs, v_floor)) end;

  if v_floor is not null then
    select r into v_chosen from jsonb_array_elements(v_rows) with ordinality t(r, ord)
    where r ->> 'excluded' is null and r ->> 'effectiveUsd' is not null and (r ->> 'effectiveUsd')::numeric <= v_ceiling
    order by ord limit 1;
  else
    select r into v_chosen from jsonb_array_elements(v_rows) with ordinality t(r, ord)
    where r ->> 'excluded' is null and (r ->> 'legacy')::boolean
    order by ord limit 1;
  end if;

  if v_chosen is not null then
    v_status := 'ok';
  elsif exists (select 1 from jsonb_array_elements(v_rows) r where r ->> 'health' is not null) then
    v_status := 'blocked';
  else
    v_status := 'unavailable';
  end if;

  select min(a.submit_blocked_until) into v_blocked_until
  from jsonb_array_elements(v_rows) r join app_private.provider_accounts a on a.id = (r ->> 'accountId')::uuid
  where r ->> 'health' = 'blocked';

  select string_agg(key || '=' || (value #>> '{}'), ', ' order by key) into v_settings from jsonb_each(coalesce(p_options, '{}'::jsonb));
  v_expl := case v_status
    when 'ok' then format('%s for %s%s: %s', case when v_floor is null then 'Original route (cost unknown)' else 'Cheapest eligible offer' end,
      coalesce(v_settings, 'default settings'), case when p_mode is not null then ', input mode ' || p_mode else '' end,
      coalesce((v_chosen ->> 'providerLabel') || coalesce(' at $' || trim_scale((v_chosen ->> 'effectiveUsd')::numeric)::text, ''), ''))
      || case when (v_chosen ->> 'effectiveUsd')::numeric > v_floor then format(' (fallback within the ceiling; cheapest $%s is unavailable)', trim_scale(v_floor)::text) else '' end
    when 'blocked' then 'Every eligible offer is temporarily unavailable'
    else 'No eligible offer for these settings' end;

  return jsonb_build_object('status', v_status, 'chosen', v_chosen, 'candidates', v_rows, 'explanation', v_expl,
    'cheapestUsd', v_floor, 'ceilingUsd', v_ceiling, 'blockedUntil', v_blocked_until, 'decidedAt', now());
end;
$$;

-- Customer-facing gate used by quotes, job creation and staff tests: some configured supplier must be able to take
-- exactly this request. Nothing is charged when it fails.
create or replace function app_private.route_gate(p_model_id text, p_input jsonb, p_spec jsonb, p_staff_test boolean default false)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_pin uuid := nullif(current_setting('genlixs.test_offer', true), '')::uuid;
  r jsonb;
begin
  r := app_private.route_choose(p_model_id, p_input -> 'options', p_input ->> 'mode', app_private.request_quantities(p_spec, p_input),
    null, case when p_staff_test then v_pin end, p_staff_test);
  if r ->> 'status' = 'ok' then
    return;
  end if;
  if p_staff_test and v_pin is not null then
    perform app_private.fail('OFFER_NOT_TESTABLE', 'This offer cannot take this request: '
      || coalesce((select c ->> 'excluded' from jsonb_array_elements(r -> 'candidates') c limit 1), 'not configured') || '.');
  end if;
  if r ->> 'status' = 'blocked' then
    perform app_private.fail('SERVICE_UNAVAILABLE', 'Generation is temporarily unavailable. Nothing was charged; try again in a few minutes.');
  end if;
  perform app_private.fail('MODEL_UNAVAILABLE', 'This model is temporarily unavailable with these settings. Your draft is saved; nothing was charged.');
end;
$$;

