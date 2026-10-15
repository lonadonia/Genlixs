-- Genlixs 23 · Video modes, part 3 (catalog data). Sources re-read on 15 Oct 2026 at docs.kie.ai:
--   Veo 3.1 (jobs/createTask, model veo-3-1: TEXT_2_VIDEO, FIRST_AND_LAST_FRAMES_2_VIDEO with 1–2 images,
--     REFERENCE_2_VIDEO with 1–3 images for the Fast and Lite tiers, 8 s only) and Extend (model veo/extend, task_id of
--     a Veo 3.1 task, tier fast/quality/lite, result = the 720p continuation clip);
--   Kling 3.0 (image_urls first/last frame, kling_elements: up to 3 elements of 2–4 JPG/PNG images, "@name" in the prompt);
--   Kling 3.0 Motion Control (kling-3.0/motion-control: one JPG/PNG character image > 340 px, one MP4/MOV motion video
--     3–30 s, mode 720p/1080p, character_orientation video|image — an orientation choice, not a background choice;
--     the Kling 2.6 page limits image orientation to 10 s videos, applied here as a precaution);
--   Seedance 2.5 / 2.0 Fast (first frame, first+last frames, or multimodal references — mutually exclusive; editing a
--     video = reference_video_urls + instruction with duration -1, billed on reference + output seconds at the
--     "with video" rate; reference videos 480p/720p, 409,600–927,408 px, 24–60 fps).
-- Existing video models get a new capability version with input slots; their published prices are re-bound unchanged
-- (same rules, KIE bills these inputs at the same rates) and the change is audited. New entries start disabled and
-- unpriced: the owner prices them and switches them on in Admin.

-- ------------------------------------------------------------ adapters

insert into app_private.provider_adapters (adapter, provider, description) values
  ('kie-veo-3-1', 'kie', 'Veo 3.1: text, start/end frames (image_urls) or reference images; tier, aspect_ratio, resolution, duration'),
  ('kie-kling-3-v2', 'kie', 'Kling 3.0: prompt, start/end frames (image_urls), elements (kling_elements), mode, sound, duration'),
  ('kie-seedance-2-v2', 'kie', 'Seedance 2.x: text, first/last frame or reference images and audio; resolution, audio, duration'),
  ('kie-seedance-edit', 'kie', 'Seedance 2.5 video edit: reference_video_urls + instruction, optional reference images/audio, duration -1'),
  ('kie-kling-motion', 'kie', 'Kling 3.0 Motion Control: character image (input_urls), motion video (video_urls), mode, character_orientation'),
  ('kie-veo-extend', 'kie', 'Veo 3.1 Extend: task_id of a Veo 3.1 task, prompt, tier')
on conflict (adapter) do nothing;

-- ----------------------------------------------------------- new entries

insert into app_private.model_catalog (id, tool, public_name, family, variant_label, badges, purpose, provider_account_id,
  provider_model_id, adapter, sort_order, provider_docs_url, provider_pricing_url, source_checked_at)
select v.id, 'video', v.public_name, v.family, v.variant_label, v.badges::text[], v.purpose,
  (select id from app_private.provider_accounts where provider = 'kie' and label = 'primary'),
  v.provider_model_id, v.adapter, v.sort_order, v.docs, v.pricing, '2026-10-15T03:00:00Z'
from (values
  ('veo-3-1-extend', 'Veo 3.1 Extend', 'Veo 3.1', 'Extend', '{}',
   'Continues one of your Veo 3.1 videos from its last frame, guided by a prompt. The result is the new continuation clip.',
   'veo/extend', 'kie-veo-extend', 37, 'https://docs.kie.ai/veo3-api/extend-video', 'https://kie.ai/veo-3-1'),
  ('seedance-2-5-edit', 'Seedance 2.5 Edit', 'Seedance', '2.5 Edit', '{}',
   'Edits your video with Seedance 2.5''s reference-video mode: describe the change; the result follows your clip''s length.',
   'bytedance/seedance-2-5', 'kie-seedance-edit', 40, 'https://docs.kie.ai/market/bytedance/seedance-2-5', 'https://kie.ai/seedance-2-5'),
  ('kling-3-0-motion', 'Kling 3.0 Motion Control', 'Kling 3.0', 'Motion Control', '{}',
   'Moves your character the way the person in a reference video moves (3–30 s), at 720p or 1080p.',
   'kling-3.0/motion-control', 'kie-kling-motion', 41, 'https://docs.kie.ai/market/kling/motion-control-v3', 'https://kie.ai/kling-3-motion-control')
) as v(id, public_name, family, variant_label, badges, purpose, provider_model_id, adapter, sort_order, docs, pricing)
on conflict (id) do nothing;

