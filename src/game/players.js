// Другие игроки: держим их модели, сглаживаем позиции между снимками сервера, рисуем ники.
import * as THREE from 'three';
import { haversine, bearing } from '../core/grid.js';

const $ = (id) => document.getElementById(id);

export function createPlayers(scene, net, makeBody) {
  const remotes = new Map();
  const tmp = new THREE.Vector3();
  let factory = makeBody;

  return {
    remotes,
    // модель героя подгрузилась позже — пересоздаём всех
    setFactory(f) {
      factory = f;
      for (const [, r] of remotes) { scene.remove(r.obj); r.obj = factory(); scene.add(r.obj); }
    },
    update(p, dt, t, camera) {
      for (const [id, r] of remotes) if (!net.players.has(id)) { scene.remove(r.obj); r.tag.remove(); remotes.delete(id); }
      for (const [id, s] of net.players) {
        if (id === net.id) continue;
        let r = remotes.get(id);
        if (!r) {
          const obj = factory();
          obj.userData.perfCat = 'игроки';
          scene.add(obj);
          const tag = document.createElement('div');
          tag.className = 'tag';
          $('tags').append(tag);
          r = { obj, tag, pos: new THREE.Vector3() };
          remotes.set(id, r);
        }
        r.state = s;
        r.tag.textContent = s.name;
      }
      for (const [, r] of remotes) {
        const s = r.state; if (!s) continue;
        const d = haversine(p, s), br = bearing(p, s);
        r.pos.set(Math.sin(br) * d, s.alt - p.alt, -Math.cos(br) * d);
        r.obj.position.lerp(r.pos, 1 - Math.exp(-10 * dt));
        r.obj.rotation.y = -s.yaw;      // та же система координат, что и у своего героя
        r.obj.userData.pose(t, { speed: s.speed || 0, thrust: s.thrust, grounded: s.grounded, charge: 0, pitchView: s.pitch || 0, turn: 0 });
        const vis = d < 30_000;
        r.obj.visible = vis;
        if (vis) {
          tmp.copy(r.obj.position).project(camera);
          const on = tmp.z < 1 && Math.abs(tmp.x) < 1 && Math.abs(tmp.y) < 1;
          r.tag.style.display = on ? 'block' : 'none';
          r.tag.style.left = `${(tmp.x * 0.5 + 0.5) * 100}%`;
          r.tag.style.top = `${(-tmp.y * 0.5 + 0.5) * 100}%`;
        } else r.tag.style.display = 'none';
      }
    },
  };
}
