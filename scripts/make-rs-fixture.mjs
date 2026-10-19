import {writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
// Deterministic synthetic weekdays and prices. This is not an exchange calendar/feed.
export function makeRsFixture({count=20,from='2022-10-03',to='2026-09-27',revision=1}={}){
 const names=['半導體業','金融保險業','航運業','食品工業','水泥工業','電子零組件業'];
 const initial=[['2330','台積電',0],['2454','聯發科',0],['2308','台達電',5],['2881','富邦金',1],['2603','長榮',2],['1216','統一',3],['1101','台泥',4],['0050','台灣50測試ETF',0],['006208','台50測試ETF',0]];
 const securities=initial.map(([id,name])=>({security_id:id,code:id,name:`測試 ${name}`,kind:id.startsWith('00')?'etf':'stock'}));
 const assignments=initial.map(([id,,sector])=>[id,Number(sector)]);
 for(let i=securities.length;i<count;i++){const id=String(7000+i);securities.push({security_id:id,code:id,name:`合成個股 ${id}`,kind:'stock'});assignments.push([id,i%6])}
 securities.push({security_id:'5274',code:'5274',name:'測試 信驊',kind:'stock'},{security_id:'6001',code:'6001',name:'合成上櫃 6001',kind:'stock'},{security_id:'TAIEX',code:'TAIEX',name:'合成加權指數',kind:'index'},{security_id:'TPEX',code:'TPEX',name:'合成櫃買指數',kind:'index'},{security_id:'DEMO1',code:'9001',name:'合成新上市',kind:'stock'});
 const marketOf=s=>['5274','6001','TPEX'].includes(s.security_id)?'TPEx':'TWSE';
 const market_periods=securities.map(s=>({segment_id:`seg-${s.security_id}`,security_id:s.security_id,market:marketOf(s),valid_from:s.security_id==='DEMO1'?'2026-09-24':from,valid_to:null}));
 const sectors=names.map((name,i)=>({sector_id:`S${i+1}`,market:'TWSE',name}));sectors.push({sector_id:'ST1',market:'TPEx',name:names[0]});
 const memberships=securities.filter(s=>s.kind==='stock').map(s=>({security_id:s.security_id,sector_id:marketOf(s)==='TPEx'?'ST1':`S${(assignments.find(([id])=>id===s.security_id)?.[1]||0)+1}`,valid_from:market_periods.find(p=>p.security_id===s.security_id).valid_from,valid_to:null}));
 const calendar=[],prices=[];let observation=0;
 for(let n=Date.parse(from);n<=Date.parse(to);n+=86400000){const date=new Date(n).toISOString().slice(0,10),day=new Date(n).getUTCDay(),open=day!==0&&day!==6;for(const market of ['TWSE','TPEx'])calendar.push({market,date,is_open:open});if(!open)continue;
  for(const [i,s] of securities.entries()){if(date<market_periods[i].valid_from)continue;const suspended=s.security_id==='5274'&&date>='2026-09-23';
   const base=s.kind==='index'?10000:40+i*11,trend=1+observation*(.00025+(i%4)*.00004),wave=1+.08*Math.sin(observation/(13+i%7)+i)+.023*Math.cos(observation/(5+i%5));
   const raw=Number((base*trend*wave*(s.security_id==='2330'?1+(revision-1)*.005*Math.sin(observation/3):1)).toFixed(8)),adjusted=Number((raw*(date<'2025-01-01'?.83+.02*Math.sin(observation/80+i):1+.004*Math.sin(observation/60+i))).toFixed(8));
   prices.push({security_id:s.security_id,market:marketOf(s),date,status:suspended?'suspended':'traded',raw_close:suspended?null:raw,adjusted_close:suspended?null:adjusted,volume:suspended?0:s.kind==='index'?null:1000+i*7,reason:suspended?'合成情境：已確認停牌':null});
  }observation++;
 }
 return {format:'TWStockRS-price-import',version:1,manifest:{batch_id:`rs-core-synthetic-v${revision}`,dataset_kind:'test',source:'deterministic synthetic prices and weekday calendar; NOT Taiwan market data',source_version:`rs-fixture-v${revision}`,created_at:'2026-09-28T00:00:00.000Z',date_from:from,date_to:to,markets:['TWSE','TPEx'],timezone:'Asia/Taipei',currency:'TWD',adjustment:{method:'synthetic adjustment only; not corporate-action data',version:'test-v1',reference_date:to}},securities,market_periods,calendar,sectors,memberships,prices};
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===fileURLToPath(new URL(`file:///${process.argv[1].replaceAll('\\','/')}`))){
 const output=process.argv[2];if(!output)throw Error('Specify a new synthetic JSON output path.');writeFileSync(output,JSON.stringify(makeRsFixture())+'\n',{flag:'wx'});process.stdout.write('Synthetic RS fixture written.\n');
}
