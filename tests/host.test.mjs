import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, readdirSync, existsSync, rmSync, symlinkSync, unlinkSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, connect } from 'node:net';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { request as httpRequest } from 'node:http';
import {makeRsFixture} from '../scripts/make-rs-fixture.mjs';
import {instrumentHostFixture,fixtureDiagnostics} from './host-fixture-diagnostics.mjs';
await import('../scripts/build-host.mjs');
const bundle = await build({ stdin: { contents: "export * from './server/hostProtocol';export * from './server/dataLock';export * from './server/app';export * from './server/authStore';export * from './server/libraryStore';export * from './server/frozenShareStore';export * from './shared/mockAnalysis';export * from './components/twstock/model';", resolveDir: process.cwd(), loader: 'ts' }, write: false, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
const mod = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), mod, mod.exports);
const m = mod.exports;
const manager = path.resolve('server-dist/host.mjs'), runtime = path.resolve('server-dist/host-runtime'), password = 'Synthetic host acceptance passphrase!';
const portAreas=new Map();

test('installed host can back up, preview and restore without source dependencies and cannot overwrite a backup', async () => {
    const a=area(); let p;
    try {
        const port=await setup(a); p=start(a); await ready(a,p);
        a.phase='initial-login';const b=browser(port); await b.login(); await b.rename('portable-maintenance');
        assert.equal(cli(a,'backup',['--','create','--file',path.join(a.root,'live.twrsbackup')]).status,1);
        await shutdown(a,p);
        const file=path.join(a.root,'complete.twrsbackup');
        assert.equal(cli(a,'backup',['--','create','--file',file]).status,0);
        assert.equal(cli(a,'backup',['--','create','--file',file]).status,1);
        const preview=cli(a,'backup',['--','preview','--file',file]); assert.equal(preview.status,0);
        assert.equal(cli(a,'backup',['--','restore','--file',file]).status,1);
        assert.equal(cli(a,'backup',['--','restore','--file',file,'--confirm',preview.value.confirmation_token]).status,0);
        p=start(a); await ready(a,p); a.phase='restored-login';const c=browser(port);await c.login();assert.match(await c.names(),/portable-maintenance/);
        await shutdown(a,p);noLocks(a);
        assert(!existsSync(path.join(a.host,'node_modules')));
    } finally { if(p)await shutdown(a,p);a.cleanup(); }
});
const pause = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 15000) { const end = Date.now() + ms; let last; while (Date.now() < end) {
    try {
        const v = await fn();
        if (v)
            return v;
    }
    catch (e) {
        last = e;
    }
    await pause(70);
} throw Error('condition timeout' + (last ? ': ' + last.message : '')); }
function area() { const root = mkdtempSync(path.join(tmpdir(), 'twrs-host-')); return { root, host: path.join(root, 'host'), cleanup() { for(const [port,a] of portAreas)if(a.root===root)portAreas.delete(port);assert(root.startsWith(path.join(tmpdir(), 'twrs-host-'))); rmSync(root, { recursive: true, force: true }); } }; }
function release(a, id, change) { const stage = path.join(a.root, 'stage-' + id); mkdirSync(path.join(stage, 'runtime'), { recursive: true }); mkdirSync(path.join(stage, 'web', 'assets'), { recursive: true }); for (const name of ['serve', 'data', 'accounts', 'backup'])
    copyFileSync(path.join(runtime, name + '.mjs'), path.join(stage, 'runtime', name + '.mjs')); instrumentHostFixture(stage,path.join(a.root,'http-diagnostics.jsonl'),id,a.slowCommitMs,a.responseHoldMs); writeFileSync(path.join(stage, 'web/index.html'), '<!doctype html><title>' + id + '</title><script src="/assets/app.js"></script>'); writeFileSync(path.join(stage, 'web/assets/app.js'), 'document.body.dataset.host="' + id + '";'); change?.(stage); const file = path.join(a.root, id + '.twrsrelease'); m.writeRelease(stage, file, id); return file; }
function rewrite(file, edit) { const bytes = readFileSync(file), offset = m.releaseMagic.length + 4, size = bytes.readUInt32BE(m.releaseMagic.length), v = JSON.parse(bytes.subarray(offset, offset + size)), body = bytes.subarray(offset + size); edit(v); const header = Buffer.from(JSON.stringify(v)), len = Buffer.alloc(4); len.writeUInt32BE(header.length); writeFileSync(file, Buffer.concat([m.releaseMagic, len, header, body])); }
function cli(a, operation, args = [], input) { const p = spawnSync(process.execPath, [existsSync(path.join(a.host, 'host.mjs')) ? path.join(a.host, 'host.mjs') : manager, operation, '--root', a.host, ...args], { cwd: a.root, input, encoding: 'utf8', timeout: 30000 }); return { ...p, value: p.status === 0 && p.stdout.trim() ? JSON.parse(p.stdout) : null }; }
async function freePort() { const s = createServer(); await new Promise(r => s.listen(0, '127.0.0.1', r)); const port = s.address().port; await new Promise(r => s.close(r)); return port; }
async function setup(a, { production = false, admin = true } = {}) { const port = await freePort(), file = release(a, 'release-a'); portAreas.set(port,a);assert.equal(cli(a, 'init', ['--release', file, '--port', String(port), ...(production ? ['--mode', 'production', '--origin', 'https://stocks.example.invalid'] : [])]).status, 0); if (admin)
    assert.equal(cli(a, 'account', ['--', 'create', '--username', 'owner', '--role', 'admin'], JSON.stringify({ password })).status, 0); const c = m.readJson(path.join(a.host, 'host.json')); Object.assign(c, { health_interval_ms: 100, health_timeout_ms: 250, start_timeout_ms: 3000, stop_timeout_ms: 1200, restart_delay_ms: 100, restart_limit: 2, restart_window_ms: 60000 }); m.atomicJson(path.join(a.host, 'host.json'), c); return port; }
