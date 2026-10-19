import {historyEndpointLimit} from '../shared/historyPolicy';
import type {RuntimePackage} from './importRuntime';
import type {ImportPackage,MarketPeriod,Membership,Price,Security} from '../shared/dataImport';
import type {DataRelease} from '../shared/dataVersions';
import {AnalysisError} from '../shared/mockAnalysis';
import {capacity,quadrant,type Plan,type Status} from '../components/twstock/model';

export const rsMethod='rs_v1' as const;
export type RsRequest={market:'TWSE'|'TPEx';plan:Plan;mode:'Stock Move'|'Sector Move';frequency:'Daily'|'Weekly';period:number;trail:number;price_type:'Raw'|'Adjusted';viewing_date:string;security_ids:string[];benchmark:{type:'market'|'security'|'sector'|'parent';id:string}};
type Kind='value'|'no_input'|'unavailable'|'inactive'|'initializing';
type Value={kind:Kind;value?:number;price_date?:string;reason?:string};
type Pair={date:string;price_date:string|null;segment_id:string|null;benchmark_id:string;kind:Kind;ratio?:number;reason?:string};
export type RsPoint={point_date:string;price_date:string;rs_level:number;rs_momentum:number;benchmark_id:string;segment_id:string;gap_before:boolean|null};
type Calculation=Pair&{status:Status;rs_level:number|null;rs_momentum:number|null;reason:string};
export type RsEntity={id:string;code:string;name:string;market:string;sector:string;status:Status;reason:string;message:string;points:RsPoint[];requested_trail:number;actual_trail:number;trail_complete:boolean;transition:{from:string;to:string;point_date:string;previous_date:string}|null;industry_changes:{date:string;from:string;to:string;benchmark_changed:boolean}[];initialization_limited:boolean};
export type RsResult={method_version:typeof rsMethod;market:string;frequency:string;viewing_date:string;history_start:string;latest:string;entities:RsEntity[]};
const dayMs=86400000;
export const contains=(p:{valid_from:string;valid_to:string|null},date:string)=>p.valid_from<=date&&(p.valid_to===null||date<p.valid_to);
const positive=(n:unknown):n is number=>typeof n==='number'&&Number.isFinite(n)&&n>0;
const monday=(date:string)=>{const n=Date.parse(date),d=new Date(n).getUTCDay();return new Date(n-((d+6)%7)*dayMs).toISOString().slice(0,10)};
const sunday=(date:string)=>new Date(Date.parse(monday(date))+6*dayMs).toISOString().slice(0,10);
const reject=(message:string,code='INVALID_RS',status=422):never=>{throw new AnalysisError(code,message,status)};
const messages:Record<string,string>={valid:'依輸入價格計算的有效結果。',no_input:'資料截至上一個有效取價日。',insufficient_history:'此市場期間內的有效歷史尚不足。',data_unavailable:'部分資料尚未完成，暫時無法顯示結果。',no_result:'這段可查看期間內沒有可顯示的結果。',inactive:'此標的在所選日期不適用。',self:'比較基準不能與分析標的相同。',parent_unavailable:'此標的沒有適用的所屬產業基準。'};

// Center before scaling: avoids subtracting two large, nearly equal sums of squares.
// The relative 32-ulp guard rejects variation below reliable double precision.
export function standardizedLast(values:readonly number[]):number|null{
 if(!values.length)return null;
 const base=values[0];let scale=0,magnitude=0;
 for(const value of values){if(!Number.isFinite(value))return null;scale=Math.max(scale,Math.abs(value-base));magnitude=Math.max(magnitude,Math.abs(value))}
 if(!scale||!Number.isFinite(scale)||scale<=32*Number.EPSILON*magnitude)return null;
 let sum=0;for(const value of values)sum+=(value-base)/scale;const mean=sum/values.length;
 let variance=0;for(const value of values)variance+=((value-base)/scale-mean)**2;variance/=values.length;
 const result=((values.at(-1)!-base)/scale-mean)/Math.sqrt(variance);
 return Number.isFinite(result)?result:null;
}

