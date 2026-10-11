// Chunked LOD terrain mesh with skirts and a splatting PBR material (grass / forest floor /
// dirt roads / gravel / triplanar rock), plus world data textures used by grass and minimap.
import * as THREE from 'three';
import { GLSL_NOISE } from '../engine/glsl.js';
import { TERRAIN_RECIPES } from './surface-recipes.js';
import { GROUND } from '/shared/world.js';

const CHUNK_CELLS = 40;
const LOD_STEPS = [1, 2, 4, 8];

/** Build an RGBA8 ground mask texture: R road, G cleared, B forest floor, A grass density. */
export function buildGroundTexture(world) {
  const n = world.groundN;
  const data = new Uint8Array(n * n * 4);
  const cell = world.groundCell;
  // Forest density from tree positions (splat discs).
  const forest = new Float32Array(n * n);
  const half = world.half;
  for (const t of world.trees) {
    const cx = (t.x + half) / cell, cz = (t.z + half) / cell;
    const r = 3.5 * t.scale / cell + 1;
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(n - 1, Math.ceil(cx + r));
    const z0 = Math.max(0, Math.floor(cz - r)), z1 = Math.min(n - 1, Math.ceil(cz + r));
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - cx, z - cz) / r;
        if (d < 1) forest[z * n + x] += (1 - d * d) * 0.7;
      }
    }
  }
  const t = world.terrain;
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const i = z * n + x;
      const g = world.ground[i];
      const road = g === GROUND.DIRT_ROAD ? 1 : 0;
      const clear = g === GROUND.CLEARED ? 1 : 0;
      const f = Math.min(1, forest[i]);
      const wx = -half + (x + 0.5) * cell, wz = -half + (z + 0.5) * cell;
      const flat = t.flatness(wx, wz);
      let grass = 1 - road - clear * 0.85 - f * 0.55;
      grass *= Math.max(0, Math.min(1, (flat - 0.74) / 0.12));
      data[i * 4] = road * 255;
      data[i * 4 + 1] = clear * 255;
      data[i * 4 + 2] = Math.round(f * 255);
      data[i * 4 + 3] = Math.round(Math.max(0, Math.min(1, grass)) * 255);
    }
  }
  // One box blur pass for softer transitions.
  const out = new Uint8Array(data.length);
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      for (let c = 0; c < 4; c++) {
        let s = 0, k = 0;
        for (let dz = -1; dz <= 1; dz++) {
          const zz = z + dz;
          if (zz < 0 || zz >= n) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= n) continue;
            s += data[(zz * n + xx) * 4 + c]; k++;
          }
        }
        out[(z * n + x) * 4 + c] = Math.round(s / k);
      }
    }
  }
  const tex = new THREE.DataTexture(out, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  tex.userData.data = out;
  tex.userData.n = n;
  return tex;
}

