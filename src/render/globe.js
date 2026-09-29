// ЗЕМЛЯ ИЗ КОСМОСА: шар WGS84 со снимком всей планеты (ESRI World Imagery, зум 3 — 8×8 тайлов,
// склеены в холст 2048×2048 в проекции Меркатора). Вершины заданы прямо в ECEF, а в сцену шар
// ставится обратной матрицей takram (сцена → ECEF): совпадает с атмосферой, облаками и звёздами.
// Выше ~18 км он заменяет наш рельеф (тот рассчитан на плоскую раскладку тайлов и за сотни км
// расходится щелями); атмосфера takram накладывает на шар дымку и синеву сама.
import * as THREE from 'three';

const IMG = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const Z = 3, N = 2 ** Z, TILE = 256;
const A = 6_378_137, E2 = 0.00669437999014;          // WGS84: большая полуось и эксцентриситет²
const MAX_LAT = 85.0511;                              // предел проекции Меркатора

export function createGlobe(scene, mobile) {
  const seg = mobile ? [128, 64] : [256, 128];
  const [W, H] = seg;
  const pos = new Float32Array((W + 1) * (H + 1) * 3), nrm = new Float32Array(pos.length), uv = new Float32Array((W + 1) * (H + 1) * 2);
  const idx = [];
  for (let j = 0; j <= H; j++) {
    const lat = 90 - (180 * j) / H, phi = THREE.MathUtils.degToRad(lat);
    const ml = THREE.MathUtils.degToRad(Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)));
    const v = 1 - (1 - Math.log(Math.tan(Math.PI / 4 + ml / 2)) / Math.PI) / 2;   // 1 — север (flipY)
    const s = Math.sin(phi), c = Math.cos(phi), Nr = A / Math.sqrt(1 - E2 * s * s);
    for (let i = 0; i <= W; i++) {
      const lon = -180 + (360 * i) / W, lam = THREE.MathUtils.degToRad(lon);
      const k = j * (W + 1) + i;
      pos[k * 3] = Nr * c * Math.cos(lam); pos[k * 3 + 1] = Nr * c * Math.sin(lam); pos[k * 3 + 2] = Nr * (1 - E2) * s;
      nrm[k * 3] = c * Math.cos(lam); nrm[k * 3 + 1] = c * Math.sin(lam); nrm[k * 3 + 2] = s;
      uv[k * 2] = i / W; uv[k * 2 + 1] = v;
    }
  }
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const a = j * (W + 1) + i, b = a + W + 1;
    idx.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);

  // снимок: пока тайлы грузятся — ровный цвет океана/суши
  const cv = document.createElement('canvas');
  cv.width = cv.height = N * TILE;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#1d3552'; ctx.fillRect(0, 0, cv.width, cv.height);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => { ctx.drawImage(im, x * TILE, y * TILE); tex.needsUpdate = true; };
    im.src = IMG(Z, x, y);
  }

  const mesh = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ map: tex }));
  mesh.matrixAutoUpdate = false;
  mesh.frustumCulled = false;
  mesh.userData.perfCat = 'земной шар';
  mesh.userData.noCast = true;
  mesh.visible = false;
  scene.add(mesh);
  return {
    mesh,
    // ecefToScene — обратная матрица «сцена → ECEF»; alt — высота героя
    update(ecefToScene, alt) {
      mesh.visible = alt > 18_000;
      if (mesh.visible) { mesh.matrix.copy(ecefToScene); mesh.matrixWorldNeedsUpdate = true; }
    },
  };
}
