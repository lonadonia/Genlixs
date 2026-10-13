import type { Metadata } from "next";
import { PageHead } from "@/components/console/parts";
import { LinkBuilder } from "@/components/partner/link-builder";

export const metadata: Metadata = { title: "Links" };

export default function PartnerLinksPage() {
  return (
    <div className="mx-auto max-w-[1400px] space-y-6 p-4 sm:p-6 lg:p-8">
      <PageHead title="Links" sub="Create a link per platform so you can see which audience converts. Destinations are Genlixs pages only." />
      <LinkBuilder />
    </div>
  );
}
