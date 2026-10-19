import {decodeAuthSession,type AuthSession} from '../../shared/authContract';
import {createAnalysisRequest,requestKey} from '../../shared/mockAnalysis';
import type {AnalysisState} from './model';
let current:AuthSession|null=null,epoch=0;
export function configureAuth(session:AuthSession|null){if(current?.owner!==session?.owner||current?.rights!==session?.rights||current?.csrf!==session?.csrf)epoch++;current=session}
export const apiFetch:typeof fetch=async(input,init)=>{
 const session=current,started=epoch;
 if(!session||typeof input!=='string'||!input.startsWith('/api/v1/'))return globalThis.fetch(input,init);
 const headers=new Headers(init?.headers);headers.set('X-Workspace-Id',session.owner);headers.set('X-Auth-Rights',session.rights);if((init?.method||'GET')!=='GET')headers.set('X-CSRF-Token',session.csrf);
 const response=await globalThis.fetch(input,{...init,headers,credentials:'same-origin'});
 if(started!==epoch)throw Error('帳號或方案已變更，本次回應已取消。');
 if(response.headers.get('X-Auth-Changed')==='1'&&typeof window!=='undefined')window.dispatchEvent(new Event('twstockrs-auth-refresh'));
 return response;
};
export async function loadAuth(){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000);try{const response=await globalThis.fetch('/api/v1/auth/session',{cache:'no-store',credentials:'same-origin',signal:controller.signal});if(!response.ok)throw Error('帳號服務尚未就緒。');return decodeAuthSession((await response.json()).session)}finally{clearTimeout(timer)}}
export async function authAction(action:'login'|'logout',input:unknown){const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);try{const response=await apiFetch('/api/v1/auth/'+action,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:controller.signal}),value=await response.json();if(!response.ok)throw Error(value.error?.message||'帳號操作未完成。');return action==='login'?decodeAuthSession(value.session):null}finally{clearTimeout(timer)}}
export async function verifyExportAccess(state:AnalysisState,format:'PNG'|'CSV'){
 const request=createAnalysisRequest(state,'export-authorize'),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000),started=epoch;
 try{const response=await apiFetch('/api/v1/exports/authorize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({format,analysis:request}),signal:controller.signal}),value=await response.json();if(!response.ok)throw Error(value.error?.message||'匯出權限未確認。');if(started!==epoch||value.rights!==current?.rights||value.format!==format||value.request_key!==requestKey(request))throw Error('帳號或匯出條件已變更，已取消下載。')}finally{clearTimeout(timer)}
}
