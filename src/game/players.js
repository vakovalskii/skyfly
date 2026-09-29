// Другие игроки: держим их модели, сглаживаем позиции между снимками сервера, рисуем ники.
import * as THREE from 'three';
import { haversine, bearing } from '../core/grid.js';

const $ = (id) => document.getElementById(id);
const RANGE = 3000, KEEP_RANGE = 4000, MAX_BODIES = 48;

export function createPlayers(scene, net, makeBody) {
  const remotes = new Map();
  const tmp = new THREE.Vector3();
  let factory = makeBody;
  function remove(id, r) {
    scene.remove(r.obj);
    r.obj.userData.dispose?.();
    r.tag.remove();
    remotes.delete(id);
  }

  return {
    remotes,
    // модель героя подгрузилась позже — пересоздаём всех
    setFactory(f) {
      factory = f;
      for (const [id, r] of remotes) remove(id, r);
    },
    update(p, dt, t, camera) {
      const nearby = [];
      for (const [id, s] of net.players) {
        if (id === net.id) continue;
        const d = haversine(p, s), distance = Math.hypot(d, s.alt - p.alt);
        if (distance < (remotes.has(id) ? KEEP_RANGE : RANGE)) nearby.push({ id, s, d, distance });
      }
      nearby.sort((a, b) => a.distance - b.distance);
      nearby.length = Math.min(nearby.length, MAX_BODIES);
      const wanted = new Set(nearby.map(r => r.id));
      for (const [id, r] of remotes) if (!wanted.has(id)) remove(id, r);
      // Instantiating a skinned character and cloth is expensive. Spread arrivals
      // over frames; the network roster/minimap retains every player immediately.
      let created = 0;
      for (const { id, s, d, distance } of nearby) {
        const br = bearing(p, s);
        tmp.set(Math.sin(br) * d, s.alt - p.alt, -Math.cos(br) * d);
        let r = remotes.get(id);
        if (!r) {
          if (created >= 1) continue;
          created++;
          const obj = factory({ remote: true });
          obj.userData.perfCat = 'игроки';
          scene.add(obj);
          const tag = document.createElement('div');
          tag.className = 'tag';
          $('tags').append(tag);
          obj.position.copy(tmp);
          r = { obj, tag, poseAt: -Infinity };
          remotes.set(id, r);
        }
        if (r.tag.textContent !== s.name) r.tag.textContent = s.name;
        r.obj.position.lerp(tmp, 1 - Math.exp(-10 * dt));
        r.obj.rotation.y = -s.yaw;      // та же система координат, что и у своего героя
        tmp.copy(r.obj.position).project(camera);
        const on = tmp.z >= -1 && tmp.z < 1 && Math.abs(tmp.x) < 1 && Math.abs(tmp.y) < 1;
        // Keep nearby offscreen bodies for their shadows. Distant offscreen
        // skeletons and cloth do no work; allow a margin at the screen edge.
        const vis = distance < RANGE && (distance < 40 || (tmp.z >= -1 && tmp.z < 1 && Math.abs(tmp.x) < 1.2 && Math.abs(tmp.y) < 1.2));
        r.obj.visible = vis;
        if (vis && (distance < 80 || t - r.poseAt >= .05)) {
          r.obj.userData.pose(t, { speed: s.speed || 0, thrust: s.thrust, grounded: s.grounded, charge: 0,
            pitchView: s.pitch || 0, turn: 0, dt: Math.min(.05, t - r.poseAt), verticalSpeed: s.vel?.[1] || 0 });
          r.poseAt = t;
        }
        if (vis) {
          r.tag.style.display = on ? 'block' : 'none';
          r.tag.style.left = `${(tmp.x * 0.5 + 0.5) * 100}%`;
          r.tag.style.top = `${(-tmp.y * 0.5 + 0.5) * 100}%`;
        } else r.tag.style.display = 'none';
      }
    },
  };
}
