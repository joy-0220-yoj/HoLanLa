// Read the source DNG's TIFF directory graph. No RAW development or model inference.
import {dngReader, inspectDng} from './dng-tiff.js?v=0.8.0';

const tagNames = {254:'NewSubfileType',256:'ImageWidth',257:'ImageLength',258:'BitsPerSample',259:'Compression',
  262:'PhotometricInterpretation',271:'Make',272:'Model',273:'StripOffsets',274:'Orientation',277:'SamplesPerPixel',
  278:'RowsPerStrip',279:'StripByteCounts',284:'PlanarConfiguration',322:'TileWidth',323:'TileLength',
  324:'TileOffsets',325:'TileByteCounts',330:'SubIFDs',34665:'ExifIFD',34853:'GPSIFD',
  50706:'DNGVersion',50707:'DNGBackwardVersion',50708:'UniqueCameraModel',50712:'LinearizationTable',
  50714:'BlackLevel',50717:'WhiteLevel',50719:'DefaultCropOrigin',50720:'DefaultCropSize',
  50721:'ColorMatrix1',50722:'ColorMatrix2',50728:'AsShotNeutral',50730:'BaselineExposure',
  50731:'BaselineNoise',50732:'BaselineSharpness',50829:'ActiveArea',50940:'ProfileToneCurve',
  50964:'ForwardMatrix1',50965:'ForwardMatrix2',51008:'OpcodeList1',51009:'OpcodeList2',51022:'OpcodeList3',
  51177:'DepthFormat',51178:'DepthNear',51179:'DepthFar',52525:'ProfileGainTableMap',
  52526:'SemanticName',52528:'SemanticInstanceID',52536:'MaskSubArea'};

function tagValue(entry, little, limit = 64) {
  const {type,count,data} = entry, v = new DataView(data.buffer,data.byteOffset,data.byteLength);
  if (type === 2) return new TextDecoder().decode(data.subarray(0,4096)).replace(/\0.*$/s,'');
  const read = {1:i=>data[i],3:i=>v.getUint16(i*2,little),4:i=>v.getUint32(i*4,little),
    5:i=>[v.getUint32(i*8,little),v.getUint32(i*8+4,little)],6:i=>v.getInt8(i),8:i=>v.getInt16(i*2,little),
    9:i=>v.getInt32(i*4,little),10:i=>[v.getInt32(i*8,little),v.getInt32(i*8+4,little)],
    11:i=>v.getFloat32(i*4,little),12:i=>v.getFloat64(i*8,little),13:i=>v.getUint32(i*4,little)}[type];
  if (!read) return {bytes:data.length,hex:[...data.subarray(0,32)].map(n=>n.toString(16).padStart(2,'0')).join(' ')};
  const values=Array.from({length:Math.min(count,limit)},(_,i)=>read(i));
  return count>limit ? {count,first:values} : count===1 ? values[0] : values;
}

export function readDngGainTable(entry, little) {
  const b=entry.data, v=new DataView(b.buffer,b.byteOffset,b.byteLength);
  if (b.length<64) throw Error('Truncated ProfileGainTableMap');
  const rows=v.getUint32(0,little),cols=v.getUint32(4,little),levels=v.getUint32(40,little), count=rows*cols*levels;
  if (!rows||!cols||!levels||!Number.isSafeInteger(count)||count>2_000_000||b.length!==64+count*4)
    throw Error('Invalid ProfileGainTableMap dimensions');
  const values=new Float32Array(count);
  for(let i=0;i<count;i++){
    values[i]=v.getFloat32(64+i*4,little);
    if(!Number.isFinite(values[i])||values[i]<0)throw Error('Invalid ProfileGainTableMap gain');
  }
  return {rows,cols,levels,values,spacing:[v.getFloat64(8,little),v.getFloat64(16,little)],
    origin:[v.getFloat64(24,little),v.getFloat64(32,little)],
    inputWeights:Array.from({length:5},(_,i)=>v.getFloat32(44+i*4,little))};
}

