import {AnalysisState,Entity,stateDates,analysisIssues,benchmarkLabel,capabilities,catalog,entityStatus,quadrant,sectorsForMarket,visibleSamples} from './model';
import {officialSectorName} from './officialSectorNames';
import type {AnalysisData} from '../../shared/mockAnalysis';

export type ExportFormat='PNG'|'CSV';
export type ExportContext={state:AnalysisState;entities:Entity[];viewingDate:string;filenameBase:string;data?:AnalysisData;hiddenIds?:readonly string[]};
export const csvColumns=['viewing_date','frequency','market','entity','benchmark','period','trail','price_type','point_date','price_date','rs_level','rs_momentum','quadrant','status','gap_before'] as const;
type CsvValue=string|number|boolean;
export function createExportContext(state:AnalysisState,format:ExportFormat,data?:AnalysisData):ExportContext{
 if(!(format==='PNG'?capabilities[state.plan].png:capabilities[state.plan].csv))throw Error(`${format} 不適用於目前方案。`);
 const issues=analysisIssues(state);if(issues.length)throw Error('目前設定無法匯出：'+issues.join('；'));
 const entities=data?.source==='computed'?data.entities:state.mode==='Stock Move'?state.currentList.map(id=>catalog.find(entity=>entity.id===id)!):sectorsForMarket(state.market);
 if(data?.source==='computed'&&state.mode==='Stock Move'&&(data.entities.length!==state.currentList.length||data.entities.some((e,i)=>e.id!==state.currentList[i])))throw Error('分析集合已變更，請重新取得資料。');
 if(!entities.length)throw Error('目前沒有分析標的，無法匯出。');
 const viewingDate=stateDates(state)[state.viewingDate];
 if(data?.version&&data.version.input.market!==state.market)throw Error('分析與匯出市場版本不同。');
 const delivered=data?entities.map(entity=>{const found=data.entities.find(e=>e.id===entity.id);if(!found||!data.samples[entity.id])throw Error('分析結果與目前清單不一致，請重新取得資料。');return found}):entities;
 const suffix=data?.version?`-${data.version.result_release_id}-${data.version.input.release_id||'input-none'}-r${data.version.input.revision}`:'';
 return {state:{...state,currentList:[...state.currentList],statusOverrides:{...state.statusOverrides}},entities:delivered,viewingDate,filenameBase:`TWStockRS-${data?.source==='computed'?(data.version?.dataset_kind==='test'?'TEST':'INPUT'):'DEMO'}-${state.mode==='Stock Move'?'Stock':'Sector'}-${state.market}-${state.frequency}-${viewingDate}${suffix}`,...(data?{data}:{})};
}
export function exportSignature(state:AnalysisState,format:ExportFormat,theme:string,hiddenIds:readonly string[]=[]){
 return JSON.stringify([state.plan,state.mode,state.market,state.benchmarkType,state.benchmark,state.frequency,state.period,state.trail,state.priceType,state.viewingDate,state.currentList,state.statusOverrides,...(format==='PNG'?[state.filter,state.selectedEntity,theme,hiddenIds]:[])]);
}
export function csvCell(value:CsvValue):string{
 if(typeof value==='number'){if(!Number.isFinite(value))throw Error('匯出座標包含非有限數值。');return String(Number(value.toFixed(6)))}
 let text=String(value);
 // Spreadsheet apps must treat user-readable names as text rather than executable formulas.
 if(/^[\x00-\x20]*[=+\-@]/.test(text))text="'"+text;
 return /[",\r\n]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;
}
function exportBenchmark(state:AnalysisState,id?:string,date=stateDates(state)[state.viewingDate]){
 if(id){
  if(id===state.runtime?.market_benchmark||id===(state.market==='TWSE'?'TAIEX':'TPEX'))return benchmarkLabel('market',state.market,state.market==='TWSE'?'TAIEX':'TPEX',state.runtime);
  const sector=state.runtime?.sectors.find(entity=>entity.id===id);
  if(sector)return officialSectorName(sector,date);
  const security=state.runtime?.catalog.find(entity=>entity.id===id);
  if(security)return (security.code||security.id)+security.name;
  return id;
 }
 const sector=state.benchmarkType==='sector'&&state.runtime?.sectors.find(entity=>entity.id===state.benchmark);
 return sector?officialSectorName(sector,date):benchmarkLabel(state.benchmarkType,state.market,state.benchmark,state.runtime).replace(/^(\d{4,6})\s+/,'$1');
}
export function buildCsvExport(state:AnalysisState,data?:AnalysisData):{filename:string;text:string;rows:CsvValue[][]}{
 const context=createExportContext(state,'CSV',data),rows:CsvValue[][]=[];
 if(data){context.entities=context.entities.map(entity=>{const delivered=data.entities.find(item=>item.id===entity.id);if(!delivered)throw Error('分析結果與目前清單不一致，請重新取得資料。');return delivered})}
 for(const entity of context.entities){
  const status=entityStatus(data?.entities.find(item=>item.id===entity.id)||entity,context.state),samples=data?data.samples[entity.id]:visibleSamples(entity,context.state);
  if(!samples)throw Error('分析結果與目前清單不一致，請重新取得資料。');
  const base:CsvValue[]=[context.viewingDate,state.frequency,state.market,state.mode==='Stock Move'?(entity.code||entity.id)+entity.name:entity.name,exportBenchmark(state),state.period,state.trail,state.priceType];
  const validIndices=samples.flatMap((sample,index)=>sample.point?[index]:[]),last=validIndices.at(-1);
  let previous=-1;
  for(const index of validIndices){
   const sample=samples[index],point=sample.point!;
   const gap=previous<0?'':sample.gapBefore??samples.slice(previous+1,index).some(item=>item.point===null);
   const pointStatus=status==='stale'&&index===last&&sample.date<context.viewingDate?'stale':'valid';
   // The mock source has no actual common price date: keep price_date empty, never invent it.
   const pointBase=[...base];if(data?.source==='computed'&&sample.benchmarkId)pointBase[4]=exportBenchmark(state,sample.benchmarkId,sample.date);
   rows.push([...pointBase,sample.date,sample.priceDate||'',point[0],point[1],quadrant(point),pointStatus,gap]);previous=index;
  }
  if(last===undefined){
   rows.push([...base,'','','','','',['valid','stale'].includes(status)?'no_result':status,'']);
  }else if(samples.at(-1)?.date===context.viewingDate&&samples.at(-1)?.point===null){
   rows.push([...base,'','','','','',['valid','stale'].includes(status)?'data_unavailable':status,'']);
  }
 }
 const text='\uFEFF'+[csvColumns.join(','),...rows.map(row=>row.map(csvCell).join(','))].join('\r\n')+'\r\n';
 return {filename:context.filenameBase+'.csv',text,rows};
}
