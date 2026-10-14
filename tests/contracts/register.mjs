// Lets Node's built-in test runner load the app's TypeScript modules directly:
// maps the "@/" alias to src/, resolves extensionless imports, and stubs "server-only".
import { register } from "node:module";

register(
  `data:text/javascript,${encodeURIComponent(`
import { existsSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
const SRC = ${JSON.stringify(new URL("../../src/", import.meta.url).href)};
const EXTS = [".ts", ".tsx", "/index.ts"];
function withExt(url) {
  const path = fileURLToPath(url);
  if (existsSync(path) && !path.endsWith("/") && /\\.[cm]?[jt]sx?$/.test(path)) return url;
  for (const e of EXTS) if (existsSync(path + e)) return pathToFileURL(path + e).href;
  return url;
}
export async function resolve(specifier, context, next) {
  if (specifier === "server-only") return { url: "data:text/javascript,export {}", shortCircuit: true };
  if (specifier.startsWith("@/")) return { url: withExt(new URL(specifier.slice(2), SRC).href), shortCircuit: true };
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:")) {
    return { url: withExt(new URL(specifier, context.parentURL).href), shortCircuit: true };
  }
  return next(specifier, context);
}
`)}`,
  import.meta.url,
);
