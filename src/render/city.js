// Город из контуров OSM: экструзия в коробки-призмы, склейка по тайлам 400 м, дальний LOD.
// Приём взят из больших городских сцен: один меш на тайл вместо 30 тысяч объектов — иначе
// рисовалка задыхается на вызовах отрисовки. Ближние тайлы — с фасадами, дальние — плоские силуэты.
import * as THREE from 'three';
import { roofTex, waterTex } from './tex.js';
import { facadeAtlas, pickFacade, osmColor, CELL_M, VARIANTS } from './facades.js';
import { GRID, GLOW, wire as fadingWire } from './style.js';
import { ccw, crownBox } from '../core/colliders.js';
import { fromLocal, lon2tile, lat2tile } from '../core/grid.js';
import { landmarkMaterials } from './landmark-materials.js';
import { refineFoundation } from './foundation.js';

// ---- крыши со спутника ----
// Каждый квартал получает свою текстуру крыш: кусок снимка ESRI над ним (ближе 1.2 км — зум 17,
// ~0.8 м на пиксель, дальше — зум 16). UV вершин крыши считаются из их настоящих lat/lon в Меркаторе,
// поэтому у каждого дома — его настоящая крыша: скаты, дворы-колодцы, купола, зелень на кровле.
const ESRI = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const imgCache = new Map();
// Не больше 4 снимков крыш в сети одновременно, ближние кварталы первыми: без очереди город разом
// ставил в браузер ~600 запросов к тому же серверу ESRI, и рельеф под ногами ждал их все
const ROOF_NET = 4;
let roofBusy = 0;
const roofWait = [];
function pump() {
  while (roofBusy < ROOF_NET && roofWait.length) {
    let bi = 0;
    for (let i = 1; i < roofWait.length; i++) if (roofWait[i].pri < roofWait[bi].pri) bi = i;
    const job = roofWait.splice(bi, 1)[0];
    roofBusy++;
    const im = new Image(); im.crossOrigin = 'anonymous';
    const fin = (v) => { roofBusy--; job.res(v); pump(); };
    im.onload = () => fin(im); im.onerror = () => fin(null);
    im.src = job.url;
  }
}
function tileImage(z, x, y, pri = 0) {
  const key = `${z}/${x}/${y}`;
  if (!imgCache.has(key)) {
    imgCache.set(key, new Promise((res) => { roofWait.push({ url: ESRI(z, x, y), pri, res }); pump(); }));
    if (imgCache.size > 1500) imgCache.delete(imgCache.keys().next().value);   // браузер кэширует сам
  }
  return imgCache.get(key);
}
const ROOF_MARGIN = 110;            // м: дом относится к кварталу по центру, края могут вылезать
function roofAtlas(t, near, pri = 0) {
  const z = near ? 17 : 16, size = near ? 768 : 256;
  const half = TILE / 2 + ROOF_MARGIN;
  const [latN, lonW] = fromLocal(t.x - half, t.z + half, t.clat, t.clon);
  const [latS, lonE] = fromLocal(t.x + half, t.z - half, t.clat, t.clon);
  const X0 = lon2tile(lonW, z) * 256, X1 = lon2tile(lonE, z) * 256, Y0 = lat2tile(latN, z) * 256, Y1 = lat2tile(latS, z) * 256;
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#8a8680'; ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const sx = size / (X1 - X0), sy = size / (Y1 - Y0);
  for (let tx = Math.floor(X0 / 256); tx <= Math.floor(X1 / 256); tx++)
    for (let ty = Math.floor(Y0 / 256); ty <= Math.floor(Y1 / 256); ty++)
      tileImage(z, tx, ty, pri).then((im) => { if (im) { ctx.drawImage(im, (tx * 256 - X0) * sx, (ty * 256 - Y0) * sy, 256 * sx, 256 * sy); tex.needsUpdate = true; } });
  const uvOf = (x, zn) => {
    const [lat, lon] = fromLocal(x, zn, t.clat, t.clon);
    return [(lon2tile(lon, z) * 256 - X0) / (X1 - X0), 1 - (lat2tile(lat, z) * 256 - Y0) / (Y1 - Y0)];
  };
  return { tex, uvOf };
}

const R_EARTH = 6_371_000;

