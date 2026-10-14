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
| Provider balance low/unknown | Read every ~10 minutes by the control worker and live on the KIE balance tab | Fund the KIE account; if spending must stop, set `generation_paused` to `true` in Terms & settings (or `GENERATION_PAUSED=true` in Vercel). Running jobs continue. |
| Pause one model | Maintenance or unexpected cost | Models & pricing → model → Availability → **Maintenance** with a customer note, or switch it off (Disabled). New quotes and submissions are refused at once; existing jobs reconcile normally. |

## Models, prices and the KIE balance

Step-by-step owner guide: `docs/CATALOG_AND_PRICING.md` §1.

| Situation | Action |
| --- | --- |
| KIE balance shows **Refresh failed** | The value shown is the last real reading with its time. Check the error code (`KIE_401` key revoked or wrong, `TIMEOUT`/`NETWORK` transient, `NOT_CONFIGURED` key missing on this deployment). Never treat it as zero. |
| A private test stays **Running** | It follows the normal pipeline (unknown submissions are never resent). Open Admin → Jobs → filter by the job reference; the same recheck / attach-verified-task / release actions apply (a test has nothing to release). |
| Test import fails with **host not allowed** | The result came from a host outside `MEDIA_FETCH_ALLOWED_HOSTS`. Confirm it is a KIE delivery host, add it in Vercel, redeploy, then **Retry import** on the job. |
| KIE changed a price | Model → KIE cost → record a new cost version with the source link and date; then Bulk pricing → preview → publish. Prices already quoted keep their version; new quotes use the new one. |
| A published price was wrong | Model → Pricing → price versions → **Restore as new version** on the last good one (history is never edited), or publish a corrected draft. |
| Bulk pricing says **something changed since this preview** | Another staff member changed prices, costs or packages. Press **Refresh preview**, review, apply again. |
| Need to see who changed what | Model → Activity (model, price and batch entries) or Admin → Audit log; Bulk pricing lists every batch with old → new versions. |

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

## Secrets rotation

Rotate in the provider dashboard first, then update the Vercel variable and redeploy. For `INTERNAL_WORKER_TOKEN`, update the
Vault secret `genlixs_worker_token` at the same time. Rotating `REFERRAL_COOKIE_SIGNING_KEY` invalidates pending referral
cookies (visitors who clicked but have not signed up yet).

## Health checks

`GET /api/internal/health` with the worker token returns configuration presence and queue/job counts. Admin → Overview shows
queue lengths, the oldest due work item, dead letters, watchdog heartbeat and wallet reconciliation (must be "no mismatches").
