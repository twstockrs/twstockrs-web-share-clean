import type {Point} from './model';
export type CurvePiece={start:Point;end:Point;c1:Point;c2:Point;move:boolean};
// Geometry only: the original observation array and marker dates stay unchanged.
// Split at exact straight-path axis crossings. Quadrant-safe shared tangents
// retain crossings and real vertices while removing corners at normal turns.
export function safeCurve(points:(Point|null)[]):CurvePiece[]{
 const pieces:CurvePiece[]=[];let run:Point[]=[];
 const flush=()=>{if(run.length<2){run=[];return}const anchors:Point[]=[run[0]];
  for(let i=1;i<run.length;i++){const a=run[i-1],b=run[i],cuts=new Map<number,number[]>();
   for(const axis of [0,1])if(a[axis]<0&&b[axis]>0||a[axis]>0&&b[axis]<0){const t=-a[axis]/(b[axis]-a[axis]);cuts.set(t,[...(cuts.get(t)||[]),axis])}
   for(const [t,axes] of [...cuts].sort((a,b)=>a[0]-b[0])){const p:Point=[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])];for(const axis of axes)p[axis]=0;anchors.push(p)}anchors.push(b);
  }
  // Share one tangent at each anchor: adjacent cubics then join smoothly.
  // Bound handles to the quadrant, rather than the tiny endpoint rectangle.
  const tangents:Point[]=anchors.map((a,i)=>{const prev=anchors[i-1],next=anchors[i+1],left=prev||a,right=next||a;
   const v:Point=[(right[0]-left[0])*.22,(right[1]-left[1])*.22];
   const distances=[prev?Math.hypot(a[0]-prev[0],a[1]-prev[1]):Infinity,next?Math.hypot(next[0]-a[0],next[1]-a[1]):Infinity];
   const length=Math.hypot(v[0],v[1]),limit=Math.min(...distances)*.45;
   let scale=length>limit?limit/length:1;
   for(const axis of [0,1]){
    if(a[axis]===0){const incoming=prev?Math.sign(prev[axis]):undefined,outgoing=next?Math.sign(next[axis]):undefined;
     if(incoming===0||outgoing===0||incoming!==undefined&&incoming===outgoing||Math.sign(v[axis])!==(outgoing??-incoming!))v[axis]=0;
    }else if(Math.abs(v[axis])>Math.abs(a[axis]))scale=Math.min(scale,Math.abs(a[axis])/Math.abs(v[axis]));
   }
   return [v[0]*scale,v[1]*scale];
  });
  for(let i=0;i<anchors.length-1;i++){const a=anchors[i],b=anchors[i+1],u=tangents[i],v=tangents[i+1];
   pieces.push({start:a,end:b,c1:[a[0]+u[0],a[1]+u[1]],c2:[b[0]-v[0],b[1]-v[1]],move:i===0});
  }run=[];
 };for(const p of points){if(p)run.push(p);else flush()}flush();return pieces;
}
export function curvePath(pieces:CurvePiece[],coord:(point:Point)=>number[]):string{
 return pieces.map(p=>{const a=coord(p.start),b=coord(p.end),c=coord(p.c1),d=coord(p.c2);return `${p.move?`M${a[0]},${a[1]}`:''}C${c[0]},${c[1]} ${d[0]},${d[1]} ${b[0]},${b[1]}`}).join('');
}
