// Browser identity is a random bearer token; only its hash is stored on disk.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

export function createPlayerStore(file) {
  let records = {}, dirty = false;
  try { records = JSON.parse(readFileSync(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const key = token => typeof token === 'string' && /^[a-f0-9]{64}$/.test(token)
    ? createHash('sha256').update(token).digest('hex') : null;
  function flush() {
    if (!dirty) return;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file + '.tmp', JSON.stringify(records), { mode: 0o600 });
    renameSync(file + '.tmp', file); dirty = false;
  }
  return {
    key, flush,
    get: id => records[id]?.state || null,
    save(id, state) { if (id && state) { records[id] = { state, at: Date.now() }; dirty = true; } },
  };
}

export function savedPosition(m) {
  if (![m.lat, m.lon, m.alt].every(Number.isFinite) || Math.abs(m.lat) > 85 || Math.abs(m.lon) > 180 || m.alt < -500 || m.alt > 2e6) return null;
  const finite = (x, max) => Number.isFinite(x) ? Math.max(-max, Math.min(max, x)) : 0;
  const angle = x => Number.isFinite(x) ? Math.atan2(Math.sin(x), Math.cos(x)) : 0;
  const mode = ['ground', 'air', 'fly'].includes(m.mode) ? m.mode : m.grounded ? 'ground' : m.thrust ? 'fly' : 'air';
  return { lat: m.lat, lon: m.lon, alt: m.alt, yaw: angle(m.yaw),
    face: angle(m.face ?? m.yaw), pitch: finite(m.pitch, 1.45),
    vel: Array.isArray(m.vel) && m.vel.length === 3 ? m.vel.map(v => finite(v, 9000)) : [0, 0, 0],
    mode, grounded: mode === 'ground', power: Number.isFinite(m.power) ? Math.max(0, Math.min(100, m.power)) : 100 };
}
