import path from 'node:path';
import { writeFileSync, existsSync } from 'node:fs';
import { readJson, validateConfig, safePath } from './hostProtocol';
export function writeServiceTemplates(root: string, user?: string) {
    const config = validateConfig(readJson(safePath(root, 'host.json')));
    const xml = (v: string) => v.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'), escape = (v: string) => v.replaceAll('%', '%%').replaceAll('\\', '\\\\').replaceAll('"', '\\"');
    if (!user || !/^[-a-zA-Z0-9_.@\\]{1,128}$/.test(user))
        throw Error('請以--user提供目標主機專用服務帳號，不接受密碼。');
    const xmlFile = safePath(root, 'twstockrs-task.xml'), unit = safePath(root, 'twstockrs.service'), proxy = safePath(root, 'Caddyfile.example');
    for (const file of [xmlFile, unit, proxy])
        if (existsSync(file))
            throw Error('開機啟動範本已存在，未覆寫。');
    writeFileSync(xmlFile, `<?xml version="1.0" encoding="UTF-8"?>\n<Task version="1.4" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><RegistrationInfo><Description>TWStockRS host supervisor</Description></RegistrationInfo><Triggers><BootTrigger><Enabled>true</Enabled></BootTrigger></Triggers><Principals><Principal id="HostUser"><UserId>${xml(user)}</UserId><LogonType>Password</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals><Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><ExecutionTimeLimit>PT0S</ExecutionTimeLimit><RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure></Settings><Actions Context="HostUser"><Exec><Command>${xml(process.execPath)}</Command><Arguments>${xml('"' + path.join(root, 'host.mjs') + '" run --root "' + root + '"')}</Arguments><WorkingDirectory>${xml(root)}</WorkingDirectory></Exec></Actions></Task>\n`, { flag: 'wx', mode: 0o600 });
    writeFileSync(unit, `[Unit]\nDescription=TWStockRS host supervisor\nAfter=network.target\nStartLimitIntervalSec=300\nStartLimitBurst=3\n\n[Service]\nType=simple\nUser=${user}\nWorkingDirectory="${escape(root)}"\nExecStart="${escape(process.execPath)}" "${escape(path.join(root, 'host.mjs'))}" run --root "${escape(root)}"\nRestart=on-failure\nRestartSec=5\nTimeoutStopSec=30\nKillMode=mixed\nNoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=strict\nReadWritePaths="${escape(root)}"\n\n[Install]\nWantedBy=multi-user.target\n`, { flag: 'wx', mode: 0o600 });
    writeFileSync(proxy, `# Confirm domain and HTTPS on the chosen host. Node remains on loopback.\n${config.mode === 'production' ? config.origin : 'stock.example.invalid'} {\n  reverse_proxy 127.0.0.1:${config.port}\n  handle_errors {\n    respond "Service temporarily unavailable" 503\n  }\n}\n`, { flag: 'wx', mode: 0o600 });
    return { generated: ['twstockrs-task.xml', 'twstockrs.service', 'Caddyfile.example'], notice: '已產生範本，尚未註冊排程、安裝服務、開放連線或申請憑證。請依實際作業系統與路徑核對後才安裝。' };
}
