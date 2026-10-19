import {analysisDefaults,stateDates,analysisIssues,slotAccessible,type Plan,type RuntimeData} from '../components/twstock/model';
import {parseLibrary,librarySources,type LocalLibrary,type LibraryAction} from '../components/twstock/localLibrary';
import {parseLocalBackup} from '../components/twstock/localBackup';
import type {RetainedSlots} from '../components/twstock/localWorkspace';
import {AnalysisError} from './mockAnalysis';
export type LibrarySnapshot={version:1;storage:'sqlite';revision:number;plan:Plan;retained:RetainedSlots;library:LocalLibrary;canUndo:boolean;hasRecovery:boolean};
export type LibraryBackup={format:'TWStockRS-server-library-backup';version:1;createdAt:string;watchlists:(LocalLibrary['watchlists'][number]|null)[];savedViews:(LocalLibrary['savedViews'][number]|null)[]};
export type LibraryRestorePart={id:string;label:string;detail:string;allowed:boolean};
export type LibraryRestorePreview={revision:number;createdAt:string;parts:LibraryRestorePart[];note:string};
export const libraryBackupLimit=1_000_000;
export const record=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
export const rejectLibrary=(message:string,status=422,code='INVALID_LIBRARY'):never=>{throw new AnalysisError(code,message,status)};
export function exactFields(value:unknown,required:string[],optional:string[]=[]):asserts value is Record<string,unknown>{
 if(!record(value)||required.some(key=>!Object.hasOwn(value,key))||Object.keys(value).some(key=>![...required,...optional].includes(key)))rejectLibrary('資料含未支援或遺漏的欄位。');
}
export function mockPlan(value:unknown):Plan{if(typeof value!=='string'||!['Anonymous','Free','Pro'].includes(value))return rejectLibrary('模擬方案不適用。');return value as Plan}
export function revisionNumber(value:unknown):number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<1)return rejectLibrary('請提供有效的資料版本。');return value}
export function slotKind(value:unknown):'watchlist'|'saved'{if(value!=='watchlist'&&value!=='saved')return rejectLibrary('儲存格類型不適用。');return value}
export function slotIndex(value:unknown,kind:'watchlist'|'saved'):number{if(typeof value!=='number'||!Number.isInteger(value)||value<0||value>=(kind==='watchlist'?4:2))return rejectLibrary('儲存格編號不適用。');return value}
export function emptyLibrary():LocalLibrary{return {version:1,watchlists:Array.from({length:4},(_,i)=>({name:`觀察清單 ${i+1}`,market:'TWSE',ids:[]})),savedViews:Array.from({length:2},(_,i)=>({name:`已儲存檢視 ${i+1}`,preset:null}))}}
export function libraryAction(value:unknown):LibraryAction{
 if(!record(value))return rejectLibrary('管理操作格式不正確。');
 const kind=slotKind(value.kind),index=slotIndex(value.index,kind),type=value.type;
 if(type==='save'||type==='clear'){exactFields(value,['type','kind','index']);return {type,kind,index}}
 if(type==='rename'){exactFields(value,['type','kind','index','name']);if(typeof value.name!=='string')return rejectLibrary('名稱格式不正確。');return {type,kind,index,name:value.name}}
 if(type==='remove-stock'&&kind==='watchlist'){exactFields(value,['type','kind','index','id']);if(typeof value.id!=='string'||value.id.length>96)return rejectLibrary('股票身分格式不正確。');return {type,kind,index,id:value.id}}
 if(type==='bind-market'&&kind==='watchlist'){exactFields(value,['type','kind','index','market']);if(value.market!=='TWSE'&&value.market!=='TPEx')return rejectLibrary('市場不適用。');return {type,kind,index,market:value.market}}
 return rejectLibrary('不支援這項管理操作。');
}
export function createLibraryBackup(library:LocalLibrary,plan:Plan,retained:RetainedSlots,now=new Date()):LibraryBackup{
 return {format:'TWStockRS-server-library-backup',version:1,createdAt:now.toISOString(),watchlists:library.watchlists.map((entry,i)=>slotAccessible(plan,i,'watchlist',retained.watchlist)?structuredClone(entry):null),savedViews:library.savedViews.map((entry,i)=>slotAccessible(plan,i,'saved',retained.saved)?structuredClone(entry):null)};
}
export function parseLibraryBackup(text:unknown):{backup:LibraryBackup;note:string}{
 if(typeof text!=='string'||new TextEncoder().encode(text).length>libraryBackupLimit)return rejectLibrary('備份檔須為文字，且不得超過 1 MB。');
 let value:unknown;try{value=JSON.parse(text.replace(/^\uFEFF/,''))}catch{return rejectLibrary('備份檔不是有效的 JSON（文字資料格式）。')}
 let note='只還原清單與檢視；方案、Free 選定格及目前分析保持原狀。';
 if(record(value)&&value.format==='TWStockRS-local-backup'){
  try{const old=parseLocalBackup(text);value={format:'TWStockRS-server-library-backup',version:1,createdAt:old.createdAt,watchlists:old.data.watchlists,savedViews:old.data.savedViews};note='這是舊版瀏覽器備份；本次只匯入清單與檢視，最近分析及介面偏好不搬入資料庫。'}catch(error){return rejectLibrary(error instanceof Error?error.message:'舊版備份格式不正確。')}
 }
 exactFields(value,['format','version','createdAt','watchlists','savedViews']);
 if(value.format!=='TWStockRS-server-library-backup'||value.version!==1||typeof value.createdAt!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.createdAt)||!Number.isFinite(Date.parse(value.createdAt))||new Date(value.createdAt).toISOString()!==value.createdAt||!Array.isArray(value.watchlists)||value.watchlists.length!==4||!Array.isArray(value.savedViews)||value.savedViews.length!==2)return rejectLibrary('備份版本、時間或固定格數量不正確。');
 for(const entry of value.watchlists){if(entry===null)continue;exactFields(entry,['name','market','ids'])}
 for(const entry of value.savedViews){if(entry===null)continue;exactFields(entry,['name','preset']);if(entry.preset!==null){exactFields(entry.preset,['mode','market','benchmarkType','benchmark','frequency','period','trail','priceType'],['currentList']);if(['mode','market','benchmarkType','benchmark','frequency','period','priceType'].some(key=>typeof (entry.preset as Record<string,unknown>)[key]!=='string'))return rejectLibrary('檢視設定必須使用正確的文字欄位。');if(entry.preset.mode==='Sector Move'&&Object.hasOwn(entry.preset,'currentList'))return rejectLibrary('產業檢視不保存股票或產業子集。')}}
 const blank=emptyLibrary();let clean:LocalLibrary;
 try{clean=parseLibrary(JSON.stringify({version:1,watchlists:value.watchlists.map((item,i)=>item??blank.watchlists[i]),savedViews:value.savedViews.map((item,i)=>item??blank.savedViews[i])}))}catch{return rejectLibrary('備份內的名稱、清單或檢視格式不正確。')}
 const watchlists=value.watchlists,savedViews=value.savedViews;
 return {backup:{format:'TWStockRS-server-library-backup',version:1,createdAt:value.createdAt,watchlists:clean.watchlists.map((item,i)=>watchlists[i]===null?null:item),savedViews:clean.savedViews.map((item,i)=>savedViews[i]===null?null:item)},note};
}
export function sourceIssues(library:LocalLibrary,plan:Plan,kind:'watchlist'|'saved',index:number,runtimeFor?:(market:string,plan:Plan)=>RuntimeData|undefined):string[]{
 if(kind==='watchlist'){const list=library.watchlists[index],runtime=runtimeFor?.(list.market,plan);return analysisIssues({...analysisDefaults(plan,list.market),runtime,viewingDate:runtime?runtime.Daily.length-1:9,currentList:list.ids})}
 const view=librarySources(library).savedView(index);if(!view)return [];const state={...view,plan,runtime:runtimeFor?.(view.market,plan)};return analysisIssues({...state,viewingDate:stateDates(state).length-1});
}
export function decodeLibrarySnapshot(value:unknown,plan:Plan):LibrarySnapshot{
 if(!record(value)||value.version!==1||value.storage!=='sqlite'||value.plan!==plan||typeof value.revision!=='number'||!Number.isSafeInteger(value.revision)||value.revision<1||typeof value.canUndo!=='boolean'||typeof value.hasRecovery!=='boolean'||!record(value.retained))return rejectLibrary('後端儲存回應格式不正確。',502);
 const retained=value.retained as RetainedSlots;
 for(const kind of ['watchlist','saved'] as const)if(retained[kind]!==null&&(typeof retained[kind]!=='number'||!Number.isInteger(retained[kind])||retained[kind]!<0||retained[kind]!>=(kind==='watchlist'?4:2)))return rejectLibrary('後端可用格回應格式不正確。',502);
 let library:LocalLibrary;try{library=parseLibrary(JSON.stringify(value.library))}catch{return rejectLibrary('後端清單回應格式不正確。',502)}
 if(library.watchlists.some((entry,i)=>!slotAccessible(plan,i,'watchlist',retained.watchlist)&&entry.ids.length)||library.savedViews.some((entry,i)=>!slotAccessible(plan,i,'saved',retained.saved)&&entry.preset))return rejectLibrary('後端回傳了鎖定格內容，已拒絕載入。',502);
 return {version:1,storage:'sqlite',revision:value.revision,plan,retained:{...retained},library,canUndo:value.canUndo,hasRecovery:value.hasRecovery};
}
