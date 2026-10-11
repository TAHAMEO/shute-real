// Rendering pipeline: world -> AO / god rays / aerial fog composite -> first-person viewmodel
// -> bloom -> tone mapping + colour grade + screen effects -> SMAA/FXAA.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { GLSL_TONEMAP, GLSL_NOISE } from './glsl.js';

const QUAD_VERT = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// ------------------------------------------------------------------ composite (AO + aerial fog + god rays)
const COMPOSITE_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor;
uniform highp sampler2D tDepth;
uniform sampler2D tAO;
uniform sampler2D tRays;
uniform sampler2D tSkyFog;
uniform float uUseAO;
uniform float uUseRays;
uniform float uUseSkyFog;
uniform float uAOStrength;
uniform mat4 uProjInv;
uniform mat4 uCamWorld;
uniform vec3 uCamPos;
uniform vec3 uFogColor;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uFogDensity;
uniform float uFogFalloff;
uniform float uFogBase;
uniform float uFogMax;
uniform vec3 uRaysColor;

vec3 viewPosFromDepth(vec2 uv, float depth) {
  vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
  vec4 v = uProjInv * ndc;
  return v.xyz / v.w;
}

void main() {
  vec3 col = texture2D(tColor, vUv).rgb;
  float depth = texture2D(tDepth, vUv).x;
  if (depth < 0.99999) {
    vec3 vpos = viewPosFromDepth(vUv, depth);
    vec3 wpos = (uCamWorld * vec4(vpos, 1.0)).xyz;
    vec3 d = wpos - uCamPos;
    float dist = length(d);
    vec3 dir = d / max(dist, 1e-4);
    if (uUseAO > 0.5) {
      float ao = texture2D(tAO, vUv).r;
      float fade = 1.0 - smoothstep(40.0, 140.0, dist);
      col *= mix(1.0, ao, uAOStrength * fade);
    }
    // Exponential height fog, integrated along the view ray.
    float h0 = uCamPos.y - uFogBase;
    float k = uFogFalloff;
    float dy = dir.y * dist;
    float base = uFogDensity * exp(-k * h0);
    float integral = abs(dy) > 0.01 ? base * (1.0 - exp(-k * dy)) / (k * dir.y) : base * dist;
    float fog = 1.0 - exp(-max(integral, 0.0));
    fog = min(fog, uFogMax);
    float sunAmt = pow(max(dot(dir, uSunDir), 0.0), 6.0);
    vec3 fogCol = uFogColor;
    if (uUseSkyFog > 0.5) {
      // Blend toward the actual sky colour behind the fragment so distant terrain melts into the horizon.
      vec3 sky = texture2D(tSkyFog, vUv).rgb;
      fogCol = mix(fogCol, sky, smoothstep(250.0, 1600.0, dist) * 0.85);
    }
    fogCol += uSunColor * sunAmt * 0.35;
    col = mix(col, fogCol, fog);
  }
  if (uUseRays > 0.5) col += texture2D(tRays, vUv).rgb * uRaysColor;
  gl_FragColor = vec4(col, 1.0);
}
`;

// ------------------------------------------------------------------ god rays
const RAYS_MASK_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform highp sampler2D tDepth;
uniform sampler2D tColor;
uniform vec2 uSunUv;
uniform float uAspect;
void main() {
  float depth = texture2D(tDepth, vUv).x;
  float sky = step(0.99999, depth);
  vec2 d = (vUv - uSunUv) * vec2(uAspect, 1.0);
  float glow = 1.0 - smoothstep(0.0, 0.32, length(d));
  vec3 c = texture2D(tColor, vUv).rgb;
  float bright = smoothstep(0.6, 3.0, dot(c, vec3(0.33)));
  gl_FragColor = vec4(vec3(sky * glow * glow * (0.35 + bright)), 1.0);
}
`;

