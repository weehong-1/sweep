# Sweep：Chrome Web Store 上架材料

這份文件照開發者後台的分頁順序排列，標示「貼上」的區塊可以直接複製。

後台網址：<https://chrome.google.com/webstore/devconsole>

## 這個資料夾裡有什麼

| 檔案 | 用途 |
|---|---|
| `sweep-chromium-1.0.0.zip` | 上傳用的擴充功能套件。用 `..\package-chromium.ps1` 重新產生 |
| `images\en\1-popup.png`、`2-settings.png`、`3-dark.png` | 英文截圖，1280×800 |
| `images\zh_TW\1-popup.png`、`2-settings.png`、`3-dark.png` | 繁體中文截圖，1280×800 |
| `images\en\promo-small-440x280.png`、`images\zh_TW\promo-small-440x280.png` | 小型宣傳圖，440×280（選填） |
| `images\en\promo-marquee-1400x560.png`、`images\zh_TW\promo-marquee-1400x560.png` | 大型宣傳圖，1400×560（選填） |
| `privacy-policy.md` | 隱私權政策全文，需要放到一個公開網址 |

128×128 的商店圖示已經在壓縮檔裡，不用另外上傳。

## 上架前要先做的事

1. 用 Google 帳號登入後台，同意開發者協議，付一次性的註冊費。
2. 在後台的 **Account** 頁面：
   - 填發布者名稱，並驗證聯絡用的電子郵件。
   - 完成 Trader／Non-trader 聲明。個人、非營利發布選 `Non-trader`。
   - 只有要先以 `Private` 試用時，才需要在 **Trusted testers** 填入要安裝 Sweep 的 Google 帳號電子郵件（自己的也要填）。
3. 把 `privacy-policy.md` 的內容放到一個任何人都能開啟的網址，記下網址。

## 1. Package（套件）

按 **New item**，上傳 `sweep-chromium-1.0.0.zip`。

## 2. Store listing（商店資訊）

名稱和摘要會從套件裡自動帶入（`Sweep`、`Clear browsing data in one click.`），不用填。

**Description（說明）— 英文，貼上：**

```
Sweep clears your browsing data from one small popup. Pick a time range, pick what to clear, press Clean.

WHAT IT CLEARS
Browsing history, download history, cache, form data, cookies, local storage, IndexedDB, service workers and file systems. A dot on each item shows whether it has something to clear.

KEEP WHAT MATTERS
• Keep lists: for each kind of data, choose the sites that are never cleared. Open the magnifier on an item, switch a site on, and its history, downloads, cookies or site data stay when you clean.
• Cookie whitelist: list the sites you trust and their cookies are left alone. The list can be switched off and on without losing it.
• Stay signed in to WhatsApp Web and Telegram Web: their site data is skipped, so you do not have to link your phone or sign in again.

CLEAN AUTOMATICALLY
Switch on "Clean automatically when the browser closes" and Sweep clears the selected items for you. A browser exits before an extension can finish, so the cleaning is completed the next time the browser starts.

CHECK FOR BROWSER UPDATES (OPTIONAL, OFF BY DEFAULT)
If you switch it on, Sweep reads Google's public list of Chrome releases, at most once every 6 hours, and shows a badge when your Chrome is out of date. This is the only time Sweep uses the network, and it sends nothing about you.

PRIVACY
Sweep has no account, no analytics and no ads. Your settings stay on your computer. It reads your browsing history and download history for three things: to show the "has data" dot, to list the sites you can choose to keep, and to remove entries while leaving the kept sites. None of it is sent anywhere.

Available in English and Traditional Chinese, with light and dark themes.
```

**Description（說明）— 繁體中文（選填，在「Add a language」新增 Chinese (Traditional) 後貼上）：**

```
Sweep 用一個小小的彈出視窗清除你的瀏覽資料。選時間範圍、選要清除的項目，按下「清除」就完成。

可以清除的資料
瀏覽紀錄、下載紀錄、快取、表單資料、Cookie、本機儲存空間、IndexedDB、Service Worker 和檔案系統。每個項目上的圓點會告訴你那裡有沒有資料可以清。

保留重要的資料
• 保留清單：每一種資料都可以選擇永遠不清除的網站。點項目上的放大鏡，打開網站的開關，清除時它的瀏覽紀錄、下載紀錄、Cookie 或網站資料就會留下來。
• Cookie 白名單：列出你信任的網站，它們的 Cookie 不會被清除。白名單可以暫時關閉，清單不會消失。
• 保持 WhatsApp Web 和 Telegram Web 登入：清除時跳過它們的網站資料，不用重新連結手機或重新登入。

自動清除
打開「關閉瀏覽器時自動清除」，Sweep 會替你清除選取的項目。瀏覽器會在擴充功能完成前就結束，所以清除會在下次啟動瀏覽器時完成。

檢查瀏覽器更新（選用，預設關閉）
打開之後，Sweep 會讀取 Google 公開的 Chrome 版本清單（最多每 6 小時一次），你的 Chrome 過舊時顯示徽章。這是 Sweep 唯一會連網的時候，不會傳送任何關於你的資料。

隱私
Sweep 沒有帳號、沒有分析追蹤、沒有廣告，設定只存在你的電腦上。它讀取瀏覽紀錄和下載紀錄有三個用途：顯示「有資料可清除」的圓點、列出你可以選擇保留的網站、在清除時留下保留的網站。這些資料不會傳送到任何地方。

提供英文和繁體中文介面，支援淺色與深色主題。
```

