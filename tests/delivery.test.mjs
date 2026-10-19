import {test} from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, rmSync, existsSync, readdirSync, renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {hash, walk, sourceEvidence} from '../scripts/release-policy.mjs';
import {releaseTests} from '../scripts/release-tests.mjs';
const bundle = await build({stdin: {contents: "export * from './server/deliveryProtocol';export * from './server/hostProtocol';", resolveDir: process.cwd(), loader: 'ts'}, bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent'});
const compiled = {exports: {}}; new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), compiled, compiled.exports); const m = compiled.exports;
function area() {const root = mkdtempSync(path.join(tmpdir(), 'twrs-delivery-')); return {root, cleanup() {assert.equal(path.dirname(root), path.resolve(tmpdir())); assert(path.basename(root).startsWith('twrs-delivery-')); rmSync(root, {recursive: true, force: true});}};}
function put(file, value) {mkdirSync(path.dirname(file), {recursive: true}); writeFileSync(file, value);}
function fixture(a) {
    const stage = path.join(a.root, 'stage'), archive = path.join(a.root, 'candidate.twrsrelease');
    for (const name of m.requiredRuntime) put(path.join(stage, name), '/* synthetic executable placeholder */');
    put(path.join(stage, 'web/index.html'), '<!doctype html><title>TEST</title>');
    m.writeRelease(stage, archive, 'candidate');
    const names = ['candidate.twrsrelease', 'candidate.host.mjs', 'candidate.preflight.mjs', 'candidate.offline.html'];
    for (const name of names.slice(1)) put(path.join(a.root, name), 'synthetic');
    const report = {format: 'TWStockRS-verification', version: 1, status: 'passed', release_id: 'candidate', source: {sha256: 'a'.repeat(64)}, lock_sha256: 'b'.repeat(64), checks: m.releaseChecks.map(id => ({id, status: 'passed'})), files: names.map(name => {const b = readFileSync(path.join(a.root, name)); return {name, bytes: b.length, sha256: hash(b)};})};
    report.tests = {tests: 1, pass: 1, fail: 0, cancelled: 0, skipped: 0, todo: 0};
    const reportFile = archive + '.verification.json';
    const save = () => {writeFileSync(reportFile, JSON.stringify(report)); writeFileSync(archive + '.sha256', [...report.files.map(f => f.sha256 + '  ' + f.name), hash(readFileSync(reportFile)) + '  ' + path.basename(reportFile)].join('\n') + '\n');};
    save(); return {archive, report, reportFile, save};
}
function target(a, archive, production = false) {
    const root = path.join(a.root, 'host'); m.stageRelease(root, archive);
    m.atomicJson(path.join(root, 'host.json'), m.defaultConfig(8890, production ? 'https://test.example.invalid' : 'http://127.0.0.1:8890', production ? 'production' : 'local'));
    m.atomicJson(path.join(root, 'state.json'), {format: 'TWStockRS-host-state', version: 1, revision: 1, active: {release: 'candidate', data: 'generation-test'}, previous: null, updated_at: new Date().toISOString()});
    const data = path.join(root, 'data/generation-test'); mkdirSync(data, {recursive: true});
    for (const [name, version] of [['library', 4], ['imports', 2]]) {const db = new DatabaseSync(path.join(data, name + '.sqlite')); db.exec('PRAGMA journal_mode=WAL;PRAGMA user_version=' + version); if (name === 'library') db.exec("CREATE TABLE accounts(role TEXT,enabled INTEGER);INSERT INTO accounts VALUES('admin',1)"); db.close();}
    return root;
}

test('verified delivery can move as a complete set; private target and public deployment are not presumed', () => {const a = area(); try {
    const f = fixture(a), moved = path.join(a.root, 'moved'); mkdirSync(moved);
    for (const name of readdirSync(a.root).filter(name => name.startsWith('candidate.'))) copyFileSync(path.join(a.root, name), path.join(moved, name));
    const result = m.deploymentPreflight(path.join(moved, 'candidate.twrsrelease'));
    assert.equal(result.status, 'passed'); assert.equal(result.target, null); assert.equal(result.public_deployment_verified, false); assert.equal(result.scope, 'delivery-integrity');
} finally {a.cleanup();}});

test('missing, failed, skipped and duplicate checks cannot be promoted to deployable', () => {const a = area(); try {
    const f = fixture(a);
    for (const checks of [f.report.checks.slice(1), f.report.checks.map((c, i) => i === 2 ? {...c, status: 'skipped'} : c), f.report.checks.map(() => ({id: 'types', status: 'passed'}))]) {const old = f.report.checks; f.report.checks = checks; f.save(); assert.throws(() => m.verifyDelivery(f.archive), /未完整通過/); f.report.checks = old;}
    f.report.status = 'failed'; f.save(); assert.throws(() => m.verifyDelivery(f.archive), /未完整通過/);
} finally {a.cleanup();}});

