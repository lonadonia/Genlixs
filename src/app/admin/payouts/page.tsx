import type { Metadata } from "next";
import { PayoutReview } from "@/components/admin/payout-review";
import { PageHead } from "@/components/console/parts";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Payouts" };

export default function AdminPayoutsPage() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHead
        title="Payouts"
        sub={
          <span className="inline-flex flex-wrap items-center gap-2">
            Batch review, approval and transfer state. Switch the prototype role to Finance approver to approve.
            <Badge surface="light" tone="attention" icon="none">
              Sample data
            </Badge>
          </span>
        }
      />
      <PayoutReview />
    </div>
  );
}
