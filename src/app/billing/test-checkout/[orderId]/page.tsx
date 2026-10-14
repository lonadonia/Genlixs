import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { testGatewayActive } from "@/lib/billing";
import { TestCheckout } from "./test-checkout";

export const metadata: Metadata = { title: "Test checkout", robots: { index: false } };

/** TEST GATEWAY ONLY — returns 404 unless BILLING_PROVIDER=test on a non-production deployment. */
export default async function TestCheckoutPage({ params }: PageProps<"/billing/test-checkout/[orderId]">) {
  if (!testGatewayActive()) notFound();
  const { orderId } = await params;
  return (
    <main id="main" className="grid min-h-dvh place-items-center px-4">
      <div className="console-frame w-full max-w-md p-8">
        <p className="inline-flex rounded-full bg-[rgb(255_181_71/0.15)] px-2.5 py-1 text-xs font-bold tracking-wide text-orange-on-dark uppercase">Test gateway</p>
        <h1 className="font-display mt-4 text-2xl font-extrabold">Test checkout</h1>
        <p className="mt-2 text-sm text-muted">
          No money moves. Choosing an outcome sends the same verified event a real gateway would; credits appear only after the events worker
          applies it.
        </p>
        <TestCheckout orderId={orderId} />
      </div>
    </main>
  );
}
