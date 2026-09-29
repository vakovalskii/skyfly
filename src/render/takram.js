// ФИЗИЧЕСКАЯ АТМОСФЕРА И ОБЪЁМНЫЕ ОБЛАКА — библиотеки takram (MIT):
//   @takram/three-atmosphere — рассеяние Брюнетона: небо, солнце, дымка по толще воздуха,
//                              светящийся край атмосферы и чёрное небо из космоса;
//   @takram/three-clouds     — рэймарчинг облаков в слоях над эллипсоидом Земли, с тенями и
//                              пролётом сквозь них.
// Обе работают в координатах от центра Земли (ECEF). Наша сцена — локальная: герой в нуле,
// X — восток, Y — вверх, Z — юг. Каждый кадр строим матрицу «сцена → ECEF» по lat/lon/alt героя.
// Режим по умолчанию; ?sky=old возвращает прежнее небо для сравнения и слабых устройств.
import * as THREE from 'three';
import { EffectComposer, RenderPass, EffectPass, ToneMappingEffect, ToneMappingMode, BloomEffect, Effect, EffectAttribute, SMAAEffect, SMAAPreset } from 'postprocessing';
import { createCarve } from './carve.js';
import { createSpeedBlurEffect } from './speed-blur.js';
import { createCityFog } from './city-fog.js';
import { AerialPerspectiveEffect, PrecomputedTexturesGenerator, PrecomputedTexturesLoader, getSunDirectionECEF, getECIToECEFRotationMatrix, StarsGeometry, StarsMaterial, SunDirectionalLight, SkyLightProbe, AtmosphereParameters } from '@takram/three-atmosphere';
import { setWireGain } from './style.js';
import { GROUND_TONE, terrainOpts } from './terrain.js';
import { createGlobe } from './globe.js';
import { PHOTOREAL, createPhotoreal } from './photoreal.js';
import { CloudsEffect, CLOUD_SHAPE_TEXTURE_SIZE, CLOUD_SHAPE_DETAIL_TEXTURE_SIZE } from '@takram/three-clouds';
import { Ellipsoid, Geodetic, DataTextureLoader, parseUint8Array, STBNLoader } from '@takram/three-geospatial';

const Q = new URLSearchParams(location.search);
// Физическая атмосфера и объёмные облака — по умолчанию; ?sky=old — прежние небо и облака-листы (легче для слабых устройств)
export const TAKRAM = Q.get('sky') !== 'old';
const BLOOM = Q.get('bloom') === '1';
// Атмосфера отдаёт яркость в физических единицах: без экспозиции ~10 небо почти чёрное, день серый
const EXPOSURE = Number(Q.get('exp')) || 6;          // временно: свечение затемняло небо — выключено, пока разбираемся

// сцена (восток, вверх, юг) → ENU (восток, север, вверх)
const SCENE_TO_ENU = new THREE.Matrix4().set(
  1, 0, 0, 0,
  0, 0, -1, 0,
  0, 1, 0, 0,
  0, 0, 0, 1,
);
// Время суток: по умолчанию летний вечер над Москвой, 19:30 МСК.
// T — +1 час, Shift+T — −1 час (закат, рассвет, солнце у горизонта); в адресе ?time=20 — начальный час МСК.
let hourMSK = Q.has('time') && Number.isFinite(Number(Q.get('time'))) ? Number(Q.get('time')) : 19.5;
const sunTime = () => new Date(Date.UTC(2026, 5, 21, 0, 0, 0) + (hourMSK - 3) * 3_600_000);

