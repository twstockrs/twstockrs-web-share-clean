# TWStockRS

台股相對強弱與輪動分析的本機網站，提供 Stock Move、Sector Move、日／週分析、觀察清單、儲存檢視、帳號權限、行情版本與備份還原。

此儲存庫保留網站原始碼、固定版本套件清單、執行與建置工具，以及正式主機交付時必須通過的測試。階段報告、產品討論、展示截圖、已建置展示快照及 GitHub 自動交付工作流程不隨程式提供。

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

程式同時支援[資料匯入 v1](docs/資料匯入格式-v1.md) 與[資料匯入 v2](docs/資料匯入格式-v2.md)。v2 保留普通交易時段價格與官方全日量的不同口徑，不能補假價格、把正量改零，或只改版本數字。實際來源先依規格建立欄位對照，逐批檢查匯入報告及來源覆蓋範圍，再由管理員建立並啟用資料版本。每包上限 512 MiB；更大資料須依市場或日期拆批。不要補假價格、把缺成交量改為零，或以現在的市場／產業歸屬回填歷史。

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
