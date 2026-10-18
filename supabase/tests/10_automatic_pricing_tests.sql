-- Automatic KIE-based pricing (run after the automatic pricing migration). One DO block rolled back by the final
-- exception; nothing is sent to any supplier. The dollar amounts in P1 are the synthetic examples of the pricing brief.
--  P1 the formula: credits = B × (1 + M) ÷ V rounded up once per request; charged value = credits × V; effective
--     markup = (charged − C) ÷ C (KIE $0.10 serving, cheaper $0.08 and $0.05, markup 150 %, credit value $0.02, rounding)
--  P2 every configuration of every model follows the policy (KIE price list × KIE credit price), rounded per request
--  P3 a cheaper supplier serving a model raises the effective markup; the customer price and its version stay the same
--  P4 Save & apply: who may read, preview and apply; the preview saves nothing; one new policy version; a stale editor
--     is refused; an unchanged repeat writes nothing; quotes taken before must be refreshed; accepted jobs, wallets,
--     packages and orders are untouched; the credit value keeps one home; the history is append-only; audit
--  P5 KIE price data feeds prices (a new KIE price list, a new documented KIE credit price); a KIE purchase does not
--  P6 a missing KIE reference is never replaced by another supplier's price: unpriced, "KIE reference needed"
--  P7 extra reference images billed by KIE are priced per whole request (one rounding)
--  P8 per-model and bulk retail editing are retired and write nothing; the public catalog shows no pricing internals
do $$
declare
  own uuid := pg_temp.t_user('t-ap-own-' || gen_random_uuid() || '@genlixs.test');
  fin uuid := pg_temp.t_user('t-ap-fin-' || gen_random_uuid() || '@genlixs.test');
  ops uuid := pg_temp.t_user('t-ap-ops-' || gen_random_uuid() || '@genlixs.test');
  sup uuid := pg_temp.t_user('t-ap-sup-' || gen_random_uuid() || '@genlixs.test');
  cust uuid := pg_temp.t_user('t-ap-cus-' || gen_random_uuid() || '@genlixs.test');
  nz uuid := (select id from app_private.provider_accounts where provider = 'nezhagate');
  r jsonb; p jsonb; q jsonb; q2 jsonb; m jsonb; m2 jsonb; snap jsonb; snap2 jsonb; v_rules jsonb;
  v_pol uuid; v_pv uuid; v_job uuid; v_n int; v_num numeric; v_txt text;
  v_ok int := 0;
