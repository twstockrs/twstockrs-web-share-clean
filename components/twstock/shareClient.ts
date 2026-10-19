import {apiFetch} from './authClient';
export async function shareApi(path:string,body?:unknown){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
 try{const response=await apiFetch('/api/v1/shares/'+path,{method:body===undefined?'GET':'POST',...(body!==undefined?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),signal:controller.signal,cache:'no-store',credentials:'same-origin'}),text=await response.text();if(text.length>13*1024*1024)throw Error('分享資料超過上限。');const value=JSON.parse(text);if(!response.ok)throw Error(value.error?.message||'分享操作未完成。');return value}
 catch(error){if(controller.signal.aborted)throw Error('分享服務回應逾時，請重試；既有分享仍保留。');throw error}finally{clearTimeout(timer)}
}
