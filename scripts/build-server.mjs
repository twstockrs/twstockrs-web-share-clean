import {build} from 'esbuild';
import {shareViewerTemplate} from './share-viewer-template.mjs';
const worker=await build({entryPoints:['server/rsWorker.ts'],bundle:true,write:false,platform:'node',format:'cjs',target:'node22'});
const backupWorker=await build({entryPoints:['server/snapshotWorker.ts'],bundle:true,write:false,platform:'node',format:'cjs',target:'node22'});
await build({entryPoints:['server/main.ts'],bundle:true,platform:'node',format:'esm',target:'node22',outfile:'server-dist/main.mjs',sourcemap:true,define:{__TWSTOCKRS_RS_WORKER__:JSON.stringify(worker.outputFiles[0].text),__TWSTOCKRS_BACKUP_WORKER__:JSON.stringify(backupWorker.outputFiles[0].text),__TWSTOCKRS_SHARE_VIEWER__:JSON.stringify(await shareViewerTemplate())}});
console.log('Built local API: server-dist/main.mjs');