export function gainTableSlice(table, level) {
  if (!Number.isInteger(level)||level<0||level>=table.levels)throw Error('Invalid gain table level');
  const values=new Float32Array(table.rows*table.cols);
  for(let i=0;i<values.length;i++)values[i]=table.values[i*table.levels+level];
  return values;
}

export function buildDngInspection(bytes, {includePreviews = true} = {}) {
  const info=inspectDng(bytes), r=dngReader(bytes), root=r.ifd(r.rootOffset).entries;
  const rootOrientation=r.numbers(root.get(274))[0]||1;
  const queue=[{off:r.rootOffset,path:'IFD0',parent:null}],seen=new Set(),layers=[];
  let totalFields=0;
  while(queue.length){
    const {off,path,parent}=queue.shift(); if(!off||seen.has(off))continue;
    if(seen.size>=64)throw Error('DNG inspection: too many directories');seen.add(off);
    const table=r.ifd(off), tags=table.entries, number=tag=>r.numbers(tags.get(tag));
    totalFields+=tags.size;if(totalFields>4096)throw Error('DNG inspection: too many fields');
    const width=number(256)[0]||0,height=number(257)[0]||0,photometric=number(262)[0];
    const semantic=tags.get(52526)?tagValue(tags.get(52526),r.little):'';
    const kind=[32803,34892].includes(photometric)?'raw':semantic||photometric===52527?'mask':
      tags.has(51177)?'depth':width&&height?'preview':'metadata';
    const layer={id:off,path,parent,kind,width,height,semantic,compression:number(259)[0]||1,
      bits:number(258),orientation:number(274)[0]||rootOrientation,samples:number(277)[0]||1,
      photometric,fields:[...tags].map(([tag,entry])=>({tag,name:tagNames[tag]||`0x${tag.toString(16)}`,
        type:entry.type,count:entry.count,value:tagValue(entry,r.little)})),errors:[]};
    let offsets=number(324),lengths=number(325);
    layer.tiled=offsets.length>0;layer.tileWidth=number(322)[0];layer.tileHeight=number(323)[0];
    if(!offsets.length){offsets=number(273);lengths=number(279);}
    if(!offsets.length){offsets=number(513);lengths=number(514);}
    layer.chunks=offsets.length;layer.payloadBytes=lengths.reduce((a,b)=>a+b,0);
    if(kind!=='raw'&&(includePreviews||kind==='mask')&&width&&height&&offsets.length){
      try {
        if(offsets.length!==lengths.length||offsets.length>4096||layer.payloadBytes>128*1024*1024)
          throw Error('Invalid or oversized embedded image');
        layer.sources=offsets.map((offset,i)=>{
          const length=lengths[i];
          if(!length||offset<8||offset+length>bytes.length)throw Error('Embedded image payload is out of bounds');
          // Blob copies only this embedded image. Never retain the original RAW buffer.
          return new Blob([bytes.subarray(offset,offset+length)],{type:[7,34892].includes(layer.compression)?'image/jpeg':'application/octet-stream'});
        });
        layer.rowsPerStrip=number(278)[0]||height;layer.planar=number(284)[0]||1;
      }catch(error){layer.errors.push(error.message);}
    }
    if(tags.has(52525)){
      try{layer.gainTable=readDngGainTable(tags.get(52525),r.little);}
      catch(error){layer.errors.push(error.message);}
    }
    if(tags.has(50940)){
      const entry=tags.get(50940);
      if(entry.type===11&&entry.count<=4096&&entry.count%2===0)
        layer.toneCurve=tagValue(entry,r.little,4096);
    }
    layers.push(layer);
    const children=number(330);if(children.length>64)throw Error('DNG inspection: too many SubIFDs');
    children.forEach((child,i)=>queue.push({off:child,path:`${path}/SubIFD[${i}]`,parent:off}));
    for(const [tag,label] of [[34665,'Exif'],[34853,'GPS'],[40965,'Interop']])
      for(const child of number(tag))queue.push({off:child,path:`${path}/${label}`,parent:off});
    if(table.next)queue.push({off:table.next,path:`${path}/next`,parent});
  }
  return {...info,layers};
}

