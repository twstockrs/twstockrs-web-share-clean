import {AnalysisError} from '../shared/mockAnalysis';

const stopping=()=>new AnalysisError('SERVICE_STOPPING','服務正在停止，請稍後重試。',503);
function waitFor(promise:Promise<void>,signal?:AbortSignal){
    return new Promise<void>((resolve,reject)=>{
        const abort=()=>finish(stopping());
        const finish=(error?:unknown)=>{signal?.removeEventListener('abort',abort);error?reject(error):resolve()};
        if(signal?.aborted){reject(stopping());return}
        signal?.addEventListener('abort',abort,{once:true});promise.then(()=>finish(),finish);
    });
}

// An admitted request owns its lease through response finish and audit persistence.
// Snapshotting drains existing leases, then delays new database users; health remains independent.
export class SnapshotCoordinator{
    private active=0;
    private waiting=0;
    private closed=false;
    private gate:Promise<void>|null=null;
    private openGate:(()=>void)|null=null;
    private drained:(()=>void)|null=null;
    private controller:AbortController|null=null;
    private task:Promise<void>|null=null;
    constructor(private maxWaiting=32,private timeoutMs=45_000){}
    async enter(signal?:AbortSignal):Promise<()=>void>{
        while(this.gate){
            if(this.waiting>=this.maxWaiting)throw new AnalysisError('BACKUP_BUSY','備份等待中的操作已達上限，請稍後重試。',429);
            this.waiting++;
            try{await waitFor(this.gate,signal)}finally{this.waiting--}
        }
        if(this.closed||signal?.aborted)throw stopping();
        this.active++;let released=false;
        return ()=>{if(released)return;released=true;this.active--;if(!this.active)this.drained?.()};
    }
    async capture(run:(signal:AbortSignal)=>Promise<void>){
        if(this.closed||this.gate)throw new AnalysisError('BACKUP_BUSY','另一份備份或停止作業尚未完成。',409);
        this.gate=new Promise(r=>{this.openGate=r});const controller=new AbortController();this.controller=controller;
        const timer=setTimeout(()=>controller.abort(),this.timeoutMs);
        this.task=(async()=>{
            if(this.active)await waitFor(new Promise<void>(r=>{this.drained=r}),controller.signal);
            if(controller.signal.aborted||this.closed)throw stopping();
            await run(controller.signal);
        })();
        try{await this.task}finally{
            clearTimeout(timer);this.drained=null;this.controller=null;this.task=null;
            const release=this.openGate;this.openGate=null;this.gate=null;release?.();
        }
    }
    async close(){this.closed=true;this.controller?.abort();try{await this.task}catch{}}
}
