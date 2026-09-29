// Смазанность на скорости: радиальное размытие от центра экрана. Это один проход
// с 7–13 выборками; центр с персонажем остаётся резким.
import { speedBlurShader } from './speed-blur.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const RadialBlur = {
  uniforms: {
    tDiffuse: { value: null },
    uAmt: { value: 0 },        // сила смаза
    uWarm: { value: 0 },       // нагрев на сверхзвуке
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uWarm; varying vec2 vUv;
    SPEED_BLUR
    void main(){
      vec2 d = vUv - vec2(0.5);
      float edge = smoothstep(0.03, 0.55, dot(d, d));     // в центре резко, к краям мажем
      vec3 c = sampleSpeedBlur(vUv, texture2D(tDiffuse, vUv)).rgb;
      c += vec3(0.35, 0.12, 0.02) * uWarm * edge;          // тепло на ударной волне
      gl_FragColor = vec4(c, 1.0);
    }`,
};

export function createPost(renderer, scene, camera, mobile) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const shader = { ...RadialBlur, fragmentShader: RadialBlur.fragmentShader.replace('SPEED_BLUR', speedBlurShader(mobile, 'tDiffuse')) };
  const pass = new ShaderPass(shader);
  composer.addPass(pass);
  composer.addPass(new OutputPass());     // тон-маппинг и sRGB — иначе кадр уходит в темноту
  const size = () => composer.setSize(innerWidth, innerHeight);
  addEventListener('resize', size);
  size();
  return {
    // amt: 0..1 по скорости, warm: вспышка на переходе звука
    set(amt, warm) { pass.uniforms.uAmt.value = amt; pass.uniforms.uWarm.value = warm; pass.enabled = amt > .0001 || warm > .0001; },
    composer,
    render() { composer.render(); },
  };
}
