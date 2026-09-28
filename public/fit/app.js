import { FOODS, DRINK_BASES, DRINK_SIZES, DRINK_SUGARS, DRINK_TOPPINGS, FULL_SUGAR_G_700 } from './foods.js';

// ================= utils =================
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const r0 = (n) => Math.round(n || 0);
const r1 = (n) => Math.round((n || 0) * 10) / 10;
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseYmd(s); d.setDate(d.getDate() + n); return ymd(d); };
const today = () => ymd(new Date());
const WEEK = '日一二三四五六';
function dateLabel(s) {
  const t = today();
  if (s === t) return '今天';
  if (s === addDays(t, -1)) return '昨天';
  if (s === addDays(t, 1)) return '明天';
  const d = parseYmd(s);
  const y = d.getFullYear() !== new Date().getFullYear() ? d.getFullYear() + '/' : '';
  return `${y}${d.getMonth() + 1}/${d.getDate()}（${WEEK[d.getDay()]}）`;
}
const short = (s) => { const d = parseYmd(s); return `${d.getMonth() + 1}/${d.getDate()}`; };

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ================= state =================
const KEY = 'fanfit:v1';
const MEALS = [['breakfast', '早餐'], ['lunch', '午餐'], ['dinner', '晚餐'], ['snack', '點心'], ['drinks', '飲料']];
const mealName = (m) => (MEALS.find((x) => x[0] === m) || MEALS[3])[1];
const mealIcon = { breakfast: '🌅', lunch: '🍱', dinner: '🍲', snack: '🍪', drinks: '🧋' };
const WEEKLY = [[-1, '每週減 1 kg（偏快）'], [-0.75, '每週減 0.75 kg'], [-0.5, '每週減 0.5 kg（減脂建議）'], [-0.25, '每週減 0.25 kg'], [0, '維持體重'], [0.25, '每週增 0.25 kg'], [0.5, '每週增 0.5 kg']];

const defaults = () => ({
  profile: {
    sex: 'male', age: 30, height: 170, weight: 70, weeklyGoal: -0.5,
    macros: { c: 45, p: 25, f: 30 }, autoAdjust: true,
    // 目標模式：'abs' 減脂・腹肌（蛋白質以每公斤計）／'general' 一般（三大營養素比例）
    mode: 'abs', proteinPerKg: 2.0, fatPct: 25, drinkLimit: 150,
  },
  entries: [], // { id, date, meal, food, amount, qty }
  weights: {}, // { 'YYYY-MM-DD': kg }
  waists: {}, // { 'YYYY-MM-DD': 腰圍 cm（肚臍高度）}
  customFoods: [],
  recents: [],
  // Apple 健康同步（iPhone 捷徑 → apo-health worker → 這裡）
  health: { enabled: false, endpoint: 'https://apo-health.pohsienbrianli.workers.dev', token: '', days: {}, updatedAt: null, fetchedAt: null, error: '' },
});

function load() {
  const d = defaults();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw) return { ...d, ...raw, profile: { ...d.profile, ...raw.profile, macros: { ...d.profile.macros, ...raw.profile?.macros } }, health: { ...d.health, ...raw.health } };
  } catch { /* 讀不到就用預設值 */ }
  return d;
}
let S = load();
let dataVer = 0; // 資料版本：每次儲存 +1，給計算快取用
function save() {
  dataVer++;
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('儲存失敗：' + e.message); }
  // 只有飲食、體重等要同步的資料有變才算「改動」（抓 Apple 健康資料不算）
  const snap = stable(syncable(S));
  if (snap !== lastSnap) { lastSnap = snap; markChanged(); }
}
let lastSnap = null;

// ================= 雲端同步（手機、電腦共用同一份資料，存在自己的 Cloudflare 接收端） =================
// 做法：記住「上次同步完的版本」(base)，每次同步時拿 本機 / 雲端 / base 三方比對，
// 一筆一筆合併：只有一邊改過就用那一邊（刪除也算改），兩邊都改過同一筆就以比較晚改的那邊為準。
// 同步狀態另外存，避免「寫入同步時間」又觸發一次同步
const CLOUD_KEY = 'fanfit:cloud';
const BASE_KEY = 'fanfit:base';
let cloud = { enabled: true, lastBackupAt: null, error: '', dirty: false, changedAt: null };
try { Object.assign(cloud, JSON.parse(localStorage.getItem(CLOUD_KEY) || '{}')); } catch { /* 用預設值 */ }
// 舊版只記備份時間：拿它當「這台最後改動時間」，沒備份過的裝置（例如剛設定的電腦）有衝突時就以雲端為準
if (!cloud.changedAt && cloud.lastBackupAt) cloud.changedAt = cloud.lastBackupAt;
const saveCloud = () => { try { localStorage.setItem(CLOUD_KEY, JSON.stringify(cloud)); } catch { /* 忽略 */ } };
const cloudReady = () => !!(cloud.enabled && S.health?.token && S.health?.endpoint);
const hasData = (d) => !!(d && (d.entries?.length || d.customFoods?.length || Object.keys(d.weights || {}).length || Object.keys(d.waists || {}).length));
const hasLocalData = () => hasData(S);
const cloudUrl = (path) => S.health.endpoint.replace(/\/+$/, '') + path;
const cloudHeaders = () => ({ Authorization: 'Bearer ' + S.health.token });
const SYNC_DELAY_MS = 3000;
const SYNC_POLL_MS = 2 * 60 * 1000;
let syncTimer = null;
let syncing = null;

function markChanged() {
  cloud.dirty = true;
  cloud.changedAt = new Date().toISOString();
  saveCloud();
  scheduleSync();
}
function scheduleSync(delay = SYNC_DELAY_MS) {
  if (!cloudReady()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => cloudSync(), delay);
}

// 要同步的資料：Apple 健康的設定（密碼、網址）與活動資料每台裝置各自保留
const syncable = (d) => { const { health, ...rest } = d; return rest; };
const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map((key) => [key, x[key]])) : x));
const same = (a, b) => stable(a) === stable(b);
lastSnap = stable(syncable(S));
const byId = (arr) => new Map((Array.isArray(arr) ? arr : []).filter((x) => x && x.id != null).map((x) => [String(x.id), x]));

function loadBase() {
  try { return JSON.parse(localStorage.getItem(BASE_KEY) || 'null'); } catch { return null; }
}
function saveBase(data) {
  try { localStorage.setItem(BASE_KEY, JSON.stringify(data)); } catch { /* 空間不足就下次全部重新比對 */ }
}

// 三方合併一組「key → 值」；localWins 決定兩邊都改過同一筆時用誰
function merge3(base, local, remote, localWins) {
  const out = new Map();
  const keys = new Set([...local.keys(), ...remote.keys(), ...base.keys()]);
  for (const k of keys) {
    const b = base.get(k), l = local.get(k), r = remote.get(k);
    let v;
    if (same(l, r)) v = l;
    else if (same(l, b)) v = r; // 只有雲端改過（含刪除）
    else if (same(r, b)) v = l; // 只有本機改過（含刪除）
    else v = localWins ? l : r; // 兩邊都改過
    if (v !== undefined) out.set(k, v);
  }
  return out;
}
const mapOf = (o) => new Map(Object.entries(o && typeof o === 'object' ? o : {}));

function mergeData(base, local, remote, localWins) {
  base = base || {};
  const out = {};
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)]);
  for (const k of keys) {
    if (k === 'entries' || k === 'customFoods') {
      const m = merge3(byId(base[k]), byId(local[k]), byId(remote[k]), localWins);
      // 保持原本順序：先照本機，再接上雲端新增的
      const order = [...byId(local[k]).keys(), ...byId(remote[k]).keys()];
      out[k] = [...new Set(order)].filter((id) => m.has(id)).map((id) => m.get(id));
    } else if (k === 'weights' || k === 'waists' || k === 'profile') {
      out[k] = Object.fromEntries(merge3(mapOf(base[k]), mapOf(local[k]), mapOf(remote[k]), localWins));
    } else {
      const v = merge3(new Map([[k, base[k]]]), new Map([[k, local[k]]]), new Map([[k, remote[k]]]), localWins).get(k);
      if (v !== undefined) out[k] = v;
    }
  }
  return out;
}

function syncError(e) {
  return /Load failed|Failed to fetch|NetworkError/i.test(e.message) ? '連不到雲端（沒有網路或接收端還沒部署）' : e.message;
}

// 抓雲端最新 → 合併 → 有差異就套用到本機、有本機改動就上傳
function cloudSync({ keepalive = false } = {}) {
  if (!cloudReady()) return Promise.resolve(false);
  if (syncing) { cloud.dirty && scheduleSync(); return syncing; }
  clearTimeout(syncTimer);
  syncing = (async () => {
    try {
      const got = await cloudFetch('/backup');
      const remote = got?.data ? syncable(got.data) : null;
      const base = loadBase();
      const local = syncable(S);
      const localWins = !got?.savedAt || (!!cloud.changedAt && cloud.changedAt >= got.savedAt);
      const merged = remote ? mergeData(base, local, remote, localWins) : local;

      if (!same(merged, local)) {
        S = { ...S, ...merged };
        for (const k of Object.keys(local)) if (!(k in merged)) delete S[k];
        dataVer++;
        try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* 忽略 */ }
        lastSnap = stable(syncable(S)); // 從雲端拿來的不算本機改動
        refreshAfterSync();
      }

      let savedAt = got?.savedAt || null;
      const needPush = !remote || !same(merged, remote);
      // 雲端沒有資料、這台也是空的就不上傳，避免把空白蓋上去
      if (needPush && (hasData(merged) || (base && hasData(base)))) {
        const body = JSON.stringify({ ...merged, health: { ...S.health, token: '' } });
        const res = await fetch(cloudUrl('/backup'), {
          method: 'PUT', headers: { ...cloudHeaders(), 'Content-Type': 'application/json' }, body,
          keepalive: keepalive && body.length < 60000, // keepalive 有 64KB 上限
        });
        if (res.status === 401) throw new Error('同步密碼不對');
        if (res.status === 404) throw new Error('接收端還沒更新，請到 GitHub 重跑一次「Deploy health worker」');
        if (!res.ok) throw new Error('HTTP ' + res.status);
        savedAt = (await res.json()).savedAt;
      }
      saveBase(merged);
      // 同步途中又有新的改動（S 跟剛合併的不同）就保持 dirty，等一下再同步一次
      cloud.dirty = !same(syncable(S), merged);
      cloud.lastBackupAt = savedAt || cloud.lastBackupAt;
      cloud.lastSyncAt = new Date().toISOString();
      cloud.error = '';
    } catch (e) {
      cloud.error = syncError(e);
    }
    saveCloud();
    updateCloudStatus();
    return !cloud.error;
  })().finally(() => {
    syncing = null;
    if (cloud.dirty && !cloud.error) scheduleSync();
  });
  return syncing;
}

