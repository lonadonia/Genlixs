-- Rollback of 20261018235333_route_fallback_original: restores route_choose exactly as defined in
-- 20261018181128_multi_provider_routing_part02 (a cheaper offer that is temporarily unavailable again limits fallback to the
-- configured ceiling, none by default). Not applied.

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

