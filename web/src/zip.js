// Minimal ZIP reader for the donor profile bundles. Stored and deflated entries
// only, which is all the profiles use. Inflate comes from DecompressionStream,
// available in browsers and Node 18+.

import { u, concat } from "./box.js?v=0.8.0";

// Deterministic stored ZIP writer for profiles generated in the browser.
export function writeZip(files) {
  const le = (value, length) => Uint8Array.from({length}, (_, i) => (value >>> (i * 8)) & 255);
  const crc32 = bytes => {
    let crc = 0xffffffff;
    for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
    return (crc ^ 0xffffffff) >>> 0;
  };
  const local = [], central = []; let offset = 0;
  for (const [name, bytes] of files) {
    const filename = new TextEncoder().encode(name), crc = crc32(bytes);
    const record = concat([le(0x04034b50, 4), le(20, 2), le(0x800, 2), le(0, 2), le(0, 2), le(33, 2),
      le(crc, 4), le(bytes.length, 4), le(bytes.length, 4), le(filename.length, 2), le(0, 2), filename, bytes]);
    central.push(concat([le(0x02014b50, 4), le(20, 2), le(20, 2), le(0x800, 2), le(0, 2), le(0, 2), le(33, 2),
      le(crc, 4), le(bytes.length, 4), le(bytes.length, 4), le(filename.length, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 2), le(0, 4), le(offset, 4), filename]));
    local.push(record); offset += record.length;
  }
  const directory = concat(central);
  return concat([...local, directory, le(0x06054b50, 4), le(0, 2), le(0, 2), le(files.size, 2), le(files.size, 2),
    le(directory.length, 4), le(offset, 4), le(0, 2)]);
}

const u16le = (d, p) => d[p] | (d[p + 1] << 8);
const u32le = (d, p) => (d[p] | (d[p + 1] << 8) | (d[p + 2] << 16)) + d[p + 3] * 0x1000000;

async function inflateRaw(bytes) {
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Read a ZIP into a Map of name -> Uint8Array. */
export async function readZip(bytes) {
  // Locate the end-of-central-directory record.
  let eocd = -1;
  for (let p = bytes.length - 22; p >= 0 && p > bytes.length - 65558; p--) {
    if (u32le(bytes, p) === 0x06054b50) { eocd = p; break; }
  }
  if (eocd < 0) throw new Error("Not a ZIP file");
  const count = u16le(bytes, eocd + 10);
  let p = u32le(bytes, eocd + 16);
  const out = new Map();
  for (let i = 0; i < count; i++) {
    if (u32le(bytes, p) !== 0x02014b50) throw new Error("Bad central directory");
    const method = u16le(bytes, p + 10);
    const compSize = u32le(bytes, p + 20);
    const nameLen = u16le(bytes, p + 28);
    const extraLen = u16le(bytes, p + 30);
    const commentLen = u16le(bytes, p + 32);
    const localOff = u32le(bytes, p + 42);
    let name = "";
    for (let c = 0; c < nameLen; c++) name += String.fromCharCode(bytes[p + 46 + c]);
    // Local header: recompute the data start, its extra field can differ.
    const lNameLen = u16le(bytes, localOff + 26);
    const lExtraLen = u16le(bytes, localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(dataStart, dataStart + compSize);
    out.set(name, method === 0 ? raw : await inflateRaw(raw));
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export async function loadProfile(zipBytes) {
  const files = await readZip(zipBytes);
  const manifest = JSON.parse(new TextDecoder().decode(files.get("manifest.json")));
  if (manifest.format !== "smartstyle-port-donor-profile")
    throw new Error("Not a donor profile");
  const retained = new Map();
  for (const iid of manifest.retained_external_items)
    retained.set(Number(iid), files.get(`payloads/${iid}.bin`));
  return {
    manifest,
    ftyp: files.get("ftyp.bin"),
    meta: files.get("meta.bin"),
    mn54: files.get("makernote_0x54.bin"),
    retained,
  };
}
