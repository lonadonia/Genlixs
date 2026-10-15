-- Generation reliability (migration generation_reliability, 15 Oct 2026). Rolled back by the final exception.
-- R1 a supplier account refusal (KIE 402) keeps the job queued with an honest message, pauses new quotes and new
--    intents, and lifts the pause on the next accepted task; R2 the fourth refusal fails the job and returns the
--    credits exactly once; R3 a blocked account defers submissions but sends staff tests; R4 Cron wakes only queues
--    with due work (plus a control probe every 10 minutes); R5 the snapshot carries stage/timing/progress fields and
--    timing is learnt from deliveries; R6 the health read needs a staff capability and returns no secrets.
do $$
declare
  a uuid := pg_temp.t_user('t-rel-a-' || gen_random_uuid() || '@genlixs.test');
  ops uuid := pg_temp.t_user('t-rel-ops-' || gen_random_uuid() || '@genlixs.test');
  acc uuid := (select id from app_private.provider_accounts where provider = 'kie' and label = 'primary');
  q jsonb; r jsonb; w jsonb; snap jsonb; h jsonb;
  job1 uuid; job2 uuid;
  v_item uuid; v_lease uuid; v_attempt uuid;
  v_ok int := 0; v_n int; v_txt text;
  wal record;
begin
  -- Independent of the live catalog: every model off, then one test model with a test price.
  update app_private.model_catalog set state = 'disabled';
  perform pg_temp.t_enable_model('gpt-flare-image', '{"base": 4, "add": {"resolution": {"2K": 2, "4K": 6}}}');
  update app_private.provider_accounts set submit_blocked_until = null, submit_block_since = null, paused = false where id = acc;
  perform app_private.grant_lot(a, 'promo', 'test:grant:' || a, 100, null, null, 'test grant');
  insert into app_private.staff_memberships (user_id, role) values (ops, 'operations');

  -- R1 refusal → queued, honest event, circuit breaker on quotes and intents
  perform pg_temp.t_as(a);
  q := public.create_generation_quote('gpt-flare-image', 'A ceramic lamp on a desk, editorial photo', '{"aspect_ratio": "1:1"}', '{}');
  r := public.create_generation((q ->> 'quoteId')::uuid, 'key-rel-0001');
  job1 := (r -> 'job' ->> 'id')::uuid;
  q := public.create_generation_quote('gpt-flare-image', 'A second lamp on a desk, editorial photo', '{"aspect_ratio": "1:1"}', '{}');
  execute 'reset role';
  w := pg_temp.t_claim(job1, 'job_submit');
  v_item := (w ->> 'workItemId')::uuid; v_lease := (w ->> 'leaseToken')::uuid;
  r := public.worker_begin_submission(v_item, v_lease);
  v_attempt := (r ->> 'attemptId')::uuid;
  r := public.worker_record_submission(v_item, v_lease, v_attempt,
    '{"kind": "rejected_account", "code": "KIE_402", "message": "Credits insufficient"}');
  if r ->> 'action' <> 'account_rejected' then raise exception 'R1 action %', r; end if;
  if (select state from public.generation_jobs where id = job1) <> 'queued' then raise exception 'R1 job not queued'; end if;
  if (select state from app_private.provider_attempts where id = v_attempt) <> 'rejected' then raise exception 'R1 attempt state'; end if;
  select message into v_txt from public.generation_job_events where job_id = job1 order by created_at desc, event desc limit 1;
  if v_txt not like '%not taking new jobs%' or v_txt like '%busy%' then raise exception 'R1 event message: %', v_txt; end if;
  if not app_private.supplier_blocked(acc) then raise exception 'R1 breaker not set'; end if;
  if (select reserved_units from public.wallet_accounts where user_id = a) <> 4 then raise exception 'R1 reservation changed'; end if;
  perform pg_temp.t_as(a);
  begin
    perform public.create_generation_quote('gpt-flare-image', 'A third lamp on a desk', '{}', '{}');
    raise exception 'R1 quote allowed while blocked';
  exception when others then if sqlerrm <> 'SERVICE_UNAVAILABLE' then raise; end if; end;
  begin
    perform public.create_generation((q ->> 'quoteId')::uuid, 'key-rel-0002');
    raise exception 'R1 intent allowed while blocked';
  exception when others then if sqlerrm <> 'SERVICE_UNAVAILABLE' then raise; end if; end;
  execute 'reset role';
  -- the blocked account defers the waiting job instead of sending it again at once
  w := pg_temp.t_claim(job1, 'job_submit');
  r := public.worker_begin_submission((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid);
  if r ->> 'action' <> 'deferred' or r ->> 'reason' <> 'supplier_blocked' then raise exception 'R1 not deferred %', r; end if;
  -- an accepted task lifts the breaker
  update app_private.provider_accounts set submit_blocked_until = now() - interval '1 second' where id = acc;
  w := pg_temp.t_claim(job1, 'job_submit');
  v_item := (w ->> 'workItemId')::uuid; v_lease := (w ->> 'leaseToken')::uuid;
  r := public.worker_begin_submission(v_item, v_lease);
  if r ->> 'action' <> 'submit' then raise exception 'R1 begin after block %', r; end if;
  r := public.worker_record_submission(v_item, v_lease, (r ->> 'attemptId')::uuid, '{"kind": "accepted", "taskId": "task_rel_1"}');
  if r ->> 'action' <> 'check_scheduled' then raise exception 'R1 accept %', r; end if;
  if (select submit_block_since from app_private.provider_accounts where id = acc) is not null then raise exception 'R1 breaker not lifted'; end if;
  v_ok := v_ok + 1;

  -- R2 four refusals: failed, released once, notified; no fifth submission
  perform pg_temp.t_as(a);
  q := public.create_generation_quote('gpt-flare-image', 'A fourth lamp on a desk, editorial photo', '{"resolution": "2K"}', '{}');
  r := public.create_generation((q ->> 'quoteId')::uuid, 'key-rel-0003');
  job2 := (r -> 'job' ->> 'id')::uuid;
  execute 'reset role';
  for v_n in 1..4 loop
    update app_private.provider_accounts set submit_blocked_until = null where id = acc;
    w := pg_temp.t_claim(job2, 'job_submit');
    v_item := (w ->> 'workItemId')::uuid; v_lease := (w ->> 'leaseToken')::uuid;
    r := public.worker_begin_submission(v_item, v_lease);
    if r ->> 'action' <> 'submit' then raise exception 'R2 begin % %', v_n, r; end if;
    r := public.worker_record_submission(v_item, v_lease, (r ->> 'attemptId')::uuid,
      '{"kind": "rejected_account", "code": "KIE_402", "message": "Credits insufficient"}');
  end loop;
  if r ->> 'action' <> 'failed' then raise exception 'R2 last action %', r; end if;
  if (select state || '/' || settlement_state || '/' || failure_code from public.generation_jobs where id = job2) <> 'failed/released/SERVICE_UNAVAILABLE' then
    raise exception 'R2 job %', (select state || '/' || settlement_state from public.generation_jobs where id = job2);
  end if;
  if (select count(*) from public.credit_ledger where job_id = job2 and event_type = 'release') <> 1 then raise exception 'R2 release count'; end if;
  if exists (select 1 from app_private.job_work_items where ref_id = job2 and kind = 'job_submit' and state = 'pending') then raise exception 'R2 still scheduled'; end if;
  if not exists (select 1 from public.notifications where event_key = 'job_failed:' || job2) then raise exception 'R2 no notification'; end if;
  select available_units, reserved_units into wal from public.wallet_accounts where user_id = a;
  if wal.reserved_units <> 4 or wal.available_units <> 96 then raise exception 'R2 wallet %', row_to_json(wal); end if;
  v_ok := v_ok + 1;

  -- R3 the classic busy path keeps its wording; a blocked account still sends private staff tests
  update app_private.provider_accounts set submit_blocked_until = now() + interval '5 minutes' where id = acc;
  perform pg_temp.t_as(ops);
  r := public.admin_create_model_test('gpt-flare-image', 'A ceramic lamp, product photo', '{"aspect_ratio": "1:1"}', '{}', 'key-rel-test-0001', true);
  execute 'reset role';
  w := pg_temp.t_claim((r -> 'job' ->> 'id')::uuid, 'job_submit');
  r := public.worker_begin_submission((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid);
  if r ->> 'action' <> 'submit' then raise exception 'R3 staff test not sent while blocked %', r; end if;
  v_ok := v_ok + 1;

  -- R4 wake-ups only for due work (the HTTP request itself is queued by pg_net and rolled back with the test)
  update app_private.job_work_items set due_at = now() + interval '1 hour' where state = 'pending';
  if app_private.wake_workers('events') is not null then raise exception 'R4 woke an idle queue'; end if;
  if app_private.wake_workers('media') is not null then raise exception 'R4 woke idle media'; end if;
  if app_private.wake_workers('bogus') is not null then raise exception 'R4 unknown queue'; end if;
  update app_private.job_work_items set due_at = now() where id = (select id from app_private.job_work_items where ref_id = job1 and state = 'pending' limit 1);
  if exists (select 1 from vault.decrypted_secrets where name = 'genlixs_worker_base_url') then
    if app_private.wake_workers('control') is null then raise exception 'R4 due control work not woken'; end if;
    if not exists (select 1 from app_private.worker_wakes where queue = 'control' and reason = 'due_work') then raise exception 'R4 wake not recorded'; end if;
  end if;
  v_ok := v_ok + 1;

  -- R5 snapshot fields; timing learnt from deliveries (3 samples switch the basis to history)
  snap := app_private.job_snapshot(job1);
  if snap ->> 'stage' <> 'generating' or snap ->> 'outputKind' <> 'image' or snap ->> 'acceptedAt' is null then raise exception 'R5 snapshot %', snap; end if;
  if snap -> 'timing' ->> 'basis' not in ('typical', 'history') or (snap -> 'timing' ->> 'generateSeconds')::int <= 0 then raise exception 'R5 timing %', snap -> 'timing'; end if;
  if snap -> 'providerProgress' is not null and snap -> 'providerProgress' <> 'null'::jsonb then raise exception 'R5 progress invented %', snap -> 'providerProgress'; end if;
  w := pg_temp.t_claim(job1, 'job_check');
  r := public.worker_record_observation((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid,
    '{"taskId": "task_rel_1", "providerState": "generating", "normalized": "pending", "progress": "40"}');
  snap := app_private.job_snapshot(job1);
  if (snap -> 'providerProgress' ->> 'value')::numeric <> 40 then raise exception 'R5 provider progress %', snap -> 'providerProgress'; end if;
  w := pg_temp.t_claim(job1, 'job_check');
  r := public.worker_record_observation((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid,
    '{"taskId": "task_rel_1", "providerState": "success", "normalized": "success", "resultUrls": ["https://tempfile.aiquickdraw.com/x.png"]}');
  if app_private.job_snapshot(job1) ->> 'stage' <> 'saving' then raise exception 'R5 saving stage'; end if;
  w := pg_temp.t_claim(job1, 'job_import');
  r := public.worker_record_import((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid,
    jsonb_build_array(jsonb_build_object('bucket', 'generation-outputs', 'path', a || '/' || job1 || '/0/original.png', 'mime', 'image/png',
      'bytes', 1234, 'width', 1024, 'height', 1024, 'sha256', repeat('a', 64))));
  if r ->> 'action' <> 'succeeded' then raise exception 'R5 import %', r; end if;
  snap := app_private.job_snapshot(job1);
  if snap ->> 'stage' <> 'ready' or jsonb_array_length(snap -> 'outputs') <> 1 then raise exception 'R5 ready %', snap ->> 'stage'; end if;
  if not exists (select 1 from app_private.model_timing where model_id = 'gpt-flare-image' and samples >= 1) then raise exception 'R5 timing not learnt'; end if;
  v_ok := v_ok + 1;

  -- R6 health read: staff only, host names only
  perform pg_temp.t_as(a);
  begin
    perform public.admin_generation_health();
    raise exception 'R6 customer read health';
  exception when others then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  execute 'reset role';
  perform pg_temp.t_as(ops);
  h := public.admin_generation_health();
  execute 'reset role';
  if h -> 'wake' is null or h -> 'queues' is null or h -> 'supplier' is null or h -> 'submissions24h' is null then raise exception 'R6 shape %', h; end if;
  if h::text ~* '(bearer|eyJhbGci|service_role)' then raise exception 'R6 secret-looking value in health'; end if;
  if exists (select 1 from vault.decrypted_secrets where name = 'genlixs_worker_token' and position(decrypted_secret in h::text) > 0) then
    raise exception 'R6 worker token leaked';
  end if;
  v_ok := v_ok + 1;

  raise exception 'PASS: % generation-reliability test groups', v_ok;
end;
$$;
