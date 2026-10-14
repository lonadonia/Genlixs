-- Genlixs 08 · Support, admin operations, reporting, reconciliation, retention, watchdog and scheduler
-- (§12, §19.3, §21, §23). Every admin entry point checks a server-side capability and writes an audit row
-- for sensitive actions. There is no generic "set balance/status" endpoint and no SQL box (§19.3).

insert into app_private.staff_capabilities (role, capability) values
  ('operations', 'users.manage'), ('owner', 'users.manage'), ('finance', 'billing.read'), ('owner', 'billing.read')
on conflict do nothing;

-- -------------------------------------------------------------- support

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  short_ref text not null unique default app_private.short_ref('T'),
  user_id uuid not null references public.profiles (user_id),
  subject text not null check (char_length(subject) between 3 and 140),
  category text not null check (category in ('generation', 'billing', 'account', 'partner', 'other')),
  status text not null default 'open' check (status in ('open', 'waiting_for_customer', 'in_progress', 'resolved')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  job_id uuid references public.generation_jobs (id),
  order_id uuid references public.payment_orders (id),
  assigned_to uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index support_tickets_owner_idx on public.support_tickets (user_id, created_at desc);
create index support_tickets_queue_idx on public.support_tickets (status, created_at);
create trigger support_tickets_touch before update on public.support_tickets for each row execute function app_private.touch_updated_at();

create table public.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets (id),
  author_id uuid not null,
  author_role text not null check (author_role in ('customer', 'staff')),
  body text not null check (char_length(body) between 1 and 5000),
  attachment_asset_id uuid references public.assets (id),
  created_at timestamptz not null default now()
);
create index support_messages_ticket_idx on public.support_messages (ticket_id, created_at);
create trigger support_messages_append_only before update or delete on public.support_messages
  for each row execute function app_private.forbid_mutation();

alter table public.support_tickets enable row level security;
alter table public.support_messages enable row level security;
create policy tickets_owner_read on public.support_tickets for select to authenticated using ((select auth.uid()) = user_id);
create policy ticket_messages_owner_read on public.support_messages for select to authenticated
  using (exists (select 1 from public.support_tickets t where t.id = ticket_id and t.user_id = (select auth.uid())));
revoke all on public.support_tickets, public.support_messages from anon, authenticated;
grant select on public.support_tickets, public.support_messages to authenticated;

create or replace function public.create_support_ticket(p_subject text, p_category text, p_body text, p_job_id uuid default null, p_order_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
begin
  if v_uid is null then perform app_private.fail('UNAUTHENTICATED', 'Sign in to continue.'); end if;
  if (select count(*) from public.support_tickets where user_id = v_uid and created_at > now() - interval '1 hour') >= 5 then
    perform app_private.fail('RATE_LIMITED', 'You opened several requests in the last hour. Add details to an existing request instead.');
  end if;
  -- Context references must belong to the requester.
  if p_job_id is not null and not exists (select 1 from public.generation_jobs where id = p_job_id and user_id = v_uid) then
    perform app_private.fail('NOT_FOUND', 'Job not found.');
  end if;
  if p_order_id is not null and not exists (select 1 from public.payment_orders where id = p_order_id and user_id = v_uid) then
    perform app_private.fail('NOT_FOUND', 'Payment not found.');
  end if;
  insert into public.support_tickets (user_id, subject, category, job_id, order_id)
  values (v_uid, trim(p_subject), p_category, p_job_id, p_order_id) returning id into v_id;
  insert into public.support_messages (ticket_id, author_id, author_role, body) values (v_id, v_uid, 'customer', trim(p_body));
  return jsonb_build_object('ticketId', v_id, 'ref', (select short_ref from public.support_tickets where id = v_id));
end;
$$;
revoke execute on function public.create_support_ticket(text, text, text, uuid, uuid) from public, anon;
grant execute on function public.create_support_ticket(text, text, text, uuid, uuid) to authenticated;

create or replace function public.add_support_message(p_ticket_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.support_tickets;
begin
  select * into t from public.support_tickets where id = p_ticket_id and user_id = auth.uid() for update;
  if not found then perform app_private.fail('NOT_FOUND', 'Request not found.'); end if;
  insert into public.support_messages (ticket_id, author_id, author_role, body) values (t.id, auth.uid(), 'customer', trim(p_body));
  update public.support_tickets set status = case when status in ('waiting_for_customer', 'resolved') then 'open' else status end where id = t.id;
  return jsonb_build_object('ticketId', t.id);
end;
$$;
revoke execute on function public.add_support_message(uuid, text) from public, anon;
grant execute on function public.add_support_message(uuid, text) to authenticated;

create or replace function public.list_my_tickets()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'ref', t.short_ref, 'subject', t.subject, 'category', t.category,
    'status', t.status, 'jobRef', (select j.short_ref from public.generation_jobs j where j.id = t.job_id),
    'createdAt', t.created_at, 'updatedAt', t.updated_at,
    'messages', (select coalesce(jsonb_agg(jsonb_build_object('role', m.author_role, 'body', m.body, 'at', m.created_at) order by m.created_at), '[]')
      from public.support_messages m where m.ticket_id = t.id)
  ) order by t.updated_at desc), '[]')
  from public.support_tickets t where t.user_id = auth.uid();
$$;
revoke execute on function public.list_my_tickets() from public, anon;
grant execute on function public.list_my_tickets() to authenticated;

-- ------------------------------------------------------------- admin reads

create or replace function public.admin_me()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'userId', auth.uid(),
    'email', (select email from public.profiles where user_id = auth.uid()),
    'roles', (select coalesce(jsonb_agg(role), '[]') from app_private.staff_memberships where user_id = auth.uid() and active),
    'capabilities', to_jsonb(public.my_capabilities())
  );
$$;
revoke execute on function public.admin_me() from public, anon;
grant execute on function public.admin_me() to authenticated;

create or replace function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('admin.access');
  v_fin boolean := app_private.has_capability(v_actor, 'billing.read') or app_private.has_capability(v_actor, 'reports.read');
