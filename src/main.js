// ПОЛЁТ — сборка блоков и главный цикл. Формул здесь нет: правила в core/, картинка в render/,
// связки в game/. Порядок сборки такой же, как порядок задач: земля → дома → сетка → персонаж.
import * as THREE from 'three';
import { newCharacter, stepCharacter, basis } from './core/character.js';
import { createSky } from './render/sky.js';
import { createClouds } from './render/clouds.js';
import { createStorm } from './render/storm.js';
import { TAKRAM, createTakram } from './render/takram.js';
import { setCityNight } from './render/city.js';
import { createTrail } from './render/trail.js';
import { createLighting } from './render/lighting.js';
import { createPerf } from './game/perf.js';
import { createShock } from './render/shock.js';
import { createLayers } from './render/layers.js';
import { createFauna } from './render/fauna.js';
import { NEAR as CITY_NEAR, FAR as CITY_FAR } from './render/city.js';
import { makeHero } from './render/hero.js';
import { loadHero } from './render/hero3d.js';
import { createWind, createBoomCone } from './render/wind.js';
import { createPost } from './render/post.js';
import { speedBlurAmount } from './render/speed-blur.js';
import { createFx } from './render/fx.js';
import { createFlightAura } from './render/flight-aura.js';
import { createFlightPresentation } from './render/flight-cues.js';
import { createGroundImpact } from './render/ground-impact.js';
import { createSpeedAura } from './render/speed-aura.js';
import { createBuildingWhoosh } from './game/building-whoosh.js';
import { connect } from './game/net.js';
import { createAudio } from './game/audio.js';
import { createInput } from './game/input.js';
import { createChaseCamera } from './game/camera.js';
import { createHud, say } from './game/hud.js';
import { createRecorder } from './game/recorder.js';
import { createReleaseNotice } from './game/release-notice.js';
import { createWorld, CITIES_GEO } from './game/world.js';
import { createPlayers } from './game/players.js';
import { GRID, fadeWires, toggleStyle, takeResume } from './render/style.js';

const MOBILE = matchMedia('(pointer: coarse)').matches || innerWidth < 820;
const $ = (id) => document.getElementById(id);

// ---------- рендер ----------
// Keep metre-scale hero geometry and the Earth hundreds of kilometres below
// distinguishable in depth. Takram and postprocessing decode logarithmic depth.
const renderer = new THREE.WebGLRenderer({ antialias: !MOBILE, powerPreference: 'high-performance', logarithmicDepthBuffer: TAKRAM });
// ?pr=1 — меньше пикселей (на Retina ×2 — вчетверо больше работы облакам и постобработке)
const PR_FIXED = Number(new URLSearchParams(location.search).get('pr')) || 0;
const PR_MAX = Math.min(devicePixelRatio, PR_FIXED || (MOBILE ? 1.25 : 2));
renderer.setPixelRatio(PR_MAX);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.append(renderer.domElement);
addEventListener('resize', () => renderer.setSize(innerWidth, innerHeight));

