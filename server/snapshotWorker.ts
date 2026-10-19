import {parentPort,workerData} from 'node:worker_threads';
import {DatabaseSync} from 'node:sqlite';
import {writeConnectedSnapshot,archiveBackupSnapshot} from './systemBackup';

let library:DatabaseSync|undefined,imports:DatabaseSync|undefined,ok=false,sha256:string|undefined;
try{
    if(workerData.archive){sha256=archiveBackupSnapshot(workerData.target,workerData.output).sha256;ok=true;}else{
    library=new DatabaseSync(workerData.library,{readOnly:true});
    imports=new DatabaseSync(workerData.imports,{readOnly:true});
    writeConnectedSnapshot(library,imports,workerData.target,workerData.directory);
    ok=true;}
}catch{}finally{
    imports?.close();library?.close();parentPort!.postMessage({ok,sha256});parentPort!.close();
}
