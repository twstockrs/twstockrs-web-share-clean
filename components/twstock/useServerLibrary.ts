import {useEffect,useRef,useState} from 'react';
import {LibraryClient} from './libraryClient';
import type {LibrarySnapshot} from '../../shared/libraryContract';
import type {Plan} from './model';
export function useServerLibrary(plan:Plan,enabled:boolean){
 const [client]=useState(()=>new LibraryClient()),epoch=useRef(0),working=useRef(false);
 const [view,setView]=useState<{snapshot:LibrarySnapshot|null;phase:'loading'|'ready'|'error';notice:string;busy:boolean}>({snapshot:null,phase:'loading',notice:'',busy:false});
 const live=useRef({plan,snapshot:view.snapshot,ready:false});live.current={plan,snapshot:view.snapshot,ready:view.phase==='ready'&&view.snapshot?.plan===plan};
 const refresh=async()=>{
  if(!enabled||working.current)return;
  const token=++epoch.current;setView(previous=>({...previous,phase:'loading',notice:'',busy:false}));
  try{const result=await client.call('open',plan);if(token===epoch.current){live.current={plan,snapshot:result.snapshot,ready:true};setView({snapshot:result.snapshot,phase:'ready',notice:'',busy:false})}}
  catch(error){if(token===epoch.current)setView(previous=>({...previous,phase:'error',notice:error instanceof Error?error.message:'後端清單無法讀取。',busy:false}))}
 };
 useEffect(()=>{working.current=false;void refresh();return()=>{epoch.current++}},[plan,enabled]);
 const run=async(operation:string,input:Record<string,unknown>={},expectedRevision?:number)=>{
  const current=live.current;
  if(!enabled||!current.ready||!current.snapshot)throw Error('請先重新讀取後端清單。');
  if(working.current)throw Error('後端操作進行中，請稍候。');
  const token=epoch.current;working.current=true;setView(previous=>({...previous,busy:true,notice:''}));
  try{
   const result=await client.call(operation,current.plan,{expected_revision:expectedRevision??current.snapshot.revision,...input});
   if(token!==epoch.current||current.plan!==live.current.plan)throw Error('模擬方案已變更，請重新讀取後端清單核對結果。');
   live.current={plan:current.plan,snapshot:result.snapshot,ready:true};setView({snapshot:result.snapshot,phase:'ready',notice:'',busy:false});return result.value;
  }catch(error){if(token===epoch.current){live.current.ready=false;setView(previous=>({...previous,phase:'error',busy:false,notice:error instanceof Error?error.message:'後端操作未確認，請重新讀取核對。'}))}throw error}
  finally{if(token===epoch.current)working.current=false}
 };
 return {...view,ready:view.phase==='ready'&&view.snapshot?.plan===plan,refresh,run};
}
export type ServerLibraryService=ReturnType<typeof useServerLibrary>;
