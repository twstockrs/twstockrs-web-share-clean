import {createInterface} from 'node:readline/promises';
import {Writable} from 'node:stream';
import {validateBackupPassphrase} from './encryptedBackup';

export async function backupPassphrase(confirm:boolean):Promise<string>{
 if(!process.stdin.isTTY){
  const chunks:Buffer[]=[];let bytes=0;
  for await(const chunk of process.stdin){bytes+=Buffer.byteLength(chunk);if(bytes>4096)throw Error('備份密碼輸入超過上限。');chunks.push(Buffer.from(chunk))}
  const encoded=Buffer.concat(chunks);let value:unknown;
  try{const parsed=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(encoded));if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||Object.keys(parsed).join(',')!=='password')throw Error();value=parsed.password}catch{throw Error('標準輸入只接受有效UTF-8且只含password欄位的JSON物件，密碼不會顯示。')}finally{encoded.fill(0);for(const c of chunks)c.fill(0)}
  validateBackupPassphrase(value);return value;
 }
 const sink=new Writable({write(_chunk,_encoding,done){done()}}),reader=createInterface({input:process.stdin,output:sink,terminal:true});
 try{if(confirm)process.stderr.write('備份密碼遺失便無法解密；請與備份分開妥善保存。\n');process.stderr.write('輸入備份密碼（不顯示）：');const value=await reader.question('');process.stderr.write('\n');validateBackupPassphrase(value);if(confirm){process.stderr.write('再次輸入備份密碼（不顯示）：');const again=await reader.question('');process.stderr.write('\n');if(value!==again)throw Error('兩次備份密碼不相同。')}return value}finally{reader.close()}
}
