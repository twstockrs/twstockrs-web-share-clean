import {Worker} from 'node:worker_threads';
import {randomUUID} from 'node:crypto';
import {AnalysisError} from '../shared/mockAnalysis';

declare const __TWSTOCKRS_RS_WORKER__:string;
let sourcePromise:Promise<string>|undefined;
async function workerSource(){
 if(typeof __TWSTOCKRS_RS_WORKER__!=='undefined')return __TWSTOCKRS_RS_WORKER__;
 // Unbundled test/source harness only. The built server embeds its worker.
 return sourcePromise??=(async()=>{const moduleName='esbuild',compiler=await import(moduleName);const result=await compiler.build({entryPoints:['server/rsWorker.ts'],bundle:true,write:false,platform:'node',format:'cjs',target:'node22',logLevel:'silent'});return result.outputFiles[0].text})();
}
type Task={id:string;owner:string;client:string;operation:string;input:unknown;requestId:string;guard:()=>void;signal?:AbortSignal;enqueued:number;started:number;resolve:(value:any)=>void;reject:(error:unknown)=>void;timer:ReturnType<typeof setTimeout>;abort:()=>void;watch:ReturnType<typeof setInterval>};
export type QueueOptions={maxQueued?:number;maxPerOwner?:number;timeoutMs?:number;waitMs?:number;source?:string};
export class WorkQueue{
 private worker:Worker|null=null;private starting:Promise<void>|null=null;private stopping:Promise<unknown>|null=null;private active:Task|null=null;private waiting:Task[]=[];private closed=false;private lastOwner='';private owners:string[]=[];
 private counts={completed:0,cancelled:0,timed_out:0,failed:0,rejected:0};
 private maxQueued:number;private maxPerOwner:number;private timeoutMs:number;private waitMs:number;
 constructor(private filename:string,private options:QueueOptions={}){this.maxQueued=options.maxQueued??16;this.maxPerOwner=options.maxPerOwner??3;this.timeoutMs=options.timeoutMs??7500;this.waitMs=options.waitMs??4000;for(const n of [this.maxQueued,this.maxPerOwner,this.timeoutMs,this.waitMs])if(!Number.isInteger(n)||n<1)throw Error('Invalid queue limits')}
 run(operation:string,input:unknown,requestId:string,owner:string,guard:()=>void,signal?:AbortSignal,client=''){
  if(this.closed)return Promise.reject(new AnalysisError('SERVICE_STOPPING','服務正在停止，請稍後重試。',503));
  if(signal?.aborted)return Promise.reject(new AnalysisError('JOB_CANCELLED','本次運算已取消。',499));
  const ownerCount=this.waiting.filter(t=>t.owner===owner).length+Number(this.active?.owner===owner);
  if(this.waiting.length>=this.maxQueued||ownerCount>=this.maxPerOwner){this.counts.rejected++;return Promise.reject(new AnalysisError('QUEUE_FULL','目前等候運算較多，請稍後重試；分析條件與清單仍保留。',429))}
  return new Promise<any>((resolve,reject)=>{const task:Task={id:randomUUID(),owner,client,operation,input,requestId,guard,signal,enqueued:performance.now(),started:0,resolve,reject,timer:null as any,watch:null as any,abort:()=>{}};task.abort=()=>this.cancel(task,new AnalysisError('JOB_CANCELLED','本次運算已取消。',499),'cancelled');task.timer=setTimeout(()=>this.cancel(task,new AnalysisError(task.started?'JOB_TIMEOUT':'QUEUE_TIMEOUT',task.started?'本次背景運算逾時，請重試。':'等候運算逾時，請稍後重試。',504),'timed_out'),Math.min(this.timeoutMs,this.waitMs));signal?.addEventListener('abort',task.abort,{once:true});task.watch=setInterval(()=>{try{task.guard()}catch(error){this.cancel(task,error instanceof AnalysisError?error:new AnalysisError('JOB_INVALIDATED','運算條件已變更，請重新取得結果。',409),'cancelled')}},250);this.waiting.push(task);if(!this.owners.includes(owner))this.owners.push(owner);void this.dispatch()});
 }
 private finish(task:Task,error:unknown,value?:unknown){clearTimeout(task.timer);clearInterval(task.watch);task.signal?.removeEventListener('abort',task.abort);if(error)task.reject(error);else task.resolve(value)}
 private cancel(task:Task,error:AnalysisError,count:'cancelled'|'timed_out'){
  if(this.active===task){this.active=null;this.counts[count]++;this.finish(task,error);this.retire();return}
  const i=this.waiting.indexOf(task);if(i>=0){this.waiting.splice(i,1);this.counts[count]++;this.finish(task,error);void this.dispatch()}
 }
 private retire(){const worker=this.worker;this.worker=null;if(worker)this.stopping=worker.terminate().catch(()=>{}).finally(()=>{this.stopping=null;void this.dispatch()});else void this.dispatch()}
 private async ensure(){if(this.worker||this.closed)return;if(this.starting)return this.starting;this.starting=(async()=>{if(this.stopping)await this.stopping;const source=this.options.source??await workerSource();if(this.closed)return;const worker=new Worker(source,{eval:true,workerData:{filename:this.filename},resourceLimits:{maxOldGenerationSizeMb:512},stderr:true,stdout:true});this.worker=worker;worker.stdout?.resume();worker.stderr?.resume();worker.on('message',message=>{if(this.worker!==worker||!this.active||message.id!==this.active.id)return;const task=this.active;if(performance.now()-task.enqueued>=this.timeoutMs){this.cancel(task,new AnalysisError('JOB_TIMEOUT','本次背景運算逾時，請重試。',504),'timed_out');return}this.active=null;if(message.error){this.counts.failed++;this.finish(task,new AnalysisError(message.error.code,message.error.message,message.error.status))}else{try{task.guard();this.counts.completed++;this.finish(task,null,message.value)}catch(error){this.counts.failed++;this.finish(task,error)}}void this.dispatch()});worker.on('error',()=>this.broken(worker));worker.on('exit',()=>this.broken(worker));})();try{await this.starting}finally{this.starting=null}}
 private broken(worker:Worker){if(this.worker!==worker)return;this.worker=null;if(this.active){const task=this.active;this.active=null;this.counts.failed++;this.finish(task,new AnalysisError('WORKER_FAILED','背景運算中斷，請重新取得結果；清單與設定仍保留。',503))}void this.dispatch()}
 private async dispatch(){if(this.closed||this.active||!this.waiting.length)return;try{await this.ensure()}catch{const tasks=this.waiting.splice(0);for(const task of tasks){this.counts.failed++;this.finish(task,new AnalysisError('WORKER_UNAVAILABLE','背景運算尚未就緒，請確認服務後重試。',503))}return}if(this.closed||this.active||!this.worker||this.stopping)return;
  this.owners=this.owners.filter(owner=>this.waiting.some(t=>t.owner===owner));if(this.owners.length>1&&this.owners[0]===this.lastOwner)this.owners.push(this.owners.shift()!);const owner=this.owners.shift(),index=this.waiting.findIndex(t=>t.owner===owner);if(index<0)return;const task=this.waiting.splice(index,1)[0];if(this.waiting.some(t=>t.owner===owner))this.owners.push(owner!);
  if(performance.now()-task.enqueued>this.waitMs){this.counts.timed_out++;this.finish(task,new AnalysisError('QUEUE_TIMEOUT','等候運算逾時，請稍後重試。',504));void this.dispatch();return}
  try{task.guard();task.started=performance.now();this.lastOwner=task.owner;this.active=task;clearTimeout(task.timer);task.timer=setTimeout(()=>this.cancel(task,new AnalysisError('JOB_TIMEOUT','本次背景運算逾時，請重試。',504),'timed_out'),Math.max(1,this.timeoutMs-(task.started-task.enqueued)));this.worker.postMessage({id:task.id,operation:task.operation,input:task.input,requestId:task.requestId})}catch(error){this.active=null;this.counts.failed++;this.finish(task,error);void this.dispatch()}
 }
 status(owner:string,client=''){const rows=[...(this.active?[this.active]:[]),...this.waiting].filter(t=>t.owner===owner&&(!client||t.client===client));return {running:rows.some(t=>t===this.active),queued:rows.filter(t=>t!==this.active).length,position:rows.length?Math.min(...rows.map(t=>t===this.active?0:this.waiting.indexOf(t)+1)):null}}
 metrics(){return {running:Number(!!this.active),queued:this.waiting.length,limits:{workers:1,max_queued:this.maxQueued,max_per_owner:this.maxPerOwner,timeout_ms:this.timeoutMs,wait_ms:this.waitMs},...this.counts}}
 async close(){if(this.closed)return;this.closed=true;for(const task of [...this.waiting,...(this.active?[this.active]:[])])this.finish(task,new AnalysisError('SERVICE_STOPPING','服務正在停止，請稍後重試。',503));this.waiting=[];this.owners=[];this.active=null;const worker=this.worker;this.worker=null;await this.starting?.catch(()=>{});await this.stopping;if(worker)await worker.terminate()}
}
