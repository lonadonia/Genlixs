"use client";

import { useId, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { CAMPAIGNS, PARTNER } from "@/lib/admin-data";

const DESTINATIONS = [
  { v: "/", l: "Homepage" },
  { v: "/#pricing", l: "Pricing" },
  { v: "/studio/image", l: "Image studio" },
  { v: "/studio/video", l: "Video studio" },
];

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32);

export function LinkBuilder() {
  const ids = useId();
  const [name, setName] = useState("");
  const [platform, setPlatform] = useState("YouTube");
  const [dest, setDest] = useState("/");
  const [label, setLabel] = useState("");
  const [saved, setSaved] = useState<{ name: string; platform: string; url: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const params = new URLSearchParams({ c: slug(name) || "campaign" });
  if (label.trim()) params.set("t", slug(label));
  const url = `${PARTNER.link}${dest === "/" ? "" : `?to=${encodeURIComponent(dest)}&`}${dest === "/" ? "?" : ""}${params.toString()}`;

  const field = "mt-1.5 block h-11 w-full rounded-[var(--radius-control)] border border-rule-strong bg-sheet px-3 text-ink-dark";

  return (
    <div className="grid gap-6 xl:grid-cols-5">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (slug(name).length < 2) {
            setError("Give the campaign a name of at least 2 letters.");
            document.getElementById(`${ids}-name`)?.focus();
            return;
          }
          setError(null);
          setSaved((s) => [{ name: name.trim(), platform, url }, ...s]);
          setName("");
          setLabel("");
        }}
        className="min-w-0 space-y-4 rounded-[var(--radius-media)] border border-rule bg-sheet p-5 shadow-[var(--shadow-lift)] xl:col-span-2"
      >
        <h2 className="text-base font-semibold text-ink-dark">Create a campaign link</h2>
        <div>
          <label htmlFor={`${ids}-name`} className="text-sm font-semibold text-ink-dark">
            Campaign name
          </label>
          <input
            id={`${ids}-name`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? `${ids}-err` : undefined}
            placeholder="October tutorial"
            // `!`: globals.css's light-field border rule (unlayered, higher specificity) otherwise hides the error border on text inputs.
            className={`${field} aria-invalid:border-error!`}
          />
          {error ? (
            <p id={`${ids}-err`} className="mt-1 text-sm text-error-text">
              {error}
            </p>
          ) : null}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${ids}-pf`} className="text-sm font-semibold text-ink-dark">
              Platform
            </label>
            <select id={`${ids}-pf`} value={platform} onChange={(e) => setPlatform(e.target.value)} className={field}>
              {["YouTube", "Instagram", "TikTok", "Email", "Website", "Other"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor={`${ids}-dest`} className="text-sm font-semibold text-ink-dark">
              Destination
            </label>
            <select id={`${ids}-dest`} value={dest} onChange={(e) => setDest(e.target.value)} className={field}>
              {DESTINATIONS.map((d) => (
                <option key={d.v} value={d.v}>
                  {d.l}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor={`${ids}-lbl`} className="text-sm font-semibold text-ink-dark">
            Tracking label <span className="font-normal text-muted-dark">(optional)</span>
          </label>
          <input id={`${ids}-lbl`} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="video-description" className={field} />
        </div>
        <div className="rounded-[var(--radius-control)] bg-paper p-3">
          <p className="text-xs font-semibold text-muted-dark">Exact link that will be created</p>
          <p className="mt-1 font-mono text-sm break-all text-ink-dark" aria-live="polite">
            {url}
          </p>
          <CopyButton value={url} label="Copy preview" surface="light" variant="inline" className="mt-2 h-8" />
        </div>
        <Button type="submit">Save campaign link</Button>
      </form>

      <section aria-labelledby={`${ids}-list`} className="min-w-0 rounded-[var(--radius-media)] border border-rule bg-sheet shadow-[var(--shadow-lift)] xl:col-span-3">
        <div className="flex items-center justify-between border-b border-rule px-5 py-3.5">
          <h2 id={`${ids}-list`} className="text-base font-semibold text-ink-dark">
            Your links
          </h2>
          <Badge surface="light" tone="attention" icon="none">
            Sample data
          </Badge>
        </div>
        <ul className="divide-y divide-rule">
          <li className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
            <div className="min-w-0">
              <p className="font-semibold text-ink-dark">Main link</p>
              <p className="truncate font-mono text-xs text-muted-dark">{PARTNER.link}</p>
            </div>
            <CopyButton value={PARTNER.link} label="Copy" surface="light" />
          </li>
          {saved.map((s, i) => (
            <li key={`${s.url}-${i}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <div className="min-w-0">
                <p className="font-semibold text-ink-dark">
                  {s.name} <Badge surface="light" tone="success" className="ml-1">New</Badge>
                </p>
                <p className="truncate font-mono text-xs text-muted-dark">{s.url}</p>
                <p className="text-xs text-muted-dark">{s.platform} · no clicks yet</p>
              </div>
              <CopyButton value={s.url} label="Copy" surface="light" />
            </li>
          ))}
          {CAMPAIGNS.map((c) => {
            const u = `${PARTNER.link}?c=${slug(c.name)}&t=${c.label}`;
            return (
              <li key={c.name} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
                <div className="min-w-0">
                  <p className="font-semibold text-ink-dark">{c.name}</p>
                  <p className="truncate font-mono text-xs text-muted-dark">{u}</p>
                  <p className="text-xs text-muted-dark">
                    {c.platform} · {c.clicks} clicks · {c.regs} registrations · {c.paying} paying
                  </p>
                </div>
                <CopyButton value={u} label="Copy" surface="light" />
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
