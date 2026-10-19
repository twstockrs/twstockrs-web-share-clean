import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import path from 'node:path';
import {shareTableSQL} from './frozenShareStore';
import {authSchemaSQL} from './authSchema';
import {randomUUID} from 'node:crypto';
import {assertSQLiteFile} from './sqlitePaths';
import {analysisDefaults,slotAccessible,type Plan,type RuntimeData} from '../components/twstock/model';
import {editLocalLibrary,librarySources,parseLibrary,type LocalLibrary} from '../components/twstock/localLibrary';
import {prepareSourceLoad} from '../components/twstock/sourceLoad';
import {validateAnalysisRequest} from '../shared/mockAnalysis';
import {emptyLibrary,exactFields,libraryAction,mockPlan,revisionNumber,slotKind,slotIndex,createLibraryBackup,parseLibraryBackup,rejectLibrary,sourceIssues,type LibrarySnapshot,type LibraryRestorePreview} from '../shared/libraryContract';
type Row={revision:number;plan:Plan;watch_choice:number|null;saved_choice:number|null;contents:string};


export class LibraryStore{
 private db:DatabaseSync;
 private owner="local-workspace";
 private runtimeFor:((market:string,plan:Plan)=>RuntimeData|undefined)|undefined;
 setRuntimeProvider(provider:(market:'TWSE'|'TPEx',plan:Plan)=>RuntimeData|undefined){this.runtimeFor=(market,plan)=>market==='TWSE'||market==='TPEx'?provider(market,plan):undefined}
 constructor(filename=':memory:'){
  if(filename!==':memory:')assertSQLiteFile(filename);
  if(filename!==':memory:')mkdirSync(path.dirname(path.resolve(filename)),{recursive:true});
  this.db=new DatabaseSync(filename);
  try{
   this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
   const version=Number(this.db.prepare('PRAGMA user_version').get()!.user_version);
   if(![0,1,2,3,4].includes(version))throw Error('後端資料庫版本不支援，原檔保留。');
   if(version===0)this.transaction(()=>{
    this.db.exec(`CREATE TABLE workspace (owner TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK(revision>=1), plan TEXT NOT NULL CHECK(plan IN ('Anonymous','Free','Pro')), watch_choice INTEGER CHECK(watch_choice BETWEEN 0 AND 3), saved_choice INTEGER CHECK(saved_choice BETWEEN 0 AND 1), contents TEXT NOT NULL CHECK(json_valid(contents)));
     CREATE TABLE library_recovery (owner TEXT PRIMARY KEY REFERENCES workspace(owner), restored_revision INTEGER NOT NULL, before_contents TEXT NOT NULL CHECK(json_valid(before_contents)), parts TEXT NOT NULL CHECK(json_valid(parts)));
     PRAGMA user_version=1;`);
    this.db.prepare('INSERT INTO workspace VALUES (?,1,?,0,0,?)').run(this.owner,'Free',JSON.stringify(emptyLibrary()));
   });
   if(version<2)this.transaction(()=>{this.db.exec(shareTableSQL+'; PRAGMA user_version=2;')});
   if(version<3)this.transaction(()=>{this.db.exec(authSchemaSQL);this.db.prepare('INSERT INTO auth_config VALUES (1,?)').run(randomUUID());this.db.exec("INSERT INTO share_owners SELECT token,'local-workspace' FROM frozen_shares; PRAGMA user_version=3;")});
   if(version<4)this.transaction(()=>this.db.exec('PRAGMA user_version=4;'));
   if(this.db.prepare("SELECT owner FROM workspace WHERE owner='local-workspace'").get())this.read();
  }catch(error){this.db.close();throw error}
 }
 close(){this.db.close()}
 // Server-only connection for coherent maintenance snapshots.
 get connection(){return this.db}
 private transaction<T>(run:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const result=run();this.db.exec('COMMIT');return result}catch(error){this.db.exec('ROLLBACK');throw error}}
 private read(){
  const row=this.db.prepare('SELECT revision,plan,watch_choice,saved_choice,contents FROM workspace WHERE owner=?').get(this.owner) as Row|undefined;
  if(!row)return rejectLibrary('後端工作區資料遺失，請先檢查資料庫；未建立替代資料。',503,'STORAGE_UNAVAILABLE');
  try{return {...row,library:parseLibrary(row.contents),retained:{watchlist:row.watch_choice,saved:row.saved_choice}}}catch{return rejectLibrary('後端清單資料無法讀取，原內容保留；請先檢查資料庫。',503,'STORAGE_UNAVAILABLE')}
 }
 private snapshot():LibrarySnapshot{
  const row=this.read(),library=structuredClone(row.library),recovery=this.db.prepare('SELECT restored_revision FROM library_recovery WHERE owner=?').get(this.owner);
  library.watchlists=library.watchlists.map((entry,i)=>slotAccessible(row.plan,i,'watchlist',row.watch_choice)?entry:{name:row.plan==='Anonymous'?`觀察清單 ${i+1}`:entry.name,market:'TWSE',ids:[]});
  library.savedViews=library.savedViews.map((entry,i)=>slotAccessible(row.plan,i,'saved',row.saved_choice)?entry:{name:row.plan==='Anonymous'?`已儲存檢視 ${i+1}`:entry.name,preset:null});
  return {version:1,storage:'sqlite',revision:row.revision,plan:row.plan,retained:row.retained,library,hasRecovery:!!recovery,canUndo:!!recovery&&recovery.restored_revision===row.revision&&row.plan!=='Anonymous'};
 }
 private write(library:LocalLibrary){this.db.prepare('UPDATE workspace SET contents=?,revision=revision+1 WHERE owner=?').run(JSON.stringify(parseLibrary(JSON.stringify(library))),this.owner)}
 private current(input:Record<string,unknown>){
  const plan=mockPlan(input.mock_plan),revision=revisionNumber(input.expected_revision),row=this.read();
  if(plan!==row.plan||revision!==row.revision)return rejectLibrary('後端資料或模擬方案已在另一分頁變更。請重新讀取後再操作，避免覆蓋其修改。',409,'REVISION_CONFLICT');
  return row;
 }
 private preview(row:ReturnType<LibraryStore['read']>,text:unknown):LibraryRestorePreview{
  if(row.plan==='Anonymous')return rejectLibrary('Free 起可匯入清單與檢視。',403,'SLOT_LOCKED');
  const {backup,note}=parseLibraryBackup(text),incoming=emptyLibrary(),parts:LibraryRestorePreview['parts']=[];
  backup.watchlists.forEach((entry,i)=>{if(entry)incoming.watchlists[i]=entry});backup.savedViews.forEach((entry,i)=>{if(entry)incoming.savedViews[i]=entry});
  for(const kind of ['watchlist','saved'] as const){
   const entries=kind==='watchlist'?backup.watchlists:backup.savedViews;
   entries.forEach((entry,index)=>{
    if(!entry)return;const allowed=slotAccessible(row.plan,index,kind,row.retained[kind]);
    let reason=allowed?sourceIssues(incoming,row.plan,kind,index,this.runtimeFor).join('；'):'此格目前鎖定，不移動來源格，也不覆寫目標。';
    if(!reason&&kind==='watchlist'&&row.library.watchlists[index].ids.length&&row.library.watchlists[index].market!==incoming.watchlists[index].market)reason='目標清單非空且市場不同，請先清空目標並明確改綁市場。';
    parts.push({id:`${kind}:${index}`,label:`${kind==='watchlist'?'觀察清單':'已儲存檢視'} ${index+1} · ${allowed?entry.name:'鎖定格'}`,detail:reason||(kind==='watchlist'?`${incoming.watchlists[index].market} · ${row.library.watchlists[index].ids.length} → ${incoming.watchlists[index].ids.length} 檔；覆寫名稱及內容`:'覆寫名稱與分析設定；載入時回最新日期'),allowed:!reason});
   });
  }
  return {revision:row.revision,createdAt:backup.createdAt,parts,note};
 }
 forActor(owner:string,plan:Plan,operation:string,value:unknown){
  if(!/^(account|guest)-[a-f0-9-]{36}$/.test(owner))throw Error('Invalid trusted workspace owner');
  if(!value||typeof value!=='object'||Array.isArray(value)||(value as Record<string,unknown>).mock_plan!==plan)return rejectLibrary('帳號方案已變更，請重新讀取。',409,'AUTH_CHANGED');
  const previous=this.owner;this.owner=owner;try{this.db.prepare('INSERT OR IGNORE INTO workspace VALUES (?,1,?,NULL,NULL,?)').run(owner,plan,JSON.stringify(emptyLibrary()));this.handle('open',{mock_plan:plan});return this.handle(operation,value)}finally{this.owner=previous}
 }
 handle(operation:string,value:unknown):Record<string,unknown>{
  return this.transaction(()=>{
   if(operation==='open'){
    exactFields(value,['mock_plan']);const plan=mockPlan(value.mock_plan),row=this.read();
    if(plan!==row.plan)this.db.prepare('UPDATE workspace SET plan=?,watch_choice=?,saved_choice=?,revision=revision+1 WHERE owner=?').run(plan,plan==='Free'?null:row.watch_choice,plan==='Free'?null:row.saved_choice,this.owner);
    return {snapshot:this.snapshot()};
   }
   const extra:Record<string,{required:string[];optional?:string[]}>= {
    choose:{required:['kind','index']},edit:{required:['action'],optional:['analysis']},load:{required:['kind','index'],optional:['analysis','selection']},backup:{required:[]},'restore/preview':{required:['text']},restore:{required:['text','selected']},undo:{required:[]}
   };
   const schema=Object.hasOwn(extra,operation)?extra[operation]:undefined;if(!schema)return rejectLibrary('找不到這個儲存介面。',404,'NOT_FOUND');
   exactFields(value,['mock_plan','expected_revision',...schema.required],schema.optional);
   const row=this.current(value);
   if(operation==='choose'){
    const kind=slotKind(value.kind),index=slotIndex(value.index,kind);
    if(row.plan!=='Free')return rejectLibrary('只有 Free 方案需要選定可用格。',403,'SLOT_LOCKED');
    if(row.retained[kind]!==null&&row.retained[kind]!==index)return rejectLibrary('本段 Free 期間已選定其他格，不能改選。',403,'SLOT_LOCKED');
    if(row.retained[kind]===null)this.db.prepare(`UPDATE workspace SET ${kind==='watchlist'?'watch_choice':'saved_choice'}=?,revision=revision+1 WHERE owner=?`).run(index,this.owner);
   }else if(operation==='edit'){
    const action=libraryAction(value.action);
    if(!slotAccessible(row.plan,action.index,action.kind,row.retained[action.kind]))return rejectLibrary('此儲存格鎖定，無法管理或儲存。',403,'SLOT_LOCKED');
    let state=analysisDefaults(row.plan);
    if(action.type==='save'){
     const market=(value.analysis as {market?:string}|undefined)?.market;state=validateAnalysisRequest(value.analysis,market?this.runtimeFor?.(market,row.plan):undefined).state;
     if(state.plan!==row.plan)return rejectLibrary('分析方案與目前後端方案不同。',403,'SLOT_LOCKED');
    }else if(Object.hasOwn(value,'analysis'))return rejectLibrary('此操作不接受分析條件。');
    const result=editLocalLibrary(row.library,state,row.retained,action);if(!result.ok)return rejectLibrary(result.notice);
    this.write(result.library);
   }else if(operation==='load'){
    const kind=slotKind(value.kind),index=slotIndex(value.index,kind);
    if(!slotAccessible(row.plan,index,kind,row.retained[kind]))return rejectLibrary('此儲存格目前鎖定，無法載入。',403,'SLOT_LOCKED');
    let state=analysisDefaults(row.plan);
    if(kind==='watchlist'){
     if(!value.analysis||typeof value.analysis!=='object'||Array.isArray(value.analysis))return rejectLibrary('請提供目前分析條件。');
     const market=(value.analysis as {market?:string}).market;state=validateAnalysisRequest({...value.analysis,security_ids:[],demo_status_overrides:{}},market?this.runtimeFor?.(market,row.plan):undefined).state;
     if(state.plan!==row.plan)return rejectLibrary('分析方案與後端方案不同。',403,'SLOT_LOCKED');
    }else if(Object.hasOwn(value,'analysis'))return rejectLibrary('檢視載入不接受覆寫來源條件。');
    if(value.selection!==undefined&&(!Array.isArray(value.selection)||value.selection.length>100||value.selection.some(id=>typeof id!=='string')))return rejectLibrary('挑選集合格式不正確。');
    const result=prepareSourceLoad(kind,index,state,row.retained,value.selection as string[]|undefined,librarySources(row.library,this.runtimeFor));
    return {snapshot:this.snapshot(),result};
   }else if(operation==='backup'){
    if(row.plan==='Anonymous')return rejectLibrary('Free 起可下載後端備份。',403,'SLOT_LOCKED');
    return {snapshot:this.snapshot(),backup:createLibraryBackup(row.library,row.plan,row.retained)};
   }else if(operation==='restore/preview')return {snapshot:this.snapshot(),preview:this.preview(row,value.text)};
   else if(operation==='restore'){
    const preview=this.preview(row,value.text),selected=value.selected;
    if(!Array.isArray(selected)||!selected.length||new Set(selected).size!==selected.length||selected.some(id=>typeof id!=='string'||!preview.parts.some(part=>part.id===id&&part.allowed)))return rejectLibrary('請只勾選目前可還原的項目。');
    const {backup}=parseLibraryBackup(value.text),next=structuredClone(row.library);
    for(const id of selected){const [kind,indexText]=id.split(':'),index=Number(indexText);if(kind==='watchlist')next.watchlists[index]=backup.watchlists[index]!;else next.savedViews[index]=backup.savedViews[index]!}
    this.write(next);
    this.db.prepare('INSERT INTO library_recovery VALUES (?,?,?,?) ON CONFLICT(owner) DO UPDATE SET restored_revision=excluded.restored_revision,before_contents=excluded.before_contents,parts=excluded.parts').run(this.owner,row.revision+1,row.contents,JSON.stringify(selected));
   }else if(operation==='undo'){
    const recovery=this.db.prepare('SELECT restored_revision,before_contents,parts FROM library_recovery WHERE owner=?').get(this.owner);
    if(!recovery)return rejectLibrary('沒有可復原的後端還原記錄。');
    if(recovery.restored_revision!==row.revision)return rejectLibrary('還原後已有新修改，不能覆蓋。',409,'REVISION_CONFLICT');
    const parts=JSON.parse(String(recovery.parts)) as string[];
    if(parts.some(id=>{const [kind,i]=id.split(':');return !slotAccessible(row.plan,Number(i),slotKind(kind),row.retained[slotKind(kind)])}))return rejectLibrary('復原涉及目前鎖定格，未改動資料。',403,'SLOT_LOCKED');
    const before=parseLibrary(String(recovery.before_contents));this.write(before);this.db.prepare('DELETE FROM library_recovery WHERE owner=?').run(this.owner);
   }
   return {snapshot:this.snapshot()};
  });
 }
}
