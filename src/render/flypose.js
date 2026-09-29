import { validateAnimations, validatePose } from './animation-data.js';
import { FLIGHT_ANIMATION } from './flight-preset.js';
// Настройка анимаций героя: какой клип играет в каком состоянии, с какой скоростью,
// и какие повороты костей накладываются сверху (для позы полёта — её анимации в наборе нет).
// Редактор (P) сохраняет браузерную копию; animation-storage синхронизирует файл проекта.

export const STATES = [
  ['idle', 'стоит'],
  ['walk', 'шаг'],
  ['run', 'бег'],
  ['jump', 'прыжок'],
  ['air', 'падение'],
  ['hover', 'зависание'],
  ['fly', 'полёт'],
  ['boost', 'форсаж'],
  ['flystart', 'разгон в полёт'],
  ['jumpfly', 'из прыжка в полёт'],
  ['flystop', 'возврат в зависание'],
  ['booststart', 'выход на форсаж'],
  ['charge', 'зарядка взлёта'],
  ['land', 'приземление'],
  ['slamdive', 'удар в землю · пике'],
  ['slamhit', 'удар в землю · контакт'],
  ['slamrecover', 'удар в землю · подъём'],
];

// Кости, которые имеет смысл крутить руками. Пальцы и мелочь не показываем.
export const EDIT_BONES = [
  ['DEF-hips', 'таз'],
  ['DEF-spine.001', 'поясница'],
  ['DEF-spine.002', 'спина'],
  ['DEF-spine.003', 'грудь'],
  ['DEF-neck', 'шея'],
  ['DEF-head', 'голова'],
  ['DEF-shoulder.L', 'плечо Л'],
  ['DEF-upper_arm.L', 'рука Л'],
  ['DEF-forearm.L', 'предплечье Л'],
  ['DEF-hand.L', 'кисть Л'],
  ['DEF-shoulder.R', 'плечо П'],
  ['DEF-upper_arm.R', 'рука П'],
  ['DEF-forearm.R', 'предплечье П'],
  ['DEF-hand.R', 'кисть П'],
  ['DEF-thigh.L', 'бедро Л'],
  ['DEF-shin.L', 'голень Л'],
  ['DEF-foot.L', 'стопа Л'],
  ['DEF-thigh.R', 'бедро П'],
  ['DEF-shin.R', 'голень П'],
  ['DEF-foot.R', 'стопа П'],
];

// Заводская настройка: клипы из hero-base.glb + поза полёта «руки вперёд, тело в струну».
export const DEFAULT_SETUP = {
  version: 3,
  cape: { enabled: true, strengths: { idle: .2, walk: .35, run: .65, jump: .45, air: .7, hover: .4,
    fly: .8, boost: 1.25, flystart: .8, flystop: .5, booststart: 1, jumpfly: .8,
    charge: .25, land: .4, slamdive: 1, slamhit: .6, slamrecover: .3 } },
  animations: { 'hero-flight': FLIGHT_ANIMATION },
  clips: {
    idle: 'Idle_Loop',
    walk: 'Walk_Loop',
    run: 'Sprint_Loop',
    jump: 'Jump_Start',
    air: 'Jump_Loop',
    hover: 'Idle_Loop',
    fly: 'custom:hero-flight',
    boost: 'custom:hero-flight',
    flystart: null, flystop: null, booststart: null, jumpfly: null,
    charge: 'Crouch_Idle_Loop',
    land: 'Jump_Land',
    slamdive: 'Jump_Loop', slamhit: 'Jump_Land', slamrecover: 'Idle_Loop',
  },
  speed: { idle: 1, walk: 1, run: 1, jump: 1, air: 1, hover: 1, fly: 0.6, boost: 1, charge: 1, land: 1 },
  // повороты костей (радианы XYZ), накладываются поверх клипа
  poses: {},
};

