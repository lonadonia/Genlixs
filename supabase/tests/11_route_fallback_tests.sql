-- Route fallback (migration route_fallback_original): a temporarily unavailable cheaper offer never blocks a request the
-- original KIE route can serve, and the customer price never depends on the route. One DO block rolled back by the final
-- exception; nothing is sent to any supplier (route_choose and quotes only).
--  F1 a cheaper offer whose recent balance cannot cover the request: the original route serves it, the quote is unchanged
--  F2 once the balance covers it, the cheaper offer serves again; the customer pays the same credits on either route
--  F3 circuit breaker and daily cap on the cheaper offer: the same fallback
--  F4 several cheaper offers: the cheapest available one up to the original route's cost
--  F5 the original route not routable: the configured ceiling alone applies (refused as before)
--  F6 never above the original route's cost, even when the original route is itself temporarily unavailable
do $$
declare
  cust uuid := pg_temp.t_user('t-rf-cus-' || gen_random_uuid() || '@genlixs.test');
  nz uuid := (select id from app_private.provider_accounts where provider = 'nezhagate');
  am uuid := (select id from app_private.provider_accounts where provider = 'apimart');
  kie uuid := (select id from app_private.provider_accounts where provider = 'kie' and label = 'primary');
  flare jsonb := app_private.example_request((app_private.capability_for('gpt-flare-image')).spec);
  sd jsonb := app_private.example_request((app_private.capability_for('seedance-2-5')).spec);
  r jsonb; q jsonb; q2 jsonb;
  v_ok int := 0;
