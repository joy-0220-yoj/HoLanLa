import assert from "node:assert/strict";
import {box, concat, be, topBox} from "../../web/src/box.js";
import {discoverHeic, discoverImageItems, extractItemData, propertyBoxBytes} from "../../web/src/heif.js";
import {isolateImageItem} from "../../web/src/primary-source.js";
import {iccFixture} from "./icc-fixture.mjs";

const ascii = text => new TextEncoder().encode(text);
const full = (type, body, version = 0) => box(type, concat([new Uint8Array([version,0,0,0]), body]));
export function fixture({icc = false, nclx = false} = {}) {
  const ids = [1,11,12,13,14,20];
  const payloads = [new Uint8Array([0,0,1,1,0,5,0,3]), ...[11,22,33,44,203].map(v=>new Uint8Array([v]))];
  const ispe = (w,h) => full("ispe", concat([be(w,4),be(h,4)]));
  const properties = [ispe(5,3), ispe(3,2), box("hvcC",new Uint8Array([1,1,0x60,0,0,0,0,0,0,0,0,0,90])),
    box("auxC",concat([new Uint8Array(4),ascii("urn:test:mask\0")])), box("irot",new Uint8Array([3]))];
  if (icc) properties.push(box("colr",concat([ascii("prof"),icc instanceof Uint8Array ? icc : new Uint8Array(128)])));
  if (nclx) properties.push(box("colr",concat([ascii("nclx"),be(1,2),be(13,2),be(1,2),new Uint8Array([0])])));
  const associations = [[1,...(icc?[6]:[]),...(nclx?[icc?7:6]:[])], [2,3], [2,3], [2,3], [2,3], [2,3,4,5]];
  let offset=0;
  const entries = payloads.map((p,i) => {
    const out=concat([be(ids[i],2),be(1,2),be(0,2),be(1,2),be(offset,4),be(p.length,4)]);
    offset+=p.length; return out;
  });
  return concat([box("ftyp",concat([ascii("heic"),be(0,4),ascii("mif1heic")])),full("meta",concat([
    full("hdlr",concat([be(0,4),ascii("pict"),new Uint8Array(12),ascii("test\0")])),
    full("pitm",be(1,2)),
    full("iinf",concat([be(ids.length,2),...ids.map((id,i)=>full("infe",concat([
      be(id,2),be(0,2),ascii(i===0?"grid":"hvc1"),ascii("image\0")]),2))])),
    full("iloc",concat([new Uint8Array([0x44,0]),be(ids.length,2),...entries]),1),
    full("iref",concat([box("dimg",concat([be(1,2),be(4,2),...[11,12,13,14].map(id=>be(id,2))])),
      box("auxl",concat([be(20,2),be(1,2),be(1,2)]))])),
    box("iprp",concat([box("ipco",concat(properties)),full("ipma",concat([be(ids.length,4),
      ...ids.map((id,i)=>concat([be(id,2),new Uint8Array([associations[i].length,...associations[i]])]))]))])),
    box("idat",concat(payloads)),
  ]))]);
}

const bytes=fixture(), d=discoverHeic(bytes), original=bytes.slice();
const auxiliary=isolateImageItem(bytes,20,d), ad=discoverImageItems(auxiliary);
assert.equal(ad.primary,20);
assert.deepEqual([...ad.infos.keys()],[20]);
assert.equal(propertyBoxBytes(auxiliary,ad.props,20,"auxC"),null);
assert.deepEqual(extractItemData(auxiliary,ad,20),new Uint8Array([203]));
for (const type of ["ispe","hvcC","irot"])
  assert.deepEqual(propertyBoxBytes(auxiliary,ad.props,20,type),propertyBoxBytes(bytes,d.props,20,type));
assert.deepEqual(bytes,original,"auxiliary isolation cannot modify the source");
assert.equal(topBox(auxiliary,"meta").type,"meta");

