// Construct a fresh profile graph and every retained asset from readable fields.
// This module never fetches a donor ZIP, donor photo or opaque ICC/private blob.
import {box, be, concat, bytesEqual} from './box.js?v=0.8.0';
import {buildBplist, BplistReal} from './bplist.js?v=0.8.0';
import {auxcBox, ispeBox, URI_HDR_GAIN, URI_LINEAR_THUMB, URI_STYLE_DELTA, URI_STYLES, MATTE_URIS} from './heif.js?v=0.8.0';
import {packFloat16LE, statsBlock} from './styles.js?v=0.8.0';
import {generateSyntheticHevc} from './synthetic-hevc.js?v=0.8.0';
import {identityToneCurve} from './texture.js?v=0.8.0';
import {writeZip} from './zip.js?v=0.8.0';

export const GENERATED_PROFILE_INDEX = Object.freeze({
  '45-15': {primary_tiles: 45, hdr_tiles: 15},
  '48-12': {primary_tiles: 48, hdr_tiles: 12},
});
const text = s => new TextEncoder().encode(s);
const cstring = s => concat([text(s), new Uint8Array(1)]);
const full = (type, parts, version = 0, flags = 0) => box(type, concat([new Uint8Array([version]), be(flags, 3), ...parts]));
const pixi = (depth = 10, channels = 3) => full('pixi', [new Uint8Array([channels, ...Array(channels).fill(depth)])]);
export const nclx = (primaries = 1, transfer = 1, matrix = 1, fullRange = false) =>
  box('colr', concat([text('nclx'), be(primaries, 2), be(transfer, 2), be(matrix, 2), new Uint8Array([fullRange ? 128 : 0])]));
const grid = (width, height, columns, rows) => concat([new Uint8Array([0, 0, rows - 1, columns - 1]), be(width, 2), be(height, 2)]);

export function generateStylesPlist() {
  const coefficients = new Array(864 * 30).fill(0);
  // Inferred polynomial terms [1,R,G,B,R²,G²,B²,RG,RB,GB], RGB outputs.
  for (let i = 0; i < 864; i++) for (const component of [3, 7, 11]) coefficients[i * 30 + component] = 1;
  // Match the named blocks actually observed in the archived, parsed style schema.
  // Their presence does not establish Apple Photos rendering compatibility.
  const names = ['ToneMappedImage', 'LinearImage', 'ToneMappedImagePersonSegmentBased',
    'LinearImagePersonSegmentBased', 'ToneMappedImageSkinBased', 'LinearImageSkinBased',
    'ToneMappedImageRedChannelSkinBased', 'ToneMappedImageGreenChannelSkinBased',
    'ToneMappedImageBlueChannelSkinBased', 'LinearGTCImage'];
  const real = value => new BplistReal(value);
  const scene = new Map(names.map(name => [name, new Map([...statsBlock([0], name === 'LinearGTCImage' ? 0 : 1)]
    .map(([k, v]) => [k, real(v)]))]));
  return buildBplist(new Map([
    ['0', 14], ['1', packFloat16LE(coefficients)], ['2', true], ['3', identityToneCurve()],
    ['4', real(4)], ['5', 0], ['6', scene],
    ['7', new Map([['PeopleRatio', real(0)], ['SkinRatio', real(0)], ['PersonMasksValidHint', real(0)]])],
    ['c', packFloat16LE(new Array(1024).fill(0.3115234375))],
    ['d', packFloat16LE(new Array(1024).fill(0.200927734375))], ['e', 32], ['f', 32],
    ['g', 1278226536], ['h', real(3.64)],
    // These defaults are experimental. The gain/range relationship to the source HDR
    // and linear thumbnail has not been calibrated against Apple's style renderer.
    ['i', new Map([['OriginalRangeMin', real(0)], ['OriginalRangeMax', real(1)], ['Gain', real(1)]])], ['j', real(1)],
  ]));
}
export function generateMakerPlist() {
  const real = value => new BplistReal(value);
  return buildBplist(new Map([['0', 1], ['1', real(0)], ['2', real(0)], ['3', real(1)], ['4', 1], ['5', 1], ['6', 4], ['7', 0]]));
}
export function generateMatteXmp() {
  return text('<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    + '<rdf:Description rdf:about="" xmlns:semanticSegmentationMatte="http://ns.apple.com/semanticSegmentationMatte/1.0/">'
    + '<semanticSegmentationMatte:SemanticSegmentationMatteVersion>65536</semanticSegmentationMatte:SemanticSegmentationMatteVersion>'
    + '</rdf:Description></rdf:RDF></x:xmpmeta>');
}

