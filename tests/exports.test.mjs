import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import path from 'node:path';
import React from 'react';
import * as echarts from 'echarts';
import {renderToStaticMarkup} from 'react-dom/server';

const bundle=await build({stdin:{contents:`export * from './components/twstock/model'; export * from './components/twstock/exportData'; export * from './components/twstock/pngExport'; export * from './components/twstock/chartOptions'; export * from './components/twstock/Controls';`,resolveDir:path.resolve('.'),loader:'tsx'},bundle:true,write:false,format:'cjs',platform:'node',jsx:'automatic',external:['react','react-dom','react/jsx-runtime'],logLevel:'silent'});
const compiled={exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);
const m=compiled.exports;
const pro=(overrides={})=>({...m.analysisDefaults('Pro'),statusOverrides:{},...overrides});
const snapshot={viewport:{x:[-8,8],y:[-8,8]},width:1100,height:600};
const render=(Component,props)=>renderToStaticMarkup(React.createElement(Component,props));
const noop=()=>{};

test('export functions recheck actual plan, invalid analysis and empty lists independently of buttons',()=>{
 assert.throws(()=>m.createExportContext(m.analysisDefaults('Anonymous'),'PNG'),/方案/);
 for(const plan of ['Anonymous','Free'])assert.throws(()=>m.buildCsvExport(m.analysisDefaults(plan)),/方案/);
 for(const format of ['PNG','CSV'])for(const override of [{currentList:[]},{currentList:['5274']},{period:'241D'},{benchmark:'TPEX'},{viewingDate:99}])assert.throws(()=>m.createExportContext(pro(override),format));
 assert.equal(m.createExportContext(m.analysisDefaults('Free'),'PNG').entities.length,7);
});
test('CSV uses exactly the fifteen specified columns with UTF-8 BOM, CRLF and DEMO filename',()=>{
 const result=m.buildCsvExport(pro({currentList:['2330']}));
 assert.deepEqual(m.csvColumns,['viewing_date','frequency','market','entity','benchmark','period','trail','price_type','point_date','price_date','rs_level','rs_momentum','quadrant','status','gap_before']);
 assert.equal(result.text.charCodeAt(0),0xfeff);assert.equal(result.text.slice(1).split('\r\n')[0],m.csvColumns.join(','));assert(result.text.endsWith('\r\n'));assert(result.rows.every(row=>row.length===15));assert.equal(result.filename,'TWStockRS-DEMO-Stock-TWSE-Daily-2026-09-24.csv');
});
test('CSV contains the full visible trail and keeps current-list grouping and chronological point order',()=>{
 const result=m.buildCsvExport(pro({currentList:['2881','2330']}));
 assert.equal(result.rows.length,20);assert(result.rows.slice(0,10).every(row=>row[3]==='2881富邦金'));assert(result.rows.slice(10).every(row=>row[3]==='2330台積電'));
 assert.deepEqual(result.rows.slice(10).map(row=>row[8]),m.dates);assert(result.rows.every(row=>row[6]===20));
});
test('CSV ignores quadrant filtering, selection and hover and never reduces output to five markers',()=>{
 const original=m.buildCsvExport(pro());
 const filtered=m.buildCsvExport(pro({filter:'Leading',selectedEntity:'2330',hoveredId:'2330'}));
 assert.equal(filtered.text,original.text);assert.equal(filtered.rows.filter(row=>row[3]==='2330台積電').length,10);
});
test('CSV exports only points within the requested trail and viewing endpoint',()=>{
 const result=m.buildCsvExport(pro({currentList:['2330'],trail:5,viewingDate:6}));
 assert.equal(result.rows.length,5);assert.deepEqual(result.rows.map(row=>row[8]),m.dates.slice(2,7));assert(result.rows.every(row=>row[0]===m.dates[6]));assert.equal(result.rows[0][14],'');assert(result.rows.slice(1).every(row=>row[14]===false));
});
test('CSV preserves a real gap without inserting dashed-line points or fake dates',()=>{
 const result=m.buildCsvExport(pro({currentList:['2603']}));
 assert.equal(result.rows.length,8);assert(!result.rows.some(row=>['2026-09-17','2026-09-18'].includes(row[8])));
 assert.equal(result.rows.find(row=>row[8]==='2026-09-21')[14],true);assert.equal(result.rows[0][14],'');assert.equal(result.rows.at(-1)[14],false);
});
test('a missing current endpoint adds an empty status row after existing valid historical points',()=>{
 const result=m.buildCsvExport(pro({currentList:['2603'],viewingDate:5}));
 assert.equal(result.rows.length,5);assert(result.rows.slice(0,-1).every(row=>row[13]==='valid'));
 assert.equal(result.rows.at(-1)[0],'2026-09-18');assert.equal(result.rows.at(-1)[13],'data_unavailable');assert.deepEqual(result.rows.at(-1).slice(8,13),['','','','','']);assert.equal(result.rows.at(-1)[14],'');
});
test('zero-point entities keep exactly one blank status row instead of fake zero values',()=>{
 const result=m.buildCsvExport(pro({currentList:['DEMO1','DEMO2','DEMO3','DEMO4']}));
 assert.equal(result.rows.length,4);assert.deepEqual(result.rows.map(row=>row[13]),['insufficient_history','data_unavailable','no_result','inactive']);
 for(const row of result.rows){assert.deepEqual(row.slice(8,13),['','','','','']);assert.equal(row[14],'')}
});
test('CSV self-comparison preserves the entity with a no-result row and the actual benchmark label',()=>{
 const result=m.buildCsvExport(pro({currentList:['2330'],benchmarkType:'security',benchmark:'2330'}));
 assert.equal(result.rows.length,1);assert.equal(result.rows[0][3],'2330台積電');assert.equal(result.rows[0][4],'2330台積電');assert.equal(result.rows[0][13],'no_result');assert.equal(result.rows[0][10],'');
 const etf=m.buildCsvExport(pro({currentList:['2330'],benchmarkType:'security',benchmark:'0050'}));assert.equal(etf.rows[0][4],'0050元大台灣50');
});
test('stale applies only to the final older point and never duplicates the viewing-date row',()=>{
 const current={...m.analysisDefaults('Pro','TPEx'),currentList:['5274']};
 const result=m.buildCsvExport(current);assert.equal(result.rows.length,8);assert.equal(result.rows.at(-1)[8],'2026-09-22');assert.equal(result.rows.at(-1)[13],'stale');assert(result.rows.slice(0,-1).every(row=>row[13]==='valid'));
 const sameDate=m.buildCsvExport({...current,viewingDate:0});assert.equal(sameDate.rows.length,1);assert.equal(sameDate.rows[0][13],'valid');
});
test('weekly CSV contains only completed sample week endpoints and leaves unknown price dates empty',()=>{
 const result=m.buildCsvExport(pro({currentList:['2330'],frequency:'Weekly',period:'52W',trail:10,viewingDate:1}));
 assert.deepEqual(result.rows.map(row=>row[8]),m.weeklyDates);assert(result.rows.every(row=>row[9]===''&&row[1]==='Weekly'&&row[5]==='52W'));assert.equal(result.rows[0][10],-1.8);assert.equal(result.rows[0][11],2.8*.8);
});
test('Sector CSV contains all current market industries and never expands their component stocks',()=>{
 const current=pro({mode:'Sector Move',filter:'Leading'}),result=m.buildCsvExport(current);
 assert.equal(result.rows.length,80);assert.deepEqual([...new Set(result.rows.map(row=>row[3]))],m.sectorsForMarket('TWSE').map(entity=>entity.name));assert(!result.text.includes('2330台積電'));
 const other=m.buildCsvExport({...m.analysisDefaults('Pro','TPEx'),mode:'Sector Move'});assert.equal(other.rows.length,10);assert.equal(other.rows[0][4],'櫃買指數');
});
test('CSV safely quotes Chinese names, commas, quotes and newlines while preserving numeric negatives',()=>{
 assert.equal(m.csvCell('台積電,甲"乙\n丙'),'"台積電,甲""乙\n丙"');assert.equal(m.csvCell(-1.3),'-1.3');assert.equal(m.csvCell(0),'0');assert.equal(m.csvCell('0050'),'0050');assert.equal(m.csvCell('=1+1'),"'=1+1");assert.throws(()=>m.csvCell(Infinity));assert.throws(()=>m.csvCell(NaN));
});
test('PNG context copies analysis state and signatures reject changed settings but ignore hover',()=>{
 const current=pro(),context=m.createExportContext(current,'PNG');current.currentList.pop();current.statusOverrides['2330']='inactive';assert.equal(context.state.currentList.length,7);assert.deepEqual(context.state.statusOverrides,{});
 const base=pro(),key=m.exportSignature(base,'PNG','dark');assert.equal(m.exportSignature({...base,hoveredId:'2330'},'PNG','dark'),key);assert.notEqual(m.exportSignature({...base,period:'120D'},'PNG','dark'),key);assert.notEqual(m.exportSignature(base,'PNG','light'),key);
 assert.notEqual(m.exportSignature({...base,plan:'Anonymous'},'PNG','dark'),key);
 assert.equal(m.exportSignature({...base,filter:'Leading'},'CSV','light'),m.exportSignature(base,'CSV','dark'));
});
test('PNG renders real chart paths, metadata, four quadrant labels, legend and a persistent DEMO notice',()=>{
 const result=m.buildPngSvg(m.createExportContext(pro(),'PNG'),'dark',snapshot);
 assert.equal(result.width,1100);assert.equal(result.height,792);assert(result.svg.includes('<path'));assert(result.svg.includes('RS Rotation'));assert(result.svg.includes('2026-09-24'));assert(result.svg.includes('非真實行情與計算結果'));assert(!result.svg.includes('<script'));
 assert.doesNotMatch(result.svg,/style="[^"]*font-family:"/,'Quoted font families must not break SVG attribute syntax');
 for(const label of ['IMPROVING','LEADING','LAGGING','WEAKENING','2330','2454'])assert(result.svg.includes(label));
});
test('PNG supports light and dark backgrounds and renders Sector labels from the actual source',()=>{
 const context=m.createExportContext(pro({mode:'Sector Move'}),'PNG');
 const light=m.buildPngSvg(context,'light',snapshot),dark=m.buildPngSvg(context,'dark',snapshot);
 assert(light.svg.includes('fill="#ffffff"'));assert(dark.svg.includes('fill="#131c27"'));assert(light.svg.includes('半'));assert(light.svg.includes('導'));assert(light.svg.includes('Sector Move'));
});
test('PNG preserves the provided manual coordinate range and quadrant filter while CSV stays complete',()=>{
 const current=pro({filter:'Leading'}),context=m.createExportContext(current,'PNG');
 const points=Object.fromEntries(context.entities.map(entity=>[entity.id,m.visibleSamples(entity,current)]));
 const props={theme:'dark',entities:context.entities,paths:Object.fromEntries(Object.entries(points).map(([id,items])=>[id,items.map(item=>item.point)])),pointDates:Object.fromEntries(Object.entries(points).map(([id,items])=>[id,items.map(item=>item.date)])),selectedId:null,hoveredId:null,filter:'Leading',viewingDate:context.viewingDate,onSelect:noop,onClearSelection:noop,onHover:noop,viewportAction:{type:'export',key:0}};
 const option=m.buildChartOptions(props,{x:[20,40],y:[-15,5]});assert.equal(option.xAxis.min,20);assert.equal(option.xAxis.max,40);assert.equal(option.yAxis.min,-15);assert.equal(option.yAxis.max,5);assert.deepEqual(option.series.filter(series=>series.id.endsWith(':path')).map(series=>series.id),['entity:2330:path','entity:2454:path']);
 const image=m.buildPngSvg(context,'dark',snapshot);assert(image.svg.includes('2 條可顯示路徑'));assert.equal(m.buildCsvExport(current).rows.length,68);
});
test('PNG shows an honest empty-path message for unavailable results and never produces fake paths',()=>{
 const result=m.buildPngSvg(m.createExportContext(pro({currentList:['DEMO1']}),'PNG'),'dark',snapshot);
 assert(result.svg.includes('目前沒有可顯示的路徑'));assert(result.svg.includes('0 條可顯示路徑'));assert(result.svg.includes('DEMO'));
});
test('PNG escapes benchmark text and rejects malformed or unbounded capture dimensions',()=>{
 const original=m.catalog[0].name;
 try{m.catalog[0].name='甲&乙<測試>';const image=m.buildPngSvg(m.createExportContext(pro({benchmarkType:'security',benchmark:'2330'}),'PNG'),'dark',snapshot);assert(image.svg.includes('甲&amp;乙&lt;測試&gt;'));assert(!image.svg.includes('甲&乙<測試>'))}finally{m.catalog[0].name=original}
 for(const change of [{width:NaN},{height:0},{viewport:{x:[2,2],y:[-2,2]}},{viewport:{x:[-2,2],y:[-Infinity,2]}}])assert.throws(()=>m.buildPngSvg(m.createExportContext(pro(),'PNG'),'dark',{...snapshot,...change}),/視野/);
});
test('shared chart options retain the approved five markers and selection styling',()=>{
 const current=pro({currentList:['2330','2881']}),entities=m.createExportContext(current,'PNG').entities,samples=Object.fromEntries(entities.map(entity=>[entity.id,m.visibleSamples(entity,current)]));
 const props={theme:'dark',entities,paths:Object.fromEntries(Object.entries(samples).map(([id,items])=>[id,items.map(item=>item.point)])),pointDates:Object.fromEntries(Object.entries(samples).map(([id,items])=>[id,items.map(item=>item.date)])),selectedId:'2330',hoveredId:null,filter:'All',viewingDate:'2026-09-24',onSelect:noop,onClearSelection:noop,onHover:noop,viewportAction:{type:'export',key:0}};
 const options=m.buildChartOptions(props,snapshot.viewport),series=options.series.find(series=>series.id==='entity:2330:path');const markers=options.series.find(series=>series.id==='entity:2330:markers');assert.equal(markers.data.length,5);assert.equal(markers.data[0].symbolSize,5);assert.equal(markers.data.at(-1).symbolSize,11);assert.equal(series.showSymbol,false);assert.deepEqual(series.data,props.paths['2330']);assert.equal(series.lineStyle.width,3);
});

