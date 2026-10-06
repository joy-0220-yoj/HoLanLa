// Recognize standard matrix/TRC ICC profiles; arbitrary ICC transforms still need
// a color-management engine. Never identify a profile by its description string.
// ICC.1:2022 sections 7, 9 and 10: https://www.color.org/specification/ICC.1-2022-05.pdf
const D50 = [0.9642, 1, 0.8249];
const BRADFORD_D65_TO_D50 = [1.047886, 0.022919, -0.050216,
  0.029582, 0.990484, -0.017079, -0.009252, 0.015073, 0.751678];
// Apple's older Display P3 profiles use a slightly different fixed-point
// adaptation/colorant pair. Match that pair explicitly rather than loosening
// the tolerance for arbitrary ICC matrices. TRC/header/LUT checks still apply.
// Display P3 gamut/TRC reference: https://registry.color.org/rgb-registry/displayp3
const APPLE_P3_ADAPTATION = [68669,1500,-3285,1936,64912,-1117,-605,986,49292].map(v => v / 65536);
// XYZ columns after Bradford adaptation to the ICC D50 connection space.
const SPACES = [
  {name: "sRGB", primaries: "bt709", code: 1,
    xyz: [[0.436075,0.222505,0.013932], [0.385065,0.716879,0.097105], [0.143080,0.060617,0.714173]]},
  {name: "Display P3", primaries: "smpte432", code: 12,
    xyz: [[0.515121,0.241196,-0.001053], [0.291977,0.692245,0.041885], [0.157104,0.066574,0.784073]]},
  {name: "Display P3", primaries: "smpte432", code: 12, adaptation: APPLE_P3_ADAPTATION, tolerance: 2/65536,
    xyz: [[33756,15805,-69],[19133,45366,2745],[10301,4364,51416]].map(c => c.map(v => v / 65536))},
];
const close = (a, b, tolerance = 0.0002) => a.length === b.length && a.every((v,i) => Math.abs(v-b[i]) <= tolerance);
const srgbLinear = x => x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;

