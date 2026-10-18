-- Rollback of 20261018181012…20261018182418_multi_provider_routing_part01…part12 (multi-provider routing).
--
-- Restores the previous behaviour of every function the migration replaced (quotes, job creation, staff tests, public
-- catalog and the KIE balance reading) so that only the model's original KIE account is used again, and switches every
-- other supplier offer off for routing. Jobs already sent keep working: the worker functions added by the migration
-- (worker_begin_submission_v2, worker_attempt_route, worker_provider_credential) stay so in-flight attempts on another
-- supplier can still be checked and imported by the current release. Nothing financial is dropped: the supplier cost
-- ledger, balances, prices, offers, keys in Vault and the audit trail are kept for a later re-activation.
--
-- Deploy the previous application release after running this (it calls worker_begin_submission, which still exists).

update app_private.provider_offers set routing_enabled = false where not is_legacy_primary and routing_enabled;
update app_private.provider_offers set routing_enabled = true where is_legacy_primary;

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

create or replace function public.get_catalog()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'generationPaused', coalesce((app_private.setting('generation_paused'))::text, 'false') = 'true',
    'tools', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'label', t.label, 'enabled', t.enabled) order by t.sort_order), '[]') from public.tools t),
    'models', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'tool', m.tool,
        'category', app_private.model_category(m.tool),
        'operation', coalesce(c.spec ->> 'operation', case when m.tool = 'video' then 'create' end),
        'name', m.public_name,
        'family', m.family,
        'variant', m.variant_label,
        'badges', to_jsonb(m.badges),
        'purpose', m.purpose,
        'state', m.state,
        'note', m.availability_note,
        'capabilityVersion', c.version,
        'options', c.spec -> 'options',
        'prompt', c.spec -> 'prompt',
        'references', c.spec -> 'references',
        'inputs', c.spec -> 'inputs',
        'modes', c.spec -> 'modes',
        'rules', c.spec -> 'rules',
        'derived', c.spec -> 'derived',
        'output', jsonb_build_object('kind', c.spec -> 'output' -> 'kind', 'count', c.spec -> 'output' -> 'count'),
        'fixed', c.spec -> 'fixed',
        'priced', p.id is not null,
        'priceRules', case when p.id is not null then p.rules end
      ) order by m.sort_order)
      from app_private.model_catalog m
      cross join lateral app_private.capability_for(m.id) c
      left join app_private.price_versions p on p.model_id = m.id and p.state = 'published' and p.capability_version_id = c.id
      where m.state <> 'disabled'
    ), '[]')
  );
$$;

create or replace function public.record_provider_balance_result(p_ok boolean, p_credits numeric, p_error text, p_source text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  acc app_private.provider_accounts;
begin
  select * into acc from app_private.provider_accounts where provider = 'kie' and label = 'primary' for update;
  insert into app_private.provider_balance_snapshots (provider_account_id, ok, credits, error_code, source)
  values (acc.id, p_ok, case when p_ok then p_credits end, case when not p_ok then left(coalesce(p_error, 'UNKNOWN'), 120) end,
    case when p_source in ('admin', 'auto', 'worker') then p_source else 'worker' end);
  if p_ok then
    update app_private.provider_accounts set last_balance = p_credits, last_balance_at = now(), last_balance_error = null, last_balance_error_at = null
    where id = acc.id;
  else
    update app_private.provider_accounts set last_balance_error = left(coalesce(p_error, 'UNKNOWN'), 120), last_balance_error_at = now() where id = acc.id;
  end if;
end;
$$;

