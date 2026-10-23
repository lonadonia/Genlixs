-- Supplier offers of the full catalog (migration catalog_offers, 22 Oct 2026). One DO block rolled back by the final
-- exception; nothing is sent to any supplier (readiness, route_choose and quotes only).
--  O1 every offer is written switched off (not verified, routing off, no activation), with a documented current price and
--     a registered request builder whose result host is the supplier's documented one
--  O2 readiness: integration, documentation, result host and price pass, and every offer takes settings it serves cheaper
--     than the KIE reference; the one offer with an open documentation gap shows it
--  O3 once activated (inside this transaction only), each request goes to the cheapest compatible route, settings an offer
--     does not take stay on KIE, and the customer price does not move
--  O4 research entries whose product is now a model are linked to it with the reason they are not integrated; Duomi untouched
--  O5 a changed supplier price is a new version; the earlier one stays
do $$
declare
  cust uuid := pg_temp.t_user('t-co-cus-' || gen_random_uuid() || '@genlixs.test');
  am uuid := (select id from app_private.provider_accounts where provider = 'apimart' and label = 'primary');
  nz uuid := (select id from app_private.provider_accounts where provider = 'nezhagate' and label = 'primary');
  py uuid := (select id from app_private.provider_accounts where provider = 'poyo' and label = 'primary');
  r jsonb; q jsonb; q2 jsonb; rd jsonb;
  v_n int; v_txt text;
  v_ok int := 0;
  v_step text := 'setup';
  sd jsonb := '{"audio": "on", "resolution": "1080p", "duration": 5, "aspect_ratio": "16:9", "with_video": "no", "billed": 5}';
  o record;
