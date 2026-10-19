import {anonymousIds,defaultIds,capacity,stateCatalog,stateDates,type AnalysisState} from './model';

const tpexCodes=['5274','6488','5347','8069','8299'];
export function defaultStockIds(state:AnalysisState):string[]{
 const codes=state.market==='TWSE'?(state.plan==='Anonymous'?anonymousIds:defaultIds):tpexCodes;
 const date=stateDates(state)[state.viewingDate],runtime=state.runtime;
 if(runtime&&(!date||runtime.market!==state.market))return [];
 return codes.flatMap(code=>{
  const candidates=stateCatalog(state).filter(e=>e.market===state.market&&(e.code||e.id)===code&&e.searchable!==false&&(runtime?e.kind==='stock':!e.kind||e.kind==='stock')&&(!runtime||runtime.market_periods?.some(p=>p.security_id===e.id&&p.valid_from<=date&&date<p.valid_to)));
  return candidates.length===1?[candidates[0].id]:[];
 }).slice(0,capacity[state.plan]);
}
// Only the known legacy preset can be migrated; empty and custom lists keep their intent.
export function isLegacyDefaultList(state:AnalysisState):boolean{
 const codes=state.market==='TWSE'?(state.plan==='Anonymous'?anonymousIds:defaultIds):['5274'];
 return !state.runtime&&JSON.stringify(state.currentList)===JSON.stringify(codes);
}
