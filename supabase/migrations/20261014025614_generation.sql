-- Genlixs 05 · Generation: quotes, jobs, provider attempts/observations, durable work items on pgmq,
-- atomic intent creation (§10.2), fenced worker steps (§13.2), job state machine (§14), callbacks (§15).

select pgmq.create('genlixs_control');
select pgmq.create('genlixs_media');
select pgmq.create('genlixs_events');

-- ---------------------------------------------------------------- tables

create table public.generation_quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (user_id),
  tool text not null references public.tools (id),
  model_id text not null,
  capability_version_id uuid not null,
  price_version_id uuid not null,
  normalized_input jsonb not null,
  input_hash text not null,
  units bigint not null check (units > 0),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index generation_quotes_owner_idx on public.generation_quotes (user_id, created_at desc);

create table public.generation_jobs (
  id uuid primary key,
  short_ref text not null unique default app_private.short_ref('J'),
  user_id uuid not null references public.profiles (user_id),
  quote_id uuid not null unique references public.generation_quotes (id),
  tool text not null references public.tools (id),
  model_id text not null,
  model_name text not null,
  capability_version_id uuid not null,
  price_version_id uuid not null,
  adapter text not null,
  adapter_version int not null,
  prompt text not null,
  options jsonb not null,
  reference_asset_ids uuid[] not null default '{}',
  title text not null,
  units bigint not null check (units > 0),
  idempotency_key text not null,
  request_hash text not null,
  state text not null default 'queued' check (state in (
    'queued', 'submitting', 'submission_unknown', 'provider_pending', 'processing_delayed',
    'importing', 'succeeded', 'failed', 'cancelled', 'review_required')),
  state_version int not null default 0,
  settlement_state text not null default 'reserved' check (settlement_state in ('reserved', 'captured', 'released')),
  next_action_at timestamptz,
  delayed_after_at timestamptz not null,
  customer_deadline_at timestamptz not null,
  failure_code text,
  failure_message text,
  parent_job_id uuid references public.generation_jobs (id),
  favorite boolean not null default false,
  hidden_at timestamptz,
  submitted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create index generation_jobs_owner_idx on public.generation_jobs (user_id, created_at desc);
create index generation_jobs_open_idx on public.generation_jobs (state, next_action_at)
  where state not in ('succeeded', 'failed', 'cancelled');
create trigger generation_jobs_touch before update on public.generation_jobs
  for each row execute function app_private.touch_updated_at();

alter table public.assets add constraint assets_job_fk foreign key (job_id) references public.generation_jobs (id);

create table public.generation_job_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.generation_jobs (id),
  user_id uuid not null,
  event text not null,
  message text not null,
  created_at timestamptz not null default now()
);
create index generation_job_events_job_idx on public.generation_job_events (job_id, created_at);
create trigger generation_job_events_append_only before update or delete on public.generation_job_events
  for each row execute function app_private.forbid_mutation();

create table app_private.provider_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.generation_jobs (id),
  ordinal int not null,
  provider_account_id uuid not null references app_private.provider_accounts (id),
  state text not null check (state in ('submitting', 'accepted', 'rejected', 'rate_limited', 'unknown')),
  provider_task_id text,
  request_hash text,
  correlation_token_hash text not null,
  work_item_id uuid,
  error_code text,
  error_message text,
  submitted_at timestamptz not null default now(),
  responded_at timestamptz,
  unique (job_id, ordinal),
  unique (provider_account_id, provider_task_id)
);

create table app_private.provider_event_receipts (
  id uuid primary key default gen_random_uuid(),
  provider_account_id uuid not null references app_private.provider_accounts (id),
  task_id text not null,
  timestamp_text text not null,
  signature_fingerprint text not null unique,
  attempt_hint uuid,
  outcome text,
  received_at timestamptz not null default now()
);

create table app_private.provider_observations (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.generation_jobs (id),
  attempt_id uuid references app_private.provider_attempts (id),
  task_id text,
  provider_state text,
  normalized_state text not null check (normalized_state in ('pending', 'success', 'fail', 'unknown')),
  result_urls jsonb,
  fail_code text,
  fail_message text,
  credits_consumed numeric,
  cost_time_seconds numeric,
  progress numeric,
  source text not null check (source in ('poll', 'callback', 'admin')),
  observed_at timestamptz not null default now()
);
create index provider_observations_job_idx on app_private.provider_observations (job_id, observed_at desc);

