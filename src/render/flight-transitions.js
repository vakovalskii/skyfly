import * as THREE from 'three';
import { validateAnimations, interpolatePose } from './animation-data.js';

export const FLIGHT_ROUTES = {
  'jump:fly': 'jumpfly', 'air:fly': 'jumpfly', 'jump:boost': 'jumpfly', 'air:boost': 'jumpfly',
  'hover:fly': 'flystart', 'hover:boost': 'flystart',
  'fly:hover': 'flystop', 'boost:hover': 'flystop', 'fly:boost': 'booststart',
};
export const bodyLift = state => ['hover', 'flystop'].includes(state) ? .28
  : ['fly', 'boost', 'flystart', 'booststart', 'jumpfly'].includes(state) ? .95 : 0;
const smooth = (t, start = 0, end = 1) => {
  const p = THREE.MathUtils.clamp((t - start) / (end - start), 0, 1);
  return p * p * (3 - 2 * p);
};

export function makeFlightTransition(from, to, kind) {
  const spec = {
    flystart: ['Разгон · из зависания в полёт', 1.05, 'hover', 'fly'],
    flystop: ['Торможение · возврат в зависание', 1.15, 'fly', 'hover'],
    booststart: ['Ускорение · выход на форсаж', .65, 'fly', 'boost'],
  }[kind];
  if (!spec) throw new Error('Неизвестный переход полёта');
  const [name, duration, sourceState, targetState] = spec;
  const first = structuredClone(from), last = structuredClone(to);
  first.offset ||= [0, 0, 0]; last.offset ||= [0, 0, 0];
  first.offset[1] += bodyLift(sourceState) - bodyLift(kind);
  last.offset[1] += bodyLift(targetState) - bodyLift(kind);
  const frames = Array.from({ length: 25 }, (_, i) => {
    const t = i / 24;
    if (i === 0 || i === 24) return { time: t * duration, pose: structuredClone(i ? last : first) };
    const torso = smooth(t, .05, .9), pose = { tilt: THREE.MathUtils.lerp(first.tilt, last.tilt, torso),
      offset: first.offset.map((v, a) => THREE.MathUtils.lerp(v, last.offset[a], smooth(t))), bones: {}, positions: {} };
    for (const bone of new Set([...Object.keys(first.bones), ...Object.keys(last.bones)])) {
      // Hands lead acceleration; legs trail. While braking, knees lead the upright torso.
      const leg = /thigh|shin|foot|toe/.test(bone), arm = /shoulder|arm|hand|thumb|f_/.test(bone);
      const amount = kind === 'flystop' ? smooth(t, leg ? 0 : .12, leg ? .72 : 1)
        : smooth(t, arm ? 0 : leg ? .2 : .06, arm ? .7 : 1);
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(...(first.bones[bone] || last.bones[bone])));
      q.slerp(new THREE.Quaternion().setFromEuler(new THREE.Euler(...(last.bones[bone] || first.bones[bone]))), amount);
      if (/DEF-shin/.test(bone) && kind !== 'booststart')
        q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.sin(Math.PI * t) ** 2 * (kind === 'flystop' ? .24 : .12)));
      pose.bones[bone] = new THREE.Euler().setFromQuaternion(q).toArray().slice(0, 3);
    }
    for (const bone of new Set([...Object.keys(first.positions || {}), ...Object.keys(last.positions || {})])) {
      const a = first.positions?.[bone] || last.positions[bone], b = last.positions?.[bone] || a;
      pose.positions[bone] = a.map((v, axis) => THREE.MathUtils.lerp(v, b[axis], smooth(t)));
    }
    pose.offset[1] += Math.sin(Math.PI * t) ** 2 * (kind === 'flystop' ? .04 : -.035);
    return { time: t * duration, pose };
  });
  return validateAnimations({ result: { name, duration, loop: false, frames } }).result;
}

export function createFlightTransitions(hero, input, id = () => crypto.randomUUID()) {
  if (Object.keys(input.animations).length > 61) throw new Error('Для переходов нужны три свободных места');
  const setup = structuredClone(input), rig = hero.userData.createPreview(), poses = {};
  try {
    rig.userData.setSetup(input);
    for (const state of ['hover', 'fly', 'boost']) { rig.userData.preview(state, 0); poses[state] = rig.userData.capturePose(); }
    for (const [kind, from, to] of [['flystart', 'hover', 'fly'], ['flystop', 'fly', 'hover'], ['booststart', 'fly', 'boost']]) {
      const key = `transition-${kind}-${id()}`;
      setup.animations[key] = kind === 'booststart' ? buildBoostPush(rig, poses)
        : kind === 'flystart' ? buildFlightLaunch(rig, poses) : makeFlightTransition(poses[from], poses[to], kind);
      setup.clips[kind] = 'custom:' + key; setup.speed[kind] = 1; delete setup.poses[kind];
    }
    return setup;
  } finally { rig.userData.disposeAnimation(); rig.traverse(o => { if (o.isMesh) o.material.dispose(); }); }
}

