-- New immutable price version for an offer (owner). Rates must be positive numbers; a missing configuration stays
-- unknown. The caller sends the version it edited from so a concurrent change is refused.
create or replace function public.admin_save_offer_price(p_offer_id uuid, p_price jsonb, p_expected_version int default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('provider.manage');
  f app_private.provider_offers;
  v_cur int;
  v_sched jsonb := p_price -> 'schedule';
  k text;
  v jsonb;
  v_id uuid;
begin
  select * into f from app_private.provider_offers where id = p_offer_id for update;
  if not found then
    perform app_private.fail('NOT_FOUND', 'Offer not found.');
  end if;
  select max(version) into v_cur from app_private.provider_offer_prices where offer_id = f.id;
  if v_cur is distinct from p_expected_version then
    perform app_private.fail('PRICE_CHANGED', 'The price was changed meanwhile. Reload and check it again.');
  end if;
  if (app_private.cost_unit(p_price ->> 'unit')).id is null then
    perform app_private.fail('INVALID_INPUT', 'Unknown unit.');
  end if;
  if v_sched is null or jsonb_typeof(v_sched) <> 'object' or coalesce(v_sched ->> 'basis', '') not in ('output', 'request', 'output_second', 'io_second')
     or jsonb_typeof(v_sched -> 'dims') <> 'array' or jsonb_typeof(v_sched -> 'rates') <> 'object' then
    perform app_private.fail('INVALID_INPUT', 'The schedule needs a basis, dimensions and rates.');
  end if;
  if (select count(*) from jsonb_object_keys(v_sched -> 'rates')) not between 1 and 500 then
    perform app_private.fail('INVALID_INPUT', 'Enter between 1 and 500 rates.');
  end if;
  for k, v in select key, value from jsonb_each(v_sched -> 'rates') loop
    if app_private.num(v) is null or app_private.num(v) <= 0 then
      -- A blank or zero rate is not a free offer: leave the configuration out instead.
      perform app_private.fail('INVALID_INPUT', format('Rate for "%s" must be a positive number.', left(k, 60)));
    end if;
  end loop;
  if v_sched ->> 'basis' in ('output_second', 'io_second') and not (v_sched ? 'seconds') then
    perform app_private.fail('INVALID_INPUT', 'Per-second prices need the option that holds the seconds (or a fixed length).');
  end if;
  if coalesce(p_price ->> 'confidence', '') not in ('authoritative', 'documented', 'estimate', 'conflicting', 'unverified')
     or coalesce(p_price ->> 'sourceKind', '') not in ('documented', 'account_quote', 'manual', 'observed', 'research') then
    perform app_private.fail('INVALID_INPUT', 'Choose the confidence and the source of this price.');
  end if;
  if (p_price ->> 'checkedAt') is null or (p_price ->> 'checkedAt')::timestamptz > now() + interval '1 day' then
    perform app_private.fail('INVALID_INPUT', 'Enter when the price was checked.');
  end if;
  insert into app_private.provider_offer_prices (offer_id, version, unit, schedule, confidence, source_kind, source_url, checked_at,
    effective_at, expires_at, account_tier, promotion, assumptions, created_by)
  values (f.id, coalesce(v_cur, 0) + 1, p_price ->> 'unit', v_sched, p_price ->> 'confidence', p_price ->> 'sourceKind',
    left(p_price ->> 'sourceUrl', 400), (p_price ->> 'checkedAt')::timestamptz, (p_price ->> 'effectiveAt')::timestamptz,
    (p_price ->> 'expiresAt')::timestamptz, left(p_price ->> 'accountTier', 60), coalesce((p_price ->> 'promotion')::boolean, false),
    left(p_price ->> 'assumptions', 1000), v_actor)
  returning id into v_id;
  perform app_private.audit(v_actor, 'provider.manage', 'provider_offer.price_saved', 'provider_offer', f.id::text,
    coalesce(nullif(trim(p_price ->> 'reason'), ''), 'Saved price version ' || (coalesce(v_cur, 0) + 1)), null,
    jsonb_build_object('priceId', v_id, 'version', coalesce(v_cur, 0) + 1, 'unit', p_price ->> 'unit', 'confidence', p_price ->> 'confidence',
      'sourceUrl', p_price ->> 'sourceUrl'));
  return app_private.offer_json((select o from app_private.provider_offers o where o.id = f.id));
end;
$$;
revoke execute on function public.admin_save_offer_price(uuid, jsonb, int) from public, anon;
grant execute on function public.admin_save_offer_price(uuid, jsonb, int) to authenticated;

-- New version of a unit conversion (owner): for example the CNY rate actually paid, or a provider credit price.
create or replace function public.admin_save_cost_unit(p_unit text, p_units_per_usd text, p_basis text, p_source_url text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('provider.manage');
  v_cur app_private.cost_unit_versions := app_private.cost_unit(p_unit);
begin
  if v_cur.id is null then
    perform app_private.fail('NOT_FOUND', 'Unknown unit.');
  end if;
  if p_units_per_usd is null or p_units_per_usd !~ '^\s*\d{1,9}(\.\d{1,10})?\s*$' or trim(p_units_per_usd)::numeric <= 0 then
    perform app_private.fail('INVALID_INPUT', 'Enter how many units one US dollar buys (a positive number).');
  end if;
  if p_basis not in ('documented', 'illustrative', 'manual') or v_cur.basis = 'fixed' then
    perform app_private.fail('INVALID_INPUT', 'This conversion cannot be changed that way.');
  end if;
  insert into app_private.cost_unit_versions (unit, version, label, units_per_usd, basis, source_url, checked_at, note, created_by)
  values (v_cur.unit, v_cur.version + 1, v_cur.label, trim(p_units_per_usd)::numeric, p_basis, left(p_source_url, 400), now(), left(p_note, 500), v_actor);
  perform app_private.audit(v_actor, 'provider.manage', 'provider.unit_saved', 'cost_unit', v_cur.unit, coalesce(nullif(trim(p_note), ''), 'Updated the conversion'),
    jsonb_build_object('unitsPerUsd', v_cur.units_per_usd, 'version', v_cur.version),
    jsonb_build_object('unitsPerUsd', trim(p_units_per_usd)::numeric, 'version', v_cur.version + 1));
  return jsonb_build_object('unit', v_cur.unit, 'version', v_cur.version + 1);
end;
$$;
revoke execute on function public.admin_save_cost_unit(text, text, text, text, text) from public, anon;
grant execute on function public.admin_save_cost_unit(text, text, text, text, text) to authenticated;

-- Routing policy (owner): emergency fallback ceiling and price freshness.
create or replace function public.admin_set_routing_policy(p_patch jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('provider.manage');
  v_before jsonb := jsonb_build_object('fallbackMaxPct', app_private.setting('routing_fallback_max_pct'),
    'fallbackMaxUsd', app_private.setting('routing_fallback_max_usd'), 'priceStaleDays', app_private.setting('provider_price_stale_days'));
  k text;
  v numeric;
begin
  if coalesce(nullif(trim(p_reason), ''), '') = '' then
    perform app_private.fail('REASON_REQUIRED', 'Say why the routing policy changes.');
  end if;
  for k in select jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) loop
    if k not in ('fallbackMaxPct', 'fallbackMaxUsd', 'priceStaleDays') then
      perform app_private.fail('INVALID_INPUT', 'Unknown setting: ' || left(k, 40));
    end if;
    v := app_private.num(p_patch -> k);
    if jsonb_typeof(p_patch -> k) <> 'null' and (v is null or v < 0
        or (k = 'fallbackMaxPct' and v > 200) or (k = 'fallbackMaxUsd' and v > 100) or (k = 'priceStaleDays' and (v < 1 or v > 365))) then
      perform app_private.fail('INVALID_INPUT', 'Value out of range: ' || k);
    end if;
    if k = 'priceStaleDays' and jsonb_typeof(p_patch -> k) = 'null' then
      perform app_private.fail('INVALID_INPUT', 'Price freshness needs a number of days.');
    end if;
    update app_private.settings set value = case when jsonb_typeof(p_patch -> k) = 'null' then 'null'::jsonb else to_jsonb(v) end, updated_at = now()
    where key = case k when 'fallbackMaxPct' then 'routing_fallback_max_pct' when 'fallbackMaxUsd' then 'routing_fallback_max_usd'
                       else 'provider_price_stale_days' end;
  end loop;
  perform app_private.audit(v_actor, 'provider.manage', 'routing.policy_changed', 'setting', 'routing', p_reason, v_before, p_patch);
  return jsonb_build_object('fallbackMaxPct', app_private.setting('routing_fallback_max_pct'),
    'fallbackMaxUsd', app_private.setting('routing_fallback_max_usd'), 'priceStaleDays', app_private.setting('provider_price_stale_days'));
end;
$$;
revoke execute on function public.admin_set_routing_policy(jsonb, text) from public, anon;
grant execute on function public.admin_set_routing_policy(jsonb, text) to authenticated;

-- -------------------------------------------------------------- routing review

-- Request configurations of a model used to decide which offers ever win: every combination of option values (capped
-- at p_max), each input mode with its required inputs, and short/medium/long input media for per-second billing.
create or replace function app_private.review_configs(p_spec jsonb, p_max int default 400)
returns setof jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_set jsonb[] := array['{}'::jsonb];
  v_next jsonb[];
  k text;
  spec_opt jsonb;
  c jsonb;
  val jsonb;
  v_modes jsonb := coalesce(p_spec -> 'modes', '[null]'::jsonb);
  md jsonb;
  s text;
  v_counts jsonb;
  v_secs jsonb;
  v_media text[];
  v_len numeric;
  v_step int;
  i int;
begin
  for k, spec_opt in select key, value from jsonb_each(coalesce(p_spec -> 'options', '{}'::jsonb)) order by key loop
    v_next := array[]::jsonb[];
    foreach c in array v_set loop
      for val in select value from jsonb_array_elements(coalesce(spec_opt -> 'values', jsonb_build_array(spec_opt -> 'default'))) loop
        v_next := v_next || (c || jsonb_build_object(k, val));
      end loop;
    end loop;
    v_set := v_next;
  end loop;
  -- Deterministic thinning when the space is very large (every n-th combination).
  v_step := greatest(1, ceil(cardinality(v_set)::numeric / p_max)::int);
  for md in select value from jsonb_array_elements(v_modes) loop
    v_counts := '{}'::jsonb;
    v_media := array[]::text[];
    for s in select jsonb_array_elements_text(coalesce(md -> 'requires', '[]'::jsonb)) loop
      v_counts := v_counts || jsonb_build_object(s, greatest(coalesce((p_spec -> 'inputs' -> s ->> 'min')::int, 1), 1));
      if p_spec -> 'inputs' -> s ->> 'kind' in ('video', 'audio') then
        v_media := v_media || s;
      end if;
    end loop;
    if coalesce((p_spec -> 'references' ->> 'min')::int, 0) > 0 then
      v_counts := v_counts || jsonb_build_object('_references', (p_spec -> 'references' ->> 'min')::int);
    end if;
    i := 0;
    foreach c in array v_set loop
      i := i + 1;
      if (i - 1) % v_step <> 0 then
        continue;
      end if;
      if cardinality(v_media) = 0 then
        return next jsonb_build_object('options', c, 'mode', md ->> 'id', 'quantities',
          jsonb_build_object('outputs', coalesce((p_spec -> 'output' ->> 'count')::int, 1), 'counts', v_counts, 'seconds', '{}'::jsonb, 'promptChars', 100));
      else
        foreach v_len in array array[
          coalesce(app_private.num(p_spec -> 'inputs' -> v_media[1] -> 'minSeconds'), 3),
          round((coalesce(app_private.num(p_spec -> 'inputs' -> v_media[1] -> 'minSeconds'), 3) + coalesce(app_private.num(p_spec -> 'inputs' -> v_media[1] -> 'maxSeconds'), 15)) / 2),
          coalesce(app_private.num(p_spec -> 'inputs' -> v_media[1] -> 'maxSeconds'), 15)] loop
          v_secs := '{}'::jsonb;
          foreach s in array v_media loop
            v_secs := v_secs || jsonb_build_object(s, v_len);
          end loop;
          return next jsonb_build_object('options', c, 'mode', md ->> 'id', 'quantities',
            jsonb_build_object('outputs', coalesce((p_spec -> 'output' ->> 'count')::int, 1), 'counts', v_counts, 'seconds', v_secs, 'promptChars', 100));
        end loop;
      end if;
    end loop;
  end loop;
end;
$$;

-- For each offer of a model: in how many reviewed configurations it is compatible, has a known cost, and is not beaten
-- by a cheaper routable offer. Unknown competitor prices never beat an offer.
create or replace function app_private.offer_review(p_model_id text)
returns table (offer_id uuid, configs int, compatible int, priced int, wins int, example_win jsonb, example_loss jsonb)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_spec jsonb := (app_private.capability_for(p_model_id)).spec;
  v_offers jsonb;
  cfg jsonb;
  o jsonb;
  p jsonb;
  v_n int := 0;
  v_stats jsonb := '{}'::jsonb;
  v_costs jsonb;
  v_best numeric;
  v_cost numeric;
  st jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'caps', f.capabilities, 'price', app_private.offer_price(f.id),
      'routable', f.routing_enabled and f.status = 'eligible' and f.adapter is not null and a.enabled and not a.paused
        and (a.credential_version > 0 or a.secret_ref = 'KIE_API_KEY'),
      'upu', (app_private.cost_unit(app_private.offer_price(f.id) ->> 'unit')).units_per_usd, 'fee', a.funding_fee_bps, 'bonus', a.funding_bonus_bps)), '[]'::jsonb)
  into v_offers
  from app_private.provider_offers f join app_private.provider_accounts a on a.id = f.provider_account_id
  where f.model_id = p_model_id;
  for cfg in select * from app_private.review_configs(v_spec) loop
    v_n := v_n + 1;
    v_costs := '{}'::jsonb;
    v_best := null;
    for o in select value from jsonb_array_elements(v_offers) loop
      v_cost := null;
      if app_private.offer_incompatibility(o -> 'caps', cfg -> 'options', cfg ->> 'mode', cfg -> 'quantities') is null then
        v_cost := app_private.effective_usd(app_private.offer_native_cost(o -> 'price' -> 'schedule', cfg -> 'options', cfg -> 'quantities'),
          app_private.num(o -> 'upu'), app_private.num(o -> 'fee'), app_private.num(o -> 'bonus'));
        v_costs := v_costs || jsonb_build_object(o ->> 'id', jsonb_build_object('c', v_cost));
        if v_cost is not null and (o ->> 'routable')::boolean and o -> 'price' ->> 'confidence' in ('authoritative', 'documented', 'estimate')
           and (v_best is null or v_cost < v_best) then
          v_best := v_cost;
        end if;
      end if;
    end loop;
    for o in select value from jsonb_array_elements(v_offers) loop
      st := coalesce(v_stats -> (o ->> 'id'), '{"compatible":0,"priced":0,"wins":0}'::jsonb);
      if v_costs ? (o ->> 'id') then
        st := jsonb_set(st, '{compatible}', to_jsonb((st ->> 'compatible')::int + 1));
        v_cost := app_private.num(v_costs -> (o ->> 'id') -> 'c');
        if v_cost is not null then
          st := jsonb_set(st, '{priced}', to_jsonb((st ->> 'priced')::int + 1));
          if v_best is null or v_cost <= v_best then
            st := jsonb_set(st, '{wins}', to_jsonb((st ->> 'wins')::int + 1));
            if not st ? 'win' then st := st || jsonb_build_object('win', cfg || jsonb_build_object('usd', v_cost)); end if;
          elsif not st ? 'loss' then
            st := st || jsonb_build_object('loss', cfg || jsonb_build_object('usd', v_cost, 'bestUsd', v_best));
          end if;
        end if;
      end if;
      v_stats := v_stats || jsonb_build_object(o ->> 'id', st);
    end loop;
  end loop;
  for o in select value from jsonb_array_elements(v_offers) loop
    st := coalesce(v_stats -> (o ->> 'id'), '{"compatible":0,"priced":0,"wins":0}'::jsonb);
    offer_id := (o ->> 'id')::uuid; configs := v_n; compatible := (st ->> 'compatible')::int; priced := (st ->> 'priced')::int;
    wins := (st ->> 'wins')::int; example_win := st -> 'win'; example_loss := st -> 'loss';
    return next;
  end loop;
