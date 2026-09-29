// СЛЕД ОТ НОГ — пар, как у облаков: из ступней в полёте выходят мягкие клубы той же текстуры,
// что у облаков. Клубы неподвижны в мире (метры от Москвы), расползаются и неровно тают за ~3 с,
// освещены солнцем: к солнцу светлее, в тени серее. Ярче на скорости и в плотном воздухе,
// в пустоте космоса пара нет.
import * as THREE from 'three';
import { toLocal } from '../core/grid.js';
import { puffTexture } from './clouds.js';

const ORIGIN = { lat: 55.752, lon: 37.6175 };
const LIFE = 3.2, PER_FOOT = 700;

const V = `
attribute float aSize; attribute float aAlpha; attribute float aRot;
uniform float uScale;
varying float vAlpha; varying float vRot; varying vec3 vView;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = aSize * uScale / max(0.5, -mv.z);
  vAlpha = aAlpha; vRot = aRot; vView = position - cameraPosition;
}`;
const F = `
precision highp float;
uniform sampler2D uMap; uniform vec3 uSun;
varying float vAlpha; varying float vRot; varying vec3 vView;
void main(){
  vec2 p = gl_PointCoord - 0.5;
  float c = cos(vRot), s = sin(vRot);
  vec2 uv = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
  float a = texture2D(uMap, uv).a * vAlpha;
  if (a < 0.01) discard;
  // сторона к солнцу светлее: у клуба «верх» — к солнцу в экране (грубо, по вертикали)
  float lit = 0.72 + 0.28 * clamp(uSun.y * 1.5 + (0.5 - gl_PointCoord.y) * 0.8, 0.0, 1.0);
  gl_FragColor = vec4(vec3(1.0) * (0.15 + lit), min(1.0, a * 1.2));
}`;

export function createTrail(overlay) {
  const N = PER_FOOT * 2;
  const pos = new Float32Array(N * 3), size = new Float32Array(N), alpha = new Float32Array(N), rot = new Float32Array(N);
  const geo = new THREE.BufferGeometry();
  const attr = (a, n) => new THREE.BufferAttribute(a, n).setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', attr(pos, 3)); geo.setAttribute('aSize', attr(size, 1));
  geo.setAttribute('aAlpha', attr(alpha, 1)); geo.setAttribute('aRot', attr(rot, 1));
  const u = { uMap: { value: puffTexture() }, uScale: { value: innerHeight * 1.2 }, uSun: { value: new THREE.Vector3(0, 1, 0) } };
  addEventListener('resize', () => { u.uScale.value = innerHeight * 1.2; });
  const points = new THREE.Points(geo, new THREE.ShaderMaterial({
    vertexShader: V, fragmentShader: F, uniforms: u, transparent: true, depthWrite: false, depthTest: false,
  }));
  points.frustumCulled = false; points.renderOrder = 9;
  overlay.add(points);

  const puffs = [];                   // { e, n, u, ve, vn, vu, t, k, r0, rot }
  const foot = new THREE.Vector3();
  let feet = null, acc = 0, seed = 1;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  return {
    update(c, hero, camera, now, speed, rho, sunDir, dt = 1 / 60) {
      if (!feet) {
        const names = [...(hero.userData.bones?.keys() || [])].filter((n) => /foot/i.test(n) && !/toe|heel/i.test(n));
        feet = names.slice(0, 2).map((n) => hero.userData.bones.get(n));
      }
      if (sunDir) u.uSun.value.copy(sunDir);
      const [pe, pn] = toLocal(c.lat, c.lon, ORIGIN.lat, ORIGIN.lon);
      const k = c.mode === 'fly' ? Math.min(1, Math.max(0, (speed - 20) / 80)) * Math.min(1, rho * 3 + 0.15) : 0;
      // сколько клубов выпустить: чаще на скорости, чтобы след был сплошным
      acc += k > 0.01 ? dt * (30 + Math.min(90, speed * 0.3)) : 0;
      while (acc >= 1) {
        acc -= 1;
        for (let i = 0; i < 2; i++) {
          if (feet?.[i]) feet[i].getWorldPosition(foot); else foot.set(i ? 0.15 : -0.15, 0.1, 0);
          const back = rnd() * speed * dt;            // размазываем выпуск по пути за кадр
          const sp = speed || 1;
          puffs.push({
            e: pe + foot.x - (c.vel[0] / sp) * back, n: pn - foot.z - (c.vel[2] / sp) * back, u: c.alt + foot.y - (c.vel[1] / sp) * back,
            ve: (rnd() - 0.5) * 1.6, vn: (rnd() - 0.5) * 1.6, vu: (rnd() - 0.3) * 1.2,
            t: now, k, r0: 0.35 + rnd() * 0.35, rot: rnd() * 6.283, life: LIFE * (0.7 + rnd() * 0.6),
          });
        }
      }
      while (puffs.length && (now - puffs[0].t > puffs[0].life || puffs.length > N)) puffs.shift();
      let j = 0;
      for (const p of puffs) {
        const age = (now - p.t) / p.life;
        if (age >= 1) continue;
        const tt = now - p.t;
        pos[j * 3] = p.e + p.ve * tt - pe;
        pos[j * 3 + 1] = p.u + p.vu * tt - c.alt;
        pos[j * 3 + 2] = -(p.n + p.vn * tt - pn);
        size[j] = p.r0 * 1.5 + age * 4.5;                   // метры: пар расползается
        alpha[j] = Math.min(1, age * 8) * Math.pow(1 - age, 1.2) * p.k;
        rot[j] = p.rot + tt * 0.3;
        j++;
      }
      geo.setDrawRange(0, j);
      points.visible = j > 0;
      for (const n of ['position', 'aSize', 'aAlpha', 'aRot']) geo.attributes[n].needsUpdate = true;
    },
  };
}