// 同步拿到新資料後重畫；正在輸入的話先不重畫，免得打到一半的字被洗掉
let renderPending = false;
function refreshAfterSync() {
  const a = document.activeElement;
  if (a && a.closest && a.closest('#app') && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) { renderPending = true; return; }
  renderPending = false;
  render();
}
document.addEventListener('focusout', () => setTimeout(() => {
  if (!renderPending) return;
  const a = document.activeElement;
  if (a && a.closest && a.closest('#app') && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return;
  renderPending = false;
  render();
}, 0));

function cloudStatusText() {
  if (!S.health?.token) return '請先在上方「⌚ Apple 健康同步」產生並儲存同步密碼，雲端同步也使用同一組。';
  if (!cloud.enabled) return '自動同步已關閉。';
  if (cloud.error) return '⚠️ ' + cloud.error;
  const t = cloud.lastSyncAt || cloud.lastBackupAt;
  return t ? `✅ 最後同步：${new Date(t).toLocaleString('zh-TW')}` : '還沒有同步。';
}
function updateCloudStatus() {
  const el = document.querySelector('#cloud-status');
  if (el) el.textContent = cloudStatusText();
}

async function cloudFetch(path) {
  const res = await fetch(cloudUrl(path), { headers: cloudHeaders(), cache: 'no-store' });
  if (res.status === 401) throw new Error('同步密碼不對');
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

function applyRestore(data) {
  // 保留這台裝置的同步密碼與網址
  const keep = { token: S.health.token, endpoint: S.health.endpoint, enabled: S.health.enabled };
  localStorage.setItem(KEY, JSON.stringify({ ...data, health: { ...(data.health || {}), ...keep } }));
  S = load();
  dataVer++;
  lastSnap = stable(syncable(S));
  markChanged(); // 還原的內容當作這台最新的改動，同步到其他裝置
  render();
}

async function cloudRestore(date) {
  try {
    const got = await cloudFetch(date ? `/backup?date=${date}` : '/backup');
    if (!got?.data) { toast('雲端沒有這份備份'); return; }
    const c = got.data;
    const msg = `要用雲端備份（${new Date(got.savedAt).toLocaleString('zh-TW')}，${c.entries.length} 筆飲食紀錄、${(c.customFoods || []).length} 個自訂食物）覆蓋目前的資料嗎？其他裝置也會跟著變成這個版本。`;
    if (!confirm(msg)) return;
    applyRestore(c);
    toast('已從雲端還原 ✅');
  } catch (e) {
    toast('還原失敗：' + e.message);
  }
}

let cur = today();
let view = 'home';

// ================= calculations =================
function latestWeight(upTo = cur) {
  const ds = Object.keys(S.weights).filter((d) => d <= upTo).sort();
  return ds.length ? S.weights[ds.at(-1)] : S.profile.weight;
}
function bmr(p, w) {
  return 10 * w + 6.25 * p.height - 5 * p.age + (p.sex === 'male' ? 5 : -161);
}
// 公式估算的每日消耗：有 Apple 健康資料時用「近 14 天實際活動能量」，
// 否則暫用一般輕度活動（BMR × 1.375）。
// BMR × 1.15 ＝ 基礎代謝＋消化食物（約 10%）＋少量未被手錶算到的日常活動。
const DEFAULT_ACTIVITY_FACTOR = 1.375;
function formulaTdee(date = cur, weight = latestWeight(date)) {
  const b = bmr(S.profile, weight);
  const a = activityInfo(date);
  return a?.ready ? b * 1.15 + a.baseline : b * DEFAULT_ACTIVITY_FACTOR;
}
function tdee() { return formulaTdee(cur); }

// ---------- 依體重趨勢自動修正每日消耗（每週一更新） ----------
// 觀念：實際消耗 ≈ 平均攝取 − 每天體重變化 × 7700 kcal/kg。
// 用「本週一」往前 21 天的資料計算，所以一週內目標固定，每週一才更新。
const ADAPT_DAYS = 21;
const KCAL_PER_KG = 7700;
const weekStartOf = (d) => addDays(d, -((parseYmd(d).getDay() + 6) % 7));
const dayDiff = (a, b) => Math.round((parseYmd(b) - parseYmd(a)) / 86400000);
const adaptCache = new Map();

function adaptive(date = cur) {
  const since = weekStartOf(date);
  const key = since + '|' + dataVer;
  if (adaptCache.has(key)) return adaptCache.get(key);
  const end = addDays(since, -1);
  const start = addDays(since, -ADAPT_DAYS);
  const formula = formulaTdee(end, latestWeight(end));

  // 攝取：只算「有認真記完」的日子（低於估計消耗 40% 視為沒記完整）
  const perDay = new Map();
  for (const e of S.entries) {
    if (e.date < start || e.date > end) continue;
    perDay.set(e.date, (perDay.get(e.date) || 0) + nut(e).kcal);
  }
  const complete = [...perDay.values()].filter((k) => k >= formula * 0.4);
  const n = complete.length;
  const avgIntake = n ? complete.reduce((a, b) => a + b, 0) / n : 0;

  // 體重：區間內的量測做線性回歸，取斜率（kg/天）
  const pts = Object.entries(S.weights).filter(([d]) => d >= start && d <= end).map(([d, kg]) => [dayDiff(start, d), kg]);
  const m = pts.length;
  const span = m ? Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0])) : 0;
  const base = { since, start, end, formula, n, m, span, avgIntake, ready: false };

  let out = base;
  if (n >= 7 && m >= 3 && span >= 10) {
    const mx = pts.reduce((a, p) => a + p[0], 0) / m;
    const my = pts.reduce((a, p) => a + p[1], 0) / m;
    const slope = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
    const observed = avgIntake - slope * KCAL_PER_KG;
    const clamped = Math.min(formula * 1.3, Math.max(formula * 0.7, observed));
    const conf = Math.min(1, n / 14) * Math.min(1, m / 5);
    out = { ...base, ready: true, slope, weeklyChange: slope * 7, observed, clamped: clamped !== observed, conf, est: formula + (clamped - formula) * conf };
  }
  adaptCache.set(key, out);
  return out;
}

// 目前使用的每日消耗：資料夠就用修正值，否則用公式
function currentTdee(date = cur) {
  if (S.profile.autoAdjust) {
    const a = adaptive(date);
    if (a.ready) return a.est;
  }
  return tdee();
}
const isAutoAdjusted = (date = cur) => S.profile.autoAdjust && adaptive(date).ready;

function calorieGoal() {
  const p = S.profile;
  const floor = p.sex === 'male' ? 1500 : 1200;
  return Math.max(floor, Math.round((currentTdee() + (p.weeklyGoal * KCAL_PER_KG) / 7) / 10) * 10);
}

// ---------- Apple 健康活動加成 ----------
// 平常的活動量已經包含在目標裡（公式的活動量係數／體重趨勢修正），
// 所以只把「今天比平常多動的部分」加回 70%，避免重複計算。
const ACTIVITY_ADD_BACK = 0.7;
const BASELINE_DAYS = 14;
const BASELINE_MIN = 5;
function activityInfo(date = cur) {
  const h = S.health;
  if (!h.enabled) return null;
  const days = h.days || {};
  const todayKcal = days[date];
  const past = Array.from({ length: BASELINE_DAYS }, (_, i) => addDays(date, -1 - i)).filter((d) => days[d] != null);
  const baseline = past.length ? past.reduce((a, d) => a + days[d], 0) / past.length : null;
  const ready = past.length >= BASELINE_MIN;
  const extra = ready && todayKcal != null ? todayKcal - baseline : 0;
  const bonus = extra > 0 ? Math.round((extra * ACTIVITY_ADD_BACK) / 10) * 10 : 0;
  return { todayKcal, baseline, n: past.length, ready, extra, bonus };
}
// 今天實際可以吃的額度＝目標＋活動加成
function dayBudget(date = cur) {
  const a = activityInfo(date);
  return calorieGoal() + (a?.bonus || 0);
}

const absMode = () => S.profile.mode === 'abs';
function macroGoals(kcal) {
  const pr = S.profile;
  if (absMode()) {
    // 減脂期：蛋白質依體重（保住肌肉）、脂肪固定比例，剩下的給碳水
    const p = pr.proteinPerKg * latestWeight();
    const f = (kcal * pr.fatPct) / 900;
    return { p, f, c: Math.max(0, (kcal - p * 4 - f * 9) / 4) };
  }
  const m = pr.macros;
  return { c: (kcal * m.c) / 400, p: (kcal * m.p) / 400, f: (kcal * m.f) / 900 };
}

// ---------- 腰圍／腹肌進度 ----------
const latestWaist = (upTo = today()) => {
  const ds = Object.keys(S.waists || {}).filter((d) => d <= upTo).sort();
  return ds.length ? { date: ds.at(-1), cm: S.waists[ds.at(-1)] } : null;
};
// 相對脂肪量 RFM（只需身高與腰圍的體脂粗估）：男 64 − 20×身高/腰圍，女 76 − 20×身高/腰圍
const rfm = (waist) => (S.profile.sex === 'male' ? 64 : 76) - (20 * S.profile.height) / waist;
const WHTR_TARGET = 0.45; // 腰圍／身高 ≤ 0.45：精實，腹肌線條開始出現的參考值
// 近 3 週體重趨勢（kg／週，線性回歸）
function weightTrend(days = 21) {
  const start = addDays(today(), -days);
  const pts = Object.entries(S.weights).filter(([d]) => d >= start).map(([d, kg]) => [dayDiff(start, d), kg]);
  if (pts.length < 3) return null;
  const span = Math.max(...pts.map((p) => p[0])) - Math.min(...pts.map((p) => p[0]));
  if (span < 7) return null;
  const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length;
  const my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const slope = pts.reduce((a, p) => a + (p[0] - mx) * (p[1] - my), 0) / pts.reduce((a, p) => a + (p[0] - mx) ** 2, 0);
  return { perWeek: slope * 7, pct: (slope * 7) / my * 100 };
}
const nut = (e) => ({ kcal: e.food.kcal * e.qty, p: e.food.p * e.qty, c: e.food.c * e.qty, f: e.food.f * e.qty });
function foodTotals(date, meal) {
  const t = { kcal: 0, p: 0, c: 0, f: 0 };
  for (const e of S.entries) {
    if (e.date !== date || (meal && e.meal !== meal)) continue;
    const n = nut(e);
    t.kcal += n.kcal; t.p += n.p; t.c += n.c; t.f += n.f;
  }
  return t;
}
const amountLabel = (e) => (e.food.grams ? `${r1(e.amount)} g` : `${r1(e.amount)} × ${e.food.serving}`);

