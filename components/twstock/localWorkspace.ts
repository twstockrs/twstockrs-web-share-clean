import {analysisDefaults,analysisDates,stateDates,analysisIssues,AnalysisState,normalizeAnalysis,Plan,updateAnalysis,benchmarkOptions,type RuntimeData} from './model';
import {storageKeys} from './storageKeys';
import {createAtomicStorage} from './atomicStorage';
import {parseListPreferences,readListPreferences,type ListPreferences} from './listPreferences';
import {parseSidebarPreferences,readSidebarPreferences,type SidebarPreferences} from './sidebarPreferences';

export interface LocalStorageLike {getItem:(key:string)=>string|null;setItem:(key:string,value:string)=>void;setMany?:(updates:Record<string,string|null>)=>void}
export type Frequency='Daily'|'Weekly';
export type FrequencyPreference={period:string;trail:number};
export type FrequencyPreferences=Partial<Record<Plan,Partial<Record<Frequency,FrequencyPreference>>>>;
export type RetainedSlots={watchlist:number|null;saved:number|null};
export const localKeys=storageKeys;
const plans:Plan[]=['Anonymous','Free','Pro'];
const persistentKeys=['mode','market','benchmarkType','benchmark','frequency','period','trail','priceType','currentList'] as const;
const filters=['All','Leading','Weakening','Lagging','Improving'];

export function browserStorage(owner?:string):LocalStorageLike|null {
 try{return typeof window==='undefined'?null:createAtomicStorage(owner?{getItem:key=>window.localStorage.getItem(`twstockrs:${owner}:${key}`),setItem:(key,value)=>window.localStorage.setItem(`twstockrs:${owner}:${key}`,value)}:window.localStorage)}catch{return null}
}
function read(storage:LocalStorageLike|null,key:string):unknown {
 const raw=storage?.getItem(key);return raw?JSON.parse(raw):null;
}
function record(value:unknown):value is Record<string,unknown>{return typeof value==='object'&&value!==null&&!Array.isArray(value)}
function write(storage:LocalStorageLike|null,key:string,value:unknown):boolean{
 if(!storage)return false;
 try{storage.setItem(key,JSON.stringify(value));return true}catch{return false}
}
function legalPreference(plan:Plan,frequency:Frequency,value:unknown):value is FrequencyPreference{
 if(!record(value)||typeof value.period!=='string'||typeof value.trail!=='number'||!Number.isInteger(value.trail))return false;
 const candidate={...analysisDefaults(plan),frequency,period:value.period,trail:value.trail};
 const normalized=normalizeAnalysis(candidate);
 return normalized.frequency===frequency&&normalized.period===candidate.period&&normalized.trail===candidate.trail;
}
export function readFrequencyPreferences(storage:LocalStorageLike|null):FrequencyPreferences{
 const preferences:FrequencyPreferences={};
 try{
  const raw=read(storage,localKeys.frequency);if(!record(raw))return preferences;
  for(const plan of plans){const item=raw[plan];if(!record(item))continue;for(const frequency of ['Daily','Weekly'] as Frequency[]){const value=item[frequency];if(legalPreference(plan,frequency,value))preferences[plan]={...preferences[plan],[frequency]:{period:value.period,trail:value.trail}}}}
 }catch{}
 return preferences;
}
export function rememberFrequency(preferences:FrequencyPreferences,state:AnalysisState):FrequencyPreferences{
 if(!['Daily','Weekly'].includes(state.frequency)||!legalPreference(state.plan,state.frequency as Frequency,state))return preferences;
 const previous=preferences[state.plan]?.[state.frequency as Frequency];
 if(previous?.period===state.period&&previous.trail===state.trail)return preferences;
 return {...preferences,[state.plan]:{...preferences[state.plan],[state.frequency]:{period:state.period,trail:state.trail}}};
}
export function switchFrequency(state:AnalysisState,frequency:Frequency,preferences:FrequencyPreferences):AnalysisState{
 if(frequency===state.frequency)return state;
 const mapped=updateAnalysis(state,'frequency',frequency);if(mapped===state)return state;
 const stored=preferences[state.plan]?.[frequency];
 const defaults=normalizeAnalysis({...analysisDefaults(state.plan),frequency});
 const preference=legalPreference(state.plan,frequency,stored)?stored:{period:defaults.period,trail:defaults.trail};
 return {...mapped,period:preference.period,trail:preference.trail};
}
export const saveFrequencyPreferences=(storage:LocalStorageLike|null,preferences:FrequencyPreferences)=>write(storage,localKeys.frequency,preferences);

