import type {Entity} from './model';
// Names only: preserve stable sector IDs, membership intervals and source records.
const twse:Record<string,string>={'01':'水泥工業','02':'食品工業','03':'塑膠工業','04':'紡織纖維','05':'電機機械','06':'電器電纜','08':'玻璃陶瓷','09':'造紙工業','10':'鋼鐵工業','11':'橡膠工業','12':'汽車工業','14':'建材營造','15':'航運業','16':'觀光餐旅','17':'金融保險','18':'貿易百貨','19':'綜合','20':'其他','21':'化學工業','22':'生技醫療業','23':'油電燃氣業','24':'半導體業','25':'電腦及週邊設備業','26':'光電業','27':'通信網路業','28':'電子零組件業','29':'電子通路業','30':'資訊服務業','31':'其他電子業','35':'綠能環保','36':'數位雲端','37':'運動休閒','38':'居家生活'};
const tpex:Record<string,string>={...Object.fromEntries(Object.entries(twse).filter(([code])=>!['01','09','12','19'].includes(code))),'17':'金融業','32':'文化創意業','33':'農業科技','34':'電子商務'};
export function officialSectorName(entity:Entity,date?:string):string{
 if(entity.kind!=='sector')return entity.name;
 const match=/^(twse|tpex):sector:([0-9]{2})$/.exec(entity.id);if(!match||match[1]!==entity.market.toLowerCase())return entity.name;
 const code=match[2];
 if(date&&date<'2023-07-03'){
  if(code==='16')return '觀光事業';
  if(['35','36','37','38'].includes(code))return entity.name;
  if(match[1]==='tpex'&&code==='33')return entity.name;
 }
 return (match[1]==='twse'?twse:tpex)[code]||entity.name;
}
