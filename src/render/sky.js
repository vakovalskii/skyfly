// Небо, Земля и атмосфера. С земли — обычный голубой купол, на высоте он темнеет,
// из космоса видно шар с подсветкой лимба. Всё на шейдерах, без текстур — чтобы грузилось мгновенно.
import * as THREE from 'three';
import { R } from '../core/grid.js';

const V = `varying vec3 vDir; varying vec3 vPos;
void main(){ vPos = position; vDir = normalize(mat3(modelMatrix) * position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;

// Купол неба по высоте игрока. Над головой — столько синевы, сколько воздуха ещё выше нас
// (column ≈ e^(−h/7 км)): у земли голубое, в стратосфере тёмно-синее, к 50 км чёрное.
// Горизонт опускается ниже линии взгляда на угол dip = acos(R/(R+h)), над ним — светящаяся
// полоса атмосферы: у земли широкая белёсая дымка, наверху тонкая голубая линия лимба.
// Звёзды проступают, когда синевы над головой почти не осталось (~18–35 км).
const SKY = `
precision highp float;
varying vec3 vDir;
uniform vec3 uSun; uniform float uAlt; uniform float uTime;
float hash(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }
void main(){
  vec3 d = normalize(vDir);
  float h = max(uAlt, 0.0);
  float column = exp(-h / 7000.0);                  // доля атмосферы над нами
  float air = exp(-h / 8500.0);                     // плотность воздуха вокруг
  float dip = acos(clamp(6371000.0 / (6371000.0 + h), 0.0, 1.0));
  float el = asin(clamp(d.y, -1.0, 1.0)) + dip;     // угол над настоящим горизонтом
  vec3 zenith = mix(vec3(0.004, 0.006, 0.018), vec3(0.09, 0.27, 0.62), pow(column, 0.55));
  vec3 haze = mix(vec3(0.36, 0.60, 1.00), vec3(0.76, 0.84, 0.93), air);
  float width = mix(0.035, 0.42, pow(column, 0.5));  // ширина светлой полосы у горизонта, рад
  float band = exp(-max(el, 0.0) / width);
  vec3 col = mix(zenith, haze, band);
  if (el < 0.0) col = haze * mix(0.35, 0.85, air);  // ниже горизонта — дымка над землёй
  float sun = max(dot(d, normalize(uSun)), 0.0);
  col += vec3(1.0,0.85,0.6) * pow(sun, 380.0) * 6.0;                        // само Солнце
  col += vec3(1.0,0.72,0.45) * pow(sun, 8.0) * 0.22 * pow(column, 0.4);     // ореол — пока есть воздух
  float stars = smoothstep(0.08, 0.006, column) * smoothstep(-0.02, 0.05, el);
  if (stars > 0.0) {
    vec3 g = floor(d*260.0);
    float s = hash(g);
    col += vec3(smoothstep(0.9965, 1.0, s) * stars) * (0.6 + 0.4*sin(uTime*2.0 + s*40.0));
  }
  gl_FragColor = vec4(col, 1.0);
}`;

// Шар Земли под ногами: видно, когда поднялся высоко.
const GLOBE = `
precision highp float;
varying vec3 vDir; varying vec3 vPos;
uniform vec3 uSun; uniform float uAlt;
float n2(vec2 p){ return fract(sin(dot(p, vec2(41.3,289.1)))*43758.5453); }
float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v += a*n2(floor(p)); p*=2.03; a*=0.5; } return v; }
void main(){
  vec3 n = normalize(vPos);
  float lat = asin(clamp(n.y,-1.0,1.0));
  // грубая суша: пятна шума + светлые полярные шапки
  float land = smoothstep(0.52, 0.58, fbm(vec2(atan(n.z,n.x)*3.4, lat*4.2)*3.0));
  float ice = smoothstep(1.05, 1.28, abs(lat)*1.9);
  vec3 sea = vec3(0.04,0.10,0.22), soil = vec3(0.16,0.22,0.12), snow = vec3(0.88,0.92,0.96);
  vec3 base = mix(sea, soil, land);
  base = mix(base, snow, ice);
  float lit = max(dot(n, normalize(uSun)), 0.0);
  vec3 col = base * (0.06 + 1.15*lit);
  // облака
  float cl = smoothstep(0.55,0.75, fbm(vec2(atan(n.z,n.x)*5.0, lat*6.0)*6.0));
  col = mix(col, vec3(0.9,0.93,0.97)*(0.1+lit), cl*0.45);
  gl_FragColor = vec4(col, 1.0);
}`;

// Светящийся ободок атмосферы вокруг планеты (рисуем изнутри сферы побольше).
const RIM = `
precision highp float;
varying vec3 vDir; varying vec3 vPos;
uniform vec3 uSun; uniform vec3 uCam;
void main(){
  vec3 n = normalize(vPos);
  vec3 v = normalize(uCam - vPos);
  float edge = pow(1.0 - abs(dot(n, v)), 2.6);
  float lit = max(dot(n, normalize(uSun)), 0.0);
  vec3 col = mix(vec3(0.25,0.45,0.95), vec3(0.85,0.55,0.35), pow(1.0-lit, 4.0));
  gl_FragColor = vec4(col, edge * (0.15 + 0.85*lit) * 0.9);
}`;

// Цвет и плотность воздушной дымки для обычных материалов (scene.fog) — то же, что полоса неба
// у горизонта, чтобы дальние дома и рельеф растворялись в небе без шва.
const hazeColor = (alt, out) => {
  const air = Math.exp(-Math.max(0, alt) / 8500);
  return out.setRGB(0.36 + (0.76 - 0.36) * air, 0.60 + (0.84 - 0.60) * air, 1.0 + (0.93 - 1.0) * air, THREE.SRGBColorSpace);
};

export function createSky(scene, mobile) {
  scene.fog = new THREE.FogExp2(0xc2d6ee, 1 / 30_000);
  const fogBase = new THREE.Color(), cloudWhite = new THREE.Color(0xe8edf3);
  let off = false;
  const uSun = { value: new THREE.Vector3(0.45, 0.78, 0.35).normalize() };
  const uAlt = { value: 2 };
  const uTime = { value: 0 };
  const uCam = { value: new THREE.Vector3() };

  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1, mobile ? 24 : 40, mobile ? 16 : 24),
    new THREE.ShaderMaterial({ vertexShader: V, fragmentShader: SKY, uniforms: { uSun, uAlt, uTime }, side: THREE.BackSide, depthWrite: false, depthTest: false }),
  );
  dome.renderOrder = -100; dome.frustumCulled = false;
  scene.add(dome);

  // Земля как шар: центр всегда под игроком на глубине R + высота
  const globe = new THREE.Mesh(
    new THREE.SphereGeometry(R, mobile ? 48 : 96, mobile ? 32 : 64),
    new THREE.ShaderMaterial({ vertexShader: V, fragmentShader: GLOBE, uniforms: { uSun, uAlt } }),
  );
  globe.frustumCulled = false;
  scene.add(globe);

  const rim = new THREE.Mesh(
    new THREE.SphereGeometry(R * 1.018, mobile ? 40 : 72, mobile ? 24 : 48),
    new THREE.ShaderMaterial({ vertexShader: V, fragmentShader: RIM, uniforms: { uSun, uCam }, side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  rim.frustumCulled = false;
  scene.add(rim);

  const sun = new THREE.DirectionalLight(0xfff4e2, 2.8);
  const hemi = new THREE.HemisphereLight(0xa8c8ff, 0x4a4a40, 1.35);   // город не должен тонуть в тени
  scene.add(sun, hemi);

  return {
    // inCloud 0..1 — насколько игрок внутри облака: белая мгла на несколько десятков метров
    // физическая атмосфера (takram) рисует небо и дымку сама — наши купол, шар и туман выключаем
    disable() { off = true; dome.visible = globe.visible = rim.visible = false; scene.fog = null; sun.visible = hemi.visible = false; },
    update(alt, t, camDist, inCloud = 0) {
      uAlt.value = alt; uTime.value = t;
      sun.position.copy(uSun.value).multiplyScalar(1000);
      if (off) return;
      hazeColor(alt, fogBase);
      scene.fog.color.copy(fogBase).lerp(cloudWhite, inCloud);
      // видимость у земли ~30 км, сверху сквозь тонкий воздух — дальше; в облаке — 60–150 м
      // Дымка — это толща воздуха на пути взгляда. Сверху вниз её не больше столба атмосферы
      // (~8.5 км воздуха у земли), поэтому плотность «на метр пути» падает как 8.5 км / высота:
      // из стратосферы земля видна почти чётко, а не тонет в белой пелене.
      const clear = (1 / 30_000) * Math.min(1, 8500 / Math.max(1, alt));
      scene.fog.density = clear + (1 / 90 - clear) * inCloud * inCloud;
      dome.scale.setScalar(Math.max(4000, camDist * 0.9));
      globe.position.set(0, -(R + alt), 0);
      rim.position.copy(globe.position);
      uCam.value.set(0, 0, 0);
      sun.position.copy(uSun.value).multiplyScalar(1000);
      // ниже 12 км глобус только мешает (он плоский под нами) — прячем
      const far = alt > 9000;
      globe.visible = far; rim.visible = far;
    },
    sunDir: uSun.value,
    sunLight: sun,                     // с каскадными тенями светят их лампы, эта только задаёт цвет
  };
}
