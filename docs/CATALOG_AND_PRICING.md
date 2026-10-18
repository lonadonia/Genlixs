# Models, pricing and provider balances — owner guide and reference

Customers see every model **once**, whichever supplier makes it: each request goes to the cheapest verified supplier that
supports its exact settings (see `docs/PROVIDERS_AND_ROUTING.md`). Every selling price follows **one global pricing
policy**: the documented KIE cost of the request, plus your markup, converted to Genlixs credits. Nothing is priced per
model. The admin console has two pages under **Catalog**:

- **Models & pricing** (`/admin/catalog`): the pricing panel (markup on the KIE cost and the USD value of one Genlixs
  credit, one **Save & apply**), then one row per model: its example settings, the customer price in Genlixs credits with
  its USD value, the supplier serving it and that supplier's cost for the whole request, the effective markup on that cost,
  the On/Off switch and a details button. The model drawer shows how the price is set (KIE reference → target → credits),
  the serving supplier, cheaper offers that are not serving yet (kept apart), and anything that blocks the model.
  **Packages** is a collapsed section at the bottom; **Add models** lists the products the suppliers sell that are not
  Genlixs models yet (nothing there is published).
- **Providers & balances** (`/admin/providers`): one row per provider with one status, its balance (unit, source and age),
  spending today and this month, the On/Off switch, **Add key / Replace key**, **Refresh** and **Details** (diagnostics,
  funding terms and limits, a manual balance, spending by job, and for KIE its activity). **More** opens spending by job,
  the generation pipeline and routing & offers on demand. Banners say when generation is not working, a balance is too low,
  a key was refused or a provider is refusing jobs, each with a link to the details.

The former addresses redirect: `/admin/pricing` → `/admin/catalog` (`?tab=packages` opens Packages, `?model=<id>` opens
that model), `/admin/balances` and `/admin/kie` → `/admin/providers`.

Operational settings are on **Overview** (Service settings); partner commission terms are on **Partners**. Every change is
written to the audit log with an automatic description.

