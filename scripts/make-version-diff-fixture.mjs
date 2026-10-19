import {makeRsFixture} from './make-rs-fixture.mjs';
// Reproducible synthetic revisions for version-difference QA; no real holiday or company action.
export function makeComparisonFixtures({from='2022-10-03',count=20}={}){
 const a=makeRsFixture({from,count}),b=makeRsFixture({from,count,to:'2026-09-28',revision:2});
 b.manifest.batch_id='version-diff-synthetic-v2';
 b.securities=b.securities.filter(s=>s.security_id!=='DEMO1');b.market_periods=b.market_periods.filter(s=>s.security_id!=='DEMO1');b.memberships=b.memberships.filter(s=>s.security_id!=='DEMO1');b.prices=b.prices.filter(s=>s.security_id!=='DEMO1');
 b.securities.find(s=>s.security_id==='2308').name='測試 台達電（名稱修訂）';
 const change='2026-09-01';b.memberships.find(m=>m.security_id==='2330').valid_to=change;b.memberships.push({security_id:'2330',sector_id:'S2',valid_from:change,valid_to:null});
 b.market_periods.find(m=>m.security_id==='6001').valid_to=change;b.market_periods.push({segment_id:'seg-6001-transfer-test',security_id:'6001',market:'TWSE',valid_from:change,valid_to:null});b.memberships.find(m=>m.security_id==='6001').valid_to=change;b.memberships.push({security_id:'6001',sector_id:'S2',valid_from:change,valid_to:null});for(const row of b.prices)if(row.security_id==='6001'&&row.date>=change)row.market='TWSE';
 b.sectors.push({sector_id:'S7',market:'TWSE',name:'合成新增產業'});b.securities.push({security_id:'synthetic:new',code:'9998',name:'合成新增證券',kind:'stock'});b.market_periods.push({segment_id:'seg-synthetic-new',security_id:'synthetic:new',market:'TWSE',valid_from:'2026-09-24',valid_to:null});b.memberships.push({security_id:'synthetic:new',sector_id:'S7',valid_from:'2026-09-24',valid_to:null});
 for(const date of ['2026-09-24','2026-09-25','2026-09-28'])b.prices.push({security_id:'synthetic:new',market:'TWSE',date,status:'traded',raw_close:120,adjusted_close:119,volume:50,reason:null});
 const noTrade=b.prices.find(p=>p.security_id==='2454'&&p.date==='2026-09-25');Object.assign(noTrade,{status:'no_trade',raw_close:null,adjusted_close:null,volume:0,reason:'合成測試：確認無成交，並非真實台股事件'});
 b.calendar.find(d=>d.market==='TWSE'&&d.date==='2026-09-21').is_open=false;b.prices=b.prices.filter(p=>!(p.market==='TWSE'&&p.date==='2026-09-21'));
 return {a,b};
}
