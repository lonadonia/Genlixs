-- Seedance 2.5
select app_private.seed_offer('nezhagate', 'seedance-2-5', 'seedance-2.5', 'Seedance 2.5', 'video', 'text_to_video',
  'seedance-2.5', 'nezhagate-video',
  '{"options": {"audio": ["on"], "duration": [5, 10], "resolution": ["480p", "720p", "1080p"], "aspect_ratio": ["16:9", "9:16", "1:1", "4:3", "3:4"]},
    "modes": ["text", "reference"], "inputs": {"reference_images": {"max": 9}, "reference_audio": {"max": 3, "maxTotalSeconds": 90}},
    "maxPromptChars": 11000, "notes": ["Sound is always on", "Reference images are never frames", "Photos of real people may be refused upstream"]}',
  'capabilities_unverified', 'Needs an API key and a verified test. No first/last-frame mode; audio cannot be switched off.',
  'https://nezhagate.com/en/docs/seedance-2.5', 'https://nezhagate.com/en/docs/seedance-2.5',
  'usd', '{"basis": "output_second", "dims": ["resolution"], "rates": {"480p": "0.10", "720p": "0.158", "1080p": "0.33"}, "seconds": {"option": "duration"}}',
  'documented', 'Rate × ordered seconds.');
select app_private.seed_offer('apimart', 'seedance-2-5', 'seedance-2.5', 'Seedance 2.5', 'video', 'text_to_video',
  'seedance-2.5', 'apimart-video',
  '{"options": {"audio": ["on", "off"], "duration": [5, 10], "resolution": ["480p", "720p", "1080p"], "aspect_ratio": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"]},
    "modes": ["text", "frames", "reference"], "inputs": {"first_frame": {"max": 1}, "last_frame": {"max": 1}, "reference_images": {"max": 9},
    "reference_audio": {"max": 3, "maxTotalSeconds": 30}}}',
  'capabilities_unverified', 'Needs an API key and a verified test before routing.',
  'https://apimart.ai/model/doubao-seedance-2-5', 'https://docs.apimart.ai/en/api-reference/videos/seedance-2-5/generation',
  'apimart_credit', '{"basis": "output_second", "dims": ["resolution"], "rates": {"480p": "0.9608", "720p": "2.16", "1080p": "3.8488"}, "seconds": {"option": "duration"}}',
  'documented', 'Gold-tier price without input video.');
select app_private.seed_offer('cuddler', 'seedance-2-5', 'seedance-2.5', 'Seedance 2.5', 'video', 'text_to_video',
  'seedance-2.5', 'cuddler-video',
  '{"options": {"audio": ["on", "off"], "duration": [5, 10], "resolution": ["480p"], "aspect_ratio": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"]},
    "modes": ["text", "frames", "reference"], "inputs": {"first_frame": {"max": 1}, "last_frame": {"max": 1}, "reference_images": {"max": 9},
    "reference_audio": {"max": 3, "maxTotalSeconds": 30}}}',
  'capabilities_unverified', 'Token-priced: only the 480p estimate is published. The result download host is not documented; confirm it with a test and add it to MEDIA_FETCH_ALLOWED_HOSTS.',
  'https://platform.cuddler.ai/pricing', 'https://api.cuddler.ai/v1/openapi.json',
  'usd', '{"basis": "output_second", "dims": ["resolution"], "rates": {"480p": "0.072"}, "seconds": {"option": "duration"}}', 'estimate',
  'Nominal estimate per second without input video; the 5.5 % card fee is applied from the account. The job carries max_usd so the charge cannot exceed the estimate by more than 15 %.');
select app_private.seed_offer('poyo', 'seedance-2-5', 'seedance-2.5', 'Seedance 2.5', 'video', 'text_to_video',
  null, null, '{}', 'discovered', 'No PoYo Seedance 2.5 quote or integration identified.', 'https://poyo.ai/pricing', null, null, null, null, null);

-- Kling 3.0 (standard 720p without sound on Cuddler)
select app_private.seed_offer('cuddler', 'kling-3-0', 'kling-3.0/standard', 'Kling 3.0 standard', 'video', 'text_to_video',
  'kling-3.0', 'cuddler-video',
  '{"options": {"audio": ["off"], "duration": [5, 10, 15], "resolution": ["720p"], "aspect_ratio": ["16:9", "9:16", "1:1"]},
    "modes": ["create"], "inputs": {"first_frame": {"max": 1}, "last_frame": {"max": 1}},
    "request": {"variant": "standard"}, "notes": ["Elements are not supported on this route", "720p without sound only"]}',
  'capabilities_unverified', 'Needs an API key and a verified test. The result download host is not documented; confirm it with a test and add it to MEDIA_FETCH_ALLOWED_HOSTS.',
  'https://platform.cuddler.ai/pricing', 'https://api.cuddler.ai/v1/openapi.json',
  'usd', '{"basis": "output_second", "dims": ["resolution", "audio"], "rates": {"720p|off": "0.0588"}, "seconds": {"option": "duration"}}', 'documented',
  'Nominal; the 5.5 % card fee is applied from the account ($0.062034 per second funded).');
