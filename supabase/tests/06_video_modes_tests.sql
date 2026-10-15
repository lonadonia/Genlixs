-- Video modes (migrations vm1–vm4, 15 Oct 2026). Rolled back by the final exception.
-- V1 a text-to-video quote with typed inputs still prices like before; V2 start/end frames and reference images are
--    validated per slot and are mutually exclusive; V3 mode limits (Veo references need 8 s) and slot needs (end frame
--    needs a start frame); V4 owner, type, expiry, length, pixel range and frame rate of a source video; V5 Seedance
--    edit derives billable seconds from the clip and the cost doubles them; V6 Motion Control: optional prompt, the
--    image-orientation 10 s rule, two required inputs; V7 Kling @element mentions need their element; V8 Extend takes
--    only the owner's finished Veo job with a task; V9 the worker claim carries ordered inputs and source tasks, the
--    job keeps its adapter, and the snapshot exposes operation, mode and inputs; V10 staff test v2 works on a disabled
--    model and customers never see disabled models.
do $$
declare
  a uuid := pg_temp.t_user('t-vm-a-' || gen_random_uuid() || '@genlixs.test');
  b uuid := pg_temp.t_user('t-vm-b-' || gen_random_uuid() || '@genlixs.test');
  ops uuid := pg_temp.t_user('t-vm-ops-' || gen_random_uuid() || '@genlixs.test');
  img1 uuid; img2 uuid; img3 uuid; small uuid; webp uuid; vid720 uuid; vid1080 uuid; vid12s uuid; vidlowfps uuid; aud uuid; other uuid;
  q jsonb; r jsonb; w jsonb; snap jsonb; c jsonb;
  veo_job uuid; job uuid;
  v_ok int := 0; v_txt text;
