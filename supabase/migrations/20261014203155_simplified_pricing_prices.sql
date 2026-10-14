-- Genlixs 15b · Simplified pricing, part 2: one-step model prices, bulk markup with kept settings, publishing and
-- restoring at the reference values, and availability without a paid-test prerequisite (see part 1 for the overview).

-- =====================================================================================================
-- Generation prices: one-step save and bulk markup with kept configurations
-- =====================================================================================================

-- Saves an explicit credit charge for every configuration of one model as a new immutable version, published at once
-- (owner) or as a draft. The editor sends the id of the version it started from; a concurrent change is refused.
-- Charges worth less than the KIE cost need an explicit, audited confirmation.
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
revoke execute on function public.admin_save_model_price(text, jsonb, int, boolean, boolean, uuid, text) from public, anon;
grant execute on function public.admin_save_model_price(text, jsonb, int, boolean, boolean, uuid, text) to authenticated;

-- Bulk markup in ONE transaction: every selected model gets a new immutable version (published, or drafts), or nothing
-- changes. p_excluded = {"<modelId>": ["<configuration key>", …]} keeps those configurations at their published charge.
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
revoke execute on function public.admin_pricing_save(text, text[], numeric, boolean, text, text[], jsonb, boolean, boolean) from public, anon;
grant execute on function public.admin_pricing_save(text, text[], numeric, boolean, text, text[], jsonb, boolean, boolean) to authenticated;

-- Publishing a saved draft: same coverage checks, valued at the reference values.
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

-- =====================================================================================================
-- Availability: no paid-test prerequisite; verification stays truthful and informational
-- =====================================================================================================

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

-- Returns NULL when the change is allowed, otherwise {code, message, details}. The untested-model gate is gone:
-- an implemented, priced model with a known KIE cost can be switched on by anyone holding catalog.operate.
create or replace function app_private.availability_blocker(p_actor uuid, p_model_id text, p_state text, p_accept_untested boolean)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  m app_private.model_catalog;
  x jsonb;
begin
  select * into m from app_private.model_catalog where id = p_model_id;
  if not found then
    return jsonb_build_object('code', 'NOT_FOUND', 'message', 'Model not found.');
  end if;
  if p_state not in ('enabled', 'experimental') then
    return null;
  end if;
  for x in select value from jsonb_array_elements(app_private.model_readiness(p_model_id) -> 'checks') loop
    if not (x ->> 'ok')::boolean and not coalesce((x ->> 'warning')::boolean, false) then
      return jsonb_build_object('code', case x ->> 'key' when 'price' then 'MODEL_NOT_PRICED' when 'adapter' then 'ADAPTER_NOT_IMPLEMENTED'
          when 'supplier_cost' then 'COST_UNKNOWN' when 'provider_account' then 'PROVIDER_PAUSED' else 'NOT_READY' end,
        'message', x ->> 'detail', 'details', jsonb_build_object('modelId', m.id, 'check', x ->> 'key', 'fix', x ->> 'fix'));
    end if;
  end loop;
  return null;
end;
$$;

create or replace function public.admin_set_model_availability(p_model_id text, p_state text, p_note text default null,
  p_accept_untested boolean default false, p_publish_price_version_id uuid default null, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('catalog.operate');
  m app_private.model_catalog;
  v_block jsonb;
  v_basis text;
  v_cap uuid;
  v_published jsonb;
  v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if p_state is null or p_state not in ('enabled', 'experimental', 'maintenance', 'disabled') then
    perform app_private.fail('INVALID_INPUT', 'Choose on, off, maintenance or experimental.');
  end if;
  select * into m from app_private.model_catalog where id = p_model_id for update;
  if not found then perform app_private.fail('NOT_FOUND', 'Model not found.'); end if;
  if p_publish_price_version_id is not null then
    if not exists (select 1 from app_private.price_versions where id = p_publish_price_version_id and model_id = m.id) then
      perform app_private.fail('NOT_FOUND', 'That price draft belongs to another model.');
    end if;
    v_published := public.admin_publish_price_version(p_publish_price_version_id, p_reason);
  end if;
  v_block := app_private.availability_blocker(v_actor, m.id, p_state, p_accept_untested);
  if v_block is not null then
    perform app_private.fail(v_block ->> 'code', v_block ->> 'message', coalesce(v_block -> 'details', '{}'::jsonb));
  end if;
  if m.state = p_state and m.availability_note is not distinct from v_note then
    return jsonb_build_object('modelId', m.id, 'state', p_state, 'enableBasis', m.enable_basis, 'verificationStatus', m.verification_status, 'unchanged', true);
  end if;
  v_cap := (app_private.capability_for(m.id)).id;
  -- Why it is available, recorded truthfully: a validated test, manual evidence, or the documented KIE cost (untested).
  v_basis := case
    when p_state not in ('enabled', 'experimental') then m.enable_basis
    when m.verification_status = 'verified_by_test' and m.verified_capability_version_id = v_cap then 'verified_test'
    when m.verification_status = 'manual_evidence' then 'manual_evidence'
    else 'documented_cost' end;
  update app_private.model_catalog
  set state = p_state, availability_note = v_note, enable_basis = v_basis, availability_changed_at = now(), availability_changed_by = v_actor
  where id = m.id;
  perform app_private.audit(v_actor, 'catalog.operate', 'model.availability', 'model', m.id,
    coalesce(nullif(trim(p_reason), ''), case p_state
      when 'enabled' then 'Turned on ' || m.public_name || case when v_basis = 'documented_cost' then ' (not tested yet; priced on the documented KIE cost)' else '' end
      when 'disabled' then 'Turned off ' || m.public_name
      when 'maintenance' then 'Paused ' || m.public_name || ' for maintenance'
      else 'Marked ' || m.public_name || ' as experimental' end),
    jsonb_build_object('state', m.state, 'enableBasis', m.enable_basis, 'note', m.availability_note),
    jsonb_build_object('state', p_state, 'enableBasis', v_basis, 'verificationStatus', m.verification_status, 'note', v_note, 'publishedPrice', v_published));
  return jsonb_build_object('modelId', m.id, 'state', p_state, 'enableBasis', v_basis, 'verificationStatus', m.verification_status,
    'publishedPrice', v_published, 'unchanged', false);
end;
$$;
