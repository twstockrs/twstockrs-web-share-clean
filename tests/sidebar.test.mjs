import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import path from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const bundle=await build({stdin:{contents:`export * from './components/twstock/model';export * from './components/twstock/sidebarPreferences';export * from './components/twstock/listPreferences';export * from './components/twstock/localWorkspace';export * from './components/twstock/localBackup';export * from './components/twstock/atomicStorage';export {default as SidebarToggle} from './components/twstock/SidebarToggle';export {default as Workstation} from './components/twstock/Workstation';`,resolveDir:path.resolve('.'),loader:'tsx'},bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',external:['react','react-dom','react-dom/server','react/jsx-runtime'],logLevel:'silent'});
const compiled={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);
const m=compiled.exports,choice={watchlist:0,saved:0},noop=()=>{};
const memory=()=>({values:new Map(),writes:0,getItem(key){return this.values.get(key)??null},setItem(key,value){this.writes++;this.values.set(key,value)}});
const render=(Component,props={})=>renderToStaticMarkup(React.createElement(Component,props));

test('legacy or unavailable sidebar preferences default to open without writing during reads',()=>{
 const native=memory();native.setItem(m.localKeys.ui,JSON.stringify({theme:'light',filter:'All'}));const writes=native.writes;assert.deepEqual(m.readSidebarPreferences(native),{collapsed:false});assert.equal(native.writes,writes);assert.deepEqual(m.readSidebarPreferences(null),{collapsed:false});native.setItem(m.localKeys.ui,'bad');assert.deepEqual(m.readSidebarPreferences(native),{collapsed:false});
});
test('sidebar preferences accept only booleans and whitelist no transient selection or mobile state',()=>{
 assert.deepEqual(m.parseSidebarPreferences({collapsed:true,selectedEntity:'2330',sheet:true,plan:'Pro',zoom:8}),{collapsed:true});for(const invalid of [null,[],{},'true',{collapsed:'false'},{collapsed:1}])assert.throws(()=>m.parseSidebarPreferences(invalid));
});
test('a new atomic storage instance restores the desktop preference alongside existing UI fields',()=>{
 const native=memory(),storage=m.createAtomicStorage(native),list=m.defaultListPreferences();list.stock.sort='momentum';assert(m.saveUiPreferences(storage,'light','Improving',list,{collapsed:true}));const next=m.createAtomicStorage(native);assert.deepEqual(m.readSidebarPreferences(next),{collapsed:true});assert.deepEqual(m.readListPreferences(next),list);assert.deepEqual(m.readUiPreferences(next),{theme:'light',filter:'Improving'});assert.equal(native.writes,1);
});
test('theme or column writes without a sidebar argument preserve the saved desktop state',()=>{
 const storage=m.createAtomicStorage(memory());m.saveUiPreferences(storage,'dark','All',undefined,{collapsed:true});const list=m.defaultListPreferences();list.stock.columns.level=false;m.saveUiPreferences(storage,'light','Leading',list);assert.deepEqual(m.readSidebarPreferences(storage),{collapsed:true});assert.deepEqual(m.readListPreferences(storage),list);
});
test('denied UI writes report failure and preserve the previous sidebar state',()=>{
 const native=memory();m.saveUiPreferences(native,'dark','All',undefined,{collapsed:true});const before=native.getItem(m.localKeys.ui),denied={getItem:native.getItem.bind(native),setItem(){throw Error('quota')}};assert.equal(m.saveUiPreferences(denied,'light','All',undefined,{collapsed:false}),false);assert.equal(native.getItem(m.localKeys.ui),before);
});
test('new backups restore sidebar state atomically and undo restores the target previous state',()=>{
 const source=m.createAtomicStorage(memory());m.saveUiPreferences(source,'light','Leading',undefined,{collapsed:true});const text=m.createLocalBackup(source,'Pro',choice).text,native=memory(),target=m.createAtomicStorage(native);m.saveUiPreferences(target,'dark','All',undefined,{collapsed:false});const preview=m.previewLocalRestore(target,'Pro',choice,text),writes=native.writes;assert(preview.parts.find(part=>part.id==='ui').detail.includes('桌面側欄：收合'));assert(m.restoreLocalBackup(target,'Pro',choice,text,['ui'],preview.stamp).ok);assert.equal(native.writes,writes+1);assert.deepEqual(m.readSidebarPreferences(target),{collapsed:true});assert(m.undoLocalRestore(target,'Pro',choice).ok);assert.deepEqual(m.readSidebarPreferences(target),{collapsed:false});
});
test('older backups without sidebar fields retain the target preference when restoring UI',()=>{
 const source=m.createAtomicStorage(memory()),backup=m.createLocalBackup(source,'Free',choice).backup;delete backup.data.ui.sidebar;const text=JSON.stringify(backup),target=m.createAtomicStorage(memory());m.saveUiPreferences(target,'light','Lagging',undefined,{collapsed:true});const preview=m.previewLocalRestore(target,'Free',choice,text);assert(preview.parts.find(part=>part.id==='ui').detail.includes('舊備份未含側欄偏好'));assert(m.restoreLocalBackup(target,'Free',choice,text,['ui'],preview.stamp).ok);assert.deepEqual(m.readSidebarPreferences(target),{collapsed:true});assert.deepEqual(m.readUiPreferences(target),{theme:'dark',filter:'All'});
});
test('invalid sidebar values in backups are rejected before any storage write',()=>{
 const native=memory(),storage=m.createAtomicStorage(native),backup=m.createLocalBackup(storage,'Pro',choice).backup;backup.data.ui.sidebar.collapsed='yes';const writes=native.writes;assert.throws(()=>m.previewLocalRestore(storage,'Pro',choice,JSON.stringify(backup)),/側欄/);assert.equal(native.writes,writes);
});
test('sidebar buttons expose their controlled panel and current expanded state',()=>{
 const closed=render(m.SidebarToggle,{collapsed:true,onToggle:noop}),open=render(m.SidebarToggle,{collapsed:false,onToggle:noop});assert(closed.includes('aria-expanded="false"'));assert(closed.includes('展開側欄'));assert(closed.includes('>清單<'));assert(open.includes('aria-expanded="true"'));assert(open.includes('收合側欄'));for(const html of [closed,open])assert(html.includes('aria-controls="workspace-sidebar"'));
});
test('workstation restores sidebar preference without restoring a selected stock, mobile sheet or viewport',()=>{
 const native=memory(),storage=m.createAtomicStorage(native);m.saveWorkspaceSnapshot(storage,m.workspaceSnapshot({...m.analysisDefaults('Free'),selectedEntity:'2330'}));m.saveUiPreferences(storage,'dark','All',undefined,{collapsed:true});const previous=globalThis.window;globalThis.window={localStorage:native};try{const html=render(m.Workstation);assert(html.includes('workspace sidebar-collapsed'));assert(html.includes('id="workspace-sidebar"'));assert(!html.includes('side-panel sheet-open'));assert(/class="stock-row\s+has-visibility"/.test(html));assert(!m.workspaceSnapshot(m.analysisDefaults('Free')).includes('sidebar'))}finally{if(previous===undefined)delete globalThis.window;else globalThis.window=previous}
});
