import {useEffect,useRef,useState} from 'react';
import {useAuth} from './AuthContext';
import {createPortal} from 'react-dom';
import {ChevronDown,Search} from 'lucide-react';
import {benchmarkOptions,type RuntimeData} from './model';
import {browserStorage,readRecentBenchmarks,saveRecentBenchmarks} from './localWorkspace';

export default function BenchmarkPicker({market,value,onChange,runtime}:{market:string;value:string;onChange:(value:string)=>void;runtime?:RuntimeData}){
 const auth=useAuth();
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[recent,setRecent]=useState<string[]>([]),[active,setActive]=useState(0),[position,setPosition]=useState({top:0,left:0,width:300,maxHeight:360});
 const trigger=useRef<HTMLButtonElement>(null),popup=useRef<HTMLDivElement>(null),input=useRef<HTMLInputElement>(null);
 const options=benchmarkOptions('security',market,runtime),term=query.trim().toLocaleLowerCase();
 const history=recent.map(id=>options.find(o=>o.value===id)).filter((o):o is {value:string;label:string}=>!!o);
 const matches=options.filter(o=>o.label.toLocaleLowerCase().includes(term));
 const rows=term?matches:[...history,...options.filter(o=>!recent.includes(o.value))];
 useEffect(()=>{setRecent(readRecentBenchmarks(browserStorage(auth?.session?.owner),runtime))},[runtime]);
 useEffect(()=>{if(!open)return;input.current?.focus();const close=(e:PointerEvent)=>{if(!popup.current?.contains(e.target as Node)&&!trigger.current?.contains(e.target as Node))setOpen(false)};const resize=()=>setOpen(false);document.addEventListener('pointerdown',close);window.addEventListener('resize',resize);return()=>{document.removeEventListener('pointerdown',close);window.removeEventListener('resize',resize)}},[open]);
 useEffect(()=>{popup.current?.querySelector('[data-active="true"]')?.scrollIntoView({block:'nearest'})},[active]);
 function toggle(){if(open){setOpen(false);return}const r=trigger.current!.getBoundingClientRect(),width=Math.min(320,window.innerWidth-16);setPosition({left:Math.max(8,Math.min(r.left,window.innerWidth-width-8)),top:r.bottom+5,width,maxHeight:Math.max(150,Math.min(360,window.innerHeight-r.bottom-16))});setQuery('');setActive(0);setOpen(true)}
 function choose(id:string){onChange(id);const next=[id,...recent.filter(x=>x!==id)].slice(0,5);setRecent(next);saveRecentBenchmarks(browserStorage(auth?.session?.owner),next);setOpen(false);trigger.current?.focus()}
 return <><button ref={trigger} type="button" className="benchmark-search-trigger" aria-label="Benchmark 比較對象" aria-haspopup="listbox" aria-expanded={open} onClick={toggle}>{options.find(o=>o.value===value)?.label||'選擇股票／ETF'}<ChevronDown size={14}/></button>{open&&createPortal(<div ref={popup} className="benchmark-search-popup" style={position} onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();setOpen(false);trigger.current?.focus()}if(e.key==='Tab')setOpen(false)}}>
 <div className="benchmark-search-input"><Search size={15}/><input ref={input} role="combobox" aria-label="搜尋基準代號或名稱" aria-controls="benchmark-search-results" aria-expanded="true" aria-autocomplete="list" aria-activedescendant={rows[active]?`benchmark-option-${rows[active].value}`:undefined} placeholder="輸入代號或名稱" value={query} onChange={e=>{setQuery(e.target.value);setActive(0)}} onKeyDown={e=>{if(e.nativeEvent.isComposing)return;if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setActive(a=>rows.length?(a+(e.key==='ArrowDown'?1:-1)+rows.length)%rows.length:0)}if(e.key==='Enter'){e.preventDefault();if(rows[active])choose(rows[active].value)}}}/></div>
 <div className="benchmark-search-results" id="benchmark-search-results" role="listbox" aria-label="股票／ETF 搜尋結果">{!term&&history.length>0&&<div className="benchmark-search-caption">最近使用 · 最多 5 筆</div>}{rows.map((o,i)=><div key={o.value}>{!term&&i===history.length&&<div className="benchmark-search-caption">{history.length?'其他示範標的':'示範標的'}</div>}<button type="button" role="option" tabIndex={-1} id={`benchmark-option-${o.value}`} aria-selected={value===o.value} data-active={i===active} onMouseEnter={()=>setActive(i)} onClick={()=>choose(o.value)}>{o.label}</button></div>)}{!rows.length&&<p className="benchmark-search-empty">找不到符合的示範標的</p>}</div>
 </div>,document.body)}</>
}
