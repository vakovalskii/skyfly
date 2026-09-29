// ФАСАДЫ МОСКВЫ: процедурный атлас 4×4 вместо трёх фасадов на весь город.
//
// Ячейка = 12 м по ширине × 12 м по высоте (как FLOOR в city.js), бесшовна по обеим осям: целое число
// простенков по ширине и целое число этажей по высоте. Стена светлая и нейтральная — цвет дома даёт
// vertexColor (умножение), окна тёмные. Второй атлас той же раскладки — свечение: горящие окна.
//
// variants[i] = { key, cell: [col, row], kind, floorH, minLevels, maxLevels }; ячейка row 0 — верх
// холста. pickFacade(tags, h, rnd) выбирает вариант по тегам OSM, osmColor разбирает building:colour.
import * as THREE from 'three';

export const CELL_M = 12;                 // метров на ячейку по обеим осям

export const VARIANTS = [
  { key: 'panel', kind: 'residential', floorH: 3, minLevels: 9, maxLevels: 25 },         // панелька 9–17 эт., швы
  { key: 'panel-loggia', kind: 'residential', floorH: 3, minLevels: 9, maxLevels: 25 },  // панель с лоджиями
  { key: 'khrushchev', kind: 'residential', floorH: 3, minLevels: 4, maxLevels: 5 },     // кирпичная хрущёвка
  { key: 'stalinka', kind: 'residential', floorH: 4, minLevels: 5, maxLevels: 14 },      // пилястры, карниз
  { key: 'dohodny', kind: 'historic', floorH: 4, minLevels: 3, maxLevels: 7 },           // доходный дом, лепнина
  { key: 'constructivism', kind: 'office', floorH: 3, minLevels: 3, maxLevels: 8 },      // ленточные окна
  { key: 'glass', kind: 'tower', floorH: 3, minLevels: 10, maxLevels: 99 },              // стеклянная башня
  { key: 'bc-lamella', kind: 'office', floorH: 3, minLevels: 5, maxLevels: 40 },         // БЦ с вертикальными ламелями
  { key: 'industrial', kind: 'industrial', floorH: 6, minLevels: 1, maxLevels: 4 },      // гофра, редкие окна
  { key: 'mall', kind: 'retail', floorH: 6, minLevels: 1, maxLevels: 5 },                // глухая стена, реклама
  { key: 'novostroyka', kind: 'residential', floorH: 3, minLevels: 10, maxLevels: 45 },  // цветные вставки
  { key: 'mansion', kind: 'historic', floorH: 4, minLevels: 1, maxLevels: 4 },           // особняк/церковь, арки
  { key: 'shopfront', kind: 'ground', floorH: 4, minLevels: 1, maxLevels: 1 },           // первый этаж, витрины
  { key: 'brick-90s', kind: 'residential', floorH: 3, minLevels: 9, maxLevels: 25 },     // кирпичная башня 90-х
  { key: 'nii', kind: 'office', floorH: 3.5, minLevels: 3, maxLevels: 16 },              // советский НИИ, пояса
  { key: 'panel-color', kind: 'residential', floorH: 3, minLevels: 12, maxLevels: 25 },  // П-3М с цветными полосами
].map((v, i) => ({ ...v, cell: [i % 4, (i / 4) | 0] }));

const IDX = Object.fromEntries(VARIANTS.map((v, i) => [v.key, i]));

