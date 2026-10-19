import './app/globals.css';
import {createRoot} from 'react-dom/client';
import FrozenSharePage from './components/twstock/FrozenSharePage';
try{const embedded=JSON.parse(document.getElementById('frozen-snapshot')!.textContent!);createRoot(document.getElementById('root')!).render(<FrozenSharePage embedded={embedded}/>)}catch{document.getElementById('root')!.textContent='凍結快照資料無法讀取，未載入替代結果。'}
