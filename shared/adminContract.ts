import { AnalysisError } from './mockAnalysis';
import { exactFields } from './libraryContract';
import {decodeMonitor,type MonitorSummary} from './monitorContract';
export type AdminAccount = {
    id: string;
    username: string;
    role: 'admin' | 'user';
    enabled: boolean;
    grant_plan: 'Free' | 'Pro';
    effective_plan: 'Free' | 'Pro';
    pro_until: number | null;
    revision: number;
    active_sessions: number;
    created_at: number;
};
export type AccountChange = {
    username: string;
    expected_revision: number;
    action: 'access' | 'revoke';
    enabled?: boolean;
    plan?: 'Free' | 'Pro';
    pro_until?: number | null;
};
export type AdminEvent = {
    id: number;
    at: number;
    actor: string | null;
    action: string;
    target: string | null;
    status: 'ok' | 'error';
    code: string | null;
    request_id: string | null;
};
export type HostSummary = {
    monitoring?:MonitorSummary;
    mode: 'local' | 'production';
    release_id: string;
    previous_release: string | null;
    revision: number;
    backups: number;
    backup_bytes: number;
    latest_backup_at: number | null;
    automatic?: {available:boolean;enabled:boolean;time:string;timezone:'Asia/Taipei';keep_recent:number;keep_daily:number;keep_weekly:number;verified:number;bytes:number;unmanaged:number;last_success_at:number|null;next_due_at:number|null;last_error:string|null;retention_warning:boolean;pending:boolean};
};
export type AdminOverview = {
    version: 1;
    at: number;
    uptime_seconds: number;
    node: string;
    memory_bytes: number;
    accounts: {
        total: number;
        enabled: number;
        admins: number;
        pro: number;
    };
    storage: {
        library_bytes: number | null;
        imports_bytes: number | null;
    };
    markets: {
        market: 'TWSE' | 'TPEx';
        revision: number;
        active_id: string | null;
        previous_id: string | null;
        dataset_kind: 'test' | 'source' | null;
        latest_date: string | null;
        prices: number;
    }[];
    batches: number;
    releases: number;
    shares: number;
    queue: {
        running: number;
        queued: number;
        completed: number;
        cancelled: number;
        timed_out: number;
        failed: number;
        rejected: number;
        limits: {
            workers: number;
            max_queued: number;
            max_per_owner: number;
            timeout_ms: number;
            wait_ms: number;
        };
    };
    host: HostSummary | null;
    records_available: boolean;
};
export type AccountPreview = {
    before: AdminAccount;
    after: AdminAccount;
    change: AccountChange;
    token: string;
    expires_at: number;
};
export function validMaintenanceRecord(text: string) { try {
    if (!text.startsWith('admin:') || text.length > 700)
        return false;
    const v = JSON.parse(text.slice(6));
    return Object.keys(v).sort().join(',') === 'action,code,request_id,status,target' && ['account/create', 'account/access', 'account/revoke', 'imports/stage', 'versions/create', 'versions/activate', 'versions/rollback', 'system/backup', 'analysis', 'admin'].includes(v.action) && ['ok', 'error'].includes(v.status) && (v.target === null || typeof v.target === 'string' && /^[a-z0-9][a-z0-9._-]{2,63}$/.test(v.target)) && (v.code === null || typeof v.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(v.code)) && (v.request_id === null || typeof v.request_id === 'string' && /^[a-f0-9-]{36}$/.test(v.request_id));
}
catch {
    return false;
} }
const invalid = (): never => { throw new AnalysisError('INVALID_ADMIN_INPUT', '維護操作格式不正確。', 422); };
const record = (v: any) => v && typeof v === 'object' && !Array.isArray(v);
const integer = (v: any) => Number.isSafeInteger(v) && v >= 0;
const username = (v: any) => typeof v === 'string' && /^[a-z0-9][a-z0-9._-]{2,63}$/.test(v);
export function accountChange(v: unknown): AccountChange {
    exactFields(v, ['username', 'expected_revision', 'action'], ['enabled', 'plan', 'pro_until']);
    if (!username(v.username) || !Number.isSafeInteger(v.expected_revision) || Number(v.expected_revision) < 1 || !['access', 'revoke'].includes(String(v.action)))
        invalid();
    if (v.action === 'revoke') {
        if (['enabled', 'plan', 'pro_until'].some(k => Object.hasOwn(v, k)))
            invalid();
        return { username: v.username as string, expected_revision: v.expected_revision as number, action: 'revoke' };
    }
    if (!['enabled', 'plan'].some(k => Object.hasOwn(v, k)) || v.enabled !== undefined && typeof v.enabled !== 'boolean' || v.plan !== undefined && !['Free', 'Pro'].includes(String(v.plan)) || v.pro_until !== undefined && v.pro_until !== null && !integer(v.pro_until) || v.plan === 'Pro' && !integer(v.pro_until) || v.plan === 'Free' && v.pro_until !== undefined && v.pro_until !== null || v.plan === undefined && v.pro_until !== undefined)
        invalid();
    return { username: v.username as string, expected_revision: v.expected_revision as number, action: 'access', ...(v.enabled !== undefined ? { enabled: v.enabled as boolean } : {}), ...(v.plan !== undefined ? { plan: v.plan as 'Free' | 'Pro', pro_until: v.plan === 'Free' ? null : v.pro_until as number } : {}) };
}
export function decodeAdminAccount(v: any): AdminAccount {
    if (!record(v) || Object.keys(v).sort().join(',') !== 'active_sessions,created_at,effective_plan,enabled,grant_plan,id,pro_until,revision,role,username' || typeof v.id !== 'string' || !/^account-[a-f0-9-]{36}$/.test(v.id) || !username(v.username) || !['admin', 'user'].includes(v.role) || typeof v.enabled !== 'boolean' || !['Free', 'Pro'].includes(v.grant_plan) || !['Free', 'Pro'].includes(v.effective_plan) || v.effective_plan === 'Pro' && (v.grant_plan !== 'Pro' || !integer(v.pro_until)) || v.grant_plan === 'Free' && v.pro_until !== null || v.pro_until !== null && !integer(v.pro_until) || !integer(v.revision) || v.revision < 1 || !integer(v.active_sessions) || !integer(v.created_at))
        throw Error('帳號清單回應不正確。');
    return v;
}
export function decodeAdminOverview(v: any): AdminOverview {
    const counts = (o: any, keys: string[]) => record(o) && keys.every(k => integer(o[k]));
    if (!record(v) || v.version !== 1 || !integer(v.at) || !integer(v.uptime_seconds) || typeof v.node !== 'string' || !/^\d+\.\d+\.\d+$/.test(v.node) || !integer(v.memory_bytes) || !counts(v.accounts, ['total', 'enabled', 'admins', 'pro']) || v.accounts.enabled > v.accounts.total || v.accounts.admins > v.accounts.enabled || v.accounts.pro > v.accounts.enabled || !record(v.storage) || ['library_bytes', 'imports_bytes'].some(k => v.storage[k] !== null && !integer(v.storage[k])) || !integer(v.batches) || !integer(v.releases) || !integer(v.shares) || typeof v.records_available !== 'boolean' || !counts(v.queue, ['running', 'queued', 'completed', 'cancelled', 'timed_out', 'failed', 'rejected']) || !counts(v.queue.limits, ['workers', 'max_queued', 'max_per_owner', 'timeout_ms', 'wait_ms']) || v.queue.running > 1 || v.queue.queued > v.queue.limits.max_queued || !Array.isArray(v.markets) || v.markets.length !== 2 || v.markets.map((m: any) => m.market).sort().join(',') !== 'TPEx,TWSE')
        throw Error('維護總覽回應不正確。');
    for (const m of v.markets)
        if (!integer(m.revision) || m.revision < 1 || [m.active_id, m.previous_id].some(x => x !== null && (typeof x !== 'string' || !/^input-[a-f0-9-]{36}$/.test(x))) || !['test', 'source', null].includes(m.dataset_kind) || m.latest_date !== null && (typeof m.latest_date !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(m.latest_date)) || !integer(m.prices) || m.active_id === null && (m.dataset_kind !== null || m.latest_date !== null || m.prices !== 0))
            throw Error('市場維護摘要不正確。');
    if (v.host !== null && (!record(v.host) || !['local', 'production'].includes(v.host.mode) || typeof v.host.release_id !== 'string' || v.host.release_id.length > 64 || v.host.previous_release !== null && typeof v.host.previous_release !== 'string' || !integer(v.host.revision) || v.host.revision < 1 || !integer(v.host.backups) || !integer(v.host.backup_bytes) || v.host.latest_backup_at !== null && !integer(v.host.latest_backup_at)))
        throw Error('主機摘要回應不正確。');
    const a=v.host?.automatic;
    if(a!==undefined&&(!record(a)||Object.keys(a).sort().join(',')!=='available,bytes,enabled,keep_daily,keep_recent,keep_weekly,last_error,last_success_at,next_due_at,pending,retention_warning,time,timezone,unmanaged,verified'||['available','enabled','retention_warning','pending'].some(k=>typeof a[k]!=='boolean')||a.timezone!=='Asia/Taipei'||typeof a.time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(a.time)||['keep_recent','keep_daily','keep_weekly','verified','bytes','unmanaged'].some(k=>!integer(a[k]))||a.keep_recent<2||a.keep_recent>100||a.keep_daily>366||a.keep_weekly>104||[a.last_success_at,a.next_due_at].some(t=>t!==null&&!integer(t))||a.last_error!==null&&(typeof a.last_error!=='string'||!/^[A-Z][A-Z0-9_]{0,63}$/.test(a.last_error))))throw Error('自動備份摘要不正確。');
    if(v.host?.monitoring!==undefined)decodeMonitor(v.host.monitoring);
    return v;
}
export function decodeAdminEvents(v: any): {
    events: AdminEvent[];
    next_before: number | null;
} {
    if (!record(v) || !Array.isArray(v.events) || v.events.length > 40 || v.next_before !== null && (!integer(v.next_before) || v.next_before < 1))
        throw Error('維護記錄回應不正確。');
    let previous = Infinity;
    for (const e of v.events) {
        if (!record(e) || !integer(e.id) || e.id < 1 || e.id >= previous || !integer(e.at) || e.actor !== null && !username(e.actor) || e.target !== null && !username(e.target) || typeof e.action !== 'string' || !/^[a-z][a-z0-9_/-]{0,79}$/.test(e.action) || !['ok', 'error'].includes(e.status) || e.code !== null && (typeof e.code !== 'string' || !/^[A-Z0-9_]{1,80}$/.test(e.code)) || e.request_id !== null && (typeof e.request_id !== 'string' || !/^[a-f0-9-]{36}$/.test(e.request_id)))
            throw Error('維護記錄內容不正確。');
        previous = e.id;
    }
    if (v.next_before !== null && v.next_before !== v.events.at(-1)?.id)
        throw Error('維護記錄分頁不正確。');
    return v;
}
