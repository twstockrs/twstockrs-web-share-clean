import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import path from 'node:path';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

// Exercise the real model and rendered component output without a browser or mock market service.
const bundle=await build({stdin:{contents:`export * from './components/twstock/model'; export * from './components/twstock/localWorkspace'; export * from './components/twstock/localLibrary'; export * from './components/twstock/sourceLoad'; export * from './components/twstock/Controls'; export * from './components/twstock/Panels'; export {default as LibrarySlotEditor} from './components/twstock/LibrarySlotEditor'; export {default as StockSubsetPicker} from './components/twstock/StockSubsetPicker'; export {default as Drawer} from './components/twstock/Drawer'; export {default as Workstation} from './components/twstock/Workstation';`,resolveDir:path.resolve('.'),loader:'tsx'},bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',external:['react','react-dom','react-dom/server','react/jsx-runtime'],logLevel:'silent'});
const compiled={exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);
const m=compiled.exports;
const render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));
const noop=()=>{};
const button=(html,label)=>html.match(/<button\b[^>]*>/g).find(tag=>tag.includes(`aria-label="${label}"`));
const disabled=(tag)=>/\bdisabled=""/.test(tag);
const state=(plan='Free')=>m.analysisDefaults(plan);

test('anonymous defaults are exactly the five specified TWSE stocks',()=>{
 const s=state('Anonymous');assert.deepEqual(s.currentList,['2330','2881','2603','1216','1101']);
 assert.deepEqual([s.frequency,s.period,s.trail,s.priceType],['Daily','20D',5,'Adjusted']);
 assert.deepEqual(m.analysisIssues(s),[]);
});
test('Free and Pro defaults are valid and never contain another market',()=>{
 for(const plan of ['Free','Pro']){const s=state(plan);assert.deepEqual(m.analysisIssues(s),[]);assert(!s.currentList.includes('5274'))}
 assert.deepEqual(state('Pro').currentList,state('Free').currentList);
});
test('scheme capabilities gate storage, price type, exports and playback',()=>{
 assert.deepEqual(m.capabilities.Anonymous,{watchlists:0,savedViews:0,png:false,csv:false,raw:false,playback:false});
 assert.equal(m.capabilities.Free.watchlists,1);assert.equal(m.capabilities.Free.savedViews,1);assert.equal(m.capabilities.Free.png,true);assert.equal(m.capabilities.Free.csv,false);
 assert.equal(m.capabilities.Pro.watchlists,4);assert.equal(m.capabilities.Pro.savedViews,2);assert.equal(m.capabilities.Pro.csv,true);
});
test('raw and advanced benchmarks cannot be applied through a locked entry point',()=>{
 const s=state('Anonymous');assert.strictEqual(m.updateAnalysis(s,'priceType','Raw'),s);
 for(const plan of ['Anonymous','Free']){const s=state(plan);assert.strictEqual(m.updateAnalysis(s,'benchmarkType','security'),s);assert.strictEqual(m.updateAnalysis(s,'frequency','Weekly'),s)}
});
test('switching market clears the current list, selection and uses the new market benchmark',()=>{
 const source={...state('Pro'),selectedEntity:'2330',hoveredId:'2330'};
 const target=m.updateAnalysis(source,'market','TPEx');
 assert.deepEqual(target.currentList,[]);assert.equal(target.selectedEntity,null);assert.equal(target.hoveredId,null);assert.equal(target.benchmark,'TPEX');
 assert.deepEqual(m.updateAnalysis(target,'market','TWSE').currentList,[]);assert.equal(source.currentList.length,7);
});
test('market benchmark is bound to the analysis market for Pro as well',()=>{
 const s=state('Pro');assert.strictEqual(m.updateAnalysis(s,'benchmark','TPEX'),s);
 assert(m.analysisIssues({...s,benchmark:'TPEX'}).length>0);
});
test('Sector Move fixes the benchmark while preserving source analysis parameters',()=>{
 const source={...state('Pro'),benchmarkType:'security',benchmark:'0050',period:'37D',trail:12,priceType:'Raw',viewingDate:5};
 const target=m.updateAnalysis(source,'mode','Sector Move');
 assert.equal(target.benchmarkType,'market');assert.equal(target.benchmark,'TAIEX');
 for(const key of ['market','frequency','period','trail','priceType','viewingDate'])assert.equal(target[key],source[key]);
 assert.strictEqual(m.updateAnalysis(target,'benchmarkType','sector'),target);
});
test('industry IDs are distinct across markets and no TPEx label is attached to a TWSE series',()=>{
 const a=m.sectorsForMarket('TWSE'),b=m.sectorsForMarket('TPEx');
 assert(a.every(e=>e.market==='TWSE'));assert(b.every(e=>e.market==='TPEx'));
 assert(!b.some(e=>a.some(other=>other.id===e.id)));
 assert.deepEqual(m.benchmarkOptions('sector','TPEx').map(e=>e.value),b.map(e=>e.id));
});
test('input rejects unknown and wrong-market stocks without consuming space for valid entries',()=>{
 const s={...state('Anonymous'),currentList:['2330','2881','2603','1216']};
 const result=m.classifyStockInput(['9999','5274','2330','1101','2454'],s);
 assert.deepEqual(result.accepted,['1101']);assert.equal(result.rejected.length,4);
 assert(result.rejected.some(reason=>reason.includes('2454')&&reason.includes('容量')));
});
test('duplicates and leading-zero ETF strings retain their identity',()=>{
 const result=m.classifyStockInput(['2454','2454','2308'],{...state(),currentList:[]});
 assert.deepEqual(result.accepted,['2454','2308']);assert.equal(result.rejected.length,1);
 assert(m.benchmarkOptions('security','TWSE').some(e=>e.value==='0050'));
});
test('self comparison keeps the stock but supplies no coordinates and the correct result status',()=>{
 const s={...state('Pro'),benchmarkType:'security',benchmark:'2330'};
 assert(s.currentList.includes('2330'));assert.deepEqual(m.visibleSamples(m.catalog[0],s),[]);
 assert.equal(m.entityStatus(m.catalog[0],s),'no_result');assert(m.visibleSamples(m.catalog[1],s).length>0);
});
test('weekly mode maps to a completed endpoint no later than the source date',()=>{
 const s=m.updateAnalysis(state('Pro'),'frequency','Weekly');
 assert.equal(s.period,'52W');assert.equal(m.analysisDates(s.frequency)[s.viewingDate],'2026-09-18');
 assert.deepEqual(m.analysisDates('Weekly'),['2026-09-11','2026-09-18']);
 assert.deepEqual(m.visibleSamples(m.catalog[0],s).map(p=>p.date),['2026-09-11','2026-09-18']);
 const daily=m.updateAnalysis(s,'frequency','Daily');assert.equal(m.analysisDates('Daily')[daily.viewingDate],'2026-09-18');
});
test('invalid dates and unsupported enums cannot be applied',()=>{
 const s=state('Pro');for(const [key,value] of [['viewingDate',-1],['viewingDate',50],['frequency','Monthly'],['market','All'],['priceType','Other'],['mode','Unknown']])assert.strictEqual(m.updateAnalysis(s,key,value),s);
});
test('downgraded settings are diagnosed without changing the saved values or deleting stocks',()=>{
 const pro={...state('Pro'),frequency:'Weekly',period:'37W',trail:33,currentList:Array.from({length:25},(_,i)=>'TEST'+i)};
 const free={...pro,plan:'Free'};
 const errors=m.analysisIssues(free);assert(errors.length>=4);assert.equal(free.period,'37W');assert.equal(free.trail,33);assert.equal(free.currentList.length,25);
});
test('saved view is rejected under Free rather than rewritten to a different frequency or period',()=>{
 const preset=m.demoSavedView(1),candidate={...preset,plan:'Free'};
 assert(m.analysisIssues(candidate).length>0);assert.equal(candidate.frequency,'Weekly');assert.equal(candidate.period,'52W');
 assert.deepEqual(m.analysisIssues({...m.demoSavedView(0),plan:'Free'}),[]);
});
test('Free retained slot is independent for each storage kind; no selection grants no access',()=>{
 for(const kind of ['watchlist','saved']){assert.equal(m.slotAccessible('Free',0,kind,null),false);assert.equal(m.slotAccessible('Free',1,kind,1),true);assert.equal(m.slotAccessible('Free',0,kind,1),false);assert.equal(m.slotAccessible('Anonymous',0,kind,0),false)}
 assert.equal(m.slotAccessible('Pro',3,'watchlist',null),true);assert.equal(m.slotAccessible('Pro',2,'saved',null),false);
});
test('markers remain first valid plus latest four, with their original dates after truncation and gaps',()=>{
 const samples=m.visibleSamples(m.catalog[0],{...state('Pro'),trail:7});
 assert.deepEqual([...m.representativePointIndices(samples.map(p=>p.point))].map(i=>samples[i].date),['2026-09-16','2026-09-21','2026-09-22','2026-09-23','2026-09-24']);
 const gaps=m.visibleSamples(m.catalog[4],state());assert(gaps.some(p=>p.point===null));
 assert.deepEqual([...m.representativePointIndices(gaps.map(p=>p.point))].map(i=>gaps[i].date),['2026-09-11','2026-09-21','2026-09-22','2026-09-23','2026-09-24']);
 assert.equal(m.visibleSamples(m.catalog[7],m.analysisDefaults('Pro','TPEx')).at(-1).date,'2026-09-22');
});
test('rendered export and storage controls match all three plans and block empty or invalid analysis',()=>{
 for(const plan of ['Anonymous','Free','Pro']){
  const html=render(m.ExportControls,{plan,blocked:false,empty:false,onOpen:noop,onExport:noop});
  assert.equal(disabled(button(html,'Watchlist')),plan==='Anonymous');assert.equal(disabled(button(html,'Saved View')),plan==='Anonymous');
  assert.equal(disabled(button(html,'PNG')),plan==='Anonymous');assert.equal(disabled(button(html,'CSV')),plan!=='Pro');
 }
 for(const props of [{blocked:true,empty:false},{blocked:false,empty:true}]){const html=render(m.ExportControls,{plan:'Pro',...props,onOpen:noop,onExport:noop});assert(disabled(button(html,'PNG')));assert(disabled(button(html,'CSV')))}
});
test('rendered Anonymous price control locks Raw and a pending downgrade disables analysis controls',()=>{
 const html=render(m.AnalysisControls,{state:state('Anonymous'),update:noop});assert.match(html,/<option value="Raw" disabled="">/);
 const blocked=render(m.AnalysisControls,{state:{...state('Pro'),plan:'Free',period:'137D',trail:33},disabled:true,update:noop});
 assert.match(blocked,/<fieldset[^>]*disabled=""/);assert(blocked.includes('137D'));assert(blocked.includes('33'));
});
test('rendered Pro Sector Move locks advanced types and other-market indices',()=>{
 const html=render(m.AnalysisControls,{state:m.updateAnalysis(state('Pro'),'mode','Sector Move'),update:noop});
 assert.match(html,/<option value="sector" disabled="">/);assert.match(html,/<option value="security" disabled="">/);assert.match(html,/<option value="TPEX" disabled="">/);
});
test('rendered detail uses the selected benchmark and actual last valid data date',()=>{
 const s={...m.analysisDefaults('Pro','TPEx'),benchmarkType:'security',benchmark:'5274'};
 const other={...m.catalog[7],id:'TPTEST'};
 const samples=m.visibleSamples(other,s);
 const html=render(m.DetailPanel,{entity:other,state:s,points:samples.map(p=>p.point),pointDates:samples.map(p=>p.date),onBack:noop,onStatus:noop});
 assert(html.includes('5274 信驊'));assert(html.includes('2026-09-22'));assert(!html.includes('TAIEX'));
});
test('rendered self-comparison detail explains the empty result',()=>{
 const s={...state('Pro'),benchmarkType:'security',benchmark:'2330'};
 const html=render(m.DetailPanel,{entity:m.catalog[0],state:s,points:[],pointDates:[],onBack:noop,onStatus:noop});assert(html.includes('比較基準不能與分析標的相同'));
});
test('locked retained views show names, not the saved analysis contents',()=>{
 const html=render(m.Drawer,{kind:'saved',state:state('Free'),retained:{watchlist:0,saved:0},onChoose:noop,onClose:noop,onRestore:()=>true,onLoadList:()=>true});
 assert(html.includes('檢視 2'));assert(html.includes('保留並鎖定'));assert(!html.includes('52W'));
 const choosing=render(m.Drawer,{kind:'saved',state:state('Free'),retained:{watchlist:0,saved:null},onChoose:noop,onClose:noop,onRestore:()=>true,onLoadList:()=>true});assert(choosing.includes('選定本段 Free'));
});

