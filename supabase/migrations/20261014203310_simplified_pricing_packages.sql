-- Genlixs 15c · Simplified pricing, part 3: package bonus credits and one-step package editing, the admin reads
-- (catalog, model detail, settings section) and the KIE balance valued at the KIE purchase reference.

-- =====================================================================================================
-- Packages: bonus credits and one-step editing
-- =====================================================================================================

-- "credits" stays the usable credits granted per purchase or paid cycle (what orders snapshot and grants use);
-- bonus_credits says how many of them are a bonus. Included credits = credits − bonus_credits.
alter table app_private.product_versions add column bonus_credits bigint not null default 0;
alter table app_private.product_versions add constraint product_versions_bonus_check check (bonus_credits >= 0 and bonus_credits < credits);
comment on column app_private.product_versions.credits is 'Usable credits granted per purchase or paid cycle (included + bonus).';
comment on column app_private.product_versions.bonus_credits is 'Part of credits that is a bonus (display only; the grant is credits).';

create or replace function app_private.product_versions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if old.state <> 'draft' then raise exception 'only draft products can be deleted'; end if;
    return old;
  end if;
  if old.state <> 'draft' and (new.amount_minor <> old.amount_minor or new.credits <> old.credits or new.currency <> old.currency
      or new.kind <> old.kind or new.credit_expiry_days is distinct from old.credit_expiry_days or new.bonus_credits <> old.bonus_credits) then
    raise exception 'published product terms are immutable; create a new version';
  end if;
  return new;
end;
$$;

