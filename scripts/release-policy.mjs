import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, lstatSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const privateName = name => /(^|\/)(\.env(?:\..*)?|host\.json|state\.json|control\.json|transition\.json|restore-(history|state)\.json|backup-policy\.json|monitor-(policy|state|receipts)\.json|auto-backup-(state|catalog)\.json|host-events\.jsonl.*|.*\.sqlite(?:-.*)?|.*\.twrsbackup[^/]*|.*\.pem|.*\.key|.*\.pfx|.*\.twstockrs-lock)$/i.test(name) && name !== '.env.example';
export function walk(root, prefix = '') {
    const files = [];
    for (const name of readdirSync(path.join(root, prefix)).sort()) {
        const relative = prefix ? prefix + '/' + name : name, stat = lstatSync(path.join(root, relative));
        if (stat.isSymbolicLink()) throw Error('來源不可包含連結：' + relative);
        if (stat.isDirectory()) files.push(...walk(root, relative));
        else if (stat.isFile()) files.push(relative);
        else throw Error('來源包含非一般檔案。');
    }
    return files;
}
export function sourceEvidence(root = process.cwd()) {
    const directories = ['app', 'components', 'server', 'shared', 'scripts', 'tests', 'public', '.github'];
    const roots = ['package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'index.html', 'main.tsx', 'share-viewer.tsx'];
    for (const name of roots) {
        const stat=lstatSync(path.join(root,name));
        if(stat.isSymbolicLink()||!stat.isFile())throw Error('建置入口必須是一般檔案，不接受連結：'+name);
    }
    const files = [...roots, ...directories.flatMap(dir => existsSync(path.join(root, dir)) ? walk(path.join(root, dir)).map(f => dir + '/' + f) : [])].sort();
    if (files.some(privateName)) throw Error('來源目錄包含私有檔案，停止交付。');
    const approved = JSON.parse(readFileSync(path.join(root, 'scripts/public-files.json'), 'utf8'));
    if (JSON.stringify(files.filter(f => f.startsWith('public/'))) !== JSON.stringify(approved)) throw Error('public公開素材與核准清單不同；請人工確認內容後才更新清單。');
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')), lock = JSON.parse(readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
    if (lock.lockfileVersion !== 3 || pkg.version !== lock.packages?.['']?.version) throw Error('套件鎖定檔版本不符。');
    for (const field of ['dependencies', 'devDependencies']) {
        if (JSON.stringify(Object.entries(pkg[field]).sort()) !== JSON.stringify(Object.entries(lock.packages[''][field]).sort()) || Object.values(pkg[field]).some(v => !/^\d+\.\d+\.\d+$/.test(v))) throw Error('套件版本未完全固定或鎖定檔不一致。');
    }
    const gitRoot = spawnSync('git', ['rev-parse', '--show-toplevel'], {cwd: root, encoding: 'utf8'});
    let commit = null, dirty = null;
    if (gitRoot.status === 0 && path.resolve(gitRoot.stdout.trim()).toLowerCase() === path.resolve(root).toLowerCase()) {
        const tracked = spawnSync('git', ['ls-files', '-z'], {cwd: root, encoding: 'utf8'});
        if (tracked.status !== 0 || tracked.stdout.split('\0').filter(Boolean).some(privateName)) throw Error('Git追蹤清單包含私有檔案或不可讀。');
        const head = spawnSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'});
        commit = head.status === 0 ? head.stdout.trim() : null;
        const status = spawnSync('git', ['status', '--porcelain'], {cwd: root, encoding: 'utf8'});
        dirty = status.status === 0 ? Boolean(status.stdout.trim()) : null;
    }
    return {sha256: hash(JSON.stringify(files.map(name => [name, hash(readFileSync(path.join(root, name)))]))), files: files.length, commit, dirty,
        lock_sha256: hash(readFileSync(path.join(root, 'package-lock.json')))};
}
