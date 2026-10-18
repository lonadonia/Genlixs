-- Catalog supply view for Admin › Models, Pricing and Supplier balances (read-only, provider.read).
--
-- For every Genlixs model: the supplier that serves its default request now (the router's own choice) and what every
-- supplier offer of that model would cost for exactly the same request. The quotes ignore routing switches, keys and
-- verification, which only decide whether an offer may be used; each quote says which of those steps is still missing.
-- For products that are not in the catalog yet: each product once, with every supplier's quote, so the cheapest supplier
-- of a product is visible without listing the product several times. Nothing is routed, saved or sent.

create or replace function public.admin_catalog_supply()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('provider.read');
begin
  return jsonb_build_object(
    'generatedAt', now(),
    'suppliers', (select coalesce(jsonb_agg(jsonb_build_object('provider', a.provider, 'name', coalesce(a.display_name, a.provider),
        'on', a.enabled and not a.paused, 'hasKey', a.credential_version > 0 or a.secret_ref = 'KIE_API_KEY') order by a.sort_order), '[]'::jsonb)
      from app_private.provider_accounts a where a.provider <> 'fake'),
    'models', (select coalesce(jsonb_agg(x.j order by x.sort_order), '[]'::jsonb) from (
      select m.sort_order, jsonb_build_object(
        'id', m.id,
        'example', ex.e,
        -- Genlixs credits charged for the default request by the published price (null when not priced).
        'defaultUnits', (select app_private.price_units_for(pv.rules, ex.e -> 'options', coalesce((ex.e -> 'quantities' -> 'counts' ->> '_references')::int, 0))
            from app_private.price_versions pv
            where pv.model_id = m.id and pv.state = 'published' and pv.capability_version_id = (app_private.capability_for(m.id)).id),
        'route', jsonb_build_object('status', ch.r ->> 'status', 'explanation', ch.r ->> 'explanation',
            'offerId', ch.r -> 'chosen' ->> 'offerId', 'provider', ch.r -> 'chosen' ->> 'provider', 'providerName', ch.r -> 'chosen' ->> 'providerLabel',
            'legacy', (ch.r -> 'chosen' ->> 'legacy')::boolean, 'native', (ch.r -> 'chosen' ->> 'native')::numeric, 'unit', ch.r -> 'chosen' ->> 'unit',
            'usd', (ch.r -> 'chosen' ->> 'effectiveUsd')::numeric),
        'quotes', (select coalesce(jsonb_agg(q.j order by (q.j ->> 'usd')::numeric nulls last, q.sort), '[]'::jsonb) from (
            select f.sort_order as sort, jsonb_build_object(
              'offerId', f.id, 'provider', a.provider, 'providerName', coalesce(a.display_name, a.provider), 'legacy', f.is_legacy_primary,
              'status', f.status, 'decision', f.decision, 'decisionReason', f.decision_reason, 'blocker', f.blocker,
              'routingEnabled', f.routing_enabled, 'supplierOn', a.enabled and not a.paused,
              'hasKey', a.credential_version > 0 or a.secret_ref = 'KIE_API_KEY', 'integrated', f.adapter is not null,
              'confidence', pp.p ->> 'confidence', 'unit', pp.p ->> 'unit', 'unitBasis', cu.basis,
              'incompatible', inc.v, 'native', nat.v,
              'usd', app_private.effective_usd(nat.v, cu.units_per_usd, a.funding_fee_bps, a.funding_bonus_bps),
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
      cross join lateral (select app_private.example_request((app_private.capability_for(m.id)).spec) as e) ex
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
revoke execute on function public.admin_catalog_supply() from public, anon;
grant execute on function public.admin_catalog_supply() to authenticated;
