// Bounded-memory LinearRaw decoding: each JPEG tile becomes a small DNG for LibRaw.
// Camera colour calibration and white balance are retained; previews are never used.
import {findDngRaw} from './dng-tiff.js?v=0.8.0';
import {TIFF_TYPE_SIZES} from './heif.js?v=0.8.0';

export const DNG_MAX_PIXELS = 12_000_000;
const colourTags = new Set([271, 272, 50706, 50707, 50708, 50710, 50712, 50713, 50714,
  50717, 50721, 50722, 50723, 50724, 50725, 50726, 50727, 50728, 50729, 50730,
  50731, 50732, 50734, 50735, 50736, 50738, 50740, 50778, 50779, 50964, 50965]);

function tileFile(r, metadata, data, width, height, bits, compression) {
  const tags = new Map(metadata), le = r.little;
  const value = (tag, type, values) => {
    const size = TIFF_TYPE_SIZES[type], bytes = new Uint8Array(size * values.length), view = new DataView(bytes.buffer);
    values.forEach((n, i) => type === 3 ? view.setUint16(i * size, n, le) : view.setUint32(i * size, n, le));
    tags.set(tag, {tag, type, count: values.length, data: bytes});
  };
  value(254, 4, [0]); value(256, 4, [width]); value(257, 4, [height]);
  value(258, 3, bits); value(259, 3, [compression]); value(262, 3, [34892]);
  value(273, 4, [0]); value(274, 3, [1]); value(277, 3, [3]); value(278, 4, [height]);
  value(279, 4, [data.length]); value(284, 3, [1]);
  let end = 8 + 6 + tags.size * 12;
  for (const entry of tags.values()) if (entry.data.length > 4) end += (entry.data.length + 1) & ~1;
  if (end > 1024 * 1024) throw Error('DNG decode failed: oversized tile metadata');
  value(273, 4, [end]);
  const out = new Uint8Array(end + data.length), v = new DataView(out.buffer);
  out.set(le ? [73,73,42,0] : [77,77,0,42]); v.setUint32(4, 8, le); v.setUint16(8, tags.size, le);
  let p = 10, cursor = 8 + 6 + tags.size * 12;
  for (const [tag, entry] of [...tags].sort(([a], [b]) => a - b)) {
    v.setUint16(p, tag, le); v.setUint16(p + 2, entry.type, le); v.setUint32(p + 4, entry.count, le);
    if (entry.data.length <= 4) out.set(entry.data, p + 8);
    else {v.setUint32(p + 8, cursor, le); out.set(entry.data, cursor); cursor += (entry.data.length + 1) & ~1;}
    p += 12;
  }
  out.set(data, end);
  return out;
}

export function dngTilePlan(bytes, maxPixels = DNG_MAX_PIXELS) {
  if (!Number.isFinite(maxPixels) || maxPixels < 1 || maxPixels > 100_000_000)
    throw Error('DNG decode failed: invalid pixel limit');
  const {reader: r, tags, root} = findDngRaw(bytes), number = tag => r.numbers(tags.get(tag));
  const width = number(256)[0], height = number(257)[0];
  if (!width || !height || !Number.isSafeInteger(width * height)) throw Error('DNG decode failed: invalid RAW dimensions');
  if (width * height <= maxPixels) return null;
  // Large unsupported layouts fail before LibRaw can allocate the full RAW frame.
  const fail = () => {throw Error('DNG decode failed: large RAW requires uncropped tiled RGB LinearRaw with lossless JPEG or uncompressed tiles');};
  const compression = number(259)[0] || 1, bits = number(258);
  const tileWidth = number(322)[0], tileHeight = number(323)[0];
  if (number(262)[0] !== 34892 || number(277)[0] !== 3 || (number(284)[0] || 1) !== 1
    || ![1,7].includes(compression) || bits.length !== 3 || bits.some(n => n !== bits[0] || n < 8 || n > 16)
    || (number(266)[0] || 1) !== 1 || (number(317)[0] || 1) !== 1 || number(339).some(n => n !== 1)
    || !tileWidth || !tileHeight || tileWidth * tileHeight > 4 * 1024 * 1024) fail();
  // Per-row/column black corrections and non-full active areas require spatial metadata handling.
  if (tags.has(50715) || tags.has(50716) || number(50713).some(n => n !== 1)) fail();
  const active = number(50829);
  if (active.length && (active.length !== 4 || active.some((n,i) => n !== [0,0,height,width][i]))) fail();
  const spatial = tag => {
    const entry = tags.get(tag) || root.get(tag);
    if (!entry) return [];
    if ([3,4].includes(entry.type)) return r.numbers(entry);
    if (entry.type !== 5 || entry.count > 4) fail();
    const v = new DataView(entry.data.buffer, entry.data.byteOffset, entry.data.byteLength);
    return Array.from({length: entry.count}, (_, i) => v.getUint32(i * 8, r.little) / v.getUint32(i * 8 + 4, r.little));
  };
  for (const [tag, expected] of [[50718,[1,1]], [50719,[0,0]], [50720,[width,height]]]) {
    const values = spatial(tag);
    if (values.length && (values.length !== 2 || values.some((n,i) => n !== expected[i]))) fail();
  }
  const offsets = number(324), lengths = number(325), cols = Math.ceil(width / tileWidth), rows = Math.ceil(height / tileHeight);
  if (offsets.length !== cols * rows || lengths.length !== offsets.length || offsets.length > 4096) fail();
  for (let i = 0; i < offsets.length; i++)
    if (!lengths[i] || offsets[i] < 8 || offsets[i] + lengths[i] > bytes.length) throw Error('DNG decode failed: invalid RAW tile');
  const metadata = new Map([...root, ...tags].filter(([tag]) => colourTags.has(tag)));
  // Never apply tile-specific automatic exposure: every tile uses the same source calibration.
  const scale = Math.sqrt(maxPixels / (width * height));
  const outputWidth = Math.max(1, Math.floor(width * scale)), outputHeight = Math.max(1, Math.floor(height * scale));
  return {width, height, outputWidth, outputHeight, count: offsets.length,
    orientation: r.numbers(root.get(274))[0] || number(274)[0] || 1,
    *tiles() {
      for (let i = 0; i < offsets.length; i++) {
        const x = (i % cols) * tileWidth, y = Math.floor(i / cols) * tileHeight;
        yield {x, y, width: Math.min(tileWidth, width - x), height: Math.min(tileHeight, height - y),
          bytes: tileFile(r, metadata, bytes.subarray(offsets[i], offsets[i] + lengths[i]), tileWidth, tileHeight, bits, compression)};
      }
    },
  };
}
