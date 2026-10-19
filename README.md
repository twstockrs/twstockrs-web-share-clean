# TWStockRS

台股相對強弱與輪動分析的本機網站，提供 Stock Move、Sector Move、日／週分析、觀察清單、儲存檢視、帳號權限、行情版本與備份還原。

此儲存庫保留網站原始碼、固定版本套件清單、執行與建置工具、正式主機交付時必須通過的測試，以及下列介面示意圖。階段報告、產品討論、已建置展示快照及 GitHub 自動交付工作流程不隨程式提供。

## 計算方法與原版 RRG／JdK 的差異

TWStockRS 的實際行情運算使用自訂 **`rs_v1` 滾動標準化算法**。它採用相對強弱與動能的四象限視覺概念，**不是原版 JdK RS-Ratio／JdK RS-Momentum 的實作，也不宣稱數值等價**。本節描述啟用資料版本後的計算；內建 DEMO 路徑另為合成展示資料。

### 目前使用的公式

令 $P_t$ 為標的價格或本專案產業序列，$B_t$ 為所選基準，$N$ 為 Period，$t$ 為有效配對觀測的位置；$L_t$ 是橫軸 RS Level，$M_t$ 是縱軸 RS Momentum：

```math
\begin{aligned}
q_t &= \frac{P_t}{B_t}, \\
L_t &= Z_{N,t}(q), \\
\Delta L_t &= L_t-L_{t-1}, \\
M_t &= Z_{N,t}(\Delta L).
\end{aligned}
```

```math
\begin{aligned}
\mu_{N,t}(x) &= \frac{1}{N}\sum_{i=0}^{N-1}x_{t-i}, \\
\sigma_{N,t}(x) &= \sqrt{\frac{1}{N}\sum_{i=0}^{N-1}\left(x_{t-i}-\mu_{N,t}(x)\right)^2}, \\
Z_{N,t}(x) &= \frac{x_t-\mu_{N,t}(x)}{\sigma_{N,t}(x)}.
\end{aligned}
```

其中 $\mu_{N,t}$ 與 $\sigma_{N,t}$ 分別為最近 $N$ 筆對應序列的平均與標準差；標準差採**母體標準差，變異數除以 $N$**。兩次標準化使用同一個 Period；計算中沒有另加移動平均或指數平滑。Trail 只控制顯示多少個有效歷史點，不改公式。

- `L > 0` 代表目前價格比值高於該標的自己的 N 期平均，**不等於 N 期累積報酬必定跑贏基準**，也不是市場橫截面排名、百分比報酬或 RSI。
- `M > 0` 代表最新 Level 變化高於近期平均變化，**不保證 Level 本身正在上升**。
- 一般至少需要 **2N 筆有效配對觀測**才可能取得完整座標。標準差為零或變化小到無法可靠計算時，回報無結果或歷史不足，不補成 `(0, 0)`。
- 四象限以 `(0, 0)` 分界，保留 Leading、Weakening、Lagging、Improving 名稱。曲線只改連線外觀，不修改計算座標或增加資料觀測點。

### 與原版的主要差異

以下「原版」指 RRG Research 的 RRG／JdK 指標，而非本專案先前版本。

| 比較項目 | 原版 RRG／JdK | TWStockRS `rs_v1` |
| --- | --- | --- |
| 計算核心 | JdK 專有標準化指標 | 上述公開可查的兩階段滾動 Z-score |
| 橫軸 | JdK RS-Ratio，描述相對表現趨勢 | 價格比值相對自身歷史平均的位置 |
| 縱軸 | JdK RS-Momentum，描述 RS-Ratio 的動能 | Level 單期差分的標準化位置 |
| 座標中心 | `(100, 100)` | `(0, 0)` |
| 結果對照 | 使用原版指標定義 | 數值、象限與轉折時間可能不同，不能直接互換 |

**把本專案座標各加 100，只是平移，不會變成原版 JdK 指標。** 此處只比較官方公開說明與本專案程式，不推測或重建未公開的 JdK 計算細節。

### 取價與產業序列