const scene = new THREE.Scene();
const chase = createChaseCamera(MOBILE);
const camera = chase.camera;
const sky = createSky(scene, MOBILE);
// Слой поверх итогового кадра: туман, дождь, след. Прозрачное без глубины атмосфера takram
// иначе затирает небом — поэтому рисуем после неё, отдельной сценой той же камерой.
const overlay = new THREE.Scene();
const clouds = createClouds(scene, MOBILE, overlay);
const trail = createTrail(overlay);
const perf = createPerf(renderer, scene, overlay, camera);   // I — статистика отрисовки
let wasInCloud = false;
// физическая атмосфера и объёмные облака takram (по умолчанию; ?sky=old — наши прежние небо и облака)
let takram = null;
// тени от солнца (каскады CSM) и от облаков; ?shadows=0 — без теней
const lighting = new URLSearchParams(location.search).get('shadows') === '0' ? null : createLighting(scene, camera, renderer, MOBILE);
if (lighting) sky.sunLight.visible = false;
if (TAKRAM) {
  sky.disable(); clouds.disable();
  createTakram(renderer, scene, camera, import.meta.env.BASE_URL, MOBILE, (h) => say(`Время: ${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round(h % 1 * 60)).padStart(2, '0')} МСК`), lighting)
    .then((t) => {
      takram = t; window.__takram = t;
      if (CLOUDS_Q === 'low') liteClouds('?clouds=low');
      else if (MOBILE || WEAK_GPU) liteClouds(MOBILE ? 'телефон' : 'встроенная видеокарта');
      perf.watchPasses(t.composer, ['сцена', 'облака', 'небо', 'лучи', 'смаз', 'пост', 'туман города', 'сглаживание']);
      say('Атмосфера и облака: takram');
    })
    .catch((e) => { console.error(e); say(`takram не запустился: ${e.message}`); });
}
const post = createPost(renderer, scene, camera, MOBILE);
if (!TAKRAM) perf.watchPasses(post.composer, ['сцена', 'смаз', 'вывод']);
const world = createWorld(scene, MOBILE);
const fx = createFx(scene);
const wind = createWind(overlay, MOBILE);      // поток воздуха и конус — поверх кадра, во всех режимах
const cone = createBoomCone(overlay);
const shock = createShock(overlay);            // конус пара, ударная волна, плазма входа в атмосферу
const velScene = new THREE.Vector3();
const layers = createLayers(overlay);          // кольца-«мембраны» при пробое слоёв атмосферы
const fauna = createFauna(scene, overlay, MOBILE);   // стаи птиц и самолёты с огнями и инверсионным следом
const flightAura = createFlightAura(overlay, { depthTest: false });
const flightPresentation = createFlightPresentation();
const groundImpact = createGroundImpact(scene, overlay);
const audio = createAudio();
const storm = createStorm(scene, gain => audio.play('thunder', gain));
const speedAura = createSpeedAura(overlay);
const buildingWhoosh = createBuildingWhoosh(event => audio.passBy(event));

// ---------- персонаж ----------
const c = newCharacter(CITIES_GEO.moscow.lat, CITIES_GEO.moscow.lon);
const keys = { fwd: false, back: false, left: false, right: false, strafeL: false, strafeR: false,
  run: false, jump: false, up: false, down: false, brake: false, fly: false, slam: false, lookUp: false, lookDown: false };
let makeBody = () => makeHero({ scale: 1 });
let hero = makeBody();
hero.userData.perfCat = 'герой';
scene.add(hero);
lighting?.setHero(hero);

const net = connect({ onChat: (m) => say(`${m.from}: ${m.text}`) });
const players = createPlayers(scene, net, makeBody);
const hud = createHud({ p: c, net, cities: world.cities, audio, mobile: MOBILE });
const recording = createRecorder({ canvas: renderer.domElement, audio, character: c, say });
if (import.meta.env.PROD) createReleaseNotice({ current: __SKYFLY_RELEASE__, url: `${import.meta.env.BASE_URL}release.json`, canReload: () => !recording.active });
createInput({ el: renderer.domElement, p: c, keys, mobile: MOBILE, onChat: hud.openChat, onHelp: hud.toggleHelp, onSound: hud.toggleSound });

let editor = null;
const heroReady = loadHero(import.meta.env.BASE_URL).then(async (factory) => {
  makeBody = factory;
  scene.remove(hero);
  hero = makeBody();
  hero.userData.character = c;
  hero.userData.perfCat = 'герой';
  scene.add(hero);
  lighting?.setHero(hero);
  players.setFactory(makeBody);
  // Studio and its shortcuts/styles are excluded from the public build.
  if (import.meta.env.DEV) {
    const { createPoseEditor } = await import('./game/poseeditor.js');
    editor = createPoseEditor({
      hero: () => hero, character: c, camera, animations: factory.animations,
      onToggle: (on) => say(on ? 'Редактор анимаций: P — закрыть' : 'Редактор закрыт'),
    });
    addEventListener('keydown', (ev) => {
      if (ev.code === 'KeyP' && !/INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) editor.toggle();
    });
    say('Модель героя загружена · P — редактор анимаций');
  } else say('Модель героя загружена');
}).catch((e) => say('модель героя не загрузилась: ' + e.message));

