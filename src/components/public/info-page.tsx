import type { ReactNode } from "react";

export function InfoPage({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <div className="relative isolate">
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[420px] overflow-hidden">
        <div className="dot-field absolute inset-0 opacity-70" />
        <div className="absolute -top-40 right-[-10%] h-[420px] w-[50%] rounded-full bg-[radial-gradient(closest-side,rgb(37_63_246/0.28),transparent)] blur-2xl" />
      </div>
      <div className="mx-auto max-w-[1360px] px-4 py-12 sm:px-6 lg:px-10 lg:py-20">
        <div className="max-w-3xl">
          <p className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs font-semibold tracking-[0.08em] text-muted uppercase">
            <span aria-hidden className="size-1.5 rounded-full bg-brand-lime" />
            {eyebrow}
          </p>
          <h1 className="font-display mt-4 text-[2.125rem] leading-[1.05] font-extrabold text-balance sm:text-[2.75rem] lg:text-[3.25rem]">{title}</h1>
          {intro ? <div className="mt-4 text-lg text-muted">{intro}</div> : null}
        </div>
        <div className="mt-10 lg:mt-12">{children}</div>
      </div>
    </div>
  );
}

export function Prose({ children }: { children: ReactNode }) {
  return <div className="max-w-3xl space-y-4 text-[16px] leading-relaxed text-muted [&_h2]:mt-10 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-ink [&_strong]:text-ink">{children}</div>;
}
