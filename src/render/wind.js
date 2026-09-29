// Ветер: штрихи воздуха, летящие навстречу. Игрок всегда в нуле, поэтому частицы
// просто двигаются на -скорость и заворачиваются обратно в шар радиуса R_.
// Чем плотнее воздух и быстрее полёт — тем длиннее и ярче штрих; в космосе ветра нет.
import * as THREE from 'three';
import { createSmokeBursts } from './smoke.js';

const R_ = 70;

export function createWind(scene, mobile) {
  const N = mobile ? 180 : 420;
  const pts = new Float32Array(N * 3);
  const pieces = 4;
  const pos = new Float32Array(N * pieces * 18); // two triangles per torn gust fragment
  const colors = new Float32Array(pos.length);
  for (let i = 0; i < N; i++) {
    const u = Math.random() * 2 - 1, a = Math.random() * 6.283, r = R_ * Math.cbrt(Math.random());
    const s = Math.sqrt(1 - u * u);
    pts[i * 3] = r * s * Math.cos(a); pts[i * 3 + 1] = r * u; pts[i * 3 + 2] = r * s * Math.sin(a);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  for (let i = 0; i < colors.length / 3; i++) {
    const shade = .4 + .5 * Math.abs(Math.sin(Math.floor(i / 6) * 13.7));
    colors[i * 3] = shade * .84; colors[i * 3 + 1] = shade * .92; colors[i * 3 + 2] = shade;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0, depthWrite: false, toneMapped: false });
  const lines = new THREE.Mesh(g, mat); lines.name = 'Broken wind and dust';
  lines.frustumCulled = false;
  scene.add(lines);

  const v = new THREE.Vector3(), dir = new THREE.Vector3(), side = new THREE.Vector3(), bend = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0), sideways = new THREE.Vector3(1, 0, 0);
  return {
    update(dt, vel, rho, alt) {
      const speed = Math.hypot(vel[0], vel[1], vel[2]);
      const k = Math.min(1, (speed - 45) / 420) * Math.min(1, rho * 1.6);
      lines.visible = k > 0.02 && alt < 60_000;
      if (!lines.visible) { mat.opacity = 0; return; }
      mat.opacity = 0.035 + k * 0.095;
      g.setDrawRange(0, Math.round(N * (.3 + k * .7)) * pieces * 6);
      v.set(-vel[0], -vel[1], -vel[2]);
      const len = Math.min(14, 1.2 + speed * 0.022);
      dir.copy(v).normalize();
      side.crossVectors(dir, Math.abs(dir.y) > .9 ? sideways : up).normalize(); bend.crossVectors(dir, side);
      dir.multiplyScalar(len);
      const mx = v.x * dt, my = v.y * dt, mz = v.z * dt;
      for (let i = 0; i < N; i++) {
        let x = pts[i * 3] + mx, y = pts[i * 3 + 1] + my, z = pts[i * 3 + 2] + mz;
        if (x * x + y * y + z * z > R_ * R_) {          // улетел — бросаем обратно навстречу
          const u = Math.random() * 2 - 1, a = Math.random() * 6.283, s = Math.sqrt(1 - u * u);
          const rr = R_ * (0.85 + Math.random() * 0.15);
          x = -v.x / speed * rr + rr * s * Math.cos(a) * 0.5;
          y = -v.y / speed * rr + rr * u * 0.5;
          z = -v.z / speed * rr + rr * s * Math.sin(a) * 0.5;
        }
        pts[i * 3] = x; pts[i * 3 + 1] = y; pts[i * 3 + 2] = z;
        for (let piece = 0; piece < pieces; piece++) for (let vertex = 0; vertex < 6; vertex++) {
          const corner = [0, 1, 2, 0, 2, 3][vertex], end = corner >= 2 ? 1 : 0;
          // More irregular at ordinary flight speeds; faster flow still has gaps.
          const t = (piece + end * .68) / pieces;
          const jitter = (.16 + (1 - k) * .35) * Math.sin(i * 12.31 + (piece + end) * 2.3);
          const wobble = jitter * Math.cos(i * 4.1 + piece);
          const flap = (.07 + Math.abs(Math.sin(i * 8.1 + piece)) * .32) * (end ? .25 : 1) * (corner === 0 || corner === 3 ? -1 : 1);
          const angle = i * 2.4 + piece * .7, sideOffset = jitter + Math.cos(angle) * flap, bendOffset = wobble + Math.sin(angle) * flap;
          const index = (i * pieces * 6 + piece * 6 + vertex) * 3;
          pos[index] = x + dir.x * t + side.x * sideOffset + bend.x * bendOffset;
          pos[index + 1] = y + dir.y * t + side.y * sideOffset + bend.y * bendOffset;
          pos[index + 2] = z + dir.z * t + side.z * sideOffset + bend.z * bendOffset;
        }
      }
      g.attributes.position.needsUpdate = true;
    },
  };
}

// Sound-barrier release: broken vapor puffs instead of an expanding hard shell.
export function createBoomCone(parent) {
  const smoke = createSmokeBursts(parent, 3), drift = new THREE.Vector3();
  return {
    fire() { smoke.emit({ power: .8, spread: 7, life: 1.2, rise: 1.1, origin: new THREE.Vector3(0, .9, 0) }); },
    update(dt, fwd) { drift.copy(fwd).multiplyScalar(14); smoke.update(dt, drift); },
    dispose() { smoke.dispose(); },
  };
}
