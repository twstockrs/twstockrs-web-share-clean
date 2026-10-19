import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {createRequire} from 'node:module';import React from 'react';import {renderToStaticMarkup} from 'react-dom/server';
const b=await build({stdin:{contents:"export * from './components/twstock/model';export * from './components/twstock/exportData';export * from './components/twstock/chartOptions';export * from './components/twstock/chartRuntime';export {default as HelpDialog} from './components/twstock/HelpDialog';import {SVGRenderer} from 'echarts/renderers';import {echarts} from './components/twstock/chartRuntime';echarts.use([SVGRenderer]);",resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',external:['react','react/jsx-runtime'],logLevel:'silent'}),mod={exports:{}};
new Function('require','module','exports',b.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);const m=mod.exports;
function example(market='TWSE'){
 const catalog=Array.from({length:101},(_,i)=>({id:'stable-'+i,code:String(2300+i),name:'測試股票'+i,market,sector:'半導體業',kind:'stock',status:i===1?'insufficient_history':i===2?'inactive':'valid',points:[],searchable:true}));
 const runtime={market,input:{market},dataset_kind:'test',Daily:['2023-06-30','2023-07-03'],Weekly:[],catalog,sectors:[],market_benchmark:'source-market-'+market};
 const state={...m.analysisDefaults('Pro',market),runtime,currentList:catalog.slice(0,3).map(e=>e.id),viewingDate:1};
 const data={source:'computed',entities:catalog.slice(0,3),samples:{'stable-0':[{date:'2023-07-03',priceDate:'2023-07-03',point:[1,2],benchmarkId:runtime.market_benchmark}],'stable-1':[],'stable-2':[]}};
 return {state,data,runtime};
}
test('CSV market name agrees across valid, insufficient and inactive rows on both markets',()=>{
 for(const market of ['TWSE','TPEx']){const {state,data}=example(market),before=structuredClone(data),csv=m.buildCsvExport(state,data);assert.deepEqual([...new Set(csv.rows.map(r=>r[4]))],[market==='TWSE'?'加權指數':'櫃買指數']);assert.deepEqual(csv.rows.map(r=>r[13]),['valid','insufficient_history','inactive']);assert.equal(csv.rows[0][9],'2023-07-03');assert(csv.rows.slice(1).every(r=>r.slice(8,13).every(v=>v==='')));assert.deepEqual(data,before);}
});
test('CSV keeps historical per-point industry benchmarks rather than relabeling the whole path',()=>{
 const {state,data,runtime}=example();runtime.sectors=[{id:'twse:sector:16',name:'觀光事業',market:'TWSE',kind:'sector',sector:'觀光事業',status:'valid',points:[]},{id:'twse:sector:24',name:'半導體業',market:'TWSE',kind:'sector',sector:'半導體業',status:'valid',points:[]}];
 state.benchmarkType='sector';state.benchmark='twse:sector:24';state.currentList=['stable-0'];data.entities=data.entities.slice(0,1);data.samples['stable-0']=[{date:'2023-06-30',priceDate:'2023-06-30',point:[-1,2],benchmarkId:'twse:sector:16'},{date:'2023-07-03',priceDate:'2023-07-03',point:[1,2],benchmarkId:'twse:sector:24'}];
 assert.deepEqual(m.buildCsvExport(state,data).rows.map(r=>r[4]),['觀光事業','半導體業']);
 data.samples['stable-0'][1].benchmarkId='source-unknown';assert.equal(m.buildCsvExport(state,data).rows[1][4],'source-unknown');
});
test('CSV security names agree for points and empty status rows',()=>{const {state,data}=example();state.benchmarkType='security';state.benchmark='stable-10';data.samples['stable-0'][0].benchmarkId='stable-10';assert.deepEqual([...new Set(m.buildCsvExport(state,data).rows.map(r=>r[4]))],['2310測試股票10']);});
test('full lists reject duplicates before capacity and user notices never expose stable IDs',()=>{
 const {state,runtime}=example();state.currentList=runtime.catalog.slice(0,100).map(e=>e.id);
 for(const stable of [false,true]){const result=m.classifyStockInput([stable?'stable-0':'2300',stable?'stable-100':'2400'],state,stable);assert.deepEqual(result.accepted,[]);assert.match(result.rejected[0],/2300 測試股票0.*重複/);assert.doesNotMatch(result.rejected[0],/容量/);assert.match(result.rejected[1],/2400 測試股票100.*容量/);assert(result.rejected.every(s=>!s.includes('stable-')));}
 state.currentList=[];const result=m.classifyStockInput(['stable-0','stable-0','unknown-private-uuid'],state,true);assert.deepEqual(result.accepted,['stable-0']);assert.match(result.rejected[0],/重複/);assert(result.rejected.every(s=>!s.includes('stable-')&&!s.includes('unknown-private-uuid')));
});
test('help describes login, resume playback and actual price dates consistently',()=>{for(const topic of ['usage','storage','csv','data']){const html=renderToStaticMarkup(React.createElement(m.HelpDialog,{initialTopic:topic,onClose(){}}));assert.doesNotMatch(html,/沒有登入與收費|從最早日期重新開始|有效座標的 price_date 也留空/);if(topic==='usage')assert.match(html,/接續原進度/);if(topic==='csv')assert.match(html,/依來源紀錄輸出/);}});
test('dense charts keep every path and true marker while visible labels do not overlap',()=>{
 for(const width of [375,1100])for(const selectedId of [null,'dense-99']){
  const entities=Array.from({length:100},(_,i)=>({id:'dense-'+i,code:String(2300+i),name:'密集'+i,kind:'stock',status:'valid',market:'TWSE',sector:'半導體業',points:[]}));
  const paths=Object.fromEntries(entities.map((e,i)=>[e.id,[[i/1000,-.1],[i/1000,0]]]));
  const props={theme:'dark',entities,paths,pointDates:Object.fromEntries(entities.map(e=>[e.id,['2026-10-15','2026-10-16']])),selectedId,hoveredId:null,filter:'All',viewingDate:'2026-10-16'};
  const options=m.buildChartOptions(props,{x:[-1,1],y:[-1,1]}),chart=m.echarts.init(null,null,{renderer:'svg',ssr:true,width,height:500});
  try{chart.setOption({...options,animation:false});chart.renderToSVGString();assert.equal(options.series.filter(s=>s.id.endsWith(':path')).length,100);const rects=[];for(let index=0;index<options.series.length;index++){if(!options.series[index].id.endsWith(':markers'))continue;const data=chart.getModel().getSeriesByIndex(index).getData(),el=data.getItemGraphicEl(data.count()-1),text=el?.getTextContent()||el?.children?.().map(child=>child.getTextContent()).find(Boolean);if(selectedId&&options.series[index].id==='entity:'+encodeURIComponent(selectedId)+':markers')assert(text&&!text.ignore&&!text.invisible,'selected label must remain visible');if(!text||text.ignore||text.invisible)continue;const rect=text.getBoundingRect().clone();rect.applyTransform(text.getComputedTransform());rects.push(rect);}assert(rects.length>0);for(let i=0;i<rects.length;i++)for(let j=0;j<i;j++){const a=rects[i],b=rects[j];assert(!(a.x<b.x+b.width-.2&&a.x+a.width>b.x+.2&&a.y<b.y+b.height-.2&&a.y+a.height>b.y+.2),'visible labels overlap '+width+' '+selectedId);}}
  finally{chart.dispose()}
 }
});
