import './build-server.mjs';
import {spawn} from 'node:child_process';
import {createServer} from 'vite';
const api=spawn(process.execPath,['server-dist/main.mjs'],{stdio:['inherit','inherit','inherit','ipc'],env:process.env});
let vite,stopping=false;
async function stop(code=0){if(stopping)return;stopping=true;await vite?.close();if(api.exitCode===null&&api.signalCode===null){await new Promise(resolve=>{const timer=setTimeout(()=>{api.kill();resolve()},5000);api.once('exit',()=>{clearTimeout(timer);resolve()});if(api.connected)api.send({type:'stop'});else api.kill()})}process.exitCode=code}
const ready=new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>reject(Error('本機 API 啟動逾時。')),5000);
 api.once('message',message=>{clearTimeout(timer);if(message?.type==='ready')resolve();else reject(Error('本機 API 未準備好。'))});
 api.once('exit',()=>{clearTimeout(timer);reject(Error('本機 API 未啟動，請檢查埠號是否已被使用。'))});
 api.once('error',error=>{clearTimeout(timer);reject(error)});
});
api.on('exit',code=>{if(!stopping){console.error('本機 API 已停止，前端預覽一併結束。');void stop(code||1)}});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void stop());
try{await ready;if(!stopping){vite=await createServer();await vite.listen();vite.printUrls()}}
catch(error){console.error(error instanceof Error?error.message:error);await stop(1)}
