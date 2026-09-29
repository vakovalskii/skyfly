import { toLocal } from '../core/grid.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const CELL = 48; // Same cells as core/colliders.js; only nearby contour edges are visited.
// Closest points of two planar segments, including crossing and parallel segments.
function closest(ax, az, bx, bz, cx, cz, dx, dz) {
  const ux = bx - ax, uz = bz - az, vx = dx - cx, vz = dz - cz;
  const cross = ux * vz - uz * vx;
  if (Math.abs(cross) > 1e-9) {
    const t = ((cx - ax) * vz - (cz - az) * vx) / cross;
    const s = ((cx - ax) * uz - (cz - az) * ux) / cross;
    if (t >= 0 && t <= 1 && s >= 0 && s <= 1) return { t, x: ax + t * ux, z: az + t * uz, distance: 0 };
  }
  const u2 = ux * ux + uz * uz, v2 = vx * vx + vz * vz;
  const samples = [
    [0, clamp(((ax - cx) * vx + (az - cz) * vz) / (v2 || 1), 0, 1)],
    [1, clamp(((bx - cx) * vx + (bz - cz) * vz) / (v2 || 1), 0, 1)],
    [clamp(((cx - ax) * ux + (cz - az) * uz) / (u2 || 1), 0, 1), 0],
    [clamp(((dx - ax) * ux + (dz - az) * uz) / (u2 || 1), 0, 1), 1],
  ];
  let best = null;
  for (const [t, s] of samples) {
    const x = cx + s * vx, z = cz + s * vz, distance = Math.hypot(ax + t * ux - x, az + t * uz - z);
    if (!best || distance < best.distance) best = { t, x, z, distance };
  }
  return best;
}

export function nearbyPasses(city, from, to, radius = 38) {
  const candidates = new Set(), out = [];
  if (!city.colliders) return out;
  for (let x = Math.floor((Math.min(from.x, to.x) - radius) / CELL); x <= Math.floor((Math.max(from.x, to.x) + radius) / CELL); x++)
    for (let z = Math.floor((Math.min(from.z, to.z) - radius) / CELL); z <= Math.floor((Math.max(from.z, to.z) + radius) / CELL); z++)
      for (const b of city.colliders.get(`${x},${z}`) || []) candidates.add(b);
  for (const building of candidates) {
    let best = null;
    for (let i = 0; i < building.p.length; i += 2) {
      const j = (i + 2) % building.p.length;
      const hit = closest(from.x, from.z, to.x, to.z, building.p[i], building.p[i + 1], building.p[j], building.p[j + 1]);
      const height = from.y + (to.y - from.y) * hit.t;
      hit.distance = Math.hypot(hit.distance, Math.max(0, height - building.h, -height));
      if (!best || hit.distance < best.distance) best = hit;
    }
    if (best && best.distance < radius) out.push({ ...best, building });
  }
  return out;
}

export function createBuildingWhoosh(play) {
  let previous = null, time = 0, lastSound = -Infinity;
  const seen = new Map();
  return {
    update(c, cities, ground, speed, dt, right = [1, 0]) {
      time += dt;
      const old = previous; previous = { lat: c.lat, lon: c.lon, alt: c.alt };
      for (const [b, info] of seen) if (time - info.last > 1) seen.delete(b);
      if (!old || c.grounded || speed < 35 || c.alt - ground > 700) { seen.clear(); return; }
      const [de, dn] = toLocal(c.lat, c.lon, old.lat, old.lon);
      if (Math.hypot(de, dn) < .01 || Math.hypot(de, dn) > Math.max(150, speed * dt * 3)) { seen.clear(); return; }
      let loudest = null;
      for (const city of cities) {
        const [x, z] = toLocal(c.lat, c.lon, city.lat, city.lon);
        const hits = nearbyPasses(city, { x: x - de, z: z - dn, y: old.alt - ground + 1 }, { x, z, y: c.alt - ground + 1 });
        for (const hit of hits) {
          const info = seen.get(hit.building) || { played: false }; info.last = time; seen.set(hit.building, info);
          // Closest approach must have happened, not be ahead of the player.
          if (info.played || hit.t > .98) continue;
          const strength = (1 - hit.distance / 38) ** 1.6 * clamp((speed - 35) / 220, 0, 1);
          if (strength < .035) continue;
          const side = (hit.x - x) * right[0] + (hit.z - z) * right[1];
          const event = { strength, speed, distance: hit.distance, pan: clamp(side / Math.max(4, hit.distance), -.95, .95) };
          info.played = true;
          if (!loudest || strength > loudest.strength) loudest = event;
        }
      }
      if (loudest && time - lastSound > .14) { play(loudest); lastSound = time; }
    },
  };
}
