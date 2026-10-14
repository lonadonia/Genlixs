import { NextResponse, type NextRequest } from "next/server";
import { serverClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth/redirect";

/** Email confirmation / password recovery landing (PKCE code exchange), then a same-site redirect. */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const next = safeNext(url.searchParams.get("next")) ?? "/studio";
  const code = url.searchParams.get("code");
  if (code) {
    try {
      const supabase = await serverClient();
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(new URL(next, url.origin));
    } catch {
      // fall through to the sign-in page with a reason
    }
  }
  return NextResponse.redirect(new URL("/sign-in?reason=link", url.origin));
}