const TILE = 400;                 // м, сторона тайла
export const NEAR = 3500;         // м, дальше этого — упрощённые тайлы
export const FAR = 14000;         // м, дальше вообще не рисуем (город виден как дымка)
const ROOF_UV = 26;               // м на повтор текстуры крыши

// палитра крыш и стен: по типу здания, чтобы город не был однотонным
const PAL = {
  yes: [0x8a8f98, 0x6d727a], apartments: [0x9a9188, 0x8d6a58], residential: [0x96907f, 0x7d766e],
  service: [0x7e8288, 0x6a6e73], garages: [0x71757a, 0x5c6064], brick: [0x9c5f4a, 0x86503e],
  house: [0xa89a86, 0x8a7e6d], commercial: [0x8f97a2, 0x737a84], office: [0x93a0ad, 0x76818c],
  industrial: [0x7d8086, 0x64676c], retail: [0x9aa0a6, 0x7c8186], church: [0xd8cdb6, 0xb3a88f],
  hotel: [0x9aa4b0, 0x7b838d], school: [0xa79c8d, 0x867d71], hospital: [0xb0b4b8, 0x8e9296],
  garage: [0x74777c, 0x5e6165], construction: [0x8a8578, 0x6e6a60],
};
const colorOf = (t, r) => {
  const [a, b] = PAL[t] || PAL.yes;
  const c = new THREE.Color(r() > 0.5 ? a : b);
  if (r() > 0.86) c.lerp(new THREE.Color(0x9c5f4a), 0.55);     // редкий кирпичный дом — город перестаёт быть серым
  const k = 0.6 + r() * 0.35;
  c.offsetHSL((r() - 0.5) * 0.04, (r() - 0.5) * 0.1, 0);
  return c.multiplyScalar(k);
};
const rnd = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };

// площадь и центр контура
function ring(p) {
  let s = 0, cx = 0, cy = 0;
  for (let i = 0, n = p.length / 2; i < n; i++) {
    const x1 = p[i * 2], y1 = p[i * 2 + 1], x2 = p[((i + 1) % n) * 2], y2 = p[((i + 1) % n) * 2 + 1];
    const cr = x1 * y2 - x2 * y1;
    s += cr; cx += (x1 + x2) * cr; cy += (y1 + y2) * cr;
  }
  const a = s / 2;
  return { area: Math.abs(a), cx: a ? cx / (6 * a) : p[0], cy: a ? cy / (6 * a) : p[1] };
}

// Стены контура от y0 до y1 лицом наружу (контур — против часовой, см. ccw), UV под фасад
// cell — ячейка атласа фасадов [столбец, строка]; UV — в ячейках (12 м), повтор внутри ячейки в шейдере
function walls(p, y0, y1, col, W, cell = [0, 0]) {
  const n = p.length / 2;
  const v0 = y0 / CELL_M, v1 = y1 / CELL_M;
  let run = 0;                                         // пройденная длина периметра → U
  for (let i = 0; i < n; i++) {
    const x1 = p[i * 2], z1 = p[i * 2 + 1], x2 = p[((i + 1) % n) * 2], z2 = p[((i + 1) % n) * 2 + 1];
    const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz) || 1;
    const nx = dz, nz = -dx;                           // наружная нормаль (восток, север)
    const shade = 0.72 + 0.28 * Math.abs(nx / len);    // грани по-разному ловят свет
    const r = col.r * shade, g = col.g * shade, b = col.b * shade;
    const u0 = run / CELL_M, u1 = (run + len) / CELL_M;
    run += len;
    W.pos.push(x1, y0, -z1, x2, y0, -z2, x2, y1, -z2, x1, y0, -z1, x2, y1, -z2, x1, y1, -z1);
    W.uv.push(u0, v0, u1, v0, u1, v1, u0, v0, u1, v1, u0, v1);
    for (let k = 0; k < 6; k++) { W.col.push(r, g, b); W.nrm.push(nx / len, 0, -nz / len); W.cell.push(cell[0], cell[1]); }
  }
}
// Плоская крыша на высоте h: честная триангуляция (earcut), в том числе у домов буквой Г и П.
// Раньше — веер из первой точки: у невыпуклых контуров треугольники вылезали за дом, длинные
// выбрасывались — и на крыше оставались дыры («нет пола»).
function roof(p, h, col, Rf, uvOf = null) {
  const n = p.length / 2;
  const pts = [];
  for (let i = 0; i < n; i++) pts.push(new THREE.Vector2(p[i * 2], p[i * 2 + 1]));
  const faces = THREE.ShapeUtils.triangulateShape(pts, []);
  for (const f of faces) {
    let [a, b, c] = f.map((i) => pts[i]);
    if ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x) < 0) [b, c] = [c, b];   // лицом вверх
    for (const q of [a, b, c]) {
      Rf.pos.push(q.x, h, -q.y);
      if (uvOf) Rf.uv.push(...uvOf(q.x, q.y)); else Rf.uv.push(q.x / ROOF_UV, q.y / ROOF_UV);
      Rf.col.push(col.r, col.g, col.b); Rf.nrm.push(0, 1, 0); Rf.cell.push(0, 0);
    }
  }
}

