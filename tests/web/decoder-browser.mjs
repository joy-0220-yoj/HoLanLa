// Real pinned asm.js + synthetic HEVC samples; WebCodecs success can additionally
// run under a controlled browser decoder when the host lacks an HEVC backend.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {deflateSync} from "node:zlib";
import {box,concat,be,boxes,topBox,findChild,u} from "../../web/src/box.js";
import {appendIpcoProperty,associateItemProperty,replaceIpcoProperty} from "../../web/src/heif.js";
import {iccFixture} from "./icc-fixture.mjs";
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const root=fileURLToPath(new URL("../../web/",import.meta.url));
const dir=path.resolve("tests/web/.cache/decoder-browser");fs.mkdirSync(dir,{recursive:true});
const library=path.resolve("tests/web/.cache/libheif.js");
assert.ok(fs.existsSync(library),"Pinned libheif.js must be available in the test cache");
const ascii=text=>new TextEncoder().encode(text);
const full=(type,body,version=0)=>box(type,concat([new Uint8Array([version,0,0,0]),body]));
function sample(level, matrix = 1, raw = null) {
  const input=raw || Buffer.alloc(32*32*3/2,128);if(!raw)input.fill(level,0,32*32);
  const filename=path.join(dir,`${level}-${matrix}.mp4`);
  execFileSync(process.env.FFMPEG_EXECUTABLE || "ffmpeg",["-hide_banner","-loglevel","error","-f","rawvideo",
    "-pix_fmt","yuv420p","-s:v","32x32","-i","pipe:0","-frames:v","1","-c:v","libx265","-preset","ultrafast",
    "-x265-params",`crf=10:level-idc=3.0:vbv-maxrate=1000:vbv-bufsize=1000:pools=none:frame-threads=1:wpp=0:colorprim=1:transfer=13:colormatrix=${matrix}:range=limited:log-level=error`,
    "-tag:v","hvc1","-y",filename],{input,stdio:["pipe","pipe","pipe"]});
  const data=new Uint8Array(fs.readFileSync(filename));
  const children=(b,skip=0)=>[...boxes(data,b.off+b.hdr+skip,b.off+b.size)];
  let parent=topBox(data,"moov");for(const name of ["trak","mdia","minf","stbl"])parent=findChild(children(parent),name);
  const table=children(parent),entry=children(findChild(table,"stsd"),8)[0],hvcc=findChild(children(entry,78),"hvcC");
  const stsz=findChild(table,"stsz"),p=stsz.off+stsz.hdr,size=u(data,p+4,4)||u(data,p+12,4);
  const offset=u(data,findChild(table,"stco").off+16,4);
  const reference=execFileSync(process.env.FFMPEG_EXECUTABLE || "ffmpeg",["-hide_banner","-loglevel","error",
    "-i",filename,"-frames:v","1","-pix_fmt","rgba","-f","rawvideo","pipe:1"]);
  return {payload:data.slice(offset,offset+size),hvcc:data.slice(hvcc.off,hvcc.off+hvcc.size),expected:reference[0],rgba:[...reference.subarray(0,4)]};
}
const samples=[16,64,128,235].map(level=>sample(level)), sps601=sample(128,6), ids=[1,11,12,13,14,20];
const payloads=[new Uint8Array([0,0,1,1,0,64,0,64]),...samples.map(s=>s.payload),samples[3].payload];
const ispe=(w,h)=>full("ispe",concat([be(w,4),be(h,4)]));
const properties=[ispe(64,64),ispe(32,32),box("imir",new Uint8Array([0])),box("irot",new Uint8Array([3])),
  box("auxC",concat([new Uint8Array(4),ascii("urn:com:apple:photo:2018:aux:portraiteffectsmatte\0")])),
  ...samples.map(s=>s.hvcc)];
