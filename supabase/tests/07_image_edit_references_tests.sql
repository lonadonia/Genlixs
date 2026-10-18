-- Image Edit with several reference images (pending migration 20261018120000_image_edit_multi_reference; run after it).
-- Rolled back by the final exception. R1 each edit model's limit follows its documented endpoint (16/16/8/8/10) and a
-- published price is bound to the new capability with unchanged rules; R2 a quote keeps the customer's order and counts
-- a repeated image once; R3 the limit is enforced per model with the real number; R4 the price does not depend on the
-- number of images; R5 the job and the worker claim keep the order (the worker signs and the adapters send them as
-- given); R6 the v2 quote path keeps it too; R7 both staff-test paths keep it; R8 ownership, type, expiry and the minimum
-- are still enforced.
do $$
declare
  a uuid := pg_temp.t_user('t-mr-a-' || gen_random_uuid() || '@genlixs.test');
  b uuid := pg_temp.t_user('t-mr-b-' || gen_random_uuid() || '@genlixs.test');
  ops uuid := pg_temp.t_user('t-mr-ops-' || gen_random_uuid() || '@genlixs.test');
  imgs uuid[];
  ops_imgs uuid[];
  want uuid[];
  other uuid; expired uuid; vid uuid;
  q jsonb; q1 jsonb; r jsonb; w jsonb;
  job uuid;
  m record;
  v_detail text; v_hint text;
  v_ok int := 0;
