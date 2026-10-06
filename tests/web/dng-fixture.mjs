import {be, concat} from '../../web/src/box.js';
import {TIFF_TYPE_SIZES} from '../../web/src/heif.js';
import {dngReader} from '../../web/src/dng-tiff.js';

// Synthetic LinearRaw, not an embedded JPEG preview or a private camera photo.
export function dngFixture({little = false, orientation = 6, compression = 1} = {}) {
  const n = (v, size) => little ? be(v, size).reverse() : be(v, size);
  const ascii = value => new TextEncoder().encode(value + '\0');
  const fields = [], add = (tag, type, data) => fields.push({tag, type, data});
  const short = (tag, value) => add(tag, 3, n(value, 2)), long = (tag, value) => add(tag, 4, n(value, 4));
  const rational = values => concat(values.flatMap(([v, den]) => [n(v, 4), n(den, 4)]));
  long(254, 0); long(256, 128); long(257, 96);
  add(258, 3, concat([n(16, 2), n(16, 2), n(16, 2)]));
  short(259, compression); short(262, 34892);
  add(271, 2, ascii('Test camera')); add(272, 2, ascii('Synthetic DNG'));
  long(273, 0); short(274, orientation); short(277, 3); long(278, 96);
  long(279, 128 * 96 * 6); short(284, 1); add(306, 2, ascii('2000:01:01 00:00:00'));
  long(0x8769, 0); long(0x8825, 0);
  add(50706, 1, new Uint8Array([1, 4, 0, 0])); add(50707, 1, new Uint8Array([1, 1, 0, 0]));
  add(50708, 2, ascii('Synthetic LinearRaw'));
  long(50717, 65535);
  add(50721, 10, rational([[1,1],[0,1],[0,1],[0,1],[1,1],[0,1],[0,1],[0,1],[1,1]]));
  add(50728, 5, rational([[1,1],[1,1],[1,1]])); short(50778, 21);
  let cursor = 8 + 6 + fields.length * 12;
  const values = [], entries = [];
  for (const field of fields.sort((a,b) => a.tag - b.tag)) {
    let value = new Uint8Array(4);
    if (field.data.length <= 4) value.set(field.data);
    else {value = n(cursor, 4); values.push(field.data); cursor += field.data.length;}
    entries.push(concat([n(field.tag, 2), n(field.type, 2), n(field.data.length / TIFF_TYPE_SIZES[field.type], 4), value]));
  }
  const entry = (tag,type,count,value) => concat([n(tag,2),n(type,2),n(count,4),value]);
  const point = (tag,value) => entries[fields.findIndex(field => field.tag === tag)].set(n(value,4),8);
  point(0x8769,cursor);
  const date=ascii('2000:01:01 00:00:00');
  values.push(concat([n(2,2),entry(0x8827,3,1,concat([n(100,2),n(0,2)])),entry(0x9003,2,date.length,n(cursor+30,4)),n(0,4),date]));
  cursor+=30+date.length;
  point(0x8825,cursor);
  const latitude=rational([[0,1],[0,1],[0,1]]);
  values.push(concat([n(2,2),entry(1,2,2,new Uint8Array([78,0,0,0])),entry(2,5,3,n(cursor+30,4)),n(0,4),latitude]));
  cursor+=30+latitude.length;
  const strip = fields.findIndex(field => field.tag === 273);
  entries[strip].set(n(cursor, 4), 8);
  const pixels = new Uint8Array(128 * 96 * 6), view = new DataView(pixels.buffer);
  for (let y = 0; y < 96; y++) for (let x = 0; x < 128; x++) {
    const p = (y * 128 + x) * 6;
    view.setUint16(p, 1000 + x * 300, little); view.setUint16(p + 2, 1000 + y * 400, little);
    view.setUint16(p + 4, 10000, little);
  }
  return concat([new TextEncoder().encode(little ? 'II' : 'MM'), n(42,2), n(8,4), n(fields.length,2), ...entries, n(0,4), ...values, pixels]);
}

