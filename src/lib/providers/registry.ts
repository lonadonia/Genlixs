import "server-only";
import { env } from "@/lib/server/env";
import { DEFAULT_MEDIA_HOSTS } from "@/lib/media/hosts";
import { apimartClient } from "./apimart";
import { cuddlerClient } from "./cuddler";
import { duomiClient } from "./duomi";
import { FakeProvider } from "./fake";
import { supportedAdapters } from "./kie/adapters";
import { KieProvider } from "./kie/client";
import { nezhagateClient } from "./nezhagate";
import { poyoClient } from "./poyo";
import type { ProviderBalance, ProviderClient, ProviderName } from "./types";

/**
 * The supplier adapters of this release. KIE keeps its existing client (request builders, classification, callback
 * evidence); it only receives the routed key. Every other provider is polled (no callbacks are trusted).
 */
const kieClient: ProviderClient = {
  name: "kie",
  adapters: supportedAdapters(),
  resultHosts: DEFAULT_MEDIA_HOSTS,
  balanceSupport: "api",
  submit: (req) => new KieProvider(req.key).submit(req),
  getTask: (taskId, { key }) => new KieProvider(key).getTask(taskId),
  async readBalance(key): Promise<ProviderBalance> {
    const r = await new KieProvider(key).readBalance();
    if (r.ok) return { ok: true, total: String(r.credits), available: null, held: null, unit: "kie_credit", scope: "wallet", note: null };
    return { ok: false, error: r.error, state: /^KIE_40[13]$/.test(r.error) ? "unauthorized" : "failed" };
  },
};

/** Local/preview stand-in (never in production): every route goes to the deterministic fake provider. */
const fake = new FakeProvider();
const fakeClient: ProviderClient = {
  name: "fake",
  adapters: [],
  resultHosts: [],
  balanceSupport: "none",
  submit: (req) => fake.submit(req),
  getTask: (taskId) => fake.getTask(taskId),
  readBalance: async () => ({ ok: false, error: "FAKE_PROVIDER_NO_BALANCE", state: "unsupported" }),
};

const CLIENTS: Record<Exclude<ProviderName, "fake">, ProviderClient> = {
  kie: kieClient,
  cuddler: cuddlerClient,
  apimart: apimartClient,
  nezhagate: nezhagateClient,
  poyo: poyoClient,
  duomi: duomiClient,
};

export function providerClient(name: ProviderName): ProviderClient {
  if (env.fakeProvider()) return fakeClient;
  const c = name === "fake" ? undefined : CLIENTS[name];
  if (!c) throw new Error(`no client for provider ${name}`);
  return c;
}

/** What each adapter can do in this release (for Admin; contains no secrets). */
export function providerCapabilities() {
  return Object.fromEntries(
    Object.values(CLIENTS).map((c) => [c.name, { adapters: [...c.adapters], resultHosts: [...c.resultHosts], balance: c.balanceSupport, usage: Boolean(c.readUsage) }]),
  );
}

/** Adapter ids implemented in code, per provider (a contract test compares them with the migrations). */
export const adaptersByProvider = () => Object.fromEntries(Object.values(CLIENTS).map((c) => [c.name, [...c.adapters].sort()]));