const memoryStorage=()=>{const values=new Map();return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)}};
test('Daily and Weekly remember their own period and trail instead of converting week counts to days',()=>{
 let s={...state('Pro'),period:'137D',trail:33},preferences=m.rememberFrequency({},s);
 s=m.switchFrequency(s,'Weekly',preferences);assert.deepEqual([s.period,s.trail],['52W',20]);
 s={...s,period:'37W',trail:12};preferences=m.rememberFrequency(preferences,s);
 s=m.switchFrequency(s,'Daily',preferences);assert.deepEqual([s.period,s.trail],['137D',33]);
 assert.equal(m.analysisDates(s.frequency)[s.viewingDate],'2026-09-18');
 s=m.switchFrequency(s,'Weekly',preferences);assert.deepEqual([s.period,s.trail],['37W',12]);
});
test('frequency preferences remain isolated by plan and mode switches preserve source parameters',()=>{
 const preferences=m.rememberFrequency({}, {...state('Pro'),period:'137D',trail:33});
 const free=m.switchFrequency(state('Free'),'Weekly',preferences);assert.strictEqual(free.frequency,'Daily');
 const pro={...state('Pro'),period:'37D',trail:12};assert.equal(m.updateAnalysis(pro,'mode','Sector Move').period,'37D');
 assert.equal(m.rememberFrequency(preferences,{...state('Free'),period:'137D'}),preferences);
});
test('corrupted or unavailable preference storage never breaks initialization or coerces invalid values',()=>{
 const storage=memoryStorage();storage.setItem(m.localKeys.frequency,JSON.stringify({Pro:{Daily:{period:'241D',trail:20},Weekly:{period:'37W',trail:38}},Free:{Daily:{period:'120D',trail:20}}}));
 assert.deepEqual(m.readFrequencyPreferences(storage),{Free:{Daily:{period:'120D',trail:20}}});
 storage.setItem(m.localKeys.frequency,'{bad');assert.deepEqual(m.readFrequencyPreferences(storage),{});
 assert.deepEqual(m.readFrequencyPreferences({getItem(){throw Error('denied')}}),{});
});
test('frequency preferences survive a storage round trip',()=>{
 const storage=memoryStorage(),preferences=m.rememberFrequency(m.rememberFrequency({}, {...state('Pro'),period:'137D',trail:33}),{...state('Pro'),frequency:'Weekly',period:'37W',trail:12});
 assert(m.saveFrequencyPreferences(storage,preferences));assert.deepEqual(m.readFrequencyPreferences(storage),preferences);
});
test('workspace restores legal settings and the current list at Latest with no transient interactions',()=>{
 const s={...state(),mode:'Sector Move',period:'120D',trail:10,viewingDate:2,selectedEntity:'S1',hoveredId:'S2',statusOverrides:{2330:'inactive'}};
 const raw=m.workspaceSnapshot(s),parsed=JSON.parse(raw);
 for(const key of ['plan','viewingDate','selectedEntity','hoveredId','statusOverrides','playing','zoom','pan'])assert(!Object.hasOwn(parsed.analysis,key));
 const restored=m.restoreWorkspace(raw,'Free');assert(restored.state);assert.equal(restored.state.viewingDate,9);assert.equal(restored.state.selectedEntity,null);assert.equal(restored.state.hoveredId,null);assert.deepEqual(restored.state.statusOverrides,{});
 assert.equal(restored.state.period,'120D');assert.equal(restored.state.trail,10);assert.equal(restored.state.mode,'Sector Move');assert.deepEqual(restored.state.currentList,s.currentList);
});
test('an intentionally empty list is restored as empty, including after switching markets',()=>{
 const empty=m.updateAnalysis(state(),'market','TPEx');
 const restored=m.restoreWorkspace(m.workspaceSnapshot(empty),'Free');assert.deepEqual(restored.state.currentList,[]);assert.equal(restored.state.market,'TPEx');assert.equal(restored.state.benchmark,'TPEX');
});
test('restoration always checks the supplied plan and ignores a forged stored plan',()=>{
 const parsed=JSON.parse(m.workspaceSnapshot(state()));parsed.analysis.plan='Pro';parsed.analysis.selectedEntity='2330';
 const restored=m.restoreWorkspace(JSON.stringify(parsed),'Free');assert.equal(restored.state.plan,'Free');assert.equal(restored.state.selectedEntity,null);
 parsed.analysis.frequency='Weekly';parsed.analysis.period='37W';parsed.analysis.trail=12;
 const blocked=m.restoreWorkspace(JSON.stringify(parsed),'Free');assert.equal(blocked.state,null);assert(blocked.notice.includes('週頻'));
});
test('Pro settings remain untouched when a Free refresh cannot load them, and can later be explicitly restored',()=>{
 const storage=memoryStorage(),pro={...state('Pro'),frequency:'Weekly',period:'37W',trail:12,viewingDate:0};
 const raw=m.workspaceSnapshot(pro);assert(m.saveWorkspaceSnapshot(storage,raw));
 const free=m.readWorkspace(storage,'Free');assert.equal(free.state,null);assert(free.notice.includes('原設定仍保留'));assert.equal(storage.getItem(m.localKeys.workspace),raw);
 const restored=m.readWorkspace(storage,'Pro');assert.equal(restored.state.frequency,'Weekly');assert.equal(restored.state.period,'37W');assert.equal(restored.state.viewingDate,1);
});
test('over-capacity or cross-market restored lists are rejected as a whole rather than sliced or filtered',()=>{
 const raw=m.workspaceSnapshot(state('Pro'));assert.equal(m.restoreWorkspace(raw,'Anonymous').state,null);
 const parsed=JSON.parse(raw);parsed.analysis.currentList=['2330','5274'];assert.equal(m.restoreWorkspace(JSON.stringify(parsed),'Pro').state,null);assert.equal(parsed.analysis.currentList.length,2);
 assert.equal(m.workspaceSnapshot({...state('Free'),frequency:'Weekly',period:'37W',trail:12}),null);
});
test('malformed, incomplete, unknown and duplicate workspace data is rejected without throwing',()=>{
 for(const raw of ['{bad','null','[]','{"version":2,"analysis":{}}','{"version":1,"analysis":{}}'])assert.equal(m.restoreWorkspace(raw,'Free').state,null);
 for(const list of [['2330','2330'],['9999'],['2330',123]]){const parsed=JSON.parse(m.workspaceSnapshot(state()));parsed.analysis.currentList=list;assert.equal(m.restoreWorkspace(JSON.stringify(parsed),'Free').state,null)}
 const unavailable=m.readWorkspace({getItem(){throw Error('denied')}},'Free');assert.equal(unavailable.state,null);assert(unavailable.notice.includes('無法讀取'));
});
test('theme and filter persist independently of an invalid saved analysis',()=>{
 const storage=memoryStorage();m.saveUiPreferences(storage,'light','Improving');assert.deepEqual(m.readUiPreferences(storage),{theme:'light',filter:'Improving'});
 storage.setItem(m.localKeys.workspace,'bad');assert.equal(m.readWorkspace(storage,'Free').state,null);assert.equal(m.readUiPreferences(storage).theme,'light');
 storage.setItem(m.localKeys.ui,JSON.stringify({theme:'bad',filter:'bad'}));assert.deepEqual(m.readUiPreferences(storage),{theme:'dark',filter:'All'});
});
test('the two retained Free slot choices persist independently and invalid indices do not unlock a slot',()=>{
 const storage=memoryStorage();assert(m.saveRetainedSlots(storage,{watchlist:3,saved:1}));assert.deepEqual(m.readRetainedSlots(storage),{watchlist:3,saved:1});
 assert(m.saveRetainedSlots(storage,{watchlist:null,saved:null}));assert.deepEqual(m.readRetainedSlots(storage),{watchlist:null,saved:null});
 storage.setItem(m.localKeys.retained,JSON.stringify({watchlist:4,saved:-1}));assert.deepEqual(m.readRetainedSlots(storage),{watchlist:null,saved:null});
});
test('quota or storage errors fail gracefully without changing an existing workspace',()=>{
 const storage=memoryStorage(),raw=m.workspaceSnapshot(state());storage.setItem(m.localKeys.workspace,raw);
 const denied={getItem:storage.getItem,setItem(){throw Error('quota exceeded')}};
 assert.equal(m.saveWorkspaceSnapshot(denied,'new'),false);assert.equal(storage.getItem(m.localKeys.workspace),raw);
 assert.equal(m.saveUiPreferences(denied,'light','All'),false);assert.equal(m.saveRetainedSlots(denied,{watchlist:1,saved:1}),false);assert.equal(m.saveWorkspaceSnapshot(null,raw),false);
});
const renderWorkspaceWithStorage=storage=>{
 const prior=globalThis.window;
 try{globalThis.window={localStorage:storage};return render(m.Workstation,{})}finally{if(prior===undefined)delete globalThis.window;else globalThis.window=prior}
};
test('the actual workstation initializes from a legal stored list, settings, theme and filter',()=>{
 const storage=memoryStorage(),s={...state(),period:'120D',trail:10,currentList:['2330','2881'],viewingDate:2,selectedEntity:'2330'};
 m.saveWorkspaceSnapshot(storage,m.workspaceSnapshot(s));m.saveUiPreferences(storage,'light','Improving');
 const html=renderWorkspaceWithStorage(storage);
 assert(html.includes('data-theme="light"'));assert.match(html,/<option value="120D" selected="">/);assert.match(html,/<option selected="">Improving<\/option>/);
 assert(html.includes('2026-09-24'));assert(!html.includes('2026-09-15</button>'));assert(!html.includes('上次本機設定未載入'));assert(!html.includes('detail-title'));
});
test('the actual workstation shows a restore notice and stays Free for a stored Pro-only view',()=>{
 const storage=memoryStorage(),raw=m.workspaceSnapshot({...state('Pro'),frequency:'Weekly',period:'37W',trail:12,viewingDate:1});
 m.saveWorkspaceSnapshot(storage,raw);
 const html=renderWorkspaceWithStorage(storage);
 assert.match(html,/<option selected="">Free<\/option>/);assert(html.includes('上次本機設定未載入'));assert(html.includes('重試還原本機設定'));assert.equal(storage.getItem(m.localKeys.workspace),raw);
});
test('the actual workstation keeps a restored empty market list empty',()=>{
 const storage=memoryStorage();m.saveWorkspaceSnapshot(storage,m.workspaceSnapshot(m.updateAnalysis(state(),'market','TPEx')));
 const html=renderWorkspaceWithStorage(storage);assert(html.includes('尚未選取股票'));assert(!html.includes('class="stock-row'));assert.match(html,/<option selected="">TPEx<\/option>/);
});

