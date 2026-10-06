import test from 'node:test';
import assert from 'node:assert/strict';
import {dngFixture, tiledDngFixture, dngInspectionFixture} from './dng-fixture.mjs';
import {buildDngInspection,gainTableSlice,readDngGainTable} from '../../web/src/dng-inspection.js';
import {dngMatteUri,dngInspectionEntry} from '../../web/src/dng-mattes.js';
import {dngTilePlan} from '../../web/src/dng-tiles.js';
import {isDng, inspectDng, extractDngExif} from '../../web/src/dng-tiff.js';
import {readExifOrientation, preserveRasterExif, buildAppleStyleExif} from '../../web/src/exif.js';
import {decodeDng} from '../../web/src/dng-decode.js';
import {diagnosePortError} from '../../web/src/errors.js';

test('DNG detection validates TIFF tags in both byte orders; Exif excludes RAW samples', () => {
  for (const little of [true, false]) {
    const bytes = dngFixture({little}), original = bytes.slice();
    assert.equal(isDng(bytes), true); assert.deepEqual(inspectDng(bytes), {version:'1.4.0.0',compressions:[1]});
    const exif = extractDngExif(bytes);
    assert.ok(exif.length < 512); assert.equal(readExifOrientation(exif), 6);
    const out = preserveRasterExif(exif, buildAppleStyleExif(new Uint8Array([1,2,3,4])), {width:96,height:128});
    assert.equal(readExifOrientation(out), 6);
    assert.ok(Buffer.from(out).includes(Buffer.from('Test camera\0')));
    assert.ok(Buffer.from(out).includes(Buffer.from('2000:01:01 00:00:00\0')));
    const tiffView = new DataView(exif.buffer, exif.byteOffset + 10, exif.byteLength - 10);
    const table = offset => {
      const fields=new Map();
      for(let i=0;i<tiffView.getUint16(offset,little);i++){
        const p=offset+2+i*12;
        fields.set(tiffView.getUint16(p,little),p+8);
      }
      return fields;
    };
    const root = table(tiffView.getUint32(4,little));
    const exposure = table(tiffView.getUint32(root.get(0x8769),little));
    assert.equal(tiffView.getUint16(exposure.get(0x8827),little),100);
    assert.equal(tiffView.getUint16(exposure.get(0xa001),little),1);
    const gps = table(tiffView.getUint32(root.get(0x8825),little));
    assert.equal(tiffView.getUint8(gps.get(1)),78);
    assert.equal(tiffView.getUint32(tiffView.getUint32(gps.get(2),little)+4,little),1);
    assert.deepEqual(bytes, original);
    const tiff = bytes.slice(); tiff[2] = tiff[3] = 0;
    assert.equal(isDng(tiff), false); assert.equal(isDng(bytes.subarray(0, 200)), false);
    assert.equal(isDng(new Uint8Array()), false);
  }
});

test('large ProRAW tile plan retains calibration and bounds each LibRaw input in both byte orders', () => {
  for (const little of [false,true]) {
    const bytes = tiledDngFixture({little}), original = bytes.slice(), plan = dngTilePlan(bytes);
    assert.equal(plan.width * plan.height, 50_331_648);
    assert.ok(plan.outputWidth * plan.outputHeight <= 12_000_000);
    assert.equal(plan.orientation, 6); assert.equal(plan.count, 256);
    for (const tile of plan.tiles()) {
      assert.ok(tile.bytes.length < 100_000);
      assert.deepEqual(inspectDng(tile.bytes).compressions,[7]);
      assert.ok(Buffer.from(tile.bytes).includes(Buffer.from('Synthetic LinearRaw\0')));
    }
    assert.deepEqual(bytes, original);
  }
  assert.equal(dngTilePlan(dngFixture()), null);
  assert.throws(()=>dngTilePlan(dngFixture(),1000),/large RAW requires uncropped tiled/);
  const invalid = tiledDngFixture();
  assert.throws(()=>dngTilePlan(invalid.subarray(0,invalid.length-100)),/invalid RAW tile/);
});

test('JPEG XL DNG is rejected explicitly before any runtime download, rather than using its preview', async () => {
  const bytes = dngFixture({compression:52546});
  assert.deepEqual(inspectDng(bytes).compressions, [52546]);
  await assert.rejects(decodeDng(bytes), /DNG JPEG XL compression unsupported/);
  assert.equal(diagnosePortError(Error('DNG JPEG XL compression unsupported')).code, 'dngCompression');
  assert.equal(diagnosePortError(Error('DNG decode failed: invalid TIFF value')).code, 'dng');
});

test('DNG inspection reads the original directory graph, semantic masks and rendering tables without RAW development', () => {
  for(const little of [false,true]){
    const input=dngInspectionFixture({little}),source=buildDngInspection(input);
    assert.equal(source.version,'1.4.0.0');
    const raw=source.layers.find(layer=>layer.kind==='raw');
    assert.equal(raw.width,128);assert.equal(raw.height,96);assert.equal(raw.sources,undefined);
    assert.ok(source.layers.some(layer=>layer.path==='IFD0/Exif'));
    assert.ok(source.layers.some(layer=>layer.path==='IFD0/GPS'));
    const masks=source.layers.filter(layer=>layer.kind==='mask');assert.equal(masks.length,3);
    assert.equal(masks[0].semantic,'urn:com:apple:photo:2020:aux:semanticskymatte');
    assert.equal(masks[0].sources[0].size,12);assert.equal(masks[0].orientation,6);
    assert.deepEqual(raw.toneCurve,[0,0,.5,.25,1,1]);
    assert.deepEqual(gainTableSlice(raw.gainTable,1),new Float32Array([.5625,.8125,1.0625,1.3125,1.5625,1.8125]));
    assert.throws(()=>gainTableSlice(raw.gainTable,4),/Invalid gain table level/);
    assert.throws(()=>readDngGainTable({data:new Uint8Array(32)},little),/Truncated/);
    assert.equal(dngMatteUri(masks[1].semantic),'urn:com:apple:photo:2019:aux:semanticskinmatte');
    assert.equal(dngMatteUri('unrecognized:semanticskymatte'),null);
    assert.equal(dngMatteUri('urn:com:apple:photo:2020:aux:unknown'),null);
    const sky=dngInspectionEntry(source,'semanticskymatte');
    assert.equal(sky.present,true);assert.equal(sky.value[0].directory,'IFD0/SubIFD[0]');
    const hair=dngInspectionEntry(source,'semantichairmatte');
    assert.equal(hair.present,false);assert.equal(hair.dngMask,true);assert.equal(hair.notComparable,undefined);
    for(const name of ['HDR gain map','styles','PeopleRatio']){
      const entry=dngInspectionEntry(source,name);
      assert.equal(entry.notComparable,true);assert.equal(entry.present,false);
    }
  }
});
