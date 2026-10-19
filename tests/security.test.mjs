import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {request as httpRequest} from 'node:http';
import {PassThrough} from 'node:stream';
import {createHash} from 'node:crypto';
import {createServer as createViteServer} from 'vite';

const bundle=await build({stdin:{contents:`export * from './server/app';export * from './server/libraryStore';export * from './server/authStore';export * from './server/requestBody';export * from './server/httpPolicy';export * from './shared/mockAnalysis';export * from './components/twstock/model';export * from './components/twstock/chartOptions';export * from './components/twstock/exportData';`,resolveDir:process.cwd(),loader:'ts'},write:false,bundle:true,platform:'node',format:'cjs',logLevel:'silent'});
const mod={exports:{}};
new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(import.meta.url),mod,mod.exports);
const m=mod.exports, password='Synthetic security acceptance passphrase!';
const digest=value=>createHash('sha256').update(value).digest('hex');
function area(){
    const root=mkdtempSync(path.join(tmpdir(),'twrs-security-'));
    const library=new m.LibraryStore(path.join(root,'data/library.sqlite'));
    let now=Date.now();
    const auth=new m.AuthStore(library.connection,()=>now);
    return {root,library,auth,now:()=>now,tick:ms=>now+=ms,close(){library.close();},clean(){assert(path.basename(root).startsWith('twrs-security-'));rmSync(root,{recursive:true,force:true});}};
}
function browser(auth){
    let cookie='',session;
    const request=()=>({headers:{cookie,'x-workspace-id':session?.owner,'x-auth-rights':session?.rights,'x-csrf-token':session?.csrf}});
    const response={setHeader(name,value){if(name==='Set-Cookie')cookie=value.split(';')[0];}};
    return {request,response,get session(){return session;},open(){session=auth.session(request(),response);return session;},async login(username,pw=password){session=await auth.login(request(),response,{username,password:pw});return session;}};
}
async function httpFixture(options={}){
    const a=area();
    await a.auth.createAccount('owner',password,'admin');
    await a.auth.createAccount('alice',password,'user','Pro',a.now()+3600_000);
    await a.auth.createAccount('bravo',password);
    a.close();
    const web=path.join(a.root,'web');mkdirSync(web);
    writeFileSync(path.join(web,'index.html'),'<!doctype html><title>Security acceptance</title>');
    const server=m.createMockServer({dataDirectory:path.join(a.root,'data'),staticDirectory:web,now:a.now,...options});
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const base='http://127.0.0.1:'+server.address().port;
    function jar(){
        let cookie='',session;
        return {get cookie(){return cookie;},get session(){return session;},headers(){return {Cookie:cookie,'X-Workspace-Id':session?.owner,'X-Auth-Rights':session?.rights,'X-CSRF-Token':session?.csrf};},async call(route,body,extra={}){
            const response=await fetch(base+'/api/v1/'+route,{method:body===undefined?'GET':'POST',headers:{...this.headers(),...(body===undefined?{}:{'Content-Type':'application/json'}),...extra},...(body===undefined?{}:{body:JSON.stringify(body)})});
            if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
            const value=(response.headers.get('content-type')||'').includes('application/json')?await response.json():Buffer.from(await response.arrayBuffer());
            if(value?.session)session=value.session;
            return {status:response.status,value,headers:response.headers};
        },open(){return this.call('auth/session');},login(username){return this.call('auth/login',{username,password});}};
    }
    return {...a,base,server,jar,async stop(){server.closeAllConnections();await new Promise(r=>server.close(r));a.clean();}};
}
function raw(base,target,{headers={},body,method='GET'}={}){
    return new Promise((resolve,reject)=>{
        const url=new URL(base),req=httpRequest({hostname:url.hostname,port:url.port,path:target,method,headers},res=>{
            const parts=[];res.on('data',chunk=>parts.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(parts).toString()}));
        });
        req.on('error',reject);req.end(body);
    });
}