// ---------- выбор варианта (без DOM) ----------
// tags: { t — building, c — colour, m — building:material, lv — этажи, sh — есть магазины }
export function pickFacade(tags = {}, h = 12, rnd = Math.random) {
  const t = String(tags.t || 'yes').toLowerCase();
  const m = String(tags.m || '').toLowerCase();
  const lv = Number(tags.lv) > 0 ? Number(tags.lv) : Math.max(1, Math.round(h / 3));
  const pick = (...keys) => IDX[keys[Math.min(keys.length - 1, Math.floor(rnd() * keys.length))]];
  if (/church|cathedral|chapel|temple|monastery/.test(t)) return IDX.mansion;
  if (/industrial|warehouse|factory|hangar|garage|service|manufacture/.test(t)) return IDX.industrial;
  if (m === 'glass' || h > 80) return lv > 25 || m === 'glass' ? pick('glass', 'glass', 'bc-lamella') : pick('bc-lamella', 'glass', 'novostroyka');
  if (/retail|commercial|supermarket|kiosk/.test(t)) return lv <= 3 ? IDX.mall : pick('bc-lamella', 'constructivism', 'nii');
  if (/office/.test(t)) return lv >= 12 ? pick('glass', 'bc-lamella') : pick('nii', 'constructivism', 'bc-lamella');
  if (/university|school|college|hospital|kindergarten|public|civic|government/.test(t)) return pick('nii', 'constructivism', 'stalinka');
  if (m === 'brick') return lv <= 5 ? pick('khrushchev', 'dohodny') : lv <= 12 ? pick('stalinka', 'brick-90s') : IDX['brick-90s'];
  if (m === 'panel' || m === 'concrete') return lv >= 12 ? pick('panel', 'panel-loggia', 'panel-color') : pick('panel', 'khrushchev');
  if (/apartments|residential|house|dormitory|yes/.test(t)) {
    if (lv >= 20) return pick('novostroyka', 'panel-color', 'glass', 'brick-90s');
    if (lv >= 9) return pick('panel', 'panel-loggia', 'panel-color', 'novostroyka', 'brick-90s', 'stalinka');
    if (lv >= 6) return pick('stalinka', 'dohodny', 'panel', 'brick-90s');
    if (lv >= 4) return pick('khrushchev', 'khrushchev', 'dohodny', 'stalinka');
    return pick('mansion', 'dohodny', 'khrushchev');
  }
  return lv <= 4 ? pick('mansion', 'dohodny', 'khrushchev') : pick('panel', 'stalinka', 'nii');
}

// ---------- цвет из тегов OSM (без DOM) ----------
const NAMES = {
  white: '#f2f0ea', 'белый': '#f2f0ea', ivory: '#f1ead2', cream: '#efe3c2', 'кремовый': '#efe3c2',
  beige: '#dccaa6', 'бежевый': '#dccaa6', tan: '#c9ad85', sand: '#d8c292', 'песочный': '#d8c292',
  yellow: '#e8cf6a', 'жёлтый': '#e8cf6a', 'желтый': '#e8cf6a', ochre: '#c89a45', orange: '#d98b45', 'оранжевый': '#d98b45',
  red: '#a8483a', 'красный': '#a8483a', brick: '#9c5a44', 'кирпичный': '#9c5a44', maroon: '#6f2f2a', darkred: '#7a2e27',
  brown: '#7b5a45', 'коричневый': '#7b5a45', pink: '#e1a7a0', 'розовый': '#e1a7a0', salmon: '#e39a84',
  grey: '#9a9a96', gray: '#9a9a96', 'серый': '#9a9a96', lightgrey: '#c6c6c2', lightgray: '#c6c6c2', darkgrey: '#5d5f60', darkgray: '#5d5f60', silver: '#bfc3c6',
  black: '#2e2f31', 'чёрный': '#2e2f31', 'черный': '#2e2f31',
  green: '#6f9467', 'зелёный': '#6f9467', 'зеленый': '#6f9467', lightgreen: '#a7c79b', darkgreen: '#40593b', olive: '#8b8a55',
  blue: '#6d8fb3', 'синий': '#5a78a8', 'голубой': '#9ec3dc', lightblue: '#9ec3dc', navy: '#3a4a6b', teal: '#4f8a8b', cyan: '#8fcbd3',
  purple: '#8a6f9c', violet: '#8a6f9c', 'фиолетовый': '#8a6f9c', gold: '#c9a54b', 'золотой': '#c9a54b',
};
export function osmColor(str) {
  if (!str) return null;
  let s = String(str).trim().toLowerCase().split(/[;,]/)[0].trim();
  if (/^#?[0-9a-f]{6}$/.test(s) || /^#?[0-9a-f]{3}$/.test(s)) {
    if (s[0] !== '#') s = '#' + s;
    if (s.length === 4) s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
    return new THREE.Color(s);
  }
  s = s.replace(/[\s_-]+/g, '');
  if (NAMES[s]) return new THREE.Color(NAMES[s]);
  // «light blue», «dark red» и т. п.: светлее/темнее базового
  const m = s.match(/^(light|dark|pale)(.+)$/);
  if (m && NAMES[m[2]]) { const c = new THREE.Color(NAMES[m[2]]); return m[1] === 'dark' ? c.multiplyScalar(0.65) : c.lerp(new THREE.Color(1, 1, 1), 0.35); }
  return null;
}

