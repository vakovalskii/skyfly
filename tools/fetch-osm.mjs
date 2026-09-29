// Качает здания из OpenStreetMap (Overpass) для центров Москвы и Петербурга.
// node tools/fetch-osm.mjs [moscow|spb|all]
// Кладёт public/data/<город>.json: контуры в метрах от центра города + высоты.
// Данные © участники OpenStreetMap, лицензия ODbL.
import fs from 'node:fs';
import path from 'node:path';

export const CITIES = {
  moscow: { name: 'Москва', lat: 55.7520, lon: 37.6175, half: 0.055 },      // ~±6 км по широте
  spb: { name: 'Санкт-Петербург', lat: 59.9386, lon: 30.3141, half: 0.055 },
};

const R = 6_371_000;
const rad = (d) => (d * Math.PI) / 180;
// локальные метры относительно центра города (равнопромежуточная проекция — на 12 км ошибки нет)
export const toLocal = (lat, lon, c) => [rad(lon - c.lon) * R * Math.cos(rad(c.lat)), rad(lat - c.lat) * R];

const ETAGE = 3.2; // метров на этаж
// tagged — высота взята из тегов (а не угадана по типу здания)
function tagged(t = {}) {
  const h = parseFloat(t.height ?? t['building:height']);
  if (Number.isFinite(h) && h > 1) return true;
  const lv = parseFloat(t['building:levels'] ?? t.levels);
  return Number.isFinite(lv) && lv > 0;
}
function heightOf(t = {}) {
  const h = parseFloat(t.height ?? t['building:height']);
  if (Number.isFinite(h) && h > 1) return Math.min(400, h);
  const lv = parseFloat(t['building:levels'] ?? t.levels);
  const rl = parseFloat(t['roof:levels']);
  if (Number.isFinite(lv) && lv > 0) return Math.min(400, (lv + (Number.isFinite(rl) && rl > 0 ? rl : 0)) * ETAGE + 1.5);
  const k = t.building;
  if (k === 'church' || k === 'cathedral' || k === 'temple') return 28;
  if (k === 'industrial' || k === 'warehouse' || k === 'retail') return 9;
  if (k === 'garage' || k === 'garages' || k === 'shed' || k === 'hut' || k === 'kiosk') return 3.5;
  if (k === 'apartments' || k === 'residential') return 18;
  return 12;
}

