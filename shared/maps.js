// Map catalogue. Each map is generated procedurally (deterministically) from its parameters
// by shared/world.js, so the server and every client build the exact same world.
export const MAPS = [
  {
    id: 'valley',
    name: 'Highland Valley',
    description: 'Golden-hour grassland ringed by mountains. Tall pines, granite boulders, a farm and a radio hill.',
    timeOfDay: 'golden hour',
    size: 1600,
  },
  {
    id: 'outpost',
    name: 'Forest Outpost',
    description: 'Close quarters around a timber village and a fortified compound in a sunny forest clearing.',
    timeOfDay: 'morning',
    size: 1200,
  },
  {
    id: 'ridge',
    name: 'Ashen Ridge',
    description: 'Overcast alpine plateau with jagged peaks and a strange signal tower. Long sightlines for snipers.',
    timeOfDay: 'overcast',
    size: 2000,
  },
];
export const MAP_BY_ID = Object.fromEntries(MAPS.map((m) => [m.id, m]));
