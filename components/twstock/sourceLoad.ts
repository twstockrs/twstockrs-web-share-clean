import {AnalysisState,Entity,stateDates,analysisIssues,capacity,catalog,demoSavedView,demoWatchlists,slotAccessible,updateAnalysis,type RuntimeData,type Plan} from './model';

export type SourceKind='watchlist'|'saved';
export type SourceLoadResult=
 | {type:'blocked';issues:string[]}
 | {type:'choose';title:string;ids:string[];entities:Entity[];limit:number}
 | {type:'ready';state:AnalysisState};
type Retained={watchlist:number|null;saved:number|null};
export type SourceLibrary={watchlists:readonly {name:string;market:string;ids:readonly string[]}[];savedView:(index:number)=>AnalysisState|null;entities:readonly Entity[];runtimeFor?:(market:string,plan:Plan)=>RuntimeData|undefined};
const demoLibrary:SourceLibrary={watchlists:demoWatchlists,savedView:demoSavedView,entities:catalog};

// Both opening and confirming a picker revalidate the original source and current permissions.
// The app supplies its browser-local library; checks can supply synthetic fixtures.
export function prepareSourceLoad(kind:SourceKind,index:number,state:AnalysisState,retained:Retained,selection?:readonly string[],library:SourceLibrary=demoLibrary):SourceLoadResult {
 const reject=(...issues:string[]):SourceLoadResult=>({type:'blocked',issues});
 if(!slotAccessible(state.plan,index,kind,retained[kind]))return reject('此儲存格目前鎖定，無法載入');
 let candidate:AnalysisState,title:string;
 if(kind==='watchlist'){
  const source=library.watchlists[index];
  if(!source)return reject('找不到來源清單');
  title=source.name;
  candidate={...(source.market===state.market?state:updateAnalysis(state,'market',source.market)),market:source.market,mode:'Stock Move',currentList:[...source.ids]};
 }else{
  const source=library.savedView(index);if(!source)return reject('此檢視尚未儲存設定');
  candidate={...source,plan:state.plan};
  title=`檢視 ${index+1}`;
  candidate.runtime=library.runtimeFor?.(candidate.market,state.plan)||candidate.runtime;
  candidate.viewingDate=stateDates(candidate).length-1;
  // Sector views resolve all industries, never an old saved stock or industry subset.
  if(candidate.mode==='Sector Move')candidate.currentList=[];
 }
 candidate={...candidate,runtime:library.runtimeFor?.(candidate.market,state.plan)||candidate.runtime,currentList:[...new Set(candidate.currentList)],selectedEntity:null,hoveredId:null,filter:state.filter,statusOverrides:{}};
 if(kind==='watchlist'&&candidate.market!==state.market){const originalDate=stateDates(state)[state.viewingDate],mapped=stateDates(candidate).indexOf(originalDate);if(mapped<0)return reject('來源市場沒有目前的檢視日期，請先切換市場並選擇可用日期。');candidate.viewingDate=mapped}
 const sourceEntities=candidate.runtime?.catalog||library.entities;
 const errors=analysisIssues({...candidate,currentList:[]},sourceEntities);
 if(candidate.currentList.some(id=>sourceEntities.find(entity=>entity.id===id)?.market!==candidate.market))errors.push('來源含未知或不符來源市場的股票，請先修正來源清單');
 if(candidate.runtime&&candidate.currentList.some(id=>!candidate.runtime!.market_periods?.some(p=>p.security_id===id&&p.valid_from<=stateDates(candidate)[candidate.viewingDate]&&stateDates(candidate)[candidate.viewingDate]<p.valid_to)))errors.push('來源股票在目前檢視日期不屬於來源市場，請先修正來源清單');
 if(errors.length)return {type:'blocked',issues:errors};
 const ids=candidate.currentList,limit=capacity[state.plan];
 if(selection!==undefined){
  if(candidate.mode!=='Stock Move')return reject('產業檢視會載入全部有效產業，不能挑選子集');
  if(selection.length!==new Set(selection).size||selection.some(id=>!ids.includes(id)))return reject('所選股票重複或不在來源內，請重新選擇');
  if(selection.length>limit)return reject(`最多可載入 ${limit} 檔，請減少勾選`);
  // Source order is stable; selection is the complete replacement, including an explicit empty list.
  candidate.currentList=ids.filter(id=>selection.includes(id));
 }else if(candidate.mode==='Stock Move'&&ids.length>limit){
  return {type:'choose',title,ids,entities:ids.map(id=>sourceEntities.find(entity=>entity.id===id)!),limit};
 }
 const finalErrors=analysisIssues(candidate,sourceEntities);
 return finalErrors.length?{type:'blocked',issues:finalErrors}:{type:'ready',state:candidate};
}
