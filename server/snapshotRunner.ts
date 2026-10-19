import {Worker} from 'node:worker_threads';
declare const __TWSTOCKRS_BACKUP_WORKER__:string;
let sourcePromise:Promise<string>|undefined;
async function source(){
    if(typeof __TWSTOCKRS_BACKUP_WORKER__!=='undefined')return __TWSTOCKRS_BACKUP_WORKER__;
    return sourcePromise??=(async()=>{const moduleName='esbuild',compiler=await import(moduleName);const result=await compiler.build({entryPoints:['server/snapshotWorker.ts'],bundle:true,write:false,platform:'node',format:'cjs',target:'node22',logLevel:'silent'});return result.outputFiles[0].text})();
}
async function runWorker(library:string,imports:string,target:string,directory:string,signal:AbortSignal,output?:string){
    const code=await source();if(signal.aborted)throw Error('Snapshot cancelled');
    return new Promise<string|undefined>((resolve,reject)=>{
        const worker=new Worker(code,{eval:true,workerData:{library,imports,target,directory,...(output?{archive:true,output}:{})},resourceLimits:{maxOldGenerationSizeMb:output?1024:128},stdout:true,stderr:true});
        worker.stdout?.resume();worker.stderr?.resume();let ok=false,error=false,sha256:string|undefined;
        const abort=()=>{error=true;void worker.terminate()};signal.addEventListener('abort',abort,{once:true});
        worker.on('message',value=>{ok=value?.ok===true;sha256=value?.sha256});worker.once('error',()=>{error=true});
        worker.once('exit',code=>{signal.removeEventListener('abort',abort);code===0&&ok&&!error?resolve(sha256):reject(Error('Background snapshot did not complete'))});
        if(signal.aborted)abort();
    });
}

export async function runSnapshotWorker(library:string,imports:string,target:string,directory:string,signal:AbortSignal){await runWorker(library,imports,target,directory,signal)}
export async function runArchiveWorker(target:string,output:string,signal:AbortSignal){const sha256=await runWorker('','',target,'',signal,output);if(!sha256||!/^[a-f0-9]{64}$/.test(sha256))throw Error('Backup archive did not complete');return {sha256}}
