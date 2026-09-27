// Garmin 資料匯入：解析 .fit（活動原始檔）、.zip（Garmin Connect「匯出原始檔」）、.csv（活動清單匯出）。
// 全部在瀏覽器端處理，不上傳任何資料。

const FIT_EPOCH = 631065600; // 1989-12-31T00:00:00Z，FIT 時間戳的起點（Unix 秒）

// FIT base type（低 5 bits）→ 位元組數
const TYPE_SIZE = { 0: 1, 1: 1, 2: 1, 3: 2, 4: 2, 5: 4, 6: 4, 7: 1, 8: 4, 9: 8, 10: 1, 11: 2, 12: 4, 13: 1, 14: 8, 15: 8, 16: 8 };

function readField(dv, pos, f, little) {
  const size = TYPE_SIZE[f.type];
  if (f.type === 7) {
    const bytes = new Uint8Array(dv.buffer, dv.byteOffset + pos, f.size);
    const zero = bytes.indexOf(0);
    return new TextDecoder().decode(zero >= 0 ? bytes.subarray(0, zero) : bytes) || null;
  }
  if (!size || size !== f.size) return null; // 陣列或未知型別：略過
  let v;
  switch (f.type) {
    case 0: case 2: v = dv.getUint8(pos); return v === 0xff ? null : v;
    case 10: case 13: v = dv.getUint8(pos); return v === 0 || v === 0xff ? null : v;
    case 1: v = dv.getInt8(pos); return v === 0x7f ? null : v;
    case 3: v = dv.getInt16(pos, little); return v === 0x7fff ? null : v;
    case 4: v = dv.getUint16(pos, little); return v === 0xffff ? null : v;
    case 11: v = dv.getUint16(pos, little); return v === 0 ? null : v;
    case 5: v = dv.getInt32(pos, little); return v === 0x7fffffff ? null : v;
    case 6: v = dv.getUint32(pos, little); return v === 0xffffffff ? null : v;
    case 12: v = dv.getUint32(pos, little); return v === 0 ? null : v;
    case 8: v = dv.getFloat32(pos, little); return Number.isFinite(v) ? v : null;
    case 9: v = dv.getFloat64(pos, little); return Number.isFinite(v) ? v : null;
    default: return null; // 64-bit 整數用不到
  }
}

/** 解析 FIT 檔，回傳 file_id 類型與 session 訊息（活動摘要）。 */
export function parseFit(buf) {
  if (buf.byteLength < 12) throw new Error('檔案太小，不是 FIT 檔');
  const dv = new DataView(buf);
  const headerSize = dv.getUint8(0);
  const sig = String.fromCharCode(dv.getUint8(8), dv.getUint8(9), dv.getUint8(10), dv.getUint8(11));
  if (sig !== '.FIT') throw new Error('不是 FIT 檔');
  const end = Math.min(headerSize + dv.getUint32(4, true), buf.byteLength);
  const defs = {};
  const out = { fileType: null, sessions: [] };
  let pos = headerSize;

  while (pos < end) {
    const h = dv.getUint8(pos++);
    if (!(h & 0x80) && h & 0x40) {
      // 定義訊息
      const local = h & 0x0f;
      const little = dv.getUint8(pos + 1) === 0;
      const gnum = dv.getUint16(pos + 2, little);
      const n = dv.getUint8(pos + 4);
      pos += 5;
      const fields = [];
      for (let i = 0; i < n; i++, pos += 3) {
        fields.push({ num: dv.getUint8(pos), size: dv.getUint8(pos + 1), type: dv.getUint8(pos + 2) & 0x1f });
      }
      let devSize = 0;
      if (h & 0x20) {
        const nd = dv.getUint8(pos++);
        for (let i = 0; i < nd; i++, pos += 3) devSize += dv.getUint8(pos + 1);
      }
      defs[local] = { gnum, little, fields, devSize };
      continue;
    }
    // 資料訊息（一般或壓縮時間戳）
    const local = h & 0x80 ? (h >> 5) & 0x03 : h & 0x0f;
    const def = defs[local];
    if (!def) throw new Error('FIT 格式錯誤（缺少訊息定義）');
    const msg = {};
    for (const f of def.fields) {
      if (pos + f.size > buf.byteLength) return out;
      msg[f.num] = readField(dv, pos, f, def.little);
      pos += f.size;
    }
    pos += def.devSize;
    if (def.gnum === 0) out.fileType = msg[0];
    else if (def.gnum === 18) out.sessions.push(msg);
  }
  return out;
}

const SPORTS = {
  0: '運動', 1: '跑步', 2: '自行車', 4: '健身器材', 5: '游泳', 6: '籃球', 7: '足球', 8: '網球',
  10: '訓練', 11: '走路', 12: '越野滑雪', 13: '高山滑雪', 14: '單板滑雪', 15: '划船', 16: '登山',
  17: '健行', 19: '划槳', 21: '電動自行車', 26: '拳擊', 31: '攀岩', 37: '立槳', 41: '衝浪',
  43: '高爾夫', 48: '划船機', 53: '潛水', 62: '跳繩', 64: '羽球', 67: '桌球',
};
export const sportLabel = (s) => SPORTS[s] ?? '運動';

