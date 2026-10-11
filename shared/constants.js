// Constants shared by client, server and the game room simulation.
export const GAME_NAME = 'SHUTE REAL';
export const GAME_VERSION = '1.0.0';
export const PROTOCOL_VERSION = 1;
export const DEFAULT_PORT = 7777;

export const MODES = {
  ffa: { id: 'ffa', name: 'Free For All', short: 'FFA', teams: false, scoreLimit: 30, timeLimit: 600, respawn: 3 },
  tdm: { id: 'tdm', name: 'Team Deathmatch', short: 'TDM', teams: true, scoreLimit: 75, timeLimit: 600, respawn: 4 },
};

export const TEAMS = [
  { id: 0, name: 'NATO', color: '#4aa3ff' },
  { id: 1, name: 'OPFOR', color: '#ff5a4a' },
];

export const BOT_DIFFICULTY = {
  easy: { id: 'easy', name: 'Recruit' },
  normal: { id: 'normal', name: 'Regular' },
  hard: { id: 'hard', name: 'Veteran' },
};

export const STANCE = { STAND: 0, CROUCH: 1, PRONE: 2 };

export const PLAYER = {
  maxHealth: 100,
  radius: 0.35,
  height: [1.8, 1.25, 0.6], // per stance
  eye: [1.62, 1.12, 0.38], // eye height per stance
  speed: { walk: 4.6, sprint: 6.9, crouch: 2.5, prone: 1.0, ads: 2.8 },
  jumpVelocity: 4.4,
  gravity: 9.81,
  stepHeight: 0.45,
  maxSlope: 0.72, // cos(angle) of steepest walkable slope (~44 degrees)
  regenDelay: 6,
  regenRate: 18,
  spawnProtection: 2.0,
};
