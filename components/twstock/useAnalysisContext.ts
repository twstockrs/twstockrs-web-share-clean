import {historyEndpointLimit} from '../../shared/historyPolicy';
import {apiFetch} from './authClient';
import {useEffect,useState} from 'react';
import {decodeRuntimeData} from '../../shared/rsContract';
import {decodeInputVersion} from '../../shared/dataVersions';
import {AnalysisError} from '../../shared/mockAnalysis';
import type {Plan,RuntimeData} from './model';
export async function fetchAnalysisContext(market:string,plan:Plan,signal:AbortSignal,fetcher:typeof fetch=(...args)=>apiFetch(...args)){
 try{const response=await fetcher('/api/v1/analysis-context',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({market,mock_plan:plan}),signal,cache:'no-store',credentials:'same-origin'}),text=await response.text();
 if(signal.aborted||text.length>8*1024*1024)throw Error('市場資料回應未確認。');const value=JSON.parse(text);
 if(!response.ok)throw new AnalysisError(typeof value?.error?.code==='string'&&value.error.code.length<=96?value.error.code:'CONTEXT_UNAVAILABLE',typeof value?.error?.message==='string'&&value.error.message.length<=500?value.error.message:'無法取得市場資料。',response.status);
 const input=decodeInputVersion(value.input_version,market);
 if(value.runtime===null){if(input.release_id)throw Error('啟用狀態與市場資料不同。');return undefined}
 const runtime=decodeRuntimeData(value.runtime,market);if(Object.keys(input).some(k=>input[k as keyof typeof input]!==runtime.input[k as keyof typeof input])||runtime.Daily.length>historyEndpointLimit(plan,'Daily')||runtime.Weekly.length>historyEndpointLimit(plan,'Weekly')||plan!=='Pro'&&runtime.Weekly.length)throw Error('市場資料與方案或版本不同。');return runtime;}catch(error){if(error instanceof AnalysisError)throw error;throw new AnalysisError('CONTEXT_UNAVAILABLE',signal.aborted?'取得市場資料逾時或已取消，請重試。':'無法確認市場資料，請重新讀取或檢查本機後端連線。',503)}
}
export function useAnalysisContext(market:string,plan:Plan,offline:boolean){
 const [revision,setRevision]=useState(0),key=`${market}|${plan}|${revision}`;
 const [value,setValue]=useState<{key:string;runtime?:RuntimeData;ready:boolean;error:string}>({key:'',ready:false,error:''});
 useEffect(()=>{if(offline)return;const controller=new AbortController();let active=true;const timer=setTimeout(()=>controller.abort(),8000);setValue({key,ready:false,error:''});
  fetchAnalysisContext(market,plan,controller.signal).then(runtime=>{if(active)setValue({key,runtime,ready:true,error:''})}).catch(error=>{if(active)setValue({key,ready:false,error:error instanceof Error?error.message:'無法取得目前市場版本。'})}).finally(()=>clearTimeout(timer));
  return()=>{active=false;controller.abort();clearTimeout(timer)};
 },[key,market,plan,offline]);
 return {runtime:value.key===key?value.runtime:undefined,ready:offline||value.key===key&&value.ready,error:value.key===key?value.error:'',refresh:()=>setRevision(n=>n+1)};
}