// Reach into the flight direction while upright, let the chest follow the hand,
// then draw the hips and trailing legs into the final silhouette.
function buildFlightLaunch(rig, poses, source = 'hover') {
  const bones = rig.userData.bones, point = name => bones.get(name).getWorldPosition(new THREE.Vector3());
  const worldQ = name => bones.get(name).getWorldQuaternion(new THREE.Quaternion());
  const setWorldQ = (name, q) => {
    const bone = bones.get(name);
    bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q));
    rig.updateMatrixWorld(true);
  };
  const aim = (name, child, direction) => {
    const delta = new THREE.Quaternion().setFromUnitVectors(point(child).sub(point(name)).normalize(), new THREE.Vector3(...direction).normalize());
    setWorldQ(name, worldQ(name).premultiply(delta));
  };
  rig.userData.preview(source, source === 'jump' ? .15 : 0);
  const hoverHeadQ = worldQ('DEF-head');
  rig.userData.preview('fly', 0);
  const lead = point('DEF-handL').z < point('DEF-handR').z ? 'L' : 'R';
  const handQ = worldQ('DEF-hand' + lead), headQ = worldQ('DEF-head');
  const first = structuredClone(poses.hover), last = structuredClone(poses.fly);
  first.offset ||= [0, 0, 0]; last.offset ||= [0, 0, 0];
  first.offset[1] += bodyLift(source) - bodyLift('flystart');
  const keys = [[0, first]];
  const stages = [
    // time, pose progress, torso direction, upper leg, lower leg, toe direction
    [.16, .12, [0, .99, -.12], [0, -1, -.06], [0, -.98, .2], [0, -.98, .15]],
    [.34, .32, [0, .8, -.6], [0, -.98, .12], [0, -.94, .34], [0, -.92, .4]],
    [.56, .63, [0, .34, -.94], [0, -.58, .82], [0, -.72, .7], [0, -.5, .86]],
    [.76, .88, [0, .08, -1], [0, -.18, .98], [0, -.24, .97], [0, -.12, 1]],
  ];
  for (const [time, progress, torso, thigh, shin, toe] of stages) {
    rig.userData.preview(source, source === 'jump' ? .15 : 0);
    const pose = interpolatePose(poses.hover, poses.fly, progress), pivot = rig.userData.body;
    for (const [name, rotation] of Object.entries(pose.bones)) bones.get(name)?.rotation.set(...rotation);
    for (const [name, position] of Object.entries(pose.positions)) bones.get(name)?.position.fromArray(position);
    pivot.rotation.x = pose.tilt;
    pivot.position.fromArray(pose.offset || [0, 0, 0]); pivot.position.y += bodyLift(source);
    rig.updateMatrixWorld(true);
    aim('DEF-hips', 'DEF-head', torso);
    // The leading arm reaches before the body tips; the other keeps its authored pose.
    const sign = lead === 'L' ? -.08 : .08;
    aim('DEF-upper_arm' + lead, 'DEF-forearm' + lead, [sign, time < .2 ? .03 : .08, -1]);
    aim('DEF-forearm' + lead, 'DEF-hand' + lead, [sign * .3, .08, -1]);
    setWorldQ('DEF-hand' + lead, handQ.clone());
    setWorldQ('DEF-head', hoverHeadQ.clone().slerp(headQ, smooth(progress, .3, 1)));
    for (const [side, s] of [['L', -1], ['R', 1]]) {
      aim('DEF-thigh' + side, 'DEF-shin' + side, [s * .055, thigh[1], thigh[2]]);
      aim('DEF-shin' + side, 'DEF-foot' + side, shin);
      aim('DEF-foot' + side, 'DEF-toe' + side, toe);
    }
    const frame = rig.userData.capturePose();
    frame.offset = first.offset.map((v, axis) => THREE.MathUtils.lerp(v, last.offset[axis], smooth(progress)));
    frame.offset[1] += Math.sin(Math.PI * progress) * .035;
    frame.offset[2] -= Math.sin(Math.PI * progress) * .055;
    keys.push([time, frame]);
  }
  keys.push([.96, last]);
  const frames = [];
  for (let i = 0; i < keys.length - 1; i++) {
    const [a, p] = keys[i], [b, q] = keys[i + 1];
    for (let j = 0; j < 6; j++) {
      const t = j / 6;
      // Ease only entering/leaving the gesture; keep momentum through interior keys.
      const u = i === 0 ? t * t : i === keys.length - 2 ? 1 - (1 - t) ** 2 : t;
      frames.push({ time: a + (b - a) * t, pose: interpolatePose(p, q, u) });
    }
  }
  frames.push({ time: .96, pose: last });
  return validateAnimations({ clip: { name: 'Полёт · рука ведёт, тело следует', duration: .96, loop: false, frames } }).clip;
}

