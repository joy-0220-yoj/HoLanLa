const CACHE_PREFIX = "holanla-";
const CACHE_NAME = `${CACHE_PREFIX}0.8.0`;
// Stable across app upgrades. Binary assets are written by src/model-download.js.
const MODEL_CACHE_NAME = "holanla-vision-assets-v1";

// Keep this list self-contained so a successful installation guarantees that
// first-party converter modules can run without a network. The optional encoder
// is downloaded and retained by the explicit resource cache on first use.
const APP_SHELL = [
  "./",
  "./index.html",
  "./app.js?v=0.8.0",
  "./manifest.webmanifest",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon.svg",
  "./social-preview.png",
  "./src/dng-assets.js?v=0.8.0",
  "./src/dng-tiff.js?v=0.8.0",
  "./src/dng-tiles.js?v=0.8.0",
  "./src/dng-inspection.js?v=0.8.0",
  "./src/dng-mattes.js?v=0.8.0",
  "./src/dng-decode.js?v=0.8.0",
  "./src/dng-worker.js?v=0.8.0",
  "./src/box.js?v=0.8.0",
  "./src/bplist.js?v=0.8.0",
  "./src/decode.js?v=0.8.0",
  "./src/webcodecs-decode.js?v=0.8.0",
  "./src/icc-color.js?v=0.8.0",
  "./src/webcodecs-color.js?v=0.8.0",
  "./src/exif.js?v=0.8.0",
  "./src/errors.js?v=0.8.0",
  "./src/face-mattes.js?v=0.8.0",
  "./src/face-canonical.js?v=0.8.0",
  "./src/ort-assets.js?v=0.8.0",
  "./src/ort-vision.js?v=0.8.0",
  "./src/ort-inference-worker.js?v=0.8.0",
  "./src/ort-vision-math.js?v=0.8.0",
  "./src/model-download.js?v=0.8.0",
  "./src/model-progress.js?v=0.8.0",
  "./src/model-cache.js?v=0.8.0",
  "./src/heif.js?v=0.8.0",
  "./src/i18n.js?v=0.8.0",
  "./src/native-mattes.js?v=0.8.0",
  "./src/inspection-compare.js?v=0.8.0",
  "./src/portrait-matte.js?v=0.8.0",
  "./src/port.js?v=0.8.0",
  "./src/raster-import.js?v=0.8.0",
  "./src/primary-source.js?v=0.8.0",
  "./src/raster-color.js?v=0.8.0",
  "./src/linear-thumbnail.js?v=0.8.0",
  "./src/hevc-linear-tags.js?v=0.8.0",
  "./src/hevc-color.js?v=0.8.0",
  "./src/hevc-encoder.js?v=0.8.0",
  "./src/ffmpeg-assets.js?v=0.8.0",
  "./src/ffmpeg-worker.js?v=0.8.0",
  "./src/ffmpeg-hevc.js?v=0.8.0",
  "./src/synthetic-hevc.js?v=0.8.0",
  "./src/generated-profile.js?v=0.8.0",
  "./src/isolation.js?v=0.8.0",
  "./src/styles.js?v=0.8.0",
  "./src/texture.js?v=0.8.0",
  "./src/zip.js?v=0.8.0"
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
    // JavaScript must match its requested version; HTML can retain navigation queries.
    const cached = await cache.match(request, { ignoreSearch: !/\.m?js$/.test(new URL(request.url).pathname) });
    if (cached) return cached;
    throw error;
  }
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
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      networkFirst(request).catch(() => caches.match("./index.html")).then(isolatedResponse)
    );
    return;
  }

  event.respondWith(networkFirst(request).then(isolatedResponse));
});
