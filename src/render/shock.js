// ВОЗДУХ ВОКРУГ ГЕРОЯ НА СКОРОСТИ — три слоя, как у самолётов и спускаемых капсул:
//  • пар: мягкие отдельные клубы за плечами около скорости звука;
//  • сверхзвуковой след: редкая дымка без замкнутой оболочки вокруг тела;
//  • плазма входа в атмосферу: сжатый воздух перед героем раскаляется. Температура торможения
//    T₀ = T(1 + 0.2·M²) задаёт цвет (тёмно-красный ~1000 K → оранжевый → бело-жёлтый),
//    плотность — видимость: выше ~95 км воздуха слишком мало, ниже 20 км скорость уже погашена.
// Всё рисуется поверх кадра (в сцене overlay), аддитивно, без глубины; герой — в начале координат.
import * as THREE from 'three';
import { createSmokeCloud } from './smoke.js';

// Международная стандартная атмосфера, упрощённо: температура по высоте, К
export function airTemp(alt) {
  const h = alt / 1000;
  if (h < 11) return 288.15 - 6.5 * h;
  if (h < 20) return 216.65;
  if (h < 32) return 216.65 + (h - 20);
  if (h < 47) return 228.65 + 2.8 * (h - 32);
  if (h < 51) return 270.65;
  if (h < 71) return 270.65 - 2.8 * (h - 51);
  return Math.max(186.9, 214.65 - 2 * (h - 71));
}
export const soundSpeed = (alt) => 20.05 * Math.sqrt(airTemp(alt));
// Сила эффектов 0..1 по скорости, высоте и плотности (rho — доля плотности у моря).
// Считается отдельно от рендера, чтобы проверять без браузера.
export function shockLevels(speed, alt, rho) {
  const M = speed / soundSpeed(alt);
  const T0 = airTemp(alt) * (1 + 0.2 * M * M);
  const clamp = (x) => Math.min(1, Math.max(0, x));
  // пар: пик у M≈1, нужен плотный влажный воздух (ниже ~6 км)
  const vapor = clamp(1 - Math.abs(M - 1) / 0.13) * clamp((rho - 0.45) / 0.3);
  // ударная волна: с M 1 до 1.3 проявляется; видна, пока воздуха хватает
  const shock = clamp((M - 0.95) / 0.35) * clamp(rho * 60) * (1 - 0.6 * clamp((T0 - 1800) / 3000));
  // плазма: свечение с ~1000 K, нужна плотность (выше 95 км почти нет)
  const plasma = clamp((T0 - 1000) / 2500) * clamp(rho * 8000);
  return { M, T0, vapor, shock, plasma };
}

const NOISE = `
float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
`;

// Оболочка: единичная сфера деформируется в вершинном шейдере. Локальная ось +z — вдоль скорости.
// Передняя половина — купол на расстоянии uStand перед героем, задняя — раструб длиной uLen
// с растущим радиусом (конус Маха: tan μ) или сужающимся хвостом (плазма: uTaper < 0).
const SHELL_V = `
uniform float uR, uStand, uLen, uSlope, uTime, uWobble, uPoly;
varying vec3 vN; varying vec3 vView; varying float vT; varying vec3 vL;
${NOISE}
void main(){
  vec3 p = position;
  float t = clamp(-p.z, 0.0, 1.0);            // 0 — у героя, 1 — конец хвоста
  vec2 dxy = length(p.xy) > 1e-4 ? normalize(p.xy) : vec2(0.0);
  // рваный многоугольник: 7 граней, каждая дрожит своей длиной (uPoly 0 — гладкий круг)
  float ang = atan(p.y, p.x), sector = 6.2831853 / 7.0;
  float fi = floor((ang + 3.1415927) / sector);
  float poly = cos(sector * 0.5) / cos(mod(ang + 3.1415927, sector) - sector * 0.5);
  poly *= 0.8 + 0.45 * n3(vec3(fi * 3.1, floor(uTime * 12.0), 0.0));
  float pk = mix(1.0, poly, uPoly);
  vec3 q;
  if (p.z >= 0.0) q = vec3(p.xy * uR * pk, uStand * p.z + uR * 0.25);
  else {
    float z = -t * uLen;
    float r = max(0.05, uR + t * uLen * uSlope) * pk;
    r *= 1.0 + uWobble * (n3(vec3(dxy * 2.0, t * 6.0 - uTime * 9.0)) - 0.5);
    q = vec3(dxy * r, z + uR * 0.25);
  }
  vT = t; vL = p;
  vec4 mv = modelViewMatrix * vec4(q, 1.0);
  vView = -mv.xyz;
  vN = normalMatrix * normalize(vec3(p.xy, p.z >= 0.0 ? p.z * uR / max(uStand, 0.1) : -uSlope * 0.5));
  gl_Position = projectionMatrix * mv;
}`;

