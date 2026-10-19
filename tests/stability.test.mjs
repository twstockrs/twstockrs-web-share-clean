import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,mkdirSync,existsSync,rmSync,copyFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {Latencies,memoryTrend,evaluateStability,stabilityLimits} from '../scripts/stability-policy.mjs';
import {parseOptions,runStability} from '../scripts/stability-check.mjs';
import {instrumentHostFixture,fixtureDiagnostics} from './host-fixture-diagnostics.mjs';

function accepted() {
    return {warmup:{elapsed_ms:300000,client_cycles:[100,100,100,100,100]},mode:'long',elapsed_ms:3_600_000,instances:['a'],failures:[],client_cycles:[100,100,100,100,100],coverage:{daily:400,weekly:100,sector:100,playback:20,library_edit:30,library_restore:5,exports:20,context:10},health:{count:1800,failed:0,p95_ms:30,max_ms:100},requests:Object.fromEntries(['analyses','playback','library/edit','library/restore','exports/authorize','analysis-context'].map(k=>[k,{count:10,failed:0,p95_ms:100}])),samples:Array.from({length:100},(_,i)=>({rss_bytes:600*1024**2,monitoring:{available:true,stale:false,fault:null,active_incidents:0}})),quiet_windows:Array.from({length:7},(_,i)=>({elapsed_ms:i*600_000,rss_bytes:600*1024**2,instance:'a'})),final_queue:{completed:620,failed:0,timed_out:0,rejected:0,cancelled:0,running:0,queued:0},backups:Array.from({length:4},()=>({status:'success'})),restore:{passed:true},recovery:{restart:{passed:true},child_crash:{passed:true},manager_restart:{passed:true}},integrity:{passed:true},clean_shutdown:true};
}

test('long-run gate needs a real hour, adequate operations and actual recovery evidence',()=>{
    const valid=accepted();assert.equal(evaluateStability(valid).status,'passed');
    const scenarios=[r=>r.elapsed_ms--,r=>r.client_cycles[2]=99,r=>r.coverage.playback=19,r=>r.health.count=1499,r=>r.requests={},r=>r.backups.pop(),r=>r.restore.passed=false,r=>delete r.recovery.child_crash,r=>r.integrity.passed=false,r=>r.clean_shutdown=false];
    for(const mutate of scenarios){const r=accepted();mutate(r);assert.equal(evaluateStability(r).status,'failed')}
});

test('smoke acceptance never becomes long-run acceptance even with hour-sized counters',()=>{
    const r=accepted();r.mode='smoke';const result=evaluateStability(r);assert.equal(result.status,'smoke_passed');assert.equal(result.checks.real_hour,false);
    r.failures.push({action:'analysis'});assert.equal(evaluateStability(r).status,'failed');
});

test('parallel warmup is additional real time and cannot replace any part of the measured hour',()=>{
    const r=accepted();r.warmup.elapsed_ms=299999;assert.equal(evaluateStability(r).checks.parallel_warmup_completed,false);
    r.warmup.elapsed_ms=300000;r.warmup.client_cycles[3]=19;assert.equal(evaluateStability(r).checks.parallel_warmup_completed,false);
    r.warmup.client_cycles[3]=100;r.elapsed_ms=3300000;assert.equal(evaluateStability(r).checks.real_hour,false);
    delete r.warmup;assert.equal(evaluateStability(r).checks.parallel_warmup_completed,false);
});

test('latency includes failed and worst requests without an ever-growing sample array',()=>{
    const h=new Latencies(),size=h.buckets.byteLength;
    for(let i=0;i<100_000;i++)h.add(12.1,20);
    h.add(65_000,0,true);assert.equal(h.buckets.byteLength,size);assert.equal(h.summary().failed,1);assert.equal(h.summary().count,100_001);assert.equal(h.summary().p95_ms,13);assert.equal(h.summary().max_ms,65_000);assert.equal(h.summary().bytes,2_000_000);
    const empty=new Latencies();assert.equal(empty.summary().p95_ms,null);assert.throws(()=>empty.add(NaN));assert.throws(()=>empty.add(-1));assert.throws(()=>empty.add(1,-1));
});

test('memory gates distinguish a flat process from slow leakage and forbid mixed restart baselines',()=>{
    const r=accepted();assert.equal(memoryTrend(r.quiet_windows).slope_bytes_per_minute,0);
    for(const row of r.quiet_windows)row.rss_bytes+=row.elapsed_ms/60_000*5*1024**2;
    assert.equal(evaluateStability(r).checks.quiet_memory_bounded,false);
    r.quiet_windows[3].instance='new';assert.throws(()=>memoryTrend(r.quiet_windows),/uninterrupted/);
    r.quiet_windows[3].instance='a';r.quiet_windows[3].elapsed_ms=r.quiet_windows[2].elapsed_ms;assert.throws(()=>memoryTrend(r.quiet_windows));
    assert.equal(memoryTrend([]).sufficient,false);
});

test('quiet-growth, absolute memory and monitoring are independent gates',()=>{
    const r=accepted();r.samples[20].rss_bytes=stabilityLimits.rss_bytes;assert.equal(evaluateStability(r).checks.rss_bounded,false);
    r.samples[20].rss_bytes=600*1024**2;r.samples[0].monitoring.stale=true;assert.equal(evaluateStability(r).checks.monitoring_healthy,false);
    r.samples[0].monitoring.stale=false;r.quiet_windows.at(-1).rss_bytes+=stabilityLimits.quiet_growth_bytes+1;assert.equal(evaluateStability(r).checks.quiet_memory_bounded,false);
});

