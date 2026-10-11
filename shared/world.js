// Deterministic world generation: terrain shaping, roads, structures, vegetation, rocks,
// spawn points and collision. Runs identically on the server and in every client.
import { RNG } from './random.js';
import { SimplexNoise, smoothstep, clamp } from './noise.js';
import { generateBaseTerrain } from './terrain.js';
import { CollisionWorld } from './collision.js';
import { buildStructure, MATERIALS } from './structures.js';
import { dsin, dcos, datan2, PI, TWO_PI } from './dmath.js';

// Tree trunk dimensions must match client/js/world/vegetation.js TREE_SPECIES.
export const TREE_DIMS = {
  pine: { trunkRadius: 0.25, height: 20, trunkTop: 0.6 },
  araucaria: { trunkRadius: 0.3, height: 22, trunkTop: 0.7 },
  spruce: { trunkRadius: 0.22, height: 16, trunkTop: 0.35 },
  birch: { trunkRadius: 0.16, height: 14, trunkTop: 0.55 },
  oak: { trunkRadius: 0.35, height: 13, trunkTop: 0.4 },
  dead: { trunkRadius: 0.2, height: 11, trunkTop: 0.8 },
};

export const GROUND = { NATURAL: 0, DIRT_ROAD: 1, GRAVEL: 2, CLEARED: 3 };

// ------------------------------------------------------------------------------------------
// Map generation parameters
// ------------------------------------------------------------------------------------------
const GEN = {
  valley: {
    seed: 7331,
    size: 1600,
    res: 800,
    playRadius: 390,
    terrain: {
      base: 0,
      hills: { amp: 26, scale: 0.0023, octaves: 5 },
      ridges: { amp: 10, scale: 0.0032 },
      detail: { amp: 0.9, scale: 0.04 },
      mountains: { amp: 270, scale: 0.0016, start: 0.5, full: 0.97 },
      playRadius: 390,
      flattenPlay: 0.4,
    },
    bumps: [
      [235, -175, 150, 24], // radio hill
      [-300, -40, 120, 12],
      [40, 300, 140, -6],
    ],
    trees: {
      cell: 9,
      forestScale: 0.0042,
      forestBias: -0.08,
      openDensity: 0.05,
      species: (h, rng) => rng.weighted([['pine', 6], ['araucaria', 3], ['spruce', 1.5], ['birch', 0.7], ['dead', 0.25]]),
      scale: [0.75, 1.2],
      maxSlope: 0.72,
    },
    bushes: { cell: 4.2, density: 0.32, species: (rng) => rng.weighted([['shrub', 4], ['juniper', 3], ['fern', 1.5]]) },
    rocks: { boulderClusters: 70, clusterSize: [2, 6], boulderScale: [0.9, 3.4], cliffSlope: 0.66, spires: 0.0, mountainRocks: 420 },
    roadWidth: 5,
    env: {
      sun: { elevation: 9, azimuth: 248, color: '#ffd2a0', intensity: 3.4 },
      sky: { turbidity: 5.5, rayleigh: 2.4, mieCoefficient: 0.007, mieDirectionalG: 0.86, cloudCoverage: 0.32, cloudDensity: 0.45 },
      fog: { color: '#cdb995', density: 0.00048, heightFalloff: 0.006 },
      hemi: { sky: '#aebfe0', ground: '#6b5a3c', intensity: 0.95 },
      exposure: 1.12,
      grass: { base: '#6a7a2a', tip: '#d9c27a', dryness: 0.55, height: 0.5, density: 1.0 },
      ground: { grass: '#6a6a2e', grass2: '#837a3c', dirt: '#7e6447', rock: '#8e8a82', forest: '#4f4a2c' },
      ambient: 'valley',
      wind: 0.55,
    },
  },
  outpost: {
    seed: 4242,
    size: 1200,
    res: 800,
    playRadius: 270,
    terrain: {
      base: 0,
      hills: { amp: 13, scale: 0.0032, octaves: 5 },
      ridges: null,
      detail: { amp: 0.7, scale: 0.04 },
      mountains: { amp: 150, scale: 0.0024, start: 0.55, full: 0.97 },
      playRadius: 270,
      flattenPlay: 0.55,
    },
    bumps: [[-20, 0, 120, -3]],
    trees: {
      cell: 7.6,
      forestScale: 0.006,
      forestBias: 0.1,
      openDensity: 0.03,
      species: (h, rng) => rng.weighted([['birch', 4], ['oak', 3], ['spruce', 4], ['pine', 2]]),
      scale: [0.75, 1.15],
      maxSlope: 0.7,
      clearRadius: 130,
    },
    bushes: { cell: 3.6, density: 0.45, species: (rng) => rng.weighted([['shrub', 4], ['fern', 4], ['juniper', 1]]) },
    rocks: { boulderClusters: 30, clusterSize: [1, 4], boulderScale: [0.7, 2.2], cliffSlope: 0.66, spires: 0.0, mountainRocks: 260 },
    roadWidth: 5.5,
    env: {
      sun: { elevation: 24, azimuth: 120, color: '#fff0d8', intensity: 3.6 },
      sky: { turbidity: 4, rayleigh: 1.8, mieCoefficient: 0.005, mieDirectionalG: 0.82, cloudCoverage: 0.38, cloudDensity: 0.5 },
      fog: { color: '#c2ccc8', density: 0.0011, heightFalloff: 0.008 },
      hemi: { sky: '#b9cdf0', ground: '#4d4a32', intensity: 0.9 },
      exposure: 1.08,
      grass: { base: '#4d6622', tip: '#a4b052', dryness: 0.25, height: 0.46, density: 1.0 },
      ground: { grass: '#4c5a24', grass2: '#5d6a2c', dirt: '#6d5a42', rock: '#7d7a72', forest: '#3e3a26' },
      ambient: 'outpost',
      wind: 0.35,
    },
  },
  ridge: {
    seed: 9001,
    size: 2000,
    res: 800,
    playRadius: 470,
    terrain: {
      base: 0,
      hills: { amp: 30, scale: 0.0021, octaves: 6 },
      ridges: { amp: 26, scale: 0.0042 },
      detail: { amp: 1.6, scale: 0.03 },
      mountains: { amp: 420, scale: 0.0019, start: 0.46, full: 0.93 },
      playRadius: 470,
      flattenPlay: 0.25,
      terraces: { step: 7, strength: 0.35 },
    },
    bumps: [[0, -170, 90, 8]],
    trees: {
      cell: 16,
      forestScale: 0.004,
      forestBias: -0.45,
      openDensity: 0.012,
      species: (h, rng) => rng.weighted([['dead', 3], ['spruce', 1]]),
      scale: [0.6, 1.0],
      maxSlope: 0.8,
    },
    bushes: { cell: 6, density: 0.18, species: (rng) => rng.weighted([['juniper', 5], ['shrub', 1]]) },
    rocks: { boulderClusters: 140, clusterSize: [3, 8], boulderScale: [1.0, 4.2], cliffSlope: 0.7, spires: 0.55, mountainRocks: 700 },
    roadWidth: 4.5,
    env: {
      sun: { elevation: 34, azimuth: 200, color: '#dfe6f0', intensity: 1.6 },
      sky: { turbidity: 9, rayleigh: 0.9, mieCoefficient: 0.02, mieDirectionalG: 0.7, cloudCoverage: 0.85, cloudDensity: 0.85 },
      fog: { color: '#a7adb3', density: 0.0019, heightFalloff: 0.004 },
      hemi: { sky: '#c6ccd4', ground: '#5c5a55', intensity: 1.3 },
      exposure: 1.05,
      grass: { base: '#4f5a3a', tip: '#8f9370', dryness: 0.4, height: 0.32, density: 0.55 },
      ground: { grass: '#5a6046', grass2: '#6d6c58', dirt: '#6b6559', rock: '#7c7b78', forest: '#4a4a40' },
      ambient: 'alpine',
      wind: 0.85,
      overcast: true,
    },
  },
};

