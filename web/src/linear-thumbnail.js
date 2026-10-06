// Independent P3-linear Main10 thumbnails via FFmpeg.wasm/x265; explicit legacy Main8 via WebCodecs.
import { box, be, concat } from "./box.js?v=0.8.0";
import {retagLinearHevc, readSpsInfo} from './hevc-linear-tags.js?v=0.8.0';
import {resolveEncodedColorSpace} from './raster-color.js?v=0.8.0';
import {blackWhiteI420, measureHevcRange, hevcOutputColor} from './hevc-color.js?v=0.8.0';
import {supportedHevcConfig} from './hevc-encoder.js?v=0.8.0';
import {encodeHevcPixels} from './ffmpeg-hevc.js?v=0.8.0';

export const LINEAR_COLOR = Object.freeze({
  primaries: "smpte432", transfer: "linear", matrix: "bt709", fullRange: false,
});
const even = (n) => Math.max(2, Math.round(n / 2) * 2);
export function linearGeometry(width, height, angle = 0) {
  const scale = Math.min(1, 1024 / Math.max(width, height));
  const w = even(width * scale), h = even(height * scale);
  return angle === 90 || angle === 270 ? { width: h, height: w } : { width: w, height: h };
}

// Display P3 uses the sRGB transfer curve. Samples are linearized before YUV conversion.
export function p3ToLinearI420(rgba, width, height, floating = false, colorSpace = LINEAR_COLOR) {
  return linearSamples(rgba, width, height, floating, colorSpace);
}

function linearSamples(rgba, width, height, floating, colorSpace = LINEAR_COLOR, bitDepth = 8) {
  if (width % 2 || height % 2 || rgba.length !== width * height * 4)
    throw new Error("Invalid linear thumbnail dimensions");
  const plane = width * height, chroma = plane / 4;
  const matrix = {bt709: [0.2126, 0.0722], smpte170m: [0.299, 0.114], bt470bg: [0.299, 0.114]}[colorSpace.matrix];
  if (!matrix || typeof colorSpace.fullRange !== 'boolean')
    throw Error(`Unsupported linear thumbnail YUV colour: ${JSON.stringify(colorSpace)}`);
  const [kr, kb] = matrix, kg = 1 - kr - kb;
  const yOffset = colorSpace.fullRange ? 0 : 64, yScale = colorSpace.fullRange ? 1020 : 876;
  const chromaScale = colorSpace.fullRange ? 255 : 224;
  const yMax = colorSpace.fullRange ? 1020 : 940, chromaMin = colorSpace.fullRange ? 0 : 64;
  const chromaMax = colorSpace.fullRange ? 1020 : 960;
  const bytes = bitDepth === 10 ? new Uint16Array(plane + 2 * chroma) : new Uint8Array(plane + 2 * chroma);
  const linear = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i++) for (let c = 0; c < 3; c++) {
    const value = Math.max(0, Math.min(1, rgba[i * 4 + c] / (floating ? 1 : 255)));
    linear[i * 3 + c] = value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  }
  const write = (index, value, min, max) => {
    const divisor = bitDepth === 10 ? 1 : 4;
    bytes[index] = Math.max(min / divisor, Math.min(max / divisor, Math.round(value / divisor)));
  };
  for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) {
    let u = 0, v = 0;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const i = (y + dy) * width + x + dx;
      const r = linear[i * 3], g = linear[i * 3 + 1], b = linear[i * 3 + 2];
      const luma = kr * r + kg * g + kb * b;
      write(i, yOffset + yScale * luma, yOffset, yMax);
      u += (b - luma) / (2 * (1 - kb));
      v += (r - luma) / (2 * (1 - kr));
    }
    const c = (y / 2) * (width / 2) + x / 2;
    write(plane + c, 512 + chromaScale * u, chromaMin, chromaMax);
    write(plane + chroma + c, 512 + chromaScale * v, chromaMin, chromaMax);
  }
  return bytes;
}

export function prepareLinearPixels(image, { angle = 0, mirror = null } = {}) {
  const { width, height } = linearGeometry(image.width, image.height, angle);
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d", { colorSpace: "display-p3", colorType: "float16",
    alpha: false, willReadFrequently: true });
  if (!ctx || ctx.getContextAttributes?.().colorSpace !== "display-p3")
    throw new Error("Linear thumbnail requires a Display P3 canvas");
  ctx.save(); ctx.translate(width / 2, height / 2);
  // Undo HEIF imir before undoing irot: 0 reverses vertical coordinates,
  // 1 horizontal, matching the displayed orientation returned by either decoder.
  if (mirror === 0) ctx.scale(1, -1); else if (mirror === 1) ctx.scale(-1, 1);
  // HEIF irot is counterclockwise; Canvas positive angles undo it clockwise.
  ctx.rotate(angle * Math.PI / 180);
  const swap = angle === 90 || angle === 270;
  const dw = swap ? height : width, dh = swap ? width : height;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, -dw / 2, -dh / 2, dw, dh); ctx.restore();
  let pixels;
  try { pixels = ctx.getImageData(0, 0, width, height,
    { colorSpace: "display-p3", pixelFormat: "rgba-float16" }); }
  catch { pixels = ctx.getImageData(0, 0, width, height, { colorSpace: "display-p3" }); }
  if (pixels.colorSpace !== "display-p3") throw new Error("Linear thumbnail lost P3 colour space");
  const floating = pixels.pixelFormat === "rgba-float16";
  const samples = linearSamples(pixels.data, width, height, floating);
  return { samples, width, height, sourcePixels: floating ? "float16" : "unorm8",
    rgba: pixels.data, floating };
}

