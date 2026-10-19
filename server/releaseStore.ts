import {runtimeHeader,runtimePrices,type RuntimePackage} from './importRuntime';
import {Comparison,comparisonRequest} from './versionComparison';
import {createHash,randomUUID} from 'node:crypto';
import type {ImportStore} from './importStore';
import {importFileLimit,type ImportPackage} from '../shared/dataImport';
import {AnalysisError} from '../shared/mockAnalysis';
import {exactFields} from '../shared/libraryContract';
import {decodeDataRelease,versionRecord,type VersionMarket,type VersionState,type ReleaseManifest,type DataRelease,type InputVersion} from '../shared/dataVersions';

const digest=(text:string)=>createHash('sha256').update(text,'utf8').digest('hex');
function reject(message:string,status=422,code='INVALID_VERSION'):never{throw new AnalysisError(code,message,status)}
const marketValue=(value:unknown):VersionMarket=>value==='TWSE'||value==='TPEx'?value:reject('版本市場不適用。');
const intervalOverlap=(a:{valid_from:string;valid_to:string|null},b:{valid_from:string;valid_to:string|null})=>a.valid_from<(b.valid_to||'9999')&&b.valid_from<(a.valid_to||'9999');
type Pointer={market:VersionMarket;revision:number;activation_revision:number;active_release:string|null;previous_release:string|null;can_rollback:number};

