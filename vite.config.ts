import {defineConfig} from 'vite';
const apiPort=Number(process.env.MOCK_API_PORT||8787);
const webPort=Number(process.env.MOCK_WEB_PORT||5173);
if(!Number.isInteger(apiPort)||apiPort<1024||apiPort>65535||!Number.isInteger(webPort)||webPort<1024||webPort>65535)throw Error('本機服務埠號須為 1024–65535。');
const proxy={'/api':{target:`http://127.0.0.1:${apiPort}`,changeOrigin:true}};
// Development also runs beside private databases. Never rely on dotfiles being hidden.
const deny=['.env','.env.*','*.{crt,pem,key,pfx}','**/.git/**','**/.local-data/**','**/*.sqlite','**/*.sqlite-*','**/*.twrsbackup*','**/*.twstockrs-lock','**/*.twstockrs-restore.json','**/restore-{history,state}.json','**/host.json','**/state.json','**/control.json','**/transition.json','**/backup-policy.json','**/auto-backup-{catalog,state}.json','**/monitor-{policy,state,receipts}.json','**/host-events.jsonl*'];
export default defineConfig({server:{host:'127.0.0.1',port:webPort,strictPort:true,proxy,fs:{deny}},preview:{host:'127.0.0.1',port:webPort,strictPort:true,proxy}});
