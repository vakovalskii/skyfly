import * as THREE from 'three';
import { BOOST_RELEASE_PHASE } from './flight-cues.js';
import { createSmokeCloud } from './smoke.js';

// The studio and game share the same diffuse hover / charging mist.
export function createFlightAura(parent, { depthTest = true } = {}) {
  const group = new THREE.Group(); group.name = 'Flight aura'; parent.add(group);
  const count = 72, cloud = createSmokeCloud(count, { depthTest }); group.add(cloud.mesh);
  const head = new THREE.Vector3(), hips = new THREE.Vector3(), feet = new THREE.Vector3(), otherFoot = new THREE.Vector3();
  const axis = new THREE.Vector3(), side = new THREE.Vector3(), cross = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), point = new THREE.Vector3();
  const clamp = THREE.MathUtils.clamp;
  return {
    group,
    update(hero, camera, height = 800) {
      const visual = hero?.userData.flightVisual, bones = hero?.userData.bones;
      const charging = visual?.state === 'booststart', hovering = ['hover', 'flystart', 'flystop'].includes(visual?.state);
      group.visible = !!bones && (charging || hovering);
      if (!group.visible) return;
      const hipBone = bones.get('DEF-hips'), headBone = bones.get('DEF-head');
      const left = bones.get('DEF-toeL') || bones.get('DEF-footL'), right = bones.get('DEF-toeR') || bones.get('DEF-footR');
      if (!hipBone || !headBone || !left || !right) { group.visible = false; return; }
      group.updateWorldMatrix(true, false);
      group.worldToLocal(hipBone.getWorldPosition(hips)); group.worldToLocal(headBone.getWorldPosition(head));
      group.worldToLocal(left.getWorldPosition(feet)); group.worldToLocal(right.getWorldPosition(otherFoot)); feet.lerp(otherFoot, .5);
      axis.copy(head).sub(hips).normalize();
      side.crossVectors(axis, Math.abs(axis.y) > .9 ? new THREE.Vector3(1, 0, 0) : up).normalize(); cross.crossVectors(axis, side);
      const time = visual.time || 0, phase = clamp(time / Math.max(.01, visual.duration), 0, 1);
      const hoverFade = visual.state === 'flystart' ? 1 - THREE.MathUtils.smoothstep(phase, 0, .6)
        : visual.state === 'flystop' ? THREE.MathUtils.smoothstep(phase, .3, 1) : 1;
      const charge = clamp(phase / .533, 0, 1), burst = clamp((phase - BOOST_RELEASE_PHASE) / .25, 0, 1);
      const strength = charging ? Math.sin(Math.min(1, phase / .12) * Math.PI / 2) * (1 - burst) : hoverFade;
      for (let i = 0; i < count; i++) {
        const life = (time * .42 + i * .61803398875) % 1, seed = (i * .754877) % 1;
        const angle = i * 17.312 + time * .4;
        let size, opacity;
        if (charging) {
          const radius = (.25 + seed * .65) * (1 - charge * .32) + burst * (1 + seed);
          point.copy(hips).addScaledVector(axis, -.5 + life * 1.2 - burst * 1.6)
            .addScaledVector(side, Math.cos(angle) * radius).addScaledVector(cross, Math.sin(angle) * radius * .7);
          size = .35 + seed * .5 + burst * .65; opacity = (.08 + .1 * charge) * strength * Math.sin(life * Math.PI);
        } else {
          const radius = (.08 + life * .48) * (.6 + seed * .4);
          point.copy(feet); point.x += Math.cos(angle) * radius; point.z += Math.sin(angle) * radius;
          point.y -= .05 + life * .7;
          size = .22 + life * .55; opacity = Math.sin(life * Math.PI) ** 2 * .16 * strength;
        }
        cloud.set(i, point.x, point.y, point.z, size, opacity);
      }
      cloud.update(time, height);
    },
    dispose() { parent.remove(group); cloud.dispose(); },
  };
}