// ================= rendering =================
function render() {
  $('#date-label').textContent = dateLabel(cur);
  $('#date-input').value = cur;
  for (const sec of document.querySelectorAll('.view')) sec.hidden = sec.dataset.view !== view;
  for (const b of document.querySelectorAll('.tabbar [data-tab]')) {
    if (b.dataset.tab === view) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  ({ home: renderHome, diary: renderDiary, progress: renderProgress, settings: renderSettings })[view]();
}

// 營養素「還差多少」：蛋白質是要補足的目標，碳水／脂肪是上限
function macroRow(label, val, goal, color, kind) {
  const left = goal - val;
  const pct = goal ? Math.min(100, (val / goal) * 100) : 0;
  let status, cls = '';
  if (kind === 'min') {
    status = left > 0.5 ? `還要補 <b>${r0(left)}</b> g` : '✓ 已達標';
    cls = left > 0.5 ? 'need' : 'ok';
  } else {
    status = left >= 0 ? `還可以吃 <b>${r0(left)}</b> g` : `超過 <b>${r0(-left)}</b> g`;
    cls = left >= 0 ? '' : 'over';
  }
  return `<div class="mrow ${cls}">
    <div class="mrow-head"><span class="mrow-label"><i style="background:${color}"></i>${label}</span><span class="mrow-status">${status}</span></div>
    <div class="meter"><i style="width:${pct}%;background:${color}"></i></div>
    <small class="muted num">已吃 ${r0(val)} / 目標 ${r0(goal)} g</small>
  </div>`;
}

// 把剩下的熱量／蛋白質，依比例分給今天還沒記錄的正餐
const MEAL_SHARE = { breakfast: 25, lunch: 35, dinner: 35, snack: 10 };
const MEAL_END_HOUR = { breakfast: 11, lunch: 15, dinner: 22, snack: 24 };
function mealPlan(remainKcal, remainP) {
  const isToday = cur === today();
  const hour = new Date().getHours();
  const open = Object.keys(MEAL_SHARE).filter((k) =>
    !S.entries.some((e) => e.date === cur && e.meal === k) && (!isToday || hour < MEAL_END_HOUR[k]));
  const total = open.reduce((s, k) => s + MEAL_SHARE[k], 0);
  return open.map((k) => ({ meal: k, kcal: (remainKcal * MEAL_SHARE[k]) / total, p: (Math.max(0, remainP) * MEAL_SHARE[k]) / total }));
}

function coachLine(eaten, remain, goal, pLeft) {
  if (!eaten) return '今天還沒記錄，從第一餐開始吧！';
  if (remain < 0) return `今天多了 ${-remain} kcal，沒關係，明天再調整就好 🙂`;
  if (remain <= goal * 0.1) return pLeft > 5 ? `快到目標了！剩下的額度優先補蛋白質（還差 ${r0(pLeft)} g）。` : '快到目標了，接下來選清淡一點的就好 👍';
  if (pLeft > 5) return `還有 ${remain} kcal 的空間，蛋白質還要補 ${r0(pLeft)} g 💪`;
  return `還有 ${remain} kcal 的空間，蛋白質已經達標 👍`;
}

function healthLine(a) {
  if (!a) return '';
  const h = S.health;
  const when = h.updatedAt ? new Date(h.updatedAt) : null;
  const upd = when ? `更新於 ${when.toDateString() === new Date().toDateString() ? '' : `${when.getMonth() + 1}/${when.getDate()} `}${pad(when.getHours())}:${pad(when.getMinutes())}` : '';
  let text;
  if (h.error) text = `⌚ Apple 健康同步失敗：${esc(h.error)}`;
  else if (!Object.keys(h.days || {}).length) text = '⌚ 還沒收到 Apple 健康的資料，照<a href="apple-health.html">設定教學</a>跑一次捷徑。';
  else if (a.todayKcal == null) text = `⌚ 今天還沒有活動資料 <span class="muted">${upd}</span>`;
  else if (!a.ready) text = `⌚ 今日活動 <b>${r0(a.todayKcal)}</b> kcal · 正在建立你的平常活動量（${a.n}/${BASELINE_MIN} 天）`;
  else if (a.bonus > 0) text = `⌚ 今日活動 <b>${r0(a.todayKcal)}</b> kcal，比平常多 ${r0(a.extra)} → 額度 <b class="plus">+${a.bonus}</b> kcal <span class="muted">${upd}</span>`;
  else text = `⌚ 今日活動 <b>${r0(a.todayKcal)}</b> kcal（平常約 ${r0(a.baseline)}） <span class="muted">${upd}</span>`;
  return `<div class="health-line"><div class="grow">${text}</div>
    <a class="icon-btn" href="shortcuts://run-shortcut?name=${encodeURIComponent(HEALTH_SHORTCUT)}" aria-label="執行捷徑立即同步" title="立即同步">🔄</a></div>`;
}

function absFocusCard(t, remain, mg) {
  const drinks = foodTotals(cur, 'drinks').kcal;
  const lim = S.profile.drinkLimit;
  const pLeft = mg.p - t.p;
  const w = latestWaist();
  const item = (ok, title, detail) => `<li class="${ok === true ? 'done' : ok === false ? 'bad' : ''}">
    <span class="mark">${ok === true ? '✓' : ok === false ? '!' : '○'}</span><div><b>${title}</b><small>${detail}</small></div></li>`;
  const target = r1(S.profile.height * WHTR_TARGET);
  return `<div class="card focus">
    <div class="card-head"><h3>🔥 今日減脂重點</h3><button class="link-btn" data-action="goto" data-view="progress">腹肌進度 ›</button></div>
    <ul class="focus-list">
      ${item(remain >= 0, '熱量在額度內', remain >= 0 ? `還有 ${remain} kcal` : `超過 ${-remain} kcal，明天回到額度就好`)}
      ${item(pLeft <= 0.5 ? true : null, `蛋白質 ${r0(mg.p)} g（每公斤 ${S.profile.proteinPerKg} g）`, pLeft > 0.5 ? `還要補 ${r0(pLeft)} g：雞胸、蛋、豆腐、無糖豆漿、乳清` : '達標！減脂時最重要的就是這一項')}
      ${item(drinks <= lim, `飲料熱量 ≤ ${lim} kcal`, drinks ? `今天喝了 ${r0(drinks)} kcal${drinks > lim ? '，手搖飲改無糖、少喝酒' : ''}` : '目前 0，無糖茶、黑咖啡、水最好')}
    </ul>
    <p class="muted waist-line">${w
      ? `📏 腰圍 <b>${w.cm}</b> cm（${short(w.date)}）· 目標 ≤ <b>${target}</b> cm${w.date < addDays(today(), -7) ? ' · 該量這週的腰圍了' : ''}`
      : '📏 每週量一次腰圍（肚臍高度），比體重更能看出小腹的變化 → <a href="#progress" data-action="goto" data-view="progress">去記錄</a>'}</p>
  </div>`;
}

function renderHome() {
  const act = activityInfo(cur);
  const base = calorieGoal();
  const goal = base + (act?.bonus || 0);
  const t = foodTotals(cur);
  const eaten = r0(t.kcal);
  const remain = goal - eaten;
  const mg = macroGoals(goal);
  const pLeft = mg.p - t.p;
  const R = 70, C = 2 * Math.PI * R;
  const pct = goal > 0 ? Math.min(1, eaten / goal) : 0;
  const plan = remain > 0 ? mealPlan(remain, pLeft) : [];

  $('#view-home').innerHTML = `
    <div class="card hero">
      <div class="hero-ring ${remain < 0 ? 'over' : ''}">
        <svg viewBox="0 0 160 160" aria-hidden="true">
          <circle class="track" cx="80" cy="80" r="${R}" fill="none" stroke-width="12"/>
          <circle class="bar" cx="80" cy="80" r="${R}" fill="none" stroke-width="12" stroke-linecap="round"
            stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/>
        </svg>
        <div class="ring-label">
          <span>${remain < 0 ? '已超過' : '還可以吃'}</span>
          <b class="num">${Math.abs(remain).toLocaleString()}</b>
          <span>kcal</span>
        </div>
      </div>
      <div class="hero-stats num">
        <div><small>${act?.bonus ? `今日額度（+${act.bonus}）` : isAutoAdjusted() ? '目標（已自動修正）' : '目標'}</small><b>${goal.toLocaleString()}</b></div>
        <div><small>已吃</small><b>${eaten.toLocaleString()}</b></div>
        <div><small>進度</small><b>${goal ? r0((eaten / goal) * 100) : 0}%</b></div>
      </div>
      <p class="coach">${esc(coachLine(eaten, remain, goal, pLeft))}</p>
      ${healthLine(act)}
    </div>

    ${absMode() ? absFocusCard(t, remain, mg) : ''}

    <div class="card">
      <div class="card-head"><h3>營養素還差多少</h3></div>
      ${macroRow('蛋白質', t.p, mg.p, 'var(--protein)', 'min')}
      ${macroRow('碳水', t.c, mg.c, 'var(--carb)', 'max')}
      ${macroRow('脂肪', t.f, mg.f, 'var(--fat)', 'max')}
    </div>

    ${plan.length ? `<div class="card">
      <div class="card-head"><h3>接下來怎麼吃</h3><span class="muted">剩下的額度分配</span></div>
      <div class="list">${plan.map((x) => `<button class="row" data-action="add-food" data-meal="${x.meal}">
        <div class="grow"><div class="name">${mealIcon[x.meal]} ${mealName(x.meal)}</div>
        <div class="sub">${x.p >= 1 ? `蛋白質約 ${r0(x.p)} g` : '蛋白質已達標'}</div></div>
        <div class="kcal num">約 ${r0(x.kcal / 10) * 10} kcal</div></button>`).join('')}</div>
    </div>` : ''}

    <div class="quick">
      <button class="btn primary" data-action="add-food">🍙 記錄飲食</button>
      <button class="btn" data-action="goto" data-view="progress">📏 體重・腰圍</button>
    </div>

    <div class="card">
      <div class="card-head"><h3>今日餐點</h3><button class="link-btn" data-action="goto" data-view="diary">看日記 ›</button></div>
      <div class="list">
        ${MEALS.map(([k, n]) => {
          const mt = foodTotals(cur, k);
          const cnt = S.entries.filter((e) => e.date === cur && e.meal === k).length;
          return `<button class="row" data-action="add-food" data-meal="${k}">
            <div class="grow"><div class="name">${mealIcon[k]} ${n}</div><div class="sub">${cnt ? `${cnt} 項` : '尚未記錄 — 點此新增'}</div></div>
            <div class="kcal num">${cnt ? r0(mt.kcal) + ' kcal' : '＋'}</div></button>`;
        }).join('')}
      </div>
    </div>

    <div class="card chart">
      <div class="card-head"><h3>近 7 天攝取</h3><span class="muted">虛線＝目標</span></div>
      ${weekChart()}
    </div>`;
}

function weekChart() {
  const days = Array.from({ length: 7 }, (_, i) => addDays(cur, i - 6));
  const vals = days.map((d) => foodTotals(d).kcal);
  const goal = calorieGoal();
  const max = Math.max(goal * 1.25, ...vals.map((v) => v * 1.12)) || 1;
  const W = 320, H = 150, top = 16, bottom = 20, h = H - top - bottom, bw = 26, gap = (W - 7 * bw) / 7;
  const y = (v) => top + h - (v / max) * h;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="近 7 天熱量攝取長條圖">
    <line class="goal" x1="0" x2="${W}" y1="${y(goal)}" y2="${y(goal)}"/>
    ${days.map((d, i) => {
      const x = gap / 2 + i * (bw + gap);
      const v = vals[i];
      return `<rect class="bar ${d === cur ? 'cur' : ''}" x="${x}" y="${y(v)}" width="${bw}" height="${Math.max(0, top + h - y(v))}" rx="5"><title>${short(d)}：${r0(v)} kcal</title></rect>
        <text x="${x + bw / 2}" y="${H - 5}" text-anchor="middle">${WEEK[parseYmd(d).getDay()]}</text>
        ${v ? `<text x="${x + bw / 2}" y="${Math.max(top + 8, y(v) - 4)}" text-anchor="middle">${r0(v)}</text>` : ''}`;
    }).join('')}
  </svg>`;
}

function renderDiary() {
  const goal = dayBudget(cur);
  const t = foodTotals(cur);
  const yesterday = addDays(cur, -1);
  $('#view-diary').innerHTML = `
    <div class="card">
      <div class="grid3 num" style="text-align:center">
        <div><small class="muted">${goal - t.kcal < 0 ? '已超過' : '還可以吃'}</small><div><b class="big" style="color:${goal - t.kcal < 0 ? 'var(--accent-text)' : 'var(--good)'}">${Math.abs(r0(goal - t.kcal))}</b></div></div>
        <div><small class="muted">已吃</small><div><b>${r0(t.kcal)}</b></div></div>
        <div><small class="muted">目標</small><div><b>${goal}</b></div></div>
      </div>
    </div>
    ${MEALS.map(([k, n]) => {
      const items = S.entries.filter((e) => e.date === cur && e.meal === k);
      const hasYesterday = S.entries.some((e) => e.date === yesterday && e.meal === k);
      return `<div class="card">
        <div class="card-head"><h3>${mealIcon[k]} ${n}</h3><span class="kcal num">${r0(foodTotals(cur, k).kcal)} kcal</span></div>
        <div class="list">${items.length ? items.map((e) => {
          const nn = nut(e);
          return `<button class="row" data-action="edit-entry" data-id="${e.id}">
            <div class="grow"><div class="name">${esc(e.food.name)}</div>
            <div class="sub">${esc(amountLabel(e))} · 碳 ${r0(nn.c)} / 蛋 ${r0(nn.p)} / 脂 ${r0(nn.f)}</div></div>
            <div class="kcal num">${r0(nn.kcal)}</div></button>`;
        }).join('') : '<div class="empty">還沒有記錄</div>'}</div>
        <div class="btn-row start">
          <button class="link-btn" data-action="add-food" data-meal="${k}">＋ ${k === 'drinks' ? '新增飲料' : '新增食物'}</button>
          ${k === 'drinks' ? `<button class="link-btn" data-action="drink" data-meal="${k}">🧋 手搖飲計算</button>` : ''}
          <button class="link-btn" data-action="manual" data-meal="${k}">✏️ 自行輸入</button>
          ${hasYesterday && !items.length ? `<button class="link-btn" data-action="copy-meal" data-meal="${k}">↻ 複製昨天的${n}</button>` : ''}
        </div>
      </div>`;
    }).join('')}`;
}

function renderProgress() {
  const ws = Object.entries(S.weights).sort(([a], [b]) => a.localeCompare(b));
  const w = latestWeight(today());
  const bmi = w / (S.profile.height / 100) ** 2;
  const first = ws[0]?.[1];
  const last30 = Array.from({ length: 30 }, (_, i) => addDays(today(), i - 29));
  const logged = last30.filter((d) => S.entries.some((e) => e.date === d));
  const avg = logged.length ? logged.reduce((s, d) => s + foodTotals(d).kcal, 0) / logged.length : 0;

  $('#view-progress').innerHTML = `
    <div class="card">
      <div class="card-head"><h3>記錄體重・腰圍</h3></div>
      <form id="weight-form">
        <label>日期<input type="date" name="date" value="${cur}" max="${today()}" required /></label>
        <div class="grid2">
          <label>體重 kg<input type="number" name="kg" inputmode="decimal" step="0.1" min="20" max="400" value="${S.weights[cur] ?? ''}" placeholder="${r1(w)}" /></label>
          <label>腰圍 cm（選填）<input type="number" name="waist" inputmode="decimal" step="0.1" min="40" max="200" value="${S.waists[cur] ?? ''}" placeholder="${latestWaist()?.cm ?? '肚臍高度'}" /></label>
        </div>
        <p class="muted" style="margin-top:8px">建議早上起床、上完廁所、吃東西前量。腰圍：皮尺繞過肚臍、保持水平，自然吐氣後量，不要縮小腹。</p>
        <div class="btn-row"><button class="btn primary">儲存</button></div>
      </form>
    </div>
    ${absProgressCard()}
    <div class="card chart">
      <div class="card-head"><h3>體重變化</h3><span class="muted">近 90 天</span></div>
      ${weightChart(ws.filter(([d]) => d >= addDays(today(), -90)))}
      <div class="stats num">
        <div><b>${r1(w)}</b><small>目前 kg</small></div>
        <div><b>${first != null ? (w - first > 0 ? '+' : '') + r1(w - first) : '—'}</b><small>累計變化 kg</small></div>
        <div><b>${r1(bmi)}</b><small>BMI</small></div>
      </div>
    </div>
    ${adaptiveCard()}
    <div class="card">
      <div class="card-head"><h3>近 30 天</h3></div>
      <div class="stats num" style="margin-top:0">
        <div><b>${logged.length}</b><small>有記錄天數</small></div>
        <div><b>${r0(avg)}</b><small>平均攝取 kcal</small></div>
        <div><b>${logged.filter((d) => foodTotals(d).kcal <= calorieGoal()).length}</b><small>未超標天數</small></div>
      </div>
    </div>
    ${ws.length ? `<div class="card"><div class="card-head"><h3>體重紀錄</h3></div><div class="list">
      ${ws.slice(-10).reverse().map(([d, kg]) => `<div class="row"><div class="grow"><div class="name">${dateLabel(d)}</div></div>
        <div class="kcal num">${kg} kg</div><button class="icon-btn" data-action="del-weight" data-date="${d}" aria-label="刪除">✕</button></div>`).join('')}
    </div></div>` : ''}`;
}

function absProgressCard() {
  const ws = Object.entries(S.waists || {}).sort(([a], [b]) => a.localeCompare(b));
  const h = S.profile.height;
  const target = r1(h * WHTR_TARGET);
  const trend = weightTrend();
  let rate = '';
  if (trend) {
    const pct = -trend.pct;
    rate = pct > 1.1 ? `⚠️ 最近每週減 ${r1(-trend.perWeek)} kg（體重的 ${r1(pct)}%），掉太快容易流失肌肉，腹肌反而出不來，可以每天多吃 100–200 kcal。`
      : pct >= 0.4 ? `✅ 最近每週減 ${r1(-trend.perWeek)} kg（體重的 ${r1(pct)}%），速度剛好，繼續保持。`
      : pct > 0 ? `最近每週減 ${r1(-trend.perWeek)} kg，速度偏慢。先確認記錄有沒有漏掉，特別是飲料和醬料。`
      : `最近 3 週體重沒有下降（${trend.perWeek > 0 ? '+' : ''}${r1(trend.perWeek)} kg／週）。先確認記錄是否完整，再考慮把目標調低 100–200 kcal。`;
  }
  if (!ws.length) {
    return `<div class="card">
      <div class="card-head"><h3>🎯 腹肌進度</h3></div>
      <p class="muted">小腹的脂肪沒辦法只減局部，會跟著全身體脂一起下降。<b>腰圍</b>是最直接的指標：每週量一次，記在上面的表單。</p>
      <p class="note">你的目標腰圍：<b>≤ ${target} cm</b>（身高 ${h} cm × 0.45）。腰圍／身高降到 0.45 左右，通常腹肌線條就會開始出現。</p>
      ${rate ? `<p class="note">${rate}</p>` : ''}
    </div>`;
  }
  const first = ws[0][1];
  const [lastDate, now] = ws.at(-1);
  const whtr = now / h;
  const bf = rfm(now);
  const pct = first > target ? Math.min(100, Math.max(0, ((first - now) / (first - target)) * 100)) : 100;
  const status = whtr <= WHTR_TARGET ? '已達精實範圍，腹肌線條應該開始看得到了 💪' : whtr <= 0.5 ? '健康範圍，再往下就會開始看到線條' : '先降到 0.5 以下（健康範圍）';
  return `<div class="card chart">
    <div class="card-head"><h3>🎯 腹肌進度</h3><span class="muted">${short(lastDate)} 量</span></div>
    <div class="stats num" style="margin-top:0">
      <div><b>${now}</b><small>腰圍 cm</small></div>
      <div><b>${now - first > 0 ? '+' : ''}${r1(now - first)}</b><small>累計 cm</small></div>
      <div><b>${r1(Math.max(0, now - target))}</b><small>距離目標 cm</small></div>
    </div>
    <div class="goal-bar"><i style="width:${pct}%"></i></div>
    <p class="muted num" style="margin-top:4px">起點 ${first} cm → 目標 ≤ ${target} cm · 已完成 ${r0(pct)}%</p>
    ${ws.length >= 2 ? weightChart(ws.slice(-30), 'cm') : ''}
    <p class="note num">腰圍／身高 <b>${whtr.toFixed(2)}</b>：${status}<br/>粗估體脂 <b>${r0(bf)}%</b>（依身高與腰圍推算，只看趨勢就好）
      ${rate ? `<br/>${rate}` : ''}</p>
  </div>`;
}

function adaptiveCard() {
  const a = adaptive(today());
  const f = r0(a.formula);
  const step = (ok, text) => `<li class="${ok ? 'done' : ''}">${ok ? '✓' : '○'} ${text}</li>`;
  if (!a.ready) {
    return `<div class="card">
      <div class="card-head"><h3>你的實際消耗</h3><span class="muted">資料累積中</span></div>
      <p class="muted">持續記錄飲食和體重，App 會用「吃了多少」和「體重實際怎麼變」反推你真正的每日消耗，每週一自動修正熱量目標。目前先用公式估算：<b>${f.toLocaleString()} kcal</b>。</p>
      <ul class="checklist">
        ${step(a.n >= 7, `完整記錄飲食 ${Math.min(a.n, 7)} / 7 天`)}
        ${step(a.m >= 3, `量體重 ${Math.min(a.m, 3)} / 3 次`)}
        ${step(a.span >= 10, `第一次到最後一次量體重相隔 ${Math.min(a.span, 10)} / 10 天`)}
      </ul>
      <p class="muted">統計區間：${short(a.start)}～${short(a.end)}（最近 3 週）。沒記完整的日子（低於 ${r0(a.formula * 0.4)} kcal）不會算進來。</p>
    </div>`;
  }
  const est = r0(a.est);
  const diff = est - f;
  const wk = a.weeklyChange;
  return `<div class="card">
    <div class="card-head"><h3>你的實際消耗</h3><span class="muted">${short(a.since)} 起的這週</span></div>
    <div class="stats num" style="margin-top:0">
      <div><b>${est.toLocaleString()}</b><small>每日消耗 kcal</small></div>
      <div><b>${r0(a.avgIntake).toLocaleString()}</b><small>平均攝取 kcal</small></div>
      <div><b>${wk > 0 ? '+' : ''}${r1(wk)}</b><small>體重 kg／週</small></div>
    </div>
    <p class="note">依你最近 3 週（${short(a.start)}～${short(a.end)}）平均每天吃 ${r0(a.avgIntake)} kcal、體重每週${wk < 0 ? '減少' : '增加'} ${Math.abs(r1(wk))} kg 推算，你每天大約消耗 <b>${est.toLocaleString()} kcal</b>，
      比公式估的 ${f.toLocaleString()} ${diff >= 0 ? '多' : '少'} ${Math.abs(diff)} kcal。${S.profile.autoAdjust ? '本週的熱量目標已經依此調整。' : '（自動修正目前關閉，可以到設定打開）'}
      ${a.conf < 1 ? `<br/>資料還不算多（可信度 ${r0(a.conf * 100)}%），所以先部分參考公式；記錄越完整會越準。` : ''}
      ${a.clamped ? '<br/>⚠️ 推算結果和公式差太多，可能有幾天沒記完整，已先限制在公式的 ±30% 內。' : ''}</p>
  </div>`;
}

function weightChart(points, unit = 'kg') {
  if (points.length < 2) return '<p class="empty">記錄兩天以上的體重就會出現趨勢圖。</p>';
  const W = 320, H = 150, L = 30, R = 8, T = 10, B = 20;
  const t0 = parseYmd(points[0][0]).getTime(), t1 = parseYmd(points.at(-1)[0]).getTime();
  const vals = points.map((p) => p[1]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 2) { const m = (hi + lo) / 2; lo = m - 1; hi = m + 1; }
  const x = (d) => L + ((parseYmd(d).getTime() - t0) / (t1 - t0 || 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const ticks = [lo, (lo + hi) / 2, hi];
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="體重趨勢圖">
    ${ticks.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 4}" y="${y(v) + 3}" text-anchor="end">${r1(v)}</text>`).join('')}
    <polyline class="line" points="${points.map(([d, v]) => `${x(d)},${y(v)}`).join(' ')}"/>
    ${points.map(([d, v]) => `<circle class="dot" cx="${x(d)}" cy="${y(v)}" r="2.5"><title>${short(d)}：${v} ${unit}</title></circle>`).join('')}
    <text x="${L}" y="${H - 4}">${short(points[0][0])}</text>
    <text x="${W - R}" y="${H - 4}" text-anchor="end">${short(points.at(-1)[0])}</text>
  </svg>`;
}

function renderSettings() {
  const p = S.profile;
  const opt = (list, v) => list.map(([val, label]) => `<option value="${val}" ${+val === +v ? 'selected' : ''}>${label}</option>`).join('');
  const auto = calorieGoal();
  const act = activityInfo(today());
  const actNote = act?.ready ? `近 14 天平均活動 <b>${r0(act.baseline)}</b> kcal（Apple 健康）`
    : S.health.enabled ? `Apple 健康資料累積中（${act?.n || 0}/${BASELINE_MIN} 天），暫用一般活動量估算`
    : '尚未同步活動資料，暫用一般活動量估算';
  $('#view-settings').innerHTML = `
    <form id="profile-form" class="card">
      <div class="card-head"><h3>個人資料與目標</h3></div>
      <div class="grid2">
        <label>性別<select name="sex"><option value="male" ${p.sex === 'male' ? 'selected' : ''}>男</option><option value="female" ${p.sex === 'female' ? 'selected' : ''}>女</option></select></label>
        <label>年齡<input name="age" type="number" inputmode="numeric" min="10" max="100" value="${p.age}" /></label>
        <label>身高 cm<input name="height" type="number" inputmode="decimal" min="100" max="250" step="0.1" value="${p.height}" /></label>
        <label>體重 kg<input name="weight" type="number" inputmode="decimal" min="20" max="400" step="0.1" value="${r1(latestWeight(today()))}" /></label>
      </div>
      <label>目標<select name="weeklyGoal">${opt(WEEKLY, p.weeklyGoal)}</select></label>
      <label class="check"><input type="checkbox" name="autoAdjust" ${p.autoAdjust ? 'checked' : ''} /> 依體重趨勢自動修正（每週一更新，建議開啟）</label>
      <p class="note num">基礎代謝 BMR ≈ <b>${r0(bmr(p, latestWeight(today())))}</b> kcal · ${actNote}
        <br/>估算每日消耗 ≈ <b>${r0(formulaTdee(today()))}</b> kcal
        ${adaptive(today()).ready ? `<br/>依你的紀錄推算實際消耗 ≈ <b>${r0(adaptive(today()).est)}</b> kcal` : '<br/>實際消耗：資料累積中（詳見「進度」頁）'}
        <br/>${p.autoAdjust && adaptive(today()).ready ? '已自動修正的' : ''}建議每日攝取：<b>${auto}</b> kcal</p>
      <label>目標模式<select name="mode">
        <option value="abs" ${p.mode === 'abs' ? 'selected' : ''}>🔥 減脂・腹肌（蛋白質依體重計算）</option>
        <option value="general" ${p.mode !== 'abs' ? 'selected' : ''}>一般（三大營養素比例）</option>
      </select></label>
      <div class="grid3" ${p.mode === 'abs' ? '' : 'hidden'} data-mode="abs">
        <label>蛋白質 g／kg<input name="ppk" type="number" inputmode="decimal" step="0.1" min="1.2" max="3" value="${p.proteinPerKg}" /></label>
        <label>脂肪 %<input name="fpct" type="number" inputmode="numeric" min="15" max="40" value="${p.fatPct}" /></label>
        <label>飲料上限 kcal<input name="dlim" type="number" inputmode="numeric" min="0" step="10" value="${p.drinkLimit}" /></label>
      </div>
      <p class="muted" ${p.mode === 'abs' ? '' : 'hidden'} data-mode="abs" style="margin-top:6px">減脂期建議蛋白質每公斤 1.8–2.2 g、每週減體重的 0.5–1%，並搭配重量訓練保住肌肉。碳水＝剩下的熱量。</p>
      <p class="muted" style="margin-top:12px" ${p.mode === 'abs' ? 'hidden' : ''} data-mode="general"><b>三大營養素比例（%）</b></p>
      <div class="grid3" ${p.mode === 'abs' ? 'hidden' : ''} data-mode="general">
        <label>碳水<input name="mc" type="number" inputmode="numeric" min="0" max="100" value="${p.macros.c}" /></label>
        <label>蛋白質<input name="mp" type="number" inputmode="numeric" min="0" max="100" value="${p.macros.p}" /></label>
        <label>脂肪<input name="mf" type="number" inputmode="numeric" min="0" max="100" value="${p.macros.f}" /></label>
      </div>
      <div class="btn-row"><button class="btn primary">儲存設定</button></div>
    </form>

    <form id="health-form" class="card">
      <div class="card-head"><h3>⌚ Apple 健康同步</h3><span class="muted">${S.health.enabled ? (S.health.error ? '⚠️ 有問題' : '已啟用') : '未啟用'}</span></div>
      <p class="muted">用 iPhone 捷徑把 Garmin 寫進 Apple 健康的「活動能量」送進來。你平常的活動量已經算在目標裡，所以只有<b>比平常多動的部分</b>會加回 70% 到當天的額度。<a href="apple-health.html">一步一步設定教學 ›</a></p>
      <label class="check"><input type="checkbox" name="enabled" ${S.health.enabled ? 'checked' : ''} /> 啟用 Apple 健康同步</label>
      <label>接收端網址<input name="endpoint" value="${esc(S.health.endpoint)}" autocomplete="off" spellcheck="false" /></label>
      <label>同步密碼（捷徑和這裡要填同一組；雲端備份也用這組）
        <div class="search-row"><input name="token" type="password" value="${esc(S.health.token)}" autocomplete="off" spellcheck="false" placeholder="按「產生」建立一組" />
        <button type="button" class="btn" data-action="gen-token">產生</button></div></label>
      <div class="btn-row start">
        <button class="btn primary">儲存並測試連線</button>
        <button type="button" class="btn" data-action="copy-token">複製密碼</button>
      </div>
      <p class="note num" id="health-status">${S.health.error ? '⚠️ ' + esc(S.health.error)
        : S.health.updatedAt ? `最後收到資料：${new Date(S.health.updatedAt).toLocaleString('zh-TW')} · 共 ${Object.keys(S.health.days).length} 天` : '還沒有收到資料。'}</p>
    </form>

    <div class="card">
      <div class="card-head"><h3>☁️ 雲端同步・備份</h3><span class="muted">${cloudReady() ? '同步中' : '未啟用'}</span></div>
      <p class="muted">手機、電腦（還有 Safari 和主畫面 App）只要填同一組網址和同步密碼，就會看到同一份資料：記錄後幾秒內上傳，打開或切回 App 時抓最新的，開著不動也每 2 分鐘更新一次。雲端另外保留最近 30 天、每天一份快照，可以隨時還原。</p>
      <label class="check"><input type="checkbox" id="cloud-enabled" ${cloud.enabled ? 'checked' : ''} /> 自動同步</label>
      <p class="note num" id="cloud-status">${esc(cloudStatusText())}</p>
      <div class="btn-row start">
        <button type="button" class="btn primary" data-action="cloud-backup">立即同步</button>
        <button type="button" class="btn" data-action="cloud-list">從雲端還原…</button>
      </div>
      <div id="cloud-restore" class="list"></div>
    </div>

    <div class="card">
      <div class="card-head"><h3>自訂食物</h3><span class="muted">${S.customFoods.length} 項</span></div>
      <div class="list">${S.customFoods.length ? S.customFoods.map((f) => `<div class="row"><button class="grow link-row" data-action="edit-custom" data-id="${f.id}"><div class="name">${esc(f.name)}</div>
        <div class="sub">${esc(f.serving)} · ${r0(f.kcal)} kcal${f.barcode ? ' · 條碼 ' + esc(f.barcode) : ''}</div></button><button class="icon-btn" data-action="del-custom" data-id="${f.id}" aria-label="刪除">✕</button></div>`).join('')
        : '<div class="empty">在「新增食物」裡可以建立自己的食物。</div>'}</div>
    </div>

    <div class="card">
      <div class="card-head"><h3>資料備份</h3></div>
      <p class="muted">除了雲端備份，也可以把資料下載成檔案，存到「檔案」App 或 iCloud 雲碟，多一層保險。</p>
      <div class="btn-row start">
        <button class="btn" data-action="export">⬇ 匯出備份</button>
        <label class="btn" style="margin:0;color:inherit;font-size:inherit">⬆ 匯入備份<input type="file" id="import-file" accept=".json,application/json" class="visually-hidden" /></label>
        <button class="btn ghost danger" data-action="reset">清除全部資料</button>
      </div>
    </div>
    <p class="muted" style="text-align:center">Brian as the Chef · 食物營養資料：內建常見台灣食物估算值 ＋ <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a></p>`;

  $('#profile-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const mc = num(fd.get('mc')), mp = num(fd.get('mp')), mf = num(fd.get('mf'));
    const mode = fd.get('mode');
    if (mode !== 'abs' && Math.round(mc + mp + mf) !== 100) { toast(`營養素比例加總要是 100%（目前 ${mc + mp + mf}%）`); return; }
    const newW = num(fd.get('weight'));
    Object.assign(S.profile, {
      sex: fd.get('sex'), age: num(fd.get('age')), height: num(fd.get('height')),
      weeklyGoal: num(fd.get('weeklyGoal')),
      macros: { c: mc, p: mp, f: mf }, autoAdjust: !!fd.get('autoAdjust'),
      mode, proteinPerKg: num(fd.get('ppk')) || 2, fatPct: num(fd.get('fpct')) || 25, drinkLimit: num(fd.get('dlim')),
    });
    if (newW && r1(newW) !== r1(latestWeight(today()))) {
      if (Object.keys(S.weights).length) S.weights[today()] = r1(newW);
      else S.profile.weight = r1(newW);
    }
    save();
    renderSettings();
    toast('已儲存');
  });
  $('#profile-form [name=mode]').addEventListener('change', (e) => {
    for (const el of document.querySelectorAll('#profile-form [data-mode]')) el.hidden = el.dataset.mode !== e.target.value;
  });
  $('#health-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    Object.assign(S.health, {
      enabled: !!fd.get('enabled'),
      endpoint: String(fd.get('endpoint') || '').trim().replace(/\/+$/, ''),
      token: String(fd.get('token') || '').trim(),
    });
    save();
    if (!S.health.enabled) { S.health.error = ''; save(); renderSettings(); toast('已儲存（Apple 健康同步未啟用）'); cloudSync(); return; }
    if (!S.health.token) { toast('請先填同步密碼'); return; }
    $('#health-status').textContent = '測試連線中…';
    const ok = await fetchHealth(true);
    renderSettings();
    cloudSync();
    toast(ok ? '連線成功 ✅' : '連線失敗，請看下面的錯誤訊息');
  });
  $('#cloud-enabled').addEventListener('change', (e) => {
    cloud.enabled = e.target.checked;
    saveCloud();
    if (cloud.enabled) cloudSync();
    updateCloudStatus();
  });
  $('#import-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || !Array.isArray(data.entries) || !data.profile) throw new Error('格式不符');
      if (!confirm('匯入會覆蓋目前所有資料，確定嗎？')) return;
      localStorage.setItem(KEY, JSON.stringify(data));
      S = load();
      dataVer++;
      lastSnap = stable(syncable(S));
      markChanged();
      render();
      toast('已匯入備份');
    } catch (err) {
      toast('匯入失敗：' + err.message);
    }
  });
}

// ================= food dialog =================
let foodMeal = 'breakfast';
let searchSeq = 0;

function defaultMeal() {
  const h = new Date().getHours();
  if (cur !== today()) return 'snack';
  return h < 10 ? 'breakfast' : h < 14 ? 'lunch' : h < 17 ? 'snack' : h < 21 ? 'dinner' : 'snack';
}

function openFood(meal) {
  foodMeal = meal || defaultMeal();
  $('#food-meal-label').textContent = `· ${mealName(foodMeal)} · ${dateLabel(cur)}`;
  $('#food-q').value = '';
  showLocalResults('');
  $('#dlg-food').showModal();
}

function foodRow(f, i, list) {
  const per = f.grams ? `每 ${f.grams} g` : f.serving;
  return `<button class="row" data-action="pick-food" data-list="${list}" data-i="${i}">
    <div class="grow"><div class="name">${esc(f.name)}</div><div class="sub">${esc([f.brand, per].filter(Boolean).join(' · '))}</div></div>
    <div class="kcal num">${r0(f.kcal)} kcal</div></button>`;
}

let lists = { local: [], online: [] };
function showLocalResults(q) {
  const box = $('#food-results');
  const query = q.trim().toLowerCase();
  if (!query) {
    if (foodMeal === 'drinks') {
      const isDrink = (f) => /drink/.test(f.tags || '') || String(f.id).startsWith('drink:');
      const recent = S.recents.filter(isDrink);
      lists.local = [...recent, ...FOODS.filter(isDrink)];
      box.innerHTML = (recent.length ? `<div class="list-section">最近喝過</div>${recent.map((f, i) => foodRow(f, i, 'local')).join('')}` : '') +
        `<div class="list-section">常見飲料</div>${lists.local.slice(recent.length).map((f, i) => foodRow(f, i + recent.length, 'local')).join('')}`;
      return;
    }
    lists.local = [...S.recents];
    box.innerHTML = lists.local.length
      ? `<div class="list-section">最近吃過</div>${lists.local.map((f, i) => foodRow(f, i, 'local')).join('')}`
      : '<p class="empty">輸入食物名稱搜尋，或用掃條碼、手搖飲計算。找不到的食物可以按「自行輸入」。</p>';
    return;
  }
  const match = (f) => (f.name + ' ' + (f.brand || '') + ' ' + (f.tags || '')).toLowerCase().includes(query);
  const seen = new Set();
  lists.local = [...S.customFoods, ...S.recents, ...FOODS].filter((f) => {
    if (!match(f) || seen.has(f.name + f.serving)) return false;
    seen.add(f.name + f.serving);
    return true;
  }).slice(0, 30);
  box.innerHTML = (lists.local.length
    ? `<div class="list-section">我的食物與常見食物</div>${lists.local.map((f, i) => foodRow(f, i, 'local')).join('')}`
    : '') + '<div id="online-results"></div>' +
    `<button class="row add-new" data-action="new-custom" data-name="${esc(q.trim())}">
      <div class="grow"><div class="name">＋ 自己新增「${esc(q.trim())}」</div><div class="sub">找不到或數字不對？照營養標示自己建立</div></div></button>`;
}

// ---------- Open Food Facts：多個來源依序嘗試 ----------
// 1) 新版搜尋服務 search.openfoodfacts.org（支援網頁直接呼叫）
// 2) 舊版 cgi/search.pl（流量限制嚴，被擋時 Safari 只會顯示 Load failed）
// 3) 經過自己的 Cloudflare 接收端轉接（伺服器端連線，不受瀏覽器限制；需先部署 apo-health）
const OFF_FIELDS = 'code,product_name,product_name_zh,brands,nutriments,serving_quantity';
const offProxy = () => (S.health.endpoint ? S.health.endpoint.replace(/\/+$/, '') + '/off' : '');

async function fetchJson(url, ms = 8000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok && res.status !== 404) throw new Error('HTTP ' + res.status);
    return await res.json();
  } catch (e) {
    throw new Error(e.name === 'AbortError' ? '逾時' : e.message);
  } finally {
    clearTimeout(timer);
  }
}

async function firstWorking(urls) {
  const errors = [];
  for (const url of urls.filter(Boolean)) {
    try { return await fetchJson(url); } catch (e) { errors.push(e.message); }
  }
  throw new Error(errors.at(-1) || '沒有可用的來源');
}

function friendlyError(msg) {
  if (/Load failed|Failed to fetch|NetworkError/i.test(msg)) return '連不到線上資料庫（可能是網路不穩或對方暫時限流）';
  if (/429/.test(msg)) return '線上資料庫暫時限流，請稍後再試';
  if (msg === '逾時') return '線上資料庫回應太慢';
  return msg;
}

async function offSearch(q) {
  const enc = encodeURIComponent(q);
  const proxy = offProxy();
  const data = await firstWorking([
    `https://search.openfoodfacts.org/search?q=${enc}&page_size=25&langs=zh,en&fields=${OFF_FIELDS}`,
    `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${enc}&search_simple=1&action=process&json=1&page_size=25&fields=${OFF_FIELDS}`,
    proxy && `${proxy}/search?q=${enc}`,
  ]);
  return data.products || data.hits || [];
}

