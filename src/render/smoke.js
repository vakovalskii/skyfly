import * as THREE from 'three';

// Shared soft, uneven puffs. Normal blending prevents the old luminous white rims.
export function createSmokeCloud(count, { color = 0xc4d2d9, depthTest = false } = {}) {
  const geometry = new THREE.BufferGeometry();
  for (const [name, width] of [['position', 3], ['size', 1], ['opacity', 1]])
    geometry.setAttribute(name, new THREE.BufferAttribute(new Float32Array(count * width), width).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('seed', new THREE.Float32BufferAttribute(Array.from({ length: count }, (_, i) => i * 17.137), 1));
  const material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest, toneMapped: false,
    uniforms: { tint: { value: new THREE.Color(color) }, height: { value: 800 }, time: { value: 0 } },
    vertexShader: `attribute float size, opacity, seed; uniform float height; varying float alpha, phase;
      void main(){vec4 p=modelViewMatrix*vec4(position,1.);gl_Position=projectionMatrix*p;
        gl_PointSize=clamp(size*height*projectionMatrix[1][1]*.5/max(.1,-p.z),1.,320.);alpha=opacity;phase=seed;}`,
    fragmentShader: `uniform vec3 tint; uniform float time; varying float alpha, phase;
      float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
      float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
        return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
      void main(){vec2 p=gl_PointCoord*2.-1.;float a=phase*.17;
        p=mat2(cos(a),-sin(a),sin(a),cos(a))*p;
        float n=noise(p*3.+phase+time*.13)*.65+noise(p*7.-phase-time*.08)*.35;
        float edge=1.-smoothstep(.38+n*.18,.84+n*.12,length(p));
        float cloud=edge*(.25+.75*n)*exp(-dot(p,p)*1.5);
        gl_FragColor=vec4(tint*(.85+.15*n),cloud*alpha);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Points(geometry, material); mesh.frustumCulled = false; mesh.name = 'Soft turbulent mist';
  return {
    mesh,
    set(i, x, y, z, size, opacity) { geometry.attributes.position.setXYZ(i, x, y, z); geometry.attributes.size.setX(i, size); geometry.attributes.opacity.setX(i, opacity); },
    update(time, height = globalThis.innerHeight || 800) {
      material.uniforms.time.value = time; material.uniforms.height.value = height;
      for (const name of ['position', 'size', 'opacity']) geometry.attributes[name].needsUpdate = true;
    },
    dispose() { mesh.removeFromParent(); geometry.dispose(); material.dispose(); },
  };
}

// Bounded burst pool used for takeoff, sound barrier and atmosphere boundaries.
export function createSmokeBursts(parent, limit = 6) {
  const pool = [], zero = new THREE.Vector3(); let clock = 0;
  return {
    emit({ color = 0xc4d2d9, power = 1, spread = 8, life = 1.5, rise = 1, origin = zero } = {}) {
      let item = pool.find(p => !p.cloud.mesh.visible);
      if (!item && pool.length < limit) { item = { cloud: createSmokeCloud(40) }; pool.push(item); parent.add(item.cloud.mesh); }
      if (!item) item = pool.reduce((a, b) => a.age / a.life > b.age / b.life ? a : b);
      Object.assign(item, { age: 0, power, spread, life, rise });
      item.cloud.mesh.position.copy(origin); item.cloud.mesh.visible = true; item.cloud.mesh.material.uniforms.tint.value.set(color);
    },
    update(dt, velocity = zero, height) {
      clock += dt;
      for (const item of pool) {
        if (!item.cloud.mesh.visible) continue;
        item.age += dt; const t = item.age / item.life;
        if (t >= 1) { item.cloud.mesh.visible = false; continue; }
        item.cloud.mesh.position.addScaledVector(velocity, -dt);
        for (let i = 0; i < 40; i++) {
          const angle = i * 2.399963, seed = (i * .618034) % 1;
          const radius = (.1 + Math.sqrt(seed) * .9) * item.spread * (1 - Math.exp(-t * 2.8));
          const fade = Math.min(1, t * 12) * (1 - t) ** 1.8;
          item.cloud.set(i, Math.cos(angle) * radius, .1 + seed * .4 + t * item.rise, Math.sin(angle) * radius,
            (.4 + seed * .7 + t * 2.2) * Math.max(1, item.spread * .18), fade * (.12 + .16 * item.power));
        }
        item.cloud.update(clock, height);
      }
    },
    dispose() { pool.forEach(p => p.cloud.dispose()); pool.length = 0; },
  };
}
