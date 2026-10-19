import { mkdirSync, existsSync, readdirSync, copyFileSync, unlinkSync, chmodSync,readFileSync,renameSync,openSync,fsyncSync,closeSync,constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { atomicJson, current, hostLockDirectory, defaultConfig, readJson, safePath, stageRelease, validateConfig, validateState, verifyInstalled,digest, type HostState } from './hostProtocol';
import {readBackupPolicy,validateBackupPolicy,backupSummary,backupEntries,protectBackup} from './autoBackup';
import {readMonitorPolicy,validateMonitorPolicy,monitorSummary} from './serviceMonitor';
import { HostSupervisor, hostRequest, runDataTool } from './hostSupervisor';
import { acquireDataLock, unlockStoppedData, dataPaths } from './dataLock';
import { writeServiceTemplates } from './hostTemplates';
import {assertHostPaths,assertRestorePaths,assertSQLiteDirectory,assertBackupTemporaryPaths} from './sqlitePaths';
const args = process.argv.slice(2), operation = args.shift(), values: Record<string, string> = {};
let rest: string[] = [];
while (args.length) {
    const key = args.shift()!;
    if (key === '--') {
        rest = args.splice(0);
        break;
    }
    const value = args.shift();
    if (!['--root', '--release', '--port', '--origin', '--mode', '--user'].includes(key) || !value || Object.hasOwn(values, key))
        throw Error('主機工具參數不正確。');
    values[key] = value;
}
async function recover(root: string, config: ReturnType<typeof validateConfig>) {
    const file = safePath(root, 'control.json');
    if (existsSync(file)) {
        const control = readJson(file);
        if (control.format !== 'TWStockRS-host-control' || control.version !== 1 || control.host_id !== config.host_id || !Number.isSafeInteger(control.pid) || control.pid < 1)
            throw Error('控制狀態不適用，原檔保留。');
        const stopped = (pid: number) => { try {
            process.kill(pid, 0);
            return false;
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code === 'ESRCH')
                return true;
            throw Error('無法確認舊程序停止。');
        } };
        if (!stopped(control.pid))
            throw Error('主機管理程序仍在運行，不能復原。');
        if (control.child_pid) {
            const until = Date.now() + config.stop_timeout_ms;
            while (!stopped(control.child_pid) && Date.now() < until)
                await new Promise(r => setTimeout(r, 100));
            if (!stopped(control.child_pid))
                throw Error('原服務仍存在，所有資料保留。');
        }
        unlinkSync(file);
    }
    unlockStoppedData(hostLockDirectory(root));
    const state = current(root), generations = new Set([state.active.data, ...(state.previous ? [state.previous.data] : [])]), journal = safePath(root, 'transition.json');
    if (existsSync(journal)) {
        const value = readJson(journal);
        if (value.format !== 'TWStockRS-host-transition' || value.version !== 1)
            throw Error('更新日誌不適用。');
        generations.add(validateState(value.from).active.data);
        generations.add(validateState(value.to).active.data);
    }
    for (const generation of generations) {
        const data = safePath(root, 'data', generation);
        unlockStoppedData(data);
    }
    return { recovered: true, notice: '已確認舊程序停止並釋放殘留鎖；下次run依已提交版本恢復，所有資料副本保留。' };
}
async function main() {
    if (!operation || !['init', 'run', 'status', 'update', 'rollback', 'restart', 'stop', 'recover', 'account', 'backup', 'templates','auto-backup','monitor','manager-install','path-check'].includes(operation) || !values['--root'])
        throw Error('請指定init／run／status／update／rollback／restart／stop／recover／account／templates及--root。');
    const allowed: Record<string, string[]> = { init: ['--root', '--release', '--port', '--origin', '--mode'], update: ['--root', '--release'], templates: ['--root', '--user'], account: ['--root'], backup: ['--root'] };
    if (Object.keys(values).some(k => !(allowed[operation] || ['--root']).includes(k)) || !['account','backup','auto-backup','monitor'].includes(operation) && rest.length)
        throw Error('此操作不接受這些參數，設定未變更。');
    const root = safePath(path.resolve(values['--root'])), manager = fileURLToPath(import.meta.url);
    if (operation === 'init') {
        assertHostPaths(root);
        if (!values['--release'] || existsSync(root) && readdirSync(root).length)
            throw Error('首次建立須提供發布包與全新空目錄。');
        const config = defaultConfig(Number(values['--port'] || 8890), values['--origin'] || 'http://127.0.0.1:' + (values['--port'] || 8890), (values['--mode'] || 'local') as 'local' | 'production');
        mkdirSync(root, { recursive: true, mode: 0o700 });
        if (process.platform !== 'win32') chmodSync(root, 0o700);
        const unlock = acquireDataLock(hostLockDirectory(root));
        try {
            const lockName=path.basename(dataPaths(hostLockDirectory(root)).lock);
            if (readdirSync(root).some(name=>name!==lockName)) throw Error('首次建立不得覆蓋既有目錄。');
            const release = stageRelease(root, path.resolve(values['--release'])), generation = 'generation-' + randomUUID();
            await runDataTool(root, release.release_id, ['init', '--target', safePath(root, 'data', generation)]);
            atomicJson(safePath(root, 'host.json'), config);
            atomicJson(safePath(root, 'state.json'), { format: 'TWStockRS-host-state', version: 1, revision: 1, active: { release: release.release_id, data: generation }, previous: null, updated_at: new Date().toISOString() });
            copyFileSync(manager, safePath(root, 'host.mjs'));
            return { initialized: true, release_id: release.release_id, origin: config.origin, notice: '主機檔案已建立，尚未啟動或公開網站。' };
        }
        finally {
            unlock();
        }
    }
    const config = validateConfig(readJson(safePath(root, 'host.json')));
    if(operation==='path-check'){
        const state=current(root),host=assertHostPaths(root),restore=assertRestorePaths(safePath(root,'data',state.active.data));
        return {status:'passed',...host,active_restore_checked_files:restore.checked_files,notice:'已檢查資料庫、還原／保留副本、備份與暫存路徑；沒有停機、搬動資料或修改設定。'};
    }
    if(operation==='manager-install'){
        if(existsSync(dataPaths(hostLockDirectory(root)).lock)||existsSync(safePath(root,'control.json'))||existsSync(safePath(root,'transition.json')))throw Error('請正常停止主機並完成復原，再安裝管理器。');
        const unlock=acquireDataLock(hostLockDirectory(root));try{
            const state=current(root);verifyInstalled(safePath(root,'releases',state.active.release));
            const target=safePath(root,'host.mjs'),next=readFileSync(manager),old=readFileSync(target);
            if(digest(next)===digest(old))return {installed:false,notice:'已使用相同管理器。'};
            const before=safePath(root,'manager-before-'+randomUUID()+'.mjs'),temporary=safePath(root,'host.mjs.partial-'+randomUUID());
            copyFileSync(target,before,constants.COPYFILE_EXCL);copyFileSync(manager,temporary,constants.COPYFILE_EXCL);if(process.platform!=='win32'){chmodSync(before,0o600);chmodSync(temporary,0o600);}
            const fd=openSync(temporary,'r+');try{fsyncSync(fd);}finally{closeSync(fd);}renameSync(temporary,target);
            return {installed:true,previous_manager:before.split(path.sep).at(-1),sha256:digest(next),notice:'管理器已更新，舊檔保留；服務與資料版本未變更。'};
        }finally{unlock();}
    }
    if(operation==='monitor'){
        const [action='status',...args]=rest;
        if(action==='status'&&!args.length)return monitorSummary(root,config.host_id);
        if(action==='test'&&!args.length)return hostRequest(root,'monitor-test');
        if(action==='retry'&&!args.length)return hostRequest(root,'monitor-retry');
        if(action!=='configure'||!args.length)throw Error('監控操作只接受status／test／retry／configure。');
        if(existsSync(dataPaths(hostLockDirectory(root)).lock)||existsSync(safePath(root,'control.json'))||existsSync(safePath(root,'transition.json')))throw Error('請正常停止主機後修改監控政策。');
        const options:Record<string,string>={};for(let i=0;i<args.length;i+=2){if(!args[i].startsWith('--')||!args[i+1]||options[args[i]])throw Error('監控政策參數不正確。');options[args[i]]=args[i+1];}
        const unlock=acquireDataLock(hostLockDirectory(root));try{
            const policy={...readMonitorPolicy(root)},fields:Record<string,string>={'--enabled':'enabled','--min-free-mb':'min_free_mb','--backup-late-minutes':'backup_late_minutes','--queue-errors':'queue_errors','--trigger-samples':'trigger_samples','--recover-samples':'recover_samples'};
            for(const [key,value] of Object.entries(options)){if(!fields[key]||key==='--enabled'&&!['true','false'].includes(value)||key!=='--enabled'&&!/^\d+$/.test(value))throw Error('監控政策參數不正確。');(policy as any)[fields[key]]=key==='--enabled'?value==='true':Number(value);}
            validateMonitorPolicy(policy);atomicJson(safePath(root,'monitor-policy.json'),policy);return {policy,notice:'政策已儲存，下次run生效。通知通道只寫入本機模擬接收記錄。'};
        }finally{unlock();}
    }
    if(operation==='auto-backup'){

        const [action='status',...args]=rest;
        if(action==='status'&&!args.length)return backupSummary(root,config.host_id);
        if(action==='list'&&!args.length)return {entries:backupEntries(root,config.host_id),summary:backupSummary(root,config.host_id)};
        if(action==='run'&&!args.length)return hostRequest(root,'auto-backup-run');
        if(!['configure','protect'].includes(action))throw Error('自動備份操作只接受status／list／run／configure／protect。');
        if(existsSync(dataPaths(hostLockDirectory(root)).lock)||existsSync(safePath(root,'control.json'))||existsSync(safePath(root,'transition.json')))throw Error('請正常停止主機後修改備份政策或保留標記。');
        const options:Record<string,string>={};for(let i=0;i<args.length;i+=2){if(!args[i].startsWith('--')||!args[i+1]||options[args[i]])throw Error('備份政策參數不正確。');options[args[i]]=args[i+1];}
        const unlock=acquireDataLock(hostLockDirectory(root));try{
            if(action==='protect'){if(Object.keys(options).sort().join(',')!=='--id,--protected'||!['true','false'].includes(options['--protected']))throw Error('請提供--id與--protected true／false。');return protectBackup(root,config.host_id,options['--id'],options['--protected']==='true');}
            const policy={...readBackupPolicy(root)};const fields:Record<string,string>={'--enabled':'enabled','--time':'time','--keep-recent':'keep_recent','--keep-daily':'keep_daily','--keep-weekly':'keep_weekly','--min-free-mb':'min_free_mb'};
            if(!Object.keys(options).length)throw Error('請提供要調整的備份政策。');
            for(const [key,value] of Object.entries(options)){if(!fields[key]||key==='--enabled'&&!['true','false'].includes(value)||!['--enabled','--time'].includes(key)&&!/^\d+$/.test(value))throw Error('備份政策參數不正確。');(policy as any)[fields[key]]=key==='--enabled'?value==='true':key==='--time'?value:Number(value);}
            validateBackupPolicy(policy);atomicJson(safePath(root,'backup-policy.json'),policy);return {policy,notice:'政策已儲存，下次主機run開始排程；同一天已成功的排程不重複執行。'};
        }finally{unlock();}
    }
    if (operation === 'run') {
        if (existsSync(dataPaths(hostLockDirectory(root)).lock) || existsSync(safePath(root, 'control.json')))
            await recover(root, config);
        const supervisor = new HostSupervisor(root, config);
        let ending = false;
        const stop = () => { if (ending)
            return; ending = true; void supervisor.close().then(() => { if (process.connected)
            process.disconnect(); }).catch(() => process.exit(1)); };
        for (const signal of ['SIGINT', 'SIGTERM'] as const)
            process.on(signal, stop);
        process.on('message', m => { if ((m as any)?.type === 'stop')
            stop(); });
        if (process.send)
            process.on('disconnect', stop);
        await supervisor.start();
        await supervisor.finished;
        if (process.connected)
            process.disconnect();
        return;
    }
    if (operation === 'recover')
        return recover(root, config);
    if (operation === 'account' || operation === 'backup') {
        const state = current(root),data=safePath(root,'data',state.active.data);
        if(operation==='account')assertSQLiteDirectory(data);
        else if(['preview','restore','undo'].includes(rest[0])){assertRestorePaths(data);assertBackupTemporaryPaths();}
        else if(rest[0]==='create'){assertSQLiteDirectory(data);assertBackupTemporaryPaths();}
        if (existsSync(dataPaths(hostLockDirectory(root)).lock))
            throw Error('請先停止主機服務，再執行帳號或完整備份維護。');
        if (!rest.length || rest.some(a => ['--data-dir', '--root'].includes(a)))
            throw Error('維護操作須放在--之後，資料目錄由主機狀態決定。');
        const file = safePath(root, 'releases', state.active.release, operation === 'account'?'runtime/accounts.mjs':'runtime/backup.mjs');
        verifyInstalled(safePath(root, 'releases', state.active.release));
        const unlock = acquireDataLock(hostLockDirectory(root));
        try {
            await new Promise<void>((resolve, reject) => { const child = spawn(process.execPath, [file, ...rest, '--data-dir', safePath(root, 'data', state.active.data)], { stdio: 'inherit' }); child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(Error('維護操作未完成。'))); });
            return;
        }
        finally {
            unlock();
        }
    }
    if (operation === 'templates')
        return writeServiceTemplates(root, values['--user']);
    // Also protect callers using a new launcher against an older running manager.
    if(operation==='update'||operation==='rollback')assertHostPaths(root);
    if(operation==='restart')assertSQLiteDirectory(safePath(root,'data',current(root).active.data));
    return hostRequest(root, operation, values['--release']);
}
try {
    const result = await main();
    if (result)
        console.log(JSON.stringify(result, null, 2));
}
catch (error) {
    console.error(error instanceof Error ? error.message : '主機操作失敗。');
    process.exitCode = 1;
    if (process.connected)
        process.disconnect();
}
