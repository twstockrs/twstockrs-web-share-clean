import {createHash} from 'node:crypto';
import {closeSync,fsyncSync,openSync,unlinkSync,writeFileSync} from 'node:fs';
import {AnalysisError} from '../shared/mockAnalysis';
import {exactFields} from '../shared/libraryContract';
import {validImportDate,type ImportPackage} from '../shared/dataImport';
import type {DataRelease} from '../shared/dataVersions';
import {comparisonCategories,comparisonLabels,comparisonFields,type ComparisonCategory,type ComparisonRequest,type ComparisonRow,type ComparisonScalar,type ComparisonSummary,type VersionComparison} from '../shared/versionComparison';

type Row=Record<string,ComparisonScalar>;
export type ComparisonInput={release:DataRelease;packages:ImportPackage[]}|null;
const definition:Record<ComparisonCategory,{fields:string[];key:string[]}>= {
 manifest:{fields:['dataset_kind','source','source_version','validation_version','method','version','reference_date','date_from','date_to','latest_date','price_count'],key:[]},
 batches:{fields:['batch_id','sha256','date_from','date_to','price_count'],key:['batch_id']},
 securities:{fields:['security_id','code','name','kind'],key:['security_id']},
 market_periods:{fields:['segment_id','security_id','market','valid_from','valid_to'],key:['segment_id']},
 sectors:{fields:['sector_id','market','name'],key:['sector_id']},
 memberships:{fields:['security_id','sector_id','valid_from','valid_to'],key:['security_id','valid_from']},
 calendar:{fields:['market','date','is_open'],key:['market','date']},
 prices:{fields:['security_id','market','date','status','raw_close','adjusted_close','volume','reason'],key:['security_id','market','date']}
};
const reject=(message:string):never=>{throw new AnalysisError('INVALID_COMPARISON',message,422)};
export function comparisonRequest(value:unknown,report=false):ComparisonRequest{
 exactFields(value,['market','expected_revision','from_release_id','to_release_id','filters',...(report?[]:['offset','limit'])]);
 if(!['TWSE','TPEx'].includes(String(value.market))||typeof value.market!=='string'||typeof value.expected_revision!=='number'||!Number.isSafeInteger(value.expected_revision)||value.expected_revision<1)reject('比較市場或修訂編號不適用。');
 for(const field of ['from_release_id','to_release_id'])if(value[field]!==null&&(typeof value[field]!=='string'||!/^input-[a-f0-9-]{36}$/.test(value[field] as string)))reject('請選擇已建立版本或未啟用狀態。');
 if(value.from_release_id===null&&value.to_release_id===null)reject('至少選擇一個已建立版本，不能比較兩個未啟用狀態。');
 exactFields(value.filters,['category','kind','query','date_from','date_to']);const f=value.filters;
 if(!['all',...comparisonCategories].includes(String(f.category))||!['all','added','removed','modified'].includes(String(f.kind))||typeof f.category!=='string'||typeof f.kind!=='string'||typeof f.query!=='string'||f.query.length>96||/[\u0000-\u001f]/.test(f.query)||f.date_from!==null&&!validImportDate(f.date_from)||f.date_to!==null&&!validImportDate(f.date_to)||typeof f.date_from==='string'&&typeof f.date_to==='string'&&f.date_from>f.date_to)reject('比較篩選條件不適用。');
 if(!report&&(typeof value.offset!=='number'||!Number.isSafeInteger(value.offset)||value.offset<0||typeof value.limit!=='number'||!Number.isSafeInteger(value.limit)||value.limit<1||value.limit>100))reject('每頁比較明細限 1–100 筆，頁面位置須為非負整數。');
 return {market:value.market,expected_revision:value.expected_revision,from_release_id:value.from_release_id,to_release_id:value.to_release_id,filters:{category:f.category,kind:f.kind,query:(f.query as string).trim(),date_from:f.date_from,date_to:f.date_to},offset:report?0:value.offset,limit:report?100:value.limit} as ComparisonRequest;
}
function index(input:ComparisonInput){
 const maps=Object.fromEntries(comparisonCategories.map(c=>[c,new Map<string,Row>()])) as Record<ComparisonCategory,Map<string,Row>>;
 const add=(category:ComparisonCategory,r:Row)=>maps[category].set(JSON.stringify(definition[category].key.map(k=>r[k])),r);
 if(input){const r=input.release;add('manifest',{dataset_kind:r.dataset_kind,source:r.source,source_version:r.source_version,validation_version:r.validation_version,...r.adjustment,date_from:r.date_from,date_to:r.date_to,latest_date:r.latest_date,price_count:r.price_count});for(const row of r.batches)add('batches',row);
  // Same merging rules as the RS input: stable IDs, full historical intervals, last declared display names.
  for(const p of input.packages)for(const c of ['securities','market_periods','sectors','memberships','calendar','prices'] as const)for(const row of p[c])add(c,row);
 }return maps;
}
export class Comparison{
 private a;private b;private keys;private id:string;
 constructor(readonly request:ComparisonRequest,readonly from:ComparisonInput,readonly to:ComparisonInput){
  this.a=index(from);this.b=index(to);this.keys=Object.fromEntries(comparisonCategories.map(c=>[c,[...new Set([...this.a[c].keys(),...this.b[c].keys()])].sort()])) as Record<ComparisonCategory,string[]>;
  this.id='diff-'+createHash('sha256').update(JSON.stringify(['input-diff-v1',request.market,request.expected_revision,from?.release.release_id??null,from?.release.digest??null,to?.release.release_id??null,to?.release.digest??null,request.filters])).digest('hex');
 }
 private row(category:ComparisonCategory,key:string):ComparisonRow|null{
  const before=this.a[category].get(key),after=this.b[category].get(key),record=after||before!;
  const fields=definition[category].fields.filter(f=>!before||!after||before[f]!==after[f]);if(!fields.length)return null;
  const securityId=typeof record.security_id==='string'?record.security_id:null,oldSecurity=securityId?this.a.securities.get(JSON.stringify([securityId])):undefined,newSecurity=securityId?this.b.securities.get(JSON.stringify([securityId])):undefined;
  const names=[oldSecurity,newSecurity].filter(Boolean).map(r=>`${r!.code} ${r!.name}`),label=securityId?[...new Set(names)].join(' → ')+` [${securityId}]`:category==='sectors'?String((before?.name??'')+(before&&after&&before.name!==after.name?' → ':'')+(after&&before?.name!==after.name?after.name:'')):category==='manifest'?'來源與運算口徑':category==='batches'?String(record.batch_id):String(record.market);
  const date=typeof record.date==='string'?record.date:typeof record.valid_from==='string'?record.valid_from:null,other=before?this.to?.release:this.from?.release;
  const coverage=(!before||!after)&&['prices','calendar'].includes(category)&&(!other||!date||date<other.date_from||date>other.date_to);
  const canonical=(r:Row|undefined)=>r?Object.fromEntries(definition[category].fields.map(f=>[f,r[f]])):null;
  return {category,kind:!before?'added':!after?'removed':'modified',key,label,market:record.market==='TWSE'||record.market==='TPEx'?record.market:null,security_id:securityId,date,coverage_change:coverage,fields,before:canonical(before),after:canonical(after)};
 }
 private matches(row:ComparisonRow){
  const f=this.request.filters;if(f.category!=='all'&&row.category!==f.category||f.kind!=='all'&&row.kind!==f.kind)return false;const query=f.query.toLocaleLowerCase();if(query&&!`${row.label} ${row.key}`.toLocaleLowerCase().includes(query))return false;
  if(!f.date_from&&!f.date_to)return true;const a=f.date_from||'0000',b=f.date_to||'9999';
  if(row.category==='prices'||row.category==='calendar')return !!row.date&&row.date>=a&&row.date<=b;
  if(row.category==='memberships'||row.category==='market_periods')return [row.before,row.after].some(r=>r&&String(r.valid_from)<=b&&(r.valid_to===null||String(r.valid_to)>a));
  return true;
 }
 result():VersionComparison{
  const summary:ComparisonSummary={total_changes:0,unchanged:0,affected_securities:0,coverage_changes:0,categories:Object.fromEntries(comparisonCategories.map(c=>[c,{added:0,removed:0,modified:0,unchanged:0,coverage_changes:0,fields:{}}])) as ComparisonSummary['categories']},rows:ComparisonRow[]=[],affected=new Set<string>();let filtered=0;
  for(const c of comparisonCategories)for(const key of this.keys[c]){const row=this.row(c,key),counts=summary.categories[c];if(!row){counts.unchanged++;summary.unchanged++;continue}counts[row.kind]++;summary.total_changes++;if(row.coverage_change){counts.coverage_changes++;summary.coverage_changes++}if(row.security_id)affected.add(row.security_id);if(row.kind==='modified')for(const f of row.fields)counts.fields[f]=(counts.fields[f]||0)+1;
   if(this.matches(row)){if(filtered>=this.request.offset&&rows.length<this.request.limit)rows.push(row);filtered++}
  }summary.affected_securities=affected.size;
  const warnings=['比較所選市場版本的完整來源，包含其他市場的來源依賴；不代表另一市場已切換。','這是輸入資料差異，不估算 RS（相對強弱）座標改變；正常計算仍依目前啟用版本。'];
  if(!this.from||!this.to)warnings.push('未啟用狀態視為沒有價格輸入；不拿內建 DEMO 座標作比較。');
  if(this.from&&this.to&&(this.from.release.dataset_kind!==this.to.release.dataset_kind||this.from.release.source!==this.to.release.source||JSON.stringify(this.from.release.adjustment)!==JSON.stringify(this.to.release.adjustment)))warnings.push('資料種類、來源或還原口徑不同，價格差異不可直接視為歷史更正。');
  if(this.from?.release.dataset_kind==='test'||this.to?.release.dataset_kind==='test')warnings.push('包含合成測試資料，不代表真實台股行情。');
  return {format:'TWStockRS-version-comparison',version:1,method:'input-diff-v1',comparison_id:this.id,market:this.request.market,revision:this.request.expected_revision,from:this.from?.release??null,to:this.to?.release??null,filters:this.request.filters,summary,filtered_total:filtered,offset:this.request.offset,limit:this.request.limit,rows,warnings};
 }
 writeReport(file:string,maxBytes=4*1024**3){
  const result=this.result(),{rows,offset,limit,...metadata}=result,fd=openSync(file,'wx'),h=createHash('sha256');let bytes=0,count=0;
  const write=(text:string)=>{const block=Buffer.from(text);bytes+=block.length;if(bytes>maxBytes)throw new AnalysisError('COMPARISON_REPORT_TOO_LARGE',maxBytes===64*1024*1024?'差異報告超過網頁 64 MiB 上限。請縮小篩選範圍，或用本機 data:compare 工具匯出完整報告。':'差異報告超過本次檔案輸出上限，請縮小篩選範圍。',413);writeFileSync(fd,block);h.update(block)};
  try{write(JSON.stringify({...metadata,report_scope:'all_filtered_changes',created_at:new Date().toISOString()}).slice(0,-1)+',"rows":[\n');for(const c of comparisonCategories)for(const key of this.keys[c]){const row=this.row(c,key);if(row&&this.matches(row)){write((count?',\n':'')+JSON.stringify(row));count++}}if(count!==result.filtered_total)throw Error('差異筆數不一致。');write('\n]}\n');fsyncSync(fd)}catch(error){closeSync(fd);unlinkSync(file);throw error}closeSync(fd);
  return {bytes,sha256:h.digest('hex'),comparison_id:this.id,filename:`TWStockRS-version-diff-${result.market}-${this.id.slice(5,17)}-r${result.revision}.json`};
 }
}