export function recognizeIccColorSpace(bytes, {allowGrayscale = false} = {}) {
  const reject = reason => {throw Error(`HEIF ICC color profile requires libheif: ${reason}`);};
  if (!(bytes instanceof Uint8Array) || bytes.length < 132) reject("truncated profile");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset, length = 4) => String.fromCharCode(...bytes.subarray(offset, offset + length));
  const fixed = offset => view.getInt32(offset) / 65536;
  const size = view.getUint32(0), count = view.getUint32(128);
  if (size !== bytes.length || size > 1024 * 1024 || text(36) !== "acsp" || ![2,4].includes(bytes[8])) reject("invalid profile header");
  const grayscale = text(16) === "GRAY" && allowGrayscale;
  if (!["mntr","scnr","spac"].includes(text(12)) || (!grayscale && text(16) !== "RGB ") || text(20) !== "XYZ ") reject("unsupported profile type");
  if (view.getUint32(64) > 2) reject("unsupported rendering intent");
  if (!close([fixed(68),fixed(72),fixed(76)],D50)) reject("unsupported connection-space white point");
  if (count > 128 || 132 + count * 12 > size) reject("invalid tag table");
  const tags = new Map(), ranges = [];
  for (let i = 0; i < count; i++) {
    const p = 132 + i * 12, name = text(p), offset = view.getUint32(p + 4), length = view.getUint32(p + 8);
    if (tags.has(name) || offset % 4 || offset < 132 + count * 12 || length < 8 || length > size - offset) reject("invalid tag bounds");
    if (ranges.some(r => offset < r.offset + r.length && r.offset < offset + length && (r.offset !== offset || r.length !== length))) reject("overlapping tags");
    tags.set(name,{offset,length,type:text(offset)}); ranges.push({offset,length});
    if (/^(A2B|B2A|D2B|B2D)[0-3]$/.test(name) || ["hdgm","vcgt"].includes(name)) reject("custom color transform");
  }
  const xyz = name => {
    const tag = tags.get(name);
    if (!tag || tag.type !== "XYZ " || tag.length !== 20) reject(`missing or invalid ${name}`);
    return [fixed(tag.offset+8),fixed(tag.offset+12),fixed(tag.offset+16)];
  };
  if (!close(xyz("wtpt"), D50)) reject("unsupported profile white point");
  if (tags.has("bkpt") && !close(xyz("bkpt"),[0,0,0],1/65536)) reject("custom black point");
  let adaptation;
  if (tags.has("chad")) {
    const tag = tags.get("chad");
    if (tag.type !== "sf32" || tag.length !== 44) reject("unsupported chromatic adaptation");
    adaptation = Array.from({length:9},(_,i)=>fixed(tag.offset+8+i*4));
    if (!close(adaptation,BRADFORD_D65_TO_D50) && !close(adaptation,APPLE_P3_ADAPTATION,2/65536))
      reject("unsupported chromatic adaptation");
  }
  const curve = name => {
    const tag = tags.get(name);
    if (!tag) reject(`missing ${name}`);
    const p = tag.offset;
    if (tag.type === "para") {
      if (tag.length < 12) reject("truncated parametric curve");
      const kind = view.getUint16(p+8), n = [1,3,4,5,7][kind];
      if (!n || tag.length !== 12+n*4) reject("unsupported parametric curve");
      const values = Array.from({length:n},(_,i)=>fixed(p+12+i*4));
      if (kind === 0 && close(values,[1],2/65536)) return "linear";
      const expected = [2.4,1/1.055,0.055/1.055,1/12.92,0.04045];
      if ([3,4].includes(kind) && close(values,kind === 3 ? expected : [...expected,0,0],2/65536)) return "iec61966-2-1";
    } else if (tag.type === "curv") {
      if (tag.length < 12) reject("truncated sampled curve");
      const n = view.getUint32(p+8);
      if (n > 65536 || tag.length !== 12+n*2) reject("invalid sampled curve");
      if (n === 0 || (n === 1 && view.getUint16(p+12) === 256)) return "linear";
      if (n >= 256) {
        let srgb = true, linear = true, previous = -1;
        for (let i = 0; i < n; i++) {
          const sample = view.getUint16(p+12+i*2)/65535, x = i/(n-1);
          if (sample < previous) reject("nonmonotonic sampled curve");
          previous = sample;
          srgb &&= Math.abs(sample-srgbLinear(x)) <= 2/65535;
          linear &&= Math.abs(sample-x) <= 2/65535;
        }
        if (srgb) return "iec61966-2-1";
        if (linear) return "linear";
      }
    }
    reject("unsupported tone curve");
  };
  if (grayscale) {
    if (["rXYZ","gXYZ","bXYZ","rTRC","gTRC","bTRC","cicp"].some(name => tags.has(name))) reject("conflicting grayscale tags");
    if (curve("kTRC") !== "linear") reject("unsupported grayscale data tone curve");
    // Auxiliary data previews represent the scalar sample, not display luminance.
    return {name: "Gray Linear", grayscale: true, transfer: "linear"};
  }
  const columns = ["rXYZ","gXYZ","bXYZ"].map(xyz);
  const space = SPACES.find(s => s.xyz.every((column,i)=>close(columns[i],column,s.tolerance))
    && (!adaptation || close(adaptation,s.adaptation || BRADFORD_D65_TO_D50,s.tolerance)));
  if (!space) reject("unsupported RGB primaries");
  const transfers = ["rTRC","gTRC","bTRC"].map(curve);
  if (!transfers.every(t=>t === transfers[0])) reject("different channel tone curves");
  const transfer = transfers[0];
  if (tags.has("cicp")) {
    const tag = tags.get("cicp"), p = tag.offset+8;
    if (tag.type !== "cicp" || tag.length !== 12 || bytes[p] !== space.code || bytes[p+1] !== (transfer === "linear" ? 8 : 13)
      || bytes[p+2] !== 0 || bytes[p+3] !== 1) reject("conflicting ICC color codes");
  }
  // ICC describes RGB primaries/TRCs, not the HEVC sample's YUV matrix/range.
  return {name: space.name + (transfer === "linear" ? " Linear" : ""), primaries: space.primaries, transfer};
}
