-- Genlixs · Image Edit with several reference images. Applied on 18 Oct 2026 with the owner's authorization, after a
-- full run on an isolated local PostgreSQL 17 with all earlier migrations (supabase/local-test). Rollback:
-- supabase/rollbacks/*_image_edit_multi_reference.rollback.sql (supabase/rollbacks/README.md).
--
-- 1. Order. Reference images keep the customer's order from the quote to the provider request:
--    normalize_generation_input sorted them by id (array_agg(distinct x order by x)); it now keeps the order chosen and
--    counts a repeated id once, at its first position. Jobs copy the quote's list with an explicit order
--    (create_generation and both staff-test functions), and worker_claim returns the references in that order
--    (it joined assets without an order). The worker signs them in order and the adapters send them in order
--    (input_urls / image_input / image_urls). Typed video inputs were already ordered.
-- 2. Limits. Each edit model accepts the number of input images its KIE endpoint documents (docs.kie.ai, re-read
--    18 Oct 2026):
--      gpt-flare-edit         16  (GPT Image 2.5 Flare image-to-image: input_urls, maxItems 16)
--      gpt-sunburst-edit      16  (GPT Image 2.5 Sunburst image-to-image: input_urls, maxItems 16)
--      nano-banana-pro-edit    8  (Nano Banana Pro: image_input, maxItems 8 (30 MB each))
--      flux-2-pro-edit         8  (FLUX.2 Pro image-to-image: input_urls, maxItems 8 (10 MB each))
--      seedream-5-flash-edit  10  (Seedream 5.0 Flash image-to-image: image_urls, maxItems 10 (30 MB each))
--    Per-file limits stay at the product's 10 MB and PNG/JPEG/WebP, within every endpoint's own limits.
-- 3. Prices: unchanged. The published price of each model is re-bound to its new capability version with the same rules
--    (as in vm3); every change is audited. Quotes made before this migration become stale and are refreshed by the
--    studio before any charge.
-- 4. Copy: two model descriptions that said "one image" / "a reference image" now say "your images" (only if unchanged).

-- ------------------------------------------------------------ order

create or replace function app_private.normalize_generation_input(p_uid uuid, p_model_id text, p_spec jsonb, p_prompt text, p_options jsonb,
  p_reference_asset_ids uuid[])
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_prompt text := trim(coalesce(p_prompt, ''));
  v_opts jsonb := '{}'::jsonb;
  -- The customer's order is kept (image 1, image 2, …); an id sent twice counts once, at its first position.
  v_refs uuid[] := coalesce((select array_agg(r.x order by r.first_at)
    from (select u.x, min(u.ord) as first_at from unnest(coalesce(p_reference_asset_ids, '{}')) with ordinality u(x, ord) group by u.x) r), '{}');
  k text;
  v_spec jsonb;
  v_val jsonb;
begin
  if char_length(v_prompt) < coalesce((p_spec -> 'prompt' ->> 'min')::int, 1) then
    perform app_private.fail('PROMPT_TOO_SHORT', 'Describe what you want in a few more words.');
  end if;
  if char_length(v_prompt) > coalesce((p_spec -> 'prompt' ->> 'max')::int, 4000) then
    perform app_private.fail('PROMPT_TOO_LONG', 'The prompt is longer than this model accepts.', jsonb_build_object('max', p_spec -> 'prompt' -> 'max'));
  end if;
  for k in select jsonb_object_keys(coalesce(p_options, '{}'::jsonb)) loop
    if not coalesce(p_spec -> 'options' ? k, false) then
      perform app_private.fail('UNSUPPORTED_OPTION', 'This model does not support one of the selected settings.', jsonb_build_object('option', k));
    end if;
  end loop;
  for k, v_spec in select * from jsonb_each(coalesce(p_spec -> 'options', '{}'::jsonb)) loop
    v_val := coalesce(p_options -> k, v_spec -> 'default');
    if not exists (select 1 from jsonb_array_elements(v_spec -> 'values') e where e = v_val) then
      perform app_private.fail('UNSUPPORTED_OPTION', 'This model does not support the selected setting.', jsonb_build_object('option', k, 'value', v_val));
    end if;
    v_opts := v_opts || jsonb_build_object(k, v_val);
  end loop;
  if cardinality(v_refs) < coalesce((p_spec -> 'references' ->> 'min')::int, 0) then
    perform app_private.fail('REFERENCE_REQUIRED', 'Add a reference image to edit.');
  end if;
  if cardinality(v_refs) > coalesce((p_spec -> 'references' ->> 'max')::int, 0) then
    perform app_private.fail('TOO_MANY_REFERENCES',
      case when coalesce((p_spec -> 'references' ->> 'max')::int, 0) = 1 then 'This model accepts one reference image.'
        else format('This model accepts up to %s reference images.', coalesce((p_spec -> 'references' ->> 'max')::int, 0)) end,
      jsonb_build_object('max', coalesce((p_spec -> 'references' ->> 'max')::int, 0), 'count', cardinality(v_refs)));
  end if;
  if cardinality(v_refs) > 0 and (
    select count(*) from public.assets a
    where a.id = any (v_refs) and a.user_id = p_uid and a.kind = 'input' and a.state = 'validated'
      and (a.retention_until is null or a.retention_until > now())
      and a.mime in (select jsonb_array_elements_text(p_spec -> 'references' -> 'mime'))
  ) <> cardinality(v_refs) then
    perform app_private.fail('REFERENCE_INVALID', 'The reference image is missing, expired or not accepted. Upload it again.');
  end if;
  return jsonb_build_object('input', jsonb_build_object('modelId', p_model_id, 'prompt', v_prompt, 'options', v_opts, 'referenceAssetIds', to_jsonb(v_refs)),
    'options', v_opts, 'refCount', cardinality(v_refs));
end;
$$;

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
    coalesce((select array_agg(x::uuid order by o) from jsonb_array_elements_text(q.normalized_input -> 'referenceAssetIds') with ordinality r(x, o)), '{}'),
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

create or replace function public.admin_create_model_test(p_model_id text, p_prompt text, p_options jsonb, p_reference_asset_ids uuid[],
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
  v_norm := app_private.normalize_generation_input(v_uid, m.id, c.spec, p_prompt, p_options, p_reference_asset_ids);
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
    coalesce((select array_agg(x::uuid order by o) from jsonb_array_elements_text(v_norm -> 'input' -> 'referenceAssetIds') with ordinality r(x, o)), '{}'),
    left('Test · ' || regexp_replace(v_norm -> 'input' ->> 'prompt', '\s+', ' ', 'g'), 60), 0, p_idempotency_key,
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
    null, jsonb_build_object('jobId', v_job, 'options', v_norm -> 'options'));
  return jsonb_build_object('job', app_private.job_snapshot(v_job), 'replayed', false, 'estimatedSupplierCredits', v_est);
end;
$$;

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
    coalesce((select array_agg(x::uuid order by o) from jsonb_array_elements_text(v_norm -> 'input' -> 'referenceAssetIds') with ordinality r(x, o)), '{}'),
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
      -- Reference images in the customer's order; the adapters forward them to the provider in this order.
      'references', coalesce((
        select jsonb_agg(jsonb_build_object('assetId', a.id, 'bucket', a.bucket, 'path', a.object_path, 'mime', a.mime) order by r.o)
        from unnest(j.reference_asset_ids) with ordinality r(id, o) join public.assets a on a.id = r.id), '[]'),
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

-- ------------------------------------------------------------ limits

-- New capability version per model (versions are immutable; the previous one stays for jobs that used it), audited
-- in the same statement.
with v(model_id, max) as (values
  ('gpt-flare-edit', 16),
  ('gpt-sunburst-edit', 16),
  ('nano-banana-pro-edit', 8),
  ('flux-2-pro-edit', 8),
  ('seedream-5-flash-edit', 10)
), ins as (
  insert into app_private.model_capability_versions (model_id, version, spec)
  select c.model_id, c.version + 1, jsonb_set(c.spec, '{references,max}', to_jsonb(v.max))
  from v cross join lateral app_private.capability_for(v.model_id) c
  where c.model_id is not null and (c.spec -> 'references' ->> 'max')::int is distinct from v.max
  returning model_id, version, spec
)
select app_private.audit(null, 'catalog.publish', 'capability.references_raised', 'model', ins.model_id, 'Image Edit takes several reference images, up to the number documented for this endpoint (docs.kie.ai, 18 Oct 2026); the published price is carried over unchanged.',
  jsonb_build_object('capabilityVersion', ins.version - 1), jsonb_build_object('capabilityVersion', ins.version, 'references', ins.spec -> 'references'))
from ins;

-- Published prices: the same rules, re-bound to the new capability version and audited (the price does not depend on
-- the number of reference images: these endpoints are billed per output image). A model without a published price
-- keeps none.
do $$
declare
  r record;
  v_new uuid;
  v_cap app_private.model_capability_versions;
begin
  for r in
    select p.* from app_private.price_versions p
    where p.state = 'published' and p.model_id in ('gpt-flare-edit', 'gpt-sunburst-edit', 'nano-banana-pro-edit', 'flux-2-pro-edit', 'seedream-5-flash-edit')
  loop
    v_cap := app_private.capability_for(r.model_id);
    continue when r.capability_version_id = v_cap.id;
    update app_private.price_versions set state = 'retired' where id = r.id;
    insert into app_private.price_versions (model_id, capability_version_id, version, state, rules, supplier_cost_snapshot, cost_evidence,
      effective_at, published_by, created_by, source, supplier_cost_version_id, markup_bps, basis, restored_from)
    values (r.model_id, v_cap.id, (select max(version) + 1 from app_private.price_versions where model_id = r.model_id), 'published', r.rules,
      r.supplier_cost_snapshot, r.cost_evidence, now(), r.published_by, null, 'capability', r.supplier_cost_version_id, r.markup_bps, r.basis, r.id)
    returning id into v_new;
    perform app_private.audit(null, 'catalog.publish', 'price.carried_to_capability', 'model', r.model_id,
      'Image Edit takes several reference images, up to the number documented for this endpoint (docs.kie.ai, 18 Oct 2026); the published price is carried over unchanged.',
      jsonb_build_object('priceVersionId', r.id, 'capabilityVersionId', r.capability_version_id),
      jsonb_build_object('priceVersionId', v_new, 'capabilityVersionId', v_cap.id, 'referencesMax', v_cap.spec -> 'references' -> 'max'));
  end loop;
end;
$$;


-- ------------------------------------------------------------ copy

update app_private.model_catalog m set purpose = v.after
from (values
  ('gpt-flare-edit', 'Fast reference edits: change a scene, style or detail from one image and a written instruction.', 'Fast reference edits: change a scene, style or detail from your images and a written instruction.'),
  ('flux-2-pro-edit', 'Low-cost photorealistic edits guided by a reference image.', 'Low-cost photorealistic edits guided by your reference images.')
) as v(id, before, after)
where m.id = v.id and m.purpose = v.before;
