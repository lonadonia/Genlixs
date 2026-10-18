revoke execute on function public.record_provider_check(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_provider_check(uuid, jsonb) to service_role;

-- Account-level usage reported by the provider (it may include other applications using the same account).
create or replace function public.record_provider_usage(p_account_id uuid, p_report jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into app_private.provider_usage_reports (provider_account_id, scope, period_start, period_end, timezone, amount_usd, native_amount, native_unit, requests)
  values (p_account_id, case when p_report ->> 'scope' = 'key' then 'key' else 'account' end, (p_report ->> 'from')::timestamptz,
    (p_report ->> 'to')::timestamptz, coalesce(p_report ->> 'timezone', 'UTC'), app_private.num(p_report -> 'amountUsd'),
    app_private.num(p_report -> 'nativeAmount'), p_report ->> 'nativeUnit', (p_report ->> 'requests')::int);
end;
$$;
revoke execute on function public.record_provider_usage(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_provider_usage(uuid, jsonb) to service_role;

-- Accounts the periodic balance read should refresh now (bounded: due accounts with a key, at most p_limit).
create or replace function public.worker_balance_targets(p_limit int default 6)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('accountId', a.id, 'provider', a.provider, 'credentialVersion', a.credential_version,
      'credentialSource', case when a.credential_version > 0 then 'vault' else 'environment' end, 'secretRef', a.secret_ref)), '[]'::jsonb)
  from (select * from app_private.provider_accounts
        -- KIE on its environment key keeps its own periodic reading (record_provider_balance_result).
        where provider <> 'fake' and credential_version > 0
          and (last_balance_attempt_at is null or last_balance_attempt_at < now() - interval '10 minutes')
        order by last_balance_attempt_at nulls first limit greatest(1, least(p_limit, 20))) a;
$$;
revoke execute on function public.worker_balance_targets(int) from public, anon, authenticated;
grant execute on function public.worker_balance_targets(int) to service_role;

-- The existing KIE reading (environment key) now also records its unit and source, like the other providers.
create or replace function public.record_provider_balance_result(p_ok boolean, p_credits numeric, p_error text, p_source text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  acc app_private.provider_accounts;
begin
  select * into acc from app_private.provider_accounts where provider = 'kie' and label = 'primary' for update;
  insert into app_private.provider_balance_snapshots (provider_account_id, ok, credits, error_code, source, unit, scope, kind)
  values (acc.id, p_ok, case when p_ok then p_credits end, case when not p_ok then left(coalesce(p_error, 'UNKNOWN'), 120) end,
    case when p_source in ('admin', 'auto', 'worker') then p_source else 'worker' end, 'kie_credit', 'wallet', 'api');
  if p_ok then
    update app_private.provider_accounts set last_balance = p_credits, balance_available = null, balance_held = null, balance_unit = 'kie_credit',
      balance_scope = 'wallet', balance_source = 'api', key_quota_unlimited = null, last_balance_at = now(), last_balance_error = null,
      last_balance_error_at = null
    where id = acc.id;
  else
    update app_private.provider_accounts set last_balance_error = left(coalesce(p_error, 'UNKNOWN'), 120), last_balance_error_at = now() where id = acc.id;
  end if;
end;
$$;

-- ====================================================================== admin

-- Masked account view shared by the Admin reads. Never contains a key; balances keep NULL for unknown.
create or replace function app_private.provider_account_json(a app_private.provider_accounts)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', a.id, 'provider', a.provider, 'label', a.label, 'name', coalesce(a.display_name, a.provider), 'enabled', a.enabled, 'paused', a.paused,
    'sortOrder', a.sort_order,
    'credential', jsonb_build_object(
      'source', case when a.credential_version > 0 then 'vault' when a.secret_ref = 'KIE_API_KEY' then 'environment' else 'none' end,
      'version', a.credential_version, 'hint', a.key_hint, 'setAt', a.key_set_at,
      'environmentName', case when a.credential_version = 0 and a.secret_ref = 'KIE_API_KEY' then a.secret_ref end),
    'connection', jsonb_build_object('state', a.connection_state, 'checkedAt', a.connection_checked_at, 'message', a.connection_message),
    'nativeUnit', a.native_unit,
    'funding', jsonb_build_object('feeBps', a.funding_fee_bps, 'bonusBps', a.funding_bonus_bps, 'note', a.funding_note, 'version', a.funding_version),
    'dailySpendCapUsd', a.daily_spend_cap_usd, 'walletGroup', a.wallet_group, 'lowBalanceThreshold', a.low_balance_threshold,
    'balance', jsonb_build_object(
      'total', a.last_balance, 'available', a.balance_available, 'held', a.balance_held, 'unit', coalesce(a.balance_unit, a.native_unit),
      'scope', a.balance_scope, 'source', a.balance_source, 'unlimitedKeyQuota', a.key_quota_unlimited, 'note', a.balance_note,
      'observedAt', a.last_balance_at,
      'ageSeconds', case when a.last_balance_at is not null then floor(extract(epoch from now() - a.last_balance_at))::bigint end,
      'stale', a.last_balance_at is null or a.last_balance_at < now() - make_interval(mins => coalesce((app_private.setting('provider_balance_stale_minutes') #>> '{}')::int, 60)),
      'lastAttemptAt', a.last_balance_attempt_at, 'lastError', a.last_balance_error, 'lastErrorAt', a.last_balance_error_at,
      'usdApprox', case when coalesce(a.balance_available, a.last_balance) is not null and (app_private.cost_unit(coalesce(a.balance_unit, a.native_unit))).units_per_usd is not null
        then round(coalesce(a.balance_available, a.last_balance) / (app_private.cost_unit(coalesce(a.balance_unit, a.native_unit))).units_per_usd, 2) end,
      'low', coalesce(a.balance_available, a.last_balance) is not null and a.low_balance_threshold is not null
        and coalesce(a.balance_available, a.last_balance) < a.low_balance_threshold),
    'circuit', jsonb_build_object('blockedUntil', a.submit_blocked_until, 'code', a.submit_block_code, 'since', a.submit_block_since));
$$;

-- ------------------------------------------------------------------ credentials

-- Saves a new key version in Vault (owner). Only a masked hint is kept outside Vault and returned. The previous
-- version stays readable for in-flight jobs and is deleted once none needs it.
create or replace function public.admin_set_provider_key(p_account_id uuid, p_secret text, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('provider.manage');
  acc app_private.provider_accounts;
  v_version int;
  v_secret_id uuid;
  v_hint text;
begin
  if p_secret is null or char_length(p_secret) not between 8 and 512 or p_secret ~ '[[:space:][:cntrl:]]' then
    perform app_private.fail('INVALID_INPUT', 'Paste the API key exactly as the provider shows it (8–512 characters, no spaces).');
  end if;
  select * into acc from app_private.provider_accounts where id = p_account_id for update;
  if not found or acc.provider = 'fake' then
    perform app_private.fail('NOT_FOUND', 'Provider account not found.');
  end if;
  select greatest(acc.credential_version, coalesce(max(version), 0)) + 1 into v_version
  from app_private.provider_credentials where provider_account_id = acc.id;
  v_hint := '••••' || right(p_secret, 4);
  v_secret_id := vault.create_secret(p_secret, 'genlixs_provider_' || acc.id || '_v' || v_version,
    'Genlixs supplier key: ' || acc.provider || ' / ' || acc.label || ', version ' || v_version);
  insert into app_private.provider_credentials (provider_account_id, version, secret_id, key_hint, created_by)
  values (acc.id, v_version, v_secret_id, v_hint, v_actor);
  update app_private.provider_credentials set retired_at = now()
  where provider_account_id = acc.id and version < v_version and retired_at is null;
  update app_private.provider_accounts set credential_version = v_version, key_hint = v_hint, key_set_at = now(), key_set_by = v_actor,
    connection_state = 'untested', connection_checked_at = null, connection_message = null
  where id = acc.id;
  perform app_private.purge_retired_credentials(acc.id);
  perform app_private.audit(v_actor, 'provider.manage', 'provider.key_saved', 'provider_account', acc.id::text,
    coalesce(nullif(trim(p_reason), ''), 'Saved a new API key for ' || coalesce(acc.display_name, acc.provider)),
    jsonb_build_object('keyVersion', acc.credential_version, 'keyHint', acc.key_hint),
    jsonb_build_object('keyVersion', v_version, 'keyHint', v_hint));
  return jsonb_build_object('accountId', acc.id, 'keyVersion', v_version, 'keyHint', v_hint, 'keySetAt', now(), 'connection', 'untested');
end;
$$;
revoke execute on function public.admin_set_provider_key(uuid, text, text) from public, anon;
grant execute on function public.admin_set_provider_key(uuid, text, text) to authenticated;

-- Removes the Admin key (owner). New jobs stop using this account; in-flight jobs keep their key version until done.
-- KIE then falls back to its environment secret, if one is set.
create or replace function public.admin_remove_provider_key(p_account_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('provider.manage');
  acc app_private.provider_accounts;
begin
  select * into acc from app_private.provider_accounts where id = p_account_id for update;
  if not found or acc.provider = 'fake' then
    perform app_private.fail('NOT_FOUND', 'Provider account not found.');
  end if;
  update app_private.provider_credentials set retired_at = now() where provider_account_id = acc.id and retired_at is null;
  update app_private.provider_accounts set credential_version = 0, key_hint = null, key_set_at = now(), key_set_by = v_actor,
    connection_state = 'untested', connection_checked_at = null, connection_message = null
  where id = acc.id;
  perform app_private.purge_retired_credentials(acc.id);
  perform app_private.audit(v_actor, 'provider.manage', 'provider.key_removed', 'provider_account', acc.id::text,
    coalesce(nullif(trim(p_reason), ''), 'Removed the API key'), jsonb_build_object('keyVersion', acc.credential_version, 'keyHint', acc.key_hint), null);
  return jsonb_build_object('accountId', acc.id, 'keyVersion', 0);
end;
$$;
revoke execute on function public.admin_remove_provider_key(uuid, text) from public, anon;
grant execute on function public.admin_remove_provider_key(uuid, text) to authenticated;

-- Grants one connection test or balance read (owner for a test, provider.read for a refresh), at most one per account
-- per interval across all staff. Returns what the server needs to fetch the key itself; never the key.
create or replace function public.admin_begin_provider_check(p_account_id uuid, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability(case when p_kind = 'test' then 'provider.manage' else 'provider.read' end);
  acc app_private.provider_accounts;
  v_min int := coalesce((app_private.setting('provider_check_min_seconds') #>> '{}')::int, 10);
begin
  if p_kind not in ('test', 'refresh') then
    perform app_private.fail('INVALID_INPUT', 'Unknown check.');
  end if;
  select * into acc from app_private.provider_accounts where id = p_account_id for update;
  if not found or acc.provider = 'fake' then
    perform app_private.fail('NOT_FOUND', 'Provider account not found.');
  end if;
  if acc.credential_version = 0 and acc.secret_ref <> 'KIE_API_KEY' then
    perform app_private.fail('CREDENTIALS_MISSING', 'Add an API key for this provider first.');
  end if;
  if acc.last_balance_attempt_at > now() - make_interval(secs => v_min) then
    return jsonb_build_object('proceed', false, 'minIntervalSeconds', v_min);
  end if;
  update app_private.provider_accounts set last_balance_attempt_at = now() where id = acc.id;
  if p_kind = 'test' then
    perform app_private.audit(v_actor, 'provider.manage', 'provider.connection_tested', 'provider_account', acc.id::text,
      'Tested the connection (read-only balance call)', null, null);
  end if;
  return jsonb_build_object('proceed', true, 'accountId', acc.id, 'provider', acc.provider, 'credentialVersion', acc.credential_version,
    'credentialSource', case when acc.credential_version > 0 then 'vault' else 'environment' end, 'secretRef', acc.secret_ref);
end;
$$;
revoke execute on function public.admin_begin_provider_check(uuid, text) from public, anon;
grant execute on function public.admin_begin_provider_check(uuid, text) to authenticated;

-- Dated manual balance for a provider without a balance endpoint (or to note an external top-up). Clearly marked as
-- manual; never mixed with API reads.
create or replace function public.admin_record_manual_balance(p_account_id uuid, p_total text, p_unit text, p_observed_at timestamptz, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('provider.manage');
  acc app_private.provider_accounts;
  v_total numeric;
begin
  if p_total is null or p_total !~ '^\s*-?\d{1,12}(\.\d{1,8})?\s*$' then
    perform app_private.fail('INVALID_INPUT', 'Enter the balance as a number.');
  end if;
  v_total := trim(p_total)::numeric;
  if (app_private.cost_unit(p_unit)).id is null then
    perform app_private.fail('INVALID_INPUT', 'Unknown unit.');
  end if;
  if p_observed_at is null or p_observed_at > now() + interval '5 minutes' or p_observed_at < now() - interval '90 days' then
    perform app_private.fail('INVALID_INPUT', 'Enter when the balance was seen (within the last 90 days).');
  end if;
  if p_note is null or char_length(trim(p_note)) < 3 then
    perform app_private.fail('INVALID_INPUT', 'Say where the balance comes from.');
  end if;
  select * into acc from app_private.provider_accounts where id = p_account_id for update;
  if not found or acc.provider = 'fake' then
    perform app_private.fail('NOT_FOUND', 'Provider account not found.');
  end if;
  insert into app_private.provider_balance_snapshots (provider_account_id, ok, credits, unit, scope, kind, source, note, entered_by, observed_at)
  values (acc.id, true, v_total, p_unit, 'wallet', 'manual', 'manual', left(p_note, 300), v_actor, p_observed_at);
  -- A manual figure replaces the shown balance only when it is newer than the last API read.
  update app_private.provider_accounts set last_balance = v_total, balance_available = null, balance_held = null, balance_unit = p_unit,
    balance_scope = 'wallet', balance_source = 'manual', key_quota_unlimited = null, balance_note = left(p_note, 300), last_balance_at = p_observed_at
  where id = acc.id and (last_balance_at is null or last_balance_at <= p_observed_at);
  perform app_private.audit(v_actor, 'provider.manage', 'provider.manual_balance', 'provider_account', acc.id::text, left(p_note, 300),
    null, jsonb_build_object('total', v_total, 'unit', p_unit, 'observedAt', p_observed_at));
  return app_private.provider_account_json((select a from app_private.provider_accounts a where a.id = acc.id));
end;
$$;
revoke execute on function public.admin_record_manual_balance(uuid, text, text, timestamptz, text) from public, anon;
grant execute on function public.admin_record_manual_balance(uuid, text, text, timestamptz, text) to authenticated;

-- Simple provider controls (owner): on/off, warning threshold, daily cap, funding terms, wallet group, order.
-- p_patch keys: enabled, lowBalanceThreshold, dailySpendCapUsd, fundingFeeBps, fundingBonusBps, fundingNote, walletGroup, sortOrder.
create or replace function public.admin_update_provider_account(p_account_id uuid, p_patch jsonb, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('provider.manage');
  acc app_private.provider_accounts;
  v_after app_private.provider_accounts;
  k text;
  v_dec numeric;
begin
  select * into acc from app_private.provider_accounts where id = p_account_id for update;
  if not found or acc.provider = 'fake' then
    perform app_private.fail('NOT_FOUND', 'Provider account not found.');
  end if;
  for k in select jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) loop
    if k not in ('enabled', 'lowBalanceThreshold', 'dailySpendCapUsd', 'fundingFeeBps', 'fundingBonusBps', 'fundingNote', 'walletGroup', 'sortOrder') then
      perform app_private.fail('INVALID_INPUT', 'Unknown setting: ' || left(k, 40));
    end if;
  end loop;
  if p_patch ? 'enabled' then
    if jsonb_typeof(p_patch -> 'enabled') <> 'boolean' then perform app_private.fail('INVALID_INPUT', 'On/off must be true or false.'); end if;
    if (p_patch ->> 'enabled')::boolean and acc.credential_version = 0 and acc.secret_ref <> 'KIE_API_KEY' then
      perform app_private.fail('CREDENTIALS_MISSING', 'Add an API key before switching this provider on.');
    end if;
    update app_private.provider_accounts set enabled = (p_patch ->> 'enabled')::boolean where id = acc.id;
  end if;
  if p_patch ? 'lowBalanceThreshold' then
    v_dec := app_private.num(p_patch -> 'lowBalanceThreshold');
    if jsonb_typeof(p_patch -> 'lowBalanceThreshold') <> 'null' and (v_dec is null or v_dec < 0) then
      perform app_private.fail('INVALID_INPUT', 'The low-balance warning must be a positive number or empty.');
    end if;
    update app_private.provider_accounts set low_balance_threshold = v_dec where id = acc.id;
  end if;
  if p_patch ? 'dailySpendCapUsd' then
    v_dec := app_private.num(p_patch -> 'dailySpendCapUsd');
    if jsonb_typeof(p_patch -> 'dailySpendCapUsd') <> 'null' and (v_dec is null or v_dec < 0 or v_dec > 1000000) then
      perform app_private.fail('INVALID_INPUT', 'The daily cap must be a positive amount in USD or empty.');
    end if;
    update app_private.provider_accounts set daily_spend_cap_usd = v_dec where id = acc.id;
  end if;
  if p_patch ? 'fundingFeeBps' and coalesce(app_private.num(p_patch -> 'fundingFeeBps') between 0 and 5000, false) is not true then
    perform app_private.fail('INVALID_INPUT', 'The funding fee is in basis points between 0 and 5000 (5.5 % = 550).');
  end if;
  if p_patch ? 'fundingBonusBps' and coalesce(app_private.num(p_patch -> 'fundingBonusBps') between 0 and 10000, false) is not true then
    perform app_private.fail('INVALID_INPUT', 'The credit bonus is in basis points between 0 and 10000 (10 % = 1000).');
  end if;
  if p_patch ? 'fundingFeeBps' or p_patch ? 'fundingBonusBps' or p_patch ? 'fundingNote' then
    update app_private.provider_accounts set
      funding_fee_bps = case when p_patch ? 'fundingFeeBps' then app_private.num(p_patch -> 'fundingFeeBps') else funding_fee_bps end,
      funding_bonus_bps = case when p_patch ? 'fundingBonusBps' then app_private.num(p_patch -> 'fundingBonusBps') else funding_bonus_bps end,
      funding_note = case when p_patch ? 'fundingNote' then left(nullif(trim(p_patch ->> 'fundingNote'), ''), 300) else funding_note end,
      funding_version = funding_version + 1
    where id = acc.id;
  end if;
  if p_patch ? 'walletGroup' then
    if jsonb_typeof(p_patch -> 'walletGroup') <> 'null' and coalesce(p_patch ->> 'walletGroup', '') !~ '^[a-z0-9-]{2,40}$' then
      perform app_private.fail('INVALID_INPUT', 'Wallet group: 2–40 lowercase letters, digits or dashes.');
    end if;
    update app_private.provider_accounts set wallet_group = p_patch ->> 'walletGroup' where id = acc.id;
  end if;
  if p_patch ? 'sortOrder' then
    if coalesce((p_patch ->> 'sortOrder') ~ '^\d{1,4}$', false) is not true then
      perform app_private.fail('INVALID_INPUT', 'Order must be a whole number.');
    end if;
    update app_private.provider_accounts set sort_order = (p_patch ->> 'sortOrder')::int where id = acc.id;
  end if;
  select * into v_after from app_private.provider_accounts where id = acc.id;
  perform app_private.audit(v_actor, 'provider.manage', 'provider.updated', 'provider_account', acc.id::text,
    coalesce(nullif(trim(p_reason), ''), 'Changed ' || (select string_agg(x, ', ') from jsonb_object_keys(p_patch) x)),
    app_private.provider_account_json(acc) - 'balance', app_private.provider_account_json(v_after) - 'balance');
  return app_private.provider_account_json(v_after);
end;
$$;
revoke execute on function public.admin_update_provider_account(uuid, jsonb, text) from public, anon;
grant execute on function public.admin_update_provider_account(uuid, jsonb, text) to authenticated;

-- ----------------------------------------------------------------- reads

-- A representative request for a model (defaults, first mode, the minimum required inputs), used for example costs.
create or replace function app_private.example_request(p_spec jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_opts jsonb := app_private.spec_defaults(p_spec);
  v_mode jsonb := p_spec -> 'modes' -> 0;
  v_counts jsonb := '{}'::jsonb;
  v_secs jsonb := '{}'::jsonb;
  s text;
  v_from text;
  v_derived text;
begin
  for s in select jsonb_array_elements_text(coalesce(v_mode -> 'requires', '[]'::jsonb)) loop
    v_counts := v_counts || jsonb_build_object(s, greatest(coalesce((p_spec -> 'inputs' -> s ->> 'min')::int, 1), 1));
    if p_spec -> 'inputs' -> s ->> 'kind' in ('video', 'audio') then
      select key into v_derived from jsonb_each(coalesce(p_spec -> 'derived', '{}'::jsonb)) where value ->> 'from' = s limit 1;
      v_secs := v_secs || jsonb_build_object(s, coalesce(app_private.num(v_opts -> v_derived), app_private.num(p_spec -> 'inputs' -> s -> 'minSeconds'), 5));
    end if;
  end loop;
  if coalesce((p_spec -> 'references' ->> 'min')::int, 0) > 0 then
    v_counts := v_counts || jsonb_build_object('_references', (p_spec -> 'references' ->> 'min')::int);
  end if;
  return jsonb_build_object('options', v_opts, 'mode', v_mode ->> 'id',
    'quantities', jsonb_build_object('outputs', coalesce((p_spec -> 'output' ->> 'count')::int, 1), 'counts', v_counts, 'seconds', v_secs, 'promptChars', 100));
end;
$$;

