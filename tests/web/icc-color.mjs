import assert from "node:assert/strict";
import test from "node:test";
import {recognizeIccColorSpace} from "../../web/src/icc-color.js";
import {iccFixture} from "./icc-fixture.mjs";
const tagOffset=(bytes,name)=>{
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  for(let i=0;i<v.getUint32(128);i++){const p=132+i*12;if(String.fromCharCode(...bytes.slice(p,p+4))===name)return v.getUint32(p+4);}
};
test("ICC standard sRGB/P3 recognition validates actual matrix and channel curves",()=>{
  assert.deepEqual(recognizeIccColorSpace(iccFixture()),{name:"sRGB",primaries:"bt709",transfer:"iec61966-2-1"});
  assert.deepEqual(recognizeIccColorSpace(iccFixture({space:"p3"})),{name:"Display P3",primaries:"smpte432",transfer:"iec61966-2-1"});
  assert.equal(recognizeIccColorSpace(iccFixture({space:"p3",linear:true})).name,"Display P3 Linear");
  const renamed=iccFixture({space:"p3"});renamed.fill(0,tagOffset(renamed,"desc")+28,tagOffset(renamed,"desc")+48);
  assert.equal(recognizeIccColorSpace(renamed).name,"Display P3","profile names are not used as proof");
  for(const space of ["srgb","p3"]){
    const bytes=iccFixture({space,sampled:true});bytes[8]=2;
    assert.equal(recognizeIccColorSpace(bytes).transfer,"iec61966-2-1");
  }
});
test("ICC custom matrices, gamma, channel curves and LUTs cannot masquerade as standard profiles",()=>{
  assert.throws(()=>recognizeIccColorSpace(iccFixture({gamma:2.2})),/tone curve/);
  assert.throws(()=>recognizeIccColorSpace(iccFixture({lut:true})),/custom color transform/);
  const matrix=iccFixture(),mv=new DataView(matrix.buffer);mv.setInt32(tagOffset(matrix,"rXYZ")+8,Math.round(0.5*65536));
  assert.throws(()=>recognizeIccColorSpace(matrix),/RGB primaries/);
  const white=iccFixture(),wv=new DataView(white.buffer);wv.setInt32(tagOffset(white,"wtpt")+8,Math.round(0.95*65536));
  assert.throws(()=>recognizeIccColorSpace(white),/profile white point/);
  const adaptation=iccFixture(),av=new DataView(adaptation.buffer);av.setInt32(tagOffset(adaptation,"chad")+8,65536);
  assert.throws(()=>recognizeIccColorSpace(adaptation),/chromatic adaptation/);
  const curve=iccFixture({sampled:true}),cv=new DataView(curve.buffer);cv.setUint16(tagOffset(curve,"rTRC")+12+512*2,40000);
  assert.throws(()=>recognizeIccColorSpace(curve),/nonmonotonic|tone curve/);
});
test("older Apple Display P3 adaptation/colorants are recognized as a pair without accepting custom profiles",()=>{
  for (const linear of [false,true]) for (const sampled of [false,true])
    assert.equal(recognizeIccColorSpace(iccFixture({space:'p3',appleP3:true,linear,sampled})).name,
      linear ? 'Display P3 Linear' : 'Display P3');
  const apple = iccFixture({space:'p3',appleP3:true}), canonical = iccFixture({space:'p3'});
  const mixed = apple.slice();
  mixed.set(canonical.slice(tagOffset(canonical,'chad')+8,tagOffset(canonical,'chad')+44),tagOffset(mixed,'chad')+8);
  assert.throws(()=>recognizeIccColorSpace(mixed),/RGB primaries/,'adaptation and colorants must match together');
  for (const name of ['rXYZ','gXYZ','bXYZ','chad']) {
    const altered = apple.slice(), view = new DataView(altered.buffer), p = tagOffset(altered,name)+8;
    view.setInt32(p,view.getInt32(p)+128);
    assert.throws(()=>recognizeIccColorSpace(altered),/RGB primaries|chromatic adaptation/);
  }
  for (const options of [{gamma:2.2},{lut:true}])
    assert.throws(()=>recognizeIccColorSpace(iccFixture({space:'p3',appleP3:true,...options})),/tone curve|custom color transform/);
});
test("ICC malformed tables, overlapping tags and truncated curves fail safely",()=>{
  const original=iccFixture();
  for(const change of [
    b=>b.subarray(0,100),
    b=>{new DataView(b.buffer).setUint32(128,0xffffffff);return b;},
    b=>{new DataView(b.buffer).setUint32(136,b.length+4);return b;},
    b=>{new DataView(b.buffer).setUint32(148,new DataView(b.buffer).getUint32(136)+4);return b;},
    b=>{b.set(b.slice(132,136),144);return b;},
    b=>{new DataView(b.buffer).setUint16(tagOffset(b,"rTRC")+8,4);return b;},
  ])assert.throws(()=>recognizeIccColorSpace(change(original.slice())),/ICC color profile requires libheif/);
});
test("linear GRAY ICC is accepted only for auxiliary data and still validates curves/tables",()=>{
  for(const options of [{linear:true},{linear:true,sampled:true},{identity:true}]){
    const bytes=iccFixture({space:"gray",...options});
    if(options.identity)bytes[8]=2; // Same v2 one-entry identity curve as typical auxiliary ICCs.
    assert.throws(()=>recognizeIccColorSpace(bytes),/unsupported profile type/);
    assert.deepEqual(recognizeIccColorSpace(bytes,{allowGrayscale:true}),{name:"Gray Linear",grayscale:true,transfer:"linear"});
  }
  for(const options of [{gamma:2.2},{linear:false},{linear:true,lut:true}])
    assert.throws(()=>recognizeIccColorSpace(iccFixture({space:"gray",...options}),{allowGrayscale:true}),/tone curve|custom color transform/);
  const malformed=iccFixture({space:"gray",linear:true});new DataView(malformed.buffer).setUint32(136,malformed.length+4);
  assert.throws(()=>recognizeIccColorSpace(malformed,{allowGrayscale:true}),/invalid tag bounds/);
});
