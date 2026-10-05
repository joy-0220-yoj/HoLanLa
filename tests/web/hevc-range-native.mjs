// Optional regression with real FFmpeg HEVC encode/decode behind the WebCodecs boundary.
// Browser metadata deliberately lies about range and the SPS omits VUI, as in the reported photo.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {boxes, topBox, findChild, u, concat, be} from '../../web/src/box.js';
import {readSpsInfo} from '../../web/src/hevc-linear-tags.js';
import {encodeCanvases} from '../../web/src/raster-import.js';
import {encodeLinearThumbnail8, p3ToLinearI420} from '../../web/src/linear-thumbnail.js';

const dir = path.resolve('tests/web/.cache/hevc-range'); fs.mkdirSync(dir, {recursive:true});
const ffmpeg = process.env.FFMPEG_EXECUTABLE || 'ffmpeg';
const run = (args, input) => execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], {input, maxBuffer:16*1024*1024});
const size = 32, plane = size * size;
const rgba = new Uint8ClampedArray(plane * 4);
for (let y=0;y<size;y++) for(let x=0;x<size;x++) {
  const v = x < 8 ? 0 : x >= 24 ? 255 : 128;
  rgba.set([v,v,v,255],(y*size+x)*4);
}
function nals(record) {
  const result=[];let pos=23;
  for(let i=0;i<record[22];i++){const type=record[pos++]&63,count=u(record,pos,2);pos+=2;
    for(let j=0;j<count;j++){const n=u(record,pos,2);pos+=2;result.push({type,nal:record.slice(pos,pos+n)});pos+=n;}}
  return result;
}
function noVui(nal) {
  const bytes=[];for(let i=2;i<nal.length;i++){if(i>=4&&nal[i]===3&&nal[i-1]===0&&nal[i-2]===0)continue;bytes.push(nal[i]);}
  const bits=bytes.flatMap(b=>Array.from({length:8},(_,i)=>b>>(7-i)&1));
  const info=readSpsInfo(nal), next=[...bits.slice(0,info.vuiPos),0,0,1];
  while(next.length%8)next.push(0);
  const out=[nal[0],nal[1]];let zeros=0;
  for(let i=0;i<next.length;i+=8){const b=next.slice(i,i+8).reduce((a,v)=>a*2+v,0);
    if(zeros>=2&&b<=3){out.push(3);zeros=0;}out.push(b);zeros=b===0?zeros+1:0;}
  return new Uint8Array(out);
}
function mp4Sample(data) {
  const children=(b,skip=0)=>[...boxes(data,b.off+b.hdr+skip,b.off+b.size)];
  let parent=topBox(data,'moov');for(const name of ['trak','mdia','minf','stbl'])parent=findChild(children(parent),name);
  const table=children(parent),entry=children(findChild(table,'stsd'),8)[0];
  const hvcc=findChild(children(entry,78),'hvcC'),record=data.slice(hvcc.off+hvcc.hdr,hvcc.off+hvcc.size);
  const stsz=findChild(table,'stsz'),p=stsz.off+stsz.hdr;
  const length=u(data,p+4,4)||u(data,p+12,4),offset=u(data,findChild(table,'stco').off+16,4);
  const arrays=nals(record).map(({type,nal})=>{const changed=type===33?noVui(nal):nal;return concat([new Uint8Array([128|type]),be(1,2),be(changed.length,2),changed]);});
  return {record:concat([record.slice(0,23),...arrays]),payload:data.slice(offset,offset+length)};
}
function annex(record,payload) {
  const start=new Uint8Array([0,0,0,1]),chunks=nals(record).flatMap(({nal})=>[start,nal]);
  const length=(record[21]&3)+1;
  for(let pos=0;pos<payload.length;){const n=u(payload,pos,length);pos+=length;chunks.push(start,payload.slice(pos,pos+n));pos+=n;}
  return concat(chunks);
}
let fullRange=false,lastRecord;
globalThis.VideoFrame=class {constructor(data,init){this.data=data;this.init=init;}close(){}};
globalThis.EncodedVideoChunk=class {constructor(init){Object.assign(this,init);}};
globalThis.VideoEncoder=class {
  static async isConfigSupported(config){return {supported:true,config};}
  constructor({output}){this.output=output;}
  configure(config){this.config=config;}
  encode(frame){
    assert.equal(frame.init.colorSpace.fullRange,true,'input must not be compressed into limited range before the encoder');
    const file=path.join(dir,'frame.mp4');
    run(['-f','rawvideo','-pix_fmt','yuv420p','-s:v',`${size}x${size}`,'-i','pipe:0',
      '-vf',`scale=in_range=full:out_range=${fullRange?'full':'limited'}`,
      '-frames:v','1','-c:v','libx265','-preset','ultrafast','-profile:v','main',
      '-x265-params',`lossless=1:pools=none:frame-threads=1:wpp=0:colorprim=1:transfer=13:colormatrix=1:range=${fullRange?'full':'limited'}:log-level=error`,
      '-tag:v','hvc1','-y',file],frame.data);
    const {record,payload}=mp4Sample(new Uint8Array(fs.readFileSync(file)));lastRecord=record;
    this.output({byteLength:payload.length,copyTo:out=>out.set(payload)},
      {decoderConfig:{description:record,colorSpace:{primaries:'bt709',transfer:'iec61966-2-1',matrix:'bt709',fullRange:true}}});
  }
  async flush(){}close(){}
};
globalThis.VideoDecoder=class {
  constructor({output}){this.output=output;}
  configure(config){this.record=config.description;}
  decode(chunk){const data=run(['-f','hevc','-i','pipe:0','-frames:v','1','-pix_fmt','yuv420p','-f','rawvideo','pipe:1'],annex(this.record,chunk.data));
    this.output({format:'I420',visibleRect:{width:size,height:size},allocationSize:()=>data.length,
      async copyTo(out){out.set(data);return [{offset:0,stride:size}];},close(){}});}
  async flush(){}close(){}
};
globalThis.document={createElement:()=>({getContext:()=>({getContextAttributes:()=>({colorSpace:'display-p3'}),
  save(){},restore(){},translate(){},scale(){},rotate(){},drawImage(){},
  getImageData(x,y,w,h,settings){return {data:rgba,colorSpace:settings?.colorSpace||'srgb'};}})})};

