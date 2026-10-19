// Internal normalized input contract. External source columns require an explicit adapter.
export const importWebLimit=8*1024*1024;
export const importFileLimit=512*1024*1024;
type Market='TWSE'|'TPEx';
export type Security={security_id:string;code:string;name:string;kind:'stock'|'etf'|'index'};
export type MarketPeriod={segment_id:string;security_id:string;market:Market;valid_from:string;valid_to:string|null;adjustment_reference_date?:string|null};
export type CalendarDay={market:Market;date:string;is_open:boolean};
export type Sector={sector_id:string;market:Market;name:string};
export type Membership={security_id:string;sector_id:string;valid_from:string;valid_to:string|null};
export type Price={security_id:string;market:Market;date:string;status:'traded'|'suspended'|'no_trade'|'unavailable';raw_close:number|null;adjusted_close:number|null;volume:number|null;reason:string|null;no_price_basis?:'regular_session_no_trade'|'official_suspension'|null;source_ref?:string};
export type ImportPackage={format:'TWStockRS-price-import';version:1|2;manifest:{price_scope?:'regular_session';volume_scope?:'official_daily_aggregate';batch_id:string;dataset_kind:'test'|'source';source:string;source_version:string;created_at:string;date_from:string;date_to:string;markets:Market[];timezone:'Asia/Taipei';currency:'TWD';adjustment:{method:string;version:string;reference_date:string}};securities:Security[];market_periods:MarketPeriod[];calendar:CalendarDay[];sectors:Sector[];memberships:Membership[];prices:Price[]};
export type ImportIssue={code:string;table:string;row:number|null;field:string;message:string};
export type ImportReport={format:'TWStockRS-import-report';version:1;checked_at:string;batch_id:string|null;dataset_kind:'test'|'source'|null;sha256:string;ok:boolean;error_count:number;details_truncated:boolean;issues:ImportIssue[];counts:{securities:number;market_periods:number;calendar:number;sectors:number;memberships:number;prices:number;expected_prices:number};note:string};
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/.test(v);
const label=(v:unknown,max=120):v is string=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\u0000-\u001f]/.test(v);
export function validImportDate(v:unknown):v is string{if(typeof v!=='string'||!/^\d{4}-\d\d-\d\d$/.test(v)||v<'1990-01-01'||v>'2100-12-31')return false;const n=Date.parse(v+'T00:00:00Z');return Number.isFinite(n)&&new Date(n).toISOString().slice(0,10)===v}
const timestamp=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const market=(v:unknown):v is Market=>v==='TWSE'||v==='TPEx';
const positive=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>0&&v<=1e12;
const interval=(from:unknown,to:unknown)=>validImportDate(from)&&(to===null||validImportDate(to)&&from<to);
const contains=(p:{valid_from:string;valid_to:string|null},date:string)=>p.valid_from<=date&&(p.valid_to===null||date<p.valid_to);
const overlaps=(a:{valid_from:string;valid_to:string|null},b:{valid_from:string;valid_to:string|null})=>a.valid_from<(b.valid_to||'9999')&&b.valid_from<(a.valid_to||'9999');
function activeAt<T extends {valid_from:string;valid_to:string|null}>(list:T[]|undefined,date:string):T|undefined{if(!list)return;let lo=0,hi=list.length;while(lo<hi){const mid=(lo+hi)>>>1;if(list[mid].valid_from<=date)lo=mid+1;else hi=mid}const found=list[lo-1];return found&&contains(found,date)?found:undefined}
function firstDate(list:CalendarDay[],date:string){let lo=0,hi=list.length;while(lo<hi){const mid=(lo+hi)>>>1;if(list[mid].date<date)lo=mid+1;else hi=mid}return lo}
export function validateImportText(text:unknown,maxBytes=importFileLimit):{report:ImportReport;data:ImportPackage|null}{
 const dateChecks=new Map<string,boolean>(),checkedDate=(v:unknown):v is string=>{if(typeof v!=='string')return false;const found=dateChecks.get(v);if(found!==undefined)return found;const valid=validImportDate(v);if(dateChecks.size<8192)dateChecks.set(v,valid);return valid};
 const report:ImportReport={format:'TWStockRS-import-report',version:1,checked_at:new Date().toISOString(),batch_id:null,dataset_kind:null,sha256:'',ok:false,error_count:0,details_truncated:false,issues:[],counts:{securities:0,market_periods:0,calendar:0,sectors:0,memberships:0,prices:0,expected_prices:0},note:'檢查通過僅代表符合內部匯入規則；來源真實性仍須核對。資料只進暫存區，圖表維持示範，尚未發布或計算 RS。'};
 const issue=(code:string,table:string,row:number|null,field:string,message:string)=>{report.error_count++;if(report.issues.length<500)report.issues.push({code,table,row,field,message});else report.details_truncated=true};
 const fail=(code:string,message:string)=>{issue(code,'package',null,'',message);return {report,data:null}};
 if(typeof text!=='string'||(typeof Buffer!=='undefined'?Buffer.byteLength(text,'utf8'):new TextEncoder().encode(text).length)>maxBytes)return fail('FILE_SIZE','檔案不是文字或超過此入口的大小限制。');
 let value:unknown;try{value=JSON.parse(text.replace(/^\uFEFF/,''))}catch{return fail('INVALID_JSON','檔案不是有效 JSON（文字資料格式）。')}
 const shape=(v:unknown,keys:string[],table:string,row:number|null):v is Record<string,unknown>=>{if(!record(v)||keys.some(k=>!Object.hasOwn(v,k))||Object.keys(v).some(k=>!keys.includes(k))){issue('FIELDS',table,row,'','必要欄位遺漏或含未支援欄位。');return false}return true};
 if(!shape(value,['format','version','manifest','securities','market_periods','calendar','sectors','memberships','prices'],'package',null))return {report,data:null};
 if(value.format!=='TWStockRS-price-import'||![1,2].includes(value.version as number))return fail('FORMAT_VERSION','匯入格式或版本不支援。');
 if(!shape(value.manifest,['batch_id','dataset_kind','source','source_version','created_at','date_from','date_to','markets','timezone','currency','adjustment',...(value.version===2?['price_scope','volume_scope']:[])],'manifest',null))return {report,data:null};
 const meta=value.manifest;
 if(value.version===2&&(meta.price_scope!=='regular_session'||meta.volume_scope!=='official_daily_aggregate'))issue('OBSERVATION_SCOPE','manifest',null,'','v2 必須明確分開一般交易時段價格與官方全日合計量。');
 if(!id(meta.batch_id)||!['test','source'].includes(String(meta.dataset_kind))||typeof meta.dataset_kind!=='string'||!label(meta.source)||!label(meta.source_version)||!timestamp(meta.created_at)||!checkedDate(meta.date_from)||!checkedDate(meta.date_to)||meta.date_from>meta.date_to||meta.timezone!=='Asia/Taipei'||meta.currency!=='TWD'||!Array.isArray(meta.markets)||!meta.markets.length||meta.markets.length>2||!meta.markets.every(market)||new Set(meta.markets).size!==meta.markets.length)issue('MANIFEST','manifest',null,'','批次身分、來源版本、日期範圍、市場、時區或幣別不正確。');
 if(!shape(meta.adjustment,['method','version','reference_date'],'manifest',null)||!label(meta.adjustment.method)||!label(meta.adjustment.version)||!checkedDate(meta.adjustment.reference_date))issue('ADJUSTMENT','manifest',null,'adjustment','必須明確提供同批還原方法、版本與基準日期。');
 if(report.error_count)return {report,data:null};
 const sourceDay=new Date(Date.parse(meta.created_at as string)+8*3600_000).toISOString().slice(0,10);
 if((meta.date_to as string)>sourceDay||((meta.adjustment as Record<string,unknown>).reference_date as string)>sourceDay){issue('SOURCE_DATE','manifest',null,'created_at','資料範圍及還原基準日不得晚於來源建立日期（台北時間）。');return {report,data:null}}
 if((Date.parse(meta.date_to as string)-Date.parse(meta.date_from as string))/86400000>3660){issue('DATE_RANGE','manifest',null,'date_to','每批日期範圍最多 3661 天，請依市場與日期拆批。');return {report,data:null}}
 report.batch_id=meta.batch_id as string;report.dataset_kind=meta.dataset_kind as 'test'|'source';
 const tables=['securities','market_periods','calendar','sectors','memberships','prices'] as const;
 const limits={securities:20_000,market_periods:100_000,calendar:100_000,sectors:10_000,memberships:200_000,prices:3_000_000};
 for(const table of tables){if(!Array.isArray(value[table])||value[table].length>limits[table])issue('TABLE_SIZE',table,null,'','資料表須為陣列且不能超過筆數限制。');else report.counts[table]=value[table].length}
 if(report.error_count)return {report,data:null};
 const p=value as unknown as ImportPackage;
 const checks={
  securities:{keys:['security_id','code','name','kind'],test:(r:Record<string,unknown>)=>id(r.security_id)&&typeof r.code==='string'&&(r.kind==='index'?/^[A-Za-z0-9][A-Za-z0-9._:-]{0,31}$/:/^\d{4,6}$/).test(r.code)&&label(r.name)&&['stock','etf','index'].includes(String(r.kind))&&typeof r.kind==='string'},
  market_periods:{keys:['segment_id','security_id','market','valid_from','valid_to',...(p.version===2?['adjustment_reference_date']:[])],test:(r:Record<string,unknown>)=>id(r.segment_id)&&id(r.security_id)&&market(r.market)&&interval(r.valid_from,r.valid_to)&&(p.version===1||r.adjustment_reference_date===null||checkedDate(r.adjustment_reference_date)&&r.adjustment_reference_date<=sourceDay)},
  calendar:{keys:['market','date','is_open'],test:(r:Record<string,unknown>)=>market(r.market)&&checkedDate(r.date)&&typeof r.is_open==='boolean'},
  sectors:{keys:['sector_id','market','name'],test:(r:Record<string,unknown>)=>id(r.sector_id)&&market(r.market)&&label(r.name)},
  memberships:{keys:['security_id','sector_id','valid_from','valid_to'],test:(r:Record<string,unknown>)=>id(r.security_id)&&id(r.sector_id)&&interval(r.valid_from,r.valid_to)},
  prices:{keys:['security_id','market','date','status','raw_close','adjusted_close','volume','reason',...(p.version===2?['no_price_basis','source_ref']:[])],test:(r:Record<string,unknown>)=>id(r.security_id)&&market(r.market)&&checkedDate(r.date)&&typeof r.status==='string'&&['traded','suspended','no_trade','unavailable'].includes(r.status)&&(r.raw_close===null||typeof r.raw_close==='number'&&Number.isFinite(r.raw_close)&&r.raw_close>=0&&r.raw_close<=1e12)&&(r.adjusted_close===null||typeof r.adjusted_close==='number'&&Number.isFinite(r.adjusted_close)&&r.adjusted_close>=0&&r.adjusted_close<=1e12)&&(r.volume===null||typeof r.volume==='number'&&Number.isSafeInteger(r.volume)&&r.volume>=0)&&(r.reason===null||label(r.reason,240))&&(p.version===1||typeof r.source_ref==='string'&&/^[a-f0-9]{64}$/.test(r.source_ref)&&[null,'regular_session_no_trade','official_suspension'].includes(r.no_price_basis as any))}
 };
 for(const table of tables)p[table].forEach((row,i)=>{const c=checks[table];if(shape(row,c.keys,table,i+1)&&!c.test(row))issue('FIELD_VALUE',table,i+1,'','日期、身分、型別、數值或狀態格式不正確；不自動轉型或補值。')});
 // Do not run relational checks on malformed rows, avoiding fabricated references or crashes.
 if(report.error_count)return {report,data:null};
 const securities=new Map<string,Security>(),sectors=new Map<string,Sector>(),periods=new Map<string,MarketPeriod[]>(),members=new Map<string,Membership[]>(),calendar=new Map<string,CalendarDay>(),prices=new Map<string,Map<string,Set<string>>>(),unknownPrices=new Set<string>(),segments=new Set<string>();
 p.securities.forEach((s,i)=>{if(securities.has(s.security_id))issue('DUPLICATE_KEY','securities',i+1,'security_id','證券穩定身分重複。');else securities.set(s.security_id,s)});
 p.sectors.forEach((s,i)=>{if(sectors.has(s.sector_id))issue('DUPLICATE_KEY','sectors',i+1,'sector_id','產業穩定身分重複。');else sectors.set(s.sector_id,s);if(!p.manifest.markets.includes(s.market))issue('MARKET_SCOPE','sectors',i+1,'market','產業市場不在批次宣告內。')});
 p.market_periods.forEach((r,i)=>{if(segments.has(r.segment_id))issue('DUPLICATE_KEY','market_periods',i+1,'segment_id','連續市場區段身分重複。');segments.add(r.segment_id);if(!securities.has(r.security_id))issue('UNKNOWN_SECURITY','market_periods',i+1,'security_id','找不到證券穩定身分。');if(!p.manifest.markets.includes(r.market))issue('MARKET_SCOPE','market_periods',i+1,'market','市場區段不在批次宣告內。');const list=periods.get(r.security_id)||[];list.push(r);periods.set(r.security_id,list)});
 for(const [security_id,list] of periods){list.sort((a,b)=>a.valid_from.localeCompare(b.valid_from));for(let i=1;i<list.length;i++)if(overlaps(list[i-1],list[i]))issue('OVERLAPPING_MARKET','market_periods',null,security_id,'同一證券的市場有效期間重疊，無法判斷轉板邊界。')}
 const codePeriods=new Map<string,{id:string;period:MarketPeriod}[]>();for(const r of p.market_periods){const s=securities.get(r.security_id);if(!s)continue;const list=codePeriods.get(s.code)||[];list.push({id:s.security_id,period:r});codePeriods.set(s.code,list)}
 for(const [code,list] of codePeriods){list.sort((a,b)=>a.period.valid_from.localeCompare(b.period.valid_from));let last:typeof list[number]|undefined;for(const current of list){if(last&&current.id!==last.id&&overlaps(last.period,current.period))issue('AMBIGUOUS_CODE','market_periods',null,code,'相同代號在同一日期對應不同證券身分。');if(!last||(current.period.valid_to||'9999')>(last.period.valid_to||'9999'))last=current}}
 p.memberships.forEach((r,i)=>{if(securities.get(r.security_id)?.kind!=='stock'||!sectors.has(r.sector_id))issue('MEMBERSHIP_REFERENCE','memberships',i+1,'','產業歸屬須指向已知股票及產業。');const list=members.get(r.security_id)||[];list.push(r);members.set(r.security_id,list)});
 for(const [security_id,list] of members){list.sort((a,b)=>a.valid_from.localeCompare(b.valid_from));for(let i=1;i<list.length;i++)if(overlaps(list[i-1],list[i]))issue('OVERLAPPING_SECTOR','memberships',null,security_id,'同一股票的產業有效期間重疊。')}
 const from=p.manifest.date_from,to=p.manifest.date_to;
 p.calendar.forEach((r,i)=>{const key=r.market+'|'+r.date;if(calendar.has(key))issue('DUPLICATE_KEY','calendar',i+1,'date','市場日期重複。');calendar.set(key,r);if(!p.manifest.markets.includes(r.market)||r.date<from||r.date>to)issue('CALENDAR_SCOPE','calendar',i+1,'date','日期或市場超出批次宣告範圍。')});
 if(!report.issues.some(i=>i.code==='DATE_RANGE'))for(const m of p.manifest.markets)for(let n=Date.parse(from);n<=Date.parse(to);n+=86400000){const date=new Date(n).toISOString().slice(0,10);if(!calendar.has(m+'|'+date))issue('MISSING_CALENDAR','calendar',null,date,`${m} 缺少開休市宣告，不能自行猜測交易日。`)}
 p.prices.forEach((r,i)=>{
  const s=securities.get(r.security_id);let duplicate=false;if(s){let markets=prices.get(r.security_id);if(!markets){markets=new Map();prices.set(r.security_id,markets)}let dates=markets.get(r.market);if(!dates){dates=new Set();markets.set(r.market,dates)}duplicate=dates.has(r.date);dates.add(r.date)}else{const key=r.security_id+'|'+r.market+'|'+r.date;duplicate=unknownPrices.has(key);unknownPrices.add(key)}if(duplicate)issue('DUPLICATE_KEY','prices',i+1,'','同證券、市場及日期價格重複。');
  const day=calendar.get(r.market+'|'+r.date),period=activeAt(periods.get(r.security_id),r.date);
  if(!s)issue('UNKNOWN_SECURITY','prices',i+1,'security_id','找不到證券穩定身分。');
  if(!p.manifest.markets.includes(r.market)||r.date<from||r.date>to)issue('PRICE_SCOPE','prices',i+1,'date','價格超出批次宣告日期或市場。');
  if(!day?.is_open)issue('NOT_OPEN','prices',i+1,'date','價格日期沒有合法開市宣告。');
  if(!period||period.market!==r.market)issue('MARKET_LIFECYCLE','prices',i+1,'market','價格日期不屬於該證券的合法市場區段。');
  if(r.status==='unavailable')issue('DATA_UNAVAILABLE','prices',i+1,'status','來源尚未完成，不能當作停牌或零報酬通過匯入。');
  if(r.status==='traded'&&(!positive(r.raw_close)||!positive(r.adjusted_close)||(s?.kind!=='index'&&(r.volume===null||r.volume<=0))))issue('TRADED_VALUE','prices',i+1,'','有效成交必須具備正的原始／還原收盤與成交量；指數成交量可為 null。');
  if(p.version===2&&((r.status==='traded'&&r.no_price_basis!==null)||(r.status==='no_trade'&&(r.no_price_basis!=='regular_session_no_trade'||r.volume===null))||(r.status==='suspended'&&r.no_price_basis!=='official_suspension')))issue('NO_PRICE_BASIS','prices',i+1,'no_price_basis','狀態必須符合明確證據口徑；未知合計量只容許官方停牌，不自動補零。');
  if((r.status==='suspended'||r.status==='no_trade')&&(r.raw_close!==null||r.adjusted_close!==null||(p.version===1&&r.volume!==0)||!label(r.reason,240)))issue('NO_TRADE_VALUE','prices',i+1,'','已確認停牌／無新價格須提供原因及 null 價格；v1 成交量須為零，v2 保留其已宣告合計量，不可攜帶沿用舊價。');
 });
 // Check the declared universe, including newly listed and departed securities, on every open day.
 const openByMarket=new Map(p.manifest.markets.map(m=>[m,p.calendar.filter(d=>d.market===m&&d.is_open).sort((a,b)=>a.date.localeCompare(b.date))]));
 coverage:for(const s of p.securities){const list=periods.get(s.security_id);if(!list?.length){issue('MISSING_MARKET','securities',null,s.security_id,'證券缺少市場有效期間。');continue}for(const period of list){const days=openByMarket.get(period.market)||[];for(let i=firstDate(days,period.valid_from);i<days.length&&(period.valid_to===null||days[i].date<period.valid_to);i++){const day=days[i];report.counts.expected_prices++;if(report.counts.expected_prices>3_000_000){issue('COVERAGE_SIZE','package',null,'','宣告集合超過每包三百萬個應有觀測，請依市場與日期拆批。');break coverage}if(!prices.get(s.security_id)?.get(day.market)?.has(day.date))issue('MISSING_PRICE','prices',null,day.date,`${s.security_id} · ${day.market} 應有當日紀錄；缺列不能當無成交。`);if(s.kind==='stock'){const assignment=activeAt(members.get(s.security_id),day.date);if(!assignment||sectors.get(assignment.sector_id)?.market!==day.market)issue('SECTOR_LIFECYCLE','memberships',null,day.date,`${s.security_id} 缺少當日同市場的歷史產業歸屬。`)}}}}
 if(!p.securities.length||!report.counts.expected_prices)issue('EMPTY_DATASET','package',null,'','批次必須包含至少一個合法開市端點的證券紀錄。');
 report.ok=report.error_count===0;return {report,data:report.ok?p:null};
}
