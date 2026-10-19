import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, copyFileSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { sourceEvidence, hash } from './release-policy.mjs';
import { smokeRelease } from './release-smoke.mjs';
import { releaseTests } from './release-tests.mjs';

const args = process.argv.slice(2), values = {};
for (let i = 0; i < args.length; i += 2) {
    if (!['--out', '--id'].includes(args[i]) || !args[i + 1] || values[args[i]]) throw Error('請提供--out與--id，不接受略過檢查參數。');
    values[args[i]] = args[i + 1];
}
if (!values['--out']?.endsWith('.twrsrelease') || !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(values['--id'] || '') || values['--id'].includes('..')) throw Error('發布包副檔名或版本識別不合法。');
const archive = path.resolve(values['--out']), base = archive.slice(0, -12), directory = path.dirname(archive), reportFile = archive + '.verification.json';
const artifacts = [archive, base + '.host.mjs', base + '.preflight.mjs', base + '.offline.html'];
if ([...artifacts, reportFile, archive + '.sha256'].some(existsSync)) throw Error('交付目標已存在，不覆寫。');
// Keep generated artifacts outside source/build folders to make source provenance unambiguous.
const relative = path.relative(process.cwd(), directory).split(path.sep)[0];
if (!relative || ['app', 'components', 'server', 'shared', 'scripts', 'tests', 'public', '.github', 'dist', 'server-dist'].includes(relative)) throw Error('請使用獨立的交付目錄。');
mkdirSync(directory, {recursive: true});
const report = {format: 'TWStockRS-verification', version: 1, status: 'failed', release_id: values['--id'], started_at: new Date().toISOString(), node: process.versions.node, platform: process.platform, source: null, lock_sha256: null, checks: [], files: [], public_deployment_verified: false};
function run(file, args = []) {
    const env = {...process.env}; delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, [file, ...args], {stdio: 'inherit', env, timeout: 20 * 60 * 1000});
    if (result.error || result.status !== 0) throw Error('檢查或建置失敗：' + file);
}
async function check(id, action) {
    const item = {id, status: 'failed', duration_ms: 0}; report.checks.push(item); const start = Date.now();
    try {await action(); item.status = 'passed';} finally {item.duration_ms = Date.now() - start;}
}
try {
    await check('source-policy', () => {report.source = sourceEvidence(); report.lock_sha256 = report.source.lock_sha256;});
    await check('types', () => run('node_modules/typescript/bin/tsc', ['--noEmit']));
    await check('tests', () => {
        const files = readdirSync('tests').filter(name => name.endsWith('.test.mjs')).sort().map(name => 'tests/' + name);
        report.tests = releaseTests(files);
    });
    await check('server-build', () => run('scripts/build-server.mjs'));
    await check('offline-build', () => run('scripts/build-offline.mjs'));
    await check('package-build', () => {run('scripts/package-release.mjs', ['--out', archive, '--id', values['--id']]); copyFileSync('TWStockRS-Foundation-0.html', artifacts[3]);});
    await check('standalone-smoke', async () => {report.smoke = await smokeRelease(archive, artifacts[1], values['--id']);});
    await check('source-unchanged', () => {if (sourceEvidence().sha256 !== report.source.sha256) throw Error('驗收期間來源已變更，禁止發布混合版本。');});
    report.files = artifacts.map(file => {const bytes = readFileSync(file); return {name: path.basename(file), bytes: bytes.length, sha256: hash(bytes)};});
    report.status = 'passed';
} catch (error) {
    report.failure = error instanceof Error ? error.message : '驗收未通過。'; process.exitCode = 1;
} finally {
    report.finished_at = new Date().toISOString();
    writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n', {flag: 'wx'});
    if (report.status === 'passed') writeFileSync(archive + '.sha256', [...report.files.map(f => f.sha256 + '  ' + f.name), hash(readFileSync(reportFile)) + '  ' + path.basename(reportFile)].join('\n') + '\n');
    console.log(JSON.stringify({status: report.status, report: reportFile, failure: report.failure}));
}
if (report.status === 'passed') {
    try {run(artifacts[2], ['--release', archive]);}
    catch (error) {
        report.status = 'failed'; report.failure = '交付檔案最終自我檢查失敗。'; process.exitCode = 1;
        writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
        console.error(report.failure);
    }
}
