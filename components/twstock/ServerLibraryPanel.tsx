import {useAuth} from './AuthContext';
import {useEffect,useRef,useState} from 'react';
import {createLibraryBackup,libraryBackupLimit,parseLibraryBackup,record,type LibraryRestorePreview} from '../../shared/libraryContract';
import {readLocalLibrary} from './localLibrary';
import {downloadBlob} from './pngExport';
import type {LocalStorageLike,RetainedSlots} from './localWorkspace';
import type {Plan} from './model';
import type {ServerLibraryService} from './useServerLibrary';
export default function ServerLibraryPanel({service,storage,plan,browserRetained}:{service:ServerLibraryService;storage:LocalStorageLike|null;plan:Plan;browserRetained:RetainedSlots}){
 const auth=useAuth();
 const file=useRef<HTMLInputElement>(null),generation=useRef(0);
 const [preview,setPreview]=useState<LibraryRestorePreview|null>(null),[source,setSource]=useState(''),[selected,setSelected]=useState<string[]>([]),[message,setMessage]=useState(''),[error,setError]=useState(''),[undoing,setUndoing]=useState(false),[reading,setReading]=useState(false);
 useEffect(()=>{generation.current++;setPreview(null);setSource('');setSelected([]);setUndoing(false);setError('');setMessage('');setReading(false);return()=>{generation.current++}},[plan]);
 const reset=()=>{generation.current++;setPreview(null);setSource('');setSelected([]);setUndoing(false);setReading(false)};
 const feedback=(value:unknown)=>setError(value instanceof Error?value.message:'無法確認後端操作結果，請重新讀取核對。');
 const disabled=!service.ready||service.busy||reading||plan==='Anonymous';
 const download=async()=>{try{setError('');const value=await service.run('backup');const {backup}=parseLibraryBackup(JSON.stringify(value.backup));downloadBlob(new Blob([JSON.stringify(backup,null,2)],{type:'application/json;charset=utf-8'}),`TWStockRS-server-library-backup-${backup.createdAt.replace(/[:.]/g,'-')}.json`);setMessage('已送出後端清單與檢視備份下載。')}catch(error){feedback(error)}};
 const showPreview=async(text:string)=>{
  const token=++generation.current;setReading(true);setError('');setMessage('');setPreview(null);setUndoing(false);
  try{
   parseLibraryBackup(text);const result=await service.run('restore/preview',{text});if(token!==generation.current)return;
   const value=result.preview;
   if(!record(value)||typeof value.revision!=='number'||typeof value.createdAt!=='string'||typeof value.note!=='string'||!Array.isArray(value.parts)||value.parts.some(part=>!record(part)||typeof part.id!=='string'||typeof part.label!=='string'||typeof part.detail!=='string'||typeof part.allowed!=='boolean'))throw Error('後端還原預覽格式不正確。');
   const next=value as unknown as LibraryRestorePreview;setPreview(next);setSource(text);setSelected(next.parts.filter(part=>part.allowed).map(part=>part.id));
  }catch(error){if(token===generation.current)feedback(error)}finally{if(token===generation.current)setReading(false)}
 };
 const importBrowser=async()=>{
  try{const source=readLocalLibrary(storage);if(!source.writable||source.raw===null)throw Error(source.notice||'此瀏覽器沒有已保存的清單或檢視。可以先保存目前分析到後端，或選擇先前的備份檔。');await showPreview(JSON.stringify(createLibraryBackup(source.library,plan,browserRetained)))}catch(error){feedback(error)}
 };
 const restore=async()=>{if(!preview)return;try{await service.run('restore',{text:source,selected},preview.revision);reset();setMessage('已整批還原到後端，並保留一份還原前資料。目前分析未變更。');setError('')}catch(error){feedback(error)}};
 const undo=async()=>{try{await service.run('undo');reset();setError('');setMessage('已復原後端還原前的清單與檢視。')}catch(error){feedback(error);setUndoing(false)}};
 return <section className="backup-panel" aria-label="後端清單與檢視儲存"><h3>後端清單與檢視</h3><p>{auth?"儲存在此電腦的後端，依登入帳號分開；同一帳號可在連到此服務的其他瀏覽器使用。尚未公開部署。":"儲存在此電腦的 SQLite（單檔資料庫），同機不同瀏覽器共用。尚未提供正式登入或跨電腦同步。"}</p>
  <p role="status">{service.ready?`後端已連線 · 資料版本 ${service.snapshot!.revision}`:service.phase==='loading'?'正在讀取後端清單…':'後端清單尚未確認，已暫停管理與套用。'}</p>
  {service.notice&&<p className="subset-error" role="alert">{service.notice}</p>}
  <div className="backup-actions"><button disabled={service.busy||reading} onClick={()=>{reset();setError('');void service.refresh()}}>重新讀取後端清單</button><button disabled={disabled} onClick={()=>void download()}>下載後端備份</button><button disabled={disabled} onClick={()=>file.current?.click()}>選擇後端或舊版備份</button><button disabled={disabled} onClick={()=>void importBrowser()}>預覽匯入瀏覽器清單</button></div>
  <input ref={file} type="file" accept=".json,application/json" hidden aria-label="選擇後端清單備份檔" disabled={disabled} onChange={event=>{const chosen=event.target.files?.[0];event.target.value='';if(!chosen)return;const token=++generation.current;setReading(true);setError('');void (async()=>{try{if(chosen.size>libraryBackupLimit)throw Error('備份檔超過 1 MB。');const text=await chosen.text();if(token===generation.current)await showPreview(text)}catch(error){if(token===generation.current)feedback(error)}finally{if(token===generation.current)setReading(false)}})()}}/>
  {(service.busy||reading)&&<p role="status">正在處理後端資料…</p>}
  {preview&&<div className="backup-preview"><h4>後端還原預覽</h4><p>{preview.note}</p><p>備份時間：{new Date(preview.createdAt).toLocaleString('zh-TW')}；目標版本 {preview.revision}。確認後覆寫勾選格，不合併股票。</p><div className="backup-parts">{preview.parts.map(part=><label key={part.id}><input type="checkbox" disabled={disabled||!part.allowed} checked={selected.includes(part.id)} onChange={()=>setSelected(ids=>ids.includes(part.id)?ids.filter(id=>id!==part.id):[...ids,part.id])}/><span><b>{part.label}</b><small>{part.detail}</small></span></label>)}</div><div className="backup-actions"><button disabled={service.busy} onClick={()=>{reset();setMessage('已取消匯入，後端資料未變更。')}}>取消後端還原</button><button disabled={disabled||!selected.length} className="primary-button" onClick={()=>void restore()}>確認覆寫後端 {selected.length} 格</button></div></div>}
  {!preview&&service.snapshot?.canUndo&&plan!=='Anonymous'&&(undoing?<div className="backup-undo"><p>確認復原上次後端還原前的資料？還原後已有修改時會拒絕覆蓋。</p><div className="backup-actions"><button disabled={disabled} onClick={()=>setUndoing(false)}>取消</button><button disabled={disabled} onClick={()=>void undo()}>確認復原後端還原前資料</button></div></div>:<button disabled={disabled} onClick={()=>setUndoing(true)}>復原後端還原前資料</button>)}
  {service.snapshot?.hasRecovery&&!service.snapshot.canUndo&&<p>還原後已有修改或方案變更，先前還原記錄不能再復原。</p>}
  {plan==='Anonymous'&&<p>Free 起可管理、匯入與備份後端儲存格。</p>}
  {message&&<p className="slot-success" role="status">{message}</p>}{error&&<p className="subset-error" role="alert">{error}</p>}
 </section>;
}
