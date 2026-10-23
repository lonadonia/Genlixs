#!/usr/bin/env node
// Turns the catalog source (supabase/catalog/*.mjs) into repeatable migrations, after checking that every model is
// complete: every setting the customer can choose has a KIE reference price, every input mode exists, every per-mode
// KIE model id names a mode, and every adapter is implemented. Usage:
//   node supabase/catalog/build.mjs [outDir]        (default: supabase/pending)
// The SQL never overwrites an owner's choice: rows are inserted when missing, a capability or KIE price version is added
// only when that exact one is not recorded yet, and a model is switched on only if nobody has changed its availability.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { KIE_ADAPTERS } from "./adapters.mjs";
import { IMAGE_MODELS } from "./models.mjs";
import { MODEL_UPDATES, VIDEO_MODELS } from "./models-video.mjs";
import { checkOffer, compareOffer } from "./offer-check.mjs";
import { LINKS, OFFERS, PRICE_UPDATES, SUPPLIER_ADAPTERS } from "./offers.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2] ?? path.join(here, "..", "pending");
const CHECKED = "2026-10-22T12:00:00Z";
const PRICING = "https://kie.ai/pricing";
/** KIE request builders that existed before this catalog (src/lib/providers/kie/adapters.ts). */
const EXISTING_KIE = ["kie-market-image", "kie-market-image-edit", "kie-market-veo", "kie-nano-banana", "kie-flux-2", "kie-seedream-5", "kie-kling-3",
  "kie-seedance-2", "kie-wan-2-6", "kie-veo-3-1", "kie-kling-3-v2", "kie-seedance-2-v2", "kie-seedance-edit", "kie-kling-motion", "kie-veo-extend"];

const MODELS = [...IMAGE_MODELS, ...VIDEO_MODELS];

// ------------------------------------------------------------------------------------------------ checks

const problems = [];
const fail = (id, msg) => problems.push(`${id}: ${msg}`);

function excluded(spec, combo) {
  return (spec.exclude ?? []).some((e) => Object.entries(e).every(([k, v]) => combo[k] === v));
}

/** The settings combinations the engine prices (app_private.price_configs): every value of each dim, minus exclusions. */
function configs(spec, dims) {
  let set = [{}];
  for (const d of dims) {
    const o = spec.options?.[d];
    if (!o) return null;
    set = set.flatMap((c) => o.values.map((v) => ({ ...c, [d]: v })));
  }
  return set.filter((c) => !excluded(spec, c));
}

