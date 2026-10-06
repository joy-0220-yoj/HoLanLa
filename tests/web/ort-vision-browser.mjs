// Real ONNX Runtime WASM/model inference on a public sample; only the HEVC codec is stubbed.
// Download public fixtures with tests/web/download-ort-fixtures.mjs, then set ORT_FIXTURE_DIR.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {ORT_ASSETS} from '../../web/src/ort-assets.js';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=fileURLToPath(new URL('../../web/',import.meta.url));
const fixtures=process.env.ORT_FIXTURE_DIR||'.cache/ort-research';
const names=['ort.wasm.min.mjs','ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm','face-detector-nhwc.onnx','face-landmarks.onnx','selfie.onnx'];
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost');
 const file=url.pathname==='/sample.jpg'?path.resolve(fixtures,'sample-face.jpg'):path.resolve(root,'.'+(url.pathname==='/'?'/index.html':url.pathname));
 if(url.pathname==='/probe.html'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>ONNX Runtime test</title>');return;}
 if((!file.startsWith(root)&&url.pathname!=='/sample.jpg')||!fs.existsSync(file)){res.writeHead(404);res.end();return;}
 res.writeHead(200,{'Content-Type':{'.js':'text/javascript','.html':'text/html','.jpg':'image/jpeg'}[path.extname(file)]||'application/octet-stream',
  'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'require-corp'});res.end(fs.readFileSync(file));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`,requests=[],errors=[];
let browser;
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_EXECUTABLE||undefined});
 const context=await browser.newContext({serviceWorkers:'block',locale:'zh-TW'});
 await context.route('**/*',route=>{
  // Supply the app worker as an offline-precache hit; external assets still use CacheStorage.
  if(new URL(route.request().url()).pathname==='/src/ort-inference-worker.js')
   return route.fulfill({path:path.join(root,'src/ort-inference-worker.js'),contentType:'text/javascript'});
  const url=route.request().url();if(url.startsWith(origin)||url.startsWith('blob:'))return route.continue();
  requests.push({url,method:route.request().method()});const index=ORT_ASSETS.findIndex(asset=>asset.url===url);
  if(index<0)return route.abort();
  if(process.env.ORT_LIVE_ASSETS)return route.continue();
  return route.fulfill({path:path.resolve(fixtures,names[index]),headers:{'Access-Control-Allow-Origin':'*','Cross-Origin-Resource-Policy':'cross-origin'},
   contentType:url.endsWith('.mjs')?'text/javascript':url.endsWith('.wasm')?'application/wasm':'application/octet-stream'});
 });
 await context.addInitScript(()=>{
  const NativeWorker=Worker;globalThis.testOrtWorkers=0;
  globalThis.Worker=class extends NativeWorker{
   constructor(url,options){super(url,options);this.ort=String(url).includes('ort-inference-worker');if(this.ort)testOrtWorkers++;}
   terminate(){super.terminate();if(this.ort){testOrtWorkers--;this.ort=false;}}
  };
 });
 const page=await context.newPage();page.setDefaultTimeout(120000);
 page.on('pageerror',error=>errors.push(error.message));
 page.on('console',message=>{if(message.type()==='error')console.log('browser:',message.text().slice(0,350));});
 await page.goto(origin+'/probe.html');
 // Test native ONNX tensors, app adapters and masks independently of the platform codec.
 const result=await page.evaluate(async()=>{
  const {loadOrtLandmarker,loadOrtSegmenter}=await import('/src/ort-vision.js?v=0.8.0');
  const image=await createImageBitmap(await(await fetch('/sample.jpg')).blob());
  const detector=await loadOrtLandmarker(),faces=await detector.detect(image);
  const {segmenter}=await loadOrtSegmenter(),segmentation=await segmenter.segment(image);
  const counts=new Array(6).fill(0);let maxSumError=0;
  for(let i=0;i<65536;i++){const values=segmentation.confidenceMasks.map(mask=>mask.getAsFloat32Array()[i]);
   maxSumError=Math.max(maxSumError,Math.abs(values.reduce((sum,v)=>sum+v,0)-1));counts[values.indexOf(Math.max(...values))]++;}
  globalThis.testImage=image;
  return {faces:faces.faceLandmarks.length,landmarks:faces.faceLandmarks.map(points=>points.length),matrix:faces.facialTransformationMatrixes[0]?.data,
   finite:faces.faceLandmarks.every(points=>points.every(p=>Object.values(p).every(Number.isFinite))),counts,maxSumError};
 });
 assert.ok(result.faces>=1,JSON.stringify(result));assert.ok(result.landmarks.every(n=>n===478));assert.ok(result.finite);
 assert.equal(result.matrix.length,16);assert.ok(result.matrix.every(Number.isFinite));
 assert.ok(result.maxSumError<1e-6);assert.ok(result.counts[3]>100);assert.ok(result.counts[0]>100);
 console.log('Real ONNX inference:',JSON.stringify(result));
 await page.evaluate(()=>{
  const description=Uint8Array.from(atob('AQFgAAAAkAAAAAAA//AA/P34+AAADwOgAAEAGEABDAH//wFgAAADAJAAAAMAAAMA/5WUCaEAAQArQgEBAWAAAAMAkAAAAwAAAwD/oEIIWWVlSkwuagICAggAAAMACAAAAwAIQKIAAQAGRAHAcYkS'),c=>c.charCodeAt(0));
  globalThis.VideoFrame=class{close(){}};
  globalThis.VideoEncoder=class{
   static async isConfigSupported(config){return {supported:true,config};}
   constructor({output}){this.output=output;}configure(){}encode(){this.output({byteLength:7,copyTo:out=>out.set([0,0,0,3,0x26,1,1])},{decoderConfig:{description}});}
   async flush(){}close(){}
  };
 });
 const pipeline=await page.evaluate(async()=>{
  const {generateRasterFaceMattes}=await import('/src/face-mattes.js?v=0.8.0');
  const result=await generateRasterFaceMattes(testImage,270,null);
  return {state:result.state,faces:result.faces,overrides:[...result.overrides.keys()],people:result.texturePeopleData?.length,
   poses:result.texturePeopleData?.map(entry=>['faceYaw','facePitch','faceRoll'].map(key=>entry.get(key)))};
 });
 assert.equal(pipeline.state,'generated');assert.ok(pipeline.faces>=1);assert.equal(pipeline.faces,pipeline.people);
 assert.ok(pipeline.overrides.length>=8);assert.ok(pipeline.poses.flat().every(Number.isFinite));
 assert.equal(await page.evaluate(()=>testOrtWorkers),1);
 console.log('Face/matte app pipeline:',JSON.stringify(pipeline));
 // Deleting the runtime must release both live sessions and reload all three runtime assets.
 const before=requests.length;
 await page.evaluate(async()=>{
  const {deleteCachedModelFiles}=await import('/src/model-cache.js?v=0.8.0');await deleteCachedModelFiles('ort');
  const {loadOrtLandmarker}=await import('/src/ort-vision.js?v=0.8.0');await loadOrtLandmarker();
 });
 assert.equal(requests.length-before,3);
 // Cached assets suffice when recreating sessions; no external requests after warm-up.
 await context.setOffline(true);const offline=await page.evaluate(async()=>{
  const {releaseOrtModels,loadOrtLandmarker,loadOrtSegmenter}=await import('/src/ort-vision.js?v=0.8.0');
  let faces;
  for(let i=0;i<2;i++){
   await releaseOrtModels();if(testOrtWorkers!==0)throw Error('ONNX Runtime worker retained after release');
   const detector=await loadOrtLandmarker();faces=(await detector.detect(testImage)).faceLandmarks;
   const {segmenter}=await loadOrtSegmenter();await segmenter.segment(testImage);
   if(testOrtWorkers!==1)throw Error('Unexpected live ONNX Runtime worker count');
  }
  await releaseOrtModels();return {faces:faces.length,workers:testOrtWorkers};
 });await context.setOffline(false);
 assert.deepEqual(offline,{faces:result.faces,workers:0});
 assert.ok(!requests.some(r=>r.url.includes('@mediapipe/')||r.url.includes('mediapipe-models')));
 assert.ok(requests.every(r=>r.method==='GET'&&ORT_ASSETS.some(a=>a.url===r.url)),JSON.stringify(requests));
 assert.deepEqual(errors,[]);
 await page.goto(origin);assert.equal(await page.locator('#vision-engine').count(),0);
 await page.screenshot({path:'.cache/ort-default.png',fullPage:true});
 // A corrupt third-party model is rejected before inference, without a MediaPipe fallback.
 await context.route(ORT_ASSETS[4].url,route=>route.fulfill({body:Buffer.from('corrupt ONNX'),
  contentType:'application/octet-stream',headers:{'Access-Control-Allow-Origin':'*','Cross-Origin-Resource-Policy':'cross-origin'}}));
 const failed=await context.newPage();await failed.goto(origin+'/probe.html');
 const rejection=await failed.evaluate(async()=>{
  const {deleteCachedModelFiles}=await import('/src/model-cache.js?v=0.8.0');await deleteCachedModelFiles('ortFace');
  const {loadOrtLandmarker}=await import('/src/ort-vision.js?v=0.8.0');
  try{await loadOrtLandmarker();return null;}catch(error){return {message:error.message,resource:error.modelResource,skip:error.skipPortraitFallback};}
 });
 assert.match(rejection.message,/integrity check failed/);assert.equal(rejection.resource,'ortFace');assert.equal(rejection.skip,true);
 assert.ok(!requests.some(r=>r.url.includes('@mediapipe/')||r.url.includes('mediapipe-models')));
 await failed.close();
 console.log('ONNX Runtime adapters, cache deletion/reinitialization, offline reuse, default pipeline and no MediaPipe requests: passed');
 await context.close();
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