begin
  return jsonb_build_object(
    'generatedAt', now(),
    'service', jsonb_build_object(
      'generationPaused', coalesce((app_private.setting('generation_paused'))::text, 'false') = 'true',
      'watchdogHeartbeat', (app_private.setting('watchdog_heartbeat')) #>> '{}',
      'queues', (select coalesce(jsonb_agg(jsonb_build_object('queue', m.queue_name, 'length', m.queue_length, 'oldestSeconds', m.oldest_msg_age_sec)), '[]')
        from pgmq.metrics_all() m where m.queue_name like 'genlixs_%'),
      'oldestDueWorkSeconds', (select extract(epoch from now() - min(due_at))::int from app_private.job_work_items where state = 'pending' and due_at < now()),
      'deadLetters', (select count(*) from app_private.job_work_items where state = 'dead'),
      'providerBalance', (select jsonb_build_object('value', last_balance, 'observedAt', last_balance_at, 'paused', paused)
        from app_private.provider_accounts where provider = 'kie' and label = 'primary'),
      'models', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'state', state, 'verifiedAt', verified_at) order by sort_order), '[]') from app_private.model_catalog)
    ),
    'jobs24h', (select jsonb_build_object(
        'total', count(*), 'succeeded', count(*) filter (where state = 'succeeded'), 'failed', count(*) filter (where state = 'failed'),
        'running', count(*) filter (where state not in ('succeeded', 'failed', 'cancelled')),
        'delayed', count(*) filter (where state = 'processing_delayed'),
        'unknownSubmissions', count(*) filter (where state = 'submission_unknown'),
        'reviewRequired', count(*) filter (where state = 'review_required'),
        'p50Seconds', percentile_cont(0.5) within group (order by extract(epoch from completed_at - created_at)) filter (where state = 'succeeded'),
        'p95Seconds', percentile_cont(0.95) within group (order by extract(epoch from completed_at - created_at)) filter (where state = 'succeeded'))
      from public.generation_jobs where created_at > now() - interval '24 hours'),
    'actionQueue', jsonb_build_object(
      'reviewJobs', (select count(*) from public.generation_jobs where state in ('review_required', 'submission_unknown')),
      'pendingAffiliateApplications', (select count(*) from public.affiliate_accounts where state = 'applied'),
      'openTickets', (select count(*) from public.support_tickets where status in ('open', 'in_progress')),
      'unprocessedBillingReceipts', (select count(*) from app_private.billing_event_receipts where state = 'received' and received_at < now() - interval '5 minutes'),
      'failedBillingReceipts', (select count(*) from app_private.billing_event_receipts where state = 'failed'),
      'payoutBatchesOpen', (select count(*) from public.payout_batches where state in ('draft', 'reviewed', 'submitting', 'submission_unknown'))
    ),
    'finance', case when v_fin then jsonb_build_object(
      'collected30d', (select coalesce(jsonb_object_agg(currency, total), '{}') from (
          select currency, sum(amount_minor)::text as total from public.billing_transactions
          where kind = 'payment' and created_at > now() - interval '30 days' group by currency) x),
      'refunded30d', (select coalesce(jsonb_object_agg(currency, total), '{}') from (
          select currency, (-sum(amount_minor))::text as total from public.billing_transactions
          where kind = 'refund' and created_at > now() - interval '30 days' group by currency) x),
      'commissionsOutstanding', (select coalesce(jsonb_object_agg(currency, total), '{}') from (
          select currency, sum(amount_minor - reversed_minor)::text as total from public.commission_entries
          where state in ('pending_hold', 'eligible', 'reserved_for_payout') group by currency) x),
      'commissionsPaid', (select coalesce(jsonb_object_agg(currency, total), '{}') from (
          select currency, sum(amount_minor)::text as total from public.commission_entries where state = 'paid' group by currency) x),
      'supplierCredits30d', (select jsonb_build_object('measured', coalesce(sum(credits_consumed), 0), 'unknownCount', count(*) filter (where credits_consumed is null))
          from (select distinct on (job_id) job_id, credits_consumed from app_private.provider_observations
                where normalized_state in ('success', 'fail') and observed_at > now() - interval '30 days' order by job_id, observed_at desc) o),
      'creditsGranted30d', (select coalesce(sum(d_available), 0)::text from public.credit_ledger where event_type = 'grant' and created_at > now() - interval '30 days'),
      'creditsConsumed30d', (select coalesce(sum(d_spent), 0)::text from public.credit_ledger where event_type = 'capture' and created_at > now() - interval '30 days'),
      'note', 'Collected revenue, supplier consumption and commissions are reported separately; this is not net profit.'
    ) end,
    'recentActivity', (select coalesce(jsonb_agg(jsonb_build_object('action', l.action, 'targetKind', l.target_kind, 'targetId', l.target_id,
        'reason', l.reason, 'at', l.created_at)), '[]')
      from (select * from app_private.admin_audit_logs order by created_at desc limit 10) l)
  );
end;
$$;
revoke execute on function public.admin_overview() from public, anon;
grant execute on function public.admin_overview() to authenticated;

create or replace function public.admin_list_jobs(p_state text default null, p_model text default null, p_q text default null,
  p_before timestamptz default null, p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('jobs.read');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', j.id, 'ref', j.short_ref, 'customer', p.email, 'tool', j.tool, 'modelId', j.model_id,
      'state', j.state, 'settlementState', j.settlement_state, 'units', j.units::text, 'createdAt', j.created_at,
      'waitSeconds', extract(epoch from coalesce(j.completed_at, now()) - j.created_at)::int,
      'taskId', (select t.provider_task_id from app_private.provider_attempts t where t.job_id = j.id order by t.ordinal desc limit 1),
      'supplierCredits', (select o.credits_consumed from app_private.provider_observations o where o.job_id = j.id and o.credits_consumed is not null
                          order by o.observed_at desc limit 1),
      'failureCode', j.failure_code) order by j.created_at desc)
    from (
      select * from public.generation_jobs j0
      where (p_state is null or j0.state = p_state
             or (p_state = 'attention' and j0.state in ('submission_unknown', 'review_required', 'processing_delayed')))
        and (p_model is null or j0.model_id = p_model)
        and (p_before is null or j0.created_at < p_before)
        and (p_q is null or j0.short_ref ilike p_q || '%' or j0.id::text = p_q
             or exists (select 1 from app_private.provider_attempts t where t.job_id = j0.id and t.provider_task_id = p_q)
             or exists (select 1 from public.profiles pp where pp.user_id = j0.user_id and pp.email ilike p_q || '%'))
      order by j0.created_at desc
      limit least(greatest(coalesce(p_limit, 50), 1), 200)
    ) j join public.profiles p on p.user_id = j.user_id
  ), '[]');
end;
$$;
revoke execute on function public.admin_list_jobs(text, text, text, timestamptz, int) from public, anon;
grant execute on function public.admin_list_jobs(text, text, text, timestamptz, int) to authenticated;

-- Prompt and reference content is restricted by default: included only for jobs.operate (§12).
create or replace function public.admin_job_detail(p_job text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('jobs.read');
  v_full boolean := app_private.has_capability(v_actor, 'jobs.operate');
  j public.generation_jobs;
begin
  select * into j from public.generation_jobs where id::text = p_job or short_ref = upper(p_job);
  if not found then perform app_private.fail('NOT_FOUND', 'Job not found.'); end if;
  return jsonb_build_object(
    'job', app_private.job_snapshot(j.id) - case when v_full then 'zzz' else 'prompt' end,
    'customer', (select jsonb_build_object('userId', p.user_id, 'email', p.email, 'status', p.account_status) from public.profiles p where p.user_id = j.user_id),
    'quote', (select jsonb_build_object('id', q.id, 'priceVersionId', q.price_version_id, 'units', q.units::text, 'createdAt', q.created_at)
              from public.generation_quotes q where q.id = j.quote_id),
    'reservation', (select jsonb_build_object('state', r.state, 'units', r.units::text, 'settledAt', r.settled_at, 'reason', r.settlement_reason)
              from public.credit_reservations r where r.job_id = j.id),
    'attempts', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'ordinal', t.ordinal, 'state', t.state, 'taskId', t.provider_task_id,
              'errorCode', t.error_code, 'errorMessage', t.error_message, 'submittedAt', t.submitted_at, 'respondedAt', t.responded_at) order by t.ordinal), '[]')
              from app_private.provider_attempts t where t.job_id = j.id),
    'observations', (select coalesce(jsonb_agg(jsonb_build_object('state', o.provider_state, 'normalized', o.normalized_state, 'failCode', o.fail_code,
              'failMessage', o.fail_message, 'creditsConsumed', o.credits_consumed, 'costTime', o.cost_time_seconds, 'source', o.source,
              'at', o.observed_at) order by o.observed_at desc), '[]')
              from (select * from app_private.provider_observations where job_id = j.id order by observed_at desc limit 30) o),
    'work', (select coalesce(jsonb_agg(jsonb_build_object('kind', w.kind, 'state', w.state, 'dueAt', w.due_at, 'attempts', w.attempt_count,
              'lastError', w.last_error, 'actionKey', w.action_key) order by w.created_at), '[]')
              from app_private.job_work_items w where w.ref_id = j.id),
    'canOperate', v_full
  );
