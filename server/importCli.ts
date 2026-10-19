import {readFileSync,statSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import path from 'node:path';
import {acquireDataLock} from './dataLock';
import {ImportStore} from './importStore';
import {importFileLimit} from '../shared/dataImport';

// A bounded local file workflow for larger source packages; never changes the analysis source.
function main(){
 const args=process.argv.slice(2),operation=args.shift();
 const values:Record<string,string>={};
 while(args.length){const key=args.shift()!,value=args.shift();if(!['--file','--report','--data-dir'].includes(key)||!value||Object.hasOwn(values,key))throw Error('參數不正確。請使用 validate 或 stage，搭配 --file、--report 及選用 --data-dir。');values[key]=value}
 if(operation!=='validate'&&operation!=='stage')throw Error('用法：npm run data:import -- validate|stage --file 匯入包.json --report 檢查報告.json [--data-dir 資料目錄]');
 if(!values['--file']||!values['--report'])throw Error('必須明確指定匯入檔案與報告輸出路徑。');
 const file=path.resolve(values['--file']),output=path.resolve(values['--report']),directory=path.resolve(values['--data-dir']||process.env.TWSTOCKRS_DATA_DIR||'.local-data'),database=path.join(directory,'imports.sqlite');
 if(file===output||output===database||output.endsWith('.sqlite')||existsSync(output))throw Error('報告路徑必須是新的檔案，不可覆寫來源、資料庫或既有報告。');
 if(statSync(file).size>importFileLimit)throw Error('匯入檔超過 512 MiB，請依市場與日期拆批。');
 const bytes=readFileSync(file);if(bytes.length>importFileLimit)throw Error('讀取時檔案超過大小限制。');
 const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),unlock=operation==='stage'?acquireDataLock(directory):()=>{};
 try{const store=new ImportStore(operation==='validate'?':memory:':database);try{
  const validation=store.validate(text);mkdirSync(path.dirname(output),{recursive:true});
  // Finish the report before a durable write, so failure to save the report cannot stage a batch.
  writeFileSync(output,JSON.stringify(validation.report,null,2),{encoding:'utf8',flag:'wx'});
  const result=operation==='stage'?store.stage(text,validation.report.sha256):{staged:false,report:validation.report};
  console.log(JSON.stringify({operation,ok:result.report.ok,staged:result.staged,batch_id:result.report.batch_id,errors:result.report.error_count,report:output,...('notice' in result?{notice:result.notice}:{})},null,2));
  if(!result.report.ok)process.exitCode=2;
 }finally{store.close()}}finally{unlock()}
}
try{main()}catch(error){console.error(error instanceof Error?error.message:'匯入未完成。');process.exitCode=1}
