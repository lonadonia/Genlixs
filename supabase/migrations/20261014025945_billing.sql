-- Genlixs 06 · Billing (§17): orders with immutable product snapshots, verified gateway receipts processed
-- through the events queue, single credit grant per settled payment / paid cycle, refunds and disputes.
-- The live gateway is an adapter choice; no browser value (amount, credits, tax, discount) is authoritative.

create table public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  short_ref text not null unique default app_private.short_ref('P'),
  user_id uuid not null references public.profiles (user_id),
  product_version_id uuid not null references app_private.product_versions (id),
  product_key text not null,
  product_name text not null,
  kind text not null check (kind in ('credit_pack', 'subscription')),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  credits bigint not null check (credits > 0),
  idempotency_key text not null,
  gateway text,
  gateway_checkout_id text,
  gateway_payment_id text,
  checkout_url text,
  state text not null default 'pending' check (state in (
    'pending', 'checkout_created', 'paid', 'failed', 'expired', 'refund_pending', 'partially_refunded', 'refunded', 'disputed')),
  refunded_minor bigint not null default 0 check (refunded_minor >= 0),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  unique (gateway, gateway_checkout_id),
  check (refunded_minor <= amount_minor)
);
create index payment_orders_owner_idx on public.payment_orders (user_id, created_at desc);
create trigger payment_orders_touch before update on public.payment_orders for each row execute function app_private.touch_updated_at();

create table app_private.billing_event_receipts (
  id uuid primary key default gen_random_uuid(),
  gateway text not null,
  event_id text not null,
  event_type text not null,
  -- Bounded, sanitized normalized event; never card data or raw secrets.
  normalized jsonb not null,
  state text not null default 'received' check (state in ('received', 'applied', 'ignored', 'failed')),
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (gateway, event_id)
);

create table public.billing_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id),
  order_id uuid references public.payment_orders (id),
  subscription_id uuid,
  gateway text not null,
  gateway_object_id text not null,
  kind text not null check (kind in ('payment', 'refund', 'dispute', 'dispute_closed')),
  amount_minor bigint not null,
  currency text not null,
  state text not null,
  receipt_id uuid,
  created_at timestamptz not null default now(),
  unique (gateway, gateway_object_id, kind)
);
create index billing_transactions_owner_idx on public.billing_transactions (user_id, created_at desc);

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id),
  product_version_id uuid not null references app_private.product_versions (id),
  gateway text not null,
  gateway_subscription_id text not null,
  status text not null check (status in ('incomplete', 'trialing', 'active', 'past_due', 'paused', 'cancel_at_period_end', 'cancelled')),
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gateway, gateway_subscription_id)
);
create trigger subscriptions_touch before update on public.subscriptions for each row execute function app_private.touch_updated_at();

create table app_private.subscription_cycles (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions (id),
  gateway_invoice_id text not null unique,
  period_start timestamptz not null,
  period_end timestamptz not null,
  amount_minor bigint not null,
  currency text not null,
  lot_id uuid references public.credit_lots (id),
  created_at timestamptz not null default now()
);

create table public.refund_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.payment_orders (id),
  user_id uuid not null references public.profiles (user_id),
  amount_minor bigint not null check (amount_minor > 0),
  currency text not null,
  reason text not null,
  revoke_units bigint not null default 0 check (revoke_units >= 0),
  state text not null default 'prepared' check (state in ('prepared', 'submitting', 'submission_unknown', 'succeeded', 'failed')),
  gateway_refund_id text,
  requested_by uuid,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger refund_requests_touch before update on public.refund_requests for each row execute function app_private.touch_updated_at();

create table app_private.payment_disputes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.payment_orders (id),
  gateway text not null,
  gateway_dispute_id text not null,
  amount_minor bigint not null,
  currency text not null,
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (gateway, gateway_dispute_id)
);

alter table public.payment_orders enable row level security;
alter table public.billing_transactions enable row level security;
alter table public.subscriptions enable row level security;
alter table public.refund_requests enable row level security;
create policy orders_owner_read on public.payment_orders for select to authenticated using ((select auth.uid()) = user_id);
create policy billing_tx_owner_read on public.billing_transactions for select to authenticated using ((select auth.uid()) = user_id);
create policy subscriptions_owner_read on public.subscriptions for select to authenticated using ((select auth.uid()) = user_id);
create policy refunds_owner_read on public.refund_requests for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.payment_orders, public.billing_transactions, public.subscriptions, public.refund_requests from anon, authenticated;
grant select on public.payment_orders, public.billing_transactions, public.subscriptions, public.refund_requests to authenticated;

