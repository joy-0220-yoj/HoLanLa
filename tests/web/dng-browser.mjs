// Real LibRaw WASM and FFmpeg 10-bit thumbnail; WebCodecs Main8 is stubbed on CI.
// DNG_SAMPLE_FILE optionally adds a local real camera sample; no photo is served or committed.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {DNG_ASSETS} from '../../web/src/dng-assets.js';
import {FFMPEG_ASSETS} from '../../web/src/ffmpeg-assets.js';
import {ORT_ASSETS} from '../../web/src/ort-assets.js';
import {dngFixture, tiledDngFixture, dngInspectionFixture} from './dng-fixture.mjs';

const root = fileURLToPath(new URL('../../web/', import.meta.url));
const assets = [...DNG_ASSETS, ...FFMPEG_ASSETS, ...ORT_ASSETS];
const ortNames=['ort.wasm.min.mjs','ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm','face-detector-nhwc.onnx','face-landmarks.onnx','selfie.onnx'];
const saved = new Map();
for (const asset of assets) {
  const ortIndex=ORT_ASSETS.indexOf(asset), name=ortIndex<0?asset.url.split('/').pop():ortNames[ortIndex];
  const directory = ortIndex>=0?process.env.ORT_FIXTURE_DIR:asset.url.includes('libraw-wasm') ? process.env.DNG_CORE_DIR : process.env.FFMPEG_CORE_DIR;
  let file = path.join(directory || 'tests/web/.cache/dng-runtime', name);
  if (directory && name.startsWith('ffmpeg') && fs.existsSync(path.join(directory, 'mt-' + name))) file = path.join(directory, 'mt-' + name);
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), {recursive:true});
    const response = await fetch(asset.url); assert.ok(response.ok, `download ${asset.url}`);
    const data = Buffer.from(await response.arrayBuffer());
    assert.equal(crypto.createHash('sha256').update(data).digest('hex'), asset.sha256);
    fs.writeFileSync(file, data);
  }
  assert.equal(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'), asset.sha256);
  saved.set(asset.url, file);
}
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = http.createServer((req,res) => {
  const url = new URL(req.url,'http://localhost'), file = path.resolve(root, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(path.resolve(root) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {res.writeHead(404).end();return;}
  res.writeHead(200, {'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp',
    'Content-Security-Policy': "script-src 'self' blob: 'unsafe-eval'; object-src 'none'",
    'Content-Type':file.endsWith('.js')?'text/javascript':file.endsWith('.html')?'text/html':'application/octet-stream'});
  res.end(fs.readFileSync(file));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE || undefined});
  const context = await browser.newContext({serviceWorkers:'block',locale:'zh-TW'}), downloads=[], unexpected=[], injected=[];
  let blockAssets = false;
  await context.route('**/*',route=>{
    const request=route.request(), url=request.url();
    // Some Windows antivirus installations inject this script into local HTML.
    // Block it and report it separately; it is not part of the application under test.
    if (new URL(url).hostname === 'me.kis.v2.scr.kaspersky-labs.com') {injected.push(url);return route.abort();}
    if (request.method() !== 'GET' || request.postData()) {unexpected.push(url);return route.abort();}
    if(url.startsWith(origin)||url.startsWith('blob:')) return route.continue();
    if(saved.has(url)&&!blockAssets){downloads.push(url);return route.fulfill({path:saved.get(url),
      headers:{'Access-Control-Allow-Origin':'*','Cross-Origin-Resource-Policy':'cross-origin'},
      contentType:/\.m?js$/.test(url)?'text/javascript':url.endsWith('.wasm')?'application/wasm':'application/octet-stream'});}
    unexpected.push(url);return route.abort();
  });
  await context.addInitScript(() => {
    const NativeWorker=globalThis.Worker, live=new Set();
    globalThis.testWorkerEvents=[];
    globalThis.Worker=class extends NativeWorker{
      constructor(url,options){
        const kind=String(url).includes('ort-inference-worker')?'ort':String(url).includes('ffmpeg-worker')?'ffmpeg':String(url).includes('dng-worker')?'dng':'other';
        if(kind!=='other'&&[...live].some(worker=>worker.kind!=='other'&&worker.kind!==kind))
          throw Error('Large WASM workers overlap: '+kind);
        let actual=url, mock;
        if(kind==='ort'&&globalThis.testForceOrtOOM){
          mock=URL.createObjectURL(new Blob([`self.onmessage=({data})=>self.postMessage({id:data.id,...(data.operation==='create'?{error:{name:'RangeError',message:'Out of memory'}}:{})});`],{type:'text/javascript'}));
          actual=mock;
        }
        super(actual,options);this.kind=kind;this.mock=mock;live.add(this);
        testWorkerEvents.push({kind,event:'start'});
      }
      terminate(){super.terminate();if(this.mock)URL.revokeObjectURL(this.mock);live.delete(this);testWorkerEvents.push({kind:this.kind,event:'stop'});}
    };
    globalThis.testLiveWorkers=()=>[...live].map(worker=>worker.kind);
    const description=Uint8Array.from(atob('AQFgAAAAkAAAAAAA//AA/P34+AAADwOgAAEAGEABDAH//wFgAAADAJAAAAMAAAMA/5WUCaEAAQArQgEBAWAAAAMAkAAAAwAAAwD/oEIIWWVlSkwuagICAggAAAMACAAAAwAIQKIAAQAGRAHAcYkS'),c=>c.charCodeAt(0));
    globalThis.VideoFrame=class{constructor(source){this.source=source;}close(){}};
    globalThis.VideoEncoder=class{
      static async isConfigSupported(config){return {supported:true,config};}
      constructor({output}){this.output=output;} configure(config){globalThis.testEncoderConfig=config;}
      encode(frame){const pixels=frame.source instanceof Uint8Array ? frame.source : frame.source.getContext('2d').getImageData(0,0,frame.source.width,frame.source.height).data;
        let sum=0;for(const p of pixels)sum=(sum+p)>>>0;const bytes=new Uint8Array([0,0,0,3,0x26,1,sum&255]);
        this.output({byteLength:bytes.length,copyTo:out=>out.set(bytes)}, {decoderConfig:{description,colorSpace:{primaries:'bt709',transfer:'bt709',matrix:'bt709',fullRange:false}}});}
      async flush(){}close(){}
    };
    globalThis.VideoDecoder=class{
      static async isConfigSupported(config){return {supported:true,config};}
      constructor({output}){this.output=output;}configure(){}
      decode(){const {width,height}=globalThis.testEncoderConfig;this.output({format:'I420',visibleRect:{width,height},allocationSize:()=>width*height*1.5,
        async copyTo(out){out.fill(16,0,width*height);out.fill(128,width*height);for(let y=0;y<height;y++)out.fill(235,y*width+width/2,(y+1)*width);return [{offset:0,stride:width}];},close(){}});}
      async flush(){}close(){}
    };
    // Only the synthetic Main8 HEIC preview uses this stub; DNG is decoded by real LibRaw.
    const bitmap=globalThis.createImageBitmap.bind(globalThis);
    globalThis.createImageBitmap=(source,...args)=>{
      if(source instanceof Blob&&source.type==='image/heic'){const canvas=document.createElement('canvas');canvas.width=canvas.height=64;return bitmap(canvas);}
      return bitmap(source,...args);
    };
    globalThis.libheif={HeifDecoder:class{decode(){return [{get_width:()=>64,get_height:()=>64,
      display(image,done){image.data.fill(128);done(image);}}];}}};
  });
  const page=await context.newPage(), errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(origin); await page.waitForFunction(()=>document.getElementById('version').textContent==='0.8.0');
  await page.locator('#faces').uncheck();
  const input=dngInspectionFixture(), original=Buffer.from(input);
  const samples=[{name:'synthetic.DNG',buffer:original}];
  if(process.env.DNG_SAMPLE_FILE)samples.push({name:'camera.dng',buffer:fs.readFileSync(process.env.DNG_SAMPLE_FILE)});
  for(const [i,sample] of samples.entries()){
    await page.locator('#file').setInputFiles({name:sample.name,mimeType:'image/x-adobe-dng',buffer:sample.buffer});
    await page.waitForFunction(count=>document.querySelectorAll('.act a[download]').length===count,i+1,{timeout:180000});
    const output=await page.evaluate(async name=>{
      const link=[...document.querySelectorAll('.act a[download]')].find(a=>a.download===name.replace(/\.dng$/i,'')+'_PhotographicStyle.HEIC');
      const {discoverHeic,dimensionsForItem,extractItemData,propertyForItem,auxUriForItem}=await import('./src/heif.js?v=0.8.0');
      const {readExifOrientation}=await import('./src/exif.js?v=0.8.0');
      const data=new Uint8Array(await (await fetch(link.href)).arrayBuffer()), d=discoverHeic(data);
      const row=link.closest('.file');
      return {name:link.download,dimensions:dimensionsForItem(d.props,d.primary),tiles:d.primaryTiles.length,
        exifBytes:extractItemData(data,d,d.exifItem).length,orientation:readExifOrientation(extractItemData(data,d,d.exifItem)),
        preview:!!link.closest('.row').querySelector('.source-thumbnail canvas'),hasStyles:d.stylesItem!==null,
        auxUris:[...d.infos.keys()].map(id=>auxUriForItem(d.props,id)).filter(Boolean)};
    },sample.name);
    assert.ok(output.hasStyles&&output.preview);assert.equal(output.orientation,6);assert.ok(output.tiles<=48);
    assert.equal(output.name,sample.name.replace(/\.dng$/i,'')+'_PhotographicStyle.HEIC');
    if(i===0){
      assert.deepEqual(output.dimensions,[128,96]);
      for(const name of ['portraiteffectsmatte','semanticskymatte','semanticskinmatte','semanticskinmattev2','semanticpersonmatte'])
        assert.ok(output.auxUris.some(uri=>uri.endsWith(':'+name)),name+' source DNG mask reused with face inference off');
      await page.locator('.row .inspect-compare').first().click();
      await page.waitForSelector('.dng-layer[data-kind="mask"]');
      assert.equal(await page.locator('.dng-layer[data-kind="mask"]').count(),3);
      for(const name of ['portraiteffectsmatte','semanticskinmatte','semanticskymatte']){
        const row=page.locator('.inspection-name').filter({has:page.locator('.inspection-identifier',{hasText:new RegExp('^'+name+'$')})});
        assert.match(await row.locator('+ .inspection-cell').textContent(),/存在/);
      }
      const hdr=page.locator('.inspection-name').filter({has:page.locator('.inspection-identifier',{hasText:/^HDR gain map$/})});
      assert.match(await hdr.locator('+ .inspection-cell').textContent(),/無 DNG \(ProRAW\) 直接對應項目/);
      const hair=page.locator('.inspection-name').filter({has:page.locator('.inspection-identifier',{hasText:/^semantichairmatte$/})});
      assert.match(await hair.locator('+ .inspection-cell').textContent(),/未在 DNG \(ProRAW\) 找到此遮罩/);
      await page.locator('.dng-layer[data-kind="mask"] .dng-layer-preview').first().click();
      await page.waitForSelector('.dng-layer[data-kind="mask"] img');
      const preview=await page.locator('.dng-layer[data-kind="mask"] img').first().evaluate(async img=>{
        await img.decode();return {width:img.naturalWidth,height:img.naturalHeight};
      });assert.deepEqual(preview,{width:3,height:4});
      assert.equal(await page.locator('.dng-gain-map').count(),1);
      if(process.env.DNG_INSPECTION_SCREENSHOT)await page.screenshot({path:process.env.DNG_INSPECTION_SCREENSHOT});
      await page.locator('#compare-close').click();
    }
    console.log(JSON.stringify(output));
  }
  // Inference and encoding must not keep their WASM heaps alive together.
  // Also verify the reported model-allocation failure remains recoverable.
  await page.locator('#faces').check();
  for(const oom of [false,true]){
    await page.evaluate(async oom=>{
      const {releaseHevcEncoder}=await import('./src/ffmpeg-hevc.js?v=0.8.0');releaseHevcEncoder();
      globalThis.testForceOrtOOM=oom;globalThis.testWorkerEvents.length=0;
    },oom);
    const count=await page.locator('.act a[download]').count();
    await page.locator('#file').setInputFiles({name:oom?'oom.dng':'inference.dng',mimeType:'image/x-adobe-dng',buffer:original});
    await page.waitForFunction(count=>document.querySelectorAll('.act a[download]').length===count,count+1,{timeout:180000});
    const state=await page.locator('.row').first().evaluate(async row=>{
      const {discoverHeic,auxUriForItem}=await import('./src/heif.js?v=0.8.0');
      const bytes=new Uint8Array(await(await fetch(row.querySelector('a[download]').href)).arrayBuffer()),d=discoverHeic(bytes);
      return {text:row.textContent,totals:row.querySelectorAll('.status-total').length,live:testLiveWorkers(),events:testWorkerEvents,
        auxUris:[...d.infos.keys()].map(id=>auxUriForItem(d.props,id)).filter(Boolean)};
    });
    assert.equal(state.totals,1,'recoverable model failure must not reset total elapsed time');
    assert.ok(state.events.some(e=>e.kind==='ort'&&e.event==='start'));
    assert.ok(state.events.some(e=>e.kind==='ort'&&e.event==='stop'));
    assert.ok(!state.live.includes('ort'));
    for(const name of ['portraiteffectsmatte','semanticskymatte','semanticskinmatte'])assert.ok(state.auxUris.some(uri=>uri.endsWith(':'+name)));
    if(oom)assert.match(state.text,/記憶體不足，已略過額外人物分析/);
    else assert.doesNotMatch(state.text,/準備失敗|無法產生人臉遮罩/);
    console.log('DNG sequential WASM workers, '+(oom?'recoverable OOM':'real ONNX inference')+': passed');
  }
  await page.evaluate(()=>{globalThis.testForceOrtOOM=false;});
  const nativeOnly=await page.evaluate(async input=>{
    const {buildDngInspection}=await import('./src/dng-inspection.js?v=0.8.0');
    const {prepareDngMattes}=await import('./src/dng-mattes.js?v=0.8.0');
    const {generateRasterFaceMattes}=await import('./src/face-mattes.js?v=0.8.0');
    const image=document.createElement('canvas');image.width=96;image.height=128;
    const native=await prepareDngMattes(buildDngInspection(Uint8Array.from(input)),image),events=[];
    const result=await generateRasterFaceMattes(image,270,null,{portraitOnly:true,nativeMasks:native.masks,
      nativeEncoded:native.encoded,onProgress:e=>events.push(e.stage)});
    return {events,portrait:result.overrides.has('urn:com:apple:photo:2018:aux:portraiteffectsmatte'),
      skinAlpha:native.masks.get('urn:com:apple:photo:2019:aux:semanticskinmatte').getContext('2d').getImageData(20,20,1,1).data[3],
      samePortrait:result.overrides.get('urn:com:apple:photo:2018:aux:portraiteffectsmatte').payload===native.encoded.get('urn:com:apple:photo:2018:aux:portraiteffectsmatte').payload};
  },[...input]);
  assert.ok(nativeOnly.events.includes('nativeSegment'));assert.ok(!nativeOnly.events.includes('segment'));
  assert.ok(nativeOnly.portrait&&nativeOnly.samePortrait);assert.equal(nativeOnly.skinAlpha,200);
  await page.evaluate(async()=>{const {releaseHevcEncoder}=await import('./src/ffmpeg-hevc.js?v=0.8.0');releaseHevcEncoder();});
  if (process.env.DNG_SAMPLE_FILE) {
    const consistency = await page.evaluate(async input => {
      const {decodeDng}=await import('./src/dng-decode.js?v=0.8.0');
      const {dngTilePlan}=await import('./src/dng-tiles.js?v=0.8.0');
      const bytes=Uint8Array.from(atob(input),c=>c.charCodeAt(0));
      try {if (!dngTilePlan(bytes,3_000_000)) return {skipped:true};}
      catch {return {skipped:true};} // Other camera samples can still exercise the normal import path.
      const sample = image => {
        const canvas=document.createElement('canvas');canvas.width=120;canvas.height=160;
        canvas.getContext('2d').drawImage(image,0,0,120,160);
        return canvas.getContext('2d').getImageData(0,0,120,160).data;
      };
      const full=await decodeDng(bytes,()=>{},{maxPixels:100_000_000}), a=sample(full.image); full.close();
      const tiled=await decodeDng(bytes,()=>{},{maxPixels:3_000_000}), b=sample(tiled.image);tiled.close();
      let sum=0;
      for(let i=0;i<a.length;i++)if(i%4!==3)sum+=Math.abs(a[i]-b[i]);
      return {mean:sum/(a.length*3/4)};
    },fs.readFileSync(process.env.DNG_SAMPLE_FILE).toString('base64'));
    if (!consistency.skipped) {
      assert.ok(consistency.mean<3,`full/tiled colour difference: ${consistency.mean}`);
      console.log('Camera RAW full/tiled mean RGB difference: '+consistency.mean.toFixed(3));
    }
  }
  // Real 50MP lossless-JPEG RAW must be fed to LibRaw as small tiles, then output at 12MP.
  const large = await page.evaluate(async input => {
    const {decodeDng} = await import('./src/dng-decode.js?v=0.8.0');
    const bytes=Uint8Array.from(atob(input),c=>c.charCodeAt(0)), events=[];
    const opened=await decodeDng(bytes,e=>{if(e.total)events.push(e);},{consume:true});
    const image=opened.image, ctx=image.getContext('2d'), a=[...ctx.getImageData(20,20,1,1).data];
    const b=[...ctx.getImageData(image.width-20,image.height-20,1,1).data];
    const result={width:image.width,height:image.height,tiles:events.at(-1)?.done,total:events.at(-1)?.total,
      detached:bytes.byteLength===0,a,b}; opened.close(); return result;
  },Buffer.from(tiledDngFixture()).toString('base64'));
  assert.equal(large.tiles,256); assert.equal(large.total,256); assert.ok(large.detached);
  assert.equal(large.width,3000);assert.equal(large.height,4000);
  assert.deepEqual(large.a,large.b);assert.equal(large.a[3],255);assert.ok(large.a.slice(0,3).some(n=>n>0));
  console.log('50MP tiled RAW → 12MP: '+JSON.stringify(large));
  // Cache hit with every asset request blocked; a fresh worker must still decode.
  blockAssets=true;
  const offline=await page.evaluate(async input=>{
    const {decodeDng}=await import('./src/dng-decode.js?v=0.8.0');
    const bytes=Uint8Array.from(input), original=bytes.slice(), events=[];
    const opened=await decodeDng(bytes,e=>events.push(e.stage));
    const out={width:opened.image.width,height:opened.image.height,cache:events.includes('modelCache'),unchanged:bytes.every((b,i)=>b===original[i])};opened.close();return out;
  },[...input]);
  assert.deepEqual(offline,{width:96,height:128,cache:true,unchanged:true});
  const before=downloads.length;
  blockAssets=false;
  await page.evaluate(async()=>{const {deleteCachedModelFiles}=await import('./src/model-cache.js?v=0.8.0');await deleteCachedModelFiles('dng');});
  await page.evaluate(async input=>{const {decodeDng}=await import('./src/dng-decode.js?v=0.8.0');(await decodeDng(Uint8Array.from(input))).close();},[...input]);
  assert.equal(downloads.length-before,2);
  // Corrupt cached code must be removed before it can run; JPEG XL yields a clear UI error.
  const integrity=await page.evaluate(async input=>{
    const {DNG_ASSETS}=await import('./src/dng-assets.js?v=0.8.0');const {MODEL_CACHE_NAME}=await import('./src/model-download.js?v=0.8.0');
    const cache=await caches.open(MODEL_CACHE_NAME);await cache.put(DNG_ASSETS[0].url,new Response('bad',{headers:{'content-length':'3'}}));
    const {decodeDng}=await import('./src/dng-decode.js?v=0.8.0');let message;
    try{await decodeDng(Uint8Array.from(input));}catch(e){message=e.message;}
    return {message,deleted:!await cache.match(DNG_ASSETS[0].url)};
  },[...input]);
  assert.match(integrity.message,/integrity check failed/);assert.ok(integrity.deleted);
  await page.locator('#file').setInputFiles({name:'jpeg-xl.dng',mimeType:'image/x-adobe-dng',buffer:Buffer.from(dngFixture({compression:52546}))});
  await page.waitForFunction(()=>document.body.textContent.includes('此 DNG (ProRAW) 使用 JPEG XL 壓縮'),null,{timeout:30000});
  assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);
  console.log('DNG: real WASM decode, UI import, Exif, offline cache, deletion, integrity and JPEG XL error passed; no photo uploads.');
  if(injected.length)console.log(`Blocked ${injected.length} local antivirus-injected script request(s).`);
}finally{await browser?.close();server.close();}
