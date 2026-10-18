-- Settings of a model that at least one routable offer can fulfil (structural checks only). Options and modes the
-- public catalog shows are narrowed to these; NULL = no routable offer (the catalog keeps the specification).
create or replace function app_private.routable_spec(p_model_id text, p_spec jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  o record;
  v_inherit boolean := false;
  v_any boolean := false;
  v_opts jsonb := '{}'::jsonb;
  v_off jsonb;
  v_usable boolean;
  v_modes jsonb := '[]'::jsonb;
  k text;
  spec_opt jsonb;
  kept jsonb;
  val jsonb;
  allowed jsonb;
  n numeric;
begin
  for o in
    select f.capabilities from app_private.provider_offers f
    join app_private.provider_accounts a on a.id = f.provider_account_id
    where f.model_id = p_model_id and f.routing_enabled and f.status = 'eligible' and f.adapter is not null
      and a.enabled and not a.paused and (a.credential_version > 0 or a.secret_ref = 'KIE_API_KEY') and a.connection_state <> 'unauthorized'
  loop
    if coalesce((o.capabilities ->> 'inherit')::boolean, false) then
      v_inherit := true;
      v_any := true;
      exit;
    end if;
    -- Values this offer supports per option; an offer that cannot take any value of some option serves nothing.
    v_off := '{}'::jsonb;
    v_usable := true;
    for k, spec_opt in select key, value from jsonb_each(coalesce(p_spec -> 'options', '{}'::jsonb)) loop
      allowed := o.capabilities -> 'options' -> k;
      kept := '[]'::jsonb;
      for val in select value from jsonb_array_elements(coalesce(spec_opt -> 'values', '[]'::jsonb)) loop
        n := app_private.num(val);
        if allowed is not null and (
             (jsonb_typeof(allowed) = 'array' and (allowed @> jsonb_build_array(val) or allowed @> jsonb_build_array(val #>> '{}')))
          or (jsonb_typeof(allowed) = 'object' and n is not null and n >= coalesce(app_private.num(allowed -> 'min'), n)
              and n <= coalesce(app_private.num(allowed -> 'max'), n))) then
          kept := kept || jsonb_build_array(val);
        end if;
      end loop;
      if jsonb_array_length(kept) = 0 then
        v_usable := false;
        exit;
      end if;
      v_off := v_off || jsonb_build_object(k, kept);
    end loop;
    if not v_usable then
      continue;
    end if;
    v_any := true;
    v_modes := v_modes || coalesce(o.capabilities -> 'modes', '[]'::jsonb);
    for k, kept in select key, value from jsonb_each(v_off) loop
      v_opts := v_opts || jsonb_build_object(k, coalesce(v_opts -> k, '[]'::jsonb) || kept);
    end loop;
  end loop;
  if not v_any then
    return null;
  end if;
  if v_inherit then
    return p_spec;
  end if;
  -- Keep the specification's order and labels; a default that is no longer offered moves to the first offered value.
  return p_spec
    || jsonb_build_object('options', coalesce((
         select jsonb_object_agg(e.key, e.value || jsonb_build_object(
           'values', (select coalesce(jsonb_agg(x order by ord), '[]'::jsonb) from jsonb_array_elements(e.value -> 'values') with ordinality t(x, ord)
                      where coalesce(v_opts -> e.key, '[]'::jsonb) @> jsonb_build_array(x)),
           'default', case when coalesce(v_opts -> e.key, '[]'::jsonb) @> jsonb_build_array(e.value -> 'default') then e.value -> 'default'
                           else (select x from jsonb_array_elements(e.value -> 'values') with ordinality t(x, ord)
                                 where coalesce(v_opts -> e.key, '[]'::jsonb) @> jsonb_build_array(x) order by ord limit 1) end))
         from jsonb_each(coalesce(p_spec -> 'options', '{}'::jsonb)) e), '{}'::jsonb))
    || case when p_spec ? 'modes' then jsonb_build_object('modes', coalesce((
         select jsonb_agg(m order by ord) from jsonb_array_elements(p_spec -> 'modes') with ordinality t(m, ord)
         where v_modes @> jsonb_build_array(m ->> 'id')), '[]'::jsonb)) else '{}'::jsonb end;
end;
$$;

-- ===================================================================== worker

-- Submission with routing. Same guarantees as worker_begin_submission (one attempt row committed before the external
-- POST, deadline and pause handling, account-wide create budget), plus: the route is chosen here on the server from
-- the job's frozen settings, saved on the attempt with its price, unit, funding terms and key version, and an
-- estimated cost row is written to the supplier cost ledger.
create or replace function public.worker_begin_submission_v2(p_work_item_id uuid, p_lease_token uuid, p_runtime jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w app_private.job_work_items := app_private.verify_lease(p_work_item_id, p_lease_token);
  j public.generation_jobs;
  q public.generation_quotes;
  acc app_private.provider_accounts;
  v_spec jsonb;
  v_qty jsonb;
  v_pin uuid;
  v_choice jsonb;
  c jsonb;
  v_ord int;
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
  v_attempt uuid;
  v_recent int;
  v_give_up int := coalesce((app_private.setting('provider_rejection_give_up_minutes'))::text, '20')::int;
  v_route jsonb;
  v_wait int;
begin
  select * into j from public.generation_jobs where id = w.ref_id for update;
  if j.state <> 'queued' then
    perform app_private.finish_work(w.id, 'done', 'job no longer queued: ' || j.state);
    return jsonb_build_object('action', 'skip', 'state', j.state);
  end if;
  if coalesce((app_private.setting('generation_paused'))::text, 'false') = 'true' then
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

  select * into q from public.generation_quotes where id = j.quote_id;
  select cv.spec into v_spec from app_private.model_capability_versions cv where cv.id = j.capability_version_id;
  v_qty := app_private.request_quantities(v_spec, q.normalized_input);
  select offer_id into v_pin from app_private.job_route_pins where job_id = j.id;
  v_choice := app_private.route_choose(j.model_id, j.options, q.normalized_input ->> 'mode', v_qty, coalesce(p_runtime, '{}'::jsonb),
    v_pin, j.purpose = 'staff_test');

  if v_choice ->> 'status' = 'unavailable' then
    -- No eligible offer (switched off, no key, not verified): the job waits until its deadline, as for a paused account.
    perform app_private.reschedule_work(w.id, 60, 'no eligible supplier offer');
    return jsonb_build_object('action', 'deferred', 'reason', 'no_route');
  end if;
  if v_choice ->> 'status' = 'blocked' then
    if j.created_at < now() - make_interval(mins => v_give_up) then
      perform app_private.finish_work(w.id, 'done', 'every eligible supplier refused or was unavailable; gave up before submission');
      perform app_private.set_job_state(j.id, array['queued'], 'failed', jsonb_build_object('failureCode', 'SERVICE_UNAVAILABLE',
        'failureMessage', 'The generation service could not take this job. Your reserved credits were returned.'));
      perform app_private.release_reservation(j.id, 'Generation service unavailable before submission');
      update public.generation_jobs set settlement_state = 'released' where id = j.id;
      perform app_private.job_event(j.id, 'failed', 'The generation service could not take the job. Reserved credits returned.');
      perform app_private.notify(j.user_id, 'job_failed:' || j.id, 'job_failed', 'Generation not started',
        'Job ' || j.short_ref || ' could not be started. The reserved credits were returned.', '/studio/library?job=' || j.id);
      return jsonb_build_object('action', 'skip', 'state', 'failed');
    end if;
    v_wait := case when (v_choice ->> 'blockedUntil')::timestamptz > now()
      then greatest(15, ceil(extract(epoch from (v_choice ->> 'blockedUntil')::timestamptz - now()))::int) else 300 end;
    perform app_private.reschedule_work(w.id, v_wait + floor(random() * 15)::int, 'generation service refusing the account');
    return jsonb_build_object('action', 'deferred', 'reason', 'supplier_blocked');
  end if;

  c := v_choice -> 'chosen';
  select * into acc from app_private.provider_accounts where id = (c ->> 'accountId')::uuid for update;
  -- Account-wide create budget, coordinated in the database rather than per function instance (§12.5).
  select count(*) into v_recent from app_private.provider_attempts
  where provider_account_id = acc.id and submitted_at > now() - interval '10 seconds';
  if v_recent >= coalesce((app_private.setting('provider_create_budget_per_10s'))::text, '10')::int then
    perform app_private.reschedule_work(w.id, 3 + floor(random() * 5)::int, 'create budget exhausted');
    return jsonb_build_object('action', 'deferred', 'reason', 'rate_budget');
  end if;

  -- The original route keeps the adapter and provider model the job was quoted with (as before routing existed).
  v_route := jsonb_build_object(
    'offerId', c ->> 'offerId', 'accountId', acc.id, 'provider', acc.provider, 'legacy', (c ->> 'legacy')::boolean,
    'adapter', case when (c ->> 'legacy')::boolean then j.adapter else c ->> 'adapter' end,
    'upstreamModelId', case when (c ->> 'legacy')::boolean then (select m.provider_model_id from app_private.model_catalog m where m.id = j.model_id)
      else c ->> 'upstreamModelId' end,
    'request', (select f.capabilities -> 'request' from app_private.provider_offers f where f.id = (c ->> 'offerId')::uuid),
    'credentialVersion', (c ->> 'credentialVersion')::int,
    'credentialSource', c ->> 'credentialSource', 'secretRef', acc.secret_ref,
    'price', c -> 'price', 'unit', c ->> 'unit', 'unitVersionId', c ->> 'unitVersionId', 'unitsPerUsd', c -> 'unitsPerUsd',
    'funding', jsonb_build_object('feeBps', c -> 'feeBps', 'bonusBps', c -> 'bonusBps', 'version', c -> 'fundingVersion'),
    'estimate', jsonb_build_object('native', c -> 'native', 'nominalUsd', c -> 'nominalUsd', 'effectiveUsd', c -> 'effectiveUsd'),
    'options', j.options, 'mode', q.normalized_input ->> 'mode', 'quantities', v_qty, 'pinned', v_pin is not null,
    'explanation', v_choice ->> 'explanation', 'cheapestUsd', v_choice -> 'cheapestUsd',
    'candidates', (select coalesce(jsonb_agg(jsonb_build_object('offerId', x ->> 'offerId', 'provider', x ->> 'provider',
        'effectiveUsd', x -> 'effectiveUsd', 'excluded', x ->> 'excluded')), '[]'::jsonb) from jsonb_array_elements(v_choice -> 'candidates') x),
    'decidedAt', v_choice -> 'decidedAt');

  select coalesce(max(ordinal), 0) + 1 into v_ord from app_private.provider_attempts where job_id = j.id;
  insert into app_private.provider_attempts (job_id, ordinal, provider_account_id, state, request_hash, correlation_token_hash, work_item_id,
    offer_id, credential_version, route)
  values (j.id, v_ord, acc.id, 'submitting', j.request_hash, encode(extensions.digest(v_token, 'sha256'), 'hex'), w.id,
    (c ->> 'offerId')::uuid, (c ->> 'credentialVersion')::int, v_route)
  returning id into v_attempt;
  insert into app_private.provider_cost_ledger (attempt_id, job_id, user_id, purpose, provider_account_id, offer_id, model_id, upstream_model_id,
    options, quantities, native_unit, unit_version_id, units_per_usd, funding, price_ref, estimated_native, estimated_usd, estimated_effective_usd,
    state, source)
  values (v_attempt, j.id, j.user_id, j.purpose, acc.id, (c ->> 'offerId')::uuid, j.model_id, v_route ->> 'upstreamModelId', j.options, v_qty,
    c ->> 'unit', (c ->> 'unitVersionId')::uuid, (c ->> 'unitsPerUsd')::numeric, v_route -> 'funding', c -> 'price',
    (c ->> 'native')::numeric, (c ->> 'nominalUsd')::numeric, (c ->> 'effectiveUsd')::numeric, 'reserved', 'route');
  perform app_private.set_job_state(j.id, array['queued'], 'submitting');
  perform app_private.job_event(j.id, 'submitting', 'Sending the request to the generation service.');
  -- Committed before the external POST: a crash from here on is reconciled, never blindly resent.
  return jsonb_build_object('action', 'submit', 'attemptId', v_attempt, 'ordinal', v_ord, 'correlationToken', v_token, 'route', v_route);
end;
$$;
revoke execute on function public.worker_begin_submission_v2(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.worker_begin_submission_v2(uuid, uuid, jsonb) to service_role;

-- The pinned route of the job's latest attempt (status checks, task binding and result import use the supplier that
-- took the job, whatever Admin changed since). Attempts from before routing resolve to their KIE account.
create or replace function public.worker_attempt_route(p_work_item_id uuid, p_lease_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w app_private.job_work_items := app_private.verify_lease(p_work_item_id, p_lease_token);
  r jsonb;
begin
  select jsonb_build_object('attemptId', a.id, 'ordinal', a.ordinal, 'state', a.state, 'taskId', a.provider_task_id,
      'provider', pa.provider, 'accountId', pa.id, 'offerId', a.offer_id,
      'adapter', coalesce(a.route ->> 'adapter', j.adapter), 'upstreamModelId', coalesce(a.route ->> 'upstreamModelId', m.provider_model_id),
      'credentialVersion', coalesce(a.credential_version, 0),
      'credentialSource', coalesce(a.route ->> 'credentialSource', case when coalesce(a.credential_version, 0) > 0 then 'vault' else 'environment' end),
      'secretRef', pa.secret_ref, 'unit', a.route ->> 'unit', 'request', a.route -> 'request',
      'legacy', coalesce((a.route ->> 'legacy')::boolean, a.route is null), 'estimate', a.route -> 'estimate')
  into r
  from app_private.provider_attempts a
  join app_private.provider_accounts pa on pa.id = a.provider_account_id
  join public.generation_jobs j on j.id = a.job_id
  left join app_private.model_catalog m on m.id = j.model_id
  where a.job_id = w.ref_id
  order by a.ordinal desc limit 1;
  return r;
end;
$$;
revoke execute on function public.worker_attempt_route(uuid, uuid) from public, anon, authenticated;
grant execute on function public.worker_attempt_route(uuid, uuid) to service_role;

-- Decrypted key of one stored version, for the server's workers and connection tests only (service role).
create or replace function public.worker_provider_credential(p_account_id uuid, p_version int)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret text;
begin
  select d.decrypted_secret into v_secret
  from app_private.provider_credentials c
  join vault.decrypted_secrets d on d.id = c.secret_id
  where c.provider_account_id = p_account_id and c.version = p_version and c.purged_at is null;
  if v_secret is null then
    perform app_private.fail('CREDENTIAL_UNAVAILABLE', 'The key version used by this provider account is not stored any more.');
  end if;
  return jsonb_build_object('version', p_version, 'secret', v_secret);
end;
$$;
revoke execute on function public.worker_provider_credential(uuid, int) from public, anon, authenticated;
grant execute on function public.worker_provider_credential(uuid, int) to service_role;

-- Deletes the Vault secret of retired key versions once no open job can still need them.
create or replace function app_private.purge_retired_credentials(p_account_id uuid)
returns int
language plpgsql
set search_path = ''
as $$
declare
  r app_private.provider_credentials;
  n int := 0;
begin
  for r in select * from app_private.provider_credentials
           where provider_account_id = p_account_id and retired_at is not null and purged_at is null for update loop
    if not exists (
      select 1 from app_private.provider_attempts a join public.generation_jobs j on j.id = a.job_id
      where a.provider_account_id = p_account_id and a.credential_version = r.version
        and j.state not in ('succeeded', 'failed', 'cancelled')
    ) then
      if r.secret_id is not null then
        delete from vault.secrets where id = r.secret_id;
      end if;
      update app_private.provider_credentials set secret_id = null, purged_at = now()
      where provider_account_id = r.provider_account_id and version = r.version;
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- ---------------------------------------------------------- ledger transitions

-- Attempt outcomes move the ledger row: accepted = cost expected (awaiting confirmation); a definite refusal = no
-- charge; an unknown submission stays visible as such and is never treated as refunded.
create or replace function app_private.ledger_follow_attempt()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.state is distinct from old.state then
    update app_private.provider_cost_ledger set state = case new.state
        when 'accepted' then 'pending_confirmation'
        when 'rejected' then 'not_charged'
        when 'rate_limited' then 'not_charged'
        when 'unknown' then 'submission_unknown'
        else state end
    where attempt_id = new.id and state in ('reserved', 'submission_unknown');
  end if;
  return new;
end;
$$;
create trigger provider_attempts_ledger after update of state on app_private.provider_attempts
  for each row execute function app_private.ledger_follow_attempt();

-- A provider-reported charge (in the attempt's native unit) confirms the cost; a failed task without a reported
-- charge is recorded as failed (the providers in scope document that failed tasks are not billed).
create or replace function app_private.ledger_follow_observation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  l app_private.provider_cost_ledger;
  v_native numeric;
begin
  if new.attempt_id is null then
    return new;
  end if;
  select * into l from app_private.provider_cost_ledger where attempt_id = new.attempt_id for update;
  if not found then
    return new;
  end if;
  v_native := new.credits_consumed;
  if new.normalized_state in ('success', 'fail') and v_native is not null and v_native >= 0 and l.state <> 'confirmed' then
    update app_private.provider_cost_ledger set confirmed_native = v_native,
      confirmed_usd = case when l.units_per_usd is not null then round(v_native / l.units_per_usd, 10) end,
      confirmed_effective_usd = app_private.effective_usd(v_native, l.units_per_usd, app_private.num(l.funding -> 'feeBps'), app_private.num(l.funding -> 'bonusBps')),
      state = case when v_native = 0 and new.normalized_state = 'fail' then 'failed' else 'confirmed' end,
      confirmation_source = 'task_report', confirmed_at = now()
    where id = l.id;
  elsif new.normalized_state = 'fail' and l.state in ('pending_confirmation', 'submission_unknown', 'reserved') then
    update app_private.provider_cost_ledger set state = 'failed', note = coalesce(note, 'Task failed; the provider reported no charge.')
    where id = l.id;
  elsif new.normalized_state = 'success' and l.state in ('submission_unknown', 'reserved') then
    update app_private.provider_cost_ledger set state = 'pending_confirmation' where id = l.id;
  end if;
  return new;
end;
$$;
create trigger provider_observations_ledger after insert on app_private.provider_observations
  for each row execute function app_private.ledger_follow_observation();

-- ------------------------------------------------------------- balance and checks

-- One balance/connection result from the server (service role). Unknown stays NULL; a failure never replaces the last
-- real value. p_result: {ok, error?, state?: ok|failed|unauthorized|unsupported, total?, available?, held?, unit?,
-- scope?: wallet|key, unlimited?, note?, source: admin|auto|worker, connection?: boolean}
create or replace function public.record_provider_check(p_account_id uuid, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  acc app_private.provider_accounts;
  v_ok boolean := coalesce((p_result ->> 'ok')::boolean, false);
  v_total numeric := app_private.num(p_result -> 'total');
  v_avail numeric := app_private.num(p_result -> 'available');
  v_held numeric := app_private.num(p_result -> 'held');
  v_unlimited boolean := coalesce((p_result ->> 'unlimited')::boolean, false);
  v_state text := coalesce(p_result ->> 'state', case when v_ok then 'ok' else 'failed' end);
  v_source text := case when p_result ->> 'source' in ('admin', 'auto', 'worker') then p_result ->> 'source' else 'worker' end;
  v_err text := left(coalesce(p_result ->> 'error', 'UNKNOWN'), 120);
begin
  select * into acc from app_private.provider_accounts where id = p_account_id for update;
  if not found then
    perform app_private.fail('NOT_FOUND', 'Provider account not found.');
  end if;
  if v_state not in ('ok', 'failed', 'unauthorized', 'unsupported') then
    v_state := 'failed';
  end if;
  if v_state = 'unsupported' then
    -- No documented read-only balance call: nothing is recorded as a balance.
    update app_private.provider_accounts set connection_state = case when coalesce((p_result ->> 'connection')::boolean, false) then 'unsupported' else connection_state end,
      connection_checked_at = case when coalesce((p_result ->> 'connection')::boolean, false) then now() else connection_checked_at end,
      connection_message = case when coalesce((p_result ->> 'connection')::boolean, false) then 'No documented read-only check for this provider' else connection_message end,
      last_balance_attempt_at = now()
    where id = acc.id;
    return jsonb_build_object('recorded', false, 'state', v_state);
  end if;
  if v_ok and v_total is null and v_avail is null and not v_unlimited then
    v_ok := false;
    v_err := 'MALFORMED_BALANCE';
    v_state := 'failed';
  end if;
  insert into app_private.provider_balance_snapshots (provider_account_id, ok, credits, available, held, unit, scope, kind, unlimited, error_code, source)
  values (acc.id, v_ok, case when v_ok then v_total end, case when v_ok then v_avail end, case when v_ok then v_held end,
    coalesce(p_result ->> 'unit', acc.balance_unit, acc.native_unit), p_result ->> 'scope', 'api', case when v_ok then v_unlimited end,
    case when not v_ok then v_err end, v_source);
  if v_ok then
    update app_private.provider_accounts set last_balance = v_total, balance_available = v_avail, balance_held = v_held,
      balance_unit = coalesce(p_result ->> 'unit', balance_unit, native_unit), balance_scope = p_result ->> 'scope', balance_source = 'api',
      key_quota_unlimited = v_unlimited, balance_note = left(p_result ->> 'note', 300),
      last_balance_at = now(), last_balance_attempt_at = now(), last_balance_error = null, last_balance_error_at = null
    where id = acc.id;
  else
    update app_private.provider_accounts set last_balance_error = v_err, last_balance_error_at = now(), last_balance_attempt_at = now()
    where id = acc.id;
  end if;
  if coalesce((p_result ->> 'connection')::boolean, false) then
    update app_private.provider_accounts set connection_state = v_state, connection_checked_at = now(),
      connection_message = case when v_ok then null else v_err end
    where id = acc.id;
  end if;
  perform app_private.purge_retired_credentials(acc.id);
  return jsonb_build_object('recorded', true, 'ok', v_ok, 'state', v_state);
end;
$$;
