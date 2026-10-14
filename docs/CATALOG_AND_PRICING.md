# Models, pricing and KIE balance — owner guide and reference

Admin → **Models & pricing** (`/admin/catalog`) has five tabs: **Models**, **Bulk pricing**, **Packages**, **KIE balance &
usage** and **Terms & settings**. Routine actions are written to the audit log with an automatic description; a typed
reason is asked only for an exceptional override (publishing a price that sells below the KIE cost).

Two different units appear everywhere and are always labelled:
- **KIE credits** — what KIE charges Genlixs. KIE's standard rate is USD 0.005 per credit (kie.ai pricing and billing pages,
  checked 14 Oct 2026); larger top-ups add 5–10 % bonus credits, so the amount actually paid can be lower.
- **Genlixs credits (cr)** — what customers spend. Their value comes from the packages, never from KIE.

## 1. Owner guide

### Check the KIE balance
1. Open **KIE balance & usage**. The balance is read on the server with the KIE key (the key never reaches the browser).
   It refreshes every minute while the tab is open; **Refresh now** forces a read. All staff share one read per 30 s.
2. The status says **Live**, **Stale** (older than 15 minutes), **Refresh failed** (the error and the last real value are
   shown — never a zero) or **Not configured**.
3. Set **Low-balance warning** (in KIE credits). When the balance drops below it, a red notice links to KIE billing.
4. Spend today / 7 days / 30 days is what KIE reported per finished task (`creditsConsumed`); tasks without a report are
   counted separately, not guessed. "Committed to in-flight work" is an estimate from the documented costs and is never
   subtracted from the balance.

### Test a model privately (spends KIE credits)
1. **Models** → the model's **Test model** button (works while the model is disabled for customers).
2. Write a prompt, choose the settings (and a reference image for edit models). The panel shows the expected KIE cost.
3. Tick "I understand this spends credits from the owner's KIE balance" → **Run paid test**. A repeated click returns the
   same job; only one test per model runs at a time.
4. The result appears below with the KIE task id, the credits KIE reported, timings and a private preview/download link.
   Only a delivered, validated file marks **this** entry "Verified by test" — sibling tiers are not affected.
   No customer wallet, order or commission is involved.

### Set a global markup
1. **Bulk pricing** → choose all models, images only, videos only or the rows selected on the Models tab.
2. Enter **Markup above KIE cost (%)**: target price = KIE cost × (1 + markup ÷ 100). +100 % = 2× cost, +300 % = 4× cost.
   Markup is not profit: partner commission, payment fees and operating costs come out of it.
3. **Preview prices**. Every configuration (resolution × duration × audio …) is priced separately and rounded **up** to whole
   credits at the lowest package revenue per credit. The table shows the current charge, KIE cost and its source date, the
   target price, the proposed credits and the contribution directly, with a 30 % partner and with a 50 % partner. Models
   with a manual price are kept unless you tick "Also replace manual prices". Stale or missing costs are flagged.
4. **Save drafts** (finance) or **Publish selected changes** (owner). All selected rows change together or none do. If
   anything changed since the preview (prices, costs, packages), the server refuses and asks for a fresh preview.
5. Every batch is listed with its reference, who applied it, when, and old → new versions.

### Publish or adjust one model's price
1. **Edit pricing** on the model → adjust credits per configuration (or **Fill charges from markup**) → **Save as draft**.
2. **Publish draft vN** (owner). New quotes use it at once; quotes already on a customer's screen get a refreshed price, and
   running jobs keep the price they were quoted. To go back, use **Restore as new version** on an earlier version.

### Enable a model for customers
Use the switch on the Models list (or the Availability section of the model panel):
- The switch checks the integration, the option schema, the server KIE key, a known KIE cost and a published price, and
  explains what is missing with a button to fix it.
- If a draft price is ready, the owner can **publish it and enable** in the same step.
- If the model has no successful private test, only the owner can enable it, after one explicit warning
  (**Enable using documented cost**). It stays marked "Untested" until a test passes.
- **Disabled**: hidden; new quotes and submissions are refused (also with an old quote). **Maintenance**: shown as temporarily
  unavailable with your note. **Experimental**: usable and labelled. Running jobs always finish normally.

