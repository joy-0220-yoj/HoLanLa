import {DNG_ASSETS} from './dng-assets.js?v=0.8.0';
import {downloadModelBytes, MODEL_CACHE_NAME} from './model-download.js?v=0.8.0';
import {inspectDng, extractDngExif} from './dng-tiff.js?v=0.8.0';
import {dngTilePlan} from './dng-tiles.js?v=0.8.0';
import {buildDngInspection} from './dng-inspection.js?v=0.8.0';

let active = null, serial = Promise.resolve();
export function releaseDngDecoder() {active?.cancel();}
async function assetBytes(asset, onProgress) {
  const bytes = await downloadModelBytes(asset.url, {onProgress: event => onProgress({
    ...event, stage: event.source === 'cache' ? 'modelCache' : event.source === 'cacheWarning' ? 'modelCacheWarning' : 'modelDownload',
    resource: 'dng', url: asset.url,
  })});
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2, '0')).join('');
  if (digest !== asset.sha256) {
    try {await (await caches.open(MODEL_CACHE_NAME)).delete(asset.url);} catch { /* unavailable cache */ }
    throw Error('DNG decode failed: LibRaw runtime integrity check failed');
  }
  return bytes;
}
export function decodeDng(bytes, onProgress = () => {}, {consume = false, maxPixels} = {}) {
  const task = serial.catch(() => {}).then(async () => {
    const info = inspectDng(bytes);
    if (info.compressions.includes(52546)) throw Error('DNG JPEG XL compression unsupported');
    dngTilePlan(bytes, maxPixels); // Validate large-image layout before allocating WASM memory.
    const sourceExif = extractDngExif(bytes);
    const sourceDng = buildDngInspection(bytes, {includePreviews: false});
    if (!globalThis.crossOriginIsolated || !globalThis.SharedArrayBuffer)
      throw Error('DNG decode failed: LibRaw requires cross-origin isolation; reload after service worker installation');
    const script = await assetBytes(DNG_ASSETS[0], onProgress);
    const wasm = await assetBytes(DNG_ASSETS[1], onProgress);
    onProgress({stage: 'dngDecode'});
    const input = consume && bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength ? bytes : bytes.slice();
    const worker = new Worker(new URL('./dng-worker.js?v=0.8.0', import.meta.url), {type: 'module'});
    let timer;
    try {
      const result = await new Promise((resolve, reject) => {
        active = {cancel: () => reject(Error('LibRaw decoder released'))};
        timer = setTimeout(() => reject(Error('LibRaw decoding timed out')), 180000);
        worker.onmessage = ({data}) => {
          if (data.progress) {onProgress(data.progress); return;}
          // Destroy LibRaw's heap before allocating any main-thread rendering surface.
          worker.terminate();
          data.error ? reject(Error(data.error)) : resolve(data.result);
        };
        worker.onerror = event => reject(Error(event.message || 'LibRaw worker failed'));
        worker.postMessage({script, wasm, bytes: input, maxPixels}, [script.buffer, wasm.buffer, input.buffer]);
      });
      onProgress({stage: 'codec', operation: 'decode', source: 'LibRaw WASM / sRGB'});
      const canvas = document.createElement('canvas'); canvas.width = result.width; canvas.height = result.height;
      const ctx = canvas.getContext('2d', {colorSpace: 'srgb', alpha: false});
      if (!ctx) throw Error('DNG rendering canvas unavailable');
      if (result.bitmap) {
        try {ctx.drawImage(result.bitmap, 0, 0);} finally {result.bitmap.close();}
      } else {
        // A narrow strip avoids another full-frame RGBA allocation.
        for (let row = 0; row < result.height; row += 32) {
          const height = Math.min(32, result.height - row), image = ctx.createImageData(result.width, height);
          for (let p = row * result.width * 3, q = 0; q < image.data.length; p += 3, q += 4) {
            image.data[q] = result.data[p]; image.data[q + 1] = result.data[p + 1];
            image.data[q + 2] = result.data[p + 2]; image.data[q + 3] = 255;
          }
          ctx.putImageData(image, 0, row);
        }
      }
      return {image: canvas, sourceExif, sourceDng, close: () => {canvas.width = canvas.height = 0;}};
    } catch (error) {throw Error(`DNG decode failed: ${error.message}`);}
    finally {clearTimeout(timer); worker.terminate(); active = null;}
  });
  serial = task; return task;
}