const SAT = { r: 0.8, g: 0.8, b: 0.8 };                // снимок крыши чуть приглушаем — он уже со светом съёмки
// Экструзия контура: стены (с UV под фасад) и крыша — в два разных набора, у них разные материалы.
const SHOP = VARIANTS.find((v) => v.key === 'shopfront').cell;
function extrude(b, W, Rf, lod, uvOf = null) {
  const { p, h, c: col, cell } = b;
  if (p.length / 2 < 3) return;
  const { area } = ring(p);
  if (lod && area < 900) return;                       // далеко мелочь не видно
  // первый этаж с витринами — у домов с магазинами (sh) выше двух этажей
  if (b.shop && h > 9 && !lod) { walls(p, 0, 4, col, W, SHOP); walls(p, 4, h, col, W, cell); }
  else walls(p, 0, h, col, W, cell);
  const rc = 0.72;                                     // крыши темнее стен, иначе город белёсый
  // со снимком крыша берёт цвет из фотографии; без снимка — roof:colour из OSM или тон стен
  roof(p, h, uvOf ? SAT : b.rc || { r: col.r * rc, g: col.g * rc, b: col.b * rc }, Rf, uvOf);
  // надстройка на крыше (машинное отделение) — та же, что в столкновениях (crownBox), только если
  // целиком стоит на крыше; раньше у невыпуклых домов она висела в воздухе и не держала героя
  const cr = !lod && crownBox(p, h);
  if (cr) {
    walls(cr.p, h, cr.h, { r: col.r * 0.9, g: col.g * 0.9, b: col.b * 0.9 }, W, cell);   // стены надстройки — фасадом
    roof(cr.p, cr.h, uvOf ? SAT : col, Rf, uvOf);
  }
}

