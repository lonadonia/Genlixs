-- Genlixs 12 · Curated image/video catalog (data). Sources re-checked on 14 Oct 2026 against docs.kie.ai (request
-- schemas) and kie.ai/pricing (per-configuration credits; 1 KIE credit = USD 0.005 at the standard rate).
-- Every new entry starts DISABLED with NO price; the owner tests, prices and enables deliberately. Existing ids are
-- kept; their display aliases are corrected to the confirmed underlying model (KIE: "GPT Image 2.5 Flare").
-- Provider model ids appear here only as catalog data (documented exception to the no-model-id rule).

-- ------------------------------------------------- existing entries

update app_private.model_catalog set
  public_name = 'GPT Image 2.5 Flare', family = 'GPT Image 2.5', variant_label = 'Flare', badges = '{fast}',
  purpose = 'OpenAI''s speed-oriented image model for drafts, posters and social images, including legible text.',
  provider_docs_url = 'https://docs.kie.ai/market/gpt/gpt-image-2-5-flare-text-to-image',
  provider_pricing_url = 'https://kie.ai/gpt-image-2-5', source_checked_at = '2026-10-14T09:00:00Z', sort_order = 10
where id = 'gpt-flare-image';

update app_private.model_catalog set
  public_name = 'GPT Image 2.5 Flare Edit', family = 'GPT Image 2.5', variant_label = 'Flare', badges = '{fast}',
  purpose = 'Fast reference edits: change a scene, style or detail from one image and a written instruction.',
  provider_docs_url = 'https://docs.kie.ai/market/gpt/gpt-image-2-5-flare-image-to-image',
  provider_pricing_url = 'https://kie.ai/gpt-image-2-5', source_checked_at = '2026-10-14T09:00:00Z', sort_order = 20
where id = 'gpt-flare-edit';

-- The old "Veo 3.1" entry offered three tiers with very different costs in one selector. It becomes the Fast tier
-- (new capability version); Lite and Quality are separate entries so each can be tested, priced and enabled alone.
update app_private.model_catalog set
  public_name = 'Veo 3.1 Fast', family = 'Veo 3.1', variant_label = 'Fast', badges = '{recommended}',
  purpose = 'Google''s balanced video tier: 4–8 s clips with generated sound, from 720p to 4K.',
  provider_docs_url = 'https://docs.kie.ai/veo3-api/generate-veo-3-video',
  provider_pricing_url = 'https://kie.ai/veo-3-1', source_checked_at = '2026-10-14T09:00:00Z', sort_order = 30
where id = 'veo-3-1';

-- ------------------------------------------------------- new entries

insert into app_private.model_catalog (id, tool, public_name, family, variant_label, badges, purpose, provider_account_id,
  provider_model_id, adapter, sort_order, provider_docs_url, provider_pricing_url, source_checked_at)
select v.id, v.tool, v.public_name, v.family, v.variant_label, v.badges::text[], v.purpose,
  (select id from app_private.provider_accounts where provider = 'kie' and label = 'primary'),
  v.provider_model_id, v.adapter, v.sort_order, v.docs, v.pricing, '2026-10-14T09:00:00Z'
