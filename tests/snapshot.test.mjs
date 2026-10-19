import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdtempSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {request as httpRequest} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
const built=await build({stdin:{contents:"export * from './server/snapshotCoordinator';export * from './server/app';export * from './components/twstock/model';export * from './shared/mockAnalysis';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'cjs',platform:'node',logLevel:'silent'});
const compiled={exports:{}};new Function('require','module','exports',built.outputFiles[0].text)(createRequire(import.meta.url),compiled,compiled.exports);const m=compiled.exports;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}}

test('snapshot drains admitted operations, then holds new operations until the background copy completes',async()=>{
    const c=new m.SnapshotCoordinator(),one=await c.enter(),two=await c.enter(),copy=deferred();let started=false,admitted=false;
    const capture=c.capture(async()=>{started=true;await copy.promise});const late=c.enter().then(release=>{admitted=true;return release});
    await pause(10);assert.equal(started,false);one();one();await pause(10);assert.equal(started,false);
    two();await pause(10);assert.equal(started,true);assert.equal(admitted,false);copy.resolve();await capture;
    const release=await late;assert.equal(admitted,true);release();await c.close();
});

test('snapshot failures release admission without permitting concurrent copies',async()=>{
    const c=new m.SnapshotCoordinator(),copy=deferred();
    const capture=c.capture(async()=>{await copy.promise;throw Error('Synthetic disk error')});
    await assert.rejects(c.capture(async()=>{}),e=>e.code==='BACKUP_BUSY');const pending=c.enter();
    copy.resolve();await assert.rejects(capture,/Synthetic disk/);(await pending)();
    await c.capture(async()=>{});(await c.enter())();await c.close();
});

test('cancelled backup waiters release their bounded slot and cannot acquire a stale lease',async()=>{
    const c=new m.SnapshotCoordinator(1),copy=deferred(),controller=new AbortController();
    const capture=c.capture(async()=>{await copy.promise});const cancelled=c.enter(controller.signal);
    await assert.rejects(c.enter(),e=>e.code==='BACKUP_BUSY'&&e.status===429);
    controller.abort();await assert.rejects(cancelled);let admitted=false;
    const replacement=c.enter().then(release=>{admitted=true;return release});await pause(10);assert.equal(admitted,false);
    copy.resolve();await capture;(await replacement)();await c.close();
});

test('snapshot deadlines abandon waiting for old operations and leave no admission deadlock',async()=>{
    const c=new m.SnapshotCoordinator(2,30),release=await c.enter();let started=false;
    await assert.rejects(c.capture(async()=>{started=true}));assert.equal(started,false);release();
    (await c.enter())();await c.capture(async()=>{});await c.close();
});

test('stopping cancels a running snapshot, rejects pending admissions and never starts another worker',async()=>{
    const c=new m.SnapshotCoordinator(),started=deferred();
    const capture=c.capture(signal=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});started.resolve()}));
    const failed=assert.rejects(capture,/cancelled/),pending=assert.rejects(c.enter());
    await started.promise;await c.close();await failed;await pending;await assert.rejects(c.enter());await assert.rejects(c.capture(async()=>{}));
});

