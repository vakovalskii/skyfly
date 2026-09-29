// Герой: модель со скелетом (Quaternius, CC-BY — см. public/models/LICENSES.md).
// Что играет в каком состоянии — берётся из настройки (render/flypose.js), которую правит
// редактор поз (клавиша P). Поверх клипа накладываются повороты костей: так делается поза полёта,
// которой в наборе анимаций нет.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { attachAnimationPlayer } from './animation-player.js';
import { applyHeroSuit } from './hero-suit.js';
import { attachHeroCape } from './hero-cape.js';
import { normalizeSetup } from './flypose.js';

const MODEL = 'models/hero-base.glb';

export async function loadHero(base = '') {
  const gltf = await new GLTFLoader().loadAsync(base + MODEL);
  try {
    const response = await fetch(base + 'animations/quaternius-ual2.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const library = await response.json();
    gltf.animations.push(...library.clips.map(clip => THREE.AnimationClip.parse(clip)));
  } catch (error) {
    // An unavailable optional pack must never make the character disappear.
    console.warn('Дополнительные анимации не загрузились:', error);
  }
  // Published poses must load without the dev-only studio or browser storage.
  let project = null;
  if (import.meta.env.PROD) {
    try {
      const response = await fetch(base + 'data/animations.json', { cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      project = normalizeSetup(await response.json());
    } catch (error) {
      console.warn('Анимации проекта не загрузились, используются встроенные:', error);
    }
  }
  const factory = () => {
    const instance = makeInstance(gltf);
    if (project) instance.userData.setSetup(project);
    return instance;
  };
  factory.animations = gltf.animations.map((a) => a.name.replace(/^.*\|/, ''));
  return factory;
}

function makeInstance(gltf) {
  const root = new THREE.Group();
  const model = cloneSkeleton(gltf.scene);

  // рост 1.75 м, ноги в нуле, лицом в −Z
  // После клонирования скелета сначала обновляем матрицы и границы кожи.
  // Иначе Box3 измеряет устаревшие bone matrices и уменьшает героя в десятки раз.
  model.updateMatrixWorld(true);
  model.traverse((o) => {
    if (o.isSkinnedMesh) { o.skeleton.update(); o.computeBoundingBox(); }
  });
  const box = new THREE.Box3().setFromObject(model);
  const k = 1.75 / Math.max(0.001, box.max.y - box.min.y);
  model.scale.setScalar(k);
  model.position.y = -box.min.y * k;
  // модель в GLB смотрит в +Z; наш поворот идёт в системе (восток, север), поэтому доворот не нужен —
  // разворот на 180° делал вид «спереди» вместо «со спины»
  model.rotation.y = 0;
  const pivot = new THREE.Group();
  pivot.add(model);
  root.add(pivot);

  model.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    o.frustumCulled = false;
    o.material = o.material.clone();
    applyHeroSuit(o);
  });

  const bones = new Map();
  model.traverse((o) => { if (o.isBone) bones.set(o.name, o); });

  attachAnimationPlayer(root, model, pivot, gltf.animations, bones);
  attachHeroCape(root, bones);
  root.userData.createPreview = () => makeInstance(gltf);
  return root;
}
