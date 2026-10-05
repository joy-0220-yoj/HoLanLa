import assert from 'node:assert/strict';
import {blackWhiteI420, hevcSpsColor, hevcOutputColor, measureHevcRange} from '../../web/src/hevc-color.js';

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
let levels = [16, 235], format = 'NV12', frameClosed = 0, decoderClosed = 0, failure = null;
globalThis.VideoDecoder = class {
  constructor(callbacks) {this.callbacks = callbacks;}
  configure(config) {assert.deepEqual(config.description, record);}
  decode() {
    const width = 32, height = 16, stride = 40, offset = 8;
    this.callbacks.output({format, visibleRect: {width, height}, allocationSize: () => offset + stride * height,
      async copyTo(out) {
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
const config = {codec: 'hvc1.1.6.L120.B0'};
assert.equal(await measureHevcRange(record, new Uint8Array([1]), config), false);
levels = [0, 255]; format = 'I420';
assert.equal(await measureHevcRange(record, new Uint8Array([1]), config), true);
levels = [30, 218];
await assert.rejects(measureHevcRange(record, new Uint8Array([1]), config), /unexpected black\/white/);
format = 'RGBA';
await assert.rejects(measureHevcRange(record, new Uint8Array([1]), config), /native 8-bit YUV/);
failure = Error('decoder failed');
await assert.rejects(measureHevcRange(record, new Uint8Array([1]), config), /decoder failed/);
assert.equal(frameClosed, 5); assert.equal(decoderClosed, 5);
assert.deepEqual([...blackWhiteI420(2, 2)], [0, 255, 0, 255, 128, 128]);
delete globalThis.VideoDecoder; delete globalThis.EncodedVideoChunk;
console.log('HEVC native-range calibration: misleading metadata, full/limited output, padded I420/NV12, bad endpoints and decoder cleanup passed');
