-- Admin catalog upgrade: permissions, configuration costs and bulk markup math, credit economy and commission
-- scenarios, pricing batches (immutability, stale previews, all-or-nothing), quotes/jobs across price changes,
-- availability end to end, private staff tests (no wallet, no duplicates, evidence), provider balance and costs.
-- Rolled back by the final exception. Run 00_helpers.sql first in the same session.
do $$
declare
  owner_u uuid := pg_temp.t_user('t-own-' || gen_random_uuid() || '@genlixs.test');
  fin uuid := pg_temp.t_user('t-fin-' || gen_random_uuid() || '@genlixs.test');
  ops uuid := pg_temp.t_user('t-ops-' || gen_random_uuid() || '@genlixs.test');
  sup uuid := pg_temp.t_user('t-sup-' || gen_random_uuid() || '@genlixs.test');
  cust uuid := pg_temp.t_user('t-cus-' || gen_random_uuid() || '@genlixs.test');
  p jsonb; p2 jsonb; r jsonb; q jsonb; q2 jsonb; w jsonb; m jsonb; v_row jsonb;
  v_ok int := 0; v_n int; v_n2 int; v_job uuid; v_job2 uuid; v_id uuid; v_txt text; v_num numeric;
  wal record;
begin
  insert into app_private.staff_memberships (user_id, role) values (owner_u, 'owner'), (fin, 'finance'), (ops, 'operations'), (sup, 'support');
  -- Isolate from any real catalog state: start from disabled models without published prices.
  update app_private.price_versions set state = 'retired' where state in ('published', 'draft');
  update app_private.model_catalog set state = 'disabled', verification_status = 'untested', verified_capability_version_id = null;
  update app_private.settings set value = '100' where key = 'max_quotes_per_minute';

  -- C1 permissions: customers, support and partners cannot read costs/balance or change the catalog
  perform pg_temp.t_as(cust);
  begin perform public.admin_pricing_preview('all', null, 300, false); raise exception 'C1 customer preview';
  exception when others then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  begin perform public.admin_provider_summary(); raise exception 'C1 customer balance';
  exception when others then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  begin perform public.admin_catalog(); raise exception 'C1 customer catalog';
  exception when others then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  begin perform public.admin_set_model_availability('gpt-flare-image', 'enabled'); raise exception 'C1 customer enable';
  exception when others then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  begin perform public.admin_create_model_test('gpt-flare-image', 'A test prompt', '{}', '{}', 'test-key-0000', true); raise exception 'C1 customer test';
  exception when others then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  begin perform public.admin_begin_balance_refresh(); raise exception 'C1 customer refresh';
  exception when others then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  begin perform public.admin_save_supplier_cost('gpt-flare-image', '{"1K": 1, "2K": 1, "4K": 1}', 'manual', null, now(), null); raise exception 'C1 customer cost';
  exception when others then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  begin perform 1 from app_private.supplier_cost_versions limit 1; raise exception 'C1 customer reads costs';
  exception when insufficient_privilege then null; end;
  if public.get_catalog()::text ~ '(supplier|usdPerCredit|provider_model|creditsConsumed)' then raise exception 'C1 public catalog leaks supplier data'; end if;
  execute 'reset role';
  perform pg_temp.t_as(sup);
  begin perform public.admin_provider_summary(); raise exception 'C1 support balance';
  exception when others then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  r := public.admin_catalog();
  if (r -> 'access' ->> 'canSeeCosts')::boolean or (r -> 'models' -> 0 -> 'cost') <> 'null'::jsonb or r -> 'economics' <> 'null'::jsonb then
    raise exception 'C1 support sees costs'; end if;
  execute 'reset role';
  perform pg_temp.t_as(fin);
  begin perform public.admin_pricing_apply('all', null, 300, false, 'x', 'publish', array['gpt-flare-image']); raise exception 'C1 finance publish';
  exception when others then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  execute 'reset role';
  v_ok := v_ok + 1;

  -- C2 configuration costs, markup math, credit conversion (lowest revenue per credit), commission scenarios
  perform pg_temp.t_as(fin);
  p := public.admin_pricing_preview('all', null, 300, false);
  execute 'reset role';
  -- Conservative basis = lowest package revenue per credit among the applicable packages.
  v_num := (select min((x ->> 'revenuePerCredit')::numeric) from jsonb_array_elements(p -> 'basis' -> 'products') x);
  if (p -> 'basis' ->> 'minRevenuePerCredit')::numeric <> v_num then raise exception 'C2 basis is not the lowest %', p -> 'basis'; end if;
  -- Every configuration: proposed = max(1, ceil(cost USD x 4 / rpc)); never a single "from" price.
  for m in select value from jsonb_array_elements(p -> 'models') loop
    if m ->> 'status' <> 'ok' then raise exception 'C2 % status %', m ->> 'modelId', m ->> 'status'; end if;
    for v_row in select value from jsonb_array_elements(m -> 'configs') loop
      if (v_row ->> 'proposedUnits')::bigint <> greatest(ceil(round(round((v_row ->> 'supplierUsd')::numeric * 4, 8) / v_num, 12)), 1) then
        raise exception 'C2 % % proposed %', m ->> 'modelId', v_row ->> 'key', v_row; end if;
      if (v_row ->> 'supplierUsd')::numeric <> round((v_row ->> 'supplierCredits')::numeric * 0.005, 8) then
        raise exception 'C2 % % usd conversion', m ->> 'modelId', v_row ->> 'key'; end if;
    end loop;
  end loop;
  select x into m from jsonb_array_elements(p -> 'models') x where x ->> 'modelId' = 'kling-3-0';
  -- Kling: per second x duration, audio changes the rate (20 vs 14 credits/s at 720p), 4K identical.
  select x into v_row from jsonb_array_elements(m -> 'configs') x where x ->> 'key' = '720p|on|10';
  if (v_row ->> 'supplierCredits')::numeric <> 200 then raise exception 'C2 kling 720p audio 10s %', v_row; end if;
  select x into v_row from jsonb_array_elements(m -> 'configs') x where x ->> 'key' = '720p|off|10';
  if (v_row ->> 'supplierCredits')::numeric <> 140 then raise exception 'C2 kling silent %', v_row; end if;
  if (m ->> 'configCount')::int <> 18 then raise exception 'C2 kling configs %', m ->> 'configCount'; end if;
  -- Veo 1080p includes the upgrade once; Wan priced per duration; Seedream fractional credits.
  select x into m from jsonb_array_elements(p -> 'models') x where x ->> 'modelId' = 'veo-3-1';
  select x into v_row from jsonb_array_elements(m -> 'configs') x where x ->> 'key' = '1080p';
  if (v_row ->> 'supplierCredits')::numeric <> 65 then raise exception 'C2 veo 1080p %', v_row; end if;
  select x into m from jsonb_array_elements(p -> 'models') x where x ->> 'modelId' = 'seedream-5-flash-image';
  select x into v_row from jsonb_array_elements(m -> 'configs') x where x ->> 'key' = '1K';
  if (v_row ->> 'supplierUsd')::numeric <> 0.0162 then raise exception 'C2 seedream usd %', v_row; end if;
  -- Flare 1K at +300 %: $0.03 -> $0.12 target -> ceil(0.12 / rpc); contribution per scenario.
  select x into m from jsonb_array_elements(p -> 'models') x where x ->> 'modelId' = 'gpt-flare-image';
  select x into v_row from jsonb_array_elements(m -> 'configs') x where x ->> 'key' = '1K';
  if (v_row ->> 'targetUsd')::numeric <> 0.12 then raise exception 'C2 flare target %', v_row; end if;
  v_num := (v_row ->> 'proposedUnits')::numeric * (p -> 'basis' ->> 'minRevenuePerCredit')::numeric;
  if (v_row -> 'contribution' ->> 'revenueUsd')::numeric <> round(v_num, 6)
     or (v_row -> 'contribution' ->> 'direct')::numeric <> round(v_num - 0.03, 6)
     or (v_row -> 'contribution' ->> 'affiliateBase')::numeric <> round(v_num * 0.7 - 0.03, 6)
     or (v_row -> 'contribution' ->> 'affiliateUplift')::numeric <> round(v_num * 0.5 - 0.03, 6) then
    raise exception 'C2 contribution %', v_row -> 'contribution'; end if;
  if jsonb_array_length(v_row -> 'contribution' -> 'excludes') <> 3 then raise exception 'C2 unknown costs not flagged'; end if;
  -- +0 % still never sells below cost at the lowest package rate; +50 % commission can make it a loss (flagged).
  perform pg_temp.t_as(fin);
  p2 := public.admin_pricing_preview('selected', array['gpt-flare-image'], 0, false);
  execute 'reset role';
  if (p2 -> 'models' -> 0 -> 'summary' ->> 'lossConfigsDirect')::int <> 0 then raise exception 'C2 zero markup direct loss'; end if;
  if (p2 -> 'models' -> 0 -> 'summary' ->> 'lossConfigsUplift')::int = 0 then raise exception 'C2 50 %% loss not flagged at 0 %% markup'; end if;
  -- markup validation and revision stability
  perform pg_temp.t_as(fin);
  begin perform public.admin_pricing_preview('all', null, -1, false); raise exception 'C2 negative markup';
  exception when others then if sqlerrm <> 'INVALID_MARKUP' then raise; end if; end;
  begin perform public.admin_pricing_preview('all', null, 12.345, false); raise exception 'C2 3 decimals';
  exception when others then if sqlerrm <> 'INVALID_MARKUP' then raise; end if; end;
  if (public.admin_pricing_preview('all', null, 300, false) ->> 'revision') <> p ->> 'revision' then raise exception 'C2 revision unstable'; end if;
  if (public.admin_pricing_preview('all', null, 301, false) ->> 'revision') = p ->> 'revision' then raise exception 'C2 revision ignores markup'; end if;
  execute 'reset role';
  v_ok := v_ok + 1;

  -- C3 batches: drafts, stale preview refused, all-or-nothing, publish, immutable history, restore
  perform pg_temp.t_as(fin);
  r := public.admin_pricing_apply('all', null, 300, false, p ->> 'revision', 'draft', array['gpt-flare-image', 'veo-3-1']);
  if jsonb_array_length(r -> 'items') <> 2 then raise exception 'C3 draft batch %', r; end if;
  execute 'reset role';
  if (select count(*) from app_private.price_versions where model_id in ('gpt-flare-image', 'veo-3-1') and state = 'draft' and source = 'bulk') <> 2 then
    raise exception 'C3 drafts not created'; end if;
  perform pg_temp.t_as(owner_u);
  begin perform public.admin_pricing_apply('all', null, 300, false, p ->> 'revision', 'publish', array['gpt-flare-image']); raise exception 'C3 stale preview applied';
  exception when others then if sqlerrm <> 'PREVIEW_STALE' then raise; end if; end;
  p := public.admin_pricing_preview('all', null, 300, false);
  -- a manual override is protected unless explicitly included; selecting it fails the whole batch
  perform public.admin_save_price_draft('wan-2-6', '{"720p|5": 50, "720p|10": 90, "720p|15": 130, "1080p|5": 70, "1080p|10": 130, "1080p|15": 190}');
  p := public.admin_pricing_preview('all', null, 300, false);
  select x into m from jsonb_array_elements(p -> 'models') x where x ->> 'modelId' = 'wan-2-6';
  if m ->> 'status' <> 'manual_override' or (m ->> 'selectable')::boolean then raise exception 'C3 override not protected %', m ->> 'status'; end if;
  if (p -> 'models' -> 0 ->> 'modelId') <> 'gpt-flare-image' then raise exception 'C3 catalog order %', p -> 'models' -> 0 ->> 'modelId'; end if;
  execute 'reset role';
  select count(*) into v_n from app_private.price_versions;
  perform pg_temp.t_as(owner_u);
  begin perform public.admin_pricing_apply('all', null, 300, false, p ->> 'revision', 'publish', array['gpt-flare-image', 'wan-2-6']);
    raise exception 'C3 override overwritten';
  exception when others then if sqlerrm <> 'ROW_NOT_APPLICABLE' then raise; end if; end;
  execute 'reset role';
  if (select count(*) from app_private.price_versions) <> v_n then raise exception 'C3 partial batch applied'; end if;
  perform pg_temp.t_as(owner_u);
  r := public.admin_pricing_apply('all', null, 300, false, p ->> 'revision', 'publish', array['gpt-flare-image', 'veo-3-1']);
  execute 'reset role';
  if (select count(*) from app_private.price_versions where model_id in ('gpt-flare-image', 'veo-3-1') and state = 'published') <> 2 then
    raise exception 'C3 not published'; end if;
  if (select count(*) from app_private.price_versions where model_id in ('gpt-flare-image', 'veo-3-1') and state = 'draft') <> 0 then
    raise exception 'C3 superseded drafts still open'; end if;
  if (select count(*) from app_private.pricing_batch_items where batch_id = (r ->> 'batchId')::uuid) <> 2 then raise exception 'C3 batch items'; end if;
  begin update app_private.price_versions set rules = '{"base": 1}' where model_id = 'gpt-flare-image' and state = 'published';
    raise exception 'C3 published rules mutable';
  exception when others then if sqlerrm not like 'published or retired price rules are immutable%' then raise; end if; end;
  begin delete from app_private.pricing_batch_items where batch_id = (r ->> 'batchId')::uuid; raise exception 'C3 batch items deletable';
  exception when others then if sqlerrm not like 'append-only journal%' then raise; end if; end;
  begin update app_private.pricing_batches set markup_bps = 1 where id = (r ->> 'batchId')::uuid; raise exception 'C3 batch mutable';
  exception when others then if sqlerrm not like 'append-only journal%' then raise; end if; end;
  if not exists (select 1 from app_private.admin_audit_logs where action = 'pricing.batch_publish' and target_id = r ->> 'batchId' and actor_id = owner_u
                 and reason like 'Published 2 model price(s) at +300 %%') then raise exception 'C3 audit description'; end if;
  v_id := (select id from app_private.price_versions where model_id = 'gpt-flare-image' and state = 'published');
  v_ok := v_ok + 1;

  -- C4 quotes and running jobs keep their frozen price; new quotes use the new version
  perform app_private.grant_lot(cust, 'promo', 'test:c4:' || cust, 100, null, null, 'test grant');
  perform pg_temp.t_as(owner_u);
  perform public.admin_set_model_availability('gpt-flare-image', 'enabled', null, true);
  execute 'reset role';
  v_n := (select (rules -> 'units' ->> '2K')::int from app_private.price_versions where id = v_id);
  perform pg_temp.t_as(cust);
  q := public.create_generation_quote('gpt-flare-image', 'A ceramic lamp, editorial photo', '{"resolution": "2K"}', '{}');
  if (q ->> 'creditUnits')::int <> v_n then raise exception 'C4 quote %', q; end if;
  r := public.create_generation((q ->> 'quoteId')::uuid, 'c4-job-0001');
  v_job := (r -> 'job' ->> 'id')::uuid;
  q2 := public.create_generation_quote('gpt-flare-image', 'An older quote kept open', '{"resolution": "2K"}', '{}');
  execute 'reset role';
  perform pg_temp.t_as(owner_u);
  p := public.admin_pricing_preview('selected', array['gpt-flare-image'], 500, false);
  perform public.admin_pricing_apply('selected', array['gpt-flare-image'], 500, false, p ->> 'revision', 'publish', array['gpt-flare-image']);
  execute 'reset role';
  perform pg_temp.t_as(cust);
  begin perform public.create_generation((q2 ->> 'quoteId')::uuid, 'c4-job-0002'); raise exception 'C4 old quote charged a different price';
  exception when others then if sqlerrm <> 'QUOTE_STALE' then raise; end if; end;
  q2 := public.create_generation_quote('gpt-flare-image', 'A new quote', '{"resolution": "2K"}', '{}');
  execute 'reset role';
  if (q2 ->> 'creditUnits')::int <= (q ->> 'creditUnits')::int then raise exception 'C4 new quote did not use the new price'; end if;
  if (select units from public.generation_jobs where id = v_job) <> (q ->> 'creditUnits')::bigint
     or (select units from public.credit_reservations where job_id = v_job) <> (q ->> 'creditUnits')::bigint then raise exception 'C4 running job changed'; end if;
  -- restore the earlier version as a NEW published version
  perform pg_temp.t_as(owner_u);
  r := public.admin_restore_price_version(v_id);
  execute 'reset role';
  if (select restored_from from app_private.price_versions where id = (r ->> 'priceVersionId')::uuid) <> v_id
     or (select state from app_private.price_versions where id = v_id) <> 'retired' then raise exception 'C4 restore %', r; end if;
  v_ok := v_ok + 1;

  -- C5 availability end to end (enable validation, untested owner decision, disable/maintenance, bulk all-or-nothing)
  perform pg_temp.t_as(ops);
  begin perform public.admin_set_model_availability('flux-2-pro-image', 'enabled'); raise exception 'C5 enabled without price';
  exception when others then if sqlerrm <> 'MODEL_NOT_PRICED' then raise; end if; end;
  begin perform public.admin_set_model_availability('veo-3-1', 'enabled'); raise exception 'C5 operations enabled untested';
  exception when others then if sqlerrm <> 'MODEL_UNTESTED' then raise; end if; end;
  execute 'reset role';
  perform pg_temp.t_as(owner_u);
  begin perform public.admin_set_model_availability('veo-3-1', 'enabled'); raise exception 'C5 untested without confirmation';
  exception when others then if sqlerrm <> 'UNTESTED_CONFIRMATION_REQUIRED' then raise; end if; end;
  r := public.admin_set_model_availability('veo-3-1', 'enabled', null, true);
  if r ->> 'enableBasis' <> 'documented_cost' or r ->> 'verificationStatus' <> 'untested' then raise exception 'C5 basis %', r; end if;
  -- enable with "publish the draft in the same flow"
  perform public.admin_pricing_apply('selected', array['flux-2-pro-image'], 200, false,
    public.admin_pricing_preview('selected', array['flux-2-pro-image'], 200, false) ->> 'revision', 'draft', array['flux-2-pro-image']);
  execute 'reset role';
  v_id := (select id from app_private.price_versions where model_id = 'flux-2-pro-image' and state = 'draft');
  perform pg_temp.t_as(owner_u);
  r := public.admin_set_model_availability('flux-2-pro-image', 'experimental', null, true, v_id);
  if r ->> 'state' <> 'experimental' or r -> 'publishedPrice' ->> 'state' <> 'published' then raise exception 'C5 publish-in-flow %', r; end if;
  execute 'reset role';
  if (select verification_status from app_private.model_catalog where id = 'veo-3-1') <> 'untested' then raise exception 'C5 status changed'; end if;
  perform pg_temp.t_as(cust);
  if not exists (select 1 from jsonb_array_elements(public.get_catalog() -> 'models') x where x ->> 'id' = 'veo-3-1' and (x ->> 'priced')::boolean) then
    raise exception 'C5 enabled model not in customer catalog'; end if;
  q := public.create_generation_quote('veo-3-1', 'A sunrise over dunes', '{"resolution": "1080p"}', '{}');
  execute 'reset role';
  perform pg_temp.t_as(ops);
  perform public.admin_set_model_availability('veo-3-1', 'disabled');
  execute 'reset role';
  perform pg_temp.t_as(cust);
  if exists (select 1 from jsonb_array_elements(public.get_catalog() -> 'models') x where x ->> 'id' = 'veo-3-1') then raise exception 'C5 disabled still listed'; end if;
  begin perform public.create_generation((q ->> 'quoteId')::uuid, 'c5-job-0001'); raise exception 'C5 old quote accepted after disable';
  exception when others then if sqlerrm <> 'MODEL_UNAVAILABLE' then raise; end if; end;
  begin perform public.create_generation_quote('veo-3-1', 'A sunrise over dunes', '{}', '{}'); raise exception 'C5 quote after disable';
  exception when others then if sqlerrm <> 'MODEL_UNAVAILABLE' then raise; end if; end;
  execute 'reset role';
  perform pg_temp.t_as(ops);
  perform public.admin_set_model_availability('veo-3-1', 'maintenance', 'Back soon');
  execute 'reset role';
  perform pg_temp.t_as(cust);
  if not exists (select 1 from jsonb_array_elements(public.get_catalog() -> 'models') x where x ->> 'id' = 'veo-3-1' and x ->> 'state' = 'maintenance' and x ->> 'note' = 'Back soon') then
    raise exception 'C5 maintenance not shown'; end if;
  begin perform public.create_generation_quote('veo-3-1', 'A sunrise over dunes', '{}', '{}'); raise exception 'C5 quote in maintenance';
  exception when others then if sqlerrm <> 'MODEL_UNAVAILABLE' then raise; end if; end;
  execute 'reset role';
  -- the running job from C4 is untouched by availability changes
  if (select state from public.generation_jobs where id = v_job) <> 'queued' then raise exception 'C5 running job affected'; end if;
  perform pg_temp.t_as(owner_u);
  begin perform public.admin_bulk_set_availability(array['veo-3-1', 'kling-3-0'], 'enabled', true); raise exception 'C5 bulk partially blocked';
  exception when others then if sqlerrm <> 'BULK_BLOCKED' then raise; end if; end;
  execute 'reset role';
  if (select state from app_private.model_catalog where id = 'veo-3-1') <> 'maintenance' then raise exception 'C5 bulk changed a row'; end if;
  perform pg_temp.t_as(owner_u);
  r := public.admin_bulk_set_availability(array['veo-3-1', 'gpt-flare-image'], 'disabled');
  execute 'reset role';
  if (select count(*) from app_private.model_catalog where id in ('veo-3-1', 'gpt-flare-image') and state = 'disabled') <> 2 then raise exception 'C5 bulk disable'; end if;
  v_ok := v_ok + 1;

  -- C6 private staff test on a disabled, unpriced model: no wallet, no duplicates, evidence for that entry only
  perform pg_temp.t_as(owner_u);
  begin perform public.admin_create_model_test('veo-3-1-lite', 'A paper boat drifting', '{}', '{}', 'test-key-0001', false); raise exception 'C6 no spend confirmation';
  exception when others then if sqlerrm <> 'SPEND_CONFIRMATION_REQUIRED' then raise; end if; end;
  r := public.admin_create_model_test('veo-3-1-lite', 'A paper boat drifting', '{"resolution": "720p", "duration": 4}', '{}', 'test-key-0001', true);
  v_job2 := (r -> 'job' ->> 'id')::uuid;
  if (r ->> 'estimatedSupplierCredits')::numeric <> 30 then raise exception 'C6 estimate %', r; end if;
  r := public.admin_create_model_test('veo-3-1-lite', 'A paper boat drifting', '{"resolution": "720p", "duration": 4}', '{}', 'test-key-0001', true);
  if (r -> 'job' ->> 'id')::uuid <> v_job2 or not (r ->> 'replayed')::boolean then raise exception 'C6 replay %', r; end if;
  begin perform public.admin_create_model_test('veo-3-1-lite', 'Another boat', '{}', '{}', 'test-key-0002', true); raise exception 'C6 duplicate test';
  exception when others then if sqlerrm <> 'TEST_IN_PROGRESS' then raise; end if; end;
  execute 'reset role';
  perform pg_temp.t_as(ops);
  begin perform public.admin_create_model_test('veo-3-1-lite', 'Another boat', '{}', '{}', 'test-key-0003', true); raise exception 'C6 second operator duplicate';
  exception when others then if sqlerrm <> 'TEST_IN_PROGRESS' then raise; end if; end;
  execute 'reset role';
  if (select count(*) from app_private.job_work_items where ref_id = v_job2 and kind = 'job_submit') <> 1 then raise exception 'C6 duplicate submit work'; end if;
  if exists (select 1 from public.credit_reservations where job_id = v_job2) then raise exception 'C6 wallet reserved for a test'; end if;
  if (select state from app_private.model_catalog where id = 'veo-3-1-lite') <> 'disabled' then raise exception 'C6 test opened customer access'; end if;
  w := pg_temp.t_claim(v_job2, 'job_submit');
  r := public.worker_begin_submission((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid);
  perform public.worker_record_submission((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid, (r ->> 'attemptId')::uuid, '{"kind": "accepted", "taskId": "task_c6_1"}');
  -- task creation alone is not verification
  if (select verification_status from app_private.model_catalog where id = 'veo-3-1-lite') <> 'untested' then raise exception 'C6 verified on create'; end if;
  w := pg_temp.t_claim(v_job2, 'job_check');
  perform public.worker_record_observation((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid,
    '{"taskId": "task_c6_1", "providerState": "success", "normalized": "success", "resultUrls": ["https://tempfile.aiquickdraw.com/v.mp4"], "creditsConsumed": "30"}');
  w := pg_temp.t_claim(v_job2, 'job_import');
  r := public.worker_record_import((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid,
    jsonb_build_array(jsonb_build_object('bucket', 'generation-outputs', 'path', owner_u || '/' || v_job2 || '/0/original.mp4', 'mime', 'video/mp4',
      'bytes', 4321, 'durationMs', 4000, 'sha256', repeat('b', 64))));
  if r ->> 'action' <> 'succeeded' then raise exception 'C6 import %', r; end if;
  if (select status || '/' || observed_supplier_credits || '/' || cost_provenance || '/' || task_id from app_private.model_test_runs where job_id = v_job2)
     <> 'succeeded/30/observed: KIE task detail creditsConsumed/task_c6_1' then raise exception 'C6 test run %', (select row_to_json(t) from app_private.model_test_runs t where job_id = v_job2); end if;
  if (select verification_status from app_private.model_catalog where id = 'veo-3-1-lite') <> 'verified_by_test' then raise exception 'C6 not verified'; end if;
  if exists (select 1 from app_private.model_catalog where id in ('veo-3-1', 'veo-3-1-quality') and verification_status <> 'untested') then raise exception 'C6 sibling verified'; end if;
  if exists (select 1 from public.notifications where event_key like '%' || v_job2) then raise exception 'C6 customer notification for a test'; end if;
  if (select purpose from public.assets where job_id = v_job2) <> 'staff_test' then raise exception 'C6 asset not marked'; end if;
  if not exists (select 1 from app_private.model_verification_evidence where test_job_id = v_job2 and kind = 'integrated_test' and outcome = 'passed') then raise exception 'C6 evidence'; end if;
  begin update app_private.model_test_runs set observed_supplier_credits = 1 where job_id = v_job2; raise exception 'C6 settled run mutable';
  exception when others then if sqlerrm <> 'a settled test run is immutable' then raise; end if; end;
  perform pg_temp.t_as(owner_u);
  if jsonb_array_length(public.list_generations()) <> 0 then raise exception 'C6 test in customer library'; end if;
  r := public.admin_authorize_test_output((select id from public.assets where job_id = v_job2));
  if r ->> 'bucket' <> 'generation-outputs' then raise exception 'C6 output auth %', r; end if;
  execute 'reset role';
  perform pg_temp.t_as(cust);
  begin perform public.admin_authorize_test_output((select id from public.assets where job_id = v_job2)); raise exception 'C6 customer read test output';
  exception when others then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  execute 'reset role';
  -- a failing test records the failure for its own entry
  perform pg_temp.t_as(owner_u);
  r := public.admin_create_model_test('seedance-2-fast', 'A dancer in the rain', '{"resolution": "480p", "duration": 5}', '{}', 'test-key-0004', true);
  execute 'reset role';
  if (r ->> 'estimatedSupplierCredits')::numeric <> 58.5 then raise exception 'C6 per-second estimate %', r ->> 'estimatedSupplierCredits'; end if;
  w := pg_temp.t_claim((r -> 'job' ->> 'id')::uuid, 'job_submit');
  q := public.worker_begin_submission((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid);
  perform public.worker_record_submission((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid, (q ->> 'attemptId')::uuid,
    '{"kind": "rejected_terminal", "code": "KIE_422", "message": "bad", "publicCode": "INVALID_REQUEST", "publicMessage": "x"}');
  if (select verification_status from app_private.model_catalog where id = 'seedance-2-fast') <> 'test_failed' then raise exception 'C6 failure not recorded'; end if;
  v_ok := v_ok + 1;

  -- C7 balance: shared refresh slot, real values only, failures never become zero
  perform pg_temp.t_as(ops);
  if not (public.admin_begin_balance_refresh() ->> 'proceed')::boolean then
    -- another refresh happened moments ago; allow the window to pass inside this test
    execute 'reset role';
    update app_private.provider_accounts set last_balance_attempt_at = now() - interval '1 hour' where provider = 'kie';
    perform pg_temp.t_as(ops);
    if not (public.admin_begin_balance_refresh() ->> 'proceed')::boolean then raise exception 'C7 first refresh refused'; end if;
  end if;
  if (public.admin_begin_balance_refresh() ->> 'proceed')::boolean then raise exception 'C7 duplicate live read allowed'; end if;
  execute 'reset role';
  perform pg_temp.t_service();
  perform public.record_provider_balance_result(true, 12345.5, null, 'admin');
  perform public.record_provider_balance_result(false, null, 'TIMEOUT', 'auto');
  execute 'reset role';
  perform pg_temp.t_as(fin);
  r := public.admin_provider_summary();
  execute 'reset role';
  if (r -> 'balance' ->> 'credits')::numeric <> 12345.5 or r -> 'balance' ->> 'lastError' <> 'TIMEOUT'
     or (r -> 'balance' ->> 'approxUsd')::numeric <> 61.73 then raise exception 'C7 balance %', r -> 'balance'; end if;
  if (r -> 'spend' -> 'days30' ->> 'testCredits')::numeric < 30 then raise exception 'C7 test spend %', r -> 'spend'; end if;
  if (r -> 'committed' ->> 'jobs')::int < 1 then raise exception 'C7 committed estimate %', r -> 'committed'; end if;
  perform pg_temp.t_as(cust);
  begin perform public.record_provider_balance_result(true, 0, null, 'admin'); raise exception 'C7 customer wrote balance';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  v_ok := v_ok + 1;

  -- C8 package impact, assumptions, loss override and supplier cost versions
  v_txt := (select product_key from app_private.product_versions where state in ('draft', 'published') order by amount_minor desc limit 1);
  perform pg_temp.t_as(fin);
  r := public.admin_package_impact(jsonb_build_object(v_txt, jsonb_build_object('amountMinor', 100, 'credits', 1000)));
  if (r -> 'after' ->> 'minRevenuePerCredit')::numeric >= (r -> 'before' ->> 'minRevenuePerCredit')::numeric then raise exception 'C8 impact %', r; end if;
  if not exists (select 1 from jsonb_array_elements(r -> 'models') x where (x ->> 'lossAfter')::int > (x ->> 'lossBefore')::int) then raise exception 'C8 impact losses'; end if;
  r := public.admin_set_pricing_assumptions(290, 0.30, 0.002);
  if (r ->> 'paymentFeeBps')::numeric <> 290 then raise exception 'C8 assumptions %', r; end if;
  begin perform public.admin_save_supplier_cost('kling-3-0', '{"720p|on": 20}', 'documented', 'https://kie.ai/kling-3-0', now(), null); raise exception 'C8 partial cost';
  exception when others then if sqlerrm <> 'INVALID_COST' then raise; end if; end;
  r := public.admin_save_supplier_cost('kling-3-0', '{"720p|on": 21, "720p|off": 14, "1080p|on": 27, "1080p|off": 18, "4K|on": 67, "4K|off": 67}',
    'documented', 'https://kie.ai/kling-3-0', now(), 'Rechecked');
  if (r ->> 'version')::int <> 2 then raise exception 'C8 cost version %', r; end if;
  perform public.admin_save_price_draft('kling-3-0', (select jsonb_object_agg(x.key, 1) from jsonb_each(
    (public.admin_pricing_preview('selected', array['kling-3-0'], 100, false) -> 'models' -> 0 -> 'proposedRules' -> 'units')) x));
  execute 'reset role';
  begin update app_private.supplier_cost_versions set note = 'x' where model_id = 'kling-3-0'; raise exception 'C8 cost mutable';
  exception when others then if sqlerrm not like 'append-only journal%' then raise; end if; end;
  v_id := (select id from app_private.price_versions where model_id = 'kling-3-0' and state = 'draft');
  perform pg_temp.t_as(owner_u);
  begin perform public.admin_publish_price_version(v_id, null); raise exception 'C8 below-cost published without reason';
  exception when others then if sqlerrm <> 'LOSS_REASON_REQUIRED' then raise; end if; end;
  r := public.admin_publish_price_version(v_id, 'Launch promotion approved by the owner');
  if jsonb_array_length(r -> 'belowCost') = 0 then raise exception 'C8 below-cost not reported'; end if;
  execute 'reset role';
  v_ok := v_ok + 1;

  raise exception 'PASS: % catalog/pricing test groups', v_ok;
end;
$$;
