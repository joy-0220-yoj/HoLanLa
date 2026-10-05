# HoLanLa

**繁體中文** | [English](README.en.md)

版本：v0.7.0

HoLanLa 是實驗性的瀏覽器照片工具，為支援的照片加入攝影風格和 iOS 27 質感／顆粒中繼資料。
處理完全在你的裝置上進行，照片不會上傳。請保留原片，使用副本操作。

和原始專案 [nathanatgit/Shalielie](https://github.com/nathanatgit/Shalielie) 一樣，
HoLanLa 也是透過 **vibe coding** 開發而來：以自然語言描述需求，搭配 AI 協助撰寫與修改程式。

**[開啟 HoLanLa](https://joy-0220-yoj.github.io/HoLanLa/)**

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

支援匯入任何手機或相機拍攝的照片，以及螢幕截圖，格式包括 HEIC、PNG、JPEG、WebP。
實際能處理哪些檔案，仍取決於瀏覽器的解碼與 HEVC 編碼支援。

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
沒有風格資料的照片透過設定檔移植，並產生獨立的 8-bit 線性縮圖。

內嵌資料對照檢查實際輸入／輸出的中繼資料、項目酬載與遮罩。

驗證：使用已有 Playwright 環境執行 `node tests/web/basic-workflow-browser.mjs`，
可檢查一般原生輸出的逐位元組一致性、對照，以及 320／390 像素寬度的配置。
`node tests/web/linear8.mjs` 使用外部安裝的 FFmpeg 測試程式驗證真實 HEVC 樣本；網站不附帶 FFmpeg。

## 本機執行

```bash
git clone https://github.com/joy-0220-yoj/HoLanLa.git
cd HoLanLa
python tools/serve_web.py
```

開啟 `http://localhost:8000/`。靜態網站不需要建置或安裝執行階段相依套件。
Python 僅供可選的開發伺服器使用，照片轉換器以 JavaScript 在瀏覽器執行。

## 部署

[.github/workflows/pages.yml](.github/workflows/pages.yml) 會在推送到 `main` 或 `master`、且涉及網站、測試或部署設定時，檢查並發布 `web/` 到 GitHub Pages。
首次在 **Settings → Pages → Source → GitHub Actions** 中啟用即可。
沒有建置步驟；上傳前工作流程會檢查：

- `web/` 下沒有 `.heic`／`.heif` 檔案，避免發布個人照片。
- 兩個 donor 設定檔存在且非空。
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
`web/sw.js` 預快取完整轉換器、兩個 donor 設定檔，以及全部第一方 JavaScript。
路徑保持相對形式，可用於網域根目錄或 GitHub Pages 專案子路徑。

網站檔案優先存取網路，失敗後使用已儲存的副本，兼顧更新與離線使用。
Google MediaPipe 的 JavaScript 執行元件／載入指令碼、WASM 運算引擎、人臉模型與分割模型，
在首次使用成功下載後會儲存到本機持久快取，後續先從快取讀取，關閉瀏覽器後再開啟也能重複使用。
這份資源快取與網站版本分開，網站更新不會刪除；資源網址或資源快取版本更換時才需重新下載。
畫面會區分「正在下載」與「從本機快取載入」。快取只包含公開元件與模型，不儲存照片。
重新開啟仍須初始化運算引擎與模型實例。

三項資源都使用固定版本網址：MediaPipe Tasks Vision／WASM 為 `0.10.22-rc.20250304`，
Face Landmarker 為 `1`（float16），SelfieMulticlass 為 `1`（float32）。不同版本以完整網址分開快取。
開啟照片選取區下方的**管理模型快取**，可查看版本、本機儲存狀態與大小；本頁使用版本、
其他已快取版本及先前未固定版本的 `latest` 檔案會分別列出，不會將 `latest` 當作已驗證的版本 1。
可個別刪除某個版本，或按**刪除全部模型快取版本**一次清除，包含各版本的 MediaPipe JavaScript 執行元件。
刪除會排在目前照片處理之後；若刪除本頁使用的版本，也會釋放對應的記憶體實例，下次需要時重新下載。

無痕模式、清除網站資料或瀏覽器回收儲存空間可能使快取消失；無法使用或寫入快取時，
畫面會提示下次可能需要重新下載。詳見 [Cache API 的儲存限制](https://developer.mozilla.org/en-US/docs/Web/API/Cache)。
可選 libheif 解碼器仍不在持久快取範圍內。
解碼器不可用時，照片分析會退回到經過測試的 donor 統計路徑。

修改執行階段檔案或 manifest 後，檢查離線資源清單是否完整：

```bash
node tests/web/check-pwa.mjs
```

## 網站包含哪些內容

目前網站不載入或附帶 FFmpeg WASM、ffprobe WASM 或 FFmpeg Worker。
新的 HEVC 主圖、輔助圖、遮罩，以及 8-bit 線性縮圖使用 WebCodecs 編碼；
線性縮圖的 SPS 色彩標記由 JavaScript 修改。
部分可選本機驗證測試使用原生 FFmpeg，但網站不依賴它。
MediaPipe 的 WASM 執行環境用於本機推論，與 FFmpeg 無關。

| 項目 | 內容 |
|---|---|
| 組成 | 第一方 JavaScript 與兩個精簡 donor 設定檔，不附帶 FFmpeg |
| 請求 | `web/index.html`、`web/app.js`、第一方模組，以及每種照片配置所需的設定 |
| 外部相依項 | 可選解碼器與可選 MediaPipe 執行環境／模型，詳見下節 |
| 代管 | localhost 的本機 HTTP 或代管 HTTPS 網站；開發伺服器或 Service Worker 提供 COOP／COEP |

## 可選的外部相依項

HEIC 人臉、色彩／亮度分析與輔助圖檢視固定使用自動解碼流程。
先使用 WebCodecs VideoDecoder，無法解碼或無法處理外層色彩／裁切設定時，
才從 jsDelivr 載入 libheif-js 1.18.2 的傳統 JavaScript／asm.js 版本。
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
解碼模式測試選單已移除，先前儲存的手動選擇不再生效。
進度紀錄仍會保留解碼／編碼來源與自動備援原因。
HEIC 缺少縮圖、產生線性縮圖及完整重新編碼的來源輸入，仍先嘗試
`createImageBitmap()`／`Image.decode()`；原生解碼失敗時才使用上述自動解碼流程。
備援直接產生帶色彩管理的 Display P3 畫布，不經過會裁切色域的 sRGB 中間圖。
asm.js 來源備援支援標準 sRGB／Display P3 ICC（含線性曲線）及已知 SDR nclx／SPS 色彩；
無法辨識的 ICC、HDR 曲線或色彩衝突會明確失敗，避免產生色彩錯誤的照片。
獨立線性縮圖仍先隔離 SDR 主圖，不套用 gain map；鏡像與旋轉會還原至原始儲存方向。
只缺少中性 HDR 輔助圖時不需要解碼照片。HEVC 編碼及黑白範圍校正維持使用 WebCodecs。

Windows／Edge 能解碼 HEIC，不代表能透過 WebCodecs 編碼 HEVC。libheif-js asm.js
只提供解碼，無法補上 HEVC 編碼器。網站會依實際尺寸探測 HEVC Main8 的
可變／固定位元率、quality／realtime、硬體／作業系統編碼器與不同 level 設定。
產生缺少的縮圖、HDR 輔助圖、線性縮圖或重新編碼主圖前，會先檢查所需編碼支援；
全部不支援時提早停止，避免為無法完成的輸出下載解碼器或解碼整張照片。
保留已有影像項目的容器修改路徑仍可使用；新增影像項目需要可用的 HEVC 編碼器。

asm.js 備援仍在主執行緒解碼完整解析度，再縮小供分析；大照片可能暫時阻塞操作。
解碼後的影像會保留在快取中供後續處理重複使用。
獨立輔助圖會先隔離成主要影像，保留原始壓縮資料、色彩與方向屬性，避免誤解碼成照片主圖。

這些請求下載處理程式碼，照片資料保留在本機。可選場景分析失敗時使用 donor 統計和中性光照圖，
這也是參考輸出進行確定性對照時的設定。
需要解碼像素或新 HEVC 影像的路徑，仍需可用的解碼器／編碼器；不可用時會顯示錯誤。

若要從本機提供解碼器，可將相同版本的傳統版本放入專案，並將 `LIBHEIF_URL` 指向它：

```bash
npm pack libheif-js@1.18.2
tar -xzf libheif-js-1.18.2.tgz
mkdir -p web/vendor
cp package/libheif/libheif.js web/vendor/
```

只有開啟「實驗性柔膚支援」時，`web/src/face-mattes.js` 才會為人臉資料或缺少的人像效果遮罩視需要下載
**Google MediaPipe** 的執行環境與模型。下載／初始化狀態會顯示 Google 與完整元件名稱：

| 下載項目 | 用途 | 約略大小 |
| --- | --- | --- |
| Google MediaPipe Tasks Vision JavaScript 執行元件 | 在瀏覽器載入與操作 MediaPipe 執行環境及模型。 | 依實際下載為準 |
| Google MediaPipe Tasks Vision WASM 運算引擎 | WebAssembly 格式的底層運算程式，供人臉與分割模型共用，在本機執行推論。 | 9.6 MB |
| [Google MediaPipe Face Landmarker](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js) 人臉與特徵點模型 | 偵測人臉位置與特徵點，提供人物 ROI／特徵點中繼資料。 | 3.8 MB |
| [Google MediaPipe SelfieMulticlass](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter) 六分類影像分割模型 | 逐像素分辨背景、頭髮、身體皮膚、臉部皮膚、衣服與其他／配件，提供各分類的信心值，用於產生皮膚與人物遮罩。 | 16.4 MB |

WASM 引擎與兩個模型合計約 **29.8 MB**，另需載入 JavaScript 元件。
大小取自目前檔案的實際下載測量；畫面上的大小與百分比以當次下載回應為準。
推論在瀏覽器內完成，下載請求不會發送照片。
取消勾選柔膚支援後，不會下載或初始化 MediaPipe JavaScript 執行元件、WASM、人臉模型或分割模型，
也不會使用已載入的模型做推論；原圖已有的人像效果遮罩仍會保留，缺少的遮罩則省略。
「分析照片內容」控制照片分析與風格資料調整，不會單獨啟動 MediaPipe。
柔膚支援開啟時，若只補建人像效果遮罩，需要分割器，不需要 Face Landmarker。
模型準備會分別顯示執行環境載入、WASM／人臉模型／分割模型下載，以及 GPU／CPU 初始化。
下載時顯示已收到的大小；伺服器提供總大小時顯示百分比與進度條，未提供時顯示大小與等待進度條。
下載完成後改顯示初始化狀態，初始化沒有可量測的百分比。
首次使用所需時間取決於網路與裝置；同一頁面後續照片會重複使用已建立的模型。
下載連續 30 秒沒有收到資料便中止；執行環境模組載入最多等待 60 秒，非同步初始化最多等待 120 秒。
同步 WASM 工作會佔用主執行緒，執行期間無法立即顯示逾時提示。
失敗時會指出相關資源並保留錯誤；可檢查連線後重新處理照片。
共用執行環境或分割模型失敗後，同一張照片不會再為人像效果自動重試一次。
重新載入頁面或重開瀏覽器仍需建立模型實例；WASM 與模型檔案優先從本機持久快取讀取。
Face Landmarker 優先使用 GPU，初始化失敗後改用 CPU；SelfieMulticlass 使用 CPU。
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
此規則適用於兩個 donor 設定檔、加入質感／顆粒的原生風格照片，以及 HEIC 相容重編碼。
只有來源沒有皮膚遮罩時，才用瀏覽器產生的信心值供給兩代語意遮罩，包括 PNG／JPEG／WebP 匯入。
不會將 donor 遮罩當成來源原生皮膚資料。
產生的遮罩只是近似結果；將舊版像素複製到 v2 項目並不會重現 Apple 的 v2 分割模型。
其他項目的共用屬性保持不變。

人物信心值會依據最近的偵測人臉劃分為 `semanticpersoninstances`。
信心值圖在保留寬高比的前提下平滑重新取樣，最長邊為 768 像素，尺寸為適合 HEVC 的偶數。
旋轉與鏡像將其轉換為儲存方向；每個產生的遮罩和人物實例都有相符的 HEVC 尺寸與獨立 `ispe`。
PNG／JPEG／WebP 的人臉分析也保留來源寬高比；空遮罩退回保留參考的 768×576 尺寸。
流程還會計算 styles plist 中的人物／皮膚覆蓋率與統計，為每張偵測人臉建立實例遮罩，
並將每張人臉的 ROI、色彩、粗糙度和實例遮罩關聯寫入 `TextureStylePostProcessedPeopleData`。
76 個特徵點按照原生參考樣本推斷出的原生順序排列：左右眼、左右眉毛、外／內嘴唇、
鼻樑／鼻底，最後是從右太陽穴到左太陽穴的臉部輪廓。
單一 MediaPipe 點位是對 Apple 私有偵測結果的近似；分組邊界與陣列位置保持穩定。
Face Mesh 輪廓提供鼻部、嘴唇、眉毛和近似耳朵遮罩；嘴部像素用於保守的牙齒遮罩；
分割器的配件信心值限制在眼部區域以產生眼鏡遮罩；臉／頸核心以外的非臉部身體皮膚
用於保守的手部候選區域。刺青遮罩保持為空，直到有可靠分類器能避免把陰影和衣物誤認為刺青。
所有產生的資料仍屬實驗性，尚未在手機上驗證與 Apple 私有分割結果等效。

偏航、俯仰、翻滾來自 MediaPipe 以欄為主序的標準臉到目前臉變換矩陣。
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

## 獨立的 8-bit 線性縮圖

沒有風格資料的 HEIC 與一般圖片匯入，會編碼獨立且保留寬高比的縮圖，最長邊為 1024 像素。
Display P3 Canvas 提供經過色彩管理的像素；明確轉換為完整範圍的輸入 YUV 前，先移除 sRGB／P3 傳遞曲線。
編碼使用 8-bit I420 像素與 WebCodecs HEVC Main。
為相容不接受 linear 傳遞標記的 VideoFrame，已經線性化的原始像素在編碼時使用與編碼器協商的
SDR 傳輸標記。黑白校正影格會在提交真實線性像素前，確認編碼器的傳遞曲線與 YUV 矩陣，
並使用本機 WebCodecs 解碼器讀取原始 YUV 亮度，量測實際輸出的全／受限範圍。
線性 RGB 直接轉換為協商後的 BT.709 或 BT.601 YUV，不再次進行 gamma 編碼。
隨後由 JavaScript 修改 SPS VUI，將原色設為 P3、傳遞特性設為 linear，不改變影像 NAL，
並在 SPS 與 HEIC nclx 中保留協商的矩陣／範圍。
原色、傳遞曲線與矩陣以實際 SPS 欄位優先；亮度範圍以解碼後的黑白端點為準。
瀏覽器可能回報完整範圍但輸出 16–235 的受限範圍，不能將輸入的完整範圍直接當成輸出範圍。
協商後色彩變化或 SPS 不一致會被拒絕。
輸出保留 P3 原色、線性傳遞特性及協商的 YUV 矩陣／範圍。
回傳的 hvcC、實際 SPS 與 pixi 必須一致宣告為 8-bit；HEIC 為此輔助圖寫入獨立 hvcC、pixi、ispe 與 nclx。

不支援的 Canvas 格式、編碼失敗或色彩中繼資料變化都會停止轉換並顯示明確錯誤。
已有攝影風格的原生照片保留其原有線性縮圖，包括原生 10-bit 資料。
優先使用 Float16 Canvas 像素；這是實驗性的輔助圖重建。

網頁版提供實驗性一般 HEIF 圖結構移植，適用於許多含 1–48 個主圖圖塊的無風格 HEIC，
HDR 可以不存在、為單一獨立項目，或為圖塊數量能對應現有 donor 的分塊圖。
它改寫 donor 的項目圖結構與 grid 描述以符合來源配置，同時逐位元組複製原始主圖及可對應的 HDR HEVC 圖塊。
來源沒有縮圖或 HDR 增益圖時，WebCodecs 只產生缺少的輔助圖，不重新編碼原始主圖壓縮資料。
分析或新線性縮圖仍可能需要單獨解碼；已驗證的配置包括 42/0、40/0、36/0 與 42/15。

無法安全對應的 HEIC 圖結構，包括目前沒有對應 donor 的分塊 HDR 數量或超過 48 個主圖圖塊，
會退回到 PNG／JPEG／WebP 使用的本機 WebCodecs 相容路徑。
此路徑會重建像素，不能保證一般移植的主圖酬載保留。
grid 根據實際尺寸動態計算，不會為了模仿 donor 的 4032 像素長邊而放大來源。

PNG／JPEG／WebP 沒有可以直接保留的壓縮 HEVC 主圖，因此需要支援 HEVC 的瀏覽器 `VideoEncoder`。
來源像素能容納在 donor 的 48 個項目槽內時，保留原尺寸，計算所需的最小 512 像素圖塊 grid，
並移除未使用的槽。流程也會產生獨立 8-bit 線性縮圖與中性分塊 HDR 增益圖。
超過 48 個圖塊的影像只縮小到剛好能容納的尺寸。
接著加入 v16 攝影風格、質感／顆粒，以及在柔膚支援開啟且本機人臉推論可用時產生的 2026 語意遮罩；
未開啟或不可用時使用空語意遮罩。缺少的人像效果遮罩也只在柔膚支援開啟且人物分割可用時產生，否則省略。
主圖編碼不依賴 Windows 程式、Python 程式或伺服器上傳；新線性縮圖使用 8-bit WebCodecs。
WebP 透過 RIFF／WEBP 檔案識別碼辨識，使用相同流程。
透明像素合成到黑色背景，輸出為靜態 HEIC。
沒有相容 HEVC 編碼器或校正解碼器，或黑白端點無法可靠判定時，會顯示明確錯誤，不提供不完整檔案。
此新編碼路徑仍屬實驗性，與保留原像素的 HEIC 容器修改路徑不同。

一般圖片的色彩明確編碼：Canvas 將來源 ICC／Display P3 色彩管理到 sRGB。
瀏覽器 HEVC 編碼器即使收到 P3 輸入，也可能回傳 BT.709 原色，所以此重編碼路徑以 sRGB／BT.709 色域為目標。
每批編碼前使用同一編碼器、相同尺寸的完整範圍黑白校正影格，再捨棄該影格。
SPS 與回傳描述決定真實 RGB 轉換為 I420 時使用的傳遞曲線（sRGB 或 BT.709）及
YUV 矩陣（BT.709 或 BT.601）；輸入像素保持完整範圍，輸出範圍由本機解碼後的原始亮度量測。
`web/src/hevc-color.js` 不做 RGB 轉換或範圍正規化，直接讀取原生 I420／NV12 的黑白端點，
避免瀏覽器回報與真實位元串流不同時把黑色顯示成灰色。量測值寫入 HEIC 的 `nclx`。
探測影格不進入照片，也不計入圖塊數量。
主圖圖塊、主圖 grid、tmap、一般縮圖與中性增益圖使用編碼器自身的色彩描述，不沿用 donor ICC。
編碼器回傳矛盾的色彩中繼資料時匯入會失敗，不會輸出標記錯誤的照片。
已有 HEIC 的主圖位元串流保留。

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

其他測試需要額外的本機工具或照片：

```bash
node tests/web/basic-workflow-browser.mjs # Playwright 與 native-style.heic
node tests/web/decoder-browser.mjs        # Playwright、FFmpeg 與 tests/web/.cache/libheif.js（1.18.2）
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

保留的歷史對照工具 `compare.mjs`、`diff.mjs` 與 `degrade.mjs` 供持有原始本機
照片樣本的開發者使用；輸入放在 `noSmartStyle/`、`noSmartStyle-people/` 或 `Smartstyle/`。
`compare.mjs` 與 `diff.mjs` 另需 `tests/web/ref/` 的已儲存參考 HEIC。
參考檔案需另外提供，HoLanLa 不包含 Python 轉換器。

原生照片測試涵蓋光暈／底片所需的 v16 風格結構與恆等 tone curve，並檢查影像酬載保留。
遮罩產生流程的測試檢查結構及中繼資料，實際手機算繪仍需在真實裝置驗證。

## 檔案結構

| 檔案 | 用途 |
|---|---|
| `web/src/box.js` | ISO-BMFF box 讀寫 |
| `web/src/heif.js` | `iloc`／`iinf`／`iref`／`ipma`／`ipco` 項目圖結構的發現與修改 |
| `web/src/native-mattes.js` | 內嵌 iPhone 18 語意遮罩的唯讀 WebCodecs 檢視器 |
| `web/src/raster-import.js` | 本機 Canvas／WebCodecs PNG／JPEG／WebP 轉 HEIC 編碼與容器組裝 |
| `web/src/linear-thumbnail.js` | P3 線性化與 8-bit 輔助圖編碼 |
| `web/src/raster-color.js` | 明確 P3／sRGB RGB 轉 I420，以及 HEIC 色彩標記 |
| `web/src/bplist.js` | Apple 二進位 plist 讀寫 |
| `web/src/exif.js` | 注入 MakerNote `0x54`，保留來源 Exif |
| `web/src/styles.js` | 場景統計、`c`／`d` 光照圖與人物遮罩提示 |
| `web/src/zip.js` | 透過 `DecompressionStream` 讀取 donor 設定檔 |
| `web/src/port.js` | 移植流程 |
| `web/src/texture.js` | iOS 27 質感／顆粒（texture_styles 與 2026 遮罩）及原生照片寫入 |
| `web/src/decode.js` | 分析與檢視共用的 WebCodecs／延遲載入 asm.js 解碼 |
| `web/profiles/` | 網站內建的兩個 donor 設定檔 |

`web/src/port.js` 透過回呼使用解碼器，使容器修改獨立於 libheif，
也讓 `port.js` 可在 Node 環境中直接執行對照測試，不必修改程式。

## 圖塊配置支援與限制

兩個精確 donor 圖結構仍是 48/12 與 45/15，符合條件的來源直接使用對應設定。
主圖配置相符、HDR 增益圖為單一獨立 `hvc1` 項目時也支援：
瀏覽器逐位元組保留該增益圖酬載、編碼設定、尺寸、方向與輔助關聯。

其他許多含 1–48 個主圖圖塊的來源，會選擇主圖槽足夠、分塊 HDR 數量相同的 donor 進行一般移植。
來源主圖／HDR 酬載保留，只建立缺少的輔助圖。
例如 42/15 使用 45/15 donor，並移除三個未使用的主圖槽。
這不是重建所有不透明 Apple 設定資料的公式，而是經過結構檢查的明確圖結構改寫，
並重複使用 donor 風格中繼資料與中性差異圖塊。
未知分塊 HDR 圖結構、超過 48 個主圖圖塊、缺少 Apple Exif、不支援的 HEIF box 配置，
以及沒有縮圖且方向變換不是恆等的組合，會盡可能使用相容重編碼；否則顯示明確錯誤。

來源需要相容重編碼且包含 Apple 人像深度輔助圖時，退回流程會保留其原始 HEVC 位元串流、尺寸、
編碼／方向屬性、`auxl` 關聯，以及附屬的 XMP 虛化中繼資料，不會直接丟棄深度圖。

## 授權條款與來源

[MIT](LICENSE)。本專案基於 [nathanatgit/Shalielie](https://github.com/nathanatgit/Shalielie)
的瀏覽器實作，包含
62fc5f33d05e2fe595f926a1131e9f4f5cc2b360 的已提交 v0.6 改動，保留上游版權聲明。

HoLanLa 與 Apple 無關聯，也未獲其認可。Apple、iPhone、Apple Photos 和 Photographic Styles
為 Apple Inc. 商標。專案不包含 Apple 軟體或 SDK，實驗性輸出在不同照片與裝置上可能表現不同。
