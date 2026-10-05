const CACHE_PREFIX = "holanla-";
const CACHE_NAME = `${CACHE_PREFIX}0.7.0`;
// Stable across app upgrades. Binary assets are written by src/model-download.js.
const MODEL_CACHE_NAME = "holanla-vision-assets-v1";
const VISION_RUNTIME_PREFIX = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22-rc.20250304/";

// Keep this list self-contained so a successful installation guarantees that
// the converter and both supported donor profiles can run without a network.
const APP_SHELL = [
  "./",
  "./index.html",
  "./app.js",
  "./manifest.webmanifest",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./profiles/index.json",
  "./profiles/45-15.zip",
  "./profiles/48-12.zip",
  "./src/box.js",
  "./src/bplist.js",
  "./src/decode.js",
  "./src/webcodecs-decode.js",
  "./src/icc-color.js",
  "./src/webcodecs-color.js",
  "./src/exif.js",
  "./src/errors.js",
  "./src/face-mattes.js",
  "./src/model-download.js",
  "./src/model-progress.js",
  "./src/model-cache.js",
  "./src/heif.js",
  "./src/i18n.js",
  "./src/native-mattes.js",
  "./src/inspection-compare.js",
  "./src/portrait-matte.js",
  "./src/port.js",
  "./src/raster-import.js",
  "./src/primary-source.js",
  "./src/raster-color.js",
  "./src/linear-thumbnail.js",
  "./src/hevc-linear-tags.js",
  "./src/hevc-color.js",
  "./src/hevc-encoder.js",
  "./src/isolation.js",
  "./src/styles.js",
  "./src/texture.js",
  "./src/zip.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(
        names
          .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME && name !== MODEL_CACHE_NAME)
          .map((name) => caches.delete(name))
      ))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw error;
  }
}

async function visionRuntime(request, event) {
  let cache;
  try {
    cache = await caches.open(MODEL_CACHE_NAME);
    const saved = await cache.match(request);
    if (saved) return saved;
  } catch (error) { console.warn("MediaPipe runtime cache unavailable:", error); }
  const response = await fetch(request);
  if (cache && response.ok) {
    // waitUntil keeps a complete script write alive even when its page closes.
    event.waitUntil(cache.put(request, response.clone()).catch(error =>
      console.warn("Could not retain MediaPipe runtime:", error)));
  }
  return response;
}

function isolatedResponse(response) {
  if (!response || response.status === 0) return response;
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Only this pinned MediaPipe package's JS runtime is retained here.
  // Model/WASM downloads have their own progress-aware, complete-download cache.
  if (url.href.startsWith(VISION_RUNTIME_PREFIX) && (/\.(?:m?js)$/.test(url.pathname) || url.pathname.endsWith("/+esm"))) {
    event.respondWith(visionRuntime(request, event));
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      networkFirst(request).catch(() => caches.match("./index.html")).then(isolatedResponse)
    );
    return;
  }

  event.respondWith(networkFirst(request).then(isolatedResponse));
});
