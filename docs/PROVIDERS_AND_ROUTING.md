# Suppliers, keys and cheapest-route generation

Migrations `20261018181012`…`20261018182418_multi_provider_routing_part01`…`part12` (applied 18 Oct 2026) · Admin ›
**Providers & balances** (`/admin/providers`; routing details under **More → Routing & offers**) · 18 Oct 2026.

Genlixs can buy each generation from one of six suppliers — KIE, Duomi, PoYo, NezhaGate, Cuddler and APIMart. Customers
still see **one card per model** and pay the same Genlixs credits; the server sends each job to the **cheapest verified
supplier for its exact settings** and records what that cost. Until the owner adds a key and makes an offer eligible
(live-tested, or activated as documented, not live-tested — §3a), every model keeps its original KIE route exactly as before.

## 1. Setup (one time)

Nothing to configure by hand. Supabase Vault is built into the project; keys are added from Admin.

1. Apply the migrations (parts 01–12, in order), **then** deploy this release (the new worker calls
   `worker_begin_submission_v2`; the previous release keeps working on `worker_begin_submission` while they are applied).
2. Optional server settings (Vercel):
   - `KIE_API_KEY` — still used for KIE when no KIE key is saved in Admin. A key saved in Admin wins for new jobs; jobs
     already sent keep the key version they used. If both exist they should belong to the same KIE account.
   - `MEDIA_FETCH_ALLOWED_HOSTS` — Cuddler does not document the host its result files come from. After its first
     authorised test, add the host shown in the test job's error (or result link) here. The other suppliers' documented
     result hosts are built in (`upload.apimart.ai`, `img.nezhagate.com`, `storage.poyo.ai`, `cdn3.dmiapi.com`, KIE's hosts).
   - `ALLOW_PAID_PROVIDER_TESTS=true` — only to send paid work from a preview deployment.

## 2. Daily use (owner)

| Step | Where | What happens |
| --- | --- | --- |
| Add or replace a key | Providers › *Add key* | The key is sent once over HTTPS, stored encrypted in Vault, and never shown again: only `••••last4` and the version are kept. Needs a recent sign-in. |
| Test the connection | Providers › *Test connection* | Calls the supplier's documented **read-only balance** endpoint with the saved key. It never creates a generation. |
| Switch a supplier on/off | Providers › switch | Off = no new jobs go there; jobs already sent finish normally. |
| Funding terms | Providers › Details | Card/top-up fee in basis points (Cuddler card = 550) and credit bonus (10 % = 1000 → cost ÷ 1.10). A daily USD cap and a shared-wallet group can be set too. |
| Live-test an offer | Models › supplier name › *Test* | One **paid** private job pinned to exactly that offer (whatever the routing switch says). Check size, length and sound; once the job has **succeeded**, choose it under *Details › Evidence* and **Mark live-tested**. A note alone is refused. |
| Activate without a live test | Models › supplier name › *Details › Evidence* | **Activate: documented, not live-tested** (owner only), when every check listed there passes (§3a). Needs a ticked acknowledgement and a reason; routing switches on. |
| Route to it | Models › offer › *Routing on*, or **Review routing** | Routing uses an offer only when it is eligible (live-tested or documented), priced, integrated, its supplier is on with a key, and it is the cheapest for the request. |
| Review routing | Models › *Review routing* | Compares every offer of every model over all its settings. Preview first; applying records each decision, switches **dominated** offers off and switches on the verified winners you tick. |
| Compare one request | Models › *Compare* | Exact settings (and file counts/lengths) → every offer's whole-request cost, or why it is excluded, with its price evidence and the saving against KIE when KIE has a verified price for the same settings. |
| Prices | Models › offer › *Price* | New immutable version: unit, billing basis, rates per configuration, extra-image surcharge, confidence, source link, date. A blank rate is unknown, never free. |

Re-run *Review routing* after switching a winning supplier off: an original route that was dominated stays off until a
review switches it back on (no hidden fallback).

The everyday work lives on two pages (`docs/CATALOG_AND_PRICING.md`): **Models & pricing** shows, for every model once,
the supplier serving its example request, that supplier's cost for the whole request and the effective markup on it, and
in the model drawer the cheaper offers that are not serving yet with the step still missing (key, live test or
documented activation, documentation question, routing);
**Add models** lists each product outside the catalog once with its cheapest supplier. **Providers & balances** shows
every provider's balance and spending, keys and switches, and warns when KIE's balance cannot cover a model's most
expensive settings. Both read `admin_catalog_supply` (`provider.read`, read-only). The customer price never depends on the
serving supplier: it follows the KIE reference under the global pricing policy, so a cheaper route only raises Genlixs's
effective markup.

## 3. How a route is chosen

For every job the database evaluates all offers of the model (`app_private.route_evaluate`, `route_choose`):

1. **Structural** — integration in this release, routing on, status eligible, supplier on and not paused, a key (Vault,
   or `KIE_API_KEY` for KIE), the key not refused at the last test.
2. **Capabilities** — every requested setting, input mode, file count, total media length and prompt length must be
   listed by the offer. A supplier that would ignore a setting is incompatible. The original KIE route takes the model's
   own capability.
3. **Price** — a usable current version (documented, account quote or provider estimate; not conflicting/unverified,
   not expired, not older than the freshness limit unless an audited override is active).
4. **Health** — circuit breaker, daily spending cap, and a recent API balance minus local pending reservations.
5. **Cost** of the whole request in the offer's unit: rate × outputs, × output seconds, × (input + output seconds),
   minimum seconds, extra reference images, rounding at the provider's boundary. Then
   `USD = native ÷ units_per_usd × (1 + fee) ÷ (1 + bonus)` with exact `numeric` arithmetic.
6. **Choice** — the lowest funded cost; ties go to the original route, then the supplier order, then the offer order. An
   offer whose cost is unknown is used only when it is the model's original route and no offer has a known cost.
   A more expensive offer is used while the cheapest is temporarily unavailable only within the fallback ceiling set
   in the policy (`routing_fallback_max_pct` / `_usd`, default: none = cheapest only) — and, since migration
   `20261018235333_route_fallback_original`, always up to the cost of the model's original KIE route: customer prices
   follow the KIE reference, so a cheaper offer that is short of balance, behind its circuit breaker or past its daily
   cap never blocks a request that the original route (or another offer costing no more) can serve. Above the original
   route's cost only the configured ceiling applies; without a routable original route nothing changed.

   Keys and the provider switch are not enough to serve: an offer needs an integration in this release, a usable price,
   an **evidence status** (below) and **routing on**. Admin › Providers & balances shows "Not verified yet" for a keyed
   provider with no eligible offer.

## 3a. Evidence: Live-tested or Documented, not live-tested

Migration `20261019010705_documented_activation` (applied 19 Oct 2026). An offer is eligible to serve with one of two
evidence statuses, recorded on the offer (`verification_basis`) and shown as separate badges; they are never mixed up:

- **Live-tested** — only from a real paid test: a job pinned to exactly this offer (`admin_create_offer_test`), accepted by
  this offer's supplier and **succeeded**. `admin_update_offer` refuses `status: eligible` without such a `testJobId`
  (`LIVE_TEST_REQUIRED`), so a test reference can never be typed in.
- **Documented, not live-tested** — the owner (`provider.manage`) activates it with `admin_activate_offer_documented`
  (an explicit acknowledgement and a reason of 10+ characters; both are stored with a snapshot of the checks and in the
  audit log). The database re-runs every check at that moment (`admin_offer_activation_readiness`, also shown in the
  offer drawer) and refuses (`NOT_QUALIFIED`) unless all pass:

  | Check | Passes when |
  | --- | --- |
  | Supplier offer | mapped to a Genlixs model, not the original route |
  | Integration | an adapter of this release (request, status and result formats written from the supplier's API reference) |
  | Documentation | the offer's API documentation link is recorded |
  | Result host | the integration's documented download host is recorded (`provider_adapters.result_hosts`, equal to the code; none for Cuddler) |
  | No documentation gap | no open question recorded on the offer (`documentation_gap`) |
  | Validated price | documented or account-quote price (not an estimate), not expired, not older than `provider_price_stale_days` unless an audited override is active |
  | Provider | switched on, not paused, a key saved |
  | Free authentication check | the last read-only connection test with the saved key succeeded |
  | Balance | an API balance read within `provider_balance_stale_minutes`, in the price unit, that covers the cheapest compatible request after pending jobs |
  | Compatible settings | at least one of the model's priced settings is supported and priced by the offer |

  Turning routing back on, or changing the capabilities of such an offer, re-runs the checks. Recording a documentation
  question switches it off. **Safety stop:** the first refusal by its supplier (`provider_attempts` → rejected) or the
  first job on it that ends failed or in review switches the offer off (status not verified, routing off,
  `auto_paused_reason`, audit `provider_offer.auto_paused`); later requests go to the next route, at most the original
  KIE route's cost (§3 step 6). Live-tested offers and the original routes are not affected.

Nothing else changes: customer prices follow the KIE reference (no price version is created), and reservations, refunds,
balance gates, daily caps, the circuit breaker and stale-price rules apply to every route.

Documentation questions recorded at release: APIMart Seedance 2.0 Fast (whether sound changes the price), NezhaGate GPT
Image 2.5 Sunburst image and edit (no model page; the 1K rate is described as temporary), Cuddler Kling 3.0 and Seedance
2.5 (result host not documented; Seedance token-priced). NezhaGate's Flare offers leave 2K out (2K disruption notice of
18 Oct 2026). Qualifying on 19 Oct 2026 (not activated; the owner decides): APIMart Seedance 2.5, Seedream 5.0 Flash
image and edit; NezhaGate GPT Image 2.5 Flare image and edit, Nano Banana Pro image and edit; PoYo Kling 3.0 Motion
Control. NezhaGate Seedance 2.5 / 2.0 Fast need a larger balance than $0.15; Cuddler is unfunded and has no documented
result host.

The chosen supplier, offer, provider model, key version, price version, unit conversion, funding terms, estimate,
explanation and the compared candidates are stored on the attempt (`provider_attempts.route`). Status checks, task
binding and downloads always use that pinned route, whatever Admin changes later.

Quotes, job creation and staff tests ask the same router: settings no supplier can fulfil are refused before anything
is charged, and the public catalog only shows option values and input modes that some routable supplier can do.

## 4. Keys and security

- Stored with `vault.create_secret` by `admin_set_provider_key` (owner, `provider.manage`); `provider_credentials` keeps
  the version and masked hint. Statement logging on the project is limited to DDL, so call parameters are not logged.
- Decrypted only by `worker_provider_credential` (service role) for the worker and connection tests. Browsers, the
  `authenticated` role and Admin reads never receive a key; responses, audit rows, exports and logs contain only hints.
- Rotation: the new version serves new jobs; older versions stay until no open job uses them, then they are deleted
  from Vault (`purge_retired_credentials`). Removing a key retires all versions the same way.
- Each supplier client calls fixed HTTPS hosts and paths from code (no configurable URL, TLS verification on, no
  redirects for API calls); result downloads go through the existing SSRF-safe downloader and per-supplier host lists.
- Every key, switch, price, policy and routing change is in the audit log (without the key).

## 5. Balances

Each account shows total / available / held in its own unit, where it came from (provider API or a dated manual entry),
its age, and the last error. Unknown is shown as unknown, never as zero; a failed read keeps the last real value; an
unlimited API-key allowance (APIMart) is shown as such and is not a wallet; accounts in one wallet group are counted
once. Balances refresh on *Refresh balances*, on connection tests, and every ten minutes by the worker (a few accounts
per run). PoYo's balance endpoint (`/api/user/balance`) was found in its current documentation.

A balance read from the supplier's API less than 60 minutes ago (`provider_balance_stale_minutes`), minus the jobs
still pending there, must cover a job's cost or that supplier is skipped for it; when no other supplier can take the
job, the customer is told before anything is reserved. An older, manual or unknown balance never blocks. On 18 Oct 2026
KIE read 626.03 credits, so a 630-credit Seedance 2.5 job was refused this way; the previous release accepted such jobs
and KIE answered 402. Topping up the account lifts this within one balance refresh.

## 6. Spending and the supplier cost ledger

One `provider_cost_ledger` row per attempt (Genlixs customers' credits stay in the existing wallet ledger):

| State | Meaning | Counted as |
| --- | --- | --- |
| `reserved` | being sent | pending |
| `submission_unknown` | the send may have reached the supplier; verifying | pending |
| `pending_confirmation` | accepted; the routed estimate stands | estimated |
| `confirmed` | the supplier reported the charge (KIE, APIMart, PoYo task replies; Cuddler usage) | confirmed |
| `not_charged` | refused before a task existed | — |
| `failed` | task failed with no reported charge (all six document failed tasks as not billed) | — |
| `unknown_historical` | sent before this release; charge not reported | unknown (counted, never guessed) |

Admin › Usage filters by date (UTC), supplier, model, customer, status and purpose, shows each job's attempts and route,
and exports a sanitized CSV (no prompts, URLs, keys or e-mail addresses; no spreadsheet formulas). Account-level usage
read from the suppliers (APIMart, Cuddler, NezhaGate) is shown separately: it may include other applications and is
never assigned to customers. Refunds, corrections and unattributed amounts are recorded as adjustments.

History: every earlier attempt was linked to its model's original KIE route; charges KIE reported were kept (6 credits
→ $0.03 at the documented $0.005), others are `unknown_historical`.

## 7. Supplier integrations in this release

| Supplier | Auth | Generation (polling; no callbacks trusted except KIE's verified ones) | Balance (connection test) | Usage | Idempotency |
| --- | --- | --- | --- | --- | --- |
| KIE | Bearer | existing client: `createTask`, `recordInfo` | `GET /api/v1/chat/credit` | — | none (unknown → verify via callback evidence) |
| Cuddler | Bearer | `POST /v1/videos`, `/v1/images` with `max_usd` = estimate × 1.15; `GET /v1/{videos,images}/{id}` | `GET /v1/balance` (total, held, available) | `GET /v1/usage` | `Idempotency-Key = genlixs-<attempt>`; one re-send with the same key after a lost/5xx reply |
| APIMart | Bearer | `POST /v1/videos/generations`, `/v1/images/generations`; `GET /v1/tasks/{id}` | `GET /v1/user/balance` (+ key allowance `/v1/balance`) | `GET /v1/usage` (≤ 31 days, UTC) | none |
| NezhaGate | Bearer | `POST /v1/videos/generations`, `/v1/images/generations`; `GET /v1/{videos,images}/jobs/{id}` | `GET /v1/usage` (`balance.usd`) | same, today | none (502/503 documented as not billed → retry) |
| PoYo | Bearer | `POST /api/generate/submit` (Kling 3.0 Motion Control); `GET /api/generate/status/{id}` | `GET /api/user/balance` | — | none |
| Duomi | raw `Authorization` | `POST /api/gemini/nano-banana(-edit)`; `GET /api/gemini/nano-banana/{id}`; business errors inside HTTP 200 | `GET https://api.wike.cc/api/account/get` (points) | — | none |

Units: KIE credit and PoYo credit 200/USD, APIMart credit 10/USD (Gold), CNY 6.70/USD and Duomi point 6,700/USD are
**illustrative** until replaced with the rate actually paid (Providers & balances › Routing & offers › offer › Price, or
`admin_save_cost_unit`). A new KIE credit price (`kie_credit`) is a new pricing-policy version and re-prices every model.

## 8. Offers after the migration

Status = verification state; Decision = result of the routing review (*eligible* = cheapest for at least one supported
configuration against the offers that can currently be routed; it does not mean routable). Every non-KIE offer starts
**off** with a key missing and needs one verified paid test.

| Public model | Supplier | Provider model | Integration | Status | Decision | Routing | Note |
| --- | --- | --- | --- | --- | --- | --- | --- |
| GPT Image 2.5 Flare Edit | KIE (original) | gpt-image-2-5-flare-image-to-image | kie-market-image-edit | eligible | eligible | on | Unchanged: KIE cost versions, server key |
| GPT Image 2.5 Flare Edit | NezhaGate | gpt-image-2.5-flare | nezhagate-image | capabilities unverified | eligible | off | Provider announced a Flare/Sunburst 2K service disruption on 18 Oct 2026. Verify before routing. |
| GPT Image 2.5 Sunburst Edit | KIE (original) | gpt-image-2-5-sunburst-image-to-image | kie-market-image-edit | eligible | eligible | on | Unchanged: KIE cost versions, server key |
| GPT Image 2.5 Sunburst Edit | NezhaGate | gpt-image-2.5-sunburst | nezhagate-image | capabilities unverified | eligible | off | Only the 1K price is documented; a 2K price change was announced on 18 Oct 2026. |
| Nano Banana Pro Edit | KIE (original) | nano-banana-pro | kie-nano-banana | eligible | eligible | on | Unchanged: KIE cost versions, server key |
| Nano Banana Pro Edit | Duomi | gemini-3-pro-image-preview | duomi-nano-banana | capabilities unverified | eligible | off | Needs an API key and a verified test; maximum reference count not documented (8 assumed). |
| Nano Banana Pro Edit | NezhaGate | nano-banana-pro | nezhagate-image | capabilities unverified | eligible | off | Needs an API key and a verified test (identity preservation, size) before routing. |
| FLUX.2 Pro Edit | KIE (original) | flux-2/pro-image-to-image | kie-flux-2 | eligible | eligible | on | Unchanged: KIE cost versions, server key |
| Seedream 5.0 Flash Edit | KIE (original) | seedream/5-flash-image-to-image | kie-seedream-5 | eligible | eligible | on | Unchanged: KIE cost versions, server key |
| Seedream 5.0 Flash Edit | APIMart | seedream-5-0-flash | apimart-image | capabilities unverified | eligible | off | Each reference image after the first has an undocumented surcharge: only one-image edits have a known cost. |
| GPT Image 2.5 Flare | KIE (original) | gpt-image-2-5-flare-text-to-image | kie-market-image | eligible | eligible | on | Unchanged: KIE cost versions, server key |
| GPT Image 2.5 Flare | Duomi | — | — | pricing unverified | unresolved | off | No integration in this release; Duomi's channel notice raises size-reliability concerns. |
| GPT Image 2.5 Flare | NezhaGate | gpt-image-2.5-flare | nezhagate-image | capabilities unverified | eligible | off | Provider announced a Flare/Sunburst 2K service disruption on 18 Oct 2026; 1K output is resized from the native frame. Verify before routing. |
| GPT Image 2.5 Sunburst | KIE (original) | gpt-image-2-5-sunburst-text-to-image | kie-market-image | eligible | eligible | on | Unchanged: KIE cost versions, server key |
| GPT Image 2.5 Sunburst | NezhaGate | gpt-image-2.5-sunburst | nezhagate-image | capabilities unverified | eligible | off | Only the 1K price is documented; a 2K price change was announced on 18 Oct 2026. The Sunburst rate is described as temporary. |
| Nano Banana Pro | KIE (original) | nano-banana-pro | kie-nano-banana | eligible | eligible | on | Unchanged: KIE cost versions, server key |
| Nano Banana Pro | Duomi | gemini-3-pro-image-preview | duomi-nano-banana | capabilities unverified | eligible | off | Needs an API key and a verified test; channel identity and native output not confirmed. |
| Nano Banana Pro | PoYo | — | — | pricing unverified | unresolved | off | No PoYo image integration in this release; NezhaGate and Duomi quotes are lower. |
| Nano Banana Pro | NezhaGate | nano-banana-pro | nezhagate-image | capabilities unverified | eligible | off | Needs an API key and a verified test (native size and quality) before routing. |
| Nano Banana 2 | KIE (original) | nano-banana-2 | kie-nano-banana | eligible | eligible | on | Unchanged: KIE cost versions, server key |
| Nano Banana 2 | Duomi | gemini-3.1-flash-image-preview | duomi-nano-banana | capabilities unverified | eligible | off | Needs an API key and a verified test; channel identity and native output not confirmed. |
| Nano Banana 2 | PoYo | — | — | pricing unverified | unresolved | off | No PoYo image integration in this release. |
| FLUX.2 Pro | KIE (original) | flux-2/pro-text-to-image | kie-flux-2 | eligible | eligible | on | Unchanged: KIE cost versions, server key |
| FLUX.2 Pro | APIMart | — | — | pricing unverified | unresolved | off | Billed per output and input megapixel; exact pixel billing per Genlixs size not modelled yet. |
| Seedream 5.0 Flash | KIE (original) | seedream/5-flash-text-to-image | kie-seedream-5 | eligible | eligible | on | Unchanged: KIE cost versions, server key |
| Seedream 5.0 Flash | PoYo | — | — | pricing unverified | unresolved | off | No PoYo image integration in this release. |
| Seedream 5.0 Flash | APIMart | seedream-5-0-flash | apimart-image | capabilities unverified | eligible | off | Needs an API key and a verified test before routing. |
| Veo 3.1 Fast | KIE (original) | veo-3-1 | kie-veo-3-1 | eligible | eligible | on | Unchanged: KIE cost versions, server key |
| Veo 3.1 Fast | Duomi | veo3.1-fast | — | pricing unverified | unresolved | off | Clip duration and audio equivalence not established in the price table; the 4K route is listed offline. No integration in this release. |
| Veo 3.1 Fast | PoYo | — | — | pricing unverified | unresolved | off | Clip duration not confirmed; no PoYo video integration for Veo in this release. |
| Veo 3.1 Fast | APIMart | — | — | pricing unverified | unresolved | off | EXT channel: duration, audio, resolution and channel equivalence not verified. |
| Veo 3.1 Lite | KIE (original) | veo-3-1 | kie-veo-3-1 | eligible | eligible | on | Unchanged: KIE cost versions, server key |
| Veo 3.1 Lite | PoYo | — | — | pricing unverified | unresolved | off | Duration, audio and resolution equivalence not verified. |
| Veo 3.1 Lite | APIMart | — | — | pricing unverified | unresolved | off | EXT channel: listed clip configuration not matched to Genlixs settings. |
| Veo 3.1 Quality | KIE (original) | veo-3-1 | kie-veo-3-1 | eligible | eligible | on | Unchanged: KIE cost versions, server key |
| Kling 3.0 | KIE (original) | kling-3.0/video | kie-kling-3-v2 | eligible | eligible | on | Unchanged: KIE cost versions, server key |
| Kling 3.0 | Duomi | — | — | pricing unverified | unresolved | off | No integration in this release (Duomi Kling official format). |
| Kling 3.0 | Cuddler | kling-3.0 | cuddler-video | capabilities unverified | eligible | off | Needs an API key and a verified test. The result download host is not documented; confirm it with a test and add it to MEDIA_FETCH_ALLOWED_H |
| Seedance 2.5 | KIE (original) | bytedance/seedance-2-5 | kie-seedance-2-v2 | eligible | eligible | on | Unchanged: KIE cost versions, server key |
| Seedance 2.5 | PoYo | — | — | discovered | unresolved | off | No PoYo Seedance 2.5 quote or integration identified. |
| Seedance 2.5 | NezhaGate | seedance-2.5 | nezhagate-video | capabilities unverified | eligible | off | Needs an API key and a verified test. No first/last-frame mode; audio cannot be switched off. |
| Seedance 2.5 | Cuddler | seedance-2.5 | cuddler-video | capabilities unverified | eligible | off | Token-priced: only the 480p estimate is published. The result download host is not documented; confirm it with a test and add it to MEDIA_FE |
| Seedance 2.5 | APIMart | seedance-2.5 | apimart-video | capabilities unverified | eligible | off | Needs an API key and a verified test before routing. |
| Seedance 2.0 Fast | KIE (original) | bytedance/seedance-2-fast | kie-seedance-2-v2 | eligible | eligible | on | Unchanged: KIE cost versions, server key |
| Seedance 2.0 Fast | NezhaGate | seedance-2.0-fast | nezhagate-video | capabilities unverified | eligible | off | Needs an API key and a verified test. No first/last-frame mode; audio cannot be switched off. |
| Seedance 2.0 Fast | APIMart | seedance-2.0-fast | apimart-video | capabilities unverified | eligible | off | Needs an API key and a verified test; whether sound changes the price is not documented. |
| Wan 2.6 | KIE (original) | wan/2-6-text-to-video | kie-wan-2-6 | eligible | eligible | on | Unchanged: KIE cost versions, server key |
| Wan 2.6 | APIMart | — | — | discovered | unresolved | off | Ordinary Wan 2.6 price not established (Flash prices must not be applied). |
| Veo 3.1 Extend | KIE (original) | veo/extend | kie-veo-extend | eligible | eligible | on | Unchanged: KIE cost versions, server key |
| Seedance 2.5 Edit | KIE (original) | bytedance/seedance-2-5 | kie-seedance-edit | eligible | eligible | on | Unchanged: KIE cost versions, server key |
| Kling 3.0 Motion Control | KIE (original) | kling-3.0/motion-control | kie-kling-motion | eligible | eligible | on | Unchanged: KIE cost versions, server key |
| Kling 3.0 Motion Control | Duomi | — | — | pricing unverified | unresolved | off | No integration in this release (Duomi Kling official-format motion control). |
| Kling 3.0 Motion Control | PoYo | kling-3.0-motion-control | poyo-kling-motion | capabilities unverified | eligible | off | Needs an API key and one verified test (billed seconds, orientation limits, output) before routing. |

Review inventory (products without a Genlixs model, compared only with the same product at other suppliers; none can be
routed until a Genlixs model and an integration exist):

**dominated (25):** APIMart: FLUX.1 Kontext; APIMart: Grok Imagine image (Quality); APIMart: Grok Imagine image (Standard); KIE: Grok Video (original); Duomi: Kling 2.5 Turbo Pro; Duomi: Kling 2.6 Motion Control; KIE: Kling O3 (Omni); NezhaGate: Nano Banana 2.1; PoYo: Nano Banana 2.1; KIE: Nano Banana 2.1; KIE: PixVerse V6; Cuddler: PixVerse V6; PoYo: Qwen Image 3.0; Cuddler: Runway Gen-4.5; APIMart: Seedance 2.0; KIE: Seedream 4.0; KIE: Seedream 4.5; APIMart: Seedream 4.5; Cuddler: Seedream 5.0 Lite (2K); KIE: Seedream 5.0 Lite (2K); KIE: Seedream 5.0 Pro (ordinary generation); KIE: Wan 2.6 Flash image to video; APIMart: Wan 2.7 text to video; KIE: Wan 3.0; APIMart: Z-Image (Turbo).

**eligible (35):** KIE: FLUX.1 Kontext; Cuddler: GPT Image 2 (low quality); NezhaGate: GPT Image 2 (medium); NezhaGate: Grok Imagine image (Quality); NezhaGate: Grok Imagine image (Standard); Duomi: Grok Video (original); Duomi: Grok Video 1.5; KIE: Kling 2.5 Turbo Pro; PoYo: Kling 2.5 Turbo Pro; PoYo: Kling 2.6 Motion Control; PoYo: Kling O3 (Omni); Duomi: Nano Banana (original); Duomi: Nano Banana 2 Lite; Duomi: Nano Banana 2.1; APIMart: PixVerse V6; APIMart: Qwen Image 3.0; PoYo: Runway Gen-4.5; Cuddler: Seedance 2.0; KIE: Seedance 2.0 Fast with reference video; APIMart: Seedance 2.0 Fast with reference video; NezhaGate: Seedance 2.0 Fast with reference video; APIMart: Seedance 2.0 Mini; NezhaGate: Seedance 2.5 · 30 s; APIMart: Seedream 4.0; PoYo: Seedream 4.5; PoYo: Seedream 5.0 Lite (2K); APIMart: Seedream 5.0 Pro (ordinary generation); APIMart: Vidu Q3 Turbo; PoYo: Vidu Q4; Cuddler: Vidu Q4 Preview; APIMart: Wan 2.6 Flash image to video; PoYo: Wan 2.7 text to video; APIMart: Wan 3.0; NezhaGate: Wan 3.0; KIE: Z-Image (Turbo).

**unresolved (27):** KIE: FLUX newer variants / Ideogram / Recraft; APIMart: Gemini Omni 1.1 Flash (EXT); NezhaGate: Gemini Omni Flash; APIMart: GPT Image 1.5; APIMart: GPT Image 2 (EXT channel); Duomi: GPT Image 2; NezhaGate: Grok Imagine Video 1.5; APIMart: Grok Imagine Video 1.5 (EXT); Cuddler: HappyHorse 1.0 / 1.1; Cuddler: Kling 2.6 Pro; Duomi: Kling 2.6 Pro; Duomi: Kling image tools; Cuddler: Kling O1; Cuddler: LTX 2.5; APIMart: Midjourney; APIMart: MiniMax H3 / H3 Max; NezhaGate: MiniMax H3; APIMart: MiniMax Hailuo 02 / 2.3; APIMart: Qwen Image 3.0 Pro; Cuddler: Runway Gen-4 Turbo; KIE: Seedance 1.5 Pro; PoYo: Seedance 1.5 Pro; Duomi: Sora (official relay); NezhaGate: Veo 3.1; APIMart: Vidu Q4; NezhaGate: Wan 3.0 Prime; Cuddler: Wan 3.0 Prime.

## 9. Rollback

`supabase/rollbacks/20261018181012_multi_provider_routing.rollback.sql` restores the previous quote, job, test, catalog
and balance functions and switches every non-original offer off; keep or redeploy the previous release. Tables,
ledger rows, prices, keys and audit history stay. Tested on the local database: migrations → test 08 → rollback →
tests 01–07 pass.

## 10. Not done here (needs the owner or a budget)

- No supplier key was available, so no live connection test, balance read or paid generation ran against the five new
  suppliers. Their request builders follow the published documentation and are covered by contract tests with the
  documented replies only.
- Every new offer needs an authorised paid test (output size/length/sound, billed seconds, result host) before it is
  marked Verified. Cuddler's result host must be confirmed and added to `MEDIA_FETCH_ALLOWED_HOSTS`.
- Exchange and funding terms: CNY and Duomi point conversions are illustrative; funding fees other than Cuddler's
  published card fee are not assumed.
- Unresolved groups (MiniMax, Sora, Veo/Gemini aliases, Wan 3 Prime, Grok Video 1.5 EXT, GPT Image EXT/Duomi quality
  mapping, megapixel FLUX.2, older Runway/Kling O1, image utilities) stay unresolved until account evidence exists.