export function validateMain8(record) {
  if (record.length < 23 || record[0] !== 1 || (record[1] & 31) !== 1
      || (record[17] & 7) !== 0 || (record[18] & 7) !== 0 || (record[16] & 3) !== 1)
    throw Error('8-bit linear thumbnail encoder did not produce HEVC Main 8-bit');
  let pos = 23, found = false, sps;
  for (let i = 0; i < record[22]; i++) {
    if (pos + 3 > record.length) throw Error('Truncated 8-bit hvcC');
    const type = record[pos++] & 63, count = record[pos++] * 256 + record[pos++];
    for (let j = 0; j < count; j++) {
      if (pos + 2 > record.length) throw Error('Truncated 8-bit hvcC');
      const size = record[pos++] * 256 + record[pos++];
      if (pos + size > record.length) throw Error('Truncated 8-bit SPS');
      if (type === 33) {
        const info = readSpsInfo(record.subarray(pos, pos + size));
        if (info.chroma !== 1 || info.luma !== 8 || info.chromaDepth !== 8)
          throw Error('8-bit linear thumbnail SPS is not 8-bit 4:2:0');
        if (sps && ['primaries', 'transfer', 'matrix', 'fullRange'].some(field => sps[field] !== info[field]))
          throw Error('8-bit linear thumbnail SPS arrays disagree on colour');
        sps = info;
        found = true;
      }
      pos += size;
    }
  }
  if (!found || pos !== record.length) throw Error('Invalid 8-bit SPS array');
  return sps;
}

function main8Transport(record, reported, fallback, fullRange) {
  const sps = validateMain8(record), actual = {...reported};
  // SPS determines matrix/transfer; the caller keeps input full-range while
  // decoded calibration determines the separate encoded output range.
  const fields = {
    primaries: {1: 'bt709'},
    transfer: {1: 'bt709', 6: 'smpte170m', 13: 'iec61966-2-1'},
    matrix: {1: 'bt709', 5: 'bt470bg', 6: 'smpte170m'},
  };
  for (const [field, values] of Object.entries(fields)) {
    if (sps[field] == null || sps[field] === 2) continue;
    if (!values[sps[field]]) throw Error(`8-bit linear thumbnail unsupported SPS ${field}: ${sps[field]}`);
    actual[field] = values[sps[field]];
  }
  actual.fullRange = fullRange;
  return resolveEncodedColorSpace(actual, fallback);
}