// ---- облака в точке героя — повторяем на процессоре их карту погоды ----
// Шейдер takram: uv = кубосфера(ECEF) · repeat + offset → local_weather (r, g, b — три слоя),
// плотность слоя = remap(mix(w, 1, fw), 1 − coverage·h, 1 − coverage·h + fw), h — форма по высоте.
// Мелкий шум формы не учитываем: нам нужно «есть ли тут облако», а не каждый завиток.
function cubeSphereUv(x, y, z) {
  const l = Math.hypot(x, y, z), n = [x / l, y / l, z / l], f = n.map(Math.abs);
  let m;
  if (f[1] > f[0] && f[1] > f[2]) m = n[1] > 0 ? [-n[0], n[2]] : [n[0], n[2]];
  else if (f[0] > f[1] && f[0] > f[2]) m = n[0] > 0 ? [n[1], n[2]] : [-n[1], n[2]];
  else m = n[2] > 0 ? [n[0], n[1]] : [n[0], -n[1]];
  const m2 = [m[0] * m[0], m[1] * m[1]], q = -2 * m2[0] + 2 * m2[1] - 3;
  const u = Math.sqrt(Math.max(0, 1.5 + m2[0] - m2[1] - 0.5 * Math.sqrt(Math.max(0, -24 * m2[0] + q * q)))) * (m[0] > 0 ? 1 : -1);
  const v = Math.sqrt(6 / (3 - u * u)) * m[1];
  return [u * 0.5 + 0.5, v * 0.5 + 0.5];
}
const clamp01 = (x) => Math.min(1, Math.max(0, x));
function weatherSampler(url) {
  let data = null, W = 0, H = 0;
  const img = new Image();
  img.onload = () => {
    const cv = document.createElement('canvas'); cv.width = W = img.width; cv.height = H = img.height;
    const g = cv.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0);
    data = g.getImageData(0, 0, W, H).data;
  };
  img.src = url;
  // билинейная выборка с повтором; текстура в WebGL не перевёрнута по Y у TextureLoader (flipY = true)
  const tex = (u, v, ch) => {
    const x = (u - Math.floor(u)) * W - 0.5, y = (1 - (v - Math.floor(v))) * H - 0.5;
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const at = (i, j) => data[((((j % H) + H) % H) * W + (((i % W) + W) % W)) * 4 + ch] / 255;
    return (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) + (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy;
  };
  const channel = { r: 0, g: 1, b: 2, a: 3 };
  return (effect, ecef, alt) => {
    if (!data) return { inside: 0, above: 0 };
    const [u0, v0] = cubeSphereUv(ecef.x, ecef.y, ecef.z);
    const rep = effect.localWeatherRepeat, off = effect.localWeatherOffset;
    let inside = 0, above = 0;
    for (const L of effect.cloudLayers) {
      if (!L.height || L.channel === 'a') continue;
      const w = tex(u0 * rep.x + off.x, v0 * rep.y + off.y, channel[L.channel]) ** L.weatherExponent;
      const hf = clamp01((alt - L.altitude) / L.height);
      const xs = Math.max(-1, Math.min(1, hf ** L.shapeAlteringBias * 2 - 1));
      const factor = 1 - effect.coverage * (1 - xs * xs);
      const fw = L.coverageFilterWidth;
      const d = clamp01((w + (1 - w) * fw - factor) / fw) * (0.75 * hf + 0.25);
      if (alt > L.altitude && alt < L.altitude + L.height) inside = Math.max(inside, d);
      // для дождя: плотность слоя над головой (в середине слоя)
      if (alt < L.altitude && L.densityScale > 0.05) {
        const fm = 1 - effect.coverage;
        above = Math.max(above, clamp01((w + (1 - w) * fw - fm) / fw));
      }
    }
    return { inside, above };
  };
}

const loadRepeat = (url) => new THREE.TextureLoader().load(url, (t) => {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipMapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.colorSpace = THREE.NoColorSpace; t.needsUpdate = true;
});
const load3D = (url, size) => new DataTextureLoader(THREE.Data3DTexture, parseUint8Array, {
  width: size, height: size, depth: size, format: THREE.RedFormat,
  minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping, wrapR: THREE.RepeatWrapping, colorSpace: THREE.NoColorSpace,
}).load(url);

