-- Genlixs 07 · Affiliates (§18). Owner-confirmed: 30% of eligible revenue, 50% after 10 DISTINCT paying
-- customers, revenue-based (not profit). Proposed and versioned (not confirmed): 30-day attribution window,
-- prospective uplift, 12-month renewal eligibility, 30-day hold, monthly payouts with a USD 50 threshold.

create table public.affiliate_agreement_versions (
  id uuid primary key default gen_random_uuid(),
  version int not null unique,
  base_rate_bps int not null check (base_rate_bps between 0 and 10000),
  uplift_rate_bps int not null check (uplift_rate_bps between 0 and 10000),
  uplift_threshold int not null check (uplift_threshold > 0),
  uplift_rule text not null default 'prospective' check (uplift_rule in ('prospective')),
  attribution_window_days int not null check (attribution_window_days > 0),
  renewal_months int not null check (renewal_months >= 0),
  hold_days int not null check (hold_days >= 0),
  payout_thresholds jsonb not null,
  -- Which terms the owner explicitly confirmed versus proposed defaults (§1.3).
  confirmed jsonb not null,
  terms_summary text not null,
  state text not null default 'draft' check (state in ('draft', 'published', 'retired')),
  published_at timestamptz,
  published_by uuid,
  created_at timestamptz not null default now()
);
create unique index affiliate_agreement_one_published on public.affiliate_agreement_versions (state) where state = 'published';

insert into public.affiliate_agreement_versions (version, base_rate_bps, uplift_rate_bps, uplift_threshold, attribution_window_days,
  renewal_months, hold_days, payout_thresholds, confirmed, terms_summary)
values (1, 3000, 5000, 10, 30, 12, 30, '{"USD": 5000}'::jsonb,
  '{"baseRate": true, "upliftRate": true, "upliftThreshold": true, "upliftRule": false, "attributionWindow": false, "renewalMonths": false, "holdDays": false, "payoutThreshold": false}'::jsonb,
  '30% of eligible referred revenue; 50% on later eligible payments once you have 10 distinct paying customers. Revenue excludes tax and refunds. Proposed: 30-day attribution window, 12-month renewal eligibility, 30-day hold, monthly payouts from USD 50.');

create table public.affiliate_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (user_id),
  state text not null default 'applied' check (state in ('applied', 'active', 'suspended', 'rejected')),
  tier text not null default 'base' check (tier in ('base', 'uplift')),
  qualifying_customers int not null default 0 check (qualifying_customers >= 0),
  agreement_version_id uuid references public.affiliate_agreement_versions (id),
  payout_currency text not null default 'USD',
  application jsonb not null,
  rejection_reason text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger affiliate_accounts_touch before update on public.affiliate_accounts for each row execute function app_private.touch_updated_at();

create table public.affiliate_links (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliate_accounts (id),
  slug text not null unique check (slug ~ '^[a-z0-9]{6,24}$'),
  destination text not null check (destination ~ '^/[A-Za-z0-9/_-]*$' and destination not like '//%'),
  campaign text check (char_length(campaign) <= 60),
  channel text check (char_length(channel) <= 40),
  sub_id text check (sub_id ~ '^[A-Za-z0-9_-]{1,40}$'),
  is_main boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index affiliate_links_one_main on public.affiliate_links (affiliate_id) where is_main;

create table app_private.affiliate_clicks (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.affiliate_links (id),
  affiliate_id uuid not null references public.affiliate_accounts (id),
  consent boolean not null,
  referrer_host text,
  utm jsonb,
  created_at timestamptz not null default now()
);
create index affiliate_clicks_affiliate_idx on app_private.affiliate_clicks (affiliate_id, created_at desc);

create table app_private.affiliate_attributions (
  customer_id uuid primary key references public.profiles (user_id),
  affiliate_id uuid not null references public.affiliate_accounts (id),
  link_id uuid not null references public.affiliate_links (id),
  click_id uuid not null references app_private.affiliate_clicks (id),
  click_at timestamptz not null,
  bound_at timestamptz not null default now(),
  first_payment_at timestamptz,
  state text not null default 'bound' check (state in ('bound', 'window_expired', 'disqualified'))
);
create index affiliate_attributions_affiliate_idx on app_private.affiliate_attributions (affiliate_id);

create table app_private.affiliate_customer_qualifications (
  affiliate_id uuid not null references public.affiliate_accounts (id),
  customer_id uuid not null,
  first_commission_id uuid,
  qualified_at timestamptz not null default now(),
  state text not null default 'counted' check (state in ('counted', 'reversed')),
  primary key (affiliate_id, customer_id)
);

create table app_private.affiliate_tier_events (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliate_accounts (id),
  from_tier text not null,
  to_tier text not null,
  qualifying_customers int not null,
  reason text not null,
  actor_id uuid,
  created_at timestamptz not null default now()
);
create trigger affiliate_tier_events_append_only before update or delete on app_private.affiliate_tier_events
  for each row execute function app_private.forbid_mutation();

create table public.commission_entries (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.affiliate_accounts (id),
  customer_ref text not null,
  customer_id uuid not null,
  source_key text not null unique,
  order_id uuid references public.payment_orders (id),
  billing_tx_id uuid references public.billing_transactions (id),
  base_minor bigint not null check (base_minor >= 0),
  currency text not null,
  rate_bps int not null,
  agreement_version_id uuid not null references public.affiliate_agreement_versions (id),
  amount_minor bigint not null check (amount_minor >= 0),
  refunded_base_minor bigint not null default 0 check (refunded_base_minor >= 0),
  reversed_minor bigint not null default 0 check (reversed_minor >= 0),
  state text not null default 'pending_hold' check (state in ('pending_hold', 'eligible', 'reserved_for_payout', 'paid', 'reversed', 'disputed')),
  hold_until timestamptz not null,
  eligible_at timestamptz,
  payout_batch_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (reversed_minor <= amount_minor and refunded_base_minor <= base_minor)
);
create index commission_entries_affiliate_idx on public.commission_entries (affiliate_id, created_at desc);
create index commission_entries_hold_idx on public.commission_entries (hold_until) where state = 'pending_hold';
create trigger commission_entries_touch before update on public.commission_entries for each row execute function app_private.touch_updated_at();

create table public.commission_adjustments (
  id uuid primary key default gen_random_uuid(),
  commission_id uuid not null references public.commission_entries (id),
  affiliate_id uuid not null references public.affiliate_accounts (id),
  amount_minor bigint not null,
  currency text not null,
  reason text not null,
  source_key text not null unique,
  -- Adjustments against already-paid commissions carry forward into the next payout batch.
  settled_batch_id uuid,
  created_at timestamptz not null default now()
);
create trigger commission_adjustments_no_delete before delete on public.commission_adjustments
  for each row execute function app_private.forbid_mutation();

create table app_private.payout_destinations (
  affiliate_id uuid primary key references public.affiliate_accounts (id),
  method text not null check (method in ('bank_transfer', 'paypal', 'wise', 'other')),
  -- Display-only hint (e.g. last 4 digits); full payout details are held by the payout provider or offline.
  display_hint text not null check (char_length(display_hint) <= 60),
  verified boolean not null default false,
  verified_by uuid,
  verified_at timestamptz,
  changed_at timestamptz not null default now()
);

create table public.payout_batches (
  id uuid primary key default gen_random_uuid(),
  short_ref text not null unique default app_private.short_ref('PB'),
  currency text not null,
  state text not null default 'draft' check (state in ('draft', 'reviewed', 'submitting', 'submission_unknown', 'paid', 'failed', 'cancelled')),
  total_minor bigint not null default 0,
  method text not null default 'manual',
  prepared_by uuid not null,
  approved_by uuid,
  single_owner_exception text,
  transfer_reference text,
  evidence text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz
);
create trigger payout_batches_touch before update on public.payout_batches for each row execute function app_private.touch_updated_at();

create table public.payout_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.payout_batches (id),
  affiliate_id uuid not null references public.affiliate_accounts (id),
  commission_id uuid references public.commission_entries (id),
  adjustment_id uuid references public.commission_adjustments (id),
  amount_minor bigint not null,
  currency text not null,
  active boolean not null default true,
  check ((commission_id is null) <> (adjustment_id is null))
);
-- A commission (or adjustment) can belong to only one active batch (§18.6).
create unique index payout_items_commission_active on public.payout_items (commission_id) where active and commission_id is not null;
create unique index payout_items_adjustment_active on public.payout_items (adjustment_id) where active and adjustment_id is not null;

