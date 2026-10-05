import assert from "node:assert/strict";
import test from "node:test";
import {MODEL_CACHE_NAME} from "../../web/src/model-download.js";
import {MODEL_URL, SEGMENTER_MODEL_URL, WASM_URL} from "../../web/src/face-mattes.js";
import {listCachedModelFiles, deleteCachedModelFiles} from "../../web/src/model-cache.js";

function storage() {
  const entries = new Map([
    [WASM_URL + "/vision_wasm_internal.wasm", new Response("wasm", {headers: {"content-length": "9600000"}})],
    [WASM_URL + "/vision_wasm_nosimd_internal.wasm", new Response("fallback", {headers: {"content-length": "9500000"}})],
    [MODEL_URL, new Response("face", {headers: {"content-length": "3800000"}})],
    [SEGMENTER_MODEL_URL, new Response("segmentation", {headers: {"content-length": "16400000"}})],
    [WASM_URL + "/vision_wasm_internal.js", new Response("runtime loader")],
    [WASM_URL.replace(/\/wasm$/, "/+esm"), new Response("runtime module")],
    ["https://unrelated.test/other.wasm", new Response("unrelated")],
  ]);
  const cache = {keys: async () => [...entries.keys()].map(url => new Request(url)),
    match: async request => entries.get(request.url)?.clone(), delete: async request => entries.delete(request.url)};
  return {entries, has: async name => name === MODEL_CACHE_NAME,
    open: async name => {assert.equal(name, MODEL_CACHE_NAME); return cache;}};
}

test("cache management lists both WASM variants and both models", async () => {
  const files = await listCachedModelFiles(storage());
  assert.deepEqual(files.map(({resource, bytes, count, scriptCount}) => ({resource, bytes, count, scriptCount})), [
    {resource: "wasm", bytes: 19100000, count: 2, scriptCount: 2},
    {resource: "face", bytes: 3800000, count: 1, scriptCount: 0},
    {resource: "segmenter", bytes: 16400000, count: 1, scriptCount: 0},
  ]);
  assert.ok(files.every(file => file.current && file.version && file.version !== "latest"));
  assert.equal(files[0].scriptBytes, 28);
  assert.equal(files[1].variant, "float16");
  assert.equal(files[2].variant, "float32");
});
test("individual deletion removes only the selected resource", async () => {
  const saved = storage();
  await deleteCachedModelFiles("face", saved);
  assert.equal(saved.entries.has(MODEL_URL), false);
  assert.equal(saved.entries.has(SEGMENTER_MODEL_URL), true);
  assert.equal(saved.entries.has(WASM_URL + "/vision_wasm_internal.wasm"), true);
  await deleteCachedModelFiles("wasm", saved);
  assert.equal(saved.entries.has(WASM_URL + "/vision_wasm_internal.wasm"), false);
  assert.equal(saved.entries.has(WASM_URL + "/vision_wasm_nosimd_internal.wasm"), false);
  assert.equal(saved.entries.has(WASM_URL + "/vision_wasm_internal.js"), false);
  assert.equal(saved.entries.has(WASM_URL.replace(/\/wasm$/, "/+esm")), false);
});
test("delete all removes runtime scripts too and retains unrelated entries", async () => {
  const saved = storage();
  await deleteCachedModelFiles("all", saved);
  assert.ok((await listCachedModelFiles(saved)).every(file => file.bytes === 0 && file.count === 0));
  assert.equal(saved.entries.size, 1);
  await assert.rejects(deleteCachedModelFiles("toString", saved), /Unknown model resource/);
  assert.equal(saved.entries.size, 1);
});

