import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
await build({entryPoints:['server/backupCli.ts'],bundle:true,platform:'node',format:'esm',target:'node22',outfile:'server-dist/backup-cli.mjs'});
const result=spawnSync(process.execPath,['server-dist/backup-cli.mjs',...process.argv.slice(2)],{stdio:'inherit',env:process.env});
process.exitCode=result.status??1;