create table app_private.job_work_items (
  id uuid primary key default gen_random_uuid(),
  queue text not null check (queue in ('genlixs_control', 'genlixs_media', 'genlixs_events')),
  kind text not null check (kind in ('job_submit', 'job_check', 'job_bind', 'job_import', 'asset_delete', 'billing_apply', 'notify_email', 'payout_reconcile')),
  ref_id uuid not null,
  -- Unique logical action (§13.2): callback, scheduler and poller paths converge on one item.
  action_key text not null unique,
  state text not null default 'pending' check (state in ('pending', 'leased', 'done', 'dead', 'cancelled')),
  due_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  lease_token uuid,
  lease_expires_at timestamptz,
  fence int not null default 0,
  attempt_count int not null default 0,
  last_msg_id bigint,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index job_work_items_due_idx on app_private.job_work_items (state, due_at) where state in ('pending', 'leased');
create index job_work_items_ref_idx on app_private.job_work_items (ref_id);
create trigger job_work_items_touch before update on app_private.job_work_items
  for each row execute function app_private.touch_updated_at();

alter table public.generation_quotes enable row level security;
alter table public.generation_jobs enable row level security;
alter table public.generation_job_events enable row level security;
create policy quotes_owner_read on public.generation_quotes for select to authenticated using ((select auth.uid()) = user_id);
create policy jobs_owner_read on public.generation_jobs for select to authenticated using ((select auth.uid()) = user_id);
create policy job_events_owner_read on public.generation_job_events for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.generation_quotes, public.generation_jobs, public.generation_job_events from anon, authenticated;
grant select on public.generation_quotes, public.generation_jobs, public.generation_job_events to authenticated;

-- --------------------------------------------------------- work plumbing

create or replace function app_private.queue_send(p_queue text, p_item uuid, p_delay int)
returns bigint
language plpgsql
set search_path = ''
as $$
declare
  v_msg bigint;
begin
  if p_queue not in ('genlixs_control', 'genlixs_media', 'genlixs_events') then
    raise exception 'unknown queue %', p_queue;
  end if;
  select pgmq.send(p_queue, jsonb_build_object('workItemId', p_item, 'schemaVersion', 1), greatest(coalesce(p_delay, 0), 0)) into v_msg;
  update app_private.job_work_items set last_msg_id = v_msg where id = p_item;
  return v_msg;
end;
$$;

-- Creates (or finds) the logical work item and sends its queue message in the caller's transaction.
create or replace function app_private.enqueue_work(
  p_queue text, p_kind text, p_ref uuid, p_action_key text, p_due timestamptz default now(), p_payload jsonb default '{}'::jsonb
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  insert into app_private.job_work_items (queue, kind, ref_id, action_key, due_at, payload)
  values (p_queue, p_kind, p_ref, p_action_key, coalesce(p_due, now()), coalesce(p_payload, '{}'::jsonb))
  on conflict (action_key) do nothing
  returning id into v_id;
  if v_id is null then
    select id into v_id from app_private.job_work_items where action_key = p_action_key;
    return v_id;
  end if;
  perform app_private.queue_send(p_queue, v_id, ceil(extract(epoch from (coalesce(p_due, now()) - now())))::int);
  return v_id;
end;
$$;

-- Verifies the caller still holds the lease (fencing, §13.2). Stale workers cannot change state.
create or replace function app_private.verify_lease(p_item uuid, p_lease uuid)
returns app_private.job_work_items
language plpgsql
set search_path = ''
as $$
declare
  v app_private.job_work_items;
begin
  select * into v from app_private.job_work_items where id = p_item for update;
  if not found or v.state <> 'leased' or v.lease_token is distinct from p_lease or v.lease_expires_at <= now() then
    perform app_private.fail('STALE_LEASE', 'This work item is no longer held by the caller.');
  end if;
  return v;
end;
$$;

create or replace function app_private.finish_work(p_item uuid, p_state text, p_error text default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v app_private.job_work_items;
begin
  update app_private.job_work_items
  set state = p_state, lease_token = null, lease_expires_at = null, last_error = coalesce(p_error, last_error)
  where id = p_item returning * into v;
  if v.last_msg_id is not null then
    perform pgmq.archive(v.queue, v.last_msg_id);
  end if;
end;
$$;

-- Puts the same logical item back to pending with a new delayed message (rate limits, deferrals, retries).
create or replace function app_private.reschedule_work(p_item uuid, p_delay_seconds int, p_error text default null)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v app_private.job_work_items;
begin
  select * into v from app_private.job_work_items where id = p_item for update;
  if v.last_msg_id is not null then
    perform pgmq.archive(v.queue, v.last_msg_id);
  end if;
  update app_private.job_work_items
  set state = 'pending', lease_token = null, lease_expires_at = null,
      due_at = now() + make_interval(secs => greatest(p_delay_seconds, 0)), last_error = coalesce(p_error, last_error)
  where id = p_item;
  perform app_private.queue_send(v.queue, p_item, greatest(p_delay_seconds, 0));
end;
$$;

create or replace function app_private.job_event(p_job uuid, p_event text, p_message text)
returns void
language sql
set search_path = ''
as $$
  insert into public.generation_job_events (job_id, user_id, event, message)
  select p_job, j.user_id, p_event, p_message from public.generation_jobs j where j.id = p_job;
$$;

-- Allowed transitions live in one place (§14).
create or replace function app_private.set_job_state(p_job uuid, p_from text[], p_to text, p_patch jsonb default '{}'::jsonb)
returns public.generation_jobs
language plpgsql
set search_path = ''
as $$
declare
  v public.generation_jobs;
  v_allowed boolean;
begin
  select * into v from public.generation_jobs where id = p_job for update;
  if not found then
    perform app_private.fail('NOT_FOUND', 'Job not found.');
  end if;
  if not (v.state = any (p_from)) then
    perform app_private.fail('INVALID_TRANSITION', 'The job is no longer in a state that allows this step.',
      jsonb_build_object('state', v.state, 'to', p_to));
  end if;
  v_allowed := (v.state, p_to) in (
    ('queued', 'submitting'), ('queued', 'cancelled'), ('queued', 'failed'),
    ('submitting', 'provider_pending'), ('submitting', 'queued'), ('submitting', 'submission_unknown'), ('submitting', 'failed'),
    ('submission_unknown', 'provider_pending'), ('submission_unknown', 'review_required'), ('submission_unknown', 'failed'),
    ('provider_pending', 'provider_pending'), ('provider_pending', 'processing_delayed'), ('provider_pending', 'importing'),
    ('provider_pending', 'failed'), ('provider_pending', 'review_required'),
    ('processing_delayed', 'processing_delayed'), ('processing_delayed', 'importing'), ('processing_delayed', 'failed'),
    ('processing_delayed', 'review_required'),
    ('importing', 'importing'), ('importing', 'succeeded'), ('importing', 'review_required'), ('importing', 'failed'),
    ('review_required', 'provider_pending'), ('review_required', 'importing'), ('review_required', 'failed'),
    ('review_required', 'succeeded'), ('review_required', 'review_required')
  );
  if not v_allowed then
    perform app_private.fail('INVALID_TRANSITION', 'Transition not allowed.', jsonb_build_object('from', v.state, 'to', p_to));
  end if;
  update public.generation_jobs set
    state = p_to,
    state_version = state_version + 1,
    next_action_at = case when p_patch ? 'nextActionAt' then (p_patch ->> 'nextActionAt')::timestamptz else next_action_at end,
    failure_code = case when p_patch ? 'failureCode' then p_patch ->> 'failureCode' else failure_code end,
    failure_message = case when p_patch ? 'failureMessage' then p_patch ->> 'failureMessage' else failure_message end,
    submitted_at = case when p_to = 'submitting' then coalesce(submitted_at, now()) else submitted_at end,
    completed_at = case when p_to in ('succeeded', 'failed', 'cancelled') then now() else completed_at end
  where id = p_job
  returning * into v;
  return v;
end;
$$;

create or replace function app_private.job_snapshot(p_job uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', j.id, 'ref', j.short_ref, 'tool', j.tool, 'modelId', j.model_id, 'modelName', j.model_name, 'title', j.title,
    'prompt', j.prompt, 'options', j.options, 'referenceAssetIds', to_jsonb(j.reference_asset_ids),
    'units', j.units::text, 'state', j.state, 'settlementState', j.settlement_state,
    'failureCode', j.failure_code, 'failureMessage', j.failure_message,
    'delayedAfterAt', j.delayed_after_at, 'customerDeadlineAt', j.customer_deadline_at,
    'createdAt', j.created_at, 'submittedAt', j.submitted_at, 'completedAt', j.completed_at,
    'favorite', j.favorite, 'parentJobId', j.parent_job_id,
    'outputs', coalesce((
      select jsonb_agg(jsonb_build_object('assetId', a.id, 'mime', a.mime, 'bytes', a.bytes::text, 'width', a.width, 'height', a.height,
        'durationMs', a.duration_ms, 'state', a.state, 'retentionUntil', a.retention_until) order by a.created_at)
      from public.assets a where a.job_id = j.id and a.kind = 'output' and a.state in ('ready', 'expired')
    ), '[]'),
    'events', coalesce((
      select jsonb_agg(jsonb_build_object('event', e.event, 'message', e.message, 'at', e.created_at) order by e.created_at)
      from public.generation_job_events e where e.job_id = j.id
    ), '[]')
  )
  from public.generation_jobs j where j.id = p_job;
$$;

-- ----------------------------------------------------------------- quotes

create or replace function app_private.price_units(p_rules jsonb, p_options jsonb)
returns bigint
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_units bigint := coalesce((p_rules ->> 'base')::bigint, 0);
  k text;
begin
  for k in select jsonb_object_keys(coalesce(p_rules -> 'add', '{}'::jsonb)) loop
    if p_options ? k then
      v_units := v_units + coalesce((p_rules -> 'add' -> k ->> (p_options ->> k))::bigint, 0);
    end if;
  end loop;
  return v_units;
end;
$$;

create or replace function public.create_generation_quote(
  p_model_id text, p_prompt text, p_options jsonb default '{}'::jsonb, p_reference_asset_ids uuid[] default '{}'
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_active_user();
  m app_private.model_catalog;
  c app_private.model_capability_versions;
  p app_private.price_versions;
  v_prompt text := trim(coalesce(p_prompt, ''));
  v_opts jsonb := '{}'::jsonb;
  k text;
  v_spec jsonb;
  v_val jsonb;
  v_refs uuid[] := coalesce((select array_agg(distinct x order by x) from unnest(coalesce(p_reference_asset_ids, '{}')) x), '{}');
  v_ref_min int;
  v_ref_max int;
  v_units bigint;
  v_input jsonb;
  v_hash text;
  v_id uuid;
  v_expires timestamptz;
begin
  if coalesce((app_private.setting('generation_paused'))::text, 'false') = 'true' then
    perform app_private.fail('GENERATION_PAUSED', 'Generation is paused right now. Your draft is saved; try again later.');
  end if;
  if (select count(*) from public.generation_quotes where user_id = v_uid and created_at > now() - interval '1 minute')
     >= coalesce((app_private.setting('max_quotes_per_minute'))::text, '30')::int then
    perform app_private.fail('RATE_LIMITED', 'Too many price checks in a minute. Wait a moment and try again.');
  end if;

  select * into m from app_private.model_catalog where id = p_model_id;
  if not found or m.state not in ('enabled', 'experimental') then
    perform app_private.fail('MODEL_UNAVAILABLE', 'This model is not available right now. Choose another model.');
  end if;
  if exists (select 1 from app_private.provider_accounts a where a.id = m.provider_account_id and (a.paused or not a.enabled)) then
    perform app_private.fail('MODEL_UNAVAILABLE', 'This model is temporarily unavailable. Your draft is saved.');
  end if;
  if not exists (select 1 from public.tools t where t.id = m.tool and t.enabled) then
    perform app_private.fail('TOOL_UNAVAILABLE', 'This tool is not available right now.');
  end if;

  c := app_private.capability_for(m.id);
  select * into p from app_private.price_versions where model_id = m.id and state = 'published';
  if not found or p.capability_version_id <> c.id then
    perform app_private.fail('MODEL_NOT_PRICED', 'This model has no approved price yet.');
  end if;

  if char_length(v_prompt) < coalesce((c.spec -> 'prompt' ->> 'min')::int, 1) then
    perform app_private.fail('PROMPT_TOO_SHORT', 'Describe what you want in a few more words.');
  end if;
  if char_length(v_prompt) > coalesce((c.spec -> 'prompt' ->> 'max')::int, 4000) then
    perform app_private.fail('PROMPT_TOO_LONG', 'The prompt is longer than this model accepts.',
      jsonb_build_object('max', c.spec -> 'prompt' -> 'max'));
  end if;

  -- Every submitted option must be declared by the capability version; omitted ones take the default.
  for k in select jsonb_object_keys(coalesce(p_options, '{}'::jsonb)) loop
    if not (c.spec -> 'options' ? k) then
      perform app_private.fail('UNSUPPORTED_OPTION', 'This model does not support one of the selected settings.', jsonb_build_object('option', k));
    end if;
  end loop;
  for k, v_spec in select * from jsonb_each(coalesce(c.spec -> 'options', '{}'::jsonb)) loop
    v_val := coalesce(p_options -> k, v_spec -> 'default');
    if not exists (select 1 from jsonb_array_elements(v_spec -> 'values') e where e = v_val) then
      perform app_private.fail('UNSUPPORTED_OPTION', 'This model does not support the selected setting.',
        jsonb_build_object('option', k, 'value', v_val));
    end if;
    v_opts := v_opts || jsonb_build_object(k, v_val);
  end loop;

  v_ref_min := coalesce((c.spec -> 'references' ->> 'min')::int, 0);
  v_ref_max := coalesce((c.spec -> 'references' ->> 'max')::int, 0);
  if cardinality(v_refs) < v_ref_min then
    perform app_private.fail('REFERENCE_REQUIRED', 'Add a reference image to edit.');
  end if;
  if cardinality(v_refs) > v_ref_max then
    perform app_private.fail('TOO_MANY_REFERENCES', 'This model accepts fewer reference images.');
  end if;
  if cardinality(v_refs) > 0 and (
    select count(*) from public.assets a
    where a.id = any (v_refs) and a.user_id = v_uid and a.kind = 'input' and a.state = 'validated'
      and (a.retention_until is null or a.retention_until > now())
      and a.mime in (select jsonb_array_elements_text(c.spec -> 'references' -> 'mime'))
  ) <> cardinality(v_refs) then
    perform app_private.fail('REFERENCE_INVALID', 'The reference image is missing, expired or not accepted. Upload it again.');
  end if;

  v_units := app_private.price_units(p.rules, v_opts);
  if v_units <= 0 then
    perform app_private.fail('PRICE_INVALID', 'This combination has no valid price. Choose different settings.');
  end if;

  v_input := jsonb_build_object('modelId', m.id, 'prompt', v_prompt, 'options', v_opts, 'referenceAssetIds', to_jsonb(v_refs));
  v_hash := encode(extensions.digest(v_input::text, 'sha256'), 'hex');
  v_expires := now() + make_interval(secs => coalesce((app_private.setting('quote_ttl_seconds'))::text, '300')::int);

  insert into public.generation_quotes (user_id, tool, model_id, capability_version_id, price_version_id, normalized_input, input_hash, units, expires_at)
  values (v_uid, m.tool, m.id, c.id, p.id, v_input, v_hash, v_units, v_expires)
  returning id into v_id;

  return jsonb_build_object(
    'quoteId', v_id, 'creditUnits', v_units::text, 'displayCredits', v_units::text, 'expiresAt', v_expires,
    'priceVersionId', p.id, 'modelCapabilityVersionId', c.id, 'inputHash', v_hash, 'deliveryPolicy', 'complete-output-set',
    'tool', m.tool, 'modelId', m.id, 'options', v_opts, 'availableUnits', app_private.spendable_units(v_uid)::text
  );
end;
$$;
revoke execute on function public.create_generation_quote(text, text, jsonb, uuid[]) from public, anon;
grant execute on function public.create_generation_quote(text, text, jsonb, uuid[]) to authenticated;

-- ------------------------------------------------------- intent creation

-- One transaction: wallet lock -> idempotency -> quote checks -> concurrency -> reserve lots -> job ->
-- submit work item + queue message (§10.2). Any failure rolls back everything, including the message.
create or replace function public.create_generation(p_quote_id uuid, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_active_user();
  q public.generation_quotes;
  m app_private.model_catalog;
  v_existing public.generation_jobs;
  v_job uuid := gen_random_uuid();
  v_active int;
  v_title text;
  v_request_hash text;
begin
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then
    perform app_private.fail('INVALID_IDEMPOTENCY_KEY', 'Missing or invalid Idempotency-Key.');
  end if;

  -- Serialize every intent of this customer on the wallet row (consistent lock order).
  perform app_private.lock_wallet(v_uid);

  select * into v_existing from public.generation_jobs where user_id = v_uid and idempotency_key = p_idempotency_key;
  if found then
    if v_existing.quote_id = p_quote_id then
      return jsonb_build_object('job', app_private.job_snapshot(v_existing.id), 'replayed', true,
        'wallet', jsonb_build_object('availableUnits', app_private.spendable_units(v_uid)::text,
          'reservedUnits', (select reserved_units::text from public.wallet_accounts where user_id = v_uid)));
    end if;
    perform app_private.fail('IDEMPOTENCY_CONFLICT', 'This request key was already used for a different generation.');
  end if;

  select * into q from public.generation_quotes where id = p_quote_id and user_id = v_uid for update;
  if not found then
    perform app_private.fail('QUOTE_NOT_FOUND', 'This price check is no longer available. Refresh it.');
  end if;
  if q.consumed_at is not null then
    perform app_private.fail('QUOTE_ALREADY_USED', 'This price check was already used. Refresh it to generate again.');
  end if;
  if q.expires_at <= now() then
    perform app_private.fail('QUOTE_EXPIRED', 'The price check expired. Refresh it to continue.');
  end if;
  if coalesce((app_private.setting('generation_paused'))::text, 'false') = 'true' then
    perform app_private.fail('GENERATION_PAUSED', 'Generation is paused right now. Your draft is saved; try again later.');
  end if;

  select * into m from app_private.model_catalog where id = q.model_id;
  if m.state not in ('enabled', 'experimental') then
    perform app_private.fail('MODEL_UNAVAILABLE', 'This model is not available right now. Choose another model.');
  end if;
  -- A price change after the quote requires a new quote; never charge a different price silently.
  if not exists (select 1 from app_private.price_versions where id = q.price_version_id and state = 'published') then
    perform app_private.fail('QUOTE_STALE', 'The price changed. Refresh the quote to see the new cost.');
  end if;

  select count(*) into v_active from public.generation_jobs
  where user_id = v_uid and state not in ('succeeded', 'failed', 'cancelled');
  if v_active >= coalesce((app_private.setting('max_active_jobs_per_user'))::text, '3')::int then
    perform app_private.fail('TOO_MANY_ACTIVE_JOBS', 'Wait for one of your running jobs to finish before starting another.');
  end if;

  perform app_private.expire_due_lots(v_uid);
  perform app_private.reserve_units(v_uid, v_job, q.units);

  v_title := left(regexp_replace(q.normalized_input ->> 'prompt', '\s+', ' ', 'g'), 60);
  v_request_hash := encode(extensions.digest(p_quote_id::text || ':' || q.input_hash, 'sha256'), 'hex');

  insert into public.generation_jobs (
    id, user_id, quote_id, tool, model_id, model_name, capability_version_id, price_version_id, adapter, adapter_version,
    prompt, options, reference_asset_ids, title, units, idempotency_key, request_hash, state, next_action_at,
    delayed_after_at, customer_deadline_at
  ) values (
    v_job, v_uid, q.id, q.tool, m.id, m.public_name, q.capability_version_id, q.price_version_id, m.adapter, m.adapter_version,
    q.normalized_input ->> 'prompt', q.normalized_input -> 'options',
    coalesce((select array_agg(x::uuid) from jsonb_array_elements_text(q.normalized_input -> 'referenceAssetIds') x), '{}'),
    v_title, q.units, p_idempotency_key, v_request_hash, 'queued', now(),
    now() + make_interval(mins => coalesce((app_private.setting('delayed_after_minutes'))::text, '30')::int),
    now() + make_interval(hours => coalesce((app_private.setting('reservation_deadline_hours'))::text, '24')::int)
  );

  update public.generation_quotes set consumed_at = now() where id = q.id;
  perform app_private.job_event(v_job, 'queued', 'Waiting in queue. ' || q.units || ' credits reserved.');
  perform app_private.enqueue_work('genlixs_control', 'job_submit', v_job, 'submit:' || v_job || ':1', now(), '{}'::jsonb);

  return jsonb_build_object('job', app_private.job_snapshot(v_job), 'replayed', false,
    'wallet', jsonb_build_object('availableUnits', app_private.spendable_units(v_uid)::text,
      'reservedUnits', (select reserved_units::text from public.wallet_accounts where user_id = v_uid)));
end;
$$;
revoke execute on function public.create_generation(uuid, text) from public, anon;
grant execute on function public.create_generation(uuid, text) to authenticated;

-- Cancellation wins only while the submit work item is still unclaimed (§14).
create or replace function public.cancel_queued_generation(p_job_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  w app_private.job_work_items;
  j public.generation_jobs;
begin
  select * into j from public.generation_jobs where id = p_job_id and user_id = v_uid;
  if not found then
    perform app_private.fail('NOT_FOUND', 'Job not found.');
  end if;
  if j.state = 'cancelled' then
    return jsonb_build_object('job', app_private.job_snapshot(j.id), 'cancelled', true);
  end if;
  -- Lock order matches the worker claim: work item first, then the job.
  select * into w from app_private.job_work_items where ref_id = p_job_id and kind = 'job_submit' and state in ('pending', 'leased')
  order by created_at desc limit 1 for update;
  select * into j from public.generation_jobs where id = p_job_id for update;
  if j.state <> 'queued' or w.id is null or w.state <> 'pending' then
    perform app_private.fail('CANCEL_TOO_LATE', 'This job was already sent to the generation service and can no longer be cancelled.');
  end if;
  perform app_private.finish_work(w.id, 'cancelled');
  perform app_private.set_job_state(j.id, array['queued'], 'cancelled', '{"failureCode": "CANCELLED"}'::jsonb);
  perform app_private.release_reservation(j.id, 'Cancelled before submission');
  update public.generation_jobs set settlement_state = 'released' where id = j.id;
  perform app_private.job_event(j.id, 'cancelled', 'Cancelled before submission. Reserved credits returned.');
  return jsonb_build_object('job', app_private.job_snapshot(j.id), 'cancelled', true);
end;
$$;
revoke execute on function public.cancel_queued_generation(uuid) from public, anon;
grant execute on function public.cancel_queued_generation(uuid) to authenticated;

create or replace function public.set_generation_flags(p_job_id uuid, p_favorite boolean default null, p_hidden boolean default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.generation_jobs set
    favorite = coalesce(p_favorite, favorite),
    hidden_at = case when p_hidden is null then hidden_at when p_hidden then coalesce(hidden_at, now()) else null end
  where id = p_job_id and user_id = auth.uid();
  if not found then
    perform app_private.fail('NOT_FOUND', 'Job not found.');
  end if;
  return app_private.job_snapshot(p_job_id);
end;
$$;
revoke execute on function public.set_generation_flags(uuid, boolean, boolean) from public, anon;
grant execute on function public.set_generation_flags(uuid, boolean, boolean) to authenticated;

create or replace function public.get_generation(p_job_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select app_private.job_snapshot(j.id) from public.generation_jobs j where j.id = p_job_id and j.user_id = (select auth.uid());
$$;
revoke execute on function public.get_generation(uuid) from public, anon;
grant execute on function public.get_generation(uuid) to authenticated;

create or replace function public.list_generations(
  p_before timestamptz default null, p_limit int default 24, p_tool text default null, p_state text default null, p_favorites boolean default false
) returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(app_private.job_snapshot(x.id) order by x.created_at desc), '[]')
  from (
    select j.id, j.created_at from public.generation_jobs j
    where j.user_id = (select auth.uid()) and j.hidden_at is null
      and (p_before is null or j.created_at < p_before)
      and (p_tool is null or j.tool = p_tool)
      and (p_state is null
           or (p_state = 'ready' and j.state = 'succeeded')
           or (p_state = 'running' and j.state not in ('succeeded', 'failed', 'cancelled'))
           or (p_state = 'failed' and j.state in ('failed', 'cancelled')))
      and (not coalesce(p_favorites, false) or j.favorite)
    order by j.created_at desc
    limit least(greatest(coalesce(p_limit, 24), 1), 100)
  ) x;
$$;
revoke execute on function public.list_generations(timestamptz, int, text, text, boolean) from public, anon;
grant execute on function public.list_generations(timestamptz, int, text, text, boolean) to authenticated;

-- Customer credit statement: one row per business event (moved here because it joins jobs).
create or replace function public.get_credit_statement(p_before timestamptz default null, p_limit int default 50)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with ev as (
    select c.event_key, min(c.event_type) as event_type, max(c.created_at) as at,
           sum(c.d_available)::bigint as d_available, sum(c.d_reserved)::bigint as d_reserved, sum(c.d_spent)::bigint as d_spent,
           sum(c.d_expired)::bigint as d_expired, sum(c.d_revoked)::bigint as d_revoked,
           max(c.job_id::text) as job_id, max(c.source_ref) as source_ref, max(c.note) as note
    from public.credit_ledger c
    where c.user_id = (select auth.uid())
    group by c.event_key
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'eventKey', e.event_key, 'type', e.event_type, 'at', e.at,
    'available', e.d_available::text, 'reserved', e.d_reserved::text, 'spent', e.d_spent::text,
    'expired', e.d_expired::text, 'revoked', e.d_revoked::text,
    'jobId', e.job_id, 'jobRef', (select j.short_ref from public.generation_jobs j where j.id::text = e.job_id),
    'sourceRef', e.source_ref, 'note', e.note
  ) order by e.at desc), '[]')
  from (select * from ev where p_before is null or ev.at < p_before order by ev.at desc limit least(greatest(p_limit, 1), 200)) e;
$$;
revoke execute on function public.get_credit_statement(timestamptz, int) from public, anon;
grant execute on function public.get_credit_statement(timestamptz, int) to authenticated;

-- ------------------------------------------------------- worker: queues

create or replace function public.worker_dequeue(p_queue text, p_visibility_seconds int default 90, p_qty int default 5)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_queue not in ('genlixs_control', 'genlixs_media', 'genlixs_events') then
    perform app_private.fail('UNKNOWN_QUEUE', 'Unknown queue.');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('msgId', r.msg_id, 'readCount', r.read_ct, 'workItemId', r.message ->> 'workItemId'))
    from pgmq.read(p_queue, least(greatest(p_visibility_seconds, 10), 600), least(greatest(p_qty, 1), 10)) r
  ), '[]');
end;
$$;

create or replace function public.worker_claim(p_queue text, p_msg_id bigint, p_work_item_id uuid, p_worker text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w app_private.job_work_items;
  v_lease uuid := gen_random_uuid();
  v_secs int;
  v_ctx jsonb := '{}'::jsonb;
begin
  select * into w from app_private.job_work_items where id = p_work_item_id for update skip locked;
  if not found then
    if not exists (select 1 from app_private.job_work_items where id = p_work_item_id) then
      perform pgmq.archive(p_queue, p_msg_id);
      return jsonb_build_object('status', 'stale');
    end if;
    return jsonb_build_object('status', 'busy');
  end if;
  if w.state in ('done', 'cancelled', 'dead') or w.last_msg_id is distinct from p_msg_id then
    -- A superseded message (rescheduled item) or finished work: drop this copy.
    perform pgmq.archive(p_queue, p_msg_id);
    return jsonb_build_object('status', 'stale');
  end if;
  if w.state = 'leased' and w.lease_expires_at > now() then
    return jsonb_build_object('status', 'busy');
  end if;
  if w.due_at > now() + interval '2 seconds' then
    perform pgmq.set_vt(p_queue, p_msg_id, ceil(extract(epoch from (w.due_at - now())))::int);
    return jsonb_build_object('status', 'not_due');
  end if;
  v_secs := case w.queue when 'genlixs_media' then 300 else 90 end;
  update app_private.job_work_items
  set state = 'leased', lease_token = v_lease, lease_expires_at = now() + make_interval(secs => v_secs),
      fence = fence + 1, attempt_count = attempt_count + 1
  where id = w.id returning * into w;

  if w.kind in ('job_submit', 'job_check', 'job_bind', 'job_import') then
    select jsonb_build_object(
      'job', jsonb_build_object('id', j.id, 'ref', j.short_ref, 'userId', j.user_id, 'state', j.state, 'tool', j.tool,
        'prompt', j.prompt, 'options', j.options, 'units', j.units::text, 'deadlineAt', j.customer_deadline_at,
        'delayedAfterAt', j.delayed_after_at),
      'model', jsonb_build_object('id', m.id, 'providerModelId', m.provider_model_id, 'adapter', m.adapter,
        'adapterVersion', j.adapter_version, 'providerAccountId', m.provider_account_id),
      'output', (select c.spec -> 'output' from app_private.model_capability_versions c where c.id = j.capability_version_id),
      'references', coalesce((
        select jsonb_agg(jsonb_build_object('assetId', a.id, 'bucket', a.bucket, 'path', a.object_path, 'mime', a.mime))
        from public.assets a where a.id = any (j.reference_asset_ids)), '[]'),
      'attempt', (
        select jsonb_build_object('id', t.id, 'ordinal', t.ordinal, 'state', t.state, 'taskId', t.provider_task_id)
        from app_private.provider_attempts t where t.job_id = j.id order by t.ordinal desc limit 1)
    ) into v_ctx
    from public.generation_jobs j join app_private.model_catalog m on m.id = j.model_id
    where j.id = w.ref_id;
  end if;

  return jsonb_build_object('status', 'claimed', 'workItemId', w.id, 'leaseToken', v_lease, 'fence', w.fence,
    'kind', w.kind, 'refId', w.ref_id, 'attemptCount', w.attempt_count, 'payload', w.payload, 'context', v_ctx);
end;
$$;

-- --------------------------------------------------- worker: submission

create or replace function public.worker_begin_submission(p_work_item_id uuid, p_lease_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w app_private.job_work_items := app_private.verify_lease(p_work_item_id, p_lease_token);
  j public.generation_jobs;
  m app_private.model_catalog;
  acc app_private.provider_accounts;
  v_ord int;
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
  v_attempt uuid;
  v_recent int;
begin
  select * into j from public.generation_jobs where id = w.ref_id for update;
  if j.state <> 'queued' then
    perform app_private.finish_work(w.id, 'done', 'job no longer queued: ' || j.state);
    return jsonb_build_object('action', 'skip', 'state', j.state);
  end if;
  select * into m from app_private.model_catalog where id = j.model_id;
  select * into acc from app_private.provider_accounts where id = m.provider_account_id for update;
  if coalesce((app_private.setting('generation_paused'))::text, 'false') = 'true' or acc.paused or not acc.enabled then
    perform app_private.reschedule_work(w.id, 60, 'intake paused');
    return jsonb_build_object('action', 'deferred', 'reason', 'paused');
  end if;
  if j.customer_deadline_at <= now() then
    perform app_private.finish_work(w.id, 'done', 'deadline passed before submission');
    perform app_private.set_job_state(j.id, array['queued'], 'failed',
      jsonb_build_object('failureCode', 'NOT_SUBMITTED', 'failureMessage', 'The job could not be sent before its deadline. Reserved credits were returned.'));
    perform app_private.release_reservation(j.id, 'Not submitted before the deadline');
    update public.generation_jobs set settlement_state = 'released' where id = j.id;
    perform app_private.job_event(j.id, 'failed', 'Could not be sent before the deadline. Reserved credits returned.');
    return jsonb_build_object('action', 'skip', 'state', 'failed');
  end if;
  -- Account-wide create budget, coordinated in the database rather than per function instance (§12.5).
  select count(*) into v_recent from app_private.provider_attempts
  where provider_account_id = acc.id and submitted_at > now() - interval '10 seconds';
  if v_recent >= coalesce((app_private.setting('provider_create_budget_per_10s'))::text, '10')::int then
    perform app_private.reschedule_work(w.id, 3 + floor(random() * 5)::int, 'create budget exhausted');
    return jsonb_build_object('action', 'deferred', 'reason', 'rate_budget');
  end if;

  select coalesce(max(ordinal), 0) + 1 into v_ord from app_private.provider_attempts where job_id = j.id;
  insert into app_private.provider_attempts (job_id, ordinal, provider_account_id, state, request_hash, correlation_token_hash, work_item_id)
  values (j.id, v_ord, acc.id, 'submitting', j.request_hash, encode(extensions.digest(v_token, 'sha256'), 'hex'), w.id)
  returning id into v_attempt;
  perform app_private.set_job_state(j.id, array['queued'], 'submitting');
  perform app_private.job_event(j.id, 'submitting', 'Sending the request to the generation service.');
  -- Committed before the external POST: a crash from here on is reconciled, never blindly resent.
  return jsonb_build_object('action', 'submit', 'attemptId', v_attempt, 'ordinal', v_ord, 'correlationToken', v_token);
end;
$$;

-- p_outcome.kind: accepted | rejected_terminal | rejected_retryable | unknown
create or replace function public.worker_record_submission(p_work_item_id uuid, p_lease_token uuid, p_attempt_id uuid, p_outcome jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w app_private.job_work_items := app_private.verify_lease(p_work_item_id, p_lease_token);
  a app_private.provider_attempts;
  j public.generation_jobs;
  v_kind text := p_outcome ->> 'kind';
  v_task text := nullif(p_outcome ->> 'taskId', '');
  v_backoff int;
  v_existing uuid;
begin
  select * into a from app_private.provider_attempts where id = p_attempt_id and job_id = w.ref_id for update;
  if not found then
    perform app_private.fail('NOT_FOUND', 'Attempt not found.');
  end if;
  select * into j from public.generation_jobs where id = a.job_id for update;

  if v_kind = 'accepted' and v_task is not null then
    select id into v_existing from app_private.provider_attempts
    where provider_account_id = a.provider_account_id and provider_task_id = v_task and id <> a.id;
    if v_existing is not null then
      -- The same task can never belong to two attempts: stop and review instead of double-billing.
      update app_private.provider_attempts set state = 'unknown', error_code = 'TASK_CONFLICT', responded_at = now() where id = a.id;
      perform app_private.set_job_state(j.id, array['submitting', 'submission_unknown'], 'review_required',
        '{"failureCode": "TASK_CONFLICT"}'::jsonb);
      perform app_private.finish_work(w.id, 'done', 'task id conflict');
      return jsonb_build_object('action', 'review');
    end if;
    update app_private.provider_attempts set state = 'accepted', provider_task_id = v_task, responded_at = now() where id = a.id;
    if j.state in ('submitting', 'submission_unknown') then
      perform app_private.set_job_state(j.id, array['submitting', 'submission_unknown'], 'provider_pending',
        jsonb_build_object('nextActionAt', now() + interval '15 seconds'));
      perform app_private.job_event(j.id, 'accepted', 'Accepted by the generation service. Generating.');
    end if;
    perform app_private.enqueue_work('genlixs_control', 'job_check', j.id, 'check:' || j.id || ':1', now() + interval '15 seconds',
      jsonb_build_object('n', 1));
    perform app_private.finish_work(w.id, 'done');
    return jsonb_build_object('action', 'check_scheduled', 'taskId', v_task);

  elsif v_kind = 'rejected_retryable' then
    update app_private.provider_attempts set state = 'rate_limited', error_code = p_outcome ->> 'code', error_message = left(p_outcome ->> 'message', 300),
      responded_at = now() where id = a.id;
    perform app_private.set_job_state(j.id, array['submitting'], 'queued');
    v_backoff := least(300, (power(2, least(a.ordinal, 8)) * 5)::int) + floor(random() * 10)::int;
    perform app_private.job_event(j.id, 'retry_scheduled', 'The generation service is busy. Your job will be sent again shortly.');
    perform app_private.finish_work(w.id, 'done');
    perform app_private.enqueue_work('genlixs_control', 'job_submit', j.id, 'submit:' || j.id || ':' || (a.ordinal + 1),
      now() + make_interval(secs => v_backoff), '{}'::jsonb);
    return jsonb_build_object('action', 'retry_scheduled', 'inSeconds', v_backoff);

  elsif v_kind = 'rejected_terminal' then
    update app_private.provider_attempts set state = 'rejected', error_code = p_outcome ->> 'code', error_message = left(p_outcome ->> 'message', 300),
      responded_at = now() where id = a.id;
    perform app_private.set_job_state(j.id, array['submitting'], 'failed',
      jsonb_build_object('failureCode', coalesce(p_outcome ->> 'publicCode', 'REJECTED'),
        'failureMessage', coalesce(p_outcome ->> 'publicMessage', 'The generation service did not accept this request.')));
    perform app_private.release_reservation(j.id, 'Request not accepted by the generation service');
    update public.generation_jobs set settlement_state = 'released' where id = j.id;
    perform app_private.job_event(j.id, 'failed', 'Not accepted by the generation service. Reserved credits returned.');
    perform app_private.notify(j.user_id, 'job_failed:' || j.id, 'job_failed', 'Generation failed',
      'Your job ' || j.short_ref || ' was not accepted. The reserved credits were returned.', '/studio/library?job=' || j.id);
    perform app_private.finish_work(w.id, 'done');
    return jsonb_build_object('action', 'failed');

  else
    -- Timeout, lost connection, malformed accepted response, unexplained 5xx: never resend blindly (§12.5).
    update app_private.provider_attempts set state = 'unknown', error_code = coalesce(p_outcome ->> 'code', 'UNKNOWN'),
      error_message = left(p_outcome ->> 'message', 300), responded_at = now() where id = a.id;
    perform app_private.set_job_state(j.id, array['submitting'], 'submission_unknown');
    perform app_private.job_event(j.id, 'verifying', 'Verifying that the generation service received the request.');
    perform app_private.finish_work(w.id, 'done');
    return jsonb_build_object('action', 'unknown');
  end if;
end;
$$;

-- ----------------------------------------------------- worker: status

-- p_obs: {taskId, providerState, normalized: pending|success|fail|unknown, resultUrls[], failCode, failMsg,
--         creditsConsumed, costTime, progress, source}
create or replace function public.worker_record_observation(p_work_item_id uuid, p_lease_token uuid, p_obs jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w app_private.job_work_items := app_private.verify_lease(p_work_item_id, p_lease_token);
  j public.generation_jobs;
  a app_private.provider_attempts;
  v_norm text := coalesce(p_obs ->> 'normalized', 'unknown');
  v_n int := coalesce((w.payload ->> 'n')::int, 1);
  v_delay int;
  v_expected int;
  v_urls jsonb := coalesce(p_obs -> 'resultUrls', '[]'::jsonb);
begin
  select * into j from public.generation_jobs where id = w.ref_id for update;
  select * into a from app_private.provider_attempts where job_id = j.id and state = 'accepted' order by ordinal desc limit 1;
  insert into app_private.provider_observations (job_id, attempt_id, task_id, provider_state, normalized_state, result_urls, fail_code, fail_message,
    credits_consumed, cost_time_seconds, progress, source)
  values (j.id, a.id, p_obs ->> 'taskId', p_obs ->> 'providerState', v_norm, v_urls, p_obs ->> 'failCode', left(p_obs ->> 'failMsg', 500),
    nullif(p_obs ->> 'creditsConsumed', '')::numeric, nullif(p_obs ->> 'costTime', '')::numeric, nullif(p_obs ->> 'progress', '')::numeric,
    coalesce(p_obs ->> 'source', 'poll'));

  if j.state in ('succeeded', 'failed', 'cancelled') then
    -- Late result after settlement: evidence only; never recapture or rebill (§14).
    perform app_private.finish_work(w.id, 'done', 'observation after terminal state');
    return jsonb_build_object('action', 'none', 'state', j.state);
  end if;

  if v_norm = 'success' then
    select coalesce((c.spec -> 'output' ->> 'count')::int, 1) into v_expected
    from app_private.model_capability_versions c where c.id = j.capability_version_id;
    if jsonb_array_length(v_urls) < v_expected then
      perform app_private.set_job_state(j.id, array['provider_pending', 'processing_delayed', 'review_required'], 'review_required',
        '{"failureCode": "INCOMPLETE_OUTPUT"}'::jsonb);
      perform app_private.job_event(j.id, 'review', 'The service reported success without the expected files. Under review.');
      perform app_private.finish_work(w.id, 'done');
      return jsonb_build_object('action', 'review');
    end if;
    perform app_private.set_job_state(j.id, array['provider_pending', 'processing_delayed', 'review_required'], 'importing');
    perform app_private.job_event(j.id, 'importing', 'Saving your file.');
    perform app_private.enqueue_work('genlixs_media', 'job_import', j.id, 'import:' || j.id || ':' || coalesce(a.provider_task_id, 'x'),
      now(), jsonb_build_object('taskId', p_obs ->> 'taskId', 'urls', v_urls, 'expected', v_expected));
    perform app_private.finish_work(w.id, 'done');
    return jsonb_build_object('action', 'import_scheduled');

  elsif v_norm = 'fail' then
    perform app_private.set_job_state(j.id, array['provider_pending', 'processing_delayed', 'review_required'], 'failed',
      jsonb_build_object('failureCode', 'PROVIDER_FAILED',
        'failureMessage', 'The generation service could not complete this request. Reserved credits were returned.'));
    perform app_private.release_reservation(j.id, 'Generation failed without delivery');
    update public.generation_jobs set settlement_state = 'released' where id = j.id;
    perform app_private.job_event(j.id, 'failed', 'Failed. Reserved credits returned.');
    perform app_private.notify(j.user_id, 'job_failed:' || j.id, 'job_failed', 'Generation failed',
      'Job ' || j.short_ref || ' could not be completed. The reserved credits were returned.', '/studio/library?job=' || j.id);
    perform app_private.finish_work(w.id, 'done');
    return jsonb_build_object('action', 'failed');

  else
    -- Pending or unknown: keep the reservation, check again later with backoff (15 s, 30 s, then ~60 s + jitter).
    if now() > j.delayed_after_at and j.state = 'provider_pending' then
      perform app_private.set_job_state(j.id, array['provider_pending'], 'processing_delayed');
      perform app_private.job_event(j.id, 'delayed', 'Taking longer than usual. Your credits stay reserved; nothing is charged until the file is saved.');
    end if;
    if v_norm = 'unknown' and v_n >= 40 then
      perform app_private.set_job_state(j.id, array['provider_pending', 'processing_delayed', 'review_required'], 'review_required',
        '{"failureCode": "STATUS_UNREADABLE"}'::jsonb);
      perform app_private.finish_work(w.id, 'done');
      return jsonb_build_object('action', 'review');
    end if;
    v_delay := case when v_n <= 1 then 15 when v_n = 2 then 30 else 60 end + floor(random() * 8)::int;
    update public.generation_jobs set next_action_at = now() + make_interval(secs => v_delay) where id = j.id;
    perform app_private.finish_work(w.id, 'done');
    perform app_private.enqueue_work('genlixs_control', 'job_check', j.id, 'check:' || j.id || ':' || (v_n + 1),
      now() + make_interval(secs => v_delay), jsonb_build_object('n', v_n + 1));
    return jsonb_build_object('action', 'recheck', 'inSeconds', v_delay);
  end if;
end;
$$;

-- --------------------------------------------------------- worker: import

-- p_assets: [{bucket, path, mime, bytes, width, height, durationMs, sha256}] verified by the media worker.
create or replace function public.worker_record_import(p_work_item_id uuid, p_lease_token uuid, p_assets jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w app_private.job_work_items := app_private.verify_lease(p_work_item_id, p_lease_token);
  j public.generation_jobs;
  x jsonb;
  v_expected int := coalesce((w.payload ->> 'expected')::int, 1);
  v_days int := coalesce((app_private.setting('output_retention_days'))::text, '90')::int;
  v_state text;
  v_count int;
begin
  select * into j from public.generation_jobs where id = w.ref_id for update;
  v_state := case when j.state in ('importing', 'review_required') then 'ready' else 'quarantined' end;
  for x in select * from jsonb_array_elements(coalesce(p_assets, '[]'::jsonb)) loop
    insert into public.assets (user_id, kind, job_id, bucket, object_path, mime, bytes, width, height, duration_ms, sha256, state,
      retention_until, provider_task_id)
    values (j.user_id, 'output', j.id, x ->> 'bucket', x ->> 'path', x ->> 'mime', (x ->> 'bytes')::bigint, nullif(x ->> 'width', '')::int,
      nullif(x ->> 'height', '')::int, nullif(x ->> 'durationMs', '')::int, x ->> 'sha256', v_state,
      now() + make_interval(days => v_days), w.payload ->> 'taskId')
    on conflict (bucket, object_path) do nothing;
  end loop;

  if v_state = 'quarantined' then
    perform app_private.finish_work(w.id, 'done', 'import after terminal state: quarantined');
    return jsonb_build_object('action', 'quarantined', 'state', j.state);
  end if;

  select count(*) into v_count from public.assets where job_id = j.id and kind = 'output' and state = 'ready';
  if v_count < v_expected then
    perform app_private.reschedule_work(w.id, 30, 'incomplete output set');
    return jsonb_build_object('action', 'retry');
  end if;

  -- Deliverables verified and stored: capture exactly once, mark success, notify (§16.6).
  if app_private.capture_reservation(j.id, 'Charged on saved output') <> 'captured' then
    perform app_private.set_job_state(j.id, array['importing', 'review_required'], 'review_required',
      '{"failureCode": "SETTLEMENT_CONFLICT"}'::jsonb);
    perform app_private.finish_work(w.id, 'done', 'reservation already settled');
    return jsonb_build_object('action', 'review');
  end if;
  perform app_private.set_job_state(j.id, array['importing', 'review_required'], 'succeeded');
  update public.generation_jobs set settlement_state = 'captured' where id = j.id;
  perform app_private.job_event(j.id, 'succeeded', 'Ready to download. ' || j.units || ' credits charged.');
  perform app_private.notify(j.user_id, 'job_ready:' || j.id, 'job_ready', 'Your ' || case j.tool when 'video' then 'clip' else 'image' end || ' is ready',
    j.title, '/studio/library?job=' || j.id);
  perform app_private.finish_work(w.id, 'done');
  return jsonb_build_object('action', 'succeeded');
end;
$$;

create or replace function public.worker_import_failed(p_work_item_id uuid, p_lease_token uuid, p_error text, p_retryable boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w app_private.job_work_items := app_private.verify_lease(p_work_item_id, p_lease_token);
  j public.generation_jobs;
begin
  select * into j from public.generation_jobs where id = w.ref_id for update;
  if p_retryable and w.attempt_count < 6 and j.state = 'importing' then
    -- Same task, same output: retry the transfer only. Never regenerate (§16.5).
    perform app_private.reschedule_work(w.id, least(600, 30 * w.attempt_count), left(p_error, 300));
    return jsonb_build_object('action', 'retry');
  end if;
  if j.state = 'importing' then
    perform app_private.set_job_state(j.id, array['importing'], 'review_required', '{"failureCode": "IMPORT_FAILED"}'::jsonb);
    perform app_private.job_event(j.id, 'review', 'The file could not be saved yet. Our team is checking it; your credits stay reserved.');
  end if;
  perform app_private.finish_work(w.id, 'dead', left(p_error, 300));
  return jsonb_build_object('action', 'review');
end;
$$;

-- Generic deferral for transient worker conditions (e.g. provider status read failed).
create or replace function public.worker_defer(p_work_item_id uuid, p_lease_token uuid, p_seconds int, p_error text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w app_private.job_work_items := app_private.verify_lease(p_work_item_id, p_lease_token);
begin
  if w.attempt_count >= 25 then
    perform app_private.finish_work(w.id, 'dead', left(p_error, 300));
    if w.kind in ('job_check', 'job_import', 'job_bind') then
      update public.generation_jobs set state = 'review_required', state_version = state_version + 1, failure_code = 'WORKER_DEAD_LETTER'
      where id = w.ref_id and state not in ('succeeded', 'failed', 'cancelled');
    end if;
    return jsonb_build_object('action', 'dead_letter');
  end if;
  perform app_private.reschedule_work(w.id, least(greatest(p_seconds, 5), 900), left(p_error, 300));
  return jsonb_build_object('action', 'deferred');
end;
$$;

create or replace function public.worker_complete(p_work_item_id uuid, p_lease_token uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w app_private.job_work_items := app_private.verify_lease(p_work_item_id, p_lease_token);
begin
  perform app_private.finish_work(w.id, 'done', p_note);
  return jsonb_build_object('action', 'done');
end;
$$;

-- --------------------------------------------------- callbacks (§15)

-- Called by the webhook route only after the HMAC (task id + timestamp) verified. The body is not trusted:
-- this only schedules an authoritative status read for the bound job, or a verified binding check.
create or replace function public.provider_callback_receipt(
  p_task_id text, p_timestamp text, p_signature_fingerprint text, p_attempt_hint uuid default null, p_correlation_hash text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_acc uuid := (select id from app_private.provider_accounts where provider = 'kie' and label = 'primary');
  v_receipt uuid;
  a app_private.provider_attempts;
  j public.generation_jobs;
begin
  insert into app_private.provider_event_receipts (provider_account_id, task_id, timestamp_text, signature_fingerprint, attempt_hint)
  values (v_acc, p_task_id, p_timestamp, p_signature_fingerprint, p_attempt_hint)
  on conflict (signature_fingerprint) do nothing
  returning id into v_receipt;
  if v_receipt is null then
    return jsonb_build_object('duplicate', true);
  end if;

  select * into a from app_private.provider_attempts where provider_account_id = v_acc and provider_task_id = p_task_id;
  if found then
    select * into j from public.generation_jobs where id = a.job_id;
    if j.state in ('provider_pending', 'processing_delayed', 'review_required') then
      perform app_private.enqueue_work('genlixs_control', 'job_check', j.id, 'check:' || j.id || ':cb:' || v_receipt, now(),
        jsonb_build_object('n', 1, 'trigger', 'callback'));
    end if;
    update app_private.provider_event_receipts set outcome = 'bound_recheck' where id = v_receipt;
    return jsonb_build_object('duplicate', false, 'action', 'recheck');
  end if;

  -- Unbound task: only a matching attempt id + correlation hash may request a verified binding check.
  if p_attempt_hint is not null and p_correlation_hash is not null then
    select * into a from app_private.provider_attempts
    where id = p_attempt_hint and correlation_token_hash = p_correlation_hash and state in ('submitting', 'unknown') and provider_task_id is null;
    if found then
      perform app_private.enqueue_work('genlixs_control', 'job_bind', a.job_id, 'bind:' || a.id || ':' || md5(p_task_id), now(),
        jsonb_build_object('attemptId', a.id, 'taskId', p_task_id));
      update app_private.provider_event_receipts set outcome = 'bind_check' where id = v_receipt;
      return jsonb_build_object('duplicate', false, 'action', 'bind_check');
    end if;
  end if;
  update app_private.provider_event_receipts set outcome = 'unbound_review' where id = v_receipt;
  return jsonb_build_object('duplicate', false, 'action', 'unbound');
end;
$$;

-- Binds an unknown submission to a task only after the worker compared the authoritative task detail
-- (callback URL carrying this attempt and correlation token) with the persisted attempt.
create or replace function public.worker_bind_task(p_work_item_id uuid, p_lease_token uuid, p_verified boolean, p_evidence text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w app_private.job_work_items := app_private.verify_lease(p_work_item_id, p_lease_token);
  a app_private.provider_attempts;
  j public.generation_jobs;
  v_task text := w.payload ->> 'taskId';
begin
  select * into a from app_private.provider_attempts where id = (w.payload ->> 'attemptId')::uuid for update;
  select * into j from public.generation_jobs where id = a.job_id for update;
  if not p_verified or a.provider_task_id is not null or j.state not in ('submitting', 'submission_unknown') then
    perform app_private.finish_work(w.id, 'done', 'binding not applied: ' || left(coalesce(p_evidence, ''), 200));
    return jsonb_build_object('action', 'none');
  end if;
  if exists (select 1 from app_private.provider_attempts where provider_account_id = a.provider_account_id and provider_task_id = v_task) then
    perform app_private.finish_work(w.id, 'done', 'task already bound elsewhere');
    return jsonb_build_object('action', 'none');
  end if;
  update app_private.provider_attempts set state = 'accepted', provider_task_id = v_task, responded_at = coalesce(responded_at, now()),
    error_message = left('bound from verified callback: ' || coalesce(p_evidence, ''), 300) where id = a.id;
  perform app_private.set_job_state(j.id, array['submitting', 'submission_unknown'], 'provider_pending',
    jsonb_build_object('nextActionAt', now()));
  perform app_private.job_event(j.id, 'accepted', 'Confirmed with the generation service. Generating.');
  perform app_private.enqueue_work('genlixs_control', 'job_check', j.id, 'check:' || j.id || ':bind', now(), jsonb_build_object('n', 1));
  perform app_private.finish_work(w.id, 'done');
  return jsonb_build_object('action', 'bound', 'taskId', v_task);
end;
$$;

-- --------------------------------------------------------- watchdog (§13.4)

create or replace function public.watchdog_tick()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_expired_leases int := 0;
  v_resent int := 0;
  v_delayed int := 0;
  v_deadline int := 0;
  v_lots int := 0;
  v_exists boolean;
begin
  -- 1. Expired leases. An expired submission lease is an unknown submission, never a blind resend.
  for r in select * from app_private.job_work_items where state = 'leased' and lease_expires_at < now() for update skip locked loop
    v_expired_leases := v_expired_leases + 1;
    if r.kind = 'job_submit' then
      update app_private.provider_attempts set state = 'unknown', error_code = 'LEASE_EXPIRED', responded_at = now()
      where work_item_id = r.id and state = 'submitting';
      if found then
        update public.generation_jobs set state = 'submission_unknown', state_version = state_version + 1
        where id = r.ref_id and state = 'submitting';
        perform app_private.job_event(r.ref_id, 'verifying', 'Verifying that the generation service received the request.');
        perform app_private.finish_work(r.id, 'done', 'lease expired during submission');
      else
        perform app_private.reschedule_work(r.id, 0, 'lease expired before submission');
      end if;
    else
      perform app_private.reschedule_work(r.id, 0, 'lease expired');
    end if;
  end loop;

  -- 2. Pending items whose queue message vanished (overdue by 2 minutes): send a new message.
  for r in select * from app_private.job_work_items where state = 'pending' and due_at < now() - interval '2 minutes' for update skip locked loop
    execute format('select exists (select 1 from pgmq.%I where msg_id = $1)', 'q_' || r.queue) into v_exists using r.last_msg_id;
    if not coalesce(v_exists, false) then
      perform app_private.queue_send(r.queue, r.id, 0);
      v_resent := v_resent + 1;
    end if;
  end loop;

  -- 3. Delayed notice.
  for r in select id from public.generation_jobs where state = 'provider_pending' and delayed_after_at < now() for update skip locked loop
    update public.generation_jobs set state = 'processing_delayed', state_version = state_version + 1 where id = r.id;
    perform app_private.job_event(r.id, 'delayed', 'Taking longer than usual. Your credits stay reserved; nothing is charged until the file is saved.');
    v_delayed := v_delayed + 1;
  end loop;

  -- 4. Customer deadline: release once, record a no-delivery outcome; supplier reconciliation continues separately.
  for r in
    select id, user_id, short_ref from public.generation_jobs
    where state not in ('succeeded', 'failed', 'cancelled') and customer_deadline_at < now()
    for update skip locked
  loop
    update public.generation_jobs set state = 'failed', state_version = state_version + 1, completed_at = now(),
      failure_code = 'DEADLINE', failure_message = 'The file was not delivered in time. Reserved credits were returned.',
      settlement_state = 'released'
    where id = r.id;
    perform app_private.release_reservation(r.id, 'No delivery before the deadline');
    update app_private.job_work_items set state = 'cancelled', lease_token = null where ref_id = r.id and state in ('pending', 'leased');
    perform app_private.job_event(r.id, 'failed', 'Not delivered before the deadline. Reserved credits returned.');
    perform app_private.notify(r.user_id, 'job_failed:' || r.id, 'job_failed', 'Generation not delivered',
      'Job ' || r.short_ref || ' was not delivered in time. The reserved credits were returned.', '/studio/library?job=' || r.id);
    v_deadline := v_deadline + 1;
  end loop;

  -- 5. Expire due unreserved credits (wallet locks one account at a time).
  for r in select distinct user_id from public.credit_lots where expires_at <= now() and available_units > 0 loop
    perform app_private.lock_wallet(r.user_id);
    v_lots := v_lots + app_private.expire_due_lots(r.user_id);
  end loop;

  insert into app_private.settings (key, value, description) values ('watchdog_heartbeat', to_jsonb(now()), 'Last watchdog run')
  on conflict (key) do update set value = excluded.value, updated_at = now();

  return jsonb_build_object('expiredLeases', v_expired_leases, 'resentMessages', v_resent, 'delayed', v_delayed,
    'deadlineReleases', v_deadline, 'expiredUnits', v_lots);
end;
$$;

-- Service-only execution for every worker/watchdog entry point.
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.worker_dequeue(text, int, int)', 'public.worker_claim(text, bigint, uuid, text)',
    'public.worker_begin_submission(uuid, uuid)', 'public.worker_record_submission(uuid, uuid, uuid, jsonb)',
    'public.worker_record_observation(uuid, uuid, jsonb)', 'public.worker_record_import(uuid, uuid, jsonb)',
    'public.worker_import_failed(uuid, uuid, text, boolean)', 'public.worker_defer(uuid, uuid, int, text)',
    'public.worker_complete(uuid, uuid, text)', 'public.provider_callback_receipt(text, text, text, uuid, text)',
    'public.worker_bind_task(uuid, uuid, boolean, text)', 'public.watchdog_tick()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end;
$$;