test('rotating unknown usernames cannot bypass the persistent service login budget',async()=>{
    const a=area();try{
        const b=browser(a.auth);b.open();
        for(let i=0;i<30;i++)await assert.rejects(()=>b.login('unknown-'+i),e=>e.code==='LOGIN_FAILED'&&e.status===401);
        const reopened=new m.AuthStore(a.library.connection,a.now);
        await assert.rejects(()=>reopened.login(b.request(),b.response,{username:'different-user',password}),e=>e.code==='LOGIN_SERVICE_LIMIT'&&e.status===429);
        assert.equal(a.library.connection.prepare('SELECT COUNT(*) AS n FROM auth_attempts').get().n,32); // session budget, login budget, 30 attempted accounts
        a.tick(60_001);
        await assert.rejects(()=>reopened.login(b.request(),b.response,{username:'different-user',password}),e=>e.code==='LOGIN_FAILED');
    }finally{a.close();a.clean();}
});

test('active attempt rows fail closed at capacity, expired records are removed without clearing active account locks',async()=>{
    const a=area();try{
        const b=browser(a.auth);b.open();
        const insert=a.library.connection.prepare('INSERT INTO auth_attempts VALUES (?,5,?)');
        for(let i=0;i<510;i++)insert.run(digest('occupied-'+i),a.now()+15*60_000);
        insert.run(digest('\0TWStockRS-login-budget-v1'),a.now()+60_000);
        await assert.rejects(()=>b.login('new-user'),e=>e.code==='LOGIN_SERVICE_LIMIT');
        assert.equal(a.library.connection.prepare('SELECT COUNT(*) AS n FROM auth_attempts').get().n,512);
        a.tick(60_001);
        await assert.rejects(()=>b.login('occupied-0'),e=>e.code==='LOGIN_RATE_LIMIT');
        assert.equal(a.library.connection.prepare('SELECT failures FROM auth_attempts WHERE key=?').get(digest('occupied-0')).failures,5);
        a.tick(15*60_000);
        await assert.rejects(()=>b.login('new-user'),e=>e.code==='LOGIN_FAILED');
        assert(a.library.connection.prepare('SELECT COUNT(*) AS n FROM auth_attempts').get().n<=2);
    }finally{a.close();a.clean();}
});

test('new anonymous sessions have a persistent issuance budget while existing sessions remain usable',()=>{
    const a=area();try{
        const first=browser(a.auth);first.open();
        for(let i=1;i<60;i++)browser(a.auth).open();
        const reopened=new m.AuthStore(a.library.connection,a.now);
        assert.throws(()=>browser(reopened).open(),e=>e.code==='SESSION_RATE_LIMIT');
        assert.equal(reopened.session(first.request(),first.response).owner,first.session.owner);
        assert.equal(a.library.connection.prepare('SELECT COUNT(*) AS n FROM auth_sessions').get().n,60);
        a.tick(60_001);assert(browser(reopened).open().owner);
    }finally{a.close();a.clean();}
});

test('password-success cannot bypass global login limits and successful rotation does not reset that budget',async()=>{
    const a=area();try{
        await a.auth.createAccount('alice',password);
        const b=browser(a.auth);b.open();
        a.library.connection.prepare('INSERT INTO auth_attempts VALUES (?,29,?)').run(digest('\0TWStockRS-login-budget-v1'),a.now()+60_000);
        assert.equal((await b.login('alice')).account.username,'alice');
        await assert.rejects(()=>b.login('alice'),e=>e.code==='LOGIN_SERVICE_LIMIT');
        assert.equal(a.auth.guard(b.request(),true).account.username,'alice');
        a.tick(60_001);
        a.library.connection.prepare('UPDATE auth_attempts SET failures=60,until_at=? WHERE key=?').run(a.now()+60_000,digest('\0TWStockRS-session-budget-v1'));
        const original=b.session.owner,events=a.library.connection.prepare("SELECT COUNT(*) AS n FROM auth_events WHERE event='login'").get().n;
        await assert.rejects(()=>b.login('alice'),e=>e.code==='SESSION_RATE_LIMIT');
        assert.equal(a.auth.guard(b.request(),true).owner,original);
        assert.equal(a.library.connection.prepare("SELECT COUNT(*) AS n FROM auth_events WHERE event='login'").get().n,events);
    }finally{a.close();a.clean();}
});

