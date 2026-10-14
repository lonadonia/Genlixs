import { ok, rpc, withUser } from "@/lib/server/http";

/** Own spendable/reserved balances and lot expiry summary. Never cached. */
export const GET = withUser(async (_req, { supabase, requestId }) => ok(await rpc(supabase, "get_wallet"), 200, requestId));