test('real HTTP backup contains completed writes and audit records, excludes queued later writes, and keeps health responsive',async()=>{
    const root=mkdtempSync(path.join(tmpdir(),'twrs-snapshot-')),server=m.createMockServer({dataDirectory:path.join(root,'data'),testOnlyMockAuth:true});
    try{
        await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/api/v1/';
        async function call(route,body){const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15_000)});assert.equal(r.status,200);return r.json()}
        let v=await call('library/open',{mock_plan:'Free'});v=await call('library/choose',{mock_plan:'Free',expected_revision:v.snapshot.revision,kind:'watchlist',index:0});
        const first={mock_plan:'Free',expected_revision:v.snapshot.revision,action:{type:'rename',kind:'watchlist',index:0,name:'completed-before-copy'}},text=JSON.stringify(first);
        function partial(route,text){const arrived=new Promise(r=>server.once('request',r));let req;const reply=new Promise((resolve,reject)=>{req=httpRequest(base+route,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(text)}},response=>{let data='';response.on('data',b=>data+=b);response.on('end',()=>resolve({status:response.statusCode,value:JSON.parse(data)}))});req.on('error',reject);req.write(text.slice(0,20))});return {arrived,reply,finish:()=>req.end(text.slice(20))}}
        const firstPending=partial('library/edit',text);await firstPending.arrived;
        const analysisPending=partial('analyses',JSON.stringify({...m.createAnalysisRequest({...m.analysisDefaults('Free'),viewingDate:9},'snapshot-audit'),period:0}));await analysisPending.arrived;
        const target=path.join(root,'snapshot');const copying=server.writeBackupSnapshot(target);
        await pause(10);assert(!existsSync(target),'Snapshot must wait for the already admitted body and its completed write');
        const later=call('library/edit',{mock_plan:'Free',expected_revision:v.snapshot.revision+1,action:{type:'rename',kind:'watchlist',index:0,name:'queued-after-copy'}});
        let invalidHealthFinished=false;const invalidHealth=fetch(base+'health',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>{invalidHealthFinished=true;return r});
        const healthStart=performance.now();assert.equal((await call('health')).status,'ok');assert(performance.now()-healthStart<2000);
        assert.equal(invalidHealthFinished,false,'Only the read-only GET health route can bypass a snapshot');
        firstPending.finish();analysisPending.finish();const firstResult=await firstPending.reply;assert.equal(firstResult.status,200);const analyzed=await analysisPending.reply;assert.equal(analyzed.status,422);
        await copying;await later;assert.equal((await invalidHealth).status,405);
        const db=new DatabaseSync(path.join(target,'library.sqlite'),{readOnly:true});
        try{assert.equal(JSON.parse(db.prepare("SELECT contents FROM workspace WHERE owner='local-workspace'").get().contents).watchlists[0].name,'completed-before-copy');assert.equal(db.prepare('PRAGMA quick_check').get().quick_check,'ok');assert(db.prepare('SELECT event FROM auth_events').all().some(row=>String(row.event).includes(analyzed.value.error.request_id)),'Completed error audit must be included in the same snapshot')}finally{db.close()}
        assert.equal((await call('library/open',{mock_plan:'Free'})).snapshot.library.watchlists[0].name,'queued-after-copy');
        await assert.rejects(server.writeBackupSnapshot(target));
        assert.equal((await call('library/open',{mock_plan:'Free'})).snapshot.library.watchlists[0].name,'queued-after-copy');
    }finally{await new Promise(r=>{server.close(r);server.closeAllConnections()});assert.equal(path.dirname(root),path.resolve(tmpdir()));assert(path.basename(root).startsWith('twrs-snapshot-'));rmSync(root,{recursive:true,force:true})}
});

test('closing the HTTP service cancels a snapshot waiting for a partial request and releases its data lock',async()=>{
    const root=mkdtempSync(path.join(tmpdir(),'twrs-snapshot-stop-')),directory=path.join(root,'data'),server=m.createMockServer({dataDirectory:directory,testOnlyMockAuth:true});
    let closed=false;
    try{
        await new Promise(r=>server.listen(0,'127.0.0.1',r));const arrived=new Promise(r=>server.once('request',r));
        const req=httpRequest('http://127.0.0.1:'+server.address().port+'/api/v1/library/open',{method:'POST',headers:{'Content-Type':'application/json','Content-Length':20}});req.on('error',()=>{});req.write('{');await arrived;
        const target=path.join(root,'snapshot'),copying=assert.rejects(server.writeBackupSnapshot(target));
        await new Promise(r=>{server.close(r);server.closeAllConnections()});closed=true;await copying;req.destroy();assert(!existsSync(target));
        const reopened=m.createMockServer({dataDirectory:directory,testOnlyMockAuth:true});await new Promise(r=>reopened.close(r));
    }finally{if(!closed)await new Promise(r=>{server.close(r);server.closeAllConnections()});assert.equal(path.dirname(root),path.resolve(tmpdir()));assert(path.basename(root).startsWith('twrs-snapshot-stop-'));rmSync(root,{recursive:true,force:true})}
});
