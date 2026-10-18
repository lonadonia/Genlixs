-- Multi-provider routing (migrations 20261018181012…20261018182418_multi_provider_routing_part01…12; run after them).
-- Rolled back by the final exception. Numbers refer to the acceptance list of the multi-provider brief:
--  A1 non-staff cannot read or change providers, keys, balances or usage; operations staff can read but not change
--  A2 a saved key is returned only as a masked hint, never appears in Admin reads, audit rows or account rows, and is
--     readable only by the service role; rotation keeps the version an open job uses and purges it afterwards
--  A3 equivalent settings choose the cheapest whole-request cost; incompatible offers never win
--  A4 credit units, CNY, points, funding fees and bonuses, per-image surcharges, batches and minimum seconds are exact
--  A5 the two Seedance reference-duration examples choose different suppliers (APIMart at 3 s, NezhaGate at 10 s)
--  A6 Cuddler's 5.5 % card fee reverses the PixVerse ordering
--  A7 a duplicated submit cannot create a second attempt, reservation or ledger row
--  A8 an ambiguous submit becomes "submission unknown" with no automatic second paid submission
--  A9 a failed download retries the import only (no new attempt, no new submission)
--  A10 an offer winning a single configuration keeps its provider active; a wholly dominated provider is excluded
--  A11 balances: failures keep the last real value, unknown stays NULL, unlimited key allowances, manual entries, stale
--  A12 Admin changes never redirect in-flight jobs; jobs from before routing resolve to their KIE route
--  A13 the public catalog has one card per model, only fulfillable options, and no hidden model
--  A14 usage totals keep confirmed, estimated, pending and unknown amounts apart and add up
do $$
declare
  cust uuid := pg_temp.t_user('t-mp-cust-' || gen_random_uuid() || '@genlixs.test');
  ops uuid := pg_temp.t_user('t-mp-ops-' || gen_random_uuid() || '@genlixs.test');
  own uuid := pg_temp.t_user('t-mp-own-' || gen_random_uuid() || '@genlixs.test');
  kie uuid := (select id from app_private.provider_accounts where provider = 'kie' and label = 'primary');
  nz uuid := (select id from app_private.provider_accounts where provider = 'nezhagate');
  am uuid := (select id from app_private.provider_accounts where provider = 'apimart');
  cu uuid := (select id from app_private.provider_accounts where provider = 'cuddler');
  py uuid := (select id from app_private.provider_accounts where provider = 'poyo');
  dm uuid := (select id from app_private.provider_accounts where provider = 'duomi');
  nz_flare uuid;
  r jsonb; q jsonb; w jsonb; x jsonb;
  job1 uuid; job2 uuid; job3 uuid; job4 uuid;
  v_item uuid; v_lease uuid; v_att uuid;
  o1 uuid; o2 uuid; o3 uuid;
  v_txt text; v_n int; v_num numeric;
  v_ok int := 0;
