-- Billing, affiliate finance, payouts and admin capability boundaries (guide §26.3, §26.4). Rolled back.
do $$
declare
  owner uuid := pg_temp.t_user('t-owner-' || gen_random_uuid() || '@genlixs.test');
  fin uuid := pg_temp.t_user('t-fin-' || gen_random_uuid() || '@genlixs.test');
  sup uuid := pg_temp.t_user('t-sup-' || gen_random_uuid() || '@genlixs.test');
  aff_user uuid := pg_temp.t_user('t-aff-' || gen_random_uuid() || '@genlixs.test');
  buyer uuid := pg_temp.t_user('t-buy-' || gen_random_uuid() || '@genlixs.test');
  cust uuid; custs uuid[] := '{}';
  aff uuid; v_slug text; v_click uuid; v_agreement uuid := (select id from public.affiliate_agreement_versions where version = 1);
  o jsonb; r jsonb; w jsonb; v_order uuid; v_comm record; v_n int; v_ok int := 0; v_batch uuid;
  i int;
begin
  insert into app_private.staff_memberships (user_id, role) values (owner, 'owner'), (fin, 'finance'), (sup, 'support');
  insert into app_private.product_versions (product_key, version, kind, name, currency, amount_minor, credits, state, effective_at)
  values ('test-pack', 1, 'credit_pack', 'Test pack', 'USD', 2000, 300, 'published', now());

  -- B1 checkout order snapshot is server-priced and idempotent
  perform pg_temp.t_as(buyer);
  o := public.create_checkout_order('test-pack', 'order-key-0001');
  if o ->> 'amountMinor' <> '2000' or o ->> 'credits' <> '300' then raise exception 'B1 %', o; end if;
  if (public.create_checkout_order('test-pack', 'order-key-0001') ->> 'orderId') <> o ->> 'orderId' then raise exception 'B1 replay'; end if;
  execute 'reset role';
  v_order := (o ->> 'orderId')::uuid;
  -- a success URL alone grants nothing
  if exists (select 1 from public.credit_lots where user_id = buyer) then raise exception 'B1 premature grant'; end if;
  v_ok := v_ok + 1;

  -- B2 verified settled payment grants once; a second event naming the same payment grants nothing
  r := public.record_billing_receipt('test', 'evt_1', 'payment.settled',
    jsonb_build_object('orderId', v_order, 'paymentId', 'pay_1', 'amountMinor', 2000, 'currency', 'USD', 'taxMinor', 0));
  w := pg_temp.t_claim((r ->> 'receiptId')::uuid, 'billing_apply');
  r := public.worker_apply_billing((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid);
  if r ->> 'action' <> 'applied' then raise exception 'B2 %', r; end if;
  if (select available_units from public.wallet_accounts where user_id = buyer) <> 300 then raise exception 'B2 grant'; end if;
  if (public.record_billing_receipt('test', 'evt_1', 'payment.settled', '{}'::jsonb) ->> 'duplicate')::boolean is not true then raise exception 'B2 dup'; end if;
  r := public.record_billing_receipt('test', 'evt_2', 'payment.settled',
    jsonb_build_object('orderId', v_order, 'paymentId', 'pay_1', 'amountMinor', 2000, 'currency', 'USD'));
  w := pg_temp.t_claim((r ->> 'receiptId')::uuid, 'billing_apply');
  perform public.worker_apply_billing((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid);
  if (select available_units from public.wallet_accounts where user_id = buyer) <> 300 then raise exception 'B2 double grant'; end if;
  -- amount mismatch is refused
  r := public.record_billing_receipt('test', 'evt_3', 'payment.settled',
    jsonb_build_object('orderId', v_order, 'paymentId', 'pay_x', 'amountMinor', 1, 'currency', 'USD'));
  w := pg_temp.t_claim((r ->> 'receiptId')::uuid, 'billing_apply');
  if (public.worker_apply_billing((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid) ->> 'action') <> 'failed' then raise exception 'B2 mismatch'; end if;
  v_ok := v_ok + 1;

  -- B3 admin capability boundaries
  perform pg_temp.t_as(buyer);
  begin perform public.admin_overview(); raise exception 'B3 customer reached admin';
  exception when others then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  execute 'reset role';
  perform pg_temp.t_as(sup);
  begin perform public.admin_adjust_credits(buyer, 10, 'goodwill', 'x', 'adj-1'); raise exception 'B3 support adjusted credits';
  exception when others then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  begin perform public.admin_prepare_refund(v_order, 100, 'x', 'ref-0'); raise exception 'B3 support refunded';
  exception when others then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  perform public.admin_list_tickets(null);
  -- support works the queue but never sees the KIE balance
  if (public.admin_overview() -> 'service' -> 'providerBalance') <> 'null'::jsonb then raise exception 'B3 support sees provider balance'; end if;
  execute 'reset role';
  -- profile metadata cannot grant staff capability
  update auth.users set raw_user_meta_data = '{"role": "owner", "is_admin": true}' where id = buyer;
  if app_private.has_capability(buyer, 'admin.access') then raise exception 'B3 metadata elevation'; end if;
  v_ok := v_ok + 1;

  -- B4 finance credit adjustment: positive lot, negative never below available, audited
  perform pg_temp.t_as(fin);
  r := public.admin_adjust_credits(buyer, -50, 'correction', 'test correction', 'adj-0001');
  if r ->> 'availableUnits' <> '250' then raise exception 'B4 %', r; end if;
  begin perform public.admin_adjust_credits(buyer, -1000, 'correction', 'too much', 'adj-0002'); raise exception 'B4 negative balance';
  exception when others then if sqlerrm <> 'INSUFFICIENT_AVAILABLE' then raise; end if; end;
  execute 'reset role';
  if not exists (select 1 from app_private.admin_audit_logs where action = 'credits.adjust' and target_id = buyer::text) then raise exception 'B4 audit'; end if;
  v_ok := v_ok + 1;

  -- B5 refund: prepare restricts the lot, gateway success revokes unused units once
  perform pg_temp.t_as(fin);
  r := public.admin_prepare_refund(v_order, 2000, 'customer request', 'refund-key-0001');
  execute 'reset role';
  if (select restricted from public.credit_lots where user_id = buyer and source_kind = 'purchase') is not true then raise exception 'B5 not restricted'; end if;
  if app_private.spendable_units(buyer) <> 0 then raise exception 'B5 restricted units spendable'; end if;
  perform public.record_refund_submission((r ->> 'refundRequestId')::uuid, 'submitting', 're_1');
  r := public.record_billing_receipt('test', 'evt_r1', 'refund.succeeded',
    jsonb_build_object('orderId', v_order, 'refundId', 're_1', 'amountMinor', 2000, 'currency', 'USD', 'refundRequestId', r ->> 'refundRequestId'));
  w := pg_temp.t_claim((r ->> 'receiptId')::uuid, 'billing_apply');
  perform public.worker_apply_billing((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid);
  if (select state from public.payment_orders where id = v_order) <> 'refunded' then raise exception 'B5 order state'; end if;
  if (select revoked_units from public.credit_lots where user_id = buyer and source_kind = 'purchase') <> 300 then
    raise exception 'B5 revoked %', (select row_to_json(l) from public.credit_lots l where user_id = buyer and source_kind = 'purchase'); end if;
  v_ok := v_ok + 1;

  -- A1 affiliate application -> approval requires a published agreement
  perform pg_temp.t_as(aff_user);
  perform public.apply_affiliate('{"name": "Test Partner", "country": "MA", "channels": ["https://example.com/@partner"], "termsAccepted": true}');
  execute 'reset role';
  select id into aff from public.affiliate_accounts where user_id = aff_user;
  perform pg_temp.t_as(owner);
  begin perform public.admin_review_affiliate(aff, 'approve', 'looks good'); raise exception 'A1 approved without agreement';
  exception when others then if sqlerrm <> 'NO_PUBLISHED_AGREEMENT' then raise; end if; end;
  perform public.admin_publish_agreement(v_agreement, 'owner confirmed 30/50/10');
  r := public.admin_review_affiliate(aff, 'approve', 'looks good');
  execute 'reset role';
  select slug into v_slug from public.affiliate_links where affiliate_id = aff and is_main;
  if v_slug is null then raise exception 'A1 no main link'; end if;
  v_ok := v_ok + 1;

  -- A2 attribution at signup; self-referral impossible; commission 30% on revenue excl. tax
  execute 'set local role anon';
  v_click := (public.record_referral_click(v_slug, true, 'example.com', null) ->> 'clickId')::uuid;
  execute 'reset role';
  cust := pg_temp.t_user('t-ref-' || gen_random_uuid() || '@genlixs.test', jsonb_build_object('referral_click_id', v_click));
  if not exists (select 1 from app_private.affiliate_attributions where customer_id = cust and affiliate_id = aff) then raise exception 'A2 not bound'; end if;
  -- clicks without consent do not produce an attributable id
  execute 'set local role anon';
  if (public.record_referral_click(v_slug, false, null, null) ->> 'clickId') is not null then raise exception 'A2 consentless click id'; end if;
  execute 'reset role';
  insert into public.payment_orders (user_id, product_version_id, product_key, product_name, kind, amount_minor, currency, credits, idempotency_key)
  values (cust, (select id from app_private.product_versions where product_key = 'test-pack'), 'test-pack', 'Test pack', 'credit_pack', 2000, 'USD', 300, 'k-cust-1')
  returning id into v_order;
  r := public.record_billing_receipt('test', 'evt_c1', 'payment.settled',
    jsonb_build_object('orderId', v_order, 'paymentId', 'pay_c1', 'amountMinor', 2000, 'currency', 'USD', 'taxMinor', 0));
  w := pg_temp.t_claim((r ->> 'receiptId')::uuid, 'billing_apply');
  perform public.worker_apply_billing((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid);
  select * into v_comm from public.commission_entries where order_id = v_order;
  if v_comm.amount_minor <> 600 or v_comm.rate_bps <> 3000 or v_comm.state <> 'pending_hold' then raise exception 'A2 commission %', row_to_json(v_comm); end if;
  v_ok := v_ok + 1;

  -- A3 cumulative partial refunds reverse exactly the original commission
  r := public.record_billing_receipt('test', 'evt_c1r1', 'refund.succeeded',
    jsonb_build_object('orderId', v_order, 'refundId', 're_c1a', 'amountMinor', 700, 'currency', 'USD'));
  w := pg_temp.t_claim((r ->> 'receiptId')::uuid, 'billing_apply');
  perform public.worker_apply_billing((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid);
  r := public.record_billing_receipt('test', 'evt_c1r2', 'refund.succeeded',
    jsonb_build_object('orderId', v_order, 'refundId', 're_c1b', 'amountMinor', 300, 'currency', 'USD'));
  w := pg_temp.t_claim((r ->> 'receiptId')::uuid, 'billing_apply');
  perform public.worker_apply_billing((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid);
  r := public.record_billing_receipt('test', 'evt_c1r3', 'refund.succeeded',
    jsonb_build_object('orderId', v_order, 'refundId', 're_c1c', 'amountMinor', 1000, 'currency', 'USD'));
  w := pg_temp.t_claim((r ->> 'receiptId')::uuid, 'billing_apply');
  perform public.worker_apply_billing((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid);
  select * into v_comm from public.commission_entries where order_id = v_order;
  if v_comm.reversed_minor <> 600 or v_comm.state <> 'reversed'
     or (select sum(amount_minor) from public.commission_adjustments where commission_id = v_comm.id) <> -600 then
    raise exception 'A3 reversal %', row_to_json(v_comm); end if;
  -- fully refunded single payment before promotion un-counts the customer
  if (select qualifying_customers from public.affiliate_accounts where id = aff) <> 0 then raise exception 'A3 qualification not reversed'; end if;
  v_ok := v_ok + 1;

  -- A4 ten DISTINCT paying customers: the 10th payment stays at 30%, the next eligible payment earns 50%;
  --    several payments from one customer count once
  for i in 1..10 loop
    execute 'set local role anon';
    v_click := (public.record_referral_click(v_slug, true, null, null) ->> 'clickId')::uuid;
    execute 'reset role';
    cust := pg_temp.t_user('t-c' || i || '-' || gen_random_uuid() || '@genlixs.test', jsonb_build_object('referral_click_id', v_click));
    custs := custs || cust;
    insert into public.payment_orders (user_id, product_version_id, product_key, product_name, kind, amount_minor, currency, credits, idempotency_key)
    values (cust, (select id from app_private.product_versions where product_key = 'test-pack'), 'test-pack', 'Test pack', 'credit_pack', 2000, 'USD', 300, 'k-' || i)
    returning id into v_order;
    r := public.record_billing_receipt('test', 'evt_t' || i, 'payment.settled',
      jsonb_build_object('orderId', v_order, 'paymentId', 'pay_t' || i, 'amountMinor', 2000, 'currency', 'USD'));
    w := pg_temp.t_claim((r ->> 'receiptId')::uuid, 'billing_apply');
    perform public.worker_apply_billing((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid);
    if i = 1 then
      -- a second purchase by the same customer must not count as a new customer
      insert into public.payment_orders (user_id, product_version_id, product_key, product_name, kind, amount_minor, currency, credits, idempotency_key)
      values (cust, (select id from app_private.product_versions where product_key = 'test-pack'), 'test-pack', 'Test pack', 'credit_pack', 2000, 'USD', 300, 'k-1b')
      returning id into v_order;
      r := public.record_billing_receipt('test', 'evt_t1b', 'payment.settled',
        jsonb_build_object('orderId', v_order, 'paymentId', 'pay_t1b', 'amountMinor', 2000, 'currency', 'USD'));
      w := pg_temp.t_claim((r ->> 'receiptId')::uuid, 'billing_apply');
      perform public.worker_apply_billing((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid);
      if (select qualifying_customers from public.affiliate_accounts where id = aff) <> 1 then raise exception 'A4 repeat purchase counted twice'; end if;
    end if;
  end loop;
  if (select tier from public.affiliate_accounts where id = aff) <> 'uplift' or (select qualifying_customers from public.affiliate_accounts where id = aff) <> 10 then
    raise exception 'A4 tier %', (select row_to_json(x) from public.affiliate_accounts x where id = aff); end if;
  if (select rate_bps from public.commission_entries where source_key = 'payment:test:pay_t10') <> 3000 then raise exception 'A4 threshold payment not at 30%%'; end if;
  insert into public.payment_orders (user_id, product_version_id, product_key, product_name, kind, amount_minor, currency, credits, idempotency_key)
  values (custs[1], (select id from app_private.product_versions where product_key = 'test-pack'), 'test-pack', 'Test pack', 'credit_pack', 2000, 'USD', 300, 'k-after')
  returning id into v_order;
  r := public.record_billing_receipt('test', 'evt_after', 'payment.settled',
    jsonb_build_object('orderId', v_order, 'paymentId', 'pay_after', 'amountMinor', 2000, 'currency', 'USD'));
  w := pg_temp.t_claim((r ->> 'receiptId')::uuid, 'billing_apply');
  perform public.worker_apply_billing((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid);
  if (select amount_minor from public.commission_entries where source_key = 'payment:test:pay_after') <> 1000 then raise exception 'A4 uplift not 50%%'; end if;
  v_ok := v_ok + 1;

  -- P1 payout: hold maturity, verified destination (48 h), threshold, separation of duties, evidence, no double allocation
  update public.commission_entries set hold_until = now() - interval '1 second' where affiliate_id = aff and state = 'pending_hold';
  perform public.watchdog_maintenance();
  perform pg_temp.t_as(aff_user);
  perform public.set_payout_destination('bank_transfer', 'IBAN …4321');
  execute 'reset role';
  perform pg_temp.t_as(fin);
  r := public.admin_prepare_payout_batch('USD');
  if (r ->> 'affiliates')::int <> 0 then raise exception 'P1 unverified destination paid'; end if;
  perform public.admin_verify_payout_destination(aff, 'verified with partner');
  execute 'reset role';
  update app_private.payout_destinations set changed_at = now() - interval '49 hours' where affiliate_id = aff;
  perform pg_temp.t_as(fin);
  r := public.admin_prepare_payout_batch('USD');
  v_batch := (r ->> 'batchId')::uuid;
  if v_batch is null or (r ->> 'totalMinor')::bigint <> 7600 then raise exception 'P1 batch %', r; end if;
  if ((public.admin_prepare_payout_batch('USD')) ->> 'affiliates')::int <> 0 then raise exception 'P1 double allocation'; end if;
  begin perform public.admin_payout_batch_action(v_batch, 'review'); raise exception 'P1 preparer reviewed own batch';
  exception when others then if sqlerrm <> 'SEPARATION_OF_DUTIES' then raise; end if; end;
  execute 'reset role';
  perform pg_temp.t_as(owner);
  perform public.admin_payout_batch_action(v_batch, 'review');
  begin perform public.admin_payout_batch_action(v_batch, 'paid', 'TX-1', null); raise exception 'P1 paid without evidence';
  exception when others then if sqlerrm <> 'EVIDENCE_REQUIRED' then raise; end if; end;
  perform public.admin_payout_batch_action(v_batch, 'submitting', 'TX-1');
  perform public.admin_payout_batch_action(v_batch, 'unknown');
  execute 'reset role';
  if exists (select 1 from public.commission_entries where payout_batch_id = v_batch and state <> 'reserved_for_payout') then raise exception 'P1 unknown released'; end if;
  perform pg_temp.t_as(owner);
  perform public.admin_payout_batch_action(v_batch, 'paid', 'TX-1', 'bank statement line 2026-10-14');
  execute 'reset role';
  if exists (select 1 from public.commission_entries where payout_batch_id = v_batch and state <> 'paid') then raise exception 'P1 not paid'; end if;
  v_ok := v_ok + 1;

  -- P2 refund after payout becomes a visible carry-forward liability, never erasing the paid row
  r := public.record_billing_receipt('test', 'evt_after_r', 'refund.succeeded',
    jsonb_build_object('orderId', v_order, 'refundId', 're_after', 'amountMinor', 2000, 'currency', 'USD'));
  w := pg_temp.t_claim((r ->> 'receiptId')::uuid, 'billing_apply');
  perform public.worker_apply_billing((w ->> 'workItemId')::uuid, (w ->> 'leaseToken')::uuid);
  select * into v_comm from public.commission_entries where source_key = 'payment:test:pay_after';
  if v_comm.state <> 'paid' or v_comm.reversed_minor <> 1000 then raise exception 'P2 %', row_to_json(v_comm); end if;
  perform pg_temp.t_as(aff_user);
  r := public.get_affiliate_overview();
  execute 'reset role';
  if r -> 'balances' -> 'USD' ->> 'carryForward' <> '-1000' then raise exception 'P2 carry-forward %', r -> 'balances'; end if;
  -- affiliates never see customer identities
  perform pg_temp.t_as(aff_user);
  if public.list_affiliate_referrals()::text like '%@genlixs.test%' then raise exception 'P2 referral email leaked'; end if;
  -- an active partner cannot read KIE balance, supplier costs or margins
  begin perform public.admin_provider_summary(); raise exception 'P2 partner read KIE balance';
  exception when others then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  begin perform public.admin_pricing_preview('all', null, 300, false); raise exception 'P2 partner read costs';
  exception when others then if sqlerrm <> 'FORBIDDEN' then raise; end if; end;
  execute 'reset role';
  v_ok := v_ok + 1;

  raise exception 'PASS: % billing/affiliate/admin test groups', v_ok;
end;
$$;
