// СВЕТ СОЛНЦА: каскадные тени (CSM) и тени от облаков.
//
// Каскадные тени — стандарт для солнца над большой местностью: несколько карт теней,
// чёткая у камеры (герой на крыше, дома на улице), грубее дальше. Реализация — three/addons CSM.
// У CSM на каждый каскад своя лампа, поэтому КАЖДЫЙ освещаемый материал надо подготовить
// (иначе он светится от всех каскадов сразу, втрое ярче). Рельеф и дома подгружаются на ходу —
// раз в полсекунды обходим сцену и готовим новые материалы сами.
//
// Тени облаков: для точки земли идём к солнцу до высоты облаков (1.6 км) и берём плотность из той же
// карты погоды takram, по которой строятся облака (кубосфера ECEF → local_weather). Тени совпадают
// с облаками над головой и плывут вместе с ними. Работают только с физической атмосферой takram (не в ?sky=old).
import * as THREE from 'three';
import { CSM } from 'three/addons/csm/CSM.js';
import { toLocal } from '../core/grid.js';

const CLOUD_GLSL = `
uniform float uCloudOn, uCloudCoverage, uCloudAlt;
uniform mat4 uW2E;
uniform vec3 uSunE;
uniform vec2 uCloudRepeat, uCloudOffset;
uniform sampler2D uWeather;
varying vec3 vCloudW;
vec2 cloudCubeUv(vec3 p) {
  vec3 n = normalize(p); vec3 f = abs(n); vec3 c = n / max(f.x, max(f.y, f.z)); vec2 m;
  if (all(greaterThan(f.yy, f.xz))) m = c.y > 0.0 ? vec2(-n.x, n.z) : n.xz;
  else if (all(greaterThan(f.xx, f.yz))) m = c.x > 0.0 ? n.yz : vec2(-n.y, n.z);
  else m = c.z > 0.0 ? n.xy : vec2(n.x, -n.y);
  vec2 m2 = m * m; float q = dot(m2, vec2(-2.0, 2.0)) - 3.0;
  vec2 uv; uv.x = sqrt(max(0.0, 1.5 + m2.x - m2.y - 0.5 * sqrt(max(0.0, -24.0 * m2.x + q * q)))) * (m.x > 0.0 ? 1.0 : -1.0);
  uv.y = sqrt(6.0 / (3.0 - uv.x * uv.x)) * m.y;
  return uv * 0.5 + 0.5;
}
float cloudShadow() {
  if (uCloudOn < 0.5) return 1.0;
  vec3 p = (uW2E * vec4(vCloudW, 1.0)).xyz;
  vec3 up = normalize(p);
  float mu = max(dot(up, uSunE), 0.08);
  vec3 q = p + uSunE * (uCloudAlt / mu);
  vec4 w = texture2D(uWeather, cloudCubeUv(q) * uCloudRepeat + uCloudOffset);
  float factor = 1.0 - uCloudCoverage * 0.9, fw = 0.6;
  vec2 d = clamp((w.rg + (1.0 - w.rg) * fw - factor) / fw, 0.0, 1.0);
  return 1.0 - 0.72 * max(d.x, d.y);
}
`;

