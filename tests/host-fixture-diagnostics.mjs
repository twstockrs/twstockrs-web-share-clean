import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import path from 'node:path';

// This observer is prepended only to copied synthetic fixtures.
// Preserve emit's boolean and listener counts: error listeners can change
// default handling, including whether an unhandled error terminates a child.
function observeFixture(http,append,file,label,Database,commitDelayMs,responseHoldMs){
 const note=(event,details={})=>{try{append(file,JSON.stringify({at:new Date().toISOString(),pid:process.pid,label,event,...details})+'\n',{mode:0o600})}catch{}};
 const code=e=>typeof e?.code==='string'&&/^[A-Z0-9_]{1,60}$/.test(e.code)?e.code:'UNSPECIFIED';
 if(commitDelayMs){
  const prototype=Database.prototype,prepare=prototype.prepare,exec=prototype.exec,dirty=new WeakMap(),waiter=new Int32Array(new SharedArrayBuffer(4));
  const committed=(db,changed,kind)=>{if(!changed)return;if(dirty.has(db))dirty.set(db,true);else{note('SIMULATED_COMMIT',{blocking_ms:commitDelayMs,kind});Atomics.wait(waiter,0,0,commitDelayMs)}};
  prototype.prepare=function(sql,...rest){const db=this,statement=prepare.call(db,sql,...rest),run=statement.run;
   if(/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql))statement.run=function(...args){const value=run.apply(this,args);committed(db,Number(value.changes)>0,'autocommit');return value};return statement};
  prototype.exec=function(sql){const wasTransaction=dirty.has(this),hadWrites=dirty.get(this),value=exec.call(this,sql);
   if(/^\s*BEGIN\b/i.test(sql))dirty.set(this,false);
   if(/^\s*(COMMIT|END)\b/i.test(sql)){dirty.delete(this);if(wasTransaction&&hadWrites)committed(this,true,'transaction')}
   else if(/^\s*ROLLBACK\b/i.test(sql))dirty.delete(this);
   else if(/^\s*(INSERT|UPDATE|DELETE)\b/i.test(sql))committed(this,Number(prepare.call(this,'SELECT changes() AS n').get().n)>0,'autocommit');
   return value};
 }
 const create=http.createServer;
 http.createServer=function(...args){
  const server=create.apply(this,args),emit=server.emit;
  server.emit=function(event,...values){
   if(event==='clientError')note('CLIENT_ERROR',{code:code(values[0])});
   if(event==='error')note('SERVER_ERROR',{code:code(values[0])});
   if(event==='drop')note('CONNECTION_DROP');
   if(event==='connection'){
    const socket=values[0],socketEmit=socket.emit;
    socket.emit=function(name,...data){if(name==='error')note('SOCKET_ERROR',{code:code(data[0])});return socketEmit.call(this,name,...data)};
   }
   if(event==='request'){
    const [request,response]=values,requestEmit=request.emit,responseEmit=response.emit;
    const route=String(request.url||'').split('?')[0],known=/^\/api\/v1\/[a-z/-]+$/.test(route)?route:'OTHER';
    if(responseHoldMs&&route==='/api/v1/library/edit'){
     const end=response.end;let held=false;
     response.end=function(...args){if(held)return end.apply(this,args);held=true;note('RESPONSE_HELD',{route:known,hold_ms:responseHoldMs});setTimeout(()=>end.apply(this,args),responseHoldMs);return this};
    }
    request.emit=function(name,...data){if(name==='error')note('REQUEST_ERROR',{route:known,code:code(data[0])});if(name==='aborted')note('REQUEST_ABORTED',{route:known});return requestEmit.call(this,name,...data)};
    response.emit=function(name,...data){if(name==='close'&&!response.writableFinished)note('INCOMPLETE_RESPONSE',{route:known,method:request.method,request_complete:request.complete,request_aborted:request.aborted,headers_sent:response.headersSent,status:response.statusCode});return responseEmit.call(this,name,...data)};
   }
   return emit.call(this,event,...values);
  };
  const closeAll=server.closeAllConnections;
  server.closeAllConnections=function(...args){note('CLOSE_ALL_CONNECTIONS');return closeAll.apply(this,args)};
  return server;
 };
 process.on('uncaughtExceptionMonitor',error=>note('UNCAUGHT_EXCEPTION',{code:code(error),name:error.name}));
 process.on('disconnect',()=>note('PARENT_DISCONNECTED'));
 process.on('exit',exit_code=>note('PROCESS_EXIT',{exit_code}));
}
export function instrumentHostFixture(stage,file,label,commitDelayMs=0,responseHoldMs=0){
 const target=path.join(stage,'runtime','serve.mjs');
 const prefix="import __twrsDiagHttp from 'node:http';\nimport {appendFileSync as __twrsDiagAppend} from 'node:fs';\nimport {DatabaseSync as __twrsDiagDatabase} from 'node:sqlite';\n("+observeFixture.toString()+')(__twrsDiagHttp,__twrsDiagAppend,'+JSON.stringify(file)+','+JSON.stringify(label)+',__twrsDiagDatabase,'+Number(commitDelayMs)+','+Number(responseHoldMs)+');\n';
 writeFileSync(target,prefix+readFileSync(target,'utf8'));
}
export function fixtureDiagnostics(file){
 if(!existsSync(file))return [];
 return readFileSync(file,'utf8').trim().split('\n').slice(-40).map(line=>{try{return JSON.parse(line)}catch{return {event:'UNPARSEABLE'}}});
}
