import * as THREE from 'three';
import { interpolatePose, validateAnimations } from './animation-data.js';
import { SLAM } from '../core/character.js';
import { moveJoint } from './pose-ik.js';

export function createSlamActions(hero, input) {
  const rig = hero.userData.createPreview(), setup = structuredClone(input), bones = rig.userData.bones;
  const point = n => bones.get(n).getWorldPosition(new THREE.Vector3());
  const aim = (name, child, direction) => {
    const b = bones.get(name), delta = new THREE.Quaternion().setFromUnitVectors(point(child).sub(point(name)).normalize(), new THREE.Vector3(...direction).normalize());
    const q = b.getWorldQuaternion(new THREE.Quaternion()).premultiply(delta);
    b.quaternion.copy(b.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q));
    rig.updateMatrixWorld(true);
  };
  const groundPose = () => {
    rig.updateMatrixWorld(true);
    const low = Math.min(...[...bones].filter(([n]) => n !== 'root').map(([, b]) => b.getWorldPosition(new THREE.Vector3()).y));
    const p = rig.userData.capturePose(); p.offset ||= [0, 0, 0]; p.offset[1] -= low - .035;
    return p;
  };
  try {
    rig.userData.setSetup(setup); rig.userData.preview('idle', 0);
    const stand = groundPose();
    rig.userData.preview('fly', 0);
    aim('DEF-hips', 'DEF-head', [0, -.98, -.18]);
    for (const [side, s] of [['L', -1], ['R', 1]]) {
      aim('DEF-upper_arm' + side, 'DEF-forearm' + side, [s * .08, -1, -.12]);
      aim('DEF-forearm' + side, 'DEF-hand' + side, [0, -1, -.1]);
      aim('DEF-thigh' + side, 'DEF-shin' + side, [s * .07, 1, .08]);
      aim('DEF-shin' + side, 'DEF-foot' + side, [0, 1, .08]);
    }
    const dive = groundPose();
    // capturePose removes the flight lift; slam has no automatic lift.
    dive.offset[1] += .95;
    setup.clips.slamhit = 'UAL2:NinjaJump_Land'; delete setup.poses.slamhit;
    rig.userData.setSetup(setup);
    let bestTime = 0, lowest = Infinity;
    const duration = rig.userData.getDuration('slamhit');
    for (let i = 0; i <= 30; i++) {
      const time = duration * i / 30; rig.userData.preview('slamhit', time);
      const height = point('DEF-hips').y;
      if (height < lowest) { lowest = height; bestTime = time; }
    }
    rig.userData.preview('slamhit', bestTime);
    const feet = ['L', 'R'].map(side => point('DEF-foot' + side));
    rig.userData.body.position.y -= .12; rig.updateMatrixWorld(true);
    for (const [i, side] of ['L', 'R'].entries()) moveJoint(rig, 'DEF-foot' + side, feet[i]);
    const spine = bones.get('DEF-spine002');
    const lean = spine.getWorldQuaternion(new THREE.Quaternion()).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -.35));
    spine.quaternion.copy(spine.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(lean)); rig.updateMatrixWorld(true);
    const fist = point('DEF-handR'); fist.y = Math.min(...feet.map(p => p.y)) + .03; fist.z = -.28;
    moveJoint(rig, 'DEF-handR', fist);
    const hit = groundPose(), contact = structuredClone(hit); contact.offset[1] += .045;
    const recovery = Array.from({ length: 13 }, (_, i) => {
      const t = i / 12, u = t * t * (3 - 2 * t);
      return { time: t * SLAM.recoverTime, pose: interpolatePose(hit, stand, u) };
    });
    return validateAnimations({
      slamdive: { name: 'Удар в землю · силовое пике', duration: 1, loop: true, frames: [{ time: 0, pose: dive }, { time: 1, pose: structuredClone(dive) }] },
      slamhit: { name: 'Удар в землю · поглощение удара', duration: SLAM.impactTime, loop: false,
        frames: [{ time: 0, pose: contact }, { time: .08, pose: hit }, { time: SLAM.impactTime, pose: structuredClone(hit) }] },
      slamrecover: { name: 'Удар в землю · подъём героя', duration: SLAM.recoverTime, loop: false, frames: recovery },
    });
  } finally { rig.userData.disposeAnimation(); rig.traverse(o => { if (o.isMesh) o.material.dispose(); }); }
}
