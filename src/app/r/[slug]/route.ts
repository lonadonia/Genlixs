import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/server/env";
import { REFERRAL_COOKIE, REFERRAL_MAX_AGE, signedReferral } from "@/lib/auth/referral";

/**
 * Referral link (§18.2). Records the click; the signed first-party attribution cookie is set only with consent
 * (`gx_consent=1`, or `?consent=1` from the consent prompt) and never when Global Privacy Control is on.
 * The destination is always one of the allowlisted same-site pages returned by the database.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const home = new URL("/", req.nextUrl.origin);
  const url = env.supabaseUrl();
  const key = env.publishableKey();
  if (!/^[A-Za-z0-9_-]{3,40}$/.test(slug) || !url || !key) return NextResponse.redirect(home);

  const gpc = req.headers.get("sec-gpc") === "1";
  const consent = !gpc && (req.cookies.get("gx_consent")?.value === "1" || req.nextUrl.searchParams.get("consent") === "1");
  let referrerHost: string | null = null;
  try {
    referrerHost = req.headers.get("referer") ? new URL(req.headers.get("referer")!).hostname : null;
  } catch {
    referrerHost = null;
  }
  const utm: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content"]) {
    const v = req.nextUrl.searchParams.get(k);
    if (v) utm[k] = v.slice(0, 100);
  }

  const anon = createClient(url, key, { auth: { persistSession: false } });
  const { data } = await anon.rpc("record_referral_click", {
    p_slug: slug, p_consent: consent, p_referrer_host: referrerHost, p_utm: Object.keys(utm).length ? utm : null,
  });
  const dest = typeof data?.destination === "string" && data.destination.startsWith("/") && !data.destination.startsWith("//") ? data.destination : "/";
  const target = new URL(dest, req.nextUrl.origin);
  // No decision yet: the consent prompt can re-open this link with consent if the visitor accepts.
  if (!consent && !gpc && !req.cookies.get("gx_consent")) target.searchParams.set("via", slug);
  const res = NextResponse.redirect(target);
  res.headers.set("Cache-Control", "no-store");
  const signed = data?.clickId ? signedReferral(String(data.clickId)) : null;
  if (signed) {
    res.cookies.set(REFERRAL_COOKIE, signed, {
      httpOnly: true, secure: req.nextUrl.protocol === "https:", sameSite: "lax", path: "/", maxAge: REFERRAL_MAX_AGE,
    });
  }
  return res;
}
