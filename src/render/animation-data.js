// Формат авторских анимаций: полные позы скелета в ключевых кадрах, время в секундах.
import { Euler, Quaternion } from 'three';
import { MOVE } from '../core/character.js';

export const CUSTOM_PREFIX = 'custom:';
export const MAX_DURATION = 30;
export const MAX_FRAMES = 241;
const object = (v) => v && typeof v === 'object' && !Array.isArray(v);
const safeKey = (k) => typeof k === 'string' && k.length <= 120 && !['__proto__', 'constructor', 'prototype'].includes(k);
function number(v, min, max, label) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) throw new Error(`Некорректное значение: ${label}`);
  return v;
}
export function validatePose(p) {
  if (!object(p)) throw new Error('Поза должна быть объектом');
  const out = { tilt: number(p.tilt ?? 0, -Math.PI * 2, Math.PI * 2, 'наклон'), bones: {}, positions: {} };
  if (p.offset !== undefined) {
    if (!Array.isArray(p.offset) || p.offset.length !== 3) throw new Error('Смещение тела: нужны X, Y, Z');
    out.offset = p.offset.map(v => number(v, -10, 10, 'смещение тела'));
  }
  for (const field of ['bones', 'positions']) {
    const values = p[field] ?? {};
    if (!object(values) || Object.keys(values).length > 256) throw new Error('Некорректный список костей');
    for (const [name, v] of Object.entries(values)) {
      if (!safeKey(name) || !Array.isArray(v) || v.length !== 3) throw new Error('Некорректная кость');
      out[field][name] = v.map((n) => number(n, -10000, 10000, name));
    }
  }
  return out;
}
export function validateAnimations(data = {}) {
  if (!object(data) || Object.keys(data).length > 64) throw new Error('Допустимо до 64 собственных анимаций');
  const result = {};
  for (const [id, a] of Object.entries(data)) {
    if (!safeKey(id) || !object(a) || typeof a.name !== 'string' || !a.name.trim() || a.name.length > 80) throw new Error('Некорректное имя анимации');
    const duration = number(a.duration, 0.1, MAX_DURATION, 'длительность');
    if (!Array.isArray(a.frames) || !a.frames.length || a.frames.length > MAX_FRAMES) throw new Error(`Нужно от 1 до ${MAX_FRAMES} кадров`);
    const frames = a.frames.map((f) => ({ time: number(f.time, 0, duration, 'время кадра'), pose: validatePose(f.pose) })).sort((x, y) => x.time - y.time);
    if (frames.some((f, i) => i && f.time - frames[i - 1].time < 0.0001)) throw new Error('Кадры не могут иметь одинаковое время');
    result[id] = { name: a.name.trim(), duration, loop: a.loop !== false, frames };
  }
  return result;
}

