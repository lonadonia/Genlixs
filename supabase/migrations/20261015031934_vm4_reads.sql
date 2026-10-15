-- Genlixs 24 · Video modes, part 4: customer catalog, staff test catalog and job snapshot with operations and inputs.

-- ------------------------------------------------------------- reads

-- Customer catalog: as before, plus the operation and the input slots, combinations, conditional limits and derived
-- options of the current capability, so the studio shows only what a model really accepts.
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
revoke execute on function public.get_catalog() from public;
grant execute on function public.get_catalog() to anon, authenticated;

-- Staff studio catalog for private tests: every model whatever its state, with the documented KIE cost schedule
-- (staff with catalog.test only). Customers never see disabled entries.
create or replace function public.staff_test_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_capability('catalog.test');
begin
  return jsonb_build_object('models', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', m.id, 'tool', m.tool, 'category', app_private.model_category(m.tool),
      'operation', coalesce(c.spec ->> 'operation', case when m.tool = 'video' then 'create' end),
      'name', m.public_name, 'family', m.family, 'variant', m.variant_label, 'badges', to_jsonb(m.badges), 'purpose', m.purpose,
      'state', m.state, 'note', m.availability_note, 'capabilityVersion', c.version,
      'options', c.spec -> 'options', 'prompt', c.spec -> 'prompt', 'references', c.spec -> 'references',
      'inputs', c.spec -> 'inputs', 'modes', c.spec -> 'modes', 'rules', c.spec -> 'rules', 'derived', c.spec -> 'derived',
      'output', jsonb_build_object('kind', c.spec -> 'output' -> 'kind', 'count', c.spec -> 'output' -> 'count'),
      'fixed', c.spec -> 'fixed',
      'priced', p.id is not null, 'priceRules', case when p.id is not null then p.rules end,
      'adapterImplemented', exists (select 1 from app_private.provider_adapters a where a.adapter = m.adapter),
      'costSchedule', sc.schedule
    ) order by m.sort_order)
    from app_private.model_catalog m
    cross join lateral app_private.capability_for(m.id) c
    left join app_private.price_versions p on p.model_id = m.id and p.state = 'published' and p.capability_version_id = c.id
    left join lateral (select s.schedule from app_private.supplier_cost_versions s where s.model_id = m.id order by s.version desc limit 1) sc on true
  ), '[]'));
end;
$$;
revoke execute on function public.staff_test_catalog() from public, anon;
grant execute on function public.staff_test_catalog() to authenticated;

-- Snapshot (as in generation_reliability_progress) plus the operation, the input mode and the ordered inputs, so the
-- studio can show what a job was made from and offer "use as reference" on the right slot.
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
    'favorite', j.favorite, 'parentJobId', j.parent_job_id, 'purpose', j.purpose,
    'operation', coalesce(cv.spec ->> 'operation', case when j.tool = 'video' then 'create' end),
    'mode', q.normalized_input ->> 'mode',
    'inputs', coalesce((
      select jsonb_object_agg(s.key, coalesce((
        select jsonb_agg(jsonb_build_object('id', x.v, 'kind', cv.spec -> 'inputs' -> s.key ->> 'kind',
          'mime', (select a.mime from public.assets a where a.id = x.v::uuid)) order by x.o)
        from jsonb_array_elements_text(s.value) with ordinality x(v, o)), '[]'::jsonb))
      from jsonb_each(coalesce(q.normalized_input -> 'inputs', '{}'::jsonb)) s), '{}'::jsonb),
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
  left join public.generation_quotes q on q.id = j.quote_id
  where j.id = p_job;
$$;
