import assert from "node:assert/strict";
import test from "node:test";
import {applyDecodedColorSpace,completeDecoderColorSpace,readGrayscaleData} from "../../web/src/webcodecs-color.js";
const requested={primaries:"smpte432",transfer:"iec61966-2-1",matrix:"bt709",fullRange:false};
function nativeFrame(format="I420") {
  const wide=format.endsWith("P10"),pixels=Uint8Array.from({length:wide?24:12},(_,i)=>(i*19+16)%256);
  const layout=format === "NV12" ? [{offset:0,stride:4},{offset:8,stride:4}]
    : wide ? [{offset:0,stride:8},{offset:16,stride:4},{offset:20,stride:4}]
    : [{offset:0,stride:4},{offset:8,stride:2},{offset:10,stride:2}];
  return {format,codedWidth:4,codedHeight:2,visibleRect:{x:0,y:0,width:2,height:2},displayWidth:2,displayHeight:2,
    timestamp:123,duration:456,colorSpace:{...requested,primaries:"bt709",transfer:"bt709"},copied:0,
    allocationSize(options){assert.deepEqual(options,{rect:{x:0,y:0,width:4,height:2}});return pixels.length;},
    async copyTo(destination,options){assert.deepEqual(options,{rect:{x:0,y:0,width:4,height:2}});
      destination.set(pixels);this.copied++;return layout;},
    close(){throw Error("caller owns original frame");},pixels,layout};
}
function installFrame(transform=init=>init) {
  let closed=0;
  globalThis.VideoFrame=class {
    constructor(bytes,init){Object.assign(this,transform(init));this.bytes=bytes.slice();}
    close(){closed++;}
  };
  return ()=>{delete globalThis.VideoFrame;return closed;};
}
test("ICC retagging copies native samples verbatim and preserves format, layout and crop",async()=>{
  const cleanup=installFrame();
  try{for(const format of ["I420","NV12","I420P10"]){
    const source=nativeFrame(format),repaired=await applyDecodedColorSpace(source,requested,"Display P3");
    assert.notEqual(repaired,source);assert.deepEqual(repaired.bytes,source.pixels);
    assert.equal(repaired.format,format);assert.deepEqual(repaired.colorSpace,requested);
    assert.deepEqual(repaired.visibleRect,source.visibleRect);assert.equal(repaired.codedWidth,4);
    assert.deepEqual(repaired.layout,source.layout);
    assert.equal(repaired.timestamp,123);assert.equal(repaired.duration,456);repaired.close();
  }}finally{assert.equal(cleanup(),3);}
});
test("already-correct frames need no copies; non-ICC mismatches still fail",async()=>{
  const source=nativeFrame();source.colorSpace={...requested};
  assert.equal(await applyDecodedColorSpace(source,requested,"Display P3"),source);assert.equal(source.copied,0);
  source.colorSpace.primaries="bt709";
  await assert.rejects(applyDecodedColorSpace(source,requested),/primaries: expected smpte432, received bt709/);
  assert.equal(source.copied,0);
  assert.equal(completeDecoderColorSpace(new Uint8Array(),requested),requested,"missing SPS never guesses matrix/range");
});
test("ignored HEIF matrix is repaired on native YUV with every sample preserved",async()=>{
  const cleanup=installFrame();
  try{for(const format of ["I420","NV12","I420P10"]){
    const source=nativeFrame(format),target={...requested,matrix:"smpte170m"};
    // Exercise the reported case both alone and alongside ignored P3 ICC tags.
    for(const ignoreIcc of [false,true]){
      source.colorSpace={...target,matrix:"bt709",...(ignoreIcc?{primaries:"bt709",transfer:"bt709"}:{})};
      const repaired=await applyDecodedColorSpace(source,target,"Display P3");
      assert.deepEqual(repaired.colorSpace,target);assert.deepEqual(repaired.bytes,source.pixels);
      assert.equal(repaired.format,source.format);assert.deepEqual(repaired.layout,source.layout);
      assert.deepEqual(repaired.visibleRect,source.visibleRect);repaired.close();
    }
  }}finally{assert.equal(cleanup(),6);}
});
test("ICC repair cannot reinterpret RGB, unsupported matrices or changed YUV range",async()=>{
  const cleanup=installFrame();
  try{
    const rgb=nativeFrame("RGBA");await assert.rejects(applyDecodedColorSpace(rgb,requested,"Display P3"),/requires native YUV/);
    const range=nativeFrame();range.colorSpace.fullRange=true;
    await assert.rejects(applyDecodedColorSpace(range,requested,"Display P3"),/did not preserve HEIF/);
    const matrix=nativeFrame();matrix.colorSpace={...requested};
    await assert.rejects(applyDecodedColorSpace(matrix,{...requested,matrix:"rgb"},"Display P3"),/did not preserve HEIF matrix/);
    const unknown=nativeFrame();unknown.colorSpace.matrix=null;
    await assert.rejects(applyDecodedColorSpace(unknown,requested,"Display P3"),/requires native YUV/);
    const nonIcc=nativeFrame();nonIcc.colorSpace={...requested,matrix:"smpte170m"};
    await assert.rejects(applyDecodedColorSpace(nonIcc,requested),/did not preserve HEIF matrix/);
    assert.equal(rgb.copied+range.copied+matrix.copied+unknown.copied+nonIcc.copied,0);
  }finally{assert.equal(cleanup(),0);}
});
test("failed native readback or replacement closes no caller frame and leaks no replacement",async()=>{
  const cleanup=installFrame(init=>({...init,colorSpace:{...init.colorSpace,primaries:"bt709"}}));
  try{
    const source=nativeFrame();await assert.rejects(applyDecodedColorSpace(source,requested,"Display P3"),/did not preserve HEIF primaries/);
    const unreadable=nativeFrame();unreadable.copyTo=async()=>{throw Error("readback unavailable");};
    await assert.rejects(applyDecodedColorSpace(unreadable,requested,"Display P3"),/readback unavailable/);
  }finally{assert.equal(cleanup(),1);}
});

