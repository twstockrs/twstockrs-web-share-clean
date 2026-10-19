import { spawnSync } from 'node:child_process';
import { mkdirSync, copyFileSync, cpSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import path from 'node:path';
const args = process.argv.slice(2), v = {};
for (let n = 0; n < args.length; n += 2) {
    if (!['--out', '--id'].includes(args[n]) || !args[n + 1] || v[args[n]])
        throw Error('只接受--out與--id。');
    v[args[n]] = args[n + 1];
}
if (!v['--out'] || !v['--id'] || !v['--out'].endsWith('.twrsrelease'))
    throw Error('請提供新.twrsrelease檔及版本識別。');
const output = path.resolve(v['--out']), launcher = output.slice(0, -12) + '.host.mjs', preflight = output.slice(0, -12) + '.preflight.mjs', checksum = output + '.sha256';
if ([output, launcher, preflight, checksum].some(existsSync))
    throw Error('交付檔已存在，不覆寫。');
function run(file, args = []) { const result = spawnSync(process.execPath, [file, ...args], { stdio: 'inherit' }); if (result.status !== 0)
    throw Error('發布建置未通過：' + file); }
run('node_modules/typescript/bin/tsc', ['--noEmit']);
await import('vite').then(v => v.build());
await import('./build-host.mjs');
const stage = path.resolve('server-dist', 'release-stage-' + randomUUID());
mkdirSync(path.join(stage, 'runtime'), { recursive: true });
cpSync('dist', path.join(stage, 'web'), { recursive: true });
for (const name of ['serve', 'data', 'accounts', 'backup'])
    copyFileSync('server-dist/host-runtime/' + name + '.mjs', path.join(stage, 'runtime', name + '.mjs'));
mkdirSync(path.dirname(output), { recursive: true });
run('server-dist/package-cli.mjs', ['--staging', stage, '--out', output, '--id', v['--id']]);
copyFileSync('server-dist/host.mjs', launcher);
copyFileSync('server-dist/preflight.mjs', preflight);
writeFileSync(checksum, [output, launcher, preflight].map(file => createHash('sha256').update(readFileSync(file)).digest('hex') + '  ' + path.basename(file)).join('\n') + '\n', { flag: 'wx' });
console.log(JSON.stringify({ release: output, launcher, preflight, checksum, notice: '原始打包未包含全套驗收；可部署交付請使用verify:release。' }));
