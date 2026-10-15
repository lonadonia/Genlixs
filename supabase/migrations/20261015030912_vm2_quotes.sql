-- Genlixs 22 · Video modes, part 2: quotes and private tests with typed inputs, and the worker claim that carries them.

-- -------------------------------------------------------------- quotes

-- Customer quote with typed inputs. Same gates and pricing as create_generation_quote; the normalized input (prompt,
-- options incl. derived ones, ordered inputs, mode) is frozen with the price and hashed.
create or replace function public.create_generation_quote_v2(
  p_model_id text, p_prompt text, p_options jsonb default '{}'::jsonb, p_inputs jsonb default '{}'::jsonb
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

  v_norm := app_private.normalize_generation_input_v2(v_uid, m.id, c.spec, p_prompt, p_options, p_inputs, '{}');
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
    'tool', m.tool, 'modelId', m.id, 'options', v_opts, 'mode', v_norm ->> 'mode', 'inputs', v_input -> 'inputs',
    'availableUnits', app_private.spendable_units(v_uid)::text
  );
end;
$$;
revoke execute on function public.create_generation_quote_v2(text, text, jsonb, jsonb) from public, anon;
grant execute on function public.create_generation_quote_v2(text, text, jsonb, jsonb) to authenticated;

-- Private staff test with typed inputs (same pipeline and guarantees as admin_create_model_test).
create or replace function public.admin_create_model_test_v2(p_model_id text, p_prompt text, p_options jsonb, p_inputs jsonb,
  p_idempotency_key text, p_confirm_spend boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_capability('catalog.test');
  m app_private.model_catalog;
  c app_private.model_capability_versions;
  sc app_private.supplier_cost_versions;
  acc app_private.provider_accounts;
  v_existing public.generation_jobs;
  v_open public.generation_jobs;
  v_norm jsonb;
  v_est numeric;
  v_quote uuid;
  v_job uuid := gen_random_uuid();
  v_hash text;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then
    perform app_private.fail('INVALID_IDEMPOTENCY_KEY', 'Missing or invalid Idempotency-Key.');
  end if;
  perform pg_advisory_xact_lock(hashtext('genlixs:test:' || coalesce(p_model_id, '')));
  select * into v_existing from public.generation_jobs where user_id = v_uid and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.purpose = 'staff_test' and v_existing.model_id = p_model_id then
      return jsonb_build_object('job', app_private.job_snapshot(v_existing.id), 'replayed', true);
    end if;
    perform app_private.fail('IDEMPOTENCY_CONFLICT', 'This request key was already used for a different request.');
  end if;
  if not coalesce(p_confirm_spend, false) then
    perform app_private.fail('SPEND_CONFIRMATION_REQUIRED', 'Confirm that this test spends credits from the KIE account.');
  end if;
  select * into m from app_private.model_catalog where id = p_model_id;
  if not found then perform app_private.fail('NOT_FOUND', 'Model not found.'); end if;
  if not exists (select 1 from app_private.provider_adapters a where a.adapter = m.adapter) then
    perform app_private.fail('ADAPTER_NOT_IMPLEMENTED', 'This release has no integration for this model, so it cannot be tested.');
  end if;
  select * into v_open from public.generation_jobs
  where purpose = 'staff_test' and model_id = m.id and state not in ('succeeded', 'failed', 'cancelled')
  order by created_at desc limit 1;
  if found then
    perform app_private.fail('TEST_IN_PROGRESS', 'A test of this model is still running (' || v_open.short_ref || '). Wait for it to finish.',
      jsonb_build_object('jobId', v_open.id, 'ref', v_open.short_ref));
  end if;
  select * into acc from app_private.provider_accounts where id = m.provider_account_id;
  if acc.paused or not acc.enabled then
    perform app_private.fail('PROVIDER_PAUSED', 'The KIE account is paused in Genlixs; tests are not sent.');
  end if;
  if coalesce((app_private.setting('generation_paused'))::text, 'false') = 'true' then
    perform app_private.fail('GENERATION_PAUSED', 'Generation is paused (emergency stop); tests are not sent either.');
  end if;

  c := app_private.capability_for(m.id);
  v_norm := app_private.normalize_generation_input_v2(v_uid, m.id, c.spec, p_prompt, p_options, p_inputs, '{}');
  sc := app_private.latest_cost_version(m.id);
  v_est := app_private.supplier_credits(sc.schedule, v_norm -> 'options', (v_norm ->> 'refCount')::int, coalesce((c.spec -> 'output' ->> 'count')::int, 1));
  v_hash := encode(extensions.digest((v_norm -> 'input')::text, 'sha256'), 'hex');

  insert into public.generation_quotes (user_id, tool, model_id, capability_version_id, price_version_id, normalized_input, input_hash, units,
    expires_at, consumed_at, purpose)
  values (v_uid, m.tool, m.id, c.id, null, v_norm -> 'input', v_hash, 0, now(), now(), 'staff_test')
  returning id into v_quote;

  insert into public.generation_jobs (
    id, user_id, quote_id, tool, model_id, model_name, capability_version_id, price_version_id, adapter, adapter_version,
    prompt, options, reference_asset_ids, title, units, idempotency_key, request_hash, state, settlement_state, next_action_at,
    delayed_after_at, customer_deadline_at, purpose
  ) values (
    v_job, v_uid, v_quote, m.tool, m.id, m.public_name, c.id, null, m.adapter, m.adapter_version,
    v_norm -> 'input' ->> 'prompt', v_norm -> 'options',
    coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(v_norm -> 'input' -> 'referenceAssetIds') x), '{}'),
    left('Test · ' || coalesce(nullif(regexp_replace(v_norm -> 'input' ->> 'prompt', '\s+', ' ', 'g'), ''), m.public_name), 60), 0, p_idempotency_key,
    encode(extensions.digest(v_quote::text || ':' || v_hash, 'sha256'), 'hex'), 'queued', 'released', now(),
    now() + make_interval(mins => coalesce((app_private.setting('delayed_after_minutes'))::text, '30')::int),
    now() + make_interval(hours => coalesce((app_private.setting('reservation_deadline_hours'))::text, '24')::int),
    'staff_test'
  );
  insert into app_private.model_test_runs (job_id, model_id, capability_version_id, adapter, adapter_version, requested_by, input,
    supplier_cost_version_id, estimated_supplier_credits)
  values (v_job, m.id, c.id, m.adapter, m.adapter_version, v_uid, v_norm -> 'input', sc.id, v_est);
  perform app_private.job_event(v_job, 'queued', 'Staff test queued. No customer credits are reserved or charged.');
  perform app_private.enqueue_work('genlixs_control', 'job_submit', v_job, 'submit:' || v_job || ':1', now(), '{}'::jsonb);
  perform app_private.audit(v_uid, 'catalog.test', 'model.test_started', 'model', m.id,
    'Started a paid private test' || coalesce(' (about ' || trim_scale(round(v_est, 4))::text || ' KIE credits, estimated from cost v' || sc.version || ')', ''),
    null, jsonb_build_object('jobId', v_job, 'options', v_norm -> 'options', 'mode', v_norm ->> 'mode'));
  return jsonb_build_object('job', app_private.job_snapshot(v_job), 'replayed', false, 'estimatedSupplierCredits', v_est);
