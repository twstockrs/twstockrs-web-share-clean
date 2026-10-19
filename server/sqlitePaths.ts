import path from 'node:path';
import {tmpdir} from 'node:os';

// Product compatibility policy for the bundled Windows SQLite runtime.
// MAX_PATH includes the final NUL; reserve 12 additional characters for SQLite sidecars.
export const windowsSQLiteFilenameLimit=247;
const uuid='00000000-0000-0000-0000-000000000000';
type Candidate={scope:string;file:string};
const api=(platform:NodeJS.Platform)=>platform==='win32'?path.win32:path;
export class SQLitePathError extends Error{
 readonly code='WINDOWS_SQLITE_PATH_UNSAFE';
 constructor(readonly scope:string,readonly characters:number,namespace=false){
  super(namespace?'Windows SQLite（單檔資料庫）不接受此操作的特殊路徑前綴。請使用一般磁碟或網路分享路徑；不會自動搬動既有資料。':`Windows SQLite（單檔資料庫）路徑過長：${scope} 需 ${characters} 個字元，安全上限為 ${windowsSQLiteFilenameLimit}（另保留交易檔空間）。請改用較短的專用目錄，例如 C:\\TWStockRS-host；TEMP 暫存目錄也須足夠短。不會自動搬動既有資料。`);
 }
}
function databaseFiles(directory:string,scope:string,platform:NodeJS.Platform):Candidate[]{const p=api(platform);return ['library.sqlite','imports.sqlite'].map(name=>({scope,file:p.resolve(directory,name)}));}
function restoreFiles(directory:string,platform:NodeJS.Platform){const p=api(platform),root=p.resolve(directory);return [
 ...databaseFiles(root,'目前資料庫',platform),
 ...databaseFiles(root+'.incoming-'+uuid,'還原暫存資料庫',platform),
 ...databaseFiles(root+'.before-'+uuid,'還原前保留資料庫',platform),
 ...databaseFiles(root+'.interrupted-'+uuid,'中斷保留資料庫',platform)
 ];}
function temporaryFiles(platform:NodeJS.Platform,temporary:string){const p=api(platform);return [
 ...databaseFiles(p.resolve(temporary,'twstockrs-snapshot-XXXXXX','snapshot'),'備份快照暫存資料庫',platform),
 ...databaseFiles(p.resolve(temporary,'twstockrs-preview-XXXXXX'),'備份預覽暫存資料庫',platform),
 ...databaseFiles(p.resolve(temporary,'twrs-preflight-XXXXXX'),'部署檢查暫存資料庫',platform),
 // Automatic verification previews this target but never installs into it.
 ...restoreFiles(p.resolve(temporary,'twrs-auto-verify-XXXXXX','restore-target'),platform)
 ];}
function check(files:Candidate[],platform:NodeJS.Platform){
 const p=api(platform);let longest=0;
 for(const entry of files){const file=p.resolve(entry.file);longest=Math.max(longest,file.length);
  if(platform==='win32'){
   if(file.startsWith('\\\\?\\')||file.startsWith('\\\\.\\'))throw new SQLitePathError(entry.scope,file.length,true);
   if(file.length>windowsSQLiteFilenameLimit)throw new SQLitePathError(entry.scope,file.length);
  }
 }
 return {platform,windows_protection:platform==='win32',sqlite_filename_limit:platform==='win32'?windowsSQLiteFilenameLimit:null,longest_sqlite_filename:longest,checked_files:files.length};
}
export function assertSQLiteDirectory(directory:string,scope='資料庫',platform:NodeJS.Platform=process.platform){return check(databaseFiles(directory,scope,platform),platform);}
export function assertSQLiteFile(file:string,platform:NodeJS.Platform=process.platform){return check([{scope:'資料庫檔案',file}],platform);}
export function assertRestorePaths(directory:string,platform:NodeJS.Platform=process.platform){return check(restoreFiles(directory,platform),platform);}
export function assertBackupTemporaryPaths(platform:NodeJS.Platform=process.platform,temporary=tmpdir()){return check(temporaryFiles(platform,temporary),platform);}
export function assertAutomaticBackupPaths(root:string,platform:NodeJS.Platform=process.platform,temporary=tmpdir()){
 const p=api(platform);return check([...databaseFiles(p.resolve(root,'auto-backup-work',uuid,'snapshot'),'自動備份快照資料庫',platform),...temporaryFiles(platform,temporary)],platform);
}
export function assertHostPaths(root:string,platform:NodeJS.Platform=process.platform,temporary=tmpdir()){
 const p=api(platform);return check([...restoreFiles(p.resolve(root,'data','generation-'+uuid),platform),...databaseFiles(p.resolve(root,'auto-backup-work',uuid,'snapshot'),'自動備份快照資料庫',platform),...temporaryFiles(platform,temporary)],platform);
}
