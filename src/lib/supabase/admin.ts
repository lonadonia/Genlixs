import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ConfigError, env } from "@/lib/server/env";

let admin: SupabaseClient | null = null;

/**
 * Elevated backend client (secret key, bypasses RLS). Used only by workers, webhooks and narrowly scoped
 * server steps that call service-only RPCs. Never reuses a customer cookie or session (§5).
 */
export function adminClient(): SupabaseClient {
  const url = env.supabaseUrl();
  const key = env.secretKey();
  if (!url || !key) throw new ConfigError("Backend worker access", ["SUPABASE_URL", "SUPABASE_SECRET_KEY"]);
  if (!admin) {
    admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  }
  return admin;
}

export function adminConfigured() {
  return Boolean(env.supabaseUrl() && env.secretKey());
}
