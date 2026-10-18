-- Review inventory (offers without a Genlixs model): each product is compared only with the same product key at
-- other providers, over the configurations their price tables list (with 5 s / 10 s clips and 3 s / 10 s input
-- media for per-second prices). Different billing dimensions are not compared. None of these offers can be routed.
create or replace function app_private.inventory_proposals()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_key text;
  v_offers jsonb;
  v_usable jsonb;
  v_dims text;
  v_same boolean;
  v_rate_keys text[];
  rk text;
  v_secs_opts numeric[];
  v_in_opts numeric[];
  v_sec_opt text;
  v_io_slot text;
  s numeric;
  si numeric;
  cfg jsonb;
  qty jsonb;
  o jsonb;
  v_costs jsonb;
  v_best numeric;
  v_cost numeric;
  st jsonb;
  v_stats jsonb;
  v_out jsonb := '[]'::jsonb;
  v_dec text;
  v_reason text;
  v_n int;
  i int;
  v_dim_names text[];
  v_vals text[];
begin
  for v_key in select distinct product_key from app_private.provider_offers where model_id is null order by 1 loop
    select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'provider', a.provider, 'providerName', coalesce(a.display_name, a.provider),
        'label', f.product_label, 'status', f.status, 'blocker', f.blocker, 'decision', f.decision, 'price', app_private.offer_price(f.id),
        'upu', (app_private.cost_unit(app_private.offer_price(f.id) ->> 'unit')).units_per_usd, 'fee', a.funding_fee_bps, 'bonus', a.funding_bonus_bps)
        order by a.sort_order), '[]'::jsonb)
    into v_offers
    from app_private.provider_offers f join app_private.provider_accounts a on a.id = f.provider_account_id
    where f.model_id is null and f.product_key = v_key;
    select coalesce(jsonb_agg(x), '[]'::jsonb) into v_usable from jsonb_array_elements(v_offers) x
    where x -> 'price' is not null and jsonb_typeof(x -> 'price') = 'object' and x -> 'price' ->> 'confidence' in ('authoritative', 'documented', 'estimate')
      and x ->> 'upu' is not null;
    select count(distinct (x -> 'price' -> 'schedule' -> 'dims')::text) = 1, min((x -> 'price' -> 'schedule' -> 'dims')::text)
    into v_same, v_dims from jsonb_array_elements(v_usable) x;
    v_stats := '{}'::jsonb;
    v_n := 0;
    if coalesce(v_same, false) then
      select array_agg(distinct k order by k) into v_rate_keys
      from jsonb_array_elements(v_usable) x, jsonb_object_keys(x -> 'price' -> 'schedule' -> 'rates') k;
      select array_agg(d order by ord) into v_dim_names from jsonb_array_elements_text(v_dims::jsonb) with ordinality t(d, ord);
      select min(x -> 'price' -> 'schedule' -> 'seconds' ->> 'option') into v_sec_opt from jsonb_array_elements(v_usable) x;
      select min(sl) into v_io_slot from jsonb_array_elements(v_usable) x, jsonb_array_elements_text(coalesce(x -> 'price' -> 'schedule' -> 'inputSeconds' -> 'slots', '[]'::jsonb)) sl;
      v_secs_opts := case when v_sec_opt is not null then array[5, 10]::numeric[] else array[null]::numeric[] end;
      v_in_opts := case when v_io_slot is not null then array[3, 10]::numeric[] else array[null]::numeric[] end;
      foreach rk in array coalesce(v_rate_keys, array[]::text[]) loop
        v_vals := string_to_array(rk, '|');
        cfg := '{}'::jsonb;
        for i in 1 .. coalesce(array_length(v_dim_names, 1), 0) loop
          cfg := cfg || jsonb_build_object(v_dim_names[i], v_vals[i]);
        end loop;
        foreach s in array v_secs_opts loop
          foreach si in array v_in_opts loop
            v_n := v_n + 1;
            qty := jsonb_build_object('outputs', 1, 'counts', '{}'::jsonb,
              'seconds', case when v_io_slot is not null then jsonb_build_object(v_io_slot, si) else '{}'::jsonb end);
            v_costs := '{}'::jsonb;
            v_best := null;
            for o in select value from jsonb_array_elements(v_usable) loop
              v_cost := app_private.effective_usd(app_private.offer_native_cost(o -> 'price' -> 'schedule',
                  cfg || case when v_sec_opt is not null and not cfg ? v_sec_opt then jsonb_build_object(v_sec_opt, s) else '{}'::jsonb end, qty),
                app_private.num(o -> 'upu'), app_private.num(o -> 'fee'), app_private.num(o -> 'bonus'));
              if v_cost is not null then
                v_costs := v_costs || jsonb_build_object(o ->> 'id', v_cost);
                if v_best is null or v_cost < v_best then
                  v_best := v_cost;
                end if;
              end if;
            end loop;
            for o in select value from jsonb_array_elements(v_usable) loop
              st := coalesce(v_stats -> (o ->> 'id'), '{"priced":0,"wins":0}'::jsonb);
              if v_costs ? (o ->> 'id') then
                v_cost := (v_costs ->> (o ->> 'id'))::numeric;
                st := jsonb_set(st, '{priced}', to_jsonb((st ->> 'priced')::int + 1));
                if v_cost <= v_best then
                  st := jsonb_set(st, '{wins}', to_jsonb((st ->> 'wins')::int + 1));
                  if not st ? 'win' then
                    st := st || jsonb_build_object('win', jsonb_build_object('options', cfg, 'seconds', s, 'inputSeconds', si, 'usd', v_cost));
                  end if;
                elsif not st ? 'loss' then
                  st := st || jsonb_build_object('loss', jsonb_build_object('options', cfg, 'seconds', s, 'inputSeconds', si, 'usd', v_cost, 'bestUsd', v_best));
                end if;
              end if;
              v_stats := v_stats || jsonb_build_object(o ->> 'id', st);
            end loop;
          end loop;
        end loop;
      end loop;
    end if;
    for o in select value from jsonb_array_elements(v_offers) loop
      st := v_stats -> (o ->> 'id');
      if o ->> 'status' = 'unavailable' then
        v_dec := 'unavailable'; v_reason := 'Marked unavailable';
      elsif o -> 'price' is null or jsonb_typeof(o -> 'price') <> 'object' then
        v_dec := 'unresolved'; v_reason := coalesce(o ->> 'blocker', 'No supplier price');
      elsif o -> 'price' ->> 'confidence' not in ('authoritative', 'documented', 'estimate') then
        v_dec := 'unresolved'; v_reason := 'Price ' || (o -> 'price' ->> 'confidence') || ': ' || coalesce(o ->> 'blocker', 'needs verification');
      elsif not coalesce(v_same, false) then
        v_dec := 'unresolved'; v_reason := 'Billed on different terms than the other quotes for this product; compare an exact request in Admin';
      elsif st is null or (st ->> 'priced')::int = 0 then
        v_dec := 'unresolved'; v_reason := 'No comparable price';
      elsif (st ->> 'wins')::int > 0 then
        v_dec := 'eligible'; v_reason := format('Lowest quote in %s of %s compared configurations. %s', st ->> 'wins', st ->> 'priced',
          coalesce(o ->> 'blocker', 'Needs a Genlixs model and an integration before it can be routed.'));
      else
        v_dec := 'dominated'; v_reason := format('A cheaper quote exists in all %s compared configurations', st ->> 'priced');
      end if;
      v_out := v_out || jsonb_build_object('offerId', o ->> 'id', 'modelId', null, 'productKey', v_key, 'provider', o ->> 'provider',
        'providerName', o ->> 'providerName', 'productLabel', o ->> 'label', 'status', o ->> 'status', 'routingEnabled', false,
        'currentDecision', o ->> 'decision', 'proposedDecision', v_dec, 'reason', v_reason, 'configs', v_n,
        'priced', coalesce((st ->> 'priced')::int, 0), 'wins', coalesce((st ->> 'wins')::int, 0),
        'exampleWin', st -> 'win', 'exampleLoss', st -> 'loss', 'mapped', false, 'canActivate', false);
    end loop;
  end loop;
  return v_out;
