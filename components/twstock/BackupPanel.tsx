import {useEffect,useRef,useState} from 'react';
import {Download,Upload,Undo2,Lock} from 'lucide-react';
import {Plan,type RuntimeData} from './model';
import {LocalStorageLike,RetainedSlots,localKeys,readWorkspaceMarket} from './localWorkspace';
import {backupLimit,backupWorkspaceMarket,createLocalBackup,previewLocalRestore,restoreLocalBackup,undoLocalRestore,recoveryAvailable,RestorePreview} from './localBackup';
import {downloadBlob} from './pngExport';

export default function BackupPanel({storage,plan,retained,onRestored,browserOnly=false,runtime,market='TWSE',loadRuntime}:{storage:LocalStorageLike|null;plan:Plan;retained:RetainedSlots;onRestored:(keys:string[])=>void;browserOnly?:boolean;runtime?:RuntimeData;market?:string;loadRuntime?:(market:string)=>Promise<RuntimeData|undefined>}){
 const file=useRef<HTMLInputElement>(null),request=useRef(0);
 const [preview,setPreview]=useState<RestorePreview|null>(null),[source,setSource]=useState(''),[filename,setFilename]=useState(''),[selected,setSelected]=useState<string[]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[warnings,setWarnings]=useState<string[]>([]),[undoing,setUndoing]=useState(false),[canUndo,setCanUndo]=useState(()=>recoveryAvailable(storage));
 useEffect(()=>{request.current++;setPreview(null);setSource('');setSelected([]);setUndoing(false);setBusy(false);return()=>{request.current++}},[plan,retained]);
 const reset=()=>{request.current++;setPreview(null);setSource('');setSelected([]);setFilename('');setError('');setBusy(false)};
 const resolveRuntime=(sourceMarket:string)=>loadRuntime?loadRuntime(sourceMarket):Promise.resolve(runtime?.market===sourceMarket?runtime:undefined);
 const download=async()=>{
  const token=++request.current;setBusy(true);setError('');setWarnings([]);setMessage('');
  try{
   const workspaceBefore=storage?.getItem(localKeys.workspace);
   const catalog=await resolveRuntime(readWorkspaceMarket(storage)||market);if(token!==request.current)return;
   if(storage?.getItem(localKeys.workspace)!==workspaceBefore)throw Error('最近分析已變更，請重新下載備份。');
   const result=createLocalBackup(storage,plan,retained,new Date(),catalog);
   downloadBlob(new Blob([result.text],{type:'application/json;charset=utf-8'}),result.filename);setWarnings(result.warnings);
   setMessage(`已送出備份下載：${result.backup.data.watchlists.filter(Boolean).length} 個清單、${result.backup.data.savedViews.filter(Boolean).length} 個檢視、${result.backup.data.workspace?'包含最近分析':'沒有可保存的最近分析'}及可用設定。`);
  }catch(value){if(token===request.current)setError(value instanceof Error?value.message:'備份失敗，請稍後再試。')}
  finally{if(token===request.current)setBusy(false)}
 };
 const readFile=async(chosen:File)=>{
  const token=++request.current;setPreview(null);setSource('');setSelected([]);setMessage('');setError('');setWarnings([]);setUndoing(false);setBusy(true);
  try{
   if(chosen.size>backupLimit)throw Error('備份檔超過 1 MB，未讀入。');
   const text=await chosen.text();if(token!==request.current)return;
   const catalog=await resolveRuntime(backupWorkspaceMarket(text)||market);if(token!==request.current)return;
   const next=previewLocalRestore(storage,plan,retained,text,catalog);setPreview(next);setSource(text);setFilename(chosen.name);setSelected(next.parts.filter(part=>part.allowed).map(part=>part.id));
  }catch(value){if(token===request.current)setError(value instanceof Error?value.message:'無法讀取備份檔。')}
  finally{if(token===request.current)setBusy(false)}
 };
 const apply=async()=>{
  if(!preview||busy)return;
  const token=++request.current;setBusy(true);setError('');
  try{
   const catalog=await resolveRuntime(backupWorkspaceMarket(source)||market);if(token!==request.current)return;
   const result=restoreLocalBackup(storage,plan,retained,source,selected,preview.stamp,catalog);
   if(!result.ok){setError(result.notice);return}
   reset();setMessage(result.notice+' 已保留一份還原前資料。');setCanUndo(true);onRestored(result.changedKeys);
  }catch(value){if(token===request.current)setError(value instanceof Error?value.message:'無法確認行情，未還原資料。')}
  finally{if(token===request.current)setBusy(false)}
 };
 const undo=()=>{const result=undoLocalRestore(storage,plan,retained);if(!result.ok){setError(result.notice);setUndoing(false);return}reset();setUndoing(false);setCanUndo(false);setMessage(result.notice);onRestored(result.changedKeys)};
 const locked=plan==='Anonymous';
 return <section className="backup-panel" aria-label={browserOnly?'瀏覽器資料備份與還原':'本機資料備份與還原'}><h3>{browserOnly?'瀏覽器資料備份／還原':'本機資料備份／還原'}</h3>
  {browserOnly&&<p>以下只處理此瀏覽器目前帳號的清單副本、最近分析與偏好，不修改後端資料庫。搬入後端請使用上方的預覽匯入或備份選檔。</p>}
  <p>備份檔可帶到其他本機主機，包含可用的清單、檢視、最近分析與偏好。只在本機處理，不上傳；不包含方案權限或 Free 選定格，也不包含行情價格；還原最近分析需連到具有對應行情的本機主機。</p>
  {locked&&<p><Lock size={13}/>Free 起可使用資料備份與還原。</p>}
  <div className="backup-actions"><button disabled={locked||busy} onClick={()=>void download()}><Download size={15}/>下載備份檔</button><button disabled={locked||busy} onClick={()=>file.current?.click()}><Upload size={15}/>選擇備份檔</button></div>
  <input ref={file} type="file" accept=".json,application/json" aria-label="選擇 TWStockRS 備份檔" hidden disabled={locked||busy} onChange={event=>{const chosen=event.target.files?.[0];event.target.value='';if(chosen)void readFile(chosen)}}/>
  {busy&&<p role="status">正在確認備份與市場資料…</p>}
  {preview&&<div className="backup-preview"><h4>還原預覽</h4><p className="backup-file">{filename}<br/>備份時間：{new Date(preview.backup.createdAt).toLocaleString('zh-TW')}</p><p>勾選項目會取代對應資料；未勾選與鎖定格保持原狀，不會合併股票清單。最近分析會依目前方案及已啟用的市場目錄重新驗證，回到最新日期，並更新該頻率偏好。</p>
   {preview.repairLibrary&&<p className="backup-warning">本機清單資料損壞。重建須使用 Pro 與完整 6 格的合法備份，並同時勾選 6 格；原始損壞資料會保留供復原。</p>}
   <div className="backup-parts">{preview.parts.map(part=><label key={part.id}><input type="checkbox" checked={selected.includes(part.id)} disabled={!part.allowed} onChange={()=>setSelected(ids=>ids.includes(part.id)?ids.filter(id=>id!==part.id):[...ids,part.id])}/><span><b>{part.label}</b><small>{part.detail}</small></span></label>)}</div>
   <p role="status">已勾選 {selected.length} 個項目；目前仍為 {plan} 方案。</p><div className="backup-actions"><button onClick={()=>{reset();setMessage('已取消還原，目前資料未變更。')}}>取消還原</button><button className="primary-button" disabled={busy||!selected.length} onClick={()=>void apply()}>確認覆寫並還原 {selected.length} 項</button></div>
  </div>}
  {!preview&&canUndo&&!locked&&<div className="backup-undo">{undoing?<><p>確認復原到上次還原前的資料？只保留一份復原記錄；若還原後已有修改，會拒絕覆蓋。</p><div className="backup-actions"><button onClick={()=>setUndoing(false)}>取消</button><button onClick={undo}>確認復原還原前資料</button></div></>:<button onClick={()=>{setUndoing(true);setError('')}}><Undo2 size={15}/>復原還原前資料</button>}</div>}
  {warnings.map((warning,index)=><p className="backup-warning" role="status" key={index}>{warning}</p>)}
  {message&&<p className="slot-success" role="status">{message}</p>}{error&&<p className="subset-error" role="alert">{error}</p>}
  <p>JSON 是儲存資料的文字檔格式，請保留原檔。還原前會重驗目前方案；Pro 專用設定與鎖定格不會因匯入而解鎖。</p>
 </section>;
}
