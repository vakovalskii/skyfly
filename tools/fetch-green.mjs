// Качает зелень из OpenStreetMap (Overpass): парки, скверы, леса, газоны, отдельные деревья и ряды.
// node tools/fetch-green.mjs [moscow|spb|all]
// Кладёт public/data/<город>-green.json в тех же локальных метрах от центра города, что и дома
// (toLocal из fetch-osm.mjs):
//   { areas: [{ k: 'wood'|'park'|'grass'|'scrub', p: [x,z,...] }], trees: [x,z,...], rows: [[x,z,...], ...],
//     paths: [[ширина, x,z,...], ...] — дорожки и дороги у зелени, holes: [[x,z,...], ...] — площадки, вода, фонтаны }
// Данные © участники OpenStreetMap, лицензия ODbL.
import fs from 'node:fs';
import path from 'node:path';
import { CITIES, toLocal } from './fetch-osm.mjs';

const MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.osm.jp/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
];
let mirror = 0;
async function overpass(query) {
  for (let attempt = 0; attempt < MIRRORS.length * 3; attempt++) {
    const url = MIRRORS[mirror % MIRRORS.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'skyfly-city-builder/1.0 (hobby project)' },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(180_000),
      });
      if (res.ok) {
        const j = await res.json();
        if (j.remark) console.log(`  ${new URL(url).hostname} → ${j.remark.slice(0, 60)}`);
        else return j;
      } else console.log(`  ${new URL(url).hostname} → ${res.status}`);
    } catch (e) { console.log(`  ${new URL(url).hostname} → ${e.message}`); }
    mirror++;
    await new Promise((r) => setTimeout(r, 4000));
  }
  throw new Error('все зеркала Overpass недоступны');
}

// крупный bbox рвём на клетки, каждую кэшируем (пустые не кэшируем — это обычно зеркало-пустышка)
async function tiled(query, lat0, lon0, lat1, lon1, step, tag) {
  const dir = path.join(process.cwd(), '.cache', tag);
  fs.mkdirSync(dir, { recursive: true });
  const out = [];
  const rows = Math.ceil((lat1 - lat0) / step), cols = Math.ceil((lon1 - lon0) / (step * 1.8));
  let n = 0;
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
    const a = lat0 + i * step, b = lon0 + j * step * 1.8;
    const box = `${a.toFixed(4)},${b.toFixed(4)},${Math.min(lat1, a + step).toFixed(4)},${Math.min(lon1, b + step * 1.8).toFixed(4)}`;
    const file = path.join(dir, `${box}.json`);
    let j2;
    if (fs.existsSync(file)) j2 = JSON.parse(fs.readFileSync(file, 'utf8'));
    else {
      // пустой ответ — обычно отказ зеркала, а не пустая клетка: пробуем другие зеркала
      for (let k = 0; k < 4; k++) {
        j2 = await overpass(query.replace(/@BBOX@/g, box));
        if (j2.elements?.length) break;
        mirror++;
        await new Promise((r) => setTimeout(r, 5000));
      }
      if (j2.elements?.length) fs.writeFileSync(file, JSON.stringify({ elements: j2.elements }));
      await new Promise((r) => setTimeout(r, 1500));
    }
    out.push(...j2.elements);
    process.stdout.write(`\r  клеток: ${++n}/${rows * cols}, объектов: ${out.length}   `);
  }
  console.log('');
  return out;
}

function simplify(pts, eps) {
  if (pts.length < 5) return pts;
  const keep = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = keep[keep.length - 1], b = pts[i], c = pts[i + 1];
    const ux = c[0] - a[0], uy = c[1] - a[1], L = Math.hypot(ux, uy) || 1;
    if (Math.abs((b[0] - a[0]) * uy - (b[1] - a[1]) * ux) / L > eps) keep.push(b);
  }
  keep.push(pts[pts.length - 1]);
  return keep;
}
const area = (p) => { let s = 0; for (let i = 0, n = p.length; i < n; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % n]; s += x1 * y2 - x2 * y1; } return Math.abs(s) / 2; };

// склейка внешних колец мультиполигона из кусков-путей
function rings(members) {
  const parts = members.filter((m) => m.role !== 'inner' && m.geometry?.length > 1).map((m) => m.geometry.map((g) => [g.lat, g.lon]));
  const out = [];
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  while (parts.length) {
    let ring = parts.shift();
    let grown = true;
    while (!same(ring[0], ring[ring.length - 1]) && grown) {
      grown = false;
      for (let i = 0; i < parts.length; i++) {
        const q = parts[i], end = ring[ring.length - 1];
        if (same(q[0], end)) ring = ring.concat(q.slice(1));
        else if (same(q[q.length - 1], end)) ring = ring.concat(q.slice(0, -1).reverse());
        else continue;
        parts.splice(i, 1); grown = true; break;
      }
    }
    if (ring.length >= 4) out.push(ring);
  }
  return out;
}

const KIND = (t = {}) => {
  if (t.landuse === 'forest' || t.natural === 'wood') return 'wood';
  if (t.natural === 'scrub') return 'scrub';
  if (t.leisure === 'park' || t.leisure === 'garden') return 'park';
  return 'grass';                                // grass, meadow, recreation_ground, village_green
};