begin
  update app_private.provider_accounts set submit_blocked_until = null, submit_block_since = null, paused = false, daily_spend_cap_usd = null
    where id in (nz, am, kie);
  update app_private.provider_accounts set enabled = true, credential_version = 1, connection_state = 'ok' where id in (nz, am);
  update app_private.provider_offers set status = 'eligible', routing_enabled = true
    where provider_account_id in (nz, am) and model_id in ('gpt-flare-image', 'seedance-2-5');
  update app_private.model_catalog set state = 'enabled' where id in ('gpt-flare-image', 'seedance-2-5');
  update app_private.settings set value = '100' where key = 'max_quotes_per_minute';

  -- F1 -------------------------------------------- cheaper offer short of balance → original route
  update app_private.provider_accounts set last_balance = 0.001, balance_available = null, balance_unit = 'usd', balance_source = 'api',
    last_balance_at = now() - interval '1 minute', key_quota_unlimited = false where id = nz;
  r := app_private.route_choose('gpt-flare-image', flare -> 'options', flare ->> 'mode', flare -> 'quantities');
  if r ->> 'status' <> 'ok' or r -> 'chosen' ->> 'provider' <> 'kie' or (r ->> 'cheapestUsd')::numeric <> 0.005 or (r ->> 'originalUsd')::numeric <> 0.03
     or r ->> 'explanation' not like '%fallback: the cheapest offer at $0.005 is temporarily unavailable%' then
    raise exception 'F1 fallback to the original route %', r - 'candidates'; end if;
  if (select c ->> 'excluded' from jsonb_array_elements(r -> 'candidates') c where c ->> 'provider' = 'nezhagate') <> 'Balance too low for this job' then
    raise exception 'F1 the cheaper offer is not the one short of balance %', r -> 'candidates'; end if;
  perform pg_temp.t_as(cust);
  q := public.create_generation_quote('gpt-flare-image', 'A ceramic lamp, editorial photo', flare -> 'options', '{}');
  execute 'reset role';
  if (q ->> 'creditUnits')::bigint <> (select app_private.price_units_for(rules, flare -> 'options', 0) from app_private.price_versions
      where model_id = 'gpt-flare-image' and state = 'published') then raise exception 'F1 quote %', q; end if;
  v_ok := v_ok + 1;

  -- F2 ---------------------------------------------------- funded again → the cheaper offer serves
  update app_private.provider_accounts set last_balance = 1 where id = nz;
  r := app_private.route_choose('gpt-flare-image', flare -> 'options', flare ->> 'mode', flare -> 'quantities');
  if r -> 'chosen' ->> 'provider' <> 'nezhagate' or (r -> 'chosen' ->> 'effectiveUsd')::numeric <> 0.005 or r ->> 'explanation' like '%fallback%' then
    raise exception 'F2 cheapest %', r - 'candidates'; end if;
  perform pg_temp.t_as(cust);
  q2 := public.create_generation_quote('gpt-flare-image', 'The same lamp', flare -> 'options', '{}');
  execute 'reset role';
  if q2 ->> 'creditUnits' <> q ->> 'creditUnits' then raise exception 'F2 the price moved with the route % %', q, q2; end if;
  v_ok := v_ok + 1;

  -- F3 ------------------------------------------- circuit breaker, daily cap → the same fallback
  update app_private.provider_accounts set submit_blocked_until = now() + interval '5 minutes', submit_block_since = now() where id = nz;
  r := app_private.route_choose('gpt-flare-image', flare -> 'options', flare ->> 'mode', flare -> 'quantities');
  if r ->> 'status' <> 'ok' or r -> 'chosen' ->> 'provider' <> 'kie' then raise exception 'F3 circuit breaker %', r - 'candidates'; end if;
  update app_private.provider_accounts set submit_blocked_until = null, submit_block_since = null, daily_spend_cap_usd = 0.001 where id = nz;
  r := app_private.route_choose('gpt-flare-image', flare -> 'options', flare ->> 'mode', flare -> 'quantities');
  if r ->> 'status' <> 'ok' or r -> 'chosen' ->> 'provider' <> 'kie'
     or (select c ->> 'excluded' from jsonb_array_elements(r -> 'candidates') c where c ->> 'provider' = 'nezhagate') <> 'Daily spending cap reached' then
    raise exception 'F3 daily cap %', r - 'candidates'; end if;
  update app_private.provider_accounts set daily_spend_cap_usd = null where id = nz;
  v_ok := v_ok + 1;

  -- F4 --------------------------- several cheaper offers: the cheapest available up to the original cost
  -- Seedance 2.5 example request: NezhaGate $0.79 (short of balance), APIMart $1.08, KIE $1.575
  update app_private.provider_accounts set last_balance = 0.15 where id = nz;
  r := app_private.route_choose('seedance-2-5', sd -> 'options', sd ->> 'mode', sd -> 'quantities');
  if r ->> 'status' <> 'ok' or r -> 'chosen' ->> 'provider' <> 'apimart' or (r ->> 'cheapestUsd')::numeric >= (r -> 'chosen' ->> 'effectiveUsd')::numeric
     or (r -> 'chosen' ->> 'effectiveUsd')::numeric > (r ->> 'originalUsd')::numeric then
    raise exception 'F4 next cheapest %', r - 'candidates'; end if;
  update app_private.provider_accounts set submit_blocked_until = now() + interval '5 minutes', submit_block_since = now() where id = am;
  r := app_private.route_choose('seedance-2-5', sd -> 'options', sd ->> 'mode', sd -> 'quantities');
  if r ->> 'status' <> 'ok' or r -> 'chosen' ->> 'provider' <> 'kie' then raise exception 'F4 original route last %', r - 'candidates'; end if;
  update app_private.provider_accounts set submit_blocked_until = null, submit_block_since = null where id = am;
  v_ok := v_ok + 1;

  -- F5 ------------------------------- original route not routable: refused as before (configured ceiling only)
  update app_private.provider_offers set routing_enabled = false where model_id = 'gpt-flare-image' and is_legacy_primary;
  update app_private.provider_accounts set last_balance = 0.001 where id = nz;
  r := app_private.route_choose('gpt-flare-image', flare -> 'options', flare ->> 'mode', flare -> 'quantities');
  if r ->> 'status' <> 'blocked' or r -> 'chosen' <> 'null'::jsonb or r -> 'originalUsd' <> 'null'::jsonb then
    raise exception 'F5 without the original route %', r - 'candidates'; end if;
  update app_private.provider_offers set routing_enabled = true where model_id = 'gpt-flare-image' and is_legacy_primary;
  v_ok := v_ok + 1;

  -- F6 ------------------------------------------------- never above the original route's cost
  -- KIE itself short of balance for Seedance, NezhaGate short of balance, APIMart dearer than KIE after a 50 % card fee
  update app_private.provider_accounts set last_balance = 1, balance_available = null, balance_unit = 'kie_credit', balance_source = 'api',
    last_balance_at = now() - interval '1 minute', key_quota_unlimited = false where id = kie;
  update app_private.provider_accounts set funding_fee_bps = 5000 where id = am;
  r := app_private.route_choose('seedance-2-5', sd -> 'options', sd ->> 'mode', sd -> 'quantities');
  if (select (c ->> 'effectiveUsd')::numeric from jsonb_array_elements(r -> 'candidates') c where c ->> 'provider' = 'apimart') <= (r ->> 'originalUsd')::numeric then
    raise exception 'F6 setup: APIMart should cost more than KIE here %', r - 'candidates'; end if;
  if r ->> 'status' <> 'blocked' or r -> 'chosen' <> 'null'::jsonb then raise exception 'F6 a dearer supplier was used %', r - 'candidates'; end if;
  v_ok := v_ok + 1;

  raise exception 'PASS: % route fallback test groups', v_ok;
end;
$$;