export async function encodeLinearThumbnail8(image, orientation = {}, onProgress) {
  if (!globalThis.VideoEncoder || !globalThis.VideoFrame)
    throw Error('8-bit linear thumbnail requires HEVC WebCodecs');
  const prepared = prepareLinearPixels(image, orientation), {width, height} = prepared;
  const config = await supportedHevcConfig(width, height, 4_000_000, {level: 120});
  if (!config) throw Error('8-bit linear thumbnail HEVC encoder unavailable');
  onProgress?.({stage: 'codec', operation: 'encode', source: 'WebCodecs VideoEncoder'});
  // Negotiate SDR transport before converting P3-linear RGB into actual YUV.
  // The final SPS retains that matrix/range and identifies the samples as P3-linear.
  let transport = {primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', fullRange: true};
  let outputTransport;
  let frame, probe, encoder, description, payload, failure, outputColor, count = 0;
  try {
    encoder = new VideoEncoder({
      output(chunk, metadata) {
        count++; const source = metadata?.decoderConfig?.description;
        if (source) description = ArrayBuffer.isView(source)
          ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength).slice() : new Uint8Array(source).slice();
        if (metadata?.decoderConfig?.colorSpace) outputColor = metadata.decoderConfig.colorSpace;
        payload = new Uint8Array(chunk.byteLength); chunk.copyTo(payload);
      }, error(error) { failure = error; },
    });
    encoder.configure(config);
    // Decode known full-range endpoints to measure actual output range. Browser
    // metadata alone can label a limited-range bitstream as full-range.
    const neutral = blackWhiteI420(width, height);
    probe = new VideoFrame(neutral, {format: 'I420', codedWidth: width, codedHeight: height,
      timestamp: 0, duration: 1_000_000, colorSpace: transport});
    encoder.encode(probe, {keyFrame: true}); await encoder.flush();
    if (failure) throw failure;
    if (count !== 1 || !description) throw Error('8-bit linear thumbnail encoder returned no probe frame');
    const fullRange = await measureHevcRange(description, payload, config, onProgress);
    outputTransport = resolveEncodedColorSpace(hevcOutputColor(description, outputColor, transport, fullRange));
    transport = main8Transport(description, outputColor, transport, true);
    count = 0; payload = null;
    const samples = p3ToLinearI420(prepared.rgba, width, height, prepared.floating, transport);
    frame = new VideoFrame(samples, {format: 'I420', codedWidth: width, codedHeight: height,
      timestamp: 1_000_000, duration: 1_000_000, colorSpace: transport});
    encoder.encode(frame, {keyFrame: true}); await encoder.flush();
    if (failure) throw failure;
  } catch (error) { throw Error(`8-bit linear thumbnail encode failed: ${error.message}`); }
  finally { probe?.close(); frame?.close(); encoder?.close(); }
  if (count !== 1 || !description) throw Error('8-bit linear thumbnail encoder returned no single HEVC frame');
  const actual = main8Transport(description, outputColor, transport, true);
  for (const field of ['primaries', 'transfer', 'matrix', 'fullRange'])
    if (actual[field] !== transport[field])
      throw Error(`8-bit linear thumbnail encoder changed ${field}: ${actual[field]} (expected ${transport[field]})`);
  const actualOutput = resolveEncodedColorSpace(hevcOutputColor(description, outputColor, outputTransport, outputTransport.fullRange));
  for (const field of ['primaries', 'transfer', 'matrix', 'fullRange'])
    if (actualOutput[field] !== outputTransport[field]) throw Error(`8-bit linear thumbnail encoder changed ${field}`);
  const matrix = {bt709: 1, smpte170m: 6, bt470bg: 5}[outputTransport.matrix];
  const tagged = retagLinearHevc(description, payload, {matrix, fullRange: outputTransport.fullRange});
  validateMain8(tagged.record);
  return {payload: tagged.payload, hvcc: box('hvcC', tagged.record), width, height,
    pixi: box('pixi', new Uint8Array([0, 0, 0, 0, 3, 8, 8, 8])),
    colr: box('colr', concat([new TextEncoder().encode('nclx'), be(12, 2), be(8, 2), be(matrix, 2), new Uint8Array([outputTransport.fullRange ? 128 : 0])])),
    sourcePixels: prepared.sourcePixels, bitDepth: 8, transportColor: outputTransport, inputColor: transport, mode: 'webcodecs-main8-p3-linear'};
}

export function p3ToLinearI420P10(rgba, width, height, floating = false) {
  return linearSamples(rgba, width, height, floating, LINEAR_COLOR, 10);
}

export async function encodeLinearThumbnail10(image, orientation = {}, onProgress) {
  const prepared = prepareLinearPixels(image, orientation), {width, height} = prepared;
  const samples = p3ToLinearI420P10(prepared.rgba, width, height, prepared.floating);
  try {
    const encoded = await encodeHevcPixels(samples, {width, height,
      primaries: 'smpte432', transfer: 'linear', matrix: 'bt709'}, onProgress);
    if (encoded.sps.primaries !== 12 || encoded.sps.transfer !== 8 || encoded.sps.matrix !== 1 || encoded.sps.fullRange)
      throw Error('10-bit linear thumbnail colour tags disagree');
    return {payload: encoded.payload, hvcc: encoded.hvcc, width, height,
      pixi: box('pixi', new Uint8Array([0, 0, 0, 0, 3, 10, 10, 10])),
      colr: box('colr', concat([new TextEncoder().encode('nclx'), be(12, 2), be(8, 2), be(1, 2), new Uint8Array([0])])),
      sourcePixels: prepared.sourcePixels, bitDepth: 10, transportColor: LINEAR_COLOR, inputColor: LINEAR_COLOR,
      mode: 'ffmpeg-wasm-x265-main10-p3-linear'};
  } catch (error) { throw Error(`10-bit linear thumbnail encode failed: ${error.message}`); }
}

export async function encodeSelectedLinearThumbnail(image, {bitDepth = 10, ...orientation} = {}, onProgress = () => {}) {
  if (![8, 10].includes(bitDepth)) throw Error('Unsupported linear thumbnail bit depth');
  onProgress({stage: 'linear', bitDepth});
  const encoded = await (bitDepth === 10 ? encodeLinearThumbnail10 : encodeLinearThumbnail8)(image, orientation, onProgress);
  return {...encoded, bitDepth};
}
