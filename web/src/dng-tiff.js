// DNG identification and compact Exif extraction. Never embed the RAW/preview payloads in Exif.
import {concat, be} from './box.js?v=0.8.0';
import {TIFF_TYPE_SIZES} from './heif.js?v=0.8.0';

export function dngReader(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const order = String.fromCharCode(bytes[0], bytes[1]), little = order === 'II';
  if (!['II', 'MM'].includes(order) || bytes.length < 8 || view.getUint16(2, little) !== 42)
    throw Error('DNG decode failed: invalid TIFF header');
  const u16 = off => view.getUint16(off, little), u32 = off => view.getUint32(off, little);
  const ifd = off => {
    if (!Number.isSafeInteger(off) || off < 8 || off + 2 > bytes.length) throw Error('DNG decode failed: invalid IFD offset');
    const count = u16(off), end = off + 2 + count * 12;
    if (end + 4 > bytes.length) throw Error('DNG decode failed: truncated IFD');
    const entries = new Map();
    for (let p = off + 2; p < end; p += 12) {
      const tag = u16(p), type = u16(p + 2), count = u32(p + 4);
      const size = (TIFF_TYPE_SIZES[type] || (type === 13 ? 4 : 0)) * count;
      if (!size || !Number.isSafeInteger(size)) continue;
      const value = size <= 4 ? p + 8 : u32(p + 8);
      if (value + size > bytes.length) throw Error('DNG decode failed: invalid TIFF value');
      if (entries.has(tag)) throw Error('DNG decode failed: duplicate TIFF tag');
      entries.set(tag, {tag, type, count, data: bytes.subarray(value, value + size)});
    }
    return {entries, next: u32(end)};
  };
  const numbers = entry => {
    if (!entry || ![3, 4, 13].includes(entry.type)) return [];
    if (entry.count > 65536) throw Error('DNG decode failed: oversized TIFF number list');
    const v = new DataView(entry.data.buffer, entry.data.byteOffset, entry.data.byteLength);
    return Array.from({length: entry.count}, (_, i) => entry.type === 3 ? v.getUint16(i * 2, little) : v.getUint32(i * 4, little));
  };
  return {little, ifd, numbers, rootOffset: u32(4)};
}

const reader = dngReader;

export function findDngRaw(bytes) {
  const r = reader(bytes), queue = [r.rootOffset], seen = new Set();
  while (queue.length) {
    const off = queue.shift();
    if (!off || seen.has(off)) continue;
    if (seen.size >= 64) throw Error('DNG decode failed: too many IFDs');
    seen.add(off);
    const table = r.ifd(off), tags = table.entries;
    if ([32803, 34892].includes(r.numbers(tags.get(262))[0]) && !(r.numbers(tags.get(254))[0] & 1))
      return {reader: r, tags, root: r.ifd(r.rootOffset).entries};
    const children = r.numbers(tags.get(330));
    if (children.length > 64) throw Error('DNG decode failed: oversized IFD pointer list');
    queue.push(table.next, ...children);
  }
  throw Error('DNG decode failed: missing RAW image');
}

export function isDng(bytes) {
  try {
    const r = reader(bytes), version = r.ifd(r.rootOffset).entries.get(50706);
    return version?.type === 1 && version.count === 4 && version.data[0] === 1;
  } catch { return false; }
}

export function inspectDng(bytes) {
  const r = reader(bytes), root = r.ifd(r.rootOffset);
  const version = root.entries.get(50706);
  if (version?.type !== 1 || version.count !== 4 || version.data[0] !== 1)
    throw Error('DNG decode failed: missing DNGVersion');
  const queue = [r.rootOffset], seen = new Set(), compressions = new Set();
  while (queue.length) {
    const off = queue.shift();
    if (!off || seen.has(off)) continue;
    if (seen.size >= 64) throw Error('DNG decode failed: too many IFDs');
    seen.add(off);
    const table = r.ifd(off), tags = table.entries;
    // TIFF previews can have their own compression. Only reject JPEG XL on full-resolution RAW IFDs.
    const photometric = r.numbers(tags.get(262))[0], subfile = r.numbers(tags.get(254))[0] || 0;
    if ([32803, 34892].includes(photometric) && !(subfile & 1))
      compressions.add(r.numbers(tags.get(259))[0] || 1);
    const children = r.numbers(tags.get(330));
    if (children.length > 64) throw Error('DNG decode failed: oversized IFD pointer list');
    queue.push(table.next, ...children);
  }
  return {version: [...version.data].join('.'), compressions: [...compressions]};
}

export function extractDngExif(bytes) {
  const r = reader(bytes), root = r.ifd(r.rootOffset).entries;
  const rootTags = new Set([270, 271, 272, 274, 282, 283, 296, 305, 306, 315, 33432]);
  const tables = [new Map([...root].filter(([tag]) => rootTags.has(tag))), new Map(), new Map()];
  for (const [index, pointer] of [[1, 0x8769], [2, 0x8825]]) {
    const off = r.numbers(root.get(pointer))[0];
    if (!off) continue;
    for (const [tag, entry] of r.ifd(off).entries) {
      // MakerNote / Interoperability offsets can refer to the original file. Rebuild Apple's marker later.
      if ([0x927c, 0xa005, 0xa500].includes(tag) || entry.type === 13) continue;
      tables[index].set(tag, entry);
    }
  }
  const write = (value, n) => r.little ? be(value, n).reverse() : be(value, n);
  // The developed pixels are sRGB, regardless of the source RAW's colour-space tag.
  tables[1].set(0xa001, {tag: 0xa001, type: 3, count: 1, data: write(1, 2)});
  const pointer = (tag, value) => ({tag, type: 4, count: 1, data: write(value, 4)});
  for (const [index, tag] of [[1, 0x8769], [2, 0x8825]])
    if (tables[index].size) tables[0].set(tag, pointer(tag, 0));
  let cursor = 8;
  const offsets = tables.map(table => {const off = cursor; cursor += 6 + table.size * 12; return off;});
  for (const [index, tag] of [[1, 0x8769], [2, 0x8825]])
    if (tables[index].size) tables[0].set(tag, pointer(tag, offsets[index]));
  const chunks = [], values = [];
  for (const table of tables) {
    chunks.push(write(table.size, 2));
    for (const [tag, entry] of [...table].sort(([a], [b]) => a - b)) {
      if (entry.data.length > 1024 * 1024 || cursor + entry.data.length > 1024 * 1024)
        throw Error('DNG decode failed: oversized metadata');
      let field;
      if (entry.data.length <= 4) {field = new Uint8Array(4); field.set(entry.data);}
      else {
        if (cursor & 1) {values.push(new Uint8Array(1)); cursor++;}
        field = write(cursor, 4); values.push(entry.data); cursor += entry.data.length;
      }
      chunks.push(write(tag, 2), write(entry.type, 2), write(entry.count, 4), field);
    }
    chunks.push(write(0, 4));
  }
  const header = concat([bytes.subarray(0, 4), write(8, 4)]);
  return concat([be(6, 4), new TextEncoder().encode('Exif\0\0'), header, ...chunks, ...values]);
}