// Synthetic entities stay in tests: no fake securities or extra market data enter the prototype.
const sourceFixture=()=>{
 const entities=Array.from({length:23},(_,i)=>({id:`TEST${i+1}`,name:`測試 ${i+1}`,market:'TWSE',sector:'測試產業',status:'data_unavailable',points:[]}));
 const ids=entities.map(entity=>entity.id),view={...state('Pro'),currentList:[...ids],viewingDate:0};
 return {entities,watchlists:[{name:'容量測試',market:'TWSE',ids:[...ids]}],savedView:()=>view,view,ids};
};
const retained={watchlist:0,saved:0};

test('oversized watchlists and stock views request a choice and never truncate or mutate the analysis/source',()=>{
 for(const kind of ['watchlist','saved']){
  const library=sourceFixture(),current=state(),before=JSON.stringify({current,library});
  const result=m.prepareSourceLoad(kind,0,current,retained,undefined,library);
  assert.equal(result.type,'choose');assert.equal(result.ids.length,23);assert.equal(result.limit,20);assert.equal(result.entities.length,23);
  assert.equal(JSON.stringify({current,library}),before);
 }
});
test('the chosen subset completely replaces the list in source order and leaves the source intact',()=>{
 for(const kind of ['watchlist','saved']){
  const library=sourceFixture(),result=m.prepareSourceLoad(kind,0,state(),retained,['TEST23','TEST2'],library);
  assert.equal(result.type,'ready');assert.deepEqual(result.state.currentList,['TEST2','TEST23']);
  assert.equal(library.watchlists[0].ids.length,23);assert.equal(library.view.currentList.length,23);assert(!result.state.currentList.includes('2330'));
 }
});
test('subset validation rejects over-capacity, repeated and outside-source IDs without quietly repairing them',()=>{
 const library=sourceFixture();
 for(const kind of ['watchlist','saved'])for(const ids of [library.ids.slice(0,21),['TEST2','TEST2'],['2330'],['UNKNOWN']]){
  const result=m.prepareSourceLoad(kind,0,state(),retained,ids,library);assert.equal(result.type,'blocked');
 }
 const exact=m.prepareSourceLoad('watchlist',0,state(),retained,library.ids.slice(0,20),library);assert.equal(exact.type,'ready');assert.equal(exact.state.currentList.length,20);
});
test('an explicit empty subset is legal and does not repopulate defaults',()=>{
 const result=m.prepareSourceLoad('watchlist',0,state(),retained,[],sourceFixture());assert.equal(result.type,'ready');assert.deepEqual(result.state.currentList,[]);
});
test('invalid saved settings are rejected before picking and cannot be unlocked by a smaller selection',()=>{
 for(const override of [{frequency:'Weekly',period:'52W',trail:10},{period:'137D'},{benchmarkType:'security',benchmark:'2330'}]){
  const library=sourceFixture();Object.assign(library.view,override);
  for(const selection of [undefined,['TEST1']])assert.equal(m.prepareSourceLoad('saved',0,state(),retained,selection,library).type,'blocked');
 }
});
test('a wrong-market or unknown member blocks the entire source even when the selected subset excludes it',()=>{
 for(const kind of ['watchlist','saved'])for(const bad of ['unknown','other-market']){
  const library=sourceFixture();if(bad==='unknown')library.entities.pop();else library.entities.at(-1).market='TPEx';
  for(const selection of [undefined,['TEST1']]){
   const result=m.prepareSourceLoad(kind,0,state(),retained,selection,library);assert.equal(result.type,'blocked');assert(result.issues.some(issue=>issue.includes('來源')));
  }
 }
});
test('slot and source permissions are rechecked on confirmation instead of trusting an earlier picker',()=>{
 const library=sourceFixture();assert.equal(m.prepareSourceLoad('watchlist',0,state(),retained,undefined,library).type,'choose');
 assert.equal(m.prepareSourceLoad('watchlist',0,state(),{watchlist:1,saved:0},['TEST1'],library).type,'blocked');
 assert.equal(m.prepareSourceLoad('watchlist',0,state('Anonymous'),retained,['TEST1'],library).type,'blocked');
 library.entities.at(-1).market='TPEx';assert.equal(m.prepareSourceLoad('watchlist',0,state(),retained,['TEST1'],library).type,'blocked');
});
test('invalid current analysis settings also prevent watchlist capacity picking',()=>{
 const library=sourceFixture(),current={...state(),frequency:'Weekly',period:'52W'};
 for(const selection of [undefined,['TEST1']])assert.equal(m.prepareSourceLoad('watchlist',0,current,retained,selection,library).type,'blocked');
});
test('Sector views resolve the entire market and never open a stock or industry subset picker',()=>{
 const library=sourceFixture();library.view.mode='Sector Move';library.view.currentList=['S1','UNKNOWN',...library.ids];
 const result=m.prepareSourceLoad('saved',0,state(),retained,undefined,library);
 assert.equal(result.type,'ready');assert.equal(result.state.mode,'Sector Move');assert.deepEqual(result.state.currentList,[]);assert.equal(result.state.benchmark,'TAIEX');
 assert.equal(m.prepareSourceLoad('saved',0,state(),retained,['S1'],library).type,'blocked');
 assert.equal(library.view.currentList[0],'S1');
});
test('normal built-in loads retain UI preferences, reset selection and load saved views at Latest',()=>{
 const current={...state(),filter:'Leading',selectedEntity:'2330',hoveredId:'2330'};
 const view=m.prepareSourceLoad('saved',0,current,retained);assert.equal(view.type,'ready');assert.equal(view.state.filter,'Leading');assert.equal(view.state.selectedEntity,null);assert.equal(view.state.hoveredId,null);assert.equal(view.state.viewingDate,9);
 const library=sourceFixture();library.view.currentList=['TEST1'];library.view.frequency='Weekly';library.view.period='52W';library.view.trail=10;
 const weekly=m.prepareSourceLoad('saved',0,state('Pro'),retained,undefined,library);assert.equal(weekly.type,'ready');assert.equal(weekly.state.viewingDate,m.weeklyDates.length-1);
 const list=m.prepareSourceLoad('watchlist',1,current,{...retained,watchlist:1});assert.equal(list.type,'ready');assert.deepEqual(list.state.currentList,m.demoWatchlists[1].ids);
});
test('watchlist imports deduplicate before capacity and support a valid new market without merging old stocks',()=>{
 const library=sourceFixture();library.watchlists[0].ids=Array(25).fill('TEST1');
 const dedup=m.prepareSourceLoad('watchlist',0,state(),retained,undefined,library);assert.equal(dedup.type,'ready');assert.deepEqual(dedup.state.currentList,['TEST1']);
 library.entities[0].market='TPEx';library.watchlists[0].market='TPEx';
 const result=m.prepareSourceLoad('watchlist',0,{...state(),period:'120D',viewingDate:3},retained,undefined,library);
 assert.equal(result.type,'ready');assert.equal(result.state.market,'TPEx');assert.equal(result.state.benchmark,'TPEX');assert.deepEqual(result.state.currentList,['TEST1']);assert.equal(result.state.period,'120D');assert.equal(result.state.viewingDate,3);
});
test('the picker starts without automatic choices and provides clear counts, search and cancellation',()=>{
 const html=render(m.StockSubsetPicker,{title:'容量測試',entities:sourceFixture().entities,limit:20,onApply:noop,onCancel:noop});
 assert.equal((html.match(/type="checkbox"/g)||[]).length,23);assert(!html.includes('checked=""'));assert(html.includes('已選 0 / 20 檔'));assert(html.includes('type="search"'));assert(html.includes('取消'));assert(html.includes('載入空清單'));assert(html.includes('來源內容不變'));
});