// Constant 16-bit RGB lossless-JPEG tiles. Large dimensions cost only compressed tile bytes,
// so the 48MP regression can verify bounded tile decoding without a private photo fixture.
export function tiledDngFixture({width = 8192, height = 6144, tileWidth = 512, tileHeight = 384,
  little = false, orientation = 6} = {}) {
  const r = dngReader(dngFixture({little, orientation})), fields = new Map(r.ifd(r.rootOffset).entries);
  for (const tag of [273,278,279,0x8769,0x8825]) fields.delete(tag);
  const n = (v,size) => little ? be(v,size).reverse() : be(v,size);
  const set = (tag,type,values) => fields.set(tag,{tag,type,count:values.length,data:concat(values.map(v=>n(v,TIFF_TYPE_SIZES[type])))});
  const marker = (code,data) => concat([new Uint8Array([255,code]),be(data.length+2,2),data]);
  const huffman = marker(196,new Uint8Array([0,1,...new Array(15).fill(0),0]));
  const frame = marker(195,concat([new Uint8Array([16]),be(tileHeight,2),be(tileWidth,2),new Uint8Array([3,1,17,0,2,17,0,3,17,0])]));
  const scan = marker(218,new Uint8Array([3,1,0,2,0,3,0,1,0,0]));
  const tile = concat([new Uint8Array([255,216]),huffman,frame,scan,
    new Uint8Array(Math.ceil(tileWidth*tileHeight*3/8)),new Uint8Array([255,217])]);
  const count = Math.ceil(width/tileWidth)*Math.ceil(height/tileHeight);
  set(256,4,[width]); set(257,4,[height]); set(259,3,[7]);
  set(322,4,[tileWidth]); set(323,4,[tileHeight]);
  set(324,4,new Array(count).fill(0)); set(325,4,new Array(count).fill(tile.length));
  let cursor = 8+6+fields.size*12;
  for (const {data} of fields.values()) if(data.length>4) cursor+=(data.length+1)&~1;
  set(324,4,Array.from({length:count},(_,i)=>cursor+i*tile.length));
  const out = new Uint8Array(cursor+count*tile.length), view = new DataView(out.buffer);
  out.set(new TextEncoder().encode(little?'II':'MM')); view.setUint16(2,42,little);view.setUint32(4,8,little);view.setUint16(8,fields.size,little);
  let p=10, value=8+6+fields.size*12;
  for(const [tag,entry] of [...fields].sort(([a],[b])=>a-b)){
    view.setUint16(p,tag,little);view.setUint16(p+2,entry.type,little);view.setUint32(p+4,entry.count,little);
    if(entry.data.length<=4)out.set(entry.data,p+8);
    else{view.setUint32(p+8,value,little);out.set(entry.data,value);value+=(entry.data.length+1)&~1;}p+=12;
  }
  for(let i=0;i<count;i++)out.set(tile,cursor+i*tile.length);
  return out;
}

export function dngInspectionFixture({little=false}={}) {
  const source=dngFixture({little}),r=dngReader(source),root=new Map(r.ifd(r.rootOffset).entries);
  const n=(v,size)=>little?be(v,size).reverse():be(v,size);
  const entry=(tag,type,data)=>({tag,type,count:data.length/TIFF_TYPE_SIZES[type],data});
  const values=(tag,type,items)=>entry(tag,type,concat(items.map(v=>n(v,TIFF_TYPE_SIZES[type]))));
  const gain=new Uint8Array(64+2*3*4*4),g=new DataView(gain.buffer);
  g.setUint32(0,2,little);g.setUint32(4,3,little);g.setFloat64(8,.5,little);g.setFloat64(16,1/3,little);g.setUint32(40,4,little);
  for(let i=0;i<3;i++)g.setFloat32(44+i*4,1/3,little);
  for(let i=0;i<24;i++)g.setFloat32(64+i*4,.5+i/16,little);
  root.set(52525,entry(52525,7,gain));
  const tone=new Uint8Array(24),t=new DataView(tone.buffer);
  [0,0,.5,.25,1,1].forEach((v,i)=>t.setFloat32(i*4,v,little));root.set(50940,entry(50940,11,tone));
  root.set(330,values(330,4,[0,0,0]));
  const names=['semanticskymatte','semanticskinmatte','portraiteffectsmatte'];
  const masks=names.map((name,index)=>{
    const table=new Map();
    for(const e of [values(254,4,[65540]),values(256,4,[4]),values(257,4,[3]),values(258,3,[8]),
      values(259,3,[1]),values(262,3,[52527]),values(277,3,[1]),values(278,4,[3]),values(279,4,[12]),
      values(273,4,[0]),entry(52526,2,new TextEncoder().encode(`urn:com:apple:photo:2020:aux:${name}\0`))])table.set(e.tag,e);
    return {table,pixels:index===0?Uint8Array.from({length:12},(_,i)=>i*10):new Uint8Array(12).fill(index===1?200:255)};
  });
  const tables=[root,...masks.map(mask=>mask.table)],offsets=[];
  let cursor=source.length;
  for(const table of tables){offsets.push(cursor);cursor+=6+table.size*12;}
  for(const table of tables)for(const e of table.values())if(e.data.length>4)cursor+=(e.data.length+1)&~1;
  root.set(330,values(330,4,offsets.slice(1)));
  for(const mask of masks){mask.table.set(273,values(273,4,[cursor]));cursor+=mask.pixels.length;}
  const out=new Uint8Array(cursor);out.set(source);const v=new DataView(out.buffer);v.setUint32(4,offsets[0],little);
  cursor=offsets.at(-1)+6+tables.at(-1).size*12;
  for(let i=0;i<tables.length;i++){
    const table=tables[i];v.setUint16(offsets[i],table.size,little);let p=offsets[i]+2;
    for(const [tag,e] of [...table].sort(([a],[b])=>a-b)){
      v.setUint16(p,tag,little);v.setUint16(p+2,e.type,little);v.setUint32(p+4,e.count,little);
      if(e.data.length<=4)out.set(e.data,p+8);
      else{v.setUint32(p+8,cursor,little);out.set(e.data,cursor);cursor+=(e.data.length+1)&~1;}p+=12;
    }
  }
  for(const mask of masks){out.set(mask.pixels,cursor);cursor+=mask.pixels.length;}
  return out;
}