// Зеркала с данными всей планеты: главный сервер часто отвечает 504 на крупных выборках.
// overpass.osm.ch и overpass.osm.jp — региональные (Швейцария, Япония): на Москву они честно
// отвечали «пусто», и из 64 клеток 61 приходила без зданий — поэтому убраны.
const MIRRORS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];
let mirror = 0;
// Пустой ответ принимаем, только если второе зеркало тоже скажет «пусто»
async function overpass(query) {
  let empties = 0, m = mirror++;
  // сервера общие (их же сейчас долбят и другие выборки): на 429/504 не сдаёмся, а ждём всё дольше
  for (let attempt = 0; attempt < MIRRORS.length * 10; attempt++) {
    const url = MIRRORS[m % MIRRORS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'skyfly-city-builder/1.0 (hobby project)' },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(180_000),
      });
      if (res.ok) {
        const j = await res.json();
        // Overpass умеет ответить 200 с пустым списком и пометкой об ошибке — это не «пусто», это отказ
        if (j.remark) { console.log(`  ${new URL(url).hostname} → ${j.remark.slice(0, 60)}`); }
        else if (!j.elements?.length && ++empties < 2) console.log(`  ${new URL(url).hostname} → пусто, спрошу другое зеркало`);
        else return j;
      }
      else console.log(`  ${new URL(url).hostname} → ${res.status}`);
    } catch (e) { console.log(`  ${new URL(url).hostname} → ${e.message}`); }
    m++;
    // после круга по всем зеркалам — пауза длиннее: 4 с, потом 15, 30, … до минуты
    await new Promise((r) => setTimeout(r, attempt < MIRRORS.length ? 4000 : Math.min(60_000, 15_000 * Math.floor(attempt / MIRRORS.length))));
  }
  throw new Error('все зеркала Overpass недоступны');
}
// крупный bbox рвём на клетки: так проходит даже на загруженном сервере
// conc — сколько клеток качать одновременно (зеркала разные, каждое получает не больше одного запроса);
// skip(a, b, a2, b2) — клетку не качать (например, её уже покрывает другой кэш)
async function tiled(query, lat0, lon0, lat1, lon1, step = 0.014, tag = 'x', { conc = 1, skip } = {}) {
  const dir = path.join(process.cwd(), '.cache', tag);
  fs.mkdirSync(dir, { recursive: true });
  const out = [], jobs = [];
  const rows = Math.ceil((lat1 - lat0) / step), cols = Math.ceil((lon1 - lon0) / (step * 1.8));
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const a = lat0 + i * step, b = lon0 + j * step * 1.8, a2 = Math.min(lat1, a + step), b2 = Math.min(lon1, b + step * 1.8);
    if (skip?.(a, b, a2, b2)) continue;
    jobs.push(`${a.toFixed(4)},${b.toFixed(4)},${a2.toFixed(4)},${b2.toFixed(4)}`);
  }
  let n = 0, next = 0, empty = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const box = jobs[next++];
      const file = path.join(dir, `${box}.json`);
      let j2;
      if (fs.existsSync(file)) j2 = JSON.parse(fs.readFileSync(file, 'utf8'));
      else {
        j2 = await overpass(query.replace(/@BBOX@/g, box));
        // пустой ответ не кэшируем: это обычно зеркало-пустышка, а не реально пустая клетка
        if (j2.elements?.length) fs.writeFileSync(file, JSON.stringify({ elements: j2.elements }));
        await new Promise((r) => setTimeout(r, 1500));       // не долбим сервер
      }
      if (!j2.elements?.length) empty++;
      for (const el of j2.elements) out.push(el);
      process.stdout.write(`\r  клеток: ${++n}/${jobs.length}, объектов: ${out.length}   `);
    }
  };
  await Promise.all(Array.from({ length: conc }, worker));
  console.log(empty ? `\n  пустых клеток: ${empty}` : '');
  return { elements: out };
}

// упрощение контура: выкидываем точки, отстоящие от хорды меньше чем на eps
function simplify(pts, eps = 1.2) {
  if (pts.length < 5) return pts;
  const keep = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = keep[keep.length - 1], b = pts[i], c = pts[i + 1];
    const ux = c[0] - a[0], uy = c[1] - a[1], L = Math.hypot(ux, uy) || 1;
    const d = Math.abs((b[0] - a[0]) * uy - (b[1] - a[1]) * ux) / L;
    if (d > eps) keep.push(b);
  }
  keep.push(pts[pts.length - 1]);
  return keep;
}

const area = (p) => { let s = 0; for (let i = 0, n = p.length; i < n; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % n]; s += x1 * y2 - x2 * y1; } return Math.abs(s) / 2; };

// точка внутри контура (плоский массив [x0, z0, x1, z1, …]): луч вправо, чётность пересечений
function insideFlat(p, x, z) {
  let on = false;
  const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) on = !on;
  }
  return on;
}
const centroid = (pts) => { let x = 0, y = 0; for (const [a, b] of pts) { x += a; y += b; } return [x / pts.length, y / pts.length]; };

// Внешние кольца мультиполигона: замкнутые пути — как есть, разорванные — стыкуем по концам
function rings(members) {
  const segs = members.filter((m) => m.type === 'way' && (m.role === 'outer' || m.role === '') && m.geometry?.length > 1)
    .map((m) => m.geometry.map((g) => [g.lat, g.lon]));
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  const out = [];
  while (segs.length) {
    let ring = segs.shift();
    let grew = true;
    while (!same(ring[0], ring[ring.length - 1]) && grew) {
      grew = false;
      for (let i = 0; i < segs.length; i++) {
        const s2 = segs[i], end = ring[ring.length - 1];
        if (same(end, s2[0])) ring = ring.concat(s2.slice(1));
        else if (same(end, s2[s2.length - 1])) ring = ring.concat(s2.slice(0, -1).reverse());
        else if (same(ring[0], s2[s2.length - 1])) ring = s2.slice(0, -1).concat(ring);
        else if (same(ring[0], s2[0])) ring = s2.slice(1).reverse().concat(ring);
        else continue;
        segs.splice(i, 1); grew = true; break;
      }
    }
    if (same(ring[0], ring[ring.length - 1]) && ring.length >= 4) out.push(ring);
  }
  return out;
}