export async function dngLayerPreview(layer) {
  if(layer.kind==='raw')throw Error('RAW images are inspected without developing them again');
  if(!layer.sources?.length)throw Error('No readable embedded image payload');
  const scale=Math.min(1,1024/Math.max(layer.width,layer.height));
  const w=Math.max(1,Math.round(layer.width*scale)),h=Math.max(1,Math.round(layer.height*scale));
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  const ctx=canvas.getContext('2d',{alpha:false,colorSpace:'srgb'});if(!ctx)throw Error('Canvas unavailable');
  try{
    for(let i=0;i<layer.sources.length;i++){
      const x=layer.tiled?(i%Math.ceil(layer.width/layer.tileWidth))*layer.tileWidth:0;
      const y=layer.tiled?Math.floor(i/Math.ceil(layer.width/layer.tileWidth))*layer.tileHeight:i*layer.rowsPerStrip;
      const sw=layer.tiled?Math.min(layer.tileWidth,layer.width-x):layer.width;
      const sh=Math.min(layer.tiled?layer.tileHeight:layer.rowsPerStrip,layer.height-y);
      if(sw<=0||sh<=0)throw Error('Invalid embedded image geometry');
      let image;
      if([7,34892].includes(layer.compression)){
        const rw=layer.tiled?layer.tileWidth:sw,rh=layer.tiled?layer.tileHeight:sh;
        image=await createImageBitmap(layer.sources[i],{resizeWidth:Math.max(1,Math.round(rw*scale)),
          resizeHeight:Math.max(1,Math.round(rh*scale)),imageOrientation:'none'});
      }else if(layer.compression===1&&layer.planar===1&&layer.bits.every(n=>n===8)&&[1,3,4].includes(layer.samples)){
        const data=new Uint8Array(await layer.sources[i].arrayBuffer());
        const rw=layer.tiled?layer.tileWidth:layer.width,rh=layer.tiled?layer.tileHeight:sh;
        if(rw*rh>4*1024*1024||data.length!==rw*rh*layer.samples)throw Error('Invalid or oversized uncompressed preview');
        image=document.createElement('canvas');image.width=rw;image.height=rh;
        const c=image.getContext('2d'),rgba=c.createImageData(rw,rh);
        for(let p=0,q=0;q<rgba.data.length;p+=layer.samples,q+=4){
          rgba.data[q]=data[p];rgba.data[q+1]=data[p+(layer.samples===1?0:1)];
          rgba.data[q+2]=data[p+(layer.samples===1?0:2)];rgba.data[q+3]=255;
        }
        c.putImageData(rgba,0,0);
      }else throw Error(`Embedded image compression ${layer.compression} is not supported by this preview`);
      try{
        const left=Math.round(x*scale),top=Math.round(y*scale),right=Math.round((x+sw)*scale),bottom=Math.round((y+sh)*scale);
        if(layer.compression===1)ctx.drawImage(image,0,0,sw,sh,left,top,right-left,bottom-top);
        else if(layer.tiled)ctx.drawImage(image,0,0,image.width*sw/layer.tileWidth,image.height*sh/layer.tileHeight,left,top,right-left,bottom-top);
        else ctx.drawImage(image,left,top,right-left,bottom-top);
      }finally{if(image.close)image.close();else image.width=image.height=0;}
    }
    const swapped=layer.orientation>=5&&layer.orientation<=8,out=document.createElement('canvas');
    out.width=swapped?h:w;out.height=swapped?w:h;const target=out.getContext('2d',{alpha:false});
    const transforms={2:[-1,0,0,1,w,0],3:[-1,0,0,-1,w,h],4:[1,0,0,-1,0,h],
      5:[0,1,1,0,0,0],6:[0,1,-1,0,h,0],7:[0,-1,-1,0,h,w],8:[0,-1,1,0,0,w]};
    target.setTransform(...(transforms[layer.orientation]||[1,0,0,1,0,0]));target.drawImage(canvas,0,0);
    try{return await new Promise((resolve,reject)=>out.toBlob(blob=>blob?resolve(blob):reject(Error('DNG preview failed')),'image/png'));}
    finally{out.width=out.height=0;}
  }finally{canvas.width=canvas.height=0;}
}
