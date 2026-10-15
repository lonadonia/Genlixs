-- Genlixs 21 · Video modes, part 1: typed inputs for Create Video (start/end frames, references, elements), Edit Video
-- and Motion Control. A capability version may now declare named input slots, allowed combinations ("modes"),
-- conditional limits and options derived from the media (for example the billable seconds of an uploaded clip).
-- The server validates every input from stored metadata (owner, type, size, dimensions, length, frame rate) before a
-- quote exists; the quote freezes the inputs with the price. Uploads accept MP4/MOV video and MP3/WAV/M4A audio.
-- Additive: existing quotes, jobs and specs without input slots keep their meaning.

-- ------------------------------------------------------------- schema

-- Media facts read from the file itself at upload (frame rate, audio track, container); width/height/duration
-- stay in their columns.
alter table public.assets add column media jsonb;

-- Price versions re-bound unchanged to a new capability version (same rules, new option schema) are marked as such.
alter table app_private.price_versions drop constraint price_versions_source_check;
alter table app_private.price_versions add constraint price_versions_source_check
  check (source in ('seed', 'manual', 'bulk', 'restore', 'capability'));

-- Reference uploads: images 10 MB, video 50 MB (the Supabase plan's per-file limit), audio 15 MB.
update storage.buckets set file_size_limit = 52428800,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'video/mp4', 'video/quicktime', 'audio/mpeg', 'audio/wav', 'audio/mp4']
where id = 'generation-inputs';

-- ------------------------------------------------------------ uploads