alter table public.affiliate_agreement_versions enable row level security;
alter table public.affiliate_accounts enable row level security;
alter table public.affiliate_links enable row level security;
alter table public.commission_entries enable row level security;
alter table public.commission_adjustments enable row level security;
alter table public.payout_batches enable row level security;
alter table public.payout_items enable row level security;

create policy agreements_public_read on public.affiliate_agreement_versions for select to anon, authenticated using (state = 'published');
create policy affiliate_owner_read on public.affiliate_accounts for select to authenticated using ((select auth.uid()) = user_id);
create policy affiliate_links_owner_read on public.affiliate_links for select to authenticated
  using (exists (select 1 from public.affiliate_accounts a where a.id = affiliate_id and a.user_id = (select auth.uid())));
create policy payout_items_owner_read on public.payout_items for select to authenticated
  using (exists (select 1 from public.affiliate_accounts a where a.id = affiliate_id and a.user_id = (select auth.uid())));
-- Commission rows carry customer_id, so affiliates read them only through the masked RPCs below.
revoke all on public.affiliate_agreement_versions, public.affiliate_accounts, public.affiliate_links, public.commission_entries,
  public.commission_adjustments, public.payout_batches, public.payout_items from anon, authenticated;
grant select on public.affiliate_agreement_versions to anon, authenticated;
grant select on public.affiliate_accounts, public.affiliate_links, public.payout_items to authenticated;

-- ------------------------------------------------------------ helpers

