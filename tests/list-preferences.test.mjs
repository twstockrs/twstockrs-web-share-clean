import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import path from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const bundle=await build({stdin:{contents:`export * from './components/twstock/model';export * from './components/twstock/listPreferences';export * from './components/twstock/localWorkspace';export * from './components/twstock/localBackup';export * from './components/twstock/atomicStorage';export * from './components/twstock/exportData';export * from './components/twstock/Panels';export * from './components/twstock/ListDisplaySettings';`,resolveDir:path.resolve('.'),loader:'tsx'},bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',external:['react','react-dom','react/jsx-runtime'],logLevel:'silent'});
const compiled={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);
const m=compiled.exports,noop=()=>{},choice={watchlist:0,saved:0};
const render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));
const memory=()=>({values:new Map(),getItem(key){return this.values.get(key)??null},setItem(key,value){this.values.set(key,value)}});
const entity=(id,point,name=id)=>({id,name,market:'TWSE',sector:'示範產業',status:'valid',points:point?[point]:[]});
const ids=list=>list.map(item=>item.id);
const allHidden=()=>Object.fromEntries(Object.keys(m.listColumnOptions).map(key=>[key,false]));
const preferences=()=>{const value=m.defaultListPreferences();value.stock.sort='momentum';value.stock.direction='desc';value.stock.columns.momentum=true;value.stock.columns.market=false;value.sector.sort='name';value.sector.columns.level=false;return value};