let scriptRequests=0, asmCalls=0, freed=0, contextsFreed=0, webCalls=0, framesClosed=0;
let supported=true, fail=false, empty=false, wrongColor=false;
let asmFail=false;
const persisted=new Map([["holanla.decoder","libheif"]]);
globalThis.localStorage={getItem:key=>persisted.get(key),setItem:(key,value)=>persisted.set(key,value)};
const makeCanvas=()=>({width:0,height:0,draws:[],getContext(){
  const self=this;
  return {translate(){},rotate(){},scale(){},save(){},restore(){},
    drawImage(image){self.draws.push(image); self.value=image.value || image.data?.[0] || 0;},
    createImageData(w,h){return {width:w,height:h,data:new Uint8ClampedArray(w*h*4)};},
    putImageData(image){self.value=image.data[0];},
    getImageData(x,y,w,h){return {data:Uint8ClampedArray.from({length:w*h*4},(_,i)=>i%4===3?255:self.value)};}};
}});
const library={HeifDecoder:class {
  constructor(){this.decoder=123;}
  decode(data){
    asmCalls++;
    if(asmFail)throw Error("test asm.js decode failure");
    const discovery=discoverImageItems(data), id=discovery.primary;
    // A nonprimary top-level image first verifies that array order is never trusted.
    return [{is_primary:()=>false,free(){freed++;}}, {is_primary:()=>true,free(){freed++;},
      get_width:()=>id===20?2:5,get_height:()=>3,
      display(out,done){out.data.fill(id===20?203:111);done(out);}}];
  }
},heif_context_free(){contextsFreed++;}};
globalThis.document={createElement:type=>type==="canvas"?makeCanvas():{},head:{appendChild(script){
  scriptRequests++;globalThis.libheif=library;queueMicrotask(()=>script.onload());
}}};
globalThis.EncodedVideoChunk=class {constructor(config){Object.assign(this,config);}};
globalThis.VideoDecoder=class {
  static async isConfigSupported(config){return {supported,config};}
  constructor(callbacks){this.callbacks=callbacks;this.state="unconfigured";webCalls++;}
  configure(config){this.state="configured";this.config=config;}
  decode(chunk){if(fail||empty)return;this.callbacks.output({width:3,height:2,displayWidth:3,displayHeight:2,value:chunk.data[0],
    colorSpace:wrongColor?{...this.config.colorSpace,fullRange:true}:this.config.colorSpace,close(){framesClosed++;}});}
  async flush(){if(fail)throw Error("test WebCodecs decode failure");}
  close(){this.state="closed";}
};
const {decodeToDisplayCanvas,decodeToRgb,decodeImageItem}=await import("../../web/src/decode.js");
const events=[];
const onProgress=event=>events.push(event);
const web=await decodeToDisplayCanvas(bytes,{onProgress});
assert.deepEqual([web.width,web.height],[5,3]);
assert.equal(scriptRequests,0,"successful WebCodecs must not load asm.js");
assert.equal(asmCalls,0);
assert.equal(persisted.get("holanla.decoder"),"libheif","legacy saved mode is ignored without modifying unrelated storage");
assert.equal(events.at(-1).source,"WebCodecs VideoDecoder");
await decodeToRgb(bytes,{width:2,height:2,decoder:"auto",onProgress});
assert.equal(webCalls,4,"scene statistics and faces share the primary decode cache");
const standardIcc=fixture({icc:iccFixture({space:"p3"})});
const diagnostics=[];
await decodeToDisplayCanvas(standardIcc,{decoder:"auto",onProgress,diagnostics});
assert.equal(scriptRequests,0,"recognized ICC must not load asm.js");
assert.equal(events.at(-1).colorProfile,"Display P3");
assert.ok(diagnostics.every(d=>d.outerICCProvided&&d.iccProfile==="Display P3"&&d.colorSpace.primaries==="smpte432"));
await decodeToDisplayCanvas(standardIcc,{decoder:"auto",onProgress});
assert.equal(events.at(-1).colorProfile,"Display P3","cached decode retains the ICC label");
await decodeToDisplayCanvas(fixture({icc:iccFixture(),nclx:true}),{decoder:"webcodecs"});
await assert.rejects(decodeToDisplayCanvas(fixture({icc:iccFixture({space:"p3"}),nclx:true}),{decoder:"webcodecs"}),/ICC and nclx primaries disagree/);
assert.equal(scriptRequests,0,"strict ICC conflicts cannot trigger a fallback");
const beforeFailure=webCalls;

fail=true;
await assert.rejects(decodeToDisplayCanvas(bytes,{decoder:"webcodecs",onProgress}),/test WebCodecs/);
assert.equal(events.at(-1).source,"WebCodecs VideoDecoder");
assert.match(events.at(-1).decodeError,/test WebCodecs decode failure/);
assert.equal(scriptRequests,0,"forced WebCodecs must not load its fallback");
fail=false;
await decodeToDisplayCanvas(bytes,{decoder:"webcodecs",onProgress});
assert.equal(webCalls,beforeFailure+5,"a rejected cache entry can be retried");
supported=false;
const fallbackStart=events.length;
const fallback=await decodeToDisplayCanvas(bytes.slice(),{onProgress});
assert.deepEqual([fallback.width,fallback.height],[5,3]);
assert.equal(scriptRequests,1);
assert.match(events.at(-1).fallbackReason,/does not support/);
assert.equal(events.at(-1).source,"libheif-js (asm.js)");
assert.ok(events.slice(fallbackStart).every(event=>!event.decodeError),
  "successful automatic fallback must not report a terminal decode failure");
