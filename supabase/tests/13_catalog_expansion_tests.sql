-- Full image/video catalog (migrations catalog_engine … catalog_enable, 22 Oct 2026). One DO block rolled back by the final
-- exception; nothing is sent to any supplier.
--  E1 every new model is on, priced under the global policy for every setting, ready, and routed to its KIE original route
--  E2 the retail price is the KIE reference × (1 + markup) ÷ credit value, rounded up once per request (worked examples)
--  E3 excluded combinations are refused with the model's message, and only those; the catalog publishes them
--  E4 reference videos switch Seedance 2.0 to its "with video" rate on reference + output seconds (derived, not chosen)
--  E5 billed seconds keep the documented ceiling (Wan 3.0: clip + reference videos at most 30 s)
--  E6 input modes, slot rules and prompts: start frame / transition / references, audio-only references refused,
--     avatar seconds from the audio, prompt-free tools, a mode's allowed values
--  E7 Wan 2.6 gains image and reference-video workflows; its customer prices are unchanged
--  E8 an original route at a supplier other than KIE never routes by itself ("KIE reference needed")
--  E9 research rows of KIE products that became models are linked and switched off; a withdrawn KIE product is unavailable
do $$
declare
  cust uuid := pg_temp.t_user('t-ce-cus-' || gen_random_uuid() || '@genlixs.test');
  img uuid; img2 uuid; jpg uuid; vid6 uuid; vid20 uuid; aud4 uuid; mp3 uuid;
  q jsonb; r jsonb; v_rules jsonb; v_prev jsonb; t jsonb;
  v_n int; v_txt text; v_num numeric; v_bps int; v_v numeric; v_upu numeric;
  v_ok int := 0;
  v_step text := 'setup';
  poyo uuid := (select id from app_private.provider_accounts where provider = 'poyo' and label = 'primary');
