import {useEffect,useId,useRef,useState} from 'react';
import {X} from 'lucide-react';

export type HelpTopic='usage'|'data'|'csv'|'storage';
const topics:{id:HelpTopic;label:string}[]=[{id:'usage',label:'使用說明'},{id:'data',label:'資料說明'},{id:'csv',label:'CSV 欄位'},{id:'storage',label:'方案與儲存'}];
const csvFields=[
 ['viewing_date','整份分析的檢視截止日期，不是下載時間。'],
 ['frequency','Daily（日頻）或 Weekly（週頻）。'],
 ['market','TWSE（上市）或 TPEx（上櫃），一份分析只使用一個市場。'],
 ['entity','股票代號與名稱合併，例如 2330台積電；產業則使用產業名稱。前導零保留。'],
 ['benchmark','這一列實際使用的比較基準名稱。'],
 ['period','本次設定的計算期間；原型例如 60D，日／週單位隨 frequency 解讀。'],
 ['trail','設定最多顯示的有效點數，不一定等於實際匯出列數。'],
 ['price_type','Raw（原始價格）或 Adjusted（還原價格）。'],
 ['point_date','這個座標所屬的交易日，或完成週端點；空值狀態列留空。'],
 ['price_date','建立該點最新比值所用的共同取價日；啟用行情且來源有提供時輸出實際日期，沒有紀錄時留空，不推測或補造。'],
 ['rs_level','X 軸相對強弱數值，不是報酬率；無座標時留空。'],
 ['rs_momentum','Y 軸相對動能數值，不是漲跌幅；無座標時留空。'],
 ['quadrant','Leading／Weakening／Lagging／Improving；無座標時留空。'],
 ['status','下方六種資料狀態之一，依這一列所表達的範圍判斷。'],
 ['gap_before','true 表示與前一個可視有效點之間有缺口；false 表示一般連線；第一列或空值狀態列留空。']
];
const statusRows=[
 ['valid','有效結果','這一列有正常座標。較早歷史點仍可為有效結果。'],
 ['stale','資料較舊','沿用較早的最後合法點，不新增今天的座標，也不重複輸出一列。'],
 ['insufficient_history','歷史不足','尚未累積足夠的合法配對，無法形成完整座標。'],
 ['data_unavailable','資料未完成','必要資料缺漏或品質未通過，不能當成停牌或補成零。'],
 ['no_result','無結果','這一列代表的期間或當期端點沒有有效座標；不一定表示整段歷史都沒有點。'],
 ['inactive','已停用','該檢視日期已不在合法掛牌或市場期間。']
];
function Table({headers,rows}:{headers:string[];rows:string[][]}){return <div className="help-table-wrap"><table><thead><tr>{headers.map(h=><th key={h} scope="col">{h}</th>)}</tr></thead><tbody>{rows.map((row,index)=><tr key={index}>{row.map((cell,i)=>i===0?<th key={i} scope="row">{cell}</th>:<td key={i}>{cell}</td>)}</tr>)}</tbody></table></div>}
function Usage(){return <>
 <h3>從市場與比較基準開始</h3><p>Stock Move 是個股輪動；Sector Move 是產業輪動。先選上市 TWSE 或上櫃 TPEx，再選比較基準。切換市場會清空目前股票清單，請重新選股。</p>
 <p>個股模式可輸入代號、從產業選單勾選，或套用 Watchlist（觀察清單）。產業模式使用該市場全部有效產業，固定與市場基準比較，不挑產業子集。市場基準是比較對象，並不是另一份股票清單。</p>
 <h3>日期與期間怎麼看</h3><Table headers={['設定','意思']} rows={[
 ['Viewing Date 檢視日期','整張圖看到哪一天或哪個完成週。Latest 是所選市場與頻率最新可用端點，不一定是今天。'],
 ['Frequency 頻率','Daily 每個合法交易日一個端點；Weekly 只使用完成週。切換後 Period 的 D／W 單位同步改變。'],
 ['Period 計算期間','形成相對強弱與動能時使用的窗口長度，不是圖上圓點數。'],
 ['Trail 軌跡','目前最多顯示幾個有效座標；不足時不補點，且不得大於 Period。'],
 ['History 可回看範圍','正式產品可查看的端點範圍，錨定 Latest。越接近左界，可顯示的 Trail 可能越短。啟用價格版本後按市場及方案取得端點，無版本及離線模式仍使用十個示範日期。']
 ]}/><p>日／週頻各自記住 Period 與 Trail。Pro 可輸入整數或選常用值；輸入後按 Enter（確認鍵）或離開欄位套用，按 Esc（取消鍵）還原未套用的輸入。</p>
 <h3>圖表操作</h3><ul><li>滑鼠滾輪縮放，拖曳平移；Reset 回到目前可見路徑的完整範圍。</li><li>點選圓點或線段查看股票／產業明細，點空白處取消選取。拖曳不算空白點擊。</li><li>圓點保留目前軌跡的最初有效點與最新四點；不足五點就全部顯示。灰色小點是起點，最大點是最新點。</li><li>滑鼠停在每個點上，顯示該點自己的日期與數值；右側明細顯示截至檢視日期的最後有效值。</li><li>Filter（象限篩選）只隱藏圖上路徑，不刪除清單，也不縮減 CSV 匯出集合。標籤自動避讓；空間不足時隱藏重疊標籤，清單與路徑仍完整保留，可用滑鼠停留或選取辨識標的。</li><li>Pro 的 Play 從最新日期（含）回算 Trail 個真實觀測點，由舊到新顯示；暫停後接續原進度，播完再按則重新播放。檢視日期保持最新，座標範圍固定，線與點沿用最新端點的顏色。歷史不足只播放實際有效點，不補造點位。</li></ul>
 <p>桌面側欄可收合，展開仍保留縮放範圍。手機使用底部清單與明細面板；分析條件可在控制區內橫向捲動。</p>
 <h3>四象限表示什麼</h3><Table headers={['象限','相對位置']} rows={[
 ['Leading 領先','相對強弱較高，動能也較高。'],['Weakening 轉弱','相對強弱較高，動能較低。'],['Lagging 落後','相對強弱與動能都較低。'],['Improving 改善','相對強弱較低，動能較高。']
 ]}/><p>中心為 (0, 0)。這是標準化的相對位置，不是報酬率，也不代表股價一定上漲或下跌。</p>
</>}
function Data(){return <>
 <h3>資料版本與回復</h3><p>管理員可由「管理員維護」的資料版本分頁管理行情輸入版本，按市場預覽、建立、啟用及回復上一版。建立不會自動啟用；切換保留原資料與操作記錄。啟用後以該版價格實際運算 RS；測試包標示 TEST，來源資料標示 INPUT 並提醒品質尚待核對。尚未啟用版本時使用原內建示範。圖表連線狀態的提示可查看本次結果與輸入版本。</p>
 <h3>本機資料匯入</h3><p>管理員可由「管理員維護」的行情匯入分頁選擇符合內部格式的資料包，先查看錯誤報告，再確認保存。通過資料進入暫存區；另外建立並啟用版本後，圖表才使用該版價格運算。RS 合成運算包提供四年測試價格與合成日曆，不是真實台股資料。來源欄位、覆蓋率與品質應依實際匯入及驗收報告核對；INPUT 標記本身不代表來源品質已獨立驗證。離線 HTML 保留內建示範與瀏覽器儲存。</p>
 <h3>資料從哪裡取得</h3><p>一般本機預覽由後端提供分析結果，右側底部會顯示連線狀態。無法連線時不會悄悄切換資料來源；確認服務啟動後按「重試連線」。離線 HTML 則明確使用內建示範資料，不需要後端。</p>
 <h3>運算來源與示範模式</h3><p>啟用價格版本後使用 rs_v1 方法：先以同日股票／基準價格比值計算標準化相對強弱，再以相對強弱變化計算標準化相對動能。Period 為 p 時，非退化資料至少需要 2×p 筆配對才可能有第一個完整座標；不足時不補零。週頻獨立配對與計算，實際取價日可早於完成週端點。所有自建產業使用歷史完整合格成分等權，缺少必要成分資料不重新分配權重。</p><h3>無啟用版本／離線的原內建示範</h3><p>原型僅有 2026/09/11–09/24 的十個示範交易日；週頻只提供 09/11、09/18 兩個完成週端點。休市與無示範資料日期不可選，這不是即時交易日服務。</p>
 <p>Period、價格類型與頻率只改變示範座標；Benchmark（比較基準）切換尚未重算座標。原型週頻是挑選示範週端點，並非正式週頻運算。畫面與下載檔皆標示 DEMO，不代表真實市場結果。</p>
 <h3>資料狀態與缺口</h3><Table headers={['代碼','顯示','如何解讀']} rows={statusRows}/><p>灰色虛線只連接缺口前後的位置，不代表中間有可用觀測點，也不補零、補日期或產生新的象限轉換。原型長榮用兩筆缺值示範；信驊的最新有效示範點為 09/22，即使檢視 09/24，也保留原日期。</p>
 <h3>日期不同不一定是錯誤</h3><p>Viewing Date 是分析截止日；point_date 是座標日期；price_date 是建立該點最新比值所用的共同取價日。較舊結果保留真實日期，不改掛檢視日期。啟用行情後，CSV 的 price_date 依實際共同取價紀錄輸出；沒有紀錄的示範資料留空，不改掛檢視日期。</p>
 <details><summary>正式資料接入後的規則</summary><p>以下規則已在 RS 核心以合成資料驗證；實際來源適配及品質須依各資料版本核對。Daily 必須使用股票／產業與基準同一天、相容價格口徑的有效輸入；Weekly 先形成完成週的共同取價比值，再獨立計算，不能抽樣日頻座標。</p>
 <p>已確認停牌或合法無新輸入時，才可能沿用較早結果；來源漏失或品質未通過時，須顯示資料未完成，不能假裝停牌。若中間已出現未解除的無結果或資料中斷，不能再向前找舊點冒充較舊結果。</p>
 <p>週頻按完成週端點判斷市場資格；已在該端點前轉板或下市，不因週內較早仍有價格而建立原市場的新週點。轉入新市場後重新累積合法配對。</p>
 <p>TWStockRS 自建產業序列採合格成分股等權，不等同交易所官方產業指數。Raw 與 Adjusted 分別處理，資料來源、還原口徑與版本必須一致。</p>
 <p>個股使用自訂股票／ETF（指數股票型基金）基準，正式規則會檢查最近 240 個日頻端點、至少 95% 有效成交，以及最多連續三個合法無成交端點；來源不明缺漏不能算成無成交。股票與自己比較保留身分，但不提供結果。原型尚未驗證交易連續性。</p></details>
</>}
function Csv(){return <>
 <p>一般本機下載的 PNG／CSV 檔名帶結果版本及行情輸入版本，PNG 另印版本標記。下載前後會核對版本；另一分頁已切換時，先重新取得分析再匯出。CSV 仍維持十五欄。</p>
 <h3>下載的是本次合法軌跡</h3><p>CSV 是可由試算表讀取的文字表格，Pro 可用。每列代表一個標的的一個有效座標，或一列必要的空值狀態；依標的分組，各標的內按日期排列。這種長表格式不會把日期橫向展成欄位。</p>
 <p>股票模式使用目前清單，產業模式使用當期全市場產業，不展開成分股。匯出完整可用 Trail，不只五個圓點；Filter、選取、縮放與平移不縮減 CSV。PNG 圖片則保留當下的篩選與座標範圍。</p>
 <h3>固定十五欄</h3><Table headers={['欄位','說明']} rows={csvFields}/>
 <h3>空白與零有不同意思</h3><p>沒有座標時，point_date、price_date、兩項 RS 值、象限與缺口標記留空，不填 0。有效座標的 price_date 依來源紀錄輸出；沒有共同取價紀錄時仍留空，不以 point_date 代填。</p>
 <Table headers={['status','意思','列的範圍']} rows={statusRows.map(([code,label,meaning])=>[code,label,meaning])}/>
 <p>整個可視範圍都沒有點時，用一列空值狀態保留該標的。若已有歷史點，但檢視日期本身無結果，則保留歷史列並另加當期空值狀態列；該列不是圖上的新點。no_result（無結果）依列的範圍解讀，不能一律說整段沒有資料。</p>
 <p>stale（資料較舊）只標在最後一個真實舊點，不複製成檢視日期的一列。gap_before 的 true／false／空白分別代表缺口、正常連線、沒有前一個可比較點；正常休市本身不等於資料缺口。</p>
 <p>原型檔名含 TWStockRS-DEMO，採 UTF-8（中文文字編碼）、固定欄位順序及必要的字串跳脫。產檔期間若分析條件或方案改變，舊檔會取消，請按目前畫面重新下載。</p>
</>}
function Storage(){return <>
 <h3>本機帳號與方案權限，尚未串接收費</h3><Table headers={['方案','分析容量與條件','儲存與匯出']} rows={[
 ['Anonymous 匿名','5 檔；日頻 20D、Trail 5；僅 Adjusted。正式 History 10。','沒有觀察清單／檢視格，PNG／CSV／播放鎖定。'],
 ['Free','20 檔；日頻 20／60／120D、Trail 5／10／20；Raw／Adjusted。正式 History 60。','觀察清單 1 格、檢視 1 格；PNG 可用，CSV／週頻／播放鎖定。'],
 ['Pro','100 檔；日頻 Period／Trail 5–240，週頻 5–52，Trail ≤ Period。啟用行情後可查看完整已匯入歷史，日／週可選日期依版本日曆；Period／Trail 上限維持不變。','觀察清單 4 格、檢視 2 格；PNG／CSV／週頻／播放可用。']
 ]}/><p>Pro 可查看啟用版本所提供的完整歷史；Free 與匿名仍依方案限制可回看範圍。本機存檔或備份不授予更高權限。</p>
 <h3>清單與檢視的差別</h3><p>Watchlist 保存單一市場的股票集合；Saved View（已儲存檢視）保存分析條件，個股檢視另保存目前股票。套用會取代目前分析，日期回最新可用端點，不還原選取、縮放或播放進度。</p>
 <p>需要明確按「儲存目前清單／檢視至此格」，修改工作台不會自動覆寫已儲存內容。來源管理裡的 × 只移除該格保存的股票；目前清單的 × 才改本次分析。非空清單市場固定，先清空才可改綁市場。</p>
 <p>Pro 降 Free 時，各自選定一個清單格與檢視格，其餘保留並鎖定。同一段 Free 期間不能改選，清空也不解鎖另一格。不合法週頻、過大參數或進階基準不會被偷偷改寫；請明確調整條件。</p>
 <h3>本機保存與備份</h3><p>一般本機預覽的觀察清單與已儲存檢視保存在此電腦的後端資料庫，同一帳號可在連到此服務的其他瀏覽器使用；離線 HTML 則存於各自瀏覽器。最近分析、主題、排序與欄位偏好由目前瀏覽器按帳號分開保存，不跨瀏覽器同步。重新開啟回最新日期，暫時選取、滑鼠停留、平移縮放與播放進度不保存。</p>
 <p>右上角人像提供備份下載與選檔還原。Free 只處理可用格，Pro 可完整六格；先預覽勾選，再確認覆寫，取消不修改資料。還原後尚未繼續修改時可復原一次；已有新修改時會拒絕覆蓋。</p>
 <p>後端初次建立空白儲存格。既有內容可由人像面板「預覽匯入瀏覽器清單」，或選擇舊版備份檔，核對後再匯入。移機請另帶「下載後端備份」產生的檔案；介面偏好另用瀏覽器資料備份。原始碼包不含這些資料。清除網站資料會失去瀏覽器偏好，但不會刪除後端已保存清單。</p>
</>}
export default function HelpDialog({initialTopic,onClose}:{initialTopic:HelpTopic;onClose:()=>void}){
 const [topic,setTopic]=useState(initialTopic),dialog=useRef<HTMLDialogElement>(null),body=useRef<HTMLDivElement>(null),buttons=useRef<(HTMLButtonElement|null)[]>([]),id=useId();
 useEffect(()=>{const opener=document.activeElement;dialog.current?.showModal();return()=>{dialog.current?.close();if(opener instanceof HTMLElement&&opener.isConnected)opener.focus()}},[]);
 useEffect(()=>{body.current?.scrollTo({top:0})},[topic]);
 return <dialog ref={dialog} className="help-dialog" aria-labelledby={`${id}-title`} onCancel={onClose} onClick={event=>{if(event.target===event.currentTarget)onClose()}}><div className="help-shell"><header><div><small>TWStockRS · 操作與資料</small><h2 id={`${id}-title`}>使用與資料說明</h2></div><button aria-label="關閉說明" onClick={onClose}><X size={20}/></button></header><div className="help-tabs" role="tablist" aria-label="說明主題">{topics.map((item,index)=><button ref={element=>{buttons.current[index]=element}} key={item.id} role="tab" id={`${id}-${item.id}`} aria-controls={`${id}-panel`} aria-selected={topic===item.id} tabIndex={topic===item.id?0:-1} onClick={()=>setTopic(item.id)} onKeyDown={event=>{let next=index;if(event.key==='ArrowRight')next=(index+1)%topics.length;else if(event.key==='ArrowLeft')next=(index+topics.length-1)%topics.length;else if(event.key==='Home')next=0;else if(event.key==='End')next=topics.length-1;else return;event.preventDefault();setTopic(topics[next].id);buttons.current[next]?.focus()}}>{item.label}</button>)}</div><div ref={body} className="help-body" id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${topic}`} tabIndex={0}><p className="help-demo">目前為本機原型，可運算啟用版本的價格；合成包不是真實行情，已有本機帳號登入，尚未串接信箱註冊、付款或公開服務。下方會標明正式資料接入後才適用的規則。</p>{topic==='usage'?<Usage/>:topic==='data'?<Data/>:topic==='csv'?<Csv/>:<Storage/>}</div><footer><span>說明不會改變目前分析條件。</span><button onClick={onClose}>關閉</button></footer></div></dialog>
}
