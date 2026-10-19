import {trackJob,type JobProgress} from './jobProgress';
import {apiFetch} from './authClient';
import {AnalysisError,decodeAnalysisResponse,type AnalysisRequest} from '../../shared/mockAnalysis';
import {decodeInputVersion,type InputVersion} from '../../shared/dataVersions';
import type {RuntimeData} from './model';
export async function verifyInputVersion(version:InputVersion,fetcher:typeof fetch=(...args)=>apiFetch(...args),timeoutMs=8000){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
 try{const response=await fetcher('/api/v1/versions/check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(version),signal:controller.signal,cache:'no-store',credentials:'same-origin'}),text=await response.text();if(controller.signal.aborted||text.length>10_000)throw Error();const value=JSON.parse(text);if(!response.ok)throw new AnalysisError(value.error?.code||'VERSION_UNAVAILABLE',typeof value.error?.message==='string'?value.error.message:'無法確認目前版本，請重新讀取。',response.status);const confirmed=decodeInputVersion(value.input_version,version.market);if(Object.keys(confirmed).some(k=>confirmed[k as keyof InputVersion]!==version[k as keyof InputVersion]))throw Error();return confirmed}
 catch(error){if(error instanceof AnalysisError)throw error;throw new AnalysisError('VERSION_UNAVAILABLE','無法確認行情輸入版本，已取消本次匯出；請確認後端連線再試。',503)}finally{clearTimeout(timer)}
}
export class AnalysisClient{
 private sequence=0;private prefix=globalThis.crypto.randomUUID();
 private controller:AbortController|null=null;
 constructor(private fetcher:typeof fetch=(...args)=>apiFetch(...args),private timeoutMs=8000,private onProgress?:((value:JobProgress)=>void)){}
 cancel(){this.sequence++;this.controller?.abort();this.controller=null}
 async load(input:AnalysisRequest,runtime?:RuntimeData){
  this.cancel();const sequence=this.sequence,controller=new AbortController();this.controller=controller;
  const request={...input,client_request_id:`local-${this.prefix}-${sequence}`};let timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;controller.abort()},this.timeoutMs),stopProgress=trackJob(request.client_request_id,controller.signal,this.fetcher,this.onProgress);
  try{
   const response=await this.fetcher('/api/v1/analyses',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:controller.signal,cache:'no-store',credentials:'same-origin'});
   if(sequence!==this.sequence)return null;
   const text=await response.text();if(sequence!==this.sequence)return null;
   if(timedOut)throw new AnalysisError('TIMEOUT','本機後端回應逾時，請重試。',504);
   if(text.length>(input.input_version?12*1024*1024:1_000_000))throw new AnalysisError('INVALID_RESPONSE','後端回應過大，請重試。',502);
   let value:unknown;try{value=JSON.parse(text)}catch{throw new AnalysisError('SERVICE_UNAVAILABLE','無法取得本機後端資料。請確認服務已啟動後重試。',503)}
   if(!response.ok){const error=(value as {error?:{message?:unknown;code?:unknown}})?.error;throw new AnalysisError(typeof error?.code==='string'?error.code:'SERVICE_UNAVAILABLE',typeof error?.message==='string'&&error.message.length<=500?error.message:'本機後端暫時無法完成分析。',response.status)}
   return decodeAnalysisResponse(value,request,runtime);
  }catch(error){
   if(sequence!==this.sequence)return null;
   if(timedOut)throw new AnalysisError('TIMEOUT','本機後端回應逾時，請重試。',504);
   if(error instanceof AnalysisError)throw error;
   throw new AnalysisError('SERVICE_UNAVAILABLE','無法連線至本機後端。請確認服務已啟動後重試。',503);
  }finally{stopProgress();clearTimeout(timer);if(sequence===this.sequence)this.controller=null}
 }
}