// Плазма: резкий раскалённый серп по кромке колпака (внутри пусто, герой виден) и рваные
// огненные полосы в хвосте — полосы идут вдоль потока, с чёткими краями, рвутся и бегут назад
const PLASMA_F = `
uniform float uK, uTime, uHot, uThin;
varying vec3 vN; varying vec3 vView; varying float vT; varying vec3 vL;
${NOISE}
vec3 heat(float x){           // 0 — тёмно-красный, 1 — бело-жёлтый
  return mix(mix(vec3(0.7, 0.08, 0.02), vec3(1.0, 0.45, 0.08), clamp(x * 2.0, 0.0, 1.0)),
             vec3(1.0, 0.92, 0.75), clamp(x * 2.0 - 1.0, 0.0, 1.0));
}
void main(){
  float r = 1.0 - abs(dot(normalize(vN), normalize(vView)));
  float ang = atan(vL.y, vL.x);
  float a;
  if (vL.z > 0.0) {
    // колпак: тонкий яркий контур + слабое свечение у самого носа
    float rim = smoothstep(0.55, 0.7, r) * (1.0 - smoothstep(0.9, 0.97, r));
    a = rim + 0.12 * smoothstep(0.6, 1.0, vL.z);
  } else {
    float n = n3(vec3(ang * 5.0, vT * 3.0 - uTime * 18.0, uTime * 3.0));
    float streak = smoothstep(0.55, 0.6, n);                         // резкие края полос
    float side = smoothstep(0.35, 0.6, r);                           // полосы — по бокам хвоста, не поперёк экрана
    a = streak * side * pow(1.0 - vT, 1.3);
  }
  // прорези: полосы по углу, где оболочки нет — сквозь них видно героя и космос
  float slit = n3(vec3(ang * 3.0, vT * 1.5 - uTime * 6.0, uTime * 1.3));
  a *= smoothstep(0.28, 0.33, slit);
  a *= uK;
  vec3 col = heat(uHot * (1.0 - vT * 0.6));
  // У края космоса (разреженный воздух, выше ~60 км) светится ионизированный азот и кислород:
  // сиреневый, пурпурный, салатовый — как в полярном сиянии; ниже — обычный жар торможения
  float hue = n3(vec3(ang * 1.5, vT * 2.0 - uTime * 2.0, 7.0));
  vec3 ion = mix(mix(vec3(0.62, 0.25, 1.0), vec3(1.0, 0.2, 0.75), smoothstep(0.3, 0.6, hue)), vec3(0.55, 1.0, 0.35), smoothstep(0.65, 0.85, hue));
  col = mix(col, ion, uThin);
  gl_FragColor = vec4(col * a * 1.8, a);
}`;

