# Models, pricing and supplier balances — owner guide and reference

Customers see every model **once**, whichever supplier makes it: each request goes to the cheapest verified supplier that
supports its exact settings (see `docs/PROVIDERS_AND_ROUTING.md`). The admin console has four sections under **Catalog**:

- **Models** (`/admin/catalog`): one row per model with its On/Off switch, the supplier serving it now, the cost, price and
  margin of its default request, and the cheapest other supplier with the step still missing to use it (key, paid test,
  routing switch or integration). Click a model for every supplier's quote; maintenance, the experimental label, private
  tests and the KIE cost source are under **Technical details and tests**. The **Available at suppliers** tab lists the image
  and video products the suppliers sell that are not Genlixs models yet — each product once, its cheapest supplier first.
- **Pricing & packages** (`/admin/pricing`): summary cards (credit value, priced models, margin range, settings below cost)
  and three tabs: **Model prices** (customer price, what customers pay, supplier cost with the supplier serving the model,
  margin), **Packages** and **Reference values** (with the supplier currency rates the router uses).
- **Supplier balances** (`/admin/balances`; the old `/admin/kie` address redirects here): each supplier's balance with its
  source and age, spending today and this month, how long KIE's balance lasts at the last 7 days' pace, a warning naming the
  models whose most expensive settings cost more than KIE's balance, the generation pipeline and KIE activity.
- **Providers & routing** (`/admin/providers`): keys, connection tests, offers, prices and the routing review.

Operational settings are on **Overview** (Service settings); partner commission terms are on **Partners**. Every change is
written to the audit log with an automatic description; a typed reason is asked only for operational settings and partner terms.

