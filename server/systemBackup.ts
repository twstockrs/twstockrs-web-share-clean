import {validMaintenanceRecord} from '../shared/adminContract';
import {DatabaseSync} from 'node:sqlite';
import {constants,copyFileSync,linkSync,closeSync,existsSync,fsyncSync,lstatSync,mkdirSync,mkdtempSync,openSync,readFileSync,readSync,readdirSync,renameSync,rmSync,statSync,fstatSync,unlinkSync,writeFileSync,writeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {ImportStore} from './importStore';
import {ReleaseStore} from './releaseStore';
import {packRuntime,runtimeHeader} from './importRuntime';
import {LibraryStore} from './libraryStore';
import {verifyShareRow} from './frozenShareStore';
import {passwordHashPattern,validUsername} from './authStore';
import {parseLibrary} from '../components/twstock/localLibrary';
import {dataPaths,acquireDataLock} from './dataLock';
import {assertSQLiteDirectory,assertRestorePaths,assertBackupTemporaryPaths} from './sqlitePaths';

const magic=Buffer.from('TWSTOCKRS-BACKUP-1\n'),limit=4*1024**3,headerLimit=2*1024**2,historyFile='restore-history.json';
const names=['library.sqlite','imports.sqlite'] as const;
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const digestPattern=/^[a-f0-9]{64}$/;
type Event={at:string;operation:'restore'|'undo';backup_sha256:string;library_revision:number;TWSE_revision:number;TPEx_revision:number};
type History={format:'TWStockRS-restore-history';version:1;events:Event[]};
type Entry={name:string;bytes:number;sha256:string};
type Summary={batches:number;prices:number;releases:number;version_events:number;library_revision:number;plan:string;watchlists:number[];saved_views:number;markets:{market:string;revision:number;activation_revision:number;active_release:string|null;previous_release:string|null;can_rollback:number}[];restore_events:number;frozen_shares?:number;accounts?:number;workspaces?:number};
type Manifest={format:'TWStockRS-backend-backup';version:1;created_at:string;entries:Entry[];summary:Summary};
const emptyHistory=():History=>({format:'TWStockRS-restore-history',version:1,events:[]});
function history(directory:string):History{
 const file=path.join(directory,historyFile);if(!existsSync(file))return emptyHistory();if(lstatSync(file).isSymbolicLink()||statSync(file).size>headerLimit)throw Error('還原記錄不合法。');
 const value=JSON.parse(readFileSync(file,'utf8'));if(value?.format!=='TWStockRS-restore-history'||value.version!==1||!Array.isArray(value.events)||value.events.length>1000||value.events.some((e:Event)=>!e||!['restore','undo'].includes(e.operation)||!digestPattern.test(e.backup_sha256)||typeof e.at!=='string'||!Number.isFinite(Date.parse(e.at))||![e.library_revision,e.TWSE_revision,e.TPEx_revision].every(n=>Number.isSafeInteger(n)&&n>=1)))throw Error('還原記錄格式不合法。');return {format:value.format,version:1,events:value.events};
}
function fileDigest(file:string){const fd=openSync(file,'r'),buffer=Buffer.alloc(1024*1024),h=createHash('sha256');try{let n;while((n=readSync(fd,buffer,0,buffer.length,null))>0)h.update(buffer.subarray(0,n));return h.digest('hex')}finally{closeSync(fd)}}
function schema(db:DatabaseSync){return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name").all().map(row=>({...row,sql:typeof row.sql==='string'?row.sql.replace(/\s+/g,' ').trim():row.sql}))}
let expectedSchemas:Record<string,string>|undefined;
function schemas(){if(!expectedSchemas){const l=new LibraryStore(),i=new ImportStore();try{new ReleaseStore(i);const library3=JSON.stringify(schema(l.connection));l.connection.exec('DROP TABLE share_owners;DROP TABLE auth_sessions;DROP TABLE auth_attempts;DROP TABLE auth_events;DROP TABLE auth_config;DROP TABLE accounts;PRAGMA user_version=2');const library2=JSON.stringify(schema(l.connection));l.connection.exec('DROP TABLE frozen_shares;PRAGMA user_version=1');expectedSchemas={library4:library3,library3,library2,library1:JSON.stringify(schema(l.connection)),imports:JSON.stringify(schema(i.connection)),importsLegacy:(i.connection.exec('DROP TABLE import_runtime_chunks;DROP TABLE import_runtime;'),JSON.stringify(schema(i.connection)))}}finally{l.close();i.close()}}return expectedSchemas}
function checkDatabase(file:string,version:number,expected:string){
 if(!existsSync(file)||lstatSync(file).isSymbolicLink()||!lstatSync(file).isFile())throw Error('備份缺少合法資料庫檔案。');const db=new DatabaseSync(file,{readOnly:true});
 try{if(db.prepare('PRAGMA user_version').get()?.user_version!==version||JSON.stringify(schema(db))!==expected&&!(path.basename(file)==='imports.sqlite'&&JSON.stringify(schema(db))===schemas().importsLegacy))throw Error('資料庫結構版本或定義不支援，未進行還原。');if(db.prepare('PRAGMA integrity_check').all().some(r=>r.integrity_check!=='ok')||db.prepare('PRAGMA foreign_key_check').all().length)throw Error('資料庫完整性或關聯校驗失敗。')}finally{db.close()}
}
export function inspectData(directory:string):Summary{
 assertSQLiteDirectory(directory);
 const expected=schemas(),probe=new DatabaseSync(path.join(directory,names[0]),{readOnly:true});let libraryVersion:number;try{libraryVersion=Number(probe.prepare("PRAGMA user_version").get()!.user_version)}finally{probe.close()}checkDatabase(path.join(directory,names[0]),libraryVersion,expected["library"+libraryVersion]||"unsupported");checkDatabase(path.join(directory,names[1]),2,expected.imports);
 const legacyDb=libraryVersion<4?new DatabaseSync(path.join(directory,names[0]),{readOnly:true}):null,library=legacyDb?{connection:legacyDb,close:()=>legacyDb.close()}:new LibraryStore(path.join(directory,names[0])),libraryDb=library.connection,imports=new ImportStore(path.join(directory,names[1]));
 try{
  const db=imports.connection,versions=new ReleaseStore(imports),rows=db.prepare('SELECT batch_id FROM import_batches ORDER BY batch_id').all();let prices=0;
  for(const ref of rows){const row=db.prepare('SELECT * FROM import_batches WHERE batch_id=?').get(ref.batch_id)!;const text=String(row.source_text),verified=imports.validate(text),report=JSON.parse(String(row.report)),data=verified.data;if(report?.format!=='TWStockRS-import-report'||report.version!==1||typeof report.checked_at!=='string'||!Number.isFinite(Date.parse(report.checked_at))||Object.keys(report).some(key=>!(key in verified.report))||Object.keys(verified.report).some(key=>key!=='checked_at'&&JSON.stringify(report[key])!==JSON.stringify(verified.report[key as keyof typeof verified.report]))||!data||verified.report.sha256!==row.sha256||report.sha256!==row.sha256||!report.ok||report.error_count!==0||report.batch_id!==row.batch_id||data.manifest.batch_id!==row.batch_id||data.manifest.dataset_kind!==row.dataset_kind||data.manifest.source_version!==row.source_version||data.manifest.date_from!==row.date_from||data.manifest.date_to!==row.date_to||data.prices.length!==row.price_count)throw Error('保存批次原文、索引或報告不一致。');if(data.version===2&&packRuntime(data).root_sha256!==runtimeHeader(db,String(row.batch_id),String(row.sha256)).root)throw Error('運算副本與保存原文不一致。');prices+=data.prices.length}
  const releases=db.prepare('SELECT release_id,market FROM data_releases').all();for(const release of releases)for(const p of versions.readRuntimeVersion(String(release.release_id),release.market as 'TWSE'|'TPEx').packages)for(const price of p.prices){void price;}
  const markets=db.prepare('SELECT * FROM market_releases ORDER BY market').all() as Summary['markets'];if(markets.length!==2||markets.map(m=>m.market).join(',')!=='TPEx,TWSE'||markets.some(m=>!Number.isSafeInteger(m.revision)||!Number.isSafeInteger(m.activation_revision)||m.activation_revision<1||m.activation_revision>m.revision))throw Error('市場啟用指標不合法。');
  for(const market of markets){versions.inputVersion(market.market as 'TWSE'|'TPEx');if(market.previous_release)for(const p of versions.readRuntimeVersion(market.previous_release,market.market as 'TWSE'|'TPEx').packages)for(const price of p.prices){void price;}if(db.prepare('SELECT event_id FROM release_events WHERE market=? AND revision>? LIMIT 1').get(market.market,market.revision))throw Error('版本操作記錄超出管理修訂。')}
  const rowsLibrary=library.connection.prepare('SELECT * FROM workspace').all(),owners=new Map(rowsLibrary.map(row=>[String(row.owner),row]));
  for(const row of rowsLibrary){if(row.owner!=='local-workspace'&&!/^(account|guest)-[a-f0-9-]{36}$/.test(String(row.owner))||!Number.isSafeInteger(row.revision)||Number(row.revision)<1)throw Error('工作區身分或修訂不支援。');parseLibrary(String(row.contents))}
  if(libraryVersion<3&&(rowsLibrary.length!==1||!owners.has('local-workspace')))throw Error('舊工作區身分不支援。');
  const row=owners.get('local-workspace')||{revision:Math.max(1,...rowsLibrary.map(r=>Number(r.revision))),plan:'multi-account',contents:JSON.stringify({version:1,watchlists:[],savedViews:[]})},contents=owners.has('local-workspace')?parseLibrary(String(row.contents)):{watchlists:[],savedViews:[]};
  for(const recovery of library.connection.prepare('SELECT * FROM library_recovery').all()){parseLibrary(String(recovery.before_contents));const parts=JSON.parse(String(recovery.parts));if(!Array.isArray(parts)||parts.some((p:unknown)=>typeof p!=='string'||!/^watchlist:[0-3]$|^saved:[0-1]$/.test(p))||Number(recovery.restored_revision)>Number(owners.get(String(recovery.owner))?.revision||0))throw Error('清單復原記錄不合法。')}
  let frozenShares:number|undefined,accounts:number|undefined;
  if(libraryVersion>=2){const shares=libraryDb.prepare('SELECT * FROM frozen_shares').all();for(const share of shares)verifyShareRow(share as unknown as Parameters<typeof verifyShareRow>[0]);frozenShares=shares.length}
  if(libraryVersion>=3){
   const rows=libraryDb.prepare('SELECT * FROM accounts').all(),ids=new Set(rows.map(a=>a.account_id));accounts=rows.length;
   for(const a of rows)if(!/^account-[a-f0-9-]{36}$/.test(String(a.account_id))||!validUsername(a.username)||!passwordHashPattern.test(String(a.password_hash))||!Number.isSafeInteger(a.revision)||Number(a.revision)<1||!Number.isSafeInteger(a.created_at)||a.pro_until!==null&&!Number.isSafeInteger(a.pro_until)||!owners.has(String(a.account_id)))throw Error('帳號保存資料不合法。');
   for(const owner of owners.keys())if(owner.startsWith('account-')&&!ids.has(owner))throw Error('工作區缺少帳號歸屬。');
   const config=libraryDb.prepare('SELECT * FROM auth_config').all();if(config.length!==1||config[0].id!==1||! /^[a-f0-9-]{36}$/.test(String(config[0].instance)))throw Error('工作階段設定不合法。');
   for(const session of libraryDb.prepare('SELECT * FROM auth_sessions').all())if(!digestPattern.test(String(session.token_hash))||!owners.has(String(session.owner))||session.account_id!==null&&session.owner!==session.account_id||![session.created_at,session.idle_until,session.expires_at].every(n=>Number.isSafeInteger(n))||Number(session.created_at)>Number(session.idle_until)||Number(session.idle_until)>Number(session.expires_at))throw Error('工作階段保存資料不合法。');
   for(const attempt of libraryDb.prepare('SELECT * FROM auth_attempts').all())if(!digestPattern.test(String(attempt.key))||!Number.isSafeInteger(attempt.failures)||Number(attempt.failures)<1||!Number.isSafeInteger(attempt.until_at))throw Error('登入限制保存資料不合法。');
   for(const event of libraryDb.prepare('SELECT * FROM auth_events').all())if(!Number.isSafeInteger(event.event_id)||Number(event.event_id)<1||!Number.isSafeInteger(event.at)||!(['login_failed','login','logout','logout_all','account_created','account_updated','legacy_claimed'].includes(String(event.event))||libraryVersion>=4&&validMaintenanceRecord(String(event.event)))||event.account_id!==null&&!ids.has(event.account_id))throw Error('帳號操作記錄不合法。');
   const links=libraryDb.prepare('SELECT * FROM share_owners').all();if(links.length!==frozenShares)throw Error('分享歸屬不完整。');
  }
  const recorded=history(directory);if(recorded.events.some(e=>e.library_revision>Number(row.revision)||e.TWSE_revision>markets.find(m=>m.market==='TWSE')!.revision||e.TPEx_revision>markets.find(m=>m.market==='TPEx')!.revision))throw Error('完整還原記錄超出目前修訂。');
  return {batches:rows.length,prices,releases:releases.length,version_events:Number(db.prepare('SELECT COUNT(*) AS n FROM release_events').get()!.n),library_revision:Math.max(Number(row.revision),...rowsLibrary.map(r=>Number(r.revision))),plan:String(row.plan),watchlists:contents.watchlists.map(w=>w.ids.length),saved_views:contents.savedViews.filter(v=>v.preset).length,markets,restore_events:recorded.events.length,...(frozenShares!==undefined?{frozen_shares:frozenShares}:{}),...(accounts!==undefined?{accounts,workspaces:rowsLibrary.length}:{})};
 }finally{library.close();imports.close()}
}
function vacuum(db:DatabaseSync,file:string){db.prepare('VACUUM INTO ?').run(file)}
function durableJson(file:string,value:unknown){const fd=openSync(file,'wx');try{writeFileSync(fd,JSON.stringify(value,null,2));fsyncSync(fd)}finally{closeSync(fd)}}
function copyRange(input:number,output:number,bytes:number,position:number,fullHash?:ReturnType<typeof createHash>){const buffer=Buffer.alloc(1024*1024),h=createHash('sha256');let left=bytes;while(left){const n=readSync(input,buffer,0,Math.min(buffer.length,left),position);if(!n)throw Error('備份檔提前結束。');let offset=0;while(offset<n)offset+=writeSync(output,buffer,offset,n-offset,null);h.update(buffer.subarray(0,n));fullHash?.update(buffer.subarray(0,n));left-=n;position+=n}return h.digest('hex')}
export function archiveBackupSnapshot(directory:string,output:string){
 if(existsSync(output))throw Error('備份輸出必須是新檔案，不覆寫既有檔案。');const summary=inspectData(directory),entries=[...names,...(existsSync(path.join(directory,historyFile))?[historyFile]:[])].map(name=>({name,bytes:statSync(path.join(directory,name)).size,sha256:fileDigest(path.join(directory,name))}));
 const manifest:Manifest={format:'TWStockRS-backend-backup',version:1,created_at:new Date().toISOString(),entries,summary},header=Buffer.from(JSON.stringify(manifest)),length=Buffer.alloc(4);length.writeUInt32BE(header.length);if(header.length>headerLimit||entries.reduce((n,e)=>n+e.bytes,magic.length+4+header.length)>limit)throw Error('完整備份超過 4 GiB 上限，未建立備份。');
 mkdirSync(path.dirname(output),{recursive:true,mode:0o700});const staging=output+'.partial-'+randomUUID(),fd=openSync(staging,'wx',0o600);try{writeSync(fd,magic);writeSync(fd,length);writeSync(fd,header);for(const e of entries){const source=openSync(path.join(directory,e.name),'r');try{if(copyRange(source,fd,e.bytes,0)!==e.sha256)throw Error('備份來源在產檔時變更。')}finally{closeSync(source)}}fsyncSync(fd)}catch(error){closeSync(fd);unlinkSync(staging);throw error}closeSync(fd);
 // Publish exclusively; removable drives without hard links use an exclusive copy.
 try{requirePublish(staging,output)}finally{if(existsSync(staging))unlinkSync(staging)}return {manifest,sha256:fileDigest(output),file:output};
}
function requirePublish(staging:string,output:string){try{linkSync(staging,output)}catch(error){if(!['ENOTSUP','EOPNOTSUPP','EPERM','EXDEV','ENOSYS'].includes((error as NodeJS.ErrnoException).code||''))throw error;copyFileSync(staging,output,constants.COPYFILE_EXCL)}}
export function writeConnectedSnapshot(library:DatabaseSync,imports:DatabaseSync,directory:string,sourceDirectory?:string){
 assertSQLiteDirectory(directory,'備份快照資料庫');
 if(existsSync(directory))throw Error('快照目錄必須全新。');mkdirSync(directory,{mode:0o700});
 vacuum(library,path.join(directory,names[0]));if(Number(library.prepare('PRAGMA user_version').get()!.user_version)>=3){const clean=new DatabaseSync(path.join(directory,names[0]));try{clean.exec('DELETE FROM auth_sessions;DELETE FROM auth_attempts;PRAGMA wal_checkpoint(TRUNCATE)')}finally{clean.close()}}
 vacuum(imports,path.join(directory,names[1]));if(sourceDirectory&&existsSync(path.join(sourceDirectory,historyFile)))durableJson(path.join(directory,historyFile),history(sourceDirectory));
}
export function createConnectedBackup(library:DatabaseSync,imports:DatabaseSync,output:string,sourceDirectory?:string){
 assertBackupTemporaryPaths();
 const temp=mkdtempSync(path.join(tmpdir(),'twstockrs-snapshot-'));try{const snapshot=path.join(temp,'snapshot');writeConnectedSnapshot(library,imports,snapshot,sourceDirectory);return archiveBackupSnapshot(snapshot,path.resolve(output))}finally{rmSync(temp,{recursive:true,force:true})}
}
export function createStoppedBackup(directory:string,output:string){
 assertSQLiteDirectory(directory);assertBackupTemporaryPaths();
 const paths=dataPaths(directory),resolvedOutput=path.resolve(output);if(resolvedOutput===paths.root||resolvedOutput.startsWith(paths.root+path.sep))throw Error('完整備份請存到資料目錄之外，避免與還原目標混用。');const unlock=acquireDataLock(directory);try{inspectData(paths.root);const library=new DatabaseSync(path.join(paths.root,names[0])),imports=new DatabaseSync(path.join(paths.root,names[1]));try{return createConnectedBackup(library,imports,output,paths.root)}finally{library.close();imports.close()}}finally{unlock()}
}
function extract(file:string,directory:string){
 const fd=openSync(file,'r');try{
  const size=fstatSync(fd).size;if(size>limit||size<magic.length+4)throw Error('完整備份大小不合法。');const prefix=Buffer.alloc(magic.length+4);if(readSync(fd,prefix,0,prefix.length,0)!==prefix.length||!prefix.subarray(0,magic.length).equals(magic))throw Error('不是 TWStockRS 完整後端備份。');const length=prefix.readUInt32BE(magic.length);if(length<2||length>headerLimit||length+prefix.length>size)throw Error('備份標頭大小不合法。');const header=Buffer.alloc(length);if(readSync(fd,header,0,length,prefix.length)!==length)throw Error('備份標頭不完整。');const m=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(header)) as Manifest;
  if(m?.format!=='TWStockRS-backend-backup'||m.version!==1||typeof m.created_at!=='string'||!Number.isFinite(Date.parse(m.created_at))||!Array.isArray(m.entries)||![2,3].includes(m.entries.length)||m.entries.some((e,i)=>!e||e.name!==[...names,historyFile][i]||!Number.isSafeInteger(e.bytes)||e.bytes<1||!digestPattern.test(e.sha256))||m.entries.reduce((n,e)=>n+e.bytes,prefix.length+length)!==size)throw Error('備份清單、版本或檔案長度不合法。');
  const fullHash=createHash('sha256').update(prefix).update(header);let position=prefix.length+length;for(const e of m.entries){const target=openSync(path.join(directory,e.name),'wx');let digest;try{digest=copyRange(fd,target,e.bytes,position,fullHash);fsyncSync(target)}finally{closeSync(target)}if(digest!==e.sha256)throw Error('備份 SHA-256（檔案校驗值）不符，未還原。');position+=e.bytes}
  const summary=inspectData(directory);if(JSON.stringify(summary)!==JSON.stringify(m.summary))throw Error('備份摘要與實際資料不符。');return {manifest:m,sha256:fullHash.digest('hex')};
 }finally{closeSync(fd)}
}
const managed=new Set([...names,...names.flatMap(n=>[n+'-wal',n+'-shm']),historyFile,'restore-state.json']);
function revisionFloor(directory:string){
 const value:{library_revision:number;markets:{market:string;revision:number;activation_revision:number}[]}={library_revision:0,markets:[]};
 for(const name of names){let db:DatabaseSync|undefined;try{db=new DatabaseSync(path.join(directory,name),{readOnly:true});if(name==='library.sqlite'){const n=Number(db.prepare('SELECT MAX(revision) AS revision FROM workspace').get()?.revision);if(Number.isSafeInteger(n)&&n>=1)value.library_revision=n}else for(const row of db.prepare('SELECT market,revision,activation_revision FROM market_releases').all()){if(['TWSE','TPEx'].includes(String(row.market))&&[row.revision,row.activation_revision].every(n=>Number.isSafeInteger(n)&&Number(n)>=1))value.markets.push({market:String(row.market),revision:Number(row.revision),activation_revision:Number(row.activation_revision)})}}catch{}finally{db?.close()}}
 try{for(const event of history(directory).events){value.library_revision=Math.max(value.library_revision,event.library_revision);for(const market of ['TWSE','TPEx']){const n=market==='TWSE'?event.TWSE_revision:event.TPEx_revision,prior=value.markets.find(m=>m.market===market);if(prior){prior.revision=Math.max(prior.revision,n);prior.activation_revision=Math.max(prior.activation_revision,n)}else value.markets.push({market,revision:n,activation_revision:n})}}}catch{}return value;
}
function targetState(directory:string){
 if(!existsSync(directory))return {fingerprint:hash('absent'),summary:null};const files=readdirSync(directory);if(files.some(name=>!managed.has(name)||!lstatSync(path.join(directory,name)).isFile()||lstatSync(path.join(directory,name)).isSymbolicLink()))throw Error('目標含非後端管理檔案或連結，未移動或覆寫。請另選專用資料目錄。');
 if(!files.length)return {fingerprint:hash('empty'),summary:null};
 for(const [index,name] of names.entries()){let db:DatabaseSync|undefined,version=0;try{db=new DatabaseSync(path.join(directory,name),{readOnly:true});version=Number(db.prepare('PRAGMA user_version').get()?.user_version)}catch{}finally{db?.close()}if(version>[4,2][index])throw Error('目標資料庫來自較新程式版本，不能降級覆寫。請更新程式或還原到另一個新目錄。')}
 let summary:Summary|null=null,warning='';try{summary=inspectData(directory)}catch{warning='目標資料不可讀或校驗失敗；還原時整份原資料另保留。此狀態不能使用自動撤回。'}const currentFiles=readdirSync(directory).sort();return {fingerprint:hash(JSON.stringify(currentFiles.map(name=>[name,statSync(path.join(directory,name)).size,fileDigest(path.join(directory,name))]))),summary,warning,revision_floor:revisionFloor(directory)};
}
function previewIn(file:string,directory:string,staging:string){const source=extract(path.resolve(file),staging),target=targetState(directory);return {...source,target,confirmation_token:hash(source.sha256+'|'+directory+'|'+target.fingerprint)}}
export function previewBackup(file:string,directory:string){
 assertRestorePaths(directory);assertBackupTemporaryPaths();
 const {root}=dataPaths(directory),unlock=acquireDataLock(root),temp=mkdtempSync(path.join(tmpdir(),'twstockrs-preview-'));try{return previewIn(file,root,temp)}finally{rmSync(temp,{recursive:true,force:true});unlock()}
}
function bump(directory:string,other:{library_revision:number;markets:{market:string;revision:number;activation_revision:number}[]}|null,operation:Event['operation'],sha256:string,previousHistory:History){
 const epoch=Date.now(),db=new DatabaseSync(path.join(directory,names[0])),imports=new DatabaseSync(path.join(directory,names[1]));try{const revision=Number(db.prepare('SELECT MAX(revision) AS revision FROM workspace').get()!.revision),next=Math.max(revision,other?.library_revision||0,epoch)+1;if(!Number.isSafeInteger(next))throw Error('修訂編號超出支援範圍。');db.prepare('UPDATE workspace SET revision=?').run(next);if(Number(db.prepare('PRAGMA user_version').get()!.user_version)>=3){db.exec('DELETE FROM auth_sessions;DELETE FROM auth_attempts');db.prepare('UPDATE accounts SET revision=MAX(revision,?)+1').run(next)}const updated:Record<string,number>={};for(const market of ['TWSE','TPEx']){const row=imports.prepare('SELECT revision,activation_revision FROM market_releases WHERE market=?').get(market)!;const old=other?.markets.find(m=>m.market===market);const value=Math.max(Number(row.revision),old?.revision||0,epoch)+1,activation=Math.max(Number(row.activation_revision),old?.activation_revision||0,epoch)+1;if(!Number.isSafeInteger(value)||!Number.isSafeInteger(activation))throw Error('修訂編號超出支援範圍。');imports.prepare('UPDATE market_releases SET revision=?,activation_revision=? WHERE market=?').run(value,activation,market);updated[market]=value}const h=history(directory),seen=new Set(h.events.map(e=>JSON.stringify(e)));for(const event of previousHistory.events){const key=JSON.stringify(event);if(!seen.has(key)){h.events.push(event);seen.add(key)}}h.events.sort((a,b)=>a.at.localeCompare(b.at)||a.library_revision-b.library_revision);if(h.events.length>=1000)throw Error('還原記錄已達上限，請保留檔案並安排結構升級。');h.events.push({at:new Date().toISOString(),operation,backup_sha256:sha256,library_revision:next,TWSE_revision:updated.TWSE,TPEx_revision:updated.TPEx});const historyFd=openSync(path.join(directory,historyFile),'w');try{writeFileSync(historyFd,JSON.stringify(h,null,2));fsyncSync(historyFd)}finally{closeSync(historyFd)}db.exec('PRAGMA wal_checkpoint(TRUNCATE)');imports.exec('PRAGMA wal_checkpoint(TRUNCATE)')}finally{db.close();imports.close()}
}
type Journal={format:'TWStockRS-restore-journal';version:1;target:string;staging:string;previous:string;had_target:boolean};
function safeJournal(directory:string):Journal{
 const paths=dataPaths(directory),j=JSON.parse(readFileSync(paths.journal,'utf8')) as Journal,base=path.basename(paths.root),parent=path.dirname(paths.root),uuid='[a-f0-9-]{36}';if(j?.format!=='TWStockRS-restore-journal'||j.version!==1||j.target!==paths.root||typeof j.had_target!=='boolean'||typeof j.staging!=='string'||typeof j.previous!=='string'||path.dirname(j.staging)!==parent||path.dirname(j.previous)!==parent||!new RegExp('^'+base.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\.incoming-'+uuid+'$').test(path.basename(j.staging))||!new RegExp('^'+base.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'\\.before-'+uuid+'$').test(path.basename(j.previous)))throw Error('還原日誌路徑不合法，所有資料保留。');for(const p of [j.staging,j.previous,j.target])dataPaths(p);return j;
}
// Recovery only renames verified sibling directories. It never deletes retained data.
function recoverLocked(directory:string){
 const paths=dataPaths(directory);if(!existsSync(paths.journal))return {notice:'沒有未完成還原。'};const j=safeJournal(directory);
 if(existsSync(j.previous)){targetState(j.previous);if(existsSync(j.target)){targetState(j.target);renameSync(j.target,j.target+'.interrupted-'+randomUUID())}renameSync(j.previous,j.target)}else if(j.had_target){if(!existsSync(j.target))throw Error('找不到原資料，未移除日誌；請人工檢查。')}else if(existsSync(j.target)){targetState(j.target);renameSync(j.target,j.target+'.interrupted-'+randomUUID())}
 unlinkSync(paths.journal);return {notice:'已完成中斷復原；原資料或首次還原結果保留。未完成副本也保留在相鄰目錄。',target:j.target};
}
export function recoverRestore(directory:string){const unlock=acquireDataLock(directory,true);try{return recoverLocked(directory)}finally{unlock()}}
export function restoreBackup(file:string,directory:string,confirmation:string,hooks:{afterOldRename?:()=>void;afterInstall?:()=>void;operation?:Event['operation']}={}){
 assertRestorePaths(directory);
 const paths=dataPaths(directory),unlock=acquireDataLock(directory),staging=paths.root+'.incoming-'+randomUUID(),previous=paths.root+'.before-'+randomUUID();let journal=false;
 try{
  mkdirSync(staging);const preview=previewIn(file,paths.root,staging);if(confirmation!==preview.confirmation_token)throw Error('備份檔或目標資料已變更，請重新預覽後再確認還原。');let priorHistory=emptyHistory();try{priorHistory=history(paths.root)}catch{}bump(staging,preview.target.summary||('revision_floor' in preview.target?preview.target.revision_floor||null:null),hooks.operation||'restore',preview.sha256,priorHistory);inspectData(staging);
  const prior=existsSync(paths.root),previousFingerprint=prior?targetState(paths.root).fingerprint:null;
  const j:Journal={format:'TWStockRS-restore-journal',version:1,target:paths.root,staging,previous,had_target:prior};durableJson(paths.journal,j);journal=true;
  if(prior)renameSync(paths.root,previous);hooks.afterOldRename?.();renameSync(staging,paths.root);hooks.afterInstall?.();
  const installed=targetState(paths.root);durableJson(path.join(paths.root,'restore-state.json'),{format:'TWStockRS-restore-state',version:1,previous:prior&&preview.target.summary?path.basename(previous):null,previous_fingerprint:previousFingerprint,installed_fingerprint:installed.fingerprint,backup_sha256:preview.sha256});
  unlinkSync(paths.journal);journal=false;return {notice:'完整後端資料已還原。請重新啟動並重新讀取網站；舊分頁修訂已失效。',target:paths.root,previous:prior?previous:null,summary:installed.summary};
 }catch(error){if(journal){recoverLocked(paths.root);journal=false}throw error}finally{if(existsSync(staging)&&!journal)rmSync(staging,{recursive:true,force:true});unlock()}
}
export function undoRestore(directory:string,confirmation?:string){
 assertRestorePaths(directory);assertBackupTemporaryPaths();
 const paths=dataPaths(directory),unlock=acquireDataLock(directory);let temp:string|undefined;
 try{
  const stateFile=path.join(paths.root,'restore-state.json');if(!existsSync(stateFile)||lstatSync(stateFile).isSymbolicLink()||statSync(stateFile).size>16384)throw Error('沒有可撤回的完整還原。');const state=JSON.parse(readFileSync(stateFile,'utf8')),base=path.basename(paths.root);if(state.format!=='TWStockRS-restore-state'||state.version!==1||typeof state.previous!=='string'||!state.previous.startsWith(base+'.before-')||path.basename(state.previous)!==state.previous||!digestPattern.test(state.installed_fingerprint)||!digestPattern.test(state.previous_fingerprint))throw Error('完整還原前資料不存在完整有效的原資料；原副本仍保留。');
  const currentFiles=readdirSync(paths.root).filter(n=>n!=='restore-state.json').sort(),current=hash(JSON.stringify(currentFiles.map(name=>[name,statSync(path.join(paths.root,name)).size,fileDigest(path.join(paths.root,name))])));if(current!==state.installed_fingerprint)throw Error('還原後已有修改，不能撤回覆蓋；請先建立新的完整備份。');
  const previous=path.join(path.dirname(paths.root),state.previous);dataPaths(previous);const prior=targetState(previous);if(prior.fingerprint!==state.previous_fingerprint)throw Error('還原前副本已變更，不能撤回。');
  const token=hash(current+'|'+prior.fingerprint+'|'+paths.root);if(!confirmation)return {confirmation_token:token,target:paths.root,previous,summary:prior.summary};if(confirmation!==token)throw Error('撤回預覽已過期。');
  // Reuse the verified archive/install path, with a separate immutable copy of the prior state.
  temp=mkdtempSync(path.join(tmpdir(),'twstockrs-undo-'));const output=path.join(temp,'undo.twrsbackup');const l=new DatabaseSync(path.join(previous,names[0])),i=new DatabaseSync(path.join(previous,names[1]));try{createConnectedBackup(l,i,output,previous)}finally{l.close();i.close()}
  const before=targetState(paths.root).fingerprint;unlock();const p=previewBackup(output,paths.root);if(p.target.fingerprint!==before)throw Error('撤回期間資料已變更，請重新核對。');const result=restoreBackup(output,paths.root,p.confirmation_token,{operation:'undo'});return {...result,notice:'已撤回完整還原，修訂再次更新；撤回前資料另保留。'};
 }finally{if(temp)rmSync(temp,{recursive:true,force:true});unlock()}
}
