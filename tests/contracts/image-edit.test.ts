// Image Edit with several reference images, and the Image studio routes (18 Oct 2026). Limits come from each model's
// capability (migration 20261018013256 set 16/16/8/8/10 from the KIE docs); the server checks repeat in supabase/tests/07.
import { test } from "node:test";
import assert from "node:assert/strict";
import type { CatalogModel } from "../../src/lib/live/types";
import { countedRefs, modelsTaking, planAdd, readyRefIds, referenceLimit, referenceProblem, type RefItem } from "../../src/lib/live/references";
import { IMAGE_EDIT_HREF, imageEditRedirect, imageModeOf } from "../../src/lib/studio-routes";
import { buildInput } from "../../src/lib/providers/kie/adapters";
import type { ClaimContext } from "../../src/lib/providers/types";

const IMG = ["image/png", "image/jpeg", "image/webp"];
const edit = (id: string, max: number): Pick<CatalogModel, "id" | "references"> => ({ id, references: { min: 1, max, mime: IMG, maxBytes: 10485760 } });
const file = (name: string, mime: string | null = "image/png", size = 1000) => ({ name, size, mime });
const item = (key: string, status: RefItem["status"], assetId?: string): RefItem => ({ key, status, progress: status === "ready" ? 1 : 0, name: key, mime: "image/png", assetId });

test("limit: always the selected model's own capability", () => {
  assert.deepEqual(referenceLimit(edit("flare", 16)), { min: 1, max: 16, mime: IMG, maxBytes: 10485760 });
  assert.equal(referenceLimit(edit("one", 1)).max, 1);
  assert.equal(referenceLimit(null).max, 0);
});

test("add: several files at once; a later selection appends; file checks apply per file", () => {
  const lim = referenceLimit(edit("nano", 8));
  const first = planAdd(lim, [], [file("a.png"), file("b.jpg", "image/jpeg"), file("c.webp", "image/webp")]);
  assert.deepEqual(first.accepted.map((f) => f.name), ["a.png", "b.jpg", "c.webp"]);
  const have = first.accepted.map((f, i) => item(`k${i}`, "ready", `asset-${f.name}`));
  // The second selection goes after the first, in its own order, up to the room left.
  const second = planAdd(lim, have, [file("d.png"), file("e.png"), file("f.png"), file("g.png"), file("h.png"), file("i.png")]);
  assert.deepEqual(second.accepted.map((f) => f.name), ["d.png", "e.png", "f.png", "g.png", "h.png"]);
  assert.deepEqual(second.rejected.map((r) => r.file.name), ["i.png"]);
  assert.match(second.rejected[0].reason, /up to 8 images/);
  // Wrong type, too large, empty or unknown files are refused with a reason and never take room.
  const bad = planAdd(lim, [], [file("x.gif", "image/gif"), file("big.png", "image/png", 11 * 1048576), file("zero.png", "image/png", 0), file("noext", null), file("ok.png")]);
  assert.deepEqual(bad.accepted.map((f) => f.name), ["ok.png"]);
  assert.equal(bad.rejected.length, 4);
  // A failed upload does not count against the limit; it stays visible until removed or retried.
  assert.equal(countedRefs([item("a", "error"), item("b", "ready", "x"), item("c", "uploading")]).length, 2);
});

test("request: only verified uploads are priced, in the order shown; anything unresolved blocks the quote", () => {
  const lim = referenceLimit(edit("flux", 8));
  const items = [item("1", "ready", "A"), item("2", "ready", "C"), item("3", "ready", "B")];
  assert.deepEqual(readyRefIds(items), ["A", "C", "B"]);
  assert.equal(referenceProblem(lim, items), null);
  assert.equal(referenceProblem(lim, [...items, item("4", "uploading")]), "Waiting for the upload to finish");
  assert.equal(referenceProblem(lim, [...items, item("5", "error")]), "Remove the image that could not be used");
  assert.equal(referenceProblem(lim, []), "Add the image to edit");
});

test("model change: a lower limit explains itself and offers models that take every image; nothing is dropped", () => {
  const items = Array.from({ length: 10 }, (_, i) => item(String(i), "ready", `A${i}`));
  const models = [edit("flare", 16), edit("sunburst", 16), edit("nano", 8), edit("flux", 8), edit("seedream", 10)];
  assert.equal(referenceProblem(referenceLimit(edit("nano", 8)), items), "This model takes up to 8 images — remove 2 or choose a model that takes 10");
  assert.deepEqual(modelsTaking(models, 10).map((m) => m.id), ["flare", "sunburst", "seedream"]);
  assert.equal(readyRefIds(items).length, 10);
  // A single-image model stays honestly constrained.
  assert.equal(referenceProblem(referenceLimit(edit("one", 1)), items.slice(0, 2)), "This model takes up to 1 image — remove 1 or choose a model that takes 2");
});

test("provider payload: every edit adapter forwards all references in the customer's order", () => {
  const ctx = (adapter: string, options: Record<string, string | number>): ClaimContext => ({
    job: { id: "j", ref: "R", userId: "u", state: "submitting", tool: "edit", prompt: "Put the hat from image 2 on the person in image 1", options, units: "4" },
    model: { id: "m", providerModelId: "pm", adapter, adapterVersion: 1, providerAccountId: "a" },
    output: { kind: "image", mime: ["image/png"], count: 1, maxBytes: 1 },
    references: [],
    attempt: null,
  });
  const urls = ["https://s/1.png", "https://s/3.png", "https://s/2.png"];
  const cases: [string, string, Record<string, string>][] = [
    ["kie-market-image-edit", "input_urls", { aspect_ratio: "auto", resolution: "1K" }],
    ["kie-nano-banana", "image_input", { aspect_ratio: "auto", resolution: "1K" }],
    ["kie-flux-2", "input_urls", { aspect_ratio: "auto", resolution: "1K" }],
    ["kie-seedream-5", "image_urls", { aspect_ratio: "1:1", resolution: "2K" }],
  ];
  for (const [adapter, field, options] of cases) {
    assert.deepEqual(buildInput({ context: ctx(adapter, options), referenceUrls: urls, callBackUrl: null })[field], urls, adapter);
  }
});

test("routes: the old Edit URL opens Image with Edit selected and keeps its other parameters", () => {
  assert.equal(IMAGE_EDIT_HREF, "/studio/image?mode=edit");
  assert.equal(imageEditRedirect({}), "/studio/image?mode=edit");
  assert.equal(imageEditRedirect({ job: "abc", ref: ["x", "y"] }), "/studio/image?job=abc&ref=x&ref=y&mode=edit");
  assert.equal(imageEditRedirect({ mode: "image", next: "/studio/library?a=1" }), `/studio/image?next=${encodeURIComponent("/studio/library?a=1")}&mode=edit`);
  assert.equal(imageModeOf("edit"), "edit");
  assert.equal(imageModeOf(undefined), "image");
  assert.equal(imageModeOf(["edit", "x"]), "image");
});
