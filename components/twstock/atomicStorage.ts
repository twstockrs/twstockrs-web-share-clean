import type {LocalStorageLike} from './localWorkspace';
import {storageKeys,localStoreKey} from './storageKeys';

// A single native setItem is atomic: data and its recovery record are saved together.
// Read old separate keys until the first successful write; never delete the old values.
export function createAtomicStorage(native:LocalStorageLike):LocalStorageLike{
 const keys:string[]=Object.values(storageKeys);
 const read=():Record<string,string|null>=>{
  const raw=native.getItem(localStoreKey);
  if(raw===null)return Object.fromEntries(keys.map(key=>[key,native.getItem(key)]));
  const root:unknown=JSON.parse(raw);
  if(typeof root!=='object'||root===null||Array.isArray(root)||!('version' in root)||root.version!==1||!('values' in root)||typeof root.values!=='object'||root.values===null||Array.isArray(root.values))throw Error('本機儲存容器格式不符，原資料保留。');
  const values=root.values as Record<string,unknown>;
  if(keys.some(key=>!Object.hasOwn(values,key)||values[key]!==null&&typeof values[key]!=='string'))throw Error('本機儲存容器缺少資料，原資料保留。');
  return Object.fromEntries(keys.map(key=>[key,values[key] as string|null]));
 };
 const setMany=(updates:Record<string,string|null>)=>{
  if(Object.entries(updates).some(([key,value])=>!keys.includes(key)||value!==null&&typeof value!=='string'))throw Error('不支援的本機資料欄位。');
  native.setItem(localStoreKey,JSON.stringify({version:1,values:{...read(),...updates}}));
 };
 return {getItem:key=>{if(!keys.includes(key))throw Error('不支援的本機資料欄位。');return read()[key]},setItem:(key,value)=>setMany({[key]:value}),setMany};
}
