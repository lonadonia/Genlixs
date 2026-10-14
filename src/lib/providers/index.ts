import "server-only";
import { env, isProductionDeployment } from "@/lib/server/env";
import { FakeProvider } from "./fake";
import { KieProvider } from "./kie/client";
import type { GenerationProvider } from "./types";

/**
 * Selects the generation provider. The fake is never chosen implicitly: it requires an explicit flag and a
 * non-production deployment. Without a KIE key the real provider fails closed with a configuration error.
 */
export function generationProvider(): GenerationProvider {
  return env.fakeProvider() ? new FakeProvider() : new KieProvider();
}

/**
 * Whether workers may submit. Outside production a real (paid) provider additionally needs
 * ALLOW_PAID_PROVIDER_TESTS=true, so a preview or local run never spends supplier credits by accident.
 */
export function providerConfigured() {
  if (env.fakeProvider()) return true;
  if (!env.kieApiKey()) return false;
  return isProductionDeployment() || env.allowPaidProviderTests();
}
