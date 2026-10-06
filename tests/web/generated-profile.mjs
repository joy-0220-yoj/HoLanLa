import './synthetic-fixtures.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {syntheticAssets} from './synthetic-fixtures.mjs';
import {buildGeneratedProfile, generatedProfileZip, generateStylesPlist} from '../../web/src/generated-profile.js';
import {loadProfile, readZip} from '../../web/src/zip.js';
import {discoverHeic, extractItem, extractItemData, propertyBoxBytes, dimensionsForItem, findItemsByType, auxUriForItem, MATTE_URIS,
  appendIpcoProperty, repointItemProperty, parseIpcoIpma, propertyForItem, itemOrientation, ispeBox} from '../../web/src/heif.js';
import {topBox} from '../../web/src/box.js';
import {MATTE_2026_URIS, URI_PERSON_INSTANCES} from '../../web/src/texture.js';
import {box} from '../../web/src/box.js';
import {parseBplist} from '../../web/src/bplist.js';
import {patch} from '../../web/src/port.js';
import {buildRasterHeic, targetGeometry} from '../../web/src/raster-import.js';
import {p3ToLinearI420P10} from '../../web/src/linear-thumbnail.js';

test('numeric schemas and ZIP graphs are generated without donor fetches', async () => {
  const oldFetch = globalThis.fetch; globalThis.fetch = () => {throw Error('Unexpected donor fetch');};
  try {
    let samples = 0;
    for (const name of ['45-15','48-12']) {
      const profile = buildGeneratedProfile(name, syntheticAssets), zip = generatedProfileZip(profile);
      const files = await readZip(zip), restored = await loadProfile(zip), d = discoverHeic(restored.meta);
      assert.deepEqual(restored.meta, profile.meta); assert.deepEqual(restored.mn54, profile.mn54);
      const rawProperties=d.props.properties.map(p=>Buffer.from(profile.meta.subarray(p.box.off,p.box.off+p.box.size)).toString('hex'));
      assert.equal(new Set(rawProperties).size,rawProperties.length,'equal property boxes share one index');
      assert.equal(new Set([...d.props.associations.values()].flat().map(a=>a.index)).size,rawProperties.length,'every stored property is referenced');
      assert.equal(d.primaryTiles.length, name === '45-15' ? 45 : 48);
      assert.equal(d.hdrTiles.length, name === '45-15' ? 15 : 12);
      assert.equal(d.deltaTiles.length, name === '45-15' ? 48 : 30);
      assert.ok(d.refs.every(ref => d.infos.has(ref.from) && ref.to.every(id => d.infos.has(id))));
      assert.ok(d.props.properties.every(prop => !['prof','rICC'].includes(String.fromCharCode(...profile.meta.subarray(prop.box.off+8,prop.box.off+12)))));
      samples += [...profile.retained.keys()].filter(id => d.infos.get(id).type === 'hvc1').length;
      assert.equal(files.size, profile.retained.size + 4);
      for (const id of d.deltaTiles) assert.deepEqual(profile.retained.get(id), syntheticAssets.delta.payload);
      for (const id of [d.deltaGrid, ...d.deltaTiles])
        assert.deepEqual([...propertyBoxBytes(profile.meta, d.props, id, 'colr').slice(12)],
          [0,12,0,8,0,1,0], 'style delta metadata is P3-linear, matching its encoded pixels');
    }
    assert.equal(samples, 84);
    const pl = parseBplist(generateStylesPlist()), coefficients = new DataView(pl.get('1').buffer, pl.get('1').byteOffset, pl.get('1').byteLength);
    assert.equal(pl.get('1').length, 51840); assert.equal(pl.get('3').length, 516);
    for (let row = 0; row < 864; row++) for (let i = 0; i < 30; i++)
      assert.equal(coefficients.getUint16((row * 30+i)*2,true), [3,7,11].includes(i) ? 0x3c00 : 0);
  } finally {globalThis.fetch = oldFetch;}
});

test('10-bit conversion retains precision and uses limited-range linear values', () => {
  const rgba = value => Float32Array.from({length:16}, (_,i) => i%4===3 ? 1 : value);
  assert.deepEqual([...p3ToLinearI420P10(rgba(0),2,2,true)], [64,64,64,64,512,512]);
  assert.deepEqual([...p3ToLinearI420P10(rgba(1),2,2,true)], [940,940,940,940,512,512]);
  assert.notDeepEqual(p3ToLinearI420P10(rgba(.5),2,2,true), p3ToLinearI420P10(rgba(.502),2,2,true));
});

