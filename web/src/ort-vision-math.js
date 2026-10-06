import {CANONICAL_FACE, FACE_POSE_WEIGHTS} from './face-canonical.js?v=0.8.0';

export const sigmoid = value => 1 / (1 + Math.exp(-Math.max(-100, Math.min(100, value))));
export const FACE_ANCHORS = [16, 8].flatMap((cells, layer) =>
  Array.from({length:cells*cells}, (_, i) => Array.from({length:layer ? 6 : 2}, () =>
    [(i % cells + .5) / cells, (Math.floor(i / cells) + .5) / cells])).flat());

function iou(a, b) {
  const intersection = Math.max(0, Math.min(a[1]+a[3]/2,b[1]+b[3]/2)-Math.max(a[1]-a[3]/2,b[1]-b[3]/2))
    * Math.max(0, Math.min(a[2]+a[4]/2,b[2]+b[4]/2)-Math.max(a[2]-a[4]/2,b[2]-b[4]/2));
  return intersection / Math.max(1e-9, a[3]*a[4]+b[3]*b[4]-intersection);
}

// BlazeFace SSD decode and score-weighted suppression, including the six keypoints.
// Algorithm reference: yakhyo/mediapipe-face-mesh-onnx, models/blazeface.py (Apache-2.0).
export function decodeFaceDetections(regressors, logits, width, height, threshold = .35) {
  if (regressors.length !== 896*16 || logits.length !== 896) throw Error('Unexpected ONNX Runtime detector output');
  let rows=[];
  FACE_ANCHORS.forEach(([ax,ay], i) => {
    const score=sigmoid(logits[i]), p=i*16;
    if(score<threshold || regressors[p+2]<=0 || regressors[p+3]<=0)return;
    const row=[score,regressors[p]/128+ax,regressors[p+1]/128+ay,regressors[p+2]/128,regressors[p+3]/128];
    for(let k=0;k<6;k++)row.push(regressors[p+4+k*2]/128+ax,regressors[p+5+k*2]/128+ay);
    if(row.every(Number.isFinite))rows.push(row);
  });
  rows.sort((a,b)=>b[0]-a[0]);
  const detections=[], side=Math.max(width,height), px=(side-width)/2, py=(side-height)/2;
  while(rows.length && detections.length<5) {
    const top=rows[0], group=rows.filter(row=>iou(top,row)>.3), sum=group.reduce((s,row)=>s+row[0],0);
    const blended=top.map((v,k)=>k ? group.reduce((s,row)=>s+row[k]*row[0],0)/sum : v);
    rows=rows.filter(row=>iou(top,row)<=.3);
    const [score,cx,cy,w,h]=blended;
    const eyes=[[blended[5]*side-px,blended[6]*side-py],[blended[7]*side-px,blended[8]*side-py]];
    detections.push({score,cx:cx*side-px,cy:cy*side-py,side:1.5*Math.max(w,h)*side,
      angle:Math.atan2(eyes[1][1]-eyes[0][1],eyes[1][0]-eyes[0][0])});
  }
  return detections;
}

export function remapOrtLandmarks(values, roi, width, height) {
  if(values.length!==478*3)throw Error('ONNX Runtime landmark model must return 478 XYZ points');
  const c=Math.cos(roi.angle),s=Math.sin(roi.angle),scale=roi.side/256;
  const points=Array.from({length:478},(_,i)=>{
    const x=(values[i*3]-128)*scale,y=(values[i*3+1]-128)*scale;
    return {x:(roi.cx+c*x-s*y)/width,y:(roi.cy+s*x+c*y)/height,z:values[i*3+2]*scale/width};
  });
  if(points.some(p=>!Object.values(p).every(Number.isFinite)))throw Error('Non-finite ONNX Runtime landmarks');
  return points;
}

export function selfieConfidencePlanes(logits) {
  if(logits.length!==256*256*6)throw Error('Unexpected ONNX Runtime SelfieMulticlass output');
  const planes=Array.from({length:6},()=>new Float32Array(256*256));
  for(let i=0;i<256*256;i++) {
    const p=i*6,max=Math.max(...logits.subarray(p,p+6));
    let sum=0;for(let k=0;k<6;k++)sum+=Math.exp(logits[p+k]-max);
    if(!Number.isFinite(sum)||sum<=0)throw Error('Non-finite ONNX Runtime segmentation probabilities');
    for(let k=0;k<6;k++)planes[k][i]=Math.exp(logits[p+k]-max)/sum;
  }
  return planes;
}

