import {useState} from 'react';
import {AnalysisState,stateCatalog} from './model';
import {LibraryAction,LocalLibrary} from './localLibrary';
import {SourceKind} from './sourceLoad';

export type EditFeedback={ok:boolean;notice:string};
export default function LibrarySlotEditor({kind,index,library,state,onEdit}:{kind:SourceKind;index:number;library:LocalLibrary;state:AnalysisState;onEdit:(action:LibraryAction)=>EditFeedback|Promise<EditFeedback>}){
 const watch=kind==='watchlist',entry=watch?library.watchlists[index]:library.savedViews[index];
 const [name,setName]=useState(entry.name),[clearing,setClearing]=useState(false),[feedback,setFeedback]=useState<EditFeedback|null>(null),[busy,setBusy]=useState(false);
 const run=async(action:LibraryAction)=>{if(busy)return;setBusy(true);try{const result=await onEdit(action);setFeedback(result);if(result.ok)setClearing(false)}catch(error){setFeedback({ok:false,notice:error instanceof Error?error.message:'儲存結果未確認，請重新讀取。'})}finally{setBusy(false)}};
 const list=library.watchlists[index];
 return <section className="slot-editor" aria-label={`管理 ${entry.name}`}><fieldset className="async-fields" disabled={busy}>
  <div className="slot-name"><label>名稱<input maxLength={40} value={name} onChange={event=>setName(event.target.value)}/></label><button onClick={()=>run({type:'rename',kind,index,name})}>儲存名稱</button></div>
  {watch&&<><label className="slot-market">清單市場<select value={list.market} disabled={list.ids.length>0} onChange={event=>run({type:'bind-market',kind:'watchlist',index,market:event.target.value})}><option>TWSE</option><option>TPEx</option></select></label><p>{list.ids.length?'清單有股票時市場固定；先清空才能更改市場。':'空清單可更改市場，再存入該市場的目前清單。'}</p>
   <div className="saved-stock-list">{list.ids.map(id=>{const entity=stateCatalog(state).find(stock=>stock.id===id),invalid=!entity||entity.market!==list.market;return <div key={id}><span>{entity?.code||id} {entity?.name||'此版本沒有此證券'}{invalid&&<small>不符合此清單市場，請移除後再套用</small>}</span><button aria-label={`從已儲存清單移除 ${id}`} onClick={()=>run({type:'remove-stock',kind:'watchlist',index,id})}>×</button></div>})}{!list.ids.length&&<p>此儲存格目前沒有股票。</p>}</div>
  </>}
  <p>{watch?`將以目前 ${state.market} 的 ${state.currentList.length} 檔股票取代此格內容。`:`將儲存目前${state.mode==='Stock Move'?'個股':'產業'}模式的分析條件，載入時回到最新日期。`}</p>
  <button className="primary-button" onClick={()=>run({type:'save',kind,index})}>{watch?'儲存目前清單至此格':'儲存目前檢視至此格'}</button>
  {clearing?<div className="slot-clear-confirm"><p>確認清空「{entry.name}」的已儲存{watch?`${list.ids.length} 檔股票`:'分析設定'}？儲存格與目前分析會保留。</p><div><button onClick={()=>setClearing(false)}>取消</button><button onClick={()=>run({type:'clear',kind,index})}>確認清空內容</button></div></div>:<button className="slot-clear" disabled={watch?!list.ids.length:!library.savedViews[index].preset} onClick={()=>setClearing(true)}>清空此格內容</button>}
  </fieldset>{busy&&<p role="status">正在儲存…</p>}{feedback&&<p className={feedback.ok?'slot-success':'subset-error'} role={feedback.ok?'status':'alert'}>{feedback.notice}</p>}
 </section>;
}
