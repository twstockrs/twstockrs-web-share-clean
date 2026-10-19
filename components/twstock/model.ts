export type Status='valid'|'stale'|'insufficient_history'|'data_unavailable'|'no_result'|'inactive';
export type Point=[number,number];
import type {InputVersion} from '../../shared/dataVersions';
export type DatedPoint={point:Point|null;date:string;priceDate?:string;benchmarkId?:string;gapBefore?:boolean|null;segmentId?:string};
export type Entity={id:string;name:string;market:string;sector:string;status:Status;points:(Point|null)[];code?:string;kind?:'stock'|'etf'|'index'|'sector';searchable?:boolean;message?:string;reason?:string;priceDate?:string;transition?:{from:string;to:string;point_date:string;previous_date:string}|null;industryChanges?:{date:string;from:string;to:string;benchmark_changed:boolean}[];actualTrail?:number;trailComplete?:boolean};
export type RuntimeData={market:string;input:InputVersion;dataset_kind:'test'|'source';Daily:string[];Weekly:string[];catalog:Entity[];sectors:Entity[];market_benchmark:string|null;memberships?:{security_id:string;sector_id:string;valid_from:string;valid_to:string}[];market_periods?:{security_id:string;valid_from:string;valid_to:string}[]};
export const quadrant=(p:Point)=>p[0]>=0?(p[1]>=0?'Leading':'Weakening'):(p[1]>=0?'Improving':'Lagging');
export const colors:Record<string,string>={Leading:'#c84f59',Weakening:'#bd8b27',Lagging:'#389374',Improving:'#4985c3'};
export const translations:Record<string,string>={Leading:'領先',Weakening:'轉弱',Lagging:'落後',Improving:'改善'};
export const statuses:Record<Status,string>={valid:'有效結果',stale:'資料較舊',insufficient_history:'歷史不足',data_unavailable:'資料不可用',no_result:'無結果',inactive:'已停用'};
const paths:Point[][]=[ [[-1.8,2.8],[-1.3,3.1],[-.7,3.4],[0,3.6],[.8,3.8],[1.5,4],[2.3,4.2],[3.1,4.35],[4,4.5],[4.9,4.8]], [[2.7,5.4],[3.5,5.3],[4.2,5],[4.8,4.5],[5.25,3.8],[5.5,3],[5.6,2.3],[5.7,1.5],[5.8,.8],[6,.2]], [[-5.8,-.9],[-5.6,-.1],[-5.3,.7],[-4.8,1.4],[-4.2,2],[-3.7,2.4],[-3.1,2.8],[-2.5,3],[-1.9,3.2],[-1.3,3.45]], [[.8,-4.9],[1.2,-4.65],[1.8,-4.4],[2.5,-4.1],[3.2,-3.7],[3.8,-3.2],[4.3,-2.7],[4.6,-2.2],[4.8,-1.7],[4.9,-1.2]], [[-1.2,-.6],[-1.7,-1],[-2.2,-1.5],[-2.8,-2],[-3.3,-2.5],[-3.8,-2.9],[-4.2,-3.1],[-4.7,-3.3],[-5.1,-3.4],[-5.5,-3.6]], [[-5.7,-5.3],[-5.1,-5.5],[-4.5,-5.6],[-3.9,-5.5],[-3.3,-5.2],[-2.8,-4.8],[-2.3,-4.25],[-1.85,-3.65],[-1.5,-3],[-1.3,-2.3]], [[2.9,-.4],[3.3,-.8],[3.7,-1.3],[3.8,-1.8],[3.6,-2.3],[3.2,-2.7],[2.6,-3],[2,-3.1],[1.4,-3.2],[.8,-3.5]], [[-6,4],[-5.5,4.4],[-5,4.8],[-4.5,5],[-4,5.1],[-3.5,5],[-3,4.8],[-2.5,4.55],[-2,4.3],[-1.5,4.1]] ];
const defs=[['2330','台積電','TWSE','半導體業'],['2454','聯發科','TWSE','半導體業'],['2308','台達電','TWSE','電子零組件業'],['2881','富邦金','TWSE','金融保險業'],['2603','長榮','TWSE','航運業'],['1216','統一','TWSE','食品工業'],['1101','台泥','TWSE','水泥工業'],['5274','信驊','TPEx','半導體業']];
export const catalog:Entity[]=defs.map((d,i)=>({id:d[0],name:d[1],market:d[2],sector:d[3],status:i===7?'stale':'valid',points:paths[i].map((p,j)=>i===4&&(j===4||j===5)?null:p)}));
catalog.push(...(['insufficient_history','data_unavailable','no_result','inactive'] as Status[]).map((status,i)=>({id:`DEMO${i+1}`,name:['新上市示範','缺資料示範','無結果示範','停用示範'][i],market:'TWSE',sector:'半導體業',status,points:[]})));
export const sectors:Entity[]=['半導體業','金融保險業','航運業','食品工業','電腦及週邊設備業','電子零組件業','通信網路業','綠能環保'].map((name,i)=>({id:`S${i+1}`,name,market:'TWSE',sector:name,status:'valid',points:paths[i]}));
export const anonymousIds=['2330','2881','2603','1216','1101'];
export const defaultIds=defs.filter(x=>x[2]==='TWSE').map(x=>x[0]);
export const capacity={Anonymous:5,Free:20,Pro:100};
export type Plan=keyof typeof capacity;
export const initialState={mode:'Stock Move',market:'TWSE',benchmarkType:'market',benchmark:'TAIEX',frequency:'Daily',period:'60D',trail:20,priceType:'Adjusted',viewingDate:9,currentList:defaultIds,selectedEntity:null as string|null,filter:'All',plan:'Free' as Plan,hoveredId:null as string|null,statusOverrides:{} as Record<string,Status>,runtime:undefined as RuntimeData|undefined};
export const dates=[11,14,15,16,17,18,21,22,23,24].map(day=>`2026-09-${day}`);
export type AnalysisState=typeof initialState;
export const capabilities={
 Anonymous:{watchlists:0,savedViews:0,png:false,csv:false,raw:false,playback:false},
 Free:{watchlists:1,savedViews:1,png:true,csv:false,raw:true,playback:false},
 Pro:{watchlists:4,savedViews:2,png:true,csv:true,raw:true,playback:true}
} as const;
export const weeklyDates=dates.filter(date=>new Date(date+'T12:00:00Z').getUTCDay()===5);
export const analysisDates=(frequency:string,runtime?:RuntimeData)=>runtime?(frequency==='Weekly'?runtime.Weekly:runtime.Daily):frequency==='Weekly'?weeklyDates:dates;
export const stateDates=(state:AnalysisState)=>analysisDates(state.frequency,state.runtime);
export const stateCatalog=(state:AnalysisState)=>state.runtime?.catalog||catalog;
export function sectorsForMarket(market:string,runtime?:RuntimeData):Entity[]{
 if(runtime?.market===market)return runtime.sectors;
 return market==='TWSE'?sectors:[{...sectors[0],id:'ST1',market:'TPEx'}];
}
export function entityStatus(e:Entity,state:AnalysisState):Status {
 if(state.mode==='Stock Move'&&state.benchmarkType==='security'&&e.id===state.benchmark)return 'no_result';
 return state.statusOverrides[e.id]||e.status;
}
export function visibleSamples(e:Entity,state:typeof initialState):DatedPoint[]{
 const status=entityStatus(e,state);
 if(e.market!==state.market)return [];
 if(!['valid','stale'].includes(status))return [];
 const viewingDate=analysisDates(state.frequency)[state.viewingDate];
 if(!viewingDate)return [];
 const indices=dates.flatMap((date,index)=>date<=viewingDate&&(state.frequency!=='Weekly'||weeklyDates.includes(date))&&(status!=='stale'||index<8)?[index]:[]);
 let start=indices.length,valid=0;while(start>0&&valid<state.trail){start--;if(e.points[indices[start]])valid++}
 const scale=parseInt(state.period,10)===20?.8:parseInt(state.period,10)===120?1.15:1;
 return indices.slice(start).map(i=>{const p=e.points[i];return {date:dates[i],point:p?[p[0]*scale+(state.priceType==='Raw'?.24:0),p[1]*scale*(state.frequency==='Weekly'?.8:1)]:null}});
}
export const visiblePoints=(e:Entity,state:typeof initialState)=>(visibleSamples(e,state).map(sample=>sample.point));
export function representativePointIndices(points:(Point|null)[]):Set<number>{
 const valid=points.flatMap((point,index)=>point?[index]:[]);
 return new Set(valid.length?[valid[0],...valid.slice(-4)]:[]);
}
export const lastPoint=(points:(Point|null)[])=>points.filter((p):p is Point=>p!==null).at(-1);

