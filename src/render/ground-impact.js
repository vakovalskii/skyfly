import * as THREE from 'three';
import { offsetTo } from '../core/grid.js';

// Bounded, local impact marks; they follow geography rather than the player.
// Cracks are a surface decal, not a hole in the terrain collision mesh.
export function createGroundImpact(scene, overlay) {
  const marks = new THREE.Group(), clouds = new THREE.Group();
  marks.userData.noCast = true; marks.name = 'Ground impact marks'; clouds.name = 'Ground impact dust';
  scene.add(marks); overlay.add(clouds);
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d');
  let seed = 73; const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const shade = ctx.createRadialGradient(256, 256, 15, 256, 256, 250);
  shade.addColorStop(0, 'rgba(20,16,13,.8)'); shade.addColorStop(.5, 'rgba(35,26,20,.55)'); shade.addColorStop(1, 'rgba(35,26,20,0)');
  ctx.fillStyle = shade; ctx.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 22; i++) {
    const a = i / 22 * Math.PI * 2; let x = 256, y = 256;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let j = 1; j <= 5; j++) {
      const r = j * (25 + random() * 18), angle = a + (random() - .5) * .16;
      x = 256 + Math.cos(angle) * r; y = 256 + Math.sin(angle) * r; ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(12,10,9,.9)'; ctx.lineWidth = 2 + random() * 3; ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const diskGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const rockGeometry = new THREE.DodecahedronGeometry(1, 0);
  const rockMaterial = new THREE.MeshStandardMaterial({ color: 0x65584b, roughness: .95 });
  const items = [], dummy = new THREE.Object3D();
  const dustMaterial = () => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: false,
    uniforms: { pixelScale: { value: 700 } },
    vertexShader: `attribute float size; attribute float opacity; uniform float pixelScale; varying float a;
      void main(){vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;
      gl_PointSize=clamp(size*pixelScale/max(.1,-p.z),1.,300.);a=opacity;}`,
    fragmentShader: `varying float a; void main(){vec2 p=gl_PointCoord*2.-1.;float r=length(p);
      float fog=exp(-r*r*3.)*(1.-smoothstep(.6,1.,r));gl_FragColor=vec4(.57,.50,.42,fog*a);
      #include <colorspace_fragment>
      }`,
  });
  function remove(item) {
    marks.remove(item.group); clouds.remove(item.dust);
    item.disk.material.dispose(); item.rocks.dispose();
    item.dust.geometry.dispose(); item.dust.material.dispose();
  }
  return {
    get count() { return items.length; },
    fire(at) {
      while (items.length >= 6) remove(items.shift());
      const group = new THREE.Group(), strength = at.strength ?? .7;
      const disk = new THREE.Mesh(diskGeometry, new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
      disk.position.y = .025; disk.scale.setScalar(5 + strength * 8); group.add(disk);
      const rocks = new THREE.InstancedMesh(rockGeometry, rockMaterial, 28); rocks.frustumCulled = false; group.add(rocks);
      const pos = new Float32Array(64 * 3), sizes = new Float32Array(64), alpha = new Float32Array(64), geo = new THREE.BufferGeometry();
      for (const [name, values, width] of [['position', pos, 3], ['size', sizes, 1], ['opacity', alpha, 1]]) geo.setAttribute(name, new THREE.BufferAttribute(values, width).setUsage(THREE.DynamicDrawUsage));
      const dust = new THREE.Points(geo, dustMaterial()); dust.frustumCulled = false;
      const particles = Array.from({ length: 64 }, () => ({ angle: random() * Math.PI * 2, velocity: 2 + random() * (5 + strength * 9), up: 2 + random() * 7, size: .5 + random(), turn: random() * 6 }));
      const item = { at: { ...at }, group, disk, rocks, dust, particles, age: 0, strength };
      items.push(item); marks.add(group); clouds.add(dust);
    },
    update(c, camera, dt, height = 800) {
      for (let index = items.length - 1; index >= 0; index--) {
        const item = items[index]; item.age += dt;
        if (item.age > 40) { remove(item); items.splice(index, 1); continue; }
        const [east, north, distance] = offsetTo(c, item.at), age = item.age;
        item.group.position.set(east, item.at.alt - c.alt, -north); item.dust.position.copy(item.group.position);
        item.group.visible = distance < 1000; item.dust.visible = age < 3 && distance < 1000;
        item.disk.material.opacity = Math.min(1, (40 - age) / 10);
        item.rocks.visible = age < 3;
        for (let i = 0; i < 28; i++) {
          const p = item.particles[i], t = Math.min(age, p.up * 2 / 15);
          dummy.position.set(Math.cos(p.angle) * p.velocity * t, Math.max(.06, p.up * t - 7.5 * t * t), Math.sin(p.angle) * p.velocity * t);
          dummy.rotation.set(p.turn + t * 4, p.turn + t * 3, t * 2); dummy.scale.setScalar((.06 + p.size * .09) * Math.min(1, Math.max(0, 3 - age))); dummy.updateMatrix(); item.rocks.setMatrixAt(i, dummy.matrix);
        }
        item.rocks.instanceMatrix.needsUpdate = true;
        const attrs = item.dust.geometry.attributes;
        for (let i = 0; i < 64; i++) {
          const p = item.particles[i], radius = p.velocity * (1 - Math.exp(-age * 1.8)) * .65;
          attrs.position.setXYZ(i, Math.cos(p.angle) * radius, .1 + age * (.35 + p.size * .45), Math.sin(p.angle) * radius);
          attrs.size.setX(i, p.size * (.8 + age * 2)); attrs.opacity.setX(i, Math.max(0, 1 - age / 3) * .42);
        }
        for (const a of Object.values(attrs)) a.needsUpdate = true;
        item.dust.material.uniforms.pixelScale.value = height * camera.projectionMatrix.elements[5] * .5;
      }
    },
    dispose() { items.forEach(remove); items.length = 0; scene.remove(marks); overlay.remove(clouds); texture.dispose(); diskGeometry.dispose(); rockGeometry.dispose(); rockMaterial.dispose(); },
  };
}
