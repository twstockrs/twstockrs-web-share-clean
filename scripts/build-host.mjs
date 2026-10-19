import { build } from 'esbuild';
import { shareViewerTemplate } from './share-viewer-template.mjs';
const worker = await build({ entryPoints: ['server/rsWorker.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', target: 'node22' }), backupWorker=await build({entryPoints:['server/snapshotWorker.ts'],bundle:true,write:false,platform:'node',format:'cjs',target:'node22'}), define = { __TWSTOCKRS_RS_WORKER__: JSON.stringify(worker.outputFiles[0].text), __TWSTOCKRS_BACKUP_WORKER__:JSON.stringify(backupWorker.outputFiles[0].text), __TWSTOCKRS_SHARE_VIEWER__: JSON.stringify(await shareViewerTemplate()) };
await Promise.all([
    build({ entryPoints: ['server/hostServe.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: 'server-dist/host-runtime/serve.mjs', define }),
    build({ entryPoints: ['server/hostDataCli.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: 'server-dist/host-runtime/data.mjs' }),
    build({entryPoints:['server/backupCli.ts'],bundle:true,platform:'node',format:'esm',target:'node22',outfile:'server-dist/host-runtime/backup.mjs'}),
    build({ entryPoints: ['server/accountsCli.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: 'server-dist/host-runtime/accounts.mjs' }),
    build({ entryPoints: ['server/hostCli.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: 'server-dist/host.mjs' }),
    build({ entryPoints: ['server/packageCli.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: 'server-dist/package-cli.mjs' }),
    build({ entryPoints: ['server/preflightCli.ts'], bundle: true, platform: 'node', format: 'esm', target: 'node22', outfile: 'server-dist/preflight.mjs' })
]);
console.log('Built standalone host manager and runtime.');
