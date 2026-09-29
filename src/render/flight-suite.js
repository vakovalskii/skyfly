// Варианты строятся из авторского кадра на настоящем скелете, с сохранением длины костей.
import * as THREE from 'three';
import { validateAnimations } from './animation-data.js';

export function createFlightSuite(hero, source) {
  const input = validateAnimations({ source }).source;
  const original = input.frames[0].pose;
  const rig = hero.userData.createPreview();
  const bones = rig.userData.bones;
  const setup = structuredClone(rig.userData.getSetup());
  setup.animations['suite-source'] = { ...input, frames: [{ time: 0, pose: original }] };
  setup.clips.fly = 'custom:suite-source';
  rig.userData.setSetup(setup);
  const v = () => new THREE.Vector3();
  const world = (name) => bones.get(name).getWorldPosition(v());
  function rotateWorld(bone, delta) {
    const q = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(delta);
    bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q));
    rig.updateMatrixWorld(true);
  }
  function aim(name, child, direction) {
    rig.updateMatrixWorld(true);
    const delta = new THREE.Quaternion().setFromUnitVectors(world(child).sub(world(name)).normalize(), new THREE.Vector3(...direction).normalize());
    rotateWorld(bones.get(name), delta);
  }
  const reset = () => rig.userData.preview('fly', 0);
  try {
    reset();
    const cruise = structuredClone(original);
    // Вертикальное зависание: разворачиваем торс, затем укладываем конечности.
    const body = world('DEF-head').sub(world('DEF-hips')).normalize();
    rotateWorld(bones.get('DEF-hips'), new THREE.Quaternion().setFromUnitVectors(body, new THREE.Vector3(0, 1, -0.07).normalize()));
    for (const [side, sign] of [['L', -1], ['R', 1]]) {
      aim('DEF-upper_arm' + side, 'DEF-forearm' + side, [sign * 0.32, -1, -0.08]);
      aim('DEF-forearm' + side, 'DEF-hand' + side, [sign * 0.14, -1, -0.22]);
      aim('DEF-hand' + side, 'DEF-f_middle01' + side, [sign * 0.08, -1, -0.1]);
      aim('DEF-thigh' + side, 'DEF-shin' + side, [sign * 0.08, -1, side === 'L' ? -0.23 : -0.1]);
      aim('DEF-shin' + side, 'DEF-foot' + side, [0, -1, side === 'L' ? 0.3 : 0.17]);
      aim('DEF-foot' + side, 'DEF-toe' + side, [0, -0.65, -1]);
    }
    // В полёте голова запрокинута к горизонту; в вертикальной позе возвращаем нейтральную шею.
    for (const name of ['DEF-neck', 'DEF-head']) {
      bones.get(name).rotation.set(...rig.userData.restPose.bones[name]);
    }
    rig.updateMatrixWorld(true);
    const hover = rig.userData.capturePose();
    reset();
    for (const [side, sign] of [['L', -1], ['R', 1]]) {
      aim('DEF-upper_arm' + side, 'DEF-forearm' + side, [sign * 0.04, 0.04, -1]);
      aim('DEF-forearm' + side, 'DEF-hand' + side, [0, 0.01, -1]);
      aim('DEF-hand' + side, 'DEF-f_middle01' + side, [0, 0, -1]);
      aim('DEF-thigh' + side, 'DEF-shin' + side, [sign * 0.01, -0.08, 1]);
      aim('DEF-shin' + side, 'DEF-foot' + side, [0, -0.05, 1]);
      aim('DEF-foot' + side, 'DEF-toe' + side, [0, -0.1, 1]);
    }
    const boost = rig.userData.capturePose();
    function loop(name, pose, duration, amplitude, bob) {
      const frames = Array.from({ length: 9 }, (_, i) => {
        const phase = i === 8 ? 0 : Math.sin(i / 8 * Math.PI * 2);
        const p = structuredClone(pose);
        p.tilt += phase * amplitude;
        for (const key of ['DEF-spine002', 'DEF-forearmL', 'DEF-forearmR', 'DEF-shinL', 'DEF-shinR']) {
          const r = p.bones[key]; if (!r) continue;
          const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...r));
          q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), phase * amplitude * 0.5));
          if (phase !== 0) p.bones[key] = new THREE.Euler().setFromQuaternion(q).toArray().slice(0, 3);
        }
        if (bob) { p.offset ||= [0, 0, 0]; p.offset[1] += phase * bob; }
        return { time: duration * i / 8, pose: p };
      });
      return { name, duration, loop: true, frames };
    }
    return validateAnimations({
      hover: loop('Зависание · дыхание', hover, 3.2, 0.016, 0.025),
      fly: loop('Полёт · авторская поза', cruise, 2.4, 0.01, 0),
      boost: loop('Форсаж · стрела', boost, 1.2, 0.004, 0),
    });
  } finally {
    rig.userData.disposeAnimation();
    rig.traverse(o => { if (o.isMesh) o.material.dispose(); });
  }
}
