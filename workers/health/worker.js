/**
 * apo-health — 接收 iPhone 捷徑送來的 Apple 健康「活動能量」，給飯糰 Fit 讀取
 *
 *   POST /sync?type=active|steps|distance
 *                捷徑上傳每日資料（純文字，一行一天：`2026-09-28=523.4`；也接受 JSON）。
 *                type 省略＝活動能量（kcal）；steps＝步數；distance＝步行＋跑步距離（km）
 *   GET  /data   App 讀取 { days: {日期: kcal}, steps: {日期: 步}, distance: {日期: km}, updatedAt, updated: {...} }
 *   GET  /off/search?q=…、/off/product/<條碼>
 *                Open Food Facts 轉接（瀏覽器直連被限流／擋掉時的備援；只接受本站來源，結果快取一天）
 *
 * /sync、/data 要帶 `Authorization: Bearer <SYNC_TOKEN>`。
 * 需要的設定：SYNC_TOKEN（Secret）、KV binding HEALTH（部署 workflow 會自動建立）。
 */

const ALLOWED_ORIGINS = [
  "https://p0hsien1i.github.io",
  "http://localhost:4321", // astro dev / preview
];
// 每種資料一個 KV key；max 用來擋掉明顯錯誤的數字
const TYPES = {
  active: { key: "active-energy", max: 20000 },
  steps: { key: "steps", max: 300000 },
  distance: { key: "distance", max: 100000 }, // km；若手機回傳公尺，App 端會換算
};
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

    if (url.pathname.startsWith("/off/") && request.method === "GET") {
      if (!ALLOWED_ORIGINS.includes(origin)) return json({ error: "forbidden" }, 403);
      return offProxy(url, cors);
    }

    if (!env.SYNC_TOKEN) return json({ error: "server not configured (SYNC_TOKEN missing)" }, 500);
    const auth = request.headers.get("Authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    if (!safeEqual(token, env.SYNC_TOKEN)) return json({ error: "unauthorized" }, 401);

    if (url.pathname === "/data" && request.method === "GET") {
      const [active, steps, distance] = await Promise.all(
        ["active", "steps", "distance"].map((t) => env.HEALTH.get(TYPES[t].key, "json")),
      );
      const updated = { active: active?.updatedAt || null, steps: steps?.updatedAt || null, distance: distance?.updatedAt || null };
      return json({
        days: active?.days || {},
        steps: steps?.days || {},
        distance: distance?.days || {},
        updatedAt: [updated.active, updated.steps, updated.distance].filter(Boolean).sort().at(-1) || null,
        updated,
      });
    }

    if (url.pathname === "/sync" && request.method === "POST") {
      const text = await request.text();
      if (text.length > 300000) return json({ error: "payload too large" }, 413);
      const type = url.searchParams.get("type") || "active";
      const cfg = TYPES[type];
      if (!cfg) return json({ error: "unknown type (use active, steps or distance)" }, 400);
      const incoming = parse(text, cfg.max);
      const dates = Object.keys(incoming);
      if (!dates.length) return json({ error: "no valid lines (expected e.g. 2026-09-28=523.4)" }, 400);

      const stored = (await env.HEALTH.get(cfg.key, "json")) || { days: {} };
      const days = { ...stored.days, ...incoming };
      // 只保留最近 KEEP_DAYS 天
      const keep = Object.keys(days).sort().slice(-KEEP_DAYS);
      const trimmed = Object.fromEntries(keep.map((d) => [d, days[d]]));
      const updatedAt = new Date().toISOString();
      await env.HEALTH.put(cfg.key, JSON.stringify({ days: trimmed, updatedAt }));
      return json({ ok: true, type, received: dates.length, latest: dates.sort().at(-1), updatedAt });
    }

    return json({ error: "not found" }, 404);
  },
};

// 解析「YYYY-MM-DD=數字」（一行一筆；也接受「:」、空白、tab 分隔，或 JSON {days:{...}} / {"2026-09-28": 523}）
function parse(text, max = 20000) {
  const out = {};
  const add = (date, value) => {
    const m = String(date).match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
    const n = parseFloat(String(value).replace(/,/g, "").replace(/[^\d.]/g, ""));
    if (!m || !Number.isFinite(n) || n < 0 || n > max) return;
    const d = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    out[d] = Math.round(((out[d] || 0) + n) * 100) / 100; // 同一天多筆（例如不同來源的樣本）就加總
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

// ---------- Open Food Facts 轉接 ----------
const OFF_FIELDS = "code,product_name,product_name_zh,brands,nutriments,serving_quantity";
const OFF_UA = "BrianAsTheChef/1.0 (+https://p0hsien1i.github.io/fit/)";

async function offProxy(url, cors) {
  let targets;
  const m = url.pathname.match(/^\/off\/product\/(\d{6,14})$/);
  if (m) {
    targets = [`https://world.openfoodfacts.org/api/v2/product/${m[1]}.json?fields=${OFF_FIELDS}`];
  } else if (url.pathname === "/off/search") {
    const q = (url.searchParams.get("q") || "").trim().slice(0, 80);
    if (!q) return new Response(JSON.stringify({ error: "missing q" }), { status: 400, headers: { "Content-Type": "application/json", ...cors } });
    const enc = encodeURIComponent(q);
    targets = [
      `https://search.openfoodfacts.org/search?q=${enc}&page_size=25&langs=zh,en&fields=${OFF_FIELDS}`,
      `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${enc}&search_simple=1&action=process&json=1&page_size=25&fields=${OFF_FIELDS}`,
    ];
  } else {
    return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers: { "Content-Type": "application/json", ...cors } });
  }

  const cache = caches.default;
  const cacheKey = new Request(`https://off-cache.internal${url.pathname}?${url.searchParams}`);
  const hit = await cache.match(cacheKey);
  if (hit) return withCors(hit, cors);

  let last = "upstream failed";
  for (const target of targets) {
    try {
      const res = await fetch(target, { headers: { "User-Agent": OFF_UA, Accept: "application/json" } });
      const type = res.headers.get("Content-Type") || "";
      if ((res.ok || res.status === 404) && type.includes("json")) {
        const body = await res.text();
        const out = new Response(body, {
          status: res.status,
          headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=86400" },
        });
        if (res.ok) await cache.put(cacheKey, out.clone());
        return withCors(out, cors);
      }
      last = `HTTP ${res.status}`;
    } catch (e) {
      last = e.message;
    }
  }
  return new Response(JSON.stringify({ error: last }), { status: 502, headers: { "Content-Type": "application/json", ...cors } });
}

function withCors(res, cors) {
  const r = new Response(res.body, res);
  for (const [k, v] of Object.entries(cors)) r.headers.set(k, v);
  return r;
}
