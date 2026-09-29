// ГРАВИТАЦИЯ И ТЕЛО ПЕРСОНАЖА — самый низкий слой игры. Здесь нет ни рендера, ни ввода:
// на входе желание игрока, на выходе новая скорость и позиция.
//
// Как это работает:
//   • Земля — шар радиусом 6371 км, «вниз» — к её центру. Персонаж всегда в нуле сцены,
//     а его настоящее место хранится как широта/долгота/высота над уровнем моря.
//   • Ускорение свободного падения падает с высотой: g(h) = 9.81 · (R/(R+h))².
//     На 100 км это уже 9.5 — заметно только в длинном падении, но считать честно дёшево.
//   • Сопротивление воздуха ограничивает падение предельной скоростью. Человек «солдатиком»
//     разгоняется до ~85 м/с (300 км/ч), плашмя — до ~55. Мы берём 85, это ~5 секунд с крыши
//     небоскрёба и приземление, которое чувствуется.
//   • Опора (пол) приходит снаружи функцией floorAt() — это рельеф Земли плюс крыши домов.
//     Персонаж — вертикальный отрезок роста HEIGHT: ноги на полу, начало координат на уровне глаз.
//   • Стена тоже приходит снаружи — floorAt(вперёд): если впереди пол выше пояса, дальше не идём
//     (низкий бортик перешагиваем, высокий останавливает).

export const G0 = 9.81;              // м/с² у поверхности
export const R_EARTH = 6_371_000;    // м
export const HEIGHT = 1.75;          // рост, м — на столько ноги ниже начала координат
export const STEP_UP = 0.6;          // бортик такой высоты перешагиваем не останавливаясь
export const TERM_VEL = 85;          // предельная скорость падения, м/с
export const DIVE_VEL = 130;         // нырок головой вниз (Ctrl в падении)
export const AIR_DENSITY = (h) => Math.exp(-h / 8500);   // грубая модель атмосферы

export const gravityAt = (alt) => G0 * (R_EARTH / (R_EARTH + Math.max(0, alt))) ** 2;

// Скорость падения затухает к предельной: сопротивление всегда направлено ПРОТИВ движения.
// a = −g + g·(v/vt)²·sign(−v). На предельной скорости (v = −vt) ускорение ровно ноль.
// Здесь был знак наоборот — падение разгонялось до 344 м/с вместо 85.
export function fall(vy, alt, dt, term = TERM_VEL) {
  if (!(dt > 0)) return vy;
  const g = gravityAt(alt);
  const terminal = term / Math.sqrt(Math.max(1e-8, AIR_DENSITY(Math.max(0, alt))));
  // Exact quadratic-drag step at the current altitude. Euler used to reverse a
  // fast upward velocity instantly, and forced orbital falls to 85 m/s in vacuum.
  if (vy > 0) {
    const angle = Math.atan(vy / terminal), apex = terminal / g * angle;
    if (dt <= apex) return terminal * Math.tan(angle - g * dt / terminal);
    return -terminal * Math.tanh(g * (dt - apex) / terminal);
  }
  const down = -vy, t = Math.tanh(g * dt / terminal);
  return -terminal * (down + terminal * t) / (terminal + down * t);
}

// Сила удара при касании земли: 0 — мягко встал, 1 — с предельной скорости.
// Высота падения из скорости: h = v²/2g — по ней и пишем в лог «с какой крыши сиганул».
export const impactOf = (vy) => Math.min(1, Math.abs(vy) / TERM_VEL);
export const fallHeight = (vy) => (vy * vy) / (2 * G0);