create or replace function public.create_upload_intent(p_purpose text, p_mime text, p_bytes bigint, p_name text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_active_user();
  v_id uuid := gen_random_uuid();
  v_bucket text;
  v_ext text;
  v_path text;
  v_max bigint;
  v_kind text;
  v_expires timestamptz;
begin
  if p_purpose not in ('reference', 'support') then
    perform app_private.fail('INVALID_PURPOSE', 'Unsupported upload purpose.');
  end if;
  v_bucket := case p_purpose when 'reference' then 'generation-inputs' else 'support-attachments' end;
  v_ext := case p_mime when 'image/png' then 'png' when 'image/jpeg' then 'jpg' when 'image/webp' then 'webp'
                       when 'application/pdf' then case when p_purpose = 'support' then 'pdf' end
                       when 'video/mp4' then case when p_purpose = 'reference' then 'mp4' end
                       when 'video/quicktime' then case when p_purpose = 'reference' then 'mov' end
                       when 'audio/mpeg' then case when p_purpose = 'reference' then 'mp3' end
                       when 'audio/wav' then case when p_purpose = 'reference' then 'wav' end
                       when 'audio/mp4' then case when p_purpose = 'reference' then 'm4a' end end;
  if v_ext is null then
    perform app_private.fail('UNSUPPORTED_FILE_TYPE',
      case when p_purpose = 'reference' then 'Upload a PNG, JPEG or WebP image, an MP4 or MOV video, or an MP3, WAV or M4A audio file.'
           else 'Upload a PNG, JPEG or WebP image or a PDF.' end);
  end if;
  v_kind := split_part(p_mime, '/', 1);
  v_max := case v_kind when 'video' then 52428800 when 'audio' then 15728640 else 10485760 end;
  if p_bytes is null or p_bytes <= 0 or p_bytes > v_max then
    perform app_private.fail('FILE_TOO_LARGE',
      case v_kind when 'video' then 'Videos can be up to 50 MB.' when 'audio' then 'Audio files can be up to 15 MB.' else 'Files can be up to 10 MB.' end,
      jsonb_build_object('maxBytes', v_max));
  end if;
  if (select count(*) from public.upload_intents where user_id = v_uid and created_at > now() - interval '1 hour') >= 60 then
    perform app_private.fail('RATE_LIMITED', 'Too many uploads in the last hour. Try again later.');
  end if;
  -- Large files go through the resumable path and may take a while on slow connections.
  v_expires := now() + case when v_kind in ('video', 'audio') then interval '60 minutes' else interval '15 minutes' end;
  v_path := v_uid::text || '/' || v_id::text || '/source.' || v_ext;
  insert into public.upload_intents (id, user_id, purpose, bucket, object_path, expected_mime, expected_bytes, original_name, expires_at)
  values (v_id, v_uid, p_purpose, v_bucket, v_path, p_mime, p_bytes, left(p_name, 200), v_expires);
  return jsonb_build_object('intentId', v_id, 'bucket', v_bucket, 'path', v_path, 'expiresAt', v_expires, 'maxBytes', v_max);
end;
$$;
revoke execute on function public.create_upload_intent(text, text, bigint, text) from public, anon;
grant execute on function public.create_upload_intent(text, text, bigint, text) to authenticated;

-- Server-only: called after the backend has read the object and checked its real signature, size, dimensions and,
-- for video/audio, length and frame rate from the container.
create or replace function public.finalize_upload(p_intent_id uuid, p_verified jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_int public.upload_intents;
  v_asset uuid;
  v_days int := coalesce((app_private.setting('reference_retention_days'))::text, '7')::int;
begin
  select * into v_int from public.upload_intents where id = p_intent_id for update;
  if not found then
    perform app_private.fail('NOT_FOUND', 'Upload not found.');
  end if;
  if v_int.state = 'validated' then
    return jsonb_build_object('assetId', v_int.asset_id, 'state', 'validated');
  end if;
  if v_int.state <> 'pending' then
    perform app_private.fail('UPLOAD_NOT_PENDING', 'This upload can no longer be completed.');
  end if;
  if coalesce((p_verified ->> 'ok')::boolean, false) is not true then
    update public.upload_intents set state = 'rejected', rejection_reason = left(p_verified ->> 'reason', 200) where id = v_int.id;
    return jsonb_build_object('state', 'rejected', 'reason', p_verified ->> 'reason');
  end if;
  insert into public.assets (user_id, kind, bucket, object_path, mime, bytes, width, height, duration_ms, sha256, original_name, state,
    retention_until, media)
  values (v_int.user_id, case v_int.purpose when 'reference' then 'input' else 'attachment' end, v_int.bucket, v_int.object_path,
          p_verified ->> 'mime', (p_verified ->> 'bytes')::bigint, (p_verified ->> 'width')::int, (p_verified ->> 'height')::int,
          (p_verified ->> 'durationMs')::int, p_verified ->> 'sha256', v_int.original_name, 'validated',
          now() + make_interval(days => v_days), p_verified -> 'media')
  returning id into v_asset;
  update public.upload_intents set state = 'validated', asset_id = v_asset where id = v_int.id;
  return jsonb_build_object('assetId', v_asset, 'state', 'validated');
end;
$$;
revoke execute on function public.finalize_upload(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.finalize_upload(uuid, jsonb) to service_role;

-- ----------------------------------------------------------- cost math

-- Same as before, plus "secondsFactor" for schedules billed on more than the output length (Seedance edits are billed
-- on the reference video plus the output, which matches the reference length).
create or replace function app_private.supplier_credits(p_schedule jsonb, p_options jsonb, p_ref_count int default 0, p_outputs int default 1)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_rate numeric;
  v_secs numeric;
  v_extra numeric := 0;
begin
  if p_schedule is null then
    return null;
  end if;
  v_rate := (p_schedule -> 'rates' ->> app_private.option_key(p_schedule -> 'dims', p_options))::numeric;
  if v_rate is null then
    return null;
  end if;
  if p_schedule ->> 'unit' = 'second' then
    v_secs := (p_options ->> coalesce(p_schedule ->> 'durationOption', 'duration'))::numeric;
    if v_secs is null or v_secs <= 0 then
      return null;
    end if;
    v_rate := v_rate * v_secs * coalesce((p_schedule ->> 'secondsFactor')::numeric, 1);
  end if;
  if p_schedule ? 'extraReference' then
    v_extra := greatest(coalesce(p_ref_count, 0) - coalesce((p_schedule -> 'extraReference' ->> 'free')::int, 0), 0)
               * coalesce((p_schedule -> 'extraReference' ->> 'credits')::numeric, 0);
  end if;
  return v_rate * greatest(coalesce(p_outputs, 1), 1) + v_extra;
end;
$$;

-- ------------------------------------------------------- input checking

-- Normalizes and validates a request against a capability version with input slots. Specs without slots keep the
-- single-reference rules of normalize_generation_input. Every message names the input and what to change.
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
      select * into a from public.assets where id = v_id::uuid and user_id = p_uid and kind = 'input' and state = 'validated'
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
