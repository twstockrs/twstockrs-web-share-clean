import {createMockServer} from './app';
import path from 'node:path';
const port=Number(process.env.MOCK_API_PORT||8787);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('MOCK_API_PORT 須為 1024–65535。');
const dataDirectory=path.resolve(process.env.TWSTOCKRS_DATA_DIR||'.local-data');
const server=createMockServer({dataDirectory});
server.on('error',error=>{console.error(`本機 API 啟動失敗：${error.message}`);process.exitCode=1;server.close(()=>process.exit(1))});
server.listen(port,'127.0.0.1',()=>{console.log(`TWStockRS local API: http://127.0.0.1:${port}/api/v1/health（本機運算／帳號權限已啟用；尚未公開部署）`);process.send?.({type:'ready'})});
let stopping=false;function stop(){if(stopping)return;stopping=true;server.close(()=>process.exit())}
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,stop);
process.on('message',message=>{if(message&&typeof message==='object'&&'type' in message&&message.type==='stop')stop()});