select app_private.seed_offer('duomi', 'kling-3-0', 'kling-3.0', 'Kling 3.0', 'video', 'text_to_video',
  null, null, '{}', 'pricing_unverified', 'No integration in this release (Duomi Kling official format).', 'https://duomiapi.com/doc/65', null,
  'cny', '{"basis": "output_second", "dims": ["resolution", "audio"], "rates": {"720p|off": "0.48"}, "seconds": {"option": "duration"}}', 'documented', null);

-- Veo 3.1 (clip equivalence unresolved everywhere)
select app_private.seed_offer('duomi', 'veo-3-1', 'veo3.1-fast', 'Veo 3.1 Fast', 'video', 'text_to_video',
  'veo3.1-fast', null, '{}', 'pricing_unverified',
  'Clip duration and audio equivalence not established in the price table; the 4K route is listed offline. No integration in this release.',
  'https://duomiapi.com/doc/98', 'https://s.apifox.cn/b924931e-29c0-4127-b025-d68c90285060/api-393471292.md',
  'cny', '{"basis": "request", "dims": ["resolution"], "rates": {"720p": "0.20", "1080p": "0.40"}}', 'unverified', 'Per request; clip settings unknown.');
select app_private.seed_offer('apimart', 'veo-3-1', 'veo-3.1-fast/ext', 'Veo 3.1 Fast (EXT channel)', 'video', 'text_to_video',
  null, null, '{}', 'pricing_unverified', 'EXT channel: duration, audio, resolution and channel equivalence not verified.',
  'https://apimart.ai/model/veo-3-1', null,
  'usd', '{"basis": "request", "dims": ["resolution"], "rates": {"720p": "0.14", "1080p": "0.14", "4k": "0.64"}}', 'unverified', null);
select app_private.seed_offer('poyo', 'veo-3-1', 'veo-3.1-fast', 'Veo 3.1 Fast', 'video', 'text_to_video',
  null, null, '{}', 'pricing_unverified', 'Clip duration not confirmed; no PoYo video integration for Veo in this release.',
  'https://poyo.ai/models/veo-3-1', null,
  'usd', '{"basis": "request", "dims": ["resolution"], "rates": {"720p": "0.18", "1080p": "0.18", "4k": "0.30"}}', 'unverified', null);
select app_private.seed_offer('apimart', 'veo-3-1-lite', 'veo-3.1-lite/ext', 'Veo 3.1 Lite (EXT channel)', 'video', 'text_to_video',
  null, null, '{}', 'pricing_unverified', 'EXT channel: listed clip configuration not matched to Genlixs settings.', 'https://apimart.ai/model/veo-3-1', null,
  'usd', '{"basis": "request", "dims": ["resolution"], "rates": {"720p": "0.07"}}', 'unverified', null);
select app_private.seed_offer('poyo', 'veo-3-1-lite', 'veo-3.1-lite', 'Veo 3.1 Lite', 'video', 'text_to_video',
  null, null, '{}', 'pricing_unverified', 'Duration, audio and resolution equivalence not verified.', 'https://poyo.ai/models/veo-3-1', null,
  'usd', '{"basis": "request", "dims": ["resolution"], "rates": {"720p": "0.10"}}', 'unverified', null);

-- Wan 2.6 (ordinary) and FLUX.2 Pro
select app_private.seed_offer('apimart', 'wan-2-6', 'wan2.6', 'Wan 2.6', 'video', 'text_to_video',
  null, null, '{}', 'discovered', 'Ordinary Wan 2.6 price not established (Flash prices must not be applied).',
  'https://docs.apimart.ai/en/api-reference/videos/wan2.6/generation', null, null, null, null, null);
select app_private.seed_offer('apimart', 'flux-2-pro-image', 'flux-2-pro', 'FLUX.2 Pro', 'image', 'text_to_image',
  null, null, '{}', 'pricing_unverified', 'Billed per output and input megapixel; exact pixel billing per Genlixs size not modelled yet.',
  'https://apimart.ai/model/flux-2-pro', 'https://docs.apimart.ai/en/api-reference/images/flux-2/generation', null, null, null,
  '$0.024 per output megapixel plus $0.012 per billable input megapixel.');

