import {generatedProfileFixture} from './profile-fixtures.mjs';
import {generateMakerPlist} from "../../web/src/generated-profile.js";
import {routeBrowserEncoder} from "./browser-encoder-fixtures.mjs";
import {ORT_ASSETS} from '../../web/src/ort-assets.js';
import "./synthetic-fixtures.mjs";
// Actual uploads, cold caches, and checkbox changes. No private photos or HEVC codec required.
// Only codec/model inference is stubbed; app routing, downloads and container surgery are real.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildRasterHeic} from '../../web/src/raster-import.js';
import {discoverHeic, extractItem, propertyBoxBytes, auxUriForItem, MATTE_URIS, removeItems, parseIloc} from '../../web/src/heif.js';
import {topBox, concat, be} from '../../web/src/box.js';
import {FACE_MATTE_PIXI} from '../../web/src/face-mattes.js';
import {getMakerNoteBlob, extractAppleMakerNoteTag, readExifOrientation} from '../../web/src/exif.js';
import {hasTexture, URI_TEXTURE_STYLES} from '../../web/src/texture.js';

const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../../web/', import.meta.url));
const profile = await generatedProfileFixture('48-12');
const donor = discoverHeic(profile.meta);
const sample = value => new Uint8Array([0, 0, 0, 3, 0x26, 1, value]);
function heicFixture(withPortrait = false, withMakerNote = true, {styles = false, texture = false} = {}) {
  const hvcc = propertyBoxBytes(profile.meta, donor.props, donor.primaryTiles[0], 'hvcC');
  const data = buildRasterHeic(profile, {
    main: Array.from({length: 48}, (_, i) => sample(i)), mainHvcc: hvcc,
    thumb: sample(77), thumbHvcc: hvcc, hdr: sample(88), hdrHvcc: hvcc,
  }, null, withPortrait ? {overrides: new Map([[MATTE_URIS.portraiteffectsmatte,
    {payload: sample(99), hvcc, pixi: FACE_MATTE_PIXI, width: 64, height: 64}]])} : null);
  const d = discoverHeic(data);
  const keep = new Set([d.primary, ...d.primaryTiles, d.hdrGrid, ...d.hdrTiles, d.thumbnail, d.exifItem]);
  if (styles) for (const id of d.infos.keys()) keep.add(id);
  if (!texture) for (const [id, info] of d.infos) if (info.uri === URI_TEXTURE_STYLES) keep.delete(id);
  if (withPortrait) for (const id of d.infos.keys())
    if (auxUriForItem(d.props, id) === MATTE_URIS.portraiteffectsmatte) keep.add(id);
  const meta = removeItems(data.slice(d.meta.off, d.meta.off + d.meta.size), [...d.infos.keys()].filter(id => !keep.has(id)));
  const iloc = parseIloc(meta, topBox(meta, 'meta')), growth = meta.length - d.meta.size;
  for (const item of iloc.items.values()) if (item.constructionMethod === 0) for (const extent of item.extents)
    meta.set(be(extent.offset + growth, iloc.offsetSize), extent.offsetPos);
  const result = concat([data.subarray(0, d.meta.off), meta, data.subarray(d.meta.off + d.meta.size)]);
  assert.equal(discoverHeic(result).stylesItem !== null, styles, 'fixture style route');
  assert.equal(hasTexture(discoverHeic(result).infos), texture, 'fixture texture route');
  if (!withMakerNote) {
    const discovery = discoverHeic(result), item = discovery.iloc.items.get(discovery.exifItem);
    const offset = item.baseOffset + item.extents[0].offset;
    const exif = extractItem(result, discovery.iloc, discovery.exifItem), view = new DataView(exif.buffer, exif.byteOffset);
    const tiff = view.getUint32(0) + 4, little = exif[tiff] === 73;
    // The synthetic raster Exif has one ExifIFD pointer and one MakerNote entry.
    const root = view.getUint32(tiff + 4, little), pointer = tiff + root + 2 + 12;
    const exifIfd = view.getUint32(pointer + 8, little);
    result.set(be(0xc7ff, 2), offset + tiff + exifIfd + 2);
    assert.throws(() => getMakerNoteBlob(extractItem(result, discovery.iloc, discovery.exifItem)), /0x927c/);
  }
  return result;
}
const native = heicFixture(), nativePortrait = heicFixture(true), screenshot = heicFixture(false, false);
const nativeStyle = heicFixture(false, true, {styles: true});
const alreadyTexture = heicFixture(false, true, {styles: true, texture: true});
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const filename = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
  if (!filename.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {
    res.writeHead(404); res.end(); return;
  }
  const mime = {'.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.webmanifest': 'application/manifest+json'};
  res.writeHead(200, {"Cross-Origin-Opener-Policy":"same-origin","Cross-Origin-Embedder-Policy":"require-corp",'Content-Type': mime[path.extname(filename)] || 'application/octet-stream', 'Cache-Control': 'no-store'});
  res.end(fs.readFileSync(filename));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE || undefined});
  for (const quality of [false, true]) {
    const context = await browser.newContext({serviceWorkers: 'block', locale: 'zh-TW'});
    const ortRequests = [], donorRequests = [], errors = [];
    await context.route('**/*', route => {
      const url = route.request().url();
      if (/\/profiles\/(?:[^/]+\.zip|index\.json)(?:\?|$)/.test(url)) donorRequests.push(url);
      if (url.startsWith(origin) || url.startsWith('blob:')) return route.continue();
      const ortIndex = ORT_ASSETS.findIndex(asset => asset.url === url);
      if (ortIndex >= 0) {
        ortRequests.push(url);
        const names=['ort.wasm.min.mjs','ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm','face-detector-nhwc.onnx','face-landmarks.onnx','selfie.onnx'];
        return route.fulfill({path:path.join(process.env.ORT_FIXTURE_DIR || '.cache/ort-research',names[ortIndex]),
          headers:{'Access-Control-Allow-Origin':'*','Cross-Origin-Resource-Policy':'cross-origin'},
          contentType:url.endsWith('.mjs')?'text/javascript':url.endsWith('.wasm')?'application/wasm':'application/octet-stream'});
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
    await routeBrowserEncoder(context);
  const page = await context.newPage(); page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin);
    assert.equal(await page.locator('#boot').textContent(), '', 'startup has no caught initialization errors');
    assert.deepEqual(donorRequests, [], 'startup uses the generated profile index without fetching the donor index');
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
      try { await row.locator('a[download]').waitFor(); }
      catch (cause) {
        throw new Error(`Upload failed: ${await row.textContent()}\nPage errors: ${JSON.stringify(errors)}`, {cause});
      }
      return {row, bytes: new Uint8Array(await row.locator('a[download]').evaluate(async a =>
        [...new Uint8Array(await (await fetch(a.href)).arrayBuffer())]))};
    };
    for (const [extension, mime] of [['png','image/png'], ['jpeg','image/jpeg'], ['webp','image/webp']]) {
      const result = await output(`models-off.${extension}`, mime, await image(mime));
      assert.match(await result.row.locator('.status-line.ok .status-message').textContent(), /已套用本機自行產生的風格範本 48-12/);
      assert.equal(await result.row.locator('.generated-profile-note').textContent(), '此自行產生範本仍為實驗性。');
      assert.match(await result.row.locator('.status').textContent(), extension === 'png'
        ? /正在本機自行產生風格範本 48-12/ : /使用本頁先前自行產生的風格範本 48-12/);
      assert.equal(await result.row.locator('.portrait-result-note').textContent(), '未啟用實驗性柔膚支援，因此未產生新的人像效果遮罩。');
      const d = discoverHeic(result.bytes);
      assert.equal([...d.infos.keys()].some(id => auxUriForItem(d.props, id) === MATTE_URIS.portraiteffectsmatte), false);
    }
    for (const source of [native, nativePortrait, screenshot]) {
      const result = await output('models-off.heic', 'image/heic', source);
      const before = discoverHeic(source), after = discoverHeic(result.bytes);
      assert.match(await result.row.locator('.status-line.ok .status-message').textContent(), /已套用本機自行產生的風格範本 48-12/);
      if (source === screenshot) {
        const sourceExif = extractItem(source, before.iloc, before.exifItem);
        const outputExif = extractItem(result.bytes, after.iloc, after.exifItem);
        assert.deepEqual(extractAppleMakerNoteTag(outputExif).payload, generateMakerPlist());
        assert.equal(readExifOrientation(outputExif), readExifOrientation(sourceExif));
      }
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
    const retained = await output('native-style.heic', 'image/heic', nativeStyle);
    assert.match(await retained.row.locator('.status-line.ok .status-message').textContent(), /已保留照片原有的攝影風格（未套用替代範本）/);
    assert.doesNotMatch(await retained.row.locator('.status').textContent(), /已套用本機自行產生的風格範本/);
    assert.equal(await retained.row.locator('.generated-profile-note').count(), 0);
    const originalStyle = discoverHeic(nativeStyle), retainedStyle = discoverHeic(retained.bytes);
    assert.deepEqual(extractItem(retained.bytes, retainedStyle.iloc, retainedStyle.stylesItem),
      extractItem(nativeStyle, originalStyle.iloc, originalStyle.stylesItem), 'native styles do not use a replacement profile');
    await page.locator('#file').setInputFiles({name: 'already-texture.heic', mimeType: 'image/heic', buffer: Buffer.from(alreadyTexture)});
    const skipped = page.locator('#list > .row').first();
    await skipped.locator('.status-message').filter({hasText: '未套用自行產生的範本'}).waitFor();
    assert.equal(await skipped.locator('a[download]').count(), 0, 'already-textured input skips generation and output');
    assert.doesNotMatch(await skipped.locator('.status').textContent(), /正在本機自行產生風格範本/);
    assert.deepEqual(ortRequests, [], `faces off, analysis ${quality}: no runtime, WASM or model downloads`);
    assert.deepEqual(await page.evaluate(async assets => {const cache=await caches.open('holanla-vision-assets-v1');return (await cache.keys()).map(r=>r.url).filter(url=>assets.includes(url));}, ORT_ASSETS.map(asset=>asset.url)), [], 'disabled processing caches no ONNX Runtime resources');
    assert.equal(await page.locator('#vision-engine').count(), 0, 'ONNX Runtime is the sole backend');
    await page.locator('#faces').check();
    const enabled = await output('models-on.png', 'image/png', await image('image/png'));
    assert.equal(ortRequests.length, 6, 'ONNX Runtime runtime and three models download only after enabling Soft Skin');
    const d = discoverHeic(enabled.bytes);
    assert.ok([...d.infos.keys()].some(id => auxUriForItem(d.props, id) === MATTE_URIS.portraiteffectsmatte), 'enabled segmentation produces a portrait matte');
    await page.locator('#faces').uncheck();
    const disabledAgain = await output('models-off-again.jpeg', 'image/jpeg', await image('image/jpeg'));
    assert.equal(ortRequests.length, 6);
    assert.doesNotMatch(await disabledAgain.row.locator('.status').textContent(), /ONNX Runtime Web WASM|正在偵測人臉|正在分割/,
      'turning off Soft Skin also suppresses inference using already loaded models');
    assert.equal([...discoverHeic(disabledAgain.bytes).infos.keys()].some(id => auxUriForItem(discoverHeic(disabledAgain.bytes).props, id) === MATTE_URIS.portraiteffectsmatte), false);
    if (!quality) {
      await page.locator('#faces').check();
      const ortResult = await output('ort-public-face.jpeg','image/jpeg',fs.readFileSync(path.join(process.env.ORT_FIXTURE_DIR || '.cache/ort-research','sample-face.jpg')));
      assert.equal(ortRequests.length, 6, 'the default backend reuses its verified resources');
      const ortDiscovery = discoverHeic(ortResult.bytes);
      assert.ok([...ortDiscovery.infos.keys()].some(id => auxUriForItem(ortDiscovery.props,id)?.endsWith(':semanticskinmattev2')),
        'real ONNX Runtime inference generates skin mattes in the downloaded HEIC');
      assert.ok(await ortResult.row.locator('.face-correct').count() > 0, 'ONNX Runtime detections can be corrected');
      console.log('Default ONNX Runtime inference through UI upload to HEIC output: passed');
    }
    assert.deepEqual(errors, []);
    assert.deepEqual(donorRequests, [], 'all upload routes avoid author ZIP/profile index requests');
    await context.close();
    console.log(`Analysis ${quality}: PNG/JPEG/WebP and missing-style HEIC skip all ONNX Runtime downloads, preserve native portrait/main pixels; re-enable and disable again passed.`);
  }
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
