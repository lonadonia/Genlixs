-- Refund, correction or unattributed amount recorded by finance/owner (never changes customer credits).
create or replace function public.admin_record_cost_adjustment(p_account_id uuid, p_kind text, p_native_amount text, p_unit text,
  p_occurred_at timestamptz, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := app_private.require_capability('provider.manage');
  v_amt numeric;
  v_cu app_private.cost_unit_versions := app_private.cost_unit(p_unit);
  v_id uuid;
begin
  if p_kind not in ('refund', 'correction', 'unattributed') then
    perform app_private.fail('INVALID_INPUT', 'Choose refund, correction or unattributed.');
  end if;
  if p_native_amount is null or p_native_amount !~ '^\s*-?\d{1,12}(\.\d{1,10})?\s*$' then
    perform app_private.fail('INVALID_INPUT', 'Enter the amount as a number.');
  end if;
  if v_cu.id is null then
    perform app_private.fail('INVALID_INPUT', 'Unknown unit.');
  end if;
  if p_note is null or char_length(trim(p_note)) < 3 then
    perform app_private.fail('REASON_REQUIRED', 'Describe the adjustment.');
  end if;
  if not exists (select 1 from app_private.provider_accounts where id = p_account_id and provider <> 'fake') then
    perform app_private.fail('NOT_FOUND', 'Provider account not found.');
  end if;
  v_amt := trim(p_native_amount)::numeric;
  insert into app_private.provider_cost_adjustments (provider_account_id, kind, native_amount, native_unit, usd_amount, occurred_at, note, created_by)
  values (p_account_id, p_kind, v_amt, p_unit, round(v_amt / v_cu.units_per_usd, 10), coalesce(p_occurred_at, now()), left(p_note, 500), v_actor)
  returning id into v_id;
  perform app_private.audit(v_actor, 'provider.manage', 'provider.cost_adjustment', 'provider_account', p_account_id::text, left(p_note, 500), null,
    jsonb_build_object('id', v_id, 'kind', p_kind, 'amount', v_amt, 'unit', p_unit));
  return jsonb_build_object('id', v_id);
end;
$$;
revoke execute on function public.admin_record_cost_adjustment(uuid, text, text, text, timestamptz, text) from public, anon;
grant execute on function public.admin_record_cost_adjustment(uuid, text, text, text, timestamptz, text) to authenticated;

-- ================================================================ legacy routes

-- Every public model keeps its original KIE route as an offer that follows the model's own capability and the
-- existing KIE cost versions. A model added later gets its legacy offer automatically.
create or replace function app_private.sync_legacy_offer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  insert into app_private.provider_offers (provider_account_id, model_id, product_key, product_label, tool, operation, upstream_model_id, adapter,
    capabilities, status, decision, decision_reason, decided_at, routing_enabled, is_legacy_primary, source_url, docs_url, verification_note,
    verified_at, sort_order)
  values (new.provider_account_id, new.id, 'genlixs:' || new.id, new.public_name || ' (original route)', new.tool,
    coalesce((app_private.capability_for(new.id)).spec ->> 'operation', case new.tool when 'image' then 'text_to_image' when 'edit' then 'image_edit' else 'create' end),
    new.provider_model_id, case when exists (select 1 from app_private.provider_adapters a where a.adapter = new.adapter) then new.adapter end,
    '{"inherit": true}'::jsonb, 'eligible', 'eligible', 'Original route of this model', now(), true, true,
    new.provider_pricing_url, new.provider_docs_url, 'Original route; verification as recorded in the catalog (' || new.verification_status || ')',
    new.verified_at, 10)
  on conflict (provider_account_id, product_key) do update set
    upstream_model_id = excluded.upstream_model_id,
    adapter = excluded.adapter,
    product_label = excluded.product_label,
    source_url = excluded.source_url,
    docs_url = excluded.docs_url;
  return new;
end;
$$;

-- Fires after the model's capability exists (capability_for reads it); for inserts without one the operation falls back.
create trigger model_catalog_legacy_offer after insert or update of provider_account_id, adapter, provider_model_id, public_name on app_private.model_catalog
  for each row execute function app_private.sync_legacy_offer();

insert into app_private.provider_offers (provider_account_id, model_id, product_key, product_label, tool, operation, upstream_model_id, adapter,
  capabilities, status, decision, decision_reason, decided_at, routing_enabled, is_legacy_primary, source_url, docs_url, verification_note,
  verified_at, sort_order)
select m.provider_account_id, m.id, 'genlixs:' || m.id, m.public_name || ' (original route)', m.tool,
  coalesce((app_private.capability_for(m.id)).spec ->> 'operation', case m.tool when 'image' then 'text_to_image' when 'edit' then 'image_edit' else 'create' end),
  m.provider_model_id, case when exists (select 1 from app_private.provider_adapters a where a.adapter = m.adapter) then m.adapter end,
  '{"inherit": true}'::jsonb, 'eligible', 'eligible', 'Original route of this model', now(), true, true,
  m.provider_pricing_url, m.provider_docs_url, 'Original route; verification as recorded in the catalog (' || m.verification_status || ')',
  m.verified_at, 10
from app_private.model_catalog m
on conflict (provider_account_id, product_key) do nothing;

-- History: every earlier attempt was sent to the model's original KIE route with the environment key.
update app_private.provider_attempts t set offer_id = f.id, credential_version = 0
from public.generation_jobs j, app_private.provider_offers f
where j.id = t.job_id and f.model_id = j.model_id and f.is_legacy_primary and f.provider_account_id = t.provider_account_id and t.offer_id is null;

-- Historical ledger: a charge KIE reported is kept (converted at the documented $0.005); anything else stays unknown.
insert into app_private.provider_cost_ledger (attempt_id, job_id, user_id, purpose, provider_account_id, offer_id, model_id, upstream_model_id,
  options, native_unit, unit_version_id, units_per_usd, funding, estimated_native, estimated_usd, estimated_effective_usd,
  confirmed_native, confirmed_usd, confirmed_effective_usd, state, source, confirmation_source, note, created_at, confirmed_at)
select t.id, j.id, j.user_id, j.purpose, t.provider_account_id, t.offer_id, j.model_id, f.upstream_model_id, j.options, 'kie_credit', u.id, u.units_per_usd,
  jsonb_build_object('feeBps', 0, 'bonusBps', 0, 'version', 0, 'note', 'historical: funding terms not recorded'),
  null, null, null,
  o.credits_consumed, round(o.credits_consumed / u.units_per_usd, 10), round(o.credits_consumed / u.units_per_usd, 10),
  case when o.credits_consumed is not null then 'confirmed' when t.state in ('rejected', 'rate_limited') then 'not_charged' else 'unknown_historical' end,
  'backfill', case when o.credits_consumed is not null then 'task_report' end,
  case when o.credits_consumed is null and t.state not in ('rejected', 'rate_limited') then 'Recorded before cost tracking; the charge was not reported.' end,
  t.submitted_at, case when o.credits_consumed is not null then o.observed_at end
from app_private.provider_attempts t
join public.generation_jobs j on j.id = t.job_id
left join app_private.provider_offers f on f.id = t.offer_id
cross join lateral (select * from app_private.cost_unit('kie_credit')) u
left join lateral (select x.credits_consumed, x.observed_at from app_private.provider_observations x
                   where x.attempt_id = t.id and x.credits_consumed is not null order by x.observed_at desc limit 1) o on true
on conflict (attempt_id) do nothing;

-- ============================================================ research inventory

-- Offers and prices from the providers' public pages (checked 18 Oct 2026). Discovery is not activation: none of these
-- is routed until the owner adds the key, verifies the offer with a test and switches routing on.
create or replace function app_private.seed_offer(
  p_provider text, p_model text, p_key text, p_label text, p_tool text, p_operation text, p_upstream text, p_adapter text,
  p_caps jsonb, p_status text, p_blocker text, p_source text, p_docs text,
  p_unit text, p_schedule jsonb, p_confidence text, p_assumptions text
) returns void
language plpgsql
set search_path = ''
as $$
declare
  v_offer uuid;
begin
  insert into app_private.provider_offers (provider_account_id, model_id, product_key, product_label, tool, operation, upstream_model_id, adapter,
    capabilities, status, decision, blocker, source_url, docs_url, sort_order)
  select a.id, p_model, p_key, p_label, p_tool, p_operation, p_upstream, p_adapter, coalesce(p_caps, '{}'::jsonb), p_status, 'unresolved', p_blocker,
    p_source, p_docs, 100
  from app_private.provider_accounts a where a.provider = p_provider and a.label = 'primary'
  on conflict (provider_account_id, product_key) do nothing
  returning id into v_offer;
  if v_offer is not null and p_schedule is not null then
    insert into app_private.provider_offer_prices (offer_id, version, unit, schedule, confidence, source_kind, source_url, checked_at, assumptions)
    values (v_offer, 1, p_unit, p_schedule, p_confidence, 'research', p_source, '2026-10-18', p_assumptions);
  end if;
end;
$$;

-- ---------------------------------------------------- offers for public Genlixs models

-- Kling 3.0 Motion Control
select app_private.seed_offer('poyo', 'kling-3-0-motion', 'kling-3.0-motion-control', 'Kling 3.0 Motion Control', 'video', 'motion',
  'kling-3.0-motion-control', 'poyo-kling-motion',
  '{"options": {"mode": ["720p", "1080p"], "orientation": ["video", "image"], "seconds": {"min": 3, "max": 30}}, "modes": ["motion"],
    "inputs": {"motion_video": {"max": 1, "maxTotalSeconds": 30}, "character_image": {"max": 1}}, "maxPromptChars": 2500,
    "notes": ["Image up to 10 MB, video up to 100 MB (Genlixs limits are lower)", "Facial elements are not sent"]}',
  'capabilities_unverified', 'Needs an API key and one verified test (billed seconds, orientation limits, output) before routing.',
  'https://poyo.ai/models/kling-3-0-motion-control', 'https://poyo.ai/models/kling-3-0-motion-control/llms.txt',
  'poyo_credit', '{"basis": "output_second", "dims": ["mode"], "rates": {"720p": 9, "1080p": 15}, "seconds": {"option": "seconds"}}', 'documented',
  'Per second of the motion video (the output follows its length). Confirm the billed seconds on the first test.');
