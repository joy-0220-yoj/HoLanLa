import {generatedProfileFixture} from './profile-fixtures.mjs';
import "./synthetic-fixtures.mjs";
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {be, concat} from '../../web/src/box.js';
import {extractRasterExif, extractAppleMakerNoteTag, getMakerNoteBlob, readExifOrientation,
  ensureAppleStyleExif, injectAppleMakerNoteTag} from '../../web/src/exif.js';
import {patch} from '../../web/src/port.js';
import {buildRasterExif, buildRasterHeic} from '../../web/src/raster-import.js';
import {discoverHeic, extractItemData, propertyBoxBytes, TIFF_TYPE_SIZES} from '../../web/src/heif.js';

function readExif(payload) {
  const start = new DataView(payload.buffer, payload.byteOffset).getUint32(0) + 4, tiff = payload.slice(start);
  const le = tiff[0] === 73, view = new DataView(tiff.buffer), u = (p, n) => n === 2 ? view.getUint16(p, le) : view.getUint32(p, le);
  function ifd(off) {
    const entries = new Map(), count = u(off, 2);
    for (let i = 0; i < count; i++) {
      const p = off + 2 + i * 12, tag = u(p, 2), type = u(p + 2, 2), n = u(p + 4, 4), size = TIFF_TYPE_SIZES[type] * n;
      const value = size <= 4 ? p + 8 : u(p + 8, 4);
      entries.set(tag, {type, count: n, raw: tiff.slice(p, p + 12), data: tiff.slice(value, value + size),
        value: type === 2 ? Buffer.from(tiff.slice(value, value + size)).toString().replace(/\0+$/, '') : type === 3 ? u(value, 2) : type === 4 ? u(value, 4) : null});
    }
    return entries;
  }
  const rootOff = u(4, 4), root = ifd(rootOff);
  return {tiff, le, root, exif: root.has(0x8769) ? ifd(root.get(0x8769).value) : new Map(),
    gps: root.has(0x8825) ? ifd(root.get(0x8825).value) : new Map(), next: u(rootOff + 2 + root.size * 12, 4)};
}
// A small synthetic camera/GPS fixture keeps this regression independent of private photos.
function cameraFixture() {
  const ascii = s => new TextEncoder().encode(s), le16 = n => be(n, 2).reverse(), le32 = n => be(n, 4).reverse();
  const parts = [ascii('II'), le16(42), new Uint8Array(4)]; let length = 8;
  const append = bytes => {if (length & 1) {parts.push(new Uint8Array(1)); length++;} const off = length; parts.push(bytes); length += bytes.length; return off;};
  const rational = values => concat(values.flatMap(([n, d]) => [le32(n), le32(d)]));
  const field = (tag, type, data) => ({tag, type, data});
  function table(fields) {
    const entries = fields.map(({tag, type, data}) => {
      const value = data.length > 4 ? le32(append(data)) : concat([data, new Uint8Array(4 - data.length)]);
      return concat([le16(tag), le16(type), le32(data.length / TIFF_TYPE_SIZES[type]), value]);
    });
    return append(concat([le16(entries.length), ...entries, new Uint8Array(4)]));
  }
  const exif = table([field(0x829a, 5, rational([[1, 360]])), field(0x829d, 5, rational([[49, 10]])),
    field(0x8827, 3, le16(1600)), field(0x9003, 2, ascii('2000:01:01 00:00:00\0')),
    field(0x9204, 10, rational([[0, 10]])), field(0x920a, 5, rational([[272, 10]]))]);
  const gps = table([field(1, 2, ascii('N\0')), field(2, 5, rational([[0, 1], [0, 1], [0, 1]])),
    field(3, 2, ascii('E\0')), field(4, 5, rational([[0, 1], [0, 1], [0, 1]])),
    field(5, 1, new Uint8Array([0])), field(6, 5, rational([[0, 1]]))]);
  const root = table([field(0x010f, 2, ascii('Example\0')), field(0x0110, 2, ascii('Test Camera\0')),
    field(0x0112, 3, le16(6)), field(0x0132, 2, ascii('2000:01:01 00:00:00\0')),
    field(0x8769, 4, le32(exif)), field(0x8825, 4, le32(gps))]);
  const tiff = concat(parts); tiff.set(le32(root), 4);
  return concat([be(6, 4), ascii('Exif\0\0'), tiff]);
}
const source = cameraFixture();
assert.ok(source, 'synthetic camera fixture contains EXIF');
const original = readExif(source);
assert.equal(original.root.get(0x010f).value, 'Example'); assert.equal(original.root.get(0x0110).value, 'Test Camera');
assert.equal(original.exif.get(0x8827).value, 1600); assert.ok(original.gps.has(2) && original.gps.has(4));
const originalBytes = source.slice();
const profile = await generatedProfileFixture('48-12'), donor = discoverHeic(profile.meta);
const fixture = cameraFixture(), fixtureOutput = readExif(buildRasterExif(profile.mn54, 7, fixture));
assert.deepEqual(fixtureOutput.gps, readExif(fixture).gps);
assert.deepEqual(fixtureOutput.exif.get(0x8827), readExif(fixture).exif.get(0x8827));
const geometry = {storedWidth: 3264, storedHeight: 1836};
const modified = buildRasterExif(profile.mn54, 7, source, geometry), result = readExif(modified);
assert.deepEqual(source, originalBytes, 'source metadata is not mutated');
assert.equal(result.le, original.le); assert.equal(readExifOrientation(modified), 6);
for (const tag of [0x010f, 0x0110, 0x0132, 0x8825]) assert.deepEqual(result.root.get(tag), original.root.get(tag));
for (const tag of [0x829a, 0x829d, 0x8827, 0x9003, 0x9204, 0x920a]) assert.deepEqual(result.exif.get(tag), original.exif.get(tag));
assert.deepEqual(result.gps, original.gps, 'all original GPS tags and exact values survive');
assert.equal(result.exif.get(0xa002).value, 3264); assert.equal(result.exif.get(0xa003).value, 1836);
assert.equal(result.next, 0, 'old TIFF thumbnail is detached from the new HEIF image');
assert.deepEqual(extractAppleMakerNoteTag(modified).payload, profile.mn54);
const output = buildRasterHeic(profile, {main: Array.from({length: 48}, () => new Uint8Array([1])),
  mainHvcc: propertyBoxBytes(profile.meta, donor.props, donor.primaryTiles[0], 'hvcC'),
  thumb: new Uint8Array([2]), thumbHvcc: propertyBoxBytes(profile.meta, donor.props, donor.thumbnail, 'hvcC'),
  hdr: new Uint8Array([3]), hdrHvcc: propertyBoxBytes(profile.meta, donor.props, donor.hdrTiles[0], 'hvcC'), sourceExif: source});
