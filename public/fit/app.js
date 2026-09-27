import { FOODS } from './foods.js';

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
const MEALS = [['breakfast', '早餐'], ['lunch', '午餐'], ['dinner', '晚餐'], ['snack', '點心']];
const mealName = (m) => (MEALS.find((x) => x[0] === m) || MEALS[3])[1];
const ACTIVITY = [[1.2, '久坐（幾乎不運動）'], [1.375, '輕度（每週 1–3 天）'], [1.55, '中度（每週 3–5 天）'], [1.725, '高度（每週 6–7 天）']];
const WEEKLY = [[-1, '每週減 1 kg'], [-0.75, '每週減 0.75 kg'], [-0.5, '每週減 0.5 kg'], [-0.25, '每週減 0.25 kg'], [0, '維持體重'], [0.25, '每週增 0.25 kg'], [0.5, '每週增 0.5 kg']];

const defaults = () => ({
  profile: {
    sex: 'male', age: 30, height: 170, weight: 70, activity: 1.375, weeklyGoal: -0.5,
    calorieOverride: 0, macros: { c: 45, p: 25, f: 30 },
  },
  entries: [], // { id, date, meal, food, amount, qty }
  weights: {}, // { 'YYYY-MM-DD': kg }
  customFoods: [],
  recents: [],
});

