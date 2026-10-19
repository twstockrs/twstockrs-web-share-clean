import {apiFetch} from './authClient';
import {AnalysisError} from '../../shared/mockAnalysis';
export async function maintenanceRequest(group:'imports'|'versions'|'admin',operation:string,input:Record<string,unknown>={},fetcher:typeof fetch=(...args)=>apiFetch(...args),timeoutMs=30_000){
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),timeoutMs);
 try{
  const response=await fetcher('/api/v1/'+group+'/'+operation,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),credentials:'same-origin',cache:'no-store',signal:abort.signal}),text=await response.text();
  if(abort.signal.aborted||text.length>4_000_000)throw Error();const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw Error();
  if(!response.ok)throw new AnalysisError(typeof value.error?.code==='string'?value.error.code:'MAINTENANCE_ERROR',typeof value.error?.message==='string'&&value.error.message.length<=500?value.error.message:'本機維護服務無法完成操作。',response.status);
  return value as Record<string,unknown>;
 }catch(error){if(error instanceof AnalysisError)throw error;throw new AnalysisError('MAINTENANCE_UNCONFIRMED','無法確認本機維護操作結果。請重新讀取批次及版本記錄核對，再繼續操作。',503)}finally{clearTimeout(timer)}
}
