import type {Point} from './model';
export type Viewport={x:[number,number];y:[number,number]};
export function fitViewport(points:Point[]):Viewport{
 const extent=points.reduce((max,p)=>Math.max(max,...p.filter(Number.isFinite).map(Math.abs)),0);
 const radius=Math.max(2,extent*1.25);
 return {x:[-radius,radius],y:[-radius,radius]};
}
export function zoomViewport(view:Viewport,anchor:Point,factor:number):Viewport{
 // Numerical safeguards only; zoom is not bounded by the data extent.
 const span=view.x[1]-view.x[0];
 const scale=Math.max(0.001,Math.min(1e9,span*factor))/span;
 return {x:view.x.map(n=>anchor[0]+(n-anchor[0])*scale) as [number,number],y:view.y.map(n=>anchor[1]+(n-anchor[1])*scale) as [number,number]};
}
export function panViewport(view:Viewport,dx:number,dy:number,width:number,height:number):Viewport{
 const x=dx/width*(view.x[1]-view.x[0]),y=dy/height*(view.y[1]-view.y[0]);
 return {x:[view.x[0]-x,view.x[1]-x],y:[view.y[0]+y,view.y[1]+y]};
}
