import {analysisDates,stateDates,analysisIssues,catalog,sectorsForMarket,entityStatus,initialState,statuses,visibleSamples,type AnalysisState,type DatedPoint,type Entity,type Plan,type Status,type RuntimeData} from '../components/twstock/model';
import {decodeInputVersion,type InputVersion} from './dataVersions';
import {decodeComputedResponse,type ComputedResponse} from './rsContract';

// Local demo contract only: mock_plan is not authentication or a paid entitlement.
export type AnalysisRequest={client_request_id:string;mock_plan:Plan;mode:string;market:string;benchmark_type:string;benchmark:string;frequency:string;period:number;trail:number;price_type:string;viewing_date:string;security_ids:string[];demo_status_overrides:Record<string,Status>;input_version?:InputVersion};
export type ApiSample={point_date:string;price_date:null;rs_level:number|null;rs_momentum:number|null};
export type MockAnalysisResponse={contract_version:1;source:'mock';release_id:'mock-2026-09-v1';input_version?:InputVersion;request_id:string;client_request_id:string;request_key:string;viewing_date:string;entities:{id:string;name:string;market:string;sector:string;status:Status;samples:ApiSample[]}[]};
export type AnalysisResponse=MockAnalysisResponse|ComputedResponse;
export type AnalysisData={entities:Entity[];samples:Record<string,DatedPoint[]>;source?:'computed';viewingDate?:string;historyStart?:string;version?:{result_release_id:string;method_version?:string;dataset_kind?:'test'|'source';input:InputVersion}};
export class AnalysisError extends Error{constructor(public code:string,message:string,public status=422){super(message)}}
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const fail=(message='分析請求格式不正確。'):never=>{throw new AnalysisError('INVALID_ANALYSIS',message)};
const statusValid=(value:unknown):value is Status=>typeof value==='string'&&Object.hasOwn(statuses,value);
export function createAnalysisRequest(state:AnalysisState,requestId=''):AnalysisRequest{
 const ids=state.mode==='Stock Move'?state.currentList:sectorsForMarket(state.market,state.runtime).map(e=>e.id);
 return {client_request_id:requestId,mock_plan:state.plan,mode:state.mode,market:state.market,benchmark_type:state.benchmarkType,benchmark:state.benchmark,frequency:state.frequency,period:Number.parseInt(state.period,10),trail:state.trail,price_type:state.priceType,viewing_date:stateDates(state)[state.viewingDate]||'',security_ids:state.mode==='Stock Move'?[...state.currentList]:[],demo_status_overrides:Object.fromEntries(ids.filter(id=>Object.hasOwn(state.statusOverrides,id)).map(id=>[id,state.statusOverrides[id]])),...(state.runtime?{input_version:state.runtime.input}:{})};
}
export function requestKey(request:AnalysisRequest):string{
 const {client_request_id,...analysis}=request;
 return JSON.stringify({...analysis,demo_status_overrides:Object.fromEntries(Object.entries(analysis.demo_status_overrides).sort(([a],[b])=>a.localeCompare(b)))});
}
export function validateAnalysisRequest(value:unknown,runtime?:RuntimeData):{request:AnalysisRequest;state:AnalysisState}{
 if(!object(value))return fail();
 const fields=['client_request_id','mock_plan','mode','market','benchmark_type','benchmark','frequency','period','trail','price_type','viewing_date','security_ids','demo_status_overrides'];
 if(fields.some(key=>!Object.hasOwn(value,key))||Object.keys(value).some(key=>!fields.includes(key)&&key!=='input_version'))return fail('分析請求含未支援或遺漏的欄位。');
 if(Object.hasOwn(value,'input_version')){try{decodeInputVersion(value.input_version,String(value.market))}catch{return fail('輸入版本格式不正確。')}}
 if(runtime&&value.input_version&&Object.keys(runtime.input).some(k=>runtime.input[k as keyof InputVersion]!==((value.input_version as InputVersion)[k as keyof InputVersion])))throw new AnalysisError('INPUT_VERSION_CHANGED','行情輸入版本已變更，請重新讀取分析條件。',409);
 if(typeof value.client_request_id!=='string'||!/^[a-zA-Z0-9_-]{1,80}$/.test(value.client_request_id))return fail('請求識別格式不正確。');
 if(typeof value.mock_plan!=='string'||!['Anonymous','Free','Pro'].includes(value.mock_plan))return fail('模擬方案不適用。');
 for(const key of ['mode','market','benchmark_type','benchmark','frequency','price_type','viewing_date'])if(typeof value[key]!=='string'||(value[key] as string).length>96)return fail();
 if(!['Daily','Weekly'].includes(value.frequency as string)||!Number.isInteger(value.period)||!Number.isInteger(value.trail))return fail('頻率、期間或軌跡格式不正確。');
 if(!Array.isArray(value.security_ids)||value.security_ids.length>100||value.security_ids.some(id=>typeof id!=='string'||!(runtime?/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/:/^(\d{4,6}|DEMO[1-4])$/).test(id))||new Set(value.security_ids).size!==value.security_ids.length)return fail('股票身分須唯一，且不得超過 100 檔。');
 if(value.mode==='Sector Move'&&value.security_ids.length)return fail('產業模式使用全市場產業，不接受股票或產業子集。');
 if(!object(value.demo_status_overrides))return fail('模擬狀態格式不正確。');
 const activeIds=value.mode==='Stock Move'?value.security_ids:sectorsForMarket(value.market as string,runtime).map(e=>e.id);
 if(runtime&&Object.keys(value.demo_status_overrides).length)return fail('價格運算不接受模擬狀態覆寫，請清除狀態展示設定。');
 if(Object.keys(value.demo_status_overrides).length>100||Object.entries(value.demo_status_overrides).some(([id,status])=>!activeIds.includes(id)||!statusValid(status)))return fail('模擬狀態不適用於本次標的。');
 const request=value as unknown as AnalysisRequest;
 const available=analysisDates(request.frequency,runtime),index=request.viewing_date==='Latest'?available.length-1:available.indexOf(request.viewing_date);
 const state:AnalysisState={...initialState,runtime,plan:request.mock_plan,mode:request.mode,market:request.market,benchmarkType:request.benchmark_type,benchmark:request.benchmark,frequency:request.frequency,period:String(request.period)+(request.frequency==='Weekly'?'W':'D'),trail:request.trail,priceType:request.price_type,viewingDate:index,currentList:[...request.security_ids],statusOverrides:{...request.demo_status_overrides}};
 const issues=analysisIssues(state);if(issues.length)return fail(issues.join('；'));
 return {request,state};
}
export function buildMockAnalysis(value:unknown,requestId:string):MockAnalysisResponse{
 const {request,state}=validateAnalysisRequest(value);
 const entities=state.mode==='Stock Move'?state.currentList.map(id=>catalog.find(e=>e.id===id)!):sectorsForMarket(state.market);
 return {contract_version:1,source:'mock',release_id:'mock-2026-09-v1',request_id:requestId,client_request_id:request.client_request_id,request_key:requestKey(request),viewing_date:analysisDates(state.frequency)[state.viewingDate],entities:entities.map(entity=>({id:entity.id,name:entity.name,market:entity.market,sector:entity.sector,status:entityStatus(entity,state),samples:visibleSamples(entity,state).map(sample=>({point_date:sample.date,price_date:null,rs_level:sample.point?.[0]??null,rs_momentum:sample.point?.[1]??null}))}))};
}
export function decodeAnalysisResponse(value:unknown,request:AnalysisRequest,runtime?:RuntimeData):{response:AnalysisResponse;data:AnalysisData}{
 if(object(value)&&value.source==='computed')return decodeComputedResponse(value,request,requestKey(request),runtime);
 const invalid=():never=>{throw new AnalysisError('INVALID_RESPONSE','後端回傳的示範資料格式不正確，請重試。',502)};
 if(request.input_version)return invalid();
 if(!object(value)||value.contract_version!==1||value.source!=='mock'||value.release_id!=='mock-2026-09-v1'||typeof value.request_id!=='string'||value.request_id.length>100||value.client_request_id!==request.client_request_id||value.request_key!==requestKey(request)||!Array.isArray(value.entities))return invalid();
 const viewingDate=request.viewing_date==='Latest'?analysisDates(request.frequency).at(-1):request.viewing_date;
 const expectedIds=request.mode==='Stock Move'?request.security_ids:sectorsForMarket(request.market).map(e=>e.id);
 if(value.viewing_date!==viewingDate||value.entities.length!==expectedIds.length)return invalid();
 const samples:Record<string,DatedPoint[]>={},entities:Entity[]=[];
 for(const [index,item] of value.entities.entries()){
  if(!object(item)||item.id!==expectedIds[index]||item.market!==request.market||typeof item.name!=='string'||item.name.length>100||typeof item.sector!=='string'||item.sector.length>100||!statusValid(item.status)||!Array.isArray(item.samples)||item.samples.length>analysisDates(request.frequency).length)return invalid();
  const id=item.id as string;let previous='';let count=0;
  samples[id]=item.samples.map(sample=>{
   if(!object(sample)||typeof sample.point_date!=='string'||!analysisDates(request.frequency).includes(sample.point_date)||sample.point_date>viewingDate!||sample.point_date<=previous||sample.price_date!==null)return invalid();
   previous=sample.point_date;
   if(sample.rs_level===null&&sample.rs_momentum===null)return {date:sample.point_date,point:null};
   if(typeof sample.rs_level!=='number'||!Number.isFinite(sample.rs_level)||typeof sample.rs_momentum!=='number'||!Number.isFinite(sample.rs_momentum))return invalid();
   count++;return {date:sample.point_date,point:[sample.rs_level,sample.rs_momentum]};
  });
  if(count>request.trail||(!['valid','stale'].includes(item.status)&&item.samples.length))return invalid();
  entities.push({id,name:item.name,market:item.market,sector:item.sector,status:item.status,points:[]});
 }
 let input:InputVersion|undefined;if(Object.hasOwn(value,'input_version'))try{input=decodeInputVersion(value.input_version,request.market)}catch{return invalid()}
 return {response:value as unknown as AnalysisResponse,data:{entities,samples,...(input?{version:{result_release_id:'mock-2026-09-v1' as const,input}}:{})}};
}