function checkModel(m, { update = false } = {}) {
  const s = m.spec;
  const adapters = new Set([...EXISTING_KIE, ...Object.keys(KIE_ADAPTERS)]);
  if (!adapters.has(m.kie.adapter)) fail(m.id, `adapter ${m.kie.adapter} is not implemented`);
  for (const [k, o] of Object.entries(s.options ?? {})) {
    if (!Array.isArray(o.values) || !o.values.length) fail(m.id, `option ${k} has no values`);
    if (!o.values.includes(o.default)) fail(m.id, `option ${k} default ${o.default} is not a value`);
  }
  const derived = Object.keys(s.derived ?? {});
  for (const [k, o] of Object.entries(s.options ?? {})) {
    if (o.derived && !derived.includes(k)) fail(m.id, `option ${k} is marked derived but has no derivation`);
    if (!o.derived && derived.includes(k)) fail(m.id, `derived option ${k} is not marked derived`);
  }
  const inputs = s.inputs ?? {};
  for (const [k, d] of Object.entries(s.derived ?? {})) {
    for (const slot of [].concat(d.from)) if (!inputs[slot]) fail(m.id, `derived ${k} reads unknown slot ${slot}`);
    if (d.plus && !s.options?.[d.plus]) fail(m.id, `derived ${k} adds unknown option ${d.plus}`);
  }
  for (const [k, slot] of Object.entries(inputs)) {
    for (const n of slot.needs ?? []) if (!inputs[n]) fail(m.id, `slot ${k} needs unknown ${n}`);
    for (const h of slot.hides ?? []) if (!s.options?.[h]) fail(m.id, `slot ${k} hides unknown option ${h}`);
    if ((slot.kind !== "job" && !slot.mime?.length) || !slot.label) fail(m.id, `slot ${k} lacks mime or label`);
  }
  const modeIds = (s.modes ?? []).map((x) => x.id);
  for (const mode of s.modes ?? []) {
    for (const u of [...mode.uses, ...(mode.requires ?? [])]) if (!inputs[u]) fail(m.id, `mode ${mode.id} uses unknown slot ${u}`);
    for (const r of mode.requires ?? []) if (!mode.uses.includes(r)) fail(m.id, `mode ${mode.id} requires ${r} without using it`);
    for (const [k, vals] of Object.entries(mode.allowed ?? {})) {
      if (!s.options?.[k]) fail(m.id, `mode ${mode.id} restricts unknown option ${k}`);
      else for (const v of vals) if (!s.options[k].values.includes(v)) fail(m.id, `mode ${mode.id} allows ${k}=${v} which is not a value`);
    }
  }
  if (s.inputs && !s.modes?.length) fail(m.id, "inputs without modes");
  for (const part of m.kie.model.split(";").slice(1)) {
    const mode = part.split("=")[0];
    if (!modeIds.includes(mode)) fail(m.id, `model id for unknown mode ${mode}`);
  }
  for (const e of s.exclude ?? []) for (const [k, v] of Object.entries(e)) if (!s.options?.[k]?.values.includes(v)) fail(m.id, `exclusion ${k}=${v} is not a value`);
  if (update) return;
  // Every combination the customer can choose has a KIE reference price.
  const sch = m.cost.schedule;
  const dims = sch.unit === "second" ? [...sch.dims, sch.durationOption] : sch.dims;
  const cs = configs(s, dims);
  if (!cs) fail(m.id, `price dimension missing from the options (${dims.join(", ")})`);
  else {
    for (const c of cs) {
      const key = sch.dims.map((d) => String(c[d])).join("|");
      const rate = sch.rates[key];
      if (typeof rate !== "number" || !(rate > 0)) fail(m.id, `no KIE rate for ${key || "(single price)"}`);
      if (sch.unit === "second" && !(Number(c[sch.durationOption]) > 0)) fail(m.id, `length ${c[sch.durationOption]} is not a positive number`);
    }
    const used = new Set(cs.map((c) => sch.dims.map((d) => String(c[d])).join("|")));
    for (const k of Object.keys(sch.rates)) if (!used.has(k)) fail(m.id, `KIE rate ${k} matches no setting`);
  }
  const refs = s.references ?? { min: 0, max: 0 };
  if (m.tool === "edit" && !(refs.min >= 1)) fail(m.id, "an edit model needs at least one reference image");
  if (m.tool === "image" && refs.max !== 0) fail(m.id, "text-to-image takes no reference images");
  if (!m.purpose || m.purpose.length > 200) fail(m.id, "purpose missing or too long");
}

const ids = new Set();
for (const m of MODELS) {
  if (ids.has(m.id)) fail(m.id, "duplicate id");
  ids.add(m.id);
  if (!/^[a-z0-9][a-z0-9-]{1,60}$/.test(m.id)) fail(m.id, "bad id");
  checkModel(m);
}
for (const u of MODEL_UPDATES) checkModel(u, { update: true });
for (const [name, desc] of Object.entries(KIE_ADAPTERS)) if (desc.includes(";")) fail(name, "adapter description contains a semicolon");
const offerKeys = new Set();
for (const o of OFFERS) {
  const id = `${o.provider} ${o.key}`;
  if (offerKeys.has(id)) fail(id, "duplicate offer");
  offerKeys.add(id);
  if (!/^[a-z0-9][a-z0-9.:/_-]{1,99}$/.test(o.key)) fail(id, "bad product key");
  for (const p of checkOffer(o)) fail(id, p);
}
for (const [name, [, desc]] of Object.entries(SUPPLIER_ADAPTERS)) if (desc.includes(";") || desc.includes("'")) fail(name, "adapter description contains a semicolon or quote");
for (const o of OFFERS) if (!SUPPLIER_ADAPTERS[o.adapter] && !["apimart-video", "nezhagate-image", "nezhagate-video", "poyo-kling-motion"].includes(o.adapter)) fail(`${o.provider} ${o.key}`, `adapter ${o.adapter} is not registered`);
for (const [prov, key] of LINKS) if (offerKeys.has(`${prov} ${key}`)) fail(`${prov} ${key}`, "linked as research and written as an offer");
if (problems.length) {
  console.error(`catalog check failed (${problems.length}):\n  ${problems.join("\n  ")}`);
  process.exit(1);
}

