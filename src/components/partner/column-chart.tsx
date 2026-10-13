"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/format";

/**
 * Single-series column chart (dataviz skill): one hue, ≤24px columns with a
 * 4px rounded data-end and square baseline, hairline grid, value on the
 * latest/peak column only, per-column hover + focus tooltip, and a table view.
 * Brand v2 on white: columns electric blue (#253FF6, 6.7:1), the partial current
 * week night (#0F1212, 18.8:1); lime is never used on this light surface.
 */
export function ColumnChart({ data, label, unit }: { data: { x: string; y: number }[]; label: string; unit: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const id = useId();
  const max = Math.max(...data.map((d) => d.y));
  const top = Math.ceil(max / 10) * 10;
  const ticks = [0, top / 2, top];
  const peak = data.findIndex((d) => d.y === max);
  const H = 160;

  return (
    <figure aria-labelledby={`${id}-cap`}>
      <figcaption id={`${id}-cap`} className="sr-only">
        {label}
      </figcaption>
      {table ? (
        <table className="w-full text-sm">
          <caption className="sr-only">{label}</caption>
          <thead>
            <tr className="border-b border-rule text-left text-muted-dark">
              <th scope="col" className="py-2 font-semibold">Week of</th>
              <th scope="col" className="py-2 text-right font-semibold">{unit}</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.x} className="border-b border-rule last:border-0">
                <td className="py-1.5">{d.x}</td>
                <td className="py-1.5 text-right tabular">{d.y}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="relative pl-8">
          {/* Hairline grid + y ticks */}
          <div className="absolute inset-y-0 right-0 left-8" style={{ height: H }} aria-hidden>
            {ticks.map((t) => (
              <div key={t} className={cn("absolute right-0 left-0 border-t", t === 0 ? "border-[#cfd4cd]" : "border-rule")} style={{ bottom: (t / top) * H }}>
                <span className="absolute -top-2 -left-8 w-6 text-right text-[11px] text-muted-dark tabular">{t}</span>
              </div>
            ))}
          </div>
          <ul className="relative flex items-end justify-between gap-1" style={{ height: H }}>
            {data.map((d, i) => {
              const h = Math.max(2, (d.y / top) * H);
              const current = i === data.length - 1;
              const showLabel = i === peak || current;
              return (
                <li key={d.x} className="relative flex h-full flex-1 items-end justify-center">
                  <button
                    type="button"
                    aria-label={`Week of ${d.x}: ${d.y} ${unit.toLowerCase()}`}
                    onPointerEnter={() => setHover(i)}
                    onPointerLeave={() => setHover(null)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    className="group flex h-full w-full items-end justify-center rounded-[6px] focus-visible:outline-2"
                  >
                    <span
                      className={cn(
                        "block w-full max-w-6 rounded-t-[4px] transition-colors",
                        current ? (hover === i ? "bg-elevated" : "bg-brand-night") : hover === i ? "bg-brand-blue-hover" : "bg-brand-blue",
                      )}
                      style={{ height: h }}
                    />
                  </button>
                  {showLabel ? (
                    <span aria-hidden className="pointer-events-none absolute text-[11px] font-semibold text-ink-dark tabular" style={{ bottom: h + 4 }}>
                      {d.y}
                    </span>
                  ) : null}
                  {hover === i ? (
                    <span role="tooltip" className="pointer-events-none absolute z-10 rounded-[8px] border border-rule bg-sheet px-2.5 py-1.5 text-xs whitespace-nowrap shadow-[var(--shadow-pop)]" style={{ bottom: h + 22 }}>
                      <strong className="block text-sm text-ink-dark tabular">{d.y}</strong>
                      <span className="text-muted-dark">Week of {d.x}</span>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
          <ul aria-hidden className="mt-2 flex justify-between gap-1">
            {data.map((d) => (
              <li key={d.x} className="flex-1 text-center text-[11px] text-muted-dark">
                {d.x}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-dark">
        <span>
          <span aria-hidden className="mr-1.5 inline-block size-2.5 rounded-[2px] bg-brand-night align-middle" />
          Current week is partial
        </span>
        <button type="button" onClick={() => setTable((t) => !t)} className="font-semibold text-info-text hover:underline">
          {table ? "Show chart" : "Show as table"}
        </button>
      </div>
    </figure>
  );
}
