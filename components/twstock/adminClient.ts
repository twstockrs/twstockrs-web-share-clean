import { maintenanceRequest } from './maintenanceClient';
import { accountChange, decodeAdminAccount, decodeAdminOverview, decodeAdminEvents, type AccountPreview, type AdminAccount } from '../../shared/adminContract';
export const adminRequest = (operation: string, input: Record<string, unknown> = {}, fetcher?: typeof fetch) => maintenanceRequest('admin', operation, input, fetcher, operation === 'accounts/create' ? 15000 : 8000);
export { decodeAdminAccount, decodeAdminOverview, decodeAdminEvents };
export function decodeAccounts(v: any) { if (!v || !Array.isArray(v.accounts) || v.accounts.length > 40 || !Number.isSafeInteger(v.total) || v.total < 0 || v.total > 512 || !Number.isSafeInteger(v.offset) || v.offset < 0 || v.offset > 512 || v.accounts.length > v.total)
    throw Error('帳號清單回應不正確。'); const accounts: AdminAccount[] = v.accounts.map(decodeAdminAccount); if (new Set(accounts.map(a => a.id)).size !== accounts.length)
    throw Error('帳號清單重複。'); return { accounts, total: v.total as number, offset: v.offset as number }; }
export function decodePreview(v: any): AccountPreview { if (!v || typeof v.token !== 'string' || !/^[a-f0-9]{64}$/.test(v.token) || !Number.isSafeInteger(v.expires_at) || v.expires_at < 1)
    throw Error('維護預覽回應不正確。'); const before = decodeAdminAccount(v.before), after = decodeAdminAccount(v.after), change = accountChange(v.change); if (before.id !== after.id || before.username !== change.username || after.username !== before.username || before.role !== after.role || change.expected_revision !== before.revision || after.revision !== before.revision + 1)
    throw Error('維護預覽與目標帳號不一致。'); return { before, after, change, token: v.token, expires_at: v.expires_at }; }
