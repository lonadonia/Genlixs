-- Rollback of 20261019010705_documented_activation: back to one evidence status ("Verified", set with a note) and no
-- documented activation. Not applied. Offers activated without a live test are switched off first (they would
-- otherwise keep serving without the checks and without the safety stop); live-tested offers stay as they are.
-- The evidence columns are dropped (the audit log keeps every activation, live test and safety stop).

update app_private.provider_offers set status = 'capabilities_unverified', routing_enabled = false
where verification_basis = 'documented';

drop trigger if exists generation_jobs_documented_offer_failed on public.generation_jobs;
drop trigger if exists provider_attempts_documented_offer_rejected on app_private.provider_attempts;
drop function if exists app_private.documented_offer_job_failed();
drop function if exists app_private.documented_offer_attempt_rejected();
drop function if exists app_private.pause_documented_offer(uuid, text, jsonb);
drop function if exists public.admin_activate_offer_documented(uuid, text, boolean);
drop function if exists public.admin_offer_activation_readiness(uuid);
drop function if exists app_private.offer_activation_readiness(uuid);

-- As defined in 20261018181448_multi_provider_routing_part05.
create or replace function public.admin_update_offer(p_offer_id uuid, p_patch jsonb, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('provider.manage');
  f app_private.provider_offers;
  v_after app_private.provider_offers;
  a app_private.provider_accounts;
  k text;
  v_price jsonb;
  v_status text;
begin
  select * into f from app_private.provider_offers where id = p_offer_id for update;
  if not found then
    perform app_private.fail('NOT_FOUND', 'Offer not found.');
  end if;
  select * into a from app_private.provider_accounts where id = f.provider_account_id;
  for k in select jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) loop
    if k not in ('routingEnabled', 'status', 'capabilities', 'sortOrder', 'verificationNote', 'priceOverrideDays') then
      perform app_private.fail('INVALID_INPUT', 'Unknown setting: ' || left(k, 40));
    end if;
  end loop;
  if p_patch ? 'capabilities' then
    if f.is_legacy_primary then
      perform app_private.fail('INVALID_INPUT', 'The original route follows the public model''s capability; change the model instead.');
    end if;
    perform app_private.validate_capabilities(p_patch -> 'capabilities');
    update app_private.provider_offers set capabilities = p_patch -> 'capabilities' where id = f.id;
  end if;
  if p_patch ? 'verificationNote' then
    update app_private.provider_offers set verification_note = left(nullif(trim(p_patch ->> 'verificationNote'), ''), 1000) where id = f.id;
  end if;
  if p_patch ? 'status' then
    v_status := p_patch ->> 'status';
    if v_status not in ('discovered', 'pricing_unverified', 'capabilities_unverified', 'configured', 'eligible', 'disabled', 'stale', 'unavailable') then
      perform app_private.fail('INVALID_INPUT', 'Unknown status.');
    end if;
    if v_status = 'eligible' then
      v_price := app_private.offer_price(f.id);
      if f.model_id is null then
        perform app_private.fail('OFFER_NOT_READY', 'Map this offer to a public model first.');
      elsif f.adapter is null then
        perform app_private.fail('OFFER_NOT_READY', 'This release has no integration for this offer.');
      elsif v_price is null or v_price ->> 'confidence' not in ('authoritative', 'documented', 'estimate') then
        perform app_private.fail('OFFER_NOT_READY', 'Save a verified price first (documented, account quote or provider estimate).');
      elsif coalesce(nullif(trim(coalesce(p_patch ->> 'verificationNote', f.verification_note)), ''), '') = '' then
        perform app_private.fail('OFFER_NOT_READY', 'Record how the capability and output were verified (for example the test job reference).');
      end if;
      update app_private.provider_offers set verified_at = now(), verified_by = v_actor where id = f.id;
    end if;
    update app_private.provider_offers set status = v_status,
      routing_enabled = case when v_status = 'eligible' then routing_enabled else false end
    where id = f.id;
  end if;
  if p_patch ? 'priceOverrideDays' then
    if jsonb_typeof(p_patch -> 'priceOverrideDays') = 'null' then
      update app_private.provider_offers set price_override_until = null where id = f.id;
    elsif coalesce((p_patch ->> 'priceOverrideDays') ~ '^\d{1,2}$', false) and (p_patch ->> 'priceOverrideDays')::int between 1 and 30 then
      if coalesce(nullif(trim(p_reason), ''), '') = '' then
        perform app_private.fail('REASON_REQUIRED', 'Say why the stale price may still be used.');
      end if;
      update app_private.provider_offers set price_override_until = now() + make_interval(days => (p_patch ->> 'priceOverrideDays')::int) where id = f.id;
    else
      perform app_private.fail('INVALID_INPUT', 'Override between 1 and 30 days.');
    end if;
  end if;
  if p_patch ? 'sortOrder' then
    if coalesce((p_patch ->> 'sortOrder') ~ '^\d{1,4}$', false) is not true then
      perform app_private.fail('INVALID_INPUT', 'Order must be a whole number.');
    end if;
    update app_private.provider_offers set sort_order = (p_patch ->> 'sortOrder')::int where id = f.id;
  end if;
  if p_patch ? 'routingEnabled' then
    if jsonb_typeof(p_patch -> 'routingEnabled') <> 'boolean' then
      perform app_private.fail('INVALID_INPUT', 'Routing must be true or false.');
    end if;
    if (p_patch ->> 'routingEnabled')::boolean then
      select * into v_after from app_private.provider_offers where id = f.id;
      if v_after.status <> 'eligible' then
        perform app_private.fail('OFFER_NOT_READY', 'Verify the offer (status eligible) before routing to it.');
      end if;
      if not a.enabled or (a.credential_version = 0 and a.secret_ref <> 'KIE_API_KEY') then
        perform app_private.fail('OFFER_NOT_READY', 'Switch the provider on with a saved key first.');
      end if;
    end if;
    update app_private.provider_offers set routing_enabled = (p_patch ->> 'routingEnabled')::boolean where id = f.id;
  end if;
  select * into v_after from app_private.provider_offers where id = f.id;
  perform app_private.audit(v_actor, 'provider.manage', 'provider_offer.updated', 'provider_offer', f.id::text,
    coalesce(nullif(trim(p_reason), ''), 'Changed ' || (select string_agg(x, ', ') from jsonb_object_keys(p_patch) x)),
    jsonb_build_object('status', f.status, 'routingEnabled', f.routing_enabled, 'capabilities', f.capabilities, 'priceOverrideUntil', f.price_override_until),
    jsonb_build_object('status', v_after.status, 'routingEnabled', v_after.routing_enabled, 'capabilities', v_after.capabilities,
      'priceOverrideUntil', v_after.price_override_until));
  return app_private.offer_json(v_after);
