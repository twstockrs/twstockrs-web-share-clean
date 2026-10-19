import {useEffect,useRef,useState} from 'react';
import {importWebLimit,type ImportReport} from '../../shared/dataImport';
import {downloadBlob} from './pngExport';
import {maintenanceRequest} from './maintenanceClient';

type Batch={batch_id:string;dataset_kind:string;price_count:number;date_from:string;date_to:string};
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const tableLabels:Record<string,string>={package:'匯入包',manifest:'批次說明',securities:'證券身分',market_periods:'市場有效期間',calendar:'開休市日曆',sectors:'產業',memberships:'歷史產業歸屬',prices:'價格'};
function reportValue(value:unknown):ImportReport{
 if(!record(value)||value.format!=='TWStockRS-import-report'||value.version!==1||typeof value.ok!=='boolean'||typeof value.error_count!=='number'||value.error_count<0||!Number.isSafeInteger(value.error_count)||value.ok!==(value.error_count===0)||typeof value.sha256!=='string'||!/^[a-f0-9]{64}$/.test(value.sha256)||!record(value.counts)||!Object.values(value.counts).every(n=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0)||!Array.isArray(value.issues)||value.issues.length>500||value.issues.some(i=>!record(i)||typeof i.code!=='string'||typeof i.table!=='string'||typeof i.message!=='string'||typeof i.field!=='string'||i.row!==null&&typeof i.row!=='number')||value.batch_id!==null&&typeof value.batch_id!=='string')throw Error('匯入檢查回應格式不正確，請重新檢查。');
 if(typeof value.checked_at!=='string'||typeof value.note!=='string'||value.note.length>1000||typeof value.details_truncated!=='boolean'||!['test','source',null].includes(value.dataset_kind as string|null)||['securities','market_periods','calendar','sectors','memberships','prices','expected_prices'].some(key=>!Object.hasOwn(value.counts as object,key)))throw Error('匯入檢查摘要格式不正確。');
 return value as unknown as ImportReport;
}
const call=(operation:string,input:Record<string,unknown>={})=>maintenanceRequest('imports',operation,input);
export default function DataImportPanel(){
 const file=useRef<HTMLInputElement>(null),epoch=useRef(0);
 const [report,setReport]=useState<ImportReport|null>(null),[source,setSource]=useState(''),[filename,setFilename]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[confirming,setConfirming]=useState(false),[batches,setBatches]=useState<Batch[]>([]),[listed,setListed]=useState(false);
 useEffect(()=>()=>{epoch.current++},[]);
 const feedback=(e:unknown)=>setError(e instanceof Error?e.message:'操作結果未確認，請重新讀取批次記錄。');
 const read=async()=>{const value=await call('list');if(!Array.isArray(value.batches)||value.batches.length>100||value.batches.some(b=>!record(b)||typeof b.batch_id!=='string'||!['test','source'].includes(String(b.dataset_kind))||typeof b.price_count!=='number'||typeof b.date_from!=='string'||typeof b.date_to!=='string'))throw Error('批次記錄回應格式不正確。');setBatches(value.batches as Batch[]);setListed(true)};
 const refresh=async()=>{setBusy(true);setError('');try{await read()}catch(e){feedback(e)}finally{setBusy(false)}};
 const inspect=async(chosen:File)=>{const token=++epoch.current;setBusy(true);setReport(null);setSource('');setConfirming(false);setError('');setMessage('');setFilename(chosen.name);try{if(chosen.size>importWebLimit)throw Error('網頁匯入包上限 8 MiB，較大資料請使用本機匯入工具。');const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await chosen.arrayBuffer()),value=await call('validate',{text});if(token!==epoch.current)return;setReport(reportValue(value.report));setSource(text)}catch(e){if(token===epoch.current)feedback(e)}finally{if(token===epoch.current)setBusy(false)}};
 const stage=async()=>{if(!report?.ok)return;const token=epoch.current;setBusy(true);setError('');try{const result=await call('stage',{text:source,sha256:report.sha256});if(token!==epoch.current)return;if(typeof result.staged!=='boolean'||typeof result.notice!=='string')throw Error('匯入結果未確認，請重新讀取批次記錄。');setReport(reportValue(result.report));setMessage(result.notice);setConfirming(false);if(result.staged){setSource('');await read()}}catch(e){if(token===epoch.current)feedback(e)}finally{if(token===epoch.current)setBusy(false)}};
 const download=(value:ImportReport)=>downloadBlob(new Blob([JSON.stringify(value,null,2)],{type:'application/json;charset=utf-8'}),`TWStockRS-import-report-${value.batch_id||'invalid'}-${Date.now()}.json`);
 return <section className="backup-panel data-import-panel" aria-label="本機資料匯入與檢查"><h3>資料匯入與檢查</h3><p>本機維護工具。先檢查來源包，再確認存入暫存區。保存批次不直接切換圖表；切換至「資料版本」建立並啟用後才使用該價格運算。外部來源原始欄位須先依匯入格式對照。</p>
  <p>網頁支援 UTF-8（中文文字編碼）的 JSON（文字資料格式）檔案，上限 8 MiB（約 8.4 MB）。較大資料可使用本機匯入工具，每包上限 512 MiB。</p>
  <div className="backup-actions"><button disabled={busy} onClick={()=>file.current?.click()}>選擇資料包並檢查</button><button disabled={busy} onClick={()=>void refresh()}>讀取暫存批次記錄</button><a href="/samples/import-valid.json" download>下載合法測試包</a><a href="/samples/import-invalid.json" download>下載錯誤測試包</a><a href="/samples/import-revision.json" download>下載修訂測試包</a><a href="/samples/rs-test.json" download>下載 RS 合成運算包</a></div>
  <input type="file" accept=".json,application/json" hidden ref={file} aria-label="選擇行情資料匯入包" disabled={busy} onChange={event=>{const chosen=event.target.files?.[0];event.target.value='';if(chosen)void inspect(chosen)}}/>
  {busy&&<p role="status">正在檢查或保存資料，請稍候…</p>}
  {report&&<div className="backup-preview"><h4>{report.ok?'檢查通過':'檢查未通過'}</h4><p>{filename} · {report.batch_id||'批次編號不適用'} · {report.dataset_kind==='test'?'測試資料':report.dataset_kind==='source'?'來源資料宣告，尚待來源核對':'來源種類不適用'}</p><p>價格 {report.counts.prices} 筆／應有 {report.counts.expected_prices} 筆；錯誤 {report.error_count} 項。</p><p>{report.note}</p><button disabled={busy} onClick={()=>download(report)}>下載本次檢查報告</button>
   {!!report.issues.length&&<ol className="import-issues">{report.issues.slice(0,20).map((issue,i)=><li key={i}><b>{tableLabels[issue.table]||issue.table}{issue.row?` 第 ${issue.row} 筆`:''}{issue.field?` · ${issue.field}`:''}</b><span>{issue.message}</span></li>)}</ol>}{report.error_count>20&&<p>此處顯示前 20 項；下載報告最多列出 500 項明細，另保留錯誤總數。</p>}
   {report.ok&&source&&(confirming?<div className="backup-undo"><p>確認保存此批次到本機暫存區？批次編號已有不同內容時會拒絕覆蓋。</p><div className="backup-actions"><button disabled={busy} onClick={()=>{setConfirming(false);setMessage('已取消保存，暫存資料未變更。')}}>取消保存批次</button><button disabled={busy} onClick={()=>void stage()}>確認保存此批次</button></div></div>:<button disabled={busy} onClick={()=>setConfirming(true)}>保存通過的批次</button>)}
  </div>}
  {message&&<p role="status" className="slot-success">{message}</p>}{error&&<p role="alert" className="subset-error">{error}</p>}
  {listed&&<div><h4>最近 100 個暫存批次</h4>{!batches.length&&<p>目前沒有已通過並保存的批次。</p>}{batches.map(batch=><div className="import-batch" key={batch.batch_id}><p><b>{batch.batch_id}</b> · {batch.dataset_kind==='test'?'測試':'來源宣告'}<br/>{batch.date_from}～{batch.date_to} · {batch.price_count} 筆價格</p><button disabled={busy} onClick={()=>{setBusy(true);setError('');void call('report',{batch_id:batch.batch_id}).then(value=>download(reportValue(value.report))).catch(feedback).finally(()=>setBusy(false))}}>下載已存報告</button></div>)}</div>}
 </section>;
}
