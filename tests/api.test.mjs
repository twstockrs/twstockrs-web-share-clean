import {test,after,before} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import path from 'node:path';
import http from 'node:http';
const bundle=await build({stdin:{contents:`export * from './server/app';export * from './shared/mockAnalysis';export * from './components/twstock/model';export * from './components/twstock/analysisClient';export * from './components/twstock/exportData';`,resolveDir:path.resolve('.'),loader:'ts'},bundle:true,write:false,format:'cjs',platform:'node',logLevel:'silent'});
const compiled={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);const m=compiled.exports;
const request=(changes={})=>({...m.createAnalysisRequest(m.analysisDefaults('Pro'),'test-request'),...changes});
let server,base;
before(async()=>{server=m.createMockServer({testOnlyMockAuth:true});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});base=`http://127.0.0.1:${server.address().port}`});
after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))});
const post=(body,headers={})=>fetch(base+'/api/v1/analyses',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify(body)});
const rawPost=(body,headers={})=>new Promise((resolve,reject)=>{const req=http.request(base+'/api/v1/analyses',{method:'POST',headers:{'Content-Type':'application/json',...headers}},response=>{let text='';response.setEncoding('utf8');response.on('data',chunk=>text+=chunk);response.on('end',()=>resolve({status:response.statusCode,headers:response.headers,value:JSON.parse(text)}))});req.on('error',reject);req.write(body);req.end()});