function stream(length){const s=new PassThrough();s.headers={'content-type':'application/json',...(length===undefined?{}:{'content-length':String(length)})};return s;}
test('body deadline is absolute despite trickle data, releases reservations and preserves a normal next request',async()=>{
    const reader=new m.JsonBodyReader({readers:1,reservedBytes:1024,timeoutMs:80}),s=stream();
    const pending=assert.rejects(()=>reader.read(s,1024),e=>e.code==='BODY_TIMEOUT'&&e.status===408);
    const drip=setInterval(()=>s.write(' '),10);
    try{await pending;}finally{clearInterval(drip);s.destroy();}
    const next=stream(2),value=reader.read(next,1024);next.end('{}');assert.deepEqual(await value,{});
});
test('aborted, oversized and malformed UTF-8 bodies free both reader slots and reserved bytes',async()=>{
    const reader=new m.JsonBodyReader({readers:1,reservedBytes:64,timeoutMs:1000});
    for(const kind of ['abort','oversize','encoding']){
        const s=stream(),controller=new AbortController();
        const pending=assert.rejects(()=>reader.read(s,8,controller.signal),e=>e.code===({abort:'REQUEST_ABORTED',oversize:'BODY_TOO_LARGE',encoding:'INVALID_JSON'}[kind]));
        if(kind==='abort')controller.abort();else s.end(kind==='oversize'?'012345678':Buffer.from([0xc0,0xaf]));
        await pending;s.destroy();
        const next=stream(2),value=reader.read(next,64);next.end('{}');assert.deepEqual(await value,{});
    }
});
test('body readers reject overlapping byte reservations and count overload without evicting active uploads',async()=>{
    const reader=new m.JsonBodyReader({readers:2,reservedBytes:10,timeoutMs:1000}),a=stream(8),b=stream(2);
    const first=reader.read(a,10),second=reader.read(b,10);
    await assert.rejects(()=>reader.read(stream(1),10),e=>e.code==='BODY_BUSY');
    a.end(' '.repeat(6)+'{}');b.end('{}');assert.deepEqual(await first,{});assert.deepEqual(await second,{});
    const c=stream(10),third=reader.read(c,10);
    await assert.rejects(()=>reader.read(stream(1),10),e=>e.code==='BODY_BUSY');
    c.end(' '.repeat(8)+'{}');assert.deepEqual(await third,{});
});