begin
  -- R1 limits from the documented endpoints; published prices carried over unchanged
  for m in select * from (values ('gpt-flare-edit', 16), ('gpt-sunburst-edit', 16), ('nano-banana-pro-edit', 8),
                                 ('flux-2-pro-edit', 8), ('seedream-5-flash-edit', 10)) v(id, max) loop
    if ((app_private.capability_for(m.id)).spec -> 'references' ->> 'max')::int <> m.max
       or ((app_private.capability_for(m.id)).spec -> 'references' ->> 'min')::int <> 1
       or ((app_private.capability_for(m.id)).spec -> 'references' ->> 'maxBytes')::bigint <> 10485760
       or (app_private.capability_for(m.id)).spec -> 'references' -> 'mime' <> '["image/png", "image/jpeg", "image/webp"]'::jsonb then
      raise exception 'R1 limit %: %', m.id, (app_private.capability_for(m.id)).spec -> 'references';
    end if;
    if exists (select 1 from app_private.price_versions p where p.model_id = m.id and p.state = 'published'
               and (p.capability_version_id <> (app_private.capability_for(m.id)).id
                    or (p.source = 'capability' and p.rules is distinct from (select o.rules from app_private.price_versions o where o.id = p.restored_from)))) then
      raise exception 'R1 price of % not carried over unchanged', m.id;
    end if;
  end loop;
  v_ok := v_ok + 1;

  update app_private.model_catalog set state = 'disabled';
  update app_private.provider_accounts set submit_blocked_until = null, paused = false where provider = 'kie';
  perform pg_temp.t_enable_model('gpt-flare-edit', '{"format": "table", "dims": ["resolution"], "units": {"1K": 3, "2K": 5, "4K": 8}}');
  perform pg_temp.t_enable_model('nano-banana-pro-edit', '{"format": "table", "dims": ["resolution"], "units": {"1K": 9, "2K": 9, "4K": 12}}');
  perform pg_temp.t_enable_model('flux-2-pro-edit', '{"format": "table", "dims": ["resolution"], "units": {"1K": 3, "2K": 4}}');
  perform pg_temp.t_enable_model('seedream-5-flash-edit', '{"format": "table", "dims": ["resolution"], "units": {"1K": 2, "1.5K": 2, "2K": 2}}');
  perform app_private.grant_lot(a, 'promo', 'test:grant:' || a, 1000, null, null, 'test grant');
  insert into app_private.staff_memberships (user_id, role) values (ops, 'operations');

  -- Validated images as the finalize step stores them; listed in descending id order, so never the sorted order.
  insert into public.assets (user_id, kind, bucket, object_path, mime, bytes, width, height, state, retention_until)
  select u, 'input', 'generation-inputs', u || '/r' || g || '/source.png', 'image/png', 100000, 1024, 1024, 'validated', now() + interval '7 days'
  from generate_series(1, 17) g, (values (a), (ops)) owners(u);
  insert into public.assets (user_id, kind, bucket, object_path, mime, bytes, width, height, duration_ms, state, retention_until) values
    (b, 'input', 'generation-inputs', b || '/x/source.png', 'image/png', 100000, 1024, 1024, null, 'validated', now() + interval '7 days'),
    (a, 'input', 'generation-inputs', a || '/old/source.png', 'image/png', 100000, 1024, 1024, null, 'validated', now() - interval '1 day'),
    (a, 'input', 'generation-inputs', a || '/v/source.mp4', 'video/mp4', 3000000, 1280, 720, 6000, 'validated', now() + interval '7 days');
  select array_agg(id order by id desc) into imgs from public.assets where user_id = a and object_path like a || '/r%';
  select array_agg(id order by id desc) into ops_imgs from public.assets where user_id = ops and object_path like ops || '/r%';
  select id into other from public.assets where object_path = b || '/x/source.png';
  select id into expired from public.assets where object_path = a || '/old/source.png';
  select id into vid from public.assets where object_path = a || '/v/source.mp4';
  -- Neither ascending nor descending: image 1, image 3, image 2.
  want := array[imgs[1], imgs[3], imgs[2]];

  -- R2 the quote keeps the customer's order; a repeated image counts once, at its first position
  perform pg_temp.t_as(a);
  q := public.create_generation_quote('gpt-flare-edit', 'Put the hat from image 3 on the person in image 1', '{}', want);
  if (select normalized_input -> 'referenceAssetIds' from public.generation_quotes where id = (q ->> 'quoteId')::uuid) <> to_jsonb(want) then
    raise exception 'R2 order %', (select normalized_input -> 'referenceAssetIds' from public.generation_quotes where id = (q ->> 'quoteId')::uuid);
  end if;
  q := public.create_generation_quote('gpt-flare-edit', 'Repeated image in the list', '{}', array[imgs[2], imgs[1], imgs[2], imgs[3]]);
  if (select normalized_input -> 'referenceAssetIds' from public.generation_quotes where id = (q ->> 'quoteId')::uuid) <> to_jsonb(array[imgs[2], imgs[1], imgs[3]]) then
    raise exception 'R2 duplicates %', (select normalized_input -> 'referenceAssetIds' from public.generation_quotes where id = (q ->> 'quoteId')::uuid);
  end if;
  v_ok := v_ok + 1;

  -- R3 per-model limits, with the real number in the message and the details
  for m in select * from (values ('gpt-flare-edit', 16), ('nano-banana-pro-edit', 8), ('flux-2-pro-edit', 8), ('seedream-5-flash-edit', 10)) v(id, max) loop
    perform public.create_generation_quote(m.id, 'Combine every image here', '{}', imgs[1:m.max]);
    begin
      perform public.create_generation_quote(m.id, 'One image too many', '{}', imgs[1:m.max + 1]);
      raise exception 'R3 % accepted % images', m.id, m.max + 1;
    exception when others then
      if sqlerrm <> 'TOO_MANY_REFERENCES' then raise; end if;
      get stacked diagnostics v_detail = pg_exception_detail, v_hint = pg_exception_hint;
      if v_detail <> format('This model accepts up to %s reference images.', m.max) or (v_hint::jsonb ->> 'max')::int <> m.max
         or (v_hint::jsonb ->> 'count')::int <> m.max + 1 then
        raise exception 'R3 % message % / %', m.id, v_detail, v_hint;
      end if;
    end;
  end loop;
  v_ok := v_ok + 1;

  -- R4 the price follows the options, not the number of images
  q1 := public.create_generation_quote('gpt-flare-edit', 'Price with one image', '{"resolution": "2K"}', imgs[1:1]);
  q := public.create_generation_quote('gpt-flare-edit', 'Price with sixteen images', '{"resolution": "2K"}', imgs[1:16]);
  if q ->> 'creditUnits' <> q1 ->> 'creditUnits' or q ->> 'creditUnits' <> '5' then raise exception 'R4 % vs %', q ->> 'creditUnits', q1 ->> 'creditUnits'; end if;
  v_ok := v_ok + 1;

  -- R5 the job and the worker claim keep the order
  q := public.create_generation_quote('gpt-flare-edit', 'Put the hat from image 3 on the person in image 1', '{}', want);
  r := public.create_generation((q ->> 'quoteId')::uuid, 'key-mr-job-0001');
  job := (r -> 'job' ->> 'id')::uuid;
  execute 'reset role';
  if (select reference_asset_ids from public.generation_jobs where id = job) <> want then
    raise exception 'R5 job %', (select reference_asset_ids from public.generation_jobs where id = job);
  end if;
  w := pg_temp.t_claim(job, 'job_submit');
  if (select array_agg((e ->> 'assetId')::uuid order by o) from jsonb_array_elements(w -> 'context' -> 'references') with ordinality x(e, o)) <> want
     or w -> 'context' -> 'references' -> 0 ->> 'path' <> a || '/r' || (select substring(object_path from '/r([0-9]+)/') from public.assets where id = want[1]) || '/source.png' then
    raise exception 'R5 claim %', w -> 'context' -> 'references';
  end if;
  v_ok := v_ok + 1;

  -- R6 the v2 quote path (inputs.reference) keeps the order as well
  perform pg_temp.t_as(a);
  q := public.create_generation_quote_v2('gpt-flare-edit', 'Same request through the typed path', '{}', jsonb_build_object('reference', to_jsonb(want)));
  if (select normalized_input -> 'referenceAssetIds' from public.generation_quotes where id = (q ->> 'quoteId')::uuid) <> to_jsonb(want) then
    raise exception 'R6 v2 %', (select normalized_input -> 'referenceAssetIds' from public.generation_quotes where id = (q ->> 'quoteId')::uuid);
  end if;
  execute 'reset role';
  v_ok := v_ok + 1;

  -- R7 staff tests (v1 and v2) keep the order in the job
  perform pg_temp.t_as(ops);
  r := public.admin_create_model_test('gpt-flare-edit', 'Staff check of the reference order', '{}', array[ops_imgs[2], ops_imgs[1], ops_imgs[3]], 'key-mr-st1-0001', true);
  job := (r -> 'job' ->> 'id')::uuid;
  execute 'reset role';
  if (select reference_asset_ids from public.generation_jobs where id = job) <> array[ops_imgs[2], ops_imgs[1], ops_imgs[3]] then
    raise exception 'R7 staff v1 %', (select reference_asset_ids from public.generation_jobs where id = job);
  end if;
  perform pg_temp.t_as(ops);
  r := public.admin_create_model_test_v2('flux-2-pro-edit', 'Staff check through the typed path', '{}',
    jsonb_build_object('reference', jsonb_build_array(ops_imgs[3], ops_imgs[1], ops_imgs[2])), 'key-mr-st2-0001', true);
  job := (r -> 'job' ->> 'id')::uuid;
  execute 'reset role';
  if (select reference_asset_ids from public.generation_jobs where id = job) <> array[ops_imgs[3], ops_imgs[1], ops_imgs[2]] then
    raise exception 'R7 staff v2 %', (select reference_asset_ids from public.generation_jobs where id = job);
  end if;
  v_ok := v_ok + 1;

  -- R8 unchanged guards: another customer's file, an expired file, a video, and no image at all
  perform pg_temp.t_as(a);
  begin
    perform public.create_generation_quote('gpt-flare-edit', 'Somebody else''s image', '{}', array[imgs[1], other]);
    raise exception 'R8 foreign image accepted';
  exception when others then if sqlerrm <> 'REFERENCE_INVALID' then raise; end if; end;
  begin
    perform public.create_generation_quote('gpt-flare-edit', 'An expired image', '{}', array[expired, imgs[1]]);
    raise exception 'R8 expired image accepted';
  exception when others then if sqlerrm <> 'REFERENCE_INVALID' then raise; end if; end;
  begin
    perform public.create_generation_quote('gpt-flare-edit', 'A video as a reference', '{}', array[imgs[1], vid]);
    raise exception 'R8 video accepted';
  exception when others then if sqlerrm <> 'REFERENCE_INVALID' then raise; end if; end;
  begin
    perform public.create_generation_quote('gpt-flare-edit', 'No image at all', '{}', '{}');
    raise exception 'R8 missing image accepted';
  exception when others then if sqlerrm <> 'REFERENCE_REQUIRED' then raise; end if; end;
  execute 'reset role';
  v_ok := v_ok + 1;

  raise exception 'PASS: % image-edit reference test groups', v_ok;
end;
$$;
