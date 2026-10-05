// Actual uploads, cold caches, and checkbox changes. No private photos or HEVC codec required.
// Only codec/model inference is stubbed; app routing, downloads and container surgery are real.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadProfile} from '../../web/src/zip.js';
import {buildRasterHeic} from '../../web/src/raster-import.js';
import {discoverHeic, extractItem, propertyBoxBytes, auxUriForItem, MATTE_URIS, removeItems, parseIloc} from '../../web/src/heif.js';
import {topBox, concat, be} from '../../web/src/box.js';
import {FACE_MATTE_PIXI} from '../../web/src/face-mattes.js';

const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../../web/', import.meta.url));
const profile = await loadProfile(new Uint8Array(fs.readFileSync(path.join(root, 'profiles/48-12.zip'))));
const donor = discoverHeic(profile.meta);
const sample = value => new Uint8Array([0, 0, 0, 3, 0x26, 1, value]);
function heicFixture(withPortrait = false) {
  const hvcc = propertyBoxBytes(profile.meta, donor.props, donor.primaryTiles[0], 'hvcC');
  const data = buildRasterHeic(profile, {
    main: Array.from({length: 48}, (_, i) => sample(i)), mainHvcc: hvcc,
    thumb: sample(77), thumbHvcc: hvcc, hdr: sample(88), hdrHvcc: hvcc,
  }, null, withPortrait ? {overrides: new Map([[MATTE_URIS.portraiteffectsmatte,
    {payload: sample(99), hvcc, pixi: FACE_MATTE_PIXI, width: 64, height: 64}]])} : null);
  const d = discoverHeic(data);
  const keep = new Set([d.primary, ...d.primaryTiles, d.hdrGrid, ...d.hdrTiles, d.thumbnail, d.exifItem]);
  if (withPortrait) for (const id of d.infos.keys())
    if (auxUriForItem(d.props, id) === MATTE_URIS.portraiteffectsmatte) keep.add(id);
  const meta = removeItems(data.slice(d.meta.off, d.meta.off + d.meta.size), [...d.infos.keys()].filter(id => !keep.has(id)));
  const iloc = parseIloc(meta, topBox(meta, 'meta')), growth = meta.length - d.meta.size;
  for (const item of iloc.items.values()) if (item.constructionMethod === 0) for (const extent of item.extents)
    meta.set(be(extent.offset + growth, iloc.offsetSize), extent.offsetPos);
  const result = concat([data.subarray(0, d.meta.off), meta, data.subarray(d.meta.off + d.meta.size)]);
  assert.equal(discoverHeic(result).stylesItem, null, 'fixture must exercise missing-style graft');
  return result;
}
const native = heicFixture(), nativePortrait = heicFixture(true);
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const filename = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!filename.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
    res.writeHead(404); res.end(); return;
  }
  const mime = {'.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.webmanifest': 'application/manifest+json'};
  res.writeHead(200, {'Content-Type': mime[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store'});
  res.end(fs.readFileSync(filename));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE || undefined});
  for (const quality of [false, true]) {
    const context = await browser.newContext({serviceWorkers: 'block', locale: 'zh-TW'});
    const modelRequests = [], errors = [];
    await context.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(origin) || url.startsWith('blob:')) return route.continue();
      if (url.includes('@mediapipe/tasks-vision@') || url.includes('storage.googleapis.com/mediapipe-models/')) {
        modelRequests.push(url);
        if (url.endsWith('/+esm')) return route.fulfill({contentType: 'text/javascript', body: `
          export const FilesetResolver = {forVisionTasks: async base => ({wasmBinaryPath: base + '/vision_wasm_internal.wasm'})};
          export const FaceLandmarker = {createFromOptions: async () => {
            globalThis.testFaceInitialized = (globalThis.testFaceInitialized || 0) + 1;
            return {detect: () => ({faceLandmarks: []}), close() {}};
          }};
          export const ImageSegmenter = {createFromOptions: async () => {
            globalThis.testSegmenterInitialized = (globalThis.testSegmenterInitialized || 0) + 1;
            return {getLabels: () => ['background', 'hair', 'body-skin', 'face-skin', 'clothes', 'others'],
              segment: () => {
                globalThis.testSegments = (globalThis.testSegments || 0) + 1;
                return {confidenceMasks: [.1,.1,.2,.4,.1,.1].map(value => ({width: 4, height: 4,
                  getAsFloat32Array: () => new Float32Array(16).fill(value), close() {}}))};
              }, close() {}};
          }};
        `});
        return route.fulfill({contentType: 'application/octet-stream', body: Buffer.from([1,2,3,4])});
      }
      return route.abort();
    });
    await context.addInitScript(savedDecoder => {
      localStorage.setItem('holanla.decoder', savedDecoder);
      const description = Uint8Array.from(atob('AQFgAAAAkAAAAAAA//AA/P34+AAADwOgAAEAGEABDAH//wFgAAADAJAAAAMAAAMA/5WUCaEAAQArQgEBAWAAAAMAkAAAAwAAAwD/oEIIWWVlSkwuagICAggAAAMACAAAAwAIQKIAAQAGRAHAcYkS'), c => c.charCodeAt(0));
      globalThis.VideoFrame = class {constructor(source) {this.source = source;} close() {}};
      globalThis.VideoEncoder = class {
        static async isConfigSupported(config) {return {supported: true, config};}
        constructor({output}) {this.output = output;}
        configure(config) {globalThis.testEncoderConfig = config;}
        encode(frame) {
          const pixels = frame.source instanceof Uint8Array ? frame.source
            : frame.source.getContext('2d').getImageData(0,0,frame.source.width,frame.source.height).data;
          let sum = 0; for (const pixel of pixels) sum = (sum + pixel) >>> 0;
          const bytes = new Uint8Array([0,0,0,3,0x26,1,sum & 255]);
          this.output({byteLength: bytes.length, copyTo: out => out.set(bytes)},
            {decoderConfig: {description, colorSpace: {primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: false}}});
        }
        async flush() {}
        close() {}
      };
      globalThis.VideoDecoder = class {
        static async isConfigSupported(config) {return {supported: true, config};}
        constructor({output}) {this.output = output;}
        configure() {}
        decode() {const {width, height} = globalThis.testEncoderConfig;
          this.output({format: 'I420', visibleRect: {width, height}, allocationSize: () => width * height * 3 / 2,
            async copyTo(out) {out.fill(16, 0, width * height); out.fill(128, width * height);
              for (let y = 0; y < height; y++) out.fill(235, y * width + width / 2, (y + 1) * width);
              return [{offset: 0, stride: width}];}, close() {}});}
        async flush() {}
        close() {}
      };
      // Decode synthetic HEIC without requiring an installed codec; keep native PNG/JPEG/WebP decoding.
      const bitmap = globalThis.createImageBitmap.bind(globalThis);
      globalThis.createImageBitmap = (source, ...args) => {
        if (source instanceof Blob && source.type === 'image/heic') {
          const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
          canvas.getContext('2d').fillRect(0,0,64,64);
          return bitmap(canvas);
        }
        return bitmap(source, ...args);
      };
      globalThis.libheif = {HeifDecoder: class {
        decode() {return [{get_width: () => 64, get_height: () => 64,
          display(image, done) {image.data.fill(128); done(image);}}];}
      }};
    }, quality ? 'libheif' : 'webcodecs');
    const page = await context.newPage(); page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    assert.equal(await page.locator('#decoder, .decoder-settings').count(), 0,
      'decoder test controls are removed even when a manual choice was previously saved');
    await page.locator('#faces').uncheck();
    await page.locator('#quality').setChecked(quality);
    assert.deepEqual(await page.evaluate(() => caches.keys()), [], 'each checkbox case starts with a cold cache');
    const image = async mime => Buffer.from(await page.evaluate(mime => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#987654'; ctx.fillRect(0,0,64,64);
      return canvas.toDataURL(mime).split(',')[1];
    }, mime), 'base64');
    const output = async (name, mimeType, buffer) => {
      await page.locator('#file').setInputFiles({name, mimeType, buffer: Buffer.from(buffer)});
      const row = page.locator('#list > .row').filter({has: page.getByText(name, {exact: true})}).first();
      assert.equal(await page.locator('#list > .row').first().locator('.name').textContent(), name);
      assert.equal(await row.locator('.jpeg-hint').count(), /\.jpe?g$/i.test(name) ? 1 : 0);
      await row.locator('a[download]').waitFor();
      return {row, bytes: new Uint8Array(await row.locator('a[download]').evaluate(async a =>
        [...new Uint8Array(await (await fetch(a.href)).arrayBuffer())]))};
    };
    for (const [extension, mime] of [['png','image/png'], ['jpeg','image/jpeg'], ['webp','image/webp']]) {
      const result = await output(`models-off.${extension}`, mime, await image(mime));
      assert.equal(await result.row.locator('.portrait-result-note').textContent(), '未啟用實驗性柔膚支援，因此未產生新的人像效果遮罩。');
      const d = discoverHeic(result.bytes);
      assert.equal([...d.infos.keys()].some(id => auxUriForItem(d.props, id) === MATTE_URIS.portraiteffectsmatte), false);
    }
    for (const source of [native, nativePortrait]) {
      const result = await output('models-off.heic', 'image/heic', source);
      const before = discoverHeic(source), after = discoverHeic(result.bytes);
      for (let i = 0; i < before.primaryTiles.length; i++) assert.deepEqual(
        extractItem(result.bytes, after.iloc, after.primaryTiles[i]), extractItem(source, before.iloc, before.primaryTiles[i]),
        'HEIC graft preserves primary pixels with models off');
      const portraitId = d => [...d.infos.keys()].find(id => auxUriForItem(d.props, id) === MATTE_URIS.portraiteffectsmatte);
      if (source === nativePortrait) {
        assert.deepEqual(extractItem(result.bytes, after.iloc, portraitId(after)), extractItem(source, before.iloc, portraitId(before)),
          'models off preserves an existing native portrait matte');
        assert.equal(await result.row.locator('.portrait-result-note').count(), 0);
      } else {
        assert.equal(portraitId(after), undefined);
        assert.equal(await result.row.locator('.portrait-result-note').count(), 1);
      }
    }
    assert.deepEqual(modelRequests, [], `faces off, analysis ${quality}: no runtime, WASM or model downloads`);
    assert.deepEqual(await page.evaluate(() => caches.keys()), [], 'disabled processing creates no model cache');
    assert.deepEqual(await page.evaluate(() => [globalThis.testFaceInitialized || 0, globalThis.testSegmenterInitialized || 0, globalThis.testSegments || 0]), [0,0,0]);
    // Re-enable in the same page: ensure the fix did not disable model loading entirely.
    await page.locator('#faces').check();
    const enabled = await output('models-on.png', 'image/png', await image('image/png'));
    assert.equal(modelRequests.length, 4, 'runtime plus three binaries download only after enabling Soft Skin');
    assert.ok(await page.evaluate(() => globalThis.testFaceInitialized > 0 && globalThis.testSegmenterInitialized > 0 && globalThis.testSegments > 0));
    const d = discoverHeic(enabled.bytes);
    assert.ok([...d.infos.keys()].some(id => auxUriForItem(d.props, id) === MATTE_URIS.portraiteffectsmatte), 'enabled segmentation produces a portrait matte');
    const calls = await page.evaluate(() => [testFaceInitialized, testSegmenterInitialized, testSegments]);
    await page.locator('#faces').uncheck();
    await output('models-off-again.jpeg', 'image/jpeg', await image('image/jpeg'));
    assert.equal(modelRequests.length, 4);
    assert.deepEqual(await page.evaluate(() => [testFaceInitialized, testSegmenterInitialized, testSegments]), calls,
      'turning off Soft Skin also suppresses inference using already loaded models');
    assert.deepEqual(errors, []);
    await context.close();
    console.log(`Analysis ${quality}: PNG/JPEG/WebP and missing-style HEIC skip all MediaPipe downloads, preserve native portrait/main pixels; re-enable and disable again passed.`);
  }
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
