import path from 'node:path';
import { existsSync,mkdtempSync,rmSync,statSync } from 'node:fs';
import {tmpdir} from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { LibraryStore } from './libraryStore';
import { ImportStore } from './importStore';
import { ReleaseStore } from './releaseStore';
import { createStoppedBackup, previewBackup, restoreBackup, inspectData,archiveBackupSnapshot } from './systemBackup';
import { unlockStoppedData, dataPaths } from './dataLock';
import {assertSQLiteDirectory,assertRestorePaths,assertBackupTemporaryPaths} from './sqlitePaths';
function run() {
    const [operation, ...args] = process.argv.slice(2), v: Record<string, string> = {};
    for (let n = 0; n < args.length; n += 2) {
        if (!['--source', '--target', '--backup', '--expected-pid'].includes(args[n]) || !args[n + 1] || v[args[n]])
            throw Error('主機資料工具參數不正確。');
        v[args[n]] = args[n + 1];
    }
    if (operation === 'init') {
        assertSQLiteDirectory(v['--target']);
        const root = dataPaths(v['--target']).root;
        if (existsSync(path.join(root, 'library.sqlite')) || existsSync(path.join(root, 'imports.sqlite')))
            throw Error('首次建立不得覆蓋資料。');
        const l = new LibraryStore(path.join(root, 'library.sqlite')), i = new ImportStore(path.join(root, 'imports.sqlite'));
        try {
            new ReleaseStore(i);
        }
        finally {
            l.close();
            i.close();
        }
        return { initialized: true };
    }
    if (operation === 'clone') {
        assertRestorePaths(v['--target']);assertSQLiteDirectory(v['--source']);assertBackupTemporaryPaths();
        const source = dataPaths(v['--source']).root, target = dataPaths(v['--target']).root;
        if (existsSync(target))
            throw Error('新版資料副本必須使用新目錄。');
        const backup = createStoppedBackup(source, path.resolve(v['--backup'])), preview = previewBackup(v['--backup'], target);
        restoreBackup(v['--backup'], target, preview.confirmation_token);
        return { backup_sha256: backup.sha256, cloned: true };
    }
    if (operation === 'inspect') {
        inspectData(dataPaths(v['--source']).root);
        return { valid: true };
    }
    if(operation==='archive')return archiveBackupSnapshot(dataPaths(v['--source']).root,path.resolve(v['--backup']));
    if(operation==='verify-backup'){
        assertBackupTemporaryPaths();
        const temp=mkdtempSync(path.join(tmpdir(),'twrs-auto-verify-'));
        try{const p=previewBackup(path.resolve(v['--backup']),path.join(temp,'restore-target'));return {valid:true,sha256:p.sha256,bytes:statSync(v['--backup']).size};}
        finally{if(path.dirname(temp)!==path.resolve(tmpdir())||!path.basename(temp).startsWith('twrs-auto-verify-'))throw Error('Invalid verification directory');rmSync(temp,{recursive:true,force:true});}
    }
    if (operation === 'unlock') {
        const p = dataPaths(v['--source']);
        if (existsSync(p.lock)) {
            const { readFileSync } = requireFs();
            const record = JSON.parse(readFileSync(p.lock, 'utf8'));
            if (String(record.pid) !== v['--expected-pid'])
                throw Error('資料鎖不屬於已停止的子程序，原鎖保留。');
        }
        return { notice: unlockStoppedData(p.root) };
    }
    throw Error('主機資料工具操作不適用。');
}
import * as fs from 'node:fs';
const requireFs = () => fs;
try {
    console.log(JSON.stringify(run()));
}
catch (error) {
    console.error(error instanceof Error ? error.message : '主機資料操作失敗。');
    process.exitCode = 1;
}
