import {generatedProfileFixture} from './profile-fixtures.mjs';
import assert from 'node:assert/strict';
import {supportedHevcConfig} from '../../web/src/hevc-encoder.js';
import {prepareHeicAuxiliaries, prepareHeicLinearThumbnail, importRaster} from '../../web/src/raster-import.js';
import {discoverHeic, dimensionsForItem, displayDimensions, itemOrientation} from '../../web/src/heif.js';

const requests = [];
let accepts = () => false;
globalThis.VideoFrame = class {};
globalThis.VideoEncoder = class {
  static async isConfigSupported(config) {
    requests.push(config);
    return {supported: accepts(config), config};
  }
};
const select = async (predicate, options) => {
  accepts = predicate; requests.length = 0;
  const config = await supportedHevcConfig(432, 768, 2_000_000, options);
  for (const requested of requests) {
    assert.match(requested.codec, /^(hvc1|hev1)\.1\.6\.L\d+\.B0$/);
    assert.deepEqual(requested.hevc, {format: 'hevc'});
    assert.deepEqual([requested.width, requested.height, requested.bitrate], [432, 768, 2_000_000]);
  }
  return config;
};
assert.equal((await select(() => true)).hardwareAcceleration, 'no-preference');
assert.equal(requests.length, 1, 'working default stops probing immediately');
assert.equal((await select(c => c.bitrateMode === 'constant')).bitrateMode, 'constant', 'CBR-only encoder remains usable');
assert.equal((await select(c => c.latencyMode === 'realtime')).latencyMode, 'realtime');
assert.equal((await select(c => c.hardwareAcceleration === 'prefer-hardware')).hardwareAcceleration, 'prefer-hardware');
assert.equal((await select(c => c.hardwareAcceleration === 'prefer-software')).hardwareAcceleration, 'prefer-software');
assert.match((await select(c => c.codec.startsWith('hev1'))).codec, /^hev1/);
assert.match((await select(c => c.codec.includes('L153'))).codec, /L153/);
assert.match((await select(() => true, {level: 120})).codec, /L120/, 'linear thumbnails keep their original Main8 level');
await select(c => {
  if (c.bitrateMode === 'variable') throw Error('unsupported VBR');
  return c.latencyMode === 'realtime' && c.hardwareAcceleration === 'prefer-software';
});
assert.equal(await select(() => false), null);
assert.equal(requests.length, 72, 'complete bounded matrix on unavailable encoder');
const encoder = globalThis.VideoEncoder;
delete globalThis.VideoEncoder;
assert.equal(await supportedHevcConfig(432, 768, 2_000_000), null);
globalThis.VideoEncoder = encoder;
delete globalThis.VideoFrame;
requests.length = 0;
assert.equal(await supportedHevcConfig(432, 768, 2_000_000), null);
assert.equal(requests.length, 0);
globalThis.VideoFrame = class {};

// No photo decode, Canvas allocation or optional decoder download is needed to
// discover that the required new auxiliary cannot be produced.
let nativeCalls = 0;
globalThis.createImageBitmap = async () => {nativeCalls++; throw Error('unexpected photo decode');};
globalThis.document = {createElement() {throw Error('unexpected canvas or decoder download');}};
const profile = await generatedProfileFixture('48-12');
const data = profile.meta, discovery = discoverHeic(data);
const file = new File([data], 'source.heic', {type: 'image/heic'});
accepts = () => false;
for (const decoder of ['webcodecs', 'libheif']) {
  const progress = [];
  await assert.rejects(prepareHeicAuxiliaries(file, {...discovery, thumbnail: null},
    e => progress.push(e), {bytes: data, decoder}), /HEVC WebCodecs encoder unavailable/);
  await assert.rejects(prepareHeicLinearThumbnail(file, data, discovery,
    e => progress.push(e), {decoder}), /FFmpeg.wasm requires cross-origin isolation/);
  await assert.rejects(importRaster(file, {}, e => progress.push(e),
    {heicAnalysis: {bytes: data, decoder}}), /HEVC WebCodecs encoder unavailable/);
  assert.equal(progress.length, 0, 'unsupported encoder does not attempt source decode');
}
requests.length = 0;
assert.deepEqual(await prepareHeicAuxiliaries(file, {...discovery, thumbnail: 999, hdrGrid: 998}),
  {thumbnail: null, hdr: null});
assert.equal(requests.length, 0, 'preserving existing auxiliaries needs no encoder');
// A supported thumbnail must not trigger expensive decoding if the missing HDR
// map at its own dimensions is unsupported.
const [storedWidth, storedHeight] = dimensionsForItem(discovery.props, discovery.primary);
const {angle} = itemOrientation(data, discovery.props, discovery.primary);
const [width, height] = displayDimensions(storedWidth, storedHeight, angle);
const scale = Math.min((height > width ? 312 : 416) / width, (height > width ? 416 : 312) / height);
const even = n => Math.max(16, Math.round(n / 2) * 2);
accepts = c => c.bitrate === 800_000;
requests.length = 0;
await assert.rejects(prepareHeicAuxiliaries(file, {...discovery, thumbnail: null, hdrGrid: null},
  () => {}, {bytes: data}), /HEVC WebCodecs encoder unavailable/);
assert.deepEqual([requests[0].width, requests[0].height], [even(width * scale), even(height * scale)]);
assert.deepEqual([requests.at(-1).width, requests.at(-1).height], [even(storedWidth / 2), even(storedHeight / 2)]);
assert.equal(nativeCalls, 0);
console.log('HEVC encoder negotiation and early failure: CBR, latency, acceleration, sample entry, levels, missing APIs, no decode/download, and preservation paths passed');
