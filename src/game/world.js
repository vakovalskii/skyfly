// МИР: неподвижная Земля (рельеф + снимки) и города на ней.
// Наружу отдаёт ровно то, что нужно физике: floorAt(восток, север) — высота опоры,
// move(lat, lon, восток, север) — перенос по поверхности шара.
import * as THREE from 'three';
import { R, offsetGeo, offsetTo, fromLocal, toLocal, curvatureDrop, metersPerLon } from '../core/grid.js';
import { roofAround, buildColliders, addColliders, slideMove, STEP_UP, crownBox } from '../core/colliders.js';
import { buildCity, updateCity, FAR, markLandmark, cityNight, addBuildings, invalidateTile, buildingKey } from '../render/city.js';
import { createLandmark } from '../render/landmark.js';
import { createTerrain } from '../render/terrain.js';
import { createTrees } from '../render/trees.js';
import { groundTex } from '../render/tex.js';
import { GRID, wire as fadingWire } from '../render/style.js';
import { say } from './hud.js';
import { CITIES_GEO } from '../core/cities.js';
export { CITIES_GEO } from '../core/cities.js';


export function createWorld(scene, mobile) {
  const group = new THREE.Group();
  scene.add(group);
  const terrain = createTerrain(scene, mobile);
  const trees = createTrees(scene);      // деревья по OSM (data/<город>-green.json), если файл есть
  terrain.group.userData.perfCat = 'рельеф';
  terrain.group.userData.noCast = true;   // плоский рельеф в карты теней не пускаем: дорого и даёт «рябь»
  const cities = [];
  let here = { lat: 0, lon: 0 };        // где игрок в этом кадре (для floorAt)
  let landmark = null;                 // стартовая башня (landmark.js)

  // Подложка на время загрузки тайлов: диск с кривизной.
  const geo = new THREE.CircleGeometry(30_000, mobile ? 48 : 72, 1);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, -curvatureDrop(Math.hypot(pos.getX(i), pos.getZ(i))));
    uv.setXY(i, pos.getX(i) / 2400, pos.getZ(i) / 2400);
  }
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, GRID
    ? fadingWire(new THREE.MeshBasicMaterial({ color: 0x1b3346, wireframe: true }))
    : new THREE.MeshLambertMaterial({ color: 0xffffff, map: groundTex(mobile ? 256 : 512) }));
  ground.frustumCulled = false;
  ground.userData.perfCat = 'подложка';
  group.add(ground);

  async function loadCity(id, base) {
    const existing = cities.find(city => city.id === id);
    if (existing) return existing;
    try {
      const res = await fetch(`${base}data/${id}.json`);
      if (!res.ok) throw new Error(res.status);
      const city = buildCity(await res.json());
      if (mobile) { city.renderNear = 2200; city.renderFar = 9000; }
      buildColliders(city);          // точные контуры для столкновений
      city.group.userData.perfCat = 'дома';
      city.water.userData.perfCat = 'вода';
      group.add(city.group);
      city.group.add(city.water);
      cities.push(city);
      say(`${city.name}: ${city.tiles.length} кварталов`);
      // кольцо вокруг центра — кусками 2×2 км по мере полёта (tools/fetch-osm.mjs moscow-ring)
      fetch(`${base}data/${id}-chunks/index.json`).then((r) => (r.ok ? r.json() : null)).then((ix) => {
        if (!ix) return;
        const S = ix.chunk || 2000;
        city.chunks = ix.chunks.filter((k) => !k.core).map((k) => {
          const [cx, cz] = k.key.split('_').map(Number);
          return { ...k, x: (cx + 0.5) * S, z: (cz + 0.5) * S, state: 0, url: `${base}data/${id}-chunks/${k.key}.json` };
        });
      }).catch(() => {});
      fetch(`${base}data/${id}-green.json`).then((r) => (r.ok ? r.json() : null)).then((g) => { if (g) trees.load(city, g); }).catch(() => {});
      return city;
    } catch (e) { say(`${id}: данные не загрузились (${e.message})`); }
  }

  // Подгрузка кусков: раз в секунду берём ближайшие незагруженные в радиусе дальности города
  // (не больше двух запросов сразу). Дома кладутся в кварталы, столкновения дописываются;
  // пограничные кварталы центра, куда добавились дома, пересобираются.
  let chunkT = 0, chunkBusy = 0;
  function streamChunks(city, x, z, now) {
    if (!city.chunks || now - chunkT < 1) return;
    chunkT = now;
    const R = (city.renderFar ?? FAR) + 3000;
    const todo = city.chunks.filter((k) => k.state === 0 && Math.hypot(k.x - x, k.z - z) < R)
      .sort((a, b) => Math.hypot(a.x - x, a.z - z) - Math.hypot(b.x - x, b.z - z));
    for (const k of todo) {
      if (chunkBusy >= 2) break;
      k.state = 1; chunkBusy++;
      fetch(k.url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status)))).then((d) => {
        const before = city.tiles.length;
        const { added, touched } = addBuildings(city, d.buildings || [], (b) => city.core.has(buildingKey(b)));
        addColliders(city, added);
        for (const t of touched) if (city.tiles.indexOf(t) < before) invalidateTile(city, t);
        k.state = 2; k.added = added.length;
        city.chunkStat = { loaded: city.chunks.filter((q) => q.state === 2).length, total: city.chunks.length };
      }).catch(() => { k.state = 3; }).finally(() => { chunkBusy--; });
    }
  }

  const api = {
    group, terrain, cities, loadCity, trees,
    visual: true,                    // false — землю рисует Google 3D, наш рельеф только для физики (дома OSM — как обычно)

    // ---- то, чем пользуется физика ----
    // высота опоры в точке (восток, север) от игрока: рельеф + крыши
    // Смещение города считаем от ТЕКУЩЕЙ позиции игрока, а не берём из sync(): внутри шага
    // физики игрок уже сдвинулся, и старое смещение уводило крыши на длину шага.
    floorAt(east = 0, north = 0) {
      const [lat, lon] = fromLocal(east, north, here.lat, here.lon);
      let roof = 0;
      const g = terrain.ground(lat, lon);
      for (const city of cities) {
        if (!city.colliders) continue;
        const [oe, on] = toLocal(city.lat, city.lon, here.lat, here.lon);
        const kx = metersPerLon(here.lat) / metersPerLon(city.lat);             // та же поправка проекции, что у картинки
        roof = Math.max(roof, roofAround(city, (east - oe) / kx, north - on, undefined, g));   // крыша — на земле квартала, как на экране
      }
      return g + roof;
    },
    move(lat, lon, east, north) { return offsetGeo(lat, lon, east, north); },

    // Шаг с учётом стен: возвращает [восток, север, упёрлись?]. Скольжение вдоль стены — внутри.
    tryMove(dEast, dNorth, feet, dUp = 0) {
      return slideMove((e, n) => api.floorAt(e, n), feet, dEast, dNorth, STEP_UP, dUp);
    },

    // ---- кадр ----
    sync(c, dt = 1 / 60) {
      here = c;
      const oldFloor = c.grounded ? api.floorAt(0, 0) : null;
      const supportedOnRoof = oldFloor !== null && Math.abs(c.alt - oldFloor) < .3
        && oldFloor > terrain.ground(c.lat, c.lon) + 1;
      let nearest = null, nearestD = Infinity;
      for (const city of cities) {
        const [east, north, d] = offsetTo(c, city);
        city._off = [east, north, d];
        if (d < nearestD) { nearestD = d; nearest = city; }
        const visible = c.alt < 30000 && d < FAR + 20_000;
        city.group.visible = visible;
        if (visible) {
          const above = c.alt - terrain.ground(c.lat, c.lon);
          city.groundAt ??= (x, z) => { const [lat, lon] = offsetGeo(city.lat, city.lon, x, z); return terrain.groundAt(lat, lon); };
          const kx = metersPerLon(c.lat) / metersPerLon(city.lat);
          streamChunks(city, -east / kx, -north, performance.now() / 1000);
          updateCity(city, east, north, city.group, mobile ? 1 : 3, above, city.groundAt, kx, dt);
          city.water.scale.x = kx;
          city._kx = kx;
          city.group.position.y = -c.alt;          // высоты кварталов — свои, над уровнем моря
          // вода — на самой низкой земле вокруг центра (река в низине), уточняем раз в пару секунд
          if (!city.waterZ || Math.random() < 0.01) {
            let lo = Infinity, zmin = 99;
            for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
              const [h, z] = city.groundAt(i * 1500, j * 1500);
              if (z >= 0) { lo = Math.min(lo, h); zmin = Math.min(zmin, z); }
            }
            if (lo < Infinity) { city.waterY = lo + 0.4; city.waterZ = zmin; }
          }
          city.water.position.set(east, city.waterY ?? 0, -north);
        }
      }
      if (supportedOnRoof) {
        c.alt += api.floorAt(0, 0) - oldFloor;
        for (const city of cities) city.group.position.y = -c.alt;
      }
      if (c.alt < 30000) landmark?.update(landmark.tile.mesh || landmark.tile.lodMesh, performance.now() / 1000, cityNight());
      trees.update(c, nearest, c.alt - terrain.ground(c.lat, c.lon));   // деревья — только у ближайшего города
      const tst = terrain.update(c, 0, mobile ? 2 : 4);
      api.terrainStat = tst;
      if (!api.visual) terrain.group.visible = false;
      const gh = terrain.ground(c.lat, c.lon);
      ground.position.y = gh - c.alt - 1;
      ground.visible = c.alt < 40_000 && tst.tiles < 4;
      return { nearest, nearestD, gh };
    },

    // ---- появление ----
    // Ставим героя на крышу дома рядом с центром города: сразу видно город и есть откуда прыгать.
    spawnOnRoof(c) {
      const city = cities.find(city => city.id === 'moscow');
      if (!city) return false;
      let best = null;
      for (const t of city.tiles) {
        if (Math.hypot(t.x, t.z) > 1500 || t.maxH < 25 || t.maxH > 90) continue;
        if (!best || t.maxH > best.maxH) best = t;
      }
      if (!best) return false;
      // встаём ровно на середину самого высокого дома квартала, иначе окажемся в воздухе рядом с ним
      const [lat, lon] = offsetGeo(city.lat, city.lon, best.topX, best.topZ);
      c.lat = lat; c.lon = lon;
      here = c;
      c._off = null;
      for (const cc of cities) { const o = offsetTo(c, cc); cc._off = o; }
      // проверяем, что под ногами действительно эта крыша (сетка строится по контуру дома)
      let h = api.floorAt(0, 0);
      if (Math.abs(h - (terrain.ground(lat, lon) + best.maxH)) > 2) {
        // центр дома мог не попасть в клетку — ищем ближайшую точку, где крыша на месте
        outer: for (let r = 5; r <= 40; r += 5) for (let a = 0; a < 8; a++) {
          const e = Math.cos(a * 0.785) * r, n = Math.sin(a * 0.785) * r;
          if (Math.abs(api.floorAt(e, n) - (terrain.ground(lat, lon) + best.maxH)) < 2) {
            const [l2, o2] = offsetGeo(lat, lon, e, n);
            c.lat = l2; c.lon = o2; here = c;
            for (const cc of cities) cc._off = offsetTo(c, cc);
            h = api.floorAt(0, 0);
            break outer;
          }
        }
      }
      // Стартовая башня (landmark.js). Если на крыше есть надстройка — встаём на неё: это самая
      // высокая точка, вид открыт во все стороны, а камера не упирается в стену надстройки.
      const b = landmark ? null : markLandmark(city, best);
      let spot = null, padPoly = b?.p;
      const cr = b && crownBox(b.p, b.h);
      if (cr) {
        const cx = (cr.p[0] + cr.p[4]) / 2, cz = (cr.p[1] + cr.p[5]) / 2;
        const [l3, o3] = offsetGeo(city.lat, city.lon, cx, cz);
        const keep = [c.lat, c.lon];
        c.lat = l3; c.lon = o3; here = c;
        for (const cc of cities) cc._off = offsetTo(c, cc);
        const hc = api.floorAt(0, 0);
        if (Math.abs(hc - (terrain.ground(l3, o3) + cr.h)) < 2) { h = hc; spot = [cx, cz, cr.h]; padPoly = cr.p; }
        else { [c.lat, c.lon] = keep; here = c; for (const cc of cities) cc._off = offsetTo(c, cc); }
      }
      c.alt = h;
      c.vel = [0, 0, 0]; c.grounded = true; c.mode = 'ground';
      c.yaw = Math.atan2(-best.topX, -best.topZ);
      if (b) {
        const [e, nn] = city._off;
        landmark = createLandmark(b, spot || [-e / (city._kx || 1), -nn, b.h], padPoly);
        landmark.tile = best;
        city.group.add(landmark.group);
      }
      say(`Крыша, ${Math.round(best.maxH)} м над городом. Прыгай.`);
      return true;
    },
  };
  return api;
}
