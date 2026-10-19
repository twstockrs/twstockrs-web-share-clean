export type JobProgress={running:boolean;position:number|null};
export function trackJob(client_request_id:string,signal:AbortSignal,fetcher:typeof fetch,onProgress?:((value:JobProgress)=>void),delay=500){
 if(!onProgress)return ()=>{};
 const controller=new AbortController();let closed=false,timer:ReturnType<typeof setTimeout>;
 const stop=()=>{closed=true;clearTimeout(timer);controller.abort();signal.removeEventListener('abort',stop)};
 const poll=async()=>{try{const response=await fetcher('/api/v1/jobs/status',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({client_request_id}),signal:controller.signal,cache:'no-store',credentials:'same-origin'});if(response.ok){const value=await response.json();if(!closed&&typeof value.running==='boolean'&&(value.position===null||Number.isInteger(value.position)&&value.position>=0&&value.position<=17))onProgress({running:value.running,position:value.position})}}catch{}finally{if(!closed)timer=setTimeout(poll,delay)}};
 if(signal.aborted)return ()=>{};signal.addEventListener('abort',stop,{once:true});timer=setTimeout(poll,delay);return stop;
}