end;
$$;
revoke execute on function public.admin_job_detail(text) from public, anon;
grant execute on function public.admin_job_detail(text) to authenticated;

-- Allowlisted, state-bound job operations (§19.3). None creates a new generation or a second charge.
create or replace function public.admin_job_action(p_job_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('jobs.operate');
  j public.generation_jobs;
  a app_private.provider_attempts;
  o app_private.provider_observations;
  v_key text := extract(epoch from clock_timestamp())::bigint::text;
begin
  if coalesce(trim(p_reason), '') = '' then perform app_private.fail('REASON_REQUIRED', 'A reason is required.'); end if;
  select * into j from public.generation_jobs where id = p_job_id for update;
  if not found then perform app_private.fail('NOT_FOUND', 'Job not found.'); end if;

  if p_action = 'recheck' then
    -- Authoritative status read for the same known task.
    if not exists (select 1 from app_private.provider_attempts where job_id = j.id and provider_task_id is not null) then
      perform app_private.fail('NO_TASK', 'This job has no known provider task to check.');
    end if;
    if j.state = 'submission_unknown' then
      update public.generation_jobs set state = 'provider_pending', state_version = state_version + 1 where id = j.id;
    end if;
    perform app_private.enqueue_work('genlixs_control', 'job_check', j.id, 'check:' || j.id || ':admin:' || v_key, now(), jsonb_build_object('n', 1, 'trigger', 'admin'));

  elsif p_action = 'retry_import' then
    select * into o from app_private.provider_observations where job_id = j.id and normalized_state = 'success' order by observed_at desc limit 1;
    if o.id is null or j.state not in ('review_required', 'importing') then
      perform app_private.fail('INVALID_STATE', 'Import can be retried only for a job with a recorded provider success.');
    end if;
    if j.state = 'review_required' then
      perform app_private.set_job_state(j.id, array['review_required'], 'importing');
    end if;
    perform app_private.enqueue_work('genlixs_media', 'job_import', j.id, 'import:' || j.id || ':admin:' || v_key, now(),
      jsonb_build_object('taskId', o.task_id, 'urls', o.result_urls,
        'expected', (select coalesce((c.spec -> 'output' ->> 'count')::int, 1) from app_private.model_capability_versions c where c.id = j.capability_version_id)));

  elsif p_action = 'attach_task' then
    -- Unknown submission: ask the worker to verify a provider task against this attempt before binding.
    select * into a from app_private.provider_attempts where job_id = j.id and state in ('unknown', 'submitting') and provider_task_id is null
    order by ordinal desc limit 1;
    if a.id is null or j.state not in ('submission_unknown', 'review_required') then
      perform app_private.fail('INVALID_STATE', 'Only an unknown submission can be attached to a verified task.');
    end if;
    if coalesce(p_payload ->> 'taskId', '') !~ '^[A-Za-z0-9_-]{4,120}$' then
      perform app_private.fail('INVALID_TASK_ID', 'Enter the provider task id.');
    end if;
    if j.state = 'review_required' then
      update public.generation_jobs set state = 'submission_unknown', state_version = state_version + 1 where id = j.id;
    end if;
    perform app_private.enqueue_work('genlixs_control', 'job_bind', j.id, 'bind:' || a.id || ':admin:' || v_key, now(),
      jsonb_build_object('attemptId', a.id, 'taskId', p_payload ->> 'taskId', 'adminAttach', true));

  elsif p_action = 'release' then
    -- Reviewed no-delivery outcome: release once with a reason (only non-terminal jobs).
    if j.state in ('succeeded', 'failed', 'cancelled') then
      perform app_private.fail('INVALID_STATE', 'This job is already settled.');
    end if;
    update public.generation_jobs set state = 'failed', state_version = state_version + 1, completed_at = now(), settlement_state = 'released',
      failure_code = 'REVIEWED_NO_DELIVERY', failure_message = 'This job was reviewed and not delivered. Reserved credits were returned.'
    where id = j.id;
    perform app_private.release_reservation(j.id, 'Reviewed no-delivery: ' || left(p_reason, 120));
    update app_private.job_work_items set state = 'cancelled', lease_token = null where ref_id = j.id and state in ('pending', 'leased');
    perform app_private.job_event(j.id, 'failed', 'Reviewed by our team and not delivered. Reserved credits returned.');
    perform app_private.notify(j.user_id, 'job_failed:' || j.id, 'job_failed', 'Generation not delivered',
      'Job ' || j.short_ref || ' was not delivered. The reserved credits were returned.', '/studio/library?job=' || j.id);
  else
    perform app_private.fail('INVALID_ACTION', 'Unknown action.');
  end if;

  perform app_private.audit(v_actor, 'jobs.operate', 'job.' || p_action, 'generation_job', j.id::text, p_reason,
    jsonb_build_object('state', j.state, 'settlement', j.settlement_state),
    (select jsonb_build_object('state', state, 'settlement', settlement_state) from public.generation_jobs where id = j.id));
  return public.admin_job_detail(j.id::text);
end;
$$;
revoke execute on function public.admin_job_action(uuid, text, text, jsonb) from public, anon;
grant execute on function public.admin_job_action(uuid, text, text, jsonb) to authenticated;

create or replace function public.admin_list_users(p_q text default null, p_before timestamptz default null, p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('users.read');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('userId', p.user_id, 'email', p.email, 'status', p.account_status, 'joinedAt', p.created_at,
      'availableUnits', app_private.spendable_units(p.user_id)::text, 'reservedUnits', w.reserved_units::text,
      'jobs', (select count(*) from public.generation_jobs j where j.user_id = p.user_id),
      'plan', (select pv.name from public.subscriptions s join app_private.product_versions pv on pv.id = s.product_version_id
               where s.user_id = p.user_id and s.status in ('active', 'trialing', 'past_due', 'cancel_at_period_end') limit 1),
      'attributedTo', (select a.id from app_private.affiliate_attributions t join public.affiliate_accounts a on a.id = t.affiliate_id where t.customer_id = p.user_id)
    ) order by p.created_at desc)
    from (select * from public.profiles p0
          where (p_q is null or p0.email ilike '%' || p_q || '%' or p0.user_id::text = p_q)
            and (p_before is null or p0.created_at < p_before)
          order by p0.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) p
    left join public.wallet_accounts w on w.user_id = p.user_id
  ), '[]');
end;
$$;
revoke execute on function public.admin_list_users(text, timestamptz, int) from public, anon;
grant execute on function public.admin_list_users(text, timestamptz, int) to authenticated;

