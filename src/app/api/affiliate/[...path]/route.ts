import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ApiError, input, ok, readJson, rpc, withUser } from "@/lib/server/http";

/**
 * Partner portal API (§20.2). An explicit allowlist of reads and actions; every RPC re-checks that the caller
 * owns an affiliate account in the right state. Unknown paths are 404.
 */
type Handler = (req: NextRequest, db: SupabaseClient, rest: string[]) => Promise<unknown>;

const READS: Record<string, string> = {
  overview: "get_affiliate_overview",
  links: "list_affiliate_links",
  referrals: "list_affiliate_referrals",
  commissions: "list_affiliate_commissions",
  payouts: "list_affiliate_payouts",
};

const ACTIONS: Record<string, Handler> = {
  "POST applications": async (req, db) => {
    const b = await readJson(req);
    const channels = Array.isArray(b.channels) ? b.channels.slice(0, 5).map((c: unknown, i: number) => input.str(c, `Channel ${i + 1}`, { min: 1, max: 200 })) : [];
    return rpc(db, "apply_affiliate", {
      p_application: {
        name: input.str(b.name, "Name", { min: 1, max: 80 }),
        country: input.str(b.country, "Country", { min: 2, max: 60 }),
        channels,
        niche: input.str(b.niche, "Niche", { max: 120, optional: true }) ?? null,
        method: input.str(b.method, "Promotion method", { max: 600, optional: true }) ?? null,
        termsAccepted: input.bool(b.termsAccepted, "Terms"),
      },
    });
  },
  "POST links": async (req, db) => {
    const b = await readJson(req);
    return rpc(db, "create_affiliate_link", {
      p_destination: input.str(b.destination, "Destination", { max: 120, optional: true }) ?? "/",
      p_campaign: input.str(b.campaign, "Campaign", { max: 60, optional: true }) ?? null,
      p_channel: input.str(b.channel, "Channel", { max: 60, optional: true }) ?? null,
      p_sub_id: input.str(b.subId, "Sub-ID", { max: 60, optional: true }) ?? null,
    });
  },
  "POST links/:id/archive": async (_req, db, rest) => rpc(db, "archive_affiliate_link", { p_link_id: input.uuid(rest[1], "Link") }),
  "PUT payout-destination": async (req, db) => {
    const b = await readJson(req);
    return rpc(db, "set_payout_destination", {
      p_method: input.oneOf(b.method, "Payout method", ["bank_transfer", "paypal", "wise", "other"] as const),
      p_display_hint: input.str(b.displayHint, "Account hint", { min: 2, max: 60 }),
    });
  },
};

function route(method: string, path: string[]): Handler | null {
  if (method === "GET" && path.length === 1 && READS[path[0]]) return (_r, db) => rpc(db, READS[path[0]]);
  const key = `${method} ${path.map((p, i) => (i === 1 && path.length === 3 ? ":id" : p)).join("/")}`;
  return ACTIONS[key] ?? null;
}

const handle = withUser<{ path: string[] }>(async (req, { supabase, params, requestId }) => {
  const path = params.path ?? [];
  const h = route(req.method, path);
  if (!h) throw new ApiError("NOT_FOUND", "Not found.", 404);
  return ok(await h(req, supabase, path), req.method === "GET" ? 200 : 201, requestId);
});

export { handle as GET, handle as POST, handle as PUT };