// ---------- события мира ----------
const events = {
  floorAt: (e, n) => world.floorAt(e, n),
  move: (lat, lon, e, n) => world.move(lat, lon, e, n),
  tryMove: (e, n, feet, up) => world.tryMove(e, n, feet, up),
  onJump: () => audio.play('jump', 0.6),
  onSlamStart: () => { say('УДАР В ЗЕМЛЮ · F / Space — отменить'); audio.play('boost-charge', .5); },
  onSlam: (hit) => {
    groundImpact.fire(hit); audio.play('slam', hit.strength);
    chase.kick(.35 + hit.strength * .9); fx.flash(.15 + hit.strength * .25);
    say('УДАР · ' + Math.round(hit.speed * 3.6) + ' км/ч');
  },
  onTakeoff: (k, h) => {                      // заряженный прыжок: чем сильнее, тем мощнее волна и тряска
    fx.shock(0.4 + k * 1.2); audio.play('takeoff', 0.5 + k * 0.7); chase.kick(0.4 + k * 0.8);
    if (k > 0.7) fx.flash(0.35 * k);
    say(`Прыжок · ${Math.round(h)} м`);
  },
  onFly: () => { audio.play('flight', 0.75); fx.shock(0.35); say('Полёт'); },
  onTired: () => say('Силы кончились — падаем'),
  onFall: () => say('Полёт выключен — падаем'),
  onWall: () => { if (frame % 20 === 0) audio.play('land', 0.3); },
  // Удар о землю: чем быстрее падал, тем крупнее волна, тряска и звук.
  onLand: (v, k, h) => {
    if (v < 4) return;
    if (v < 12) { audio.play('step', 0.5); return; }
    fx.shock(0.4 + k * 2); audio.play('land', 0.6 + k * 1.2); chase.kick(Math.min(1.4, 0.3 + k * 1.4));
    if (k > 0.45) { fx.flash(k * 0.6); say(`Удар о землю: падение ${Math.round(h)} м, ${Math.round(v * 3.6)} км/ч`); }
  },
};

world.events = events;      // селф-тест подменяет обработчики, чтобы ловить удары

// ---------- главный цикл ----------
let last = performance.now(), t = 0, frame = 0, fps = 60;
let resume = takeResume();          // переключение стиля имеет приоритет над серверной позицией
let prevSpeed = 0, placed = false, pendingBoom = false, started = false;
const fwdV = new THREE.Vector3(0, 0, -1);

// Плотность пикселей под нагрузку: облака и постобработка платят за каждый пиксель, на Retina ×2 —
// вчетверо больше работы. Каждые 2 с по средней частоте кадров: ниже 48 к/с — плотность −0.25
// (не ниже 1), три окна подряд выше 57 и 30 с без тормозов — +0.25 обратно до максимума. ?pr= отключает подстройку.
let prNow = PR_MAX, prT = 0, prFrames = 0, prGood = 0, prBad = 0;   // prBad — где тормозило (не лезем выше 30 с)
// Облака: ?clouds=low — сразу облегчённые, ?clouds=high — никогда; иначе облегчаем сами, если
// видеокарта встроенная/мобильная или плотность уже 1, а кадров всё равно меньше 42 (два окна подряд).
const CLOUDS_Q = new URLSearchParams(location.search).get('clouds') || '';
const WEAK_GPU = (() => {
  try {
    const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    return /Intel|Mali|Adreno|PowerVR|SwiftShader|llvmpipe|Microsoft Basic/i.test(name);
  } catch { return false; }
})();
let liteSlow = 0;
function liteClouds(why) {
  if (!takram || takram.lite || CLOUDS_Q === 'high') return;
  takram.setLite(true);
  say(`Облегчённые облака: ${why}`);
}
function adaptPixels(dt) {
  if (t < 10) return;
  prT += dt; prFrames++;
  if (prT < 2) return;
  const avg = prFrames / prT;
  prT = 0; prFrames = 0;
  if (takram && !takram.lite && (PR_FIXED || prNow <= 1)) {
    liteSlow = avg < 42 ? liteSlow + 1 : 0;
    if (liteSlow >= 2) liteClouds(`${Math.round(avg)} к/с`);
  }
  if (PR_FIXED) return;
  let next = prNow;
  if (avg < 48) { next = Math.max(1, prNow - 0.25); prGood = 0; prBad = t; }
  else if (avg > 57 && ++prGood >= 3 && t - prBad > 30) { next = Math.min(PR_MAX, prNow + 0.25); prGood = 0; }
  if (next === prNow) return;
  prNow = next;
  renderer.setPixelRatio(prNow);
  post.composer.setPixelRatio?.(prNow);
  dispatchEvent(new Event('resize'));      // все буферы (сцена, облака, лучи, пост) пересоздаются под размер
}

