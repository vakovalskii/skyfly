// ПЕРСОНАЖ. Состояние и один шаг симуляции. Три режима:
//   'ground' — стоим/идём/бежим по крыше или земле;
//   'air'    — прыгнули или шагнули с края: гравитация, слабое управление в воздухе;
//   'fly'    — суперменский полёт (включается вторым нажатием пробела в воздухе).
// Мир снаружи: floorAt(east, north) — высота опоры, headroomAt — высота преграды впереди.

import { fall, impactOf, fallHeight, HEIGHT, DIVE_VEL, TERM_VEL, G0 } from './gravity.js';
import { density } from './grid.js';

export const MOVE = {
  walk: 1.8,        // м/с, быстрый шаг человека (обычный 1.4)
  run: 6.0,         // бег (Shift) с места — обычный бег…
  runMax: 45,       // …и дальше разгон до сверхбега: ~100 миль/ч — скорость Супермена в ранних комиксах
  runAccel: 14,     // м/с² — от 6 до 45 м/с примерно за 3 с удержания Shift
  turn: 2.6,        // рад/с — разворот клавишами A/D на земле
  faceRate: 9,      // как быстро корпус доворачивается к направлению бега
  accel: 14,        // насколько резко набираем и сбрасываем скорость по земле
  airCtrl: 2.2,     // управление в свободном падении, м/с²
  flySpeed: 180,    // обычный полёт: ~650 км/ч у земли, к 10 км быстрее (разреженный воздух)
  flyBoost: 1200,   // форсаж
  flyAccel: 150,
  flyBoostAccel: 320,
  flyTurn: 3.5,     // рад/с — как быстро вектор полёта доворачивает за взглядом
  hoverRise: 24, hoverBoostRise: 65, // вертикальный подъём в позе зависания, без W
  flyDive: 400,     // пике вниз (Ctrl или взгляд вниз): предел выше обычного полёта
  flare: 3.5,       // 1/с — у опоры скорость снижения не больше высоты × flare: садимся мягко с любой скорости
};

// Заряженный прыжок: держишь пробел — копится сила, отпускаешь — прыгаешь.
// Касание — 7 м (два этажа), полный заряд — 500 м строго вверх. Высота растёт по квадрату заряда,
// чтобы средние прыжки «на соседнюю крышу» было легко дозировать.
export const JUMP = { min: 7, max: 500, full: 1.6, tap: 0.12 };
export const SLAM = { minHeight: 4, cost: 8, acceleration: 180, maxSpeed: 240, impactTime: .28, recoverTime: .85 };
export const jumpCharge = (held) => (held < JUMP.tap ? 0 : Math.min(1, (held - JUMP.tap) / (JUMP.full - JUMP.tap)));
export const jumpHeight = (k) => JUMP.min + (JUMP.max - JUMP.min) * k * k;
// Скорость отрыва для высоты h с тем же сопротивлением, что в fall(): h = vt²/2g · ln(1 + v0²/vt²)
export const jumpSpeed = (h) => TERM_VEL * Math.sqrt(Math.expm1((2 * G0 * h) / TERM_VEL ** 2));

export const newCharacter = (lat, lon) => ({
  lat, lon, alt: 0,
  vel: [0, 0, 0],            // восток, вверх, север (м/с)
  yaw: 0, pitch: 0, face: 0,      // yaw — куда смотрит камера, face — куда развёрнут корпус
  mode: 'ground',
  hoverLift: false,
  grounded: true,
  jumpHeld: 0, charge: 0, prevJump: false, prevFly: false,
  fallFrom: 0, impact: 0, boom: 0,
  slam: null, prevSlam: false,
  power: 100, maxPower: 100, exhausted: false,
  height: HEIGHT,
});

// Направление «вперёд» по взгляду и «вправо» — в локальных метрах (восток, вверх, север).
export function basis(c) {
  const cp = Math.cos(c.pitch);
  return {
    fwd: [Math.sin(c.yaw) * cp, Math.sin(c.pitch), Math.cos(c.yaw) * cp],
    flat: [Math.sin(c.yaw), 0, Math.cos(c.yaw)],
    right: [Math.cos(c.yaw), 0, -Math.sin(c.yaw)],
  };
}