-- Edits one package: a new version when its name, price or credits change; offering it publishes that version
-- (replacing the previous one), not offering it retires the published version. Other packages are never touched.
-- Existing orders and subscriptions keep the version they were bought with.
create or replace function public.admin_save_package(p_product_key text, p_name text, p_amount_minor bigint, p_included_credits bigint,
  p_bonus_credits bigint, p_offered boolean, p_expected_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('pricing.review');
  v_name text := trim(coalesce(p_name, ''));
  v_bonus bigint := coalesce(p_bonus_credits, 0);
  v_offered boolean := coalesce(p_offered, false);
  latest app_private.product_versions;
  pub app_private.product_versions;
  base app_private.product_versions;
  v_target uuid;
  v_changed boolean;
  v_ver int;
  v_desc text;
begin
  perform pg_advisory_xact_lock(hashtext('genlixs:packages:' || coalesce(p_product_key, '')));
  select * into latest from app_private.product_versions where product_key = p_product_key order by version desc limit 1;
  if latest.id is null then perform app_private.fail('NOT_FOUND', 'Package not found.'); end if;
  select * into pub from app_private.product_versions where product_key = p_product_key and state = 'published';
  if (v_offered or pub.id is not null) and not app_private.has_capability(v_actor, 'catalog.publish') then
    perform app_private.fail('FORBIDDEN', 'Only the owner can change packages that customers can buy.', jsonb_build_object('capability', 'catalog.publish'));
  end if;
  if latest.id is distinct from p_expected_version_id then
    perform app_private.fail('PACKAGE_CHANGED', 'This package was changed by someone else since you opened it. Reload to see the latest values.');
  end if;
  if char_length(v_name) not between 2 and 60 then perform app_private.fail('INVALID_INPUT', 'Use a package name of 2–60 characters.'); end if;
  if p_amount_minor is null or p_amount_minor < 1 or p_amount_minor > 100000000 then
    perform app_private.fail('INVALID_INPUT', 'Enter a price above zero.');
  end if;
  if p_included_credits is null or p_included_credits < 1 or v_bonus < 0 or p_included_credits + v_bonus > 10000000 then
    perform app_private.fail('INVALID_INPUT', 'Included credits must be at least 1 and bonus credits cannot be negative.');
  end if;
  -- The version shown in the editor: the one customers can buy, otherwise the latest.
  if pub.id is not null then base := pub; else base := latest; end if;
  v_changed := base.name <> v_name or base.amount_minor <> p_amount_minor or base.credits <> p_included_credits + v_bonus or base.bonus_credits <> v_bonus;
  if not v_changed and v_offered = (pub.id is not null) then
    return jsonb_build_object('unchanged', true, 'productVersionId', base.id);
  end if;
  v_target := base.id;
  if v_changed or (v_offered and base.state = 'retired') then
    select coalesce(max(version), 0) + 1 into v_ver from app_private.product_versions where product_key = p_product_key;
    insert into app_private.product_versions (product_key, version, kind, name, description, currency, amount_minor, credits, bonus_credits,
      billing_interval, credit_expiry_days, max_active_jobs, gateway_mapping, sort_order, created_by)
    values (p_product_key, v_ver, base.kind, v_name, base.description, base.currency, p_amount_minor, p_included_credits + v_bonus, v_bonus,
      base.billing_interval, base.credit_expiry_days, base.max_active_jobs, base.gateway_mapping, base.sort_order, v_actor)
    returning id into v_target;
  end if;
  update app_private.product_versions set state = 'retired' where product_key = p_product_key and state = 'draft' and id <> v_target;
  if v_offered then
    if pub.id is distinct from v_target then
      update app_private.product_versions set state = 'retired' where product_key = p_product_key and state = 'published';
      update app_private.product_versions set state = 'published', effective_at = now(), published_by = v_actor where id = v_target;
    end if;
  else
    update app_private.product_versions set state = 'retired' where product_key = p_product_key and state = 'published';
  end if;
  v_desc := v_name || ': ' || base.currency || ' ' || to_char(p_amount_minor / 100.0, 'FM999999990.00') || ' for ' || p_included_credits || ' credits'
    || case when v_bonus > 0 then ' + ' || v_bonus || ' bonus' else '' end
    || case when v_offered then ', offered to customers' else ', not offered' end;
  perform app_private.audit(v_actor, case when v_offered or pub.id is not null then 'catalog.publish' else 'pricing.review' end, 'product.save',
    'product_version', v_target::text, 'Updated package ' || v_desc,
    jsonb_build_object('version', base.version, 'name', base.name, 'amountMinor', base.amount_minor, 'credits', base.credits, 'bonusCredits', base.bonus_credits,
      'offered', pub.id is not null),
    jsonb_build_object('name', v_name, 'amountMinor', p_amount_minor, 'credits', p_included_credits + v_bonus, 'bonusCredits', v_bonus, 'offered', v_offered));
  return jsonb_build_object('unchanged', false, 'productVersionId', v_target, 'offered', v_offered);
end;
$$;
revoke execute on function public.admin_save_package(text, text, bigint, bigint, bigint, boolean, uuid) from public, anon;
grant execute on function public.admin_save_package(text, text, bigint, bigint, bigint, boolean, uuid) to authenticated;

create or replace function public.get_products()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'key', p.product_key,
    'version', p.version,
    'kind', p.kind,
    'name', p.name,
    'description', p.description,
    'currency', p.currency,
    'amountMinor', p.amount_minor::text,
    'credits', p.credits::text,
    'bonusCredits', p.bonus_credits::text,
    'interval', p.billing_interval,
    'creditExpiryDays', p.credit_expiry_days
  ) order by p.sort_order), '[]')
  from app_private.product_versions p
  where p.state = 'published';
$$;
revoke execute on function public.get_products() from public;
grant execute on function public.get_products() to anon, authenticated;

-- =====================================================================================================
-- Admin reads
-- =====================================================================================================

create or replace function public.admin_catalog()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('admin.access');
  v_cost boolean := app_private.has_capability(v_actor, 'pricing.review') or app_private.has_capability(v_actor, 'catalog.publish')
                    or app_private.has_capability(v_actor, 'provider.read');
  v_basis jsonb := app_private.credit_basis();
  v_assump jsonb := app_private.pricing_assumptions();
  v_models jsonb := '[]'::jsonb;
  v_t jsonb;
  m app_private.model_catalog;
  c app_private.model_capability_versions;
