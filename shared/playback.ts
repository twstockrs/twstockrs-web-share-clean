import {AnalysisError,requestKey,type AnalysisRequest} from './mockAnalysis';
import {decodeComputedResponse,type ComputedResponse} from './rsContract';
import type {RuntimeData} from '../components/twstock/model';
import type {RsEntity,RsPoint} from '../server/rsEngine';
export type PlaybackFrame=[string,RsEntity['status'],string,string,number,number,RsEntity['transition'],RsEntity['industry_changes'],boolean];
export type PlaybackEntity=Pick<RsEntity,'id'|'code'|'name'|'market'>&{points:RsPoint[];frames:(PlaybackFrame|null)[]};
export type PlaybackResponse={format:'TWStockRS-playback';version:1;request_key:string;dates:string[];base:Omit<ComputedResponse,'entities'>;entities:PlaybackEntity[]};
export const playbackKey=(request:AnalysisRequest)=>requestKey({...request,viewing_date:'Latest'});
const bad=():never=>{throw new AnalysisError('INVALID_PLAYBACK','播放資料格式不正確，已停止播放；請重新取得結果。',502)};
export function decodePlayback(value:unknown,input:AnalysisRequest,runtime:RuntimeData){
 const v=value as PlaybackResponse,dates=input.frequency==='Weekly'?runtime.Weekly:runtime.Daily;
 if(!v||v.format!=='TWStockRS-playback'||v.version!==1||v.request_key!==playbackKey(input)||!Array.isArray(v.dates)||JSON.stringify(v.dates)!==JSON.stringify(dates)||!Array.isArray(v.entities)||v.entities.length>10000||!v.base||typeof v.base!=='object')return bad();
 const ids=new Set();let observations=0,frames=0;
 for(const e of v.entities){if(!e||typeof e.id!=='string'||ids.has(e.id)||!Array.isArray(e.points)||e.points.length>dates.length||!Array.isArray(e.frames)||e.frames.length!==dates.length)return bad();ids.add(e.id);observations+=e.points.length;frames+=e.frames.length;let prior='';for(const p of e.points){if(!p||!dates.includes(p.point_date)||p.point_date<=prior||!Number.isFinite(p.rs_level)||!Number.isFinite(p.rs_momentum))return bad();prior=p.point_date}for(const f of e.frames)if(f!==null&&(!Array.isArray(f)||f.length!==9||!Number.isInteger(f[4])||!Number.isInteger(f[5])||f[4]<0||f[4]>f[5]||f[5]>e.points.length||f[5]-f[4]>input.trail))return bad()}
 if(observations>240000||frames>240000)return bad();
 return {at(request:AnalysisRequest){if(playbackKey(request)!==v.request_key)return bad();const index=request.viewing_date==='Latest'?dates.length-1:dates.indexOf(request.viewing_date);if(index<0)return bad();const entities:RsEntity[]=v.entities.flatMap(e=>{const f=e.frames[index];if(!f)return [];const [sector,status,reason,message,from,to,transition,industry_changes,initialization_limited]=f,points=e.points.slice(from,to).map((p,i)=>({...p,gap_before:i===0?null:p.gap_before}));return [{id:e.id,code:e.code,name:e.name,market:e.market,sector,status,reason,message,points,requested_trail:request.trail,actual_trail:points.length,trail_complete:points.length===request.trail,transition,industry_changes,initialization_limited}]});const response={...v.base,viewing_date:dates[index],client_request_id:request.client_request_id,request_key:requestKey(request),entities};return decodeComputedResponse(response,request,requestKey(request),runtime)}};
}
