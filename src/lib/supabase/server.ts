import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { ConfigError, env } from "@/lib/server/env";
import type { Database } from "./database.types";

/** Per-request client carrying the visitor's session cookies (§5). Authorization always uses getUser(). */
export async function serverClient(): Promise<SupabaseClient<Database>> {
  const url = env.supabaseUrl();
  const key = env.publishableKey();
  if (!url || !key) throw new ConfigError("Supabase", ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]);
  const store = await cookies();
  return createServerClient<Database>(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a Server Component: the proxy refreshes the session cookies instead.
        }
      },
    },
  });
}

/** Verified user (fresh Auth record), never the unverified session object (§7.1). */
export async function currentUser(): Promise<{ supabase: SupabaseClient<Database>; user: User | null }> {
  const supabase = await serverClient();
  const { data, error } = await supabase.auth.getUser();
  return { supabase, user: error ? null : data.user };
}