// ------------------------------------------------------------------------------------------
// Layouts (POIs). Each returns { roads: [[x,z]...][], places: [{type,x,z,rot,opts}], pois: [{name,x,z,r}] }
// ------------------------------------------------------------------------------------------
function poiPlacer(places, cx, cz, rot) {
  const c = dcos(rot), s = dsin(rot);
  return (type, lx, lz, lrot = 0, opts) => {
    // local -> world with the same yaw convention as three.js (rotation.y)
    const x = cx + lx * c + lz * s;
    const z = cz - lx * s + lz * c;
    places.push({ type, x, z, rot: rot + lrot, opts });
  };
}

function fenceLine(put, x0, z0, x1, z1, type = 'fence', segLen = 2.4, skip = []) {
  const dx = x1 - x0, dz = z1 - z0;
  const len = Math.sqrt(dx * dx + dz * dz);
  const n = Math.max(1, Math.round(len / segLen));
  const rot = datan2(-dz, dx); // segment local +X along the line
  for (let i = 0; i < n; i++) {
    if (skip.includes(i)) continue;
    const t = (i + 0.5) / n;
    put(type, x0 + dx * t, z0 + dz * t, rot, { len: len / n, end: i === n - 1 });
  }
}

const LAYOUTS = {
  valley(rng) {
    const places = [];
    const pois = [];
    // Farm (centre-west).
    {
      const cx = -70, cz = 40, r = 0.35;
      pois.push({ name: 'Farm', x: cx, z: cz, r: 45 });
      const put = poiPlacer(places, cx, cz, r);
      put('house_wood', -14, -6, 0, { w: 9, d: 6.5 });
      put('house_wood', 12, -10, PI, {});
      put('barn', 4, 20, PI / 2);
      put('shed', -20, 16, PI / 2);
      put('well', -2, -2, 0);
      put('hay_bales', 22, 6, 0.3);
      put('hay_bales', 18, 34, 1.2);
      put('log_pile', -24, 2, PI / 2);
      put('truck_wreck', 26, -24, 0.4);
      put('car_wreck', -6, -24, -0.2);
      put('crates', -26, -14, 0);
      put('barrels', 14, 12, 0);
      fenceLine(put, -36, 32, -36, 52);
      fenceLine(put, -36, 52, 30, 52, 'fence', 2.4, [12, 13]);
      fenceLine(put, 30, 52, 30, 40);
      fenceLine(put, 36, -40, 36, -10, 'fence', 2.4, [5]);
      put('sandbags', 0, -34, PI, { len: 4 });
    }
    // Radio hill (east-north-east hill).
    {
      const cx = 235, cz = -175, r = 0.2;
      pois.push({ name: 'Radio Hill', x: cx, z: cz, r: 40 });
      const put = poiPlacer(places, cx, cz, r);
      put('radio_tower', 0, 0, 0, { h: 44 });
      put('bunker', -14, 8, PI / 2);
      put('container', 12, 10, 0.1, { open: true, mat: 'container_green' });
      put('container', 14, -12, 1.4, { open: false, mat: 'container_tan' });
      put('sandbags', -4, -18, 0, { len: 5 });
      put('sandbags', 20, 0, -PI / 2, { len: 4 });
      put('sandbags', -22, -10, PI / 2, { len: 3 });
      put('guard_tower', -18, -24, 0.0);
      put('crates', 6, 18, 0);
      put('jersey', 0, 26, 0, { n: 2 });
      fenceLine(put, -28, -30, 28, -30, 'chain_fence', 3, [9, 10]);
      fenceLine(put, 28, -30, 28, 30, 'chain_fence', 3);
      fenceLine(put, -28, 30, 28, 30, 'chain_fence', 3, [8, 9, 10]);
      fenceLine(put, -28, -30, -28, 30, 'chain_fence', 3, [4]);
    }
    // Ruins at the south-west crossroads.
    {
      const cx = -230, cz = -210, r = -0.6;
      pois.push({ name: 'Old Ruins', x: cx, z: cz, r: 35 });
      const put = poiPlacer(places, cx, cz, r);
      put('ruin', 0, 0, 0);
      put('ruin', 18, 12, 1.1);
      put('house_plaster', -18, 16, PI / 2, { stairs: true });
      put('car_wreck', 8, -14, 0.7);
      put('sandbags', -10, -12, 0.3, { len: 4 });
      put('crates', 24, -8, 0);
    }
    // Hamlet in the south-east.
    {
      const cx = 170, cz = 215, r = -0.25;
      pois.push({ name: 'Hamlet', x: cx, z: cz, r: 45 });
      const put = poiPlacer(places, cx, cz, r);
      put('house_plaster', -16, -10, 0, { stairs: true });
      put('house_plaster', 14, -12, 0, {});
      put('house_plaster', -2, 16, PI, { stairs: true });
      put('house_wood', 24, 14, PI / 2, {});
      put('shed', -22, 14, 0);
      put('barrels', 4, -2, 0);
      put('crates', -6, 2, 0.4);
      put('car_wreck', 30, -2, 1.5);
      put('well', 6, 4, 0);
    }
    // Army camp in the west.
    {
      const cx = -300, cz = 140, r = 0.9;
      pois.push({ name: 'Camp', x: cx, z: cz, r: 40 });
      const put = poiPlacer(places, cx, cz, r);
      put('tent', -10, -6, 0);
      put('tent', 0, -6, 0);
      put('tent', 10, -6, 0);
      put('container_stack', -6, 14, 0);
      put('container', 10, 14, 0, { open: true });
      put('guard_tower', 22, -20, PI);
      put('sandbags', -20, -16, 0, { len: 5 });
      put('sandbags', 20, 6, PI / 2, { len: 4 });
      put('jersey', -2, 28, 0, { n: 3 });
      put('truck_wreck', -24, 6, PI / 2);
      put('crates', 4, 4, 0);
      put('barrels', -12, 4, 0);
      put('twall', 0, -30, 0, { n: 8 });
    }
    // Scattered cover in the open.
    const extra = [[60, -60, 'car_wreck'], [-140, -90, 'hay_bales'], [80, 110, 'log_pile'], [-170, 250, 'ruin'],
      [320, 40, 'sandbags'], [-60, -260, 'container'], [100, -290, 'truck_wreck'], [-330, -120, 'crates'], [10, 150, 'shed']];
    for (const [x, z, type] of extra) places.push({ type, x, z, rot: rng.range(0, TWO_PI), opts: {} });
    const roads = [
      [[-70, 40], [-20, 0], [60, -60], [150, -130], [205, -165]],
      [[-70, 40], [-60, 120], [20, 190], [140, 210]],
      [[-70, 40], [-150, 70], [-260, 130], [-300, 140]],
      [[-70, 40], [-110, -60], [-170, -150], [-225, -205]],
      [[140, 210], [230, 120], [270, 0], [240, -130]],
      [[-225, -205], [-80, -230], [80, -260], [180, -220], [205, -170]],
    ];
    // Power poles along the first road.
    return { places, pois, roads, poles: [0, 1] };
  },

  outpost(rng) {
    const places = [];
    const pois = [];
    // Timber village along a north-south main road.
    {
      const cx = -30, cz = 10, r = 0.05;
      pois.push({ name: 'Village', x: cx, z: cz, r: 70 });
      const put = poiPlacer(places, cx, cz, r);
      const houses = [
        [-14, -60, -PI / 2], [14, -48, PI / 2], [-15, -34, -PI / 2], [15, -20, PI / 2], [-14, -6, -PI / 2],
        [16, 8, PI / 2], [-15, 22, -PI / 2], [14, 38, PI / 2], [-14, 52, -PI / 2], [15, 64, PI / 2],
      ];
      // Houses face the road: their door side (+Z local) points to x = 0.
      for (const [x, z, rot] of houses) put('house_wood', x, z, rot, {});
      put('shed', -28, -46, 0);
      put('shed', 28, 26, PI);
      put('well', 0, 14, 0);
      put('log_pile', -26, 8, 0);
      put('log_pile', 27, -6, 0.2);
      put('car_wreck', 4, -28, 0.1);
      put('car_wreck', -4, 44, PI + 0.2);
      put('crates', 26, 48, 0);
      put('barrels', -26, 38, 0);
      put('hay_bales', -28, -18, 0.4);
      put('truck_wreck', 5, 80, PI / 2 + 0.2);
      fenceLine(put, -36, -70, -36, 70, 'fence', 2.4, [10, 11, 25, 26, 40, 41, 52]);
      fenceLine(put, 36, -70, 36, 70, 'fence', 2.4, [8, 9, 30, 31, 45, 46]);
    }
    // Fortified compound to the east.
    {
      const cx = 125, cz = -45, r = -0.15;
      pois.push({ name: 'Compound', x: cx, z: cz, r: 40 });
      const put = poiPlacer(places, cx, cz, r);
      // T-wall perimeter 50 x 40 with gaps.
      put('twall', -12, -20, 0, { n: 16 });
      put('twall', 17, -20, 0, { n: 6 });
      put('twall', 0, 20, 0, { n: 20 });
      put('twall', -25, -8, PI / 2, { n: 10 });
      put('twall', -25, 15, PI / 2, { n: 3 });
      put('twall', 25, 0, PI / 2, { n: 16 });
      put('guard_tower', -20, -14, PI);
      put('guard_tower', 20, 15, 0);
      put('container', -10, 6, 0, { open: true, mat: 'container_tan' });
      put('container_stack', 8, 8, 0);
      put('container', 10, -8, PI / 2, { open: true, mat: 'container_green' });
      put('bunker', -8, -8, 0);
      put('tent', 0, 0, PI / 2);
      put('sandbags', 4, -14, 0, { len: 4 });
      put('sandbags', 15, -27, 0, { len: 5 });
      put('jersey', 3, -30, 0, { n: 2 });
      put('crates', -16, 12, 0);
      put('barrels', 18, 0, 0);
      put('truck_wreck', -36, -2, 1.4);
    }
    // Sawmill to the north-west.
    {
      const cx = -140, cz = -105, r = 0.6;
      pois.push({ name: 'Sawmill', x: cx, z: cz, r: 35 });
      const put = poiPlacer(places, cx, cz, r);
      put('barn', 0, 0, 0);
      put('log_pile', 14, -4, 0);
      put('log_pile', 14, 6, 0.1);
      put('log_pile', -14, 8, PI / 2);
      put('shed', -12, -14, PI / 2);
      put('truck_wreck', 4, 20, 0.3);
      put('crates', 18, -16, 0);
    }
    // Farmstead to the south-west.
    {
      const cx = -150, cz = 120, r = -0.4;
      pois.push({ name: 'Farmstead', x: cx, z: cz, r: 30 });
      const put = poiPlacer(places, cx, cz, r);
      put('house_wood', 0, 0, 0, { w: 9 });
      put('shed', 14, 4, -PI / 2);
      put('hay_bales', -12, 12, 0.2);
      put('car_wreck', 8, 16, 1.0);
      put('well', -8, -10, 0);
    }
    const extra = [[60, 60, 'ruin'], [80, 140, 'car_wreck'], [-80, 60, 'hay_bales'], [190, 60, 'sandbags'], [40, -140, 'container'],
      [-70, -40, 'crates'], [150, 110, 'log_pile']];
    for (const [x, z, type] of extra) places.push({ type, x, z, rot: rng.range(0, TWO_PI), opts: {} });
    const roads = [
      [[-36, -210], [-34, -100], [-30, 10], [-26, 120], [-20, 230]],
      [[-30, 10], [40, -10], [95, -40], [125, -45]],
      [[-34, -100], [-90, -110], [-140, -105]],
      [[-26, 120], [-90, 125], [-150, 120]],
      [[125, -45], [170, 20], [180, 120]],
    ];
    return { places, pois, roads, poles: [0] };
  },

  ridge(rng) {
    const places = [];
    const pois = [];
    {
      const cx = 0, cz = -170, r = 0.4;
      pois.push({ name: 'Signal Tower', x: cx, z: cz, r: 30 });
      const put = poiPlacer(places, cx, cz, r);
      put('signal_tower', 0, 0, 0);
      put('jersey', -16, 18, 0.2, { n: 2 });
      put('jersey', 18, -14, 1.2, { n: 2 });
      put('sandbags', 20, 16, -0.6, { len: 4 });
    }
    {
      const cx = -200, cz = 130, r = -0.3;
      pois.push({ name: 'Research Outpost', x: cx, z: cz, r: 45 });
      const put = poiPlacer(places, cx, cz, r);
      put('container', -12, -8, 0, { open: true, mat: 'container_blue' });
      put('container_stack', -12, 6, 0);
      put('container', 6, -14, PI / 2, { open: true, mat: 'container_tan' });
      put('container', 14, 8, 0.2, { open: false, mat: 'container_red' });
      put('bunker', 2, 16, PI);
      put('bunker', 22, -10, PI / 2);
      put('tent', -26, -2, 0);
      put('radio_tower', -24, 18, 0, { h: 26 });
      put('jersey', 0, -26, 0, { n: 3 });
      put('sandbags', 30, 6, PI / 2, { len: 5 });
      put('sandbags', -4, 2, 0, { len: 3 });
      put('crates', 6, 0, 0);
      put('barrels', -2, -6, 0);
      put('guard_tower', -30, -24, 0.3);
      fenceLine(put, -40, -34, 38, -34, 'chain_fence', 3, [12, 13]);
      fenceLine(put, 38, -34, 38, 30, 'chain_fence', 3, [10, 11]);
    }
    {
      const cx = 240, cz = 170, r = 1.2;
      pois.push({ name: 'Old Shelter', x: cx, z: cz, r: 30 });
      const put = poiPlacer(places, cx, cz, r);
      put('ruin', 0, 0, 0);
      put('ruin', 16, -10, 0.8);
      put('house_plaster', -16, 8, 0, { stairs: true });
      put('truck_wreck', 4, 20, 0.4);
    }
    {
      const cx = 260, cz = -220, r = 0.0;
      pois.push({ name: 'Quarry Camp', x: cx, z: cz, r: 30 });
      const put = poiPlacer(places, cx, cz, r);
      put('tent', 0, 0, 0.3);
      put('tent', 10, 6, 0.1);
      put('container', -10, 10, 0.8, { open: true });
      put('truck_wreck', -8, -12, 1.0);
      put('crates', 12, -8, 0);
      put('sandbags', 0, 18, 0, { len: 5 });
    }
    const extra = [[-60, 40, 'car_wreck'], [90, 60, 'sandbags'], [-120, -160, 'bunker'], [120, -40, 'ruin'], [-300, -80, 'container'],
      [60, 300, 'truck_wreck'], [-40, 280, 'sandbags'], [330, 20, 'bunker']];
    for (const [x, z, type] of extra) places.push({ type, x, z, rot: rng.range(0, TWO_PI), opts: {} });
    const roads = [
      [[-200, 130], [-120, 40], [-40, -80], [0, -150]],
      [[0, -150], [120, -200], [255, -215]],
      [[-200, 130], [-40, 200], [120, 210], [240, 170]],
    ];
    return { places, pois, roads, poles: [] };
  },
};