export function stepCharacter(c, keys, dt, world) {
  let { fwd, flat, right } = basis(c);
  const floor = (e = 0, n = 0) => world.floorAt(e, n);
  const slamPressed = !!keys.slam && !c.prevSlam;
  c.prevSlam = !!keys.slam;
  if (c.slam && c.slam.phase !== 'dive') {
    // Contact owns the hit/recovery clock; held movement cannot erase the impact pose.
    c.slam.time += dt;
    const length = c.slam.phase === 'impact' ? SLAM.impactTime : SLAM.recoverTime;
    if (c.slam.time >= length) {
      if (c.slam.phase === 'impact') { c.slam.phase = 'recover'; c.slam.time -= length; }
      else c.slam = null;
    }
    c.vel.fill(0); c.alt = floor(); c.grounded = true; c.mode = 'ground';
    c.jumpHeld = c.charge = 0; c.prevJump = !!keys.jump; c.prevFly = !!keys.fly;
    c.power = Math.min(c.maxPower, c.power + 9 * dt);
    c.impact = Math.max(0, c.impact - dt * 2); c.boom = Math.max(0, c.boom - dt * 1.4);
    return { speed: 0, rho: density(c.alt), moving: false, fallDist: 0, ground: c.alt };
  }
  if (slamPressed && !c.grounded && !c.slam && c.alt - floor() >= SLAM.minHeight && c.power >= SLAM.cost) {
    c.slam = { phase: 'dive', time: 0 };
    c.mode = 'air'; c.power -= SLAM.cost; c.fallFrom = c.alt;
    c.vel[0] = c.vel[2] = 0; c.vel[1] = Math.min(-12, Math.max(-SLAM.maxSpeed, c.vel[1]));
    world.onSlamStart?.();
  }
  if (c.slam?.phase === 'dive') {
    if ((keys.jump && !c.prevJump) || (keys.fly && !c.prevFly)) c.slam = null;
    else c.slam.time += dt;
  }

  // куда просит идти игрок: по земле — строго горизонтально, в полёте — по взгляду
  const w = [0, 0, 0];
  const add = (v, s) => { w[0] += v[0] * s; w[1] += v[1] * s; w[2] += v[2] * s; };
  const dir = c.mode === 'fly' ? fwd : flat;
  if (keys.fwd) add(dir, 1);
  if (keys.back) add(dir, -1);
  // На земле A/D — разворот (камера едет следом, как в обычном виде от третьего лица),
  // в полёте — смещение вбок. Стрейф пешком остаётся на Q/E.
  if (c.mode === 'fly') {
    if (keys.right) add(right, 1);
    if (keys.left) add(right, -1);
  } else {
    if (keys.right) c.yaw += MOVE.turn * dt;
    if (keys.left) c.yaw -= MOVE.turn * dt;
    if (keys.strafeR) add(right, 1);
    if (keys.strafeL) add(right, -1);
  }
  const up = keys.up || (c.mode === 'fly' && keys.jump);   // в полёте пробел держим — набираем высоту
  if (c.mode === 'fly') { if (up) w[1] += 1; if (keys.down) w[1] -= 1; }
  const wl = Math.hypot(...w);
  if (wl > 1e-4) for (let i = 0; i < 3; i++) w[i] /= wl;
  const moving = wl > 1e-4;

  // наклон взгляда стрелками (мышь не обязательна)
  if (keys.lookUp) c.pitch = Math.min(1.4, c.pitch + 1.6 * dt);
  if (keys.lookDown) c.pitch = Math.max(-1.4, c.pitch - 1.6 * dt);

  ({ fwd, flat, right } = basis(c));       // yaw мог измениться поворотом A/D

  // ---- пробел: заряженный прыжок / включение полёта ----
  const jumpPressed = keys.jump && !c.prevJump;
  c.prevJump = keys.jump;
  // F — переключатель полёта: в полёте выключает (начинаем падать), в падении включает
  const flyPressed = keys.fly && !c.prevFly;
  c.prevFly = keys.fly;
  if (flyPressed && c.mode === 'fly') { c.mode = 'air'; c.fallFrom = c.alt; world.onFall?.(); }
  else if (flyPressed && c.mode === 'air' && c.power > 5) { c.mode = 'fly'; world.onFly?.(Math.abs(c.vel[1])); }
  if (c.grounded) {
    if (keys.jump) { c.jumpHeld += dt; c.charge = jumpCharge(c.jumpHeld); }
    else if (c.jumpHeld > 0) {
      const k = jumpCharge(c.jumpHeld);
      c.vel[1] = jumpSpeed(jumpHeight(k));            // горизонтальная скорость остаётся: с разбега — дугой
      c.grounded = false; c.mode = 'air'; c.fallFrom = c.alt;
      if (k > 0.2) { c.boom = k; world.onTakeoff?.(k, jumpHeight(k)); } else world.onJump?.();
      c.jumpHeld = 0; c.charge = 0;
    }
  } else {
    c.jumpHeld = 0; c.charge = 0;
    if (jumpPressed && c.mode === 'air' && c.power > 5) {
      c.mode = 'fly';
      c.vel[1] = Math.max(c.vel[1], -15);
      world.onFly?.(Math.abs(c.vel[1]));
    }
  }

  // ---- движение ----
  const horizontalIntent = keys.fwd || keys.back || keys.left || keys.right || keys.strafeL || keys.strafeR;
  c.hoverLift = c.mode === 'fly' && !horizontalIntent && Math.hypot(c.vel[0], c.vel[2]) < 12 &&
    !!(c.hoverLift || keys.jump || keys.up || keys.down || Math.hypot(...c.vel) < 6);
  if (c.mode === 'ground') {
    // копим прыжок — стоим на месте (поворачиваться можно); короткое нажатие на бегу — прыжок с разбега
    // Shift: сразу обычный бег, дальше — ровный разгон до сверхбега (пока держишь и есть куда бежать).
    // Модуль скорости растёт на runAccel·dt независимо от частоты кадров, направление доворачивает как раньше.
    const hs = Math.hypot(c.vel[0], c.vel[2]);
    const wl = Math.hypot(w[0], w[2]);
    const stop = keys.brake || c.charge > 0 || wl < 0.1;
    const top = stop ? 0 : keys.run ? MOVE.run : MOVE.walk;
    const k = 1 - Math.exp(-MOVE.accel * dt);
    if (!stop && keys.run && hs > MOVE.run - 0.5) {
      const sp = Math.min(MOVE.runMax, hs + MOVE.runAccel * dt);
      let ve = c.vel[0] + (w[0] / wl * hs - c.vel[0]) * k, vn = c.vel[2] + (w[2] / wl * hs - c.vel[2]) * k;
      const l = Math.hypot(ve, vn) || 1;
      c.vel[0] = ve / l * sp; c.vel[2] = vn / l * sp;
    } else {
      c.vel[0] += (w[0] * top - c.vel[0]) * k;
      c.vel[2] += (w[2] * top - c.vel[2]) * k;
    }
    c.vel[1] = 0;
  } else if (c.mode === 'air') {
    if (c.slam?.phase === 'dive') {
      c.vel[0] = c.vel[2] = 0;
      c.vel[1] = Math.max(-SLAM.maxSpeed, c.vel[1] - SLAM.acceleration * dt);
    } else {
    const a = MOVE.airCtrl * (keys.run ? 1.6 : 1);          // в падении рулим слабо
    c.vel[0] += w[0] * a * dt;
    c.vel[2] += w[2] * a * dt;
    c.vel[1] = fall(c.vel[1], c.alt, dt, keys.down ? DIVE_VEL : TERM_VEL);   // Ctrl — нырок, падаем быстрее
    }
  } else {
    if (c.hoverLift) {
      // Space lifts vertically even with a level camera. Releasing it arrests
      // the climb instead of steering that velocity forward along the camera.
      const vertical = Number(!!(keys.jump || keys.up)) - Number(!!keys.down);
      const target = keys.brake ? 0 : vertical * (keys.run ? MOVE.hoverBoostRise : MOVE.hoverRise);
      const blend = 1 - Math.exp(-5 * dt);
      c.vel[0] *= 1 - blend; c.vel[2] *= 1 - blend;
      c.vel[1] += (target - c.vel[1]) * blend;
    } else {
    // вниз разгоняемся сильнее — с высоты не спускаться по минуте;
    // в разреженном воздухе быстрее: на 12 км предел ~×3.3, иначе до стратосферы лететь минутами
    const thin = 1 - density(c.alt);
    // выше 10 км — разгон к космосу: у линии Кармана (100 км) форсаж ≈ 30 км/с (~108 тыс. км/ч,
    // втрое выше второй космической — Супермен); обычный полёт там ≈ 5.4 км/с
    const space = Math.min(1, Math.max(0, (c.alt - 10_000) / 90_000)) ** 1.5;
    const top = keys.run ? MOVE.flyBoost * (1 + thin) * (1 + 11.5 * space)
      : (MOVE.flySpeed + (MOVE.flyDive - MOVE.flySpeed) * Math.max(0, -w[1])) * (1 + 3 * thin) * (1 + 5 * space);
    const a = (keys.run ? MOVE.flyBoostAccel : MOVE.flyAccel) * (1 + 6 * space);   // в пустоте разгон быстрее
    let cur = Math.hypot(...c.vel);
    // Летим туда, куда смотрим — как самолёт: вектор скорости всегда доворачивает за взглядом,
    // даже без W (поднял взгляд двумя пальцами — пошёл вверх). С клавишами — к их направлению
    // (W по взгляду, Q/E/Space/Ctrl добавляют своё). S в полёте — тормоз, а не разворот.
    const braking = keys.brake || (keys.back && !keys.fwd);
    const steer = braking ? null : moving ? w : fwd;
    if (steer && cur > 1) {
      const t = Math.min(1, MOVE.flyTurn * dt);
      const d = [0, 1, 2].map((i) => c.vel[i] / cur + (steer[i] - c.vel[i] / cur) * t);
      const dl = Math.hypot(...d) || 1;
      for (let i = 0; i < 3; i++) c.vel[i] = (d[i] / dl) * cur;
    }
    if (moving && !braking && c.power > 0 && cur < top) for (let i = 0; i < 3; i++) c.vel[i] += w[i] * a * dt;
    // Сопротивление — от плотности воздуха: у земли как раньше, в вакууме почти ноль
    // (раньше постоянное трение 0.25 держало потолок ≈ ускорение/0.25 ≈ 1280 м/с на любой высоте).
    const air = 0.003 + density(c.alt);                    // в пустоте почти ноль: орбитальная скорость не тает сама
    const fr = braking ? 3.5 : (moving ? 0.25 : 0.12) * air / 1.05;   // без клавиш — летим по инерции
    for (let i = 0; i < 3; i++) c.vel[i] *= Math.max(0, 1 - fr * dt);
    cur = Math.hypot(...c.vel);
    // Выше предела — плавно к нему, но только если есть воздух: в пустоте скорость сохраняется
    // (раньше за 5 с на 130 км гасло 7.2 → 2.2 км/с и входа в атмосферу на орбитальной скорости
    // не было). Сила торможения ∝ плотности: почти ноль выше 80 км, основное — 50…30 км, как у капсул.
    const capRate = 0.8 * Math.min(1, density(c.alt) * 40);
    if (cur > top * 1.02) for (let i = 0; i < 3; i++) c.vel[i] *= 1 - Math.min(1, capRate * dt) * (1 - top / cur);
    }
    // Без клавиш высота держится (как самолёт) — проседания нет; падать — F.
    // Посадка: снижение не быстрее высоты × flare — у опоры плавно тормозим и встаём на ноги
    // с любой скорости пике. Горизонтальная скорость гаснет уже на земле.
    const above = c.alt - floor(0, 0);
    if (c.vel[1] < 0) c.vel[1] = Math.max(c.vel[1], -(1.5 + above * MOVE.flare));
    const currentSpeed = Math.hypot(...c.vel);
    if (currentSpeed > 330 && currentSpeed - 330 < 40 && c.alt < 20_000) c.boom = Math.max(c.boom, 0.8);
    if (c.power <= 0) { c.mode = 'air'; world.onTired?.(); }
  }

  // ---- сила: тратится только в полёте ----
  const rho = density(c.alt);
  if (c.mode === 'fly') {
    const spd = Math.hypot(...c.vel);
    // Расход растёт со скоростью и плотностью воздуха: у земли на 90 м/с хватает на ~2 мин,
    // в стратосфере — втрое дешевле. Выше 100 км воздуха нет — сила восстанавливается.
    if (c.alt > 100_000) c.power += 4 * dt;
    else c.power -= ((0.6 + (spd / 700) ** 1.3) * (0.2 * Math.exp(-c.alt / 30_000) + rho) + 0.1) * dt;   // в пустоте скорость почти бесплатна
  } else c.power += (c.grounded ? 9 : 3) * dt;
  c.power = Math.max(0, Math.min(c.maxPower, c.power));
  c.exhausted = c.power <= 0.5;

  // ---- перенос и контакт с миром ----
  const dEast = c.vel[0] * dt, dNorth = c.vel[2] * dt, dUp = c.vel[1] * dt;

  // стены: точный шаг по контурам зданий со скольжением вдоль фасада
  const [moveEast, moveNorth, hitWall] = world.tryMove(dEast, dNorth, c.alt, dUp);
  if (hitWall) {
    if (c.mode === 'fly') { c.vel[1] = Math.max(c.vel[1], 25); world.onWall?.(); }   // в полёте лезем вверх по фасаду
    else { c.vel[0] *= 0.35; c.vel[2] *= 0.35; }
  }

  c.alt += dUp;
  const [lat, lon] = world.move(c.lat, c.lon, moveEast, moveNorth);
  c.lat = lat; c.lon = lon;

  // ---- пол ----
  const g = floor(0, 0);
  if (c.alt <= g + 0.02) {
    const hit = Math.abs(Math.min(0, c.vel[1]));
    c.alt = g;
    if (!c.grounded) {
      c.impact = impactOf(hit);
      if (c.slam?.phase === 'dive') {
        const strength = Math.min(1, Math.max(.25, hit / 150));
        c.slam = { phase: 'impact', time: 0, strength };
        c.vel[0] = c.vel[2] = 0;
        world.onSlam?.({ lat: c.lat, lon: c.lon, alt: g, yaw: c.face, speed: hit, strength });
      } else world.onLand?.(hit, c.impact, fallHeight(hit));
      const brake = Math.max(0, 1 - c.impact * 0.95);
      c.vel[0] *= brake; c.vel[2] *= brake;
    }
    c.grounded = true; c.mode = 'ground'; c.vel[1] = 0; c.fallFrom = 0;
  } else if (c.alt > g + 0.25) {
    if (c.grounded && c.mode === 'ground') { c.mode = 'air'; c.fallFrom = c.alt; }   // шагнул с края
    c.grounded = false;
  } else if (c.mode === 'ground') {
    c.alt = g;                                                // мелкие ступеньки проходим не отрываясь
  }

  // Корпус всегда доворачивается туда, куда смотрит камера: крутишь мышью или жмёшь A/D —
  // персонаж поворачивается вместе с видом. Исключение — стрейф Q/E: тогда разворачиваем по движению,
  // чтобы он не ехал боком.
  const flatSpeed = Math.hypot(c.vel[0], c.vel[2]);
  const strafing = (keys.strafeL || keys.strafeR) && !keys.fwd && !keys.back;
  const want = strafing && flatSpeed > 0.6 ? Math.atan2(c.vel[0], c.vel[2]) : c.yaw;
  let diff = want - c.face;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  c.face += diff * Math.min(1, MOVE.faceRate * dt);

  c.impact = Math.max(0, c.impact - dt * 2);
  c.boom = Math.max(0, c.boom - dt * 1.4);
  const speed = Math.hypot(...c.vel);
  return { speed, rho, moving, fallDist: c.mode === 'air' ? Math.max(0, c.fallFrom - c.alt) : 0, ground: g };
}