- Raw／Adjusted 依所選資料欄位計算；標的與基準使用同日有效價格配對。週頻取已完成週內最近的同日有效配對，而非把日頻座標平均；遇來源資料缺漏則回報不可用，不跨過缺漏假裝有效。
- 沒有可配對的新價格（例如已確認停牌或無新價格）時，不新增個股 RS 觀測點；資料缺漏或個股市場區段改變會中斷或重置計算視窗，不補假價格。
- 產業序列由歷史成分股的**等權日報酬累乘**建立，起始基期為 100，並非交易所官方加權產業指數。已確認停牌／無成交且有有效前價參考時，成分的運算報酬可記為零；這不會修改原始價格或成交量，來源未知也不能當成零報酬。

實作與既有核對案例：[RS 引擎](server/rsEngine.ts)、[RS 測試](tests/rs-core.test.mjs)、[曲線繪製](components/twstock/safeCurve.ts)。原版比較來源：[StockCharts 指標說明](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/rrg-relative-strength)、[Julius de Kempenaer 於 CMT Association 的說明](https://cmtassociation.org/technically_speaking/technically-speaking-july-2015/)。

## English — Methodology and differences from RRG/JdK

TWStockRS computes imported-data results with its own **`rs_v1` rolling standardization method**. It uses a four-quadrant view of relative strength and momentum, but **does not implement the original JdK RS-Ratio or JdK RS-Momentum indicators and does not claim numerical equivalence**. Built-in DEMO paths are separate synthetic illustrations.

### Calculation

Let $P_t$ be the instrument price or the project’s sector series, $B_t$ the selected benchmark, $N$ the Period, and $t$ the position among valid paired observations. $L_t$ is RS Level on the horizontal axis; $M_t$ is RS Momentum on the vertical axis:

```math
\begin{aligned}
q_t &= \frac{P_t}{B_t}, \\
L_t &= Z_{N,t}(q), \\
\Delta L_t &= L_t-L_{t-1}, \\
M_t &= Z_{N,t}(\Delta L).
\end{aligned}
```

```math
\begin{aligned}
\mu_{N,t}(x) &= \frac{1}{N}\sum_{i=0}^{N-1}x_{t-i}, \\
\sigma_{N,t}(x) &= \sqrt{\frac{1}{N}\sum_{i=0}^{N-1}\left(x_{t-i}-\mu_{N,t}(x)\right)^2}, \\
Z_{N,t}(x) &= \frac{x_t-\mu_{N,t}(x)}{\sigma_{N,t}(x)}.
\end{aligned}
```

Here $\mu_{N,t}$ and $\sigma_{N,t}$ are the mean and standard deviation of the latest $N$ observations of the corresponding series. Each rolling window uses the **population standard deviation, with variance divided by $N$**. Both stages use the same Period. No additional moving-average or exponential smoothing is applied to the calculation. Trail changes only the number of valid historical points displayed.

- Positive Level means the current price ratio exceeds its own rolling mean. It does not necessarily mean positive cumulative excess return over N periods, and it is not a cross-sectional rank, percentage return, or RSI.
- Positive Momentum means the latest Level change exceeds its rolling mean change; Level itself need not be increasing.
- At least **2N valid paired observations** are normally needed before a complete coordinate can be available. Degenerate or numerically unreliable variance produces an undefined or insufficient-history result rather than a fabricated `(0, 0)`.
- The quadrant boundary is `(0, 0)`, using the Leading, Weakening, Lagging and Improving names. Curve rendering changes only the connecting geometry, not calculated coordinates or data observations.

### Comparison with the original indicators

“Original” here means RRG Research’s RRG/JdK indicators, not an earlier TWStockRS release.

| Aspect | Original RRG/JdK | TWStockRS `rs_v1` |
| --- | --- | --- |
| Core method | Proprietary JdK normalized indicators | The disclosed two-stage rolling Z-score above |
| Horizontal axis | JdK RS-Ratio: relative-performance trend | Price ratio’s position within its own history |
| Vertical axis | JdK RS-Momentum: momentum of RS-Ratio | Standardized one-observation change in Level |
| Center | `(100, 100)` | `(0, 0)` |
| Outputs | Original indicator definitions | Values, quadrants and turning dates can differ and are not interchangeable |

**Adding 100 to each TWStockRS coordinate only shifts the origin; it does not reproduce JdK indicators.** This comparison uses published descriptions and this repository’s code, without guessing undisclosed JdK internals.

### Prices and sectors

Raw or Adjusted fields follow the selected input version. Instrument and benchmark observations must share a valid pricing date. Weekly results use the latest valid same-day pair within a completed week, not averaged daily coordinates; unavailable source data is reported rather than skipped as though valid.

An endpoint with no new valid price pair, such as a confirmed suspension/non-trading endpoint, does not create a new stock RS observation. Unavailable data or a change in a stock’s market segment interrupts or resets the calculation window. No substitute prices are invented.

Sector series compound **equal-weight daily returns using historical membership**, starting at 100; they are not official exchange-weighted sector indices. A confirmed suspended/non-trading member with a valid reference price can contribute zero return to this calculation. Its original price and volume remain unchanged; unknown data cannot be treated as zero return.

Implementation and existing checks: [RS engine](server/rsEngine.ts), [RS tests](tests/rs-core.test.mjs), [curve rendering](components/twstock/safeCurve.ts). Original-indicator references: [StockCharts](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/rrg-relative-strength) and [Julius de Kempenaer’s CMT Association article](https://cmtassociation.org/technically_speaking/technically-speaking-july-2015/).


## 介面示意圖

下列四張沿用先前的原型示意圖，依「匿名日頻 → Free 日頻 → Pro 日頻 → Pro 週頻」排列。所有圖表數值均為 **DEMO 模擬資料，不代表真實行情**；圖片呈現原型設計，實際功能與畫面以目前程式為準。

Period 是觀察期間，Trail 是最多顯示的有效軌跡點數。圖中設定如下，實際軌跡仍取決於資料歷史：

| 方案與頻率 | Period | Trail |
| --- | ---: | ---: |
| Anonymous（匿名）· Daily（日頻） | 20D | 5 |
| Free · Daily（日頻） | 120D | 20 |
| Pro · Daily（日頻） | 240D | 240 |
| Pro · Weekly（週頻） | 52W | 52 |

![匿名日頻固定設定的介面示意](docs/showcase/anonymous-daily-max-demo.png)

![Free 日頻最大設定的介面示意](docs/showcase/free-daily-max-demo.png)

![Pro 日頻最大設定的介面示意](docs/showcase/pro-daily-max-demo.png)

![Pro 週頻最大設定的介面示意](docs/showcase/pro-weekly-max-demo.png)

## 環境與本機啟動

需要 Node.js 22.13.0 以上、npm 11.6.2；從 GitHub 取得原始碼另需 Git 與此儲存庫的存取權。請使用新的專案目錄，資料目錄與既有主機分開。

```sh
git clone https://github.com/twstockrs/twstockrs-web-share-clean.git
cd twstockrs-web-share-clean
npm ci
npm run dev
```

開啟 <http://127.0.0.1:5173/>。此指令會同時啟動前端與本機 API；按 Ctrl+C 停止。修改 `server/` 或 `shared/` 後須重新啟動。預設資料儲存在專案的 `.local-data/`，不要指向另一個正在運行的主機資料目錄。

`npm ci` 依 `package-lock.json` 安裝固定版本；不要為了啟動網站而重新產生鎖定檔。這份儲存庫沒有網域、HTTPS 或公開部署設定。

## 帳號

沒有預設帳號或密碼。先停止後端，再建立自己的管理員：

```sh
npm run account -- create --username owner --role admin
npm run account -- create --username member
npm run account -- list
```

密碼在終端機隱藏輸入並確認，須為 15–128 個字元；不要把密碼放入指令或文件。`owner`、`member` 是可替換的帳號名稱範例。重新啟動網站後，從右上方人像登入。一般帳號預設為 Free；管理員角色與 Pro 分析方案分開。停用帳號、重設密碼與方案維護也可透過 `npm run account --` 操作；命令列維護時須先停止共用該資料目錄的服務。

## 行情與資料保存

本庫不含真實行情、帳號、資料庫、私人備份或驗收報告。未啟用來源行情的市場使用內建 DEMO。`public/samples/` 是管理介面可下載的合成格式範例，**不能當成真實行情**。

程式同時支援[資料匯入 v1](docs/資料匯入格式-v1.md) 與[資料匯入 v2](docs/資料匯入格式-v2.md)。

| 格式 | 合成範例 | 說明 |
| --- | --- | --- |
| v1 | [下載／檢視合法 JSON](public/samples/import-valid.json) | 轉板、停牌、無成交、ETF 與指數 |
| v2 | [下載／檢視合法 JSON](public/samples/import-v2-valid.json) | 價格／量口徑、來源參照、正量無價與未知量 |

詳見[範例說明與錯誤測試包](public/samples/README.md)。所有範例均為 TEST 合成資料，**不能當成真實行情或來源證據**。

v2 保留普通交易時段價格與官方全日量的不同口徑，不能補假價格、把正量改零，或只改版本數字。實際來源先依規格建立欄位對照，逐批檢查匯入報告及來源覆蓋範圍，再由管理員建立並啟用資料版本。每包上限 512 MiB；更大資料須依市場或日期拆批。不要補假價格、把缺成交量改為零，或以現在的市場／產業歸屬回填歷史。

帳號、清單、檢視與行情版本保存在私人資料目錄。更新程式、下載原始碼或切換瀏覽器，不會自動還原另一個主機的資料。資料庫、備份、原始行情及憑證不得提交 GitHub，也不得加入程式交付包。

## 備份與還原

網頁的瀏覽器備份用於個人操作狀態，不能取代包含行情、帳號與資料庫的完整後端備份。完整備份建議使用加密格式。先停止後端，將輸出放在專案之外的私人目錄：

```sh
npm run data:backup -- create-encrypted --data-dir PRIVATE_DATA_DIR --file PRIVATE_BACKUP_FILE.twrsbackup.enc
npm run data:backup -- preview-encrypted --data-dir NEW_PRIVATE_DATA_DIR --file PRIVATE_BACKUP_FILE.twrsbackup.enc
npm run data:backup -- restore-encrypted --data-dir NEW_PRIVATE_DATA_DIR --file PRIVATE_BACKUP_FILE.twrsbackup.enc --confirm PREVIEW_TOKEN
```

大寫名稱須替換成自己的路徑及預覽回傳的確認碼。密碼依隱藏提示輸入；先核對預覽，再還原至獨立新目錄並驗證登入與分析。保留可用原資料，勿覆寫原備份。網頁直接下載及自動備份仍是未加密格式，須存放在受保護的位置。

## 檢查、建置與獨立主機

```sh
npm run check
npm test
npm run build
npm run build:server
```

前端輸出為 `dist/`，後端為 `server-dist/`。`npm run start:api` 只啟動 API；日常本機使用採上方的 `npm run dev`。要產生含完整檢查的獨立主機交付檔：

```sh
npm run verify:release -- --out delivery/TWStockRS-local.twrsrelease --id local
node delivery/TWStockRS-local.preflight.mjs --release delivery/TWStockRS-local.twrsrelease
```

完整交付檢查會執行測試、建置與獨立主機檢查；缺少測試或任一步驟失敗都不能當成通過。`host:package` 僅原始打包，不能代替 `verify:release`。交付過程另外產生的離線 HTML 只使用 DEMO；它是建置產物，不保存在本庫。

以全新的主機目錄初始化，使用交付的管理器：

```sh
node delivery/TWStockRS-local.host.mjs init --root NEW_HOST_DIR --release delivery/TWStockRS-local.twrsrelease
node delivery/TWStockRS-local.host.mjs run --root NEW_HOST_DIR
```

預設開啟 <http://127.0.0.1:8890/>，其他終端機可執行 `node delivery/TWStockRS-local.host.mjs status --root NEW_HOST_DIR` 查狀態，或將 `status` 換成 `stop` 正常停止。不要用新主機指向正在運行的正式資料，也不要在未完成備份與驗證時替換既有主機。

本庫不再以 GitHub Actions 自動建立與保存交付包；需要驗證或交付時在本機執行上述指令。Pro 的日／週日期選擇可使用已啟用行情版本的完整歷史，涵蓋完整四年；最多每頻率 3661 個端點。這不改變 RS 日頻 Period／Trail 240、週頻 52 的上限，也不補出早期缺少的觀測。播放會準備行情最新日期，含最新日期回算目前 Trail 數的真實觀測，再由舊到新顯示；過程固定視野與最新點的顏色。Anonymous／Free 權限維持既有規則。此庫不附實際行情，使用者仍須對自己的來源版本驗收。