// ------------------------------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------------------------------
function densifyRoad(points, noise, wobble = 6, spacing = 6) {
  // Catmull-Rom through control points, then a noise wobble perpendicular to the path.
  const out = [];
  const P = points;
  for (let i = 0; i < P.length - 1; i++) {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    const dx = p2[0] - p1[0], dz = p2[1] - p1[1];
    const segLen = Math.sqrt(dx * dx + dz * dz);
    const n = Math.max(2, Math.ceil(segLen / spacing));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const x = 0.5 * ((2 * p1[0]) + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3);
      const z = 0.5 * ((2 * p1[1]) + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3);
      out.push([x, z]);
    }
  }
  out.push([P[P.length - 1][0], P[P.length - 1][1]]);
  // Perpendicular wobble (not at the ends so roads meet their POIs).
  const res = [];
  for (let i = 0; i < out.length; i++) {
    const a = out[Math.max(0, i - 1)], b = out[Math.min(out.length - 1, i + 1)];
    let tx = b[0] - a[0], tz = b[1] - a[1];
    const l = Math.sqrt(tx * tx + tz * tz) || 1;
    tx /= l; tz /= l;
    const edge = Math.min(i, out.length - 1 - i) / 6;
    const w = noise.noise2(out[i][0] * 0.012, out[i][1] * 0.012) * wobble * Math.min(1, edge);
    res.push([out[i][0] - tz * w, out[i][1] + tx * w]);
  }
  return res;
}