begin
  for m in select * from app_private.model_catalog order by sort_order, id loop
    c := app_private.capability_for(m.id);
    v_t := app_private.model_price_table(m.id, null, v_basis, v_assump, false);
    v_models := v_models || jsonb_build_array(jsonb_build_object(
      'id', m.id, 'tool', m.tool, 'category', app_private.model_category(m.tool), 'name', m.public_name, 'family', m.family,
      'variant', m.variant_label, 'badges', to_jsonb(m.badges), 'purpose', m.purpose,
      'providerModelId', m.provider_model_id, 'adapter', m.adapter, 'adapterVersion', m.adapter_version,
      'adapterImplemented', exists (select 1 from app_private.provider_adapters a where a.adapter = m.adapter),
      'state', m.state, 'note', m.availability_note, 'enableBasis', m.enable_basis, 'availabilityChangedAt', m.availability_changed_at,
      'verifiedAt', m.verified_at, 'verificationNote', m.verification_note, 'verificationStatus', m.verification_status,
      'verifiedCurrent', m.verified_capability_version_id = c.id,
      'docsUrl', m.provider_docs_url, 'pricingUrl', m.provider_pricing_url, 'sourceCheckedAt', m.source_checked_at,
      'capability', jsonb_build_object('id', c.id, 'version', c.version, 'spec', c.spec),
      'prices', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'version', p.version, 'state', p.state, 'rules', p.rules, 'source', p.source,
          'supplierCost', case when v_cost then p.supplier_cost_snapshot end, 'evidence', case when v_cost then p.cost_evidence end,
          'effectiveAt', p.effective_at, 'currentCapability', p.capability_version_id = c.id) order by p.version desc), '[]')
        from app_private.price_versions p where p.model_id = m.id),
      'pricing', jsonb_build_object('published', v_t -> 'published', 'draft', v_t -> 'draft', 'minUnits', v_t -> 'summary' -> 'minUnits',
        'maxUnits', v_t -> 'summary' -> 'maxUnits', 'configCount', v_t -> 'configCount',
        'markupMin', case when v_cost then v_t -> 'summary' -> 'markupMin' end, 'markupMax', case when v_cost then v_t -> 'summary' -> 'markupMax' end,
        'belowCost', case when v_cost then v_t -> 'summary' -> 'belowCostConfigs' end, 'override', v_t -> 'override'),
      'cost', case when v_cost then (v_t -> 'cost') || jsonb_build_object('minCredits', v_t -> 'summary' -> 'minSupplierCredits',
        'maxCredits', v_t -> 'summary' -> 'maxSupplierCredits', 'complete', v_t ->> 'status' not in ('missing_cost', 'incomplete_cost'),
        'lossConfigsUplift', v_t -> 'summary' -> 'lossConfigsUplift') end,
      'lastTest', (select jsonb_build_object('status', t.status, 'at', coalesce(t.completed_at, t.created_at), 'ref', j.short_ref, 'jobId', t.job_id)
        from app_private.model_test_runs t join public.generation_jobs j on j.id = t.job_id where t.model_id = m.id order by t.created_at desc limit 1),
      'readiness', app_private.model_readiness(m.id)
    ));
  end loop;
  return jsonb_build_object(
    'models', v_models,
    'products', (select coalesce(jsonb_agg(jsonb_build_object('id', pv.id, 'key', pv.product_key, 'version', pv.version, 'kind', pv.kind, 'name', pv.name,
        'description', pv.description, 'currency', pv.currency, 'amountMinor', pv.amount_minor::text, 'credits', pv.credits::text,
        'bonusCredits', pv.bonus_credits::text, 'includedCredits', (pv.credits - pv.bonus_credits)::text, 'interval', pv.billing_interval,
        'creditExpiryDays', pv.credit_expiry_days, 'state', pv.state, 'gatewayMapping', pv.gateway_mapping, 'effectiveAt', pv.effective_at,
        'createdAt', pv.created_at) order by pv.sort_order, pv.version desc), '[]')
      from app_private.product_versions pv),
    'references', case when v_cost then jsonb_build_object(
      'kie', app_private.reference_json(app_private.current_reference('kie_purchase')),
      'credit', app_private.reference_json(app_private.current_reference('credit_value')),
      'history', (select coalesce(jsonb_agg(x.j order by x.created_at desc), '[]')
        from (select app_private.reference_json(r) j, r.created_at from app_private.pricing_reference_versions r order by r.created_at desc limit 20) x)) end,
    'promotions', jsonb_build_object('signupUnits', app_private.setting('signup_promo_units'), 'promoDays', app_private.setting('promo_credit_days')),
    'agreements', (select coalesce(jsonb_agg(to_jsonb(v) - 'published_by' order by v.version desc), '[]') from public.affiliate_agreement_versions v),
    'settings', (select coalesce(jsonb_object_agg(s.key, s.value), '{}') from app_private.settings s where s.key not in ('owner_bootstrap_open')),
    'economics', case when v_cost then jsonb_build_object('basis', v_basis, 'assumptions', v_assump) end,
    'access', jsonb_build_object(
      'canSeeCosts', v_cost,
      'canPrice', app_private.has_capability(v_actor, 'pricing.review'),
      'canPublish', app_private.has_capability(v_actor, 'catalog.publish'),
      'canOperate', app_private.has_capability(v_actor, 'catalog.operate'),
      'canTest', app_private.has_capability(v_actor, 'catalog.test'),
      'canReadProvider', app_private.has_capability(v_actor, 'provider.read'),
      'canManageSettings', app_private.has_capability(v_actor, 'settings.manage'))
  );
