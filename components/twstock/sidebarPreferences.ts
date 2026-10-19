import type {LocalStorageLike} from './localWorkspace';
import {storageKeys} from './storageKeys';

export type SidebarPreferences={collapsed:boolean};
export const defaultSidebarPreferences=():SidebarPreferences=>({collapsed:false});
export function parseSidebarPreferences(value:unknown):SidebarPreferences{
 if(typeof value!=='object'||value===null||Array.isArray(value)||!('collapsed' in value)||typeof value.collapsed!=='boolean')throw Error('側欄顯示偏好格式不符');
 return {collapsed:value.collapsed};
}
export function readSidebarPreferences(storage:LocalStorageLike|null):SidebarPreferences{
 try{const raw=storage?.getItem(storageKeys.ui);if(raw)return parseSidebarPreferences(JSON.parse(raw).sidebar)}catch{}
 return defaultSidebarPreferences();
}