function distToSegment2(px, pz, ax, az, bx, bz) {
  const abx = bx - ax, abz = bz - az;
  const len2 = abx * abx + abz * abz || 1;
  let t = ((px - ax) * abx + (pz - az) * abz) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = ax + abx * t - px, dz = az + abz * t - pz;
  return dx * dx + dz * dz;
}

/** Coarse occupancy grid used during generation (structures, roads, keep-out zones). */
class Occupancy {
  constructor(size, cell) {
    this.size = size;
    this.half = size / 2;
    this.cell = cell;
    this.n = Math.ceil(size / cell);
    this.grid = new Uint8Array(this.n * this.n);
  }
  idx(x, z) {
    const ix = Math.floor((x + this.half) / this.cell);
    const iz = Math.floor((z + this.half) / this.cell);
    if (ix < 0 || iz < 0 || ix >= this.n || iz >= this.n) return -1;
    return iz * this.n + ix;
  }
  get(x, z) {
    const i = this.idx(x, z);
    return i < 0 ? 255 : this.grid[i];
  }
  markRect(cx, cz, hw, hd, rot, value, margin = 0) {
    const c = dcos(rot), s = dsin(rot);
    const r = Math.sqrt((hw + margin) * (hw + margin) + (hd + margin) * (hd + margin));
    for (let z = cz - r; z <= cz + r; z += this.cell * 0.5) {
      for (let x = cx - r; x <= cx + r; x += this.cell * 0.5) {
        const px = x - cx, pz = z - cz;
        const lx = px * c - pz * s, lz = px * s + pz * c;
        if (Math.abs(lx) <= hw + margin && Math.abs(lz) <= hd + margin) {
          const i = this.idx(x, z);
          if (i >= 0 && this.grid[i] < value) this.grid[i] = value;
        }
      }
    }
  }
  markCircle(cx, cz, r, value) {
    for (let z = cz - r; z <= cz + r; z += this.cell * 0.5) {
      for (let x = cx - r; x <= cx + r; x += this.cell * 0.5) {
        if ((x - cx) * (x - cx) + (z - cz) * (z - cz) > r * r) continue;
        const i = this.idx(x, z);
        if (i >= 0 && this.grid[i] < value) this.grid[i] = value;
      }
    }
  }
}

