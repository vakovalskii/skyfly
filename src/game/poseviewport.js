import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { moveJoint } from '../render/pose-ik.js';
import { createFlightAura } from '../render/flight-aura.js';

export function createPoseViewport(host, hero, onEdit, onSelect) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x17232e);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 100);
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.prepend(renderer.domElement);
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.target.set(0, 0.95, 0);
  orbit.minDistance = 1; orbit.maxDistance = 60; orbit.enableDamping = true;
  scene.add(new THREE.HemisphereLight(0xd4eeff, 0x6e7883, 2.6));
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.position.set(3, 5, 4); scene.add(sun);
  const floor = new THREE.GridHelper(8, 32, 0x547585, 0x2c4253);
  scene.add(floor);
  const model = hero.userData.createPreview();
  scene.add(model);
  const aura = createFlightAura(scene);
  const skeleton = new THREE.SkeletonHelper(model);
  skeleton.material.depthTest = false; skeleton.material.transparent = true;
  skeleton.material.opacity = 0.8; skeleton.renderOrder = 5; scene.add(skeleton);
  const joints = new THREE.Group(); scene.add(joints);
  const dotGeometry = new THREE.SphereGeometry(0.032, 12, 8);
  const dotMaterial = new THREE.MeshBasicMaterial({ color: 0x97eef2, depthTest: false, depthWrite: false });
  const activeMaterial = new THREE.MeshBasicMaterial({ color: 0xffd76b, depthTest: false, depthWrite: false });
  for (const [name, b] of model.userData.bones) {
    if (/f_|thumb|toe/.test(name) || name === 'root') continue;
    const dot = new THREE.Mesh(dotGeometry, dotMaterial);
    dot.userData.bone = b; dot.userData.name = name; dot.renderOrder = 6;
    joints.add(dot);
  }
  const transform = new TransformControls(camera, renderer.domElement);
  transform.setMode('rotate'); transform.setSpace('local'); transform.setSize(1.1);
  scene.add(transform.getHelper());
  let editing = false, jointDrag = null, boneMode = 'rotate', wholeBody = false;
  transform.addEventListener('dragging-changed', (e) => { editing = e.value; orbit.enabled = !editing; onEdit(editing ? 'start' : 'end'); });
  transform.addEventListener('objectChange', () => { if (editing) onEdit('change'); });
  const ray = new THREE.Raycaster(), pointer = new THREE.Vector2();
  function setRay(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    ray.setFromCamera(pointer, camera);
  }
  const pick = (event) => {
    if (!joints.visible || editing || event.button !== 0) return;
    setRay(event);
    const hit = ray.intersectObjects(joints.children)[0];
    if (hit) {
      event.preventDefault(); event.stopImmediatePropagation();
      onSelect?.(hit.object.userData.name);
      onEdit('start'); editing = true; orbit.enabled = false;
      const origin = hit.object.userData.bone.getWorldPosition(new THREE.Vector3());
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), origin);
      const at = ray.ray.intersectPlane(plane, new THREE.Vector3()) || origin;
      jointDrag = { name: hit.object.userData.name, plane, offset: origin.clone().sub(at), id: event.pointerId };
      renderer.domElement.setPointerCapture(event.pointerId);
      renderer.domElement.style.cursor = 'grabbing';
    }
  };
  const move = (event) => {
    setRay(event);
    if (!jointDrag) {
      renderer.domElement.style.cursor = joints.visible && ray.intersectObjects(joints.children).length ? 'grab' : 'default';
      return;
    }
    event.preventDefault(); event.stopImmediatePropagation();
    const target = ray.ray.intersectPlane(jointDrag.plane, new THREE.Vector3());
    if (target) { moveJoint(model, jointDrag.name, target.add(jointDrag.offset)); onEdit('change'); }
  };
  const release = (event) => {
    if (!jointDrag) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (renderer.domElement.hasPointerCapture(jointDrag.id)) renderer.domElement.releasePointerCapture(jointDrag.id);
    jointDrag = null; editing = false; orbit.enabled = true;
    renderer.domElement.style.cursor = 'grab'; onEdit('end');
  };
  renderer.domElement.addEventListener('pointerdown', pick, true);
  renderer.domElement.addEventListener('pointermove', move, true);
  renderer.domElement.addEventListener('pointerup', release, true);
  renderer.domElement.addEventListener('pointercancel', release, true);
  const observer = new ResizeObserver(() => resize());
  observer.observe(host);
  function resize() {
    if (!host.clientWidth || !host.clientHeight) return;
    camera.aspect = host.clientWidth / host.clientHeight; camera.updateProjectionMatrix();
    renderer.setSize(host.clientWidth, host.clientHeight);
    fit();
  }
  let clipBounds = null;
  function fit(direction = camera.position.clone().sub(orbit.target).normalize()) {
    model.updateMatrixWorld(true);
    const box = clipBounds || new THREE.Box3().setFromPoints([...model.userData.bones.values()].filter(b => b.name !== 'root').map((b) => b.getWorldPosition(new THREE.Vector3())));
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const angle = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * Math.min(1, camera.aspect));
    const distance = Math.max(2, sphere.radius / Math.sin(angle) * 1.25);
    const damping = orbit.enableDamping; orbit.enableDamping = false; orbit.update();
    orbit.target.copy(sphere.center);
    camera.position.copy(sphere.center).addScaledVector(direction, distance);
    orbit.update(); orbit.enableDamping = damping;
  }
  function view(name = 'front') {
    fit(new THREE.Vector3(...(name === 'side' ? [1, 0.04, 0] : name === 'back' ? [0, 0.04, 1] : [0.04, 0.06, -1])).normalize());
  }
  function frameClip(state, time = 0) {
    if (editing) return;
    const setup = model.userData.getSetup(), name = setup.clips[state];
    const custom = name?.startsWith('custom:') ? setup.animations[name.slice(7)] : null;
    const duration = model.userData.getDuration(state);
    const times = custom ? custom.frames.flatMap((f, i, frames) => i ? [(frames[i - 1].time + f.time) / 2, f.time] : [f.time]) : Array.from({ length: 25 }, (_, i) => duration * i / 24);
    const box = new THREE.Box3(), point = new THREE.Vector3();
    try {
      for (const seconds of times) {
        model.userData.preview(state, seconds, false);
        for (const b of model.userData.bones.values()) if (b.name !== 'root') box.expandByPoint(b.getWorldPosition(point));
        const cape = model.getObjectByName('Superman cape');
        if (cape?.visible) {
          cape.geometry.computeBoundingBox();
          box.union(cape.geometry.boundingBox.clone().applyMatrix4(cape.matrixWorld));
        }
      }
      if (!box.isEmpty() && state === 'hover') box.min.y -= .65; // Include the mist below pointed toes.
      clipBounds = box.isEmpty() ? null : box;
    } finally { model.userData.preview(state, time, false); }
    fit();
  }
  view(); resize();
  return {
    model, camera, view, resize, fit, frameClip,
    get editing() { return editing; },
    get modeValue() { return transform.mode; },
    bone(name, editable) {
      wholeBody = name === '__body__';
      const b = wholeBody ? model.userData.body : model.userData.bones.get(name);
      transform.setMode(wholeBody ? 'translate' : boneMode);
      transform.setSpace(wholeBody ? 'world' : 'local');
      if (b && editable) transform.attach(b); else transform.detach();
      for (const dot of joints.children) dot.material = dot.userData.name === name ? activeMaterial : dotMaterial;
    },
    mode(value) { boneMode = value; transform.setMode(wholeBody ? 'translate' : value); },
    skeleton(value) { skeleton.visible = joints.visible = value; },
    render() {
      model.updateMatrixWorld(true);
      for (const dot of joints.children) {
        dot.userData.bone.getWorldPosition(dot.position);
        dot.scale.setScalar(Math.max(0.6, camera.position.distanceTo(dot.position) / 4));
      }
      orbit.update(); aura.update(model, camera, renderer.domElement.height); renderer.render(scene, camera);
    },
    dispose() {
      observer.disconnect(); transform.dispose(); orbit.dispose();
      renderer.domElement.removeEventListener('pointerdown', pick, true);
      renderer.domElement.removeEventListener('pointermove', move, true);
      renderer.domElement.removeEventListener('pointerup', release, true);
      renderer.domElement.removeEventListener('pointercancel', release, true);
      dotGeometry.dispose(); dotMaterial.dispose(); activeMaterial.dispose();
      model.userData.disposeAnimation();
      aura.dispose();
      // Geometry/текстуры GLB общие с игрой, освобождаем только собственные ресурсы окна.
      model.traverse((o) => { if (o.isMesh) o.material.dispose(); });
      floor.geometry.dispose(); floor.material.dispose(); skeleton.geometry.dispose(); skeleton.material.dispose();
      renderer.dispose(); renderer.domElement.remove();
    },
  };
}
