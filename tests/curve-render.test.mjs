import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {createRequire} from 'node:module';
const bundled=await build({stdin:{contents:"export * from './components/twstock/safeCurve';export * from './components/twstock/chartOptions';export * from './components/twstock/chartRuntime';import {SVGRenderer} from 'echarts/renderers';import {echarts} from './components/twstock/chartRuntime';echarts.use([SVGRenderer]);",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'node',format:'cjs',logLevel:'silent'});const mod={exports:{}};new Function('require','module','exports',bundled.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);const m=mod.exports;
test('bounded curves preserve original vertices, exact axis crossings and gaps',()=>{
 const input=[[-2,-1],[1,2],[2,1],null,[3,2],[4,4]],snapshot=JSON.stringify(input),pieces=m.safeCurve(input);assert.equal(JSON.stringify(input),snapshot);assert.equal(pieces.filter(p=>p.move).length,2);
 assert.deepEqual(pieces.slice(0,3).map(p=>p.end),[[-1,0],[0,1],[1,2]]);
 for(const p of pieces)for(const c of [p.c1,p.c2])for(const axis of [0,1]){const sign=Math.sign(p.start[axis])||Math.sign(p.end[axis]);assert(sign?sign*c[axis]>=-1e-14:c[axis]===0)}
 for(const point of input.filter(Boolean))assert(pieces.some(p=>JSON.stringify(point)===JSON.stringify(p.start)||JSON.stringify(point)===JSON.stringify(p.end)));
 assert(pieces.some(p=>Math.abs((p.c1[0]-p.start[0])*(p.end[1]-p.start[1])-(p.c1[1]-p.start[1])*(p.end[0]-p.start[0]))>1e-9||Math.abs((p.c2[0]-p.start[0])*(p.end[1]-p.start[1])-(p.c2[1]-p.start[1])*(p.end[0]-p.start[0]))>1e-9));
 for(const points of [[[0,0],[0,0],[1,0],[-1,0]],[[1e-12,-1],[-1e-12,1]],[[2,1],[-1,-2],[1,2]]])for(const p of m.safeCurve(points))for(const v of [...p.start,...p.end,...p.c1,...p.c2])assert(Number.isFinite(v));
});
test('screen and SVG export render the same bounded cubic with original observation data',()=>{
 const points=[[-2,-1],[1,2],[2,1],null,[3,2],[4,4]],entity={id:'curve-stock',code:'2330',name:'Curve',kind:'stock'},props={theme:'dark',entities:[entity],paths:{'curve-stock':points},pointDates:{},selectedId:null,filter:'All',sourceLabel:'INPUT'},options=m.buildChartOptions(props,{x:[-3,5],y:[-3,5]}),line=options.series.find(s=>s.id.endsWith(':path'));assert.deepEqual(line.data,points.map(p=>p||[null,null]));assert.equal(options.series.filter(s=>s.id.includes(':gap')).length,1);
 const shape=line.renderItem({dataIndex:0},{coord:p=>p}).shape.pathData;assert.equal((shape.match(/M/g)||[]).length,2);assert(shape.includes('C'));assert.equal(line.renderItem({dataIndex:1},{coord:p=>p}),undefined);
 const chart=m.echarts.init(null,undefined,{renderer:'svg',ssr:true,width:800,height:600});try{chart.setOption({...options,animation:false});const svg=chart.renderToSVGString();assert(svg.includes('<path'));assert(/d="[^"]*C/.test(svg));}finally{chart.dispose()}
});

test('ordinary turns share continuous nonzero tangents rather than keeping polyline corners',()=>{
 const p=m.safeCurve([[1,1],[3,1],[3,3],[1,3]]);assert.equal(p.length,3);
 for(let i=1;i<p.length;i++){const a=p[i-1],b=p[i];const incoming=a.end.map((v,j)=>v-a.c2[j]),outgoing=b.c1.map((v,j)=>v-b.start[j]);assert(Math.hypot(...incoming)>0.1);for(const axis of [0,1])assert(Math.abs(incoming[axis]-outgoing[axis])<1e-12)}
 assert(p[0].c2[1]<1);assert(p[1].c1[0]>3);
});
