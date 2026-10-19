import {parentPort,workerData} from 'node:worker_threads';
import {ImportStore} from './importStore';
import {ReleaseStore} from './releaseStore';
import {RsService} from './rsService';
import {prepareFrozenDelivery} from './frozenShareStore';
import {prepareShareAnalysis} from './shareAnalysis';
import {AnalysisError,type AnalysisResponse} from '../shared/mockAnalysis';
import type {Plan} from '../components/twstock/model';
import type {VersionMarket} from '../shared/dataVersions';
const imports=new ImportStore(workerData.filename,true),versions=new ReleaseStore(imports,true),rs=new RsService(versions);
parentPort!.on('message',({id,operation,input,requestId})=>{
 try{
  const markets:VersionMarket[]=operation==='runtimes'?['TWSE','TPEx']:[operation==='openShare'?input?.snapshot?.request?.market:operation==='compute'?input?.input_version?.market:input?.market];
  const pins=markets.filter(m=>m==='TWSE'||m==='TPEx').map(m=>versions.inputVersion(m));
  let result:unknown,runtime;
  if(operation==='context')result=rs.context(input);
  else if(operation==='analyze'){result=rs.analyze(input,requestId);runtime=rs.runtime(input.market,input.mock_plan)}
  else if(operation==='authorize')result={input_version:rs.analyze(input,requestId).input_version};
  else if(operation==='playback')result=rs.playback(input,requestId);
  else if(operation==='compute')result=rs.compute(input,requestId);
  else if(operation==='openShare')result=prepareShareAnalysis(input.snapshot,input.plan,rs);
  else if(operation==='runtimes')result=markets.map(market=>rs.context({market,mock_plan:input.plan as Plan}));
  else throw new AnalysisError('INVALID_JOB','背景工作種類不適用。',422);
  for(const pin of pins)versions.handle('check',pin);
  // JSON encoding of the largest response stays off the HTTP thread.
  if(operation==='playback'||operation==='analyze'){const prepared=operation==='analyze'?prepareFrozenDelivery(input,result as AnalysisResponse,runtime):null,bytes=Buffer.from(JSON.stringify(result));if(bytes.length>(operation==='playback'?64:12)*1024*1024)throw new AnalysisError(operation==='playback'?'PLAYBACK_TOO_LARGE':'ANALYSIS_TOO_LARGE',operation==='playback'?'播放資料超過本機上限，請改用逐日檢視。':'本次分析資料超過本機上限，請縮小期間或軌跡後重試。',413);const data=Uint8Array.from(bytes);parentPort!.postMessage({id,value:{bytes:data,pins,prepared}},[data.buffer]);return}
  parentPort!.postMessage({id,value:{result,runtime,pins}});
 }catch(error){const known=error instanceof AnalysisError;parentPort!.postMessage({id,error:{code:known?error.code:'WORKER_FAILED',message:known?error.message:'背景運算無法完成，請重新取得結果。',status:known?error.status:503}})}
});
