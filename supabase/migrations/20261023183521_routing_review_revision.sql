-- Routing review: a stable preview revision (found while testing the full catalog, 22 Oct 2026).
--
-- public.admin_routing_review hashed its proposals in the order the proposal functions returned them. That order is not
-- fixed (app_private.offer_review aggregates offers without an ORDER BY, and PL/pgSQL may switch to a generic plan after a
-- few calls), so with more offers per model a preview could be refused as "changed" when nothing had changed. The
-- revision is now computed over the proposals sorted by offer. Everything else is as in 20261018181652_multi_provider_routing_part07.
-- Rollback: re-create the function from that migration.

create or replace function public.admin_routing_review(p_apply boolean, p_revision text default null, p_activate uuid[] default '{}')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability(case when p_apply then 'provider.manage' else 'provider.read' end);
  v_props jsonb := app_private.routing_review_proposals() || app_private.inventory_proposals();
  -- The revision covers the proposals in a fixed order: the functions above may return the same rows in another order
  -- from one call to the next (query plans change), which must not invalidate the owner's preview.
  v_rev text := md5(coalesce((select jsonb_agg(p order by p ->> 'offerId', p::text) from jsonb_array_elements(v_props) p), '[]'::jsonb)::text);
  x jsonb;
  v_changed int := 0;
  v_off int := 0;
  v_on int := 0;
  v_providers jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('provider', a.provider, 'name', coalesce(a.display_name, a.provider), 'enabled', a.enabled,
      'winningOffers', (select count(*) from jsonb_array_elements(v_props) p where p ->> 'provider' = a.provider and p ->> 'proposedDecision' = 'eligible'
        and (p ->> 'mapped')::boolean),
      'activeAfterApply', exists (select 1 from jsonb_array_elements(v_props) p where p ->> 'provider' = a.provider and p ->> 'proposedDecision' = 'eligible'
        and (p ->> 'mapped')::boolean
        and ((p ->> 'routingEnabled')::boolean or (p ->> 'offerId')::uuid = any (coalesce(p_activate, '{}'))) and p ->> 'status' = 'eligible'))
    order by a.sort_order), '[]'::jsonb)
  into v_providers
  from app_private.provider_accounts a where a.provider <> 'fake';
  if not p_apply then
    return jsonb_build_object('revision', v_rev, 'proposals', v_props, 'providers', v_providers);
  end if;
  if p_revision is distinct from v_rev then
    perform app_private.fail('REVIEW_CHANGED', 'Offers or prices changed since the preview. Preview again before applying.');
  end if;
  for x in select value from jsonb_array_elements(v_props) loop
    if x ->> 'proposedDecision' is distinct from x ->> 'currentDecision' then
      v_changed := v_changed + 1;
    end if;
    update app_private.provider_offers set decision = x ->> 'proposedDecision', decision_reason = x ->> 'reason', decided_at = now(),
      routing_enabled = case
        when x ->> 'proposedDecision' in ('dominated', 'incompatible', 'unavailable') then false
        when (x ->> 'offerId')::uuid = any (coalesce(p_activate, '{}')) and (x ->> 'canActivate')::boolean then true
        else routing_enabled end
    where id = (x ->> 'offerId')::uuid;
    if x ->> 'proposedDecision' in ('dominated', 'incompatible', 'unavailable') and (x ->> 'routingEnabled')::boolean then
      v_off := v_off + 1;
    end if;
    if (x ->> 'offerId')::uuid = any (coalesce(p_activate, '{}')) and (x ->> 'canActivate')::boolean then
      v_on := v_on + 1;
    end if;
  end loop;
  perform app_private.audit(v_actor, 'provider.manage', 'routing.review_applied', 'routing', v_rev,
    format('Routing review applied: %s decisions changed, %s offers switched off, %s switched on', v_changed, v_off, v_on), null,
    jsonb_build_object('activated', p_activate, 'proposals', (select jsonb_agg(jsonb_build_object('offerId', p ->> 'offerId', 'decision', p ->> 'proposedDecision'))
      from jsonb_array_elements(v_props) p)));
  return jsonb_build_object('applied', true, 'revision', v_rev, 'changed', v_changed, 'switchedOff', v_off, 'switchedOn', v_on, 'providers', v_providers);
end;
$$;