// Экспозиция до тон-маппинга (с ограничением: ×EXPOSURE переполнял HalfFloat у ярких краёв облаков →
// бесконечность → чёрные пятна и мерцающий квадрат после тон-маппинга). В postprocessing AgX не берёт renderer.toneMappingExposure —
// умножаем сами, иначе физическая яркость атмосферы даёт почти чёрное небо и серый день.
// ЛУЧИ СОЛНЦА (crepuscular rays, GPU Gems 3, гл. 13): от каждого пикселя идём к солнцу на экране и
// копим яркость только очень ярких точек (диск и ореол). Где солнце закрыто облаком, домом или
// героем — там тень, где просвет — луч. Работает по готовому кадру после облаков и атмосферы,
// поэтому облака takram (они не пишут глубину) перекрывают солнце честно — встроенный GodRaysEffect
// из postprocessing этого не умеет. uK — общая сила: солнце в кадре, над горизонтом, есть воздух.
class SunRaysEffect extends Effect {
  constructor(samples) {
    super('SunRaysEffect', `
uniform vec2 sunUV; uniform float uK, uExp, uAspect, uThr, uCap;
float ign(vec2 px) { return fract(52.9829189 * fract(dot(px, vec2(0.06711056, 0.00583715)))); }
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  if (uK <= 0.0) { outputColor = inputColor; return; }
  vec2 d = sunUV - uv;
  vec2 dd = vec2(d.x * uAspect, d.y);
  float fall = exp(-length(dd) * 2.0);
  if (fall < 0.03) { outputColor = inputColor; return; }   // далеко от солнца лучей не видно — не считаем
  vec2 st = d / float(${samples}) * 0.95;
  vec2 p = uv + st * ign(gl_FragCoord.xy);          // сдвиг начала шага: ровный шум вместо полос-ступенек
  vec3 acc = vec3(0.0); float w = 1.0;
  for (int i = 0; i < ${samples}; i++) {
    p += st;
    vec3 c = texture2D(inputBuffer, p).rgb * uExp;
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    acc += c / max(l, 1e-3) * min(uCap, max(0.0, l - uThr)) * w;   // только то, что ярче неба и облаков
    w *= 0.965;
  }
  outputColor = vec4(inputColor.rgb + acc / float(${samples}) * fall * uK / uExp, inputColor.a);
}`, { attributes: EffectAttribute.CONVOLUTION, uniforms: new Map([
      ['sunUV', new THREE.Uniform(new THREE.Vector2(0.5, 0.5))], ['uK', new THREE.Uniform(0)],
      ['uExp', new THREE.Uniform(1)], ['uAspect', new THREE.Uniform(1)], ['uThr', new THREE.Uniform(25)], ['uCap', new THREE.Uniform(60)]]) });   // только диск и край ореола
  }
}

class ExposureEffect extends Effect {
  constructor(value) {
    super('ExposureEffect', 'uniform float exposure;\nvoid mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) { vec3 c = inputColor.rgb * exposure; c = clamp(mix(c, vec3(0.0), vec3(isnan(c))), 0.0, 60000.0); outputColor = vec4(c, inputColor.a); }',
      { uniforms: new Map([['exposure', new THREE.Uniform(value)]]) });
  }
  get exposure() { return this.uniforms.get('exposure').value; }
  set exposure(v) { this.uniforms.get('exposure').value = v; }
}