// ------------------------------------------------------------------------------------------------ SQL

const q = (v) => (v === null || v === undefined ? "null::text" : `'${String(v).replace(/'/g, "''")}'`);
const jq = (o) => {
  const s = JSON.stringify(o);
  if (s.includes("$j$")) throw new Error("json contains the dollar-quote tag");
  return `$j$${s}$j$`;
};
const arr = (a) => `'{${a.join(",")}}'`;

function modelsSql(list) {
  const rows = list.map((m) => `  (${[q(m.id), q(m.tool), q(m.name), q(m.family), q(m.variant), arr(m.badges), q(m.purpose), q(m.kie.model), q(m.kie.adapter),
    m.sort, q(m.kie.docs), q(PRICING)].join(", ")})`);
  return `insert into app_private.model_catalog (id, tool, public_name, family, variant_label, badges, purpose, provider_account_id,
  provider_model_id, adapter, sort_order, provider_docs_url, provider_pricing_url, source_checked_at)
select v.id, v.tool, v.public_name, v.family, v.variant_label, v.badges::text[], v.purpose,
  (select a.id from app_private.provider_accounts a where a.provider = 'kie' and a.label = 'primary'),
  v.provider_model_id, v.adapter, v.sort_order, v.docs, v.pricing, timestamptz '${CHECKED}'
from (values
${rows.join(",\n")}
) as v(id, tool, public_name, family, variant_label, badges, purpose, provider_model_id, adapter, sort_order, docs, pricing)
on conflict (id) do nothing;
`;
}

function capabilitiesSql(list) {
  const rows = list.map((m) => `  (${q(m.id)}, ${jq(m.spec)})`);
  return `-- Capability specification v1 of each new model (only when the model has none yet).
insert into app_private.model_capability_versions (model_id, version, spec)
select v.model_id, 1, v.spec::jsonb
from (values
${rows.join(",\n")}
) as v(model_id, spec)
where not exists (select 1 from app_private.model_capability_versions c where c.model_id = v.model_id);
`;
}

function costsSql(list) {
  const rows = list.map((m) => `  (${q(m.id)}, ${jq(m.cost.schedule)}, ${q(m.cost.note)})`);
  return `-- KIE reference prices (KIE credits, $0.005 each), documented on ${CHECKED.slice(0, 10)}. Inserting one re-prices the model under the
-- current global pricing policy (trigger policy_follow_change); customer prices are never written here.
insert into app_private.supplier_cost_versions (model_id, version, schedule, usd_per_credit, source_kind, source_url, source_checked_at, note)
select v.model_id, 1, v.schedule::jsonb, 0.005, 'documented', '${PRICING}', timestamptz '${CHECKED}', v.note
from (values
${rows.join(",\n")}
) as v(model_id, schedule, note)
where not exists (select 1 from app_private.supplier_cost_versions c where c.model_id = v.model_id);
`;
}

