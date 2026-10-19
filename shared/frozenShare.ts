import {AnalysisError,validateAnalysisRequest,decodeAnalysisResponse,type AnalysisRequest,type AnalysisResponse} from './mockAnalysis';
import {decodeRuntimeData} from './rsContract';
import {benchmarkLabel,type RuntimeData} from '../components/twstock/model';

export type FrozenSnapshot={format:'TWStockRS-frozen-share';version:1;id:string;created_at:string;benchmark_label:string;request:AnalysisRequest;runtime:RuntimeData|null;response:AnalysisResponse};
export type FrozenEnvelope={snapshot:FrozenSnapshot;sha256:string};
export const shareTokenPattern=/^[A-Za-z0-9_-]{43}$/;
export function decodeFrozenSnapshot(value:unknown){
 const v=value as FrozenSnapshot;
 const invalid=():never=>{throw new AnalysisError('INVALID_SHARE','凍結快照不完整或格式不支援，未載入替代結果。',502)};
 if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!=='benchmark_label,created_at,format,id,request,response,runtime,version'||v.format!=='TWStockRS-frozen-share'||v.version!==1||typeof v.id!=='string'||!/^share-[a-f0-9-]{36}$/.test(v.id)||typeof v.created_at!=='string'||!Number.isFinite(Date.parse(v.created_at))||typeof v.benchmark_label!=='string'||!v.benchmark_label.length||v.benchmark_label.length>500||!v.request)return invalid();
 const runtime=v.runtime===null?undefined:decodeRuntimeData(v.runtime,v.request.market);
 const {state}=validateAnalysisRequest(v.request,runtime),{data}=decodeAnalysisResponse(v.response,v.request,runtime);
 if(v.benchmark_label!==benchmarkLabel(state.benchmarkType,state.market,state.benchmark,runtime))return invalid();
 return {snapshot:v,state,data};
}
export async function decodeFrozenEnvelope(value:unknown){
 const v=value as FrozenEnvelope;
 if(!v||typeof v!=='object'||Object.keys(v).sort().join(',')!=='sha256,snapshot'||typeof v.sha256!=='string'||!/^[a-f0-9]{64}$/.test(v.sha256))throw Error('分享校驗資訊不完整。');
 const bytes=new TextEncoder().encode(JSON.stringify(v.snapshot)),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
 if(digest!==v.sha256)throw Error('分享內容校驗不符，未顯示結果。');
 return {...decodeFrozenSnapshot(v.snapshot),sha256:v.sha256};
}
