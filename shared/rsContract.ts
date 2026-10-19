import {maxHistoryEndpoints} from './historyPolicy';
import {AnalysisError,type AnalysisData,type AnalysisRequest} from './mockAnalysis';
import {decodeInputVersion,type InputVersion} from './dataVersions';
import {validImportDate} from './dataImport';
import {statuses,type RuntimeData,type Entity} from '../components/twstock/model';
import type {RsEntity,RsResult} from '../server/rsEngine';

export type ComputedResponse=RsResult&{contract_version:2;source:'computed';dataset_kind:'test'|'source';release_id:string;input_version:InputVersion;request_id:string;client_request_id:string;request_key:string};
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const identifier=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(v);
const label=(v:unknown):v is string=>typeof v==='string'&&v.length>0&&v.length<=maxHistoryEndpoints&&!/[\u0000-\u001f]/.test(v);
const invalid=():never=>{throw new AnalysisError('INVALID_RESPONSE','後端回傳的價格運算資料格式不正確，請重新讀取。',502)};
const sortedDates=(v:unknown):v is string[]=>Array.isArray(v)&&v.length<=maxHistoryEndpoints&&v.every((d,i)=>validImportDate(d)&&(i===0||v[i-1]<d));
export function decodeRuntimeData(v:unknown,market:string):RuntimeData{
 if(!record(v)||v.market!==market||!['test','source'].includes(String(v.dataset_kind))||!sortedDates(v.Daily)||!sortedDates(v.Weekly)||!v.Daily.length||!Array.isArray(v.catalog)||v.catalog.length>20_000||!Array.isArray(v.sectors)||v.sectors.length>10_000||(v.market_benchmark!==null&&!identifier(v.market_benchmark)))return invalid();
 const input=decodeInputVersion(v.input,market);if(!input.release_id||input.dataset_kind!==v.dataset_kind)return invalid();
 const entities=(items:unknown[],sector:boolean)=>{const ids=new Set();return items.map(item=>{if(!record(item)||!identifier(item.id)||ids.has(item.id)||!label(item.name)||item.market!==market||!label(item.sector)||!Object.hasOwn(statuses,String(item.status))||!Array.isArray(item.points)||item.points.length||!['stock','etf','sector'].includes(String(item.kind))||sector!==(item.kind==='sector')||!sector&&(!label(item.code)||typeof item.searchable!=='boolean'))return invalid();ids.add(item.id);return item as Entity})};
 const catalog=entities(v.catalog,false),sectors=entities(v.sectors,true),catalogIds=new Set(catalog.map(e=>e.id)),sectorIds=new Set(sectors.map(e=>e.id)),left=[v.Daily[0],v.Weekly[0]].filter(Boolean).sort()[0],end=v.Daily.at(-1)!;
 for(const name of ['memberships','market_periods']){if(!Array.isArray(v[name])||(v[name] as unknown[]).length>200_000)return invalid();for(const row of v[name] as unknown[]){if(!record(row)||!identifier(row.security_id)||!catalogIds.has(String(row.security_id))||!validImportDate(row.valid_from)||!validImportDate(row.valid_to)||row.valid_from>=row.valid_to||row.valid_from<left||row.valid_from>end||name==='memberships'&&(!identifier(row.sector_id)||!sectorIds.has(String(row.sector_id))))return invalid()}}
 return {market,input,dataset_kind:v.dataset_kind as 'test'|'source',Daily:v.Daily,Weekly:v.Weekly,catalog,sectors,market_benchmark:v.market_benchmark as string|null,memberships:v.memberships as RuntimeData['memberships'],market_periods:v.market_periods as RuntimeData['market_periods']};
}
export function decodeComputedResponse(value:unknown,request:AnalysisRequest,expectedKey:string,runtime?:RuntimeData):{response:ComputedResponse;data:AnalysisData}{
 const dateChecks=new Map<unknown,boolean>(),validDate=(date:unknown):date is string=>{if(!dateChecks.has(date))dateChecks.set(date,validImportDate(date));return dateChecks.get(date)!};
 if(!record(value)||value.contract_version!==2||value.source!=='computed'||value.method_version!=='rs_v1'||!['test','source'].includes(String(value.dataset_kind))||typeof value.release_id!=='string'||!/^rs_v1-[a-f0-9]{64}$/.test(value.release_id)||!label(value.request_id)||value.client_request_id!==request.client_request_id||value.request_key!==expectedKey||value.market!==request.market||value.frequency!==request.frequency||!validDate(value.viewing_date)||!validDate(value.history_start)||!validDate(value.latest)||value.history_start>value.viewing_date||value.viewing_date>value.latest||request.viewing_date!=='Latest'&&value.viewing_date!==request.viewing_date||!Array.isArray(value.entities)||value.entities.length>10_000)return invalid();
 const input=decodeInputVersion(value.input_version,request.market);if(!input.release_id||input.dataset_kind!==value.dataset_kind||value.release_id!==`rs_v1-${input.digest}`)return invalid();
 if(request.input_version&&Object.keys(input).some(k=>input[k as keyof InputVersion]!==request.input_version![k as keyof InputVersion]))return invalid();
 const dates=runtime?(request.frequency==='Weekly'?runtime.Weekly:runtime.Daily):undefined;
 if(dates&&(value.history_start!==dates[0]||value.latest!==dates.at(-1)||!dates.includes(value.viewing_date)))return invalid();
 if(request.mode==='Stock Move'&&(value.entities.length!==request.security_ids.length||value.entities.some((e,i)=>!record(e)||e.id!==request.security_ids[i])))return invalid();
 const dateSet=dates?new Set(dates):null,catalogMap=new Map(runtime?.catalog.map(e=>[e.id,e])||[]);
 const seen=new Set(),entities:Entity[]=[],samples:AnalysisData['samples']={};
 for(const item of value.entities){
  if(!record(item)||!identifier(item.id)||seen.has(item.id)||!label(item.code)||!label(item.name)||item.market!==request.market||!label(item.sector)||!Object.hasOwn(statuses,String(item.status))||!label(item.reason)||!label(item.message)||!Array.isArray(item.points)||item.points.length>request.trail||item.actual_trail!==item.points.length||item.requested_trail!==request.trail||item.trail_complete!==(item.points.length===request.trail)||typeof item.initialization_limited!=='boolean'||!Array.isArray(item.industry_changes)||item.industry_changes.length>maxHistoryEndpoints)return invalid();
  seen.add(item.id);let previous='';const points:AnalysisData['samples'][string]=[];
  for(const [i,p] of item.points.entries()){
   if(!record(p)||!validDate(p.point_date)||p.point_date<value.history_start||p.point_date>value.viewing_date||p.point_date<=previous||dateSet&&!dateSet.has(p.point_date)||!validDate(p.price_date)||p.price_date>p.point_date||request.frequency==='Daily'&&p.price_date!==p.point_date||request.frequency==='Weekly'&&(Date.parse(p.point_date)-Date.parse(p.price_date)>6*86400000)||typeof p.rs_level!=='number'||!Number.isFinite(p.rs_level)||typeof p.rs_momentum!=='number'||!Number.isFinite(p.rs_momentum)||!identifier(p.benchmark_id)||!identifier(p.segment_id)||i===0&&p.gap_before!==null||i>0&&typeof p.gap_before!=='boolean')return invalid();
   if(p.gap_before)points.push({date:p.point_date,point:null});
   points.push({date:p.point_date,priceDate:p.price_date,point:[p.rs_level,p.rs_momentum],benchmarkId:p.benchmark_id,gapBefore:p.gap_before as boolean|null,segmentId:p.segment_id});previous=p.point_date;
  }
  if(item.transition!==null){const t=item.transition;if(!record(t)||!['Leading','Weakening','Lagging','Improving'].includes(String(t.from))||!['Leading','Weakening','Lagging','Improving'].includes(String(t.to))||t.from===t.to||!validDate(t.previous_date)||!validDate(t.point_date)||t.previous_date<value.history_start||t.point_date>value.viewing_date||t.previous_date>=t.point_date)return invalid()}
  for(const c of item.industry_changes)if(!record(c)||!validDate(c.date)||c.date<value.history_start||c.date>value.viewing_date||!identifier(c.from)||!identifier(c.to)||typeof c.benchmark_changed!=='boolean')return invalid();
  if(!['valid','stale'].includes(String(item.status))&&previous&&previous<value.viewing_date)points.push({date:value.viewing_date,point:null});
  const e=item as unknown as RsEntity;entities.push({id:e.id,code:e.code,name:e.name,market:e.market,sector:e.sector,kind:request.mode==='Sector Move'?'sector':catalogMap.get(e.id)?.kind||'stock',status:e.status,points:[],message:e.message,reason:e.reason,priceDate:e.points.at(-1)?.price_date,transition:e.transition,industryChanges:e.industry_changes,actualTrail:e.actual_trail,trailComplete:e.trail_complete});samples[e.id]=points;
 }
 return {response:value as unknown as ComputedResponse,data:{source:'computed',viewingDate:value.viewing_date,historyStart:value.history_start,entities,samples,version:{result_release_id:value.release_id,method_version:'rs_v1',dataset_kind:input.dataset_kind!,input}}};
}