const KEY = 'skyfly-anim';
const LEGACY_POSES = {
    fly: {
      tilt: 1.25,                       // наклон всего тела вперёд, радианы
      bones: {
        'DEF-upper_arm.L': [-0.5, 0, 1.15],
        'DEF-upper_arm.R': [-0.5, 0, -1.15],
        'DEF-forearm.L': [0, 0, 0.15],
        'DEF-forearm.R': [0, 0, -0.15],
        'DEF-spine.002': [-0.12, 0, 0],
        'DEF-neck': [-0.35, 0, 0],
        'DEF-head': [-0.25, 0, 0],
        'DEF-thigh.L': [0.1, 0, 0.05],
        'DEF-thigh.R': [0.1, 0, -0.05],
      },
    },
  };


// При импорте проверяем весь документ до изменения текущего проекта.
export function normalizeSetup(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Ожидается проект анимаций JSON');
  if (value.version != null && ![1, 2, 3].includes(value.version)) throw new Error('Неподдерживаемая версия проекта');
  if (!value.clips || typeof value.clips !== 'object' || Array.isArray(value.clips)) throw new Error('Нет назначений действий (clips)');
  const out = structuredClone(DEFAULT_SETUP);
  if (value.cape !== undefined) {
    if (!value.cape || typeof value.cape !== 'object' || typeof value.cape.enabled !== 'boolean') throw new Error('Некорректная настройка плаща');
    out.cape.enabled = value.cape.enabled;
    for (const [state] of STATES) if (value.cape.strengths?.[state] !== undefined) {
      const strength = value.cape.strengths[state];
      if (!Number.isFinite(strength) || strength < 0 || strength > 2) throw new Error('Колыхание плаща: от 0 до 2');
      out.cape.strengths[state] = strength;
    }
  }
  out.animations = { ...out.animations, ...validateAnimations(value.animations) };
  for (const [state] of STATES) {
    const clip = value.clips[state];
    if (clip !== undefined) {
      if (clip !== null && (typeof clip !== 'string' || clip.length > 160)) throw new Error('Некорректный клип');
      if (clip?.startsWith('custom:') && !Object.hasOwn(out.animations, clip.slice(7))) throw new Error('Назначена отсутствующая анимация');
      out.clips[state] = clip;
    }
    const speed = value.speed?.[state];
    if (speed !== undefined) {
      if (typeof speed !== 'number' || !Number.isFinite(speed) || speed < 0 || speed > 3) throw new Error('Скорость должна быть от 0 до 3');
      out.speed[state] = speed;
    }
    if (value.poses?.[state] !== undefined) out.poses[state] = validatePose(value.poses[state]);
  }
  // Старое заводское назначение плавания заменяем полётом; собственные клипы не трогаем.
  if ((value.version || 1) < 3) for (const state of ['fly', 'boost']) {
    if (out.clips[state] === 'Swim_Fwd_Loop') out.clips[state] = 'custom:hero-flight';
  }
  // Мигрируем только точное старое заводское наложение; авторские позы сохраняем.
  const fly = out.poses.fly, legacy = LEGACY_POSES.fly;
  if (value.clips.fly === 'Swim_Fwd_Loop' && fly?.tilt === legacy.tilt &&
      Object.keys(fly.bones).length === Object.keys(legacy.bones).length &&
      Object.entries(legacy.bones).every(([k, v]) => JSON.stringify(fly.bones[k]) === JSON.stringify(v)) &&
      !Object.keys(fly.positions || {}).length) delete out.poses.fly;
  return out;
}
export function loadSetup() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? normalizeSetup(JSON.parse(raw)) : structuredClone(DEFAULT_SETUP);
  } catch { return structuredClone(DEFAULT_SETUP); }
}
// Ошибку quota/security получает UI: не показываем ложное «сохранено».
export const saveSetup = (s) => localStorage.setItem(KEY, JSON.stringify(normalizeSetup(s)));
export const resetSetup = () => { localStorage.removeItem(KEY); return structuredClone(DEFAULT_SETUP); };
