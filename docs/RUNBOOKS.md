# Operating runbooks

All actions below are available in the admin console and are recorded in the append-only audit log (routine model and price
actions get an automatic description; a typed reason is required for exceptional overrides and money movements).
Never edit financial tables by hand; every correction is a new journal entry.

## Generation

| Situation | What it means | Action |
| --- | --- | --- |
| Job in **Confirming with the service** (`submission_unknown`) | The create call timed out or was ambiguous; the task may exist and cost money | Wait for the KIE callback (it binds automatically after the correlation check). If none arrives, look up the task in the KIE dashboard by time/prompt and use **Attach verified task** with its id — the binding is accepted only if the task's callback URL carries this attempt's id and token. Otherwise **Release credits (no delivery)**. Never resubmit. |
| **Being checked by our team** (`review_required`) | Incomplete output, unreadable status after many checks, import failed repeatedly, or binding evidence mismatch | Open the job: attempts, observations and work items show why. **Recheck status** or **Retry import** for the same task; release only if there is definitely no deliverable. |
| **Taking longer than usual** | Past the delayed threshold (30 min); credits stay reserved | Nothing unless it passes the 24 h deadline, which releases automatically. Video can take over 10 minutes. |
| Dead letters on Overview | A work item failed 25 times | Fix the cause (configuration, provider outage), then recheck the affected jobs. |
| Provider balance low/unknown | Read every ~10 minutes by the control worker and live on Admin → Providers & balances | Fund the KIE account; if spending must stop, turn on "Pause all new generations" in Overview → Service settings (or `GENERATION_PAUSED=true` in Vercel). Running jobs continue. |
| Pause one model | Maintenance or unexpected cost | Models & pricing → switch it off, or Models & pricing → the model → **Technical details and tests → Status** → "Paused for maintenance" with a customer note. New quotes and submissions are refused at once; existing jobs reconcile normally. |
| Everything stays **Waiting in queue** | The per-minute wake-up cannot reach the workers. Admin → Providers & balances → **More → Generation pipeline** (and a red banner) shows the last wake-up error (15 Oct 2026: the Vault origin was an example domain that does not resolve) | Set the Vault secret `genlixs_worker_base_url` to the live origin (`https://genlixs.vercel.app` until a custom domain is live; the token in `genlixs_worker_token` must equal `INTERNAL_WORKER_TOKEN`). Waiting jobs are picked up at the next minute; nothing is resent twice. |
| **Sending jobs to KIE: Refused** although the balance is positive | KIE answered 401/402 for the account (15 Oct 2026: "Credits insufficient" with 969 credits shown). New quotes pause for 5 minutes, waiting jobs retry and are returned (credits released once) after 4 refusals or 20 minutes | Check the key's limits and status at kie.ai/api-key and the KIE balance; nothing needs changing in Genlixs. The panel shows the refusal text and when quotes resume. |
| **Saving results: Setting ignored** | `MEDIA_FETCH_ALLOWED_HOSTS` is set but contains no valid host name, so it adds nothing (the reviewed KIE delivery hosts still apply) | Set it to comma-separated host names (for example `tempfile.aiquickdraw.com,file.aiquickdraw.com,tempfile.redpandaai.co,file.redpandaai.co`) and redeploy, or remove it. Never add hosts that are not KIE delivery hosts. |
| A delivered job shows a broken preview | The signed link expired (links last minutes) | Nothing: the studio fetches a new link automatically; it is not a failed generation. |

## Models, prices and provider balances

Step-by-step owner guide: `docs/CATALOG_AND_PRICING.md` §1.

