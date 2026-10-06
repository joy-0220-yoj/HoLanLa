import {MODEL_CACHE_NAME} from "./model-download.js?v=0.8.0";
import {releaseOrtModels} from './ort-vision.js?v=0.8.0';
import {FFMPEG_ASSETS} from './ffmpeg-assets.js?v=0.8.0';
import {releaseHevcEncoder} from './ffmpeg-hevc.js?v=0.8.0';
import {ORT_ASSETS} from './ort-assets.js?v=0.8.0';
import {DNG_ASSETS} from './dng-assets.js?v=0.8.0';
import {releaseDngDecoder} from './dng-decode.js?v=0.8.0';

export const MODEL_RESOURCE_KEYS = {ffmpeg: 'model.ffmpeg', dng: 'model.dng',
  ort: 'model.ort', ortDetector: 'model.ortDetector', ortFace: 'model.ortFace', ortSegmenter: 'model.ortSegmenter'};
// Recognize the asset families, not just today's URLs, so previous releases remain manageable.
function resourceFor(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:") return null;
  let match;
  if (url.hostname === "cdn.jsdelivr.net") {
    match = url.pathname.match(/^\/npm\/libraw-wasm@([\w.-]+)\/dist\/libraw\.(js|wasm)$/);
    if (match) return {resource: 'dng', version: match[1], variant: 'wasm', script: match[2] === 'js'};
    match = url.pathname.match(/^\/npm\/onnxruntime-web@([\w.-]+)\/dist\/(ort\.wasm\.min\.mjs|ort-wasm-simd-threaded\.(?:wasm|mjs))$/);
    if (match) return {resource: 'ort', version: match[1], variant: 'wasm', script: !match[2].endsWith('.wasm')};
    match = url.pathname.match(/^\/npm\/@ffmpeg\/(core(?:-mt)?)@([\w.-]+)\/dist\/(?:umd|esm)\/ffmpeg-core\.(wasm|js|worker\.js)$/);
    if (match) return {resource: 'ffmpeg', version: match[2], variant: match[1], script: match[3] !== 'wasm'};
  }
  if (url.hostname === 'huggingface.co') {
    match = url.pathname.match(/^\/fernandotonon\/QtMeshEditor-blazeface-onnx\/resolve\/([\w.-]+)\/face_detector\.onnx$/);
    if (match) return {resource: 'ortDetector', version: match[1], variant: 'onnx', script: false};
    match = url.pathname.match(/^\/senty-au\/(face_landmarks_detector-ONNX|selfie_multiclass_256x256-ONNX)\/resolve\/([\w.-]+)\/onnx\/model\.onnx$/);
    if (match) return {resource: match[1].startsWith('face_') ? 'ortFace' : 'ortSegmenter', version: match[2], variant: 'onnx', script: false};
  }
  return null;
}

const CURRENT_FILES = [FFMPEG_ASSETS[1].url, DNG_ASSETS[1].url,
  ...ORT_ASSETS.filter(asset => !asset.url.endsWith('.mjs')).map(asset => asset.url)]
  .map(url => resourceFor(url));
const sameVersion = (a, b) => a.resource === b.resource && a.version === b.version && a.variant === b.variant;
const fileEntry = info => {
  const source = ORT_ASSETS.find(asset => asset.sourceVersion && sameVersion(resourceFor(asset.url), info));
  return {resource: info.resource, version: info.version, variant: info.variant,
    ...(source ? {sourceVersion: source.sourceVersion, sourceVariant: source.sourceVariant} : {}),
    current: CURRENT_FILES.some(file => sameVersion(file, info)), bytes: 0, count: 0, scriptBytes: 0, scriptCount: 0};
};

export async function listCachedModelFiles(cacheStorage = globalThis.caches) {
  if (!cacheStorage) throw new Error("CacheStorage unavailable");
  const files = CURRENT_FILES.map(fileEntry);
  if (!await cacheStorage.has(MODEL_CACHE_NAME)) return files;
  const cache = await cacheStorage.open(MODEL_CACHE_NAME);
  for (const request of await cache.keys()) {
    const info = resourceFor(request.url);
    if (!info) continue;
    const response = await cache.match(request);
    if (!response?.ok) continue;
    let size = Number(response.headers.get("content-length"));
    // Runtime scripts may omit Content-Length or retain a compressed size.
    if (info.script) size = (await response.arrayBuffer()).byteLength;
    if (!Number.isSafeInteger(size) || size <= 0) continue;
    let file = files.find(file => sameVersion(file, info));
    if (!file) { file = fileEntry(info); files.push(file); }
    if (info.script) { file.scriptBytes += size; file.scriptCount++; }
    else { file.bytes += size; file.count++; }
  }
  return files;
}

export async function deleteCachedModelFiles(resource = "all", cacheStorage = globalThis.caches, selection = null) {
  if (resource !== "all" && !Object.hasOwn(MODEL_RESOURCE_KEYS, resource)) throw new Error("Unknown model resource");
  if (selection && (resource === "all" || typeof selection.version !== "string" || typeof selection.variant !== "string"))
    throw new Error("Invalid model version selection");
  const selected = selection ? {resource, version: selection.version, variant: selection.variant} : null;
  if (!cacheStorage) throw new Error("CacheStorage unavailable");
  if (await cacheStorage.has(MODEL_CACHE_NAME)) {
    const cache = await cacheStorage.open(MODEL_CACHE_NAME);
    for (const request of await cache.keys()) {
      const info = resourceFor(request.url);
      if (info && (resource === "all" || resource === info.resource)
        && (!selected || sameVersion(info, selected))) await cache.delete(request);
    }
  }
  // Clear the live instances too, so the next photo reflects a manual deletion immediately.
  if (resource === 'all' || (resource === 'ffmpeg' && (!selected || CURRENT_FILES.some(file => sameVersion(file, selected)))))
    releaseHevcEncoder();
  if (resource === 'all' || (resource === 'dng' && (!selected || CURRENT_FILES.some(file => sameVersion(file, selected)))))
    releaseDngDecoder();
  if (resource !== 'ffmpeg' && resource !== 'dng' && (!selected || CURRENT_FILES.some(file => sameVersion(file, selected))))
    await releaseOrtModels(resource);
}