// ---------- рисование ----------
const rng = (seed) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const gray = (v, a = 1) => `rgba(${v | 0},${v | 0},${v | 0},${a})`;

// окно: стекло с лёгкой вариацией, рама, отражение неба; горящее — в карту свечения
function win(g, e, x, y, w, h, r, { lit = 0.18, tint = [0, 0, 0], frame = 0.08, sky = 0.25 } = {}) {
  const f = Math.max(1, Math.min(w, h) * frame);
  g.fillStyle = gray(70); g.fillRect(x, y, w, h);                                  // проём/рама
  const v = 38 + r() * 30;
  g.fillStyle = `rgb(${(v + tint[0]) | 0},${(v + 4 + tint[1]) | 0},${(v + 12 + tint[2]) | 0})`;
  g.fillRect(x + f, y + f, w - 2 * f, h - 2 * f);
  if (sky > 0) {                                                                   // отражение неба — верх светлее
    const gr = g.createLinearGradient(0, y, 0, y + h);
    gr.addColorStop(0, `rgba(170,190,215,${sky})`); gr.addColorStop(0.6, 'rgba(170,190,215,0)');
    g.fillStyle = gr; g.fillRect(x + f, y + f, w - 2 * f, h - 2 * f);
  }
  if (r() < lit) {
    const warm = r() < 0.8;
    e.fillStyle = warm ? `rgb(255,${200 + r() * 40 | 0},${120 + r() * 50 | 0})` : `rgb(${180 + r() * 40 | 0},220,255)`;
    e.fillRect(x + f, y + f, w - 2 * f, h - 2 * f);
    g.fillStyle = 'rgba(255,225,160,0.55)'; g.fillRect(x + f, y + f, w - 2 * f, h - 2 * f);
  }
}
const band = (g, x, y, w, h, v, a = 1) => { g.fillStyle = gray(v, a); g.fillRect(x, y, w, h); };
function noise(g, x, y, w, h, r, n, a) {                                          // лёгкая грязь/фактура
  for (let i = 0; i < n; i++) { g.fillStyle = gray(r() < 0.5 ? 0 : 255, a * r()); g.fillRect(x + r() * w, y + r() * h, 1 + r() * 3, 1 + r() * 3); }
}
function bricks(g, x, y, w, h, px, r) {                                           // кирпичная кладка, шаг — целый в ячейке
  const bh = Math.max(2, Math.round(px * 0.075)), rows = Math.round(h / bh), bw = w / Math.round(w / (px * 0.25));
  for (let j = 0; j < rows; j++) {
    const yy = y + j * (h / rows);
    band(g, x, yy, w, 1, 150, 0.5);
    const off = j % 2 ? bw / 2 : 0;
    for (let xx = x - off; xx < x + w; xx += bw) {
      g.fillStyle = gray(200 + r() * 40, 0.35); g.fillRect(Math.max(x, xx + 1), yy + 1, bw - 2, h / rows - 1);
      g.fillStyle = gray(120, 0.35); g.fillRect(Math.max(x, xx), yy, 1, h / rows);
    }
  }
}