**Category（類別）**：選 `Privacy & Security`。如果清單裡沒有，選 `Tools`。

**Language（語言）**：`English`。

**Screenshots（截圖）**：上傳 `images\en\` 裡的三張。新增了繁體中文的話，在該語言下上傳 `images\zh_TW\` 的三張。

**Small promo tile（小型宣傳圖）**：選填，上傳 `promo-small-440x280.png`。公開上架時建議放，商店的搜尋結果和分類頁會用到它。

**Marquee promo tile（大型宣傳圖）**：選填，上傳 `promo-marquee-1400x560.png`。只有擴充功能被商店選為精選時才會用到。

**Localised promo video（宣傳影片）**：選填，只接受 YouTube 連結。把 `video\sweep-demo.mp4` 上傳到 YouTube（可見度選「公開」或「不公開」都可以，不能選「私人」），再把影片網址貼進來。

**Support URL（支援網址）**：選填。公開上架時建議填，讓使用者有地方回報問題：

```
https://github.com/weehong-1/sweep/issues
```

## 3. Privacy（隱私權）

**Single purpose（單一用途）— 貼上：**

```
Sweep helps keep the browser tidy. It clears the browsing data the user selects (history, downloads, cache, cookies, form data and site storage) from a popup, leaves out the sites the user chooses to keep, can clean automatically at browser startup, and can optionally tell the user when the browser itself is out of date.
```

**Permission justification（權限用途說明）— 每個權限各貼一段：**

`browsingData`

```
Used to remove the kinds of browsing data the user has selected in the popup, when the user presses Clean or has switched on automatic cleaning. This is the core function of the extension.
```

`storage`

```
Used to save the user's settings on their own device: which kinds of data are selected, the time range, the cookie whitelist, the sites the user chose to keep for each kind of data, the on/off switches, and the time each kind of data was last cleared. Nothing is synced or sent anywhere.
```

`history`

```
Used for three things, all on the user's own device. (1) To check whether the browsing history has entries in the selected time range, and whether pages were visited since the last clean, so the popup can show a dot on the kinds of data that have something to clear. (2) When the user opens an item's keep list, to show the names of the sites in their history and how many pages each has, so they can choose sites that should never be cleared. (3) When the user has chosen sites to keep in their history, to remove history entries one by one while leaving the entries of those sites. Site names are shown only to the user, in the popup. The extension stores only the site names the user chooses to keep, and transmits nothing.
```

`downloads`

```
Used for three things, all on the user's own device. (1) To check whether the download history has any entries in the selected time range, so the popup can show a dot on the Downloads item. (2) When the user opens the keep list of the Downloads item, to show the names of the sites they downloaded from, so they can choose sites whose download records should never be cleared. (3) When the user has chosen such sites, to remove download records one by one while leaving the records from those sites. The extension removes records only: it never starts, changes or opens a download, and never deletes a downloaded file. It stores only the site names the user chooses to keep, and transmits nothing.
```

**Remote code（遠端程式碼）**：選 `No, I am not using remote code`。

**Data usage（資料使用）**：

- 「What user data do you plan to collect from users now or in the future?」所有項目都**不要勾**。Sweep 不收集、不傳送任何使用者資料。
- 下方三個聲明全部勾選（不販售資料、不用於與單一用途無關的目的、不用於信用評估）。

**Privacy policy URL（隱私權政策網址）**：貼上你放 `privacy-policy.md` 的公開網址。

## 4. Distribution（發布）

- **Visibility（可見度）**：選 `Public`，任何人都能在商店搜尋到並安裝。
- **Distribution（地區）**：保留全部地區即可。
- **Pricing**：免費。

想先自己試用再公開的話，可以先選 `Private` 並勾選 `Trusted testers` 送審，確認沒問題後再把可見度改成 `Public`。更改可見度要再送審一次。

## 5. 送審

按 **Submit for review**。審核通常需要幾天。通過後，任何人都能從商店頁面安裝，Brave、Edge 等 Chromium 系瀏覽器也可以。

送審時可以選擇通過後自動發布，或是先保留、由你手動按發布。想在公開前再看一次商店頁面的話選後者。

## 可能被審核問到的地方

- **單一用途**：商店要求每個擴充功能只有一個明確的用途。「檢查瀏覽器更新」和「清除瀏覽資料」不是同一件事，審核人員有可能提出疑問。如果因此被退件，把更新檢查從上架的版本拿掉是最直接的解法。
- **`history` 權限**：這是敏感權限，審核會比較仔細。上面的用途說明已經寫明三個用途都只在本機進行：判斷要不要顯示圓點、在保留清單裡列出網站名稱、清除時留下保留的網站。
- **公開後會顯示的個人資訊**：商店頁面會公開顯示發布者名稱和聯絡用的電子郵件。不想用私人信箱的話，先在後台的 Settings 換成另一個信箱。
- **Trader／Non-trader 聲明**：公開上架必須在後台的 Settings 完成這項聲明。個人、非營利發布選 `Non-trader`。

## 之後要更新版本

1. 把 `manifest.chromium.json` 裡的 `version` 調高（商店不接受相同或更低的版本號）。
2. 執行 `..\package-chromium.ps1` 產生新的壓縮檔。
3. 在後台的 **Package** 分頁按 **Upload new package**，再送審一次。
