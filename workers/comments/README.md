# apo-comments — 留言系統部署說明

留言的運作方式(全部免費、不用資料庫):

```
訪客送出留言
   ↓ POST
Cloudflare Worker(這支 worker.js)
   ↓ GitHub API commit
你的 repo:src/data/comments/<文章slug>/<時間戳>.json   ← 留言就「存在你的線上資料夾」這裡
   ↓ push 到 main 自動觸發
GitHub Pages 重新編譯部署 → 留言顯示在文章底下(約 2–3 分鐘)
```

## 部署步驟(約 10 分鐘,只需做一次)

### 1. 建 GitHub Token(讓 Worker 有權限寫入 repo)

1. 開 <https://github.com/settings/personal-access-tokens/new>
2. Token name:`apo-comments`
3. Expiration:選 `No expiration`(或一年,到期再換)
4. Repository access:選 **Only select repositories** → 勾 `p0hsien1i.github.io`
5. Permissions → Repository permissions → **Contents** → 選 **Read and write**
6. 按 Generate token,**複製起來**(只會顯示一次)

### 2. 建 Cloudflare Worker

1. 開 <https://dash.cloudflare.com>(用你之前建 sveltia-cms-auth 的同一個帳號)
2. Workers & Pages → **Create** → Create Worker
3. 名稱填 **`apo-comments`**(⚠️ 網址會是 `https://apo-comments.pohsienbrianli.workers.dev`,
   網站程式碼已預設這個網址;如果取了別的名字,要回來改 `src/data/site.ts` 的 `commentsEndpoint`)
4. Deploy 之後點 **Edit code**,把本資料夾的 `worker.js` 全部內容貼上,Save and deploy

### 3. 設定 Worker 的變數

Worker → Settings → Variables and Secrets:

| 名稱 | 類型 | 值 |
|---|---|---|
| `REPO` | Text | `p0hsien1i/p0hsien1i.github.io` |
| `GITHUB_TOKEN` | **Secret** | 步驟 1 複製的 token |

完成!到任何一篇文章底下留言測試,2–3 分鐘後重新整理就會看到。

## 日常管理

- **看留言**:repo 的 `src/data/comments/` 資料夾,一則留言 = 一個 JSON 檔
- **刪留言**:在 GitHub 網頁上直接刪掉那個 JSON 檔(commit 到 main),重新部署後就消失
- **防濫用**:表單有隱藏欄位(honeypot)擋機器人;名稱限 50 字、內容限 1000 字。
  若未來被灌爆,可在 Cloudflare Worker 加上免費的 rate limiting 或 Turnstile 驗證