const d = discoverHeic(output), embedded = readExif(extractItemData(output, d, d.exifItem));
assert.deepEqual(embedded.gps, original.gps); assert.deepEqual(embedded.exif.get(0x8827), original.exif.get(0x8827));
assert.equal(embedded.root.get(0x0110).value, 'Test Camera');

// All supported raster containers converge on the same TIFF block.
const tiff = original.tiff, ascii = s => new TextEncoder().encode(s);
const app1 = concat([ascii('Exif\0\0'), tiff]);
const jpeg = concat([new Uint8Array([255, 216, 255, 225]), be(app1.length + 2, 2), app1, new Uint8Array([255, 217])]);
assert.deepEqual(extractRasterExif(jpeg), source);
const png = concat([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), be(tiff.length, 4), ascii('eXIf'), tiff, new Uint8Array(4)]);
assert.deepEqual(extractRasterExif(png), source);
for (const value of [tiff, app1]) {
  const chunk = concat([ascii('EXIF'), be(value.length, 4).reverse(), value, new Uint8Array(value.length & 1)]);
  const webp = concat([ascii('RIFF'), be(chunk.length + 4, 4).reverse(), ascii('WEBP'), chunk]);
  assert.deepEqual(extractRasterExif(webp), source);
}
assert.equal(extractRasterExif(new Uint8Array([255, 216, 255, 217])), null);
assert.throws(() => extractRasterExif(jpeg.slice(0, 20)), /metadata length/);
assert.throws(() => buildRasterExif(profile.mn54, 7, source.slice(0, 30)), /Exif/);

// Big endian, no ExifIFD, a missing Apple marker and non-Apple MakerNotes.
const make = ascii('Example Camera\0'), bareTiff = concat([ascii('MM'), be(42, 2), be(8, 4), be(1, 2),
  be(0x010f, 2), be(2, 2), be(make.length, 4), be(26, 4), new Uint8Array(4), make]);
const bare = concat([be(6, 4), ascii('Exif\0\0'), bareTiff]);
assert.equal(readExif(buildRasterExif(profile.mn54, 7, bare)).root.get(0x010f).value, 'Example Camera');
const apple = buildRasterExif(profile.mn54), appleRoundtrip = buildRasterExif(profile.mn54, 7, apple);
assert.deepEqual(extractAppleMakerNoteTag(appleRoundtrip).payload, profile.mn54);
const vendor = apple.slice(), mn = getMakerNoteBlob(vendor); mn.set(ascii('Vendor123'));
const vendorCopy = vendor.slice(), vendorOutput = buildRasterExif(profile.mn54, 7, vendor);
assert.deepEqual(vendor, vendorCopy); assert.deepEqual(extractAppleMakerNoteTag(vendorOutput).payload, profile.mn54);
assert.equal(Buffer.from(vendorOutput).includes(Buffer.from('Vendor123')), true, 'original proprietary bytes remain in the TIFF area');