end;
$$;

-- Preview (p_apply = false) or apply the routing review (owner). Applying records every decision, switches routing
-- off for offers that are now dominated (history and in-flight jobs are kept) and switches on only the offers listed in
-- p_activate that are eligible and win at least one configuration. The preview revision must match.
create or replace function public.admin_routing_review(p_apply boolean, p_revision text default null, p_activate uuid[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability(case when p_apply then 'provider.manage' else 'provider.read' end);
  v_props jsonb := app_private.routing_review_proposals() || app_private.inventory_proposals();
  v_rev text := md5(v_props::text);
  x jsonb;
  v_changed int := 0;
  v_off int := 0;
  v_on int := 0;
  v_providers jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('provider', a.provider, 'name', coalesce(a.display_name, a.provider), 'enabled', a.enabled,
      'winningOffers', (select count(*) from jsonb_array_elements(v_props) p where p ->> 'provider' = a.provider and p ->> 'proposedDecision' = 'eligible'
        and (p ->> 'mapped')::boolean),
      'activeAfterApply', exists (select 1 from jsonb_array_elements(v_props) p where p ->> 'provider' = a.provider and p ->> 'proposedDecision' = 'eligible'
        and (p ->> 'mapped')::boolean
        and ((p ->> 'routingEnabled')::boolean or (p ->> 'offerId')::uuid = any (coalesce(p_activate, '{}'))) and p ->> 'status' = 'eligible'))
    order by a.sort_order), '[]'::jsonb)
  into v_providers
  from app_private.provider_accounts a where a.provider <> 'fake';
  if not p_apply then
    return jsonb_build_object('revision', v_rev, 'proposals', v_props, 'providers', v_providers);
  end if;
  if p_revision is distinct from v_rev then
    perform app_private.fail('REVIEW_CHANGED', 'Offers or prices changed since the preview. Preview again before applying.');
  end if;
  for x in select value from jsonb_array_elements(v_props) loop
    if x ->> 'proposedDecision' is distinct from x ->> 'currentDecision' then
      v_changed := v_changed + 1;
    end if;
    update app_private.provider_offers set decision = x ->> 'proposedDecision', decision_reason = x ->> 'reason', decided_at = now(),
      routing_enabled = case
        when x ->> 'proposedDecision' in ('dominated', 'incompatible', 'unavailable') then false
        when (x ->> 'offerId')::uuid = any (coalesce(p_activate, '{}')) and (x ->> 'canActivate')::boolean then true
        else routing_enabled end
    where id = (x ->> 'offerId')::uuid;
    if x ->> 'proposedDecision' in ('dominated', 'incompatible', 'unavailable') and (x ->> 'routingEnabled')::boolean then
      v_off := v_off + 1;
    end if;
    if (x ->> 'offerId')::uuid = any (coalesce(p_activate, '{}')) and (x ->> 'canActivate')::boolean then
      v_on := v_on + 1;
    end if;
  end loop;
  perform app_private.audit(v_actor, 'provider.manage', 'routing.review_applied', 'routing', v_rev,
    format('Routing review applied: %s decisions changed, %s offers switched off, %s switched on', v_changed, v_off, v_on), null,
    jsonb_build_object('activated', p_activate, 'proposals', (select jsonb_agg(jsonb_build_object('offerId', p ->> 'offerId', 'decision', p ->> 'proposedDecision'))
      from jsonb_array_elements(v_props) p)));
  return jsonb_build_object('applied', true, 'revision', v_rev, 'changed', v_changed, 'switchedOff', v_off, 'switchedOn', v_on, 'providers', v_providers);