const RAYS_BLUR_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tInput;
uniform vec2 uSunUv;
uniform float uStepScale;
uniform float uDecay;
#define SAMPLES 36
void main() {
  vec2 delta = (vUv - uSunUv) * uStepScale / float(SAMPLES);
  vec2 uv = vUv;
  float illum = 1.0;
  vec3 acc = vec3(0.0);
  float jitter = fract(sin(dot(vUv, vec2(12.9898, 78.233))) * 43758.5453);
  uv -= delta * jitter;
  for (int i = 0; i < SAMPLES; i++) {
    uv -= delta;
    acc += texture2D(tInput, clamp(uv, 0.0, 1.0)).rgb * illum;
    illum *= uDecay;
  }
  gl_FragColor = vec4(acc / float(SAMPLES), 1.0);
}
`;

// ------------------------------------------------------------------ final grade
const FINAL_FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor;
uniform float uExposure;
uniform float uSaturation;
uniform float uContrast;
uniform vec3 uTint;
uniform float uVignette;
uniform float uGrain;
uniform float uTime;
uniform float uDamage;     // red edge flash
uniform float uLowHealth;  // desaturate + pulse
uniform float uFlash;      // white flash (explosions, flashbang)
uniform float uAberration;
uniform float uScope;      // tunnel vignette when using magnified optics
uniform vec2 uResolution;
${GLSL_TONEMAP}
float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 uv = vUv;
  vec2 c = uv - 0.5;
  float r2 = dot(c, c);
  vec3 col;
  float ab = uAberration * (0.4 + uLowHealth * 2.0) * r2;
  if (ab > 0.00001) {
    col.r = texture2D(tColor, uv - c * ab).r;
    col.g = texture2D(tColor, uv).g;
    col.b = texture2D(tColor, uv + c * ab).b;
  } else {
    col = texture2D(tColor, uv).rgb;
  }
  col *= uExposure;
  col = acesFilmic(col);
  // grade (display space-ish)
  float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float sat = uSaturation * (1.0 - uLowHealth * 0.75);
  col = mix(vec3(l), col, sat);
  col = (col - 0.5) * uContrast + 0.5;
  col *= uTint;
  // vignette
  float vig = smoothstep(0.85, 0.15, r2 * (1.0 + uVignette * 1.5));
  col *= mix(1.0, vig, uVignette);
  // damage / low health
  float edge = smoothstep(0.08, 0.45, r2);
  float pulse = 0.65 + 0.35 * sin(uTime * 6.0);
  col = mix(col, vec3(0.45, 0.0, 0.0), edge * clamp(uDamage * 0.75 + uLowHealth * 0.55 * pulse, 0.0, 0.85));
  col = mix(col, vec3(1.0), uFlash);
  // scope tunnel
  col *= 1.0 - smoothstep(0.08, 0.4, r2) * uScope;
  col = clamp(col, 0.0, 1.0);
  col = linearToSRGB(col);
  // film grain
  float g = rand(uv * uResolution + fract(uTime * 7.13) * 100.0) - 0.5;
  col += g * uGrain;
  gl_FragColor = vec4(col, 1.0);
}
`;

const HALF = THREE.HalfFloatType;

export const SHADOW_PRESETS = {
  off: null,
  low: { mapSize: 1024, distance: 110, radius: 2 },
  medium: { mapSize: 2048, distance: 180, radius: 2 },
  high: { mapSize: 2048, distance: 280, radius: 2.5 },
  ultra: { mapSize: 4096, distance: 420, radius: 3 },
};

export class RenderSystem {
  constructor(canvas) {
    this.canvas = canvas;
    const renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, alpha: false, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false,
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.autoClear = false;
    this.renderer = renderer;
    this.gl = renderer.getContext();
    this.capabilities = renderer.capabilities;
    this.gpuName = this._gpuName();
    this.softwareGPU = /swiftshader|llvmpipe|software|softpipe|microsoft basic/i.test(this.gpuName);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(80, 1, 0.15, 3000);
    this.vmScene = new THREE.Scene();
    this.vmCamera = new THREE.PerspectiveCamera(60, 1, 0.01, 30);
    this.skyFogScene = null; // set by the sky system (sky without clouds for aerial fog)

    this.quality = {
      renderScale: 1, ao: true, bloom: true, antialias: 'smaa', godrays: true, shadows: 'high', pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    };
    this.env = {
      sunDir: new THREE.Vector3(0.3, 0.5, -0.8).normalize(),
      sunColor: new THREE.Color(1, 0.9, 0.75),
      fogColor: new THREE.Color(0.75, 0.78, 0.82),
      fogDensity: 0.0012,
      fogFalloff: 0.006,
      fogBase: 0,
      fogMax: 0.97,
      exposure: 1.0,
      saturation: 1.05,
      contrast: 1.04,
      tint: new THREE.Color(1, 1, 1),
      raysColor: new THREE.Color(1, 0.85, 0.6),
      raysIntensity: 0.55,
      vignette: 0.35,
      grain: 0.018,
      aoStrength: 0.85,
    };
    this.fx = { damage: 0, lowHealth: 0, flash: 0, aberration: 0.12, scope: 0 };
    this.time = 0;
    this.width = 1;
    this.height = 1;
    this._buildTargets();
    this._buildPasses();
    this.stats = { calls: 0, triangles: 0 };
  }

