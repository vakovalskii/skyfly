import * as THREE from 'three';
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function speedAuraLevels(speed, rho = 1) {
  const kmh = Math.max(0, speed) * 3.6, air = smooth(.005, .3, rho);
  return { streams: smooth(1000, 2000, kmh) * air, shell: smooth(2000, 3000, kmh) * air,
    rings: smooth(3000, 4000, kmh) * air, wake: smooth(4000, 5000, kmh) * air };
}

// Sparse broken wake behind the hero. No cone, hoops or bright wreath at the body.
export function createSpeedAura(parent) {
  const group = new THREE.Group(); group.name = 'High speed airflow'; parent.add(group);
  const count = 64, positions = new Float32Array(count * 9), colors = new Float32Array(count * 9);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true,
    depthWrite: false, depthTest: false, opacity: .09, toneMapped: false });
  const mesh = new THREE.Mesh(geometry, material); mesh.frustumCulled = false; group.add(mesh);
  const position = new THREE.Vector3(), direction = new THREE.Vector3(), z = new THREE.Vector3(0, 0, 1), rotation = new THREE.Quaternion();
  let time = 0;
  return {
    group,
    update(hero, velocity, speed, rho, dt, airborne = true) {
      time += dt;
      const level = speedAuraLevels(speed, rho), bone = hero?.userData.bones?.get('DEF-hips');
      group.visible = !!bone && airborne && level.streams > .001;
      if (!group.visible) return;
      parent.updateWorldMatrix(true, false); group.position.copy(parent.worldToLocal(bone.getWorldPosition(position)));
      direction.set(...velocity).normalize(); if (direction.lengthSq() < .5) { group.visible = false; return; }
      direction.applyQuaternion(parent.getWorldQuaternion(rotation).invert()); group.quaternion.setFromUnitVectors(z, direction);
      const active = Math.round(12 + 16 * level.shell + 16 * level.rings + 20 * level.wake);
      material.opacity = level.streams * (.065 + level.wake * .045);
      for (let i = 0; i < active; i++) {
        const life = (time * (1.2 + level.wake) + i * .618034) % 1, angle = i * 2.399963;
        const radius = 2.6 + (Math.sin(i * 12.3) * .5 + .5) * 6.5 + life * 3;
        const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius, depth = -3 - life * 22;
        const width = .06 + Math.abs(Math.cos(i * 7.3)) * .18, length = .35 + level.wake * .9;
        const coordinates = [x - width, y, depth, x + width, y + width * .3, depth - .13, x + width * .2, y - width, depth - length];
        positions.set(coordinates, i * 9);
        const shade = .45 + .35 * Math.sin(life * Math.PI);
        for (let j = 0; j < 3; j++) { colors[i * 9 + j * 3] = shade * .85; colors[i * 9 + j * 3 + 1] = shade * .9; colors[i * 9 + j * 3 + 2] = shade; }
      }
      geometry.setDrawRange(0, active * 3); geometry.attributes.position.needsUpdate = geometry.attributes.color.needsUpdate = true;
    },
    dispose() { parent.remove(group); geometry.dispose(); material.dispose(); },
  };
}
