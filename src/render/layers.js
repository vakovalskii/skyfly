// СЛОИ АТМОСФЕРЫ: пробиваешь границу на скорости — по её плоскости расходятся неоднородные клочья дымки
// цвета слоя, камера вздрагивает, внизу подпись. Чем ниже граница (плотнее воздух), тем сильнее удар.
// Границы — настоящие: тропопауза, озоновый слой, стратопауза, мезопауза (серебристые облака),
// линия Кармана. Дымка висит на высоте границы и остаётся на месте, пока герой летит дальше.
import * as THREE from 'three';

export const LAYERS = [
  { alt: 11_000, name: 'Тропопауза · 11 км — кончилась погода, дальше стратосфера', color: 0xcfe6ff },
  { alt: 25_000, name: 'Озоновый слой · 25 км', color: 0x7fe0ff },
  { alt: 50_000, name: 'Стратопауза · 50 км — дальше мезосфера', color: 0xffb070 },
  { alt: 85_000, name: 'Мезопауза · 85 км — серебристые облака, здесь сгорают метеоры', color: 0x9fd4ff },
  { alt: 100_000, name: 'Линия Кармана · 100 км — граница космоса', color: 0xc38bff },
];

// Какие границы пересекли за шаг (снизу вверх или сверху вниз) — для проверки без браузера
export function crossed(prevAlt, alt) {
  const lo = Math.min(prevAlt, alt), hi = Math.max(prevAlt, alt);
  return LAYERS.filter((L) => L.alt > lo && L.alt <= hi);
}
// сила удара: плотнее воздух и быстрее пробой — сильнее
export const punch = (speed, rho) => Math.min(1, (0.25 + Math.min(1, rho * 6)) * Math.min(1, speed / 600));

const V = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const F = `
uniform vec3 uColor; uniform float uA, uT;
varying vec2 vUv;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
void main(){
  vec2 p=(vUv-.5)*2.;
  float n=noise(p*4.+vec2(uT*.9,-uT*.5))*.65+noise(p*9.-uT)*.35;
  float cloud=(1.-smoothstep(.25+n*.2,.75+n*.2,length(p)))*smoothstep(.25,.75,n);
  float a=uA*cloud*.32;
  gl_FragColor = vec4(uColor, a);
}`;

export function createLayers(overlay) {
  const pool = [];
  const geo = new THREE.PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);                                // горизонтально — по плоскости границы
  function spawn(color, k) {
    let m = pool.find((q) => !q.visible);
    if (!m) {
      m = new THREE.Mesh(geo, new THREE.ShaderMaterial({ vertexShader: V, fragmentShader: F,
        uniforms: { uColor: { value: new THREE.Color() }, uA: { value: 0 }, uT: { value: 0 } },
        transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide, blending: THREE.NormalBlending }));
      m.frustumCulled = false; m.renderOrder = 7;
      overlay.add(m); pool.push(m);
    }
    m.material.uniforms.uColor.value.set(color);
    m.userData = { t: 0, k, life: 1.6 };
    m.position.set(0, 0.9, 0);
    m.visible = true;
  }
  let prevAlt = null;
  return {
    // velScene — скорость в осях сцены; hit(layer, k) — вызывается при пробое (подпись, тряска)
    update(dt, alt, velScene, speed, rho, flying, hit) {
      if (prevAlt !== null && flying && speed > 150) {
        for (const L of crossed(prevAlt, alt)) {
          const k = punch(speed, rho);
          spawn(L.color, k);
          hit?.(L, k);
        }
      }
      prevAlt = alt;
      for (const m of pool) {
        if (!m.visible) continue;
        const u = m.userData;
        u.t += dt;
        const x = u.t / u.life;
        if (x >= 1) { m.visible = false; continue; }
        // дымка остаётся в мире, пока герой улетает
        m.position.addScaledVector(velScene, -dt);
        const s = 30 + 1400 * u.k * (1 - (1 - x) ** 3);            // до ~1.4 км в поперечнике
        m.scale.set(s, 1, s);
        m.material.uniforms.uT.value = x;
        m.material.uniforms.uA.value = (0.5 + 0.9 * u.k) * (1 - x) ** 1.5;
      }
    },
  };
}