begin
  begin
  update app_private.settings set value = '500' where key = 'max_quotes_per_minute';
  update app_private.provider_accounts set submit_blocked_until = null, paused = false where provider = 'kie';
  t := app_private.policy_terms(app_private.current_pricing_policy());
  v_bps := (t ->> 'markupBps')::int; v_v := (t ->> 'usdPerCredit')::numeric; v_upu := (t ->> 'kieUnitsPerUsd')::numeric;

  insert into public.assets (user_id, kind, bucket, object_path, mime, bytes, width, height, duration_ms, state, retention_until, media) values
    (cust, 'input', 'generation-inputs', cust || '/i1/source.png', 'image/png', 100000, 1280, 720, null, 'validated', now() + interval '7 days', null),
    (cust, 'input', 'generation-inputs', cust || '/i2/source.png', 'image/png', 100000, 720, 1280, null, 'validated', now() + interval '7 days', null),
    (cust, 'input', 'generation-inputs', cust || '/i3/source.jpg', 'image/jpeg', 100000, 1024, 1024, null, 'validated', now() + interval '7 days', null),
    (cust, 'input', 'generation-inputs', cust || '/v1/source.mp4', 'video/mp4', 3000000, 1280, 720, 6200, 'validated', now() + interval '7 days', '{"fps": 24}'),
    (cust, 'input', 'generation-inputs', cust || '/v2/source.mp4', 'video/mp4', 9000000, 1280, 720, 14000, 'validated', now() + interval '7 days', '{"fps": 30}'),
    (cust, 'input', 'generation-inputs', cust || '/a1/source.wav', 'audio/wav', 400000, null, null, 4000, 'validated', now() + interval '7 days', null),
    (cust, 'input', 'generation-inputs', cust || '/a2/source.mp3', 'audio/mpeg', 200000, null, null, 9500, 'validated', now() + interval '7 days', null);
  select id into img from public.assets where object_path = cust || '/i1/source.png';
  select id into img2 from public.assets where object_path = cust || '/i2/source.png';
  select id into jpg from public.assets where object_path = cust || '/i3/source.jpg';
  select id into vid6 from public.assets where object_path = cust || '/v1/source.mp4';
  select id into vid20 from public.assets where object_path = cust || '/v2/source.mp4';
  select id into aud4 from public.assets where object_path = cust || '/a1/source.wav';
  select id into mp3 from public.assets where object_path = cust || '/a2/source.mp3';

  -- E1 ------------------------------------------------------------------ coverage
  v_step := 'E1';
  select count(*) into v_n from app_private.model_catalog where source_checked_at = timestamptz '2026-10-22T12:00:00Z';
  if v_n <> 97 then raise exception 'E1 expected 97 new models, found %', v_n; end if;
  select count(*) into v_n from app_private.model_catalog m
  where m.source_checked_at = timestamptz '2026-10-22T12:00:00Z' and (
    m.state <> 'enabled' or m.enable_basis <> 'documented_cost'
    or (app_private.model_readiness(m.id) ->> 'blocking')::int <> 0
    or app_private.policy_model_rules(m.id, v_bps, v_v, v_upu) ->> 'status' <> 'ok'
    or not exists (select 1 from app_private.price_versions p where p.model_id = m.id and p.state = 'published'
                   and p.capability_version_id = (app_private.capability_for(m.id)).id and p.rules = app_private.policy_model_rules(m.id, v_bps, v_v, v_upu) -> 'rules')
    or not exists (select 1 from app_private.provider_offers f join app_private.provider_accounts a on a.id = f.provider_account_id
                   where f.model_id = m.id and f.is_legacy_primary and a.provider = 'kie' and f.status = 'eligible' and f.routing_enabled and f.adapter = m.adapter));
  if v_n <> 0 then raise exception 'E1 % new model(s) not on, priced, ready and routed', v_n; end if;
  -- every new model's default request routes to KIE with a known cost
  select count(*) into v_n from app_private.model_catalog m
  cross join lateral (select app_private.example_request((app_private.capability_for(m.id)).spec) e) x
  where m.source_checked_at = timestamptz '2026-10-22T12:00:00Z'
    and (app_private.route_choose(m.id, x.e -> 'options', x.e ->> 'mode', x.e -> 'quantities') -> 'chosen' ->> 'provider') is distinct from 'kie';
  if v_n <> 0 then raise exception 'E1 % default request(s) without a KIE route', v_n; end if;
  v_ok := v_ok + 1;

  -- E2 ------------------------------------------------------------------ worked examples of the formula
  v_step := 'E2';
  -- GPT Image 2 at 4K: 16 KIE credits per image
  v_rules := (select rules from app_private.price_versions where model_id = 'gpt-image-2-image' and state = 'published');
  if app_private.price_units_for(v_rules, '{"resolution": "4K", "aspect_ratio": "1:1"}', 0) <> app_private.policy_units(round(16 / v_upu, 8), v_bps, v_v) then
    raise exception 'E2 GPT Image 2 4K %', v_rules; end if;
  -- Kling 4.0 at 1080p for 30 s: 42.5 × 30 = 1,275 KIE credits for the whole request, rounded once
  v_rules := (select rules from app_private.price_versions where model_id = 'kling-4-0' and state = 'published');
  if app_private.price_units_for(v_rules, '{"resolution": "1080p", "duration": 30}', 0) <> app_private.policy_units(round(1275 / v_upu, 8), v_bps, v_v) then
    raise exception 'E2 Kling 4.0'; end if;
  -- Seedream 5.0 Pro edit with 3 images: 14 + 2 × 0.5 = 15 KIE credits (the first input image is free)
  v_rules := (select rules from app_private.price_versions where model_id = 'seedream-5-pro-edit' and state = 'published');
  if app_private.price_units_for(v_rules, '{"quality": "high", "aspect_ratio": "1:1"}', 3) <> app_private.policy_units(round(15 / v_upu, 8), v_bps, v_v) then
    raise exception 'E2 Seedream 5 Pro edit %', v_rules; end if;
  -- Grok Imagine: one task returns two images, 4 KIE credits in all
  v_rules := (select rules from app_private.price_versions where model_id = 'grok-imagine-image' and state = 'published');
  if app_private.price_units_for(v_rules, '{"aspect_ratio": "1:1"}', 0) <> app_private.policy_units(round(4 / v_upu, 8), v_bps, v_v) then
    raise exception 'E2 Grok Imagine'; end if;
  v_ok := v_ok + 1;

  -- E3 ------------------------------------------------------------------ excluded combinations
  v_step := 'E3';
  perform pg_temp.t_as(cust);
  begin
    perform public.create_generation_quote_v2('hailuo-2-3-standard', 'A fox running through snow', '{"resolution": "1080P", "duration": 10}', jsonb_build_object('first_frame', jsonb_build_array(img)));
    raise exception 'E3 Hailuo 2.3 1080p 10 s accepted';
  exception when others then if sqlerrm <> 'UNSUPPORTED_OPTION' then raise; end if; end;
  q := public.create_generation_quote_v2('hailuo-2-3-standard', 'A fox running through snow', '{"resolution": "1080P", "duration": 6}', jsonb_build_object('first_frame', jsonb_build_array(img)));
  if q ->> 'mode' <> 'image' or (q ->> 'creditUnits')::int <= 0 then raise exception 'E3 Hailuo 2.3 1080p 6 s %', q; end if;
  begin
    perform public.create_generation_quote_v2('gpt-image-2-image', 'A poster with bold type', '{"resolution": "2K", "aspect_ratio": "5:4"}', '{}');
    raise exception 'E3 GPT Image 2 2K 5:4 accepted';
  exception when others then if sqlerrm <> 'UNSUPPORTED_OPTION' then raise; end if; end;
  q := public.create_generation_quote_v2('gpt-image-2-image', 'A poster with bold type', '{"resolution": "4K", "aspect_ratio": "5:4"}', '{}');
  begin
    perform public.create_generation_quote_v2('runway-gen-4-turbo', 'A drone shot of cliffs', '{"resolution": "1080p", "duration": 10}', '{}');
    raise exception 'E3 Runway 1080p 10 s accepted';
  exception when others then if sqlerrm <> 'UNSUPPORTED_OPTION' then raise; end if; end;
  execute 'reset role';
  r := public.get_catalog();
  if (select x -> 'exclude' from jsonb_array_elements(r -> 'models') x where x ->> 'id' = 'hailuo-2-3-standard') <> '[{"duration": 10, "resolution": "1080P"}]'::jsonb
     or (select x ->> 'excludeMessage' from jsonb_array_elements(r -> 'models') x where x ->> 'id' = 'hailuo-2-3-standard') is null then
    raise exception 'E3 catalog does not publish the exclusion'; end if;
  v_ok := v_ok + 1;

  -- E4 ------------------------------------------------------------------ derived: reference video present, billed seconds
  v_step := 'E4';
  perform pg_temp.t_as(cust);
  q := public.create_generation_quote_v2('seedance-2-0', 'The dancer from the clip in a neon city', '{"resolution": "720p", "duration": 5}', jsonb_build_object('reference_videos', jsonb_build_array(vid6)));
  if q ->> 'mode' <> 'video' or q -> 'options' ->> 'with_video' <> 'yes' or (q -> 'options' ->> 'billed')::int <> 12 then raise exception 'E4 with video %', q; end if;
  v_num := (q ->> 'creditUnits')::numeric;
  q := public.create_generation_quote_v2('seedance-2-0', 'A dancer in a neon city', '{"resolution": "720p", "duration": 5}', '{}');
  if q -> 'options' ->> 'with_video' <> 'no' or (q -> 'options' ->> 'billed')::int <> 5 then raise exception 'E4 text %', q; end if;
  execute 'reset role';
  -- 720p with video: 25 × (5 + 7) = 300 KIE credits; without: 41 × 5 = 205
  if v_num <> app_private.policy_units(round(300 / v_upu, 8), v_bps, v_v) or (q ->> 'creditUnits')::numeric <> app_private.policy_units(round(205 / v_upu, 8), v_bps, v_v) then
    raise exception 'E4 prices % / %', v_num, q ->> 'creditUnits'; end if;
  perform pg_temp.t_as(cust);
  begin
    perform public.create_generation_quote_v2('seedance-2-0', 'Chosen by hand', '{"resolution": "720p", "billed": 4}', '{}');
    raise exception 'E4 a derived option was accepted from the client';
  exception when others then if sqlerrm <> 'UNSUPPORTED_OPTION' then raise; end if; end;
  begin
    perform public.create_generation_quote_v2('seedance-2-0', 'Frame plus video', '{}', jsonb_build_object('first_frame', jsonb_build_array(img), 'reference_videos', jsonb_build_array(vid6)));
    raise exception 'E4 frame with reference video accepted';
  exception when others then if sqlerrm <> 'INPUTS_NOT_COMBINABLE' then raise; end if; end;
  execute 'reset role';
  v_ok := v_ok + 1;

  -- E5 ------------------------------------------------------------------ billed-second ceiling
  v_step := 'E5';
  perform pg_temp.t_as(cust);
  begin
    perform public.create_generation_quote_v2('wan-3-0', 'Continue the scene', '{"duration": 30}', jsonb_build_object('reference_videos', jsonb_build_array(vid6)));
    raise exception 'E5 37 billed seconds accepted';
  exception when others then if sqlerrm <> 'INPUT_TOO_LONG' then raise; end if; end;
  q := public.create_generation_quote_v2('wan-3-0', 'Continue the scene', '{"duration": 20}', jsonb_build_object('reference_videos', jsonb_build_array(vid6)));
  if (q -> 'options' ->> 'billed')::int <> 27 then raise exception 'E5 %', q; end if;
  execute 'reset role';
  v_ok := v_ok + 1;

  -- E6 ------------------------------------------------------------------ modes, slots, prompts
  v_step := 'E6';
  perform pg_temp.t_as(cust);
  q := public.create_generation_quote_v2('pixverse-v6', 'The cat turns its head', '{}', jsonb_build_object('first_frame', jsonb_build_array(img)));
  if q ->> 'mode' <> 'image' then raise exception 'E6 pixverse image %', q; end if;
  q := public.create_generation_quote_v2('pixverse-v6', 'Day turns to night', '{}', jsonb_build_object('first_frame', jsonb_build_array(img), 'last_frame', jsonb_build_array(img2)));
  if q ->> 'mode' <> 'frames' then raise exception 'E6 pixverse transition %', q; end if;
  q := public.create_generation_quote_v2('kling-2-6', 'A sailing boat', '{"audio": "on", "duration": 10}', jsonb_build_object('first_frame', jsonb_build_array(jpg)));
  if q ->> 'mode' <> 'image' then raise exception 'E6 kling 2.6 %', q; end if;
  begin
    perform public.create_generation_quote_v2('minimax-h3', 'Audio only', '{}', jsonb_build_object('reference_audio', jsonb_build_array(aud4)));
    raise exception 'E6 audio-only references accepted';
  exception when others then if sqlerrm <> 'INPUTS_NOT_COMBINABLE' then raise; end if; end;
  q := public.create_generation_quote_v2('kling-avatar-standard', 'Smiles and nods while speaking', '{}',
    jsonb_build_object('portrait_image', jsonb_build_array(jpg), 'speech_audio', jsonb_build_array(aud4)));
  if q ->> 'mode' <> 'avatar' or (q -> 'options' ->> 'seconds')::int <> 4 then raise exception 'E6 avatar %', q; end if;
  begin
    perform public.create_generation_quote_v2('kling-avatar-standard', '', '{}', jsonb_build_object('portrait_image', jsonb_build_array(jpg), 'speech_audio', jsonb_build_array(aud4)));
    raise exception 'E6 avatar without prompt accepted';
  exception when others then if sqlerrm <> 'PROMPT_TOO_SHORT' then raise; end if; end;
  q := public.create_generation_quote_v2('omnihuman-1-5', '', '{"resolution": "720p"}', jsonb_build_object('portrait_image', jsonb_build_array(img), 'speech_audio', jsonb_build_array(mp3)));
  if (q -> 'options' ->> 'seconds')::int <> 10 then raise exception 'E6 omnihuman %', q; end if;
  q := public.create_generation_quote_v2('recraft-remove-background', '', '{}', jsonb_build_object('reference', jsonb_build_array(img)));
  if (q ->> 'creditUnits')::int < 1 then raise exception 'E6 prompt-free tool %', q; end if;
  begin
    perform public.create_generation_quote_v2('recraft-upscale', 'make it sharper', '{}', jsonb_build_object('reference', jsonb_build_array(img)));
    raise exception 'E6 prompt sent to a prompt-free tool';
  exception when others then if sqlerrm <> 'PROMPT_TOO_LONG' then raise; end if; end;
  begin
    perform public.create_generation_quote_v2('grok-imagine-video', 'Two images at 1080p', '{"resolution": "1080p"}', jsonb_build_object('reference_images', jsonb_build_array(img, img2)));
    raise exception 'E6 several Grok images at 1080p accepted';
  exception when others then if sqlerrm <> 'UNSUPPORTED_OPTION' then raise; end if; end;
  begin
    perform public.create_generation_quote_v2('kling-4-0', 'Middle frame alone', '{}', jsonb_build_object('keyframes', jsonb_build_array(img)));
    raise exception 'E6 keyframe without start frame accepted';
  exception when others then if sqlerrm not in ('INPUT_REQUIRED', 'INPUTS_NOT_COMBINABLE') then raise; end if; end;
  execute 'reset role';
  v_ok := v_ok + 1;

  -- E7 ------------------------------------------------------------------ Wan 2.6 gains workflows, same prices
  v_step := 'E7';
  if (select adapter from app_private.model_catalog where id = 'wan-2-6') <> 'kie-wan-2-6-v2'
     or (select upstream_model_id from app_private.provider_offers where model_id = 'wan-2-6' and is_legacy_primary) not like 'wan/2-6-text-to-video;image=%' then
    raise exception 'E7 route not updated'; end if;
  select p.rules into v_rules from app_private.price_versions p where p.model_id = 'wan-2-6' and p.state = 'published';
  select p.rules into v_prev from app_private.price_versions p where p.model_id = 'wan-2-6' and p.state = 'retired' order by p.version desc limit 1;
  if v_rules <> v_prev or (app_private.capability_for('wan-2-6')).spec -> 'modes' -> 1 ->> 'id' <> 'image' then
    raise exception 'E7 prices changed % → %', v_prev, v_rules; end if;
  -- (on a fresh database the original models start switched off; on production the owner has them on)
  update app_private.model_catalog set state = 'enabled' where id = 'wan-2-6' and state <> 'enabled';
  perform pg_temp.t_as(cust);
  q := public.create_generation_quote_v2('wan-2-6', 'The skater from the clip in a park', '{"duration": 10, "resolution": "720p"}',
    jsonb_build_object('reference_videos', jsonb_build_array(vid6)));
  if q ->> 'mode' <> 'video' then raise exception 'E7 video mode %', q; end if;
  begin
    perform public.create_generation_quote_v2('wan-2-6', 'Too long with videos', '{"duration": 15}', jsonb_build_object('reference_videos', jsonb_build_array(vid6)));
    raise exception 'E7 15 s with reference videos accepted';
  exception when others then if sqlerrm <> 'UNSUPPORTED_OPTION' then raise; end if; end;
  execute 'reset role';
  v_ok := v_ok + 1;

  -- E8 ------------------------------------------------------------------ non-KIE original route
  v_step := 'E8';
  insert into app_private.model_catalog (id, tool, public_name, purpose, provider_account_id, provider_model_id, adapter, sort_order)
  values ('t-ce-nonkie', 'video', 'Test model without KIE', 'Test', poyo, 'x', 'poyo-kling-motion', 999);
  if not exists (select 1 from app_private.provider_offers where model_id = 't-ce-nonkie' and is_legacy_primary and status = 'capabilities_unverified'
                 and not routing_enabled and decision = 'unresolved' and blocker like 'KIE reference needed%') then
    raise exception 'E8 non-KIE original route can serve'; end if;
  if exists (select 1 from app_private.provider_offers f join app_private.provider_accounts a on a.id = f.provider_account_id
             where f.is_legacy_primary and a.provider = 'kie' and (f.status <> 'eligible' or not f.routing_enabled)) then
    raise exception 'E8 a KIE original route changed'; end if;
  if (select x ->> 'label' from jsonb_array_elements(app_private.model_readiness('t-ce-nonkie') -> 'checks') x where x ->> 'key' = 'provider_account') not like '%account active'
     or (select x ->> 'label' from jsonb_array_elements(app_private.model_readiness('veo-3-1') -> 'checks') x where x ->> 'key' = 'provider_account') <> 'KIE account active' then
    raise exception 'E8 readiness label'; end if;
  v_ok := v_ok + 1;

  -- E9 ------------------------------------------------------------------ research rows
  v_step := 'E9';
  if exists (select 1 from app_private.provider_offers f join app_private.provider_accounts a on a.id = f.provider_account_id
             where a.provider = 'kie' and f.product_key in ('seedream-4.5', 'pixverse-v6', 'kling-o3', 'wan-3.0') and (f.model_id is null or f.status <> 'disabled' or f.routing_enabled)) then
    raise exception 'E9 research row still listed as a product'; end if;
  if exists (select 1 from app_private.provider_offers f join app_private.provider_accounts a on a.id = f.provider_account_id
             where a.provider = 'kie' and f.product_key = 'seedance-1.5-pro' and f.status <> 'unavailable') then
    raise exception 'E9 withdrawn KIE product'; end if;
  v_ok := v_ok + 1;

  raise exception 'PASS: % catalog expansion test groups', v_ok;
  exception when others then
    if sqlerrm like 'PASS:%' then raise; end if;
    raise exception '% (in %)', sqlerrm, v_step;
  end;
end;
$$;