create or replace function app_private.mask_customer(p_affiliate uuid, p_customer uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select 'C-' || upper(left(encode(extensions.digest(p_affiliate::text || ':' || p_customer::text, 'sha256'), 'hex'), 6));
$$;

create or replace function app_private.current_agreement()
returns public.affiliate_agreement_versions
language sql
stable
set search_path = ''
as $$
  select * from public.affiliate_agreement_versions where state = 'published' limit 1;
$$;

create or replace function app_private.my_affiliate()
returns public.affiliate_accounts
language plpgsql
stable
set search_path = ''
as $$
declare
  a public.affiliate_accounts;
begin
  select * into a from public.affiliate_accounts where user_id = auth.uid();
  if not found then
    perform app_private.fail('NOT_AN_AFFILIATE', 'Apply to the partner program first.');
  end if;
  return a;
end;
$$;

-- ---------------------------------------------------------- referral

-- Records a consent-aware click for an active link and returns the opaque click id for the signed cookie.
create or replace function public.record_referral_click(p_slug text, p_consent boolean, p_referrer_host text default null, p_utm jsonb default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  l public.affiliate_links;
  v_click uuid;
begin
  select k.* into l from public.affiliate_links k join public.affiliate_accounts a on a.id = k.affiliate_id
  where k.slug = lower(p_slug) and k.archived_at is null and a.state = 'active';
  if not found then
    return jsonb_build_object('destination', '/', 'clickId', null);
  end if;
  insert into app_private.affiliate_clicks (link_id, affiliate_id, consent, referrer_host, utm)
  values (l.id, l.affiliate_id, coalesce(p_consent, false), left(p_referrer_host, 120),
    case when jsonb_typeof(p_utm) = 'object' and length(p_utm::text) < 600 then p_utm end)
  returning id into v_click;
  return jsonb_build_object('destination', l.destination,
    'clickId', case when coalesce(p_consent, false) then v_click end);
end;
$$;
revoke execute on function public.record_referral_click(text, boolean, text, jsonb) from public;
grant execute on function public.record_referral_click(text, boolean, text, jsonb) to anon, authenticated;

-- Signup trigger now also binds the last eligible referral click captured before signup (§14, §18.2).
create or replace function app_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_click uuid;
  c app_private.affiliate_clicks;
  a public.affiliate_accounts;
  v_window int := coalesce((app_private.current_agreement()).attribution_window_days, 30);
begin
  insert into public.profiles (user_id, email) values (new.id, new.email) on conflict (user_id) do nothing;
  insert into public.wallet_accounts (user_id) values (new.id) on conflict (user_id) do nothing;

  begin
    v_click := nullif(new.raw_user_meta_data ->> 'referral_click_id', '')::uuid;
  exception when others then
    v_click := null;
  end;
  if v_click is not null then
    select * into c from app_private.affiliate_clicks where id = v_click;
    select * into a from public.affiliate_accounts where id = c.affiliate_id;
    if c.id is not null and c.consent and c.created_at <= now() and c.created_at > now() - make_interval(days => v_window)
       and a.state = 'active' and a.user_id <> new.id then
      insert into app_private.affiliate_attributions (customer_id, affiliate_id, link_id, click_id, click_at)
      values (new.id, c.affiliate_id, c.link_id, c.id, c.created_at)
      on conflict (customer_id) do nothing;
    end if;
  end if;
  return new;
end;
$$;

-- --------------------------------------------------------- membership

create or replace function public.apply_affiliate(p_application jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_active_user();
  a public.affiliate_accounts;
  v_app jsonb;
begin
  if not exists (select 1 from auth.users where id = v_uid and email_confirmed_at is not null) then
    perform app_private.fail('EMAIL_NOT_VERIFIED', 'Verify your email before applying.');
  end if;
  if coalesce(trim(p_application ->> 'name'), '') = '' or coalesce(trim(p_application ->> 'country'), '') = ''
     or jsonb_typeof(p_application -> 'channels') <> 'array' or jsonb_array_length(p_application -> 'channels') = 0
     or coalesce((p_application ->> 'termsAccepted')::boolean, false) is not true then
    perform app_private.fail('APPLICATION_INCOMPLETE', 'Add your name, country, at least one channel and accept the terms.');
  end if;
  v_app := jsonb_build_object(
    'name', left(p_application ->> 'name', 80), 'country', left(p_application ->> 'country', 60),
    'channels', (select coalesce(jsonb_agg(left(x, 200)), '[]') from (select jsonb_array_elements_text(p_application -> 'channels') x limit 5) t),
    'niche', left(p_application ->> 'niche', 120), 'method', left(p_application ->> 'method', 600),
    'termsVersion', (app_private.current_agreement()).version, 'submittedAt', now());
  select * into a from public.affiliate_accounts where user_id = v_uid for update;
  if found then
    if a.state in ('active', 'applied') then
      return jsonb_build_object('state', a.state, 'replayed', true);
    end if;
    if a.state = 'suspended' then
      perform app_private.fail('AFFILIATE_SUSPENDED', 'Your partner account is suspended. Contact partner support.');
    end if;
    update public.affiliate_accounts set state = 'applied', application = v_app, rejection_reason = null where id = a.id;
    return jsonb_build_object('state', 'applied', 'replayed', false);
  end if;
  insert into public.affiliate_accounts (user_id, application) values (v_uid, v_app);
  return jsonb_build_object('state', 'applied', 'replayed', false);
end;
$$;
revoke execute on function public.apply_affiliate(jsonb) from public, anon;
grant execute on function public.apply_affiliate(jsonb) to authenticated;

create or replace function app_private.new_link_slug()
returns text
language sql
volatile
set search_path = ''
as $$
  select lower(substr(translate(encode(extensions.gen_random_bytes(8), 'base64'), '+/=', 'xyz'), 1, 10));
$$;

-- Allowed same-site destinations only; no external redirects (§13).
create or replace function app_private.allowed_destination(p_dest text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_dest in ('/', '/pricing', '/partners/apply', '/studio', '/studio/image', '/studio/edit', '/studio/video', '/help', '/#create', '/#examples', '/#pricing');
$$;

create or replace function public.create_affiliate_link(p_destination text, p_campaign text default null, p_channel text default null, p_sub_id text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.affiliate_accounts := app_private.my_affiliate();
  v_dest text := coalesce(nullif(trim(p_destination), ''), '/');
  v_id uuid;
  v_slug text;
begin
  if a.state <> 'active' then
    perform app_private.fail('AFFILIATE_NOT_ACTIVE', 'Links are available once your application is approved.');
  end if;
  if not app_private.allowed_destination(split_part(v_dest, '#', 1)) and not app_private.allowed_destination(v_dest) then
    perform app_private.fail('INVALID_DESTINATION', 'Choose one of the allowed Genlixs pages.');
  end if;
  if (select count(*) from public.affiliate_links where affiliate_id = a.id and archived_at is null) >= 50 then
    perform app_private.fail('LINK_LIMIT', 'Archive an old link before creating more.');
  end if;
  v_slug := app_private.new_link_slug();
  insert into public.affiliate_links (affiliate_id, slug, destination, campaign, channel, sub_id)
  values (a.id, v_slug, split_part(v_dest, '#', 1), left(nullif(trim(p_campaign), ''), 60), left(nullif(trim(p_channel), ''), 40), nullif(trim(p_sub_id), ''))
  returning id into v_id;
  return jsonb_build_object('linkId', v_id, 'slug', v_slug, 'path', '/r/' || v_slug);
end;
$$;
revoke execute on function public.create_affiliate_link(text, text, text, text) from public, anon;
grant execute on function public.create_affiliate_link(text, text, text, text) to authenticated;

create or replace function public.archive_affiliate_link(p_link_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.affiliate_accounts := app_private.my_affiliate();
begin
  update public.affiliate_links set archived_at = coalesce(archived_at, now())
  where id = p_link_id and affiliate_id = a.id and not is_main;
  if not found then
    perform app_private.fail('NOT_FOUND', 'Link not found, or it is your main link.');
  end if;
  return jsonb_build_object('linkId', p_link_id, 'archived', true);
end;
$$;
revoke execute on function public.archive_affiliate_link(uuid) from public, anon;
grant execute on function public.archive_affiliate_link(uuid) to authenticated;

create or replace function public.set_payout_destination(p_method text, p_display_hint text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  a public.affiliate_accounts := app_private.my_affiliate();
begin
  if a.state <> 'active' then
    perform app_private.fail('AFFILIATE_NOT_ACTIVE', 'Payout details are available once your application is approved.');
  end if;
  -- A change requires re-verification and blocks transfers for 48 hours (§13).
  insert into app_private.payout_destinations (affiliate_id, method, display_hint)
  values (a.id, p_method, left(p_display_hint, 60))
  on conflict (affiliate_id) do update set method = excluded.method, display_hint = excluded.display_hint,
    verified = false, verified_by = null, verified_at = null, changed_at = now();
  perform app_private.notify(a.user_id, 'payout_destination:' || a.id || ':' || extract(epoch from now())::bigint, 'affiliate',
    'Payout details changed', 'Your payout details were updated. Transfers pause for 48 hours while they are verified.', '/partner/settings');
  return jsonb_build_object('method', p_method, 'verified', false, 'transfersResumeAfter', now() + interval '48 hours');
end;
$$;
revoke execute on function public.set_payout_destination(text, text) from public, anon;
grant execute on function public.set_payout_destination(text, text) to authenticated;

-- ------------------------------------------------------------ accrual

-- Called inside the settled-payment transaction (billing). Serialized on the affiliate row so concurrent
-- threshold-crossing payments cannot lose a qualification (§18.3).
create or replace function app_private.affiliate_on_paid(p_user uuid, p_tx uuid, p_order uuid, p_base_minor bigint, p_currency text, p_source_key text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  at app_private.affiliate_attributions;
  a public.affiliate_accounts;
  ag public.affiliate_agreement_versions;
  v_rate int;
  v_amount bigint;
  v_comm uuid;
  v_inserted int;
begin
  select * into at from app_private.affiliate_attributions where customer_id = p_user and state = 'bound';
  if not found then
    return;
  end if;
  select * into a from public.affiliate_accounts where id = at.affiliate_id for update;
  if a.state <> 'active' or a.user_id = p_user or a.agreement_version_id is null then
    return;
  end if;
  select * into ag from public.affiliate_agreement_versions where id = a.agreement_version_id;

  -- First payment must fall inside the attribution window; renewals inside the renewal term.
  if at.first_payment_at is null then
    if now() > at.click_at + make_interval(days => ag.attribution_window_days) then
      update app_private.affiliate_attributions set state = 'window_expired' where customer_id = p_user;
      return;
    end if;
  elsif now() > at.first_payment_at + make_interval(months => ag.renewal_months) then
    return;
  end if;
  if p_base_minor <= 0 then
    return;
  end if;

  -- Prospective rule: this payment uses the tier in force before it is counted.
  v_rate := case when a.tier = 'uplift' then ag.uplift_rate_bps else ag.base_rate_bps end;
  v_amount := (p_base_minor * v_rate + 5000) / 10000;  -- round half up on non-negative integers

  insert into public.commission_entries (affiliate_id, customer_ref, customer_id, source_key, order_id, billing_tx_id, base_minor, currency,
    rate_bps, agreement_version_id, amount_minor, hold_until)
  values (a.id, app_private.mask_customer(a.id, p_user), p_user, p_source_key, p_order, p_tx, p_base_minor, p_currency, v_rate, ag.id, v_amount,
    now() + make_interval(days => ag.hold_days))
  on conflict (source_key) do nothing
  returning id into v_comm;
  if v_comm is null then
    return;
  end if;

  update app_private.affiliate_attributions set first_payment_at = coalesce(first_payment_at, now()) where customer_id = p_user;

  insert into app_private.affiliate_customer_qualifications (affiliate_id, customer_id, first_commission_id)
  values (a.id, p_user, v_comm)
  on conflict (affiliate_id, customer_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 1 then
    update public.affiliate_accounts set qualifying_customers = qualifying_customers + 1 where id = a.id returning * into a;
    if a.tier = 'base' and a.qualifying_customers >= ag.uplift_threshold then
      update public.affiliate_accounts set tier = 'uplift' where id = a.id;
      insert into app_private.affiliate_tier_events (affiliate_id, from_tier, to_tier, qualifying_customers, reason)
      values (a.id, 'base', 'uplift', a.qualifying_customers, 'Reached ' || ag.uplift_threshold || ' distinct paying customers');
      perform app_private.notify(a.user_id, 'affiliate_tier_uplift:' || a.id, 'affiliate', 'Your rate is now ' || (ag.uplift_rate_bps / 100) || '%',
        'You reached ' || ag.uplift_threshold || ' paying customers. Later eligible payments earn the higher rate.', '/partner');
    end if;
  end if;
end;
$$;

-- Refund/dispute corrections with cumulative rounding so repeated partial refunds can never over- or
-- under-reverse; a full refund reverses exactly the original amount (§18.4).
create or replace function app_private.affiliate_on_refund(p_order uuid, p_refunded_base_minor bigint, p_source_key text, p_reason text)
returns void
language plpgsql
set search_path = ''
as $$
declare
  c public.commission_entries;
  v_new_refunded bigint;
  v_target bigint;
  v_delta bigint;
  v_other int;
  a public.affiliate_accounts;
begin
  for c in select * from public.commission_entries where order_id = p_order order by created_at for update loop
    if p_reason = 'dispute_hold' then
      if c.state in ('pending_hold', 'eligible') then
        update public.commission_entries set state = 'disputed' where id = c.id;
      end if;
      continue;
    end if;
    v_new_refunded := least(c.base_minor, c.refunded_base_minor + greatest(p_refunded_base_minor, 0));
    v_target := case when v_new_refunded >= c.base_minor then c.amount_minor
                     else (c.amount_minor * v_new_refunded + c.base_minor / 2) / nullif(c.base_minor, 0) end;
    v_delta := coalesce(v_target, 0) - c.reversed_minor;
    if v_delta > 0 then
      insert into public.commission_adjustments (commission_id, affiliate_id, amount_minor, currency, reason, source_key)
      values (c.id, c.affiliate_id, -v_delta, c.currency, p_reason, p_source_key || ':' || c.id)
      on conflict (source_key) do nothing;
      if found then
        update public.commission_entries set reversed_minor = reversed_minor + v_delta, refunded_base_minor = v_new_refunded,
          state = case when reversed_minor + v_delta >= amount_minor and state in ('pending_hold', 'eligible', 'disputed') then 'reversed' else state end
        where id = c.id;
      end if;
    end if;
    -- A fully reversed qualifying payment before promotion can un-count the customer if nothing else qualifies.
    if v_new_refunded >= c.base_minor then
      select * into a from public.affiliate_accounts where id = c.affiliate_id for update;
      select count(*) into v_other from public.commission_entries
      where affiliate_id = c.affiliate_id and customer_id = c.customer_id and id <> c.id and reversed_minor < amount_minor;
      if a.tier = 'base' and v_other = 0 then
        update app_private.affiliate_customer_qualifications set state = 'reversed'
        where affiliate_id = c.affiliate_id and customer_id = c.customer_id and state = 'counted';
        if found then
          update public.affiliate_accounts set qualifying_customers = greatest(qualifying_customers - 1, 0) where id = a.id;
        end if;
      end if;
    end if;
  end loop;
end;
$$;

-- Hold maturity, run by the watchdog: eligible only after the hold and with the payment still in good standing.
create or replace function app_private.mature_commissions()
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_n int;
begin
  update public.commission_entries c set state = 'eligible', eligible_at = now()
  where c.state = 'pending_hold' and c.hold_until <= now()
    and c.reversed_minor < c.amount_minor
    and not exists (select 1 from public.payment_orders o where o.id = c.order_id and o.state in ('disputed', 'refund_pending'));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- -------------------------------------------------------- affiliate reads

create or replace function public.get_affiliate_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  a public.affiliate_accounts;
  ag public.affiliate_agreement_versions;
  v_main public.affiliate_links;
begin
  select * into a from public.affiliate_accounts where user_id = auth.uid();
  if not found then
    return jsonb_build_object('membership', null, 'agreement', (select to_jsonb(x) - 'published_by' from app_private.current_agreement() x));
  end if;
  select * into ag from public.affiliate_agreement_versions where id = coalesce(a.agreement_version_id, (app_private.current_agreement()).id);
  select * into v_main from public.affiliate_links where affiliate_id = a.id and is_main;
  return jsonb_build_object(
    'membership', jsonb_build_object('id', a.id, 'state', a.state, 'tier', a.tier, 'qualifyingCustomers', a.qualifying_customers,
      'rejectionReason', a.rejection_reason, 'payoutCurrency', a.payout_currency, 'since', a.reviewed_at),
    'agreement', case when ag.id is null then null else jsonb_build_object('version', ag.version, 'baseRateBps', ag.base_rate_bps,
      'upliftRateBps', ag.uplift_rate_bps, 'upliftThreshold', ag.uplift_threshold, 'attributionWindowDays', ag.attribution_window_days,
      'renewalMonths', ag.renewal_months, 'holdDays', ag.hold_days, 'payoutThresholds', ag.payout_thresholds, 'confirmed', ag.confirmed,
      'summary', ag.terms_summary, 'state', ag.state) end,
    'currentRateBps', case when a.tier = 'uplift' then ag.uplift_rate_bps else ag.base_rate_bps end,
    'mainLink', case when v_main.id is null then null else jsonb_build_object('slug', v_main.slug, 'path', '/r/' || v_main.slug) end,
    'metrics', jsonb_build_object(
      'clicks30d', (select count(*) from app_private.affiliate_clicks where affiliate_id = a.id and created_at > now() - interval '30 days'),
      'signups', (select count(*) from app_private.affiliate_attributions where affiliate_id = a.id),
      'payingCustomers', (select count(*) from app_private.affiliate_customer_qualifications where affiliate_id = a.id and state = 'counted'),
      'eligibleRevenueMinor', (select coalesce(sum(base_minor - refunded_base_minor), 0)::text from public.commission_entries where affiliate_id = a.id)
    ),
    'balances', (
      select jsonb_object_agg(cur, b) from (
        select c.currency as cur, jsonb_build_object(
          'pendingHold', coalesce(sum(c.amount_minor - c.reversed_minor) filter (where c.state = 'pending_hold'), 0)::text,
          'available', coalesce(sum(c.amount_minor - c.reversed_minor) filter (where c.state = 'eligible'), 0)::text,
          'reserved', coalesce(sum(c.amount_minor - c.reversed_minor) filter (where c.state = 'reserved_for_payout'), 0)::text,
          'paid', coalesce(sum(c.amount_minor) filter (where c.state = 'paid'), 0)::text,
          'disputed', coalesce(sum(c.amount_minor - c.reversed_minor) filter (where c.state = 'disputed'), 0)::text,
          'reversed', coalesce(sum(c.reversed_minor), 0)::text,
          'carryForward', (select coalesce(sum(x.amount_minor), 0)::text from public.commission_adjustments x
            join public.commission_entries y on y.id = x.commission_id
            where x.affiliate_id = a.id and x.currency = c.currency and x.settled_batch_id is null and y.state = 'paid')
        ) as b
        from public.commission_entries c where c.affiliate_id = a.id group by c.currency
      ) t
    ),
    'nextPayoutNote', 'Monthly, after the hold period, once the available balance reaches the payout threshold.'
  );
end;
$$;
revoke execute on function public.get_affiliate_overview() from public, anon;
grant execute on function public.get_affiliate_overview() to authenticated;

create or replace function public.list_affiliate_links()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', l.id, 'slug', l.slug, 'path', '/r/' || l.slug, 'destination', l.destination,
    'campaign', l.campaign, 'channel', l.channel, 'subId', l.sub_id, 'isMain', l.is_main, 'archivedAt', l.archived_at, 'createdAt', l.created_at,
    'clicks', (select count(*) from app_private.affiliate_clicks k where k.link_id = l.id),
    'signups', (select count(*) from app_private.affiliate_attributions t where t.link_id = l.id),
    'payingCustomers', (select count(*) from app_private.affiliate_attributions t where t.link_id = l.id and t.first_payment_at is not null)
  ) order by l.is_main desc, l.created_at desc), '[]')
  from public.affiliate_links l join public.affiliate_accounts a on a.id = l.affiliate_id
  where a.user_id = auth.uid();
$$;
revoke execute on function public.list_affiliate_links() from public, anon;
grant execute on function public.list_affiliate_links() to authenticated;

-- Masked referrals: no email, name, billing method or assets (§13).
create or replace function public.list_affiliate_referrals()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'customerRef', app_private.mask_customer(t.affiliate_id, t.customer_id), 'signedUpAt', date_trunc('day', t.bound_at),
    'firstPaymentAt', date_trunc('day', t.first_payment_at), 'state', t.state,
    'qualifies', exists (select 1 from app_private.affiliate_customer_qualifications q where q.affiliate_id = t.affiliate_id and q.customer_id = t.customer_id and q.state = 'counted'),
    'campaign', (select l.campaign from public.affiliate_links l where l.id = t.link_id)
  ) order by t.bound_at desc), '[]')
  from app_private.affiliate_attributions t join public.affiliate_accounts a on a.id = t.affiliate_id
  where a.user_id = auth.uid();
$$;
revoke execute on function public.list_affiliate_referrals() from public, anon;
grant execute on function public.list_affiliate_referrals() to authenticated;

create or replace function public.list_affiliate_commissions()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'customerRef', c.customer_ref, 'baseMinor', c.base_minor::text, 'currency', c.currency,
    'rateBps', c.rate_bps, 'agreementVersion', (select v.version from public.affiliate_agreement_versions v where v.id = c.agreement_version_id),
    'amountMinor', c.amount_minor::text, 'reversedMinor', c.reversed_minor::text, 'state', c.state, 'holdUntil', c.hold_until,
    'eligibleAt', c.eligible_at, 'createdAt', c.created_at,
    'adjustments', coalesce((select jsonb_agg(jsonb_build_object('amountMinor', x.amount_minor::text, 'reason', x.reason, 'at', x.created_at))
      from public.commission_adjustments x where x.commission_id = c.id), '[]')
  ) order by c.created_at desc), '[]')
  from public.commission_entries c join public.affiliate_accounts a on a.id = c.affiliate_id
  where a.user_id = auth.uid();
