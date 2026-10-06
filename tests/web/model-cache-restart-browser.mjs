// Real ONNX Runtime regression: warm once, close the browser, then process offline with the same profile.
// Uses verified public fixtures on the first run. No photos or native HEVC encoder are needed.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {ORT_ASSETS} from '../../web/src/ort-assets.js';
import {VERSION} from "../../web/src/port.js";
import {MODEL_CACHE_NAME} from "../../web/src/model-download.js";

const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(fileURLToPath(new URL("../../web/", import.meta.url)));
const cacheRoot = path.resolve(fileURLToPath(new URL("./.cache/", import.meta.url)));
fs.mkdirSync(cacheRoot, {recursive: true});
const profile = fs.mkdtempSync(path.join(cacheRoot, "vision-restart-"));
const prefix = "/HoLanLa/";
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (!url.pathname.startsWith(prefix)) {res.writeHead(404); res.end(); return;}
  const filename = path.resolve(root, decodeURIComponent(url.pathname.slice(prefix.length) || "index.html"));
  if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
    res.writeHead(404); res.end(); return;
  }
  const mime = {".js": "text/javascript", ".html": "text/html", ".json": "application/json", ".webmanifest": "application/manifest+json"};
  res.writeHead(200, {"Content-Type": mime[path.extname(filename)] || "application/octet-stream", "Cache-Control": "no-store"});
  let body = fs.readFileSync(filename);
  if (path.basename(filename) === "sw.js" && url.searchParams.get("v") === "cache-upgrade-test") {
    body = Buffer.from(body.toString().replace(/const CACHE_NAME = `[^\n]+`;/,
      "const CACHE_NAME = `${CACHE_PREFIX}cache-upgrade-test`;"));
  }
  res.end(body);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let context;
try {
  async function launch(offline = false) {
    context = await chromium.launchPersistentContext(profile, {
      headless: true, locale: "zh-TW", executablePath: process.env.PLAYWRIGHT_EXECUTABLE || undefined,
    });
    if (!offline) await context.route('https://**/*', route => {
      const index = ORT_ASSETS.findIndex(asset => asset.url === route.request().url());
      if (index < 0) return route.abort();
      const names = ['ort.wasm.min.mjs','ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm','face-detector-nhwc.onnx','face-landmarks.onnx','selfie.onnx'];
      return route.fulfill({path: path.resolve(process.env.ORT_FIXTURE_DIR || '.cache/ort-research', names[index]),
        headers: {'Access-Control-Allow-Origin':'*','Cross-Origin-Resource-Policy':'cross-origin'}, contentType: route.request().url().endsWith('.mjs') ? 'text/javascript' : 'application/octet-stream'});
    });
    await context.setOffline(offline);
    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(20000);
    await page.goto(origin + prefix);
    await page.waitForFunction(() => crossOriginIsolated && navigator.serviceWorker.controller);
    await page.locator("#version").filter({hasText: VERSION}).waitFor();
    return page;
  }
  async function processSyntheticPhoto(page) {
    return page.evaluate(async version => {
      globalThis.VideoFrame = class {close() {}};
      globalThis.VideoEncoder = class {
        static async isConfigSupported(config) {return {supported: true, config};}
        constructor({output}) {this.output = output;}
        configure() {}
        encode() {this.output({byteLength: 4, copyTo: out => out.set([0,0,0,7])},
          {decoderConfig: {description: new Uint8Array([1,2,3])}});}
        async flush() {}
        close() {}
      };
      const {generateRasterFaceMattes} = await import(`./src/face-mattes.js?v=${version}`);
      const image = document.createElement("canvas"); image.width = image.height = 64;
      image.getContext("2d").fillRect(0, 0, 64, 64);
      const events = [];
      const result = await generateRasterFaceMattes(image, 0, null, {onProgress: e => events.push(e)});
      return {state: result.state, events};
    }, VERSION);
  }
  const firstPage = await launch();
  const first = await processSyntheticPhoto(firstPage);
  assert.equal(first.state, "none");
  assert.equal(first.events.filter(e => e.stage === "modelDownload" && e.complete).length, 6);
  assert.ok(!first.events.some(e => e.stage === "modelCacheWarning"));
  console.log("Real ONNX Runtime WASM and three ONNX models downloaded, initialized and cached.");
  const entries = await firstPage.evaluate(async name => (await (await caches.open(name)).keys()).map(r => r.url), MODEL_CACHE_NAME);
  assert.ok(ORT_ASSETS.every(asset => entries.includes(asset.url)), "all verified ONNX Runtime artifacts must persist for offline startup");
  // Simulate a website worker upgrade without changing the committed app files.
  await firstPage.evaluate(async name => {
    const before = (await (await caches.open(name)).keys()).length;
    await navigator.serviceWorker.register("./sw.js?v=cache-upgrade-test", {scope: "./", updateViaCache: "none"});
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("worker upgrade timeout")), 20000);
      const check = () => {
        const controller = navigator.serviceWorker.controller;
        if (controller?.scriptURL.endsWith("v=cache-upgrade-test") && controller.state === 'activated') {
          clearTimeout(timer); navigator.serviceWorker.removeEventListener("controllerchange", check);
          controller.removeEventListener('statechange', check); resolve();
        } else if (controller?.scriptURL.endsWith("v=cache-upgrade-test")) {
          // Replacement updates controller before activate.waitUntil finishes.
          controller.addEventListener('statechange', check);
        }
      };
      navigator.serviceWorker.addEventListener("controllerchange", check); check();
    });
    const remaining = (await (await caches.open(name)).keys()).map(request => request.url);
    if (!await caches.has(name) || remaining.length !== before)
      throw Error(`worker upgrade changed cached assets: expected ${before}, retained ${JSON.stringify(remaining)}`);
  }, MODEL_CACHE_NAME);
  await context.close(); context = null;
  const offlinePage = await launch(true);
  const second = await processSyntheticPhoto(offlinePage);
  assert.equal(second.state, "none");
  assert.equal(second.events.filter(e => e.stage === "modelCache" && e.complete).length, 6);
  assert.ok(!second.events.some(e => e.stage === "modelDownload"));
  assert.ok(!second.events.some(e => e.stage === "modelCacheWarning"));
  await offlinePage.locator('#model-cache summary').click();
  await offlinePage.locator('#model-cache-files li').filter({hasText: 'Face Landmarker'}).getByText(/已儲存在本機/).waitFor();
  assert.equal(await offlinePage.locator('#model-cache-files li').getByText(/已儲存在本機/).count(), 4);
  await offlinePage.locator('#model-cache-clear').click();
  await offlinePage.locator('#model-cache-status').filter({hasText: '已刪除'}).waitFor();
  await offlinePage.waitForFunction(() => [...document.querySelectorAll('#model-cache-files li span')]
    .every(el => el.textContent.includes('尚未儲存')));
  await assert.rejects(processSyntheticPhoto(offlinePage), /Failed to fetch/,
    'after deleting real models, the same offline page must request new bytes rather than reuse live instances');
  console.log("Real ONNX Runtime passed after browser shutdown/restart with networking disabled; worker upgrades retain cached assets.");
  console.log("Real-model deletion also passed: all six files removed, live WASM sessions released, and a new download required.");
} finally {
  if (context) await context.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  // Only remove the temporary profile created by this test, within its verified cache directory.
  if (!path.resolve(profile).startsWith(cacheRoot + path.sep)) throw Error("Unexpected test profile path");
  fs.rmSync(profile, {recursive: true, force: true});
}
