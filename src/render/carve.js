// Cloud displacement: ragged wake, rolling edges and a hover pocket.
// Shared density deformation in the cloud and shadow passes; bounded path history.
import * as THREE from 'three';

const N = 32, HEAL = 75;
const GLSL = `
uniform vec4 carvePoints[${N}]; // ECEF + altitude correction, radius
uniform vec4 carveMeta[${N}]; // strength, connection, segment bound radius
uniform int carveCount;
uniform vec4 carveBound;
uniform float carveTime;
float carveAt(const vec3 p) {
  if (carveCount == 0 || distance(p, carveBound.xyz) > carveBound.w) return 1.0;
  float nearest = 10.0, strength = 0.0;
  vec3 offset = vec3(0.0);
  for (int i = 0; i < ${N}; ++i) {
    if (i >= carveCount) break;
    vec3 closest = carvePoints[i].xyz;
    vec3 a = closest;
    if (i > 0 && carveMeta[i].y > 0.5) a = carvePoints[i - 1].xyz;
    vec3 fromBound = p - (a + closest) * 0.5;
    if (dot(fromBound, fromBound) > carveMeta[i].z * carveMeta[i].z) continue;
    float radius = carvePoints[i].w, power = carveMeta[i].x;
    if (i > 0 && carveMeta[i].y > 0.5) {
      vec3 ab = closest - a;
      float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-3), 0.0, 1.0);
      closest = a + ab * t;
      radius = mix(carvePoints[i - 1].w, radius, t);
      power = mix(carveMeta[i - 1].x, power, t);
    }
    float d = distance(p, closest) / max(radius, 1.0);
    if (d < nearest) { nearest = d; strength = power; offset = (p - closest) / max(radius, 1.0); }
  }
  if (nearest > 1.75) return 1.0;
  // Moving lobes around the wake, without a clean tube or solid bright shell.
  float t = carveTime * 0.65;
  vec3 q = offset * 7.0;
  float rolling = sin(q.x + sin(q.y + t)) * sin(q.z - t * 1.3)
    + 0.45 * sin(q.y * 2.1 - q.z + t * 1.8);
  float d = nearest + rolling * 0.14;
  float hollow = smoothstep(0.42, 1.08, d);
  float rim = smoothstep(0.66, 1.03, d) * (1.0 - smoothstep(1.03, 1.48, d));
  return mix(1.0, hollow, strength) + rim * strength * (0.7 + 0.35 * rolling);
}
`;

