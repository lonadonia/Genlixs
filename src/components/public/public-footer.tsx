import Link from "next/link";
import { Logo } from "@/components/brand/logo";

const GROUPS = [
  {
    title: "Create",
    links: [
      { href: "/studio/image", label: "Image studio" },
      { href: "/studio/edit", label: "Edit studio" },
      { href: "/studio/video", label: "Video studio" },
      { href: "/#pricing", label: "Pricing" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/#partners", label: "Partner program" },
      { href: "/help", label: "Help centre" },
      { href: "/help#contact", label: "Contact" },
      { href: "/status", label: "Service status" },
    ],
  },
  {
    title: "Policies",
    links: [
      { href: "/terms", label: "Terms of service" },
      { href: "/privacy", label: "Privacy policy" },
      { href: "/acceptable-use", label: "Acceptable use" },
    ],
  },
];

export function PublicFooter() {
  return (
    <footer className="border-t border-line bg-canvas">
      <div className="mx-auto grid max-w-[1360px] gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)] lg:px-10">
        <div>
          <Logo width={160} className="-ml-2" />
          <p className="mt-3 max-w-xs text-sm text-muted">Create images, edit a reference, or generate a short video in one workspace.</p>
          <div className="brand-rule mt-5" aria-hidden>
            <span className="bg-brand-blue" />
            <span className="bg-brand-lime" />
            <span className="bg-brand-violet" />
            <span className="bg-brand-orange" />
          </div>
        </div>
        {GROUPS.map((g) => (
          <nav key={g.title} aria-label={g.title}>
            <h2 className="text-sm font-semibold text-ink">{g.title}</h2>
            <ul className="mt-3 space-y-1">
              {g.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="inline-flex min-h-9 items-center text-sm text-muted hover:text-ink hover:underline">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="border-t border-line">
        <div className="mx-auto flex max-w-[1360px] flex-col gap-2 px-4 py-6 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-10">
          <p>© 2026 Genlixs. Design preview build.</p>
          <p>Examples on this preview are temporary concept media, not model output.</p>
        </div>
      </div>
    </footer>
  );
}
