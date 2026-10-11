// Sky, sun (cascaded shadows), ambient light, image-based lighting and viewmodel lighting.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { SunLight } from 'three/addons/lights/SunLight.js';
import { SHADOW_PRESETS } from '../engine/renderer.js';

const DEG = Math.PI / 180;

/** Direction toward the sun from azimuth (deg, 0 = north/-Z, 90 = east/+X) and elevation (deg). */
export function sunDirection(azimuth, elevation, out = new THREE.Vector3()) {
  const a = azimuth * DEG, e = elevation * DEG;
  return out.set(Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)).normalize();
}

function makeSky(env, clouds) {
  const sky = new Sky();
  sky.scale.setScalar(2400);
  const u = sky.material.uniforms;
  u.turbidity.value = env.sky.turbidity;
  u.rayleigh.value = env.sky.rayleigh;
  u.mieCoefficient.value = env.sky.mieCoefficient;
  u.mieDirectionalG.value = env.sky.mieDirectionalG;
  if (u.cloudCoverage) {
    u.cloudCoverage.value = clouds ? env.sky.cloudCoverage : 0;
    u.cloudDensity.value = env.sky.cloudDensity;
    u.cloudElevation.value = 0.55;
    u.cloudScale.value = 0.00022;
    u.cloudSpeed.value = 0.00003;
  }
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  return sky;
}

export class SkySystem {
  /**
   * @param {import('../engine/renderer.js').RenderSystem} rs
   * @param {object} env map environment (shared/world.js GEN[map].env)
   */
  constructor(rs, env) {
    this.rs = rs;
    this.env = env;
    this.sunDir = sunDirection(env.sun.azimuth, env.sun.elevation);
    this.group = new THREE.Group();
    this.group.name = 'sky';
    // Main sky with clouds.
    this.sky = makeSky(env, true);
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    this.group.add(this.sky);
    // Cloudless sky for aerial-perspective fog colour.
    this.fogSky = makeSky(env, false);
    this.fogSky.material.uniforms.sunPosition.value.copy(this.sunDir);
    if (this.fogSky.material.uniforms.showSunDisc) this.fogSky.material.uniforms.showSunDisc.value = 0;
    this.fogScene = new THREE.Scene();
    this.fogScene.add(this.fogSky);

    // Sun with cascaded shadows.
    const sun = new SunLight(new THREE.Color(env.sun.color), env.sun.intensity);
    sun.position.copy(this.sunDir).multiplyScalar(100);
    sun.castShadow = true;
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.04;
    this.sun = sun;
    this.group.add(sun);
    this.hemi = new THREE.HemisphereLight(new THREE.Color(env.hemi.sky), new THREE.Color(env.hemi.ground), env.hemi.intensity);
    this.group.add(this.hemi);

    // Viewmodel lights (camera space).
    this.vmSun = new THREE.DirectionalLight(new THREE.Color(env.sun.color), env.sun.intensity * 0.9);
    this.vmSunTarget = new THREE.Object3D();
    this.vmSun.target = this.vmSunTarget;
    this.vmHemi = new THREE.HemisphereLight(new THREE.Color(env.hemi.sky), new THREE.Color(env.hemi.ground), env.hemi.intensity * 1.6);
    this.vmFill = new THREE.DirectionalLight(0xffffff, 0.6);
    this.vmFill.position.set(-0.5, 0.3, 1);
    this.sunVisibility = 1;
    this._q = new THREE.Quaternion();
    this._v = new THREE.Vector3();
    this.time = 0;
  }

  /** Add to the render system's scenes and generate the environment map. */
  attach() {
    const rs = this.rs;
    rs.scene.add(this.group);
    rs.skyFogScene = this.fogScene;
    rs.vmScene.add(this.vmSun, this.vmSunTarget, this.vmHemi, this.vmFill);
    // Environment lighting from the sky.
    const pmrem = new THREE.PMREMGenerator(rs.renderer);
    const envScene = new THREE.Scene();
    const envSky = makeSky(this.env, true);
    envSky.scale.setScalar(900);
    envSky.material.uniforms.sunPosition.value.copy(this.sunDir);
    if (envSky.material.uniforms.showSunDisc) envSky.material.uniforms.showSunDisc.value = 0;
    envScene.add(envSky);
    this.envRT = pmrem.fromScene(envScene, 0, 1, 2000);
    pmrem.dispose();
    envSky.material.dispose();
    rs.scene.environment = this.envRT.texture;
    // An overcast sky is several times brighter than a clear one, so maps set their own level.
    rs.scene.environmentIntensity = this.env.envIntensity ?? 0.8;
    rs.vmScene.environment = this.envRT.texture;
    rs.vmScene.environmentIntensity = this.env.vmEnvIntensity ?? 1.0;
    // Renderer env settings.
    const e = rs.env;
    e.sunDir.copy(this.sunDir);
    e.sunColor.set(this.env.sun.color);
    e.fogColor.set(this.env.fog.color);
    e.fogDensity = this.env.fog.density;
    e.fogFalloff = this.env.fog.heightFalloff;
    e.fogBase = 0;
    e.skyBlend = this.env.fog.skyBlend ?? 0.85;
    e.exposure = this.env.exposure;
    e.raysColor.set(this.env.sun.color);
    e.raysIntensity = this.env.overcast ? 0.0 : (this.env.sun.elevation < 15 ? 0.7 : 0.45);
    e.saturation = this.env.overcast ? 0.92 : 1.06;
    e.contrast = this.env.overcast ? 1.02 : 1.05;
    e.tint.set(this.env.overcast ? 0xf2f5fa : 0xfff8f0);
  }

  setShadowQuality(name) {
    const p = SHADOW_PRESETS[name];
    this.sun.castShadow = !!p;
    if (!p) return;
    const s = this.sun.shadow;
    if (s.mapSize.x !== p.mapSize) {
      s.mapSize.set(p.mapSize, p.mapSize);
      if (s.map) { s.map.dispose(); s.map = null; }
    }
    s.camera.far = p.distance;
    s.radius = p.radius;
  }

  /** Per-frame: follow the camera, animate clouds, update viewmodel light directions. */
  update(dt, camera, sunVisible = 1) {
    this.time += dt;
    this.sky.position.copy(camera.position);
    this.fogSky.position.copy(camera.position);
    const u = this.sky.material.uniforms;
    if (u.time) u.time.value = this.time;
    // Viewmodel lights in camera space.
    this._q.copy(camera.quaternion).invert();
    this._v.copy(this.sunDir).applyQuaternion(this._q);
    this.vmSun.position.copy(this._v).multiplyScalar(10);
    this.vmSunTarget.position.set(0, 0, 0);
    this.vmHemi.position.set(0, 1, 0).applyQuaternion(this._q);
    // Smoothly dim the viewmodel sun when the player stands in shadow.
    this.sunVisibility += (sunVisible - this.sunVisibility) * Math.min(1, dt * 6);
    this.vmSun.intensity = this.env.sun.intensity * (0.12 + 0.88 * this.sunVisibility) * 0.95;
  }

  dispose() {
    this.rs.scene.remove(this.group);
    this.rs.vmScene.remove(this.vmSun, this.vmSunTarget, this.vmHemi, this.vmFill);
    if (this.rs.skyFogScene === this.fogScene) this.rs.skyFogScene = null;
    this.sky.material.dispose();
    this.fogSky.material.dispose();
    this.envRT?.dispose();
    this.sun.dispose();
  }
}