select app_private.seed_offer('duomi', 'kling-3-0-motion', 'kling-3.0-motion-control', 'Kling 3.0 Motion Control', 'video', 'motion',
  null, null, '{}', 'pricing_unverified', 'No integration in this release (Duomi Kling official-format motion control).',
  'https://duomiapi.com/doc/104', 'https://duomiapi.com/doc/104',
  'cny', '{"basis": "output_second", "dims": ["mode"], "rates": {"720p": "0.72", "1080p": "0.96"}, "seconds": {"option": "seconds"}}', 'documented',
  'CNY per second from the Duomi price page; reference-video length used for billing not confirmed.');

-- Nano Banana Pro (text to image and edit)
select app_private.seed_offer('nezhagate', 'nano-banana-pro-image', 'nano-banana-pro', 'Nano Banana Pro', 'image', 'text_to_image',
  'nano-banana-pro', 'nezhagate-image',
  '{"options": {"resolution": ["1K", "2K", "4K"], "aspect_ratio": ["1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "16:9", "9:16", "21:9"]},
    "notes": ["Renders natively at the listed ratios", "One image per job"]}',
  'capabilities_unverified', 'Needs an API key and a verified test (native size and quality) before routing.',
  'https://nezhagate.com/en/docs/nano-banana-pro', 'https://nezhagate.com/en/docs/nano-banana-pro',
  'usd', '{"basis": "output", "dims": ["resolution"], "rates": {"1K": "0.02", "2K": "0.03", "4K": "0.05"}}', 'documented',
  'Billed per image by tier; failed jobs refunded in full.');