// Кватернионная интерполяция не делает полный оборот при переходе 179° → −179°.
export function interpolatePose(a, b, t) {
  const out = { tilt: a.tilt + (b.tilt - a.tilt) * t, bones: {}, positions: {} };
  if (a.offset || b.offset) out.offset = [0, 1, 2].map(i => (a.offset?.[i] || 0) + ((b.offset?.[i] || 0) - (a.offset?.[i] || 0)) * t);
  for (const field of ['bones', 'positions']) {
    for (const name of new Set([...Object.keys(a[field] || {}), ...Object.keys(b[field] || {})])) {
      const av = a[field]?.[name] || b[field][name];
      const bv = b[field]?.[name] || av;
      if (field === 'bones') {
        const q = new Quaternion().setFromEuler(new Euler(...av));
        q.slerp(new Quaternion().setFromEuler(new Euler(...bv)), t);
        out.bones[name] = new Euler().setFromQuaternion(q).toArray().slice(0, 3);
      } else out.positions[name] = av.map((v, i) => v + (bv[i] - v) * t);
    }
  }
  return out;
}
export function sampleAnimation(animation, seconds, wrap = animation.loop) {
  const { frames, duration } = animation;
  const t = wrap ? ((seconds % duration) + duration) % duration : Math.max(0, Math.min(duration, seconds));
  if (t <= frames[0].time) return structuredClone(frames[0].pose);
  for (let i = 1; i < frames.length; i++) {
    if (t <= frames[i].time) {
      const a = frames[i - 1], b = frames[i];
      return interpolatePose(a.pose, b.pose, (t - a.time) / (b.time - a.time));
    }
  }
  return structuredClone(frames.at(-1).pose);
}
export function putFrame(animation, time, pose) {
  const t = Math.min(animation.duration, Math.round(Math.max(0, time) * 1000) / 1000);
  const existing = animation.frames.find((f) => Math.abs(f.time - t) < 0.001);
  if (existing) existing.pose = structuredClone(pose);
  else {
    if (animation.frames.length >= MAX_FRAMES) throw new Error(`Максимум ${MAX_FRAMES} кадров`);
    animation.frames.push({ time: t, pose: structuredClone(pose) });
    animation.frames.sort((a, b) => a.time - b.time);
  }
}
// «+ Кадр» всегда создаёт отдельный ключ; автозапись позы по-прежнему использует putFrame.
export function addFrame(animation, time, pose) {
  if (animation.frames.length >= MAX_FRAMES) throw new Error(`Максимум ${MAX_FRAMES} кадров`);
  let target = Math.round(Math.max(0, Math.min(animation.duration, time)) * 1000) / 1000;
  const frames = [...animation.frames].sort((a, b) => a.time - b.time);
  while (frames.some(f => Math.abs(f.time - target) < 0.002)) {
    const current = frames.findLast(f => f.time <= target + 0.002);
    const next = frames.find(f => f.time > current.time + 0.0001);
    if (next && next.time - current.time < 0.006) { target = next.time; continue; }
    target = Math.round((current.time + (next ? Math.min(0.2, (next.time - current.time) / 2) : 0.2)) * 1000) / 1000;
    if (target > MAX_DURATION) throw new Error('Достигнуты 30 секунд. Выберите время внутри анимации.');
  }
  animation.duration = Math.max(animation.duration, target);
  putFrame(animation, target, pose);
  return target;
}
export function previousFrame(animation, time) {
  return animation.frames.filter(f => f.time < time - 0.002).sort((a, b) => b.time - a.time)[0];
}
export function copyPreviousFrame(animation, time) {
  const previous = previousFrame(animation, time);
  if (!previous) throw new Error('Перед этим временем ещё нет кадра');
  putFrame(animation, time, previous.pose);
}
// Перестановка меняет порядок поз в существующих временных слотах.
export function reorderFrame(animation, from, to) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || !animation.frames[from] || !animation.frames[to]) throw new Error('Кадр не найден');
  const times = animation.frames.map(f => f.time);
  const [moved] = animation.frames.splice(from, 1);
  animation.frames.splice(to, 0, moved);
  animation.frames.forEach((f, i) => { f.time = times[i]; });
  return animation.frames[to].time;
}
export function moveFrameTime(animation, from, to) {
  number(to, 0, animation.duration, 'время кадра');
  const frame = animation.frames.find(f => Math.abs(f.time - from) < .002);
  if (!frame) throw new Error('Выберите существующий кадр');
  const target = Math.min(animation.duration, Math.round(to * 1000) / 1000);
  if (animation.frames.some(f => f !== frame && Math.abs(f.time - target) < .002)) throw new Error('Это время уже занято другим кадром');
  frame.time = target; animation.frames.sort((a, b) => a.time - b.time);
  return target;
}
export function resizeAnimation(animation, duration) {
  number(duration, 0.1, MAX_DURATION, 'длительность');
  const ratio = duration / animation.duration;
  for (const f of animation.frames) f.time *= ratio;
  animation.duration = duration;
}
const RUN_FROM = (MOVE.walk + MOVE.run) / 2;

export function selectAnimationState(st, previous = null) {
  if (st.slam) return ({ dive: 'slamdive', impact: 'slamhit', recover: 'slamrecover' })[st.slam.phase] || 'air';
  if (st.mode === 'fly' || st.thrust) {
    if (st.hoverLift) return 'hover';
    const speed = st.speed || 0;
    // Разные пороги входа/выхода предотвращают дрожание поз на границе скорости.
    if (speed > (previous === 'boost' ? 300 : 340)) return 'boost';
    return speed < (previous === 'hover' ? 12 : 6) ? 'hover' : 'fly';
  }
  if (!st.grounded) return (st.verticalSpeed || 0) > 0.1 ? 'jump' : 'air';
  if (st.charge > 0) return 'charge';
  if (st.impact > 0.1) return 'land';
  return st.speed > RUN_FROM ? 'run' : st.speed > 0.4 ? 'walk' : 'idle';
}
