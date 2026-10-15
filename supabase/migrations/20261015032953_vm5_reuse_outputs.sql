-- Genlixs 25 · Video modes, part 5: a customer's own saved results can be used as inputs ("Use as start frame",
-- "Edit this video", "Copy this motion") without copying files. Imported videos now keep their picture size, frame
-- rate and tracks (read from the container), and an older output can have its facts read once on demand.

-- Saved outputs gain the same media facts as uploads (set by the importer and by the on-demand probe).
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
      retention_until, provider_task_id, media)
    values (j.user_id, 'output', j.id, x ->> 'bucket', x ->> 'path', x ->> 'mime', (x ->> 'bytes')::bigint, nullif(x ->> 'width', '')::int,
      nullif(x ->> 'height', '')::int, nullif(x ->> 'durationMs', '')::int, x ->> 'sha256', v_state,
      now() + make_interval(days => v_days), w.payload ->> 'taskId', x -> 'media')
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

-- Server-only: stores facts read from an owner's saved output (picture size, length, frame rate) when they were not
-- recorded at import. Only fills missing values; never changes the file or its owner.
create or replace function public.record_asset_media(p_asset_id uuid, p_user_id uuid, p_facts jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.assets;
begin
  select * into a from public.assets where id = p_asset_id and user_id = p_user_id and kind in ('input', 'output') and state in ('validated', 'ready')
  for update;
  if not found then
    perform app_private.fail('NOT_FOUND', 'File not found.');
  end if;
  update public.assets set
    width = coalesce(width, nullif(p_facts ->> 'width', '')::int),
    height = coalesce(height, nullif(p_facts ->> 'height', '')::int),
    duration_ms = coalesce(duration_ms, nullif(p_facts ->> 'durationMs', '')::int),
    media = coalesce(media, '{}'::jsonb) || coalesce(p_facts -> 'media', '{}'::jsonb)
  where id = a.id;
  return (select jsonb_build_object('assetId', x.id, 'mime', x.mime, 'width', x.width, 'height', x.height, 'durationMs', x.duration_ms,
            'fps', x.media ->> 'fps') from public.assets x where x.id = a.id);
end;
$$;
revoke execute on function public.record_asset_media(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_asset_media(uuid, uuid, jsonb) to service_role;

-- Inputs may now be the caller's own saved results as well as uploads (same checks on type, size, length, rate).
create or replace function app_private.normalize_generation_input_v2(p_uid uuid, p_model_id text, p_spec jsonb, p_prompt text,
  p_options jsonb, p_inputs jsonb, p_reference_asset_ids uuid[] default '{}')
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_prompt text := trim(coalesce(p_prompt, ''));
  v_opts jsonb := '{}'::jsonb;
  v_inputs jsonb := '{}'::jsonb;
  v_all uuid[] := '{}';
  v_used text[] := '{}';
  k text;
  v_spec jsonb;
  v_val jsonb;
  v_slot text;
  s jsonb;
  v_list jsonb;
  v_id text;
  v_label text;
  v_kind text;
  a public.assets;
  j public.generation_jobs;
  v_total bigint;
  v_n int;
  v_mode jsonb;
  v_rule jsonb;
  v_secs int;
  v_ratio numeric;
  v_fps numeric;
  v_need text;
begin
  if p_spec -> 'inputs' is null then
    return app_private.normalize_generation_input(p_uid, p_model_id, p_spec, p_prompt, p_options,
      coalesce(p_reference_asset_ids, '{}') || coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(
        case when jsonb_typeof(p_inputs -> 'reference') = 'array' then p_inputs -> 'reference' else '[]'::jsonb end) x), '{}'));
  end if;

  -- Prompt (optional for some operations, for example motion transfer).
  if v_prompt <> '' or not coalesce((p_spec -> 'prompt' ->> 'optional')::boolean, false) then
    if char_length(v_prompt) < coalesce((p_spec -> 'prompt' ->> 'min')::int, 1) then
      perform app_private.fail('PROMPT_TOO_SHORT', 'Describe what you want in a few more words.');
    end if;
  end if;
  if char_length(v_prompt) > coalesce((p_spec -> 'prompt' ->> 'max')::int, 4000) then
    perform app_private.fail('PROMPT_TOO_LONG', 'The prompt is longer than this model accepts.', jsonb_build_object('max', p_spec -> 'prompt' -> 'max'));
  end if;

  -- Options: declared, not derived (derived options come from the media), value allowed.
  for k in select jsonb_object_keys(coalesce(p_options, '{}'::jsonb)) loop
    if not coalesce(p_spec -> 'options' ? k, false) or coalesce((p_spec -> 'options' -> k ->> 'derived')::boolean, false) then
      perform app_private.fail('UNSUPPORTED_OPTION', 'This model does not support one of the selected settings.', jsonb_build_object('option', k));
    end if;
  end loop;
  for k, v_spec in select * from jsonb_each(coalesce(p_spec -> 'options', '{}'::jsonb)) loop
    continue when coalesce((v_spec ->> 'derived')::boolean, false);
    v_val := coalesce(p_options -> k, v_spec -> 'default');
    if not exists (select 1 from jsonb_array_elements(v_spec -> 'values') e where e = v_val) then
      perform app_private.fail('UNSUPPORTED_OPTION', 'This model does not support the selected setting.', jsonb_build_object('option', k, 'value', v_val));
    end if;
    v_opts := v_opts || jsonb_build_object(k, v_val);
  end loop;

  -- Inputs: known slots only, each an ordered list of the caller's validated assets (or, for "job" slots, own jobs).
  if p_inputs is not null and jsonb_typeof(p_inputs) <> 'object' then
    perform app_private.fail('INVALID_INPUT', 'Inputs are not valid.');
  end if;
  for v_slot in select jsonb_object_keys(coalesce(p_inputs, '{}'::jsonb)) loop
    if not (p_spec -> 'inputs' ? v_slot) then
      perform app_private.fail('UNSUPPORTED_INPUT', 'This model does not take that kind of input. Remove it or choose another model.',
        jsonb_build_object('input', v_slot));
    end if;
  end loop;
  for v_slot, s in select * from jsonb_each(p_spec -> 'inputs') loop
    v_list := coalesce(p_inputs -> v_slot, '[]'::jsonb);
    if jsonb_typeof(v_list) <> 'array' then
      perform app_private.fail('INVALID_INPUT', 'Inputs are not valid.', jsonb_build_object('input', v_slot));
    end if;
    select coalesce(jsonb_agg(to_jsonb(d.x) order by d.o), '[]'::jsonb) into v_list
    from (select distinct on (t.x) t.x, t.o from jsonb_array_elements_text(v_list) with ordinality t(x, o) order by t.x, t.o) d;
    v_n := jsonb_array_length(v_list);
    continue when v_n = 0;
    v_label := coalesce(s ->> 'label', v_slot);
    v_kind := s ->> 'kind';
    if v_n > coalesce((s ->> 'max')::int, 0) then
      perform app_private.fail('TOO_MANY_INPUTS', format('%s takes at most %s file(s).', v_label, coalesce((s ->> 'max')::int, 0)),
        jsonb_build_object('input', v_slot));
    end if;
    if v_n < coalesce((s ->> 'min')::int, 0) then
      perform app_private.fail('TOO_FEW_INPUTS', format('%s needs at least %s file(s).', v_label, (s ->> 'min')::int),
        jsonb_build_object('input', v_slot));
    end if;
    v_total := 0;
    for v_id in select x from jsonb_array_elements_text(v_list) x loop
      if v_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        perform app_private.fail('INVALID_INPUT', 'Inputs are not valid.', jsonb_build_object('input', v_slot));
      end if;
      if v_kind = 'job' then
        select * into j from public.generation_jobs where id = v_id::uuid and user_id = p_uid and state = 'succeeded';
        if not found then
          perform app_private.fail('SOURCE_INVALID', 'Choose one of your finished videos.', jsonb_build_object('input', v_slot));
        end if;
        if s ? 'families' and not exists (select 1 from app_private.model_catalog m where m.id = j.model_id
            and m.family in (select jsonb_array_elements_text(s -> 'families'))) then
          perform app_private.fail('SOURCE_INVALID', format('%s must be a video made with %s.', v_label,
            (select string_agg(x, ' or ') from jsonb_array_elements_text(s -> 'families') x)), jsonb_build_object('input', v_slot));
        end if;
        if s ? 'maxAgeDays' and j.completed_at < now() - make_interval(days => (s ->> 'maxAgeDays')::int) then
          perform app_private.fail('SOURCE_EXPIRED', format('Videos can be used here for %s days after they are made.', s ->> 'maxAgeDays'),
            jsonb_build_object('input', v_slot));
        end if;
        if not exists (select 1 from app_private.provider_attempts t where t.job_id = j.id and t.state = 'accepted' and t.provider_task_id is not null) then
          perform app_private.fail('SOURCE_INVALID', 'This video has no generation record that can be continued.', jsonb_build_object('input', v_slot));
        end if;
        continue;
      end if;
      -- An upload (validated) or one of the caller's own saved results (ready), still within its retention.
      select * into a from public.assets where id = v_id::uuid and user_id = p_uid
        and ((kind = 'input' and state = 'validated') or (kind = 'output' and state = 'ready'))
        and (retention_until is null or retention_until > now());
      if not found then
        perform app_private.fail('INPUT_INVALID', format('%s is missing or has expired. Upload it again.', v_label), jsonb_build_object('input', v_slot));
      end if;
      if not (a.mime in (select jsonb_array_elements_text(s -> 'mime'))) then
        perform app_private.fail('INPUT_TYPE', format('%s: %s is not accepted here.', v_label, coalesce(a.original_name, a.mime)),
          jsonb_build_object('input', v_slot, 'accepted', s -> 'mime'));
      end if;
      if s ? 'maxBytes' and a.bytes > (s ->> 'maxBytes')::bigint then
        perform app_private.fail('INPUT_TOO_LARGE', format('%s: the file is larger than this model accepts.', v_label), jsonb_build_object('input', v_slot));
      end if;
      if v_kind in ('image', 'video') then
        if a.width is null or a.height is null or a.width <= 0 or a.height <= 0 then
          perform app_private.fail('INPUT_INVALID', format('%s: the picture size could not be read. Upload another file.', v_label), jsonb_build_object('input', v_slot));
        end if;
        if s ? 'minSide' and least(a.width, a.height) < (s ->> 'minSide')::int then
          perform app_private.fail('INPUT_TOO_SMALL', format('%s must be at least %s px on each side.', v_label, s ->> 'minSide'), jsonb_build_object('input', v_slot));
        end if;
        if s ? 'maxSide' and greatest(a.width, a.height) > (s ->> 'maxSide')::int then
          perform app_private.fail('INPUT_TOO_LARGE', format('%s can be at most %s px on each side.', v_label, s ->> 'maxSide'), jsonb_build_object('input', v_slot));
        end if;
        v_ratio := a.width::numeric / a.height;
        if (s ? 'aspectMin' and v_ratio < (s ->> 'aspectMin')::numeric) or (s ? 'aspectMax' and v_ratio > (s ->> 'aspectMax')::numeric) then
          perform app_private.fail('INPUT_ASPECT', format('%s is too wide or too tall for this model.', v_label), jsonb_build_object('input', v_slot));
        end if;
        if (s ? 'minPixels' and a.width::bigint * a.height < (s ->> 'minPixels')::bigint)
           or (s ? 'maxPixels' and a.width::bigint * a.height > (s ->> 'maxPixels')::bigint) then
          perform app_private.fail('INPUT_RESOLUTION', format('%s must be a 480p or 720p video (between %s and %s pixels per frame).', v_label,
            s ->> 'minPixels', s ->> 'maxPixels'), jsonb_build_object('input', v_slot));
        end if;
      end if;
      if v_kind in ('video', 'audio') then
        if a.duration_ms is null or a.duration_ms <= 0 then
          perform app_private.fail('INPUT_INVALID', format('%s: the length could not be read. Upload another file.', v_label), jsonb_build_object('input', v_slot));
        end if;
        if s ? 'minSeconds' and a.duration_ms < (s ->> 'minSeconds')::numeric * 1000 then
          perform app_private.fail('INPUT_TOO_SHORT', format('%s must be at least %s seconds long.', v_label, s ->> 'minSeconds'), jsonb_build_object('input', v_slot));
        end if;
        if s ? 'maxSeconds' and a.duration_ms > (s ->> 'maxSeconds')::numeric * 1000 then
          perform app_private.fail('INPUT_TOO_LONG', format('%s can be at most %s seconds long.', v_label, s ->> 'maxSeconds'), jsonb_build_object('input', v_slot));
        end if;
        v_total := v_total + a.duration_ms;
      end if;
      if v_kind = 'video' and (s ? 'fpsMin' or s ? 'fpsMax') then
        v_fps := nullif(a.media ->> 'fps', '')::numeric;
        if v_fps is null or (s ? 'fpsMin' and v_fps < (s ->> 'fpsMin')::numeric - 0.5) or (s ? 'fpsMax' and v_fps > (s ->> 'fpsMax')::numeric + 0.5) then
          perform app_private.fail('INPUT_FPS', format('%s must have %s–%s frames per second.', v_label, s ->> 'fpsMin', s ->> 'fpsMax'),
            jsonb_build_object('input', v_slot));
        end if;
      end if;
      v_all := v_all || a.id;
    end loop;
    if s ? 'totalMaxSeconds' and v_total > (s ->> 'totalMaxSeconds')::numeric * 1000 then
      perform app_private.fail('INPUT_TOO_LONG', format('%s can be at most %s seconds together.', v_label, s ->> 'totalMaxSeconds'),
        jsonb_build_object('input', v_slot));
    end if;
    v_inputs := v_inputs || jsonb_build_object(v_slot, v_list);
    v_used := v_used || v_slot;
  end loop;

  -- A slot may need another one (an end frame needs a start frame); a prompt mention needs its element.
  for v_slot, s in select * from jsonb_each(p_spec -> 'inputs') loop
    if v_slot = any (v_used) then
      for v_need in select jsonb_array_elements_text(coalesce(s -> 'needs', '[]'::jsonb)) loop
        if not (v_need = any (v_used)) then
          perform app_private.fail('INPUT_REQUIRED', format('%s needs %s too.', coalesce(s ->> 'label', v_slot),
            lower(coalesce(p_spec -> 'inputs' -> v_need ->> 'label', v_need))), jsonb_build_object('input', v_need));
        end if;
      end loop;
    end if;
    if s ? 'mention' and position(lower(s ->> 'mention') in lower(v_prompt)) > 0 and not (v_slot = any (v_used)) then
      perform app_private.fail('INPUT_REQUIRED', format('Your prompt mentions %s: add its images or remove the mention.', s ->> 'mention'),
        jsonb_build_object('input', v_slot));
    end if;
  end loop;

  -- The first allowed combination that covers every used slot and has its required ones.
  select m.value into v_mode
  from jsonb_array_elements(coalesce(p_spec -> 'modes', '[{"id": "default", "uses": []}]'::jsonb)) with ordinality m(value, ord)
  where not exists (select 1 from unnest(v_used) u where not (m.value -> 'uses' ? u))
    and not exists (select 1 from jsonb_array_elements_text(coalesce(m.value -> 'requires', '[]'::jsonb)) r where not (r = any (v_used)))
  order by m.ord limit 1;
  if v_mode is null then
    perform app_private.fail('INPUTS_NOT_COMBINABLE', coalesce(p_spec ->> 'combineMessage',
      'These inputs cannot be used together with this model. Remove some of them or choose another model.'));
  end if;
  for k, v_val in select * from jsonb_each(coalesce(v_mode -> 'allowed', '{}'::jsonb)) loop
    if v_opts ? k and not exists (select 1 from jsonb_array_elements(v_val) e where e = v_opts -> k) then
      perform app_private.fail('UNSUPPORTED_OPTION', coalesce(v_mode ->> 'allowedMessage', 'This combination of settings is not available.'),
        jsonb_build_object('option', k, 'mode', v_mode ->> 'id'));
    end if;
  end loop;

  -- Conditional limits, e.g. a shorter motion video when the character keeps the image's orientation.
  for v_rule in select value from jsonb_array_elements(coalesce(p_spec -> 'rules', '[]'::jsonb)) loop
    if not exists (select 1 from jsonb_each(coalesce(v_rule -> 'when', '{}'::jsonb)) c where (v_opts -> c.key) is distinct from c.value) then
      if v_rule ? 'maxSeconds' and exists (
          select 1 from public.assets x
          where x.id in (select y::uuid from jsonb_array_elements_text(coalesce(v_inputs -> (v_rule ->> 'slot'), '[]'::jsonb)) y)
            and x.duration_ms > (v_rule ->> 'maxSeconds')::numeric * 1000) then
        perform app_private.fail('INPUT_TOO_LONG', coalesce(v_rule ->> 'message', 'The video is too long for these settings.'),
          jsonb_build_object('input', v_rule ->> 'slot'));
      end if;
    end if;
  end loop;

  -- Options derived from the media: whole seconds of the first file in the source slot, rounded up.
  for k, v_spec in select * from jsonb_each(coalesce(p_spec -> 'derived', '{}'::jsonb)) loop
    select ceil(x.duration_ms / 1000.0)::int into v_secs from public.assets x where x.id = ((v_inputs -> (v_spec ->> 'from')) ->> 0)::uuid;
    if v_secs is null then
      perform app_private.fail('INPUT_REQUIRED', format('Add %s first.', lower(coalesce(p_spec -> 'inputs' -> (v_spec ->> 'from') ->> 'label', 'the video'))),
        jsonb_build_object('input', v_spec ->> 'from'));
    end if;
    if not exists (select 1 from jsonb_array_elements(p_spec -> 'options' -> k -> 'values') e where e = to_jsonb(v_secs)) then
      perform app_private.fail('INPUT_TOO_LONG', 'The video length is outside what this model can price. Use a shorter or longer clip.',
        jsonb_build_object('input', v_spec ->> 'from', 'seconds', v_secs));
    end if;
    v_opts := v_opts || jsonb_build_object(k, v_secs);
  end loop;

  return jsonb_build_object(
    'input', jsonb_build_object('modelId', p_model_id, 'prompt', v_prompt, 'options', v_opts, 'inputs', v_inputs, 'mode', v_mode ->> 'id',
      'referenceAssetIds', (select coalesce(jsonb_agg(distinct x order by x), '[]'::jsonb) from unnest(v_all) x)),
    'options', v_opts, 'refCount', 0, 'mode', v_mode ->> 'id');
end;
$$;
