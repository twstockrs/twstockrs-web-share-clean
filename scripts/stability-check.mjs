import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {existsSync,mkdirSync,readFileSync,writeFileSync,appendFileSync,copyFileSync,readdirSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createServer,connect} from 'node:net';
import {createHash,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {cpus,totalmem,platform,release as osRelease} from 'node:os';
import {makeRsFixture} from './make-rs-fixture.mjs';
import {Latencies,median,evaluateStability,stabilityLimits} from './stability-policy.mjs';

const pause = ms => new Promise(r => setTimeout(r, ms));
const sha = value => createHash('sha256').update(value).digest('hex');
const json = file => JSON.parse(readFileSync(file, 'utf8'));
export function parseOptions(args) {
    const v = {};
    while (args.length) {
        const key = args.shift(), value = args.shift();
        if (!['--area','--report','--release','--launcher','--minutes','--smoke-seconds'].includes(key) || !value || Object.hasOwn(v, key)) throw Error('Invalid stability option');
        v[key] = value;
    }
    if (['--area','--report','--release','--launcher'].some(k => !v[k]) || v['--minutes'] && v['--smoke-seconds']) throw Error('Supply new --area, --report, verified --release and matching --launcher; choose --minutes or --smoke-seconds');
    const smoke = Object.hasOwn(v, '--smoke-seconds'), duration = Number(smoke ? v['--smoke-seconds'] : v['--minutes'] || 60);
    if (!Number.isSafeInteger(duration) || duration < (smoke ? 10 : 60) || duration > (smoke ? 300 : 240)) throw Error('Long run: 60–240 minutes; smoke: 10–300 seconds (never long-run acceptance)');
    const area = path.resolve(v['--area']), report = path.resolve(v['--report']);
    if (area === path.parse(area).root || report === area || report.startsWith(area + path.sep) || area.startsWith(report + path.sep)) throw Error('Report must be outside the new test area');
    for (const p of [area, report, report + '.progress.jsonl']) if (existsSync(p)) throw Error('Test area and reports must not exist; no overwrite is allowed');
    for (const p of [v['--release'],v['--launcher']]) if (!existsSync(path.resolve(p))) throw Error('Release and launcher must exist');
    return {area, report, release:path.resolve(v['--release']), launcher:path.resolve(v['--launcher']), mode:smoke ? 'smoke' : 'long', duration_ms:duration * (smoke ? 1000 : 60_000)};
}

async function until(fn, timeout = 30_000) {
    const end = performance.now() + timeout;
    while (performance.now() < end) { const v = await fn(); if (v) return v; await pause(150); }
    throw Error('Condition timed out');
}
async function freePort() {
    const server = createServer(); await new Promise((resolve,reject) => {server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});
    const port = server.address().port; await new Promise(r => server.close(r)); return port;
}
function runNode(args, cwd, timeout = 60_000) {
    return new Promise((resolve,reject) => {
        const p = spawn(process.execPath,args,{cwd,stdio:['ignore','pipe','pipe'],windowsHide:true});
        let stdout = '', stderr = ''; const timer = setTimeout(() => p.kill(),timeout);
        p.stdout.on('data',b => {stdout = (stdout + b).slice(-2_000_000)});
        p.stderr.on('data',b => {stderr = (stderr + b).slice(-4096)});
        p.once('error',e => {clearTimeout(timer);reject(e)});
        p.once('close',code => {clearTimeout(timer);if (code !== 0) reject(Error('Owned test tool failed: ' + path.basename(args[0]) + ' exit ' + code));else {try {resolve(JSON.parse(stdout))} catch {reject(Error('Invalid owned tool result'))}}});
    });
}

export async function runStability(o) {
    const report = {format:'TWStockRS-stability-report',version:1,synthetic:true,mode:o.mode,started_at:new Date().toISOString(),scope:{securities:100,daily_period:240,daily_trail:240,weekly_period:52,weekly_trail:52,clients:5,warmup_required_ms:o.mode==='long'?300000:0,quiet_interval_ms:o.duration_ms/6,requested_duration_ms:o.duration_ms,offered_load:'Five sequential clients with 2-second think time; one full playback per 12 cycles per client; 10-second telemetry; 2-second health; six equally spaced quiet checkpoints. HTTP and installed host, not a browser rendering soak.'},limits:stabilityLimits,environment:{node:process.version,platform:platform(),os:osRelease(),cpu:cpus()[0]?.model,logical_cpus:cpus().length,total_memory_bytes:totalmem()},release:{archive_sha256:sha(readFileSync(o.release)),launcher_sha256:sha(readFileSync(o.launcher))},elapsed_ms:0,failures:[],coverage:{daily:0,weekly:0,sector:0,playback:0,library_edit:0,library_restore:0,exports:0,context:0},client_cycles:[0,0,0,0,0],samples:[],quiet_windows:[],instances:[],backups:[],recovery:{},clean_shutdown:false};
    mkdirSync(path.dirname(o.report),{recursive:true});
    // Reserve evidence paths exclusively before touching a test host. Never log passwords, cookies or control tokens.
    writeFileSync(o.report,JSON.stringify({status:'running',...report},null,2)+'\n',{flag:'wx',mode:0o600});
    writeFileSync(o.report+'.progress.jsonl','',{flag:'wx',mode:0o600});
    const host = path.join(o.area,'host'), password = 'Synthetic soak ' + randomUUID() + '!', latency = new Map(), health = new Latencies();
    let manager, abort = false, measured = false, instance, metricClient, start = 0, lastBackup, m, base, activeLoops = [], lastOverview;
    const children = new Set(), expectedDigests = new Map();
    const progress = (phase, extra = {}) => {
        const event = {at:new Date().toISOString(),phase,elapsed_ms:start ? Math.round(performance.now()-start) : 0,...extra};
        appendFileSync(o.report+'.progress.jsonl',JSON.stringify(event)+'\n');
        writeFileSync(o.report,JSON.stringify({status:'running',...report,health:health.summary(),requests:Object.fromEntries([...latency].map(([k,v])=>[k,v.summary()]))},null,2)+'\n',{mode:0o600});
        process.stdout.write(JSON.stringify(event)+'\n');
    };
    const failure = (action, e) => {abort = true; report.failures.push({at:new Date().toISOString(),action,code:typeof e?.code === 'string' ? e.code.slice(0,80) : 'ASSERTION_OR_RUNTIME',message:String(e?.message || e).slice(0,240)});progress('failure',{action});};
    const interrupted = () => {if(!abort)failure('interrupted',Error('Acceptance interrupted; partial run cannot pass'))};
    process.on('SIGINT',interrupted);process.on('SIGTERM',interrupted);
    const stat = route => {if(!latency.has(route))latency.set(route,new Latencies());return latency.get(route)};
    const stateFile = () => json(path.join(host,'state.json'));
    const dataDirectory = () => path.join(host,'data',stateFile().active.data);
    const cli = (op,rest = []) => runNode([path.join(host,'host.mjs'),op,'--root',host,...rest],o.area);
    async function control(operation = 'status') {
        const c = json(path.join(host,'control.json'));
        return new Promise((resolve,reject) => {
            const socket = connect(c.port,'127.0.0.1'); let text = '';
            const timer = setTimeout(() => {socket.destroy();reject(Error('Owned host control timed out'))},60_000);
            socket.once('error',e => {clearTimeout(timer);reject(e)});
            socket.once('connect',() => socket.write(JSON.stringify({operation,host_id:c.host_id,token:c.token,revision:stateFile().revision})+'\n'));
            socket.on('data',b => {text += b;if(text.includes('\n')){clearTimeout(timer);socket.end();try{resolve(JSON.parse(text))}catch{reject(Error('Invalid control reply'))}}});
            socket.once('end',() => {clearTimeout(timer);if(!text.includes('\n'))reject(Error('Incomplete control reply'))});
        });
    }
    function launch() {
        const p = spawn(process.execPath,[path.join(host,'host.mjs'),'run','--root',host],{cwd:o.area,stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
        children.add(p); p.log_bytes = 0;
        for(const stream of [p.stdout,p.stderr])stream.on('data',b => {p.log_bytes += b.length});
        p.done = new Promise((resolve,reject) => {p.once('error',reject);p.once('close',code => {children.delete(p);resolve(code)})});
        return p;
    }
    async function ready(p = manager) {
        return until(async () => {assert.equal(p.exitCode,null,'Owned manager exited');try{const s = await control();return s.phase === 'running' && !s.busy && s}catch{return false}});
    }
    async function stop() {
        if(!manager || manager.exitCode !== null || manager.signalCode !== null)return;
        const r = await control('stop');assert.equal(r.ok,true);
        const timeout = Symbol();assert.notEqual(await Promise.race([manager.done,pause(15_000).then(()=>timeout)]),timeout,'Owned manager failed to stop');
        assert(!existsSync(path.join(host,'control.json')),'Host control must be removed after stop');
    }
    function client(index) {
        let cookie = '', session;
        return {index,get session(){return session},async call(route,body) {
            const begin = performance.now();let bytes = 0, failed = false;
            try {
                const response = await fetch(base+route,{method:body === undefined ? 'GET':'POST',signal:AbortSignal.timeout(30_000),headers:{...(cookie?{Cookie:cookie}:{}),...(session?{'X-Workspace-Id':session.owner,'X-Auth-Rights':session.rights,'X-CSRF-Token':session.csrf}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
                if(response.headers.has('set-cookie'))cookie = response.headers.get('set-cookie').split(';')[0];
                const text = await response.text();bytes = Buffer.byteLength(text);const value = JSON.parse(text);
                if(!response.ok)throw Object.assign(Error(route+' HTTP '+response.status),{code:value.error?.code || value.code || 'HTTP_ERROR'});
                if(value.session)session = value.session;
                return value;
            }catch(e){failed = true;throw e}finally{if(measured)stat(route).add(performance.now()-begin,bytes,failed)}
        },async login(){await this.call('auth/session');await this.call('auth/login',{username:'soak'+index,password});assert.equal(session.plan,'Pro')}};
    }
    async function sample() {
        const h = await metricClient.call('health');assert.equal(h.status,'ok');
        const id = h.deployment.instance_id;
        if(!report.instances.includes(id))report.instances.push(id);
        assert.equal(id,instance,'Serving process changed during uninterrupted window');
        const v = await metricClient.call('admin/overview',{});lastOverview = v;
        assert.equal(v.records_available,true);assert.equal(v.accounts.total,5);
        assert.equal(v.queue.failed,0);assert.equal(v.queue.timed_out,0);assert.equal(v.queue.rejected,0);
        assert.equal(v.host.monitoring.available,true);assert.equal(v.host.monitoring.fault,null);assert.equal(v.host.monitoring.stale,false);
        assert.equal(v.host.monitoring.incidents.filter(v=>v.recovered_at===null).length,0);
        const row = {elapsed_ms:Math.round(performance.now()-start),rss_bytes:v.memory_bytes,uptime_seconds:v.uptime_seconds,queue:v.queue,storage:v.storage,monitoring:{available:v.host.monitoring.available,stale:v.host.monitoring.stale,fault:v.host.monitoring.fault,active_incidents:v.host.monitoring.incidents.filter(v=>v.recovered_at===null).length}};
        report.samples.push(row);return row;
    }
    async function quiet(label) {
        assert.equal((await metricClient.call('health')).background.queued,0);
        await until(async()=>{const q=(await metricClient.call('health')).background;return q.queued===0 && q.running===0});
        const rss = [];
        for(let i=0;i<5;i++){if(i)await pause(o.mode==='smoke'?100:2000);rss.push((await sample()).rss_bytes)}
        const row = {label,elapsed_ms:Math.round(performance.now()-start),rss_bytes:median(rss),instance,samples:rss};
        report.quiet_windows.push(row);progress('quiet_window',{label,rss_mib:Math.round(row.rss_bytes/1024**2)});
    }
    async function backup() {
        const before = await control(), result = await control('auto-backup-run');
        assert.equal(result.ok,true);assert.equal(result.status,'success');const after = await control();
        assert.equal(after.child_pid,before.child_pid);assert.deepEqual(after.active,before.active);
        assert.equal(after.automatic.last_error,null);assert.equal(after.automatic.pending,false);
        lastBackup = path.join(host,'auto-backups','auto-'+result.id+'.twrsbackup');
        report.backups.push({at:new Date().toISOString(),elapsed_ms:Math.round(performance.now()-start),status:result.status,bytes:readFileSync(lastBackup).length,sha256:sha(readFileSync(lastBackup))});
        progress('live_backup',{number:report.backups.length});
    }
    function projection(directory) {
        const library = new DatabaseSync(path.join(directory,'library.sqlite'),{readOnly:true}), imports = new DatabaseSync(path.join(directory,'imports.sqlite'),{readOnly:true});
        try {
            for(const db of [library,imports]){assert.deepEqual(db.prepare('PRAGMA quick_check').all().map(r=>Object.values(r)[0]),['ok']);assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)}
            const count = table => Number(library.prepare('SELECT count(*) AS n FROM '+table).get().n);
            assert(count('auth_sessions')<=1024);assert(count('auth_events')<=1000);assert(count('auth_attempts')<=512);
            const accountRows = library.prepare('SELECT * FROM accounts ORDER BY account_id').all();assert.equal(accountRows.length,5);
            const workspaces = library.prepare("SELECT owner,contents FROM workspace WHERE owner LIKE 'account-%' ORDER BY owner").all();assert.equal(workspaces.length,5);
            const shares = library.prepare('SELECT * FROM frozen_shares ORDER BY token').all();assert.equal(shares.length,1);
            const batches = imports.prepare('SELECT * FROM import_batches ORDER BY batch_id').all();assert.equal(batches.length,1);
            const versions = imports.prepare('SELECT * FROM market_releases ORDER BY market').all();assert.equal(versions.length,2);
            // Restore intentionally advances revision fences to invalidate stale clients. All other saved values must match.
            return {accounts:sha(JSON.stringify(accountRows.map(({revision,...rest})=>rest))),workspaces:sha(JSON.stringify(workspaces)),shares:sha(JSON.stringify(shares)),batches:sha(JSON.stringify(batches)),versions:sha(JSON.stringify(versions.map(({revision,activation_revision,...rest})=>rest))),account_revisions:accountRows.map(v=>v.revision),market_revisions:versions.map(v=>[v.revision,v.activation_revision]),sessions:count('auth_sessions'),events:count('auth_events'),attempts:count('auth_attempts')};
        }finally{library.close();imports.close()}
    }
    try {
        mkdirSync(path.dirname(o.area),{recursive:true});mkdirSync(o.area,{mode:0o700});
        report.tool_sha256=Object.fromEntries(['stability-check.mjs','stability-policy.mjs','make-rs-fixture.mjs'].map(name=>[name,sha(readFileSync(new URL(name,import.meta.url)))]));
        progress('prepare');
        const bundled = await build({stdin:{contents:"export * from './server/importStore';export * from './server/releaseStore';export * from './server/libraryStore';export * from './server/authStore';export * from './components/twstock/model';export * from './shared/mockAnalysis';export * from './shared/playback';export * from './components/twstock/exportData';",resolveDir:process.cwd(),loader:'ts'},write:false,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
        const mod = {exports:{}};new Function('require','module','exports',bundled.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);m = mod.exports;
        report.setup_and_decoder_bundle_sha256=sha(bundled.outputFiles[0].text);
        const port = await freePort();
        await runNode([o.launcher,'init','--root',host,'--release',o.release,'--port',String(port)],o.area);
        const fixture = makeRsFixture({count:100}), source = JSON.stringify(fixture), imports = new m.ImportStore(path.join(dataDirectory(),'imports.sqlite')), versions = new m.ReleaseStore(imports);
        const checked = imports.validate(source);assert.equal(checked.report.ok,true);imports.stage(source,checked.report.sha256);
        for(const market of ['TWSE','TPEx']){const input={market,expected_revision:1,batch_ids:[fixture.manifest.batch_id]}, preview=versions.handle('preview',input).preview, created=versions.handle('create',{...input,expected_digest:preview.digest}).created;versions.handle('activate',{market,expected_revision:2,release_id:created.release_id})}
        imports.close();report.scope.prices = fixture.prices.length;
        const library = new m.LibraryStore(path.join(dataDirectory(),'library.sqlite')), auth = new m.AuthStore(library.connection);
        for(let i=0;i<5;i++)await auth.createAccount('soak'+i,password,i===0?'admin':'user','Pro',Date.now()+86400000);
        library.close();
        manager = launch();await ready();base = 'http://127.0.0.1:'+port+'/api/v1/';
        const clients = Array.from({length:5},(_,i)=>client(i));for(const c of clients)await c.login();metricClient = clients[0];
        function checkPrivate(c,snapshot){assert.equal(snapshot.library.watchlists[3].name,'合成帳號 '+c.index);assert.equal(snapshot.library.savedViews[1].name,'合成檢視 '+c.index)}
        for(const c of clients){let current=await c.call('library/open',{mock_plan:'Pro'});for(const [kind,index,name] of [['watchlist',3,'合成帳號 '+c.index],['saved',1,'合成檢視 '+c.index]])current=await c.call('library/edit',{mock_plan:'Pro',expected_revision:current.snapshot.revision,action:{type:'rename',kind,index,name}});checkPrivate(c,current.snapshot)}
        const runtime = (await metricClient.call('analysis-context',{market:'TWSE',mock_plan:'Pro'})).runtime;
        const ids = runtime.catalog.filter(s=>s.searchable&&s.id!=='DEMO1').slice(0,100).map(s=>s.id);assert.equal(ids.length,100);
        const state = {...m.analysisDefaults('Pro'),runtime,period:'240D',trail:240,viewingDate:runtime.Daily.length-1,currentList:ids};
        const request = (id,extra={}) => ({...m.createAnalysisRequest(state,id),...extra});
        async function analysis(c,req) {
            const v = await c.call('analyses',req), decoded = m.decodeAnalysisResponse(v,req,runtime);
            assert.equal(v.entities.length,req.mode==='Stock Move'?100:6);
            const key = m.requestKey(req), digest = sha(JSON.stringify(v.entities));
            if(expectedDigests.has(key))assert.equal(digest,expectedDigests.get(key),'Same input returned different computed entities');
            else {assert(expectedDigests.size<256,'Unbounded test expectation cache');expectedDigests.set(key,digest)}
            return {v,decoded};
        }
        async function save(c,req,kind,index) {
            const current = await c.call('library/open',{mock_plan:'Pro'});
            const saved = await c.call('library/edit',{mock_plan:'Pro',expected_revision:current.snapshot.revision,action:{type:'save',kind,index},analysis:req});
            report.coverage.library_edit++;return saved.snapshot;
        }
        async function playback(c,req) {
            const v = await c.call('playback',req), reader = m.decodePlayback(v,req,runtime), dates = req.frequency==='Weekly'?runtime.Weekly:runtime.Daily;
            // Decode every actual playback frame, including its individual point dates and values.
            for(let i=0;i<dates.length;i++){const frame=reader.at({...req,viewing_date:dates[i]});assert.equal(frame.response.entities.length,100);if(i%8===7)await pause(0)}
            const normal = await analysis(c,{...req,viewing_date:dates.at(-1)});
            assert.deepEqual(reader.at({...req,viewing_date:dates.at(-1)}).response.entities,normal.v.entities);
            report.coverage.playback++;
        }
        async function cycle(c,n) {
            const offset = n % 8, weekly = n % 4 === 1, sector = n % 4 === 2;
            const req = request('soak-'+c.index+'-'+n,weekly?{frequency:'Weekly',period:52,trail:52,viewing_date:runtime.Weekly.at(-1-offset)}:sector?{mode:'Sector Move',security_ids:[],viewing_date:runtime.Daily.at(-1-offset)}:{viewing_date:runtime.Daily.at(-1-offset)});
            const {decoded} = await analysis(c,req);report.coverage[weekly?'weekly':sector?'sector':'daily']++;
            if(n%12===c.index){await playback(c,request('play-'+c.index+'-'+n,weekly?{frequency:'Weekly',period:52,trail:52,viewing_date:runtime.Weekly.at(-1)}:{}))}
            if(n%5===0){const target=request('save-'+c.index+'-'+n);await save(c,target,'watchlist',n%4);await save(c,target,'saved',n%2)}
            if(n%15===0){
                let current=await c.call('library/open',{mock_plan:'Pro'});
                checkPrivate(c,current.snapshot);
                const before = JSON.stringify(current.snapshot.library), backup = await c.call('library/backup',{mock_plan:'Pro',expected_revision:current.snapshot.revision});
                current=await c.call('library/edit',{mock_plan:'Pro',expected_revision:current.snapshot.revision,action:{type:'rename',kind:'watchlist',index:0,name:'合成驗收 '+c.index+' '+n}});
                const text=JSON.stringify(backup.backup), preview=await c.call('library/restore/preview',{mock_plan:'Pro',expected_revision:current.snapshot.revision,text});
                const restored=await c.call('library/restore',{mock_plan:'Pro',expected_revision:preview.snapshot.revision,text,selected:['watchlist:0']});
                assert.equal(JSON.stringify(restored.snapshot.library),before);report.coverage.library_restore++;
            }
            if(n%10===0){await c.call('exports/authorize',{format:'CSV',analysis:req});assert(m.buildCsvExport({...state,frequency:weekly?'Weekly':'Daily',period:weekly?'52W':'240D',trail:weekly?52:240,mode:sector?'Sector Move':'Stock Move'},decoded.data).text.length>100);report.coverage.exports++}
            if(n%20===0){const fresh=(await c.call('analysis-context',{market:'TWSE',mock_plan:'Pro'})).runtime;assert.deepEqual(fresh,runtime);report.coverage.context++}
            report.client_cycles[c.index]++;
        }
        progress('warmup');
        // Warm the exact bounded request/date variants before fixing the natural RSS baseline.
        for(let n=0;n<8;n++)await analysis(clients[n%5],request('warm-'+n,{viewing_date:runtime.Daily.at(-1-n)}));
        for(let n=0;n<8;n++)await analysis(clients[n%5],request('warm-week-'+n,{frequency:'Weekly',period:52,trail:52,viewing_date:runtime.Weekly.at(-1-n)}));
        for(let n=0;n<8;n++)await analysis(clients[n%5],request('warm-sector-'+n,{mode:'Sector Move',security_ids:[],viewing_date:runtime.Daily.at(-1-n)}));
        await playback(clients[0],request('warm-play'));await playback(clients[1],request('warm-week-play',{frequency:'Weekly',period:52,trail:52,viewing_date:runtime.Weekly.at(-1)}));
        for(const c of clients)await cycle(c,0);
        const frozenReq=request('frozen-soak'), frozen=await analysis(clients[0],frozenReq);
        await clients[0].call('shares/create',{delivery_id:frozen.v.request_id,request_key:m.requestKey(frozenReq),mock_plan:'Pro'});
        // Prime the actual five-client allocation pattern for a fixed real five minutes.
        // This is additional work, never part of the required measured hour; no forced GC.
        const warmDuration=o.mode==='long'?300_000:0,warmStart=performance.now();
        if(warmDuration){
            progress('parallel_warmup',{minutes:5});
            activeLoops=clients.map(async c=>{let n=1;while(performance.now()-warmStart<warmDuration&&!abort){await cycle(c,n++);await pause(2000)}});
            await Promise.all(activeLoops);
        }
        report.warmup={elapsed_ms:Math.round(performance.now()-warmStart),client_cycles:[...report.client_cycles],required_ms:warmDuration};
        // Counts and timings below describe only the actual uninterrupted measurement window.
        report.warmup_coverage={...report.coverage};report.coverage = Object.fromEntries(Object.keys(report.coverage).map(k=>[k,0]));report.client_cycles.fill(0);
        instance=(await metricClient.call('health')).deployment.instance_id;report.instances.push(instance);start=performance.now();measured=true;
        await quiet('baseline');progress('steady_load',{minutes:o.duration_ms/60_000});
        let backgroundDone = false;
        const healthLoop = (async()=>{while(!backgroundDone&&!abort){const t=performance.now();let failed=false;try{const response=await fetch(base+'health',{signal:AbortSignal.timeout(5000)});assert.equal(response.status,200);const h=await response.json();assert.equal(h.status,'ok');assert.equal(h.deployment.instance_id,instance)}catch(e){failed=true;failure('health',e)}health.add(performance.now()-t,0,failed);await pause(2000)}})();
        const metricLoop = (async()=>{while(!backgroundDone&&!abort){try{await sample()}catch(e){failure('telemetry',e)}await pause(o.mode==='smoke'?1000:10_000)}})();
        try {
            // Six load segments yield a baseline plus six quiet windows spanning a real hour.
            for(let segment=1;segment<=6&&!abort;segment++){
                const boundary=start+o.duration_ms*segment/6;
                activeLoops=clients.map(async c=>{while(performance.now()<boundary&&!abort){const n=report.client_cycles[c.index]+1;try{await cycle(c,n)}catch(e){failure('client-'+c.index,e);break}await pause(o.mode==='smoke'?30:2000)}});
                let nextProgress=performance.now();
                while(performance.now()<boundary&&!abort){if(performance.now()>=nextProgress){progress('load',{cycles:[...report.client_cycles],health_samples:health.count,latest_rss_mib:lastOverview?Math.round(lastOverview.memory_bytes/1024**2):null,quiet_baseline_rss_mib:Math.round(report.quiet_windows[0].rss_bytes/1024**2)});nextProgress=performance.now()+30_000}await pause(250)}
                await Promise.all(activeLoops);activeLoops=[];
                if(abort)break;
                await quiet('checkpoint-'+segment);
                if([1,3,5,6].includes(segment))await backup();
            }
        }finally{backgroundDone=true;await Promise.all([healthLoop,metricLoop]);await Promise.allSettled(activeLoops);activeLoops=[]}
        report.elapsed_ms=performance.now()-start;report.final_queue=(await metricClient.call('health')).background;measured=false;
        assert(!abort,'Unexpected failures during steady load');
        // Fault injection is deliberately outside the uninterrupted memory/latency measurement.
        for(const kind of ['restart','child_crash']){
            progress('recovery',{kind});const before=await control(),oldInstance=(await metricClient.call('health')).deployment.instance_id,t=performance.now();
            if(kind==='restart'){const result=await control('restart');assert.equal(result.ok,true)}else{assert(before.child_pid>0&&before.child_pid!==process.pid&&before.child_pid!==manager.pid);process.kill(before.child_pid,'SIGKILL')}
            const after=await until(async()=>{try{const s=await control();return s.phase==='running'&&!s.busy&&s.child_pid!==before.child_pid&&s}catch{return false}});
            assert.notEqual((await metricClient.call('health')).deployment.instance_id,oldInstance);
            for(const c of clients){checkPrivate(c,(await c.call('library/open',{mock_plan:'Pro'})).snapshot);await analysis(c,request('recover-'+kind+'-'+c.index))}
            assert.equal(after.phase,'running');report.recovery[kind]={passed:true,ms:performance.now()-t};
        }
        progress('recovery',{kind:'manager_restart'});await stop();manager=launch();await ready();
        for(const c of clients){checkPrivate(c,(await c.call('library/open',{mock_plan:'Pro'})).snapshot);await analysis(c,request('manager-recover-'+c.index))}
        report.recovery.manager_restart={passed:true};await stop();
        // Inspect private copies of stopped SQLite files, never an active user database.
        const checkedCopy=path.join(o.area,'checked');mkdirSync(checkedCopy);
        for(const name of ['library.sqlite','imports.sqlite'])copyFileSync(path.join(dataDirectory(),name),path.join(checkedCopy,name));
        const original=projection(checkedCopy);report.integrity={passed:true,sessions:original.sessions,events:original.events,attempts:original.attempts};
        assert(lastBackup,'No live backup was made');const restored=path.join(o.area,'restored'), tool=path.join(host,'releases',stateFile().active.release,'runtime','backup.mjs');
        const preview=await runNode([tool,'preview','--data-dir',restored,'--file',lastBackup],o.area);
        assert.equal(preview.manifest.summary.accounts,5);assert.equal(preview.manifest.summary.frozen_shares,1);assert.equal(preview.manifest.summary.prices,fixture.prices.length);
        await runNode([tool,'restore','--data-dir',restored,'--file',lastBackup,'--confirm',preview.confirmation_token],o.area);
        const restoredProjection=projection(restored);assert.equal(restoredProjection.sessions,0);
        for(const key of ['accounts','workspaces','shares','batches','versions'])assert.equal(restoredProjection[key],original[key],'Restored '+key+' differs from original');
        assert(restoredProjection.account_revisions.every((v,i)=>v>original.account_revisions[i]));
        assert(restoredProjection.market_revisions.every((v,i)=>v.every((n,j)=>n>original.market_revisions[i][j])));
        report.restore={passed:true,accounts:5,workspaces:5,frozen_shares:1,prices:fixture.prices.length,sessions_restored:0,semantic_hashes:Object.fromEntries(['accounts','workspaces','shares','batches','versions'].map(k=>[k,original[k]]))};
        report.clean_shutdown=!existsSync(path.join(host,'control.json'))&&!readdirSync(host).some(n=>n.endsWith('.twstockrs-lock'))&&!readdirSync(path.join(host,'data')).some(n=>n.endsWith('.twstockrs-lock'))&&!readdirSync(dataDirectory()).some(n=>n.endsWith('.twstockrs-lock'));
        progress('restored_and_checked');
    }catch(e){failure('acceptance',e)}finally{
        abort=true;await Promise.allSettled(activeLoops);
        try{await stop()}catch(e){failure('shutdown',e)}
        for(const p of children){if(p.exitCode===null&&p.signalCode===null){p.kill('SIGKILL');await p.done;report.clean_shutdown=false}}
        report.health=health.summary();report.requests=Object.fromEntries([...latency].map(([k,v])=>[k,v.summary()]));
        report.finished_at=new Date().toISOString();report.acceptance=evaluateStability(report);report.status=report.acceptance.status;
        writeFileSync(o.report,JSON.stringify(report,null,2)+'\n',{mode:0o600});progress('finished',{status:report.status});
        process.off('SIGINT',interrupted);process.off('SIGTERM',interrupted);
    }
    return report;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
    try{const report=await runStability(parseOptions(process.argv.slice(2)));if(report.status==='failed')process.exitCode=1}catch(e){process.stderr.write(String(e.message)+'\n');process.exitCode=1}
}
