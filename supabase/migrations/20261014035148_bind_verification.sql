-- Genlixs 10 · Callback binding is verified inside the database (§15.2). The worker passes what the
-- authoritative KIE task detail recorded as its callBackUrl parameters (attempt id + correlation token);
-- the database compares the token hash with the persisted attempt before binding. Admin-attached task ids
-- go through the same comparison, so a typed task id can never bind a different account's task.
-- The earlier boolean-trusting signature is kept only as a refusing stub.

create or replace function public.worker_bind_task(p_work_item_id uuid, p_lease_token uuid, p_verified boolean, p_evidence text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.fail('DEPRECATED', 'Binding now requires the observed attempt id and correlation token.');
  return null;
end;
$$;
revoke execute on function public.worker_bind_task(uuid, uuid, boolean, text) from public, anon, authenticated, service_role;

create or replace function public.worker_bind_task(p_work_item_id uuid, p_lease_token uuid, p_observed_attempt uuid,
  p_observed_correlation text, p_evidence text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w app_private.job_work_items := app_private.verify_lease(p_work_item_id, p_lease_token);
  a app_private.provider_attempts;
  j public.generation_jobs;
  v_task text := w.payload ->> 'taskId';
  v_verified boolean;
begin
  select * into a from app_private.provider_attempts where id = (w.payload ->> 'attemptId')::uuid for update;
  select * into j from public.generation_jobs where id = a.job_id for update;
  v_verified := p_observed_attempt = a.id
    and p_observed_correlation is not null
    and encode(extensions.digest(p_observed_correlation, 'sha256'), 'hex') = a.correlation_token_hash;
  if not v_verified or a.provider_task_id is not null or j.state not in ('submitting', 'submission_unknown') then
    perform app_private.finish_work(w.id, 'done', 'binding not applied: ' || case when v_verified then 'state' else 'evidence mismatch' end);
    if not v_verified and j.state = 'submission_unknown' then
      update public.generation_jobs set state = 'review_required', state_version = state_version + 1, failure_code = 'BIND_MISMATCH'
      where id = j.id;
    end if;
    return jsonb_build_object('action', 'none', 'verified', v_verified);
  end if;
  if exists (select 1 from app_private.provider_attempts where provider_account_id = a.provider_account_id and provider_task_id = v_task) then
    perform app_private.finish_work(w.id, 'done', 'task already bound elsewhere');
    return jsonb_build_object('action', 'none');
  end if;
  update app_private.provider_attempts set state = 'accepted', provider_task_id = v_task, responded_at = coalesce(responded_at, now()),
    error_message = left('bound after verification: ' || coalesce(p_evidence, ''), 300) where id = a.id;
  perform app_private.set_job_state(j.id, array['submitting', 'submission_unknown'], 'provider_pending',
    jsonb_build_object('nextActionAt', now()));
  perform app_private.job_event(j.id, 'accepted', 'Confirmed with the generation service. Generating.');
  perform app_private.enqueue_work('genlixs_control', 'job_check', j.id, 'check:' || j.id || ':bind:' || a.id, now(), jsonb_build_object('n', 1));
  perform app_private.finish_work(w.id, 'done');
  return jsonb_build_object('action', 'bound', 'taskId', v_task);
end;
$$;
revoke execute on function public.worker_bind_task(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.worker_bind_task(uuid, uuid, uuid, text, text) to service_role;
