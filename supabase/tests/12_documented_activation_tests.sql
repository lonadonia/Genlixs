-- Documented activation (migration documented_activation): the owner may let a supplier offer serve without a paid live
-- test when every documented check passes; "Live-tested" needs a real succeeded test job. One DO block rolled back by
-- the final exception; nothing is sent to any supplier (the worker calls below record simulated replies).
--  D1 only provider.manage activates; provider.read sees the checks; customers see nothing
--  D2 the production picture: which offers qualify with production-like keys, checks and balances, and why the others do not
--  D3 every check blocks on its own: key, authentication, stale or short balance, stale price, documentation gap,
--     estimate price, no result host, no integration, the original route; nothing changes on a refusal
--  D4 acknowledgement and reason are required; activation records basis, note, snapshot and audit; routing serves it;
--     2K Flare requests keep the original route; customer prices and price versions do not change
--  D5 "Live-tested" is refused for a note, an unknown job, an unpinned job, a pinned job that did not succeed; it is
--     recorded for a succeeded test job accepted by the offer's supplier
--  D6 routing needs evidence; turning a documented offer back on re-runs the checks
--  D7 recording a documentation gap switches a documented offer off (reason required)
--  D8 safety stop: a supplier refusal or a failed job switches a documented offer off and the next request goes to the
--     original route; a live-tested offer is not switched off
do $$
declare
  cust uuid := pg_temp.t_user('t-da-cus-' || gen_random_uuid() || '@genlixs.test');
  ops uuid := pg_temp.t_user('t-da-ops-' || gen_random_uuid() || '@genlixs.test');
  own uuid := pg_temp.t_user('t-da-own-' || gen_random_uuid() || '@genlixs.test');
  kie uuid := (select id from app_private.provider_accounts where provider = 'kie' and label = 'primary');
  nz uuid := (select id from app_private.provider_accounts where provider = 'nezhagate');
  am uuid := (select id from app_private.provider_accounts where provider = 'apimart');
  py uuid := (select id from app_private.provider_accounts where provider = 'poyo');
  cu uuid := (select id from app_private.provider_accounts where provider = 'cuddler');
  flare uuid; sunburst uuid; kie_flare uuid; cu_sd uuid; am_flux uuid; am_sd uuid;
  flare_ex jsonb := app_private.example_request((app_private.capability_for('gpt-flare-image')).spec);
  r jsonb; q jsonb; q2 jsonb; w jsonb;
  job1 uuid; job2 uuid; job3 uuid; v_att uuid;
  v_txt text; v_n int; v_prices int;
  v_ok int := 0;
  v_expect text[];
