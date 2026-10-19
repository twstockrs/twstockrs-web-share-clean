import {useRef,useState,useLayoutEffect} from 'react';
import {CalendarDays,ChevronLeft,ChevronRight,X} from 'lucide-react';
import {analysisDates} from './model';
import {marketClosedReason} from './tradingCalendar';

export default function TradingDatePicker({index,frequency,onChange,availableDates,computed=false}:{index:number;frequency:string;onChange:(index:number)=>void;availableDates?:string[];computed?:boolean}){
 const dates=availableDates||analysisDates(frequency),current=dates[index]||dates.at(-1)||'';
 const dialog=useRef<HTMLDialogElement>(null),trigger=useRef<HTMLButtonElement>(null);
 const [month,setMonth]=useState('2026-09'),[position,setPosition]=useState({top:0,left:0}),last=dates.length-1;
 const year=Number(month.slice(0,4)),monthNumber=Number(month.slice(5,7))-1;
 const [isOpen,setIsOpen]=useState(false);
 useLayoutEffect(()=>{const element=dialog.current;if(!element?.open)return;const rect=trigger.current!.getBoundingClientRect(),height=element.getBoundingClientRect().height;setPosition({left:Math.max(8,Math.min(rect.right-320,window.innerWidth-328)),top:Math.max(8,Math.min(rect.bottom+8,window.innerHeight-height-8))})},[month,isOpen]);
 function open(){if(!current)return;setMonth(current.slice(0,7));dialog.current?.showModal();setIsOpen(true)}
 function choose(date:string){const next=dates.indexOf(date);if(next<0||!computed&&marketClosedReason(date))return;onChange(next);dialog.current?.close();trigger.current?.focus()}
 function moveMonth(delta:number){setMonth(new Date(Date.UTC(year,monthNumber+delta,1)).toISOString().slice(0,7))}
 const months=[...new Set(dates.map(date=>date.slice(0,7)))],years=[...new Set(months.map(month=>month.slice(0,4)))],yearMonths=months.filter(value=>value.startsWith(String(year)+'-'));
 function jumpYear(value:string){const options=months.filter(month=>month.startsWith(value+'-'));setMonth(options.find(value=>value.slice(5)===month.slice(5))||options[0])}
 const first=new Date(Date.UTC(year,monthNumber,1)).getUTCDay(),days=new Date(Date.UTC(year,monthNumber+1,0)).getUTCDate();
 return <div className="date-control"><span>Viewing Date 檢視日期</span><div className="date-row">
  <button aria-label={frequency==='Weekly'?'前一完成週':'前一交易日'} disabled={index<=0||!dates.length} onClick={()=>choose(dates[index-1])}><ChevronLeft size={14}/></button>
  <button ref={trigger} disabled={!dates.length} className="calendar-trigger" aria-label="Viewing Date 檢視日期，開啟日曆" aria-haspopup="dialog" onClick={open}><CalendarDays size={15}/>{current||'無完成端點'}{index===last&&last>=0&&<span>最新</span>}</button>
  <button aria-label={frequency==='Weekly'?'後一完成週':'後一交易日'} disabled={index>=last||!dates.length} onClick={()=>choose(dates[index+1])}><ChevronRight size={14}/></button>
  <button disabled={!dates.length} className="latest-button" title="回到此市場及頻率的最新可用端點" onClick={()=>choose(dates[last])}>Latest</button>
 </div>
 <dialog ref={dialog} onClose={()=>setIsOpen(false)} className="trading-calendar" aria-label="選擇檢視日期" style={position} onClick={e=>{if(e.target===e.currentTarget)dialog.current?.close()}}>
  <header><button aria-label="上一個月" disabled={computed?month<=(dates[0]?.slice(0,7)||month):monthNumber===0} onClick={()=>moveMonth(-1)}><ChevronLeft size={17}/></button><strong aria-live="polite">{year} 年 {monthNumber+1} 月</strong><button aria-label="下一個月" disabled={computed?month>=(dates.at(-1)?.slice(0,7)||month):monthNumber===11} onClick={()=>moveMonth(1)}><ChevronRight size={17}/></button><button aria-label="關閉日曆" onClick={()=>dialog.current?.close()}><X size={17}/></button></header>
  {computed&&<div className="calendar-jump"><label>年份<select aria-label="檢視年份" value={String(year)} onChange={e=>jumpYear(e.target.value)}>{years.map(value=><option key={value} value={value}>{value} 年</option>)}</select></label><label>月份<select aria-label="檢視月份" value={month} onChange={e=>setMonth(e.target.value)}>{yearMonths.map(value=><option key={value} value={value}>{Number(value.slice(5))} 月</option>)}</select></label></div>}
  <div className="calendar-grid"><div className="calendar-weekdays">{'日一二三四五六'.split('').map(day=><span key={day}>{day}</span>)}</div>
  {Array.from({length:first},(_,i)=><span key={'blank'+i}/>)}
  {Array.from({length:days},(_,i)=>{const day=i+1,date=`${month}-${String(day).padStart(2,'0')}`,available=dates.includes(date),closed=computed?null:marketClosedReason(date),reason=closed||(!available?computed?'未完成或超出可查看範圍':'無示範資料':frequency==='Weekly'?'可選完成週端點':'可選交易端點');return <button key={date} disabled={!!closed||!available} aria-label={`${date}，${reason}`} aria-pressed={current===date} title={reason} className={closed?'market-closed':available?'available':'no-data'} onClick={()=>choose(date)}>{day}</button>})}
  </div>
  <p className="calendar-legend"><span>● 可選端點</span><span>灰字：不可選</span></p>
  <p className="calendar-note">{computed?`依啟用版本及方案：${dates[0]||'—'} ～ ${dates.at(-1)||'—'}`:frequency==='Weekly'?'週頻示範：09/11、09/18 完成週端點':'日頻示範：2026/09/11–09/24'}<br/>{computed?'只可選此市場已完成的端點；開休市與完成週依啟用資料版本。':'週末與公告休市日不可選。'}</p>
  <footer><button onClick={()=>setMonth(current.slice(0,7)||'2026-09')}>回到檢視月份</button><a href="https://www.twse.com.tw/zh/trading/holiday.html" target="_blank" rel="noreferrer">證交所休市表</a></footer>
 </dialog></div>
}
