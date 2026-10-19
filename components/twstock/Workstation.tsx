import {BrandMark,BrandWordmark} from './Brand';
"use client";
import {useState,useMemo,useEffect,useRef,useCallback,lazy,Suspense,type SetStateAction} from 'react';
import {flushSync} from 'react-dom';
import {ChevronDown,FlaskConical,RotateCcw,Plus} from 'lucide-react';
import RSChart,{ChartExportHandle} from './RSChart';
import {createExportContext,buildCsvExport,exportSignature,ExportFormat} from './exportData';
import {buildPngSvg,svgToPng,downloadBlob} from './pngExport';
import {initialState,catalog,analysisDates,stateDates,stateCatalog,colors,translations,lastPoint,quadrant,capacity,Plan,benchmarkLabel,analysisIssues,analysisDefaults,updateAnalysis,classifyStockInput,sectorsForMarket,capabilities} from './model';
import {trailPlaybackFrame,trailPlaybackLength,latestTrailQuadrants} from './trailPlayback';
import {useAnalysis,offlineAnalysis} from './useAnalysis';
import {useAnalysisContext} from './useAnalysisContext';
import {defaultStockIds,isLegacyDefaultList} from './defaultStocks';
import {verifyInputVersion} from './analysisClient';
import {useServerLibrary} from './useServerLibrary';
import {decodeSourceResult} from './libraryClient';
import {emptyLibrary} from '../../shared/libraryContract';
import {createAnalysisRequest,AnalysisError} from '../../shared/mockAnalysis';
import {prepareSourceLoad,SourceKind} from './sourceLoad';
import {readLocalLibrary,librarySources,editLocalLibrary,commitLocalLibrary,LibraryAction} from './localLibrary';
import {TopNav,AnalysisControls,ChartToolbar,ExportControls,PlaybackControls} from './Controls';
import {CurrentList,DetailPanel,LoadingPanel} from './Panels';
const Drawer=lazy(()=>import('./Drawer'));
import HelpDialog,{type HelpTopic} from './HelpDialog';
import ShareDialog from './ShareDialog';
import {useAuth} from './AuthContext';
import {verifyExportAccess} from './authClient';
import {readListPreferences,type ListDisplay} from './listPreferences';
import {readSidebarPreferences} from './sidebarPreferences';
import SidebarToggle from './SidebarToggle';
import {browserStorage,readWorkspace,readWorkspaceMarket,readUiPreferences,readFrequencyPreferences,readRetainedSlots,workspaceSnapshot,saveWorkspaceSnapshot,saveUiPreferences,saveFrequencyPreferences,saveRetainedSlots,rememberFrequency,switchFrequency,Frequency,localKeys} from './localWorkspace';
export default function Workstation({initialAnalysis}:{initialAnalysis?:typeof initialState}){
 const auth=useAuth(),bootPlan=auth?.session?.plan||initialState.plan;
 const [storage]=useState(()=>browserStorage(auth?.session?.owner));
 const [boot,setBoot]=useState(()=>{const restored=readWorkspace(storage,bootPlan),ui=readUiPreferences(storage);return {state:{...(restored.state||analysisDefaults(bootPlan,readWorkspaceMarket(storage)||'TWSE')),filter:ui.filter},theme:ui.theme,notice:restored.notice,preferences:readFrequencyPreferences(storage),retained:readRetainedSlots(storage),library:readLocalLibrary(storage),restored:!!restored.state}});
 const [browserLibrary,setBrowserLibrary]=useState(boot.library.library),[libraryRaw,setLibraryRaw]=useState(boot.library.raw);
 const [theme,setTheme]=useState<'light'|'dark'>(boot.theme);
 const [listPreferences,setListPreferences]=useState(()=>readListPreferences(storage));
 const [sidebar,setSidebar]=useState(()=>readSidebarPreferences(storage));
 const sidebarOpenButton=useRef<HTMLButtonElement>(null),sidebarCloseButton=useRef<HTMLButtonElement>(null);
 const toggleSidebar=(collapsed:boolean)=>{setSidebar({collapsed});requestAnimationFrame(()=>(collapsed?sidebarOpenButton:sidebarCloseButton).current?.focus())};
 const openSidebar=()=>{if(window.matchMedia('(min-width:768px)').matches)setSidebar({collapsed:false})};
 const [localNotice,setLocalNotice]=useState(initialAnalysis?"":boot.notice),[persistReady,setPersistReady]=useState(!!initialAnalysis||!boot.notice);
 const preferences=useRef(boot.preferences);
 const initializeDefaults=useRef(!initialAnalysis&&!boot.notice&&(!boot.restored||isLegacyDefaultList(boot.state)));

 useEffect(()=>{document.documentElement.dataset.theme=theme},[theme]);
 const [state,setRawState]=useState(initialAnalysis||boot.state),[action,setAction]=useState({type:'Reset',key:0}),[tab,setTab]=useState('list'),[drawer,setDrawer]=useState(''),[sheet,setSheet]=useState(false),[toast,setToast]=useState(''),[loading,setLoading]=useState(false),[playing,setPlaying]=useState(false),[speed,setSpeed]=useState(1),[demoMenu,setDemoMenu]=useState(false);
 const [playbackFrame,setPlaybackFrame]=useState<number|null>(null),[preparingPlayback,setPreparingPlayback]=useState(false);
 const stopPlayback=useCallback(()=>{setPlaying(false);setPlaybackFrame(null);setPreparingPlayback(false)},[]);
 const beginNewAnalysis=useCallback(()=>{stopPlayback();initializeDefaults.current=false;setPersistReady(true);setLocalNotice('')},[stopPlayback]);
 const [chartVisibility,setChartVisibility]=useState<Record<string,string[]>>({});
 const visibilityScope=state.mode+'|'+state.market,hiddenIds=useMemo(()=>chartVisibility[visibilityScope]||[],[chartVisibility,visibilityScope]);
 const stockInputRef=useRef<HTMLInputElement>(null);
 const toggleVisibility=(id:string)=>{const hiding=!hiddenIds.includes(id);setChartVisibility(previous=>({...previous,[visibilityScope]:hiding?[...(previous[visibilityScope]||[]),id]:(previous[visibilityScope]||[]).filter(value=>value!==id)}));if(hiding)setState(previous=>({...previous,selectedEntity:previous.selectedEntity===id?null:previous.selectedEntity,hoveredId:previous.hoveredId===id?null:previous.hoveredId}))};
 const showAllEntities=()=>setChartVisibility(previous=>({...previous,[visibilityScope]:[]}));
 const focusStockInput=()=>{flushSync(()=>{setSheet(true);setTab('list');openSidebar()});stockInputRef.current?.focus();stockInputRef.current?.scrollIntoView({block:'nearest'})};
 const playbackTick=useRef(0);
 const importedDate=useRef(initialAnalysis?stateDates(initialAnalysis)[initialAnalysis.viewingDate]:null);
 const [sharing,setSharing]=useState<{id:string;key:string;count:number}|null>(null);
 const sheetHandle=useRef<HTMLButtonElement>(null);
 const [helpTopic,setHelpTopic]=useState<HelpTopic|null>(null);
 const closeSheet=useCallback(()=>{setSheet(false);if(window.matchMedia('(max-width:767px)').matches)sheetHandle.current?.focus()},[]);
 const setState=useCallback((action:SetStateAction<typeof initialState>)=>setRawState(previous=>typeof action==='function'?action(previous):action),[]);
 const [browserRetained,setBrowserRetained]=useState(boot.retained),[dataRevision,setDataRevision]=useState(0);
 const sourceLoadToken=useRef(0);
 const serverLibrary=useServerLibrary(state.plan,!offlineAnalysis),serverSnapshot=serverLibrary.snapshot?.plan===state.plan?serverLibrary.snapshot:null;
 const library=offlineAnalysis?browserLibrary:serverSnapshot?.library||emptyLibrary(),retained=offlineAnalysis?browserRetained:serverSnapshot?.retained||{watchlist:null,saved:null};
 const chartExport=useRef<ChartExportHandle|null>(null),[exporting,setExporting]=useState(false),exportLive=useRef({state,theme,hiddenIds});exportLive.current={state,theme,hiddenIds};
 const context=useAnalysisContext(state.market,state.plan,offlineAnalysis);
 const contextReady=context.ready&&(offlineAnalysis||state.runtime===context.runtime);
 const issues=analysisIssues(state),blocked=issues.length>0;
 const analysis=useAnalysis(state,blocked,contextReady);
 useEffect(()=>{if(!context.ready||offlineAnalysis||state.runtime===context.runtime)return;
  const seedDefaults=initializeDefaults.current;initializeDefaults.current=false;
  stopPlayback();setDemoMenu(false);setState(previous=>{const oldDates=stateDates(previous),oldDate=oldDates[previous.viewingDate],available=analysisDates(previous.frequency,context.runtime),wasLatest=previous.viewingDate===oldDates.length-1;
   const fixed=importedDate.current;importedDate.current=null;const found=available.indexOf(fixed||oldDate);const next={...previous,runtime:context.runtime,viewingDate:fixed?found:!wasLatest&&found>=0?found:Math.max(0,available.length-1),statusOverrides:context.runtime?{}:previous.statusOverrides,selectedEntity:null,hoveredId:null};return seedDefaults&&context.runtime?{...next,currentList:defaultStockIds(next)}:next;
  });
 },[context.ready,context.runtime,state.runtime,offlineAnalysis,setState]);
 useEffect(()=>{if(analysis.errorCode==='INPUT_VERSION_CHANGED')context.refresh()},[analysis.errorCode]);
 useEffect(()=>{if(!context.ready||!context.runtime||persistReady||!localNotice.startsWith('上次本機設定未載入'))return;const restored=readWorkspace(storage,state.plan,context.runtime);if(restored.state){setState({...restored.state,filter:state.filter});setLocalNotice('');setPersistReady(true)}},[context.ready,context.runtime,persistReady,localNotice,storage,state.plan,setState]);
 const exportGeneration=useRef(0),analysisLive=useRef(analysis);analysisLive.current=analysis;
 const versionChanged=(market:string)=>{if(market===state.market){exportGeneration.current++;stopPlayback();context.refresh();analysis.retry()}};
 const displayState=analysis.delivery?.state||state;
 const dates=stateDates(displayState);
 const toastTimer=useRef<ReturnType<typeof setTimeout>|null>(null),loadingTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
 const notify=useCallback((message:string)=>{setToast(message);if(toastTimer.current)clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setToast(''),4500)},[]);
 const update=useCallback((key:keyof typeof initialState,value:any)=>{
  if(key==='frequency'){
   const remembered=rememberFrequency(preferences.current,state),next=switchFrequency(state,value as Frequency,remembered);
   if(next===state)return;
   beginNewAnalysis();preferences.current=remembered;setState(next);
  }else{
   if(updateAnalysis(state,key,value)===state)return;
   if(['market','benchmarkType','benchmark','period','trail','priceType','viewingDate'].includes(key))beginNewAnalysis();
   setState(s=>updateAnalysis(s,key,value));
  }
 },[setState,state,beginNewAnalysis]);
 const snapshot=workspaceSnapshot(state);
 useEffect(()=>{if(contextReady&&persistReady&&!blocked&&snapshot&&!saveWorkspaceSnapshot(storage,snapshot))setLocalNotice('此瀏覽器目前無法保存本機分析設定；操作仍可使用。')},[snapshot,contextReady,persistReady,blocked,storage]);
 useEffect(()=>{if(!saveUiPreferences(storage,theme,state.filter,listPreferences,sidebar))setLocalNotice('此瀏覽器目前無法保存介面偏好；本次操作仍可使用。')},[storage,theme,state.filter,listPreferences,sidebar]);
 const changeListDisplay=(value:ListDisplay)=>setListPreferences(previous=>({...previous,[state.mode==='Stock Move'?'stock':'sector']:value}));
 useEffect(()=>{if(offlineAnalysis)saveRetainedSlots(storage,browserRetained)},[storage,browserRetained]);
 useEffect(()=>{if(!persistReady||blocked)return;preferences.current=rememberFrequency(preferences.current,state);saveFrequencyPreferences(storage,preferences.current)},[storage,persistReady,blocked,state.plan,state.frequency,state.period,state.trail]);
 const restoreLocal=()=>{const restored=readWorkspace(storage,state.plan,state.runtime);if(!restored.state){notify(restored.notice||'沒有可還原的本機分析設定。');return}stopPlayback();setState({...restored.state,filter:state.filter});beginNewAnalysis();setTab('list');setSheet(false);setAction({type:'Reset',key:Date.now()});notify('已依目前方案還原本機設定，回到可用最新日期。')};
 const allEntities=stateCatalog(state);
 const entities=useMemo(()=>{const requested=state.mode==='Stock Move'?state.currentList.map(id=>allEntities.find(e=>e.id===id)!).filter(Boolean):sectorsForMarket(state.market,state.runtime);if(analysis.delivery?.data.source==='computed')return analysis.delivery.data.entities;return requested.map(entity=>analysis.delivery?.data.entities.find(item=>item.id===entity.id)||entity)},[state.mode,state.currentList,allEntities,state.market,state.runtime,analysis.delivery]);
 const chartEntities=useMemo(()=>entities.filter(entity=>!hiddenIds.includes(entity.id)),[entities,hiddenIds]);
 const samples=useMemo(()=>Object.fromEntries(entities.map(e=>[e.id,analysis.delivery?.data.samples[e.id]||[]])),[entities,analysis.delivery]);
 const paths=useMemo(()=>Object.fromEntries(Object.entries(samples).map(([id,points])=>[id,points.map(sample=>sample.point)])),[samples]);
 const playbackSteps=trailPlaybackLength(paths),partialPlayback=preparingPlayback||playbackFrame!==null&&playbackFrame<playbackSteps;
 const playbackPaths=useMemo(()=>playbackFrame===null?paths:trailPlaybackFrame(paths,playbackFrame),[paths,playbackFrame]);
 const playbackColors=useMemo(()=>playbackFrame===null?undefined:latestTrailQuadrants(paths),[paths,playbackFrame===null]);
 const pointDates=useMemo(()=>Object.fromEntries(Object.entries(samples).map(([id,points])=>[id,points.map(sample=>sample.date)])),[samples]);
 const priceDates=useMemo(()=>Object.fromEntries(Object.entries(samples).map(([id,points])=>[id,points.map(sample=>sample.priceDate||'')])),[samples]);
 const sourceLabel=analysis.delivery?.data.source==='computed'?(analysis.delivery.data.version?.dataset_kind==='test'?'TEST · 合成價格運算':'INPUT · 匯入價格運算'):undefined;
 const selected=entities.find(e=>e.id===state.selectedEntity);
 const select=(id:string)=>{update('selectedEntity',id);setTab('detail');setSheet(true);openSidebar()};
 const clearSelection=()=>{setState(s=>({...s,selectedEntity:null,hoveredId:null}));setTab('list');setSheet(false)};
 const addDefaults=()=>{if(!contextReady){notify('正在載入市場資料，請稍候。');return}const ids=defaultStockIds(state).filter(id=>!state.currentList.includes(id));if(!ids.length){notify('目前沒有可新增的預設股票；既有清單保留。');return}add(ids,true)};
 const remove=(id:string)=>{if(state.currentList.includes(id))beginNewAnalysis();setState(s=>({...s,currentList:s.currentList.filter(x=>x!==id),selectedEntity:s.selectedEntity===id?null:s.selectedEntity}))};
 const add=(ids:string[],stableIds=false)=>{if(blocked){notify('請先調整為目前方案可用的分析條件，再加入股票。');return []}const {accepted,rejected}=classifyStockInput(ids,state,stableIds);if(accepted.length)beginNewAnalysis();setState(s=>({...s,currentList:[...s.currentList,...accepted]}));notify((accepted.length?`已加入 ${accepted.length} 個標的。`:'沒有新增標的。')+(rejected.length?' '+rejected.join('；'):''));return accepted};
 useEffect(()=>{if(auth?.session&&state.plan!==auth.session.plan){stopPlayback();setState(s=>({...s,plan:auth.session!.plan}));setTab("list")}},[auth?.session?.plan,state.plan]);
 const switchPlan=(plan:Plan)=>{if(auth)return;stopPlayback();if(offlineAnalysis&&state.plan==='Pro'&&plan==='Free')setBrowserRetained({watchlist:null,saved:null});setState(s=>({...s,plan}));setTab('list');notify(`已切換 ${plan} 模擬方案；保留目前清單與設定，不符方案時須先調整。`)};
 const restore=()=>{beginNewAnalysis();stopPlayback();setState(s=>analysisDefaults(s.plan));setTab('list');setAction({type:'Reset',key:Date.now()});notify('已還原此方案的預設示範工作台。')};
 const resetConditions=()=>{beginNewAnalysis();stopPlayback();setState(s=>({...analysisDefaults(s.plan,s.market),mode:s.mode,currentList:s.currentList}));notify('已重設為目前方案的日頻預設條件，保留清單；超容量時請自行移除股票。')};
 const loadSource=async(kind:SourceKind,index:number,ids?:string[])=>{
  const token=++sourceLoadToken.current,requested=JSON.stringify(createAnalysisRequest(state));
  let result:ReturnType<typeof prepareSourceLoad>;
  try{result=offlineAnalysis?prepareSourceLoad(kind,index,state,retained,ids,librarySources(library)):decodeSourceResult((await serverLibrary.run('load',{kind,index,...(kind==='watchlist'?{analysis:createAnalysisRequest(state,'load-source')}:{}),...(ids!==undefined?{selection:ids}:{})})).result,state.plan)}catch(error){return {type:'blocked' as const,issues:[error instanceof Error?error.message:'後端來源未確認，請重新讀取。']}}
  if(token!==sourceLoadToken.current||requested!==JSON.stringify(createAnalysisRequest(exportLive.current.state)))return {type:'blocked' as const,issues:['操作期間分析條件已改變或面板已關閉，請重新套用來源。']};
  if(result.type!=='ready')return result;
  beginNewAnalysis();stopPlayback();setState({...result.state,filter:state.filter});setTab('list');setSheet(false);
  if(kind==='saved')setAction({type:'Reset',key:Date.now()});
  notify(kind==='saved'?`已套用檢視 ${index+1}，回到可用最新日期。`:'已以所選來源股票取代目前清單；來源未改動。');return result;
 };
 const editLibrary=async(action:LibraryAction)=>{
  if(!offlineAnalysis){
   try{const saving=action.type==='save',source=action.kind==='watchlist'?{...analysisDefaults(state.plan,state.market),runtime:state.runtime,viewingDate:state.runtime?state.runtime.Daily.length-1:9,mode:state.mode,currentList:state.currentList}:state;
    await serverLibrary.run('edit',{action,...(saving?{analysis:createAnalysisRequest(source,'save-library')}:{})});notify('已儲存於後端資料庫，目前分析未變更。');return {ok:true,notice:'已儲存於後端資料庫。目前分析未變更。'};
   }catch(error){return {ok:false,notice:error instanceof Error?error.message:'後端寫入結果未確認，請重新讀取核對。'}}
  }
  if(!boot.library.writable)return {ok:false,notice:boot.library.notice};
  const result=editLocalLibrary(library,state,retained,action);if(!result.ok)return result;
  const committed=commitLocalLibrary(storage,libraryRaw,result.library);if(!committed.ok)return committed;
  setBrowserLibrary(result.library);setLibraryRaw(committed.raw);return {ok:true,notice:'已儲存於此瀏覽器。目前分析未變更。'};
 };
 const chooseSlot=async(kind:SourceKind,index:number)=>{if(offlineAnalysis){setBrowserRetained(previous=>({...previous,[kind]:index}));return {ok:true,notice:'已選定可用格。'}}try{await serverLibrary.run('choose',{kind,index});return {ok:true,notice:'已由後端記住本段 Free 可用格。'}}catch(error){return {ok:false,notice:error instanceof Error?error.message:'選定格結果未確認，請重新讀取。'}}};
 const refreshAfterBackup=(keys:string[])=>{
  stopPlayback();
  if(keys.includes(localKeys.library)){const next=readLocalLibrary(storage);setBrowserLibrary(next.library);setLibraryRaw(next.raw);setBoot(previous=>({...previous,library:next}))}
  if(keys.includes(localKeys.frequency))preferences.current=readFrequencyPreferences(storage);
  const ui=readUiPreferences(storage);
  if(keys.includes(localKeys.ui)){setTheme(ui.theme);setListPreferences(readListPreferences(storage));setSidebar(readSidebarPreferences(storage))}
  if(keys.includes(localKeys.workspace)){
   const restored=readWorkspace(storage,state.plan,state.runtime);setState({...restored.state||analysisDefaults(state.plan,readWorkspaceMarket(storage)||state.market),filter:ui.filter});setLocalNotice(restored.notice);setPersistReady(!restored.notice);setTab('list');setSheet(false);setAction({type:'Reset',key:Date.now()});
  }else if(keys.includes(localKeys.ui))setState(previous=>({...previous,filter:ui.filter}));
  if(keys.includes(localKeys.benchmarks))setDataRevision(value=>value+1);
 };
 const exportFile=async(format:ExportFormat)=>{
  if(exporting||loading||!analysis.ready||partialPlayback)return;
  try{
   const data=analysis.delivery!.data,token=exportGeneration.current,context={...createExportContext(state,format,data),...(format==='PNG'?{hiddenIds:[...hiddenIds]}:{})},signature=exportSignature(state,format,theme,hiddenIds);
   stopPlayback();setExporting(true);
   if(!offlineAnalysis){if(!data.version)throw Error('分析尚未取得版本資訊，請重試連線。');await verifyInputVersion(data.version.input);if(auth)await verifyExportAccess(state,format)}
   let blob:Blob,filename:string;
   if(format==='CSV'){const csv=buildCsvExport(context.state,data);blob=new Blob([csv.text],{type:'text/csv;charset=utf-8'});filename=csv.filename}
   else{if(!chartExport.current)throw Error('圖表尚未準備好。');const image=buildPngSvg(context,theme,chartExport.current.snapshot());blob=await svgToPng(image.svg,image.width,image.height);filename=context.filenameBase+'.png'}
   if(!offlineAnalysis){await verifyInputVersion(data.version!.input);if(auth)await verifyExportAccess(state,format)}
   if(token!==exportGeneration.current||!analysisLive.current.ready||analysisLive.current.delivery?.data!==data||signature!==exportSignature(exportLive.current.state,format,exportLive.current.theme,exportLive.current.hiddenIds))throw Error('產生檔案期間設定或版本已變更，請依目前畫面重新匯出。');
   createExportContext(exportLive.current.state,format,data);downloadBlob(blob,filename);notify(`已送出 ${format} 下載；${data.source==='computed'?(data.version?.dataset_kind==='test'?'依合成價格運算，非真實台股行情。':'依匯入價格運算，來源品質尚待核對。'):'檔案為 DEMO 示範資料。'}`);
  }catch(error){if(error instanceof AnalysisError&&error.code==='INPUT_VERSION_CHANGED'){exportGeneration.current++;context.refresh();analysis.retry()}notify(error instanceof Error?error.message:'匯出失敗，請稍後再試。')}
  finally{setExporting(false)}
 };
 const showLoading=()=>{setLoading(true);setDemoMenu(false);if(loadingTimer.current)clearTimeout(loadingTimer.current);loadingTimer.current=setTimeout(()=>setLoading(false),2200)};
 // Latest is fetched once if needed; playback then reveals the delivered Trail locally.
 useEffect(()=>{if(!preparingPlayback)return;if(blocked||analysis.error||state.plan!=='Pro'){stopPlayback();return}if(!analysis.ready)return;if(state.viewingDate!==stateDates(state).length-1)return;if(!playbackSteps){stopPlayback();notify('最新日期沒有可播放的有效軌跡。');return}setPreparingPlayback(false);setPlaybackFrame(1);playbackTick.current=performance.now();setPlaying(true)},[preparingPlayback,analysis.ready,analysis.error,blocked,state.plan,state.viewingDate,playbackSteps,stopPlayback]);
 useEffect(()=>{if(!playing)return;if(blocked||analysis.error||state.plan!=='Pro'){stopPlayback();return}if(!analysis.ready||playbackFrame===null)return;if(playbackFrame>=playbackSteps){setPlaying(false);return}const timer=setTimeout(()=>{playbackTick.current=performance.now();setPlaybackFrame(frame=>frame===null?null:Math.min(frame+1,playbackSteps))},Math.max(0,1100/speed-(performance.now()-playbackTick.current)));return()=>clearTimeout(timer)},[playing,speed,playbackFrame,playbackSteps,analysis.ready,analysis.error,blocked,state.plan,stopPlayback]);
 const playTrail=()=>{if(state.plan!=='Pro'||blocked||!analysis.ready)return;if(playing){setPlaying(false);return}if(playbackFrame!==null&&playbackFrame<playbackSteps){playbackTick.current=performance.now();setPlaying(true);return}const latest=stateDates(state).length-1;if(state.viewingDate!==latest){stopPlayback();setPreparingPlayback(true);setState(previous=>({...previous,viewingDate:latest}));return}if(!playbackSteps){notify('最新日期沒有可播放的有效軌跡。');return}setPlaybackFrame(1);playbackTick.current=performance.now();setPlaying(true)};
 useEffect(()=>()=>{exportGeneration.current++;sourceLoadToken.current++;if(toastTimer.current)clearTimeout(toastTimer.current);if(loadingTimer.current)clearTimeout(loadingTimer.current)},[]);
 useEffect(()=>{const close=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!e.defaultPrevented&&!document.querySelector('dialog[open]')){if(sheet)closeSheet();setDemoMenu(false)}};document.addEventListener('keydown',close);return()=>document.removeEventListener('keydown',close)},[closeSheet,sheet]);
 const live=useRef({state,add});live.current={state,add};
 useEffect(()=>{const context=(document as any).modelContext;if(!context?.registerTool)return;const lifecycle=new AbortController();const tools=[{name:'read_twstockrs_demo_state',description:'Read the currently visible TWStockRS mock analysis settings and selected stock list. No real market data.',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute:()=>({...live.current.state})},{name:'add_demo_stocks',description:'Add stock IDs to the visible mock Current List, respecting the current plan capacity. Reject unknown or other-market IDs, never fabricate real data.',inputSchema:{type:'object',properties:{ids:{type:'array',items:{type:'string'},minItems:1,maxItems:100}},required:['ids'],additionalProperties:false},annotations:{readOnlyHint:false},execute:(input:any)=>{if(!input||!Array.isArray(input.ids)||!input.ids.length||input.ids.length>100||input.ids.some((id:any)=>typeof id!=='string'||! /^(\d{4,6}|DEMO[1-4])$/.test(id)))throw Error('Expected 1–100 valid mock stock IDs.');let added:string[]=[];flushSync(()=>{added=live.current.add(input.ids)});return{added,count:live.current.state.currentList.length}}}];tools.forEach(t=>{try{Promise.resolve(context.registerTool(t,{signal:lifecycle.signal})).catch(()=>{})}catch{}});return()=>lifecycle.abort()},[]);
 return <div className="app-shell" data-theme={theme}><TopNav theme={theme} onTheme={()=>setTheme(t=>t==='dark'?'light':'dark')} state={state} onPlan={switchPlan} onAccount={()=>setDrawer('account')} onMode={m=>{if(!contextReady)return;if(m===state.mode){clearSelection();return}const next=updateAnalysis(state,'mode',m);if(analysisIssues(next).length){notify('請先調整為目前方案可用的分析條件。');return}beginNewAnalysis();stopPlayback();setState(next);setTab('list');setSheet(false)}}/>
 <main><div className="workspace-heading"><div><h1>{state.mode==='Stock Move'?'個股相對強弱輪動':'產業相對強弱輪動'}</h1></div><div className="heading-actions">{!offlineAnalysis&&auth?.session?.account?.role==='admin'&&<button onClick={()=>setDrawer('admin')}>管理員維護</button>}{!offlineAnalysis&&<button onClick={()=>setSharing({id:!blocked&&analysis.ready&&!partialPlayback&&!playing?analysis.requestId||'':'',key:analysis.delivery?.key||'',count:entities.length})}>凍結分享</button>}<ExportControls blocked={blocked||!analysis.ready||partialPlayback} empty={!entities.length} plan={state.plan} onOpen={setDrawer} busy={exporting||loading||analysis.pending} onExport={exportFile} onHelp={()=>setHelpTopic('csv')}/></div></div>
 {localNotice&&<div className="local-notice" role="status"><span>{localNotice}{localNotice.startsWith('上次本機設定未載入')&&' 切換至支援方案後可重試還原，或修改分析條件開始新分析。'}</span>{localNotice.startsWith('上次本機設定未載入')?<button onClick={restoreLocal}>重試還原本機設定</button>:<button onClick={()=>setLocalNotice('')}>知道了</button>}</div>}
 {blocked&&contextReady&&<div className="analysis-restriction" role="status"><div><strong>目前設定不符 {state.plan} 方案</strong><p>{issues.join('；')}。保留先前已載入畫面；新分析與匯出暫停，清單可移除股票。</p></div><button onClick={resetConditions}>重設條件（保留清單）</button></div>}
 {(analysis.error||context.error)&&<div className="analysis-restriction" role="alert"><div><strong>本次分析尚未取得結果</strong><p>{analysis.error||context.error} 不會改用內建資料，分析條件與本機清單仍保留。</p></div><button onClick={()=>{context.refresh();analysis.retry()}}>{analysis.errorCode==='JOB_CANCELLED'?'重新運算':analysis.errorCode?.startsWith('QUEUE_')||analysis.errorCode==='JOB_TIMEOUT'?'重試運算':'重試連線'}</button></div>}
 <AnalysisControls key={dataRevision} disabled={blocked||!contextReady} state={state} update={(key,value)=>{stopPlayback();update(key,value);if(key==='market'){setTab('list');setSheet(false);notify('已切換市場並清空目前清單，請依新市場重新選股。')}}}/>
 <div className="demo-strip"><span className="demo-badge">{state.runtime?state.runtime.dataset_kind==='test'?'TEST':'INPUT':'DEMO'}</span>{state.runtime?state.runtime.dataset_kind==='test'?'合成價格運算 · rs_v1；不代表真實台股行情。':'匯入價格運算 · rs_v1；來源品質尚待核對。':'Mock / Demo data · 所有座標均為示範資料，不代表真實市場 RS。'}<span className="strip-right">基準 {benchmarkLabel(displayState.benchmarkType,displayState.market,displayState.benchmark,displayState.runtime)} <span>／</span> 中心 (0, 0)</span></div>
 <div className={`workspace ${sidebar.collapsed?'sidebar-collapsed':''}`}><section className="chart-section"><div className="chart-header"><div className="chart-summary"><h2>RS Rotation <span>相對強弱輪動圖</span></h2><p>{chartEntities.length!==entities.length?`${chartEntities.length} / ${entities.length} 個顯示`:`${entities.length} 個標的`} <span>·</span> {displayState.frequency} <span>·</span> {displayState.period} <span>·</span> {displayState.priceType}</p></div><div className="chart-actions"><ChartToolbar state={state} update={update} onViewport={type=>setAction({type,key:Date.now()})}/>
 <PlaybackControls playing={playing} speed={speed} locked={state.plan!=='Pro'} disabled={blocked||preparingPlayback||(!playing&&!analysis.ready)} progress={preparingPlayback?'準備最新軌跡…':playbackFrame===null?`Trail ${state.trail} 點`:`${playbackFrame} / ${playbackSteps} 點`} onPlay={playTrail} onSpeed={value=>{if(state.plan==='Pro'&&!blocked)setSpeed(value)}}/></div></div>
 <div className="chart-stage"><div className="quadrant-label improving">IMPROVING <span>改善</span></div><div className="quadrant-label leading">LEADING <span>領先</span></div><div className="quadrant-label lagging">LAGGING <span>落後</span></div><div className="quadrant-label weakening">WEAKENING <span>轉弱</span></div><RSChart pointPriceDates={priceDates} sourceLabel={sourceLabel} exportRef={chartExport} theme={theme} entities={chartEntities} paths={playbackPaths} fitPaths={playbackFrame===null?undefined:paths} colorQuadrants={playbackColors} pointDates={pointDates} markers={5} quadrants={colors} selectedId={state.selectedEntity} hoveredId={state.hoveredId} filter={state.filter} viewingDate={dates[displayState.viewingDate]} onSelect={select} onClearSelection={clearSelection} onHover={id=>update('hoveredId',id)} viewportAction={action}/>
 {!entities.length&&<div className="chart-empty"><BrandMark theme={theme}/><h3>尚未選取股票</h3><p>從產業選單、輸入股票代號或 Watchlist 加入股票。</p><button onClick={focusStockInput}><Plus size={14}/>加入股票</button><button onClick={addDefaults} disabled={!contextReady||blocked}>加入預設股票</button></div>}
 {!!entities.length&&!analysis.pending&&!analysis.error&&!chartEntities.some(entity=>lastPoint(paths[entity.id]||[])&&(state.filter==='All'||quadrant(lastPoint(paths[entity.id])!)===state.filter))&&<div className="chart-empty compact"><h3>{!chartEntities.length?'所有標的已隱藏':'目前沒有可顯示的路徑'}</h3>{!chartEntities.length?<><p>點清單中標的前的眼睛圖標，即可恢復路徑。</p><button onClick={showAllEntities}>全部顯示</button></>:<><p>{state.filter==='All'?'標的缺少有效結果，請查看 Detail。':'此象限沒有符合標的；Current List 保持不變。'}</p>{state.filter!=='All'&&<button onClick={()=>update('filter','All')}>顯示所有象限</button>}</>}</div>}
 {analysis.error&&<div className="chart-empty compact"><h3>{analysis.errorCode==='JOB_CANCELLED'?'已取消本次運算':'尚未取得分析結果'}</h3><p>{analysis.errorCode==='JOB_CANCELLED'?'分析條件與清單已保留，可調整條件或按上方「重新運算」。':analysis.errorCode?.startsWith('QUEUE_')||analysis.errorCode==='JOB_TIMEOUT'?'目前運算尚未完成，可按上方「重試運算」。':'確認本機服務啟動後，按上方「重試連線」。'}</p></div>}
 {(loading||analysis.pending||preparingPlayback)&&<div className="chart-loading" role="status"><div className="skeleton"/><div className="skeleton"/><div className="skeleton"/><span>{analysis.pending?(analysis.progress||'正在取得分析結果…'):'正在載入圖表…'}</span>{analysis.pending&&!playing&&<button onClick={analysis.cancel}>取消運算</button>}</div>}</div>
 <div className="chart-footer"><span>滑鼠滾輪縮放 <b>·</b> 游標拖曳移動 <b>·</b> 點選路徑查看明細 <b>·</b> 點擊空白處取消選取</span><span title="這段期間沒有可顯示的結果，虛線只用來連接前後的位置。">┄ 虛線 = 資料缺口</span></div><div className="legend">{Object.keys(colors).map(q=><span key={q}><i style={{background:`var(--quadrant-${q.toLowerCase()}, ${colors[q]})`}}/>{q}<small>{translations[q]}</small></span>)}</div></section>
 {sheet&&<button className="sheet-backdrop" aria-label="收合底部面板" onClick={closeSheet}/>}
 <aside id="workspace-sidebar" className={`side-panel ${sheet?'sheet-open':''}`} aria-label={state.mode==='Stock Move'?'股票清單與明細':'產業清單與明細'}><button ref={sheetHandle} className="sheet-handle" aria-label={sheet?'收合清單':'展開清單'} onClick={()=>sheet?closeSheet():setSheet(true)}><i/></button><div className="panel-tabs"><button className={tab==='list'?'active':''} onClick={()=>{setTab('list');setSheet(true)}}>{state.mode==='Stock Move'?'Current List':'Sectors'}</button><button className={tab==='detail'?'active':''} onClick={()=>{setTab('detail');setSheet(true)}}>Detail</button><span>{entities.length}{state.mode==='Stock Move'?` / ${capacity[state.plan]}`:' 個產業'}</span><SidebarToggle collapsed={false} buttonRef={sidebarCloseButton} onToggle={()=>toggleSidebar(true)}/><button className="mobile-close" aria-label="收合" onClick={closeSheet}><ChevronDown size={18}/></button></div>
 {loading?<LoadingPanel/>:tab==='list'?<CurrentList onAddDefaults={addDefaults} defaultsDisabled={!contextReady||blocked} inputRef={stockInputRef} hiddenIds={hiddenIds} onToggleVisibility={toggleVisibility} display={listPreferences[state.mode==='Stock Move'?'stock':'sector']} onDisplayChange={changeListDisplay} entities={entities} paths={paths} state={{...displayState,currentList:state.currentList,plan:state.plan,selectedEntity:state.selectedEntity}} onSelect={select} onRemove={remove} onAdd={add} onClear={()=>{beginNewAnalysis();setState(s=>({...s,currentList:[],selectedEntity:null}));notify('已清空清單，可重新加入股票或還原示範。')}}/>:<DetailPanel readOnly={blocked||!analysis.ready||!!state.runtime} entity={selected} points={selected?paths[selected.id]:[]} state={displayState} pointDates={selected?pointDates[selected.id]:[]} onBack={()=>setTab('list')} onStatus={status=>!blocked&&analysis.ready&&selected&&setState(s=>({...s,statusOverrides:{...s.statusOverrides,[selected.id]:status}}))}/>}
 <div className="panel-note" data-analysis-source={offlineAnalysis?'offline':'api'} data-analysis-status={blocked?'blocked':analysis.ready?'ready':analysis.error?'error':'loading'} title={analysis.requestId?`請求 ${analysis.requestId} · 結果 ${analysis.delivery?.data.version?.result_release_id||'mock-2026-09-v1'} · 輸入 ${analysis.delivery?.data.version?.input.release_id||'尚未啟用'} · 修訂 ${analysis.delivery?.data.version?.input.revision||1}`:undefined}>{offlineAnalysis?'OFFLINE DEMO':state.runtime?'LOCAL RS · rs_v1':'LOCAL API DEMO'}<span>{offlineAnalysis?'內建示範資料':context.error?'市場版本尚未讀取':blocked?'保留已載入結果':analysis.ready?'本機後端已連線':analysis.error?analysis.errorCode==='JOB_CANCELLED'?'運算已取消':analysis.errorCode?.startsWith('QUEUE_')||analysis.errorCode==='JOB_TIMEOUT'?'等候重試運算':'後端尚未連線':'取得分析結果中'}</span></div></aside><div className="sidebar-rail"><SidebarToggle collapsed buttonRef={sidebarOpenButton} onToggle={()=>toggleSidebar(false)}/></div></div>
 <footer className="app-footer"><span className="footer-brand"><BrandWordmark theme={theme}/><b>／</b> Taiwan Stock Relative Strength & Rotation</span><nav className="help-links" aria-label="使用與資料說明"><button onClick={()=>setHelpTopic('usage')}>使用說明</button><button onClick={()=>setHelpTopic('data')}>資料說明</button></nav><div className="demo-controls"><button disabled={!!state.runtime} title={state.runtime?"價格運算不使用模擬狀態覆寫":undefined} aria-expanded={demoMenu} onClick={()=>setDemoMenu(!demoMenu)}><FlaskConical size={13}/>狀態展示</button>{demoMenu&&<div className="demo-menu"><button onClick={showLoading}>Loading · 載入狀態</button><button onClick={()=>{beginNewAnalysis();setState(s=>({...s,mode:'Stock Move',currentList:[],selectedEntity:null}));setDemoMenu(false)}}>Empty · 空清單</button><button onClick={()=>{beginNewAnalysis();setState(s=>({...s,mode:'Stock Move',plan:offlineAnalysis?'Free':s.plan,market:'TWSE',benchmarkType:'market',benchmark:'TAIEX',frequency:'Daily',period:!offlineAnalysis&&s.plan==='Anonymous'?'20D':'60D',trail:!offlineAnalysis&&s.plan==='Anonymous'?5:20,priceType:'Adjusted',viewingDate:9,currentList:['2330','DEMO1','DEMO2','DEMO3','DEMO4'],selectedEntity:null}));setTab('list');setSheet(true);setDemoMenu(false)}}>全部資料狀態</button><button onClick={()=>{restore();setDemoMenu(false)}}><RotateCcw size={13}/>還原示範</button></div>}<span>Frontend Foundation 0</span></div></footer></main>
 <Suspense fallback={null}>{drawer&&<Drawer key={drawer} kind={drawer} state={state} retained={retained} library={library} libraryNotice={offlineAnalysis?boot.library.notice:serverLibrary.notice||(!serverLibrary.ready?'正在讀取後端清單，暫停管理與套用。':'')} libraryWritable={offlineAnalysis?boot.library.writable:serverLibrary.ready} storage={storage} serverLibrary={offlineAnalysis?undefined:serverLibrary} browserRetained={browserRetained} onDataVersionChanged={versionChanged} onBackupRestored={refreshAfterBackup} onEdit={editLibrary} onChoose={chooseSlot} onClose={()=>{sourceLoadToken.current++;setDrawer('')}} onRestore={(index,ids)=>loadSource('saved',index,ids)} onLoadList={(index,ids)=>loadSource('watchlist',index,ids)}/>}</Suspense>
 {sharing&&<ShareDialog plan={state.plan} deliveryId={sharing.id} requestKey={sharing.key} count={sharing.count} onClose={()=>setSharing(null)}/>}
 {helpTopic&&<HelpDialog initialTopic={helpTopic} onClose={()=>setHelpTopic(null)}/>}
 {toast&&<div className="toast" role="status">{toast}<button aria-label="關閉提示" onClick={()=>setToast('')}>×</button></div>}</div>
}