export const benchmarkTypes=[{value:'market',label:'市場基準'},{value:'sector',label:'產業基準'},{value:'security',label:'股票／ETF'}];
export function benchmarkOptions(type:string,market:string,runtime?:RuntimeData){
 if(type==='market')return [{value:'TAIEX',label:'加權指數'},{value:'TPEX',label:'櫃買指數'}];
 if(type==='sector')return sectorsForMarket(market,runtime).map(e=>({value:e.id,label:e.name}));
 if(runtime?.market===market)return runtime.catalog.filter(e=>e.searchable!==false).map(e=>({value:e.id,label:(e.code||e.id)+' '+e.name}));
 return [...catalog.filter(e=>e.market===market&&!e.id.startsWith('DEMO')).map(e=>({value:e.id,label:e.id+' '+e.name})),...(market==='TWSE'?[{value:'0050',label:'0050 元大台灣50'},{value:'006208',label:'006208 富邦台50'}]:[])];
}
export function defaultBenchmark(type:string,market:string,runtime?:RuntimeData){return type==='market'?(market==='TWSE'?'TAIEX':'TPEX'):benchmarkOptions(type,market,runtime)[0]?.value||''}
export function benchmarkLabel(type:string,market:string,value:string,runtime?:RuntimeData){return benchmarkOptions(type,market,runtime).find(o=>o.value===value)?.label||value}

