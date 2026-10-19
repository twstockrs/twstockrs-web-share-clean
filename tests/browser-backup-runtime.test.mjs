import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import path from 'node:path';
const bundle=await build({stdin:{contents:"export * from './components/twstock/localBackup';export * from './components/twstock/localWorkspace';export * from './components/twstock/atomicStorage';export * from './components/twstock/model';",resolveDir:path.resolve('.'),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',logLevel:'silent'});
const compiled={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);const m=compiled.exports;
const choice={watchlist:0,saved:0},time=new Date('2026-10-18T08:00:00.000Z');
// Deliberately synthetic catalog metadata only: no quote prices or real market data.
function runtime(market){const id='TEST-'+market;return {market,dataset_kind:'test',input:{market,release_id:'TEST-RELEASE-'+market,revision:1},Daily:['2024-01-03','2024-01-04','2024-01-05'],Weekly:['2024-01-05'],catalog:[{id:id+'-stock',code:'TEST01',name:'測試股票',market,sector:'測試產業',status:'valid',kind:'stock',points:[],searchable:true}],sectors:[{id:id+'-sector',name:'測試產業',market,sector:'測試產業',status:'valid',kind:'sector',points:[]}],market_benchmark:id+'-index'}}
function seed(state){const native={values:new Map(),fail:false,writes:0,getItem(key){return this.values.get(key)??null},setItem(key,value){if(this.fail)throw Error('quota');this.writes++;this.values.set(key,value)}};const storage=m.createAtomicStorage(native);if(state)storage.setItem(m.localKeys.workspace,m.workspaceSnapshot(state));storage.setItem(m.localKeys.retained,JSON.stringify(choice));native.writes=0;return {native,storage}}
const bytes=t=>JSON.stringify([...t.native.values]);
function analysis(context,frequency='Daily',benchmarkType='market',plan='Pro'){return {...m.analysisDefaults(plan,context.market),runtime:context,frequency,period:frequency==='Weekly'?'52W':'60D',trail:20,currentList:[context.catalog[0].id],benchmarkType,benchmark:benchmarkType==='market'?(context.market==='TWSE'?'TAIEX':'TPEX'):benchmarkType==='sector'?context.sectors[0].id:context.catalog[0].id,viewingDate:0}}
for(const market of ['TWSE','TPEx'])for(const frequency of ['Daily','Weekly'])test(`${market} ${frequency}: runtime stock, sector and security benchmark round trips keep exact IDs and parameters`,()=>{
 const context=runtime(market);
 for(const benchmarkType of ['market','sector','security']){
  const state=analysis(context,frequency,benchmarkType),source=seed(state),before=bytes(source),file=m.createLocalBackup(source.storage,'Pro',choice,time,context);
  assert.equal(bytes(source),before);assert.deepEqual(file.warnings,[]);assert(file.backup.data.workspace);assert.equal(m.backupWorkspaceMarket(file.text),market);assert.equal(file.backup.data.workspace.analysis.benchmark,state.benchmark);assert.equal(file.backup.data.workspace.analysis.frequency,frequency);
  for(const forbidden of ['catalog','Daily','Weekly','points','runtime','plan','viewingDate','credentials','price','password'])assert(!Object.hasOwn(file.backup.data.workspace,forbidden));
  assert(!file.text.includes('TEST-RELEASE'));assert(!file.text.includes('測試股票'));assert(!file.text.includes('"points"'));
  const target=seed(),preview=m.previewLocalRestore(target.storage,'Pro',choice,file.text,context);assert(preview.parts.find(p=>p.id==='workspace').allowed);
  const committed=m.restoreLocalBackup(target.storage,'Pro',choice,file.text,['workspace'],preview.stamp,context);assert(committed.ok);assert.equal(target.native.writes,1);
  const restored=m.readWorkspace(m.createAtomicStorage(target.native),'Pro',context);assert(restored.state);assert.equal(restored.state.viewingDate,m.stateDates(restored.state).length-1);assert.deepEqual(JSON.parse(m.workspaceSnapshot(restored.state)),JSON.parse(m.workspaceSnapshot(state)));assert.deepEqual(m.readRetainedSlots(target.storage),choice);
 }
});
test('runtime restore preview and cancellation are read-only, and undo restores the exact prior source snapshot',()=>{
 const context=runtime('TPEx'),source=seed(analysis(context)),target=seed({...m.analysisDefaults('Pro'),currentList:['2330']});const before=bytes(target),prior=target.storage.getItem(m.localKeys.workspace),file=m.createLocalBackup(source.storage,'Pro',choice,time,context);
 const preview=m.previewLocalRestore(target.storage,'Pro',choice,file.text,context);assert.equal(bytes(target),before);assert(m.restoreLocalBackup(target.storage,'Pro',choice,file.text,['workspace'],preview.stamp,context).ok);assert.equal(m.readWorkspaceMarket(target.storage),'TPEx');assert(m.undoLocalRestore(target.storage,'Pro',choice).ok);assert.equal(target.storage.getItem(m.localKeys.workspace),prior);assert.deepEqual(m.readRetainedSlots(target.storage),choice);
});
test('missing or wrong market catalogs and unknown entity/benchmark IDs are refused with zero writes',()=>{
 const context=runtime('TWSE'),source=seed(analysis(context)),file=m.createLocalBackup(source.storage,'Pro',choice,time,context),target=seed(),before=bytes(target);
 for(const ctx of [undefined,runtime('TPEx')]){assert.throws(()=>m.previewLocalRestore(target.storage,'Pro',choice,file.text,ctx),/市場目錄/);assert.equal(m.restoreLocalBackup(target.storage,'Pro',choice,file.text,['workspace'],'x',ctx).ok,false)}
 for(const mutate of [v=>v.data.workspace.analysis.currentList.push('UNKNOWN'),v=>{v.data.workspace.analysis.benchmarkType='security';v.data.workspace.analysis.benchmark='UNKNOWN'}]){const bad=JSON.parse(file.text);mutate(bad);assert.throws(()=>m.parseLocalBackup(JSON.stringify(bad),context))}
 assert.equal(bytes(target),before);
});
test('a market version change or storage change after preview refuses restore and keeps originals',()=>{
 const context=runtime('TWSE'),source=seed(analysis(context)),target=seed(),file=m.createLocalBackup(source.storage,'Pro',choice,time,context),preview=m.previewLocalRestore(target.storage,'Pro',choice,file.text,context),before=bytes(target),changed={...context,input:{...context.input,revision:2}};
 const stale=m.restoreLocalBackup(target.storage,'Pro',choice,file.text,['workspace'],preview.stamp,changed);assert.equal(stale.ok,false);assert.match(stale.notice,/版本已切換/);assert.equal(bytes(target),before);
 target.storage.setItem(m.localKeys.ui,JSON.stringify({theme:'light',filter:'All'}));const altered=bytes(target);assert.equal(m.restoreLocalBackup(target.storage,'Pro',choice,file.text,['workspace'],preview.stamp,context).ok,false);assert.equal(bytes(target),altered);
});
test('Free accepts legal runtime daily settings but cannot restore Pro weekly, advanced benchmark or Pro-only period/trail',()=>{
 const context=runtime('TWSE'),target=seed(),before=bytes(target);
 for(const state of [analysis(context,'Weekly'),analysis(context,'Daily','security'),{...analysis(context),period:'240D',trail:240}]){
  const file=m.createLocalBackup(seed(state).storage,'Pro',choice,time,context),preview=m.previewLocalRestore(target.storage,'Free',choice,file.text,context);assert.equal(preview.parts.find(p=>p.id==='workspace').allowed,false);assert.equal(m.restoreLocalBackup(target.storage,'Free',choice,file.text,['workspace'],preview.stamp,context).ok,false);assert.equal(bytes(target),before);
 }
 const state=analysis(context,'Daily','market','Free'),file=m.createLocalBackup(seed(state).storage,'Free',choice,time,context);assert(file.backup.data.workspace);const preview=m.previewLocalRestore(target.storage,'Free',choice,file.text,context);assert(m.restoreLocalBackup(target.storage,'Free',choice,file.text,['workspace'],preview.stamp,context).ok);assert.equal(m.readWorkspace(target.storage,'Free',context).state.period,'60D');
});
test('quota failure is atomic; edits after restore prevent destructive undo',()=>{
 const context=runtime('TWSE'),file=m.createLocalBackup(seed(analysis(context)).storage,'Pro',choice,time,context),target=seed(),preview=m.previewLocalRestore(target.storage,'Pro',choice,file.text,context),before=bytes(target);target.native.fail=true;assert.equal(m.restoreLocalBackup(target.storage,'Pro',choice,file.text,['workspace'],preview.stamp,context).ok,false);assert.equal(bytes(target),before);target.native.fail=false;assert(m.restoreLocalBackup(target.storage,'Pro',choice,file.text,['workspace'],preview.stamp,context).ok);target.storage.setItem(m.localKeys.workspace,'user-new-data');const changed=bytes(target);assert.equal(m.undoLocalRestore(target.storage,'Pro',choice).ok,false);assert.equal(bytes(target),changed);
});
test('legacy demo v1 files remain readable while input destinations cannot silently accept their demo workspace',()=>{
 const source=seed(m.analysisDefaults('Pro')),file=m.createLocalBackup(source.storage,'Pro',choice,time),context=runtime('TWSE'),target=seed();assert.equal(m.parseLocalBackup(file.text).version,1);assert.equal(m.parseLocalBackup(file.text,context).version,1);const preview=m.previewLocalRestore(target.storage,'Pro',choice,file.text,context);assert.equal(preview.parts.find(p=>p.id==='workspace').allowed,false);assert(preview.parts.find(p=>p.id==='ui').allowed);
});
