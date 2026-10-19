import {monitorLabels,type MonitorSummary} from '../../shared/monitorContract';
const date=(at:number|null)=>at===null?'—':new Date(at).toLocaleString('zh-TW',{hour12:false});
export default function MonitorPanel({value,refresh,busy}:{value:MonitorSummary|null|undefined;refresh:()=>void;busy:boolean}){
 return <><div className="admin-toolbar"><h3>服務監控與異常通知</h3><button disabled={busy} onClick={refresh}>重新讀取監控</button></div>
 <p className="admin-muted">每 10 秒檢查服務指標。通知佇列會保存至主機；目前通道為本機模擬接收，不會寄送信件或訊息。</p>
 {!value?<p role="status">此服務尚未提供主機監控；一般開發預覽不執行監控排程。</p>:<>
 {(!value.available||value.stale||value.fault)&&<p className="subset-error" role="alert">{!value.available?'監控狀態不可讀，原檔保留。':value.fault==='MONITOR_CAPACITY'?'監控記錄已達容量，待送或失敗通知仍保留，請檢查主機。':value.stale?'監控資料過期，目前狀態無法確認。':''}</p>}
 <dl className="admin-detail"><dt>異常判定</dt><dd>{value.enabled?'已啟用':'已停用；原事件保留'} · 最近檢查 {date(value.at)}</dd><dt>一般門檻</dt><dd>連續 {value.trigger_samples} 次異常建立事件；連續 {value.recover_samples} 次正常記錄恢復。服務中斷與重新啟用立即記錄。</dd><dt>空間與備份</dt><dd>剩餘空間低於 {value.min_free_mb} MB；排程備份延遲 {value.backup_late_minutes} 分鐘</dd><dt>運算異常</dt><dd>5 分鐘內新增 {value.queue_errors} 次失敗、逾時或滿額拒絕；擁塞另依連續等候滿額判定。</dd></dl>
 <div className="admin-stats"><div><span>未恢復事件</span><strong>{value.incidents.filter(i=>i.recovered_at===null).length}</strong><small>持續異常不重複通知</small></div><div><span>待交付通知</span><strong>{value.pending}</strong><small>最多嘗試 5 次</small></div><div><span>需人工重試</span><strong>{value.dead}</strong><small>原通知識別保留</small></div><div><span>本機模擬已接收</span><strong>{value.delivered}</strong><small>不是外部寄送成功</small></div></div>
 <h4>異常與恢復事件</h4>{!value.incidents.length?<p>{value.available&&!value.stale?'尚無已建立的事件。':'目前無法確認事件。'}</p>:<ol className="admin-events">{[...value.incidents].reverse().slice(0,40).map(i=><li key={i.id}><div><strong>{monitorLabels[i.code]}</strong><span className={i.recovered_at===null?'admin-error-badge':'admin-ok-badge'}>{i.recovered_at===null?'未恢復':'已恢復'}</span></div><p>發生 {date(i.opened_at)}{i.recovered_at!==null?` · 恢復 ${date(i.recovered_at)}`:''}</p><small className="admin-id">事件識別：{i.id}</small></li>)}</ol>}
 <h4>通知交付記錄</h4><p className="admin-muted">顯示最新 40 筆；保留最多 200 個事件與 400 筆通知。只淘汰已恢復且已交付的舊記錄，不清除待送或失敗通知。管理器停止或整台主機斷線，需要主機外部的監控服務才能通知。</p>
 {!value.notifications.length?<p>尚無通知。</p>:<ol className="admin-events">{[...value.notifications].reverse().slice(0,40).map(n=><li key={n.id}><div><strong>{n.kind==='test'?'本機測試':`${n.kind==='alert'?'異常':'恢復'} · ${monitorLabels[n.code as keyof typeof monitorLabels]}`}</strong><span className={n.status==='delivered'?'admin-ok-badge':'admin-error-badge'}>{n.status==='delivered'?'本機已接收':n.status==='dead'?'停止重試':'待交付'}</span></div><p>{date(n.created_at)} · 已嘗試 {n.attempts} 次{n.next_at!==null?` · 可重試時間 ${date(n.next_at)}`:''}{n.delivered_at!==null?` · 接收 ${date(n.delivered_at)}`:''}</p><small className="admin-id">通知識別：{n.id}</small></li>)}</ol>}
 <p>本機工具可執行 monitor test 測試通道、monitor retry 重試失敗通知。修改門檻前須正常停止主機。</p>
 </>}
 </>;
}
