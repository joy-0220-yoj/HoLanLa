import {FFMPEG_ASSETS} from './ffmpeg-assets.js?v=0.8.0';
import {downloadModelBytes, MODEL_CACHE_NAME} from './model-download.js?v=0.8.0';
import {box, boxes, topBox, concat, u} from './box.js?v=0.8.0';
import {readSpsInfo} from './hevc-linear-tags.js?v=0.8.0';

let worker, ready, serial = Promise.resolve(), nextId = 0;
const pending = new Map(), releaseListeners = new Set();
export function onEncoderRelease(callback) { releaseListeners.add(callback); }
export function releaseHevcEncoder() {
  worker?.terminate(); worker = null; ready = null;
  for (const {reject, timer} of pending.values()) { clearTimeout(timer); reject(Error('HEVC encoder released')); }
  pending.clear();
  for (const callback of releaseListeners) callback();
}
function request(message, transfer = [], onProgress) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { releaseHevcEncoder(); }, 180000);
    pending.set(id, {resolve, reject, timer, onProgress});
    worker.postMessage({...message, id}, transfer);
  });
}
async function verifiedAsset(asset, onProgress) {
  const bytes = await downloadModelBytes(asset.url, {onProgress: progress => onProgress?.({
    ...progress, stage: progress.source === 'cache' ? 'modelCache' : progress.source === 'cacheWarning' ? 'modelCacheWarning' : 'modelDownload', resource: 'ffmpeg', url: asset.url,
  })});
  const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    n => n.toString(16).padStart(2, '0')).join('');
  if (digest !== asset.sha256) {
    try { await (await caches.open(MODEL_CACHE_NAME)).delete(asset.url); } catch { /* unavailable cache */ }
    throw Error('FFmpeg runtime integrity check failed');
  }
  return bytes;
}
export async function ensureHevcEncoder(onProgress) {
  if (!ready) ready = (async () => {
    if (!globalThis.crossOriginIsolated || !globalThis.SharedArrayBuffer)
      throw Error('FFmpeg.wasm requires cross-origin isolation; reload after service worker installation');
    const script = await verifiedAsset(FFMPEG_ASSETS[0], onProgress);
    const wasm = await verifiedAsset(FFMPEG_ASSETS[1], onProgress);
    const threadScript = await verifiedAsset(FFMPEG_ASSETS[2], onProgress);
    worker = new Worker(new URL('./ffmpeg-worker.js?v=0.8.0', import.meta.url));
    worker.onmessage = ({data}) => {
      const call = pending.get(data.id); if (!call) return;
      if (data.progress !== undefined) { call.onProgress?.(data.progress); return; }
      pending.delete(data.id); clearTimeout(call.timer);
      if (data.error) call.reject(Error(data.error)); else call.resolve(data.output);
    };
    worker.onerror = () => releaseHevcEncoder();
    await request({operation: 'load', script, wasm, threadScript}, [script.buffer, wasm.buffer, threadScript.buffer]);
  })().catch(error => { releaseHevcEncoder(); throw error; });
  await ready;
}

