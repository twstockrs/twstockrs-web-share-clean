import {createCipheriv,createDecipheriv,createHash,randomBytes,randomUUID,scryptSync} from 'node:crypto';
import {constants,openSync,closeSync,readSync,writeSync,fsyncSync,fstatSync,lstatSync,existsSync,linkSync,copyFileSync,unlinkSync} from 'node:fs';
import path from 'node:path';

// Version 1 fixes the algorithms and KDF budget; untrusted files cannot request arbitrary work.
const magic=Buffer.from('TWSTOCKRS-ENCRYPTED-BACKUP-1\n'),plainMagic=Buffer.from('TWSTOCKRS-BACKUP-1\n');
const headerBytes=magic.length+16+12+8,tagBytes=16,maxPlain=4*1024**3,chunkBytes=1024*1024;
const kdf={N:131072,r:8,p:1,maxmem:256*1024*1024};
export const encryptedBackupPolicy={format:'TWStockRS-encrypted-backup',version:1,cipher:'AES-256-GCM',kdf:'scrypt',N:kdf.N,r:kdf.r,p:kdf.p,salt_bytes:16,iv_bytes:12,tag_bytes:tagBytes,max_plaintext_bytes:maxPlain} as const;
export function validateBackupPassphrase(value:unknown):asserts value is string{
 if(typeof value!=='string'||[...value].length<12||Buffer.byteLength(value,'utf8')>1024||/[\u0000-\u001f\u007f\ud800-\udfff]/u.test(value))throw Error('備份密碼至少12個字元、最多1024個UTF-8位元組，不接受控制字元。');
}
function checkedPath(file:string){const resolved=path.resolve(file);let current=path.parse(resolved).root;for(const part of resolved.slice(current.length).split(path.sep).filter(Boolean)){current=path.join(current,part);if(existsSync(current)&&lstatSync(current).isSymbolicLink())throw Error('加密備份路徑不可包含連結。')}return resolved}
function inputFile(file:string){const resolved=checkedPath(file),before=lstatSync(resolved);if(!before.isFile())throw Error('備份來源必須是一般檔案。');const fd=openSync(resolved,constants.O_RDONLY|(constants.O_NOFOLLOW||0));try{const stat=fstatSync(fd);if(!stat.isFile()||stat.dev!==before.dev||stat.ino!==before.ino)throw Error('備份來源在開啟時變更。');return {fd,stat}}catch(e){closeSync(fd);throw e}}
function readExact(fd:number,bytes:number,position:number){const data=Buffer.alloc(bytes);let offset=0;while(offset<bytes){const n=readSync(fd,data,offset,bytes-offset,position+offset);if(!n)throw Error('備份檔提前結束。');offset+=n}return data}
function writeAll(fd:number,data:Buffer){let offset=0;while(offset<data.length)offset+=writeSync(fd,data,offset,data.length-offset,null)}
function unchanged(fd:number,original:ReturnType<typeof fstatSync>){const now=fstatSync(fd);if(now.size!==original.size||now.mtimeMs!==original.mtimeMs||now.ctimeMs!==original.ctimeMs)throw Error('備份來源在處理時變更。')}
function derived(password:string,salt:Buffer){validateBackupPassphrase(password);const bytes=Buffer.from(password,'utf8');try{return scryptSync(bytes,salt,32,kdf)}finally{bytes.fill(0)}}
function newOutput(file:string,extension:string){if(!file.endsWith(extension))throw Error('輸出檔名必須以'+extension+'結尾，避免私人備份誤入公開檔案。');const output=checkedPath(file);if(existsSync(output))throw Error('輸出必須是新檔案，不覆寫既有檔案。');const parent=lstatSync(path.dirname(output));if(!parent.isDirectory())throw Error('輸出目錄不存在。');return output}
function digestFile(fd:number,size:number){const h=createHash('sha256');for(let pos=0;pos<size;pos+=chunkBytes)h.update(readExact(fd,Math.min(chunkBytes,size-pos),pos));return h.digest('hex')}
function publish(stage:string,output:string){try{linkSync(stage,output)}catch(e){if(!['ENOTSUP','EOPNOTSUPP','EPERM','EXDEV','ENOSYS'].includes((e as NodeJS.ErrnoException).code||''))throw e;copyFileSync(stage,output,constants.COPYFILE_EXCL)}}
function withOutput<T>(output:string,action:(fd:number)=>T){const stage=output+'.partial-'+randomUUID();let fd:number|undefined,created=false;try{fd=openSync(stage,'wx',0o600);created=true;const result=action(fd);fsyncSync(fd);closeSync(fd);fd=undefined;publish(stage,output);return result}finally{if(fd!==undefined)closeSync(fd);if(created&&existsSync(stage))unlinkSync(stage)}}
export function encryptBackupFile(source:string,destination:string,password:string){
 validateBackupPassphrase(password);const output=newOutput(destination,'.twrsbackup.enc'),input=inputFile(source);let key:Buffer|undefined;
 try{
  const size=input.stat.size;if(size<plainMagic.length||size>maxPlain||!readExact(input.fd,plainMagic.length,0).equals(plainMagic))throw Error('來源不是支援的完整後端備份；不處理清單JSON或其他檔案。');
  const salt=randomBytes(16),iv=randomBytes(12),length=Buffer.alloc(8);length.writeBigUInt64BE(BigInt(size));const header=Buffer.concat([magic,salt,iv,length]);key=derived(password,salt);
  const result=withOutput(output,fd=>{const cipher=createCipheriv('aes-256-gcm',key!,iv,{authTagLength:tagBytes});cipher.setAAD(header);const h=createHash('sha256').update(header);writeAll(fd,header);for(let pos=0;pos<size;pos+=chunkBytes){const plain=readExact(input.fd,Math.min(chunkBytes,size-pos),pos);try{const encoded=cipher.update(plain);writeAll(fd,encoded);h.update(encoded)}finally{plain.fill(0)}}const tail=cipher.final(),tag=cipher.getAuthTag();writeAll(fd,tail);writeAll(fd,tag);h.update(tail).update(tag);unchanged(input.fd,input.stat);return {sha256:h.digest('hex'),bytes:headerBytes+size+tagBytes}});
  return {...result,file:output,encrypted:true,policy:encryptedBackupPolicy};
 }finally{key?.fill(0);closeSync(input.fd)}
}
export function decryptBackupFile(source:string,destination:string,password:string){
 validateBackupPassphrase(password);const output=newOutput(destination,'.twrsbackup'),input=inputFile(source);let key:Buffer|undefined;
 try{
  if(input.stat.size<headerBytes+plainMagic.length+tagBytes||input.stat.size>headerBytes+maxPlain+tagBytes)throw Error('加密備份大小不合法。');
  const header=readExact(input.fd,headerBytes,0);if(!header.subarray(0,magic.length).equals(magic))throw Error('不是支援的加密完整備份。');
  const size64=header.readBigUInt64BE(headerBytes-8);if(size64<BigInt(plainMagic.length)||size64>BigInt(maxPlain)||size64+BigInt(headerBytes+tagBytes)!==BigInt(input.stat.size))throw Error('加密備份長度不合法。');
  const size=Number(size64),salt=header.subarray(magic.length,magic.length+16),iv=header.subarray(magic.length+16,magic.length+28),tag=readExact(input.fd,tagBytes,headerBytes+size);key=derived(password,salt);
  // Verify authentication before creating any plaintext file. The second pass verifies again before publication.
  function pass(fd?:number){const decipher=createDecipheriv('aes-256-gcm',key!,iv,{authTagLength:tagBytes});decipher.setAAD(header);decipher.setAuthTag(tag);let prefix=Buffer.alloc(0);try{for(let pos=0;pos<size;pos+=chunkBytes){const decoded=decipher.update(readExact(input.fd,Math.min(chunkBytes,size-pos),headerBytes+pos));try{if(pos===0)prefix=Buffer.from(decoded.subarray(0,plainMagic.length));if(fd!==undefined)writeAll(fd,decoded)}finally{decoded.fill(0)}}const tail=decipher.final();try{if(fd!==undefined)writeAll(fd,tail)}finally{tail.fill(0)}if(!prefix.equals(plainMagic))throw Error('Authenticated payload is not a complete backup');unchanged(input.fd,input.stat)}catch{throw Error('密碼不正確、檔案已損毀或來源已變更；未發布解密檔案。')}finally{prefix.fill(0)}}
  pass();const encryptedSha256=digestFile(input.fd,input.stat.size);unchanged(input.fd,input.stat);
  withOutput(output,fd=>pass(fd));
  return {file:output,bytes:size,encrypted_sha256:encryptedSha256,authenticated:true,notice:'已驗證密碼與檔案完整性。解密後為未加密備份，請妥善保存。'};
 }finally{key?.fill(0);closeSync(input.fd)}
}
