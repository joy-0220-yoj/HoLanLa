import {MODEL_CACHE_NAME} from "./model-download.js?v=0.7.0";
import {MODEL_URL, SEGMENTER_MODEL_URL, WASM_URL, releaseFaceModels} from "./face-mattes.js?v=0.7.0";

export const MODEL_RESOURCE_KEYS = {wasm: "model.wasm", face: "model.face", segmenter: "model.segmenter"};
// Recognize the asset families, not just today's URLs, so previous releases remain manageable.
function resourceFor(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== "https:") return null;
  let match;
  if (url.hostname === "cdn.jsdelivr.net") {
    // Include every JS path the worker can retain, including .mjs runtime bundles.
    match = url.pathname.match(/^\/npm\/@mediapipe\/tasks-vision@([\w.-]+)\/(\+esm|wasm\/vision_wasm(?:_nosimd)?_internal\.wasm|.+\.m?js)$/);
    if (match) return {resource: "wasm", version: match[1], variant: "", script: !match[2].endsWith(".wasm")};
  }
  if (url.hostname === "storage.googleapis.com") {
    match = url.pathname.match(/^\/mediapipe-models\/face_landmarker\/face_landmarker\/(float16|float32)\/([\w.-]+)\/face_landmarker\.task$/);
    if (match) return {resource: "face", version: match[2], variant: match[1], script: false};
    match = url.pathname.match(/^\/mediapipe-models\/image_segmenter\/selfie_multiclass_256x256\/(float16|float32)\/([\w.-]+)\/selfie_multiclass_256x256\.tflite$/);
    if (match) return {resource: "segmenter", version: match[2], variant: match[1], script: false};
  }
  return null;
}

const CURRENT_FILES = [WASM_URL + "/vision_wasm_internal.wasm", MODEL_URL, SEGMENTER_MODEL_URL]
  .map(url => resourceFor(url));
const sameVersion = (a, b) => a.resource === b.resource && a.version === b.version && a.variant === b.variant;
const fileEntry = info => ({resource: info.resource, version: info.version, variant: info.variant,
  current: CURRENT_FILES.some(file => sameVersion(file, info)), bytes: 0, count: 0, scriptBytes: 0, scriptCount: 0});

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
    // Runtime scripts saved by the worker may omit Content-Length or retain a compressed size.
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
  if (!selected || CURRENT_FILES.some(file => sameVersion(file, selected)))
    await releaseFaceModels(resource);
}
