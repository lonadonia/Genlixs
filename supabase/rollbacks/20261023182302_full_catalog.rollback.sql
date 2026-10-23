-- Rollback of the full catalog (migrations 20261023182302_catalog_engine … 20261023183521_routing_review_revision).
-- NOT APPLIED. Prepared on 23 Oct 2026. Nothing is deleted: catalog rows, prices, offers and history stay as records.
--
-- 1. Switch the 97 models of the full catalog off (customers stop seeing them; accepted jobs finish as usual).
-- 2. Switch the 29 supplier offers of this release off (they were created off; this undoes any later activation).
-- 3. Wan 2.6 back to its text-only route and capability (a new capability version equal to v1; the policy re-prices it
--    with the same KIE rates, so its customer price does not change).
-- 4. Re-create six of the seven replaced functions exactly as in the migrations named below (their production text was
--    checked identical to those files before the release). app_private.price_configs and its helper spec_excluded stay:
--    for a model without excluded combinations they give the same result as before, and the four switched-off models that
--    have exclusions (GPT Image 2 and its edit, Hailuo 2.3 Standard/Pro, Runway Gen-4 Turbo) stay completely priced.
-- The research entries linked on 23 Oct keep their links (they are not routed; the reasons stay useful).

update app_private.model_catalog set state = 'disabled', availability_changed_at = now(), updated_at = now()
where source_checked_at = timestamptz '2026-10-22T12:00:00Z' and state <> 'disabled';

update app_private.provider_offers set routing_enabled = false, status = 'capabilities_unverified', verification_basis = null, updated_at = now()
where decision_reason like 'Documented request and price:%';

update app_private.model_catalog set provider_model_id = 'wan/2-6-text-to-video', adapter = 'kie-wan-2-6', updated_at = now() where id = 'wan-2-6';
insert into app_private.model_capability_versions (model_id, version, spec)
select 'wan-2-6', (select max(version) + 1 from app_private.model_capability_versions where model_id = 'wan-2-6'), c.spec
from app_private.model_capability_versions c where c.model_id = 'wan-2-6' and c.version = 1;

-- app_private.normalize_generation_input as in 20261018013256_image_edit_multi_reference.sql
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

-- app_private.normalize_generation_input_v2 as in 20261015032953_vm5_reuse_outputs.sql
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

-- public.get_catalog as in 20261018182418_multi_provider_routing_part12.sql
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

-- app_private.sync_legacy_offer as in 20261018181809_multi_provider_routing_part08.sql
create or replace function app_private.sync_legacy_offer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into app_private.provider_offers (provider_account_id, model_id, product_key, product_label, tool, operation, upstream_model_id, adapter,
    capabilities, status, decision, decision_reason, decided_at, routing_enabled, is_legacy_primary, source_url, docs_url, verification_note,
    verified_at, sort_order)
  values (new.provider_account_id, new.id, 'genlixs:' || new.id, new.public_name || ' (original route)', new.tool,
    coalesce((app_private.capability_for(new.id)).spec ->> 'operation', case new.tool when 'image' then 'text_to_image' when 'edit' then 'image_edit' else 'create' end),
    new.provider_model_id, case when exists (select 1 from app_private.provider_adapters a where a.adapter = new.adapter) then new.adapter end,
    '{"inherit": true}'::jsonb, 'eligible', 'eligible', 'Original route of this model', now(), true, true,
    new.provider_pricing_url, new.provider_docs_url, 'Original route; verification as recorded in the catalog (' || new.verification_status || ')',
    new.verified_at, 10)
  on conflict (provider_account_id, product_key) do update set
    upstream_model_id = excluded.upstream_model_id,
    adapter = excluded.adapter,
    product_label = excluded.product_label,
    source_url = excluded.source_url,
    docs_url = excluded.docs_url;
  return new;
end;
$$;

