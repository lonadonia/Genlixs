-- Simplified admin controls and explicit credit pricing: reference values (versioned, never touching wallets,
-- orders, quotes, running jobs or prices), the owner's arithmetic example, one-step model prices (rounding,
-- concurrency, audited below-cost acceptance), bulk markup with kept settings and manual-price protection,
-- availability without a paid-test gate, package editing with bonus credits, and the admin reads.
-- Rolled back by the final exception. Run 00_helpers.sql first in the same session.
do $$
declare
  owner_u uuid := pg_temp.t_user('t-own-' || gen_random_uuid() || '@genlixs.test');
  fin uuid := pg_temp.t_user('t-fin-' || gen_random_uuid() || '@genlixs.test');
  ops uuid := pg_temp.t_user('t-ops-' || gen_random_uuid() || '@genlixs.test');
  sup uuid := pg_temp.t_user('t-sup-' || gen_random_uuid() || '@genlixs.test');
  cust uuid := pg_temp.t_user('t-cus-' || gen_random_uuid() || '@genlixs.test');
  p jsonb; r jsonb; q jsonb; q2 jsonb; m jsonb; v_row jsonb; snap jsonb; snap2 jsonb;
  v_ok int := 0; v_n int; v_job uuid; v_id uuid; v_id2 uuid; v_pub uuid; v_txt text; v_order uuid;
  v_rk uuid := (app_private.current_reference('kie_purchase')).id;
  v_rc uuid := (app_private.current_reference('credit_value')).id;
