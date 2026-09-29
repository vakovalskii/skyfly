// ОБЛАКА — чтобы высоту было видно глазами, а проход сквозь облако — чувствовался.
//
// Ярусы (по классификации ВМО, высоты — средние широты):
//   кучевые (Cu)            1.5–2.5 км  ОБЪЁМНЫЕ: облако из мягких «клубов», сквозь него пролетаешь
//   кучево-дождевые (Cb)    1.5–11 км   редкие башни с наковальней — ориентир высоты издалека
//   высококучевые (Ac)      4.5 км      плоский слой мелких барашков
//   перистые (Ci)           9 км        тонкие полосы
//   (перламутровые 22 км и серебристые 82 км пробовали плоскими слоями — выглядели мусором: убраны)
//
// Объёмные облака — классический приём флайт-симуляторов: каждое облако — десяток клубов,
// каждый клуб — мягкий спрайт, всегда повёрнутый к камере (billboard). Все клубы рисуются
// одним InstancedMesh. Облака стоят в неподвижных клетках Земли (метры от Москвы) и медленно
// дрейфуют по ветру; набор пересобирается, когда улетели от центра набора на несколько км.
// Плоские ярусы — большие круги с шумом в шейдере. Всё гаснет к краю и тонет в дымке.
import * as THREE from 'three';
import { toLocal, R } from '../core/grid.js';

const ORIGIN = { lat: 55.752, lon: 37.6175 };
const WIND = [5, 1.5];                      // м/с — облака медленно плывут на восток

// ---------- детерминированный шум (одинаковый в JS и шейдере) ----------
const fract = (x) => x - Math.floor(x);
const hash2 = (x, y) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// ---------- объёмные: кучевые и кучево-дождевые ----------
const CU = { cell: 2600, cover: 0.38, base: 1500, radius: 34_000 };
const CB = { cell: 26_000, chance: 0.22 };

