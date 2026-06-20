# M3U8 下載器

Chrome MV3 擴充功能，自動偵測網頁中的 HLS (m3u8) 串流，並以串流直寫方式下載為 `.ts` 檔案。支援 AES-128 加密串流自動解密。

## 元件職責

| 元件 | 職責 |
| ------ | ------ |
| **background.js** | 串流偵測（`webRequest`）、Badge 更新、Referer 偽裝（`declarativeNetRequest`）、追蹤已連線的 manage tab 數量 |
| **popup.html** | 顯示當前頁面偵測到的串流清單；按「新增下載」將串流送往 manage.html；按「管理」開啟或聚焦 manage.html |
| **manage.html** | 解析 M3U8、管理下載任務（佇列 / 進行中 / 完成 / 失敗）、AES-128 解密、透過 File System Access API 串流寫入本機；第二個 manage tab 開啟時會自動關閉並聚焦既有 tab |

## 注意事項

- 下載任務運行中請保持 manage.html 頁面開啟，關閉將中斷所有進行中的任務。
- 所有下載均在本機完成，不會將影片內容傳送至任何伺服器。
- 請僅用於你擁有合法授權或本人有權保存的內容。