// материалы делаем лениво: текстуры рисуются на canvas, до старта игры они не нужны
let MATS = null;
function futuristic(mat) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uGlow = GLOW;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vH; varying float vWall; varying vec2 vXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vH = transformed.y; vWall = 1.0 - abs(objectNormal.y); vXZ = transformed.xz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uGlow;\nvarying float vH; varying float vWall; varying vec2 vXZ;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
  {
    float fl = fract(vH / 6.4);                                   // перекрытие через этаж
    float band = smoothstep(0.93, 0.965, fl) * (1.0 - smoothstep(0.975, 1.0, fl));
    float rib = fract((vXZ.x + vXZ.y) / 9.0);                     // вертикальные рёбра по фасаду
    float ribs = smoothstep(0.96, 0.985, rib) * (1.0 - smoothstep(0.99, 1.0, rib)) * 0.6;
    float lit = step(0.5, fract(sin(floor(vH / 6.4) * 12.9898 + floor((vXZ.x - vXZ.y) / 9.0) * 78.233) * 43758.5453)); // часть полос погашена
    totalEmissiveRadiance += uGlow * vWall * (band * (0.35 + 0.65 * lit) + ribs) * vec3(0.25, 0.75, 1.0) * 1.4;
  }`);
  };
  return mat;
}

const mats = () => {
  if (MATS) return MATS;
  // режим сетки: голые коробки контуром, без окон и крыш — видно структуру города
  if (GRID) {
    // Футуристично, но не каркас: сплошное тёмное «стекло», по стенам светятся тонкие полосы
    // перекрытий (через этаж, 3.2 м) и редкие вертикальные рёбра; поверх — только рёбра коробок
    // (EdgesGeometry в tileMesh), а не каждый треугольник, как раньше.
    const fill = (c) => futuristic(new THREE.MeshLambertMaterial({ color: c,
      polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
    return (MATS = [fill(0x24435e), fill(0x35607f)]);   // стены, крыши
  }
  return (MATS = [facadeMat(), new THREE.MeshLambertMaterial({ vertexColors: true, map: roofTex() })]);
};

// Все стены — одним материалом по атласу facades.js (16 московских типов 4×4). У вершины своя ячейка
// (fcell) и UV в ячейках (fuv); повтор внутри ячейки — fract в шейдере, а мип-уровень — по
// производным непрерывного fuv (textureGrad), иначе на стыках повторов вылезали бы швы.
function facadeMat() {
  const A = facadeAtlas(2048);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, color: WALL_TONE, emissive: 0xffe2b0, emissiveIntensity: 0.9 });
  const uFac = { value: A.texture }, uFacE = { value: A.emissive };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uFac = uFac; sh.uniforms.uFacE = uFacE; sh.uniforms.uNight = NIGHT;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 fuv; attribute vec2 fcell; varying vec2 vFuv; varying vec2 vFcell;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vFuv = fuv; vFcell = fcell;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uFac, uFacE; uniform float uNight; varying vec2 vFuv; varying vec2 vFcell;')
      .replace('#include <map_fragment>', `
  vec2 fBase = vec2(vFcell.x, 3.0 - vFcell.y);                  // строка 0 — верх холста, а у текстуры flipY
  vec2 fUv = (fBase + fract(vFuv)) * 0.25;
  vec2 fdx = dFdx(vFuv) * 0.25, fdy = dFdy(vFuv) * 0.25;
  diffuseColor *= textureGrad(uFac, fUv, fdx, fdy);`)
      .replace('#include <emissivemap_fragment>', `
  totalEmissiveRadiance *= textureGrad(uFacE, fUv, fdx, fdy).rgb * uNight;`);
  };
  mat.customProgramCacheKey = () => 'facade-atlas';
  return mat;
}
// сколько горят окна: днём чуть-чуть (глубина комнат), ночью — вовсю; задаёт setCityNight
const NIGHT = { value: 0.04 };
export function setCityNight(k) { NIGHT.value = 0.04 + 0.96 * Math.max(0, Math.min(1, k)); }
export const cityNight = () => (NIGHT.value - 0.04) / 0.96;

// Стартовая башня: самый высокий дом квартала — стеклянный, со своим тоном; квартал пересобираем
const GLASS = VARIANTS.find((v) => v.key === 'glass').cell;
export function markLandmark(city, t) {
  const b = t.list.reduce((m, q) => (q.h > m.h ? q : m), t.list[0]);
  b.cell = GLASS; b.shop = false;
  b.c = new THREE.Color(0.55, 0.62, 0.72);
  if (t.mesh) { dropMesh(t.mesh, city.group); t.mesh = null; }
  return b;
}

// Тон стен: палитра (линейное ~0.26) × разброс 0.6–0.95 × атлас (~0.7) — альбедо ~0.14, темнее прежних
// ~0.18. Отдельный множитель сверху уже лишний: с ним альбедо падало до 0.07 и тени были чёрными.
const WALL_TONE = 0xffffff;
let LOD_MAT = null;
const lodMat = () => LOD_MAT || (LOD_MAT = GRID ? mats()[0]
  : new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xdadada }));   // = WALL_TONE × средний тон атласа (0.7 в линейном)

// Готовим город один раз: раскладываем здания по тайлам и строим геометрию лениво.
// Разложить дома по кварталам 400 м (подгрузка кусками тоже идёт сюда). Новые кварталы дописываются
// в city.tiles. skip(b) — пропустить дом (дубль уже загруженного центра). Случайность — от координат
// дома, чтобы вид не зависел от порядка загрузки кусков.
// Возвращает { added: [[квартал, дом]], touched: Set кварталов }.
export function addBuildings(city, buildings, skip = null) {
  const added = [], touched = new Set();
  for (const b of buildings) {
    if (skip?.(b)) continue;
    const { cx, cy } = ring(b.p);
    const key = `${Math.floor(cx / TILE)},${Math.floor(cy / TILE)}`;
    let t = city.tileMap.get(key);
    if (!t) {
      t = { key, x: Math.floor(cx / TILE) * TILE + TILE / 2, z: Math.floor(cy / TILE) * TILE + TILE / 2, list: [], mesh: null, lodMesh: null, maxH: 0, clat: city.lat, clon: city.lon };
      city.tileMap.set(key, t); city.tiles.push(t);
    }
    const r = rnd(Math.imul(Math.round(cx * 10), 73856093) ^ Math.imul(Math.round(cy * 10), 19349663) ^ city.seed);
    // тип фасада и цвет — по тегам OSM (building, material, levels, colour), иначе по типу и высоте
    const tags = { t: b.t, m: b.m, lv: b.lv, c: b.c, sh: b.sh };
    const cell = VARIANTS[pickFacade(tags, b.h, r)].cell;
    const own = osmColor(b.c);
    const col = own ? own.multiplyScalar(0.62 + r() * 0.2) : colorOf(b.t, r);   // тег цвета — тот же «затемнитель», что у палитры
    const rcol = osmColor(b.rc);
    const e = { p: ccw(b.p), h: b.h, c: col, cell, shop: !!b.sh, rc: rcol && rcol.multiplyScalar(0.7) };
    t.list.push(e);
    added.push([t, e]); touched.add(t);
    if (b.h > t.maxH) { t.maxH = b.h; t.topX = cx; t.topZ = cy; }   // самое высокое здание квартала и его центр
  }
  return { added, touched };
}

export const buildingKey = (b) => `${b.p[0]},${b.p[1]},${b.p[2]},${b.p[3]}`;

// Квартал поменялся (догрузились дома) — меши пересоберутся на следующем кадре
export function invalidateTile(city, t) {
  if (t.mesh) { dropMesh(t.mesh, city.group); t.mesh = null; }
  if (t.lodMesh) { dropMesh(t.lodMesh, city.group); t.lodMesh = null; }
}

// Готовим город один раз: раскладываем здания по тайлам и строим геометрию лениво.
export function buildCity(data) {
  const city = { id: data.id, name: data.name, lat: data.lat, lon: data.lon, tiles: [], tileMap: new Map(), seed: data.id === 'moscow' ? 7 : 13, group: new THREE.Group() };
  addBuildings(city, data.buildings);
  const tiles = city.tileMap;
  // дома центра по первым двум точкам контура (координаты в данных — до 0.1 м, у кусков кольца те же):
  // куски кольца заходят на центр, дубли пропускаем. По рамке центра резать нельзя — центр дома
  // у скрипта и у нас считается по-разному, и дома на границе терялись.
  city.core = new Set(data.buildings.map(buildingKey));
  const water = waterMesh(data.water);
  // Same roof selection as spawnOnRoof: customise this landmark, not every block.
  if (data.id === 'moscow') {
    let start = null;
    for (const tile of tiles.values()) {
      if (Math.hypot(tile.x, tile.z) > 1500 || tile.maxH < 25 || tile.maxH > 90) continue;
      if (!start || tile.maxH > start.maxH) start = tile;
    }
    if (start) {
      const building = start.list.find(b => {
        const { cx, cy } = ring(b.p);
        return b.h === start.maxH && Math.hypot(cx - start.topX, cy - start.topZ) < .01;
      });
      if (building) building.landmark = true;
    }
  }
  city.water = water;
  return city;
}

function waterMesh(polys) {
  const pos = [], uv = [];
  for (const p of polys || []) {
    const n = p.length / 2;
    for (let i = 1; i < n - 1; i++) {
      const a = [p[0], p[1]], b = [p[i * 2], p[i * 2 + 1]], c = [p[(i + 1) * 2], p[(i + 1) * 2 + 1]];
      const side = Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]), Math.hypot(c[0] - b[0], c[1] - b[1]), Math.hypot(a[0] - c[0], a[1] - c[1]));
      if (side > 400) continue;                 // тот же «парус», только у реки
      pos.push(a[0], 0.4, -a[1], b[0], 0.4, -b[1], c[0], 0.4, -c[1]);
      uv.push(a[0] / 600, a[1] / 600, b[0] / 600, b[1] / 600, c[0] / 600, c[1] / 600);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return new THREE.Mesh(g, GRID
    ? fadingWire(new THREE.MeshBasicMaterial({ color: 0x2f6ddb, wireframe: true }))
    : new THREE.MeshLambertMaterial({ color: 0x5b83a6, map: waterTex(), transparent: true, opacity: 0.9 }));
}

function tileMesh(t, lod, near = false, pri = 0) {
  const W = { pos: [], col: [], nrm: [], uv: [], cell: [] };
  const Rf = { pos: [], col: [], nrm: [], uv: [], cell: [] };
  const landmarkWalls = { pos: [], col: [], nrm: [], uv: [], cell: [] };
  const landmarkRoof = { pos: [], col: [], nrm: [], uv: [], cell: [] };
  const atlas = !GRID && !lod && t.clat !== undefined ? roofAtlas(t, near, pri) : null;   // крыши со спутника — у ближних кварталов
  for (const b of t.list) {
    if (!b.landmark || lod || GRID) { extrude(b, W, Rf, lod, atlas?.uvOf); continue; }
    const white = { r: 1, g: 1, b: 1 }, { cx, cy } = ring(b.p);
    const uv = (x, z) => [(x - cx) / 4, (z - cy) / 4];
    walls(b.p, 0, b.h, white, landmarkWalls);
    roof(b.p, b.h, white, landmarkRoof, uv);
    const crown = crownBox(b.p, b.h);
    if (crown) {
      walls(crown.p, b.h, crown.h, white, landmarkWalls);
      roof(crown.p, crown.h, white, landmarkRoof, uv);
    }
  }
  const parts = [W, Rf, landmarkWalls, landmarkRoof];
  const g = new THREE.BufferGeometry();
  const cat = (key, n) => { const a = []; for (const s of parts) a.push(...s[key]); return new THREE.Float32BufferAttribute(a, n); };
  g.setAttribute('position', cat('pos', 3));
  g.setAttribute('color', cat('col', 3));
  g.setAttribute('normal', cat('nrm', 3));
  // у стен uv — это UV фасада в ячейках атласа, у крыш — UV снимка/текстуры крыши
  const uvAll = cat('uv', 2);
  g.setAttribute('uv', uvAll);
  g.setAttribute('fuv', uvAll);
  g.setAttribute('fcell', cat('cell', 2));
  // Дальний тайл — одним материалом и одним вызовом: окна за 3.5 км меньше пикселя, а четыре группы
  // (три фасада + крыша) давали ~2300 вызовов на 770 дальних кварталов. Цвет — средний тон фасада.
  if (lod) {
    const m = new THREE.Mesh(g, lodMat());
    m.userData.perfCat = 'дома дальние';
    m.userData.noCast = true;               // дальние тайлы — за пределом теней, в карты теней не пускаем
    return m;
  }
  let off = 0;
  parts.forEach((s, i) => { const n = s.pos.length / 3; if (n) g.addGroup(off, n, i); off += n; });   // 0 — стены, 1 — крыши
  let ms = mats();
  if (atlas) {
    ms = [...ms];
    ms[1] = new THREE.MeshLambertMaterial({ vertexColors: true, map: atlas.tex });
  }
  if (landmarkRoof.pos.length) ms = [...ms, ...landmarkMaterials()];
  const m = new THREE.Mesh(g, ms);
  m.userData.roofTex = atlas?.tex || null;
  m.userData.roofMaterial = atlas ? ms[1] : null;
  if (GRID && !lod) {
    // только рёбра коробок (угол > 30°), без диагоналей треугольников; у дальних тайлов — без линий
    const wire = new THREE.LineSegments(new THREE.EdgesGeometry(g, 30), fadingWire(new THREE.LineBasicMaterial({ color: 0x8fd0ff, transparent: true, opacity: 0.7 })));
    wire.matrixAutoUpdate = false;
    m.add(wire);
  }
  // Отсечение по кадру включено: раньше каждый тайл в 14 км рисовался и за спиной, и в каждой
  // карте теней. Сфера тайла ~300 м — проверка дешёвая.
  m.matrixAutoUpdate = false;
  m.userData.perfCat = lod ? 'дома дальние' : 'дома ближние';
  m.userData.noCast = lod;                 // дальние тайлы — за пределом теней, в карты теней не пускаем
  return m;
}

function dropMesh(m, group) {
  group.remove(m);
  m.geometry.dispose();
  for (const c of m.children) c.geometry?.dispose();
  if (m.userData.roofTex) { m.userData.roofTex.dispose(); m.userData.roofMaterial?.dispose(); }
}

// Каждый кадр: показываем тайлы вокруг игрока, строим недостающие порциями (без фризов).
// above — высота глаз над городом: сверху дальность считаем по прямой до тайла, а не по земле.
// groundAt(x, z) → [высота земли, зум тайла рельефа] в точке города. Каждый квартал стоит на СВОЕЙ
// земле (под центром тайла), а не весь город — на земле под героем: раньше над холмом или низиной
// город целиком ехал вверх-вниз и дома то тонули, то вылезали из земли.
let tick = 0;
// kx — поправка проекции по востоку: дома разложены от центра города (cos его широты), сцена — от
// игрока (cos широты игрока); без неё дома у края города стояли мимо снимка до ~8 м
export function updateCity(city, offX, offZ, group, budget = 2, above = 0, groundAt = null, kx = 1, dt = 1 / 60) {
  let built = 0;
  tick++;
  // Spend the small build budget under the player first, regardless of OSM file order.
  const ordered = city.tiles.slice().sort((a, b) =>
    Math.hypot(a.x * kx + offX, a.z + offZ) - Math.hypot(b.x * kx + offX, b.z + offZ));
  for (const t of ordered) {
    const d = Math.hypot(t.x * kx + offX, t.z + offZ);   // offX — восток, offZ — север
    const d3 = Math.hypot(d, Math.max(0, above - t.maxH));
    const want = d3 < (city.renderFar ?? FAR) ? (d3 < (city.renderNear ?? NEAR) ? 'full' : 'lod') : 'none';
    // подробный тайл (с текстурой крыш) вне ближней зоны дольше ~10 с — выгружаем: иначе, пролетев
    // город, держали бы в видеопамяти сотни снимков
    if (want !== 'full' && t.mesh) {
      t.mesh.userData.away ??= tick;
      if (tick - t.mesh.userData.away > 600) { dropMesh(t.mesh, group); t.mesh = null; }
    }
    if (want === 'none') { if (t.mesh) t.mesh.visible = false; if (t.lodMesh) t.lodMesh.visible = false; continue; }
    t.baseCheck = (t.baseCheck ?? 0) - dt;
    let sample = [0, -1];
    if (groundAt && (t.base === undefined || (t.baseZ < 16 && t.baseCheck <= 0))) {
      sample = groundAt(t.x, t.z); t.baseCheck = .25;
    }
    const hasFoundation = refineFoundation(t, ...sample, dt);
    // Wait for a real height before the first appearance, rather than drawing at 0 m.
    if (groundAt && !hasFoundation) {
      if (t.mesh) t.mesh.visible = false;
      if (t.lodMesh) t.lodMesh.visible = false;
      continue;
    }
    const needFull = want === 'full';
    const near = d3 < 1000;
    let m = needFull ? t.mesh : t.lodMesh;
    if (m && needFull) {
      m.userData.away = undefined;
      // подлетели — пересобираем с крышами зума 17 (у дальних подробных тайлов зум 16)
      if (near && !m.userData.near && m.userData.roofTex && built < budget) { dropMesh(m, group); t.mesh = m = null; }
    }
    if (!m) {
      if (built >= budget) continue;       // не строим больше пары тайлов за кадр
      m = tileMesh(t, !needFull, near, d3);
      m.userData.near = near;
      if (needFull) t.mesh = m; else t.lodMesh = m;
      group.add(m);
      built++;
    }
    m.visible = true;
    if (needFull && t.lodMesh) t.lodMesh.visible = false;
    if (!needFull && t.mesh) t.mesh.visible = false;
    m.position.set(offX, (t.base || 0) - (d * d) / (2 * R_EARTH), -offZ);   // + уход за горизонт вместе с землёй
    m.scale.x = kx;
    m.updateMatrix();
  }
  return built;
}
