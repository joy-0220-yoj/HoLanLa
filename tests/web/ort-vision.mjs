import assert from 'node:assert/strict';
import test from 'node:test';
import {FACE_ANCHORS,decodeFaceDetections,remapOrtLandmarks,selfieConfidencePlanes,weightedFaceTransform} from '../../web/src/ort-vision-math.js';

test('weighted pose recovers rotation, scale and translation',()=>{
 const source=[[0,0,0],[1,0,0],[0,1,0],[0,0,1],[2,-1,3]],weights=source.map((_,i)=>[i,i+1]);
 for(const angle of [0,.7,-1.3,Math.PI]){
  const c=Math.cos(angle),s=Math.sin(angle),target=source.map(([x,y,z])=>[2*(c*x-s*y)+3,2*(s*x+c*y)-4,2*z+5]);
  const matrix=weightedFaceTransform(target,source,weights);
  source.forEach((point,i)=>{for(let row=0;row<3;row++){
    const actual=point.reduce((sum,v,k)=>sum+v*matrix[k*4+row],matrix[12+row]);
    assert.ok(Math.abs(actual-target[i][row])<1e-8,`${angle}: ${actual} != ${target[i][row]}`);
  }});
 }
});
test('478-point remap respects rotation, image aspect and depth scaling',()=>{
 const data=new Float32Array(478*3);for(let i=0;i<478;i++)data.set([192,128,16],i*3);
 const points=remapOrtLandmarks(data,{cx:200,cy:100,side:256,angle:Math.PI/2},400,200);
 assert.equal(points.length,478);assert.ok(Math.abs(points[0].x-.5)<1e-8);
 assert.ok(Math.abs(points[0].y-.82)<1e-8);assert.equal(points[0].z,.04);
});
test('six-class logits become finite normalized confidence planes',()=>{
 const values=new Float32Array(256*256*6);values.set([1000,1001,-1000,998,995,994]);
 const planes=selfieConfidencePlanes(values);
 assert.equal(planes.length,6);assert.ok(planes[1][0]>planes[0][0]);
 for(const i of [0,1,65535])assert.ok(Math.abs(planes.reduce((sum,p)=>sum+p[i],0)-1)<1e-6);
 values[0]=NaN;assert.throws(()=>selfieConfidencePlanes(values),/Non-finite/);
});
test('SSD decode suppresses duplicate anchors and reverses letterboxing',()=>{
 assert.equal(FACE_ANCHORS.length,896);
 const reg=new Float32Array(896*16),scores=new Float32Array(896).fill(-100);
 for(const i of [0,1]){scores[i]=10;const [ax,ay]=FACE_ANCHORS[i];
  reg.set([(.5-ax)*128,(.5-ay)*128,32,32,(.4-ax)*128,(.5-ay)*128,(.6-ax)*128,(.5-ay)*128],i*16);}
 const detections=decodeFaceDetections(reg,scores,400,200);
 assert.equal(detections.length,1);assert.equal(detections[0].cx,200);assert.equal(detections[0].cy,100);
 assert.equal(detections[0].side,150);assert.equal(detections[0].angle,0);
});