select app_private.seed_offer('nezhagate', 'nano-banana-pro-edit', 'nano-banana-pro/edit', 'Nano Banana Pro edit', 'edit', 'image_edit',
  'nano-banana-pro', 'nezhagate-image',
  '{"options": {"resolution": ["1K", "2K", "4K"], "aspect_ratio": ["1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "16:9", "9:16", "21:9"]},
    "inputs": {"_references": {"max": 8}}, "notes": ["No automatic aspect ratio", "Up to 8 reference images"]}',
  'capabilities_unverified', 'Needs an API key and a verified test (identity preservation, size) before routing.',
  'https://nezhagate.com/en/docs/nano-banana-pro', 'https://nezhagate.com/en/docs/nano-banana-pro',
  'usd', '{"basis": "output", "dims": ["resolution"], "rates": {"1K": "0.02", "2K": "0.03", "4K": "0.05"}}', 'documented',
  'Same tier price for text-to-image and image-to-image.');
select app_private.seed_offer('duomi', 'nano-banana-pro-image', 'nano-banana-pro', 'Nano Banana Pro', 'image', 'text_to_image',
  'gemini-3-pro-image-preview', 'duomi-nano-banana',
  '{"options": {"resolution": ["1K", "2K", "4K"], "aspect_ratio": ["1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "16:9", "9:16", "21:9"]}}',
  'capabilities_unverified', 'Needs an API key and a verified test; channel identity and native output not confirmed.',
  'https://duomiapi.com/doc/85', 'https://s.apifox.cn/b924931e-29c0-4127-b025-d68c90285060/api-346130262.md',
  'cny', '{"basis": "output", "dims": ["resolution"], "rates": {"1K": "0.15", "2K": "0.15", "4K": "0.15"}}', 'documented',
  'CNY per image at any listed size (Duomi price table); USD follows the configured CNY rate.');