export async function createTakram(renderer, scene, camera, base, mobile, onTime, lighting = null) {
  const dir = `${base}takram/`;
  const generator = new PrecomputedTexturesGenerator(renderer);
  // солнечный диск втрое крупнее настоящего (0.27°): на экране настоящий теряется
  const atmosphere = new AtmosphereParameters();
  atmosphere.sunAngularRadius *= 5;                     // диск крупнее настоящего (0.27° → 1.3°) — видно на экране
  atmosphere.groundAlbedo.copy(GROUND_TONE);            // планета того же цвета, что наш рельеф — без круга на стыке
  // Готовые таблицы рассеяния из пакета (9 МБ, public/takram/atm). Генератор в браузере давал
  // почти нулевое рассеяние — чёрное небо у земли при нормальном солнце; оставлен по ?atm=gen.
  const textures = Q.get('atm') === 'gen'
    ? await generator.update(atmosphere)
    : await new PrecomputedTexturesLoader().setType(renderer).loadAsync(`${dir}atm/`);

  const clouds = new CloudsEffect(camera, undefined, atmosphere);
  clouds.qualityPreset = mobile ? 'low' : 'medium';
  clouds.lightShafts = !mobile;                         // лучи сквозь просветы облаков (в пресете medium выключены)
  // City-wide low haze: nearby roofs stay legible, distant blocks dissolve into
  // evening light. Exponential height falloff keeps the upper sky clear.
  clouds.haze = true;
  clouds.hazeDensityScale = 3.2e-4;
  clouds.hazeExponent = 1 / 750;
  Object.assign(clouds, textures);
  clouds.localWeatherTexture = loadRepeat(`${dir}local_weather.png`);
  clouds.turbulenceTexture = loadRepeat(`${dir}turbulence.png`);
  clouds.shapeTexture = load3D(`${dir}shape.bin`, CLOUD_SHAPE_TEXTURE_SIZE);
  clouds.shapeDetailTexture = load3D(`${dir}shape_detail.bin`, CLOUD_SHAPE_DETAIL_TEXTURE_SIZE);
  clouds.stbnTexture = new STBNLoader().load(`${dir}stbn.bin`);
  clouds.localWeatherVelocity.set(0.0005, 0);           // облака медленно плывут
  clouds.skyLightScale *= 1.5;                          // чуть светлее: больше света неба и отражённого от земли
  clouds.groundBounceScale *= 1.6;
  const sampleWeather = weatherSampler(`${dir}local_weather.png`);
  // Облаков больше, и второй ярус тоже кучевой, объёмный (у takram там тонкие перистые на 7.5 км)
  clouds.coverage = Q.has('cover') ? Math.min(1, Math.max(0, Number(Q.get('cover')) || 0)) : 0.35;
  Object.assign(clouds.cloudLayers[2], {
    altitude: 3800, height: 1600, densityScale: 0.16, shapeAmount: 1, shapeDetailAmount: 1,
    weatherExponent: 1, shapeAlteringBias: 0.35, coverageFilterWidth: 0.6, shadow: true,
  });
  Object.assign(clouds.cloudLayers[3], {           // а перистые — выше и тоньше, как в жизни
    channel: 'b', altitude: 8500, height: 400, densityScale: 0.003, shapeAmount: 0.4, shapeDetailAmount: 0,
    weatherExponent: 1, shapeAlteringBias: 0.35, coverageFilterWidth: 0.5,
  });
  const carve = createCarve(clouds);
  const globe = createGlobe(scene, mobile);             // Земля со снимком — вид из космоса
  // Google 3D Tiles — если есть ключ (иначе наши рельеф и дома)
  const photo = PHOTOREAL ? createPhotoreal(scene, camera, renderer, { gain: 1 / EXPOSURE, mobile }) : null;
  terrainOpts.globe = true;

  // Свет сцены — из той же атмосферы и в тех же единицах: солнце через толщу воздуха
  // (тёплое у горизонта, белое днём) и рассеянный свет неба. Наши лампы в этом режиме выключены.
  const sunLight = new SunDirectionalLight({ transmittanceTexture: textures.transmittanceTexture }, atmosphere);
  // Ошибка takram 0.19: конструктор берёт irradianceTexture вместо transmittanceTexture — таблица не
  // доходила, свет солнца оставался белым 1.0 (без заката и ослабления у горизонта). Передаём сами.
  sunLight.transmittanceTexture = textures.transmittanceTexture;
  const skyLight = new SkyLightProbe({ irradianceTexture: textures.irradianceTexture }, atmosphere);
  // Зонд даёт только свет неба; отражённого от земли и соседних стен нет — стены в тени выходили
  // чёрно-синими. Вдвое ярче — теневая сторона ≈ 1/4 солнечной, как на фото города днём.
  skyLight.intensity *= 2;
  scene.add(sunLight, sunLight.target, skyLight);
  // с тенями (?shadows=0 — выключить) солнце светит лампами каскадов CSM, эта лампа только считает цвет
  if (lighting) sunLight.visible = false;
  setWireGain(1 / EXPOSURE);

  // звёзды: настоящий каталог, повёрнутый по звёздному времени; днём их гасит атмосфера сама
  let stars = null;
  fetch(`${dir}stars.bin`).then((r) => r.arrayBuffer()).then((buf) => {
    stars = new THREE.Points(new StarsGeometry(buf), new StarsMaterial({ ...textures }, atmosphere));
    stars.frustumCulled = false;
    scene.add(stars);
  }).catch((e) => console.warn('звёзды не загрузились', e));
  const starRot = new THREE.Matrix4();
  let frame = 0;

  const aerial = new AerialPerspectiveEffect(camera, {
    ...textures, correctGeometricError: true, sky: true, sun: true, moon: false,
  }, atmosphere);
  // облака отдают атмосфере оверлей и тени — связываем, как это делает их обёртка для React
  let orbital = false;
  const link = () => { aerial.overlay = orbital ? null : clouds.atmosphereOverlay; aerial.shadow = orbital ? null : clouds.atmosphereShadow; aerial.shadowLength = orbital ? null : clouds.atmosphereShadowLength; };
  clouds.events.addEventListener('change', link);
  link();

  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
  composer.addPass(new RenderPass(scene, camera));
  // Local volumetric integration becomes unstable at orbital distances. Render
  // the ellipsoid with atmospheric scattering there, and restore clouds on descent.
  const cloudPass = new EffectPass(camera, clouds);
  composer.addPass(cloudPass);
  composer.addPass(new EffectPass(camera, aerial));
  const rays = new SunRaysEffect(mobile ? 20 : 48);
  rays.uniforms.get('uExp').value = EXPOSURE;
  const raysPass = new EffectPass(camera, rays);        // лучи — отдельным проходом: им нужны соседние пиксели
  composer.addPass(raysPass);
  const speedBlur = createSpeedBlurEffect(mobile);
  const speedBlurPass = new EffectPass(camera, speedBlur);
  speedBlurPass.enabled = false;
  composer.addPass(speedBlurPass);
  // свечение до тон-маппинга: настоящий солнечный диск крошечный — без ореола его не замечаешь
  const bloom = BLOOM ? new BloomEffect({ luminanceThreshold: 1.2, luminanceSmoothing: 0.4, intensity: 1.4, mipmapBlur: true, radius: 0.7 }) : null;
  const exposure = new ExposureEffect(EXPOSURE);
  composer.addPass(new EffectPass(camera, exposure, ...(bloom ? [bloom] : []), new ToneMappingEffect({ mode: ToneMappingMode.AGX })));
  const cityFog = createCityFog(camera);
  const fogPass = new EffectPass(camera, cityFog);
  composer.addPass(fogPass);
  // Canvas antialiasing does not reach the offscreen atmosphere composer.
  composer.addPass(new EffectPass(camera, new SMAAEffect({ preset: mobile ? SMAAPreset.MEDIUM : SMAAPreset.HIGH })));
  renderer.toneMapping = THREE.NoToneMapping;           // тон-маппинг делает композер
  addEventListener('resize', () => composer.setSize(innerWidth, innerHeight));

  const ecef = new THREE.Vector3(), enu = new THREE.Matrix4(), toECEF = new THREE.Matrix4();
  const geo = new Geodetic(), sunECEF = new THREE.Vector3(), sunLocal = new THREE.Vector3(), inv = new THREE.Matrix4();
  const eciToEcef = new THREE.Matrix4(), shift = new THREE.Matrix4();
  const sunScr = new THREE.Vector3(), camDir = new THREE.Vector3();
  const setTime = () => { const d = sunTime(); getSunDirectionECEF(d, sunECEF); getECIToECEFRotationMatrix(d, eciToEcef); };
  setTime();
  addEventListener('keydown', (e) => {
    if (e.code !== 'KeyT' || e.target.tagName === 'INPUT') return;
    hourMSK = (hourMSK + (e.shiftKey ? -1 : 1) + 24) % 24;
    setTime();
    onTime?.(hourMSK);
  });

  // Облегчённый режим для слабых видеокарт: облака — пресет low в половинном разрешении (вчетверо
  // меньше пикселей самого дорогого прохода), без объёмных лучей сквозь облака и без экранных лучей.
  let lite = false;
  function setLite(on) {
    lite = !!on;
    clouds.qualityPreset = lite || mobile ? 'low' : 'medium';
    clouds.lightShafts = !lite && !mobile;             // пресет сбрасывает лучи — ставим после него
    clouds.resolutionScale = lite ? 0.5 : 1;
    raysPass.enabled = !lite;
  }
  return {
    clouds, aerial, renderer, composer, exposure, carve, rays, photo, cityFog, setLite,
    get lite() { return lite; },
    setSpeedBlur(amount) {
      speedBlur.uniforms.get('uAmt').value = amount;
      speedBlurPass.enabled = amount > .0001;
    },
    // c — персонаж; sunOut — сюда пишем направление солнца в осях сцены (для наших источников света);
    // here — { ground, roof }: наша земля под героем и есть ли там дом (для калибровки высоты Google)
    update(c, sunOut, here = null) {
      const inOrbit = c.alt > (orbital ? 80000 : 100000);
      if (inOrbit !== orbital) { orbital = inOrbit; cloudPass.enabled = !orbital; link(); }
      fogPass.enabled = c.alt < 30000;
      geo.set(THREE.MathUtils.degToRad(c.lon), THREE.MathUtils.degToRad(c.lat), c.alt).toECEF(ecef);
      Ellipsoid.WGS84.getEastNorthUpFrame(ecef, enu);
      toECEF.multiplyMatrices(enu, SCENE_TO_ENU);
      clouds.worldToECEFMatrix.copy(toECEF); aerial.worldToECEFMatrix.copy(toECEF);
      clouds.sunDirection.copy(sunECEF); aerial.sunDirection.copy(sunECEF);
      inv.copy(toECEF).invert();
      sunLocal.copy(sunECEF).transformDirection(inv);
      cityFog.setHeight(c.alt - (here?.ground ?? 0), sunLocal.y);
      {
        // солнце на экране: сила лучей гаснет за краем кадра, у горизонта снизу и без воздуха (космос)
        const sp = sunScr.copy(sunLocal).multiplyScalar(1000).add(camera.position).project(camera);
        const inFront = camera.getWorldDirection(camDir).dot(sunLocal) > 0;
        const edge = Math.max(Math.abs(sp.x), Math.abs(sp.y));
        const onScreen = inFront ? Math.min(1, Math.max(0, (1.6 - edge) / 0.6)) : 0;
        const air = Math.min(1, Math.max(0, (60_000 - c.alt) / 40_000));
        const u = rays.uniforms;
        u.get('sunUV').value.set(sp.x * 0.5 + 0.5, sp.y * 0.5 + 0.5);
        u.get('uAspect').value = camera.aspect;
        u.get('uK').value = 1.4 * onScreen * air * Math.min(1, Math.max(0, sunLocal.y * 8 + 0.3));
      }
      globe.update(inv, c.alt);
      if (photo) {
        photo.update(inv, performance.now() / 1000, here?.ground ?? 0, here?.roof ?? true, c.alt);
        if (photo.ready) globe.mesh.visible = false;          // Google покрывает всю планету сам
      }
      if (sunOut) sunOut.copy(sunLocal);
      if (stars) {
        // звёзды заданы в инерциальных осях: → ECEF → оси сцены (только поворот)
        starRot.extractRotation(inv).multiply(eciToEcef);
        stars.setRotationFromMatrix(starRot);
        stars.material.worldToECEFMatrix.copy(toECEF);
        stars.material.sunDirection.copy(sunECEF);
      }
      const cloudLocalDensity = carve.update(toECEF, performance.now() / 1000, c);
      sunLight.worldToECEFMatrix.copy(toECEF); sunLight.sunDirection.copy(sunECEF); sunLight.update();
      skyLight.worldToECEFMatrix.copy(toECEF); skyLight.sunDirection.copy(sunECEF);
      if ((frame = (frame + 1) % 10) === 0) skyLight.update();
      if (lighting) {
        // тени облаков на земле — та же карта погоды, та же точка отсчёта (ECEF + поправка высоты)
        const u = lighting.cloudU, corr = clouds.cloudsPass.currentMaterial.uniforms.altitudeCorrection?.value;
        u.uCloudOn.value = clouds.localWeatherTexture?.image ? 1 : 0;
        u.uWeather.value = clouds.localWeatherTexture;
        u.uW2E.value.copy(toECEF);
        if (corr) u.uW2E.value.premultiply(shift.makeTranslation(corr.x, corr.y, corr.z));
        u.uSunE.value.copy(sunECEF);
        u.uCloudRepeat.value.copy(clouds.localWeatherRepeat);
        u.uCloudOffset.value.copy(clouds.localWeatherOffset);
        u.uCloudCoverage.value = clouds.coverage;
        u.uCloudAlt.value = clouds.cloudLayers[0].altitude + clouds.cloudLayers[0].height * 0.5;
        lighting.update(sunLocal, sunLight.color, sunLight.intensity);
      }
      const weather = sampleWeather(clouds, ecef, c.alt);
      weather.inside *= cloudLocalDensity;
      return weather;
    },
    render(dt) { composer.render(dt); },

  };
}
