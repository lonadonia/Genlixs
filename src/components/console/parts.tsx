import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/format";

export function PageHead({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-[1.625rem] leading-tight font-semibold tracking-tight text-ink-dark sm:text-[1.875rem]">{title}</h1>
        {sub ? <div className="mt-1 text-sm text-muted-dark">{sub}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({ title, action, children, className, bodyClass, id }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClass?: string; id?: string }) {
  return (
    <section aria-labelledby={id} className={cn("min-w-0 rounded-[var(--radius-media)] border border-rule bg-sheet shadow-[var(--shadow-lift)]", className)}>
      {title ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rule px-5 py-3.5">
          <h2 id={id} className="text-base font-semibold text-ink-dark">
            {title}
          </h2>
          {action}
        </div>
      ) : null}
      <div className={cn("p-5", bodyClass)}>{children}</div>
    </section>
  );
}

export function StatTile({ label, value, sub, href, def }: { label: string; value: string; sub?: string; href?: string; def?: string }) {
  const body = (
    <>
      <p className="text-sm font-semibold text-muted-dark">{label}</p>
      <p className="mt-2 text-[1.875rem] leading-none font-semibold tracking-tight text-ink-dark">{value}</p>
      {sub ? <p className="mt-2 text-xs text-muted-dark">{sub}</p> : null}
      {def ? <p className="mt-3 border-t border-rule pt-2 text-xs text-muted-dark">{def}</p> : null}
    </>
  );
  return href ? (
    <Link href={href} className="block rounded-[var(--radius-media)] border border-rule bg-sheet p-5 shadow-[var(--shadow-lift)] transition-colors hover:border-[#b9c4d6]">
      {body}
      <span className="sr-only"> — open the underlying records</span>
    </Link>
  ) : (
    <div className="rounded-[var(--radius-media)] border border-rule bg-sheet p-5 shadow-[var(--shadow-lift)]">{body}</div>
  );
}