/** R32F texture of the terrain heights (sampled with texelFetch). */
export function buildHeightTexture(terrain) {
  const tex = new THREE.DataTexture(terrain.heights, terrain.n, terrain.n, THREE.RedFormat, THREE.FloatType);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

function makeTerrainMaterial(world, baker, groundTex, env) {
  const tex = {};
  for (const [k, r] of Object.entries(TERRAIN_RECIPES)) tex[k] = { ...baker.bake(r), tile: r.tile };
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0 });
  const uniforms = {
    tGrass: { value: tex.grass.map }, tGrassN: { value: tex.grass.normalMap },
    tDirt: { value: tex.dirt.map }, tDirtN: { value: tex.dirt.normalMap },
    tRock: { value: tex.rock.map }, tRockN: { value: tex.rock.normalMap },
    tForest: { value: tex.forest.map }, tForestN: { value: tex.forest.normalMap },
    tGravel: { value: tex.gravel.map }, tGravelN: { value: tex.gravel.normalMap },
    tGround: { value: groundTex },
    uGround: { value: new THREE.Vector4(world.half, world.size, 0, 0) },
    uTiles: { value: new THREE.Vector4(1 / tex.grass.tile, 1 / tex.dirt.tile, 1 / tex.rock.tile, 1 / tex.forest.tile) },
    uGravelTile: { value: 1 / tex.gravel.tile },
    uGrassTint: { value: new THREE.Color(env.ground.grass) },
    uGrassTint2: { value: new THREE.Color(env.ground.grass2) },
    uDirtTint: { value: new THREE.Color(env.ground.dirt) },
    uRockTint: { value: new THREE.Color(env.ground.rock) },
    uForestTint: { value: new THREE.Color(env.ground.forest) },
    uAlpine: { value: world.mapId === 'ridge' ? 1 : 0 },
  };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNormal = normalize(mat3(modelMatrix) * objectNormal);');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vWPos;
        varying vec3 vWNormal;
        uniform sampler2D tGrass, tGrassN, tDirt, tDirtN, tRock, tRockN, tForest, tForestN, tGravel, tGravelN, tGround;
        uniform vec4 uGround;
        uniform vec4 uTiles;
        uniform float uGravelTile;
        uniform vec3 uGrassTint, uGrassTint2, uDirtTint, uRockTint, uForestTint;
        uniform float uAlpine;
        ${GLSL_NOISE}
        vec3 gTerrainN;
        float gTerrainRough;
        // Two-scale sampling breaks up visible tiling.
        vec4 tri(sampler2D t, vec2 uv) {
          vec4 a = texture2D(t, uv);
          vec4 b = texture2D(t, uv * 0.273 + vec2(0.31, 0.77));
          return mix(a, b, 0.35);
        }
        vec3 nrm(sampler2D t, vec2 uv) {
          vec3 a = texture2D(t, uv).xyz * 2.0 - 1.0;
          vec3 b = texture2D(t, uv * 0.273 + vec2(0.31, 0.77)).xyz * 2.0 - 1.0;
          return normalize(mix(a, b, 0.35));
        }
      `)
      .replace('#include <map_fragment>', `
        {
          vec3 N = normalize(vWNormal);
          vec2 w = vWPos.xz;
          float macro = vfbm(w * 0.0045) ;
          float macro2 = vfbm(w * 0.021 + 13.0);
          vec2 guv = (w + uGround.x) / uGround.y;
          vec2 jit = vec2(vnoise(w * 0.35), vnoise(w * 0.35 + 7.0)) - 0.5;
          vec4 gm = texture2D(tGround, guv + jit * (3.0 / uGround.y));
          float slope = 1.0 - N.y;
          float wRock = smoothstep(0.2, 0.36, slope + (macro2 - 0.5) * 0.16);
          float wRoad = smoothstep(0.25, 0.7, gm.r + (macro2 - 0.5) * 0.25);
          float wClear = smoothstep(0.25, 0.7, gm.g + (macro2 - 0.5) * 0.3) * 0.75;
          float wForest = smoothstep(0.15, 0.7, gm.b) * (1.0 - wRoad);
          // Patches of bare soil in open grass.
          float bare = smoothstep(0.62, 0.78, macro2 * 0.7 + macro * 0.5) * 0.45;
          vec2 uvG = w * uTiles.x, uvD = w * uTiles.y, uvF = w * uTiles.w, uvV = w * uGravelTile;
          vec4 grass = tri(tGrass, uvG);
          vec3 grassN = nrm(tGrassN, uvG);
          grass.rgb *= mix(uGrassTint, uGrassTint2, smoothstep(0.35, 0.7, macro)) * 2.4;
          vec4 base = grass;
          vec3 baseN = grassN;
          if (uAlpine > 0.5) {
            vec4 gv = tri(tGravel, uvV);
            float g = smoothstep(0.35, 0.65, macro2 + slope * 1.2);
            base = mix(base, gv, g);
            baseN = normalize(mix(baseN, nrm(tGravelN, uvV), g));
          }
          vec4 forest = tri(tForest, uvF);
          forest.rgb *= uForestTint * 2.6;
          base = mix(base, forest, wForest);
          baseN = normalize(mix(baseN, nrm(tForestN, uvF), wForest));
          vec4 dirt = tri(tDirt, uvD);
          dirt.rgb *= uDirtTint * 2.0;
          float wDirt = max(max(wRoad, wClear), bare * (1.0 - wForest));
          base = mix(base, dirt, wDirt);
          baseN = normalize(mix(baseN, nrm(tDirtN, uvD), wDirt));
          // Triplanar rock on steep slopes.
          if (wRock > 0.001) {
            vec3 an = abs(N);
            vec3 bw = pow(an, vec3(4.0));
            bw /= (bw.x + bw.y + bw.z);
            float tr = uTiles.z;
            vec4 rx = texture2D(tRock, vWPos.zy * tr);
            vec4 ry = texture2D(tRock, vWPos.xz * tr);
            vec4 rz = texture2D(tRock, vWPos.xy * tr);
            vec4 rock = rx * bw.x + ry * bw.y + rz * bw.z;
            rock.rgb *= uRockTint * 1.6 * (0.85 + macro * 0.3);
            vec3 nx = texture2D(tRockN, vWPos.zy * tr).xyz * 2.0 - 1.0;
            vec3 ny = texture2D(tRockN, vWPos.xz * tr).xyz * 2.0 - 1.0;
            vec3 nz = texture2D(tRockN, vWPos.xy * tr).xyz * 2.0 - 1.0;
            // Whiteout triplanar normal blend (planes: X->zy, Y->xz, Z->xy).
            nx = vec3(nx.xy + N.zy, abs(nx.z) * N.x);
            ny = vec3(ny.xy + N.xz, abs(ny.z) * N.y);
            nz = vec3(nz.xy + N.xy, abs(nz.z) * N.z);
            vec3 rockWN = normalize(nx.zyx * bw.x + ny.xzy * bw.y + nz.xyz * bw.z);
            base = mix(base, rock, wRock);
            // Convert planar normals to world space and mix with rock.
            vec3 T = normalize(vec3(1.0, 0.0, 0.0) - N * N.x);
            vec3 B = normalize(vec3(0.0, 0.0, 1.0) - N * N.z);
            vec3 planarWN = normalize(T * baseN.x + B * baseN.y + N * baseN.z);
            gTerrainN = normalize(mix(planarWN, rockWN, wRock));
          } else {
            vec3 T = normalize(vec3(1.0, 0.0, 0.0) - N * N.x);
            vec3 B = normalize(vec3(0.0, 0.0, 1.0) - N * N.z);
            gTerrainN = normalize(T * baseN.x + B * baseN.y + N * baseN.z);
          }
          // Large-scale brightness variation.
          base.rgb *= 0.86 + macro * 0.26;
          diffuseColor.rgb *= base.rgb;
          gTerrainRough = base.a;
        }
      `)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = gTerrainRough;')
      .replace('#include <normal_fragment_maps>', 'normal = normalize((viewMatrix * vec4(gTerrainN, 0.0)).xyz);');
  };
  mat.customProgramCacheKey = () => 'terrain-splat-v1';
  mat.userData.uniforms = uniforms;
  return mat;
}

export class TerrainMesh {
  constructor(world, baker, env, opts = {}) {
    this.world = world;
    this.terrain = world.terrain;
    this.group = new THREE.Group();
    this.group.name = 'terrain';
    this.groundTex = opts.groundTex || buildGroundTexture(world);
    this.heightTex = opts.heightTex || buildHeightTexture(world.terrain);
    this.material = makeTerrainMaterial(world, baker, this.groundTex, env);
    this.chunks = [];
    this.castShadow = true;
    this.lodScale = 1;
    this._build();
  }

  _build() {
    const t = this.terrain;
    const nChunks = Math.ceil(t.res / CHUNK_CELLS);
    for (let cz = 0; cz < nChunks; cz++) {
      for (let cx = 0; cx < nChunks; cx++) {
        const ix0 = cx * CHUNK_CELLS, iz0 = cz * CHUNK_CELLS;
        const cells = Math.min(CHUNK_CELLS, t.res - ix0, t.res - iz0);
        const mesh = new THREE.Mesh(this._geometry(ix0, iz0, cells, LOD_STEPS[LOD_STEPS.length - 1]), this.material);
        mesh.receiveShadow = true;
        mesh.castShadow = this.castShadow;
        mesh.matrixAutoUpdate = false;
        const centerX = -t.half + (ix0 + cells / 2) * t.cell;
        const centerZ = -t.half + (iz0 + cells / 2) * t.cell;
        const chunk = { mesh, ix0, iz0, cells, lod: LOD_STEPS.length - 1, geos: [], cx: centerX, cz: centerZ, size: cells * t.cell };
        chunk.geos[chunk.lod] = mesh.geometry;
        this.chunks.push(chunk);
        this.group.add(mesh);
      }
    }
  }

  _geometry(ix0, iz0, cells, step) {
    const t = this.terrain;
    const n = Math.max(1, Math.floor(cells / step));
    const vertsPerSide = n + 1;
    const skirtVerts = 4 * vertsPerSide;
    const count = vertsPerSide * vertsPerSide + skirtVerts;
    const pos = new Float32Array(count * 3);
    const nor = new Float32Array(count * 3);
    const nrm = { x: 0, y: 1, z: 0 };
    let k = 0;
    const put = (ix, iz, dy) => {
      const x = -t.half + ix * t.cell, z = -t.half + iz * t.cell;
      pos[k * 3] = x; pos[k * 3 + 1] = t.h(ix, iz) + dy; pos[k * 3 + 2] = z;
      t.normalAt(x, z, nrm);
      nor[k * 3] = nrm.x; nor[k * 3 + 1] = nrm.y; nor[k * 3 + 2] = nrm.z;
      return k++;
    };
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) put(ix0 + i * step, iz0 + j * step, 0);
    const idx = [];
    const V = (i, j) => j * vertsPerSide + i;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const a = V(i, j), b = V(i + 1, j), c = V(i, j + 1), d = V(i + 1, j + 1);
        // Same diagonal as shared/terrain.js heightAt(): triangles (00, 01, 11) and (00, 11, 10).
        idx.push(a, c, d, a, d, b);
      }
    }
    // Skirts hide cracks between LOD levels.
    const depth = 0.6 + step * t.cell * 0.5;
    const edge = (list) => {
      const start = k;
      for (const [i, j] of list) put(ix0 + i * step, iz0 + j * step, -depth);
      for (let e = 0; e < list.length - 1; e++) {
        const [i0, j0] = list[e], [i1, j1] = list[e + 1];
        const top0 = V(i0, j0), top1 = V(i1, j1), bot0 = start + e, bot1 = start + e + 1;
        idx.push(top0, bot0, top1, top1, bot0, bot1);
        idx.push(top0, top1, bot0, top1, bot1, bot0); // double sided
      }
    };
    const row = (fn) => Array.from({ length: n + 1 }, (_, q) => fn(q));
    edge(row((q) => [q, 0]));
    edge(row((q) => [q, n]));
    edge(row((q) => [0, q]));
    edge(row((q) => [n, q]));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, k * 3), 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, k * 3), 3));
    g.setIndex(idx);
    g.computeBoundingSphere();
    g.computeBoundingBox();
    return g;
  }

  setCastShadow(on) {
    this.castShadow = on;
    for (const c of this.chunks) c.mesh.castShadow = on;
  }

  /** Choose LODs from the camera position (call every few frames). */
  update(camera) {
    const px = camera.position.x, pz = camera.position.z;
    const cell = this.terrain.cell;
    const s = this.lodScale;
    for (const c of this.chunks) {
      const dx = Math.max(0, Math.abs(px - c.cx) - c.size / 2);
      const dz = Math.max(0, Math.abs(pz - c.cz) - c.size / 2);
      const d = Math.sqrt(dx * dx + dz * dz) / (cell * 2) / s; // normalised to 2 m cells
      const lod = d < 120 ? 0 : d < 260 ? 1 : d < 520 ? 2 : 3;
      if (lod !== c.lod) {
        if (!c.geos[lod]) c.geos[lod] = this._geometry(c.ix0, c.iz0, c.cells, LOD_STEPS[lod]);
        c.mesh.geometry = c.geos[lod];
        c.lod = lod;
      }
    }
  }

  dispose() {
    for (const c of this.chunks) for (const g of c.geos) g?.dispose();
    this.material.dispose();
    this.groundTex.dispose();
    this.heightTex.dispose();
  }
}
