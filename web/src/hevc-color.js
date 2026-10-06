// Measure encoded black/white levels instead of trusting WebCodecs range metadata.
import {readSpsInfo} from './hevc-linear-tags.js?v=0.8.0';
import {decodeHevcLuma} from './ffmpeg-hevc.js?v=0.8.0';

export function hevcSpsColor(record) {
  if (record.length < 23 || record[0] !== 1) throw Error('Invalid HEVC colour configuration');
  let pos = 23, result;
  for (let i = 0; i < record[22]; i++) {
    if (pos + 3 > record.length) throw Error('Truncated HEVC colour array');
    const type = record[pos++] & 63, count = record[pos++] * 256 + record[pos++];
    for (let j = 0; j < count; j++) {
      if (pos + 2 > record.length) throw Error('Truncated HEVC colour NAL');
      const size = record[pos++] * 256 + record[pos++];
      if (pos + size > record.length) throw Error('Truncated HEVC colour SPS');
      if (type === 33) {
        const info = readSpsInfo(record.subarray(pos, pos + size));
        if (result && ['primaries', 'transfer', 'matrix', 'fullRange', 'video'].some(k => result[k] !== info[k]))
          throw Error('HEVC SPS colour descriptions disagree');
        result = info;
      }
      pos += size;
    }
  }
  if (!result || pos !== record.length) throw Error('Invalid HEVC colour SPS array');
  return result;
}

export function hevcOutputColor(record, reported, fallback, fullRange) {
  const sps = hevcSpsColor(record), actual = {...fallback};
  for (const [field, value] of Object.entries(reported || {})) if (value != null) actual[field] = value;
  const values = {primaries: {1:'bt709'}, transfer: {1:'bt709', 6:'smpte170m', 13:'iec61966-2-1'},
    matrix: {1:'bt709', 5:'bt470bg', 6:'smpte170m'}};
  for (const [field, names] of Object.entries(values)) {
    if (sps[field] == null || sps[field] === 2) continue;
    if (!names[sps[field]]) throw Error(`Unsupported HEVC SPS ${field}: ${sps[field]}`);
    actual[field] = names[sps[field]];
  }
  // Missing VUI cannot establish actual pixel range. The decoded calibration can.
  if (sps.video && sps.fullRange !== fullRange)
    throw Error('HEVC SPS range disagrees with decoded black/white calibration');
  actual.fullRange = fullRange;
  return actual;
}

export function blackWhiteI420(width, height) {
  const plane = width * height, bytes = new Uint8Array(plane * 3 / 2);
  for (let y = 0; y < height; y++) bytes.fill(255, y * width + width / 2, (y + 1) * width);
  bytes.fill(128, plane);
  return bytes;
}

async function readNativeLuma(record, payload, config, onProgress) {
  if (!globalThis.VideoDecoder || !globalThis.EncodedVideoChunk)
    throw Error('HEVC colour calibration requires a local WebCodecs decoder');
  let frame, failure;
  onProgress?.({stage: 'codec', operation: 'decode', source: 'WebCodecs VideoDecoder'});
  let decoder;
  try {
    decoder = new VideoDecoder({output(value) { frame?.close(); frame = value; }, error(error) { failure = error; }});
    decoder.configure({codec: config.codec, description: record, hardwareAcceleration: 'no-preference'});
    decoder.decode(new EncodedVideoChunk({type: 'key', timestamp: 0, data: payload}));
    await decoder.flush();
    if (failure) throw failure;
    if (!frame || !['I420', 'I420A', 'I422', 'I422A', 'I444', 'I444A', 'NV12'].includes(frame.format))
      throw Error('HEVC colour calibration could not read native 8-bit YUV samples');
    // Copy the native YUV format, without RGB conversion or range normalization.
    const bytes = new Uint8Array(frame.allocationSize()), layout = await frame.copyTo(bytes);
    const {x = 0, y = 0, width, height} = frame.visibleRect || {}, plane = layout[0];
    if (![x, y, width, height, plane?.offset, plane?.stride].every(Number.isInteger)
        || x < 0 || y < 0 || width < 2 || height < 2 || plane.offset < 0 || plane.stride < x + width
        || plane.offset + (y + height - 1) * plane.stride + x + width > bytes.length)
      throw Error('HEVC colour calibration has invalid native plane layout');
    return {bytes, width, height, offset: plane.offset + y * plane.stride + x, stride: plane.stride};
  } finally {
    frame?.close();
    if (decoder && decoder.state !== 'closed') decoder.close();
  }
}

export async function measureHevcRange(record, payload, config, onProgress, readSoftwareLuma = decodeHevcLuma) {
  let nativeError, samples;
  try { samples = await readNativeLuma(record, payload, config, onProgress); }
  catch (error) { nativeError = error; }
  if (!samples) {
    try {
      const decoded = await readSoftwareLuma(record, payload, config, onProgress);
      if (!(decoded.bytes instanceof Uint8Array) || decoded.width !== config.width || decoded.height !== config.height
          || decoded.bytes.length !== decoded.width * decoded.height)
        throw Error('HEVC calibration decoded dimensions disagree');
      samples = {...decoded, offset: 0, stride: decoded.width};
    } catch (error) {
      throw Error(`HEVC colour calibration software fallback failed: ${error.message}`, {cause: nativeError});
    }
  }
  const {bytes, width, height, offset, stride} = samples;
  const radius = Math.max(0, Math.min(4, Math.floor(width / 8), Math.floor(height / 4)) - 1);
  const level = x => {
    let sum = 0, count = 0;
    for (let y = Math.floor(height / 2) - radius; y <= Math.floor(height / 2) + radius; y++)
      for (let col = x - radius; col <= x + radius; col++) {
        sum += bytes[offset + y * stride + col]; count++;
      }
    return sum / count;
  };
  const black = level(Math.floor(width / 4)), white = level(Math.floor(3 * width / 4));
  const fullError = Math.abs(black) + Math.abs(white - 255);
  const limitedError = Math.abs(black - 16) + Math.abs(white - 235);
  if (Math.min(fullError, limitedError) > 12 || Math.abs(fullError - limitedError) < 8)
    throw Error(`HEVC colour calibration returned unexpected black/white levels: ${black}/${white}`);
  return fullError < limitedError;
}