end;
$$;

-- Proposed decision per offer from the complete reviewed configuration space.
create or replace function app_private.routing_review_proposals()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_model text;
  f record;
  rv record;
  v_out jsonb := '[]'::jsonb;
  v_dec text;
  v_reason text;
  v_price jsonb;
begin
  for v_model in select distinct model_id from app_private.provider_offers where model_id is not null order by 1 loop
  for rv in select * from app_private.offer_review(v_model) loop
    select o.*, coalesce(a.display_name, a.provider) as provider_name, a.provider as provider,
      a.enabled and not a.paused and (a.credential_version > 0 or a.secret_ref = 'KIE_API_KEY') as account_ready
    into f
    from app_private.provider_offers o join app_private.provider_accounts a on a.id = o.provider_account_id where o.id = rv.offer_id;
    v_price := app_private.offer_price(f.id);
    if f.status = 'unavailable' then
      v_dec := 'unavailable'; v_reason := 'Marked unavailable';
    elsif f.adapter is null then
      v_dec := 'unresolved'; v_reason := coalesce(f.blocker, 'No integration for this offer in this release');
    elsif v_price is null then
      v_dec := 'unresolved'; v_reason := 'No supplier price';
    elsif v_price ->> 'confidence' in ('conflicting', 'unverified') then
      v_dec := 'unresolved'; v_reason := 'Price ' || (v_price ->> 'confidence') || coalesce(': ' || f.blocker, '');
    elsif coalesce(rv.compatible, 0) = 0 then
      v_dec := 'incompatible'; v_reason := 'Compatible with none of the ' || coalesce(rv.configs, 0) || ' reviewed configurations';
    elsif coalesce(rv.priced, 0) = 0 then
      v_dec := 'unresolved'; v_reason := 'No price for any compatible configuration';
    elsif rv.wins > 0 then
      v_dec := 'eligible'; v_reason := format('Cheapest or tied in %s of %s compatible configurations', rv.wins, rv.compatible);
    else
      v_dec := 'dominated'; v_reason := format('A routable offer is cheaper in all %s compatible configurations', rv.priced);
    end if;
    v_out := v_out || jsonb_build_object('offerId', f.id, 'modelId', f.model_id, 'provider', f.provider, 'providerName', f.provider_name,
      'productLabel', f.product_label, 'status', f.status, 'routingEnabled', f.routing_enabled, 'currentDecision', f.decision,
      'proposedDecision', v_dec, 'reason', v_reason, 'configs', rv.configs, 'compatible', rv.compatible, 'priced', rv.priced, 'wins', rv.wins,
      'exampleWin', rv.example_win, 'exampleLoss', rv.example_loss, 'mapped', true,
      'canActivate', v_dec = 'eligible' and f.status = 'eligible' and not f.routing_enabled and f.account_ready);
  end loop;
  end loop;
  return v_out;
end;
$$;