export function buildGeneratedProfile(name, {delta, mask}) {
  const config = GENERATED_PROFILE_INDEX[name]; if (!config) throw Error('Unknown generated profile');
  const items = [], properties = [], refs = [], retained = new Map(), idat = [];
  let nextId = 0, idatLength = 0;
  const property = value => {
    const existing = properties.findIndex(p => bytesEqual(p,value));
    if (existing !== -1) return existing + 1;
    properties.push(value); return properties.length;
  };
  const orientation = property(box('irot', new Uint8Array([3])));
  function item(type, assoc = [], payload = null, internal = false, content = null) {
    const id = ++nextId;
    items.push({id, type, assoc, content, internal, offset: internal ? idatLength : 0, length: payload?.length || 0});
    if (internal) { idat.push(payload); idatLength += payload.length; }
    else if (payload) retained.set(id, payload);
    return id;
  }
  const ref = (type, from, to) => refs.push(box(type, concat([be(from, 2), be(to.length, 2), ...to.map(id => be(id, 2))])));
  function imageProps(width, height, hvcc = delta.hvcc, depth = 10, channels = 3, uri = null, orient = true) {
    const assoc = [[property(ispeBox(width, height)), false], [property(pixi(depth, channels)), false],
      [property(channels === 1 ? nclx(1, 1, 1, true) : delta.colr), false]];
    if (uri) assoc.push([property(auxcBox(uri)), true]);
    assoc.push([property(hvcc), true]);
    if (orient) assoc.push([orientation, false]);
    return assoc;
  }
  function imageGrid(count, columns, rows, width, height, uri = null) {
    const assoc = [[property(ispeBox(width, height)), false], [property(pixi()), false], [property(delta.colr), false]];
    if (uri) assoc.push([property(auxcBox(uri)), true]);
    assoc.push([orientation, false]);
    const id = item('grid', assoc, grid(width, height, columns, rows), true);
    const tileProps = imageProps(512, 512, delta.hvcc, 10, 3, null, false);
    const tiles = Array.from({length: count}, () => item('hvc1', tileProps)); ref('dimg', id, tiles);
    return {id, tiles};
  }
  const primary = imageGrid(config.primary_tiles, name === '45-15' ? 5 : 6, name === '45-15' ? 9 : 8, 2560, 4032);
  const hdr = imageGrid(config.hdr_tiles, 3, name === '45-15' ? 5 : 4, 1280, 2016, URI_HDR_GAIN); ref('auxl', hdr.id, [primary.id]);
  const thumb = item('hvc1', imageProps(416, 312)); ref('thmb', thumb, [primary.id]);
  const exif = item('Exif'); ref('cdsc', exif, [primary.id]);
  const ltProps = imageProps(416, 312, delta.hvcc, 10, 3, URI_LINEAR_THUMB);
  const linear = item('hvc1', ltProps); ref('auxl', linear, [primary.id]);
  const deltaGrid = imageGrid(name === '45-15' ? 48 : 30, name === '45-15' ? 8 : 6,
    name === '45-15' ? 6 : 5, name === '45-15' ? 4032 : 2880, name === '45-15' ? 3024 : 2160, URI_STYLE_DELTA);
  deltaGrid.tiles.forEach(id => retained.set(id, delta.payload)); ref('auxl', deltaGrid.id, [primary.id]);
  const styles = item('uri ', [], generateStylesPlist(), false, URI_STYLES); ref('cdsc', styles, [primary.id]);
  const matteIds = [];
  for (const uri of [MATTE_URIS.portraiteffectsmatte, MATTE_URIS.semanticskinmatte, MATTE_URIS.semanticskymatte]) {
    const id = item('hvc1', imageProps(mask.width, mask.height, mask.hvcc, 8, 1, uri), mask.payload);
    matteIds.push(id); ref('auxl', id, [primary.id]);
    const xmp = item('mime', [], generateMatteXmp(), false, 'application/rdf+xml'); ref('cdsc', xmp, [id]);
  }
  const iloc = full('iloc', [new Uint8Array([0x44, 0]), be(items.length, 2), ...items.map(i => concat([
    be(i.id, 2), be(i.internal ? 1 : 0, 2), be(0, 2), be(1, 2), be(i.offset, 4), be(retained.get(i.id)?.length || i.length, 4),
  ]))], 1);
  const iinf = full('iinf', [be(items.length, 2), ...items.map(i => full('infe', [be(i.id, 2), be(0, 2), text(i.type), cstring(''),
    ...(i.content ? [cstring(i.content)] : []), ...(i.type === 'mime' ? [cstring('')] : [])], 2, i.type === 'grid' && i.id === primary.id ? 0 : 1))]);
  const ipma = full('ipma', [be(items.length, 4), ...items.map(i => concat([be(i.id, 2), new Uint8Array([i.assoc.length]),
    new Uint8Array(i.assoc.map(([index, essential]) => index | (essential ? 128 : 0)))]))]);
  if (properties.length > 127) throw Error('Generated profile property capacity exceeded');
  const meta = full('meta', [full('hdlr', [be(0, 4), text('pict'), new Uint8Array(12), cstring('HoLanLa generated profile')]),
    full('pitm', [be(primary.id, 2)]), iloc, iinf, full('iref', refs), box('iprp', concat([box('ipco', concat(properties)), ipma])), box('idat', concat(idat))]);
  return {ftyp: box('ftyp', concat([text('heic'), be(0, 4), text('mif1heic')])) , meta, mn54: generateMakerPlist(), retained,
    manifest: {format: 'smartstyle-port-donor-profile', generated: true, generation: 'numeric-constants-and-readable-schema',
      apple_photos_style_rendering: 'experimental-unvalidated',
      primary_tile_count: config.primary_tiles, hdr_tile_count: config.hdr_tiles,
      donor_primary_item: primary.id, donor_primary_tiles: primary.tiles, donor_hdr_grid_item: hdr.id, donor_hdr_tiles: hdr.tiles,
      donor_thumbnail_item: thumb, donor_exif_item: exif, donor_linear_thumb_item: linear,
      linear_thumb_hvcc_property_index: ltProps.find(([index]) => String.fromCharCode(...properties[index - 1].slice(4, 8)) === 'hvcC')[0],
      donor_delta_grid_item: deltaGrid.id, donor_delta_tiles: deltaGrid.tiles, donor_styles_item: styles,
      donor_matte_items: matteIds, smartstyle_makernote_type: 7, retained_external_items: [...retained.keys()]}};
}
export async function generateProfile(name, onProgress) {
  return buildGeneratedProfile(name, await generateSyntheticHevc(onProgress));
}

export function generatedProfileZip(profile) {
  const files = new Map([['manifest.json', text(JSON.stringify(profile.manifest, null, 2))],
    ['ftyp.bin', profile.ftyp], ['meta.bin', profile.meta], ['makernote_0x54.bin', profile.mn54]]);
  for (const [id, payload] of profile.retained) files.set(`payloads/${id}.bin`, payload);
  return writeZip(files);
}
