-- Generation + wallet invariants (guide §26.1, §26.2). Rolled back by the final exception.
do $$
declare
  a uuid := pg_temp.t_user('t-a-' || gen_random_uuid() || '@genlixs.test');
  b uuid := pg_temp.t_user('t-b-' || gen_random_uuid() || '@genlixs.test');
  d uuid := pg_temp.t_user('t-d-' || gen_random_uuid() || '@genlixs.test');
  q jsonb; q2 jsonb; r jsonb; r2 jsonb; c jsonb;
  job1 uuid; job2 uuid; job3 uuid; job4 uuid;
  w jsonb; v_lease uuid; v_item uuid; v_attempt uuid;
  v_ok int := 0; v_n int; v_txt text; v_lot uuid;
  wal record;
begin
  perform pg_temp.t_enable_model('gpt-flare-image', '{"base": 4, "add": {"resolution": {"2K": 2, "4K": 6}}}');
  perform app_private.grant_lot(a, 'promo', 'test:grant:' || a, 100, null, null, 'test grant');
  -- Idempotent grant: same source key never grants twice.
  perform app_private.grant_lot(a, 'promo', 'test:grant:' || a, 100, null, null, 'test grant');
  if (select available_units from public.wallet_accounts where user_id = a) <> 100 then raise exception 'grant not idempotent'; end if;
  v_ok := v_ok + 1;

  -- T1 quote: server-side price from published rules
  perform pg_temp.t_as(a);
  q := public.create_generation_quote('gpt-flare-image', 'A ceramic lamp on a desk, editorial photo', '{"aspect_ratio": "1:1", "resolution": "2K"}', '{}');
  if q ->> 'creditUnits' <> '6' then raise exception 'T1 expected 6 units, got %', q; end if;
  v_ok := v_ok + 1;

  -- T2 unsupported option and unknown option are rejected before any reservation
  begin
    perform public.create_generation_quote('gpt-flare-image', 'A ceramic lamp on a desk', '{"resolution": "8K"}', '{}');
    raise exception 'T2 expected rejection';
  exception when others then if sqlerrm <> 'UNSUPPORTED_OPTION' then raise; end if; end;
  begin
    perform public.create_generation_quote('gpt-flare-image', 'A ceramic lamp on a desk', '{"seed": 1}', '{}');
    raise exception 'T2b expected rejection';
  exception when others then if sqlerrm <> 'UNSUPPORTED_OPTION' then raise; end if; end;
  begin
    perform public.create_generation_quote('veo-3-1', 'A ceramic lamp on a desk', '{}', '{}');
    raise exception 'T2c disabled model must be unavailable';
  exception when others then if sqlerrm <> 'MODEL_UNAVAILABLE' then raise; end if; end;
  v_ok := v_ok + 1;

  -- T3 atomic intent + idempotent replay
  r := public.create_generation((q ->> 'quoteId')::uuid, 'key-0001-aaaa');
  job1 := (r -> 'job' ->> 'id')::uuid;
  if r -> 'wallet' ->> 'availableUnits' <> '94' or r -> 'wallet' ->> 'reservedUnits' <> '6' then raise exception 'T3 wallet %', r -> 'wallet'; end if;
  r2 := public.create_generation((q ->> 'quoteId')::uuid, 'key-0001-aaaa');
  if (r2 -> 'job' ->> 'id')::uuid <> job1 or (r2 ->> 'replayed')::boolean is not true then raise exception 'T3 replay %', r2; end if;
  if r2 -> 'wallet' ->> 'reservedUnits' <> '6' then raise exception 'T3 replay reserved twice'; end if;
  v_ok := v_ok + 1;

  -- T4 same key, different quote -> conflict; T5 same quote, new key -> already used
  q2 := public.create_generation_quote('gpt-flare-image', 'Another lamp, studio light', '{}', '{}');
  begin
    perform public.create_generation((q2 ->> 'quoteId')::uuid, 'key-0001-aaaa');
    raise exception 'T4 expected conflict';
  exception when others then if sqlerrm <> 'IDEMPOTENCY_CONFLICT' then raise; end if; end;
  begin
    perform public.create_generation((q ->> 'quoteId')::uuid, 'key-0002-bbbb');
    raise exception 'T5 expected quote reuse rejection';
  exception when others then if sqlerrm <> 'QUOTE_ALREADY_USED' then raise; end if; end;
  v_ok := v_ok + 1;
  execute 'reset role';

  -- T6 another customer cannot read or act on A's job (RLS + RPC ownership)
  perform pg_temp.t_as(b);
  select count(*) into v_n from public.generation_jobs where id = job1;
  if v_n <> 0 then raise exception 'T6 RLS leak on jobs'; end if;
  select count(*) into v_n from public.credit_ledger where user_id = a;
  if v_n <> 0 then raise exception 'T6 RLS leak on ledger'; end if;
  if public.get_generation(job1) is not null then raise exception 'T6 get_generation leaked'; end if;
  begin
    perform public.cancel_queued_generation(job1);
    raise exception 'T6 cancel should fail';
  exception when others then if sqlerrm <> 'NOT_FOUND' then raise; end if; end;
  -- worker / service functions are not callable by customers
  begin
    perform public.worker_dequeue('genlixs_control', 30, 1);
    raise exception 'T6 worker callable by customer';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  -- anonymous role sees nothing private
  execute 'set local role anon';
  begin
    perform 1 from public.wallet_accounts limit 1;
    raise exception 'T6 anon can read wallets';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
  v_ok := v_ok + 1;

  -- T7 happy path through the fenced worker steps
  w := pg_temp.t_claim(job1, 'job_submit');
  v_item := (w ->> 'workItemId')::uuid; v_lease := (w ->> 'leaseToken')::uuid;
  r := public.worker_begin_submission(v_item, v_lease);
  if r ->> 'action' <> 'submit' then raise exception 'T7 begin %', r; end if;
  v_attempt := (r ->> 'attemptId')::uuid;
  r := public.worker_record_submission(v_item, v_lease, v_attempt, '{"kind": "accepted", "taskId": "task_test_1"}');
  if r ->> 'action' <> 'check_scheduled' then raise exception 'T7 submission %', r; end if;
  if (select state from public.generation_jobs where id = job1) <> 'provider_pending' then raise exception 'T7 state after accept'; end if;
  -- T8 stale lease is rejected (fencing)
  begin
    perform public.worker_record_submission(v_item, v_lease, v_attempt, '{"kind": "accepted", "taskId": "task_test_1"}');
    raise exception 'T8 stale lease accepted';
  exception when others then if sqlerrm <> 'STALE_LEASE' then raise; end if; end;
  w := pg_temp.t_claim(job1, 'job_check');
  r := public.worker_record_observation((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid,
    '{"taskId": "task_test_1", "providerState": "generating", "normalized": "pending"}');
  if r ->> 'action' <> 'recheck' then raise exception 'T7 pending %', r; end if;
  w := pg_temp.t_claim(job1, 'job_check');
  r := public.worker_record_observation((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid,
    '{"taskId": "task_test_1", "providerState": "success", "normalized": "success", "resultUrls": ["https://tempfile.aiquickdraw.com/x.png"], "creditsConsumed": "3"}');
  if r ->> 'action' <> 'import_scheduled' then raise exception 'T7 success %', r; end if;
  w := pg_temp.t_claim(job1, 'job_import');
  r := public.worker_record_import((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid,
    jsonb_build_array(jsonb_build_object('bucket', 'generation-outputs', 'path', a || '/' || job1 || '/x/original.png', 'mime', 'image/png',
      'bytes', 1234, 'width', 1024, 'height', 1024, 'sha256', repeat('a', 64))));
  if r ->> 'action' <> 'succeeded' then raise exception 'T7 import %', r; end if;
  select available_units, reserved_units, spent_units into wal from public.wallet_accounts where user_id = a;
  if wal.available_units <> 94 or wal.reserved_units <> 0 or wal.spent_units <> 6 then raise exception 'T7 wallet %', row_to_json(wal); end if;
  if (select state from public.credit_reservations where job_id = job1) <> 'captured' then raise exception 'T7 not captured'; end if;
  if not exists (select 1 from public.notifications where event_key = 'job_ready:' || job1) then raise exception 'T7 no notification'; end if;
  -- late duplicate success after settlement: evidence only, no second capture
  perform app_private.enqueue_work('genlixs_control', 'job_check', job1, 'check:' || job1 || ':late', now(), '{"n": 1}');
  w := pg_temp.t_claim(job1, 'job_check');
  r := public.worker_record_observation((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid,
    '{"taskId": "task_test_1", "normalized": "success", "resultUrls": ["https://tempfile.aiquickdraw.com/x.png"]}');
  if r ->> 'action' <> 'none' then raise exception 'T7 late success %', r; end if;
  if (select spent_units from public.wallet_accounts where user_id = a) <> 6 then raise exception 'T7 double capture'; end if;
  v_ok := v_ok + 1;

  -- T9 provider failure releases exactly once
  perform pg_temp.t_as(a);
  q := public.create_generation_quote('gpt-flare-image', 'A failing lamp', '{}', '{}');
  r := public.create_generation((q ->> 'quoteId')::uuid, 'key-0009-fail');
  job2 := (r -> 'job' ->> 'id')::uuid;
  execute 'reset role';
  w := pg_temp.t_claim(job2, 'job_submit');
  r := public.worker_begin_submission((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid);
  perform public.worker_record_submission((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid, (r ->> 'attemptId')::uuid, '{"kind": "accepted", "taskId": "task_test_2"}');
  w := pg_temp.t_claim(job2, 'job_check');
  r := public.worker_record_observation((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid,
    '{"taskId": "task_test_2", "providerState": "fail", "normalized": "fail", "failCode": "500", "failMsg": "internal"}');
  if r ->> 'action' <> 'failed' then raise exception 'T9 %', r; end if;
  select available_units, reserved_units into wal from public.wallet_accounts where user_id = a;
  if wal.available_units <> 94 or wal.reserved_units <> 0 then raise exception 'T9 wallet %', row_to_json(wal); end if;
  if app_private.release_reservation(job2, 'again') <> 'released' then raise exception 'T9 second release changed state'; end if;
  if (select available_units from public.wallet_accounts where user_id = a) <> 94 then raise exception 'T9 double release'; end if;
  v_ok := v_ok + 1;

  -- T10 unknown submission: no automatic resend; verified callback binding recovers it
  perform pg_temp.t_as(a);
  q := public.create_generation_quote('gpt-flare-image', 'An unknown lamp', '{}', '{}');
  r := public.create_generation((q ->> 'quoteId')::uuid, 'key-0010-unkn');
  job3 := (r -> 'job' ->> 'id')::uuid;
  execute 'reset role';
  w := pg_temp.t_claim(job3, 'job_submit');
  r := public.worker_begin_submission((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid);
  v_attempt := (r ->> 'attemptId')::uuid;
  v_txt := r ->> 'correlationToken';
  perform public.worker_record_submission((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid, v_attempt, '{"kind": "unknown", "code": "TIMEOUT"}');
  if (select state from public.generation_jobs where id = job3) <> 'submission_unknown' then raise exception 'T10 state'; end if;
  if exists (select 1 from app_private.job_work_items where ref_id = job3 and kind = 'job_submit' and state = 'pending') then
    raise exception 'T10 resubmission scheduled'; end if;
  r := public.provider_callback_receipt('task_test_3', '1760000000', 'fp-1', v_attempt, encode(extensions.digest(v_txt, 'sha256'), 'hex'));
  if r ->> 'action' <> 'bind_check' then raise exception 'T10 callback %', r; end if;
  -- duplicate callback is a no-op
  if (public.provider_callback_receipt('task_test_3', '1760000000', 'fp-1', v_attempt, 'x') ->> 'duplicate')::boolean is not true then
    raise exception 'T10 duplicate'; end if;
  w := pg_temp.t_claim(job3, 'job_bind');
  -- evidence that does not match the persisted correlation hash is refused (work item finishes, no bind)
  r := public.worker_bind_task((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid, v_attempt, 'not-the-token', 'forged');
  if r ->> 'action' <> 'none' or (r ->> 'verified')::boolean then raise exception 'T10 forged bind %', r; end if;
  if (select state from public.generation_jobs where id = job3) <> 'review_required' then raise exception 'T10 mismatch not escalated'; end if;
  -- an operator returns the job to unknown; the genuine evidence then binds
  update public.generation_jobs set state = 'submission_unknown', failure_code = null where id = job3;
  perform app_private.enqueue_work('genlixs_control', 'job_bind', job3, 'bind:retry:' || job3, now(),
    jsonb_build_object('taskId', 'task_test_3', 'attemptId', v_attempt));
  w := pg_temp.t_claim(job3, 'job_bind');
  r := public.worker_bind_task((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid, v_attempt, v_txt, 'callback url matched attempt and correlation');
  if r ->> 'action' <> 'bound' then raise exception 'T10 bind %', r; end if;
  -- the legacy boolean signature is no longer callable by the worker role
  if has_function_privilege('service_role', 'public.worker_bind_task(uuid, uuid, boolean, text)', 'execute') then
    raise exception 'T10 legacy bind still executable'; end if;
  if (select state from public.generation_jobs where id = job3) <> 'provider_pending' then raise exception 'T10 not pending after bind'; end if;
  -- a wrong correlation cannot bind a foreign task
  r := public.provider_callback_receipt('task_other', '1760000001', 'fp-2', v_attempt, 'deadbeef');
  if r ->> 'action' <> 'unbound' then raise exception 'T10 foreign bind %', r; end if;
  v_ok := v_ok + 1;

  -- T11 cancellation wins only before the worker claim
  perform pg_temp.t_as(a);
  q := public.create_generation_quote('gpt-flare-image', 'Cancel me', '{}', '{}');
  r := public.create_generation((q ->> 'quoteId')::uuid, 'key-0011-cncl');
  job4 := (r -> 'job' ->> 'id')::uuid;
  r := public.cancel_queued_generation(job4);
  if r -> 'job' ->> 'state' <> 'cancelled' then raise exception 'T11 %', r; end if;
  execute 'reset role';
  -- job3 still holds its reservation; job4 released
  if (select reserved_units from public.wallet_accounts where user_id = a) <> 4 then raise exception 'T11 reserved %', (select reserved_units from public.wallet_accounts where user_id = a); end if;
  perform pg_temp.t_as(a);
  q := public.create_generation_quote('gpt-flare-image', 'Too late to cancel', '{}', '{}');
  r := public.create_generation((q ->> 'quoteId')::uuid, 'key-0011-late');
  execute 'reset role';
  w := pg_temp.t_claim((r -> 'job' ->> 'id')::uuid, 'job_submit');
  perform pg_temp.t_as(a);
  begin
    perform public.cancel_queued_generation((r -> 'job' ->> 'id')::uuid);
    raise exception 'T11 cancel after claim';
  exception when others then if sqlerrm <> 'CANCEL_TOO_LATE' then raise; end if; end;
  execute 'reset role';
  v_ok := v_ok + 1;

  -- T12 "20 intents, wallet 100, cost 12": exactly 8 reserve, 96 reserved, 4 available, never negative
  perform pg_temp.t_enable_model('gpt-flare-image', '{"base": 12}');
  update app_private.settings set value = '100' where key = 'max_active_jobs_per_user';
  update app_private.settings set value = '100' where key = 'max_quotes_per_minute';
  perform app_private.grant_lot(d, 'promo', 'test:grant:' || d, 100, null, null, 'test grant');
  perform pg_temp.t_as(d);
  v_n := 0;
  for i in 1..20 loop
    q := public.create_generation_quote('gpt-flare-image', 'Batch item ' || i, '{}', '{}');
    begin
      perform public.create_generation((q ->> 'quoteId')::uuid, 'batch-key-' || lpad(i::text, 4, '0'));
      v_n := v_n + 1;
    exception when others then if sqlerrm <> 'INSUFFICIENT_CREDITS' then raise; end if; end;
  end loop;
  execute 'reset role';
  select available_units, reserved_units into wal from public.wallet_accounts where user_id = d;
  if v_n <> 8 or wal.reserved_units <> 96 or wal.available_units <> 4 then
    raise exception 'T12 accepted %, wallet %', v_n, row_to_json(wal); end if;
  v_ok := v_ok + 1;

  -- T13 a lot that expires while reserved returns to "expired", not "available"
  v_lot := app_private.grant_lot(b, 'promo', 'test:short:' || b, 12, now() + interval '1 hour', null, 'short promo');
  perform pg_temp.t_as(b);
  q := public.create_generation_quote('gpt-flare-image', 'Expiring lot job', '{}', '{}');
  r := public.create_generation((q ->> 'quoteId')::uuid, 'key-0013-expr');
  execute 'reset role';
  update public.credit_lots set expires_at = now() - interval '1 second' where id = v_lot;
  perform app_private.release_reservation((r -> 'job' ->> 'id')::uuid, 'test release after expiry');
  select available_units, expired_units into wal from public.wallet_accounts where user_id = b;
  if wal.available_units <> 0 or wal.expired_units <> 12 then raise exception 'T13 %', row_to_json(wal); end if;
  v_ok := v_ok + 1;

  -- T14 lot conservation and wallet projections reconcile
  c := public.reconcile_wallets();
  if jsonb_array_length(c -> 'walletVsLots') <> 0 or jsonb_array_length(c -> 'lotsVsLedger') <> 0
     or jsonb_array_length(c -> 'openAllocationMismatch') <> 0 or jsonb_array_length(c -> 'terminalJobsWithOpenReservation') <> 0
     or jsonb_array_length(c -> 'succeededWithoutCapture') <> 0 or jsonb_array_length(c -> 'queuedWithoutWork') <> 0 then
    raise exception 'T14 reconciliation %', c;
  end if;
  -- append-only ledger
  begin
    update public.credit_ledger set note = 'tamper' where user_id = a;
    raise exception 'T14 ledger mutable';
  exception when others then if sqlerrm not like 'append-only journal%' then raise; end if; end;
  v_ok := v_ok + 1;

  -- T15 watchdog: expired submission lease becomes unknown (never a resend)
  perform pg_temp.t_enable_model('gpt-flare-image', '{"base": 1}');
  perform app_private.grant_lot(b, 'promo', 'test:more:' || b, 5, null, null, 'more');
  perform pg_temp.t_as(b);
  q := public.create_generation_quote('gpt-flare-image', 'Watchdog job', '{}', '{}');
  r := public.create_generation((q ->> 'quoteId')::uuid, 'key-0015-wdog');
  execute 'reset role';
  w := pg_temp.t_claim((r -> 'job' ->> 'id')::uuid, 'job_submit');
  perform public.worker_begin_submission((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid);
  update app_private.job_work_items set lease_expires_at = now() - interval '1 second' where id = (w ->> 'workItemId')::uuid;
  perform public.watchdog_tick();
  if (select state from public.generation_jobs where id = (r -> 'job' ->> 'id')::uuid) <> 'submission_unknown' then raise exception 'T15 watchdog'; end if;
  if exists (select 1 from app_private.job_work_items where ref_id = (r -> 'job' ->> 'id')::uuid and kind = 'job_submit' and state = 'pending') then
    raise exception 'T15 resend scheduled'; end if;
  -- deadline releases once
  update public.generation_jobs set customer_deadline_at = now() - interval '1 second' where id = (r -> 'job' ->> 'id')::uuid;
  perform public.watchdog_tick();
  if (select settlement_state from public.generation_jobs where id = (r -> 'job' ->> 'id')::uuid) <> 'released' then raise exception 'T15 deadline'; end if;
  v_ok := v_ok + 1;

  raise exception 'PASS: % generation/wallet test groups', v_ok;
end;
$$;
