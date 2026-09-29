// Развитие авторской позы без замены исходного клипа и без изменения конечностей.
import { validateAnimations } from './animation-data.js';

export function cycleFromFirstFrame(source, { duration = source.duration, swayDegrees = 0.8 } = {}) {
  // Валидируем копию; сортировка кадров не меняет исходный проект.
  const input = validateAnimations({ source }).source;
  if (!Number.isFinite(swayDegrees) || swayDegrees < 0 || swayDegrees > 5) throw new Error('Движение корпуса должно быть от 0 до 5°');
  const base = input.frames[0].pose;
  const amplitude = swayDegrees * Math.PI / 180;
  const result = {
    name: `${input.name.slice(0, 70)} · цикл`, duration, loop: true,
    frames: [0, 1, 0, -1, 0].map((offset, i) => {
      const pose = structuredClone(base);
      pose.tilt += offset * amplitude;
      return { time: duration * i / 4, pose };
    }),
  };
  return validateAnimations({ result }).result;
}