const associations=[[1,3,4],...[0,1,2,3].map(i=>[2,6+i]),[2,9,5]];
let offset=0;
const entries=payloads.map((payload,i)=>{
  const entry=concat([be(ids[i],2),be(1,2),be(0,2),be(1,2),be(offset,4),be(payload.length,4)]);offset+=payload.length;return entry;
});
const bytes=concat([box("ftyp",concat([ascii("heic"),be(0,4),ascii("mif1heic")])),full("meta",concat([
  full("hdlr",concat([be(0,4),ascii("pict"),new Uint8Array(12),ascii("synthetic\0")])),full("pitm",be(1,2)),
  full("iinf",concat([be(ids.length,2),...ids.map((id,i)=>full("infe",concat([be(id,2),be(0,2),ascii(i?"hvc1":"grid"),ascii("image\0")]),2))])),
  full("iloc",concat([new Uint8Array([0x44,0]),be(ids.length,2),...entries]),1),
  full("iref",concat([box("dimg",concat([be(1,2),be(4,2),...[11,12,13,14].map(id=>be(id,2))])),box("auxl",concat([be(20,2),be(1,2),be(1,2)]))])),
  box("iprp",concat([box("ipco",concat(properties)),full("ipma",concat([be(ids.length,4),...ids.map((id,i)=>concat([be(id,2),new Uint8Array([associations[i].length,...associations[i]])]))]))])),
  box("idat",concat(payloads)),
]))]);
fs.writeFileSync(path.join(dir,"sample.heic"),bytes);
function grayAuxiliaryFixture({grid=false,profile=iccFixture({space:"gray",identity:true})}={}) {
  const itemIds=grid?[...ids,31,32,33,34]:ids;
  const itemPayloads=grid?[...payloads.slice(0,5),payloads[0],...samples.map(s=>s.payload)]
    : [...payloads.slice(0,5),samples[2].payload];
  const props=[...properties,box("colr",concat([ascii("prof"),profile]))];
  if(grid)props[4]=box("auxC",concat([new Uint8Array(4),ascii("urn:com:apple:photo:2020:aux:hdrgainmap\0")]));
  const itemAssociations=[...associations.slice(0,5),grid?[1,3,4,5,10]:[2,8,5,10],...(grid?[0,1,2,3].map(i=>[2,6+i]):[])];
  let position=0;
  const locations=itemPayloads.map((p,i)=>{const entry=concat([be(itemIds[i],2),be(1,2),be(0,2),be(1,2),be(position,4),be(p.length,4)]);position+=p.length;return entry;});
  const refs=[box("dimg",concat([be(1,2),be(4,2),...[11,12,13,14].map(id=>be(id,2))])),box("auxl",concat([be(20,2),be(1,2),be(1,2)]))];
  if(grid)refs.push(box("dimg",concat([be(20,2),be(4,2),...[31,32,33,34].map(id=>be(id,2))])));
  return concat([box("ftyp",concat([ascii("heic"),be(0,4),ascii("mif1heic")])),full("meta",concat([
    full("hdlr",concat([be(0,4),ascii("pict"),new Uint8Array(12),ascii("synthetic\0")])),full("pitm",be(1,2)),
    full("iinf",concat([be(itemIds.length,2),...itemIds.map(id=>full("infe",concat([be(id,2),be(0,2),ascii(id===1||(id===20&&grid)?"grid":"hvc1"),ascii("image\0")]),2))])),
    full("iloc",concat([new Uint8Array([0x44,0]),be(itemIds.length,2),...locations]),1),full("iref",concat(refs)),
    box("iprp",concat([box("ipco",concat(props)),full("ipma",concat([be(itemIds.length,4),...itemIds.map((id,i)=>concat([be(id,2),new Uint8Array([itemAssociations[i].length,...itemAssociations[i]])]))]))])),
    box("idat",concat(itemPayloads)),
  ]))]);
}
const colorYuv=Buffer.alloc(32*32*3/2);colorYuv.fill(128,0,32*32);colorYuv.fill(100,32*32,32*32*5/4);colorYuv.fill(150,32*32*5/4);
const colorFiles=new Map();
const quadrantYuv=Buffer.alloc(32*32*3/2,128);
for(let y=0;y<32;y++)for(let x=0;x<32;x++)quadrantYuv[y*32+x]=[16,64,128,235][(y>=16?2:0)+(x>=16?1:0)];
const quadrantSample=sample("quadrants",1,quadrantYuv);
colorFiles.set("/orientation-direct.heic",concat([box("ftyp",concat([ascii("heic"),be(0,4),ascii("mif1heic")])),full("meta",concat([
  full("hdlr",concat([be(0,4),ascii("pict"),new Uint8Array(12),ascii("synthetic\0")])),full("pitm",be(1,2)),
  full("iinf",concat([be(1,2),full("infe",concat([be(1,2),be(0,2),ascii("hvc1image\0")]),2)])),
  full("iloc",concat([new Uint8Array([0x44,0]),be(1,2),be(1,2),be(1,2),be(0,2),be(1,2),be(0,4),be(quadrantSample.payload.length,4)]),1),
  box("iprp",concat([box("ipco",concat([ispe(32,32),quadrantSample.hvcc,box("imir",new Uint8Array([0])),box("irot",new Uint8Array([3]))])),
    full("ipma",concat([be(1,4),be(1,2),new Uint8Array([4,1,2,3,4])]))])),box("idat",quadrantSample.payload),
]))]));
const realColor=sample("colored",1,colorYuv);
for(const linear of [false,true]) {
  const profile=iccFixture({space:"p3",linear});
  const colr=box("colr",concat([ascii("prof"),profile]));
  const nclx=box("colr",concat([ascii("nclx"),be(2,2),be(2,2),be(1,2),new Uint8Array([0])]));
  const data=concat([box("ftyp",concat([ascii("heic"),be(0,4),ascii("mif1heic")])),full("meta",concat([
    full("hdlr",concat([be(0,4),ascii("pict"),new Uint8Array(12),ascii("synthetic\0")])),full("pitm",be(1,2)),
    full("iinf",concat([be(1,2),full("infe",concat([be(1,2),be(0,2),ascii("hvc1image\0")]),2)])),
    full("iloc",concat([new Uint8Array([0x44,0]),be(1,2),be(1,2),be(1,2),be(0,2),be(1,2),be(0,4),be(realColor.payload.length,4)]),1),
    box("iprp",concat([box("ipco",concat([ispe(32,32),realColor.hvcc,colr,nclx])),full("ipma",concat([be(1,4),be(1,2),new Uint8Array([4,1,2,3,4])]))])),
    box("idat",realColor.payload),
  ]))]);
  colorFiles.set(`/source-p3${linear?"-linear":""}.heic`,data);
}
const grayProfile=iccFixture({space:"gray",identity:true});grayProfile[8]=2;
colorFiles.set("/gray-mask.heic",grayAuxiliaryFixture({profile:grayProfile}));
colorFiles.set("/gray-gain-grid.heic",grayAuxiliaryFixture({grid:true,profile:grayProfile}));
colorFiles.set("/gray-custom.heic",grayAuxiliaryFixture({profile:iccFixture({space:"gray",gamma:2.2})}));
{
  const originalMeta=topBox(bytes,"meta"),[appended,index]=appendIpcoProperty(bytes.slice(originalMeta.off,originalMeta.off+originalMeta.size),box("colr",concat([ascii("prof"),grayProfile])));
  colorFiles.set("/gray-main.heic",concat([bytes.slice(0,originalMeta.off),associateItemProperty(appended,1,index),bytes.slice(originalMeta.off+originalMeta.size)]));
}
function pngChunk(type,data) {
  const body=concat([ascii(type),data]);let crc=0xffffffff;
  for(const byte of body){crc^=byte;for(let i=0;i<8;i++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return concat([be(data.length,4),body,be((crc^0xffffffff)>>>0,4)]);
}
for(const [space,matrix] of [["srgb","bt709"],["p3","bt709"],["p3","smpte170m"]]) {
  const name=matrix==="bt709"?space:`${space}-601`;
  const colorRgba=execFileSync(process.env.FFMPEG_EXECUTABLE||"ffmpeg",["-hide_banner","-loglevel","error","-f","rawvideo",
    "-pix_fmt","yuv420p","-s:v","32x32","-i","pipe:0","-frames:v","1","-vf",
    `scale=in_color_matrix=${matrix==="bt709"?"bt709":"bt601"}:in_range=limited:out_range=full`,
    "-pix_fmt","rgba","-f","rawvideo","pipe:1"],{input:colorYuv});
  const colorPixel=[...colorRgba.subarray(0,4)];
  const profile=iccFixture({space}),originalMeta=topBox(bytes,"meta");
  const [appended,index]=appendIpcoProperty(bytes.slice(originalMeta.off,originalMeta.off+originalMeta.size),box("colr",concat([ascii("prof"),profile])));
  let meta=associateItemProperty(appended,1,index);
  if(matrix==="smpte170m") {
    // nclx specifies the YUV matrix, while ICC supplies RGB primaries/transfer.
    const [next,nclx]=appendIpcoProperty(meta,box("colr",concat([ascii("nclx"),be(2,2),be(2,2),be(6,2),new Uint8Array([0])])));
    meta=associateItemProperty(next,1,nclx);
  }
  colorFiles.set(`/icc-${name}.heic`,concat([bytes.slice(0,originalMeta.off),meta,bytes.slice(originalMeta.off+originalMeta.size)]));
  const scanlines=new Uint8Array(32*(1+32*4));
  for(let y=0;y<32;y++)for(let x=0;x<32;x++)scanlines.set(colorPixel,y*129+1+x*4);
  const ihdr=concat([be(32,4),be(32,4),new Uint8Array([8,6,0,0,0])]);
  const png=concat([new Uint8Array([137,80,78,71,13,10,26,10]),pngChunk("IHDR",ihdr),
    pngChunk("iCCP",concat([ascii("profile"),new Uint8Array(2),deflateSync(profile)])),
    pngChunk("IDAT",deflateSync(scanlines)),pngChunk("IEND",new Uint8Array())]);
  colorFiles.set(`/icc-${name}.png`,png);
  if(matrix==="smpte170m") {
    // Also exercise ICC-only photos where matrix/range come from SPS, not nclx.
    let spsMeta=associateItemProperty(appended,1,index);
    for(let i=6;i<=9;i++)spsMeta=replaceIpcoProperty(spsMeta,i,sps601.hvcc,"hvcC");
    colorFiles.set(`/icc-${name}-sps.heic`,concat([bytes.slice(0,originalMeta.off),spsMeta,bytes.slice(originalMeta.off+originalMeta.size)]));
    colorFiles.set(`/icc-${name}-sps.png`,png);
  }
}
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,"http://localhost"),filename=path.resolve(root,"."+(url.pathname==="/"?"/index.html":decodeURIComponent(url.pathname)));
  if(url.pathname==="/sample.heic"){res.writeHead(200);res.end(bytes);return;}
  if(colorFiles.has(url.pathname)){res.writeHead(200,{"Content-Type":url.pathname.endsWith(".png")?"image/png":"image/heic"});res.end(colorFiles.get(url.pathname));return;}
  if(!filename.startsWith(root)||!fs.existsSync(filename)||!fs.statSync(filename).isFile()){res.writeHead(404);res.end();return;}
  const mime={".js":"text/javascript",".html":"text/html",".json":"application/json",".webmanifest":"application/manifest+json"};
  res.writeHead(200,{"Content-Type":mime[path.extname(filename)]||"application/octet-stream"});res.end(fs.readFileSync(filename));
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE||undefined});
  async function context() {
    const context=await browser.newContext({serviceWorkers:"block",viewport:{width:390,height:1000},locale:"zh-TW"});
    const hits={asm:0};
    await context.route("**/*",route=>{
      const url=route.request().url();
      if(url.startsWith(origin))return route.continue();
      if(url.includes("libheif-js@1.18.2/libheif/libheif.js")){hits.asm++;return route.fulfill({contentType:"text/javascript",body:fs.readFileSync(library)});}
      return route.abort();
    });
    const page=await context.newPage();await page.goto(origin);return {context,page,hits};
  }
  const real=await context();
  await real.page.selectOption("#decoder","libheif");await real.page.reload();
  assert.equal(await real.page.locator("#decoder").inputValue(),"libheif","choice survives reload");
  const actual=await real.page.evaluate(async()=>{
    const data=new Uint8Array(await (await fetch("/sample.heic")).arrayBuffer());
    const {decodeToDisplayCanvas,decodeImageItem,decodeToRgb}=await import("./src/decode.js?v=0.7.0");
    const {discoverImageItems}=await import("./src/heif.js?v=0.7.0");
    const events=[],onProgress=event=>events.push(event);
    const main=await decodeToDisplayCanvas(data,{decoder:"libheif",onProgress});
    const corners=[[8,8],[56,8],[8,56],[56,56]].map(([x,y])=>main.getContext("2d").getImageData(x,y,1,1).data[0]);
    const aux=await decodeImageItem(data,discoverImageItems(data),20,{decoder:"libheif",onProgress});
    const auxiliary=aux.getContext("2d").getImageData(4,4,1,1).data[0];
    const rgb=await decodeToRgb(data,{width:4,height:4,decoder:"libheif",onProgress});
    const discovery=discoverImageItems(data), pos=discovery.props.ipmaBox.off+discovery.props.ipmaBox.hdr+11;
    const variants=[];
    for(const disable of [1,2]) {
      const variant=data.slice();variant[pos+disable]=0;
      const view=await decodeToDisplayCanvas(variant,{decoder:"libheif"});
      variants.push([[8,8],[56,8],[8,56],[56,56]].map(([x,y])=>view.getContext("2d").getImageData(x,y,1,1).data[0]));
    }
    let native;
    try {
      const web=await decodeToDisplayCanvas(data,{decoder:"webcodecs",onProgress});
      native={supported:true,corners:[[8,8],[56,8],[8,56],[56,56]].map(([x,y])=>web.getContext("2d").getImageData(x,y,1,1).data[0])};
    } catch(error){native={supported:false,error:error.message};}
    return {dimensions:[main.width,main.height],corners,auxDimensions:[aux.width,aux.height],auxiliary,rgbLength:rgb.length,events,native,variants};
  });
  const expected=[samples[0],samples[2],samples[1],samples[3]].map(s=>s.expected);
  assert.deepEqual(actual.dimensions,[64,64]);assert.deepEqual(actual.auxDimensions,[32,32]);
  for(let i=0;i<4;i++)assert.ok(Math.abs(actual.corners[i]-expected[i])<=3,`oriented grid corner ${i}: ${actual.corners[i]} vs ${expected[i]}`);
  for (const [variant, order] of [[actual.variants[0],[2,0,3,1]],[actual.variants[1],[2,3,0,1]]])
    for(let i=0;i<4;i++)assert.ok(Math.abs(variant[i]-samples[order[i]].expected)<=3);
  assert.ok(actual.auxiliary>=252,"auxiliary fallback must show white, not the grid primary");assert.equal(actual.rgbLength,48);
  assert.equal(real.hits.asm,1);
  if(actual.native.supported)for(let i=0;i<4;i++)assert.ok(Math.abs(actual.native.corners[i]-actual.corners[i])<=3);

  const transformOrder=await real.page.evaluate(async()=>{
    const {decodeImageItem,decodeToRgb}=await import("./src/decode.js?v=0.7.0");
    const {discoverImageItems,setItemPropertyAssociations,itemOrientation,storedPointToDisplay,displayPointToStored}=await import("./src/heif.js?v=0.7.0");
    const {metaChildren,findChild}=await import("./src/box.js?v=0.7.0");
    const {matteToStored,peopleEntry}=await import("./src/face-mattes.js?v=0.7.0");
    const {prepareLinearPixels}=await import("./src/linear-thumbnail.js?v=0.7.0");
    const NativeDecoder=globalThis.VideoDecoder;let count=0,direct=false;
    globalThis.VideoDecoder=class {
      static async isConfigSupported(config){return {supported:true,config};}
      constructor(callbacks){this.callbacks=callbacks;this.state="unconfigured";}
      configure(config){this.config=config;this.state="configured";}
      decode(){const bytes=new Uint8Array(32*32*3/2);bytes.fill(128);
        if(direct)for(let y=0;y<32;y++)for(let x=0;x<32;x++)bytes[y*32+x]=[16,64,128,235][(y>=16?2:0)+(x>=16?1:0)];
        else bytes.fill([16,64,128,235][count++%4],0,32*32);
        this.callbacks.output(new VideoFrame(bytes,{format:"I420",codedWidth:32,codedHeight:32,timestamp:0,
          colorSpace:{primaries:"bt709",transfer:"iec61966-2-1",matrix:"bt709",fullRange:false}}));}
      async flush(){}close(){this.state="closed";}
    };
    try {
      const results=[];
      const read=canvas=>[[.2,.2],[.8,.2],[.2,.8],[.8,.8]].map(([x,y])=>canvas.getContext("2d").getImageData(Math.floor(x*canvas.width),Math.floor(y*canvas.height),1,1).data[0]);
      for(const [path,iid,auxiliaryData,isDirect] of [["/sample.heic",1,false,false],["/gray-gain-grid.heic",20,true,false],["/orientation-direct.heic",1,false,true]]) {
        direct=isDirect;
        const original=new Uint8Array(await (await fetch(path)).arrayBuffer());
        for(const rectangular of (direct?[false]:[false,true]))for(const order of ["mirror-first","rotate-first"])for(const angle of [0,90,180,270])for(const mirror of [null,0,1]) {
          let data=original.slice(),d=discoverImageItems(data);
          const associations=d.props.associations.get(iid),property=a=>d.props.properties[a.index-1];
          const rotation=associations.find(a=>property(a).type==="irot"),reflection=associations.find(a=>property(a).type==="imir");
          data[property(rotation).box.off+property(rotation).box.hdr]=angle/90;
          data[property(reflection).box.off+property(reflection).box.hdr]=mirror||0;
          if(rectangular) {
            const ispe=property(associations.find(a=>property(a).type==="ispe"));
            new DataView(data.buffer).setUint32(ispe.box.off+ispe.box.hdr+8,48);
            const item=d.iloc.items.get(iid),idat=findChild(metaChildren(data,d.meta),"idat");
            new DataView(data.buffer).setUint16(idat.off+idat.hdr+item.baseOffset+item.extents[0].offset+6,48);
          }
          const kept=associations.filter(a=>!["irot","imir"].includes(property(a).type));
          if(mirror===null)kept.push(kept.find(a=>property(a).type==="ispe"));
          const transforms=order==="mirror-first"?[...(mirror===null?[]:[reflection]),rotation]:[rotation,...(mirror===null?[]:[reflection])];
          const updated=setItemPropertyAssociations(data.slice(d.meta.off,d.meta.off+d.meta.size),iid,[...kept,...transforms].map(a=>[a.index,a.essential]));
          // Repeating the same descriptive ispe in the no-mirror variant keeps
          // metadata length and idat offsets fixed without adding a transform.
          if(updated.length!==d.meta.size)throw Error("orientation fixture changed byte offsets");data.set(updated,d.meta.off);
          d=discoverImageItems(data);const canonical=itemOrientation(data,d.props,iid);
          const asm=await decodeImageItem(data,d,iid,{decoder:"libheif",auxiliaryData});
          count=0;const web=await decodeImageItem(data,d,iid,{decoder:"webcodecs",auxiliaryData});
          const stored=matteToStored(web,canonical.angle,canonical.mirror);
          const prepared=prepareLinearPixels(asm,canonical);
          const rawPoints=[[.2,.2],[.8,.2],[.2,.8],[.8,.8]];
          const pointPixels=rawPoints.map(([x,y])=>{
            const point=storedPointToDisplay(x,y,canonical.angle,canonical.mirror);
            const pixel=web.getContext("2d").getImageData(Math.floor(point.x*web.width),Math.floor(point.y*web.height),1,1).data[0];
            const inverse=displayPointToStored(point.x,point.y,canonical.angle,canonical.mirror);
            if(Math.abs(inverse.x-x)>1e-12||Math.abs(inverse.y-y)>1e-12)throw Error("geometry does not invert");
            const landmarks=Array.from({length:478},()=>point);
            const first=peopleEntry(landmarks,{averageColor:[0,0,0],roughness:0},"test",canonical.angle,canonical.mirror).get("faceLandmarks")[0].get("point");
            if(Math.abs(first.get("x")-x)>1e-12||Math.abs(first.get("y")-y)>1e-12)throw Error("people metadata does not match pixels");
            return pixel;
          });
          let rgbPixels;
          if(iid===d.primary) {
            count=0;const rgb=await decodeToRgb(data,{width:stored.width,height:stored.height,...canonical,decoder:"webcodecs"});
            rgbPixels=rawPoints.map(([x,y])=>rgb[(Math.floor(y*stored.height)*stored.width+Math.floor(x*stored.width))*3]);
          }
          const linearPixels=rawPoints.map(([x,y])=>prepared.rgba[(Math.floor(y*prepared.height)*prepared.width+Math.floor(x*prepared.width))*4]/(prepared.floating?1:255));
          results.push({path,rectangular,order,angle,mirror,canonical,asm:read(asm),web:read(web),dimensions:[web.width,web.height],asmDimensions:[asm.width,asm.height],stored:read(stored),pointPixels,rgbPixels,linearPixels});
          for(const surface of [asm,web,stored])surface.width=surface.height=0;
        }
      }
      return results;
    }finally{globalThis.VideoDecoder=NativeDecoder;}
  });
  assert.equal(transformOrder.length,120);
  for(const result of transformOrder) {
    const detail=`${result.path} ${result.rectangular?"rectangular":"square"} ${result.order} ${result.angle}/${result.mirror}`;
    assert.deepEqual(result.dimensions,result.asmDimensions,detail);
    for(let i=0;i<4;i++) {
      assert.ok(Math.abs(result.web[i]-result.asm[i])<=3,`${detail}: ${JSON.stringify(result)}`);
      for(const values of [result.stored,result.pointPixels,...(result.rgbPixels?[result.rgbPixels]:[])])
        assert.ok(Math.abs(values[i]-samples[i].expected)<=3,`${detail} stored/metadata pixels: ${values}`);
      assert.ok(Math.abs(result.linearPixels[i]-samples[i].expected/255)<.02,`${detail} linear source: ${result.linearPixels}`);
    }
  }

  // Reproduce Windows browsers that reject HEIC in both native image APIs.
  // Keep the pinned software decoder real for explicit source decoding. Output
  // routes reject an unavailable encoder before attempting that expensive decode.
  const sourceBrowser=await context();
  const sourceFallback=await sourceBrowser.page.evaluate(async()=>{
    const {openHeicSource,prepareHeicAuxiliaries,prepareHeicLinearThumbnail,importRaster}=await import("./src/raster-import.js?v=0.7.0");
    const {discoverHeic,discoverImageItems}=await import("./src/heif.js?v=0.7.0");
    const {prepareLinearPixels}=await import("./src/linear-thumbnail.js?v=0.7.0");
    const {irotAngleForItem,imirAxisForItem}=await import("./src/heif.js?v=0.7.0");
    const data=new Uint8Array(await (await fetch("/sample.heic")).arrayBuffer());
    const file=new File([data],"windows.heic",{type:"image/heic"}),d=discoverHeic(data);
    const saved={bitmap:globalThis.createImageBitmap,decode:Image.prototype.decode,decoder:globalThis.VideoDecoder,encoder:globalThis.VideoEncoder};
    globalThis.createImageBitmap=async()=>{throw Error("native HEIC unsupported");};
    Image.prototype.decode=async()=>{throw Error("native HEIC unsupported");};
    globalThis.VideoDecoder=undefined;
    globalThis.VideoEncoder=class {static async isConfigSupported(config){return {supported:false,config};}};
    const results=[];
    try {
      let strictError;const strictProgress=[];
      try{await openHeicSource(file,data,{decoder:"webcodecs",onProgress:e=>strictProgress.push(e)});}catch(error){strictError=error.message;}
      if(globalThis.libheif)throw Error("strict source fallback loaded asm.js");
      for(const decoder of ["auto","libheif"]) {
        const progress=[];
        const opened=await openHeicSource(file,data,{decoder,onProgress:e=>progress.push(e)});
        const read=(x,y)=>opened.image.getContext("2d").getImageData(x,y,1,1,{colorSpace:"srgb"}).data[0];
        const corners=[[8,8],[56,8],[8,56],[56,56]].map(([x,y])=>read(x,y));
        const contextColor=opened.image.getContext("2d").getContextAttributes().colorSpace;
        const prepared=prepareLinearPixels(opened.image,{angle:irotAngleForItem(data,d.props,d.primary),mirror:imirAxisForItem(data,d.props,d.primary)});
        const linearCorners=[[8,8],[56,8],[8,56],[56,56]].map(([x,y])=>prepared.rgba[(y*64+x)*4]);
        const floating=prepared.floating;
        opened.close();
        const errors={};
        for(const [route,run] of [
          ["auxiliary",()=>prepareHeicAuxiliaries(file,{...d,thumbnail:null},e=>progress.push(e),{bytes:data,decoder})],
          ["linear",()=>prepareHeicLinearThumbnail(file,data,d,e=>progress.push(e),{decoder})],
          ["reencode",()=>importRaster(file,{},e=>{progress.push(e);if(e.stage==="prepare")throw Error("source-ready");},{heicAnalysis:{bytes:data,decoder,sceneStats:false}})],
        ]) {try{await run();}catch(error){errors[route]=error.message;}}
        results.push({decoder,progress,corners,contextColor,linearCorners,floating,closed:[opened.image.width,opened.image.height],errors});
      }
      const orientationResults=[];
      const mirrorBox=d.props.properties.find(p=>p.type==="imir").box;
      const rotationBox=d.props.properties.find(p=>p.type==="irot").box;
      const associationPos=d.props.ipmaBox.off+d.props.ipmaBox.hdr+11;
      for(const angle of [0,90,180,270])for(const mirror of [null,0,1]) {
        const variant=data.slice();variant[rotationBox.off+rotationBox.hdr]=angle/90;
        if(mirror===null)variant[associationPos+1]=0;
        else variant[mirrorBox.off+mirrorBox.hdr]=mirror;
        const opened=await openHeicSource(new File([variant],"oriented.heic"),variant,{decoder:"libheif"});
        const prepared=prepareLinearPixels(opened.image,{angle,mirror});
        const samples=[[8,8],[56,8],[8,56],[56,56]].map(([x,y])=>prepared.rgba[(y*64+x)*4]/(prepared.floating?1:255));
        orientationResults.push({angle,mirror,samples});opened.close();
      }
      let unsupportedError;
      const unsupported=new Uint8Array(await (await fetch("/gray-main.heic")).arrayBuffer());
      try{await openHeicSource(new File([unsupported],"unsupported.heic"),unsupported,{decoder:"libheif"});}
      catch(error){unsupportedError=error.message;}
      const neutralProgress=[];let neutralError;
      try{await prepareHeicAuxiliaries(file,{...d,thumbnail:999,hdrGrid:null},e=>neutralProgress.push(e),{bytes:data,decoder:"webcodecs"});}
      catch(error){neutralError=error.message;}
      return {strictError,strictProgress,results,orientationResults,unsupportedError,neutralProgress,neutralError};
    }finally{globalThis.createImageBitmap=saved.bitmap;Image.prototype.decode=saved.decode;globalThis.VideoDecoder=saved.decoder;globalThis.VideoEncoder=saved.encoder;}
  });
  assert.match(sourceFallback.strictError,/HEIC source decode failed: HEVC WebCodecs decoder unavailable/);
  assert.ok(!sourceFallback.strictProgress.some(e=>e.source==="libheif-js (asm.js)"));
  for(const result of sourceFallback.results) {
    assert.equal(result.contextColor,"display-p3");assert.deepEqual(result.closed,[0,0]);
    for(let i=0;i<4;i++)assert.ok(Math.abs(result.corners[i]-expected[i])<=3,"source fallback preserves displayed grid orientation");
    // Undo irot/imir for the independent linear thumbnail; compare source samples
    // before linearization to independently decoded tile values.
    for(let i=0;i<4;i++)assert.ok(Math.abs(result.linearCorners[i]/(result.floating?1:255)-samples[i].expected/255)<0.02,`linear source recovers stored orientation: ${result.linearCorners} vs ${samples.map(s=>s.expected)}, floating=${result.floating}`);
    assert.match(result.errors.auxiliary,/HEVC WebCodecs encoder unavailable/);
    assert.match(result.errors.linear,/HEVC encoder unavailable/);
    assert.match(result.errors.reencode,/HEVC WebCodecs encoder unavailable/);
    assert.ok(result.progress.some(e=>e.source==="libheif-js (asm.js)"));
    assert.ok(result.progress.some(e=>e.source==="Image.decode()"&&e.decodeError));
    if(result.decoder==="auto")assert.ok(result.progress.some(e=>e.source==="libheif-js (asm.js)"&&/decoder unavailable/.test(e.fallbackReason)));
  }
  assert.equal(sourceBrowser.hits.asm,1,"software source fallback loads the pinned decoder only once");
  assert.match(sourceFallback.unsupportedError,/HEIC source decode failed: HEIC source ICC color management unavailable/);
  for(const result of sourceFallback.orientationResults)for(let i=0;i<4;i++)
    assert.ok(Math.abs(result.samples[i]-samples[i].expected/255)<0.02,`linear orientation ${result.angle}/${result.mirror}: ${result.samples}`);
  assert.match(sourceFallback.neutralError,/HEVC WebCodecs encoder unavailable/);
  assert.ok(!sourceFallback.neutralProgress.some(e=>e.operation==="decode"),"a neutral HDR map needs no photo decode");

  const asmSourceColor=await sourceBrowser.page.evaluate(async reference=>{
    const {openHeicSource}=await import("./src/raster-import.js?v=0.7.0");
    const saved=globalThis.createImageBitmap,savedDecode=Image.prototype.decode;
    globalThis.createImageBitmap=async()=>{throw Error("native HEIC unsupported");};
    Image.prototype.decode=async()=>{throw Error("native HEIC unsupported");};
    const results=[];
    try {
      for(const linear of [false,true]) {
        const data=new Uint8Array(await (await fetch(`/source-p3${linear?"-linear":""}.heic`)).arrayBuffer());
        const opened=await openHeicSource(new File([data],"color.heic"),data,{decoder:"libheif"});
        const actual=[...opened.image.getContext("2d").getImageData(8,8,1,1,{colorSpace:"display-p3"}).data];
        opened.close();
        // FFmpeg independently decodes the compressed colored HEVC samples. For
        // a linear ICC, a real native VideoFrame performs the display transfer.
        const frame=new VideoFrame(new Uint8Array(reference),{format:"RGBA",codedWidth:1,codedHeight:1,timestamp:0,
          colorSpace:{primaries:"smpte432",transfer:linear?"linear":"iec61966-2-1",matrix:"rgb",fullRange:true}});
        const canvas=document.createElement("canvas");canvas.width=canvas.height=1;
        const ctx=canvas.getContext("2d",{colorSpace:"display-p3"});ctx.drawImage(frame,0,0);frame.close();
        const expected=[...ctx.getImageData(0,0,1,1,{colorSpace:"display-p3"}).data];
        results.push({linear,actual,expected});
      }
    }finally{globalThis.createImageBitmap=saved;Image.prototype.decode=savedDecode;}
    return results;
  },realColor.rgba);
  for(const result of asmSourceColor)for(let i=0;i<4;i++)
    assert.ok(Math.abs(result.actual[i]-result.expected[i])<=3,`asm.js P3 source ${result.linear?"linear":"sRGB transfer"}: ${JSON.stringify(result)}`);

  // Exercise the HEIC compatibility re-encode analysis route using a PNG native
  // input surface. Stop before encoding so this check needs no HEVC encoder.
  const reencodeAnalysis=await real.page.evaluate(async()=>{
    const {importRaster}=await import("./src/raster-import.js?v=0.7.0");
    const data=new Uint8Array(await (await fetch("/sample.heic")).arrayBuffer());
    const surface=document.createElement("canvas");surface.width=surface.height=64;
    const blob=await new Promise(resolve=>surface.toBlob(resolve,"image/png"));
    const file=new File([blob],"native-surface.png",{type:"image/png"});
    const nativeEncoder=globalThis.VideoEncoder,nativeDecoder=globalThis.VideoDecoder;
    globalThis.VideoEncoder=class {static async isConfigSupported(config){return {supported:true,config};}};
    globalThis.VideoDecoder=undefined;
    const results=[];
    try {
      for(const decoder of ["libheif","webcodecs","auto"]) {
        const progress=[];
        try {
          await importRaster(file,{},event=>{
            progress.push(event);
            if(event.stage==="linear")throw Error("stop-before-encoding");
          },{heicAnalysis:{bytes:data.slice(),decoder,sceneStats:true}});
        }catch(error){if(error.message!=="stop-before-encoding")throw error;}
        results.push({decoder,progress});
      }
    }finally{globalThis.VideoEncoder=nativeEncoder;globalThis.VideoDecoder=nativeDecoder;}
    return results;
  });
  for(const result of reencodeAnalysis) {
    assert.ok(result.progress.some(e=>e.stage==="analysis"));
    const sources=result.progress.filter(e=>e.stage==="codec").map(e=>e.source);
    assert.ok(sources.includes("createImageBitmap"),"re-encoding retains its native input");
    if(result.decoder==="webcodecs") {
      assert.ok(result.progress.some(e=>e.stage==="analysisUnavailable"&&/decoder unavailable/.test(e.reason)));
      assert.ok(!sources.includes("libheif-js (asm.js)"),"strict WebCodecs cannot analyze with asm.js or native pixels");
    }else{
      assert.ok(sources.includes("libheif-js (asm.js)"));
      assert.ok(!result.progress.some(e=>e.stage==="analysisUnavailable"));
    }
  }

  const controlled=await context();
  const events=await controlled.page.evaluate(async expected=>{
    const nativeDecoder=globalThis.VideoDecoder;
    let count=0;
    globalThis.VideoDecoder=class {
      static async isConfigSupported(config){return {supported:true,config};}
      constructor(callbacks){this.callbacks=callbacks;this.state="unconfigured";}
      configure(config){this.config=config;this.state="configured";}
      decode(){const c=document.createElement("canvas");c.width=c.height=32;const value=expected[count++%4];
        const ctx=c.getContext("2d");ctx.fillStyle=`rgb(${value},${value},${value})`;ctx.fillRect(0,0,32,32);
        c.close=()=>{};this.callbacks.output(c);}
      async flush(){} close(){this.state="closed";}
    };
    const data=new Uint8Array(await (await fetch("/sample.heic")).arrayBuffer());
    const decoder=await import("./src/decode.js?v=0.7.0"),progress=[];
    const onProgress=event=>progress.push(event);
    const web=await decoder.decodeToDisplayCanvas(data,{decoder:"auto",onProgress});
    const corners=[[8,8],[56,8],[8,56],[56,56]].map(([x,y])=>web.getContext("2d").getImageData(x,y,1,1).data[0]);
    const noFallbackLoaded=!globalThis.libheif;
    globalThis.VideoDecoder=undefined;
    let forcedError;
    try{await decoder.decodeToDisplayCanvas(data,{decoder:"webcodecs",onProgress});}catch(error){forcedError=error.message;}
    const fallback=await decoder.decodeToDisplayCanvas(data.slice(),{decoder:"auto",onProgress});
    const fallbackCorners=[[8,8],[56,8],[8,56],[56,56]].map(([x,y])=>fallback.getContext("2d").getImageData(x,y,1,1).data[0]);
    globalThis.VideoDecoder=nativeDecoder;
    return {corners,noFallbackLoaded,forcedError,fallbackCorners,progress};
  },samples.map(s=>s.expected));
  assert.equal(events.noFallbackLoaded,true);assert.match(events.forcedError,/decoder unavailable/);
  assert.deepEqual(events.corners,expected);assert.equal(controlled.hits.asm,1);
  assert.ok(events.progress.some(e=>e.source==="libheif-js (asm.js)"&&/decoder unavailable/.test(e.fallbackReason)));
  for(let i=0;i<4;i++)assert.ok(Math.abs(events.fallbackCorners[i]-events.corners[i])<=3);
  const iccBrowser=await context();
  const iccColors=await iccBrowser.page.evaluate(async pixels=>{
    const {decodeToDisplayCanvas}=await import("./src/decode.js?v=0.7.0");
    const {applyDecodedColorSpace}=await import("./src/webcodecs-color.js?v=0.7.0");
    const NativeDecoder=globalThis.VideoDecoder,progress=[],results=[],configs=[],diagnostics=[];
    let ignoreOverride=false,outputFormat="I420",wideGamut=false;
    globalThis.VideoDecoder=class {
      static async isConfigSupported(config){return {supported:true,config};}
      constructor(callbacks){this.callbacks=callbacks;this.state="unconfigured";}
      configure(config){this.config=config;configs.push(config.colorSpace);this.state="configured";}
      decode(){const samples=new Uint8Array(pixels);
        if(wideGamut){samples.fill(80,32*32,32*32*5/4);samples.fill(240,32*32*5/4);}
        if(outputFormat==="NV12")for(let i=32*32;i<samples.length;i+=2){samples[i]=100;samples[i+1]=150;}
        this.callbacks.output(new VideoFrame(samples,{format:outputFormat,codedWidth:32,codedHeight:32,timestamp:0,
        colorSpace:ignoreOverride ? {primaries:"bt709",transfer:"bt709",matrix:"bt709",fullRange:false} : this.config.colorSpace}));}
      async flush(){}close(){this.state="closed";}
    };
    let sourceGamut;
    try {
      for(const [space,matrix,ignore,format,source] of [
        ["srgb","bt709",false,"I420"],["p3","bt709",false,"I420"],
        ["p3","bt709",true,"I420"],["p3","bt709",true,"NV12"],["p3","bt709",false,"NV12"],
        ["p3","smpte170m",false,"I420"],["p3","smpte170m",true,"I420"],
        ["p3","smpte170m",false,"NV12"],["p3","smpte170m",true,"NV12"],
        ["p3","smpte170m",true,"I420","p3-601-sps"],["p3","smpte170m",true,"NV12","p3-601-sps"],
      ]) {
        ignoreOverride=ignore;outputFormat=format;
        const name=source || (matrix==="bt709"?space:`${space}-601`);
        const data=new Uint8Array(await (await fetch(`/icc-${name}.heic`)).arrayBuffer());
        const decoded=await decodeToDisplayCanvas(data,{decoder:ignoreOverride?"webcodecs":"auto",diagnostics,onProgress:event=>progress.push(event)});
        const reference=await createImageBitmap(await (await fetch(`/icc-${name}.png`)).blob());
        const canvas=document.createElement("canvas");canvas.width=canvas.height=32;
        canvas.getContext("2d").drawImage(reference,0,0);reference.close();
        const read=c=>[...c.getContext("2d").getImageData(8,8,1,1).data];
        results.push({space,matrix,source:name,ignoreOverride,outputFormat,actual:read(decoded),reference:read(canvas)});
        if(ignoreOverride){
          await decodeToDisplayCanvas(data,{decoder:"webcodecs",onProgress:event=>progress.push(event)});
          if(!progress.at(-1).colorCorrection)throw Error("Cached decode lost the ICC correction label");
        }
      }
      wideGamut=true;ignoreOverride=true;outputFormat="I420";
      const data=new Uint8Array(await (await fetch("/icc-p3.heic")).arrayBuffer());
      const nativeBitmap=globalThis.createImageBitmap,nativeImageDecode=Image.prototype.decode;
      globalThis.createImageBitmap=async()=>{throw Error("native HEIC unsupported");};
      Image.prototype.decode=async()=>{throw Error("native HEIC unsupported");};
      try {
        const {openHeicSource}=await import("./src/raster-import.js?v=0.7.0");
        const opened=await openHeicSource(new File([data],"p3.heic"),data,{decoder:"auto",onProgress:e=>progress.push(e)});
        const canvas=await decodeToDisplayCanvas(data,{decoder:"webcodecs",outputColorSpace:"display-p3"});
        const srgb=await decodeToDisplayCanvas(data,{decoder:"webcodecs"});
        const clipped=document.createElement("canvas");clipped.width=clipped.height=64;
        clipped.getContext("2d",{colorSpace:"display-p3"}).drawImage(srgb,0,0);
        const read=c=>[...c.getContext("2d").getImageData(8,8,1,1,{colorSpace:"display-p3"}).data];
        const samples=new Uint8Array(pixels);samples.fill(80,32*32,32*32*5/4);samples.fill(240,32*32*5/4);
        const frame=new VideoFrame(samples,{format:"I420",codedWidth:32,codedHeight:32,timestamp:0,
          colorSpace:{primaries:"smpte432",transfer:"iec61966-2-1",matrix:"bt709",fullRange:false}});
        const reference=document.createElement("canvas");reference.width=reference.height=32;
        reference.getContext("2d",{colorSpace:"display-p3"}).drawImage(frame,0,0);frame.close();
        sourceGamut={actual:read(opened.image),cachedP3:read(canvas),reference:read(reference),clipped:read(clipped),colorSpace:opened.image.getContext("2d").getContextAttributes().colorSpace};
        opened.close();
      }finally{globalThis.createImageBitmap=nativeBitmap;Image.prototype.decode=nativeImageDecode;}
    }finally{globalThis.VideoDecoder=NativeDecoder;}
    const raw=new VideoFrame(new Uint8Array(pixels),{format:"I420",codedWidth:32,codedHeight:32,timestamp:7,
      visibleRect:{x:2,y:2,width:28,height:28},displayWidth:28,displayHeight:28,
      colorSpace:{primaries:"bt709",transfer:"bt709",matrix:"bt709",fullRange:false}});
    let repaired;
    try {
      repaired=await applyDecodedColorSpace(raw,{primaries:"smpte432",transfer:"iec61966-2-1",matrix:"smpte170m",fullRange:false},"Display P3");
      const options={rect:{x:0,y:0,width:raw.codedWidth,height:raw.codedHeight}},before=new Uint8Array(raw.allocationSize(options)),after=new Uint8Array(repaired.allocationSize(options));
      await raw.copyTo(before,options);await repaired.copyTo(after,options);
      if(before.some((v,i)=>v!==after[i]))throw Error("ICC repair changed native samples");
      if(["x","y","width","height"].some(k=>repaired.visibleRect[k]!==raw.visibleRect[k])||repaired.displayWidth!==raw.displayWidth)throw Error("ICC repair lost the crop/display geometry");
    }finally{repaired?.close();raw.close();}
    return {results,progress,configs,diagnostics,sourceGamut,noAsm:!globalThis.libheif};
  },[...colorYuv]);
  assert.equal(iccColors.noAsm,true);assert.equal(iccBrowser.hits.asm,0,"standard ICC success cannot download asm.js");
  assert.equal(iccColors.sourceGamut.colorSpace,"display-p3");
  assert.deepEqual(iccColors.sourceGamut.actual,iccColors.sourceGamut.reference,"WebCodecs source fallback must retain actual P3 colors");
  assert.deepEqual(iccColors.sourceGamut.cachedP3,iccColors.sourceGamut.reference,"P3 and sRGB cache entries are separate");
  assert.notDeepEqual(iccColors.sourceGamut.clipped,iccColors.sourceGamut.reference,"source conversion cannot go through a clipped sRGB intermediate");
  for(const matrix of ["bt709","smpte170m"])for(const format of ["I420","NV12"]) {
    const pair=iccColors.results.filter(r=>r.space==="p3"&&r.matrix===matrix&&r.outputFormat===format);
    for(const result of pair.slice(1))assert.deepEqual(pair[0].actual,result.actual,`${matrix} ${format} repair must match correctly labeled native rendering`);
  }
  // Different browser YUV rendering paths can yield different 8-bit pixels.
  // The ICC correction must introduce zero error relative to the same format;
  // independently compare the planar path to FFmpeg + ICC-managed PNG pixels.
  for(const result of iccColors.results.filter(r=>r.outputFormat==="I420"))for(let i=0;i<4;i++)
    assert.ok(Math.abs(result.actual[i]-result.reference[i])<=2,`${result.space} ICC channel ${i}: ${result.actual} vs independent PNG ${result.reference}`);
  assert.notDeepEqual(iccColors.results[0].reference,iccColors.results[1].reference,"PNG reference must exercise actual ICC color management");
  assert.ok(iccColors.progress.some(e=>e.colorProfile==="Display P3"));
  assert.ok(iccColors.progress.some(e=>e.colorCorrection),"corrected decode reports the correction label");
  assert.ok(iccColors.configs.every(c=>["bt709","smpte170m"].includes(c.matrix)&&c.fullRange===false),"ICC configs must retain actual SPS/nclx matrix/range");
  assert.ok(iccColors.diagnostics.some(d=>d.colorCorrection&&d.decoderColorSpace.primaries==="bt709"&&d.colorSpace.primaries==="smpte432"));
  assert.ok(iccColors.diagnostics.some(d=>d.colorCorrection&&d.decoderColorSpace.matrix==="bt709"&&d.colorSpace.matrix==="smpte170m"),"ignored smpte170m matrix must be corrected before RGB conversion");
  const p3Matrices=iccColors.results.filter(r=>r.space==="p3"&&r.outputFormat==="I420"&&!r.ignoreOverride);
  assert.notDeepEqual(p3Matrices[0].actual,p3Matrices[1].actual,"colored samples must distinguish BT.709 from smpte170m");
  const grayBrowser=await context();
  const grayResults=await grayBrowser.page.evaluate(async()=>{
    const {decodeImageItem,decodeToDisplayCanvas}=await import("./src/decode.js?v=0.7.0");
    const {discoverHeic}=await import("./src/heif.js?v=0.7.0");
    const {buildHeicInspection}=await import("./src/native-mattes.js?v=0.7.0");
    const NativeDecoder=globalThis.VideoDecoder,events=[],results=[];
    let grid=false,count=0,format="I420";
    globalThis.VideoDecoder=class {
      static async isConfigSupported(config){return{supported:true,config};}
      constructor(callbacks){this.callbacks=callbacks;this.state="unconfigured";}
      configure(){this.state="configured";}
      decode(){const pixels=new Uint8Array(32*32*3/2);pixels.fill(grid?[16,64,128,235][count++%4]:128,0,32*32);
        pixels.fill(40,32*32,32*32*5/4);pixels.fill(210,32*32*5/4);
        if(format==="NV12")for(let p=32*32;p<pixels.length;p+=2){pixels[p]=40;pixels[p+1]=210;}
        this.callbacks.output(new VideoFrame(pixels,{format,codedWidth:32,codedHeight:32,timestamp:0,
          colorSpace:{primaries:"bt709",transfer:"bt709",matrix:"bt709",fullRange:false}}));}
      async flush(){}close(){this.state="closed";}
    };
    const onProgress=event=>events.push(event);
    try {
      for(format of ["I420","NV12"])for(grid of [false,true]) {
        count=0;
        const data=new Uint8Array(await(await fetch(grid?"/gray-gain-grid.heic":"/gray-mask.heic")).arrayBuffer());
        const inventory=await buildHeicInspection(data,discoverHeic(data),{decoder:"webcodecs",onProgress});
        const entry=inventory.entries.get(grid?"HDR gain map":"portraiteffectsmatte");
        if(entry.errors.length||entry.previews.length!==1)throw Error("Gray auxiliary preview failed: "+JSON.stringify(entry.errors));
        const image=await createImageBitmap(entry.previews[0].blob),canvas=document.createElement("canvas");canvas.width=image.width;canvas.height=image.height;
        canvas.getContext("2d").drawImage(image,0,0);image.close();
        const points=grid?[[8,8],[56,8],[8,56],[56,56]]:[[8,8]];
        const pixels=points.map(([x,y])=>[...canvas.getContext("2d").getImageData(x,y,1,1).data]);
        results.push({format,grid,pixels,coverage:entry.previews[0].coverage});
      }
      const main=new Uint8Array(await(await fetch("/gray-main.heic")).arrayBuffer()),discovery=discoverHeic(main);
      let primaryError,forcedPrimaryError,customError;
      try{await decodeToDisplayCanvas(main,{decoder:"webcodecs"});}catch(error){primaryError=error.message;}
      try{await decodeImageItem(main,discovery,discovery.primary,{decoder:"webcodecs",auxiliaryData:true});}catch(error){forcedPrimaryError=error.message;}
      const custom=new Uint8Array(await(await fetch("/gray-custom.heic")).arrayBuffer());
      try{await decodeImageItem(custom,discoverHeic(custom),20,{decoder:"webcodecs",auxiliaryData:true,onProgress});}catch(error){customError=error.message;}
      if(globalThis.libheif)throw Error("Strict gray tests unexpectedly loaded asm.js");
      await decodeImageItem(custom,discoverHeic(custom),20,{decoder:"auto",auxiliaryData:true,onProgress});
      return{results,events,primaryError,forcedPrimaryError,customError};
    }finally{globalThis.VideoDecoder=NativeDecoder;}
  });
  for(const result of grayResults.results) {
    const values=result.grid?[0,130,56,255]:[130];
    assert.deepEqual(result.pixels,values.map(v=>[v,v,v,255]),`${result.format} gray samples preserve scalar values and orientation`);
    if(!result.grid)assert.ok(Math.abs(result.coverage-130/255)<1e-12,"gray mask coverage must use data values, without display gamma");
  }
  assert.match(grayResults.primaryError,/unsupported profile type/);assert.match(grayResults.forcedPrimaryError,/unsupported profile type/);
  assert.match(grayResults.customError,/tone curve/);
  assert.ok(grayResults.events.some(e=>e.dataPreview&&e.colorProfile==="Gray Linear"));
  assert.ok(grayResults.events.some(e=>e.source==="libheif-js (asm.js)"&&/tone curve/.test(e.fallbackReason)));
  assert.equal(grayBrowser.hits.asm,1,"only the auto custom-profile case may load asm.js");
  await real.page.selectOption("#decoder","auto");
  const english=await real.page.locator("#lang").getAttribute("data-i18n");assert.equal(english,"lang.name");
  await real.page.locator("#lang").click();
  assert.match(await real.page.locator('option[value="auto"]').textContent(),/Auto/);
  await real.page.locator("#lang").click();
  for(const width of [390,1440]) {
    await real.page.setViewportSize({width,height:1000});
    assert.ok(await real.page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await real.page.locator(".decoder-settings").screenshot({path:path.join(dir,`settings-${width}.png`)});
  }
  console.log(JSON.stringify({reference:expected,asm:actual.corners,auxiliary:actual.auxiliary,native:actual.native,controlledAuto:events.corners,scriptRequests:controlled.hits.asm,icc:iccColors.results,gray:grayResults.results}));
  console.log("120 orientation cases against real asm.js: both property orders, rotations/mirrors, square/rectangular grids, direct images, grayscale auxiliaries, stored masks/person coordinates/linear thumbnails/RGB analysis passed. Decoder selection, Windows native failure fallback, P3 gamut retention and ICC/YUV correction also passed.");
} finally {await browser?.close();await new Promise(resolve=>server.close(resolve));}