// ------------------------------------------------------------------------------------------
// World
// ------------------------------------------------------------------------------------------
export class World {
  /**
   * @param {string} mapId
   * @param {object} [opts] { vegetation: true } — the server can skip visual-only data.
   */
  constructor(mapId, opts = {}) {
    const g = GEN[mapId];
    if (!g) throw new Error('Unknown map ' + mapId);
    this.mapId = mapId;
    this.gen = g;
    this.env = g.env;
    this.size = g.size;
    this.half = g.size / 2;
    this.playRadius = g.playRadius;
    const t0 = Date.now();
    const rng = new RNG(g.seed);
    const noise = new SimplexNoise(g.seed * 3 + 1);

    // 1) Base terrain + authored bumps.
    const terrain = generateBaseTerrain({ size: g.size, res: g.res, seed: g.seed, ...g.terrain });
    for (const [x, z, r, h] of g.bumps || []) terrain.addBump(x, z, r, h);
    this.terrain = terrain;

    // 2) Layout.
    const layout = LAYOUTS[mapId](rng.fork('layout'));
    this.pois = layout.pois;

    // 3) Roads: densify + carve.
    this.roads = layout.roads.map((pts, i) => ({
      points: densifyRoad(pts, noise, 5, 5),
      width: g.roadWidth,
      poles: (layout.poles || []).includes(i),
    }));
    for (const road of this.roads) terrain.carveRoad(road.points, road.width, 0.18, 5);

    // 4) Structures: flatten pads (after roads so pads win), then build parts.
    const srng = rng.fork('structures');
    this.structures = [];
    for (const pl of layout.places) {
      const built = buildStructure(pl.type, srng.fork(pl.type + pl.x + ',' + pl.z), pl.opts);
      // Pad height: average of footprint corners + centre (slightly favouring the low side).
      const c = dcos(pl.rot), s = dsin(pl.rot);
      let sum = 0, mn = Infinity, n = 0;
      for (const [lx, lz] of [[0, 0], [-built.hw, -built.hd], [built.hw, -built.hd], [-built.hw, built.hd], [built.hw, built.hd]]) {
        const wx = pl.x + lx * c + lz * s, wz = pl.z - lx * s + lz * c;
        const h = terrain.heightAt(wx, wz);
        sum += h; n++;
        if (h < mn) mn = h;
      }
      const padY = (sum / n) * 0.6 + mn * 0.4;
      const big = built.hw * built.hd > 12;
      if (pl.type !== 'fence' && pl.type !== 'chain_fence' && pl.type !== 'power_pole') {
        terrain.flattenRect(pl.x, pl.z, built.hw, built.hd, pl.rot, padY, big ? 9 : 4);
      }
      this.structures.push({ type: pl.type, x: pl.x, z: pl.z, rot: pl.rot, y: padY, parts: built.parts, hw: built.hw, hd: built.hd, door: built.door || null });
    }
    // Fences and poles follow the final terrain: set their y afterwards.
    terrain.computeRange();
    for (const st of this.structures) {
      if (st.type === 'fence' || st.type === 'chain_fence' || st.type === 'power_pole') st.y = terrain.heightAt(st.x, st.z) - 0.05;
    }
    // Power poles along flagged roads.
    const prng = rng.fork('poles');
    for (const road of this.roads) {
      if (!road.poles) continue;
      let acc = 0;
      const pts = road.points;
      road.poleList = [];
      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i][0] - pts[i - 1][0], dz = pts[i][1] - pts[i - 1][1];
        acc += Math.sqrt(dx * dx + dz * dz);
        if (acc > 38) {
          acc = 0;
          const l = Math.sqrt(dx * dx + dz * dz) || 1;
          const px = pts[i][0] + (dz / l) * (road.width * 0.5 + 2.5);
          const pz = pts[i][1] - (dx / l) * (road.width * 0.5 + 2.5);
          const built = buildStructure('power_pole', prng);
          const st = { type: 'power_pole', x: px, z: pz, rot: datan2(-dz, dx), y: terrain.heightAt(px, pz) - 0.1, parts: built.parts, hw: built.hw, hd: built.hd };
          this.structures.push(st);
          road.poleList.push(st);
        }
      }
    }

    // 5) Occupancy grid (2 m): 1 = road, 2 = structure area, 3 = solid structure.
    const occ = new Occupancy(g.size, 2);
    for (const road of this.roads) {
      const pts = road.points;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        const dx = bx - ax, dz = bz - az;
        const len = Math.sqrt(dx * dx + dz * dz);
        occ.markRect(mx, mz, len / 2 + 0.5, road.width / 2 + 0.6, datan2(-dz, dx), 1);
      }
    }
    for (const st of this.structures) {
      if (st.type === 'fence' || st.type === 'chain_fence' || st.type === 'power_pole') {
        occ.markRect(st.x, st.z, st.hw, 0.6, st.rot, 2);
      } else {
        occ.markRect(st.x, st.z, st.hw, st.hd, st.rot, 3, 1.5);
      }
    }
    for (const poi of this.pois) occ.markCircle(poi.x, poi.z, poi.r * 0.55, 2);
    this.occupancy = occ;

    // 6) Ground-type grid for rendering + footsteps (same 2 m resolution).
    this.groundCell = 2;
    this.groundN = occ.n;
    this.ground = new Uint8Array(occ.n * occ.n);
    for (const road of this.roads) {
      const pts = road.points;
      for (let i = 0; i < pts.length - 1; i++) {
        const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
        const mx = (ax + bx) / 2, mz = (az + bz) / 2;
        const dx = bx - ax, dz = bz - az;
        const len = Math.sqrt(dx * dx + dz * dz);
        this._markGround(mx, mz, len / 2 + 0.6, road.width / 2, datan2(-dz, dx), GROUND.DIRT_ROAD);
      }
    }
    for (const st of this.structures) {
      if (st.type === 'fence' || st.type === 'chain_fence' || st.type === 'power_pole') continue;
      this._markGround(st.x, st.z, st.hw * 0.9, st.hd * 0.9, st.rot, GROUND.CLEARED);
    }

    // 7) Collision world: structures first.
    const col = new CollisionWorld(terrain, 8);
    this.collision = col;
    for (const st of this.structures) this._addStructureColliders(st);

    // 8) Vegetation + rocks.
    this.trees = [];
    this.bushes = [];
    this.rocks = [];
    this._placeRocks(rng.fork('rocks'), noise);
    this._placeTrees(rng.fork('trees'), noise);
    if (opts.vegetation !== false) this._placeBushes(rng.fork('bushes'), noise);

    // 9) Spawns + nav points.
    this._placeSpawns(rng.fork('spawns'));
    this.genTime = Date.now() - t0;
  }

  _markGround(cx, cz, hw, hd, rot, value) {
    const c = dcos(rot), s = dsin(rot);
    const r = Math.sqrt(hw * hw + hd * hd) + 1;
    const cell = this.groundCell;
    const n = this.groundN;
    for (let z = cz - r; z <= cz + r; z += cell * 0.5) {
      for (let x = cx - r; x <= cx + r; x += cell * 0.5) {
        const px = x - cx, pz = z - cz;
        const lx = px * c - pz * s, lz = px * s + pz * c;
        if (Math.abs(lx) > hw || Math.abs(lz) > hd) continue;
        const ix = Math.floor((x + this.half) / cell), iz = Math.floor((z + this.half) / cell);
        if (ix < 0 || iz < 0 || ix >= n || iz >= n) continue;
        const i = iz * n + ix;
        if (this.ground[i] === GROUND.NATURAL || value === GROUND.DIRT_ROAD) this.ground[i] = value;
      }
    }
  }

  groundTypeAt(x, z) {
    const n = this.groundN;
    const ix = Math.floor((x + this.half) / this.groundCell), iz = Math.floor((z + this.half) / this.groundCell);
    if (ix < 0 || iz < 0 || ix >= n || iz >= n) return GROUND.NATURAL;
    return this.ground[iz * n + ix];
  }

  /** Footstep / impact surface of the terrain at (x, z). */
  surfaceAt(x, z) {
    const g = this.groundTypeAt(x, z);
    if (g === GROUND.DIRT_ROAD || g === GROUND.CLEARED) return this.mapId === 'ridge' ? 'gravel' : 'dirt';
    const f = this.terrain.flatness(x, z);
    if (f < 0.72) return 'rock';
    if (this.mapId === 'ridge') return f < 0.85 ? 'gravel' : 'grass';
    return 'grass';
  }

  /** Convert a structure part to world transform. Returns { x, y, z, yaw }. */
  partWorld(st, p) {
    const c = dcos(st.rot), s = dsin(st.rot);
    return { x: st.x + p.x * c + p.z * s, y: st.y + p.y, z: st.z - p.x * s + p.z * c, yaw: st.rot + p.ry };
  }

  _addStructureColliders(st) {
    for (const p of st.parts) {
      if (!p.col) continue;
      const w = this.partWorld(st, p);
      const matInfo = MATERIALS[p.mat] || MATERIALS.concrete;
      const pen = p.pen !== undefined ? p.pen : matInfo.pen;
      const surface = matInfo.surface;
      if (p.shape === 'cyl') {
        this.collision.addCylinder({ x: w.x, z: w.z, r: Math.max(p.w, p.d) / 2, y0: w.y - p.h / 2, y1: w.y + p.h / 2, mat: surface, pen });
      } else if (p.shape === 'cylx') {
        this.collision.addBox({ cx: w.x, cy: w.y, cz: w.z, hx: p.w / 2, hy: p.h / 2 * 0.9, hz: p.d / 2 * 0.9, yaw: w.yaw, mat: surface, pen });
      } else {
        this.collision.addBox({
          cx: w.x, cy: w.y, cz: w.z, hx: p.w / 2, hy: p.h / 2, hz: p.d / 2,
          yaw: w.yaw, pitch: p.rx, roll: p.rz,
          walk: p.walk !== false, shoot: p.shoot !== false, mat: surface, pen,
        });
      }
    }
  }

  _placeRocks(rng, noise) {
    const g = this.gen.rocks;
    const t = this.terrain;
    const half = this.half;
    const pr = this.playRadius;
    const add = (x, z, type, s, sinkFrac = 0.35, stretch = null) => {
      if (!t.inside(x, z, 10)) return false;
      const o = this.occupancy.get(x, z);
      if (o >= 1) return false;
      const sx = s * (stretch ? stretch[0] : rng.range(0.8, 1.25));
      const sz = s * (stretch ? stretch[2] : rng.range(0.8, 1.25));
      const sy = s * (stretch ? stretch[1] : rng.range(0.55, 0.9));
      const ground = Math.min(t.heightAt(x - sx * 0.5, z), t.heightAt(x + sx * 0.5, z), t.heightAt(x, z - sz * 0.5), t.heightAt(x, z + sz * 0.5));
      const y = ground + sy * (1 - sinkFrac * 2) * 0.5;
      const rotY = rng.range(0, TWO_PI);
      const rock = { x, y, z, rotY, sx, sy, sz, type };
      this.rocks.push(rock);
      this.collision.addEllipsoid({ x, y, z, rx: sx, ry: sy, rz: sz, yaw: rotY, mat: 'rock' });
      if (sx > 1.4 || sz > 1.4) this.occupancy.markCircle(x, z, Math.max(sx, sz) * 0.9, 1);
      return true;
    };
    // Boulder clusters in and around the play area.
    for (let c = 0; c < g.boulderClusters; c++) {
      const ang = rng.range(0, TWO_PI);
      const rad = Math.sqrt(rng.next()) * pr * 1.35;
      const cx = dcos(ang) * rad, cz = dsin(ang) * rad;
      const n = rng.int(g.clusterSize[0], g.clusterSize[1]);
      const spire = rng.chance(g.spires);
      for (let i = 0; i < n; i++) {
        const x = cx + rng.range(-9, 9), z = cz + rng.range(-9, 9);
        const s = rng.range(g.boulderScale[0], g.boulderScale[1]) * (i === 0 ? 1.25 : 1);
        if (spire && i < 3) add(x, z, 'spire', s * 0.7, 0.15, [rng.range(0.6, 0.9), rng.range(1.8, 3.2), rng.range(0.6, 0.9)]);
        else add(x, z, rng.chance(0.3) ? 'slab' : 'boulder', s, 0.35, rng.chance(0.3) ? [rng.range(1.2, 1.8), rng.range(0.35, 0.55), rng.range(0.9, 1.3)] : null);
      }
      // Pebbles around clusters.
      for (let i = 0; i < n; i++) add(cx + rng.range(-14, 14), cz + rng.range(-14, 14), 'pebble', rng.range(0.25, 0.6), 0.3);
    }
    // Cliffs on steep slopes and rocks on the mountains (outside the play area).
    let placed = 0;
    for (let tries = 0; tries < g.mountainRocks * 6 && placed < g.mountainRocks; tries++) {
      const x = rng.range(-half + 20, half - 20), z = rng.range(-half + 20, half - 20);
      const f = t.flatness(x, z);
      const d = Math.sqrt(x * x + z * z);
      if (f > g.cliffSlope && d < pr * 1.1) continue;
      if (f > 0.85) continue;
      const big = d > pr * 1.2;
      const s = big ? rng.range(4, 11) : rng.range(1.6, 4.5);
      const type = g.spires > 0 && rng.chance(g.spires * 0.6) ? 'spire' : rng.chance(0.5) ? 'cliff' : 'boulder';
      const stretch = type === 'spire' ? [rng.range(0.5, 0.8), rng.range(1.8, 3.4), rng.range(0.5, 0.8)] : type === 'cliff' ? [rng.range(1.3, 2.0), rng.range(0.7, 1.1), rng.range(0.8, 1.2)] : null;
      if (add(x, z, type, s, type === 'spire' ? 0.12 : 0.3, stretch)) placed++;
    }
  }

  _placeTrees(rng, noise) {
    const g = this.gen.trees;
    const t = this.terrain;
    const half = this.half;
    const cell = g.cell;
    const n = Math.floor(this.size / cell);
    const pr = this.playRadius;
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const x = -half + (ix + rng.next()) * cell;
        const z = -half + (iz + rng.next()) * cell;
        const roll = rng.next();
        const speciesRoll = rng.fork(ix * 7919 + iz);
        if (!t.inside(x, z, 15)) continue;
        const d = Math.sqrt(x * x + z * z);
        // Forest mask: fbm noise + bias; denser on the mountain foothills.
        let f = noise.fbm(x * g.forestScale, z * g.forestScale, 4) + g.forestBias;
        f += smoothstep(pr * 1.05, pr * 1.6, d) * 0.35 - smoothstep(pr * 1.9, half * 0.98, d) * 0.6;
        if (g.clearRadius) f -= (1 - smoothstep(g.clearRadius * 0.6, g.clearRadius * 1.25, d)) * 0.9;
        let density = clamp(f * 1.6, 0, 0.9) + g.openDensity;
        const flat = t.flatness(x, z);
        if (flat < g.maxSlope) continue;
        const h = t.heightAt(x, z);
        if (h > t.minHeight + (t.maxHeight - t.minHeight) * 0.72) density *= 0.2; // tree line
        if (roll > density) continue;
        if (this.occupancy.get(x, z) >= 1) continue;
        const species = g.species(h, speciesRoll);
        const scale = speciesRoll.range(g.scale[0], g.scale[1]);
        const dims = TREE_DIMS[species];
        const r = dims.trunkRadius * scale;
        // Keep out of rocks.
        let blocked = false;
        this.collision.query(x - r - 0.5, z - r - 0.5, x + r + 0.5, z + r + 0.5, (c) => {
          if (c.shape === 2) {
            const dx = x - c.x, dz = z - c.z;
            const rr = Math.max(c.rx, c.rz) + r;
            if (dx * dx + dz * dz < rr * rr) { blocked = true; return true; }
          }
          return false;
        });
        if (blocked) continue;
        const y = Math.min(h, t.heightAt(x + r, z), t.heightAt(x - r, z), t.heightAt(x, z + r), t.heightAt(x, z - r)) - 0.05;
        const tree = { x, y, z, rot: speciesRoll.range(0, TWO_PI), scale, species };
        this.trees.push(tree);
        this.collision.addCylinder({ x, z, r, y0: y - 1, y1: y + dims.height * scale * dims.trunkTop, mat: 'wood', pen: false, tag: 'tree' });
      }
    }
  }

  _placeBushes(rng, noise) {
    const g = this.gen.bushes;
    const t = this.terrain;
    const half = this.half;
    const cell = g.cell;
    const n = Math.floor(this.size / cell);
    const limit = this.playRadius * 2.1;
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const x = -half + (ix + rng.next()) * cell;
        const z = -half + (iz + rng.next()) * cell;
        const roll = rng.next();
        const sp = rng.next();
        const sc = rng.next();
        const rot = rng.next() * TWO_PI;
        if (Math.abs(x) > limit || Math.abs(z) > limit) continue;
        const f = noise.fbm(x * 0.011 + 40, z * 0.011 - 40, 3);
        const density = g.density * clamp(0.35 + f * 1.2, 0, 1.4);
        if (roll > density) continue;
        if (this.occupancy.get(x, z) >= 1) continue;
        if (t.flatness(x, z) < 0.7) continue;
        const r2 = new RNG(Math.floor(sp * 1e9) + 1);
        const species = g.species(r2);
        this.bushes.push({ x, y: t.heightAt(x, z), z, rot, scale: 0.6 + sc * 0.8, species });
      }
    }
  }

  _placeSpawns(rng) {
    const t = this.terrain;
    const pr = this.playRadius;
    const spawns = [];
    const body = { x: 0, y: 0, z: 0 };
    for (let tries = 0; tries < 4000 && spawns.length < 40; tries++) {
      const ang = rng.range(0, TWO_PI);
      const rad = pr * (0.2 + 0.72 * Math.sqrt(rng.next()));
      const x = dcos(ang) * rad, z = dsin(ang) * rad;
      if (t.flatness(x, z) < 0.88) continue;
      if (this.occupancy.get(x, z) >= 2) continue;
      let ok = true;
      for (const s of spawns) {
        const dx = s.x - x, dz = s.z - z;
        if (dx * dx + dz * dz < 26 * 26) { ok = false; break; }
      }
      if (!ok) continue;
      body.x = x; body.z = z; body.y = t.heightAt(x, z);
      if (this.collision.resolveBody(body, 0.6, 1.8, 0.45)) continue;
      const y = this.collision.groundHeight(x, z, body.y + 0.5, 0.3);
      // Face roughly toward the centre.
      const yaw = datan2(x, z) + rng.range(-0.6, 0.6);
      spawns.push({ x, y, z, yaw, side: x < 0 ? 0 : 1 });
    }
    this.spawns = spawns;
    // Navigation points: POIs + doors + spawns + some random open points.
    const nav = [];
    for (const p of this.pois) nav.push({ x: p.x, z: p.z, kind: 'poi' });
    for (const s of spawns) nav.push({ x: s.x, z: s.z, kind: 'open' });
    this.navPoints = nav;
  }

  /** Is (x, z) inside the playable area? */
  inPlayArea(x, z, margin = 0) {
    return x * x + z * z <= (this.playRadius + margin) * (this.playRadius + margin);
  }

  /** Summary checksum so clients can verify they generated the same world as the server. */
  checksum() {
    let h = 0;
    const mix = (v) => { h = (Math.imul(h ^ Math.floor(v * 100), 0x9e3779b1) + 0x7f4a7c15) | 0; };
    mix(this.trees.length); mix(this.rocks.length); mix(this.structures.length); mix(this.collision.colliders.length);
    for (let i = 0; i < this.terrain.heights.length; i += 997) mix(this.terrain.heights[i]);
    for (let i = 0; i < this.trees.length; i += 13) { mix(this.trees[i].x); mix(this.trees[i].z); }
    return h >>> 0;
  }
}

const cache = new Map();
/** Cached world per map (the server shares one world between rooms on the same map). */
export function getWorld(mapId, opts = {}) {
  const key = mapId + (opts.vegetation === false ? ':nv' : '');
  if (!cache.has(key)) cache.set(key, new World(mapId, opts));
  return cache.get(key);
}

export const MAP_IDS = Object.keys(GEN);