const before=webCalls;
const asm=await decodeToDisplayCanvas(bytes,{decoder:"libheif",onProgress});
assert.notEqual(asm,web,"changing mode cannot reuse another decoder's pixels");
assert.equal(webCalls,before,"forced asm.js must not call WebCodecs");
const aux=await decodeImageItem(bytes,d,20,{decoder:"libheif",onProgress});
assert.deepEqual([aux.width,aux.height,aux.value],[2,3,203],"auxiliary fallback cannot display the main image");
assert.equal(asmCalls,3);
assert.equal(contextsFreed,asmCalls);assert.equal(freed,asmCalls*2);
assert.equal(scriptRequests,1,"the classic script is loaded only once");

supported=true;
const callsBeforeNewPhoto=asmCalls;
await decodeToDisplayCanvas(bytes.slice(),{decoder:"auto",onProgress});
assert.equal(asmCalls,callsBeforeNewPhoto,"an earlier photo's fallback cannot disable WebCodecs for later photos");
const colorBytes=fixture({nclx:true});
await decodeToDisplayCanvas(colorBytes,{decoder:"webcodecs"});
wrongColor=true;
await assert.rejects(decodeToDisplayCanvas(colorBytes.slice(),{decoder:"webcodecs"}),/HEIF fullRange/);
await decodeToDisplayCanvas(colorBytes.slice(),{decoder:"auto",onProgress});
assert.match(events.at(-1).fallbackReason,/HEIF fullRange/);
wrongColor=false;
empty=true;
const noFrame=await decodeToDisplayCanvas(bytes.slice(),{decoder:"auto",onProgress});
assert.equal(noFrame.width,5);assert.match(events.at(-1).fallbackReason,/0 frames/);
empty=false;
const icc=fixture({icc:true});
await assert.rejects(decodeToDisplayCanvas(icc,{decoder:"webcodecs"}),/ICC color profile/);
await decodeToDisplayCanvas(icc,{decoder:"auto",onProgress});
assert.match(events.at(-1).fallbackReason,/ICC color profile/);
await decodeToDisplayCanvas(fixture({icc:iccFixture({lut:true})}),{decoder:"auto",onProgress});
assert.match(events.at(-1).fallbackReason,/custom color transform/);
await assert.rejects(decodeImageItem(bytes,d,20,{decoder:"libheif",maxSide:0}),/image size/);
fail=true;
await assert.rejects(decodeToDisplayCanvas(standardIcc.slice(),{decoder:"webcodecs",onProgress}),/test WebCodecs/);
assert.equal(events.at(-1).colorProfile,"Display P3","failed ICC decode retains its profile label");
assert.match(events.at(-1).decodeError,/test WebCodecs decode failure/);
const recoveredStart=events.length;
await decodeToDisplayCanvas(standardIcc.slice(),{onProgress});
assert.equal(events.at(-1).source,"libheif-js (asm.js)");
assert.match(events.at(-1).fallbackReason,/test WebCodecs decode failure/);
assert.ok(events.slice(recoveredStart).every(event=>!event.decodeError),
  "a WebCodecs runtime failure recovered by asm.js must only report its fallback reason");
fail=false;
asmFail=true;
const webBeforeAsmFailure=webCalls;
await assert.rejects(decodeToDisplayCanvas(bytes.slice(),{decoder:"libheif",onProgress}),/test asm.js/);
assert.equal(events.at(-1).source,"libheif-js (asm.js)");
assert.match(events.at(-1).decodeError,/test asm.js decode failure/);
assert.equal(webCalls,webBeforeAsmFailure,"failed strict asm.js decode cannot try WebCodecs");
fail=true;
const failedStart=events.length;
await assert.rejects(decodeToDisplayCanvas(bytes.slice(),{decoder:"auto",onProgress}),/libheif fallback failed/);
assert.equal(events.at(-1).source,"libheif-js (asm.js)");
assert.match(events.at(-1).decodeError,/test WebCodecs.*libheif fallback failed.*test asm.js/);
assert.equal(events.slice(failedStart).filter(event=>event.decodeError).length,1,
  "both decoders failing must report one terminal failure containing both causes");
await assert.rejects(decodeToDisplayCanvas(bytes,{decoder:"invalid"}),/Unknown decoder/);
assert.ok(framesClosed>=8);
delete globalThis.document;delete globalThis.VideoDecoder;delete globalThis.EncodedVideoChunk;
delete globalThis.libheif;delete globalThis.localStorage;
console.log("Decoder selection: lazy fallback, strict modes, grid stitching, cache separation/retry, actual primary/auxiliary selection, native resource cleanup, empty output and ICC protection passed.");
