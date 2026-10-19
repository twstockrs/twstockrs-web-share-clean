import {useEffect,useRef,useState,Fragment} from 'react';
import {X,Bookmark,FolderOpen,Lock} from 'lucide-react';
import {useAuth} from './AuthContext';
import {AuthPanel} from './AuthPanel';
import {initialState,capacity,capabilities,slotAccessible,benchmarkLabel} from './model';
import StockSubsetPicker from './StockSubsetPicker';
import LibrarySlotEditor,{EditFeedback} from './LibrarySlotEditor';
import {createDemoLibrary,LocalLibrary,LibraryAction} from './localLibrary';
import {SourceKind,SourceLoadResult} from './sourceLoad';
import BackupPanel from './BackupPanel';
import {fetchAnalysisContext} from './useAnalysisContext';
import ServerLibraryPanel from './ServerLibraryPanel';
import AdminPanel from './AdminPanel';
import type {ServerLibraryService} from './useServerLibrary';
import type {LocalStorageLike,RetainedSlots} from './localWorkspace';

type Props={kind:string;state:typeof initialState;retained:RetainedSlots;library?:LocalLibrary;libraryNotice?:string;libraryWritable?:boolean;storage?:LocalStorageLike|null;serverLibrary?:ServerLibraryService;browserRetained?:RetainedSlots;onDataVersionChanged?:(market:string)=>void;onBackupRestored?:(keys:string[])=>void;onEdit?:(action:LibraryAction)=>EditFeedback|Promise<EditFeedback>;onChoose:(kind:SourceKind,index:number)=>void|Promise<EditFeedback>;onClose:()=>void;onRestore:(index:number,ids?:string[])=>SourceLoadResult|Promise<SourceLoadResult>;onLoadList:(index:number,ids?:string[])=>SourceLoadResult|Promise<SourceLoadResult>};
export default function Drawer({kind,state,retained,library=createDemoLibrary(),libraryNotice='',libraryWritable=true,storage=null,serverLibrary,browserRetained=retained,onDataVersionChanged,onBackupRestored,onEdit,onChoose,onClose,onRestore,onLoadList}:Props){
 const auth=useAuth();
 const ref=useRef<HTMLDialogElement>(null),[choice,setChoice]=useState(0),[editing,setEditing]=useState<number|null>(null);
 const [pending,setPending]=useState<(Extract<SourceLoadResult,{type:'choose'}>&{kind:SourceKind;index:number})|null>(null),[loadError,setLoadError]=useState('');
 const [busy,setBusy]=useState(false);
 useEffect(()=>{const opener=document.activeElement;ref.current?.showModal();return()=>{ref.current?.close();if(opener instanceof HTMLElement&&opener.isConnected)opener.focus()}},[]);
 const admin=kind==='admin',watch=kind==='watchlist',account=kind==='account',slotKind=watch?'watchlist':'saved';
 const available=watch?capabilities[state.plan].watchlists:capabilities[state.plan].savedViews;
 const choosing=state.plan==='Free'&&retained[slotKind]===null,count=available?(watch?4:2):0;
 const apply=async(sourceKind:SourceKind,index:number,ids?:string[])=>{
  if(busy||!libraryWritable)return {type:'blocked' as const,issues:['請先讀取可用的儲存資料。']};
  setBusy(true);let result:SourceLoadResult;
  try{result=await (sourceKind==='watchlist'?onLoadList(index,ids):onRestore(index,ids))}catch(error){result={type:'blocked',issues:[error instanceof Error?error.message:'來源載入未完成。']}}finally{setBusy(false)}
  if(result.type==='ready')onClose();
  else if(result.type==='choose'){setLoadError('');setPending({...result,kind:sourceKind,index})}
  else setLoadError(result.issues.join('；'));
  return result;
 };
 const picking=pending&&libraryWritable&&slotAccessible(state.plan,pending.index,pending.kind,retained[pending.kind]);
 const choose=async()=>{setBusy(true);try{const result=await onChoose(slotKind,choice);if(result&&!result.ok)setLoadError(result.notice)}catch(error){setLoadError(error instanceof Error?error.message:'選定結果未確認。')}finally{setBusy(false)}};
 return <dialog ref={ref} className={`drawer ${admin?'admin-drawer':''}`} aria-label={admin?'管理員維護':account?(auth?'帳戶與儲存':'模擬帳戶'):watch?'Watchlist 觀察清單':'Saved View 已儲存檢視'} onCancel={onClose} onClick={event=>{if(event.target===event.currentTarget)onClose()}}><div className="drawer-content">
  <header><div><small>LOCAL WORKSPACE</small><h2>{admin?'管理員維護':account?(auth?'帳戶與儲存':'模擬帳戶'):watch?'Watchlist 觀察清單':'Saved View 已儲存檢視'}</h2></div><button aria-label="關閉面板" onClick={onClose}><X size={20}/></button></header>
  {admin?<AdminPanel market={state.market} onChanged={market=>onDataVersionChanged?.(market)}/>:account?<><AuthPanel/><p>目前方案：<b>{state.plan}</b></p><p>股票容量 {capacity[state.plan]}；觀察清單 {capabilities[state.plan].watchlists} 格；已儲存檢視 {capabilities[state.plan].savedViews} 格。</p><div className="drawer-notice">{auth?"帳號登入與權限由本機後端驗證；Pro 為本機測試權益，尚未串接付款與信箱服務。":"這是模擬帳戶，未連接登入、付款或正式權限服務。"}</div>{serverLibrary&&<ServerLibraryPanel service={serverLibrary} storage={storage} plan={state.plan} browserRetained={browserRetained}/>}<BackupPanel runtime={state.runtime} market={state.market} loadRuntime={serverLibrary?(market=>fetchAnalysisContext(market,state.plan,AbortSignal.timeout(8000))):undefined} storage={storage} plan={state.plan} retained={serverLibrary?browserRetained:retained} browserOnly={!!serverLibrary} onRestored={keys=>onBackupRestored?.(keys)}/></>:picking?<StockSubsetPicker key={`${pending.kind}:${pending.index}:${state.plan}`} title={pending.title} entities={pending.entities} limit={capacity[state.plan]} onApply={ids=>apply(pending.kind,pending.index,ids)} onCancel={()=>{setPending(null);setLoadError('')}}/>:<>
   <p>{watch?'套用清單會取代目前觀察標的；管理面板的移除只更改已儲存清單。':'套用分析條件前會檢查目前方案，無法使用的設定不會自動改寫。'}</p>
   <div className="drawer-notice">{serverLibrary?'清單與檢視保存在此電腦的後端資料庫，同一帳號可在連到此服務的其他瀏覽器使用。':'清單與檢視只保存在此瀏覽器，不會同步至帳號或其他電腦。'}需明確按儲存，修改目前分析不會自動覆寫此處內容。{serverLibrary&&'既有瀏覽器資料可在人像面板預覽匯入。'}</div>
   {libraryNotice&&<p className="subset-error" role="alert">{libraryNotice}</p>}
   {serverLibrary&&<div className="backup-actions"><span>{serverLibrary.ready?`後端資料版本 ${serverLibrary.snapshot!.revision}`:'後端清單尚未確認'}</span><button disabled={busy||serverLibrary.busy||serverLibrary.phase==='loading'} onClick={()=>void serverLibrary.refresh()}>重新讀取後端清單</button></div>}
   {choosing&&<div className="slot-choice"><strong>選定本段 Free 期間可用的一格</strong><p>觀察清單與已儲存檢視分別選擇；確認後不能改選其他保留項目，重新升 Pro 後恢復。</p></div>}
   {!count&&<p>匿名方案沒有可用的儲存格，Free 方案起可使用。</p>}
   {Array.from({length:count},(_,index)=>{
    const allowed=slotAccessible(state.plan,index,slotKind,retained[slotKind]),entry=watch?library.watchlists[index]:library.savedViews[index],preset=library.savedViews[index]?.preset;
    const description=watch?`${library.watchlists[index].market} · ${library.watchlists[index].ids.length} 檔股票`:preset?`${preset.market} / ${benchmarkLabel(preset.benchmarkType,preset.market,preset.benchmark,state.runtime?.market===preset.market?state.runtime:undefined)} / ${preset.frequency} / ${preset.period} / Trail ${preset.trail} / ${preset.priceType}`:'此格尚未儲存設定';
    return <Fragment key={index}><div className={`saved-item ${allowed?'':'slot-locked'}`}>
     {watch?<Bookmark size={18}/>:<FolderOpen size={18}/>}<div><b>{entry.name}</b>{allowed?<small>{description}</small>:<small><Lock size={12}/>{choosing?'尚未選定':'保留並鎖定'}</small>}</div>
     {choosing?<label className="slot-radio"><input type="radio" name="retained-slot" aria-label={`選擇 ${entry.name}`} disabled={busy||!libraryWritable} checked={choice===index} onChange={()=>setChoice(index)}/>選擇</label>:allowed?<span className="slot-buttons"><button disabled={busy||!libraryWritable||!!serverLibrary?.busy||(!watch&&!preset)} onClick={()=>void apply(slotKind,index)}>套用</button><button aria-expanded={editing===index} aria-label={`管理 ${entry.name}`} disabled={busy||!libraryWritable||!!serverLibrary?.busy} onClick={()=>{setEditing(editing===index?null:index);setLoadError('')}}>管理</button></span>:<span><Lock size={14}/></span>}
    </div>{allowed&&libraryWritable&&editing===index&&<LibrarySlotEditor key={`${slotKind}:${index}`} kind={slotKind} index={index} library={library} state={state} onEdit={action=>onEdit?.(action)||{ok:false,notice:'本機儲存目前不可用。'}}/>}</Fragment>;
   })}
   {loadError&&<p className="subset-error" role="alert">{loadError}。目前分析未變更。</p>}
   {busy&&<p role="status">正在確認後端來源…</p>}
   {choosing&&<button className="primary-button" disabled={busy||!libraryWritable||!!serverLibrary?.busy} onClick={()=>void choose()}>確認選定第 {choice+1} 格</button>}
  </>}
  <footer>{admin?'管理員專用維護':state.plan} · {admin?'當下權限由後端驗證':account?(auth?'後端帳號權益':'模擬方案'):`${available} 個可用${watch?'觀察清單':'檢視'}格 · ${serverLibrary?'本機資料庫':'僅儲存於本機'}`}</footer>
 </div></dialog>;
}
