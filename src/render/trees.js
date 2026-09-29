// ДЕРЕВЬЯ ПО ДАННЫМ OSM: леса и парки засажены плотно, газоны — редко, отдельные деревья стоят
// точно по точкам natural=tree, ряды — вдоль линий через 8 м. Внутри контуров домов деревьев нет,
// в заливке участков — ни на дорожках и дорогах, ни на площадках, воде и фонтанах (paths/holes).
//
// Бюджет: ≤ 3 вызова отрисовки и ≤ ~150k треугольников. Три InstancedMesh:
//   ближние (< 500 м) лиственные — ствол + 2 сплющенных икосаэдра кроны;
//   ближние хвойные — ствол + 3 конуса;
//   дальние (500 м … 2.5 км) — одна грубая крона-октаэдр, прорежены как (500/d)² и укрупнены,
//   чтобы лес издали не редел.
// Набор пересобирается, только когда герой сдвинулся на 60 м (перебор сотен тысяч точек — не каждый кадр);
// между пересборками группа просто едет вместе с городом (как кварталы в city.js).
// Координаты — локальные метры города (восток x, север z), как у домов; высота — земля тайла 400 м.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { roofIn } from '../core/colliders.js';

const TILE = 400;
const NEAR = 500, FAR = 2500, MAX_ABOVE = 1200;       // выше 1.2 км над землёй деревья не нужны — их видно на снимке
const CAP_NEAR = 7000, CAP_FAR = 9000;
const TRI_BUDGET = 135_000, TRI_MAX = 150_000;  // ближние — самые близкие, пока влезают; остальные уходят в дальние
const REBUILD = 60;

// тип: 0 — лиственное, 1 — хвойное; плотность — шаг сетки, м
const AREA = {
  wood: { step: 9, conifer: 0.35, scale: 1.1 },
  park: { step: 11, conifer: 0.15, scale: 1.0 },
  scrub: { step: 12, conifer: 0.05, scale: 0.55 },
  grass: { step: 26, conifer: 0.1, scale: 0.9 },
};

function hash(x, z, k = 0) {
  let h = Math.imul((x * 73.13) | 0, 0x27d4eb2d) ^ Math.imul((z * 91.7) | 0, 0x165667b1) ^ Math.imul(k + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b); h ^= h >>> 13;
  return ((h >>> 0) % 100000) / 100000;
}

function inside(p, x, z) {
  let on = false;
  const n = p.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) on = !on;
  }
  return on;
}

// Просветы в зелени: дорожки и дороги (полоса ширины w + 0.8 м на крону), площадки, вода, фонтаны.
// Сетка 25 м: в клетке — отрезки и многоугольники, которые её задевают.
function gaps(data) {
  const C = 25, cells = new Map();
  const add = (x0, x1, z0, z1, item) => {
    for (let gx = Math.floor(x0 / C); gx <= Math.floor(x1 / C); gx++)
      for (let gz = Math.floor(z0 / C); gz <= Math.floor(z1 / C); gz++) {
        const k = gx * 65536 + gz;
        let l = cells.get(k); if (!l) cells.set(k, (l = [])); l.push(item);
      }
  };
  for (const pth of data.paths || []) {
    const r = pth[0] / 2 + 0.8;
    for (let i = 1; i + 3 < pth.length; i += 2) {
      const ax = pth[i], az = pth[i + 1], bx = pth[i + 2], bz = pth[i + 3];
      add(Math.min(ax, bx) - r, Math.max(ax, bx) + r, Math.min(az, bz) - r, Math.max(az, bz) + r, [ax, az, bx, bz, r]);
    }
  }
  for (const h of data.holes || []) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < h.length; i += 2) { x0 = Math.min(x0, h[i]); x1 = Math.max(x1, h[i]); z0 = Math.min(z0, h[i + 1]); z1 = Math.max(z1, h[i + 1]); }
    add(x0, x1, z0, z1, h);
  }
  return (x, z) => {
    const l = cells.get(Math.floor(x / C) * 65536 + Math.floor(z / C));
    if (!l) return false;
    for (const it of l) {
      if (it.length === 5) {
        const [ax, az, bx, bz, r] = it, ux = bx - ax, uz = bz - az;
        const t = Math.max(0, Math.min(1, ((x - ax) * ux + (z - az) * uz) / (ux * ux + uz * uz || 1)));
        if (Math.hypot(x - ax - ux * t, z - az - uz * t) < r) return true;
      } else if (inside(it, x, z)) return true;
    }
    return false;
  };
}