end;
$$;

create or replace function public.admin_model_detail(p_model_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('admin.access');
  v_cost boolean := app_private.has_capability(v_actor, 'pricing.review') or app_private.has_capability(v_actor, 'catalog.publish')
                    or app_private.has_capability(v_actor, 'provider.read');
  m app_private.model_catalog;
  c app_private.model_capability_versions;
begin
  select * into m from app_private.model_catalog where id = p_model_id;
  if not found then perform app_private.fail('NOT_FOUND', 'Model not found.'); end if;
  c := app_private.capability_for(m.id);
  return jsonb_build_object(
    'model', jsonb_build_object('id', m.id, 'tool', m.tool, 'category', app_private.model_category(m.tool), 'name', m.public_name,
      'family', m.family, 'variant', m.variant_label, 'badges', to_jsonb(m.badges), 'purpose', m.purpose, 'state', m.state,
      'note', m.availability_note, 'enableBasis', m.enable_basis, 'verificationStatus', m.verification_status,
      'verifiedCurrent', m.verified_capability_version_id = c.id, 'verifiedAt', m.verified_at, 'verificationNote', m.verification_note,
      'providerModelId', m.provider_model_id, 'adapter', m.adapter, 'adapterVersion', m.adapter_version,
      'docsUrl', m.provider_docs_url, 'pricingUrl', m.provider_pricing_url, 'sourceCheckedAt', m.source_checked_at,
      'capability', jsonb_build_object('id', c.id, 'version', c.version, 'spec', c.spec)),
    'readiness', app_private.model_readiness(m.id),
    'table', case when v_cost then app_private.model_price_table(m.id, null, app_private.credit_basis(), app_private.pricing_assumptions(), false) end,
    'costVersions', case when v_cost then (select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'version', s.version, 'schedule', s.schedule,
        'usdPerCredit', s.usd_per_credit, 'sourceKind', s.source_kind, 'sourceUrl', s.source_url, 'checkedAt', s.source_checked_at, 'note', s.note,
        'createdBy', pp.email, 'createdAt', s.created_at) order by s.version desc), '[]')
      from app_private.supplier_cost_versions s left join public.profiles pp on pp.user_id = s.created_by where s.model_id = m.id) end,
    'prices', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'version', p.version, 'state', p.state, 'source', p.source, 'rules', p.rules,
        'effectiveAt', p.effective_at, 'createdAt', p.created_at, 'publishedBy', pb.email, 'createdBy', pc.email, 'markupBps', p.markup_bps,
        'batchRef', b.short_ref, 'restoredFromVersion', (select r.version from app_private.price_versions r where r.id = p.restored_from),
        'evidence', case when v_cost then p.cost_evidence end, 'capabilityVersion', cv.version, 'currentCapability', p.capability_version_id = c.id)
        order by p.version desc), '[]')
      from app_private.price_versions p
      join app_private.model_capability_versions cv on cv.id = p.capability_version_id
      left join app_private.pricing_batches b on b.id = p.batch_id
      left join public.profiles pb on pb.user_id = p.published_by
      left join public.profiles pc on pc.user_id = p.created_by
      where p.model_id = m.id),
    'tests', app_private.model_tests_json(m.id, 20),
    'evidence', (select coalesce(jsonb_agg(jsonb_build_object('kind', e.kind, 'outcome', e.outcome, 'note', e.note, 'taskId', e.task_id,
        'recordedBy', pe.email, 'at', e.recorded_at) order by e.recorded_at desc), '[]')
      from app_private.model_verification_evidence e left join public.profiles pe on pe.user_id = e.recorded_by where e.model_id = m.id),
    'activity', (select coalesce(jsonb_agg(jsonb_build_object('action', l.action, 'reason', l.reason, 'actor', pa.email, 'at', l.created_at,
        'targetKind', l.target_kind, 'targetId', l.target_id, 'before', l.before_state, 'after', l.after_state) order by l.created_at desc), '[]')
      from (select * from app_private.admin_audit_logs l0
            where (l0.target_kind = 'model' and l0.target_id = m.id)
               or (l0.target_kind = 'price_version' and l0.target_id in (select id::text from app_private.price_versions where model_id = m.id))
               or (l0.target_kind = 'pricing_batch' and l0.target_id in (select batch_id::text from app_private.pricing_batch_items where model_id = m.id))
            order by l0.created_at desc limit 50) l
      left join public.profiles pa on pa.user_id = l.actor_id),
    'economics', case when v_cost then jsonb_build_object('basis', app_private.credit_basis(), 'assumptions', app_private.pricing_assumptions()) end,
    'access', jsonb_build_object('canSeeCosts', v_cost, 'canPrice', app_private.has_capability(v_actor, 'pricing.review'),
      'canPublish', app_private.has_capability(v_actor, 'catalog.publish'), 'canOperate', app_private.has_capability(v_actor, 'catalog.operate'),
      'canTest', app_private.has_capability(v_actor, 'catalog.test'))
  );
