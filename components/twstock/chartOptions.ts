import type {ChartProps} from './RSChart';
import {safeCurve,curvePath} from './safeCurve';
import {trailPlaybackGeometry} from './trailPlayback';
import {officialSectorName} from './officialSectorNames';
import {fitViewport,Viewport} from './viewport';
import {colors,quadrant,lastPoint,representativePointIndices,Point} from './model';
const html=(value:unknown)=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
export const chartGrid={left:44,right:12,top:8,bottom:34};
export function fittedView(props:ChartProps){const paths=props.fitPaths||props.paths;return fitViewport(props.entities.filter(e=>{const p=lastPoint(paths[e.id]||[]);return p&&(props.filter==='All'||(props.colorQuadrants?.[e.id]||quadrant(p))===props.filter)}).flatMap(e=>paths[e.id]||[]).filter((p):p is Point=>!!p))}
export function quadrantAreas(view:Viewport,dark:boolean){
 const [xmin,xmax]=[Math.min(view.x[0],0),Math.max(view.x[1],0)],[ymin,ymax]=[Math.min(view.y[0],0),Math.max(view.y[1],0)];
 return [[xmin,0,0,ymax,dark?'rgba(118,169,222,.045)':'rgba(73,133,195,.045)'],[0,0,xmax,ymax,dark?'rgba(231,130,139,.045)':'rgba(200,79,89,.045)'],[xmin,ymin,0,0,dark?'rgba(101,183,151,.045)':'rgba(56,147,116,.045)'],[0,ymin,xmax,0,dark?'rgba(215,173,88,.045)':'rgba(189,139,39,.045)']].map(([x1,y1,x2,y2,color])=>[{xAxis:x1,yAxis:y1,itemStyle:{color}},{xAxis:x2,yAxis:y2}]);
}

