// No private photos or installed HEVC encoder needed. PLAYWRIGHT_MODULE/EXECUTABLE can use an existing runtime.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {VERSION} from "../../web/src/port.js";

const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root = path.resolve(fileURLToPath(new URL("../../web/", import.meta.url)));
const hits = {wasm: 0, face: 0, segmenter: 0};
let failFace = false;
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname.startsWith("/fixture/")) {
    const resource = url.pathname.split("/").pop();
    hits[resource]++;
    if (resource === "face" && failFace) { failFace = false; res.writeHead(503); res.end(); return; }
    const body = Buffer.alloc(262144, 7);
    res.writeHead(200, {"Content-Type": "application/octet-stream", "X-Content-Type-Options": "nosniff",
      ...(resource === "segmenter" ? {} : {"Content-Length": body.length})});
    res.write(body.subarray(0, body.length / 2));
    setTimeout(() => res.end(body.subarray(body.length / 2)), 180);
    return;
  }
  const filename = path.resolve(root, "." + decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname));
  if (!filename.startsWith(root + path.sep) || !fs.existsSync(filename)) { res.writeHead(404); res.end(); return; }
  const mime = {".js": "text/javascript", ".html": "text/html", ".json": "application/json", ".webmanifest": "application/manifest+json"};
  res.writeHead(200, {"Content-Type": mime[path.extname(filename)] || "application/octet-stream", "Cache-Control": "no-store"});
  res.end(fs.readFileSync(filename));
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const rowSource = app.slice(app.indexOf("function addCodecCorrection(item)"), app.indexOf("function updateLinearProgress"));
const progressSource = app.slice(app.indexOf("function updateFaceProgress"), app.indexOf("async function handleBrowserReencode"));
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE || undefined});
  const context = await browser.newContext({serviceWorkers: "block", locale: "zh-TW"});
  await context.route("**/*", route => {
    const url = route.request().url();
    if (url.startsWith(origin) || url.startsWith("blob:" + origin)) return route.continue();
    if (url.includes("@mediapipe/tasks-vision@") && url.endsWith("/+esm")) {
      return route.fulfill({contentType: "text/javascript", body: `
        const origin = ${JSON.stringify(origin)};
        export const FilesetResolver = {forVisionTasks: async base => ({wasmBinaryPath: base + '/vision_wasm_internal.wasm'})};
        let firstFaceBuffer;
        async function verify(vision, options, resource) {
          if (!vision.wasmBinaryPath.startsWith('blob:')) throw Error('WASM must use downloaded bytes');
          const wasm = new Uint8Array(await (await fetch(vision.wasmBinaryPath)).arrayBuffer());
          if (wasm.length !== 262144 || !wasm.every(value => value === 7)) throw Error('incorrect WASM');
          if (!(options.baseOptions.modelAssetBuffer instanceof Uint8Array)
            || options.baseOptions.modelAssetBuffer.length !== 262144
            || !options.baseOptions.modelAssetBuffer.every(value => value === 7)
            || options.baseOptions.modelAssetPath) throw Error('model must use downloaded bytes');
          if (resource === 'face') {
            if (options.baseOptions.delegate === 'GPU') firstFaceBuffer = options.baseOptions.modelAssetBuffer;
            else if (firstFaceBuffer !== options.baseOptions.modelAssetBuffer) throw Error('GPU/CPU must share the buffer');
          }
        }
        export const FaceLandmarker = {createFromOptions: async (vision, options) => {
          await verify(vision, options, 'face');
          if (options.baseOptions.delegate === 'GPU') throw Error('synthetic GPU unavailable');
          return {detect: () => ({faceLandmarks: []}), close() {globalThis.testFaceClosed = (globalThis.testFaceClosed || 0) + 1;}};
        }};
        export const ImageSegmenter = {createFromOptions: async (vision, options) => {
          await verify(vision, options, 'segmenter');
          return {getLabels: () => ['background', 'hair', 'body-skin', 'face-skin', 'clothes', 'others'],
            segment: () => ({confidenceMasks: [.1, .1, .2, .4, .1, .1].map(value => ({width: 4, height: 4,
              getAsFloat32Array: () => new Float32Array(16).fill(value), close() {}}))}),
            close() {globalThis.testSegmenterClosed = (globalThis.testSegmenterClosed || 0) + 1;}};
        }};
      `});
    }
    return route.abort();
  });
  async function openTestPage() {
    const page = await context.newPage();
    await page.goto(origin);
    await page.evaluate(async ({rowSource, progressSource, origin, version}) => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (input, init) => originalFetch(String(input).endsWith('/face_landmarker.task')
        ? origin + '/fixture/face' : String(input).endsWith('/selfie_multiclass_256x256.tflite')
        ? origin + '/fixture/segmenter' : String(input).endsWith('/vision_wasm_internal.wasm')
        ? origin + '/fixture/wasm' : input, init);
      const {STRINGS, ITEM_LABEL_KEYS} = await import('./src/i18n.js');
      const {updateModelProgress} = await import('./src/model-progress.js');
      const {generateRasterFaceMattes} = await import('./src/face-mattes.js?v=' + version);
      const T = key => STRINGS.zh[key];
      const {row, updateFaceProgress} = new Function('document', 'list', 'T', 'ITEM_LABEL_KEYS', 'updateModelProgress',
        rowSource + progressSource + ';return {row, updateFaceProgress};')(
        document, document.getElementById('list'), T, ITEM_LABEL_KEYS, updateModelProgress);
      const codecTest=row('icc-progress');codecTest.set('decoding');
      const codec={operation:'decode',source:'WebCodecs VideoDecoder',colorProfile:'Display P3'};
      codecTest.codec(codec);codecTest.codec({...codec,colorCorrection:true});codecTest.codec({...codec,colorCorrection:true});
      if(codecTest.el.querySelectorAll('.codec-correction').length!==1 || !codecTest.el.textContent.includes('已套用 HEIF／ICC 色彩標記'))
        throw Error('ICC correction must update the existing codec badge exactly once');
      const grayCodec={operation:'decode',source:'WebCodecs VideoDecoder',colorProfile:'Gray Linear',dataPreview:true};
      codecTest.codec(grayCodec);codecTest.codec(grayCodec);
      if(codecTest.el.querySelectorAll('.codec-data-preview').length!==1 || !codecTest.el.textContent.includes('灰階輔助圖數值預覽'))
        throw Error('Gray data preview must be localized and deduplicated');
      const decodeError='test readback failure <img src=x onerror=alert(1)>';
      codecTest.codec({...codec,decodeError});codecTest.codec({...codec,decodeError});
      if(codecTest.el.querySelectorAll('.codec-error').length!==1 || !codecTest.el.textContent.includes('解碼失敗：'+decodeError)
        || codecTest.el.querySelector('.codec-error img'))throw Error('Decode failures must update the badge once as plain text');
      codecTest.set('complete','ok');
      if(!codecTest.el.textContent.includes('已套用 HEIF／ICC 色彩標記'))throw Error('ICC correction must survive completion');
      if(!codecTest.el.textContent.includes('解碼失敗：'+decodeError))throw Error('Decode failure must survive completion');
      codecTest.el.remove();
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
      globalThis.runModelTest = async () => {
        const ui = row('synthetic.png'), events = [];
        const image = document.createElement('canvas'); image.width = image.height = 64;
        const bar = ui.el.querySelector('progress');
        let result, error;
        try {
          result = await generateRasterFaceMattes(image, 0, null, {onProgress: event => {
            updateFaceProgress(ui, event);
            events.push({...event, hidden: bar.hidden, value: bar.getAttribute('value'), label: bar.getAttribute('aria-label')});
          }});
        } catch (e) { error = e.message; }
        ui.set(error || 'complete', error ? 'err' : 'ok');
        return {state: result?.state, error, events, lines: [...ui.el.querySelectorAll('.status-label')].map(el => el.textContent)};
      };
    }, {rowSource, progressSource, origin, version: VERSION});
    return page;
  }
  const page = await openTestPage();
  const first = await page.evaluate(() => runModelTest());
  assert.equal(first.error, undefined, JSON.stringify(first));
  assert.equal(first.state, "none");
  assert.deepEqual(hits, {wasm: 1, face: 1, segmenter: 1});
  for (const resource of Object.keys(hits)) {
    const events = first.events.filter(e => e.stage === "modelDownload" && e.resource === resource);
    assert.ok(events.some(e => e.loaded > 0 && !e.complete), `${resource} has incremental bytes`);
    assert.equal(events.at(-1).value, "100");
    assert.ok(events.every(e => !e.hidden));
  }
  assert.ok(first.events.some(e => e.stage === "modelDownload" && e.resource === "face" && e.loaded > 0
    && Number(e.value) > 0 && Number(e.value) < 100));
  assert.ok(first.events.some(e => e.stage === "modelDownload" && e.resource === "segmenter" && e.loaded > 0 && !e.complete && e.value === null));
  assert.ok(first.events.some(e => e.stage === "modelLoading" && e.phase === "gpu" && e.value === null && /GPU/.test(e.label)));
  assert.ok(first.events.some(e => e.stage === "modelLoading" && e.phase === "cpu" && /CPU/.test(e.label)));
  assert.ok(first.events.filter(e => ["detect", "segment", "matte"].includes(e.stage)).every(e => e.hidden));
  assert.equal(first.lines.filter(line => /已下載/.test(line)).length, 3, "one line per resource, not per network chunk");
  const second = await page.evaluate(() => runModelTest());
  assert.equal(second.state, "none");
  assert.ok(!second.events.some(e => ["modelDownload", "modelLoading"].includes(e.stage)));
  assert.deepEqual(hits, {wasm: 1, face: 1, segmenter: 1}, "later photos reuse models");
  const cachedPage = await openTestPage();
  const cached = await cachedPage.evaluate(() => runModelTest());
  assert.equal(cached.state, "none");
  assert.equal(cached.events.filter(e => e.stage === "modelCache" && e.complete).length, 3);
  assert.ok(!cached.events.some(e => e.stage === "modelDownload"));
  assert.equal(cached.lines.filter(line => /已從本機快取載入 Google MediaPipe/.test(line)).length, 3);
  assert.deepEqual(hits, {wasm: 1, face: 1, segmenter: 1}, "a fresh page reads persistent assets without fetching");
  await cachedPage.evaluate(async () => {
    const {MODEL_CACHE_NAME} = await import('./src/model-download.js');
    const cache = await caches.open(MODEL_CACHE_NAME);
    await cache.delete('https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task');
  });
  failFace = true;
  const retryPage = await openTestPage();
  const failed = await retryPage.evaluate(() => runModelTest());
  assert.equal(failed.error, "HTTP 503");
  assert.ok(failed.lines.some(line => /Google MediaPipe Face Landmarker 人臉與特徵點模型準備失敗.*HTTP 503/.test(line)));
  const recovered = await retryPage.evaluate(() => runModelTest());
  assert.equal(recovered.state, "none");
  assert.deepEqual(hits, {wasm: 1, face: 3, segmenter: 1}, "retry keeps the cached assets and reloads only the missing model");
  await retryPage.locator('#model-cache summary').click();
  await retryPage.locator('#model-cache-files li').filter({hasText: 'Google MediaPipe Face Landmarker'}).getByText(/已儲存在本機/).waitFor();
  assert.equal(await retryPage.locator('#model-cache-files li').getByText(/已儲存在本機/).count(), 3);
  assert.equal(await retryPage.locator('#model-cache-files li strong').filter({hasText: '本頁使用版本'}).count(), 3);
  assert.match(await retryPage.locator('#model-cache-files li').filter({hasText: 'Face Landmarker'}).locator('strong').textContent(), /版本 1 · float16/);
  assert.match(await retryPage.locator('#model-cache-files li').filter({hasText: 'SelfieMulticlass'}).locator('strong').textContent(), /版本 1 · float32/);
  await retryPage.locator('button[data-resource="face"]').click();
  await retryPage.locator('#model-cache-status').filter({hasText: '已刪除'}).waitFor();
  await retryPage.waitForFunction(() => document.querySelector('button[data-resource="face"]').disabled);
  assert.equal(await retryPage.locator('#model-cache-files li').getByText(/已儲存在本機/).count(), 2);
  assert.equal(await retryPage.evaluate(() => globalThis.testFaceClosed), 1, "deletion closes the loaded face model");
  assert.equal((await retryPage.evaluate(() => runModelTest())).state, "none");
  assert.deepEqual(hits, {wasm: 1, face: 4, segmenter: 1}, "only the deleted face model downloads again in the same page");
  // Reopen the panel to refresh after this direct inference call (the app refreshes after queued files).
  await retryPage.locator('#model-cache summary').click();
  await retryPage.locator('#model-cache summary').click();
  await retryPage.locator('button[data-resource="face"]').waitFor({state: 'visible'});
  await retryPage.waitForFunction(() => !document.querySelector('button[data-resource="face"]').disabled);
  // Simulate an upgrade with a legacy latest model and an old JS-only runtime still on disk.
  await retryPage.evaluate(async ({version}) => {
    const {MODEL_CACHE_NAME} = await import('./src/model-download.js?v=' + version);
    const {SEGMENTER_MODEL_URL, WASM_URL} = await import('./src/face-mattes.js?v=' + version);
    const cache = await caches.open(MODEL_CACHE_NAME);
    await cache.put(SEGMENTER_MODEL_URL.replace('/float32/1/', '/float32/latest/'),
      new Response('legacy', {headers: {'content-length': '6'}}));
    await cache.put(WASM_URL.replace(/@[^/]+\/wasm$/, '@0.10.20/wasm') + '/vision_wasm_internal.js', new Response('old loader'));
  }, {version: VERSION});
  await retryPage.locator('#model-cache summary').click();
  await retryPage.locator('#model-cache summary').click();
  const legacyRow = retryPage.locator('#model-cache-files li').filter({hasText: '版本未固定'});
  await legacyRow.waitFor();
  assert.equal(await retryPage.locator('#model-cache-files li').count(), 5);
  assert.match(await legacyRow.locator('strong').textContent(), /版本 latest/);
  const oldRuntime = retryPage.locator('#model-cache-files li').filter({hasText: '版本 0.10.20'});
  assert.match(await oldRuntime.locator('span').textContent(), /尚未儲存.*已儲存執行環境快取/);
  assert.equal(await oldRuntime.getByRole('button').isEnabled(), true);
  await retryPage.setViewportSize({width: 320, height: 844});
  assert.equal(await retryPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const artifacts = path.resolve('tests/web/.cache/model-cache-management'); fs.mkdirSync(artifacts, {recursive: true});
  await retryPage.setViewportSize({width: 390, height: 844});
  await retryPage.locator('#model-cache').screenshot({path: path.join(artifacts, 'versions-mobile.png')});
  await legacyRow.getByRole('button').click();
  await legacyRow.waitFor({state: 'detached'});
  assert.equal(await retryPage.evaluate(() => globalThis.testSegmenterClosed || 0), 0,
    'deleting a legacy version must not close the current live model');
  assert.equal((await retryPage.evaluate(() => runModelTest())).state, 'none');
  assert.deepEqual(hits, {wasm: 1, face: 4, segmenter: 1}, 'legacy deletion retains all current model bytes and instances');
  await retryPage.locator('#model-cache-clear').click();
  await retryPage.locator('#model-cache-status').filter({hasText: '已刪除'}).waitFor();
  await retryPage.waitForFunction(() => document.querySelector('#model-cache-clear').disabled
    && [...document.querySelectorAll('#model-cache-files li span')].every(el => el.textContent.includes('尚未儲存')));
  assert.equal(await retryPage.evaluate(() => globalThis.testSegmenterClosed), 1);
  assert.equal((await retryPage.evaluate(() => runModelTest())).state, "none");
  assert.deepEqual(hits, {wasm: 2, face: 5, segmenter: 2}, "deleting all three clears memory as well as disk cache");
  await retryPage.locator('#lang').click();
  await retryPage.locator('#model-cache-clear').filter({hasText: 'Delete all cached model versions'}).waitFor();
  await retryPage.locator('#model-cache-files li').filter({hasText: 'Google MediaPipe Face Landmarker'}).getByText(/Saved locally/).waitFor();
  assert.equal(await retryPage.locator('#model-cache-files li').getByText(/Saved locally/).count(), 3);
  await retryPage.setViewportSize({width: 320, height: 844});
  assert.equal(await retryPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await retryPage.locator('#lang').click();
  await retryPage.locator('#model-cache-clear').filter({hasText: '刪除全部模型快取版本'}).waitFor();
  await retryPage.locator('#model-cache-files li').getByText(/已儲存在本機/).first().waitFor();
  assert.equal(await retryPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await retryPage.setViewportSize({width: 390, height: 844});
  await retryPage.locator('#model-cache').screenshot({path: path.join(artifacts, 'mobile.png')});
  console.log("Browser model progress passed: streaming fetch, GPU/CPU reuse, persistent cache across pages, localized cache/error statuses and retry.");
} finally {
  if (browser) await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
