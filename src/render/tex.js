// Процедурные текстуры: рисуем на canvas один раз при старте, файлы не таскаем.
// Фасад с окнами — главный выигрыш: без него город выглядит как серые коробки.
import * as THREE from 'three';

const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const rnd = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

const wrap = (c, rep = 1) => {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(rep, rep);
  return t;
};

// шум-зерно поверх холста — убирает «пластик»
function grain(g, w, h, amt, seed = 1) {
  const r = rnd(seed), img = g.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amt;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
}

// Фасад: 4 этажа и 4 окна на тайл. UV стены считаем в метрах / 13 — этаж выходит ~3.2 м.
// Текстура светлая (белая база), цвет здания идёт из vertexColors — так один атлас на весь город.
export function facadeTex(size = 256, variant = 0) {
  const c = cv(size, size), g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, size, size);
  const r = rnd(42 + variant * 991);
  // 0 — панелька (частая сетка), 1 — сталинка (редкие высокие окна), 2 — стекло (сплошная лента)
  const cols = [5, 3, 6][variant] || 5, rows = [4, 3, 4][variant] || 4;
  const cw = size / cols, ch = size / rows;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    g.fillStyle = 'rgba(0,0,0,.14)';                        // межэтажный пояс
    g.fillRect(x * cw, y * ch + ch * 0.86, cw, ch * 0.14);
    const pad = cw * (variant === 2 ? 0.06 : variant === 1 ? 0.3 : 0.24);
    const wy = y * ch + ch * (variant === 1 ? 0.14 : 0.2), wh = ch * (variant === 1 ? 0.62 : variant === 2 ? 0.55 : 0.48);
    const lit = r();
    const v = lit > 0.84 ? 240 : lit > 0.58 ? 150 : 92;     // часть окон горит, остальные — тёмное стекло
    g.fillStyle = `rgb(${v},${(v * 0.99) | 0},${Math.min(255, (v * 1.1) | 0)})`;
    g.fillRect(x * cw + pad, wy, cw - pad * 2, wh);
    const grd = g.createLinearGradient(x * cw + pad, wy, x * cw + cw - pad, wy + wh);
    grd.addColorStop(0, 'rgba(255,255,255,.35)'); grd.addColorStop(0.55, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(x * cw + pad, wy, cw - pad * 2, wh);
    g.strokeStyle = 'rgba(30,34,42,.5)'; g.lineWidth = Math.max(1, size / 180);
    g.strokeRect(x * cw + pad, wy, cw - pad * 2, wh);
  }
  grain(g, size, size, 20, 7);
  return wrap(c);
}

// Крыша: рубероид, швы, вентиляция
export function roofTex(size = 128) {
  const c = cv(size, size), g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, size, size);
  const r = rnd(9);
  for (let i = 0; i < 240; i++) {
    g.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.08})`;
    g.fillRect(r() * size, r() * size, 2 + r() * 14, 2 + r() * 10);
  }
  g.strokeStyle = 'rgba(0,0,0,.16)'; g.lineWidth = 2;
  for (let i = 0; i < 4; i++) { const y = (i + 0.5) * size / 4; g.beginPath(); g.moveTo(0, y); g.lineTo(size, y); g.stroke(); }
  for (let i = 0; i < 6; i++) { g.fillStyle = 'rgba(205,212,220,.6)'; const s = 6 + r() * 12; g.fillRect(r() * size, r() * size, s, s); }
  grain(g, size, size, 16, 3);
  return wrap(c);
}

// Земля: трава с проплешинами и нитками дорог — под городом почти не видна, но горизонт оживает
export function groundTex(size = 512) {
  const c = cv(size, size), g = c.getContext('2d');
  g.fillStyle = '#3c4a30'; g.fillRect(0, 0, size, size);
  const r = rnd(21);
  for (let i = 0; i < 1400; i++) {
    g.fillStyle = r() > 0.6 ? `rgba(92,106,66,${0.2 + r() * 0.4})` : `rgba(44,54,36,${0.2 + r() * 0.5})`;
    g.beginPath(); g.ellipse(r() * size, r() * size, 3 + r() * 26, 3 + r() * 18, r() * 3, 0, 6.3); g.fill();
  }
  // дороги не рисуем: на большом диске они тайлятся заметной сеткой — лучше просто поле
  grain(g, size, size, 24, 5);
  return wrap(c, 150);
}

// Вода: рябь штрихами, чтобы реки не были плоской заливкой
export function waterTex(size = 256) {
  const c = cv(size, size), g = c.getContext('2d');
  g.fillStyle = '#1d3446'; g.fillRect(0, 0, size, size);
  const r = rnd(77);
  for (let i = 0; i < 600; i++) {
    g.strokeStyle = `rgba(150,200,235,${0.04 + r() * 0.13})`;
    g.lineWidth = 1 + r() * 2;
    const x = r() * size, y = r() * size, w = 6 + r() * 40;
    g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + w / 2, y + (r() - 0.5) * 8, x + w, y); g.stroke();
  }
  return wrap(c, 30);
}