function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.max(0, Math.min(0.05, (now - last) / 1000));
  last = now;
  // Студия рисует собственную сцену. Скрытый мир не должен отнимать GPU и загружать тайлы.
  if (editor?.open) {
    for (const k of Object.keys(keys)) keys[k] = false;
    if (started && placed) net.send({ ...c, lat: c.lat, lon: c.lon, alt: c.alt, yaw: c.yaw, pitch: c.pitch,
      speed: Math.hypot(...c.vel), thrust: c.mode === 'fly', grounded: c.grounded });
    return;
  }
  t += dt; frame++;
  perf.frameStart();
  fps += (1 / Math.max(dt, 1e-4) - fps) * 0.05;
  adaptPixels(dt);

  // мир знает, где игрок → физика может спрашивать высоту опоры
  const { nearest, nearestD, gh } = world.sync(c, dt);
  if (started && !placed && world.terrain.groundAt(c.lat, c.lon)[1] >= 0 && world.cities.length) {
    if (resume) { Object.assign(c, resume); placed = true; say(GRID ? 'Сетка: без текстур (G — вернуть)' : 'Снимки и фасады (G — сетка)'); }
    else placed = world.spawnOnRoof(c);
    chase.snap();
  }

  const frozen = editor?.open || !started || !placed;
  if (frozen) for (const k of Object.keys(keys)) keys[k] = false;
  const res = stepCharacter(c, keys, frozen ? 0 : dt, events);
  const speed = res.speed;

  if (prevSpeed < 340 && speed >= 340 && c.alt < 30_000) pendingBoom = true;
  prevSpeed = speed;

  // камера: вперёд по взгляду, пол под камерой — из мира
  const b = basis(c);
  fwdV.set(b.fwd[0], b.fwd[1], -b.fwd[2]);            // север в сцене — это −Z

  // ноль сцены — ноги персонажа (физика хранит alt именно ног), поэтому модель ставим в ноль
  hero.position.set(0, 0, 0);
  // модель смотрит в −Z, а наш yaw отсчитывается в системе (восток, север) — отсюда минус
  hero.rotation.set(0, -c.face, 0);
  hero.userData.pose(t, {
    speed, grounded: c.grounded, thrust: c.mode === 'fly' && res.moving,
    charge: c.charge, verticalSpeed: c.vel[1], impact: c.impact, slam: c.slam,
    velocity: [c.vel[0], c.vel[1], -c.vel[2]],
    pitchView: c.pitch, mode: c.mode, yaw: c.face,
    hoverLift: c.hoverLift,
    boost: keys.run, braking: keys.brake || (keys.back && !keys.fwd), dt,
  });

  const presentation = flightPresentation.update(hero.userData.flightVisual, speed);
  const visualSpeed = presentation.speed, velocityScale = speed > .001 ? visualSpeed / speed : 0;
  const visualVelocity = [c.vel[0] * velocityScale, c.vel[1] * velocityScale, -c.vel[2] * velocityScale];
  const back = chase.update(c, dt, visualSpeed, fwdV, (camPos) => world.floorAt(camPos.x, -camPos.z) - c.alt);
  if (speed < 340 || c.alt >= 30_000 || c.grounded) pendingBoom = false;
  if (pendingBoom && presentation.releaseReady) {
    pendingBoom = false;
    fx.shock(1.3); fx.flash(0.9); cone.fire(); audio.play('boom', 1); chase.kick(1);
    say('СВЕРХЗВУК · 1 Мах');
  }
  flightAura.update(hero, camera, renderer.domElement.height);
  speedAura.update(hero, visualVelocity, visualSpeed, res.rho, dt, !c.grounded);
  buildingWhoosh.update(c, world.cities, gh, visualSpeed, dt, [camera.matrixWorld.elements[0], -camera.matrixWorld.elements[2]]);
  groundImpact.update(c, camera, dt, renderer.domElement.height);
  audio.followFlight(hero.userData.flightVisual);
  audio.followMovement(hero.userData.flightVisual, c.grounded && !frozen, speed);
  players.update(c, dt, t, camera);

  fx.update(dt, visualSpeed, fwdV, c.grounded);
  wind.update(dt, visualVelocity, res.rho, c.alt);   // усиление полос после выпрямления
  cone.update(dt, fwdV);
  velScene.set(c.vel[0], c.vel[1], -c.vel[2]);
  // пробой слоя атмосферы: кольцо по его плоскости, вспышка и толчок — ниже (плотнее) сильнее
  layers.update(dt, c.alt, velScene, speed, res.rho, !c.grounded, (L, k) => {
    say(L.name); fx.flash(0.15 + 0.5 * k); chase.kick(0.25 + 0.9 * k);
    if (k > 0.45) { fx.shock(k); audio.play('boom', k); }
  });
  fauna.update(dt, t, c, gh, camera);
  shock.update(dt, t, velScene, visualSpeed, c.alt, res.rho, !c.grounded, () => {
    // «пробой»: воздух стал достаточно плотным, ударная волна вспыхивает плазмой — взрыв
    fx.flash(1); fx.shock(1.6); cone.fire(); audio.play('boom', 1); chase.kick(1.4);
    say('ВХОД В АТМОСФЕРУ · воздух перед тобой раскалён');
  }, (k) => chase.kick(k), camera);
  audio.update(visualSpeed, res.rho, c.alt, c.mode === 'fly' && res.moving && presentation.releaseReady, c.grounded,
    { boost: keys.run && !c.hoverLift && !keys.brake && !(keys.back && !keys.fwd) && presentation.releaseReady });
  fadeWires(c.alt);
  lighting?.setOrigin(c);
  const weather = takram?.update(c, sky.sunDir, { ground: gh, roof: world.floorAt(0, 0) - gh > 1 });
  storm.update(dt, c, gh, (east, north) => world.floorAt(east, north));
  // окна зажигаются в сумерках: солнце ниже +6° → к −6° горят вовсю
  setCityNight(Math.min(1, Math.max(0, (0.1 - sky.sunDir.y) / 0.2)));
  if (takram?.photo?.ready && world.visual) { world.visual = false; say('Google 3D: фотореалистичная Земля'); }
  if (lighting && !TAKRAM) lighting.update(sky.sunDir, sky.sunLight.color, sky.sunLight.intensity);
  if (TAKRAM) {
    // облако в точке героя (по их карте погоды): туман навстречу и волна при входе; дождь — под плотным
    const inCloud = Math.min(1, Math.max(0, ((weather?.inside || 0) - 0.12) / 0.4));
    // Грозовой фронт над всем городом: локальные просветы в облаках не выключают дождь.
    const rain = Math.min(1, Math.max(0, (2200 - (c.alt - gh)) / 600));
    clouds.effects(t, c.vel, inCloud, rain, camera.position);
    const inNow = inCloud > 0.35;
    if (inNow && !wasInCloud && speed > 40) { fx.shock(0.25 + Math.min(0.6, speed / 600)); chase.kick(0.25); }
    wasInCloud = inNow;
  }
  trail.update(c, hero, camera, t, visualSpeed, res.rho, sky.sunDir, dt);
  sky.update(c.alt, t, back * 3, TAKRAM ? 0 : clouds.update(c, t, sky.sunDir, scene.fog));

  hud.frame(c, res.rho, speed);
  if (frame % 6 === 0) hud.stats(speed, nearest, nearestD, fps);

  if (started && placed) net.send({ ...c, speed, thrust: c.mode === 'fly' });

  const blurAmount = speedBlurAmount(visualSpeed);
  post.set(blurAmount, GRID ? 0 : c.boom * 0.5);
  takram?.setSpeedBlur(blurAmount);
  perf.renderStart();
  if (takram) takram.render(dt); else post.render();
  perf.begin('поверх');
  renderer.autoClear = false; renderer.render(overlay, camera); renderer.autoClear = true;
  recording.frame(now);
  perf.end();
  if (perf.on) {
    const ts = world.terrainStat || {}, above = c.alt - gh;
    perf.frameEnd({
      'высота над землёй': above,
      'камера near / far': `${camera.near.toFixed(2)} м / ${(camera.far / 1000).toFixed(0)} км`,
      'рельеф: край': ts.edge ?? 0,
      'рельеф: тайлов': `${ts.shown ?? 0} видно из ${ts.tiles ?? 0}, грузится ${ts.loading ?? 0}`,
      'дома подробно до': CITY_NEAR,
      'дома упрощённо до': CITY_FAR,
      'тени до': lighting ? lighting.csm.maxFar : 'выключены',
    });
  } else perf.frameEnd();
}