-- ------------------------------------------------------------- checkout

-- Server-priced order with an immutable snapshot of the published product version (§17.2).
create or replace function public.create_checkout_order(p_product_key text, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_active_user();
  pv app_private.product_versions;
  o public.payment_orders;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then
    perform app_private.fail('INVALID_IDEMPOTENCY_KEY', 'Missing or invalid Idempotency-Key.');
  end if;
  select * into o from public.payment_orders where user_id = v_uid and idempotency_key = p_idempotency_key;
  if found then
    if o.product_key <> p_product_key then
      perform app_private.fail('IDEMPOTENCY_CONFLICT', 'This request key was already used for a different purchase.');
    end if;
    return jsonb_build_object('orderId', o.id, 'ref', o.short_ref, 'state', o.state, 'checkoutUrl', o.checkout_url, 'replayed', true);
  end if;
  select * into pv from app_private.product_versions where product_key = p_product_key and state = 'published';
  if not found then
    perform app_private.fail('PRODUCT_UNAVAILABLE', 'This product is not available for purchase.');
  end if;
  if pv.kind = 'subscription' and exists (
    select 1 from public.subscriptions where user_id = v_uid and status in ('active', 'trialing', 'past_due', 'cancel_at_period_end')) then
    perform app_private.fail('SUBSCRIPTION_EXISTS', 'You already have a plan. Manage it from Billing.');
  end if;
  insert into public.payment_orders (user_id, product_version_id, product_key, product_name, kind, amount_minor, currency, credits, idempotency_key)
  values (v_uid, pv.id, pv.product_key, pv.name, pv.kind, pv.amount_minor, pv.currency, pv.credits, p_idempotency_key)
  returning * into o;
  return jsonb_build_object('orderId', o.id, 'ref', o.short_ref, 'state', o.state, 'amountMinor', o.amount_minor::text,
    'currency', o.currency, 'credits', o.credits::text, 'kind', o.kind, 'gatewayMapping', pv.gateway_mapping, 'replayed', false);
end;
$$;
revoke execute on function public.create_checkout_order(text, text) from public, anon;
grant execute on function public.create_checkout_order(text, text) to authenticated;

-- Server-only: persist the gateway checkout binding (§17.2 step 5).
create or replace function public.bind_checkout(p_order_id uuid, p_gateway text, p_checkout_id text, p_checkout_url text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  o public.payment_orders;
begin
  update public.payment_orders set gateway = p_gateway, gateway_checkout_id = p_checkout_id, checkout_url = p_checkout_url,
    state = case when state = 'pending' then 'checkout_created' else state end
  where id = p_order_id and (gateway_checkout_id is null or gateway_checkout_id = p_checkout_id)
  returning * into o;
  if not found then
    perform app_private.fail('CHECKOUT_CONFLICT', 'This order already has a different checkout.');
  end if;
  return jsonb_build_object('orderId', o.id, 'state', o.state, 'checkoutUrl', o.checkout_url);
end;
$$;
revoke execute on function public.bind_checkout(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.bind_checkout(uuid, text, text, text) to service_role;

-- Server-only: order lookup for the checkout adapter (amount, currency, mapping come from the snapshot).
create or replace function public.get_order_for_checkout(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('orderId', o.id, 'ref', o.short_ref, 'userId', o.user_id, 'email', p.email, 'state', o.state,
    'kind', o.kind, 'productKey', o.product_key, 'productName', o.product_name, 'amountMinor', o.amount_minor::text,
    'currency', o.currency, 'credits', o.credits::text, 'gatewayMapping', pv.gateway_mapping,
    'gatewayCheckoutId', o.gateway_checkout_id, 'checkoutUrl', o.checkout_url)
  from public.payment_orders o
  join public.profiles p on p.user_id = o.user_id
  join app_private.product_versions pv on pv.id = o.product_version_id
  where o.id = p_order_id;
$$;
revoke execute on function public.get_order_for_checkout(uuid) from public, anon, authenticated;
grant execute on function public.get_order_for_checkout(uuid) to service_role;

-- ---------------------------------------------------- webhook receipts

-- Server-only, after the gateway signature verified (§17.3). Persist then process through the events queue.
create or replace function public.record_billing_receipt(p_gateway text, p_event_id text, p_event_type text, p_normalized jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into app_private.billing_event_receipts (gateway, event_id, event_type, normalized)
  values (p_gateway, p_event_id, p_event_type, p_normalized)
  on conflict (gateway, event_id) do nothing
  returning id into v_id;
  if v_id is null then
    return jsonb_build_object('duplicate', true);
  end if;
  perform app_private.enqueue_work('genlixs_events', 'billing_apply', v_id, 'billing:' || v_id, now(), '{}'::jsonb);
  return jsonb_build_object('duplicate', false, 'receiptId', v_id);
end;
$$;
revoke execute on function public.record_billing_receipt(text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_billing_receipt(text, text, text, jsonb) to service_role;

-- Affiliate accrual hook (replaced by the affiliate migration). Called inside the paid-event transaction.
create or replace function app_private.affiliate_on_paid(p_user uuid, p_tx uuid, p_order uuid, p_base_minor bigint, p_currency text, p_source_key text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  return;
end;
$$;

create or replace function app_private.affiliate_on_refund(p_order uuid, p_refunded_base_minor bigint, p_source_key text, p_reason text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  return;
end;
$$;

-- Applies one verified, normalized billing event. Normalized shapes (produced by the gateway adapter
-- after retrieving canonical gateway state):
--   payment.settled      {orderId, paymentId, amountMinor, currency, taxMinor, discountMinor}
--   payment.failed       {orderId, paymentId}
--   subscription.cycle_paid {orderId?, subscriptionId, invoiceId, periodStart, periodEnd, amountMinor, currency, taxMinor, discountMinor,
--                         userId?, productKey?, status}
--   subscription.updated {subscriptionId, status, periodStart, periodEnd, cancelAtPeriodEnd}
--   refund.succeeded     {orderId, refundId, amountMinor, currency, refundRequestId?}
--   dispute.opened / dispute.closed {orderId, disputeId, amountMinor, currency, status, won}
create or replace function app_private.apply_billing_event(p_receipt uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  r app_private.billing_event_receipts;
  e jsonb;
  o public.payment_orders;
  s public.subscriptions;
  pv app_private.product_versions;
  v_tx uuid;
  v_lot uuid;
  v_base bigint;
  v_expires timestamptz;
  v_units_back bigint;
begin
  select * into r from app_private.billing_event_receipts where id = p_receipt for update;
  if r.state in ('applied', 'ignored') then
    return r.state;
  end if;
  e := r.normalized;

  if r.event_type = 'payment.settled' then
    select * into o from public.payment_orders where id = (e ->> 'orderId')::uuid for update;
    if not found or o.kind <> 'credit_pack' then
      update app_private.billing_event_receipts set state = 'failed', error = 'order not found or not a credit pack', processed_at = now() where id = r.id;
      return 'failed';
    end if;
    -- Settled amount and currency must match the immutable order snapshot.
    if (e ->> 'amountMinor')::bigint <> o.amount_minor or e ->> 'currency' <> o.currency then
      update app_private.billing_event_receipts set state = 'failed', error = 'amount/currency mismatch', processed_at = now() where id = r.id;
      return 'failed';
    end if;
    insert into public.billing_transactions (user_id, order_id, gateway, gateway_object_id, kind, amount_minor, currency, state, receipt_id)
    values (o.user_id, o.id, r.gateway, e ->> 'paymentId', 'payment', o.amount_minor, o.currency, 'settled', r.id)
    on conflict (gateway, gateway_object_id, kind) do nothing
    returning id into v_tx;
    if v_tx is not null then
      select * into pv from app_private.product_versions where id = o.product_version_id;
      v_expires := case when pv.credit_expiry_days is null then null else now() + make_interval(days => pv.credit_expiry_days) end;
      -- One grant per settled payment: unique source key across every event type that names it.
      v_lot := app_private.grant_lot(o.user_id, 'purchase', 'payment:' || r.gateway || ':' || (e ->> 'paymentId'), o.credits, v_expires,
        o.short_ref, o.product_name || ' pack');
      update public.payment_orders set state = case when state in ('pending', 'checkout_created', 'failed', 'expired') then 'paid' else state end,
        gateway_payment_id = e ->> 'paymentId', paid_at = coalesce(paid_at, now()) where id = o.id;
      v_base := o.amount_minor - coalesce((e ->> 'taxMinor')::bigint, 0);
      perform app_private.affiliate_on_paid(o.user_id, v_tx, o.id, greatest(v_base, 0), o.currency, 'payment:' || r.gateway || ':' || (e ->> 'paymentId'));
      perform app_private.notify(o.user_id, 'payment_paid:' || o.id, 'payment', 'Payment confirmed',
        o.credits || ' credits were added to your balance.', '/studio/credits');
    end if;

  elsif r.event_type = 'payment.failed' then
    update public.payment_orders set state = 'failed' where id = (e ->> 'orderId')::uuid and state in ('pending', 'checkout_created');

  elsif r.event_type = 'subscription.cycle_paid' then
    select * into s from public.subscriptions where gateway = r.gateway and gateway_subscription_id = e ->> 'subscriptionId' for update;
    if not found then
      select * into o from public.payment_orders where id = (e ->> 'orderId')::uuid;
      if not found or o.kind <> 'subscription' then
        update app_private.billing_event_receipts set state = 'failed', error = 'subscription/order not found', processed_at = now() where id = r.id;
        return 'failed';
      end if;
      insert into public.subscriptions (user_id, product_version_id, gateway, gateway_subscription_id, status, current_period_start, current_period_end)
      values (o.user_id, o.product_version_id, r.gateway, e ->> 'subscriptionId', 'active', (e ->> 'periodStart')::timestamptz, (e ->> 'periodEnd')::timestamptz)
      on conflict (gateway, gateway_subscription_id) do nothing;
      select * into s from public.subscriptions where gateway = r.gateway and gateway_subscription_id = e ->> 'subscriptionId' for update;
      update public.payment_orders set state = 'paid', paid_at = coalesce(paid_at, now()) where id = o.id;
    end if;
    select * into pv from app_private.product_versions where id = s.product_version_id;
    if (e ->> 'amountMinor')::bigint <> pv.amount_minor or e ->> 'currency' <> pv.currency then
      update app_private.billing_event_receipts set state = 'failed', error = 'cycle amount mismatch', processed_at = now() where id = r.id;
      return 'failed';
    end if;
    insert into public.billing_transactions (user_id, subscription_id, gateway, gateway_object_id, kind, amount_minor, currency, state, receipt_id)
    values (s.user_id, s.id, r.gateway, e ->> 'invoiceId', 'payment', pv.amount_minor, pv.currency, 'settled', r.id)
    on conflict (gateway, gateway_object_id, kind) do nothing
    returning id into v_tx;
    if v_tx is not null then
      -- Cycle credits expire at the paid period boundary (no rollover, proposed policy).
      v_lot := app_private.grant_lot(s.user_id, 'subscription', 'cycle:' || r.gateway || ':' || (e ->> 'invoiceId'), pv.credits,
        (e ->> 'periodEnd')::timestamptz, e ->> 'invoiceId', pv.name || ' plan cycle');
      insert into app_private.subscription_cycles (subscription_id, gateway_invoice_id, period_start, period_end, amount_minor, currency, lot_id)
      values (s.id, e ->> 'invoiceId', (e ->> 'periodStart')::timestamptz, (e ->> 'periodEnd')::timestamptz, pv.amount_minor, pv.currency, v_lot)
      on conflict (gateway_invoice_id) do nothing;
      -- Out-of-order safety: only move the period forward.
      update public.subscriptions set status = case when cancel_at_period_end then 'cancel_at_period_end' else 'active' end,
        current_period_start = greatest(coalesce(current_period_start, '-infinity'), (e ->> 'periodStart')::timestamptz),
        current_period_end = greatest(coalesce(current_period_end, '-infinity'), (e ->> 'periodEnd')::timestamptz)
      where id = s.id;
      v_base := pv.amount_minor - coalesce((e ->> 'taxMinor')::bigint, 0);
      perform app_private.affiliate_on_paid(s.user_id, v_tx, null, greatest(v_base, 0), pv.currency, 'cycle:' || r.gateway || ':' || (e ->> 'invoiceId'));
      perform app_private.notify(s.user_id, 'cycle_paid:' || (e ->> 'invoiceId'), 'payment', 'Plan renewed',
        pv.credits || ' plan credits were added for this period.', '/studio/credits');
    end if;

  elsif r.event_type = 'subscription.updated' then
    update public.subscriptions set
      status = e ->> 'status',
      cancel_at_period_end = coalesce((e ->> 'cancelAtPeriodEnd')::boolean, cancel_at_period_end),
      current_period_end = greatest(coalesce(current_period_end, '-infinity'), coalesce((e ->> 'periodEnd')::timestamptz, current_period_end))
    where gateway = r.gateway and gateway_subscription_id = e ->> 'subscriptionId';

  elsif r.event_type = 'refund.succeeded' then
    select * into o from public.payment_orders where id = (e ->> 'orderId')::uuid for update;
    if not found then
      update app_private.billing_event_receipts set state = 'failed', error = 'order not found', processed_at = now() where id = r.id;
      return 'failed';
    end if;
    insert into public.billing_transactions (user_id, order_id, gateway, gateway_object_id, kind, amount_minor, currency, state, receipt_id)
    values (o.user_id, o.id, r.gateway, e ->> 'refundId', 'refund', -(e ->> 'amountMinor')::bigint, o.currency, 'succeeded', r.id)
    on conflict (gateway, gateway_object_id, kind) do nothing
    returning id into v_tx;
    if v_tx is not null then
      update public.payment_orders set refunded_minor = least(amount_minor, refunded_minor + (e ->> 'amountMinor')::bigint),
        state = case when refunded_minor + (e ->> 'amountMinor')::bigint >= amount_minor then 'refunded' else 'partially_refunded' end
      where id = o.id returning * into o;
      -- Revoke the units reserved for revocation by the refund request (unused funded credits only).
      select coalesce(revoke_units, 0) into v_units_back from public.refund_requests
      where id = nullif(e ->> 'refundRequestId', '')::uuid;
      if coalesce(v_units_back, 0) > 0 then
        perform app_private.revoke_order_units(o.id, v_units_back, 'refund:' || r.gateway || ':' || (e ->> 'refundId'));
      end if;
      update public.refund_requests set state = 'succeeded', gateway_refund_id = e ->> 'refundId'
      where id = nullif(e ->> 'refundRequestId', '')::uuid;
      perform app_private.unrestrict_order_lot(o.id);
      perform app_private.affiliate_on_refund(o.id, (e ->> 'amountMinor')::bigint, 'refund:' || r.gateway || ':' || (e ->> 'refundId'), 'refund');
    end if;

  elsif r.event_type in ('dispute.opened', 'dispute.closed') then
    select * into o from public.payment_orders where id = (e ->> 'orderId')::uuid for update;
    insert into app_private.payment_disputes (order_id, gateway, gateway_dispute_id, amount_minor, currency, status)
    values (o.id, r.gateway, e ->> 'disputeId', (e ->> 'amountMinor')::bigint, e ->> 'currency', e ->> 'status')
    on conflict (gateway, gateway_dispute_id) do update set status = excluded.status, updated_at = now();
    if r.event_type = 'dispute.opened' then
      update public.payment_orders set state = 'disputed' where id = o.id;
      update public.credit_lots set restricted = true where source_key like 'payment:' || r.gateway || ':%' and funding_ref = o.short_ref;
      perform app_private.affiliate_on_refund(o.id, 0, 'dispute:' || r.gateway || ':' || (e ->> 'disputeId'), 'dispute_hold');
    else
      if coalesce((e ->> 'won')::boolean, false) then
        update public.payment_orders set state = 'paid' where id = o.id and state = 'disputed';
        update public.credit_lots set restricted = false where funding_ref = o.short_ref;
      else
        perform app_private.revoke_order_units(o.id, null, 'dispute_lost:' || r.gateway || ':' || (e ->> 'disputeId'));
        perform app_private.affiliate_on_refund(o.id, o.amount_minor - o.refunded_minor,
          'dispute_lost:' || r.gateway || ':' || (e ->> 'disputeId'), 'dispute_lost');
      end if;
    end if;
  else
    update app_private.billing_event_receipts set state = 'ignored', processed_at = now() where id = r.id;
    return 'ignored';
  end if;

  update app_private.billing_event_receipts set state = 'applied', processed_at = now() where id = r.id;
  return 'applied';
end;
$$;

-- Revokes unused units of the lot funded by an order (refund or lost dispute). Never makes available negative,
-- never touches spent or reserved units; p_units null = all remaining available units.
create or replace function app_private.revoke_order_units(p_order uuid, p_units bigint, p_key text)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  o public.payment_orders;
  l public.credit_lots;
  v_take bigint;
begin
  select * into o from public.payment_orders where id = p_order;
  perform app_private.lock_wallet(o.user_id);
  select * into l from public.credit_lots where user_id = o.user_id and funding_ref = o.short_ref and source_kind = 'purchase' for update;
  if not found then
    return 0;
  end if;
  v_take := least(l.available_units, coalesce(p_units, l.available_units));
  if v_take <= 0 then
    return 0;
  end if;
  update public.credit_lots set available_units = available_units - v_take, revoked_units = revoked_units + v_take where id = l.id;
  insert into public.credit_ledger (user_id, lot_id, event_type, event_key, idempotency_key, d_available, d_revoked, source_ref, note)
  values (o.user_id, l.id, 'revoke', 'revoke:' || p_key, 'revoke:' || p_key, -v_take, v_take, o.short_ref, 'Credits removed after a refund or chargeback');
  perform app_private.wallet_apply(o.user_id, -v_take, 0, 0, 0, v_take);
  return v_take;
end;
$$;

create or replace function app_private.unrestrict_order_lot(p_order uuid)
returns void
language sql
set search_path = ''
as $$
  update public.credit_lots l set restricted = false
  from public.payment_orders o
  where o.id = p_order and l.user_id = o.user_id and l.funding_ref = o.short_ref and o.state <> 'disputed';
$$;

-- Server-only worker step for the events queue.
create or replace function public.worker_apply_billing(p_work_item_id uuid, p_lease_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w app_private.job_work_items := app_private.verify_lease(p_work_item_id, p_lease_token);
  v_result text;
begin
  v_result := app_private.apply_billing_event(w.ref_id);
  perform app_private.finish_work(w.id, case when v_result = 'failed' then 'dead' else 'done' end, v_result);
  return jsonb_build_object('action', v_result);
end;
$$;
revoke execute on function public.worker_apply_billing(uuid, uuid) from public, anon, authenticated;
grant execute on function public.worker_apply_billing(uuid, uuid) to service_role;

-- ------------------------------------------------------------- refunds

-- Finance-only preparation (§17.6): reserve the refund intent and restrict the funded lot so the units cannot be
-- spent while the gateway refund is pending. The route then submits the refund through the adapter.
create or replace function public.admin_prepare_refund(p_order_id uuid, p_amount_minor bigint, p_reason text, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('billing.refund');
  o public.payment_orders;
  l public.credit_lots;
  v_revoke bigint := 0;
  v_id uuid;
begin
  if coalesce(trim(p_reason), '') = '' then
    perform app_private.fail('REASON_REQUIRED', 'A reason is required.');
  end if;
  select id into v_id from public.refund_requests where idempotency_key = p_idempotency_key;
  if v_id is not null then
    return jsonb_build_object('refundRequestId', v_id, 'replayed', true);
  end if;
  select * into o from public.payment_orders where id = p_order_id for update;
  if not found or o.state not in ('paid', 'partially_refunded') then
    perform app_private.fail('NOT_REFUNDABLE', 'This payment cannot be refunded in its current state.');
  end if;
  if p_amount_minor <= 0 or p_amount_minor > o.amount_minor - o.refunded_minor
     - coalesce((select sum(amount_minor) from public.refund_requests where order_id = o.id and state in ('prepared', 'submitting', 'submission_unknown')), 0) then
    perform app_private.fail('AMOUNT_EXCEEDS_REFUNDABLE', 'The amount exceeds the remaining refundable amount.');
  end if;
  if o.kind = 'credit_pack' then
    perform app_private.lock_wallet(o.user_id);
    select * into l from public.credit_lots where user_id = o.user_id and funding_ref = o.short_ref and source_kind = 'purchase' for update;
    -- Proportional unused units; spent/reserved units are never clawed back silently (§17.6).
    v_revoke := least(coalesce(l.available_units, 0), ceil(o.credits::numeric * p_amount_minor / o.amount_minor)::bigint);
    update public.credit_lots set restricted = true where id = l.id;
  end if;
  insert into public.refund_requests (order_id, user_id, amount_minor, currency, reason, revoke_units, requested_by, idempotency_key)
  values (o.id, o.user_id, p_amount_minor, o.currency, p_reason, v_revoke, v_actor, p_idempotency_key)
  returning id into v_id;
  update public.payment_orders set state = 'refund_pending' where id = o.id and state = 'paid';
  perform app_private.audit(v_actor, 'billing.refund', 'refund.prepare', 'payment_order', o.id::text, p_reason, null,
    jsonb_build_object('amountMinor', p_amount_minor, 'revokeUnits', v_revoke));
  return jsonb_build_object('refundRequestId', v_id, 'revokeUnits', v_revoke::text, 'gatewayPaymentId', o.gateway_payment_id,
    'gateway', o.gateway, 'currency', o.currency, 'replayed', false);
end;
$$;
revoke execute on function public.admin_prepare_refund(uuid, bigint, text, text) from public, anon;
grant execute on function public.admin_prepare_refund(uuid, bigint, text, text) to authenticated;

create or replace function public.record_refund_submission(p_refund_request_id uuid, p_state text, p_gateway_refund_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_state not in ('submitting', 'submission_unknown', 'failed') then
    perform app_private.fail('INVALID_STATE', 'Invalid refund state.');
  end if;
  update public.refund_requests set state = p_state, gateway_refund_id = coalesce(p_gateway_refund_id, gateway_refund_id)
  where id = p_refund_request_id and state in ('prepared', 'submitting', 'submission_unknown');
  if p_state = 'failed' then
    update public.credit_lots l set restricted = false
    from public.refund_requests rr join public.payment_orders o on o.id = rr.order_id
    where rr.id = p_refund_request_id and l.funding_ref = o.short_ref;
    update public.payment_orders o set state = 'paid'
    from public.refund_requests rr where rr.id = p_refund_request_id and o.id = rr.order_id and o.state = 'refund_pending';
  end if;
  return jsonb_build_object('refundRequestId', p_refund_request_id, 'state', p_state);
end;
$$;
revoke execute on function public.record_refund_submission(uuid, text, text) from public, anon, authenticated;
grant execute on function public.record_refund_submission(uuid, text, text) to service_role;

-- ------------------------------------------------------------------ reads

create or replace function public.get_billing_overview()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object('id', o.id, 'ref', o.short_ref, 'product', o.product_name, 'kind', o.kind,
        'amountMinor', o.amount_minor::text, 'currency', o.currency, 'credits', o.credits::text, 'state', o.state,
        'refundedMinor', o.refunded_minor::text, 'createdAt', o.created_at, 'paidAt', o.paid_at) order by o.created_at desc)
      from (select * from public.payment_orders where user_id = (select auth.uid()) order by created_at desc limit 50) o
    ), '[]'),
    'subscription', (
      select jsonb_build_object('id', s.id, 'status', s.status, 'product', pv.name, 'credits', pv.credits::text,
        'amountMinor', pv.amount_minor::text, 'currency', pv.currency, 'periodEnd', s.current_period_end,
        'cancelAtPeriodEnd', s.cancel_at_period_end)
      from public.subscriptions s join app_private.product_versions pv on pv.id = s.product_version_id
      where s.user_id = (select auth.uid()) and s.status <> 'cancelled'
      order by s.created_at desc limit 1
    )
  );
$$;
revoke execute on function public.get_billing_overview() from public, anon;
grant execute on function public.get_billing_overview() to authenticated;

create or replace function public.get_order(p_order_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object('id', o.id, 'ref', o.short_ref, 'product', o.product_name, 'kind', o.kind,
    'amountMinor', o.amount_minor::text, 'currency', o.currency, 'credits', o.credits::text, 'state', o.state,
    'createdAt', o.created_at, 'paidAt', o.paid_at)
  from public.payment_orders o where o.id = p_order_id and o.user_id = (select auth.uid());
$$;
revoke execute on function public.get_order(uuid) from public, anon;
grant execute on function public.get_order(uuid) to authenticated;
