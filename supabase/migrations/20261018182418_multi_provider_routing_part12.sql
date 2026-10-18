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
    perform app_private.fail('SPEND_CONFIRMATION_REQUIRED', 'Confirm that this test spends credits from the supplier account.');
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
  if coalesce((app_private.setting('generation_paused'))::text, 'false') = 'true' then
    perform app_private.fail('GENERATION_PAUSED', 'Generation is paused (emergency stop); tests are not sent either.');
  end if;

  c := app_private.capability_for(m.id);
  v_norm := app_private.normalize_generation_input_v2(v_uid, m.id, c.spec, p_prompt, p_options, p_inputs, '{}');
  perform app_private.route_gate(m.id, v_norm -> 'input', c.spec, true);
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

-- Public catalog: unchanged except that options and input modes are narrowed to what a routable supplier can do.
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
        'options', r.spec -> 'options',
        'prompt', c.spec -> 'prompt',
        'references', c.spec -> 'references',
        'inputs', c.spec -> 'inputs',
        'modes', r.spec -> 'modes',
        'rules', c.spec -> 'rules',
        'derived', c.spec -> 'derived',
        'output', jsonb_build_object('kind', c.spec -> 'output' -> 'kind', 'count', c.spec -> 'output' -> 'count'),
        'fixed', c.spec -> 'fixed',
        'priced', p.id is not null,
        'priceRules', case when p.id is not null then p.rules end
      ) order by m.sort_order)
      from app_private.model_catalog m
      cross join lateral app_private.capability_for(m.id) c
      -- Only settings some routable supplier can fulfil (the full specification while the original route serves it).
      cross join lateral (select coalesce(app_private.routable_spec(m.id, c.spec), c.spec) as spec) r
      left join app_private.price_versions p on p.model_id = m.id and p.state = 'published' and p.capability_version_id = c.id
      where m.state <> 'disabled'
    ), '[]')
  );
$$;


-- ============================================================ initial decisions

-- Decisions from the seeded evidence, computed exactly as the Admin routing review does (no routing flag changes here).
do $$
declare
  x jsonb;
begin
  for x in select value from jsonb_array_elements(app_private.routing_review_proposals() || app_private.inventory_proposals()) loop
    update app_private.provider_offers set decision = x ->> 'proposedDecision', decision_reason = x ->> 'reason', decided_at = now()
    where id = (x ->> 'offerId')::uuid;
  end loop;
end;
$$;
