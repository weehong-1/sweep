# Sweep：Firefox 附加元件網站 (AMO) 上架材料

Firefox 版以公開上架的方式送到 <https://addons.mozilla.org>。大部分資料由腳本送出，只有截圖和隱私權政策要在網頁上補。

## 這個資料夾裡有什麼

| 檔案 | 用途 |
|---|---|
| `amo-metadata.json` | 上架資料：分類、摘要、說明（英文和繁體中文）、首頁、授權、版本說明、給審核人員的說明。由腳本送出 |
| `images\firefox\en\`、`images\firefox\zh_TW\` 的 `1-popup.png`、`2-settings.png`、`3-dark.png` | Firefox 版畫面的截圖，1280×800，在網頁上傳 |
| `privacy-policy.md` | 隱私權政策，在網頁貼上（選填） |

## 1. 送出

在 `sweep` 資料夾執行：

```powershell
.\sign-firefox.ps1 -Listed
```

和簽章時一樣，腳本會問 JWT issuer 和 JWT secret（在 <https://addons.mozilla.org/developers/addon/api/key/> 取得）。送出後腳本就結束，不會等審核。

## 2. 在網頁上補資料

到 <https://addons.mozilla.org/developers/addons> 點 Sweep，再點 **Edit Product Page**：

- **Screenshots**：上傳 `images\firefox\en\` 的三張截圖。
- **Privacy Policy**：選填。要放的話，把 `privacy-policy.md` 的內容貼上。
- **Support website**：`https://github.com/weehong-1/sweep/issues`
- 確認名稱、摘要、說明、分類（Privacy & Security）都已經帶入。

這組截圖是在 Firefox 裡拍的，和 Chrome Web Store 用的那組（`images\en\`、`images\zh_TW\`）不同：Firefox 沒有「檔案系統」，有「已儲存的密碼」，也沒有保持 WhatsApp Web 和 Telegram Web 登入的功能。

## 3. 審核

狀態會顯示在同一個頁面，通過或被退件都會寄信通知。通過後商店頁面的網址是：

```
https://addons.mozilla.org/firefox/addon/<slug>/
```

`<slug>` 可以在 Edit Product Page 的 **Add-on URL** 看到或修改。

## 可能被審核問到的地方

- **`<all_urls>` 和 `cookies`**：是選用權限，只有使用 Cookie 白名單或保留 Cookie 時才會請求。用途已寫在給審核人員的說明裡。
- **原始碼**：套件裡就是原始檔，沒有壓縮或打包，不需要另外提交原始碼。

## 之後要更新版本

1. 把 `manifest.firefox.json` 的 `version` 調高。
2. 需要的話，修改 `amo-metadata.json` 裡的 `release_notes`。
3. 再執行一次 `.\sign-firefox.ps1 -Listed`。