These units appear on these pages and are always labelled; they are never the same thing:
- **KIE credits** (and each supplier's own unit: PoYo and APIMart credits, CNY, Duomi points): what a supplier charges.
- **Genlixs credits**: what customers spend from their balance. One wallet, one unit, whatever package they came from.
- **USD**: reference values used to compare them. Supplier units are converted with the rates in Reference values;
  CNY and Duomi points use an illustrative rate until the rate actually paid is entered.

## Quick guide (three tasks)

**Switch a model on or off.** Models → find the model (type filter or search) → press its switch. "Saving…"
appears, then On or Off. If something is missing the switch stays as it was and one sentence says what to do, for example
"Set a price first" with a link to the price. Off hides the model; new price checks and submissions are refused (also price
checks made earlier); jobs already running finish. A paid test is not needed; the model stays "Not tested yet" until one runs.

**Edit a package or a reference value.** Pricing & packages → Reference values: type the amount and credits on the card
(KIE: a top-up you made, e.g. $5 for 1,000 KIE credits; Genlixs: e.g. $5 for 250 credits) → the rate per credit updates →
**Save**. Nothing customers already have or have bought changes; current prices stay until you recalculate them (the
**Recalculate prices** button after saving opens the markup tool). Packages: change the name, price, included or bonus
credits, or **Offered to customers** on the package's card → **Save package**. Only that package gets a new version;
earlier orders keep their terms. **Credits from the credit value** fills the included credits at the reference rate.

**Change a model's credit charge.** Pricing & packages → Model prices → **Set price** / **Edit price** on the model. For each
setting (resolution, duration, audio, quality…) type either the Genlixs credits, the USD value or the markup above the KIE
cost; the other two follow. "Markup for every setting" + **Apply to all settings** fills all rows at once. Charges round up to
whole credits; the row shows the value and the actual markup. A charge worth less than the KIE cost needs the "Save anyway"
tick. **Save price** applies it as a new version at once (owner); **Save as draft** keeps it for later. For many models at
once use **Apply a markup to several models** → Preview → untick any setting to keep its current charge → **Save changes**.

## 1. Owner guide (details)

### Models
- The switch checks, on the server: the integration exists in this release, the option schema, the server KIE key, a known
  KIE cost and a saved price. A private test is optional and never blocks switching on. The switch maps to the stored
  states without contradictions: On = enabled (or experimental), Off = disabled; "Paused for maintenance" (visible, not
  usable, with a note) and "On, labelled experimental" are set under **Technical details and tests → Status**.
- Switching on records why the model is available: a validated test, manual evidence, or the documented KIE cost
  ("not tested yet"). Untested models are never shown as tested.
- Customers see a change within a few seconds (the public catalog is cached for 5 s).
- **Served by** is the router's own choice for the model's default request; **Cheaper supplier** is the lowest quote for the
  same request from a supplier that cannot serve it yet, with the saving and the next step. Quotes use each supplier's
  published price with its funding terms (for example Cuddler's card fee); conflicting or unverified prices are never
  compared. Nothing on this page changes routing: suppliers are switched on in Providers & routing after a paid test.

### Private test (optional, spends KIE credits)
Models → a model → **Technical details and tests → Private test**. Write a prompt and choose the settings; the expected KIE cost is shown before you
confirm "I understand this spends credits from the owner's KIE balance". A repeated click returns the same job; one test per
model runs at a time; no customer wallet, order or commission is involved. Only a delivered, validated file marks this entry
"Tested".

### Reference values
- **KIE credit cost**: USD paid ÷ KIE credits received in a top-up (bonus credits included; enter them under "Bonus credits
  and source" so the assumption is visible). Seeded from KIE's standard rate: $5 for 1,000 credits = $0.005.
- **Genlixs credit value**: a base amount ÷ a whole number of Genlixs credits. Seeded with the illustrative value
  $5 for 250 credits = $0.02, labelled "Example value, not confirmed" until you save or confirm it.
- Each save is a new version (the old ones are kept). Saving never changes wallet balances, ledger entries, purchases,
  quotes, running jobs or published prices. While typing, the card shows what the new value would mean for the current
  prices (markup range, settings that would fall below the KIE cost) without saving anything.

### Packages
- Usable credits = included + bonus. Value per credit = price ÷ usable credits, compared with the Genlixs credit value
  (premium or discount). The grant on purchase or per paid month is the usable credits.
- Changing what customers can buy (offering, or editing an offered package) is an owner decision; finance can prepare a
  package that is not offered. Checkout, gateways and the subscription system are unchanged.
- Promotional credits (sign-up bonus, staff grants) bring no revenue and are not part of any package.

### Model prices
- Every setting is priced separately and saved as one immutable version; quotes and debits only ever use the saved server
  price. The editor starts from the current price (or a saved draft) and sends the version it started from: if someone
  saved in the meantime, the save is refused with "Reload".
- **Package comparison** (one setting at a time): the value of the charge and the contribution at the credit value and at
  each package's rate, directly and with the 30 % / 50 % partner commission — estimates before payment fees and running
  costs.
- **Apply a markup to several models**: all, images, videos or chosen models; the credit value used is shown. Prices set by
  hand are kept unless "Include prices set by hand" is ticked. Settings can be kept at their current charge. One
  **Save changes** applies every chosen model as a new version, or nothing; if a price, a KIE cost or a reference value
  changed since the preview, the save is refused and the preview refreshed.
- **Price history** in the editor lists every version; **Restore** saves an earlier one again as a new version.

### Supplier balances
Each supplier card shows the balance in the supplier's own unit with an approximate USD value, where it came from (provider
API or a dated manual entry) and its age; a supplier without a key shows "No key saved", never $0. KIE's balance is read on
the server with the KIE key (never sent to the browser), at most once per 30 s across all staff, and every minute while the
page is open (**Read now** reads it at once); **Refresh balances** reads every supplier that has a key. The router refuses a
job before any charge when a balance read less than an hour ago (minus jobs in flight) cannot cover it, so the page warns
when the most expensive settings of KIE-served models cost more than KIE's balance. "KIE balance lasts" divides the balance
by the last 7 days' KIE spending. The **KIE activity** section has credits used, jobs now, spend by model, reliability, recent
readings and the low-balance warning.

### Update a KIE cost
KIE has no documented price API, so costs are never synchronised automatically. When kie.ai/pricing changes: Models → the
model → **Technical details and tests → KIE cost** → new rates, source link, date checked → **Record new cost version**. Prices do not change; review
them in Pricing & packages. Costs older than 30 days are marked stale.

## 2. Credit pricing (how numbers are computed)

```
USD per KIE credit       = KIE purchase amount ÷ KIE credits received          (10 decimals)
USD per Genlixs credit   = credit value amount ÷ Genlixs credits               (10 decimals)
KIE cost (USD)           = KIE credits for the setting × USD per KIE credit    (8 decimals)
target (USD)             = KIE cost × (1 + markup ÷ 100)                       (8 decimals)
charge (Genlixs credits) = ceil(target ÷ USD per Genlixs credit), at least 1
value (USD)              = charge × USD per Genlixs credit
actual markup (%)        = (value ÷ KIE cost − 1) × 100
contribution             = value × (1 − partner commission) − KIE cost         (before payment fees and running costs)
```

All money arithmetic runs in Postgres `numeric`; the browser mirrors it with exact decimals (`src/lib/pricing/`), so $0.07
at $0.01 per credit is 7 credits, not 8. A missing KIE cost is never treated as zero: the model cannot be priced.

Worked example (the owner's figures, also a contract test and a database test): KIE $5 for 1,000 credits → $0.005 per KIE
credit; Genlixs $5 for 250 credits → $0.02 per Genlixs credit. An image costing 6 KIE credits costs $0.03. Charged 3 Genlixs
credits it is worth $0.06: a markup of +100 %. The customer spends 50 % fewer credits in number than the KIE credits it uses,
because one Genlixs credit is worth four KIE credits (+300 % in value). Contribution before payment and running costs:
$0.03 directly, $0.012 with a 30 % partner commission, $0 with 50 %.

Rounding example: Seedream 5.0 Flash 1K costs 3.24 KIE credits = $0.0162; +100 % = $0.0324 = 1.62 credits, charged 2 credits
($0.04, actual markup +146.9 %).

Package rates are a comparison, not the basis: Starter $9 for 200 credits is $0.045 per credit, +125 % above the $0.02
credit value. Earlier versions valued credits at the cheapest package; that rule is no longer used for pricing.

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

The drafts follow the rule of every published price: KIE cost × 2 (+100 %) at $0.005 per KIE credit and $0.02 per Genlixs
credit, rounded up to whole credits; none is below cost. They were saved as drafts by finance and are **not published**.
To offer a mode: Pricing & packages → the model → review the draft → **Publish** (owner), then Models → switch it on. Until
then customers see an honest "not available yet" in that tab, and staff with the test permission can run private tests
from the studio (the KIE account pays, no customer credits).

## 4. What is verified and what is not

- Verified: configuration enumeration and costs for all 18 entries, reference values and the credit arithmetic (including the
  worked example and rounding), one-step prices, bulk markup (manual prices, kept settings, stale previews, all-or-nothing),
  availability without a paid-test gate, package editing with bonus credits, the 30 %/50 % scenarios, the staff-test
  pipeline with simulated provider steps and permissions — see `docs/VERIFICATION.md`.
- **15 Oct 2026, real KIE requests in production** (`docs/VERIFICATION.md` §0): GPT Image 2.5 Flare 1K (6 KIE credits),
  Veo 3.1 Lite 720p text and start-frame clips (30 each), Seedance 2.5 Edit 480p (119) and Kling 3.0 Motion Control 720p
  (80), all delivered from the default KIE hosts and saved; the live balance reading moved by exactly the reported credits.
  Not yet confirmed against a live task: the other entries, 1080p/4K Veo results and Veo 3.1 Extend. A private test per
  model answers these and records the evidence automatically.
