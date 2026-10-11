// Client-side grenade visuals: locally simulated (same physics as the server) and nudged
// toward server snapshot positions; explosions and smoke clouds on 'boom'.
import * as THREE from 'three';
import { stepGrenade } from '/shared/room.js';
import { buildEquipmentModel } from '../models/weapon-models.js';

export class GrenadeVisuals {
  constructor(game) {
    this.game = game;
    this.scene = game.rs.scene;
    this.map = new Map();
  }

  add(m) {
    if (this.map.has(m.id)) return;
    let model = null;
    try {
      model = buildEquipmentModel(m.k === 'smoke' ? 'smoke' : 'frag', { lod: 'tp' });
      model.root.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      this.scene.add(model.root);
    } catch {
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), new THREE.MeshStandardMaterial({ color: 0x3b4430 }));
      model = { root: mesh, dispose() {} };
      this.scene.add(mesh);
    }
    const g = { id: m.id, kind: m.k, x: m.o[0], y: m.o[1], z: m.o[2], vx: m.v[0], vy: m.v[1], vz: m.v[2], rest: false, model, spin: 0, tx: null, bounced: 0, lastBounce: 0 };
    this.map.set(m.id, g);
  }

  /** Snapshot positions: [[id, x, y, z], ...] */
  correct(list) {
    for (const s of list) {
      const g = this.map.get(s[0]);
      if (g) { g.tx = s[1]; g.ty = s[2]; g.tz = s[3]; }
    }
  }

  boom(m) {
    const g = this.map.get(m.id);
    if (g) {
      this.scene.remove(g.model.root);
      g.model.dispose?.();
      this.map.delete(m.id);
    }
    const game = this.game;
    const pos = { x: m.x, y: m.y, z: m.z };
    const cam = game.rs.camera.position;
    const dist = Math.hypot(cam.x - m.x, cam.y - m.y, cam.z - m.z);
    if (m.k === 'smoke') {
      game.effects.smokeCloud(m.x, m.y, m.z);
      game.audio?.playSmoke(pos);
    } else {
      game.effects.explosion(m.x, m.y, m.z);
      game.audio?.playExplosion(pos, { distance: dist });
      if (dist < 40) game.player.addShake(Math.max(0, 1.2 - dist / 30));
      if (dist < 10) game.rs.fx.flash = Math.max(game.rs.fx.flash, 0.5 * (1 - dist / 10));
    }
  }

  update(dt) {
    const col = this.game.world.collision;
    for (const g of this.map.values()) {
      if (!g.rest) {
        const before = g.bounced || 0;
        for (let i = 0; i < 3; i++) stepGrenade(col, g, dt / 3);
        if ((g.bounced || 0) > before && this.game.audio && g.bounced < 5) {
          this.game.audio.playImpact('metal', { x: g.x, y: g.y, z: g.z });
        }
        g.spin += dt * 12;
      }
      if (g.tx !== null && g.tx !== undefined) {
        const k = Math.min(1, dt * 6);
        g.x += (g.tx - g.x) * k; g.y += (g.ty - g.y) * k; g.z += (g.tz - g.z) * k;
      }
      g.model.root.position.set(g.x, g.y, g.z);
      g.model.root.rotation.set(g.spin, g.spin * 0.7, 0);
    }
  }

  clear() {
    for (const g of this.map.values()) { this.scene.remove(g.model.root); g.model.dispose?.(); }
    this.map.clear();
  }
}
