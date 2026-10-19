import {AnalysisError,type AnalysisRequest} from '../shared/mockAnalysis';
import {playbackKey,type PlaybackResponse,type PlaybackEntity,type PlaybackFrame} from '../shared/playback';
import type {ComputedResponse} from '../shared/rsContract';
// Dates contain only the current plan-visible history. Coordinates are sent once.
export function compactPlayback(request:AnalysisRequest,dates:string[],compute:(date:string)=>ComputedResponse):PlaybackResponse{
 const entities=new Map<string,PlaybackEntity>(),positions=new Map<string,Map<string,number>>();let base:PlaybackResponse['base']|undefined,records=0;
 for(let i=0;i<dates.length;i++){const date=dates[i];
  const result=compute(date),{entities:rows,...meta}=result;base=meta;
  for(const row of rows){let entity=entities.get(row.id);if(!entity){entity={id:row.id,code:row.code,name:row.name,market:row.market,points:[],frames:Array(dates.length).fill(null)};entities.set(row.id,entity);positions.set(row.id,new Map())}const lookup=positions.get(row.id)!;let from=0,to=0;
   // Indexed iteration avoids allocating a two-item iterator array for every trail point.
   for(let j=0;j<row.points.length;j++){const p=row.points[j];let index=lookup.get(p.point_date);if(index===undefined){index=entity.points.length;lookup.set(p.point_date,index);entity.points.push({...p})}else if(p.gap_before!==null)entity.points[index].gap_before=p.gap_before;if(j===0)from=index;to=index+1;if(index!==from+j)throw Error('Playback points must form a contiguous range')}
   entity.frames[i]=[row.sector,row.status,row.reason,row.message,from,to,row.transition,row.industry_changes,row.initialization_limited] satisfies PlaybackFrame;
   if(++records>240000)throw new AnalysisError('PLAYBACK_TOO_LARGE','此集合的播放資料超過本機上限，請改用逐日檢視。',413);
  }
 }
 if(!base)throw new AnalysisError('DATE_OUT_OF_RANGE','沒有可播放的日期。');
 return {format:'TWStockRS-playback',version:1,request_key:playbackKey(request),dates,base,entities:[...entities.values()]};
}
