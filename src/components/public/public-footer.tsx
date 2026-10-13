import Image from "next/image";
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
    <footer className="relative overflow-hidden border-t border-white/[0.06] bg-canvas">
      <div className="mx-auto grid max-w-[1440px] gap-10 px-4 pt-16 pb-10 sm:px-6 md:grid-cols-[1.5fr_repeat(3,1fr)] lg:px-10">
        <div>
          <Logo width={150} className="-ml-1.5" />
          <p className="mt-4 max-w-xs text-sm text-muted">Create images, edit a reference, or generate a short video in one workspace.</p>
          <div className="brand-rule mt-6" aria-hidden>
            <span className="bg-brand-blue" />
            <span className="bg-brand-lime" />
            <span className="bg-white" />
          </div>
        </div>
        {GROUPS.map((g) => (
          <nav key={g.title} aria-label={g.title}>
            <h2 className="text-sm font-semibold text-ink">{g.title}</h2>
            <ul className="mt-3 space-y-1">
              {g.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="inline-flex min-h-9 items-center text-sm text-muted transition-colors hover:text-ink">
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>
      <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-10">
        <div className="flex flex-col gap-2 border-t border-white/[0.06] py-6 text-xs text-subtle sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 Genlixs. Design preview build.</p>
          <p>Images and clips on this preview are temporary placeholders, not model output.</p>
        </div>
      </div>
      {/* Oversized wordmark watermark — the supplied mono logo at low opacity, cropped by the footer edge. */}
      <div aria-hidden className="pointer-events-none mx-auto -mb-[4vw] max-w-[1440px] px-4 opacity-[0.06] select-none sm:px-6 lg:px-10">
        <Image src="/brand/genlixs-logo-mono-white-960.png" alt="" width={960} height={197} className="h-auto w-full" />
      </div>
    </footer>
  );
}