These units appear on these pages and are always labelled; they are never the same thing:
- **KIE credits** (and each supplier's own unit: PoYo and APIMart credits, CNY, Duomi points): what a supplier charges.
- **Genlixs credits**: what customers spend from their balance. One wallet, one unit, whatever package they came from.
- **USD**: reference values used to compare them. A Genlixs credit is not a KIE (or any supplier's) credit.

## Quick guide (three tasks)

**Change prices.** Models & pricing → the pricing panel → type the **Markup on KIE cost (%)** (100 % sells for twice the
KIE cost) and/or the **USD value of one Genlixs credit** → a small preview shows how many models change price and a few
example requests before → after → **Save & apply** (owner). Every image, image-editing, video and video-editing price is
recalculated at once; quotes already taken are re-checked before a job starts, jobs already accepted keep their price,
wallets, purchases and packages are not touched.

**Switch a model on or off.** Models & pricing → find the model (type filter or search) → press its switch. "Saving…"
appears, then On or Off. If something is missing the switch stays as it was and one sentence says what to do, for example
"KIE reference needed". Off hides the model; new price checks and submissions are refused (also price checks made
earlier); jobs already running finish. A paid test is not needed; the model stays "Not tested yet" until one runs.

**Add or replace a provider key.** Providers & balances → the provider's row → **Add key** / **Replace key** → paste →
**Save key**. The key goes to Supabase Vault on the server and is never shown again (only a masked hint). **Details →
Test connection** checks it with a read-only balance call; nothing is generated.

## 1. Owner guide (details)

### Pricing panel
- Two settings, one action. The markup is a markup on cost, not a margin on revenue: +100 % sells a request for twice its
  KIE reference. The credit value is the existing Genlixs credit value (there is no second setting); changing it here
  versions it.
- The preview is calculated by the server and saves nothing. **Save & apply** is refused with "changed meanwhile" when
  someone else saved first; reload and look at the preview again. Finance can preview; only the owner can apply.
- What the policy uses: the model's KIE price list (exact version, resolution, duration, audio, reference images, output
  count and billed input seconds) at the documented price of a KIE credit ($0.005). A model whose KIE price list does not
  cover its settings shows **KIE reference needed** and has no price; another supplier's price is never used instead.
- Prices follow KIE price data automatically: recording a new KIE price list for a model (model drawer → **Technical
  details and tests → KIE cost**) re-prices that model at once; a new documented KIE credit price re-prices every model.

### Models
- The switch checks, on the server: the integration exists in this release, the option schema, the server KIE key, a KIE
  reference price and a price. A private test is optional and never blocks switching on. On = enabled (or experimental),
  Off = disabled; "Paused for maintenance" and "On, labelled experimental" are set under **Technical details and tests →
  Status**.
- Switching on records why the model is available: a validated test, manual evidence, or the documented KIE cost
  ("not tested yet"). Untested models are never shown as tested.
- Customers see a change within a few seconds (the public catalog is cached for 5 s; quotes always read the live price).
- **Served by · cost** is the router's own choice for the model's example request and what that supplier charges for the
  whole request, with its funding terms. **Effective markup** = (customer price − that cost) ÷ that cost. When a cheaper
  supplier starts serving, the customer price does not move and the effective markup rises: the saving is Genlixs's.
  Nothing on this page changes routing: suppliers are switched on in Providers & balances after a paid test.

### Private test (optional, spends KIE credits)
Models & pricing → a model → **Technical details and tests → Private test**. Write a prompt and choose the settings; the
expected KIE cost is shown before you confirm "I understand this spends credits from the owner's KIE balance". A repeated
click returns the same job; one test per model runs at a time; no customer wallet, order or commission is involved. Only a
delivered, validated file marks this entry "Tested".

### Packages
- Usable credits = included + bonus. Value per credit = price ÷ usable credits, compared with the Genlixs credit value
  (premium or discount). The grant on purchase or per paid month is the usable credits. Changing the credit value never
  changes a package; the credit value is a pricing reference, not the cash each package brings.
- Changing what customers can buy (offering, or editing an offered package) is an owner decision; finance can prepare a
  package that is not offered. Each package is saved on its own as a new version; earlier orders keep their terms.
- Promotional credits (sign-up bonus, staff grants) bring no revenue and are not part of any package.

### Providers & balances
Each row shows the balance in the provider's own unit with an approximate USD value, where it came from (provider API or a
dated manual entry) and its age; a provider without a key shows "No key saved", never $0. Balances are read on the server
with the saved key (never sent to the browser), at most once per interval across all staff; **Refresh** reads one
provider, **Refresh balances** reads all that have a key. KIE's balance is also read every minute while the page is open.
The router refuses a job before any charge when a balance read less than an hour ago (minus jobs in flight) cannot cover
it, so the page warns when the most expensive settings of KIE-served models cost more than KIE's balance.

### Update a KIE cost
KIE has no documented price API, so costs are never synchronised automatically. When kie.ai/pricing changes: Models &
pricing → the model → **Technical details and tests → KIE cost** → new rates, source link, date checked → **Record new
cost version**. The model is re-priced at once under the global policy. Costs older than 30 days are marked stale.

## 2. Credit pricing (how numbers are computed)

```
B  KIE reference (USD)     = KIE credits of the whole request × documented USD per KIE credit   (8 decimals)
M  markup                  = global markup on the KIE reference (100 % = selling for twice B)
V  USD per Genlixs credit  = the Genlixs credit value                                           (at most 6 decimals)
target (USD)               = B × (1 + M ÷ 100)                                                  (8 decimals)
charge (Genlixs credits)   = ceil(target ÷ V), at least 1 — rounded once for the whole request
charged value (USD)        = charge × V
C  serving cost (USD)      = what the supplier that serves the request charges, funding terms applied
effective markup (%)       = (charged value − C) ÷ C × 100
```

One engine in Postgres computes every price (`app_private.policy_units`, `app_private.policy_model_rules`): each model's
price table is materialised as an immutable price version, and quotes, the stale-quote check before a job, the reservation
and the final debit all read that version. The browser never calculates a price. Values are reference values before
payment fees, partner commission and other costs — not net profit.

Examples (synthetic, also database tests in `supabase/tests/10_automatic_pricing_tests.sql`):

| Situation | B | M | V | C | Charge | Effective markup |
| --- | --- | --- | --- | --- | --- | --- |
| KIE serves the request | $0.10 | 100 % | $0.01 | $0.10 | $0.20 = 20 credits | 100 % |
| A cheaper supplier serves it | $0.10 | 100 % | $0.01 | $0.08 | $0.20 = 20 credits | 150 % |
| A still cheaper supplier | $0.10 | 100 % | $0.01 | $0.05 | $0.20 = 20 credits | 300 % |
| The markup becomes 150 % | $0.10 | 150 % | $0.01 | $0.08 | $0.25 = 25 credits | 212.5 % |
| The credit value becomes $0.02 | $0.10 | 100 % | $0.02 | $0.08 | $0.20 = 10 credits | 150 % |