export class ReleaseStore{
 private db;private hasRuntime=false;
 constructor(private imports:ImportStore,private readonly=false){
  this.db=imports.connection;this.hasRuntime=!!this.db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name='import_runtime'").get();
  const version=Number(this.db.prepare('PRAGMA user_version').get()!.user_version);
  if(version===1)this.transaction(()=>{
   this.db.exec(`CREATE TABLE data_releases(release_id TEXT PRIMARY KEY,market TEXT NOT NULL CHECK(market IN ('TWSE','TPEx')),digest TEXT NOT NULL,created_at TEXT NOT NULL,manifest TEXT NOT NULL CHECK(json_valid(manifest)),UNIQUE(market,digest),UNIQUE(release_id,market));
    CREATE TABLE release_batches(release_id TEXT NOT NULL REFERENCES data_releases(release_id),batch_id TEXT NOT NULL REFERENCES import_batches(batch_id),position INTEGER NOT NULL,PRIMARY KEY(release_id,batch_id),UNIQUE(release_id,position));
    CREATE TABLE market_releases(market TEXT PRIMARY KEY CHECK(market IN ('TWSE','TPEx')),revision INTEGER NOT NULL CHECK(revision>=1),activation_revision INTEGER NOT NULL CHECK(activation_revision>=1),active_release TEXT,previous_release TEXT,can_rollback INTEGER NOT NULL CHECK(can_rollback IN (0,1)),FOREIGN KEY(active_release,market) REFERENCES data_releases(release_id,market),FOREIGN KEY(previous_release,market) REFERENCES data_releases(release_id,market));
    INSERT INTO market_releases VALUES ('TWSE',1,1,NULL,NULL,0),('TPEx',1,1,NULL,NULL,0);
    CREATE TABLE release_events(event_id INTEGER PRIMARY KEY AUTOINCREMENT,market TEXT NOT NULL REFERENCES market_releases(market),revision INTEGER NOT NULL,action TEXT NOT NULL CHECK(action IN ('create','activate','rollback')),release_id TEXT REFERENCES data_releases(release_id),from_release TEXT REFERENCES data_releases(release_id),to_release TEXT REFERENCES data_releases(release_id),created_at TEXT NOT NULL);
    PRAGMA user_version=2;`);
  });
  else if(version!==2)reject('版本管理資料庫版本不支援，原檔保留。',503,'VERSION_STORAGE_UNAVAILABLE');
  this.pointer('TWSE');this.pointer('TPEx');this.db.prepare('SELECT release_id FROM data_releases LIMIT 1').all();
 }
 private transaction<T>(run:()=>T,read=false):T{this.db.exec(this.readonly||read?'BEGIN':'BEGIN IMMEDIATE');try{const result=run();this.db.exec('COMMIT');return result}catch(error){this.db.exec('ROLLBACK');throw error}}
 private pointer(market:VersionMarket){const row=this.db.prepare('SELECT * FROM market_releases WHERE market=?').get(market) as Pointer|undefined;if(!row||!Number.isSafeInteger(row.revision)||row.revision<1)reject('市場版本指標無法讀取，原資料保留。',503,'VERSION_STORAGE_UNAVAILABLE');return row!}
 private current(market:VersionMarket,revision:unknown){const row=this.pointer(market);if(typeof revision!=='number'||!Number.isSafeInteger(revision)||revision<1)reject('請提供有效的版本修訂編號。');if(row.revision!==revision)reject('另一分頁已變更版本管理資料。請重新讀取後再操作，原啟用版本保留。',409,'VERSION_CONFLICT');return row}
 private release(id:string,market:VersionMarket):DataRelease{
  const row=this.db.prepare('SELECT * FROM data_releases WHERE release_id=? AND market=?').get(id,market);
  if(!row)return reject('找不到此市場的資料版本。',404,'RELEASE_NOT_FOUND');
  try{const text=String(row.manifest);if(digest(text)!==row.digest)throw Error();return decodeDataRelease({...JSON.parse(text),release_id:row.release_id,digest:row.digest,created_at:row.created_at},market)}catch{return reject('資料版本清單校驗失敗，已停止交付；請檢查原資料或回復上一版。',503,'RELEASE_INVALID')}
 }
 private state(market:VersionMarket):VersionState{
  const row=this.pointer(market),ids=this.db.prepare('SELECT release_id FROM data_releases WHERE market=? ORDER BY created_at DESC,release_id LIMIT 100').all(market);
  const unavailable=new Set<string>(),read=(id:string|null)=>{if(!id)return null;try{return this.release(id,market)}catch(error){if(error instanceof AnalysisError&&['RELEASE_INVALID','RELEASE_NOT_FOUND'].includes(error.code)){unavailable.add(id);return null}throw error}};
  const active=read(row.active_release),previous=read(row.previous_release),releases=ids.flatMap(r=>{const value=read(String(r.release_id));return value?[value]:[]});
  return {version:1,market,revision:row.revision,active_id:row.active_release,previous_id:row.previous_release,active,previous,can_rollback:!!row.can_rollback,unavailable_releases:[...unavailable],releases,events:this.db.prepare('SELECT event_id,revision,action,release_id,from_release,to_release,created_at FROM release_events WHERE market=? ORDER BY event_id DESC LIMIT 100').all(market) as VersionState['events']};
 }
 inputVersion(market:VersionMarket):InputVersion{const p=this.pointer(market),release=p.active_release?this.release(p.active_release,market):null;return {market,revision:p.activation_revision,release_id:release?.release_id??null,digest:release?.digest??null,dataset_kind:release?.dataset_kind??null}}
 private compose(market:VersionMarket,ids:unknown):{manifest:ReleaseManifest;digest:string;packages:ImportPackage[]}{
  if(!Array.isArray(ids)||!ids.length||ids.length>100||new Set(ids).size!==ids.length||ids.some(id=>typeof id!=='string'||id.length>96))reject('請選擇 1–100 個不重複的已保存批次。');
  const selected=ids as string[],packages:ImportPackage[]=[],parts:ReleaseManifest['batches']=[];let bytes=0;
  for(const id of selected){
   const compact=this.hasRuntime?this.db.prepare('SELECT b.sha256,b.report,r.root_sha256 FROM import_batches b LEFT JOIN import_runtime r USING(batch_id) WHERE batch_id=?').get(id):undefined;
   if(compact?.root_sha256){const r=runtimeHeader(this.db,id,String(compact.sha256)),report=JSON.parse(String(compact.report));if(report.ok!==true||report.sha256!==compact.sha256||report.batch_id!==id||report.error_count!==0)reject('來源報告與運算副本不一致。',503,'BATCH_INVALID');const p=r.metadata;if(!p.manifest.markets.includes(market))reject('來源批次不包含所選市場。');bytes+=Number(this.db.prepare('SELECT length(CAST(source_text AS BLOB)) n FROM import_batches WHERE batch_id=?').get(id)!.n);if(bytes>importFileLimit)reject('單一版本來源包總量上限 512 MiB，請縮小版本範圍。');packages.push(p);parts.push({batch_id:id,sha256:String(compact.sha256),date_from:p.manifest.date_from,date_to:p.manifest.date_to,price_count:r.counts[market]||0,runtime_sha256:r.root});continue;}
   const row=this.db.prepare('SELECT sha256,source_text,report FROM import_batches WHERE batch_id=?').get(id);
   if(!row)reject('來源批次不存在，未建立版本。',404,'BATCH_NOT_FOUND');
   const text=String(row!.source_text);bytes+=Buffer.byteLength(text,'utf8');if(bytes>importFileLimit)reject('單一版本來源包總量上限 512 MiB，請縮小版本範圍。');
   const verified=this.imports.validate(text),report=JSON.parse(String(row!.report));
   if(!verified.data||verified.report.sha256!==row!.sha256||!versionRecord(report)||report.format!=='TWStockRS-import-report'||report.version!==1||report.ok!==true||report.error_count!==0||report.sha256!==row!.sha256||report.batch_id!==id||verified.data.manifest.batch_id!==id)reject('來源批次已損壞或未通過檢查，原版本保留。',503,'BATCH_INVALID');
   const p=verified.data;if(!p.manifest.markets.includes(market))reject('來源批次不包含所選市場。');
   packages.push(p);parts.push({batch_id:id,sha256:String(row!.sha256),date_from:p.manifest.date_from,date_to:p.manifest.date_to,price_count:p.prices.filter(r=>r.market===market).length});
  }
  const first=packages[0].manifest;
  for(const p of packages)if(p.version!==packages[0].version||p.manifest.dataset_kind!==first.dataset_kind||p.manifest.source!==first.source||p.manifest.source_version!==first.source_version||JSON.stringify([p.manifest.adjustment.method,p.manifest.adjustment.version,p.manifest.adjustment.reference_date])!==JSON.stringify([first.adjustment.method,first.adjustment.version,first.adjustment.reference_date]))reject('同一版本的資料種類、來源版本與還原口徑必須一致，不能混用。');
  parts.sort((a,b)=>a.date_from.localeCompare(b.date_from)||a.batch_id.localeCompare(b.batch_id));
  for(let i=1;i<parts.length;i++)if(Date.parse(parts[i].date_from)!==Date.parse(parts[i-1].date_to)+86400000)reject('批次日期必須連續且不重疊，不能略過日期或拼入同日的不同集合。');
  const securities=new Map<string,string>(),segments=new Map<string,ImportPackage['market_periods'][number]>(),assignments=new Map<string,ImportPackage['memberships'][number]>(),sectors=new Map<string,string>();
  for(const p of packages){
   for(const s of p.securities){const signature=JSON.stringify([s.code,s.kind]);if(securities.has(s.security_id)&&securities.get(s.security_id)!==signature)reject('同一證券在批次間的代號或類型定義不一致。');securities.set(s.security_id,signature)}
   for(const s of p.sectors){if(sectors.has(s.sector_id)&&sectors.get(s.sector_id)!==s.market)reject('同一產業在批次間的市場定義不一致。');sectors.set(s.sector_id,s.market)}
   for(const s of p.market_periods){const previous=segments.get(s.segment_id);if(previous&&JSON.stringify([previous.security_id,previous.market,previous.valid_from,previous.valid_to,previous.adjustment_reference_date])!==JSON.stringify([s.security_id,s.market,s.valid_from,s.valid_to,s.adjustment_reference_date]))reject('同一市場區段在批次間的有效期間不一致。');segments.set(s.segment_id,s)}
   for(const s of p.memberships)assignments.set(JSON.stringify([s.security_id,s.sector_id,s.valid_from,s.valid_to]),s);
  }
  for(const rows of [Array.from(segments.values()),Array.from(assignments.values())]){const bySecurity=new Map<string,{security_id:string;valid_from:string;valid_to:string|null}[]>();for(const r of rows){const list=bySecurity.get(r.security_id)||[];list.push(r);bySecurity.set(r.security_id,list)}for(const list of bySecurity.values()){list.sort((a,b)=>a.valid_from.localeCompare(b.valid_from));for(let i=1;i<list.length;i++)if(intervalOverlap(list[i-1],list[i]))reject('批次之間的市場或產業有效期間互相重疊。')}}
  const byCode=new Map<string,ImportPackage['market_periods']>();for(const r of segments.values()){const code=JSON.parse(securities.get(r.security_id)!)[0] as string,list=byCode.get(code)||[];list.push(r);byCode.set(code,list)}for(const list of byCode.values()){list.sort((a,b)=>a.valid_from.localeCompare(b.valid_from));let last:typeof list[number]|undefined;for(const r of list){if(last&&last.security_id!==r.security_id&&intervalOverlap(last,r))reject('相同代號在批次間對應重疊的不同證券身分。');if(!last||(r.valid_to||'9999')>(last.valid_to||'9999'))last=r}}
  const price_count=parts.reduce((n,p)=>n+p.price_count,0);if(!price_count)reject('所選市場沒有可用價格紀錄，不能建立版本。');
  const latest_date=packages.flatMap(p=>p.calendar.filter(d=>d.market===market&&d.is_open).map(d=>d.date)).sort().at(-1)!;
  const manifest:ReleaseManifest={version:1,validation_version:packages[0].version===2?'price-import-v2':'price-import-v1',market,dataset_kind:first.dataset_kind,source:first.source,source_version:first.source_version,adjustment:{method:first.adjustment.method,version:first.adjustment.version,reference_date:first.adjustment.reference_date},date_from:parts[0].date_from,date_to:parts.at(-1)!.date_to,latest_date,price_count,batches:parts};
  return {manifest,digest:digest(JSON.stringify(manifest)),packages};
 }
 // Consumers pin a release ID once, then read all its packages from this same immutable composition.
 private verifyVersion(id:string,market:VersionMarket){const release=this.release(id,market),links=this.db.prepare('SELECT batch_id FROM release_batches WHERE release_id=? ORDER BY position').all(id).map(r=>String(r.batch_id)),verified=this.compose(market,links);if(verified.digest!==release.digest||JSON.stringify(links)!==JSON.stringify(release.batches.map(b=>b.batch_id)))reject('版本組成校驗失敗，原啟用指標保留。',503,'RELEASE_INVALID');return {release,packages:verified.packages}}
 readRuntimeVersion(id:string,market:VersionMarket){return this.transaction(()=>{const v=this.verifyVersion(id,market);return {...v,packages:v.packages.map(p=>p.version===2?{...p,prices:runtimePrices(this.db,p.manifest.batch_id,v.release.batches.find(b=>b.batch_id===p.manifest.batch_id)!.sha256)}:p) as RuntimePackage[]}},true)}
 readVersion(id:string,market:VersionMarket){return this.transaction(()=>{const v=this.verifyVersion(id,market);return {...v,packages:v.packages.map(p=>p.version===2?{...p,prices:[...runtimePrices(this.db,p.manifest.batch_id,v.release.batches.find(b=>b.batch_id===p.manifest.batch_id)!.sha256)]}:p)}},true)}
 private event(market:VersionMarket,revision:number,action:string,id:string|null,from:string|null,to:string|null){this.db.prepare('INSERT INTO release_events(market,revision,action,release_id,from_release,to_release,created_at) VALUES (?,?,?,?,?,?,?)').run(market,revision,action,id,from,to,new Date().toISOString())}
 compare(input:unknown){return this.transaction(()=>this.prepareComparison(input).result())}
 comparisonReport(input:unknown,file:string,maxBytes?:number){return this.transaction(()=>this.prepareComparison(input,true).writeReport(file,maxBytes))}
 private prepareComparison(input:unknown,report=false){const request=comparisonRequest(input,report);this.current(request.market,request.expected_revision);const full=(id:string)=>{const v=this.verifyVersion(id,request.market);return {...v,packages:v.packages.map(p=>p.version===2?{...p,prices:[...runtimePrices(this.db,p.manifest.batch_id,v.release.batches.find(b=>b.batch_id===p.manifest.batch_id)!.sha256)]}:p)}};return new Comparison(request,request.from_release_id?full(request.from_release_id):null,request.to_release_id?full(request.to_release_id):null)}
 handle(operation:string,input:unknown):Record<string,unknown>{
  if(operation==='compare')return {comparison:this.compare(input)};
  if(this.readonly&&!['state','check'].includes(operation))reject('背景運算僅可讀取行情。',403,'READ_ONLY');
  const schemas:Record<string,string[]>={state:['market'],preview:['market','expected_revision','batch_ids'],create:['market','expected_revision','batch_ids','expected_digest'],activate:['market','expected_revision','release_id'],rollback:['market','expected_revision'],check:['market','revision','release_id','digest','dataset_kind']};
  if(!Object.hasOwn(schemas,operation))reject('找不到這個版本介面。',404,'NOT_FOUND');exactFields(input,schemas[operation]);const market=marketValue(input.market);
  return this.transaction(()=>{
   if(operation==='state')return {state:this.state(market)};
   if(operation==='check'){const current=this.inputVersion(market);if(['revision','release_id','digest','dataset_kind'].some(k=>current[k as keyof InputVersion]!==input[k]))reject('行情輸入版本已變更，請重新取得分析後再匯出。',409,'INPUT_VERSION_CHANGED');return {input_version:current}}
   const row=this.current(market,input.expected_revision);
   if(operation==='preview'||operation==='create'){
    const result=this.compose(market,input.batch_ids);if(operation==='preview')return {state:this.state(market),preview:{...result.manifest,digest:result.digest}};
    if(input.expected_digest!==result.digest)reject('版本組成與預覽不同，請重新預覽。',409,'VERSION_PREVIEW_CHANGED');
    const previous=this.db.prepare('SELECT release_id FROM data_releases WHERE market=? AND digest=?').get(market,result.digest);
    if(previous)return {state:this.state(market),created:this.release(String(previous.release_id),market),reused:true};
    const id='input-'+randomUUID(),created=new Date().toISOString();this.db.prepare('INSERT INTO data_releases VALUES (?,?,?,?,?)').run(id,market,result.digest,created,JSON.stringify(result.manifest));
    const insert=this.db.prepare('INSERT INTO release_batches VALUES (?,?,?)');result.manifest.batches.forEach((p,i)=>insert.run(id,p.batch_id,i));
    this.db.prepare('UPDATE market_releases SET revision=revision+1 WHERE market=?').run(market);this.event(market,row.revision+1,'create',id,row.active_release,row.active_release);
    return {state:this.state(market),created:this.release(id,market),reused:false};
   }
   const target=operation==='rollback'?row.previous_release:input.release_id;
   if(operation==='activate'&&target===null)reject('啟用時必須指定已建立的資料版本。');
   if(operation==='rollback'&&!row.can_rollback)reject('目前沒有可回復的上一版。');
   if(target!==null&&typeof target!=='string')reject('資料版本識別不適用。');
   if(target!==null)this.verifyVersion(target as string,market);
   if(operation==='activate'&&target===row.active_release)return {state:this.state(market),unchanged:true};
   this.db.prepare('UPDATE market_releases SET active_release=?,previous_release=?,can_rollback=1,activation_revision=revision+1,revision=revision+1 WHERE market=?').run(target as string|null,row.active_release,market);
   this.event(market,row.revision+1,operation,target as string|null,row.active_release,target as string|null);
   return {state:this.state(market),input_version:this.inputVersion(market)};
  },operation==='state'||operation==='check');
 }
}