begin
  select f.id into flare from app_private.provider_offers f where f.provider_account_id = nz and f.model_id = 'gpt-flare-image';
  select f.id into sunburst from app_private.provider_offers f where f.provider_account_id = nz and f.model_id = 'gpt-sunburst-image';
  select f.id into kie_flare from app_private.provider_offers f where f.model_id = 'gpt-flare-image' and f.is_legacy_primary;
  select f.id into cu_sd from app_private.provider_offers f where f.provider_account_id = cu and f.model_id = 'seedance-2-5';
  select f.id into am_sd from app_private.provider_offers f where f.provider_account_id = am and f.model_id = 'seedance-2-5';
  select f.id into am_flux from app_private.provider_offers f where f.provider_account_id = am and f.model_id = 'flux-2-pro-image';
  update app_private.model_catalog set state = 'enabled' where id in ('gpt-flare-image', 'gpt-sunburst-image', 'seedance-2-5');
  update app_private.settings set value = '100' where key = 'max_quotes_per_minute';
  perform app_private.grant_lot(cust, 'promo', 'test:grant:' || cust, 1000, null, null, 'test grant');
  insert into app_private.staff_memberships (user_id, role) values (ops, 'operations'), (own, 'owner');
  -- Production on 19 Oct 2026: keys saved, free connection checks passed, balances read minutes ago.
  update app_private.provider_accounts set enabled = true, paused = false, credential_version = 1, connection_state = 'ok',
    connection_checked_at = now(), submit_blocked_until = null, submit_block_since = null, daily_spend_cap_usd = null,
    balance_source = 'api', balance_available = null, key_quota_unlimited = false, last_balance_at = now() - interval '5 minutes',
    last_balance = case provider when 'nezhagate' then 0.15 when 'apimart' then 100 when 'poyo' then 1000 when 'cuddler' then 0 end,
    balance_unit = case provider when 'nezhagate' then 'usd' when 'apimart' then 'apimart_credit' when 'poyo' then 'poyo_credit' when 'cuddler' then 'usd' end
  where id in (nz, am, py, cu);
  v_prices := (select count(*) from app_private.price_versions);

  -- D1 ------------------------------------------------------------------ access
  perform pg_temp.t_as(cust);
  foreach v_txt in array array[format('admin_offer_activation_readiness(%L::uuid)', flare),
      format('admin_activate_offer_documented(%L::uuid, %L, true)', flare, 'Documented and funded')] loop
    begin
      execute 'select public.' || v_txt;
      raise exception 'D1 customer allowed: %', v_txt;
    exception when others then
      if sqlerrm not in ('FORBIDDEN', 'UNAUTHENTICATED') then raise exception 'D1 % → %', v_txt, sqlerrm; end if;
    end;
  end loop;
  execute 'reset role';
  perform pg_temp.t_as(ops);
  r := public.admin_offer_activation_readiness(flare);
  if not (r ->> 'qualifies')::boolean then raise exception 'D1 ops reads the checks %', r; end if;
  begin
    perform public.admin_activate_offer_documented(flare, 'Documented and funded', true);
    raise exception 'D1 ops activated';
  exception when others then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  execute 'reset role';
  v_ok := v_ok + 1;

  -- D2 ---------------------------------------------------------- the production picture
  -- qualifying: every check passes; each is cheaper than the original route for at least one setting
  for r in select app_private.offer_activation_readiness(f.id) || jsonb_build_object('p', a.provider, 'm', f.model_id)
           from app_private.provider_offers f join app_private.provider_accounts a on a.id = f.provider_account_id
           where (a.provider, f.model_id) in (('apimart', 'seedance-2-5'), ('apimart', 'seedream-5-flash-image'), ('apimart', 'seedream-5-flash-edit'),
             ('nezhagate', 'gpt-flare-image'), ('nezhagate', 'gpt-flare-edit'), ('nezhagate', 'nano-banana-pro-image'),
             ('nezhagate', 'nano-banana-pro-edit'), ('poyo', 'kling-3-0-motion')) loop
    if not (r ->> 'qualifies')::boolean or (r ->> 'cheaper')::int < 1 then
      raise exception 'D2 % % should qualify: %', r ->> 'p', r ->> 'm',
        (select jsonb_agg(c) from jsonb_array_elements(r -> 'checks') c where not (c ->> 'ok')::boolean);
    end if;
    v_n := coalesce(v_n, 0) + 1;
  end loop;
  if v_n <> 8 then raise exception 'D2 % qualifying offers found', v_n; end if;
  -- blocked, with the first failing check that explains it
  for r in select app_private.offer_activation_readiness(f.id) || jsonb_build_object('p', a.provider, 'm', f.model_id, 'expect', x.expect)
           from (values ('apimart', 'seedance-2-fast', 'documentation'), ('nezhagate', 'gpt-sunburst-image', 'documentation'),
                   ('nezhagate', 'gpt-sunburst-edit', 'documentation'), ('nezhagate', 'seedance-2-5', 'balance'),
                   ('nezhagate', 'seedance-2-fast', 'balance'), ('cuddler', 'kling-3-0', 'result_hosts'),
                   ('cuddler', 'seedance-2-5', 'price'), ('apimart', 'flux-2-pro-image', 'integration'),
                   ('poyo', 'nano-banana-pro-image', 'integration')) x(p, m, expect)
           join app_private.provider_accounts a on a.provider = x.p
           join app_private.provider_offers f on f.provider_account_id = a.id and f.model_id = x.m loop
    if (r ->> 'qualifies')::boolean or not exists (select 1 from jsonb_array_elements(r -> 'checks') c where c ->> 'key' = r ->> 'expect' and not (c ->> 'ok')::boolean) then
      raise exception 'D2 % % should fail %: %', r ->> 'p', r ->> 'm', r ->> 'expect', r -> 'checks';
    end if;
  end loop;
  -- Cuddler is also unfunded, and its download host is not documented
  r := app_private.offer_activation_readiness(cu_sd);
  if (select count(*) from jsonb_array_elements(r -> 'checks') c where c ->> 'key' in ('balance', 'result_hosts', 'price', 'documentation') and not (c ->> 'ok')::boolean) <> 4 then
    raise exception 'D2 Cuddler Seedance %', r -> 'checks'; end if;
  v_ok := v_ok + 1;

  -- D3 ---------------------------------------------------------- each check blocks on its own
  perform pg_temp.t_as(own);
  foreach v_txt in array array[
      'update app_private.provider_accounts set credential_version = 0 where id = $1|account',
      'update app_private.provider_accounts set connection_state = ''untested'' where id = $1|auth',
      'update app_private.provider_accounts set connection_state = ''unauthorized'' where id = $1|auth',
      'update app_private.provider_accounts set last_balance_at = now() - interval ''2 hours'' where id = $1|balance',
      'update app_private.provider_accounts set last_balance = 0.004 where id = $1|balance',
      'update app_private.provider_accounts set balance_unit = ''cny'' where id = $1|balance',
      'update app_private.settings set value = ''0'' where key = ''provider_price_stale_days'' and $1 is not null|price',
      'update app_private.provider_accounts set enabled = false where id = $1|account',
      'update app_private.provider_adapters set result_hosts = ''{}'' where provider = ''nezhagate'' and $1 is not null|result_hosts',
      'update app_private.provider_offers set docs_url = null where provider_account_id = $1 and model_id = ''gpt-flare-image''|docs'] loop
    execute 'reset role';
    begin
      execute split_part(v_txt, '|', 1) using nz;
      perform pg_temp.t_as(own);
      begin
        perform public.admin_activate_offer_documented(flare, 'Documented and funded', true);
        raise exception 'D3 activated despite %', v_txt;
      exception when others then
        if sqlerrm <> 'NOT_QUALIFIED' then raise exception 'D3 % → %', v_txt, sqlerrm; end if;
      end;
      execute 'reset role';
      r := app_private.offer_activation_readiness(flare);
      if not exists (select 1 from jsonb_array_elements(r -> 'checks') c where c ->> 'key' = split_part(v_txt, '|', 2) and not (c ->> 'ok')::boolean) then
        raise exception 'D3 % not reported: %', v_txt, r -> 'checks'; end if;
      if (select status <> 'capabilities_unverified' or routing_enabled or verification_basis is not null from app_private.provider_offers where id = flare) then
        raise exception 'D3 the offer changed on a refusal'; end if;
      raise exception 'undo';
    exception when others then
      if sqlerrm <> 'undo' then raise; end if;
    end;
  end loop;
  execute 'reset role';
  -- the original route, a non-integrated offer and an estimate price are refused too
  perform pg_temp.t_as(own);
  foreach job1 in array array[kie_flare, am_flux, cu_sd] loop
    begin
      perform public.admin_activate_offer_documented(job1, 'Documented and funded', true);
      raise exception 'D3 activated %', job1;
    exception when others then if sqlerrm <> 'NOT_QUALIFIED' then raise exception 'D3 % → %', job1, sqlerrm; end if; end;
  end loop;
  execute 'reset role';
  v_ok := v_ok + 1;

  -- D4 ------------------------------------------------------------------ activation
  perform pg_temp.t_as(cust);
  q := public.create_generation_quote('gpt-flare-image', 'A ceramic lamp, editorial photo', flare_ex -> 'options', '{}');
  execute 'reset role';
  r := app_private.route_choose('gpt-flare-image', flare_ex -> 'options', flare_ex ->> 'mode', flare_ex -> 'quantities');
  if r -> 'chosen' ->> 'provider' <> 'kie' then raise exception 'D4 before activation %', r -> 'chosen'; end if;
  perform pg_temp.t_as(own);
  begin
    perform public.admin_activate_offer_documented(flare, 'Documented and funded', false);
    raise exception 'D4 activated without acknowledgement';
  exception when others then if sqlerrm <> 'ACKNOWLEDGEMENT_REQUIRED' then raise; end if; end;
  begin
    perform public.admin_activate_offer_documented(flare, ' short ', true);
    raise exception 'D4 activated without a reason';
  exception when others then if sqlerrm <> 'REASON_REQUIRED' then raise; end if; end;
  r := public.admin_activate_offer_documented(flare, 'Documented API, documented price, funded', true);
  execute 'reset role';
  if r ->> 'status' <> 'eligible' or r ->> 'verificationBasis' <> 'documented' or not (r ->> 'routingEnabled')::boolean
     or r ->> 'verificationNote' <> 'Documented, not live-tested: Documented API, documented price, funded' or r -> 'liveTestJob' <> 'null'::jsonb
     or (r -> 'activation' ->> 'activatedBy')::uuid <> own or not (r -> 'readiness' ->> 'qualifies')::boolean then
    raise exception 'D4 activation reply %', r - 'readiness'; end if;
  if (select count(*) from app_private.admin_audit_logs where target_id = flare::text and action = 'provider_offer.activated_documented' and actor_id = own) <> 1 then
    raise exception 'D4 audit'; end if;
  if (select activation_snapshot -> 'readiness' ->> 'qualifies' from app_private.provider_offers where id = flare) <> 'true' then
    raise exception 'D4 snapshot'; end if;
  r := app_private.route_choose('gpt-flare-image', flare_ex -> 'options', flare_ex ->> 'mode', flare_ex -> 'quantities');
  if r -> 'chosen' ->> 'provider' <> 'nezhagate' then raise exception 'D4 route after activation %', r - 'candidates'; end if;
  r := app_private.route_choose('gpt-flare-image', (flare_ex -> 'options') || '{"resolution": "2K"}', flare_ex ->> 'mode', flare_ex -> 'quantities');
  if r -> 'chosen' ->> 'provider' <> 'kie' or (select c ->> 'excluded' from jsonb_array_elements(r -> 'candidates') c where c ->> 'provider' = 'nezhagate') not like 'Incompatible%' then
    raise exception 'D4 2K Flare must keep the original route %', r - 'candidates'; end if;
  perform pg_temp.t_as(cust);
  q2 := public.create_generation_quote('gpt-flare-image', 'The same lamp', flare_ex -> 'options', '{}');
  execute 'reset role';
  if q2 ->> 'creditUnits' <> q ->> 'creditUnits' or (select count(*) from app_private.price_versions) <> v_prices then
    raise exception 'D4 customer price moved: % → %, price versions % → %', q ->> 'creditUnits', q2 ->> 'creditUnits', v_prices, (select count(*) from app_private.price_versions);
  end if;
  perform pg_temp.t_as(own);
  begin
    perform public.admin_activate_offer_documented(flare, 'Documented API, documented price, funded', true);
  exception when others then raise exception 'D4 activating twice should be harmless: %', sqlerrm; end;
  execute 'reset role';
  v_ok := v_ok + 1;

  -- D5 ---------------------------------------------------------------- live-tested
  perform pg_temp.t_as(cust);
  q := public.create_generation_quote('gpt-sunburst-image', 'A lamp in the morning light, editorial photo', '{"aspect_ratio": "1:1", "resolution": "1K"}', '{}');
  r := public.create_generation((q ->> 'quoteId')::uuid, 'key-da-0001');
  job1 := (r -> 'job' ->> 'id')::uuid;
  q := public.create_generation_quote('gpt-sunburst-image', 'A second lamp, editorial photo', '{"aspect_ratio": "1:1", "resolution": "1K"}', '{}');
  r := public.create_generation((q ->> 'quoteId')::uuid, 'key-da-0002');
  job2 := (r -> 'job' ->> 'id')::uuid;
  execute 'reset role';
  -- job1 is a test of the Sunburst offer (pinned as admin_create_offer_test does); job2 is an ordinary job
  insert into app_private.job_route_pins (job_id, offer_id, created_by) values (job1, sunburst, own);
  perform pg_temp.t_as(own);
  foreach v_txt in array array['{"status": "eligible", "verificationNote": "test job T-1: 1K output checked"}',
      '{"status": "eligible", "testJobId": "' || gen_random_uuid() || '"}', '{"status": "eligible", "testJobId": "' || job2 || '"}',
      '{"status": "eligible", "testJobId": "' || job1 || '"}', '{"status": "eligible", "testJobId": "not-a-uuid"}'] loop
    begin
      perform public.admin_update_offer(sunburst, v_txt::jsonb);
      raise exception 'D5 live-tested without a real test: %', v_txt;
    exception when others then if sqlerrm <> 'LIVE_TEST_REQUIRED' then raise exception 'D5 % → %', v_txt, sqlerrm; end if; end;
  end loop;
  begin
    perform public.admin_update_offer(sunburst, ('{"testJobId": "' || job1 || '"}')::jsonb);
    raise exception 'D5 a test job without the status';
  exception when others then if sqlerrm <> 'INVALID_INPUT' then raise; end if; end;
  execute 'reset role';
  -- the worker sends job1 to its pinned offer; the supplier accepts it and the result is imported (simulated replies)
  w := pg_temp.t_claim(job1, 'job_submit');
  r := public.worker_begin_submission_v2((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid, '{"envSecrets": ["KIE_API_KEY"]}');
  if r ->> 'action' <> 'submit' or (r -> 'route' ->> 'offerId')::uuid <> sunburst then raise exception 'D5 pinned route %', r; end if;
  r := public.worker_record_submission((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid, (r ->> 'attemptId')::uuid,
    '{"kind": "accepted", "taskId": "img_nz_da_0001"}');
  perform pg_temp.t_as(own);
  begin
    perform public.admin_update_offer(sunburst, ('{"status": "eligible", "testJobId": "' || job1 || '"}')::jsonb);
    raise exception 'D5 live-tested before the test succeeded';
  exception when others then if sqlerrm <> 'LIVE_TEST_REQUIRED' then raise; end if; end;
  execute 'reset role';
  update public.generation_jobs set state = 'succeeded' where id = job1;
  perform pg_temp.t_as(own);
  r := public.admin_update_offer(sunburst, ('{"status": "eligible", "testJobId": "' || job1 || '"}')::jsonb);
  execute 'reset role';
  if r ->> 'verificationBasis' <> 'live_test' or (r -> 'liveTestJob' ->> 'id')::uuid <> job1 or r ->> 'verificationNote' not like 'Live-tested: job %'
     or (r ->> 'routingEnabled')::boolean then
    raise exception 'D5 live-tested reply %', r; end if;
  v_ok := v_ok + 1;

  -- D6 --------------------------------------------------------------- routing needs evidence
  update app_private.provider_offers set status = 'eligible', verification_basis = null where provider_account_id = am and model_id = 'seedance-2-5';
  perform pg_temp.t_as(own);
  begin
    perform public.admin_update_offer(am_sd, '{"routingEnabled": true}');
    raise exception 'D6 routing without evidence';
  exception when others then if sqlerrm <> 'OFFER_NOT_READY' then raise; end if; end;
  perform public.admin_update_offer(flare, '{"routingEnabled": false}');
  execute 'reset role';
  update app_private.provider_accounts set last_balance_at = now() - interval '2 hours' where id = nz;
  perform pg_temp.t_as(own);
  begin
    perform public.admin_update_offer(flare, '{"routingEnabled": true}');
    raise exception 'D6 a documented offer came back on without the checks';
  exception when others then if sqlerrm <> 'NOT_QUALIFIED' then raise; end if; end;
  execute 'reset role';
  update app_private.provider_accounts set last_balance_at = now() - interval '5 minutes' where id = nz;
  perform pg_temp.t_as(own);
  r := public.admin_update_offer(flare, '{"routingEnabled": true}');
  if not (r ->> 'routingEnabled')::boolean then raise exception 'D6 back on'; end if;
  -- a live-tested offer turns on without the documented checks (its evidence is the test)
  r := public.admin_update_offer(sunburst, '{"routingEnabled": true}', null);
  if not (r ->> 'routingEnabled')::boolean then raise exception 'D6 live-tested routing'; end if;
  execute 'reset role';
  update app_private.provider_offers set status = 'capabilities_unverified', verification_basis = null where provider_account_id = am and model_id = 'seedance-2-5';
  v_ok := v_ok + 1;

  -- D7 ------------------------------------------------------- documentation gap switches it off
  perform pg_temp.t_as(own);
  begin
    perform public.admin_update_offer(flare, '{"documentationGap": "The 1K output size is not documented."}');
    raise exception 'D7 gap without a reason';
  exception when others then if sqlerrm <> 'REASON_REQUIRED' then raise; end if; end;
  r := public.admin_update_offer(flare, '{"documentationGap": "The 1K output size is not documented."}', 'Found while reviewing the docs');
  if r ->> 'status' <> 'capabilities_unverified' or (r ->> 'routingEnabled')::boolean or r ->> 'verificationBasis' is not null then
    raise exception 'D7 still serving %', r; end if;
  r := public.admin_update_offer(flare, '{"documentationGap": null}', 'Answered by the supplier documentation update');
  r := public.admin_activate_offer_documented(flare, 'Documented API, documented price, funded', true);
  execute 'reset role';
  v_ok := v_ok + 1;

  -- D8 ------------------------------------------------------------------ safety stop
  -- a supplier refusal of a documented offer: switched off, the next request goes to the original route
  perform pg_temp.t_as(cust);
  q := public.create_generation_quote('gpt-flare-image', 'A third lamp, editorial photo', flare_ex -> 'options', '{}');
  r := public.create_generation((q ->> 'quoteId')::uuid, 'key-da-0003');
  job3 := (r -> 'job' ->> 'id')::uuid;
  execute 'reset role';
  w := pg_temp.t_claim(job3, 'job_submit');
  r := public.worker_begin_submission_v2((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid, '{"envSecrets": ["KIE_API_KEY"]}');
  if r -> 'route' ->> 'provider' <> 'nezhagate' then raise exception 'D8 routed %', r -> 'route'; end if;
  r := public.worker_record_submission((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid, (r ->> 'attemptId')::uuid,
    '{"kind": "rejected_terminal", "code": "INVALID_SIZE", "message": "size not supported"}');
  if (select status <> 'capabilities_unverified' or routing_enabled or verification_basis is not null or auto_paused_reason not like 'The supplier refused a request (INVALID_SIZE)%'
      from app_private.provider_offers where id = flare) then
    raise exception 'D8 refusal did not switch the offer off %', (select to_jsonb(f) - 'capabilities' from app_private.provider_offers f where id = flare); end if;
  if (select count(*) from app_private.admin_audit_logs where target_id = flare::text and action = 'provider_offer.auto_paused' and actor_id is null) <> 1 then
    raise exception 'D8 audit'; end if;
  r := app_private.route_choose('gpt-flare-image', flare_ex -> 'options', flare_ex ->> 'mode', flare_ex -> 'quantities');
  if r -> 'chosen' ->> 'provider' <> 'kie' then raise exception 'D8 next request %', r -> 'chosen'; end if;
  -- activated again; a job that the supplier accepted and then failed: switched off again
  perform pg_temp.t_as(own);
  r := public.admin_activate_offer_documented(flare, 'Cause found: the size was invalid upstream, fixed', true);
  if r -> 'autoPausedReason' <> 'null'::jsonb then raise exception 'D8 reactivation keeps the stop reason'; end if;
  execute 'reset role';
  perform pg_temp.t_as(cust);
  q := public.create_generation_quote('gpt-flare-image', 'A fourth lamp, editorial photo', flare_ex -> 'options', '{}');
  r := public.create_generation((q ->> 'quoteId')::uuid, 'key-da-0004');
  job3 := (r -> 'job' ->> 'id')::uuid;
  execute 'reset role';
  w := pg_temp.t_claim(job3, 'job_submit');
  r := public.worker_begin_submission_v2((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid, '{"envSecrets": ["KIE_API_KEY"]}');
  r := public.worker_record_submission((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid, (r ->> 'attemptId')::uuid,
    '{"kind": "accepted", "taskId": "img_nz_da_0004"}');
  w := pg_temp.t_claim(job3, 'job_check');
  r := public.worker_record_observation((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid,
    '{"taskId": "img_nz_da_0004", "providerState": "failed", "normalized": "fail", "failureCode": "CONTENT_FILTER", "source": "poll"}');
  if (select state from public.generation_jobs where id = job3) <> 'failed' then
    raise exception 'D8 setup: job state % (%)', (select state from public.generation_jobs where id = job3), r; end if;
  if (select status <> 'capabilities_unverified' or routing_enabled or auto_paused_reason not like 'Job % ended failed%' from app_private.provider_offers where id = flare) then
    raise exception 'D8 failed job did not switch the offer off %', (select auto_paused_reason from app_private.provider_offers where id = flare); end if;
  -- a live-tested offer keeps serving after a failed job on it (its evidence is the real test)
  update public.generation_jobs set state = 'failed', failure_code = 'TEST' where id = job1;
  if (select status <> 'eligible' or verification_basis <> 'live_test' or not routing_enabled from app_private.provider_offers where id = sunburst) then
    raise exception 'D8 live-tested offer changed'; end if;
  v_ok := v_ok + 1;

  raise exception 'PASS: % documented activation test groups', v_ok;
end;
$$;
