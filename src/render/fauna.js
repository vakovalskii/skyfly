// ЖИЗНЬ В НЕБЕ: стаи птиц у земли и пассажирские самолёты на эшелонах.
//
// Мир двигается вокруг героя, поэтому всё хранится в метрах от неподвижной точки ORIGIN
// (как след в trail.js): e — восток, n — север, u — высота над морем. В сцену:
// x = e − pe, y = u − alt, z = −(n − pn); дальним самолётам — ещё кривизна d²/2R.
//
// Птицы — упрощённые boids: сплочение, выравнивание, разделение и блуждающая цель стаи.
// Все птицы — один InstancedMesh из двух треугольников-крыльев, взмах — в вершинном шейдере.
// Стая пугается героя (ближе 60 м и быстрее 20 м/с) и разлетается; отставшая стая
// переселяется поближе. Самолёты: прямые трассы мимо героя, нав. огни и стробы (точки
// поверх кадра), инверсионный след выше 8 км — лента, которая расплывается и тает.
import * as THREE from 'three';
import { toLocal, R } from '../core/grid.js';

const ORIGIN = { lat: 55.752, lon: 37.6175 };
const TAU = Math.PI * 2;

// ---------- птицы ----------
export const BIRD = {
  minSpeed: 7, maxSpeed: 16, fleeSpeed: 24,
  sep: 3.2,                 // м — ближе этого соседи расталкиваются
  scareDist: 60, scareSpeed: 20, scareTime: 4,
  roam: 1500, relocate: 1900,
  minAGL: 30, maxAGL: 400,
};

function makeRng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