test('default display matches existing fields and each mode owns independent settings',()=>{
 const value=m.defaultListPreferences();assert.equal(value.stock.sort,'source');assert.deepEqual(value.stock.columns,{market:true,sector:true,level:true,momentum:false,quadrant:true});value.stock.columns.level=false;assert.equal(value.sector.columns.level,true);assert.equal(m.defaultListPreferences().stock.columns.level,true);
});
test('preference parsing whitelists display fields and never restores stocks or permissions',()=>{
 const value=preferences();value.plan='Pro';value.currentList=['5274'];value.stock.selectedEntity='2330';value.stock.columns.secret=true;const clean=m.parseListPreferences(value);assert.deepEqual(Object.keys(clean),['version','stock','sector']);assert(!JSON.stringify(clean).includes('secret'));assert(!JSON.stringify(clean).includes('5274'));assert.equal(clean.stock.sort,'momentum');
});
test('bad sort names, versions, direction and nonboolean columns are rejected',()=>{
 for(const change of [v=>v.version=2,v=>v.stock.sort='__proto__',v=>v.stock.direction='sideways',v=>v.sector.columns.level='false',v=>delete v.stock.columns.market,v=>v.sector=null]){const value=preferences();change(value);assert.throws(()=>m.parseListPreferences(value))}
});
test('legacy and corrupt local preferences fall back safely without a read-time write',()=>{
 const storage=memory();storage.setItem(m.localKeys.ui,JSON.stringify({theme:'light',filter:'Improving'}));const before=storage.getItem(m.localKeys.ui);assert.deepEqual(m.readListPreferences(storage),m.defaultListPreferences());assert.equal(storage.getItem(m.localKeys.ui),before);storage.setItem(m.localKeys.ui,'bad');assert.deepEqual(m.readListPreferences(storage),m.defaultListPreferences());assert.deepEqual(m.readListPreferences(null),m.defaultListPreferences());
});
test('new storage instances remember both modes and changing theme preserves list preferences',()=>{
 const native=memory(),first=m.createAtomicStorage(native),value=preferences();assert(m.saveUiPreferences(first,'dark','Leading',value));const second=m.createAtomicStorage(native);assert.deepEqual(m.readListPreferences(second),value);assert(m.saveUiPreferences(second,'light','All'));assert.deepEqual(m.readListPreferences(first),value);assert.deepEqual(m.readUiPreferences(first),{theme:'light',filter:'All'});
});
test('denied preference writes leave the saved settings unchanged',()=>{
 const storage=memory();m.saveUiPreferences(storage,'dark','All',preferences());const before=storage.getItem(m.localKeys.ui);const denied={getItem:storage.getItem.bind(storage),setItem(){throw Error('quota')}};assert.equal(m.saveUiPreferences(denied,'light','All',m.defaultListPreferences()),false);assert.equal(storage.getItem(m.localKeys.ui),before);
});
test('source order is preserved and code sorting keeps leading-zero identities intact',()=>{
 const rows=['2330','0050','1101','006208'].map(id=>entity(id,[1,1])),display=m.defaultListDisplay(),before=structuredClone(rows);assert.deepEqual(ids(m.sortListEntities(rows,{},display)),ids(rows));assert.deepEqual(ids(m.sortListEntities(rows,{}, {...display,sort:'code'})),['0050','006208','1101','2330']);assert.deepEqual(rows,before);
});
test('numeric sorting uses last valid values, keeps ties stable and missing values last in both directions',()=>{
 const rows=['A','B','C','D','E'].map(id=>entity(id,null)),paths={A:[[2,9]],B:[[-1,4],null],C:[],D:[[2,-3]],E:[null]},display={...m.defaultListDisplay(),sort:'level'};const before=structuredClone(paths);assert.deepEqual(ids(m.sortListEntities(rows,paths,display)),['B','A','D','C','E']);assert.deepEqual(ids(m.sortListEntities(rows,paths,{...display,direction:'desc'})),['A','D','B','C','E']);assert.deepEqual(paths,before);
});
test('momentum is sorted by Y and nonfinite coordinates do not become ranked numbers',()=>{
 const rows=['A','B','C'].map(id=>entity(id,null)),paths={A:[[8,-2]],B:[[-9,3]],C:[[NaN,1]]};assert.deepEqual(ids(m.sortListEntities(rows,paths,{...m.defaultListDisplay(),sort:'momentum',direction:'desc'})),['B','A','C']);
});
test('quadrant sorting follows the disclosed rotation order and keeps empty rows last',()=>{
 const points={L:[1,1],W:[1,-1],G:[-1,-1],I:[-1,1]},rows=['I','G','W','L','N'].map(id=>entity(id,points[id])),paths=Object.fromEntries(rows.map(row=>[row.id,row.points])),display={...m.defaultListDisplay(),sort:'quadrant'};assert.deepEqual(ids(m.sortListEntities(rows,paths,display)),['L','W','G','I','N']);assert.deepEqual(ids(m.sortListEntities(rows,paths,{...display,direction:'desc'})),['I','G','W','L','N']);
});
test('names use Traditional Chinese ordering',()=>{
 const rows=[entity('3',null,'三'),entity('1',null,'一'),entity('2',null,'二')];assert.deepEqual(ids(m.sortListEntities(rows,{}, {...m.defaultListDisplay(),sort:'name'})),['1','2','3']);
});
test('hidden columns retain identity, selected state, removal and abnormal data warnings',()=>{
 const html=render(m.StockTag,{entity:entity('2330',[4.9,4.8],'台積電'),points:[[4.9,4.8]],status:'stale',selected:true,onSelect:noop,onRemove:noop,columns:allHidden()});assert(html.includes('2330'));assert(html.includes('台積電'));assert(html.includes('資料較舊'));assert(html.includes('aria-pressed="true"'));assert(html.includes('移除 2330'));for(const absent of ['TWSE','示範產業','4.90','4.80','Leading'])assert(!html.includes(absent));
});
test('two numeric columns have distinct labels and missing values never become zero',()=>{
 const columns={...allHidden(),level:true,momentum:true},props={entity:entity('A',null),status:'no_result',selected:false,onSelect:noop,columns};const empty=render(m.StockTag,{...props,points:[]});assert(empty.includes('相對強弱 無數值'));assert(empty.includes('相對動能 無數值'));assert(!empty.includes('0.00'));const values=render(m.StockTag,{...props,status:'valid',points:[[1.2,-3.4]]});assert(values.includes('1.20'));assert(values.includes('-3.40'));assert(values.includes('>強弱<'));assert(values.includes('>動能<'));
});
test('rendered list changes presentation order without changing the current source or CSV',()=>{
 const state=m.analysisDefaults('Pro'),before=structuredClone(state),rows=state.currentList.map(id=>m.catalog.find(row=>row.id===id)),paths=Object.fromEntries(rows.map(row=>[row.id,m.visibleSamples(row,state).map(sample=>sample.point)])),csv=m.buildCsvExport(state).text;
 const html=render(m.CurrentList,{entities:rows,paths,state,display:{...m.defaultListDisplay(),sort:'code'},onSelect:noop,onRemove:noop,onAdd:noop,onClear:noop});const tags=html.split('class="stock-list"')[1];assert(tags.indexOf('>1101<')<tags.indexOf('>2330<'));assert(html.includes('排序與欄位設定'));assert.deepEqual(state,before);assert.equal(m.buildCsvExport(state).text,csv);assert(!m.workspaceSnapshot(state).includes('columns'));
});
test('sector preferences keep all industries and do not expose stock removal',()=>{
 const state={...m.analysisDefaults('Free'),mode:'Sector Move'},rows=m.sectorsForMarket('TWSE'),paths=Object.fromEntries(rows.map(row=>[row.id,row.points]));const html=render(m.CurrentList,{entities:rows,paths,state,display:{...m.defaultListDisplay(),sort:'name'},onSelect:noop,onRemove:noop,onAdd:noop,onClear:noop});assert.equal((html.match(/class="stock-row /g)||[]).length,rows.length);assert(!html.includes('remove-stock'));assert(html.includes('產業輪動總覽'));
});
test('display controls explain fixed identity, allow all optional fields and disable direction for source order',()=>{
 const html=render(m.ListDisplayControls,{value:m.defaultListDisplay(),onChange:noop});assert(html.includes('代號、名稱與資料異常提示固定顯示'));assert.equal((html.match(/type="checkbox"/g)||[]).length,5);assert(html.includes('aria-label="清單排序方向" disabled=""'));assert(html.includes('恢復此清單預設'));
});
test('new backup restores list preferences with one write and undo returns the previous settings',()=>{
 const source=m.createAtomicStorage(memory());m.saveUiPreferences(source,'light','Leading',preferences());const backup=m.createLocalBackup(source,'Pro',choice),native=memory(),target=m.createAtomicStorage(native);m.saveUiPreferences(target,'dark','All',m.defaultListPreferences());const before=target.getItem(m.localKeys.ui),preview=m.previewLocalRestore(target,'Pro',choice,backup.text);assert(preview.parts.find(part=>part.id==='ui').label.includes('清單顯示'));assert(m.restoreLocalBackup(target,'Pro',choice,backup.text,['ui'],preview.stamp).ok);assert.deepEqual(m.readListPreferences(target),preferences());assert(m.undoLocalRestore(target,'Pro',choice).ok);assert.equal(target.getItem(m.localKeys.ui),before);
});
test('old backups without list preferences preserve the targets current stock and sector settings',()=>{
 const source=m.createAtomicStorage(memory()),data=m.createLocalBackup(source,'Pro',choice).backup;delete data.data.ui.list;const text=JSON.stringify(data),target=m.createAtomicStorage(memory());m.saveUiPreferences(target,'light','Improving',preferences());const preview=m.previewLocalRestore(target,'Free',choice,text);assert(preview.parts.find(part=>part.id==='ui').detail.includes('保留目前設定'));assert(m.restoreLocalBackup(target,'Free',choice,text,['ui'],preview.stamp).ok);assert.deepEqual(m.readListPreferences(target),preferences());assert.deepEqual(m.readUiPreferences(target),{theme:'dark',filter:'All'});
});
test('invalid backup display preferences are rejected before any write',()=>{
 const target=m.createAtomicStorage(memory()),backup=m.createLocalBackup(target,'Pro',choice).backup;backup.data.ui.list.stock.columns.level='yes';const before=target.getItem(m.localKeys.ui);assert.throws(()=>m.previewLocalRestore(target,'Pro',choice,JSON.stringify(backup)),/欄位/);assert.equal(target.getItem(m.localKeys.ui),before);
});
