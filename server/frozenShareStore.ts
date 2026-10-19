import {historyEndpointLimit} from '../shared/historyPolicy';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {AnalysisError,requestKey,validateAnalysisRequest,type AnalysisRequest,type AnalysisResponse} from '../shared/mockAnalysis';
import {decodeFrozenSnapshot,shareTokenPattern,type FrozenSnapshot,type FrozenEnvelope} from '../shared/frozenShare';
import {benchmarkLabel,type RuntimeData,type Plan} from '../components/twstock/model';
import {exactFields,mockPlan} from '../shared/libraryContract';

export const shareTableSQL=`CREATE TABLE frozen_shares (token TEXT PRIMARY KEY, delivery_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)), contents TEXT NOT NULL CHECK(json_valid(contents)), sha256 TEXT NOT NULL)`;
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
type Row={token:string;delivery_id:string;created_at:string;revoked:number;contents:string;sha256:string};
export function verifyShareRow(row:Row){
 if(!shareTokenPattern.test(row.token)||!row.delivery_id||![0,1].includes(row.revoked)||Buffer.byteLength(row.contents)>12*1024*1024||digest(row.contents)!==row.sha256)throw Error('凍結分享保存內容校驗失敗。');
 const snapshot=JSON.parse(row.contents) as FrozenSnapshot;decodeFrozenSnapshot(snapshot);
 if(snapshot.created_at!==row.created_at||snapshot.response.request_id!==row.delivery_id)throw Error('凍結分享索引不一致。');
 return {snapshot,sha256:row.sha256};
}
export function prepareFrozenDelivery(request:AnalysisRequest,response:AnalysisResponse,runtime?:RuntimeData,now=Date.now()){
  // Capture exactly the legal, already delivered result; never save warm-up prices.
  const resolved=structuredClone(request);
  const ids=new Set(response.entities.map(e=>e.id));if(request.benchmark_type!=='market')ids.add(request.benchmark);
  // Context is reduced to display identities and legal endpoint dates. Future
  // memberships, unrelated securities and source price history are not shared.
  const frozenRuntime=runtime?{...runtime,catalog:runtime.catalog.filter(e=>ids.has(e.id)),sectors:runtime.sectors.filter(e=>ids.has(e.id)),memberships:[],market_periods:[]}:null;
  const snapshot:FrozenSnapshot={format:'TWStockRS-frozen-share',version:1,id:'share-'+randomUUID(),created_at:new Date(now).toISOString(),benchmark_label:benchmarkLabel(request.benchmark_type,request.market,request.benchmark,runtime),request:resolved,runtime:frozenRuntime,response};
  decodeFrozenSnapshot(snapshot);const text=JSON.stringify(snapshot);if(Buffer.byteLength(text)>12*1024*1024)return null;return {text,key:requestKey(request)};
}