end;
$$;
revoke execute on function public.admin_routing_review(boolean, text, uuid[]) from public, anon;
grant execute on function public.admin_routing_review(boolean, text, uuid[]) to authenticated;

-- ------------------------------------------------------------- offer tests

-- Private paid test of one specific offer through the normal pipeline (catalog.test + provider.manage). It runs the
-- regular staff test in the same transaction and pins the job to the offer before any worker can see it.
create or replace function public.admin_create_offer_test(p_offer_id uuid, p_prompt text, p_options jsonb, p_inputs jsonb,
  p_reference_asset_ids uuid[], p_idempotency_key text, p_confirm_spend boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('provider.manage');
  f app_private.provider_offers;
  r jsonb;
  v_job uuid;
begin
  perform app_private.require_capability('catalog.test');
  select * into f from app_private.provider_offers where id = p_offer_id;
  if not found or f.model_id is null then
    perform app_private.fail('NOT_FOUND', 'Map this offer to a public model before testing it.');
  end if;
  if f.adapter is null then
    perform app_private.fail('ADAPTER_NOT_IMPLEMENTED', 'This release has no integration for this offer, so it cannot be tested.');
  end if;
  perform set_config('genlixs.test_offer', f.id::text, true);
  -- Specifications with typed input slots use the v2 test; image edits with reference images use the original one.
  if (app_private.capability_for(f.model_id)).spec ? 'inputs' then
    r := public.admin_create_model_test_v2(f.model_id, p_prompt, coalesce(p_options, '{}'::jsonb), coalesce(p_inputs, '{}'::jsonb),
      p_idempotency_key, p_confirm_spend);
  else
    r := public.admin_create_model_test(f.model_id, p_prompt, coalesce(p_options, '{}'::jsonb), coalesce(p_reference_asset_ids, '{}'),
      p_idempotency_key, p_confirm_spend);
  end if;
  perform set_config('genlixs.test_offer', '', true);
  v_job := (r -> 'job' ->> 'id')::uuid;
  if not coalesce((r ->> 'replayed')::boolean, false) then
    insert into app_private.job_route_pins (job_id, offer_id, created_by) values (v_job, f.id, v_actor);
    perform app_private.audit(v_actor, 'provider.manage', 'provider_offer.test_started', 'provider_offer', f.id::text,
      'Started a paid private test of this offer', null, jsonb_build_object('jobId', v_job));
  end if;
  return r || jsonb_build_object('offerId', f.id);
end;
$$;
revoke execute on function public.admin_create_offer_test(uuid, text, jsonb, jsonb, uuid[], text, boolean) from public, anon;
grant execute on function public.admin_create_offer_test(uuid, text, jsonb, jsonb, uuid[], text, boolean) to authenticated;

-- ------------------------------------------------------------------- usage

-- Genlixs supplier spending with filters (provider.read). Totals keep confirmed, estimated, pending, failed and
-- historical-unknown amounts apart; account-reported usage is shown next to them, never assigned to customers.
-- p_filters: {from, to, provider, modelId, userId, state, purpose}
create or replace function public.admin_provider_usage(p_filters jsonb, p_before timestamptz default null, p_limit int default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('provider.read');
  v_from timestamptz := coalesce((p_filters ->> 'from')::timestamptz, date_trunc('month', now() at time zone 'UTC') at time zone 'UTC');
  v_to timestamptz := coalesce((p_filters ->> 'to')::timestamptz, now() + interval '1 minute');
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 2000);
begin
  if v_to <= v_from or v_to - v_from > interval '366 days' then
    perform app_private.fail('INVALID_INPUT', 'Choose a period of at most one year.');
  end if;
  return (
    with base as (
      select l.*, a.provider, coalesce(a.display_name, a.provider) as provider_name, j.short_ref, j.state as job_state, j.model_name,
        t.ordinal, t.state as attempt_state, t.provider_task_id is not null as has_task
      from app_private.provider_cost_ledger l
      join app_private.provider_accounts a on a.id = l.provider_account_id
      join public.generation_jobs j on j.id = l.job_id
      join app_private.provider_attempts t on t.id = l.attempt_id
      where l.created_at >= v_from and l.created_at < v_to
        and (p_filters ->> 'provider' is null or a.provider = p_filters ->> 'provider')
        and (p_filters ->> 'modelId' is null or l.model_id = p_filters ->> 'modelId')
        and (p_filters ->> 'userId' is null or l.user_id::text = p_filters ->> 'userId')
        and (p_filters ->> 'state' is null or l.state = p_filters ->> 'state')
        and (p_filters ->> 'purpose' is null or l.purpose = p_filters ->> 'purpose')
    )
    select jsonb_build_object(
      'from', v_from, 'to', v_to, 'timezone', 'UTC',
      'totals', (select jsonb_build_object(
          'entries', count(*),
          'confirmedUsd', coalesce(sum(confirmed_effective_usd) filter (where state = 'confirmed'), 0),
          'estimatedAwaitingUsd', coalesce(sum(estimated_effective_usd) filter (where state = 'pending_confirmation'), 0),
          'pendingUsd', coalesce(sum(estimated_effective_usd) filter (where state in ('reserved', 'submission_unknown')), 0),
          'estimateOfConfirmedUsd', coalesce(sum(estimated_effective_usd) filter (where state = 'confirmed'), 0),
          'notChargedOrFailed', count(*) filter (where state in ('not_charged', 'failed')),
          'unknownCost', count(*) filter (where estimated_effective_usd is null and confirmed_effective_usd is null and state not in ('not_charged', 'failed')),
          'historicalUnknown', count(*) filter (where state = 'unknown_historical'),
          'byProvider', (select coalesce(jsonb_agg(jsonb_build_object('provider', provider, 'name', provider_name, 'entries', n,
              'confirmedUsd', c, 'estimatedAwaitingUsd', e, 'pendingUsd', p) order by provider), '[]'::jsonb)
            from (select provider, provider_name, count(*) n,
                    coalesce(sum(confirmed_effective_usd) filter (where state = 'confirmed'), 0) c,
                    coalesce(sum(estimated_effective_usd) filter (where state = 'pending_confirmation'), 0) e,
                    coalesce(sum(estimated_effective_usd) filter (where state in ('reserved', 'submission_unknown')), 0) p
                  from base group by provider, provider_name) g),
          'byModel', (select coalesce(jsonb_agg(jsonb_build_object('modelId', model_id, 'entries', n, 'confirmedUsd', c, 'estimatedAwaitingUsd', e)
              order by c + e desc), '[]'::jsonb)
            from (select model_id, count(*) n, coalesce(sum(confirmed_effective_usd) filter (where state = 'confirmed'), 0) c,
                    coalesce(sum(estimated_effective_usd) filter (where state = 'pending_confirmation'), 0) e
                  from base group by model_id) g))
        from base),
      'adjustments', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'provider', a.provider, 'kind', d.kind, 'nativeAmount', d.native_amount,
          'unit', d.native_unit, 'usd', d.usd_amount, 'at', d.occurred_at, 'note', d.note) order by d.occurred_at desc), '[]'::jsonb)
        from app_private.provider_cost_adjustments d join app_private.provider_accounts a on a.id = d.provider_account_id
        where d.occurred_at >= v_from and d.occurred_at < v_to and (p_filters ->> 'provider' is null or a.provider = p_filters ->> 'provider')),
      'accountReported', (select coalesce(jsonb_agg(jsonb_build_object('provider', a.provider, 'scope', r.scope, 'from', r.period_start, 'to', r.period_end,
          'timezone', r.timezone, 'amountUsd', r.amount_usd, 'nativeAmount', r.native_amount, 'unit', r.native_unit, 'requests', r.requests,
          'fetchedAt', r.fetched_at) order by a.sort_order), '[]'::jsonb)
        from (select distinct on (provider_account_id) * from app_private.provider_usage_reports order by provider_account_id, fetched_at desc) r
        join app_private.provider_accounts a on a.id = r.provider_account_id
        where p_filters ->> 'provider' is null or a.provider = p_filters ->> 'provider'),
      'rows', (select coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'at', b.created_at, 'jobId', b.job_id, 'jobRef', b.short_ref,
          'jobState', b.job_state, 'purpose', b.purpose, 'userId', b.user_id, 'userEmail', u.email, 'provider', b.provider, 'providerName', b.provider_name,
          'modelId', b.model_id, 'modelName', b.model_name, 'upstreamModelId', b.upstream_model_id, 'attempt', b.ordinal,
          'attemptState', b.attempt_state, 'options', b.options, 'quantities', b.quantities, 'unit', b.native_unit,
          'estimatedNative', b.estimated_native, 'estimatedUsd', b.estimated_effective_usd, 'confirmedNative', b.confirmed_native,
          'confirmedUsd', b.confirmed_effective_usd, 'state', b.state, 'source', b.source, 'note', b.note, 'funding', b.funding,
          'priceRef', b.price_ref) order by b.created_at desc), '[]'::jsonb)
        from (select * from base where p_before is null or created_at < p_before order by created_at desc limit v_limit) b
        left join auth.users u on u.id = b.user_id)
    )
  );
