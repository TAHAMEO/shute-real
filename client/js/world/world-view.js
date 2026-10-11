// Builds and updates every visual part of a world: sky + lights, terrain, grass, structures,
// vegetation and rocks. Vegetation/rocks come from their own modules (loaded lazily).
import * as THREE from 'three';
import { TextureBaker } from '../engine/texture-baker.js';
import { SkySystem } from './sky.js';
import { TerrainMesh, buildGroundTexture, buildHeightTexture } from './terrain-mesh.js';
import { GrassSystem } from './grass.js';
import { StructureMeshes } from './structures-mesh.js';

const yieldFrame = () => new Promise((r) => setTimeout(r, 0));

export class WorldView {
  /**
   * @param {import('../engine/renderer.js').RenderSystem} rs
   * @param {import('/shared/world.js').World} world
   */
  constructor(rs, world) {
    this.rs = rs;
    this.world = world;
    this.env = world.env;
    this.group = new THREE.Group();
    this.group.name = 'world';
    this.time = 0;
    this.quality = 'high';
    this.ready = false;
    this._lodTimer = 0;
    this._sunCheck = 0;
    this.sunVisible = 1;
  }

  async build(onProgress = () => {}, graphics = {}) {
    const rs = this.rs;
    const world = this.world;
    onProgress(0.05, 'Mixing materials');
    this.baker = rs.baker || (rs.baker = new TextureBaker(rs.renderer));
    await yieldFrame();
    onProgress(0.15, 'Building sky');
    this.sky = new SkySystem(rs, this.env);
    this.sky.attach();
    await yieldFrame();
    onProgress(0.25, 'Shaping terrain');
    const groundTex = buildGroundTexture(world);
    const heightTex = buildHeightTexture(world.terrain);
    this.terrain = new TerrainMesh(world, this.baker, this.env, { groundTex, heightTex });
    this.group.add(this.terrain.group);
    await yieldFrame();
    onProgress(0.4, 'Planting grass');
    this.grass = new GrassSystem(world, heightTex, groundTex, this.env);
    this.grass.setSunDir(this.sky.sunDir);
    this.group.add(this.grass.group);
    await yieldFrame();
    onProgress(0.5, 'Raising structures');
    this.structures = new StructureMeshes(world, this.baker);
    this.group.add(this.structures.group);
    await yieldFrame();
    onProgress(0.62, 'Growing forests');
    if (graphics.vegetation !== false) try {
      const veg = await import('./vegetation.js');
      this.vegetation = new veg.VegetationSystem({ renderer: rs.renderer, scene: rs.scene, quality: graphics.treeDetail || 'high' });
      await this.vegetation.build({ trees: world.trees, bushes: world.bushes });
      if (this.vegetation.setWind) this.vegetation.setWind(this.env.wind ?? 0.5, 0.8, 0.6);
    } catch (e) {
      console.warn('Vegetation unavailable:', e);
      this.vegetation = null;
    }
    await yieldFrame();
    onProgress(0.82, 'Placing rocks');
    if (graphics.vegetation !== false) try {
      const rocks = await import('./rocks.js');
      this.rocks = new rocks.RockSystem({ scene: rs.scene, quality: graphics.treeDetail || 'high' });
      if (this.env.rockTint) this.rocks.uniforms.uRockMul.value.set(this.env.rockTint);
      this.rocks.build(world.rocks);
    } catch (e) {
      console.warn('Rocks unavailable:', e);
      this.rocks = null;
    }
    rs.scene.add(this.group);
    this.setQuality(graphics);
    onProgress(1, 'Ready');
    this.ready = true;
  }

  /** graphics settings object from client/js/settings.js */
  setQuality(g = {}) {
    const shadows = g.shadows || 'high';
    this.sky?.setShadowQuality(shadows);
    this.terrain?.setCastShadow(shadows === 'high' || shadows === 'ultra');
    const level = g.treeDetail || 'high';
    if (this.grass) {
      const density = g.grassDensity ?? 0.8;
      this.grass.setQuality(level, density > 0 ? Math.min(1.2, density / 0.8) : 0);
    }
    this.vegetation?.setQuality?.(level);
    if (g.viewDistance) {
      this.rs.camera.far = Math.max(600, g.viewDistance * 1.25);
      this.rs.camera.updateProjectionMatrix();
      if (this.terrain) this.terrain.lodScale = g.viewDistance / 1600;
    }
  }

  /** Is the sun visible from a point (for viewmodel lighting)? */
  sunVisibleFrom(pos) {
    const d = this.sky.sunDir;
    const hit = this.world.collision.raycast(pos.x, pos.y, pos.z, d.x, d.y, d.z, 120);
    return hit ? 0 : 1;
  }

  update(dt, camera) {
    if (!this.ready) return;
    this.time += dt;
    this._sunCheck -= dt;
    if (this._sunCheck <= 0) {
      this._sunCheck = 0.15;
      this.sunVisible = this.sunVisibleFrom(camera.position);
    }
    this.sky.update(dt, camera, this.sunVisible);
    this._lodTimer -= dt;
    if (this._lodTimer <= 0) {
      this._lodTimer = 0.25;
      this.terrain.update(camera);
    }
    this.grass.update(camera, this.time);
    this.structures.update(dt);
    this.vegetation?.update(camera, this.time);
    this.rocks?.update?.(camera);
  }

  dispose() {
    this.rs.scene.remove(this.group);
    this.sky?.dispose();
    this.terrain?.dispose();
    this.grass?.dispose();
    this.structures?.dispose();
    this.vegetation?.dispose();
    this.rocks?.dispose();
  }
}
