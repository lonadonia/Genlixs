"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiClientError } from "./api";
import type { Quote } from "./types";

/** What the server prices: the exact model, operation inputs and settings that would be submitted. */
export type QuoteRequest = {
  modelId: string;
  prompt: string;
  options: Record<string, string | number>;
  referenceAssetIds?: string[];
  inputs?: Record<string, string[]>;
};

export type QuoteState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; quote: Quote }
  | { status: "error"; error: ApiClientError }
  | { status: "timeout" };

const DEBOUNCE_MS = 450;
const TIMEOUT_MS = 15_000;

/**
 * Server quote for the current request. Only the latest request can update the state (out-of-order replies are
 * ignored), every request is bounded by a timeout, an expired quote is refreshed, and `renew()` fetches a new
 * quote for the same input after the previous one was used, so the button never waits on a quote nobody asked for.
 */
export function useQuote(request: QuoteRequest | null, opts: { onUnavailable?: (code: string) => void } = {}) {
  const key = request ? JSON.stringify(request) : null;
  const [state, setState] = useState<QuoteState>({ status: "idle" });
  const [nonce, setNonce] = useState(0);
  const seq = useRef(0);
  const requestRef = useRef(request);
  const onUnavailable = useRef(opts.onUnavailable);
  useEffect(() => {
    requestRef.current = request;
    onUnavailable.current = opts.onUnavailable;
  });

  useEffect(() => {
    const id = ++seq.current;
    if (!key) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the input no longer describes a priceable request
      setState({ status: "idle" });
      return;
    }
    setState({ status: "loading" });
    const ac = new AbortController();
    let cancelled = false;
    let timedOut = false;
    let deadline = 0;
    const timer = window.setTimeout(async () => {
      const body = requestRef.current;
      if (!body) return;
      deadline = window.setTimeout(() => {
        timedOut = true;
        ac.abort();
      }, TIMEOUT_MS);
      try {
        const q = await api<Quote>("/api/generation/quotes", { body, signal: ac.signal });
        if (id === seq.current) setState({ status: "ready", quote: q });
      } catch (e) {
        if (id !== seq.current || cancelled) return;
        if (timedOut) return setState({ status: "timeout" });
        if (e instanceof ApiClientError) {
          setState({ status: "error", error: e });
          if (["MODEL_UNAVAILABLE", "MODEL_NOT_PRICED"].includes(e.code)) onUnavailable.current?.(e.code);
        } else {
          setState({ status: "error", error: new ApiClientError("NETWORK", "The price check did not complete. Try again.", 0) });
        }
      } finally {
        window.clearTimeout(deadline);
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      ac.abort();
      window.clearTimeout(timer);
      window.clearTimeout(deadline);
    };
  }, [key, nonce]);

  // A quote is valid for a few minutes; a lapsed quote is replaced before it can be used.
  const quote = state.status === "ready" ? state.quote : null;
  useEffect(() => {
    if (!quote) return;
    const t = window.setTimeout(() => setNonce((n) => n + 1), Math.max(Date.parse(quote.expiresAt) - Date.now() - 5_000, 0));
    return () => window.clearTimeout(t);
  }, [quote]);

  const renew = useCallback(() => setNonce((n) => n + 1), []);
  return { state, quote, renew };
}
