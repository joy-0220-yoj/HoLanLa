import assert from 'node:assert/strict';
import test from 'node:test';
import {box,concat,be,topBox,metaChildren} from '../../web/src/box.js';
import {compactItemProperties,parseIpcoIpma,replaceItemPropertyWithSource,ispeBox,propertyBoxBytes} from '../../web/src/heif.js';

const rawProperty=(bytes,prop)=>bytes.slice(prop.box.off,prop.box.off+prop.box.size);
const descriptions=bytes=>{
  const props=parseIpcoIpma(bytes);
  return [...props.associations].map(([id,list])=>[id,list.map(a=>({essential:a.essential,
    bytes:rawProperty(bytes,props.properties[a.index-1])}))]);
};
function metadata(properties,entries,{version=0,wide=false}={}){
  const associations=entries.map(([id,list])=>concat([be(id,version?4:2),new Uint8Array([list.length]),
    ...list.map(([index,essential])=>be(index|(essential?(wide?0x8000:0x80):0),wide?2:1))]));
  return box('meta',concat([new Uint8Array(4),box('iprp',concat([
    box('ipco',concat(properties)),box('ipma',concat([new Uint8Array([version,0,0,wide?1:0]),be(entries.length,4),...associations])),
    box('free',new Uint8Array([91,17]))])),box('idat',new Uint8Array([8,9,10]))]));
}

test('compaction preserves ordered properties, essential flags, private bytes and 32-bit item IDs',()=>{
  const size=ispeBox(100,200),rotation=box('irot',new Uint8Array([1])),mirror=box('imir',new Uint8Array([0]));
  const opaque=box('zzzz',new Uint8Array([9,0,255,18,44]));
  const properties=[size,rotation,mirror,opaque];
  while(properties.length<127)properties.push(ispeBox(2,properties.length+2));
  properties.push(size);
  const before=metadata(properties,[[70001,[[2,true],[3,false],[128,true],[4,true]]],
    [80002,[[3,true],[2,false],[1,false],[4,false]]]],{version:1,wide:true});
  const compacted=compactItemProperties(before),after=compacted.meta,props=parseIpcoIpma(after);
  assert.deepEqual(descriptions(after),descriptions(before),'transforms retain their order and per-item essential flags');
  assert.equal(props.version,1);assert.equal(props.flags&1,0);
  assert.equal(compacted.before,128);assert.equal(compacted.after,4);
  assert.equal(compacted.removedUnused,123);assert.equal(compacted.mergedDuplicates,1);
  const idat=bytes=>{const child=metaChildren(bytes,topBox(bytes,'meta')).find(b=>b.type==='idat');return bytes.slice(child.off,child.off+child.size);};
  assert.deepEqual(idat(after),idat(before));
  assert.deepEqual(compactItemProperties(after).meta,after,'compaction is idempotent');
});

test('more than 127 distinct used properties retain wide associations',()=>{
  const properties=Array.from({length:130},(_,i)=>ispeBox(i+1,2));
  const before=metadata(properties,[[1,properties.map((_,i)=>[i+1,i%2===0])]],{wide:true});
  const compacted=compactItemProperties(before);
  assert.equal(compacted.after,130);assert.equal(parseIpcoIpma(compacted.meta).flags&1,1);
  assert.deepEqual(descriptions(compacted.meta),descriptions(before));
});

test('editing one item leaves other users of the same property unchanged',()=>{
  const original=ispeBox(100,200),replacement=ispeBox(300,400);
  const before=metadata([original],[[1,[[1,true]]],[2,[[1,false]]]]);
  const after=replaceItemPropertyWithSource(before,1,'ispe',replacement),props=parseIpcoIpma(after);
  assert.deepEqual(propertyBoxBytes(after,props,1,'ispe'),replacement);
  assert.deepEqual(propertyBoxBytes(after,props,2,'ispe'),original);
  assert.equal(props.associations.get(1)[0].essential,true);
  assert.equal(props.associations.get(2)[0].essential,false);
  const shared=replaceItemPropertyWithSource(after,2,'ispe',replacement);
  assert.equal(parseIpcoIpma(shared).properties.length,2,'an existing equal value is reused');
  assert.equal(compactItemProperties(shared).after,1,'the obsolete value is removed after all edits');
});
