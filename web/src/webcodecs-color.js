import {hevcSpsColor} from "./hevc-color.js?v=0.8.0";

/** Some browsers ignore partial decoder colorSpace dictionaries. Fill missing
 * fields from SPS VUI where available; never invent YUV matrix/range from ICC. */
export function completeDecoderColorSpace(description, declared) {
  if (!declared) return undefined;
  let sps;
  try { sps = hevcSpsColor(description); }
  catch { return declared; } // Decoder can still handle streams our parser cannot.
  const names = {primaries: {1:"bt709",5:"bt470bg",6:"smpte170m",9:"bt2020",12:"smpte432"},
    transfer: {1:"bt709",6:"smpte170m",8:"linear",13:"iec61966-2-1",16:"pq",18:"hlg"},
    matrix: {0:"rgb",1:"bt709",5:"bt470bg",6:"smpte170m",9:"bt2020-ncl"}};
  const detected = {};
  for (const [field,mapping] of Object.entries(names)) if (mapping[sps[field]]) detected[field] = mapping[sps[field]];
  if (sps.video) detected.fullRange = sps.fullRange;
  return {...detected,...declared};
}

const nativeYuv = /^(?:NV12|I(?:420|422|444)(?:A)?(?:P(?:10|12))?)$/;
const matrices = new Set(["bt709","bt470bg","smpte170m","bt2020-ncl"]);
const describe = value => value == null ? "unspecified" : String(value);
function check(frame, requested) {
  for (const [field,value] of Object.entries(requested || {})) if (frame.colorSpace?.[field] !== value)
    throw Error(`HEVC decoder did not preserve HEIF ${field}: expected ${describe(value)}, received ${describe(frame.colorSpace?.[field])}`);
}

/** Returns the input or a caller-owned replacement. Recognized ICC primaries/TRCs
 * and a known HEIF/SPS YUV matrix may be repaired before RGB conversion. Range
 * mismatches remain unsupported. copyTo() omits format/colorSpace: it copies
 * native YUV planes without conversion, chroma resampling or normalization. */
export async function applyDecodedColorSpace(frame, requested, iccProfile) {
  const mismatches = Object.keys(requested || {}).filter(field => frame.colorSpace?.[field] !== requested[field]);
  if (!mismatches.length) return frame;
  if (!iccProfile || mismatches.some(field => !["primaries","transfer","matrix"].includes(field))
    || (mismatches.includes("matrix") && !matrices.has(requested.matrix))) {
    check(frame,requested);
  }
  const reported = frame.colorSpace;
  if (!nativeYuv.test(frame.format || "") || !globalThis.VideoFrame || !matrices.has(reported?.matrix)
    || typeof reported?.fullRange !== "boolean") {
    throw Error(`HEVC ICC color correction requires native YUV: format=${frame.format || "unavailable"}, primaries=${describe(reported?.primaries)}, transfer=${describe(reported?.transfer)}, matrix=${describe(reported?.matrix)}, fullRange=${describe(reported?.fullRange)}`);
  }
  const rect = {x:0,y:0,width:frame.codedWidth,height:frame.codedHeight};
  const bytes = new Uint8Array(frame.allocationSize({rect}));
  const layout = await frame.copyTo(bytes,{rect});
  const colorSpace = {primaries:requested.primaries ?? reported.primaries,transfer:requested.transfer ?? reported.transfer,
    matrix:requested.matrix ?? reported.matrix,fullRange:reported.fullRange};
  const replacement = new VideoFrame(bytes,{format:frame.format,codedWidth:frame.codedWidth,codedHeight:frame.codedHeight,
    visibleRect:frame.visibleRect,displayWidth:frame.displayWidth,displayHeight:frame.displayHeight,
    timestamp:frame.timestamp, ...(frame.duration == null ? {} : {duration:frame.duration}),
    rotation:frame.rotation || 0,flip:frame.flip || false,layout,colorSpace});
  try {
    check(replacement,{...colorSpace,...requested});
    if (replacement.format !== frame.format || replacement.codedWidth !== frame.codedWidth || replacement.codedHeight !== frame.codedHeight)
      throw Error("HEVC ICC correction changed native pixel format or dimensions");
    if (replacement.displayWidth !== frame.displayWidth || replacement.displayHeight !== frame.displayHeight
      || ["x","y","width","height"].some(field => replacement.visibleRect?.[field] !== frame.visibleRect?.[field]))
      throw Error("HEVC ICC correction changed crop or display geometry");
    return replacement;
  } catch(error) {replacement.close();throw error;}
}

/** Read scalar auxiliary data before display gamma or YUV-to-RGB conversion.
 * Normalize only sample range, preserving crop and native precision before the
 * final 8-bit PNG representation. P10/P12 samples use little-endian low bits. */
export async function readGrayscaleData(frame, requested) {
  if (!nativeYuv.test(frame.format || "")) throw Error(`HEVC grayscale data preview requires native YUV: format=${frame.format || "unavailable"}`);
  const fullRange = requested?.fullRange ?? frame.colorSpace?.fullRange;
  if (typeof fullRange !== "boolean") throw Error("HEVC grayscale data preview requires a known sample range");
  if (frame.colorSpace?.fullRange !== fullRange) check(frame, {fullRange});
  const rect = {x:0,y:0,width:frame.codedWidth,height:frame.codedHeight};
  const bytes = new Uint8Array(frame.allocationSize({rect}));
  const layout = await frame.copyTo(bytes, {rect}), plane = layout[0];
  const depth = Number(/P(10|12)$/.exec(frame.format)?.[1] || 8), step = depth > 8 ? 2 : 1;
  const {x,y,width,height} = frame.visibleRect || {};
  if (![x,y,width,height,plane?.offset,plane?.stride].every(Number.isInteger) || x < 0 || y < 0 || width <= 0 || height <= 0
    || x + width > frame.codedWidth || y + height > frame.codedHeight || plane.offset < 0
    || plane.stride < frame.codedWidth * step || plane.offset + (y + height - 1) * plane.stride + (x + width) * step > bytes.length)
    throw Error("HEVC grayscale data preview has invalid native plane layout");
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength), rgba = new Uint8ClampedArray(width * height * 4);
  const scale = 2 ** (depth - 8), black = fullRange ? 0 : 16 * scale, white = fullRange ? 2 ** depth - 1 : 235 * scale;
  for (let row = 0; row < height; row++) for (let col = 0; col < width; col++) {
    const offset = plane.offset + (y + row) * plane.stride + (x + col) * step;
    const sample = step === 1 ? bytes[offset] : view.getUint16(offset,true);
    if (sample >= 2 ** depth) throw Error("HEVC grayscale data preview has invalid native sample depth");
    const value = Math.round(Math.max(0,Math.min(1,(sample-black)/(white-black))) * 255), p = (row * width + col) * 4;
    rgba[p] = rgba[p+1] = rgba[p+2] = value; rgba[p+3] = 255;
  }
  return {width,height,rgba};
}
