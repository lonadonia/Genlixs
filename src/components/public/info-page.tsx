import type { ReactNode } from "react";

export function InfoPage({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-[1360px] px-4 py-12 sm:px-6 lg:px-10 lg:py-16">
      <div className="max-w-3xl">
        <p className="text-sm font-semibold text-brand-lime">{eyebrow}</p>
        <h1 className="mt-2 text-[2rem] leading-tight font-semibold tracking-tight sm:text-[2.5rem]">{title}</h1>
        {intro ? <div className="mt-3 text-lg text-muted">{intro}</div> : null}
      </div>
      <div className="mt-10">{children}</div>
    </div>
  );
}

export function Prose({ children }: { children: ReactNode }) {
  return <div className="max-w-3xl space-y-4 text-[16px] leading-relaxed text-muted [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-ink [&_strong]:text-ink">{children}</div>;
}
