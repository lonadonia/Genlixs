-- Genlixs 03 · Customer credit wallet (§10). Genlixs credits are product units; KIE credits are supplier
-- consumption and never appear here. Every movement is an append-only ledger row; wallet totals are a
-- projection of lot counters, which obey:
--   granted = available + reserved + spent + expired + revoked   (all non-negative)

create table public.wallet_accounts (
  user_id uuid primary key references public.profiles (user_id),
  available_units bigint not null default 0 check (available_units >= 0),
  reserved_units bigint not null default 0 check (reserved_units >= 0),
  spent_units bigint not null default 0 check (spent_units >= 0),
  expired_units bigint not null default 0 check (expired_units >= 0),
  revoked_units bigint not null default 0 check (revoked_units >= 0),
  restricted boolean not null default false,
  restriction_reason text,
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table public.credit_lots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id),
  source_kind text not null check (source_kind in ('purchase', 'subscription', 'promo', 'admin_adjustment')),
  -- Unique business source, e.g. "payment:<gateway>:<payment id>"; a retry can never grant twice.
  source_key text not null unique,
  funding_ref text,
  granted_units bigint not null check (granted_units > 0),
  available_units bigint not null default 0,
  reserved_units bigint not null default 0,
  spent_units bigint not null default 0,
  expired_units bigint not null default 0,
  revoked_units bigint not null default 0,
  expires_at timestamptz,
  -- Refund pending or dispute: units cannot be reserved while restricted.
  restricted boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    granted_units >= 0 and available_units >= 0 and reserved_units >= 0
    and spent_units >= 0 and expired_units >= 0 and revoked_units >= 0
    and granted_units = available_units + reserved_units + spent_units + expired_units + revoked_units
  )
);
create index credit_lots_spend_order_idx on public.credit_lots (user_id, expires_at nulls last, created_at, id);
create index credit_lots_expiry_idx on public.credit_lots (expires_at) where available_units > 0 and expires_at is not null;
create trigger credit_lots_touch before update on public.credit_lots
  for each row execute function app_private.touch_updated_at();

create table public.credit_reservations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null unique,
  user_id uuid not null references public.profiles (user_id),
  units bigint not null check (units > 0),
  state text not null default 'open' check (state in ('open', 'captured', 'released')),
  settlement_reason text,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index credit_reservations_open_idx on public.credit_reservations (user_id) where state = 'open';

create table app_private.credit_reservation_allocations (
  reservation_id uuid not null references public.credit_reservations (id),
  lot_id uuid not null references public.credit_lots (id),
  units bigint not null check (units > 0),
  disposition text not null default 'open' check (disposition in ('open', 'captured', 'released', 'expired')),
  primary key (reservation_id, lot_id)
);

create table public.credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id),
  lot_id uuid references public.credit_lots (id),
  event_type text not null check (event_type in ('grant', 'reserve', 'capture', 'release', 'expire', 'revoke', 'refund_adjustment', 'admin_adjustment')),
  -- One business event (e.g. "reserve:<job>") can touch several lots; the statement groups by it.
  event_key text not null,
  idempotency_key text not null unique,
  d_available bigint not null default 0,
  d_reserved bigint not null default 0,
  d_spent bigint not null default 0,
  d_expired bigint not null default 0,
  d_revoked bigint not null default 0,
  job_id uuid,
  reservation_id uuid,
  source_ref text,
  actor_id uuid,
  note text,
  created_at timestamptz not null default now()
);
create index credit_ledger_owner_idx on public.credit_ledger (user_id, created_at desc);
create index credit_ledger_event_idx on public.credit_ledger (event_key);
create trigger credit_ledger_append_only before update or delete on public.credit_ledger
  for each row execute function app_private.forbid_mutation();

alter table public.wallet_accounts enable row level security;
alter table public.credit_lots enable row level security;
alter table public.credit_reservations enable row level security;
alter table public.credit_ledger enable row level security;

create policy wallet_owner_read on public.wallet_accounts for select to authenticated using ((select auth.uid()) = user_id);
create policy lots_owner_read on public.credit_lots for select to authenticated using ((select auth.uid()) = user_id);
create policy reservations_owner_read on public.credit_reservations for select to authenticated using ((select auth.uid()) = user_id);
create policy ledger_owner_read on public.credit_ledger for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.wallet_accounts, public.credit_lots, public.credit_reservations, public.credit_ledger from anon, authenticated;
grant select on public.wallet_accounts, public.credit_lots, public.credit_reservations, public.credit_ledger to authenticated;

-- ------------------------------------------------------------- internals

