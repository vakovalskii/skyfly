import * as THREE from 'three';

// hero-base.glb has constant UVs. Project onto its unskinned, Z-up bind positions,
// then carry these coordinates through skinning: no swimming when a limb moves.
let shield;
function chestShield() {
  if (shield) return shield;
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 384;
  const c = canvas.getContext('2d');
  c.scale(5.12, 3.84);
  const outline = new Path2D('M 18 5 L 82 5 L 98 25 L 50 96 L 2 25 Z');
  c.fillStyle = '#6b111d'; c.fill(outline);
  c.save(); c.clip(outline);
  const gold = c.createLinearGradient(0, 0, 0, 100);
  gold.addColorStop(0, '#ffe184'); gold.addColorStop(.45, '#e8b744'); gold.addColorStop(1, '#b87b21');
  c.fillStyle = gold;
  c.fill(new Path2D('M 21 12 L 79 12 L 89 26 L 50 84 L 11 26 Z'));
  // A drawn S, rather than a font dependency. The shield is original vector art.
  c.fillStyle = '#b51c32';
  c.fill(new Path2D('M 80 18 L 34 18 C 17 18 14 39 32 45 L 60 54 C 72 58 66 67 56 67 L 27 67 L 38 78 L 59 78 C 84 78 91 49 66 42 L 39 34 C 31 32 32 27 40 27 L 66 27 L 70 33 L 84 33 Z'));
  c.strokeStyle = '#ffcb6a'; c.lineWidth = .6; c.stroke(new Path2D('M 19 8 L 81 8 L 94 25 L 50 91'));
  c.restore();
  shield = new THREE.CanvasTexture(canvas);
  shield.colorSpace = THREE.SRGBColorSpace; shield.anisotropy = 4;
  shield.name = 'Superman chest shield';
  return shield;
}

const surface = `
  vec3 p = vSuitPosition;
  float skin = smoothstep(.38, .72, vSuitSkin);
  float torso = (1.0 - skin) * step(.76, p.z) * (1.0 - step(1.5, p.z)) * (1.0 - step(.25, abs(p.x)));
  float bootTop = .48 + .07 * (1.0 - smoothstep(.035, .12, abs(abs(p.x) - .1)));
  float boots = (1.0 - smoothstep(bootTop - .005, bootTop + .005, p.z)) * (1.0 - skin);
  float belt = (1.0 - smoothstep(.023, .029, abs(p.z - .98))) * torso;
  float sidePanel = smoothstep(.105, .145, abs(p.x)) * torso * (1.0 - smoothstep(1.35, 1.44, p.z));
  float seam = (1.0 - smoothstep(.002, .004, abs(abs(p.x) - (.106 + .065 * smoothstep(1.05, 1.42, p.z))))) * torso;
  vec3 blue = mix(vec3(.012, .065, .20), vec3(.006, .027, .068), sidePanel * .8 + suitJoint * .45);
  blue += vec3(.015, .032, .047) * seam;
  vec3 suitColor = mix(blue, vec3(.34, .008, .021), boots);
  suitColor = mix(suitColor, vec3(.67, .36, .055), belt);
  suitColor = mix(suitColor, vec3(.61, .36, .23), skin);
  float hairline = 1.73 - .035 * smoothstep(.025, .08, abs(p.x)) - .025 * (1.0 - smoothstep(-.07, .055, p.y));
  float hair = skin * smoothstep(hairline - .004, hairline + .004, p.z);
  suitColor = mix(suitColor, vec3(.009, .012, .018), hair);
  // Analytic twill. fwidth fades it out before it can shimmer in the game camera.
  vec2 weaveUV = vec2(p.x + p.y * .7, p.z) * 470.0;
  float weaveAA = 1.0 - smoothstep(.35, 1.2, max(fwidth(weaveUV.x), fwidth(weaveUV.y)));
  float weave = sin(weaveUV.x * 6.28318) * sin(weaveUV.y * 6.28318);
  suitColor *= 1.0 + .11 * weave * weaveAA * (1.0 - skin) * (1.0 - belt);
  vec2 badgeUV = vec2(p.x / .36 + .5, (p.z - 1.30) / .27 + .5);
  vec4 badge = texture2D(suitShield, clamp(badgeUV, 0.0, 1.0));
  float badgeMask = badge.a * step(0.0, badgeUV.x) * step(badgeUV.x, 1.0)
    * step(0.0, badgeUV.y) * step(badgeUV.y, 1.0) * smoothstep(.035, .075, p.y) * torso;
  suitColor = mix(suitColor, pow(badge.rgb, vec3(2.2)), badgeMask);
  diffuseColor.rgb *= suitColor;
`;

export function applyHeroSuit(mesh) {
  const geometry = mesh.geometry;
  if (!geometry.hasAttribute('suitSkin')) {
    const indices = geometry.getAttribute('skinIndex'), weights = geometry.getAttribute('skinWeight');
    const skin = new Float32Array(geometry.getAttribute('position').count);
    if (indices && weights && mesh.skeleton) {
      const exposed = mesh.skeleton.bones.map(b => /DEF-(head|neck|hand|f_|thumb)/.test(b.name));
      for (let i = 0; i < skin.length; i++) for (let k = 0; k < 4; k++)
        if (exposed[indices.getComponent(i, k)]) skin[i] += weights.getComponent(i, k);
    }
    // Shared geometry belongs to the loaded asset; this immutable attribute is shared by previews.
    geometry.setAttribute('suitSkin', new THREE.BufferAttribute(skin, 1));
  }
  const joints = /joint/i.test(mesh.material.name);
  mesh.material.dispose();
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .71, metalness: .06 });
  material.name = joints ? 'Superman · flexible joints' : 'Superman · woven suit';
  material.onBeforeCompile = shader => {
    shader.uniforms.suitShield = { value: chestShield() };
    shader.uniforms.suitJoint = { value: joints ? 1 : 0 };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float suitSkin; varying float vSuitSkin; varying vec3 vSuitPosition;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSuitPosition = vec3(position.x, -position.y, position.z) * 100.0; vSuitSkin = suitSkin;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D suitShield; uniform float suitJoint; varying float vSuitSkin; varying vec3 vSuitPosition;')
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + surface)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, .46, max(boots, badgeMask)); roughnessFactor = mix(roughnessFactor, .38, belt); roughnessFactor += weave * weaveAA * .06 * (1.0 - skin);');
  };
  material.customProgramCacheKey = () => 'skyfly-superman-suit-v1';
  mesh.material = material;
}
