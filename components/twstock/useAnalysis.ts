import {useEffect,useMemo,useState,useRef} from 'react';
import {AnalysisClient} from './analysisClient';
import {PlaybackClient} from './playbackClient';
import {buildMockAnalysis,createAnalysisRequest,decodeAnalysisResponse,requestKey,AnalysisError,type AnalysisData} from '../../shared/mockAnalysis';
import type {AnalysisState} from './model';
declare const __TWSTOCKRS_OFFLINE__:boolean;
export const offlineAnalysis=typeof __TWSTOCKRS_OFFLINE__!=='undefined'&&__TWSTOCKRS_OFFLINE__;
type Delivery={key:string;state:AnalysisState;data:AnalysisData;requestId:string};
export function useAnalysis(state:AnalysisState,blocked:boolean,enabled=true,playing=false){
 const [progress,setProgress]=useState(''),generation=useRef(0),onProgress=(value:{running:boolean;position:number|null})=>setProgress(value.running?'背景運算中…':value.position!==null?`等候運算中，排隊第 ${value.position} 位…`:'正在取得分析結果…');
 const key=requestKey(createAnalysisRequest(state)),[client]=useState(()=>new AnalysisClient(undefined,8000,onProgress)),[retry,setRetry]=useState(0),[playbackClient]=useState(()=>new PlaybackClient(undefined,8000,onProgress));
 useEffect(()=>()=>playbackClient.cancel(),[playbackClient]);
 const batchPlayback=playing&&!!state.runtime;
 useEffect(()=>{if(!batchPlayback)playbackClient.cancel()},[batchPlayback,playbackClient]);
 const [remote,setRemote]=useState<{delivery:Delivery|null;error:string;errorCode?:string;key:string;playback?:boolean;phase:'idle'|'loading'|'ready'|'error'}>({delivery:null,error:'',key:'',phase:'idle'});
 const offline=useMemo(()=>{
  if(!offlineAnalysis||blocked)return null;
  const request=createAnalysisRequest(state,'offline'),{data}=decodeAnalysisResponse(buildMockAnalysis(request,'offline'),request);
  return {key,state,data,requestId:'offline'};
 },[key,blocked]);
 const [offlineDelivered,setOfflineDelivered]=useState<Delivery|null>(offline);
 useEffect(()=>{if(offline)setOfflineDelivered(offline)},[offline]);
 useEffect(()=>{
  if(offlineAnalysis||blocked||!enabled)return;
  let active=true;const current=++generation.current;setProgress('');
  setRemote(previous=>({...previous,error:'',errorCode:'',key,phase:'loading'}));
  (batchPlayback?playbackClient.load(createAnalysisRequest(state,'playback'),state.runtime!):client.load(createAnalysisRequest(state),state.runtime)).then(result=>{if(active&&current===generation.current&&result){if(!result.data.version)throw Error('後端尚未提供版本資訊，請更新並重新啟動服務。');setRemote({delivery:{key,state,data:result.data,requestId:result.response.request_id},error:'',key,playback:batchPlayback,phase:'ready'})}}).catch(error=>{if(active&&current===generation.current)setRemote(previous=>({...previous,key,error:error instanceof Error?error.message:'無法取得分析結果。',errorCode:error instanceof AnalysisError?error.code:'',phase:'error'}))});
  return()=>{active=false;client.cancel()};
 },[key,blocked,retry,client,enabled,batchPlayback,playbackClient]);
 const delivered=offlineAnalysis?(offline||offlineDelivered):remote.delivery;
 const ready=enabled&&!blocked&&delivered?.key===key&&(offlineAnalysis||(remote.key===key&&remote.phase==='ready'&&!!remote.playback===batchPlayback));
 const error=!offlineAnalysis&&remote.key===key?remote.error:'';
 return {progress,cancel:()=>{generation.current++;client.cancel();playbackClient.cancel();setRemote(previous=>({...previous,key,error:'已取消本次運算，可調整條件或重試。',errorCode:'JOB_CANCELLED',phase:'error'}))},delivery:enabled&&(ready||blocked)?delivered:null,ready:!!ready,pending:!blocked&&!ready&&!error,error:blocked?'':error,errorCode:remote.key===key?remote.errorCode:'',requestId:ready?delivered?.requestId:'',retry:()=>{client.cancel();playbackClient.cancel();setRemote(previous=>({...previous,phase:'idle'}));setRetry(value=>value+1)}};
}
