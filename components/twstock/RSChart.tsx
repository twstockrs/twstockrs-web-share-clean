"use client";
import {useEffect,useRef,useImperativeHandle,type Ref} from 'react';
import {echarts} from './chartRuntime';
import {zoomViewport,panViewport,Viewport} from './viewport';
import {chartGrid,fittedView,quadrantAreas,buildChartOptions} from './chartOptions';
import {colors,Entity,Point} from './model';
import type {ChartSnapshot} from './pngExport';
export type ChartExportHandle={snapshot:()=>ChartSnapshot};
export type ChartProps={theme:"light"|"dark";entities:Entity[];paths:Record<string,(Point|null)[]>;pointDates:Record<string,string[]>;pointPriceDates?:Record<string,string[]>;sourceLabel?:string;markers?:number;quadrants?:typeof colors;selectedId:string|null;hoveredId:string|null;filter:string;viewingDate:string;onSelect:(id:string)=>void;onClearSelection:()=>void;onHover:(id:string|null)=>void;viewportAction:{type:string;key:number};fitPaths?:Record<string,(Point|null)[]>;colorQuadrants?:Record<string,string>;onMeasure?:(value:{set_option_ms:number;finished_ms:number})=>void};
function applyViewport(c:echarts.ECharts,view:Viewport,dark:boolean){
 c.getDom().setAttribute('data-chart-viewport',JSON.stringify(view));
 c.setOption({animation:false,xAxis:{min:view.x[0],max:view.x[1]},yAxis:{min:view.y[0],max:view.y[1]},series:[{id:'quadrants',markArea:{data:quadrantAreas(view,dark)}}]} as any,{lazyUpdate:false});
}
// DOM diagnostics describe the applied chart only; no account or quote data.
function elementProof(c:echarts.ECharts,view:Viewport,series:any[]){c.getDom().setAttribute('data-chart-viewport',JSON.stringify(view));c.getDom().setAttribute('data-chart-colors',JSON.stringify(Object.fromEntries(series.filter(s=>s.id?.endsWith(':markers')).map(s=>[s.id,s.itemStyle.color]))))}
export default function RSChart(props:ChartProps&{exportRef?:Ref<ChartExportHandle>}){
 const host=useRef<HTMLDivElement>(null),chart=useRef<echarts.ECharts|null>(null),live=useRef(props),view=useRef<Viewport>(fittedView(props)),manual=useRef(false);live.current=props;
 useImperativeHandle(props.exportRef,()=>({snapshot:()=>{const c=chart.current;if(!c)throw Error('圖表尚未準備好，請稍後再試。');return {viewport:{x:[...view.current.x],y:[...view.current.y]},width:c.getWidth(),height:c.getHeight()}}}),[]);
 useEffect(()=>{if(!host.current)return;const element=host.current,c=echarts.init(element);chart.current=c;const observer=new ResizeObserver(()=>{if(!c.isDisposed())c.resize()});observer.observe(element);
 const zr=c.getZr();let pointerStart:{x:number;y:number;view:Viewport}|null=null,dragged=false;
 const onDown=(event:any)=>{dragged=false;if(event.event?.button>0)return;if(c.containPixel({gridIndex:0},[event.offsetX,event.offsetY]))pointerStart={x:event.offsetX,y:event.offsetY,view:view.current}};
 const onMove=(event:any)=>{if(!pointerStart)return;const dx=event.offsetX-pointerStart.x,dy=event.offsetY-pointerStart.y;if(Math.hypot(dx,dy)>5)dragged=true;if(dragged){manual.current=true;view.current=panViewport(pointerStart.view,dx,dy,Math.max(1,c.getWidth()-chartGrid.left-chartGrid.right),Math.max(1,c.getHeight()-chartGrid.top-chartGrid.bottom));applyViewport(c,view.current,live.current.theme==='dark')}};
 const onUp=()=>{pointerStart=null};
 const onBlankClick=(event:any)=>{if(!event.target&&!dragged){c.dispatchAction({type:'downplay'});c.dispatchAction({type:'hideTip'});live.current.onClearSelection()}};
 const onWheel=(event:WheelEvent)=>{const rect=element.getBoundingClientRect(),pixel:[number,number]=[event.clientX-rect.left,event.clientY-rect.top];if(!c.containPixel({gridIndex:0},pixel))return;event.preventDefault();const anchor=c.convertFromPixel({gridIndex:0},pixel) as Point;const delta=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?c.getHeight():1);manual.current=true;view.current=zoomViewport(view.current,anchor,Math.exp(Math.max(-400,Math.min(400,delta))*.002));applyViewport(c,view.current,live.current.theme==='dark')};
 zr.on('mousedown',onDown);zr.on('mousemove',onMove);zr.on('mouseup',onUp);zr.on('globalout',onUp);zr.on('click',onBlankClick);element.addEventListener('wheel',onWheel,{passive:false});
 // Line events carry seriesIndex but no seriesId; marker events include seriesId.
 const entityFromEvent=(event:any)=>{const id=event.seriesId??(c.getOption().series as {id?:string}[])[event.seriesIndex]?.id;return typeof id==='string'&&id.startsWith('entity:')?decodeURIComponent(id.split(':')[1]):null};
 c.on('click',(event:any)=>{const id=entityFromEvent(event);if(!dragged&&id)live.current.onSelect(id)});
 c.on('mouseover',(event:any)=>{const id=entityFromEvent(event);if(id)live.current.onHover(id)});c.on('globalout',()=>live.current.onHover(null));
 return()=>{element.removeEventListener('wheel',onWheel);zr.off('mousedown',onDown);zr.off('mousemove',onMove);zr.off('mouseup',onUp);zr.off('globalout',onUp);zr.off('click',onBlankClick);observer.disconnect();c.dispose();chart.current=null};},[]);
 useEffect(()=>{const c=chart.current;if(!c)return;if(!manual.current)view.current=fittedView(props);
 // Clear the previous point's hover size and tooltip before dates or paths change.
 c.dispatchAction({type:'downplay'});c.dispatchAction({type:'hideTip'});
 const started=performance.now();let setOptionMs=0;const finished=()=>{c.off('finished',finished);queueMicrotask(()=>live.current.onMeasure?.({set_option_ms:setOptionMs,finished_ms:performance.now()-started}))};if(props.onMeasure)c.on('finished',finished);
 const options=buildChartOptions(props,view.current);c.setOption(options as any,{replaceMerge:['series']});
 elementProof(c,view.current,options.series);setOptionMs=performance.now()-started;
 return()=>{if(!c.isDisposed())c.off('finished',finished)};
 },[props.entities,props.paths,props.pointDates,props.selectedId,props.filter,props.viewingDate,props.theme,props.fitPaths,props.colorQuadrants]);
 useEffect(()=>{const c=chart.current;if(!c)return;manual.current=false;view.current=fittedView(live.current);applyViewport(c,view.current,live.current.theme==='dark')},[props.viewportAction]);
 return <div className="chart-canvas" ref={host} role="img" aria-label="RS 相對強弱四象限圖，支援滑鼠縮放與拖曳，點選空白處取消選取，亦可從清單選取股票或產業"/>;
}


