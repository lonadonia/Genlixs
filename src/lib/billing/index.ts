import "server-only";
import { ConfigError, env, isProductionDeployment } from "@/lib/server/env";
import { ApiError } from "@/lib/server/http";

/**
 * Payment gateway abstraction (guide §17.1). No live gateway has been chosen yet, so production has no adapter
 * and checkout answers "Payments are not available yet" (503). The `test` adapter exists only outside production
 * and drives the same durable receipt → events queue → wallet grant path as a real gateway would.
 */
export type CheckoutOrder = {
  orderId: string;
  ref: string;
  email: string | null;
  kind: "credit_pack" | "subscription";
  productKey: string;
  productName: string;
  amountMinor: string;
  currency: string;
  gatewayMapping: Record<string, unknown> | null;
};

/** A verified, gateway-neutral financial event as consumed by app_private.apply_billing_event. */
export type VerifiedEvent = { eventId: string; eventType: string; normalized: Record<string, unknown> };

export interface BillingGateway {
  readonly name: string;
  createCheckout(order: CheckoutOrder, urls: { successUrl: string; cancelUrl: string }): Promise<{ checkoutId: string; checkoutUrl: string }>;
  /** Verifies the signature over the raw body; throws on any failure. */
  verifyWebhook(headers: Headers, rawBody: string): Promise<VerifiedEvent[]>;
  /** Submits a cash refund; returns the gateway refund id, or null when the outcome is unknown. */
  submitRefund(input: { refundRequestId: string; gatewayPaymentId: string | null; amountMinor: string; currency: string }): Promise<string | null>;
}

class TestGateway implements BillingGateway {
  readonly name = "test";

  async createCheckout(order: CheckoutOrder) {
    return { checkoutId: `test_${order.orderId}`, checkoutUrl: `/billing/test-checkout/${order.orderId}` };
  }

  async verifyWebhook(): Promise<VerifiedEvent[]> {
    // The test adapter has no external webhook sender; events come from the gated test checkout route.
    throw new ApiError("FORBIDDEN", "The test gateway does not accept external webhooks.", 403);
  }

  async submitRefund(input: { refundRequestId: string }) {
    return `test_refund_${input.refundRequestId}`;
  }
}

/** Returns the configured gateway or null when payments are not configured. Never a silent fake in production. */
export function billingGateway(): BillingGateway | null {
  const name = env.billingProvider();
  if (!name) return null;
  if (name === "test") {
    if (isProductionDeployment()) throw new ConfigError("Payments", ["BILLING_PROVIDER (test is not allowed in production)"]);
    return new TestGateway();
  }
  // A named live gateway needs its adapter implemented and verified before use (§17.1).
  throw new ConfigError("Payments", [`BILLING_PROVIDER adapter "${name}" is not implemented`]);
}

export function requireGateway(): BillingGateway {
  const g = billingGateway();
  if (!g) throw new ApiError("BILLING_UNAVAILABLE", "Payments are not available yet.", 503);
  return g;
}

export const testGatewayActive = () => env.billingProvider() === "test" && !isProductionDeployment();
