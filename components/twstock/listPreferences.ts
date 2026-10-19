import {lastPoint,quadrant,type Entity,type Point} from './model';
import type {LocalStorageLike} from './localWorkspace';
import {storageKeys} from './storageKeys';

export const listSortOptions={source:'原始順序',code:'代號',name:'名稱',level:'RS Level · 相對強弱',momentum:'RS Momentum · 相對動能',quadrant:'象限'};
export const listColumnOptions={market:'市場',sector:'產業',level:'RS Level · 相對強弱',momentum:'RS Momentum · 相對動能',quadrant:'象限'};
export type ListSort=keyof typeof listSortOptions;
export type ListColumns=Record<keyof typeof listColumnOptions,boolean>;
export type ListDisplay={sort:ListSort;direction:'asc'|'desc';columns:ListColumns};
export type ListPreferences={version:1;stock:ListDisplay;sector:ListDisplay};
export function defaultListDisplay():ListDisplay{return {sort:'source',direction:'asc',columns:{market:true,sector:true,level:true,momentum:false,quadrant:true}}}
export function defaultListPreferences():ListPreferences{return {version:1,stock:defaultListDisplay(),sector:defaultListDisplay()}}
const record=(value:unknown):value is Record<string,unknown>=>typeof value==='object'&&value!==null&&!Array.isArray(value);
// Whitelist display fields only. A preference can never introduce stocks or analysis settings.
export function parseListPreferences(value:unknown):ListPreferences{
 if(!record(value)||value.version!==1)throw Error('清單顯示偏好版本不符');
 const parse=(value:unknown):ListDisplay=>{
  if(!record(value)||typeof value.sort!=='string'||!Object.hasOwn(listSortOptions,value.sort)||!['asc','desc'].includes(String(value.direction))||!record(value.columns))throw Error('清單排序格式不符');
  const columns=value.columns;
  if(Object.keys(listColumnOptions).some(key=>typeof columns[key]!=='boolean'))throw Error('清單欄位格式不符');
  return {sort:value.sort as ListSort,direction:value.direction as ListDisplay['direction'],columns:Object.fromEntries(Object.keys(listColumnOptions).map(key=>[key,columns[key]])) as ListColumns};
 };
 return {version:1,stock:parse(value.stock),sector:parse(value.sector)};
}
export function readListPreferences(storage:LocalStorageLike|null):ListPreferences{
 try{const raw=storage?.getItem(storageKeys.ui);if(raw)return parseListPreferences(JSON.parse(raw).list)}catch{}
 return defaultListPreferences();
}
export function sortListEntities(entities:Entity[],paths:Record<string,(Point|null)[]>,display:ListDisplay):Entity[]{
 if(display.sort==='source')return [...entities];
 const names=new Intl.Collator('zh-Hant'),quadrants=['Leading','Weakening','Lagging','Improving'];
 const value=(entity:Entity):string|number|null=>{
  if(display.sort==='code')return entity.code||entity.id;
  if(display.sort==='name')return entity.name;
  if(entity.reason&&!['valid','stale'].includes(entity.status))return null;const point=lastPoint(paths[entity.id]??[]);
  if(!point||!point.every(Number.isFinite))return null;
  if(display.sort==='quadrant')return quadrants.indexOf(quadrant(point));
  return point[display.sort==='level'?0:1];
 };
 return entities.map((entity,index)=>({entity,index,value:value(entity)})).sort((a,b)=>{
  // Nulls stay last in both directions; ties retain source order, including while playing.
  if(a.value===null||b.value===null)return a.value===b.value?a.index-b.index:a.value===null?1:-1;
  const difference=typeof a.value==='number'&&typeof b.value==='number'?a.value-b.value:display.sort==='name'?names.compare(String(a.value),String(b.value)):String(a.value).localeCompare(String(b.value),'en');
  return difference*(display.direction==='desc'?-1:1)||a.index-b.index;
 }).map(item=>item.entity);
}