// Шаг одной стаи (без рендера — проверяется в Node). hero: { e, n, u, speed }, ground — высота земли, м
export function stepFlock(f, dt, hero, ground, rnd) {
  const B = f.birds, N = B.length;
  let ce = 0, cn = 0, cu = 0, ve = 0, vn = 0, vu = 0;
  for (const b of B) { ce += b.e; cn += b.n; cu += b.u; ve += b.ve; vn += b.vn; vu += b.vu; }
  ce /= N; cn /= N; cu /= N; ve /= N; vn /= N; vu /= N;
  f.center = [ce, cn, cu];

  // испуг: герой рядом и быстрый
  const dh = Math.hypot(hero.e - ce, hero.n - cn, hero.u - cu);
  if (dh < BIRD.scareDist + 25 && hero.speed > BIRD.scareSpeed) {
    if (f.scared <= 0) {
      // новая цель — прочь от героя
      const ax = ce - hero.e, an = cn - hero.n, al = Math.hypot(ax, an) || 1;
      f.target = [ce + (ax / al) * 350, cn + (an / al) * 350, Math.max(ground + BIRD.minAGL + 20, cu + 30)];
    }
    f.scared = BIRD.scareTime;
  }
  f.scared = Math.max(0, f.scared - dt);
  const scared = f.scared > 0;

  // блуждание цели
  f.retarget -= dt;
  const td = Math.hypot(f.target[0] - ce, f.target[1] - cn);
  if (!scared && (f.retarget <= 0 || td < 40)) {
    f.retarget = 8 + rnd() * 8;
    const a = rnd() * TAU, r = 120 + rnd() * 220;
    let tx = ce + Math.cos(a) * r, tn = cn + Math.sin(a) * r;
    // держимся в радиусе roam от героя
    const hx = tx - hero.e, hn = tn - hero.n, hl = Math.hypot(hx, hn);
    if (hl > BIRD.roam) { tx = hero.e + (hx / hl) * BIRD.roam * 0.8; tn = hero.n + (hn / hl) * BIRD.roam * 0.8; }
    f.target = [tx, tn, ground + BIRD.minAGL + 20 + rnd() * (BIRD.maxAGL - BIRD.minAGL - 60)];
  }

  const kCoh = scared ? 0.05 : 0.8, kAli = scared ? 0.3 : 1.2, kSeek = scared ? 1.6 : 0.55;
  for (let i = 0; i < N; i++) {
    const b = B[i];
    let ae = 0, an = 0, au = 0;
    // сплочение
    ae += (ce - b.e) * kCoh * 0.05; an += (cn - b.n) * kCoh * 0.05; au += (cu - b.u) * kCoh * 0.05;
    // выравнивание
    ae += (ve - b.ve) * kAli * 0.5; an += (vn - b.vn) * kAli * 0.5; au += (vu - b.vu) * kAli * 0.5;
    // разделение
    for (let j = 0; j < N; j++) {
      if (j === i) continue;
      const o = B[j];
      const dx = b.e - o.e, dn = b.n - o.n, du = b.u - o.u;
      const d2 = dx * dx + dn * dn + du * du;
      if (d2 < BIRD.sep * BIRD.sep && d2 > 1e-6) {
        const d = Math.sqrt(d2), k = (BIRD.sep - d) / d * 4;
        ae += dx * k; an += dn * k; au += du * k;
      }
    }
    // к цели стаи
    const tx = f.target[0] - b.e, tn = f.target[1] - b.n, tu = f.target[2] - b.u;
    const tl = Math.hypot(tx, tn, tu) || 1;
    ae += (tx / tl) * kSeek * 3; an += (tn / tl) * kSeek * 3; au += (tu / tl) * kSeek * 3;
    // от героя — каждая птица сама
    const hx = b.e - hero.e, hn = b.n - hero.n, hu = b.u - hero.u, hd = Math.hypot(hx, hn, hu);
    if (hd < BIRD.scareDist && hero.speed > BIRD.scareSpeed) {
      const k = (BIRD.scareDist - hd) / BIRD.scareDist * 40 / (hd || 1);
      ae += hx * k; an += hn * k; au += Math.abs(hu) * k * 0.5 + 2;
    }
    // испуг: каждая птица рвётся в свою сторону — стая «взрывается», потом собирается снова
    if (scared) { const k = 8 * (f.scared / BIRD.scareTime); ae += Math.cos(b.ph) * k; an += Math.sin(b.ph) * k; au += 1.5 * k * 0.3; }
    // коридор высот
    const agl = b.u - ground;
    if (agl < BIRD.minAGL) au += (BIRD.minAGL - agl) * 0.8;
    if (agl > BIRD.maxAGL) au -= (agl - BIRD.maxAGL) * 0.3;
    // лёгкий шум — живость
    ae += (rnd() - 0.5) * 1.5; an += (rnd() - 0.5) * 1.5; au += (rnd() - 0.5) * 0.6;

    b.ve += ae * dt; b.vn += an * dt; b.vu += au * dt;
    b.vu *= 1 - Math.min(1, 1.5 * dt);                          // птицы летят в основном горизонтально
    const sp = Math.hypot(b.ve, b.vn, b.vu);
    const max = scared ? BIRD.fleeSpeed : BIRD.maxSpeed;
    const s = sp > max ? max / sp : sp < BIRD.minSpeed ? BIRD.minSpeed / (sp || 1) : 1;
    b.ve *= s; b.vn *= s; b.vu *= s;
    b.e += b.ve * dt; b.n += b.vn * dt; b.u += b.vu * dt;
  }
}

export function spawnFlock(f, hero, ground, rnd, near = false) {
  const a = rnd() * TAU, r = near ? 80 + rnd() * 400 : 150 + rnd() * 650;
  const ce = hero.e + Math.cos(a) * r, cn = hero.n + Math.sin(a) * r;
  const cu = ground + BIRD.minAGL + 20 + rnd() * 250;
  const h = rnd() * TAU, sp = 10 + rnd() * 3;
  for (const b of f.birds) {
    b.e = ce + (rnd() - 0.5) * 30; b.n = cn + (rnd() - 0.5) * 30; b.u = cu + (rnd() - 0.5) * 10;
    b.ve = Math.cos(h) * sp; b.vn = Math.sin(h) * sp; b.vu = 0;
  }
  f.target = [ce + Math.cos(h) * 300, cn + Math.sin(h) * 300, cu];
  f.retarget = 6 + rnd() * 6; f.scared = 0; f.center = [ce, cn, cu];
}

