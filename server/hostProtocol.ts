import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, openSync, closeSync, fsyncSync, renameSync, existsSync, mkdirSync, readdirSync, lstatSync, realpathSync, statfsSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
export const releaseMagic = Buffer.from('TWSTOCKRS-RELEASE-1\n');
export const requiredRuntime = ['runtime/serve.mjs', 'runtime/data.mjs', 'runtime/accounts.mjs', 'runtime/backup.mjs'];
export const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const safeId = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(value) && !value.includes('..') && !/^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/i.test(value);
export function safePath(root: string, ...parts: string[]) { if (/[\r\n\0]/.test(root) || parts.some(p => /[\r\n\0]/.test(p)))
    throw Error('主機路徑不可含控制字元。'); const base = path.resolve(root), target = path.resolve(base, ...parts); if (target !== base && !target.startsWith(base + path.sep))
    throw Error('路徑超出主機目錄。'); for (let p = target;; p = path.dirname(p)) {
    if (existsSync(p) && lstatSync(p).isSymbolicLink())
        throw Error('主機檔案不可使用連結或目錄接點。');
    if (p === path.dirname(p))
        break;
} return target; }
// Keep the supervisor lock inside its private root, including under systemd's restricted filesystem.
export const hostLockDirectory = (root: string) => safePath(root, 'supervisor');
export function readJson(file: string) { if (lstatSync(file).isSymbolicLink() || lstatSync(file).size > 1024 * 1024)
    throw Error('設定或狀態檔不適用。'); return JSON.parse(readFileSync(file, 'utf8')); }
export function atomicJson(file: string, value: unknown) { safePath(path.dirname(file), path.basename(file)); const temporary = file + '.partial-' + randomUUID(), fd = openSync(temporary, 'wx', 0o600); try {
    writeFileSync(fd, JSON.stringify(value, null, 2) + '\n');
    fsyncSync(fd);
}
finally {
    closeSync(fd);
} renameSync(temporary, file); }
export type HostConfig = {
    format: 'TWStockRS-host';
    version: 1;
    host_id: string;
    mode: 'local' | 'production';
    origin: string;
    port: number;
    health_interval_ms: number;
    health_timeout_ms: number;
    start_timeout_ms: number;
    stop_timeout_ms: number;
    restart_delay_ms: number;
    restart_limit: number;
    restart_window_ms: number;
};
export function validateConfig(v: any): HostConfig {
    const fields = ['format', 'version', 'host_id', 'mode', 'origin', 'port', 'health_interval_ms', 'health_timeout_ms', 'start_timeout_ms', 'stop_timeout_ms', 'restart_delay_ms', 'restart_limit', 'restart_window_ms'];
    if (!v || Object.keys(v).some(k => !fields.includes(k)) || fields.some(k => !Object.hasOwn(v, k)) || v.format !== 'TWStockRS-host' || v.version !== 1 || !/^[a-f0-9-]{36}$/.test(v.host_id) || !['local', 'production'].includes(v.mode) || !Number.isInteger(v.port) || v.port < 1024 || v.port > 65535)
        throw Error('主機設定不完整或不合法。');
    let origin: URL;
    try {
        origin = new URL(v.origin);
    }
    catch {
        throw Error('請提供明確網站來源。');
    }
    if (origin.origin !== v.origin || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || v.mode === 'production' && origin.protocol !== 'https:' || v.mode === 'local' && (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || origin.port !== String(v.port)))
        throw Error('正式模式必須使用明確HTTPS來源，本機模式必須配合127.0.0.1埠號。');
    for (const k of ['health_interval_ms', 'health_timeout_ms', 'start_timeout_ms', 'stop_timeout_ms', 'restart_delay_ms', 'restart_window_ms'])
        if (!Number.isInteger(v[k]) || v[k] < 50 || v[k] > 600000)
            throw Error('主機時間設定不合法。');
    if (!Number.isInteger(v.restart_limit) || v.restart_limit < 1 || v.restart_limit > 10 || v.start_timeout_ms < v.health_timeout_ms || v.restart_window_ms < v.restart_delay_ms)
        throw Error('主機重啟限制不合法。');
    return v;
}
export const defaultConfig = (port = 8890, origin = 'http://127.0.0.1:' + port, mode: 'local' | 'production' = 'local'): HostConfig => validateConfig({ format: 'TWStockRS-host', version: 1, host_id: randomUUID(), mode, origin, port, health_interval_ms: 2000, health_timeout_ms: 1000, start_timeout_ms: 15000, stop_timeout_ms: 10000, restart_delay_ms: 1000, restart_limit: 3, restart_window_ms: 300000 });
export type Active = {
    release: string;
    data: string;
};
export type HostState = {
    format: 'TWStockRS-host-state';
    version: 1;
    revision: number;
    active: Active;
    previous: Active | null;
    updated_at: string;
};
export function validateState(v: any): HostState { const good = (p: any) => p && safeId(p.release) && safeId(p.data) && Object.keys(p).sort().join(',') === 'data,release'; if (!v || v.format !== 'TWStockRS-host-state' || v.version !== 1 || !Number.isSafeInteger(v.revision) || v.revision < 1 || !good(v.active) || v.previous !== null && !good(v.previous) || typeof v.updated_at !== 'string' || !Number.isFinite(Date.parse(v.updated_at)))
    throw Error('主機版本狀態不合法，原檔保留。'); return v; }