-- app_private.model_readiness as in 20261018232513_automatic_pricing.sql
create or replace function app_private.model_readiness(p_model_id text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  m app_private.model_catalog;
  c app_private.model_capability_versions;
  sc app_private.supplier_cost_versions;
  pub app_private.price_versions;
  acc app_private.provider_accounts;
  v_checks jsonb := '[]'::jsonb;
  v_complete boolean;
  cfg jsonb;
  v_defaults jsonb;
  v_refs int;
  v_n int := 0;
  v_missing int := 0;
  v_adapter boolean;
begin
  select * into m from app_private.model_catalog where id = p_model_id;
  c := app_private.capability_for(m.id);
  sc := app_private.latest_cost_version(m.id);
  select * into pub from app_private.price_versions where model_id = m.id and state = 'published' and capability_version_id = c.id;
  select * into acc from app_private.provider_accounts where id = m.provider_account_id;
  v_defaults := app_private.spec_defaults(c.spec);
  v_refs := coalesce((c.spec -> 'references' ->> 'min')::int, 0);
  v_adapter := exists (select 1 from app_private.provider_adapters a where a.adapter = m.adapter);

  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'adapter', 'ok', v_adapter,
    'label', 'Integration implemented', 'detail', case when v_adapter then 'Adapter ' || m.adapter || ' is part of this release.'
      else 'This release cannot send work to this model yet.' end));
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'schema', 'ok', c.id is not null and c.spec ? 'options' and c.spec ? 'output',
    'label', 'Supported options defined', 'detail', 'Option schema version ' || coalesce(c.version::text, '—') || '.'));
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'provider_account', 'ok', acc.enabled and not acc.paused,
    'label', 'KIE account active', 'detail', case when acc.paused then 'The KIE account is paused in Genlixs.' when not acc.enabled then 'The KIE account is disabled.' else 'KIE account is active.' end));

  if sc.id is not null then
    for cfg in select * from app_private.price_configs(c.spec, app_private.price_dims(sc.schedule)) loop
      v_n := v_n + 1;
      if app_private.supplier_credits(sc.schedule, cfg, v_refs, 1) is null then v_missing := v_missing + 1; end if;
    end loop;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'supplier_cost', 'ok', sc.id is not null and v_n > 0 and v_missing = 0,
    'label', 'KIE reference price', 'fix', case when sc.id is null or v_n = 0 or v_missing > 0 then 'edit_cost' end,
    'detail', case when sc.id is null then 'KIE reference needed: no KIE price is recorded for this model.'
      when v_n = 0 or v_missing > 0 then 'KIE reference needed for ' || greatest(v_missing, 1) || ' setting(s).'
      else 'KIE price list v' || sc.version || ' (' || sc.source_kind || ', checked ' || to_char(sc.source_checked_at, 'YYYY-MM-DD') || ').' end));

  v_complete := false;
  if pub.id is not null then
    v_complete := true;
    if pub.rules ->> 'format' = 'table' then
      -- "_refs" (reference-image count) is not a model option; the lookup adds it from the request.
      for cfg in select * from app_private.price_configs(c.spec, (pub.rules -> 'dims') - '_refs') loop
        if app_private.price_units_for(pub.rules, v_defaults || cfg, v_refs) is null then v_complete := false; end if;
      end loop;
    end if;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'price', 'ok', v_complete,
    'label', 'Automatic price', 'fix', case when v_complete then null when sc.id is null or v_n = 0 or v_missing > 0 then 'edit_cost' else 'apply_policy' end,
    'draftPriceVersionId', null,
    'detail', case when v_complete then 'Price v' || pub.version || ' follows the global pricing policy.'
      when sc.id is null or v_n = 0 or v_missing > 0 then
        case when pub.id is not null then 'Some settings have no price: KIE reference needed.' else 'No price yet: KIE reference needed.' end
      else 'No price yet. Save & apply the global pricing policy to price it.' end));
  -- Informational only: a paid private test is optional and never blocks switching a model on.
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'verification', 'warning', true,
    'ok', (m.verification_status = 'verified_by_test' and m.verified_capability_version_id = c.id) or m.verification_status = 'manual_evidence',
    'label', 'Private test (optional)', 'fix', null,
    'detail', case
      when m.verification_status = 'verified_by_test' and m.verified_capability_version_id = c.id then 'A private test completed and its output was validated.'
      when m.verification_status = 'verified_by_test' then 'Tested with older options.'
      when m.verification_status = 'manual_evidence' then 'Manual evidence recorded (not an integrated test).'
      when m.verification_status = 'test_failed' then 'The latest private test failed.'
      else 'Not tested yet.' end));
  return jsonb_build_object('checks', v_checks, 'capabilityVersionId', c.id,
    'blocking', (select count(*) from jsonb_array_elements(v_checks) x where not (x ->> 'ok')::boolean and not coalesce((x ->> 'warning')::boolean, false)));
