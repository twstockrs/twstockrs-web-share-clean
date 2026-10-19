import type {Plan} from '../components/twstock/model';
// Bounded protocol ceiling, independent of the RS Period/Trail window.
// The current four-year release contains fewer endpoints than this ceiling.
export const maxHistoryEndpoints=3661;
export const historyEndpointLimit=(plan:Plan,frequency:string)=>plan==='Pro'?maxHistoryEndpoints:frequency==='Weekly'?52:plan==='Anonymous'?10:60;