// HEIC graft keeps source orientation/dimensions and every existing metadata value.
for (const orientation of [1, 3, 6, 8]) {
  const fixture = cameraFixture(), before = readExif(fixture);
  const view = new DataView(fixture.buffer), start = view.getUint32(0) + 4;
  const root = view.getUint32(start + 4, true);
  for (let i = 0; i < before.root.size; i++) {
    const pos = start + root + 2 + i * 12;
    if (view.getUint16(pos, true) === 0x0112) view.setUint16(pos + 8, orientation, true);
  }
  const original = fixture.slice(), sourceInfo = readExif(fixture);
  const added = ensureAppleStyleExif(fixture, profile.mn54), after = readExif(added);
  assert.deepEqual(fixture, original);
  assert.equal(readExifOrientation(added), orientation);
  for (const [tag, entry] of sourceInfo.root) if (tag !== 0x8769)
    assert.deepEqual(after.root.get(tag), entry);
  for (const [tag, entry] of sourceInfo.exif) assert.deepEqual(after.exif.get(tag), entry);
  assert.deepEqual(after.gps, sourceInfo.gps);
  assert.equal(after.exif.has(0xa002), false, 'graft must not invent new image dimensions');
  assert.deepEqual(extractAppleMakerNoteTag(added).payload, profile.mn54);
}
const bareAdded = ensureAppleStyleExif(bare, profile.mn54);
assert.equal(readExifOrientation(bareAdded), null, 'do not add raster Orientation=6 to a HEIC source');
assert.deepEqual(readExif(bareAdded).root.get(0x010f), readExif(bare).root.get(0x010f));
assert.deepEqual(ensureAppleStyleExif(apple, profile.mn54), injectAppleMakerNoteTag(apple, profile.mn54),
  'existing Apple MakerNotes keep the original injection behavior byte-for-byte');
assert.ok(Buffer.from(ensureAppleStyleExif(vendor, profile.mn54)).includes(Buffer.from('Vendor123')));
assert.throws(() => ensureAppleStyleExif(source.slice(0, 30), profile.mn54), /Exif/,
  'malformed Exif must not be silently discarded');

// Preserve an existing TIFF thumbnail chain when adding the missing MakerNote.
const chained = concat([bare, new Uint8Array(6)]), chainView = new DataView(chained.buffer);
const chainStart = chainView.getUint32(0) + 4, nextOffset = bare.length - chainStart;
chainView.setUint32(chainStart + 8 + 2 + 12, nextOffset);
assert.equal(readExif(ensureAppleStyleExif(chained, profile.mn54)).next, nextOffset);

// Exercise the full graft, with synthetic HEVC samples and no active MakerNote.
const noMakerHeic = output.slice(), exifBytes = extractItemData(noMakerHeic, d, d.exifItem).slice();
const exifView = new DataView(exifBytes.buffer), exifStart = exifView.getUint32(0) + 4;
const exifInfo = readExif(exifBytes), exifOffset = exifInfo.root.get(0x8769).value;
for (let i = 0; i < exifInfo.exif.size; i++) {
  const pos = exifStart + exifOffset + 2 + i * 12;
  if (exifView.getUint16(pos, exifInfo.le) === 0x927c) exifView.setUint16(pos, 0xc7ff, exifInfo.le);
}
assert.throws(() => getMakerNoteBlob(exifBytes), /0x927c/);
const exifItem = d.iloc.items.get(d.exifItem);
noMakerHeic.set(exifBytes, exifItem.baseOffset + exifItem.extents[0].offset);
const {data: grafted} = await patch(noMakerHeic, profile, {texture: false, sceneStats: 'donor', lightMaps: 'flat'});
const graftInfo = discoverHeic(grafted), graftExif = extractItemData(grafted, graftInfo, graftInfo.exifItem);
assert.deepEqual(extractAppleMakerNoteTag(graftExif).payload, profile.mn54);
assert.equal(readExifOrientation(graftExif), readExifOrientation(exifBytes));
assert.deepEqual(readExif(graftExif).gps, original.gps);
const sourceEntries = readExif(exifBytes), graftEntries = readExif(graftExif);
for (const [tag, entry] of sourceEntries.root) if (tag !== 0x8769)
  assert.deepEqual(graftEntries.root.get(tag), entry);
for (const [tag, entry] of sourceEntries.exif) assert.deepEqual(graftEntries.exif.get(tag), entry);
for (let i = 0; i < d.primaryTiles.length; i++) assert.deepEqual(
  extractItemData(grafted, graftInfo, graftInfo.primaryTiles[i]), extractItemData(noMakerHeic, d, d.primaryTiles[i]));
console.log('HEIC MakerNote fallback: source Exif, orientations, thumbnail chain and original HEVC tiles preserved; native Apple and malformed metadata regressions passed');
console.log('Synthetic camera fixture: exact camera/exposure/date/GPS preservation in HEIC; JPEG/PNG/WebP EXIF, both byte orders, MakerNotes, orientation and malformed metadata passed');
