import {useState} from 'react';
import {Entity} from './model';
import {SourceLoadResult} from './sourceLoad';

export default function StockSubsetPicker({title,entities,limit,onApply,onCancel}:{title:string;entities:Entity[];limit:number;onApply:(ids:string[])=>SourceLoadResult|Promise<SourceLoadResult>;onCancel:()=>void}){
 const [selected,setSelected]=useState<string[]>([]),[query,setQuery]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const search=query.trim().toLocaleLowerCase(),shown=entities.filter(entity=>`${entity.code||entity.id} ${entity.name}`.toLocaleLowerCase().includes(search));
 const apply=async()=>{if(busy)return;setBusy(true);try{const result=await onApply(selected);if(result.type==='blocked')setError(result.issues.join('；'));else if(result.type==='choose')setError('來源已變更，請取消後重新開啟。')}catch(error){setError(error instanceof Error?error.message:'載入未完成。')}finally{setBusy(false)}};
 return <section className="subset-picker" aria-label="選擇要載入的股票"><fieldset className="async-fields" disabled={busy}>
  <h3>{title} · 選擇股票</h3>
  <p>來源有 {entities.length} 檔，目前最多可載入 {limit} 檔。請自行勾選；載入後取代目前清單，來源內容不變。</p>
  <label className="subset-search">搜尋代號或名稱<input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="輸入代號或名稱"/></label>
  <div className="subset-count" role="status"><strong>已選 {selected.length} / {limit} 檔</strong><button disabled={!selected.length} onClick={()=>{setSelected([]);setError('')}}>清除勾選</button></div>
  <div className="subset-options">{shown.map(entity=>{const checked=selected.includes(entity.id);return <label key={entity.id}><input type="checkbox" checked={checked} disabled={!checked&&selected.length>=limit} onChange={()=>{setSelected(ids=>checked?ids.filter(id=>id!==entity.id):[...ids,entity.id]);setError('')}}/><span><b>{entity.code||entity.id}</b> {entity.name}<small>{entity.market} · {entity.sector}</small></span></label>})}{!shown.length&&<p>找不到符合的來源股票。</p>}</div>
  {error&&<p className="subset-error" role="alert">{error}</p>}
  <div className="subset-actions"><button onClick={onCancel}>取消</button><button className="primary-button" onClick={()=>void apply()}>{selected.length?`載入 ${selected.length} 檔`:'載入空清單'}</button></div>
 </fieldset>{busy&&<p role="status">正在載入來源…</p>}</section>;
}