// Product Spec v1.0 FROZEN, sections 10 and 36.
export function normalizeAnalysis<T extends {plan:Plan;frequency:string;period:string;trail:number}>(state:T):T {
 const frequency=state.plan==='Pro'&&state.frequency==='Weekly'?'Weekly':'Daily';
 const max=frequency==='Weekly'?52:240;
 const requested=parseInt(state.period,10);
 let period=Number.isFinite(requested)?Math.max(5,Math.min(max,requested)):60;
 let trail=Number.isFinite(state.trail)?Math.max(5,Math.trunc(state.trail)):20;
 if(state.plan==='Anonymous'){period=20;trail=5}
 else if(state.plan==='Free'){period=[20,60,120].includes(period)?period:60;trail=[5,10,20].includes(trail)?trail:20}
 trail=Math.min(trail,period,max);
 return {...state,frequency,period:String(period)+(frequency==='Weekly'?'W':'D'),trail};
}
export function periodChoices(plan:Plan,frequency:string){return plan==='Pro'?Array.from({length:(frequency==='Weekly'?52:240)-4},(_,i)=>i+5):[20,60,120]}
export function trailChoices(plan:Plan,period:string){return plan==='Pro'?Array.from({length:Math.max(1,parseInt(period,10)-4)},(_,i)=>i+5):[5,10,20]}