async function offProduct(code) {
  const proxy = offProxy();
  const data = await firstWorking([
    `https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${OFF_FIELDS}`,
    proxy && `${proxy}/product/${code}`,
  ]);
  return data?.status === 1 || data?.status === 'success' ? data.product : null;
}

async function searchOnline(q) {
  const seq = ++searchSeq;
  const box = $('#online-results');
  if (!box) return;
  box.innerHTML = '<div class="list-section">Open Food Facts 線上資料庫</div><p class="empty">搜尋中…</p>';
  try {
    const products = await offSearch(q);
    if (seq !== searchSeq) return;
    lists.online = products.map(offToFood).filter(Boolean);
    box.innerHTML = '<div class="list-section">Open Food Facts 線上資料庫</div>' +
      (lists.online.length ? lists.online.map((f, i) => foodRow(f, i, 'online')).join('') : '<p class="empty">線上沒有找到，可以換個關鍵字，或用下面的按鈕自己新增。</p>');
  } catch (e) {
    if (seq === searchSeq) box.innerHTML = `<p class="empty">線上搜尋失敗：${esc(friendlyError(e.message))}。上面的常見食物和「自己新增」都可以照常使用。</p>`;
  }
}

// 名稱可能是字串，也可能是各語言的物件（新版搜尋服務）
function pickText(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return pickText(v[0]);
  if (typeof v === 'object') return v.zh || v['zh-TW'] || v.main || v.en || Object.values(v).find((x) => typeof x === 'string') || '';
  return String(v);
}