export async function fetchGreen(id) {
  const c = CITIES[id];
  const lat0 = c.lat - c.half, lat1 = c.lat + c.half, lon0 = c.lon - c.half * 1.8, lon1 = c.lon + c.half * 1.8;
  console.log(`${c.name}: качаю зелень…`);
  const q = '[out:json][timeout:120];('
    + 'way["leisure"~"^(park|garden)$"](@BBOX@);relation["leisure"~"^(park|garden)$"](@BBOX@);'
    + 'way["landuse"~"^(forest|grass|recreation_ground|meadow|village_green)$"](@BBOX@);relation["landuse"~"^(forest|grass|recreation_ground|meadow)$"](@BBOX@);'
    + 'way["natural"~"^(wood|scrub|tree_row)$"](@BBOX@);relation["natural"~"^(wood|scrub)$"](@BBOX@);'
    + 'node["natural"="tree"](@BBOX@););out geom;';
  const els = await tiled(q, lat0, lon0, lat1, lon1, 0.028, `${id}-g`);
  const seen = new Set();
  const areas = [], trees = [], rowsOut = [];
  const loc = (lat, lon) => toLocal(lat, lon, c).map((v) => +v.toFixed(1));
  for (const el of els) {
    const k = `${el.type}${el.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const t = el.tags || {};
    if (el.type === 'node') { if (t.natural === 'tree') trees.push(...loc(el.lat, el.lon)); continue; }
    if (t.natural === 'tree_row' && el.type === 'way' && el.geometry?.length >= 2) {
      rowsOut.push(simplify(el.geometry.map((g) => loc(g.lat, g.lon)), 1.5).flat());
      continue;
    }
    const polys = el.type === 'way' ? (el.geometry?.length >= 4 ? [el.geometry.map((g) => [g.lat, g.lon])] : []) : rings(el.members || []);
    for (const ring of polys) {
      let pts = ring.map(([la, lo]) => loc(la, lo));
      if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
      pts = simplify(pts, 3);
      if (pts.length < 3 || area(pts) < 150) continue;
      areas.push({ k: KIND(t), p: pts.flat() });
    }
  }
  // Просветы: дорожки, дороги, площадки, вода и фонтаны внутри зелени — туда деревья не сажаем.
  // Берём только то, что задевает рамку какого-нибудь участка (остальные дороги города не нужны).
  console.log(`${c.name}: качаю дорожки и площадки…`);
  const qg = '[out:json][timeout:150];('
    + 'way["highway"~"^(footway|path|pedestrian|cycleway|steps|bridleway|service|track|living_street|residential|unclassified|tertiary|secondary|primary|trunk)$"](@BBOX@);'
    + 'way["leisure"~"^(pitch|playground|track|stadium)$"](@BBOX@);way["amenity"="fountain"](@BBOX@);'
    + 'way["natural"="water"](@BBOX@);way["place"="square"](@BBOX@);way["area:highway"](@BBOX@););out geom;';
  const gels = await tiled(qg, lat0, lon0, lat1, lon1, 0.028, `${id}-gp`);
  const boxes = areas.map((a) => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (let i = 0; i < a.p.length; i += 2) { x0 = Math.min(x0, a.p[i]); x1 = Math.max(x1, a.p[i]); z0 = Math.min(z0, a.p[i + 1]); z1 = Math.max(z1, a.p[i + 1]); } return [x0, x1, z0, z1]; });
  const G = 200, grid = new Map();                        // рамки участков по клеткам 200 м — быстрый отбор
  boxes.forEach((b, i) => { for (let gx = Math.floor(b[0] / G); gx <= Math.floor(b[1] / G); gx++) for (let gz = Math.floor(b[2] / G); gz <= Math.floor(b[3] / G); gz++) { const k = gx + ',' + gz; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); } });
  const touches = (x0, x1, z0, z1) => { for (let gx = Math.floor(x0 / G); gx <= Math.floor(x1 / G); gx++) for (let gz = Math.floor(z0 / G); gz <= Math.floor(z1 / G); gz++) for (const i of grid.get(gx + ',' + gz) || []) { const b = boxes[i]; if (x0 <= b[1] && x1 >= b[0] && z0 <= b[3] && z1 >= b[2]) return true; } return false; };
  const WIDTH = { footway: 2.5, path: 2, cycleway: 2.5, steps: 2.5, bridleway: 2, pedestrian: 4, service: 4, track: 3, living_street: 5, residential: 6, unclassified: 6, tertiary: 8, secondary: 10, primary: 12, trunk: 14 };
  const paths = [], holes = [];
  seen.clear();
  for (const el of gels) {
    if (el.type !== 'way' || !el.geometry?.length || seen.has(el.id)) continue;
    seen.add(el.id);
    const t = el.tags || {};
    let pts = el.geometry.map((g) => loc(g.lat, g.lon));
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    if (!touches(x0, x1, z0, z1)) continue;
    const closed = pts.length >= 4 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
    const areaLike = !t.highway || t.area === 'yes' || t['area:highway'];
    if (areaLike && closed) {
      pts.pop(); pts = simplify(pts, 1);
      if (pts.length >= 3 && area(pts) >= 20) holes.push(pts.flat());
    } else if (t.highway && WIDTH[t.highway]) {
      paths.push([WIDTH[t.highway], ...simplify(pts, 1).flat()]);
    }
  }
  console.log(`  просветов: дорожек ${paths.length}, площадок ${holes.length}`);
  const byKind = {};
  for (const a of areas) byKind[a.k] = (byKind[a.k] || 0) + 1;
  console.log(`  участков: ${areas.length} ${JSON.stringify(byKind)}, деревьев: ${trees.length / 2}, рядов: ${rowsOut.length}`);
  const file = path.join('public/data', `${id}-green.json`);
  fs.writeFileSync(file, JSON.stringify({ id, areas, trees, rows: rowsOut, paths, holes }));
  console.log(`  → ${file} (${(fs.statSync(file).size / 1024 / 1024).toFixed(1)} МБ)`);
}

if (process.argv[1].endsWith('fetch-green.mjs')) {
  const which = process.argv[2] || 'moscow';
  for (const id of which === 'all' ? Object.keys(CITIES) : [which]) await fetchGreen(id);
}
