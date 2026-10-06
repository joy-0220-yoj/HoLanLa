import assert from 'node:assert/strict';
import {blackWhiteI420, hevcSpsColor, hevcOutputColor, measureHevcRange} from '../../web/src/hevc-color.js';
import {hevcAnnexB} from '../../web/src/ffmpeg-hevc.js';

// Generic Main8 SPS without VUI; no personal photo payload is included.
const record = Uint8Array.from(Buffer.from('AQFgAAAAsAAAAAAAWvAA/P34+AAACwOgAAEAGEABDAH//wFgAAADALAAAAMAAAMAWhcCQKEAAQAhQgEBAWAAAAMAsAAAAwAAAwBaoAQCAIBYgXkkWRVy5cuiogABAAdEAcByTBTJ', 'base64'));
const reported = {primaries: 'bt709', transfer: 'iec61966-2-1', matrix: 'bt709', fullRange: true};
assert.equal(hevcSpsColor(record).present, false);
assert.equal(hevcOutputColor(record, reported, reported, false).fullRange, false,
  'missing VUI plus false full-range metadata must use measured limited range');
assert.equal(hevcOutputColor(record, reported, reported, true).fullRange, true,
  'absent VUI must not force genuinely full-range pixels into limited range');
assert.throws(() => hevcSpsColor(record.slice(0, -1)), /Truncated|Invalid/);

globalThis.EncodedVideoChunk = class {constructor(config) {Object.assign(this, config);}};
let levels = [16, 235], format = 'NV12', frameClosed = 0, decoderClosed = 0, failure = null, unreadable = false;
globalThis.VideoDecoder = class {
  constructor(callbacks) {this.callbacks = callbacks;}
  configure(config) {assert.deepEqual(config.description, record);}
  decode() {
    const width = 32, height = 16, stride = 40, offset = 8;
    this.callbacks.output({format, visibleRect: {width, height}, allocationSize: () => offset + stride * height,
      async copyTo(out) {
        if (unreadable) throw Error('YUV readback unavailable');
        out.fill(99); // Padding must not affect measured endpoint levels.
        for (let y = 0; y < height; y++) {
          out.fill(levels[0], offset + y * stride, offset + y * stride + width / 2);
          out.fill(levels[1], offset + y * stride + width / 2, offset + y * stride + width);
        }
        return [{offset, stride}];
      }, close() {frameClosed++;}});
  }
  async flush() {if (failure) throw failure;}
  close() {decoderClosed++;}
};
const config = {codec: 'hvc1.1.6.L120.B0', width: 32, height: 16};
assert.equal(await measureHevcRange(record, new Uint8Array([1]), config), false);
levels = [0, 255]; format = 'I420';
assert.equal(await measureHevcRange(record, new Uint8Array([1]), config), true);
levels = [30, 218];
await assert.rejects(measureHevcRange(record, new Uint8Array([1]), config), /unexpected black\/white/);
let fallbackCalls = 0;
const softwareLuma = async (description, payload, actualConfig) => {
  fallbackCalls++; assert.equal(description, record); assert.deepEqual(actualConfig, config);
  const bytes = blackWhiteI420(config.width, config.height).slice(0, config.width * config.height);
  for (let i = 0; i < bytes.length; i++) bytes[i] = bytes[i] ? levels[1] : levels[0];
  return {bytes, width: config.width, height: config.height};
};
const measure = () => measureHevcRange(record, new Uint8Array([1]), config, undefined, softwareLuma);
for (format of ['RGBA', null]) for (levels of [[16, 235], [0, 255]]) {
  assert.equal(await measure(), levels[0] === 0, 'opaque/RGB decoder output uses actual software-decoded range');
}
format = 'I420'; unreadable = true; levels = [16, 235];
assert.equal(await measure(), false, 'copyTo failure also uses native software samples');
unreadable = false;
failure = Error('decoder failed');
assert.equal(await measure(), false, 'platform decoder failure also falls back');
failure = null; format = 'RGBA'; levels = [30, 218];
await assert.rejects(measure(), /unexpected black\/white/, 'fallback must still reject bad sample levels');
await assert.rejects(measureHevcRange(record, new Uint8Array([1]), config, undefined, async () => {throw Error('software failed');}),
  error => /software failed/.test(error.message) && /native 8-bit YUV/.test(error.cause.message));
await assert.rejects(measureHevcRange(record, new Uint8Array([1]), config, undefined,
  async () => ({bytes: new Uint8Array(1), width: 32, height: 16})), /dimensions disagree/);
assert.equal(fallbackCalls, 7); assert.equal(frameClosed, 12); assert.equal(decoderClosed, 12);
assert.deepEqual([...blackWhiteI420(2, 2)], [0, 255, 0, 255, 128, 128]);
delete globalThis.VideoDecoder; delete globalThis.EncodedVideoChunk;
levels = [0, 255]; assert.equal(await measure(), true, 'missing WebCodecs decoder uses software');
const annex = hevcAnnexB(record, new Uint8Array([0, 0, 0, 3, 0x26, 1, 0]));
assert.deepEqual([...annex.slice(-7)], [0, 0, 0, 1, 0x26, 1, 0]);
assert.throws(() => hevcAnnexB(record.slice(0, -1), new Uint8Array([1])), /Truncated/);
assert.throws(() => hevcAnnexB(record, new Uint8Array([0, 0, 0, 8, 0x26, 1])), /Truncated/);
console.log('HEVC range calibration: native samples, opaque/RGB/readback failures, software fallback, invalid output and decoder cleanup passed');
