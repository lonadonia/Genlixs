-- Genlixs 20 · Generation reliability, part 2: per-model timing, the extended job snapshot, the supplier circuit breaker
-- on quotes/intents and the staff health read (see part 1 for the background).

-- -------------------------------------------------------------- timing

create or replace function app_private.refresh_model_timing(p_model_id text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  insert into app_private.model_timing (model_id, samples, generate_p50_seconds, generate_p80_seconds, save_p50_seconds, updated_at)
  select p_model_id, count(*),
    coalesce(percentile_cont(0.5) within group (order by x.gen), 0), coalesce(percentile_cont(0.8) within group (order by x.gen), 0),
    coalesce(percentile_cont(0.5) within group (order by x.save), 0), now()
  from (
    select greatest(extract(epoch from g.generated_at - a.accepted_at), 0) as gen,
           greatest(extract(epoch from j.completed_at - g.generated_at), 0) as save
    from public.generation_jobs j
    cross join lateral (select min(t.responded_at) as accepted_at from app_private.provider_attempts t
                        where t.job_id = j.id and t.state = 'accepted') a
    cross join lateral (select min(e.created_at) as generated_at from public.generation_job_events e
                        where e.job_id = j.id and e.event = 'importing') g
    where j.model_id = p_model_id and j.state = 'succeeded' and j.completed_at is not null
      and a.accepted_at is not null and g.generated_at is not null
    order by j.completed_at desc
    limit 30
  ) x
  having count(*) > 0
  on conflict (model_id) do update set samples = excluded.samples, generate_p50_seconds = excluded.generate_p50_seconds,
    generate_p80_seconds = excluded.generate_p80_seconds, save_p50_seconds = excluded.save_p50_seconds, updated_at = now();
end;
$$;

-- Same as before; a delivered job also refreshes the model's timing sample.
create or replace function public.worker_record_import(p_work_item_id uuid, p_lease_token uuid, p_assets jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w app_private.job_work_items := app_private.verify_lease(p_work_item_id, p_lease_token);
  j public.generation_jobs;
  x jsonb;
  v_expected int := coalesce((w.payload ->> 'expected')::int, 1);
  v_days int := coalesce((app_private.setting('output_retention_days'))::text, '90')::int;
  v_state text;
  v_count int;
begin
  select * into j from public.generation_jobs where id = w.ref_id for update;
  v_state := case when j.state in ('importing', 'review_required') then 'ready' else 'quarantined' end;
  for x in select * from jsonb_array_elements(coalesce(p_assets, '[]'::jsonb)) loop
    insert into public.assets (user_id, kind, job_id, bucket, object_path, mime, bytes, width, height, duration_ms, sha256, state,
      retention_until, provider_task_id)
    values (j.user_id, 'output', j.id, x ->> 'bucket', x ->> 'path', x ->> 'mime', (x ->> 'bytes')::bigint, nullif(x ->> 'width', '')::int,
      nullif(x ->> 'height', '')::int, nullif(x ->> 'durationMs', '')::int, x ->> 'sha256', v_state,
      now() + make_interval(days => v_days), w.payload ->> 'taskId')
    on conflict (bucket, object_path) do nothing;
  end loop;

  if v_state = 'quarantined' then
    perform app_private.finish_work(w.id, 'done', 'import after terminal state: quarantined');
    return jsonb_build_object('action', 'quarantined', 'state', j.state);
  end if;

  select count(*) into v_count from public.assets where job_id = j.id and kind = 'output' and state = 'ready';
  if v_count < v_expected then
    perform app_private.reschedule_work(w.id, 30, 'incomplete output set');
    return jsonb_build_object('action', 'retry');
  end if;

  -- Deliverables verified and stored: capture exactly once, mark success, notify (§16.6).
  if app_private.capture_reservation(j.id, 'Charged on saved output') <> 'captured' then
    perform app_private.set_job_state(j.id, array['importing', 'review_required'], 'review_required',
      '{"failureCode": "SETTLEMENT_CONFLICT"}'::jsonb);
    perform app_private.finish_work(w.id, 'done', 'reservation already settled');
    return jsonb_build_object('action', 'review');
  end if;
  perform app_private.set_job_state(j.id, array['importing', 'review_required'], 'succeeded');
  update public.generation_jobs set settlement_state = 'captured' where id = j.id;
  perform app_private.job_event(j.id, 'succeeded', 'Ready to download. ' || j.units || ' credits charged.');
  perform app_private.notify(j.user_id, 'job_ready:' || j.id, 'job_ready', 'Your ' || case j.tool when 'video' then 'clip' else 'image' end || ' is ready',
    j.title, '/studio/library?job=' || j.id);
  perform app_private.refresh_model_timing(j.model_id);
  perform app_private.finish_work(w.id, 'done');
  return jsonb_build_object('action', 'succeeded');
end;
$$;

-- Snapshot for the customer and staff views. New fields (additive): a stage summary, when the provider accepted the
-- job and when its result was seen, the last provider progress reading (only when the provider reported one),
-- the model's typical timing (history when there are at least 3 deliveries, otherwise a typical default),
-- the output kind and when the next server check is due. Progress shown to customers is labelled as an estimate
-- unless it comes from the provider.
create or replace function app_private.job_snapshot(p_job uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', j.id, 'ref', j.short_ref, 'tool', j.tool, 'modelId', j.model_id, 'modelName', j.model_name, 'title', j.title,
    'prompt', j.prompt, 'options', j.options, 'referenceAssetIds', to_jsonb(j.reference_asset_ids),
    'units', j.units::text, 'state', j.state, 'settlementState', j.settlement_state,
    'failureCode', j.failure_code, 'failureMessage', j.failure_message,
    'delayedAfterAt', j.delayed_after_at, 'customerDeadlineAt', j.customer_deadline_at,
    'createdAt', j.created_at, 'submittedAt', j.submitted_at, 'completedAt', j.completed_at,
    'favorite', j.favorite, 'parentJobId', j.parent_job_id,
    'stage', case
      when j.state in ('queued', 'submitting') then 'preparing'
      when j.state = 'submission_unknown' then 'confirming'
      when j.state in ('provider_pending', 'processing_delayed') then 'generating'
      when j.state = 'importing' then 'saving'
      when j.state = 'succeeded' then 'ready'
      when j.state = 'review_required' then 'review'
      else j.state end,
    'nextActionAt', j.next_action_at,
    'acceptedAt', (select min(t.responded_at) from app_private.provider_attempts t where t.job_id = j.id and t.state = 'accepted'),
    'generatedAt', (select min(e.created_at) from public.generation_job_events e where e.job_id = j.id and e.event = 'importing'),
    'lastCheckedAt', (select max(o.observed_at) from app_private.provider_observations o where o.job_id = j.id),
    'providerProgress', (
      select jsonb_build_object('value', o.progress, 'at', o.observed_at) from app_private.provider_observations o
      where o.job_id = j.id and o.progress > 0 and o.progress <= 100 and o.normalized_state = 'pending'
      order by o.observed_at desc limit 1),
    'outputKind', cv.spec -> 'output' ->> 'kind',
    'timing', coalesce(
      (select jsonb_build_object('generateSeconds', round(t.generate_p50_seconds), 'generateP80Seconds', round(t.generate_p80_seconds),
         'saveSeconds', round(t.save_p50_seconds), 'samples', t.samples, 'basis', 'history')
       from app_private.model_timing t where t.model_id = j.model_id and t.samples >= 3),
      jsonb_build_object(
        'generateSeconds', coalesce((cv.spec -> 'timing' ->> 'typicalSeconds')::int,
          case when cv.spec -> 'output' ->> 'kind' = 'video' then 150 else 45 end)
          + case when lower(coalesce(j.options ->> 'resolution', j.options ->> 'mode', '')) = '4k' then 420 else 0 end,
        'saveSeconds', case when cv.spec -> 'output' ->> 'kind' = 'video' then 20 else 8 end,
        'samples', coalesce((select t.samples from app_private.model_timing t where t.model_id = j.model_id), 0),
        'basis', 'typical')),
    'outputs', coalesce((
      select jsonb_agg(jsonb_build_object('assetId', a.id, 'mime', a.mime, 'bytes', a.bytes::text, 'width', a.width, 'height', a.height,
        'durationMs', a.duration_ms, 'state', a.state, 'retentionUntil', a.retention_until) order by a.created_at)
      from public.assets a where a.job_id = j.id and a.kind = 'output' and a.state in ('ready', 'expired')
    ), '[]'),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('event', e.event, 'message', e.message, 'at', e.created_at) order by e.created_at)
      from public.generation_job_events e where e.job_id = j.id
    ), '[]')
  )
  from public.generation_jobs j
  left join app_private.model_capability_versions cv on cv.id = j.capability_version_id
  where j.id = p_job;
