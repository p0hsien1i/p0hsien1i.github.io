/**
 * apo-comments — 部落格留言 Cloudflare Worker
 *
 * 收到留言(POST JSON: {slug, name, message, website})後,
 * 用 GitHub Contents API 把留言寫成一個 JSON 檔,commit 到
 * main 分支的 src/data/comments/<slug>/ 底下。
 * push 會觸發 GitHub Pages 重新部署,留言約 2–3 分鐘後上線。
 *
 * 需要的設定(Worker → Settings → Variables and Secrets):
 *   REPO         (Text)   p0hsien1i/p0hsien1i.github.io
 *   GITHUB_TOKEN (Secret) fine-grained PAT,只勾這個 repo 的 Contents: Read and write
 */

const ALLOWED_ORIGINS = [
  "https://p0hsien1i.github.io",
  "http://localhost:4321", // astro dev
];

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const cors = {
      "Access-Control-Allow-Origin": ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin",
    };
    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), {
        status,
        headers: { "Content-Type": "application/json", ...cors },
      });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return json({ error: "method not allowed" }, 405);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "bad request" }, 400);
    }

    // honeypot:隱藏欄位有值 = 機器人,假裝成功直接丟掉
    if (body.website) return json({ ok: true });

    const slug = String(body.slug || "").trim();
    const name = String(body.name || "").trim().slice(0, 50);
    const message = String(body.message || "").trim().slice(0, 1000);
    if (!slug || !name || !message) return json({ error: "missing fields" }, 400);
    // slug 會變成檔案路徑,只允許安全字元(含中文)
    if (!/^[A-Za-z0-9一-鿿._~-]{1,120}$/.test(slug)) return json({ error: "bad slug" }, 400);

    const date = new Date().toISOString();
    const fname = `${date.replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}.json`;
    const path = `src/data/comments/${slug}/${fname}`;
    const payload = JSON.stringify({ name, message, date }, null, 2) + "\n";
    const content = btoa(String.fromCharCode(...new TextEncoder().encode(payload)));

    const apiPath = path.split("/").map(encodeURIComponent).join("/");
    const res = await fetch(`https://api.github.com/repos/${env.REPO}/contents/${apiPath}`, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "apo-comments-worker",
      },
      body: JSON.stringify({
        message: `comment: ${slug} — ${name}`,
        content,
        branch: "main",
      }),
    });

    if (!res.ok) {
      console.error("github api error", res.status, await res.text());
      return json({ error: "storage error" }, 502);
    }
    return json({ ok: true });
  },
};