end;
$$;

-- As defined in 20261018181448_multi_provider_routing_part05.
create or replace function app_private.offer_json(f app_private.provider_offers)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', f.id, 'accountId', f.provider_account_id, 'provider', a.provider, 'providerName', coalesce(a.display_name, a.provider),
    'modelId', f.model_id, 'productKey', f.product_key, 'productLabel', f.product_label, 'tool', f.tool, 'operation', f.operation,
    'upstreamModelId', f.upstream_model_id, 'adapter', f.adapter, 'capabilities', f.capabilities, 'status', f.status, 'decision', f.decision,
    'decisionReason', f.decision_reason, 'decidedAt', f.decided_at, 'blocker', f.blocker, 'routingEnabled', f.routing_enabled,
    'legacy', f.is_legacy_primary, 'sourceUrl', f.source_url, 'docsUrl', f.docs_url, 'verificationNote', f.verification_note,
    'verifiedAt', f.verified_at, 'priceOverrideUntil', f.price_override_until, 'sortOrder', f.sort_order,
    'price', app_private.offer_price(f.id),
    'accountReady', a.enabled and not a.paused and (a.credential_version > 0 or a.secret_ref = 'KIE_API_KEY'))
  from app_private.provider_accounts a where a.id = f.provider_account_id;
$$;

-- As defined in 20261018232513_automatic_pricing.
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

-- NezhaGate Flare offers: 2K back as before (the supplier's 2K disruption notice of 18 Oct 2026 still applies).
update app_private.provider_offers f
set capabilities = jsonb_set(f.capabilities, '{options,resolution}', '["1K", "2K", "4K"]')
  || jsonb_build_object('notes', (select coalesce(jsonb_agg(n), '[]'::jsonb) from jsonb_array_elements(f.capabilities -> 'notes') n
       where n #>> '{}' <> '2K left out: the supplier announced a 2K service disruption on 18 Oct 2026'))
from app_private.provider_accounts a
where a.id = f.provider_account_id and a.provider = 'nezhagate' and f.model_id in ('gpt-flare-image', 'gpt-flare-edit')
  and f.capabilities -> 'options' -> 'resolution' = '["1K", "4K"]'::jsonb;

alter table app_private.provider_adapters drop column if exists result_hosts;
alter table app_private.provider_offers
  drop column if exists verification_basis,
  drop column if exists live_test_job_id,
  drop column if exists documentation_gap,
  drop column if exists activation_snapshot,
  drop column if exists auto_paused_at,
  drop column if exists auto_paused_reason;