// вершинные цвета: ствол коричневый, крона — белая (цвет кроны даёт instanceColor)
function paint(g, rgb) {
  const n = g.attributes.position.count, c = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) c.set(rgb, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g.index ? g.toNonIndexed() : g;
}
const TRUNK = [0.36, 0.27, 0.2];
function deciduousGeo() {
  const trunk = paint(new THREE.CylinderGeometry(0.14, 0.22, 5, 4, 1, true).translate(0, 0.5, 0), TRUNK);   // ствол уходит на 2 м в землю
  const a = paint(new THREE.IcosahedronGeometry(2.3, 0).scale(1, 0.8, 1).translate(0, 4.4, 0), [1, 1, 1]);
  const b = paint(new THREE.IcosahedronGeometry(1.7, 0).scale(1, 0.85, 1).translate(0.6, 5.8, 0.3), [1, 1, 1]);
  return mergeGeometries([trunk, a, b]);
}
function coniferGeo() {
  const trunk = paint(new THREE.CylinderGeometry(0.12, 0.2, 4, 4, 1, true), TRUNK);
  const cone = (r, h, y) => paint(new THREE.ConeGeometry(r, h, 7, 1, true).translate(0, y, 0), [1, 1, 1]);
  return mergeGeometries([trunk, cone(2.0, 3.6, 3.2), cone(1.6, 3.2, 5.0), cone(1.1, 2.8, 6.8)]);
}
function farGeo() {
  const trunk = paint(new THREE.CylinderGeometry(0.2, 0.25, 4, 3, 1, true).translate(0, 0.5, 0), TRUNK);
  return mergeGeometries([trunk, paint(new THREE.OctahedronGeometry(2.4, 0).scale(1, 1.1, 1).translate(0, 4.6, 0), [1, 1, 1])]);
}

// оттенки крон: лиственные — от салатового до тёмно-зелёного, хвойные — сизо-тёмные
const LEAF = [new THREE.Color(0x5f8a3a), new THREE.Color(0x4d7a33), new THREE.Color(0x6e9443), new THREE.Color(0x3f6b2e)];
const NEEDLE = [new THREE.Color(0x2f5a3a), new THREE.Color(0x284f36), new THREE.Color(0x355f40)];