-- -------------------------------------------------------- capability specs

insert into app_private.model_capability_versions (model_id, version, spec)
select v.model_id, coalesce((select max(c.version) from app_private.model_capability_versions c where c.model_id = v.model_id), 0) + 1, v.spec::jsonb
from (values
('veo-3-1', $j${
  "jobKind": "text_to_video", "operation": "create",
  "prompt": {"min": 3, "max": 2000},
  "options": {
    "variant": {"values": ["veo3_fast"], "default": "veo3_fast", "label": "Tier", "labels": {"veo3_fast": "Fast"}},
    "aspect_ratio": {"values": ["16:9", "9:16"], "default": "16:9", "label": "Aspect ratio"},
    "resolution": {"values": ["720p", "1080p", "4k"], "default": "720p", "label": "Resolution", "labels": {"4k": "4K"}},
    "duration": {"values": [4, 6, 8], "default": 8, "label": "Length (seconds)"}
  },
  "inputs": {
    "first_frame": {"kind": "image", "label": "Start frame", "min": 1, "max": 1, "mime": ["image/png", "image/jpeg", "image/webp"], "maxBytes": 10485760, "minSide": 300, "aspectMin": 0.4, "aspectMax": 2.5},
    "last_frame": {"kind": "image", "label": "End frame", "min": 1, "max": 1, "mime": ["image/png", "image/jpeg", "image/webp"], "maxBytes": 10485760, "minSide": 300, "aspectMin": 0.4, "aspectMax": 2.5, "needs": ["first_frame"]},
    "reference_images": {"kind": "image", "label": "Reference images", "min": 1, "max": 3, "mime": ["image/png", "image/jpeg", "image/webp"], "maxBytes": 10485760, "minSide": 300, "aspectMin": 0.4, "aspectMax": 2.5}
  },
  "modes": [
    {"id": "text", "label": "Text to video", "uses": []},
    {"id": "frames", "label": "Start and end frames", "uses": ["first_frame", "last_frame"], "requires": ["first_frame"]},
    {"id": "reference", "label": "Reference images", "uses": ["reference_images"], "requires": ["reference_images"],
     "allowed": {"duration": [8]}, "allowedMessage": "Reference images work with 8-second clips."}
  ],
  "combineMessage": "Use either start and end frames or reference images, not both.",
  "fixed": {"audio": "Background audio is generated by the model and is not guaranteed for every prompt.", "time": "4K takes about 5–10 minutes longer."},
  "timing": {"typicalSeconds": 120},
  "references": {"min": 0, "max": 0},
  "output": {"kind": "video", "count": 1, "mime": ["video/mp4"], "maxBytes": 314572800}
}$j$),
('veo-3-1-lite', $j${
  "jobKind": "text_to_video", "operation": "create",
  "prompt": {"min": 3, "max": 2000},
  "options": {
    "variant": {"values": ["veo3_lite"], "default": "veo3_lite", "label": "Tier", "labels": {"veo3_lite": "Lite"}},
    "aspect_ratio": {"values": ["16:9", "9:16"], "default": "16:9", "label": "Aspect ratio"},
    "resolution": {"values": ["720p", "1080p", "4k"], "default": "720p", "label": "Resolution", "labels": {"4k": "4K"}},
    "duration": {"values": [4, 6, 8], "default": 8, "label": "Length (seconds)"}
  },
  "inputs": {
    "first_frame": {"kind": "image", "label": "Start frame", "min": 1, "max": 1, "mime": ["image/png", "image/jpeg", "image/webp"], "maxBytes": 10485760, "minSide": 300, "aspectMin": 0.4, "aspectMax": 2.5},
    "last_frame": {"kind": "image", "label": "End frame", "min": 1, "max": 1, "mime": ["image/png", "image/jpeg", "image/webp"], "maxBytes": 10485760, "minSide": 300, "aspectMin": 0.4, "aspectMax": 2.5, "needs": ["first_frame"]},
    "reference_images": {"kind": "image", "label": "Reference images", "min": 1, "max": 3, "mime": ["image/png", "image/jpeg", "image/webp"], "maxBytes": 10485760, "minSide": 300, "aspectMin": 0.4, "aspectMax": 2.5}
  },
  "modes": [
    {"id": "text", "label": "Text to video", "uses": []},
    {"id": "frames", "label": "Start and end frames", "uses": ["first_frame", "last_frame"], "requires": ["first_frame"]},
    {"id": "reference", "label": "Reference images", "uses": ["reference_images"], "requires": ["reference_images"],
     "allowed": {"duration": [8]}, "allowedMessage": "Reference images work with 8-second clips."}
  ],
  "combineMessage": "Use either start and end frames or reference images, not both.",
  "fixed": {"audio": "Background audio is generated by the model and is not guaranteed for every prompt.", "time": "4K takes about 5–10 minutes longer."},
  "timing": {"typicalSeconds": 100},
  "references": {"min": 0, "max": 0},
  "output": {"kind": "video", "count": 1, "mime": ["video/mp4"], "maxBytes": 314572800}
}$j$),
('veo-3-1-quality', $j${
  "jobKind": "text_to_video", "operation": "create",
  "prompt": {"min": 3, "max": 2000},
  "options": {
    "variant": {"values": ["veo3"], "default": "veo3", "label": "Tier", "labels": {"veo3": "Quality"}},
    "aspect_ratio": {"values": ["16:9", "9:16"], "default": "16:9", "label": "Aspect ratio"},
    "resolution": {"values": ["720p", "1080p", "4k"], "default": "720p", "label": "Resolution", "labels": {"4k": "4K"}},
    "duration": {"values": [4, 6, 8], "default": 8, "label": "Length (seconds)"}
  },
  "inputs": {
    "first_frame": {"kind": "image", "label": "Start frame", "min": 1, "max": 1, "mime": ["image/png", "image/jpeg", "image/webp"], "maxBytes": 10485760, "minSide": 300, "aspectMin": 0.4, "aspectMax": 2.5},
    "last_frame": {"kind": "image", "label": "End frame", "min": 1, "max": 1, "mime": ["image/png", "image/jpeg", "image/webp"], "maxBytes": 10485760, "minSide": 300, "aspectMin": 0.4, "aspectMax": 2.5, "needs": ["first_frame"]}
  },
  "modes": [
    {"id": "text", "label": "Text to video", "uses": []},
    {"id": "frames", "label": "Start and end frames", "uses": ["first_frame", "last_frame"], "requires": ["first_frame"]}
  ],
  "fixed": {"audio": "Background audio is generated by the model and is not guaranteed for every prompt.", "time": "4K takes about 5–10 minutes longer."},
  "timing": {"typicalSeconds": 180},
  "references": {"min": 0, "max": 0},
  "output": {"kind": "video", "count": 1, "mime": ["video/mp4"], "maxBytes": 314572800}
}$j$),
('kling-3-0', $j${
  "jobKind": "text_to_video", "operation": "create",
  "prompt": {"min": 3, "max": 2500},
  "options": {
    "resolution": {"values": ["720p", "1080p", "4K"], "default": "720p", "label": "Resolution"},
    "audio": {"values": ["on", "off"], "default": "on", "label": "Sound", "labels": {"on": "With audio", "off": "No audio"}},
    "duration": {"values": [5, 10, 15], "default": 5, "label": "Length (seconds)"},
    "aspect_ratio": {"values": ["16:9", "9:16", "1:1"], "default": "16:9", "label": "Aspect ratio"}
  },
  "inputs": {
    "first_frame": {"kind": "image", "label": "Start frame", "min": 1, "max": 1, "mime": ["image/png", "image/jpeg"], "maxBytes": 10485760, "minSide": 300, "aspectMin": 0.4, "aspectMax": 2.5, "hides": ["aspect_ratio"]},
    "last_frame": {"kind": "image", "label": "End frame", "min": 1, "max": 1, "mime": ["image/png", "image/jpeg"], "maxBytes": 10485760, "minSide": 300, "aspectMin": 0.4, "aspectMax": 2.5, "needs": ["first_frame"]},
    "element_1": {"kind": "image", "label": "Element 1", "group": "elements", "mention": "@element1", "min": 2, "max": 4, "mime": ["image/png", "image/jpeg"], "maxBytes": 10485760, "minSide": 300},
    "element_2": {"kind": "image", "label": "Element 2", "group": "elements", "mention": "@element2", "min": 2, "max": 4, "mime": ["image/png", "image/jpeg"], "maxBytes": 10485760, "minSide": 300},
    "element_3": {"kind": "image", "label": "Element 3", "group": "elements", "mention": "@element3", "min": 2, "max": 4, "mime": ["image/png", "image/jpeg"], "maxBytes": 10485760, "minSide": 300}
  },
  "modes": [
    {"id": "create", "label": "Text, frames and elements", "uses": ["first_frame", "last_frame", "element_1", "element_2", "element_3"]}
  ],
  "fixed": {"aspect": "With a start frame the clip follows the frame's shape."},
  "timing": {"typicalSeconds": 150},
  "references": {"min": 0, "max": 0},
  "output": {"kind": "video", "count": 1, "mime": ["video/mp4"], "maxBytes": 314572800}
}$j$),
('seedance-2-5', $j${
  "jobKind": "text_to_video", "operation": "create",
  "prompt": {"min": 3, "max": 4000},
  "options": {
    "resolution": {"values": ["480p", "720p", "1080p"], "default": "720p", "label": "Resolution"},
    "audio": {"values": ["on", "off"], "default": "on", "label": "Sound", "labels": {"on": "With audio", "off": "No audio"}},
    "duration": {"values": [5, 10], "default": 5, "label": "Length (seconds)"},
    "aspect_ratio": {"values": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"], "default": "16:9", "label": "Aspect ratio", "labels": {"adaptive": "Match input"}}
  },
  "inputs": {
    "first_frame": {"kind": "image", "label": "First frame", "min": 1, "max": 1, "mime": ["image/png", "image/jpeg", "image/webp"], "maxBytes": 10485760, "minSide": 300, "maxSide": 6000, "aspectMin": 0.4, "aspectMax": 2.5},
    "last_frame": {"kind": "image", "label": "Last frame", "min": 1, "max": 1, "mime": ["image/png", "image/jpeg", "image/webp"], "maxBytes": 10485760, "minSide": 300, "maxSide": 6000, "aspectMin": 0.4, "aspectMax": 2.5, "needs": ["first_frame"]},
    "reference_images": {"kind": "image", "label": "Reference images", "min": 1, "max": 9, "mime": ["image/png", "image/jpeg", "image/webp"], "maxBytes": 10485760, "minSide": 300, "maxSide": 6000, "aspectMin": 0.4, "aspectMax": 2.5},
    "reference_audio": {"kind": "audio", "label": "Reference audio", "min": 1, "max": 3, "mime": ["audio/mpeg", "audio/wav", "audio/mp4"], "maxBytes": 15728640, "minSeconds": 2, "maxSeconds": 30, "totalMaxSeconds": 30}
  },
  "modes": [
    {"id": "text", "label": "Text to video", "uses": []},
    {"id": "frames", "label": "First and last frame", "uses": ["first_frame", "last_frame"], "requires": ["first_frame"]},
    {"id": "reference", "label": "References", "uses": ["reference_images", "reference_audio"], "requires": ["reference_images"]}
  ],
  "combineMessage": "Seedance uses either a first/last frame or references (images and audio), not both.",
  "timing": {"typicalSeconds": 150},
  "references": {"min": 0, "max": 0},
  "output": {"kind": "video", "count": 1, "mime": ["video/mp4"], "maxBytes": 314572800}
}$j$),
('seedance-2-fast', $j${
  "jobKind": "text_to_video", "operation": "create",
  "prompt": {"min": 3, "max": 4000},
  "options": {
    "resolution": {"values": ["480p", "720p"], "default": "720p", "label": "Resolution"},
    "audio": {"values": ["on", "off"], "default": "on", "label": "Sound", "labels": {"on": "With audio", "off": "No audio"}},
    "duration": {"values": [5, 10], "default": 5, "label": "Length (seconds)"},
    "aspect_ratio": {"values": ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"], "default": "16:9", "label": "Aspect ratio", "labels": {"adaptive": "Match input"}}
  },
  "inputs": {
    "first_frame": {"kind": "image", "label": "First frame", "min": 1, "max": 1, "mime": ["image/png", "image/jpeg", "image/webp"], "maxBytes": 10485760, "minSide": 300, "maxSide": 6000, "aspectMin": 0.4, "aspectMax": 2.5},
    "last_frame": {"kind": "image", "label": "Last frame", "min": 1, "max": 1, "mime": ["image/png", "image/jpeg", "image/webp"], "maxBytes": 10485760, "minSide": 300, "maxSide": 6000, "aspectMin": 0.4, "aspectMax": 2.5, "needs": ["first_frame"]},
    "reference_images": {"kind": "image", "label": "Reference images", "min": 1, "max": 9, "mime": ["image/png", "image/jpeg", "image/webp"], "maxBytes": 10485760, "minSide": 300, "maxSide": 6000, "aspectMin": 0.4, "aspectMax": 2.5},
    "reference_audio": {"kind": "audio", "label": "Reference audio", "min": 1, "max": 3, "mime": ["audio/mpeg", "audio/wav"], "maxBytes": 15728640, "minSeconds": 2, "maxSeconds": 15, "totalMaxSeconds": 15}
  },
  "modes": [
    {"id": "text", "label": "Text to video", "uses": []},
    {"id": "frames", "label": "First and last frame", "uses": ["first_frame", "last_frame"], "requires": ["first_frame"]},
    {"id": "reference", "label": "References", "uses": ["reference_images", "reference_audio"], "requires": ["reference_images"]}
  ],
  "combineMessage": "Seedance uses either a first/last frame or references (images and audio), not both.",
  "timing": {"typicalSeconds": 90},
  "references": {"min": 0, "max": 0},
  "output": {"kind": "video", "count": 1, "mime": ["video/mp4"], "maxBytes": 314572800}
}$j$),
('veo-3-1-extend', $j${
  "jobKind": "video_extend", "operation": "extend",
  "prompt": {"min": 3, "max": 2000},
  "options": {
    "tier": {"values": ["fast", "lite", "quality"], "default": "fast", "label": "Tier", "labels": {"fast": "Fast", "lite": "Lite", "quality": "Quality"}}
  },
  "inputs": {
    "source_job": {"kind": "job", "label": "Video to extend", "min": 1, "max": 1, "families": ["Veo 3.1"], "maxAgeDays": 13,
      "hint": "One of your Veo 3.1 videos from the last 13 days"}
  },
  "modes": [{"id": "extend", "label": "Extend a video", "uses": ["source_job"], "requires": ["source_job"]}],
  "fixed": {"output": "The result is the new continuation clip (720p), starting from the last frame of your video."},
  "timing": {"typicalSeconds": 150},
  "references": {"min": 0, "max": 0},
  "output": {"kind": "video", "count": 1, "mime": ["video/mp4"], "maxBytes": 314572800}
}$j$)
) as v(model_id, spec);

insert into app_private.model_capability_versions (model_id, version, spec)
select v.model_id, coalesce((select max(c.version) from app_private.model_capability_versions c where c.model_id = v.model_id), 0) + 1, v.spec
from (values
('seedance-2-5-edit', jsonb_build_object(
  'jobKind', 'video_edit', 'operation', 'edit',
  'prompt', jsonb_build_object('min', 3, 'max', 4000),
  'options', jsonb_build_object(
    'resolution', jsonb_build_object('values', jsonb_build_array('480p', '720p'), 'default', '720p', 'label', 'Resolution'),
    'audio', jsonb_build_object('values', jsonb_build_array('on', 'off'), 'default', 'on', 'label', 'Sound',
      'labels', jsonb_build_object('on', 'Generate sound', 'off', 'No sound')),
    'seconds', jsonb_build_object('values', (select jsonb_agg(g) from generate_series(4, 30) g), 'default', 5,
      'label', 'Video length (s)', 'derived', true)),
  'inputs', jsonb_build_object(
    'source_video', jsonb_build_object('kind', 'video', 'label', 'Video to edit', 'min', 1, 'max', 1,
      'mime', jsonb_build_array('video/mp4', 'video/quicktime'), 'maxBytes', 52428800, 'minSeconds', 4, 'maxSeconds', 30,
      'minSide', 300, 'maxSide', 6000, 'minPixels', 409600, 'maxPixels', 927408, 'aspectMin', 0.4, 'aspectMax', 2.5,
      'fpsMin', 24, 'fpsMax', 60, 'hint', 'MP4 or MOV, 4–30 s, 480p or 720p, 24–60 fps, up to 50 MB'),
    'reference_images', jsonb_build_object('kind', 'image', 'label', 'Reference images', 'min', 1, 'max', 9,
      'mime', jsonb_build_array('image/png', 'image/jpeg', 'image/webp'), 'maxBytes', 10485760, 'minSide', 300, 'maxSide', 6000,
      'aspectMin', 0.4, 'aspectMax', 2.5),
    'reference_audio', jsonb_build_object('kind', 'audio', 'label', 'Reference audio', 'min', 1, 'max', 3,
      'mime', jsonb_build_array('audio/mpeg', 'audio/wav', 'audio/mp4'), 'maxBytes', 15728640, 'minSeconds', 2, 'maxSeconds', 30,
      'totalMaxSeconds', 30)),
  'modes', jsonb_build_array(jsonb_build_object('id', 'edit', 'label', 'Edit with a prompt',
    'uses', jsonb_build_array('source_video', 'reference_images', 'reference_audio'), 'requires', jsonb_build_array('source_video'))),
  'derived', jsonb_build_object('seconds', jsonb_build_object('from', 'source_video')),
  'fixed', jsonb_build_object('length', 'The edited video keeps the length of your clip.',
    'draw', 'Area drawing is not available: this model edits from your written instruction.'),
  'timing', jsonb_build_object('typicalSeconds', 240),
  'references', jsonb_build_object('min', 0, 'max', 0),
  'output', jsonb_build_object('kind', 'video', 'count', 1, 'mime', jsonb_build_array('video/mp4'), 'maxBytes', 314572800))),
('kling-3-0-motion', jsonb_build_object(
  'jobKind', 'motion_control', 'operation', 'motion',
  'prompt', jsonb_build_object('min', 0, 'max', 2500, 'optional', true),
  'options', jsonb_build_object(
    'mode', jsonb_build_object('values', jsonb_build_array('720p', '1080p'), 'default', '720p', 'label', 'Quality'),
    'orientation', jsonb_build_object('values', jsonb_build_array('video', 'image'), 'default', 'video', 'label', 'Character orientation',
      'labels', jsonb_build_object('video', 'Follow the video', 'image', 'Keep the image''s pose')),
    'seconds', jsonb_build_object('values', (select jsonb_agg(g) from generate_series(3, 30) g), 'default', 5,
      'label', 'Motion length (s)', 'derived', true)),
  'inputs', jsonb_build_object(
    'motion_video', jsonb_build_object('kind', 'video', 'label', 'Motion to copy', 'min', 1, 'max', 1,
      'mime', jsonb_build_array('video/mp4', 'video/quicktime'), 'maxBytes', 52428800, 'minSeconds', 3, 'maxSeconds', 30,
      'minSide', 341, 'aspectMin', 0.4, 'aspectMax', 2.5,
      'hint', 'MP4 or MOV, 3–30 s, head, shoulders and torso visible'),
    'character_image', jsonb_build_object('kind', 'image', 'label', 'Your character', 'min', 1, 'max', 1,
      'mime', jsonb_build_array('image/png', 'image/jpeg'), 'maxBytes', 10485760, 'minSide', 341, 'aspectMin', 0.4, 'aspectMax', 2.5,
      'hint', 'JPG or PNG with a visible face and body')),
  'modes', jsonb_build_array(jsonb_build_object('id', 'motion', 'label', 'Copy motion',
    'uses', jsonb_build_array('motion_video', 'character_image'), 'requires', jsonb_build_array('motion_video', 'character_image'))),
  'rules', jsonb_build_array(jsonb_build_object('when', jsonb_build_object('orientation', 'image'), 'slot', 'motion_video', 'maxSeconds', 10,
    'message', 'With “Keep the image''s pose” the motion video can be up to 10 seconds.')),
  'derived', jsonb_build_object('seconds', jsonb_build_object('from', 'motion_video')),
  'fixed', jsonb_build_object('length', 'The clip follows the length of the motion video.'),
  'timing', jsonb_build_object('typicalSeconds', 240),
  'references', jsonb_build_object('min', 0, 'max', 0),
  'output', jsonb_build_object('kind', 'video', 'count', 1, 'mime', jsonb_build_array('video/mp4'), 'maxBytes', 314572800)))
) as v(model_id, spec);

-- New jobs of these models use the new request builders; jobs already created keep theirs (worker_claim uses the job's adapter).
update app_private.model_catalog set adapter = case id when 'kling-3-0' then 'kie-kling-3-v2' when 'seedance-2-5' then 'kie-seedance-2-v2'
  when 'seedance-2-fast' then 'kie-seedance-2-v2' else 'kie-veo-3-1' end
where id in ('veo-3-1', 'veo-3-1-lite', 'veo-3-1-quality', 'kling-3-0', 'seedance-2-5', 'seedance-2-fast');

-- Published prices of existing models: same rules, re-bound to the new capability version, audited. A model without a
-- published price keeps none (the owner prices it as before).
do $$
declare
  r record;
  v_new uuid;
  v_cap uuid;
begin
  for r in
    select p.* from app_private.price_versions p
    where p.state = 'published' and p.model_id in ('veo-3-1', 'veo-3-1-lite', 'veo-3-1-quality', 'kling-3-0', 'seedance-2-5', 'seedance-2-fast')
  loop
    v_cap := (app_private.capability_for(r.model_id)).id;
    continue when r.capability_version_id = v_cap;
    update app_private.price_versions set state = 'retired' where id = r.id;
    insert into app_private.price_versions (model_id, capability_version_id, version, state, rules, supplier_cost_snapshot, cost_evidence,
      effective_at, published_by, created_by, source, supplier_cost_version_id, markup_bps, basis, restored_from)
    values (r.model_id, v_cap, (select max(version) + 1 from app_private.price_versions where model_id = r.model_id), 'published', r.rules,
      r.supplier_cost_snapshot, r.cost_evidence, now(), r.published_by, null, 'capability', r.supplier_cost_version_id, r.markup_bps, r.basis, r.id)
    returning id into v_new;
    perform app_private.audit(null, 'catalog.publish', 'price.carried_to_capability', 'model', r.model_id,
      'New option schema (start/end frames and reference inputs); the published prices were carried over unchanged.',
      jsonb_build_object('priceVersionId', r.id, 'capabilityVersionId', r.capability_version_id),
      jsonb_build_object('priceVersionId', v_new, 'capabilityVersionId', v_cap));
  end loop;
end;
$$;

-- ------------------------------------------------------ supplier costs

insert into app_private.supplier_cost_versions (model_id, version, schedule, usd_per_credit, source_kind, source_url, source_checked_at, note)
select v.model_id, coalesce((select max(c.version) from app_private.supplier_cost_versions c where c.model_id = v.model_id), 0) + 1,
  v.schedule::jsonb, 0.005, 'documented', v.url, '2026-10-15T03:00:00Z', v.note
from (values
  ('veo-3-1-extend', '{"unit": "output", "dims": ["tier"], "rates": {"fast": 60, "lite": 30, "quality": 250}}',
   'https://kie.ai/veo-3-1', 'kie.ai/pricing rows "Google veo 3.1, Extend, Fast/Lite/Quality": 60/30/250 credits per extension.'),
  ('seedance-2-5-edit', '{"unit": "second", "durationOption": "seconds", "secondsFactor": 2, "dims": ["resolution"], "rates": {"480p": 17, "720p": 38}}',
   'https://kie.ai/seedance-2-5', 'kie.ai/pricing rows "bytedance/seedance-2-5, 480p/720p with video": 17/38 credits per second, billed on reference video seconds plus output seconds (output = source length).'),
  ('kling-3-0-motion', '{"unit": "second", "durationOption": "seconds", "dims": ["mode"], "rates": {"720p": 20, "1080p": 27}}',
   'https://kie.ai/kling-3-motion-control', 'kie.ai/pricing rows "kling 3.0 motion control, video-to-video, 720P/1080P": 20/27 credits per second of the motion video.')
) as v(model_id, schedule, url, note)
where not exists (select 1 from app_private.supplier_cost_versions c where c.model_id = v.model_id);
