import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { imageEditRedirect } from "@/lib/studio-routes";

/**
 * Refreshes the Supabase session cookies on page and API requests (Next.js 16 `proxy`, guide §7.1).
 * Authorization is NOT decided here: every API route and RPC re-checks the user on the server.
 */
export async function proxy(request: NextRequest) {
  // Image editing moved into the Image studio: old links and bookmarks get a real redirect, query kept (the page
  // redirect in src/app/studio/edit stays as the fallback).
  if (request.nextUrl.pathname === "/studio/edit") {
    const params: Record<string, string[]> = {};
    request.nextUrl.searchParams.forEach((v, k) => {
      (params[k] ??= []).push(v);
    });
    return NextResponse.redirect(new URL(imageEditRedirect(params), request.url), 307);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return NextResponse.next({ request });

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: [
    // Skip static assets, media, and machine endpoints (webhooks/workers use their own verification).
    "/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|opengraph-image.png|media/|brand/|api/webhooks|api/internal|.*\\.(?:png|jpg|jpeg|gif|webp|svg|mp4|ico)$).*)",
  ],
};
