// Камера от третьего лица. Все расстояния — в метрах и отсчитаны от роста человека (1.75 м),
// иначе на глаз выходит то «муравей на карте», то «объектив в затылке».
//
// Пешком:  4.5 м назад, 2.6 м вверх, смотрим в грудь — обычный вид экшена от третьего лица.
// Падение: при быстром падении чуть выше и дальше, взгляд ниже — видно, как надвигается земля.
// Полёт:   отъезжает со скоростью (до ~22 м) и расширяет объектив — чувствуется разгон.
//
// Ноль сцены — НОГИ персонажа, поэтому все высоты считаем от нуля-ног.
import * as THREE from 'three';
import { R } from '../core/grid.js';

const VIEW = {
  ground: { back: 4.5, up: 2.6, look: 1.25, fov: 62 },
  air: { back: 6.0, up: 3.2, look: 1.0, fov: 68 },
  fly: { back: 9.0, up: 2.8, look: 1.2, fov: 70 },
};

export function createChaseCamera(mobile) {
  const camera = new THREE.PerspectiveCamera(mobile ? 70 : 62, innerWidth / innerHeight, 0.25, R * 4);
  const pos = new THREE.Vector3(0, 2.6, 4.5);
  const want = new THREE.Vector3(), look = new THREE.Vector3(), bodyUp = new THREE.Vector3();
  let shake = 0, snap = true, fallK = 0, floorY = null;
  const dirA = new THREE.Vector3(), dirB = new THREE.Vector3();

  addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

  return {
    camera,
    snap() { snap = true; },
    kick(k) { shake = Math.max(shake, k); },
    get distance() { return pos.length(); },

    // c — персонаж, fwd — направление взгляда в координатах сцены, floorAt(точка) — пол под камерой
    update(c, dt, speed, fwd, floorAt) {
      const v = VIEW[c.mode] || VIEW.ground;
      // Падение: чем быстрее летим вниз, тем выше и дальше камера и тем ниже взгляд —
      // видно героя сверху-сзади и землю, которая на него надвигается.
      const fallTarget = c.mode === 'air' ? Math.min(1, Math.max(0, (-c.vel[1] - 14) / 40)) : 0;   // обычный прыжок не трогает
      fallK += (fallTarget - fallK) * (1 - Math.exp(-(fallTarget > fallK ? 2.5 : 6) * dt));
      const portrait = mobile && camera.aspect < .8 ? 1.2 : 1;
      const back = (v.back + (c.mode === 'fly' ? Math.min(4, speed / 120) : Math.min(1.5, speed / 8)) + fallK * 4) * portrait;
      const up = v.up + (c.mode === 'fly' ? Math.min(2.5, speed / 220) : 0) + fallK * 4.5;

      const flat = Math.hypot(fwd.x, fwd.z) || 1;
      if (c.mode === 'fly') {
        // Полёт — как у самолёта: камера позади вдоль взгляда и чуть «над спиной»
        // (перпендикуляр к взгляду), поэтому герой всегда в центре кадра, а наклоняется мир.
        bodyUp.set(0, 1, 0).addScaledVector(fwd, -fwd.y).normalize();
        want.copy(fwd).multiplyScalar(-back).addScaledVector(bodyUp, up * 0.6);
      } else {
        // пешком и в падении — строго за спиной по горизонтали; при взгляде вверх/вниз камера идёт следом
        want.set((-fwd.x / flat) * back, up - fwd.y * back * 0.35, (-fwd.z / flat) * back);
      }
      if (snap) { pos.copy(want); snap = false; floorY = null; }
      else {
        // Догоняем по дуге, а не по хорде: при повороте камера раньше «подъезжала» к герою и отъезжала
        // (дрожь на развороте). Направление и расстояние сглаживаем отдельно.
        const k = 1 - Math.exp(-(c.mode === 'fly' ? 6 : 12) * dt);
        const la = pos.length(), lb = want.length();
        dirA.copy(pos).divideScalar(la || 1); dirB.copy(want).divideScalar(lb || 1);
        dirA.lerp(dirB, k).normalize();
        pos.copy(dirA).multiplyScalar(la + (lb - la) * k);
      }
      camera.position.copy(pos);

      // Не влезаем в пол: минимум полметра над опорой под камерой. Граница сглажена — вверх быстро,
      // вниз медленно: на крыше камера при повороте проходит над краем, пол под ней скачет
      // «крыша ↔ улица», и жёсткий порог дёргал кадр.
      const f = floorAt(pos) + 0.5;
      if (floorY === null) floorY = f;
      floorY += (f - floorY) * (1 - Math.exp(-(f > floorY ? 30 : 3) * dt));
      camera.position.y = Math.max(camera.position.y, floorY);

      if (shake > 0) {
        shake = Math.max(0, shake - dt * 1.8);
        const a = shake * shake * 0.8;
        camera.position.x += (Math.random() - 0.5) * a;
        camera.position.y += (Math.random() - 0.5) * a;
      }

      // смотрим в грудь и немного вперёд по взгляду
      const ahead = c.mode === 'fly' ? 12 : 4 * (1 - fallK);
      if (c.mode === 'fly') look.copy(fwd).multiplyScalar(ahead).addScaledVector(bodyUp, v.look);
      else look.set(fwd.x * ahead, v.look + fwd.y * ahead * (1 - fallK) - fallK * 3, fwd.z * ahead);
      camera.lookAt(look);

      const fov = v.fov + (c.mode === 'fly' ? Math.min(14, speed / 40) : fallK * 5);
      camera.fov += (fov - camera.fov) * (1 - Math.exp(-6 * dt));   // не зависит от частоты кадров
      // ближняя плоскость не дальше пары метров: камера в 5–13 м от героя, раньше на 10 км near = 15 м отсекал его
      camera.near = Math.min(2, Math.max(0.15, c.alt * 0.0015));
      camera.far = c.alt > 20_000 ? R * 3 : 120_000;
      camera.updateProjectionMatrix();
      return back;
    },
  };
}
