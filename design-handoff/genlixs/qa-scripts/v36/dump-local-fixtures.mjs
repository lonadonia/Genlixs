// Admin API fixtures for v36/two-page-admin.mjs, dumped from the ISOLATED LOCAL database (embedded PostgreSQL on
// 127.0.0.1:54329 built by supabase/local-test — never production), inside one transaction that is rolled back.
// Run after: node supabase/local-test/run.mjs fresh migrations
// Usage: REPO=<repository root> node dump-local-fixtures.mjs <outDir>
// Writes catalog, supply, policy, two previews, an apply result and the state after it, and one model detail. The fixture
// state is production-like (every model on), with NezhaGate verified for one image model (a cheaper supplier serving) and
// Wan 2.6 without a KIE rate (KIE reference needed).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repo = process.env.REPO ?? process.cwd();
const out = process.argv[2] ?? "fixtures-v36";
const tools = path.join(repo, "supabase/local-test/.tools");
const { default: pg } = await import(pathToFileURL(path.join(tools, "node_modules/pg/lib/index.js")).href);
const { default: EmbeddedPostgres } = await import(pathToFileURL(path.join(tools, "node_modules/embedded-postgres/dist/index.js")).href);
const server = new EmbeddedPostgres({ databaseDir: path.join(tools, "pgdata"), user: "postgres", password: "local-test-only", port: 54329, persistent: true, onLog: () => {}, onError: () => {} });
await server.start();
const c = new pg.Client({ host: "127.0.0.1", port: 54329, user: "postgres", password: "local-test-only", database: "genlixs_test" });
await c.connect();
const one = async (sql, params = []) => (await c.query(sql, params)).rows[0];
const save = (name, data) => fs.writeFileSync(path.join(out, name), JSON.stringify(data, null, 1));
fs.mkdirSync(out, { recursive: true });
try {
  await c.query("begin");
  const owner = (await one(`insert into auth.users (id, aud, role, email, raw_user_meta_data, email_confirmed_at, created_at, updated_at)
    values (gen_random_uuid(), 'authenticated', 'authenticated', 'owner@genlixs.test', '{}', now(), now(), now()) returning id`)).id;
  await c.query(`insert into app_private.staff_memberships (user_id, role) values ($1, 'owner')`, [owner]);
  await c.query(`update app_private.model_catalog set state = 'enabled' where state <> 'enabled'`);
  await c.query(`update app_private.provider_accounts set enabled = true, credential_version = 1, connection_state = 'ok' where provider = 'nezhagate'`);
  await c.query(`update app_private.provider_offers set status = 'eligible', routing_enabled = true
    where model_id = 'nano-banana-pro-image' and provider_account_id = (select id from app_private.provider_accounts where provider = 'nezhagate')`);
  await c.query(`insert into app_private.supplier_cost_versions (model_id, version, schedule, usd_per_credit, source_kind, source_url, source_checked_at, note)
    select model_id, version + 1, jsonb_set(schedule, '{rates}', '{}'::jsonb), usd_per_credit, 'manual', null, now(), 'QA fixture: no KIE rate'
    from app_private.supplier_cost_versions where model_id = 'wan-2-6' order by version desc limit 1`);
  await c.query(`select set_config('request.jwt.claims', $1, true), set_config('request.jwt.claim.sub', $2, true)`, [
    JSON.stringify({ sub: owner, role: "authenticated" }),
    owner,
  ]);
  const call = async (fn, args = "") => (await one(`select public.${fn}(${args}) as j`)).j;
  save("catalog.json", await call("admin_catalog"));
  save("supply.json", await call("admin_catalog_supply"));
  const policy = await call("admin_pricing_policy");
  save("policy.json", policy);
  save("preview-150.json", await call("admin_preview_pricing_policy", "150, 0.02"));
  save("preview-100-0.025.json", await call("admin_preview_pricing_policy", "100, 0.025"));
  save("apply-150.json", await call("admin_apply_pricing_policy", `150, 0.02, '${policy.policy.policyId}'`));
  save("policy-after.json", await call("admin_pricing_policy"));
  save("supply-after.json", await call("admin_catalog_supply"));
  save("catalog-after.json", await call("admin_catalog"));
  save("detail-wan.json", await call("admin_model_detail", `'wan-2-6'`));
  console.log("fixtures written to", out, "(add overview.json, summary.json, routing-models.json and health.json)");
} finally {
  await c.query("rollback");
  await c.end();
  await server.stop();
}
