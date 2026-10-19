import { readFileSync, existsSync, lstatSync, readdirSync, mkdtempSync, copyFileSync, chmodSync, rmSync } from 'node:fs';
import path from 'node:path';
import {tmpdir} from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { digest, inspectRelease, safePath, current, verifyInstalled, validateConfig, readJson, dataCompatible, capacityCheck, hostLockDirectory } from './hostProtocol';
import { dataPaths } from './dataLock';
import {assertHostPaths,assertBackupTemporaryPaths} from './sqlitePaths';

export const releaseChecks = ['source-policy', 'types', 'tests', 'server-build', 'offline-build', 'package-build', 'standalone-smoke', 'source-unchanged'] as const;
export function verifyDelivery(archive: string, reportFile = archive + '.verification.json') {
    archive = safePath(path.resolve(archive));
    const directory = path.dirname(archive), report = readJson(safePath(path.resolve(reportFile)));
    const hash = /^[a-f0-9]{64}$/;
    if (report.format !== 'TWStockRS-verification' || report.version !== 1 || report.status !== 'passed' || !hash.test(report.source?.sha256) || !hash.test(report.lock_sha256) || !Array.isArray(report.checks) || report.checks.length !== releaseChecks.length || releaseChecks.some((id, i) => report.checks[i]?.id !== id || report.checks[i]?.status !== 'passed') || !Array.isArray(report.files))
        throw Error('交付驗收報告未完整通過，禁止視為可部署版本。');
    if (!Number.isSafeInteger(report.tests?.tests) || report.tests.tests < 1 || report.tests.pass !== report.tests.tests || ['fail', 'cancelled', 'skipped', 'todo'].some(k => report.tests[k] !== 0))
        throw Error('交付報告的完整測試計數未通過。');
    const base = path.basename(archive).slice(0, -12);
    const names = [path.basename(archive), base + '.host.mjs', base + '.preflight.mjs', base + '.offline.html'];
    if (!archive.endsWith('.twrsrelease') || report.files.length !== names.length || report.files.some((f: any, i: number) => f?.name !== names[i] || !hash.test(f.sha256) || !Number.isSafeInteger(f.bytes) || f.bytes < 1))
        throw Error('交付報告檔案清單不符。');
    for (const f of report.files) {
        const file = safePath(directory, f.name), stat = lstatSync(file);
        if (!stat.isFile() || stat.size !== f.bytes || digest(readFileSync(file)) !== f.sha256)
            throw Error('交付檔案完整性檢查失敗：' + f.name);
    }
    const {manifest} = inspectRelease(archive);
    if (report.release_id !== manifest.release_id) throw Error('交付報告與程式版本不符。');
    const lines = readFileSync(safePath(directory, path.basename(archive) + '.sha256'), 'utf8').trim().split(/\r?\n/);
    const expected = [...report.files.map((f: any) => f.sha256 + '  ' + f.name), digest(readFileSync(reportFile)) + '  ' + path.basename(reportFile)];
    if (JSON.stringify(lines) !== JSON.stringify(expected)) throw Error('交付指紋清單與驗收報告不符。');
    return {manifest, report};
}

// This is deliberately a stopped-host, read-only check. It never initializes,
// migrates, unlocks, backs up, updates or starts a target host.
export function deploymentPreflight(archive: string, reportFile?: string, hostRoot?: string) {
    const {manifest, report} = verifyDelivery(archive, reportFile);
    let target: null | {mode: string; revision: number; current_release: string; enabled_admins: number} = null;
    if (hostRoot) {
        const root = safePath(path.resolve(hostRoot));
        assertHostPaths(root);
        if (existsSync(safePath(root, 'control.json')) || existsSync(dataPaths(hostLockDirectory(root)).lock) || existsSync(safePath(root, 'transition.json')))
            throw Error('目標主機仍在運作或維護中；請正常停止後再檢查，不自動停止或復原。');
        const config = validateConfig(readJson(safePath(root, 'host.json'))), state = current(root);
        verifyInstalled(safePath(root, 'releases', state.active.release));
        const candidate = safePath(root, 'releases', manifest.release_id);
        if (existsSync(candidate) && JSON.stringify(verifyInstalled(candidate)) !== JSON.stringify(manifest)) throw Error('目標已有同名但不同內容的程式。');
        const data = safePath(root, 'data', state.active.data);
        if (existsSync(dataPaths(data).lock) || readdirSync(data).some(name => /-(wal|shm|journal)$/.test(name)))
            throw Error('資料仍有鎖或交易檔，請先完成正常停止／復原；不開啟或改寫資料。');
        capacityCheck(root, data);
        let admins = 0;
        // SQLite readOnly can still create WAL/SHM files beside a WAL-mode DB.
        // Never open target DBs: inspect disposable, private, stopped-file copies.
        assertBackupTemporaryPaths();
        const snapshot = mkdtempSync(path.join(tmpdir(), 'twrs-preflight-'));
        try {
            const hashes = new Map<string, string>();
            for (const name of ['library.sqlite', 'imports.sqlite']) {
                const source = safePath(data, name);
                if (!lstatSync(source).isFile()) throw Error('目標資料庫不是一般檔案。');
                const fingerprint = digest(readFileSync(source)); hashes.set(name, fingerprint);
                const copy = path.join(snapshot, name); copyFileSync(source, copy); if (process.platform !== 'win32') chmodSync(copy, 0o600);
                if (digest(readFileSync(copy)) !== fingerprint) throw Error('複製檢查期間資料已變更，請重新檢查。');
            }
            dataCompatible(snapshot, manifest);
            for (const name of ['library.sqlite', 'imports.sqlite']) {
                const db = new DatabaseSync(path.join(snapshot, name), {readOnly: true});
                try {
                    if (db.prepare('PRAGMA quick_check').all().some(row => row.quick_check !== 'ok')) throw Error('目標資料庫結構檢查失敗。');
                    if (name === 'library.sqlite' && Number(db.prepare('PRAGMA user_version').get()!.user_version) >= 3)
                        admins = Number(db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE role='admin' AND enabled=1").get()!.n);
                } finally { db.close(); }
            }
            if (JSON.stringify(current(root)) !== JSON.stringify(state) || existsSync(safePath(root, 'control.json')) || existsSync(dataPaths(hostLockDirectory(root)).lock) || existsSync(safePath(root, 'transition.json')) || existsSync(dataPaths(data).lock) || readdirSync(data).some(name => /-(wal|shm|journal)$/.test(name)) || [...hashes].some(([name, fingerprint]) => digest(readFileSync(safePath(data, name))) !== fingerprint))
                throw Error('檢查期間目標已變更或啟動，請重新檢查。');
        } finally {
            if (path.dirname(snapshot) !== path.resolve(tmpdir()) || !path.basename(snapshot).startsWith('twrs-preflight-')) throw Error('檢查暫存目錄不適用。');
            rmSync(snapshot, {recursive: true, force: true});
        }
        if (config.mode === 'production' && !admins) throw Error('正式模式缺少有效管理員。');
        target = {mode: config.mode, revision: state.revision, current_release: state.active.release, enabled_admins: admins};
    }
    return {format: 'TWStockRS-deployment-preflight', version: 1, status: 'passed', release_id: manifest.release_id, source_sha256: report.source.sha256, target,
        scope: hostRoot ? 'stopped-host-update-preparation' : 'delivery-integrity', public_deployment_verified: false,
        remaining: ['正式主機埠號與服務啟動', '網域、HTTPS與反向代理', 'OS開機與實際備份保存', '真實行情及授權']};
}
