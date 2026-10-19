-- Documented activation: an owner-controlled way to let a supplier offer serve customers without a paid live test.
--
-- Until now an offer served only once it was marked Verified, and that mark took any free-text note. Now there are two
-- evidence statuses, both recorded on the offer:
--   live_test   "Live-tested": set only from a real, succeeded test job of exactly this offer (job_route_pins). A note
--               alone is refused, so a test reference can never be invented.
--   documented  "Documented, not live-tested": set only by the owner (provider.manage) with an explicit acknowledgement
--               and a reason, and only when every check below passes at that moment:
--               integration in this release (documented request, status and result formats), supplier documentation
--               recorded, a documented result download host, no open documentation gap, a published or supplier-confirmed
--               price that is current, the provider on with a saved key, a passed free authentication check, a balance
--               read in the last hour that covers the cheapest compatible request, and at least one compatible setting.
-- Safety stop: the first job on a documented-only offer that ends failed or in review switches that offer off (back to
-- not verified, routing off, reason recorded); its requests go to the next route, at most the original KIE route's cost.
-- Customer prices are unchanged (they follow the KIE reference, never the route); reservations, refunds, balance gates,
-- daily caps, the circuit breaker and stale-price rules are unchanged.

-- ===================================================================== schema

alter table app_private.provider_offers
  add column verification_basis text check (verification_basis in ('live_test', 'documented')),
  add column live_test_job_id uuid references public.generation_jobs (id),
  add column documentation_gap text check (documentation_gap is null or char_length(documentation_gap) between 3 and 500),
  add column activation_snapshot jsonb,
  add column auto_paused_at timestamptz,
  add column auto_paused_reason text;

