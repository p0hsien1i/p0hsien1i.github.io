# apo-health — Apple 健康同步接收端

iPhone 捷徑把 Apple 健康的「活動能量」（Garmin Connect 寫入的）每小時送到這裡，Brian as the Chef（`/fit/`）再讀回去，把「比平常多動的部分」加回 70% 到當天額度。

- `POST /sync`：一行一天 `2026-09-28=523.4`（同一天多行會加總；也接受 JSON `{"days":{...}}`）
- `GET /data`：回傳 `{ days: { 'YYYY-MM-DD': kcal }, updatedAt }`
- 兩者都要 `Authorization: Bearer <SYNC_TOKEN>`；資料存在 KV（`HEALTH` binding），只保留最近 120 天

部署：repo Secrets 加 `HEALTH_SYNC_TOKEN` → Actions →「Deploy health worker」→ Run workflow。
KV namespace 會自動建立（Cloudflare 權杖需要 Workers KV Storage: Edit）。

完整的一步一步設定（含 iPhone 捷徑與自動化）：https://p0hsien1i.github.io/fit/apple-health.html