function updatesSql(list) {
  return list.map((u) => `-- ${u.id}: new workflows. ${u.note}
update app_private.model_catalog set provider_model_id = ${q(u.kie.model)}, adapter = ${q(u.kie.adapter)}, purpose = ${q(u.purpose)}, updated_at = now()
where id = ${q(u.id)} and adapter is distinct from ${q(u.kie.adapter)};

insert into app_private.model_capability_versions (model_id, version, spec)
select ${q(u.id)}, (select coalesce(max(c.version), 0) + 1 from app_private.model_capability_versions c where c.model_id = ${q(u.id)}), ${jq(u.spec)}::jsonb
where not exists (select 1 from app_private.model_capability_versions c where c.model_id = ${q(u.id)} and c.spec = ${jq(u.spec)}::jsonb);
`).join("\n");
}

function adaptersSql() {
  const rows = Object.entries(KIE_ADAPTERS).map(([a, d]) => `  (${q(a)}, 'kie', ${q(d)})`);
  return `insert into app_private.provider_adapters (adapter, provider, description) values
${rows.join(",\n")}
on conflict (adapter) do nothing;

-- KIE results come from the same documented hosts for every KIE model.
update app_private.provider_adapters a set result_hosts = k.result_hosts
from app_private.provider_adapters k
where k.adapter = 'kie-market-image' and a.provider = 'kie' and a.result_hosts = '{}' and a.adapter <> k.adapter;
`;
}

const header = (title, body) => `-- ${title}
--
${body.split("\n").map((l) => (l ? `-- ${l}` : "--")).join("\n")}

`;

const imageSql = header("Full catalog, part 1: KIE request builders and image models (docs.kie.ai and the KIE price list, checked 22 Oct 2026).",
  `Adds the request builders of src/lib/providers/kie/catalog-adapters.ts and ${IMAGE_MODELS.length} image and image-edit models, each with its capability
specification and KIE reference price. New models are added switched off; part 4 switches on those that are complete.
Generated by supabase/catalog/build.mjs from supabase/catalog/models.mjs. Repeatable: nothing that exists is overwritten.`)
  + adaptersSql() + "\n" + modelsSql(IMAGE_MODELS) + "\n" + capabilitiesSql(IMAGE_MODELS) + "\n" + costsSql(IMAGE_MODELS);

const half = Math.ceil(VIDEO_MODELS.length / 2);
const videoParts = [VIDEO_MODELS.slice(0, half), VIDEO_MODELS.slice(half)];
const videoSql = videoParts.map((list, i) => header(`Full catalog, part ${i + 2}: video models ${i + 1}/2 (docs.kie.ai and the KIE price list, checked 22 Oct 2026).`,
  `${list.length} video models (${list.map((m) => m.name).join(", ")}), each with its capability specification and KIE reference price,
added switched off.${i === 1 ? " Also: Wan 2.6 gains image-to-video and reference-video workflows (same KIE rates)." : ""}
Generated by supabase/catalog/build.mjs from supabase/catalog/models-video.mjs. Repeatable: nothing that exists is overwritten.`)
  + modelsSql(list) + "\n" + capabilitiesSql(list) + "\n" + costsSql(list) + (i === 1 ? "\n" + updatesSql(MODEL_UPDATES) : ""));

