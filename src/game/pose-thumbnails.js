import * as THREE from 'three';

// Один маленький рендерер для видимых карточек. Не затрагивает позу и камеру студии.
export function createPoseThumbnails(hero, container) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(1); renderer.setSize(128, 88); renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x15232e);
  scene.add(new THREE.HemisphereLight(0xd4eeff, 0x6e7883, 2.6));
  const light = new THREE.DirectionalLight(0xffffff, 3); light.position.set(3, 5, -4); scene.add(light);
  const model = hero.userData.createPreview(); scene.add(model);
  const camera = new THREE.PerspectiveCamera(38, 128 / 88, .01, 100);
  const cache = new WeakMap(), requests = new WeakMap();
  let pending = [], task = null;
  function draw() {
    task = null;
    const image = pending.shift(), request = image && requests.get(image);
    if (image?.isConnected && request) {
      const { pose, state } = request;
      let variants = cache.get(pose);
      if (!variants) { variants = new Map(); cache.set(pose, variants); }
      if (!variants.has(state)) {
        model.userData.setSetup({ clips: { [state]: 'custom:preview' }, animations: {
          preview: { duration: 1, frames: [{ time: 0, pose }], loop: false },
        }, poses: {}, speed: {} });
        model.userData.preview(state, 0);
        const box = new THREE.Box3().setFromPoints([...model.userData.bones.values()].filter(b => b.name !== 'root').map(b => b.getWorldPosition(new THREE.Vector3())));
        const sphere = box.getBoundingSphere(new THREE.Sphere());
        // Смещение тела остаётся видимым относительно исходного центра.
        const offset = new THREE.Vector3(...(pose.offset || [0, 0, 0]));
        sphere.center.sub(offset);
        const distance = Math.max(2.3, (sphere.radius + Math.max(0, offset.length() - .15)) / Math.sin(THREE.MathUtils.degToRad(19)) * 1.2);
        camera.position.copy(sphere.center).addScaledVector(new THREE.Vector3(.65, .12, -1).normalize(), distance);
        camera.lookAt(sphere.center); renderer.render(scene, camera);
        variants.set(state, renderer.domElement.toDataURL('image/png'));
      }
      image.src = variants.get(state);
    }
    if (pending.length) task = requestAnimationFrame(draw);
  }
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) if (entry.isIntersecting) {
      observer.unobserve(entry.target); pending.push(entry.target);
    }
    if (pending.length && task === null) task = requestAnimationFrame(draw);
  }, { root: container, rootMargin: '0px 160px' });
  return {
    reset() { observer.disconnect(); pending = []; if (task !== null) cancelAnimationFrame(task); task = null; },
    observe(image, state, pose) {
      const cached = cache.get(pose)?.get(state);
      if (cached) image.src = cached;
      else { requests.set(image, { state, pose }); observer.observe(image); }
    },
    dispose() {
      this.reset(); model.userData.disposeAnimation(); model.traverse(o => { if (o.isMesh) o.material.dispose(); }); renderer.dispose();
    },
  };
}
