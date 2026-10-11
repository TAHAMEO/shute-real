// Character movement shared by the local player (client) and bots (game room).
import { PLAYER, STANCE } from './constants.js';

export function createBody(x = 0, y = 0, z = 0) {
  return {
    x, y, z,
    vx: 0, vy: 0, vz: 0,
    onGround: true,
    stance: STANCE.STAND,
    surface: 'grass',
    fallStartY: y,
    airTime: 0,
    sprinting: false,
    moveSpeed: 0,
  };
}

const _p = { x: 0, y: 0, z: 0 };
const _n = { x: 0, y: 1, z: 0 };

export function stanceHeight(stance) {
  return PLAYER.height[stance] ?? PLAYER.height[0];
}

export function eyeHeight(stance) {
  return PLAYER.eye[stance] ?? PLAYER.eye[0];
}

/** Can the body change to `stance` here (enough headroom)? */
export function canStance(world, b, stance) {
  if (stance >= b.stance) return true; // going lower is always possible
  const ceil = world.collision.ceilingHeight(b.x, b.z, b.y + 0.2, PLAYER.radius);
  return ceil - b.y >= stanceHeight(stance) + 0.02;
}

/**
 * Advance a body by dt.
 * input: { fwd, right (-1..1), jump (bool, edge), sprint (bool), stance (desired), yaw, ads (bool), speedMult }
 * Returns an events object (reused): { jumped, landed, impact, fallDistance, stepped }
 */