create or replace function app_private.lock_wallet(p_user uuid)
returns public.wallet_accounts
language plpgsql
set search_path = ''
as $$
declare
  v public.wallet_accounts;
begin
  select * into v from public.wallet_accounts where user_id = p_user for update;
  if not found then
    perform app_private.fail('WALLET_NOT_FOUND', 'No wallet exists for this account.');
  end if;
  return v;
end;
$$;

create or replace function app_private.wallet_apply(
  p_user uuid, p_available bigint, p_reserved bigint, p_spent bigint, p_expired bigint, p_revoked bigint
) returns void
language sql
set search_path = ''
as $$
  update public.wallet_accounts
  set available_units = available_units + p_available,
      reserved_units = reserved_units + p_reserved,
      spent_units = spent_units + p_spent,
      expired_units = expired_units + p_expired,
      revoked_units = revoked_units + p_revoked,
      version = version + 1,
      updated_at = now()
  where user_id = p_user;
$$;

-- Moves unreserved units of due lots to expired. Caller holds the wallet lock.
create or replace function app_private.expire_due_lots(p_user uuid)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  r record;
  v_total bigint := 0;
begin
  for r in
    select id, available_units from public.credit_lots
    where user_id = p_user and expires_at is not null and expires_at <= now() and available_units > 0
    order by id for update
  loop
    update public.credit_lots set available_units = 0, expired_units = expired_units + r.available_units where id = r.id;
    insert into public.credit_ledger (user_id, lot_id, event_type, event_key, idempotency_key, d_available, d_expired, note)
    values (p_user, r.id, 'expire', 'expire:' || r.id, 'expire:' || r.id || ':' || r.available_units || ':' || extract(epoch from now())::bigint,
            -r.available_units, r.available_units, 'Unused credits expired');
    v_total := v_total + r.available_units;
  end loop;
  if v_total > 0 then
    perform app_private.wallet_apply(p_user, -v_total, 0, 0, v_total, 0);
  end if;
  return v_total;
end;
$$;

