import {dngLayerPreview} from './dng-inspection.js?v=0.8.0';
import {MATTE_URIS} from './heif.js?v=0.8.0';
import {MATTE_2026_URIS} from './texture.js?v=0.8.0';
import {faceMatteDimensions, matteToStored, encodeFaceMatte, FACE_MATTE_PIXI} from './face-mattes.js?v=0.8.0';

export function dngMatteUri(semantic) {
  if(typeof semantic!=='string'||!['urn:com:apple:photo:','tag:apple.com,'].some(prefix=>semantic.startsWith(prefix)))return null;
  const name=semantic.split(':').at(-1);
  return MATTE_URIS[name]||MATTE_2026_URIS.find(uri=>uri.split(':').at(-1)===name)||null;
}

// HEIC style fields have no direct DNG counterpart. Missing a HEIC field is not
// evidence that the DNG lacks RAW, previews or rendering data.
export function dngInspectionEntry(inspection, name) {
  const uri=dngMatteUri(`urn:com:apple:photo:2020:aux:${name}`);
  if(!uri)return {name,present:false,notComparable:true};
  const layers=inspection.layers.filter(layer=>layer.kind==='mask'&&dngMatteUri(layer.semantic)===uri);
  return {name,present:layers.length>0,dngMask:true,value:layers.length?layers.map(layer=>({directory:layer.path,
    semanticName:layer.semantic,width:layer.width,height:layer.height,compression:layer.compression})):undefined};
}

// Decode only recognized, full-frame source masks. They are source data even with face inference off.
export async function prepareDngMattes(inspection, image, onProgress=()=>{}) {
  const masks=new Map(),encoded=new Map();
  if(!inspection)return {masks,encoded};
  const candidates=inspection.layers.filter(layer=>layer.kind==='mask'&&dngMatteUri(layer.semantic));
  if(candidates.length)onProgress({stage:'dngNativeMask',done:0,total:candidates.length});
  const dimensions=faceMatteDimensions(image.width,image.height), raw=inspection.layers.find(layer=>layer.kind==='raw');
  for(const layer of inspection.layers){
    const uri=dngMatteUri(layer.semantic);if(!uri||layer.kind!=='mask')continue;
    try{
      const area=layer.fields.find(field=>field.tag===52536)?.value;
      if(area&&(!Array.isArray(area)||area.length!==4||area[0]!==0||area[1]!==0
        ||(area.slice(2).some(n=>n!==0)&&area.slice(2).sort((a,b)=>a-b).join()!==[raw?.width,raw?.height].sort((a,b)=>a-b).join())))
        throw Error('Cropped DNG mask requires spatial alignment');
      const swapped=layer.orientation>=5&&layer.orientation<=8;
      const aspect=(swapped?layer.height/layer.width:layer.width/layer.height)/(image.width/image.height);
      if(!Number.isFinite(aspect)||Math.abs(aspect-1)>.015)throw Error('DNG mask and RAW aspect ratios disagree');
      const bitmap=await createImageBitmap(await dngLayerPreview(layer));
      const surface=document.createElement('canvas');surface.width=dimensions.width;surface.height=dimensions.height;
      const ctx=surface.getContext('2d',{willReadFrequently:true});
      try{ctx.drawImage(bitmap,0,0,surface.width,surface.height);}finally{bitmap.close();}
      const pixels=ctx.getImageData(0,0,surface.width,surface.height);
      const existing=masks.get(uri),previous=existing?.getContext('2d').getImageData(0,0,surface.width,surface.height).data;
      for(let p=0;p<pixels.data.length;p+=4){const value=Math.max(pixels.data[p],previous?.[p+3]||0);
        pixels.data[p]=pixels.data[p+1]=pixels.data[p+2]=255;pixels.data[p+3]=value;}
      ctx.putImageData(pixels,0,0);
      if(existing)existing.width=existing.height=0;masks.set(uri,surface);
    }catch(error){onProgress({stage:'dngNativeMaskSkipped',name:layer.semantic,error:error.message});}
  }
  let done=0;
  for(const [uri,mask] of masks){
    const opaque=document.createElement('canvas');opaque.width=mask.width;opaque.height=mask.height;
    const ctx=opaque.getContext('2d',{alpha:false});ctx.fillStyle='black';ctx.fillRect(0,0,opaque.width,opaque.height);ctx.drawImage(mask,0,0);
    const stored=matteToStored(opaque,270,null);
    try{encoded.set(uri,{...await encodeFaceMatte(stored,onProgress),pixi:FACE_MATTE_PIXI});}
    finally{stored.width=stored.height=opaque.width=opaque.height=0;}
    onProgress({stage:'dngNativeMask',done:++done,total:masks.size});
  }
  // Legacy skin is also the source for the v2 all-skin mask; person can serve both conventions.
  if(encoded.has(MATTE_URIS.semanticskinmatte))encoded.set(MATTE_2026_URIS[1],encoded.get(MATTE_URIS.semanticskinmatte));
  const personUri=MATTE_2026_URIS.find(uri=>uri.endsWith(':semanticpersonmatte'));
  if(encoded.has(MATTE_URIS.portraiteffectsmatte))encoded.set(personUri,encoded.get(MATTE_URIS.portraiteffectsmatte));
  else if(encoded.has(personUri))encoded.set(MATTE_URIS.portraiteffectsmatte,encoded.get(personUri));
  return {masks,encoded};
}