// каждая функция рисует ячейку S×S (S — пикселей на 12 м); px — пикселей на метр
const DRAW = {
  panel(g, e, S, px, r) {
    const bays = 4, bw = S / bays, fh = 3 * px;
    for (let f = 0; f < 4; f++) for (let b = 0; b < bays; b++) {
      const x = b * bw, y = f * fh;
      band(g, x, y, 1.5, fh, 150); band(g, x, y + fh - 1.5, bw, 1.5, 150);     // швы панелей
      win(g, e, x + bw * 0.28, y + fh * 0.28, bw * 0.44, fh * 0.46, r);
    }
    noise(g, 0, 0, S, S, r, 400, 0.08);
  },
  'panel-loggia'(g, e, S, px, r) {
    const bays = 4, bw = S / bays, fh = 3 * px;
    for (let f = 0; f < 4; f++) for (let b = 0; b < bays; b++) {
      const x = b * bw, y = f * fh;
      band(g, x, y + fh - 1.5, bw, 1.5, 150);
      if (b % 2 === 0) {                                                        // лоджия: плита и ограждение
        win(g, e, x + bw * 0.12, y + fh * 0.18, bw * 0.76, fh * 0.52, r, { sky: 0.15 });
        band(g, x + bw * 0.06, y + fh * 0.62, bw * 0.88, fh * 0.3, 205);
        band(g, x + bw * 0.06, y + fh * 0.62, bw * 0.88, 2, 120);
      } else win(g, e, x + bw * 0.3, y + fh * 0.28, bw * 0.4, fh * 0.44, r);
    }
    noise(g, 0, 0, S, S, r, 400, 0.08);
  },
  khrushchev(g, e, S, px, r) {
    bricks(g, 0, 0, S, S, px, r);
    const bays = 4, bw = S / bays, fh = 3 * px;
    for (let f = 0; f < 4; f++) for (let b = 0; b < bays; b++) {
      const x = b * bw, y = f * fh;
      band(g, x + bw * 0.25, y + fh * 0.72, bw * 0.5, fh * 0.04, 190);           // подоконный отлив
      win(g, e, x + bw * 0.27, y + fh * 0.25, bw * 0.46, fh * 0.47, r);
    }
  },
  stalinka(g, e, S, px, r) {
    const bays = 3, bw = S / bays, fh = 4 * px;
    for (let f = 0; f < 3; f++) {
      const y = f * fh;
      band(g, 0, y, S, fh * 0.06, 170);                                           // межэтажный карниз
      band(g, 0, y + fh * 0.06, S, 2, 120, 0.6);
      for (let b = 0; b < bays; b++) {
        const x = b * bw;
        band(g, x, y, bw * 0.1, fh, 215); band(g, x + bw * 0.1, y, 2, fh, 150, 0.6);   // пилястра
        win(g, e, x + bw * 0.34, y + fh * 0.22, bw * 0.34, fh * 0.56, r);
        band(g, x + bw * 0.3, y + fh * 0.14, bw * 0.42, fh * 0.06, 195);           // сандрик над окном
      }
    }
    noise(g, 0, 0, S, S, r, 300, 0.06);
  },
  dohodny(g, e, S, px, r) {
    const bays = 3, bw = S / bays, fh = 4 * px;
    for (let f = 0; f < 3; f++) {
      const y = f * fh;
      band(g, 0, y + fh * 0.02, S, fh * 0.08, 200);                               // лепная полоса
      for (let k = 0; k < S; k += px * 0.5) { g.fillStyle = gray(150, 0.5); g.beginPath(); g.arc(k + px * 0.25, y + fh * 0.06, px * 0.12, 0, 7); g.fill(); }
      for (let b = 0; b < bays; b++) {
        const x = b * bw;
        win(g, e, x + bw * 0.33, y + fh * 0.2, bw * 0.34, fh * 0.62, r, { lit: 0.25 });
        band(g, x + bw * 0.29, y + fh * 0.84, bw * 0.42, fh * 0.04, 190);
        band(g, x + bw * 0.31, y + fh * 0.16, bw * 0.38, fh * 0.03, 175);
      }
    }
    noise(g, 0, 0, S, S, r, 500, 0.08);
  },
  constructivism(g, e, S, px, r) {
    const fh = 3 * px;
    for (let f = 0; f < 4; f++) {
      const y = f * fh;
      band(g, 0, y + fh * 0.78, S, fh * 0.22, 225);                               // бетонный пояс
      for (let k = 0; k < 8; k++) win(g, e, k * S / 8, y + fh * 0.22, S / 8, fh * 0.5, r, { frame: 0.04 });   // лента окон
    }
  },
  glass(g, e, S, px, r) {
    const cols = 8, cw = S / cols, fh = 3 * px;
    const gr = g.createLinearGradient(0, 0, S, S);
    gr.addColorStop(0, 'rgb(96,132,140)'); gr.addColorStop(0.5, 'rgb(130,165,175)'); gr.addColorStop(1, 'rgb(90,125,140)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
    for (let f = 0; f < 4; f++) for (let k = 0; k < cols; k++) {
      const x = k * cw, y = f * fh, v = r();
      g.fillStyle = `rgba(${170 + v * 40 | 0},${200 + v * 30 | 0},${215 + v * 25 | 0},${0.12 + v * 0.18})`; g.fillRect(x, y, cw, fh);
      if (r() < 0.14) { e.fillStyle = 'rgb(200,230,255)'; e.fillRect(x + 1, y + 1, cw - 2, fh - 2); }
      band(g, x, y, 1.5, fh, 210, 0.7);                                             // стойки и ригели
    }
    for (let f = 0; f < 4; f++) band(g, 0, f * fh, S, 3, 215, 0.8);
  },
  'bc-lamella'(g, e, S, px, r) {
    const fh = 3 * px;
    for (let f = 0; f < 4; f++) { const y = f * fh; for (let k = 0; k < 6; k++) win(g, e, k * S / 6, y + fh * 0.1, S / 6, fh * 0.8, r, { frame: 0.03, tint: [-5, 5, 10], sky: 0.35 }); }
    for (let k = 0; k < 12; k++) { band(g, k * S / 12, 0, S / 36, S, 225); band(g, k * S / 12 + S / 36, 0, 1, S, 140, 0.6); }   // ламели
  },
  industrial(g, e, S, px, r) {
    for (let x = 0; x < S; x += px * 0.2) { band(g, x, 0, px * 0.1, S, 215); band(g, x + px * 0.1, 0, px * 0.1, S, 185); }   // гофра
    const fh = 6 * px;
    for (let f = 0; f < 2; f++) for (let b = 0; b < 2; b++) win(g, e, b * S / 2 + S * 0.1, f * fh + fh * 0.15, S * 0.3, fh * 0.18, r, { lit: 0.1, frame: 0.05 });
    noise(g, 0, 0, S, S, r, 900, 0.12);
  },
  mall(g, e, S, px, r) {
    band(g, 0, 0, S, S, 225);
    const hue = [[210, 40, 60], [30, 120, 210], [240, 170, 30], [40, 160, 90]][Math.floor(r() * 4)];
    for (let f = 0; f < 2; f++) {                                                  // рекламная полоса на каждый 6-м «этаж»
      const y = f * 6 * px + px * 1.2;
      g.fillStyle = `rgb(${hue[0]},${hue[1]},${hue[2]})`; g.fillRect(0, y, S, px * 1.1);
      e.fillStyle = `rgb(${hue[0]},${hue[1]},${hue[2]})`; e.fillRect(0, y, S, px * 1.1);
      band(g, 0, y + px * 1.1, S, px * 0.15, 150);
      for (let k = 0; k < 4; k++) band(g, k * S / 4, y + px * 3, 2, px * 2.6, 170, 0.5);   // стыки кассет
    }
    noise(g, 0, 0, S, S, r, 300, 0.06);
  },
  novostroyka(g, e, S, px, r) {
    const bays = 4, bw = S / bays, fh = 3 * px;
    const pal = [[0.9, 0.55, 0.35], [0.45, 0.6, 0.85], [0.95, 0.85, 0.4], [0.6, 0.8, 0.55]];
    for (let f = 0; f < 4; f++) for (let b = 0; b < bays; b++) {
      const x = b * bw, y = f * fh;
      if ((b + f) % 3 === 0) { const c = pal[(b * 3 + f) % 4]; g.fillStyle = `rgb(${c[0] * 255 | 0},${c[1] * 255 | 0},${c[2] * 255 | 0})`; g.fillRect(x + 1, y + 1, bw - 2, fh - 2); }
      win(g, e, x + bw * 0.2, y + fh * 0.12, bw * 0.6, fh * 0.7, r, { frame: 0.05, sky: 0.3 });
      band(g, x, y + fh - 2, bw, 2, 170);
    }
  },
  mansion(g, e, S, px, r) {
    band(g, 0, 0, S, S, 240);
    const bays = 3, bw = S / bays, fh = 4 * px;
    for (let f = 0; f < 3; f++) for (let b = 0; b < bays; b++) {
      const x = b * bw, y = f * fh, ww = bw * 0.36, wx = x + (bw - ww) / 2, wy = y + fh * 0.3, wh = fh * 0.52;
      win(g, e, wx, wy, ww, wh, r, { lit: 0.12 });
      g.fillStyle = gray(70); g.beginPath(); g.arc(wx + ww / 2, wy, ww / 2, Math.PI, 0); g.fill();         // арка
      g.fillStyle = gray(52); g.beginPath(); g.arc(wx + ww / 2, wy, ww / 2 - 2, Math.PI, 0); g.fill();
      g.strokeStyle = gray(200); g.lineWidth = 2; g.beginPath(); g.arc(wx + ww / 2, wy, ww / 2 + 3, Math.PI, 0); g.stroke();
      band(g, x, y + fh - fh * 0.05, bw, fh * 0.05, 215);
    }
    noise(g, 0, 0, S, S, r, 250, 0.05);
  },
  shopfront(g, e, S, px, r) {
    band(g, 0, 0, S, S, 205);
    const fh = 4 * px;
    for (let f = 0; f < 3; f++) for (let k = 0; k < 3; k++) {
      const x = k * S / 3, y = f * fh;
      band(g, x + S * 0.02, y + fh * 0.08, S / 3 - S * 0.04, fh * 0.16, 60);       // вывеска
      if (r() < 0.7) { e.fillStyle = `rgb(${200 + r() * 55 | 0},${150 + r() * 100 | 0},${80 + r() * 150 | 0})`; e.fillRect(x + S * 0.04, y + fh * 0.11, S / 3 - S * 0.08, fh * 0.1); }
      win(g, e, x + S * 0.02, y + fh * 0.3, S / 3 - S * 0.04, fh * 0.66, r, { lit: 0.6, frame: 0.03, sky: 0.4 });   // витрина
    }
  },
  'brick-90s'(g, e, S, px, r) {
    bricks(g, 0, 0, S, S, px, r);
    const bays = 4, bw = S / bays, fh = 3 * px;
    for (let f = 0; f < 4; f++) for (let b = 0; b < bays; b++) {
      const x = b * bw, y = f * fh;
      if (b === 1 || b === 2) band(g, x, y + fh * 0.66, bw, fh * 0.34, 215, 0.9);  // остеклённые балконы
      win(g, e, x + bw * 0.22, y + fh * 0.2, bw * 0.56, fh * 0.44, r);
    }
  },
  nii(g, e, S, px, r) {
    const fh = 3.5 * px, n = Math.round(S / fh), fhh = S / n;                    // этаж 3.5 м, но целым числом в ячейке
    for (let f = 0; f < n; f++) {
      const y = f * fhh;
      band(g, 0, y + fhh * 0.72, S, fhh * 0.28, 230);
      for (let k = 0; k < 6; k++) win(g, e, k * S / 6 + S * 0.01, y + fhh * 0.2, S / 6 - S * 0.02, fhh * 0.5, r, { frame: 0.06 });
    }
    noise(g, 0, 0, S, S, r, 500, 0.08);
  },
  'panel-color'(g, e, S, px, r) {
    DRAW.panel(g, e, S, px, r);
    const c = [[0.85, 0.5, 0.4], [0.5, 0.65, 0.85], [0.9, 0.8, 0.45]][Math.floor(r() * 3)];
    const fh = 3 * px;
    for (let f = 0; f < 4; f++) { g.fillStyle = `rgba(${c[0] * 255 | 0},${c[1] * 255 | 0},${c[2] * 255 | 0},0.85)`; g.fillRect(0, f * fh + fh * 0.82, S, fh * 0.12); }
  },
};

let ATLAS = null;
// Атлас S×S (по умолчанию 2048 → 512 пикселей на ячейку, ~43 пикс/м). Один раз на игру.
export function facadeAtlas(size = 2048) {
  if (ATLAS) return ATLAS;
  const S = size / 4, px = S / CELL_M;
  const mk = () => { const c = document.createElement('canvas'); c.width = c.height = size; return c; };
  const cw = mk(), ce = mk();
  const g = cw.getContext('2d'), e = ce.getContext('2d');
  e.fillStyle = '#000'; e.fillRect(0, 0, size, size);
  VARIANTS.forEach((v, i) => {
    const [cx, cy] = v.cell, r = rng(1000 + i * 7919);
    for (const ctx of [g, e]) { ctx.save(); ctx.translate(cx * S, cy * S); ctx.beginPath(); ctx.rect(0, 0, S, S); ctx.clip(); }
    g.fillStyle = gray(232); g.fillRect(0, 0, S, S);                              // светлая нейтральная стена
    DRAW[v.key](g, e, S, px, r);
    g.restore(); e.restore();
  });
  const tex = (c) => {
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true;
    return t;
  };
  ATLAS = { texture: tex(cw), emissive: tex(ce), variants: VARIANTS, canvas: cw, emissiveCanvas: ce };
  return ATLAS;
}
export const facadeAtlasEmissive = (size) => facadeAtlas(size).emissive;
