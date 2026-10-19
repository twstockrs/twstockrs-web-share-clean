import { createMockServer } from './app';
import { validateConfig, validateState, verifyInstalled, safePath, hostMaintenanceSummary } from './hostProtocol';
import { DatabaseSync } from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {backupSummary} from './autoBackup';
import {monitorSummary} from './serviceMonitor';
import {assertSQLiteDirectory} from './sqlitePaths';
let stop: () => void = () => process.exit(1), received = false;
process.on('message', message => {
    const m = message as any;
    if (m?.type === 'boot' && !received) {
        received = true;
        try {
            const config = validateConfig(m.config), state = validateState(m.state), release = safePath(m.root, 'releases', state.active.release), data = safePath(m.root, 'data', state.active.data), manifest = verifyInstalled(release);
            if (typeof m.instance !== 'string' || !/^[a-f0-9-]{36}$/.test(m.instance) || typeof m.probe !== 'string' || !/^[a-f0-9]{64}$/.test(m.probe) || manifest.release_id !== state.active.release)
                throw Error('啟動識別不適用。');
            let ready = false, stopping = false;
            const server = createMockServer({ dataDirectory: data, staticDirectory: safePath(release, 'web'), origin: config.origin, secureCookies: config.mode === 'production', deployment: { release_id: manifest.release_id, instance_id: m.instance,backup_protocol:1 }, availability: { ready: () => ready, probe: m.probe },hostSummary:()=>({...hostMaintenanceSummary(m.root,config.mode),automatic:backupSummary(m.root,config.host_id),monitoring:monitorSummary(m.root,config.host_id)}) });
            stop = () => { if (stopping)
                return; stopping = true; ready = false; server.close(() => process.exit()); };
            server.on('error', () => { process.exitCode = 1; server.close(() => process.exit(1)); });
            if (config.mode === 'production') {
                const db = new DatabaseSync(safePath(data, 'library.sqlite'), { readOnly: true });
                let admins = 0;
                try {
                    admins = Number(db.prepare("SELECT COUNT(*) AS n FROM accounts WHERE role='admin' AND enabled=1").get()!.n);
                }
                finally {
                    db.close();
                }
                if (!admins) {
                    server.close(() => process.exit(1));
                    return;
                }
            }
            server.listen(config.port, '127.0.0.1', () => process.send?.({ type: 'bound', instance: m.instance }));
            process.on('message', async message => { const value = message as any; if (value?.type === 'activate' && value.instance === m.instance) {
                ready = true;
                process.send?.({ type: 'active', instance: m.instance });
            }
            if(value?.type==='backup-snapshot'&&value.instance===m.instance&&typeof value.job_id==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value.job_id)){
                let ok=false;
                try{if(!ready||stopping)throw Error('Service not ready');const job=safePath(m.root,'auto-backup-work',value.job_id);assertSQLiteDirectory(safePath(job,'snapshot'),'自動備份快照資料庫');mkdirSync(job,{recursive:true,mode:0o700});await server.writeBackupSnapshot(safePath(job,'snapshot'));ok=true;}catch{}
                if(process.connected)process.send?.({type:'backup-snapshot',job_id:value.job_id,instance:m.instance,ok},()=>{});
            }
            if (value?.type === 'stop')
                stop(); });
        }
        catch {
            console.error('主機服務設定、程式或資料檢查失敗；未啟用。');
            process.exit(1);
        }
    }
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => stop());
process.on('disconnect', () => stop());
const bootTimer = setTimeout(() => { if (!received)
    process.exit(1); }, 10000);
bootTimer.unref();
