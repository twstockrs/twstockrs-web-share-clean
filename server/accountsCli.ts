import { AuthStore, validUsername, passwordHash } from './authStore';
import { LibraryStore } from './libraryStore';
import { acquireDataLock } from './dataLock';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
const args = process.argv.slice(2), operation = args.shift(), options: Record<string, string> = {};
for (let i = 0; i < args.length; i += 2) {
    if (!['--data-dir', '--username', '--role', '--plan', '--until', '--confirm'].includes(args[i]) || !args[i + 1] || Object.hasOwn(options, args[i]))
        throw Error('帳號工具參數不正確。密碼不得放在命令列參數。');
    options[args[i]] = args[i + 1];
}
if (!['create', 'list', 'set-plan', 'disable', 'enable', 'reset-password', 'claim-legacy'].includes(operation || ''))
    throw Error('請指定 create／list／set-plan／disable／enable／reset-password／claim-legacy。');
const m = { AuthStore, LibraryStore, acquireDataLock, validUsername, passwordHash };
async function secret(): Promise<string> { if (!process.stdin.isTTY) {
    const text = readFileSync(0, 'utf8');
    if (Buffer.byteLength(text) > 2048)
        throw Error('密碼輸入過大。');
    const input = JSON.parse(text);
    if (Object.keys(input).join(',') !== 'password')
        throw Error('只接受標準輸入的 password 欄位。');
    return input.password;
} const sink = new Writable({ write(_chunk, _encoding, done) { done(); } }), reader = createInterface({ input: process.stdin, output: sink, terminal: true }); try {
    process.stderr.write('輸入密碼（不顯示）：');
    const password = await reader.question('');
    process.stderr.write('\n再次輸入密碼：');
    const confirm = await reader.question('');
    process.stderr.write('\n');
    if (password !== confirm)
        throw Error('兩次密碼不相同。');
    return password;
}
finally {
    reader.close();
} }
let store: LibraryStore | undefined, unlock: (() => void) | undefined;
try {
    const directory = path.resolve(options['--data-dir'] || process.env.TWSTOCKRS_DATA_DIR || '.local-data');
    unlock = m.acquireDataLock(directory);
    store = new m.LibraryStore(path.join(directory, 'library.sqlite'));
    const auth = new m.AuthStore(store.connection), username = options['--username'];
    if (operation !== 'list' && !m.validUsername(username))
        throw Error('請指定有效 --username。');
    let result;
    if (operation === 'create')
        result = await auth.createAccount(username, await secret(), (options['--role'] || 'user') as 'user' | 'admin', (options['--plan'] || 'Free') as 'Free' | 'Pro', options['--until'] ? Date.parse(options['--until']) : null);
    else if (operation === 'list')
        result = { accounts: auth.list() };
    else if (operation === 'set-plan') {
        if (!['Free', 'Pro'].includes(options['--plan']))
            throw Error('請指定 --plan Free 或 Pro。');
        result = auth.setAccount(username, { plan: options['--plan'] as 'Free' | 'Pro', proUntil: options['--until'] ? Date.parse(options['--until']) : null });
    }
    else if (operation === 'reset-password')
        result = auth.setAccount(username, { passwordHash: await m.passwordHash(await secret()) });
    else if (operation === 'claim-legacy')
        result = options['--confirm'] ? auth.claimLegacy(username, options['--confirm']) : auth.legacyPreview(username);
    else
        result = auth.setAccount(username, { enabled: operation === 'enable' });
    process.stdout.write(JSON.stringify({ operation, ...result }, null, 2) + '\n');
}
catch (error) {
    console.error(error instanceof Error ? error.message : '帳號操作未完成。');
    process.exitCode = 1;
}
finally {
    store?.close();
    unlock?.();
}
