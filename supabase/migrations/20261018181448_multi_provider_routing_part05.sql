create or replace function public.admin_providers_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('provider.read');
  v_today timestamptz := date_trunc('day', now() at time zone 'UTC') at time zone 'UTC';
  v_month timestamptz := date_trunc('month', now() at time zone 'UTC') at time zone 'UTC';
  v_stale_days int := coalesce((app_private.setting('provider_price_stale_days') #>> '{}')::int, 30);
begin
  return jsonb_build_object(
    'generatedAt', now(), 'timezone', 'UTC',
    'canManage', app_private.has_capability(v_actor, 'provider.manage'),
    'accounts', (select coalesce(jsonb_agg(app_private.provider_account_json(a) || jsonb_build_object(
        'offers', (select jsonb_build_object('total', count(*), 'mapped', count(*) filter (where f.model_id is not null),
            'eligible', count(*) filter (where f.status = 'eligible'), 'routing', count(*) filter (where f.routing_enabled and f.status = 'eligible'),
            'winning', count(*) filter (where f.decision = 'eligible' and f.model_id is not null),
            'dominated', count(*) filter (where f.decision = 'dominated'), 'unresolved', count(*) filter (where f.decision = 'unresolved'))
          from app_private.provider_offers f where f.provider_account_id = a.id),
        'spend', (select jsonb_build_object(
            'todayConfirmedUsd', coalesce(sum(l.confirmed_effective_usd) filter (where l.state = 'confirmed' and l.created_at >= v_today), 0),
            'todayEstimatedUsd', coalesce(sum(l.estimated_effective_usd) filter (where l.state = 'pending_confirmation' and l.created_at >= v_today), 0),
            'monthConfirmedUsd', coalesce(sum(l.confirmed_effective_usd) filter (where l.state = 'confirmed' and l.created_at >= v_month), 0),
            'monthEstimatedUsd', coalesce(sum(l.estimated_effective_usd) filter (where l.state = 'pending_confirmation' and l.created_at >= v_month), 0),
            'pendingUsd', coalesce(sum(l.estimated_effective_usd) filter (where l.state in ('reserved', 'submission_unknown')), 0),
            'pendingJobs', count(*) filter (where l.state in ('reserved', 'submission_unknown')),
            'unknownCostJobs', count(*) filter (where l.created_at >= v_month and l.estimated_effective_usd is null and l.confirmed_effective_usd is null))
          from app_private.provider_cost_ledger l where l.provider_account_id = a.id),
        'failures24h', (select count(*) from app_private.provider_attempts t where t.provider_account_id = a.id
            and t.submitted_at > now() - interval '24 hours' and t.state in ('rejected', 'unknown')),
        'staleBalance', a.last_balance_at is null or a.last_balance_at < now() - make_interval(mins => coalesce((app_private.setting('provider_balance_stale_minutes') #>> '{}')::int, 60)))
      order by a.sort_order, a.provider), '[]'::jsonb)
      from app_private.provider_accounts a where a.provider <> 'fake'),
    'totals', (select jsonb_build_object(
        'todayConfirmedUsd', coalesce(sum(confirmed_effective_usd) filter (where state = 'confirmed' and created_at >= v_today), 0),
        'todayEstimatedUsd', coalesce(sum(estimated_effective_usd) filter (where state = 'pending_confirmation' and created_at >= v_today), 0),
        'monthConfirmedUsd', coalesce(sum(confirmed_effective_usd) filter (where state = 'confirmed' and created_at >= v_month), 0),
        'monthEstimatedUsd', coalesce(sum(estimated_effective_usd) filter (where state = 'pending_confirmation' and created_at >= v_month), 0),
        'pendingUsd', coalesce(sum(estimated_effective_usd) filter (where state in ('reserved', 'submission_unknown')), 0),
        'submissionUnknownJobs', count(*) filter (where state = 'submission_unknown'),
        'failedToday', count(*) filter (where state in ('failed', 'not_charged') and created_at >= v_today))
      from app_private.provider_cost_ledger),
    'notices', jsonb_build_object(
      'stalePrices', (select count(*) from app_private.provider_offers f where f.status = 'eligible' and not f.is_legacy_primary
          and (app_private.offer_price(f.id) ->> 'checkedAt')::timestamptz < now() - make_interval(days => v_stale_days)),
      'eligibleWithoutRouting', (select count(*) from app_private.provider_offers f where f.status = 'eligible' and not f.routing_enabled and f.model_id is not null),
      'modelsWithoutRoute', (select count(*) from app_private.model_catalog m where m.state in ('enabled', 'experimental')
          and app_private.routable_spec(m.id, (app_private.capability_for(m.id)).spec) is null)),
    'units', (select coalesce(jsonb_agg(jsonb_build_object('unit', u.unit, 'label', u.label, 'unitsPerUsd', u.units_per_usd, 'basis', u.basis,
        'version', u.version, 'sourceUrl', u.source_url, 'checkedAt', u.checked_at, 'note', u.note) order by u.unit), '[]'::jsonb)
      from (select distinct on (unit) * from app_private.cost_unit_versions order by unit, version desc) u),
    'policy', jsonb_build_object('fallbackMaxPct', app_private.setting('routing_fallback_max_pct'),
      'fallbackMaxUsd', app_private.setting('routing_fallback_max_usd'), 'priceStaleDays', v_stale_days,
      'balanceStaleMinutes', app_private.setting('provider_balance_stale_minutes'))
  );
end;
$$;
revoke execute on function public.admin_providers_overview() from public, anon;
grant execute on function public.admin_providers_overview() to authenticated;

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

-- Models tab: every public model with its offers, the cheapest eligible offer for the model's default settings and the
-- saving against an equivalent verified KIE baseline; plus the review inventory (offers not mapped to a model).
create or replace function public.admin_routing_models()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('provider.read');
begin
  return jsonb_build_object('generatedAt', now(),
    'models', (select coalesce(jsonb_agg(x.j order by x.tool, x.sort_order), '[]'::jsonb) from (
      select m.tool, m.sort_order, (
        with ex as (select app_private.example_request((app_private.capability_for(m.id)).spec) e),
             ch as (select app_private.route_choose(m.id, (select e -> 'options' from ex), (select e ->> 'mode' from ex),
                      (select e -> 'quantities' from ex)) r)
        select jsonb_build_object('id', m.id, 'name', m.public_name, 'tool', m.tool, 'family', m.family, 'state', m.state,
          'publicVisible', m.state <> 'disabled',
          'spec', (select jsonb_build_object('options', c.spec -> 'options', 'modes', c.spec -> 'modes', 'inputs', c.spec -> 'inputs',
              'references', c.spec -> 'references', 'derived', c.spec -> 'derived') from (select (app_private.capability_for(m.id)).spec) c(spec)),
          'example', (select e from ex),
          'route', (select jsonb_build_object('status', r ->> 'status', 'explanation', r ->> 'explanation', 'chosen', r -> 'chosen',
              'kieBaselineUsd', (select (c ->> 'effectiveUsd')::numeric from jsonb_array_elements(r -> 'candidates') c
                where c ->> 'provider' = 'kie' and (c ->> 'legacy')::boolean and c ->> 'effectiveUsd' is not null
                  and c -> 'price' ->> 'confidence' in ('authoritative', 'documented') limit 1),
              'candidates', r -> 'candidates') from ch),
          'offers', (select coalesce(jsonb_agg(app_private.offer_json(f) order by f.is_legacy_primary desc, f.sort_order), '[]'::jsonb)
            from app_private.provider_offers f where f.model_id = m.id))
      ) j
      from app_private.model_catalog m) x),
    'inventory', (select coalesce(jsonb_agg(app_private.offer_json(f) order by a.sort_order, f.product_key), '[]'::jsonb)
      from app_private.provider_offers f join app_private.provider_accounts a on a.id = f.provider_account_id where f.model_id is null));
end;
$$;
revoke execute on function public.admin_routing_models() from public, anon;
grant execute on function public.admin_routing_models() to authenticated;

-- Comparison for exact settings: every offer with its cost breakdown or the reason it is excluded.
create or replace function public.admin_route_preview(p_model_id text, p_options jsonb, p_mode text, p_quantities jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('provider.read');
  m app_private.model_catalog;
  v_spec jsonb;
  v_ex jsonb;
  v_opts jsonb;
  v_qty jsonb;
  r jsonb;
  v_kie numeric;
begin
  select * into m from app_private.model_catalog where id = p_model_id;
  if not found then
    perform app_private.fail('NOT_FOUND', 'Model not found.');
  end if;
  v_spec := (app_private.capability_for(m.id)).spec;
  v_ex := app_private.example_request(v_spec);
  v_opts := (v_ex -> 'options') || coalesce(p_options, '{}'::jsonb);
  v_qty := (v_ex -> 'quantities') || coalesce(p_quantities, '{}'::jsonb);
  r := app_private.route_choose(m.id, v_opts, coalesce(p_mode, v_ex ->> 'mode'), v_qty);
  select (c ->> 'effectiveUsd')::numeric into v_kie from jsonb_array_elements(r -> 'candidates') c
  where c ->> 'provider' = 'kie' and (c ->> 'legacy')::boolean and c ->> 'effectiveUsd' is not null
    and c -> 'price' ->> 'confidence' in ('authoritative', 'documented') limit 1;
  return r || jsonb_build_object('modelId', m.id, 'options', v_opts, 'mode', coalesce(p_mode, v_ex ->> 'mode'), 'quantities', v_qty,
    'kieBaselineUsd', v_kie,
    'savingVsKieUsd', case when v_kie is not null and r ->> 'status' = 'ok' and r -> 'chosen' ->> 'effectiveUsd' is not null
      then v_kie - (r -> 'chosen' ->> 'effectiveUsd')::numeric end);
end;
$$;
revoke execute on function public.admin_route_preview(text, jsonb, text, jsonb) from public, anon;
grant execute on function public.admin_route_preview(text, jsonb, text, jsonb) to authenticated;

create or replace function public.admin_offer_detail(p_offer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('provider.read');
  f app_private.provider_offers;
begin
  select * into f from app_private.provider_offers where id = p_offer_id;
  if not found then
    perform app_private.fail('NOT_FOUND', 'Offer not found.');
  end if;
  return app_private.offer_json(f) || jsonb_build_object(
    'prices', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'version', p.version, 'unit', p.unit, 'schedule', p.schedule,
        'confidence', p.confidence, 'sourceKind', p.source_kind, 'sourceUrl', p.source_url, 'checkedAt', p.checked_at,
        'effectiveAt', p.effective_at, 'expiresAt', p.expires_at, 'accountTier', p.account_tier, 'promotion', p.promotion,
        'assumptions', p.assumptions, 'createdAt', p.created_at) order by p.version desc), '[]'::jsonb)
      from app_private.provider_offer_prices p where p.offer_id = f.id),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('at', l.created_at, 'action', l.action, 'reason', l.reason, 'after', l.after_state)
        order by l.created_at desc), '[]'::jsonb)
      from (select * from app_private.admin_audit_logs where target_kind = 'provider_offer' and target_id = f.id::text order by created_at desc limit 20) l),
    'recentJobs', (select coalesce(jsonb_agg(jsonb_build_object('jobId', j.id, 'ref', j.short_ref, 'state', j.state, 'purpose', j.purpose,
        'at', t.submitted_at, 'estimatedUsd', l.estimated_effective_usd, 'confirmedUsd', l.confirmed_effective_usd, 'ledgerState', l.state)
        order by t.submitted_at desc), '[]'::jsonb)
      from (select * from app_private.provider_attempts where offer_id = f.id order by submitted_at desc limit 10) t
      join public.generation_jobs j on j.id = t.job_id
      left join app_private.provider_cost_ledger l on l.attempt_id = t.id));
end;
$$;
revoke execute on function public.admin_offer_detail(uuid) from public, anon;
grant execute on function public.admin_offer_detail(uuid) to authenticated;

-- ------------------------------------------------------------------ offer edits

-- Validates an explicit capability object (see provider_offers.capabilities).
create or replace function app_private.validate_capabilities(p_caps jsonb)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  k text;
  v jsonb;
begin
  if p_caps is null or jsonb_typeof(p_caps) <> 'object' then
    perform app_private.fail('INVALID_INPUT', 'Capabilities must be an object.');
  end if;
  for k in select jsonb_object_keys(p_caps) loop
    if k not in ('inherit', 'options', 'modes', 'inputs', 'maxPromptChars', 'notes', 'request') then
      perform app_private.fail('INVALID_INPUT', 'Unknown capability field: ' || left(k, 40));
    end if;
  end loop;
  if p_caps ? 'inherit' and jsonb_typeof(p_caps -> 'inherit') <> 'boolean' then
    perform app_private.fail('INVALID_INPUT', 'inherit must be true or false.');
  end if;
  for k, v in select key, value from jsonb_each(coalesce(p_caps -> 'options', '{}'::jsonb)) loop
    if not (jsonb_typeof(v) = 'array' and jsonb_array_length(v) between 1 and 200)
       and not (jsonb_typeof(v) = 'object' and (v ? 'min' or v ? 'max')) then
      perform app_private.fail('INVALID_INPUT', format('Option %s needs a list of values or a min/max range.', left(k, 40)));
    end if;
  end loop;
  if p_caps ? 'modes' and jsonb_typeof(p_caps -> 'modes') <> 'array' then
    perform app_private.fail('INVALID_INPUT', 'Modes must be a list.');
  end if;
  for k, v in select key, value from jsonb_each(coalesce(p_caps -> 'inputs', '{}'::jsonb)) loop
    if jsonb_typeof(v) <> 'object' or app_private.num(v -> 'max') is null or app_private.num(v -> 'max') < 0 then
      perform app_private.fail('INVALID_INPUT', format('Input %s needs a maximum count.', left(k, 40)));
    end if;
  end loop;
end;
$$;

-- Offer controls (owner). p_patch keys: routingEnabled, status, capabilities, sortOrder, verificationNote, priceOverrideDays.
-- Switching routing on requires an integrated, verified ("eligible") offer of a public model with a usable price and an
-- account with a key; it never resurrects a provider that is switched off.
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
revoke execute on function public.admin_update_offer(uuid, jsonb, text) from public, anon;
grant execute on function public.admin_update_offer(uuid, jsonb, text) to authenticated;