begin
  update app_private.model_catalog set state = 'disabled';
  perform pg_temp.t_enable_model('gpt-flare-image', '{"base": 4, "add": {"resolution": {"2K": 2, "4K": 6}}}');
  perform pg_temp.t_enable_model('gpt-sunburst-image', '{"base": 4, "add": {"resolution": {"2K": 2, "4K": 6}}}');
  perform pg_temp.t_enable_model('gpt-flare-edit', '{"base": 4, "add": {"resolution": {"2K": 2, "4K": 6}}}');
  update app_private.provider_accounts set submit_blocked_until = null, submit_block_since = null, paused = false;
  perform app_private.grant_lot(cust, 'promo', 'test:grant:' || cust, 1000, null, null, 'test grant');
  insert into app_private.staff_memberships (user_id, role) values (ops, 'operations'), (own, 'owner');
  select id into nz_flare from app_private.provider_offers where provider_account_id = nz and model_id = 'gpt-flare-image';

  -- A1 ------------------------------------------------------------------ access
  perform pg_temp.t_as(cust);
  foreach v_txt in array array['admin_providers_overview()', 'admin_routing_models()', 'admin_provider_usage(''{}''::jsonb)',
      format('admin_set_provider_key(%L::uuid, %L)', nz, 'x-key-123456789'), format('admin_update_offer(%L::uuid, %L::jsonb)', nz_flare, '{"routingEnabled": true}')] loop
    begin
      execute 'select public.' || v_txt;
      raise exception 'A1 customer allowed: %', v_txt;
    exception when others then
      if sqlerrm not in ('FORBIDDEN', 'UNAUTHENTICATED') then raise exception 'A1 % → %', v_txt, sqlerrm; end if;
    end;
  end loop;
  foreach v_txt in array array['select count(*) from app_private.provider_credentials', 'select count(*) from app_private.provider_offers',
      'select count(*) from app_private.provider_cost_ledger', 'select count(*) from vault.decrypted_secrets',
      format('select public.worker_provider_credential(%L::uuid, 1)', nz), 'select public.worker_balance_targets(5)'] loop
    begin
      execute v_txt;
      raise exception 'A1 customer can run: %', v_txt;
    exception when insufficient_privilege then null;
    end;
  end loop;
  execute 'reset role';
  perform pg_temp.t_as(ops);
  r := public.admin_providers_overview();
  if jsonb_array_length(r -> 'accounts') <> 6 or (r ->> 'canManage')::boolean then raise exception 'A1 ops overview %', r -> 'canManage'; end if;
  begin
    perform public.admin_set_provider_key(nz, 'ops-key-123456789');
    raise exception 'A1 ops saved a key';
  exception when others then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  begin
    perform public.admin_update_offer(nz_flare, '{"routingEnabled": true}');
    raise exception 'A1 ops changed routing';
  exception when others then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  execute 'reset role';
  v_ok := v_ok + 1;

  -- A2 ---------------------------------------------------------------- keys
  perform pg_temp.t_as(own);
  r := public.admin_set_provider_key(nz, 'nz-SECRET-value-0001');
  if r ->> 'keyHint' <> '••••0001' or r::text like '%SECRET%' or (r ->> 'keyVersion')::int <> 1 then raise exception 'A2 reply %', r; end if;
  begin
    perform public.admin_set_provider_key(nz, 'has space in it');
    raise exception 'A2 accepted a malformed key';
  exception when others then if sqlerrm <> 'INVALID_INPUT' then raise; end if; end;
  r := public.admin_providers_overview();
  if r::text like '%SECRET%' then raise exception 'A2 overview leaks the key'; end if;
  r := public.admin_update_provider_account(nz, '{"enabled": true}');
  r := public.admin_update_offer(nz_flare, '{"status": "eligible", "verificationNote": "test job T-1: 1K output 1024x1024 checked"}');
  r := public.admin_update_offer(nz_flare, '{"routingEnabled": true}');
  if not (r ->> 'routingEnabled')::boolean then raise exception 'A2 routing not on'; end if;
  execute 'reset role';
  if exists (select 1 from app_private.admin_audit_logs where (coalesce(before_state, '{}')::text || coalesce(after_state, '{}')::text || coalesce(reason, '')) like '%SECRET%') then
    raise exception 'A2 audit leaks the key';
  end if;
  if (select to_jsonb(a)::text from app_private.provider_accounts a where id = nz) like '%SECRET%' then raise exception 'A2 account row leaks the key'; end if;
  perform pg_temp.t_service();
  r := public.worker_provider_credential(nz, 1);
  if r ->> 'secret' <> 'nz-SECRET-value-0001' then raise exception 'A2 service role cannot read the key'; end if;
  execute 'reset role';
  v_ok := v_ok + 1;

  -- A3 ------------------------------------------------------- cheapest eligible
  r := app_private.route_choose('gpt-flare-image', '{"resolution": "1K", "aspect_ratio": "1:1"}', null, '{"outputs": 1}', '{"envSecrets": ["KIE_API_KEY"]}');
  if r ->> 'status' <> 'ok' or r -> 'chosen' ->> 'provider' <> 'nezhagate' or (r -> 'chosen' ->> 'effectiveUsd')::numeric <> 0.005 then raise exception 'A3 cheapest %', r -> 'chosen'; end if;
  if (select (c ->> 'effectiveUsd')::numeric from jsonb_array_elements(r -> 'candidates') c where c ->> 'provider' = 'kie') <> 0.03 then raise exception 'A3 KIE cost'; end if;
  -- the edit route of NezhaGate (not verified, no 'auto' ratio, max 8 references) is never chosen
  update app_private.provider_offers set status = 'eligible', routing_enabled = true where provider_account_id = nz and model_id = 'gpt-flare-edit';
  r := app_private.route_choose('gpt-flare-edit', '{"resolution": "1K", "aspect_ratio": "auto"}', null, '{"outputs": 1, "counts": {"_references": 1}}');
  if r -> 'chosen' ->> 'provider' <> 'kie' or (select c ->> 'excluded' from jsonb_array_elements(r -> 'candidates') c where c ->> 'provider' = 'nezhagate') not like 'Incompatible: aspect_ratio auto%' then
    raise exception 'A3 incompatible ratio %', r -> 'candidates';
  end if;
  r := app_private.route_choose('gpt-flare-edit', '{"resolution": "1K", "aspect_ratio": "1:1"}', null, '{"outputs": 1, "counts": {"_references": 9}}');
  if r -> 'chosen' ->> 'provider' <> 'kie' then raise exception 'A3 nine references went to an 8-reference route'; end if;
  r := app_private.route_choose('gpt-flare-edit', '{"resolution": "1K", "aspect_ratio": "1:1"}', null, '{"outputs": 1, "counts": {"_references": 8}}');
  if r -> 'chosen' ->> 'provider' <> 'nezhagate' then raise exception 'A3 compatible edit not routed %', r -> 'chosen'; end if;
  update app_private.provider_offers set status = 'capabilities_unverified', routing_enabled = false where provider_account_id = nz and model_id = 'gpt-flare-edit';
  -- a request setting the offer does not list makes it incompatible
  if app_private.offer_incompatibility('{"options": {"resolution": ["1K"]}}', '{"resolution": "1K", "seed": 3}', null, '{}') is null then
    raise exception 'A3 unknown setting accepted';
  end if;
  v_ok := v_ok + 1;

  -- A4 ------------------------------------------------------------- arithmetic
  if app_private.offer_native_cost('{"basis": "output_second", "dims": ["resolution"], "rates": {"720p": "0.856"}, "seconds": {"option": "duration"}}',
       '{"resolution": "720p", "duration": 10}', '{}') <> 8.56 then raise exception 'A4 per-second'; end if;
  if app_private.effective_usd(8.56, (app_private.cost_unit('apimart_credit')).units_per_usd, 0, 0) <> 0.856 then raise exception 'A4 APIMart credits'; end if;
  if app_private.effective_usd(0.10, (app_private.cost_unit('cny')).units_per_usd, 0, 0) <> 0.0149253731 then raise exception 'A4 CNY'; end if;
  if app_private.effective_usd(100, (app_private.cost_unit('duomi_point')).units_per_usd, 0, 0) <> 0.0149253731 then raise exception 'A4 points'; end if;
  if app_private.effective_usd(24, (app_private.cost_unit('kie_credit')).units_per_usd, 0, 0) <> 0.12 then raise exception 'A4 KIE credits'; end if;
  if app_private.effective_usd(0.0315, 1, 550, 0) <> 0.0332325 then raise exception 'A4 card fee'; end if;
  if app_private.effective_usd(1.1, 1, 0, 1000) <> 1 then raise exception 'A4 bonus divides (10 %% bonus = ÷ 1.10)'; end if;
  if app_private.effective_usd(1.1, 1, 550, 1000) <> 1.055 then raise exception 'A4 fee and bonus together'; end if;
  if app_private.offer_native_cost('{"basis": "output", "dims": ["resolution"], "rates": {"1K": "0.02925"}, "extraImages": {"slots": ["_references"], "free": 1, "rate": "0.00195"}}',
       '{"resolution": "1K"}', '{"outputs": 1, "counts": {"_references": 3}}') <> 0.03315 then raise exception 'A4 extra references'; end if;
  if app_private.offer_native_cost('{"basis": "output", "dims": ["resolution"], "rates": {"1K": "0.1371"}, "extraImages": {"slots": ["_references"], "free": 1, "rate": null}}',
       '{"resolution": "1K"}', '{"outputs": 1, "counts": {"_references": 2}}') is not null then raise exception 'A4 unknown surcharge became a price'; end if;
  if app_private.offer_native_cost('{"basis": "output", "dims": [], "rates": {"": "0.02"}}', '{}', '{"outputs": 4}') <> 0.08 then raise exception 'A4 batch'; end if;
  if app_private.offer_native_cost('{"basis": "output_second", "dims": [], "rates": {"": "0.1"}, "seconds": {"option": "duration"}, "minSeconds": 5, "roundSeconds": "ceil"}',
       '{"duration": 3.2}', '{}') <> 0.5 then raise exception 'A4 minimum seconds'; end if;
  if app_private.offer_native_cost('{"basis": "output", "dims": ["resolution"], "rates": {"1K": "0.02"}}', '{"resolution": "2K"}', '{}') is not null then
    raise exception 'A4 missing configuration priced';
  end if;
  v_ok := v_ok + 1;

  -- A5 / A6 / A10 fixtures: two test models, offers on routable accounts --------
  update app_private.provider_accounts set enabled = true, credential_version = 1, connection_state = 'ok' where id in (am, cu, py, dm, nz);
  insert into app_private.model_catalog (id, tool, public_name, purpose, provider_account_id, provider_model_id, adapter, state)
  values ('tst-ref', 'video', 'Test reference video', 'test fixture', kie, 'test/ref', 'kie-seedance-2-v2', 'disabled'),
         ('tst-pix', 'video', 'Test PixVerse', 'test fixture', kie, 'test/pix', 'kie-seedance-2-v2', 'disabled'),
         ('tst-dom', 'video', 'Test dominance', 'test fixture', kie, 'test/dom', 'kie-seedance-2-v2', 'disabled');
  insert into app_private.provider_offers (provider_account_id, model_id, product_key, product_label, tool, operation, upstream_model_id, adapter, capabilities, status, routing_enabled)
  values
    (am, 'tst-ref', 'tst/ref', 'ref', 'video', 'reference_to_video', 'seedance-2.0-fast', 'apimart-video',
      '{"options": {"resolution": ["720p"], "duration": [10]}, "modes": ["reference"], "inputs": {"reference_video": {"max": 1}}}', 'eligible', true),
    (nz, 'tst-ref', 'tst/ref', 'ref', 'video', 'reference_to_video', 'seedance-2.0-fast', 'nezhagate-video',
      '{"options": {"resolution": ["720p"], "duration": [10]}, "modes": ["reference"], "inputs": {"reference_video": {"max": 1}}}', 'eligible', true),
    (am, 'tst-pix', 'tst/pix', 'pix', 'video', 'text_to_video', 'pixverse-v6', 'apimart-video',
      '{"options": {"resolution": ["720p"], "audio": ["off"], "duration": [1, 5]}}', 'eligible', true),
    (cu, 'tst-pix', 'tst/pix', 'pix', 'video', 'text_to_video', 'pixverse-6', 'cuddler-video',
      '{"options": {"resolution": ["720p"], "audio": ["off"], "duration": [1, 5]}}', 'eligible', true);
  insert into app_private.provider_offer_prices (offer_id, version, unit, schedule, confidence, source_kind, checked_at)
  select f.id, 1, v.unit, v.sched::jsonb, 'documented', 'research', now()
  from app_private.provider_offers f join (values
    (am, 'tst-ref', 'apimart_credit', '{"basis": "io_second", "dims": ["resolution"], "rates": {"720p": "0.5128"}, "seconds": {"option": "duration"}, "inputSeconds": {"slots": ["reference_video"]}}'),
    (nz, 'tst-ref', 'usd', '{"basis": "output_second", "dims": ["resolution"], "rates": {"720p": "0.075"}, "seconds": {"option": "duration"}}'),
    (am, 'tst-pix', 'apimart_credit', '{"basis": "output_second", "dims": ["resolution", "audio"], "rates": {"720p|off": "0.32"}, "seconds": {"option": "duration"}}'),
    (cu, 'tst-pix', 'usd', '{"basis": "output_second", "dims": ["resolution", "audio"], "rates": {"720p|off": "0.0315"}, "seconds": {"option": "duration"}}')
  ) v(acc, model, unit, sched) on f.provider_account_id = v.acc and f.model_id = v.model;

  -- A5
  r := app_private.route_choose('tst-ref', '{"resolution": "720p", "duration": 10}', 'reference', '{"counts": {"reference_video": 1}, "seconds": {"reference_video": 3}}');
  if r -> 'chosen' ->> 'provider' <> 'apimart' or (r -> 'chosen' ->> 'effectiveUsd')::numeric <> 0.66664 then raise exception 'A5 3 s %', r -> 'chosen'; end if;
  r := app_private.route_choose('tst-ref', '{"resolution": "720p", "duration": 10}', 'reference', '{"counts": {"reference_video": 1}, "seconds": {"reference_video": 10}}');
  if r -> 'chosen' ->> 'provider' <> 'nezhagate' or (r -> 'chosen' ->> 'effectiveUsd')::numeric <> 0.75
     or (select (c ->> 'effectiveUsd')::numeric from jsonb_array_elements(r -> 'candidates') c where c ->> 'provider' = 'apimart') <> 1.0256 then
    raise exception 'A5 10 s %', r -> 'candidates';
  end if;
  v_ok := v_ok + 1;

  -- A6 (Cuddler funds by card: 550 bps)
  r := app_private.route_choose('tst-pix', '{"resolution": "720p", "audio": "off", "duration": 1}', null, '{}');
  if r -> 'chosen' ->> 'provider' <> 'apimart' or (select (c ->> 'effectiveUsd')::numeric from jsonb_array_elements(r -> 'candidates') c where c ->> 'provider' = 'cuddler') <> 0.0332325 then
    raise exception 'A6 with the fee %', r -> 'candidates';
  end if;
  update app_private.provider_accounts set funding_fee_bps = 0 where id = cu;
  r := app_private.route_choose('tst-pix', '{"resolution": "720p", "audio": "off", "duration": 1}', null, '{}');
  if r -> 'chosen' ->> 'provider' <> 'cuddler' then raise exception 'A6 nominal ordering %', r -> 'chosen'; end if;
  update app_private.provider_accounts set funding_fee_bps = 550 where id = cu;
  -- the seeded inventory shows the same reversal
  if (select decision from app_private.provider_offers where provider_account_id = cu and product_key = 'pixverse-v6') <> 'dominated' then raise exception 'A6 inventory'; end if;
  v_ok := v_ok + 1;


  -- A10: PoYo wins only 720p, NezhaGate only 480p, Duomi never (and nothing else of Duomi wins)
  insert into app_private.model_capability_versions (model_id, version, spec)
  values ('tst-dom', 1, '{"options": {"resolution": {"values": ["480p", "720p"], "default": "720p"}, "duration": {"values": [5], "default": 5}}, "output": {"kind": "video", "count": 1}}');
  insert into app_private.provider_offers (provider_account_id, model_id, product_key, product_label, tool, operation, upstream_model_id, adapter, capabilities, status, routing_enabled)
  values
    (py, 'tst-dom', 'tst/dom', 'dom', 'video', 'text_to_video', 'x', 'poyo-kling-motion', '{"options": {"resolution": ["480p", "720p"], "duration": [5]}}', 'eligible', true),
    (nz, 'tst-dom', 'tst/dom', 'dom', 'video', 'text_to_video', 'x', 'nezhagate-video', '{"options": {"resolution": ["480p", "720p"], "duration": [5]}}', 'eligible', true),
    (dm, 'tst-dom', 'tst/dom', 'dom', 'video', 'text_to_video', 'x', 'duomi-nano-banana', '{"options": {"resolution": ["480p", "720p"], "duration": [5]}}', 'eligible', true);
  select id into o1 from app_private.provider_offers where provider_account_id = py and model_id = 'tst-dom';
  select id into o2 from app_private.provider_offers where provider_account_id = nz and model_id = 'tst-dom';
  select id into o3 from app_private.provider_offers where provider_account_id = dm and model_id = 'tst-dom';
  insert into app_private.provider_offer_prices (offer_id, version, unit, schedule, confidence, source_kind, checked_at) values
    (o1, 1, 'usd', '{"basis": "output_second", "dims": ["resolution"], "rates": {"480p": "0.03", "720p": "0.01"}, "seconds": {"option": "duration"}}', 'documented', 'research', now()),
    (o2, 1, 'usd', '{"basis": "output_second", "dims": ["resolution"], "rates": {"480p": "0.01", "720p": "0.05"}, "seconds": {"option": "duration"}}', 'documented', 'research', now()),
    (o3, 1, 'usd', '{"basis": "output_second", "dims": ["resolution"], "rates": {"480p": "0.02", "720p": "0.06"}, "seconds": {"option": "duration"}}', 'documented', 'research', now());
  update app_private.provider_offers set status = 'unavailable'
  where provider_account_id in (py, dm) and model_id is not null and id not in (o1, o3);
  perform pg_temp.t_as(own);
  r := public.admin_routing_review(false);
  if (select p ->> 'proposedDecision' from jsonb_array_elements(r -> 'proposals') p where (p ->> 'offerId')::uuid = o1) <> 'eligible'
     or (select p ->> 'proposedDecision' from jsonb_array_elements(r -> 'proposals') p where (p ->> 'offerId')::uuid = o2) <> 'eligible'
     or (select p ->> 'proposedDecision' from jsonb_array_elements(r -> 'proposals') p where (p ->> 'offerId')::uuid = o3) <> 'dominated' then
    raise exception 'A10 proposals %', (select jsonb_agg(p) from jsonb_array_elements(r -> 'proposals') p where (p ->> 'modelId') = 'tst-dom');
  end if;
  if (select (p ->> 'winningOffers')::int from jsonb_array_elements(r -> 'providers') p where p ->> 'provider' = 'poyo') <> 1
     or not (select (p ->> 'activeAfterApply')::boolean from jsonb_array_elements(r -> 'providers') p where p ->> 'provider' = 'poyo')
     or (select (p ->> 'winningOffers')::int from jsonb_array_elements(r -> 'providers') p where p ->> 'provider' = 'duomi') <> 0
     or (select (p ->> 'activeAfterApply')::boolean from jsonb_array_elements(r -> 'providers') p where p ->> 'provider' = 'duomi') then
    raise exception 'A10 providers %', r -> 'providers';
  end if;
  begin
    perform public.admin_routing_review(true, 'not-the-preview-revision-0000000', '{}');
    raise exception 'A10 applied without the preview revision';
  exception when others then if sqlerrm <> 'REVIEW_CHANGED' then raise; end if; end;
  r := public.admin_routing_review(true, r ->> 'revision', '{}');
  execute 'reset role';
  if (select routing_enabled from app_private.provider_offers where id = o3) or not (select routing_enabled from app_private.provider_offers where id = o1)
     or (select decision from app_private.provider_offers where id = o3) <> 'dominated' then
    raise exception 'A10 apply';
  end if;
  r := app_private.route_choose('tst-dom', '{"resolution": "720p", "duration": 5}', null, '{}');
  if r -> 'chosen' ->> 'provider' <> 'poyo' then raise exception 'A10 720p route %', r -> 'chosen'; end if;
  r := app_private.route_choose('tst-dom', '{"resolution": "480p", "duration": 5}', null, '{}');
  if r -> 'chosen' ->> 'provider' <> 'nezhagate' then raise exception 'A10 480p route %', r -> 'chosen'; end if;
  update app_private.provider_offers set status = 'capabilities_unverified' where status = 'unavailable' and provider_account_id in (py, dm);
  update app_private.provider_accounts set enabled = false, credential_version = 0, connection_state = 'untested' where id in (am, cu, py, dm);
  update app_private.provider_accounts set connection_state = 'ok' where id = nz;
  v_ok := v_ok + 1;

  -- A7 / A8 / A9 / A12 / A14 pipeline -------------------------------------------
  perform pg_temp.t_as(cust);
  q := public.create_generation_quote('gpt-flare-image', 'A ceramic lamp on a desk, editorial photo', '{"aspect_ratio": "1:1"}', '{}');
  r := public.create_generation((q ->> 'quoteId')::uuid, 'key-mp-0001');
  job1 := (r -> 'job' ->> 'id')::uuid;
  execute 'reset role';
  w := pg_temp.t_claim(job1, 'job_submit');
  v_item := (w ->> 'workItemId')::uuid; v_lease := (w ->> 'leaseToken')::uuid;
  r := public.worker_begin_submission_v2(v_item, v_lease, '{"envSecrets": ["KIE_API_KEY"]}');
  if r ->> 'action' <> 'submit' or r -> 'route' ->> 'provider' <> 'nezhagate' or (r -> 'route' ->> 'credentialVersion')::int <> 1
     or (r -> 'route' -> 'estimate' ->> 'effectiveUsd')::numeric <> 0.005 or r -> 'route' ? 'secret' or r::text like '%SECRET%' then
    raise exception 'A12 route %', r -> 'route';
  end if;
  v_att := (r ->> 'attemptId')::uuid;
  if (select state from app_private.provider_cost_ledger where attempt_id = v_att) <> 'reserved' then raise exception 'A14 ledger not reserved'; end if;
  -- A7: a duplicated submit item cannot create a second attempt, reservation or ledger row
  perform app_private.enqueue_work('genlixs_control', 'job_submit', job1, 'submit:' || job1 || ':dup', now(), '{}'::jsonb);
  w := pg_temp.t_claim(job1, 'job_submit');
  r := public.worker_begin_submission_v2((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid, '{"envSecrets": ["KIE_API_KEY"]}');
  if r ->> 'action' <> 'skip' then raise exception 'A7 duplicate submit %', r; end if;
  r := public.worker_record_submission(v_item, v_lease, v_att, '{"kind": "accepted", "taskId": "img_nz_task_0001"}');
  if r ->> 'action' <> 'check_scheduled' then raise exception 'A7 accept %', r; end if;
  begin
    perform public.worker_record_submission(v_item, v_lease, v_att, '{"kind": "accepted", "taskId": "img_nz_task_0001"}');
    raise exception 'A7 recorded twice';
  exception when others then if sqlerrm not in ('STALE_LEASE', 'LEASE_LOST', 'NOT_FOUND') then raise exception 'A7 second record: %', sqlerrm; end if; end;
  if (select count(*) from app_private.provider_attempts where job_id = job1) <> 1
     or (select count(*) from app_private.provider_cost_ledger where job_id = job1) <> 1
     or (select reserved_units from public.wallet_accounts where user_id = cust) <> 4
     or (select state from app_private.provider_cost_ledger where attempt_id = v_att) <> 'pending_confirmation' then
    raise exception 'A7 one attempt, one reservation, one ledger row';
  end if;
  v_ok := v_ok + 1;

  -- A12: Admin switches the offer and the provider off and rotates the key; the job keeps its route and key version
  perform pg_temp.t_as(own);
  perform public.admin_update_offer(nz_flare, '{"routingEnabled": false}');
  perform public.admin_update_provider_account(nz, '{"enabled": false}');
  r := public.admin_set_provider_key(nz, 'nz-SECRET-value-0002');
  execute 'reset role';
  if (r ->> 'keyVersion')::int <> 2 then raise exception 'A12 rotation %', r; end if;
  -- The review had switched the dominated KIE route off; with NezhaGate off the owner reviews again and switches it back on.
  if (select routing_enabled from app_private.provider_offers where model_id = 'gpt-flare-image' and is_legacy_primary) then
    raise exception 'A10 the dominated original route stayed on';
  end if;
  perform pg_temp.t_as(own);
  r := public.admin_routing_review(false);
  r := public.admin_routing_review(true, r ->> 'revision', (select array_agg((p ->> 'offerId')::uuid) from jsonb_array_elements(r -> 'proposals') p
    where (p ->> 'canActivate')::boolean and p ->> 'provider' = 'kie'));
  execute 'reset role';
  if not (select routing_enabled from app_private.provider_offers where model_id = 'gpt-flare-image' and is_legacy_primary) then
    raise exception 'A12 original route not reactivated %', r;
  end if;
  w := pg_temp.t_claim(job1, 'job_check');
  r := public.worker_attempt_route((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid);
  if r ->> 'provider' <> 'nezhagate' or (r ->> 'credentialVersion')::int <> 1 or (r ->> 'offerId')::uuid <> nz_flare or r ->> 'taskId' <> 'img_nz_task_0001' then
    raise exception 'A12 pinned route %', r;
  end if;
  if (select secret_id from app_private.provider_credentials where provider_account_id = nz and version = 1) is null then
    raise exception 'A12 the in-flight key version was purged';
  end if;
  perform pg_temp.t_service();
  if public.worker_provider_credential(nz, 1) ->> 'secret' <> 'nz-SECRET-value-0001' then raise exception 'A12 old version unreadable'; end if;
  execute 'reset role';
  -- A9: the result is seen, the download fails and is retried without a new submission
  r := public.worker_record_observation((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid,
    '{"taskId": "img_nz_task_0001", "providerState": "succeeded", "normalized": "success", "resultUrls": ["https://img.nezhagate.com/i/a.png"], "source": "poll"}');
  if r ->> 'action' <> 'import_scheduled' then raise exception 'A9 observation %', r; end if;
  w := pg_temp.t_claim(job1, 'job_import');
  r := public.worker_import_failed((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid, 'download failed', true);
  if r ->> 'action' <> 'retry' or (select state from public.generation_jobs where id = job1) <> 'importing'
     or (select count(*) from app_private.provider_attempts where job_id = job1) <> 1
     or exists (select 1 from app_private.job_work_items where ref_id = job1 and kind = 'job_submit' and state = 'pending')
     or not exists (select 1 from app_private.job_work_items where ref_id = job1 and kind = 'job_import' and state = 'pending') then
    raise exception 'A9 import retry %', r;
  end if;
  -- once the job is finished, the retired key version is deleted from Vault
  update public.generation_jobs set state = 'succeeded' where id = job1;
  v_n := app_private.purge_retired_credentials(nz);
  if v_n <> 1
     or (select secret_id from app_private.provider_credentials where provider_account_id = nz and version = 1) is not null
     or exists (select 1 from vault.secrets where secret = 'nz-SECRET-value-0001') then
    raise exception 'A12 purge after completion: purged %, job %, creds %', v_n, (select state from public.generation_jobs where id = job1), (select jsonb_agg(to_jsonb(c)) from app_private.provider_credentials c where provider_account_id = nz);
  end if;
  v_ok := v_ok + 1;

  -- A8: an ambiguous submit is verified, never resent (NezhaGate is off now: the original KIE route takes the job)
  perform pg_temp.t_as(cust);
  q := public.create_generation_quote('gpt-flare-image', 'A second lamp on a desk, editorial photo', '{"aspect_ratio": "1:1"}', '{}');
  job2 := ((public.create_generation((q ->> 'quoteId')::uuid, 'key-mp-0002')) -> 'job' ->> 'id')::uuid;
  q := public.create_generation_quote('gpt-flare-image', 'A third lamp on a desk, editorial photo', '{"aspect_ratio": "1:1"}', '{}');
  job3 := ((public.create_generation((q ->> 'quoteId')::uuid, 'key-mp-0003')) -> 'job' ->> 'id')::uuid;
  execute 'reset role';
  w := pg_temp.t_claim(job2, 'job_submit');
  v_item := (w ->> 'workItemId')::uuid; v_lease := (w ->> 'leaseToken')::uuid;
  r := public.worker_begin_submission_v2(v_item, v_lease, '{"envSecrets": ["KIE_API_KEY"]}');
  if r -> 'route' ->> 'provider' <> 'kie' or not (r -> 'route' ->> 'legacy')::boolean or r -> 'route' ->> 'adapter' <> 'kie-market-image' then
    raise exception 'A8 route %', r -> 'route';
  end if;
  r := public.worker_record_submission(v_item, v_lease, (r ->> 'attemptId')::uuid, '{"kind": "unknown", "code": "TIMEOUT", "message": "create timed out"}');
  if r ->> 'action' <> 'unknown' or (select state from public.generation_jobs where id = job2) <> 'submission_unknown'
     or exists (select 1 from app_private.job_work_items where ref_id = job2 and kind = 'job_submit' and state = 'pending')
     or (select state from app_private.provider_cost_ledger where job_id = job2) <> 'submission_unknown' then
    raise exception 'A8 unknown submission %', r;
  end if;
  -- without the KIE key in this deployment the original route is not used either
  w := pg_temp.t_claim(job3, 'job_submit');
  r := public.worker_begin_submission_v2((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid, '{"envSecrets": []}');
  if r ->> 'action' <> 'deferred' or r ->> 'reason' <> 'no_route' then raise exception 'A8 no key %', r; end if;
  v_ok := v_ok + 1;

  -- job3 through KIE with a reported charge; job4 through the pre-routing submit function
  w := pg_temp.t_claim(job3, 'job_submit');
  v_item := (w ->> 'workItemId')::uuid; v_lease := (w ->> 'leaseToken')::uuid;
  r := public.worker_begin_submission_v2(v_item, v_lease, '{"envSecrets": ["KIE_API_KEY"]}');
  r := public.worker_record_submission(v_item, v_lease, (r ->> 'attemptId')::uuid, '{"kind": "accepted", "taskId": "kie_task_mp_0003"}');
  w := pg_temp.t_claim(job3, 'job_check');
  r := public.worker_record_observation((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid,
    '{"taskId": "kie_task_mp_0003", "providerState": "success", "normalized": "success", "resultUrls": ["https://tempfile.aiquickdraw.com/a.png"], "creditsConsumed": "6", "source": "poll"}');
  if (select state || ':' || confirmed_native || ':' || confirmed_effective_usd from app_private.provider_cost_ledger where job_id = job3) <> 'confirmed:6:0.0300000000' then
    raise exception 'A14 confirmation %', (select to_jsonb(l) from app_private.provider_cost_ledger l where job_id = job3);
  end if;
  perform pg_temp.t_as(cust);
  q := public.create_generation_quote('gpt-flare-image', 'A fourth lamp on a desk, editorial photo', '{"aspect_ratio": "1:1"}', '{}');
  job4 := ((public.create_generation((q ->> 'quoteId')::uuid, 'key-mp-0004')) -> 'job' ->> 'id')::uuid;
  execute 'reset role';
  w := pg_temp.t_claim(job4, 'job_submit');
  r := public.worker_begin_submission((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid);
  r := public.worker_record_submission((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid, (r ->> 'attemptId')::uuid, '{"kind": "accepted", "taskId": "kie_task_mp_0004"}');
  w := pg_temp.t_claim(job4, 'job_check');
  r := public.worker_attempt_route((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid);
  if r ->> 'provider' <> 'kie' or not (r ->> 'legacy')::boolean or r ->> 'adapter' <> 'kie-market-image' or (r ->> 'credentialVersion')::int <> 0 then
    raise exception 'A12 pre-routing attempt %', r;
  end if;
  v_ok := v_ok + 1;

  -- A14: usage totals
  perform pg_temp.t_as(ops);
  r := public.admin_provider_usage('{}');
  execute 'reset role';
  x := r -> 'totals';
  if (x ->> 'entries')::int <> 3 or (x ->> 'confirmedUsd')::numeric <> 0.03 or (x ->> 'estimatedAwaitingUsd')::numeric <> 0.005
     or (x ->> 'pendingUsd')::numeric <> 0.03 or (x ->> 'unknownCost')::int <> 0 then
    raise exception 'A14 totals %', x;
  end if;
  if (select sum(coalesce(confirmed_effective_usd, estimated_effective_usd)) from app_private.provider_cost_ledger)
     <> (x ->> 'confirmedUsd')::numeric + (x ->> 'estimatedAwaitingUsd')::numeric + (x ->> 'pendingUsd')::numeric then
    raise exception 'A14 totals do not add up';
  end if;
  if r::text like '%SECRET%' or r::text like '%lamp%' then raise exception 'A14 usage leaks keys or prompts'; end if;
  v_ok := v_ok + 1;

  -- A11: balances ------------------------------------------------------------
  perform pg_temp.t_service();
  perform public.record_provider_check(nz, '{"ok": true, "total": "12.5", "unit": "usd", "scope": "wallet", "source": "admin", "connection": true}');
  perform public.record_provider_check(nz, '{"ok": false, "error": "HTTP_503", "state": "failed", "source": "auto"}');
  perform public.record_provider_check(am, '{"ok": true, "total": null, "unlimited": true, "unit": "apimart_credit", "scope": "key", "source": "admin"}');
  r := public.record_provider_check(cu, '{"ok": true, "source": "admin"}');
  perform public.record_provider_check(py, '{"ok": false, "state": "unsupported", "error": "NO_BALANCE_ENDPOINT", "connection": true}');
  execute 'reset role';
  if (select last_balance from app_private.provider_accounts where id = nz) <> 12.5 or (select last_balance_error from app_private.provider_accounts where id = nz) <> 'HTTP_503'
     or (select connection_state from app_private.provider_accounts where id = nz) <> 'ok' then
    raise exception 'A11 failed read replaced the value';
  end if;
  if (select last_balance is not null or not key_quota_unlimited or balance_scope <> 'key' from app_private.provider_accounts where id = am) then raise exception 'A11 unlimited key'; end if;
  if (r ->> 'ok')::boolean or (select last_balance_error from app_private.provider_accounts where id = cu) <> 'MALFORMED_BALANCE' then raise exception 'A11 malformed reply %', r; end if;
  if (select connection_state from app_private.provider_accounts where id = py) <> 'unsupported'
     or exists (select 1 from app_private.provider_balance_snapshots where provider_account_id = py) then raise exception 'A11 unsupported'; end if;
  perform pg_temp.t_as(own);
  r := public.admin_record_manual_balance(dm, '5000', 'duomi_point', now() - interval '1 hour', 'Duomi dashboard');
  execute 'reset role';
  if r -> 'balance' ->> 'source' <> 'manual' or (r -> 'balance' ->> 'total')::numeric <> 5000 or (r -> 'balance' ->> 'usdApprox')::numeric <> 0.75 then
    raise exception 'A11 manual %', r -> 'balance';
  end if;
  update app_private.provider_accounts set last_balance_at = now() - interval '3 hours' where id = nz;
  update app_private.provider_accounts set wallet_group = 'shared-test' where id in (nz, am);
  perform pg_temp.t_as(ops);
  r := public.admin_providers_overview();
  execute 'reset role';
  if not (select (a -> 'balance' ->> 'stale')::boolean from jsonb_array_elements(r -> 'accounts') a where a ->> 'provider' = 'nezhagate')
     or (select a -> 'balance' -> 'total' from jsonb_array_elements(r -> 'accounts') a where a ->> 'provider' = 'kie') <> 'null'::jsonb
     or (select count(*) from jsonb_array_elements(r -> 'accounts') a where a ->> 'walletGroup' = 'shared-test') <> 2 then
    raise exception 'A11 overview balances';
  end if;
  v_ok := v_ok + 1;

  -- A13: public catalog ---------------------------------------------------------
  r := public.get_catalog();
  if (select count(*) from jsonb_array_elements(r -> 'models')) <> 3
     or (select count(distinct m ->> 'id') from jsonb_array_elements(r -> 'models') m) <> 3
     or exists (select 1 from jsonb_array_elements(r -> 'models') m where m ->> 'id' like 'tst-%') then
    raise exception 'A13 one card per public model';
  end if;
  if (select m -> 'options' -> 'resolution' -> 'values' from jsonb_array_elements(r -> 'models') m where m ->> 'id' = 'gpt-sunburst-image') <> '["1K", "2K", "4K"]'::jsonb then
    raise exception 'A13 original route options';
  end if;
  -- only the 1K-only NezhaGate route serves Sunburst: customers see 1K only, and a 2K quote is refused unpriced
  update app_private.provider_accounts set enabled = true where id = nz;
  update app_private.provider_offers set routing_enabled = false where model_id = 'gpt-sunburst-image' and is_legacy_primary;
  update app_private.provider_offers set status = 'eligible', routing_enabled = true where provider_account_id = nz and model_id = 'gpt-sunburst-image';
  r := public.get_catalog();
  if (select m -> 'options' -> 'resolution' -> 'values' from jsonb_array_elements(r -> 'models') m where m ->> 'id' = 'gpt-sunburst-image') <> '["1K"]'::jsonb
     or (select m -> 'options' -> 'resolution' ->> 'default' from jsonb_array_elements(r -> 'models') m where m ->> 'id' = 'gpt-sunburst-image') <> '1K' then
    raise exception 'A13 narrowed options %', (select m -> 'options' from jsonb_array_elements(r -> 'models') m where m ->> 'id' = 'gpt-sunburst-image');
  end if;
  perform pg_temp.t_as(cust);
  q := public.create_generation_quote('gpt-sunburst-image', 'A lamp in the morning light, editorial photo', '{"aspect_ratio": "1:1", "resolution": "1K"}', '{}');
  begin
    perform public.create_generation_quote('gpt-sunburst-image', 'A lamp in the morning light, editorial photo', '{"aspect_ratio": "1:1", "resolution": "2K"}', '{}');
    raise exception 'A13 unfulfillable setting quoted';
  exception when others then if sqlerrm <> 'MODEL_UNAVAILABLE' then raise; end if; end;
  execute 'reset role';
  -- customers never see suppliers or routing in a quote
  if q::text ~* 'nezha|kie|offer|provider' then raise exception 'A13 quote exposes routing %', q; end if;
  v_ok := v_ok + 1;

  raise exception 'PASS: % multi-provider test groups', v_ok;
end;
$$;