// мягкий клуб: радиальный спад + шум — текстура рисуется один раз на canvas
export function puffTexture() {
  const n = 128, cv = document.createElement('canvas');
  cv.width = cv.height = n;
  const g = cv.getContext('2d'), img = g.createImageData(n, n), r = rng(7);
  const bumps = Array.from({ length: 26 }, () => [r() * n, r() * n, 8 + r() * 26, r()]);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const dx = x / n - 0.5, dy = y / n - 0.5, d = Math.hypot(dx, dy) * 2;
    let a = Math.max(0, 1 - d); a = a * a * (3 - 2 * a);
    let b = 0;
    for (const [bx, by, br, bw] of bumps) b += Math.max(0, 1 - Math.hypot(x - bx, y - by) / br) * (0.4 + bw * 0.6);
    a *= 0.55 + Math.min(0.45, b * 0.35);
    const i = (y * n + x) * 4;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255; img.data[i + 3] = Math.round(a * 255);
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// облако как набор клубов: плоское дно, округлый верх. kind: 'cu' | 'cb'
function makeCloud(e, n, seed, kind, out) {
  const r = rng(seed);
  if (kind === 'cb') {
    // башня: ствол 1.5→9.5 км, наковальня 9.5–11 км шире ствола в 3 раза
    const w = 2500 + r() * 1500;
    for (let h = 1500; h < 9500; h += 700) {
      for (let k = 0; k < 5; k++) {
        const a = r() * 6.283, d = r() * w * 0.45;
        out.push({ x: e + Math.cos(a) * d, y: h + r() * 400, z: n + Math.sin(a) * d, s: 1300 + r() * 900, shade: (h - 1500) / 9500 });
      }
    }
    for (let k = 0; k < 26; k++) {
      const a = r() * 6.283, d = Math.sqrt(r()) * w * 1.6;
      out.push({ x: e + Math.cos(a) * d * 1.3, y: 9800 + r() * 900, z: n + Math.sin(a) * d, s: 1500 + r() * 1100, shade: 0.95 });
    }
    return { x: e, z: n, rx: w * 2.2, y0: 1500, y1: 11_000 };
  }
  const w = 500 + r() * 900, hgt = 350 + r() * 750, base = CU.base + (r() - 0.5) * 200;
  const count = 7 + Math.floor(w / 110);
  for (let k = 0; k < count; k++) {
    const a = r() * 6.283, d = Math.sqrt(r()) * w;
    const up = Math.sqrt(Math.max(0, 1 - (d / w) ** 2)) * hgt * (0.4 + r() * 0.6);   // купол
    const s = 260 + r() * 360 + (1 - d / w) * 220;
    out.push({ x: e + Math.cos(a) * d, y: base + s * 0.35 + up, z: n + Math.sin(a) * d * 0.8, s, shade: up / hgt });
  }
  return { x: e, z: n, rx: w + 400, y0: base - 50, y1: base + hgt + 500 };
}

const PUFF_V = `
attribute vec3 iPos; attribute vec2 iSize;      // iSize.x — диаметр, iSize.y — высота внутри облака 0..1
uniform float uR; uniform float uLit;
varying vec2 vUv; varying float vShade; varying float vDist; varying float vNear;
void main(){
  vec4 c = modelMatrix * vec4(iPos, 1.0);
  float d = length(c.xz);
  c.y -= d * d / (2.0 * uR);                        // кривизна
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float s = iSize.x;
  vec3 w = c.xyz + (right * position.x + up * position.y) * s;
  vUv = uv; vShade = iSize.y;
  vec4 v = viewMatrix * vec4(w, 1.0);
  vDist = -v.z;
  vNear = clamp((length(c.xyz - cameraPosition) - s * 0.15) / (s * 0.5), 0.0, 1.0);   // клуб вплотную — растворяем
  gl_Position = projectionMatrix * v;
}`;
const PUFF_F = `
precision highp float;
uniform sampler2D uMap; uniform vec3 uFog; uniform float uFogD; uniform float uLit; uniform float uFar;
varying vec2 vUv; varying float vShade; varying float vDist; varying float vNear;
void main(){
  float a = texture2D(uMap, vUv).a;
  // низ облака серый, верх белый на солнце; внутри клуба светлее к верхней кромке
  float lightY = clamp(vShade * 0.8 + (vUv.y - 0.3) * 0.5, 0.0, 1.0);
  vec3 col = mix(vec3(0.62, 0.66, 0.74), vec3(1.0, 0.99, 0.96), lightY) * (0.55 + 0.5 * uLit);
  float f = 1.0 - exp(-pow(vDist * uFogD, 2.0));
  col = mix(col, uFog, f);
  a *= vNear * (1.0 - smoothstep(uFar * 0.7, uFar, vDist));
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a * 0.9);
}`;

function createPuffs(scene, mobile) {
  const MAX = mobile ? 2500 : 6000;
  const base = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('uv', base.attributes.uv);
  const pos = new Float32Array(MAX * 3), size = new Float32Array(MAX * 2);
  const aPos = new THREE.InstancedBufferAttribute(pos, 3), aSize = new THREE.InstancedBufferAttribute(size, 2);
  aPos.setUsage(THREE.DynamicDrawUsage); aSize.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('iPos', aPos); geo.setAttribute('iSize', aSize);
  geo.instanceCount = 0;
  const u = {
    uMap: { value: puffTexture() }, uR: { value: R }, uLit: { value: 1 }, uFar: { value: CU.radius },
    uFog: { value: new THREE.Color() }, uFogD: { value: 1 / 30000 },
  };
  const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: PUFF_V, fragmentShader: PUFF_F, uniforms: u, transparent: true, depthWrite: false }));
  mesh.frustumCulled = false; mesh.renderOrder = 6;
  scene.add(mesh);

  let anchor = null, puffs = [], clouds = [];
  const radius = mobile ? 22_000 : CU.radius;

  function rebuild(e, n) {
    anchor = [e, n]; puffs = []; clouds = [];
    const cr = Math.ceil(radius / CU.cell);
    const cx0 = Math.floor(e / CU.cell), cz0 = Math.floor(n / CU.cell);
    for (let i = -cr; i <= cr; i++) for (let j = -cr; j <= cr; j++) {
      const cx = cx0 + i, cz = cz0 + j;
      if (hash2(cx, cz) > CU.cover) continue;
      const ce = (cx + 0.2 + hash2(cz, cx) * 0.6) * CU.cell, cn = (cz + 0.2 + hash2(cx + 7, cz) * 0.6) * CU.cell;
      if (Math.hypot(ce - e, cn - n) > radius) continue;
      clouds.push(makeCloud(ce, cn, (cx * 73856093) ^ (cz * 19349663), 'cu', puffs));
    }
    const br = Math.ceil(70_000 / CB.cell), bx0 = Math.floor(e / CB.cell), bz0 = Math.floor(n / CB.cell);
    for (let i = -br; i <= br; i++) for (let j = -br; j <= br; j++) {
      const cx = bx0 + i, cz = bz0 + j;
      if (hash2(cx + 101, cz - 57) > CB.chance) continue;
      const ce = (cx + 0.5) * CB.cell, cn = (cz + 0.5) * CB.cell;
      clouds.push(makeCloud(ce, cn, (cx * 19349663) ^ (cz * 83492791) ^ 0x5bd1e995, 'cb', puffs));
    }
    if (puffs.length > MAX) puffs.length = MAX;
    geo.instanceCount = puffs.length;
    writeOrder([0, 0, 0]);
  }
  // Прозрачные клубы должны рисоваться от дальних к ближним — сортируем изредка.
  function writeOrder(cam) {
    const d = puffs.map((p, i) => [i, (p.x - cam[0]) ** 2 + (p.y - cam[1]) ** 2 + (p.z - cam[2]) ** 2]);
    d.sort((a, b) => b[1] - a[1]);
    for (let k = 0; k < d.length; k++) {
      const p = puffs[d[k][0]];
      pos[k * 3] = p.x - anchor[0]; pos[k * 3 + 1] = p.y; pos[k * 3 + 2] = -(p.z - anchor[1]);
      size[k * 2] = p.s; size[k * 2 + 1] = p.shade;
    }
    aPos.needsUpdate = true; aSize.needsUpdate = true;
  }

  let frame = 0;
  return {
    hide() { mesh.visible = false; },
    // e, n — позиция игрока в неподвижных метрах, сдвинутая назад на дрейф ветра
    update(e, n, alt, lit, fog) {
      if (!anchor || Math.hypot(e - anchor[0], n - anchor[1]) > 7000) rebuild(e, n);
      mesh.position.set(anchor[0] - e, -alt, -(anchor[1] - n));
      mesh.visible = alt < 40_000;
      u.uLit.value = lit;
      u.uFog.value.copy(fog.color); u.uFogD.value = fog.density;
      if (++frame % 20 === 0) writeOrder([e, alt, n]);
      // насколько мы внутри облака: ближайший клуб, в чью сферу попали
      // насколько мы внутри облака (ближайший клуб, в чью сферу попали) и насколько близко к нему
      let inside = 0, near = 0;
      for (const c of clouds) {
        if (Math.abs(e - c.x) > c.rx + 300 || Math.abs(n - c.z) > c.rx + 300 || alt < c.y0 - 300 || alt > c.y1 + 300) continue;
        for (const p of puffs) {
          const r = p.s * 0.45, d = Math.hypot(p.x - e, p.y - alt, p.z - n);
          if (d < r) inside = Math.max(inside, 1 - (d / r) ** 2);
          if (d < r * 1.8) near = Math.max(near, 1 - d / (r * 1.8));
        }
      }
      return [inside, near];
    },
  };
}