begin
  insert into app_private.staff_memberships (user_id, role) values (owner_u, 'owner'), (fin, 'finance'), (ops, 'operations'), (sup, 'support');
  update app_private.price_versions set state = 'retired' where state in ('published', 'draft');
  update app_private.model_catalog set state = 'disabled', verification_status = 'untested', verified_capability_version_id = null
    where state <> 'disabled' or verification_status <> 'untested' or verified_capability_version_id is not null;
  update app_private.settings set value = '100' where key = 'max_quotes_per_minute';
  update app_private.settings set value = '10' where key = 'max_active_jobs_per_user';

  -- S1 reference values: permissions, validation, versions, concurrency, audit, append-only
  perform pg_temp.t_as(cust);
  begin perform public.admin_save_pricing_reference('credit_value', 5, 250, 0, null, null, null); raise exception 'S1 customer saved';
  exception when others then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  begin perform public.admin_reference_impact('credit_value', 5, 250); raise exception 'S1 customer impact';
  exception when others then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  execute 'reset role';
  perform pg_temp.t_as(ops);
  begin perform public.admin_save_pricing_reference('kie_purchase', 5, 1000, 0, null, null, null); raise exception 'S1 operations saved';
  exception when others then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  execute 'reset role';
  perform pg_temp.t_as(fin);
  begin perform public.admin_save_pricing_reference('credit_value', 0, 250, 0, null, null, v_rc);
    raise exception 'S1 zero amount';
  exception when others then if sqlerrm <> 'INVALID_INPUT' then raise; end if; end;
  begin perform public.admin_save_pricing_reference('credit_value', 5, 250.5, 0, null, null, v_rc);
    raise exception 'S1 fractional Genlixs credits';
  exception when others then if sqlerrm <> 'INVALID_INPUT' then raise; end if; end;
  begin perform public.admin_save_pricing_reference('kie_purchase', 5, 1000, 1000, null, null, v_rk);
    raise exception 'S1 bonus >= credits';
  exception when others then if sqlerrm <> 'INVALID_INPUT' then raise; end if; end;
  begin perform public.admin_save_pricing_reference('kie_purchase', 5, 1000, 0, 'http://kie.ai', null, v_rk);
    raise exception 'S1 insecure link';
  exception when others then if sqlerrm <> 'INVALID_INPUT' then raise; end if; end;
  begin perform public.admin_save_pricing_reference('credit_value', 5, 250, 0, null, null, gen_random_uuid()); raise exception 'S1 stale editor saved';
  exception when others then if sqlerrm <> 'REFERENCE_CHANGED' then raise; end if; end;
  -- Known starting values for this test (whatever the live values are): $5 / 1,000 KIE credits and $5 / 250 Genlixs credits.
  r := public.admin_save_pricing_reference('kie_purchase', 10, 2000, 0, 'https://kie.ai/pricing', 'test', v_rk);
  r := public.admin_save_pricing_reference('kie_purchase', 5, 1000, 0, 'https://kie.ai/pricing', null, (r -> 'reference' ->> 'id')::uuid);
  r := public.admin_save_pricing_reference('credit_value', 5, 250, 0, null, null, v_rc);
  if (r -> 'reference' ->> 'usdPerCredit')::numeric <> 0.02 or (r -> 'reference' ->> 'isExample')::boolean then raise exception 'S1 credit value %', r; end if;
  -- the same values again are not a new version
  r := public.admin_save_pricing_reference('credit_value', 5.00, 250, 0, null, null, (r -> 'reference' ->> 'id')::uuid);
  if not (r ->> 'unchanged')::boolean then raise exception 'S1 identical value created a version'; end if;
  execute 'reset role';
  if (app_private.current_reference('kie_purchase')).usd_per_credit <> 0.005 or app_private.kie_usd_per_credit() <> 0.005
     or (app_private.setting('kie_usd_per_credit') #>> '{}')::numeric <> 0.005 then raise exception 'S1 kie rate'; end if;
  if not exists (select 1 from app_private.admin_audit_logs where action = 'pricing.reference' and actor_id = fin
                 and reason = 'Set the Genlixs credit value to $5 for 250 credits ($0.02 per credit). Wallets, purchases, quotes, running jobs and published prices were not changed.')
    then raise exception 'S1 audit description'; end if;
  begin update app_private.pricing_reference_versions set note = 'x' where kind = 'credit_value'; raise exception 'S1 reference mutable';
  exception when others then if sqlerrm not like 'append-only journal%' then raise; end if; end;
  begin delete from app_private.pricing_reference_versions where kind = 'kie_purchase'; raise exception 'S1 reference deletable';
  exception when others then if sqlerrm not like 'append-only journal%' then raise; end if; end;
  v_ok := v_ok + 1;

  -- S2 the owner's example: 6 KIE credits ($0.03) charged 3 Genlixs credits ($0.06) = +100 %; 30 %/50 % commission
  perform pg_temp.t_as(fin);
  p := public.admin_pricing_preview('selected', array['gpt-flare-image', 'seedream-5-flash-image'], 100, false);
  execute 'reset role';
  if (p -> 'basis' ->> 'usdPerCredit')::numeric <> 0.02 or p -> 'basis' ->> 'source' <> 'reference' then raise exception 'S2 basis %', p -> 'basis'; end if;
  select x into m from jsonb_array_elements(p -> 'models') x where x ->> 'modelId' = 'gpt-flare-image';
  select x into v_row from jsonb_array_elements(m -> 'configs') x where x ->> 'key' = '1K';
  if (v_row ->> 'supplierCredits')::numeric <> 6 or (v_row ->> 'supplierUsd')::numeric <> 0.03 or (v_row ->> 'targetUsd')::numeric <> 0.06
     or (v_row ->> 'proposedUnits')::int <> 3 then raise exception 'S2 flare 1K %', v_row; end if;
  if (v_row -> 'contribution' ->> 'revenueUsd')::numeric <> 0.06 or (v_row -> 'contribution' ->> 'direct')::numeric <> 0.03
     or (v_row -> 'contribution' ->> 'affiliateBase')::numeric <> 0.012 or (v_row -> 'contribution' ->> 'affiliateUplift')::numeric <> 0 then
    raise exception 'S2 contribution %', v_row -> 'contribution'; end if;
  -- rounding: 3.24 KIE credits = $0.0162; +100 % = $0.0324; 1.62 credits rounds up to 2 ($0.04)
  select x into m from jsonb_array_elements(p -> 'models') x where x ->> 'modelId' = 'seedream-5-flash-image';
  select x into v_row from jsonb_array_elements(m -> 'configs') x where x ->> 'key' = '1K';
  if (v_row ->> 'supplierUsd')::numeric <> 0.0162 or (v_row ->> 'targetUsd')::numeric <> 0.0324 or (v_row ->> 'proposedUnits')::int <> 2 then
    raise exception 'S2 rounding %', v_row; end if;
  -- the impact preview of a reference value saves nothing
  select count(*) into v_n from app_private.pricing_reference_versions;
  perform pg_temp.t_as(fin);
  r := public.admin_reference_impact('credit_value', 5, 100);
  execute 'reset role';
  if (r ->> 'usdPerCredit')::numeric <> 0.05 or (select count(*) from app_private.pricing_reference_versions) <> v_n then raise exception 'S2 impact %', r; end if;
  v_ok := v_ok + 1;

  -- S3 one-step model price: permissions, validation, concurrency, below-cost confirmation, unchanged, markup summary
  perform pg_temp.t_as(fin);
  begin perform public.admin_save_model_price('gpt-flare-image', '{"1K": 3, "2K": 5, "4K": 8}', null, true, false, null); raise exception 'S3 finance published';
  exception when others then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  r := public.admin_save_model_price('gpt-flare-image', '{"1K": 3, "2K": 5, "4K": 8}', null, false, false, null);
  if r ->> 'state' <> 'draft' then raise exception 'S3 finance draft %', r; end if;
  v_id := (r ->> 'priceVersionId')::uuid;
  execute 'reset role';
  perform pg_temp.t_as(owner_u);
  begin perform public.admin_save_model_price('gpt-flare-image', '{"1K": 3, "2K": 5, "4K": 8}', null, true, false, null); raise exception 'S3 stale editor';
  exception when others then if sqlerrm <> 'PRICE_CHANGED' then raise; end if; end;
  begin perform public.admin_save_model_price('gpt-flare-image', '{"1K": 3, "2K": 5}', null, true, false, v_id); raise exception 'S3 missing setting';
  exception when others then if sqlerrm <> 'INVALID_PRICE' then raise; end if; end;
  begin perform public.admin_save_model_price('gpt-flare-image', '{"1K": 2.5, "2K": 5, "4K": 8}', null, true, false, v_id); raise exception 'S3 fractional credits';
  exception when others then if sqlerrm <> 'INVALID_PRICE' then raise; end if; end;
  begin perform public.admin_save_model_price('gpt-flare-image', '{"1K": 0, "2K": 5, "4K": 8}', null, true, false, v_id); raise exception 'S3 zero credits';
  exception when others then if sqlerrm <> 'INVALID_PRICE' then raise; end if; end;
  begin perform public.admin_save_model_price('gpt-flare-image', '{"1K": 3, "2K": 5, "4K": 8, "8K": 9}', null, true, false, v_id); raise exception 'S3 extra setting';
  exception when others then if sqlerrm <> 'INVALID_PRICE' then raise; end if; end;
  execute 'reset role';
  select count(*) into v_n from app_private.price_versions;
  perform pg_temp.t_as(owner_u);
  -- 4K costs 16 KIE credits = $0.08; 3 credits = $0.06 is below cost and needs an explicit confirmation
  begin perform public.admin_save_model_price('gpt-flare-image', '{"1K": 3, "2K": 5, "4K": 3}', null, true, false, v_id); raise exception 'S3 loss without confirmation';
  exception when others then if sqlerrm <> 'LOSS_CONFIRMATION_REQUIRED' then raise; end if; end;
  execute 'reset role';
  if (select count(*) from app_private.price_versions) <> v_n then raise exception 'S3 refused save wrote a version'; end if;
  perform pg_temp.t_as(owner_u);
  r := public.admin_save_model_price('gpt-flare-image', '{"1K": 3, "2K": 5, "4K": 3}', null, true, true, v_id);
  if r ->> 'state' <> 'published' or r -> 'belowCost' <> '["4K"]'::jsonb then raise exception 'S3 accepted loss %', r; end if;
  v_pub := (r ->> 'priceVersionId')::uuid;
  execute 'reset role';
  if not exists (select 1 from app_private.admin_audit_logs where action = 'price.publish' and target_id = v_pub::text and actor_id = owner_u
                 and reason like 'Set the price of GPT Image 2.5 Flare (v%, 3–5 credits); accepted 1 configuration(s) below the KIE cost') then
    raise exception 'S3 loss audit %', (select reason from app_private.admin_audit_logs where target_id = v_pub::text); end if;
  if (select state from app_private.price_versions where id = v_id) <> 'retired' then raise exception 'S3 draft not superseded'; end if;
  perform pg_temp.t_as(owner_u);
  r := public.admin_save_model_price('gpt-flare-image', '{"1K": 3, "2K": 5, "4K": 8}', null, true, false, v_pub);
  v_pub := (r ->> 'priceVersionId')::uuid;
  r := public.admin_save_model_price('gpt-flare-image', '{"1K": 3, "2K": 5, "4K": 8}', null, true, false, v_pub);
  if not (r ->> 'unchanged')::boolean or (r ->> 'priceVersionId')::uuid <> v_pub then raise exception 'S3 unchanged %', r; end if;
  r := public.admin_catalog();
  execute 'reset role';
  select x into m from jsonb_array_elements(r -> 'models') x where x ->> 'id' = 'gpt-flare-image';
  -- 1K 3 cr = $0.06 on $0.03 (+100 %); 2K 5 cr = $0.10 on $0.05 (+100 %); 4K 8 cr = $0.16 on $0.08 (+100 %)
  if (m -> 'pricing' ->> 'markupMin')::numeric <> 1 or (m -> 'pricing' ->> 'markupMax')::numeric <> 1 or (m -> 'pricing' ->> 'belowCost')::int <> 0 then
    raise exception 'S3 markup summary %', m -> 'pricing'; end if;
  v_ok := v_ok + 1;

  -- S4 a reference change touches no wallet, ledger, order, quote, running job or published price
  perform app_private.grant_lot(cust, 'promo', 'test:s4:' || cust, 100, null, null, 'test grant');
  perform pg_temp.t_as(ops);
  perform public.admin_set_model_availability('gpt-flare-image', 'enabled');
  execute 'reset role';
  perform pg_temp.t_as(cust);
  q := public.create_generation_quote('gpt-flare-image', 'A ceramic lamp, editorial photo', '{"resolution": "2K"}', '{}');
  r := public.create_generation((q ->> 'quoteId')::uuid, 's4-job-0001');
  v_job := (r -> 'job' ->> 'id')::uuid;
  q2 := public.create_generation_quote('gpt-flare-image', 'A quote kept open across the change', '{"resolution": "1K"}', '{}');
  execute 'reset role';
  snap := jsonb_build_object(
    'lots', (select jsonb_agg(to_jsonb(l) order by l.id) from public.credit_lots l where l.user_id = cust),
    'ledger', (select count(*) from public.credit_ledger where user_id = cust),
    'reservation', (select to_jsonb(x) from public.credit_reservations x where x.job_id = v_job),
    'job', (select units || '/' || price_version_id from public.generation_jobs where id = v_job),
    'prices', (select jsonb_agg(jsonb_build_array(id, state, rules) order by id) from app_private.price_versions where state <> 'retired'),
    'orders', (select count(*) from public.payment_orders), 'quotes', (select jsonb_agg(jsonb_build_array(id, units, price_version_id) order by id)
      from public.generation_quotes where user_id = cust));
  perform pg_temp.t_save_ref(fin, 'credit_value', 5, 100);
  perform pg_temp.t_save_ref(fin, 'kie_purchase', 6, 1000);
  snap2 := jsonb_build_object(
    'lots', (select jsonb_agg(to_jsonb(l) order by l.id) from public.credit_lots l where l.user_id = cust),
    'ledger', (select count(*) from public.credit_ledger where user_id = cust),
    'reservation', (select to_jsonb(x) from public.credit_reservations x where x.job_id = v_job),
    'job', (select units || '/' || price_version_id from public.generation_jobs where id = v_job),
    'prices', (select jsonb_agg(jsonb_build_array(id, state, rules) order by id) from app_private.price_versions where state <> 'retired'),
    'orders', (select count(*) from public.payment_orders), 'quotes', (select jsonb_agg(jsonb_build_array(id, units, price_version_id) order by id)
      from public.generation_quotes where user_id = cust));
  if snap2 <> snap then raise exception 'S4 reference change touched balances or prices'; end if;
  -- the open quote still works at its quoted price
  perform pg_temp.t_as(cust);
  r := public.create_generation((q2 ->> 'quoteId')::uuid, 's4-job-0002');
  if (r -> 'job' ->> 'units')::int <> 3 and (select units from public.generation_jobs where id = (r -> 'job' ->> 'id')::uuid) <> 3 then raise exception 'S4 quote %', r; end if;
  execute 'reset role';
  -- only the valuation changed: 3 credits at $0.05 = $0.15 against $0.036 (6 KIE credits at $0.006)
  perform pg_temp.t_as(fin);
  r := public.admin_model_detail('gpt-flare-image');
  execute 'reset role';
  select x into v_row from jsonb_array_elements(r -> 'table' -> 'configs') x where x ->> 'key' = '1K';
  if (v_row ->> 'supplierUsd')::numeric <> 0.036 or (v_row -> 'currentContribution' ->> 'revenueUsd')::numeric <> 0.15 then raise exception 'S4 valuation %', v_row; end if;
  -- back to the example values for the following groups
  perform pg_temp.t_save_ref(fin, 'credit_value', 5, 250);
  perform pg_temp.t_save_ref(fin, 'kie_purchase', 5, 1000);
  v_ok := v_ok + 1;

  -- S5 bulk markup: manual prices protected, kept settings, all-or-nothing, stale preview, drafts for finance
  perform pg_temp.t_as(owner_u);
  p := public.admin_pricing_preview('images', null, 200, false);
  select x into m from jsonb_array_elements(p -> 'models') x where x ->> 'modelId' = 'gpt-flare-image';
  if m ->> 'status' <> 'manual_override' or (m ->> 'selectable')::boolean then raise exception 'S5 manual price not protected'; end if;
  begin perform public.admin_pricing_save('images', null, 200, false, p ->> 'revision', array['gpt-flare-image']); raise exception 'S5 manual price overwritten';
  exception when others then if sqlerrm <> 'ROW_NOT_APPLICABLE' then raise; end if; end;
  p := public.admin_pricing_preview('images', null, 200, true);
  execute 'reset role';
  select count(*) into v_n from app_private.price_versions;
  perform pg_temp.t_as(owner_u);
  -- a kept setting without a current price fails the whole batch
  begin perform public.admin_pricing_save('images', null, 200, true, p ->> 'revision', array['gpt-flare-image', 'nano-banana-2-image'],
      '{"nano-banana-2-image": ["1K"]}');
    raise exception 'S5 kept unpriced';
  exception when others then if sqlerrm <> 'EXCLUDED_UNPRICED' then raise; end if; end;
  begin perform public.admin_pricing_save('images', null, 200, true, p ->> 'revision', array['gpt-flare-image'], '{"gpt-flare-image": ["1K", "2K", "4K"]}');
    raise exception 'S5 everything kept';
  exception when others then if sqlerrm <> 'NOTHING_TO_CHANGE' then raise; end if; end;
  begin perform public.admin_pricing_save('images', null, 200, true, p ->> 'revision', array['gpt-flare-image'], '{"veo-3-1": ["720p"]}');
    raise exception 'S5 kept outside the selection';
  exception when others then if sqlerrm <> 'INVALID_INPUT' then raise; end if; end;
  execute 'reset role';
  if (select count(*) from app_private.price_versions) <> v_n then raise exception 'S5 refused batch wrote versions'; end if;
  perform pg_temp.t_as(fin);
  begin perform public.admin_pricing_save('images', null, 200, true, p ->> 'revision', array['gpt-flare-image'], '{}', true); raise exception 'S5 finance published';
  exception when others then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  execute 'reset role';
  perform pg_temp.t_as(owner_u);
  -- keep 1K at 3 credits; 2K and 4K follow +200 % ($0.05 -> $0.15 = 8 cr; $0.08 -> $0.24 = 12 cr); nano banana 2 priced too
  r := public.admin_pricing_save('images', null, 200, true, p ->> 'revision', array['gpt-flare-image', 'nano-banana-2-image'], '{"gpt-flare-image": ["1K"]}');
  execute 'reset role';
  if jsonb_array_length(r -> 'items') <> 2 then raise exception 'S5 items %', r; end if;
  if (select rules -> 'units' from app_private.price_versions where model_id = 'gpt-flare-image' and state = 'published') <> '{"1K": 3, "2K": 8, "4K": 12}'::jsonb then
    raise exception 'S5 kept setting %', (select rules from app_private.price_versions where model_id = 'gpt-flare-image' and state = 'published'); end if;
  if not exists (select 1 from app_private.admin_audit_logs where action = 'pricing.batch_publish' and target_id = r ->> 'batchId'
                 and reason like 'Set prices for 2 model(s) at +200 % above KIE cost, $0.02 per Genlixs credit (batch %') then raise exception 'S5 audit'; end if;
  -- a reference change after a preview makes the preview stale
  perform pg_temp.t_as(owner_u);
  p := public.admin_pricing_preview('selected', array['flux-2-pro-image'], 100, false);
  execute 'reset role';
  perform pg_temp.t_save_ref(fin, 'credit_value', 5, 200);
  perform pg_temp.t_as(owner_u);
  begin perform public.admin_pricing_save('selected', array['flux-2-pro-image'], 100, false, p ->> 'revision', array['flux-2-pro-image']); raise exception 'S5 stale applied';
  exception when others then if sqlerrm <> 'PREVIEW_STALE' then raise; end if; end;
  execute 'reset role';
  perform pg_temp.t_save_ref(fin, 'credit_value', 5, 250);
  perform pg_temp.t_as(fin);
  p := public.admin_pricing_preview('selected', array['flux-2-pro-image'], 100, false);
  r := public.admin_pricing_save('selected', array['flux-2-pro-image'], 100, false, p ->> 'revision', array['flux-2-pro-image'], '{}', false);
  execute 'reset role';
  if (select state from app_private.price_versions where id = (r -> 'items' -> 0 ->> 'priceVersionId')::uuid) <> 'draft' then raise exception 'S5 finance draft'; end if;
  v_ok := v_ok + 1;

  -- S6 availability: no paid-test gate, truthful status, off blocks new and earlier quotes, running jobs continue
  perform pg_temp.t_as(ops);
  begin perform public.admin_set_model_availability('flux-2-pro-image', 'enabled'); raise exception 'S6 enabled without published price';
  exception when others then if sqlerrm <> 'MODEL_NOT_PRICED' then raise; end if; end;
  r := public.admin_set_model_availability('nano-banana-2-image', 'enabled');
  if r ->> 'enableBasis' <> 'documented_cost' or r ->> 'verificationStatus' <> 'untested' then raise exception 'S6 enable untested %', r; end if;
  execute 'reset role';
  select count(*) into v_n from app_private.admin_audit_logs where target_id = 'nano-banana-2-image';
  perform pg_temp.t_as(ops);
  r := public.admin_set_model_availability('nano-banana-2-image', 'enabled');
  if not (r ->> 'unchanged')::boolean then raise exception 'S6 repeat not idempotent'; end if;
  execute 'reset role';
  if (select count(*) from app_private.admin_audit_logs where target_id = 'nano-banana-2-image') <> v_n then raise exception 'S6 repeat audited'; end if;
  if (select verification_status from app_private.model_catalog where id = 'nano-banana-2-image') <> 'untested' then raise exception 'S6 marked tested'; end if;
  if not exists (select 1 from app_private.admin_audit_logs where target_id = 'nano-banana-2-image' and action = 'model.availability'
                 and reason = 'Turned on Nano Banana 2 (not tested yet; priced on the documented KIE cost)') then raise exception 'S6 audit'; end if;
  r := app_private.model_readiness('nano-banana-2-image');
  select x into v_row from jsonb_array_elements(r -> 'checks') x where x ->> 'key' = 'verification';
  if not (v_row ->> 'warning')::boolean or (r ->> 'blocking')::int <> 0 then raise exception 'S6 readiness %', r; end if;
  perform pg_temp.t_as(cust);
  q := public.create_generation_quote('nano-banana-2-image', 'A glass of lemonade, studio light', '{}', '{}');
  execute 'reset role';
  perform pg_temp.t_as(ops);
  r := public.admin_set_model_availability('nano-banana-2-image', 'disabled');
  execute 'reset role';
  perform pg_temp.t_as(cust);
  begin perform public.create_generation((q ->> 'quoteId')::uuid, 's6-job-0001'); raise exception 'S6 earlier quote accepted after off';
  exception when others then if sqlerrm <> 'MODEL_UNAVAILABLE' then raise; end if; end;
  begin perform public.create_generation_quote('nano-banana-2-image', 'Another lemonade', '{}', '{}'); raise exception 'S6 quote after off';
  exception when others then if sqlerrm <> 'MODEL_UNAVAILABLE' then raise; end if; end;
  begin perform public.admin_set_model_availability('nano-banana-2-image', 'enabled'); raise exception 'S6 customer switched';
  exception when others then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  execute 'reset role';
  if (select state from public.generation_jobs where id = v_job) <> 'queued' then raise exception 'S6 running job affected'; end if;
  v_ok := v_ok + 1;

  -- S7 packages: bonus credits, one package at a time, owner-only for what customers can buy, orders keep their terms
  v_txt := (select product_key from app_private.product_versions order by sort_order, version limit 1);
  v_id := (select id from app_private.product_versions where product_key = v_txt order by version desc limit 1);
  snap := (select jsonb_agg(jsonb_build_array(id, state, amount_minor, credits) order by id) from app_private.product_versions where product_key <> v_txt);
  perform pg_temp.t_as(fin);
  begin perform public.admin_save_package(v_txt, 'Starter', 900, 200, 50, true, v_id); raise exception 'S7 finance offered a package';
  exception when others then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  execute 'reset role';
  perform pg_temp.t_as(owner_u);
  begin perform public.admin_save_package(v_txt, 'Starter', 900, 200, 50, true, gen_random_uuid()); raise exception 'S7 stale package editor';
  exception when others then if sqlerrm <> 'PACKAGE_CHANGED' then raise; end if; end;
  begin perform public.admin_save_package(v_txt, 'Starter', 900, 0, 50, true, v_id); raise exception 'S7 zero included';
  exception when others then if sqlerrm <> 'INVALID_INPUT' then raise; end if; end;
  r := public.admin_save_package(v_txt, 'Starter', 900, 200, 50, true, v_id);
  v_id := (r ->> 'productVersionId')::uuid;
  execute 'reset role';
  if (select state || '/' || credits || '/' || bonus_credits from app_private.product_versions where id = v_id) <> 'published/250/50' then
    raise exception 'S7 package version %', (select row_to_json(x) from app_private.product_versions x where id = v_id); end if;
  if (select jsonb_agg(jsonb_build_array(id, state, amount_minor, credits) order by id) from app_private.product_versions where product_key <> v_txt) <> snap then
    raise exception 'S7 other packages changed'; end if;
  if not exists (select 1 from jsonb_array_elements(public.get_products()) x where x ->> 'key' = v_txt and x ->> 'credits' = '250' and x ->> 'bonusCredits' = '50') then
    raise exception 'S7 public products'; end if;
  perform pg_temp.t_as(cust);
  r := public.create_checkout_order(v_txt, 'test-order-key-0001');
  v_order := (r ->> 'orderId')::uuid;
  if (r ->> 'credits')::int <> 250 or (r ->> 'amountMinor')::int <> 900 then raise exception 'S7 order snapshot %', r; end if;
  execute 'reset role';
  perform pg_temp.t_as(owner_u);
  r := public.admin_save_package(v_txt, 'Starter', 900, 200, 50, true, v_id);
  if not (r ->> 'unchanged')::boolean then raise exception 'S7 unchanged created a version'; end if;
  r := public.admin_save_package(v_txt, 'Starter', 1000, 200, 50, true, v_id);
  v_id2 := (r ->> 'productVersionId')::uuid;
  execute 'reset role';
  if (select state from app_private.product_versions where id = v_id) <> 'retired' or (select state from app_private.product_versions where id = v_id2) <> 'published' then
    raise exception 'S7 new version'; end if;
  if (select amount_minor || '/' || credits || '/' || product_version_id from public.payment_orders where id = v_order) <> '900/250/' || v_id then
    raise exception 'S7 existing order changed'; end if;
  begin update app_private.product_versions set bonus_credits = 0 where id = v_id; raise exception 'S7 bonus of a sold version mutable';
  exception when others then if sqlerrm not like 'published product terms are immutable%' then raise; end if; end;
  perform pg_temp.t_as(owner_u);
  r := public.admin_save_package(v_txt, 'Starter', 1000, 200, 50, false, v_id2);
  execute 'reset role';
  if exists (select 1 from jsonb_array_elements(public.get_products()) x where x ->> 'key' = v_txt) then raise exception 'S7 still offered'; end if;
  if not exists (select 1 from app_private.admin_audit_logs where action = 'product.save' and reason = 'Updated package Starter: USD 10.00 for 200 credits + 50 bonus, not offered') then
    raise exception 'S7 audit'; end if;
  v_ok := v_ok + 1;

  -- S8 reads: references for pricing roles only, promotions, settings section, KIE balance in USD at the reference rate
  perform pg_temp.t_as(sup);
  r := public.admin_catalog();
  if r -> 'references' <> 'null'::jsonb or r -> 'economics' <> 'null'::jsonb then raise exception 'S8 support sees references'; end if;
  r := public.admin_settings();
  if jsonb_array_length(r -> 'settings') < 5 or (r -> 'access' ->> 'canManageSettings')::boolean then raise exception 'S8 settings for support %', r -> 'access'; end if;
  execute 'reset role';
  perform pg_temp.t_as(fin);
  r := public.admin_catalog();
  if (r -> 'references' -> 'credit' ->> 'usdPerCredit')::numeric <> 0.02 or (r -> 'references' -> 'kie' ->> 'usdPerCredit')::numeric <> 0.005
     or jsonb_array_length(r -> 'references' -> 'history') < 2 then raise exception 'S8 references %', r -> 'references'; end if;
  if not exists (select 1 from jsonb_array_elements(r -> 'products') x where x ->> 'bonusCredits' = '50' and x ->> 'includedCredits' = '200') then
    raise exception 'S8 product credits'; end if;
  execute 'reset role';
  perform pg_temp.t_service();
  perform public.record_provider_balance_result(true, 1000, null, 'admin');
  execute 'reset role';
  perform pg_temp.t_as(fin);
  r := public.admin_provider_summary();
  execute 'reset role';
  if (r -> 'balance' ->> 'approxUsd')::numeric <> 5 or (r -> 'balance' -> 'reference' ->> 'kind') <> 'kie_purchase' then raise exception 'S8 balance %', r -> 'balance'; end if;
  perform pg_temp.t_as(cust);
  begin perform public.admin_settings(); raise exception 'S8 customer settings';
  exception when others then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  if public.get_catalog()::text ~ '(usdPerCredit|supplier|creditReference|kie_purchase)' then raise exception 'S8 public catalog leaks pricing internals'; end if;
  execute 'reset role';
  v_ok := v_ok + 1;

  raise exception 'PASS: % simplified-pricing test groups', v_ok;
end;
$$;
