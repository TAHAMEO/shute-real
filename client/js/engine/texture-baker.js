// Bakes procedural textures on the GPU (fullscreen shader -> render target with mipmaps).
// Each recipe defines GLSL functions:  float H(vec2 uv)  (height 0..1),
//   vec3 C(vec2 uv, float h)  (albedo, sRGB),  float R(vec2 uv, float h)  (roughness).
// The albedo texture stores roughness in alpha; the normal texture stores height in alpha.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { GLSL_NOISE } from './glsl.js';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export class TextureBaker {
  constructor(renderer) {
    this.renderer = renderer;
    this.quad = new FullScreenQuad(null);
    this.cache = new Map();
    this.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  }

  _material(recipe) {
    return new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: /* glsl */ `
        precision highp float;
        varying vec2 vUv;
        uniform float uMode;
        uniform float uTexel;
        uniform float uNormalStrength;
        ${GLSL_NOISE}
        ${recipe.glsl}
        void main() {
          vec2 uv = vUv;
          if (uMode < 0.5) {
            float h = H(uv);
            gl_FragColor = vec4(srgbToLinear(clamp(C(uv, h), 0.0, 1.0)), clamp(R(uv, h), 0.04, 1.0));
          } else {
            float e = uTexel;
            float hl = H(fract(uv - vec2(e, 0.0)));
            float hr = H(fract(uv + vec2(e, 0.0)));
            float hd = H(fract(uv - vec2(0.0, e)));
            float hu = H(fract(uv + vec2(0.0, e)));
            vec3 n = normalize(vec3((hl - hr) * uNormalStrength, (hd - hu) * uNormalStrength, 1.0));
            gl_FragColor = vec4(n * 0.5 + 0.5, H(uv));
          }
        }`,
      uniforms: {
        uMode: { value: 0 },
        uTexel: { value: 1 / 512 },
        uNormalStrength: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
  }

  _target(size, srgb) {
    const rt = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      depthBuffer: false,
      generateMipmaps: true,
      minFilter: THREE.LinearMipmapLinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
      colorSpace: srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace,
    });
    rt.texture.anisotropy = this.anisotropy;
    return rt;
  }

  /**
   * Bake a recipe. Returns { map, normalMap } textures (cached by name).
   * recipe: { name, glsl, size = 512, normalStrength = 2 }
   */
  bake(recipe) {
    if (this.cache.has(recipe.name)) return this.cache.get(recipe.name);
    const size = recipe.size || 512;
    const mat = this._material(recipe);
    mat.uniforms.uTexel.value = 1 / size;
    mat.uniforms.uNormalStrength.value = (recipe.normalStrength ?? 2) * size / 256;
    this.quad.material = mat;
    const r = this.renderer;
    const prevTarget = r.getRenderTarget();
    const rtA = this._target(size, true);
    mat.uniforms.uMode.value = 0;
    r.setRenderTarget(rtA);
    this.quad.render(r);
    const rtN = this._target(size, false);
    mat.uniforms.uMode.value = 1;
    r.setRenderTarget(rtN);
    this.quad.render(r);
    r.setRenderTarget(prevTarget);
    mat.dispose();
    const out = { map: rtA.texture, normalMap: rtN.texture, targets: [rtA, rtN] };
    this.cache.set(recipe.name, out);
    return out;
  }

  dispose() {
    for (const v of this.cache.values()) for (const t of v.targets) t.dispose();
    this.cache.clear();
    this.quad.dispose();
  }
}
