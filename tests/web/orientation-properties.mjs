import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { topBox, concat, be } from "../../web/src/box.js";
import { loadProfile } from "../../web/src/zip.js";
import {
  appendIpcoProperty, associateItemProperty, auxUriForItem, imirAxisForItem,
  parseIinf, parseIpcoIpma, propertyForItem, itemOrientation, setItemPropertyAssociations,
  storedPointToDisplay, displayPointToStored, discoverHeic, propertyBoxBytes, parseIloc, extractItemData,
} from "../../web/src/heif.js";
import { addTextureItems, MATTE_2026_URIS } from "../../web/src/texture.js";
import {buildRasterHeic} from "../../web/src/raster-import.js";
import {patch} from "../../web/src/port.js";

const profile = await loadProfile(new Uint8Array(readFileSync("web/profiles/48-12.zip")));
const primary = Number(profile.manifest.donor_primary_item);
let meta = profile.meta;
assert.equal(propertyForItem(parseIpcoIpma(meta, topBox(meta, "meta")), primary, "imir"), null);

const imir0 = new Uint8Array([0, 0, 0, 9, 0x69, 0x6d, 0x69, 0x72, 0]);
let imirIndex;
[meta, imirIndex] = appendIpcoProperty(meta, imir0);
meta = associateItemProperty(meta, primary, imirIndex, true);
let props = parseIpcoIpma(meta, topBox(meta, "meta"));
assert.equal(propertyForItem(props, primary, "imir").index, imirIndex);
assert.equal(imirAxisForItem(meta, props, primary), 0);

[meta] = addTextureItems(meta, primary);
const infos = parseIinf(meta, topBox(meta, "meta"));
props = parseIpcoIpma(meta, topBox(meta, "meta"));
const matte = [...infos.keys()].find((iid) => auxUriForItem(props, iid) === MATTE_2026_URIS[0]);
assert.equal(propertyForItem(props, matte, "imir").index, imirIndex,
  "new 2026 mattes must inherit the primary mirror transform");

// Check coordinates independently by applying the source properties one at a
// time; inversion alone would not catch two helpers using the same wrong axis.
for(const order of ["mirror-first","rotate-first"])for(const angle of [0,90,180,270])for(const mirror of [null,0,1]) {
  const operations=order==="mirror-first"?["imir","irot"]:["irot","imir"];
  const data=new Uint8Array([angle/90,mirror||0]);
  const fakeProps={properties:[{type:"irot",box:{off:0,hdr:0}},{type:"imir",box:{off:1,hdr:0}}],
    associations:new Map([[1,operations.filter(type=>type!=="imir"||mirror!==null).map(type=>({index:type==="irot"?1:2}))]])};
  const canonical=itemOrientation(data,fakeProps,1);
  let point={x:.23,y:.67};
  for(const op of operations) {
    if(op==="imir") {if(mirror===0)point.y=1-point.y;else if(mirror===1)point.x=1-point.x;}
    else {const {x,y}=point;if(angle===90)point={x:y,y:1-x};else if(angle===180)point={x:1-x,y:1-y};else if(angle===270)point={x:1-y,y:x};}
  }
  const displayed=storedPointToDisplay(.23,.67,canonical.angle,canonical.mirror);
  assert.ok(Math.abs(displayed.x-point.x)<1e-12&&Math.abs(displayed.y-point.y)<1e-12);
  const stored=displayPointToStored(displayed.x,displayed.y,canonical.angle,canonical.mirror);
  assert.ok(Math.abs(stored.x-.23)<1e-12&&Math.abs(stored.y-.67)<1e-12);
}

// Container regression without private photos or a browser HEVC backend. The
// compressed markers must survive byte-for-byte; this test changes properties.
const donor=discoverHeic(profile.meta),fakeChunk=id=>new Uint8Array([0,0,0,id]);
const base=buildRasterHeic(profile,{
  main:Array.from({length:48},(_,i)=>fakeChunk(i)),mainHvcc:propertyBoxBytes(profile.meta,donor.props,donor.primaryTiles[0],"hvcC"),
  thumb:fakeChunk(100),thumbHvcc:propertyBoxBytes(profile.meta,donor.props,donor.thumbnail,"hvcC"),
  hdr:fakeChunk(101),hdrHvcc:propertyBoxBytes(profile.meta,donor.props,donor.hdrTiles[0],"hvcC"),
});
const orientationTypes=new Set(["irot","imir"]);
const sequence=(d,iid)=>(d.props.associations.get(iid)||[]).filter(a=>orientationTypes.has(d.props.properties[a.index-1]?.type)).map(a=>d.props.properties[a.index-1].type);
for(const order of ["mirror-first","rotate-first"]) {
  const original=discoverHeic(base);
  let sourceMeta=base.slice(original.meta.off,original.meta.off+original.meta.size),sourceMirror;
  [sourceMeta,sourceMirror]=appendIpcoProperty(sourceMeta,imir0);
  const beforeProps=parseIpcoIpma(sourceMeta,topBox(sourceMeta,"meta")),rotation=propertyForItem(beforeProps,original.primary,"irot");
  const kept=beforeProps.associations.get(original.primary).filter(a=>!orientationTypes.has(beforeProps.properties[a.index-1].type));
  const transforms=order==="mirror-first"?[[sourceMirror,true],[rotation.index,true]]:[[rotation.index,true],[sourceMirror,true]];
  sourceMeta=setItemPropertyAssociations(sourceMeta,original.primary,[...kept.map(a=>[a.index,a.essential]),...transforms]);
  const growth=sourceMeta.length-original.meta.size,iloc=parseIloc(sourceMeta,topBox(sourceMeta,"meta"));
  for(const item of iloc.items.values())if(item.constructionMethod===0)for(const extent of item.extents)
    sourceMeta.set(be(extent.offset+growth,iloc.offsetSize),extent.offsetPos);
  const source=concat([base.subarray(0,original.meta.off),sourceMeta,base.subarray(original.meta.off+original.meta.size)]),before=discoverHeic(source);
  const uri=MATTE_2026_URIS.find(uri=>uri.endsWith("semanticnosematte"));
  const replacement={payload:fakeChunk(222),hvcc:propertyBoxBytes(profile.meta,donor.props,donor.primaryTiles[0],"hvcC"),width:32,height:32};
  const {data}=await patch(source,profile,{texture:true,sceneStats:"donor",lightMaps:"flat",matteOverrides:new Map([[uri,replacement]])});
  const after=discoverHeic(data),nose=[...after.infos.keys()].find(iid=>auxUriForItem(after.props,iid)===uri);
  assert.deepEqual(sequence(after,after.primary),sequence(before,before.primary),`${order}: primary properties preserved`);
  assert.deepEqual(sequence(after,nose),sequence(before,before.primary),`${order}: generated matte keeps primary transformation order`);
  assert.deepEqual(itemOrientation(data,after.props,nose),itemOrientation(source,before.props,before.primary));
  assert.deepEqual(extractItemData(data,after,nose),replacement.payload);
  for(let i=0;i<before.primaryTiles.length;i++)assert.deepEqual(extractItemData(data,after,after.primaryTiles[i]),extractItemData(source,before,before.primaryTiles[i]));
}

console.log("Ordered irot/imir, independent point transforms, and patched primary/generated-matte property order with preserved HEVC payloads passed");
