"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from "@/lib/config";

let client: SupabaseClient | null = null;

/** Browser client with the publishable key; the signed-in user's JWT decides what RLS lets it read (§4.3). */
export function browserClient(): SupabaseClient {
  if (!client) client = createBrowserClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  return client;
}