$$;
revoke execute on function public.list_affiliate_commissions() from public, anon;
grant execute on function public.list_affiliate_commissions() to authenticated;

create or replace function public.list_affiliate_payouts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'destination', (select jsonb_build_object('method', d.method, 'hint', d.display_hint, 'verified', d.verified, 'changedAt', d.changed_at)
      from app_private.payout_destinations d join public.affiliate_accounts a on a.id = d.affiliate_id where a.user_id = auth.uid()),
    'payouts', coalesce((
      select jsonb_agg(jsonb_build_object('batchRef', b.short_ref, 'state', b.state, 'currency', b.currency,
        'amountMinor', s.amount::text, 'reference', case when b.state = 'paid' then b.transfer_reference end, 'paidAt', b.paid_at,
        'createdAt', b.created_at) order by b.created_at desc)
      from (select i.batch_id, sum(i.amount_minor) as amount from public.payout_items i
            join public.affiliate_accounts a on a.id = i.affiliate_id where a.user_id = auth.uid() and i.active group by i.batch_id) s
      join public.payout_batches b on b.id = s.batch_id
    ), '[]')
  );
$$;
revoke execute on function public.list_affiliate_payouts() from public, anon;
grant execute on function public.list_affiliate_payouts() to authenticated;

-- ------------------------------------------------------ admin: affiliates