### Packages
**Packages** shows each package's revenue per usable credit. Change price or credits, press **Preview impact** to see how the
credit value and the 50 %-partner losses would move, then **Save draft** and **Publish** (owner). Paid orders keep the price
and credits they were bought with. Set payment fees and operating cost per generation in the same tab; while they are empty,
contribution figures say "before" those costs.

### Update a KIE cost
KIE has no documented price API, so costs are never synchronised automatically. When kie.ai/pricing changes: model →
**KIE cost** → enter the new rates, the source link and the date checked → **Record new cost version** (old versions are kept),
then re-run the bulk preview. Costs older than 30 days are marked stale.

## 2. Credit economy (how numbers are computed)

```
KIE cost (USD)            = KIE credits for the configuration × USD 0.005
target selling price (USD) = KIE cost × (1 + markup ÷ 100)
credit value (USD/credit)  = lowest of (package price before tax ÷ credits granted) over the applicable packages
credit charge              = ceil(target ÷ credit value), at least 1
revenue                    = credit charge × credit value
contribution (scenario)    = revenue × (1 − partner rate − payment fee rate) − KIE cost − fixed fee share − operating cost
```

Applicable packages are the published ones; while none is published, the drafts are used and the screen says so. Today's
drafts (Starter USD 9 / 200, Creator 24 / 600, Studio 69 / 2,000) give 0.045, 0.040 and 0.0345 USD per credit, so previews use
**0.0345**. Partner rates come from the partner agreement (draft v1: 30 %, 50 % after 10 distinct paying customers). All money
arithmetic runs in Postgres `numeric`; credits are integers.

Illustration at +300 % with today's draft packages (not published prices): GPT Image 2.5 Flare 1K → 4 cr; Veo 3.1 Fast 720p
8 s → 35 cr; Veo 3.1 Lite 720p → 18 cr; Kling 3.0 720p with audio 5 s → 58 cr; Seedance 2.5 720p 5 s → 183 cr; Wan 2.6 720p
5 s → 41 cr.

## 3. Curated catalog (checked against docs.kie.ai and kie.ai/pricing on 14 Oct 2026)

All 18 entries start **disabled, unpriced and untested**. KIE credits per configuration (USD = credits × 0.005).