export function buildChartOptions(props:ChartProps,view:Viewport){
 const series:any[]=[];const dark=props.theme==='dark';const palette:Record<string,string>=dark?{Leading:'#e7828b',Weakening:'#d7ad58',Lagging:'#65b797',Improving:'#76a9de'}:colors;
 series.push({id:'quadrants',type:'line',data:[],silent:true,markArea:{silent:true,label:{show:false},data:quadrantAreas(view,dark)},markLine:{symbol:'none',silent:true,label:{show:false},lineStyle:{color:dark?'#637285':'#a1abb6',width:1,type:'solid'},data:[{xAxis:0},{yAxis:0}]}});
 // Equal-size labels use stable layout order: keep the selected identity first.
 const orderedEntities=[...props.entities].sort((a,b)=>Number(b.id===props.selectedId)-Number(a.id===props.selectedId));
 orderedEntities.forEach(e=>{const points=props.paths[e.id]||[],last=lastPoint(points);if(!last)return;const q=props.colorQuadrants?.[e.id]||quadrant(last);if(props.filter!=='All'&&props.filter!==q)return;const color=palette[q],valid=points.flatMap((p,i)=>p?[i]:[]),lastIndex=valid.at(-1)!,firstIndex=valid[0];const rep=representativePointIndices(points);
 const displayName=officialSectorName(e,props.viewingDate);
 const selected=props.selectedId===e.id,isSector=e.kind==='sector'||!e.kind&&e.id.startsWith('S');
 const tip=(p:any)=>`<b>${html(e.code||e.id)} ${html(displayName)}</b><div style="margin-top:8px">RS Level 相對強弱　${Number(p.value[0]).toFixed(2)}</div><div>RS Momentum 相對動能　${Number(p.value[1]).toFixed(2)}</div><div style="color:#7b8490;margin-top:8px">${html(props.sourceLabel||'Mock / Demo data')} · ${html(p.data.date||props.pointDates[e.id]?.[p.dataIndex]||'')}${p.data.priceDate&&p.data.priceDate!==p.data.date?`<br/>實際取價日 ${html(p.data.priceDate)}`:''}</div>`;

 const geometry=props.fitPaths?trailPlaybackGeometry(props.fitPaths[e.id]||[],points):safeCurve(points),opacity=props.selectedId&&!selected?.55:1;
 series.push({id:`entity:${encodeURIComponent(e.id)}:path`,name:displayName,type:'custom',coordinateSystem:'cartesian2d',clip:true,data:points.map(p=>p||[null,null]),encode:{x:0,y:1},connectNulls:false,showSymbol:false,
 renderItem:(params:any,api:any)=>params.dataIndex===firstIndex?{type:'path',shape:{pathData:curvePath(geometry,(point)=>api.coord(point))},style:{fill:null,stroke:color,lineWidth:selected?3:1.8,opacity,lineJoin:'round',lineCap:'round'},emphasis:{style:{lineWidth:3}}}:undefined,
 lineStyle:{color,width:selected?3:1.8,opacity},emphasis:{focus:'series',lineStyle:{width:3}},tooltip:{show:false},z:selected?6:3});
 const markers=[...rep].map(i=>({value:points[i],date:props.pointDates[e.id]?.[i],priceDate:props.pointPriceDates?.[e.id]?.[i],originalIndex:i,symbolSize:i===lastIndex?11:i===firstIndex?5:4+3*i/lastIndex,itemStyle:i===firstIndex&&i!==lastIndex&&!props.colorQuadrants?{color:dark?'#b4becb':'#c0c7cf',borderColor:color,borderWidth:1.5}:undefined,label:{silent:true,show:i===lastIndex&&(!e.reason||['valid','stale'].includes(e.status)),formatter:isSector?Array.from(displayName).map(char=>'{sector|'+char+'}').join(''):e.code||e.id,position:'right',distance:isSector?12:8,backgroundColor:dark?'rgba(19,28,39,.94)':'rgba(255,255,255,.94)',padding:[2,3],borderRadius:2,color:dark?'#d9e2ee':'#394557',fontSize:12,fontWeight:isSector?400:600,fontFamily:'Microsoft JhengHei, PingFang TC, sans-serif',rich:isSector?{sector:{fontSize:12,fontWeight:400,fontFamily:'Microsoft JhengHei, PingFang TC, sans-serif',padding:[2,0.8,2,0],lineHeight:20}}:undefined}}));
 series.push({id:`entity:${encodeURIComponent(e.id)}:markers`,name:displayName,type:'scatter',data:markers,symbol:'circle',itemStyle:{color,borderColor:dark?'#131c27':'#fff',borderWidth:1.5,opacity:props.selectedId&&!selected?.55:1},emphasis:{focus:'series'},labelLayout:{hideOverlap:true,moveOverlap:'shiftY'},labelLine:{show:true,lineStyle:{color:dark?'#8796aa':'#748194',width:0.7,opacity:0.7}},tooltip:{formatter:tip},z:selected?7:4});

 for(let i=0;i<points.length-1;i++){if(points[i]&&points[i+1]===null){let j=i+1;while(j<points.length&&!points[j])j++;if(j<points.length)series.push({id:`entity:${encodeURIComponent(e.id)}:gap${i}`,type:'line',triggerEvent:'line',data:[points[i],points[j]],showSymbol:false,lineStyle:{color:'#919ba8',type:'dashed',width:1},tooltip:{formatter:'這段期間沒有可顯示的結果，虛線只用來連接前後的位置。'},z:2})}}
 });
 const axes={type:'value',splitNumber:8,axisLine:{show:false},axisTick:{show:false},axisLabel:{color:dark?'#8796aa':'#8a94a3',fontSize:12,showMinLabel:false,showMaxLabel:false,formatter:(value:number)=>Math.abs(value)>=1e6?value.toExponential(1):String(Number(value.toFixed(Math.abs(value)<1?4:2)))},splitLine:{lineStyle:{color:dark?'#263140':'#e8edf1',type:'dashed'}}};

 return {animation:!props.fitPaths&&props.entities.reduce((n,e)=>n+(props.paths[e.id]?.length||0),0)<=5000,animationDuration:350,grid:chartGrid,tooltip:{trigger:'item',confine:true,backgroundColor:dark?'#1d2938':'#fff',borderColor:dark?'#3b4b60':'#e0e5e9',textStyle:{color:dark?'#e0e8f2':'#344156',fontSize:13}},xAxis:{...axes,min:view.x[0],max:view.x[1],name:'RS Level · 相對強弱',nameLocation:'middle',nameGap:23,nameTextStyle:{color:dark?'#91a0b4':'#748194',fontSize:12}},yAxis:{...axes,min:view.y[0],max:view.y[1],name:'RS Momentum · 相對動能',nameLocation:'middle',nameGap:29,nameTextStyle:{color:dark?'#91a0b4':'#748194',fontSize:12}},series};
}