function offToFood(p) {
  if (!p) return null;
  const n = p.nutriments || {};
  let kcal = n['energy-kcal_100g'];
  if (kcal == null && n['energy_100g'] != null) kcal = n['energy_100g'] / 4.184;
  const name = (pickText(p.product_name_zh) || pickText(p.product_name)).trim();
  if (kcal == null || !name) return null;
  const brand = Array.isArray(p.brands) ? pickText(p.brands) : String(p.brands || '').split(',')[0];
  return {
    id: 'off:' + p.code, name, brand: brand.trim(), grams: 100,
    defaultGrams: Number(p.serving_quantity) > 0 ? Number(p.serving_quantity) : 100,
    serving: '100 g', kcal: +kcal, p: +(n.proteins_100g || 0), c: +(n.carbohydrates_100g || 0), f: +(n.fat_100g || 0),
  };
}

// ================= quantity dialog =================
let qtyCtx = null; // { food, entryId? }

function openQty(food, entry) {
  qtyCtx = { food, entryId: entry?.id };
  $('#qty-title').textContent = food.name;
  $('#qty-sub').textContent = [food.brand, food.grams ? `每 ${food.grams} g：${r0(food.kcal)} kcal` : `每份 ${food.serving}：${r0(food.kcal)} kcal`].filter(Boolean).join(' · ');
  $('#qty-unit').textContent = food.grams ? '份量（g）' : `份數（1 份 = ${food.serving}）`;
  const amt = $('#qty-amount');
  amt.step = food.grams ? '1' : '0.25';
  amt.value = entry ? entry.amount : food.grams ? food.defaultGrams || food.grams : 1;
  $('#qty-meal').innerHTML = MEALS.map(([k, n]) => `<option value="${k}" ${(entry?.meal || foodMeal) === k ? 'selected' : ''}>${n}</option>`).join('');
  $('#qty-delete').hidden = !entry;
  $('#qty-submit').textContent = entry ? '更新' : '加入';
  updateQtyPreview();
  $('#dlg-qty').showModal();
  amt.select();
}