// ---------- клочья тумана вокруг героя: ощущение, что пронизываешь облако ----------
// Точки неподвижны в мире в кубе 160 м вокруг игрока (уходят назад — появляются спереди),
// каждая рисуется отрезком вдоль скорости — на скорости это полосы, летящие мимо.
function createMist(scene, mobile) {
  const N = mobile ? 250 : 600, BOX = 160;
  const pts = new Float32Array(N * 3), seg = new Float32Array(N * 6), col = new Float32Array(N * 6);
  const r = rng(99);
  for (let i = 0; i < N * 3; i++) pts[i] = (r() - 0.5) * BOX;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(seg, 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false; lines.renderOrder = 7;
  scene.add(lines);
  return {
    update(dt, vel, k) {
      mat.opacity = Math.min(0.85, k);
      lines.visible = k > 0.01;
      if (!lines.visible) return;
      const sp = Math.hypot(...vel), len = Math.min(40, 0.4 + sp * 0.06);
      const ve = vel[0] / (sp || 1), vu = vel[1] / (sp || 1), vn = vel[2] / (sp || 1);
      for (let i = 0; i < N; i++) {
        const o = i * 3;
        // мир сдвигается навстречу скорости; заворачиваем в куб вокруг игрока
        pts[o] -= vel[0] * dt; pts[o + 1] -= vel[1] * dt; pts[o + 2] -= vel[2] * dt;
        for (let a = 0; a < 3; a++) pts[o + a] = ((pts[o + a] + BOX / 2) % BOX + BOX) % BOX - BOX / 2;
        const x = pts[o], y = pts[o + 1], z = pts[o + 2], q = i * 6;
        seg[q] = x; seg[q + 1] = y; seg[q + 2] = -z;
        seg[q + 3] = x + ve * len; seg[q + 4] = y + vu * len; seg[q + 5] = -(z + vn * len);
        const fade = Math.max(0, 1 - Math.hypot(x, y, z) / (BOX / 2));        // ближе — ярче
        col[q] = col[q + 1] = col[q + 2] = 0.9 * fade;
        col[q + 3] = col[q + 4] = col[q + 5] = 0.2 * fade;
      }
      geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
    },
  };
}

// ---------- дождь: косые струи вокруг героя под плотным облаком ----------
function createRain(overlay, mobile) {
  const N = mobile ? 250 : 650, BOX = 42, FALL = 9;
  const pts = new Float32Array(N * 3), seg = new Float32Array(N * 6);
  const r = rng(5);
  for (let i = 0; i < N * 3; i++) pts[i] = (r() - 0.5) * BOX;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(seg, 3).setUsage(THREE.DynamicDrawUsage));
  const mat = new THREE.LineBasicMaterial({ color: 0xc7d6e8, transparent: true, opacity: 0, depthWrite: false, depthTest: false, fog: false, toneMapped: false });
  const lines = new THREE.LineSegments(geo, mat);
  lines.name = 'Storm rain'; lines.frustumCulled = false; lines.renderOrder = 8;
  overlay.add(lines);
  return {
    update(dt, vel, k, cameraPosition) {
      mat.opacity = 0.32 * k;
      if (cameraPosition) lines.position.copy(cameraPosition);
      lines.visible = k > 0.02;
      if (!lines.visible) return;
      // относительно героя капля летит вниз и навстречу его скорости
      const rv = [2 - vel[0], -FALL - vel[1], -1 - vel[2]], sp = Math.max(.001, Math.hypot(...rv)), len = Math.min(4, 0.45 + sp * 0.025);
      for (let i = 0; i < N; i++) {
        const o = i * 3;
        for (let a = 0; a < 3; a++) {
          pts[o + a] += rv[a] * dt;
          pts[o + a] = ((pts[o + a] + BOX / 2) % BOX + BOX) % BOX - BOX / 2;
        }
        const q = i * 6, x = pts[o], y = pts[o + 1], z = pts[o + 2];
        seg[q] = x; seg[q + 1] = y; seg[q + 2] = -z;
        seg[q + 3] = x - rv[0] / sp * len; seg[q + 4] = y - rv[1] / sp * len; seg[q + 5] = -(z - rv[2] / sp * len);
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

// ---------- плоские ярусы ----------
const SHEETS = [
  { name: 'Ac', alt: 4500, scale: 700, cover: 0.6, soft: 0.1, opacity: 0.7, stretch: 1.4, color: [0.97, 0.97, 0.98], radius: 55_000, veil: 0.35 },
  { name: 'Ci', alt: 9000, scale: 6000, cover: 0.52, soft: 0.25, opacity: 0.5, stretch: 3, color: [1, 1, 1], radius: 70_000, veil: 0.25 },
];

const SHEET_V = `
uniform float uR;
varying vec3 vWorld; varying float vDist;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0);
  vDist = length(w.xz);
  w.y -= vDist * vDist / (2.0 * uR);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;
const SHEET_F = `
precision highp float;
uniform vec2 uOff; uniform float uScale, uCover, uSoft, uOpacity, uStretch, uRadius, uLit, uIris, uWaves, uTime;
uniform vec3 uColor;
varying vec3 vWorld; varying float vDist;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a*noise(p); p = p*2.07 + 13.1; a *= 0.5; } return v; }
void main(){
  vec2 p = (vec2(vWorld.x, -vWorld.z) + uOff) / uScale;
  p.x /= uStretch;
  float n = fbm(p);
  if (uWaves > 0.5) n += 0.18 * sin(p.y * 9.0 + n * 6.0);          // серебристые — волнистые гряды
  float a = smoothstep(uCover, uCover + uSoft, n) * uOpacity;
  a *= 1.0 - smoothstep(uRadius * 0.5, uRadius, vDist);
  if (a < 0.01) discard;
  vec3 col = uColor * (0.6 + 0.45 * uLit);
  if (uIris > 0.5) col *= 0.75 + 0.35 * vec3(sin(n*18.0), sin(n*18.0 + 2.1), sin(n*18.0 + 4.2));   // перламутр
  gl_FragColor = vec4(col, a);
}`;

function createSheets(scene, mobile) {
  return SHEETS.map((L) => {
    const geo = new THREE.CircleGeometry(L.radius, mobile ? 48 : 96, 1);
    geo.rotateX(-Math.PI / 2);
    const u = {
      uR: { value: R }, uOff: { value: new THREE.Vector2() }, uScale: { value: L.scale }, uCover: { value: L.cover },
      uSoft: { value: L.soft }, uOpacity: { value: L.opacity }, uStretch: { value: L.stretch }, uRadius: { value: L.radius },
      uLit: { value: 1 }, uIris: { value: L.iris || 0 }, uWaves: { value: L.waves || 0 }, uTime: { value: 0 },
      uColor: { value: new THREE.Vector3(...L.color) },
    };
    const mesh = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: SHEET_V, fragmentShader: SHEET_F, uniforms: u, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    mesh.frustumCulled = false; mesh.renderOrder = 5;
    scene.add(mesh);
    return { L, mesh, u };
  });
}

export function createClouds(scene, mobile, overlay = scene) {
  const puffs = createPuffs(scene, mobile);
  const sheets = createSheets(scene, mobile);
  const mist = createMist(overlay, mobile);
  const rain = createRain(overlay, mobile);
  let last = 0, off = false;
  return {
    disable() { off = true; puffs.hide(); for (const s of sheets) s.mesh.visible = false; mist.update(0, [0, 0, 0], 0); },
    // для внешних облаков (takram): туман при проходе и дождь по их плотности в точке героя
    effects(t, vel, inCloud, rainK, cameraPosition) {
      const dt = Math.min(0.05, Math.max(0, t - last)); last = t;
      mist.update(dt, vel, inCloud);
      rain.update(dt, vel, rainK, cameraPosition);
    },
    // возвращает, насколько игрок в облаке (0..1) — небо превращает это в белую мглу
    update(c, t, sunDir, fog) {
      if (off) return 0;
      const [e0, n0] = toLocal(c.lat, c.lon, ORIGIN.lat, ORIGIN.lon);
      const e = e0 - WIND[0] * t, n = n0 - WIND[1] * t;     // облака плывут — значит, мы относительно них сдвигаемся
      const lit = Math.max(0.2, sunDir.y);
      let [inside, near] = puffs.update(e, n, c.alt, lit, fog);
      const dt = Math.min(0.05, Math.max(0, t - last)); last = t;
      for (const { L, mesh, u } of sheets) {
        mesh.position.y = L.alt - c.alt;
        u.uOff.value.set(e * (L.alt > 20_000 ? 0.3 : 1), n);
        u.uLit.value = lit;
        const d = Math.abs(c.alt - L.alt);
        mesh.visible = d < (L.alt > 20_000 ? 150_000 : 60_000);
        if (d < 120) inside = Math.max(inside, (1 - d / 120) * L.veil);   // тонкий ярус — лёгкая вуаль
        if (d < 250) near = Math.max(near, (1 - d / 250) * 0.8);
      }
      mist.update(dt, c.vel, Math.max(near, inside));
      return inside;
    },
  };
}
