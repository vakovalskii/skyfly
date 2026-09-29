import * as THREE from 'three';
import { validateAnimations } from './animation-data.js';

// Automatic secondary motion around an authored pose. No swimming stroke, no change of silhouette.
export function makeAirCycle(base, state) {
  const options = {
    hover: { name: 'Зависание · живой корпус', duration: 3.2, sway: .014, bob: .035, limbs: .024 },
    fly: { name: 'Полёт · воздушный поток', duration: 2.4, sway: .009, bob: .012, limbs: .015 },
    boost: { name: 'Форсаж · стабилизация', duration: 1.2, sway: .003, bob: .003, limbs: .006 },
  }[state];
  if (!options) throw new Error('Неизвестное воздушное действие');
  const frames = Array.from({ length: 49 }, (_, i) => {
    const pose = structuredClone(base), phase = i === 48 ? 0 : i / 48 * Math.PI * 2;
    const wave = (shift = 0) => Math.sin(phase + shift) - Math.sin(shift);
    const rotate = (name, x, y, z) => {
      if (!pose.bones[name]) return;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...pose.bones[name]));
      q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)));
      pose.bones[name] = new THREE.Euler().setFromQuaternion(q).toArray().slice(0, 3);
    };
    if (i !== 0 && i !== 48) {
      pose.offset ||= [0, 0, 0];
      pose.offset[1] += wave() * options.bob;
      pose.tilt += wave(.4) * options.sway;
      rotate('DEF-spine002', wave(.25) * options.limbs * .5, 0, 0);
      rotate('DEF-spine003', -wave(.65) * options.limbs * .3, 0, 0);
      rotate('DEF-neck', -wave(.25) * options.limbs * .2, 0, 0);
      for (const [side, sign] of [['L', -1], ['R', 1]]) {
        rotate(`DEF-upper_arm${side}`, wave(.6) * options.limbs * .3, 0, sign * wave(.3) * options.limbs * .5);
        rotate(`DEF-forearm${side}`, wave(1) * options.limbs, 0, 0);
        rotate(`DEF-shin${side}`, wave(side === 'L' ? .8 : 1.4) * options.limbs * .7, 0, 0);
      }
    }
    return { time: i / 48 * options.duration, pose };
  });
  return validateAnimations({ clip: { name: options.name, duration: options.duration, loop: true, frames } }).clip;
}

// Generates copies and assigns them together. Existing user clips stay in the library.
export function createReadyActions(hero, input, id = () => crypto.randomUUID()) {
  if (Object.keys(input.animations).length > 61) throw new Error('Для набора нужны три свободных места');
  const result = structuredClone(input), preview = hero.userData.createPreview();
  try {
    preview.userData.setSetup(input);
    for (const state of ['hover', 'fly', 'boost']) {
      preview.userData.preview(state, 0);
      const animation = makeAirCycle(preview.userData.capturePose(), state), key = `ready-${state}-${id()}`;
      result.animations[key] = animation;
      result.clips[state] = 'custom:' + key;
      result.speed[state] = 1; delete result.poses[state];
    }
    return result;
  } finally {
    preview.userData.disposeAnimation();
    preview.traverse(o => { if (o.isMesh) o.material.dispose(); });
  }
}

// Straight, relaxed legs with pointed toes; preserve the user's upper-body pose.
export function createLevitation(hero, input) {
  const rig = hero.userData.createPreview(), bones = rig.userData.bones;
  try {
    rig.userData.setSetup(input); rig.userData.preview('hover', 0);
    const point = name => bones.get(name).getWorldPosition(new THREE.Vector3());
    function aim(name, child, vector) {
      const bone = bones.get(name), delta = new THREE.Quaternion().setFromUnitVectors(
        point(child).sub(point(name)).normalize(), new THREE.Vector3(...vector).normalize());
      const q = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(delta);
      bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q));
      rig.updateMatrixWorld(true);
    }
    for (const [side, sign] of [['L', -1], ['R', 1]]) {
      aim(`DEF-thigh${side}`, `DEF-shin${side}`, [sign * .065, -1, .025]);
      aim(`DEF-shin${side}`, `DEF-foot${side}`, [0, -1, .035]);
      aim(`DEF-foot${side}`, `DEF-toe${side}`, [0, -.96, -.28]);
    }
    const pose = rig.userData.capturePose();
    pose.offset ||= [0, 0, 0]; pose.offset[1] += .12;
    const clip = makeAirCycle(pose, 'hover'); clip.name = 'Зависание · левитация';
    return clip;
  } finally { rig.userData.disposeAnimation(); rig.traverse(o => { if (o.isMesh) o.material.dispose(); }); }
}