  _gpuName() {
    try {
      const gl = this.gl;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    } catch {
      return 'unknown';
    }
  }

  _buildTargets() {
    const depthTex = new THREE.DepthTexture(1, 1);
    depthTex.type = THREE.FloatType;
    depthTex.format = THREE.DepthFormat;
    this.rtScene = new THREE.WebGLRenderTarget(1, 1, { type: HALF, depthBuffer: true, depthTexture: depthTex, samples: 0 });
    this.rtComp = new THREE.WebGLRenderTarget(1, 1, { type: HALF, depthBuffer: true });
    this.rtLDR = new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType, depthBuffer: false });
    this.rtRaysA = new THREE.WebGLRenderTarget(1, 1, { type: HALF, depthBuffer: false });
    this.rtRaysB = new THREE.WebGLRenderTarget(1, 1, { type: HALF, depthBuffer: false });
    this.rtSkyFog = new THREE.WebGLRenderTarget(1, 1, { type: HALF, depthBuffer: false });
    // Scope (picture-in-picture) targets.
    const sdt = new THREE.DepthTexture(1, 1);
    sdt.type = THREE.FloatType;
    this.rtScopeScene = new THREE.WebGLRenderTarget(512, 512, { type: HALF, depthBuffer: true, depthTexture: sdt });
    this.rtScope = new THREE.WebGLRenderTarget(512, 512, { type: HALF, depthBuffer: false });
    this.rtScopeSky = new THREE.WebGLRenderTarget(128, 128, { type: HALF, depthBuffer: false });
  }

  _buildPasses() {
    this.compositeMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: COMPOSITE_FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        tColor: { value: null }, tDepth: { value: null }, tAO: { value: null }, tRays: { value: null }, tSkyFog: { value: null },
        uUseAO: { value: 0 }, uUseRays: { value: 0 }, uUseSkyFog: { value: 0 }, uAOStrength: { value: 0.85 },
        uProjInv: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
        uFogColor: { value: new THREE.Color() }, uSunColor: { value: new THREE.Color() }, uSunDir: { value: new THREE.Vector3() },
        uFogDensity: { value: 0.001 }, uFogFalloff: { value: 0.005 }, uFogBase: { value: 0 }, uFogMax: { value: 0.97 },
        uRaysColor: { value: new THREE.Color() },
      },
    });
    this.raysMaskMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: RAYS_MASK_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tDepth: { value: null }, tColor: { value: null }, uSunUv: { value: new THREE.Vector2() }, uAspect: { value: 1 } },
    });
    this.raysBlurMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: RAYS_BLUR_FRAG, depthTest: false, depthWrite: false,
      uniforms: { tInput: { value: null }, uSunUv: { value: new THREE.Vector2() }, uStepScale: { value: 1 }, uDecay: { value: 0.96 } },
    });
    this.finalMat = new THREE.ShaderMaterial({
      vertexShader: QUAD_VERT, fragmentShader: FINAL_FRAG, depthTest: false, depthWrite: false,
      uniforms: {
        tColor: { value: null }, uExposure: { value: 1 }, uSaturation: { value: 1 }, uContrast: { value: 1 }, uTint: { value: new THREE.Color(1, 1, 1) },
        uVignette: { value: 0.3 }, uGrain: { value: 0.02 }, uTime: { value: 0 }, uDamage: { value: 0 }, uLowHealth: { value: 0 },
        uFlash: { value: 0 }, uAberration: { value: 0.1 }, uScope: { value: 0 }, uResolution: { value: new THREE.Vector2(1, 1) },
      },
    });
    this.quad = new FullScreenQuad(null);
    this.gtao = null;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.55, 1.15);
    this.smaa = new SMAAPass();
    this.fxaa = new FXAAPass();
  }

  _ensureGTAO() {
    if (this.gtao) return this.gtao;
    this.gtao = new GTAOPass(this.scene, this.camera, Math.max(1, this.width >> 1), Math.max(1, this.height >> 1), { depthTexture: this.rtScene.depthTexture });
    this.gtao.output = GTAOPass.OUTPUT.Off;
    this.gtao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.5, thickness: 2.0, scale: 1.2, samples: 12, distanceFallOff: 1.0, screenSpaceRadius: false });
    this.gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, radiusExponent: 1, rings: 2, samples: 12 });
    return this.gtao;
  }

  /** Apply graphics settings ({ renderScale, ao, bloom, antialias, godrays, shadows }). */
  setQuality(q) {
    Object.assign(this.quality, q);
    this.renderer.shadowMap.enabled = this.quality.shadows !== 'off';
    this.setSize(this.width, this.height);
  }

  setSize(w, h) {
    this.width = Math.max(1, Math.floor(w));
    this.height = Math.max(1, Math.floor(h));
    const pr = this.quality.pixelRatio;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(this.width, this.height, false);
    const scale = this.quality.renderScale * pr;
    const rw = Math.max(1, Math.round(this.width * scale));
    const rh = Math.max(1, Math.round(this.height * scale));
    this.rw = rw;
    this.rh = rh;
    this.rtScene.setSize(rw, rh);
    this.rtComp.setSize(rw, rh);
    const fw = Math.round(this.width * pr), fh = Math.round(this.height * pr);
    this.rtLDR.setSize(fw, fh);
    this.rtRaysA.setSize(Math.max(1, rw >> 2), Math.max(1, rh >> 2));
    this.rtRaysB.setSize(Math.max(1, rw >> 2), Math.max(1, rh >> 2));
    this.rtSkyFog.setSize(Math.max(1, rw >> 3), Math.max(1, rh >> 3));
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.vmCamera.aspect = this.width / this.height;
    this.vmCamera.updateProjectionMatrix();
    if (this.gtao) this.gtao.setSize(Math.max(1, rw >> 1), Math.max(1, rh >> 1));
    this.bloom.setSize(Math.max(1, rw >> 1), Math.max(1, rh >> 1));
    this.smaa.setSize(fw, fh);
    this.fxaa.setSize(fw, fh);
    this.finalMat.uniforms.uResolution.value.set(fw, fh);
  }

  _setCompositeUniforms(camera, sceneRT, aoTex, raysTex, skyTex) {
    const u = this.compositeMat.uniforms;
    const e = this.env;
    u.tColor.value = sceneRT.texture;
    u.tDepth.value = sceneRT.depthTexture;
    u.tAO.value = aoTex;
    u.uUseAO.value = aoTex ? 1 : 0;
    u.tRays.value = raysTex;
    u.uUseRays.value = raysTex ? 1 : 0;
    u.tSkyFog.value = skyTex;
    u.uUseSkyFog.value = skyTex ? 1 : 0;
    u.uAOStrength.value = e.aoStrength;
    u.uProjInv.value.copy(camera.projectionMatrixInverse);
    u.uCamWorld.value.copy(camera.matrixWorld);
    u.uCamPos.value.setFromMatrixPosition(camera.matrixWorld);
    u.uFogColor.value.copy(e.fogColor);
    u.uSunColor.value.copy(e.sunColor);
    u.uSunDir.value.copy(e.sunDir);
    u.uFogDensity.value = e.fogDensity;
    u.uFogFalloff.value = e.fogFalloff;
    u.uFogBase.value = e.fogBase;
    u.uFogMax.value = e.fogMax;
    u.uRaysColor.value.copy(e.raysColor).multiplyScalar(e.raysIntensity);
  }

  _blit(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.quad.render(this.renderer);
  }

  /**
   * Render the picture-in-picture view for a magnified optic. Returns the texture.
   * Called before render() each frame while aiming with a scope.
   */
  renderScope(scopeCamera, size = 512) {
    const r = this.renderer;
    if (this.rtScopeScene.width !== size) {
      this.rtScopeScene.setSize(size, size);
      this.rtScope.setSize(size, size);
    }
    r.setRenderTarget(this.rtScopeScene);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, false);
    const prevShadow = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false; // reuse this frame's shadow maps
    r.render(this.scene, scopeCamera);
    r.shadowMap.autoUpdate = prevShadow;
    let skyTex = null;
    if (this.skyFogScene) {
      r.setRenderTarget(this.rtScopeSky);
      r.render(this.skyFogScene, scopeCamera);
      skyTex = this.rtScopeSky.texture;
    }
    this._setCompositeUniforms(scopeCamera, this.rtScopeScene, null, null, skyTex);
    this._blit(this.compositeMat, this.rtScope);
    return this.rtScope.texture;
  }

  /** Project the sun direction to screen UV; returns visibility factor (0 when behind the camera). */
  _sunScreen(out) {
    const cam = this.camera;
    const p = this._tmpV || (this._tmpV = new THREE.Vector3());
    p.copy(this.env.sunDir).multiplyScalar(1000).add(cam.position);
    p.project(cam);
    out.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
    const fwd = this._tmpF || (this._tmpF = new THREE.Vector3());
    cam.getWorldDirection(fwd);
    const facing = fwd.dot(this.env.sunDir);
    if (facing <= 0.05) return 0;
    const edge = Math.max(Math.abs(p.x), Math.abs(p.y));
    return Math.min(1, facing * 3) * (1 - THREE.MathUtils.smoothstep(edge, 1.0, 1.6));
  }

  render(dt) {
    const r = this.renderer;
    const q = this.quality;
    this.time += dt;
    this.camera.updateMatrixWorld();

    // 1) World.
    r.setRenderTarget(this.rtScene);
    r.setClearColor(0x000000, 1);
    r.clear(true, true, false);
    r.render(this.scene, this.camera);
    this.stats.calls = r.info.render.calls;
    this.stats.triangles = r.info.render.triangles;

    // 2) Sky colour for aerial fog (low res, no clouds).
    let skyTex = null;
    if (this.skyFogScene) {
      r.setRenderTarget(this.rtSkyFog);
      r.render(this.skyFogScene, this.camera);
      skyTex = this.rtSkyFog.texture;
    }

    // 3) Ambient occlusion.
    let aoTex = null;
    if (q.ao) {
      const g = this._ensureGTAO();
      g.render(r, null, this.rtScene);
      aoTex = g.pdRenderTarget.texture;
    }

    // 4) God rays.
    let raysTex = null;
    if (q.godrays && this.env.raysIntensity > 0) {
      const sunUv = this._sunUv || (this._sunUv = new THREE.Vector2());
      const vis = this._sunScreen(sunUv);
      if (vis > 0.01) {
        const m = this.raysMaskMat.uniforms;
        m.tDepth.value = this.rtScene.depthTexture;
        m.tColor.value = this.rtScene.texture;
        m.uSunUv.value.copy(sunUv);
        m.uAspect.value = this.width / this.height;
        this._blit(this.raysMaskMat, this.rtRaysA);
        const b = this.raysBlurMat.uniforms;
        b.uSunUv.value.copy(sunUv);
        b.tInput.value = this.rtRaysA.texture;
        b.uStepScale.value = 0.9;
        b.uDecay.value = 0.965;
        this._blit(this.raysBlurMat, this.rtRaysB);
        b.tInput.value = this.rtRaysB.texture;
        b.uStepScale.value = 0.35;
        this._blit(this.raysBlurMat, this.rtRaysA);
        raysTex = this.rtRaysA.texture;
        this._raysVis = vis;
      }
    }

    // 5) Composite into rtComp.
    this._setCompositeUniforms(this.camera, this.rtScene, aoTex, raysTex, skyTex);
    if (raysTex) this.compositeMat.uniforms.uRaysColor.value.multiplyScalar(this._raysVis);
    this._blit(this.compositeMat, this.rtComp);

    // 6) Viewmodel on top (own depth).
    r.setRenderTarget(this.rtComp);
    r.clearDepth();
    const prevShadow = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    r.render(this.vmScene, this.vmCamera);
    r.shadowMap.autoUpdate = prevShadow;

    // 7) Bloom (adds onto rtComp).
    if (q.bloom) this.bloom.render(r, null, this.rtComp, dt, false);

    // 8) Tone map + grade.
    const f = this.finalMat.uniforms;
    const e = this.env;
    f.tColor.value = this.rtComp.texture;
    f.uExposure.value = e.exposure;
    f.uSaturation.value = e.saturation;
    f.uContrast.value = e.contrast;
    f.uTint.value.copy(e.tint);
    f.uVignette.value = e.vignette;
    f.uGrain.value = e.grain;
    f.uTime.value = this.time;
    f.uDamage.value = this.fx.damage;
    f.uLowHealth.value = this.fx.lowHealth;
    f.uFlash.value = this.fx.flash;
    f.uAberration.value = this.fx.aberration;
    f.uScope.value = this.fx.scope;
    const aa = q.antialias;
    if (aa === 'smaa') {
      this._blit(this.finalMat, this.rtLDR);
      this.smaa.renderToScreen = true;
      this.smaa.render(r, null, this.rtLDR);
    } else if (aa === 'fxaa') {
      this._blit(this.finalMat, this.rtLDR);
      this.fxaa.renderToScreen = true;
      this.fxaa.render(r, null, this.rtLDR);
    } else {
      this._blit(this.finalMat, null);
    }
  }

  dispose() {
    for (const rt of [this.rtScene, this.rtComp, this.rtLDR, this.rtRaysA, this.rtRaysB, this.rtSkyFog, this.rtScopeScene, this.rtScope, this.rtScopeSky]) rt.dispose();
    this.gtao?.dispose();
    this.bloom.dispose();
    this.smaa.dispose();
    this.fxaa.dispose();
    this.renderer.dispose();
  }
}
