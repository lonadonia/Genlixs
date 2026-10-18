-- Rollback of 20261018232513_automatic_pricing (global policy: KIE reference × markup ÷ credit value). Not applied.
-- Tested on the isolated local PostgreSQL: migration, then this rollback, then the earlier test suites 01–09 all pass; the
-- restored bodies equal production's before the migration (normalized-source md5 of all 14 replaced functions).
--
-- Stops automatic re-pricing and restores the earlier per-model and bulk price editors, the reference-value impact
-- preview, the earlier readiness wording and the earlier supplier view. Prices stay exactly as they are: the versions the
-- policy published remain the published prices (same table format) until someone saves a new price. Nothing financial is
-- touched; the policy history (pricing_policy_versions, price_versions.policy_version_id and the 'policy' source) is kept
-- for the audit trail. price_units_for keeps reading a "_refs" dimension, which only policy tables use, so a published
-- policy table keeps quoting correctly.
--
-- Deploy the previous application release after running this (its admin pages call the restored functions).

drop trigger if exists supplier_cost_versions_policy on app_private.supplier_cost_versions;
drop trigger if exists model_capability_versions_policy on app_private.model_capability_versions;
drop trigger if exists cost_unit_versions_policy on app_private.cost_unit_versions;

drop function if exists public.admin_pricing_policy();
drop function if exists public.admin_preview_pricing_policy(numeric, numeric);
drop function if exists public.admin_apply_pricing_policy(numeric, numeric, uuid);
drop function if exists app_private.policy_follow_change();
drop function if exists app_private.policy_follow_kie_rate();
drop function if exists app_private.pricing_is_automatic();

