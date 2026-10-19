import {runtimeSchema,saveRuntime} from './importRuntime';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {assertSQLiteFile} from './sqlitePaths';
import {validateImportText,importFileLimit,importWebLimit,type ImportReport} from '../shared/dataImport';
import {AnalysisError} from '../shared/mockAnalysis';
import {exactFields} from '../shared/libraryContract';

export class ImportStore{
 private db:DatabaseSync;
 constructor(filename=':memory:',readonly=false){
  if(filename!==':memory:')assertSQLiteFile(filename);
  if(readonly){this.db=new DatabaseSync(filename,{readOnly:true});try{this.db.exec('PRAGMA busy_timeout=1000; PRAGMA query_only=ON;');if(Number(this.db.prepare('PRAGMA user_version').get()!.user_version)!==2)throw Error('背景運算需要已初始化的行情資料庫。');this.db.prepare('SELECT batch_id FROM import_batches LIMIT 1').all()}catch(error){this.db.close();throw error}return}
  if(filename!==':memory:')mkdirSync(path.dirname(path.resolve(filename)),{recursive:true});
  this.db=new DatabaseSync(filename);
  try{
   this.db.exec('PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
   const version=Number(this.db.prepare('PRAGMA user_version').get()!.user_version);
   if(![0,1,2].includes(version))throw Error('匯入資料庫版本不支援，原檔保留。');
   if(version===0)this.db.exec(`BEGIN IMMEDIATE; CREATE TABLE import_batches(batch_id TEXT PRIMARY KEY, sha256 TEXT NOT NULL, imported_at TEXT NOT NULL, dataset_kind TEXT NOT NULL CHECK(dataset_kind IN ('test','source')), source_version TEXT NOT NULL, date_from TEXT NOT NULL, date_to TEXT NOT NULL, price_count INTEGER NOT NULL, report TEXT NOT NULL CHECK(json_valid(report)), source_text TEXT NOT NULL); PRAGMA user_version=1; COMMIT;`);
   runtimeSchema(this.db);this.db.prepare('SELECT batch_id FROM import_batches LIMIT 1').all();
  }catch(error){this.db.close();throw error}
 }
 close(){this.db.close()}
 // Server-only connection shared with version management; never exported to the browser.
 get connection(){return this.db}
 validate(text:unknown,limit=importFileLimit){
  const result=validateImportText(text,limit);
  if(typeof text==='string')result.report.sha256=createHash('sha256').update(text,'utf8').digest('hex');
  return result;
 }
 list(){return this.db.prepare('SELECT batch_id,sha256,imported_at,dataset_kind,source_version,date_from,date_to,price_count FROM import_batches ORDER BY imported_at DESC,batch_id LIMIT 100').all()}
 stage(text:unknown,expectedHash:unknown,limit=importFileLimit){
  const {report,data}=this.validate(text,limit);
  if(typeof expectedHash!=='string'||!/^[a-f0-9]{64}$/.test(expectedHash)||expectedHash!==report.sha256)throw new AnalysisError('IMPORT_CHANGED','檔案與檢查時的內容不同，請重新檢查。',409);
  if(!data)return {staged:false,reused:false,report,notice:'批次未通過，暫存資料未變更。'};
  this.db.exec('BEGIN IMMEDIATE');
  try{
   const previous=this.db.prepare('SELECT sha256,report FROM import_batches WHERE batch_id=?').get(data.manifest.batch_id);
   if(previous){if(previous.sha256!==report.sha256)throw new AnalysisError('BATCH_CONFLICT','此批次編號已有不同內容，原批次保留。修訂資料請建立新的批次編號。',409);this.db.exec('COMMIT');return {staged:true,reused:true,report:JSON.parse(String(previous.report)) as ImportReport,notice:'相同批次及內容已保存，沒有重複匯入。'}}
   this.db.prepare('INSERT INTO import_batches VALUES (?,?,?,?,?,?,?,?,?,?)').run(data.manifest.batch_id,report.sha256,new Date().toISOString(),data.manifest.dataset_kind,data.manifest.source_version,data.manifest.date_from,data.manifest.date_to,data.prices.length,JSON.stringify(report),text as string);
   if(data.version===2)saveRuntime(this.db,data,report.sha256);
   this.db.exec('COMMIT');return {staged:true,reused:false,report,notice:'已保存通過檢查的原始匯入包與報告。資料位於暫存區，圖表尚未切換。'};
  }catch(error){this.db.exec('ROLLBACK');throw error}
 }
 handle(operation:string,input:unknown):Record<string,unknown>{
  if(operation==='list'){exactFields(input,[]);return {batches:this.list(),scope:'local-staging'}}
  if(operation==='validate'){exactFields(input,['text']);return {report:this.validate(input.text,importWebLimit).report}}
  if(operation==='stage'){exactFields(input,['text','sha256']);return this.stage(input.text,input.sha256,importWebLimit)}
  if(operation==='report'){
   exactFields(input,['batch_id']);if(typeof input.batch_id!=='string'||input.batch_id.length>96)throw new AnalysisError('INVALID_BATCH','批次編號格式不適用。',422);
   const row=this.db.prepare('SELECT report FROM import_batches WHERE batch_id=?').get(input.batch_id);
   if(!row)throw new AnalysisError('BATCH_NOT_FOUND','找不到已匯入的批次。',404);
   return {report:JSON.parse(String(row.report))};
  }
  throw new AnalysisError('NOT_FOUND','找不到這個匯入介面。',404);
 }
}
