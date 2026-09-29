// ТОЧНЫЕ СТОЛКНОВЕНИЯ ПО КОНТУРАМ ЗДАНИЙ.
//
// Здания — это выдавленные контуры (2.5D), поэтому «настоящая» геометрия не нужна:
// достаточно ответить на два вопроса про точку на плоскости.
//   1. На какой высоте пол? — максимальная высота контуров, внутрь которых точка попадает.
//   2. Можно ли туда шагнуть? — нет, если пол там выше ног больше, чем на высоту ступеньки.
//
// Раньше это считалось по сетке 10 м, и обе беды шли оттуда: клетка «сообщала» о крыше там,
// где дома нет (проваливались сквозь), и держала крышу за краем (на краю не падали).
// Теперь проверяем сам контур, а чтобы это было быстро — раскладываем контуры по
// пространственному хешу с клеткой 48 м и смотрим только соседние клетки.
//
// Движение разрешаем по осям раздельно (классический приём): если по диагонали упёрлись,
// пробуем отдельно вдоль X и вдоль Z — получается скольжение вдоль стены, без застреваний.

const CELL = 48;
const key = (x, z) => `${x},${z}`;
export const RADIUS = 0.35;      // «толщина» персонажа, м
export const STEP_UP = 0.6;      // бортик, который перешагиваем не останавливаясь

// точка внутри контура: луч вправо, чётность пересечений
function inside(p, x, z) {
  let on = false;
  const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) on = !on;
  }
  return on;
}

// Площадь со знаком в осях города (x — восток, z — север): > 0 — обход против часовой стрелки.
export function signedArea(p) {
  let s = 0;
  for (let i = 0, n = p.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    s += p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1];
  }
  return s / 2;
}
// Контуры OSM обходятся как попало; стены и крыша строятся лицом наружу/вверх только при обходе
// против часовой — приводим все к нему (раньше у половины домов стены смотрели внутрь, крыши вниз).
export function ccw(p) {
  if (signedArea(p) >= 0) return p;
  const r = [];
  for (let i = p.length / 2 - 1; i >= 0; i--) r.push(p[i * 2], p[i * 2 + 1]);
  return r;
}
// Надстройка на крыше (машинное отделение) — квадрат у центра тяжести, если он целиком внутри
// контура; иначе её нет. Одна функция и для картинки, и для столкновений — чтобы не проходить насквозь.
export function crownBox(p, h) {
  if (h <= 24) return null;
  let s = 0, cx = 0, cy = 0;
  for (let i = 0, n = p.length / 2; i < n; i++) {
    const j = (i + 1) % n, cr = p[i * 2] * p[j * 2 + 1] - p[j * 2] * p[i * 2 + 1];
    s += cr; cx += (p[i * 2] + p[j * 2]) * cr; cy += (p[i * 2 + 1] + p[j * 2 + 1]) * cr;
  }
  if (!s) return null;
  cx /= 3 * s; cy /= 3 * s;
  const area = Math.abs(s / 2);
  const bs = Math.min(9, 3 + Math.sqrt(area) * 0.06), bh = h > 60 ? 5 + h * 0.03 : 2.6;
  const box = [cx - bs, cy - bs, cx + bs, cy - bs, cx + bs, cy + bs, cx - bs, cy + bs];
  for (let i = 0; i < 8; i += 2) if (!inside(p, box[i] * 0.999 + cx * 0.001, box[i + 1] * 0.999 + cy * 0.001)) return null;
  return { p: box, h: h + bh };
}

export function buildColliders(city) {
  city.colliders = new Map();
  const all = [];
  for (const t of city.tiles) for (const b of t.list) all.push([t, b]);
  addColliders(city, all);
}