end;
$$;
revoke execute on function public.admin_create_model_test_v2(text, text, jsonb, jsonb, text, boolean) from public, anon;
grant execute on function public.admin_create_model_test_v2(text, text, jsonb, jsonb, text, boolean) to authenticated;

-- -------------------------------------------------------------- worker

-- Same claim, plus the ordered inputs per slot (with stored media facts) and, for "job" slots, the provider task of
-- the source job, so an adapter can map each slot to the provider's field.
create or replace function public.worker_claim(p_queue text, p_msg_id bigint, p_work_item_id uuid, p_worker text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w app_private.job_work_items;
  v_lease uuid := gen_random_uuid();
  v_secs int;
  v_ctx jsonb := '{}'::jsonb;
begin
  select * into w from app_private.job_work_items where id = p_work_item_id for update skip locked;
  if not found then
    if not exists (select 1 from app_private.job_work_items where id = p_work_item_id) then
      perform pgmq.archive(p_queue, p_msg_id);
      return jsonb_build_object('status', 'stale');
    end if;
    return jsonb_build_object('status', 'busy');
  end if;
  if w.state in ('done', 'cancelled', 'dead') or w.last_msg_id is distinct from p_msg_id then
    -- A superseded message (rescheduled item) or finished work: drop this copy.
    perform pgmq.archive(p_queue, p_msg_id);
    return jsonb_build_object('status', 'stale');
  end if;
  if w.state = 'leased' and w.lease_expires_at > now() then
    return jsonb_build_object('status', 'busy');
  end if;
  if w.due_at > now() + interval '2 seconds' then
    perform pgmq.set_vt(p_queue, p_msg_id, ceil(extract(epoch from (w.due_at - now())))::int);
    return jsonb_build_object('status', 'not_due');
  end if;
  v_secs := case w.queue when 'genlixs_media' then 300 else 90 end;
  update app_private.job_work_items
  set state = 'leased', lease_token = v_lease, lease_expires_at = now() + make_interval(secs => v_secs),
      fence = fence + 1, attempt_count = attempt_count + 1
  where id = w.id returning * into w;

  if w.kind in ('job_submit', 'job_check', 'job_bind', 'job_import') then
    select jsonb_build_object(
      'job', jsonb_build_object('id', j.id, 'ref', j.short_ref, 'userId', j.user_id, 'state', j.state, 'tool', j.tool,
        'prompt', j.prompt, 'options', j.options, 'units', j.units::text, 'deadlineAt', j.customer_deadline_at,
        'delayedAfterAt', j.delayed_after_at, 'mode', q.normalized_input ->> 'mode'),
      -- The job keeps the adapter it was quoted with; a catalog change only affects new jobs.
      'model', jsonb_build_object('id', m.id, 'providerModelId', m.provider_model_id, 'adapter', j.adapter,
        'adapterVersion', j.adapter_version, 'providerAccountId', m.provider_account_id),
      'output', (select c.spec -> 'output' from app_private.model_capability_versions c where c.id = j.capability_version_id),
      'references', coalesce((
        select jsonb_agg(jsonb_build_object('assetId', a.id, 'bucket', a.bucket, 'path', a.object_path, 'mime', a.mime))
        from public.assets a where a.id = any (j.reference_asset_ids)), '[]'),
      'inputs', coalesce((
        select jsonb_object_agg(s.key, coalesce((
          select jsonb_agg(
            case when cv.spec -> 'inputs' -> s.key ->> 'kind' = 'job'
              then jsonb_build_object('jobId', x.v, 'taskId', (
                select t.provider_task_id from app_private.provider_attempts t
                where t.job_id = x.v::uuid and t.state = 'accepted' and t.provider_task_id is not null order by t.ordinal desc limit 1))
              else (select jsonb_build_object('assetId', a.id, 'bucket', a.bucket, 'path', a.object_path, 'mime', a.mime,
                      'durationMs', a.duration_ms, 'width', a.width, 'height', a.height)
                    from public.assets a where a.id = x.v::uuid) end
            order by x.o)
          from jsonb_array_elements_text(s.value) with ordinality x(v, o)), '[]'::jsonb))
        from jsonb_each(coalesce(q.normalized_input -> 'inputs', '{}'::jsonb)) s), '{}'::jsonb),
      'attempt', (
        select jsonb_build_object('id', t.id, 'ordinal', t.ordinal, 'state', t.state, 'taskId', t.provider_task_id)
        from app_private.provider_attempts t where t.job_id = j.id order by t.ordinal desc limit 1)
    ) into v_ctx
    from public.generation_jobs j
    join app_private.model_catalog m on m.id = j.model_id
    left join app_private.model_capability_versions cv on cv.id = j.capability_version_id
    left join public.generation_quotes q on q.id = j.quote_id
    where j.id = w.ref_id;
  end if;

  return jsonb_build_object('status', 'claimed', 'workItemId', w.id, 'leaseToken', v_lease, 'fence', w.fence,
    'kind', w.kind, 'refId', w.ref_id, 'attemptCount', w.attempt_count, 'payload', w.payload, 'context', v_ctx);
end;
$$;