function scalarFrame(depth=8,fullRange=false){
  const step=depth>8?2:1,stride=6*step,offset=4,bytes=new Uint8Array(offset+stride*4),view=new DataView(bytes.buffer);
  bytes.fill(201);const maximum=2**depth-1,scale=2**(depth-8),black=fullRange?0:16*scale,white=fullRange?maximum:235*scale;
  const values=[black,Math.round((black+white)/2),white,black];
  for(let y=0;y<2;y++)for(let x=0;x<2;x++){const p=offset+(y+1)*stride+(x+2)*step,v=values[y*2+x];
    if(step===1)bytes[p]=v;else view.setUint16(p,v,true);}
  return {format:depth===8?"NV12":`I420P${depth}`,codedWidth:4,codedHeight:4,visibleRect:{x:2,y:1,width:2,height:2},
    colorSpace:{matrix:"bt709",transfer:"bt709",fullRange},
    allocationSize(options){assert.deepEqual(options,{rect:{x:0,y:0,width:4,height:4}});return bytes.length;},
    async copyTo(out,options){assert.deepEqual(options,{rect:{x:0,y:0,width:4,height:4}});out.set(bytes);return[{offset,stride}];},
    close(){throw Error("caller owns frame");}};
}
test("gray auxiliary preview uses scalar samples, crop and native depth without display gamma",async()=>{
  for(const depth of [8,10,12])for(const fullRange of [false,true]){
    const source=scalarFrame(depth,fullRange),result=await readGrayscaleData(source,{matrix:"smpte170m",fullRange});
    assert.deepEqual([result.width,result.height],[2,2]);
    assert.deepEqual([...result.rgba],[0,0,0,255,128,128,128,255,255,255,255,255,0,0,0,255]);
  }
});
test("gray auxiliary preview rejects RGB, unknown/range conflicts and bad native layout",async()=>{
  const rgb=scalarFrame();rgb.format="RGBA";await assert.rejects(readGrayscaleData(rgb),/requires native YUV/);
  const unknown=scalarFrame();unknown.colorSpace.fullRange=null;await assert.rejects(readGrayscaleData(unknown),/known sample range/);
  await assert.rejects(readGrayscaleData(scalarFrame(),{fullRange:true}),/HEIF fullRange/);
  const bad=scalarFrame();bad.visibleRect.width=4;await assert.rejects(readGrayscaleData(bad),/invalid native plane layout/);
});
