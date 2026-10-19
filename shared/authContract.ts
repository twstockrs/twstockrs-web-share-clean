import type {Plan} from '../components/twstock/model';
export type AuthSession={owner:string;account:{id:string;username:string;role:'user'|'admin'}|null;plan:Plan;rights:string;csrf:string;expires_at:number;pro_until:number|null;legacy_unclaimed:boolean};
export function decodeAuthSession(v:unknown):AuthSession{
 const s=v as AuthSession;
 if(!s||typeof s!=='object'||!/^(account|guest)-[a-f0-9-]{36}$/.test(s.owner)||!['Anonymous','Free','Pro'].includes(s.plan)||typeof s.rights!=='string'||!/^\d+:(Anonymous|Free|Pro)$/.test(s.rights)||typeof s.csrf!=='string'||!/^[a-f0-9]{64}$/.test(s.csrf)||!Number.isSafeInteger(s.expires_at)||typeof s.legacy_unclaimed!=='boolean'||s.pro_until!==null&&!Number.isSafeInteger(s.pro_until))throw Error('帳號工作階段格式不正確。');
 const invalidAccount=s.account===null
  ?s.plan!=='Anonymous'||!s.owner.startsWith('guest-')
  :!s.account||typeof s.account!=='object'||!/^account-[a-f0-9-]{36}$/.test(s.account.id)||s.account.id!==s.owner||s.plan==='Anonymous'||!['user','admin'].includes(s.account.role)||typeof s.account.username!=='string'||! /^[a-z0-9][a-z0-9._-]{2,63}$/.test(s.account.username);
 if(s.rights.split(':')[1]!==s.plan||invalidAccount)throw Error('帳號身分與權益不一致。');
 return s;
}
