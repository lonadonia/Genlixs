// Video models of the full catalog (docs.kie.ai and the KIE price list, checked 22 Oct 2026). Same conventions as
// models.mjs: the KIE original route, the capability specification and the KIE reference schedule in KIE credits.
import {
  AUDIO_MIME, JPG_PNG, MP3, NO_REFS,
  aspect, audio, audioSlot, derivedOpt, duration, firstFrame, framesMode, image, imageMode, lastFrame, opt,
  perOutput, perSecond, range, referenceImages, referenceMode, resolution, textMode, video, videoOut,
} from "./lib.mjs";

const docs = (path) => `https://docs.kie.ai/${path}`;

const videoSpec = (o) => ({
  jobKind: o.jobKind ?? "text_to_video",
  operation: o.operation ?? "create",
  prompt: { min: 3, max: 4000, ...(o.prompt ?? {}) },
  options: o.options,
  inputs: o.inputs,
  modes: o.modes,
  ...(o.combineMessage ? { combineMessage: o.combineMessage } : {}),
  ...(o.derived ? { derived: o.derived } : {}),
  ...(o.rules ? { rules: o.rules } : {}),
  ...(o.exclude ? { exclude: o.exclude, excludeMessage: o.excludeMessage } : {}),
  ...(o.fixed ? { fixed: o.fixed } : {}),
  timing: { typicalSeconds: o.typical ?? 150 },
  references: NO_REFS,
  output: videoOut,
});

const SOUND_ALWAYS = "Every clip includes sound generated with the video.";
const FRAME_SHAPE = "With a start frame the clip follows the frame's shape.";
/** A start frame that hides the aspect-ratio setting (the endpoint takes the frame's shape). */
const first = (o = {}) => firstFrame({ hides: ["aspect_ratio"], ...o });
const last = (o = {}) => lastFrame(o);
const KLING = { mime: JPG_PNG };
const AR3 = ["16:9", "9:16", "1:1"];
const AR5 = ["16:9", "9:16", "1:1", "4:3", "3:4"];
const pixverseRates = { "360p|off": 4, "360p|on": 5.6, "540p|off": 5.6, "540p|on": 7.2, "720p|off": 7.2, "720p|on": 9.6, "1080p|off": 14.4, "1080p|on": 18.4 };
const geminiRates = (resolutions) => {
  const out = {};
  for (const r of resolutions) for (const [d, std, uhd] of [[4, 63, 147], [6, 84, 168], [8, 105, 189], [10, 126, 210]]) out[`${r}|${d}`] = r === "4k" ? uhd : std;
  return out;
};
const sourceVideo = (o) => video("Video to edit", { minSide: 240, ...o });

