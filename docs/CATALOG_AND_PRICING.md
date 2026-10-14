# Models, pricing and KIE balance — owner guide and reference

The admin console has three sections under **Catalog**:

- **Models** (`/admin/catalog`): one On/Off switch per model. Maintenance, the experimental label, private tests, the KIE
  cost source and technical details are behind each model's **Details** button.
- **Pricing & packages** (`/admin/pricing`): the two reference values, the packages customers buy and the credit charge of
  each model.
- **KIE balance** (`/admin/kie`): credits left on the KIE account, how fast they are used, and the connection state.

Operational settings are on **Overview** (Service settings); partner commission terms are on **Partners**. Every change is
written to the audit log with an automatic description; a typed reason is asked only for operational settings and partner terms.

Three units appear on these pages and are always labelled; they are never the same thing:
- **KIE credits**: what KIE charges Genlixs per task.
- **Genlixs credits**: what customers spend from their balance. One wallet, one unit, whatever package they came from.
- **USD**: reference values used to compare the two.

## Quick guide (three tasks)

**Switch a model on or off.** Models → find the model (Images/Videos filter or search) → press its switch. "Saving…"
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
  usable, with a note) and "On, labelled experimental" are set under **Details → Status**.
- Switching on records why the model is available: a validated test, manual evidence, or the documented KIE cost
  ("not tested yet"). Untested models are never shown as tested.
- Customers see a change within a few seconds (the public catalog is cached for 5 s).

### Private test (optional, spends KIE credits)
Models → **Details → Private test**. Write a prompt and choose the settings; the expected KIE cost is shown before you
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

### KIE balance
The balance is read on the server with the KIE key (never sent to the browser), at most once per 30 s across all staff, and
every minute while the page is open. Status: Live, Stale (older than 15 minutes), Refresh failed (the error and the last real
value — never a zero) or Not configured. The USD estimate uses your KIE credit cost. "KIE credits used" is what KIE reported per
finished task. Jobs, spend by model, reliability, recent readings and the low-balance warning are under **More details**.

### Update a KIE cost
KIE has no documented price API, so costs are never synchronised automatically. When kie.ai/pricing changes: Models →
**Details → KIE cost** → new rates, source link, date checked → **Record new cost version**. Prices do not change; review
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

## 4. What is verified and what is not

- Verified: configuration enumeration and costs for all 18 entries, reference values and the credit arithmetic (including the
  worked example and rounding), one-step prices, bulk markup (manual prices, kept settings, stale previews, all-or-nothing),
  availability without a paid-test gate, package editing with bonus credits, the 30 %/50 % scenarios, the staff-test
  pipeline with simulated provider steps and permissions — see `docs/VERIFICATION.md`.
- **No real KIE request was made.** Every entry is "Untested". Not yet confirmed against a live task: the result URL hosts of
  the new models (add any new host to `MEDIA_FETCH_ALLOWED_HOSTS` after checking it is a KIE delivery host), the 1080p/4K
  Veo result layout, the KIE-reported credits per configuration, and a live balance read. A private test per model answers
  all of these and records the evidence automatically.
