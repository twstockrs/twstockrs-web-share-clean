import './app/globals.css';
import {createRoot} from 'react-dom/client';
import {useState,lazy,Suspense} from 'react';
const Workstation=lazy(()=>import('./components/twstock/Workstation'));
const FrozenSharePage=lazy(()=>import('./components/twstock/FrozenSharePage'));
import {AuthProvider,useAuth} from './components/twstock/AuthContext';
import {offlineAnalysis} from './components/twstock/useAnalysis';
import type {AnalysisState} from './components/twstock/model';
function App(){
 const auth=useAuth(),[analysis,setAnalysis]=useState<{owner:string;state:AnalysisState}|null>(null),token=new URLSearchParams(location.search).get('share');
 if(token&&!analysis)return <FrozenSharePage token={token} onOpen={state=>{setAnalysis({owner:auth?.session?.owner||'',state});history.replaceState(null,'',location.pathname)}}/>;
 if(!offlineAnalysis&&!auth?.session)return <div className="app-shell" data-theme="dark"><div className="auth-loading"><h1>TWStockRS</h1><p role="status">{auth?.error||'正在確認帳號與權限…'}</p>{auth?.error&&<button onClick={()=>void auth.refresh()}>重試連線</button>}</div></div>;
 return <Workstation key={auth?.session?.owner||'offline'} initialAnalysis={analysis?.owner===auth?.session?.owner?analysis?.state:undefined}/>;
}
createRoot(document.getElementById('root')!).render(<Suspense fallback={<div className="app-shell" data-theme="dark"><div className="auth-loading"><h1>TWStockRS</h1><p role="status">正在載入工作台…</p></div></div>}>{offlineAnalysis?<App/>:<AuthProvider><App/></AuthProvider>}</Suspense>);
