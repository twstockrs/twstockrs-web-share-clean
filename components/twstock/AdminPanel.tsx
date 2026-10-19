import { useEffect, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { adminRequest, decodeAccounts, decodePreview, decodeAdminOverview, decodeAdminEvents } from './adminClient';
import type { AdminOverview, AdminAccount, AdminEvent, AccountPreview, AccountChange } from '../../shared/adminContract';
import DataImportPanel from './DataImportPanel';
import DataVersionPanel from './DataVersionPanel';
import SystemBackupPanel from './SystemBackupPanel';
import MonitorPanel from './MonitorPanel';
const tabs = [['overview', '服務總覽'], ['monitor','監控與通知'], ['accounts', '帳號維護'], ['imports', '行情匯入'], ['versions', '資料版本'], ['backup', '完整備份'], ['events', '操作與異常']] as const;
const date = (n: number | null) => n === null ? '—' : new Date(n).toLocaleString('zh-TW', { hour12: false });
const size = (n: number | null) => n === null ? '記憶體模式' : n < 1024 * 1024 ? `${Math.round(n / 1000)} KB` : `${(n / 1000 / 1000).toFixed(1)} MB`;
const label: Record<string, string> = { 'account/create': '建立帳號', 'account/access': '修改權益或啟用狀態', 'account/revoke': '撤銷全部登入', 'imports/stage': '保存行情批次', 'versions/create': '建立資料版本', 'versions/activate': '啟用資料版本', 'versions/rollback': '回復資料版本', 'system/backup': '完整備份下載', analysis: '分析請求', admin: '維護請求', login: '登入', login_failed: '登入失敗', logout: '登出', logout_all: '全部登出', account_created: '建立帳號', account_updated: '帳號設定更新', legacy_claimed: '舊工作區歸屬', unknown: '舊操作記錄' };
export default function AdminPanel({ market, onChanged }: {
    market: string;
    onChanged: (market: string) => void;
}) {
    const auth = useAuth(), allowed = auth?.session?.account?.role === 'admin';
    const [tab, setTab] = useState<(typeof tabs)[number][0]>('overview'), [overview, setOverview] = useState<AdminOverview | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [query, setQuery] = useState(''), [offset, setOffset] = useState(0), [total, setTotal] = useState(0), [accounts, setAccounts] = useState<AdminAccount[]>([]), [selected, setSelected] = useState<AdminAccount | null>(null), [events, setEvents] = useState<AdminEvent[]>([]), [next, setNext] = useState<number | null>(null), [errorsOnly, setErrorsOnly] = useState(false);
    const epoch = useRef(0), pending = useRef(false), overviewPending = useRef(false);
    const refreshOverview = async () => { if (overviewPending.current)
        return; const token = epoch.current; overviewPending.current = true; try {
        const v = decodeAdminOverview(await adminRequest('overview'));
        if (token === epoch.current) {
            setOverview(v);
            setError('');
        }
    }
    catch (e) {
        if (token === epoch.current) {
            setOverview(null);
            setError(e instanceof Error ? e.message : '維護總覽未取得。');
        }
    }
    finally {
        overviewPending.current = false;
    } };
    const loadAccounts = async (start = 0) => { const v = decodeAccounts(await adminRequest('accounts/list', { query, offset: start })); setAccounts(v.accounts); setTotal(v.total); setOffset(v.offset); setSelected(null); };
    const loadEvents = async (before?: number) => { const v = decodeAdminEvents(await adminRequest('events', { errors_only: errorsOnly, ...(before ? { before } : {}) })); setEvents(v.events); setNext(v.next_before); };
    const run = async (action: () => Promise<void>) => { if (pending.current)
        return; pending.current = true; setBusy(true); setError(''); setNotice(''); try {
        await action();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : '維護結果未確認，請重新讀取核對。');
    }
    finally {
        pending.current = false;
        setBusy(false);
    } };
    useEffect(() => { if (!allowed)
        return; epoch.current++; void run(async () => { if (tab === 'overview'||tab==='monitor')
        await refreshOverview(); if (tab === 'accounts')
        await loadAccounts(); if (tab === 'events')
        await loadEvents(); }); return () => { epoch.current++; }; }, [allowed, tab, errorsOnly]);
    useEffect(() => { if (!allowed || (tab !== 'overview'&&tab!=='monitor'))
        return; const timer = setInterval(() => { if (document.visibilityState === 'visible')
        void refreshOverview(); }, 10000); return () => clearInterval(timer); }, [allowed, tab]);
    if (!allowed)
        return <p role="alert">此面板僅限已登入的管理員。</p>;
    return <div className="admin-panel"><p className="admin-intro">管理服務、帳號與行情資料。管理員角色與 Free／Pro 分析權益分開；所有操作由後端重新驗證。</p><div className="admin-tabs" role="tablist" aria-label="維護項目">{tabs.map(([id, title]) => <button key={id} role="tab" aria-selected={tab === id} aria-controls="admin-content" disabled={busy} onClick={() => { setError(''); setNotice(''); setTab(id); }}>{title}</button>)}</div><section id="admin-content" role="tabpanel" aria-label={tabs.find(([id]) => id === tab)![1]} aria-busy={busy}>
 {error && <p className="subset-error" role="alert">{error} 請重新讀取確認目前狀態。</p>}{notice && <p className="admin-notice" role="status">{notice}</p>}
 {tab === 'overview' && <><div className="admin-toolbar"><h3>服務總覽</h3><button disabled={busy} onClick={() => void run(refreshOverview)}>重新讀取總覽</button></div>{!overview ? <p role="status">{busy ? '正在讀取服務狀態…' : '目前沒有可確認的總覽。'}</p> : <><p className="admin-muted">讀取時間 {date(overview.at)} · 此頁顯示期間每 10 秒更新，背景工作數量為即時快照。</p><div className="admin-stats"><div><span>服務運行</span><strong>{Math.floor(overview.uptime_seconds / 60)} 分</strong><small>目前服務程序</small></div><div><span>有效帳號</span><strong>{overview.accounts.enabled} / {overview.accounts.total}</strong><small>{overview.accounts.admins} 位有效管理員 · {overview.accounts.pro} 位有效 Pro</small></div><div><span>背景運算</span><strong>{overview.queue.running} 執行 · {overview.queue.queued} 等候</strong><small>完成 {overview.queue.completed} · 取消 {overview.queue.cancelled}</small></div><div><span>運算異常</span><strong>{overview.queue.failed + overview.queue.timed_out}</strong><small>失敗 {overview.queue.failed} · 逾時 {overview.queue.timed_out} · 滿額拒絕 {overview.queue.rejected}</small></div></div><h4>市場與資料</h4><p className="admin-muted">下列為儲存摘要；資料可用性會在分析、啟用及回復時重新校驗。</p><div className="admin-market-grid">{overview.markets.map(m => <article key={m.market}><h4>{m.market}</h4><strong>{m.active_id ? m.dataset_kind === 'test' ? 'TEST 合成行情' : 'INPUT 匯入行情' : 'DEMO 內建展示'}</strong><dl><dt>最新端點</dt><dd>{m.latest_date || '未啟用價格版本'}</dd><dt>價格筆數</dt><dd>{m.prices.toLocaleString()}</dd><dt>啟用識別</dt><dd className="admin-id">{m.active_id || '—'}</dd><dt>前一版本</dt><dd className="admin-id">{m.previous_id || '—'}</dd><dt>管理修訂</dt><dd>{m.revision}</dd></dl></article>)}</div><p>已保存 {overview.batches} 個行情批次、{overview.releases} 個資料版本、{overview.shares} 份凍結分享。</p><h4>主機與容量</h4><dl className="admin-detail"><dt>主機程式</dt><dd>{overview.host ? `${overview.host.release_id} · ${overview.host.mode === 'production' ? '正式 HTTPS 模式' : '本機模式'}` : '開發／獨立 API 模式'}</dd><dt>主機前一版</dt><dd>{overview.host?.previous_release || '—'}</dd><dt>更新前備份</dt><dd>{overview.host ? `${overview.host.backups} 份 · ${size(overview.host.backup_bytes)} · 最新 ${date(overview.host.latest_backup_at)}` : '由開發目錄工具維護'}</dd>{overview.host?.automatic && <><dt>自動備份排程</dt><dd>{overview.host.automatic.available ? overview.host.automatic.enabled ? `每天 ${overview.host.automatic.time}（台灣時間）` : '未啟用' : '狀態不可讀，請檢查主機設定'}</dd><dt>自動備份保留</dt><dd>最近 {overview.host.automatic.keep_recent} 份 · 每日 {overview.host.automatic.keep_daily} 份 · 每週 {overview.host.automatic.keep_weekly} 份，重複只留一份</dd><dt>已驗證自動備份</dt><dd>{overview.host.automatic.verified} 份 · {size(overview.host.automatic.bytes)} · 最新成功 {date(overview.host.automatic.last_success_at)}</dd><dt>下次備份</dt><dd>{overview.host.automatic.enabled ? date(overview.host.automatic.next_due_at) : '—'}{overview.host.automatic.pending ? ' · 有待復原工作' : ''}</dd>{(overview.host.automatic.last_error || overview.host.automatic.retention_warning || overview.host.automatic.unmanaged > 0) && <><dt>備份異常</dt><dd role="alert">{overview.host.automatic.last_error ? `原因代碼 ${overview.host.automatic.last_error}。` : ''}{overview.host.automatic.retention_warning ? '舊檔清理未完成，檔案保留。' : ''}{overview.host.automatic.unmanaged > 0 ? `${overview.host.automatic.unmanaged} 個未登錄檔案保留待檢查。` : ''}請以主機工具檢查。</dd></>}</>}<dt>帳號與清單資料庫</dt><dd>{size(overview.storage.library_bytes)}</dd><dt>行情資料庫</dt><dd>{size(overview.storage.imports_bytes)}</dd><dt>目前程序記憶體</dt><dd>{size(overview.memory_bytes)}（包含背景執行緒，非全主機用量）</dd><dt>Node 執行環境</dt><dd>{overview.node}</dd></dl><p>主機程式更新、停機還原與開機服務設定使用主機工具處理。</p>{!overview.records_available && <p role="alert">最近維護記錄未能保存，請檢查主機磁碟與權限。</p>}</>}</>}
 {tab==='monitor'&&<MonitorPanel value={overview?.host?.monitoring} busy={busy} refresh={()=>void run(refreshOverview)}/>}
 {tab === 'accounts' && <><div className="admin-toolbar"><h3>帳號維護</h3><button disabled={busy} onClick={() => void run(() => loadAccounts(offset))}>重新讀取帳號</button></div><form className="admin-search" onSubmit={e => { e.preventDefault(); void run(() => loadAccounts()); }}><label>搜尋帳號<input value={query} maxLength={64} onChange={e => setQuery(e.target.value)} placeholder="輸入帳號名稱"/></label><button disabled={busy}>搜尋</button></form><p className="admin-muted">共 {total} 個符合帳號。停用、修改權益及撤銷登入都保留原有清單、檢視與分享。</p><div className="admin-account-list">{accounts.map(a => <button key={a.id} className={selected?.id === a.id ? 'selected' : ''} disabled={busy} onClick={() => setSelected(a)}><strong>{a.username}</strong><span>{a.role === 'admin' ? '管理員' : '一般帳號'} · {a.enabled ? '啟用' : '停用'} · {a.effective_plan}</span><small>{a.active_sessions} 個有效登入{a.grant_plan === 'Pro' && a.effective_plan === 'Free' ? ' · Pro 已到期' : ''}</small></button>)}</div><div className="backup-actions"><button disabled={busy || offset === 0} onClick={() => void run(() => loadAccounts(Math.max(0, offset - 40)))}>上一頁帳號</button><span>{total ? `${offset + 1}–${Math.min(offset + 40, total)}` : '0'} / {total}</span><button disabled={busy || offset + 40 >= total} onClick={() => void run(() => loadAccounts(offset + 40))}>下一頁帳號</button></div>{selected && <AccountEditor key={selected.id + ':' + selected.revision} account={selected} self={selected.id === auth!.session!.owner} onDone={async () => { await loadAccounts(offset); setNotice('帳號維護已確認。原有清單與分享保留。'); }}/>}<NewAccount onDone={async () => { await loadAccounts(); setNotice('一般帳號已建立，沒有寄送通知或授予管理員角色。'); }}/></>}
 {tab === 'imports' && <DataImportPanel />}{tab === 'versions' && <DataVersionPanel initialMarket={market} onChanged={onChanged}/>}{tab === 'backup' && <SystemBackupPanel />}
 {tab === 'events' && <><div className="admin-toolbar"><h3>操作與異常</h3><button disabled={busy} onClick={() => void run(() => loadEvents())}>重新讀取記錄</button></div><label className="check-row"><input type="checkbox" checked={errorsOnly} disabled={busy} onChange={e => setErrorsOnly(e.target.checked)}/>只看失敗與異常</label><p className="admin-muted">保留最近 1,000 筆帳號與維護記錄，完整備份會一併保存。只記錄操作種類與請求識別，不記錄密碼、憑證或分析本文。</p>{!events.length ? <p>此頁沒有符合的記錄。</p> : <ol className="admin-events">{events.map(e => <li key={e.id}><div><strong>{label[e.action] || '維護操作'}</strong><span className={e.status === 'error' ? 'admin-error-badge' : 'admin-ok-badge'}>{e.status === 'error' ? '未完成' : '已完成'}</span></div><p>{date(e.at)} · 帳號 {e.actor || '未識別'}{e.target ? ` → ${e.target}` : ''}</p>{e.code && <small>原因代碼：{e.code}</small>}{e.request_id && <small className="admin-id">請求識別：{e.request_id}</small>}</li>)}</ol>}<div className="backup-actions"><button disabled={busy} onClick={() => void run(() => loadEvents())}>最新記錄</button><button disabled={busy || next === null} onClick={() => void run(() => loadEvents(next!))}>較早記錄</button></div></>}
 </section></div>;
}
function AccountEditor({ account: a, self, onDone }: {
    account: AdminAccount;
    self: boolean;
    onDone: () => Promise<void>;
}) {
    const [plan, setPlan] = useState(a.grant_plan), [until, setUntil] = useState(a.pro_until ? localDate(a.pro_until) : ''), [enabled, setEnabled] = useState(a.enabled), [preview, setPreview] = useState<AccountPreview | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const pending = useRef(false);
    const task = async (fn: () => Promise<void>) => { if (pending.current)
        return; pending.current = true; setBusy(true); setError(''); try {
        await fn();
    }
    catch (e) {
        setPreview(null);
        setError(e instanceof Error ? e.message : '維護未確認，請重新讀取。');
    }
    finally {
        pending.current = false;
        setBusy(false);
    } };
    const show = (action: 'access' | 'revoke') => task(async () => { const change: AccountChange = { username: a.username, expected_revision: a.revision, action, ...(action === 'access' ? { enabled, plan, pro_until: plan === 'Pro' ? new Date(until).getTime() : null } : {}) }; const value = decodePreview(await adminRequest('accounts/preview', change)); if (value.before.id !== a.id)
        throw Error('維護目標不同，已取消。'); setPreview(value); });
    return <section className="admin-editor" aria-label={`維護帳號 ${a.username}`}><h4>維護 {a.username}</h4>{self ? <p>這是目前登入的管理員。請由其他管理員調整自己的權益；自己的登出仍使用帳戶面板。</p> : <><div className="admin-form-grid"><label>分析方案<select disabled={busy} value={plan} onChange={e => { setPlan(e.target.value as 'Free' | 'Pro'); setPreview(null); }}><option>Free</option><option>Pro</option></select></label><label>Pro 到期時間<input type="datetime-local" disabled={busy || plan !== 'Pro'} value={until} onChange={e => { setUntil(e.target.value); setPreview(null); }}/></label></div><label className="check-row"><input type="checkbox" disabled={busy} checked={enabled} onChange={e => { setEnabled(e.target.checked); setPreview(null); }}/>啟用帳號</label><p className="admin-muted">目前 {a.effective_plan} · Pro 到期 {date(a.pro_until)} · 帳號修訂 {a.revision}。密碼重設與管理員角色使用主機工具。</p><div className="backup-actions"><button disabled={busy} onClick={() => void show('access')}>預覽權益變更</button><button disabled={busy} onClick={() => void show('revoke')}>預覽撤銷全部登入</button></div>{preview && <div className="admin-confirm" role="region" aria-label="帳號變更確認"><h4>確認 {preview.before.username} 的變更</h4>{preview.change.action === 'revoke' ? <p>撤銷此帳號所有登入；使用者須重新登入，資料保留。</p> : <><p>啟用狀態：{preview.before.enabled ? '啟用' : '停用'} → {preview.after.enabled ? '啟用' : '停用'}；分析方案：{preview.before.effective_plan} → {preview.after.effective_plan}</p><p>Pro 到期：{date(preview.before.pro_until)} → {date(preview.after.pro_until)}</p><p>停用會撤銷登入；權益變更會讓舊權限失效，重新讀取後生效。</p></>}<p className="admin-muted">確認有效至 {date(preview.expires_at)}；過期或其他管理員先修改時會拒絕。</p><div className="backup-actions"><button disabled={busy} onClick={() => setPreview(null)}>取消帳號變更</button><button className="primary-button" disabled={busy} onClick={() => void task(async () => { const value = await adminRequest('accounts/apply', { change: preview.change, token: preview.token, expires_at: preview.expires_at }); if (!value.account || decodeAdminAccountLocal(value.account).id !== a.id)
        throw Error('回應未確認，請重新讀取帳號。'); setPreview(null); await onDone(); })}>確認套用帳號變更</button></div></div>}</>}{error && <p role="alert" className="subset-error">{error}</p>}</section>;
}
import { decodeAdminAccount as decodeAdminAccountLocal } from '../../shared/adminContract';
function localDate(n: number) { const d = new Date(n); return new Date(n - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
function NewAccount({ onDone }: {
    onDone: () => Promise<void>;
}) {
    const [username, setUsername] = useState(''), [password, setPassword] = useState(''), [plan, setPlan] = useState('Free'), [until, setUntil] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const pending = useRef(false);
    return <details className="admin-editor"><summary>建立一般帳號</summary><p>只建立一般角色；管理員角色由主機工具建立。密碼 15–128 字元，不會寄信通知。</p><form onSubmit={e => { e.preventDefault(); if (pending.current)
        return; pending.current = true; setBusy(true); setError(''); void (async () => { try {
        const v = await adminRequest('accounts/create', { username, password, plan, ...(plan === 'Pro' ? { pro_until: new Date(until).getTime() } : {}) });
        const a = decodeAdminAccountLocal(v.account);
        if (a.username !== username || a.role !== 'user')
            throw Error('建立結果未確認，請重新讀取帳號清單。');
        setUsername('');
        await onDone();
    }
    catch (e) {
        setError(e instanceof Error ? e.message : '建立結果未確認，請重新讀取帳號清單。');
    }
    finally {
        setPassword('');
        setBusy(false);
        pending.current = false;
    } })(); }}><div className="admin-form-grid"><label>新帳號<input autoComplete="off" required pattern="[a-z0-9][a-z0-9._-]{2,63}" maxLength={64} value={username} disabled={busy} onChange={e => setUsername(e.target.value)}/></label><label>初始密碼<input type="password" autoComplete="new-password" required minLength={15} maxLength={128} value={password} disabled={busy} onChange={e => setPassword(e.target.value)}/></label><label>新帳號方案<select value={plan} disabled={busy} onChange={e => setPlan(e.target.value)}><option>Free</option><option>Pro</option></select></label><label>新帳號 Pro 到期<input type="datetime-local" required={plan === 'Pro'} disabled={busy || plan !== 'Pro'} value={until} onChange={e => setUntil(e.target.value)}/></label></div><button className="primary-button" disabled={busy}>{busy ? '正在建立帳號…' : '建立一般帳號'}</button>{error && <p role="alert" className="subset-error">{error}</p>}</form></details>;
}