function start(a) { const p = spawn(process.execPath, [path.join(a.host, 'host.mjs'), 'run', '--root', a.host], { cwd: a.root, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }); let logs = ''; p.stdout.on('data', b => logs += b); p.stderr.on('data', b => logs += b); p.logs = () => logs; p.done = new Promise(r => p.once('close', code => r(code))); return p; }
async function control(a, operation = 'status', extra = {}) { const c = m.readJson(path.join(a.host, 'control.json')); return new Promise((resolve, reject) => { const s = connect(c.port, '127.0.0.1'), timer = setTimeout(() => { s.destroy(); reject(Error('control timeout')); }, 30000); let text = ''; s.on('error', e => { clearTimeout(timer); reject(e); }); s.once('connect', () => s.write(JSON.stringify({ operation, host_id: c.host_id, token: c.token, revision: m.current(a.host).revision, ...extra }) + '\n')); s.on('data', b => { text += b; if (text.includes('\n')) {
    clearTimeout(timer);
    s.end();
    resolve(JSON.parse(text));
} }); s.on('end', () => { clearTimeout(timer); if (!text.includes('\n'))
    reject(Error('control ended')); }); }); }
async function ready(a, p) { return until(async () => { if (p.exitCode !== null || p.signalCode !== null)
    throw Error(p.logs()); const s = await control(a); return s.phase === 'running' && !s.busy && s; }, 10000); }