-- public.admin_save_model_price: as defined in 20261014203155_simplified_pricing_prices.sql
create or replace function public.admin_save_model_price(p_model_id text, p_units jsonb, p_extra_reference_units int, p_publish boolean,
  p_accept_loss boolean, p_expected_price_version_id uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_publish boolean := coalesce(p_publish, true);
  v_cap text := case when coalesce(p_publish, true) then 'catalog.publish' else 'pricing.review' end;
  v_actor uuid := app_private.require_capability(case when coalesce(p_publish, true) then 'catalog.publish' else 'pricing.review' end);
  m app_private.model_catalog;
  c app_private.model_capability_versions;
  sc app_private.supplier_cost_versions;
  pub app_private.price_versions;
  dr app_private.price_versions;
  v_basis jsonb := app_private.credit_basis();
  v_kie numeric := app_private.kie_usd_per_credit();
  v_cur uuid;
  v_dims jsonb;
  v_units jsonb := '{}'::jsonb;
  v_rules jsonb;
  v_key text;
  v_val jsonb;
  cfg jsonb;
  v_n int := 0;
  v_below jsonb;
  v_id uuid;
  v_ver int;
  v_min bigint;
  v_max bigint;
  v_extra jsonb;
begin
  select * into m from app_private.model_catalog where id = p_model_id for update;
  if not found then perform app_private.fail('NOT_FOUND', 'Model not found.'); end if;
  c := app_private.capability_for(m.id);
  sc := app_private.latest_cost_version(m.id);
  if sc.id is null then
    perform app_private.fail('COST_SCHEDULE_REQUIRED', 'This model has no KIE cost yet, so it cannot be priced.');
  end if;
  if (v_basis ->> 'usdPerCredit') is null then
    perform app_private.fail('CREDIT_VALUE_REQUIRED', 'Set the Genlixs credit value first.');
  end if;
  perform pg_advisory_xact_lock(hashtext('genlixs:pricing'));
  select * into pub from app_private.price_versions where model_id = m.id and state = 'published';
  select * into dr from app_private.price_versions where model_id = m.id and state = 'draft' order by version desc limit 1;
  v_cur := coalesce(pub.id, dr.id);
  if v_cur is distinct from p_expected_price_version_id then
    perform app_private.fail('PRICE_CHANGED', 'This price was changed by someone else since you opened it. Reload to see the current charges.');
  end if;
  if jsonb_typeof(p_units) is distinct from 'object' then
    perform app_private.fail('INVALID_PRICE', 'Enter a credit charge for every configuration.');
  end if;
  v_dims := app_private.price_dims(sc.schedule);
  for cfg in select * from app_private.price_configs(c.spec, v_dims) loop
    v_n := v_n + 1;
    v_key := app_private.option_key(v_dims, cfg);
    v_val := p_units -> v_key;
    if v_val is null or jsonb_typeof(v_val) <> 'number' or (v_val #>> '{}')::numeric <> trunc((v_val #>> '{}')::numeric)
       or (v_val #>> '{}')::numeric < 1 or (v_val #>> '{}')::numeric > 1000000 then
      perform app_private.fail('INVALID_PRICE', 'Every configuration needs a whole number of credits (at least 1).', jsonb_build_object('configuration', v_key));
    end if;
    v_units := v_units || jsonb_build_object(v_key, (v_val #>> '{}')::bigint);
  end loop;
  if v_n = 0 then perform app_private.fail('INCOMPLETE_COST', 'The KIE cost does not match this model''s options.'); end if;
  if (select count(*) from jsonb_object_keys(p_units)) <> v_n then
    perform app_private.fail('INVALID_PRICE', 'The price lists configurations this model does not offer.');
  end if;
  -- An extra-reference fee the supplier bills must be priced explicitly (never zero by omission).
  v_extra := sc.schedule -> 'extraReference';
  if v_extra is not null and coalesce((c.spec -> 'references' ->> 'max')::int, 0) > coalesce((v_extra ->> 'free')::int, 0) then
    if p_extra_reference_units is null or p_extra_reference_units < 1 or p_extra_reference_units > 1000000 then
      perform app_private.fail('INVALID_PRICE', 'Set a charge of at least 1 credit for each extra reference image.');
    end if;
  else
    v_extra := null;
  end if;
  v_rules := jsonb_build_object('format', 'table', 'dims', v_dims, 'units', v_units)
    || case when v_extra is not null then jsonb_build_object('perExtraReference', jsonb_build_object('free', (v_extra ->> 'free')::int, 'units', p_extra_reference_units))
       else '{}'::jsonb end;
  if v_publish and pub.id is not null and pub.capability_version_id = c.id and pub.rules = v_rules then
    return jsonb_build_object('unchanged', true, 'priceVersionId', pub.id, 'version', pub.version, 'state', 'published', 'belowCost', '[]'::jsonb);
  end if;
  v_below := app_private.below_cost_configs(m.id, v_rules);
  if v_publish and jsonb_array_length(v_below) > 0 and not coalesce(p_accept_loss, false) then
    perform app_private.fail('LOSS_CONFIRMATION_REQUIRED', m.public_name || ': ' || jsonb_array_length(v_below)
      || ' configuration(s) would be charged less than the KIE cost at the current Genlixs credit value. Confirm to save anyway.',
      jsonb_build_object('configurations', v_below));
  end if;
  select min(value::bigint), max(value::bigint) into v_min, v_max from jsonb_each_text(v_units);
  select coalesce(max(version), 0) + 1 into v_ver from app_private.price_versions where model_id = m.id;
  insert into app_private.price_versions (model_id, capability_version_id, version, state, rules, supplier_cost_snapshot, cost_evidence, created_by,
    source, supplier_cost_version_id, basis)
  values (m.id, c.id, v_ver, 'draft', v_rules,
    jsonb_build_object('versionId', sc.id, 'version', sc.version, 'checkedAt', sc.source_checked_at, 'usdPerCredit', v_kie),
    coalesce(nullif(trim(coalesce(p_note, '')), ''), 'Charge set per configuration on KIE cost v' || sc.version || ' at ' || app_private.fmt_usd((v_basis ->> 'usdPerCredit')::numeric)
      || ' per Genlixs credit and ' || app_private.fmt_usd(v_kie) || ' per KIE credit'),
    v_actor, 'manual', sc.id,
    jsonb_build_object('usdPerGenlixsCredit', v_basis -> 'usdPerCredit', 'creditReference', v_basis -> 'reference',
      'usdPerKieCredit', v_kie, 'kieReferenceId', (app_private.current_reference('kie_purchase')).id, 'belowCost', v_below))
  returning id into v_id;
  update app_private.price_versions set state = 'retired' where model_id = m.id and state = 'draft' and id <> v_id;
  if v_publish then
    update app_private.price_versions set state = 'retired' where model_id = m.id and state = 'published';
    update app_private.price_versions set state = 'published', effective_at = now(), published_by = v_actor where id = v_id;
  end if;
  perform app_private.audit(v_actor, v_cap, case when v_publish then 'price.publish' else 'price.draft' end, 'price_version', v_id::text,
    (case when v_publish then 'Set the price of ' else 'Saved a draft price for ' end) || m.public_name || ' (v' || v_ver || ', '
      || case when v_min = v_max then v_min::text else v_min || '–' || v_max end || ' credits)'
      || case when v_publish and jsonb_array_length(v_below) > 0 then '; accepted ' || jsonb_array_length(v_below) || ' configuration(s) below the KIE cost' else '' end,
    jsonb_build_object('previousPublished', pub.id, 'rules', pub.rules),
    jsonb_build_object('rules', v_rules, 'belowCost', v_below, 'usdPerGenlixsCredit', v_basis -> 'usdPerCredit', 'usdPerKieCredit', v_kie));
  return jsonb_build_object('unchanged', false, 'priceVersionId', v_id, 'version', v_ver, 'state', case when v_publish then 'published' else 'draft' end,
    'belowCost', v_below);
end;
$$;

-- public.admin_save_price_draft: as defined in 20261014160624_catalog_admin_functions.sql
create or replace function public.admin_save_price_draft(p_model_id text, p_units jsonb, p_extra_reference_units int default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('pricing.review');
  c app_private.model_capability_versions := app_private.capability_for(p_model_id);
  sc app_private.supplier_cost_versions := app_private.latest_cost_version(p_model_id);
  v_dims jsonb;
  v_units jsonb := '{}'::jsonb;
  v_rules jsonb;
  v_key text;
  v_val jsonb;
  cfg jsonb;
  v_n int := 0;
  v_id uuid;
  v_ver int;
begin
  if c.id is null then perform app_private.fail('NOT_FOUND', 'Model not found.'); end if;
  if sc.id is null then
    perform app_private.fail('COST_SCHEDULE_REQUIRED', 'Record the KIE cost schedule for this model first; prices are set per configuration.');
  end if;
  if jsonb_typeof(p_units) <> 'object' then perform app_private.fail('INVALID_INPUT', 'Enter a credit charge for every configuration.'); end if;
  v_dims := app_private.price_dims(sc.schedule);
  for cfg in select * from app_private.price_configs(c.spec, v_dims) loop
    v_n := v_n + 1;
    v_key := app_private.option_key(v_dims, cfg);
    v_val := p_units -> v_key;
    if v_val is null or jsonb_typeof(v_val) <> 'number' or (v_val #>> '{}')::numeric <> trunc((v_val #>> '{}')::numeric)
       or (v_val #>> '{}')::numeric < 1 or (v_val #>> '{}')::numeric > 1000000 then
      perform app_private.fail('INVALID_PRICE', 'Every configuration needs a whole number of credits (at least 1).', jsonb_build_object('configuration', v_key));
    end if;
    v_units := v_units || jsonb_build_object(v_key, (v_val #>> '{}')::bigint);
  end loop;
  if v_n = 0 then perform app_private.fail('INCOMPLETE_COST', 'The cost schedule does not match this model''s options.'); end if;
  if (select count(*) from jsonb_object_keys(p_units)) <> v_n then
    perform app_private.fail('INVALID_PRICE', 'The price lists configurations this model does not offer.');
  end if;
  if p_extra_reference_units is not null and p_extra_reference_units < 0 then
    perform app_private.fail('INVALID_PRICE', 'Extra reference charge cannot be negative.');
  end if;
  v_rules := jsonb_build_object('format', 'table', 'dims', v_dims, 'units', v_units)
    || case when p_extra_reference_units is not null and sc.schedule ? 'extraReference'
         then jsonb_build_object('perExtraReference', jsonb_build_object('free', (sc.schedule -> 'extraReference' ->> 'free')::int, 'units', p_extra_reference_units))
         else '{}'::jsonb end;
  perform 1 from app_private.model_catalog where id = p_model_id for update;
  select coalesce(max(version), 0) + 1 into v_ver from app_private.price_versions where model_id = p_model_id;
  insert into app_private.price_versions (model_id, capability_version_id, version, state, rules, supplier_cost_snapshot, cost_evidence, created_by,
    source, supplier_cost_version_id)
  values (p_model_id, c.id, v_ver, 'draft', v_rules,
    jsonb_build_object('versionId', sc.id, 'version', sc.version, 'checkedAt', sc.source_checked_at, 'usdPerCredit', sc.usd_per_credit),
    coalesce(nullif(trim(p_note), ''), 'Manual price on KIE cost v' || sc.version), v_actor, 'manual', sc.id)
  returning id into v_id;
  update app_private.price_versions set state = 'retired' where model_id = p_model_id and state = 'draft' and id <> v_id;
  perform app_private.audit(v_actor, 'pricing.review', 'price.draft', 'price_version', v_id::text,
    'Saved manual price draft v' || v_ver || ' for ' || p_model_id, null, v_rules);
  return jsonb_build_object('priceVersionId', v_id, 'version', v_ver, 'state', 'draft');
end;
$$;

-- public.admin_create_price_version: as defined in 20261014031121_operations_admin.sql
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

-- public.admin_publish_price_version: as defined in 20261014203155_simplified_pricing_prices.sql
create or replace function public.admin_publish_price_version(p_price_version_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('catalog.publish');
  p app_private.price_versions;
  c app_private.model_capability_versions;
  sc app_private.supplier_cost_versions;
  v_dims jsonb;
  v_defaults jsonb;
  v_refs int;
  v_units bigint;
  v_below jsonb;
  cfg jsonb;
  v_old uuid;
begin
  select * into p from app_private.price_versions where id = p_price_version_id for update;
  if not found or p.state <> 'draft' then perform app_private.fail('INVALID_STATE', 'Only a draft price version can be published.'); end if;
  c := app_private.capability_for(p.model_id);
  if p.capability_version_id <> c.id then
    perform app_private.fail('STALE_CAPABILITY', 'This price was drafted for an older set of model options. Create a new price.');
  end if;
  sc := app_private.latest_cost_version(p.model_id);
  v_defaults := app_private.spec_defaults(c.spec);
  v_refs := coalesce((c.spec -> 'references' ->> 'min')::int, 0);
  v_dims := case when p.rules ->> 'format' = 'table' then p.rules -> 'dims' else app_private.price_dims(sc.schedule) end;
  if v_dims is null then
    v_dims := (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(coalesce(c.spec -> 'options', '{}'::jsonb)) k);
  end if;
  for cfg in select * from app_private.price_configs(c.spec, v_dims) loop
    v_units := app_private.price_units_for(p.rules, v_defaults || cfg, v_refs);
    if v_units is null or v_units <= 0 then
      perform app_private.fail('PRICE_INCOMPLETE', 'This price has no valid charge for one of the model''s configurations.',
        jsonb_build_object('configuration', app_private.option_key(v_dims, cfg)));
    end if;
  end loop;
  v_below := app_private.below_cost_configs(p.model_id, p.rules);
  if jsonb_array_length(v_below) > 0 and coalesce(trim(p_reason), '') = '' then
    perform app_private.fail('LOSS_REASON_REQUIRED', 'Some configurations would be charged less than the KIE cost at the Genlixs credit value. Confirm to publish anyway.',
      jsonb_build_object('configurations', v_below));
  end if;
  select id into v_old from app_private.price_versions where model_id = p.model_id and state = 'published';
  update app_private.price_versions set state = 'retired' where model_id = p.model_id and state = 'published';
  update app_private.price_versions set state = 'retired' where model_id = p.model_id and state = 'draft' and id <> p.id and version < p.version;
  update app_private.price_versions set state = 'published', effective_at = now(), published_by = v_actor where id = p.id;
  perform app_private.audit(v_actor, 'catalog.publish', 'price.publish', 'price_version', p.id::text,
    coalesce(nullif(trim(p_reason), ''), 'Published price v' || p.version || ' for ' || p.model_id),
    jsonb_build_object('previousPublished', v_old), jsonb_build_object('rules', p.rules, 'belowCost', v_below));
  return jsonb_build_object('priceVersionId', p.id, 'state', 'published', 'belowCost', v_below);
end;
$$;

-- public.admin_restore_price_version: as defined in 20261014203155_simplified_pricing_prices.sql
create or replace function public.admin_restore_price_version(p_price_version_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('catalog.publish');
  src app_private.price_versions;
  v_ver int;
  v_new uuid;
  v_batch uuid;
  v_ref text;
  pub app_private.price_versions;
begin
  select * into src from app_private.price_versions where id = p_price_version_id;
  if not found then perform app_private.fail('NOT_FOUND', 'Price version not found.'); end if;
  if src.state = 'published' then perform app_private.fail('INVALID_STATE', 'This version is already the current price.'); end if;
  if src.capability_version_id <> (app_private.capability_for(src.model_id)).id then
    perform app_private.fail('STALE_CAPABILITY', 'This version was made for an older set of model options and cannot be restored.');
  end if;
  perform pg_advisory_xact_lock(hashtext('genlixs:pricing'));
  perform 1 from app_private.model_catalog where id = src.model_id for update;
  select * into pub from app_private.price_versions where model_id = src.model_id and state = 'published' for update;
  insert into app_private.pricing_batches (kind, action, scope, markup_bps, basis, actor_id)
  values ('restore', 'publish', jsonb_build_object('modelIds', jsonb_build_array(src.model_id), 'restoredFrom', src.id), src.markup_bps,
    jsonb_build_object('revenue', app_private.credit_basis()), v_actor)
  returning id, short_ref into v_batch, v_ref;
  select coalesce(max(version), 0) + 1 into v_ver from app_private.price_versions where model_id = src.model_id;
  insert into app_private.price_versions (model_id, capability_version_id, version, state, rules, supplier_cost_snapshot, cost_evidence, created_by,
    source, batch_id, supplier_cost_version_id, markup_bps, basis, restored_from)
  values (src.model_id, src.capability_version_id, v_ver, 'draft', src.rules, src.supplier_cost_snapshot,
    'Restored from v' || src.version || ' (batch ' || v_ref || ')', v_actor, 'restore', v_batch, src.supplier_cost_version_id, src.markup_bps, src.basis, src.id)
  returning id into v_new;
  update app_private.price_versions set state = 'retired' where model_id = src.model_id and state in ('published', 'draft') and id <> v_new;
  update app_private.price_versions set state = 'published', effective_at = now(), published_by = v_actor where id = v_new;
  insert into app_private.pricing_batch_items (batch_id, model_id, old_price_version_id, new_price_version_id, old_rules, new_rules, supplier_cost_version_id)
  values (v_batch, src.model_id, pub.id, v_new, pub.rules, src.rules, src.supplier_cost_version_id);
  perform app_private.audit(v_actor, 'catalog.publish', 'price.restore', 'price_version', v_new::text,
    coalesce(nullif(trim(p_reason), ''), 'Restored price v' || src.version || ' as v' || v_ver || ' for ' || src.model_id || ' (batch ' || v_ref || ')'),
    jsonb_build_object('previousPublished', pub.id), jsonb_build_object('restoredFrom', src.id));
  return jsonb_build_object('priceVersionId', v_new, 'version', v_ver, 'batchRef', v_ref, 'state', 'published');
end;
$$;

-- public.admin_pricing_apply: as defined in 20261014160624_catalog_admin_functions.sql
create or replace function public.admin_pricing_apply(p_scope text, p_model_ids text[], p_markup_percent numeric, p_include_overrides boolean,
  p_preview_revision text, p_action text, p_selected text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_cap text;
  v_bps int := app_private.markup_bps(p_markup_percent);
  v_models text[] := app_private.pricing_scope(p_scope, p_model_ids);
  v_preview jsonb;
  v_row jsonb;
  v_batch uuid;
  v_ref text;
  v_new uuid;
  v_ver int;
  v_items jsonb := '[]'::jsonb;
  pub app_private.price_versions;
  mid text;
begin
  if p_action = 'publish' then
    v_cap := 'catalog.publish';
  elsif p_action = 'draft' then
    v_cap := 'pricing.review';
  else
    perform app_private.fail('INVALID_ACTION', 'Choose save drafts or publish.');
  end if;
  v_actor := app_private.require_capability(v_cap);
  if coalesce(cardinality(p_selected), 0) = 0 then
    perform app_private.fail('NOTHING_SELECTED', 'Select at least one row to apply.');
  end if;
  -- One pricing change at a time; a concurrent apply sees the other's result and a changed revision.
  perform pg_advisory_xact_lock(hashtext('genlixs:pricing'));
  v_preview := app_private.pricing_preview(v_models, v_bps, p_include_overrides);
  if v_preview ->> 'revision' is distinct from p_preview_revision then
    perform app_private.fail('PREVIEW_STALE', 'Prices, supplier costs or packages changed since this preview. Review the refreshed preview before applying.');
  end if;
  foreach mid in array p_selected loop
    select x into v_row from jsonb_array_elements(v_preview -> 'models') x where x ->> 'modelId' = mid;
    if v_row is null then
      perform app_private.fail('NOT_IN_PREVIEW', 'A selected row is not part of this preview.', jsonb_build_object('modelId', mid));
    end if;
    if not (v_row ->> 'selectable')::boolean then
      perform app_private.fail('ROW_NOT_APPLICABLE', 'A selected row cannot be priced from this preview: ' || (v_row ->> 'name') || ' (' || (v_row ->> 'status') || ').',
        jsonb_build_object('modelId', mid, 'status', v_row ->> 'status'));
    end if;
  end loop;

  insert into app_private.pricing_batches (kind, action, scope, markup_bps, include_overrides, preview_revision, basis, actor_id)
  values ('generation', p_action, jsonb_build_object('scope', p_scope, 'modelIds', to_jsonb(v_models), 'selected', to_jsonb(p_selected)),
    v_bps, coalesce(p_include_overrides, false), p_preview_revision,
    jsonb_build_object('revenue', v_preview -> 'basis', 'assumptions', v_preview -> 'assumptions'), v_actor)
  returning id, short_ref into v_batch, v_ref;

  foreach mid in array p_selected loop
    select x into v_row from jsonb_array_elements(v_preview -> 'models') x where x ->> 'modelId' = mid;
    perform 1 from app_private.model_catalog where id = mid for update;
    select * into pub from app_private.price_versions where model_id = mid and state = 'published' for update;
    select coalesce(max(version), 0) + 1 into v_ver from app_private.price_versions where model_id = mid;
    insert into app_private.price_versions (model_id, capability_version_id, version, state, rules, supplier_cost_snapshot, cost_evidence,
      created_by, source, batch_id, supplier_cost_version_id, markup_bps, basis)
    values (mid, (v_row ->> 'capabilityVersionId')::uuid, v_ver, 'draft', v_row -> 'proposedRules', v_row -> 'cost',
      'Bulk markup +' || trim_scale(round(v_bps / 100.0, 2))::text || ' % on KIE cost v' || (v_row -> 'cost' ->> 'version')
        || ' (' || (v_row -> 'cost' ->> 'sourceKind') || ', checked ' || to_char((v_row -> 'cost' ->> 'checkedAt')::timestamptz, 'YYYY-MM-DD') || '), batch ' || v_ref,
      v_actor, 'bulk', v_batch, (v_row -> 'cost' ->> 'versionId')::uuid, v_bps,
      jsonb_build_object('minRevenuePerCredit', v_preview -> 'basis' -> 'minRevenuePerCredit', 'basisSource', v_preview -> 'basis' ->> 'source',
        'conservative', v_preview -> 'basis' -> 'conservative'))
    returning id into v_new;
    -- Older unpublished drafts of this model are superseded (kept as retired history).
    update app_private.price_versions set state = 'retired' where model_id = mid and state = 'draft' and id <> v_new;
    if p_action = 'publish' then
      update app_private.price_versions set state = 'retired' where model_id = mid and state = 'published';
      update app_private.price_versions set state = 'published', effective_at = now(), published_by = v_actor where id = v_new;
    end if;
    insert into app_private.pricing_batch_items (batch_id, model_id, old_price_version_id, new_price_version_id, old_rules, new_rules,
      supplier_cost_version_id, summary)
    values (v_batch, mid, pub.id, v_new, pub.rules, v_row -> 'proposedRules', (v_row -> 'cost' ->> 'versionId')::uuid, v_row -> 'summary');
    v_items := v_items || jsonb_build_array(jsonb_build_object('modelId', mid, 'name', v_row ->> 'name', 'priceVersionId', v_new, 'version', v_ver,
      'oldPriceVersionId', pub.id, 'summary', v_row -> 'summary'));
    pub := null;
  end loop;

  perform app_private.audit(v_actor, v_cap, 'pricing.batch_' || p_action, 'pricing_batch', v_batch::text,
    (case p_action when 'publish' then 'Published' else 'Saved drafts for' end) || ' ' || cardinality(p_selected) || ' model price(s) at +'
      || trim_scale(round(v_bps / 100.0, 2))::text || ' % above KIE cost (batch ' || v_ref || ')',
    null, jsonb_build_object('items', v_items, 'markupBps', v_bps));
  return jsonb_build_object('batchId', v_batch, 'ref', v_ref, 'action', p_action, 'markupBps', v_bps, 'items', v_items, 'createdAt', now());
end;
$$;

-- public.admin_pricing_save: as defined in 20261014203155_simplified_pricing_prices.sql
create or replace function public.admin_pricing_save(p_scope text, p_model_ids text[], p_markup_percent numeric, p_include_overrides boolean,
  p_preview_revision text, p_selected text[], p_excluded jsonb default '{}'::jsonb, p_publish boolean default true, p_accept_loss boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_publish boolean := coalesce(p_publish, true);
  v_cap text := case when coalesce(p_publish, true) then 'catalog.publish' else 'pricing.review' end;
  v_actor uuid := app_private.require_capability(case when coalesce(p_publish, true) then 'catalog.publish' else 'pricing.review' end);
  v_bps int := app_private.markup_bps(p_markup_percent);
  v_models text[] := app_private.pricing_scope(p_scope, p_model_ids);
  v_excluded jsonb := coalesce(p_excluded, '{}'::jsonb);
  v_preview jsonb;
  v_rpc numeric;
  v_row jsonb;
  v_cfg jsonb;
  v_units jsonb;
  v_rules jsonb;
  v_excl jsonb;
  v_val bigint;
  v_kept int;
  v_plan jsonb := '[]'::jsonb;
  v_loss jsonb := '[]'::jsonb;
  v_item jsonb;
  v_batch uuid;
  v_ref text;
  v_new uuid;
  v_ver int;
  v_items jsonb := '[]'::jsonb;
  pub app_private.price_versions;
  mid text;
  k text;
begin
  if coalesce(cardinality(p_selected), 0) = 0 then
    perform app_private.fail('NOTHING_SELECTED', 'Select at least one model.');
  end if;
  if jsonb_typeof(v_excluded) <> 'object' then
    perform app_private.fail('INVALID_INPUT', 'Kept configurations are not valid.');
  end if;
  for k in select jsonb_object_keys(v_excluded) loop
    if not (k = any (p_selected)) then
      perform app_private.fail('INVALID_INPUT', 'Configurations kept unchanged must belong to a selected model.');
    end if;
  end loop;
  -- One pricing change at a time; a concurrent change sees the other's result and a changed revision.
  perform pg_advisory_xact_lock(hashtext('genlixs:pricing'));
  v_preview := app_private.pricing_preview(v_models, v_bps, p_include_overrides);
  if v_preview ->> 'revision' is distinct from p_preview_revision then
    perform app_private.fail('PREVIEW_STALE', 'Prices, KIE costs or reference values changed since this preview. Review the refreshed preview before saving.');
  end if;
  v_rpc := (v_preview -> 'basis' ->> 'usdPerCredit')::numeric;

  -- Plan every selected model first: nothing is written unless all of them are valid.
  foreach mid in array p_selected loop
    v_row := null;
    select x into v_row from jsonb_array_elements(v_preview -> 'models') x where x ->> 'modelId' = mid;
    if v_row is null then
      perform app_private.fail('NOT_IN_PREVIEW', 'A selected model is not part of this preview.', jsonb_build_object('modelId', mid));
    end if;
    if not (v_row ->> 'selectable')::boolean then
      perform app_private.fail('ROW_NOT_APPLICABLE', (v_row ->> 'name') || ' cannot be priced from this preview (' || (v_row ->> 'status') || ').',
        jsonb_build_object('modelId', mid, 'status', v_row ->> 'status'));
    end if;
    v_excl := coalesce(v_excluded -> mid, '[]'::jsonb);
    if jsonb_typeof(v_excl) <> 'array' then
      perform app_private.fail('INVALID_INPUT', 'Kept configurations are not valid.');
    end if;
    v_units := v_row -> 'proposedRules' -> 'units';
    v_kept := 0;
    for k in select distinct value from jsonb_array_elements_text(v_excl) loop
      if not (v_units ? k) then
        perform app_private.fail('INVALID_INPUT', (v_row ->> 'name') || ': unknown configuration.', jsonb_build_object('configuration', k));
      end if;
      v_val := null;
      select (x ->> 'currentUnits')::bigint into v_val from jsonb_array_elements(v_row -> 'configs') x where x ->> 'key' = k;
      if v_val is null then
        perform app_private.fail('EXCLUDED_UNPRICED', (v_row ->> 'name') || ': a configuration kept unchanged has no current price. Include it, or price it first.',
          jsonb_build_object('modelId', mid, 'configuration', k));
      end if;
      v_units := v_units || jsonb_build_object(k, v_val);
      v_kept := v_kept + 1;
    end loop;
    if v_kept > 0 and v_kept >= (select count(*) from jsonb_object_keys(v_units)) then
      perform app_private.fail('NOTHING_TO_CHANGE', (v_row ->> 'name') || ': every configuration is kept unchanged. Deselect the model instead.',
        jsonb_build_object('modelId', mid));
    end if;
    v_rules := jsonb_set(v_row -> 'proposedRules', '{units}', v_units);
    for v_cfg in select value from jsonb_array_elements(v_row -> 'configs') loop
      if (v_cfg ->> 'supplierUsd') is not null and (v_units ->> (v_cfg ->> 'key'))::bigint * v_rpc < (v_cfg ->> 'supplierUsd')::numeric then
        v_loss := v_loss || jsonb_build_array(jsonb_build_object('modelId', mid, 'name', v_row ->> 'name', 'configuration', v_cfg ->> 'key'));
      end if;
    end loop;
    v_plan := v_plan || jsonb_build_array(jsonb_build_object('modelId', mid, 'row', v_row, 'rules', v_rules, 'kept', v_kept));
  end loop;
  if jsonb_array_length(v_loss) > 0 and not coalesce(p_accept_loss, false) then
    perform app_private.fail('LOSS_CONFIRMATION_REQUIRED', jsonb_array_length(v_loss)
      || ' configuration(s) would be charged less than the KIE cost at the Genlixs credit value. Confirm to save anyway.',
      jsonb_build_object('configurations', v_loss));
  end if;

  insert into app_private.pricing_batches (kind, action, scope, markup_bps, include_overrides, preview_revision, basis, actor_id)
  values ('generation', case when v_publish then 'publish' else 'draft' end,
    jsonb_build_object('scope', p_scope, 'modelIds', to_jsonb(v_models), 'selected', to_jsonb(p_selected), 'kept', v_excluded),
    v_bps, coalesce(p_include_overrides, false), p_preview_revision,
    jsonb_build_object('revenue', v_preview -> 'basis', 'assumptions', v_preview -> 'assumptions', 'acceptedBelowCost', v_loss), v_actor)
  returning id, short_ref into v_batch, v_ref;

  for v_item in select value from jsonb_array_elements(v_plan) loop
    mid := v_item ->> 'modelId';
    v_row := v_item -> 'row';
    pub := null;
    perform 1 from app_private.model_catalog where id = mid for update;
    select * into pub from app_private.price_versions where model_id = mid and state = 'published' for update;
    select coalesce(max(version), 0) + 1 into v_ver from app_private.price_versions where model_id = mid;
    insert into app_private.price_versions (model_id, capability_version_id, version, state, rules, supplier_cost_snapshot, cost_evidence,
      created_by, source, batch_id, supplier_cost_version_id, markup_bps, basis)
    values (mid, (v_row ->> 'capabilityVersionId')::uuid, v_ver, 'draft', v_item -> 'rules', v_row -> 'cost',
      'Markup +' || trim_scale(round(v_bps / 100.0, 2))::text || ' % on KIE cost v' || (v_row -> 'cost' ->> 'version') || ' at '
        || app_private.fmt_usd(v_rpc) || ' per Genlixs credit'
        || case when (v_item ->> 'kept')::int > 0 then ', ' || (v_item ->> 'kept') || ' configuration(s) kept unchanged' else '' end
        || ' (batch ' || v_ref || ')',
      v_actor, 'bulk', v_batch, (v_row -> 'cost' ->> 'versionId')::uuid, v_bps,
      jsonb_build_object('usdPerGenlixsCredit', v_rpc, 'creditReference', v_preview -> 'basis' -> 'reference',
        'usdPerKieCredit', v_preview -> 'assumptions' -> 'usdPerKieCredit', 'kept', coalesce(v_excluded -> mid, '[]'::jsonb)))
    returning id into v_new;
    update app_private.price_versions set state = 'retired' where model_id = mid and state = 'draft' and id <> v_new;
    if v_publish then
      update app_private.price_versions set state = 'retired' where model_id = mid and state = 'published';
      update app_private.price_versions set state = 'published', effective_at = now(), published_by = v_actor where id = v_new;
    end if;
    insert into app_private.pricing_batch_items (batch_id, model_id, old_price_version_id, new_price_version_id, old_rules, new_rules,
      supplier_cost_version_id, summary)
    values (v_batch, mid, pub.id, v_new, pub.rules, v_item -> 'rules', (v_row -> 'cost' ->> 'versionId')::uuid,
      (v_row -> 'summary') || jsonb_build_object('kept', (v_item ->> 'kept')::int));
    v_items := v_items || jsonb_build_array(jsonb_build_object('modelId', mid, 'name', v_row ->> 'name', 'priceVersionId', v_new, 'version', v_ver,
      'oldPriceVersionId', pub.id, 'kept', (v_item ->> 'kept')::int));
  end loop;

  perform app_private.audit(v_actor, v_cap, 'pricing.batch_' || case when v_publish then 'publish' else 'draft' end, 'pricing_batch', v_batch::text,
    (case when v_publish then 'Set prices for ' else 'Saved draft prices for ' end) || jsonb_array_length(v_plan) || ' model(s) at +'
      || trim_scale(round(v_bps / 100.0, 2))::text || ' % above KIE cost, ' || app_private.fmt_usd(v_rpc) || ' per Genlixs credit (batch ' || v_ref || ')'
      || case when jsonb_array_length(v_loss) > 0 then '; accepted ' || jsonb_array_length(v_loss) || ' configuration(s) below the KIE cost' else '' end,
    null, jsonb_build_object('items', v_items, 'markupBps', v_bps, 'kept', v_excluded, 'belowCost', v_loss));
  return jsonb_build_object('batchId', v_batch, 'ref', v_ref, 'action', case when v_publish then 'publish' else 'draft' end, 'markupBps', v_bps,
    'items', v_items, 'belowCost', v_loss, 'createdAt', now());
end;
$$;

-- public.admin_pricing_preview: as defined in 20261014160624_catalog_admin_functions.sql
create or replace function public.admin_pricing_preview(p_scope text, p_model_ids text[], p_markup_percent numeric, p_include_overrides boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('pricing.review');
begin
  return app_private.pricing_preview(app_private.pricing_scope(p_scope, p_model_ids), app_private.markup_bps(p_markup_percent), p_include_overrides)
    || jsonb_build_object('scope', p_scope);
end;
$$;

-- public.admin_reference_impact: as defined in 20261014203016_simplified_pricing.sql
create or replace function public.admin_reference_impact(p_kind text, p_amount_usd numeric, p_credits numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('pricing.review');
  v_basis jsonb := app_private.credit_basis();
  v_assump jsonb := app_private.pricing_assumptions();
  v_basis2 jsonb;
  v_assump2 jsonb;
  v_rate numeric;
  v_models jsonb := '[]'::jsonb;
  t1 jsonb;
  t2 jsonb;
  m record;
begin
  if p_kind is null or p_kind not in ('kie_purchase', 'credit_value') or p_amount_usd is null or p_amount_usd <= 0
     or p_credits is null or p_credits <= 0 then
    perform app_private.fail('INVALID_INPUT', 'Enter a positive amount and credit quantity.');
  end if;
  v_rate := round(p_amount_usd / p_credits, 10);
  v_basis2 := v_basis;
  v_assump2 := v_assump;
  if p_kind = 'credit_value' then
    v_basis2 := v_basis || jsonb_build_object('minRevenuePerCredit', v_rate, 'usdPerCredit', v_rate);
  else
    v_assump2 := v_assump || jsonb_build_object('usdPerKieCredit', v_rate);
  end if;
  for m in select id from app_private.model_catalog order by sort_order, id loop
    t1 := app_private.model_price_table(m.id, null, v_basis, v_assump, false);
    if t1 -> 'published' is null or not coalesce((t1 -> 'published' ->> 'currentCapability')::boolean, false) then
      continue;
    end if;
    t2 := app_private.model_price_table(m.id, null, v_basis2, v_assump2, false);
    v_models := v_models || jsonb_build_array(jsonb_build_object('modelId', m.id, 'name', t1 ->> 'name', 'state', t1 ->> 'state',
      'minUnits', t1 -> 'summary' -> 'minUnits', 'maxUnits', t1 -> 'summary' -> 'maxUnits',
      'before', jsonb_build_object('markupMin', t1 -> 'summary' -> 'markupMin', 'markupMax', t1 -> 'summary' -> 'markupMax',
        'belowCost', t1 -> 'summary' -> 'belowCostConfigs'),
      'after', jsonb_build_object('markupMin', t2 -> 'summary' -> 'markupMin', 'markupMax', t2 -> 'summary' -> 'markupMax',
        'belowCost', t2 -> 'summary' -> 'belowCostConfigs')));
  end loop;
  return jsonb_build_object('kind', p_kind, 'usdPerCredit', v_rate,
    'currentUsdPerCredit', case when p_kind = 'credit_value' then v_basis -> 'usdPerCredit' else v_assump -> 'usdPerKieCredit' end,
    'models', v_models,
    'note', 'Nothing was saved. Wallet balances, purchases, quotes, running jobs and published prices do not change when a reference value changes.');
end;
$$;

-- public.admin_save_pricing_reference: as defined in 20261014203016_simplified_pricing.sql
create or replace function public.admin_save_pricing_reference(p_kind text, p_amount_usd numeric, p_credits numeric, p_bonus_credits numeric,
  p_source_url text, p_note text, p_expected_version_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('pricing.review');
  cur app_private.pricing_reference_versions;
  v_new app_private.pricing_reference_versions;
  v_bonus numeric := coalesce(p_bonus_credits, 0);
  v_url text := nullif(trim(coalesce(p_source_url, '')), '');
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if p_kind is null or p_kind not in ('kie_purchase', 'credit_value') then
    perform app_private.fail('INVALID_INPUT', 'Choose the KIE purchase or the Genlixs credit value.');
  end if;
  if p_amount_usd is null or p_amount_usd <= 0 or p_amount_usd > 1000000 or round(p_amount_usd, 2) <> p_amount_usd then
    perform app_private.fail('INVALID_INPUT', 'Enter the amount in USD (more than 0, at most 2 decimals).');
  end if;
  if p_credits is null or p_credits <= 0 or p_credits > 100000000 or round(p_credits, 2) <> p_credits
     or (p_kind = 'credit_value' and p_credits <> trunc(p_credits)) then
    perform app_private.fail('INVALID_INPUT', case when p_kind = 'credit_value' then 'Enter a whole number of Genlixs credits (at least 1).'
      else 'Enter the KIE credits received (more than 0, at most 2 decimals).' end);
  end if;
  if v_bonus < 0 or v_bonus >= p_credits or round(v_bonus, 2) <> v_bonus or (p_kind = 'credit_value' and v_bonus <> 0) then
    perform app_private.fail('INVALID_INPUT', 'Bonus credits must be less than the credits received.');
  end if;
  if v_url is not null and v_url !~ '^https://' then
    perform app_private.fail('INVALID_INPUT', 'The source link must start with https://.');
  end if;
  perform pg_advisory_xact_lock(hashtext('genlixs:pricing'));
  cur := app_private.current_reference(p_kind);
  if cur.id is distinct from p_expected_version_id then
    perform app_private.fail('REFERENCE_CHANGED', 'This value was changed by someone else since you opened it. Reload to see the latest value.');
  end if;
  if cur.id is not null and cur.amount_usd = p_amount_usd and cur.credits = p_credits and cur.bonus_credits = v_bonus
     and cur.source_url is not distinct from v_url and cur.note is not distinct from v_note and not cur.is_example then
    return jsonb_build_object('unchanged', true, 'reference', app_private.reference_json(cur));
  end if;
  insert into app_private.pricing_reference_versions (kind, version, amount_usd, credits, bonus_credits, source_url, note, created_by)
  values (p_kind, coalesce(cur.version, 0) + 1, p_amount_usd, p_credits, v_bonus, v_url, v_note, v_actor)
  returning * into v_new;
  if p_kind = 'kie_purchase' then
    -- Kept in step for readers of the documented setting (new KIE cost versions record it).
    update app_private.settings set value = to_jsonb(v_new.usd_per_credit), updated_by = v_actor, updated_at = now() where key = 'kie_usd_per_credit';
  end if;
  perform app_private.audit(v_actor, 'pricing.review', 'pricing.reference', 'pricing_reference', v_new.id::text,
    case when p_kind = 'kie_purchase'
      then 'Set the KIE purchase reference to ' || app_private.fmt_usd(p_amount_usd) || ' for ' || trim_scale(p_credits)::text || ' KIE credits ('
        || app_private.fmt_usd(v_new.usd_per_credit) || ' per KIE credit'
        || case when v_bonus > 0 then ', including ' || trim_scale(v_bonus)::text || ' bonus credits' else '' end || ')'
      else 'Set the Genlixs credit value to ' || app_private.fmt_usd(p_amount_usd) || ' for ' || trim_scale(p_credits)::text || ' credits ('
        || app_private.fmt_usd(v_new.usd_per_credit) || ' per credit)' end
      || '. Wallets, purchases, quotes, running jobs and published prices were not changed.',
    app_private.reference_json(cur), app_private.reference_json(v_new));
  return jsonb_build_object('unchanged', false, 'reference', app_private.reference_json(v_new), 'previous', app_private.reference_json(cur));
end;
$$;

-- app_private.model_readiness: as defined in 20261014203155_simplified_pricing_prices.sql
create or replace function app_private.model_readiness(p_model_id text)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  m app_private.model_catalog;
  c app_private.model_capability_versions;
  sc app_private.supplier_cost_versions;
  pub app_private.price_versions;
  dr app_private.price_versions;
  acc app_private.provider_accounts;
  v_checks jsonb := '[]'::jsonb;
  v_complete boolean;
  cfg jsonb;
  v_defaults jsonb;
  v_refs int;
  v_n int := 0;
  v_missing int := 0;
  v_adapter boolean;
begin
  select * into m from app_private.model_catalog where id = p_model_id;
  c := app_private.capability_for(m.id);
  sc := app_private.latest_cost_version(m.id);
  select * into pub from app_private.price_versions where model_id = m.id and state = 'published' and capability_version_id = c.id;
  select * into dr from app_private.price_versions where model_id = m.id and state = 'draft' and capability_version_id = c.id order by version desc limit 1;
  select * into acc from app_private.provider_accounts where id = m.provider_account_id;
  v_defaults := app_private.spec_defaults(c.spec);
  v_refs := coalesce((c.spec -> 'references' ->> 'min')::int, 0);
  v_adapter := exists (select 1 from app_private.provider_adapters a where a.adapter = m.adapter);

  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'adapter', 'ok', v_adapter,
    'label', 'Integration implemented', 'detail', case when v_adapter then 'Adapter ' || m.adapter || ' is part of this release.'
      else 'This release cannot send work to this model yet.' end));
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'schema', 'ok', c.id is not null and c.spec ? 'options' and c.spec ? 'output',
    'label', 'Supported options defined', 'detail', 'Option schema version ' || coalesce(c.version::text, '—') || '.'));
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'provider_account', 'ok', acc.enabled and not acc.paused,
    'label', 'KIE account active', 'detail', case when acc.paused then 'The KIE account is paused in Genlixs.' when not acc.enabled then 'The KIE account is disabled.' else 'KIE account is active.' end));

  if sc.id is not null then
    for cfg in select * from app_private.price_configs(c.spec, app_private.price_dims(sc.schedule)) loop
      v_n := v_n + 1;
      if app_private.supplier_credits(sc.schedule, cfg, v_refs, 1) is null then v_missing := v_missing + 1; end if;
    end loop;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'supplier_cost', 'ok', sc.id is not null and v_n > 0 and v_missing = 0,
    'label', 'KIE cost known', 'fix', case when sc.id is null or v_n = 0 or v_missing > 0 then 'edit_cost' end,
    'detail', case when sc.id is null then 'No KIE cost recorded.' when v_n = 0 or v_missing > 0 then v_missing || ' configuration(s) without a KIE cost.'
      else 'KIE cost v' || sc.version || ' (' || sc.source_kind || ', checked ' || to_char(sc.source_checked_at, 'YYYY-MM-DD') || ').' end));

  v_complete := false;
  if pub.id is not null then
    v_complete := true;
    if pub.rules ->> 'format' = 'table' then
      for cfg in select * from app_private.price_configs(c.spec, pub.rules -> 'dims') loop
        if app_private.price_units_for(pub.rules, v_defaults || cfg, v_refs) is null then v_complete := false; end if;
      end loop;
    end if;
  end if;
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'price', 'ok', v_complete,
    'label', 'Price set', 'fix', case when v_complete then null else 'set_price' end,
    'draftPriceVersionId', dr.id,
    'detail', case when v_complete then 'Price v' || pub.version || ' is in use.'
      when pub.id is not null then 'The price misses some configurations. Set a price first.'
      when exists (select 1 from app_private.price_versions o where o.model_id = m.id and o.state = 'published')
        then 'The price was set for older options. Set a price first.'
      else 'Set a price first.' end));
  -- Informational only: a paid private test is optional and never blocks switching a model on.
  v_checks := v_checks || jsonb_build_array(jsonb_build_object('key', 'verification', 'warning', true,
    'ok', (m.verification_status = 'verified_by_test' and m.verified_capability_version_id = c.id) or m.verification_status = 'manual_evidence',
    'label', 'Private test (optional)', 'fix', null,
    'detail', case
      when m.verification_status = 'verified_by_test' and m.verified_capability_version_id = c.id then 'A private test completed and its output was validated.'
      when m.verification_status = 'verified_by_test' then 'Tested with older options.'
      when m.verification_status = 'manual_evidence' then 'Manual evidence recorded (not an integrated test).'
      when m.verification_status = 'test_failed' then 'The latest private test failed.'
      else 'Not tested yet.' end));
  return jsonb_build_object('checks', v_checks, 'capabilityVersionId', c.id,
    'blocking', (select count(*) from jsonb_array_elements(v_checks) x where not (x ->> 'ok')::boolean and not coalesce((x ->> 'warning')::boolean, false)));
end;
$$;

-- app_private.below_cost_configs: as defined in 20261014203016_simplified_pricing.sql
create or replace function app_private.below_cost_configs(p_model_id text, p_rules jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  c app_private.model_capability_versions := app_private.capability_for(p_model_id);
  sc app_private.supplier_cost_versions := app_private.latest_cost_version(p_model_id);
  v_rpc numeric := (app_private.credit_basis() ->> 'usdPerCredit')::numeric;
  v_kie numeric := app_private.kie_usd_per_credit();
  v_defaults jsonb;
  v_refs int;
  v_outputs int;
  v_dims jsonb;
  cfg jsonb;
  v_units bigint;
  v_cost numeric;
  v_out jsonb := '[]'::jsonb;
begin
  if sc.id is null or v_rpc is null or v_kie is null then
    return v_out;
  end if;
  v_defaults := app_private.spec_defaults(c.spec);
  v_refs := coalesce((c.spec -> 'references' ->> 'min')::int, 0);
  v_outputs := coalesce((c.spec -> 'output' ->> 'count')::int, 1);
  v_dims := case when p_rules ->> 'format' = 'table' then p_rules -> 'dims' else app_private.price_dims(sc.schedule) end;
  for cfg in select * from app_private.price_configs(c.spec, v_dims) loop
    v_units := app_private.price_units_for(p_rules, v_defaults || cfg, v_refs);
    v_cost := app_private.supplier_credits(sc.schedule, v_defaults || cfg, v_refs, v_outputs) * v_kie;
    if v_units is not null and v_cost is not null and v_units * v_rpc < v_cost then
      v_out := v_out || jsonb_build_array(app_private.option_key(v_dims, cfg));
    end if;
  end loop;
  return v_out;
end;
$$;

-- public.admin_catalog_supply: as defined in 20261018194110_catalog_supply.sql
create or replace function public.admin_catalog_supply()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('provider.read');
begin
  return jsonb_build_object(
    'generatedAt', now(),
    'suppliers', (select coalesce(jsonb_agg(jsonb_build_object('provider', a.provider, 'name', coalesce(a.display_name, a.provider),
        'on', a.enabled and not a.paused, 'hasKey', a.credential_version > 0 or a.secret_ref = 'KIE_API_KEY') order by a.sort_order), '[]'::jsonb)
      from app_private.provider_accounts a where a.provider <> 'fake'),
    'models', (select coalesce(jsonb_agg(x.j order by x.sort_order), '[]'::jsonb) from (
      select m.sort_order, jsonb_build_object(
        'id', m.id,
        'example', ex.e,
        -- Genlixs credits charged for the default request by the published price (null when not priced).
        'defaultUnits', (select app_private.price_units_for(pv.rules, ex.e -> 'options', coalesce((ex.e -> 'quantities' -> 'counts' ->> '_references')::int, 0))
            from app_private.price_versions pv
            where pv.model_id = m.id and pv.state = 'published' and pv.capability_version_id = (app_private.capability_for(m.id)).id),
        'route', jsonb_build_object('status', ch.r ->> 'status', 'explanation', ch.r ->> 'explanation',
            'offerId', ch.r -> 'chosen' ->> 'offerId', 'provider', ch.r -> 'chosen' ->> 'provider', 'providerName', ch.r -> 'chosen' ->> 'providerLabel',
            'legacy', (ch.r -> 'chosen' ->> 'legacy')::boolean, 'native', (ch.r -> 'chosen' ->> 'native')::numeric, 'unit', ch.r -> 'chosen' ->> 'unit',
            'usd', (ch.r -> 'chosen' ->> 'effectiveUsd')::numeric),
        'quotes', (select coalesce(jsonb_agg(q.j order by (q.j ->> 'usd')::numeric nulls last, q.sort), '[]'::jsonb) from (
            select f.sort_order as sort, jsonb_build_object(
              'offerId', f.id, 'provider', a.provider, 'providerName', coalesce(a.display_name, a.provider), 'legacy', f.is_legacy_primary,
              'status', f.status, 'decision', f.decision, 'decisionReason', f.decision_reason, 'blocker', f.blocker,
              'routingEnabled', f.routing_enabled, 'supplierOn', a.enabled and not a.paused,
              'hasKey', a.credential_version > 0 or a.secret_ref = 'KIE_API_KEY', 'integrated', f.adapter is not null,
              'confidence', pp.p ->> 'confidence', 'unit', pp.p ->> 'unit', 'unitBasis', cu.basis,
              'incompatible', inc.v, 'native', nat.v,
              'usd', app_private.effective_usd(nat.v, cu.units_per_usd, a.funding_fee_bps, a.funding_bonus_bps),
              'current', f.id::text = ch.r -> 'chosen' ->> 'offerId',
              -- The first step still missing before this offer can serve customers (in the order they are done).
              'stage', case
                when f.id::text = ch.r -> 'chosen' ->> 'offerId' then 'serving'
                when f.adapter is null then 'needs_integration'
                when pp.p is null or pp.p ->> 'confidence' in ('conflicting', 'unverified') then 'price_unverified'
                when not (a.credential_version > 0 or a.secret_ref = 'KIE_API_KEY') then 'needs_key'
                when f.status <> 'eligible' then 'needs_test'
                when not a.enabled or a.paused then 'supplier_off'
                when not f.routing_enabled then 'routing_off'
                else 'standby' end) as j
            from app_private.provider_offers f
            join app_private.provider_accounts a on a.id = f.provider_account_id
            cross join lateral (select app_private.offer_price(f.id) as p) pp
            left join lateral (select * from app_private.cost_unit(pp.p ->> 'unit')) cu on true
            cross join lateral (select app_private.offer_incompatibility(f.capabilities, ex.e -> 'options', ex.e ->> 'mode', ex.e -> 'quantities') as v) inc
            cross join lateral (select case when inc.v is null and pp.p is not null
                then app_private.offer_native_cost(pp.p -> 'schedule', ex.e -> 'options', ex.e -> 'quantities') end as v) nat
            where f.model_id = m.id) q)
      ) as j
      from app_private.model_catalog m
      cross join lateral (select app_private.example_request((app_private.capability_for(m.id)).spec) as e) ex
      cross join lateral (select app_private.route_choose(m.id, ex.e -> 'options', ex.e ->> 'mode', ex.e -> 'quantities') as r) ch
    ) x),
    'products', (select coalesce(jsonb_agg(g.j order by g.tool, g.product_key), '[]'::jsonb) from (
      select f.product_key, min(f.tool) as tool, jsonb_build_object('productKey', f.product_key, 'tool', min(f.tool), 'operation', min(f.operation),
        'offers', jsonb_agg(jsonb_build_object('offerId', f.id, 'provider', a.provider, 'providerName', coalesce(a.display_name, a.provider),
            'label', f.product_label, 'status', f.status, 'decision', f.decision, 'decisionReason', f.decision_reason, 'blocker', f.blocker,
            'integrated', f.adapter is not null, 'confidence', pp.p ->> 'confidence', 'unit', pp.p ->> 'unit', 'unitBasis', cu.basis,
            'basis', pp.p -> 'schedule' ->> 'basis', 'dims', pp.p -> 'schedule' -> 'dims', 'sourceUrl', f.source_url,
            -- USD per output, per second or per request for each listed configuration (funding terms applied).
            'ratesUsd', (select jsonb_object_agg(r.key, app_private.effective_usd(app_private.num(r.value), cu.units_per_usd, a.funding_fee_bps, a.funding_bonus_bps))
                from jsonb_each(coalesce(pp.p -> 'schedule' -> 'rates', '{}'::jsonb)) r),
            'fromUsd', (select min(app_private.effective_usd(app_private.num(r.value), cu.units_per_usd, a.funding_fee_bps, a.funding_bonus_bps))
                from jsonb_each(coalesce(pp.p -> 'schedule' -> 'rates', '{}'::jsonb)) r))
          order by a.sort_order)) as j
      from app_private.provider_offers f
      join app_private.provider_accounts a on a.id = f.provider_account_id
      cross join lateral (select app_private.offer_price(f.id) as p) pp
      left join lateral (select * from app_private.cost_unit(pp.p ->> 'unit')) cu on true
      where f.model_id is null
      group by f.product_key
    ) g)
  );
end;
$$;

-- The policy engine is no longer called by anything once the functions above are restored.
drop function if exists app_private.policy_apply_all(app_private.pricing_policy_versions, uuid);
drop function if exists app_private.policy_apply_model(text, app_private.pricing_policy_versions, uuid);
drop function if exists app_private.new_pricing_policy(int, uuid, uuid, text);
drop function if exists app_private.policy_json(app_private.pricing_policy_versions);
drop function if exists app_private.policy_terms(app_private.pricing_policy_versions);
drop function if exists app_private.current_pricing_policy();
drop function if exists app_private.policy_model_rules(text, int, numeric, numeric);
drop function if exists app_private.policy_credit_value(numeric);
drop function if exists app_private.policy_units(numeric, int, numeric);
drop function if exists app_private.kie_reference_usd(numeric, numeric);
drop function if exists app_private.effective_markup_pct(numeric, numeric);