// здания, их части (высотки, храмы, «Сити» размечены частями с высотами) и составные здания-мультиполигоны
const BUILDINGS_Q = '[out:json][timeout:170];(way["building"](@BBOX@);way["building:part"](@BBOX@);relation["building"]["type"="multipolygon"](@BBOX@);relation["building:part"]["type"="multipolygon"](@BBOX@););out geom;';

// элементы Overpass → [{p, h, t, …}] в метрах города c
export function parseBuildings(elements, c) {
  // клетки выборки перекрываются по краям: один и тот же дом приходит дважды — дубли давали мерцание граней
  const uniq = new Map();
  for (const el of elements) uniq.set(`${el.type}${el.id}`, el);
  console.log(`  элементов: ${elements.length}, без дублей: ${uniq.size}`);

  const shapes = [];            // { pts, tags, part }
  for (const el of uniq.values()) {
    const part = !!el.tags?.['building:part'] && !el.tags?.building;
    if (el.type === 'way' && el.geometry?.length >= 4) shapes.push({ ll: el.geometry.map((g) => [g.lat, g.lon]), tags: el.tags, part });
    else if (el.type === 'relation' && el.members) for (const r of rings(el.members)) shapes.push({ ll: r, tags: el.tags, part });
  }
  const polys = [];
  for (const sh of shapes) {
    let pts = sh.ll.map(([la, lo]) => toLocal(la, lo, c).map((v) => +v.toFixed(1)));
    if (pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
    pts = simplify(pts);
    if (pts.length < 3) continue;
    const s = area(pts);
    if (s < (sh.part ? 15 : 40)) continue;     // сараи и будки не строим; мелкие части (шпили, барабаны) — оставляем
    polys.push({ pts, flat: pts.flat(), tags: sh.tags || {}, part: sh.part });
  }
  // Контур здания, внутри которого лежат его части, не выводим: по правилам OSM части покрывают
  // его целиком и несут настоящие высоты — иначе на месте высотки стоит ещё и коробка контура.
  const G = 60, grid = new Map();
  for (const q of polys) if (q.part) {
    const [x, z] = centroid(q.pts);
    const k = `${Math.floor(x / G)},${Math.floor(z / G)}`;
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push([x, z]);
  }
  const out = [];
  let replaced = 0, parts = 0, taggedN = 0;
  for (const q of polys) {
    if (!q.part) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const [x, z] of q.pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      let has = false;
      for (let gx = Math.floor(x0 / G); gx <= Math.floor(x1 / G) && !has; gx++)
        for (let gz = Math.floor(z0 / G); gz <= Math.floor(z1 / G) && !has; gz++)
          for (const [x, z] of grid.get(`${gx},${gz}`) || []) if (insideFlat(q.flat, x, z)) { has = true; break; }
      if (has) { replaced++; continue; }
    } else parts++;
    if (tagged(q.tags)) taggedN++;
    const t = q.tags;
    const b = { p: q.flat, h: +heightOf(t).toFixed(1), t: t.building || t['building:part'] || 'yes' };
    if (q.part) b.part = 1;
    // оформление — только если тег есть: цвет стен и крыши, форма крыши, материал, этажность,
    // высота низа (части «на ножках», шпили), магазин/кафе на первом этаже
    if (t['building:colour']) b.c = t['building:colour'];
    if (t['roof:colour']) b.rc = t['roof:colour'];
    if (t['roof:shape']) b.rs = t['roof:shape'];
    if (t['building:material']) b.m = t['building:material'];
    const lv = parseFloat(t['building:levels']); if (Number.isFinite(lv)) b.lv = lv;
    const mh = parseFloat(t.min_height); if (Number.isFinite(mh)) b.mh = mh;
    if (t.shop || t.amenity) b.sh = 1;
    out.push(b);
  }
  // один дом бывает и путём, и отношением (или контур совпадает с единственной частью) —
  // одинаковые контуры схлопываем, оставляя более высокий: иначе грани мерцают
  const same = new Map();
  for (const b of out) { const k = b.p.join(','); const o = same.get(k); if (!o || b.h > o.h) same.set(k, b); }
  const dupN = out.length - same.size;
  out.length = 0; for (const b of same.values()) out.push(b);   // без spread: на сотнях тысяч домов он переполняет стек
  console.log(`  одинаковых контуров убрано: ${dupN}`);
  console.log(`  зданий: ${out.length} (частей: ${parts}, контуров заменено частями: ${replaced}, с высотой из тегов: ${taggedN})`);

  return out;
}