export function createLighting(scene, camera, renderer, mobile) {
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const csm = new CSM({
    camera, parent: scene,
    cascades: mobile ? 2 : 3,
    maxFar: mobile ? 1200 : 2500,
    shadowMapSize: mobile ? 1024 : 2048,
    lightDirection: new THREE.Vector3(-0.4, -0.8, -0.3).normalize(),
    lightIntensity: 2.8, lightFar: 5000, lightMargin: 400,
    // Каскады вручную: 25 м вокруг героя (~3 см на пиксель карты — видна тень самого героя), 250 м —
    // улица, дальше — кварталы. Стандартное «practical»-деление с maxFar 2.5 км давало первый каскад
    // ~1 км (полметра на пиксель), и тень героя с крышей терялась целиком.
    mode: 'custom',
    customSplitsCallback: (n, near, far, out) => {
      const at = n === 2 ? [40, far] : [25, 250, far];
      for (const d of at) out.push(Math.min(1, d / far));
    },
  });
  csm.fade = true;
  csm.updateFrustums();
  // смещения — под размер пикселя своего каскада (ближний мелкий — почти без смещения)
  const NB = mobile ? [0.05, 1.2] : [0.03, 0.2, 1.2];
  csm.lights.forEach((l, i) => { l.shadow.bias = -0.0002; l.shadow.normalBias = NB[i] ?? 1; });

  const cloudU = {
    uCloudOn: { value: 0 }, uCloudCoverage: { value: 0.35 }, uCloudAlt: { value: 1600 },
    uW2E: { value: new THREE.Matrix4() }, uSunE: { value: new THREE.Vector3(0, 1, 0) },
    uCloudRepeat: { value: new THREE.Vector2(100, 100) }, uCloudOffset: { value: new THREE.Vector2() },
    uWeather: { value: null },
  };

  const done = new WeakSet();
  const LIT = (m) => m && (m.isMeshLambertMaterial || m.isMeshStandardMaterial || m.isMeshPhongMaterial);
  // тени облаков — только на землю и дома (не на героя), остальное — только CSM
  function prepare(mat, receiver) {
    if (done.has(mat) || !LIT(mat)) return;
    done.add(mat);
    const prev = mat.onBeforeCompile, prevKey = mat.customProgramCacheKey.call(mat);
    csm.setupMaterial(mat);
    mat.addEventListener('dispose', () => csm.shaders.delete(mat));
    const csmHook = mat.onBeforeCompile;
    mat.onBeforeCompile = (sh, r) => {
      prev.call(mat, sh, r);
      csmHook.call(mat, sh, r);
      if (!receiver) return;
      Object.assign(sh.uniforms, cloudU);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCloudW;')
        .replace('#include <fog_vertex>', '#include <fog_vertex>\n  vCloudW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\n' + CLOUD_GLSL)
        .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n  { float cs = cloudShadow(); reflectedLight.directDiffuse *= cs; reflectedLight.directSpecular *= cs; }');
    };
    // Программы шейдеров кэшируются по тексту onBeforeCompile — у всех наших обёрток он одинаковый,
    // поэтому ключ собираем из прежнего ключа (изгиб рельефа и т. п.) и наших добавок
    mat.customProgramCacheKey = () => `${prevKey}|csm|${receiver ? 'cloud' : ''}`;
    mat.needsUpdate = true;
  }

  let heroRoot = null, lastNear = camera.near, lastFar = camera.far, lastFov = camera.fov;
  const objects = new WeakSet();
  let anchor = null;
  const origin = new THREE.Vector3(), lightOrigin = new THREE.Vector3(), center = new THREE.Vector3(), delta = new THREE.Vector3();
  const orientation = new THREE.Matrix4(), inverse = new THREE.Matrix4(), zero = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  return {
    csm, cloudU,
    setOrigin(c) {
      anchor ??= { lat: c.lat, lon: c.lon };
      const [east, north] = toLocal(c.lat, c.lon, anchor.lat, anchor.lon);
      origin.set(east, c.alt, -north);
    },
    // hero — объект героя: отбрасывает тени, на него — только CSM
    setHero(h) {
      heroRoot = h;
      h.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; for (const m of [].concat(o.material)) prepare(m, false); } });
    },
    // sunDir — к солнцу (оси сцены); color/intensity — свет солнца (у takram — после толщи воздуха)
    update(sunDir, color, intensity) {
      {
        // Prepare each newly streamed mesh BEFORE its first frame. Waiting 30 frames
        // briefly lit it with all cascade lights, producing a visible bright flash.
        scene.traverseVisible((o) => {
          if (!o.isMesh || objects.has(o)) return;
          objects.add(o);
          let inHero = false, noCast = false;
          for (let p = o; p; p = p.parent) { if (p === heroRoot) inHero = true; if (p.userData.noCast) noCast = true; }
          const mats = [].concat(o.material);
          if (!mats.some(LIT)) return;
          o.castShadow = !noCast && !mats.some((m) => m.transparent && m.opacity < 0.6);   // заливка домов в режиме сетки (0.78) — тоже тень
          o.receiveShadow = true;
          for (const m of mats) prepare(m, !inHero && !o.isSkinnedMesh);
        });
      }
      dir.copy(sunDir).normalize().negate();
      csm.lightDirection.copy(dir);
      const below = sunDir.y < 0.02;                            // солнце за горизонтом — теней нет
      for (const l of csm.lights) { l.color.copy(color); l.intensity = below ? 0 : intensity; }
      if (camera.near !== lastNear || camera.far !== lastFar || Math.abs(camera.fov - lastFov) > .25) {
        lastNear = camera.near; lastFar = camera.far; lastFov = camera.fov;
        csm.updateFrustums();
      }
      csm.update();
      // CSM snaps to texels in scene coordinates, but our scene origin follows the
      // hero. Snap in stationary city coordinates instead, so shadows do not swim.
      orientation.lookAt(zero, dir, up); inverse.copy(orientation).invert();
      lightOrigin.copy(origin).applyMatrix4(inverse);
      for (const light of csm.lights) {
        const cam = light.shadow.camera, texel = (cam.right - cam.left) / csm.shadowMapSize;
        center.copy(light.position).applyMatrix4(inverse);
        delta.set(Math.floor((center.x + lightOrigin.x) / texel) * texel - lightOrigin.x - center.x,
          Math.floor((center.y + lightOrigin.y) / texel) * texel - lightOrigin.y - center.y, 0).applyMatrix4(orientation);
        light.position.add(delta); light.target.position.add(delta);
      }
    },
  };
}