export const VIDEO_MODELS = [
  // ---------------------------------------------------------------- Kling
  {
    id: "kling-3-0-turbo", tool: "video", name: "Kling 3.0 Turbo", family: "Kling 3.0", variant: "Turbo", badges: ["fast"], sort: 300,
    purpose: "Kling 3.0 Turbo: faster Kling 3.0 clips from text or a start frame, 3–15 s, with sound.",
    kie: { model: "kling/v3-turbo-text-to-video;image=kling/v3-turbo-image-to-video", adapter: "kie-kling-3-turbo", docs: docs("market/kling/v3-turbo-text-to-video") },
    spec: videoSpec({
      prompt: { max: 2500 },
      options: { resolution: resolution(["720p", "1080p"]), duration: duration([3, 5, 8, 10, 12, 15], 5), aspect_ratio: aspect(AR3) },
      inputs: { first_frame: first(KLING) },
      modes: [textMode(), imageMode()],
      fixed: { audio: SOUND_ALWAYS, aspect: FRAME_SHAPE },
      typical: 120,
    }),
    cost: { schedule: perSecond(["resolution"], { "720p": 18, "1080p": 22.5 }), note: "KIE price list: kling 3.0 turbo, text/image-to-video, 720P/1080P = 18/22.5 credits per second." },
  },
  {
    id: "kling-3-0-omni", tool: "video", name: "Kling 3.0 Omni", family: "Kling 3.0", variant: "Omni", badges: [], sort: 301,
    purpose: "Kling 3.0 Omni: text, start/end frames or up to 7 reference images, 3–15 s, optional sound, up to 4K.",
    kie: {
      model: "kling-3.0-omni/text-to-video;frames=kling-3.0-omni/image-to-video;reference=kling-3.0-omni/reference-to-video",
      adapter: "kie-kling-3-omni", docs: docs("market/kling/v3-omni-text-to-video"),
    },
    spec: videoSpec({
      prompt: { max: 3072 },
      options: { audio: audio(), resolution: resolution(["720p", "1080p", "4k"], "720p", { "4k": "4K" }), duration: duration([3, 5, 8, 10, 12, 15], 5), aspect_ratio: aspect(AR3) },
      inputs: { first_frame: first(KLING), last_frame: last(KLING), reference_images: referenceImages(7, KLING) },
      modes: [textMode(), framesMode(), referenceMode(["reference_images"])],
      combineMessage: "Use either start and end frames or reference images, not both.",
      fixed: { aspect: FRAME_SHAPE },
      typical: 180,
    }),
    cost: {
      schedule: perSecond(["resolution", "audio"], { "720p|off": 14, "720p|on": 18, "1080p|off": 18, "1080p|on": 23, "4k|off": 67, "4k|on": 67 }),
      note: "KIE price list: kling 3.0 omni, text/image/reference-to-video without video input: 720p 14/18, 1080p 18/23, 4k 67 credits per second (no audio/with audio).",
    },
  },
  {
    id: "kling-4-0", tool: "video", name: "Kling 4.0", family: "Kling 4.0", variant: null, badges: ["premium"], sort: 302,
    purpose: "Kling 4.0: text, keyframes (start, up to two middle frames, end) or up to 10 reference images, 3–30 s.",
    kie: { model: "kling-4.0/reference-to-video;frames=kling-4.0/keyframe-to-video", adapter: "kie-kling-4", docs: docs("market/kling/v4-reference-to-video") },
    spec: videoSpec({
      options: { resolution: resolution(["720p", "1080p"]), duration: duration([3, 5, 8, 10, 15, 20, 30], 5), aspect_ratio: aspect(["16:9", "9:16", "1:1", "21:9"]) },
      inputs: {
        first_frame: first({ hint: "Mention it in the prompt as @first_frame" }),
        keyframes: image("Middle keyframes", { max: 2, needs: ["first_frame"], hint: "In order; mention them as @keyframe_1, @keyframe_2" }),
        last_frame: last({ hint: "Mention it in the prompt as @last_frame" }),
        reference_images: referenceImages(10, { hint: "Mention them in the prompt as @image_1, @image_2, …" }),
      },
      modes: [textMode(), framesMode("Keyframes", ["first_frame", "keyframes", "last_frame"]), referenceMode(["reference_images"])],
      combineMessage: "Use either keyframes or reference images, not both.",
      fixed: { aspect: FRAME_SHAPE },
      typical: 240,
    }),
    cost: { schedule: perSecond(["resolution"], { "720p": 28.5, "1080p": 42.5 }), note: "KIE price list: kling 4.0, keyframe-to-video and reference-to-video without video input, 720P/1080P = 28.5/42.5 credits per second." },
  },
  {
    id: "kling-2-6", tool: "video", name: "Kling 2.6", family: "Kling 2.6", variant: null, badges: [], sort: 303,
    purpose: "Kling 2.6 from text or a start frame, 5 or 10 s, with or without sound.",
    kie: { model: "kling-2.6/text-to-video;image=kling-2.6/image-to-video", adapter: "kie-kling-2-6", docs: docs("market/kling/text-to-video") },
    spec: videoSpec({
      prompt: { max: 2500 },
      options: { audio: audio("off"), duration: duration([5, 10]), aspect_ratio: aspect(AR3) },
      inputs: { first_frame: first(KLING) },
      modes: [textMode(), imageMode()],
      fixed: { aspect: FRAME_SHAPE },
      typical: 150,
    }),
    cost: { schedule: perOutput(["audio", "duration"], { "off|5": 55, "off|10": 110, "on|5": 110, "on|10": 220 }), note: "KIE price list: kling 2.6, text/image-to-video, without audio 5 s/10 s = 55/110, with audio = 110/220 credits per video." },
  },
  {
    id: "kling-2-6-motion", tool: "video", name: "Kling 2.6 Motion Control", family: "Kling 2.6", variant: "Motion Control", badges: ["budget"], sort: 330,
    purpose: "Moves your character the way the person in a reference video moves (3–30 s) with Kling 2.6, at 720p or 1080p.",
    kie: { model: "kling-2.6/motion-control", adapter: "kie-kling-motion", docs: docs("market/kling/motion-control") },
    spec: videoSpec({
      jobKind: "motion_control", operation: "motion",
      prompt: { min: 0, max: 2500, optional: true },
      options: {
        mode: opt("Quality", ["720p", "1080p"]),
        orientation: opt("Character orientation", ["video", "image"], "video", { video: "Follow the video", image: "Keep the image's pose" }),
        seconds: derivedOpt("Motion length (s)", range(3, 30), 5),
      },
      inputs: {
        character_image: image("Your character", { mime: JPG_PNG, minSide: 341, hint: "JPG or PNG with a visible face and body" }),
        motion_video: video("Motion to copy", { minSeconds: 3, maxSeconds: 30, minSide: 341, aspectMin: 0.4, aspectMax: 2.5, hint: "MP4 or MOV, 3–30 s, head, shoulders and torso visible" }),
      },
      modes: [{ id: "motion", label: "Copy motion", uses: ["motion_video", "character_image"], requires: ["motion_video", "character_image"] }],
      derived: { seconds: { from: "motion_video" } },
      rules: [{ slot: "motion_video", when: { orientation: "image" }, maxSeconds: 10, message: "With “Keep the image's pose” the motion video can be up to 10 seconds." }],
      fixed: { length: "The clip follows the length of the motion video." },
      typical: 240,
    }),
    cost: { schedule: perSecond(["mode"], { "720p": 11, "1080p": 18 }, "seconds"), note: "KIE price list: kling 2.6 motion control, 720P/1080P = 11/18 credits per second of the motion video." },
  },
  {
    id: "kling-2-5-turbo", tool: "video", name: "Kling 2.5 Turbo Pro", family: "Kling 2.5", variant: "Turbo Pro", badges: [], sort: 304,
    purpose: "Kling 2.5 Turbo Pro from text or start/end frames, 5 or 10 s.",
    kie: { model: "kling/v2-5-turbo-text-to-video-pro;frames=kling/v2-5-turbo-image-to-video-pro", adapter: "kie-kling-2", docs: docs("market/kling/v25-turbo-text-to-video-pro") },
    spec: videoSpec({
      prompt: { max: 2500 },
      options: { duration: duration([5, 10]), aspect_ratio: aspect(AR3) },
      inputs: { first_frame: first(KLING), last_frame: last(KLING) },
      modes: [textMode(), framesMode()],
      fixed: { aspect: FRAME_SHAPE },
      typical: 150,
    }),
    cost: { schedule: perOutput(["duration"], { 5: 42, 10: 84 }), note: "KIE price list: kling 2.5 turbo, text/image-to-video, Turbo Pro 5 s/10 s = 42/84 credits per video." },
  },
  {
    id: "kling-2-1-master", tool: "video", name: "Kling 2.1 Master", family: "Kling 2.1", variant: "Master", badges: ["premium"], sort: 305,
    purpose: "Kling 2.1 Master from text or a start frame, 5 or 10 s.",
    kie: { model: "kling/v2-1-master-text-to-video;image=kling/v2-1-master-image-to-video", adapter: "kie-kling-2", docs: docs("market/kling/v2-1-master-text-to-video") },
    spec: videoSpec({
      options: { duration: duration([5, 10]), aspect_ratio: aspect(AR3) },
      inputs: { first_frame: first(KLING) },
      modes: [textMode(), imageMode()],
      fixed: { aspect: FRAME_SHAPE },
      typical: 240,
    }),
    cost: { schedule: perOutput(["duration"], { 5: 160, 10: 320 }), note: "KIE price list: Kling 2.1, text/image-to-video, Master 5 s/10 s = 160/320 credits per video." },
  },
  {
    id: "kling-2-1-pro", tool: "video", name: "Kling 2.1 Pro", family: "Kling 2.1", variant: "Pro", badges: [], sort: 306,
    purpose: "Kling 2.1 Pro animates a start frame (optionally to an end frame), 5 or 10 s.",
    kie: { model: "kling/v2-1-pro", adapter: "kie-kling-2", docs: docs("market/kling/v2-1-pro") },
    spec: videoSpec({
      options: { duration: duration([5, 10]) },
      inputs: { first_frame: firstFrame(KLING), last_frame: last(KLING) },
      modes: [framesMode()],
      fixed: { aspect: FRAME_SHAPE },
      typical: 180,
    }),
    cost: { schedule: perOutput(["duration"], { 5: 50, 10: 100 }), note: "KIE price list: Kling 2.1, video-generation, Pro 5 s/10 s = 50/100 credits per video." },
  },
  {
    id: "kling-2-1-standard", tool: "video", name: "Kling 2.1 Standard", family: "Kling 2.1", variant: "Standard", badges: ["budget"], sort: 307,
    purpose: "Kling 2.1 Standard animates a start frame, 5 or 10 s.",
    kie: { model: "kling/v2-1-standard", adapter: "kie-kling-2", docs: docs("market/kling/v2-1-standard") },
    spec: videoSpec({
      options: { duration: duration([5, 10]) },
      inputs: { first_frame: firstFrame(KLING) },
      modes: [imageMode()],
      fixed: { aspect: FRAME_SHAPE },
      typical: 150,
    }),
    cost: { schedule: perOutput(["duration"], { 5: 25, 10: 50 }), note: "KIE price list: Kling 2.1, video-generation, Standard 5 s/10 s = 25/50 credits per video." },
  },
  ...["standard", "pro"].map((tier, i) => {
    const pro = tier === "pro";
    return {
      id: `kling-avatar-${tier}`, tool: "video", name: `Kling AI Avatar ${pro ? "Pro" : "Standard"}`, family: "Kling Avatar", variant: pro ? "Pro" : "Standard",
      badges: [], sort: 340 + i,
      purpose: `Makes a portrait speak your audio with Kling AI Avatar (${pro ? "1080p" : "720p"}); the video is as long as the audio.`,
      kie: { model: `kling/ai-avatar-${tier}`, adapter: "kie-kling-avatar", docs: docs(`market/kling/ai-avatar-${tier}`) },
      spec: videoSpec({
        jobKind: "avatar", operation: "avatar",
        options: { seconds: derivedOpt("Audio length (s)", range(1, 60), 5) },
        inputs: {
          portrait_image: image("Portrait", { mime: JPG_PNG, hint: "JPG or PNG with a clear face" }),
          speech_audio: audioSlot("Speech audio", { mime: AUDIO_MIME, maxSeconds: 60, hint: "MP3, WAV or M4A, up to 60 s" }),
        },
        modes: [{ id: "avatar", label: "Talking portrait", uses: ["portrait_image", "speech_audio"], requires: ["portrait_image", "speech_audio"] }],
        derived: { seconds: { from: "speech_audio" } },
        fixed: { length: "The video is as long as the audio.", resolution: pro ? "1080p output." : "720p output." },
        typical: 300,
      }),
      cost: { schedule: perSecond([], { "": pro ? 16 : 8 }, "seconds"), note: `KIE price list: Kling AI Avatar, ${pro ? "Pro-1080p" : "Standard-720p"} = ${pro ? 16 : 8} credits per second of audio (up to 5 minutes; Genlixs allows 60 s).` },
    };
  }),

  // ---------------------------------------------------------------- ByteDance
  ...[
    { id: "seedance-2-0", name: "Seedance 2.0", variant: "2.0", model: "bytedance/seedance-2", sort: 310, badges: [],
      res: ["480p", "720p", "1080p", "4k"], rates: { "480p|no": 19, "480p|yes": 11.5, "720p|no": 41, "720p|yes": 25, "1080p|no": 102, "1080p|yes": 62, "4k|no": 208, "4k|yes": 128 },
      note: "KIE price list: bytedance/seedance-2, no video input 480p/720p/1080p/4K = 19/41/102/208, with video input = 11.5/25/62/128 credits per second; with reference videos the billed seconds are reference-video seconds + output seconds." },
    { id: "seedance-2-0-mini", name: "Seedance 2.0 Mini", variant: "2.0 Mini", model: "bytedance/seedance-2-mini", sort: 311, badges: ["budget"],
      res: ["480p", "720p"], rates: { "480p|no": 3.8, "480p|yes": 2.4, "720p|no": 8.2, "720p|yes": 5 },
      note: "KIE price list: bytedance/seedance-2-mini, no video 480P/720P = 3.8/8.2, with video = 2.4/5 credits per second; with reference videos the billed seconds are reference-video seconds + output seconds." },
  ].map((m) => ({
    id: m.id, tool: "video", name: m.name, family: "Seedance", variant: m.variant, badges: m.badges, sort: m.sort,
    purpose: `ByteDance ${m.name}: text, first/last frame, or references (images, videos, audio), 4–15 s.`,
    kie: { model: m.model, adapter: "kie-seedance-2-v3", docs: docs(`market/bytedance/${m.model.split("/")[1]}`) },
    spec: videoSpec({
      options: {
        audio: audio(), resolution: resolution(m.res, "720p", { "4k": "4K" }), duration: duration([4, 5, 6, 8, 10, 12, 15], 5),
        aspect_ratio: aspect(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"]),
        with_video: derivedOpt("Reference video", ["no", "yes"], "no", { no: "No", yes: "Yes" }),
        billed: derivedOpt("Billed seconds", range(4, 30), 5),
      },
      inputs: {
        first_frame: firstFrame({ maxSide: 6000 }), last_frame: lastFrame({ maxSide: 6000 }),
        reference_images: referenceImages(9, { maxSide: 6000 }),
        reference_videos: video("Reference videos", { max: 3, minSeconds: 2, maxSeconds: 15, totalMaxSeconds: 15, minSide: 300, maxSide: 6000, aspectMin: 0.4, aspectMax: 2.5,
          minPixels: 409600, maxPixels: 927408, fpsMin: 24, fpsMax: 60, hint: "MP4 or MOV, 480p or 720p, 2–15 s each, 15 s together" }),
        reference_audio: audioSlot("Reference audio", { max: 3, minSeconds: 2, maxSeconds: 15, totalMaxSeconds: 15 }),
      },
      modes: [textMode(), framesMode("First and last frame"),
        referenceMode(["reference_images", "reference_videos", "reference_audio"], "References"),
        { id: "video", label: "Reference videos", uses: ["reference_videos", "reference_audio"], requires: ["reference_videos"] }],
      combineMessage: "Seedance uses either a first/last frame or references (images, videos and audio), not both.",
      derived: { with_video: { kind: "present", from: ["reference_videos"] }, billed: { kind: "billed_seconds", from: ["reference_videos"], plus: "duration" } },
      fixed: { billing: "With reference videos, their length is billed together with the clip's length." },
      typical: 150,
    }),
    cost: { schedule: perSecond(["resolution", "with_video"], m.rates, "billed"), note: m.note },
  })),
  {
    id: "seedance-1-0-pro", tool: "video", name: "Seedance 1.0 Pro", family: "Seedance", variant: "1.0 Pro", badges: [], sort: 312,
    purpose: "ByteDance Seedance 1.0 Pro from text or a start frame, 5 or 10 s, up to 1080p.",
    kie: { model: "bytedance/v1-pro-text-to-video;image=bytedance/v1-pro-image-to-video", adapter: "kie-seedance-1", docs: docs("market/bytedance/v1-pro-text-to-video") },
    spec: videoSpec({
      options: { resolution: resolution(["480p", "720p", "1080p"], "720p"), duration: duration([5, 10]), aspect_ratio: aspect(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"]) },
      inputs: { first_frame: first() },
      modes: [textMode(), imageMode()],
      fixed: { aspect: FRAME_SHAPE },
      typical: 120,
    }),
    cost: { schedule: perSecond(["resolution"], { "480p": 2.8, "720p": 6, "1080p": 14 }), note: "KIE price list: bytedance/seedance-v1-pro, text/image-to-video, 480p/720p/1080p = 2.8/6/14 credits per second." },
  },
  {
    id: "seedance-1-0-lite", tool: "video", name: "Seedance 1.0 Lite", family: "Seedance", variant: "1.0 Lite", badges: ["budget"], sort: 313,
    purpose: "ByteDance Seedance 1.0 Lite from text or start/end frames, 5 or 10 s.",
    kie: { model: "bytedance/v1-lite-text-to-video;frames=bytedance/v1-lite-image-to-video", adapter: "kie-seedance-1", docs: docs("market/bytedance/v1-lite-text-to-video") },
    spec: videoSpec({
      options: { resolution: resolution(["480p", "720p", "1080p"], "720p"), duration: duration([5, 10]), aspect_ratio: aspect(["16:9", "9:16", "1:1", "4:3", "3:4", "9:21"]) },
      inputs: { first_frame: first(), last_frame: last() },
      modes: [textMode(), framesMode()],
      fixed: { aspect: FRAME_SHAPE },
      typical: 100,
    }),
    cost: { schedule: perSecond(["resolution"], { "480p": 2, "720p": 4.5, "1080p": 10 }), note: "KIE price list: bytedance/seedance-v1-lite, text/image-to-video, 480p/720p/1080p = 2/4.5/10 credits per second." },
  },
  {
    id: "seedance-1-0-pro-fast", tool: "video", name: "Seedance 1.0 Pro Fast", family: "Seedance", variant: "1.0 Pro Fast", badges: ["fast"], sort: 314,
    purpose: "ByteDance Seedance 1.0 Pro Fast animates a start frame, 5 or 10 s.",
    kie: { model: "bytedance/v1-pro-fast-image-to-video", adapter: "kie-seedance-1", docs: docs("market/bytedance/v1-pro-fast-image-to-video") },
    spec: videoSpec({
      options: { resolution: resolution(["720p", "1080p"]), duration: duration([5, 10]) },
      inputs: { first_frame: firstFrame() },
      modes: [imageMode()],
      fixed: { aspect: FRAME_SHAPE },
      typical: 90,
    }),
    cost: { schedule: perOutput(["resolution", "duration"], { "720p|5": 16, "720p|10": 36, "1080p|5": 36, "1080p|10": 72 }), note: "KIE price list: bytedance/seedance-v1-pro-fast, image-to-video, 720p 5 s/10 s = 16/36, 1080p = 36/72 credits per video." },
  },

  // ---------------------------------------------------------------- MiniMax / Hailuo
  {
    id: "hailuo-02-standard", tool: "video", name: "Hailuo 02 Standard", family: "Hailuo 02", variant: "Standard", badges: ["budget"], sort: 315,
    purpose: "MiniMax Hailuo 02 Standard from text (768p) or start/end frames (512p or 768p), 6 or 10 s.",
    kie: { model: "hailuo/02-text-to-video-standard;frames=hailuo/02-image-to-video-standard", adapter: "kie-hailuo", docs: docs("market/hailuo/02-text-to-video-standard") },
    spec: videoSpec({
      prompt: { max: 1500 },
      options: { resolution: resolution(["768P", "512P"], "768P", { "768P": "768p", "512P": "512p" }), duration: duration([6, 10]) },
      inputs: { first_frame: firstFrame(), last_frame: last() },
      modes: [{ ...textMode(), allowed: { resolution: ["768P"] }, allowedMessage: "Text-to-video is 768p only; 512p needs a start frame." }, framesMode()],
      typical: 180,
    }),
    cost: { schedule: perOutput(["resolution", "duration"], { "768P|6": 30, "768P|10": 50, "512P|6": 12, "512P|10": 20 }), note: "KIE price list: hailuo 02 Standard, 768p 6 s/10 s = 30/50, 512p 6 s/10 s = 12/20 credits per video." },
  },
  {
    id: "hailuo-02-pro", tool: "video", name: "Hailuo 02 Pro", family: "Hailuo 02", variant: "Pro", badges: [], sort: 316,
    purpose: "MiniMax Hailuo 02 Pro from text or start/end frames: 6-second clips at 1080p.",
    kie: { model: "hailuo/02-text-to-video-pro;frames=hailuo/02-image-to-video-pro", adapter: "kie-hailuo", docs: docs("market/hailuo/02-text-to-video-pro") },
    spec: videoSpec({
      prompt: { max: 1500 },
      options: {},
      inputs: { first_frame: firstFrame(), last_frame: last() },
      modes: [textMode(), framesMode()],
      fixed: { length: "6-second clips at 1080p." },
      typical: 240,
    }),
    cost: { schedule: perOutput([], { "": 57 }), note: "KIE price list: hailuo 02, text/image-to-video, Pro-6.0s-1080p = 57 credits per video." },
  },
  ...[
    { tier: "standard", name: "Hailuo 2.3 Standard", variant: "Standard", sort: 317, badges: [], rates: { "768P|6": 30, "768P|10": 50, "1080P|6": 50 }, note: "Standard 768p 6 s/10 s = 30/50, 1080p 6 s = 50" },
    { tier: "pro", name: "Hailuo 2.3 Pro", variant: "Pro", sort: 318, badges: ["premium"], rates: { "768P|6": 45, "768P|10": 90, "1080P|6": 80 }, note: "Pro 768p 6 s/10 s = 45/90, 1080p 6 s = 80" },
  ].map((m) => ({
    id: `hailuo-2-3-${m.tier}`, tool: "video", name: m.name, family: "Hailuo 2.3", variant: m.variant, badges: m.badges, sort: m.sort,
    purpose: `MiniMax ${m.name} animates a start frame: 6 or 10 s at 768p, 6 s at 1080p.`,
    kie: { model: `hailuo/2-3-image-to-video-${m.tier}`, adapter: "kie-hailuo", docs: docs(`market/hailuo/2-3-image-to-video-${m.tier}`) },
    spec: videoSpec({
      options: { resolution: resolution(["768P", "1080P"], "768P", { "768P": "768p", "1080P": "1080p" }), duration: duration([6, 10]) },
      inputs: { first_frame: firstFrame() },
      modes: [imageMode()],
      exclude: [{ resolution: "1080P", duration: 10 }],
      excludeMessage: "10-second clips are available at 768p only.",
      fixed: { aspect: FRAME_SHAPE },
      typical: 200,
    }),
    cost: { schedule: perOutput(["resolution", "duration"], m.rates), note: `KIE price list: hailuo 2.3, image-to-video, ${m.note} credits per video.` },
  })),
  {
    id: "minimax-h3", tool: "video", name: "MiniMax H3", family: "MiniMax H3", variant: null, badges: [], sort: 319,
    purpose: "MiniMax H3: text, first/last frame, or references (up to 5 images, 3 videos, 3 audio clips), 4–15 s, with sound.",
    kie: {
      model: "minimax-h3/text-to-video;frames=minimax-h3/image-to-video;reference=minimax-h3/reference-to-video;video=minimax-h3/reference-to-video",
      adapter: "kie-minimax-h3", docs: docs("market/minimax-h3/text-to-video"),
    },
    spec: videoSpec({
      options: {
        resolution: resolution(["768P", "2K"], "768P", { "768P": "768p" }), duration: duration([4, 5, 6, 8, 10, 12, 15], 6),
        aspect_ratio: aspect(["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"]),
        billed: derivedOpt("Billed seconds", range(4, 30), 6),
      },
      inputs: {
        first_frame: firstFrame({ minSide: 256, hides: ["aspect_ratio"] }), last_frame: lastFrame({ minSide: 256 }),
        reference_images: referenceImages(5, { minSide: 256, maxSide: 5760, hint: "Up to 5 images" }),
        reference_videos: video("Reference videos", { max: 3, minSeconds: 2, maxSeconds: 15, totalMaxSeconds: 15, minSide: 256, maxSide: 5760, aspectMin: 0.4, aspectMax: 2.5,
          fpsMin: 24, fpsMax: 60, hint: "MP4 or MOV, 2–15 s each, 15 s together" }),
        reference_audio: audioSlot("Reference audio", { max: 3, minSeconds: 2, maxSeconds: 15, totalMaxSeconds: 15 }),
      },
      modes: [
        { ...textMode(), allowed: { aspect_ratio: ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9"] }, allowedMessage: "“Match input” needs reference images or videos." },
        framesMode("First and last frame"),
        referenceMode(["reference_images", "reference_videos", "reference_audio"], "References"),
        { id: "video", label: "Reference videos", uses: ["reference_videos", "reference_audio"], requires: ["reference_videos"] },
      ],
      combineMessage: "Use either a first/last frame or references, not both.",
      derived: { billed: { kind: "billed_seconds", from: ["reference_videos"], plus: "duration" } },
      fixed: { audio: SOUND_ALWAYS, billing: "Reference videos are billed by their length together with the clip's length." },
      typical: 200,
    }),
    cost: { schedule: perSecond(["resolution"], { "768P": 8, "2K": 13 }, "billed"), note: "KIE price list: MiniMax H3, 768p/2K = 8/13 credits per second; reference-video whole seconds billed at the same rate and added; the first 5 reference images and reference audio are free." },
  },

  // ---------------------------------------------------------------- Alibaba Wan
  {
    id: "wan-2-5", tool: "video", name: "Wan 2.5", family: "Wan", variant: "2.5", badges: [], sort: 320,
    purpose: "Alibaba Wan 2.5 from text or a start frame, 5 or 10 s, 720p or 1080p.",
    kie: { model: "wan/2-5-text-to-video;image=wan/2-5-image-to-video", adapter: "kie-wan-2-5", docs: docs("market/wan/2-5-text-to-video") },
    spec: videoSpec({
      prompt: { max: 800 },
      options: { resolution: resolution(["720p", "1080p"]), duration: duration([5, 10]), aspect_ratio: aspect(AR3) },
      inputs: { first_frame: first() },
      modes: [textMode(), imageMode()],
      fixed: { aspect: FRAME_SHAPE },
      typical: 150,
    }),
    cost: { schedule: perOutput(["resolution", "duration"], { "720p|5": 60, "720p|10": 120, "1080p|5": 100, "1080p|10": 200 }), note: "KIE price list: wan 2.5, text/image-to-video, 720p 5 s/10 s = 60/120, 1080p = 100/200 credits per video." },
  },
  {
    id: "wan-2-6-flash", tool: "video", name: "Wan 2.6 Flash", family: "Wan", variant: "2.6 Flash", badges: ["fast"], sort: 322,
    purpose: "Alibaba Wan 2.6 Flash from a start frame (5–15 s) or reference videos (5 or 10 s), with or without sound.",
    kie: { model: "wan/2-6-flash-image-to-video;video=wan/2-6-flash-video-to-video", adapter: "kie-wan-2-6-flash", docs: docs("market/wan/2-6-flash-image-to-video") },
    spec: videoSpec({
      prompt: { max: 1500 },
      options: { audio: audio(), resolution: resolution(["720p", "1080p"]), duration: duration([5, 10, 15]) },
      inputs: {
        first_frame: firstFrame({ minSide: 256 }),
        reference_videos: video("Reference videos", { max: 3, maxBytes: 10 * 1024 * 1024, hint: "Up to 3 clips of 10 MB; the subject is placed in the scene you describe" }),
      },
      modes: [imageMode(), { id: "video", label: "Reference videos", uses: ["reference_videos"], requires: ["reference_videos"], allowed: { duration: [5, 10] }, allowedMessage: "With reference videos the clip is 5 or 10 seconds." }],
      combineMessage: "Use either a start frame or reference videos, not both.",
      fixed: { aspect: FRAME_SHAPE },
      typical: 120,
    }),
    cost: {
      schedule: perOutput(["audio", "resolution", "duration"], {
        "off|720p|5": 20, "off|720p|10": 40, "off|720p|15": 60, "on|720p|5": 40, "on|720p|10": 80, "on|720p|15": 120,
        "off|1080p|5": 30, "off|1080p|10": 60, "off|1080p|15": 90, "on|1080p|5": 60, "on|1080p|10": 120, "on|1080p|15": 180,
      }),
      note: "KIE price list: wan 2.6 flash, image-to-video and video-to-video, per video by sound, resolution and length (720p 20/40/60 without, 40/80/120 with audio; 1080p 30/60/90 and 60/120/180 credits).",
    },
  },
  {
    id: "wan-2-7", tool: "video", name: "Wan 2.7", family: "Wan", variant: "2.7", badges: [], sort: 323,
    purpose: "Alibaba Wan 2.7 from text, start/end frames or up to 5 reference images, 2–15 s.",
    kie: { model: "wan/2-7-text-to-video;frames=wan/2-7-image-to-video;reference=wan/2-7-r2v", adapter: "kie-wan-2-7", docs: docs("market/wan/2-7-text-to-video") },
    spec: videoSpec({
      options: { resolution: resolution(["720p", "1080p"]), duration: duration([2, 5, 8, 10, 15], 5), aspect_ratio: aspect(AR5) },
      inputs: { first_frame: first({ minSide: 240 }), last_frame: last({ minSide: 240 }), reference_images: referenceImages(5, { minSide: 240 }) },
      modes: [textMode(), framesMode(), { ...referenceMode(["reference_images"]), allowed: { duration: [2, 5, 8, 10] }, allowedMessage: "With reference images the clip is at most 10 seconds." }],
      combineMessage: "Use either start and end frames or reference images, not both.",
      fixed: { aspect: FRAME_SHAPE },
      typical: 180,
    }),
    cost: { schedule: perSecond(["resolution"], { "720p": 16, "1080p": 24 }), note: "KIE price list: wan 2.7 video, text-to-video / image-to-video / r2v, 720p/1080p = 16/24 credits per second." },
  },
  {
    id: "wan-2-7-edit", tool: "video", name: "Wan 2.7 Edit", family: "Wan", variant: "2.7 Edit", badges: [], sort: 350,
    purpose: "Edits a 2–10 s video with Alibaba Wan 2.7 from your instruction, optionally guided by an image.",
    kie: { model: "wan/2-7-videoedit", adapter: "kie-wan-2-7-edit", docs: docs("market/wan/2-7-videoedit") },
    spec: videoSpec({
      jobKind: "video_edit", operation: "edit",
      options: {
        resolution: resolution(["720p", "1080p"]),
        audio_setting: opt("Sound", ["auto", "origin"], "auto", { auto: "New sound", origin: "Keep the original sound" }),
        seconds: derivedOpt("Video length (s)", range(2, 10), 5),
      },
      inputs: {
        source_video: sourceVideo({ minSeconds: 2, maxSeconds: 10, maxSide: 4096, aspectMin: 0.125, aspectMax: 8, hint: "MP4 or MOV, 2–10 s" }),
        reference_image: image("Reference image", { minSide: 240, aspectMin: 0.125, aspectMax: 8, hint: "Optional: a character, outfit or style to use" }),
      },
      modes: [{ id: "edit", label: "Edit with a prompt", uses: ["source_video", "reference_image"], requires: ["source_video"] }],
      derived: { seconds: { from: "source_video" } },
      fixed: { length: "The edited video keeps the length of your clip." },
      typical: 240,
    }),
    cost: { schedule: perSecond(["resolution"], { "720p": 16, "1080p": 24 }, "seconds"), note: "KIE price list: wan 2.7 video, videoedit, 720p/1080p = 16/24 credits per second of video (the output keeps the source length)." },
  },
  ...[
    { id: "wan-3-0", name: "Wan 3.0", variant: "3.0", model: "wan/3-0-video", sort: 324, badges: [], rates: { "480P": 8, "720P": 16, "1080P": 32 } },
    { id: "wan-3-0-prime", name: "Wan 3.0 Prime", variant: "3.0 Prime", model: "wan/3-0-video-prime", sort: 325, badges: ["premium"], rates: { "480P": 12.2, "720P": 25.2, "1080P": 50.4 } },
  ].map((m) => ({
    id: m.id, tool: "video", name: m.name, family: "Wan", variant: m.variant, badges: m.badges, sort: m.sort,
    purpose: `Alibaba ${m.name}: text, first/last frame, or references (up to 10 images, 5 videos, 5 audio clips), 2–30 s.`,
    kie: { model: m.model, adapter: "kie-wan-3", docs: docs(`market/wan/${m.model === "wan/3-0-video" ? "3-0-video" : "3-0-video-prime"}`) },
    spec: videoSpec({
      options: {
        audio: audio(), resolution: resolution(["480P", "720P", "1080P"], "720P", { "480P": "480p", "720P": "720p", "1080P": "1080p" }),
        duration: duration([2, 5, 8, 10, 15, 20, 30], 5), aspect_ratio: aspect(["16:9", "9:16", "1:1", "4:3", "3:4", "adaptive"]),
        billed: derivedOpt("Billed seconds", range(2, 30), 5),
      },
      inputs: {
        first_frame: firstFrame({ minSide: 240 }), last_frame: lastFrame({ minSide: 240 }),
        reference_images: referenceImages(10, { minSide: 240 }),
        reference_videos: video("Reference videos", { max: 5, minSeconds: 1, maxSeconds: 15, totalMaxSeconds: 15, minSide: 240, maxSide: 4096, hint: "1–15 s each, 15 s together; clip + videos at most 30 s" }),
        reference_audio: audioSlot("Reference audio", { max: 5, minSeconds: 1, maxSeconds: 15, totalMaxSeconds: 15 }),
      },
      modes: [textMode(), framesMode("First and last frame"),
        referenceMode(["reference_images", "reference_videos", "reference_audio"], "References"),
        { id: "video", label: "Reference videos", uses: ["reference_videos", "reference_audio"], requires: ["reference_videos"] },
        { id: "audio", label: "Reference audio", uses: ["reference_audio"], requires: ["reference_audio"] }],
      combineMessage: "Use either a first/last frame or references, not both.",
      derived: { billed: { kind: "billed_seconds", from: ["reference_videos"], plus: "duration" } },
      fixed: { billing: "Reference videos are billed by their length together with the clip's length (30 s at most in total)." },
      typical: 240,
    }),
    cost: { schedule: perSecond(["resolution"], m.rates, "billed"), note: `KIE price list: ${m.model.replace("wan/", "wan ")}, 480p/720p/1080p = ${Object.values(m.rates).join("/")} credits per second; billed seconds = output + reference-video seconds.` },
  })),

  // ---------------------------------------------------------------- PixVerse
  {
    id: "pixverse-v6", tool: "video", name: "PixVerse V6", family: "PixVerse", variant: "V6", badges: [], sort: 326,
    purpose: "PixVerse V6: text, a start frame, a start-to-end transition or up to 7 subject images, 1–15 s, optional sound.",
    kie: {
      model: "pixverse-v6/text-to-video;image=pixverse-v6/image-to-video;frames=pixverse-v6/transition;reference=pixverse-v6/reference-to-video",
      adapter: "kie-pixverse-6", docs: docs("market/pixverse/text-to-video"),
    },
    spec: videoSpec({
      options: {
        audio: audio("off"), resolution: resolution(["360p", "540p", "720p", "1080p"], "720p"), duration: duration([3, 5, 8, 10, 15], 5),
        aspect_ratio: aspect(["16:9", "9:16", "1:1", "4:3", "3:4", "2:3", "3:2", "21:9"]),
      },
      inputs: {
        first_frame: first(), last_frame: last(),
        reference_images: referenceImages(7, { hint: "Subjects; mention them as @ref1, @ref2, … in order" }),
      },
      modes: [textMode(), imageMode(), { id: "frames", label: "Start-to-end transition", uses: ["first_frame", "last_frame"], requires: ["first_frame", "last_frame"] },
        referenceMode(["reference_images"], "Subject images")],
      combineMessage: "Use either frames or subject images, not both.",
      fixed: { aspect: FRAME_SHAPE },
      typical: 120,
    }),
    cost: { schedule: perSecond(["resolution", "audio"], pixverseRates), note: "KIE price list: pixverse-v6, text/image-to-video, transition and reference: 360p 4/5.6, 540p 5.6/7.2, 720p 7.2/9.6, 1080p 14.4/18.4 credits per second (no audio/with audio)." },
  },
  {
    id: "pixverse-v6-extend", tool: "video", name: "PixVerse V6 Extend", family: "PixVerse", variant: "V6 Extend", badges: [], sort: 360,
    purpose: "Continues a video with PixVerse V6, guided by a prompt, 1–15 s.",
    kie: { model: "pixverse-v6/extend", adapter: "kie-pixverse-extend", docs: docs("market/pixverse/extend") },
    spec: videoSpec({
      jobKind: "video_extend", operation: "extend",
      options: { audio: audio("off"), resolution: resolution(["360p", "540p", "720p", "1080p"], "720p"), duration: duration([3, 5, 8, 10, 15], 5) },
      inputs: { source_video: video("Video to extend", { maxSeconds: 30, hint: "MP4 or MOV, up to 30 s" }) },
      modes: [{ id: "extend", label: "Extend a video", uses: ["source_video"], requires: ["source_video"] }],
      fixed: { output: "The result is the new continuation clip." },
      typical: 150,
    }),
    cost: { schedule: perSecond(["resolution", "audio"], pixverseRates), note: "KIE price list: pixverse-v6, Extend: 360p 4/5.6, 540p 5.6/7.2, 720p 7.2/9.6, 1080p 14.4/18.4 credits per second of the extension (no audio/with audio)." },
  },

  // ---------------------------------------------------------------- xAI Grok
  {
    id: "grok-imagine-video", tool: "video", name: "Grok Imagine Video", family: "Grok Imagine", variant: "Video", badges: ["budget"], sort: 327,
    purpose: "xAI Grok Imagine video from text, a start image or 2–7 reference images, 6–30 s, with sound.",
    kie: { model: "grok-imagine/text-to-video;image=grok-imagine/image-to-video;reference=grok-imagine/image-to-video", adapter: "kie-grok-video", docs: docs("market/grok-imagine/text-to-video") },
    spec: videoSpec({
      options: {
        style: opt("Style", ["normal", "fun"], "normal", { normal: "Normal", fun: "Fun" }), resolution: resolution(["480p", "720p", "1080p"], "720p"),
        duration: duration([6, 10, 15, 20, 30], 6), aspect_ratio: aspect(["16:9", "9:16", "1:1", "2:3", "3:2"]),
      },
      inputs: { first_frame: first({ label: "Start image" }), reference_images: referenceImages(7, { min: 2, hint: "2–7 images; mention them as @image1, @image2, …" }) },
      modes: [textMode(), imageMode("Start image"), { ...referenceMode(["reference_images"]), allowed: { resolution: ["480p", "720p"] }, allowedMessage: "Several images work at 480p or 720p." }],
      combineMessage: "Use either a start image or reference images, not both.",
      fixed: { audio: SOUND_ALWAYS },
      typical: 120,
    }),
    cost: { schedule: perSecond(["resolution"], { "480p": 2.4, "720p": 4.5, "1080p": 8 }), note: "KIE price list: grok-imagine, text/image-to-video, 480p/720p/1080p = 2.4/4.5/8 credits per second." },
  },
  {
    id: "grok-imagine-video-1-5", tool: "video", name: "Grok Imagine Video 1.5 Preview", family: "Grok Imagine", variant: "Video 1.5 Preview", badges: [], sort: 328,
    purpose: "xAI Grok Imagine Video 1.5 (preview) animates one image, 1–15 s, 480p or 720p.",
    kie: { model: "grok-imagine-video-1-5-preview", adapter: "kie-grok-video-1-5", docs: docs("market/grok-imagine/1-5-preview") },
    spec: videoSpec({
      options: { resolution: resolution(["480p", "720p"], "720p"), duration: duration([3, 5, 8, 10, 15], 8) },
      inputs: { first_frame: firstFrame({ label: "Image" }) },
      modes: [imageMode("Image to video")],
      fixed: { audio: SOUND_ALWAYS },
      typical: 120,
    }),
    cost: { schedule: perSecond(["resolution"], { "480p": 2.4, "720p": 4.5 }), note: "KIE price list: grok-imagine-video-1-5-preview, 480p/720p = 2.4/4.5 credits per second (1080p is not priced, so it is not offered)." },
  },

  // ---------------------------------------------------------------- Runway
  {
    id: "runway-gen-4-turbo", tool: "video", name: "Runway Gen-4 Turbo", family: "Runway", variant: "Gen-4 Turbo", badges: [], sort: 329,
    purpose: "Runway Gen-4 Turbo from text or a start image: 5 or 10 s at 720p, 5 s at 1080p.",
    kie: { model: "runway", adapter: "kie-runway", docs: docs("runway-api/generate-ai-video") },
    spec: videoSpec({
      options: { resolution: resolution(["720p", "1080p"]), duration: duration([5, 10]), aspect_ratio: aspect(["16:9", "9:16", "1:1", "4:3", "3:4"]) },
      inputs: { first_frame: first({ label: "Start image" }) },
      modes: [textMode(), imageMode("Start image")],
      exclude: [{ resolution: "1080p", duration: 10 }],
      excludeMessage: "10-second clips are 720p only.",
      fixed: { aspect: FRAME_SHAPE },
      typical: 90,
    }),
    cost: { schedule: perOutput(["resolution", "duration"], { "720p|5": 12, "720p|10": 30, "1080p|5": 30 }), note: "KIE price list: Runway, text/image-to-video, 720p 5 s/10 s = 12/30, 1080p 5 s = 30 credits per video (kie.ai/runway-api: Gen-4 Turbo)." },
  },
  {
    id: "runway-gen-4-turbo-extend", tool: "video", name: "Runway Gen-4 Turbo Extend", family: "Runway", variant: "Extend", badges: [], sort: 361,
    purpose: "Continues one of your 720p Runway Gen-4 Turbo videos by about 5 seconds.",
    kie: { model: "runway/extend-ai-video", adapter: "kie-runway-extend", docs: docs("runway-api/extend-ai-video") },
    spec: videoSpec({
      jobKind: "video_extend", operation: "extend",
      options: { resolution: resolution(["720p", "1080p"]) },
      inputs: { source_job: { kind: "job", label: "Video to extend", min: 1, max: 1, families: ["Runway"], maxAgeDays: 13, hint: "One of your 720p Runway videos from the last 13 days" } },
      modes: [{ id: "extend", label: "Extend a video", uses: ["source_job"], requires: ["source_job"] }],
      fixed: { output: "The result is your clip followed by about 5 more seconds; videos made at 1080p cannot be extended." },
      typical: 120,
    }),
    cost: { schedule: perOutput(["resolution"], { "720p": 12, "1080p": 30 }), note: "KIE price list: Runway, extend-ai-video, 720p/1080p = 12/30 credits per extension." },
  },

  // ---------------------------------------------------------------- Alibaba HappyHorse
  ...[
    { id: "happyhorse-1-0", name: "HappyHorse 1.0", variant: "1.0", prefix: "happyhorse", sort: 331, rates: { "720p": 28, "1080p": 48 }, ar: AR5 },
    { id: "happyhorse-1-1", name: "HappyHorse 1.1", variant: "1.1", prefix: "happyhorse-1-1", sort: 332, rates: { "720p": 22.5, "1080p": 29 }, ar: [...AR5, "4:5", "5:4", "9:21", "21:9"] },
  ].map((m) => ({
    id: m.id, tool: "video", name: m.name, family: "HappyHorse", variant: m.variant, badges: [], sort: m.sort,
    purpose: `Alibaba ${m.name} from text, a start frame or up to 9 character images, 3–15 s.`,
    kie: { model: `${m.prefix}/text-to-video;image=${m.prefix}/image-to-video;reference=${m.prefix}/reference-to-video`, adapter: "kie-happyhorse", docs: docs(`market/${m.prefix}/text-to-video`) },
    spec: videoSpec({
      options: { resolution: resolution(["720p", "1080p"], "1080p"), duration: duration([3, 5, 8, 10, 15], 5), aspect_ratio: aspect(m.ar) },
      inputs: { first_frame: first(), reference_images: referenceImages(9, { minSide: 400, hint: "Characters in order (character1, character2, …)" }) },
      modes: [textMode(), imageMode(), referenceMode(["reference_images"], "Character images")],
      combineMessage: "Use either a start frame or character images, not both.",
      fixed: { aspect: FRAME_SHAPE },
      typical: 180,
    }),
    cost: { schedule: perSecond(["resolution"], m.rates), note: `KIE price list: ${m.name}, text/image/reference-to-video, 720p/1080p = ${m.rates["720p"]}/${m.rates["1080p"]} credits per second.` },
  })),
  {
    id: "happyhorse-1-0-edit", tool: "video", name: "HappyHorse 1.0 Edit", family: "HappyHorse", variant: "1.0 Edit", badges: [], sort: 351,
    purpose: "Edits a 3–60 s video with Alibaba HappyHorse 1.0 (style changes, replacements), optionally guided by images.",
    kie: { model: "happyhorse/video-edit", adapter: "kie-happyhorse-edit", docs: docs("market/happyhorse/video-edit") },
    spec: videoSpec({
      jobKind: "video_edit", operation: "edit",
      options: {
        resolution: resolution(["720p", "1080p"], "1080p"),
        audio_setting: opt("Sound", ["auto", "origin"], "auto", { auto: "New sound", origin: "Keep the original sound" }),
        seconds: derivedOpt("Video length (s)", range(3, 60), 5),
      },
      inputs: {
        source_video: sourceVideo({ minSeconds: 3, maxSeconds: 60, minSide: 320, maxSide: 2160, aspectMin: 0.4, aspectMax: 2.5, fpsMin: 9, hint: "MP4 or MOV, 3–60 s" }),
        reference_images: referenceImages(5, { hint: "Optional: up to 5 images to guide the change" }),
      },
      modes: [{ id: "edit", label: "Edit with a prompt", uses: ["source_video", "reference_images"], requires: ["source_video"] }],
      derived: { seconds: { from: "source_video" } },
      fixed: { length: "The edited video keeps the length of your clip.", billing: "Billed on the source length plus the output length." },
      typical: 300,
    }),
    cost: { schedule: perSecond(["resolution"], { "720p": 28, "1080p": 48 }, "seconds", { secondsFactor: 2 }), note: "KIE price list: HappyHorse-1.0, video-edit, 720p/1080p = 28/48 credits per second, billed on input + output seconds (output = input length)." },
  },

  // ---------------------------------------------------------------- Google Gemini Omni
  {
    id: "gemini-omni-video", tool: "video", name: "Gemini Omni Video", family: "Gemini Omni", variant: null, badges: [], sort: 333,
    purpose: "Google Gemini Omni video from text or up to 7 reference images, 4–10 s, up to 4K.",
    kie: { model: "gemini-omni-video", adapter: "kie-gemini-omni", docs: docs("market/gemini-omni-video") },
    spec: videoSpec({
      options: { resolution: resolution(["720p", "1080p", "4k"], "720p", { "4k": "4K" }), duration: duration([4, 6, 8, 10], 6), aspect_ratio: aspect(["16:9", "9:16"]) },
      inputs: { reference_images: referenceImages(7, { maxBytes: 10 * 1024 * 1024 }) },
      modes: [textMode(), referenceMode(["reference_images"])],
      typical: 240,
    }),
    cost: { schedule: perOutput(["resolution", "duration"], geminiRates(["720p", "1080p", "4k"])), note: "KIE price list: gemini-omni-video without video input, 4/6/8/10 s = 63/84/105/126 credits (720p, 1080p) and 147/168/189/210 (4k) per video." },
  },
  {
    id: "gemini-omni-flash-1-1", tool: "video", name: "Gemini Omni Flash 1.1", family: "Gemini Omni", variant: "Flash 1.1", badges: [], sort: 334,
    purpose: "Google Gemini Omni Flash 1.1 from text, first/last frame or up to 7 reference images, 4–10 s, 360p to 4K.",
    kie: { model: "google/gemini-omni-flash-1-1", adapter: "kie-gemini-omni", docs: docs("market/google/gemini-omni-flash-1-1") },
    spec: videoSpec({
      options: { resolution: resolution(["360p", "720p", "1080p", "4k"], "720p", { "4k": "4K" }), duration: duration([4, 6, 8, 10], 6), aspect_ratio: aspect(["16:9", "9:16"]) },
      inputs: { first_frame: firstFrame(), last_frame: lastFrame(), reference_images: referenceImages(7) },
      modes: [textMode(), framesMode("First and last frame"), referenceMode(["reference_images"])],
      combineMessage: "Use either a first/last frame or reference images, not both.",
      typical: 200,
    }),
    cost: { schedule: perOutput(["resolution", "duration"], geminiRates(["360p", "720p", "1080p", "4k"])), note: "KIE price list: google/gemini-omni-flash-1-1 without video input, 4/6/8/10 s = 63/84/105/126 credits (360p, 720p, 1080p) and 147/168/189/210 (4k) per video." },
  },

  // ---------------------------------------------------------------- avatars, Vidu, tools
  {
    id: "omnihuman-1-5", tool: "video", name: "OmniHuman 1.5", family: "OmniHuman", variant: "1.5", badges: [], sort: 342,
    purpose: "ByteDance OmniHuman 1.5 makes a portrait (people, pets, cartoons) speak or sing your audio, up to 59 s.",
    kie: { model: "omnihuman-1-5", adapter: "kie-omnihuman", docs: docs("market/omnihuman-1-5") },
    spec: videoSpec({
      jobKind: "avatar", operation: "avatar",
      prompt: { min: 0, max: 300, optional: true },
      options: { resolution: resolution(["720p", "1080p"], "1080p"), seconds: derivedOpt("Audio length (s)", range(1, 59), 5) },
      inputs: {
        portrait_image: image("Portrait", { minSide: 0, aspectMin: 0, aspectMax: 0, hint: "Any shape; people, pets or characters" }),
        speech_audio: audioSlot("Speech audio", { mime: AUDIO_MIME, maxSeconds: 59, maxBytes: 10 * 1024 * 1024, hint: "Under 60 s (15 s or less works best), up to 10 MB" }),
      },
      modes: [{ id: "avatar", label: "Talking portrait", uses: ["portrait_image", "speech_audio"], requires: ["portrait_image", "speech_audio"] }],
      derived: { seconds: { from: "speech_audio" } },
      fixed: { length: "The video is as long as the audio." },
      typical: 300,
    }),
    cost: { schedule: perSecond(["resolution"], { "720p": 27, "1080p": 27 }, "seconds"), note: "KIE price list: omnihuman-1-5, lip sync = 27 credits per second of audio (no resolution difference listed)." },
  },
  {
    id: "vidu-q4", tool: "video", name: "Vidu Q4", family: "Vidu", variant: "Q4", badges: [], sort: 335,
    purpose: "Shengshu Vidu Q4 from a start frame or up to 15 reference images (with optional voice clips), 3–16 s, up to 4K.",
    kie: { model: "vidu-q4/image-to-video;reference=vidu-q4/reference-to-video", adapter: "kie-vidu-q4", docs: docs("market/vidu-q4/image-to-video") },
    spec: videoSpec({
      options: {
        audio: audio(), resolution: resolution(["540p", "720p", "1080p", "2k", "4k"], "720p", { "2k": "2K", "4k": "4K" }),
        duration: duration([3, 5, 8, 10, 16], 5), aspect_ratio: aspect(AR5),
      },
      inputs: {
        first_frame: first(),
        reference_images: referenceImages(15),
        reference_audio: audioSlot("Voice clips", { max: 3, mime: MP3, minSeconds: 3, maxSeconds: 12, hint: "MP3, 3–12 s each" }),
      },
      modes: [imageMode(), referenceMode(["reference_images", "reference_audio"])],
      combineMessage: "Use either a start frame or reference images, not both.",
      fixed: { aspect: FRAME_SHAPE },
      typical: 200,
    }),
    cost: { schedule: perSecond(["resolution"], { "540p": 7.2, "720p": 15.2, "1080p": 19.2, "2k": 30.4, "4k": 62.4 }), note: "KIE price list: Vidu Q4, image/reference-to-video, 540p/720p/1080p/2k/4k = 7.2/15.2/19.2/30.4/62.4 credits per second." },
  },
  {
    id: "topaz-video-upscale", tool: "video", name: "Topaz Video Upscale", family: "Topaz", variant: "Video Upscale", badges: [], sort: 352,
    purpose: "Enhances or upscales a video (1×, 2× or 4×) with Topaz; no prompt needed.",
    kie: { model: "topaz/video-upscale", adapter: "kie-topaz-video", docs: docs("market/topaz/video-upscale") },
    spec: videoSpec({
      jobKind: "video_edit", operation: "edit",
      prompt: { min: 0, max: 0, optional: true },
      options: { factor: opt("Upscale", ["1", "2", "4"], "2", { 1: "Enhance (1×)", 2: "2×", 4: "4×" }), seconds: derivedOpt("Video length (s)", range(1, 60), 5) },
      inputs: { source_video: sourceVideo({ label: "Video to upscale", maxSeconds: 60, hint: "MP4 or MOV, up to 60 s and 50 MB" }) },
      modes: [{ id: "edit", label: "Upscale", uses: ["source_video"], requires: ["source_video"] }],
      derived: { seconds: { from: "source_video" } },
      fixed: { length: "The result keeps the length of your clip." },
      typical: 300,
    }),
    cost: { schedule: perSecond(["factor"], { 1: 8, 2: 8, 4: 14 }, "seconds"), note: "KIE price list: Topaz Video Upscaler, 1x/2x = 8, 4x = 14 credits per second of video." },
  },
  ...[
    { id: "wan-2-2-animate-move", name: "Wan 2.2 Animate Move", variant: "2.2 Animate Move", model: "wan/2-2-animate-move", sort: 337, res: ["720p"], rates: { "720p": 12.5 }, video: 50,
      purpose: "Animates your character with the motion of a reference video (Alibaba Wan 2.2 Animate Move, 720p)." },
    { id: "wan-2-2-animate-replace", name: "Wan 2.2 Animate Replace", variant: "2.2 Animate Replace", model: "wan/2-2-animate-replace", sort: 338, res: ["480p", "580p", "720p"],
      rates: { "480p": 6, "580p": 9.5, "720p": 12.5 }, video: 10, purpose: "Replaces the person in a video with your character (Alibaba Wan 2.2 Animate Replace, 480p–720p)." },
  ].map((m) => ({
    id: m.id, tool: "video", name: m.name, family: "Wan", variant: m.variant, badges: [], sort: m.sort,
    purpose: m.purpose,
    kie: { model: m.model, adapter: "kie-wan-animate", docs: docs(`market/${m.model}`) },
    spec: videoSpec({
      jobKind: "motion_control", operation: "motion",
      prompt: { min: 0, max: 0, optional: true },
      options: { resolution: resolution(m.res, m.res[0]), seconds: derivedOpt("Video length (s)", range(1, 30), 5) },
      inputs: {
        character_image: image("Your character", { maxBytes: m.id.endsWith("move") ? 5 * 1024 * 1024 : 10 * 1024 * 1024, minSide: 0, aspectMin: 0, aspectMax: 0 }),
        motion_video: video("Motion video", { maxSeconds: 30, maxBytes: m.video * 1024 * 1024, hint: `MP4 or MOV, up to 30 s and ${m.video} MB` }),
      },
      modes: [{ id: "motion", label: "Animate", uses: ["motion_video", "character_image"], requires: ["motion_video", "character_image"] }],
      derived: { seconds: { from: "motion_video" } },
      fixed: { length: "The clip follows the length of the video." },
      typical: 300,
    }),
    cost: { schedule: perSecond(["resolution"], m.rates, "seconds"), note: `KIE price list: wan 2.2 Animate, ${m.variant.replace("2.2 ", "")}: ${Object.entries(m.rates).map(([r, c]) => `${r} ${c}`).join(", ")} credits per second of video.` },
  })),
];

/** Existing models that gain workflows: a new capability version and, where the request shape changes, a new route. */
export const MODEL_UPDATES = [
  {
    id: "wan-2-6",
    kie: { model: "wan/2-6-text-to-video;image=wan/2-6-image-to-video;video=wan/2-6-video-to-video", adapter: "kie-wan-2-6-v2" },
    purpose: "Alibaba Wan 2.6 from text, a start frame or reference videos, up to 15 s, 720p or 1080p.",
    spec: videoSpec({
      options: { duration: duration([5, 10, 15]), resolution: resolution(["720p", "1080p"]) },
      inputs: {
        first_frame: firstFrame({ minSide: 256 }),
        reference_videos: video("Reference videos", { max: 3, maxBytes: 10 * 1024 * 1024, hint: "Up to 3 clips of 10 MB; the subject is placed in the scene you describe" }),
      },
      modes: [textMode(), imageMode(), { id: "video", label: "Reference videos", uses: ["reference_videos"], requires: ["reference_videos"], allowed: { duration: [5, 10] }, allowedMessage: "With reference videos the clip is 5 or 10 seconds." }],
      combineMessage: "Use either a start frame or reference videos, not both.",
      fixed: { aspect: "Without a start frame the model chooses the frame shape; this model has no aspect-ratio setting." },
      typical: 150,
    }),
    note: "KIE price list: wan 2.6 text-to-video, image-to-video and video-to-video share the rates already recorded (70/140/210 at 720p, 105/210/315 at 1080p per 5/10/15 s).",
  },
];