// ---------- старт ----------
$('go').addEventListener('click', async () => {
  const button = $('go'), status = $('start-status');
  if (button.disabled) return;
  button.disabled = true; button.textContent = 'ЗАГРУЗКА…';
  const name = ($('nick').value || '').trim().slice(0, 14) || `Герой${(Math.random() * 900 + 100) | 0}`;
  localStorage.setItem('skyfly-nick', name);
  audio.start();
  try {
    status.textContent = 'Проверяем ник и восстанавливаем место…';
    const saved = await net.join(name);
    resume ??= saved;
    if (resume) { Object.assign(c, resume); c.vel = [0, 0, 0]; }
    status.textContent = 'Загружаем героя и анимации…';
    await heroReady;
    status.textContent = 'Загружаем Москву и Санкт-Петербург…';
    const loaded = await Promise.all(['moscow', 'spb'].map(id => world.loadCity(id, import.meta.env.BASE_URL)));
    if (loaded.some(city => !city)) throw new Error('Город не загрузился. Нажми «Повторить».');
    started = true;
    if (resume && resume.mode !== 'ground') { placed = true; chase.snap(); }
    status.textContent = 'Готовим место появления…';
    await new Promise((resolve, reject) => {
      const end = performance.now() + 30000;
      const check = () => placed ? resolve() : performance.now() > end ? reject(new Error('Рельеф не загрузился. Нажми «Повторить».')) : requestAnimationFrame(check);
      check();
    });
    $('start').remove();
    if (resume) say('Вернулись на сохранённое место');
  } catch (error) {
    started = false; status.textContent = error.message;
    button.disabled = false; button.textContent = 'ПОВТОРИТЬ';
  }
});
// G / кнопка «Сетка» — без текстур ↔ снимки и фасады (перезагрузка с сохранением места)
const switchStyle = () => toggleStyle({ lat: c.lat, lon: c.lon, alt: c.alt, yaw: c.yaw, pitch: c.pitch, face: c.face,
  mode: c.mode, grounded: c.grounded, vel: [...c.vel], power: c.power });
$('b-style')?.addEventListener('click', switchStyle);
if (GRID) $('b-style')?.classList.add('on');
addEventListener('keydown', (ev) => { if (ev.code === 'KeyG' && !/INPUT|TEXTAREA|SELECT/.test(ev.target.tagName) && !editor?.open) switchStyle(); });
$('nick').value = localStorage.getItem('skyfly-nick') || '';
document.body.classList.toggle('mobile', MOBILE);

if (import.meta.env.DEV) {
  window.__fly = { c, p: c, keys, audio, say, scene, overlay, camera, lighting, get hero() { return hero; }, world, terrain: world.terrain, cities: world.cities, THREE };
}
requestAnimationFrame(loop);