Rounding: B $0.025, M 100 %, V $0.02 → target $0.05 = 2.5 credits → charged 3 credits ($0.06, +140 % on B). In the catalog,
Seedream 5.0 Flash 1K costs 3.24 KIE credits = $0.0162 → $0.0324 = 1.62 → 2 credits ($0.04). Exact decimals: $0.07 at
$0.01 per credit is 7 credits, not 8.

Package rates are a comparison, not the basis: Starter $9 for 200 credits is $0.045 per credit, +125 % above the $0.02
credit value.

## 3. Curated catalog (checked against docs.kie.ai and kie.ai/pricing on 14 Oct 2026)

All 18 entries start **off, unpriced and not tested**. KIE credits per configuration (USD = credits × the KIE credit cost, $0.005 at the standard rate).

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

### Video modes (added 15 Oct 2026)

The video studio has three tabs: **Create Video** (References or Extend video), **Edit Video** and **Motion Control**.
Each tab offers only the models of its operation. The creation models above now also accept start/end frames, reference
images (Veo 3.1 Fast and Lite: up to 3 images, 8-second clips), Kling elements (2–4 images each, named `@element1…3` in the
prompt) and Seedance references (up to 9 images and 3 audio clips); frames and references are never combined. Prices of
these creation models did not change. Three new entries are **off, with a draft price waiting for the owner**:

| Entry | What it does | KIE cost | Draft price (Genlixs credits) | Status |
| --- | --- | --- | --- | --- |
| Seedance 2.5 Edit | Edits an uploaded or saved clip with a prompt (4–30 s, 480p or 720p, 24–60 fps, up to 50 MB), optional image/audio references | per second of source + output: 480p 17, 720p 38 (the estimate counts the output as long as the source) | 17 × seconds at 480p, 38 × seconds at 720p (68–1,140) | private test passed 15 Oct (480p, 4 s clip: KIE charged 119) |
| Kling 3.0 Motion Control | Moves a character image like the person in a 3–30 s video; orientation "Follow the video" (≤ 30 s) or "Keep the image's pose" (≤ 10 s); not a background setting | per second of the motion video: 720p 20, 1080p 27 | 10 × seconds at 720p, ⌈13.5 × seconds⌉ at 1080p (30–405) | private test passed 15 Oct (720p, 4 s: KIE charged 80) |
| Veo 3.1 Extend | Continues one of the customer's own Veo 3.1 clips (last 13 days) | per extension: Fast 60, Lite 30, Quality 250 | Fast 30, Lite 15, Quality 125 | not tested |

These modes were later published and switched on by the owner (18 Oct 2026). Since automatic pricing, their prices — like
every model's — follow the global policy (KIE cost × (1 + markup) at the Genlixs credit value, rounded up per request);
the draft-price workflow described here no longer exists, and staff with the test permission can still run private tests
from the studio (the KIE account pays, no customer credits).

## 4. What is verified and what is not

- Verified: configuration enumeration and costs for all entries, the global pricing policy (the formula and the examples
  above, whole-request rounding, Save & apply versioning, stale quotes refreshed, accepted jobs and wallets untouched,
  KIE reference needed, automatic re-pricing from new KIE price data, retired per-model and bulk editors), availability
  without a paid-test gate, package editing with bonus credits, the 30 %/50 % scenarios, the staff-test pipeline with
  simulated provider steps and permissions — see `docs/VERIFICATION.md`.
- **15 Oct 2026, real KIE requests in production** (`docs/VERIFICATION.md` §0): GPT Image 2.5 Flare 1K (6 KIE credits),
  Veo 3.1 Lite 720p text and start-frame clips (30 each), Seedance 2.5 Edit 480p (119) and Kling 3.0 Motion Control 720p
  (80), all delivered from the default KIE hosts and saved; the live balance reading moved by exactly the reported credits.
  Not yet confirmed against a live task: the other entries, 1080p/4K Veo results and Veo 3.1 Extend. A private test per
  model answers these and records the evidence automatically.