test('each executable, archive and offline file is bound to the exact acceptance report', () => {const a = area(); try {
    const f = fixture(a);
    for (const entry of f.report.files) {const file = path.join(a.root, entry.name), original = readFileSync(file); writeFileSync(file, Buffer.concat([original, Buffer.from('tamper')])); assert.throws(() => m.verifyDelivery(f.archive), /完整性/); writeFileSync(file, original);}
    writeFileSync(f.archive + '.sha256', 'a'.repeat(64)); assert.throws(() => m.verifyDelivery(f.archive), /指紋清單/);
} finally {a.cleanup();}});

test('report cannot redirect validation outside delivery or substitute a different release', () => {const a = area(); try {
    const f = fixture(a); f.report.files[1].name = '../private.key'; f.save(); assert.throws(() => m.verifyDelivery(f.archive), /清單不符/);
    f.report.files[1].name = 'candidate.host.mjs'; f.report.release_id = 'other'; f.save(); assert.throws(() => m.verifyDelivery(f.archive), /版本不符/);
} finally {a.cleanup();}});

test('recomputed outer checksums cannot hide corruption inside the archive', () => {const a = area(); try {
    const f = fixture(a), bytes = readFileSync(f.archive); bytes[bytes.length - 1] ^= 1; writeFileSync(f.archive, bytes);
    f.report.files[0].sha256 = hash(bytes); f.save(); assert.throws(() => m.verifyDelivery(f.archive), /檔案校驗/);
} finally {a.cleanup();}});

test('stopped production host preflight leaves every host file byte-for-byte unchanged', () => {const a = area(); try {
    const f = fixture(a), root = target(a, f.archive, true), fingerprint = () => walk(root).map(name => [name, hash(readFileSync(path.join(root, name)))]), before = fingerprint();
    const result = m.deploymentPreflight(f.archive, undefined, root);
    assert.equal(result.target.enabled_admins, 1); assert.equal(result.target.mode, 'production'); assert.deepEqual(fingerprint(), before);
} finally {a.cleanup();}});

test('preflight never unlocks or stops a running, interrupted or journal-bearing target', () => {const a = area(); try {
    const f = fixture(a), root = target(a, f.archive);
    for (const name of ['control.json', 'transition.json', '.supervisor.twstockrs-lock', 'data/generation-test/library.sqlite-wal']) {const file = path.join(root, name); put(file, 'retained'); assert.throws(() => m.deploymentPreflight(f.archive, undefined, root), /仍在|交易檔/); assert.equal(readFileSync(file, 'utf8'), 'retained'); rmSync(file);}
} finally {a.cleanup();}});

test('schema mismatch, disabled last admin and invalid HTTPS config block target preparation', () => {const a = area(); try {
    const f = fixture(a), root = target(a, f.archive, true), file = path.join(root, 'data/generation-test/library.sqlite');
    let db = new DatabaseSync(file); db.exec('PRAGMA user_version=99'); db.close(); assert.throws(() => m.deploymentPreflight(f.archive, undefined, root), /不相容/);
    db = new DatabaseSync(file); db.exec('PRAGMA user_version=4;UPDATE accounts SET enabled=0'); db.close(); assert.throws(() => m.deploymentPreflight(f.archive, undefined, root), /管理員/);
    const config = JSON.parse(readFileSync(path.join(root, 'host.json'))); config.origin = 'http://test.example.invalid'; m.atomicJson(path.join(root, 'host.json'), config); assert.throws(() => m.deploymentPreflight(f.archive, undefined, root), /HTTPS/);
} finally {a.cleanup();}});

function sourceFixture(a) {
    const root = path.join(a.root, 'source'); mkdirSync(root);
    const pkg = {version: '1.0.0', dependencies: {a: '1.2.3'}, devDependencies: {b: '2.3.4'}};
    put(path.join(root, 'package.json'), JSON.stringify(pkg)); put(path.join(root, 'package-lock.json'), JSON.stringify({lockfileVersion: 3, packages: {'': pkg}}));
    for (const name of ['tsconfig.json', 'vite.config.ts', 'index.html', 'main.tsx', 'share-viewer.tsx']) put(path.join(root, name), '{}');
    put(path.join(root, 'public/approved.txt'), 'public TEST only'); put(path.join(root, 'scripts/public-files.json'), JSON.stringify(['public/approved.txt']));
    return root;
}

test('source policy rejects unapproved public files, private filenames and dependency drift', () => {const a = area(); try {
    const root = sourceFixture(a); assert.equal(sourceEvidence(root).commit, null); const file = path.join(root, 'public/customer.json'); put(file, '{}'); assert.throws(() => sourceEvidence(root), /核准清單/); rmSync(file);
    put(path.join(root, 'server/control.json'), '{}'); assert.throws(() => sourceEvidence(root), /私有檔案/); rmSync(path.join(root, 'server/control.json'));
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'))); pkg.dependencies.a = '^1.2.3'; put(path.join(root, 'package.json'), JSON.stringify(pkg)); assert.throws(() => sourceEvidence(root), /鎖定檔/);
} finally {a.cleanup();}});

