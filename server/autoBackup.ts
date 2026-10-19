import {createHash, randomUUID} from 'node:crypto';
import {existsSync, mkdirSync, chmodSync, lstatSync, readdirSync, openSync, readSync, closeSync, unlinkSync, rmdirSync, statfsSync} from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {safePath, readJson, atomicJson} from './hostProtocol';
import {assertAutomaticBackupPaths,SQLitePathError} from './sqlitePaths';

export type BackupPolicy = {format:'TWStockRS-backup-policy'; version:1; enabled:boolean; time:string; keep_recent:number; keep_daily:number; keep_weekly:number; min_free_mb:number};
export const defaultBackupPolicy = ():BackupPolicy => ({format:'TWStockRS-backup-policy',version:1,enabled:false,time:'03:00',keep_recent:7,keep_daily:14,keep_weekly:8,min_free_mb:256});
const integer=(v:unknown,min:number,max:number)=>Number.isSafeInteger(v)&&Number(v)>=min&&Number(v)<=max;
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(v);
const day=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d\d-\d\d$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00+08:00'))&&new Date(Date.parse(v+'T00:00:00Z')).toISOString().slice(0,10)===v;
export const taipeiDay=(at:number)=>new Date(at+8*3600000).toISOString().slice(0,10);
const time=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
export function validateBackupPolicy(v:any):BackupPolicy{
 const keys=Object.keys(defaultBackupPolicy());
 if(!v||Object.keys(v).length!==keys.length||Object.keys(v).some(k=>!keys.includes(k))||v.format!=='TWStockRS-backup-policy'||v.version!==1||typeof v.enabled!=='boolean'||typeof v.time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.time)||!integer(v.keep_recent,2,100)||!integer(v.keep_daily,0,366)||!integer(v.keep_weekly,0,104)||!integer(v.min_free_mb,64,1048576))throw Error('備份政策不合法；至少保留最近2份，時間使用台灣時區HH:mm。');
 return v;
}
export function readBackupPolicy(root:string){const f=safePath(root,'backup-policy.json');return existsSync(f)?validateBackupPolicy(readJson(f)):defaultBackupPolicy();}
export type BackupEntry={id:string;file:string;created_at:number;slot:string;sha256:string;bytes:number;protected:boolean};
type Catalog={format:'TWStockRS-auto-backups';version:1;host_id:string;entries:BackupEntry[]};
type Pending={id:string;slot:string;created_at:number;phase:'capturing'|'captured'};
type Schedule={format:'TWStockRS-backup-schedule';version:1;host_id:string;last_slot:string|null;last_success_at:number|null;attempt_slot:string|null;attempts:number;next_retry_at:number|null;last_error:string|null;retention_warning:boolean;pending:Pending|null};
const codePattern=/^[A-Z][A-Z0-9_]{0,63}$/;
function catalog(root:string,host:string):Catalog{
 const f=safePath(root,'auto-backup-catalog.json'),v=existsSync(f)?readJson(f):{format:'TWStockRS-auto-backups',version:1,host_id:host,entries:[]};
 const ids=new Set<string>();
 if(v.format!=='TWStockRS-auto-backups'||v.version!==1||v.host_id!==host||!Array.isArray(v.entries)||v.entries.length>2000)throw Error('備份索引不合法，所有檔案保留。');
 for(const e of v.entries){if(!e||!uuid(e.id)||ids.has(e.id)||e.file!=='auto-'+e.id+'.twrsbackup'||!time(e.created_at)||!day(e.slot)||!/^\w{64}$/.test(e.sha256)||!/^[a-f0-9]{64}$/.test(e.sha256)||!integer(e.bytes,1,4*1024**3)||typeof e.protected!=='boolean')throw Error('備份索引內容不合法，所有檔案保留。');ids.add(e.id);}
 return v;
}
function schedule(root:string,host:string):Schedule{
 const f=safePath(root,'auto-backup-state.json'),v=existsSync(f)?readJson(f):{format:'TWStockRS-backup-schedule',version:1,host_id:host,last_slot:null,last_success_at:null,attempt_slot:null,attempts:0,next_retry_at:null,last_error:null,retention_warning:false,pending:null};
 if(v.format!=='TWStockRS-backup-schedule'||v.version!==1||v.host_id!==host||[v.last_slot,v.attempt_slot].some(s=>s!==null&&!day(s))||[v.last_success_at,v.next_retry_at].some(s=>s!==null&&!time(s))||!integer(v.attempts,0,100000)||typeof v.retention_warning!=='boolean'||v.last_error!==null&&(typeof v.last_error!=='string'||!codePattern.test(v.last_error))||v.pending!==null&&(!uuid(v.pending?.id)||!day(v.pending.slot)||!time(v.pending.created_at)||!['capturing','captured'].includes(v.pending.phase)))throw Error('備份排程狀態不合法，原檔保留。');
 return v;
}
export function backupFileHash(file:string){const fd=openSync(file,'r'),buffer=Buffer.alloc(1024*1024),h=createHash('sha256');try{let n;while((n=readSync(fd,buffer,0,buffer.length,null))>0)h.update(buffer.subarray(0,n));return h.digest('hex');}finally{closeSync(fd);}}
const backupDirectory=(root:string)=>safePath(root,'auto-backups');
function fileMatches(root:string,e:BackupEntry){const file=safePath(backupDirectory(root),e.file);return existsSync(file)&&lstatSync(file).isFile()&&lstatSync(file).size===e.bytes&&backupFileHash(file)===e.sha256;}
function inventory(root:string,c:Catalog){const dir=backupDirectory(root),known=new Set(c.entries.map(e=>e.file));let bytes=0,unmanaged=0;if(existsSync(dir))for(const name of readdirSync(dir)){const s=lstatSync(safePath(dir,name));if(!s.isFile())throw Error('自動備份目錄包含非一般檔案。');bytes+=s.size;if(!known.has(name))unmanaged++;}return {bytes,unmanaged};}
export function backupRetention(entries:BackupEntry[],p:BackupPolicy){
 validateBackupPolicy(p);const sorted=[...entries].sort((a,b)=>b.created_at-a.created_at||a.id.localeCompare(b.id)),keep=new Set(sorted.filter(e=>e.protected).map(e=>e.id));
 // Registration order is durable even if the wall clock moves backwards.
 for(const e of entries.slice(-p.keep_recent))keep.add(e.id);
 for(const [kind,limit] of [['day',p.keep_daily],['week',p.keep_weekly]] as const){const seen=new Set<string>();for(const e of sorted){const d=taipeiDay(e.created_at),utc=new Date(d+'T00:00:00Z');utc.setUTCDate(utc.getUTCDate()-((utc.getUTCDay()+6)%7));const bucket=kind==='day'?d:utc.toISOString().slice(0,10);if(seen.has(bucket))continue;if(seen.size>=limit)break;seen.add(bucket);keep.add(e.id);}}
 return sorted.filter(e=>!keep.has(e.id));
}
export function backupSummary(root:string,host:string,now=Date.now()){
 try{const p=readBackupPolicy(root),s=schedule(root,host),c=catalog(root,host),inv=inventory(root,c),today=taipeiDay(now);let next:number|null=null;
  if(p.enabled){let slot=today;if(s.last_slot&&s.last_slot>=today||s.attempt_slot===today&&s.attempts>=3){slot=new Date(Date.parse((s.last_slot&&s.last_slot>today?s.last_slot:today)+'T00:00:00Z')+86400000).toISOString().slice(0,10);}next=Date.parse(slot+'T'+p.time+':00+08:00');if(s.next_retry_at&&s.attempt_slot===today&&s.attempts<3)next=Math.max(next,s.next_retry_at);}
  return {available:true,enabled:p.enabled,time:p.time,timezone:'Asia/Taipei' as const,keep_recent:p.keep_recent,keep_daily:p.keep_daily,keep_weekly:p.keep_weekly,verified:c.entries.length,bytes:inv.bytes,unmanaged:inv.unmanaged,last_success_at:s.last_success_at,next_due_at:next,last_error:s.last_error,retention_warning:s.retention_warning,pending:!!s.pending};
 }catch{return {available:false,enabled:false,time:'03:00',timezone:'Asia/Taipei' as const,keep_recent:7,keep_daily:14,keep_weekly:8,verified:0,bytes:0,unmanaged:0,last_success_at:null,next_due_at:null,last_error:'BACKUP_STATE_INVALID',retention_warning:true,pending:false};}
}
export function backupEntries(root:string,host:string){return catalog(root,host).entries;}
export function protectBackup(root:string,host:string,id:string,protect:boolean){const c=catalog(root,host),e=c.entries.find(e=>e.id===id);if(!e||!fileMatches(root,e))throw Error('備份不存在或已變更，未調整保留標記。');e.protected=protect;atomicJson(safePath(root,'auto-backup-catalog.json'),c);return {id,protected:protect};}
class BackupFault extends Error{constructor(readonly code:string){super(code);}}
type Operations={capture:(id:string)=>Promise<void>;archive:(id:string,file:string)=>Promise<unknown>;verify:(file:string)=>Promise<{sha256:string;bytes:number}>;log:(event:string,code?:string)=>void;now?:()=>number;freeBytes?:(directory:string)=>bigint;signal?:AbortSignal};
type BackupResult={status:string;id?:string;code?:string;retention_warning?:boolean};
export class AutoBackupEngine{
 private active:Promise<any>|null=null;
 private now:()=>number;
 constructor(readonly root:string,readonly host:string,private operations:Operations){safePath(root);this.now=operations.now||Date.now;}
 get running(){return !!this.active;}
 async settled(){await this.active;}
 run(force=false):Promise<BackupResult>{if(this.active)return Promise.resolve({status:'busy'});const p=this.execute(force);this.active=p;void p.finally(()=>{if(this.active===p)this.active=null;}).catch(()=>{});return p;}
 private abort(){if(this.operations.signal?.aborted)throw new BackupFault('BACKUP_STOPPED');}
 private save(s:Schedule){atomicJson(safePath(this.root,'auto-backup-state.json'),s);}
 private cleanWork(id:string){const job=safePath(this.root,'auto-backup-work',id),snapshot=safePath(job,'snapshot');if(!existsSync(job))return;
  if(readdirSync(job).some(n=>n!=='snapshot'))throw Error('Unknown work files');
  if(existsSync(snapshot)){const names=readdirSync(snapshot);if(names.some(n=>!['library.sqlite','imports.sqlite','restore-history.json','library.sqlite-wal','library.sqlite-shm','imports.sqlite-wal','imports.sqlite-shm'].includes(n)||!lstatSync(safePath(snapshot,n)).isFile()))throw Error('Unknown snapshot files');for(const name of names)unlinkSync(safePath(snapshot,name));rmdirSync(snapshot);}rmdirSync(job);
 }
 private space(){const state=readJson(safePath(this.root,'state.json'));const data=safePath(this.root,'data',state.active.data);let bytes=0n;for(const n of readdirSync(data)){const s=lstatSync(safePath(data,n));if(s.isFile())bytes+=BigInt(s.size);}
  const free=this.operations.freeBytes||((dir:string)=>{const s=statfsSync(dir,{bigint:true});return s.bavail*s.bsize;});return {bytes,free};
 }
 private prune(c:Catalog,p:BackupPolicy){
  // Do not remove any fallback if an indexed file has become damaged or missing.
  if(c.entries.some(e=>!fileMatches(this.root,e)))throw Error('Indexed backup changed');
  for(const e of backupRetention(c.entries,p)){this.abort();if(!fileMatches(this.root,e))throw Error('Backup changed before removal');
   const previous=c.entries;c.entries=c.entries.filter(x=>x.id!==e.id);atomicJson(safePath(this.root,'auto-backup-catalog.json'),c);
   // A crash here leaves an unregistered file. It is retained, never guessed at.
   try{if(!fileMatches(this.root,e))throw Error('Backup changed during removal');unlinkSync(safePath(backupDirectory(this.root),e.file));this.operations.log('auto_backup_removed');}
   catch(error){c.entries=previous;atomicJson(safePath(this.root,'auto-backup-catalog.json'),c);throw error;}
  }
 }
 private async execute(force:boolean):Promise<BackupResult>{let s:Schedule|undefined;try{
   const p=readBackupPolicy(this.root);s=schedule(this.root,this.host);const c=catalog(this.root,this.host),now=this.now(),today=taipeiDay(now);
   if(!force&&!p.enabled)return {status:'disabled'};
   if(!force&&!s.pending&&(s.last_slot!==null&&s.last_slot>=today||now<Date.parse(today+'T'+p.time+':00+08:00')||s.attempt_slot===today&&(s.attempts>=3||s.next_retry_at!==null&&now<s.next_retry_at)))return {status:'not_due'};
   this.abort();assertAutomaticBackupPaths(this.root);inventory(this.root,c);if(c.entries.length>=2000)throw new BackupFault('BACKUP_CATALOG_FULL');
   if(!s.pending){const storage=this.space(),floor=BigInt(p.min_free_mb)*1024n*1024n;if(storage.free(this.root)<storage.bytes*4n+floor||storage.free(tmpdir())<storage.bytes*2n+64n*1024n*1024n)throw new BackupFault('BACKUP_STORAGE_LOW');
    s.attempts=s.attempt_slot===today?s.attempts+1:1;s.attempt_slot=today;s.next_retry_at=null;s.pending={id:randomUUID(),slot:today,created_at:now,phase:'capturing'};this.save(s);
   }
   const job=s.pending,id=job.id,file=safePath(backupDirectory(this.root),'auto-'+id+'.twrsbackup');
   mkdirSync(backupDirectory(this.root),{recursive:true,mode:0o700});if(process.platform!=='win32')chmodSync(backupDirectory(this.root),0o700);
   if(!existsSync(file)){
    if(job.phase==='capturing'){
     const work=safePath(this.root,'auto-backup-work',id);if(existsSync(work))throw new BackupFault('BACKUP_INTERRUPTED');
     try{await this.operations.capture(id);}catch{this.abort();throw new BackupFault('BACKUP_SNAPSHOT_FAILED');}this.abort();job.phase='captured';this.save(s);
    }
    try{await this.operations.archive(id,file);}catch{this.abort();throw new BackupFault('BACKUP_ARCHIVE_FAILED');}this.abort();
   }
   let verified:{sha256:string;bytes:number};try{verified=await this.operations.verify(file);}catch{this.abort();throw new BackupFault('BACKUP_VERIFY_FAILED');}this.abort();if(!/^[a-f0-9]{64}$/.test(verified.sha256)||!integer(verified.bytes,1,4*1024**3)||lstatSync(safePath(backupDirectory(this.root),path.basename(file))).size!==verified.bytes||backupFileHash(file)!==verified.sha256)throw new BackupFault('BACKUP_VERIFY_FAILED');
   if(process.platform!=='win32')chmodSync(file,0o600);
   const existing=c.entries.find(e=>e.id===id);if(existing&&(existing.sha256!==verified.sha256||existing.bytes!==verified.bytes))throw new BackupFault('BACKUP_INDEX_CONFLICT');
   if(!existing)c.entries.push({id,file:path.basename(file),created_at:job.created_at,slot:job.slot,sha256:verified.sha256,bytes:verified.bytes,protected:false});
   atomicJson(safePath(this.root,'auto-backup-catalog.json'),c);s.last_slot=s.last_slot&&s.last_slot>job.slot?s.last_slot:job.slot;s.last_success_at=this.now();s.pending=null;s.last_error=null;s.next_retry_at=null;s.retention_warning=false;this.save(s);this.operations.log('auto_backup_verified');
   try{this.cleanWork(id);this.prune(c,p);}catch{s.retention_warning=true;this.save(s);this.operations.log('auto_backup_retention_failed','BACKUP_RETENTION_BLOCKED');}
   return {status:'success',id,retention_warning:s.retention_warning};
  }catch(error){const code=error instanceof SQLitePathError?'BACKUP_PATH_UNSAFE':error instanceof BackupFault?error.code:'BACKUP_FAILED';
   if(s){try{const today=taipeiDay(this.now());if(s.attempt_slot!==today){s.attempt_slot=today;s.attempts=1;}else if(!s.pending)s.attempts++;if(code!=='BACKUP_STOPPED'&&code!=='BACKUP_PATH_UNSAFE')s.pending=null;s.last_error=code;s.next_retry_at=this.now()+5*60000;this.save(s);}catch{this.operations.log('auto_backup_state_failed','BACKUP_STATE_WRITE_FAILED');}}
   this.operations.log('auto_backup_failed',code);return {status:'failed',code};
  }
 }
}