test('repointing across index 127 preserves indexes, essential flags and unrelated items', () => {
  let {meta} = buildGeneratedProfile('45-15', syntheticAssets);
  const before = discoverHeic(meta), id = before.linearThumb;
  const orientation = itemOrientation(meta,before.props,id);
  const original = before.props.associations.get(id);
  const oldIndex = propertyForItem(before.props, id, 'ispe').index;
  while (parseIpcoIpma(meta, topBox(meta, 'meta')).properties.length < 126)
    [meta] = appendIpcoProperty(meta, ispeBox(2,2));
  let currentIndex = oldIndex;
  for (const expectedIndex of [127,128,129,130]) {
    let index; [meta,index] = appendIpcoProperty(meta, ispeBox(expectedIndex*2,512));
    assert.equal(index,expectedIndex);
    meta = repointItemProperty(meta,id,currentIndex,index);
    const after = discoverHeic(meta);
    assert.equal(after.props.flags & 1, expectedIndex >= 128 ? 1 : 0);
    assert.deepEqual(after.props.associations.get(id),original.map(a=>({...a,index:a.index===oldIndex?index:a.index})));
    for (const [other,associations] of before.props.associations)
      if(other!==id)assert.deepEqual(after.props.associations.get(other),associations);
    assert.deepEqual(dimensionsForItem(after.props,id),[expectedIndex*2,512]);
    assert.deepEqual(itemOrientation(meta,after.props,id),orientation);
    currentIndex=index;
  }
});

test('face and instance masks retain an independent linear thumbnail after property compaction', async t => {
  const filename='IMG_0582_未處理_標準.heic';
  if(!fs.existsSync(filename)){t.skip('Local 42/15 portrait source photo is optional');return;}
  const input = new Uint8Array(fs.readFileSync(filename));
  const profile = buildGeneratedProfile('45-15',syntheticAssets);
  const mask={...syntheticAssets.mask,pixi:box('pixi',new Uint8Array([0,0,0,0,1,8]))};
  const overrides=new Map(MATTE_2026_URIS.map(uri=>[uri,mask]));
  overrides.set(URI_PERSON_INSTANCES,{instances:[{...mask,referenceKey:'instance-1'},{...mask,referenceKey:'instance-2'}]});
  const lt={...syntheticAssets.delta,pixi:box('pixi',new Uint8Array([0,0,0,0,3,10,10,10]))};
  const {data,report}=await patch(input,profile,{generic:true,sceneStats:'donor',matteOverrides:overrides,
    syntheticThumbnail:syntheticAssets.delta,linearThumbnail:lt});
  const d=discoverHeic(data);
  assert.equal(d.props.properties.length,report.propertyCompaction.after);
  assert.ok(report.propertyCompaction.before>report.propertyCompaction.after);
  assert.equal(new Set(d.props.properties.map(p=>Buffer.from(data.subarray(p.box.off,p.box.off+p.box.size)).toString('hex'))).size,d.props.properties.length);
  assert.equal(new Set([...d.props.associations.values()].flat().map(a=>a.index)).size,d.props.properties.length);
  assert.deepEqual(dimensionsForItem(d.props,d.linearThumb),[lt.width,lt.height]);
  for(const [type,value] of [['hvcC',lt.hvcc],['pixi',lt.pixi],['colr',lt.colr]])
    assert.deepEqual(propertyBoxBytes(data,d.props,d.linearThumb,type),value);
  assert.deepEqual(extractItemData(data,d,d.linearThumb),lt.payload);
  assert.deepEqual(itemOrientation(data,d.props,d.linearThumb),itemOrientation(data,d.props,d.primary));
  assert.equal(report.linearThumbConsistency.checked,true);
});

test('generated style field names and identity data conform to the documented schema', () => {
  const reference = JSON.parse(fs.readFileSync(new URL('./styles-schema.fixture.json', import.meta.url)));
  const generated = parseBplist(generateStylesPlist());
  assert.deepEqual([...generated.keys()].sort(), reference.root);
  for (const key of ['6','7','i']) assert.deepEqual([...generated.get(key).keys()].sort(), reference.nested[key]);
  for (const block of generated.get('6').values()) assert.deepEqual([...block.keys()].sort(), reference.block);
  for (const [key, checksum] of Object.entries(reference.identitySha256))
    assert.equal(createHash('sha256').update(generated.get(key)).digest('hex'), checksum);
  for (const name of ['45-15','48-12'])
    assert.equal(buildGeneratedProfile(name, syntheticAssets).manifest.apple_photos_style_rendering,
      'experimental-unvalidated', 'field conformance and identity checksums do not certify Photos rendering');
});

