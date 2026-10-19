import {analysisDefaults,analysisDates,analysisIssues,benchmarkOptions,capacity,Plan,slotAccessible,type RuntimeData} from './model';
import {LocalStorageLike,RetainedSlots,FrequencyPreferences,localKeys,readFrequencyPreferences,restoreWorkspace,workspaceSnapshot,rememberFrequency} from './localWorkspace';
import {createDemoLibrary,LocalLibrary,parseLibrary,librarySources} from './localLibrary';
import {parseListPreferences,defaultListPreferences,readListPreferences,listSortOptions,type ListPreferences} from './listPreferences';
import {parseSidebarPreferences,defaultSidebarPreferences,readSidebarPreferences,type SidebarPreferences} from './sidebarPreferences';

export const backupLimit=1024*1024;
const format='TWStockRS-local-backup';
const mutableKeys:string[]=[localKeys.library,localKeys.workspace,localKeys.ui,localKeys.frequency,localKeys.benchmarks];
const record=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
type Ui={theme:'light'|'dark';filter:string;list?:ListPreferences;sidebar?:SidebarPreferences};
export type LocalBackup={format:typeof format;version:1;createdAt:string;data:{watchlists:(LocalLibrary['watchlists'][number]|null)[];savedViews:(LocalLibrary['savedViews'][number]|null)[];workspace:Record<string,unknown>|null;ui:Ui|null;frequency:FrequencyPreferences|null;recentBenchmarks:string[]|null}};
export type RestorePart={id:string;label:string;detail:string;allowed:boolean;reason:string};
export type RestorePreview={backup:LocalBackup;parts:RestorePart[];stamp:string;repairLibrary:boolean};
export type RestoreFeedback={ok:true;notice:string;changedKeys:string[]}|{ok:false;notice:string};
const requirePlan=(plan:Plan)=>{if(plan==='Anonymous')throw Error('本機資料備份／還原為 Free 起可用，不會變更目前方案。')};
const json=(raw:string|null)=>raw===null?null:JSON.parse(raw);
function canonicalWorkspace(value:unknown,plan:Plan='Pro',runtime?:RuntimeData){
 const restored=restoreWorkspace(JSON.stringify(value),plan,runtime);
 if(!restored.state)throw Error(restored.notice);
 return JSON.parse(workspaceSnapshot(restored.state)!) as Record<string,unknown>;
}
function uiValue(value:unknown):Ui{
 if(!record(value)||!['dark','light'].includes(String(value.theme))||!['All','Leading','Weakening','Lagging','Improving'].includes(String(value.filter)))throw Error('主題或象限篩選格式不符');
 return {theme:value.theme as Ui['theme'],filter:value.filter as string,...(Object.hasOwn(value,'list')?{list:parseListPreferences(value.list)}:{}),...(Object.hasOwn(value,'sidebar')?{sidebar:parseSidebarPreferences(value.sidebar)}:{})};
}
function frequencyValue(value:unknown):FrequencyPreferences{
 if(!record(value))throw Error('日週偏好格式不符');
 const normalized=readFrequencyPreferences({getItem:()=>JSON.stringify(value),setItem:()=>{}});
 for(const [plan,prefs] of Object.entries(value)){
  if(!['Anonymous','Free','Pro'].includes(plan)||!record(prefs))throw Error('日週偏好方案分類不符');
  for(const frequency of Object.keys(prefs))if(!['Daily','Weekly'].includes(frequency)||!normalized[plan as Plan]?.[frequency as 'Daily'|'Weekly'])throw Error('日週偏好超出合法範圍');
 }
 return normalized;
}
function recentValue(value:unknown,runtime?:RuntimeData):string[]{
 const known=new Set(['TWSE','TPEx'].flatMap(market=>benchmarkOptions('security',market).map(option=>option.value)).concat(runtime?benchmarkOptions('security',runtime.market,runtime).map(option=>option.value):[]));
 if(!Array.isArray(value)||value.length>5||value.some(id=>typeof id!=='string'||!known.has(id))||new Set(value).size!==value.length)throw Error('最近基準記錄格式不符');
 return [...value];
}
function incomingLibrary(data:LocalBackup['data']):LocalLibrary{
 const initial=createDemoLibrary();
 return parseLibrary(JSON.stringify({version:1,watchlists:data.watchlists.map((entry,index)=>entry??initial.watchlists[index]),savedViews:data.savedViews.map((entry,index)=>entry??initial.savedViews[index])}));
}
// Read only the declared market before fetching its current catalog. It grants no trust;
// the complete file, identifiers, current plan and version are validated afterwards.
export function backupWorkspaceMarket(text:string):string|undefined{
 if(new TextEncoder().encode(text).length>backupLimit)throw Error('備份檔超過 1 MB，未讀入。');
 const value:unknown=JSON.parse(text.replace(/^\uFEFF/,''));
 if(!record(value)||!record(value.data)||!record(value.data.workspace)||!record(value.data.workspace.analysis))return undefined;
 const market=value.data.workspace.analysis.market;
 return market==='TWSE'||market==='TPEx'?market:undefined;
}
function parsedWorkspace(value:unknown,runtime?:RuntimeData){
 // v1 DEMO backups remain readable. Validation against the destination runtime
 // still decides whether their workspace can actually be restored.
 try{return canonicalWorkspace(value,'Pro',runtime)}catch(error){
  try{return canonicalWorkspace(value)}catch{throw Error('無法依目前市場目錄確認備份的最近分析；請確認此市場行情已啟用，且標的與比較基準仍可用。'+(error instanceof Error?error.message:''))}
 }
}
export function parseLocalBackup(text:string,runtime?:RuntimeData):LocalBackup{
 if(new TextEncoder().encode(text).length>backupLimit)throw Error('備份檔超過 1 MB，未讀入。');
 const value:unknown=JSON.parse(text.replace(/^\uFEFF/,''));
 if(!record(value)||value.format!==format||value.version!==1||typeof value.createdAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.createdAt)||!Number.isFinite(Date.parse(value.createdAt))||!record(value.data))throw Error('這不是支援版本的 TWStockRS 本機備份檔。');
 if(new Date(value.createdAt).toISOString()!==value.createdAt)throw Error('備份時間格式不符。');
 if(Object.keys(value).some(key=>!['format','version','createdAt','data'].includes(key)))throw Error('備份檔含不支援欄位。');
 const source=value.data,keys=['watchlists','savedViews','workspace','ui','frequency','recentBenchmarks'];
 if(keys.some(key=>!Object.hasOwn(source,key))||Object.keys(source).some(key=>!keys.includes(key))||!Array.isArray(source.watchlists)||source.watchlists.length!==4||!Array.isArray(source.savedViews)||source.savedViews.length!==2)throw Error('備份檔缺少必要資料或儲存格數量不符。');
 const data=source as LocalBackup['data'],library=incomingLibrary(data);
 return {format,version:1,createdAt:value.createdAt,data:{watchlists:library.watchlists.map((entry,index)=>data.watchlists[index]===null?null:entry),savedViews:library.savedViews.map((entry,index)=>data.savedViews[index]===null?null:entry),workspace:data.workspace===null?null:parsedWorkspace(data.workspace,runtime),ui:data.ui===null?null:uiValue(data.ui),frequency:data.frequency===null?null:frequencyValue(data.frequency),recentBenchmarks:data.recentBenchmarks===null?null:recentValue(data.recentBenchmarks,runtime)}};
}
function snapshot(storage:LocalStorageLike|null){
 if(!storage)throw Error('此瀏覽器無法讀取本機儲存。');
 try{return Object.fromEntries([...mutableKeys,localKeys.retained,localKeys.recovery].map(key=>[key,storage.getItem(key)]))}catch{throw Error('無法讀取本機儲存資料，原內容保留；請先檢查瀏覽器儲存狀態。')}
}
export function createLocalBackup(storage:LocalStorageLike|null,plan:Plan,retained:RetainedSlots,now=new Date(),runtime?:RuntimeData){
 requirePlan(plan);const raw=snapshot(storage),warnings:string[]=[];
 let library:LocalLibrary;
 try{library=raw[localKeys.library]===null?createDemoLibrary():parseLibrary(raw[localKeys.library]!)}catch{throw Error('本機清單資料損壞，無法產生一般備份；原資料仍保留，可用先前完整備份還原。')}
 const readPart=<T,>(key:string,fallback:T,parse:(value:unknown)=>T,label:string):T|null=>{
  if(raw[key]===null)return fallback;
  try{return parse(json(raw[key]))}catch{warnings.push(label+'不合法或不符目前方案，未放入備份；原資料未變更。');return null}
 };
 const frequency=readPart(localKeys.frequency,{},frequencyValue,'日週偏好');
 const backup:LocalBackup={format,version:1,createdAt:now.toISOString(),data:{watchlists:library.watchlists.map((entry,index)=>slotAccessible(plan,index,'watchlist',retained.watchlist)?entry:null),savedViews:library.savedViews.map((entry,index)=>slotAccessible(plan,index,'saved',retained.saved)?entry:null),workspace:readPart<Record<string,unknown>|null>(localKeys.workspace,null,value=>canonicalWorkspace(value,plan,runtime),'最近分析'),ui:readPart<Ui>(localKeys.ui,{theme:'dark',filter:'All',list:defaultListPreferences(),sidebar:defaultSidebarPreferences()},value=>{const ui=uiValue(value);return {...ui,list:ui.list??defaultListPreferences(),sidebar:ui.sidebar??defaultSidebarPreferences()}},'介面偏好'),frequency:plan==='Pro'?frequency:frequency?{Free:frequency.Free??{}}:null,recentBenchmarks:readPart(localKeys.benchmarks,[],value=>recentValue(value,runtime),'最近基準')}};
 const clean=parseLocalBackup(JSON.stringify(backup),runtime);
 return {backup:clean,text:JSON.stringify(clean,null,2),filename:`TWStockRS-local-backup-${clean.createdAt.replace(/[:.]/g,'-')}.json`,warnings};
}
function sourceIssues(library:LocalLibrary,plan:Plan,kind:'watchlist'|'saved',index:number){
 if(kind==='watchlist'){const list=library.watchlists[index];return analysisIssues({...analysisDefaults(plan,list.market),currentList:list.ids})}
 const view=librarySources(library).savedView(index);return view?analysisIssues({...view,plan,viewingDate:analysisDates(view.frequency).length-1}):[];
}
export function previewLocalRestore(storage:LocalStorageLike|null,plan:Plan,retained:RetainedSlots,text:string,runtime?:RuntimeData):RestorePreview{
 requirePlan(plan);const backup=parseLocalBackup(text,runtime),raw=snapshot(storage),parts:RestorePart[]=[];
 let current:LocalLibrary,repairLibrary=false;
 try{current=raw[localKeys.library]===null?createDemoLibrary():parseLibrary(raw[localKeys.library]!)}catch{current=createDemoLibrary();repairLibrary=true}
 const incoming=incomingLibrary(backup.data);
 const complete=backup.data.watchlists.every(Boolean)&&backup.data.savedViews.every(Boolean);
 const canRepair=plan==='Pro'&&complete&&(['watchlist','saved'] as const).every(kind=>Array.from({length:kind==='watchlist'?4:2},(_,index)=>sourceIssues(incoming,plan,kind,index).length===0).every(Boolean));
 for(const kind of ['watchlist','saved'] as const){
  const entries=kind==='watchlist'?backup.data.watchlists:backup.data.savedViews;
  entries.forEach((entry,index)=>{
   if(entry===null)return;
   const allowedSlot=slotAccessible(plan,index,kind,retained[kind]),name=allowedSlot?entry.name:`第 ${index+1} 格`;
   let reason=!allowedSlot?'此格目前鎖定；保留目標內容，不還原。':repairLibrary&&!canRepair?'清單資料損壞時，需 Pro 及完整 4 個清單／2 個檢視的合法備份才能重建。':'';
   if(!reason){const errors=sourceIssues(incoming,plan,kind,index);if(errors.length)reason=errors.join('；')}
   if(!reason&&kind==='watchlist'&&!repairLibrary&&current.watchlists[index].ids.length&&current.watchlists[index].market!==incoming.watchlists[index].market)reason='目標清單非空且市場不同，請先清空目標清單再還原。';
   const detail=reason|| (kind==='watchlist'?`${incoming.watchlists[index].market} · ${current.watchlists[index].ids.length} → ${incoming.watchlists[index].ids.length} 檔，覆寫此格`:incoming.savedViews[index].preset?`${incoming.savedViews[index].preset!.mode} · ${incoming.savedViews[index].preset!.period}，覆寫此格`:'還原空檢視，清空此格設定但保留儲存格');
   parts.push({id:`${kind}:${index}`,label:`${kind==='watchlist'?'觀察清單':'已儲存檢視'} ${index+1} · ${name}`,detail,allowed:!reason,reason});
  });
 }
 if(backup.data.workspace!==null){const restored=restoreWorkspace(JSON.stringify(backup.data.workspace),plan,runtime);parts.push({id:'workspace',label:'最近分析與目前清單',detail:restored.state?`${restored.state.mode} · ${restored.state.market} · ${restored.state.period} · ${restored.state.currentList.length} 檔；日期回最新`:restored.notice,allowed:!!restored.state,reason:restored.notice})}
 if(backup.data.ui){const ui=backup.data.ui;parts.push({id:'ui',label:ui.list?'介面偏好（主題、篩選、清單顯示'+(ui.sidebar?'、側欄':'')+'）':'深淺色與象限篩選',detail:`${ui.theme==='dark'?'暗色':'淺色'} · ${ui.filter}${ui.list?` · 個股排序：${listSortOptions[ui.list.stock.sort]} · 產業排序：${listSortOptions[ui.list.sector.sort]}；含欄位設定`:'；舊備份未含清單顯示偏好，保留目前設定'}${ui.sidebar?` · 桌面側欄：${ui.sidebar.collapsed?'收合':'展開'}`:'；舊備份未含側欄偏好，保留目前設定'}`,allowed:true,reason:''})}
 if(backup.data.frequency){const allowed=plan==='Pro'||!!backup.data.frequency.Free;parts.push({id:'frequency',label:'日週期間與軌跡偏好',detail:plan==='Pro'?'還原備份中的合法偏好，未提供的保留':allowed?'只還原 Free 日頻偏好，其他方案偏好保留':'備份沒有 Free 日頻偏好，不套用其他方案的設定',allowed,reason:allowed?'':'此方案沒有可還原的偏好。'})}
 if(backup.data.recentBenchmarks)parts.push({id:'recent',label:'最近使用的比較基準',detail:`${backup.data.recentBenchmarks.length} 筆，最多 5 筆`,allowed:true,reason:''});
 return {backup,parts,stamp:JSON.stringify({storage:raw,market:runtime?.market,input:runtime?.input}),repairLibrary};
}
type Recovery={format:'TWStockRS-restore-recovery';version:1;createdAt:string;before:Record<string,string|null>;after:Record<string,string|null>};
function recovery(storage:LocalStorageLike|null):Recovery|null{
 const raw=storage?.getItem(localKeys.recovery);if(!raw)return null;
 const value:unknown=JSON.parse(raw);
 if(!record(value)||value.format!=='TWStockRS-restore-recovery'||value.version!==1||typeof value.createdAt!=='string'||!record(value.before)||!record(value.after))throw Error('復原記錄格式不符，未變更資料。');
 const before=value.before,after=value.after,keys=Object.keys(after);
 if(!keys.length||keys.some(key=>!mutableKeys.includes(key)||!Object.hasOwn(before,key)||[before[key],after[key]].some(item=>item!==null&&typeof item!=='string'))||Object.keys(before).some(key=>!keys.includes(key)))throw Error('復原記錄包含不支援欄位。');
 return value as Recovery;
}
export function recoveryAvailable(storage:LocalStorageLike|null){try{return !!recovery(storage)}catch{return false}}
export function restoreLocalBackup(storage:LocalStorageLike|null,plan:Plan,retained:RetainedSlots,text:string,selected:string[],expectedStamp:string,runtime?:RuntimeData):RestoreFeedback{
 try{
  const preview=previewLocalRestore(storage,plan,retained,text,runtime);
  if(preview.stamp!==expectedStamp)throw Error('本機資料已變更，或市場行情版本已切換，請重新預覽，避免覆蓋其他修改。');
  if(!selected.length||new Set(selected).size!==selected.length||selected.some(id=>!preview.parts.some(part=>part.id===id&&part.allowed)))throw Error('請只勾選目前可還原的項目。');
  if(!storage?.setMany)throw Error('請重新整理頁面，以啟用整批還原。');
  const raw=snapshot(storage),updates:Record<string,string|null>={},data=preview.backup.data;
  const libraryIds=selected.filter(id=>/^(watchlist|saved):/.test(id));
  if(libraryIds.length){
   if(preview.repairLibrary&&libraryIds.length!==6)throw Error('重建損壞清單需同時勾選完整 6 格，原資料將保留供復原。');
   const next=preview.repairLibrary?createDemoLibrary():raw[localKeys.library]===null?createDemoLibrary():parseLibrary(raw[localKeys.library]!);
   for(const id of libraryIds){const [kind,indexText]=id.split(':'),index=Number(indexText);if(kind==='watchlist')next.watchlists[index]=data.watchlists[index]!;else next.savedViews[index]=data.savedViews[index]!}
   updates[localKeys.library]=JSON.stringify(next);
  }
  if(selected.includes('workspace'))updates[localKeys.workspace]=JSON.stringify(canonicalWorkspace(data.workspace,plan,runtime));
  if(selected.includes('ui'))updates[localKeys.ui]=JSON.stringify({...data.ui,list:data.ui!.list??readListPreferences(storage),sidebar:data.ui!.sidebar??readSidebarPreferences(storage)});
 if(selected.includes('frequency')||selected.includes('workspace')){
   const previous=readFrequencyPreferences(storage),source=data.frequency!;
   let next=selected.includes('frequency')?(plan==='Pro'?{...previous,...source}:{...previous,Free:source.Free}):previous;
   if(selected.includes('workspace')){const restored=restoreWorkspace(updates[localKeys.workspace],plan,runtime);if(restored.state)next=rememberFrequency(next,restored.state)}
   updates[localKeys.frequency]=JSON.stringify(next);
  }
  if(selected.includes('recent'))updates[localKeys.benchmarks]=JSON.stringify(data.recentBenchmarks);
  const saved:Recovery={format:'TWStockRS-restore-recovery',version:1,createdAt:new Date().toISOString(),before:Object.fromEntries(Object.keys(updates).map(key=>[key,raw[key]])),after:updates};
  try{storage.setMany({...updates,[localKeys.recovery]:JSON.stringify(saved)})}catch{throw Error('空間不足或瀏覽器拒絕寫入，整批資料未變更。')}
  return {ok:true,notice:`已還原 ${selected.length} 個項目，方案及 Free 選定格不變。`,changedKeys:Object.keys(updates)};
 }catch(error){return {ok:false,notice:error instanceof Error?error.message:'還原失敗；原資料未變更。'}}
}
export function undoLocalRestore(storage:LocalStorageLike|null,plan:Plan,retained:RetainedSlots):RestoreFeedback{
 try{
  requirePlan(plan);const saved=recovery(storage);if(!saved)throw Error('沒有可復原的還原記錄。');
  if(!storage?.setMany)throw Error('請重新整理頁面，以啟用整批復原。');
  if(Object.entries(saved.after).some(([key,value])=>storage.getItem(key)!==value))throw Error('還原後資料已修改，為保留新資料，無法直接復原；可先下載目前備份。');
  if(Object.hasOwn(saved.before,localKeys.library)){
   try{
    const before=saved.before[localKeys.library]===null?createDemoLibrary():parseLibrary(saved.before[localKeys.library]!),after=parseLibrary(saved.after[localKeys.library]!);
    for(const kind of ['watchlist','saved'] as const){const a=kind==='watchlist'?before.watchlists:before.savedViews,b=kind==='watchlist'?after.watchlists:after.savedViews;for(let index=0;index<a.length;index++)if(JSON.stringify(a[index])!==JSON.stringify(b[index])&&!slotAccessible(plan,index,kind,retained[kind]))throw Error('復原涉及目前鎖定的格，請切換支援方案後再試。')}
   }catch(error){if(plan!=='Pro')throw Error('復原涉及鎖定格或損壞清單，需 Pro 才能完整復原。')}
  }
  try{storage.setMany({...saved.before,[localKeys.recovery]:null})}catch{throw Error('瀏覽器無法寫入復原資料，目前內容與復原記錄均保留。')}
  return {ok:true,notice:'已復原還原前資料；目前方案與 Free 選定格保持不變。',changedKeys:Object.keys(saved.before)};
 }catch(error){return {ok:false,notice:error instanceof Error?error.message:'復原失敗；目前資料未變更。'}}
}