select app_private.seed_offer('duomi', 'nano-banana-pro-edit', 'nano-banana-pro/edit', 'Nano Banana Pro edit', 'edit', 'image_edit',
  'gemini-3-pro-image-preview', 'duomi-nano-banana',
  '{"options": {"resolution": ["1K", "2K", "4K"], "aspect_ratio": ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "16:9", "9:16", "21:9"]},
    "inputs": {"_references": {"max": 8}}}',
  'capabilities_unverified', 'Needs an API key and a verified test; maximum reference count not documented (8 assumed).',
  'https://duomiapi.com/doc/86', 'https://s.apifox.cn/b924931e-29c0-4127-b025-d68c90285060/api-346293340.md',
  'cny', '{"basis": "output", "dims": ["resolution"], "rates": {"1K": "0.15", "2K": "0.15", "4K": "0.15"}}', 'documented',
  'Same price as text-to-image on the Duomi page.');
select app_private.seed_offer('poyo', 'nano-banana-pro-image', 'nano-banana-pro', 'Nano Banana Pro', 'image', 'text_to_image',
  null, null, '{}', 'pricing_unverified', 'No PoYo image integration in this release; NezhaGate and Duomi quotes are lower.',
  'https://poyo.ai/pricing', null,
  'usd', '{"basis": "output", "dims": ["resolution"], "rates": {"1K": "0.04", "2K": "0.04", "4K": "0.07"}}', 'documented', null);

-- Nano Banana 2
select app_private.seed_offer('duomi', 'nano-banana-2-image', 'nano-banana-2', 'Nano Banana 2', 'image', 'text_to_image',
  'gemini-3.1-flash-image-preview', 'duomi-nano-banana',
  '{"options": {"resolution": ["1K", "2K", "4K"], "aspect_ratio": ["1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "16:9", "9:16", "21:9"]}}',
  'capabilities_unverified', 'Needs an API key and a verified test; channel identity and native output not confirmed.',
  'https://duomiapi.com/doc/85', 'https://s.apifox.cn/b924931e-29c0-4127-b025-d68c90285060/api-346130262.md',
  'cny', '{"basis": "output", "dims": ["resolution"], "rates": {"1K": "0.10", "2K": "0.10", "4K": "0.10"}}', 'documented', null);
select app_private.seed_offer('poyo', 'nano-banana-2-image', 'nano-banana-2', 'Nano Banana 2', 'image', 'text_to_image',
  null, null, '{}', 'pricing_unverified', 'No PoYo image integration in this release.', 'https://poyo.ai/pricing', null,
  'usd', '{"basis": "output", "dims": ["resolution"], "rates": {"1K": "0.025", "2K": "0.04", "4K": "0.06"}}', 'documented', null);

-- GPT Image 2.5 Flare / Sunburst
select app_private.seed_offer('nezhagate', 'gpt-flare-image', 'gpt-image-2.5-flare', 'GPT Image 2.5 Flare', 'image', 'text_to_image',
  'gpt-image-2.5-flare', 'nezhagate-image',
  '{"options": {"resolution": ["1K", "2K", "4K"], "aspect_ratio": ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9"]},
    "notes": ["At 1K the picture is composed at the closest shape and centre-cropped to the ratio", "Results are PNG"]}',
  'capabilities_unverified', 'Provider announced a Flare/Sunburst 2K service disruption on 18 Oct 2026; 1K output is resized from the native frame. Verify before routing.',
  'https://nezhagate.com/en/docs/gpt-image-2.5-flare', 'https://nezhagate.com/en/docs/gpt-image-2.5-flare',
  'usd', '{"basis": "output", "dims": ["resolution"], "rates": {"1K": "0.005", "2K": "0.025", "4K": "0.04"}}', 'documented', null);