test("older versions and legacy latest entries remain visible and can be deleted without touching current files", async () => {
  const saved = storage();
  const oldWasm = WASM_URL.replace(/@[^/]+\/wasm$/, "@0.10.20/wasm");
  const oldFace = MODEL_URL.replace("/float16/1/", "/float16/2/");
  const legacy = SEGMENTER_MODEL_URL.replace("/float32/1/", "/float32/latest/");
  const otherVariant = MODEL_URL.replace("/float16/", "/float32/");
  for (const url of [oldWasm + "/vision_wasm_internal.wasm", oldWasm + "/vision_wasm_internal.js",
    oldWasm.replace(/\/wasm$/, "/+esm"), oldFace, legacy, otherVariant])
    saved.entries.set(url, new Response("old asset", {headers: {"content-length": "9"}}));
  const files = await listCachedModelFiles(saved);
  assert.equal(files.length, 7);
  assert.equal(files.filter(file => file.current).length, 3);
  const oldRuntime = files.find(file => file.version === "0.10.20");
  assert.equal(oldRuntime.current, false);
  assert.equal(oldRuntime.count, 1);
  assert.equal(oldRuntime.scriptCount, 2);
  assert.ok(files.some(file => file.version === "latest" && !file.current));
  assert.ok(files.some(file => file.resource === "face" && file.version === "1" && file.variant === "float32" && !file.current));

  await deleteCachedModelFiles("wasm", saved, {version: "0.10.20", variant: ""});
  assert.ok(![...saved.entries.keys()].some(url => url.startsWith(oldWasm) || url === oldWasm.replace(/\/wasm$/, "/+esm")));
  assert.ok(saved.entries.has(WASM_URL + "/vision_wasm_internal.wasm"));
  assert.ok(saved.entries.has(WASM_URL + "/vision_wasm_internal.js"));
  await deleteCachedModelFiles("segmenter", saved, {version: "latest", variant: "float32"});
  assert.equal(saved.entries.has(legacy), false);
  assert.ok(saved.entries.has(SEGMENTER_MODEL_URL));
  await deleteCachedModelFiles("face", saved, {version: "1", variant: "float32"});
  assert.equal(saved.entries.has(otherVariant), false);
  assert.ok(saved.entries.has(MODEL_URL));
  await deleteCachedModelFiles("all", saved);
  assert.deepEqual([...saved.entries.keys()], ["https://unrelated.test/other.wasm"]);
});

test("runtime-only old versions remain visible and deletable; unrelated URLs are excluded", async () => {
  const saved = storage();
  const oldScript = WASM_URL.replace(/@[^/]+\/wasm$/, "@0.10.19/wasm") + "/vision_wasm_nosimd_internal.js";
  const oldBundle = oldScript.replace("/wasm/vision_wasm_nosimd_internal.js", "/vision_bundle.mjs");
  const unrelated = [WASM_URL + "/unrelated.txt", MODEL_URL.replace("storage.googleapis.com", "example.com"),
    MODEL_URL.replace("face_landmarker.task", "other.task")];
  saved.entries.set(oldScript, new Response("loader"));
  saved.entries.set(oldBundle, new Response("bundle"));
  for (const url of unrelated) saved.entries.set(url, new Response("other"));
  const files = await listCachedModelFiles(saved);
  assert.equal(files.length, 4);
  const old = files.find(file => file.version === "0.10.19");
  assert.equal(old.count, 0);
  assert.equal(old.scriptCount, 2);
  assert.equal(old.scriptBytes, 12);
  await assert.rejects(deleteCachedModelFiles("wasm", saved, {version: "0.10.19"}), /Invalid model version/);
  assert.ok(saved.entries.has(oldScript));
  await deleteCachedModelFiles("all", saved);
  assert.equal(saved.entries.has(oldScript), false);
  assert.equal(saved.entries.has(oldBundle), false);
  assert.ok(unrelated.every(url => saved.entries.has(url)));
});
test("missing cache does not create an empty store and inaccessible storage reports failure", async () => {
  const absent = {has: async () => false, open: async () => {throw Error("should not open");}};
  assert.ok((await listCachedModelFiles(absent)).every(file => file.count === 0));
  await deleteCachedModelFiles("all", absent);
  await assert.rejects(listCachedModelFiles(null), /unavailable/);
  await assert.rejects(deleteCachedModelFiles("all", null), /unavailable/);
});
