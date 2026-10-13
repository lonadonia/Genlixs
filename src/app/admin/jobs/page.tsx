import type { Metadata } from "next";
import { Suspense } from "react";
import { JobsTable } from "@/components/admin/jobs-table";
import { PageHead } from "@/components/console/parts";
import { Badge } from "@/components/ui/badge";

export const metadata: Metadata = { title: "Jobs" };

export default function AdminJobsPage() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHead
        title="Jobs"
        sub={
          <span className="inline-flex flex-wrap items-center gap-2">
            Filters stay in the address, so opening a job and coming back keeps them.
            <Badge surface="light" tone="attention" icon="none">
              Sample data
            </Badge>
          </span>
        }
      />
      <Suspense>
        <JobsTable />
      </Suspense>
    </div>
  );
}