create or replace function public.admin_set_account_status(p_user_id uuid, p_status text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('users.manage');
  v_before text;
begin
  if p_status not in ('active', 'suspended') or coalesce(trim(p_reason), '') = '' then
    perform app_private.fail('INVALID_INPUT', 'Choose active or suspended and give a reason.');
  end if;
  select account_status into v_before from public.profiles where user_id = p_user_id for update;
  if v_before is null then perform app_private.fail('NOT_FOUND', 'User not found.'); end if;
  -- Suspension blocks new actions; accepted work and financial evidence are untouched (§12).
  update public.profiles set account_status = p_status, suspension_reason = case when p_status = 'suspended' then left(p_reason, 300) end
  where user_id = p_user_id;
  perform app_private.audit(v_actor, 'users.manage', 'user.' || p_status, 'user', p_user_id::text, p_reason,
    jsonb_build_object('status', v_before), jsonb_build_object('status', p_status));
  return jsonb_build_object('userId', p_user_id, 'status', p_status);
end;
$$;
revoke execute on function public.admin_set_account_status(uuid, text, text) from public, anon;
grant execute on function public.admin_set_account_status(uuid, text, text) to authenticated;

-- Signed adjustment: positive creates a distinct lot; negative revokes available units only (never negative,
-- never touching active reservations). Original journals stay intact (§12, §19.3).
create or replace function public.admin_adjust_credits(p_user_id uuid, p_units bigint, p_category text, p_reason text, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('credits.adjust');
  v_owner boolean := app_private.has_capability(v_actor, 'staff.manage');
  v_need bigint;
  v_take bigint;
  r record;
  v_lot uuid;
begin
  if p_units = 0 or coalesce(trim(p_reason), '') = '' or p_category not in ('goodwill', 'correction', 'promotion', 'support') then
    perform app_private.fail('INVALID_INPUT', 'Give a non-zero amount, a category and a reason.');
  end if;
  if abs(p_units) > 5000 and not v_owner then
    perform app_private.fail('LIMIT_EXCEEDED', 'Adjustments above 5,000 credits need the owner.');
  end if;
  if exists (select 1 from public.credit_ledger where idempotency_key like 'admin:' || p_idempotency_key || '%') then
    return jsonb_build_object('replayed', true);
  end if;
  if p_units > 0 then
    v_lot := app_private.grant_lot(p_user_id, 'admin_adjustment', 'admin:' || p_idempotency_key, p_units, null, null,
      p_category || ': ' || left(p_reason, 120), v_actor);
  else
    perform app_private.lock_wallet(p_user_id);
    perform app_private.expire_due_lots(p_user_id);
    v_need := -p_units;
    if app_private.spendable_units(p_user_id) < v_need then
      perform app_private.fail('INSUFFICIENT_AVAILABLE', 'The customer does not have that many available credits; reservations are never touched.');
    end if;
    for r in select id, available_units from public.credit_lots
             where user_id = p_user_id and available_units > 0 and not restricted and (expires_at is null or expires_at > now())
             order by expires_at nulls last, created_at, id for update loop
      exit when v_need = 0;
      v_take := least(v_need, r.available_units);
      update public.credit_lots set available_units = available_units - v_take, revoked_units = revoked_units + v_take where id = r.id;
      insert into public.credit_ledger (user_id, lot_id, event_type, event_key, idempotency_key, d_available, d_revoked, actor_id, note)
      values (p_user_id, r.id, 'admin_adjustment', 'admin:' || p_idempotency_key, 'admin:' || p_idempotency_key || ':' || r.id, -v_take, v_take,
        v_actor, p_category || ': ' || left(p_reason, 120));
      v_need := v_need - v_take;
    end loop;
    perform app_private.wallet_apply(p_user_id, p_units, 0, 0, 0, -p_units);
  end if;
  perform app_private.audit(v_actor, 'credits.adjust', 'credits.adjust', 'user', p_user_id::text, p_reason, null,
    jsonb_build_object('units', p_units, 'category', p_category));
  return jsonb_build_object('userId', p_user_id, 'units', p_units::text, 'availableUnits', app_private.spendable_units(p_user_id)::text);
end;
$$;
revoke execute on function public.admin_adjust_credits(uuid, bigint, text, text, text) from public, anon;
grant execute on function public.admin_adjust_credits(uuid, bigint, text, text, text) to authenticated;

create or replace function public.admin_list_payments(p_state text default null, p_before timestamptz default null, p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('billing.read');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', o.id, 'ref', o.short_ref, 'customer', p.email, 'product', o.product_name, 'kind', o.kind,
      'amountMinor', o.amount_minor::text, 'currency', o.currency, 'refundedMinor', o.refunded_minor::text, 'state', o.state,
      'gateway', o.gateway, 'gatewayPaymentId', o.gateway_payment_id, 'createdAt', o.created_at, 'paidAt', o.paid_at,
      'attributed', exists (select 1 from public.commission_entries c where c.order_id = o.id)) order by o.created_at desc)
    from (select * from public.payment_orders o0 where (p_state is null or o0.state = p_state) and (p_before is null or o0.created_at < p_before)
          order by o0.created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) o
    join public.profiles p on p.user_id = o.user_id
  ), '[]');
end;
$$;
revoke execute on function public.admin_list_payments(text, timestamptz, int) from public, anon;
grant execute on function public.admin_list_payments(text, timestamptz, int) to authenticated;

create or replace function public.admin_list_affiliates(p_state text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('admin.access');
begin
  if not (app_private.has_capability(v_actor, 'affiliates.review') or app_private.has_capability(v_actor, 'affiliates.fraud')) then
    perform app_private.fail('FORBIDDEN', 'Your role does not allow this action.');
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', a.id, 'email', p.email, 'state', a.state, 'tier', a.tier, 'qualifyingCustomers', a.qualifying_customers,
      'application', a.application, 'agreementVersion', (select v.version from public.affiliate_agreement_versions v where v.id = a.agreement_version_id),
      'createdAt', a.created_at, 'reviewedAt', a.reviewed_at,
      'pendingMinor', (select coalesce(sum(c.amount_minor - c.reversed_minor), 0)::text from public.commission_entries c where c.affiliate_id = a.id and c.state = 'pending_hold'),
      'availableMinor', (select coalesce(sum(c.amount_minor - c.reversed_minor), 0)::text from public.commission_entries c where c.affiliate_id = a.id and c.state = 'eligible'),
      'paidMinor', (select coalesce(sum(c.amount_minor), 0)::text from public.commission_entries c where c.affiliate_id = a.id and c.state = 'paid'),
      'destination', (select jsonb_build_object('method', d.method, 'hint', d.display_hint, 'verified', d.verified, 'changedAt', d.changed_at)
                      from app_private.payout_destinations d where d.affiliate_id = a.id)
    ) order by a.created_at desc)
    from public.affiliate_accounts a join public.profiles p on p.user_id = a.user_id
    where p_state is null or a.state = p_state
  ), '[]');
end;
$$;
revoke execute on function public.admin_list_affiliates(text) from public, anon;
grant execute on function public.admin_list_affiliates(text) to authenticated;