from (values
  ('gpt-sunburst-image', 'image', 'GPT Image 2.5 Sunburst', 'GPT Image 2.5', 'Sunburst', '{recommended,premium}',
   'OpenAI''s quality-optimised image model: finer detail and closer instruction following than Flare, at the same supplier cost.',
   'gpt-image-2-5-sunburst-text-to-image', 'kie-market-image', 11,
   'https://docs.kie.ai/market/gpt/gpt-image-2-5-sunburst-text-to-image', 'https://kie.ai/gpt-image-2-5'),
  ('nano-banana-pro-image', 'image', 'Nano Banana Pro', 'Nano Banana', 'Pro', '{premium}',
   'Google''s high-fidelity image model, strong at legible text, infographics and complex scenes.',
   'nano-banana-pro', 'kie-nano-banana', 12,
   'https://docs.kie.ai/market/google/pro-image-to-image', 'https://kie.ai/nano-banana-pro'),
  ('nano-banana-2-image', 'image', 'Nano Banana 2', 'Nano Banana', '2', '{}',
   'Google''s fast general-purpose image model with a wide choice of aspect ratios.',
   'nano-banana-2', 'kie-nano-banana', 13,
   'https://docs.kie.ai/market/google/nanobanana2', 'https://kie.ai/nano-banana-2'),
  ('flux-2-pro-image', 'image', 'FLUX.2 Pro', 'FLUX.2', 'Pro', '{budget}',
   'Black Forest Labs'' photorealistic model at a low per-image cost (1K or 2K).',
   'flux-2/pro-text-to-image', 'kie-flux-2', 14,
   'https://docs.kie.ai/market/flux2/pro-text-to-image', 'https://kie.ai/flux-2'),
  ('seedream-5-flash-image', 'image', 'Seedream 5.0 Flash', 'Seedream 5.0', 'Flash', '{budget,fast}',
   'ByteDance''s quickest, lowest-cost image model for drafts and variations.',
   'seedream/5-flash-text-to-image', 'kie-seedream-5', 15,
   'https://docs.kie.ai/market/seedream/5-flash-text-to-image', 'https://kie.ai/seedream-5-0-flash'),
  ('gpt-sunburst-edit', 'edit', 'GPT Image 2.5 Sunburst Edit', 'GPT Image 2.5', 'Sunburst', '{recommended,premium}',
   'Quality-first reference edits with stronger subject fidelity across changes.',
   'gpt-image-2-5-sunburst-image-to-image', 'kie-market-image-edit', 21,
   'https://docs.kie.ai/market/gpt/gpt-image-2-5-sunburst-image-to-image', 'https://kie.ai/gpt-image-2-5'),
  ('nano-banana-pro-edit', 'edit', 'Nano Banana Pro Edit', 'Nano Banana', 'Pro', '{premium}',
   'Keeps a subject consistent while changing its setting, style or on-image text.',
   'nano-banana-pro', 'kie-nano-banana', 22,
   'https://docs.kie.ai/market/google/pro-image-to-image', 'https://kie.ai/nano-banana-pro'),
  ('flux-2-pro-edit', 'edit', 'FLUX.2 Pro Edit', 'FLUX.2', 'Pro', '{budget}',
   'Low-cost photorealistic edits guided by a reference image.',
   'flux-2/pro-image-to-image', 'kie-flux-2', 23,
   'https://docs.kie.ai/market/flux2/pro-image-to-image', 'https://kie.ai/flux-2'),
  ('seedream-5-flash-edit', 'edit', 'Seedream 5.0 Flash Edit', 'Seedream 5.0', 'Flash', '{budget,fast}',
   'The lowest-cost reference edits for quick iterations.',
   'seedream/5-flash-image-to-image', 'kie-seedream-5', 24,
   'https://docs.kie.ai/market/seedream/5-flash-image-to-image', 'https://kie.ai/seedream-5-0-flash'),
  ('veo-3-1-lite', 'video', 'Veo 3.1 Lite', 'Veo 3.1', 'Lite', '{budget}',
   'Google''s lowest-cost video tier for high-volume drafts, with generated sound.',
   'veo-3-1', 'kie-market-veo', 31,
   'https://docs.kie.ai/veo3-api/generate-veo-3-video', 'https://kie.ai/veo-3-1'),
  ('veo-3-1-quality', 'video', 'Veo 3.1 Quality', 'Veo 3.1', 'Quality', '{premium}',
   'Google''s flagship video tier for the highest fidelity, with generated sound.',
   'veo-3-1', 'kie-market-veo', 32,
   'https://docs.kie.ai/veo3-api/generate-veo-3-video', 'https://kie.ai/veo-3-1'),
  ('kling-3-0', 'video', 'Kling 3.0', 'Kling 3.0', null, '{}',
   'Single-shot clips of 5–15 s with optional native audio, from 720p to 4K.',
   'kling-3.0/video', 'kie-kling-3', 33,
   'https://docs.kie.ai/market/kling/kling-3-0', 'https://kie.ai/kling-3-0'),
  ('seedance-2-5', 'video', 'Seedance 2.5', 'Seedance', '2.5', '{premium}',
   'ByteDance''s premium video model with synchronised audio, up to 1080p.',
   'bytedance/seedance-2-5', 'kie-seedance-2', 34,
   'https://docs.kie.ai/market/bytedance/seedance-2-5', 'https://kie.ai/seedance-2-5'),
  ('seedance-2-fast', 'video', 'Seedance 2.0 Fast', 'Seedance', '2.0 Fast', '{fast}',
   'A faster, lower-cost Seedance option for 480p–720p clips with audio.',
   'bytedance/seedance-2-fast', 'kie-seedance-2', 35,
   'https://docs.kie.ai/market/bytedance/seedance-2-fast', 'https://kie.ai/seedance-2-0'),
  ('wan-2-6', 'video', 'Wan 2.6', 'Wan', '2.6', '{long}',
   'Longer text-to-video clips of 5, 10 or 15 s at 720p or 1080p.',
   'wan/2-6-text-to-video', 'kie-wan-2-6', 36,
   'https://docs.kie.ai/market/wan/2-6-text-to-video', 'https://kie.ai/wan-2-6')
) as v(id, tool, public_name, family, variant_label, badges, purpose, provider_model_id, adapter, sort_order, docs, pricing);

