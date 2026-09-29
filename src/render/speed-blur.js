import { Uniform } from 'three';
import { Effect, EffectAttribute, BlendFunction } from 'postprocessing';

// Physics supplies m/s. Ramp continuously above 1000 km/h, including thin air.
export function speedBlurAmount(speed) {
  const excess = Math.max(0, speed * 3.6 - 1000);
  return .20 * (1 - Math.exp(-excess / 1200));
}

// Shared by the legacy composer and the volumetric atmosphere composer.
export function speedBlurShader(mobile, sampler) {
  return `
    uniform float uAmt;
    vec4 sampleSpeedBlur(vec2 uv, vec4 original) {
      vec2 d = uv - vec2(0.5);
      float edge = smoothstep(0.04, 0.42, dot(d, d));
      float amount = uAmt * edge;
      if (amount < 0.0001) return original;
      vec3 sum = original.rgb;
      const int N = ${mobile ? 7 : 13};
      for (int i = 1; i < N; ++i) {
        float along = float(i) / float(N - 1);
        sum += texture2D(${sampler}, uv - d * amount * along).rgb;
      }
      return vec4(sum / float(N), original.a);
    }
  `;
}

export function createSpeedBlurEffect(mobile) {
  return new Effect('SpeedBlur', speedBlurShader(mobile, 'inputBuffer') + `
    void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
      outputColor = sampleSpeedBlur(uv, inputColor);
    }
  `, { attributes: EffectAttribute.CONVOLUTION, blendFunction: BlendFunction.NORMAL,
    uniforms: new Map([['uAmt', new Uniform(0)]]) });
}
