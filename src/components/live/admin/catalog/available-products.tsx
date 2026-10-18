"use client";

import { useMemo, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Panel } from "@/components/console/parts";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/format";
import { money } from "../providers/parts";
import { Empty, Notice } from "./shared";
import { perUnit, productCheapest, productName, productNote, usablePrice, type ProductOffer, type Supply, type SupplyProduct } from "./supply";
import { GroupRow, SearchBox, Segmented, SupplierMark } from "./supply-parts";

type Filter = "all" | "image" | "video";

/**
 * Products the suppliers sell that are not Genlixs models yet. Each product is listed once even when several suppliers
 * sell it; the cheapest usable quote comes first and the other suppliers' quotes follow. Nothing here can be routed:
 * a product needs an integration, a key, a paid test and a price before it can become a model.
 */
export function AvailableProducts({ supply }: { supply: Supply }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [pricedOnly, setPricedOnly] = useState(true);

  const all = supply.products;
  const kind = (p: SupplyProduct): Exclude<Filter, "all"> => (p.tool === "video" ? "video" : "image");
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return all
      .filter((p) => (filter === "all" || kind(p) === filter) && (!pricedOnly || productCheapest(p).offer !== null))
      .filter((p) => !term || [productName(p), p.productKey, ...p.offers.map((o) => o.providerName)].some((s) => s.toLowerCase().includes(term)))
      .sort((a, b) => productName(a).localeCompare(productName(b)));
  }, [all, filter, q, pricedOnly]);

  const priced = all.filter((p) => productCheapest(p).offer !== null).length;
  const leaders = new Map<string, { name: string; n: number }>();
  for (const p of all) {
    const o = productCheapest(p).offer;
    if (!o) continue;
    const e = leaders.get(o.provider) ?? { name: o.providerName, n: 0 };
    leaders.set(o.provider, { ...e, n: e.n + 1 });
  }
  const counts = { image: all.filter((p) => kind(p) === "image").length, video: all.filter((p) => kind(p) === "video").length };

  return (
    <div className="space-y-4">
      <Notice title="One line per product, cheapest supplier first">
        These are the image and video products the six suppliers sell that are not Genlixs models yet — {all.length} products from{" "}
        {all.reduce((n, p) => n + p.offers.length, 0)} supplier offers, so nothing is listed twice. {priced} have a usable price
        {pricedOnly && priced < all.length ? ` (the other ${all.length - priced} are hidden; untick “Only products with a price” to see them)` : ""}. Adding
        one to the catalog needs an integration for its cheapest supplier, that supplier&apos;s API key, one paid test and a Genlixs price; until then
        customers never see it.
      </Notice>

      {leaders.size ? (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-dark">
          <span className="font-semibold text-ink-dark">Cheapest supplier per product:</span>
          {[...leaders.entries()]
            .sort((a, b) => b[1].n - a[1].n)
            .map(([provider, x]) => (
              <span key={provider} className="inline-flex items-center gap-1">
                <SupplierMark provider={provider} name={x.name} /> <span className="font-semibold text-ink-dark tabular">{x.n}</span>
              </span>
            ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <Segmented<Filter>
          label="Product type"
          value={filter}
          onChange={setFilter}
          options={[
            { id: "all", label: "All", count: all.length },
            { id: "image", label: "Images", count: counts.image },
            { id: "video", label: "Videos", count: counts.video },
          ]}
        />
        <SearchBox value={q} onChange={setQ} label="Search products or suppliers" />
        <label className="inline-flex items-center gap-2 text-sm font-semibold text-ink-dark">
          <input type="checkbox" checked={pricedOnly} onChange={(e) => setPricedOnly(e.target.checked)} className="size-4 accent-[var(--color-brand-blue)]" />
          Only products with a price
        </label>
      </div>

      <Panel bodyClass="p-0">
        {rows.length === 0 ? (
          <div className="p-5">
            <Empty>No product matches this search.</Empty>
          </div>
        ) : (
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <caption className="sr-only">Products available at suppliers, each listed once with its cheapest quote</caption>
              <thead className="border-b border-rule text-xs whitespace-nowrap text-muted-dark">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold sm:px-5">Product</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Cheapest supplier</th>
                  <th scope="col" className="px-3 py-3 text-right font-semibold">From</th>
                  <th scope="col" className="px-3 py-3 font-semibold">Also sold by</th>
                  <th scope="col" className="px-4 py-3 font-semibold sm:px-5">Before it can be added</th>
                </tr>
              </thead>
              {(["image", "video"] as const).map((t) => {
                const group = rows.filter((p) => kind(p) === t);
                if (!group.length) return null;
                return (
                  <tbody key={t} className="divide-y divide-rule">
                    <GroupRow label={t === "image" ? "Images" : "Videos"} count={group.length} colSpan={5} />
                    {group.map((p) => (
                      <ProductRow key={p.productKey} p={p} />
                    ))}
                  </tbody>
                );
              })}
            </table>
          </div>
        )}
      </Panel>
      <p className="text-xs leading-relaxed text-muted-dark">
        Prices are each supplier&apos;s published rate converted to US dollars with its funding terms (for example Cuddler&apos;s card fee). “From” is the
        lowest listed configuration; when different suppliers are cheapest for different settings it says so. Prices in CNY or Duomi points use an
        illustrative exchange rate until the rate you actually pay is entered in Providers &amp; routing.
      </p>
    </div>
  );
}

function ProductRow({ p }: { p: SupplyProduct }) {
  const { offer, dependsOnSettings, others } = productCheapest(p);
  const unpriced = offer === null;
  const lead = offer ?? p.offers[0];
  const reason = productNote(lead?.blocker ?? null);
  return (
    <tr className="align-top transition-colors hover:bg-paper/60">
      <td className="px-4 py-3.5 sm:px-5">
        <p className="font-semibold text-ink-dark">{productName(p)}</p>
        <p className="mt-0.5 text-xs text-muted-dark">
          {operationLabel(p.operation)}
          {dependsOnSettings ? " · cheapest supplier depends on the settings" : ""}
        </p>
      </td>
      <td className="px-3 py-3.5">
        {offer ? <SupplierMark provider={offer.provider} name={offer.providerName} /> : <span className="text-xs text-muted-dark">No usable price yet</span>}
      </td>
      <td className="px-3 py-3.5 text-right tabular">
        {offer ? <Price o={offer} tool={p.tool} strong /> : <span className="text-xs text-muted-dark">—</span>}
      </td>
      <td className="px-3 py-3.5">
        {others.length ? (
          <ul className="space-y-1">
            {others.map((o) => (
              <li key={o.offerId} className="flex flex-wrap items-center gap-1.5 text-xs">
                <SupplierMark provider={o.provider} name={o.providerName} quiet />
                {o.fromUsd !== null && usablePrice(o.confidence) ? (
                  <Price o={o} tool={p.tool} />
                ) : (
                  <span className="text-muted-dark">{o.fromUsd !== null ? `${money(o.fromUsd)} (price ${o.confidence})` : "no price"}</span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <span className="text-xs text-muted-dark">Only this supplier</span>
        )}
      </td>
      <td className="px-4 py-3.5 sm:px-5">
        <div className="flex flex-wrap gap-1">
          {unpriced ? (
            <Badge surface="light" tone="attention">
              Needs a usable price
            </Badge>
          ) : null}
          {lead && !lead.integrated ? (
            <Badge surface="light" tone="neutral">
              Needs an integration
            </Badge>
          ) : (
            <Badge surface="light" tone="info">
              Needs a key and a test
            </Badge>
          )}
        </div>
        {reason ? <p className="mt-1 max-w-[20rem] text-[11px] leading-snug text-muted-dark">{reason}</p> : null}
        {offer?.sourceUrl ? (
          <a href={offer.sourceUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-info-text hover:underline">
            Supplier price page <ExternalLink aria-hidden className="size-3" />
          </a>
        ) : null}
      </td>
    </tr>
  );
}

function Price({ o, tool, strong }: { o: ProductOffer; tool: string | null; strong?: boolean }) {
  return (
    <span className={cn("tabular", strong ? "font-semibold text-ink-dark" : "text-ink-dark")}>
      {money(o.fromUsd)}
      <span className="font-normal text-muted-dark"> {perUnit(o.basis, tool)}</span>
      {o.unitBasis === "illustrative" ? <span className="ml-1 text-[11px] font-semibold text-orange-text">≈</span> : null}
    </span>
  );
}

const OPERATIONS: Record<string, string> = {
  text_to_image: "Image",
  image_edit: "Image edit",
  text_to_video: "Video",
  image_to_video: "Image to video",
  reference_to_video: "Video with reference",
  motion: "Motion control",
};
const operationLabel = (op: string | null) => (op ? (OPERATIONS[op] ?? op.replace(/_/g, " ")) : "—");
