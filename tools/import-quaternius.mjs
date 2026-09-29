// node tools/import-quaternius.mjs .cache/animation-import/UAL2_Standard.glb
// Only the free Standard library; never fetches paid packs. Reproducible, offline conversion.
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const BONE_MAP = {
  root: 'root', pelvis: 'DEF-hips', spine_01: 'DEF-spine001', spine_02: 'DEF-spine002',
  spine_03: 'DEF-spine003', neck_01: 'DEF-neck', Head: 'DEF-head',
};
for (const side of ['l', 'r']) {
  const suffix = side.toUpperCase();
  for (const [source, target] of Object.entries({ clavicle: 'shoulder', upperarm: 'upper_arm', lowerarm: 'forearm', hand: 'hand', thigh: 'thigh', calf: 'shin', foot: 'foot', ball: 'toe' }))
    BONE_MAP[`${source}_${side}`] = `DEF-${target}${suffix}`;
  for (const finger of ['index', 'middle', 'ring', 'pinky', 'thumb']) for (const n of ['01', '02', '03'])
    BONE_MAP[`${finger}_${n}_${side}`] = `DEF-${finger === 'thumb' ? '' : 'f_'}${finger}${n}${suffix}`;
}

export async function readGLB(path) {
  const buffer = await fs.readFile(path);
  return new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
}

export function retargetLibrary(source, target) {
  // Both Quaternius generations use the same bind axes and proportions, in units 100:1.
  // The old GLB's default pose is NOT its bind pose: recover from inverse bind matrices.
  for (const gltf of [source, target]) {
    gltf.scene.updateMatrixWorld(true);
    gltf.scene.traverse(o => { if (o.isSkinnedMesh) o.skeleton.pose(); });
    gltf.scene.updateMatrixWorld(true);
  }
  const corrections = new Map();
  for (const [from, to] of Object.entries(BONE_MAP)) {
    const a = source.scene.getObjectByName(from), b = target.scene.getObjectByName(to);
    if (!a || !b) throw new Error(`Missing mapped bone: ${from} → ${to}`);
    if (from !== 'root' && a.quaternion.angleTo(b.quaternion) > .005)
      throw new Error(`Incompatible bind axes: ${from}; this importer targets hero-base.glb only`);
    corrections.set(from, b.quaternion.clone().multiply(a.quaternion.clone().invert()));
  }
  const q = new THREE.Quaternion();
  return source.animations.filter(c => c.name !== 'A_TPose').map(clip => {
    const tracks = [];
    for (const original of clip.tracks) {
      const [name, property] = original.name.split('.'), mapped = BONE_MAP[name];
      if (!mapped || property === 'scale') continue;
      const track = original.clone(); track.name = `${mapped}.${property}`;
      if (property === 'position') {
        if (name === 'root' && track.values.some(v => Math.abs(v) > 1e-5)) throw new Error('Use in-place, not root-motion source');
        for (let i = 0; i < track.values.length; i++) track.values[i] *= .01;
      } else if (property === 'quaternion') {
        for (let i = 0; i < track.values.length; i += 4)
          q.fromArray(track.values, i).premultiply(corrections.get(name)).normalize().toArray(track.values, i);
      }
      // Remove exporter noise from static channels, then collapse duplicate keys.
      const precision = property === 'position' ? 1e8 : 1e6;
      for (let i = 0; i < track.values.length; i++) track.values[i] = Math.round(track.values[i] * precision) / precision;
      tracks.push(track.optimize());
    }
    return new THREE.AnimationClip(`UAL2:${clip.name}`, clip.duration, tracks);
  });
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const path = process.argv[2] || '.cache/animation-import/UAL2_Standard.glb';
  const clips = retargetLibrary(await readGLB(path), await readGLB('public/models/hero-base.glb'));
  const bundle = { version: 1, source: 'https://quaternius.itch.io/universal-animation-library-2', license: 'CC0-1.0',
    sha256: crypto.createHash('sha256').update(await fs.readFile(path)).digest('hex'), clips: clips.map(THREE.AnimationClip.toJSON) };
  await fs.mkdir('public/animations', { recursive: true });
  const json = JSON.stringify(bundle, (_, v) => typeof v === 'number' ? Number(v.toPrecision(7)) : v);
  await fs.writeFile('public/animations/quaternius-ual2.json', json + '\n');
  console.log(`Imported ${clips.length} clips, ${(json.length / 1e6).toFixed(2)} MB`);
}
