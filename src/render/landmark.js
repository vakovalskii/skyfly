// СТАРТОВАЯ БАШНЯ: дом, на крыше которого появляется герой, — не рядовая коробка. Стеклянный фасад
// (ячейка glass атласа), светящийся кант по краю крыши и световые рёбра по углам, вертолётная
// площадка с гербом прямо под ногами, красные заградительные огни и прожекторы в небо.
// Декор не участвует в столкновениях (всё плоское или выше опоры не выступает) и не бросает тени.
// Координаты — городские (x восток, z север), как у тайлов; группа ставится туда же, где тайл.
import * as THREE from 'three';
import { TAKRAM } from './takram.js';

// Материалы без освещения: takram умножает кадр на экспозицию ×6 — делим, иначе всё выгорает в белый
const GAIN = TAKRAM ? 1 / 6 : 1;
const RIM = new THREE.Color(0.35, 0.85, 1.6).multiplyScalar(GAIN * 1.6);   // чуть выше «белого» — неон
const GOLD = new THREE.Color(1.6, 1.05, 0.35).multiplyScalar(GAIN * 1.6);

function padTexture() {
  const S = 512, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const c = S / 2;
  g.fillStyle = '#1b2230'; g.beginPath(); g.arc(c, c, c - 2, 0, Math.PI * 2); g.fill();
  g.lineWidth = 14; g.strokeStyle = '#ffd35a'; g.beginPath(); g.arc(c, c, c - 20, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 4; g.strokeStyle = '#7fd8ff'; g.beginPath(); g.arc(c, c, c - 44, 0, Math.PI * 2); g.stroke();
  // герб — ромб-щит с изломанной полосой внутри
  const r = S * 0.3;
  g.beginPath(); g.moveTo(c, c + r); g.lineTo(c - r * 1.15, c - r * 0.2); g.lineTo(c - r * 0.75, c - r * 0.75);
  g.lineTo(c + r * 0.75, c - r * 0.75); g.lineTo(c + r * 1.15, c - r * 0.2); g.closePath();
  g.fillStyle = '#c8202a'; g.fill(); g.lineWidth = 10; g.strokeStyle = '#ffd35a'; g.stroke();
  g.lineWidth = 26; g.lineJoin = 'round'; g.strokeStyle = '#ffd35a';
  g.beginPath(); g.moveTo(c + r * 0.45, c - r * 0.5); g.lineTo(c - r * 0.45, c - r * 0.5); g.lineTo(c - r * 0.35, c - r * 0.05);
  g.lineTo(c + r * 0.35, c + r * 0.05); g.lineTo(c + r * 0.15, c + r * 0.45); g.lineTo(c - r * 0.3, c + r * 0.3); g.stroke();
  // разметка по кругу
  g.fillStyle = '#ffd35a';
  for (let i = 0; i < 24; i++) { const a = (i / 24) * Math.PI * 2; g.fillRect(c + Math.cos(a) * (c - 70) - 5, c + Math.sin(a) * (c - 70) - 5, 10, 10); }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// полоса-лента вдоль контура: вертикальный пояс от y0 до y1, чуть наружу от стены
function band(p, y0, y1, out = 0.08) {
  const n = p.length / 2, pos = [];
  for (let i = 0; i < n; i++) {
    const x1 = p[i * 2], z1 = p[i * 2 + 1], x2 = p[((i + 1) % n) * 2], z2 = p[((i + 1) % n) * 2 + 1];
    const len = Math.hypot(x2 - x1, z2 - z1) || 1, nx = (z2 - z1) / len * out, nz = -(x2 - x1) / len * out;
    const a = [x1 + nx, -(z1 + nz)], b = [x2 + nx, -(z2 + nz)];
    pos.push(a[0], y0, a[1], b[0], y0, b[1], b[0], y1, b[1], a[0], y0, a[1], b[0], y1, b[1], a[0], y1, a[1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

// spot — [x, z, высота опоры] точки героя; padPoly — контур, в который вписываем площадку
export function createLandmark(b, spot, padPoly = b.p) {
  const group = new THREE.Group();
  group.userData.perfCat = 'стартовая башня';
  group.userData.noCast = true;
  group.matrixAutoUpdate = false;
  const { p, h } = b;
  const n = p.length / 2;
  const glow = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });

  // кант по крыше и пояса через каждые 24 м по фасаду
  group.add(new THREE.Mesh(band(p, h - 0.6, h + 0.25), glow(RIM)));
  for (let y = 24; y < h - 6; y += 24) group.add(new THREE.Mesh(band(p, y - 0.15, y + 0.15), glow(GOLD, 0.85)));

  if (padPoly !== p) group.add(new THREE.Mesh(band(padPoly, spot[2] - 0.4, spot[2] + 0.2), glow(GOLD)));   // кант надстройки
  // световые рёбра на углах (где контур заметно поворачивает)
  const ribs = [], lights = [];
  for (let i = 0; i < n; i++) {
    const x0 = p[((i - 1 + n) % n) * 2], z0 = p[((i - 1 + n) % n) * 2 + 1], x1 = p[i * 2], z1 = p[i * 2 + 1];
    const x2 = p[((i + 1) % n) * 2], z2 = p[((i + 1) % n) * 2 + 1];
    const a1 = Math.atan2(z1 - z0, x1 - x0), a2 = Math.atan2(z2 - z1, x2 - x1);
    let turn = Math.abs(a2 - a1); if (turn > Math.PI) turn = 2 * Math.PI - turn;
    if (turn > 0.5) { ribs.push([x1, z1]); lights.push([x1, z1]); }
  }
  const rg = new THREE.BoxGeometry(0.35, 1, 0.35); rg.translate(0, 0.5, 0);
  const rib = new THREE.InstancedMesh(rg, glow(RIM), Math.max(1, ribs.length));
  const m4 = new THREE.Matrix4();
  ribs.forEach(([x, z], i) => rib.setMatrixAt(i, m4.makeScale(1, h, 1).setPosition(x, 0, -z)));
  rib.count = ribs.length;
  group.add(rib);

  // заградительные огни на углах — мигают
  const lampG = new THREE.SphereGeometry(0.45, 10, 8);
  const lampM = new THREE.MeshBasicMaterial({ color: new THREE.Color() });
  const lamps = new THREE.InstancedMesh(lampG, lampM, Math.max(1, lights.length));
  lights.forEach(([x, z], i) => lamps.setMatrixAt(i, m4.makeTranslation(x, h + 0.7, -z)));
  lamps.count = lights.length;
  group.add(lamps);

  // вертолётная площадка под ногами героя: по размеру крыши — до ближайшей стены
  let edge = Infinity;
  const q = padPoly, qn = q.length / 2;
  for (let i = 0; i < qn; i++) {
    const x1 = q[i * 2], z1 = q[i * 2 + 1], x2 = q[((i + 1) % qn) * 2], z2 = q[((i + 1) % qn) * 2 + 1];
    const dx = x2 - x1, dz = z2 - z1, L = dx * dx + dz * dz || 1;
    const k = Math.max(0, Math.min(1, ((spot[0] - x1) * dx + (spot[1] - z1) * dz) / L));
    edge = Math.min(edge, Math.hypot(spot[0] - x1 - k * dx, spot[1] - z1 - k * dz));
  }
  const R = Math.max(2.5, Math.min(7, edge - 0.6));
  const pad = new THREE.Mesh(new THREE.CircleGeometry(R, 64), new THREE.MeshBasicMaterial({ map: padTexture(), color: new THREE.Color().setScalar(GAIN * 1.3), transparent: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  pad.rotation.x = -Math.PI / 2;
  pad.position.set(spot[0], spot[2] + 0.04, -spot[1]);
  group.add(pad);
  const ring = new THREE.Mesh(new THREE.RingGeometry(R + 0.1, R + 0.4, 64), glow(GOLD));
  ring.rotation.x = -Math.PI / 2;
  ring.position.copy(pad.position).y += 0.01;
  group.add(ring);

  // прожекторы: четыре конуса с дальних углов, медленно ходят по небу; днём еле видны
  const coneG = new THREE.ConeGeometry(30, 1400, 32, 1, true); coneG.translate(0, -700, 0); coneG.rotateX(Math.PI);
  const beamM = new THREE.ShaderMaterial({
    uniforms: { uA: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying float vT; void main(){ vT = position.y / 1400.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform float uA; varying float vT; void main(){ gl_FragColor = vec4(vec3(0.75, 0.9, 1.0) * uA * pow(1.0 - vT, 1.6) * smoothstep(0.0, 0.03, vT), 1.0); }',
  });
  const far = [...lights].sort((a, b2) => Math.hypot(b2[0] - spot[0], b2[1] - spot[1]) - Math.hypot(a[0] - spot[0], a[1] - spot[1])).slice(0, 4);
  const beams = far.map(([x, z], i) => {
    const m = new THREE.Mesh(coneG, beamM);
    m.position.set(x, h + 0.5, -z);
    m.userData.ph = i * 1.7;
    m.frustumCulled = false;
    group.add(m);
    return m;
  });

  return {
    group,
    // tileMesh — текущий меш квартала (берём его положение и растяжку по X); night 0..1
    update(tileMesh, t, night) {
      if (tileMesh) { group.position.copy(tileMesh.position); group.scale.copy(tileMesh.scale); }
      group.visible = !!tileMesh?.visible;
      group.updateMatrix();
      lampM.color.setRGB(3, 0.2, 0.15).multiplyScalar(GAIN * (Math.sin(t * 3) > 0.2 ? 1 : 0.08));
      beamM.uniforms.uA.value = 0.22 * night * GAIN * 3;           // днём прожекторов не видно — не рисуем
      for (const m of beams) {
        m.visible = night > 0.05;
        const a = t * 0.25 + m.userData.ph;
        m.rotation.set(0.35 * Math.sin(a), 0, 0.35 * Math.cos(a * 0.8));
      }
    },
  };
}