$$;

-- ---------------------------------------------------------- quotes/intents

-- Customer quote: unchanged, plus the supplier circuit breaker (no reservation while the account is refused).
create or replace function public.create_generation_quote(
  p_model_id text, p_prompt text, p_options jsonb default '{}'::jsonb, p_reference_asset_ids uuid[] default '{}'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_active_user();
  m app_private.model_catalog;
  c app_private.model_capability_versions;
  p app_private.price_versions;
  v_norm jsonb;
  v_opts jsonb;
  v_units bigint;
  v_input jsonb;
  v_hash text;
  v_id uuid;
  v_expires timestamptz;
begin
  if coalesce((app_private.setting('generation_paused'))::text, 'false') = 'true' then
    perform app_private.fail('GENERATION_PAUSED', 'Generation is paused right now. Your draft is saved; try again later.');
  end if;
  if (select count(*) from public.generation_quotes where user_id = v_uid and created_at > now() - interval '1 minute')
     >= coalesce((app_private.setting('max_quotes_per_minute'))::text, '30')::int then
    perform app_private.fail('RATE_LIMITED', 'Too many price checks in a minute. Wait a moment and try again.');
  end if;

  select * into m from app_private.model_catalog where id = p_model_id;
  if not found or m.state not in ('enabled', 'experimental') then
    perform app_private.fail('MODEL_UNAVAILABLE', 'This model is not available right now. Choose another model.');
  end if;
  if exists (select 1 from app_private.provider_accounts a where a.id = m.provider_account_id and (a.paused or not a.enabled)) then
    perform app_private.fail('MODEL_UNAVAILABLE', 'This model is temporarily unavailable. Your draft is saved.');
  end if;
  if app_private.supplier_blocked(m.provider_account_id) then
    perform app_private.fail('SERVICE_UNAVAILABLE', 'Generation is temporarily unavailable. Nothing was charged; try again in a few minutes.');
  end if;
  if not exists (select 1 from public.tools t where t.id = m.tool and t.enabled) then
    perform app_private.fail('TOOL_UNAVAILABLE', 'This tool is not available right now.');
  end if;

  c := app_private.capability_for(m.id);
  select * into p from app_private.price_versions where model_id = m.id and state = 'published';
  if not found or p.capability_version_id <> c.id then
    perform app_private.fail('MODEL_NOT_PRICED', 'This model has no approved price yet.');
  end if;

  v_norm := app_private.normalize_generation_input(v_uid, m.id, c.spec, p_prompt, p_options, p_reference_asset_ids);
  v_opts := v_norm -> 'options';
  v_units := app_private.price_units_for(p.rules, v_opts, (v_norm ->> 'refCount')::int);
  if v_units is null or v_units <= 0 then
    perform app_private.fail('PRICE_INVALID', 'This combination has no valid price. Choose different settings.');
  end if;

  v_input := v_norm -> 'input';
  v_hash := encode(extensions.digest(v_input::text, 'sha256'), 'hex');
  v_expires := now() + make_interval(secs => coalesce((app_private.setting('quote_ttl_seconds'))::text, '300')::int);

  insert into public.generation_quotes (user_id, tool, model_id, capability_version_id, price_version_id, normalized_input, input_hash, units, expires_at)
  values (v_uid, m.tool, m.id, c.id, p.id, v_input, v_hash, v_units, v_expires)
  returning id into v_id;

  return jsonb_build_object(
    'quoteId', v_id, 'creditUnits', v_units::text, 'displayCredits', v_units::text, 'expiresAt', v_expires,
    'priceVersionId', p.id, 'modelCapabilityVersionId', c.id, 'inputHash', v_hash, 'deliveryPolicy', 'complete-output-set',
    'tool', m.tool, 'modelId', m.id, 'options', v_opts, 'availableUnits', app_private.spendable_units(v_uid)::text
  );
end;
$$;
revoke execute on function public.create_generation_quote(text, text, jsonb, uuid[]) from public, anon;
grant execute on function public.create_generation_quote(text, text, jsonb, uuid[]) to authenticated;

-- Intent creation: unchanged, plus the supplier circuit breaker before any reservation.
create or replace function public.create_generation(p_quote_id uuid, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_active_user();
  q public.generation_quotes;
  m app_private.model_catalog;
  v_existing public.generation_jobs;
  v_job uuid := gen_random_uuid();
  v_active int;
  v_title text;
  v_request_hash text;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then
    perform app_private.fail('INVALID_IDEMPOTENCY_KEY', 'Missing or invalid Idempotency-Key.');
  end if;

  -- Serialize every intent of this customer on the wallet row (consistent lock order).
  perform app_private.lock_wallet(v_uid);

  select * into v_existing from public.generation_jobs where user_id = v_uid and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.quote_id = p_quote_id then
      return jsonb_build_object('job', app_private.job_snapshot(v_existing.id), 'replayed', true,
        'wallet', jsonb_build_object('availableUnits', app_private.spendable_units(v_uid)::text,
          'reservedUnits', (select reserved_units::text from public.wallet_accounts where user_id = v_uid)));
    end if;
    perform app_private.fail('IDEMPOTENCY_CONFLICT', 'This request key was already used for a different generation.');
  end if;

  select * into q from public.generation_quotes where id = p_quote_id and user_id = v_uid for update;
  if not found then
    perform app_private.fail('QUOTE_NOT_FOUND', 'This price check is no longer available. Refresh it.');
  end if;
  if q.consumed_at is not null then
    perform app_private.fail('QUOTE_ALREADY_USED', 'This price check was already used. Refresh it to generate again.');
  end if;
  if q.expires_at <= now() then
    perform app_private.fail('QUOTE_EXPIRED', 'The price check expired. Refresh it to continue.');
  end if;
  if coalesce((app_private.setting('generation_paused'))::text, 'false') = 'true' then
    perform app_private.fail('GENERATION_PAUSED', 'Generation is paused right now. Your draft is saved; try again later.');
  end if;

  select * into m from app_private.model_catalog where id = q.model_id;
  if m.state not in ('enabled', 'experimental') then
    perform app_private.fail('MODEL_UNAVAILABLE', 'This model is not available right now. Choose another model.');
  end if;
  if app_private.supplier_blocked(m.provider_account_id) then
    perform app_private.fail('SERVICE_UNAVAILABLE', 'Generation is temporarily unavailable. Nothing was charged; try again in a few minutes.');
  end if;
  -- A price change after the quote requires a new quote; never charge a different price silently.
  if not exists (select 1 from app_private.price_versions where id = q.price_version_id and state = 'published') then
    perform app_private.fail('QUOTE_STALE', 'The price changed. Refresh the quote to see the new cost.');
  end if;

  select count(*) into v_active from public.generation_jobs
  where user_id = v_uid and state not in ('succeeded', 'failed', 'cancelled');
  if v_active >= coalesce((app_private.setting('max_active_jobs_per_user'))::text, '3')::int then
    perform app_private.fail('TOO_MANY_ACTIVE_JOBS', 'Wait for one of your running jobs to finish before starting another.');
  end if;

  perform app_private.expire_due_lots(v_uid);
  perform app_private.reserve_units(v_uid, v_job, q.units);

  v_title := left(regexp_replace(q.normalized_input ->> 'prompt', '\s+', ' ', 'g'), 60);
  v_request_hash := encode(extensions.digest(p_quote_id::text || ':' || q.input_hash, 'sha256'), 'hex');

  insert into public.generation_jobs (
    id, user_id, quote_id, tool, model_id, model_name, capability_version_id, price_version_id, adapter, adapter_version,
    prompt, options, reference_asset_ids, title, units, idempotency_key, request_hash, state, next_action_at,
    delayed_after_at, customer_deadline_at
  ) values (
    v_job, v_uid, q.id, q.tool, m.id, m.public_name, q.capability_version_id, q.price_version_id, m.adapter, m.adapter_version,
    q.normalized_input ->> 'prompt', q.normalized_input -> 'options',
    coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(q.normalized_input -> 'referenceAssetIds') x), '{}'),
    v_title, q.units, p_idempotency_key, v_request_hash, 'queued', now(),
    now() + make_interval(mins => coalesce((app_private.setting('delayed_after_minutes'))::text, '30')::int),
    now() + make_interval(hours => coalesce((app_private.setting('reservation_deadline_hours'))::text, '24')::int)
  );

  update public.generation_quotes set consumed_at = now() where id = q.id;
  perform app_private.job_event(v_job, 'queued', 'Waiting in queue. ' || q.units || ' credits reserved.');
  perform app_private.enqueue_work('genlixs_control', 'job_submit', v_job, 'submit:' || v_job || ':1', now(), '{}'::jsonb);

  return jsonb_build_object('job', app_private.job_snapshot(v_job), 'replayed', false,
    'wallet', jsonb_build_object('availableUnits', app_private.spendable_units(v_uid)::text,
      'reservedUnits', (select reserved_units::text from public.wallet_accounts where user_id = v_uid)));