begin
  insert into app_private.staff_memberships (user_id, role) values (own, 'owner'), (fin, 'finance'), (ops, 'operations'), (sup, 'support');
  update app_private.settings set value = '100' where key = 'max_quotes_per_minute';

  -- P1 ------------------------------------------------------------------ the formula
  -- KIE serves: B $0.10, M 100 %, V $0.01, C $0.10 → $0.20 = 20 credits, effective markup 100 %
  if app_private.policy_units(0.10, 10000, 0.01) <> 20 or app_private.effective_markup_pct(20 * 0.01, 0.10) <> 100 then raise exception 'P1 KIE serves'; end if;
  -- a cheaper supplier serves the same request: still 20 credits ($0.20); the effective markup rises
  if app_private.effective_markup_pct(20 * 0.01, 0.08) <> 150 then raise exception 'P1 C $0.08'; end if;
  if app_private.effective_markup_pct(20 * 0.01, 0.05) <> 300 then raise exception 'P1 C $0.05'; end if;
  -- the global markup becomes 150 %: $0.25 = 25 credits, 212.5 % on $0.08
  if app_private.policy_units(0.10, 15000, 0.01) <> 25 or app_private.effective_markup_pct(25 * 0.01, 0.08) <> 212.5 then raise exception 'P1 markup 150'; end if;
  -- the credit value becomes $0.02 instead: $0.20 = 10 credits, 150 % on $0.08
  if app_private.policy_units(0.10, 10000, 0.02) <> 10 or app_private.effective_markup_pct(10 * 0.02, 0.08) <> 150 then raise exception 'P1 credit value'; end if;
  -- one rounding per request: B $0.025, +100 %, V $0.02 → target $0.05 = 2.5 → 3 credits worth $0.06 (+140 % effective)
  if app_private.policy_units(0.025, 10000, 0.02) <> 3 or app_private.effective_markup_pct(3 * 0.02, 0.025) <> 140 then raise exception 'P1 rounding'; end if;
  -- exact decimals: $0.035 × 2 = $0.07 at $0.01 is 7 credits (not 8); never below one credit
  if app_private.policy_units(0.035, 10000, 0.01) <> 7 or app_private.policy_units(0.00001, 0, 0.02) <> 1 then raise exception 'P1 exact'; end if;
  -- the markup is on cost: +100 % sells for twice the KIE reference (not a 100 % margin on revenue)
  if app_private.policy_units(0.10, 10000, 0.01) * 0.01 <> 2 * 0.10 then raise exception 'P1 markup semantics'; end if;
  -- unknown stays unknown
  if app_private.policy_units(null, 10000, 0.01) is not null or app_private.policy_units(0.10, 10000, 0) is not null
     or app_private.effective_markup_pct(0.20, null) is not null then raise exception 'P1 unknown'; end if;
  v_ok := v_ok + 1;

  -- P2 --------------------------------------------- every configuration follows the policy
  -- A known KIE price list for the model used below (finance records it; recording it re-prices the model at once).
  perform pg_temp.t_as(fin);
  perform public.admin_save_supplier_cost('gpt-flare-image', '{"1K": 6, "2K": 10, "4K": 16}', 'documented', 'https://kie.ai/pricing', now(), 'Test price list');
  execute 'reset role';
  perform pg_temp.t_apply_policy(own, 100, 0.02);
  v_pol := (app_private.current_pricing_policy()).id;
  v_num := (app_private.cost_unit('kie_credit')).units_per_usd;
  -- 6 KIE credits = $0.03 → $0.06 = 3 credits; 10 → $0.10 = 5; 16 → $0.16 = 8 (at $0.005 per KIE credit)
  v_rules := (select rules from app_private.price_versions where model_id = 'gpt-flare-image' and state = 'published');
  if v_num = 200 and v_rules -> 'units' <> '{"1K": 3, "2K": 5, "4K": 8}'::jsonb then raise exception 'P2 flare %', v_rules; end if;
  select count(*) into v_n
  from app_private.model_catalog mc
  cross join lateral (select * from app_private.capability_for(mc.id)) c
  cross join lateral (select * from app_private.latest_cost_version(mc.id)) sc
  join app_private.price_versions pv on pv.model_id = mc.id and pv.state = 'published'
  cross join lateral app_private.price_configs(c.spec, app_private.price_dims(sc.schedule)) cfg
  where app_private.price_units_for(pv.rules, cfg, coalesce((c.spec -> 'references' ->> 'min')::int, 0))
        is distinct from app_private.policy_units(round(app_private.supplier_credits(sc.schedule, cfg, coalesce((c.spec -> 'references' ->> 'min')::int, 0),
          coalesce((c.spec -> 'output' ->> 'count')::int, 1)) / v_num, 8), 10000, 0.02);
  if v_n <> 0 then raise exception 'P2 % configuration(s) differ from the policy', v_n; end if;
  if exists (select 1 from app_private.model_catalog mc where not exists (
      select 1 from app_private.price_versions pv where pv.model_id = mc.id and pv.state = 'published' and pv.capability_version_id = (app_private.capability_for(mc.id)).id)) then
    raise exception 'P2 a model with a complete KIE price list has no price'; end if;
  v_ok := v_ok + 1;

  -- P3 ------------------------------ a cheaper supplier serving raises the effective markup only
  perform pg_temp.t_as(ops);
  perform public.admin_set_model_availability('gpt-flare-image', 'enabled');
  r := public.admin_catalog_supply();
  execute 'reset role';
  m := (select x from jsonb_array_elements(r -> 'models') x where x ->> 'id' = 'gpt-flare-image');
  v_pv := (select id from app_private.price_versions where model_id = 'gpt-flare-image' and state = 'published');
  if m -> 'route' ->> 'provider' <> 'kie' or not (m -> 'pricing' ->> 'followsPolicy')::boolean
     or (m -> 'pricing' ->> 'chargedUsd')::numeric <> (m ->> 'defaultUnits')::numeric * 0.02
     or (m -> 'pricing' ->> 'targetUsd')::numeric <> 2 * (m -> 'pricing' ->> 'kieUsd')::numeric
     or (m -> 'route' ->> 'effectiveMarkupPct')::numeric
        <> app_private.effective_markup_pct((m -> 'pricing' ->> 'chargedUsd')::numeric, (m -> 'route' ->> 'usd')::numeric) then
    raise exception 'P3 KIE serving %', m; end if;
  perform pg_temp.t_as(cust);
  q := public.create_generation_quote('gpt-flare-image', 'A ceramic lamp, editorial photo', '{"resolution": "1K"}', '{}');
  execute 'reset role';
  -- NezhaGate (documented $0.005 for this request) becomes verified, keyed and routable for this model
  update app_private.provider_accounts set enabled = true, credential_version = 1, connection_state = 'ok' where id = nz;
  update app_private.provider_offers set status = 'eligible', routing_enabled = true where provider_account_id = nz and model_id = 'gpt-flare-image';
  perform pg_temp.t_as(ops);
  r := public.admin_catalog_supply();
  execute 'reset role';
  m2 := (select x from jsonb_array_elements(r -> 'models') x where x ->> 'id' = 'gpt-flare-image');
  if m2 -> 'route' ->> 'provider' <> 'nezhagate' or (m2 -> 'route' ->> 'usd')::numeric >= (m -> 'route' ->> 'usd')::numeric then
    raise exception 'P3 cheaper supplier not serving %', m2 -> 'route'; end if;
  -- same customer price, same KIE reference, same price version; Genlixs keeps the saving
  if m2 -> 'defaultUnits' <> m -> 'defaultUnits' or m2 -> 'pricing' -> 'kieUsd' <> m -> 'pricing' -> 'kieUsd'
     or m2 -> 'pricing' -> 'chargedUsd' <> m -> 'pricing' -> 'chargedUsd'
     or (select id from app_private.price_versions where model_id = 'gpt-flare-image' and state = 'published') <> v_pv
     or (m2 -> 'route' ->> 'effectiveMarkupPct')::numeric <= (m -> 'route' ->> 'effectiveMarkupPct')::numeric
     or (m2 -> 'route' ->> 'effectiveMarkupPct')::numeric
        <> app_private.effective_markup_pct((m2 -> 'pricing' ->> 'chargedUsd')::numeric, (m2 -> 'route' ->> 'usd')::numeric) then
    raise exception 'P3 the price moved with the supplier %', m2; end if;
  perform pg_temp.t_as(cust);
  q2 := public.create_generation_quote('gpt-flare-image', 'The same lamp', '{"resolution": "1K"}', '{}');
  execute 'reset role';
  if q2 ->> 'creditUnits' <> q ->> 'creditUnits' then raise exception 'P3 the quote changed with the supplier % %', q, q2; end if;
  update app_private.provider_offers set routing_enabled = false where provider_account_id = nz and model_id = 'gpt-flare-image';
  v_ok := v_ok + 1;

  -- P4 -------------------------------------------------------------------- Save & apply
  perform pg_temp.t_as(sup);
  begin perform public.admin_pricing_policy(); raise exception 'P4 support read the policy';
  exception when others then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  execute 'reset role';
  perform pg_temp.t_as(ops);
  r := public.admin_pricing_policy();
  if (r -> 'policy' ->> 'markupPercent')::numeric <> 100 or (r -> 'policy' ->> 'usdPerCredit')::numeric <> 0.02 or (r ->> 'canApply')::boolean then
    raise exception 'P4 operations read %', r; end if;
  begin perform public.admin_preview_pricing_policy(150, 0.02); raise exception 'P4 operations previewed';
  exception when others then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  execute 'reset role';
  select count(*) into v_n from app_private.price_versions;
  perform pg_temp.t_as(fin);
  p := public.admin_preview_pricing_policy(150, 0.02);
  begin perform public.admin_preview_pricing_policy(12.345, 0.02); raise exception 'P4 3-decimal markup';
  exception when others then if sqlerrm <> 'INVALID_MARKUP' then raise; end if; end;
  begin perform public.admin_preview_pricing_policy(100, 0); raise exception 'P4 zero credit value';
  exception when others then if sqlerrm <> 'INVALID_CREDIT_VALUE' then raise; end if; end;
  begin perform public.admin_preview_pricing_policy(100, 0.0000001); raise exception 'P4 7-decimal credit value';
  exception when others then if sqlerrm <> 'INVALID_CREDIT_VALUE' then raise; end if; end;
  begin perform public.admin_apply_pricing_policy(150, 0.02, (p -> 'current' ->> 'policyId')::uuid); raise exception 'P4 finance applied';
  exception when others then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  execute 'reset role';
  if (select count(*) from app_private.price_versions) <> v_n or (app_private.current_pricing_policy()).id <> v_pol then raise exception 'P4 the preview saved'; end if;
  if (p ->> 'affectedModels')::int < 1 or jsonb_array_length(p -> 'examples') not between 1 and 4
     or (p ->> 'affectedModels')::int + (p ->> 'unchangedModels')::int + jsonb_array_length(p -> 'needsKieReference') <> (select count(*) from app_private.model_catalog)
     or not exists (select 1 from jsonb_array_elements(p -> 'examples') x where (x ->> 'after')::int > (x ->> 'before')::int) then
    raise exception 'P4 preview %', p; end if;
  -- a job accepted and a quote taken before the change
  perform app_private.grant_lot(cust, 'promo', 'test:p4:' || cust, 100, null, null, 'test grant');
  perform pg_temp.t_as(cust);
  q := public.create_generation_quote('gpt-flare-image', 'A ceramic lamp, editorial photo', '{"resolution": "2K"}', '{}');
  r := public.create_generation((q ->> 'quoteId')::uuid, 'p4-job-0001');
  v_job := (r -> 'job' ->> 'id')::uuid;
  q2 := public.create_generation_quote('gpt-flare-image', 'A quote kept open across the change', '{"resolution": "2K"}', '{}');
  execute 'reset role';
  snap := jsonb_build_object(
    'lots', (select jsonb_agg(to_jsonb(l) order by l.id) from public.credit_lots l where l.user_id = cust),
    'ledger', (select count(*) from public.credit_ledger where user_id = cust),
    'reservation', (select to_jsonb(x) from public.credit_reservations x where x.job_id = v_job),
    'job', (select units || '/' || price_version_id from public.generation_jobs where id = v_job),
    'packages', (select jsonb_agg(jsonb_build_array(id, state, amount_minor, credits, bonus_credits) order by id) from app_private.product_versions),
    'orders', (select count(*) from public.payment_orders));
  perform pg_temp.t_as(own);
  begin perform public.admin_apply_pricing_policy(150, 0.02, gen_random_uuid()); raise exception 'P4 stale editor saved';
  exception when others then if sqlerrm <> 'POLICY_CHANGED' then raise; end if; end;
  execute 'reset role';
  r := pg_temp.t_apply_policy(own, 150, 0.02);
  if not (r ->> 'newVersion')::boolean or (r -> 'policy' ->> 'markupPercent')::numeric <> 150 or (r -> 'policy' ->> 'usdPerCredit')::numeric <> 0.02 then
    raise exception 'P4 apply %', r; end if;
  -- 2K: 10 KIE credits = $0.05 × 2.5 = $0.125 → 6.25 → 7 credits, in a version of the new policy
  select * into v_rules from (select jsonb_build_object('units', rules -> 'units', 'source', source, 'policy', policy_version_id) j
    from app_private.price_versions where model_id = 'gpt-flare-image' and state = 'published') x;
  if v_num = 200 and (v_rules -> 'units' ->> '2K')::int <> 7 then raise exception 'P4 flare 2K %', v_rules; end if;
  if v_rules ->> 'source' <> 'policy' or v_rules ->> 'policy' <> r -> 'policy' ->> 'policyId' then raise exception 'P4 version %', v_rules; end if;
  if (app_private.current_reference('credit_value')).usd_per_credit <> 0.02 then raise exception 'P4 credit value changed'; end if;
  if not exists (select 1 from app_private.admin_audit_logs where action = 'pricing.policy' and actor_id = own and target_id = r -> 'policy' ->> 'policyId'
                 and reason like 'Global pricing policy v%: +150 % on the KIE reference at $0.02 per Genlixs credit; % model(s) repriced%') then
    raise exception 'P4 audit'; end if;
  -- the quote taken before must be refreshed; the job accepted before keeps its price and reservation
  perform pg_temp.t_as(cust);
  begin perform public.create_generation((q2 ->> 'quoteId')::uuid, 'p4-job-0002'); raise exception 'P4 stale quote accepted';
  exception when others then if sqlerrm <> 'QUOTE_STALE' then raise; end if; end;
  q2 := public.create_generation_quote('gpt-flare-image', 'A new quote', '{"resolution": "2K"}', '{}');
  execute 'reset role';
  if v_num = 200 and ((q ->> 'creditUnits')::int <> 5 or (q2 ->> 'creditUnits')::int <> 7) then raise exception 'P4 quotes % %', q, q2; end if;
  snap2 := jsonb_build_object(
    'lots', (select jsonb_agg(to_jsonb(l) order by l.id) from public.credit_lots l where l.user_id = cust),
    'ledger', (select count(*) from public.credit_ledger where user_id = cust),
    'reservation', (select to_jsonb(x) from public.credit_reservations x where x.job_id = v_job),
    'job', (select units || '/' || price_version_id from public.generation_jobs where id = v_job),
    'packages', (select jsonb_agg(jsonb_build_array(id, state, amount_minor, credits, bonus_credits) order by id) from app_private.product_versions),
    'orders', (select count(*) from public.payment_orders));
  if snap2 <> snap then raise exception 'P4 the policy touched a wallet, job, package or order'; end if;
  -- the same values again: nothing written
  select count(*) into v_n from app_private.price_versions;
  r := pg_temp.t_apply_policy(own, 150, 0.02);
  if not (r ->> 'unchanged')::boolean or (r ->> 'newVersion')::boolean or (select count(*) from app_private.price_versions) <> v_n then raise exception 'P4 repeat %', r; end if;
  -- the credit value has one home: changing it on the policy versions the credit-value reference
  r := pg_temp.t_apply_policy(own, 100, 0.01);
  if (app_private.current_reference('credit_value')).usd_per_credit <> 0.01 or (r -> 'policy' ->> 'usdPerCredit')::numeric <> 0.01
     or (v_num = 200 and (select rules -> 'units' ->> '1K' from app_private.price_versions where model_id = 'gpt-flare-image' and state = 'published')::int <> 6) then
    raise exception 'P4 credit value change %', r; end if;
  begin update app_private.pricing_policy_versions set markup_bps = 1 where id = v_pol; raise exception 'P4 policy history mutable';
  exception when others then if sqlerrm not like 'append-only journal%' then raise; end if; end;
  perform pg_temp.t_apply_policy(own, 100, 0.02);
  v_ok := v_ok + 1;

  -- P5 ------------------------------------------------------ KIE price data feeds the prices
  perform pg_temp.t_as(fin);
  r := public.admin_save_supplier_cost('gpt-flare-image', '{"1K": 8, "2K": 10, "4K": 16}', 'documented', 'https://kie.ai/pricing', now(), 'KIE raised 1K');
  execute 'reset role';
  -- 8 KIE credits = $0.04 → $0.08 = 4 credits, published at once under the current policy
  select jsonb_build_object('units', rules -> 'units', 'policy', policy_version_id, 'evidence', cost_evidence) into v_rules
  from app_private.price_versions where model_id = 'gpt-flare-image' and state = 'published';
  if (v_num = 200 and v_rules -> 'units' <> '{"1K": 4, "2K": 5, "4K": 8}'::jsonb) or (v_rules ->> 'policy')::uuid <> (app_private.current_pricing_policy()).id
     or v_rules ->> 'evidence' not like 'Global pricing policy v%(KIE cost v' || (r ->> 'version') || ',%' then raise exception 'P5 new KIE price list %', v_rules; end if;
  -- a new documented KIE credit price: a new policy version (same markup and credit value) re-prices the catalog
  select count(*) into v_n from app_private.pricing_policy_versions;
  perform pg_temp.t_as(own);
  perform public.admin_save_cost_unit('kie_credit', '400', 'documented', 'https://kie.ai/pricing', 'Test: documented KIE price change');
  execute 'reset role';
  if (select count(*) from app_private.pricing_policy_versions) <> v_n + 1 or (app_private.current_pricing_policy()).markup_bps <> 10000
     or (select rules -> 'units' ->> '1K' from app_private.price_versions where model_id = 'gpt-flare-image' and state = 'published')::int <> 2 then
    raise exception 'P5 KIE credit price'; end if;
  -- what Genlixs paid for KIE credits (cost analysis only) never moves selling prices
  select count(*) into v_n from app_private.price_versions;
  perform pg_temp.t_save_ref(fin, 'kie_purchase', 9, 2000);
  if (select count(*) from app_private.price_versions) <> v_n then raise exception 'P5 a KIE purchase re-priced models'; end if;
  perform pg_temp.t_as(own);
  perform public.admin_save_cost_unit('kie_credit', v_num::text, 'documented', 'https://kie.ai/pricing', 'Test: back to the documented price');
  execute 'reset role';
  v_ok := v_ok + 1;

  -- P6 ---------------------------------------------------------------- KIE reference needed
  -- A KIE price list without rates (as a maintenance migration could record) unpublishes the price; nothing else fills in.
  insert into app_private.supplier_cost_versions (model_id, version, schedule, usd_per_credit, source_kind, source_url, source_checked_at, note)
  select model_id, version + 1, jsonb_set(schedule, '{rates}', '{}'::jsonb), usd_per_credit, 'manual', null, now(), 'TEST: no KIE rate'
  from app_private.supplier_cost_versions where model_id = 'wan-2-6' order by version desc limit 1;
  if exists (select 1 from app_private.price_versions where model_id = 'wan-2-6' and state = 'published') then raise exception 'P6 still priced'; end if;
  r := app_private.model_readiness('wan-2-6');
  if (select x ->> 'detail' from jsonb_array_elements(r -> 'checks') x where x ->> 'key' = 'supplier_cost') not like 'KIE reference needed%' then
    raise exception 'P6 readiness %', r; end if;
  perform pg_temp.t_as(ops);
  begin perform public.admin_set_model_availability('wan-2-6', 'enabled'); raise exception 'P6 switched on without a KIE reference';
  exception when others then if sqlerrm <> 'COST_UNKNOWN' then raise; end if; end;
  r := public.admin_catalog_supply();
  execute 'reset role';
  m := (select x from jsonb_array_elements(r -> 'models') x where x ->> 'id' = 'wan-2-6');
  if m -> 'pricing' ->> 'status' <> 'kie_reference_needed' or m -> 'defaultUnits' <> 'null'::jsonb or (m -> 'pricing' ->> 'followsPolicy')::boolean then
    raise exception 'P6 supply %', m -> 'pricing'; end if;
  -- a partial KIE price list prices only the settings it covers
  insert into app_private.supplier_cost_versions (model_id, version, schedule, usd_per_credit, source_kind, source_url, source_checked_at, note)
  select model_id, version + 1,
    jsonb_set(schedule, '{rates}', (select jsonb_object_agg(e.key, e.value) from (select * from jsonb_each(schedule -> 'rates') order by key limit 1) e)),
    usd_per_credit, 'manual', null, now(), 'TEST: one KIE rate'
  from app_private.supplier_cost_versions where model_id = 'flux-2-pro-image' order by version desc limit 1;
  if (select count(*) from jsonb_object_keys((select rules -> 'units' from app_private.price_versions where model_id = 'flux-2-pro-image' and state = 'published'))) <> 1 then
    raise exception 'P6 partial list'; end if;
  if (select x ->> 'detail' from jsonb_array_elements(app_private.model_readiness('flux-2-pro-image') -> 'checks') x where x ->> 'key' = 'supplier_cost')
     not like 'KIE reference needed for % setting(s).' then raise exception 'P6 partial readiness'; end if;
  v_ok := v_ok + 1;

  -- P7 ------------------------------------------------ extra reference images: one rounding per request
  insert into app_private.supplier_cost_versions (model_id, version, schedule, usd_per_credit, source_kind, source_url, source_checked_at, note)
  select model_id, version + 1, schedule || '{"extraReference": {"free": 1, "credits": 0.5}}', usd_per_credit, 'manual', null, now(), 'TEST: extra images billed'
  from app_private.supplier_cost_versions where model_id = 'gpt-flare-edit' order by version desc limit 1;
  v_rules := (select rules from app_private.price_versions where model_id = 'gpt-flare-edit' and state = 'published');
  if not coalesce(v_rules -> 'dims' ? '_refs', false) then raise exception 'P7 no reference-count dimension %', v_rules -> 'dims'; end if;
  v_num := (select (schedule -> 'rates' ->> '1K')::numeric from app_private.supplier_cost_versions where model_id = 'gpt-flare-edit' order by version desc limit 1);
  -- 1K with 3 images = KIE rate + 2 × 0.5 credits, priced as one request
  if app_private.price_units_for(v_rules, '{"resolution": "1K"}', 3)
     <> app_private.policy_units(round((v_num + 1) / (app_private.cost_unit('kie_credit')).units_per_usd, 8), 10000, 0.02) then
    raise exception 'P7 three images %', v_rules; end if;
  -- 6 KIE credits: 1 image = $0.03 → 3 credits; 3 images = 7 KIE credits = $0.035 → $0.07 → 4 credits (5 if rounded per image)
  if v_num = 6 and (app_private.price_units_for(v_rules, '{"resolution": "1K"}', 1) <> 3 or app_private.price_units_for(v_rules, '{"resolution": "1K"}', 3) <> 4) then
    raise exception 'P7 rounding %', v_rules; end if;
  if app_private.price_units_for(v_rules, '{"resolution": "1K"}', 17) is not null then raise exception 'P7 more images than the model takes'; end if;
  v_ok := v_ok + 1;

  -- P8 -------------------------------------------------------- retail editing is retired
  select count(*) into v_n from app_private.price_versions;
  perform pg_temp.t_as(own);
  foreach v_txt in array array[
      'admin_save_model_price(''gpt-flare-image'', ''{"1K": 1, "2K": 1, "4K": 1}''::jsonb, null, true, true, null)',
      'admin_save_price_draft(''gpt-flare-image'', ''{"1K": 1, "2K": 1, "4K": 1}''::jsonb)',
      'admin_create_price_version(''gpt-flare-image'', ''{"base": 1}''::jsonb, null, ''x'')',
      format('admin_publish_price_version(%L::uuid, null)', v_pv),
      format('admin_restore_price_version(%L::uuid)', v_pv),
      'admin_pricing_preview(''all'', null, 100, false)',
      'admin_pricing_apply(''all'', null, 100, false, ''x'', ''publish'', array[''gpt-flare-image''])',
      'admin_pricing_save(''all'', null, 100, false, ''x'', array[''gpt-flare-image''])',
      'admin_reference_impact(''credit_value'', 5, 250)'] loop
    begin
      execute 'select public.' || v_txt;
      raise exception 'P8 still works: %', v_txt;
    exception when others then
      if sqlerrm <> 'PRICING_AUTOMATIC' then raise exception 'P8 % → %', v_txt, sqlerrm; end if;
    end;
  end loop;
  execute 'reset role';
  if (select count(*) from app_private.price_versions) <> v_n then raise exception 'P8 a retired editor wrote a version'; end if;
  perform pg_temp.t_as(cust);
  begin perform public.admin_save_model_price('gpt-flare-image', '{}', null, true, true, null); raise exception 'P8 customer reached the editor';
  exception when others then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  if public.get_catalog()::text ~ '(markupBps|kieUsd|usdPerCredit|policyId|effectiveMarkup)' then raise exception 'P8 public catalog leaks pricing internals'; end if;
  execute 'reset role';
  v_ok := v_ok + 1;

  raise exception 'PASS: % automatic pricing test groups', v_ok;
end;
$$;