-- ------------------------------------------------ capability versions

-- Only documented options are offered; product caps (prompt length, one reference image) are noted per spec.
insert into app_private.model_capability_versions (model_id, version, spec) values
  ('gpt-sunburst-image', 1, (select spec from app_private.model_capability_versions where model_id = 'gpt-flare-image' and version = 1)),
  ('gpt-sunburst-edit', 1, (select spec from app_private.model_capability_versions where model_id = 'gpt-flare-edit' and version = 1)),
  -- nano-banana-pro: aspect enum documented without the extreme ratios; resolution 1K/2K/4K; output_format sent as png.
  ('nano-banana-pro-image', 1, '{
    "jobKind": "text_to_image",
    "prompt": {"min": 3, "max": 4000},
    "options": {
      "aspect_ratio": {"values": ["1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "16:9", "9:16", "21:9"], "default": "1:1", "label": "Aspect ratio"},
      "resolution": {"values": ["1K", "2K", "4K"], "default": "1K", "label": "Resolution"}
    },
    "references": {"min": 0, "max": 0},
    "output": {"kind": "image", "count": 1, "mime": ["image/png", "image/jpeg", "image/webp"], "maxBytes": 52428800}
  }'::jsonb),
  ('nano-banana-2-image', 1, '{
    "jobKind": "text_to_image",
    "prompt": {"min": 3, "max": 4000},
    "options": {
      "aspect_ratio": {"values": ["1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "16:9", "9:16", "21:9"], "default": "1:1", "label": "Aspect ratio"},
      "resolution": {"values": ["1K", "2K", "4K"], "default": "1K", "label": "Resolution"}
    },
    "references": {"min": 0, "max": 0},
    "output": {"kind": "image", "count": 1, "mime": ["image/png", "image/jpeg", "image/webp"], "maxBytes": 52428800}
  }'::jsonb),
  -- flux-2 pro: prompt 3–5000 (product cap 4000), aspect and resolution required (1K/2K only).
  ('flux-2-pro-image', 1, '{
    "jobKind": "text_to_image",
    "prompt": {"min": 3, "max": 4000},
    "options": {
      "aspect_ratio": {"values": ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"], "default": "1:1", "label": "Aspect ratio"},
      "resolution": {"values": ["1K", "2K"], "default": "1K", "label": "Resolution"}
    },
    "references": {"min": 0, "max": 0},
    "output": {"kind": "image", "count": 1, "mime": ["image/png", "image/jpeg", "image/webp"], "maxBytes": 52428800}
  }'::jsonb),
  -- seedream 5 flash: prompt 4–5000, aspect required, size 1K/1.5K/2K (exposed as "resolution").
  ('seedream-5-flash-image', 1, '{
    "jobKind": "text_to_image",
    "prompt": {"min": 4, "max": 4000},
    "options": {
      "aspect_ratio": {"values": ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9"], "default": "1:1", "label": "Aspect ratio"},
      "resolution": {"values": ["1K", "1.5K", "2K"], "default": "1K", "label": "Resolution"}
    },
    "references": {"min": 0, "max": 0},
    "output": {"kind": "image", "count": 1, "mime": ["image/png", "image/jpeg", "image/webp"], "maxBytes": 52428800}
  }'::jsonb),
  -- image_input accepts up to 8 images (30 MB each); the product offers one reference at launch.
  ('nano-banana-pro-edit', 1, '{
    "jobKind": "image_edit",
    "prompt": {"min": 3, "max": 4000},
    "options": {
      "aspect_ratio": {"values": ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "4:5", "5:4", "16:9", "9:16", "21:9"], "default": "auto", "label": "Aspect ratio"},
      "resolution": {"values": ["1K", "2K", "4K"], "default": "1K", "label": "Resolution"}
    },
    "references": {"min": 1, "max": 1, "mime": ["image/png", "image/jpeg", "image/webp"], "maxBytes": 10485760},
    "output": {"kind": "image", "count": 1, "mime": ["image/png", "image/jpeg", "image/webp"], "maxBytes": 52428800}
  }'::jsonb),
  -- input_urls 1–8 images (10 MB each); "auto" follows the first input image.
  ('flux-2-pro-edit', 1, '{
    "jobKind": "image_edit",
    "prompt": {"min": 3, "max": 4000},
    "options": {
      "aspect_ratio": {"values": ["auto", "1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16"], "default": "auto", "label": "Aspect ratio"},
      "resolution": {"values": ["1K", "2K"], "default": "1K", "label": "Resolution"}
    },
    "references": {"min": 1, "max": 1, "mime": ["image/png", "image/jpeg", "image/webp"], "maxBytes": 10485760},
    "output": {"kind": "image", "count": 1, "mime": ["image/png", "image/jpeg", "image/webp"], "maxBytes": 52428800}
  }'::jsonb),
  ('seedream-5-flash-edit', 1, '{
    "jobKind": "image_edit",
    "prompt": {"min": 4, "max": 4000},
    "options": {
      "aspect_ratio": {"values": ["1:1", "3:2", "2:3", "4:3", "3:4", "16:9", "9:16", "21:9"], "default": "1:1", "label": "Aspect ratio"},
      "resolution": {"values": ["1K", "1.5K", "2K"], "default": "1K", "label": "Resolution"}
    },
    "references": {"min": 1, "max": 1, "mime": ["image/png", "image/jpeg", "image/webp"], "maxBytes": 10485760},
    "output": {"kind": "image", "count": 1, "mime": ["image/png", "image/jpeg", "image/webp"], "maxBytes": 52428800}
  }'::jsonb),
  -- Veo 3.1 (jobs/createTask, model veo-3-1, input.model selects the tier). One tier per entry. Resolution at
  -- generation time: 1080p/4K are billed as the 720p price plus KIE's upgrade price, once; 4K adds ~5–10 minutes.
  ('veo-3-1', 2, '{
    "jobKind": "text_to_video",
    "prompt": {"min": 3, "max": 2000},
    "options": {
      "variant": {"values": ["veo3_fast"], "default": "veo3_fast", "label": "Tier", "labels": {"veo3_fast": "Fast"}},
      "aspect_ratio": {"values": ["16:9", "9:16"], "default": "16:9", "label": "Aspect ratio"},
      "resolution": {"values": ["720p", "1080p", "4k"], "default": "720p", "label": "Resolution", "labels": {"4k": "4K"}},
      "duration": {"values": [4, 6, 8], "default": 8, "label": "Length (seconds)"}
    },
    "fixed": {"audio": "Background audio is generated by the model and is not guaranteed for every prompt.", "time": "4K takes about 5–10 minutes longer."},
    "references": {"min": 0, "max": 0},
    "output": {"kind": "video", "count": 1, "mime": ["video/mp4"], "maxBytes": 314572800}
  }'::jsonb),
  ('veo-3-1-lite', 1, '{
    "jobKind": "text_to_video",
    "prompt": {"min": 3, "max": 2000},
    "options": {
      "variant": {"values": ["veo3_lite"], "default": "veo3_lite", "label": "Tier", "labels": {"veo3_lite": "Lite"}},
      "aspect_ratio": {"values": ["16:9", "9:16"], "default": "16:9", "label": "Aspect ratio"},
      "resolution": {"values": ["720p", "1080p", "4k"], "default": "720p", "label": "Resolution", "labels": {"4k": "4K"}},
      "duration": {"values": [4, 6, 8], "default": 8, "label": "Length (seconds)"}
    },
    "fixed": {"audio": "Background audio is generated by the model and is not guaranteed for every prompt.", "time": "4K takes about 5–10 minutes longer."},
    "references": {"min": 0, "max": 0},
    "output": {"kind": "video", "count": 1, "mime": ["video/mp4"], "maxBytes": 314572800}
  }'::jsonb),
  ('veo-3-1-quality', 1, '{
    "jobKind": "text_to_video",
    "prompt": {"min": 3, "max": 2000},
    "options": {
      "variant": {"values": ["veo3"], "default": "veo3", "label": "Tier", "labels": {"veo3": "Quality"}},
      "aspect_ratio": {"values": ["16:9", "9:16"], "default": "16:9", "label": "Aspect ratio"},
      "resolution": {"values": ["720p", "1080p", "4k"], "default": "720p", "label": "Resolution", "labels": {"4k": "4K"}},
      "duration": {"values": [4, 6, 8], "default": 8, "label": "Length (seconds)"}
    },
    "fixed": {"audio": "Background audio is generated by the model and is not guaranteed for every prompt.", "time": "4K takes about 5–10 minutes longer."},
    "references": {"min": 0, "max": 0},
    "output": {"kind": "video", "count": 1, "mime": ["video/mp4"], "maxBytes": 314572800}
  }'::jsonb),
  -- Kling 3.0 single-shot: mode std (720p) / pro (1080p) / 4K, sound on/off, duration 3–15 s (offered: 5/10/15),
  -- aspect 16:9 / 9:16 / 1:1, prompt up to 2500.
  ('kling-3-0', 1, '{
    "jobKind": "text_to_video",
    "prompt": {"min": 3, "max": 2500},
    "options": {
      "resolution": {"values": ["720p", "1080p", "4K"], "default": "720p", "label": "Resolution"},
      "audio": {"values": ["on", "off"], "default": "on", "label": "Sound", "labels": {"on": "With audio", "off": "No audio"}},
      "duration": {"values": [5, 10, 15], "default": 5, "label": "Length (seconds)"},
      "aspect_ratio": {"values": ["16:9", "9:16", "1:1"], "default": "16:9", "label": "Aspect ratio"}
    },
    "references": {"min": 0, "max": 0},
    "output": {"kind": "video", "count": 1, "mime": ["video/mp4"], "maxBytes": 314572800}
  }'::jsonb),
  -- Seedance 2.5: resolution 480p/720p/1080p, generate_audio, duration 4–30 s (offered: 5/10), aspect enum (adaptive omitted).
  ('seedance-2-5', 1, '{
    "jobKind": "text_to_video",
    "prompt": {"min": 3, "max": 4000},
    "options": {
      "resolution": {"values": ["480p", "720p", "1080p"], "default": "720p", "label": "Resolution"},
      "audio": {"values": ["on", "off"], "default": "on", "label": "Sound", "labels": {"on": "With audio", "off": "No audio"}},
      "duration": {"values": [5, 10], "default": 5, "label": "Length (seconds)"},
      "aspect_ratio": {"values": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], "default": "16:9", "label": "Aspect ratio"}
    },
    "references": {"min": 0, "max": 0},
    "output": {"kind": "video", "count": 1, "mime": ["video/mp4"], "maxBytes": 314572800}
  }'::jsonb),
  -- Seedance 2.0 Fast: resolution 480p/720p, duration 4–15 s (offered: 5/10).
  ('seedance-2-fast', 1, '{
    "jobKind": "text_to_video",
    "prompt": {"min": 3, "max": 4000},
    "options": {
      "resolution": {"values": ["480p", "720p"], "default": "720p", "label": "Resolution"},
      "audio": {"values": ["on", "off"], "default": "on", "label": "Sound", "labels": {"on": "With audio", "off": "No audio"}},
      "duration": {"values": [5, 10], "default": 5, "label": "Length (seconds)"},
      "aspect_ratio": {"values": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"], "default": "16:9", "label": "Aspect ratio"}
    },
    "references": {"min": 0, "max": 0},
    "output": {"kind": "video", "count": 1, "mime": ["video/mp4"], "maxBytes": 314572800}
  }'::jsonb),
  -- Wan 2.6 text-to-video: duration "5"/"10"/"15", resolution 720p/1080p; the API has no aspect-ratio field.
  ('wan-2-6', 1, '{
    "jobKind": "text_to_video",
    "prompt": {"min": 3, "max": 4000},
    "options": {
      "resolution": {"values": ["720p", "1080p"], "default": "720p", "label": "Resolution"},
      "duration": {"values": [5, 10, 15], "default": 5, "label": "Length (seconds)"}
    },
    "fixed": {"aspect": "The model chooses the frame shape; this model has no aspect-ratio setting."},
    "references": {"min": 0, "max": 0},
    "output": {"kind": "video", "count": 1, "mime": ["video/mp4"], "maxBytes": 314572800}
  }'::jsonb);

-- ------------------------------------------------------ supplier costs

-- Documented per-configuration credits from kie.ai/pricing (checked 14 Oct 2026). USD = credits × 0.005.
insert into app_private.supplier_cost_versions (model_id, version, schedule, usd_per_credit, source_kind, source_url, source_checked_at, note)
select v.model_id, 1, v.schedule::jsonb, 0.005, 'documented', v.url, '2026-10-14T09:00:00Z', v.note
from (values
  ('gpt-flare-image', '{"unit": "output", "dims": ["resolution"], "rates": {"1K": 6, "2K": 10, "4K": 16}}',
   'https://kie.ai/gpt-image-2-5', 'kie.ai/pricing rows "gpt-image-2-5-flare, text-to-image, 1K/2K/4K": 6/10/16 credits per image.'),
  ('gpt-flare-edit', '{"unit": "output", "dims": ["resolution"], "rates": {"1K": 6, "2K": 10, "4K": 16}}',
   'https://kie.ai/gpt-image-2-5', 'kie.ai/pricing rows "gpt-image-2-5-flare, image-to-image, 1K/2K/4K": 6/10/16 credits per image.'),
  ('gpt-sunburst-image', '{"unit": "output", "dims": ["resolution"], "rates": {"1K": 6, "2K": 10, "4K": 16}}',
   'https://kie.ai/gpt-image-2-5', 'kie.ai/pricing rows "gpt-image-2-5-sunburst, text-to-image, 1K/2K/4K": 6/10/16 credits per image.'),
  ('gpt-sunburst-edit', '{"unit": "output", "dims": ["resolution"], "rates": {"1K": 6, "2K": 10, "4K": 16}}',
   'https://kie.ai/gpt-image-2-5', 'kie.ai/pricing rows "gpt-image-2-5-sunburst, image-to-image, 1K/2K/4K": 6/10/16 credits per image.'),
  ('nano-banana-pro-image', '{"unit": "output", "dims": ["resolution"], "rates": {"1K": 18, "2K": 18, "4K": 24}}',
   'https://kie.ai/nano-banana-pro', 'kie.ai/pricing rows "Google nano banana pro, 1/2K" 18 and "4K" 24 credits per image.'),
  ('nano-banana-pro-edit', '{"unit": "output", "dims": ["resolution"], "rates": {"1K": 18, "2K": 18, "4K": 24}}',
   'https://kie.ai/nano-banana-pro', 'kie.ai/pricing rows "Google nano banana pro, 1/2K" 18 and "4K" 24 credits per image (same endpoint with image_input).'),
  ('nano-banana-2-image', '{"unit": "output", "dims": ["resolution"], "rates": {"1K": 8, "2K": 12, "4K": 18}}',
   'https://kie.ai/nano-banana-2', 'kie.ai/pricing rows "Google nano banana 2, 1K/2K/4K": 8/12/18 credits per image.'),
  ('flux-2-pro-image', '{"unit": "output", "dims": ["resolution"], "rates": {"1K": 5, "2K": 7}}',
   'https://kie.ai/flux-2', 'kie.ai/pricing rows "flux-2 pro, text-to-image, 1K/2K": 5/7 credits per image.'),
  ('flux-2-pro-edit', '{"unit": "output", "dims": ["resolution"], "rates": {"1K": 5, "2K": 7}}',
   'https://kie.ai/flux-2', 'kie.ai/pricing rows "flux-2 pro, image to image, 1K/2K": 5/7 credits per image.'),
  ('seedream-5-flash-image', '{"unit": "output", "dims": ["resolution"], "rates": {"1K": 3.24, "1.5K": 3.24, "2K": 3.24}}',
   'https://kie.ai/seedream-5-0-flash', 'kie.ai/pricing rows "seedream 5 Flash, Text to image, 1K/1.5K/2K": 3.24 credits per image.'),
  ('seedream-5-flash-edit', '{"unit": "output", "dims": ["resolution"], "rates": {"1K": 3.24, "1.5K": 3.24, "2K": 3.24}}',
   'https://kie.ai/seedream-5-0-flash', 'kie.ai/pricing rows "seedream 5 Flash, Image to image, 1K/1.5K/2K": 3.24 credits per image.'),
  ('veo-3-1', '{"unit": "output", "dims": ["resolution"], "rates": {"720p": 60, "1080p": 65, "4k": 180}}',
   'https://kie.ai/veo-3-1', 'kie.ai/pricing rows "Google veo 3.1, text-to-video, Fast-720p/1080p/4K": 60/65/180 credits per video. 1080p/4K = 720p price + 1080P (5) / 4K (120) upgrade, billed once at generation. Listed per video for 4/6/8 s.'),
  ('veo-3-1-lite', '{"unit": "output", "dims": ["resolution"], "rates": {"720p": 30, "1080p": 35, "4k": 150}}',
   'https://kie.ai/veo-3-1', 'kie.ai/pricing rows "Google veo 3.1, text-to-video, Lite-720p/1080p/4K": 30/35/150 credits per video (includes the 1080P/4K upgrade). Listed per video for 4/6/8 s.'),
  ('veo-3-1-quality', '{"unit": "output", "dims": ["resolution"], "rates": {"720p": 250, "1080p": 255, "4k": 370}}',
   'https://kie.ai/veo-3-1', 'kie.ai/pricing rows "Google veo 3.1, text-to-video, Quality-720p/1080p/4K": 250/255/370 credits per video (includes the 1080P/4K upgrade). Listed per video for 4/6/8 s.'),
  ('kling-3-0', '{"unit": "second", "durationOption": "duration", "dims": ["resolution", "audio"], "rates": {"720p|on": 20, "720p|off": 14, "1080p|on": 27, "1080p|off": 18, "4K|on": 67, "4K|off": 67}}',
   'https://kie.ai/kling-3-0', 'kie.ai/pricing rows "Kling 3.0, video, with/without audio-720P/1080P/4K": per second of output; std mode = 720P, pro mode = 1080P.'),
  ('seedance-2-5', '{"unit": "second", "durationOption": "duration", "dims": ["resolution"], "rates": {"480p": 28, "720p": 63, "1080p": 158}}',
   'https://kie.ai/seedance-2-5', 'kie.ai/pricing rows "bytedance/seedance-2-5, 480p/720p/1080p no video": per second of output (no reference video is sent). Audio does not change the listed price.'),
  ('seedance-2-fast', '{"unit": "second", "durationOption": "duration", "dims": ["resolution"], "rates": {"480p": 11.7, "720p": 24.8}}',
   'https://kie.ai/seedance-2-0', 'kie.ai/pricing rows "bytedance/seedance-2 fast, 480p/720p no video input": per second of output. Audio does not change the listed price.'),
  ('wan-2-6', '{"unit": "output", "dims": ["resolution", "duration"], "rates": {"720p|5": 70, "720p|10": 140, "720p|15": 210, "1080p|5": 105, "1080p|10": 210, "1080p|15": 315}}',
   'https://kie.ai/wan-2-6', 'kie.ai/pricing rows "wan 2.6, text to video, 5/10/15s-720p/1080p": credits per video.')
) as v(model_id, schedule, url, note);