create or replace function public.admin_list_payout_batches()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('payouts.prepare');
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', b.id, 'ref', b.short_ref, 'currency', b.currency, 'state', b.state, 'totalMinor', b.total_minor::text,
      'preparedBy', (select email from public.profiles where user_id = b.prepared_by),
      'approvedBy', (select email from public.profiles where user_id = b.approved_by),
      'singleOwnerException', b.single_owner_exception, 'reference', b.transfer_reference, 'createdAt', b.created_at, 'paidAt', b.paid_at,
      'items', (select coalesce(jsonb_agg(jsonb_build_object('affiliateId', i.affiliate_id, 'email', p.email, 'amountMinor', i.amount_minor::text,
                'kind', case when i.commission_id is not null then 'commission' else 'adjustment' end, 'active', i.active)), '[]')
                from public.payout_items i join public.affiliate_accounts a on a.id = i.affiliate_id join public.profiles p on p.user_id = a.user_id
                where i.batch_id = b.id)
    ) order by b.created_at desc)
    from public.payout_batches b
  ), '[]');
end;
$$;
revoke execute on function public.admin_list_payout_batches() from public, anon;
grant execute on function public.admin_list_payout_batches() to authenticated;

-- --------------------------------------------------------- admin: catalog

create or replace function public.admin_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('admin.access');
  v_cost boolean := app_private.has_capability(v_actor, 'pricing.review') or app_private.has_capability(v_actor, 'catalog.publish');
begin
  return jsonb_build_object(
    'models', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'tool', m.tool, 'name', m.public_name, 'providerModelId', m.provider_model_id,
        'adapter', m.adapter, 'adapterVersion', m.adapter_version, 'state', m.state, 'note', m.availability_note, 'verifiedAt', m.verified_at,
        'verificationNote', m.verification_note,
        'capability', (select jsonb_build_object('version', c.version, 'spec', c.spec) from app_private.capability_for(m.id) c),
        'prices', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'version', p.version, 'state', p.state, 'rules', p.rules,
            'supplierCost', case when v_cost then p.supplier_cost_snapshot end, 'evidence', case when v_cost then p.cost_evidence end,
            'effectiveAt', p.effective_at) order by p.version desc), '[]') from app_private.price_versions p where p.model_id = m.id)
      ) order by m.sort_order), '[]') from app_private.model_catalog m),
    'products', (select coalesce(jsonb_agg(jsonb_build_object('id', pv.id, 'key', pv.product_key, 'version', pv.version, 'kind', pv.kind, 'name', pv.name,
        'currency', pv.currency, 'amountMinor', pv.amount_minor::text, 'credits', pv.credits::text, 'interval', pv.billing_interval,
        'creditExpiryDays', pv.credit_expiry_days, 'state', pv.state, 'gatewayMapping', pv.gateway_mapping) order by pv.sort_order, pv.version desc), '[]')
      from app_private.product_versions pv),
    'agreements', (select coalesce(jsonb_agg(to_jsonb(v) - 'published_by' order by v.version desc), '[]') from public.affiliate_agreement_versions v),
    'settings', (select coalesce(jsonb_object_agg(s.key, s.value), '{}') from app_private.settings s where s.key not in ('owner_bootstrap_open'))
  );
end;
$$;
revoke execute on function public.admin_catalog() from public, anon;
grant execute on function public.admin_catalog() to authenticated;