end;
$$;
revoke execute on function public.create_generation(uuid, text) from public, anon;
grant execute on function public.create_generation(uuid, text) to authenticated;

-- ---------------------------------------------------------- staff health

-- Generation pipeline health for staff: Cron wake-ups and their real responses, queue backlog, active jobs,
-- submission and import outcomes, the supplier circuit breaker and the watchdog. Host names only; never secrets.
create or replace function public.admin_generation_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('admin.access');
begin
  if not (app_private.has_capability(v_actor, 'provider.read') or app_private.has_capability(v_actor, 'jobs.read')) then
    perform app_private.fail('FORBIDDEN', 'Your role does not allow this view.');
  end if;
  return jsonb_build_object(
    'checkedAt', now(),
    'wake', (
      select jsonb_build_object(
        'configured', exists (select 1 from vault.decrypted_secrets where name = 'genlixs_worker_base_url' and coalesce(decrypted_secret, '') <> '')
                      and exists (select 1 from vault.decrypted_secrets where name = 'genlixs_worker_token' and coalesce(decrypted_secret, '') <> ''),
        'host', (select nullif(regexp_replace(regexp_replace(decrypted_secret, '^[a-zA-Z]+://', ''), '[/?#].*$', ''), '')
                 from vault.decrypted_secrets where name = 'genlixs_worker_base_url'),
        'sent6h', count(*),
        'ok6h', count(*) filter (where r.status_code between 200 and 299),
        'failed6h', count(*) filter (where r.id is not null and not coalesce(r.status_code between 200 and 299, false)),
        'lastWokenAt', max(w.woken_at),
        'lastOkAt', max(w.woken_at) filter (where r.status_code between 200 and 299),
        'lastError', (select coalesce(r2.error_msg, 'HTTP ' || r2.status_code)
                      from app_private.worker_wakes w2 join net._http_response r2 on r2.id = w2.request_id
                      where not coalesce(r2.status_code between 200 and 299, false) order by w2.woken_at desc limit 1),
        'lastErrorAt', (select w2.woken_at from app_private.worker_wakes w2 join net._http_response r2 on r2.id = w2.request_id
                        where not coalesce(r2.status_code between 200 and 299, false) order by w2.woken_at desc limit 1))
      from app_private.worker_wakes w left join net._http_response r on r.id = w.request_id
      where w.woken_at > now() - interval '6 hours'),
    'queues', (
      select coalesce(jsonb_agg(jsonb_build_object('queue', q.queue, 'due', q.due, 'oldestDueSeconds', q.oldest, 'leased', q.leased,
        'dead24h', q.dead) order by q.queue), '[]')
      from (select queue,
                   count(*) filter (where state = 'pending' and due_at <= now()) as due,
                   extract(epoch from now() - min(due_at) filter (where state = 'pending' and due_at <= now()))::int as oldest,
                   count(*) filter (where state = 'leased') as leased,
                   count(*) filter (where state = 'dead' and updated_at > now() - interval '24 hours') as dead
            from app_private.job_work_items group by queue) q),
    'jobs', (
      select jsonb_build_object(
        'active', count(*), 'byState', coalesce(jsonb_object_agg(s.state, s.n) filter (where s.state is not null), '{}'),
        'oldestActiveSeconds', max(s.oldest))
      from (select state, count(*) as n, extract(epoch from now() - min(created_at))::int as oldest from public.generation_jobs
            where state not in ('succeeded', 'failed', 'cancelled') group by state) s),
    'submissions24h', (
      select coalesce(jsonb_agg(jsonb_build_object('outcome', x.outcome, 'count', x.n, 'lastAt', x.last_at, 'lastMessage', x.msg)
        order by x.last_at desc), '[]')
      from (select coalesce(error_code, state) as outcome, count(*) as n, max(submitted_at) as last_at,
                   (array_agg(error_message order by submitted_at desc))[1] as msg
            from app_private.provider_attempts where submitted_at > now() - interval '24 hours' group by 1) x),
    'imports24h', (
      select jsonb_build_object('done', count(*) filter (where state = 'done'), 'dead', count(*) filter (where state = 'dead'),
        'pending', count(*) filter (where state in ('pending', 'leased')),
        'lastError', (array_agg(last_error order by updated_at desc) filter (where state = 'dead'))[1])
      from app_private.job_work_items where kind = 'job_import' and updated_at > now() - interval '24 hours'),
    'supplier', (
      select jsonb_build_object('blockedUntil', submit_blocked_until, 'blocked', coalesce(submit_blocked_until > now(), false),
        'code', submit_block_code, 'message', submit_block_message, 'since', submit_block_since,
        'balance', last_balance, 'balanceAt', last_balance_at, 'paused', paused)
      from app_private.provider_accounts where provider = 'kie' and label = 'primary'),
    'watchdogHeartbeat', (app_private.setting('watchdog_heartbeat')) #>> '{}'
  );
end;
$$;
revoke execute on function public.admin_generation_health() from public, anon;
grant execute on function public.admin_generation_health() to authenticated;
