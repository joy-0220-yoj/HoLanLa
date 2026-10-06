// Real browser WASM encoding and persistent resource-cache regression.
// FFMPEG_CORE_DIR optionally supplies official core-mt 0.12.10 files for offline CI.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import http from 'node:http';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = fileURLToPath(new URL('../../web/', import.meta.url));
const outputDir = path.resolve('tests/web/.cache/generated-profiles'); fs.mkdirSync(outputDir,{recursive:true});
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost'), filename=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));
  if (!filename.startsWith(root) || !fs.existsSync(filename) || !fs.statSync(filename).isFile()) {res.writeHead(404).end();return;}
  res.writeHead(200,{'Content-Type':{'.js':'text/javascript','.html':'text/html','.json':'application/json'}[path.extname(filename)]||'application/octet-stream',
    'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp','Cache-Control':'no-store'});
  res.end(fs.readFileSync(filename));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`; let browser;
try {
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE||undefined});
  const context=await browser.newContext({locale:'zh-TW'}), requests=[], errors=[];
  let downloads=0;
  context.on('request',r=>requests.push(r.url()));
  if (process.env.FFMPEG_CORE_DIR) await context.route('https://cdn.jsdelivr.net/npm/@ffmpeg/core-mt@0.12.10/dist/umd/*', route=>{
    downloads++; const name=route.request().url().split('/').pop(), direct=path.join(process.env.FFMPEG_CORE_DIR,name), prefixed=path.join(process.env.FFMPEG_CORE_DIR,'mt-'+name);
    return route.fulfill({path:fs.existsSync(prefixed)?prefixed:direct,
      headers:{'Access-Control-Allow-Origin':'*','Cross-Origin-Resource-Policy':'cross-origin'}});
  });
  let page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin); await page.waitForFunction(()=>!!navigator.serviceWorker.controller && crossOriginIsolated);
  const result=await page.evaluate(async()=>{
    const {generateSyntheticHevc}=await import('./src/synthetic-hevc.js?v=0.8.0');
    const {buildGeneratedProfile,generatedProfileZip}=await import('./src/generated-profile.js?v=0.8.0');
    const {encodeSelectedLinearThumbnail,prepareLinearPixels,p3ToLinearI420P10}=await import('./src/linear-thumbnail.js?v=0.8.0');
    const {listCachedModelFiles}=await import('./src/model-cache.js?v=0.8.0');
    const {encodeHevcPixels}=await import('./src/ffmpeg-hevc.js?v=0.8.0');
    const {blackWhiteI420,measureHevcRange}=await import('./src/hevc-color.js?v=0.8.0');
    // Reproduce mobile decoders that expose only RGB or opaque frames. Keep
    // HEVC encoding and the fallback decoder real; never guess the sample range.
    const savedDecoder=globalThis.VideoDecoder, savedChunk=globalThis.EncodedVideoChunk;
    const calibration=[]; let format='RGBA';
    globalThis.EncodedVideoChunk=class {constructor(init){Object.assign(this,init);}};
    globalThis.VideoDecoder=class {
      constructor({output}){this.output=output;}
      configure(){}
      decode(){this.output({format,close(){}});}
      async flush(){}
      close(){}
    };
    try {
      for (const fullRange of [false,true]) {
        const pixels=blackWhiteI420(32,16);
        if (!fullRange) for(let i=0;i<32*16;i++) pixels[i]=pixels[i]?235:16;
        const probe=await encodeHevcPixels(pixels,{width:32,height:16,pixelFormat:'yuv420p',fullRange,
          transfer:'iec61966-2-1'});
        for(format of ['RGBA',null]) {
          const measured=await measureHevcRange(probe.record,probe.payload,{width:32,height:16});
          if(measured!==fullRange)throw Error('Software calibration changed native sample range');
          calibration.push({format,fullRange,measured});
        }
      }
    } finally {globalThis.VideoDecoder=savedDecoder;globalThis.EncodedVideoChunk=savedChunk;}
    const assets=await generateSyntheticHevc(), canvas=document.createElement('canvas'); canvas.width=64;canvas.height=32;
    const ctx=canvas.getContext('2d',{colorSpace:'display-p3'}), gradient=ctx.createLinearGradient(0,0,64,32);
    gradient.addColorStop(0,'#000000');gradient.addColorStop(.5,'#af6a90');gradient.addColorStop(1,'#ffffff');ctx.fillStyle=gradient;ctx.fillRect(0,0,64,32);
    const lt=await encodeSelectedLinearThumbnail(canvas), prepared=prepareLinearPixels(canvas);
    const raw=p3ToLinearI420P10(prepared.rgba,prepared.width,prepared.height,prepared.floating);
    const serialize=v=>({width:v.width,height:v.height,hvcc:Array.from(v.hvcc),payload:Array.from(v.payload),sps:v.sps,bitDepth:v.bitDepth,
      ...(v.colr?{colr:Array.from(v.colr)}:{}),...(v.pixi?{pixi:Array.from(v.pixi)}:{})});
    return {assets:Object.fromEntries(Object.entries(assets).map(([k,v])=>[k,serialize(v)])),linear:{...serialize(lt),pixi:Array.from(lt.pixi),colr:Array.from(lt.colr),mode:lt.mode,raw:Array.from(raw)},
      profiles:Object.fromEntries(['45-15','48-12'].map(name=>[name,Array.from(generatedProfileZip(buildGeneratedProfile(name,assets)))])),cache:await listCachedModelFiles(),calibration};
  });
  assert.equal(result.calibration.length,4);
  // Independent native decoder: reconstruct Annex B using the fresh hvcC arrays.
  const annexB=asset=>{
    const record=Buffer.from(asset.hvcc).subarray(8), parts=[], start=Buffer.from([0,0,0,1]);let p=23;
    for(let i=0;i<record[22];i++){p++;const count=record.readUInt16BE(p);p+=2;for(let j=0;j<count;j++){const n=record.readUInt16BE(p);p+=2;parts.push(start,record.subarray(p,p+n));p+=n;}}
    const payload=Buffer.from(asset.payload);for(p=0;p<payload.length;){const n=payload.readUInt32BE(p);p+=4;parts.push(start,payload.subarray(p,p+n));p+=n;}
    return Buffer.concat(parts);
  };
  for(const [name,asset] of Object.entries({...result.assets,linear:result.linear})){
    const format=name.includes('ask')?'gray':'yuv420p10le';
    const raw=execFileSync(process.env.FFMPEG_EXECUTABLE||'ffmpeg',['-hide_banner','-loglevel','error','-f','hevc','-i','pipe:0','-frames:v','1','-pix_fmt',format,'-f','rawvideo','pipe:1'],{input:annexB(asset),maxBuffer:32*1024*1024});
    if(format==='gray'){assert.equal(raw.length,asset.width*asset.height);assert.ok(raw.every(v=>v===0));assert.equal(asset.sps.chroma,0);assert.equal(asset.bitDepth,8);}
    else {const expected=name==='linear'?result.linear.raw:Array.from({length:512*512*3/2},(_,i)=>i<512*512?504:512);
      const decoded=new Uint16Array(raw.buffer,raw.byteOffset,raw.length/2);assert.deepEqual([...decoded],expected);assert.equal(asset.bitDepth,10);}
    fs.writeFileSync(path.join(outputDir,name+'.265'),annexB(asset));
  }
  assert.equal(result.assets.delta.sps.primaries,12);assert.equal(result.assets.delta.sps.transfer,8);
  assert.equal(result.assets.delta.sps.matrix,1);assert.equal(result.assets.delta.sps.fullRange,false);
  assert.deepEqual(result.assets.delta.colr.slice(12),[0,12,0,8,0,1,0]);
  // Test the decoded colour, not just untouched YUV samples: a BT.709 transfer tag
  // passes a lossless YUV round-trip yet shifts this neutral from ~0.502 to ~0.192
  // in this independent FFmpeg/zscale conversion.
  const neutralRgb=execFileSync(process.env.FFMPEG_EXECUTABLE||'ffmpeg',[
    '-hide_banner','-loglevel','error','-f','hevc','-i','pipe:0','-frames:v','1',
    '-vf','zscale=transfer=linear:primaries=smpte432:matrix=gbr:range=full,format=gbrpf32le',
    '-f','rawvideo','pipe:1'],{input:annexB(result.assets.delta),maxBuffer:32*1024*1024});
  const linearRgb=new Float32Array(neutralRgb.buffer,neutralRgb.byteOffset,neutralRgb.length/4);
  const expectedNeutral=(504-64)/876;
  assert.ok(linearRgb.every(value=>Math.abs(value-expectedNeutral)<.002),'neutral delta remains ~0.502 in linear P3 RGB');
  fs.writeFileSync(path.join(outputDir,'synthetic-hevc.fixture.json'),JSON.stringify({
    provenance:'Fresh browser FFmpeg.wasm/core-mt 0.12.10, x265 lossless. Numeric Y=504 Cb/Cr=512, Display P3 linear delta; gray=0 masks. No donor inputs.',
    assets:result.assets},null,2)+'\n');
  assert.deepEqual(result.linear.pixi.slice(-3),[10,10,10]);assert.equal(result.linear.mode,'ffmpeg-wasm-x265-main10-p3-linear');
  const encoder=result.cache.find(file=>file.resource==='ffmpeg');assert.equal(encoder.count,1);assert.equal(encoder.scriptCount,2);assert.ok(encoder.bytes>30_000_000);
  for(const [name,bytes] of Object.entries(result.profiles))fs.writeFileSync(path.join(outputDir,name+'-generated.zip'),Buffer.from(bytes));
  assert.ok(!requests.some(url=>/\/profiles\/.*\.(zip|bin)/.test(url)),'no donor ZIP/bin downloads');
  // Closing the page disposes live JS/WASM; the next page must use persisted bytes.
  await page.close();await context.setOffline(true);const priorDownloads=downloads;
  page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(origin);
  const offline=await page.evaluate(async()=>{const {generateProfile}=await import('./src/generated-profile.js?v=0.8.0');const p=await generateProfile('48-12');return p.retained.size;});
  assert.equal(offline,37);assert.equal(downloads,priorDownloads);
  await context.setOffline(false);await page.locator('#model-cache summary').click();
  const row=page.locator('#model-cache-files li').filter({hasText:'FFmpeg.wasm'});
  await row.getByText(/已儲存在本機/).waitFor();await row.getByRole('button',{name:/刪除/}).click();
  await page.locator('#model-cache-status').getByText(/已刪除/).waitFor();await row.getByText(/尚未儲存/).waitFor();
  await page.evaluate(async()=>{const {generateProfile}=await import('./src/generated-profile.js?v=0.8.0');await generateProfile('48-12');});
  if(process.env.FFMPEG_CORE_DIR)assert.equal(downloads,priorDownloads+3);
  await page.locator('#model-cache summary').click();await page.locator('#model-cache summary').click();
  await page.locator('#model-cache-files li').filter({hasText:'FFmpeg.wasm'}).getByText(/已儲存在本機/).waitFor();
  // Cached program bytes are checked again before execution; corrupt entries
  // must be removed, with a later retry fetching the missing file only.
  const integrity = await page.evaluate(async()=>{
    const {FFMPEG_ASSETS}=await import('./src/ffmpeg-assets.js?v=0.8.0');
    const {MODEL_CACHE_NAME}=await import('./src/model-download.js?v=0.8.0');
    const {ensureHevcEncoder,releaseHevcEncoder}=await import('./src/ffmpeg-hevc.js?v=0.8.0');
    const cache=await caches.open(MODEL_CACHE_NAME);await cache.put(FFMPEG_ASSETS[0].url,new Response('wrong',{headers:{'content-length':'5'}}));
    releaseHevcEncoder();try{await ensureHevcEncoder();return false;}catch(error){return /integrity check failed/.test(error.message)&&!await cache.match(FFMPEG_ASSETS[0].url);}
  });
  assert.equal(integrity,true);
  const beforeRetry=downloads;await page.evaluate(async()=>{const {generateProfile}=await import('./src/generated-profile.js?v=0.8.0');await generateProfile('48-12');});
  if(process.env.FFMPEG_CORE_DIR)assert.equal(downloads,beforeRetry+1);
  await page.locator('#model-cache').screenshot({path:path.join(outputDir,'resource-cache.png')});
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(outputDir,'verification.json'),JSON.stringify({roundTrips:['neutral-10bit','mask-gray8','texture-mask-gray8','linear-P3-10bit'],softwareRangeCalibration:result.calibration,offlineRestart:true,cacheDeleteRedownload:true,corruptRuntimeRejected:true,noDonorRequests:true,encoder,profileBytes:Object.fromEntries(Object.entries(result.profiles).map(([k,v])=>[k,v.length]))},null,2));
  console.log('Browser x265: RGB/opaque decoder fallback with full/limited range, four lossless pixel round-trips, generated profiles, offline restart and cache re-download passed.');
} finally {await browser?.close();server.close();}
