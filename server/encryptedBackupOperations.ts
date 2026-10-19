import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createStoppedBackup,previewBackup,restoreBackup} from './systemBackup';
import {encryptBackupFile,decryptBackupFile} from './encryptedBackup';
import {assertBackupTemporaryPaths} from './sqlitePaths';

export function encryptedBackupOperation(operation:'create-encrypted'|'preview-encrypted'|'restore-encrypted'|'encrypt'|'decrypt',directory:string,file:string,output:string|undefined,confirmation:string|undefined,password:string){
 assertBackupTemporaryPaths();
 const temporary=mkdtempSync(path.join(tmpdir(),'twrs-crypt-')),plaintext=path.join(temporary,'content.twrsbackup');
 try{
  if(operation==='encrypt'){if(!output)throw Error('請提供新的--output加密檔名。');previewBackup(file,path.join(temporary,'inspect'));return encryptBackupFile(file,output,password)}
  if(operation==='decrypt'){if(!output)throw Error('請提供新的--output解密檔名。');return decryptBackupFile(file,output,password)}
  if(operation==='create-encrypted'){const relative=path.relative(path.resolve(directory),path.resolve(file));if(!relative||!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))throw Error('加密完整備份請存到資料目錄之外。');if(existsSync(file))throw Error('輸出必須是新檔案，不覆寫既有檔案。');createStoppedBackup(directory,plaintext);return encryptBackupFile(plaintext,file,password)}
  const decoded=decryptBackupFile(file,plaintext,password);
  const result=operation==='preview-encrypted'?previewBackup(plaintext,directory):restoreBackup(plaintext,directory,confirmation!);
  return {...result,encrypted:true,encrypted_sha256:decoded.encrypted_sha256};
 }finally{if(path.dirname(temporary)!==path.resolve(tmpdir())||!path.basename(temporary).startsWith('twrs-crypt-'))throw Error('私人暫存清理路徑不適用。');rmSync(temporary,{recursive:true,force:true})}
}
