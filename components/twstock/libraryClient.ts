import {apiFetch} from './authClient';
import {AnalysisError} from '../../shared/mockAnalysis';
import {decodeLibrarySnapshot,record,type LibrarySnapshot} from '../../shared/libraryContract';
import {analysisIssues,catalog,type Plan} from './model';
import type {SourceLoadResult} from './sourceLoad';
import {decodeRuntimeData} from '../../shared/rsContract';
export class LibraryClient{
 constructor(private fetcher:typeof fetch=(...args)=>apiFetch(...args),private timeoutMs=8000){}
 async call(operation:string,plan:Plan,input:Record<string,unknown>={}):Promise<{snapshot:LibrarySnapshot;value:Record<string,unknown>}>{
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),this.timeoutMs);
  try{
   const response=await this.fetcher('/api/v1/library/'+operation,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mock_plan:plan,...input}),credentials:'same-origin',cache:'no-store',signal:controller.signal});
   const text=await response.text();if(controller.signal.aborted)throw Error('deadline exceeded');if(text.length>8*1024*1024)throw Error('response too large');
   let value:unknown;try{value=JSON.parse(text)}catch{throw Error('invalid response')}
   if(!response.ok){const error=record(value)&&record(value.error)?value.error:null;throw new AnalysisError(typeof error?.code==='string'?error.code:'STORAGE_UNAVAILABLE',typeof error?.message==='string'&&error.message.length<=500?error.message:'本機後端儲存服務暫時無法完成操作。',response.status)}
   if(!record(value))throw Error('invalid response');
   return {snapshot:decodeLibrarySnapshot(value.snapshot,plan),value};
  }catch(error){if(error instanceof AnalysisError)throw error;throw new AnalysisError('STORAGE_UNAVAILABLE','無法確認後端操作結果。請重新讀取清單核對後，再進行其他操作。',503)}
  finally{clearTimeout(timer)}
 }
}
export function decodeSourceResult(value:unknown,plan:Plan):SourceLoadResult{
 if(!record(value))throw Error('後端載入回應格式不正確。');
 if(value.type==='blocked'&&Array.isArray(value.issues)&&value.issues.every(issue=>typeof issue==='string'&&issue.length<=500))return value as SourceLoadResult;
 if(value.type==='ready'&&record(value.state)){
  const state=value.state as unknown as Extract<SourceLoadResult,{type:'ready'}>['state'];
  try{if(state.runtime)state.runtime=decodeRuntimeData(state.runtime,state.market);if(state.plan===plan&&Array.isArray(state.currentList)&&new Set(state.currentList).size===state.currentList.length&&analysisIssues(state).length===0)return {type:'ready',state:{...state,selectedEntity:null,hoveredId:null,statusOverrides:{},filter:'All'}}}catch{}
 }
 if(value.type==='choose'&&typeof value.title==='string'&&Array.isArray(value.ids)&&value.ids.every(id=>typeof id==='string'&&catalog.some(e=>e.id===id))&&value.limit===(plan==='Free'?20:plan==='Anonymous'?5:100))return {type:'choose',title:value.title,ids:value.ids,entities:value.ids.map(id=>catalog.find(e=>e.id===id)!),limit:value.limit as number};
 if(value.type==='choose'&&typeof value.title==='string'&&value.title.length<=100&&Array.isArray(value.ids)&&value.ids.length<=100&&new Set(value.ids).size===value.ids.length&&Array.isArray(value.entities)&&value.entities.length===value.ids.length&&value.entities.every((e,i)=>record(e)&&e.id===(value.ids as unknown[])[i]&&typeof e.id==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(e.id)&&typeof e.name==='string'&&e.name.length<=120&&['TWSE','TPEx'].includes(String(e.market))&&Array.isArray(e.points)&&!e.points.length)&&value.limit===(plan==='Free'?20:plan==='Anonymous'?5:100))return value as SourceLoadResult;
 throw Error('後端載入回應格式不正確。');
}
