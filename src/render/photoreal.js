// ФОТОРЕАЛИСТИЧНАЯ ЗЕМЛЯ: Google Photorealistic 3D Tiles (весь мир — дома, деревья, рельеф одной
// сеткой по аэросъёмке) через 3DTilesRendererJS. Включается ключом Google Maps Platform с включённым
// Map Tiles API: `VITE_GOOGLE_MAPS_KEY` в .env.local или `?gkey=...` в адресе. Без ключа — наши
// рельеф ESRI + дома OSM, как раньше.
//
// Тайлы лежат в ECEF — ставим их в сцену обратной матрицей takram (сцена → ECEF), как шар globe.js.
// Текстуры тайлов уже содержат освещение съёмки, поэтому материал — MeshBasic (без нашего света),
// а цвет приглушаем на экспозицию атмосферы, иначе ×6 пересвечивает. Дымку и синеву даёт takram.
//
// Высоты у Google — над эллипсоидом WGS84, у нас (рельеф terrarium) — над уровнем моря: в Москве
// разница ≈ высота геоида. Калибруем сами: лучом вниз там, где по OSM нет дома, сравниваем
// поверхность тайлов с нашей землёй и сдвигаем тайлы на медиану разницы — ноги на асфальте.
//
// Физика и столкновения остаются на наших данных (рельеф + контуры OSM); наши дома OSM рисуются
// поверх земли Google — прячется только наш рельеф (world.visual).
// Условия Google: логотип и атрибуции на экране обязательны, кэшировать тайлы нельзя.
import * as THREE from 'three';
import { TilesRenderer } from '3d-tiles-renderer';
import { GoogleCloudAuthPlugin } from '3d-tiles-renderer/core/plugins';
import { GLTFExtensionsPlugin, TileCompressionPlugin, TilesFadePlugin } from '3d-tiles-renderer/three/plugins';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';

// Ключ из .env.local — только в dev: иначе Vite вшивает его в боевой бандл и он виден всем по ссылке.
// На проде — только ?gkey= у того, кто его знает.
export const GKEY = new URLSearchParams(location.search).get('gkey') || (import.meta.env.DEV ? import.meta.env.VITE_GOOGLE_MAPS_KEY : '') || '';
// Только по явному ?photo=1: в Москве у Google нет объёмных домов (проверено лучом по МГУ — ровная
// поверхность 214 м, это спутниковый снимок на рельефе), а каждый запуск — платный сеанс.
export const PHOTOREAL = !!GKEY && new URLSearchParams(location.search).get('photo') === '1';

export function createPhotoreal(scene, camera, renderer, { gain = 1, mobile = false } = {}) {
  const tiles = new TilesRenderer();
  tiles.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: GKEY, autoRefreshToken: true }));
  const draco = new DRACOLoader().setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.7/');
  tiles.registerPlugin(new GLTFExtensionsPlugin({ dracoLoader: draco }));
  tiles.registerPlugin(new TileCompressionPlugin());
  tiles.registerPlugin(new TilesFadePlugin());
  tiles.errorTarget = mobile ? 40 : 20;                        // пиксели ошибки: меньше — подробнее и тяжелее
  tiles.group.matrixAutoUpdate = false;
  tiles.group.userData.perfCat = 'google 3D';
  tiles.group.userData.noCast = true;
  scene.add(tiles.group);
  tiles.setCamera(camera);
  tiles.setResolutionFromRenderer(camera, renderer);
  addEventListener('resize', () => tiles.setResolutionFromRenderer(camera, renderer));

  let loaded = 0, failed = '';
  tiles.addEventListener('load-model', ({ scene: s }) => {
    loaded++;
    s.traverse((o) => {
      if (!o.isMesh) return;
      const old = o.material;
      o.material = new THREE.MeshBasicMaterial({ map: old.map, color: new THREE.Color().setScalar(gain) });
      old.dispose();
    });
  });
  tiles.addEventListener('load-error', (e) => { failed = String(e.error?.message || e.error || 'ошибка'); });

  // атрибуции — обязательны: логотип Google и правообладатели съёмки видимых тайлов
  const box = document.createElement('div');
  box.id = 'gattr';
  box.style.cssText = 'position:fixed;left:10px;bottom:8px;z-index:20;font:10px/1.3 system-ui,sans-serif;color:#fff;'
    + 'text-shadow:0 0 3px #000;pointer-events:none;max-width:60vw;display:flex;gap:6px;align-items:center';
  document.body.appendChild(box);
  let attrT = 0;

  // калибровка высоты: геоид + расхождение рельефов
  const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), from = new THREE.Vector3();
  const samples = [];
  let offset = 0, calT = 0;
  const shift = new THREE.Matrix4();

  return {
    tiles,
    get offset() { return offset; },
    get ready() { return loaded > 0; },
    get error() { return failed; },
    // ecefToScene — обратная матрица takram; alt — высота героя; groundHere — наша земля под героем
    // (над морем), roofHere — есть ли по OSM дом под героем (там не калибруем)
    update(ecefToScene, now, groundHere, roofHere, alt) {
      tiles.group.matrix.copy(ecefToScene).premultiply(shift.makeTranslation(0, -offset, 0));
      tiles.group.updateMatrixWorld(true);                        // до tiles.update(): отсечение по кадру
      camera.updateMatrixWorld();
      tiles.update();

      if (loaded && !roofHere && alt - groundHere < 3000 && now - calT > 1) {
        calT = now;
        from.set(0, Math.max(50, alt - groundHere + 50), 0);          // над героем, ноль сцены — ноги
        ray.set(from, down);
        ray.far = from.y + 400;
        ray.firstHitOnly = true;
        const hit = ray.intersectObject(tiles.group, true)[0];
        if (hit) {
          // поверхность тайлов (без сдвига) над морем в нашем счёте: alt + y точки + текущий сдвиг
          const surf = alt + hit.point.y + offset;
          const d = surf - groundHere;
          if (Math.abs(d) < 80) { samples.push(d); if (samples.length > 31) samples.shift(); }
          const sorted = [...samples].sort((a, b) => a - b);
          if (sorted.length >= 3) offset = sorted[sorted.length >> 1];
        }
      }

      if (now - attrT > 1) {
        attrT = now;
        // строки правообладателей приходят из сети — только как текст
        box.replaceChildren();
        const logo = document.createElement('b'); logo.textContent = 'Google'; box.append(logo);
        for (const a of tiles.getAttributions()) {
          if (a.type === 'image') { const im = new Image(); im.src = a.value; im.style.height = '14px'; box.append(im); }
          else { const sp = document.createElement('span'); sp.textContent = a.value; box.append(sp); }
        }
      }
    },
  };
}
