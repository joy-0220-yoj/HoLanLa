// Synthetic standard profiles, with D50-adapted XYZ values independent of the
// recognizer and all three channel curves sharing the same tag data.
import {concat,be} from "../../web/src/box.js";
const ascii = text => new TextEncoder().encode(text);
const fixed = value => be(Math.round(value*65536)>>>0,4);
export function iccFixture({space="srgb",linear=false,sampled=false,lut=false,gamma=null,identity=false,appleP3=false}={}) {
  const xyz = values => concat([ascii("XYZ "),new Uint8Array(4),...values.map(fixed)]);
  const columns = appleP3
    ? [[0x83dc,0x3dbd,-0x45],[0x4abd,0xb136,0xab9],[0x283d,0x110c,0xc8d8]].map(c=>c.map(v=>v/65536))
    : space === "p3"
    ? [[0x83df,0x3dbf,-0x45],[0x4abf,0xb137,0xab9],[0x2838,0x110b,0xc8b9]].map(c=>c.map(v=>v/65536))
    : [[0.4360747,0.2225045,0.0139322],[0.3850649,0.7168786,0.0971045],[0.1430804,0.0606169,0.7141733]];
  let curve;
  if(identity){curve=concat([ascii("curv"),new Uint8Array(4),be(1,4),be(256,2)]);}
  else if(sampled){
    const n=1024;
    curve=concat([ascii("curv"),new Uint8Array(4),be(n,4),...Array.from({length:n},(_,i)=>{
      const x=i/(n-1),y=linear?x:x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4;
      return be(Math.round(y*65535),2);
    })]);
  }else{
    const params=gamma!=null?[gamma]:linear?[1]:[2.4,1/1.055,0.055/1.055,1/12.92,0.04045];
    curve=concat([ascii("para"),new Uint8Array(4),be(params.length===1?0:3,2),new Uint8Array(2),...params.map(fixed)]);
  }
  const mluc = text => {
    const encoded=concat([...text].map(c=>be(c.charCodeAt(0),2)));
    return concat([ascii("mluc"),new Uint8Array(4),be(1,4),be(12,4),ascii("enUS"),be(encoded.length,4),be(28,4),encoded]);
  };
  let entries = [["desc",mluc(space === "p3" ? "Display P3" : "sRGB")],["cprt",mluc("Synthetic test profile")],
    ["wtpt",xyz([0.9642,1,0.8249])],...["rXYZ","gXYZ","bXYZ"].map((name,i)=>[name,xyz(columns[i])]),
    ["chad",concat([ascii("sf32"),new Uint8Array(4),...(appleP3
      ? [0x10c3d,0x5dc,-0xcd5,0x790,0xfd90,-0x45d,-0x25d,0x3da,0xc08c]
      : [0x10c42,0x5de,-0xcda,0x793,0xfd90,-0x45e,-0x25d,0x3dc,0xc06e]).map(v=>be(v>>>0,4))])],
    ["rTRC",curve],["gTRC",curve],["bTRC",curve]];
  if(space==="gray")entries=[["desc",mluc("Gray profile")],["cprt",mluc("Synthetic test profile")],
    ["wtpt",xyz([0.9642,1,0.8249])],["kTRC",curve]];
  if(lut)entries.push(["A2B0",concat([ascii("mAB "),new Uint8Array(24)])]);
  const head=new Uint8Array(128),view=new DataView(head.buffer);
  head[8]=4;head.set(ascii("mntr"),12);head.set(ascii(space==="gray"?"GRAY":"RGB "),16);head.set(ascii("XYZ "),20);head.set(ascii("acsp"),36);
  for(const [i,value] of [0.9642,1,0.8249].entries())head.set(fixed(value),68+i*4);
  let offset=132+entries.length*12;
  const table=[],payloads=[],locations=new Map();
  for(const [name,data] of entries){
    if(!locations.has(data)){locations.set(data,offset);payloads.push(data,new Uint8Array((4-data.length%4)%4));offset+=Math.ceil(data.length/4)*4;}
    table.push(concat([ascii(name),be(locations.get(data),4),be(data.length,4)]));
  }
  view.setUint32(0,offset);
  return concat([head,be(entries.length,4),...table,...payloads]);
}