// Symmetric Jacobi eigensolver avoids the sign/degeneracy problem of power iteration.
function largestEigenvector(matrix) {
  const a=matrix.map(row=>row.slice()),v=Array.from({length:4},(_,i)=>Array.from({length:4},(_,j)=>+(i===j)));
  for(let iteration=0;iteration<60;iteration++) {
    let p=0,q=1;
    for(let i=0;i<4;i++)for(let j=i+1;j<4;j++)if(Math.abs(a[i][j])>Math.abs(a[p][q])){p=i;q=j;}
    if(Math.abs(a[p][q])<1e-12)break;
    const theta=.5*Math.atan2(2*a[p][q],a[q][q]-a[p][p]),c=Math.cos(theta),s=Math.sin(theta);
    const app=a[p][p],aqq=a[q][q],apq=a[p][q];
    for(let k=0;k<4;k++)if(k!==p&&k!==q){const kp=a[k][p],kq=a[k][q];a[k][p]=a[p][k]=c*kp-s*kq;a[k][q]=a[q][k]=s*kp+c*kq;}
    a[p][p]=c*c*app-2*s*c*apq+s*s*aqq;a[q][q]=s*s*app+2*s*c*apq+c*c*aqq;a[p][q]=a[q][p]=0;
    for(let k=0;k<4;k++){const kp=v[k][p],kq=v[k][q];v[k][p]=c*kp-s*kq;v[k][q]=s*kp+c*kq;}
  }
  const index=a.reduce((best,row,i)=>row[i]>a[best][best]?i:best,0);
  return v.map(row=>row[index]);
}

// Weighted similarity fit using Horn's quaternion formulation. Matrix is column-major.
export function weightedFaceTransform(targets, sources=CANONICAL_FACE, weights=FACE_POSE_WEIGHTS) {
  const mass=weights.reduce((sum,[,w])=>sum+w,0),sc=[0,0,0],tc=[0,0,0],h=Array.from({length:3},()=>[0,0,0]);
  for(const [i,w] of weights)for(let k=0;k<3;k++){sc[k]+=sources[i][k]*w/mass;tc[k]+=targets[i][k]*w/mass;}
  let denominator=0;
  for(const [i,w] of weights){const a=sources[i].map((x,k)=>x-sc[k]),b=targets[i].map((x,k)=>x-tc[k]);
    for(let j=0;j<3;j++){denominator+=w*a[j]*a[j];for(let k=0;k<3;k++)h[j][k]+=w*a[j]*b[k];}}
  const [[xx,xy,xz],[yx,yy,yz],[zx,zy,zz]]=h;
  const [w,x,y,z]=largestEigenvector([[xx+yy+zz,yz-zy,zx-xz,xy-yx],[yz-zy,xx-yy-zz,xy+yx,zx+xz],
    [zx-xz,xy+yx,-xx+yy-zz,yz+zy],[xy-yx,zx+xz,yz+zy,-xx-yy+zz]]);
  const r=[[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],
    [2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]];
  let numerator=0;
  for(const [i,weight]of weights)for(let k=0;k<3;k++)numerator+=weight*(targets[i][k]-tc[k])*r[k].reduce((sum,v,j)=>sum+v*(sources[i][j]-sc[j]),0);
  const scale=numerator/denominator;
  if(!Number.isFinite(scale)||scale<1e-8)throw Error('ONNX Runtime face pose fit is degenerate');
  const t=tc.map((value,k)=>value-scale*r[k].reduce((sum,v,j)=>sum+v*sc[j],0));
  return [r[0][0]*scale,r[1][0]*scale,r[2][0]*scale,0,r[0][1]*scale,r[1][1]*scale,r[2][1]*scale,0,
    r[0][2]*scale,r[1][2]*scale,r[2][2]*scale,0,...t,1];
}

// MediaPipe's two-pass screen-to-metric procedure, with its default 63-degree virtual camera.
// See mediapipe/modules/face_geometry/libs/geometry_pipeline.cc (Apache-2.0).
export function ortFacePoseMatrix(landmarks,width,height) {
  const ys=2*Math.tan(63*Math.PI/360),xs=ys*width/height;
  const screen=landmarks.slice(0,468).map(p=>[(p.x-.5)*xs,(.5-p.y)*ys,p.z*xs]);
  const depth=screen.reduce((sum,p)=>sum+p[2],0)/468;
  const first=weightedFaceTransform(screen.map(([x,y,z])=>[x,y,-z]));
  const scale1=Math.hypot(...first.slice(0,3));
  const metric=scale=>screen.map(([x,y,z])=>{const d=(z-depth+1)/scale;return [x*d,y*d,-d];});
  const second=weightedFaceTransform(metric(scale1)),scale2=Math.hypot(...second.slice(0,3));
  return weightedFaceTransform(metric(scale1*scale2));
}
