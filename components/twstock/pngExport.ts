import {echarts} from './chartRuntime';
import {SVGRenderer} from 'echarts/renderers';
echarts.use([SVGRenderer]);
import {artwork} from './Brand';
import {ExportContext} from './exportData';
import {colors,quadrant,lastPoint,translations,visibleSamples,benchmarkLabel} from './model';
import {buildChartOptions,chartGrid} from './chartOptions';
import {Viewport} from './viewport';
export type ChartSnapshot={viewport:Viewport;width:number;height:number};
const xml=(value:unknown)=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
export function buildPngSvg(context:ExportContext,theme:'light'|'dark',snapshot:ChartSnapshot):{svg:string;width:number;height:number}{
 if(!Number.isFinite(snapshot.width)||!Number.isFinite(snapshot.height)||snapshot.width<=0||snapshot.height<=0||[snapshot.viewport.x,snapshot.viewport.y].some(axis=>axis.some(value=>!Number.isFinite(value))||axis[0]>=axis[1]))throw Error('圖表視野尚未準備好，請重置圖表後再試。');
 const {state}=context,entities=context.entities.filter(entity=>!context.hiddenIds?.includes(entity.id)),dark=theme==='dark';
 const width=Math.max(900,Math.min(2400,Math.round(snapshot.width))),plotHeight=Math.max(500,Math.min(1400,Math.round(snapshot.height))),header=116,footer=context.data?.source==='computed'?96:76,height=header+plotHeight+footer;
 const background=dark?'#131c27':'#ffffff',foreground=dark?'#d9e2ee':'#394557',secondary=dark?'#a7b7cd':'#52657e',demo=dark?'#dfc18b':'#806019';
 const palette:Record<string,string>=dark?{Leading:'#e7828b',Weakening:'#d7ad58',Lagging:'#65b797',Improving:'#76a9de'}:colors;
 const samples=Object.fromEntries(entities.map(entity=>[entity.id,context.data?context.data.samples[entity.id]:visibleSamples(entity,state)]));
 const paths=Object.fromEntries(Object.entries(samples).map(([id,points])=>[id,points.map(sample=>sample.point)]));
 const pointDates=Object.fromEntries(Object.entries(samples).map(([id,points])=>[id,points.map(sample=>sample.date)]));
 const pointPriceDates=Object.fromEntries(Object.entries(samples).map(([id,points])=>[id,points.map(sample=>sample.priceDate||'')]));
 const sourceLabel=context.data?.source==='computed'?(context.data.version?.dataset_kind==='test'?'TEST · 合成價格運算':'INPUT · 匯入價格運算'):undefined;
 const props={theme,entities,paths,pointDates,pointPriceDates,sourceLabel,selectedId:state.selectedEntity,hoveredId:null,filter:state.filter,viewingDate:context.viewingDate,onSelect:()=>{},onClearSelection:()=>{},onHover:()=>{},viewportAction:{type:'export',key:0}};
 const chart=echarts.init(null,undefined,{renderer:'svg',ssr:true,width,height:plotHeight});
 let chartSvg:string;
 try{chart.setOption({...buildChartOptions(props,snapshot.viewport),animation:false,tooltip:{show:false}} as any);chartSvg=chart.renderToSVGString()}finally{chart.dispose()}
 const label=(q:string,x:number,y:number,align='start')=>`<text x="${x}" y="${y}" fill="${palette[q]}" font-size="14" font-weight="600" text-anchor="${align}">${q.toUpperCase()}　${translations[q]}</text>`;
 const visible=entities.filter(entity=>{const point=lastPoint(paths[entity.id]);return point&&(state.filter==='All'||quadrant(point)===state.filter)}).length;
 const legend=Object.keys(palette).map((q,index)=>{const x=28+index*(width-56)/4;return `<circle cx="${x}" cy="${header+plotHeight+22}" r="4" fill="${palette[q]}"/><text x="${x+12}" y="${header+plotHeight+27}" fill="${foreground}" font-size="13">${q}　${translations[q]}</text>`}).join('');
 const metadata=[`${state.mode} · ${state.market} · ${entities.length} 個標的 · ${state.frequency} · ${state.period} · Trail ${state.trail} · ${state.priceType}`,`檢視日期 ${context.viewingDate}　｜　基準 ${benchmarkLabel(state.benchmarkType,state.market,state.benchmark,state.runtime)}`,`篩選 ${state.filter==='All'?'全部象限':state.filter+' '+translations[state.filter]}　｜　${visible} 條可顯示路徑　｜　保留匯出時的座標範圍`];
 const version=context.data?.version;
 const computed=context.data?.source==='computed',dataLabel=computed?(version?.dataset_kind==='test'?'TEST · 合成價格運算':'INPUT · 匯入價格運算'):'DEMO · 示範資料';
 const computedVersion=version&&computed?`<text x="24" y="${height-56}" fill="${secondary}" font-size="11">${xml(`結果 ${version.result_release_id}`)}</text><text x="24" y="${height-36}" fill="${secondary}" font-size="11">${xml(`輸入 ${version.input.release_id} · 修訂 ${version.input.revision} · rs_v1`)}</text>`:'';
 const versionText=version&&!computed?`<text x="24" y="${height-36}" fill="${secondary}" font-size="11">${xml(`示範結果 ${version.result_release_id} · 輸入 ${version.input.release_id||'尚未啟用'} · 修訂 ${version.input.revision}`)}</text>`:'';
 const text=metadata.map((line,index)=>`<text x="24" y="${55+index*22}" fill="${secondary}" font-size="14">${xml(line)}</text>`).join('')+versionText+computedVersion;
 const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><title>TWStockRS 相對強弱輪動圖</title><rect width="100%" height="100%" fill="${background}"/><g font-family="Microsoft JhengHei, PingFang TC, sans-serif"><image href="${dark?artwork.logoDark:artwork.logoLight}" x="24" y="5" width="134" height="34"/><text x="180" y="31" fill="${foreground}" font-size="20" font-weight="600">RS Rotation</text><text x="${width-24}" y="28" fill="${demo}" text-anchor="end" font-size="15" font-weight="600">${xml(dataLabel)}</text>${text}<g transform="translate(0 ${header})">${chartSvg}</g>${label('Improving',chartGrid.left+16,header+chartGrid.top+22)}${label('Leading',width-chartGrid.right-16,header+chartGrid.top+22,'end')}${label('Lagging',chartGrid.left+16,header+plotHeight-chartGrid.bottom-16)}${label('Weakening',width-chartGrid.right-16,header+plotHeight-chartGrid.bottom-16,'end')}<text x="${width/2}" y="${header+plotHeight/2}" fill="${secondary}" text-anchor="middle" font-size="36" opacity="0.18">${xml(dataLabel)}</text>${!visible?`<text x="${width/2}" y="${header+plotHeight/2+40}" fill="${foreground}" text-anchor="middle" font-size="18">目前沒有可顯示的路徑</text>`:''}${legend}<text x="24" y="${height-16}" fill="${demo}" font-size="14" font-weight="600">${xml(computed?(version?.dataset_kind==='test'?'TEST · 依合成價格實際運算，不代表真實台股行情':'INPUT · 依匯入價格運算，來源品質尚待核對'):'DEMO · 示範資料，非真實行情與計算結果')}</text><text x="${width-24}" y="${height-16}" fill="${secondary}" text-anchor="end" font-size="12">虛線 = 資料缺口</text></g></svg>`;
 return {svg,width,height};
}
export async function svgToPng(svg:string,width:number,height:number):Promise<Blob>{
 const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml;charset=utf-8'}));
 try{
  const image=new Image();
  await new Promise<void>((resolve,reject)=>{image.onload=()=>resolve();image.onerror=()=>reject(Error('圖片轉換失敗，請再試一次。'));image.src=url});
  const canvas=document.createElement('canvas');canvas.width=width*2;canvas.height=height*2;
  const context=canvas.getContext('2d');if(!context)throw Error('此瀏覽器無法建立圖片。');
  context.drawImage(image,0,0,canvas.width,canvas.height);
  return await new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('無法產生 PNG 圖片。')),'image/png'));
 }finally{URL.revokeObjectURL(url)}
}
export function downloadBlob(blob:Blob,filename:string){
 const url=URL.createObjectURL(blob),anchor=document.createElement('a');
 try{anchor.href=url;anchor.download=filename;anchor.hidden=true;document.body.append(anchor);anchor.click()}
 finally{anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),2000)}
}
