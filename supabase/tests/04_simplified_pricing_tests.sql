-- Simplified admin controls and explicit credit pricing: reference values (versioned; the credit value re-prices models
-- under the global policy but never touches wallets, orders, running jobs or packages), the owner's arithmetic example,
-- retired per-model and bulk editors, one credit value, availability without a paid-test gate, package editing with
-- bonus credits, and the admin reads.
-- Updated for automatic pricing: prices follow the global policy (KIE reference × markup ÷ credit value).
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
  -- the credit value re-prices every model, so it takes the right to publish prices (the owner)
  begin perform public.admin_save_pricing_reference('credit_value', 5, 250, 0, null, null, v_rc); raise exception 'S1 finance changed the credit value';
  exception when others then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  begin perform public.admin_save_pricing_reference('kie_purchase', 5, 1000, 1000, null, null, v_rk);
    raise exception 'S1 bonus >= credits';
  exception when others then if sqlerrm <> 'INVALID_INPUT' then raise; end if; end;
  begin perform public.admin_save_pricing_reference('kie_purchase', 5, 1000, 0, 'http://kie.ai', null, v_rk);
    raise exception 'S1 insecure link';
  exception when others then if sqlerrm <> 'INVALID_INPUT' then raise; end if; end;
  begin perform public.admin_save_pricing_reference('kie_purchase', 5, 1000, 0, null, null, gen_random_uuid()); raise exception 'S1 stale editor saved';
  exception when others then if sqlerrm <> 'REFERENCE_CHANGED' then raise; end if; end;
  -- Known starting values for this test (whatever the live values are): $5 / 1,000 KIE credits and $5 / 250 Genlixs credits.
  r := public.admin_save_pricing_reference('kie_purchase', 10, 2000, 0, 'https://kie.ai/pricing', 'test', v_rk);
  r := public.admin_save_pricing_reference('kie_purchase', 5, 1000, 0, 'https://kie.ai/pricing', null, (r -> 'reference' ->> 'id')::uuid);
  execute 'reset role';
  perform pg_temp.t_as(owner_u);
  begin perform public.admin_save_pricing_reference('credit_value', 0, 250, 0, null, null, v_rc);
    raise exception 'S1 zero amount';
  exception when others then if sqlerrm <> 'INVALID_INPUT' then raise; end if; end;
  begin perform public.admin_save_pricing_reference('credit_value', 5, 250.5, 0, null, null, v_rc);
    raise exception 'S1 fractional Genlixs credits';
  exception when others then if sqlerrm <> 'INVALID_INPUT' then raise; end if; end;
  begin perform public.admin_save_pricing_reference('credit_value', 5, 3, 0, null, null, v_rc);
    raise exception 'S1 credit value with more than 6 decimals';
  exception when others then if sqlerrm <> 'INVALID_CREDIT_VALUE' then raise; end if; end;
  r := public.admin_save_pricing_reference('credit_value', 5, 250, 0, null, null, v_rc);
  if (r -> 'reference' ->> 'usdPerCredit')::numeric <> 0.02 or (r -> 'reference' ->> 'isExample')::boolean then raise exception 'S1 credit value %', r; end if;
  -- the same values again are not a new version
  r := public.admin_save_pricing_reference('credit_value', 5.00, 250, 0, null, null, (r -> 'reference' ->> 'id')::uuid);
  if not (r ->> 'unchanged')::boolean then raise exception 'S1 identical value created a version'; end if;
  execute 'reset role';
  if (app_private.current_reference('kie_purchase')).usd_per_credit <> 0.005 or app_private.kie_usd_per_credit() <> 0.005
     or (app_private.setting('kie_usd_per_credit') #>> '{}')::numeric <> 0.005 then raise exception 'S1 kie rate'; end if;
  if not exists (select 1 from app_private.admin_audit_logs where action = 'pricing.reference' and actor_id = owner_u
                 and reason like 'Set the Genlixs credit value to $5 for 250 credits ($0.02 per credit). Model prices follow the global pricing policy (% model(s) repriced); quotes already taken, running jobs, wallets and purchases were not changed.')
    then raise exception 'S1 audit description'; end if;
  begin update app_private.pricing_reference_versions set note = 'x' where kind = 'credit_value'; raise exception 'S1 reference mutable';
  exception when others then if sqlerrm not like 'append-only journal%' then raise; end if; end;
  begin delete from app_private.pricing_reference_versions where kind = 'kie_purchase'; raise exception 'S1 reference deletable';
  exception when others then if sqlerrm not like 'append-only journal%' then raise; end if; end;
  v_ok := v_ok + 1;

  -- S2 the owner's example: 6 KIE credits ($0.03) charged 3 Genlixs credits ($0.06) = +100 %; 30 %/50 % commission
  perform pg_temp.t_apply_policy(owner_u, 100, 0.02);
  if (app_private.credit_basis() ->> 'usdPerCredit')::numeric <> 0.02 or app_private.credit_basis() ->> 'source' <> 'reference' then raise exception 'S2 basis'; end if;
  m := app_private.model_price_table('gpt-flare-image', null, app_private.credit_basis(), app_private.pricing_assumptions(), false);
  select x into v_row from jsonb_array_elements(m -> 'configs') x where x ->> 'key' = '1K';
  if (v_row ->> 'supplierCredits')::numeric <> 6 or (v_row ->> 'supplierUsd')::numeric <> 0.03 or (v_row ->> 'currentUnits')::int <> 3 then
    raise exception 'S2 flare 1K %', v_row; end if;
  if (v_row -> 'currentContribution' ->> 'revenueUsd')::numeric <> 0.06 or (v_row -> 'currentContribution' ->> 'direct')::numeric <> 0.03
     or (v_row -> 'currentContribution' ->> 'affiliateBase')::numeric <> 0.012 or (v_row -> 'currentContribution' ->> 'affiliateUplift')::numeric <> 0 then
    raise exception 'S2 contribution %', v_row -> 'currentContribution'; end if;
  -- rounding: 3.24 KIE credits = $0.0162; +100 % = $0.0324; 1.62 credits rounds up to 2 ($0.04)
  m := app_private.model_price_table('seedream-5-flash-image', null, app_private.credit_basis(), app_private.pricing_assumptions(), false);
  select x into v_row from jsonb_array_elements(m -> 'configs') x where x ->> 'key' = '1K';
  if (v_row ->> 'supplierUsd')::numeric <> 0.0162 or (v_row ->> 'currentUnits')::int <> 2 then raise exception 'S2 rounding %', v_row; end if;
  -- the old impact preview of a reference value is retired and saves nothing
  select count(*) into v_n from app_private.pricing_reference_versions;
  perform pg_temp.t_as(fin);
  begin perform public.admin_reference_impact('credit_value', 5, 100); raise exception 'S2 impact still works';
  exception when others then if sqlerrm <> 'PRICING_AUTOMATIC' then raise; end if; end;
  execute 'reset role';
  if (select count(*) from app_private.pricing_reference_versions) <> v_n then raise exception 'S2 impact saved'; end if;
  v_ok := v_ok + 1;

  -- S3 per-model prices are automatic: the editor is refused for every role and writes nothing; the markup summary
  select count(*) into v_n from app_private.price_versions;
  perform pg_temp.t_as(fin);
  begin perform public.admin_save_model_price('gpt-flare-image', '{"1K": 3, "2K": 5, "4K": 8}', null, false, false, null); raise exception 'S3 finance draft';
  exception when others then if sqlerrm <> 'PRICING_AUTOMATIC' then raise; end if; end;
  execute 'reset role';
  perform pg_temp.t_as(owner_u);
  begin perform public.admin_save_model_price('gpt-flare-image', '{"1K": 3, "2K": 5, "4K": 3}', null, true, true, null); raise exception 'S3 owner below-cost price';
  exception when others then if sqlerrm <> 'PRICING_AUTOMATIC' then raise; end if; end;
  r := public.admin_catalog();
  execute 'reset role';
  if (select count(*) from app_private.price_versions) <> v_n then raise exception 'S3 a refused save wrote a version'; end if;
  select x into m from jsonb_array_elements(r -> 'models') x where x ->> 'id' = 'gpt-flare-image';
  -- 1K 3 cr = $0.06 on $0.03 (+100 %); 2K 5 cr = $0.10 on $0.05 (+100 %); 4K 8 cr = $0.16 on $0.08 (+100 %)
  if (m -> 'pricing' ->> 'markupMin')::numeric <> 1 or (m -> 'pricing' ->> 'markupMax')::numeric <> 1 or (m -> 'pricing' ->> 'belowCost')::int <> 0
     or (m -> 'pricing' ->> 'override')::boolean then
    raise exception 'S3 markup summary %', m -> 'pricing'; end if;
  v_ok := v_ok + 1;

  -- S4 a credit value change re-prices future quotes only: no wallet, ledger, order, running job or package changes;
  --    a KIE purchase changes no price
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
    'packages', (select jsonb_agg(jsonb_build_array(id, state, amount_minor, credits) order by id) from app_private.product_versions),
    'orders', (select count(*) from public.payment_orders));
  perform pg_temp.t_save_ref(owner_u, 'credit_value', 5, 100);
  select count(*) into v_n from app_private.price_versions;
  perform pg_temp.t_save_ref(fin, 'kie_purchase', 6, 1000);
  if (select count(*) from app_private.price_versions) <> v_n then raise exception 'S4 a KIE purchase re-priced'; end if;
  snap2 := jsonb_build_object(
    'lots', (select jsonb_agg(to_jsonb(l) order by l.id) from public.credit_lots l where l.user_id = cust),
    'ledger', (select count(*) from public.credit_ledger where user_id = cust),
    'reservation', (select to_jsonb(x) from public.credit_reservations x where x.job_id = v_job),
    'job', (select units || '/' || price_version_id from public.generation_jobs where id = v_job),
    'packages', (select jsonb_agg(jsonb_build_array(id, state, amount_minor, credits) order by id) from app_private.product_versions),
    'orders', (select count(*) from public.payment_orders));
  if snap2 <> snap then raise exception 'S4 reference change touched balances, jobs, orders or packages'; end if;
  -- the open quote is refreshed at the new price: $0.06 at $0.05 per credit = 1.2 → 2 credits
  perform pg_temp.t_as(cust);
  begin perform public.create_generation((q2 ->> 'quoteId')::uuid, 's4-job-0002'); raise exception 'S4 stale quote accepted';
  exception when others then if sqlerrm <> 'QUOTE_STALE' then raise; end if; end;
  q2 := public.create_generation_quote('gpt-flare-image', 'A new quote', '{"resolution": "1K"}', '{}');
  execute 'reset role';
  if (q2 ->> 'creditUnits')::int <> 2 then raise exception 'S4 new quote %', q2; end if;
  -- the cost analysis values the KIE purchase: 6 KIE credits at $0.006 = $0.036 against 2 credits at $0.05 = $0.10
  perform pg_temp.t_as(fin);
  r := public.admin_model_detail('gpt-flare-image');
  execute 'reset role';
  select x into v_row from jsonb_array_elements(r -> 'table' -> 'configs') x where x ->> 'key' = '1K';
  if (v_row ->> 'supplierUsd')::numeric <> 0.036 or (v_row -> 'currentContribution' ->> 'revenueUsd')::numeric <> 0.10 then raise exception 'S4 valuation %', v_row; end if;
  -- back to the example values for the following groups
  perform pg_temp.t_save_ref(owner_u, 'credit_value', 5, 250);
  perform pg_temp.t_save_ref(fin, 'kie_purchase', 5, 1000);
  v_ok := v_ok + 1;

  -- S5 one credit value: the policy panel and the credit-value reference are the same setting
  perform pg_temp.t_apply_policy(owner_u, 100, 0.025);
  if (app_private.current_reference('credit_value')).usd_per_credit <> 0.025 then raise exception 'S5 panel did not set the reference'; end if;
  perform pg_temp.t_as(fin);
  r := public.admin_catalog();
  p := public.admin_pricing_policy();
  execute 'reset role';
  if (r -> 'references' -> 'credit' ->> 'usdPerCredit')::numeric <> 0.025 or (p -> 'policy' ->> 'usdPerCredit')::numeric <> 0.025 then
    raise exception 'S5 two credit values % %', r -> 'references' -> 'credit', p -> 'policy'; end if;
  perform pg_temp.t_save_ref(owner_u, 'credit_value', 5, 250);
  perform pg_temp.t_as(fin);
  p := public.admin_pricing_policy();
  execute 'reset role';
  if (p -> 'policy' ->> 'usdPerCredit')::numeric <> 0.02 or (p -> 'policy' ->> 'markupPercent')::numeric <> 100 then raise exception 'S5 reference did not set the policy %', p; end if;
  v_ok := v_ok + 1;

  -- S6 availability: no paid-test gate, truthful status, off blocks new and earlier quotes, running jobs continue
  -- a model without a price (test fixture) cannot be switched on
  update app_private.price_versions set state = 'retired' where model_id = 'flux-2-pro-image' and state = 'published';
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
