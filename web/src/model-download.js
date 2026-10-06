// Read assets separately from initialization to report download progress and retain complete files.
// Keep this asset cache independent of app releases; sw.js uses the same name for runtime scripts.
export const MODEL_CACHE_NAME = "holanla-vision-assets-v1";
export class ModelTimeoutError extends Error {
  constructor() {
    super("Model loading timed out");
    this.name = "ModelTimeoutError";
  }
}

// An asynchronous timeout cannot interrupt synchronous WASM work on the main thread.
// Dispose an instance that arrives after its caller has already timed out.
export function withModelTimeout(promise, timeoutMs, dispose = () => {}) {
  let expired = false, timer;
  const operation = Promise.resolve(promise).then(value => {
    if (expired) { dispose(value); throw new ModelTimeoutError(); }
    return value;
  });
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { expired = true; reject(new ModelTimeoutError()); }, timeoutMs);
  });
  return Promise.race([operation, timeout]).finally(() => clearTimeout(timer));
}

export async function downloadModelBytes(url, {
  onProgress = () => {}, stallTimeoutMs = 30000, cacheStorage = globalThis.caches,
} = {}) {
  let cache = null;
  const cacheWarning = () => onProgress({source: "cacheWarning", loaded: 0, total: null, complete: false});
  try {
    if (cacheStorage) {
      cache = await withModelTimeout(cacheStorage.open(MODEL_CACHE_NAME), stallTimeoutMs);
      const saved = await withModelTimeout(cache.match(url), stallTimeoutMs);
      if (saved?.ok) {
        const total = Number(saved.headers.get("content-length"));
        await onProgress({source: "cache", loaded: 0, total, complete: false});
        const bytes = new Uint8Array(await withModelTimeout(saved.arrayBuffer(), stallTimeoutMs));
        if (bytes.byteLength > 0 && bytes.byteLength === total) {
          await onProgress({source: "cache", loaded: bytes.byteLength, total, complete: true});
          return bytes;
        }
        // Never let an empty/truncated entry poison future attempts.
        await cache.delete(url);
      }
    } else if (typeof window !== "undefined") await cacheWarning();
  } catch (error) {
    console.warn("Model cache unavailable; downloading instead:", error);
    cache = null;
    await cacheWarning();
  }
  const controller = new AbortController();
  let reader, loaded = 0, total = null, lastReport = -Infinity;
  const notify = (complete = false) => onProgress({loaded, total, complete});
  try {
    await notify();
    // The explicit asset cache owns reuse. A manual deletion must not silently reload an HTTP-cache copy.
    const response = await withModelTimeout(fetch(url, {signal: controller.signal, cache: "no-store"}), stallTimeoutMs);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const length = Number(response.headers.get("content-length"));
    // Content-Length describes compressed bytes, whereas a reader returns decoded bytes.
    const encoding = response.headers.get("content-encoding");
    if (Number.isSafeInteger(length) && length > 0 && (!encoding || encoding === "identity")) total = length;
    await notify();
    if (!response.body) throw new Error("Download stream unavailable");
    reader = response.body.getReader();
    const chunks = [];
    for (;;) {
      const {done, value} = await withModelTimeout(reader.read(), stallTimeoutMs);
      if (done) break;
      chunks.push(value);
      loaded += value.byteLength;
      // Avoid announcing 100% before the stream is complete or when a server's length is wrong.
      if (total !== null && loaded > total) total = null;
      if (performance.now() - lastReport >= 100) {
        await notify(); lastReport = performance.now();
      }
    }
    if (!loaded) throw new Error("Empty model download");
    if (total !== null && loaded !== total) throw new Error("Incomplete model download");
    const bytes = new Uint8Array(loaded);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    if (cache) {
      try {
        // Store only a complete, validated download, with its decoded byte length.
        await withModelTimeout(cache.put(url, new Response(bytes, {headers: {
          "Content-Type": "application/octet-stream", "Content-Length": String(bytes.byteLength),
        }})), stallTimeoutMs);
      } catch (error) {
        console.warn("Could not retain model download:", error);
        await cacheWarning();
      }
    }
    await notify(true);
    return bytes;
  } catch (error) {
    controller.abort();
    if (reader) void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader?.releaseLock();
  }
}
