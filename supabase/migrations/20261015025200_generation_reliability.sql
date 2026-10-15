-- Genlixs 19 · Generation reliability (15 Oct 2026). Findings from the production repair:
--   * KIE answered "402 Credits insufficient" to create-task while the balance endpoint showed credits; the worker
--     treated it as "busy" and kept the customer waiting without an explanation.
--   * Cron woke the workers at an origin that does not resolve, so retries, status checks and imports only ran when a
--     customer request happened to start a worker pass.
-- This migration adds: an honest supplier-account rejection path with a short circuit breaker and a bounded wait,
-- workers woken only when work is due (plus a periodic probe), a staff health read, and per-model timing used for
-- the customer progress estimate. Additive: existing jobs, prices and wallets keep their meaning.

-- ------------------------------------------------------------- schema

alter table app_private.provider_accounts
  add column submit_blocked_until timestamptz,
  add column submit_block_code text,
  add column submit_block_message text,
  add column submit_block_since timestamptz;

-- One row per Cron wake request, joined with pg_net's response for the health read (responses live ~6 hours).
create table app_private.worker_wakes (
  request_id bigint primary key,
  queue text not null check (queue in ('control', 'media', 'events')),
  reason text not null check (reason in ('due_work', 'periodic')),
  woken_at timestamptz not null default now()
);
create index worker_wakes_at_idx on app_private.worker_wakes (woken_at desc);
alter table app_private.worker_wakes enable row level security;

-- Typical durations per model from recent deliveries: provider generation (accepted → result seen) and saving
-- (result seen → file stored). Used only to estimate progress; never for billing or deadlines.
create table app_private.model_timing (
  model_id text primary key references app_private.model_catalog (id),
  samples int not null,
  generate_p50_seconds numeric not null,
  generate_p80_seconds numeric not null,
  save_p50_seconds numeric not null,
  updated_at timestamptz not null default now()
);
alter table app_private.model_timing enable row level security;

insert into app_private.settings (key, value, description) values
  ('provider_block_seconds', '300', 'After the generation service refuses our account (KIE 401/402), new quotes pause for this long'),
  ('provider_rejection_give_up_minutes', '20', 'A job refused for account reasons for this long is failed and its credits returned')
on conflict (key) do nothing;

-- -------------------------------------------------------------- wake-ups

-- Wakes a Vercel worker only when its queue has work due now, plus a control probe every 10 minutes (supplier
-- balance read and a reachability signal for the health panel). Without the Vault URL and token it does nothing.
create or replace function app_private.wake_workers(p_kind text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_token text;
  v_req bigint;
  v_reason text;
begin
  if p_kind not in ('control', 'media', 'events') then
    return null;
  end if;
  if exists (select 1 from app_private.job_work_items
             where queue = 'genlixs_' || p_kind and state = 'pending' and due_at <= now() + interval '5 seconds') then
    v_reason := 'due_work';
  elsif p_kind = 'control' and extract(minute from now())::int % 10 = 0 then
    v_reason := 'periodic';
  else
    return null;
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'genlixs_worker_base_url';
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'genlixs_worker_token';
  if v_url is null or v_token is null then
    return null;
  end if;
  select net.http_post(
    url := rtrim(v_url, '/') || '/api/internal/workers/' || p_kind,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_token),
    body := jsonb_build_object('trigger', 'supabase-cron', 'reason', v_reason),
    timeout_milliseconds := case when p_kind = 'media' then 60000 else 30000 end
  ) into v_req;
  insert into app_private.worker_wakes (request_id, queue, reason) values (v_req, p_kind, v_reason) on conflict do nothing;
  delete from app_private.worker_wakes where woken_at < now() - interval '3 days';
  return v_req;
end;
$$;
revoke execute on function app_private.wake_workers(text) from public, anon, authenticated;

-- ------------------------------------------------------- supplier block