for(fullRange of [false,true]) {
  const main=await encodeCanvases(size,size,1,()=>{},3_000_000);
  assert.equal(main.colr[18],fullRange?128:0,'HEIC range must describe real encoded levels, not browser metadata');
  const raw=run(['-f','hevc','-i','pipe:0','-frames:v','1','-pix_fmt','yuv420p','-f','rawvideo','pipe:1'],annex(lastRecord,main.chunks[0]));
  const expected=fullRange?[0,128,255]:[16,126,235];
  for(const [i,x]of [4,16,28].entries())assert.ok(Math.abs(raw[16*size+x]-expected[i])<=1,'real primary luma endpoint/midtone');
  const linear=await encodeLinearThumbnail8({width:size,height:size});
  assert.equal(linear.colr[18],fullRange?128:0);
  const info=readSpsInfo(nals(linear.hvcc.slice(8)).find(n=>n.type===33).nal);
  assert.equal(info.fullRange,fullRange);assert.equal(info.transfer,8);
  const decoded=run(['-f','hevc','-i','pipe:0','-frames:v','1','-pix_fmt',fullRange?'yuvj420p':'yuv420p','-f','rawvideo','pipe:1'],annex(linear.hvcc.slice(8),linear.payload));
  const linearExpected=p3ToLinearI420(rgba,size,size,false,{matrix:'bt709',fullRange});
  let maxError=0;for(let i=0;i<plane;i++)maxError=Math.max(maxError,Math.abs(decoded[i]-linearExpected[i]));
  assert.ok(maxError<=1,`linear black/mid/white levels changed by ${maxError}`);
  console.log(`Real HEVC ${fullRange?'full':'limited'} samples with absent VUI and fullRange=true metadata: primary and P3-linear thumbnail passed`);
}