// Research rows of 18 Oct for KIE products that are now Genlixs models: linked to the model and switched off, so the
// "Add models" list no longer offers them and nothing is counted twice.
const KIE_RESEARCH = {
  "flux-kontext": "flux-kontext-edit", "grok-video": "grok-imagine-video", "kling-2.5-turbo-pro": "kling-2-5-turbo", "kling-o3": "kling-3-0-omni",
  "nano-banana-2.1": "nano-banana-2-1-image", "pixverse-v6": "pixverse-v6", "seedream-4": "seedream-4-image", "seedream-4.5": "seedream-4-5-image",
  "seedream-5-lite/2k": "seedream-5-lite-image", "seedream-5-pro": "seedream-5-pro-image", "wan-2.6-flash": "wan-2-6-flash", "wan-3.0": "wan-3-0",
  "z-image-turbo": "z-image",
};
const enableIds = MODELS.map((m) => m.id);
const enableSql = header("Full catalog, part 4: switch on the complete new models and retire superseded research rows.",
  `Turns on every new model that is ready (integration, options, active KIE account, KIE reference price for every setting and a published
price under the global policy), recording "documented_cost" as the basis like the owner's existing models. A model whose availability anybody
has already changed is left alone. The research rows of 18 Oct for KIE products that are now models are linked to them and switched off.
Seedance 1.5 Pro is no longer in KIE's price list or documentation (checked 22 Oct 2026); its KIE research row is marked unavailable.`)
  + `update app_private.provider_offers f
set model_id = v.model_id, status = 'disabled', decision = 'dominated', routing_enabled = false, decided_at = now(),
  decision_reason = 'Same product as the original KIE route of this model; research entry of 18 Oct 2026 kept for history.',
  blocker = null, updated_at = now()
from app_private.provider_accounts a, (values
${Object.entries(KIE_RESEARCH).map(([k, id]) => `  (${q(k)}, ${q(id)})`).join(",\n")}
) as v(product_key, model_id)
where a.id = f.provider_account_id and a.provider = 'kie' and f.product_key = v.product_key and f.model_id is null
  and f.status in ('discovered', 'pricing_unverified', 'capabilities_unverified') and not f.routing_enabled and f.verification_basis is null
  and exists (select 1 from app_private.model_catalog m where m.id = v.model_id);

update app_private.provider_offers f
set status = 'stale', decided_at = now(), updated_at = now(),
  blocker = 'Superseded on 22 Oct 2026 by separate catalog models: FLUX.2 Flex, FLUX 3 Klein, FLUX.1 Kontext, Ideogram V3, Ideogram Character and Recraft.'
from app_private.provider_accounts a
where a.id = f.provider_account_id and a.provider = 'kie' and f.product_key = 'flux-newer-variants' and f.model_id is null
  and f.status in ('discovered', 'pricing_unverified', 'capabilities_unverified') and not f.routing_enabled and f.verification_basis is null;

update app_private.provider_offers f
set status = 'unavailable', decision = 'unavailable', decided_at = now(), updated_at = now(),
  decision_reason = 'Not in KIE''s price list or documentation any more (checked 22 Oct 2026).'
from app_private.provider_accounts a
where a.id = f.provider_account_id and a.provider = 'kie' and f.product_key = 'seedance-1.5-pro' and f.model_id is null
  and f.status in ('discovered', 'pricing_unverified', 'capabilities_unverified') and not f.routing_enabled and f.verification_basis is null;

do $$
declare
  r record;
  v_block jsonb;
  v_blocked text[] := '{}';
begin
  for r in
    select m.id, m.public_name from app_private.model_catalog m
    where m.id = any (array[${enableIds.map(q).join(", ")}]::text[])
      and m.state = 'disabled' and m.availability_changed_at is null
    order by m.sort_order
  loop
    v_block := app_private.availability_blocker(null, r.id, 'enabled', true);
    if v_block is not null then
      v_blocked := v_blocked || (r.id || ': ' || (v_block ->> 'message'));
      continue;
    end if;
    update app_private.model_catalog
    set state = 'enabled', enable_basis = 'documented_cost', availability_changed_at = now(), updated_at = now()
    where id = r.id;
    perform app_private.audit(null, 'catalog.operate', 'model.availability', 'model', r.id,
      'Turned on ' || r.public_name || ' with the full catalog of 22 Oct 2026 (not tested yet; priced on the documented KIE cost)',
      jsonb_build_object('state', 'disabled'), jsonb_build_object('state', 'enabled', 'enableBasis', 'documented_cost'));
  end loop;
  if cardinality(v_blocked) > 0 then
    raise exception 'catalog models not ready: %', array_to_string(v_blocked, '; ');
  end if;
end;
$$;
`;

// ------------------------------------------------------------------------------------------------ supplier offers

const OFFER_CHECKED = "2026-10-22T12:00:00Z";
const ORIGINAL_ADAPTERS = { apimart: "apimart-video", poyo: "poyo-kling-motion", nezhagate: "nezhagate-image" };
const RESEARCH = "f.status in ('discovered', 'pricing_unverified') or (f.status = 'capabilities_unverified' and f.adapter is null)";

