import {ORT_ASSETS} from './ort-assets.js?v=0.8.0';
import {downloadModelBytes, MODEL_CACHE_NAME, withModelTimeout, ModelTimeoutError} from './model-download.js?v=0.8.0';
import {decodeFaceDetections, remapOrtLandmarks, selfieConfidencePlanes, sigmoid, ortFacePoseMatrix} from './ort-vision-math.js?v=0.8.0';

let runtimePromise,facePromise,segmenterPromise;
async function assetBytes(asset,options) {
  try {
  const bytes=await downloadModelBytes(asset.url,{onProgress:event=>options.onProgress?.({...event,resource:asset.resource,
    stage:event.source==='cache'?'modelCache':event.source==='cacheWarning'?'modelCacheWarning':'modelDownload'})});
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
  if(hash!==asset.sha256){try{await(await caches.open(MODEL_CACHE_NAME)).delete(asset.url);}catch{}
    throw Error(`ONNX Runtime asset integrity check failed: ${asset.resource}`);}
  return bytes;
  } catch(error) {
    error.modelResource=asset.resource;error.skipPortraitFallback=true;
    await options.onProgress?.({stage:'modelError',resource:asset.resource,reason:error instanceof ModelTimeoutError?'stalled':'failed',detail:error.message});
    throw error;
  }
}
function assetURL(bytes,type='text/javascript'){return URL.createObjectURL(new Blob([bytes],{type}));}
async function step(options,resource,operation) {
  await options.onProgress?.({stage:'modelLoading',resource,phase:'cpu'});
  try{return await withModelTimeout(Promise.resolve().then(operation),120000,value=>{
    const disposed=value?.release?value.release():value?.close?.();disposed?.catch?.(()=>{});
  });}
  catch(error){error.modelResource=resource;error.skipPortraitFallback=true;
    await options.onProgress?.({stage:'modelError',resource,reason:error instanceof ModelTimeoutError?'timeout':'failed',detail:error.message});throw error;}
}
async function runtime(options) {
  if(!runtimePromise)runtimePromise=step(options,'ort',async()=>{
    const script=await assetBytes(ORT_ASSETS[0],options),loader=await assetBytes(ORT_ASSETS[1],options),wasm=await assetBytes(ORT_ASSETS[2],options);
    // A terminated worker releases the entire WASM heap and imported module graph.
    // Session.release() alone cannot discard a runtime imported on the main thread.
    const urls=[assetURL(script),assetURL(loader),assetURL(wasm,'application/wasm')];
    let worker;
    try{worker=new Worker(new URL('./ort-inference-worker.js?v=0.8.0',import.meta.url),{type:'module'});}
    catch(error){urls.forEach(url=>URL.revokeObjectURL(url));throw error;}
    const pending=new Map();let nextId=0,closed=false;
    const close=(error=Error('ONNX Runtime worker released'))=>{
      if(closed)return;closed=true;worker.terminate();urls.forEach(url=>URL.revokeObjectURL(url));
      for(const call of pending.values()){clearTimeout(call.timer);call.reject(error);}pending.clear();
    };
    const failed=error=>{close(error);runtimePromise=facePromise=segmenterPromise=null;};
    worker.onmessage=({data})=>{
      const call=pending.get(data.id);if(!call)return;
      pending.delete(data.id);clearTimeout(call.timer);
      if(data.error){
        const error=Object.assign(Error(data.error.message),{name:data.error.name});call.reject(error);
        if(/out of memory|memory allocation failed/i.test(error.message))failed(error);
      }else call.resolve(data.result);
    };
    worker.onerror=event=>{event.preventDefault();failed(Error(event.message||'ONNX Runtime worker failed'));};
    worker.onmessageerror=()=>failed(Error('ONNX Runtime worker message failed'));
    const request=(operation,data={},transfer=[])=>new Promise((resolve,reject)=>{
      if(closed){reject(Error('ONNX Runtime worker released'));return;}
      const id=++nextId,timer=setTimeout(()=>failed(new ModelTimeoutError()),120000);
      pending.set(id,{resolve,reject,timer});
      try{worker.postMessage({id,operation,...data},transfer);}catch(error){pending.delete(id);clearTimeout(timer);reject(error);}
    });
    try{await request('init',{script:urls[0],loader:urls[1],wasm:urls[2]});}
    catch(error){close(error);throw error;}
    return {async create(bytes){
      const metadata=await request('create',{bytes},[bytes.buffer]);
      return {...metadata,run:(values,dims)=>request('run',{session:metadata.id,values,dims},[values.buffer]),
        release:()=>closed?Promise.resolve():request('release',{session:metadata.id})};
    },close};
  }).catch(error=>{runtimePromise=null;throw error;});
  return runtimePromise;
}
async function session(asset,options) {
  const ort=await runtime(options),bytes=await assetBytes(asset,options);
  return step(options,asset.resource,()=>ort.create(bytes));
}
function tensorPixels(ort,source,size,{detector=false,roi=null}={}) {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=size;
  const ctx=canvas.getContext('2d',{colorSpace:'srgb',willReadFrequently:true});
  ctx.fillStyle='#000';ctx.fillRect(0,0,size,size);ctx.imageSmoothingQuality='high';
  if(roi){const scale=size/roi.side,c=Math.cos(roi.angle),s=Math.sin(roi.angle);
    ctx.setTransform(scale*c,-scale*s,scale*s,scale*c,size/2-scale*(c*roi.cx+s*roi.cy),size/2+scale*(s*roi.cx-c*roi.cy));ctx.drawImage(source,0,0);}
  else if(detector){const scale=size/Math.max(source.width,source.height);
    ctx.drawImage(source,(size-source.width*scale)/2,(size-source.height*scale)/2,source.width*scale,source.height*scale);}
  else ctx.drawImage(source,0,0,size,size);
  const rgba=ctx.getImageData(0,0,size,size).data,data=new Float32Array(size*size*3),plane=size*size;
  for(let i=0;i<plane;i++)for(let k=0;k<3;k++)data[i*3+k]=detector?rgba[i*4+k]/127.5-1:rgba[i*4+k]/255;
  canvas.width=canvas.height=0;
  return data;
}
async function run(ort,model,image,size,options) {
  const tensor=tensorPixels(ort,image,size,options);
  return model.run(tensor,[1,size,size,3]);
}
function disposeOutputs(outputs){for(const value of Object.values(outputs))value.dispose?.();}