function load() {
  const d = defaults();
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw) return { ...d, ...raw, profile: { ...d.profile, ...raw.profile, macros: { ...d.profile.macros, ...raw.profile?.macros } } };
  } catch { /* 讀不到就用預設值 */ }
  return d;
}
let S = load();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) { toast('儲存失敗：' + e.message); }
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
function tdee() { return bmr(S.profile, latestWeight()) * S.profile.activity; }
function calorieGoal() {
  const p = S.profile;
  if (p.calorieOverride > 0) return p.calorieOverride;
  const floor = p.sex === 'male' ? 1500 : 1200;
  return Math.max(floor, Math.round((tdee() + (p.weeklyGoal * 7700) / 7) / 10) * 10);
}
function macroGoals(kcal) {
  const m = S.profile.macros;
  return { c: (kcal * m.c) / 400, p: (kcal * m.p) / 400, f: (kcal * m.f) / 900 };
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

function macroMeter(label, val, goal, color) {
  const pct = goal ? Math.min(100, (val / goal) * 100) : 0;
  return `<div class="macro"><small>${label}</small><b class="num">${r0(val)}</b><small class="num" style="display:inline"> / ${r0(goal)} g</small>
    <div class="meter"><i style="width:${pct}%;background:${color}"></i></div></div>`;
}

function renderHome() {
  const goal = calorieGoal();
  const t = foodTotals(cur);
  const eaten = r0(t.kcal);
  const remain = goal - eaten;
  const mg = macroGoals(goal);
  const C = 2 * Math.PI * 54;
  const pct = goal > 0 ? Math.min(1, eaten / goal) : 0;

  $('#view-home').innerHTML = `
    <div class="card">
      <div class="summary">
        <div class="ring ${remain < 0 ? 'over' : ''}">
          <svg viewBox="0 0 120 120" aria-hidden="true">
            <circle class="track" cx="60" cy="60" r="54" fill="none" stroke-width="10"/>
            <circle class="bar" cx="60" cy="60" r="54" fill="none" stroke-width="10" stroke-linecap="round"
              stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/>
          </svg>
          <div class="ring-label"><span>已攝取</span><b class="num">${eaten}</b><span class="num">/ ${goal} kcal</span></div>
        </div>
        <div class="equation num">
          <div><span>每日目標</span><span>${goal}</span></div>
          <div><span>已攝取</span><span>${eaten}</span></div>
          <div class="total"><span>${remain < 0 ? '超過' : '還可以吃'}</span><span style="color:${remain < 0 ? 'var(--accent-text)' : 'var(--good)'}">${Math.abs(remain)}</span></div>
          <div><span class="muted">達成</span><span class="muted">${goal ? r0((eaten / goal) * 100) : 0}%</span></div>
        </div>
      </div>
      <div class="macros">
        ${macroMeter('碳水', t.c, mg.c, 'var(--carb)')}
        ${macroMeter('蛋白質', t.p, mg.p, 'var(--protein)')}
        ${macroMeter('脂肪', t.f, mg.f, 'var(--fat)')}
      </div>
    </div>

    <div class="quick">
      <button class="btn primary" data-action="add-food">🍙 記錄飲食</button>
      <button class="btn" data-action="goto" data-view="progress">⚖️ 記錄體重</button>
    </div>

    <div class="card">
      <div class="card-head"><h3>今日餐點</h3><button class="link-btn" data-action="goto" data-view="diary">看日記 ›</button></div>
      <div class="list">
        ${MEALS.map(([k, n]) => {
          const mt = foodTotals(cur, k);
          const cnt = S.entries.filter((e) => e.date === cur && e.meal === k).length;
          return `<button class="row" data-action="add-food" data-meal="${k}">
            <div class="grow"><div class="name">${n}</div><div class="sub">${cnt ? `${cnt} 項` : '尚未記錄 — 點此新增'}</div></div>
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
  const max = Math.max(goal * 1.25, ...vals) || 1;
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
  const goal = calorieGoal();
  const t = foodTotals(cur);
  const yesterday = addDays(cur, -1);
  $('#view-diary').innerHTML = `
    <div class="card">
      <div class="grid3 num" style="text-align:center">
        <div><small class="muted">目標</small><div><b>${goal}</b></div></div>
        <div><small class="muted">已攝取</small><div><b>${r0(t.kcal)}</b></div></div>
        <div><small class="muted">${goal - t.kcal < 0 ? '超過' : '剩餘'}</small><div><b style="color:${goal - t.kcal < 0 ? 'var(--accent-text)' : 'var(--good)'}">${Math.abs(r0(goal - t.kcal))}</b></div></div>
      </div>
    </div>
    ${MEALS.map(([k, n]) => {
      const items = S.entries.filter((e) => e.date === cur && e.meal === k);
      const hasYesterday = S.entries.some((e) => e.date === yesterday && e.meal === k);
      return `<div class="card">
        <div class="card-head"><h3>${n}</h3><span class="kcal num">${r0(foodTotals(cur, k).kcal)} kcal</span></div>
        <div class="list">${items.length ? items.map((e) => {
          const nn = nut(e);
          return `<button class="row" data-action="edit-entry" data-id="${e.id}">
            <div class="grow"><div class="name">${esc(e.food.name)}</div>
            <div class="sub">${esc(amountLabel(e))} · 碳 ${r0(nn.c)} / 蛋 ${r0(nn.p)} / 脂 ${r0(nn.f)}</div></div>
            <div class="kcal num">${r0(nn.kcal)}</div></button>`;
        }).join('') : '<div class="empty">還沒有記錄</div>'}</div>
        <div class="btn-row start">
          <button class="link-btn" data-action="add-food" data-meal="${k}">＋ 新增食物</button>
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
      <div class="card-head"><h3>記錄體重</h3></div>
      <form id="weight-form" class="grid2" style="align-items:end">
        <label>日期<input type="date" name="date" value="${cur}" max="${today()}" required /></label>
        <label>體重 kg<input type="number" name="kg" inputmode="decimal" step="0.1" min="20" max="400" value="${S.weights[cur] ?? ''}" placeholder="${r1(w)}" required /></label>
        <div></div><div class="btn-row" style="margin-top:8px"><button class="btn primary">儲存</button></div>
      </form>
    </div>
    <div class="card chart">
      <div class="card-head"><h3>體重變化</h3><span class="muted">近 90 天</span></div>
      ${weightChart(ws.filter(([d]) => d >= addDays(today(), -90)))}
      <div class="stats num">
        <div><b>${r1(w)}</b><small>目前 kg</small></div>
        <div><b>${first != null ? (w - first > 0 ? '+' : '') + r1(w - first) : '—'}</b><small>累計變化 kg</small></div>
        <div><b>${r1(bmi)}</b><small>BMI</small></div>
      </div>
    </div>
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

function weightChart(points) {
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
    ${points.map(([d, v]) => `<circle class="dot" cx="${x(d)}" cy="${y(v)}" r="2.5"><title>${short(d)}：${v} kg</title></circle>`).join('')}
    <text x="${L}" y="${H - 4}">${short(points[0][0])}</text>
    <text x="${W - R}" y="${H - 4}" text-anchor="end">${short(points.at(-1)[0])}</text>
  </svg>`;
}

function renderSettings() {
  const p = S.profile;
  const opt = (list, v) => list.map(([val, label]) => `<option value="${val}" ${+val === +v ? 'selected' : ''}>${label}</option>`).join('');
  const auto = (() => { const o = p.calorieOverride; p.calorieOverride = 0; const g = calorieGoal(); p.calorieOverride = o; return g; })();
  $('#view-settings').innerHTML = `
    <form id="profile-form" class="card">
      <div class="card-head"><h3>個人資料與目標</h3></div>
      <div class="grid2">
        <label>性別<select name="sex"><option value="male" ${p.sex === 'male' ? 'selected' : ''}>男</option><option value="female" ${p.sex === 'female' ? 'selected' : ''}>女</option></select></label>
        <label>年齡<input name="age" type="number" inputmode="numeric" min="10" max="100" value="${p.age}" /></label>
        <label>身高 cm<input name="height" type="number" inputmode="decimal" min="100" max="250" step="0.1" value="${p.height}" /></label>
        <label>體重 kg<input name="weight" type="number" inputmode="decimal" min="20" max="400" step="0.1" value="${r1(latestWeight(today()))}" /></label>
      </div>
      <label>日常活動量<select name="activity">${opt(ACTIVITY, p.activity)}</select></label>
      <label>目標<select name="weeklyGoal">${opt(WEEKLY, p.weeklyGoal)}</select></label>
      <p class="note num">基礎代謝 BMR ≈ <b>${r0(bmr(p, latestWeight(today())))}</b> kcal · 每日總消耗 TDEE ≈ <b>${r0(tdee())}</b> kcal<br/>建議每日攝取：<b>${auto}</b> kcal</p>
      <label>自訂每日熱量目標（0 = 使用建議值）<input name="calorieOverride" type="number" inputmode="numeric" min="0" step="10" value="${p.calorieOverride || 0}" /></label>
      <p class="muted" style="margin-top:12px"><b>三大營養素比例（%）</b></p>
      <div class="grid3">
        <label>碳水<input name="mc" type="number" inputmode="numeric" min="0" max="100" value="${p.macros.c}" /></label>
        <label>蛋白質<input name="mp" type="number" inputmode="numeric" min="0" max="100" value="${p.macros.p}" /></label>
        <label>脂肪<input name="mf" type="number" inputmode="numeric" min="0" max="100" value="${p.macros.f}" /></label>
      </div>
      <div class="btn-row"><button class="btn primary">儲存設定</button></div>
    </form>

    <div class="card">
      <div class="card-head"><h3>自訂食物</h3><span class="muted">${S.customFoods.length} 項</span></div>
      <div class="list">${S.customFoods.length ? S.customFoods.map((f) => `<div class="row"><div class="grow"><div class="name">${esc(f.name)}</div>
        <div class="sub">${esc(f.serving)} · ${r0(f.kcal)} kcal</div></div><button class="icon-btn" data-action="del-custom" data-id="${f.id}" aria-label="刪除">✕</button></div>`).join('')
        : '<div class="empty">在「新增食物」裡可以建立自己的食物。</div>'}</div>
    </div>

    <div class="card">
      <div class="card-head"><h3>資料備份</h3></div>
      <p class="muted">所有資料只存在這台裝置的瀏覽器裡。換手機或清除瀏覽器資料前，記得先匯出備份。</p>
      <div class="btn-row start">
        <button class="btn" data-action="export">⬇ 匯出備份</button>
        <label class="btn" style="margin:0;color:inherit;font-size:inherit">⬆ 匯入備份<input type="file" id="import-file" accept=".json,application/json" class="visually-hidden" /></label>
        <button class="btn ghost danger" data-action="reset">清除全部資料</button>
      </div>
    </div>
    <p class="muted" style="text-align:center">飯糰 Fit · 食物營養資料：內建常見台灣食物估算值 ＋ <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a></p>`;

  $('#profile-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const mc = num(fd.get('mc')), mp = num(fd.get('mp')), mf = num(fd.get('mf'));
    if (Math.round(mc + mp + mf) !== 100) { toast(`營養素比例加總要是 100%（目前 ${mc + mp + mf}%）`); return; }
    const newW = num(fd.get('weight'));
    Object.assign(S.profile, {
      sex: fd.get('sex'), age: num(fd.get('age')), height: num(fd.get('height')),
      activity: num(fd.get('activity')), weeklyGoal: num(fd.get('weeklyGoal')),
      calorieOverride: num(fd.get('calorieOverride')), macros: { c: mc, p: mp, f: mf },
    });
    if (newW && r1(newW) !== r1(latestWeight(today()))) {
      if (Object.keys(S.weights).length) S.weights[today()] = r1(newW);
      else S.profile.weight = r1(newW);
    }
    save();
    renderSettings();
    toast('已儲存');
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
    lists.local = [...S.recents];
    box.innerHTML = lists.local.length
      ? `<div class="list-section">最近吃過</div>${lists.local.map((f, i) => foodRow(f, i, 'local')).join('')}`
      : '<p class="empty">輸入食物名稱搜尋，或用掃條碼、快速加熱量。</p>';
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
    : '') + '<div id="online-results"></div>';
}

async function searchOnline(q) {
  const seq = ++searchSeq;
  const box = $('#online-results');
  if (!box) return;
  box.innerHTML = '<div class="list-section">Open Food Facts 線上資料庫</div><p class="empty">搜尋中…</p>';
  try {
    const url = `https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=25&fields=code,product_name,product_name_zh,brands,nutriments,serving_quantity`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    if (seq !== searchSeq) return;
    lists.online = (data.products || []).map(offToFood).filter(Boolean);
    box.innerHTML = '<div class="list-section">Open Food Facts 線上資料庫</div>' +
      (lists.online.length ? lists.online.map((f, i) => foodRow(f, i, 'online')).join('') : '<p class="empty">線上沒有找到，試試別的關鍵字，或建立自訂食物。</p>');
  } catch (e) {
    if (seq === searchSeq) box.innerHTML = `<p class="empty">線上搜尋失敗（${esc(e.message)}），請檢查網路。</p>`;
  }
}

function offToFood(p) {
  const n = p.nutriments || {};
  let kcal = n['energy-kcal_100g'];
  if (kcal == null && n['energy_100g'] != null) kcal = n['energy_100g'] / 4.184;
  const name = (p.product_name_zh || p.product_name || '').trim();
  if (kcal == null || !name) return null;
  return {
    id: 'off:' + p.code, name, brand: (p.brands || '').split(',')[0].trim(), grams: 100,
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
    S.entries.push({ id: uid(), date: cur, meal, food: qtyCtx.food, amount, qty });
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
function openCustom(mode) {
  const form = $('#custom-form');
  form.reset();
  form.mode.value = mode;
  $('#custom-title').textContent = mode === 'quick' ? '快速加熱量' : '自訂食物';
  $('#custom-serving-wrap').hidden = mode === 'quick';
  form.name.value = mode === 'quick' ? '快速加入' : '';
  $('#dlg-custom').showModal();
  (mode === 'quick' ? form.kcal : form.name).focus();
}

$('#custom-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const mode = fd.get('mode');
  const food = {
    id: 'custom:' + uid(), name: fd.get('name').trim() || '快速加入', serving: (fd.get('serving') || '').trim() || '1 份',
    kcal: num(fd.get('kcal')), p: num(fd.get('p')), c: num(fd.get('c')), f: num(fd.get('f')),
  };
  $('#dlg-custom').close();
  if (mode === 'quick') {
    S.entries.push({ id: uid(), date: cur, meal: foodMeal, food, amount: 1, qty: 1 });
    save();
    $('#dlg-food').close();
    toast(`已加入 ${r0(food.kcal)} kcal`);
    render();
  } else {
    S.customFoods.unshift(food);
    save();
    openQty(food);
  }
});

// ================= barcode =================
let scanStream = null;
async function openScan() {
  $('#barcode-input').value = '';
  const video = $('#scan-video');
  const hint = $('#scan-hint');
  $('#dlg-scan').showModal();
  if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) {
    video.hidden = true;
    hint.textContent = '這個瀏覽器不支援相機掃條碼（iPhone Safari 目前不支援），請手動輸入包裝上的條碼數字。';
    return;
  }
  try {
    hint.textContent = '把條碼對準鏡頭…';
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    video.srcObject = scanStream;
    video.hidden = false;
    await video.play();
    const detector = new window.BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
    while (scanStream) {
      const codes = await detector.detect(video).catch(() => []);
      if (codes.length) { const c = codes[0].rawValue; stopScan(); lookupBarcode(c); return; }
      await new Promise((r) => setTimeout(r, 250));
    }
  } catch (e) {
    video.hidden = true;
    hint.textContent = '無法開啟相機（' + e.message + '），請手動輸入條碼。';
  }
}
function stopScan() {
  scanStream?.getTracks().forEach((t) => t.stop());
  scanStream = null;
  $('#scan-video').hidden = true;
}
$('#dlg-scan').addEventListener('close', stopScan);

async function lookupBarcode(code) {
  code = String(code).replace(/\D/g, '');
  if (!code) return;
  $('#scan-hint').textContent = `查詢 ${code}…`;
  try {
    const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=code,product_name,product_name_zh,brands,nutriments,serving_quantity`);
    const data = await res.json();
    const food = data.status === 1 ? offToFood(data.product) : null;
    if (!food) {
      $('#scan-hint').textContent = `資料庫裡找不到 ${code} 的營養資料，可以用「自訂食物」自己建立。`;
      return;
    }
    $('#dlg-scan').close();
    openQty(food);
  } catch (e) {
    $('#scan-hint').textContent = '查詢失敗：' + e.message;
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
    case 'new-custom': openCustom('custom'); break;
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
      const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' });
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
  if (kg < 20) { toast('請輸入正確的體重'); return; }
  S.weights[fd.get('date')] = r1(kg);
  save();
  render();
  toast('體重已記錄');
});

// 跨午夜後重新開啟 App 時，自動跳到今天
let lastToday = today();
document.addEventListener('visibilitychange', () => {
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

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