test('generated profile can graft real source images while retaining their bytes and properties', async t => {
  if (!fs.existsSync('IMG_3301.HEIC')) {t.skip('Local source photo is optional');return;}
  const profile = buildGeneratedProfile('48-12', syntheticAssets);
  for (const file of ['IMG_3301.HEIC','IMG_3302.HEIC','IMG_3303.HEIC']) {
    const input = new Uint8Array(fs.readFileSync(file)), before = discoverHeic(input);
    const result = await patch(input, profile, {sceneStats:'donor', texture:false});
    const after = discoverHeic(result.data);
    before.primaryTiles.forEach((id,i) => assert.deepEqual(extractItem(input,before.iloc,id), extractItem(result.data,after.iloc,after.primaryTiles[i])));
    assert.equal(result.report.sourceConsistency.checked,true);
    for (const [id] of before.infos) {
      const uri = auxUriForItem(before.props, id);
      if (!Object.values(MATTE_URIS).includes(uri)) continue;
      const outId = [...after.infos.keys()].find(i => auxUriForItem(after.props, i) === uri);
      assert.notEqual(outId, undefined);
      assert.deepEqual(extractItemData(input,before,id), extractItemData(result.data,after,outId));
      for (const type of ['ispe','pixi','hvcC','colr','auxC','irot','imir'])
        assert.deepEqual(propertyBoxBytes(input,before.props,id,type), propertyBoxBytes(result.data,after.props,outId,type));
    }
    const sourceTmap = findItemsByType(before.infos, 'tmap')[0], outputTmap = findItemsByType(after.infos, 'tmap')[0];
    if (sourceTmap !== undefined) {
      assert.notEqual(outputTmap, undefined);
      assert.deepEqual(extractItemData(input, before, sourceTmap), extractItemData(result.data, after, outputTmap));
      assert.equal(result.report.tmapMetadata, 'target-preserved');
    }
    assert.ok(after.deltaTiles.every(id => Buffer.from(extractItem(result.data,after.iloc,id)).equals(Buffer.from(syntheticAssets.delta.payload))));
    for (const id of [after.deltaGrid, ...after.deltaTiles])
      assert.deepEqual([...propertyBoxBytes(result.data, after.props, id, 'colr').slice(12)], [0,12,0,8,0,1,0]);
  }
});

test('raster generation removes masks by URI and retains delta tiles with independent 10-bit properties', () => {
  const profile=buildGeneratedProfile('48-12',syntheticAssets), geometry=targetGeometry({width:1290,height:2796});
  const lt={...syntheticAssets.delta,width:512,height:512,pixi:box('pixi',new Uint8Array([0,0,0,0,3,10,10,10])),colr:syntheticAssets.mask.colr};
  const result=buildRasterHeic(profile,{main:Array(geometry.primaryTiles).fill(syntheticAssets.delta.payload),mainHvcc:syntheticAssets.delta.hvcc,
    thumb:syntheticAssets.mask.payload,thumbHvcc:syntheticAssets.mask.hvcc,hdr:syntheticAssets.textureMask.payload,hdrHvcc:syntheticAssets.textureMask.hvcc,linearThumbnail:lt},null,null,geometry);
  const d=discoverHeic(result);
  assert.equal(d.deltaTiles.length,geometry.deltaColumns*geometry.deltaRows);
  assert.deepEqual([...propertyBoxBytes(result,d.props,d.linearThumb,'pixi').slice(-3)],[10,10,10]);
  assert.deepEqual(dimensionsForItem(d.props,d.linearThumb),[512,512]);
  for(const [ids,hvcc] of [[d.primaryTiles,syntheticAssets.delta.hvcc],[[d.thumbnail],syntheticAssets.mask.hvcc],
    [d.hdrTiles,syntheticAssets.textureMask.hvcc],[d.deltaTiles,syntheticAssets.delta.hvcc]])
    for(const id of ids)assert.deepEqual(propertyBoxBytes(result,d.props,id,'hvcC'),hvcc,'changing a shared codec description affects only the intended image group');
});
