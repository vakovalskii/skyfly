import * as THREE from 'three';
import { fromLocal, toLocal } from '../core/grid.js';

// Occasional distant cloud-to-ground strikes. The bolt stays over its geographic
// location while the hero moves; thunder arrives later, at the speed of sound.
export function createStorm(scene, onThunder, random = Math.random) {
  const group = new THREE.Group();
  group.name = 'Distant lightning'; group.userData.noCast = true;
  scene.add(group);
  const light = new THREE.HemisphereLight(0xb8caff, 0x566488, 0);
  scene.add(light);
  let next = 8, age = 10, anchor = null, elapsed = 0;
  const pending = [];
  const core = new THREE.MeshBasicMaterial({ color: 0xe4edff, toneMapped: false });
  const glow = new THREE.MeshBasicMaterial({ color: 0x809bff, transparent: true, opacity: .12, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const clear = () => { for (const child of [...group.children]) { group.remove(child); child.geometry.dispose(); } };
  function addPath(points, radius) {
    const curve = new THREE.CurvePath();
    for (let i = 1; i < points.length; i++) curve.add(new THREE.LineCurve3(points[i - 1], points[i]));
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, points.length * 3, radius, 4, false), core));
    group.add(new THREE.Mesh(new THREE.TubeGeometry(curve, points.length * 3, radius * 5, 4, false), glow));
  }
  function strike(c, ground, floorAt) {
    clear(); age = 0;
    const bearing = c.yaw + (random() - .5) * 1.1, distance = 650 + random() * 1300;
    const east = Math.sin(bearing) * distance, north = Math.cos(bearing) * distance;
    const [lat, lon] = fromLocal(east, north, c.lat, c.lon);
    const floor = floorAt(east, north), top = Math.max(floor + 400, ground + 1100 + random() * 400);
    anchor = { lat, lon, alt: floor };
    const points = [];
    for (let i = 0; i <= 22; i++) {
      const k = i / 22, spread = Math.sin(k * Math.PI) * 85;
      points.push(new THREE.Vector3((random() - .5) * spread, (1 - k) * (top - floor), (random() - .5) * spread));
    }
    addPath(points, .85);
    for (const index of [6, 11, 15]) {
      const branch = [points[index].clone()], side = random() < .5 ? -1 : 1;
      for (let j = 1; j <= 5; j++) branch.push(points[index].clone().add(new THREE.Vector3(side * j * 24 + random() * 15, -j * 28, j * 8)));
      addPath(branch, .35);
    }
    pending.push({ at: elapsed + Math.hypot(distance, c.alt - (top + floor) / 2) / 343, gain: .6 });
  }
  return {
    group,
    update(dt, c, ground, floorAt) {
      elapsed += dt; age += dt; next -= dt;
      if (next <= 0 && c.alt - ground < 6500) { strike(c, ground, floorAt); next = 24 + random() * 18; }
      if (anchor) {
        const [east, north] = toLocal(anchor.lat, anchor.lon, c.lat, c.lon);
        group.position.set(east, anchor.alt - c.alt, -north);
      }
      group.visible = age < .65;
      const flash = age < .12 ? 1 - age / .12 : age > .23 && age < .42 ? .55 * (1 - (age - .23) / .19) : 0;
      core.color.setRGB(.18 + flash * .7, .23 + flash * .7, .32 + flash * .68);
      glow.opacity = .12 * flash; light.intensity = .35 * flash;
      if (age >= .65 && group.children.length) clear();
      for (let i = pending.length - 1; i >= 0; i--) if (pending[i].at <= elapsed) {
        onThunder(pending[i].gain); pending.splice(i, 1);
      }
    },
  };
}
