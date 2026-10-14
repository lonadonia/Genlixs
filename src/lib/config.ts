/**
 * Public runtime configuration (safe for the browser).
 *
 * The site runs against the real backend whenever the public Supabase URL and publishable key are set.
 * Without them it falls back to the design preview (simulated, clearly labelled) — useful for local design
 * review. API routes never fall back: they fail closed with an explicit "not configured" error.
 */
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

export const LIVE = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
