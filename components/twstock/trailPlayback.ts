import {lastPoint,quadrant,type Point} from './model';
import {safeCurve,type CurvePiece} from './safeCurve';
export type TrailPaths=Record<string,(Point|null)[]>;
export const trailPlaybackLength=(paths:TrailPaths)=>Math.max(0,...Object.values(paths).map(points=>points.filter(Boolean).length));
export const latestTrailQuadrants=(paths:TrailPaths)=>Object.fromEntries(Object.entries(paths).flatMap(([id,points])=>{const last=lastPoint(points);return last?[[id,quadrant(last)]]:[]}));
// Reveal original observations only. Keep internal null gaps, never add a price or point.
export function trailPlaybackFrame(paths:TrailPaths,frame:number):TrailPaths{
 return Object.fromEntries(Object.entries(paths).map(([id,points])=>{
  if(frame>=points.filter(Boolean).length)return [id,points];
  let seen=0,end=0;for(let i=0;i<points.length;i++)if(points[i]){if(++seen>frame)break;end=i+1}
  return [id,points.slice(0,end)];
 }));
}
// Use the full trail's tangents throughout playback, so already drawn curves do
// not bend again when another real observation becomes visible.
export function trailPlaybackGeometry(full:(Point|null)[],visible:(Point|null)[]):CurvePiece[]{
 const geometry=safeCurve(full),revealed=new Set(visible.filter(Boolean));let end=-1;
 geometry.forEach((piece,index)=>{if(revealed.has(piece.end))end=index});
 return geometry.slice(0,end+1);
}
