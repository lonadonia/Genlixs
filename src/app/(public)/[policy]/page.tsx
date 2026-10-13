import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { InfoPage, Prose } from "@/components/public/info-page";

const POLICIES = {
  terms: {
    title: "Terms of service",
    sections: ["Accounts", "Credits, purchases and refunds", "Acceptable content", "Ownership and usage rights", "Model-provider terms", "Liability", "Changes to these terms"],
  },
  privacy: {
    title: "Privacy policy",
    sections: ["Data we collect", "How uploads and results are stored", "Sharing and public links", "Retention and deletion", "Payment data", "Your rights", "Contact"],
  },
  "acceptable-use": {
    title: "Acceptable use policy",
    sections: ["Prohibited content", "Real people and likeness", "Reporting misuse", "Enforcement"],
  },
} as const;

type Slug = keyof typeof POLICIES;

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.keys(POLICIES).map((policy) => ({ policy }));
}

export async function generateMetadata({ params }: PageProps<"/[policy]">): Promise<Metadata> {
  const { policy } = await params;
  const p = POLICIES[policy as Slug];
  return p ? { title: p.title } : {};
}

export default async function PolicyPage({ params }: PageProps<"/[policy]">) {
  const { policy } = await params;
  const p = POLICIES[policy as Slug];
  if (!p) notFound();
  return (
    <InfoPage eyebrow="Policies" title={p.title} intro="Template structure only. The approved legal text has not been supplied and must replace this page before launch.">
      <Prose>
        {p.sections.map((s) => (
          <section key={s} aria-label={s}>
            <h2>{s}</h2>
            <p>Pending approved legal copy.</p>
          </section>
        ))}
      </Prose>
    </InfoPage>
  );
}
