import {randomUUID} from 'node:crypto';
import {AnalysisError,validateAnalysisRequest} from '../shared/mockAnalysis';
import type {FrozenSnapshot} from '../shared/frozenShare';
import type {Plan} from '../components/twstock/model';
import type {VersionMarket} from '../shared/dataVersions';
import type {RsService} from './rsService';
// Validate new publication or explicit opening against current conditions.
// The stored snapshot is never modified or replaced by this calculation.
export function prepareShareAnalysis(original:FrozenSnapshot,plan:Plan,rs:RsService){
 const runtime=rs.runtime(original.request.market as VersionMarket,plan);
 const result=prepareShareRequest(original,plan,runtime);rs.analyze(result.analysis,'open-share-'+randomUUID());return result;
}
export function prepareShareRequest(original:FrozenSnapshot,plan:Plan,runtime:ReturnType<RsService['runtime']>){
 if(original.response.source==='computed'&&!runtime)throw new AnalysisError('NO_ACTIVE_VERSION','目前市場沒有可重新驗證的價格版本，已建立的原快照仍可查看。',409);
 const analysis={...original.request,client_request_id:'open-share-'+randomUUID(),mock_plan:plan,viewing_date:original.response.viewing_date,demo_status_overrides:runtime?{}:original.request.demo_status_overrides};
 delete analysis.input_version;if(runtime)analysis.input_version=runtime.input;
 validateAnalysisRequest(analysis,runtime);
 return {analysis,runtime:runtime||null};
}
