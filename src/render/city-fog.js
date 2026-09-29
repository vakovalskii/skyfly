import { Color, Uniform } from 'three';
import { BlendFunction, Effect, EffectAttribute } from 'postprocessing';

// Depth-based ground fog, independent of cloud coverage and local cloud cavities.
export function createCityFog(camera) {
  const effect = new Effect('CityFog', `
    uniform mat4 fogInverseProjection, fogCameraWorld;
    uniform float fogCameraHeight;
    uniform vec3 fogColor;
    void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
      float depth = readDepth(uv);
      // Three r170 uses the old define; newer postprocessing only decodes the
      // renamed define. Keep depth reconstruction consistent with the renderer.
      #if defined(USE_LOGDEPTHBUF) && !defined(USE_LOGARITHMIC_DEPTH_BUFFER) && !defined(LOG_DEPTH)
        float distanceZ = exp2(depth * log2(cameraFar + 1.0)) - 1.0;
        depth = cameraFar / (cameraFar - cameraNear) + cameraFar * cameraNear / ((cameraNear - cameraFar) * max(distanceZ, 0.0001));
      #endif
      if (depth >= 1.0) { outputColor = inputColor; return; }
      vec4 view = fogInverseProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
      view.xyz /= view.w;
      float distanceToScene = length(view.xyz);
      vec3 offset = (fogCameraWorld * vec4(view.xyz, 0.0)).xyz;
      float h0 = max(0.0, fogCameraHeight);
      float h1 = max(0.0, fogCameraHeight + offset.y);
      float delta = (h1 - h0) / 500.0;
      float density = abs(delta) < 0.001 ? exp(-h0 / 500.0)
        : (exp(-h0 / 500.0) - exp(-h1 / 500.0)) / delta;
      float fog = min(0.94, 1.0 - exp(-max(0.0, distanceToScene - 90.0) * density * 0.00045));
      outputColor = vec4(mix(inputColor.rgb, fogColor, fog), inputColor.a);
    }
  `, { attributes: EffectAttribute.DEPTH, blendFunction: BlendFunction.NORMAL, uniforms: new Map([
    ['fogInverseProjection', new Uniform(camera.projectionMatrixInverse)],
    ['fogCameraWorld', new Uniform(camera.matrixWorld)],
    ['fogCameraHeight', new Uniform(0)],
    ['fogColor', new Uniform(new Color(0xb7aea5))],
  ]) });
  const day = new Color(0xb4c2d0), evening = new Color(0xb7aea5), night = new Color(0x273448);
  effect.setHeight = (height, sunY) => {
    effect.uniforms.get('fogCameraHeight').value = height + camera.position.y;
    const color = effect.uniforms.get('fogColor').value;
    color.copy(evening).lerp(day, Math.min(1, Math.max(0, (sunY - .15) / .4)));
    if (sunY < 0) color.lerp(night, Math.min(1, -sunY / .2));
  };
  return effect;
}