test('source content fingerprint changes with source edits and never invents a Git commit', () => {const a = area(); try {
    const root = sourceFixture(a), before = sourceEvidence(root); put(path.join(root, 'server/program.ts'), 'export const value=1'); const after = sourceEvidence(root);
    assert.notEqual(before.sha256, after.sha256); assert.equal(after.commit, null); assert.equal(after.dirty, null);
} finally {a.cleanup();}});

test('both browser entry points change delivery provenance and non-file entry points are rejected',()=>{const a=area();try{
    const root=sourceFixture(a);let previous=sourceEvidence(root).sha256;
    for(const name of ['main.tsx','share-viewer.tsx']){
        const file=path.join(root,name);put(file,'/* security change */');const next=sourceEvidence(root).sha256;assert.notEqual(next,previous);previous=next;
    }
    const file=path.join(root,'main.tsx');renameSync(file,file+'.retained');mkdirSync(file);assert.throws(()=>sourceEvidence(root),/一般檔案/);
}finally{a.cleanup();}});

test('private host state and restore records cannot enter a source delivery',()=>{const a=area();try{
    const root=sourceFixture(a);
    for(const name of ['state.json','restore-history.json','restore-state.json','private.twrsbackup.enc','private.twrsbackup.enc.partial-123','private.twrsbackup.enc.json']){
        const file=path.join(root,'server',name);put(file,'synthetic private record');assert.throws(()=>sourceEvidence(root),/私有檔案/);assert.equal(path.dirname(file),path.join(root,'server'));rmSync(file);
    }
}finally{a.cleanup();}});

test('actual failed test command stops release gate before packaging, with an honest failed report', () => {const a = area(); try {
    const root = sourceFixture(a);
    for (const name of ['verify-release.mjs', 'release-policy.mjs', 'release-smoke.mjs', 'release-tests.mjs']) copyFileSync(path.resolve('scripts', name), path.join(root, 'scripts', name));
    put(path.join(root, 'node_modules/typescript/bin/tsc'), 'process.exit(0)');
    put(path.join(root, 'tests/fail.test.mjs'), "import {test} from 'node:test'; test('intentional gate rejection',()=>{throw Error('synthetic failure')})");
    const archive = path.join(a.root, 'delivery/failed.twrsrelease');
    const result = spawnSync(process.execPath, [path.join(root, 'scripts/verify-release.mjs'), '--out', archive, '--id', 'failed'], {cwd: root, encoding: 'utf8', timeout: 15000});
    assert.equal(result.status, 1); assert(!existsSync(archive)); assert(!existsSync(archive + '.sha256'));
    const report = JSON.parse(readFileSync(archive + '.verification.json')); assert.equal(report.status, 'failed'); assert.equal(report.checks.at(-1).id, 'tests'); assert.equal(report.checks.at(-1).status, 'failed'); assert.equal(report.files.length, 0);
} finally {a.cleanup();}});

test('existing delivery report is never overwritten by a new verification run', () => {const a = area(); try {
    const archive = path.join(a.root, 'delivery/existing.twrsrelease'); put(archive + '.verification.json', 'retained');
    const result = spawnSync(process.execPath, ['scripts/verify-release.mjs', '--out', archive, '--id', 'existing'], {encoding: 'utf8'});
    assert.equal(result.status, 1); assert.equal(readFileSync(archive + '.verification.json', 'utf8'), 'retained'); assert(!existsSync(archive));
} finally {a.cleanup();}});

test('a successful test-runner exit with skipped, pending or empty tests is still rejected', () => {const a = area(); try {
    const file = path.join(a.root, 'skipped.test.mjs');
    assert.throws(() => releaseTests([], a.root), /沒有找到測試/);
    for (const contents of ["import {test} from 'node:test';test.skip('skipped',()=>{})", "import {test} from 'node:test';test.todo('pending')"]) {
        writeFileSync(file, contents); assert.throws(() => releaseTests([file], a.root), /略過|計數/);
    }
    writeFileSync(file, "import {test} from 'node:test';test('real passed test',()=>{})"); assert.equal(releaseTests([file], a.root).pass, 1);
} finally {a.cleanup();}});


test('stopped-host preflight rejects unsafe Windows restore paths without creating or changing host files',()=>{const a=area();try{const f=fixture(a),short=target(a,f.archive),deep=path.join(a.root,'x'.repeat(150-a.root.length-1));assert(deep.startsWith(a.root+path.sep));renameSync(short,deep);const fingerprint=()=>walk(deep).map(n=>[n,hash(readFileSync(path.join(deep,n)))]),before=fingerprint();if(process.platform==='win32')assert.throws(()=>m.deploymentPreflight(f.archive,undefined,deep),e=>e.code==='WINDOWS_SQLITE_PATH_UNSAFE');else assert.equal(m.deploymentPreflight(f.archive,undefined,deep).status,'passed');assert.deepEqual(fingerprint(),before);}finally{a.cleanup();}});