test('queue errors, incomplete work, slow health and failed requests cannot be averaged away',()=>{
    const scenarios=[r=>r.final_queue.failed=1,r=>r.final_queue.timed_out=1,r=>r.final_queue.rejected=1,r=>r.final_queue.queued=1,r=>r.final_queue.running=1,r=>r.final_queue.completed=619,r=>r.health.max_ms=5000,r=>r.health.p95_ms=750,r=>r.requests.analyses.failed=1,r=>r.failures.push({action:'bad'}),r=>r.instances.push('unexpected-restart')];
    for(const mutate of scenarios){const r=accepted();mutate(r);assert.equal(evaluateStability(r).status,'failed')}
});

test('CLI refuses short long-run durations and existing files before creating anything',()=>{
    const area=mkdtempSync(path.join(tmpdir(),'twrs-stab-options-'));
    try{
        const release=path.join(area,'a.twrsrelease'),launcher=path.join(area,'host.mjs');writeFileSync(release,'test');writeFileSync(launcher,'test');
        const args=['--area',path.join(area,'new'),'--report',path.join(area,'report.json'),'--release',release,'--launcher',launcher];
        assert.equal(parseOptions([...args]).duration_ms,3_600_000);
        assert.equal(parseOptions([...args,'--smoke-seconds','10']).mode,'smoke');
        for(const tail of [['--minutes','59'],['--minutes','241'],['--minutes','60.5'],['--smoke-seconds','9'],['--minutes','60','--smoke-seconds','10'],['--minutes','60','--minutes','60'],['--unknown','1']])assert.throws(()=>parseOptions([...args,...tail]));
        assert.throws(()=>parseOptions(args.map(v=>v===path.join(area,'report.json')?path.join(area,'new','inside.json'):v)));
        assert(!existsSync(path.join(area,'new')));writeFileSync(path.join(area,'report.json'),'keep');assert.throws(()=>parseOptions([...args]));assert.equal(readFileSync(path.join(area,'report.json'),'utf8'),'keep');
    }finally{assert.equal(path.dirname(area),path.resolve(tmpdir()));assert(path.basename(area).startsWith('twrs-stab-options-'));rmSync(area,{recursive:true,force:true})}
});

test('installed-host smoke really creates, backs up, restores and recovers a 100-stock synthetic service',async()=>{
    const area=mkdtempSync(path.join(tmpdir(),'twrs-stab-'));
    try{
        await import('../scripts/build-host.mjs');
        const bundle=await build({stdin:{contents:"export {writeRelease} from './server/hostProtocol';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'cjs',platform:'node',logLevel:'silent'});
        const compiled={exports:{}};new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);
        const stage=path.join(area,'stage');mkdirSync(path.join(stage,'runtime'),{recursive:true});mkdirSync(path.join(stage,'web','assets'),{recursive:true});
        for(const name of ['serve','data','accounts','backup'])copyFileSync(path.resolve('server-dist/host-runtime',name+'.mjs'),path.join(stage,'runtime',name+'.mjs'));
        instrumentHostFixture(stage,path.join(area,'http-diagnostics.jsonl'),'stability-test');
        writeFileSync(path.join(stage,'web','index.html'),'<!doctype html><title>Synthetic stability integration</title>');
        writeFileSync(path.join(stage,'web','assets','app.js'),'/* Synthetic integration fixture */');
        const release=path.join(area,'fixture.twrsrelease');compiled.exports.writeRelease(stage,release,'stability-test');
        const result=await runStability(parseOptions(['--area',path.join(area,'run'),'--report',path.join(area,'report.json'),'--release',release,'--launcher',path.resolve('server-dist/host.mjs'),'--smoke-seconds','10']));
        const eventFile=path.join(area,'run','host','host-events.jsonl');
        const events=existsSync(eventFile)?readFileSync(eventFile,'utf8').trim().split('\n').slice(-32).map(line=>{try{const v=JSON.parse(line);return {at:v.at,event:v.event,code:v.code}}catch{return {event:'unparseable'}}}):[];
        assert.equal(result.status,'smoke_passed',JSON.stringify({failures:result.failures,owned_host_events:events,owned_http_events:fixtureDiagnostics(path.join(area,'http-diagnostics.jsonl'))}));assert.equal(result.acceptance.checks.real_hour,false);
        assert.equal(result.restore.sessions_restored,0);assert.equal(result.restore.accounts,5);assert.equal(result.restore.prices,108162);
        assert.equal(result.backups.length,4);assert.equal(result.recovery.child_crash.passed,true);assert.equal(result.clean_shutdown,true);
        assert.equal(result.failures.length,0);assert(existsSync(path.join(area,'report.json.progress.jsonl')));
        assert(!existsSync(path.join(area,'run','host','control.json')));
    }finally{assert.equal(path.dirname(area),path.resolve(tmpdir()));assert(path.basename(area).startsWith('twrs-stab-'));rmSync(area,{recursive:true,force:true})}
});
