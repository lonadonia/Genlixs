"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/live/api";

/**
 * Short-lived signed links for the owner's private files (outputs and their own uploads). Links are cached until a
 * minute before they expire and renewed on demand, so an expired link is just fetched again — it is never shown as
 * a failed generation.
 */
const cache = new Map<string, { url: string; expires: number }>();
const pending = new Map<string, Promise<string>>();

export function signedUrl(assetId: string, force = false): Promise<string> {
  const hit = cache.get(assetId);
  if (!force && hit && hit.expires - Date.now() > 60_000) return Promise.resolve(hit.url);
  const inflight = pending.get(assetId);
  if (inflight && !force) return inflight;
  const p = api<{ url: string; expiresAt: string }>(`/api/assets/${assetId}/download?inline=1`, { method: "POST", body: {} })
    .then((d) => {
      cache.set(assetId, { url: d.url, expires: Date.parse(d.expiresAt) || Date.now() + 240_000 });
      return d.url;
    })
    .finally(() => pending.delete(assetId));
  pending.set(assetId, p);
  return p;
}

export function useSignedUrl(assetId: string | null) {
  const [state, setState] = useState<{ id: string | null; url: string | null; error: boolean }>({ id: null, url: null, error: false });
  useEffect(() => {
    if (!assetId) return;
    let cancelled = false;
    signedUrl(assetId)
      .then((url) => !cancelled && setState({ id: assetId, url, error: false }))
      .catch(() => !cancelled && setState({ id: assetId, url: null, error: true }));
    return () => {
      cancelled = true;
    };
  }, [assetId]);
  // A media element that failed to load (usually an expired link) asks for a fresh one once.
  const renew = useCallback(() => {
    if (!assetId) return;
    signedUrl(assetId, true)
      .then((url) => setState({ id: assetId, url, error: false }))
      .catch(() => setState({ id: assetId, url: null, error: true }));
  }, [assetId]);
  const current = state.id === assetId ? state : { id: assetId, url: null, error: false };
  return { url: current.url, error: current.error, renew };
}
