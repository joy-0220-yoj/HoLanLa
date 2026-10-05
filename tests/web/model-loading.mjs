import assert from "node:assert/strict";
import http from "node:http";
import {gzipSync} from "node:zlib";
import {setTimeout as delay} from "node:timers/promises";
import test from "node:test";
import {downloadModelBytes, withModelTimeout, ModelTimeoutError, MODEL_CACHE_NAME} from "../../web/src/model-download.js";
import {updateModelProgress} from "../../web/src/model-progress.js";
import {STRINGS} from "../../web/src/i18n.js";

function modelStorage() {
  const entries = new Map();
  const cache = {
    match: async url => entries.get(url)?.clone(),
    put: async (url, response) => {entries.set(url, response.clone());},
    delete: async url => entries.delete(url),
  };
  return {entries, cache, open: async name => {assert.equal(name, MODEL_CACHE_NAME); return cache;}};
}

test("streamed assets report real bytes and stop stalled downloads", async t => {
  const payload = Buffer.from("a synthetic model split into chunks");
  const compressed = gzipSync(payload);
  let retry = 0;
  const requests = new Map();
  const server = http.createServer((req, res) => {
    requests.set(req.url, (requests.get(req.url) || 0) + 1);
    if (req.url === "/headers-stall") return;
    if (req.url === "/body-stall") { res.writeHead(200); res.write("partial"); return; }
    if (req.url === "/error" || req.url === "/retry" && retry++ === 0) { res.writeHead(503); res.end(); return; }
    if (req.url === "/empty") { res.end(); return; }
    if (req.url === "/gzip") {
      res.writeHead(200, {"Content-Length": compressed.length, "Content-Encoding": "gzip"});
      res.end(compressed); return;
    }
    res.writeHead(200, req.url === "/unknown" ? {} : {"Content-Length": payload.length});
    res.write(payload.subarray(0, 7));
    setTimeout(() => res.end(payload.subarray(7)), 120);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  await t.test("known size, incremental progress and final completion", async () => {
    const events = [];
    const bytes = await downloadModelBytes(origin + "/known", {onProgress: event => events.push(event)});
    assert.deepEqual(Buffer.from(bytes), payload);
    assert.ok(events.some(event => event.loaded === 7 && !event.complete));
    assert.deepEqual(events.at(-1), {loaded: payload.length, total: payload.length, complete: true});
    assert.ok(events.every((event, i) => i === 0 || event.loaded >= events[i - 1].loaded));
  });
  await t.test("unknown size remains unknown until the stream completes", async () => {
    const events = [];
    assert.deepEqual(Buffer.from(await downloadModelBytes(origin + "/unknown", {onProgress: e => events.push(e)})), payload);
    assert.ok(events.every(event => event.total === null));
    assert.equal(events.at(-1).complete, true);
  });
  await t.test("compressed Content-Length is not a decoded byte total", async () => {
    const events = [];
    assert.deepEqual(Buffer.from(await downloadModelBytes(origin + "/gzip", {onProgress: e => events.push(e)})), payload);
    assert.ok(events.every(event => event.total === null));
  });
  await t.test("HTTP and empty responses fail, a later attempt can succeed", async () => {
    await assert.rejects(downloadModelBytes(origin + "/error"), /HTTP 503/);
    await assert.rejects(downloadModelBytes(origin + "/empty"), /Empty model download/);
    await assert.rejects(downloadModelBytes(origin + "/retry"), /HTTP 503/);
    assert.deepEqual(Buffer.from(await downloadModelBytes(origin + "/retry")), payload);
  });
  for (const endpoint of ["headers-stall", "body-stall"]) {
    await t.test(`${endpoint} times out instead of waiting forever`, async () => {
      const events = [];
      await assert.rejects(downloadModelBytes(`${origin}/${endpoint}`, {
        stallTimeoutMs: 40, onProgress: e => events.push(e),
      }), ModelTimeoutError);
      assert.ok(!events.some(e => e.complete));
    });
  }
  await t.test("completed downloads survive a fresh call with zero new requests", async () => {
    const cacheStorage = modelStorage(), events = [];
    const url = origin + "/persisted";
    const first = await downloadModelBytes(url, {cacheStorage});
    const second = await downloadModelBytes(url, {cacheStorage, onProgress: e => events.push(e)});
    assert.deepEqual(first, second);
    assert.equal(requests.get("/persisted"), 1);
    assert.deepEqual(events.map(e => e.source), ["cache", "cache"]);
    assert.equal(events.at(-1).loaded, payload.length);
    assert.equal(events.at(-1).complete, true);
  });
  await t.test("a cached compressed download uses its decoded byte length", async () => {
    const cacheStorage = modelStorage(), events = [];
    await downloadModelBytes(origin + "/gzip", {cacheStorage});
    assert.deepEqual(Buffer.from(await downloadModelBytes(origin + "/gzip", {cacheStorage, onProgress: e => events.push(e)})), payload);
    assert.equal(events.at(-1).total, payload.length);
    assert.equal(events.at(-1).source, "cache");
  });
  await t.test("new version URLs download their own bytes and never reuse old or latest entries", async () => {
    const cacheStorage = modelStorage();
    const oldUrl = origin + "/versions/latest/model", newUrl = origin + "/versions/1/model";
    cacheStorage.entries.set(oldUrl, new Response("old", {headers: {"content-length": "3"}}));
    assert.deepEqual(Buffer.from(await downloadModelBytes(newUrl, {cacheStorage})), payload);
    assert.equal(requests.get("/versions/1/model"), 1);
    assert.equal(await cacheStorage.entries.get(oldUrl).text(), "old");
    assert.deepEqual(Buffer.from(await downloadModelBytes(newUrl, {cacheStorage})), payload);
    assert.equal(requests.get("/versions/1/model"), 1);
  });
  await t.test("failed, stalled and empty downloads are never saved", async () => {
    const cacheStorage = modelStorage();
    for (const endpoint of ["error", "empty", "body-stall"]) {
      await assert.rejects(downloadModelBytes(`${origin}/${endpoint}`, {cacheStorage, stallTimeoutMs: 40}));
    }
    assert.equal(cacheStorage.entries.size, 0);
  });
  await t.test("a truncated cache entry is replaced by a complete download", async () => {
    const cacheStorage = modelStorage(), url = origin + "/corrupt";
    cacheStorage.entries.set(url, new Response("bad", {headers: {"Content-Length": "20"}}));
    assert.deepEqual(Buffer.from(await downloadModelBytes(url, {cacheStorage})), payload);
    assert.deepEqual(Buffer.from(await cacheStorage.entries.get(url).arrayBuffer()), payload);
    assert.equal(requests.get("/corrupt"), 1);
  });
  await t.test("storage failures preserve conversion and report that caching is unavailable", async () => {
    for (const storage of [
      {open: async () => {throw Error("storage disabled");}},
      {open: async () => ({match: async () => undefined, put: async () => {throw Error("quota exceeded");}})},
    ]) {
      const events = [];
      assert.deepEqual(Buffer.from(await downloadModelBytes(origin + "/gzip", {cacheStorage: storage, onProgress: e => events.push(e)})), payload);
      assert.ok(events.some(e => e.source === "cacheWarning"));
      assert.equal(events.at(-1).complete, true);
    }
  });
});

test("an initialization that finishes after timeout is closed", async () => {
  let closed = false;
  await assert.rejects(withModelTimeout(delay(30).then(() => ({close() {closed = true;}})), 5,
    value => value.close()), ModelTimeoutError);
  await delay(40);
  assert.equal(closed, true);
  assert.equal(await withModelTimeout(Promise.resolve(42), 50), 42);
});

for (const lang of ["zh", "en"]) {
  test(`${lang} progress preserves a step timer and distinguishes download from initialization`, () => {
    const lines = [], values = [];
    const ui = {set: (text, cls) => lines.push({text, cls}), update: text => {lines.at(-1).text = text;},
      progress: value => values.push(value)};
    const T = key => STRINGS[lang][key];
    const report = detail => updateModelProgress(ui, {stage: "modelDownload", resource: "face", ...detail}, T);
    report({loaded: 0, total: null});
    assert.equal(values.at(-1), undefined);
    assert.ok(!lines.at(-1).text.includes("%"));
    report({loaded: 2500000, total: 5000000});
    assert.equal(lines.length, 1);
    assert.match(lines.at(-1).text, /2.5 MB \/ 5.0 MB \(50%\)/);
    assert.equal(values.at(-1), 50);
    report({loaded: 5000000, total: 5000000});
    assert.equal(values.at(-1), 99, "completion requires end of stream");
    report({loaded: 5000000, total: 5000000, complete: true});
    assert.equal(values.at(-1), 100);
    assert.equal(lines.length, 1);
    updateModelProgress(ui, {stage: "modelLoading", resource: "face", phase: "gpu"}, T);
    assert.equal(values.at(-1), undefined);
    assert.match(lines.at(-1).text, /GPU/);
    updateModelProgress(ui, {stage: "modelLoading", resource: "face", phase: "cpu"}, T);
    assert.match(lines.at(-1).text, /CPU/);
    updateModelProgress(ui, {stage: "modelError", resource: "segmenter", reason: "stalled"}, T);
    assert.match(lines.at(-1).text, /30/);
    assert.equal(lines.at(-1).cls, "err");
    assert.equal(values.at(-1), null);
    updateModelProgress(ui, {stage: "modelCache", resource: "wasm", loaded: 0, complete: false}, T);
    assert.equal(values.at(-1), undefined);
    updateModelProgress(ui, {stage: "modelCache", resource: "wasm", loaded: 9600000, complete: true}, T);
    assert.match(lines.at(-1).text, /9.6 MB/);
    assert.ok(lines.at(-1).text.includes(T("model.wasm")));
    assert.equal(values.at(-1), null);
    assert.ok(!/下載|Downloaded/.test(lines.at(-1).text));
    assert.equal(updateModelProgress(ui, {stage: "detect"}, T), false);
    assert.ok(lines.every(line => !/undefined|\{\w+\}/.test(line.text)));
  });
}
