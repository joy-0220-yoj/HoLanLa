import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {MODEL_CACHE_NAME} from "../../web/src/model-download.js";

const handlers = new Map(), stores = new Map(), requests = [];
const source = readFileSync(new URL("../../web/sw.js", import.meta.url), "utf8");
const appCache = "holanla-" + source.match(/const CACHE_NAME = `\$\{CACHE_PREFIX\}([^`]+)`/)[1];
const runtime = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/";
let offline = false;
for (const name of ["holanla-old", appCache, MODEL_CACHE_NAME, "unrelated-site-cache"]) stores.set(name, new Map());
vm.runInNewContext(source, {
  self: {location: {origin: "https://site.test"}, addEventListener: (name, handler) => handlers.set(name, handler),
    clients: {claim: async () => {}}, skipWaiting: async () => {}},
  caches: {
    keys: async () => [...stores.keys()], delete: async name => stores.delete(name),
    open: async name => {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {match: async request => entries.get(request.url)?.clone(),
        put: async (request, response) => {
          const bytes = await response.arrayBuffer();
          entries.set(request.url, new Response(bytes, {headers: response.headers}));
        }};
    },
  },
  fetch: async request => {
    requests.push(request.url);
    if (offline) throw Error("offline");
    return new Response("export const cached = true;", {headers: {"Content-Type": "text/javascript"}});
  }, Headers, Response, URL, console,
});
const activation = [];
handlers.get("activate")({waitUntil: promise => activation.push(promise)});
await Promise.all(activation);
assert.ok(!stores.has("holanla-old"));
assert.ok(stores.has(appCache));
assert.ok(stores.has(MODEL_CACHE_NAME), "website upgrades must retain model assets");
assert.ok(stores.has("unrelated-site-cache"));

async function request(url) {
  const pending = [];
  let response;
  handlers.get("fetch")({request: new Request(url), respondWith: promise => {response = promise;},
    waitUntil: promise => pending.push(promise)});
  const result = await response;
  await Promise.all(pending);
  return result;
}
for (const path of ["+esm", "wasm/vision_wasm_internal.js"]) {
  offline = false;
  assert.match(await (await request(runtime + path)).text(), /cached = true/);
  const count = requests.length;
  offline = true;
  assert.match(await (await request(runtime + path)).text(), /cached = true/);
  assert.equal(requests.length, count, "cached runtime scripts do not contact the CDN");
}
for (const url of [runtime + "wasm/vision_wasm_internal.wasm",
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@different/+esm", "https://unrelated.test/model.js"]) {
  assert.equal(await request(url), undefined, "only the pinned runtime scripts are intercepted");
}
assert.equal(stores.get(MODEL_CACHE_NAME).size, 2);
console.log("Service worker retains vision assets during upgrades and serves only the pinned runtime scripts cache-first, including offline.");