export async function loadOrtLandmarker(options={}) {
  if(!facePromise)facePromise=(async()=>{
    const ort=await runtime(options);let detector,landmarks;
    try{detector=await session(ORT_ASSETS[3],options);landmarks=await session(ORT_ASSETS[4],options);}
    catch(error){await detector?.release();throw error;}
    return {async detect(source){
      const detected=await run(ort,detector,source,128,{detector:true});let rois;
      try{const values=Object.values(detected),reg=values.find(t=>t.data.length===896*16),scores=values.find(t=>t.data.length===896);
        if(!reg||!scores)throw Error('Unexpected ONNX Runtime detector tensors');rois=decodeFaceDetections(reg.data,scores.data,source.width,source.height);}
      finally{disposeOutputs(detected);}
      const faceLandmarks=[],facialTransformationMatrixes=[];
      for(const roi of rois){const out=await run(ort,landmarks,source,256,{roi});
        try{if(!out.Identity||!out.Identity_1)throw Error('Unexpected ONNX Runtime landmark tensors');
          if(sigmoid(out.Identity_1.data[0])<.4)continue;
          const points=remapOrtLandmarks(out.Identity.data,roi,source.width,source.height);
          faceLandmarks.push(points);facialTransformationMatrixes.push({data:ortFacePoseMatrix(points,source.width,source.height)});
        }finally{disposeOutputs(out);}}
      return {faceLandmarks,facialTransformationMatrixes};
    },async close(){await detector.release();await landmarks.release();}};
  })().catch(error=>{facePromise=null;throw error;});
  return facePromise;
}
export async function loadOrtSegmenter(options={}) {
  if(!segmenterPromise)segmenterPromise=(async()=>{
    const ort=await runtime(options),model=await session(ORT_ASSETS[5],options);
    return {indices:{background:0,hair:1,bodyskin:2,faceskin:3,clothes:4,others:5},segmenter:{
      async segment(source){const out=await run(ort,model,source,256);
        try{if(!out.Identity)throw Error('Unexpected ONNX Runtime segmentation tensor');
          const planes=selfieConfidencePlanes(out.Identity.data);
          return {confidenceMasks:planes.map(values=>({width:256,height:256,getAsFloat32Array:()=>values,close(){}}))};
        }finally{disposeOutputs(out);}},async close(){await model.release();}}};
  })().catch(error=>{segmenterPromise=null;throw error;});
  return segmenterPromise;
}
export async function releaseOrtModels(resource='all') {
  if(resource==='all'||resource==='ort'){
    const runtime=await runtimePromise?.catch(()=>null);
    runtime?.close();runtimePromise=facePromise=segmenterPromise=null;
    return;
  }
  if(['ortDetector','ortFace'].includes(resource)){const value=await facePromise?.catch(()=>null);await value?.close();facePromise=null;}
  if(resource==='ortSegmenter'){const value=await segmenterPromise?.catch(()=>null);await value?.segmenter.close();segmenterPromise=null;}
}
