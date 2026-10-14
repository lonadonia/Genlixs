import { NextResponse, type NextRequest } from "next/server";
import { adminClient, adminConfigured } from "@/lib/supabase/admin";
import { sha256Hex } from "@/lib/server/crypto";

/** Public share delivery: hash lookup, revocation/expiry checks, then a short-lived signed redirect. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const notFound = () => new NextResponse("This link is not available.", { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token) || !adminConfigured()) return notFound();
  const admin = adminClient();
  const { data } = await admin.rpc("resolve_share_link", { p_token_hash: sha256Hex(token) });
  if (!data) return notFound();
  const { data: signed } = await admin.storage.from(data.bucket).createSignedUrl(data.path, 120);
  if (!signed) return notFound();
  return NextResponse.redirect(signed.signedUrl, { status: 302, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}
