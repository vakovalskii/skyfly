// Настоящая Земля под ногами: тайлы Web Mercator — снимок (ESRI World Imagery) натянут
// на сетку, поднятую по высотам (AWS terrarium). Земля неподвижна: тайлы стоят по координатам,
// а вокруг игрока двигается мир. Ближние тайлы подробные, дальние — грубые.
import * as THREE from 'three';
import { R, metersPerLat, metersPerLon } from '../core/grid.js';
import { GRID, wire as fadingWire } from './style.js';
import { PHOTOREAL } from './photoreal.js';

const IMG = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const ELE = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;

// кольца детализации: [зум, сколько тайлов в каждую сторону]
// 18 и 17 — только у самой земли (ниже 600 м): снимок ~0.6–1.2 м на пиксель под ногами
const RINGS = [[18, 1], [17, 2], [16, 2], [14, 2], [12, 2], [10, 2], [8, 2]];
// Грубые тайлы лежат поверх подробных там, где перекрываются: их сетка усредняет рельеф и
// оказывается на 2–4 м выше — герой «стоял по колено в воде». Каждый уровень грубее опускаем,
// тогда подробный всегда сверху. Физика (ground) учитывает то же опускание: там, где загружен
// только грубый тайл, ноги стоят ровно на видимой поверхности. Издалека сдвиг незаметен.
// Рельеф на шаре: каждая вершина опускается на d²/2R от игрока (раньше — только центр тайла,
// и грубый тайл 150 км торчал плоским квадратом над круглой Землёй). За радиусом, где рельеф
// загружен сплошь, пиксели отбрасываются — край круглый, дальше видна Земля атмосферы.
const EDGE = { value: 1e9 };
// Цвет «земли вообще»: им же красится планета атмосферы takram (groundAlbedo). К краю покрытия
// и с высоты (15→40 км) рельеф переходит в него, выше 45 км не рисуется — одна цельная планета
// без светлого круга и щелей между дальними тайлами (плоская раскладка тайлов за сотни км расходится).
export const GROUND_TONE = new THREE.Color(GRID ? 0x162d3c : 0x3b4636);   // линейный цвет (Color сам переводит из sRGB)
const TONE = { value: GROUND_TONE };
const ALTFADE = { value: 0 };
// globe: true — под нами есть шар со снимком (globe.js): тогда рельеф не красим в «цвет планеты»,
// а просто прячем выше 30 км — снимок шара того же источника (ESRI), подмена почти незаметна
export const terrainOpts = { globe: false };
function curved(mat, coverage) {
  mat.userData.coverage = coverage;
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uTerrainMasks = coverage.map;
    sh.uniforms.uTerrainMaskCount = coverage.count;
    sh.uniforms.uTerrainMaskWidth = coverage.width;
    sh.uniforms.uEdge = EDGE; sh.uniforms.uTone = TONE; sh.uniforms.uAltFade = ALTFADE;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vFlat; varying vec2 vTileUV;')
      .replace('#include <project_vertex>', `vec4 mvPosition = modelMatrix * vec4(transformed, 1.0);
  vTileUV = uv;
  float dd = dot(mvPosition.xz, mvPosition.xz);
  vFlat = sqrt(dd);
  mvPosition.y -= dd / ${(2 * 6_371_000).toFixed(1)};
  mvPosition = viewMatrix * mvPosition;
  gl_Position = projectionMatrix * mvPosition;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uEdge, uAltFade;\nuniform vec3 uTone;\nvarying float vFlat; varying vec2 vTileUV; uniform sampler2D uTerrainMasks; uniform int uTerrainMaskCount; uniform float uTerrainMaskWidth;')
      // край не резкий: последние 30% радиуса и большая высота — переход в цвет планеты (GROUND_TONE)
      .replace('void main() {', `void main() {
        if (vFlat > uEdge) discard;
        for (int i = 0; i < uTerrainMaskCount; i++) {
          vec4 rect = texture2D(uTerrainMasks, vec2((float(i) + .5) / uTerrainMaskWidth, .5));
          if (vTileUV.x >= rect.x && vTileUV.y >= rect.y && vTileUV.x < rect.z && vTileUV.y < rect.w) discard;
        }`)
      .replace('#include <map_fragment>', '#include <map_fragment>\n  diffuseColor.rgb = mix(diffuseColor.rgb, uTone, max(uAltFade, smoothstep(uEdge * 0.7, uEdge, vFlat)));');
  };
  return mat;
}
// подробнее 16 — чуть выше (иначе мерцание на стыке с тайлом 16), грубее — ниже
const SINK = (z) => (z > 16 ? -(z - 16) * 0.1 : z === 16 ? 0 : (16 - z) ** 1.5 * 2.5);   // z18 +0.2, z14 ≈ −7, z12 ≈ −20 м
const SEG = 24;               // сетка тайла: 24×24 — компромисс между рельефом и весом

// Hide cracks where independently sampled DEMs/LODs meet at different heights.
// The skirt extends DOWN only; physics continues to use the original surface.
function addSkirt(g, depth) {
  const pos = g.attributes.position, uv = g.attributes.uv;
  const positions = Array.from(pos.array), uvs = Array.from(uv.array), indices = Array.from(g.index.array);
  const edges = [[], [], [], []], n = SEG + 1;
  for (let i = 0; i <= SEG; i++) {
    edges[0].push(i); edges[1].push(i * n + SEG);
    edges[2].push(SEG * n + SEG - i); edges[3].push((SEG - i) * n);
  }
  for (const edge of edges) for (let i = 1; i < edge.length; i++) {
    const a = edge[i - 1], b = edge[i], start = positions.length / 3;
    for (const [index, down] of [[a, 0], [b, 0], [b, depth], [a, depth]]) {
      positions.push(pos.getX(index), pos.getY(index) - down, pos.getZ(index));
      uvs.push(uv.getX(index), uv.getY(index));
    }
    indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  g.deleteAttribute('normal'); g.setIndex(indices);
}

const lon2x = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const lat2y = (lat, z) => ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z;
const x2lon = (x, z) => (x / 2 ** z) * 360 - 180;
const y2lat = (y, z) => { const n = Math.PI - (2 * Math.PI * y) / 2 ** z; return (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };

const load = (url) => new Promise((res, rej) => {
  const im = new Image();
  im.crossOrigin = 'anonymous';
  im.onload = () => res(im);
  im.onerror = rej;
  im.src = url;
});

// высоты из terrarium-пикселей: h = R*256 + G + B/256 - 32768
function decode(img, sx = 0, sy = 0, sw = 256, sh = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = SEG + 1;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, sx, sy, sw, sh, 0, 0, SEG + 1, SEG + 1);
  const d = g.getImageData(0, 0, SEG + 1, SEG + 1).data;
  const h = new Float32Array((SEG + 1) * (SEG + 1));
  for (let i = 0; i < h.length; i++) h[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
  return h;
}

// размер тайла зума z в метрах на широте lat
const tileMeters = (z, lat) => (40_075_016.686 * Math.cos(lat * Math.PI / 180)) / 2 ** z;

// докуда добивает сплошное покрытие зума: до ближайшей незагруженной клетки,
// но не дальше запрошенного кольца — иначе спрячем дальние тайлы и город повиснет в воздухе
function coverRadius(tiles, z, rad, p, want) {
  let r = rad * tileMeters(z, p.lat);
  for (const t of tiles.values()) {
    if (t.z !== z || t.ready || !want.has(t.key)) continue;
    const cLat = (t.lat0 + t.lat1) / 2, cLon = (t.lon0 + t.lon1) / 2;
    if (!Number.isFinite(cLat)) { r = Math.min(r, 0); continue; }   // ещё не знаем координат — считаем дырой
    const e = (cLon - p.lon) * metersPerLon(p.lat), n = (cLat - p.lat) * metersPerLat();
    r = Math.min(r, Math.max(0, Math.abs(e) - tileMeters(z, p.lat) / 2, Math.abs(n) - tileMeters(z, p.lat) / 2));
  }
  return Math.max(0, r);
}

export function createTerrain(scene, mobile = false) {
  const group = new THREE.Group();
  scene.add(group);
  const tiles = new Map();          // ключ "z/x/y" → тайл
  let queue = [], loading = 0;
  let clock = 0;
  let near = null;                  // самый подробный тайл под игроком — по нему считаем высоту земли

  function make(z, x, y) {
    const key = `${z}/${x}/${y}`;
    if (tiles.has(key)) return tiles.get(key);
    const t = { key, z, x, y, mesh: null, heights: null, ready: false };
    tiles.set(key, t);
    t.lat0 = y2lat(y + 1, z); t.lat1 = y2lat(y, z);
    t.lon0 = x2lon(x, z); t.lon1 = x2lon(x + 1, z);
    return t;
  }

  async function build(t) {
    loading++; t.loading = true;
    const coverage = { count: { value: 0 }, width: { value: 1 }, map: { value: new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType) }, signature: '' };
    coverage.map.value.needsUpdate = true;
    t.coverage = coverage;
    try {
      // высоты есть только до 14 зума — подробным тайлам берём кусок родительской клетки
      const ez = Math.min(t.z, 14), k = 2 ** (t.z - ez);
      const ex = Math.floor(t.x / k), ey = Math.floor(t.y / k), sz = 256 / k;
      const [img, ele] = await Promise.all([
        GRID || PHOTOREAL ? null : load(IMG(t.z, t.x, t.y)),   // в сетке и под Google 3D снимки не нужны — только высоты
        load(ELE(ez, ex, ey)),   // failed height data is retried, never published as a flat 0 m tile
      ]);
      t.heights = ele ? decode(ele, (t.x - ex * k) * sz, (t.y - ey * k) * sz, sz, sz) : new Float32Array((SEG + 1) * (SEG + 1));
      // размеры тайла в метрах
      const latN = y2lat(t.y, t.z), latS = y2lat(t.y + 1, t.z);
      const lonW = x2lon(t.x, t.z), lonE = x2lon(t.x + 1, t.z);
      t.lat0 = latS; t.lat1 = latN; t.lon0 = lonW; t.lon1 = lonE;
      t.w = (lonE - lonW) * metersPerLon((latN + latS) / 2);
      t.h = (latN - latS) * metersPerLat();
      const g = new THREE.PlaneGeometry(t.w, t.h, SEG, SEG);
      g.rotateX(-Math.PI / 2);
      const pos = g.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const gx = i % (SEG + 1), gy = (i / (SEG + 1)) | 0;
        pos.setY(i, t.heights[gy * (SEG + 1) + gx]);
      }
      addSkirt(g, Math.min(350, Math.max(25, t.w * .08)));
      g.computeVertexNormals();
      let mat;
      if (GRID) {
        mat = curved(new THREE.MeshLambertMaterial({ color: t.z >= 14 ? 0x1d3a4d : 0x162d3c,
          transparent: true, opacity: 0.92, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }), coverage);
      } else if (!img) {
        mat = curved(new THREE.MeshLambertMaterial({ color: 0x5a6450 }), coverage);   // под Google 3D снимок не качаем
      } else {
        const tex = new THREE.Texture(img);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 8;
        tex.needsUpdate = true;
        mat = curved(new THREE.MeshLambertMaterial({ map: tex }), coverage);
      }
      t.mesh = new THREE.Mesh(g, mat);
      if (GRID && t.z >= 12) {           // у дальних тайлов сетка только мешает
        const wire = new THREE.Mesh(g, curved(fadingWire(new THREE.MeshBasicMaterial({ color: 0x4f8fb8, wireframe: true, transparent: true, opacity: 0.4 })), coverage));
        wire.matrixAutoUpdate = false;
        t.mesh.add(wire);
      }
      // Отсечение по кадру: сфера по плоской сетке, а шейдер опускает края на d²/2R — запас 10%
      g.computeBoundingSphere(); g.boundingSphere.radius *= 1.1;
      t.mesh.matrixAutoUpdate = false;
      t.mesh.renderOrder = -t.z;               // грубые тайлы рисуем первыми
      group.add(t.mesh);
      t.ready = true;
    } catch { t.retryAt = performance.now() + 5000; coverage.map.value.dispose(); }
    t.loading = false; loading--;
  }

  // высота рельефа в точке тайла (билинейно)
  function heightIn(t, lat, lon) {
    if (!t?.heights) return 0;
    const u = (lon - t.lon0) / (t.lon1 - t.lon0) * SEG;
    const v = (t.lat1 - lat) / (t.lat1 - t.lat0) * SEG;
    const x0 = Math.max(0, Math.min(SEG - 1, Math.floor(u))), y0 = Math.max(0, Math.min(SEG - 1, Math.floor(v)));
    const fx = u - x0, fy = v - y0, n = SEG + 1;
    const h = t.heights;
    return (h[y0 * n + x0] * (1 - fx) + h[y0 * n + x0 + 1] * fx) * (1 - fy)
         + (h[(y0 + 1) * n + x0] * (1 - fx) + h[(y0 + 1) * n + x0 + 1] * fx) * fy;
  }

  // Тайл, который реально содержит точку. Раньше высота бралась из «текущего» тайла под игроком —
  // после телепорта он оставался старым, и рельеф выдавал ерунду (403 м вместо 228).
  function tileWith(lat, lon) {
    let best = null;
    for (const t of tiles.values()) {
      if (!t.ready || lat < t.lat0 || lat > t.lat1 || lon < t.lon0 || lon > t.lon1) continue;
      if (!best || t.z > best.z) best = t;
    }
    return best;
  }

  return {
    group,
    // высота земли в точке (м над уровнем моря)
    ground(lat, lon) {
      const t = tileWith(lat, lon) || (near && near.ready ? near : null);
      return t ? heightIn(t, lat, lon) - SINK(t.z) : 0;
    },
    // то же + зум тайла, по которому посчитано (−1 — рельеф здесь ещё не загружен)
    groundAt(lat, lon) {
      const t = tileWith(lat, lon);
      return t ? [heightIn(t, lat, lon) - SINK(t.z), t.z] : [0, -1];
    },
    update(p, dt, budget = 2) {
      clock = performance.now();
      // Above local coverage the globe supplies the surface. Keep cached height
      // data for physics, but stop tile requests and coverage rebuilding entirely.
      group.visible = p.alt < (terrainOpts.globe ? 30_000 : 45_000);
      if (!group.visible) return { tiles: tiles.size, loading, shown: 0, edge: EDGE.value };
      // какие тайлы нужны
      const want = new Set();
      for (const [z, rad] of RINGS) {
        if (mobile && z === 18) continue;
        const cx = Math.floor(lon2x(p.lon, z)), cy = Math.floor(lat2y(p.lat, z));
        // высоко подробные тайлы не нужны — там всё равно видно только общий план
        if (p.alt - (near?.ready ? heightIn(near, p.lat, p.lon) : 0) > 600 && z >= 17) continue;
        if (p.alt > 2_500 && z >= 16) continue;
        if (p.alt > 9_000 && z >= 14) continue;
        if (p.alt > 40_000 && z >= 12) continue;
        if (p.alt > 150_000 && z >= 10) continue;
        for (let dx = -rad; dx <= rad; dx++) for (let dy = -rad; dy <= rad; dy++) {
          const x = cx + dx, y = cy + dy, n = 2 ** z;
          if (y < 0 || y >= n) continue;
          const t = make(z, ((x % n) + n) % n, y);
          // очередь: сначала клетка под игроком на всех зумах (грубые раньше — чтобы земля была сразу),
          // потом соседние кольца; подробные z17–18 — после z16
          t.pri = Math.max(Math.abs(dx), Math.abs(dy)) * 100 + (z >= 17 ? 40 + z : z);
          want.add(t.key); t.lastWanted = clock;
        }
      }
      // строим по чуть-чуть, чтобы не было фризов
      // Rebuild from demand: an unloaded tile dropped during a flyby must queue again on return.
      queue = [...tiles.values()].filter(t => want.has(t.key) && !t.ready && !t.loading && !(t.retryAt > clock));
      queue.sort((a, b) => a.pri - b.pri);
      while (loading < budget && queue.length) build(queue.shift());

      // ставим на места: тайл стоит по своим координатам, игрок — в нуле
      // радиус сплошного покрытия каждого зума: до ближайшей незагруженной клетки
      const cover = new Map();
      for (const [z, rad] of RINGS) cover.set(z, coverRadius(tiles, z, rad, p, want));
      EDGE.value = Math.max(2000, ...cover.values()) * 0.98;   // круглый край сплошного покрытия
      const af = Math.min(1, Math.max(0, (p.alt - 15_000) / 25_000));
      ALTFADE.value = terrainOpts.globe ? 0 : af * af * (3 - 2 * af);
      group.visible = p.alt < (terrainOpts.globe ? 30_000 : 45_000);
      near = null; let bestZ = -1;
      const mLat = metersPerLat(), mLon = metersPerLon(p.lat);
      // Keep recent coverage while the next ring loads. Only READY children cut holes in parents.
      const active = [...tiles.values()].filter(t => t.ready && (want.has(t.key) || clock - t.lastWanted < 8000)).sort((a, b) => a.z - b.z);
      const activeSet = new Set(active);
      for (const t of tiles.values()) if (t.ready && !activeSet.has(t)) t.mesh.visible = false;
      for (const t of active) {
        const cLat = (t.lat0 + t.lat1) / 2, cLon = (t.lon0 + t.lon1) / 2;
        const east = (cLon - p.lon) * mLon, north = (cLat - p.lat) * mLat;
        const d = Math.hypot(east, north);
        const descendants = [];
        for (const child of active) {
          if (child.z <= t.z) continue;
          const k = 2 ** (child.z - t.z);
          if (Math.floor(child.x / k) !== t.x || Math.floor(child.y / k) !== t.y) continue;
          // A ready intermediate tile already masks all of its own descendants.
          if (descendants.some(parent => {
            const scale = 2 ** (child.z - parent.z);
            return Math.floor(child.x / scale) === parent.x && Math.floor(child.y / scale) === parent.y;
          })) continue;
          descendants.push(child);
        }
        const signature = descendants.map(child => child.key).join('|');
        if (t.coverage.signature !== signature) {
          const width = Math.max(1, descendants.length), data = new Float32Array(width * 4);
          descendants.forEach((child, i) => data.set([
            (child.lon0 - t.lon0) / (t.lon1 - t.lon0), (child.lat0 - t.lat0) / (t.lat1 - t.lat0),
            (child.lon1 - t.lon0) / (t.lon1 - t.lon0), (child.lat1 - t.lat0) / (t.lat1 - t.lat0),
          ], i * 4));
          const map = new THREE.DataTexture(data, width, 1, THREE.RGBAFormat, THREE.FloatType);
          map.needsUpdate = true;
          t.coverage.map.value.dispose(); t.coverage.map.value = map;
          t.coverage.width.value = width; t.coverage.count.value = descendants.length;
          t.coverage.signature = signature;
        }
        t.mesh.visible = true;
        // кривизна: далёкий край проседает
        t.mesh.position.set(east, -p.alt - SINK(t.z), -north);   // кривизна — в шейдере по вершинам
        // Одна проекция для всего — от точки под игроком: по востоку метров на градус как на широте
        // игрока. Сетка тайла построена по его средней широте — растягиваем по X. Раньше снимок внутри
        // тайла сдвигался до метров (у крупных тайлов больше), а соседние тайлы расходились щелями.
        t.mesh.scale.x = mLon / metersPerLon(cLat);
        t.mesh.updateMatrix();
        if (t.z > bestZ && p.lat >= t.lat0 && p.lat <= t.lat1 && p.lon >= t.lon0 && p.lon <= t.lon1) { near = t; bestZ = t.z; }
      }
      // подробные тайлы поверх грубых
      for (const t of tiles.values()) if (t.ready && t.mesh.visible) t.mesh.renderOrder = t.z;
      let shown = 0;
      for (const t of tiles.values()) if (t.ready && t.mesh.visible) shown++;
      return { tiles: tiles.size, loading, shown, edge: EDGE.value };
    },
  };
}