test('HTTP origin and request-target defenses reject hostile origins, absolute URLs, protocol-relative and backslash paths',async()=>{
    const a=await httpFixture();try{
        for(const target of ['http://attacker.invalid/api/v1/health','//attacker.invalid/api/v1/health','/\\attacker.invalid/api/v1/health','/api/v1/health#fragment']){
            const r=await raw(a.base,target);assert.equal(r.status,400);assert(!r.text.includes(a.root));
        }
        for(const headers of [{Host:'attacker.invalid'},{Origin:'https://attacker.invalid'},{'Sec-Fetch-Site':'cross-site'}])assert.equal((await raw(a.base,'/api/v1/health',{headers})).status,403);
        const health=await raw(a.base,'/api/v1/health');assert.equal(health.status,200);
    }finally{await a.stop();}
});
test('all API responses and private downloads suppress referrers, framing and caching, with secure production cookies',async()=>{
    const a=await httpFixture({origin:'https://stocks.example.invalid',secureCookies:true});try{
        const session=await raw(a.base,'/api/v1/auth/session',{headers:{Host:'stocks.example.invalid',Origin:'https://stocks.example.invalid'}});
        assert.equal(session.status,200);assert.match(session.headers['set-cookie'][0],/HttpOnly; SameSite=Strict; Secure;/);
        for(const target of ['/','/not-found','/api/v1/health','/api/v1/system/backup']){
            const r=await raw(a.base,target,{headers:{Host:'stocks.example.invalid'}});
            assert.equal(r.headers['referrer-policy'],'no-referrer');assert.equal(r.headers['x-frame-options'],'DENY');
            assert.equal(r.headers['x-content-type-options'],'nosniff');assert.match(r.headers['content-security-policy'],/frame-ancestors 'none'/);
            if(target.startsWith('/api/'))assert.equal(r.headers['cache-control'],'no-store');
            assert(!r.text.includes('password_hash'));assert(!r.text.includes(a.root));
        }
    }finally{await a.stop();}
});
test('anonymous, Free and Pro cannot reach any privileged maintenance operation or spoof owner and CSRF',async()=>{
    const a=await httpFixture();try{
        const users=[a.jar(),a.jar(),a.jar()];for(const b of users)await b.open();await users[1].login('bravo');await users[2].login('alice');
        const routes=['admin/overview','admin/accounts/list','admin/accounts/preview','admin/accounts/apply','admin/accounts/create','admin/events','imports/validate','imports/stage','imports/list','imports/report','versions/state','versions/create','versions/activate','versions/rollback','versions/compare','versions/compare/export'];
        for(const b of users){for(const route of routes)assert.equal((await b.call(route,{})).status,403,route);assert.equal((await b.call('system/backup')).status,403);}
        const owner=a.jar();await owner.open();await owner.login('owner');
        assert.equal((await owner.call('admin/overview',{}, {'X-CSRF-Token':'0'.repeat(64)})).status,403);
        assert.equal((await users[2].call('admin/overview',{}, {'X-Workspace-Id':owner.session.owner})).status,409);
        assert.equal((await owner.call('admin/overview',{})).status,200);
    }finally{await a.stop();}
});
test('cross-account credentials, workspace substitution and SQL-like input never expose or overwrite another private list',async()=>{
    const a=await httpFixture();try{
        const alice=a.jar(),bravo=a.jar();for(const b of [alice,bravo])await b.open();await alice.login('alice');await bravo.login('bravo');
        let snapshot=(await alice.call('library/open',{mock_plan:'Pro'})).value.snapshot;
        snapshot=(await alice.call('library/edit',{mock_plan:'Pro',expected_revision:snapshot.revision,action:{type:'rename',kind:'watchlist',index:0,name:'Alice 私有清單'}})).value.snapshot;
        const forged=await bravo.call('library/edit',{mock_plan:'Free',expected_revision:snapshot.revision,action:{type:'rename',kind:'watchlist',index:0,name:'禁止覆寫'}},{'X-Workspace-Id':alice.session.owner,'X-Auth-Rights':alice.session.rights,'X-CSRF-Token':alice.session.csrf});assert.equal(forged.status,409);
        assert(!JSON.stringify((await bravo.call('library/open',{mock_plan:'Free'})).value).includes('Alice 私有清單'));
        const attempts=[{username:"alice' OR 1=1 --",password},{username:'alice',password,role:'admin'},JSON.parse('{"username":"alice","password":"test","__proto__":{"admin":true}}')];
        const guest=a.jar();await guest.open();for(const input of attempts)assert([401,422].includes((await guest.call('auth/login',input)).status));
        assert.equal((await alice.call('library/open',{mock_plan:'Pro'})).value.snapshot.library.watchlists[0].name,'Alice 私有清單');assert.equal({}.admin,undefined);
    }finally{await a.stop();}
});
test('malicious import paths, unknown object fields and non-finite prices are rejected without staging any batch',async()=>{
    const a=await httpFixture();try{
        const owner=a.jar();await owner.open();await owner.login('owner');
        const sample=readFileSync('public/samples/import-valid.json','utf8');
        for(const mutate of [v=>v.manifest.batch_id='../library.sqlite',v=>{v.securities[0].__proto__='invalid';Object.defineProperty(v,'__proto__',{value:{polluted:true},enumerable:true});},v=>v.prices[0].raw_close=Infinity]){
            const value=JSON.parse(sample);mutate(value);const text=JSON.stringify(value);
            const r=await owner.call('imports/validate',{text});assert.equal(r.status,200);assert.equal(r.value.report.ok,false);
            const stage=await owner.call('imports/stage',{text,sha256:digest(text)});assert.equal(stage.status,200);assert.equal(stage.value.staged,false);
        }
        assert.equal((await owner.call('imports/list',{})).value.batches.length,0);assert.equal({}.polluted,undefined);
    }finally{await a.stop();}
});
test('parallel large HTTP uploads hit admission limits, health stays available and disconnected uploads release capacity',async()=>{
    const a=await httpFixture(),pending=[];try{
        const owner=a.jar();await owner.open();await owner.login('owner');
        const hold=()=>new Promise((resolve,reject)=>{
            const req=httpRequest(a.base+'/api/v1/imports/validate',{method:'POST',headers:{...owner.headers(),'Content-Type':'application/json','Content-Length':18*1024*1024,Expect:'100-continue'}},res=>{res.resume();res.on('end',()=>resolve({req,status:res.statusCode}));});
            req.on('error',()=>{});req.once('continue',()=>{req.write('{');resolve({req,status:100});});req.flushHeaders();pending.push(req);
        });
        assert.equal((await hold()).status,100);assert.equal((await hold()).status,100);
        // Health is a separate request and follows the completed application admission checks.
        assert.equal((await raw(a.base,'/api/v1/health')).status,200);
        const rejected=await raw(a.base,'/api/v1/imports/validate',{method:'POST',headers:{...owner.headers(),'Content-Type':'application/json','Content-Length':18*1024*1024},body:''});
        assert.equal(rejected.status,429);assert.equal(rejected.headers.connection,'close');
        await Promise.all(pending.map(req=>new Promise(resolve=>{req.once('close',resolve);req.destroy();})));
        assert.equal((await raw(a.base,'/api/v1/health')).status,200);
        const data=Buffer.alloc(18*1024*1024,32);data.write('{"text":"{}"}');
        const r=await raw(a.base,'/api/v1/imports/validate',{method:'POST',headers:{...owner.headers(),'Content-Type':'application/json','Content-Length':data.length},body:data});assert.equal(r.status,200);assert.equal(JSON.parse(r.text).report.ok,false);
    }finally{for(const req of pending)req.destroy();await a.stop();}
});
test('HTTP oversized and invalid UTF-8 bodies close the connection and leave library contents unchanged',async()=>{
    const a=await httpFixture();try{
        const b=a.jar();await b.open();await b.login('alice');const before=(await b.call('library/open',{mock_plan:'Pro'})).value.snapshot;
        const headers={...b.headers(),'Content-Type':'application/json'};
        for(const data of [Buffer.alloc(65*1024,32),Buffer.from([0xc0,0xaf])]){
            const r=await raw(a.base,'/api/v1/library/edit',{method:'POST',headers,body:data});assert([400,413].includes(r.status));
        }
        assert.deepEqual((await b.call('library/open',{mock_plan:'Pro'})).value.snapshot,before);
    }finally{await a.stop();}
});