// Дописать столкновения новых домов — для подгрузки города кусками. pairs — [[тайл, дом], ...]
export function addColliders(city, pairs) {
  const hash = city.colliders || (city.colliders = new Map());
  for (const [t, b] of pairs) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < b.p.length; i += 2) {
      x0 = Math.min(x0, b.p[i]); x1 = Math.max(x1, b.p[i]);
      z0 = Math.min(z0, b.p[i + 1]); z1 = Math.max(z1, b.p[i + 1]);
    }
    const items = [{ p: b.p, h: b.h, t, x0, x1, z0, z1 }];      // t — тайл: у него своя высота земли (t.base)
    const cr = crownBox(b.p, b.h);
    if (cr) items.push({ p: cr.p, h: cr.h, t, x0: cr.p[0], x1: cr.p[2], z0: cr.p[1], z1: cr.p[5] });
    for (const item of items)
      for (let x = Math.floor(item.x0 / CELL); x <= Math.floor(item.x1 / CELL); x++)
        for (let z = Math.floor(item.z0 / CELL); z <= Math.floor(item.z1 / CELL); z++) {
          const k = key(x, z);
          let arr = hash.get(k);
          if (!arr) hash.set(k, (arr = []));
          arr.push(item);
        }
  }
}

// Высота крыши над землёй в точке города (локальные метры города). 0 — здания нет.
// ground — высота земли в этой точке над морем: дом стоит на земле СВОЕГО квартала (t.base, её же
// использует картинка), поэтому крыша над точкой = t.base + h − ground. Без ground — просто h.
export function roofIn(city, x, z, ground) {
  const arr = city.colliders?.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (!arr) return 0;
  let h = 0;
  for (const b of arr) {
    if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
    const top = ground !== undefined && b.t?.base !== undefined ? b.t.base + b.h - ground : b.h;
    if (top > h && inside(b.p, x, z)) h = top;
  }
  return h;
}

// Учитываем толщину персонажа: смотрим не только точку, но и четыре точки по радиусу.
// Иначе стоишь ровно на кромке крыши и половина тела висит в воздухе.
export function roofAround(city, x, z, r = RADIUS, ground) {
  return Math.max(
    roofIn(city, x, z, ground),
    roofIn(city, x + r, z, ground), roofIn(city, x - r, z, ground),
    roofIn(city, x, z + r, ground), roofIn(city, x, z - r, ground),
  );
}

// Куда реально получится шагнуть. floor(e, n) — высота пола (рельеф + крыши) в точке,
// feet — высота ног в начале шага, dUp — сколько ноги пройдут по вертикали за этот шаг.
// Путь проверяем ПО ТОЧКАМ через каждые полметра: на форсаже шаг кадра — десятки метров,
// и проверка одной конечной точки пропускала дома насквозь. Если упёрлись по диагонали —
// пробуем по одной оси (скольжение вдоль стены), иначе останавливаемся у последней свободной точки.
const SWEEP = 0.5;

function sweep(floor, feet, dUp, dEast, dNorth, stepUp) {
  const n = Math.max(1, Math.ceil(Math.hypot(dEast, dNorth) / SWEEP));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    // ноги на отрезке идут вместе с вертикальной скоростью: пикируешь на крышу —
    // останавливаемся над ней и садимся, влетаешь ниже кромки — это стена
    if (floor(dEast * t, dNorth * t) > feet + dUp * t + stepUp) return (i - 1) / n;
  }
  return 1;
}

export function slideMove(floor, feet, dEast, dNorth, stepUp = STEP_UP, dUp = 0) {
  if (dEast === 0 && dNorth === 0) return [0, 0, false];
  const full = sweep(floor, feet, dUp, dEast, dNorth, stepUp);
  if (full === 1) return [dEast, dNorth, false];
  if (dEast !== 0 && sweep(floor, feet, dUp, dEast, 0, stepUp) === 1) return [dEast, 0, true];     // вдоль стены по востоку
  if (dNorth !== 0 && sweep(floor, feet, dUp, 0, dNorth, stepUp) === 1) return [0, dNorth, true];  // вдоль стены по северу
  return [dEast * full, dNorth * full, true];                                                     // до стены и стоп
}