select app_private.seed_offer('nezhagate', 'gpt-flare-edit', 'gpt-image-2.5-flare/edit', 'GPT Image 2.5 Flare edit', 'edit', 'image_edit',
  'gpt-image-2.5-flare', 'nezhagate-image',
  '{"options": {"resolution": ["1K", "2K", "4K"], "aspect_ratio": ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"]},
    "inputs": {"_references": {"max": 8}}, "notes": ["Up to 8 references (the model accepts 16 on the original route)", "No automatic aspect ratio"]}',
  'capabilities_unverified', 'Provider announced a Flare/Sunburst 2K service disruption on 18 Oct 2026. Verify before routing.',
  'https://nezhagate.com/en/docs/gpt-image-2.5-flare', 'https://nezhagate.com/en/docs/gpt-image-2.5-flare',
  'usd', '{"basis": "output", "dims": ["resolution"], "rates": {"1K": "0.005", "2K": "0.025", "4K": "0.04"}}', 'documented', null);
select app_private.seed_offer('nezhagate', 'gpt-sunburst-image', 'gpt-image-2.5-sunburst', 'GPT Image 2.5 Sunburst', 'image', 'text_to_image',
  'gpt-image-2.5-sunburst', 'nezhagate-image',
  '{"options": {"resolution": ["1K"], "aspect_ratio": ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9"]}}',
  'capabilities_unverified', 'Only the 1K price is documented; a 2K price change was announced on 18 Oct 2026. The Sunburst rate is described as temporary.',
  'https://nezhagate.com/en/docs-guide', 'https://nezhagate.com/en/docs-guide',
  'usd', '{"basis": "output", "dims": ["resolution"], "rates": {"1K": "0.005"}}', 'documented', 'Temporary rate per the provider catalog.');
select app_private.seed_offer('nezhagate', 'gpt-sunburst-edit', 'gpt-image-2.5-sunburst/edit', 'GPT Image 2.5 Sunburst edit', 'edit', 'image_edit',
  'gpt-image-2.5-sunburst', 'nezhagate-image',
  '{"options": {"resolution": ["1K"], "aspect_ratio": ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"]}, "inputs": {"_references": {"max": 8}}}',
  'capabilities_unverified', 'Only the 1K price is documented; a 2K price change was announced on 18 Oct 2026.',
  'https://nezhagate.com/en/docs-guide', 'https://nezhagate.com/en/docs-guide',
  'usd', '{"basis": "output", "dims": ["resolution"], "rates": {"1K": "0.005"}}', 'documented', 'Temporary rate per the provider catalog.');
select app_private.seed_offer('duomi', 'gpt-flare-image', 'gpt-image-2.5-flare', 'GPT Image 2.5 Flare', 'image', 'text_to_image',
  null, null, '{}', 'pricing_unverified', 'No integration in this release; Duomi''s channel notice raises size-reliability concerns.',
  'https://duomiapi.com/doc/55', 'https://duomiapi.com/blog/top/196.html',
  'cny', '{"basis": "output", "dims": ["resolution"], "rates": {"1K": "0.06"}}', 'unverified', 'Quality mapping to the original route not established.');

-- Seedream 5.0 Flash (text to image and edit)
select app_private.seed_offer('apimart', 'seedream-5-flash-image', 'seedream-5-0-flash', 'Seedream 5.0 Flash', 'image', 'text_to_image',
  'seedream-5-0-flash', 'apimart-image',
  '{"options": {"resolution": ["1K", "1.5K", "2K"], "aspect_ratio": ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9"]}}',
  'capabilities_unverified', 'Needs an API key and a verified test before routing.',
  'https://apimart.ai/model/seedream-5-0-flash', 'https://docs.apimart.ai/en/api-reference/images/seedream-5-0-flash/generation',
  'apimart_credit', '{"basis": "output", "dims": ["resolution"], "rates": {"1K": "0.1371", "1.5K": "0.1371", "2K": "0.1371"}}', 'documented',
  'Gold-tier price $0.01371 per image at 1K/1.5K/2K.');