const events = { jumped: false, landed: false, impact: 0, fallDistance: 0, blocked: false };
export function stepBody(world, b, input, dt) {
  events.jumped = false;
  events.landed = false;
  events.impact = 0;
  events.fallDistance = 0;
  events.blocked = false;
  const col = world.collision;
  const terrain = world.terrain;

  // Stance.
  let want = input.stance ?? b.stance;
  if (want !== b.stance && canStance(world, b, want)) b.stance = want;

  // Jump from crouch/prone stands up instead.
  if (input.jump && b.onGround) {
    if (b.stance !== STANCE.STAND) {
      if (canStance(world, b, STANCE.STAND)) b.stance = STANCE.STAND;
    } else {
      b.vy = PLAYER.jumpVelocity;
      b.onGround = false;
      b.fallStartY = b.y;
      events.jumped = true;
    }
  }

  // Desired horizontal velocity.
  let fwd = input.fwd || 0;
  let right = input.right || 0;
  const len = Math.sqrt(fwd * fwd + right * right);
  if (len > 1) { fwd /= len; right /= len; }
  const S = PLAYER.speed;
  let speed;
  const sprint = !!input.sprint && fwd > 0.3 && b.stance === STANCE.STAND && !input.ads;
  if (b.stance === STANCE.PRONE) speed = S.prone;
  else if (b.stance === STANCE.CROUCH) speed = S.crouch;
  else speed = sprint ? S.sprint : S.walk;
  if (input.ads && b.stance !== STANCE.PRONE) speed = Math.min(speed, b.stance === STANCE.CROUCH ? S.crouch * 0.8 : S.ads);
  speed *= input.speedMult ?? 1;
  b.sprinting = sprint && len > 0.1;
  // Moving backwards / sideways is slower.
  const backMul = fwd < 0 ? 0.72 : 1;
  const sy = Math.sin(input.yaw), cy = Math.cos(input.yaw);
  // forward = (-sin, 0, -cos), right = (cos, 0, -sin)
  let wx = (-sy * fwd + cy * right * 0.92) * speed * backMul;
  let wz = (-cy * fwd - sy * right * 0.92) * speed * backMul;

  // Acceleration.
  if (b.onGround) {
    const k = Math.min(1, (len > 0.05 ? 11 : 13) * dt);
    b.vx += (wx - b.vx) * k;
    b.vz += (wz - b.vz) * k;
  } else {
    const k = Math.min(1, 1.6 * dt);
    if (len > 0.05) {
      b.vx += (wx - b.vx) * k;
      b.vz += (wz - b.vz) * k;
    }
    b.airTime += dt;
  }

  // Slopes: can't walk up terrain steeper than maxSlope; slide down it.
  if (b.onGround) {
    terrain.normalAt(b.x, b.z, _n);
    const groundIsTerrain = b.y - terrain.heightAt(b.x, b.z) < 0.08;
    if (groundIsTerrain && _n.y < PLAYER.maxSlope) {
      const hl = Math.sqrt(_n.x * _n.x + _n.z * _n.z) || 1;
      const dx = _n.x / hl, dz = _n.z / hl; // downhill direction
      const into = b.vx * dx + b.vz * dz;
      if (into < 0) { b.vx -= into * dx; b.vz -= into * dz; }
      const slide = (PLAYER.maxSlope - _n.y) * 22;
      b.vx += dx * slide * dt;
      b.vz += dz * slide * dt;
    }
  }

  // Gravity.
  if (!b.onGround) b.vy -= PLAYER.gravity * dt;
  else b.vy = Math.min(b.vy, 0);

  const height = stanceHeight(b.stance);
  const step = PLAYER.stepHeight;
  const hspeed = Math.sqrt(b.vx * b.vx + b.vz * b.vz);
  const n = Math.min(6, Math.max(1, Math.ceil((hspeed * dt) / 0.25), Math.ceil((Math.abs(b.vy) * dt) / 0.3)));
  const sdt = dt / n;
  const startX = b.x, startZ = b.z;
  for (let i = 0; i < n; i++) {
    _p.x = b.x + b.vx * sdt;
    _p.z = b.z + b.vz * sdt;
    _p.y = b.y + b.vy * sdt;
    // Horizontal collisions (obstacles lower than the step height are climbed).
    const support = b.onGround ? b.y : _p.y;
    _p.y = support;
    if (col.resolveBody(_p, PLAYER.radius, height, step)) events.blocked = true;
    _p.y = b.y + b.vy * sdt;
    // Keep inside the map.
    const lim = world.half - 6;
    if (_p.x < -lim) _p.x = -lim; else if (_p.x > lim) _p.x = lim;
    if (_p.z < -lim) _p.z = -lim; else if (_p.z > lim) _p.z = lim;

    // Vertical: ground support and ceilings.
    const maxSupport = (b.onGround ? b.y : Math.max(b.y, _p.y)) + step;
    const ground = col.groundHeight(_p.x, _p.z, maxSupport, PLAYER.radius * 0.55);
    if (_p.y <= ground) {
      if (!b.onGround) {
        events.landed = true;
        events.impact = Math.max(events.impact, -b.vy);
        events.fallDistance = Math.max(0, b.fallStartY - ground);
      }
      _p.y = ground;
      b.vy = 0;
      b.onGround = true;
      b.airTime = 0;
    } else if (b.onGround && b.vy <= 0 && _p.y - ground < 0.55) {
      _p.y = ground; // stick to the ground when walking down slopes and stairs
    } else {
      if (b.onGround) { b.fallStartY = b.y; }
      b.onGround = false;
    }
    if (b.vy > 0) {
      const ceil = col.ceilingHeight(_p.x, _p.z, b.y + 0.1, PLAYER.radius);
      if (_p.y + height > ceil) { _p.y = Math.max(b.y, ceil - height); b.vy = 0; }
    }
    b.x = _p.x; b.y = _p.y; b.z = _p.z;
    if (b.onGround) b.surface = col.groundMat === 'terrain' ? world.surfaceAt(b.x, b.z) : col.groundMat;
  }
  // Effective velocity after collisions (so blocked movement doesn't build up speed).
  if (dt > 0) {
    const ex = (b.x - startX) / dt, ez = (b.z - startZ) / dt;
    if (events.blocked) { b.vx = ex; b.vz = ez; }
    b.moveSpeed = Math.sqrt(ex * ex + ez * ez);
  }
  return events;
}

/** Fall damage for a landing (meters fallen). */
export function fallDamage(dist) {
  if (dist < 4.5) return 0;
  return Math.min(150, (dist - 4.5) * 14);
}