end;
$$;

-- Operational settings and partner terms for their own admin sections (Overview and Partners).
create or replace function public.admin_settings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('admin.access');
begin
  return jsonb_build_object(
    'settings', (select coalesce(jsonb_agg(jsonb_build_object('key', s.key, 'value', s.value, 'description', s.description, 'updatedAt', s.updated_at)
        order by s.key), '[]')
      from app_private.settings s
      where s.key in ('generation_paused', 'quote_ttl_seconds', 'reservation_deadline_hours', 'delayed_after_minutes', 'max_active_jobs_per_user',
        'max_quotes_per_minute', 'provider_create_budget_per_10s', 'output_retention_days', 'reference_retention_days', 'promo_credit_days',
        'signup_promo_units')),
    'agreements', (select coalesce(jsonb_agg(jsonb_build_object('id', v.id, 'version', v.version, 'state', v.state, 'baseBps', v.base_rate_bps,
        'upliftBps', v.uplift_rate_bps, 'threshold', v.uplift_threshold, 'effectiveAt', v.effective_at) order by v.version desc), '[]')
      from public.affiliate_agreement_versions v),
    'access', jsonb_build_object('canOperate', app_private.has_capability(v_actor, 'catalog.operate'),
      'canManageSettings', app_private.has_capability(v_actor, 'settings.manage'),
      'canPublish', app_private.has_capability(v_actor, 'catalog.publish'))
  );