create or replace function app_private.supplier_blocked(p_account uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce((select submit_blocked_until > now() from app_private.provider_accounts where id = p_account), false);
$$;

-- --------------------------------------------------------- submission

-- Same as before, plus: while the generation service refuses our account the job waits (bounded) instead of
-- hammering it, and a job that waited too long is failed with its credits returned (it was never submitted).
create or replace function public.worker_begin_submission(p_work_item_id uuid, p_lease_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w app_private.job_work_items := app_private.verify_lease(p_work_item_id, p_lease_token);
  j public.generation_jobs;
  m app_private.model_catalog;
  acc app_private.provider_accounts;
  v_ord int;
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
  v_attempt uuid;
  v_recent int;
  v_give_up int := coalesce((app_private.setting('provider_rejection_give_up_minutes'))::text, '20')::int;
begin
  select * into j from public.generation_jobs where id = w.ref_id for update;
  if j.state <> 'queued' then
    perform app_private.finish_work(w.id, 'done', 'job no longer queued: ' || j.state);
    return jsonb_build_object('action', 'skip', 'state', j.state);
  end if;
  select * into m from app_private.model_catalog where id = j.model_id;
  select * into acc from app_private.provider_accounts where id = m.provider_account_id for update;
  if coalesce((app_private.setting('generation_paused'))::text, 'false') = 'true' or acc.paused or not acc.enabled then
    perform app_private.reschedule_work(w.id, 60, 'intake paused');
    return jsonb_build_object('action', 'deferred', 'reason', 'paused');
  end if;
  if j.customer_deadline_at <= now() then
    perform app_private.finish_work(w.id, 'done', 'deadline passed before submission');
    perform app_private.set_job_state(j.id, array['queued'], 'failed',
      jsonb_build_object('failureCode', 'NOT_SUBMITTED', 'failureMessage', 'The job could not be sent before its deadline. Reserved credits were returned.'));
    perform app_private.release_reservation(j.id, 'Not submitted before the deadline');
    update public.generation_jobs set settlement_state = 'released' where id = j.id;
    perform app_private.job_event(j.id, 'failed', 'Could not be sent before the deadline. Reserved credits returned.');
    return jsonb_build_object('action', 'skip', 'state', 'failed');
  end if;
  -- Private staff tests are sent anyway: they are how an operator checks that the account works again.
  if acc.submit_blocked_until > now() and j.purpose <> 'staff_test' then
    if j.created_at < now() - make_interval(mins => v_give_up) then
      perform app_private.finish_work(w.id, 'done', 'supplier refused the account; gave up before submission');
      perform app_private.set_job_state(j.id, array['queued'], 'failed', jsonb_build_object('failureCode', 'SERVICE_UNAVAILABLE',
        'failureMessage', 'The generation service could not take this job. Your reserved credits were returned.'));
      perform app_private.release_reservation(j.id, 'Generation service unavailable before submission');
      update public.generation_jobs set settlement_state = 'released' where id = j.id;
      perform app_private.job_event(j.id, 'failed', 'The generation service could not take the job. Reserved credits returned.');
      perform app_private.notify(j.user_id, 'job_failed:' || j.id, 'job_failed', 'Generation not started',
        'Job ' || j.short_ref || ' could not be started. The reserved credits were returned.', '/studio/library?job=' || j.id);
      return jsonb_build_object('action', 'skip', 'state', 'failed');
    end if;
    perform app_private.reschedule_work(w.id, greatest(15, ceil(extract(epoch from acc.submit_blocked_until - now()))::int) + floor(random() * 15)::int,
      'generation service refusing the account');
    return jsonb_build_object('action', 'deferred', 'reason', 'supplier_blocked');
  end if;
  -- Account-wide create budget, coordinated in the database rather than per function instance (§12.5).
  select count(*) into v_recent from app_private.provider_attempts
  where provider_account_id = acc.id and submitted_at > now() - interval '10 seconds';
  if v_recent >= coalesce((app_private.setting('provider_create_budget_per_10s'))::text, '10')::int then
    perform app_private.reschedule_work(w.id, 3 + floor(random() * 5)::int, 'create budget exhausted');
    return jsonb_build_object('action', 'deferred', 'reason', 'rate_budget');
  end if;

  select coalesce(max(ordinal), 0) + 1 into v_ord from app_private.provider_attempts where job_id = j.id;
  insert into app_private.provider_attempts (job_id, ordinal, provider_account_id, state, request_hash, correlation_token_hash, work_item_id)
  values (j.id, v_ord, acc.id, 'submitting', j.request_hash, encode(extensions.digest(v_token, 'sha256'), 'hex'), w.id)
  returning id into v_attempt;
  perform app_private.set_job_state(j.id, array['queued'], 'submitting');
  perform app_private.job_event(j.id, 'submitting', 'Sending the request to the generation service.');
  -- Committed before the external POST: a crash from here on is reconciled, never blindly resent.
  return jsonb_build_object('action', 'submit', 'attemptId', v_attempt, 'ordinal', v_ord, 'correlationToken', v_token);
end;
$$;

-- p_outcome.kind: accepted | rejected_terminal | rejected_retryable | rejected_account | unknown
create or replace function public.worker_record_submission(p_work_item_id uuid, p_lease_token uuid, p_attempt_id uuid, p_outcome jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w app_private.job_work_items := app_private.verify_lease(p_work_item_id, p_lease_token);
  a app_private.provider_attempts;
  j public.generation_jobs;
  v_kind text := p_outcome ->> 'kind';
  v_task text := nullif(p_outcome ->> 'taskId', '');
  v_backoff int;
  v_existing uuid;
  v_rejections int;
  v_first timestamptz;
  v_give_up int := coalesce((app_private.setting('provider_rejection_give_up_minutes'))::text, '20')::int;
begin
  select * into a from app_private.provider_attempts where id = p_attempt_id and job_id = w.ref_id for update;
  if not found then
    perform app_private.fail('NOT_FOUND', 'Attempt not found.');
  end if;
  select * into j from public.generation_jobs where id = a.job_id for update;

  if v_kind = 'accepted' and v_task is not null then
    select id into v_existing from app_private.provider_attempts
    where provider_account_id = a.provider_account_id and provider_task_id = v_task and id <> a.id;
    if v_existing is not null then
      -- The same task can never belong to two attempts: stop and review instead of double-billing.
      update app_private.provider_attempts set state = 'unknown', error_code = 'TASK_CONFLICT', responded_at = now() where id = a.id;
      perform app_private.set_job_state(j.id, array['submitting', 'submission_unknown'], 'review_required',
        '{"failureCode": "TASK_CONFLICT"}'::jsonb);
      perform app_private.finish_work(w.id, 'done', 'task id conflict');
      return jsonb_build_object('action', 'review');
    end if;
    update app_private.provider_attempts set state = 'accepted', provider_task_id = v_task, responded_at = now() where id = a.id;
    -- An accepted task proves the account works again: lift the circuit breaker.
    update app_private.provider_accounts set submit_blocked_until = null, submit_block_code = null, submit_block_message = null,
      submit_block_since = null
    where id = a.provider_account_id and (submit_blocked_until is not null or submit_block_since is not null);
    if j.state in ('submitting', 'submission_unknown') then
      perform app_private.set_job_state(j.id, array['submitting', 'submission_unknown'], 'provider_pending',
        jsonb_build_object('nextActionAt', now() + interval '15 seconds'));
      perform app_private.job_event(j.id, 'accepted', 'Accepted by the generation service. Generating.');
    end if;
    perform app_private.enqueue_work('genlixs_control', 'job_check', j.id, 'check:' || j.id || ':1', now() + interval '15 seconds',
      jsonb_build_object('n', 1));
    perform app_private.finish_work(w.id, 'done');
    return jsonb_build_object('action', 'check_scheduled', 'taskId', v_task);

  elsif v_kind = 'rejected_account' then
    -- Explicit refusal of our account (KIE 401 access / 402 credits): no task exists. Pause new quotes briefly, keep
    -- the job waiting with an honest message, and give up (returning the credits) after a bounded wait.
    update app_private.provider_attempts set state = 'rejected', error_code = p_outcome ->> 'code', error_message = left(p_outcome ->> 'message', 300),
      responded_at = now() where id = a.id;
    update app_private.provider_accounts set
      submit_blocked_until = now() + make_interval(secs => coalesce((app_private.setting('provider_block_seconds'))::text, '300')::int),
      submit_block_code = left(p_outcome ->> 'code', 40), submit_block_message = left(p_outcome ->> 'message', 300),
      submit_block_since = coalesce(submit_block_since, now())
    where id = a.provider_account_id;
    -- A job that is still open can only have account refusals among its rejected attempts (a terminal one ends it).
    select count(*), min(submitted_at) into v_rejections, v_first from app_private.provider_attempts
    where job_id = j.id and state = 'rejected';
    if v_rejections >= 4 or v_first < now() - make_interval(mins => v_give_up) then
      perform app_private.set_job_state(j.id, array['submitting'], 'failed', jsonb_build_object('failureCode', 'SERVICE_UNAVAILABLE',
        'failureMessage', 'The generation service could not take this job. Your reserved credits were returned.'));
      perform app_private.release_reservation(j.id, 'Not accepted by the generation service (account)');
      update public.generation_jobs set settlement_state = 'released' where id = j.id;
      perform app_private.job_event(j.id, 'failed', 'The generation service could not take the job. Reserved credits returned.');
      perform app_private.notify(j.user_id, 'job_failed:' || j.id, 'job_failed', 'Generation not started',
        'Job ' || j.short_ref || ' could not be started. The reserved credits were returned.', '/studio/library?job=' || j.id);
      perform app_private.finish_work(w.id, 'done');
      return jsonb_build_object('action', 'failed');
    end if;
    perform app_private.set_job_state(j.id, array['submitting'], 'queued');
    v_backoff := (array[60, 120, 300])[least(v_rejections, 3)::int] + floor(random() * 15)::int;
    perform app_private.job_event(j.id, 'waiting_service',
      'The generation service is not taking new jobs at the moment. Your job waits; credits stay reserved and nothing is charged.');
    perform app_private.finish_work(w.id, 'done');
    perform app_private.enqueue_work('genlixs_control', 'job_submit', j.id, 'submit:' || j.id || ':' || (a.ordinal + 1),
      now() + make_interval(secs => v_backoff), '{}'::jsonb);
    return jsonb_build_object('action', 'account_rejected', 'inSeconds', v_backoff);

  elsif v_kind = 'rejected_retryable' then
    update app_private.provider_attempts set state = 'rate_limited', error_code = p_outcome ->> 'code', error_message = left(p_outcome ->> 'message', 300),
      responded_at = now() where id = a.id;
    perform app_private.set_job_state(j.id, array['submitting'], 'queued');
    v_backoff := least(300, (power(2, least(a.ordinal, 8)) * 5)::int) + floor(random() * 10)::int;
    perform app_private.job_event(j.id, 'retry_scheduled', 'The generation service is busy. Your job will be sent again shortly.');
    perform app_private.finish_work(w.id, 'done');
    perform app_private.enqueue_work('genlixs_control', 'job_submit', j.id, 'submit:' || j.id || ':' || (a.ordinal + 1),
      now() + make_interval(secs => v_backoff), '{}'::jsonb);
    return jsonb_build_object('action', 'retry_scheduled', 'inSeconds', v_backoff);

  elsif v_kind = 'rejected_terminal' then
    update app_private.provider_attempts set state = 'rejected', error_code = p_outcome ->> 'code', error_message = left(p_outcome ->> 'message', 300),
      responded_at = now() where id = a.id;
    perform app_private.set_job_state(j.id, array['submitting'], 'failed',
      jsonb_build_object('failureCode', coalesce(p_outcome ->> 'publicCode', 'REJECTED'),
        'failureMessage', coalesce(p_outcome ->> 'publicMessage', 'The generation service did not accept this request.')));
    perform app_private.release_reservation(j.id, 'Request not accepted by the generation service');
    update public.generation_jobs set settlement_state = 'released' where id = j.id;
    perform app_private.job_event(j.id, 'failed', 'Not accepted by the generation service. Reserved credits returned.');
    perform app_private.notify(j.user_id, 'job_failed:' || j.id, 'job_failed', 'Generation failed',
      'Your job ' || j.short_ref || ' was not accepted. The reserved credits were returned.', '/studio/library?job=' || j.id);
    perform app_private.finish_work(w.id, 'done');
    return jsonb_build_object('action', 'failed');

  else
    -- Timeout, lost connection, malformed accepted response, unexplained 5xx: never resend blindly (§12.5).
    update app_private.provider_attempts set state = 'unknown', error_code = coalesce(p_outcome ->> 'code', 'UNKNOWN'),
      error_message = left(p_outcome ->> 'message', 300), responded_at = now() where id = a.id;
    perform app_private.set_job_state(j.id, array['submitting'], 'submission_unknown');
    perform app_private.job_event(j.id, 'verifying', 'Verifying that the generation service received the request.');
    perform app_private.finish_work(w.id, 'done');
    return jsonb_build_object('action', 'unknown');
  end if;
end;
$$;