test('HTTP session churn cannot bypass limits by changing cookies or forwarded client headers; active users still work',async()=>{
    const a=await httpFixture();try{
        const original=a.jar();await original.open();
        for(let i=0;i<59;i++){
            const r=await raw(a.base,'/api/v1/auth/session',{headers:{Cookie:'forged-session-'+i+'=unused','X-Forwarded-For':'192.0.2.'+i}});assert.equal(r.status,200);
        }
        const blocked=await raw(a.base,'/api/v1/auth/session',{headers:{'X-Forwarded-For':'198.51.100.1'}});
        assert.equal(blocked.status,429);assert.equal(blocked.headers['retry-after'],'60');assert.equal(JSON.parse(blocked.text).error.code,'SESSION_RATE_LIMIT');
        const owner=original.session.owner;assert.equal((await original.open()).status,200);assert.equal(original.session.owner,owner);
    }finally{await a.stop();}
});

test('actual slow HTTP body receives an absolute timeout without changing any account data or blocking health',async()=>{
    const a=await httpFixture();let req,drip;try{
        const b=a.jar();await b.open();await b.login('alice');
        const before=(await b.call('library/open',{mock_plan:'Pro'})).value.snapshot;
        const started=Date.now();
        const pending=new Promise((resolve,reject)=>{
            req=httpRequest(a.base+'/api/v1/library/edit',{method:'POST',headers:{...b.headers(),'Content-Type':'application/json','Content-Length':100,Expect:'100-continue'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});
            req.on('error',reject);req.once('continue',()=>{req.write('{');drip=setInterval(()=>req.write(' '),500);});req.flushHeaders();
        });
        assert.equal((await raw(a.base,'/api/v1/health')).status,200);
        assert.equal(await pending,408);assert(Date.now()-started>=9000&&Date.now()-started<25000);
        assert.deepEqual((await b.call('library/open',{mock_plan:'Pro'})).value.snapshot,before);
    }finally{clearInterval(drip);req?.destroy();await a.stop();}
});

test('chart tooltip names and CSV formulas from imported display text are rendered as inert text',()=>{
    const name='<img src=x onerror="alert(1)"></script><script>alert(1)</script>';
    const entity={id:'security-safe',code:'2330',name,kind:'stock',market:'TWSE',sector:'半導體業',status:'valid'};
    const options=m.buildChartOptions({entities:[entity],paths:{'security-safe':[[1,2]]},pointDates:{'security-safe':['2026-09-24']},filter:'All',theme:'dark',selectedId:null,sourceLabel:name},{x:[-8,8],y:[-8,8]});
    const html=options.series.find(s=>s.type==='scatter').tooltip.formatter({value:[1,2],data:{date:'2026-09-24'},dataIndex:0});
    assert(!html.includes('<img'));assert(!html.includes('<script>'));assert(html.includes('&lt;img'));assert(html.includes('&quot;'));
    for(const formula of ['=HYPERLINK("https://attacker.invalid")','+cmd','-cmd','@SUM(1)','  =1'])assert(m.csvCell(formula).replace(/^"/,'').startsWith("'"));
    assert.equal(m.csvCell(-1.25),'-1.25');
});

test('published static service rejects encoded traversal, hidden files, database files and Windows stream aliases',async()=>{
    const a=await httpFixture();try{
        const marker='SYNTHETIC_PRIVATE_STATIC_MARKER';
        writeFileSync(path.join(a.root,'outside.json'),marker);
        writeFileSync(path.join(a.root,'web','.env'),marker);
        writeFileSync(path.join(a.root,'web','library.sqlite'),marker);
        for(const target of ['/..%2foutside.json','/%2e%2e%2foutside.json','/..%5coutside.json','/.env','/library.sqlite','/.env::$DATA','/%00outside.json']){
            const r=await raw(a.base,target);assert([400,404].includes(r.status),target+': '+r.status);assert(!r.text.includes(marker));
        }
        assert.equal((await raw(a.base,'/')).status,200);
    }finally{await a.stop();}
});

test('development server denies private database, backup and host files including raw and Windows alternate path forms',async()=>{
    const project=process.cwd(),relative='.qa-security-private-'+process.pid,root=path.join(project,relative);
    mkdirSync(root);const marker='SYNTHETIC_PRIVATE_SECURITY_MARKER';
    const names=['library.sqlite','library.sqlite-wal','full.twrsbackup','full.twrsbackup.enc','host.json','state.json','control.json','transition.json','backup-policy.json','monitor-state.json','monitor-receipts.json','auto-backup-catalog.json','host-events.jsonl','secret.pem','restore-history.json','restore-state.json','.data.twstockrs-restore.json','.supervisor.twstockrs-lock'];
    for(const name of names)writeFileSync(path.join(root,name),marker);
    let server;try{
        server=await createViteServer({configFile:path.join(project,'vite.config.ts'),server:{port:0,strictPort:false},logLevel:'silent'});await server.listen();
        const base='http://127.0.0.1:'+server.httpServer.address().port;
        for(const name of names){
            for(const suffix of ['', '?raw', '?url']){
                const r=await raw(base,'/'+relative+'/'+name+suffix);assert([403,404].includes(r.status),name+': '+r.status);assert(!r.text.includes(marker));
            }
        }
        for(const target of ['/'+relative+'/host.json::$DATA?raw','/'+relative+'/host.json.?raw','/'+relative+'/host.json%3A%3A$DATA?raw']){
            const r=await raw(base,target);assert(!r.text.includes(marker),target);if(r.status===200)assert.match(r.text,/<html/);else assert([403,404].includes(r.status));
        }
        if(process.platform==='win32'){
            const upper=await raw(base,'/'+relative.toUpperCase()+'/HOST.JSON?raw');assert.equal(upper.status,403);assert(!upper.text.includes(marker));
        }
        const absolute=await raw(base,'/@fs/'+path.join(root,'host.json').replaceAll('\\','/')+'?raw');assert.equal(absolute.status,403);assert(!absolute.text.includes(marker));
        assert.equal((await raw(base,'/')).status,200);
    }finally{await server?.close();assert(path.dirname(root)===project&&path.basename(root)===relative);rmSync(root,{recursive:true,force:true});}
});