test('actual HTTP health explicitly identifies a local mock without authentication',async()=>{
 const response=await fetch(base+'/api/v1/health'),value=await response.json();assert.equal(response.status,200);assert.equal(value.source,'mock');assert.equal(value.authentication,false);assert.equal(value.contract_version,1);assert.equal(response.headers.get('cache-control'),'no-store');assert(value.request_id);assert.equal(response.headers.get('x-request-id'),value.request_id);
});
test('actual HTTP analysis is decoded and matches the established demo for every plan',async()=>{
 for(const plan of ['Anonymous','Free','Pro']){
  const state=m.analysisDefaults(plan),input=m.createAnalysisRequest(state,'plan-'+plan),response=await post(input),value=await response.json();assert.equal(response.status,200);
  const decoded=m.decodeAnalysisResponse(value,input);assert.deepEqual(decoded.data.entities.map(e=>e.id),state.currentList);
  for(const entity of decoded.data.entities)assert.deepEqual(decoded.data.samples[entity.id],m.visibleSamples(m.catalog.find(e=>e.id===entity.id),state));
  assert(value.entities.every(entity=>!('points' in entity)&&entity.samples.every(point=>point.price_date===null)));
 }
});
test('weekly, Raw and period transformations are supplied by the mock service',async()=>{
 const state={...m.analysisDefaults('Pro'),frequency:'Weekly',period:'37W',trail:12,priceType:'Raw',viewingDate:1};
 const input=m.createAnalysisRequest(state,'weekly'),response=await post(input),value=await response.json();assert.equal(response.status,200);const {data}=m.decodeAnalysisResponse(value,input);assert.deepEqual(data.samples['2330'],m.visibleSamples(m.catalog[0],state));assert.deepEqual(data.samples['2330'].map(p=>p.date),['2026-09-11','2026-09-18']);
});
test('sector requests deliver the entire market, and TPEx stale dates stay unchanged',async()=>{
 for(const market of ['TWSE','TPEx']){const input=request({mode:'Sector Move',market,benchmark:market==='TWSE'?'TAIEX':'TPEX',security_ids:[]});const response=await post(input);assert.equal(response.status,200);const value=await response.json();assert.deepEqual(value.entities.map(e=>e.id),m.sectorsForMarket(market).map(e=>e.id))}
 const response=await post(request({market:'TPEx',benchmark:'TPEX',security_ids:['5274']})),value=await response.json();assert.equal(value.entities[0].status,'stale');assert.equal(value.entities[0].samples.at(-1).point_date,'2026-09-22');assert.equal(value.viewing_date,'2026-09-24');
});
test('gaps, six statuses, self comparison and empty lists never fabricate zeros',async()=>{
 const input=request({security_ids:['2603','DEMO1','DEMO2','DEMO3','DEMO4']}),response=await post(input),value=await response.json();assert.equal(response.status,200);assert.equal(value.entities[0].samples.filter(p=>p.rs_level===null&&p.rs_momentum===null).length,2);assert(value.entities.slice(1).every(e=>e.samples.length===0));
 const self=await (await post(request({benchmark_type:'security',benchmark:'2330',security_ids:['2330']}))).json();assert.equal(self.entities[0].status,'no_result');assert.deepEqual(self.entities[0].samples,[]);
 assert.deepEqual((await (await post(request({security_ids:[]}))).json()).entities,[]);
 const overridden=await (await post(request({security_ids:['2330'],demo_status_overrides:{'2330':'stale'}}))).json();assert.equal(overridden.entities[0].status,'stale');assert.equal(overridden.entities[0].samples.at(-1).point_date,'2026-09-22');
});
test('server independently rejects illegal plans, parameters, dates, market and collection',async()=>{
 const invalid=[{mock_plan:'admin'},{mock_plan:['Pro']},{mock_plan:'Anonymous'},{frequency:'Hourly'},{frequency:'Weekly',period:60},{period:4},{period:241},{trail:61},{trail:5.5},{viewing_date:'2026-09-12'},{market:'TPEx'},{benchmark:'TPEX'},{security_ids:['2330','2330']},{security_ids:['9999']},{security_ids:['5274']},{mode:'Sector Move'},{demo_status_overrides:{'5274':'valid'}},{demo_status_overrides:{'2330':'unknown'}},{plan:'Pro'}];
 for(const changes of invalid){const response=await post(request(changes));assert.equal(response.status,422,JSON.stringify(changes));const value=await response.json();assert.equal(value.error.code,'INVALID_ANALYSIS');assert(value.error.request_id);assert(!value.entities)}
 const anon=m.createAnalysisRequest(m.analysisDefaults('Anonymous'),'anon');assert.equal((await post({...anon,price_type:'Raw'})).status,422);
 const free=m.createAnalysisRequest(m.analysisDefaults('Free'),'free');assert.equal((await post({...free,frequency:'Weekly',period:20,trail:5,viewing_date:'2026-09-18'})).status,422);
});
test('HTTP routing, malformed JSON, content type and oversized requests give bounded errors',async()=>{
 assert.equal((await fetch(base+'/api/v1/unknown')).status,404);
 const wrong=await fetch(base+'/api/v1/analyses');assert.equal(wrong.status,405);assert.equal(wrong.headers.get('allow'),'POST');
 assert.equal((await fetch(base+'/api/v1/health',{method:'POST'})).status,405);
 assert.equal((await fetch(base+'/api/v1/analyses',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'})).status,400);
 assert.equal((await post(request(),{'Content-Type':'text/plain'})).status,415);
 assert.equal((await post({padding:'x'.repeat(70_000)})).status,413);
 assert.equal((await rawPost(JSON.stringify({padding:'x'.repeat(70_000)}))).status,413);
});
test('local service rejects external origins, forged hosts and cross-site requests without CORS',async()=>{
 for(const headers of [{Origin:'https://unrelated.example'},{Origin:'null'},{'Sec-Fetch-Site':'cross-site'}]){const response=await post(request(),headers);assert.equal(response.status,403,JSON.stringify(headers));assert.equal(response.headers.get('access-control-allow-origin'),null)}
 const forged=await rawPost(JSON.stringify(request()),{Host:'unrelated.example'});assert.equal(forged.status,403);assert.equal(forged.headers['access-control-allow-origin'],undefined);
 assert.equal((await post(request(),{Origin:'http://127.0.0.1:5173'})).status,200);
});
test('client rejects mismatched, reordered, malformed, future and nonfinite response data',()=>{
 const input=request(),value=m.buildMockAnalysis(input,'id');
 const cases=[v=>v.contract_version=2,v=>v.source='real',v=>v.request_key='old',v=>v.client_request_id='old',v=>v.entities.reverse(),v=>v.entities[0].market='TPEx',v=>v.entities[0].samples[0].price_date='2026-09-11',v=>v.entities[0].samples[0].rs_level=Infinity,v=>v.entities[0].samples[0].rs_momentum=null,v=>v.entities[0].samples[0].point_date='2026-09-25',v=>v.entities[0].samples.reverse(),v=>v.entities[0].status='inactive'];
 for(const mutate of cases){const changed=structuredClone(value);mutate(changed);assert.throws(()=>m.decodeAnalysisResponse(changed,input),/格式不正確/)}
});
test('analysis identity excludes transient UI state but includes all data conditions',()=>{
 const state=m.analysisDefaults('Pro'),key=m.requestKey(m.createAnalysisRequest(state));
 assert.equal(m.requestKey(m.createAnalysisRequest({...state,filter:'Leading',selectedEntity:'2330',hoveredId:'2454'})),key);
 for(const changes of [{plan:'Free'},{market:'TPEx'},{mode:'Sector Move'},{period:'120D'},{trail:5},{priceType:'Raw'},{viewingDate:0},{benchmark:'0050'},{statusOverrides:{'2330':'stale'}},{currentList:['2330']}])assert.notEqual(m.requestKey(m.createAnalysisRequest({...state,...changes})),key);
 assert(!JSON.stringify(m.createAnalysisRequest(state)).includes('selectedEntity'));
});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
const responseFor=(options)=>new Response(JSON.stringify(m.buildMockAnalysis(JSON.parse(options.body),'server-id')),{status:200});
test('new client request aborts the old one and ignores out-of-order success even if transport ignores abort',async()=>{
 const pending=[];const client=new m.AnalysisClient((_url,options)=>{const d=deferred();pending.push({d,options});return d.promise});
 const old=client.load(request()),next=client.load(request({period:120}));assert.equal(pending[0].options.signal.aborted,true);
 pending[1].d.resolve(responseFor(pending[1].options));assert((await next).data.samples['2330'][0].point);
 pending[0].d.resolve(responseFor(pending[0].options));assert.equal(await old,null);
});
test('outdated failures and unmounted requests cannot become current errors',async()=>{
 const pending=[];const client=new m.AnalysisClient((_url,options)=>{const d=deferred();pending.push({d,options});return d.promise});
 const old=client.load(request()),next=client.load(request({trail:5}));pending[0].d.reject(Error('old failure'));assert.equal(await old,null);
 client.cancel();pending[1].d.resolve(responseFor(pending[1].options));assert.equal(await next,null);
});
test('default browser transport preserves the global fetch receiver',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=function(_url,options){assert.equal(this,globalThis);return Promise.resolve(responseFor(options))};
 try{assert((await new m.AnalysisClient().load(request())).data.entities.length)}finally{globalThis.fetch=original}
});
test('a successful response arriving after the deadline is rejected even when abort was ignored',async()=>{
 const aborted=deferred(),response=deferred();let options;
 const client=new m.AnalysisClient((_url,input)=>{options=input;input.signal.addEventListener('abort',()=>aborted.resolve(),{once:true});return response.promise},10);
 const loading=client.load(request());await aborted.promise;response.resolve(responseFor(options));await assert.rejects(loading,e=>e.code==='TIMEOUT');
});
test('client surfaces disconnect, timeout, HTTP validation and proxy HTML instead of falling back',async()=>{
 await assert.rejects(new m.AnalysisClient(async()=>{throw Error('offline')}).load(request()),e=>e.code==='SERVICE_UNAVAILABLE');
 await assert.rejects(new m.AnalysisClient(async()=>new Response('<html>proxy error</html>',{status:500})).load(request()),e=>e.code==='SERVICE_UNAVAILABLE');
 await assert.rejects(new m.AnalysisClient(async()=>new Response(JSON.stringify({error:{code:'INVALID_ANALYSIS',message:'資料日期不適用。'}}),{status:422})).load(request()),/資料日期不適用/);
 const client=new m.AnalysisClient((_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(Error('abort')),{once:true})),10);
 await assert.rejects(client.load(request()),e=>e.code==='TIMEOUT');
});
test('CSV consumes supplied server coordinates and retains full-trail, gaps and state rows',async()=>{
 const state=m.analysisDefaults('Pro'),input=m.createAnalysisRequest(state,'csv'),value=await (await post(input)).json(),{data}=m.decodeAnalysisResponse(value,input);
 const expected=m.buildCsvExport(state),actual=m.buildCsvExport(state,data);assert.deepEqual(actual.rows,expected.rows);assert.equal(actual.text,expected.text);assert(actual.filename.includes('mock-2026-09-v1-input-none-r1'));
 const changed=structuredClone(data);changed.samples['2330'][0].point=[123.456,789];const csv=m.buildCsvExport(state,changed);assert.equal(csv.rows[0][10],123.456);assert.equal(csv.rows[0][11],789);assert.equal(csv.rows[0].length,15);
 assert.throws(()=>m.buildCsvExport(state,{entities:data.entities,samples:{}}),/不一致/);
});
