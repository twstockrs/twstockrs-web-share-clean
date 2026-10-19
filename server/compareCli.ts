import {DatabaseSync} from 'node:sqlite';
import {comparisonRequest} from './versionComparison';
import path from 'node:path';
import {existsSync,mkdirSync} from 'node:fs';
import {acquireDataLock} from './dataLock';
import {ImportStore} from './importStore';
import {ReleaseStore} from './releaseStore';
import {defaultComparisonFilter} from '../shared/versionComparison';
function main(){
 const args=process.argv.slice(2),v:Record<string,string>={};while(args.length){const key=args.shift()!,value=args.shift();if(!['--market','--from','--to','--file','--data-dir','--category','--kind','--query','--date-from','--date-to'].includes(key)||!value||Object.hasOwn(v,key))throw Error('比較參數不正確或重複。');v[key]=value}
 if(!v['--market']||!v['--from']||!v['--to']||!v['--file'])throw Error('用法：npm run data:compare -- --market TWSE|TPEx --from 版本ID|none --to 版本ID|none --file 新報告.json [--data-dir 資料目錄] [--category 分類] [--kind added|removed|modified] [--query 代號或名稱] [--date-from 日期] [--date-to 日期]');
 const directory=path.resolve(v['--data-dir']||process.env.TWSTOCKRS_DATA_DIR||'.local-data'),file=path.resolve(v['--file']);if(existsSync(file)||file===directory||file.startsWith(directory+path.sep)||file.toLowerCase().endsWith('.sqlite'))throw Error('報告必須是資料目錄之外的新檔案，不可覆寫來源或資料庫。');
 comparisonRequest({market:v['--market'],expected_revision:1,from_release_id:v['--from']==='none'?null:v['--from'],to_release_id:v['--to']==='none'?null:v['--to'],filters:{...defaultComparisonFilter(),category:v['--category']||'all',kind:v['--kind']||'all',query:v['--query']||'',date_from:v['--date-from']||null,date_to:v['--date-to']||null}},true);
 if(!existsSync(path.join(directory,'imports.sqlite')))throw Error('找不到匯入資料庫，未建立替代資料。');const unlock=acquireDataLock(directory);try{const check=new DatabaseSync(path.join(directory,'imports.sqlite'),{readOnly:true});try{if(check.prepare('PRAGMA user_version').get()?.user_version!==2)throw Error('版本資料庫結構不適用；請先用相容的最新版後端完成遷移。比較工具不修改結構。')}finally{check.close()}const imports=new ImportStore(path.join(directory,'imports.sqlite'));try{const versions=new ReleaseStore(imports),market=v['--market'],state=versions.handle('state',{market}).state as {revision:number};mkdirSync(path.dirname(file),{recursive:true});const report=versions.comparisonReport({market,expected_revision:state.revision,from_release_id:v['--from']==='none'?null:v['--from'],to_release_id:v['--to']==='none'?null:v['--to'],filters:{...defaultComparisonFilter(),category:v['--category']||'all',kind:v['--kind']||'all',query:v['--query']||'',date_from:v['--date-from']||null,date_to:v['--date-to']||null}},file);console.log(JSON.stringify({file,...report},null,2))}finally{imports.close()}}finally{unlock()}
}
try{main()}catch(error){console.error(error instanceof Error?error.message:'資料版本比較未完成。');process.exitCode=1}
