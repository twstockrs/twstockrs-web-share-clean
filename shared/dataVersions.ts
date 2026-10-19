export type VersionMarket='TWSE'|'TPEx';
export type InputVersion={market:VersionMarket;revision:number;release_id:string|null;digest:string|null;dataset_kind:'test'|'source'|null};
export type ReleaseManifest={version:1;validation_version:'price-import-v1'|'price-import-v2';market:VersionMarket;dataset_kind:'test'|'source';source:string;source_version:string;adjustment:{method:string;version:string;reference_date:string};date_from:string;date_to:string;latest_date:string;price_count:number;batches:{batch_id:string;sha256:string;date_from:string;date_to:string;price_count:number;runtime_sha256?:string}[]};
export type DataRelease=ReleaseManifest&{release_id:string;digest:string;created_at:string};
export type VersionState={version:1;market:VersionMarket;revision:number;active_id:string|null;previous_id:string|null;active:DataRelease|null;previous:DataRelease|null;can_rollback:boolean;unavailable_releases:string[];releases:DataRelease[];events:{event_id:number;revision:number;action:'create'|'activate'|'rollback';release_id:string|null;from_release:string|null;to_release:string|null;created_at:string}[]};
export const versionRecord=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function decodeInputVersion(value:unknown,market:string):InputVersion{
 if(!versionRecord(value)||value.market!==market||!['TWSE','TPEx'].includes(market)||typeof value.revision!=='number'||!Number.isSafeInteger(value.revision)||value.revision<1)throw Error('行情輸入版本回應不正確。');
 if(value.release_id===null){if(value.digest!==null||value.dataset_kind!==null)throw Error('未啟用版本的回應不正確。')}
 else if(typeof value.release_id!=='string'||!/^input-[a-f0-9-]{36}$/.test(value.release_id)||!hash(value.digest)||!['test','source'].includes(String(value.dataset_kind))||typeof value.dataset_kind!=='string')throw Error('行情輸入版本識別不正確。');
 return {market:market as VersionMarket,revision:value.revision,release_id:value.release_id as string|null,digest:value.digest as string|null,dataset_kind:value.dataset_kind as InputVersion['dataset_kind']};
}
export function decodeDataRelease(value:unknown,market:string):DataRelease{
 if(!versionRecord(value)||value.version!==1||!['price-import-v1','price-import-v2'].includes(String(value.validation_version))||value.market!==market||!hash(value.digest)||typeof value.created_at!=='string'||!Number.isFinite(Date.parse(value.created_at))||typeof value.source!=='string'||typeof value.source_version!=='string'||typeof value.price_count!=='number'||!Number.isSafeInteger(value.price_count)||value.price_count<1||!Array.isArray(value.batches)||value.batches.length<1||value.batches.length>100||!versionRecord(value.adjustment)||['date_from','date_to','latest_date'].some(k=>typeof value[k]!=='string'||!/^\d{4}-\d\d-\d\d$/.test(value[k] as string))||['method','version','reference_date'].some(k=>typeof (value.adjustment as Record<string,unknown>)[k]!=='string'))throw Error('資料版本內容回應不正確。');
 decodeInputVersion({...value,revision:1},market);
 if(value.batches.some(b=>!versionRecord(b)||typeof b.batch_id!=='string'||!hash(b.sha256)||typeof b.price_count!=='number'||!Number.isSafeInteger(b.price_count)||b.price_count<0||typeof b.date_from!=='string'||typeof b.date_to!=='string'))throw Error('資料版本的批次回應不正確。');
 return value as unknown as DataRelease;
}
export function decodeVersionState(value:unknown,market:string):VersionState{
 if(!versionRecord(value)||value.version!==1||value.market!==market||typeof value.revision!=='number'||!Number.isSafeInteger(value.revision)||value.revision<1||typeof value.can_rollback!=='boolean'||!Array.isArray(value.releases)||value.releases.length>100||!Array.isArray(value.events)||value.events.length>100)throw Error('版本管理回應不正確。');
 if(['active_id','previous_id'].some(k=>value[k]!==null&&typeof value[k]!=='string')||!Array.isArray(value.unavailable_releases)||value.unavailable_releases.some(id=>typeof id!=='string'))throw Error('版本可用狀態不正確。');
 const active=value.active===null?null:decodeDataRelease(value.active,market),previous=value.previous===null?null:decodeDataRelease(value.previous,market),releases=value.releases.map(r=>decodeDataRelease(r,market));
 if(active&&active.release_id!==value.active_id||previous&&previous.release_id!==value.previous_id||!active&&value.active_id!==null&&!value.unavailable_releases.includes(value.active_id)||!previous&&value.previous_id!==null&&!value.unavailable_releases.includes(value.previous_id))throw Error('版本指標與內容不一致。');
 if(value.events.some(e=>!versionRecord(e)||typeof e.event_id!=='number'||typeof e.revision!=='number'||!['create','activate','rollback'].includes(String(e.action))||typeof e.created_at!=='string'||['release_id','from_release','to_release'].some(k=>e[k]!==null&&typeof e[k]!=='string')))throw Error('版本操作記錄回應不正確。');
 return {version:1,market:market as VersionMarket,revision:value.revision,active_id:value.active_id as string|null,previous_id:value.previous_id as string|null,active,previous,can_rollback:value.can_rollback,unavailable_releases:value.unavailable_releases as string[],releases,events:value.events as VersionState['events']};
}
