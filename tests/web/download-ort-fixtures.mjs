// Public test fixtures only. .cache is Git-ignored; models are never bundled in web/.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {ORT_ASSETS} from '../../web/src/ort-assets.js';
const directory=process.env.ORT_FIXTURE_DIR||'.cache/ort-research';
const names=['ort.wasm.min.mjs','ort-wasm-simd-threaded.mjs','ort-wasm-simd-threaded.wasm','face-detector-nhwc.onnx','face-landmarks.onnx','selfie.onnx'];
const jobs=ORT_ASSETS.map((asset,i)=>({...asset,name:names[i]}));
jobs.push({name:'sample-face.jpg',url:'https://raw.githubusercontent.com/yakhyo/mediapipe-face-mesh-onnx/add50e0f486405c96695812f9a9b9b89a485892b/assets/inputs/man_smiling.jpg',
 sha256:'318d0909f091ff3dc39fd54013ab952f64fb1da538f56c1898924040dd084237'});
await fs.mkdir(directory,{recursive:true});
for(const asset of jobs){const file=path.join(directory,asset.name);let bytes;
 try{bytes=await fs.readFile(file);}catch{}
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 if(bytes&&hash(bytes)===asset.sha256){console.log(asset.name,'cached');continue;}
 const response=await fetch(asset.url);if(!response.ok)throw Error(`${response.status}: ${asset.name}`);
 bytes=Buffer.from(await response.arrayBuffer());if(hash(bytes)!==asset.sha256)throw Error(`Integrity check failed: ${asset.name}`);
 await fs.writeFile(file,bytes);console.log(asset.name,bytes.length);
}