export async function fetchCity(id) {
  const c = CITIES[id];
  const lat0 = c.lat - c.half, lat1 = c.lat + c.half, lon0 = c.lon - c.half * 1.8, lon1 = c.lon + c.half * 1.8;
  console.log(`${c.name}: качаю здания (${(c.half * 222).toFixed(0)}×${(c.half * 222).toFixed(0)} км)…`);
  // здания, их части (высотки, храмы, «Сити» размечены частями с высотами) и составные здания-мультиполигоны
  const json = await tiled(BUILDINGS_Q, lat0, lon0, lat1, lon1, 0.014, `${id}-b2`);
  const out = parseBuildings(json.elements, c);

  // вода (реки и заливы) — по ней делаем Москву-реку и Неву
  const water = [];
  try {
    const wj = await tiled('[out:json][timeout:120];(way["natural"="water"](@BBOX@);way["waterway"="riverbank"](@BBOX@););out geom;', lat0, lon0, lat1, lon1, 0.044);
    for (const el of wj.elements) {
      const g = el.geometry || el.members?.flatMap((m) => m.geometry || []);
      if (!g || g.length < 4) continue;
      let pts = g.map((p) => toLocal(p.lat, p.lon, c).map((v) => +v.toFixed(1)));
      pts = simplify(pts, 4);
      if (pts.length < 3 || area(pts) < 2000) continue;
      water.push(pts.flat());
    }
    console.log(`  водоёмов: ${water.length}`);
  } catch (e) { console.log('  вода не скачалась:', e.message); }

  const file = path.join('public/data', `${id}.json`);
  // Вода: Москва-река и пруды в OSM всё чаще — мультиполигоны, а мы берём только пути; если новая
  // выборка беднее прежней, оставляем прежнюю воду (иначе река пропадает кусками)
  if (fs.existsSync(file)) {
    const old = JSON.parse(fs.readFileSync(file, 'utf8')).water || [];
    if (old.length > water.length) { console.log(`  вода: оставляю прежнюю (${old.length} > ${water.length})`); water.length = 0; water.push(...old); }
  }
  const data = { id, name: c.name, lat: c.lat, lon: c.lon, buildings: out, water };
  fs.mkdirSync('public/data', { recursive: true });
  // пишем во временный файл и подменяем, только если не стало хуже (зеркало могло отдать пустые клетки)
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data));
  const was = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')).buildings.length : 0;
  if (out.length < was * 0.95) { console.log(`  зданий меньше, чем было (${out.length} < ${was}) — оставляю старый файл, новый в ${tmp}`); return data; }
  fs.renameSync(tmp, file);
  console.log(`  → ${file} (${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} МБ)`);
  return data;
}