function qtyFactor() {
  const a = num($('#qty-amount').value);
  return qtyCtx.food.grams ? a / qtyCtx.food.grams : a;
}

function updateQtyPreview() {
  if (!qtyCtx) return;
  const f = qtyCtx.food, k = qtyFactor();
  $('#qty-preview').innerHTML = [['kcal', f.kcal], ['碳水 g', f.c], ['蛋白質 g', f.p], ['脂肪 g', f.f]]
    .map(([l, v]) => `<div><b class="num">${l === 'kcal' ? r0(v * k) : r1(v * k)}</b><small>${l}</small></div>`).join('');
}

function rememberFood(food) {
  const key = food.name + '|' + food.serving;
  S.recents = [food, ...S.recents.filter((f) => f.name + '|' + f.serving !== key)].slice(0, 30);
}

$('#qty-amount').addEventListener('input', updateQtyPreview);
$('#qty-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const amount = num($('#qty-amount').value);
  if (amount <= 0) { toast('請輸入份量'); return; }
  const meal = $('#qty-meal').value;
  const qty = qtyFactor();
  if (qtyCtx.entryId) {
    const en = S.entries.find((x) => x.id === qtyCtx.entryId);
    Object.assign(en, { amount, qty, meal });
  } else {
    S.entries.push({ id: uid(), date: cur, meal, food: { ...qtyCtx.food }, amount, qty });
    rememberFood(qtyCtx.food);
  }
  save();
  $('#dlg-qty').close();
  $('#dlg-food').close();
  toast(`${qtyCtx.entryId ? '已更新' : '已加入'}：${qtyCtx.food.name}`);
  render();
});
$('#qty-delete').addEventListener('click', () => {
  S.entries = S.entries.filter((x) => x.id !== qtyCtx.entryId);
  save();
  $('#dlg-qty').close();
  toast('已刪除');
  render();
});