export type ReleaseManifest = {
    format: 'TWStockRS-release';
    version: 1;
    manager_protocol: 1;
    release_id: string;
    app_version: string;
    created_at: string;
    node_min: string;
    schemas: {
        library: [
            number,
            number
        ];
        imports: [
            number,
            number
        ];
    };
    files: {
        path: string;
        bytes: number;
        sha256: string;
    }[];
};
function permitted(p: string) { return requiredRuntime.includes(p) || /^web\//.test(p) && !p.split('/').some(n => !n || n.startsWith('.') || n.includes('\\') || n.includes(':')) && /\.(html|js|css|svg|png|jpg|jpeg|webp|ico|json|webmanifest|woff2|txt)$/.test(p); }
export function validateManifest(v: any): ReleaseManifest { if (!v || v.format !== 'TWStockRS-release' || v.version !== 1 || v.manager_protocol !== 1 || !safeId(v.release_id) || typeof v.app_version !== 'string' || !/^\d+\.\d+\.\d+$/.test(v.app_version) || typeof v.created_at !== 'string' || !Number.isFinite(Date.parse(v.created_at)) || typeof v.node_min !== 'string' || !/^\d+\.\d+\.\d+$/.test(v.node_min) || !v.schemas || !Array.isArray(v.files) || !v.files.length || v.files.length > 2000)
    throw Error('發布包清單不合法或管理流程版本不支援。'); for (const k of ['library', 'imports']) {
    const a = v.schemas[k];
    if (!Array.isArray(a) || a.length !== 2 || a.some((n: unknown) => !Number.isInteger(n) || Number(n) < 1 || Number(n) > 999) || a[0] > a[1])
        throw Error('發布包資料格式範圍不合法。');
} const names = new Set<string>(); let total = 0; for (const f of v.files) {
    if (!f || typeof f.path !== 'string' || !permitted(f.path) || names.has(f.path.toLowerCase()) || !Number.isSafeInteger(f.bytes) || f.bytes < 1 || f.bytes > 32 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(f.sha256))
        throw Error('發布包檔案路徑、大小或校驗不合法。');
    names.add(f.path.toLowerCase());
    total += f.bytes;
} if (total > 128 * 1024 * 1024 || [...requiredRuntime, 'web/index.html'].some(n => !names.has(n)))
    throw Error('發布包缺少必要程式或超過128MiB。'); return v; }
export function nodeCompatible(minimum: string) { const a = process.versions.node.split('.').map(Number), b = minimum.split('.').map(Number); for (let i = 0; i < 3; i++) {
    if (a[i] > b[i])
        return;
    if (a[i] < b[i])
        throw Error('Node.js版本低於發布包需求。');
} }
export function fileList(root: string, prefix = ''): ReleaseManifest['files'] { const result: ReleaseManifest['files'] = []; for (const name of readdirSync(root).sort()) {
    const relative = prefix ? prefix + '/' + name : name, file = safePath(root, name), s = lstatSync(file);
    if (s.isDirectory())
        result.push(...fileList(file, relative));
    else if (s.isFile()) {
        if (!permitted(relative) || /\.twrsbackup/i.test(relative))
            throw Error('發布目錄含不允許的檔案：' + relative);
        const bytes = readFileSync(file);
        result.push({ path: relative, bytes: bytes.length, sha256: digest(bytes) });
    }
    else
        throw Error('發布目錄含非一般檔案。');
} return result; }
export function writeRelease(root: string, output: string, id: string, version = '0.3.0') {
    const manifest = validateManifest({ format: 'TWStockRS-release', version: 1, manager_protocol: 1, release_id: id, app_version: version, created_at: new Date().toISOString(), node_min: '22.13.0', schemas: { library: [1, 4], imports: [1, 2] }, files: fileList(root) }), header = Buffer.from(JSON.stringify(manifest)), length = Buffer.alloc(4);
    length.writeUInt32BE(header.length);
    const body = Buffer.concat([releaseMagic, length, header, ...manifest.files.map(f => readFileSync(safePath(root, f.path)))]);
    const fd = openSync(output, 'wx', 0o600);
    try {
        writeFileSync(fd, body);
        fsyncSync(fd);
    }
    finally {
        closeSync(fd);
    }
    return { release_id: id, sha256: digest(body), bytes: body.length };
}
export function verifyInstalled(root: string): ReleaseManifest { const manifest = validateManifest(readJson(safePath(root, 'manifest.json'))); nodeCompatible(manifest.node_min); const allowed = new Set(['manifest.json', ...manifest.files.map(f => f.path)]); const visit = (directory: string, prefix = '') => { for (const name of readdirSync(directory)) {
    const relative = prefix ? prefix + '/' + name : name, file = safePath(directory, name), entry = lstatSync(file);
    if (entry.isDirectory())
        visit(file, relative);
    else if (!entry.isFile() || !allowed.has(relative))
        throw Error('已安裝版本含清單外檔案。');
} }; visit(root); for (const f of manifest.files) {
    const file = safePath(root, f.path);
    if (!lstatSync(file).isFile() || lstatSync(file).size !== f.bytes || digest(readFileSync(file)) !== f.sha256)
        throw Error('已安裝程式校驗失敗：' + f.path);
} return manifest; }
export function inspectRelease(archive: string) {
    const size = lstatSync(archive);
    if (!size.isFile() || size.isSymbolicLink() || size.size > 130 * 1024 * 1024)
        throw Error('發布包不是合法一般檔案或過大。');
    const blob = readFileSync(archive);
    if (!blob.subarray(0, releaseMagic.length).equals(releaseMagic) || blob.length < releaseMagic.length + 4)
        throw Error('不是TWStockRS發布包。');
    const headerSize = blob.readUInt32BE(releaseMagic.length), offset = releaseMagic.length + 4;
    if (headerSize < 2 || headerSize > 1024 * 1024 || offset + headerSize > blob.length)
        throw Error('發布包標頭大小不正確。');
    const manifest = validateManifest(JSON.parse(new TextDecoder('utf8', { fatal: true }).decode(blob.subarray(offset, offset + headerSize))));
    nodeCompatible(manifest.node_min);
    if (manifest.files.reduce((n, f) => n + f.bytes, offset + headerSize) !== blob.length)
        throw Error('發布包檔案總長度不符。');
    let position = offset + headerSize;
    for (const f of manifest.files) {
        if (digest(blob.subarray(position, position + f.bytes)) !== f.sha256)
            throw Error('發布包檔案校驗失敗。');
        position += f.bytes;
    }
    return { manifest, blob, offset: offset + headerSize };
}
export function stageRelease(hostRoot: string, archive: string) {
    const {manifest, blob, offset} = inspectRelease(archive);
    const target = safePath(hostRoot, 'releases', manifest.release_id);
    if (existsSync(target)) {
        const installed = verifyInstalled(target);
        if (JSON.stringify(installed) !== JSON.stringify(manifest))
            throw Error('相同版本識別已有不同內容，原程式保留。');
        return manifest;
    }
    const staging = safePath(hostRoot, 'releases', 'incoming-' + randomUUID());
    mkdirSync(staging, { recursive: true });
    let position = offset;
    for (const f of manifest.files) {
        const file = safePath(staging, f.path);
        mkdirSync(path.dirname(file), { recursive: true });
        writeFileSync(file, blob.subarray(position, position + f.bytes), { flag: 'wx', mode: 0o600 });
        position += f.bytes;
    }
    atomicJson(path.join(staging, 'manifest.json'), manifest);
    verifyInstalled(staging);
    renameSync(staging, target);
    return manifest;
}
export function dataCompatible(directory: string, manifest: ReleaseManifest) { for (const [file, k] of [['library.sqlite', 'library'], ['imports.sqlite', 'imports']] as const) {
    const db = new DatabaseSync(safePath(directory, file), { readOnly: true });
    try {
        const v = Number(db.prepare('PRAGMA user_version').get()!.user_version), [low, high] = manifest.schemas[k];
        if (v < low || v > high)
            throw Error('資料格式與目標程式不相容，不能以舊資料覆蓋；請保留目前版本。');
    }
    finally {
        db.close();
    }
} }
export function capacityCheck(root: string, source: string) { let bytes = 0; for (const name of readdirSync(source)) {
    const f = safePath(source, name);
    if (lstatSync(f).isFile())
        bytes += lstatSync(f).size;
} const free = statfsSync(root, { bigint: true }); if (free.bavail * free.bsize < BigInt(bytes) * 4n + 64n * 1024n * 1024n)
    throw Error('磁碟可用空間不足，原版本仍在運行。'); }
export function current(root: string) { return validateState(readJson(safePath(root, 'state.json'))); }
export function hostMaintenanceSummary(root:string,mode:'local'|'production'){
 const state=current(root),directory=safePath(root,'backups');let backups=0,backup_bytes=0,latest_backup_at:number|null=null;
 if(existsSync(directory))for(const name of readdirSync(directory)){if(!/^before-[a-f0-9-]{36}\.twrsbackup$/.test(name))continue;const entry=lstatSync(safePath(directory,name));if(!entry.isFile())continue;backups++;backup_bytes+=entry.size;latest_backup_at=Math.max(latest_backup_at||0,Math.floor(entry.mtimeMs))}
 return {mode,release_id:state.active.release,previous_release:state.previous?.release||null,revision:state.revision,backups,backup_bytes,latest_backup_at};
}
