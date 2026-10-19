import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import type {AuthSession} from '../../shared/authContract';
import {loadAuth,authAction,configureAuth} from './authClient';
type Auth={session:AuthSession|null;error:string;busy:boolean;refresh:()=>Promise<void>;login:(username:string,password:string,claim:boolean)=>Promise<void>;logout:(all?:boolean)=>Promise<void>};
const Context=createContext<Auth|null>(null);
export const useAuth=()=>useContext(Context);
export function AuthProvider({children}:{children:ReactNode}){
 const [session,setSession]=useState<AuthSession|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),serial=useRef(0),operation=useRef(false),refreshing=useRef<Promise<void>|null>(null),channel=useRef<BroadcastChannel|null>(null);
 const accept=(next:AuthSession|null)=>{configureAuth(next);setSession(next);setError('')};
 const refresh=async()=>{if(operation.current)return;if(refreshing.current)return refreshing.current;const token=++serial.current;refreshing.current=(async()=>{try{const next=await loadAuth();if(serial.current===token)accept(next)}catch(e){if(serial.current===token)setError(e instanceof Error?e.message:'帳號服務無法連線。')}finally{refreshing.current=null}})();return refreshing.current};
 useEffect(()=>{void refresh();const notify=()=>void refresh(),visible=()=>{if(document.visibilityState==='visible')notify()};window.addEventListener('twstockrs-auth-refresh',notify);document.addEventListener('visibilitychange',visible);const timer=setInterval(notify,30000);if(typeof BroadcastChannel!=='undefined'){channel.current=new BroadcastChannel('twstockrs-auth');channel.current.onmessage=notify}return()=>{serial.current++;configureAuth(null);clearInterval(timer);window.removeEventListener('twstockrs-auth-refresh',notify);document.removeEventListener('visibilitychange',visible);channel.current?.close()}},[]);
 const run=async(action:()=>Promise<AuthSession|null>)=>{if(operation.current)throw Error('帳號操作進行中。');operation.current=true;serial.current++;setBusy(true);try{accept(await action());channel.current?.postMessage('changed')}finally{operation.current=false;setBusy(false)}};
 const value:Auth={session,error,busy,refresh,login:(username,password,claim)=>run(()=>authAction('login',{username,password,claim_guest_shares:claim})),logout:async(all=false)=>{await run(()=>authAction('logout',{all}));await refresh()}};
 return <Context.Provider value={value}>{children}</Context.Provider>;
}
