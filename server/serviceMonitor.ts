import {existsSync,statfsSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {atomicJson,readJson,safePath} from './hostProtocol';
import {monitorCodes,validIncident,validNotification,type MonitorCode,type MonitorIncident,type MonitorNotification,type MonitorSummary} from '../shared/monitorContract';
import {taipeiDay} from './autoBackup';
export type MonitorPolicy={version:1;enabled:boolean;min_free_mb:number;backup_late_minutes:number;queue_errors:number;trigger_samples:number;recover_samples:number};
export const defaultMonitorPolicy=():MonitorPolicy=>({version:1,enabled:true,min_free_mb:256,backup_late_minutes:120,queue_errors:3,trigger_samples:3,recover_samples:2});
export function validateMonitorPolicy(v:any):MonitorPolicy{
 const d=defaultMonitorPolicy();if(!v||Object.keys(v).sort().join(',')!==Object.keys(d).sort().join(',')||v.version!==1||typeof v.enabled!=='boolean')throw Error('監控政策不合法。');
 for(const [k,min,max] of [['min_free_mb',64,1048576],['backup_late_minutes',5,10080],['queue_errors',1,1000],['trigger_samples',1,30],['recover_samples',1,30]] as const)if(!Number.isSafeInteger(v[k])||v[k]<min||v[k]>max)throw Error('監控門檻不合法。');return v;
}
export function readMonitorPolicy(root:string){const f=safePath(root,'monitor-policy.json');return existsSync(f)?validateMonitorPolicy(readJson(f)):defaultMonitorPolicy();}
type Rule={code:MonitorCode;bad:number;good:number};
type State={version:1;host_id:string;at:number|null;fault:'MONITOR_CAPACITY'|null;rules:Rule[];incidents:MonitorIncident[];notifications:MonitorNotification[]};
const integer=(v:any)=>Number.isSafeInteger(v)&&v>=0;
function readState(root:string,host:string):State{
 const file=safePath(root,'monitor-state.json');if(!existsSync(file))return {version:1,host_id:host,at:null,fault:null,rules:monitorCodes.map(code=>({code,bad:0,good:0})),incidents:[],notifications:[]};
 const s=readJson(file);if(!s||Object.keys(s).sort().join(',')!=='at,fault,host_id,incidents,notifications,rules,version'||s.version!==1||s.host_id!==host||s.at!==null&&!integer(s.at)||![null,'MONITOR_CAPACITY'].includes(s.fault)||!Array.isArray(s.rules)||s.rules.length!==monitorCodes.length||s.rules.some((x:any)=>!x||Object.keys(x).sort().join(',')!=='bad,code,good'||!monitorCodes.includes(x.code)||!integer(x.bad)||x.bad>30||!integer(x.good)||x.good>30)||new Set(s.rules.map((x:any)=>x.code)).size!==monitorCodes.length||!Array.isArray(s.incidents)||s.incidents.length>200||!s.incidents.every(validIncident)||!Array.isArray(s.notifications)||s.notifications.length>400||!s.notifications.every(validNotification)||new Set(s.incidents.map((x:any)=>x.id)).size!==s.incidents.length||new Set(s.notifications.map((x:any)=>x.id)).size!==s.notifications.length)throw Error('監控狀態不合法，原檔保留。');
 for(const code of monitorCodes)if(s.incidents.filter((x:MonitorIncident)=>x.code===code&&x.recovered_at===null).length>1)throw Error('監控事件重複。');
 for(const x of s.notifications)if(x.incident_id!==null&&!s.incidents.some((i:MonitorIncident)=>i.id===x.incident_id&&i.code===x.code))throw Error('通知缺少事件。');
 return s;
}
export function monitorSummary(root:string,host:string,now=Date.now()):MonitorSummary{
 let p=defaultMonitorPolicy();const fields=()=>{const {version,...rest}=p;return rest;};try{p=readMonitorPolicy(root);const s=readState(root,host);return {available:true,channel:'local-mock',at:s.at,stale:s.at===null||now-s.at>45000||s.at>now+60000,...fields(),fault:s.fault,incidents:s.incidents,notifications:s.notifications,pending:s.notifications.filter(x=>x.status==='pending').length,dead:s.notifications.filter(x=>x.status==='dead').length,delivered:s.notifications.filter(x=>x.status==='delivered').length};}catch{return {available:false,channel:'local-mock',at:null,stale:true,...fields(),fault:'MONITOR_STATE_INVALID',incidents:[],notifications:[],pending:0,dead:0,delivered:0};}
}
export type MonitorTransport={deliver:(message:MonitorNotification,retained:MonitorNotification[])=>Promise<void>};
// No network transports. Receipt identity survives a manager crash between delivery and acknowledgement.
export function localMockTransport(root:string,host:string):MonitorTransport{return {async deliver(message,retained){
 const file=safePath(root,'monitor-receipts.json');let ids:string[]=[];
 if(existsSync(file)){const v=readJson(file);if(!v||Object.keys(v).sort().join(',')!=='host_id,ids,version'||v.version!==1||v.host_id!==host||!Array.isArray(v.ids)||v.ids.length>401||v.ids.some((x:any)=>typeof x!=='string'||!/^[a-f0-9-]{36}$/.test(x))||new Set(v.ids).size!==v.ids.length)throw Error('模擬接收記錄不合法。');ids=v.ids;}
 if(ids.includes(message.id))return;
 const pending=new Set(retained.filter(x=>x.status==='pending').map(x=>x.id));ids=ids.filter(id=>pending.has(id));ids.push(message.id);
 atomicJson(file,{version:1,host_id:host,ids});
 }};}
export class ServiceMonitor{
 private active:Promise<void>|null=null;private now:()=>number;private transport:MonitorTransport;private stopped=false;
 constructor(readonly root:string,readonly host:string,options:{now?:()=>number;transport?:MonitorTransport}={}){this.now=options.now??Date.now;this.transport=options.transport??localMockTransport(root,host);}
 private save(s:State){atomicJson(safePath(this.root,'monitor-state.json'),s);}
 private trim(s:State,need:number){while(s.notifications.length+need>400){const index=s.notifications.findIndex(x=>x.status==='delivered'&&(x.incident_id===null||s.incidents.some(i=>i.id===x.incident_id&&i.recovered_at!==null)));if(index<0)throw Error('MONITOR_CAPACITY');s.notifications.splice(index,1);}while(s.incidents.length>=200){const index=s.incidents.findIndex(i=>i.recovered_at!==null&&!s.notifications.some(n=>n.incident_id===i.id&&n.status!=='delivered'));if(index<0)throw Error('MONITOR_CAPACITY');const id=s.incidents[index].id;s.notifications=s.notifications.filter(n=>n.incident_id!==id);s.incidents.splice(index,1);}}
 observe(values:Partial<Record<MonitorCode,boolean|null>>,immediate=false){
 const p=readMonitorPolicy(this.root),s=readState(this.root,this.host),now=this.now();if(s.at===null||now-s.at>45000||now<s.at)s.rules.forEach(r=>{r.bad=0;r.good=0;});s.at=now;if(!p.enabled){s.rules.forEach(r=>{r.bad=0;r.good=0;});this.save(s);return;}
 // Work on a copy; capacity failures cannot partially recover an incident without its notification.
 const draft:State=structuredClone(s);
 try{for(const [code,bad] of Object.entries(values) as [MonitorCode,boolean|null][]){if(!monitorCodes.includes(code))continue;const r=draft.rules.find(x=>x.code===code)!;if(bad===null){r.bad=0;r.good=0;continue;}r.bad=bad?Math.min(30,r.bad+1):0;r.good=bad?0:Math.min(30,r.good+1);const incident=draft.incidents.find(x=>x.code===code&&x.recovered_at===null);
 if(bad&&!incident&&(immediate||r.bad>=p.trigger_samples)){this.trim(draft,1);const i:MonitorIncident={id:randomUUID(),code,opened_at:now,recovered_at:null};draft.incidents.push(i);draft.notifications.push(this.notification(i,'alert',now));}
 if(!bad&&incident&&(immediate||r.good>=p.recover_samples)){this.trim(draft,1);incident.recovered_at=Math.max(now,incident.opened_at);draft.notifications.push(this.notification(incident,'recovery',now));}
 }draft.fault=null;this.save(draft);}catch(error){if(error instanceof Error&&error.message==='MONITOR_CAPACITY'){s.fault='MONITOR_CAPACITY';this.save(s);return;}throw error;}
 }
 private notification(i:MonitorIncident,kind:'alert'|'recovery',at:number):MonitorNotification{return {id:randomUUID(),incident_id:i.id,code:i.code,kind,created_at:at,status:'pending',attempts:0,next_at:at,delivered_at:null};}
 test(){const s=readState(this.root,this.host),at=this.now();this.trim(s,1);const n:MonitorNotification={id:randomUUID(),incident_id:null,code:'TEST',kind:'test',created_at:at,status:'pending',attempts:0,next_at:at,delivered_at:null};s.notifications.push(n);this.save(s);return {queued:true,id:n.id,channel:'local-mock'};}
 retryDead(){if(this.active)throw Error('通知正在交付，請稍後重試。');const s=readState(this.root,this.host);let retried=0;for(const n of s.notifications)if(n.status==='dead'){n.status='pending';n.attempts=0;n.next_at=this.now();retried++;}this.save(s);return {retried};}
 drain(){if(this.stopped)return Promise.resolve();if(this.active)return this.active;this.active=this.deliver().finally(()=>{this.active=null;});return this.active;}
 private async deliver(){for(let count=0;count<20&&!this.stopped;count++){
 let s=readState(this.root,this.host);
 // A dead alert blocks its recovery; another incident may still deliver.
 const ready=s.notifications.find(x=>x.status==='pending'&&x.next_at!<=this.now()&&!s.notifications.slice(0,s.notifications.indexOf(x)).some(y=>y.incident_id!==null&&y.incident_id===x.incident_id&&y.status!=='delivered'));
 if(!ready)return;const id=ready.id;let ok=false;try{await this.transport.deliver(structuredClone(ready),structuredClone(s.notifications));ok=true;}catch{}
 // Observations may have appended while a transport was awaiting. Never overwrite newer state.
 s=readState(this.root,this.host);const current=s.notifications.find(x=>x.id===id);if(!current||current.status!=='pending')throw Error('通知交付狀態變更。');current.attempts++;if(ok){current.status='delivered';current.delivered_at=this.now();current.next_at=null;}else if(current.attempts>=5){current.status='dead';current.next_at=null;}else current.next_at=this.now()+Math.min(300000,5000*2**(current.attempts-1));this.save(s);
 }}
 async close(){this.stopped=true;await this.active;}
}
export function freeMonitorBytes(root:string){const s=statfsSync(safePath(root));return Number(BigInt(s.bavail)*BigInt(s.bsize));}
export type MonitorTelemetry={at:number;healthy:boolean;errors:number;queued:number;max:number};
type BackupMetric={available:boolean;enabled:boolean;time:string;last_success_at:number|null;last_error:string|null;retention_warning:boolean;unmanaged:number};
export class MonitorSampler{
 private baseline:{instance:string;errors:number}|null=null;
 private errors:{at:number;count:number}[]=[];
 sample(now:number,p:MonitorPolicy,b:BackupMetric,free:number,service:{phase:string;busy:boolean;instance?:string;telemetry?:MonitorTelemetry}):Partial<Record<MonitorCode,boolean|null>>{
  const t=service.telemetry,known=service.phase==='running'&&!service.busy&&!!t&&now-t.at<45000&&t.at<=now;
  if(known&&t&&service.instance){if(this.baseline?.instance===service.instance){const count=Math.max(0,t.errors-this.baseline.errors);if(count)this.errors.push({at:now,count});}this.baseline={instance:service.instance,errors:t.errors};}
  this.errors=this.errors.filter(x=>now-x.at<300000&&x.at<=now);
  const today=taipeiDay(now),due=Date.parse(today+'T'+b.time+':00+08:00');
  return {DISK_LOW:free<p.min_free_mb*1024*1024,BACKUP_FAILED:!b.available||!!b.last_error,BACKUP_RETENTION:b.retention_warning||b.unmanaged>0,BACKUP_OVERDUE:b.enabled&&now>due+p.backup_late_minutes*60000&&(b.last_success_at===null||taipeiDay(b.last_success_at)<today),QUEUE_ERRORS:known?this.errors.reduce((n,x)=>n+x.count,0)>=p.queue_errors:null,QUEUE_PRESSURE:known&&t?t.queued>=t.max:null,TELEMETRY_UNAVAILABLE:service.phase==='running'&&!service.busy?(!known||!t?.healthy):null};
 }
}