-- Documented result download hosts per integration, identical to each supplier client's list in code
-- (src/lib/providers/*: resultHosts; contract-tested). An integration without one cannot be activated without a live test.
alter table app_private.provider_adapters add column result_hosts text[] not null default '{}';
update app_private.provider_adapters set result_hosts = case provider
  when 'kie' then array['tempfile.aiquickdraw.com', 'file.aiquickdraw.com', 'tempfile.redpandaai.co', 'file.redpandaai.co']
  when 'apimart' then array['upload.apimart.ai']
  when 'nezhagate' then array['img.nezhagate.com']
  when 'poyo' then array['storage.poyo.ai']
  when 'duomi' then array['cdn3.dmiapi.com'] end
where provider in ('kie', 'apimart', 'nezhagate', 'poyo', 'duomi');

-- Open documentation gaps recorded with the offers (from the supplier documentation review of 18 Oct 2026).
update app_private.provider_offers f set documentation_gap = 'Whether sound changes the price is not documented.'
from app_private.provider_accounts a
where a.id = f.provider_account_id and a.provider = 'apimart' and f.model_id = 'seedance-2-fast';
update app_private.provider_offers f set documentation_gap = 'The result download host is not documented.'
from app_private.provider_accounts a
where a.id = f.provider_account_id and a.provider = 'cuddler' and f.model_id = 'kling-3-0';
update app_private.provider_offers f set documentation_gap = 'Token-priced: only a 480p estimate is published, and the result download host is not documented.'
from app_private.provider_accounts a
where a.id = f.provider_account_id and a.provider = 'cuddler' and f.model_id = 'seedance-2-5';
update app_private.provider_offers f set documentation_gap = 'No model page in the supplier documentation (only the general guide), and the 1K rate is described as temporary.'
from app_private.provider_accounts a
where a.id = f.provider_account_id and a.provider = 'nezhagate' and f.model_id in ('gpt-sunburst-image', 'gpt-sunburst-edit');

-- NezhaGate announced a GPT Image 2.5 Flare/Sunburst 2K service disruption on 18 Oct 2026: its Flare offers leave 2K
-- out (2K requests keep their original route). The owner can add 2K back once the supplier reports it fixed.
update app_private.provider_offers f
set capabilities = jsonb_set(f.capabilities, '{options,resolution}', '["1K", "4K"]')
  || jsonb_build_object('notes', coalesce(f.capabilities -> 'notes', '[]'::jsonb) || '["2K left out: the supplier announced a 2K service disruption on 18 Oct 2026"]'::jsonb)
from app_private.provider_accounts a
where a.id = f.provider_account_id and a.provider = 'nezhagate' and f.model_id in ('gpt-flare-image', 'gpt-flare-edit')
  and f.capabilities -> 'options' -> 'resolution' = '["1K", "2K", "4K"]'::jsonb;

-- ===================================================================== readiness

-- Every requirement of documented activation for one offer, with a plain reason for each, plus how many of the model's
-- settings the offer can take and price, how many cost less than the original KIE route, and how many requests the
-- balance covers at the cheapest of them.
create or replace function app_private.offer_activation_readiness(p_offer_id uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  f app_private.provider_offers;
  a app_private.provider_accounts;
  ad app_private.provider_adapters;
  p jsonb;
  cu app_private.cost_unit_versions;
  c app_private.model_capability_versions;
  sc app_private.supplier_cost_versions;
  ex jsonb;
  v_dims jsonb;
  cfg jsonb;
  v_opts jsonb;
  v_refs int;
  v_outputs int;
  v_native numeric;
  v_usd numeric;
  v_kie numeric;
  v_configs int := 0;
  v_compatible int := 0;
  v_cheaper int := 0;
  v_max_saving numeric;
  v_min_native numeric;
  v_min_usd numeric;
  v_stale_days int := coalesce((app_private.setting('provider_price_stale_days') #>> '{}')::int, 30);
  v_bal_minutes int := coalesce((app_private.setting('provider_balance_stale_minutes') #>> '{}')::int, 60);
  v_upu numeric := (app_private.cost_unit('kie_credit')).units_per_usd;
  v_avail numeric;
  v_pending numeric;
  v_fresh boolean;
  v_price_ok boolean;
  v_bal_ok boolean;
  v_checks jsonb;
begin
  select * into f from app_private.provider_offers where id = p_offer_id;
  if not found then
    return null;
  end if;
  select * into a from app_private.provider_accounts where id = f.provider_account_id;
  select * into ad from app_private.provider_adapters where adapter = f.adapter;
  p := app_private.offer_price(f.id);
  if p is not null then
    select * into cu from app_private.cost_unit(p ->> 'unit');
  end if;

  -- The model's settings this offer can take and price (aspect ratios included, so an offer without "auto" still counts).
  if f.model_id is not null and p is not null and cu.id is not null then
    c := app_private.capability_for(f.model_id);
    sc := app_private.latest_cost_version(f.model_id);
    ex := app_private.example_request(c.spec);
    v_refs := coalesce((ex -> 'quantities' -> 'counts' ->> '_references')::int, 0);
    v_outputs := coalesce((c.spec -> 'output' ->> 'count')::int, 1);
    v_dims := coalesce(app_private.price_dims(sc.schedule), '[]'::jsonb);
    if coalesce(c.spec -> 'options' ? 'aspect_ratio', false) and not v_dims ? 'aspect_ratio' then
      v_dims := v_dims || '["aspect_ratio"]'::jsonb;
    end if;
    for cfg in select * from app_private.price_configs(c.spec, v_dims) loop
      v_configs := v_configs + 1;
      v_opts := coalesce(ex -> 'options', '{}'::jsonb) || cfg;
      if app_private.offer_incompatibility(f.capabilities, v_opts, ex ->> 'mode', ex -> 'quantities') is not null then
        continue;
      end if;
      v_native := app_private.offer_native_cost(p -> 'schedule', v_opts, ex -> 'quantities');
      if v_native is null then
        continue;
      end if;
      v_compatible := v_compatible + 1;
      v_usd := app_private.effective_usd(v_native, cu.units_per_usd, a.funding_fee_bps, a.funding_bonus_bps);
      v_kie := app_private.kie_reference_usd(app_private.supplier_credits(sc.schedule, v_opts, v_refs, v_outputs), v_upu);
      if v_kie is not null and v_usd < v_kie then
        v_cheaper := v_cheaper + 1;
        v_max_saving := greatest(v_max_saving, round((1 - v_usd / v_kie) * 100));
      end if;
      if v_min_native is null or v_native < v_min_native then
        v_min_native := v_native;
        v_min_usd := v_usd;
      end if;
    end loop;
  end if;

  v_price_ok := p is not null and p ->> 'confidence' in ('authoritative', 'documented') and cu.id is not null
    and coalesce((p ->> 'expiresAt')::timestamptz > now(), true)
    and ((p ->> 'checkedAt')::timestamptz >= now() - make_interval(days => v_stale_days) or coalesce(f.price_override_until > now(), false));
  v_fresh := a.balance_source = 'api' and a.last_balance_at > now() - make_interval(mins => v_bal_minutes)
    and (a.last_balance_error_at is null or a.last_balance_error_at < a.last_balance_at);
  v_avail := coalesce(a.balance_available, a.last_balance);
  if v_fresh then
    v_pending := app_private.account_pending_native(a.id, a.last_balance_at);
  end if;
  v_bal_ok := v_fresh and v_avail is not null and p is not null and a.balance_unit = p ->> 'unit' and v_min_native is not null
    and v_avail - coalesce(v_pending, 0) >= v_min_native;

  v_checks := jsonb_build_array(
    jsonb_build_object('key', 'offer', 'label', 'Supplier offer for a Genlixs model', 'ok', f.model_id is not null and not f.is_legacy_primary,
      'detail', case when f.is_legacy_primary then 'This is the model''s original route.' when f.model_id is null then 'Not mapped to a Genlixs model.'
        else 'Serves ' || f.model_id || '.' end),
    jsonb_build_object('key', 'integration', 'label', 'Documented API integrated in this release', 'ok', ad.adapter is not null,
      'detail', case when ad.adapter is not null then 'Request, status and result formats of ' || ad.adapter || ', written from the supplier''s API reference.'
        else 'No integration for this offer in this release.' end),
    jsonb_build_object('key', 'docs', 'label', 'Supplier documentation recorded', 'ok', f.docs_url is not null,
      'detail', coalesce(f.docs_url, 'No API documentation link is recorded for this offer.')),
    jsonb_build_object('key', 'result_hosts', 'label', 'Result download host documented', 'ok', coalesce(cardinality(ad.result_hosts), 0) > 0,
      'detail', case when coalesce(cardinality(ad.result_hosts), 0) > 0 then array_to_string(ad.result_hosts, ', ')
        else 'Not documented: results could not be downloaded. Confirm the host with a live test.' end),
    jsonb_build_object('key', 'documentation', 'label', 'No open documentation gap', 'ok', f.documentation_gap is null,
      'detail', coalesce(f.documentation_gap, 'None recorded.')),
    jsonb_build_object('key', 'price', 'label', 'Validated, current price', 'ok', v_price_ok,
      'detail', case when p is null then 'No price recorded.'
        when p ->> 'confidence' not in ('authoritative', 'documented') then 'The price is ' || (p ->> 'confidence') || ', not published or confirmed by the supplier.'
        when cu.id is null then 'No conversion for unit ' || (p ->> 'unit') || '.'
        when not v_price_ok then 'The price has expired or is older than ' || v_stale_days || ' days.'
        else initcap(p ->> 'confidence') || ' price v' || (p ->> 'version') || ', checked ' || to_char((p ->> 'checkedAt')::timestamptz, 'YYYY-MM-DD') || '.' end),
    jsonb_build_object('key', 'account', 'label', 'Provider on with a saved key', 'ok', a.enabled and not a.paused and a.credential_version > 0,
      'detail', case when a.credential_version = 0 then 'No API key saved.' when not a.enabled then 'The provider is switched off.'
        when a.paused then 'The provider is paused.' else 'Key version ' || a.credential_version || '.' end),
    jsonb_build_object('key', 'auth', 'label', 'Free authentication check passed', 'ok', a.connection_state = 'ok',
      'detail', case when a.connection_state = 'ok' then 'A read-only call with the saved key succeeded' || coalesce(' on ' || to_char(a.connection_checked_at, 'YYYY-MM-DD HH24:MI') || ' UTC', '') || '.'
        when a.connection_state = 'unauthorized' then 'The provider refused the key.'
        else 'Run Test connection (read-only and free).' end),
    jsonb_build_object('key', 'balance', 'label', 'Sufficient balance', 'ok', v_bal_ok,
      'detail', case when not v_fresh then 'No balance read from the provider in the last ' || v_bal_minutes || ' minutes: refresh it.'
        when v_avail is null then 'The provider reports no balance.'
        when p is null then 'No price to compare the balance with.'
        when a.balance_unit <> p ->> 'unit' then 'The balance unit does not match the price unit.'
        when v_min_native is null then 'No compatible priced setting to compare with.'
        when not v_bal_ok then 'The balance cannot cover the cheapest compatible request (' || trim_scale(v_min_native)::text || ' ' || (p ->> 'unit') || ').'
        else 'Covers about ' || floor((v_avail - coalesce(v_pending, 0)) / v_min_native) || ' request(s) at the cheapest compatible setting.' end),
    jsonb_build_object('key', 'settings', 'label', 'Compatible settings', 'ok', v_compatible > 0,
      'detail', v_compatible || ' of ' || v_configs || ' settings' || case when v_compatible > 0 then ', ' || v_cheaper || ' cheaper than the original route' else '' end || '.'));

  return jsonb_build_object('offerId', f.id,
    'qualifies', not exists (select 1 from jsonb_array_elements(v_checks) x where not (x ->> 'ok')::boolean),
    'checks', v_checks, 'configs', v_configs, 'compatible', v_compatible, 'cheaper', v_cheaper, 'maxSavingPct', v_max_saving,
    'cheapestNative', v_min_native, 'cheapestUsd', v_min_usd, 'unit', p ->> 'unit',
    'balance', jsonb_build_object('available', v_avail, 'pending', v_pending, 'unit', a.balance_unit, 'observedAt', a.last_balance_at, 'fresh', coalesce(v_fresh, false)),
    'basis', f.verification_basis, 'status', f.status, 'routingEnabled', f.routing_enabled, 'checkedAt', now());
end;
$$;

create or replace function public.admin_offer_activation_readiness(p_offer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('provider.read');
  r jsonb := app_private.offer_activation_readiness(p_offer_id);
begin
  if r is null then
    perform app_private.fail('NOT_FOUND', 'Offer not found.');
  end if;
  return r;
end;
$$;

-- ===================================================================== activation

-- Owner: activate an offer without a live test. Every readiness check must pass now; the acknowledgement, the reason and
-- the checks are recorded on the offer and in the audit log. The offer is labelled "Documented, not live-tested".
create or replace function public.admin_activate_offer_documented(p_offer_id uuid, p_reason text, p_acknowledge boolean)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('provider.manage');
  f app_private.provider_offers;
  v_after app_private.provider_offers;
  r jsonb;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not coalesce(p_acknowledge, false) then
    perform app_private.fail('ACKNOWLEDGEMENT_REQUIRED',
      'Confirm that this offer has not been tested live and will serve customers on its documentation alone.');
  end if;
  if v_reason is null or char_length(v_reason) < 10 then
    perform app_private.fail('REASON_REQUIRED', 'Say why this offer may serve without a live test (at least 10 characters).');
  end if;
  select * into f from app_private.provider_offers where id = p_offer_id for update;
  if not found then
    perform app_private.fail('NOT_FOUND', 'Offer not found.');
  end if;
  if f.status = 'eligible' and f.verification_basis = 'live_test' then
    perform app_private.fail('ALREADY_LIVE_TESTED', 'This offer is already live-tested.');
  end if;
  r := app_private.offer_activation_readiness(f.id);
  if not (r ->> 'qualifies')::boolean then
    perform app_private.fail('NOT_QUALIFIED', 'This offer cannot be activated without a live test: '
      || (select string_agg((x ->> 'label') || ' — ' || (x ->> 'detail'), '; ') from jsonb_array_elements(r -> 'checks') x where not (x ->> 'ok')::boolean),
      jsonb_build_object('readiness', r));
  end if;
  update app_private.provider_offers set status = 'eligible', verification_basis = 'documented', live_test_job_id = null, routing_enabled = true,
    verified_at = now(), verified_by = v_actor, verification_note = left('Documented, not live-tested: ' || v_reason, 1000),
    activation_snapshot = jsonb_build_object('basis', 'documented', 'activatedAt', now(), 'activatedBy', v_actor, 'reason', v_reason, 'readiness', r),
    auto_paused_at = null, auto_paused_reason = null
  where id = f.id;
  select * into v_after from app_private.provider_offers where id = f.id;
  perform app_private.audit(v_actor, 'provider.manage', 'provider_offer.activated_documented', 'provider_offer', f.id::text,
    'Activated without a live test (documented, not live-tested): ' || v_reason,
    jsonb_build_object('status', f.status, 'routingEnabled', f.routing_enabled, 'basis', f.verification_basis),
    jsonb_build_object('status', v_after.status, 'routingEnabled', v_after.routing_enabled, 'basis', v_after.verification_basis,
      'compatible', r -> 'compatible', 'cheaper', r -> 'cheaper', 'balance', r -> 'balance'));
  return app_private.offer_json(v_after) || jsonb_build_object('readiness', r);
end;
$$;

-- Safety stop for offers serving on documentation alone: the first refusal by the supplier, or the first job on the
-- offer that ends failed or in review, switches the offer off (back to not verified, routing off, reason recorded).
-- Live-tested offers and the original routes are not affected. The owner can activate it again once the cause is known.
create or replace function app_private.pause_documented_offer(p_offer_id uuid, p_reason text, p_details jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  f app_private.provider_offers;
begin
  select * into f from app_private.provider_offers where id = p_offer_id for update;
  if not found or f.status <> 'eligible' or f.verification_basis is distinct from 'documented' then
    return;
  end if;
  update app_private.provider_offers set status = 'capabilities_unverified', routing_enabled = false, verification_basis = null,
    auto_paused_at = now(), auto_paused_reason = left(p_reason, 300)
  where id = f.id;
  perform app_private.audit(null, 'system', 'provider_offer.auto_paused', 'provider_offer', f.id::text, left(p_reason, 300),
    jsonb_build_object('status', f.status, 'routingEnabled', f.routing_enabled, 'basis', f.verification_basis),
    jsonb_build_object('status', 'capabilities_unverified', 'routingEnabled', false, 'basis', null) || coalesce(p_details, '{}'::jsonb));
end;
$$;

create or replace function app_private.documented_offer_job_failed()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  t app_private.provider_attempts;
begin
  select * into t from app_private.provider_attempts where job_id = new.id and offer_id is not null order by ordinal desc limit 1;
  if t.offer_id is not null then
    perform app_private.pause_documented_offer(t.offer_id,
      'Job ' || new.short_ref || ' ended ' || replace(new.state, '_', ' ') || coalesce(' (' || new.failure_code || ')', '')
        || ' while this offer served without a live test.',
      jsonb_build_object('jobId', new.id, 'jobState', new.state, 'failureCode', new.failure_code));
  end if;
  return new;
end;
$$;

create trigger generation_jobs_documented_offer_failed after update of state on public.generation_jobs
  for each row when (new.state in ('failed', 'review_required') and old.state is distinct from new.state)
  execute function app_private.documented_offer_job_failed();

create or replace function app_private.documented_offer_attempt_rejected()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.offer_id is not null then
    perform app_private.pause_documented_offer(new.offer_id,
      'The supplier refused a request' || coalesce(' (' || new.error_code || ')', '') || ' while this offer served without a live test.',
      jsonb_build_object('jobId', new.job_id, 'attemptId', new.id, 'errorCode', new.error_code));
  end if;
  return new;
end;
$$;

create trigger provider_attempts_documented_offer_rejected after update of state on app_private.provider_attempts
  for each row when (new.state = 'rejected' and old.state is distinct from new.state)
  execute function app_private.documented_offer_attempt_rejected();

-- ===================================================================== offer editor

-- Changes from the previous version (20261018181448_multi_provider_routing_part05):
--   status "eligible" (Live-tested) needs testJobId: a succeeded test job pinned to this offer and submitted to it. A note
--   alone is no longer accepted. Any other status clears the evidence status.
--   documentationGap records or clears an open question in the supplier documentation (reason required); recording one
--   switches off an offer that serves on documentation alone.
--   Routing on: an offer needs an evidence status, and one serving on documentation alone must still pass every check.
--   New capabilities on an offer serving on documentation alone must still pass every check.
create or replace function public.admin_update_offer(p_offer_id uuid, p_patch jsonb, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('provider.manage');
  f app_private.provider_offers;
  v_after app_private.provider_offers;
  a app_private.provider_accounts;
  k text;
  v_price jsonb;
  v_status text;
  v_job public.generation_jobs;
  v_test uuid;
  v_ready jsonb;
begin
  select * into f from app_private.provider_offers where id = p_offer_id for update;
  if not found then
    perform app_private.fail('NOT_FOUND', 'Offer not found.');
  end if;
  select * into a from app_private.provider_accounts where id = f.provider_account_id;
  for k in select jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) loop
    if k not in ('routingEnabled', 'status', 'capabilities', 'sortOrder', 'verificationNote', 'priceOverrideDays', 'testJobId', 'documentationGap') then
      perform app_private.fail('INVALID_INPUT', 'Unknown setting: ' || left(k, 40));
    end if;
  end loop;
  if p_patch ? 'testJobId' and p_patch ->> 'status' is distinct from 'eligible' then
    perform app_private.fail('INVALID_INPUT', 'A test job is only recorded when marking the offer live-tested.');
  end if;
  if p_patch ? 'capabilities' then
    if f.is_legacy_primary then
      perform app_private.fail('INVALID_INPUT', 'The original route follows the public model''s capability; change the model instead.');
    end if;
    perform app_private.validate_capabilities(p_patch -> 'capabilities');
    update app_private.provider_offers set capabilities = p_patch -> 'capabilities' where id = f.id;
  end if;
  if p_patch ? 'verificationNote' then
    update app_private.provider_offers set verification_note = left(nullif(trim(p_patch ->> 'verificationNote'), ''), 1000) where id = f.id;
  end if;
  if p_patch ? 'documentationGap' then
    if f.is_legacy_primary then
      perform app_private.fail('INVALID_INPUT', 'The original route has no documentation review.');
    end if;
    if coalesce(nullif(trim(p_reason), ''), '') = '' then
      perform app_private.fail('REASON_REQUIRED', 'Say where this documentation question comes from or how it was answered.');
    end if;
    if jsonb_typeof(p_patch -> 'documentationGap') = 'null' or nullif(trim(p_patch ->> 'documentationGap'), '') is null then
      update app_private.provider_offers set documentation_gap = null where id = f.id;
    elsif char_length(trim(p_patch ->> 'documentationGap')) between 3 and 500 then
      update app_private.provider_offers set documentation_gap = trim(p_patch ->> 'documentationGap') where id = f.id;
      if f.status = 'eligible' and f.verification_basis = 'documented' then
        update app_private.provider_offers set status = 'capabilities_unverified', routing_enabled = false, verification_basis = null where id = f.id;
      end if;
    else
      perform app_private.fail('INVALID_INPUT', 'Describe the documentation gap in 3 to 500 characters.');
    end if;
  end if;
  if p_patch ? 'status' then
    v_status := p_patch ->> 'status';
    if v_status not in ('discovered', 'pricing_unverified', 'capabilities_unverified', 'configured', 'eligible', 'disabled', 'stale', 'unavailable') then
      perform app_private.fail('INVALID_INPUT', 'Unknown status.');
    end if;
    if v_status = 'eligible' then
      v_price := app_private.offer_price(f.id);
      if f.is_legacy_primary then
        perform app_private.fail('INVALID_INPUT', 'The original route is not verified from here.');
      elsif f.model_id is null then
        perform app_private.fail('OFFER_NOT_READY', 'Map this offer to a public model first.');
      elsif f.adapter is null then
        perform app_private.fail('OFFER_NOT_READY', 'This release has no integration for this offer.');
      elsif v_price is null or v_price ->> 'confidence' not in ('authoritative', 'documented', 'estimate') then
        perform app_private.fail('OFFER_NOT_READY', 'Save a verified price first (documented, account quote or provider estimate).');
      end if;
      -- Live-tested only with a real test: a succeeded job pinned to this offer and submitted to it.
      if coalesce(p_patch ->> 'testJobId', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        perform app_private.fail('LIVE_TEST_REQUIRED',
          'Choose the succeeded test job of this offer. Without a live test, use "Activate: documented, not live-tested".');
      end if;
      v_test := (p_patch ->> 'testJobId')::uuid;
      select j.* into v_job from public.generation_jobs j
      join app_private.job_route_pins pin on pin.job_id = j.id and pin.offer_id = f.id
      where j.id = v_test;
      if v_job.id is null then
        perform app_private.fail('LIVE_TEST_REQUIRED', 'That job is not a test of this offer.');
      elsif v_job.state <> 'succeeded' then
        perform app_private.fail('LIVE_TEST_REQUIRED', 'That test job has not succeeded (' || replace(v_job.state, '_', ' ') || ').');
      elsif not exists (select 1 from app_private.provider_attempts t where t.job_id = v_job.id and t.offer_id = f.id and t.state = 'accepted') then
        perform app_private.fail('LIVE_TEST_REQUIRED', 'That test job was not accepted by this offer''s supplier.');
      end if;
      update app_private.provider_offers set status = 'eligible', verification_basis = 'live_test', live_test_job_id = v_job.id,
        verified_at = now(), verified_by = v_actor, auto_paused_at = null, auto_paused_reason = null,
        verification_note = coalesce(nullif(trim(p_patch ->> 'verificationNote'), ''), 'Live-tested: job ' || v_job.short_ref || ' succeeded.')
      where id = f.id;
    else
      update app_private.provider_offers set status = v_status, routing_enabled = false, verification_basis = null where id = f.id;
    end if;
  end if;
  if p_patch ? 'priceOverrideDays' then
    if jsonb_typeof(p_patch -> 'priceOverrideDays') = 'null' then
      update app_private.provider_offers set price_override_until = null where id = f.id;
    elsif coalesce((p_patch ->> 'priceOverrideDays') ~ '^\d{1,2}$', false) and (p_patch ->> 'priceOverrideDays')::int between 1 and 30 then
      if coalesce(nullif(trim(p_reason), ''), '') = '' then
        perform app_private.fail('REASON_REQUIRED', 'Say why the stale price may still be used.');
      end if;
      update app_private.provider_offers set price_override_until = now() + make_interval(days => (p_patch ->> 'priceOverrideDays')::int) where id = f.id;
    else
      perform app_private.fail('INVALID_INPUT', 'Override between 1 and 30 days.');
    end if;
  end if;
  if p_patch ? 'sortOrder' then
    if coalesce((p_patch ->> 'sortOrder') ~ '^\d{1,4}$', false) is not true then
      perform app_private.fail('INVALID_INPUT', 'Order must be a whole number.');
    end if;
    update app_private.provider_offers set sort_order = (p_patch ->> 'sortOrder')::int where id = f.id;
  end if;
  if p_patch ? 'routingEnabled' then
    if jsonb_typeof(p_patch -> 'routingEnabled') <> 'boolean' then
      perform app_private.fail('INVALID_INPUT', 'Routing must be true or false.');
    end if;
    if (p_patch ->> 'routingEnabled')::boolean then
      select * into v_after from app_private.provider_offers where id = f.id;
      if v_after.status <> 'eligible' or (not v_after.is_legacy_primary and v_after.verification_basis is null) then
        perform app_private.fail('OFFER_NOT_READY', 'Mark the offer live-tested, or activate it as documented, before routing to it.');
      end if;
      if not a.enabled or (a.credential_version = 0 and a.secret_ref <> 'KIE_API_KEY') then
        perform app_private.fail('OFFER_NOT_READY', 'Switch the provider on with a saved key first.');
      end if;
    end if;
    update app_private.provider_offers set routing_enabled = (p_patch ->> 'routingEnabled')::boolean where id = f.id;
  end if;
  -- An offer serving on documentation alone keeps serving only while every check still passes.
  select * into v_after from app_private.provider_offers where id = f.id;
  if v_after.routing_enabled and v_after.verification_basis = 'documented' and (p_patch ? 'capabilities' or p_patch ? 'routingEnabled') then
    v_ready := app_private.offer_activation_readiness(f.id);
    if not (v_ready ->> 'qualifies')::boolean then
      perform app_private.fail('NOT_QUALIFIED', 'This offer serves without a live test and no longer passes: '
        || (select string_agg((x ->> 'label') || ' — ' || (x ->> 'detail'), '; ') from jsonb_array_elements(v_ready -> 'checks') x where not (x ->> 'ok')::boolean),
        jsonb_build_object('readiness', v_ready));
    end if;
  end if;
  perform app_private.audit(v_actor, 'provider.manage', 'provider_offer.updated', 'provider_offer', f.id::text,
    coalesce(nullif(trim(p_reason), ''), 'Changed ' || (select string_agg(x, ', ') from jsonb_object_keys(p_patch) x)),
    jsonb_build_object('status', f.status, 'routingEnabled', f.routing_enabled, 'capabilities', f.capabilities, 'priceOverrideUntil', f.price_override_until,
      'basis', f.verification_basis, 'liveTestJobId', f.live_test_job_id, 'documentationGap', f.documentation_gap),
    jsonb_build_object('status', v_after.status, 'routingEnabled', v_after.routing_enabled, 'capabilities', v_after.capabilities,
      'priceOverrideUntil', v_after.price_override_until, 'basis', v_after.verification_basis, 'liveTestJobId', v_after.live_test_job_id,
      'documentationGap', v_after.documentation_gap));
  return app_private.offer_json(v_after);
end;
$$;

-- Adds the evidence status (verificationBasis: live_test | documented | null), the live test job, the open documentation
-- gap, the safety stop and what was checked at activation.
create or replace function app_private.offer_json(f app_private.provider_offers)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object('id', f.id, 'accountId', f.provider_account_id, 'provider', a.provider, 'providerName', coalesce(a.display_name, a.provider),
    'modelId', f.model_id, 'productKey', f.product_key, 'productLabel', f.product_label, 'tool', f.tool, 'operation', f.operation,
    'upstreamModelId', f.upstream_model_id, 'adapter', f.adapter, 'capabilities', f.capabilities, 'status', f.status, 'decision', f.decision,
    'decisionReason', f.decision_reason, 'decidedAt', f.decided_at, 'blocker', f.blocker, 'routingEnabled', f.routing_enabled,
    'legacy', f.is_legacy_primary, 'sourceUrl', f.source_url, 'docsUrl', f.docs_url, 'verificationNote', f.verification_note,
    'verifiedAt', f.verified_at, 'priceOverrideUntil', f.price_override_until, 'sortOrder', f.sort_order,
    'price', app_private.offer_price(f.id),
    'accountReady', a.enabled and not a.paused and (a.credential_version > 0 or a.secret_ref = 'KIE_API_KEY'),
    'verificationBasis', f.verification_basis,
    'liveTestJob', (select jsonb_build_object('id', j.id, 'ref', j.short_ref, 'state', j.state) from public.generation_jobs j where j.id = f.live_test_job_id),
    'documentationGap', f.documentation_gap, 'autoPausedAt', f.auto_paused_at, 'autoPausedReason', f.auto_paused_reason,
    'activation', case when f.verification_basis = 'documented' then f.activation_snapshot - 'readiness' end)
  from app_private.provider_accounts a where a.id = f.provider_account_id;
$$;

-- Offers verified before this release with a note only (none on production) lose that status: they need a live test or
-- a documented activation, like every other offer.
update app_private.provider_offers set status = 'capabilities_unverified', routing_enabled = false
where status = 'eligible' and not is_legacy_primary and verification_basis is null;

-- Re-created with the evidence status of each quote (basis, documentationGap, autoPausedReason) and a
-- documentation_gap stage; everything else as in 20261018232513_automatic_pricing.
create or replace function public.admin_catalog_supply()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('provider.read');
  pol app_private.pricing_policy_versions := app_private.current_pricing_policy();
  t jsonb := app_private.policy_terms(app_private.current_pricing_policy());
  v_bps int := (t ->> 'markupBps')::int;
  v_v numeric := (t ->> 'usdPerCredit')::numeric;
  v_upu numeric := (t ->> 'kieUnitsPerUsd')::numeric;
begin
  return jsonb_build_object(
    'generatedAt', now(),
    'policy', app_private.policy_json(pol),
    'suppliers', (select coalesce(jsonb_agg(jsonb_build_object('provider', a.provider, 'name', coalesce(a.display_name, a.provider),
        'on', a.enabled and not a.paused, 'hasKey', a.credential_version > 0 or a.secret_ref = 'KIE_API_KEY') order by a.sort_order), '[]'::jsonb)
      from app_private.provider_accounts a where a.provider <> 'fake'),
    'models', (select coalesce(jsonb_agg(x.j order by x.sort_order), '[]'::jsonb) from (
      select m.sort_order, jsonb_build_object(
        'id', m.id,
        'example', ex.e,
        -- Genlixs credits charged for the default request by the published price (null when not priced).
        'defaultUnits', du.units,
        'pricing', jsonb_build_object(
          'status', g.r ->> 'status', 'reason', g.r ->> 'reason',
          'followsPolicy', coalesce(pub.id is not null and pub.capability_version_id = cv.id and pub.rules = g.r -> 'rules', false),
          'priceVersion', pub.version, 'priceSource', pub.source,
          'policyVersion', (select pp.version from app_private.pricing_policy_versions pp where pp.id = pub.policy_version_id),
          'kieUsd', trim_scale(kb.usd), 'targetUsd', trim_scale(round(kb.usd * (10000 + v_bps) / 10000, 8)),
          'chargedUsd', trim_scale(du.units * v_v),
          'cost', case when sc.id is not null then jsonb_build_object('version', sc.version, 'sourceKind', sc.source_kind, 'sourceUrl', sc.source_url,
            'checkedAt', sc.source_checked_at) end),
        'route', jsonb_build_object('status', ch.r ->> 'status', 'explanation', ch.r ->> 'explanation',
            'offerId', ch.r -> 'chosen' ->> 'offerId', 'provider', ch.r -> 'chosen' ->> 'provider', 'providerName', ch.r -> 'chosen' ->> 'providerLabel',
            'legacy', (ch.r -> 'chosen' ->> 'legacy')::boolean, 'native', (ch.r -> 'chosen' ->> 'native')::numeric, 'unit', ch.r -> 'chosen' ->> 'unit',
            'usd', (ch.r -> 'chosen' ->> 'effectiveUsd')::numeric,
            -- effective markup on what the serving supplier costs: (charged value − C) ÷ C
            'effectiveMarkupPct', app_private.effective_markup_pct(du.units * v_v, (ch.r -> 'chosen' ->> 'effectiveUsd')::numeric)),
        'quotes', (select coalesce(jsonb_agg(q.j order by (q.j ->> 'usd')::numeric nulls last, q.sort), '[]'::jsonb) from (
            select f.sort_order as sort, jsonb_build_object(
              'offerId', f.id, 'provider', a.provider, 'providerName', coalesce(a.display_name, a.provider), 'legacy', f.is_legacy_primary,
              'status', f.status, 'decision', f.decision, 'decisionReason', f.decision_reason, 'blocker', f.blocker,
              'routingEnabled', f.routing_enabled, 'supplierOn', a.enabled and not a.paused,
              'hasKey', a.credential_version > 0 or a.secret_ref = 'KIE_API_KEY', 'integrated', f.adapter is not null,
              'confidence', pp.p ->> 'confidence', 'unit', pp.p ->> 'unit', 'unitBasis', cu.basis,
              'incompatible', inc.v, 'native', nat.v,
              'usd', app_private.effective_usd(nat.v, cu.units_per_usd, a.funding_fee_bps, a.funding_bonus_bps),
              'markupIfServedPct', app_private.effective_markup_pct(du.units * v_v,
                app_private.effective_usd(nat.v, cu.units_per_usd, a.funding_fee_bps, a.funding_bonus_bps)),
              'current', f.id::text = ch.r -> 'chosen' ->> 'offerId',
              -- Evidence for serving: live_test (a real succeeded test job), documented (owner activation without a live test) or null.
              'basis', f.verification_basis, 'documentationGap', f.documentation_gap, 'autoPausedReason', f.auto_paused_reason,
              -- The first step still missing before this offer can serve customers (in the order they are done).
              'stage', case
                when f.id::text = ch.r -> 'chosen' ->> 'offerId' then 'serving'
                when f.adapter is null then 'needs_integration'
                when pp.p is null or pp.p ->> 'confidence' in ('conflicting', 'unverified') then 'price_unverified'
                when not (a.credential_version > 0 or a.secret_ref = 'KIE_API_KEY') then 'needs_key'
                when f.status <> 'eligible' and f.documentation_gap is not null then 'documentation_gap'
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
      cross join lateral (select * from app_private.capability_for(m.id)) cv
      cross join lateral (select app_private.example_request(cv.spec) as e) ex
      left join lateral (select * from app_private.latest_cost_version(m.id)) sc on true
      left join app_private.price_versions pub on pub.model_id = m.id and pub.state = 'published'
      cross join lateral (select case when pub.id is not null and pub.capability_version_id = cv.id
          then app_private.price_units_for(pub.rules, ex.e -> 'options', coalesce((ex.e -> 'quantities' -> 'counts' ->> '_references')::int, 0)) end as units) du
      cross join lateral (select app_private.kie_reference_usd(app_private.supplier_credits(sc.schedule, ex.e -> 'options',
          coalesce((ex.e -> 'quantities' -> 'counts' ->> '_references')::int, 0), coalesce((cv.spec -> 'output' ->> 'count')::int, 1)), v_upu) as usd) kb
      cross join lateral (select app_private.policy_model_rules(m.id, v_bps, v_v, v_upu) as r) g
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

revoke execute on function public.admin_offer_activation_readiness(uuid) from public, anon;
grant execute on function public.admin_offer_activation_readiness(uuid) to authenticated;
revoke execute on function public.admin_activate_offer_documented(uuid, text, boolean) from public, anon;
grant execute on function public.admin_activate_offer_documented(uuid, text, boolean) to authenticated;
