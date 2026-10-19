// TWSE 2026 scheduled closures. Source checked 2026-10-09:
// https://www.twse.com.tw/holidaySchedule/holidaySchedule?queryYear=115&response=html
// Only the explicitly available mock dates are selectable; this is not a live calendar feed.
export const marketHolidays:Record<string,string>={
 '2026-01-01':'元旦',
 '2026-02-12':'春節前市場無交易','2026-02-13':'春節前市場無交易',
 '2026-02-15':'春節','2026-02-16':'春節','2026-02-17':'春節','2026-02-18':'春節','2026-02-19':'春節','2026-02-20':'春節補假',
 '2026-02-27':'和平紀念日補假','2026-02-28':'和平紀念日',
 '2026-04-03':'兒童節補假','2026-04-04':'兒童節','2026-04-05':'清明節','2026-04-06':'清明節補假',
 '2026-05-01':'勞動節','2026-06-19':'端午節',
 '2026-09-25':'中秋節','2026-09-28':'教師節',
 '2026-10-09':'國慶日補假','2026-10-10':'國慶日','2026-10-25':'光復節','2026-10-26':'光復節補假','2026-12-25':'行憲紀念日'
};
export function marketClosedReason(date:string){
 if(marketHolidays[date])return marketHolidays[date]+'休市';
 const day=new Date(date+'T12:00:00+08:00').getUTCDay();
 return day===0||day===6?'週末休市':'';
}
export function periodForFrequency(period:string,frequency:string){return `${parseInt(period,10)}${frequency==='Weekly'?'W':'D'}`}