| Situation | Action |
| --- | --- |
| A balance on Providers & balances shows **Last read failed** / KIE **Refresh failed** | The value shown is the last real reading with its time. Check the error code (`KIE_401` key revoked or wrong, `TIMEOUT`/`NETWORK` transient, `NOT_CONFIGURED` key missing on this deployment). Never treat it as zero. |
| A private test stays **Running** | It follows the normal pipeline (unknown submissions are never resent). Open Admin → Jobs → filter by the job reference; the same recheck / attach-verified-task / release actions apply (a test has nothing to release). |
| Test import fails with **host not allowed** | The result came from a host outside `MEDIA_FETCH_ALLOWED_HOSTS`. Confirm it is a KIE delivery host, add it in Vercel, redeploy, then **Retry import** on the job. |
| KIE changed a price | Models & pricing → the model → **Technical details and tests → KIE cost** → record a new cost version with the source link and date. The model is re-priced at once under the global policy; quotes already taken are re-checked (customers simply get the new price), accepted jobs keep theirs. |
| A price looks wrong | Prices are not edited per model. Check the model drawer's **How the price is set**: a wrong KIE reference → record the correct KIE cost; a wrong markup or credit value → change it in the pricing panel and **Save & apply**. Every earlier price version stays in the history. |
| A model shows **KIE reference needed** | Its KIE price list does not cover its settings, so it has no price and cannot be switched on (no other supplier's price is used). Record the KIE cost for its settings; the price appears at once. |
| **Save & apply** says **changed meanwhile** | Another staff member saved the policy first. Reload, look at the preview again, save again. Nothing was overwritten. |
| Need to see who changed what | Models & pricing → the model → **Technical details and tests → Activity**, or Admin → Audit log (`pricing.policy`, `pricing.reference`, `supplier_cost.update`). |

## Payments and refunds

- A paid event grants credits exactly once per gateway payment id; duplicates are ignored. If **Billing receipts failed**
  shows a count, inspect `app_private.billing_event_receipts` (state, error) and the gateway dashboard before retrying.
- **Refund**: Payments → Refund with the amount in minor units and a reason. Unused credits from that purchase are put on hold
  immediately and revoked when the gateway confirms; spent credits are never clawed back silently. If the gateway outcome is
  unknown, the refund stays `submission_unknown` until reconciled — do not submit it twice.
- Disputes put the related commission on hold; a lost dispute revokes remaining purchased units.

## Partner payouts

1. Finance prepares a batch (Payouts → Prepare). Only eligible commissions past the hold, for partners with verified
   payout details unchanged for 48 h and above the threshold, are included.
2. A different staff member reviews it (the owner may self-review only as a recorded single-owner exception).
3. Mark **submitting** before sending money, then **paid** with the bank reference and evidence. If the transfer outcome is
   uncertain, mark **outcome unknown** — the amounts stay reserved until confirmed. Failed/cancelled batches return the
   commissions to available.
4. Refunds after payout create negative carry-forward adjustments on the next batch.

## Accounts

- Suspending an account blocks new quotes, generations and purchases; already accepted jobs and payments still settle.
- Credit adjustments (goodwill, correction, promotion, support) add a separate lot or debit with a reason and idempotency key.
- Staff role changes are owner-only and require a fresh sign-in.
- **Temporary QA accounts** (`qa-…@genlixs.test`): after the checks, finance revokes unused test credits (correction with
  a reason), the account deletes its own files from the studio (private-test outputs stay as model evidence), operations
  suspends the account with a reason, its staff roles are switched off, and its sign-in (auth user, identities, sessions)
  is deleted. Jobs, ledger entries, quotes, test runs and audit rows stay: they are append-only financial and verification
  records, and nothing outside the auth schema references the auth user. An account that never generated anything can be
  removed completely (wallet row, profile, auth user).

## Secrets rotation

Rotate in the provider dashboard first, then update the Vercel variable and redeploy. For `INTERNAL_WORKER_TOKEN`, update the
Vault secret `genlixs_worker_token` at the same time. Rotating `REFERRAL_COOKIE_SIGNING_KEY` invalidates pending referral
cookies (visitors who clicked but have not signed up yet).

## Health checks

`GET /api/internal/health` with the worker token returns configuration presence and queue/job counts. Admin → Overview shows
queue lengths, the oldest due work item, dead letters, watchdog heartbeat and wallet reconciliation (must be "no mismatches").
