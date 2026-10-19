import {createHash,createHmac,randomBytes,randomUUID,scrypt,timingSafeEqual} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {AnalysisError} from '../shared/mockAnalysis';
import {emptyLibrary,exactFields} from '../shared/libraryContract';
import type {AuthSession} from '../shared/authContract';
type Account={account_id:string;username:string;password_hash:string;role:'admin'|'user';enabled:number;grant_plan:'Free'|'Pro';pro_until:number|null;revision:number;created_at:number};
type SessionRow={token_hash:string;owner:string;account_id:string|null;created_at:number;idle_until:number;expires_at:number};
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export const authLimits={loginPerMinute:30,sessionsPerMinute:60,attemptRows:512} as const;
const loginBudget=hash('\0TWStockRS-login-budget-v1'),sessionBudget=hash('\0TWStockRS-session-budget-v1');
const denied=(code:string,message:string,status=403):never=>{throw new AnalysisError(code,message,status)};
export const validUsername=(s:unknown):s is string=>typeof s==='string'&&/^[a-z0-9][a-z0-9._-]{2,63}$/.test(s);
export function validPassword(s:unknown):asserts s is string{if(typeof s!=='string'||Array.from(s).length<15||Array.from(s).length>128||Buffer.byteLength(s)>512||/[\u0000-\u001f]/.test(s))denied('INVALID_PASSWORD','密碼須為 15–128 個字元，可使用空格與中文。',422)}
const derive=(password:string,salt:string)=>new Promise<Buffer>((resolve,reject)=>scrypt(password,salt,64,{N:131072,r:8,p:1,maxmem:256*1024*1024},(error,key)=>error?reject(error):resolve(key)));
export async function passwordHash(password:string){validPassword(password);const salt=randomBytes(16).toString('hex');return 'scrypt$131072$8$1$'+salt+'$'+(await derive(password,salt)).toString('hex')}
export const passwordHashPattern=/^scrypt\$131072\$8\$1\$[a-f0-9]{32}\$[a-f0-9]{128}$/;
async function verifyPassword(password:string,encoded:string){const parts=encoded.split('$'),salt=passwordHashPattern.test(encoded)?parts[4]:'0'.repeat(32),expected=passwordHashPattern.test(encoded)?Buffer.from(parts[5],'hex'):Buffer.alloc(64);const actual=await derive(password,salt);return timingSafeEqual(actual,expected)&&passwordHashPattern.test(encoded)}
export class AuthStore{
 private hashing=false;
 readonly cookieName:string;
 constructor(private db:DatabaseSync,private now:()=>number=Date.now,private secureCookies=false){const row=db.prepare('SELECT instance FROM auth_config WHERE id=1').get();if(!row)throw Error('帳號設定遺失。');this.cookieName='twrs_session_'+String(row.instance).replaceAll('-','').slice(0,12)}
 private transaction<T>(fn:()=>T):T{this.db.exec('BEGIN IMMEDIATE');try{const value=fn();this.db.exec('COMMIT');return value}catch(e){this.db.exec('ROLLBACK');throw e}}
 private event(account:string|null,event:string){this.db.prepare('INSERT INTO auth_events (at,account_id,event) VALUES (?,?,?)').run(this.now(),account,event);this.db.exec('DELETE FROM auth_events WHERE event_id < COALESCE((SELECT event_id FROM auth_events ORDER BY event_id DESC LIMIT 1 OFFSET 999),0)')}
 private workspace(owner:string,plan:string){this.db.prepare('INSERT OR IGNORE INTO workspace VALUES (?,1,?,NULL,NULL,?)').run(owner,plan,JSON.stringify(emptyLibrary()))}
 private budget(key:string,limit:number,code:string,message:string){
  const now=this.now();this.db.prepare('DELETE FROM auth_attempts WHERE until_at<=?').run(now);
  const row=this.db.prepare('SELECT failures,until_at FROM auth_attempts WHERE key=?').get(key);
  if(row&&Number(row.failures)>=limit)denied(code,message,429);
  if(!row&&Number(this.db.prepare('SELECT COUNT(*) AS n FROM auth_attempts').get()!.n)>=authLimits.attemptRows)denied(code,message,429);
  this.db.prepare('INSERT INTO auth_attempts VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET failures=failures+1').run(key,now+60_000);
 }
 private cookie(request:IncomingMessage){const entries=(request.headers.cookie||'').split(';').map(s=>s.trim()).filter(s=>s.startsWith(this.cookieName+'='));if(entries.length!==1)return '';const token=entries[0].slice(this.cookieName.length+1);return /^[A-Za-z0-9_-]{43}$/.test(token)?token:''}
 private writeCookie(response:ServerResponse,token:string,expires:number){response.setHeader('Set-Cookie',`${this.cookieName}=${token}; Path=/api/v1; HttpOnly; SameSite=Strict; ${this.secureCookies?'Secure; ':''}Max-Age=${Math.max(0,Math.floor((expires-this.now())/1000))}`)}
 private create(response:ServerResponse,account:Account|null){
  const token=randomBytes(32).toString('base64url'),owner=account?.account_id||'guest-'+randomUUID(),now=this.now(),expires=now+(account?12*3600000:30*86400000),idle=now+(account?30*60000:7*86400000);
  this.db.prepare('DELETE FROM auth_sessions WHERE expires_at<=? OR idle_until<=?').run(now,now);
  this.db.exec("DELETE FROM workspace WHERE owner LIKE 'guest-%' AND owner NOT IN (SELECT owner FROM auth_sessions) AND owner NOT IN (SELECT owner FROM share_owners) AND owner NOT IN (SELECT owner FROM library_recovery)");
  if(Number(this.db.prepare('SELECT count(*) AS n FROM auth_sessions').get()!.n)>=1024)denied('SESSION_LIMIT','工作階段數已達本機上限，請稍後再試。',429);
  this.budget(sessionBudget,authLimits.sessionsPerMinute,'SESSION_RATE_LIMIT','建立工作階段過於頻繁，請稍後再試。');
  this.workspace(owner,account?this.plan(account):'Anonymous');this.db.prepare('INSERT INTO auth_sessions VALUES (?,?,?,?,?,?)').run(hash(token),owner,account?.account_id||null,now,idle,expires);this.writeCookie(response,token,expires);
  return this.resolveToken(token)!;
 }
 private plan(a:Account){return a.grant_plan==='Pro'&&a.pro_until!==null&&a.pro_until>this.now()?'Pro' as const:'Free' as const}
 private resolveToken(token:string){
  if(!token)return null;const row=this.db.prepare('SELECT * FROM auth_sessions WHERE token_hash=?').get(hash(token)) as SessionRow|undefined,now=this.now();if(!row||row.idle_until<=now||row.expires_at<=now)return null;
  const account=row.account_id?this.db.prepare('SELECT * FROM accounts WHERE account_id=?').get(row.account_id) as Account|undefined:null;if(row.account_id&&(!account||!account.enabled))return null;
  const plan=account?this.plan(account):'Anonymous',timeout=account?30*60000:7*86400000;if(row.idle_until<Math.min(row.expires_at,now+timeout-60000))this.db.prepare('UPDATE auth_sessions SET idle_until=? WHERE token_hash=?').run(Math.min(row.expires_at,now+timeout),row.token_hash);
  const session:AuthSession={owner:row.owner,account:account?{id:account.account_id,username:account.username,role:account.role}:null,plan,rights:`${account?.revision||0}:${plan}`,csrf:createHmac('sha256',token).update('TWStockRS-CSRF-v1').digest('hex'),expires_at:row.expires_at,pro_until:account?.pro_until||null,legacy_unclaimed:account?.role==='admin'&&(()=>{const legacy=this.db.prepare("SELECT contents FROM workspace WHERE owner='local-workspace'").get();return !!legacy&&(legacy.contents!==JSON.stringify(emptyLibrary())||!!this.db.prepare("SELECT token FROM share_owners WHERE owner='local-workspace' LIMIT 1").get()||!!this.db.prepare("SELECT owner FROM library_recovery WHERE owner='local-workspace'").get())})()};
  return {session,row,token};
 }
 resolve(request:IncomingMessage){return this.resolveToken(this.cookie(request))}
 session(request:IncomingMessage,response:ServerResponse){
  // A guest's cleanup, budget, workspace and session are one durable commit.
  // Login already calls create inside its own transaction.
  return (this.resolve(request)||this.transaction(()=>this.create(response,null))).session;
 }
 guard(request:IncomingMessage,write=false,admin=false,expectedOwner?:string){
  const value=this.resolve(request);if(!value)denied('SESSION_EXPIRED','工作階段已失效，請重新確認登入狀態。',401);
  const s=value!.session;if(expectedOwner&&s.owner!==expectedOwner||request.headers['x-workspace-id']!==s.owner||request.headers['x-auth-rights']!==s.rights)denied('AUTH_CHANGED','帳號或方案已變更，請重新讀取；未套用到其他帳號。',409);
  if(write){const csrf=request.headers['x-csrf-token'];if(typeof csrf!=='string'||csrf.length!==64||!timingSafeEqual(Buffer.from(hash(csrf),'hex'),Buffer.from(hash(s.csrf),'hex')))denied('CSRF_REJECTED','操作驗證已失效，請重新讀取頁面。')}
  if(admin&&s.account?.role!=='admin')denied('ADMIN_REQUIRED','這項資料維護操作僅限本機管理員。');return s;
 }
 adminDownload(request:IncomingMessage,expected?:AuthSession){const s=this.resolve(request)?.session;if(!s?.account||s.account.role!=='admin')denied('ADMIN_REQUIRED','完整服務備份僅限本機管理員。');if(expected&&(s!.owner!==expected.owner||s!.rights!==expected.rights))denied('AUTH_CHANGED','帳號或方案已變更，請重新讀取；未傳送備份。',409);return s!}
 async login(request:IncomingMessage,response:ServerResponse,value:unknown){
  exactFields(value,['username','password'],['claim_guest_shares']);const before=this.guard(request,true);
  if(typeof value.username!=='string'||typeof value.password!=='string'||Buffer.byteLength(value.password)>512||value.username.length>64||value.claim_guest_shares!==undefined&&typeof value.claim_guest_shares!=='boolean')denied('LOGIN_FAILED','帳號或密碼不正確。',401);
  const username=(value.username as string).trim().toLowerCase();if(!validUsername(username))denied('LOGIN_FAILED','帳號或密碼不正確。',401);
  const key=hash(username),now=this.now(),attempt=this.db.prepare('SELECT * FROM auth_attempts WHERE key=?').get(key);
  if(attempt&&Number(attempt.until_at)>now&&Number(attempt.failures)>=5)denied('LOGIN_RATE_LIMIT','登入嘗試過多，請十五分鐘後再試。',429);
  if(this.hashing)denied('LOGIN_BUSY','另一個登入驗證進行中，請稍後重試。',429);
  this.transaction(()=>{
   this.budget(loginBudget,authLimits.loginPerMinute,'LOGIN_SERVICE_LIMIT','登入服務忙碌，請一分鐘後再試。');
   const active=this.db.prepare('SELECT failures FROM auth_attempts WHERE key=?').get(key);
   if(!active&&Number(this.db.prepare('SELECT COUNT(*) AS n FROM auth_attempts').get()!.n)>=authLimits.attemptRows)denied('LOGIN_SERVICE_LIMIT','登入服務忙碌，請一分鐘後再試。',429);
   // Reserve before the expensive password check. Successful login clears only this account's row.
   this.db.prepare('INSERT INTO auth_attempts VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET failures=failures+1').run(key,now+15*60000);
  });
  this.hashing=true;let account:Account|undefined,ok=false;try{account=this.db.prepare('SELECT * FROM accounts WHERE username=?').get(username) as Account|undefined;ok=await verifyPassword(value.password as string,account?.password_hash||'')}finally{this.hashing=false}
  this.guard(request,true,false,before.owner);
  const latest=account?this.db.prepare('SELECT * FROM accounts WHERE account_id=?').get(account.account_id) as Account|undefined:undefined;
  if(!ok||!latest?.enabled||latest.password_hash!==account?.password_hash){this.event(null,'login_failed');denied('LOGIN_FAILED','帳號或密碼不正確。',401)}
  return this.transaction(()=>{if(value.claim_guest_shares&&before.account)denied('INVALID_CLAIM','只能接收本次匿名工作階段的分享。',422);if(value.claim_guest_shares)this.db.prepare('UPDATE share_owners SET owner=? WHERE owner=?').run(latest!.account_id,before.owner);this.db.prepare('DELETE FROM auth_attempts WHERE key=?').run(key);this.db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(hash(this.cookie(request)));this.event(latest!.account_id,'login');return this.create(response,latest!).session});
 }
 logout(request:IncomingMessage,response:ServerResponse,all=false){const s=this.guard(request,true);this.transaction(()=>{if(all&&s.account)this.db.prepare('DELETE FROM auth_sessions WHERE account_id=?').run(s.account.id);else this.db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(hash(this.cookie(request)));this.event(s.account?.id||null,all?'logout_all':'logout')});this.writeCookie(response,'',this.now());return {ok:true}}
 async createAccount(username:string,password:string,role:'user'|'admin'='user',plan:'Free'|'Pro'='Free',proUntil:number|null=null,authorize:()=>void=()=>{},after?:()=>void){
  username=username.trim().toLowerCase();if(!validUsername(username)||!['user','admin'].includes(role)||!['Free','Pro'].includes(plan)||plan==='Pro'&&(!Number.isSafeInteger(proUntil)||proUntil!<=this.now()))denied('INVALID_ACCOUNT','帳號為 3–64 個英文小寫／數字／點／底線／減號；Pro 須指定未來到期時間。',422);
  authorize();const encoded=await passwordHash(password);authorize();return this.transaction(()=>{authorize();if(Number(this.db.prepare('SELECT count(*) AS n FROM accounts').get()!.n)>=512)denied('ACCOUNT_LIMIT','本機帳號數上限為 512。',429);if(this.db.prepare('SELECT account_id FROM accounts WHERE username=?').get(username))denied('ACCOUNT_EXISTS','帳號名稱已使用。',409);const id='account-'+randomUUID();this.db.prepare('INSERT INTO accounts VALUES (?,?,?,?,1,?,?,1,?)').run(id,username,encoded,role,plan,plan==='Pro'?proUntil:null,this.now());this.workspace(id,plan);if(after)after();else this.event(id,'account_created');return {id,username,role,plan,pro_until:proUntil}});
 }
 list(){return this.db.prepare('SELECT account_id,username,role,enabled,grant_plan,pro_until,revision FROM accounts ORDER BY username').all()}
 setAccount(username:string,change:{plan?:'Free'|'Pro';proUntil?:number|null;enabled?:boolean;passwordHash?:string},after?:()=>void){
  return this.transaction(()=>{const a=this.db.prepare('SELECT * FROM accounts WHERE username=?').get(username) as Account|undefined;if(!a)denied('ACCOUNT_NOT_FOUND','找不到帳號。',404);if(change.enabled===false&&a!.role==='admin'&&Number(this.db.prepare("SELECT count(*) AS n FROM accounts WHERE role='admin' AND enabled=1").get()!.n)<=1)denied('LAST_ADMIN','不能停用最後一個有效管理員。',422);
   const plan=change.plan||a!.grant_plan,until=change.plan==='Free'?null:change.proUntil??a!.pro_until;if(plan==='Pro'&&(change.plan==='Pro'||change.proUntil!==undefined)&&(!Number.isSafeInteger(until)||until!<=this.now()))denied('INVALID_ACCOUNT','Pro 須指定未來到期時間。',422);
   this.db.prepare('UPDATE accounts SET grant_plan=?,pro_until=?,enabled=?,password_hash=?,revision=revision+1 WHERE account_id=?').run(plan,until,change.enabled===undefined?a!.enabled:Number(change.enabled),change.passwordHash||a!.password_hash,a!.account_id);if(change.enabled===false||change.passwordHash)this.db.prepare('DELETE FROM auth_sessions WHERE account_id=?').run(a!.account_id);if(after)after();else this.event(a!.account_id,'account_updated');return {ok:true};
  });
 }
 revokeAccountSessions(username:string,after:()=>void){return this.transaction(()=>{const a=this.db.prepare('SELECT account_id FROM accounts WHERE username=?').get(username);if(!a)denied('ACCOUNT_NOT_FOUND','找不到帳號。',404);this.db.prepare('DELETE FROM auth_sessions WHERE account_id=?').run(a!.account_id);this.db.prepare('UPDATE accounts SET revision=revision+1 WHERE account_id=?').run(a!.account_id);after();return {ok:true}})}
 legacyPreview(username:string){const a=this.db.prepare('SELECT account_id FROM accounts WHERE username=?').get(username);if(!a)denied('ACCOUNT_NOT_FOUND','找不到目標帳號。',404);const legacy=this.db.prepare("SELECT * FROM workspace WHERE owner='local-workspace'").get();if(!legacy)denied('NO_LEGACY','沒有尚未歸屬的舊工作區。',404);const target=this.db.prepare('SELECT * FROM workspace WHERE owner=?').get(String(a!.account_id)),links=this.db.prepare("SELECT token FROM share_owners WHERE owner='local-workspace' ORDER BY token").all(),recovery=this.db.prepare("SELECT * FROM library_recovery WHERE owner='local-workspace'").get();return {username,shares:links.length,confirmation_token:hash(JSON.stringify({legacy,target,links,recovery})),notice:'把舊單一工作區全部清單、檢視與分享交給指定空帳號；不合併或覆寫非空帳號。'}}
 claimLegacy(username:string,confirmation:string){return this.transaction(()=>{if(confirmation!==this.legacyPreview(username).confirmation_token)denied('STALE_CLAIM','歸屬確認碼不符，請重新預覽。',409);const a=this.db.prepare('SELECT * FROM accounts WHERE username=?').get(username) as Account|undefined;if(!a)denied('ACCOUNT_NOT_FOUND','找不到目標帳號。',404);const legacy=this.db.prepare("SELECT * FROM workspace WHERE owner='local-workspace'").get(),target=this.db.prepare('SELECT * FROM workspace WHERE owner=?').get(a!.account_id);if(!legacy)denied('NO_LEGACY','沒有尚未歸屬的舊工作區。',404);if(!target||target.contents!==JSON.stringify(emptyLibrary())||this.db.prepare('SELECT token FROM share_owners WHERE owner=? LIMIT 1').get(a!.account_id)||this.db.prepare('SELECT owner FROM library_recovery WHERE owner=?').get(a!.account_id))denied('TARGET_NOT_EMPTY','目標帳號已有資料，未覆寫；請指定新的空帳號。',409);
   const revision=Math.max(Number(legacy!.revision),Number(target!.revision))+1;this.db.prepare('UPDATE workspace SET revision=?,plan=?,watch_choice=?,saved_choice=?,contents=? WHERE owner=?').run(revision,legacy!.plan,legacy!.watch_choice,legacy!.saved_choice,legacy!.contents,a!.account_id);this.db.prepare("UPDATE library_recovery SET owner=?,restored_revision=CASE WHEN restored_revision=? THEN ? ELSE restored_revision END WHERE owner='local-workspace'").run(a!.account_id,legacy!.revision,revision);this.db.prepare("UPDATE share_owners SET owner=? WHERE owner='local-workspace'").run(a!.account_id);this.db.prepare("DELETE FROM workspace WHERE owner='local-workspace'").run();this.event(a!.account_id,'legacy_claimed');return {ok:true,owner:a!.account_id}})}
}
