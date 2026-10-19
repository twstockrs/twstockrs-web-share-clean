import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import path from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

const bundle=await build({stdin:{contents:`export * from './components/twstock/model'; export * from './components/twstock/localWorkspace'; export * from './components/twstock/localLibrary'; export * from './components/twstock/localBackup'; export * from './components/twstock/atomicStorage'; export * from './components/twstock/storageKeys'; export {default as BackupPanel} from './components/twstock/BackupPanel'; export {default as Drawer} from './components/twstock/Drawer'; export {default as Workstation} from './components/twstock/Workstation';`,resolveDir:path.resolve('.'),loader:'tsx'},bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',external:['react','react-dom','react/jsx-runtime'],logLevel:'silent'});
const compiled={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);
const m=compiled.exports,choice={watchlist:0,saved:0},time=new Date('2026-10-14T03:00:00.000Z');
const nativeStorage=()=>({values:new Map(),writes:[],fail:false,getItem(key){return this.values.get(key)??null},setItem(key,value){if(this.fail)throw Error('quota exceeded');this.writes.push(key);this.values.set(key,value)}});
function seed(plan='Pro'){
 const native=nativeStorage(),state={...m.analysisDefaults(plan),currentList:['2330','2881'],...(plan==='Pro'?{period:'137D',trail:33}:{})},library=m.createDemoLibrary();
 native.setItem(m.localKeys.library,JSON.stringify(library));native.setItem(m.localKeys.workspace,m.workspaceSnapshot(state));native.setItem(m.localKeys.ui,JSON.stringify({theme:'light',filter:'Leading'}));native.setItem(m.localKeys.frequency,JSON.stringify({Pro:{Daily:{period:'137D',trail:33},Weekly:{period:'37W',trail:12}},Free:{Daily:{period:'60D',trail:10}}}));native.setItem(m.localKeys.benchmarks,JSON.stringify(['0050','2330','5274']));native.setItem(m.localKeys.retained,JSON.stringify(choice));native.writes=[];
 return {native,storage:m.createAtomicStorage(native),state,library};
}
const bytes=native=>JSON.stringify([...native.values.entries()]);
const backup=()=>{const source=seed();return m.createLocalBackup(source.storage,'Pro',choice,time)};
const allAllowed=preview=>preview.parts.filter(part=>part.allowed).map(part=>part.id);
const commit=(target,text,plan='Pro',retained=choice,select)=>{const preview=m.previewLocalRestore(target.storage,plan,retained,text);return m.restoreLocalBackup(target.storage,plan,retained,text,select??allAllowed(preview),preview.stamp)};
const render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));
const noop=()=>{};

