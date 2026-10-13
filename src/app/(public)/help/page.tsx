import type { Metadata } from "next";
import Link from "next/link";
import { InfoPage } from "@/components/public/info-page";
import { ResetPreviewButton } from "./reset-preview";

export const metadata: Metadata = { title: "Help centre" };

const TOPICS = [
  {
    id: "about-preview",
    title: "About this preview",
    body: (
      <>
        <p>
          This site is a <strong>design preview</strong> of the Genlixs public website, customer studio, admin console and partner portal. It shows layouts,
          states and journeys from the Genlixs Design Guide v1.0.
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Examples are temporary concept artwork rendered for layout review — not model output.</li>
          <li>Model names, prices, program terms and every number are sample values pending the approved catalog and price version.</li>
          <li>Sign-in, generation, payments, sharing and payouts are simulated in your browser. Nothing is sent to a server.</li>
          <li>Prototype controls (marked “Prototype”) let reviewers see delayed, failed and unconfirmed states on demand.</li>
        </ul>
        <div className="pt-2">
          <ResetPreviewButton />
        </div>
      </>
    ),
  },
  {
    id: "credits",
    title: "How credits work",
    body: (
      <>
        <p>
          <strong>Available</strong> credits can start new jobs. When you press Generate, the quoted amount moves to <strong>Reserved</strong>. A saved result
          charges the reserved credits; a failed or cancelled job returns them to Available.
        </p>
        <p>
          <strong>Used this period</strong> shows what was charged in the current billing period. Each purchase is a lot with its own expiry, listed on the
          Credits page with the ledger movements that changed your balance.
        </p>
      </>
    ),
  },
  {
    id: "jobs",
    title: "Waiting, delayed and failed jobs",
    body: (
      <>
        <p>
          Jobs move through real phases: waiting, submitting, generating, saving and ready. You can leave the page; the job stays in your library.
          Cancellation is offered only while a job has not been submitted.
        </p>
        <p>
          If a job is slower than usual, we tell you. If we are still confirming whether a request was accepted, we say so and do not ask you to generate
          again — that could charge you twice.
        </p>
      </>
    ),
  },
  {
    id: "account",
    title: "Account and sign-in",
    body: <p>Password recovery, email verification and session management are provided by the production authentication service. In this preview, sign-in is simulated and no account is created.</p>,
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p>
        Signed-in customers can reach support from{" "}
        <Link href="/studio/support" className="font-semibold text-link hover:underline">
          Studio → Support
        </Link>
        . The public contact address will be published here once support routing is configured.
      </p>
    ),
  },
];

export default function HelpPage() {
  return (
    <InfoPage eyebrow="Help centre" title="How Genlixs works" intro="Short answers about credits, jobs, privacy and this preview.">
      <div className="grid gap-10 lg:grid-cols-12">
        <nav aria-label="Help topics" className="lg:col-span-3">
          <ul className="space-y-1 lg:sticky lg:top-28">
            {TOPICS.map((t) => (
              <li key={t.id}>
                <a href={`#${t.id}`} className="flex min-h-10 items-center rounded-[var(--radius-control)] px-3 text-[15px] text-muted hover:bg-raised hover:text-ink">
                  {t.title}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="space-y-6 lg:col-span-9">
          {TOPICS.map((t) => (
            <section key={t.id} id={t.id} aria-labelledby={`${t.id}-h`} className="scroll-mt-28 rounded-[var(--radius-media)] border border-line bg-surface p-6 sm:p-8">
              <h2 id={`${t.id}-h`} className="text-xl font-semibold text-ink">
                {t.title}
              </h2>
              <div className="mt-3 max-w-3xl space-y-3 text-[16px] leading-relaxed text-muted [&_strong]:text-ink">{t.body}</div>
            </section>
          ))}
        </div>
      </div>
    </InfoPage>
  );
}