-- Idempotent grant: the same source_key returns the existing lot and never grants twice.
create or replace function app_private.grant_lot(
  p_user uuid, p_kind text, p_source_key text, p_units bigint, p_expires_at timestamptz,
  p_funding_ref text, p_note text, p_actor uuid default null
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_lot uuid;
begin
  if p_units is null or p_units <= 0 then
    perform app_private.fail('INVALID_AMOUNT', 'A grant must be a positive number of credits.');
  end if;
  perform app_private.lock_wallet(p_user);
  select id into v_lot from public.credit_lots where source_key = p_source_key;
  if found then
    return v_lot;
  end if;
  insert into public.credit_lots (user_id, source_kind, source_key, funding_ref, granted_units, available_units, expires_at, note)
  values (p_user, p_kind, p_source_key, p_funding_ref, p_units, p_units, p_expires_at, p_note)
  returning id into v_lot;
  insert into public.credit_ledger (user_id, lot_id, event_type, event_key, idempotency_key, d_available, source_ref, actor_id, note)
  values (p_user, v_lot, 'grant', 'grant:' || p_source_key, 'grant:' || p_source_key, p_units, p_funding_ref, p_actor, p_note);
  perform app_private.wallet_apply(p_user, p_units, 0, 0, 0, 0);
  return v_lot;
end;
$$;

-- Spendable units: unrestricted, unexpired lots. Read-only (no expiry side effects).
create or replace function app_private.spendable_units(p_user uuid)
returns bigint
language sql
stable
set search_path = ''
as $$
  select coalesce(sum(l.available_units), 0)::bigint
  from public.credit_lots l
  join public.wallet_accounts w on w.user_id = l.user_id
  where l.user_id = p_user and not l.restricted and not w.restricted
    and (l.expires_at is null or l.expires_at > now());
$$;

-- Reserves units for one job across lots: earliest-expiring first, then non-expiring purchases (§10.2).
-- Caller holds the wallet lock and has already expired due lots.
create or replace function app_private.reserve_units(p_user uuid, p_job uuid, p_units bigint)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_res uuid;
  v_need bigint := p_units;
  v_take bigint;
  r record;
  v_spendable bigint;
begin
  v_spendable := app_private.spendable_units(p_user);
  if v_spendable < p_units then
    perform app_private.fail('INSUFFICIENT_CREDITS', 'You need more credits to start this generation.',
      jsonb_build_object('requiredUnits', p_units::text, 'availableUnits', v_spendable::text));
  end if;

  insert into public.credit_reservations (job_id, user_id, units) values (p_job, p_user, p_units) returning id into v_res;

  for r in
    select id, available_units from public.credit_lots
    where user_id = p_user and not restricted and available_units > 0 and (expires_at is null or expires_at > now())
    order by expires_at nulls last, created_at, id
    for update
  loop
    exit when v_need = 0;
    v_take := least(v_need, r.available_units);
    update public.credit_lots set available_units = available_units - v_take, reserved_units = reserved_units + v_take where id = r.id;
    insert into app_private.credit_reservation_allocations (reservation_id, lot_id, units) values (v_res, r.id, v_take);
    insert into public.credit_ledger (user_id, lot_id, event_type, event_key, idempotency_key, d_available, d_reserved, job_id, reservation_id, note)
    values (p_user, r.id, 'reserve', 'reserve:' || p_job, 'reserve:' || p_job || ':' || r.id, -v_take, v_take, p_job, v_res, 'Reserved for a generation');
    v_need := v_need - v_take;
  end loop;

  if v_need <> 0 then
    perform app_private.fail('INSUFFICIENT_CREDITS', 'You need more credits to start this generation.');
  end if;
  perform app_private.wallet_apply(p_user, -p_units, p_units, 0, 0, 0);
  return v_res;
end;
$$;

-- Exactly one terminal disposition per reservation. Returns 'captured', or the existing state when the
-- reservation was already settled (callers decide whether that is acceptable).
create or replace function app_private.capture_reservation(p_job uuid, p_reason text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_res public.credit_reservations;
  a record;
begin
  select * into v_res from public.credit_reservations where job_id = p_job;
  if not found then
    perform app_private.fail('RESERVATION_NOT_FOUND', 'No credit reservation exists for this job.');
  end if;
  perform app_private.lock_wallet(v_res.user_id);
  select * into v_res from public.credit_reservations where id = v_res.id for update;
  if v_res.state <> 'open' then
    return v_res.state;
  end if;
  for a in select * from app_private.credit_reservation_allocations where reservation_id = v_res.id order by lot_id for update loop
    update public.credit_lots set reserved_units = reserved_units - a.units, spent_units = spent_units + a.units where id = a.lot_id;
    update app_private.credit_reservation_allocations set disposition = 'captured' where reservation_id = a.reservation_id and lot_id = a.lot_id;
    insert into public.credit_ledger (user_id, lot_id, event_type, event_key, idempotency_key, d_reserved, d_spent, job_id, reservation_id, note)
    values (v_res.user_id, a.lot_id, 'capture', 'capture:' || p_job, 'capture:' || p_job || ':' || a.lot_id, -a.units, a.units, p_job, v_res.id, p_reason);
  end loop;
  update public.credit_reservations set state = 'captured', settled_at = now(), settlement_reason = p_reason where id = v_res.id;
  perform app_private.wallet_apply(v_res.user_id, 0, -v_res.units, v_res.units, 0, 0);
  return 'captured';
end;
$$;

-- Releases a reservation once. Units from lots that expired meanwhile become expired, not available (§10.3).
create or replace function app_private.release_reservation(p_job uuid, p_reason text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_res public.credit_reservations;
  a record;
  v_expired boolean;
  v_back bigint := 0;
  v_exp bigint := 0;
begin
  select * into v_res from public.credit_reservations where job_id = p_job;
  if not found then
    perform app_private.fail('RESERVATION_NOT_FOUND', 'No credit reservation exists for this job.');
  end if;
  perform app_private.lock_wallet(v_res.user_id);
  select * into v_res from public.credit_reservations where id = v_res.id for update;
  if v_res.state <> 'open' then
    return v_res.state;
  end if;
  for a in
    select x.*, l.expires_at from app_private.credit_reservation_allocations x
    join public.credit_lots l on l.id = x.lot_id
    where x.reservation_id = v_res.id order by x.lot_id for update of x
  loop
    v_expired := a.expires_at is not null and a.expires_at <= now();
    if v_expired then
      update public.credit_lots set reserved_units = reserved_units - a.units, expired_units = expired_units + a.units where id = a.lot_id;
      insert into public.credit_ledger (user_id, lot_id, event_type, event_key, idempotency_key, d_reserved, d_expired, job_id, reservation_id, note)
      values (v_res.user_id, a.lot_id, 'release', 'release:' || p_job, 'release:' || p_job || ':' || a.lot_id, -a.units, a.units, p_job, v_res.id,
              p_reason || ' (lot expired while reserved)');
      v_exp := v_exp + a.units;
    else
      update public.credit_lots set reserved_units = reserved_units - a.units, available_units = available_units + a.units where id = a.lot_id;
      insert into public.credit_ledger (user_id, lot_id, event_type, event_key, idempotency_key, d_available, d_reserved, job_id, reservation_id, note)
      values (v_res.user_id, a.lot_id, 'release', 'release:' || p_job, 'release:' || p_job || ':' || a.lot_id, a.units, -a.units, p_job, v_res.id, p_reason);
      v_back := v_back + a.units;
    end if;
    update app_private.credit_reservation_allocations set disposition = case when v_expired then 'expired' else 'released' end
    where reservation_id = a.reservation_id and lot_id = a.lot_id;
  end loop;
  update public.credit_reservations set state = 'released', settled_at = now(), settlement_reason = p_reason where id = v_res.id;
  perform app_private.wallet_apply(v_res.user_id, v_back, -v_res.units, 0, v_exp, 0);
  return 'released';
end;
$$;

-- --------------------------------------------------------------- reads

create or replace function public.get_wallet()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'availableUnits', app_private.spendable_units(w.user_id)::text,
    'reservedUnits', w.reserved_units::text,
    'spentUnits', w.spent_units::text,
    'restricted', w.restricted,
    'nearestExpiry', (
      select jsonb_build_object('at', l.expires_at, 'units', l.available_units::text)
      from public.credit_lots l
      where l.user_id = w.user_id and l.available_units > 0 and l.expires_at > now()
      order by l.expires_at limit 1
    ),
    'lots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'kind', l.source_kind, 'grantedUnits', l.granted_units::text, 'availableUnits', l.available_units::text,
        'reservedUnits', l.reserved_units::text, 'spentUnits', l.spent_units::text, 'expiredUnits', l.expired_units::text,
        'revokedUnits', l.revoked_units::text, 'expiresAt', l.expires_at, 'restricted', l.restricted, 'createdAt', l.created_at
      ) order by l.created_at desc)
      from public.credit_lots l where l.user_id = w.user_id
    ), '[]'),
    'periodSpentUnits', (
      select coalesce(sum(c.d_spent), 0)::text from public.credit_ledger c
      where c.user_id = w.user_id and c.event_type = 'capture' and c.created_at >= date_trunc('month', now())
    )
  )
  from public.wallet_accounts w
  where w.user_id = (select auth.uid());