test('overlapping latest labels do not steal the preceding historical marker hover',()=>{
 for(const theme of ['dark','light'])for(const sector of [false,true]){
  const entity=sector?m.sectors[4]:m.catalog.find(entity=>entity.id==='2603');
  const current=pro({trail:5}),samples=m.visibleSamples(entity,current);
  const props={theme,entities:[entity],paths:{[entity.id]:samples.map(sample=>sample.point)},pointDates:{[entity.id]:samples.map(sample=>sample.date)},selectedId:null,hoveredId:null,filter:'All',viewingDate:'2026-09-24',onSelect:noop,onClearSelection:noop,onHover:noop,viewportAction:{type:'test',key:0}};
  const chart=echarts.init(null,null,{renderer:'svg',ssr:true,width:980,height:405});
  try{
   chart.setOption({...m.buildChartOptions(props,{x:[-7.5,7.5],y:[-7.5,7.5]}),animation:false});
   chart.renderToSVGString();
   const index=samples.findIndex(sample=>sample.date==='2026-09-23');
   const pixel=chart.convertToPixel({seriesIndex:1},samples[index].point);
   let hovered;
   chart.on('mouseover',event=>{hovered=event});
   chart.getZr().handler.mousemove({zrX:pixel[0],zrY:pixel[1]});
   assert.equal(hovered?.data.originalIndex,index,`${theme} ${entity.id}: the marker, not the latest label, must receive hover`);
   assert.equal(hovered.data.date,'2026-09-23');
   assert.deepEqual(hovered.value,[-5.1,-3.4]);
  }finally{chart.dispose()}
 }
});
test('export controls prevent duplicate downloads without mislabeling imported data as demos',()=>{
 const html=render(m.ExportControls,{plan:'Pro',blocked:false,empty:false,busy:true,onOpen:noop,onExport:noop});
 for(const label of ['PNG','CSV'])assert.match(html,new RegExp(`<button[^>]*disabled=""[^>]*aria-label="${label}"|<button[^>]*aria-label="${label}"[^>]*disabled=""`));
 assert(html.includes('aria-busy="true"'));assert(!html.includes('DEMO 示範資料'));assert(html.includes('下載 CSV 完整軌跡'));
});
test('Pro can select Weekly in Sector Move as specified, while Free still cannot',()=>{
 for(const plan of ['Free','Pro']){const html=render(m.AnalysisControls,{state:{...m.analysisDefaults(plan),mode:'Sector Move'},update:noop});const weekly=html.match(/<option value="Weekly"[^>]*>/)[0];assert.equal(weekly.includes('disabled=""'),plan!=='Pro')}
});