create or replace function public.admin_review_affiliate(p_affiliate_id uuid, p_decision text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('affiliates.review');
  a public.affiliate_accounts;
  ag public.affiliate_agreement_versions := app_private.current_agreement();
  v_slug text;
begin
  if coalesce(trim(p_reason), '') = '' then
    perform app_private.fail('REASON_REQUIRED', 'A reason is required.');
  end if;
  select * into a from public.affiliate_accounts where id = p_affiliate_id for update;
  if not found then
    perform app_private.fail('NOT_FOUND', 'Affiliate not found.');
  end if;
  if p_decision = 'approve' then
    if ag.id is null then
      perform app_private.fail('NO_PUBLISHED_AGREEMENT', 'Publish the partner agreement before approving partners.');
    end if;
    if a.state not in ('applied', 'rejected') then
      perform app_private.fail('INVALID_STATE', 'Only pending or rejected applications can be approved.');
    end if;
    update public.affiliate_accounts set state = 'active', agreement_version_id = ag.id, reviewed_by = v_actor, reviewed_at = now(),
      rejection_reason = null where id = a.id;
    if not exists (select 1 from public.affiliate_links where affiliate_id = a.id and is_main) then
      v_slug := app_private.new_link_slug();
      insert into public.affiliate_links (affiliate_id, slug, destination, campaign, is_main) values (a.id, v_slug, '/', 'Main link', true);
    end if;
    perform app_private.notify(a.user_id, 'affiliate_approved:' || a.id || ':' || ag.version, 'affiliate', 'Partner application approved',
      'Your partner account is active. Copy your main link from the partner portal.', '/partner');
  elsif p_decision = 'reject' then
    update public.affiliate_accounts set state = 'rejected', rejection_reason = left(p_reason, 300), reviewed_by = v_actor, reviewed_at = now()
    where id = a.id and state = 'applied';
    perform app_private.notify(a.user_id, 'affiliate_rejected:' || a.id || ':' || extract(epoch from now())::bigint, 'affiliate',
      'Partner application not approved', left(p_reason, 300), '/partner');
  elsif p_decision = 'suspend' then
    update public.affiliate_accounts set state = 'suspended', reviewed_by = v_actor, reviewed_at = now() where id = a.id and state = 'active';
  elsif p_decision = 'reactivate' then
    update public.affiliate_accounts set state = 'active', reviewed_by = v_actor, reviewed_at = now() where id = a.id and state = 'suspended';
  else
    perform app_private.fail('INVALID_DECISION', 'Unknown decision.');
  end if;
  perform app_private.audit(v_actor, 'affiliates.review', 'affiliate.' || p_decision, 'affiliate', a.id::text, p_reason,
    jsonb_build_object('state', a.state), (select jsonb_build_object('state', state) from public.affiliate_accounts where id = a.id));
  return jsonb_build_object('affiliateId', a.id, 'state', (select state from public.affiliate_accounts where id = a.id));
end;
$$;
revoke execute on function public.admin_review_affiliate(uuid, text, text) from public, anon;
grant execute on function public.admin_review_affiliate(uuid, text, text) to authenticated;

create or replace function public.admin_verify_payout_destination(p_affiliate_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('payouts.prepare');
begin
  update app_private.payout_destinations set verified = true, verified_by = v_actor, verified_at = now() where affiliate_id = p_affiliate_id;
  if not found then
    perform app_private.fail('NOT_FOUND', 'No payout destination on file.');
  end if;
  perform app_private.audit(v_actor, 'payouts.prepare', 'payout_destination.verify', 'affiliate', p_affiliate_id::text, p_reason);
  return jsonb_build_object('verified', true);
end;
$$;
revoke execute on function public.admin_verify_payout_destination(uuid, text) from public, anon;
grant execute on function public.admin_verify_payout_destination(uuid, text) to authenticated;

-- Locks and allocates eligible entries once (§18.6). Affiliates qualify when their destination is verified,
-- unchanged for 48 hours, and the net available amount reaches the threshold for that currency.
create or replace function public.admin_prepare_payout_batch(p_currency text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('payouts.prepare');
  ag public.affiliate_agreement_versions := app_private.current_agreement();
  v_threshold bigint := coalesce((ag.payout_thresholds ->> p_currency)::bigint, null);
  v_batch uuid;
  r record;
  v_total bigint := 0;
  v_count int := 0;
begin
  if v_threshold is null then
    perform app_private.fail('NO_THRESHOLD', 'No payout threshold is defined for this currency.');
  end if;
  insert into public.payout_batches (currency, prepared_by) values (p_currency, v_actor) returning id into v_batch;
  for r in
    select c.affiliate_id,
           sum(c.amount_minor - c.reversed_minor) as gross,
           coalesce((select sum(x.amount_minor) from public.commission_adjustments x join public.commission_entries y on y.id = x.commission_id
                     where x.affiliate_id = c.affiliate_id and x.currency = p_currency and x.settled_batch_id is null and y.state = 'paid'), 0) as carry
    from public.commission_entries c
    join app_private.payout_destinations d on d.affiliate_id = c.affiliate_id and d.verified and d.changed_at < now() - interval '48 hours'
    join public.affiliate_accounts a on a.id = c.affiliate_id and a.state = 'active'
    where c.state = 'eligible' and c.currency = p_currency
    group by c.affiliate_id
  loop
    if r.gross + r.carry < v_threshold then
      continue;
    end if;
    insert into public.payout_items (batch_id, affiliate_id, commission_id, amount_minor, currency)
    select v_batch, c.affiliate_id, c.id, c.amount_minor - c.reversed_minor, c.currency
    from public.commission_entries c where c.affiliate_id = r.affiliate_id and c.state = 'eligible' and c.currency = p_currency
    for update of c;
    insert into public.payout_items (batch_id, affiliate_id, adjustment_id, amount_minor, currency)
    select v_batch, x.affiliate_id, x.id, x.amount_minor, x.currency
    from public.commission_adjustments x join public.commission_entries y on y.id = x.commission_id
    where x.affiliate_id = r.affiliate_id and x.currency = p_currency and x.settled_batch_id is null and y.state = 'paid';
    update public.commission_entries set state = 'reserved_for_payout', payout_batch_id = v_batch
    where affiliate_id = r.affiliate_id and state = 'eligible' and currency = p_currency;
    update public.commission_adjustments x set settled_batch_id = v_batch
    from public.commission_entries y
    where y.id = x.commission_id and x.affiliate_id = r.affiliate_id and x.currency = p_currency and x.settled_batch_id is null and y.state = 'paid';
    v_total := v_total + r.gross + r.carry;
    v_count := v_count + 1;
  end loop;
  if v_count = 0 then
    delete from public.payout_batches where id = v_batch;
    return jsonb_build_object('batchId', null, 'affiliates', 0, 'message', 'No affiliate has an eligible balance above the threshold.');
  end if;
  update public.payout_batches set total_minor = v_total where id = v_batch;
  perform app_private.audit(v_actor, 'payouts.prepare', 'payout_batch.prepare', 'payout_batch', v_batch::text, 'prepared',
    null, jsonb_build_object('currency', p_currency, 'totalMinor', v_total, 'affiliates', v_count));
  return jsonb_build_object('batchId', v_batch, 'affiliates', v_count, 'totalMinor', v_total::text);
end;
$$;
revoke execute on function public.admin_prepare_payout_batch(text) from public, anon;
grant execute on function public.admin_prepare_payout_batch(text) to authenticated;

-- Review → transfer states. Paid only with a transfer reference and evidence; release only on confirmed failure
-- or cancellation before transmission. An unknown outcome keeps everything reserved (§18.6).
create or replace function public.admin_payout_batch_action(p_batch_id uuid, p_action text, p_reference text default null,
  p_evidence text default null, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('payouts.approve');
  b public.payout_batches;
  v_owner boolean := app_private.has_capability(auth.uid(), 'staff.manage');
begin
  select * into b from public.payout_batches where id = p_batch_id for update;
  if not found then
    perform app_private.fail('NOT_FOUND', 'Batch not found.');
  end if;
  if p_action = 'review' then
    if b.state <> 'draft' then perform app_private.fail('INVALID_STATE', 'Only draft batches can be reviewed.'); end if;
    if b.prepared_by = v_actor and not (v_owner and coalesce(trim(p_reason), '') <> '') then
      perform app_private.fail('SEPARATION_OF_DUTIES', 'A different person must review this batch, or the owner must record a single-owner exception.');
    end if;
    update public.payout_batches set state = 'reviewed', approved_by = v_actor,
      single_owner_exception = case when b.prepared_by = v_actor then left(p_reason, 300) end where id = b.id;
  elsif p_action = 'submitting' then
    if b.state <> 'reviewed' then perform app_private.fail('INVALID_STATE', 'Review the batch first.'); end if;
    update public.payout_batches set state = 'submitting', transfer_reference = coalesce(p_reference, transfer_reference) where id = b.id;
  elsif p_action = 'unknown' then
    if b.state not in ('submitting') then perform app_private.fail('INVALID_STATE', 'Only a submitting batch can become unknown.'); end if;
    update public.payout_batches set state = 'submission_unknown' where id = b.id;
  elsif p_action = 'paid' then
    if b.state not in ('reviewed', 'submitting', 'submission_unknown') then perform app_private.fail('INVALID_STATE', 'This batch cannot be marked paid.'); end if;
    if coalesce(trim(p_reference), '') = '' or coalesce(trim(p_evidence), '') = '' then
      perform app_private.fail('EVIDENCE_REQUIRED', 'A transfer reference and evidence are required to mark a batch paid.');
    end if;
    update public.payout_batches set state = 'paid', transfer_reference = p_reference, evidence = left(p_evidence, 500), paid_at = now() where id = b.id;
    update public.commission_entries set state = 'paid' where payout_batch_id = b.id and state = 'reserved_for_payout';
    perform app_private.notify(a.user_id, 'payout_paid:' || b.id || ':' || a.id, 'affiliate', 'Payout sent',
      'Batch ' || b.short_ref || ' was paid. Reference: ' || left(p_reference, 60), '/partner/payouts')
    from public.affiliate_accounts a where a.id in (select affiliate_id from public.payout_items where batch_id = b.id and active);
  elsif p_action in ('failed', 'cancel') then
    if p_action = 'failed' and b.state not in ('submitting', 'submission_unknown') then
      perform app_private.fail('INVALID_STATE', 'Only a submitted batch can be confirmed as failed.');
    end if;
    if p_action = 'cancel' and b.state not in ('draft', 'reviewed') then
      perform app_private.fail('INVALID_STATE', 'Only a batch that was not transmitted can be cancelled.');
    end if;
    if coalesce(trim(p_reason), '') = '' then perform app_private.fail('REASON_REQUIRED', 'A reason is required.'); end if;
    update public.payout_batches set state = case when p_action = 'failed' then 'failed' else 'cancelled' end where id = b.id;
    update public.payout_items set active = false where batch_id = b.id;
    update public.commission_entries set state = 'eligible', payout_batch_id = null where payout_batch_id = b.id and state = 'reserved_for_payout';
    update public.commission_adjustments set settled_batch_id = null where settled_batch_id = b.id;
  else
    perform app_private.fail('INVALID_ACTION', 'Unknown action.');
  end if;
  perform app_private.audit(v_actor, 'payouts.approve', 'payout_batch.' || p_action, 'payout_batch', b.id::text, coalesce(p_reason, p_action),
    jsonb_build_object('state', b.state), (select jsonb_build_object('state', state, 'reference', transfer_reference) from public.payout_batches where id = b.id));
  return jsonb_build_object('batchId', b.id, 'state', (select state from public.payout_batches where id = b.id));
end;
$$;
revoke execute on function public.admin_payout_batch_action(uuid, text, text, text, text) from public, anon;
grant execute on function public.admin_payout_batch_action(uuid, text, text, text, text) to authenticated;