export function createCarve(clouds) {
  const points = Array.from({ length: N }, () => new THREE.Vector4());
  const meta = Array.from({ length: N }, () => new THREE.Vector4());
  const bound = new THREE.Vector4();
  const uniforms = { carvePoints: { value: points }, carveMeta: { value: meta },
    carveCount: { value: 0 }, carveBound: { value: bound }, carveTime: { value: 0 } };
  const materials = [clouds.cloudsPass.currentMaterial, clouds.shadowPass?.currentMaterial].filter(Boolean);
  const anchor = 'MediaSample sampleMedia(', apply = '  // Apply the density profiles.';
  const ok = materials.every(mat => mat.fragmentShader.includes(anchor) && mat.fragmentShader.includes(apply));
  if (ok) for (const mat of materials) {
    Object.assign(mat.uniforms, uniforms);
    mat.fragmentShader = mat.fragmentShader.replace(anchor, GLSL + anchor)
      .replace(apply, '  density *= carveAt(position);\n' + apply);
    mat.needsUpdate = true;
  } else console.warn('Влияние на облака: не найдена функция плотности takram.');

  const trail = [];
  const current = new THREE.Vector3(), drift = new THREE.Vector3(), previous = new THREE.Vector3();
  const segment = new THREE.Vector3(), relative = new THREE.Vector3();
  let lastTime = null, wasActive = false, hoverTime = 0, head = null;
  // Compact straight sections instead of evicting old points every frame at high speed.
  function compact() {
    while (trail.length > N - 1) {
      let best = -1, error = Infinity;
      for (let i = 1; i < trail.length - 1; i++) {
        if (!trail[i].connect || !trail[i + 1].connect) continue;
        const a = trail[i - 1], b = trail[i], c = trail[i + 1];
        segment.copy(c.p).sub(a.p); relative.copy(b.p).sub(a.p);
        const t = THREE.MathUtils.clamp(relative.dot(segment) / Math.max(1e-6, segment.lengthSq()), 0, 1);
        const cost = relative.addScaledVector(segment, -t).lengthSq() + (c.t - a.t) ** 2 * .02;
        if (cost < error) { best = i; error = cost; }
      }
      trail.splice(best < 0 ? 0 : best, 1);
    }
  }
  return {
    ok,
    update(worldToECEF, now, c) {
      if (!ok) return 1;
      const dt = lastTime === null ? 0 : Math.max(0, Math.min(.1, now - lastTime));
      lastTime = now; uniforms.carveTime.value = now % 4096;
      current.set(0, 1, 0).applyMatrix4(worldToECEF);
      drift.set(1, .12, -.3).transformDirection(worldToECEF).multiplyScalar(dt * 3);
      for (const p of trail) p.p.add(drift);
      while (trail.length && now - trail[0].t >= HEAL) trail.shift();
      const speed = Math.hypot(...c.vel);
      const hover = c.mode === 'fly' && (c.hoverLift || speed < 12);
      const radius = hover ? 12 + 12 * (1 - Math.exp(-hoverTime * .7))
        : 24 + 70 * THREE.MathUtils.smoothstep(speed, 20, 1400);
      const nearLayer = clouds.cloudLayers.some(layer => layer.densityScale > 0 &&
        c.alt > layer.altitude - radius * 2 && c.alt < layer.altitude + layer.height + radius * 2);
      const active = !c.grounded && nearLayer && (hover || speed > 8);
      hoverTime = active && hover ? hoverTime + dt : 0;
      const continuous = wasActive && previous.distanceTo(current) < Math.max(250, speed * dt * 3);
      if (active) {
        const point = { p: current.clone(), t: now, radius, strength: hover ? .82 : 1, connect: continuous };
        const last = trail.at(-1), spacing = Math.max(18, speed * .3);
        if (hover && continuous && last && current.distanceTo(last.p) < 8) {
          Object.assign(last, point); head = null;
        } else if (!last || !continuous || current.distanceTo(last.p) >= spacing) {
          trail.push(point); head = null;
        } else head = point;
      } else head = null;
      wasActive = active; previous.copy(current); compact();
      const correction = materials[0].uniforms.altitudeCorrection?.value;
      let count = 0; bound.set(0, 0, 0, 0);
      for (const p of head ? [...trail, head] : trail) {
        // Hold the opening for 25 s, then slowly restore the cloud over 50 s.
        const life = 1 - THREE.MathUtils.smoothstep(now - p.t, 25, HEAL);
        const r = p.radius * (.3 + .7 * life);
        points[count].set(p.p.x, p.p.y, p.p.z, r);
        if (correction) { points[count].x += correction.x; points[count].y += correction.y; points[count].z += correction.z; }
        const connect = count > 0 && p.connect;
        const previousPoint = points[count - 1];
        const segmentBound = connect ? Math.hypot(points[count].x - previousPoint.x,
          points[count].y - previousPoint.y, points[count].z - previousPoint.z) * .5 + Math.max(r, previousPoint.w) * 1.75 : r * 1.75;
        meta[count].set(p.strength * life, connect ? 1 : 0, segmentBound, 0);
        bound.x += points[count].x; bound.y += points[count].y; bound.z += points[count].z; count++;
      }
      uniforms.carveCount.value = count;
      if (count) {
        bound.x /= count; bound.y /= count; bound.z /= count;
        for (let i = 0; i < count; i++) bound.w = Math.max(bound.w,
          Math.hypot(points[i].x - bound.x, points[i].y - bound.y, points[i].z - bound.z) + points[i].w * 1.75);
      }
      // Camera mist must clear inside the same cavity instead of hiding the hole.
      if (correction) current.add(correction);
      let nearest = Infinity, strength = 0;
      for (let i = 0; i < count; i++) {
        const b = points[i], a = meta[i].y ? points[i - 1] : b;
        segment.set(b.x - a.x, b.y - a.y, b.z - a.z);
        relative.set(current.x - a.x, current.y - a.y, current.z - a.z);
        const t = THREE.MathUtils.clamp(relative.dot(segment) / Math.max(1e-6, segment.lengthSq()), 0, 1);
        const radius = THREE.MathUtils.lerp(a.w, b.w, t);
        const distance = relative.addScaledVector(segment, -t).length() / Math.max(1, radius);
        if (distance < nearest) {
          nearest = distance; strength = meta[i].y ? THREE.MathUtils.lerp(meta[i - 1].x, meta[i].x, t) : meta[i].x;
        }
      }
      return 1 - strength * (1 - THREE.MathUtils.smoothstep(nearest, .42, 1.08));
    },
  };
}