// ================= custom food / quick add =================
// mode: 'quick'（只加熱量）| 'custom'（新增自訂食物）| 'edit'（編輯自訂食物）
function openCustom(mode, preset = {}) {
  const form = $('#custom-form');
  form.reset();
  form.mode.value = mode;
  form.barcode.value = preset.barcode || '';
  form.editId.value = mode === 'edit' ? preset.id : '';
  $('#custom-title').textContent = { quick: '快速加熱量', custom: '新增食物', edit: '編輯自訂食物' }[mode];
  $('#custom-serving-wrap').hidden = mode === 'quick';
  $('#custom-save-wrap').hidden = mode !== 'custom';
  $('#custom-submit').textContent = mode === 'custom' ? '儲存並加入' : '儲存';
  const hint = [];
  if (preset.barcode) hint.push(`條碼 ${preset.barcode}：儲存後下次掃這個條碼就會直接找到。`);
  if (mode !== 'quick') hint.push('照包裝上營養標示的「每一份」填寫即可，蛋白質、碳水、脂肪可以留空。');
  $('#custom-hint').textContent = hint.join(' ');
  $('#custom-hint').hidden = !hint.length;
  form.name.value = mode === 'quick' ? '快速加入' : preset.name || '';
  if (mode === 'edit') {
    form.serving.value = preset.serving || '';
    for (const k of ['kcal', 'p', 'c', 'f']) form[k].value = preset[k] || '';
  }
  $('#dlg-custom').showModal();
  (mode === 'quick' || preset.name ? form.kcal : form.name).focus();
}

$('#custom-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const mode = fd.get('mode');
  const fields = {
    name: fd.get('name').trim() || '快速加入', serving: (fd.get('serving') || '').trim() || '1 份',
    kcal: num(fd.get('kcal')), p: num(fd.get('p')), c: num(fd.get('c')), f: num(fd.get('f')),
  };
  if (fd.get('barcode')) fields.barcode = fd.get('barcode');
  $('#dlg-custom').close();
  if (mode === 'quick') {
    S.entries.push({ id: uid(), date: cur, meal: foodMeal, food: { id: 'custom:' + uid(), ...fields }, amount: 1, qty: 1 });
    save();
    $('#dlg-food').close();
    toast(`已加入 ${r0(fields.kcal)} kcal`);
    render();
  } else if (mode === 'edit') {
    const f = S.customFoods.find((x) => x.id === fd.get('editId'));
    if (f) Object.assign(f, fields);
    save();
    render();
    toast('已更新（之前記錄的份量不受影響）');
  } else {
    const food = { id: 'custom:' + uid(), ...fields };
    if (fd.get('saveMine')) {
      if (food.barcode) S.customFoods = S.customFoods.filter((x) => x.barcode !== food.barcode);
      S.customFoods.unshift(food);
      save();
    }
    openQty(food);
  }
});

// ================= 手搖飲計算機 =================
function openDrink(meal) {
  const radios = (name, list, checkedId) => list.map((x) =>
    `<label><input type="radio" name="${name}" value="${x.id}" ${x.id === checkedId ? 'checked' : ''} />${x.name}</label>`).join('');
  $('#drink-base').innerHTML = radios('base', DRINK_BASES, 'milktea');
  $('#drink-size').innerHTML = radios('size', DRINK_SIZES.map((z) => ({ ...z, name: `${z.name} ${z.ml}ml` })), 'L');
  $('#drink-sugar').innerHTML = radios('sugar', DRINK_SUGARS, 30);
  $('#drink-toppings').innerHTML = DRINK_TOPPINGS.map((t) =>
    `<label><input type="checkbox" name="top" value="${t.id}" />${t.name}</label>`).join('');
  $('#drink-meal').innerHTML = MEALS.map(([k, n]) => `<option value="${k}" ${k === (meal || 'drinks') ? 'selected' : ''}>${n}</option>`).join('');
  $('#drink-form').note.value = '';
  updateDrink();
  $('#dlg-drink').showModal();
}

function buildDrink() {
  const form = $('#drink-form');
  const base = DRINK_BASES.find((b) => b.id === form.base.value);
  const size = DRINK_SIZES.find((z) => z.id === form.size.value);
  const sugar = DRINK_SUGARS.find((x) => String(x.id) === form.sugar.value);
  const tops = [...form.querySelectorAll('input[name=top]:checked')].map((i) => DRINK_TOPPINGS.find((t) => t.id === i.value));
  const ratio = size.ml / 700;
  const sugarG = FULL_SUGAR_G_700 * ratio * (sugar.id / 100);
  const n = { kcal: base.kcal * ratio + sugarG * 4, p: base.p * ratio, c: base.c * ratio + sugarG, f: base.f * ratio };
  for (const t of tops) { n.kcal += t.kcal; n.p += t.p; n.c += t.c; n.f += t.f; }
  const shortBase = base.name.replace(/（.*）/, '');
  const note = form.note.value.trim();
  const name = `${note ? note + ' ' : ''}${shortBase}${tops.length ? '＋' + tops.map((t) => t.name).join('＋') : ''}（${size.name}・${sugar.name}）`;
  return {
    food: { id: 'drink:' + uid(), name, serving: `1 杯 (${size.ml}ml)`, kcal: r0(n.kcal), p: r1(n.p), c: r1(n.c), f: r1(n.f), tags: 'drink 手搖飲' },
    sugarG,
  };
}

function updateDrink() {
  const { food, sugarG } = buildDrink();
  $('#drink-kcal').textContent = food.kcal;
  $('#drink-detail').textContent = `· 糖約 ${r0(sugarG)} g · 碳水 ${r0(food.c)} g`;
}
$('#drink-form').addEventListener('change', updateDrink);
$('#drink-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const { food } = buildDrink();
  S.entries.push({ id: uid(), date: cur, meal: $('#drink-meal').value, food, amount: 1, qty: 1 });
  rememberFood(food);
  save();
  $('#dlg-drink').close();
  $('#dlg-food').close();
  toast(`已加入：${food.name}（${food.kcal} kcal）`);
  render();
});

// ================= barcode =================
// 優先用瀏覽器內建的 BarcodeDetector（Android Chrome）；不支援時（iPhone Safari 等）
// 載入內附的 ZXing WebAssembly 版本（vendor/，第一次掃描時才下載，約 1 MB）。
const BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'];
let detectorPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = src;
    el.onload = resolve;
    el.onerror = () => reject(new Error('掃描元件載入失敗'));
    document.head.append(el);
  });
}

function getDetector() {
  detectorPromise ||= (async () => {
    if ('BarcodeDetector' in window) {
      try {
        const supported = await window.BarcodeDetector.getSupportedFormats();
        if (BARCODE_FORMATS.every((f) => supported.includes(f))) return new window.BarcodeDetector({ formats: BARCODE_FORMATS });
      } catch { /* 改用內附版本 */ }
    }
    await loadScript('vendor/barcode-detector.js');
    const api = window.BarcodeDetectionAPI;
    api.setZXingModuleOverrides({
      locateFile: (path, prefix) => (path.endsWith('.wasm') ? new URL('vendor/' + path, document.baseURI).href : prefix + path),
    });
    return new api.BarcodeDetector({ formats: BARCODE_FORMATS });
  })().catch((e) => { detectorPromise = null; throw e; });
  return detectorPromise;
}

let scanStream = null;
function setScanHint(text, actions = '') {
  $('#scan-hint').textContent = text;
  $('#scan-actions').innerHTML = actions;
}

async function openScan() {
  $('#barcode-input').value = '';
  $('#dlg-scan').showModal();
  getDetector().catch(() => {}); // 先在背景載入
  if (!navigator.mediaDevices?.getUserMedia) {
    setScanHint('這個瀏覽器不能直接開相機，請用「用照片辨識」拍條碼，或手動輸入條碼數字。');
    return;
  }
  setScanHint('開啟相機中…');
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false,
    });
    if (!$('#dlg-scan').open) { stopScan(); return; }
    const video = $('#scan-video');
    video.srcObject = scanStream;
    $('#scan-box').hidden = false;
    await video.play();
    setScanHint('把條碼放進框框裡，拿穩一點…');
    const detector = await getDetector();
    while (scanStream) {
      if (video.readyState >= 2) {
        const codes = await detector.detect(video).catch(() => []);
        if (codes.length && scanStream) {
          navigator.vibrate?.(60);
          const c = codes[0].rawValue;
          stopScan();
          lookupBarcode(c);
          return;
        }
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  } catch (e) {
    stopScan();
    const denied = e.name === 'NotAllowedError';
    setScanHint(denied
      ? '沒有相機權限。請到瀏覽器設定允許這個網站使用相機，或改用「用照片辨識」、手動輸入條碼。'
      : `無法開啟相機（${e.message}），請改用「用照片辨識」或手動輸入條碼。`);
  }
}

function stopScan() {
  scanStream?.getTracks().forEach((t) => t.stop());
  scanStream = null;
  const video = $('#scan-video');
  video.srcObject = null;
  $('#scan-box').hidden = true;
}
$('#dlg-scan').addEventListener('close', stopScan);