async function shutdown(a, p) { if (p.exitCode === null && p.signalCode === null) {
    try {
        await control(a, 'stop');
    }
    catch {
        if (p.connected)
            p.send({ type: 'stop' });
    }
    await Promise.race([p.done, pause(5000)]);
    if (p.exitCode === null && p.signalCode === null) {
        p.kill('SIGKILL');
        await p.done;
    }
} }
async function request(port, route = '/', { body, headers = {}, method } = {}) {
 return new Promise((resolve,reject)=>{
  let settled=false;const verb=method||(body===undefined?'GET':'POST');
  const fail=async error=>{
   if(settled)return;settled=true;const a=portAreas.get(port);let details={};
   if(a){
    const state=await control(a).then(v=>({phase:v.phase,busy:v.busy,child_pid:v.child_pid,restarts:v.restarts_in_window}),()=>({unavailable:true}));
    const file=path.join(a.host,'host-events.jsonl');
    details={test_phase:a.phase,owned_host_status:state,owned_host_events:existsSync(file)?readFileSync(file,'utf8').trim().split('\n').slice(-32).map(s=>{try{const v=JSON.parse(s);return {at:v.at,event:v.event,code:v.code}}catch{return {event:'UNPARSEABLE'}}}):[],owned_http_events:fixtureDiagnostics(path.join(a.root,'http-diagnostics.jsonl'))};
   }
   reject(new Error('Owned host HTTP '+verb+' '+route+' failed; reused_socket='+req.reusedSocket+'; code='+error.code+'; diagnostics='+JSON.stringify(details),{cause:error}));
  };
  const req=httpRequest({agent:false,hostname:'127.0.0.1',port,path:route,method:verb,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers}},r=>{
   const chunks=[];r.on('data',b=>chunks.push(b));r.on('error',fail);
   r.on('end',()=>{if(settled)return;try{const text=Buffer.concat(chunks).toString(),value=r.headers['content-type']?.includes('json')?JSON.parse(text):null;settled=true;resolve({status:r.statusCode,headers:r.headers,text,value})}catch(error){void fail(error)}});
  });
  req.on('error',fail);req.setTimeout(5000,()=>req.destroy(Error('HTTP timeout')));req.end(body===undefined?undefined:JSON.stringify(body));
 });
}
function browser(port, host) { let cookie = '', session; return { get session() { return session; }, get cookie() { return cookie; }, async call(route, body) { const r = await request(port, '/api/v1/' + route, { body, headers: { ...(host ? { Host: host } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(session ? { 'X-Workspace-Id': session.owner, 'X-Auth-Rights': session.rights, 'X-CSRF-Token': session.csrf } : {}) } }); if (r.headers['set-cookie'])
        cookie = r.headers['set-cookie'][0].split(';')[0]; if (r.value?.session)
        session = r.value.session; return r; }, async login() { assert.equal((await this.call('auth/session')).status, 200); assert.equal((await this.call('auth/login', { username: 'owner', password })).status, 200); }, async rename(name) { let r = await this.call('library/open', { mock_plan: 'Free' }); assert.equal(r.status, 200); r = await this.call('library/choose', { mock_plan: 'Free', expected_revision: r.value.snapshot.revision, kind: 'watchlist', index: 0 }); assert.equal(r.status, 200); r = await this.call('library/edit', { mock_plan: 'Free', expected_revision: r.value.snapshot.revision, action: { type: 'rename', kind: 'watchlist', index: 0, name } }); assert.equal(r.status, 200); }, async names() { const r = await this.call('library/open', { mock_plan: 'Free' }); assert.equal(r.status, 200); return JSON.stringify(r.value.snapshot); } }; }
function noLocks(a) { assert(!existsSync(path.join(a.host, 'control.json'))); assert(!existsSync(m.dataPaths(m.hostLockDirectory(a.host)).lock)); for (const name of readdirSync(path.join(a.host, 'data')))
    assert(!name.endsWith('.twstockrs-lock')); }

test('guest session creation uses one commit and survives bounded slow storage without a health restart',async()=>{
 const a=area();a.slowCommitMs=400;let p;
 try{
  const port=await setup(a,{admin:false});p=start(a);const before=await ready(a,p);
  const first=await request(port,'/api/v1/auth/session');assert.equal(first.status,200);
  await pause(900);const after=await control(a);
  assert.equal(after.phase,'running');assert.equal(after.busy,false);assert.equal(after.child_pid,before.child_pid);assert.equal(after.restarts_in_window,0);
  const second=await request(port,'/api/v1/auth/session',{headers:{Cookie:first.headers['set-cookie'][0].split(';')[0]}});
  assert.equal(second.status,200);assert.equal(second.value.session.owner,first.value.session.owner);
  const writes=fixtureDiagnostics(path.join(a.root,'http-diagnostics.jsonl')).filter(v=>v.event==='SIMULATED_COMMIT');
  assert.equal(writes.length,1,JSON.stringify(writes));assert.equal(writes[0].kind,'transaction');
  await shutdown(a,p);noLocks(a);
 }catch(error){const s=await control(a).then(v=>({phase:v.phase,busy:v.busy,restarts:v.restarts_in_window}),()=>({unavailable:true}));throw Error(error.message+'; owned_host_status='+JSON.stringify(s)+'; owned_http_events='+JSON.stringify(fixtureDiagnostics(path.join(a.root,'http-diagnostics.jsonl'))),{cause:error})}
 finally{if(p)await shutdown(a,p);a.cleanup()}
});

test('manual restart drains a committed library edit and returns its response before exit',async()=>{
 const a=area();a.responseHoldMs=500;let p;
 try{
  const port=await setup(a),started=start(a);p=started;await ready(a,p);
  const b=browser(port);await b.login();
  const opened=await b.call('library/open',{mock_plan:'Free'});assert.equal(opened.status,200);
  const chosen=await b.call('library/choose',{mock_plan:'Free',expected_revision:opened.value.snapshot.revision,kind:'watchlist',index:0});assert.equal(chosen.status,200);
  const edit=b.call('library/edit',{mock_plan:'Free',expected_revision:chosen.value.snapshot.revision,action:{type:'rename',kind:'watchlist',index:0,name:'committed-during-restart'}}).then(value=>({value}),error=>({error}));
  await until(()=>fixtureDiagnostics(path.join(a.root,'http-diagnostics.jsonl')).some(v=>v.event==='RESPONSE_HELD'));
  const restarting=control(a,'restart');
  const result=await edit;if(result.error)throw result.error;
  assert.equal(result.value.status,200);
  assert.equal((await restarting).ok,true);
  const after=await ready(a,p);assert.equal(after.phase,'running');
  assert.match(await b.names(),/committed-during-restart/);
  assert(!fixtureDiagnostics(path.join(a.root,'http-diagnostics.jsonl')).some(v=>v.event==='INCOMPLETE_RESPONSE'&&v.route==='/api/v1/library/edit'));
  await shutdown(a,p);noLocks(a);
 }finally{if(p)await shutdown(a,p);a.cleanup()}
});

test('live automatic backup preserves the serving instance and sessions; the actual archive restores accounts, lists and frozen shares',async()=>{
    const a=area();let p;
    try{
        const port=await setup(a);p=start(a);await ready(a,p);const b=browser(port);await b.login();await b.rename('automatic-backup-original');
        const req=m.createAnalysisRequest({...m.analysisDefaults('Free'),viewingDate:9},'automatic-frozen'),analysis=await b.call('analyses',req);assert.equal(analysis.status,200);
        const frozen=await b.call('shares/create',{delivery_id:analysis.value.request_id,request_key:m.requestKey(req),mock_plan:'Free'});assert.equal(frozen.status,200);
        const source=JSON.stringify(makeRsFixture({count:5,from:'2026-09-01'})),checked=await b.call('imports/validate',{text:source});assert.equal(checked.status,200);assert.equal((await b.call('imports/stage',{text:source,sha256:checked.value.report.sha256})).status,200);
        const before=await control(a),made=await control(a,'auto-backup-run');assert.equal(made.ok,true,JSON.stringify(made));assert.equal(made.status,'success');
        const after=await control(a);assert.equal(after.child_pid,before.child_pid);assert.deepEqual(after.active,before.active);assert.equal(after.automatic.verified,1);assert.equal(after.automatic.enabled,false);
        assert.match(await b.names(),/automatic-backup-original/);const overview=await b.call('admin/overview',{});assert.equal(overview.status,200);assert.equal(overview.value.host.automatic.verified,1);assert(!JSON.stringify(overview.value).includes(a.host));
        assert.equal(cli(a,'auto-backup',['--','configure','--enabled','true']).status,1);assert.equal(cli(a,'manager-install').status,1);
        const file=path.join(a.host,'auto-backups','auto-'+made.id+'.twrsbackup');assert(existsSync(file));await b.rename('latest-after-backup');
        await shutdown(a,p);noLocks(a);
        const restored=path.join(a.root,'restored'),tool=path.join(a.host,'releases','release-a','runtime/backup.mjs');
        const run=(operation,args=[])=>{const q=spawnSync(process.execPath,[tool,operation,'--data-dir',restored,'--file',file,...args],{encoding:'utf8',timeout:30000});assert.equal(q.status,0,q.stderr);return JSON.parse(q.stdout);};
        const preview=run('preview');assert.equal(preview.manifest.summary.accounts,1);assert.equal(preview.manifest.summary.frozen_shares,1);assert.equal(preview.manifest.summary.prices,JSON.parse(source).prices.length);run('restore',['--confirm',preview.confirmation_token]);
        const db=new DatabaseSync(path.join(restored,'library.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n,0);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n,1);assert.match(JSON.stringify(db.prepare('SELECT contents FROM workspace').all()),/automatic-backup-original/);assert(!JSON.stringify(db.prepare('SELECT contents FROM workspace').all()).includes('latest-after-backup'));assert.equal(db.prepare('SELECT COUNT(*) AS n FROM frozen_shares').get().n,1);}finally{db.close();}
        assert.equal(cli(a,'auto-backup',['--','protect','--id',made.id,'--protected','true']).status,0);
        const listing=cli(a,'auto-backup',['--','list']);assert.equal(listing.status,0);assert.equal(listing.value.entries[0].protected,true);
        p=start(a);await ready(a,p);const latest=browser(port);await latest.login();assert.match(await latest.names(),/latest-after-backup/);assert.equal((await request(port,'/api/v1/shares/'+frozen.value.token)).value.sha256,frozen.value.sha256);await shutdown(a,p);noLocks(a);
        assert(!readFileSync(path.join(a.host,'host-events.jsonl'),'utf8').includes(password));
    }finally{if(p)await shutdown(a,p);a.cleanup();}
});

test('enabled backup scheduling catches up at real host startup once, survives restarts and preserves the configured policy',async()=>{
    const a=area();let p;
    try{await setup(a);assert.equal(cli(a,'auto-backup',['--','configure','--enabled','true','--time','00:00','--keep-recent','2','--keep-daily','0','--keep-weekly','0']).status,0);
        const old=readFileSync(path.join(a.host,'backup-policy.json'),'utf8');assert.equal(cli(a,'auto-backup',['--','configure','--keep-recent','1']).status,1);assert.equal(readFileSync(path.join(a.host,'backup-policy.json'),'utf8'),old);
        p=start(a);await until(async()=>{const s=await control(a);return s.phase==='running'&&!s.busy&&s.automatic.verified===1;},20000);await shutdown(a,p);noLocks(a);
        const files=readdirSync(path.join(a.host,'auto-backups'));assert.equal(files.length,1);p=start(a);await ready(a,p);assert.deepEqual(readdirSync(path.join(a.host,'auto-backups')),files);assert.equal((await control(a)).automatic.enabled,true);await shutdown(a,p);noLocks(a);
    }finally{if(p)await shutdown(a,p);a.cleanup();}
});

test('stopped-host manager installation preserves the old manager and leaves program and data state unchanged',async()=>{
    const a=area();try{await setup(a);const target=path.join(a.host,'host.mjs'),old='/* synthetic old manager */';writeFileSync(target,old);const state=readFileSync(path.join(a.host,'state.json'),'utf8');
        const q=spawnSync(process.execPath,[manager,'manager-install','--root',a.host],{encoding:'utf8',timeout:15000});assert.equal(q.status,0,q.stderr);const result=JSON.parse(q.stdout);assert.equal(result.installed,true);assert.equal(readFileSync(path.join(a.host,result.previous_manager),'utf8'),old);assert.deepEqual(readFileSync(target),readFileSync(manager));assert.equal(readFileSync(path.join(a.host,'state.json'),'utf8'),state);assert.equal(cli(a,'manager-install').value.installed,false);noLocks(a);
    }finally{a.cleanup();}
});
test('host configuration requires exact loopback or HTTPS origin and bounded restart settings', () => { const c = m.defaultConfig(); for (const patch of [{ port: 80 }, { origin: 'http://localhost:8890' }, { origin: c.origin + '/' }, { mode: 'production', origin: 'http://stocks.example.invalid' }, { mode: 'production', origin: 'https://owner:secret@stocks.example.invalid' }, { restart_limit: 0 }, { health_timeout_ms: 0 }, { extra: true }])
    assert.throws(() => m.validateConfig({ ...c, ...patch })); assert.equal(m.validateConfig({ ...c, mode: 'production', origin: 'https://stocks.example.invalid' }).mode, 'production'); assert.throws(() => m.nodeCompatible('999.0.0')); });
test('release validates required files, paths, hashes, totals and immutable version identity', () => { const a = area(); try {
    const f = release(a, 'valid');
    assert.equal(m.stageRelease(a.host, f).release_id, 'valid');
    assert.equal(m.stageRelease(a.host, f).release_id, 'valid');
    for (const [name, edit] of [['traversal', v => v.files[0].path = 'web/../host.json'], ['duplicate', v => v.files.push({ ...v.files[0], path: v.files[0].path.toUpperCase() })], ['missing', v => v.files = v.files.filter(f => f.path !== 'runtime/serve.mjs')], ['size', v => v.files[0].bytes++], ['node', v => v.node_min = '999.0.0'], ['collision', v => v.created_at = '2026-01-01T00:00:00Z']]) {
        const x = path.join(a.root, name + '.twrsrelease');
        copyFileSync(f, x);
        rewrite(x, edit);
        assert.throws(() => m.stageRelease(a.host, x), name);
    }
    for (const suffix of ['truncated', 'extra', 'corrupt']) {
        const bytes = readFileSync(f), x = path.join(a.root, suffix);
        writeFileSync(x, suffix === 'truncated' ? bytes.subarray(0, -1) : suffix === 'extra' ? Buffer.concat([bytes, Buffer.from('x')]) : Buffer.concat([bytes.subarray(0, -1), Buffer.from([bytes.at(-1) ^ 1])]));
        assert.throws(() => m.stageRelease(a.host, x));
    }
    assert.equal(m.verifyInstalled(path.join(a.host, 'releases/valid')).release_id, 'valid');
}
finally {
    a.cleanup();
} });
test('installed release refuses unlisted files, modified content and directory junctions', () => { const a = area(); try {
    const f = release(a, 'valid');
    m.stageRelease(a.host, f);
    const dir = path.join(a.host, 'releases/valid'), extra = path.join(dir, 'web/private.json');
    writeFileSync(extra, '{"private":true}');
    assert.throws(() => m.verifyInstalled(dir), /清單外/);
    unlinkSync(extra);
    const asset = path.join(dir, 'web/assets/app.js'), original = readFileSync(asset);
    writeFileSync(asset, 'tampered');
    assert.throws(() => m.verifyInstalled(dir), /校驗/);
    writeFileSync(asset, original);
    const link = path.join(dir, 'web/link');
    symlinkSync(a.root, link, process.platform === 'win32' ? 'junction' : 'dir');
    assert.throws(() => m.verifyInstalled(dir), /連結/);
    unlinkSync(link);
}
finally {
    a.cleanup();
} });
test('data schema compatibility prevents destructive old-code rollback', () => { const a = area(); try {
    const f = release(a, 'valid'), v = m.stageRelease(a.host, f), data = path.join(a.root, 'data');
    mkdirSync(data);
    for (const name of ['library', 'imports']) {
        const db = new DatabaseSync(path.join(data, name + '.sqlite'));
        db.exec('PRAGMA user_version=99');
        db.close();
    }
    assert.throws(() => m.dataCompatible(data, v), /不相容/);
}
finally {
    a.cleanup();
} });
test('candidate gate admits only its private health probe, then serves static files and API together', async () => { const a = area(); let server; try {
    const web = path.join(a.root, 'web');
    mkdirSync(path.join(web, 'assets'), { recursive: true });
    writeFileSync(path.join(web, 'index.html'), '<title>host</title>');
    writeFileSync(path.join(web, 'assets/app.js'), 'console.log(1)');
    writeFileSync(path.join(web, 'library.sqlite'), 'not public');
    let available = false;
    server = m.createMockServer({ dataDirectory: path.join(a.root, 'data'), staticDirectory: web, availability: { ready: () => available, probe: 'a'.repeat(64) } });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    for (const route of ['/', '/api/v1/auth/session', '/api/v1/health'])
        assert.equal((await request(port, route)).status, 503);
    const probe=await request(port, '/api/v1/health', { headers: { 'X-TWRS-Probe': 'a'.repeat(64) } });assert.equal(probe.status,200);assert.deepEqual(probe.value.monitor,{version:1,storage_ok:true,records_available:true});
    assert.equal((await request(port, '/api/v1/health', { headers: { 'X-TWRS-Probe': 'é'.repeat(64) } })).status, 503);
    assert.equal((await request(port, '/api/v1/auth/session', { headers: { 'X-TWRS-Probe': 'a'.repeat(64) } })).status, 503);
    available = true;
    const html = await request(port);
    assert.equal(html.status, 200);
    assert.equal(html.headers['cache-control'], 'no-store');
    assert.match(html.headers['content-security-policy'], /frame-ancestors 'none'/);
    const js = await request(port, '/assets/app.js', { method: 'HEAD' });
    assert.equal(js.status, 200);
    assert.equal(js.text, '');
    assert.match(js.headers['cache-control'], /immutable/);
    assert.equal((await request(port, '/', { body: {} })).status, 405);
    for (const route of ['/library.sqlite', '/host.json', '/runtime/serve.mjs', '/%2e%2e%2flibrary.sqlite', '/assets/%5cprivate.json', '/unknown'])
        assert.equal((await request(port, route)).status, 404);
    assert.equal((await request(port, '/api/v1/health')).status, 200);
}
finally {
    if (server) {
        server.closeAllConnections();
        await new Promise(r => server.close(r));
    }
    a.cleanup();
} });
test('standalone host updates and rolls back code while preserving latest accounts, lists and frozen shares', async () => {
    const a = area();
    let p, phase='initial-start';
    try {
        const port = await setup(a), initial = m.current(a.host);
        assert(!existsSync(path.join(a.host, 'node_modules')));
        p = start(a);
        await ready(a, p);
        assert.match((await request(port)).text, /release-a/);
        const b = browser(port);
        phase='initial-login'; await b.login();
        phase='initial-library';
        await b.rename('before-update');
        const req = m.createAnalysisRequest({ ...m.analysisDefaults('Free'), viewingDate: 9 }, 'host-frozen'), analysis = await b.call('analyses', req);
        assert.equal(analysis.status, 200);
        const frozen = await b.call('shares/create', { delivery_id: analysis.value.request_id, request_key: m.requestKey(req), mock_plan: 'Free' });
        assert.equal(frozen.status, 200);
        const token = frozen.value.token, hash = frozen.value.sha256;
        phase='update';
        const second = release(a, 'release-b'), update = await control(a, 'update', { archive: second });
        assert.equal(update.ok, true, JSON.stringify(update));
        assert.equal(update.active.release, 'release-b');
        assert.notEqual(update.active.data, initial.active.data);
        assert.equal(update.previous.data, initial.active.data);
        assert(readdirSync(path.join(a.host, 'backups')).some(n => n.endsWith('.twrsbackup')));
        assert.match((await request(port)).text, /release-b/);
        assert.equal((await b.call('library/open', { mock_plan: 'Free' })).status, 401);
        const after = browser(port);
        phase='updated-login';
        await after.login();
        phase='updated-library';
        assert.match(await after.names(), /before-update/);
        await after.rename('accepted-after-update');
        assert.equal((await request(port, '/api/v1/shares/' + token)).value.sha256, hash);
        phase='rollback'; const rollback = await control(a, 'rollback');
        assert.equal(rollback.ok, true, JSON.stringify(rollback));
        assert.equal(rollback.active.release, 'release-a');
        assert.notEqual(rollback.active.data, initial.active.data);
        const latest = browser(port);
        phase='rollback-login';
        await latest.login();
        phase='rollback-library';
        assert.match(await latest.names(), /accepted-after-update/);
        assert.equal((await request(port, '/api/v1/shares/' + token)).value.sha256, hash);
        assert(existsSync(path.join(a.host, 'data', initial.active.data, 'library.sqlite')));
        assert.equal(readdirSync(path.join(a.host, 'backups')).length, 2);
        await shutdown(a, p);
        noLocks(a);
        assert(!p.logs().includes(password)); const events=readFileSync(path.join(a.host,'host-events.jsonl'),'utf8');assert.match(events,/update_committed/);assert(!events.includes(password));
    }
    catch(error) {
        // Only bounded, structured lifecycle events from this synthetic fixture.
        const status=await control(a).then(v=>({phase:v.phase,busy:v.busy,child_pid:v.child_pid,restarts:v.restarts_in_window}),()=>({unavailable:true}));
        const events=path.join(a.host,'host-events.jsonl');
        const trace=existsSync(events)?readFileSync(events,'utf8').trim().split('\n').slice(-32).map(line=>{try{const v=JSON.parse(line);return {at:v.at,event:v.event,code:v.code}}catch{return {event:'unparseable'}}}):[];
        const http=fixtureDiagnostics(path.join(a.root,'http-diagnostics.jsonl'));
        throw new Error(error.message+'; test_phase='+phase+'; owned_host_status='+JSON.stringify(status)+'; owned_host_events='+JSON.stringify(trace)+'; owned_http_events='+JSON.stringify(http),{cause:error});
    }
    finally {
        if (p)
            await shutdown(a, p);
        a.cleanup();
    }
});
test('failed candidate restores original code and original data; incompatible release is refused before stopping', async () => { const a = area(); let p; try {
    const port = await setup(a);
    p = start(a);
    await ready(a, p);
    const b = browser(port);
    await b.login();
    await b.rename('keep-original');
    const from = m.current(a.host), bad = release(a, 'bad-start', stage => writeFileSync(path.join(stage, 'runtime/serve.mjs'), 'process.exit(73);'));
    const r = await control(a, 'update', { archive: bad });
    assert.equal(r.ok, false);
    assert.deepEqual(m.current(a.host), from);
    assert.equal((await control(a)).phase, 'running');
    assert.match(await b.names(), /keep-original/);
    assert.match((await request(port)).text, /release-a/);
    assert(!existsSync(path.join(a.host, 'transition.json')));
    assert(readdirSync(path.join(a.host, 'data')).filter(n => n.startsWith('generation-')).length >= 2);
    const beforePid = (await control(a)).child_pid, incompatible = release(a, 'incompatible');
    rewrite(incompatible, v => v.schemas.library = [99, 99]);
    const rejected = await control(a, 'update', { archive: incompatible });
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /不相容/);
    assert.equal((await control(a)).child_pid, beforePid);
    assert.deepEqual(m.current(a.host), from);
}
finally {
    if (p)
        await shutdown(a, p);
    a.cleanup();
} });
test('authenticated local control refuses forged tokens, stale state and live-host recovery', async () => { const a = area(); let p; try {
    await setup(a);
    p = start(a);
    const s = await ready(a, p);
    assert.equal((await control(a, 'stop', { token: '0'.repeat(64) })).ok, false);
    assert.equal((await control(a, 'restart', { revision: s.revision + 1 })).ok, false);
    assert.equal((await control(a, 'status', { unexpected: true })).ok, false);
    assert.equal(cli(a, 'recover').status, 1);
    assert.equal(cli(a, 'account', ['--', 'list']).status, 1);
    const publicStatus = JSON.stringify(await control(a));
    assert(!publicStatus.includes(m.readJson(path.join(a.host, 'control.json')).token));
    assert(!publicStatus.includes('password'));
    assert.equal((await control(a, 'restart')).ok, true);
    await ready(a, p);
}
finally {
    if (p)
        await shutdown(a, p);
    a.cleanup();
} });
test('owned child crashes restart automatically with a limit and preserve data', async () => { const a = area(); let p; try {
    const port = await setup(a);
    p = start(a);
    let s = await ready(a, p);
    const b = browser(port);
    await b.login();
    await b.rename('survives-crash');
    for (let n = 0; n < 2; n++) {
        const pid = s.child_pid;
        process.kill(pid, 'SIGKILL');
        s = await until(async () => { const v = await control(a); return v.phase === 'running' && !v.busy && v.child_pid !== pid && v; }, 10000);
        assert.equal(s.restarts_in_window, n + 1);
        assert.match(await b.names(), /survives-crash/);
    }
    process.kill(s.child_pid, 'SIGKILL');
    const failed = await until(async () => { const v = await control(a); return v.phase === 'failed' && !v.busy && v; });
    assert.equal(failed.child_pid, null);
    assert.equal(failed.monitoring.incidents.filter(i=>i.code==='SERVICE_UNAVAILABLE'&&i.recovered_at===null).length,1);
    await pause(400);
    assert.equal((await control(a)).phase, 'failed');
    assert.equal((await control(a)).restarts_in_window, 2);
    assert.equal((await control(a, 'restart')).ok, true);
    assert.match(await b.names(), /survives-crash/);
}
finally {
    if (p)
        await shutdown(a, p);
    a.cleanup();
} });
test('parent interruption closes its child and next run recovers stale locks without reverting accepted data', async () => { const a = area(); let p; try {
    const port = await setup(a);
    p = start(a);
    const running = await ready(a, p), b = browser(port);
    await b.login();
    await b.rename('accepted-before-interruption');
    p.kill('SIGKILL');
    await p.done;
    await until(() => { try {
        process.kill(running.child_pid, 0);
        return false;
    }
    catch (e) {
        return e.code === 'ESRCH';
    } }, 7000);
    p = start(a);
    await ready(a, p);
    assert.match(await b.names(), /accepted-before-interruption/);
    await shutdown(a, p);
    noLocks(a);
}
finally {
    if (p)
        await shutdown(a, p);
    a.cleanup();
} });
test('update journal recovery honors the committed state on both sides of the commit point', async () => { const a = area(); let p; try {
    const port = await setup(a), from = m.current(a.host), to = { ...from, revision: 2, active: { ...from.active, data: 'generation-not-committed' }, previous: from.active, updated_at: new Date().toISOString() };
    m.atomicJson(path.join(a.host, 'transition.json'), { format: 'TWStockRS-host-transition', version: 1, from, to });
    p = start(a);
    await ready(a, p);
    assert.deepEqual(m.current(a.host), from);
    assert.match(p.logs(), /not_committed/);
    const b = browser(port);
    await b.login();
    await b.rename('newer-data');
    await control(a, 'update', { archive: release(a, 'release-b') });
    const committed = m.current(a.host);
    await shutdown(a, p);
    m.atomicJson(path.join(a.host, 'transition.json'), { format: 'TWStockRS-host-transition', version: 1, from, to: committed });
    p = start(a);
    await ready(a, p);
    assert.deepEqual(m.current(a.host), committed);
    assert.match(p.logs(), /committed/);
    const c = browser(port);
    await c.login();
    assert.match(await c.names(), /newer-data/);
    assert(!existsSync(path.join(a.host, 'transition.json')));
}
finally {
    if (p)
        await shutdown(a, p);
    a.cleanup();
} });
test('production refuses missing administrator, validates exact origin, and emits Secure session cookies', async () => { const a = area(); let p; try {
    const port = await setup(a, { production: true, admin: false });
    p = start(a);
    assert.equal(await p.done, 1);
    noLocks(a);
    assert.equal(cli(a, 'account', ['--', 'create', '--username', 'owner', '--role', 'admin'], JSON.stringify({ password })).status, 0);
    p = start(a);
    await ready(a, p);
    assert.equal((await request(port)).status, 403);
    const host = 'stocks.example.invalid';
    assert.equal((await request(port, '/', { headers: { Host: host } })).status, 200);
    assert.equal((await request(port, '/api/v1/auth/session', { headers: { Host: host, Origin: 'https://outside.invalid' } })).status, 403);
    assert.equal((await request(port, '/api/v1/auth/session', { headers: { Host: host, 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
    const session = await request(port, '/api/v1/auth/session', { headers: { Host: host, Origin: 'https://' + host } });
    assert.equal(session.status, 200);
    assert.match(session.headers['set-cookie'][0], /Secure;/);
    const b = browser(port, host);
    await b.login();
    await b.rename('formal-cookie-policy');
}
finally {
    if (p)
        await shutdown(a, p);
    a.cleanup();
} });
test('occupied port fails closed without terminating its existing listener or replacing data', async () => { const a = area(); let p, s; try {
    const port = await setup(a), before = m.current(a.host);
    s = createServer(socket => socket.destroy());
    await new Promise(r => s.listen(port, '127.0.0.1', r));
    p = start(a);
    assert.equal(await p.done, 1);
    assert(s.listening);
    assert.deepEqual(m.current(a.host), before);
    noLocks(a);
}
finally {
    if (p)
        await shutdown(a, p);
    if (s)
        await new Promise(r => s.close(r));
    a.cleanup();
} });
test('boot templates are reviewable files only, protect paths, and refuse overwriting', async () => { const a = area(); try {
    await setup(a);
    const r = cli(a, 'templates', ['--user', 'synthetic-service']);
    assert.equal(r.status, 0);
    assert.match(readFileSync(path.join(a.host, 'twstockrs-task.xml'), 'utf8'), /<BootTrigger>/);
    assert.match(readFileSync(path.join(a.host, 'twstockrs.service'), 'utf8'), /Restart=on-failure/);
    assert.match(readFileSync(path.join(a.host, 'Caddyfile.example'), 'utf8'), /reverse_proxy 127\.0\.0\.1:/);
    assert.equal(cli(a, 'templates', ['--user', 'other']).status, 1);
    assert(!existsSync(path.join(a.host, 'control.json')));
}
finally {
    a.cleanup();
} });
test('hung service is detected, forcibly replaced and bounded without deleting retained generations', async () => { const a = area(); let p; try {
    await setup(a);
    p = start(a);
    await ready(a, p);
    const hung = release(a, 'hung-service', stage => { const f = path.join(stage, 'runtime/serve.mjs'); writeFileSync(f, "process.on('message',m=>{if(m?.type==='boot')setTimeout(()=>{while(true){}},1400)});\n" + readFileSync(f, 'utf8')); });
    assert.equal((await control(a, 'update', { archive: hung })).ok, true);
    const failed = await until(async () => { const v = await control(a); return v.phase === 'failed' && !v.busy && v; }, 20000);
    assert.equal(failed.restarts_in_window, 2);
    assert.equal(failed.child_pid, null);
    assert.equal((await control(a, 'rollback')).ok, true);
    assert.equal((await control(a)).active.release, 'release-a');
}
finally {
    if (p)
        await shutdown(a, p);
    a.cleanup();
} });
test('state committed before activation failure stays authoritative; explicit rollback keeps that data generation', async () => { const a = area(); let p; try {
    const port = await setup(a);
    p = start(a);
    await ready(a, p);
    const b = browser(port);
    await b.login();
    await b.rename('accepted-before-commit');
    const from = m.current(a.host), bad = release(a, 'activation-fails', stage => { const f = path.join(stage, 'runtime/serve.mjs'); writeFileSync(f, "process.prependListener('message',m=>{if(m?.type==='activate')process.exit(74)});\n" + readFileSync(f, 'utf8')); });
    const pending = control(a, 'update', { archive: bad });
    await until(async () => { const s = await control(a); return s.busy && s.phase === 'updating'; });
    const busy = await control(a, 'restart');
    assert.equal(busy.ok, false);
    assert.match(busy.error, /另一項/);
    const result = await pending;
    assert.equal(result.ok, false);
    const committed = m.current(a.host);
    assert.equal(committed.active.release, 'activation-fails');
    assert.equal(committed.revision, from.revision + 1);
    assert.notEqual(committed.active.data, from.active.data);
    assert.equal((await control(a)).phase, 'failed');
    assert(existsSync(path.join(a.host, 'transition.json')));
    assert.equal((await control(a, 'rollback')).ok, true);
    const c = browser(port);
    await c.login();
    assert.match(await c.names(), /accepted-before-commit/);
    assert.notEqual(m.current(a.host).active.data, from.active.data);
}
finally {
    if (p)
        await shutdown(a, p);
    a.cleanup();
} });
test('manual rollback refuses an old release schema range while current service remains usable', async () => { const a = area(); let p; try {
    const port = await setup(a);
    const original = path.join(a.root, 'release-a.twrsrelease');
    rewrite(original, v => v.schemas.library = [1, 2]);
    const oldManifest = m.readJson(path.join(a.host, 'releases/release-a/manifest.json'));
    oldManifest.schemas.library = [1, 2];
    m.atomicJson(path.join(a.host, 'releases/release-a/manifest.json'), oldManifest);
    const second = release(a, 'release-b');
    m.stageRelease(a.host, second);
    const old = m.current(a.host);
    m.atomicJson(path.join(a.host, 'state.json'), { ...old, revision: 2, active: { ...old.active, release: 'release-b' }, previous: old.active });
    p = start(a);
    await ready(a, p);
    const before = await control(a), r = await control(a, 'rollback');
    assert.equal(r.ok, false);
    assert.match(r.error, /不相容/);
    assert.equal((await control(a)).child_pid, before.child_pid);
    assert.match((await request(port)).text, /release-b/);
}
finally {
    if (p)
        await shutdown(a, p);
    a.cleanup();
} });


test('monitoring survives a real child crash, records recovery and delivers a local test without leaking public telemetry',async()=>{
 const a=area();let p;try{
  const port=await setup(a);p=start(a);const initial=await ready(a,p);const b=browser(port);await b.login();
  assert.equal((await request(port,'/api/v1/health')).value.monitor,undefined);
  const anon=browser(port);await anon.call('auth/session');assert.equal((await anon.call('admin/overview',{})).status,403);
  assert.equal(cli(a,'monitor',['--','configure','--enabled','false']).status,1);
  assert.equal((await control(a,'monitor-test')).queued,true);let status=await control(a);assert.equal(status.monitoring.delivered,1);
  process.kill(initial.child_pid,'SIGKILL');
  status=await until(async()=>{const s=await control(a);return s.phase==='running'&&!s.busy&&s.child_pid!==initial.child_pid&&s;});
  await until(async()=>{const s=await control(a);return s.monitoring.delivered===3;});
  const overview=await b.call('admin/overview',{});assert.equal(overview.status,200);const v=overview.value.host.monitoring;assert.equal(v.incidents.length,1);assert.equal(v.incidents[0].code,'SERVICE_UNAVAILABLE');assert(v.incidents[0].recovered_at!==null);assert(!JSON.stringify(v).includes(a.host));
  assert.equal((await request(port,'/monitor-state.json')).status,404);
  await shutdown(a,p);const saved=cli(a,'monitor',['--','status']);assert.equal(saved.status,0);assert.equal(saved.value.delivered,3);
  p=start(a);await ready(a,p);assert.equal((await control(a)).monitoring.notifications.length,3);
  await control(a,'restart');assert.equal((await control(a)).monitoring.incidents.length,1);
  await shutdown(a,p);noLocks(a);
 }finally{if(p)await shutdown(a,p);a.cleanup();}
});

test('monitor policy changes require stopped ownership and invalid or corrupt files remain untouched',async()=>{
 const a=area();let p;try{await setup(a);assert.equal(cli(a,'monitor',['--','configure','--trigger-samples','2','--min-free-mb','512']).status,0);const file=path.join(a.host,'monitor-policy.json'),before=readFileSync(file);assert.equal(cli(a,'monitor',['--','configure','--webhook','https://example.invalid']).status,1);assert.deepEqual(readFileSync(file),before);p=start(a);await ready(a,p);assert.equal((await control(a)).monitoring.trigger_samples,2);await shutdown(a,p);writeFileSync(path.join(a.host,'monitor-state.json'),'unreadable original');p=start(a);await ready(a,p);const s=await control(a);assert.equal(s.monitoring.available,false);assert.equal(s.monitor_fault,true);assert.equal(readFileSync(path.join(a.host,'monitor-state.json'),'utf8'),'unreadable original');await shutdown(a,p);noLocks(a);}finally{if(p)await shutdown(a,p);a.cleanup();}
});

test('manual restart failure is a monitored failed phase and explicit repair records recovery',async()=>{const a=area();let p;try{await setup(a);p=start(a);await ready(a,p);const web=path.join(a.host,'releases/release-a/web/index.html'),before=readFileSync(web);writeFileSync(web,'unexpected modified entry');assert.equal((await control(a,'restart')).ok,false);let s=await control(a);assert.equal(s.phase,'failed');assert.equal(s.monitoring.incidents.filter(i=>i.code==='SERVICE_UNAVAILABLE'&&i.recovered_at===null).length,1);writeFileSync(web,before);assert.equal((await control(a,'restart')).ok,true);s=await control(a);assert.equal(s.monitoring.incidents[0].recovered_at!==null,true);await shutdown(a,p);noLocks(a);}finally{if(p)await shutdown(a,p);a.cleanup();}});


test('unsafe Windows host initialization is rejected before creating its root; Linux remains unrestricted',async()=>{const a=area();try{a.host=path.join(a.root,'x'.repeat(150-a.root.length-1));const file=release(a,'path-init');const r=cli(a,'init',['--release',file]);if(process.platform==='win32'){assert.equal(r.status,1);assert.match(r.stderr,/路徑過長/);assert(!existsSync(a.host));}else{assert.equal(r.status,0,r.stderr);assert.equal(m.current(a.host).active.release,'path-init');}}finally{a.cleanup();}});

test('existing deep Windows hosts reject update and rollback before stopping, staging a release or changing data',async()=>{const a=area();let p;try{const port=await setup(a),backup=path.join(a.root,'retained.twrsbackup');assert.equal(cli(a,'backup',['--','create','--file',backup]).status,0);const old=a.host,deep=path.join(a.root,'x'.repeat(150-a.root.length-1));assert(deep.startsWith(a.root+path.sep));renameSync(old,deep);a.host=deep;p=start(a);const before=await ready(a,p),b=browser(port);await b.login();await b.rename('path-protection-original');const names=await b.names(),state=readFileSync(path.join(a.host,'state.json')),candidate=release(a,'path-candidate');if(process.platform==='win32'){const checked=cli(a,'path-check');assert.equal(checked.status,1);assert.match(checked.stderr,/路徑過長/);const preview=cli(a,'backup',['--','preview','--file',backup]);assert.equal(preview.status,1);assert.match(preview.stderr,/路徑過長/);for(const operation of ['update','rollback']){const r=await control(a,operation,operation==='update'?{archive:candidate}:{});assert.equal(r.ok,false);assert.match(r.error,/路徑過長/);assert.equal((await control(a)).child_pid,before.child_pid);}assert(!existsSync(path.join(a.host,'transition.json')));assert(!existsSync(path.join(a.host,'releases/path-candidate')));assert.deepEqual(readFileSync(path.join(a.host,'state.json')),state);assert.equal(await b.names(),names);}else{const checked=cli(a,'path-check');assert.equal(checked.status,0,checked.stderr);assert.equal(checked.value.windows_protection,false);assert.equal((await control(a,'update',{archive:candidate})).ok,true);const c=browser(port);await c.login();assert.match(await c.names(),/path-protection-original/);}await shutdown(a,p);noLocks(a);}finally{if(p)await shutdown(a,p);a.cleanup();}});


test('new launcher rejects unsafe update paths before contacting any running manager',async()=>{const a=area();try{await setup(a);const old=a.host,deep=path.join(a.root,'x'.repeat(150-a.root.length-1));renameSync(old,deep);a.host=deep;const file=release(a,'path-no-control'),before=readFileSync(path.join(a.host,'state.json')),r=cli(a,'update',['--release',file]);assert.equal(r.status,1);if(process.platform==='win32')assert.match(r.stderr,/路徑過長/);else assert.match(r.stderr,/control.json|ENOENT/);assert(!existsSync(path.join(a.host,'releases/path-no-control')));assert.deepEqual(readFileSync(path.join(a.host,'state.json')),before);assert(!existsSync(path.join(a.host,'.supervisor.twstockrs-lock')));}finally{a.cleanup();}});
