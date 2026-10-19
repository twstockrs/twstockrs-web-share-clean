import {apiFetch} from './authClient';
import {AnalysisError} from '../../shared/mockAnalysis';
import {decodeVersionComparison,type ComparisonRequest} from '../../shared/versionComparison';
export async function fetchVersionComparison(request:ComparisonRequest,signal:AbortSignal,fetcher:typeof fetch=(...args)=>apiFetch(...args)){
 try{const response=await fetcher('/api/v1/versions/compare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal,cache:'no-store',credentials:'same-origin'}),text=await response.text();if(signal.aborted||text.length>4_000_000)throw Error();const value=JSON.parse(text);if(!response.ok)throw serviceError(value,response.status);return decodeVersionComparison(value.comparison,request)}catch(error){if(error instanceof AnalysisError)throw error;throw new AnalysisError('COMPARISON_UNAVAILABLE','無法確認資料版本差異，請重新讀取後比較。',503)}
}
function serviceError(value:unknown,status:number){const error=(value as {error?:{code?:unknown;message?:unknown}}|null)?.error;return new AnalysisError(typeof error?.code==='string'&&error.code.length<96?error.code:'COMPARISON_UNAVAILABLE',typeof error?.message==='string'&&error.message.length<=500?error.message:'資料版本比較未完成。',status)}
export async function fetchComparisonReport(request:ComparisonRequest,comparisonId:string,signal:AbortSignal,fetcher:typeof fetch=(...args)=>apiFetch(...args)){
 const {offset,limit,...body}=request;try{
  const response=await fetcher('/api/v1/versions/compare/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal,cache:'no-store',credentials:'same-origin'});
  if(!response.ok){const text=await response.text();if(text.length>4_000_000)throw Error();throw serviceError(JSON.parse(text),response.status)}
  const declared=Number(response.headers.get('Content-Length')),filename=response.headers.get('Content-Disposition')?.match(/^attachment; filename="(TWStockRS-version-diff-(?:TWSE|TPEx)-[a-f0-9]{12}-r\d+\.json)"$/)?.[1],expected=response.headers.get('X-Report-SHA256');if(!Number.isSafeInteger(declared)||declared<1||declared>64*1024*1024||!filename||response.headers.get('X-Comparison-Id')!==comparisonId||!expected||!/^[a-f0-9]{64}$/.test(expected))throw Error();
  const data=await response.arrayBuffer();if(signal.aborted||data.byteLength!==declared||data.byteLength>64*1024*1024)throw Error();const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');if(signal.aborted||digest!==expected)throw Error();return {blob:new Blob([data],{type:'application/json;charset=utf-8'}),filename};
 }catch(error){if(error instanceof AnalysisError)throw error;throw new AnalysisError('COMPARISON_REPORT_UNCONFIRMED','差異報告未通過核對，未送出下載；請重新比較後再試。',503)}
}