begin
  begin
  update app_private.settings set value = '500' where key = 'max_quotes_per_minute';
  update app_private.provider_accounts set submit_blocked_until = null, submit_block_since = null, paused = false, daily_spend_cap_usd = null
    where provider in ('kie', 'apimart', 'nezhagate', 'poyo');

  -- O1 ------------------------------------------------------------------ written switched off
  v_step := 'O1';
  select count(*) into v_n from app_private.provider_offers where decision_reason like 'Documented request and price:%';
  if v_n <> 29 then raise exception 'O1 expected 29 offers, found %', v_n; end if;
  select count(*) into v_n from app_private.provider_offers f
  left join app_private.provider_adapters d on d.adapter = f.adapter
  where f.decision_reason like 'Documented request and price:%' and (
    f.status <> 'capabilities_unverified' or f.routing_enabled or f.verification_basis is not null or f.is_legacy_primary
    or f.model_id is null or f.docs_url is null or d.adapter is null or coalesce(cardinality(d.result_hosts), 0) = 0
    or (app_private.offer_price(f.id) ->> 'confidence') <> 'documented'
    or (app_private.offer_price(f.id) ->> 'checkedAt')::timestamptz <> timestamptz '2026-10-22T12:00:00Z'
    -- priced in the unit the supplier's balance is read in (so the balance check can compare them)
    or (app_private.offer_price(f.id) ->> 'unit') <> (select case a.provider when 'apimart' then 'apimart_credit' when 'poyo' then 'poyo_credit' else 'usd' end
                                                       from app_private.provider_accounts a where a.id = f.provider_account_id));
  if v_n <> 0 then raise exception 'O1 % offer(s) not written as expected', v_n; end if;
  if (select array_agg(distinct d.result_hosts[1] order by d.result_hosts[1]) from app_private.provider_adapters d
      where d.adapter in ('apimart-wan', 'apimart-pixverse', 'apimart-happyhorse', 'apimart-image-v2', 'poyo-wan-2-7', 'poyo-happyhorse', 'poyo-gemini-omni'))
     <> (select array_agg(distinct d.result_hosts[1] order by d.result_hosts[1]) from app_private.provider_adapters d where d.adapter in ('apimart-video', 'poyo-kling-motion')) then
    raise exception 'O1 result hosts differ from the supplier''s documented ones'; end if;
  -- the original routes did not move
  if exists (select 1 from app_private.provider_offers f join app_private.provider_accounts a on a.id = f.provider_account_id
             where f.is_legacy_primary and a.provider = 'kie' and (f.status <> 'eligible' or not f.routing_enabled)) then
    raise exception 'O1 a KIE original route changed'; end if;
  v_ok := v_ok + 1;

  -- O2 ------------------------------------------------------------------ readiness
  v_step := 'O2';
  for o in select x.id, x.product_key, a.provider, x.documentation_gap from app_private.provider_offers x
           join app_private.provider_accounts a on a.id = x.provider_account_id
           where x.decision_reason like 'Documented request and price:%' loop
    rd := app_private.offer_activation_readiness(o.id);
    select string_agg(x ->> 'key', ',') into v_txt from jsonb_array_elements(rd -> 'checks') x
      where not (x ->> 'ok')::boolean and x ->> 'key' in ('offer', 'integration', 'docs', 'result_hosts', 'price', 'settings');
    if v_txt is not null then raise exception 'O2 % % fails %: %', o.provider, o.product_key, v_txt, rd -> 'checks'; end if;
    if (rd ->> 'compatible')::int = 0 or (rd ->> 'cheaper')::int = 0 then
      raise exception 'O2 % % compatible % cheaper %', o.provider, o.product_key, rd ->> 'compatible', rd ->> 'cheaper'; end if;
    if ((select (x ->> 'ok')::boolean from jsonb_array_elements(rd -> 'checks') x where x ->> 'key' = 'documentation')) <> (o.documentation_gap is null) then
      raise exception 'O2 % % documentation check', o.provider, o.product_key; end if;
  end loop;
  select count(*) into v_n from app_private.provider_offers where decision_reason like 'Documented request and price:%' and documentation_gap is not null;
  if v_n <> 1 then raise exception 'O2 expected one open documentation gap, found %', v_n; end if;
  v_ok := v_ok + 1;

  -- O3 ------------------------------------------------------------------ cheapest compatible route, same price
  v_step := 'O3';
  update app_private.model_catalog set state = 'enabled' where id in ('seedance-2-0', 'happyhorse-1-0', 'wan-2-7', 'flux-3-klein-edit', 'nano-banana-2-edit');
  perform pg_temp.t_as(cust);
  q := public.create_generation_quote('seedance-2-0', 'A red fox running through fresh snow', '{"audio": "on", "resolution": "1080p", "duration": 5, "aspect_ratio": "16:9"}', '{}');
  execute 'reset role';
  -- before activation: the original route
  r := app_private.route_choose('seedance-2-0', sd, 'text', '{"outputs": 1}');
  if r -> 'chosen' ->> 'provider' <> 'kie' then raise exception 'O3 an inactive offer served %', r - 'candidates'; end if;
  -- activate (this transaction only) with fresh, sufficient balances
  update app_private.provider_accounts set enabled = true, credential_version = greatest(credential_version, 1), connection_state = 'ok',
    balance_source = 'api', last_balance_at = now() - interval '1 minute', balance_available = null, key_quota_unlimited = false,
    last_balance = case provider when 'apimart' then 100000 when 'poyo' then 100000 else 1000 end,
    balance_unit = case provider when 'apimart' then 'apimart_credit' when 'poyo' then 'poyo_credit' else 'usd' end
    where id in (am, nz, py);
  update app_private.provider_offers set status = 'eligible', routing_enabled = true, verification_basis = 'documented'
    where decision_reason like 'Documented request and price:%';
  -- Seedance 2.0 1080p with sound: NezhaGate $1.00 < APIMart $1.772 < KIE $2.55
  r := app_private.route_choose('seedance-2-0', sd, 'text', '{"outputs": 1}');
  if r ->> 'status' <> 'ok' or r -> 'chosen' ->> 'provider' <> 'nezhagate' or (r -> 'chosen' ->> 'effectiveUsd')::numeric <> 1.00
     or (r ->> 'originalUsd')::numeric <> 2.55 then raise exception 'O3 Seedance 1080p %', r - 'candidates'; end if;
  -- 720p: APIMart $0.71 < NezhaGate $0.75
  r := app_private.route_choose('seedance-2-0', sd || '{"resolution": "720p"}', 'text', '{"outputs": 1}');
  if r -> 'chosen' ->> 'provider' <> 'apimart' or (r -> 'chosen' ->> 'effectiveUsd')::numeric <> 0.71 then raise exception 'O3 Seedance 720p %', r - 'candidates'; end if;
  -- no sound: NezhaGate cannot switch it off
  r := app_private.route_choose('seedance-2-0', sd || '{"audio": "off"}', 'text', '{"outputs": 1}');
  if r -> 'chosen' ->> 'provider' <> 'apimart' then raise exception 'O3 Seedance silent %', r - 'candidates'; end if;
  -- first frame: NezhaGate has no frames
  r := app_private.route_choose('seedance-2-0', sd, 'frames', '{"outputs": 1, "counts": {"first_frame": 1}}');
  if r -> 'chosen' ->> 'provider' <> 'apimart' then raise exception 'O3 Seedance frames %', r - 'candidates'; end if;
  -- reference videos: no offer takes them, the original route serves
  r := app_private.route_choose('seedance-2-0', sd || '{"with_video": "yes", "billed": 11}', 'video',
    '{"outputs": 1, "counts": {"reference_videos": 1}, "seconds": {"reference_videos": 6}}');
  if r -> 'chosen' ->> 'provider' <> 'kie' then raise exception 'O3 Seedance with video %', r - 'candidates'; end if;
  -- the customer pays the same whichever route serves
  perform pg_temp.t_as(cust);
  q2 := public.create_generation_quote('seedance-2-0', 'The same fox', '{"audio": "on", "resolution": "1080p", "duration": 5, "aspect_ratio": "16:9"}', '{}');
  execute 'reset role';
  if q2 ->> 'creditUnits' <> q ->> 'creditUnits' then raise exception 'O3 the price moved with the route % %', q, q2; end if;
  -- HappyHorse 1.0 720p 5 s: PoYo $0.40 < APIMart $0.65 < KIE $0.70
  r := app_private.route_choose('happyhorse-1-0', '{"resolution": "720p", "duration": 5, "aspect_ratio": "16:9"}', 'text', '{"outputs": 1}');
  if r -> 'chosen' ->> 'provider' <> 'poyo' or (r -> 'chosen' ->> 'effectiveUsd')::numeric <> 0.40 then raise exception 'O3 HappyHorse %', r - 'candidates'; end if;
  -- Wan 2.7 text for 8 s: PoYo takes 5/10/15 s only, APIMart serves
  r := app_private.route_choose('wan-2-7', '{"resolution": "720p", "duration": 8, "aspect_ratio": "16:9"}', 'text', '{"outputs": 1}');
  if r -> 'chosen' ->> 'provider' <> 'apimart' then raise exception 'O3 Wan 2.7 8 s %', r - 'candidates'; end if;
  r := app_private.route_choose('wan-2-7', '{"resolution": "720p", "duration": 10, "aspect_ratio": "16:9"}', 'text', '{"outputs": 1}');
  if r -> 'chosen' ->> 'provider' <> 'poyo' then raise exception 'O3 Wan 2.7 10 s %', r - 'candidates'; end if;
  -- automatic ratio: APIMart FLUX 3 Klein takes it, NezhaGate Nano Banana 2 does not
  r := app_private.route_choose('flux-3-klein-edit', '{"resolution": "1K", "aspect_ratio": "auto"}', null, '{"outputs": 1, "counts": {"_references": 2}}');
  if r -> 'chosen' ->> 'provider' <> 'apimart' then raise exception 'O3 Klein edit %', r - 'candidates'; end if;
  r := app_private.route_choose('nano-banana-2-edit', '{"resolution": "1K", "aspect_ratio": "auto"}', null, '{"outputs": 1, "counts": {"_references": 2}}');
  if r -> 'chosen' ->> 'provider' <> 'kie' then raise exception 'O3 NB2 edit auto %', r - 'candidates'; end if;
  r := app_private.route_choose('nano-banana-2-edit', '{"resolution": "1K", "aspect_ratio": "1:1"}', null, '{"outputs": 1, "counts": {"_references": 9}}');
  if r -> 'chosen' ->> 'provider' <> 'kie' then raise exception 'O3 NB2 edit 9 images %', r - 'candidates'; end if;
  r := app_private.route_choose('nano-banana-2-edit', '{"resolution": "1K", "aspect_ratio": "1:1"}', null, '{"outputs": 1, "counts": {"_references": 8}}');
  if r -> 'chosen' ->> 'provider' <> 'nezhagate' or (r -> 'chosen' ->> 'effectiveUsd')::numeric <> 0.015 then raise exception 'O3 NB2 edit %', r - 'candidates'; end if;
  v_ok := v_ok + 1;

  -- O4 ------------------------------------------------------------------ research entries
  v_step := 'O4';
  select count(*) into v_n from app_private.provider_offers where decision_reason like 'Not integrated:%' and model_id is not null and not routing_enabled;
  if v_n <> 34 then raise exception 'O4 expected 34 linked research entries, found %', v_n; end if;
  if exists (select 1 from app_private.provider_offers f join app_private.provider_accounts a on a.id = f.provider_account_id
             where a.provider = 'duomi' and f.model_id is null and f.decision_reason like 'Not integrated:%') then
    raise exception 'O4 a Duomi entry changed'; end if;
  -- no supplier entry for a product that is now a model stays in the "outside the catalog" list
  if exists (select 1 from app_private.provider_offers f join app_private.provider_accounts a on a.id = f.provider_account_id
             where a.provider in ('apimart', 'nezhagate', 'poyo') and f.model_id is null
               and f.product_key in ('pixverse-v6', 'seedream-4', 'wan-3.0', 'nano-banana-2.1', 'wan-2.7', 'vidu-q4', 'kling-o3', 'happy-horse')) then
    raise exception 'O4 an entry for a catalog model is still unlinked'; end if;
  v_ok := v_ok + 1;

  -- O5 ------------------------------------------------------------------ changed prices
  v_step := 'O5';
  if (select p.schedule -> 'rates' ->> '2K' from app_private.provider_offer_prices p join app_private.provider_offers fo on fo.id = p.offer_id
      where fo.provider_account_id = nz and fo.product_key = 'gpt-image-2.5-flare' order by p.version desc limit 1)::numeric <> 0.03
     or (select count(*) from app_private.provider_offer_prices p join app_private.provider_offers fo on fo.id = p.offer_id
         where fo.provider_account_id = nz and fo.product_key = 'gpt-image-2.5-flare') < 2 then
    raise exception 'O5 Flare price'; end if;
  v_ok := v_ok + 1;

  raise exception 'PASS: % catalog offer test groups', v_ok;
  exception when others then
    if sqlerrm like 'PASS:%' then raise; end if;
    raise exception '% (in %)', sqlerrm, v_step;
  end;
end;
$$;
