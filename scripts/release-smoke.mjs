import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { randomBytes } from 'node:crypto';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function freePort() {
    const s = createServer(); await new Promise((resolve, reject) => {s.once('error', reject); s.listen(0, '127.0.0.1', resolve);});
    const port = s.address().port; await new Promise(resolve => s.close(resolve)); return port;
}
async function http(port, route, {body, headers = {}} = {}) {
    return new Promise((resolve, reject) => {
        const req = request({hostname: '127.0.0.1', port, path: route, method: body === undefined ? 'GET' : 'POST', headers: {...headers, ...(body === undefined ? {} : {'Content-Type': 'application/json'})}}, res => {
            const chunks = []; res.on('data', b => chunks.push(b)); res.on('end', () => {
                const text = Buffer.concat(chunks).toString();
                try {resolve({status: res.statusCode, headers: res.headers, text, value: res.headers['content-type']?.includes('json') ? JSON.parse(text) : null});} catch (e) {reject(e);}
            });
        });
        req.on('error', reject); req.setTimeout(5000, () => req.destroy(Error('HTTP檢查逾時。'))); req.end(body === undefined ? undefined : JSON.stringify(body));
    });
}
export async function smokeRelease(archive, launcher, releaseId) {
    const area = mkdtempSync(path.join(tmpdir(), 'twrs-release-smoke-')), root = path.join(area, 'host'), port = await freePort();
    let child, done;
    const cli = (operation, args = [], input) => {
        const p = spawnSync(process.execPath, [existsSync(path.join(root, 'host.mjs')) ? path.join(root, 'host.mjs') : launcher, operation, '--root', root, ...args], {cwd: area, input, encoding: 'utf8', timeout: 45000});
        // Never print maintenance stdout, passwords, cookies or private control records.
        if (p.status !== 0) throw Error('獨立交付檢查未通過：' + operation);
        return p.stdout.trim() ? JSON.parse(p.stdout) : null;
    };
    try {
        cli('init', ['--release', archive, '--port', String(port)]);
        assert.equal(cli('path-check').status,'passed');
        const password = randomBytes(24).toString('base64url');
        cli('account', ['--', 'create', '--username', 'release-check', '--role', 'admin'], JSON.stringify({password}));
        child = spawn(process.execPath, [path.join(root, 'host.mjs'), 'run', '--root', root], {cwd: area, stdio: ['ignore', 'ignore', 'ignore', 'ipc']});
        let spawnError; child.on('error', error => {spawnError = error;}); done = new Promise(resolve => child.once('close', resolve));
        const deadline = Date.now() + 45000; let health;
        while (Date.now() < deadline) {
            if (spawnError || child.exitCode !== null || child.signalCode !== null) throw Error('交付服務未正常啟動。');
            try {const r = await http(port, '/api/v1/health'); if (r.status === 200) {health = r.value; break;}} catch {}
            await pause(150);
        }
        assert.equal(health?.deployment?.release_id, releaseId, '服務版本必須與交付版本一致');
        const page = await http(port, '/'); assert.equal(page.status, 200); assert.match(page.text, /<html/i);
        const asset = page.text.match(/(?:src|href)="(\/assets\/[^"?]+\.js)"/); assert(asset, '實際前端入口必須存在');
        assert.equal((await http(port, asset[1])).status, 200);
        for (const route of ['/host.json', '/control.json', '/runtime/serve.mjs', '/library.sqlite']) assert.equal((await http(port, route)).status, 404);
        let cookie = '', session;
        const call = async (route, body) => {
            const r = await http(port, '/api/v1/' + route, {body, headers: {...(cookie ? {Cookie: cookie} : {}), ...(session ? {'X-Workspace-Id': session.owner, 'X-Auth-Rights': session.rights, 'X-CSRF-Token': session.csrf} : {})}});
            if (r.headers['set-cookie']) cookie = r.headers['set-cookie'][0].split(';')[0];
            if (r.value?.session) session = r.value.session;
            return r;
        };
        assert.equal((await call('auth/session')).status, 200);
        assert.equal((await call('admin/overview', {})).status, 403);
        assert.equal((await call('auth/login', {username: 'release-check', password})).status, 200);
        assert.equal((await call('admin/overview', {})).status, 200);
        assert.equal((await call('library/open', {mock_plan: 'Free'})).status, 200);
        assert.equal(cli('path-check').status,'passed');
        assert.equal(cli('auto-backup',['--','run']).status,'success');
        assert.equal(readdirSync(path.join(root,'auto-backups')).filter(n=>n.endsWith('.twrsbackup')).length,1);
        assert.equal((await http(port,'/api/v1/health')).value.deployment.instance_id,health.deployment.instance_id);
        assert.equal((await call('library/open',{mock_plan:'Free'})).status,200);
        assert.equal(cli('monitor',['--','test']).queued,true);
        const monitored=(await call('admin/overview',{})).value.host.monitoring;assert.equal(monitored.available,true);assert.equal(monitored.delivered,1);assert.equal(monitored.notifications[0].kind,'test');
        assert.equal((await http(port,'/api/v1/health')).value.monitor,undefined);
        cli('stop');
        await Promise.race([done, pause(15000)]);
        assert.equal(child.exitCode, 0, '服務應正常結束');
        assert(!existsSync(path.join(root, 'node_modules')));
        assert(!existsSync(path.join(root, 'control.json')));
        assert(!readdirSync(root).some(name => name.endsWith('.twstockrs-lock')));
        assert(!readdirSync(path.join(root, 'data')).some(name => name.endsWith('.twstockrs-lock')));
        return {checks: ['version-health', 'sqlite-path-preflight', 'built-web-asset', 'private-file-denial', 'admin-login-and-rights', 'library-api', 'automatic-backup-verified','local-monitor-notification','clean-stop'], synthetic: true};
    } finally {
        if (child && child.exitCode === null && child.signalCode === null) {
            if (child.connected) child.send({type: 'stop'});
            await Promise.race([done, pause(15000)]);
            if (child.exitCode === null && child.signalCode === null) {child.kill('SIGKILL'); await done;}
        }
        // Only this newly created temporary tree may be removed.
        if (path.dirname(area) !== path.resolve(tmpdir()) || !path.basename(area).startsWith('twrs-release-smoke-')) throw Error('驗收暫存路徑不適用。');
        rmSync(area, {recursive: true, force: true});
    }
}