end;
$$;

-- public.admin_routing_review as in 20261018181652_multi_provider_routing_part07.sql
create or replace function public.admin_routing_review(p_apply boolean, p_revision text default null, p_activate uuid[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability(case when p_apply then 'provider.manage' else 'provider.read' end);
  v_props jsonb := app_private.routing_review_proposals() || app_private.inventory_proposals();
  v_rev text := md5(v_props::text);
  x jsonb;
  v_changed int := 0;
  v_off int := 0;
  v_on int := 0;
  v_providers jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('provider', a.provider, 'name', coalesce(a.display_name, a.provider), 'enabled', a.enabled,
      'winningOffers', (select count(*) from jsonb_array_elements(v_props) p where p ->> 'provider' = a.provider and p ->> 'proposedDecision' = 'eligible'
        and (p ->> 'mapped')::boolean),
      'activeAfterApply', exists (select 1 from jsonb_array_elements(v_props) p where p ->> 'provider' = a.provider and p ->> 'proposedDecision' = 'eligible'
        and (p ->> 'mapped')::boolean
        and ((p ->> 'routingEnabled')::boolean or (p ->> 'offerId')::uuid = any (coalesce(p_activate, '{}'))) and p ->> 'status' = 'eligible'))
    order by a.sort_order), '[]'::jsonb)
  into v_providers
  from app_private.provider_accounts a where a.provider <> 'fake';
  if not p_apply then
    return jsonb_build_object('revision', v_rev, 'proposals', v_props, 'providers', v_providers);
  end if;
  if p_revision is distinct from v_rev then
    perform app_private.fail('REVIEW_CHANGED', 'Offers or prices changed since the preview. Preview again before applying.');
  end if;
  for x in select value from jsonb_array_elements(v_props) loop
    if x ->> 'proposedDecision' is distinct from x ->> 'currentDecision' then
      v_changed := v_changed + 1;
    end if;
    update app_private.provider_offers set decision = x ->> 'proposedDecision', decision_reason = x ->> 'reason', decided_at = now(),
      routing_enabled = case
        when x ->> 'proposedDecision' in ('dominated', 'incompatible', 'unavailable') then false
        when (x ->> 'offerId')::uuid = any (coalesce(p_activate, '{}')) and (x ->> 'canActivate')::boolean then true
        else routing_enabled end
    where id = (x ->> 'offerId')::uuid;
    if x ->> 'proposedDecision' in ('dominated', 'incompatible', 'unavailable') and (x ->> 'routingEnabled')::boolean then
      v_off := v_off + 1;
    end if;
    if (x ->> 'offerId')::uuid = any (coalesce(p_activate, '{}')) and (x ->> 'canActivate')::boolean then
      v_on := v_on + 1;
    end if;
  end loop;
  perform app_private.audit(v_actor, 'provider.manage', 'routing.review_applied', 'routing', v_rev,
    format('Routing review applied: %s decisions changed, %s offers switched off, %s switched on', v_changed, v_off, v_on), null,
    jsonb_build_object('activated', p_activate, 'proposals', (select jsonb_agg(jsonb_build_object('offerId', p ->> 'offerId', 'decision', p ->> 'proposedDecision'))
      from jsonb_array_elements(v_props) p)));
  return jsonb_build_object('applied', true, 'revision', v_rev, 'changed', v_changed, 'switchedOff', v_off, 'switchedOn', v_on, 'providers', v_providers);
end;
$$;