export function createShock(overlay) {
  const group = new THREE.Group();
  group.renderOrder = 8;
  overlay.add(group);
  const time = { value: 0 };
  const shellGeo = new THREE.SphereGeometry(1, 48, 32);
  shellGeo.rotateX(Math.PI / 2);                               // полюса сферы — на оси z (вдоль скорости)
  const shellU = () => ({ uR: { value: 1.6 }, uStand: { value: 1.2 }, uLen: { value: 12 }, uSlope: { value: 0.5 },
    uTime: time, uWobble: { value: 0 }, uK: { value: 0 }, uHot: { value: 0 }, uPoly: { value: 0 }, uThin: { value: 0 } });
  const mk = (geo, v, f, u) => {
    const m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: v, fragmentShader: f, uniforms: u,
      transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));
    m.frustumCulled = false; m.visible = false;
    group.add(m);
    return m;
  };
  const plasma = mk(shellGeo, SHELL_V, PLASMA_F, shellU());
  const vapor = createSmokeCloud(56); group.add(vapor.mesh);

  const dir = new THREE.Vector3(), center = new THREE.Vector3(0, 0.9, 0), m4 = new THREE.Matrix4(), up = new THREE.Vector3(0, 1, 0);
  let heatShown = false, shake = 0, burst = 0;   // burst — вспышка «пробоя» при входе, гаснет за ~0.8 с
  const smooth = { vapor: 0, shock: 0, plasma: 0 };
  return {
    levels: smooth,
    // vel — скорость в осях сцены; onEntry — один раз при начале входа в атмосферу; kick(k) — тряска камеры
    update(dt, t, vel, speed, alt, rho, flying, onEntry, kick, camera) {
      time.value = t;
      const L = flying && speed > 50 ? shockLevels(speed, alt, rho) : { M: 0, T0: 0, vapor: 0, shock: 0, plasma: 0 };
      for (const k of ['vapor', 'shock', 'plasma']) smooth[k] += (L[k] - smooth[k]) * Math.min(1, dt * (k === 'vapor' ? 6 : 3));
      const any = smooth.vapor + smooth.shock + smooth.plasma > 0.01;
      group.visible = any;
      if (!any) { heatShown = false; return L; }
      dir.copy(vel).normalize();
      if (Math.abs(dir.y) > 0.99) up.set(1, 0, 0); else up.set(0, 1, 0);
      m4.lookAt(dir, new THREE.Vector3(), up);                 // +z группы — по скорости
      group.quaternion.setFromRotationMatrix(m4);
      group.position.copy(center);

      const pu = plasma.material.uniforms;
      pu.uK.value = smooth.plasma; pu.uHot.value = Math.min(1, Math.max(0, (L.T0 - 1000) / 9000));
      pu.uR.value = 1.35; pu.uStand.value = 0.9; pu.uLen.value = 6 + 22 * smooth.plasma; pu.uSlope.value = -0.02;
      pu.uWobble.value = 0.12; pu.uPoly.value = 1;
      pu.uThin.value = Math.min(1, Math.max(0, (alt - 55_000) / 20_000));
      plasma.visible = smooth.plasma > 0.01;

      const vaporStrength = Math.max(smooth.vapor, smooth.shock * .3) * (1 - smooth.plasma * .75);
      vapor.mesh.visible = vaporStrength > .01;
      for (let i = 0; i < 56; i++) {
        const life = (t * .65 + i * .618034) % 1, seed = (i * .754877) % 1;
        const angle = i * 2.399963, radius = .25 + seed * (.6 + life * .9);
        vapor.set(i, Math.cos(angle) * radius, Math.sin(angle) * radius, -.4 - life * 5,
          .5 + life * 1.7, Math.sin(life * Math.PI) * vaporStrength * .17);
      }
      vapor.update(t);

      if (smooth.plasma > 0.25 && !heatShown) { heatShown = true; burst = 1; onEntry?.(); }
      burst = Math.max(0, burst - dt * 1.25);
      pu.uK.value = Math.min(1.6, pu.uK.value + burst * 1.2); pu.uR.value += burst * burst * 7; pu.uLen.value += burst * 30;
      if (smooth.plasma < 0.05) heatShown = false;
      shake += dt;
      if (shake > 0.12 && smooth.plasma + smooth.vapor * 0.5 > 0.15) { shake = 0; kick?.(0.05 + 0.2 * smooth.plasma); }
      return L;
    },
  };
}
