// Герой: низкополигональный скелет из коробок + плащ. Позы задаём кодом — под полёт готовых
// анимаций нет ни в одной CC0-библиотеке, а так мы управляем «понтом» покадрово и весим килобайты.
// Хочешь готовую модель с костями — положи GLB и передай его в makeHero({ gltf }): позы лягут на кости по именам.
import * as THREE from 'three';

const SUIT = 0x1d3f8f, SUIT2 = 0x16307a, CAPE = 0xa4161a, SKIN = 0xd9a06b, BOOT = 0x8c1c20;

const box = (w, h, d, color, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshLambertMaterial({ color }));
  m.position.set(x, y, z);
  return m;
};
// сустав: группа с точкой вращения на краю
const joint = (x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); return g; };

export function makeHero({ scale = 1, cape = true } = {}) {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);

  const torso = box(0.46, 0.62, 0.26, SUIT, 0, 0, 0);
  body.add(torso);
  body.add(box(0.44, 0.22, 0.25, SUIT2, 0, -0.38, 0));            // пояс
  const head = box(0.24, 0.26, 0.24, SKIN, 0, 0.47, 0);
  const hair = box(0.26, 0.09, 0.25, 0x1b1b22, 0, 0.60, -0.01);
  body.add(head, hair);

  // руки: плечо → предплечье
  const armL = joint(0.30, 0.26, 0), armR = joint(-0.30, 0.26, 0);
  for (const [g, s] of [[armL, 1], [armR, -1]]) {
    const up = box(0.15, 0.34, 0.15, SUIT, s * 0.02, -0.17, 0);
    const fore = joint(0, -0.34, 0);
    fore.add(box(0.13, 0.32, 0.13, SUIT, 0, -0.16, 0));
    fore.add(box(0.15, 0.12, 0.16, BOOT, 0, -0.34, 0));            // перчатка
    g.add(up, fore);
    g.userData.fore = fore;
    body.add(g);
  }
  // ноги: бедро → голень
  const legL = joint(0.13, -0.46, 0), legR = joint(-0.13, -0.46, 0);
  for (const g of [legL, legR]) {
    g.add(box(0.18, 0.40, 0.18, SUIT2, 0, -0.20, 0));
    const shin = joint(0, -0.40, 0);
    shin.add(box(0.17, 0.38, 0.17, SUIT2, 0, -0.19, 0));
    shin.add(box(0.19, 0.14, 0.26, BOOT, 0, -0.40, 0.04));         // сапог
    g.add(shin);
    g.userData.shin = shin;
    body.add(g);
  }

  // плащ: полоса сегментов, которую гнём ветром
  const capeSegs = [];
  if (cape) {
    const anchor = joint(0, 0.30, -0.14);
    body.add(anchor);
    let parent = anchor;
    for (let i = 0; i < 6; i++) {
      const seg = joint(0, i === 0 ? 0 : -0.22, 0);
      const w = 0.52 - i * 0.03;
      const m = box(w, 0.23, 0.02, CAPE, 0, -0.115, 0);
      m.material.side = THREE.DoubleSide;
      seg.add(m);
      parent.add(seg);
      capeSegs.push(seg);
      parent = seg;
    }
  }

  root.scale.setScalar(scale);
  root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });

  const parts = { body, head, armL, armR, legL, legR, capeSegs };
  const tmp = new THREE.Vector3();

  // Позы. st: { speed, thrust, grounded, charge, power, up, turn }
  root.userData.pose = (t, st) => {
    const fast = Math.min(1, st.speed / 320);
    const lean = st.grounded ? 0 : THREE.MathUtils.clamp(st.pitchView, -1.1, 1.1);

    if (st.grounded) {
      // стойка: чуть качаемся, при зарядке приседаем и сжимаем кулаки
      const c = st.charge;
      body.rotation.set(c * 0.35, 0, 0);
      body.position.y = -c * 0.22 + Math.sin(t * 1.6) * 0.01;
      armL.rotation.set(-0.15 - c * 0.9, 0, 0.16 + c * 0.25);
      armR.rotation.set(-0.15 - c * 0.9, 0, -0.16 - c * 0.25);
      armL.userData.fore.rotation.x = -0.25 - c * 1.3;
      armR.userData.fore.rotation.x = -0.25 - c * 1.3;
      legL.rotation.set(c * 0.55, 0, 0.04); legR.rotation.set(c * 0.55, 0, -0.04);
      legL.userData.shin.rotation.x = -c * 1.1; legR.userData.shin.rotation.x = -c * 1.1;
    } else if (st.thrust && fast > 0.25) {
      // классика: одна рука вперёд кулаком, вторая вдоль тела, ноги в струну
      body.rotation.set(-1.15 + lean * 0.45, 0, Math.sin(t * 0.8) * 0.04 + st.turn * 0.5);
      body.position.y = 0;
      armL.rotation.set(-2.85, 0, 0.12);
      armR.rotation.set(-0.35 + Math.sin(t * 2.2) * 0.05, 0, -0.30);
      armL.userData.fore.rotation.x = -0.05;
      armR.userData.fore.rotation.x = -0.2;
      legL.rotation.set(0.06, 0, 0.05); legR.rotation.set(-0.02, 0, -0.05);
      legL.userData.shin.rotation.x = -0.05; legR.userData.shin.rotation.x = -0.02;
    } else {
      // зависание: вертикально, руки чуть в стороны, ноги слегка согнуты
      const b = Math.sin(t * 1.4) * 0.05;
      body.rotation.set(lean * 0.35 + b * 0.2, 0, st.turn * 0.35);
      body.position.y = b * 0.06;
      armL.rotation.set(-0.15, 0, 0.55 + b * 0.1);
      armR.rotation.set(-0.15, 0, -0.55 - b * 0.1);
      armL.userData.fore.rotation.x = -0.35;
      armR.userData.fore.rotation.x = -0.35;
      legL.rotation.set(0.25 + b * 0.1, 0, 0.08); legR.rotation.set(0.12 - b * 0.1, 0, -0.08);
      legL.userData.shin.rotation.x = -0.45; legR.userData.shin.rotation.x = -0.3;
    }

    // плащ: чем быстрее, тем ровнее вытянут назад, плюс волна
    for (let i = 0; i < capeSegs.length; i++) {
      const s = capeSegs[i];
      const w = Math.sin(t * (5 + fast * 8) - i * 0.7) * (0.12 - fast * 0.07);
      const back = st.grounded ? 0.1 + Math.sin(t * 1.2 - i * 0.5) * 0.05 : 0.35 + fast * 0.95;
      s.rotation.x = back * (i === 0 ? 0.6 : 0.5) + w * 0.5;
      s.rotation.z = w * (i * 0.2);
    }
  };
  root.userData.parts = parts;
  root.userData.dispose = () => root.traverse(o => {
    o.geometry?.dispose();
    if (o.material) for (const material of [].concat(o.material)) material.dispose();
  });
  return root;
}