// No-input endpoints do not occupy a pair position; bad data resets the pair window.
// Undefined Level/Delta positions remain inside their windows and cannot be skipped.
export function calculatePairs(events:readonly Pair[],period:number):Calculation[]{
 let ratios:number[]=[],levels:(number|null)[]=[],deltas:(number|null)[]=[],segment:string|null=null;
 let carried:Pick<Calculation,'status'|'rs_level'|'rs_momentum'|'reason'>={status:'insufficient_history',rs_level:null,rs_momentum:null,reason:'insufficient_history'};
 return events.map(event=>{
  if(event.segment_id!==segment){ratios=[];levels=[];deltas=[];segment=event.segment_id;carried={status:'insufficient_history',rs_level:null,rs_momentum:null,reason:'insufficient_history'}}
  if(event.kind==='no_input'||event.kind==='initializing')return {...event,...carried,status:carried.status==='valid'||carried.status==='stale'?'stale':carried.status,reason:carried.status==='valid'||carried.status==='stale'?'no_input':carried.reason};
  if(event.kind==='unavailable'||event.kind==='inactive'){
   ratios=[];levels=[];deltas=[];carried={status:event.kind==='inactive'?'inactive':'data_unavailable',rs_level:null,rs_momentum:null,reason:event.reason||event.kind};return {...event,...carried};
  }
  if(!positive(event.ratio)){ratios=[];levels=[];deltas=[];carried={status:'no_result',rs_level:null,rs_momentum:null,reason:'invalid_ratio'};return {...event,...carried}}
  ratios.push(event.ratio);const level=ratios.length>=period?standardizedLast(ratios.slice(-period)):null;
  const prior=levels.at(-1),delta=level!==null&&prior!==undefined&&prior!==null?level-prior:null;levels.push(level);deltas.push(delta);
  const window=deltas.slice(-period),momentum=window.length===period&&window.every(v=>v!==null)?standardizedLast(window as number[]):null;
  const status:Status=level!==null&&momentum!==null?'valid':ratios.length<2*period&&!(ratios.length>=period&&level===null)?'insufficient_history':'no_result';
  carried={status,rs_level:status==='valid'?level:null,rs_momentum:status==='valid'?momentum:null,reason:status==='valid'?'valid':status==='insufficient_history'?'insufficient_history':'undefined_derivative'};
  return {...event,...carried};
 });
}

