import { test } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
const bundle = await build({ stdin: { contents: "export * from './server/app';export * from './server/authStore';export * from './server/libraryStore';export * from './server/importStore';export * from './server/releaseStore';export * from './server/adminStore';export * from './server/workQueue';export * from './server/systemBackup';export * from './server/hostProtocol';export * from './shared/mockAnalysis';export * from './shared/adminContract';export * from './components/twstock/adminClient';", resolveDir: process.cwd(), loader: 'ts' }, write: false, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' });
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const m = module.exports;
const password = 'Synthetic admin maintenance passphrase!';
function area() { const root = mkdtempSync(path.join(tmpdir(), 'twrs-admin-')); return { root, dir: path.join(root, 'data'), file: path.join(root, 'data/library.sqlite'), cleanup() { assert(root.startsWith(path.join(tmpdir(), 'twrs-admin-'))); rmSync(root, { recursive: true, force: true }); } }; }
async function local() { const a = area(), library = new m.LibraryStore(a.file), imports = new m.ImportStore(path.join(a.dir, 'imports.sqlite')); new m.ReleaseStore(imports); let now = Date.now(); const auth = new m.AuthStore(library.connection, () => now), owner = await auth.createAccount('owner', password, 'admin'), alice = await auth.createAccount('alice', password), queue = new m.WorkQueue(path.join(a.dir, 'imports.sqlite')), admin = new m.AdminStore(library.connection, imports.connection, auth, queue, () => now), actor = { owner: owner.id, rights: '1:Free', account: { id: owner.id, username: 'owner', role: 'admin' }, plan: 'Free' }; return { ...a, library, imports, auth, queue, admin, actor, alice, tick: n => { now += n; }, now: () => now, async close() { await queue.close(); imports.close(); library.close(); a.cleanup(); } }; }
async function http() { const a = area(); let now = Date.now(), server, base; const l = new m.LibraryStore(a.file), auth = new m.AuthStore(l.connection, () => now); await auth.createAccount('owner', password, 'admin'); await auth.createAccount('alice', password); await auth.createAccount('bravo', password, 'user', 'Pro', now + 3600000); l.close(); async function start() { server = m.createMockServer({ dataDirectory: a.dir, now: () => now }); await new Promise(r => server.listen(0, '127.0.0.1', r)); base = 'http://127.0.0.1:' + server.address().port; } async function stop() { server.closeAllConnections(); await new Promise(r => server.close(r)); } await start(); function jar() { let cookie = '', session; return { get session() { return session; }, get cookie() { return cookie; }, async call(route, body = {}, extra = {}) { const response = await fetch(base + '/api/v1/' + route, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json', ...(session ? { 'X-Workspace-Id': session.owner, 'X-Auth-Rights': session.rights, 'X-CSRF-Token': session.csrf } : {}), ...extra }, body: JSON.stringify(body) }); const v = await response.json(); if (response.headers.has('set-cookie'))
        cookie = response.headers.get('set-cookie').split(';')[0]; if (v.session)
        session = v.session; return { status: response.status, value: v, headers: response.headers }; }, async open() { const r = await fetch(base + '/api/v1/auth/session', { headers: { Cookie: cookie } }); cookie = r.headers.get('set-cookie')?.split(';')[0] || cookie; session = (await r.json()).session; }, async login(username = 'owner') { await this.open(); assert.equal((await this.call('auth/login', { username, password })).status, 200); }, async list() { const r = await this.call('admin/accounts/list'); assert.equal(r.status, 200); return m.decodeAccounts(r.value).accounts; }, async preview(change) { const r = await this.call('admin/accounts/preview', change); assert.equal(r.status, 200, JSON.stringify(r.value)); return m.decodePreview(r.value); }, async apply(p) { return this.call('admin/accounts/apply', { change: p.change, token: p.token, expires_at: p.expires_at }); } }; } return { ...a, jar, get base() { return base; }, tick: n => now += n, start, stop, async close() { if (server?.listening)
        await stop(); a.cleanup(); } }; }
const change = (a, extra = {}) => ({ username: a.username, expected_revision: a.revision, action: 'access', enabled: a.enabled, plan: 'Free', pro_until: null, ...extra });
test('HTTP maintenance denies anonymous, Free and Pro users even with forged role, rights or missing CSRF', async () => { const a = await http(); try {
    for (const name of [null, 'alice', 'bravo']) {
        const b = a.jar();
        if (name)
            await b.login(name);
        else
            await b.open();
        for (const route of ['overview', 'accounts/list', 'events', 'accounts/create'])
            assert.equal((await b.call('admin/' + route)).status, 403);
    }
    const b = a.jar();
    await b.login();
    assert.equal((await b.call('admin/overview', {}, { 'X-CSRF-Token': '' })).status, 403);
    assert.equal((await b.call('admin/overview', {}, { 'X-Auth-Rights': '1:Pro' })).status, 409);
    assert.equal((await b.call('admin/overview', { role: 'admin' })).status, 422);
    assert.equal((await b.call('admin/unknown')).status, 404);
}
finally {
    await a.close();
} });
test('overview and accounts expose bounded real counts and no credentials, private paths, session tokens or raw account rows', async () => { const a = await http(); try {
    const b = a.jar();
    await b.login();
    const r = await b.call('admin/overview'), v = m.decodeAdminOverview(r.value);
    assert.equal(r.status, 200);
    assert.equal(v.accounts.total, 3);
    assert.equal(v.accounts.admins, 1);
    assert.equal(v.accounts.pro, 1);
    assert.equal(v.host, null);
    assert.equal(v.queue.limits.max_queued, 16);
    assert.equal(v.markets.length, 2);
    assert(v.markets.every(m => m.active_id === null && m.prices === 0));
    const accounts = await b.list(), text = JSON.stringify({ overview: v, accounts });
    for (const secret of ['password_hash', 'token_hash', 'csrf', password, a.dir, b.cookie.split('=')[1]])
        assert(!text.includes(secret));
    assert.equal(accounts.find(a => a.username === 'bravo').effective_plan, 'Pro');
    a.tick(3600001);
    await b.login();
    const next = await b.list();
    assert.equal(next.find(a => a.username === 'bravo').effective_plan, 'Free');
}
finally {
    await a.close();
} });
test('access changes require target-bound previews; tampered, expired, stale and replayed confirmations cannot write', async () => { const a = await http(); try {
    const b = a.jar();
    await b.login();
    let alice = (await b.list()).find(a => a.username === 'alice');
    const p = await b.preview(change(alice, { plan: 'Pro', pro_until: Date.now() + 86400000 }));
    for (const body of [{ change: { ...p.change, username: 'bravo' }, token: p.token, expires_at: p.expires_at }, { change: p.change, token: '0'.repeat(64), expires_at: p.expires_at }, { change: p.change, token: p.token, expires_at: p.expires_at + 1 }])
        assert.notEqual((await b.call('admin/accounts/apply', body)).status, 200);
    assert.equal((await b.apply(p)).status, 200);
    assert.equal((await b.apply(p)).status, 409);
    alice = (await b.list()).find(a => a.username === 'alice');
    const expired = await b.preview(change(alice));
    a.tick(120001);
    assert.equal((await b.apply(expired)).status, 409);
    const events = m.decodeAdminEvents((await b.call('admin/events')).value).events;
    assert(events.some(e => e.action === 'account/access' && e.actor === 'owner' && e.target === 'alice'));
}
finally {
    await a.close();
} });
test('preview binds the acting administrator, and concurrent account revisions do not overwrite each other', async () => { const a = await local(); try {
    const second = await a.auth.createAccount('operator', password, 'admin'), actor = { ...a.actor, owner: second.id, account: { id: second.id, username: 'operator', role: 'admin' } }, alice = a.admin.accounts({ query: 'alice' }).accounts[0], p = a.admin.preview(a.actor, change(alice)), other = a.admin.preview(a.actor, change(alice, { enabled: false }));
    assert.throws(() => a.admin.apply(actor, { change: p.change, token: p.token, expires_at: p.expires_at }, randomUUID()), e => e.code === 'STALE_CONFIRMATION');
    a.admin.apply(a.actor, { change: other.change, token: other.token, expires_at: other.expires_at }, randomUUID());
    assert.throws(() => a.admin.apply(a.actor, { change: p.change, token: p.token, expires_at: p.expires_at }, randomUUID()), e => e.code === 'ACCOUNT_CHANGED');
    assert.equal(a.admin.accounts({ query: 'alice' }).accounts[0].enabled, false);
}
finally {
    await a.close();
} });
test('revoke and disable immediately invalidate only the target sessions, preserving other users and their saved data', async () => { const a = await http(); try {
    const b = a.jar(), user = a.jar(), other = a.jar();
    await b.login();
    await user.login('alice');
    await other.login('bravo');
    let r = await user.call('library/open', { mock_plan: 'Free' });
    r = await user.call('library/choose', { mock_plan: 'Free', expected_revision: r.value.snapshot.revision, kind: 'watchlist', index: 0 });
    r = await user.call('library/edit', { mock_plan: 'Free', expected_revision: r.value.snapshot.revision, action: { type: 'rename', kind: 'watchlist', index: 0, name: 'private-survives' } });
    assert.equal(r.status, 200);
    let alice = (await b.list()).find(a => a.username === 'alice'), p = await b.preview({ username: 'alice', expected_revision: alice.revision, action: 'revoke' });
    assert.equal((await b.apply(p)).status, 200);
    assert.equal((await user.call('library/open', { mock_plan: 'Free' })).status, 401);
    assert.equal((await other.call('library/open', { mock_plan: 'Pro' })).status, 200);
    await user.login('alice');
    assert.match(JSON.stringify((await user.call('library/open', { mock_plan: 'Free' })).value), /private-survives/);
    alice = (await b.list()).find(a => a.username === 'alice');
    p = await b.preview(change(alice, { enabled: false }));
    assert.equal((await b.apply(p)).status, 200);
    assert.equal((await user.call('library/open', { mock_plan: 'Free' })).status, 401);
    alice = (await b.list()).find(a => a.username === 'alice');
    assert.equal((await b.apply(await b.preview(change(alice, { enabled: true })))).status, 200);
    await user.login('alice');
    assert.match(JSON.stringify((await user.call('library/open', { mock_plan: 'Free' })).value), /private-survives/);
}
finally {
    await a.close();
} });
test('self access and last administrator protections apply before preview and cannot be bypassed with extra fields', async () => { const a = await local(); try {
    const owner = a.admin.accounts({ query: 'owner' }).accounts[0];
    assert.throws(() => a.admin.preview(a.actor, change(owner, { enabled: false })), e => e.code === 'SELF_MAINTENANCE');
    const fake = { ...a.actor, owner: a.alice.id };
    assert.throws(() => a.admin.preview(fake, change(owner, { enabled: false })), e => e.code === 'LAST_ADMIN');
    const alice = a.admin.accounts({ query: 'alice' }).accounts[0];
    for (const extra of [{ role: 'admin' }, { passwordHash: 'x' }, { owner: a.actor.owner }, { pro_until: 1, plan: 'Pro' }, { plan: 'Free', pro_until: Date.now() + 3600000 }])
        assert.throws(() => a.admin.preview(a.actor, { ...change(alice), ...extra }));
    assert.throws(() => m.accountChange({ username: 'alice', expected_revision: 1, action: 'revoke', plan: 'Free' }));
}
finally {
    await a.close();
} });
test('account changes and their audit record commit atomically when audit storage fails', async () => { const a = await local(); try {
    const alice = a.admin.accounts({ query: 'alice' }).accounts[0], p = a.admin.preview(a.actor, change(alice, { enabled: false }));
    a.library.connection.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON auth_events WHEN NEW.event LIKE 'admin:%' BEGIN SELECT RAISE(ABORT,'injected audit write failure'); END");
    assert.throws(() => a.admin.apply(a.actor, { change: p.change, token: p.token, expires_at: p.expires_at }, randomUUID()), /injected audit/);
    assert.deepEqual(a.admin.accounts({ query: 'alice' }).accounts[0], alice);
}
finally {
    await a.close();
} });
test('new web accounts are ordinary users only, passwords are never returned, and duplicate or malformed creation cannot overwrite', async () => { const a = await http(); try {
    const b = a.jar();
    await b.login();
    for (const input of [{ username: 'created', password, plan: 'Free', role: 'admin' }, { username: 'created', password: 'short', plan: 'Free' }, { username: 'created', password, plan: 'Pro' }])
        assert.equal((await b.call('admin/accounts/create', input)).status, 422);
    const r = await b.call('admin/accounts/create', { username: 'created', password, plan: 'Free' });
    assert.equal(r.status, 200);
    assert.equal(m.decodeAdminAccount(r.value.account).role, 'user');
    assert(!JSON.stringify(r.value).includes(password));
    assert.equal((await b.call('admin/accounts/create', { username: 'created', password, plan: 'Free' })).status, 409);
    const user = a.jar();
    await user.login('created');
    assert.equal((await user.call('admin/overview')).status, 403);
    const events = (await b.call('admin/events')).value;
    assert(!JSON.stringify(events).includes(password));
    assert(events.events.some(e => e.action === 'account/create' && e.target === 'created'));
}
finally {
    await a.close();
} });
test('administrator revocation during password derivation prevents delayed account creation and its audit record', async () => { const a = await local(); try {
    let current = true;
    const promise = a.admin.create(a.actor, { username: 'delayed', password, plan: 'Free' }, () => { if (!current)
        throw new m.AnalysisError('ADMIN_REQUIRED', 'revoked', 403); }, randomUUID());
    current = false;
    await assert.rejects(promise, e => e.code === 'ADMIN_REQUIRED');
    assert.equal(a.admin.accounts({ query: 'delayed' }).total, 0);
    assert(!a.admin.events({}).events.some(e => e.target === 'delayed'));
}
finally {
    await a.close();
} });
test('maintenance records persist across restarts, paginate and filter without exposing submitted text or token hashes', async () => { const a = await http(); try {
    const b = a.jar();
    await b.login();
    assert.equal((await b.call('imports/stage', { text: 'sensitive-invalid-text' })).status, 422);
    const r = await b.call('admin/events', { errors_only: true });
    assert.equal(r.status, 200);
    assert(r.value.events.some(e => e.action === 'imports/stage' && e.status === 'error'));
    assert(!JSON.stringify(r.value).includes('sensitive-invalid-text'));
    await a.stop();
    await a.start();
    const after = await b.call('admin/events', { errors_only: true });
    assert.equal(after.status, 200);
    assert(after.value.events.some(e => e.action === 'imports/stage'));
    assert.equal((await b.call('admin/events', { before: 0 })).status, 422);
}
finally {
    await a.close();
} });
test('event retention is bounded and stable filtered pagination cannot duplicate rows', async () => { const a = await local(); try {
    for (let n = 0; n < 1040; n++)
        a.admin.record(a.actor.owner, 'admin', n % 2 ? 'error' : 'ok', null, n % 2 ? 'INTERNAL_ERROR' : null, randomUUID());
    assert.equal(a.library.connection.prepare('SELECT count(*) AS n FROM auth_events').get().n, 1000);
    const first = m.decodeAdminEvents(a.admin.events({ errors_only: true }));
    assert.equal(first.events.length, 40);
    assert(first.next_before);
    const second = m.decodeAdminEvents(a.admin.events({ before: first.next_before, errors_only: true }));
    assert(first.events.every(e => second.events.every(x => x.id !== e.id)));
    assert(second.events.every(e => e.status === 'error'));
    assert.throws(() => a.admin.record(a.actor.owner, 'untrusted', 'ok'));
    assert.throws(() => m.decodeAdminEvents({ ...first, next_before: 1 }));
}
finally {
    await a.close();
} });
test('format four backups preserve validated maintenance records, previews do not migrate old format three, and older code refuses downgrade', async () => { const a = await local(); let stopped = false; try {
    a.admin.record(a.actor.owner, 'admin', 'ok', null, null, randomUUID());
    const file = path.join(a.root, 'full.twrsbackup');
    m.createConnectedBackup(a.library.connection, a.imports.connection, file, a.dir);
    const target = path.join(a.root, 'restored'), preview = m.previewBackup(file, target);
    m.restoreBackup(file, target, preview.confirmation_token);
    const restored = new DatabaseSync(path.join(target, 'library.sqlite'));
    assert.equal(restored.prepare('PRAGMA user_version').get().user_version, 4);
    assert(restored.prepare("SELECT event FROM auth_events WHERE event LIKE 'admin:%'").get());
    restored.close();
    const old = { schemas: { library: [1, 3], imports: [1, 2] } };
    assert.throws(() => m.dataCompatible(a.dir, old), /不相容/);
    a.library.connection.exec("DELETE FROM auth_events WHERE event LIKE 'admin:%';PRAGMA user_version=3");
    await a.queue.close();
    a.library.close();
    a.imports.close();
    stopped = true;
    const hash = () => createHash('sha256').update(readFileSync(a.file)).digest('hex'), before = hash();
    m.inspectData(a.dir);
    assert.equal(hash(), before);
    const db = new DatabaseSync(a.file, { readOnly: true });
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 3);
    db.close();
    const latest = new m.LibraryStore(a.file);
    assert.equal(latest.connection.prepare('PRAGMA user_version').get().user_version, 4);
    latest.close();
}
finally {
    if (stopped)
        a.cleanup();
    else
        await a.close();
} });
test('client rejects inconsistent admin snapshots, identity swaps, unknown rights and secret-bearing account rows', async () => { const a = await local(); try {
    const v = a.admin.overview();
    assert.equal(m.decodeAdminOverview(v), v);
    for (const patch of [{ accounts: { ...v.accounts, admins: 99 } }, { queue: { ...v.queue, running: 2 } }, { markets: [] }, { memory_bytes: NaN }, { records_available: 'yes' }])
        assert.throws(() => m.decodeAdminOverview({ ...v, ...patch }));
    const alice = a.admin.accounts({ query: 'alice' }).accounts[0];
    assert.throws(() => m.decodeAdminAccount({ ...alice, password_hash: 'secret' }));
    const p = a.admin.preview(a.actor, change(alice));
    assert.equal(m.decodePreview(p).before.id, alice.id);
    assert.throws(() => m.decodePreview({ ...p, after: { ...p.after, username: 'other' } }));
    assert.throws(() => m.decodePreview({ ...p, change: { ...p.change, role: 'admin' } }));
    await assert.rejects(() => m.adminRequest('overview', {}, async () => new Response('invalid JSON')));
    await assert.rejects(() => m.adminRequest('accounts/apply', {}, async () => new Response(JSON.stringify({ error: { code: 'ACCOUNT_CHANGED', message: 'refresh' } }), { status: 409 })), e => e.code === 'ACCOUNT_CHANGED');
}
finally {
    await a.close();
} });
test('automatic backup summaries accept valid disabled and error states but reject paths, malformed times and invalid retention',async()=>{const a=await local();try{
    const automatic={available:true,enabled:false,time:'03:00',timezone:'Asia/Taipei',keep_recent:7,keep_daily:14,keep_weekly:8,verified:2,bytes:1024,unmanaged:1,last_success_at:1,next_due_at:null,last_error:'BACKUP_STORAGE_LOW',retention_warning:true,pending:false};
    const v={...a.admin.overview(),host:{mode:'local',release_id:'release-a',previous_release:null,revision:1,backups:0,backup_bytes:0,latest_backup_at:null,automatic}};
    assert.equal(m.decodeAdminOverview(v).host.automatic.last_error,'BACKUP_STORAGE_LOW');
    for(const patch of [{private_path:'secret'},{time:'25:00'},{timezone:'UTC'},{keep_recent:1},{pending:'yes'},{last_error:'/private/path'},{next_due_at:NaN}])assert.throws(()=>m.decodeAdminOverview({...v,host:{...v.host,automatic:{...automatic,...patch}}}));
}finally{await a.close();}});
