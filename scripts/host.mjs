import { spawn } from 'node:child_process';
await import('./build-host.mjs');
const child = spawn(process.execPath, ['server-dist/host.mjs', ...process.argv.slice(2)], { stdio: 'inherit', env: process.env });
child.once('exit', code => process.exitCode = code ?? 1);
child.once('error', () => process.exitCode = 1);
