// Один и тот же проигрыватель используется в игре и в окне редактора.
import * as THREE from 'three';
import { loadSetup } from './flypose.js';
import { MOVE } from '../core/character.js';
import { CUSTOM_PREFIX, sampleAnimation, selectAnimationState } from './animation-data.js';
import { FLIGHT_ROUTES, bodyLift } from './flight-transitions.js';
import { createFlightDynamics } from './flight-dynamics.js';

export function attachAnimationPlayer(root, model, pivot, clips, bones) {
  const motion = new THREE.Group(); motion.name = 'Flight motion';
  root.add(motion); motion.add(pivot);
  const dynamics = createFlightDynamics();
  const mixer = new THREE.AnimationMixer(model);
  const rest = new Map([...bones].map(([name, b]) => [name, { q: b.quaternion.clone(), p: b.position.clone(), s: b.scale.clone() }]));
  const actions = new Map();
  const sampledBones = new Map([...rest].map(([name, r]) => [name, { q: r.q.clone(), p: r.p.clone(), s: r.s.clone() }]));
  let setup = loadSetup(), forced = null, activeClip = null, currentState = null, elapsed = 0;
  let transition = null, transitionTime = 0;
  let flightClip = null, flightTime = 0;
  let boostHeld = false;
  const euler = new THREE.Euler();
  const airborne = (state) => ['hover', 'fly', 'boost'].includes(state);
  const lift = bodyLift;
  let transitionDuration = 0.16, baseLift = 0;
  const clipOf = (name) => clips.find((c) => c.name === name || c.name.endsWith(`|${name}`));
  const boneOf = (name) => bones.get(name) || bones.get(THREE.PropertyBinding.sanitizeNodeName(name));
  const capture = () => ({
    tilt: pivot.rotation.x,
    offset: [pivot.position.x, pivot.position.y - baseLift, pivot.position.z],
    bones: Object.fromEntries([...bones].map(([name, b]) => [name, new THREE.Euler().setFromQuaternion(b.quaternion).toArray().slice(0, 3)])),
    positions: Object.fromEntries([...bones].map(([name, b]) => [name, b.position.toArray()])),
  });
  function applyPose(pose) {
    for (const [name, r] of Object.entries(pose.bones || {})) boneOf(name)?.quaternion.setFromEuler(euler.set(...r));
    for (const [name, p] of Object.entries(pose.positions || {})) boneOf(name)?.position.fromArray(p);
    pivot.rotation.x = pose.tilt || 0;
    pivot.position.fromArray(pose.offset || [0, 0, 0]);
    pivot.position.y += baseLift;
  }
  function sample(state, seconds, wrap = false) {
    const name = setup.clips[state];
    const custom = name?.startsWith(CUSTOM_PREFIX) ? setup.animations?.[name.slice(CUSTOM_PREFIX.length)] : null;
    const clip = custom ? null : clipOf(name);
    const changedClip = activeClip !== clip;
    if (changedClip) { mixer.stopAllAction(); activeClip = clip; }
    // Mixer пропускает повторную запись неизменных треков. Нельзя сбрасывать их между его кадрами.
    if (changedClip || !clip) for (const [name, b] of bones) {
      const r = rest.get(name); b.quaternion.copy(r.q); b.position.copy(r.p); b.scale.copy(r.s);
    }
    pivot.rotation.x = 0;
    baseLift = lift(state);
    pivot.position.set(0, baseLift, 0);
    if (custom) applyPose(sampleAnimation(custom, seconds, wrap && custom.loop));
    else if (clip) {
      // Убираем смешивание перехода/наложения прошлого кадра, сохраняя результат самого mixer.
      if (!changedClip) for (const [name, b] of bones) {
        const saved = sampledBones.get(name); b.quaternion.copy(saved.q); b.position.copy(saved.p); b.scale.copy(saved.s);
      }
      let action = actions.get(clip);
      if (!action) { action = mixer.clipAction(clip); actions.set(clip, action); }
      action.enabled = true; action.paused = false; action.setEffectiveWeight(1); action.play();
      action.time = wrap ? seconds % clip.duration : Math.min(Math.max(0, seconds), Math.max(0, clip.duration - 1e-6));
      mixer.update(0);
      for (const [name, b] of bones) {
        const saved = sampledBones.get(name); saved.q.copy(b.quaternion); saved.p.copy(b.position); saved.s.copy(b.scale);
      }
    }
    const overlay = setup.poses[state];
    if (overlay && !custom) applyPose(overlay);
    root.updateMatrixWorld(true);
  }
  root.userData.bones = bones;
  root.userData.body = pivot;
  root.userData.flightMotion = motion;
  root.userData.restPose = capture();
  root.userData.getSetup = () => setup;
  root.userData.setSetup = (value) => { setup = value; currentState = null; flightClip = null; };
  root.userData.force = (state) => { forced = state; currentState = null; flightClip = null; };
  root.userData.stateOf = selectAnimationState;
  root.userData.capturePose = capture;
  root.userData.preview = (state, seconds, wrap = false) => {
    motion.rotation.set(0, 0, 0); motion.position.set(0, 0, 0); dynamics.reset();
    sample(state, seconds, wrap);
    root.userData.flightVisual = { state, time: seconds, duration: root.userData.getDuration(state) };
    root.updateMatrixWorld(true);
    root.userData.updateCape?.({ state, time: seconds, preview: true });
  };
  root.userData.getDuration = (state) => {
    const name = setup.clips[state];
    return name?.startsWith(CUSTOM_PREFIX) ? setup.animations[name.slice(7)]?.duration || 1 : clipOf(name)?.duration || 1;
  };
  root.userData.disposeAnimation = () => { mixer.stopAllAction(); mixer.uncacheRoot(model); root.userData.disposeCape?.(); };
  root.userData.pose = (t, st) => {
    const c = root.userData.character;
    const selected = selectAnimationState({ ...st, slam: st.slam ?? c?.slam, verticalSpeed: st.verticalSpeed ?? c?.vel?.[1], impact: st.impact ?? c?.impact }, currentState);
    const state = forced || (!st.hoverLift && airborne(selected) && st.boost && !st.braking && (st.thrust || st.speed > 2) ? 'boost' : selected);
    const boostPressed = !!st.boost && !boostHeld; boostHeld = !!st.boost;
    const dt = Math.max(0, Math.min(0.05, st.dt ?? 1 / 60));
    const reaction = dynamics.update({ speed: st.speed, yaw: st.yaw ?? c?.face ?? -root.rotation.y,
      pitch: st.pitchView || 0, braking: st.braking, active: !forced && airborne(state) }, dt);
    root.userData.flightReaction = { ...reaction };
    if (state !== currentState) {
      transition = { ...capture(), position: pivot.position.toArray() };
      const route = state === 'boost' && airborne(currentState) ? 'booststart' : FLIGHT_ROUTES[`${currentState}:${state}`];
      flightClip = !forced && route && setup.clips[route] ? route : null;
      flightTime = 0;
      transitionDuration = airborne(state) || airborne(currentState) ? 0.24 : 0.16;
      // On entering levitation, release the knees and point the feet gradually.
      // Landings absorb the impact promptly, but rising out of the crouch takes longer.
      if (airborne(state) && ['jump', 'air'].includes(currentState)) transitionDuration = state === 'hover' ? .55 : .38;
      if (state === 'land') transitionDuration = .10;
      else if (state === 'air' && airborne(currentState)) transitionDuration = .5;
      else if (currentState === 'land') transitionDuration = .30;
      if (state === 'slamdive') transitionDuration = .16;
      if (state === 'slamhit' || state === 'slamrecover') transition = null;
      if (flightClip) transitionDuration = .14; // Match the live pose to the first staged key.
      transitionTime = 0; currentState = state; elapsed = 0;
    } else if (!forced && state === 'boost' && boostPressed && !st.braking && setup.clips.booststart) {
      // A new press can launch another push at speed; holding the key cannot retrigger it.
      transition = { ...capture(), position: pivot.position.toArray() };
      transitionTime = 0; transitionDuration = .1; flightTime = 0; flightClip = 'booststart';
    }
    root.userData.activeState = state;
    let speed = setup.speed[state] ?? 1;
    if (!forced && (state === 'walk' || state === 'run')) speed *= THREE.MathUtils.clamp((st.speed || 0) / (state === 'walk' ? MOVE.walk : MOVE.run), 0.5, state === 'run' ? 3.2 : 1.8);   // сверхбег до 45 м/с — ноги мелькают быстрее
    if (flightClip) {
      // Acceleration and braking change the pace; entering flight no longer takes a fixed second.
      const tempo = flightClip === 'flystop' ? 1.6 + reaction.brake * .8 : 1;
      flightTime += dt * (setup.speed[flightClip] ?? 1) * tempo;
      if (flightTime >= root.userData.getDuration(flightClip)) {
        // Briefly settle into the live loop (also handles direct hover → boost).
        transition = { ...capture(), position: pivot.position.toArray() };
        transitionTime = 0; transitionDuration = .16; flightClip = null; elapsed = 0;
      }
    }
    elapsed += dt * speed;
    const slam = st.slam ?? c?.slam;
    if (!forced && slam && state.startsWith('slam')) elapsed = slam.time;
    const custom = setup.clips[state]?.startsWith(CUSTOM_PREFIX);
    sample(flightClip || state, flightClip ? flightTime : elapsed,
      !flightClip && (custom || !['jump', 'land', 'flystart', 'flystop', 'booststart'].includes(state)));
    root.userData.activeTransition = flightClip;
    root.userData.flightVisual = { state: flightClip || state, time: flightClip ? flightTime : elapsed,
      duration: root.userData.getDuration(flightClip || state) };
    let facing = 1;
    // Направление тела определяется скелетом: авторский наклон может быть в тазе, а не pivot.
    if (airborne(state)) {
      const head = boneOf('DEF-head'), hips = boneOf('DEF-hips');
      // в осях самого героя, а не мира: иначе знак зависел от того, куда он развёрнут
      // (на юг — наоборот, на восток/запад — скакал), и тело дёргало вверх-вниз
      const direction = head && hips ? root.worldToLocal(head.getWorldPosition(new THREE.Vector3())).sub(root.worldToLocal(hips.getWorldPosition(new THREE.Vector3()))) : null;
      facing = direction && direction.z > 0 ? -1 : 1;
      pivot.rotation.x += facing * (forced ? st.pitchView || 0 : reaction.pitch) * (state === 'hover' ? 0.12 : 1);
    }
    if (transition && !forced) {
      transitionTime += dt;
      const progress = Math.min(1, transitionTime / transitionDuration);
      const alpha = progress * progress * (3 - 2 * progress);
      for (const [name, b] of bones) {
        const from = new THREE.Quaternion().setFromEuler(euler.set(...transition.bones[name]));
        b.quaternion.copy(from.slerp(b.quaternion, alpha));
        b.position.lerp(new THREE.Vector3(...transition.positions[name]), 1 - alpha);
      }
      pivot.rotation.x = THREE.MathUtils.lerp(transition.tilt, pivot.rotation.x, alpha);
      pivot.position.lerp(new THREE.Vector3(...transition.position), 1 - alpha);
      if (alpha === 1) transition = null;
    }
    // Secondary motion is recomputed over the sampled pose, never accumulated into saved keys.
    const rotate = (name, x, y, z) => {
      const b = boneOf(name); if (b) b.quaternion.multiply(new THREE.Quaternion().setFromEuler(euler.set(x, y, z)));
    };
    if (!forced && airborne(state)) {
      const brake = reaction.brake, drive = reaction.drive, turn = reaction.turn;
      rotate('DEF-spine002', -.12 * brake, turn * .045, 0);
      rotate('DEF-spine003', -.08 * brake, turn * .06, 0);
      rotate('DEF-neck', .08 * brake, -turn * .06, 0);
      for (const [side, sign] of [['L', -1], ['R', 1]]) {
        rotate(`DEF-upper_arm${side}`, -.2 * brake, 0, sign * (.28 * brake + .06 * drive) + turn * .06);
        rotate(`DEF-forearm${side}`, .35 * brake, 0, 0);
        rotate(`DEF-thigh${side}`, -.28 * brake, 0, sign * .1 * brake);
        rotate(`DEF-shin${side}`, .55 * brake + .05 * drive, 0, 0);
      }
    }
    motion.rotation.set(facing * (.22 * reaction.brake - .055 * reaction.drive), 0, reaction.bank);
    motion.position.set(0, -.045 * reaction.drive, .1 * reaction.brake);
    root.updateMatrixWorld(true);
    root.userData.updateCape?.({ state: flightClip || state, time: t, speed: st.speed, velocity: st.velocity, dt });
  };
}