export class RsDataset{
 readonly securities=new Map<string,Security>();readonly sectors=new Map<string,ImportPackage['sectors'][number]>();
 readonly periods=new Map<string,MarketPeriod[]>();readonly memberships=new Map<string,Membership[]>();
 private prices=new Map<string,Map<string,Map<string,Price>>>();
 private compact=new Map<string,Map<string,{raw:Float64Array;adjusted:Float64Array;volume:Float64Array;state:Uint8Array}>>();private dateIndex=new Map<string,number>();
 readonly calendars=new Map<string,boolean>();
 readonly daily:string[];readonly weekly:string[];
 private componentIndex:Map<string,string[]>|null=null;
 private sectorCache=new Map<string,Map<string,Value>>();
 private returnCache=new Map<string,Map<string,Map<string,Value>>>();
 private calculationCache=new Map<string,Calculation[]>();
 private cachedObservations=0;
 cacheStats(){return {series:this.calculationCache.size,observations:this.cachedObservations,max_series:512,max_observations:200_000}}
 private weekDays=new Map<string,string[]>();
 constructor(readonly release:DataRelease,packages:readonly RuntimePackage[]){
  // Only a release verified by ReleaseStore is accepted by the HTTP adapter.
  const periods=new Map<string,MarketPeriod>(),memberships=new Map<string,Membership>();
  for(const p of packages)for(const d of p.calendar)if(!this.dateIndex.has(d.date))this.dateIndex.set(d.date,this.dateIndex.size);
  for(const p of packages){for(const s of p.securities)this.securities.set(s.security_id,s);for(const s of p.sectors)this.sectors.set(s.sector_id,s);for(const r of p.market_periods)periods.set(r.segment_id,r);for(const r of p.memberships)memberships.set(JSON.stringify(r),r);for(const r of p.prices){if(p.version===2){let markets=this.compact.get(r.security_id);if(!markets){markets=new Map();this.compact.set(r.security_id,markets)}let column=markets.get(r.market);if(!column){const n=this.dateIndex.size;column={raw:new Float64Array(n).fill(NaN),adjusted:new Float64Array(n).fill(NaN),volume:new Float64Array(n).fill(NaN),state:new Uint8Array(n)};markets.set(r.market,column)}const n=this.dateIndex.get(r.date);if(n===undefined)reject('運算副本價格日期超出日曆。');column.raw[n!]=r.raw_close??NaN;column.adjusted[n!]=r.adjusted_close??NaN;column.volume[n!]=r.volume??NaN;column.state[n!]=['traded','suspended','no_trade','unavailable'].indexOf(r.status)+1;continue}let markets=this.prices.get(r.security_id);if(!markets){markets=new Map();this.prices.set(r.security_id,markets)}let dates=markets.get(r.market);if(!dates){dates=new Map();markets.set(r.market,dates)}dates.set(r.date,r)}for(const d of p.calendar)this.calendars.set(`${d.market}|${d.date}`,d.is_open)}
  for(const r of periods.values()){const list=this.periods.get(r.security_id)||[];list.push(r);this.periods.set(r.security_id,list)}
  for(const r of memberships.values()){const list=this.memberships.get(r.security_id)||[];list.push(r);this.memberships.set(r.security_id,list)}
  for(const list of this.periods.values())list.sort((a,b)=>a.valid_from.localeCompare(b.valid_from));for(const list of this.memberships.values())list.sort((a,b)=>a.valid_from.localeCompare(b.valid_from));
  this.daily=[...this.calendars].filter(([k,open])=>open&&k.startsWith(release.market+'|')).map(([k])=>k.split('|')[1]).sort();
  const groups=this.weekDays;for(const date of this.daily){const m=monday(date),list=groups.get(m)||[];list.push(date);groups.set(m,list)}
  this.weekly=[...groups].filter(([start,days])=>start>=release.date_from&&sunday(start)<=release.date_to&&days.length>0).map(([,days])=>days.at(-1)!);
 }
 period(id:string,date:string){return this.periods.get(id)?.find(p=>contains(p,date))}
 sectorAt(id:string,date:string){const member=this.memberships.get(id)?.find(p=>contains(p,date));return member&&this.sectors.get(member.sector_id)?.market===this.period(id,date)?.market?member.sector_id:null}
 endpointDates(frequency:string){return frequency==='Weekly'?this.weekly:this.daily}
 visibleDates(plan:Plan,frequency:string){return this.endpointDates(frequency).slice(-historyEndpointLimit(plan,frequency))}
 private price(id:string,market:string,date:string):Price|undefined{const column=this.compact.get(id)?.get(market),n=this.dateIndex.get(date);if(column&&n!==undefined){const state=column.state[n];if(!state)return;return {security_id:id,market:market as 'TWSE'|'TPEx',date,status:['traded','suspended','no_trade','unavailable'][state-1] as Price['status'],raw_close:Number.isNaN(column.raw[n])?null:column.raw[n],adjusted_close:Number.isNaN(column.adjusted[n])?null:column.adjusted[n],volume:Number.isNaN(column.volume[n])?null:column.volume[n],reason:null}}return this.prices.get(id)?.get(market)?.get(date)}
 securityValue(id:string,date:string,priceType:string):Value{
  const p=this.period(id,date);if(!p||p.market!==this.release.market)return {kind:'inactive',reason:'market_lifecycle'};
  const r=this.price(id,p.market,date);if(!r||r.status==='unavailable')return {kind:'unavailable',reason:'missing_price'};
  if(r.status==='suspended'||r.status==='no_trade')return {kind:'no_input',reason:r.status};
  const value=priceType==='Raw'?r.raw_close:r.adjusted_close;
  return positive(value)?{kind:'value',value,price_date:date}:{kind:'unavailable',reason:'price_type_unavailable'};
 }
 private stockReturns(priceType:string){
  const cached=this.returnCache.get(priceType);if(cached)return cached;
  const result=new Map<string,Map<string,Value>>(),days=[...new Set([...this.calendars].filter(([,open])=>open).map(([k])=>k.split('|')[1]))].sort();
  for(const s of this.securities.values())if(s.kind==='stock'){
   const observations=new Map<string,Value>();result.set(s.security_id,observations);let reference:number|null=null,broken=false;
   for(const date of days){const p=this.period(s.security_id,date);if(!p||!this.calendars.get(`${p.market}|${date}`))continue;const r=this.price(s.security_id,p.market,date);
    if(!r||r.status==='unavailable'){broken=true;observations.set(date,{kind:'unavailable',reason:'missing_component'});continue}
    if(r.status==='suspended'||r.status==='no_trade'){observations.set(date,broken?{kind:'unavailable',reason:'unknown_reference'}:reference===null?{kind:'initializing'}:{kind:'value',value:0});continue}
    const price=priceType==='Raw'?r.raw_close:r.adjusted_close;
    if(!positive(price)){broken=true;observations.set(date,{kind:'unavailable',reason:'price_type_unavailable'});continue}
    if(broken){observations.set(date,{kind:'unavailable',reason:'unknown_return'});reference=price;broken=false;continue}
    observations.set(date,reference===null?{kind:'initializing'}:{kind:'value',value:price/reference-1});reference=price;
   }
  }
  this.returnCache.set(priceType,result);return result;
 }
 sectorValues(id:string,priceType:string){
  const cacheKey=`${id}|${priceType}`,cached=this.sectorCache.get(cacheKey);if(cached)return cached;
  if(!this.componentIndex){this.componentIndex=new Map();for(const s of this.securities.values())if(s.kind==='stock')for(const date of this.daily){if(this.period(s.security_id,date)?.market!==this.release.market)continue;const sector=this.sectorAt(s.security_id,date);if(!sector)continue;const key=sector+'|'+date,list=this.componentIndex.get(key)||[];list.push(s.security_id);this.componentIndex.set(key,list)}}
  const result=new Map<string,Value>(),returns=this.stockReturns(priceType);let index:number|null=null,poisoned=false;
  for(const date of this.daily){
   const members=this.componentIndex.get(id+'|'+date)||[];
   const observations=members.map(id=>returns.get(id)?.get(date)||{kind:'unavailable' as const,reason:'missing_component'});
   if(observations.some(r=>r.kind==='unavailable'))poisoned=true;
   if(poisoned){result.set(date,{kind:'unavailable',reason:'unknown_sector_cumulative_return'});continue}
   const eligible=observations.filter(r=>r.kind==='value');if(!eligible.length){result.set(date,{kind:index===null?'initializing':'no_input',reason:'no_eligible_components'});continue}
   const mean=eligible.reduce((sum,r)=>sum+r.value!,0)/eligible.length;
   const next:number=index===null?100:index*(1+mean);if(!positive(next)){poisoned=true;result.set(date,{kind:'unavailable',reason:'invalid_sector_index'});continue}
   index=next;result.set(date,{kind:'value',value:index,price_date:date});
  }
  this.sectorCache.set(cacheKey,result);return result;
 }
 private value(id:string,isSector:boolean,date:string,priceType:string){return isSector?this.sectorValues(id,priceType).get(date)||{kind:'unavailable' as const}:this.securityValue(id,date,priceType)}
 private benchmarkValue(benchmark:RsRequest['benchmark'],date:string,priceType:string){return this.value(benchmark.id,benchmark.type==='sector',date,priceType)}
 private pair(id:string,isSector:boolean,benchmark:RsRequest['benchmark'],pointDate:string,frequency:string,priceType:string):Pair{
  const active=isSector?{segment_id:`sector:${id}`}:(this.period(id,pointDate)?.market===this.release.market?this.period(id,pointDate):undefined);
  const base={date:pointDate,price_date:null,segment_id:active?.segment_id||null,benchmark_id:benchmark.id};
  if(!active)return {...base,kind:'inactive',reason:'market_lifecycle'};
  const days=frequency==='Weekly'?(this.weekDays.get(monday(pointDate))||[]).filter(d=>d<=pointDate).reverse():[pointDate];
  for(const date of days){
   if(!isSector&&this.period(id,date)?.segment_id!==active.segment_id)continue;
   const a=this.value(id,isSector,date,priceType),b=this.benchmarkValue(benchmark,date,priceType);
   if(a.kind==='unavailable'||b.kind==='unavailable')return {...base,kind:'unavailable',reason:a.kind==='unavailable'?a.reason:b.reason};
   if(a.kind==='inactive'||b.kind==='inactive')return {...base,kind:'unavailable',reason:'benchmark_lifecycle'};
   if(a.kind==='value'&&b.kind==='value'){const ratio=a.value!/b.value!;return {...base,kind:'value',price_date:date,ratio,reason:positive(ratio)?'paired':'invalid_ratio'}}
  }
  return {...base,kind:'no_input',reason:'no_common_input'};
 }
 private parentSeries(id:string,request:RsRequest,dates:string[]):Calculation[]{
  const s=this.securities.get(id);if(s?.kind!=='stock')return dates.map(date=>({...this.pair(id,false,{type:'sector',id:''},date,request.frequency,request.price_type),kind:'inactive',status:'no_result',rs_level:null,rs_momentum:null,reason:'parent_unavailable'}));
  const fixed=new Map<string,Pair[]>(),fixedResults=new Map<string,Calculation[]>();
  const get=(sector:string)=>{if(!fixed.has(sector)){const events=dates.map(d=>this.pair(id,false,{type:'sector',id:sector},d,request.frequency,request.price_type));fixed.set(sector,events);fixedResults.set(sector,calculatePairs(events,request.period))}return fixedResults.get(sector)!};
  const result:Calculation[]=[];let carried:Calculation|undefined;
  for(const [i,date] of dates.entries()){
   const period=this.period(id,date);let sector:string|null=null,chosenDate:string|null=null,unavailable=false;
   if(period?.market===this.release.market){const candidates=request.frequency==='Weekly'?(this.weekDays.get(monday(date))||[]).filter(d=>d<=date).reverse():[date];
    for(const candidate of candidates){if(this.period(id,candidate)?.segment_id!==period.segment_id)continue;const own=this.securityValue(id,candidate,request.price_type),sid=this.sectorAt(id,candidate);if(!sid){unavailable=true;break}const b=this.sectorValues(sid,request.price_type).get(candidate);if(own.kind==='unavailable'||!b||b.kind==='unavailable'){unavailable=true;break}if(own.kind==='value'&&b.kind==='value'){sector=sid;chosenDate=candidate;break}}
   }
   if(sector&&chosenDate){let point=get(sector)[i];if(request.frequency==='Weekly'&&point.price_date!==chosenDate){const a=this.securityValue(id,chosenDate,request.price_type),b=this.sectorValues(sector,request.price_type).get(chosenDate)!;const events=fixed.get(sector)!.slice(0,i+1);events[i]={...events[i],kind:'value',price_date:chosenDate,ratio:a.value!/b.value!};point=calculatePairs(events,request.period)[i]}result.push(point);carried=point;}
   else{const base={date,price_date:null,segment_id:period?.market===this.release.market?period.segment_id:null,benchmark_id:carried?.benchmark_id||'',rs_level:null,rs_momentum:null};
    const status:Status=period?.market!==this.release.market?'inactive':unavailable?'data_unavailable':carried&&carried.segment_id===period.segment_id?(carried.status==='valid'||carried.status==='stale'?'stale':carried.status):'insufficient_history';
    const point:Calculation={...base,kind:unavailable?'unavailable':'no_input',status,reason:status==='stale'?'no_input':status};result.push(point);carried=point;
   }
  }
  return result;
 }
 private benchmarkEligibility(id:string,viewingDate:string){
  const dates=this.daily.filter(d=>d<=viewingDate).slice(-240);if(dates.length!==240)reject('此標的近期交易連續性不足，暫時不可作為比較基準。','BENCHMARK_INELIGIBLE');
  let traded=0,run=0,maxRun=0;for(const date of dates){const p=this.period(id,date);if(p?.market!==this.release.market)reject('比較基準沒有完整的同市場評估期間。','BENCHMARK_INELIGIBLE');const price=this.price(id,this.release.market,date);if(!price||price.status==='unavailable')reject(messages.data_unavailable,'BENCHMARK_UNAVAILABLE');if(price!.status==='traded'){traded++;run=0}else{run++;maxRun=Math.max(maxRun,run)}}
  if(traded<228||maxRun>=4)reject('此標的近期交易連續性不足，暫時不可作為比較基準。','BENCHMARK_INELIGIBLE');
 }
 analyze(request:RsRequest):RsResult{
  const r=request,maximum=r.frequency==='Weekly'?52:240;
  if(r.market!==this.release.market||!Object.hasOwn(capacity,r.plan)||!['Stock Move','Sector Move'].includes(r.mode)||!['Daily','Weekly'].includes(r.frequency)||!['Raw','Adjusted'].includes(r.price_type)||!Number.isInteger(r.period)||r.period<5||r.period>maximum||!Number.isInteger(r.trail)||r.trail<5||r.trail>r.period||!Array.isArray(r.security_ids)||r.security_ids.length>capacity[r.plan]||new Set(r.security_ids).size!==r.security_ids.length||r.security_ids.some(id=>!this.securities.has(id)||this.securities.get(id)?.kind==='index'))reject('分析條件、標的或期間不適用。');
  if(r.plan==='Anonymous'&&(r.frequency!=='Daily'||r.period!==20||r.trail!==5||r.price_type!=='Adjusted')||r.plan==='Free'&&(r.frequency!=='Daily'||![20,60,120].includes(r.period)||![5,10,20].includes(r.trail)))reject('分析條件超出目前模擬方案。');
  if(!r.benchmark||!['market','security','sector','parent'].includes(r.benchmark.type)||typeof r.benchmark.id!=='string'||(r.benchmark.type==='parent'?r.benchmark.id!=='':!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(r.benchmark.id))||(r.plan!=='Pro'||r.mode==='Sector Move')&&r.benchmark.type!=='market'||r.mode==='Sector Move'&&r.security_ids.length)reject('基準或產業集合不適用。');
  const visible=this.visibleDates(r.plan,r.frequency),viewing=(r.viewing_date==='Latest'?visible.at(-1):r.viewing_date)||reject('沒有已完成且可查看的端點。','DATE_OUT_OF_RANGE');
  if(!visible.includes(viewing))reject('檢視日期不在目前可查看的已完成端點內。','DATE_OUT_OF_RANGE');
  if(r.benchmark.type==='security'){const s=this.securities.get(r.benchmark.id);if(!s||!['stock','etf'].includes(s.kind))reject('比較基準身分不適用。');this.benchmarkEligibility(r.benchmark.id,viewing)}
  if(r.benchmark.type==='market'){const s=this.securities.get(r.benchmark.id);if(s?.kind!=='index'||s.code!==(r.market==='TWSE'?'TAIEX':'TPEX'))reject('啟用版本缺少明確的同市場指數基準。','BENCHMARK_UNAVAILABLE')}
  if(r.benchmark.type==='sector'&&this.sectors.get(r.benchmark.id)?.market!==r.market)reject('產業基準不屬於所選市場。');
  const dates=this.endpointDates(r.frequency).filter(d=>d<=viewing),left=visible[0];
  const ids=r.mode==='Stock Move'?r.security_ids:[...this.sectors.values()].filter(s=>s.market===r.market&&[...this.securities.values()].some(e=>e.kind==='stock'&&this.period(e.security_id,viewing)?.market===r.market&&this.sectorAt(e.security_id,viewing)===s.sector_id)).map(s=>s.sector_id);
  const entities=ids.map(id=>{
   const isSector=r.mode==='Sector Move',security=this.securities.get(id),sector=isSector?this.sectors.get(id):undefined;
   const cacheKey=JSON.stringify([id,isSector,r.frequency,r.period,r.price_type,r.benchmark.type,r.benchmark.id]);
   let full=this.calculationCache.get(cacheKey);if(full){this.calculationCache.delete(cacheKey);this.calculationCache.set(cacheKey,full)}else{const allDates=this.endpointDates(r.frequency);full=r.benchmark.type==='parent'?this.parentSeries(id,r,allDates):calculatePairs(allDates.map(date=>this.pair(id,isSector,r.benchmark,date,r.frequency,r.price_type)),r.period);if(full.length<=200_000){this.calculationCache.set(cacheKey,full);this.cachedObservations+=full.length;while(this.calculationCache.size>512||this.cachedObservations>200_000){const oldest=this.calculationCache.keys().next().value!;this.cachedObservations-=this.calculationCache.get(oldest)!.length;this.calculationCache.delete(oldest)}}}
   // Select from the same sorted calculation series in one pass. RS values are
   // unchanged; avoid repeated arrays and per-date gap maps for every playback frame.
   const self=!isSector&&r.benchmark.type==='security'&&id===r.benchmark.id;
   const currentPeriod=isSector?undefined:this.period(id,viewing),currentSegment=isSector?`sector:${id}`:currentPeriod?.market===r.market?currentPeriod.segment_id:null;
   const valid:Calculation[]=[],gapCounts:number[]=[];let gapCount=0,last:Calculation|undefined,prior:Calculation|undefined,transition:RsEntity['transition']=null;
   for(const original of full){
    if(original.date>viewing)break;
    const p=self?{...original,status:'no_result' as const,rs_level:null,rs_momentum:null,reason:'self'}:original;last=p;
    if(p.date<left||p.segment_id!==currentSegment)continue;
    if(!['valid','stale'].includes(p.status))gapCount++;
    if(p.status==='valid'&&p.rs_level!==null&&p.rs_momentum!==null){valid.push(p);gapCounts.push(gapCount)}
    if(p.status==='stale')continue;
    if(p.status!=='valid'){prior=undefined;continue}
    if(prior&&prior.benchmark_id===p.benchmark_id&&quadrant([prior.rs_level!,prior.rs_momentum!])!==quadrant([p.rs_level!,p.rs_momentum!]))transition={from:quadrant([prior.rs_level!,prior.rs_momentum!]),to:quadrant([p.rs_level!,p.rs_momentum!]),point_date:p.date,previous_date:prior.date};
    prior=p;
   }
   const offset=Math.max(0,valid.length-r.trail),trail=valid.slice(offset);
   let status=last?.status||'insufficient_history',reason=last?.reason||'insufficient_history';if(status==='stale'&&!trail.length){status='no_result';reason='history_left_boundary'}
   const points:RsPoint[]=trail.map((p,i)=>({point_date:p.date,price_date:p.price_date!,rs_level:p.rs_level!,rs_momentum:p.rs_momentum!,benchmark_id:p.benchmark_id,segment_id:p.segment_id!,gap_before:i===0?null:gapCounts[offset+i]>gapCounts[offset+i-1]}));
   const changes:RsEntity['industry_changes']=[];if(!isSector){const members=this.memberships.get(id)||[];for(let i=1;i<members.length;i++){const a=members[i-1],b=members[i];if(b.valid_from>=left&&b.valid_from<=viewing&&a.sector_id!==b.sector_id&&this.period(id,b.valid_from)?.market===r.market)changes.push({date:b.valid_from,from:a.sector_id,to:b.sector_id,benchmark_changed:r.benchmark.type==='parent'&&points.some(p=>p.benchmark_id===b.sector_id&&p.point_date>=b.valid_from)})}}
   return {id,code:security?.code||id,name:sector?.name||security!.name,market:r.market,sector:isSector?sector!.name:this.sectors.get(this.sectorAt(id,viewing)||'')?.name||'—',status,reason,message:messages[reason]||messages[status]||messages.no_result,points,requested_trail:r.trail,actual_trail:points.length,trail_complete:points.length===r.trail,transition,industry_changes:changes,initialization_limited:isSector||r.benchmark.type==='sector'||r.benchmark.type==='parent'};
  });
  return {method_version:rsMethod,market:r.market,frequency:r.frequency,viewing_date:viewing,history_start:left,latest:visible.at(-1)!,entities};
 }
}
