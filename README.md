# HoLanLa

**繁體中文** | [English](README.en.md)

版本：v0.8.0

HoLanLa 是實驗性的瀏覽器照片工具，為支援的照片加入攝影風格和 iOS 27 質感／顆粒中繼資料。
照片分析、推論與轉換均只在你的裝置上完成，完全不會上傳照片，也完全不會收集或傳送使用統計（telemetry）。

**請保留原片！請保留原片！請保留原片！重要的事情說三次。**

和原始專案 [nathanatgit/Shalielie](https://github.com/nathanatgit/Shalielie) 一樣，
HoLanLa 也是透過 **vibe coding** 開發而來：以自然語言描述需求，搭配 AI 協助撰寫與修改程式。

https://joy-0220-yoj.github.io/HoLanLa/

## v0.8.0 改動

- 將預製 ZIP 中的二進位範本資料，改為以可讀欄位與明確數值定義，並在瀏覽器內自行產生，讓資料內容與產生流程更容易檢視、追溯與驗證。
- 移除依賴舊 ZIP 範本的對照測試工具。
- 為避免 MediaPipe [官方隱私聲明](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/README.md#privacy-notice) 所述的效能與使用統計（telemetry）傳送，移除 MediaPipe Tasks Vision 執行環境，視覺推論統一使用 ONNX Runtime Web WASM。
- 目前使用的三個社群 ONNX 模型均已從 Google 官方原模型獨立重做轉換並比對，確認權重與計算圖相同。
- 三個社群 ONNX 模型固定發布 revision 並核對 SHA-256；快取管理顯示 Google 原模型名稱、版本與「社群 ONNX 版」。
- 產生獨立的 10-bit Display P3 線性縮圖，修正中性差異圖色彩標記、屬性索引溢位，並共用相同影像屬性。
- libheif-js 解碼器升級至 1.23.5，維持自動備援的 JavaScript／asm.js 路徑。
- 頁面與 Service Worker 預快取的 JavaScript 使用相同版號，離線載入核對 JavaScript 版號。
- 黑白範圍校正無法讀取 WebCodecs 原生 YUV 像素時，改用本機 FFmpeg.wasm 解碼量測，避免中止處理。
- 修正 HEIC 影像資料位於中繼資料前方時的誤判，並補齊 Apple Display P3 ICC 色彩描述的相容性。
- 新增 DNG (ProRAW) 本機顯影與 HEIC 匯入，支援無損 JPEG 壓縮的 Apple ProRAW，以分塊顯影及依序釋放 WASM 執行環境降低記憶體用量，並可檢視原始 DNG (ProRAW) 內容、優先沿用原生遮罩，加入解碼器完整性核對與資源快取管理。
- 將 ONNX Runtime 推論移至可終止的 Worker，逾時或記憶體不足時釋放執行環境。
- 修正模型準備失敗但仍繼續處理時，總耗時被重設的問題，並明確顯示記憶體不足的原因。
- 新增分享預覽的中文標題、功能描述與專屬圖片，並更新瀏覽器與主畫面圖示。
- 更新相關測試，涵蓋自行產生的範本、ONNX Runtime 推論與資源快取。

## 為什麼叫 HoLanLa？

本專案基於 [nathanatgit/Shalielie](https://github.com/nathanatgit/Shalielie)。
原作 **Shalielie** 是「**瞎咧咧**」的發音轉寫。原作者取這個名字，是為了吐槽評論區的
Apple「精神股東」——那些像持有 Apple 股份一樣，替 Apple 每個決定辯護的粉絲。例如：

> 「Apple 不給老機型開放攝影風格調色盤，是因為 Apple 想提供更好、更一致的使用者體驗。」
>
> 「瞎咧咧 🙄。」

這個版本把名稱改成台灣版的「**唬爛啦（HoLanLa）**」，延續原作的吐槽語氣，
換成台灣更熟悉的說法：「唬爛啦 🙄。」

## 照片處理流程

支援匯入任何手機或相機拍攝的照片，以及螢幕截圖，格式包括 HEIC、PNG、JPEG、WebP、DNG (ProRAW)。
實際能處理哪些檔案，仍取決於解碼器與瀏覽器的 HEVC 編碼支援。

無損 JPEG 壓縮的 DNG (ProRAW) 會透過 LibRaw WASM 在本機以相機白平衡顯影，轉成 8-bit sRGB，再編碼為 HEIC。輸出不保留 RAW 資料、原始 HDR 呈現與 ProRAW 編輯彈性，色彩可能與 Apple「照片」App 不同。目前尚未支援 JPEG XL 壓縮的 DNG (ProRAW)；相機的「ProRAW 格式」請選擇 JPEG 無損（不要選 JPEG XL），修改設定只適用於之後拍攝的照片。超過 1200 萬像素的 ProRAW 會逐塊顯影並縮小至約 1200 萬像素，以降低記憶體用量。顯影完成並釋放 LibRaw 後，才載入 HEVC 編碼器；不支援分塊處理的超大 RAW 會在顯影前顯示錯誤。

「對照全部內嵌資料」可直接檢視原始 DNG (ProRAW) 的 IFD／SubIFD、RAW 主圖、內嵌預覽、語意遮罩、顯影增益表與色調曲線。可辨識、可解碼且能對齊主圖的原生遮罩會優先沿用，重新編碼後加入 HEIC；啟用人物分析時，缺少的部分再由本機模型補足。DNG (ProRAW) 顯影增益表與色調曲線目前提供檢視，尚未套用於 LibRaw 顯影。

LibRaw WASM 只在匯入 DNG (ProRAW) 時下載；固定使用 `libraw-wasm` 1.6.0（LibRaw 0.22.1），載入前核對 SHA-256，並儲存於資源快取，供後續離線使用。

選取照片後會自動按佇列處理。每張卡片頂端固定放置原圖與處理結果縮圖，處理失敗時仍保留原圖。
操作按鈕與進度排在圖片下方；新的進度行加入最上方，舊進度往下保留。
較長的紀錄在進度區域內捲動，新增進度不會把這張卡片的圖片往下推。
閱讀較舊進度時，新增訊息會保留目前閱讀位置。
成功後會直接在卡片上顯示輸出 HEIC 小圖，供支援原生 HEIC 影像的 iPhone 瀏覽器長按儲存。
結果還提供下載、可用時的「照片」分享，以及**對照全部內嵌資料**。
不支援原生 HEIC 影像的瀏覽器可以顯示本機 Canvas 預覽；此時請透過檔案下載或「照片」分享
儲存結果，以保留 HEIC 中繼資料。

進度時間是每個步驟的獨立耗時，包括排隊等待；步驟結束後時間不再變化。
不足一秒顯示毫秒，正數不足一毫秒顯示 `<1ms`；較長步驟顯示三位小數的秒數。
完成／錯誤摘要顯示從加入佇列到結束的總耗時，包含排隊等待；結束後固定顯示。
重新修正人臉時會重新計算該次處理的總耗時。模型準備、人臉偵測、多類別分割，以及每個遮罩的產生／編碼
分別計時。人物遮罩與人像效果遮罩重複使用一次編碼。保留原影像素的路徑會保留原生頭髮遮罩，
瀏覽器的遮罩產生流程目前不會新編碼頭髮遮罩。
同步解碼與推論可能阻塞介面，使計時暫時停止更新；恢復後會根據單調時鐘補上實際耗時。
流程會在階段之間及人臉偵測的各次掃描之間讓出執行時間，以便瀏覽器更新。
**對照全部內嵌資料**是每張結果卡片的第一個操作。對照標籤顯示譯名與技術名稱，
例如「頭髮遮罩」與 `semantichairmatte`；外層進度只顯示譯名。
所有本機模組匯入都使用與入口相同的建置標記，避免一般圖片匯入與原生 HEIC 路徑
重複使用不同版本的人臉／進度模組快取。

本次產生了人臉偵測結果的照片，會在對照按鈕後提供**校正人臉**。
對話方塊顯示方向正確的照片、編號人臉框、對應的人臉縮圖，以及縮放控制。
點選保留／排除後統一套用；取消會丟棄本次尚未套用的選擇。
套用後更新同一張卡片的 HEIC 下載、「照片」分享、長按小圖、人臉數量與對照／疊圖。
已套用的選擇可以再次開啟、調整與恢復。
校正重複使用首次人臉偵測與共用分割結果，只重建與人臉相關的局部遮罩和人物中繼資料，
並重複使用已經編碼的主圖、HDR 與縮圖像素。原生來源遮罩和共用皮膚／人物遮罩保留。
排除全部偵測會移除本次產生的所有人物實例與人臉記錄；恢復全部人臉會恢復首次輸出的原始位元組。
校正失敗時，上一份結果與已套用的選擇仍可使用。
此對話方塊只校正本次偵測，不新增人臉，也不編輯相機原有的內嵌遮罩。

已有攝影風格的原生照片保留原有輔助資料，並加入質感／顆粒及所需的 v16 風格結構更新；
沒有風格資料的照片透過設定檔移植，並產生獨立的 10-bit 線性縮圖。

內嵌資料對照檢查實際輸入／輸出的中繼資料、項目酬載與遮罩。

驗證：使用已有 Playwright 環境執行 `node tests/web/basic-workflow-browser.mjs`，
可檢查一般原生輸出的逐位元組一致性、對照，以及 320／390 像素寬度的配置。
`node tests/web/linear8.mjs` 使用外部安裝的 FFmpeg 測試程式驗證真實 HEVC 樣本；網站按需載入 FFmpeg.wasm／x265，測試的原生 FFmpeg 僅作獨立解碼驗證。

## 本機執行

```bash
git clone https://github.com/joy-0220-yoj/HoLanLa.git
cd HoLanLa
python tools/serve_web.py
```

開啟 `http://localhost:8000/`。靜態網站不需要建置或安裝執行階段相依套件。
Python 僅供可選的開發伺服器使用，照片轉換器以 JavaScript 在瀏覽器執行。
首次使用需要網路下載所需的公開編碼器、解碼器或模型。
照片能否完成處理仍取決於瀏覽器的解碼與 HEVC 編碼支援。

## 部署

[.github/workflows/pages.yml](.github/workflows/pages.yml) 會在推送到 `main` 或 `master`、且涉及網站、測試或部署設定時，檢查並發布 `web/` 到 GitHub Pages。
首次在 **Settings → Pages → Source → GitHub Actions** 中啟用即可。
沒有建置步驟；上傳前工作流程會檢查：

- `web/` 下沒有 `.heic`／`.heif` 檔案，避免發布個人照片。
- profile 產生與編碼模組存在且非空。
- PWA 中繼資料、圖示尺寸、註冊方式與離線資源清單一致。
- `npm test` 的獨立 web 回歸測試與文字檢查通過。

本機執行請參考[本機執行](#本機執行)。localhost 屬於安全環境的例外，不需要產生或安裝憑證；
輔助伺服器提供 HTTP 服務及 COOP／COEP 回應標頭。

iPhone／區域網路測試可使用代管網站或受信任的本機 HTTPS。
WebCodecs 要求安全環境：回送位址 HTTP 可用，
一般區域網路 IP 的 HTTP 不具備相同條件，無法因此取得所需的編碼／PWA API。
請參閱 [WebCodecs](https://www.w3.org/TR/webcodecs/#videoencoder-interface)
與 [Secure Contexts](https://www.w3.org/TR/secure-contexts/#is-origin-trustworthy)。

使用 Python 產生憑證；uv 管理指令碼獨立的 `cryptography` 相依套件，不修改專案相依套件：

```bash
uv run tools/create_https_cert.py --ip YOUR_LAN_IP
python tools/serve_web.py --bind 0.0.0.0 --port 8443 --cert .local-https/lan-cert.pem --key .local-https/lan-key.pem
```

將 `YOUR_LAN_IP` 替換成電腦實際的區域網路 IP，再在 iPhone 開啟 `https://YOUR_LAN_IP:8443/`。
只將 `.local-https/rootCA.cer` 傳到 iPhone 並開啟，在「設定 → 已下載描述檔」中安裝，
再到「設定 → 一般 → 關於本機 → 憑證信任設定」啟用信任。
僅跳過憑證警告不足以啟用相關 API。
私密金鑰留在電腦上、存放於網頁服務目錄之外；`.local-https/` 已被 Git 忽略。
工具不會自動修改作業系統的信任設定。

伺服器憑證有效期為 90 天。再次執行憑證產生工具可續期或更換 IP，並重複使用已有 CA。
如果 CA 檔案被刪除後重新產生，必須在 iPhone 重新安裝並信任新的 `rootCA.cer`。

也可以提供其他工具產生的已有憑證：

```bash
python tools/serve_web.py --bind 0.0.0.0 --port 8443 --cert path/to/lan-cert.pem --key path/to/lan-key.pem
```

在安全的靜態代管環境中，應用程式會等待目前建置的 Service Worker 控制頁面，
檢查回應標頭，並在必要時每個建置最多重新載入一次。

所有資源使用相對路徑，因此 `https://user.github.io/repo/` 這類專案子路徑不需要額外設定。

## PWA 與離線使用

網站可安裝為漸進式 Web 應用程式（PWA）。`web/manifest.webmanifest` 提供應用程式名稱與圖示，
`web/sw.js` 預快取完整轉換器、profile 產生程式，以及全部第一方 JavaScript。
路徑保持相對形式，可用於網域根目錄或 GitHub Pages 專案子路徑。
頁面載入與離線預快取的 JavaScript 使用相同版本標記；離線時只讀取符合請求版本的程式。

網站檔案優先存取網路，失敗後使用已儲存的副本，兼顧更新與離線使用。
ONNX Runtime Web WASM 的 JavaScript 執行元件／載入指令碼、WASM 運算引擎與三個 ONNX 模型，
在首次使用成功下載後會儲存到本機持久快取，後續先從快取讀取，關閉瀏覽器後再開啟也能重複使用。
這份資源快取與網站版本分開，網站更新不會刪除；資源網址或資源快取版本更換時才需重新下載。
LibRaw DNG (ProRAW) 解碼器與 FFmpeg 編碼器也使用這份資源快取。
畫面會區分「正在下載」與「從本機快取載入」。快取只包含公開元件與模型，不儲存照片。
重新開啟仍須初始化運算引擎與模型實例。

ONNX Runtime 執行環境固定為 `1.23.2`，三個社群 ONNX 模型使用固定發布 revision，並核對 SHA-256。
快取管理顯示對應的 Google 原模型名稱與版本：BlazeFace 與 Face Landmarker 為 `1`（float16 原模型），
SelfieMulticlass 為 `1`（float32 原模型），並標示「社群 ONNX 版」；快取識別仍使用實際 ONNX 發布 revision。
開啟照片選取區下方的**管理資源快取**，可查看版本、本機儲存狀態與大小；本頁使用版本與其他已快取版本會分別列出。
可個別刪除某個版本，或按**刪除全部資源快取版本**一次清除，包含 ONNX Runtime JavaScript 執行元件。
刪除會排在目前照片處理之後；若刪除本頁使用的版本，也會釋放對應的記憶體實例，下次需要時重新下載。

無痕模式、清除網站資料或瀏覽器回收儲存空間可能使快取消失；無法使用或寫入快取時，
畫面會提示下次可能需要重新下載。詳見 [Cache API 的儲存限制](https://developer.mozilla.org/en-US/docs/Web/API/Cache)。
可選 libheif 解碼器不在持久快取範圍內。
無法解碼進行照片分析時，會沿用自行產生範本中的預設場景統計。

修改執行階段檔案或 manifest 後，檢查離線資源清單是否完整：

```bash
node tests/web/check-pwa.mjs
```

## 網站包含哪些內容

網站按需載入固定版本的 FFmpeg.wasm／x265 與 worker，不需要本機 FFmpeg 安裝。
新的 HEVC 主圖、一般輔助圖與偵測遮罩使用 WebCodecs；中性素材與 10-bit 線性縮圖使用 FFmpeg.wasm／x265 編碼；
10-bit 線性縮圖的 SPS 色彩標記由 x265 編碼時直接寫入。
部分可選本機驗證測試使用原生 FFmpeg，但網站不依賴它。
ONNX Runtime 的 WASM 執行環境用於本機推論，與 FFmpeg 無關。

| 項目 | 內容 |
|---|---|
| 組成 | 第一方 JavaScript 與 profile 產生程式；按需載入約 33 MB 編碼器 |
| 請求 | `web/index.html`、`web/app.js`、第一方模組；依照片配置在瀏覽器內產生設定 |
| 外部相依項 | 可選解碼器、ONNX Runtime 執行環境／ONNX 模型與 FFmpeg.wasm／x265 編碼器，詳見下節 |
| 代管 | localhost 的本機 HTTP 或代管 HTTPS 網站；開發伺服器或 Service Worker 提供 COOP／COEP |

## 可選的外部相依項

HEIC 人臉、色彩／亮度分析與輔助圖檢視固定使用自動解碼流程。
先使用 WebCodecs VideoDecoder，無法解碼或無法處理外層色彩／裁切設定時，
才從 jsDelivr 載入 libheif-js 1.23.5 的傳統 JavaScript／asm.js 版本。
外層 ICC 會檢查色彩矩陣、D50 白點與三個色版的曲線；符合標準 sRGB／Display P3
（含線性版本）的矩陣／曲線描述會轉成 WebCodecs 色彩設定，進度顯示 `ICC: Display P3` 等名稱。
YUV 矩陣與亮度範圍仍採用 nclx／HEVC 資料，不從 RGB ICC 猜測。
若解碼器忽略 ICC 的原色／曲線設定，或忽略 HEIF／HEVC 指定的已支援 YUV 矩陣，
會先讀回原始 YUV 平面，在不改動樣本、格式與裁切的情況下建立帶有正確色彩標記的影格；
進度顯示「已套用 HEIF／ICC 色彩標記」。矩陣採用來源描述，例如 `smpte170m`，不從 ICC 猜測。
已轉成 RGB、無法讀回原始 YUV、不支援的矩陣或亮度範圍不一致時仍會備援。
自訂查表／曲線、損壞的 ICC 或互相矛盾的色彩描述仍會備援。
輔助圖另支援 D50、線性 `kTRC` 的 `GRAY` ICC：WebCodecs 讀回原始 YUV 的亮度平面，
依完整／有限範圍產生灰階數值預覽，不套用顯示 gamma，避免改動遮罩覆蓋率。
支援單張與 grid、8／10／12-bit 樣本；PNG 預覽會量化為 8-bit。
進度顯示 `ICC: Gray Linear · 灰階輔助圖數值預覽`。此路徑只用於輔助圖，
不把彩色主圖當作灰階資料。其他灰階曲線與複雜 ICC 會自動改用 asm.js。
影像方向依每個項目的 `ipma` 關聯順序處理 `irot`／`imir`，不能固定先鏡像或先旋轉。
主圖分析、輔助圖預覽、人物座標及產生的遮罩使用同一個方向轉換；寫回像素時使用其反向轉換。
移植原始影像保留原本的方向順序，新增遮罩則繼承主圖的順序。
進度紀錄會列出解碼／編碼來源與自動備援原因。
自動備援成功時僅顯示改用 asm.js 的原因；所有可用解碼流程都失敗時才顯示「解碼失敗」。
HEIC 缺少縮圖、產生線性縮圖及完整重新編碼的來源輸入，仍先嘗試
`createImageBitmap()`／`Image.decode()`；原生解碼失敗時才使用上述自動解碼流程。
備援直接產生帶色彩管理的 Display P3 畫布，不經過會裁切色域的 sRGB 中間圖。
asm.js 來源備援支援標準 sRGB／Display P3 ICC（含線性曲線）及已知 SDR nclx／SPS 色彩；
無法辨識的 ICC、HDR 曲線或色彩衝突會明確失敗，避免產生色彩錯誤的照片。
獨立線性縮圖仍先隔離 SDR 主圖，不套用 gain map；鏡像與旋轉會還原至原始儲存方向。
只缺少中性 HDR 輔助圖時不需要解碼照片。主圖 HEVC 編碼使用 WebCodecs；黑白範圍校正先讀取
WebCodecs 解碼後的原生 YUV 像素，無法讀取時改用本機 FFmpeg.wasm 解碼相同校正圖，
直接量測黑白像素值，避免 RGB 轉換或僅依賴瀏覽器回報的範圍資訊。

Windows／Edge 能解碼 HEIC，不代表能透過 WebCodecs 編碼 HEVC。libheif-js asm.js
只提供解碼，無法補上 HEVC 編碼器。網站會依實際尺寸探測 HEVC Main8 的
可變／固定位元率、quality／realtime、硬體／作業系統編碼器與不同 level 設定。
產生缺少的縮圖、HDR 輔助圖、線性縮圖或重新編碼主圖前，會先檢查所需編碼支援；
全部不支援時提早停止，避免為無法完成的輸出下載解碼器或解碼整張照片。
保留已有影像項目的容器修改路徑仍可使用；新增影像項目需要可用的 HEVC 編碼器。

asm.js 備援仍在主執行緒解碼完整解析度，再縮小供分析；大照片可能暫時阻塞操作。
解碼後的影像會保留在快取中供後續處理重複使用。
獨立輔助圖會先隔離成主要影像，保留原始壓縮資料、色彩與方向屬性，避免誤解碼成照片主圖。

這些請求下載處理程式碼，照片資料保留在本機。可選場景分析失敗時，沿用自行產生範本中的預設場景統計與固定光照圖。
需要解碼像素或新 HEVC 影像的路徑，仍需可用的解碼器／編碼器；不可用時會顯示錯誤。

若要從本機提供解碼器，可將相同版本的傳統版本放入專案，並將 `LIBHEIF_URL` 指向它：

```bash
npm pack libheif-js@1.23.5
tar -xzf libheif-js-1.23.5.tgz
mkdir -p web/vendor
cp package/libheif/libheif.js web/vendor/
```

只有開啟「實驗性柔膚支援」時，`web/src/face-mattes.js` 才會為人臉資料或缺少的人像效果遮罩視需要下載
ONNX Runtime Web WASM 的執行環境與模型，供人臉偵測、特徵點與分割共用。

| 下載項目 | 用途 | 約略大小 |
| --- | --- | --- |
| ONNX Runtime Web WASM 1.23.2 與 JavaScript 元件 | 在本機執行全部 ONNX 推論。 | 12.0 MB |
| Google MediaPipe BlazeFace（社群 ONNX 版） | 人臉偵測，供特徵點模型裁切。 | 0.42 MB |
| Google MediaPipe Face Landmarker（社群 ONNX 版） | 478 點特徵點與人物中繼資料。 | 4.92 MB |
| Google MediaPipe SelfieMulticlass（社群 ONNX 版） | 六分類信心值，產生皮膚與人物遮罩。 | 16.45 MB |

**ONNX Runtime Web WASM** 使用 `onnxruntime-web@1.23.2` 的 WASM provider，
搭配外部已發布的 [BlazeFace ONNX](https://huggingface.co/fernandotonon/QtMeshEditor-blazeface-onnx)、
[478 點 Face Landmarker ONNX](https://huggingface.co/senty-au/face_landmarks_detector-ONNX)
與 [SelfieMulticlass ONNX](https://huggingface.co/senty-au/selfie_multiclass_256x256-ONNX)。
這些檔案是 Google 原始 TFLite 模型的社群 ONNX 轉換版本。
轉換在模型發布前完成；瀏覽器下載並執行已發布的 ONNX 模型。
repo 不包含模型二進位，來源使用固定版本並核對 SHA-256，首次下載約 33.8 MB，之後從本機快取讀取。
大小取自固定檔案；畫面上的大小與百分比以當次下載回應為準。推論在瀏覽器內完成，下載請求不會發送照片。
三個固定 ONNX 均已與 Google 官方原模型的獨立轉換結果比對，確認權重與計算圖相同。
ONNX Runtime 的姿態使用標準臉座標與加權幾何擬合，再套用現有 Apple 角度校正；仍需在 Apple Photos 驗證。
ONNX Runtime WASM [官方說明不包含 telemetry](https://github.com/microsoft/onnxruntime/blob/main/docs/Privacy.md)，
但首次下載仍會連線至 jsDelivr、Hugging Face 及其檔案主機，這些服務可能記錄一般連線資訊。
資源快取管理可分別刪除 ONNX Runtime 執行環境、偵測、特徵點與分割模型。

取消勾選柔膚支援後，不會下載或初始化 ONNX Runtime 執行環境與模型，也不會使用已載入的模型做推論；
原圖已有的人像效果遮罩仍會保留，缺少的遮罩則省略。
「分析照片內容」控制照片分析與風格資料調整，不會單獨啟動視覺引擎。
柔膚支援開啟時，若只補建人像效果遮罩，需要分割器，不需要人臉偵測與特徵點模型。
模型準備會分別顯示 ONNX Runtime 執行環境、WASM／人臉模型／分割模型下載，以及 WASM 初始化。
下載時顯示已收到的大小；伺服器提供總大小時顯示百分比與進度條，未提供時顯示大小與等待進度條。
下載完成後改顯示初始化狀態，初始化沒有可量測的百分比。
首次使用所需時間取決於網路與裝置；同一頁面後續照片會重複使用已建立的模型。DNG (ProRAW) 處理則在顯影、人物推論與 FFmpeg 編碼各階段依序釋放 WASM 執行環境，避免大型記憶體同時佔用；模型檔案仍保留於資源快取。
下載連續 30 秒沒有收到資料便中止；ONNX Runtime 執行環境準備與非同步模型初始化各最多等待 120 秒。
ONNX Runtime 推論在獨立 Worker 中執行，逾時時可終止 Worker，釋放其 WASM 記憶體。
失敗時會指出相關資源並保留錯誤；可檢查連線後重新處理照片。
共用執行環境或分割模型失敗後，同一張照片不會再為人像效果自動重試一次。
重新載入頁面或重開瀏覽器仍需建立模型實例；WASM 與模型檔案優先從本機持久快取讀取。
人臉偵測、特徵點與 SelfieMulticlass 都使用 ONNX Runtime WASM，在 CPU 上執行。
人臉偵測和分割在後續各自獨立的步驟中計時。
合照會進行一次全圖掃描及四次重疊放大裁切掃描，再將偵測結果對應回完整影像座標，
去除重複偵測後產生遮罩與人物中繼資料。

寫入遮罩需要 HEVC 編碼。實作會呼叫 `VideoEncoder.isConfigSupported()` 檢查編碼器，
並將回傳的 `HEVCDecoderConfigurationRecord` 寫為遮罩的 `hvcC` 屬性。
無法產生人臉資料或遮罩時，其他條件仍滿足的路徑會繼續使用空的 2026 語意遮罩，
並在結果卡片說明未加入產生遮罩的原因。
需要新主圖或線性縮圖的路徑仍需 HEVC 編碼器；無法產生缺少的人像效果遮罩時會省略該項目。

瀏覽器將臉部與身體皮膚信心值合併為 `semanticskinmattev2`，臉部皮膚對應為
`semanticfaceskinmatte`，身體皮膚對應為 `semanticnonfaceskinmatte`，
背景信心值的補集對應為 `semanticpersonmatte`。
原生來源皮膚遮罩優先：已有 `semanticskinmatte` 會保留，並透過重複使用編碼像素、尺寸、編碼、
色彩與變換屬性補建缺少的 `semanticskinmattev2`。
如果來源同時擁有兩種遮罩，各自保留原有內容，兩種輔助圖 URI 保持不同。
此規則適用於兩個自行產生的設定檔、加入質感／顆粒的原生風格照片，以及 HEIC 相容重編碼。
只有來源沒有皮膚遮罩時，才用瀏覽器產生的信心值供給兩代語意遮罩，包括 PNG／JPEG／WebP／DNG (ProRAW) 匯入。
不會將範本預留遮罩當成來源原生皮膚資料。
產生的遮罩只是近似結果；將舊版像素複製到 v2 項目並不會重現 Apple 的 v2 分割模型。
其他項目的共用屬性保持不變。

人物信心值會依據最近的偵測人臉劃分為 `semanticpersoninstances`。
信心值圖在保留寬高比的前提下平滑重新取樣，最長邊為 768 像素，尺寸為適合 HEVC 的偶數。
旋轉與鏡像將其轉換為儲存方向；每個產生的遮罩和人物實例都有相符的 HEVC 尺寸與獨立 `ispe`。
PNG／JPEG／WebP／DNG (ProRAW) 的人臉分析也保留來源寬高比；空遮罩退回保留參考的 768×576 尺寸。
流程還會計算 styles plist 中的人物／皮膚覆蓋率與統計，為每張偵測人臉建立實例遮罩，
並將每張人臉的 ROI、色彩、粗糙度和實例遮罩關聯寫入 `TextureStylePostProcessedPeopleData`。
76 個特徵點按照原生參考樣本推斷出的原生順序排列：左右眼、左右眉毛、外／內嘴唇、
鼻樑／鼻底，最後是從右太陽穴到左太陽穴的臉部輪廓。
單一 MediaPipe 點位是對 Apple 私有偵測結果的近似；分組邊界與陣列位置保持穩定。
Face Mesh 輪廓提供鼻部、嘴唇、眉毛和近似耳朵遮罩；嘴部像素用於保守的牙齒遮罩；
分割器的配件信心值限制在眼部區域以產生眼鏡遮罩；臉／頸核心以外的非臉部身體皮膚
用於保守的手部候選區域。刺青遮罩保持為空，直到有可靠分類器能避免把陰影和衣物誤認為刺青。
所有產生的資料仍屬實驗性，尚未在手機上驗證與 Apple 私有分割結果等效。

偏航、俯仰、翻滾來自 ONNX Runtime 特徵點與 Google 標準臉座標擬合的欄主序變換矩陣。
旋轉分解為 `Rz * Ry * Rx`，使用弧度（`faceUnitOfAngle = 1`），再依據原生參考樣本
中的四張原生人臉逐軸校準，以修正不同的中性臉零點而不混合各軸。
這四個參考樣本的最大殘差約為 0.036 弧度（2.1 度），所以數值屬於估計，並非 Apple 偵測器輸出。

每張卡片只有一個**對照全部內嵌資料**入口，包括已有質感／顆粒、檔案逐位元組不改動的照片。
輸入與輸出使用統一項目清單，缺少的項目顯示「不存在」。
此面板從實際 HEIC 讀取遮罩、比例、統計與 ROI／編號特徵點幾何。
每個標籤顯示譯名及技術名稱。差異涵蓋酬載位元組、屬性與 essential 標記、屬性順序和影像關聯。
精簡的 `references` 摘要列出關聯類型與目標數量：
`["auxl", 1]` 變成 `["auxl", 2]` 表示一個目標變為兩個，不是項目重新編號。
移植的輔助圖可能在保留編碼像素的同時連到主圖與 tmap。
部分深度圖／遮罩移植還會改變描述屬性順序或 essential 標記；對照會列出這些變化，
不宣稱 Apple 算繪結果等效。僅憑覆蓋率相同不能證明編碼資料一致。

本次執行了瀏覽器人臉偵測時，同一面板還會提供可折疊的**偵測疊圖（未內嵌）**及 PNG 下載。
藍色表示人物、紅色表示皮膚、綠色表示人臉特徵點。
這是推論預覽，可能與輸出中保留的來源原生遮罩不同；沒有執行偵測時隱藏此區域。

清單涵蓋 HDR 增益圖、風格差異圖、tmap、styles 與 texture_styles plist、
`TextureStylePostProcessedPeopleData`、人像深度、六種舊版人像／語意遮罩、全部十二種
2026 遮罩、`semanticpersoninstances`、三個遮罩提示／比例，以及七組人物／皮膚統計，
每組包含九個百分位數欄位。直接 HEVC 遮罩在 WebCodecs 支援時解碼為影像；
分塊圖與中繼資料項目顯示結構或 JSON，不將它們當作語意遮罩。

## 獨立的 10-bit 線性縮圖

沒有風格資料的 HEIC 與一般圖片匯入會產生保留寬高比、最長邊 1024 像素的獨立縮圖。
Display P3 Canvas 優先提供 Float16 像素，移除 sRGB／P3 傳遞曲線後，直接量化成
10-bit I420P10：受限範圍 Y=64–940、Cb/Cr=64–960。瀏覽器內的 FFmpeg.wasm／x265
以 lossless 模式編碼，SPS、hvcC、pixi 與 nclx 一致宣告 10-bit、P3 原色、linear 傳遞、BT.709 矩陣。
這不是先編碼 8-bit 再補上 10-bit 標籤；如果 Canvas 只能提供 8-bit 來源像素，輸出的精度仍受來源限制。
已有攝影風格的原生照片保留其原有線性縮圖。函式庫呼叫也可明確指定 8-bit WebCodecs 編碼。

## 從欄位產生 profile 與資源快取

`generated-profile.js` 從明文欄位建立 ftyp、meta、MakerNote／styles binary plist 與 XMP。
`synthetic-hevc.js` 從數值常數產生中性差異圖塊及全零遮罩，並在瀏覽器內編碼。
質感資料由欄位序列化，啟動時使用程式內的產生範本索引。

缺少攝影風格的 HEIC，以及 PNG／JPEG／WebP／DNG (ProRAW) 匯入，會套用自行產生的 profile；
進度會列出 `45-15`／`48-12` 的產生或本頁重用步驟，完成結果也會標示已套用的範本。
已有攝影風格的 HEIC 保留原有風格，僅補上自行產生的質感與顆粒資料；已有質感與顆粒時不產生新檔。

編碼器使用固定版本 `@ffmpeg/core-mt@0.12.10`，loader、WASM 與 pthread worker 都會核對 SHA-256。
首次使用按需下載約 33 MB 的公開程式，之後使用持久快取；照片與產生的 profile 不寫入該快取。
「管理資源快取」可查看與刪除 ONNX Runtime 執行環境、ONNX 模型和 FFmpeg.wasm／x265。
刪除目前編碼器會釋放 worker 與記憶體中的產生資料，下次需要時重新下載。
多執行緒 WASM 需要安全環境與跨來源隔離，網站 Service Worker 會提供隔離標頭。

Apple 私有欄位採明文常數與中性預設值。產生的風格資料會寫入輸出 HEIC，輸出會標示範本為實驗性。
檔案結構、來源像素保留和 HEVC 編碼測試不能證明 Apple 的風格呈色正確，仍需在 Apple Photos 實機驗證。

中性 StyleDeltaMap 圖塊使用 Display P3 Linear 編碼與色彩標記，獨立 FFmpeg 色彩轉換驗證其中性值約為 0.502。
`ipma` 屬性索引超過 127 時使用 15-bit 索引，並保留項目關聯與 essential 標記。
輸出會檢查獨立縮圖的尺寸、方向、像素與編碼／色彩描述，不符時停止輸出。
逐位元組相同的影像屬性共用，未引用的屬性在輸出前清除；修改個別影像只更新該影像的引用。
函式庫使用者在呼叫同步 `addTexture()`／`buildRasterHeic()` 前需先 `await generateSyntheticHevc()`；網站會自動完成。
解碼器測試快取依套件版本命名，並檢查實際執行的核心版本。

## iPhone 注意事項

流程處理了兩種 iOS 行為：

- **從照片圖庫選取。** 選取照片時，點按底部的「顯示所選照片」→「選項」→「格式」，將「自動」改成「目前」，
  即可保持照片現有格式。HEIC 照片可使用 HEIC 中繼資料移植路徑，也可透過「瀏覽」直接選擇 HEIC 檔案。
  JPEG／PNG／WebP 照片在 Safari 提供 HEVC WebCodecs 時使用本機匯入路徑。
- **將結果存回「照片」。** 瀏覽器支援檔案分享時，「儲存到『照片』」按鈕會將完成的 `.heic`
  交給原生分享面板，透過「儲存影像」存入圖庫；旁邊也提供一般檔案下載。

請將輸出以**檔案**形式傳到 iPhone，避免傳輸過程轉成 JPEG 遺失中繼資料。
在「照片」開啟儲存的副本並選擇**編輯**。質感／顆粒需要 iOS 27。

## 編輯介面文字

頁面兩種語言的文字集中在 `web/src/i18n.js`。
`web/index.html` 的元素透過 `data-i18n` 鍵，在載入時及切換語言時填入文字。

```bash
python tools/serve_web.py   # 編輯 web/src/i18n.js 後重新載入
node tests/web/check-i18n.mjs       # 修改後檢查
```

檢查器會發現兩類通常在切換語言後才出現的問題：只在一種語言新增鍵，
以及 `web/index.html` 使用了已經不存在的鍵。

新增第三種語言需要在 `STRINGS` 加入相同鍵的語言區塊；目前按鈕只在兩種語言間切換，
因此還需小幅修改 `web/app.js` 的切換邏輯。

## 正確性驗證

使用 Node.js 22 或更新版本執行獨立回歸測試，不需要安裝 npm 相依套件：

```bash
npm test
```

檢查範圍包括 PWA 資源與文字、錯誤分類、人臉遮罩／人物中繼資料、方向屬性、
原生與舊版遮罩、一般圖片匯入／色彩／Exif、質感偏移及 Service Worker 隔離。
需要可選本機照片的案例會跳過，不影響其餘測試。

其他測試需要額外的本機工具或照片：

```bash
node tests/web/basic-workflow-browser.mjs # Playwright 與 native-style.heic
node tests/web/libheif-api.mjs            # 下載指定版本解碼器並驗證實際核心版本
node tests/web/dng-browser.mjs            # Playwright，首次執行下載固定版本 LibRaw WASM
node tests/web/decoder-browser.mjs        # Playwright、FFmpeg 與 tests/web/.cache/libheif-1.23.5.js（1.23.5）
node tests/web/generated-profile-browser.mjs # Playwright 與本機 FFmpeg；WASM 編碼、像素比對、離線與資源快取
node tests/web/download-ort-fixtures.mjs  # 下載並核對公開 ONNX Runtime 與模型測試檔案
node tests/web/ort-vision-browser.mjs     # 實際 WASM 推論、遮罩、完整性檢查與快取
node tests/web/model-options-browser.mjs # 柔膚開關與 ONNX Runtime 選取照片後轉成 HEIC 的流程
node tests/web/model-cache-restart-browser.mjs # 瀏覽器重啟、離線推論與快取刪除
node tests/web/linear8.mjs                # 支援 HEVC 編碼的本機 FFmpeg
node tests/web/hevc-range-native.mjs      # 真實 HEVC 範圍校正、缺少 VUI 與錯誤回報回歸
node tests/web/generic-graft.mjs          # 不同分塊配置的照片樣本
node tests/web/direct-hdr.mjs            # 獨立 HDR 樣本
node tests/web/source-consistency.mjs    # 原生、分塊 HDR 與獨立 HDR 樣本
node tests/web/gain-map.mjs              # HDR 照片樣本（另有合成檢查）
node tests/web/inspection-compare.mjs    # processed-style.heic
node tests/web/portrait-matte.mjs        # native-style.heic
```

照片樣本保持本機儲存，在 Git 忽略的 `tests/private-fixtures/` 目錄中按各測試
指定的檔名與配置提供。缺少照片時，相關測試可能跳過項目或失敗。
Playwright 需單獨安裝，可透過 `PLAYWRIGHT_MODULE` 和 `PLAYWRIGHT_EXECUTABLE`
指定已有執行環境與瀏覽器。`linear8.mjs` 可使用 `FFMPEG_EXECUTABLE` 指定編碼器。
`generated-profile-browser.mjs`、`decoder-browser.mjs` 與 `hevc-range-native.mjs` 也可使用 `FFMPEG_EXECUTABLE` 指定本機 FFmpeg。
`dng-browser.mjs` 使用自行產生的 DNG（包含 5000 萬像素分塊 RAW），搭配真實 LibRaw WASM、ONNX Runtime 與 FFmpeg 線性縮圖，並驗證 WASM 階段不重疊、記憶體不足時保留原生遮罩及完整耗時；主圖 WebCodecs 編碼使用測試替身。可用 `DNG_SAMPLE_FILE` 加測本機照片，並以 `DNG_CORE_DIR`、`FFMPEG_CORE_DIR`、`ORT_FIXTURE_DIR` 指定已下載的資源目錄。測試不會上傳照片。

`decoder-browser.mjs` 執行前需先執行 `libheif-api.mjs` 下載指定版本的解碼器。

ONNX Runtime 測試使用公開照片與已核對的模型；先執行 `node tests/web/download-ort-fixtures.mjs` 將測試素材下載到本機，可用 `ORT_FIXTURE_DIR` 指定目錄。這些素材不包含在 repo 中。
照片匯入流程及 profile 編碼測試會使用 FFmpeg 核心，可用 `FFMPEG_CORE_DIR` 指定已下載的本機核心。

一般測試與解碼失敗測試 `degrade.mjs` 使用自行產生的範本。
`degrade.mjs` 另需本機照片樣本，輸入放在 `noSmartStyle/` 或 `noSmartStyle-people/`。

原生照片測試涵蓋光暈／底片所需的 v16 風格結構與恆等 tone curve，並檢查影像酬載保留。
遮罩產生流程的測試檢查結構及中繼資料，實際手機算繪仍需在真實裝置驗證。

## 檔案結構

| 檔案 | 用途 |
|---|---|
| `web/src/box.js` | ISO-BMFF box 讀寫 |
| `web/src/heif.js` | `iloc`／`iinf`／`iref`／`ipma`／`ipco` 項目圖結構的發現與修改 |
| `web/src/native-mattes.js` | 內嵌 iPhone 18 語意遮罩的唯讀 WebCodecs 檢視器 |
| `web/src/dng-decode.js` | 本機 LibRaw WASM DNG 顯影、完整性核對與工作執行緒管理 |
| `web/src/dng-inspection.js` | 原始 DNG 目錄、預覽、語意遮罩、顯影增益表與曲線檢視 |
| `web/src/dng-mattes.js` | 原生 DNG 遮罩對齊、沿用與 HEIC 編碼 |
| `web/src/dng-tiles.js` | 大張 LinearRaw 分塊輸入與相機色彩校正資料保留 |
| `web/src/dng-tiff.js` | DNG 辨識、壓縮格式檢查與精簡 Exif 中繼資料擷取 |
| `web/src/raster-import.js` | 本機 Canvas／WebCodecs PNG／JPEG／WebP／DNG 轉 HEIC 編碼與容器組裝 |
| `web/src/linear-thumbnail.js` | P3 線性化與 10-bit 輔助圖編碼 |
| `web/src/raster-color.js` | 明確 P3／sRGB RGB 轉 I420，以及 HEIC 色彩標記 |
| `web/src/bplist.js` | Apple 二進位 plist 讀寫 |
| `web/src/exif.js` | 注入 MakerNote `0x54`，保留來源 Exif |
| `web/src/styles.js` | 場景統計、`c`／`d` 光照圖與人物遮罩提示 |
| `web/src/zip.js` | ZIP 範本序列化與讀取 |
| `web/src/port.js` | 移植流程 |
| `web/src/texture.js` | iOS 27 質感／顆粒（texture_styles 與 2026 遮罩）及原生照片寫入 |
| `web/src/decode.js` | 分析與檢視共用的 WebCodecs／延遲載入 asm.js 解碼 |
| `web/src/generated-profile.js` | 從欄位建立範本結構與中繼資料 |
| `web/src/synthetic-hevc.js` | 從明確像素數值產生範本素材 |
| `web/src/ffmpeg-hevc.js` | FFmpeg.wasm／x265 本機編碼與資源快取 |
| `web/src/ort-vision.js` | ONNX Runtime 人臉偵測、特徵點與分割 |
| `web/src/ort-inference-worker.js` | 可終止的 ONNX Runtime 推論與 WASM 記憶體管理 |
| `web/src/ort-assets.js`、`web/src/ffmpeg-assets.js` | 公開元件與模型的固定網址及 SHA-256 |

`web/src/port.js` 透過回呼使用解碼器，使容器修改獨立於 libheif，
也讓 `port.js` 可在 Node 環境中直接執行對照測試，不必修改程式。

## 圖塊配置支援與限制

產生範本支援 48/12 與 45/15 的主圖／HDR 圖塊配置，符合條件的來源直接使用對應設定。
主圖配置相符、HDR 增益圖為單一獨立 `hvc1` 項目時也支援：
瀏覽器逐位元組保留該增益圖酬載、編碼設定、尺寸、方向與輔助關聯。

其他許多含 1–48 個主圖圖塊的來源，會選擇主圖槽足夠、分塊 HDR 數量相同的範本 進行一般移植。
來源主圖／HDR 酬載保留，只建立缺少的輔助圖。
例如 42/15 使用 45/15 範本，並移除三個未使用的主圖槽。
移植會檢查圖結構，重複使用產生範本的風格中繼資料與中性差異圖塊。
具有有效 Exif、但缺少 Apple MakerNote 的 HEIF／HEIC 照片與螢幕截圖，也可使用此處理流程。
會保留原有 Exif 欄位、方向與尺寸，並補上含攝影風格標記的最小 Apple MakerNote；
已有 Apple MakerNote 時只注入風格標記。
未知分塊 HDR 圖結構、超過 48 個主圖圖塊、缺少 Exif、不支援的 HEIF box 配置，
以及沒有縮圖且方向變換不是恆等的組合，會盡可能使用相容重編碼；否則顯示明確錯誤。

來源需要相容重編碼且包含 Apple 人像深度輔助圖時，退回流程會保留其原始 HEVC 位元串流、尺寸、
編碼／方向屬性、`auxl` 關聯，以及附屬的 XMP 虛化中繼資料，不會直接丟棄深度圖。

## 授權條款與來源

LibRaw WASM 使用 `libraw-wasm` 的 ISC 授權、LibRaw 的 CDDL 1.0 授權與 Little CMS 的 MIT 授權；來源與條款見 [LibRaw-LICENSES.txt](LibRaw-LICENSES.txt)。

[MIT](LICENSE)。本專案基於 [nathanatgit/Shalielie](https://github.com/nathanatgit/Shalielie)
的瀏覽器實作，包含
62fc5f33d05e2fe595f926a1131e9f4f5cc2b360 的已提交 v0.6 改動，保留上游版權聲明。

MediaPipe 人臉標準座標與姿態幾何參考，以及參考 [yakhyo/mediapipe-face-mesh-onnx](https://github.com/yakhyo/mediapipe-face-mesh-onnx) 改寫的 BlazeFace 解碼程序，使用 [Apache License 2.0](web/Apache-2.0.txt)。相關來源版權為 The MediaPipe Authors（2019／2020）與 Yakhyokhuja Valikhujaev（2026）。

HoLanLa 與 Apple 無關聯，也未獲其認可。Apple、iPhone、Apple Photos 和 Photographic Styles
為 Apple Inc. 商標。專案不包含 Apple 軟體或 SDK，實驗性輸出在不同照片與裝置上可能表現不同。