$$;
revoke execute on function public.get_wallet() from public, anon;
grant execute on function public.get_wallet() to authenticated;

-- ----------------------------------------------------------- signup

create or replace function app_private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, email) values (new.id, new.email) on conflict (user_id) do nothing;
  insert into public.wallet_accounts (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app_private.handle_new_user();

create or replace function app_private.handle_user_updated()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_units bigint := coalesce((app_private.setting('signup_promo_units'))::text, '0')::bigint;
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where user_id = new.id;
  end if;
  -- Optional trial credits, once per verified account (§16, §22.1). Off unless the owner sets units > 0.
  if old.email_confirmed_at is null and new.email_confirmed_at is not null and v_units > 0 then
    perform app_private.grant_lot(new.id, 'promo', 'promo:signup:' || new.id, v_units,
      now() + make_interval(days => coalesce((app_private.setting('promo_credit_days'))::text, '7')::int),
      null, 'Welcome credits');
  end if;
  return new;
end;
$$;

create trigger on_auth_user_updated
  after update on auth.users
  for each row execute function app_private.handle_user_updated();

insert into app_private.settings (key, value, description)
values ('signup_promo_units', '0', 'Trial credits granted once after email verification (0 = off; proposed policy)')
on conflict (key) do nothing;

-- Customers update only allowlisted profile fields.
create or replace function public.update_my_profile(p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v public.profiles;
begin
  if v_uid is null then perform app_private.fail('UNAUTHENTICATED', 'Sign in to continue.'); end if;
  update public.profiles set
    display_name = case when p_patch ? 'displayName' then nullif(trim(p_patch ->> 'displayName'), '') else display_name end,
    locale = case when p_patch ? 'locale' then p_patch ->> 'locale' else locale end,
    marketing_opt_in = case when p_patch ? 'marketingOptIn' then (p_patch ->> 'marketingOptIn')::boolean else marketing_opt_in end,
    email_notifications = case when p_patch ? 'emailNotifications' then (p_patch ->> 'emailNotifications')::boolean else email_notifications end,
    goal = case when p_patch ? 'goal' then p_patch ->> 'goal' else goal end
  where user_id = v_uid
  returning * into v;
  return jsonb_build_object('displayName', v.display_name, 'locale', v.locale, 'marketingOptIn', v.marketing_opt_in,
    'emailNotifications', v.email_notifications, 'goal', v.goal);
end;
$$;
revoke execute on function public.update_my_profile(jsonb) from public, anon;
grant execute on function public.update_my_profile(jsonb) to authenticated;