const pad = (n) => String(n).padStart(2, '0');
const localKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

function fitToActivities(buf) {
  const fit = parseFit(buf);
  return fit.sessions
    .filter((s) => s[2] != null)
    .map((s) => {
      const start = new Date((s[2] + FIT_EPOCH) * 1000);
      const secs = (s[7] ?? s[8] ?? 0) / 1000;
      return {
        key: 'garmin:' + localKey(start),
        start,
        name: sportLabel(s[5]),
        minutes: Math.round(secs / 60),
        kcal: s[11] ?? 0,
        distance: s[9] ? (s[9] / 100000).toFixed(2) + ' km' : '',
        avgHr: s[16] ?? null,
      };
    });
}

/** 解析 ZIP（中央目錄），回傳可延遲讀取的檔案清單。只支援 store / deflate。 */
export function unzip(buf) {
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('ZIP 格式錯誤');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const files = [];
  for (let i = 0; i < count && dv.getUint32(p, true) === 0x02014b50; i++) {
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true);
    const elen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nlen));
    p += 46 + nlen + elen + clen;
    if (name.endsWith('/')) continue;
    files.push({
      name,
      async read() {
        const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
        const data = new Uint8Array(buf, start, csize);
        if (method === 0) return data.slice().buffer;
        if (method === 8) {
          const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
          return new Response(stream).arrayBuffer();
        }
        throw new Error(`不支援的壓縮方式 (${method})`);
      },
    });
  }
  return files;
}

/** 簡易 CSV 解析（支援引號與跳脫的雙引號）。 */
export function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

function parseDuration(s) {
  const parts = String(s || '').trim().split(':').map(Number);
  if (parts.some((n) => Number.isNaN(n)) || !parts.length) return 0;
  let secs = 0;
  for (const n of parts) secs = secs * 60 + n;
  return secs;
}

function parseLocalDate(s) {
  const m = String(s || '').match(/(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
}

function csvToActivities(text) {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  if (rows.length < 2) return [];
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (...names) => head.findIndex((h) => names.some((n) => h === n.toLowerCase()));
  const iType = col('Activity Type', '活動類型', '活動類別');
  const iDate = col('Date', '日期', 'Start Time', '開始時間');
  const iTitle = col('Title', '標題', '名稱');
  const iCal = col('Calories', '卡路里', '熱量', '消耗熱量');
  const iTime = col('Time', '時間', 'Elapsed Time', '總時間', '移動時間');
  const iDist = col('Distance', '距離');
  const iHr = col('Avg HR', '平均心率');
  if (iDate < 0 || iCal < 0) {
    throw new Error('找不到「日期」或「卡路里」欄位，請確認是 Garmin Connect 活動清單匯出的 CSV');
  }
  const out = [];
  for (const r of rows.slice(1)) {
    const start = parseLocalDate(r[iDate]);
    if (!start) continue;
    const title = (iTitle >= 0 && r[iTitle]) || (iType >= 0 && r[iType]) || '運動';
    const dist = iDist >= 0 ? r[iDist].trim() : '';
    out.push({
      key: 'garmin:' + localKey(start),
      start,
      name: title.trim(),
      minutes: Math.round(parseDuration(iTime >= 0 ? r[iTime] : '') / 60),
      kcal: Number(String(r[iCal]).replace(/[^\d.]/g, '')) || 0,
      distance: dist && dist !== '--' && Number(dist) !== 0 ? (/^[\d.]+$/.test(dist) ? dist + ' km' : dist) : '',
      avgHr: iHr >= 0 ? Number(r[iHr]) || null : null,
    });
  }
  return out;
}

/**
 * 匯入使用者選的檔案（可多選，可混合 .fit / .zip / .csv），回傳活動陣列與錯誤訊息。
 */
export async function importGarminFiles(fileList) {
  const activities = [];
  const errors = [];

  async function handle(name, getBuf, depth = 0) {
    const lower = name.toLowerCase();
    try {
      if (lower.endsWith('.fit')) {
        activities.push(...fitToActivities(await getBuf()));
      } else if (lower.endsWith('.csv')) {
        activities.push(...csvToActivities(new TextDecoder().decode(await getBuf())));
      } else if (lower.endsWith('.zip') && depth < 3) {
        for (const f of unzip(await getBuf())) {
          const n = f.name.toLowerCase();
          if (n.endsWith('.fit') || n.endsWith('.csv') || n.endsWith('.zip')) await handle(f.name, f.read, depth + 1);
        }
      }
    } catch (e) {
      errors.push(`${name.split('/').pop()}：${e.message}`);
    }
  }

  for (const file of fileList) await handle(file.name, () => file.arrayBuffer());
  return { activities, errors };
}
