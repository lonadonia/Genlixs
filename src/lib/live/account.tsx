"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, ApiClientError } from "./api";
import type { Me, Notification, Wallet } from "./types";

/**
 * Signed-in account state for the live interfaces. The server is the authority: this context only caches the
 * last canonical read and refetches on focus, on an interval and after every mutation (§21.1).
 */
type AccountState = {
  hydrated: boolean;
  me: Me | null;
  wallet: Wallet | null;
  notifications: Notification[];
  unread: number;
  refresh: () => Promise<void>;
  refreshWallet: () => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AccountState | null>(null);

export function AccountProvider({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [me, setMe] = useState<Me | null>(null);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const signedIn = useRef(false);

  const refreshWallet = useCallback(async () => {
    if (!signedIn.current) return;
    const [w, n] = await Promise.allSettled([
      api<Wallet>("/api/wallet"),
      api<{ items: Notification[]; unread: number }>("/api/notifications"),
    ]);
    if (w.status === "fulfilled") setWallet(w.value);
    if (n.status === "fulfilled") {
      setNotifications(n.value.items);
      setUnread(n.value.unread);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const m = await api<Me>("/api/me");
      setMe(m);
      signedIn.current = true;
      await refreshWallet();
    } catch (e) {
      if (e instanceof ApiClientError && e.status === 401) {
        signedIn.current = false;
        setMe(null);
        setWallet(null);
      }
    } finally {
      setHydrated(true);
    }
  }, [refreshWallet]);

  const signOut = useCallback(async () => {
    await api("/api/auth/sign-out", { method: "POST", body: {} }).catch(() => null);
    signedIn.current = false;
    setMe(null);
    setWallet(null);
    setNotifications([]);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial canonical read
    void refresh();
    const onFocus = () => void refreshWallet();
    window.addEventListener("focus", onFocus);
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshWallet();
    }, 30_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(t);
    };
  }, [refresh, refreshWallet]);

  const value = useMemo(
    () => ({ hydrated, me, wallet, notifications, unread, refresh, refreshWallet, signOut }),
    [hydrated, me, wallet, notifications, unread, refresh, refreshWallet, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAccount(): AccountState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAccount outside AccountProvider");
  return v;
}

/** Small data hook: loads `path`, exposes reload; errors are surfaced, never replaced by sample data. */
export function useApi<T>(path: string | null, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiClientError | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    const ac = new AbortController();
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading flag for a new request
    setLoading(true);
    api<T>(path, { signal: ac.signal })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e) => {
        if (e instanceof DOMException && e.name === "AbortError") return;
        setError(e instanceof ApiClientError ? e : new ApiClientError("UNKNOWN", "Something went wrong.", 0));
      })
      .finally(() => {
        if (!ac.signal.aborted) setLoading(false);
      });
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, tick, ...deps]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, setData };
}
