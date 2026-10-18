// Isolated local database for the Genlixs migrations: embedded PostgreSQL 17 on this computer (no Docker, nothing
// remote, never the production project). See README.md for the one-time install.
//
// Usage: node supabase/local-test/run.mjs <steps...>
//   fresh          drop and recreate the test database; load the Supabase stand-in (shim.sql) and pgmq 1.4.4
//   migrations     apply supabase/migrations/*.sql in order (pgmq, pg_net and pg_cron come from the stand-in)
//   tests[:01,07]  run supabase/tests: 00_helpers + each file in its own session (default 01-06)
//   pending        apply supabase/pending/*_image_edit_multi_reference.sql
//   rollback       apply supabase/pending/*_image_edit_multi_reference.rollback.sql
//   sql:<file>     run a SQL file (relative to this folder) and print the rows of its last statement
//   stop           stop the local server
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..");
const tools = path.join(here, ".tools");
const mod = (p) => import(pathToFileURL(path.join(tools, "node_modules", p)).href);
const { default: EmbeddedPostgres } = await mod("embedded-postgres/dist/index.js").catch(() => {
  console.error("Install the local tools first:\n  npm i --prefix supabase/local-test/.tools embedded-postgres@17.10.0-beta.17 pg@8");
  process.exit(2);
});
const { default: pg } = await mod("pg/lib/index.js");

const PGMQ_URL = "https://raw.githubusercontent.com/pgmq/pgmq/v1.4.4/pgmq-extension/sql/pgmq.sql";
const PGMQ_SHA256 = "fa8e82717bea841767b8c9109479eb51cb2ff4d931924d001f108f1c19945be4";
const PORT = 54329;
const DB = "genlixs_test";
const PASSWORD = "local-test-only";
const conn = (database) => ({ host: "127.0.0.1", port: PORT, user: "postgres", password: PASSWORD, database });
const data = path.join(tools, "pgdata");

const server = new EmbeddedPostgres({ databaseDir: data, user: "postgres", password: PASSWORD, port: PORT, persistent: true, onLog: () => {}, onError: () => {} });
if (!fs.existsSync(path.join(data, "PG_VERSION"))) await server.initialise();
try {
  const c = new pg.Client(conn("postgres"));
  await c.connect();
  await c.end();
} catch {
  await server.start();
}

async function session(fn, database = DB) {
  const c = new pg.Client(conn(database));
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function pgmq() {
  const file = path.join(tools, "pgmq-1.4.4.sql");
  if (!fs.existsSync(file)) fs.writeFileSync(file, await (await fetch(PGMQ_URL)).text());
  const sql = fs.readFileSync(file, "utf8");
  if (crypto.createHash("sha256").update(sql).digest("hex") !== PGMQ_SHA256) throw new Error("pgmq.sql checksum mismatch");
  return sql;
}

const read = (p) => fs.readFileSync(p, "utf8");
let failures = 0;
for (const step of process.argv.slice(2)) {
  if (step === "fresh") {
    await session(async (c) => {
      await c.query(`drop database if exists ${DB} with (force)`);
      await c.query(`create database ${DB} with encoding 'UTF8' lc_collate 'C' lc_ctype 'C' template template0`);
    }, "postgres");
    const queue = await pgmq();
    await session(async (c) => {
      await c.query(read(path.join(here, "shim.sql")));
      await c.query(queue);
      // Installed outside an extension: queue tables are never added to one.
      await c.query("create or replace function pgmq._belongs_to_pgmq(table_name text) returns boolean language sql as $$ select true $$");
    });
    console.log("fresh: database, Supabase stand-in and pgmq ready");
  } else if (step === "migrations") {
    const dir = path.join(repo, "supabase", "migrations");
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
      const sql = read(path.join(dir, f))
        .replace(/^create extension if not exists pgmq;$/m, "-- pgmq: from the stand-in")
        .replace(/^create extension if not exists pg_net with schema extensions;$/m, "-- pg_net: stand-in")
        .replace(/^create extension if not exists pg_cron;$/m, "-- pg_cron: stand-in");
      try {
        await session((c) => c.query(sql));
      } catch (e) {
        failures++;
        console.log(`migration FAILED ${f}: ${e.message}`);
        break;
      }
    }
    console.log("migrations: applied");
  } else if (step.startsWith("tests")) {
    const dir = path.join(repo, "supabase", "tests");
    const want = step.includes(":") ? step.split(":")[1].split(",") : ["01", "02", "03", "04", "05", "06"];
    const helpers = read(path.join(dir, "00_helpers.sql"));
    for (const f of fs.readdirSync(dir).filter((x) => /^\d\d_.*\.sql$/.test(x) && want.includes(x.slice(0, 2))).sort()) {
      const message = await session(async (c) => {
        try {
          await c.query(`${helpers}\n${read(path.join(dir, f))}`);
          return "no result (a test ends with a PASS exception)";
        } catch (e) {
          return e.message;
        }
      });
      const ok = message.startsWith("PASS");
      if (!ok) failures++;
      console.log(`${ok ? "ok  " : "FAIL"} ${f}: ${message}`);
    }
  } else if (step === "pending" || step === "rollback") {
    const dir = path.join(repo, "supabase", "pending");
    const suffix = step === "pending" ? "_image_edit_multi_reference.sql" : "_image_edit_multi_reference.rollback.sql";
    const f = fs.readdirSync(dir).find((x) => x.endsWith(suffix));
    try {
      await session((c) => c.query(read(path.join(dir, f))));
      console.log(`${step}: applied ${f}`);
    } catch (e) {
      failures++;
      console.log(`${step} FAILED ${f}: ${e.message}`);
    }
  } else if (step.startsWith("sql:")) {
    const r = await session((c) => c.query(read(path.join(here, step.slice(4)))));
    console.table((Array.isArray(r) ? r[r.length - 1] : r).rows);
  } else if (step === "stop") {
    await server.stop();
    console.log("stopped");
  } else {
    console.log(`unknown step ${step}`);
    failures++;
  }
}
console.log(failures ? `FAILURES: ${failures}` : "all steps passed");
process.exit(failures ? 1 : 0);
