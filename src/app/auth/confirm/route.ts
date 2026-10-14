import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { serverClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/auth/redirect";

const TYPES: EmailOtpType[] = ["signup", "email", "recovery", "email_change", "invite", "magiclink"];

/** Token-hash email links (server-side templates: /auth/confirm?token_hash=…&type=…&next=…). */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = safeNext(url.searchParams.get("next")) ?? (type === "recovery" ? "/account/reset" : "/studio");
  if (tokenHash && type && TYPES.includes(type)) {
    try {
      const supabase = await serverClient();
      const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
      if (!error) return NextResponse.redirect(new URL(next, url.origin));
    } catch {
      // fall through
    }
  }
  return NextResponse.redirect(new URL("/sign-in?reason=link", url.origin));
}