function supplierAdaptersSql() {
  const rows = Object.entries(SUPPLIER_ADAPTERS).map(([a, [p, d]]) => `  (${q(a)}, ${q(p)}, ${q(d)})`);
  const pairs = Object.entries(SUPPLIER_ADAPTERS).map(([a, [p]]) => `(${q(a)}, ${q(ORIGINAL_ADAPTERS[p])})`);
  return `insert into app_private.provider_adapters (adapter, provider, description) values
${rows.join(",\n")}
on conflict (adapter) do nothing;

-- Same task API and documented result host as the supplier's existing integration.
update app_private.provider_adapters a set result_hosts = k.result_hosts
from app_private.provider_adapters k, (values ${pairs.join(", ")}) as v(adapter, original)
where a.adapter = v.adapter and k.adapter = v.original and a.result_hosts = '{}';
`;
}

function offersSql() {
  const rows = OFFERS.map((o) => {
    const c = compareOffer(o);
    const reason = `Documented request and price: cheaper than the KIE reference for ${c.cheaper} of ${c.compatible} settings it takes (up to ${c.maxSaving} %).`;
    return `  (${[q(o.provider), q(o.key), q(o.label), q(o.model), q(o.tool), q(o.operation), q(o.upstream), q(o.adapter), jq(o.caps), q(o.source), q(o.docs),
      q(o.gap ?? null), q(reason)].join(", ")})`;
  });
  return `-- Offers: inserted, or completed from the research entry of 18 Oct with the same product key. An entry somebody has
-- already configured, verified, activated or switched off is left exactly as it is.
insert into app_private.provider_offers as f (provider_account_id, model_id, product_key, product_label, tool, operation, upstream_model_id, adapter,
  capabilities, status, decision, decision_reason, decided_at, blocker, routing_enabled, source_url, docs_url, documentation_gap, sort_order)
select a.id, v.model_id, v.product_key, v.label, v.tool, v.operation, v.upstream, v.adapter, v.caps::jsonb, 'capabilities_unverified', 'eligible', v.reason, now(),
  'Not routed until the owner activates it in Providers (documented, not live-tested) or verifies it with a live test.', false, v.source, v.docs, v.gap, 100
from (values
${rows.join(",\n")}
) as v(provider, product_key, label, model_id, tool, operation, upstream, adapter, caps, source, docs, gap, reason)
join app_private.provider_accounts a on a.provider = v.provider and a.label = 'primary'
where exists (select 1 from app_private.model_catalog m where m.id = v.model_id)
  and exists (select 1 from app_private.provider_adapters d where d.adapter = v.adapter)
on conflict (provider_account_id, product_key) do update set
  model_id = excluded.model_id, product_label = excluded.product_label, tool = excluded.tool, operation = excluded.operation,
  upstream_model_id = excluded.upstream_model_id, adapter = excluded.adapter, capabilities = excluded.capabilities, status = excluded.status,
  decision = excluded.decision, decision_reason = excluded.decision_reason, decided_at = excluded.decided_at, blocker = excluded.blocker,
  source_url = excluded.source_url, docs_url = excluded.docs_url, documentation_gap = excluded.documentation_gap, updated_at = now()
where (${RESEARCH}) and not f.routing_enabled and f.verification_basis is null and not f.is_legacy_primary
  and (f.model_id is null or f.model_id = excluded.model_id);
`;
}

