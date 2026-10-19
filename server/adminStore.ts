import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { statSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import { AnalysisError } from '../shared/mockAnalysis';
import { exactFields } from '../shared/libraryContract';
import { accountChange, type AccountChange, type AdminAccount, type AdminEvent, type AdminOverview, type HostSummary } from '../shared/adminContract';
import type { AuthSession } from '../shared/authContract';
import { AuthStore, validUsername } from './authStore';
import type { WorkQueue } from './workQueue';
const fail = (code: string, message: string, status = 409): never => { throw new AnalysisError(code, message, status); };
const knownAuth = new Set(['login', 'login_failed', 'logout', 'logout_all', 'account_created', 'account_updated', 'legacy_claimed']);
const knownActions = new Set(['account/create', 'account/access', 'account/revoke', 'imports/stage', 'versions/create', 'versions/activate', 'versions/rollback', 'system/backup', 'analysis', 'admin']);
export class AdminStore {
    private key = randomBytes(32);
    private started = performance.now();
    private creating = false;
    private recordsAvailable = true;
    operationalRecordsAvailable(){return this.recordsAvailable;}
    constructor(private library: DatabaseSync, private imports: DatabaseSync, private auth: AuthStore, private queue: WorkQueue, private now: () => number = Date.now, private host?: () => HostSummary) { }
    record(actor: string | null, action: string, status: 'ok' | 'error', target: string | null = null, code: string | null = null, requestId: string | null = null) {
        if (!knownActions.has(action) || target !== null && !validUsername(target) || code !== null && !/^[A-Z0-9_]{1,80}$/.test(code) || requestId !== null && !/^[a-f0-9-]{36}$/.test(requestId))
            throw Error('維護記錄格式不適用。');
        this.library.prepare('INSERT INTO auth_events (at,account_id,event) VALUES (?,?,?)').run(this.now(), actor, 'admin:' + JSON.stringify({ action, target, status, code, request_id: requestId }));
        this.library.exec('DELETE FROM auth_events WHERE event_id < COALESCE((SELECT event_id FROM auth_events ORDER BY event_id DESC LIMIT 1 OFFSET 999),0)');
    }
    noteHttp(actor: string | null, action: string, status: number, code: string | null, id: string) { try {
        this.record(actor, action, status < 400 ? 'ok' : 'error', null, code, id);
        this.recordsAvailable = true;
    }
    catch {
        this.recordsAvailable = false;
    } }
    private account(username: string): AdminAccount {
        const a = this.library.prepare('SELECT * FROM accounts WHERE username=?').get(username);
        if (!a)
            fail('ACCOUNT_NOT_FOUND', '找不到帳號。', 404);
        const now = this.now();
        return { id: String(a!.account_id), username: String(a!.username), role: a!.role as 'admin' | 'user', enabled: !!a!.enabled, grant_plan: a!.grant_plan as 'Free' | 'Pro', effective_plan: a!.grant_plan === 'Pro' && Number(a!.pro_until) > now ? 'Pro' : 'Free', pro_until: a!.pro_until === null ? null : Number(a!.pro_until), revision: Number(a!.revision), created_at: Number(a!.created_at), active_sessions: Number(this.library.prepare('SELECT count(*) AS n FROM auth_sessions WHERE account_id=? AND expires_at>? AND idle_until>?').get(a!.account_id, now, now)!.n) };
    }
    overview(): AdminOverview {
        const now = this.now(), one = (db: DatabaseSync, table: string) => Number(db.prepare('SELECT count(*) AS n FROM ' + table).get()!.n), accounts = this.library.prepare("SELECT count(*) AS total,sum(enabled) AS enabled,sum(enabled=1 AND role='admin') AS admins,sum(enabled=1 AND grant_plan='Pro' AND pro_until>?) AS pro FROM accounts").get(now)!;
        const size = (db: DatabaseSync) => { const filename = db.prepare('PRAGMA database_list').all().find(r => r.name === 'main')?.file; if (!filename)
            return null; let n = 0; for (const suffix of ['', '-wal']) {
            try {
                n += statSync(String(filename) + suffix).size;
            }
            catch { }
        } return n; };
        const markets = this.imports.prepare('SELECT m.*,d.manifest FROM market_releases m LEFT JOIN data_releases d ON d.release_id=m.active_release ORDER BY m.market').all().map(row => { let manifest: any = null; try {
            manifest = row.manifest ? JSON.parse(String(row.manifest)) : null;
        }
        catch { } return { market: row.market as 'TWSE' | 'TPEx', revision: Number(row.revision), active_id: row.active_release as string | null, previous_id: row.previous_release as string | null, dataset_kind: manifest?.dataset_kind || null, latest_date: manifest?.latest_date || null, prices: manifest?.price_count || 0 }; });
        return { version: 1, at: now, uptime_seconds: Math.floor((performance.now() - this.started) / 1000), node: process.versions.node, memory_bytes: process.memoryUsage().rss, accounts: { total: Number(accounts.total), enabled: Number(accounts.enabled || 0), admins: Number(accounts.admins || 0), pro: Number(accounts.pro || 0) }, storage: { library_bytes: size(this.library), imports_bytes: size(this.imports) }, markets, batches: one(this.imports, 'import_batches'), releases: one(this.imports, 'data_releases'), shares: one(this.library, 'frozen_shares'), queue: this.queue.metrics(), host: this.host?.() || null, records_available: this.recordsAvailable };
    }
    accounts(input: unknown) { exactFields(input, [], ['query', 'offset']); const query = input.query ?? '', offset = input.offset ?? 0; if (typeof query !== 'string' || query.length > 64 || !Number.isSafeInteger(offset) || Number(offset) < 0 || Number(offset) > 512)
        fail('INVALID_ADMIN_INPUT', '帳號搜尋或分頁不正確。', 422); const names = this.library.prepare('SELECT username FROM accounts ORDER BY username').all().map(r => String(r.username)).filter(n => n.includes(String(query).toLowerCase())); return { accounts: names.slice(Number(offset), Number(offset) + 40).map(n => this.account(n)), total: names.length, offset: Number(offset) }; }
    events(input: unknown) { exactFields(input, [], ['before', 'errors_only']); const before = input.before ?? Number.MAX_SAFE_INTEGER; if (!Number.isSafeInteger(before) || Number(before) < 1 || input.errors_only !== undefined && typeof input.errors_only !== 'boolean')
        fail('INVALID_ADMIN_INPUT', '記錄篩選不正確。', 422); const rows = this.library.prepare('SELECT e.*,a.username FROM auth_events e LEFT JOIN accounts a ON a.account_id=e.account_id WHERE e.event_id<? ORDER BY e.event_id DESC LIMIT 1001').all(before as number); const events: AdminEvent[] = []; for (const row of rows) {
        let event: Omit<AdminEvent, 'id' | 'at' | 'actor'>;
        try {
            const text = String(row.event);
            if (text.startsWith('admin:')) {
                const v = JSON.parse(text.slice(6));
                if (!knownActions.has(v.action) || !['ok', 'error'].includes(v.status) || v.target !== null && !validUsername(v.target) || v.code !== null && !/^[A-Z0-9_]{1,80}$/.test(v.code) || v.request_id !== null && !/^[a-f0-9-]{36}$/.test(v.request_id))
                    continue;
                event = { action: v.action, target: v.target, status: v.status, code: v.code, request_id: v.request_id };
            }
            else {
                event = { action: knownAuth.has(text) ? text : 'unknown', target: null, status: text === 'login_failed' ? 'error' : 'ok', code: text === 'login_failed' ? 'LOGIN_FAILED' : null, request_id: null };
            }
        }
        catch {
            continue;
        }
        if (input.errors_only && event.status !== 'error')
            continue;
        events.push({ id: Number(row.event_id), at: Number(row.at), actor: row.username ? String(row.username) : null, ...event });
        if (events.length === 41)
            break;
    } return { events: events.slice(0, 40), next_before: events.length > 40 ? events[39].id : null }; }
    private prepare(actor: AuthSession, change: AccountChange) {
        const before = this.account(change.username);
        if (before.id === actor.owner)
            fail('SELF_MAINTENANCE', '請由其他管理員維護自己的權益；自己的登出請使用帳戶面板。', 422);
        if (before.revision !== change.expected_revision)
            fail('ACCOUNT_CHANGED', '帳號已被修改，請重新讀取後再預覽。');
        if (change.action === 'access' && change.enabled === false && before.role === 'admin' && Number(this.library.prepare("SELECT count(*) AS n FROM accounts WHERE enabled=1 AND role='admin'").get()!.n) <= 1)
            fail('LAST_ADMIN', '不能停用最後一個有效管理員。', 422);
        if (change.plan === 'Pro' && (!change.pro_until || change.pro_until <= this.now()))
            fail('INVALID_ACCOUNT', 'Pro 必須指定未來到期時間。', 422);
        const after = { ...before, revision: before.revision + 1, ...(change.action === 'revoke' ? { active_sessions: 0 } : { ...(change.enabled !== undefined ? { enabled: change.enabled, ...(!change.enabled ? { active_sessions: 0 } : {}) } : {}), ...(change.plan ? { grant_plan: change.plan, effective_plan: change.plan, pro_until: change.pro_until ?? null } : {}) }) };
        return { before, after };
    }
    private token(actor: AuthSession, change: AccountChange, before: AdminAccount, expires: number) { return createHmac('sha256', this.key).update(JSON.stringify({ owner: actor.owner, rights: actor.rights, change, before: { ...before, active_sessions: 0 }, expires })).digest('hex'); }
    preview(actor: AuthSession, input: unknown) { const change = accountChange(input), { before, after } = this.prepare(actor, change), expires_at = this.now() + 120000; return { before, after, change, expires_at, token: this.token(actor, change, before, expires_at) }; }
    apply(actor: AuthSession, input: unknown, requestId: string) { exactFields(input, ['change', 'token', 'expires_at']); const change = accountChange(input.change), { before } = this.prepare(actor, change), expires = input.expires_at; if (!Number.isSafeInteger(expires) || Number(expires) <= this.now() || Number(expires) > this.now() + 120000 || typeof input.token !== 'string' || !/^[a-f0-9]{64}$/.test(input.token) || !timingSafeEqual(Buffer.from(input.token), Buffer.from(this.token(actor, change, before, Number(expires)))))
        fail('STALE_CONFIRMATION', '確認內容已過期或帳號已變更，請重新預覽。'); const audit = () => this.record(actor.owner, 'account/' + change.action, 'ok', change.username, null, requestId); if (change.action === 'revoke')
        this.auth.revokeAccountSessions(change.username, audit);
    else
        this.auth.setAccount(change.username, { enabled: change.enabled, plan: change.plan, proUntil: change.pro_until }, audit); return { account: this.account(change.username) }; }
    async create(actor: AuthSession, input: unknown, fresh: () => void, requestId: string) { exactFields(input, ['username', 'password', 'plan'], ['pro_until']); if (!validUsername(input.username) || !['Free', 'Pro'].includes(String(input.plan)) || input.plan === 'Pro' && (!Number.isSafeInteger(input.pro_until) || Number(input.pro_until) <= this.now()) || input.plan === 'Free' && input.pro_until !== undefined && input.pro_until !== null)
        fail('INVALID_ACCOUNT', '新帳號或方案設定不正確。', 422); if (this.creating)
        fail('ACCOUNT_BUSY', '另一個帳號正在建立，請稍後重試。', 429); this.creating = true; try {
        await this.auth.createAccount(input.username as string, input.password as string, 'user', input.plan as 'Free' | 'Pro', input.plan === 'Pro' ? Number(input.pro_until) : null, fresh, () => this.record(actor.owner, 'account/create', 'ok', input.username as string, null, requestId));
        return { account: this.account(input.username as string) };
    }
    finally {
        this.creating = false;
    } }
}