-- Operations can pause/maintain models; enabling requires a recorded verification and a published price.
create or replace function public.admin_set_model_state(p_model_id text, p_state text, p_note text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('catalog.operate');
  m app_private.model_catalog;
begin
  if p_state not in ('enabled', 'experimental', 'maintenance', 'disabled') or coalesce(trim(p_reason), '') = '' then
    perform app_private.fail('INVALID_INPUT', 'Choose a valid state and give a reason.');
  end if;
  select * into m from app_private.model_catalog where id = p_model_id for update;
  if not found then perform app_private.fail('NOT_FOUND', 'Model not found.'); end if;
  if p_state in ('enabled', 'experimental') then
    if m.verified_at is null then
      perform app_private.fail('MODEL_NOT_VERIFIED', 'Record a verified paid test (owner) before enabling this model.');
    end if;
    if not exists (select 1 from app_private.price_versions p where p.model_id = m.id and p.state = 'published'
                   and p.capability_version_id = (app_private.capability_for(m.id)).id) then
      perform app_private.fail('MODEL_NOT_PRICED', 'Publish an approved price for the current capability version first.');
    end if;
  end if;
  update app_private.model_catalog set state = p_state, availability_note = nullif(trim(p_note), '') where id = m.id;
  perform app_private.audit(v_actor, 'catalog.operate', 'model.state', 'model', m.id, p_reason,
    jsonb_build_object('state', m.state), jsonb_build_object('state', p_state));
  return jsonb_build_object('modelId', m.id, 'state', p_state);
end;
$$;
revoke execute on function public.admin_set_model_state(text, text, text, text) from public, anon;
grant execute on function public.admin_set_model_state(text, text, text, text) to authenticated;

create or replace function public.admin_record_model_verification(p_model_id text, p_evidence text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('catalog.publish');
begin
  if coalesce(trim(p_evidence), '') = '' then perform app_private.fail('EVIDENCE_REQUIRED', 'Describe the paid test: date, task id, cost, output.'); end if;
  update app_private.model_catalog set verified_at = now(), verification_note = left(p_evidence, 1000) where id = p_model_id;
  if not found then perform app_private.fail('NOT_FOUND', 'Model not found.'); end if;
  perform app_private.audit(v_actor, 'catalog.publish', 'model.verify', 'model', p_model_id, p_evidence);
  return jsonb_build_object('modelId', p_model_id, 'verifiedAt', now());
end;
$$;
revoke execute on function public.admin_record_model_verification(text, text) from public, anon;
grant execute on function public.admin_record_model_verification(text, text) to authenticated;

-- Draft a new immutable price version for the current capability version (finance review).
create or replace function public.admin_create_price_version(p_model_id text, p_rules jsonb, p_supplier_cost jsonb, p_evidence text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('pricing.review');
  c app_private.model_capability_versions := app_private.capability_for(p_model_id);
  v_id uuid;
  k text;
  v_spec jsonb;
  v_min bigint;
begin
  if c.id is null then perform app_private.fail('NOT_FOUND', 'Model not found.'); end if;
  if jsonb_typeof(p_rules -> 'base') <> 'number' or (p_rules ->> 'base')::bigint <= 0 then
    perform app_private.fail('INVALID_RULES', 'Price rules need a positive base number of credits.');
  end if;
  -- Every add-rule must name a declared option value; every combination must stay positive.
  for k in select jsonb_object_keys(coalesce(p_rules -> 'add', '{}'::jsonb)) loop
    v_spec := c.spec -> 'options' -> k;
    if v_spec is null then perform app_private.fail('INVALID_RULES', 'Unknown option in price rules: ' || k); end if;
  end loop;
  select (p_rules ->> 'base')::bigint + coalesce(sum(least(0, (select min(x.v::bigint) from jsonb_each_text(p_rules -> 'add' -> o.k) x(kk, v)))), 0)
  into v_min from jsonb_object_keys(coalesce(p_rules -> 'add', '{}'::jsonb)) as o(k);
  if v_min <= 0 then perform app_private.fail('INVALID_RULES', 'Some setting combinations would cost zero or less.'); end if;
  insert into app_private.price_versions (model_id, capability_version_id, version, state, rules, supplier_cost_snapshot, cost_evidence, created_by)
  values (p_model_id, c.id, coalesce((select max(version) from app_private.price_versions where model_id = p_model_id), 0) + 1, 'draft',
    p_rules, p_supplier_cost, p_evidence, v_actor)
  returning id into v_id;
  perform app_private.audit(v_actor, 'pricing.review', 'price.draft', 'price_version', v_id::text, p_evidence, null, p_rules);
  return jsonb_build_object('priceVersionId', v_id);
end;
$$;
revoke execute on function public.admin_create_price_version(text, jsonb, jsonb, text) from public, anon;
grant execute on function public.admin_create_price_version(text, jsonb, jsonb, text) to authenticated;

-- Publication creates the new current version; accepted jobs keep their own version (§12).
create or replace function public.admin_publish_price_version(p_price_version_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('catalog.publish');
  p app_private.price_versions;
begin
  if coalesce(trim(p_reason), '') = '' then perform app_private.fail('REASON_REQUIRED', 'A reason is required.'); end if;
  select * into p from app_private.price_versions where id = p_price_version_id for update;
  if not found or p.state <> 'draft' then perform app_private.fail('INVALID_STATE', 'Only a draft price version can be published.'); end if;
  if p.capability_version_id <> (app_private.capability_for(p.model_id)).id then
    perform app_private.fail('STALE_CAPABILITY', 'This price was drafted for an older capability version.');
  end if;
  if coalesce(trim(p.cost_evidence), '') = '' or p.cost_evidence like 'DRAFT%' then
    perform app_private.fail('EVIDENCE_REQUIRED', 'Record the supplier cost evidence (paid test) before publishing.');
  end if;
  update app_private.price_versions set state = 'retired' where model_id = p.model_id and state = 'published';
  update app_private.price_versions set state = 'published', effective_at = now(), published_by = v_actor where id = p.id;
  perform app_private.audit(v_actor, 'catalog.publish', 'price.publish', 'price_version', p.id::text, p_reason, null, p.rules);
  return jsonb_build_object('priceVersionId', p.id, 'state', 'published');
end;
$$;
revoke execute on function public.admin_publish_price_version(uuid, text) from public, anon;
grant execute on function public.admin_publish_price_version(uuid, text) to authenticated;

create or replace function public.admin_save_product_draft(p_product_key text, p_kind text, p_name text, p_currency text, p_amount_minor bigint,
  p_credits bigint, p_interval text, p_credit_expiry_days int, p_gateway_mapping jsonb, p_description text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('pricing.review');
  v_id uuid;
begin
  if p_product_key !~ '^[a-z0-9-]{2,40}$' then perform app_private.fail('INVALID_INPUT', 'Use a short lowercase product key.'); end if;
  insert into app_private.product_versions (product_key, version, kind, name, description, currency, amount_minor, credits, billing_interval,
    credit_expiry_days, gateway_mapping, created_by, sort_order)
  values (p_product_key, coalesce((select max(version) from app_private.product_versions where product_key = p_product_key), 0) + 1,
    p_kind, p_name, p_description, upper(p_currency), p_amount_minor, p_credits, case when p_kind = 'subscription' then coalesce(p_interval, 'month') end,
    p_credit_expiry_days, coalesce(p_gateway_mapping, '{}'::jsonb), v_actor,
    coalesce((select max(sort_order) from app_private.product_versions where product_key = p_product_key), 10))
  returning id into v_id;
  perform app_private.audit(v_actor, 'pricing.review', 'product.draft', 'product_version', v_id::text, 'draft saved', null,
    jsonb_build_object('key', p_product_key, 'amountMinor', p_amount_minor, 'currency', p_currency, 'credits', p_credits));
  return jsonb_build_object('productVersionId', v_id);
end;
$$;
revoke execute on function public.admin_save_product_draft(text, text, text, text, bigint, bigint, text, int, jsonb, text) from public, anon;
grant execute on function public.admin_save_product_draft(text, text, text, text, bigint, bigint, text, int, jsonb, text) to authenticated;

create or replace function public.admin_publish_product_version(p_product_version_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('catalog.publish');
  pv app_private.product_versions;
begin
  if coalesce(trim(p_reason), '') = '' then perform app_private.fail('REASON_REQUIRED', 'A reason is required.'); end if;
  select * into pv from app_private.product_versions where id = p_product_version_id for update;
  if not found or pv.state <> 'draft' then perform app_private.fail('INVALID_STATE', 'Only a draft product can be published.'); end if;
  update app_private.product_versions set state = 'retired' where product_key = pv.product_key and state = 'published';
  update app_private.product_versions set state = 'published', effective_at = now(), published_by = v_actor where id = pv.id;
  perform app_private.audit(v_actor, 'catalog.publish', 'product.publish', 'product_version', pv.id::text, p_reason);
  return jsonb_build_object('productVersionId', pv.id, 'state', 'published');
end;
$$;
revoke execute on function public.admin_publish_product_version(uuid, text) from public, anon;
grant execute on function public.admin_publish_product_version(uuid, text) to authenticated;

create or replace function public.admin_retire_product(p_product_key text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('catalog.publish');
begin
  update app_private.product_versions set state = 'retired' where product_key = p_product_key and state = 'published';
  perform app_private.audit(v_actor, 'catalog.publish', 'product.retire', 'product', p_product_key, p_reason);
  return jsonb_build_object('productKey', p_product_key, 'state', 'retired');
end;
$$;
revoke execute on function public.admin_retire_product(text, text) from public, anon;
grant execute on function public.admin_retire_product(text, text) to authenticated;

-- Publishing the partner agreement; existing partners keep their accepted version (§13).
create or replace function public.admin_publish_agreement(p_agreement_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('catalog.publish');
  v public.affiliate_agreement_versions;
begin
  if coalesce(trim(p_reason), '') = '' then perform app_private.fail('REASON_REQUIRED', 'A reason is required.'); end if;
  select * into v from public.affiliate_agreement_versions where id = p_agreement_id for update;
  if not found or v.state <> 'draft' then perform app_private.fail('INVALID_STATE', 'Only a draft agreement can be published.'); end if;
  update public.affiliate_agreement_versions set state = 'retired' where state = 'published';
  update public.affiliate_agreement_versions set state = 'published', published_at = now(), published_by = v_actor where id = v.id;
  perform app_private.audit(v_actor, 'catalog.publish', 'agreement.publish', 'affiliate_agreement', v.id::text, p_reason);
  return jsonb_build_object('agreementId', v.id, 'version', v.version, 'state', 'published');
end;
$$;
revoke execute on function public.admin_publish_agreement(uuid, text) from public, anon;
grant execute on function public.admin_publish_agreement(uuid, text) to authenticated;

-- Allowlisted operational settings. Generation pause is an operations switch; policy values need settings.manage.
create or replace function public.admin_set_setting(p_key text, p_value jsonb, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_before jsonb;
begin
  if p_key = 'generation_paused' then
    v_actor := app_private.require_capability('catalog.operate');
  elsif p_key in ('quote_ttl_seconds', 'reservation_deadline_hours', 'delayed_after_minutes', 'max_active_jobs_per_user', 'max_quotes_per_minute',
                  'provider_create_budget_per_10s', 'output_retention_days', 'reference_retention_days', 'promo_credit_days', 'signup_promo_units') then
    v_actor := app_private.require_capability('settings.manage');
  else
    perform app_private.fail('INVALID_SETTING', 'This setting cannot be changed here.');
  end if;
  if coalesce(trim(p_reason), '') = '' then perform app_private.fail('REASON_REQUIRED', 'A reason is required.'); end if;
  if p_key = 'generation_paused' and jsonb_typeof(p_value) <> 'boolean' then perform app_private.fail('INVALID_VALUE', 'Expected true or false.'); end if;
  if p_key <> 'generation_paused' and (jsonb_typeof(p_value) <> 'number' or (p_value #>> '{}')::numeric < 0) then
    perform app_private.fail('INVALID_VALUE', 'Expected a non-negative number.');
  end if;
  select value into v_before from app_private.settings where key = p_key for update;
  update app_private.settings set value = p_value, updated_by = v_actor, updated_at = now() where key = p_key;
  perform app_private.audit(v_actor, 'settings', 'setting.' || p_key, 'setting', p_key, p_reason, v_before, p_value);
  return jsonb_build_object('key', p_key, 'value', p_value);
end;
$$;
revoke execute on function public.admin_set_setting(text, jsonb, text) from public, anon;
grant execute on function public.admin_set_setting(text, jsonb, text) to authenticated;

create or replace function public.admin_list_staff()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('staff.manage');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('userId', m.user_id, 'email', p.email, 'role', m.role, 'active', m.active, 'since', m.created_at)
    order by m.created_at) from app_private.staff_memberships m left join public.profiles p on p.user_id = m.user_id), '[]');
end;
$$;
revoke execute on function public.admin_list_staff() from public, anon;
grant execute on function public.admin_list_staff() to authenticated;

-- Owner-only, audited. The route additionally requires a recent sign-in (and MFA once enabled, §7.2).
create or replace function public.admin_set_staff_role(p_email text, p_role text, p_active boolean, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('staff.manage');
  v_uid uuid;
begin
  if p_role not in ('support', 'operations', 'finance', 'owner') or coalesce(trim(p_reason), '') = '' then
    perform app_private.fail('INVALID_INPUT', 'Choose a role and give a reason.');
  end if;
  select user_id into v_uid from public.profiles where lower(email) = lower(p_email);
  if v_uid is null then perform app_private.fail('NOT_FOUND', 'No account with that email. Ask them to sign up first.'); end if;
  if v_uid = v_actor and p_role = 'owner' and not p_active then
    perform app_private.fail('SELF_LOCKOUT', 'You cannot remove your own owner role.');
  end if;
  insert into app_private.staff_memberships (user_id, role, active, assigned_by) values (v_uid, p_role, p_active, v_actor)
  on conflict (user_id, role) do update set active = excluded.active, assigned_by = excluded.assigned_by;
  perform app_private.audit(v_actor, 'staff.manage', 'staff.role', 'user', v_uid::text, p_reason, null,
    jsonb_build_object('role', p_role, 'active', p_active));
  return jsonb_build_object('userId', v_uid, 'role', p_role, 'active', p_active);
end;
$$;
revoke execute on function public.admin_set_staff_role(text, text, boolean, text) from public, anon;
grant execute on function public.admin_set_staff_role(text, text, boolean, text) to authenticated;

create or replace function public.admin_audit_log(p_before timestamptz default null, p_limit int default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('audit.read');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'actor', p.email, 'capability', l.capability, 'action', l.action,
      'targetKind', l.target_kind, 'targetId', l.target_id, 'reason', l.reason, 'before', l.before_state, 'after', l.after_state, 'at', l.created_at)
      order by l.created_at desc)
    from (select * from app_private.admin_audit_logs where p_before is null or created_at < p_before order by created_at desc
          limit least(greatest(coalesce(p_limit, 100), 1), 500)) l
    left join public.profiles p on p.user_id = l.actor_id), '[]');
end;
$$;
revoke execute on function public.admin_audit_log(timestamptz, int) from public, anon;
grant execute on function public.admin_audit_log(timestamptz, int) to authenticated;

-- Support queue: staff see only the operational context they need (§10).
create or replace function public.admin_list_tickets(p_status text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('support.read');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'ref', t.short_ref, 'customer', p.email, 'subject', t.subject, 'category', t.category,
      'status', t.status, 'priority', t.priority, 'jobRef', (select j.short_ref from public.generation_jobs j where j.id = t.job_id), 'jobId', t.job_id,
      'orderRef', (select o.short_ref from public.payment_orders o where o.id = t.order_id),
      'assignedTo', (select email from public.profiles where user_id = t.assigned_to), 'createdAt', t.created_at, 'updatedAt', t.updated_at,
      'messages', (select coalesce(jsonb_agg(jsonb_build_object('role', m.author_role, 'body', m.body, 'at', m.created_at) order by m.created_at), '[]')
        from public.support_messages m where m.ticket_id = t.id)) order by t.updated_at desc)
    from public.support_tickets t join public.profiles p on p.user_id = t.user_id
    where p_status is null or t.status = p_status), '[]');
end;
$$;
revoke execute on function public.admin_list_tickets(text) from public, anon;
grant execute on function public.admin_list_tickets(text) to authenticated;

-- Opening a case never sends a reply or performs a financial action; replying is explicit.
create or replace function public.admin_reply_ticket(p_ticket_id uuid, p_body text, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('support.reply');
  t public.support_tickets;
begin
  select * into t from public.support_tickets where id = p_ticket_id for update;
  if not found then perform app_private.fail('NOT_FOUND', 'Ticket not found.'); end if;
  if p_status not in ('open', 'waiting_for_customer', 'in_progress', 'resolved') then perform app_private.fail('INVALID_STATE', 'Invalid status.'); end if;
  if coalesce(trim(p_body), '') <> '' then
    insert into public.support_messages (ticket_id, author_id, author_role, body) values (t.id, v_actor, 'staff', trim(p_body));
    perform app_private.notify(t.user_id, 'support_reply:' || t.id || ':' || extract(epoch from clock_timestamp())::bigint, 'support',
      'New reply on ' || t.short_ref, left(trim(p_body), 140), '/studio/support');
  end if;
  update public.support_tickets set status = p_status, assigned_to = coalesce(assigned_to, v_actor) where id = t.id;
  return jsonb_build_object('ticketId', t.id, 'status', p_status);
end;
$$;
revoke execute on function public.admin_reply_ticket(uuid, text, text) from public, anon;
grant execute on function public.admin_reply_ticket(uuid, text, text) to authenticated;

-- ------------------------------------------------------- reconciliation

-- Daily consistency check (§10.4): mismatches are reported, never "fixed" by overwriting balances.
create or replace function public.reconcile_wallets()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'walletVsLots', (select coalesce(jsonb_agg(jsonb_build_object('userId', w.user_id, 'wallet', jsonb_build_array(w.available_units, w.reserved_units, w.spent_units),
        'lots', jsonb_build_array(l.a, l.r, l.s))), '[]')
      from public.wallet_accounts w
      join (select user_id, sum(available_units) a, sum(reserved_units) r, sum(spent_units) s from public.credit_lots group by user_id) l on l.user_id = w.user_id
      where (w.available_units, w.reserved_units, w.spent_units) <> (l.a, l.r, l.s)),
    'lotsVsLedger', (select coalesce(jsonb_agg(jsonb_build_object('lotId', l.id)), '[]')
      from public.credit_lots l
      join (select lot_id, sum(d_available) a, sum(d_reserved) r, sum(d_spent) s, sum(d_expired) e, sum(d_revoked) v from public.credit_ledger
            where lot_id is not null group by lot_id) g on g.lot_id = l.id
      where (l.available_units, l.reserved_units, l.spent_units, l.expired_units, l.revoked_units) <> (g.a, g.r, g.s, g.e, g.v)),
    'openAllocationMismatch', (select coalesce(jsonb_agg(r.id), '[]') from public.credit_reservations r
      where r.state = 'open' and r.units <> (select coalesce(sum(units), 0) from app_private.credit_reservation_allocations x where x.reservation_id = r.id)),
    'terminalJobsWithOpenReservation', (select coalesce(jsonb_agg(j.short_ref), '[]') from public.generation_jobs j
      join public.credit_reservations r on r.job_id = j.id where j.state in ('succeeded', 'failed', 'cancelled') and r.state = 'open'),
    'succeededWithoutCapture', (select coalesce(jsonb_agg(j.short_ref), '[]') from public.generation_jobs j
      join public.credit_reservations r on r.job_id = j.id where j.state = 'succeeded' and r.state <> 'captured'),
    'succeededWithoutAsset', (select coalesce(jsonb_agg(j.short_ref), '[]') from public.generation_jobs j
      where j.state = 'succeeded' and not exists (select 1 from public.assets a where a.job_id = j.id and a.kind = 'output')),
    'queuedWithoutWork', (select coalesce(jsonb_agg(j.short_ref), '[]') from public.generation_jobs j
      where j.state = 'queued' and not exists (select 1 from app_private.job_work_items w where w.ref_id = j.id and w.kind = 'job_submit' and w.state in ('pending', 'leased'))),
    'checkedAt', now()
  );
$$;
revoke execute on function public.reconcile_wallets() from public, anon, authenticated;
grant execute on function public.reconcile_wallets() to service_role;

create or replace function public.admin_reconciliation()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('reports.read');
begin
  return public.reconcile_wallets();
end;
$$;
revoke execute on function public.admin_reconciliation() from public, anon;
grant execute on function public.admin_reconciliation() to authenticated;

-- ------------------------------------------------------------ retention

create or replace function public.worker_asset_deleted(p_work_item_id uuid, p_lease_token uuid, p_ok boolean, p_error text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  w app_private.job_work_items := app_private.verify_lease(p_work_item_id, p_lease_token);
begin
  if p_ok then
    update public.assets set state = 'deleted', deleted_at = coalesce(deleted_at, now()) where id = w.ref_id and state in ('deleting', 'expired');
    perform app_private.finish_work(w.id, 'done');
    return jsonb_build_object('action', 'deleted');
  end if;
  perform app_private.reschedule_work(w.id, least(3600, 60 * w.attempt_count), left(p_error, 300));
  return jsonb_build_object('action', 'retry');
end;
$$;
revoke execute on function public.worker_asset_deleted(uuid, uuid, boolean, text) from public, anon, authenticated;
grant execute on function public.worker_asset_deleted(uuid, uuid, boolean, text) to service_role;

-- Health for the internal endpoint (service only): counts, never keys or customer data (§23.1).
create or replace function public.system_health()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'watchdogHeartbeat', (app_private.setting('watchdog_heartbeat')) #>> '{}',
    'oldestDueWorkSeconds', (select extract(epoch from now() - min(due_at))::int from app_private.job_work_items where state = 'pending' and due_at < now()),
    'leased', (select count(*) from app_private.job_work_items where state = 'leased'),
    'deadLetters', (select count(*) from app_private.job_work_items where state = 'dead'),
    'unknownSubmissions', (select count(*) from public.generation_jobs where state = 'submission_unknown'),
    'reviewRequired', (select count(*) from public.generation_jobs where state = 'review_required'),
    'unprocessedBillingReceipts', (select count(*) from app_private.billing_event_receipts where state = 'received' and received_at < now() - interval '5 minutes'),
    'generationPaused', coalesce((app_private.setting('generation_paused'))::text, 'false') = 'true'
  );
$$;
revoke execute on function public.system_health() from public, anon, authenticated;
grant execute on function public.system_health() to service_role;

create or replace function public.record_provider_balance(p_balance numeric)
returns void
language sql
security definer
set search_path = ''
as $$
  update app_private.provider_accounts set last_balance = p_balance, last_balance_at = now() where provider = 'kie' and label = 'primary';
$$;
revoke execute on function public.record_provider_balance(numeric) from public, anon, authenticated;
grant execute on function public.record_provider_balance(numeric) to service_role;

-- ------------------------------------------------------------- watchdog

-- Extends the generation watchdog with commission maturity, upload-intent expiry and retention work.
create or replace function public.watchdog_maintenance()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_matured int;
  v_intents int;
  v_retention int := 0;
  r record;
begin
  v_matured := app_private.mature_commissions();
  update public.upload_intents set state = 'expired' where state = 'pending' and expires_at < now();
  get diagnostics v_intents = row_count;
  -- Retention: outputs past their deadline and references no longer needed by an open job become durable deletions.
  for r in
    select a.id from public.assets a
    where a.state in ('ready', 'validated') and a.retention_until < now()
      and not exists (select 1 from public.generation_jobs j where a.id = any (j.reference_asset_ids) and j.state not in ('succeeded', 'failed', 'cancelled'))
    limit 500 for update skip locked
  loop
    update public.assets set state = 'deleting' where id = r.id;
    update public.share_links set revoked_at = coalesce(revoked_at, now()) where asset_id = r.id;
    v_retention := v_retention + 1;
  end loop;
  for r in select id from public.assets where state = 'deleting' loop
    perform app_private.enqueue_work('genlixs_media', 'asset_delete', r.id, 'delete:' || r.id, now(), '{}'::jsonb);
  end loop;
  return jsonb_build_object('maturedCommissions', v_matured, 'expiredIntents', v_intents, 'retentionDeletes', v_retention);
end;
$$;
revoke execute on function public.watchdog_maintenance() from public, anon, authenticated;
grant execute on function public.watchdog_maintenance() to service_role;

-- ------------------------------------------------------------ scheduler

-- Wakes the Vercel workers only when the owner has stored the worker URL and token in Vault (§13.3).
-- Without them it does nothing: queued work stays durable until workers are reachable.
create or replace function app_private.wake_workers(p_kind text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_token text;
  v_req bigint;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'genlixs_worker_base_url';
  select decrypted_secret into v_token from vault.decrypted_secrets where name = 'genlixs_worker_token';
  if v_url is null or v_token is null then
    return null;
  end if;
  select net.http_post(
    url := v_url || '/api/internal/workers/' || p_kind,
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_token),
    body := jsonb_build_object('trigger', 'supabase-cron'),
    timeout_milliseconds := case when p_kind = 'media' then 60000 else 30000 end
  ) into v_req;
  return v_req;
end;
$$;
revoke execute on function app_private.wake_workers(text) from public, anon, authenticated;

select cron.schedule('genlixs-watchdog', '* * * * *', $cron$ select public.watchdog_tick(); select public.watchdog_maintenance(); $cron$);
select cron.schedule('genlixs-wake-control', '* * * * *', $cron$ select app_private.wake_workers('control'); $cron$);
select cron.schedule('genlixs-wake-media', '* * * * *', $cron$ select app_private.wake_workers('media'); $cron$);
select cron.schedule('genlixs-wake-events', '* * * * *', $cron$ select app_private.wake_workers('events'); $cron$);