begin
  update app_private.model_catalog set state = 'disabled';
  update app_private.provider_accounts set submit_blocked_until = null, paused = false where provider = 'kie';
  perform pg_temp.t_enable_model('veo-3-1', '{"format": "table", "dims": ["resolution"], "units": {"720p": 30, "1080p": 33, "4k": 90}}');
  perform pg_temp.t_enable_model('kling-3-0', '{"format": "table", "dims": ["resolution", "audio", "duration"], "units": {"720p|on|5": 50, "720p|off|5": 35}}');
  perform pg_temp.t_enable_model('seedance-2-5-edit', (select jsonb_build_object('format', 'table', 'dims', '["resolution", "seconds"]'::jsonb,
    'units', jsonb_object_agg(r.res || '|' || s.n, case r.res when '480p' then 4 else 8 end * s.n))
    from (values ('480p'), ('720p')) r(res), generate_series(4, 30) s(n)));
  perform pg_temp.t_enable_model('kling-3-0-motion', (select jsonb_build_object('format', 'table', 'dims', '["mode", "seconds"]'::jsonb,
    'units', jsonb_object_agg(r.m || '|' || s.n, case r.m when '720p' then 5 else 7 end * s.n))
    from (values ('720p'), ('1080p')) r(m), generate_series(3, 30) s(n)));
  perform pg_temp.t_enable_model('veo-3-1-extend', '{"format": "table", "dims": ["tier"], "units": {"fast": 30, "lite": 15, "quality": 125}}');
  perform app_private.grant_lot(a, 'promo', 'test:grant:' || a, 1000, null, null, 'test grant');
  insert into app_private.staff_memberships (user_id, role) values (ops, 'operations');

  -- Validated inputs as the finalize step would store them (dimensions, length and frame rate from the container).
  insert into public.assets (user_id, kind, bucket, object_path, mime, bytes, width, height, duration_ms, state, retention_until, media) values
    (a, 'input', 'generation-inputs', a || '/i1/source.png', 'image/png', 100000, 1280, 720, null, 'validated', now() + interval '7 days', null),
    (a, 'input', 'generation-inputs', a || '/i2/source.png', 'image/png', 100000, 720, 1280, null, 'validated', now() + interval '7 days', null),
    (a, 'input', 'generation-inputs', a || '/i3/source.jpg', 'image/jpeg', 100000, 1024, 1024, null, 'validated', now() + interval '7 days', null),
    (a, 'input', 'generation-inputs', a || '/i4/source.png', 'image/png', 1000, 200, 200, null, 'validated', now() + interval '7 days', null),
    (a, 'input', 'generation-inputs', a || '/i5/source.webp', 'image/webp', 1000, 1024, 1024, null, 'validated', now() + interval '7 days', null),
    (a, 'input', 'generation-inputs', a || '/v1/source.mp4', 'video/mp4', 3000000, 1280, 720, 6400, 'validated', now() + interval '7 days', '{"fps": 24}'),
    (a, 'input', 'generation-inputs', a || '/v2/source.mp4', 'video/mp4', 3000000, 1920, 1080, 6000, 'validated', now() + interval '7 days', '{"fps": 30}'),
    (a, 'input', 'generation-inputs', a || '/v3/source.mov', 'video/quicktime', 3000000, 720, 1280, 12000, 'validated', now() + interval '7 days', '{"fps": 30}'),
    (a, 'input', 'generation-inputs', a || '/v4/source.mp4', 'video/mp4', 3000000, 1280, 720, 6000, 'validated', now() + interval '7 days', '{"fps": 15}'),
    (a, 'input', 'generation-inputs', a || '/a1/source.mp3', 'audio/mpeg', 100000, null, null, 4000, 'validated', now() + interval '7 days', null),
    (b, 'input', 'generation-inputs', b || '/x1/source.png', 'image/png', 100000, 1280, 720, null, 'validated', now() + interval '7 days', null);
  select id into img1 from public.assets where object_path = a || '/i1/source.png';
  select id into img2 from public.assets where object_path = a || '/i2/source.png';
  select id into img3 from public.assets where object_path = a || '/i3/source.jpg';
  select id into small from public.assets where object_path = a || '/i4/source.png';
  select id into webp from public.assets where object_path = a || '/i5/source.webp';
  select id into vid720 from public.assets where object_path = a || '/v1/source.mp4';
  select id into vid1080 from public.assets where object_path = a || '/v2/source.mp4';
  select id into vid12s from public.assets where object_path = a || '/v3/source.mov';
  select id into vidlowfps from public.assets where object_path = a || '/v4/source.mp4';
  select id into aud from public.assets where object_path = a || '/a1/source.mp3';
  select id into other from public.assets where object_path = b || '/x1/source.png';

  perform pg_temp.t_as(a);
  -- V1 text-only through v2 prices exactly as v1
  q := public.create_generation_quote_v2('veo-3-1', 'A lighthouse at dawn, slow dolly in', '{"resolution": "1080p", "duration": 6}', '{}');
  if q ->> 'creditUnits' <> '33' or q ->> 'mode' <> 'text' then raise exception 'V1 %', q; end if;
  v_ok := v_ok + 1;

  -- V2 frames and references, distinct and exclusive
  q := public.create_generation_quote_v2('veo-3-1', 'Morph from day to night', '{}', jsonb_build_object('first_frame', jsonb_build_array(img1), 'last_frame', jsonb_build_array(img3)));
  if q ->> 'mode' <> 'frames' or q -> 'inputs' -> 'first_frame' ->> 0 <> img1::text or q -> 'inputs' -> 'last_frame' ->> 0 <> img3::text then raise exception 'V2 frames %', q; end if;
  q := public.create_generation_quote_v2('veo-3-1', 'A product turntable', '{"duration": 8}', jsonb_build_object('reference_images', jsonb_build_array(img1, img2)));
  if q ->> 'mode' <> 'reference' then raise exception 'V2 reference %', q; end if;
  begin
    perform public.create_generation_quote_v2('veo-3-1', 'Both at once', '{"duration": 8}', jsonb_build_object('first_frame', jsonb_build_array(img1), 'reference_images', jsonb_build_array(img2)));
    raise exception 'V2 exclusive combination accepted';
  exception when others then if sqlerrm <> 'INPUTS_NOT_COMBINABLE' then raise; end if; end;
  begin
    perform public.create_generation_quote_v2('veo-3-1', 'Four refs', '{"duration": 8}', jsonb_build_object('reference_images', jsonb_build_array(img1, img2, img3, webp)));
    raise exception 'V2 too many references accepted';
  exception when others then if sqlerrm <> 'TOO_MANY_INPUTS' then raise; end if; end;
  begin
    perform public.create_generation_quote_v2('veo-3-1', 'Bad slot', '{}', jsonb_build_object('source_video', jsonb_build_array(vid720)));
    raise exception 'V2 unknown slot accepted';
  exception when others then if sqlerrm <> 'UNSUPPORTED_INPUT' then raise; end if; end;
  v_ok := v_ok + 1;

  -- V3 mode limits and slot needs
  begin
    perform public.create_generation_quote_v2('veo-3-1', 'Refs at 6 seconds', '{"duration": 6}', jsonb_build_object('reference_images', jsonb_build_array(img1)));
    raise exception 'V3 reference mode at 6 s accepted';
  exception when others then if sqlerrm <> 'UNSUPPORTED_OPTION' then raise; end if; end;
  begin
    perform public.create_generation_quote_v2('veo-3-1', 'End without start', '{}', jsonb_build_object('last_frame', jsonb_build_array(img1)));
    raise exception 'V3 end frame alone accepted';
  exception when others then if sqlerrm not in ('INPUT_REQUIRED', 'INPUTS_NOT_COMBINABLE') then raise; end if; end;
  begin
    perform public.create_generation_quote_v2('veo-3-1', 'Tiny frame', '{}', jsonb_build_object('first_frame', jsonb_build_array(small)));
    raise exception 'V3 small image accepted';
  exception when others then if sqlerrm <> 'INPUT_TOO_SMALL' then raise; end if; end;
  v_ok := v_ok + 1;

  -- V4 ownership, type, expiry and video limits
  begin
    perform public.create_generation_quote_v2('veo-3-1', 'Someone else''s frame', '{}', jsonb_build_object('first_frame', jsonb_build_array(other)));
    raise exception 'V4 foreign asset accepted';
  exception when others then if sqlerrm <> 'INPUT_INVALID' then raise; end if; end;
  begin
    perform public.create_generation_quote_v2('kling-3-0', 'WebP frame for Kling', '{"audio": "on"}', jsonb_build_object('first_frame', jsonb_build_array(webp)));
    raise exception 'V4 webp accepted by Kling';
  exception when others then if sqlerrm <> 'INPUT_TYPE' then raise; end if; end;
  execute 'reset role';
  update public.assets set retention_until = now() - interval '1 minute' where id = img3;
  perform pg_temp.t_as(a);
  begin
    perform public.create_generation_quote_v2('veo-3-1', 'Expired frame', '{}', jsonb_build_object('first_frame', jsonb_build_array(img3)));
    raise exception 'V4 expired asset accepted';
  exception when others then if sqlerrm <> 'INPUT_INVALID' then raise; end if; end;
  begin
    perform public.create_generation_quote_v2('seedance-2-5-edit', 'Make it snow', '{}', jsonb_build_object('source_video', jsonb_build_array(vid1080)));
    raise exception 'V4 1080p source accepted by Seedance';
  exception when others then if sqlerrm <> 'INPUT_RESOLUTION' then raise; end if; end;
  begin
    perform public.create_generation_quote_v2('seedance-2-5-edit', 'Make it snow', '{}', jsonb_build_object('source_video', jsonb_build_array(vidlowfps)));
    raise exception 'V4 15 fps source accepted';
  exception when others then if sqlerrm <> 'INPUT_FPS' then raise; end if; end;
  begin
    perform public.create_generation_quote_v2('seedance-2-5-edit', 'Make it snow', '{}', jsonb_build_object('source_video', jsonb_build_array(img1)));
    raise exception 'V4 image as source video accepted';
  exception when others then if sqlerrm <> 'INPUT_TYPE' then raise; end if; end;
  v_ok := v_ok + 1;

  -- V5 Seedance edit: 6.4 s source -> 7 billable seconds; derived option cannot be sent by the client
  q := public.create_generation_quote_v2('seedance-2-5-edit', 'Make it snow, keep the camera move', '{"resolution": "480p", "audio": "off"}',
    jsonb_build_object('source_video', jsonb_build_array(vid720), 'reference_audio', jsonb_build_array(aud)));
  if (q -> 'options' ->> 'seconds')::int <> 7 or q ->> 'creditUnits' <> '28' then raise exception 'V5 derived seconds/price %', q; end if;
  begin
    perform public.create_generation_quote_v2('seedance-2-5-edit', 'Make it snow', '{"seconds": 4}', jsonb_build_object('source_video', jsonb_build_array(vid720)));
    raise exception 'V5 client-sent derived option accepted';
  exception when others then if sqlerrm <> 'UNSUPPORTED_OPTION' then raise; end if; end;
  execute 'reset role';
  if app_private.supplier_credits((app_private.latest_cost_version('seedance-2-5-edit')).schedule, '{"resolution": "480p", "seconds": 7}') <> 238 then
    raise exception 'V5 KIE cost not reference + output seconds';
  end if;
  perform pg_temp.t_as(a);
  v_ok := v_ok + 1;

  -- V6 Motion Control
  q := public.create_generation_quote_v2('kling-3-0-motion', '', '{"mode": "720p", "orientation": "video"}',
    jsonb_build_object('motion_video', jsonb_build_array(vid12s), 'character_image', jsonb_build_array(img2)));
  if (q -> 'options' ->> 'seconds')::int <> 12 or q ->> 'creditUnits' <> '60' then raise exception 'V6 motion price %', q; end if;
  begin
    perform public.create_generation_quote_v2('kling-3-0-motion', '', '{"orientation": "image"}',
      jsonb_build_object('motion_video', jsonb_build_array(vid12s), 'character_image', jsonb_build_array(img2)));
    raise exception 'V6 12 s with image orientation accepted';
  exception when others then if sqlerrm <> 'INPUT_TOO_LONG' then raise; end if; end;
  begin
    perform public.create_generation_quote_v2('kling-3-0-motion', '', '{}', jsonb_build_object('motion_video', jsonb_build_array(vid720)));
    raise exception 'V6 missing character accepted';
  exception when others then if sqlerrm not in ('INPUTS_NOT_COMBINABLE', 'INPUT_REQUIRED') then raise; end if; end;
  v_ok := v_ok + 1;

  -- V7 Kling elements and mentions
  begin
    perform public.create_generation_quote_v2('kling-3-0', 'The dog @element1 runs', '{"audio": "on"}', '{}');
    raise exception 'V7 mention without element accepted';
  exception when others then if sqlerrm <> 'INPUT_REQUIRED' then raise; end if; end;
  begin
    perform public.create_generation_quote_v2('kling-3-0', 'The dog @element1 runs', '{"audio": "on"}', jsonb_build_object('element_1', jsonb_build_array(img1)));
    raise exception 'V7 one-image element accepted';
  exception when others then if sqlerrm <> 'TOO_FEW_INPUTS' then raise; end if; end;
  execute 'reset role';
  update public.assets set retention_until = now() + interval '7 days' where id = img3;
  perform pg_temp.t_as(a);
  q := public.create_generation_quote_v2('kling-3-0', 'The dog @element1 runs along the beach', '{"audio": "on"}',
    jsonb_build_object('element_1', jsonb_build_array(img1, img3), 'first_frame', jsonb_build_array(img1)));
  if q ->> 'creditUnits' <> '50' or q ->> 'mode' <> 'create' then raise exception 'V7 elements %', q; end if;
  v_ok := v_ok + 1;

  -- V8 Extend: own finished Veo job with a provider task only
  q := public.create_generation_quote_v2('veo-3-1', 'A lighthouse at dusk', '{}', '{}');
  r := public.create_generation((q ->> 'quoteId')::uuid, 'key-vm-veo-0001');
  veo_job := (r -> 'job' ->> 'id')::uuid;
  begin
    perform public.create_generation_quote_v2('veo-3-1-extend', 'The camera keeps rising', '{}', jsonb_build_object('source_job', jsonb_build_array(veo_job)));
    raise exception 'V8 unfinished source accepted';
  exception when others then if sqlerrm <> 'SOURCE_INVALID' then raise; end if; end;
  execute 'reset role';
  update public.generation_jobs set state = 'succeeded', settlement_state = 'captured', completed_at = now() where id = veo_job;
  insert into app_private.provider_attempts (job_id, ordinal, provider_account_id, state, provider_task_id, correlation_token_hash)
  values (veo_job, 1, (select id from app_private.provider_accounts where provider = 'kie' and label = 'primary'), 'accepted', 'veo_task_vm_1', 'x');
  perform pg_temp.t_as(a);
  q := public.create_generation_quote_v2('veo-3-1-extend', 'The camera keeps rising', '{"tier": "lite"}', jsonb_build_object('source_job', jsonb_build_array(veo_job)));
  if q ->> 'creditUnits' <> '15' then raise exception 'V8 extend price %', q; end if;
  r := public.create_generation((q ->> 'quoteId')::uuid, 'key-vm-ext-0001');
  job := (r -> 'job' ->> 'id')::uuid;
  execute 'reset role';
  perform pg_temp.t_as(b);
  begin
    perform public.create_generation_quote_v2('veo-3-1-extend', 'Not mine', '{}', jsonb_build_object('source_job', jsonb_build_array(veo_job)));
    raise exception 'V8 foreign source accepted';
  exception when others then if sqlerrm <> 'SOURCE_INVALID' then raise; end if; end;
  execute 'reset role';
  v_ok := v_ok + 1;

  -- V9 worker claim and snapshot
  w := pg_temp.t_claim(job, 'job_submit');
  c := w -> 'context';
  if c -> 'inputs' -> 'source_job' -> 0 ->> 'taskId' <> 'veo_task_vm_1' or c -> 'model' ->> 'adapter' <> 'kie-veo-extend' then raise exception 'V9 extend claim %', c; end if;
  perform pg_temp.t_as(a);
  q := public.create_generation_quote_v2('veo-3-1', 'Morph from day to night', '{}', jsonb_build_object('first_frame', jsonb_build_array(img2), 'last_frame', jsonb_build_array(img1)));
  r := public.create_generation((q ->> 'quoteId')::uuid, 'key-vm-frm-0001');
  job := (r -> 'job' ->> 'id')::uuid;
  execute 'reset role';
  -- A catalog change after the quote does not change the job's request builder.
  update app_private.model_catalog set adapter = 'kie-market-veo' where id = 'veo-3-1';
  w := pg_temp.t_claim(job, 'job_submit');
  c := w -> 'context';
  if c -> 'model' ->> 'adapter' <> 'kie-veo-3-1' then raise exception 'V9 job adapter changed with the catalog: %', c -> 'model'; end if;
  if c -> 'inputs' -> 'first_frame' -> 0 ->> 'assetId' <> img2::text or c -> 'inputs' -> 'last_frame' -> 0 ->> 'assetId' <> img1::text
     or c -> 'job' ->> 'mode' <> 'frames' or (c -> 'inputs' -> 'first_frame' -> 0 ->> 'width')::int <> 720 then
    raise exception 'V9 frames claim %', c -> 'inputs';
  end if;
  snap := app_private.job_snapshot(job);
  if snap ->> 'operation' <> 'create' or snap ->> 'mode' <> 'frames' or snap -> 'inputs' -> 'first_frame' -> 0 ->> 'kind' <> 'image' then
    raise exception 'V9 snapshot %', snap;
  end if;
  v_ok := v_ok + 1;

  -- V10 staff test v2 on a disabled model; customers never see disabled models
  update app_private.model_catalog set state = 'disabled' where id = 'kling-3-0-motion';
  perform pg_temp.t_as(a);
  select count(*) into v_txt from jsonb_array_elements(public.get_catalog() -> 'models') m where m ->> 'id' = 'kling-3-0-motion';
  if v_txt <> '0' then raise exception 'V10 disabled model visible to customers'; end if;
  begin
    perform public.staff_test_catalog();
    raise exception 'V10 customer read staff catalog';
  exception when others then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  execute 'reset role';
  insert into public.assets (user_id, kind, bucket, object_path, mime, bytes, width, height, duration_ms, state, retention_until, media)
  select ops, kind, bucket, replace(object_path, a::text, ops::text), mime, bytes, width, height, duration_ms, state, retention_until, media
  from public.assets where id in (vid720, img2);
  perform pg_temp.t_as(ops);
  if not exists (select 1 from jsonb_array_elements(public.staff_test_catalog() -> 'models') m where m ->> 'id' = 'kling-3-0-motion' and m -> 'costSchedule' is not null) then
    raise exception 'V10 staff catalog incomplete';
  end if;
  r := public.admin_create_model_test_v2('kling-3-0-motion', '', '{"mode": "720p"}', jsonb_build_object(
    'motion_video', jsonb_build_array((select id from public.assets where user_id = ops and mime = 'video/mp4')),
    'character_image', jsonb_build_array((select id from public.assets where user_id = ops and mime = 'image/png'))), 'key-vm-test-0001', true);
  if (r ->> 'estimatedSupplierCredits')::numeric <> 140 or r -> 'job' ->> 'mode' <> 'motion' then raise exception 'V10 staff test %', r; end if;
  execute 'reset role';
  v_ok := v_ok + 1;

  raise exception 'PASS: % video-mode test groups', v_ok;
end;
$$;