// Validate loaded settings without silently changing a saved view or a downgraded session.
export function analysisIssues(state:AnalysisState,entities:readonly Entity[]=stateCatalog(state)):string[]{
 const issues:string[]=[],normalized=normalizeAnalysis(state);
 if(!['TWSE','TPEx'].includes(state.market))issues.push('市場不適用');
 if(!['Stock Move','Sector Move'].includes(state.mode))issues.push('分析模式不適用');
 if(!['Raw','Adjusted'].includes(state.priceType))issues.push('價格口徑不適用');
 if(!benchmarkTypes.some(type=>type.value===state.benchmarkType))issues.push('基準類型不適用');
 if(state.frequency!==normalized.frequency)issues.push('目前方案不支援週頻');
 if(state.period!==normalized.period)issues.push('期間超出目前方案可用範圍');
 if(state.trail!==normalized.trail)issues.push('軌跡超出可用範圍或大於期間');
 if(state.priceType==='Raw'&&!capabilities[state.plan].raw)issues.push('匿名方案僅支援還原價格');
 if(state.mode==='Stock Move'&&state.currentList.length>capacity[state.plan])issues.push(`目前清單超過 ${capacity[state.plan]} 檔，請自行移除多餘標的`);
 if((state.plan!=='Pro'||state.mode==='Sector Move')&&state.benchmarkType!=='market')issues.push('此方案或產業模式僅支援市場基準');
 if(state.benchmarkType==='market'&&state.benchmark!==defaultBenchmark('market',state.market))issues.push('市場基準須與所選市場一致');
 if(!benchmarkOptions(state.benchmarkType,state.market,state.runtime).some(option=>option.value===state.benchmark))issues.push('比較對象不適用於所選市場');
 if(!stateDates(state)[state.viewingDate])issues.push('檢視日期不在可用端點內');
 if(state.currentList.some(id=>entities.find(e=>e.id===id)?.market!==state.market))issues.push('目前清單含不屬於所選市場的標的');
 return issues;
}
export function analysisDefaults(plan:Plan,market='TWSE'):AnalysisState {
 return normalizeAnalysis({...initialState,plan,market,benchmark:defaultBenchmark('market',market),currentList:market==='TWSE'?(plan==='Anonymous'?[...anonymousIds]:[...defaultIds]):catalog.filter(e=>e.market===market).map(e=>e.id)});
}
export function updateAnalysis(state:AnalysisState,key:keyof AnalysisState,value:any):AnalysisState {
 if(key==='market'&&!['TWSE','TPEx'].includes(value))return state;
 if(key==='mode'&&!['Stock Move','Sector Move'].includes(value))return state;
 if(key==='priceType'&&!['Raw','Adjusted'].includes(value))return state;
 if(key==='benchmarkType'&&!benchmarkTypes.some(type=>type.value===value))return state;
 if(key==='priceType'&&value==='Raw'&&!capabilities[state.plan].raw)return state;
 if(key==='benchmarkType'&&(state.plan!=='Pro'||state.mode==='Sector Move')&&value!=='market')return state;
 if(key==='benchmark'&&!benchmarkOptions(state.benchmarkType,state.market,state.runtime).some(o=>o.value===value))return state;
 if(key==='benchmark'&&state.benchmarkType==='market'&&value!==defaultBenchmark('market',state.market))return state;
 if(key==='market'){const available=analysisDates(state.frequency),current=stateDates(state)[state.viewingDate],mapped=available.indexOf(current);return {...state,market:value,currentList:[],selectedEntity:null,hoveredId:null,runtime:undefined,viewingDate:mapped>=0?mapped:available.length-1,benchmark:defaultBenchmark(state.benchmarkType,value)}};
 if(key==='mode')return {...state,mode:value,selectedEntity:null,hoveredId:null,...(value==='Sector Move'?{benchmarkType:'market',benchmark:defaultBenchmark('market',state.market)}:{})};
 if(key==='benchmarkType')return {...state,benchmarkType:value,benchmark:defaultBenchmark(value,state.market,state.runtime)};
 if(key==='frequency'){
  if(!['Daily','Weekly'].includes(value))return state;
  if(value==='Weekly'&&state.plan!=='Pro')return state;
  const sourceDate=stateDates(state)[state.viewingDate];
  const available=analysisDates(value,state.runtime),index=available.reduce((last,date,i)=>date<=sourceDate?i:last,-1);
  if(index<0)return state;
  return normalizeAnalysis({...state,frequency:value,viewingDate:index});
 }
 if(key==='period'||key==='trail')return normalizeAnalysis({...state,[key]:value});
 if(key==='viewingDate'&&(!Number.isInteger(value)||!stateDates(state)[value]))return state;
 return {...state,[key]:value};
}
export function classifyStockInput(ids:string[],state:AnalysisState,stableIds=false){
 const accepted:string[]=[],rejected:string[]=[],seen=new Set<string>(),available=stateCatalog(state);
 for(const id of ids){
  const entity=available.find(e=>state.runtime?stableIds?e.id===id:(e.code||e.id)===id&&e.searchable!==false:e.id===id);
  const label=entity?[(entity.code||(!state.runtime?entity.id:'')),entity.name].filter(Boolean).join(' '):stableIds&&state.runtime?'所選標的':id;
  if(!entity){rejected.push(label+' 無可用證券資料');continue}
  if(seen.has(entity.id)||state.currentList.includes(entity.id)){rejected.push(label+' 已在清單內或輸入重複');continue}
  seen.add(entity.id);
  if(entity.market!==state.market){rejected.push(label+' 不屬於 '+state.market);continue}
  if(state.currentList.length+accepted.length>=capacity[state.plan]){rejected.push(label+' 已達容量上限，未加入');continue}
  accepted.push(entity.id);
 }
 return {accepted,rejected};
}
export const demoWatchlists=[
 {name:'台股觀察清單',market:'TWSE',ids:defaultIds},
 {name:'清單 2 · 跨產業示範',market:'TWSE',ids:['2454','2881','2603','1216','1101']},
 {name:'空白清單 3',market:'TWSE',ids:[] as string[]},
 {name:'空白清單 4',market:'TWSE',ids:[] as string[]}
];
export function demoSavedView(index:number):AnalysisState{
 const base=analysisDefaults('Pro');
 return index===0?base:{...base,mode:'Sector Move',frequency:'Weekly',period:'52W',trail:10,priceType:'Raw',viewingDate:weeklyDates.length-1};
}
export function slotAccessible(plan:Plan,index:number,kind:'watchlist'|'saved',retained:number|null){
 const count=kind==='watchlist'?capabilities[plan].watchlists:capabilities[plan].savedViews;
 return Number.isInteger(index)&&index>=0&&(plan==='Pro'?index<count:plan==='Free'&&index===retained);
}
