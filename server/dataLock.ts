import {existsSync,lstatSync,mkdirSync,readFileSync,unlinkSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

export function dataPaths(directory:string){
 const root=path.resolve(directory);if(root===path.parse(root).root)throw Error('資料目錄不可使用磁碟根目錄。');
 for(let current=root;;current=path.dirname(current)){if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw Error('資料目錄及其上層不可使用符號連結或目錄接點。');if(current===path.dirname(current))break}
 return {root,lock:path.join(path.dirname(root),`.${path.basename(root)}.twstockrs-lock`),journal:path.join(path.dirname(root),`.${path.basename(root)}.twstockrs-restore.json`)};
}
export function acquireDataLock(directory:string,allowRecovery=false){
 const paths=dataPaths(directory);mkdirSync(path.dirname(paths.root),{recursive:true});
 if(!allowRecovery&&existsSync(paths.journal))throw Error('上次還原尚未完成。請先執行 data:backup recover，原資料保留。');
 const token=randomUUID(),record=JSON.stringify({format:'TWStockRS-data-lock',version:1,pid:process.pid,token,created_at:new Date().toISOString()});
 try{writeFileSync(paths.lock,record,{flag:'wx'})}catch{throw Error('資料目錄已被服務或維護工具使用。請先停止後端；異常終止後可用 data:backup unlock 檢查殘留鎖。')}
 let closed=false;return ()=>{if(closed)return;closed=true;if(readFileSync(paths.lock,'utf8')!==record)throw Error('資料鎖已變更，未移除。');unlinkSync(paths.lock)};
}
export function unlockStoppedData(directory:string){
 const {lock}=dataPaths(directory);if(!existsSync(lock))return '沒有殘留資料鎖。';
 const text=readFileSync(lock,'utf8'),value=JSON.parse(text);if(value.format!=='TWStockRS-data-lock'||value.version!==1||!Number.isSafeInteger(value.pid)||value.pid<=0||typeof value.token!=='string')throw Error('資料鎖內容不合法，請人工檢查；未移除。');
 try{process.kill(value.pid,0)}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH'){if(readFileSync(lock,'utf8')!==text)throw Error('資料鎖已變更。');unlinkSync(lock);return '已確認原程序停止，移除殘留資料鎖。'}throw Error('無法確認原程序已停止，資料鎖保留。')}
 throw Error('原程序仍存在，不能解除資料鎖。');
}