/** A new price version when the latest one of the offer differs (earlier versions are immutable history). */
function pricesSql(list, comment, onlyAdapter) {
  const rows = list.map((o) => `  (${[q(o.provider), q(o.key), q(o.unit), jq(o.schedule), q(o.source), q(o.provider === "apimart" ? "gold" : null), q(o.assumptions),
    q(onlyAdapter ? o.adapter : null)].join(", ")})`);
  return `-- ${comment}
insert into app_private.provider_offer_prices (offer_id, version, unit, schedule, confidence, source_kind, source_url, checked_at, account_tier, assumptions)
select f.id, coalesce((select max(p.version) from app_private.provider_offer_prices p where p.offer_id = f.id), 0) + 1, v.unit, v.schedule::jsonb,
  'documented', 'documented', v.source, timestamptz '${OFFER_CHECKED}', v.tier, v.assumptions
from (values
${rows.join(",\n")}
) as v(provider, product_key, unit, schedule, source, tier, assumptions, adapter)
join app_private.provider_accounts a on a.provider = v.provider and a.label = 'primary'
join app_private.provider_offers f on f.provider_account_id = a.id and f.product_key = v.product_key
where (v.adapter is null or f.adapter = v.adapter)
  and not exists (
    select 1 from app_private.provider_offer_prices p
    where p.offer_id = f.id and p.unit = v.unit and p.schedule = v.schedule::jsonb
      and p.version = (select max(p2.version) from app_private.provider_offer_prices p2 where p2.offer_id = f.id));
`;
}

function linksSql() {
  const rows = LINKS.map(([p, k, m, d, r]) => `  (${[q(p), q(k), q(m), q(d), q(r)].join(", ")})`);
  return `-- Research entries whose product is now a catalog model but which are not integrated: linked to the model, with the reason.
update app_private.provider_offers f
set model_id = v.model_id, decision = coalesce(v.decision, f.decision), decision_reason = v.reason, blocker = v.reason, decided_at = now(), updated_at = now()
from app_private.provider_accounts a, (values
${rows.join(",\n")}
) as v(provider, product_key, model_id, decision, reason)
where a.id = f.provider_account_id and a.provider = v.provider and f.product_key = v.product_key and f.model_id is null
  and f.status in ('discovered', 'pricing_unverified', 'capabilities_unverified') and not f.routing_enabled and f.verification_basis is null
  and exists (select 1 from app_private.model_catalog m where m.id = v.model_id);
`;
}

const offersFile = header("Full catalog, part 5: supplier offers (APIMart, NezhaGate, PoYo; documentation and price lists read 22 Oct 2026).",
  `${OFFERS.length} offers whose documented request covers a Genlixs model's settings exactly and whose documented price is below the KIE reference
for at least one setting (checked by supabase/catalog/build.mjs). All of them are created switched off: routing starts only when the owner
activates an offer in Providers ("Documented, not live-tested", every readiness check must pass) or verifies it with a live test. Customer
prices are unchanged: they follow the KIE reference under the global pricing policy, whichever supplier serves the job.
Also: the request builders of these offers, current prices of the NezhaGate GPT Image 2.5 offers (2K and 4K went up), and ${LINKS.length} research
entries of 18 Oct linked to their model with the reason they are not integrated. Duomi entries are left as they are.
Generated by supabase/catalog/build.mjs from supabase/catalog/offers.mjs. Repeatable: nothing that was configured is overwritten.`)
  + supplierAdaptersSql() + "\n" + offersSql() + "\n"
  + pricesSql(OFFERS, "Documented prices of the offers (only when the offer is this integration and the price is new).", true) + "\n"
  + pricesSql(PRICE_UPDATES, "Changed prices of existing offers.", false) + "\n" + linksSql();

mkdirSync(outDir, { recursive: true });
const files = { "02_catalog_images.sql": imageSql, "03_catalog_videos_a.sql": videoSql[0], "04_catalog_videos_b.sql": videoSql[1], "05_catalog_enable.sql": enableSql,
  "06_catalog_offers.sql": offersFile };
for (const [f, sql] of Object.entries(files)) {
  writeFileSync(path.join(outDir, f), sql);
  console.log(`${f}: ${(Buffer.byteLength(sql) / 1024).toFixed(1)} KB`);
}
console.log(`models: ${IMAGE_MODELS.filter((m) => m.tool === "image").length} image, ${IMAGE_MODELS.filter((m) => m.tool === "edit").length} edit, ${VIDEO_MODELS.length} video; updates: ${MODEL_UPDATES.length}; adapters: ${Object.keys(KIE_ADAPTERS).length}; offers: ${OFFERS.length}; linked research entries: ${LINKS.length}`);