// Город до кольцевой (МКАД, КАД) кусками 2×2 км: игра подгружает их по мере полёта. Та же система
// координат и тот же центр, что у <город>.json; кусок — по центроиду здания. Центр тоже пишем,
// но помечаем core: игра его пропускает. <город>.json этот режим не трогает.
export const RINGS = {
  moscow: { dLat: 0.18, dLon: 0.32, chunk: 2000, core: 6100 },    // ~±20 км, до МКАД и чуть за ней
  spb: { dLat: 0.145, dLon: 0.29, chunk: 2000, core: 6100 },      // ~±16 км, до КАД
};
export async function fetchRing(id) {
  const RING = RINGS[id], m = CITIES[id];
  const c = m;
  const lat0 = c.lat - RING.dLat, lat1 = c.lat + RING.dLat, lon0 = c.lon - RING.dLon, lon1 = c.lon + RING.dLon;
  const t0 = Date.now();
  console.log(`${m.name} до кольцевой: качаю здания (${(RING.dLat * 222).toFixed(0)}×${(RING.dLon * 2 * 111 * Math.cos(rad(c.lat))).toFixed(0)} км)…`);
  // центр уже лежит в кэше <город>-b2 (после `fetch-osm <город>`) — его клетки не перекачиваем,
  // а берём оттуда; кэша нет — качаем всё, иначе в середине дыра
  const coreDir = path.join(process.cwd(), '.cache', `${id}-b2`);
  const haveCore = fs.existsSync(coreDir) && fs.readdirSync(coreDir).length > 0;
  const cLat0 = m.lat - m.half, cLat1 = m.lat + m.half, cLon0 = m.lon - m.half * 1.8, cLon1 = m.lon + m.half * 1.8;
  const inCore = (a, b, a2, b2) => haveCore && a >= cLat0 && a2 <= cLat1 && b >= cLon0 && b2 <= cLon1;
  const json = await tiled(BUILDINGS_Q, lat0, lon0, lat1, lon1, 0.02, `${id}-ring`, { conc: 3, skip: inCore });
  let coreN = 0;
  if (haveCore) for (const f of fs.readdirSync(coreDir)) {
    for (const el of JSON.parse(fs.readFileSync(path.join(coreDir, f), 'utf8')).elements) { json.elements.push(el); coreN++; }
  }
  console.log(`  из кэша центра: ${coreN} объектов`);
  const out = parseBuildings(json.elements, c);

  const dir = path.join('public/data', `${id}-chunks`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const chunks = new Map();
  for (const b of out) {
    let x = 0, y = 0;
    const n = b.p.length / 2;
    for (let i = 0; i < n; i++) { x += b.p[i * 2]; y += b.p[i * 2 + 1]; }
    x /= n; y /= n;
    const key = `${Math.floor(x / RING.chunk)}_${Math.floor(y / RING.chunk)}`;
    let ch = chunks.get(key);
    if (!ch) chunks.set(key, (ch = { key, list: [], maxH: 0, core: true }));
    ch.list.push(b);
    if (b.h > ch.maxH) ch.maxH = b.h;
    if (Math.abs(x) >= RING.core || Math.abs(y) >= RING.core) ch.core = false;   // хоть один дом снаружи центра
  }
  const index = { lat: c.lat, lon: c.lon, chunk: RING.chunk, chunks: [] };
  for (const ch of [...chunks.values()].sort((a, b) => a.key.localeCompare(b.key))) {
    const txt = JSON.stringify({ buildings: ch.list });
    fs.writeFileSync(path.join(dir, `${ch.key}.json`), txt);
    const e = { key: ch.key, n: ch.list.length, maxH: ch.maxH, bytes: Buffer.byteLength(txt) };
    if (ch.core) e.core = true;
    index.chunks.push(e);
  }
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index));
  const mb = index.chunks.reduce((s, e) => s + e.bytes, 0) / 1048576;
  console.log(`  → ${dir}: ${out.length} зданий, ${index.chunks.length} кусков (${index.chunks.filter((e) => e.core).length} центральных), ${mb.toFixed(1)} МБ, ${((Date.now() - t0) / 60000).toFixed(1)} мин`);
  return index;
}

if (process.argv[1].endsWith('fetch-osm.mjs')) {
  const which = process.argv[2] || 'all';
  if (which.endsWith('-ring')) await fetchRing(which.slice(0, -5));
  else for (const id of which === 'all' ? Object.keys(CITIES) : [which]) await fetchCity(id);
}
