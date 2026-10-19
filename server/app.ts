import {createReadStream,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {requestOrigin,staticResponse} from './httpPolicy';
import {JsonBodyReader} from './requestBody';
import {timingSafeEqual} from 'node:crypto';
import {createConnectedBackup} from './systemBackup';
import {SnapshotCoordinator} from './snapshotCoordinator';
import {runSnapshotWorker,runArchiveWorker} from './snapshotRunner';
import {acquireDataLock} from './dataLock';
import http,{type IncomingMessage,type ServerResponse} from 'node:http';
import {randomUUID} from 'node:crypto';
import {AnalysisError,requestKey,type AnalysisRequest} from '../shared/mockAnalysis';
import {FrozenShareStore} from './frozenShareStore';
import {AuthStore} from './authStore';
import {AdminStore} from './adminStore';
import type {HostSummary} from '../shared/adminContract';
import type {AuthSession} from '../shared/authContract';
import {prepareShareRequest} from './shareAnalysis';
import {WorkQueue} from './workQueue';
import type {RuntimeData,Plan} from '../components/twstock/model';
import {exactFields,mockPlan} from '../shared/libraryContract';
declare const __TWSTOCKRS_SHARE_VIEWER__:string;
import {LibraryStore} from './libraryStore';
import {ImportStore} from './importStore';
import {ReleaseStore} from './releaseStore';
import type {VersionMarket} from '../shared/dataVersions';
function send(response:ServerResponse,status:number,value:unknown){response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(JSON.stringify(value))}
export function createMockServer(options:{databasePath?:string;importDatabasePath?:string;dataDirectory?:string;testOnlyMockAuth?:boolean;now?:()=>number;staticDirectory?:string;origin?:string;secureCookies?:boolean;deployment?:{release_id:string;instance_id:string;backup_protocol?:1};availability?:{ready:()=>boolean;probe:string};hostSummary?:()=>HostSummary}={}){
 const directory=options.dataDirectory?path.resolve(options.dataDirectory):undefined,unlock=directory?acquireDataLock(directory):()=>{};
 let library:LibraryStore;try{library=new LibraryStore(directory?path.join(directory,'library.sqlite'):options.databasePath)}catch(error){unlock();throw error}
 const temporaryImports=!directory&&(!options.importDatabasePath||options.importDatabasePath===':memory:')?mkdtempSync(path.join(tmpdir(),'twstockrs-worker-')):undefined;
 const importFilename=directory?path.join(directory,'imports.sqlite'):temporaryImports?path.join(temporaryImports,'imports.sqlite'):path.resolve(options.importDatabasePath!);
 let imports:ImportStore;try{imports=new ImportStore(importFilename)}catch(error){library.close();if(temporaryImports)rmSync(temporaryImports,{recursive:true,force:true});unlock();throw error}
 let versions:ReleaseStore;try{versions=new ReleaseStore(imports)}catch(error){imports.close();library.close();if(temporaryImports)rmSync(temporaryImports,{recursive:true,force:true});unlock();throw error}
 const auth=new AuthStore(library.connection,options.now,options.secureCookies),secure=!options.testOnlyMockAuth;
 const queue=new WorkQueue(importFilename),runtimes=new Map<string,RuntimeData|null>();
 const admin=new AdminStore(library.connection,imports.connection,auth,queue,options.now,options.hostSummary);
 const currentRuntime=(market:VersionMarket,plan:Plan)=>{const pin=versions.inputVersion(market);if(!pin.release_id)return;const runtime=runtimes.get(market+'|'+plan);if(!runtime||JSON.stringify(runtime.input)!==JSON.stringify(pin))throw new AnalysisError('INPUT_VERSION_CHANGED','行情條件已變更，請重新讀取。',409);return runtime};
 const shares=new FrozenShareStore(library.connection,Date.now,(snapshot,plan)=>{prepareShareRequest(snapshot,plan,currentRuntime(snapshot.request.market as VersionMarket,plan))});library.setRuntimeProvider(currentRuntime);
 const rememberRuntime=(value:{runtime:RuntimeData|null;input_version:unknown},plan:Plan)=>{versions.handle('check',value.input_version);const market=(value.input_version as {market:string}).market;runtimes.set(market+'|'+plan,value.runtime)};
 const bodies=new JsonBodyReader(),snapshots=new SnapshotCoordinator();
 const server=http.createServer({connectionsCheckingInterval:1_000,maxHeaderSize:16*1024},async(request,response)=>{
  const requestId=randomUUID();response.setHeader('X-Request-Id',requestId);
  response.setHeader('Referrer-Policy','no-referrer');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('X-Frame-Options','DENY');response.setHeader('Permissions-Policy','camera=(), microphone=(), geolocation=()');response.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  const cancellation=new AbortController(),cancel=()=>{if(!response.writableEnded)cancellation.abort()};response.once('close',cancel);
  let auditAction:string|null=null,auditActor:string|null=null,auditCode:string|null=null,auditSuccess=false;
  let lease:(()=>void)|undefined,handlerDone=false,responseDone=false;
  const releaseLease=()=>{if(handlerDone&&responseDone){lease?.();lease=undefined}};
  response.once('finish',()=>{try{if(auditAction&&(auditSuccess||response.statusCode>=400))admin.noteHttp(auditActor,auditAction,response.statusCode,auditCode,requestId)}finally{responseDone=true;releaseLease()}});
  response.once('close',()=>{responseDone=true;releaseLease()});
  try{
   const url=requestOrigin(request,options.origin);
   if(options.availability&&!options.availability.ready()){const supplied=request.headers['x-twrs-probe'];if(url.pathname!=='/api/v1/health'||typeof supplied!=='string'||!/^[a-f0-9]{64}$/.test(supplied)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(options.availability.probe))){send(response,503,{error:{code:'SERVICE_STARTING',message:'服務正在更新，請稍後重試。',request_id:requestId}});return}}
   if(options.staticDirectory&&!url.pathname.startsWith('/api/')){staticResponse(request,response,options.staticDirectory,url);return}
   if(!(request.method==='GET'&&url.pathname==='/api/v1/health'))lease=await snapshots.enter(cancellation.signal);
   const maintenanceAction=url.pathname.slice('/api/v1/'.length);if(['imports/stage','versions/create','versions/activate','versions/rollback','system/backup'].includes(maintenanceAction)){auditAction=maintenanceAction;auditSuccess=true}else if(url.pathname.startsWith('/api/v1/admin/'))auditAction='admin';else if(['/api/v1/analyses','/api/v1/playback','/api/v1/analysis-context','/api/v1/rs/analyses'].includes(url.pathname))auditAction='analysis';
   const needsAdmin=url.pathname.startsWith('/api/v1/admin/')||url.pathname.startsWith('/api/v1/imports/')||url.pathname.startsWith('/api/v1/versions/')&&url.pathname!=='/api/v1/versions/check';
   const publicRead=request.method==='GET'&&(url.pathname==='/api/v1/health'||url.pathname==='/api/v1/auth/session'||url.pathname.startsWith('/api/v1/shares/')&&!url.pathname.includes('/manage/'));
   let actor:AuthSession|undefined;
   if(secure&&!publicRead)actor=url.pathname==='/api/v1/system/backup'&&request.method==='GET'?auth.adminDownload(request):auth.guard(request,request.method!=='GET',needsAdmin);
   auditActor=actor?.account?.id||null;
   const readInput=async(limit?:number)=>{const value=await bodies.read(request,limit,cancellation.signal);if(secure)actor=auth.guard(request,true,needsAdmin,actor?.owner);return value};
   const planCheck=(value:unknown)=>{if(secure&&(!value||typeof value!=='object'||(value as {mock_plan?:unknown}).mock_plan!==actor?.plan))throw new AnalysisError('AUTH_CHANGED','帳號方案已變更或請求權益不符，請重新讀取。',409)};
   const fresh=()=>{if(secure)actor=auth.guard(request,true,needsAdmin,actor?.owner)};
   const background=async(operation:string,input:any,client='')=>{fresh();if(operation==='compute'||['analyze','playback','authorize'].includes(operation)&&input?.input_version)versions.handle('check',input.input_version);const markets=operation==='runtimes'?['TWSE','TPEx']:[operation==='openShare'?input?.snapshot?.request?.market:operation==='compute'?input?.input_version?.market:input?.market];const pins=markets.filter(m=>m==='TWSE'||m==='TPEx').map(m=>versions.inputVersion(m as VersionMarket));const guard=()=>{fresh();for(const pin of pins)versions.handle('check',pin)};const value=await queue.run(operation,input,requestId,actor?.owner||'local-workspace',guard,cancellation.signal,client);guard();for(const pin of value.pins)versions.handle('check',pin);return value};
   if(url.pathname==='/api/v1/jobs/status'){
    if(request.method!=='POST')throw new AnalysisError('METHOD_NOT_ALLOWED','工作狀態只接受 POST。',405);
    const input=await readInput();exactFields(input,[],['client_request_id']);if(input.client_request_id!==undefined&&(typeof input.client_request_id!=='string'||input.client_request_id.length>100))throw new AnalysisError('INVALID_JOB','工作識別格式不適用。');send(response,200,queue.status(actor?.owner||'local-workspace',input.client_request_id as string|undefined));return;
   }
   if(url.pathname.startsWith('/api/v1/admin/')){
    if(!secure||!actor?.account||actor.account.role!=='admin')throw new AnalysisError('ADMIN_REQUIRED','此面板僅限管理員。',403);
    if(request.method!=='POST')throw new AnalysisError('METHOD_NOT_ALLOWED','維護面板只接受 POST。',405);
    const input=await readInput();if(response.destroyed)return;fresh();const operation=url.pathname.slice('/api/v1/admin/'.length);let value:unknown;
    if(operation==='overview'){exactFields(input,[]);value=admin.overview()}
    else if(operation==='accounts/list')value=admin.accounts(input);
    else if(operation==='accounts/preview')value=admin.preview(actor,input);
    else if(operation==='accounts/apply')value=admin.apply(actor,input,requestId);
    else if(operation==='accounts/create')value=await admin.create(actor,input,fresh,requestId);
    else if(operation==='events')value=admin.events(input);
    else throw new AnalysisError('NOT_FOUND','找不到此維護操作。',404);
    fresh();if(!response.destroyed)send(response,200,value);return;
   }
   if(url.pathname==='/api/v1/auth/session'){
    if(request.method!=='GET')throw new AnalysisError('METHOD_NOT_ALLOWED','帳號狀態只接受 GET。',405);
    send(response,200,{session:auth.session(request,response)});return;
   }
   if(url.pathname==='/api/v1/auth/login'||url.pathname==='/api/v1/auth/logout'){
    if(request.method!=='POST')throw new AnalysisError('METHOD_NOT_ALLOWED','登入與登出只接受 POST。',405);
    const input=await readInput(8192);if(response.destroyed)return;
    if(url.pathname.endsWith('/login'))send(response,200,{session:await auth.login(request,response,input)});
    else{exactFields(input,[],['all']);if(input.all!==undefined&&typeof input.all!=='boolean')throw new AnalysisError('INVALID_AUTH','登出格式不正確。');send(response,200,auth.logout(request,response,input.all===true))}return;
   }
   if(url.pathname==='/api/v1/playback'){
    if(request.method!=='POST')throw new AnalysisError('METHOD_NOT_ALLOWED','播放介面只接受 POST。',405);
    const input=await readInput();planCheck(input);if(secure&&actor?.plan!=='Pro')throw new AnalysisError('PLAYBACK_LOCKED','播放僅供有效 Pro 帳號使用。',403);
    const value=await background('playback',input,(input as AnalysisRequest).client_request_id);if(response.destroyed)return;response.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(Buffer.from(value.bytes.buffer,value.bytes.byteOffset,value.bytes.byteLength));return;
   }
   if(url.pathname==='/api/v1/exports/authorize'){
    const input=await readInput();exactFields(input,['format','analysis']);if(!['PNG','CSV'].includes(String(input.format)))throw new AnalysisError('INVALID_EXPORT','匯出格式不適用。');
    if(!actor||actor.plan==='Anonymous'||input.format==='CSV'&&actor.plan!=='Pro')throw new AnalysisError('EXPORT_LOCKED','目前帳號方案無法使用此匯出。',403);
    planCheck(input.analysis);const {result}=await background('authorize',input.analysis);if(response.destroyed)return;send(response,200,{format:input.format,rights:actor.rights,request_key:requestKey(input.analysis as AnalysisRequest),input_version:result.input_version});return;
   }

   if(url.pathname.startsWith('/api/v1/shares/')){
    response.setHeader('Referrer-Policy','no-referrer');
    const operation=url.pathname.slice('/api/v1/shares/'.length),parts=operation.split('/');
    if(['create','manage/list','manage/revoke'].includes(operation)){
     if(request.method!=='POST')throw new AnalysisError('METHOD_NOT_ALLOWED','分享管理只接受 POST。',405);
     const input=await readInput();if(response.destroyed)return;
     if(operation==='create'){planCheck(input);const snapshot=shares.prepareCreate(input,actor?.owner);if(snapshot){const {result}=await background('openShare',{snapshot,plan:actor?.plan||mockPlan((input as {mock_plan:unknown}).mock_plan)});if(result.runtime)rememberRuntime({runtime:result.runtime,input_version:result.runtime.input},actor?.plan||mockPlan((input as {mock_plan:unknown}).mock_plan));if(response.destroyed)return}}
     if(operation==='manage/list'){exactFields(input,[]);send(response,200,shares.list(actor?.owner))}else{if(operation==='create')planCheck(input);send(response,200,operation==='create'?shares.create(input,actor?.owner):shares.revoke(input,actor?.owner))}return;
    }
    const envelope=shares.read(parts[0]);
    if(parts.length===1&&request.method==='GET'){send(response,200,envelope);return}
    if(parts.length===2&&parts[1]==='open'&&request.method==='POST'){
     const input=await readInput();exactFields(input,['mock_plan']);planCheck(input);const {result}=await background('openShare',{snapshot:envelope.snapshot,plan:actor?.plan||mockPlan(input.mock_plan)});if(!response.destroyed)send(response,200,result);return;
    }
    if(parts.length===2&&parts[1]==='download'&&request.method==='GET'){
     if(typeof __TWSTOCKRS_SHARE_VIEWER__==='undefined')throw new AnalysisError('VIEWER_UNAVAILABLE','請先建置後端以產生可攜式快照檢視器。',503);
     const data=JSON.stringify(envelope).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026');
     const html=__TWSTOCKRS_SHARE_VIEWER__.replace('<!--FROZEN_DATA-->',()=>'<script type="application/json" id="frozen-snapshot">'+data+'</script>');
     response.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Content-Disposition':'attachment; filename="TWStockRS-frozen-share-'+envelope.snapshot.id+'.html"','Content-Length':Buffer.byteLength(html),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"});response.end(html);return;
    }
    throw new AnalysisError('METHOD_NOT_ALLOWED','分享路徑或操作方式不適用。',405);
   }
   if(url.pathname==='/api/v1/health'){
    if(request.method!=='GET'){response.setHeader('Allow','GET');throw new AnalysisError('METHOD_NOT_ALLOWED','此路徑只接受 GET。',405)}
    const supplied=request.headers['x-twrs-probe'];let monitor:unknown;
    if(options.availability&&typeof supplied==='string'&&/^[a-f0-9]{64}$/.test(supplied)&&timingSafeEqual(Buffer.from(supplied),Buffer.from(options.availability.probe))){let storage_ok=true;try{library.connection.prepare('SELECT COUNT(*) FROM sqlite_master').get();imports.connection.prepare('SELECT COUNT(*) FROM sqlite_master').get();}catch{storage_ok=false;}monitor={version:1,storage_ok,records_available:admin.operationalRecordsAvailable()};}
    send(response,200,{service:'TWStockRS local API',rs_method:'rs_v1',status:'ok',source:'mock',contract_version:1,release_id:'mock-2026-09-v1',authentication:secure,...(options.deployment?{deployment:options.deployment}:{}),...(monitor?{monitor}:{}),background:queue.metrics(),request_id:requestId});return;
   }
   if(url.pathname==='/api/v1/system/backup'){
    if(request.method!=='GET'){response.setHeader('Allow','GET');throw new AnalysisError('METHOD_NOT_ALLOWED','完整備份下載只接受 GET。',405)}
    const temporary=mkdtempSync(path.join(tmpdir(),'twstockrs-download-')),file=path.join(temporary,'backend.twrsbackup');
    try{let result:{sha256:string};if(directory){lease?.();lease=undefined;const snapshot=path.join(temporary,'snapshot');await snapshots.capture(signal=>runSnapshotWorker(path.join(directory,'library.sqlite'),importFilename,snapshot,directory,signal));result=await runArchiveWorker(snapshot,file,cancellation.signal);if(secure)actor=auth.adminDownload(request,actor);}else result=createConnectedBackup(library.connection,imports.connection,file,directory);response.writeHead(200,{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="TWStockRS-backend-backup-'+new Date().toISOString().replace(/[:.]/g,'-')+'.twrsbackup"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Backup-SHA256':result.sha256});const stream=createReadStream(file);response.on('close',()=>{stream.destroy();stream.once('close',()=>rmSync(temporary,{recursive:true,force:true}));if(stream.closed)rmSync(temporary,{recursive:true,force:true})});stream.on('error',()=>response.destroy());stream.pipe(response)}catch(error){rmSync(temporary,{recursive:true,force:true});throw error}return;
   }
   if(url.pathname==='/api/v1/versions/compare/export'){
    if(request.method!=='POST'){response.setHeader('Allow','POST');throw new AnalysisError('METHOD_NOT_ALLOWED','差異報告只接受 POST。',405)}
    const input=await readInput();if(response.destroyed)return;const temporary=mkdtempSync(path.join(tmpdir(),'twstockrs-diff-')),file=path.join(temporary,'comparison.json');
    try{const report=versions.comparisonReport(input,file,64*1024*1024);response.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Content-Disposition':'attachment; filename="'+report.filename+'"','Content-Length':report.bytes,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Comparison-Id':report.comparison_id,'X-Report-SHA256':report.sha256});const stream=createReadStream(file);response.on('close',()=>{stream.destroy();stream.once('close',()=>rmSync(temporary,{recursive:true,force:true}));if(stream.closed)rmSync(temporary,{recursive:true,force:true})});stream.on('error',()=>response.destroy());stream.pipe(response)}catch(error){rmSync(temporary,{recursive:true,force:true});throw error}return;
   }
   if(url.pathname.startsWith('/api/v1/versions/')){
    if(request.method!=='POST'){response.setHeader('Allow','POST');throw new AnalysisError('METHOD_NOT_ALLOWED','版本介面只接受 POST。',405)}
    const input=await readInput();if(!response.destroyed)send(response,200,versions.handle(url.pathname.slice('/api/v1/versions/'.length),input));return;
   }
   if(url.pathname==='/api/v1/analysis-context'||url.pathname==='/api/v1/rs/analyses'){
    if(request.method!=='POST'){response.setHeader('Allow','POST');throw new AnalysisError('METHOD_NOT_ALLOWED','運算介面只接受 POST。',405)}
    const input=await readInput();if(!response.destroyed){if(url.pathname.endsWith('/analysis-context'))planCheck(input);else if(secure&&((input as {analysis?:{plan?:string}})?.analysis?.plan!==actor?.plan))throw new AnalysisError('AUTH_CHANGED','分析方案不符目前帳號。',409);const operation=url.pathname.endsWith('/analysis-context')?'context':'compute',value=await background(operation,input);if(operation==='context')rememberRuntime(value.result,mockPlan((input as {mock_plan:unknown}).mock_plan));if(!response.destroyed)send(response,200,value.result)}return;
   }
   if(url.pathname.startsWith('/api/v1/imports/')){
    if(request.method!=='POST'){response.setHeader('Allow','POST');throw new AnalysisError('METHOD_NOT_ALLOWED','匯入介面只接受 POST。',405)}
    const operation=url.pathname.slice('/api/v1/imports/'.length),input=await readInput(['validate','stage'].includes(operation)?18*1024*1024:64*1024);
    if(!response.destroyed)send(response,200,imports.handle(operation,input));return;
   }
   if(url.pathname.startsWith('/api/v1/library/')){
    if(request.method!=='POST'){response.setHeader('Allow','POST');throw new AnalysisError('METHOD_NOT_ALLOWED','儲存介面只接受 POST。',405)}
    const operation=url.pathname.slice('/api/v1/library/'.length),input=await readInput(['restore','restore/preview'].includes(operation)?2_200_000:64*1024);
    if(['edit','load','restore/preview','restore'].includes(operation)){const plan=actor?.plan||mockPlan((input as {mock_plan:unknown}).mock_plan),{result}=await background('runtimes',{plan});for(const context of result)rememberRuntime(context,plan)}
    if(!response.destroyed)send(response,200,actor?library.forActor(actor.owner,actor.plan,operation,input):library.handle(operation,input));return;
   }
   if(url.pathname!=='/api/v1/analyses')throw new AnalysisError('NOT_FOUND','找不到這個介面。',404);
   if(request.method!=='POST'){response.setHeader('Allow','POST');throw new AnalysisError('METHOD_NOT_ALLOWED','分析介面只接受 POST。',405)}
   const input=await readInput();if(response.destroyed)return;
   planCheck(input);const value=await background('analyze',input,(input as AnalysisRequest).client_request_id);if(response.destroyed)return;
   shares.rememberPrepared(requestId,value.prepared,actor?.owner);
   response.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});response.end(Buffer.from(value.bytes.buffer,value.bytes.byteOffset,value.bytes.byteLength));
  }catch(error){
   if(response.destroyed||response.writableEnded)return;
   if(!request.complete)response.setHeader('Connection','close');
   const known=error instanceof AnalysisError;auditCode=known?error.code:'INTERNAL_ERROR';
   if(known&&['BODY_TOO_LARGE','BODY_TIMEOUT','BODY_BUSY','UNSUPPORTED_MEDIA_TYPE'].includes(error.code))response.setHeader('Connection','close');
   if(known&&error.status===429)response.setHeader('Retry-After',error.code==='LOGIN_RATE_LIMIT'?'900':['LOGIN_SERVICE_LIMIT','SESSION_RATE_LIMIT'].includes(error.code)?'60':'5');
   if(known&&["SESSION_EXPIRED","AUTH_CHANGED","CSRF_REJECTED"].includes(error.code))response.setHeader("X-Auth-Changed","1");
   send(response,known?error.status:500,{error:{code:known?error.code:'INTERNAL_ERROR',message:known?error.message:'本機後端暫時無法完成操作，請重新讀取核對。',request_id:requestId}});
  }finally{handlerDone=true;releaseLease();response.removeListener('close',cancel)}
 });
 const nativeClose=server.close.bind(server);
 let resourcesClosed:Promise<void>|null=null;
 const closeResources=()=>resourcesClosed??=(async()=>{
  try{await Promise.all([queue.close(),snapshots.close()])}
  finally{try{library.close();imports.close();if(temporaryImports)rmSync(temporaryImports,{recursive:true,force:true})}finally{unlock()}}
 })();
 // Stop admitting connections first. Existing responses retain their database
 // and workers until native HTTP close confirms that they have finished.
 server.close=((callback?:((error?:Error)=>void))=>{
  nativeClose(error=>{void closeResources().then(()=>callback?.(error),failure=>callback?.(error||failure as Error))});
  return server;
 }) as typeof server.close;
 server.requestTimeout=10_000;server.headersTimeout=10_000;server.keepAliveTimeout=5_000;
 server.maxHeadersCount=64;server.maxRequestsPerSocket=100;server.maxConnections=128;
 server.on('close',()=>{void closeResources().catch(()=>{})});
 return Object.assign(server,{writeBackupSnapshot:async(target:string)=>{if(!directory)throw Error('Background snapshots require an installed data directory');await snapshots.capture(signal=>runSnapshotWorker(path.join(directory,'library.sqlite'),importFilename,target,directory,signal))}});
}