export function createFlightLaunch(hero, input) {
  const rig = hero.userData.createPreview(), poses = {};
  try {
    rig.userData.setSetup(input);
    for (const state of ['hover', 'fly']) { rig.userData.preview(state, 0); poses[state] = rig.userData.capturePose(); }
    return buildFlightLaunch(rig, poses);
  } finally { rig.userData.disposeAnimation(); rig.traverse(o => { if (o.isMesh) o.material.dispose(); }); }
}

export function createJumpFlight(hero, input) {
  const rig = hero.userData.createPreview(), poses = {};
  try {
    rig.userData.setSetup(input);
    rig.userData.preview('jump', .15); poses.hover = rig.userData.capturePose();
    rig.userData.preview('fly', 0); poses.fly = rig.userData.capturePose();
    const clip = buildFlightLaunch(rig, poses, 'jump');
    clip.name = 'Прыжок · подхват и вытягивание в полёт';
    clip.duration *= .72; clip.frames.forEach(f => { f.time *= .72; });
    return clip;
  } finally { rig.userData.disposeAnimation(); rig.traverse(o => { if (o.isMesh) o.material.dispose(); }); }
}

// A short airborne push-off: gather → hold tension → extend sharply → settle.
function buildBoostPush(rig, poses) {
  rig.userData.preview('fly', 0);
  const bones = rig.userData.bones, point = name => bones.get(name).getWorldPosition(new THREE.Vector3());
  function rotateWorld(bone, delta) {
    const q = bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(delta);
    bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q));
    rig.updateMatrixWorld(true);
  }
  function aim(name, child, direction) {
    rotateWorld(bones.get(name), new THREE.Quaternion().setFromUnitVectors(point(child).sub(point(name)).normalize(), new THREE.Vector3(...direction).normalize()));
  }
  // Work in the preview's world coordinates: independent of the author's pivot/hip tilt split.
  aim('DEF-hips', 'DEF-head', [0, .9, -.44]);
  for (const [side, sign] of [['L', -1], ['R', 1]]) {
    aim(`DEF-upper_arm${side}`, `DEF-forearm${side}`, [sign * .3, -.8, .4]);
    aim(`DEF-forearm${side}`, `DEF-hand${side}`, [sign * .08, .65, -.75]);
    aim(`DEF-thigh${side}`, `DEF-shin${side}`, [sign * .22, -.4, -.8]);
    aim(`DEF-shin${side}`, `DEF-foot${side}`, [0, -.6, .8]);
    aim(`DEF-foot${side}`, `DEF-toe${side}`, [0, -.2, -1]);
  }
  for (const name of ['DEF-neck', 'DEF-head']) if (poses.hover.bones[name]) bones.get(name).rotation.set(...poses.hover.bones[name]);
  const brace = rig.userData.capturePose();
  brace.offset = [...(poses.fly.offset || [0, 0, 0])]; brace.offset[1] += .06; brace.offset[2] += .18;
  const extension = structuredClone(poses.boost);
  extension.offset ||= [0, 0, 0]; extension.offset[2] -= .18;
  const keys = [
    [0, poses.fly], [.3, interpolatePose(poses.fly, brace, .8)],
    [.55, brace], [.8, brace], // Gather and visibly hold before releasing the energy.
    [1.02, extension], [1.2, interpolatePose(extension, poses.boost, .75)], [1.5, poses.boost],
  ];
  // Extra eased samples keep the editor preview identical to runtime interpolation.
  const frames = [];
  for (let i = 0; i < keys.length - 1; i++) {
    const [a, p] = keys[i], [b, q] = keys[i + 1];
    for (let j = 0; j < 4; j++) frames.push({ time: a + (b - a) * j / 4, pose: interpolatePose(p, q, smooth(j / 4)) });
  }
  frames.push({ time: 1.5, pose: structuredClone(poses.boost) });
  return validateAnimations({ clip: { name: 'Форсаж · накопление и толчок', duration: 1.5, loop: false, frames } }).clip;
}

export function createBoostPush(hero, input) {
  const rig = hero.userData.createPreview(), poses = {};
  try {
    rig.userData.setSetup(input);
    for (const state of ['hover', 'fly', 'boost']) { rig.userData.preview(state, 0); poses[state] = rig.userData.capturePose(); }
    return buildBoostPush(rig, poses);
  } finally { rig.userData.disposeAnimation(); rig.traverse(o => { if (o.isMesh) o.material.dispose(); }); }
}