export function workspaceSnapshot(state:AnalysisState):string|null {
 if(analysisIssues(state).length)return null;
 const analysis=Object.fromEntries(persistentKeys.map(key=>[key,state[key]]));
 return JSON.stringify({version:1,analysis});
}
export function restoreWorkspace(raw:string|null,plan:Plan,runtime?:RuntimeData):{state:AnalysisState|null;notice:string}{
 if(raw===null)return {state:null,notice:''};
 try{
  const data:unknown=JSON.parse(raw);
  if(!record(data)||data.version!==1||!record(data.analysis))throw Error('格式或版本不符');
  const source=data.analysis;
  if(persistentKeys.some(key=>!Object.prototype.hasOwnProperty.call(source,key)))throw Error('缺少必要設定');
  const {currentList,trail}=source;
  if(!Array.isArray(currentList)||currentList.some(id=>typeof id!=='string')||new Set(currentList).size!==currentList.length||currentList.length>100)throw Error('股票集合格式不符');
  if(typeof trail!=='number'||!Number.isInteger(trail))throw Error('軌跡格式不符');
  if(persistentKeys.filter(key=>!['currentList','trail'].includes(key)).some(key=>typeof source[key]!=='string'))throw Error('分析條件格式不符');
  const candidate={...analysisDefaults(plan),...Object.fromEntries(persistentKeys.map(key=>[key,source[key]])),plan,selectedEntity:null,hoveredId:null,statusOverrides:{}} as AnalysisState;
  candidate.runtime=runtime?.market===candidate.market?runtime:undefined;
  candidate.viewingDate=stateDates(candidate).length-1;
  const errors=analysisIssues(candidate);if(errors.length)throw Error(errors.join('；'));
  return {state:candidate,notice:''};
 }catch(error){return {state:null,notice:'上次本機設定未載入：'+(error instanceof Error?error.message:'設定無法讀取')+'。已顯示目前方案預設，原設定仍保留。'}}
}
export function readWorkspace(storage:LocalStorageLike|null,plan:Plan,runtime?:RuntimeData){
 try{return restoreWorkspace(storage?.getItem(localKeys.workspace)??null,plan,runtime)}catch{return {state:null,notice:'此瀏覽器無法讀取本機設定，仍可使用原型。'}}
}
export function readWorkspaceMarket(storage:LocalStorageLike|null):'TWSE'|'TPEx'|undefined{
 try{const raw=read(storage,localKeys.workspace);return record(raw)&&raw.version===1&&record(raw.analysis)&&(raw.analysis.market==='TWSE'||raw.analysis.market==='TPEx')?raw.analysis.market:undefined}catch{return undefined}
}
export function saveWorkspaceSnapshot(storage:LocalStorageLike|null,snapshot:string):boolean{
 if(!storage)return false;
 try{storage.setItem(localKeys.workspace,snapshot);return true}catch{return false}
}
export function readUiPreferences(storage:LocalStorageLike|null):{theme:'light'|'dark';filter:string}{
 try{const raw=read(storage,localKeys.ui);if(record(raw))return {theme:raw.theme==='light'?'light':'dark',filter:typeof raw.filter==='string'&&filters.includes(raw.filter)?raw.filter:'All'}}catch{}
 return {theme:'dark',filter:'All'};
}
export const saveUiPreferences=(storage:LocalStorageLike|null,theme:'light'|'dark',filter:string,list?:ListPreferences,sidebar?:SidebarPreferences)=>write(storage,localKeys.ui,{theme,filter:filters.includes(filter)?filter:'All',list:list?parseListPreferences(list):readListPreferences(storage),sidebar:sidebar?parseSidebarPreferences(sidebar):readSidebarPreferences(storage)});
export function readRetainedSlots(storage:LocalStorageLike|null):RetainedSlots{
 try{
  const raw=read(storage,localKeys.retained);if(record(raw)){
   const valid=(value:unknown,max:number)=>value===null||typeof value==='number'&&Number.isInteger(value)&&value>=0&&value<max;
   return {watchlist:valid(raw.watchlist,4)?raw.watchlist as number|null:null,saved:valid(raw.saved,2)?raw.saved as number|null:null};
  }
 }catch{return {watchlist:null,saved:null}}
 return {watchlist:0,saved:0};
}
export const saveRetainedSlots=(storage:LocalStorageLike|null,retained:RetainedSlots)=>write(storage,localKeys.retained,retained);
export function readRecentBenchmarks(storage:LocalStorageLike|null,runtime?:RuntimeData):string[]{
 try{const raw=read(storage,localKeys.benchmarks),known=new Set([...['TWSE','TPEx'].flatMap(market=>benchmarkOptions('security',market).map(option=>option.value)),...(runtime?benchmarkOptions('security',runtime.market,runtime).map(o=>o.value):[])]);return Array.isArray(raw)?[...new Set(raw.filter((id):id is string=>typeof id==='string'&&known.has(id)))].slice(0,5):[]}catch{return []}
}
export const saveRecentBenchmarks=(storage:LocalStorageLike|null,ids:string[])=>write(storage,localKeys.benchmarks,ids.slice(0,5));
