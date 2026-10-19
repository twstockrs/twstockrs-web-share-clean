import { spawn, type ChildProcess } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { createServer, type Server, type Socket } from 'node:net';
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, unlinkSync, appendFileSync, statSync, renameSync } from 'node:fs';
import path from 'node:path';
import { acquireDataLock, unlockStoppedData, dataPaths } from './dataLock';
import { atomicJson, current, hostLockDirectory, safePath, readJson, verifyInstalled, stageRelease, dataCompatible, capacityCheck, validateState, type HostConfig, type HostState, type ReleaseManifest } from './hostProtocol';
import {AutoBackupEngine,backupSummary} from './autoBackup';
import {ServiceMonitor,MonitorSampler,monitorSummary,readMonitorPolicy,freeMonitorBytes} from './serviceMonitor';
import {assertHostPaths,assertSQLiteDirectory} from './sqlitePaths';
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const cleanEnvironment = () => Object.fromEntries(Object.entries(process.env).filter(([key]) => ['SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'PATH', 'HOME', 'USERPROFILE', 'LANG', 'TZ'].includes(key.toUpperCase()))) as NodeJS.ProcessEnv;
export function runDataTool(root: string, release: string, args: string[], timeout = 300000, signal?: AbortSignal) { return new Promise<any>((resolve, reject) => { const file = safePath(root, 'releases', release, 'runtime/data.mjs'), child = spawn(process.execPath, [file, ...args], { env: cleanEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] }); let text = '', error = '', timed = false; const abort = () => { timed = true; child.kill('SIGKILL'); }; if (signal?.aborted)
    abort();
else
    signal?.addEventListener('abort', abort, { once: true }); const timer = setTimeout(() => { timed = true; child.kill('SIGKILL'); }, timeout); child.stdout!.on('data', c => { if (text.length < 1024 * 1024)
    text += c; }); child.stderr!.on('data', c => { if (error.length < 4096)
    error += c; }); child.on('error', e => { clearTimeout(timer); reject(e); }); child.once('close', code => { clearTimeout(timer); signal?.removeEventListener('abort', abort); try {
    for (const option of ['--source', '--target']) {
        const index = args.indexOf(option);
        if (index >= 0) {
            const lock = dataPaths(args[index + 1]).lock;
            if (existsSync(lock) && readJson(lock).pid === child.pid)
                unlockStoppedData(args[index + 1]);
        }
    }
}
catch {
    reject(Error('資料工具停止後仍有不明資料鎖，原檔保留。'));
    return;
} if (timed || code !== 0) {
    reject(Error(timed ? '資料準備逾時，所有副本保留。' : '資料準備未通過，原資料保留。'));
    return;
} try {
    resolve(JSON.parse(text));
}
catch {
    reject(Error('資料工具回應不適用。'));
} }); }); }
type Running = {
    process: ChildProcess;
    state: HostState;
    instance: string;
    probe: string;
    expected: boolean;
    exited: Promise<void>;
    backupProtocol: boolean;
    telemetry?:{at:number;healthy:boolean;errors:number;queued:number;max:number};
};
export class HostSupervisor {
    private finish!: () => void;
    readonly finished = new Promise<void>(resolve => { this.finish = resolve; });
    private child: Running | null = null;
    private control: Server | null = null;
    private token = randomBytes(32).toString('hex');
    private busy = false;
    private stopping = false;
    private phase = 'starting';
    private timer: ReturnType<typeof setInterval> | null = null;
    private checking = false;
    private failures = 0;
    private restarts: number[] = [];
    private unlock: (() => void) | null = null;
    private toolAbort = new AbortController();
    private tools = new Set<Promise<any>>();
    private sockets = new Set<Socket>();
    private backupTimer: ReturnType<typeof setInterval>|null=null;
    private autoBackups:AutoBackupEngine;
    private monitor:ServiceMonitor;
    private monitorTimer:ReturnType<typeof setInterval>|null=null;
    private monitorFault=false;
    private monitorSampler=new MonitorSampler();
    constructor(readonly root: string, readonly config: HostConfig) {
        this.monitor=new ServiceMonitor(root,config.host_id);
        this.autoBackups=new AutoBackupEngine(root,config.host_id,{capture:id=>this.captureBackup(id),archive:(id,file)=>this.tool(current(root).active.release,['archive','--source',safePath(root,'auto-backup-work',id,'snapshot'),'--backup',file]),verify:file=>this.tool(current(root).active.release,['verify-backup','--backup',file]),log:(event,code)=>this.log(event,code),signal:this.toolAbort.signal});
    }
    private captureBackup(id:string){const run=this.child;if(!run||!run.backupProtocol||!run.process.connected)throw Error('目前服務不支援線上備份，請一併更新程式與管理器。');
        return new Promise<void>((resolve,reject)=>{const child=run.process;let finished=false;
            const finish=(ok:boolean)=>{if(finished)return;finished=true;clearTimeout(timer);child.off('message',message);child.off('exit',exit);ok?resolve():reject(Error('備份快照未完成。'));};
            const message=(value:any)=>{if(value?.type==='backup-snapshot'&&value.instance===run.instance&&value.job_id===id)finish(value.ok===true);};
            const exit=()=>finish(false),timer=setTimeout(()=>finish(false),60000);child.on('message',message);child.once('exit',exit);
            try{child.send({type:'backup-snapshot',instance:run.instance,job_id:id},error=>{if(error)finish(false);});}catch{finish(false);}
        });
    }
    private async automaticBackup(force=false){if(this.busy||this.stopping||this.phase!=='running'){if(force)throw Error('主機正在維護或未就緒，備份尚未開始。');return;}
        this.busy=true;try{return await this.autoBackups.run(force);}finally{this.busy=false;}
    }
    private log(event: string, code = '') {
        if(['child_exit','restart_limit','restart_failed','revert_failed','committed_start_failed'].includes(event))this.observeService(true);
        if(event==='service_active')this.observeService(false);
        const line = JSON.stringify({ at: new Date().toISOString(), event, code }) + '\n';
        process.stdout.write(line);
        try {
            const file = safePath(this.root, 'host-events.jsonl');
            if (existsSync(file) && statSync(file).size >= 2 * 1024 * 1024) {
                const last = safePath(this.root, 'host-events.jsonl.3');
                if (existsSync(last))
                    unlinkSync(last);
                for (let i = 2; i >= 1; i--) {
                    const old = safePath(this.root, 'host-events.jsonl.' + i);
                    if (existsSync(old))
                        renameSync(old, safePath(this.root, 'host-events.jsonl.' + (i + 1)));
                }
                renameSync(file, safePath(this.root, 'host-events.jsonl.1'));
            }
            appendFileSync(file, line, { mode: 0o600 });
        }
        catch {
            process.stderr.write('主機事件記錄無法寫入，請檢查目錄權限或磁碟空間。\n');
        }
    }
    private observeService(bad:boolean){try{this.monitor.observe({SERVICE_UNAVAILABLE:bad},true);}catch{this.monitorFault=true;}}
    private monitorCheck(){
        if(this.stopping)return;
        try{
            const p=readMonitorPolicy(this.root),now=Date.now(),b=backupSummary(this.root,this.config.host_id,now);
            this.monitor.observe(this.monitorSampler.sample(now,p,b,freeMonitorBytes(this.root),{phase:this.phase,busy:this.busy,instance:this.child?.instance,telemetry:this.child?.telemetry}));
            this.monitorFault=false;
        }catch{this.monitorFault=true;process.stderr.write('監控狀態無法更新，原記錄保留；請以monitor status檢查。\n');}
        void this.monitor.drain().catch(()=>{this.monitorFault=true;});
    }
    private tool(release: string, args: string[]) { const promise = runDataTool(this.root, release, args, 300000, this.toolAbort.signal); this.tools.add(promise); void promise.finally(() => this.tools.delete(promise)).catch(() => { }); return promise; }
    private paths(state: HostState) { return { release: safePath(this.root, 'releases', state.active.release), data: safePath(this.root, 'data', state.active.data) }; }
    private controlState() { if (!this.control)
        return; const address = this.control.address(); if (!address || typeof address === 'string')
        return; atomicJson(safePath(this.root, 'control.json'), { format: 'TWStockRS-host-control', version: 1, host_id: this.config.host_id, pid: process.pid, port: address.port, token: this.token, child_pid: this.child?.process.pid ?? null, child_instance: this.child?.instance ?? null }); }
    status() { const state = current(this.root); return { host_id: this.config.host_id, phase: this.phase, busy: this.busy, revision: state.revision, active: state.active, previous: state.previous, child_pid: this.child?.process.pid ?? null, origin: this.config.origin, listen: '127.0.0.1', port: this.config.port, restarts_in_window: this.restarts.filter(t => Date.now() - t < this.config.restart_window_ms).length,automatic:backupSummary(this.root,this.config.host_id),monitoring:monitorSummary(this.root,this.config.host_id),monitor_fault:this.monitorFault }; }
    private probe(run: Running) {
        return new Promise<boolean>(resolve => {
            const request = httpRequest({ hostname: '127.0.0.1', port: this.config.port, path: '/api/v1/health', headers: { Host: new URL(this.config.origin).host, 'X-TWRS-Probe': run.probe }, agent: false }, response => {
                let body = '';
                response.on('data', chunk => { body += chunk; if (body.length > 16384)
                    request.destroy(); });
                response.on('error', () => resolve(false));
                response.on('end', () => { try {
                    const value = JSON.parse(body);
                    run.backupProtocol=value.deployment?.backup_protocol===1;
                    const q=value.background,t=value.monitor;
                    if(t?.version===1&&typeof t.storage_ok==='boolean'&&typeof t.records_available==='boolean'&&q&&['failed','timed_out','rejected','queued'].every(k=>Number.isSafeInteger(q[k])&&q[k]>=0)&&Number.isSafeInteger(q.limits?.max_queued)&&q.limits.max_queued>0&&q.queued<=q.limits.max_queued)run.telemetry={at:Date.now(),healthy:t.storage_ok&&t.records_available,errors:q.failed+q.timed_out+q.rejected,queued:q.queued,max:q.limits.max_queued};
                    resolve(response.statusCode === 200 && value.authentication === true && value.deployment?.release_id === run.state.active.release && value.deployment?.instance_id === run.instance);
                }
                catch {
                    resolve(false);
                } });
            });
            const timer = setTimeout(() => request.destroy(Error('health timeout')), this.config.health_timeout_ms);
            request.on('close', () => clearTimeout(timer));
            request.on('error', () => resolve(false));
            request.end();
        });
    }
    private async launch(state: HostState) {
        if (this.stopping)
            throw Error('主機正在停止。');
        const p = this.paths(state), manifest = verifyInstalled(p.release);
        dataCompatible(p.data, manifest);
        await this.tool(state.active.release, ['inspect', '--source', p.data]);
        if (this.stopping)
            throw Error('主機正在停止。');
        const child = spawn(process.execPath, [safePath(p.release, 'runtime/serve.mjs')], { cwd: p.release, env: cleanEnvironment(), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
        child.stdout!.resume();
        child.stderr!.resume();
        const run: Running = { process: child, state, instance: randomUUID(), probe: randomBytes(32).toString('hex'), expected: false, exited: new Promise(r => child.once('close', () => r())),backupProtocol:false };
        this.child = run;
        this.controlState();
        child.once('error', () => { });
        child.once('exit', () => { if (!run.expected && !this.stopping) {
            this.log('child_exit');
            if(!this.busy)void this.restartUnexpected(run);
        } });
        child.send({ type: 'boot', root: this.root, config: this.config, state, instance: run.instance, probe: run.probe });
        const until = Date.now() + this.config.start_timeout_ms;
        let stable = 0;
        while (Date.now() < until) {
            if (child.exitCode !== null || child.signalCode !== null)
                break;
            if (await this.probe(run)) {
                if (++stable === 2)
                    return run;
            }
            else
                stable = 0;
            await sleep(Math.min(250, this.config.health_interval_ms));
        }
        await this.stopChild(run);
        throw Error('新版服務未通過啟動檢查。');
    }
    private async activate(run: Running) { if (this.stopping) {
        await this.stopChild(run);
        throw Error('主機正在停止。');
    } await new Promise<void>((resolve, reject) => { const timer = setTimeout(() => { run.process.off('message', listener); reject(Error('服務啟用確認逾時。')); }, this.config.start_timeout_ms), listener = (message: any) => { if (message?.type === 'active' && message.instance === run.instance) {
        clearTimeout(timer);
        run.process.off('message', listener);
        resolve();
    } }; run.process.on('message', listener); run.process.send({ type: 'activate', instance: run.instance }, error => { if (error) {
        clearTimeout(timer);
        run.process.off('message', listener);
        reject(error);
    } }); }); this.phase = 'running'; this.failures = 0; this.log('service_active'); this.controlState(); }
    private async stopChild(run = this.child) {
        if (!run)
            return;
        run.expected = true;
        if (!run.process.pid) {
            await run.exited;
            if (this.child === run)
                this.child = null;
            return;
        }
        if (run.process.exitCode === null && run.process.signalCode === null) {
            if (run.process.connected)
                run.process.send({ type: 'stop' }, () => { });
            await Promise.race([run.exited, sleep(this.config.stop_timeout_ms)]);
            if (run.process.exitCode === null && run.process.signalCode === null) {
                run.process.kill('SIGKILL');
                await run.exited;
            }
        }
        if (this.child === run)
            this.child = null;
        const data = this.paths(run.state).data, lock = dataPaths(data).lock;
        if (existsSync(lock)) {
            const record = readJson(lock);
            if (record.pid !== run.process.pid)
                throw Error('資料鎖不屬於已停止的服務，原鎖保留。');
            unlockStoppedData(data);
        }
        this.controlState();
    }
    private async restartUnexpected(run: Running) { if (this.busy || this.stopping || this.child !== run)
        return; this.busy = true; this.phase = 'restarting'; try {
        await this.stopChild(run);
        while (!this.stopping) {
            this.restarts = this.restarts.filter(t => Date.now() - t < this.config.restart_window_ms);
            if (this.restarts.length >= this.config.restart_limit) {
                this.phase = 'failed';
                this.log('restart_limit');
                return;
            }
            this.restarts.push(Date.now());
            await sleep(this.config.restart_delay_ms);
            if (this.stopping)
                return;
            try {
                await this.activate(await this.launch(current(this.root)));
                return;
            }
            catch {
                await this.stopChild();
                this.log('restart_attempt_failed');
            }
        }
    }
    catch {
        this.phase = 'failed';
        this.log('restart_failed');
    }
    finally {
        this.busy = false;
    } }
    private async healthCheck() { if (this.checking || this.busy || this.stopping || !this.child || this.phase !== 'running')
        return; this.checking = true; try {
        const run = this.child;
        if (await this.probe(run))
            this.failures = 0;
        else if (++this.failures >= 3){this.observeService(true);await this.restartUnexpected(run);}
    }
    finally {
        this.checking = false;
    } }
    async start() {
        this.unlock = acquireDataLock(hostLockDirectory(this.root));
        try {
            if (existsSync(safePath(this.root, 'control.json')))
                throw Error('發現先前主機控制狀態，請先執行recover確認舊程序停止。');
            this.recoverTransition();
            this.busy = true;
            await this.activate(await this.launch(current(this.root)));
            this.busy = false;
            this.control = createServer(socket => this.accept(socket));
            await new Promise<void>((resolve, reject) => { this.control!.once('error', reject); this.control!.listen(0, '127.0.0.1', resolve); });
            this.controlState();
            this.timer = setInterval(() => void this.healthCheck(), this.config.health_interval_ms);
            this.monitorCheck();this.monitorTimer=setInterval(()=>this.monitorCheck(),10000);
            this.log('supervisor_ready');
            process.send?.({ type: 'ready', status: this.status() });
            this.backupTimer=setInterval(()=>void this.automaticBackup().catch(()=>this.log('auto_backup_failed','BACKUP_SCHEDULER_FAILED')),60000);
            void this.automaticBackup().catch(()=>this.log('auto_backup_failed','BACKUP_SCHEDULER_FAILED'));
        }
        catch (error) {
            this.observeService(true);await this.monitor.drain().catch(()=>{});
            this.busy = false;
            await this.close();
            throw error;
        }
    }
    private recoverTransition() { const file = safePath(this.root, 'transition.json'); if (!existsSync(file))
        return; const journal = readJson(file); if (journal.format !== 'TWStockRS-host-transition' || journal.version !== 1)
        throw Error('更新日誌不合法，原資料保留。'); const from = validateState(journal.from), to = validateState(journal.to), state = current(this.root); if (state.revision !== from.revision && state.revision !== to.revision || state.revision === from.revision && JSON.stringify(state) !== JSON.stringify(from) || state.revision === to.revision && JSON.stringify(state) !== JSON.stringify(to))
        throw Error('更新日誌與已提交版本不符，原資料保留。'); unlinkSync(file); this.log('transition_recovered', state.revision === to.revision ? 'committed' : 'not_committed'); }
    private accept(socket: Socket) { this.sockets.add(socket); socket.once('close', () => this.sockets.delete(socket)); let text = ''; socket.setTimeout(5000, () => socket.destroy()); socket.on('data', chunk => { text += chunk; if (text.length > 16384) {
        socket.destroy();
        return;
    } if (!text.includes('\n'))
        return; socket.removeAllListeners('data'); socket.setTimeout(0); void (async () => { try {
        const input = JSON.parse(text.trim());
        if (input.host_id !== this.config.host_id || typeof input.token !== 'string' || !/^[a-f0-9]{64}$/.test(input.token) || !timingSafeEqual(Buffer.from(input.token), Buffer.from(this.token)))
            throw Error('主機控制驗證失敗。');
        const result = await this.command(input);
        socket.end(JSON.stringify({ ok: true, ...result }) + '\n');
    }
    catch (error) {
        socket.end(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : '主機操作失敗。' }) + '\n');
    } })(); }); socket.on('error', () => { }); }
    async command(input: any) {
        if (!['status', 'stop', 'update', 'rollback', 'restart','auto-backup-run','monitor-test','monitor-retry'].includes(input.operation) || Object.keys(input).some(k => !['operation', 'host_id', 'token', 'revision', 'archive'].includes(k)))
            throw Error('主機操作格式不適用。');
        if (input.operation === 'update' && (typeof input.archive !== 'string' || !input.archive || input.archive.length > 4096) || input.operation !== 'update' && input.archive !== undefined)
            throw Error('更新必須提供合法發布包，其他操作不接受發布包。');
        if (input.operation === 'status')
            return this.status();
        if (this.busy && !(input.operation==='stop'&&this.autoBackups.running) || this.stopping)
            throw Error('主機正在處理另一項操作，請稍後重試。');
        if (input.revision !== current(this.root).revision)
            throw Error('主機版本已變更，請重新讀取狀態。');
        if (input.operation === 'stop') {
            setTimeout(() => void this.close(), 50);
            return { stopping: true };
        }
        if(input.operation==='auto-backup-run'){const result=await this.automaticBackup(true);if(result?.status!=='success')throw Error('自動備份未完成：'+(result?.code||result?.status||'BACKUP_FAILED'));return result;}
        if(input.operation==='monitor-test'){const result=this.monitor.test();await this.monitor.drain();return result;}
        if(input.operation==='monitor-retry'){const result=this.monitor.retryDead();await this.monitor.drain();return result;}
        this.busy = true;
        try {
            if (input.operation === 'restart') {
                assertSQLiteDirectory(this.paths(current(this.root)).data);
                this.phase = 'restarting';
                try{
                await this.stopChild();
                await this.activate(await this.launch(current(this.root)));
                }catch(error){this.phase='failed';this.log('restart_failed');throw error;}
                return { ...this.status(), busy: false };
            }
            return { ...await this.change(input.operation === 'update' ? input.archive : undefined), busy: false };
        }
        finally {
            this.busy = false;
        }
    }
    private async change(archive?: string) {
        assertHostPaths(this.root);
        const from = current(this.root), target = archive ? stageRelease(this.root, path.resolve(archive)) : from.previous ? verifyInstalled(safePath(this.root, 'releases', from.previous.release)) : null;
        if (!target)
            throw Error('沒有可回復的上一版程式。');
        if (target.release_id === from.active.release)
            return this.status();
        const source = this.paths(from).data;
        dataCompatible(source, target);
        capacityCheck(this.root, source);
        const next: HostState = { format: 'TWStockRS-host-state', version: 1, revision: from.revision + 1, active: { release: target.release_id, data: 'generation-' + randomUUID() }, previous: from.active, updated_at: new Date().toISOString() }, journal = safePath(this.root, 'transition.json');
        atomicJson(journal, { format: 'TWStockRS-host-transition', version: 1, from, to: next });
        this.phase = 'updating';
        let committed = false;
        try {
            await this.stopChild();
            const backup = safePath(this.root, 'backups', 'before-' + randomUUID() + '.twrsbackup');
            mkdirSync(path.dirname(backup), { recursive: true });
            await this.tool(from.active.release, ['clone', '--source', source, '--target', this.paths(next).data, '--backup', backup]);
            const candidate = await this.launch(next);
            atomicJson(safePath(this.root, 'state.json'), next);
            committed = true;
            await this.activate(candidate);
            unlinkSync(journal);
            this.log('update_committed');
            return this.status();
        }
        catch (error) {
            await this.stopChild();
            if (!committed && !this.stopping) {
                try {
                    await this.activate(await this.launch(from));
                    unlinkSync(journal);
                    this.log('update_reverted');
                }
                catch {
                    this.phase = 'failed';
                    this.log('revert_failed');
                }
            }
            else if (!this.stopping) {
                this.phase = 'failed';
                this.log('committed_start_failed');
            }
            throw error;
        }
    }
    async close() { if (this.stopping)
        return; this.stopping = true; this.phase = 'stopping'; this.toolAbort.abort(); if (this.timer)
        clearInterval(this.timer); if(this.monitorTimer)clearInterval(this.monitorTimer);await this.monitor.close().catch(()=>{}); if(this.backupTimer)clearInterval(this.backupTimer); await this.stopChild(); await Promise.allSettled([...this.tools]); await this.autoBackups.settled(); for (const socket of this.sockets)
        socket.destroy(); if (this.control) {
        await new Promise<void>(r => this.control!.close(() => r()));
        this.control = null;
    } const file = safePath(this.root, 'control.json'); if (existsSync(file)) {
        const record = readJson(file);
        if (record.pid === process.pid && record.token === this.token)
            unlinkSync(file);
    } this.unlock?.(); this.unlock = null; this.phase = 'stopped'; this.log('supervisor_stopped'); this.finish(); }
}
export async function hostRequest(root: string, operation: string, archive?: string) { const control = readJson(safePath(root, 'control.json')); if (control.format !== 'TWStockRS-host-control' || control.version !== 1 || !Number.isInteger(control.port) || control.port < 1024 || control.port > 65535 || !Number.isSafeInteger(control.pid) || control.pid < 1 || typeof control.token !== 'string' || !/^[a-f0-9]{64}$/.test(control.token))
    throw Error('主機控制狀態不適用。'); const revision = current(root).revision; return new Promise<any>((resolve, reject) => { const socket = import('node:net').then(({ connect }) => { const client = connect(control.port, '127.0.0.1'), timer = setTimeout(() => { client.destroy(); reject(Error('主機控制回應逾時。')); }, operation === 'status' ? 5000 : 900000); let text = ''; client.once('connect', () => client.write(JSON.stringify({ operation, host_id: control.host_id, token: control.token, revision, ...(archive ? { archive: path.resolve(archive) } : {}) }) + '\n')); client.on('data', c => { text += c; if (text.length > 262144) {
    client.destroy();
    reject(Error('控制回應過大。'));
} if (text.includes('\n')) {
    clearTimeout(timer);
    client.end();
    try {
        const result = JSON.parse(text);
        if (!result.ok)
            throw Error(result.error);
        resolve(result);
    }
    catch (error) {
        reject(error);
    }
} }); client.once('error', e => { clearTimeout(timer); reject(e); }); client.once('end', () => { clearTimeout(timer); if (!text.includes('\n'))
    reject(Error('主機控制連線中斷。')); }); }); void socket.catch(reject); }); }
