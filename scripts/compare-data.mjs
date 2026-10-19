import {build} from 'esbuild';
import {spawnSync} from 'node:child_process';
await build({entryPoints:['server/compareCli.ts'],bundle:true,platform:'node',format:'esm',target:'node22',outfile:'server-dist/compare-cli.mjs'});
const result=spawnSync(process.execPath,['server-dist/compare-cli.mjs',...process.argv.slice(2)],{stdio:'inherit',env:process.env});
process.exitCode=result.status??1;