export function makeFlocks(count, sizeMin, sizeMax, rnd) {
  const flocks = [];
  for (let i = 0; i < count; i++) {
    const n = sizeMin + Math.floor(rnd() * (sizeMax - sizeMin + 1));
    flocks.push({ birds: Array.from({ length: n }, () => ({ e: 0, n: 0, u: 0, ve: 0, vn: 0, vu: 0, ph: rnd() * TAU })), target: [0, 0, 0], retarget: 0, scared: 0, center: [0, 0, 0] });
  }
  return flocks;
}

// ---------- самолёты ----------
function planeGeometry() {
  // нос — к +Z; длина ~60 м, размах ~60 м
  const parts = [];
  const fus = new THREE.CylinderGeometry(2.6, 2.6, 56, 8, 1);
  fus.rotateX(Math.PI / 2);
  parts.push(fus);
  const nose = new THREE.ConeGeometry(2.6, 6, 8);
  nose.rotateX(Math.PI / 2); nose.translate(0, 0, 31);
  parts.push(nose);
  const tailc = new THREE.ConeGeometry(2.6, 8, 8);
  tailc.rotateX(-Math.PI / 2); tailc.translate(0, 0.8, -32);
  parts.push(tailc);
  const wing = new THREE.BoxGeometry(60, 0.7, 8);
  wing.translate(0, -1, 2);
  parts.push(wing);
  const stab = new THREE.BoxGeometry(22, 0.5, 4.5);
  stab.translate(0, 1, -30);
  parts.push(stab);
  const fin = new THREE.BoxGeometry(0.6, 11, 7);
  fin.translate(0, 6.5, -30);
  parts.push(fin);
  for (const x of [-11, 11]) {
    const eng = new THREE.CylinderGeometry(1.4, 1.4, 5, 8);
    eng.rotateX(Math.PI / 2); eng.translate(x, -2.8, 5);
    parts.push(eng);
  }
  // склейка без addons: только position/normal, индексы → не индексированная геометрия
  const pos = [], nrm = [];
  for (const g of parts) {
    const ng = g.index ? g.toNonIndexed() : g;
    pos.push(...ng.attributes.position.array); nrm.push(...ng.attributes.normal.array);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  return out;
}

export function spawnPlane(p, hero, rnd, cruise) {
  const h = rnd() * TAU, dir = [Math.cos(h), Math.sin(h)], side = [-dir[1], dir[0]];
  const lat = (cruise ? 2000 + rnd() * 23000 : 1000 + rnd() * 7000) * (rnd() < 0.5 ? -1 : 1);
  const back = cruise ? 55000 + rnd() * 20000 : 18000 + rnd() * 8000;
  p.dir = dir;
  p.e = hero.e + side[0] * lat - dir[0] * back;
  p.n = hero.n + side[1] * lat - dir[1] * back;
  p.cruise = cruise;
  p.speed = cruise ? 225 + rnd() * 20 : 85 + rnd() * 10;
  p.u = cruise ? 9000 + Math.round(rnd() * 4) * 500 : 1500 + rnd() * 2500;
  p.climb = cruise ? 0 : -Math.tan(THREE.MathUtils.degToRad(3)) * p.speed;   // глиссада 3°
  p.trail = [];
  p.phase = rnd() * 2;
}

export function stepPlane(p, dt, hero, rnd) {
  p.e += p.dir[0] * p.speed * dt; p.n += p.dir[1] * p.speed * dt; p.u += p.climb * dt;
  const dx = p.e - hero.e, dn = p.n - hero.n;
  const along = dx * p.dir[0] + dn * p.dir[1];
  if (Math.hypot(dx, dn) > 90000 || along > 75000 || p.u < 300) spawnPlane(p, hero, rnd, p.cruise);
}

const TRAIL_STEP = 1.0, TRAIL_LIFE = 90, TRAIL_N = Math.ceil(TRAIL_LIFE / TRAIL_STEP) + 2;

const LIGHT_V = `
attribute vec3 aColor; attribute float aSize;
uniform float uScale;
varying vec3 vColor;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize > 0.0 ? max(2.5, aSize * uScale / max(1.0, -mv.z)) : 0.0;
  vColor = aColor;
}`;
const LIGHT_F = `
varying vec3 vColor;
void main(){
  vec2 p = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.0, length(p));
  if (a < 0.02) discard;
  gl_FragColor = vec4(vColor * a, a);
}`;
const TRAIL_V = `
attribute float aAlpha;
varying float vAlpha;
void main(){ vAlpha = aAlpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const TRAIL_F = `
uniform vec3 uColor;
varying float vAlpha;
void main(){ gl_FragColor = vec4(uColor, vAlpha); }`;

export function createFauna(scene, overlay, mobile) {
  const rnd = makeRng(20260929);
  const flocks = makeFlocks(mobile ? 3 : 6, mobile ? 12 : 20, mobile ? 25 : 55, rnd);
  const total = flocks.reduce((s, f) => s + f.birds.length, 0);

  // --- птицы: два треугольника, крылья по X, нос — +Z ---
  const bg = new THREE.BufferGeometry();
  bg.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0.35, -0.6, 0, -0.1, 0, 0, -0.25,        // левое крыло
    0, 0, 0.35, 0, 0, -0.25, 0.6, 0, -0.1,         // правое крыло
  ], 3));
  bg.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  const phase = new Float32Array(total);
  bg.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phase, 1));
  const time = { value: 0 };
  const birdMat = new THREE.MeshLambertMaterial({ color: 0x2a2a30, side: THREE.DoubleSide });
  birdMat.onBeforeCompile = (sh) => {
    sh.uniforms.uFlapTime = time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aPhase;\nuniform float uFlapTime;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
  // взмах: концы крыльев вверх-вниз, частота ~4 Гц, у каждой птицы своя фаза; иногда планирует
  float flap = sin(uFlapTime * 25.0 + aPhase) * step(0.0, sin(uFlapTime * 0.7 + aPhase * 3.0) + 0.4);
  transformed.y += abs(transformed.x) * flap * 0.9;`);
  };
  birdMat.customProgramCacheKey = () => 'skyfly-bird';
  const birds = new THREE.InstancedMesh(bg, birdMat, total);
  birds.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  birds.frustumCulled = false;                      // экземпляры разбросаны по 3 км — сферу считать бессмысленно
  birds.userData.perfCat = 'птицы';
  scene.add(birds);
  let k = 0;
  for (const f of flocks) for (const b of f.birds) phase[k++] = b.ph;

  // --- самолёты ---
  const nCruise = mobile ? 2 : 3, nApproach = 1;
  const planes = [];
  for (let i = 0; i < nCruise + nApproach; i++) planes.push({ trail: [] });
  const planeMesh = new THREE.InstancedMesh(planeGeometry(), new THREE.MeshLambertMaterial({ color: 0xe8ecf2 }), planes.length);
  planeMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  planeMesh.frustumCulled = false;
  planeMesh.userData.perfCat = 'самолёты';
  planeMesh.userData.noCast = true;                 // на 10 км тень от них не нужна
  scene.add(planeMesh);

  // огни: 6 на самолёт (нав. красный/зелёный, два строба, хвост, маяк)
  const NL = planes.length * 6;
  const lp = new Float32Array(NL * 3), lc = new Float32Array(NL * 3), ls = new Float32Array(NL);
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(lp, 3).setUsage(THREE.DynamicDrawUsage));
  lg.setAttribute('aColor', new THREE.BufferAttribute(lc, 3).setUsage(THREE.DynamicDrawUsage));
  lg.setAttribute('aSize', new THREE.BufferAttribute(ls, 1).setUsage(THREE.DynamicDrawUsage));
  const H = () => (typeof innerHeight === 'number' ? innerHeight : 800);
  const lu = { uScale: { value: H() * 1.2 } };
  if (typeof addEventListener === 'function') addEventListener('resize', () => { lu.uScale.value = H() * 1.2; });
  const lights = new THREE.Points(lg, new THREE.ShaderMaterial({ vertexShader: LIGHT_V, fragmentShader: LIGHT_F, uniforms: lu,
    transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }));
  lights.frustumCulled = false; lights.renderOrder = 6;
  lights.userData.perfCat = 'самолёты';
  overlay.add(lights);

  // инверсионные следы: лента из квадов, по 2 треугольника на отрезок
  const TQ = planes.length * TRAIL_N;
  const tp = new Float32Array(TQ * 4 * 3), ta = new Float32Array(TQ * 4);
  const tIdx = [];
  for (let q = 0; q < TQ; q++) { const o = q * 4; tIdx.push(o, o + 1, o + 2, o + 2, o + 1, o + 3); }
  const tg = new THREE.BufferGeometry();
  tg.setAttribute('position', new THREE.BufferAttribute(tp, 3).setUsage(THREE.DynamicDrawUsage));
  tg.setAttribute('aAlpha', new THREE.BufferAttribute(ta, 1).setUsage(THREE.DynamicDrawUsage));
  tg.setIndex(tIdx);
  const trails = new THREE.Mesh(tg, new THREE.ShaderMaterial({ vertexShader: TRAIL_V, fragmentShader: TRAIL_F,
    uniforms: { uColor: { value: new THREE.Color(0xf4f7fb) } },
    transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
  trails.frustumCulled = false; trails.renderOrder = 5;
  trails.userData.perfCat = 'самолёты';
  overlay.add(trails);

  const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(1, 1, 1), sBird = new THREE.Vector3(1.25, 1.25, 1.25);
  const lv = new THREE.Vector3();
  const dirV = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), zero = new THREE.Vector3();
  const hero = { e: 0, n: 0, u: 0, speed: 0 };
  let started = false, lastE = 0, lastN = 0;
  const drop = (d) => (d * d) / (2 * R);

  const orient = (ve, vu, vn) => {
    dirV.set(ve, vu, -vn).normalize();
    m4.lookAt(dirV, zero, up);                       // +Z модели — по скорости
    q4.setFromRotationMatrix(m4);
  };

  return {
    flocks, planes, birds, planeMesh,
    // c — персонаж, ground — высота земли под героем, camera — камера сцены
    update(dt, t, c, ground, camera) {
      time.value = t;
      const [pe, pn] = toLocal(c.lat, c.lon, ORIGIN.lat, ORIGIN.lon);
      hero.e = pe; hero.n = pn; hero.u = c.alt; hero.speed = Math.hypot(...c.vel);
      // телепорт (старт на крыше, переход в другой город) — стаи заново вокруг героя
      const jumped = started && Math.hypot(pe - lastE, pn - lastN) > 300;
      lastE = pe; lastN = pn;
      if (jumped) for (const f of flocks) spawnFlock(f, hero, ground, rnd, true);
      if (!started) {
        started = true;
        for (const f of flocks) spawnFlock(f, hero, ground, rnd, true);
        planes.forEach((p, i) => { spawnPlane(p, hero, rnd, i < nCruise); for (let s = 0; s < 40; s++) stepPlane(p, 3, hero, rnd); });
      }
      dt = Math.min(dt, 0.05);

      // --- птицы ---
      const above = c.alt - ground;
      birds.visible = above < 5000;
      if (birds.visible) {
        let i = 0;
        for (const f of flocks) {
          stepFlock(f, dt, hero, ground, rnd);
          const fd = Math.hypot(f.center[0] - pe, f.center[1] - pn);
          if (fd > BIRD.relocate) spawnFlock(f, hero, ground, rnd);
          for (const b of f.birds) {
            orient(b.ve, b.vu, b.vn);
            v3.set(b.e - pe, b.u - c.alt, -(b.n - pn));
            m4.compose(v3, q4, sBird);                   // размах ~1.5 м — чайка/ворона
            birds.setMatrixAt(i++, m4);
          }
        }
        birds.instanceMatrix.needsUpdate = true;
      }

      // --- самолёты ---
      let li = 0, qi = 0;
      const cam = camera?.position ?? zero;
      planes.forEach((p, i) => {
        stepPlane(p, dt, hero, rnd);
        const dx = p.e - pe, dn = p.n - pn;
        const y = p.u - c.alt - drop(Math.hypot(dx, dn));
        orient(p.dir[0], p.climb / p.speed, p.dir[1]);
        v3.set(dx, y, -dn);
        m4.compose(v3, q4, s3);
        planeMesh.setMatrixAt(i, m4);
        // огни в осях модели → сцена
        const tt = t + p.phase;
        const strobe = (tt % 1.2) < 0.06 ? 1 : 0, beacon = (tt % 1.0) < 0.12 ? 1 : 0;
        const L = [
          [-30, -1, 2, 1, 0.1, 0.1, 1.2],      // левое крыло — красный
          [30, -1, 2, 0.1, 1, 0.2, 1.2],       // правое — зелёный
          [-30, -1, 1, 1, 1, 1, strobe * 3],   // стробы на законцовках
          [30, -1, 1, 1, 1, 1, strobe * 3],
          [0, 1, -34, 1, 1, 1, 1.0],           // хвост — белый
          [0, -3, 0, 1, 0.15, 0.1, beacon * 2.2], // маяк снизу — красный, мигает
        ];
        for (const l of L) {
          const w = lv.set(l[0], l[1], l[2]).applyMatrix4(m4);
          lp[li * 3] = w.x; lp[li * 3 + 1] = w.y; lp[li * 3 + 2] = w.z;
          lc[li * 3] = l[3]; lc[li * 3 + 1] = l[4]; lc[li * 3 + 2] = l[5];
          ls[li] = l[6]; li++;
        }
        // инверсионный след: только на эшелоне выше 8 км. Только что появившемуся самолёту
        // «дорисовываем» след за прошедшие 90 с — он летел и до того, как попал в наш круг
        if (p.u > 8000 && !p.trail.length) {
          for (let age = TRAIL_LIFE - 2; age > 0; age -= TRAIL_STEP * 2) p.trail.push({ e: p.e - p.dir[0] * (40 + p.speed * age), n: p.n - p.dir[1] * (40 + p.speed * age), u: p.u, t: t - age });
        }
        if (p.u > 8000) {
          const last = p.trail[p.trail.length - 1];
          if (!last || t - last.t > TRAIL_STEP) p.trail.push({ e: p.e - p.dir[0] * 40, n: p.n - p.dir[1] * 40, u: p.u, t });
        }
        while (p.trail.length && (t - p.trail[0].t > TRAIL_LIFE || p.trail.length > TRAIL_N - 1)) p.trail.shift();
        // голова ленты — прямо за самолётом
        const pts = p.u > 8000 ? [...p.trail, { e: p.e - p.dir[0] * 40, n: p.n - p.dir[1] * 40, u: p.u, t }] : p.trail;
        for (let j = 0; j + 1 < pts.length; j++) {
          const a = pts[j], b = pts[j + 1];
          const quad = (P, age, o) => {
            const ax = P.e - pe, an = P.n - pn;
            const sx = ax, sy = P.u - c.alt - drop(Math.hypot(ax, an)), sz = -an;
            // ширина растёт с возрастом (расплывается), поперёк к камере
            const dxs = (b.e - a.e), dzs = -(b.n - a.n);
            const tox = sx - cam.x, toy = sy - cam.y, toz = sz - cam.z;
            // (dxs, 0, dzs) × (tox, toy, toz)
            let wx = -dzs * toy, wy = dzs * tox - dxs * toz, wz = dxs * toy;
            const wl = Math.hypot(wx, wy, wz) || 1, half = 6 + age * 2.5;   // расплывается ~2.5 м/с в каждую сторону
            wx *= half / wl; wy *= half / wl; wz *= half / wl;
            const base = (qi * 4 + o) * 3;
            tp[base] = sx - wx; tp[base + 1] = sy - wy; tp[base + 2] = sz - wz;
            tp[base + 3] = sx + wx; tp[base + 4] = sy + wy; tp[base + 5] = sz + wz;
            const al = Math.min(1, (t - P.t + 0.5) * 0.8) * Math.pow(1 - Math.min(1, age / TRAIL_LIFE), 1.5) * 0.55;
            ta[qi * 4 + o] = al; ta[qi * 4 + o + 1] = al;
          };
          quad(a, t - a.t, 0);
          quad(b, t - b.t, 2);
          qi++;
        }
      });
      for (; qi < TQ; qi++) for (let o = 0; o < 4; o++) ta[qi * 4 + o] = 0;
      planeMesh.instanceMatrix.needsUpdate = true;
      lg.attributes.position.needsUpdate = lg.attributes.aColor.needsUpdate = lg.attributes.aSize.needsUpdate = true;
      tg.attributes.position.needsUpdate = tg.attributes.aAlpha.needsUpdate = true;
    },
  };
}