test('local libraries start from independent demo copies without automatically writing storage',()=>{
 const storage=memoryStorage(),first=m.readLocalLibrary(storage),second=m.createDemoLibrary();
 assert.equal(first.writable,true);assert.equal(first.raw,null);assert.equal(storage.getItem(m.libraryKey),null);assert.equal(first.library.watchlists.length,4);assert.equal(first.library.savedViews.length,2);
 first.library.watchlists[0].ids.pop();assert.equal(second.watchlists[0].ids.length,7);assert.equal(m.demoWatchlists[0].ids.length,7);
});
test('saving a watchlist changes only the chosen fixed slot and does not capture analysis settings',()=>{
 const library=m.createDemoLibrary(),current={...state('Pro'),currentList:['2330','2881'],period:'137D',trail:33,viewingDate:3,selectedEntity:'2330'};
 const before=JSON.stringify(library),result=m.editLocalLibrary(library,current,retained,{type:'save',kind:'watchlist',index:2});
 assert(result.ok);assert.deepEqual(result.library.watchlists[2],{name:'空白清單 3',market:'TWSE',ids:['2330','2881']});assert.deepEqual(result.library.savedViews,library.savedViews);assert.deepEqual(result.library.watchlists[0],library.watchlists[0]);assert.equal(JSON.stringify(library),before);
 current.currentList.pop();assert.equal(result.library.watchlists[2].ids.length,2);
});
test('an explicit library commit survives reload and loads its actual saved stocks rather than demo defaults',()=>{
 const storage=memoryStorage(),boot=m.readLocalLibrary(storage),edited=m.editLocalLibrary(boot.library,{...state(),currentList:['2881']},retained,{type:'save',kind:'watchlist',index:0});assert(edited.ok);
 assert.equal(storage.getItem(m.libraryKey),null);
 const committed=m.commitLocalLibrary(storage,boot.raw,edited.library);assert(committed.ok);
 const reloaded=m.readLocalLibrary(storage);assert.equal(reloaded.writable,true);assert.deepEqual(reloaded.library.watchlists[0].ids,['2881']);
 const loaded=m.prepareSourceLoad('watchlist',0,state(),retained,undefined,m.librarySources(reloaded.library));assert.equal(loaded.type,'ready');assert.deepEqual(loaded.state.currentList,['2881']);
 assert.equal(reloaded.raw,committed.raw);
});
test('every library mutation rejects locked or anonymous slots without changing existing contents',()=>{
 const library=m.createDemoLibrary(),before=JSON.stringify(library);
 for(const kind of ['watchlist','saved'])for(const action of [{type:'save',kind,index:1},{type:'clear',kind,index:1},{type:'rename',kind,index:1,name:'不能改'}]){
  assert.equal(m.editLocalLibrary(library,state(),retained,action).ok,false);assert.equal(m.editLocalLibrary(library,state('Anonymous'),retained,action).ok,false);
 }
 for(const action of [{type:'remove-stock',kind:'watchlist',index:1,id:'2454'},{type:'bind-market',kind:'watchlist',index:1,market:'TPEx'}])assert.equal(m.editLocalLibrary(library,state(),retained,action).ok,false);
 assert.equal(JSON.stringify(library),before);
});
test('clear keeps the fixed slot, name, market and Free choice and does not unlock another slot',()=>{
 const library=m.createDemoLibrary(),current=state(),choice={watchlist:1,saved:1},before=JSON.stringify(current);
 const watch=m.editLocalLibrary(library,current,choice,{type:'clear',kind:'watchlist',index:1});assert(watch.ok);assert.equal(watch.library.watchlists.length,4);assert.deepEqual(watch.library.watchlists[1].ids,[]);assert.equal(watch.library.watchlists[1].name,library.watchlists[1].name);assert.equal(watch.library.watchlists[1].market,'TWSE');
 assert.equal(m.editLocalLibrary(watch.library,current,choice,{type:'save',kind:'watchlist',index:0}).ok,false);
 const view=m.editLocalLibrary(library,current,choice,{type:'clear',kind:'saved',index:1});assert(view.ok);assert.equal(view.library.savedViews.length,2);assert.equal(view.library.savedViews[1].preset,null);
 assert.equal(m.prepareSourceLoad('saved',1,current,choice,undefined,m.librarySources(view.library)).type,'blocked');assert.equal(JSON.stringify(current),before);assert.deepEqual(choice,{watchlist:1,saved:1});
});
test('nonempty watchlists require explicit clearing and market rebinding before saving another market',()=>{
 const library=m.createDemoLibrary(),other=m.analysisDefaults('Free','TPEx');
 assert.equal(m.editLocalLibrary(library,other,retained,{type:'save',kind:'watchlist',index:0}).ok,false);
 assert.equal(m.editLocalLibrary(library,other,retained,{type:'bind-market',kind:'watchlist',index:0,market:'TPEx'}).ok,false);
 const cleared=m.editLocalLibrary(library,other,retained,{type:'clear',kind:'watchlist',index:0});assert(cleared.ok);
 const rebound=m.editLocalLibrary(cleared.library,other,retained,{type:'bind-market',kind:'watchlist',index:0,market:'TPEx'});assert(rebound.ok);
 const saved=m.editLocalLibrary(rebound.library,other,retained,{type:'save',kind:'watchlist',index:0});assert(saved.ok);assert.deepEqual(saved.library.watchlists[0].ids,['5274']);assert.equal(saved.library.watchlists[0].market,'TPEx');
});
test('removing a stored member changes the saved source only and can repair an invalid-market watchlist',()=>{
 const library=m.createDemoLibrary(),current=state();library.watchlists[0].ids.push('5274');
 assert.equal(m.prepareSourceLoad('watchlist',0,current,retained,undefined,m.librarySources(library)).type,'blocked');
 const edited=m.editLocalLibrary(library,current,retained,{type:'remove-stock',kind:'watchlist',index:0,id:'5274'});assert(edited.ok);assert.deepEqual(current.currentList,state().currentList);assert(library.watchlists[0].ids.includes('5274'));
 assert.equal(m.prepareSourceLoad('watchlist',0,current,retained,undefined,m.librarySources(edited.library)).type,'ready');
});
test('stock view persistence omits plan, dates and temporary interactions but keeps the exact valid preset',()=>{
 const current={...state('Pro'),frequency:'Weekly',period:'37W',trail:12,viewingDate:0,priceType:'Raw',currentList:['2330'],selectedEntity:'2330',filter:'Lagging',hoveredId:'2330',statusOverrides:{'2330':'stale'}};
 const edited=m.editLocalLibrary(m.createDemoLibrary(),current,retained,{type:'save',kind:'saved',index:1});assert(edited.ok);
 const preset=edited.library.savedViews[1].preset;
 assert.deepEqual(Object.keys(preset).sort(),['mode','market','benchmarkType','benchmark','frequency','period','trail','priceType','currentList'].sort());assert.equal(preset.period,'37W');assert.deepEqual(preset.currentList,['2330']);
 const storage=memoryStorage();assert(m.commitLocalLibrary(storage,null,edited.library).ok);const reloaded=m.readLocalLibrary(storage).library;
 assert.equal(m.prepareSourceLoad('saved',1,state(),{...retained,saved:1},undefined,m.librarySources(reloaded)).type,'blocked');
 const loaded=m.prepareSourceLoad('saved',1,{...state('Pro'),filter:'Improving'},retained,undefined,m.librarySources(reloaded));assert.equal(loaded.type,'ready');assert.equal(loaded.state.viewingDate,1);assert.equal(loaded.state.filter,'Improving');assert.equal(loaded.state.selectedEntity,null);assert.deepEqual(loaded.state.statusOverrides,{});
});
test('sector views never persist hidden stocks or a chosen industry subset',()=>{
 const current={...state('Pro'),mode:'Sector Move',currentList:['5274','S1'],selectedEntity:'S1'};
 const edited=m.editLocalLibrary(m.createDemoLibrary(),current,retained,{type:'save',kind:'saved',index:0});assert(edited.ok);assert(!('currentList' in edited.library.savedViews[0].preset));
 const loaded=m.prepareSourceLoad('saved',0,state(),retained,undefined,m.librarySources(edited.library));assert.equal(loaded.type,'ready');assert.equal(loaded.state.mode,'Sector Move');assert.deepEqual(loaded.state.currentList,[]);
});
test('invalid saved settings or stock identities cannot overwrite a valid slot, but watchlists ignore unrelated analysis settings',()=>{
 const library=m.createDemoLibrary(),before=JSON.stringify(library);
 for(const override of [{frequency:'Weekly',period:'52W'},{period:'137D'},{currentList:['5274']},{currentList:['UNKNOWN']}])assert.equal(m.editLocalLibrary(library,{...state(),...override},retained,{type:'save',kind:'saved',index:0}).ok,false);
 assert.equal(m.editLocalLibrary(library,{...state(),currentList:['5274']},retained,{type:'save',kind:'watchlist',index:0}).ok,false);
 assert.equal(m.editLocalLibrary(library,{...state(),mode:'Sector Move'},retained,{type:'save',kind:'watchlist',index:0}).ok,false);
 const onlyStocks=m.editLocalLibrary(library,{...state(),frequency:'Weekly',period:'52W'},retained,{type:'save',kind:'watchlist',index:0});assert(onlyStocks.ok);assert.equal(JSON.stringify(library),before);
});
test('renaming validates names and preserves the slot contents',()=>{
 const library=m.createDemoLibrary();for(const name of ['','  ','a'.repeat(41)])assert.equal(m.editLocalLibrary(library,state(),retained,{type:'rename',kind:'watchlist',index:0,name}).ok,false);
 const result=m.editLocalLibrary(library,state(),retained,{type:'rename',kind:'watchlist',index:0,name:'  我的台股  '});assert(result.ok);assert.equal(result.library.watchlists[0].name,'我的台股');assert.deepEqual(result.library.watchlists[0].ids,library.watchlists[0].ids);
});
test('corrupt local library data is retained and never silently replaced by demo records',()=>{
 for(const raw of ['invalid',JSON.stringify({version:2}),JSON.stringify({...m.createDemoLibrary(),watchlists:[]})]){
  const storage=memoryStorage();storage.setItem(m.libraryKey,raw);const read=m.readLocalLibrary(storage);assert.equal(read.writable,false);assert(read.notice.includes('原資料保留'));assert.equal(storage.getItem(m.libraryKey),raw);
 }
 const denied=m.readLocalLibrary({getItem(){throw Error('denied')}});assert.equal(denied.writable,false);
});
test('reading keeps unresolved source IDs for repair while ignoring forged permissions and UI in saved views',()=>{
 const storage=memoryStorage(),library=m.createDemoLibrary();library.watchlists[0].ids=['9999','5274'];Object.assign(library.savedViews[0].preset,{plan:'Pro',viewingDate:0,filter:'Lagging',selectedEntity:'2330'});storage.setItem(m.libraryKey,JSON.stringify(library));
 const read=m.readLocalLibrary(storage);assert(read.writable);assert.deepEqual(read.library.watchlists[0].ids,['9999','5274']);assert(!('plan' in read.library.savedViews[0].preset));assert(!('viewingDate' in read.library.savedViews[0].preset));
 assert.equal(m.prepareSourceLoad('watchlist',0,state(),retained,undefined,m.librarySources(read.library)).type,'blocked');
});
test('failed storage writes and stale tab revisions do not claim success or overwrite existing records',()=>{
 const storage=memoryStorage(),library=m.createDemoLibrary(),initial=m.commitLocalLibrary(storage,null,library);assert(initial.ok);
 const changed=structuredClone(library);changed.watchlists[0].name='另一分頁';const second=m.commitLocalLibrary(storage,initial.raw,changed);assert(second.ok);
 const stale=m.commitLocalLibrary(storage,initial.raw,library);assert.equal(stale.ok,false);assert(stale.notice.includes('另一分頁'));assert.equal(storage.getItem(m.libraryKey),second.raw);
 const denied={getItem:storage.getItem,setItem(){throw Error('quota')}};assert.equal(m.commitLocalLibrary(denied,second.raw,library).ok,false);assert.equal(storage.getItem(m.libraryKey),second.raw);assert.equal(m.commitLocalLibrary(null,null,library).ok,false);
});
test('drawer output uses actual stored names and settings, hides locked content and labels storage honestly',()=>{
 const library=m.createDemoLibrary();library.watchlists[0].name='我的台股';library.savedViews[1].name='私有檢視';library.savedViews[1].preset.period='37W';
 const props={state:state(),retained,library,onChoose:noop,onClose:noop,onRestore:noop,onLoadList:noop};
 const watch=render(m.Drawer,{...props,kind:'watchlist'});assert(watch.includes('我的台股'));assert(watch.includes('只保存在此瀏覽器'));assert(watch.includes('管理 我的台股'));assert(!watch.includes('模擬儲存'));
 const saved=render(m.Drawer,{...props,kind:'saved'});assert(saved.includes('私有檢視'));assert(!saved.includes('37W'));assert(!saved.includes('管理 私有檢視'));
 const blocked=render(m.Drawer,{...props,kind:'watchlist',libraryWritable:false,libraryNotice:'資料無法讀取'});assert(blocked.includes('資料無法讀取'));assert(disabled(button(blocked,'管理 我的台股')));
});
test('the slot editor exposes stored-stock removal and fixed-market rules without changing the chart area',()=>{
 const html=render(m.LibrarySlotEditor,{kind:'watchlist',index:0,library:m.createDemoLibrary(),state:state(),onEdit:noop});assert(html.includes('從已儲存清單移除 2330'));assert(html.includes('清空此格內容'));assert(html.includes('儲存目前清單至此格'));assert.match(html,/<select[^>]*disabled=""/);assert(!html.includes('RS Rotation'));
});