test('storage adapter reads legacy values without writes and migrates all known values on one successful write',()=>{
 const target=seed(),before=bytes(target.native);assert.equal(target.storage.getItem(m.localKeys.workspace),target.native.getItem(m.localKeys.workspace));assert.equal(bytes(target.native),before);assert.equal(target.native.getItem(m.localStoreKey),null);
 target.storage.setItem(m.localKeys.ui,JSON.stringify({theme:'dark',filter:'All'}));assert.deepEqual(target.native.writes,[m.localStoreKey]);assert.equal(target.storage.getItem(m.localKeys.library),JSON.stringify(target.library));assert.equal(target.native.getItem(m.localKeys.ui),JSON.stringify({theme:'light',filter:'Leading'}));
 const second=m.createAtomicStorage(target.native);assert.equal(JSON.parse(second.getItem(m.localKeys.ui)).theme,'dark');
});
test('one native write updates multiple fields and preserves old data when storage throws',()=>{
 const target=seed(),before=bytes(target.native);target.native.fail=true;
 assert.throws(()=>target.storage.setMany({[m.localKeys.ui]:'new',[m.localKeys.workspace]:null}));assert.equal(bytes(target.native),before);
 target.native.fail=false;target.storage.setMany({[m.localKeys.ui]:'new',[m.localKeys.workspace]:null});assert.equal(target.native.writes.length,1);assert.equal(target.storage.getItem(m.localKeys.workspace),null);assert.equal(target.storage.getItem(m.localKeys.ui),'new');
});
test('malformed atomic containers and unknown keys are rejected without overwriting the original',()=>{
 const target=seed();target.native.setItem(m.localStoreKey,'bad-root');const before=bytes(target.native);
 assert.throws(()=>target.storage.getItem(m.localKeys.library));assert.throws(()=>target.storage.setItem(m.localKeys.ui,'new'));assert.equal(bytes(target.native),before);
 const empty=m.createAtomicStorage(nativeStorage());assert.throws(()=>empty.setItem('other-app-token','x'));assert.throws(()=>empty.getItem('other-app-token'));
});
test('Pro backup contains all six slots and legal preferences but no credentials, rights or transient state',()=>{
 const source=seed();source.native.setItem('unrelated-token','SECRET');const before=bytes(source.native),result=m.createLocalBackup(source.storage,'Pro',choice,time);
 assert.equal(result.backup.data.watchlists.filter(Boolean).length,4);assert.equal(result.backup.data.savedViews.filter(Boolean).length,2);assert.equal(result.backup.data.workspace.analysis.period,'137D');assert.deepEqual(result.backup.data.recentBenchmarks,['0050','2330','5274']);assert(result.filename.endsWith('.json'));assert(!result.filename.includes(':'));assert.equal(bytes(source.native),before);
 for(const key of ['plan','viewingDate','selectedEntity','hoveredId','statusOverrides','retained','credentials','recovery'])assert(!result.text.includes(`"${key}"`));assert(!result.text.includes('SECRET'));
});
test('Free backup excludes locked contents instead of copying them into another available slot',()=>{
 const source=seed('Free');source.library.watchlists[2].name='PRIVATE-WATCH';source.library.savedViews[1].name='PRIVATE-VIEW';source.native.setItem(m.localKeys.library,JSON.stringify(source.library));
 const result=m.createLocalBackup(source.storage,'Free',choice,time);assert.deepEqual(result.backup.data.watchlists.map(Boolean),[true,false,false,false]);assert.deepEqual(result.backup.data.savedViews.map(Boolean),[true,false]);assert(!result.text.includes('PRIVATE'));assert.equal(result.backup.data.frequency.Pro,undefined);
});
test('anonymous cannot create or restore backups and backup files do not grant a plan',()=>{
 const source=seed(),text=backup().text,before=bytes(source.native);
 assert.throws(()=>m.createLocalBackup(source.storage,'Anonymous',choice));assert.throws(()=>m.previewLocalRestore(source.storage,'Anonymous',choice,text));const result=m.restoreLocalBackup(source.storage,'Anonymous',choice,text,['ui'],'x');assert.equal(result.ok,false);assert.equal(bytes(source.native),before);
 const forged=JSON.parse(text);forged.plan='Pro';assert.throws(()=>m.parseLocalBackup(JSON.stringify(forged)),/不支援欄位/);
});
test('unsupported saved workspace is omitted with a warning rather than silently replaced by default parameters',()=>{
 const source=seed(),result=m.createLocalBackup(source.storage,'Free',choice,time);assert.equal(result.backup.data.workspace,null);assert(result.warnings.some(message=>message.includes('最近分析')));assert.equal(JSON.parse(source.storage.getItem(m.localKeys.workspace)).analysis.period,'137D');
});
test('backup parsing rejects malformed versions, slot counts, duplicates, invalid settings and oversized UTF-8 data',()=>{
 const original=JSON.parse(backup().text);
 for(const change of [value=>{value.version=2},value=>{value.createdAt='2026-02-31T03:00:00.000Z'},value=>{value.data.watchlists=[]},value=>{value.data.watchlists[0].ids=['2330','2330']},value=>{value.data.workspace.analysis.period='999D'},value=>{value.data.ui.theme='oops'},value=>{value.data.frequency.Pro.Weekly.trail=99},value=>{value.data.recentBenchmarks=['UNKNOWN']}]){const next=structuredClone(original);change(next);assert.throws(()=>m.parseLocalBackup(JSON.stringify(next)))}
 assert.throws(()=>m.parseLocalBackup('not json'));assert.throws(()=>m.parseLocalBackup('漢'.repeat(m.backupLimit/2)),/1 MB/);assert.equal(m.parseLocalBackup('\uFEFF'+JSON.stringify(original)).version,1);
});
test('previewing and cancelling have no writes, and preview lists every eligible overwrite',()=>{
 const target=seed(),before=bytes(target.native),preview=m.previewLocalRestore(target.storage,'Pro',choice,backup().text);
 assert.equal(preview.parts.length,10);assert.equal(allAllowed(preview).length,10);assert(preview.parts.some(part=>part.id==='workspace'));assert.equal(bytes(target.native),before);assert.equal(target.native.writes.length,0);
});
test('restore selected parts leaves everything else and the Free slot choice untouched',()=>{
 const target=seed('Free'),beforeWorkspace=target.storage.getItem(m.localKeys.workspace),beforeLibrary=target.storage.getItem(m.localKeys.library),text=backup().text;
 target.storage.setItem(m.localKeys.ui,JSON.stringify({theme:'dark',filter:'Lagging'}));target.native.writes=[];
 const result=commit(target,text,'Free',choice,['ui']);assert(result.ok);assert.equal(JSON.parse(target.storage.getItem(m.localKeys.ui)).theme,'light');assert.equal(target.storage.getItem(m.localKeys.workspace),beforeWorkspace);assert.equal(target.storage.getItem(m.localKeys.library),beforeLibrary);assert.deepEqual(m.readRetainedSlots(target.storage),choice);assert.deepEqual(target.native.writes,[m.localStoreKey]);
});
test('Pro backup restored under Free previews locked and Pro-only items as unavailable',()=>{
 const target=seed('Free'),text=backup().text,preview=m.previewLocalRestore(target.storage,'Free',choice,text),before=bytes(target.native);
 for(const id of ['watchlist:1','watchlist:2','watchlist:3','saved:1','workspace'])assert.equal(preview.parts.find(part=>part.id===id).allowed,false);
 assert.equal(m.restoreLocalBackup(target.storage,'Free',choice,text,['watchlist:2'],preview.stamp).ok,false);assert.equal(bytes(target.native),before);
 const selectedView=m.previewLocalRestore(target.storage,'Free',{watchlist:0,saved:1},text);assert.equal(selectedView.parts.find(part=>part.id==='saved:1').allowed,false);assert(selectedView.parts.find(part=>part.id==='saved:1').reason.includes('週頻'));
});
test('restore never remaps locked source slots to Free usable slots and hides locked source details',()=>{
 const target=seed('Free'),data=JSON.parse(backup().text);data.data.watchlists[2].name='PRIVATE-SOURCE';data.data.savedViews[1].name='PRIVATE-PRESET';const text=JSON.stringify(data);
 const preview=m.previewLocalRestore(target.storage,'Free',choice,text);assert(!JSON.stringify(preview.parts).includes('PRIVATE'));const result=m.restoreLocalBackup(target.storage,'Free',choice,text,['watchlist:0'],preview.stamp);assert(result.ok);assert.notEqual(m.readLocalLibrary(target.storage).library.watchlists[0].name,'PRIVATE-SOURCE');
});
test('changing market on a nonempty target watchlist is blocked before any restore write',()=>{
 const target=seed(),library=target.library;library.watchlists[0]={name:'上櫃',market:'TPEx',ids:['5274']};target.native.setItem(m.localKeys.library,JSON.stringify(library));const before=bytes(target.native),text=backup().text,preview=m.previewLocalRestore(target.storage,'Pro',choice,text);
 assert.equal(preview.parts.find(part=>part.id==='watchlist:0').allowed,false);assert(preview.parts.find(part=>part.id==='watchlist:0').reason.includes('清空'));assert.equal(m.restoreLocalBackup(target.storage,'Pro',choice,text,['watchlist:0'],preview.stamp).ok,false);assert.equal(bytes(target.native),before);
});
test('a complete Pro restore writes once, resets the workspace date through normal validation and preserves permissions',()=>{
 const target=seed(),text=backup().text;target.native.setItem(m.localKeys.workspace,m.workspaceSnapshot({...target.state,period:'60D',trail:20}));target.native.writes=[];
 const result=commit(target,text);assert(result.ok);assert.deepEqual(target.native.writes,[m.localStoreKey]);assert.equal(m.readWorkspace(target.storage,'Pro').state.period,'137D');assert.equal(m.readWorkspace(target.storage,'Pro').state.viewingDate,9);assert.equal(m.readWorkspace(target.storage,'Pro').state.selectedEntity,null);assert.deepEqual(m.readRetainedSlots(target.storage),choice);assert(m.recoveryAvailable(target.storage));
});
test('confirmation rechecks data revision, selection, plan and slot access instead of trusting a preview',()=>{
 const target=seed(),text=backup().text,preview=m.previewLocalRestore(target.storage,'Pro',choice,text);
 for(const ids of [[],['ui','ui'],['retained'],['token']])assert.equal(m.restoreLocalBackup(target.storage,'Pro',choice,text,ids,preview.stamp).ok,false);
 assert.equal(m.restoreLocalBackup(target.storage,'Free',choice,text,['watchlist:2'],preview.stamp).ok,false);
 target.storage.setItem(m.localKeys.ui,JSON.stringify({theme:'dark',filter:'All'}));const before=bytes(target.native);const result=m.restoreLocalBackup(target.storage,'Pro',choice,text,['ui'],preview.stamp);assert.equal(result.ok,false);assert(result.notice.includes('已變更'));assert.equal(bytes(target.native),before);
});
test('failed bulk restore preserves every original key and does not create a recovery record',()=>{
 const target=seed(),text=backup().text,preview=m.previewLocalRestore(target.storage,'Pro',choice,text),before=bytes(target.native);target.native.fail=true;
 const result=m.restoreLocalBackup(target.storage,'Pro',choice,text,allAllowed(preview),preview.stamp);assert.equal(result.ok,false);assert(result.notice.includes('整批資料未變更'));assert.equal(bytes(target.native),before);assert.equal(m.recoveryAvailable(target.storage),false);
});
test('restoration requires the atomic storage adapter and does not fall back to partial writes',()=>{
 const target=seed(),text=backup().text,preview=m.previewLocalRestore(target.native,'Pro',choice,text),before=bytes(target.native);const result=m.restoreLocalBackup(target.native,'Pro',choice,text,['ui'],preview.stamp);assert.equal(result.ok,false);assert(result.notice.includes('重新整理'));assert.equal(bytes(target.native),before);
});
test('undo restores exact prior stored values with one native write and does not alter current slot choices',()=>{
 const target=seed();target.native.setItem(m.localKeys.ui,JSON.stringify({theme:'dark',filter:'Improving'}));const before=Object.fromEntries(Object.values(m.localKeys).map(key=>[key,target.storage.getItem(key)]));assert(commit(target,backup().text).ok);target.native.writes=[];
 const result=m.undoLocalRestore(target.storage,'Pro',choice);assert(result.ok);assert.deepEqual(target.native.writes,[m.localStoreKey]);for(const [key,value] of Object.entries(before))assert.equal(target.storage.getItem(key),value);assert.equal(m.recoveryAvailable(target.storage),false);
});
test('undo refuses to overwrite modifications made after restore',()=>{
 const target=seed();assert(commit(target,backup().text).ok);target.storage.setItem(m.localKeys.ui,JSON.stringify({theme:'dark',filter:'Improving'}));const before=bytes(target.native),result=m.undoLocalRestore(target.storage,'Pro',choice);assert.equal(result.ok,false);assert(result.notice.includes('已修改'));assert.equal(bytes(target.native),before);assert(m.recoveryAvailable(target.storage));
});
test('undo rechecks locked slot permissions after a downgrade',()=>{
 const target=seed(),data=JSON.parse(backup().text);data.data.watchlists[2].name='changed-slot-3';assert(commit(target,JSON.stringify(data)).ok);const before=bytes(target.native),result=m.undoLocalRestore(target.storage,'Free',choice);assert.equal(result.ok,false);assert.equal(bytes(target.native),before);assert(m.recoveryAvailable(target.storage));
});
test('failed undo keeps both restored data and its recovery record',()=>{
 const target=seed();assert(commit(target,backup().text).ok);const before=bytes(target.native);target.native.fail=true;assert.equal(m.undoLocalRestore(target.storage,'Pro',choice).ok,false);assert.equal(bytes(target.native),before);assert(m.recoveryAvailable(target.storage));
});
test('damaged library repair requires Pro and all six valid slots, preserving damaged originals for undo',()=>{
 const target=seed();target.native.setItem(m.localKeys.library,'damaged-original');const text=backup().text,preview=m.previewLocalRestore(target.storage,'Pro',choice,text),ids=preview.parts.filter(part=>/^(watchlist|saved):/.test(part.id)).map(part=>part.id);
 assert(preview.repairLibrary);assert.equal(ids.length,6);assert.equal(m.restoreLocalBackup(target.storage,'Pro',choice,text,['watchlist:0'],preview.stamp).ok,false);
 assert(m.restoreLocalBackup(target.storage,'Pro',choice,text,ids,preview.stamp).ok);assert(m.readLocalLibrary(target.storage).writable);assert(m.undoLocalRestore(target.storage,'Pro',choice).ok);assert.equal(target.storage.getItem(m.localKeys.library),'damaged-original');assert.equal(m.readLocalLibrary(target.storage).writable,false);
});
test('Free or incomplete backups cannot rebuild a damaged library by replacing inaccessible data with demos',()=>{
 const target=seed();target.native.setItem(m.localKeys.library,'damaged-original');const full=backup().text,freeSource=seed('Free'),partial=m.createLocalBackup(freeSource.storage,'Free',choice,time).text;
 for(const [plan,text] of [['Free',full],['Pro',partial]]){const preview=m.previewLocalRestore(target.storage,plan,choice,text);assert(preview.parts.filter(part=>/^(watchlist|saved):/.test(part.id)).every(part=>!part.allowed))}
 assert.throws(()=>m.createLocalBackup(target.storage,'Pro',choice),/損壞/);assert.equal(target.storage.getItem(m.localKeys.library),'damaged-original');
});
test('a tampered recovery record cannot write arbitrary keys or import credentials',()=>{
 const target=seed();target.storage.setItem(m.localKeys.recovery,JSON.stringify({format:'TWStockRS-restore-recovery',version:1,createdAt:time.toISOString(),before:{token:'secret'},after:{token:null}}));const before=bytes(target.native);assert.equal(m.undoLocalRestore(target.storage,'Pro',choice).ok,false);assert.equal(bytes(target.native),before);assert.equal(m.recoveryAvailable(target.storage),false);
});
test('a new restore replaces the single recovery level rather than building extra account slots',()=>{
 const target=seed(),text=backup().text;assert(commit(target,text,'Pro',choice,['ui']).ok);const first=target.storage.getItem(m.localKeys.ui);target.storage.setItem(m.localKeys.ui,JSON.stringify({theme:'dark',filter:'All'}));const secondBefore=target.storage.getItem(m.localKeys.ui);assert(commit(target,text,'Pro',choice,['ui']).ok);assert(m.undoLocalRestore(target.storage,'Pro',choice).ok);assert.equal(target.storage.getItem(m.localKeys.ui),secondBefore);assert.notEqual(first,secondBefore);assert.equal(m.recoveryAvailable(target.storage),false);
});
test('recent benchmark records use the same migrated store as backups and normal selection',()=>{
 const target=seed();assert.deepEqual(m.readRecentBenchmarks(target.storage),['0050','2330','5274']);assert(m.saveRecentBenchmarks(target.storage,['006208','2330']));const reloaded=m.createAtomicStorage(target.native);assert.deepEqual(m.readRecentBenchmarks(reloaded),['006208','2330']);assert.deepEqual(m.createLocalBackup(reloaded,'Pro',choice,time).backup.data.recentBenchmarks,['006208','2330']);
});
test('the backup panel and account drawer expose local-only backup controls and lock Anonymous actions',()=>{
 const target=seed(),props={storage:target.storage,retained:choice,onRestored:noop};
 const html=render(m.BackupPanel,{...props,plan:'Free'});assert(html.includes('下載備份檔'));assert(html.includes('選擇備份檔'));assert(html.includes('不包含方案權限或 Free 選定格'));assert(html.includes('type="file"'));assert(!html.includes('還原預覽'));
 const anonymous=render(m.BackupPanel,{...props,plan:'Anonymous'});assert.match(anonymous,/<button disabled=""/);assert(anonymous.includes('Free 起可使用'));
 const drawer=render(m.Drawer,{kind:'account',state:m.analysisDefaults('Free'),retained:choice,storage:target.storage,onChoose:noop,onClose:noop,onRestore:noop,onLoadList:noop});assert(drawer.includes('本機資料備份／還原'));
});
const renderWorkspace=native=>{const previous=globalThis.window;try{globalThis.window={localStorage:native};return render(m.Workstation,{})}finally{if(previous===undefined)delete globalThis.window;else globalThis.window=previous}};
test('a fresh workstation reads a restored Free workspace from the new atomic store rather than stale legacy keys',()=>{
 const source=seed('Free');source.native.setItem(m.localKeys.workspace,m.workspaceSnapshot({...source.state,period:'120D',trail:10}));const file=m.createLocalBackup(source.storage,'Free',choice,time);
 const native=nativeStorage(),target={native,storage:m.createAtomicStorage(native)};assert(commit(target,file.text,'Free').ok);
 const html=renderWorkspace(native);assert.match(html,/<option value="120D" selected="">/);assert(html.includes('data-theme="light"'));assert(html.includes('2026-09-24'));assert(!html.includes('上次本機設定未載入'));assert.equal(native.getItem(m.localKeys.workspace),null);
});
test('a reloaded workstation stays Free and revalidates restored Pro-only settings without granting Pro',()=>{
 const target=seed('Free');assert(commit(target,backup().text,'Pro').ok);const raw=target.storage.getItem(m.localKeys.workspace);
 const html=renderWorkspace(target.native);assert.match(html,/<option selected="">Free<\/option>/);assert(html.includes('上次本機設定未載入'));assert(html.includes('重試還原本機設定'));assert.equal(target.storage.getItem(m.localKeys.workspace),raw);
});