export class FrozenShareStore{
 private deliveries=new Map<string,{at:number;text:string;key:string;owner:string}>();
 constructor(private db:DatabaseSync,private now:()=>number=Date.now,private authorize?:(snapshot:FrozenSnapshot,plan:Plan)=>void){}
 remember(request:AnalysisRequest,response:AnalysisResponse,runtime?:RuntimeData,owner="local-workspace"){this.rememberPrepared(response.request_id,prepareFrozenDelivery(request,response,runtime,this.now()),owner)}
 rememberPrepared(id:string,prepared:{text:string;key:string}|null,owner="local-workspace"){
  if(!prepared||Buffer.byteLength(prepared.text)>12*1024*1024)return;
  for(const [id,item] of this.deliveries)if(this.now()-item.at>600_000)this.deliveries.delete(id);
  this.deliveries.set(id,{at:this.now(),text:prepared.text,key:prepared.key,owner});
  while(this.deliveries.size>50||Array.from(this.deliveries.values()).reduce((n,d)=>n+Buffer.byteLength(d.text),0)>64*1024*1024)this.deliveries.delete(this.deliveries.keys().next().value!);
 }
 prepareCreate(value:unknown,owner="local-workspace"){
  const delivery=this.delivery(value,owner);const prior=this.db.prepare('SELECT * FROM frozen_shares WHERE delivery_id=?').get((value as {delivery_id:string}).delivery_id) as Row|undefined;
  if(prior){if(prior.revoked)throw new AnalysisError('SHARE_REVOKED','此交付的分享已停用；請重新取得分析結果再建立。',410);verifyShareRow(prior);return null}
  return JSON.parse(delivery.text) as FrozenSnapshot;
 }
 private delivery(value:unknown,owner:string){
  exactFields(value,['delivery_id','request_key','mock_plan']);const plan=mockPlan(value.mock_plan);if(typeof value.delivery_id!=='string'||value.delivery_id.length>100||typeof value.request_key!=='string'||value.request_key.length>64000)throw new AnalysisError('INVALID_SHARE','分享請求格式不正確。');
  const delivery=this.deliveries.get(value.delivery_id as string);
  if(!delivery||delivery.owner!==owner||delivery.key!==value.request_key||this.now()-delivery.at>600_000)throw new AnalysisError('DELIVERY_EXPIRED','這份交付結果已逾十分鐘或服務已重啟。請重新取得分析結果，再建立分享。',409);
  return delivery;
 }
 create(value:unknown,owner="local-workspace"){
  const delivery=this.delivery(value,owner);exactFields(value,['delivery_id','request_key','mock_plan']);const plan=mockPlan(value.mock_plan);
  const prior=this.db.prepare('SELECT * FROM frozen_shares WHERE delivery_id=?').get(value.delivery_id as string) as Row|undefined;
  if(prior){if(prior.revoked)throw new AnalysisError('SHARE_REVOKED','此交付的分享已停用；請重新取得分析結果再建立。',410);return {token:prior.token,...verifyShareRow(prior)}}
  const usage=this.db.prepare('SELECT COUNT(*) AS n,COALESCE(SUM(length(CAST(contents AS BLOB))),0) AS bytes FROM frozen_shares JOIN share_owners USING(token) WHERE owner=?').get(owner)!;
  if(Number(usage.n)>=500||Number(usage.bytes)+Buffer.byteLength(delivery.text)>128*1024*1024)throw new AnalysisError('SHARE_LIMIT','本機分享儲存上限為 500 份／128 MiB，目前不能再新增；既有分享仍可查看及備份。',429);
  if(Number(this.db.prepare('SELECT COUNT(*) AS n FROM frozen_shares JOIN share_owners USING(token) WHERE owner=? AND created_at>=?').get(owner,new Date(this.now()-3600000).toISOString())!.n)>=20)throw new AnalysisError('SHARE_RATE_LIMIT','每小時最多建立 20 份分享，請稍後再試。',429);
  const token=randomBytes(32).toString('base64url'),snapshot=JSON.parse(delivery.text) as FrozenSnapshot;
  if(this.authorize)this.authorize(snapshot,plan);else{
   const original=snapshot.runtime,runtime=original?{...original,Daily:original.Daily.slice(-historyEndpointLimit(plan,'Daily')),Weekly:plan==='Pro'?original.Weekly:[]}:undefined;
   validateAnalysisRequest({...snapshot.request,mock_plan:plan,viewing_date:snapshot.response.viewing_date},runtime);
  }
  snapshot.created_at=new Date(this.now()).toISOString();const text=JSON.stringify(snapshot),sha256=digest(text);
  const total=this.db.prepare('SELECT COUNT(*) AS n,COALESCE(SUM(length(CAST(contents AS BLOB))),0) AS bytes FROM frozen_shares').get()!;
  if(Number(total.n)>=4096||Number(total.bytes)+Buffer.byteLength(text)>512*1024*1024)throw new AnalysisError('SHARE_LIMIT','本機服務分享總容量已達上限，既有分享仍可查看。',429);
  this.db.exec('BEGIN IMMEDIATE');try{this.db.prepare('INSERT INTO frozen_shares (token,delivery_id,created_at,contents,sha256) VALUES (?,?,?,?,?)').run(token,value.delivery_id as string,snapshot.created_at,text,sha256);this.db.prepare('INSERT INTO share_owners VALUES (?,?)').run(token,owner);this.db.exec('COMMIT')}catch(e){this.db.exec('ROLLBACK');throw e}
  return {token,snapshot,sha256};
 }
 read(token:string):FrozenEnvelope{
  if(!shareTokenPattern.test(token))throw new AnalysisError('SHARE_NOT_FOUND','找不到這份分享，請確認連結。',404);
  const row=this.db.prepare('SELECT * FROM frozen_shares WHERE token=?').get(token) as Row|undefined;
  if(!row)throw new AnalysisError('SHARE_NOT_FOUND','找不到這份分享，請確認連結。',404);
  if(row.revoked)throw new AnalysisError('SHARE_REVOKED','這份分享已停用。已下載的副本仍會保留。',410);
  try{return verifyShareRow(row)}catch{throw new AnalysisError('SHARE_CORRUPT','分享保存內容校驗失敗，未重新運算替代內容。',503)}
 }
 list(owner='local-workspace'){return {shares:this.db.prepare('SELECT token,created_at,revoked,sha256 FROM frozen_shares JOIN share_owners USING(token) WHERE owner=? ORDER BY created_at DESC,token LIMIT 500').all(owner)}}
 revoke(value:unknown,owner='local-workspace'){exactFields(value,['token','expected_sha256']);if(!this.db.prepare('SELECT token FROM share_owners WHERE token=? AND owner=?').get(String(value.token),owner))throw new AnalysisError('SHARE_NOT_FOUND','找不到可管理的分享。',404);const envelope=this.read(String(value.token));if(value.expected_sha256!==envelope.sha256)throw new AnalysisError('SHARE_CONFLICT','分享校驗資訊已變更，請重新讀取。',409);this.db.prepare('UPDATE frozen_shares SET revoked=1 WHERE token=?').run(String(value.token));return {revoked:true}}
}
