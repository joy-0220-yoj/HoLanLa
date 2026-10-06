import assert from 'node:assert/strict';
import test from 'node:test';
import {MODEL_CACHE_NAME} from '../../web/src/model-download.js';
import {listCachedModelFiles, deleteCachedModelFiles} from '../../web/src/model-cache.js';
import {FFMPEG_ASSETS} from '../../web/src/ffmpeg-assets.js';
import {ORT_ASSETS} from '../../web/src/ort-assets.js';
import {DNG_ASSETS} from '../../web/src/dng-assets.js';

function storage() {
  const entries = new Map([...ORT_ASSETS, ...FFMPEG_ASSETS, ...DNG_ASSETS].map(asset => [asset.url,
    new Response('fixture', {headers: {'content-length': '7'}})]));
  entries.set('https://unrelated.test/other.wasm', new Response('unrelated'));
  const cache = {keys: async () => [...entries.keys()].map(url => new Request(url)),
    match: async request => entries.get(request.url)?.clone(), delete: async request => entries.delete(request.url)};
  return {entries, has: async name => name === MODEL_CACHE_NAME,
    open: async name => {assert.equal(name, MODEL_CACHE_NAME); return cache;}};
}

test('cache lists ONNX Runtime, three ONNX models and the encoder with Google source versions', async () => {
  const files = await listCachedModelFiles(storage());
  assert.deepEqual(files.map(file => file.resource), ['ffmpeg', 'dng', 'ort', 'ortDetector', 'ortFace', 'ortSegmenter']);
  assert.ok(files.every(file => file.current && file.count === 1 && file.bytes === 7));
  for (const resource of ['ort', 'ffmpeg']) {
    const file = files.find(file => file.resource === resource);
    assert.equal(file.scriptCount, 2); assert.equal(file.scriptBytes, 14);
  }
  assert.equal(files.find(file => file.resource === 'dng').scriptCount, 1);
  for (const asset of ORT_ASSETS.filter(asset => asset.sourceVersion)) {
    const file = files.find(file => file.resource === asset.resource);
    assert.equal(file.sourceVersion, '1'); assert.equal(file.sourceVariant, asset.sourceVariant);
    assert.ok(asset.url.includes(file.version), 'cache identity uses the pinned conversion revision');
  }
});

test('deleting the ONNX Runtime runtime retains models and encoder; clear all ignores unrelated URLs', async () => {
  const saved = storage();
  await deleteCachedModelFiles('ort', saved);
  assert.ok(ORT_ASSETS.filter(asset => asset.resource === 'ort').every(asset => !saved.entries.has(asset.url)));
  assert.ok(ORT_ASSETS.slice(3).every(asset => saved.entries.has(asset.url)));
  assert.ok(FFMPEG_ASSETS.every(asset => saved.entries.has(asset.url)));
  await deleteCachedModelFiles('all', saved);
  assert.deepEqual([...saved.entries.keys()], ['https://unrelated.test/other.wasm']);
  await assert.rejects(deleteCachedModelFiles('unknown', saved), /Unknown model resource/);
});

test('previous runtime and model revisions remain visible and individually deletable', async () => {
  const saved = storage();
  const oldRuntime = ORT_ASSETS.slice(0, 3).map(asset => asset.url.replace('@1.23.2/', '@1.22.0/'));
  const oldFace = ORT_ASSETS[4].url.replace(/\/resolve\/[^/]+\//, '/resolve/old-revision/');
  for (const url of [...oldRuntime, oldFace]) saved.entries.set(url, new Response('old', {headers: {'content-length': '3'}}));
  const files = await listCachedModelFiles(saved);
  assert.equal(files.length, 8); assert.equal(files.filter(file => file.current).length, 6);
  const old = files.find(file => file.resource === 'ort' && !file.current);
  assert.equal(old.count, 1); assert.equal(old.scriptCount, 2);
  const face = files.find(file => file.resource === 'ortFace' && !file.current);
  assert.equal(face.sourceVersion, undefined, 'unverified revisions must not inherit the pinned Google source version');
  await deleteCachedModelFiles('ort', saved, {version: old.version, variant: old.variant});
  assert.ok(oldRuntime.every(url => !saved.entries.has(url)));
  assert.ok(ORT_ASSETS.every(asset => saved.entries.has(asset.url)));
  await deleteCachedModelFiles('ortFace', saved, {version: face.version, variant: face.variant});
  assert.equal(saved.entries.has(oldFace), false); assert.ok(saved.entries.has(ORT_ASSETS[4].url));
});

test('script-only old runtimes and encoder versions are manageable without deleting other versions', async () => {
  const saved = storage(), oldScript = ORT_ASSETS[0].url.replace('@1.23.2/', '@1.21.0/');
  const oldEncoder = FFMPEG_ASSETS[1].url.replace('@0.12.10/', '@0.12.9/');
  saved.entries.set(oldScript, new Response('loader')); saved.entries.set(oldEncoder, new Response('old', {headers: {'content-length': '3'}}));
  const files = await listCachedModelFiles(saved), old = files.find(file => file.version === '1.21.0');
  assert.equal(old.count, 0); assert.equal(old.scriptCount, 1); assert.equal(old.scriptBytes, 6);
  await assert.rejects(deleteCachedModelFiles('ort', saved, {version: old.version}), /Invalid model version/);
  const current = files.find(file => file.resource === 'ffmpeg' && file.current);
  await deleteCachedModelFiles('ffmpeg', saved, {version: current.version, variant: current.variant});
  assert.ok(FFMPEG_ASSETS.every(asset => !saved.entries.has(asset.url)));
  assert.ok(saved.entries.has(oldEncoder)); assert.ok(saved.entries.has(oldScript));
  await deleteCachedModelFiles('all', saved);
  assert.deepEqual([...saved.entries.keys()], ['https://unrelated.test/other.wasm']);
});

test('missing cache does not create an empty store; inaccessible storage reports failure', async () => {
  const absent = {has: async () => false, open: async () => {throw Error('should not open');}};
  assert.ok((await listCachedModelFiles(absent)).every(file => file.count === 0));
  await deleteCachedModelFiles('all', absent);
  await assert.rejects(listCachedModelFiles(null), /unavailable/);
  await assert.rejects(deleteCachedModelFiles('all', null), /unavailable/);
});