end;
$$;
revoke execute on function public.admin_settings() from public, anon;
grant execute on function public.admin_settings() to authenticated;

-- KIE balance: the USD estimate uses the KIE purchase reference.
create or replace function public.admin_provider_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('provider.read');
  acc app_private.provider_accounts;
  v_usd numeric := app_private.kie_usd_per_credit();
begin
  select * into acc from app_private.provider_accounts where provider = 'kie' and label = 'primary';
  return jsonb_build_object(
    'generatedAt', now(),
    'balance', jsonb_build_object('credits', acc.last_balance, 'observedAt', acc.last_balance_at, 'lastAttemptAt', acc.last_balance_attempt_at,
      'lastError', acc.last_balance_error, 'lastErrorAt', acc.last_balance_error_at, 'threshold', acc.low_balance_threshold,
      'low', acc.last_balance is not null and acc.low_balance_threshold is not null and acc.last_balance < acc.low_balance_threshold,
      'paused', acc.paused, 'usdPerCredit', v_usd,
      'approxUsd', case when acc.last_balance is not null and v_usd is not null then round(acc.last_balance * v_usd, 2) end,
      'reference', app_private.reference_json(app_private.current_reference('kie_purchase'))),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('ok', s.ok, 'credits', s.credits, 'error', s.error_code, 'source', s.source, 'at', s.observed_at)
        order by s.observed_at desc), '[]')
      from (select * from app_private.provider_balance_snapshots where provider_account_id = acc.id order by observed_at desc limit 20) s),
    'spend', (
      with obs as (
        select distinct on (o.job_id) o.job_id, o.credits_consumed, o.observed_at
        from app_private.provider_observations o
        where o.observed_at > now() - interval '30 days' and o.credits_consumed is not null
        order by o.job_id, o.observed_at desc
      ), settled as (
        select j.id, j.purpose, j.model_id, j.completed_at, obs.credits_consumed
        from public.generation_jobs j left join obs on obs.job_id = j.id
        where j.completed_at > now() - interval '30 days' and j.state in ('succeeded', 'failed')
          and exists (select 1 from app_private.provider_attempts a where a.job_id = j.id and a.provider_task_id is not null)
      )
      select jsonb_build_object(
        'timezone', 'UTC',
        'today', jsonb_build_object(
          'customerCredits', coalesce(sum(credits_consumed) filter (where purpose = 'customer' and completed_at >= date_trunc('day', now())), 0),
          'testCredits', coalesce(sum(credits_consumed) filter (where purpose = 'staff_test' and completed_at >= date_trunc('day', now())), 0),
          'unmeasuredJobs', count(*) filter (where credits_consumed is null and completed_at >= date_trunc('day', now()))),
        'days7', jsonb_build_object(
          'customerCredits', coalesce(sum(credits_consumed) filter (where purpose = 'customer' and completed_at >= now() - interval '7 days'), 0),
          'testCredits', coalesce(sum(credits_consumed) filter (where purpose = 'staff_test' and completed_at >= now() - interval '7 days'), 0),
          'unmeasuredJobs', count(*) filter (where credits_consumed is null and completed_at >= now() - interval '7 days')),
        'days30', jsonb_build_object(
          'customerCredits', coalesce(sum(credits_consumed) filter (where purpose = 'customer'), 0),
          'testCredits', coalesce(sum(credits_consumed) filter (where purpose = 'staff_test'), 0),
          'unmeasuredJobs', count(*) filter (where credits_consumed is null)),
        'byModel30d', (select coalesce(jsonb_agg(jsonb_build_object('modelId', x.model_id, 'name', mc.public_name, 'customerCredits', x.cc,
            'testCredits', x.tc, 'jobs', x.n, 'unmeasuredJobs', x.um) order by (x.cc + x.tc) desc), '[]')
          from (select model_id, coalesce(sum(credits_consumed) filter (where purpose = 'customer'), 0) cc,
                       coalesce(sum(credits_consumed) filter (where purpose = 'staff_test'), 0) tc, count(*) n,
                       count(*) filter (where credits_consumed is null) um
                from settled group by model_id) x
          left join app_private.model_catalog mc on mc.id = x.model_id)
      ) from settled
    ),
    'jobs', (select jsonb_build_object(
        'queued', count(*) filter (where state = 'queued'),
        'submitting', count(*) filter (where state in ('submitting', 'submission_unknown')),
        'running', count(*) filter (where state in ('provider_pending', 'importing')),
        'delayed', count(*) filter (where state = 'processing_delayed'),
        'review', count(*) filter (where state = 'review_required'),
        'failed24h', count(*) filter (where state = 'failed' and completed_at > now() - interval '24 hours'),
        'succeeded24h', count(*) filter (where state = 'succeeded' and completed_at > now() - interval '24 hours'),
        'failed7d', count(*) filter (where state = 'failed' and completed_at > now() - interval '7 days'),
        'succeeded7d', count(*) filter (where state = 'succeeded' and completed_at > now() - interval '7 days'),
        'tests7d', count(*) filter (where purpose = 'staff_test' and created_at > now() - interval '7 days'))
      from public.generation_jobs where state not in ('succeeded', 'failed', 'cancelled') or completed_at > now() - interval '7 days'),
    'processing7d', (select coalesce(jsonb_agg(jsonb_build_object('modelId', x.model_id, 'name', mc.public_name, 'succeeded', x.ok, 'failed', x.ko,
        'successRate', case when x.ok + x.ko > 0 then round(x.ok::numeric / (x.ok + x.ko), 4) end,
        'p50Seconds', x.p50, 'p95Seconds', x.p95) order by mc.sort_order), '[]')
      from (select model_id, count(*) filter (where state = 'succeeded') ok, count(*) filter (where state = 'failed') ko,
                   percentile_cont(0.5) within group (order by extract(epoch from completed_at - coalesce(submitted_at, created_at))) filter (where state = 'succeeded') p50,
                   percentile_cont(0.95) within group (order by extract(epoch from completed_at - coalesce(submitted_at, created_at))) filter (where state = 'succeeded') p95
            from public.generation_jobs where completed_at > now() - interval '7 days' and state in ('succeeded', 'failed') group by model_id) x
      left join app_private.model_catalog mc on mc.id = x.model_id),
    'committed', (select jsonb_build_object('jobs', count(*),
        'estimatedCredits', coalesce(sum(app_private.supplier_credits((app_private.latest_cost_version(j.model_id)).schedule, j.options,
          cardinality(j.reference_asset_ids), 1)), 0),
        'unknownCostJobs', count(*) filter (where app_private.supplier_credits((app_private.latest_cost_version(j.model_id)).schedule, j.options,
          cardinality(j.reference_asset_ids), 1) is null),
        'note', 'Estimate from documented cost schedules for queued and running work. KIE may already have deducted part of it; it is not subtracted from the balance shown.')
      from public.generation_jobs j where j.state in ('queued', 'submitting', 'submission_unknown', 'provider_pending', 'processing_delayed')),
    'billingUrl', 'https://kie.ai/billing'
  );
end;
$$;