select app_private.seed_offer('apimart', 'seedream-5-flash-edit', 'seedream-5-0-flash/edit', 'Seedream 5.0 Flash edit', 'edit', 'image_edit',
  'seedream-5-0-flash', 'apimart-image',
  '{"options": {"resolution": ["1K", "1.5K", "2K"], "aspect_ratio": ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9"]},
    "inputs": {"_references": {"max": 10}}}',
  'capabilities_unverified', 'Each reference image after the first has an undocumented surcharge: only one-image edits have a known cost.',
  'https://apimart.ai/model/seedream-5-0-flash', 'https://docs.apimart.ai/en/api-reference/images/seedream-5-0-flash/generation',
  'apimart_credit', '{"basis": "output", "dims": ["resolution"], "rates": {"1K": "0.1371", "1.5K": "0.1371", "2K": "0.1371"},
    "extraImages": {"slots": ["_references"], "free": 1, "rate": null}}', 'documented',
  'First reference free; the surcharge for additional references is not published, so those requests have no known cost.');
select app_private.seed_offer('poyo', 'seedream-5-flash-image', 'seedream-5.0-flash', 'Seedream 5.0 Flash', 'image', 'text_to_image',
  null, null, '{}', 'pricing_unverified', 'No PoYo image integration in this release.', 'https://poyo.ai/models/seedream-5-0-flash', null,
  'poyo_credit', '{"basis": "output", "dims": ["resolution"], "rates": {"1K": 4, "1.5K": 4, "2K": 4}}', 'documented', null);

-- Seedance 2.0 Fast
select app_private.seed_offer('nezhagate', 'seedance-2-fast', 'seedance-2.0-fast', 'Seedance 2.0 Fast', 'video', 'text_to_video',
  'seedance-2.0-fast', 'nezhagate-video',
  '{"options": {"audio": ["on"], "duration": [5, 10], "resolution": ["720p"], "aspect_ratio": ["16:9", "9:16", "1:1", "4:3", "3:4"]},
    "modes": ["text", "reference"], "inputs": {"reference_images": {"max": 9}, "reference_audio": {"max": 3, "maxTotalSeconds": 45}},
    "maxPromptChars": 1600, "notes": ["720P only", "Sound is always on", "Reference images are never used as frames", "Prompt limit 5,000 bytes"]}',
  'capabilities_unverified', 'Needs an API key and a verified test. No first/last-frame mode; audio cannot be switched off.',
  'https://nezhagate.com/en/docs/seedance-2.0-fast', 'https://nezhagate.com/en/docs/seedance-2.0-fast',
  'usd', '{"basis": "output_second", "dims": ["resolution"], "rates": {"720p": "0.075"}, "seconds": {"option": "duration"}}', 'documented',
  'Rate × ordered seconds; held at submit, refunded in full on failure.');
select app_private.seed_offer('apimart', 'seedance-2-fast', 'seedance-2.0-fast', 'Seedance 2.0 Fast', 'video', 'text_to_video',
  'seedance-2.0-fast', 'apimart-video',
  '{"options": {"audio": ["on", "off"], "duration": [5, 10], "resolution": ["480p", "720p"], "aspect_ratio": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"]},
    "modes": ["text", "frames", "reference"], "inputs": {"first_frame": {"max": 1}, "last_frame": {"max": 1}, "reference_images": {"max": 9},
    "reference_audio": {"max": 3, "maxTotalSeconds": 15}}, "notes": ["Frames and reference audio cannot be combined"]}',
  'capabilities_unverified', 'Needs an API key and a verified test; whether sound changes the price is not documented.',
  'https://apimart.ai/model/doubao-seedance-2-0-fast', 'https://docs.apimart.ai/en/api-reference/videos/seedance-2-0/generation',
  'apimart_credit', '{"basis": "output_second", "dims": ["resolution"], "rates": {"480p": "0.3984", "720p": "0.856"}, "seconds": {"option": "duration"}}', 'documented',
  'Gold-tier price without input video ($0.03984 / $0.0856 per second); sound assumed not to change it.');

