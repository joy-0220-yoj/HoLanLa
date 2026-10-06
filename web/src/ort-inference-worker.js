// Verified runtime/model assets and small inference tensors arrive from the local page.
// This worker never receives the original photo or downloads third-party assets itself.
let ort, nextSession=0, serial=Promise.resolve();
const sessions=new Map();
self.onmessage=({data})=>{
  serial=serial.catch(()=>{}).then(async()=>{
    const {id,operation}=data;
    try{
      let result,transfer=[];
      if(operation==='init'){
        ort=await import(data.script);
        ort.env.wasm.numThreads=1;ort.env.wasm.proxy=false;
        ort.env.wasm.wasmPaths={mjs:data.loader,wasm:data.wasm};
      }else if(operation==='create'){
        const model=await ort.InferenceSession.create(data.bytes,{executionProviders:['wasm'],graphOptimizationLevel:'all'});
        const session=++nextSession;sessions.set(session,model);
        result={id:session,inputNames:model.inputNames};
      }else if(operation==='run'){
        const model=sessions.get(data.session);if(!model)throw Error('Unknown ONNX Runtime session');
        const input=new ort.Tensor('float32',data.values,data.dims);let outputs;
        try{
          outputs=await model.run({[model.inputNames[0]]:input});result={};
          for(const [name,value] of Object.entries(outputs)){
            // Copy out of the WASM heap before transferring ownership to the page.
            const values=value.data.slice();result[name]={data:values};transfer.push(values.buffer);
          }
        }finally{input.dispose();for(const value of Object.values(outputs||{}))value.dispose?.();}
      }else if(operation==='release'){
        await sessions.get(data.session)?.release();sessions.delete(data.session);
      }else throw Error('Unknown ONNX Runtime worker operation');
      self.postMessage({id,result},transfer);
    }catch(error){self.postMessage({id,error:{name:error.name||'Error',message:String(error.message||error)}});}
  });
};
