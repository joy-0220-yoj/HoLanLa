import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {MODEL_CACHE_NAME} from '../../web/src/model-download.js';
import {ORT_ASSETS} from '../../web/src/ort-assets.js';
import {FFMPEG_ASSETS} from '../../web/src/ffmpeg-assets.js';

const handlers = new Map(), stores = new Map(), requests = [];
const source = readFileSync(new URL('../../web/sw.js', import.meta.url), 'utf8');
const appCache = 'holanla-' + source.match(/const CACHE_NAME = `\$\{CACHE_PREFIX\}([^`]+)`/)[1];
const supported = [...ORT_ASSETS, ...FFMPEG_ASSETS].map(asset => asset.url);
for (const name of ['holanla-old', appCache, MODEL_CACHE_NAME, 'unrelated-site-cache']) stores.set(name, new Map());
for (const url of supported) stores.get(MODEL_CACHE_NAME).set(url, new Response('fixture'));
const script = 'https://site.test/app.js?v=0.8.0';
stores.get(appCache).set(script, new Response('current script'));
let offline = false;
vm.runInNewContext(source, {
  self: {location: {origin: 'https://site.test', href: 'https://site.test/sw.js?v=0.8.0'}, addEventListener: (name, handler) => handlers.set(name, handler),
    clients: {claim: async () => {}}, skipWaiting: async () => {}},
  caches: {keys: async () => [...stores.keys()], has: async name => stores.has(name), delete: async name => stores.delete(name),
    open: async name => {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {keys: async () => [...entries.keys()].map(url => new Request(url)), delete: async request => entries.delete(request.url),
        match: async request => entries.get(request.url)?.clone(), put: async (request, response) => entries.set(request.url, response.clone())};
    }},
  fetch: async request => {if (offline) throw Error('offline'); requests.push(request.url); return new Response('export const cached = true;');},
  Headers, Response, URL, Request, console,
});
const activation = [];
handlers.get('activate')({waitUntil: promise => activation.push(promise)});
await Promise.all(activation);
assert.ok(!stores.has('holanla-old'));
assert.ok(stores.has(appCache)); assert.ok(stores.has('unrelated-site-cache'));
assert.deepEqual([...stores.get(MODEL_CACHE_NAME).keys()], supported, 'website updates retain the independent resource cache');
for (const url of [...supported, 'https://unrelated.test/model.js']) {
  let intercepted = false;
  handlers.get('fetch')({request: new Request(url), respondWith: () => {intercepted = true;}});
  assert.equal(intercepted, false, 'the worker does not route any third-party runtime requests');
}
assert.deepEqual(requests, []);
offline = true;
function request(url) {
  let response;
  handlers.get('fetch')({request: new Request(url), respondWith: promise => {response = promise;}});
  return response;
}
assert.equal(await (await request(script)).text(), 'current script');
await assert.rejects(request('https://site.test/app.js?v=older'), /offline/,
  'offline JavaScript must never substitute a different cached version');
for (const file of ['face-mattes.js', 'model-cache.js', 'raster-import.js']) {
  assert.doesNotMatch(readFileSync(new URL('../../web/src/' + file, import.meta.url), 'utf8'), /tasks-vision|FilesetResolver|FaceLandmarker\.create|ImageSegmenter\.create/);
}
assert.doesNotMatch(readFileSync(new URL('../../web/index.html', import.meta.url), 'utf8'), /vision-engine|engine\.mediapipe/);
console.log('ONNX Runtime-only backend, independent resource cache and external request isolation: passed.');
