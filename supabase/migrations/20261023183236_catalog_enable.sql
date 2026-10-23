-- Full catalog, part 4: switch on the complete new models and retire superseded research rows.
--
-- Turns on every new model that is ready (integration, options, active KIE account, KIE reference price for every setting and a published
-- price under the global policy), recording "documented_cost" as the basis like the owner's existing models. A model whose availability anybody
-- has already changed is left alone. The research rows of 18 Oct for KIE products that are now models are linked to them and switched off.
-- Seedance 1.5 Pro is no longer in KIE's price list or documentation (checked 22 Oct 2026); its KIE research row is marked unavailable.

update app_private.provider_offers f
set model_id = v.model_id, status = 'disabled', decision = 'dominated', routing_enabled = false, decided_at = now(),
  decision_reason = 'Same product as the original KIE route of this model; research entry of 18 Oct 2026 kept for history.',
  blocker = null, updated_at = now()
from app_private.provider_accounts a, (values
  ('flux-kontext', 'flux-kontext-edit'),
  ('grok-video', 'grok-imagine-video'),
  ('kling-2.5-turbo-pro', 'kling-2-5-turbo'),
  ('kling-o3', 'kling-3-0-omni'),
  ('nano-banana-2.1', 'nano-banana-2-1-image'),
  ('pixverse-v6', 'pixverse-v6'),
  ('seedream-4', 'seedream-4-image'),
  ('seedream-4.5', 'seedream-4-5-image'),
  ('seedream-5-lite/2k', 'seedream-5-lite-image'),
  ('seedream-5-pro', 'seedream-5-pro-image'),
  ('wan-2.6-flash', 'wan-2-6-flash'),
  ('wan-3.0', 'wan-3-0'),
  ('z-image-turbo', 'z-image')
) as v(product_key, model_id)
where a.id = f.provider_account_id and a.provider = 'kie' and f.product_key = v.product_key and f.model_id is null
  and f.status in ('discovered', 'pricing_unverified', 'capabilities_unverified') and not f.routing_enabled and f.verification_basis is null
  and exists (select 1 from app_private.model_catalog m where m.id = v.model_id);

update app_private.provider_offers f
set status = 'stale', decided_at = now(), updated_at = now(),
  blocker = 'Superseded on 22 Oct 2026 by separate catalog models: FLUX.2 Flex, FLUX 3 Klein, FLUX.1 Kontext, Ideogram V3, Ideogram Character and Recraft.'
from app_private.provider_accounts a
where a.id = f.provider_account_id and a.provider = 'kie' and f.product_key = 'flux-newer-variants' and f.model_id is null
  and f.status in ('discovered', 'pricing_unverified', 'capabilities_unverified') and not f.routing_enabled and f.verification_basis is null;

update app_private.provider_offers f
set status = 'unavailable', decision = 'unavailable', decided_at = now(), updated_at = now(),
  decision_reason = 'Not in KIE''s price list or documentation any more (checked 22 Oct 2026).'
from app_private.provider_accounts a
where a.id = f.provider_account_id and a.provider = 'kie' and f.product_key = 'seedance-1.5-pro' and f.model_id is null
  and f.status in ('discovered', 'pricing_unverified', 'capabilities_unverified') and not f.routing_enabled and f.verification_basis is null;

do $$
declare
  r record;
  v_block jsonb;
  v_blocked text[] := '{}';
begin
  for r in
    select m.id, m.public_name from app_private.model_catalog m
    where m.id = any (array['gpt-image-2-image', 'gpt-image-2-edit', 'gpt-image-1-5-image', 'gpt-image-1-5-edit', 'gpt-4o-image', 'gpt-4o-image-edit', 'nano-banana-image', 'nano-banana-edit', 'nano-banana-2-edit', 'nano-banana-2-1-image', 'nano-banana-2-1-edit', 'nano-banana-2-lite-image', 'nano-banana-2-lite-edit', 'imagen-4-fast', 'imagen-4', 'imagen-4-ultra', 'flux-2-flex-image', 'flux-2-flex-edit', 'flux-3-klein-image', 'flux-3-klein-edit', 'flux-kontext-image', 'flux-kontext-edit', 'seedream-3-image', 'seedream-4-image', 'seedream-4-edit', 'seedream-4-5-image', 'seedream-4-5-edit', 'seedream-5-lite-image', 'seedream-5-lite-edit', 'seedream-5-pro-image', 'seedream-5-pro-edit', 'z-image', 'grok-imagine-image', 'grok-imagine-edit', 'grok-image-2-image', 'grok-image-2-edit', 'ideogram-v3-image', 'ideogram-v3-remix', 'ideogram-character', 'qwen-image-2-image', 'qwen-image-2-edit', 'qwen-image-2-1-image', 'qwen-image-2-1-edit', 'qwen-image-3-image', 'qwen-image-3-edit', 'qwen-image-3-pro-image', 'qwen-image-3-pro-edit', 'qwen-image-edit', 'wan-2-7-image', 'wan-2-7-image-edit', 'wan-2-7-image-pro', 'wan-2-7-image-pro-edit', 'recraft-upscale', 'recraft-remove-background', 'kling-3-0-turbo', 'kling-3-0-omni', 'kling-4-0', 'kling-2-6', 'kling-2-6-motion', 'kling-2-5-turbo', 'kling-2-1-master', 'kling-2-1-pro', 'kling-2-1-standard', 'kling-avatar-standard', 'kling-avatar-pro', 'seedance-2-0', 'seedance-2-0-mini', 'seedance-1-0-pro', 'seedance-1-0-lite', 'seedance-1-0-pro-fast', 'hailuo-02-standard', 'hailuo-02-pro', 'hailuo-2-3-standard', 'hailuo-2-3-pro', 'minimax-h3', 'wan-2-5', 'wan-2-6-flash', 'wan-2-7', 'wan-2-7-edit', 'wan-3-0', 'wan-3-0-prime', 'pixverse-v6', 'pixverse-v6-extend', 'grok-imagine-video', 'grok-imagine-video-1-5', 'runway-gen-4-turbo', 'runway-gen-4-turbo-extend', 'happyhorse-1-0', 'happyhorse-1-1', 'happyhorse-1-0-edit', 'gemini-omni-video', 'gemini-omni-flash-1-1', 'omnihuman-1-5', 'vidu-q4', 'topaz-video-upscale', 'wan-2-2-animate-move', 'wan-2-2-animate-replace']::text[])
      and m.state = 'disabled' and m.availability_changed_at is null
    order by m.sort_order
  loop
    v_block := app_private.availability_blocker(null, r.id, 'enabled', true);
    if v_block is not null then
      v_blocked := v_blocked || (r.id || ': ' || (v_block ->> 'message'));
      continue;
    end if;
    update app_private.model_catalog
    set state = 'enabled', enable_basis = 'documented_cost', availability_changed_at = now(), updated_at = now()
    where id = r.id;
    perform app_private.audit(null, 'catalog.operate', 'model.availability', 'model', r.id,
      'Turned on ' || r.public_name || ' with the full catalog of 22 Oct 2026 (not tested yet; priced on the documented KIE cost)',
      jsonb_build_object('state', 'disabled'), jsonb_build_object('state', 'enabled', 'enableBasis', 'documented_cost'));
  end loop;
  if cardinality(v_blocked) > 0 then
    raise exception 'catalog models not ready: %', array_to_string(v_blocked, '; ');
  end if;
end;
$$;