// One-frame, one-track MP4 written by our own encoder; no uploaded MP4 parsing.
export function extractEncodedHevc(mp4) {
  function findRecord(start, end) {
    for (const b of boxes(mp4, start, end)) {
      if (b.type === 'hvcC') return mp4.slice(b.off + b.hdr, b.off + b.size);
      const skip = b.type === 'stsd' ? 8 : ['hvc1', 'hev1'].includes(b.type) ? 78 : 0;
      if (skip || ['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(b.type)) {
        const found = findRecord(b.off + b.hdr + skip, b.off + b.size);
        if (found) return found;
      }
    }
  }
  const record = findRecord(0, mp4.length), mdat = topBox(mp4, 'mdat');
  if (!record || record.length < 23 || (record[21] & 3) !== 3) throw Error('Invalid generated HEVC configuration');
  let pos = mdat.off + mdat.hdr; const frames = [];
  while (pos < mdat.off + mdat.size) {
    const length = u(mp4, pos, 4), type = (mp4[pos + 4] >> 1) & 63;
    if (length < 2 || pos + 4 + length > mdat.off + mdat.size) throw Error('Truncated generated HEVC frame');
    if (type <= 31) {
      if (![19, 20].includes(type)) throw Error('Generated HEVC frame is not an IDR');
      frames.push(mp4.slice(pos, pos + 4 + length));
    } else if (![32, 33, 34].includes(type)) throw Error(`Unexpected generated HEVC NAL ${type}`);
    pos += 4 + length;
  }
  if (frames.length !== 1) throw Error('HEVC encoder returned no single IDR frame');
  let p = 23, sps;
  for (let i = 0; i < record[22]; i++) {
    const type = record[p++] & 63, count = u(record, p, 2); p += 2;
    if (![32, 33, 34].includes(type)) throw Error('Unexpected generated HEVC parameter array');
    for (let j = 0; j < count; j++) {
      const size = u(record, p, 2); p += 2;
      if (p + size > record.length) throw Error('Truncated generated HEVC parameter array');
      if (type === 33) sps = readSpsInfo(record.subarray(p, p + size));
      p += size;
    }
  }
  if (!sps || p !== record.length) throw Error('Invalid generated HEVC SPS');
  return {payload: concat(frames), hvcc: box('hvcC', record), record, sps};
}

export function encodeHevcPixels(pixels, {width, height, pixelFormat = 'yuv420p10le',
  primaries = 'bt709', transfer = 'bt709', matrix = 'bt709', fullRange = false,
  lossless = true, crf = 18} = {}, onProgress) {
  const task = serial.catch(() => {}).then(async () => {
    const mono = pixelFormat === 'gray', depth = pixelFormat === 'yuv420p10le' ? 10 : 8;
    const expectedBytes = width * height * (mono ? 1 : depth === 10 ? 3 : 1.5);
    if (!['gray', 'yuv420p', 'yuv420p10le'].includes(pixelFormat) || !Number.isInteger(width) || !Number.isInteger(height)
      || width < 2 || height < 2 || width > 8192 || height > 8192 || width % 2 || height % 2
      || pixels.byteLength !== expectedBytes) throw Error('Invalid raw HEVC input');
    await ensureHevcEncoder(onProgress);
    onProgress?.({stage: 'codec', operation: 'encode', source: `FFmpeg.wasm / x265 ${depth}-bit`});
    const input = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength).slice();
    const params = `${lossless ? 'lossless=1' : `crf=${crf}`}:info=0:aud=0:repeat-headers=0:bframes=0:keyint=250:min-keyint=1:scenecut=0:pools=none:frame-threads=1`;
    const args = ['-hide_banner', '-f', 'rawvideo', '-pix_fmt', pixelFormat, '-s', `${width}x${height}`, '-r', '1',
      '-i', 'input.raw', '-frames:v', '1', '-an', '-c:v', 'libx265', '-preset', 'ultrafast', '-pix_fmt', pixelFormat,
      '-x265-params', params, '-color_primaries', primaries, '-color_trc', transfer, '-colorspace', matrix,
      '-color_range', fullRange ? 'pc' : 'tv', '-tag:v', 'hvc1', '-map_metadata', '-1', 'output.mp4'];
    const output = await request({operation: 'encode', pixels: input, args}, [input.buffer]);
    const result = extractEncodedHevc(output);
    if (result.sps.luma !== depth || result.sps.chromaDepth !== depth || result.sps.chroma !== (mono ? 0 : 1))
      throw Error(`HEVC encoder did not preserve ${depth}-bit ${mono ? 'monochrome' : '4:2:0'}`);
    return {...result, width, height, bitDepth: depth};
  });
  serial = task; return task;
}

// Copy HEVC NAL units to Annex B without touching sample values or colour tags.
export function hevcAnnexB(record, payload) {
  if (record.length < 23 || record[0] !== 1) throw Error('Invalid HEVC decode configuration');
  const parts = [], start = new Uint8Array([0, 0, 0, 1]); let pos = 23, sps;
  for (let i = 0; i < record[22]; i++) {
    if (pos + 3 > record.length) throw Error('Truncated HEVC decode array');
    const type = record[pos++] & 63, count = u(record, pos, 2); pos += 2;
    for (let j = 0; j < count; j++) {
      if (pos + 2 > record.length) throw Error('Truncated HEVC decode NAL');
      const size = u(record, pos, 2); pos += 2;
      if (size < 2 || pos + size > record.length) throw Error('Truncated HEVC decode NAL');
      const nal = record.subarray(pos, pos + size); pos += size;
      if (type === 33) sps = readSpsInfo(nal);
      parts.push(start, nal);
    }
  }
  if (pos !== record.length || !sps || sps.luma !== 8) throw Error('HEVC calibration requires an 8-bit SPS');
  const lengthSize = (record[21] & 3) + 1;
  for (pos = 0; pos < payload.length;) {
    if (pos + lengthSize > payload.length) throw Error('Truncated HEVC decode frame');
    const size = u(payload, pos, lengthSize); pos += lengthSize;
    if (size < 2 || pos + size > payload.length) throw Error('Truncated HEVC decode frame');
    parts.push(start, payload.subarray(pos, pos + size)); pos += size;
  }
  if (!payload.length) throw Error('Empty HEVC decode frame');
  return concat(parts);
}

/** Software readback of the calibration probe. extractplanes copies native Y
 * samples, avoiding RGB conversion and full/limited-range normalization. */
export function decodeHevcLuma(record, payload, {width, height}, onProgress) {
  const task = serial.catch(() => {}).then(async () => {
    if (![width, height].every(value => Number.isInteger(value) && value >= 2 && value <= 8192))
      throw Error('Invalid HEVC calibration dimensions');
    const input = hevcAnnexB(record, payload);
    await ensureHevcEncoder(onProgress);
    onProgress?.({stage: 'codec', operation: 'decode', source: 'FFmpeg.wasm / HEVC'});
    const args = ['-hide_banner', '-threads', '1', '-filter_threads', '1', '-f', 'hevc', '-i', 'input.raw', '-frames:v', '1',
      '-an', '-vf', 'extractplanes=y', '-pix_fmt', 'gray', '-f', 'rawvideo', 'output.raw'];
    const output = await request({operation: 'decode', pixels: input, args}, [input.buffer]);
    if (output.length !== width * height) throw Error('HEVC calibration decoded dimensions disagree');
    return {bytes: output, width, height};
  });
  serial = task; return task;
}
