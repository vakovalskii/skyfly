import * as THREE from 'three';
import { createCapeCloth } from './cape-cloth.js';

// Deterministic cloth silhouette for scrubbing; runtime adds inertia to the trailing direction.
// The collar follows the shoulders. This is procedural cloth, not a rigid bone animation.
export function attachHeroCape(root, bones) {
  const attachment = bones.get('DEF-spine003');
  // Three real skin vertices form the collar. Offsetting the whole cape made it float.
  const anchors = [-.17, 0, .17].map(x => {
    let best = null, score = Infinity;
    root.traverse(o => {
      if (!o.isSkinnedMesh || !/woven/.test(o.material.name)) return;
      const a = o.geometry.attributes.position;
      for (let i = 0; i < a.count; i++) {
        const px = a.getX(i) * 100, py = a.getY(i) * 100, pz = a.getZ(i) * 100;
        if (py < .02) continue;
        const distance = Math.abs(px - x) * 2 + Math.abs(pz - (x === 0 ? 1.48 : 1.44)) * 2 - py * .35;
        if (distance < score) { score = distance; best = { mesh: o, index: i, point: new THREE.Vector3() }; }
      }
    });
    if (best) {
      best.mesh.skeleton.update(); best.mesh.getVertexPosition(best.index, best.point);
      best.mesh.localToWorld(best.point);
      best.local = attachment.worldToLocal(best.point.clone());
      // Entire collar follows ONE chest bone, independently of either arm.
      best.lower = attachment.worldToLocal(best.point.clone().add(new THREE.Vector3(0, -.11, 0)));
      best.bottom = new THREE.Vector3();
    }
    return best;
  });
  if (anchors.every(Boolean)) {
    // A rigid, slightly raised collar plate covers the upper back without a hole
    // where weighted shoulder surfaces bulge past the line between anchor vertices.
    const backPlane = Math.max(...anchors.map(a => a.point.z)) + .045;
    for (const a of anchors) {
      a.local.copy(attachment.worldToLocal(new THREE.Vector3(a.point.x, a.point.y, backPlane)));
      a.lower.copy(attachment.worldToLocal(new THREE.Vector3(a.point.x, a.point.y - .11, backPlane)));
    }
  }
  const columns = 24, rows = 36, geometry = new THREE.PlaneGeometry(1, 1, columns, rows);
  const cloth = createCapeCloth(columns, rows);
  const targets = new Float32Array(geometry.attributes.position.array.length);
  const material = new THREE.MeshPhysicalMaterial({ color: 0xa31329, roughness: .8, metalness: 0,
    side: THREE.DoubleSide, sheen: .65, sheenColor: new THREE.Color(0x751529), sheenRoughness: .8 });
  const mesh = new THREE.Mesh(geometry, material); mesh.name = 'Superman cape'; mesh.frustumCulled = false;
  root.add(mesh);
  const left = new THREE.Vector3(), right = new THREE.Vector3(), head = new THREE.Vector3(), hips = new THREE.Vector3();
  const up = new THREE.Vector3(), width = new THREE.Vector3(), back = new THREE.Vector3(), center = new THREE.Vector3();
  const direction = new THREE.Vector3(0, -1, 0), target = new THREE.Vector3(), down = new THREE.Vector3(0, -1, 0), p = new THREE.Vector3();
  const axis = new THREE.Vector3(), relative = new THREE.Vector3();
  const collar = new THREE.Vector3(), drape = new THREE.Vector3();
  const airflowDirection = new THREE.Vector3(), rootRotation = new THREE.Quaternion();
  const legs = ['L', 'R'].flatMap(side => [
    { from: `DEF-thigh${side}`, to: `DEF-shin${side}`, radius: .12 },
    { from: `DEF-shin${side}`, to: `DEF-foot${side}`, radius: .095 },
    { from: `DEF-foot${side}`, to: `DEF-toe${side}`, radius: .085 },
  ]).map(leg => ({ ...leg, a: new THREE.Vector3(), b: new THREE.Vector3() }));
  const legAxis = new THREE.Vector3(), legPoint = new THREE.Vector3();
  let initialized = false, amount = .3, phase = 0;
  const point = (name, out) => root.worldToLocal(bones.get(name).getWorldPosition(out));
  root.userData.updateCape = ({ state, time, speed, velocity, dt = 0, preview = false }) => {
    const setup = root.userData.getSetup(), settings = setup.cape;
    mesh.visible = settings?.enabled !== false;
    if (!mesh.visible) return;
    point('DEF-upper_armL', left); point('DEF-upper_armR', right); point('DEF-head', head); point('DEF-hips', hips);
    for (const leg of legs) { point(leg.from, leg.a); point(leg.to, leg.b); }
    up.copy(head).sub(hips).normalize(); width.copy(right).sub(left).normalize(); back.crossVectors(width, up).normalize();
    for (const anchor of anchors) if (anchor) {
      root.worldToLocal(attachment.localToWorld(anchor.point.copy(anchor.local)));
      root.worldToLocal(attachment.localToWorld(anchor.bottom.copy(anchor.lower)));
    }
    // Bind-space X is reversed by the imported rig. Keep columns ordered along
    // the same axis used to widen the hem, otherwise the rows cross into a knot.
    if (anchors.every(Boolean) && relative.copy(anchors[2].point).sub(anchors[0].point).dot(width) < 0) anchors.reverse();
    // The first free section follows the collar's chest axis, then yields to gravity.
    // A vertical sheet from a leaning collar would cut straight through the shoulders.
    if (anchors.every(Boolean)) drape.copy(anchors[1].bottom).sub(anchors[1].point).normalize();
    else drape.copy(up).negate();
    // Bone L/R labels on this rig put the back at +Z while standing.
    center.copy(left).lerp(right, .5).addScaledVector(up, .045);
    const flying = ['fly', 'boost', 'booststart', 'flystart', 'jumpfly', 'slamdive'].includes(state);
    const airflow = flying ? .95 : state === 'flystop' ? .45 : .08;
    target.copy(up).multiplyScalar(-airflow).addScaledVector(down, 1 - airflow).normalize();
    if (state === 'air' || state === 'jump') {
      airflowDirection.set(...(velocity || (state === 'air' ? [0, -45, 0] : [0, 15, 0])));
      const airSpeed = airflowDirection.length();
      if (airSpeed > 1) {
        airflowDirection.negate().normalize().applyQuaternion(root.getWorldQuaternion(rootRotation).invert());
        target.lerp(airflowDirection, THREE.MathUtils.smoothstep(airSpeed, 3, 45) * .96).normalize();
      }
    }
    const gait = state === 'run' ? .85 : state === 'walk' ? .3 : 0;
    if (gait) target.addScaledVector(back, gait + Math.min(.35, (speed ?? (state === 'run' ? 9 : 3)) / 40)).normalize();
    const strength = settings?.strengths?.[state] ?? (state === 'boost' ? 1.25 : flying ? .8 : state === 'run' ? .65 : state === 'walk' ? .35 : state === 'hover' ? .4 : .22);
    if (preview || !initialized) { direction.copy(target); amount = strength; initialized = true; }
    else { direction.lerp(target, 1 - Math.exp(-dt * (state === 'slamhit' ? 3 : 6))).normalize(); amount += (strength - amount) * (1 - Math.exp(-dt * 5)); }
    const nominalSpeed = state === 'boost' || state === 'slamdive' ? 600 : flying ? 180 : 0;
    const frequency = 3 + amount * 4 + Math.min(1, (speed ?? nominalSpeed) / 400) * 7;
    if (preview) phase = time * frequency; else phase += dt * frequency;
    const topWidth = left.distanceTo(right) * .87;
    const torsoLength = center.distanceTo(hips);
    for (let row = 0; row <= rows; row++) {
      const s = row / rows, free = Math.max(0, (s - .1) / .9), span = topWidth + free * .48;
      for (let col = 0; col <= columns; col++) {
        const u = col / columns * 2 - 1, flutter = Math.sin(phase - free * 10 + u * 2.5);
        const folds = Math.cos(u * Math.PI * 4 + s * 1.5 + Math.sin(phase * .45 - free * 3) * free * .6) * .032 * (.25 + s);
        if (anchors.every(Boolean)) {
          const a = u < 0 ? anchors[0].bottom : anchors[1].bottom, b = u < 0 ? anchors[1].bottom : anchors[2].bottom;
          collar.copy(a).lerp(b, u < 0 ? u + 1 : u);
          if (s < .1) {
            p.copy(u < 0 ? anchors[0].point : anchors[1].point).lerp(u < 0 ? anchors[1].point : anchors[2].point, u < 0 ? u + 1 : u);
            p.lerp(collar, s / .1);
            geometry.attributes.position.setXYZ(row * (columns + 1) + col, p.x, p.y, p.z);
            continue;
          }
        } else collar.copy(center).addScaledVector(width, u * topWidth * .5).addScaledVector(back, .12);
        // Preserve the collar, widening only the free hem.
        p.copy(collar).addScaledVector(width, u * (span - topWidth) * .5)
          .addScaledVector(direction, free * 1.22)
          .addScaledVector(relative.copy(drape).sub(direction), .23 * (1 - Math.exp(-free * 1.22 / .23)))
          .addScaledVector(back, free * .24 + folds * free + flutter * amount * .115 * free * free);
        p.addScaledVector(width, Math.sin(phase * .6 - free * 7) * amount * .025 * free * free);
        // Keep the cloth behind an elliptical torso envelope, including a bent back.
        relative.copy(p).sub(hips);
        const along = relative.dot(up), across = relative.dot(width);
        if (along > -.16 && along < torsoLength + .08 && Math.abs(across) < .25) {
          axis.copy(hips).addScaledVector(up, THREE.MathUtils.clamp(along, 0, torsoLength));
          const gap = relative.copy(p).sub(axis).dot(back);
          const clearance = .02 + .15 * Math.sqrt(Math.max(0, 1 - (across / .25) ** 2));
          const edge = THREE.MathUtils.smoothstep(along, -.16, .02) * (1 - THREE.MathUtils.smoothstep(along, torsoLength, torsoLength + .08));
          if (gap < clearance) p.addScaledVector(back, (clearance - gap) * THREE.MathUtils.smoothstep(free, 0, .16) * edge);
        }
        // Ground collision in the hero's foot-based coordinates.
        p.y = Math.max(.045, p.y);
        geometry.attributes.position.setXYZ(row * (columns + 1) + col, p.x, p.y, p.z);
      }
    }
    targets.set(geometry.attributes.position.array);
    const simulated = cloth.update(targets, dt, preview);
    for (let row = 0; row <= rows; row++) for (let col = 0; col <= columns; col++) {
      const index = row * (columns + 1) + col;
      p.fromArray(simulated, index * 3);
      if (row / rows > .1) {
        // Project behind real leg capsules after simulation, so a returning foot
        // cannot pass through the lagging cloth on the next step.
        for (const leg of legs) {
          legAxis.copy(leg.b).sub(leg.a);
          const t = THREE.MathUtils.clamp(relative.copy(p).sub(leg.a).dot(legAxis) / Math.max(1e-8, legAxis.lengthSq()), 0, 1);
          legPoint.copy(leg.a).addScaledVector(legAxis, t); relative.copy(p).sub(legPoint);
          if (relative.lengthSq() < leg.radius ** 2) p.addScaledVector(back, leg.radius - relative.dot(back));
        }
        // The lagging sheet must obey the torso envelope too.
        relative.copy(p).sub(hips);
        const along = relative.dot(up), across = relative.dot(width);
        if (along > -.16 && along < torsoLength + .08 && Math.abs(across) < .25) {
          axis.copy(hips).addScaledVector(up, THREE.MathUtils.clamp(along, 0, torsoLength));
          const gap = relative.copy(p).sub(axis).dot(back), clearance = .02 + .15 * Math.sqrt(Math.max(0, 1 - (across / .25) ** 2));
          const edge = THREE.MathUtils.smoothstep(along, -.16, .02) * (1 - THREE.MathUtils.smoothstep(along, torsoLength, torsoLength + .08));
          if (gap < clearance) p.addScaledVector(back, (clearance - gap) * THREE.MathUtils.smoothstep(row / rows - .1, 0, .144) * edge);
        }
        p.y = Math.max(.045, p.y);
      }
      cloth.correct(index * 3, p.x, p.y, p.z);
      geometry.attributes.position.setXYZ(index, p.x, p.y, p.z);
    }
    geometry.attributes.position.needsUpdate = true; geometry.computeVertexNormals();
  };
  root.userData.disposeCape = () => { root.remove(mesh); geometry.dispose(); material.dispose(); };
}
