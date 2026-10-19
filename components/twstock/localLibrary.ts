import {AnalysisState,analysisDefaults,analysisIssues,catalog,demoSavedView,demoWatchlists,slotAccessible,type RuntimeData,type Plan} from './model';
import {LocalStorageLike,RetainedSlots} from './localWorkspace';
import {SourceKind,SourceLibrary} from './sourceLoad';

type Preset=Pick<AnalysisState,'mode'|'market'|'benchmarkType'|'benchmark'|'frequency'|'period'|'trail'|'priceType'>&{currentList?:string[]};
export type LocalLibrary={version:1;watchlists:{name:string;market:string;ids:string[]}[];savedViews:{name:string;preset:Preset|null}[]};
export type LibraryAction=
 | {type:'save'|'clear';kind:SourceKind;index:number}
 | {type:'rename';kind:SourceKind;index:number;name:string}
 | {type:'remove-stock';kind:'watchlist';index:number;id:string}
 | {type:'bind-market';kind:'watchlist';index:number;market:string};
export type LibraryEditResult={ok:true;library:LocalLibrary}|{ok:false;notice:string};
export const libraryKey='twstockrs.library.v1';
const fields=['mode','market','benchmarkType','benchmark','frequency','period','trail','priceType'] as const;
const record=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
const nameValid=(name:unknown):name is string=>typeof name==='string'&&name.trim().length>0&&name.length<=40;
const marketValid=(market:unknown)=>market==='TWSE'||market==='TPEx';
const idsValid=(ids:unknown):ids is string[]=>Array.isArray(ids)&&ids.length<=100&&ids.every(id=>typeof id==='string'&&id.length>0&&id.length<=96)&&new Set(ids).size===ids.length;
function presetFromState(state:AnalysisState):Preset{
 return {...Object.fromEntries(fields.map(key=>[key,state[key]])),...(state.mode==='Stock Move'?{currentList:[...state.currentList]}:{})} as Preset;
}
export function createDemoLibrary():LocalLibrary{
 return {version:1,watchlists:demoWatchlists.map(list=>({...list,ids:[...list.ids]})),savedViews:[{name:'台股 · Daily · 60D',preset:presetFromState(demoSavedView(0))},{name:'檢視 2 · 產業週頻觀察',preset:presetFromState(demoSavedView(1))}]};
}
function parsePreset(value:unknown):Preset|null{
 if(value===null)return null;
 if(!record(value)||fields.some(key=>!(key in value)))throw Error('檢視缺少設定');
 if(!['Stock Move','Sector Move'].includes(String(value.mode))||!marketValid(value.market)||!['market','sector','security'].includes(String(value.benchmarkType))||typeof value.benchmark!=='string'||value.benchmark.length>96||!['Daily','Weekly'].includes(String(value.frequency))||typeof value.period!=='string'||!/^\d{1,3}[DW]$/.test(value.period)||typeof value.trail!=='number'||!Number.isInteger(value.trail)||value.trail<5||value.trail>240||!['Adjusted','Raw'].includes(String(value.priceType)))throw Error('檢視設定格式不符');
 if(value.mode==='Stock Move'&&!idsValid(value.currentList))throw Error('檢視股票集合格式不符');
 // Copy only preset fields: never accept stored plan, date, UI or temporary chart interactions.
 return {...Object.fromEntries(fields.map(key=>[key,value[key]])),...(value.mode==='Stock Move'?{currentList:[...value.currentList as string[]]}:{})} as Preset;
}
export function parseLibrary(raw:string):LocalLibrary{
 const value:unknown=JSON.parse(raw);
 if(!record(value)||value.version!==1||!Array.isArray(value.watchlists)||value.watchlists.length!==4||!Array.isArray(value.savedViews)||value.savedViews.length!==2)throw Error('格式或儲存格數量不符');
 return {version:1,watchlists:value.watchlists.map(list=>{
  if(!record(list)||!nameValid(list.name)||!marketValid(list.market)||!idsValid(list.ids))throw Error('觀察清單格式不符');
  // Keep known-shaped unresolved IDs so the whole source can be blocked, then explicitly repaired.
  return {name:list.name,market:list.market as string,ids:[...list.ids]};
 }),savedViews:value.savedViews.map(view=>{if(!record(view)||!nameValid(view.name))throw Error('檢視名稱格式不符');return {name:view.name,preset:parsePreset(view.preset)}})};
}
export function readLocalLibrary(storage:LocalStorageLike|null):{library:LocalLibrary;raw:string|null;notice:string;writable:boolean}{
 try{
  const raw=storage?.getItem(libraryKey)??null;
  return {library:raw===null?createDemoLibrary():parseLibrary(raw),raw,notice:'',writable:true};
 }catch{return {library:createDemoLibrary(),raw:null,notice:'本機清單資料無法讀取。原資料保留，暫時顯示內建示範；已停用管理與儲存。',writable:false}}
}
export function librarySources(library:LocalLibrary,runtimeFor?:(market:string,plan:Plan)=>RuntimeData|undefined):SourceLibrary{
 return {watchlists:library.watchlists,entities:catalog,runtimeFor,savedView:index=>{
  const preset=library.savedViews[index]?.preset;if(!preset)return null;
  return {...analysisDefaults('Pro'),...preset,currentList:preset.mode==='Stock Move'?[...preset.currentList!]:[]};
 }};
}
export function editLocalLibrary(library:LocalLibrary,state:AnalysisState,retained:RetainedSlots,action:LibraryAction):LibraryEditResult{
 const fail=(notice:string):LibraryEditResult=>({ok:false,notice});
 if(!slotAccessible(state.plan,action.index,action.kind,retained[action.kind]))return fail('此儲存格鎖定，無法管理或儲存。');
 const next:LocalLibrary=structuredClone(library),entry=action.kind==='watchlist'?next.watchlists[action.index]:next.savedViews[action.index];
 if(!entry)return fail('找不到此儲存格。');
 if(action.type==='rename'){
  const name=action.name.trim();if(!nameValid(name))return fail('名稱請輸入 1–40 個字。');entry.name=name;
 }else if(action.type==='clear'){
  if(action.kind==='watchlist')next.watchlists[action.index].ids=[];else next.savedViews[action.index].preset=null;
 }else if(action.type==='remove-stock'){
  const list=next.watchlists[action.index];list.ids=list.ids.filter(id=>id!==action.id);
 }else if(action.type==='bind-market'){
  const list=next.watchlists[action.index];if(list.ids.length)return fail('非空清單不能更改市場，請先清空此儲存格內容。');
  if(!marketValid(action.market))return fail('請選擇有效市場。');list.market=action.market;
 }else if(action.kind==='watchlist'){
  const list=next.watchlists[action.index];
  if(state.mode!=='Stock Move')return fail('請先切換個股模式，再儲存目前股票清單。');
  if(list.market!==state.market)return fail('來源格與目前市場不同；請先清空並明確更改此格市場。');
  const errors=analysisIssues({...analysisDefaults(state.plan,state.market),runtime:state.runtime,viewingDate:state.runtime?state.runtime.Daily.length-1:9,currentList:state.currentList});if(errors.length)return fail(errors.join('；'));
  list.ids=[...new Set(state.currentList)];
 }else{
  const errors=analysisIssues(state.mode==='Sector Move'?{...state,currentList:[]}:state);if(errors.length)return fail(errors.join('；'));
  next.savedViews[action.index].preset=presetFromState(state);
 }
 return {ok:true,library:next};
}
// Compare against the exact last read value to avoid silently overwriting another tab's update.
export function commitLocalLibrary(storage:LocalStorageLike|null,expectedRaw:string|null,library:LocalLibrary):{ok:true;raw:string}|{ok:false;notice:string}{
 if(!storage)return {ok:false,notice:'此瀏覽器無法使用本機儲存，原內容未變更。'};
 try{
  if(storage.getItem(libraryKey)!==expectedRaw)return {ok:false,notice:'另一分頁已更新本機清單。請重新整理後再操作，避免覆蓋其修改。'};
  const raw=JSON.stringify(parseLibrary(JSON.stringify(library)));storage.setItem(libraryKey,raw);return {ok:true,raw};
 }catch{return {ok:false,notice:'本機儲存失敗，可能是瀏覽器限制或空間不足；原內容未變更。'}}
}
