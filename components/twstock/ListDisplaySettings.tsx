import {useEffect,useId,useRef,useState} from 'react';
import {SlidersHorizontal} from 'lucide-react';
import {defaultListDisplay,listColumnOptions,listSortOptions,type ListDisplay,type ListSort,type ListColumns} from './listPreferences';

export function ListDisplayControls({value,onChange}:{value:ListDisplay;onChange:(value:ListDisplay)=>void}){
 return <div className="list-display-controls" role="group" aria-label="清單排序與欄位"><label>排序依據<select aria-label="清單排序依據" value={value.sort} onChange={event=>onChange({...value,sort:event.target.value as ListSort})}>{Object.entries(listSortOptions).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>排序方向<select aria-label="清單排序方向" value={value.direction} disabled={value.sort==='source'} onChange={event=>onChange({...value,direction:event.target.value as ListDisplay['direction']})}><option value="asc">由小到大</option><option value="desc">由大到小</option></select></label><fieldset><legend>顯示欄位</legend><p>代號、名稱與資料異常提示固定顯示。</p>{Object.entries(listColumnOptions).map(([key,label])=><label key={key}><input type="checkbox" checked={value.columns[key as keyof ListColumns]} onChange={event=>onChange({...value,columns:{...value.columns,[key]:event.target.checked}})}/>{label}</label>)}</fieldset><p>{value.sort==='quadrant'?'象限順序：領先 → 轉弱 → 落後 → 改善。':''}無數值項目固定排最後。只影響清單呈現。</p><button onClick={()=>onChange(defaultListDisplay())}>恢復此清單預設</button></div>;
}
export default function ListDisplaySettings({value,onChange}:{value:ListDisplay;onChange:(value:ListDisplay)=>void}){
 const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),id=useId();
 useEffect(()=>{
  if(!open)return;
  const outside=(event:PointerEvent)=>{if(!root.current?.contains(event.target as Node))setOpen(false)};
  document.addEventListener('pointerdown',outside);
  return()=>{document.removeEventListener('pointerdown',outside)};
 },[open]);
 return <div ref={root} className="list-display-settings" onKeyDown={event=>{if(event.key==='Escape'&&open){event.preventDefault();event.stopPropagation();setOpen(false);trigger.current?.focus()}}} onBlur={event=>{if(event.relatedTarget&&!event.currentTarget.contains(event.relatedTarget as Node))setOpen(false)}}><button ref={trigger} aria-label="排序與欄位設定" aria-expanded={open} aria-controls={open?id:undefined} title={`排序：${listSortOptions[value.sort]}${value.sort==='source'?'':value.direction==='asc'?'，由小到大':'，由大到小'}`} onClick={()=>setOpen(!open)}><SlidersHorizontal size={13}/>排序／欄位</button>{open&&<div id={id} className="list-display-popup"><ListDisplayControls value={value} onChange={onChange}/></div>}</div>;
}
