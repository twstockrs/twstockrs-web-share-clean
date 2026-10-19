import {trackJob,type JobProgress} from './jobProgress';
import {apiFetch} from './authClient';
import {verifyInputVersion} from './analysisClient';
import {AnalysisError,type AnalysisRequest} from '../../shared/mockAnalysis';
import {decodePlayback,playbackKey} from '../../shared/playback';
import type {RuntimeData} from './model';
export class PlaybackClient{
 private prefix=globalThis.crypto.randomUUID();private generation=0;private key='';private pending:Promise<ReturnType<typeof decodePlayback>>|null=null;private controller:AbortController|null=null;
 constructor(private fetcher:typeof fetch=(...args)=>apiFetch(...args),private timeoutMs=8000,private onProgress?:((value:JobProgress)=>void)){}
 cancel(){this.generation++;this.key='';this.pending=null;this.controller?.abort();this.controller=null}
 async load(input:AnalysisRequest,runtime:RuntimeData){const key=playbackKey(input);if(key!==this.key){this.cancel();this.key=key;const generation=this.generation,controller=new AbortController();this.controller=controller;this.pending=(async()=>{const client_request_id=`playback-${this.prefix}-${generation}`,timer=setTimeout(()=>controller.abort(),this.timeoutMs),stopProgress=trackJob(client_request_id,controller.signal,this.fetcher,this.onProgress);try{const response=await this.fetcher('/api/v1/playback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...input,client_request_id,viewing_date:'Latest'}),credentials:'same-origin',cache:'no-store',signal:controller.signal}),text=await response.text();if(text.length>64*1024*1024)throw Error('播放資料過大。');const value=JSON.parse(text);if(!response.ok)throw new AnalysisError(value.error?.code||'PLAYBACK_FAILED',value.error?.message||'無法取得播放資料。',response.status);return decodePlayback(value,{...input,viewing_date:'Latest'},runtime)}finally{stopProgress();clearTimeout(timer)}})().catch(error=>{if(this.generation===generation){this.key='';this.pending=null}throw error})}
 const pending=this.pending!,batch=await pending;await verifyInputVersion(runtime.input,this.fetcher,this.timeoutMs);if(this.key!==key||this.pending!==pending)return null;return batch.at(input);
 }
}
