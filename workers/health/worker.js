/**
 * apo-health — 接收 iPhone 捷徑送來的 Apple 健康「活動能量」，給飯糰 Fit 讀取
 *
 *   POST /sync   捷徑上傳每日活動能量（純文字，一行一天：`2026-09-28=523.4`；也接受 JSON）
 *   GET  /data   App 讀取 { days: { 'YYYY-MM-DD': kcal }, updatedAt }
 *
 * 兩個端點都要帶 `Authorization: Bearer <SYNC_TOKEN>`。
 * 需要的設定：SYNC_TOKEN（Secret）、KV binding HEALTH（部署 workflow 會自動建立）。
 */

const ALLOWED_ORIGINS = [
  "https://p0hsien1i.github.io",
  "http://localhost:4321", // astro dev / preview
];
const KEY = "active-energy";
const KEEP_DAYS = 120;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    };
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), {
        status,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors },
      });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (url.pathname === "/") return json({ ok: true, service: "apo-health" });

    if (!env.SYNC_TOKEN) return json({ error: "server not configured (SYNC_TOKEN missing)" }, 500);
    const auth = request.headers.get("Authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!safeEqual(token, env.SYNC_TOKEN)) return json({ error: "unauthorized" }, 401);

    if (url.pathname === "/data" && request.method === "GET") {
      const stored = (await env.HEALTH.get(KEY, "json")) || { days: {}, updatedAt: null };
      return json(stored);
    }

    if (url.pathname === "/sync" && request.method === "POST") {
      const text = await request.text();
      if (text.length > 300000) return json({ error: "payload too large" }, 413);
      const incoming = parse(text);
      const dates = Object.keys(incoming);
      if (!dates.length) return json({ error: "no valid lines (expected e.g. 2026-09-28=523.4)" }, 400);

      const stored = (await env.HEALTH.get(KEY, "json")) || { days: {} };
      const days = { ...stored.days, ...incoming };
      // 只保留最近 KEEP_DAYS 天
      const keep = Object.keys(days).sort().slice(-KEEP_DAYS);
      const trimmed = Object.fromEntries(keep.map((d) => [d, days[d]]));
      const updatedAt = new Date().toISOString();
      await env.HEALTH.put(KEY, JSON.stringify({ days: trimmed, updatedAt }));
      return json({ ok: true, received: dates.length, latest: dates.sort().at(-1), updatedAt });
    }

    return json({ error: "not found" }, 404);
  },
};

// 解析「YYYY-MM-DD=數字」（一行一筆；也接受「:」、空白、tab 分隔，或 JSON {days:{...}} / {"2026-09-28": 523}）
function parse(text) {
  const out = {};
  const add = (date, value) => {
    const m = String(date).match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    const n = parseFloat(String(value).replace(/,/g, "").replace(/[^\d.]/g, ""));
    if (!m || !Number.isFinite(n) || n < 0 || n > 20000) return;
    const d = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    out[d] = (out[d] || 0) + Math.round(n * 10) / 10; // 同一天多筆（例如不同來源的樣本）就加總
  };
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    try {
      const obj = JSON.parse(trimmed);
      for (const [d, v] of Object.entries(obj.days || obj)) add(d, v);
      return out;
    } catch { /* 當作純文字 */ }
  }
  for (const line of trimmed.split(/[\r\n;]+/)) {
    const m = line.match(/^\s*(\S+?)\s*[=:\t ]\s*(.+)$/);
    if (m) add(m[1], m[2]);
  }
  return out;
}

function safeEqual(a, b) {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}