| Entry | Use | KIE cost | Docs |
| --- | --- | --- | --- |
| GPT Image 2.5 Flare (image) | Fast; posters, social, legible text | 6 / 10 / 16 per image (1K / 2K / 4K) | [docs](https://docs.kie.ai/market/gpt/gpt-image-2-5-flare-text-to-image) |
| GPT Image 2.5 Sunburst (image) | Recommended, premium quality | 6 / 10 / 16 | [docs](https://docs.kie.ai/market/gpt/gpt-image-2-5-sunburst-text-to-image) |
| Nano Banana Pro (image) | Premium; text, infographics | 18 (1K, 2K) / 24 (4K) | [docs](https://docs.kie.ai/market/google/pro-image-to-image) |
| Nano Banana 2 (image) | Fast general purpose | 8 / 12 / 18 | [docs](https://docs.kie.ai/market/google/nanobanana2) |
| FLUX.2 Pro (image) | Budget photorealism | 5 / 7 (1K / 2K) | [docs](https://docs.kie.ai/market/flux2/pro-text-to-image) |
| Seedream 5.0 Flash (image) | Budget + fast drafts | 3.24 (1K, 1.5K, 2K) | [docs](https://docs.kie.ai/market/seedream/5-flash-text-to-image) |
| GPT Image 2.5 Flare Edit | Fast reference edits | 6 / 10 / 16 | [docs](https://docs.kie.ai/market/gpt/gpt-image-2-5-flare-image-to-image) |
| GPT Image 2.5 Sunburst Edit | Recommended, premium edits | 6 / 10 / 16 | [docs](https://docs.kie.ai/market/gpt/gpt-image-2-5-sunburst-image-to-image) |
| Nano Banana Pro Edit | Subject consistency | 18 / 18 / 24 | [docs](https://docs.kie.ai/market/google/pro-image-to-image) |
| FLUX.2 Pro Edit | Budget photoreal edits | 5 / 7 | [docs](https://docs.kie.ai/market/flux2/pro-image-to-image) |
| Seedream 5.0 Flash Edit | Lowest-cost edits | 3.24 | [docs](https://docs.kie.ai/market/seedream/5-flash-image-to-image) |
| Veo 3.1 Fast (video; existing entry) | Recommended balance | 60 / 65 / 180 per video (720p / 1080p / 4K) | [docs](https://docs.kie.ai/veo3-api/generate-veo-3-video) |
| Veo 3.1 Lite | Budget | 30 / 35 / 150 | same |
| Veo 3.1 Quality | Premium | 250 / 255 / 370 | same |
| Kling 3.0 | 5/10/15 s, audio on/off, up to 4K | per second: 720p 20 (audio) / 14; 1080p 27 / 18; 4K 67 | [docs](https://docs.kie.ai/market/kling/kling-3-0) |
| Seedance 2.5 | Premium, synchronised audio | per second: 480p 28, 720p 63, 1080p 158 | [docs](https://docs.kie.ai/market/bytedance/seedance-2-5) |
| Seedance 2.0 Fast | Faster, cheaper Seedance | per second: 480p 11.7, 720p 24.8 | [docs](https://docs.kie.ai/market/bytedance/seedance-2-fast) |
| Wan 2.6 | Longest clips (up to 15 s) | per video: 720p 70/140/210, 1080p 105/210/315 (5/10/15 s) | [docs](https://docs.kie.ai/market/wan/2-6-text-to-video) |

Notes: "Flare" was a display alias; KIE confirms the model is **GPT Image 2.5 Flare** (OpenAI's speed-oriented variant;
Sunburst is the quality variant at the same price). The former single "Veo 3.1" entry offered three tiers with very different
costs in one selector; it is now **Veo 3.1 Fast** (same id, new option version) and Lite/Quality are separate entries, each
tested, priced and enabled on its own. Veo 1080p/4K are chosen at generation: KIE bills the 720p price plus the upgrade once
(no separate upscale task). Kling sends `sound` and `mode` (std = 720p, pro = 1080p); FLUX.2, Seedream, Seedance and Wan
send KIE's optional content filter (`nsfw_checker`) switched on.

Evaluated but not integrated (no fake entries were created):
- **GPT Image 2** — same KIE price as GPT Image 2.5 Flare, which KIE positions at GPT Image 2-level quality; duplicate.
- **FLUX.2 Flex** — 14/24 credits versus Pro 5/7, and KIE exposes no extra Flex controls.
- **Seedream 5.0 Pro** — overlaps FLUX.2 Pro/GPT Image 2.5 at a similar price; its distinguishing multi-image input
  (first image free, +0.5 credit per extra image) needs a multi-reference uploader that is not built yet. The cost engine
  already supports per-extra-reference charges.
- **Nano Banana 2.1** (found during the re-check; newer, 4/6/9 credits) — not in the requested list; a candidate to replace
  Nano Banana 2 after a side-by-side test.
- **Image-to-video / reference / multi-shot / motion-control variants** (Veo first-frame and reference-to-video, Kling multi-shot
  and Omni, Seedance with reference media, Wan image/video-to-video) — need a reference or multi-prompt UI in the video tool.
- **Seedance 2.0 Mini, 2.5 Draft, 1.5 Pro** — 2.0 Fast covers the cheaper option; 1.5 Pro service ends on 11 Nov 2026.

## 4. What is verified and what is not

- Verified locally: configuration enumeration and costs for all 18 entries, markup → credit math, 30 %/50 % scenarios,
  batches (immutability, stale previews, all-or-nothing, restore), availability rules, staff-test pipeline with simulated
  provider steps, permissions (customers, support and partners cannot read costs or balance) — see `docs/VERIFICATION.md`.
- **No real KIE request was made.** Every entry is "Untested". Not yet confirmed against a live task: the result URL hosts of
  the new models (add any new host to `MEDIA_FETCH_ALLOWED_HOSTS` after checking it is a KIE delivery host), the 1080p/4K
  Veo result layout, the KIE-reported credits per configuration, and a live balance read. A private test per model answers
  all of these and records the evidence automatically.
