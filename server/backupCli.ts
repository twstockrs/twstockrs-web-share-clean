import path from 'node:path';
import {createStoppedBackup,previewBackup,restoreBackup,recoverRestore,undoRestore} from './systemBackup';
import {unlockStoppedData} from './dataLock';
import {backupPassphrase} from './backupPassphrase';
import {encryptedBackupOperation} from './encryptedBackupOperations';

async function main(){
 const args=process.argv.slice(2),operation=args.shift(),values:Record<string,string>={};while(args.length){const key=args.shift()!,value=args.shift();if(!['--file','--data-dir','--confirm','--output'].includes(key)||!value||Object.hasOwn(values,key))throw Error('參數不正確。密碼不得放在命令列參數或環境變數。');values[key]=value}
 const encrypted=['create-encrypted','preview-encrypted','restore-encrypted','encrypt','decrypt'] as const;
 if(!operation||!['create','preview','restore','undo','recover','unlock',...encrypted].includes(operation))throw Error('完整備份工具：create／preview／restore／undo／recover／unlock，或create-encrypted／preview-encrypted／restore-encrypted／encrypt／decrypt。請提供--data-dir與--file，還原另需--confirm；encrypt／decrypt另需--output。');
 const directory=path.resolve(values['--data-dir']||process.env.TWSTOCKRS_DATA_DIR||'.local-data'),file=values['--file'];
 if(!['undo','recover','unlock'].includes(operation)&&!file)throw Error('必須指定--file；輸出只允許新檔案。');
 if(['undo','recover','unlock'].includes(operation)&&file||!['restore','undo','restore-encrypted'].includes(operation)&&values['--confirm']||!['encrypt','decrypt'].includes(operation)&&values['--output'])throw Error('此操作不接受提供的參數。');
 if(['encrypt','decrypt'].includes(operation)&&!values['--output'])throw Error('encrypt／decrypt必須提供新的--output檔名。');
 if(['restore','restore-encrypted'].includes(operation)&&!values['--confirm'])throw Error('先執行對應preview核對內容，再以--confirm提供confirmation_token（預覽確認碼）。');
 if(encrypted.includes(operation as typeof encrypted[number])){
  const password=await backupPassphrase(['create-encrypted','encrypt'].includes(operation));
  return {operation,...encryptedBackupOperation(operation as typeof encrypted[number],directory,path.resolve(file!),values['--output']?path.resolve(values['--output']):undefined,values['--confirm'],password)};
 }
 return {operation,...(operation==='create'?createStoppedBackup(directory,path.resolve(file!)):operation==='preview'?previewBackup(file!,directory):operation==='restore'?restoreBackup(file!,directory,values['--confirm']):operation==='undo'?undoRestore(directory,values['--confirm']):operation==='recover'?recoverRestore(directory):{notice:unlockStoppedData(directory)})};
}
try{console.log(JSON.stringify(await main(),null,2))}catch(error){console.error(error instanceof Error?error.message:'完整備份操作未完成，原資料保留。');process.exitCode=1}