end;
$$;
revoke execute on function public.admin_provider_usage(jsonb, timestamptz, int) from public, anon;
grant execute on function public.admin_provider_usage(jsonb, timestamptz, int) to authenticated;

-- Route and supplier cost of one job: every attempt with the exact settings, candidates and ledger state.
create or replace function public.admin_job_route(p_job_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('provider.read');
begin
  return jsonb_build_object('jobId', p_job_id, 'attempts', (select coalesce(jsonb_agg(jsonb_build_object(
      'attemptId', t.id, 'ordinal', t.ordinal, 'state', t.state, 'provider', a.provider, 'offerId', t.offer_id, 'credentialVersion', t.credential_version,
      'submittedAt', t.submitted_at, 'respondedAt', t.responded_at, 'errorCode', t.error_code, 'route', t.route - 'secretRef',
      'ledger', (select jsonb_build_object('state', l.state, 'unit', l.native_unit, 'estimatedNative', l.estimated_native,
          'estimatedUsd', l.estimated_effective_usd, 'confirmedNative', l.confirmed_native, 'confirmedUsd', l.confirmed_effective_usd, 'note', l.note)
        from app_private.provider_cost_ledger l where l.attempt_id = t.id)) order by t.ordinal), '[]'::jsonb)
    from app_private.provider_attempts t join app_private.provider_accounts a on a.id = t.provider_account_id where t.job_id = p_job_id));
end;
$$;
revoke execute on function public.admin_job_route(uuid) from public, anon;
grant execute on function public.admin_job_route(uuid) to authenticated;

