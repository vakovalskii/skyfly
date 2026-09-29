// Дымные порывы при взлёте/ударе и вспышка на экране.
import * as THREE from 'three';
import { createSmokeBursts } from './smoke.js';

const $ = (id) => document.getElementById(id);

export function createFx(scene) {
  const smoke = createSmokeBursts(scene), velocity = new THREE.Vector3();

  return {
    // ударная волна: взлёт, посадка, переход звука
    shock(power = 1) {
      smoke.emit({ power, spread: 4 + power * 6, rise: .8, origin: new THREE.Vector3(0, .05, 0) });
    },
    // вспышка на весь экран
    flash(k = 1) {
      const f = $('flash');
      f.style.transition = 'none'; f.style.opacity = String(0.55 * k);
      requestAnimationFrame(() => { f.style.transition = 'opacity .5s'; f.style.opacity = '0'; });
    },
    update(dt, speed, fwd) {
      smoke.update(dt, velocity.copy(fwd).multiplyScalar(speed));
    },
  };
}