export function createTrees(scene) {
  const group = new THREE.Group();
  group.userData.perfCat = 'деревья';
  scene.add(group);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const make = (geo, cap, cast) => {
    const m = new THREE.InstancedMesh(geo, mat, cap);
    m.count = 0; m.frustumCulled = false; m.castShadow = cast; m.receiveShadow = true;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.setColorAt(0, LEAF[0]);
    group.add(m);
    return m;
  };
  const nearD = make(deciduousGeo(), CAP_NEAR, true);
  const nearC = make(coniferGeo(), CAP_NEAR, true);
  const far = make(farGeo(), CAP_FAR, false);
  far.userData.noCast = true;
  const TRI = [nearD, nearC, far].map((m) => m.geometry.attributes.position.count / 3);
  group.visible = false;

  const cities = new Map();                           // city → { tiles: Map(key → {x,z, t:Float32Array}), stats }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), sc = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  let last = null, lastCity = null, coarse = false, builtAt = 0, buildMs = 0;

  // Расстановка: [x, z, масштаб, тип, поворот, оттенок] по тайлам города
  function load(city, data) {
    const tiles = new Map();
    const stats = { wood: 0, park: 0, scrub: 0, grass: 0, tree: 0, row: 0, conifer: 0, skippedInHouse: 0, skippedOnPath: 0 };
    const put = (x, z, s, type, src) => {
      if (city.colliders && roofIn(city, x, z) > 0) { stats.skippedInHouse++; return; }
      const key = `${Math.floor(x / TILE)},${Math.floor(z / TILE)}`;
      let t = tiles.get(key);
      if (!t) tiles.set(key, (t = { x: Math.floor(x / TILE) * TILE + TILE / 2, z: Math.floor(z / TILE) * TILE + TILE / 2, list: [] }));
      t.list.push(x, z, s, type, hash(x, z, 3) * Math.PI * 2, hash(x, z, 4));
      stats[src]++; if (type === 1) stats.conifer++;
    };
    const gap = gaps(data);
    for (const a of data.areas || []) {
      const A = AREA[a.k] || AREA.grass;
      const p = a.p;
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i < p.length; i += 2) { x0 = Math.min(x0, p[i]); x1 = Math.max(x1, p[i]); z0 = Math.min(z0, p[i + 1]); z1 = Math.max(z1, p[i + 1]); }
      // сетка привязана к мировым координатам — у соседних участков нет «швов»
      for (let gx = Math.floor(x0 / A.step) * A.step; gx <= x1; gx += A.step)
        for (let gz = Math.floor(z0 / A.step) * A.step; gz <= z1; gz += A.step) {
          const r = hash(gx, gz, 1);
          if (a.k === 'grass' && r < 0.45) continue;       // газон — пятнами
          const x = gx + (hash(gx, gz, 2) - 0.5) * A.step * 0.9, z = gz + (r - 0.5) * A.step * 0.9;
          if (!inside(p, x, z)) continue;
          if (gap(x, z)) { stats.skippedOnPath++; continue; }
          put(x, z, A.scale * (0.7 + 0.7 * hash(x, z, 5)), hash(x, z, 6) < A.conifer ? 1 : 0, a.k);
        }
    }
    const tr = data.trees || [];
    for (let i = 0; i < tr.length; i += 2) put(tr[i], tr[i + 1], 0.75 + 0.6 * hash(tr[i], tr[i + 1], 5), hash(tr[i], tr[i + 1], 6) < 0.1 ? 1 : 0, 'tree');
    for (const row of data.rows || []) {
      for (let i = 0; i + 3 < row.length; i += 2) {
        const ax = row[i], az = row[i + 1], bx = row[i + 2], bz = row[i + 3];
        const L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 8));
        for (let k = 0; k < n; k++) { const t = k / n; put(ax + (bx - ax) * t, az + (bz - az) * t, 0.8 + 0.4 * hash(ax + k, az, 5), 0, 'row'); }
      }
    }
    for (const t of tiles.values()) t.list = new Float32Array(t.list);
    cities.set(city, { tiles, stats });
    last = null;
    return stats;
  }

  function rebuild(c, city, entry, kx) {
    const [east, north] = city._off;
    // герой в координатах города: смещение центра города со знаком минус (и поправка проекции)
    const hx = -east / kx, hz = -north;
    let nD = 0, nC = 0, nF = 0;
    let coarse = false;
    const at = (x, z, y) => { if (!city.groundAt) return y; const [h, zm] = city.groundAt(x, z); if (zm < 16) coarse = true; return zm >= 0 ? h : y; };
    const near = [];                                  // [d, x, y, z, s, type, rot, tint] — ставим после сортировки по дальности
    const farPut = (x, y, z, s, rot, col, d) => {
      const keep = (NEAR / d) ** 2;
      if (hash(x, z, 8) > keep || nF >= CAP_FAR) return;
      q.setFromAxisAngle(up, rot);
      m4.compose(v.set(x, y, -z), q, sc.setScalar(s * Math.min(2.2, Math.sqrt(1 / keep))));
      far.setMatrixAt(nF, m4); far.setColorAt(nF, col);
      nF++;
    };
    const tint = (x, z, type, t) => {
      const pal = type === 1 ? NEEDLE : LEAF;
      return col.copy(pal[Math.floor(t * pal.length) % pal.length]).multiplyScalar(0.85 + 0.3 * hash(x, z, 7));
    };
    for (const t of entry.tiles.values()) {
      const dt = Math.hypot(t.x - hx, t.z - hz);
      if (dt > FAR + TILE) continue;
      if (t.base === undefined || (t.baseZ < 16 && Math.random() < 0.2)) {
        const [h, z] = city.groundAt ? city.groundAt(t.x, t.z) : [0, -1];
        if (z >= (t.baseZ ?? -1)) { t.base = h; t.baseZ = z; }
      }
      const y = t.base || 0, L = t.list;
      for (let i = 0; i < L.length; i += 6) {
        const x = L[i], z = L[i + 1];
        const d = Math.hypot(x - hx, z - hz);
        if (d > FAR) continue;
        if (d >= NEAR && hash(x, z, 8) > (NEAR / d) ** 2) continue;     // прорежено — землю не считаем
        // земля под самим деревом: на склонах к реке центр тайла 400 м ошибается на 20 м
        const yy = at(x, z, y);
        if (d < NEAR) near.push([d, x, yy, z, L[i + 2], L[i + 3], L[i + 4], L[i + 5]]);
        else farPut(x, yy, z, L[i + 2], L[i + 4], tint(x, z, L[i + 3], L[i + 5]), d);
      }
    }
    near.sort((a, b) => a[0] - b[0]);
    const triD = TRI[0], triC = TRI[1];
    let tris = nF * TRI[2];
    for (const [d, x, y, z, s, type, rot, t] of near) {
      const cost = type === 1 ? triC : triD;
      const n = type === 1 ? nC : nD;
      if (tris + cost > TRI_BUDGET || n >= CAP_NEAR) {
        // не влезло — грубой кроной, пока есть запас до потолка 150k
        if (tris + TRI[2] <= TRI_MAX) { const f0 = nF; farPut(x, y, z, s, rot, tint(x, z, type, t), NEAR); tris += (nF - f0) * TRI[2]; }
        continue;
      }
      const m = type === 1 ? nearC : nearD;
      q.setFromAxisAngle(up, rot);
      m4.compose(v.set(x, y, -z), q, sc.setScalar(s));
      m.setMatrixAt(n, m4); m.setColorAt(n, tint(x, z, type, t));
      if (type === 1) nC++; else nD++;
      tris += cost;
    }
    for (const [m, n] of [[nearD, nD], [nearC, nC], [far, nF]]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    return { nD, nC, nF, coarse };
  }

  return {
    group,
    get counts() { return { near: nearD.count + nearC.count, far: far.count, ms: +buildMs.toFixed(1) }; },
    statsOf: (city) => cities.get(city)?.stats,
    load,
    // c — герой; city — ближайший город (у него _off, groundAt — их ставит world.sync)
    update(c, city, above) {
      const entry = city && cities.get(city);
      if (!entry || !city._off || above > MAX_ABOVE) { group.visible = false; return; }
      const kx = city._kx || 1;
      const [east, north] = city._off;
      // рельеф под частью деревьев ещё грубый — раз в секунду переставляем, пока не догрузится
      const now = performance.now();
      if (!last || lastCity !== city || Math.hypot(last[0] - east, last[1] - north) > REBUILD || (coarse && now - builtAt > 1000)) {
        const t0 = performance.now();
        coarse = rebuild(c, city, entry, kx).coarse;
        buildMs = performance.now() - t0;
        last = [east, north]; lastCity = city; builtAt = now;
      }
      group.visible = true;
      group.position.set(east, -c.alt, -north);          // как кварталы: смещение центра города, высоты — свои
      group.scale.set(kx, 1, 1);
    },
  };
}