$('#scan-photo').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  stopScan();
  setScanHint('辨識照片中…');
  try {
    const detector = await getDetector();
    const codes = await detector.detect(await createImageBitmap(file));
    if (codes.length) lookupBarcode(codes[0].rawValue);
    else setScanHint('照片裡找不到條碼。請靠近一點、對好焦再拍一次，或手動輸入條碼數字。');
  } catch (err) {
    setScanHint('辨識失敗：' + err.message);
  }
});

async function lookupBarcode(code) {
  code = String(code).replace(/\D/g, '');
  if (!code) return;
  $('#barcode-input').value = code;
  // 1) 自己建立過的條碼，直接用（離線也可以）
  const mine = S.customFoods.find((f) => f.barcode === code);
  if (mine) { $('#dlg-scan').close(); openQty(mine); return; }
  // 2) 查 Open Food Facts
  setScanHint(`查詢 ${code}…`);
  const createBtn = `<button class="chip" data-action="new-custom" data-barcode="${code}">＋ 自己建立這個食物</button>`;
  try {
    const food = offToFood(await offProduct(code));
    if (!food) {
      setScanHint(`資料庫裡沒有條碼 ${code} 的營養資料。照包裝上的營養標示自己建立一次，之後掃這個條碼就會直接找到。`, createBtn);
      return;
    }
    $('#dlg-scan').close();
    openQty({ ...food, barcode: code });
  } catch (e) {
    setScanHint(`查詢失敗：${friendlyError(e.message)}。可以稍後再試，或直接自己建立這個食物（之後掃這個條碼就會直接找到）。`, createBtn);
  }
}
$('#barcode-form').addEventListener('submit', (e) => { e.preventDefault(); lookupBarcode($('#barcode-input').value); });

// ================= global events =================
function go(v) {
  view = v;
  history.replaceState(null, '', '#' + v);
  window.scrollTo(0, 0);
  render();
}

document.addEventListener('click', (e) => {
  const closeBtn = e.target.closest('[data-close]');
  if (closeBtn) { closeBtn.closest('dialog').close(); return; }
  const tab = e.target.closest('[data-tab]');
  if (tab) { go(tab.dataset.tab); return; }
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const d = el.dataset;
  switch (d.action) {
    case 'prev-day': cur = addDays(cur, -1); render(); break;
    case 'next-day': cur = addDays(cur, 1); render(); break;
    case 'pick-date': {
      const inp = $('#date-input');
      if (inp.showPicker) { try { inp.showPicker(); break; } catch { /* fall through */ } }
      cur = today(); render();
      break;
    }
    case 'goto': go(d.view); break;
    case 'goto-date': cur = d.date; go('diary'); break;
    case 'add-food': openFood(d.meal); break;
    case 'pick-food': openQty({ ...lists[d.list][+d.i] }); break;
    case 'edit-entry': { const en = S.entries.find((x) => x.id === d.id); if (en) openQty(en.food, en); break; }
    case 'quick-add': openCustom('quick'); break;
    case 'cloud-backup':
      if (!cloudReady()) { toast(S.health?.token ? '請先勾選「自動同步」' : '請先設定同步密碼'); break; }
      $('#cloud-status').textContent = '同步中…';
      cloudSync().then((ok) => toast(ok ? '已同步 ✅' : '同步失敗：' + cloud.error));
      break;
    case 'cloud-list': {
      if (!S.health?.token) { toast('請先設定同步密碼'); break; }
      const box = $('#cloud-restore');
      box.innerHTML = '<p class="empty">讀取雲端備份清單…</p>';
      cloudFetch('/backup/list').then((r) => {
        const items = r?.items || [];
        box.innerHTML = items.length
          ? '<div class="list-section">選擇要還原的版本（每天一份）</div>' + items.map((it) => `<button class="row" data-action="cloud-restore" data-date="${esc(it.date)}">
              <div class="grow"><div class="name">${esc(it.date)}${it.date === items[0].date ? '（最新）' : ''}</div>
              <div class="sub">${it.counts ? `${it.counts.entries} 筆飲食 · ${it.counts.customFoods} 個自訂食物 · ${it.counts.weights} 筆體重` : ''}${it.savedAt ? ' · ' + new Date(it.savedAt).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) : ''}</div></div>
              <div class="kcal">還原</div></button>`).join('')
          : '<p class="empty">雲端還沒有備份。</p>';
      }).catch((e) => { box.innerHTML = `<p class="empty">讀取失敗：${esc(e.message)}</p>`; });
      break;
    }
    case 'cloud-restore': cloudRestore(d.date); break;
    case 'gen-token': {
      const bytes = crypto.getRandomValues(new Uint8Array(24));
      const tok = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const inp = $('#health-form [name=token]');
      inp.value = tok;
      inp.type = 'text';
      toast('已產生，記得按「儲存並測試連線」');
      break;
    }
    case 'copy-token': {
      const v = $('#health-form [name=token]').value;
      if (!v) { toast('還沒有密碼'); break; }
      navigator.clipboard?.writeText(v).then(() => toast('已複製密碼'), () => { const i = $('#health-form [name=token]'); i.type = 'text'; i.select(); toast('請長按手動複製'); });
      break;
    }
    case 'manual': foodMeal = d.meal || defaultMeal(); openCustom('custom'); break;
    case 'drink': openDrink(d.meal || 'drinks'); break;
    case 'new-custom':
      if ($('#dlg-scan').open) $('#dlg-scan').close();
      openCustom('custom', { name: d.name, barcode: d.barcode });
      break;
    case 'edit-custom': { const f = S.customFoods.find((x) => x.id === d.id); if (f) openCustom('edit', f); break; }
    case 'scan': openScan(); break;
    case 'copy-meal': {
      const src = S.entries.filter((x) => x.date === addDays(cur, -1) && x.meal === d.meal);
      S.entries.push(...src.map((x) => ({ ...x, id: uid(), date: cur })));
      save(); render(); toast(`已複製 ${src.length} 項`);
      break;
    }
    case 'del-weight': delete S.weights[d.date]; save(); render(); break;
    case 'del-custom': S.customFoods = S.customFoods.filter((f) => f.id !== d.id); save(); render(); break;
    case 'export': {
      // 備份檔不含同步密碼
      const blob = new Blob([JSON.stringify({ ...S, health: { ...S.health, token: '' } }, null, 1)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `fanfit-backup-${today()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      break;
    }
    case 'reset':
      if (confirm('確定清除全部資料？這個動作無法復原，建議先匯出備份。')) { S = defaults(); save(); render(); toast('已清除'); }
      break;
  }
});

$('#date-input').addEventListener('change', (e) => { if (e.target.value) { cur = e.target.value; render(); } });

$('#food-q').addEventListener('input', (e) => showLocalResults(e.target.value));
$('#food-search-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const q = $('#food-q').value.trim();
  if (!q) return;
  $('#food-q').blur();
  showLocalResults(q);
  searchOnline(q);
});

document.addEventListener('submit', (e) => {
  if (e.target.id !== 'weight-form') return;
  e.preventDefault();
  const fd = new FormData(e.target);
  const kg = num(fd.get('kg'));
  const waist = num(fd.get('waist'));
  if (!kg && !waist) { toast('請輸入體重或腰圍'); return; }
  if (kg && kg < 20) { toast('請輸入正確的體重'); return; }
  if (waist && waist < 40) { toast('請輸入正確的腰圍（cm）'); return; }
  const date = fd.get('date');
  if (kg) S.weights[date] = r1(kg);
  if (waist) (S.waists ||= {})[date] = r1(waist);
  save();
  render();
  toast([kg && '體重', waist && '腰圍'].filter(Boolean).join('、') + '已記錄');
});

// ================= Apple 健康同步 =================
const HEALTH_SHORTCUT = 'Chef同步';
const HEALTH_REFRESH_MS = 60 * 60 * 1000; // App 開著時每小時重新抓一次
let healthBusy = false;
async function fetchHealth(force = false) {
  const h = S.health;
  if (!h.enabled || !h.token || !h.endpoint || healthBusy) return false;
  if (!force && h.fetchedAt && Date.now() - h.fetchedAt < 5 * 60 * 1000) return true;
  healthBusy = true;
  try {
    const res = await fetch(h.endpoint + '/data', { headers: { Authorization: 'Bearer ' + h.token }, cache: 'no-store' });
    if (res.status === 401) throw new Error('密碼不對（和捷徑、GitHub 上設定的不一致）');
    if (!res.ok) throw new Error('接收端回應 ' + res.status);
    const data = await res.json();
    h.days = data.days || {};
    h.updatedAt = data.updatedAt || null;
    h.fetchedAt = Date.now();
    h.error = '';
    return true;
  } catch (e) {
    h.error = e.message === 'Failed to fetch' ? '連不到接收端（網址錯誤、還沒部署，或沒有網路）' : e.message;
    return false;
  } finally {
    healthBusy = false;
    save();
    if (view !== 'settings') render();
  }
}
setInterval(() => fetchHealth(true), HEALTH_REFRESH_MS);

// 跨午夜後重新開啟 App 時，自動跳到今天
let lastToday = today();
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && cloud.dirty) cloudSync({ keepalive: true }); // 離開 App 前把還沒上傳的改動送出
  if (document.visibilityState === 'visible') cloudSync(); // 切回 App 就抓其他裝置的最新資料
  if (document.visibilityState === 'visible') fetchHealth(); // 從捷徑切回來時更新
  if (document.visibilityState === 'visible' && today() !== lastToday) {
    if (cur === lastToday) cur = today();
    lastToday = today();
    render();
  }
});

const VIEWS = ['home', 'diary', 'progress', 'settings'];
window.addEventListener('hashchange', () => {
  const v = location.hash.slice(1);
  if (VIEWS.includes(v) && v !== view) { view = v; render(); }
});
if (VIEWS.includes(location.hash.slice(1))) view = location.hash.slice(1);
render();
fetchHealth();
cloudSync();
// App 一直開著（例如電腦）也定時抓其他裝置的改動
setInterval(() => { if (document.visibilityState === 'visible') cloudSync(); }, SYNC_POLL_MS);
window.addEventListener('online', () => cloudSync());

// ================= 自動更新 =================
// 每次打開或切回 App 都檢查 sw.js 有沒有新版；有的話新版接手後自動重新載入一次。
if ('serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  const reloadForUpdate = () => {
    if (reloading) return;
    // 正在填表單（對話框開著）時先不重新載入，等下次切回 App 再更新
    if (document.querySelector('dialog[open]')) { pendingUpdate = true; return; }
    reloading = true;
    try { sessionStorage.setItem('fanfit:updated', '1'); } catch { /* 忽略 */ }
    location.reload();
  };
  let pendingUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) reloadForUpdate(); });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    reg.update().catch(() => {});
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible') return;
      if (pendingUpdate) reloadForUpdate();
      else reg.update().catch(() => {});
    });
  }).catch(() => {});
  try {
    if (sessionStorage.getItem('fanfit:updated')) {
      sessionStorage.removeItem('fanfit:updated');
      setTimeout(() => toast('已更新到最新版 ✨'), 300);
    }
  } catch { /* 忽略 */ }
}
