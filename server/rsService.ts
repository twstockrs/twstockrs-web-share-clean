import {ReleaseStore} from './releaseStore';
import {compactPlayback} from './playback';
import {RsDataset,type RsRequest} from './rsEngine';
import {AnalysisError,buildMockAnalysis,requestKey,validateAnalysisRequest} from '../shared/mockAnalysis';
import {exactFields,mockPlan} from '../shared/libraryContract';
import type {InputVersion,VersionMarket} from '../shared/dataVersions';
import type {RuntimeData,Plan} from '../components/twstock/model';
import type {ComputedResponse} from '../shared/rsContract';
import type {PlaybackResponse} from '../shared/playback';

export class RsService{
 private cache=new Map<VersionMarket,{id:string;digest:string;dataset:RsDataset}>();
 private playbacks=new Map<string,{market:VersionMarket;bytes:number;value:PlaybackResponse}>();
 private playbackBytes=0;
 private playbackHits=0;
 private playbackMisses=0;
 playbackCacheStats(){return {entries:this.playbacks.size,bytes:this.playbackBytes,max_entries:4,max_bytes:32*1024*1024,hits:this.playbackHits,misses:this.playbackMisses}}
 constructor(private versions:ReleaseStore){}
 private dataset(pin:InputVersion){
  if(!pin.release_id||!pin.digest)throw new AnalysisError('NO_ACTIVE_VERSION','此市場尚未啟用價格版本。');
  const previous=this.cache.get(pin.market);if(previous?.id===pin.release_id&&previous.digest===pin.digest)return previous.dataset;
  for(const [key,entry] of this.playbacks)if(entry.market===pin.market){this.playbacks.delete(key);this.playbackBytes-=entry.bytes}
  const {release,packages}=this.versions.readRuntimeVersion(pin.release_id,pin.market),dataset=new RsDataset(release,packages);this.cache.set(pin.market,{id:pin.release_id,digest:pin.digest,dataset});return dataset;
 }
 runtime(market:VersionMarket,plan:Plan):RuntimeData|undefined{
  const input=this.versions.inputVersion(market);if(!input.release_id)return;
  const dataset=this.dataset(input),latest=dataset.daily.at(-1)!;
  const catalog=[...dataset.securities.values()].filter(s=>s.kind!=='index'&&dataset.periods.get(s.security_id)?.some(p=>p.market===market)).map(s=>({id:s.security_id,code:s.code,name:s.name,kind:s.kind as 'stock'|'etf',market,sector:dataset.sectors.get(dataset.sectorAt(s.security_id,latest)||'')?.name||'—',searchable:dataset.period(s.security_id,latest)?.market===market,status:'valid' as const,points:[]}));
  const sectors=[...dataset.sectors.values()].filter(s=>s.market===market).map(s=>({id:s.sector_id,name:s.name,kind:'sector' as const,market,sector:s.name,status:'valid' as const,points:[]}));
  const benchmark=[...dataset.securities.values()].find(s=>s.kind==='index'&&s.code===(market==='TWSE'?'TAIEX':'TPEX')&&dataset.period(s.security_id,latest)?.market===market);
  const Daily=dataset.visibleDates(plan,'Daily'),Weekly=plan==='Pro'?dataset.visibleDates(plan,'Weekly'):[],left=[Daily[0],Weekly[0]].filter(Boolean).sort()[0],end=new Date(Date.parse(latest)+86400000).toISOString().slice(0,10);
  const market_periods=catalog.flatMap(s=>(dataset.periods.get(s.id)||[]).filter(p=>p.market===market).flatMap(p=>{const valid_from=[p.valid_from,left].sort().at(-1)!,valid_to=[p.valid_to||end,end].sort()[0];return valid_from<valid_to?[{security_id:s.id,valid_from,valid_to}]:[]}));
  const periodMap=new Map<string,typeof market_periods>();for(const p of market_periods){const list=periodMap.get(p.security_id)||[];list.push(p);periodMap.set(p.security_id,list)}
  const memberships=catalog.flatMap(s=>(dataset.memberships.get(s.id)||[]).flatMap(m=>(periodMap.get(s.id)||[]).flatMap(p=>{const valid_from=[m.valid_from,p.valid_from].sort().at(-1)!,valid_to=[m.valid_to||end,p.valid_to].sort()[0];return valid_from<valid_to&&dataset.sectors.get(m.sector_id)?.market===market?[{security_id:s.id,sector_id:m.sector_id,valid_from,valid_to}]:[]})));
  this.versions.handle('check',input);
  return {market,input,dataset_kind:input.dataset_kind!,Daily,Weekly,catalog,sectors,market_benchmark:benchmark?.security_id||null,memberships,market_periods};
 }
 context(value:unknown){exactFields(value,['market','mock_plan']);if(value.market!=='TWSE'&&value.market!=='TPEx')throw new AnalysisError('INVALID_ANALYSIS','市場不適用。');const plan=mockPlan(value.mock_plan),runtime=this.runtime(value.market,plan);return {runtime:runtime||null,input_version:runtime?.input||this.versions.inputVersion(value.market)}}
 analyze(value:unknown,requestId:string){
  if(!value||typeof value!=='object'||!('market' in value)||!['TWSE','TPEx'].includes(String(value.market)))return buildMockAnalysis(value,requestId);
  const raw=value as Record<string,unknown>,market=raw.market as VersionMarket;
  if(typeof raw.mock_plan!=='string'||!['Anonymous','Free','Pro'].includes(raw.mock_plan))return buildMockAnalysis(value,requestId);
  const plan=raw.mock_plan as Plan,runtime=this.runtime(market,plan);
  if(!runtime){if(raw.input_version)throw new AnalysisError('INPUT_VERSION_CHANGED','行情輸入版本已變更，請重新讀取分析條件。',409);const result=buildMockAnalysis(value,requestId);result.input_version=this.versions.inputVersion(market);return result}
  if(!raw.input_version)throw new AnalysisError('INPUT_VERSION_CHANGED','已啟用價格版本，請重新讀取分析條件後再運算。',409);
  this.versions.handle('check',raw.input_version);
  const {request}=validateAnalysisRequest(value,runtime),dataset=this.dataset(runtime.input);
  if(request.benchmark_type==='market'&&!runtime.market_benchmark)throw new AnalysisError('BENCHMARK_UNAVAILABLE','啟用版本缺少此市場的指數價格基準，請匯入包含 TAIEX／TPEX 指數的完整價格包。');
  const benchmark={type:request.benchmark_type as RsRequest['benchmark']['type'],id:request.benchmark_type==='market'?runtime.market_benchmark||'':request.benchmark};
  const result=dataset.analyze({market,plan,mode:request.mode as RsRequest['mode'],frequency:request.frequency as RsRequest['frequency'],period:request.period,trail:request.trail,price_type:request.price_type as RsRequest['price_type'],viewing_date:request.viewing_date,security_ids:request.security_ids,benchmark});
  this.versions.handle('check',runtime.input);
  const response:ComputedResponse={...result,contract_version:2,source:'computed',dataset_kind:runtime.dataset_kind,release_id:`rs_v1-${runtime.input.digest}`,input_version:runtime.input,request_id:requestId,client_request_id:request.client_request_id,request_key:requestKey(request)};
  return response;
 }
 playback(value:unknown,requestId:string){
  const raw=value as Record<string,unknown>;if(!raw||raw.mock_plan!=='Pro'||!['TWSE','TPEx'].includes(String(raw.market)))throw new AnalysisError('PLAYBACK_LOCKED','播放僅供有效 Pro 帳號使用。',403);
  const market=raw.market as VersionMarket,runtime=this.runtime(market,'Pro');if(!runtime)throw new AnalysisError('NO_ACTIVE_VERSION','批次播放需要已啟用的價格版本。');
  const {request}=validateAnalysisRequest(value,runtime);this.versions.handle('check',request.input_version);const dataset=this.dataset(runtime.input);
  const key=requestKey({...request,viewing_date:'Latest'}),cached=this.playbacks.get(key);
  if(cached){
   this.versions.handle('check',runtime.input);this.playbacks.delete(key);this.playbacks.set(key,cached);this.playbackHits++;
   const result=structuredClone(cached.value);result.base.request_id=requestId;result.base.client_request_id=request.client_request_id;return result;
  }
  this.playbackMisses++;
  const benchmark={type:request.benchmark_type as RsRequest['benchmark']['type'],id:request.benchmark_type==='market'?runtime.market_benchmark||'':request.benchmark};
  const dates=request.frequency==='Weekly'?runtime.Weekly:runtime.Daily;
  const result=compactPlayback(request,dates,date=>({...dataset.analyze({market,plan:'Pro',mode:request.mode as RsRequest['mode'],frequency:request.frequency as RsRequest['frequency'],period:request.period,trail:request.trail,price_type:request.price_type as RsRequest['price_type'],viewing_date:date,security_ids:request.security_ids,benchmark}),contract_version:2,source:'computed',dataset_kind:runtime.dataset_kind,release_id:`rs_v1-${runtime.input.digest}`,input_version:runtime.input,request_id:requestId,client_request_id:request.client_request_id,request_key:requestKey({...request,viewing_date:date})}));
  this.versions.handle('check',runtime.input);
  const bytes=Buffer.byteLength(JSON.stringify(result));
  if(bytes<=32*1024*1024){this.playbacks.set(key,{market,bytes,value:structuredClone(result)});this.playbackBytes+=bytes;while(this.playbacks.size>4||this.playbackBytes>32*1024*1024){const oldest=this.playbacks.keys().next().value!;this.playbackBytes-=this.playbacks.get(oldest)!.bytes;this.playbacks.delete(oldest)}}
  return result;
 }
 // Stable-ID core interface, including Parent Sector; no prototype catalogue dependency.
 compute(value:unknown,requestId:string){
  exactFields(value,['input_version','analysis']);const pin=value.input_version;
  this.versions.handle('check',pin);const input=pin as InputVersion;
  exactFields(value.analysis,['market','plan','mode','frequency','period','trail','price_type','viewing_date','security_ids','benchmark']);exactFields(value.analysis.benchmark,['type','id']);
  if(value.analysis.market!==input.market)throw new AnalysisError('INVALID_RS','分析與輸入版本市場不同。');
  const result=this.dataset(input).analyze(value.analysis as unknown as RsRequest);this.versions.handle('check',input);
  return {...result,source:'computed',dataset_kind:input.dataset_kind,release_id:`rs_v1-${input.digest}`,input_version:input,request_id:requestId};
 }
}
