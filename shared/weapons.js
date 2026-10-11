// Weapon database shared by the client (handling, HUD, loadout UI, models) and the
// server/game room (damage validation, bots). All distances in meters, angles in degrees,
// times in seconds. Damage is against 100 HP.

export const CATEGORIES = {
  AR: { name: 'Assault Rifles', short: 'AR' },
  SMG: { name: 'Submachine Guns', short: 'SMG' },
  LMG: { name: 'Light Machine Guns', short: 'LMG' },
  DMR: { name: 'Marksman Rifles', short: 'DMR' },
  SNIPER: { name: 'Sniper Rifles', short: 'SNIPER' },
  SHOTGUN: { name: 'Shotguns', short: 'SHOTGUN' },
  PISTOL: { name: 'Pistols', short: 'PISTOL' },
};

// Optics. zoom = view magnification while aiming. pip = picture-in-picture scope lens.
export const OPTICS = {
  iron: { id: 'iron', name: 'Iron Sights', zoom: 1.15, pip: false, adsTimeMult: 1.0 },
  reddot: { id: 'reddot', name: 'Red Dot (T-2)', zoom: 1.3, pip: false, adsTimeMult: 1.0 },
  holo: { id: 'holo', name: 'Holographic (EXPS3)', zoom: 1.3, pip: false, adsTimeMult: 1.03 },
  acog: { id: 'acog', name: '4x ACOG', zoom: 1.45, pip: true, magnification: 4, adsTimeMult: 1.12 },
  pso: { id: 'pso', name: '4x PSO-1', zoom: 1.45, pip: true, magnification: 4, adsTimeMult: 1.12 },
  scope8: { id: 'scope8', name: '8x Sniper Scope', zoom: 1.6, pip: true, magnification: 8, adsTimeMult: 1.25 },
};

export const MUZZLES = {
  flash: { id: 'flash', name: 'Flash Hider', recoilV: 1.0, recoilH: 1.0, range: 1.0, suppressed: false },
  comp: { id: 'comp', name: 'Compensator', recoilV: 0.88, recoilH: 0.75, range: 1.0, suppressed: false },
  suppressor: { id: 'suppressor', name: 'Suppressor', recoilV: 0.95, recoilH: 0.95, range: 0.9, suppressed: true },
  none: { id: 'none', name: 'None', recoilV: 1.0, recoilH: 1.0, range: 1.0, suppressed: false },
};

export const GRIPS = {
  none: { id: 'none', name: 'None', recoilV: 1.0, recoilH: 1.0, adsTimeMult: 1.0 },
  vertical: { id: 'vertical', name: 'Vertical Grip', recoilV: 0.85, recoilH: 0.95, adsTimeMult: 1.03 },
  angled: { id: 'angled', name: 'Angled Grip', recoilV: 0.95, recoilH: 0.9, adsTimeMult: 0.92 },
};

const AR_OPTICS = ['iron', 'reddot', 'holo', 'acog'];
const AR_MUZZLES = ['flash', 'comp', 'suppressor'];
const GRIP_OPTS = ['none', 'vertical', 'angled'];

// Helper to build weapon entries with sensible defaults per category.
function W(o) {
  const base = {
    slot: o.category === 'PISTOL' ? 'secondary' : 'primary',
    headMult: 2.0,
    limbMult: 0.75,
    pellets: 1,
    burst: 3,
    reloadType: 'mag', // 'mag' | 'shell' (one round at a time) | 'speedloader'
    shell: 'rifle', // casing type: 'rifle' | 'pistol' | 'shotgun' | 'big' | 'none'
    bullpup: false,
    penetration: 1, // how many thin (wood/sheet metal) layers the round can punch through
    equipTime: 0.55,
    sprintToFire: 0.22,
    moveSpeed: 1.0,
    optics: AR_OPTICS,
    muzzles: AR_MUZZLES,
    grips: GRIP_OPTS,
    defaultOptic: 'iron',
    defaultMuzzle: 'flash',
    defaultGrip: 'none',
    bipod: false,
  };
  return Object.assign(base, o);
}

export const WEAPON_LIST = [
  // ---------------------------------------------------------------- Assault rifles
  W({
    id: 'm4a1', name: 'M4A1', category: 'AR', caliber: '5.56×45mm NATO',
    desc: 'Reliable carbine with controllable recoil. The all-rounder.',
    damage: [30, 22], range: [35, 110], rpm: 800, fireModes: ['auto', 'semi'],
    mag: 30, reserve: 150, reload: 2.2, reloadEmpty: 2.75, velocity: 880,
    spread: { hip: 2.6, ads: 0.07, move: 1.6, bloom: 0.12, max: 5 },
    recoil: { v: 0.42, h: 0.22, recover: 7, kick: 1.0 },
    ads: 0.24, moveSpeed: 0.97, sound: 'rifle556', defaultOptic: 'reddot',
  }),
  W({
    id: 'hk416', name: 'HK416', category: 'AR', caliber: '5.56×45mm NATO',
    desc: 'Short-stroke piston rifle. Faster fire rate, slightly heavier.',
    damage: [31, 23], range: [35, 110], rpm: 850, fireModes: ['auto', 'semi'],
    mag: 30, reserve: 150, reload: 2.3, reloadEmpty: 2.85, velocity: 890,
    spread: { hip: 2.6, ads: 0.07, move: 1.6, bloom: 0.12, max: 5 },
    recoil: { v: 0.4, h: 0.24, recover: 7, kick: 1.0 },
    ads: 0.26, moveSpeed: 0.96, sound: 'rifle556', defaultOptic: 'holo',
  }),
  W({
    id: 'ak47', name: 'AK-47', category: 'AR', caliber: '7.62×39mm',
    desc: 'Hard-hitting classic. Heavy recoil rewards burst fire.',
    damage: [38, 28], range: [30, 100], rpm: 600, fireModes: ['auto', 'semi'],
    mag: 30, reserve: 120, reload: 2.5, reloadEmpty: 3.0, velocity: 715,
    spread: { hip: 3.0, ads: 0.1, move: 1.8, bloom: 0.18, max: 6 },
    recoil: { v: 0.72, h: 0.38, recover: 6, kick: 1.3 },
    ads: 0.27, moveSpeed: 0.95, sound: 'rifle762', defaultOptic: 'iron',
  }),
  W({
    id: 'ak74m', name: 'AK-74M', category: 'AR', caliber: '5.45×39mm',
    desc: 'Modernised Kalashnikov with a flat-shooting high velocity round.',
    damage: [32, 24], range: [35, 110], rpm: 650, fireModes: ['auto', 'semi'],
    mag: 30, reserve: 150, reload: 2.4, reloadEmpty: 2.9, velocity: 900,
    spread: { hip: 2.8, ads: 0.08, move: 1.7, bloom: 0.13, max: 5.5 },
    recoil: { v: 0.48, h: 0.25, recover: 7, kick: 1.05 },
    ads: 0.26, moveSpeed: 0.96, sound: 'rifle545', defaultOptic: 'iron',
  }),
  W({
    id: 'scarh', name: 'SCAR-H', category: 'AR', caliber: '7.62×51mm NATO',
    desc: 'Battle rifle. Brutal damage at every range, 20 round magazine.',
    damage: [42, 33], range: [40, 140], rpm: 600, fireModes: ['auto', 'semi'],
    mag: 20, reserve: 100, reload: 2.4, reloadEmpty: 3.0, velocity: 790,
    spread: { hip: 3.0, ads: 0.07, move: 1.8, bloom: 0.2, max: 6 },
    recoil: { v: 0.82, h: 0.32, recover: 6, kick: 1.4 },
    ads: 0.28, moveSpeed: 0.94, sound: 'rifle308', defaultOptic: 'acog', penetration: 2,
  }),
  W({
    id: 'aug', name: 'AUG A3', category: 'AR', caliber: '5.56×45mm NATO',
    desc: 'Bullpup rifle with a long barrel in a compact package. Very stable.',
    damage: [30, 23], range: [40, 120], rpm: 720, fireModes: ['auto', 'semi'],
    mag: 30, reserve: 150, reload: 2.6, reloadEmpty: 3.1, velocity: 940,
    spread: { hip: 2.6, ads: 0.06, move: 1.6, bloom: 0.11, max: 5 },
    recoil: { v: 0.36, h: 0.18, recover: 8, kick: 0.9 },
    ads: 0.27, moveSpeed: 0.96, sound: 'rifle556', bullpup: true, defaultOptic: 'acog',
  }),
  W({
    id: 'f2000', name: 'F2000', category: 'AR', caliber: '5.56×45mm NATO',
    desc: 'Futuristic bullpup with forward ejection and a blistering fire rate.',
    damage: [29, 21], range: [35, 105], rpm: 850, fireModes: ['auto', 'semi'],
    mag: 30, reserve: 150, reload: 2.5, reloadEmpty: 3.0, velocity: 910,
    spread: { hip: 2.5, ads: 0.07, move: 1.5, bloom: 0.12, max: 5 },
    recoil: { v: 0.4, h: 0.21, recover: 8, kick: 0.95 },
    ads: 0.25, moveSpeed: 0.97, sound: 'rifle556', bullpup: true, defaultOptic: 'reddot',
  }),
  W({
    id: 'g36c', name: 'G36C', category: 'AR', caliber: '5.56×45mm NATO',
    desc: 'Compact polymer carbine. Light, quick to aim, modest range.',
    damage: [29, 20], range: [30, 95], rpm: 750, fireModes: ['auto', 'semi'],
    mag: 30, reserve: 150, reload: 2.1, reloadEmpty: 2.6, velocity: 850,
    spread: { hip: 2.4, ads: 0.08, move: 1.4, bloom: 0.12, max: 5 },
    recoil: { v: 0.4, h: 0.2, recover: 8, kick: 0.95 },
    ads: 0.22, moveSpeed: 0.99, sound: 'rifle556', defaultOptic: 'holo',
  }),

  // ---------------------------------------------------------------- SMGs
  W({
    id: 'mp5', name: 'MP5A3', category: 'SMG', caliber: '9×19mm',
    desc: 'Smooth, accurate roller-delayed SMG. Great hipfire.',
    damage: [26, 15], range: [15, 45], rpm: 800, fireModes: ['auto', 'burst', 'semi'],
    mag: 30, reserve: 180, reload: 2.0, reloadEmpty: 2.5, velocity: 400,
    spread: { hip: 1.8, ads: 0.12, move: 0.8, bloom: 0.1, max: 4 },
    recoil: { v: 0.28, h: 0.18, recover: 9, kick: 0.7 },
    ads: 0.18, moveSpeed: 1.04, sound: 'smg9', shell: 'pistol', defaultOptic: 'iron',
    optics: ['iron', 'reddot', 'holo'],
  }),
  W({
    id: 'p90', name: 'P90', category: 'SMG', caliber: 'FN 5.7×28mm',
    desc: 'Top-loading 50 round PDW. Huge magazine, fast handling.',
    damage: [24, 16], range: [15, 50], rpm: 900, fireModes: ['auto', 'semi'],
    mag: 50, reserve: 200, reload: 2.7, reloadEmpty: 3.2, velocity: 715,
    spread: { hip: 1.9, ads: 0.12, move: 0.8, bloom: 0.09, max: 4 },
    recoil: { v: 0.24, h: 0.17, recover: 9, kick: 0.65 },
    ads: 0.18, moveSpeed: 1.04, sound: 'smg57', shell: 'pistol', bullpup: true, defaultOptic: 'reddot',
    optics: ['iron', 'reddot', 'holo'], grips: ['none'],
  }),
  W({
    id: 'vector', name: 'Vector .45', category: 'SMG', caliber: '.45 ACP',
    desc: 'Super V recoil system. Insane fire rate up close.',
    damage: [27, 14], range: [12, 35], rpm: 1100, fireModes: ['auto', 'burst', 'semi'],
    mag: 25, reserve: 175, reload: 2.1, reloadEmpty: 2.6, velocity: 290,
    spread: { hip: 2.0, ads: 0.14, move: 0.8, bloom: 0.1, max: 4.2 },
    recoil: { v: 0.22, h: 0.2, recover: 10, kick: 0.6 },
    ads: 0.17, moveSpeed: 1.05, sound: 'smg45', shell: 'pistol', defaultOptic: 'reddot',
    optics: ['iron', 'reddot', 'holo'],
  }),
  W({
    id: 'ump45', name: 'UMP45', category: 'SMG', caliber: '.45 ACP',
    desc: 'Slow-firing .45 SMG with a strong punch per round.',
    damage: [32, 18], range: [15, 45], rpm: 600, fireModes: ['auto', 'burst', 'semi'],
    mag: 25, reserve: 150, reload: 2.2, reloadEmpty: 2.7, velocity: 300,
    spread: { hip: 2.0, ads: 0.12, move: 0.9, bloom: 0.12, max: 4.2 },
    recoil: { v: 0.32, h: 0.2, recover: 9, kick: 0.75 },
    ads: 0.19, moveSpeed: 1.03, sound: 'smg45', shell: 'pistol', defaultOptic: 'holo',
    optics: ['iron', 'reddot', 'holo'],
  }),
  W({
    id: 'mp7', name: 'MP7', category: 'SMG', caliber: 'HK 4.6×30mm',
    desc: 'Tiny PDW with armour-piercing rounds and a high rate of fire.',
    damage: [25, 16], range: [15, 50], rpm: 950, fireModes: ['auto', 'semi'],
    mag: 40, reserve: 200, reload: 2.0, reloadEmpty: 2.4, velocity: 735,
    spread: { hip: 1.8, ads: 0.12, move: 0.7, bloom: 0.09, max: 4 },
    recoil: { v: 0.26, h: 0.19, recover: 10, kick: 0.6 },
    ads: 0.16, moveSpeed: 1.05, sound: 'smg46', shell: 'pistol', defaultOptic: 'reddot',
    optics: ['iron', 'reddot', 'holo'],
  }),

  // ---------------------------------------------------------------- LMGs
  W({
    id: 'm249', name: 'M249 SAW', category: 'LMG', caliber: '5.56×45mm NATO',
    desc: '100 round belt-fed suppressive fire. Slow to aim and reload.',
    damage: [30, 23], range: [40, 120], rpm: 800, fireModes: ['auto'],
    mag: 100, reserve: 200, reload: 5.4, reloadEmpty: 6.0, velocity: 915,
    spread: { hip: 3.4, ads: 0.12, move: 2.2, bloom: 0.1, max: 6 },
    recoil: { v: 0.36, h: 0.3, recover: 6, kick: 1.0 },
    ads: 0.4, moveSpeed: 0.86, sound: 'lmg556', bipod: true, defaultOptic: 'iron', equipTime: 0.9,
    muzzles: ['flash', 'comp'],
  }),
  W({
    id: 'pkm', name: 'PKM', category: 'LMG', caliber: '7.62×54mmR',
    desc: 'Full-power machine gun. Shreds cover and anyone behind it.',
    damage: [40, 31], range: [45, 140], rpm: 650, fireModes: ['auto'],
    mag: 100, reserve: 200, reload: 6.0, reloadEmpty: 6.6, velocity: 825,
    spread: { hip: 3.8, ads: 0.14, move: 2.4, bloom: 0.14, max: 6.5 },
    recoil: { v: 0.55, h: 0.4, recover: 5, kick: 1.3 },
    ads: 0.45, moveSpeed: 0.84, sound: 'lmg762', bipod: true, defaultOptic: 'iron', equipTime: 1.0,
    penetration: 2, muzzles: ['flash', 'comp'], optics: ['iron', 'reddot', 'holo', 'pso'],
  }),

  // ---------------------------------------------------------------- DMRs
  W({
    id: 'svd', name: 'SVD Dragunov', category: 'DMR', caliber: '7.62×54mmR',
    desc: 'Semi-automatic marksman rifle with the classic PSO-1 scope.',
    damage: [68, 52], range: [60, 250], rpm: 280, fireModes: ['semi'],
    mag: 10, reserve: 50, reload: 2.7, reloadEmpty: 3.2, velocity: 830,
    spread: { hip: 4.5, ads: 0.03, move: 2.5, bloom: 0.6, max: 7 },
    recoil: { v: 1.6, h: 0.4, recover: 5, kick: 1.8 },
    ads: 0.32, moveSpeed: 0.93, sound: 'dmr762', headMult: 2.2, penetration: 2,
    optics: ['iron', 'pso', 'acog', 'scope8'], defaultOptic: 'pso', muzzles: ['flash', 'suppressor'],
    grips: ['none'],
  }),
  W({
    id: 'mk14', name: 'Mk14 EBR', category: 'DMR', caliber: '7.62×51mm NATO',
    desc: 'Enhanced battle rifle chassis. Fast follow-up shots.',
    damage: [60, 46], range: [50, 220], rpm: 340, fireModes: ['semi'],
    mag: 20, reserve: 80, reload: 2.6, reloadEmpty: 3.1, velocity: 850,
    spread: { hip: 4.0, ads: 0.035, move: 2.4, bloom: 0.5, max: 7 },
    recoil: { v: 1.25, h: 0.35, recover: 6, kick: 1.6 },
    ads: 0.3, moveSpeed: 0.93, sound: 'dmr308', headMult: 2.2, penetration: 2,
    optics: ['reddot', 'holo', 'acog', 'scope8'], defaultOptic: 'acog', muzzles: AR_MUZZLES,
  }),
  W({
    id: 'm110', name: 'M110 SASS', category: 'DMR', caliber: '7.62×51mm NATO',
    desc: 'Precision semi-auto sniper system with a free-floating barrel.',
    damage: [64, 50], range: [60, 260], rpm: 300, fireModes: ['semi'],
    mag: 20, reserve: 80, reload: 2.6, reloadEmpty: 3.1, velocity: 860,
    spread: { hip: 4.2, ads: 0.025, move: 2.5, bloom: 0.55, max: 7 },
    recoil: { v: 1.35, h: 0.3, recover: 6, kick: 1.6 },
    ads: 0.32, moveSpeed: 0.92, sound: 'dmr308', headMult: 2.2, penetration: 2, bipod: true,
    optics: ['reddot', 'acog', 'scope8'], defaultOptic: 'scope8', muzzles: AR_MUZZLES,
  }),

  // ---------------------------------------------------------------- Sniper rifles
  W({
    id: 'm24', name: 'M24 SWS', category: 'SNIPER', caliber: '7.62×51mm NATO',
    desc: 'Bolt-action precision. Headshots are lethal at any range.',
    damage: [92, 82], range: [100, 400], rpm: 48, fireModes: ['bolt'],
    mag: 5, reserve: 30, reload: 3.0, reloadEmpty: 3.4, velocity: 850,
    spread: { hip: 5.0, ads: 0.01, move: 3, bloom: 0, max: 8 },
    recoil: { v: 2.6, h: 0.5, recover: 4, kick: 2.4 },
    ads: 0.36, moveSpeed: 0.92, sound: 'sniper308', headMult: 3.0, penetration: 2,
    optics: ['acog', 'scope8'], defaultOptic: 'scope8', muzzles: ['flash', 'suppressor'], grips: ['none'],
    reloadType: 'shell', bipod: true,
  }),
  W({
    id: 'awm', name: 'AWM', category: 'SNIPER', caliber: '.338 Lapua Magnum',
    desc: 'Magnum bolt-action. One shot to the upper body is a kill.',
    damage: [115, 100], range: [120, 500], rpm: 40, fireModes: ['bolt'],
    mag: 5, reserve: 25, reload: 3.4, reloadEmpty: 3.8, velocity: 910,
    spread: { hip: 5.5, ads: 0.008, move: 3.2, bloom: 0, max: 8 },
    recoil: { v: 3.2, h: 0.6, recover: 4, kick: 2.8 },
    ads: 0.42, moveSpeed: 0.89, sound: 'sniper338', headMult: 3.0, penetration: 3, shell: 'big',
    optics: ['scope8', 'acog'], defaultOptic: 'scope8', muzzles: ['comp', 'suppressor'], defaultMuzzle: 'comp',
    grips: ['none'], bipod: true, equipTime: 0.8,
  }),
  W({
    id: 'm82', name: 'Barrett M82A1', category: 'SNIPER', caliber: '.50 BMG',
    desc: 'Semi-auto anti-materiel rifle. Nothing survives a hit.',
    damage: [150, 140], range: [150, 700], rpm: 110, fireModes: ['semi'],
    mag: 10, reserve: 20, reload: 4.2, reloadEmpty: 4.8, velocity: 853,
    spread: { hip: 7.0, ads: 0.012, move: 4, bloom: 1.5, max: 10 },
    recoil: { v: 4.2, h: 0.9, recover: 3.5, kick: 3.5 },
    ads: 0.5, moveSpeed: 0.82, sound: 'sniper50', headMult: 2.0, penetration: 4, shell: 'big',
    optics: ['scope8'], defaultOptic: 'scope8', muzzles: ['none'], defaultMuzzle: 'none',
    grips: ['none'], bipod: true, equipTime: 1.1,
  }),

  // ---------------------------------------------------------------- Shotguns
  W({
    id: 'r870', name: 'Remington 870', category: 'SHOTGUN', caliber: '12 gauge',
    desc: 'Pump-action 12 gauge. Devastating at close range.',
    damage: [15, 4], range: [8, 30], rpm: 70, fireModes: ['pump'], pellets: 9,
    mag: 6, reserve: 36, reload: 0.5, reloadEmpty: 0.5, velocity: 400,
    spread: { hip: 4.6, ads: 3.4, move: 1.0, bloom: 0, max: 6 },
    recoil: { v: 2.2, h: 0.6, recover: 5, kick: 2.2 },
    ads: 0.24, moveSpeed: 0.98, sound: 'shotgun', shell: 'shotgun', headMult: 1.5, reloadType: 'shell',
    optics: ['iron', 'reddot', 'holo'], muzzles: ['none'], defaultMuzzle: 'none', grips: ['none'],
  }),
  W({
    id: 'm1014', name: 'M1014', category: 'SHOTGUN', caliber: '12 gauge',
    desc: 'Semi-automatic combat shotgun. Fast follow up blasts.',
    damage: [13, 3], range: [8, 28], rpm: 200, fireModes: ['semi'], pellets: 8,
    mag: 7, reserve: 35, reload: 0.45, reloadEmpty: 0.45, velocity: 400,
    spread: { hip: 4.8, ads: 3.6, move: 1.0, bloom: 0.4, max: 6.5 },
    recoil: { v: 1.9, h: 0.6, recover: 6, kick: 1.9 },
    ads: 0.25, moveSpeed: 0.97, sound: 'shotgun', shell: 'shotgun', headMult: 1.5, reloadType: 'shell',
    optics: ['iron', 'reddot', 'holo'], muzzles: ['none'], defaultMuzzle: 'none', grips: ['none'],
  }),
  W({
    id: 'saiga12', name: 'Saiga-12', category: 'SHOTGUN', caliber: '12 gauge',
    desc: 'Kalashnikov-pattern shotgun with box magazines.',
    damage: [12, 3], range: [7, 26], rpm: 260, fireModes: ['semi'], pellets: 8,
    mag: 8, reserve: 32, reload: 2.6, reloadEmpty: 3.1, velocity: 400,
    spread: { hip: 5.0, ads: 3.8, move: 1.0, bloom: 0.5, max: 7 },
    recoil: { v: 1.8, h: 0.7, recover: 6, kick: 1.8 },
    ads: 0.26, moveSpeed: 0.96, sound: 'shotgun', shell: 'shotgun', headMult: 1.5,
    optics: ['iron', 'reddot', 'holo'], muzzles: ['none'], defaultMuzzle: 'none', grips: ['none', 'vertical'],
  }),

  // ---------------------------------------------------------------- Pistols
  W({
    id: 'glock18', name: 'Glock 18C', category: 'PISTOL', caliber: '9×19mm',
    desc: 'Select-fire pistol. Spray up close in full auto.',
    damage: [22, 14], range: [10, 35], rpm: 1100, fireModes: ['semi', 'auto'],
    mag: 19, reserve: 95, reload: 1.6, reloadEmpty: 1.9, velocity: 375,
    spread: { hip: 1.6, ads: 0.25, move: 0.6, bloom: 0.25, max: 4 },
    recoil: { v: 0.42, h: 0.3, recover: 10, kick: 0.6 },
    ads: 0.14, sound: 'pistol9', shell: 'pistol', optics: ['iron', 'reddot'],
    muzzles: ['none', 'suppressor'], defaultMuzzle: 'none', grips: ['none'], equipTime: 0.35,
  }),
  W({
    id: 'm9', name: 'M9 Beretta', category: 'PISTOL', caliber: '9×19mm',
    desc: 'Accurate service pistol with a 15 round magazine.',
    damage: [25, 15], range: [12, 40], rpm: 420, fireModes: ['semi'],
    mag: 15, reserve: 90, reload: 1.6, reloadEmpty: 1.9, velocity: 380,
    spread: { hip: 1.4, ads: 0.2, move: 0.6, bloom: 0.3, max: 4 },
    recoil: { v: 0.6, h: 0.22, recover: 10, kick: 0.7 },
    ads: 0.14, sound: 'pistol9', shell: 'pistol', optics: ['iron', 'reddot'],
    muzzles: ['none', 'suppressor'], defaultMuzzle: 'none', grips: ['none'], equipTime: 0.35,
  }),
  W({
    id: 'm1911', name: 'M1911', category: 'PISTOL', caliber: '.45 ACP',
    desc: 'A century old and still hits like a truck.',
    damage: [34, 20], range: [12, 35], rpm: 380, fireModes: ['semi'],
    mag: 8, reserve: 64, reload: 1.7, reloadEmpty: 2.0, velocity: 255,
    spread: { hip: 1.5, ads: 0.22, move: 0.6, bloom: 0.35, max: 4 },
    recoil: { v: 0.85, h: 0.25, recover: 9, kick: 0.85 },
    ads: 0.15, sound: 'pistol45', shell: 'pistol', optics: ['iron', 'reddot'],
    muzzles: ['none', 'suppressor'], defaultMuzzle: 'none', grips: ['none'], equipTime: 0.35,
  }),
  W({
    id: 'deagle', name: 'Desert Eagle', category: 'PISTOL', caliber: '.50 AE',
    desc: 'Hand cannon. Two body shots or one to the head.',
    damage: [52, 36], range: [15, 50], rpm: 200, fireModes: ['semi'],
    mag: 7, reserve: 35, reload: 2.0, reloadEmpty: 2.3, velocity: 470,
    spread: { hip: 2.2, ads: 0.15, move: 1.0, bloom: 0.8, max: 5 },
    recoil: { v: 2.0, h: 0.5, recover: 6, kick: 1.8 },
    ads: 0.18, moveSpeed: 0.98, sound: 'pistol50', shell: 'pistol', headMult: 2.0,
    optics: ['iron', 'reddot'], muzzles: ['none'], defaultMuzzle: 'none', grips: ['none'], equipTime: 0.45,
  }),
  W({
    id: 'r357', name: '.357 Revolver', category: 'PISTOL', caliber: '.357 Magnum',
    desc: 'Six shots of magnum power with a speedloader.',
    damage: [55, 38], range: [15, 45], rpm: 150, fireModes: ['semi'],
    mag: 6, reserve: 36, reload: 2.8, reloadEmpty: 2.8, velocity: 440,
    spread: { hip: 1.8, ads: 0.12, move: 0.9, bloom: 0.8, max: 5 },
    recoil: { v: 1.9, h: 0.45, recover: 6, kick: 1.7 },
    ads: 0.17, sound: 'revolver', shell: 'none', reloadType: 'speedloader', headMult: 2.0,
    optics: ['iron'], muzzles: ['none'], defaultMuzzle: 'none', grips: ['none'], equipTime: 0.4,
  }),
];

export const WEAPONS = Object.fromEntries(WEAPON_LIST.map((w) => [w.id, w]));
export const PRIMARY_WEAPONS = WEAPON_LIST.filter((w) => w.slot === 'primary');
export const SECONDARY_WEAPONS = WEAPON_LIST.filter((w) => w.slot === 'secondary');

// Throwables / melee.
export const EQUIPMENT = {
  frag: { id: 'frag', name: 'M67 Frag Grenade', fuse: 3.5, damage: 140, radius: 9, innerRadius: 2.5, throwSpeed: 18 },
  smoke: { id: 'smoke', name: 'M18 Smoke Grenade', fuse: 1.8, duration: 28, radius: 9, throwSpeed: 17 },
  knife: { id: 'knife', name: 'Combat Knife', damage: 60, backstab: 100, range: 2.0, cooldown: 0.65 },
};

export const HIT_ZONES = { HEAD: 0, TORSO: 1, LIMB: 2 };

/** Damage of one projectile/pellet against a zone at a distance (meters). */
export function computeDamage(weapon, distance, zone, muzzleId = 'flash') {
  const w = typeof weapon === 'string' ? WEAPONS[weapon] : weapon;
  if (!w) return 0;
  const m = MUZZLES[muzzleId] || MUZZLES.flash;
  const r0 = w.range[0] * m.range;
  const r1 = w.range[1] * m.range;
  let dmg;
  if (distance <= r0) dmg = w.damage[0];
  else if (distance >= r1) dmg = w.damage[1];
  else dmg = w.damage[0] + (w.damage[1] - w.damage[0]) * ((distance - r0) / (r1 - r0));
  if (zone === HIT_ZONES.HEAD) dmg *= w.headMult;
  else if (zone === HIT_ZONES.LIMB) dmg *= w.limbMult;
  return Math.round(dmg * 10) / 10;
}

/** Seconds between shots. */
export function fireInterval(weapon) {
  return 60 / weapon.rpm;
}

export function defaultAttachments(weaponId) {
  const w = WEAPONS[weaponId];
  return { optic: w.defaultOptic, muzzle: w.defaultMuzzle, grip: w.defaultGrip };
}

export function defaultLoadout() {
  return {
    primary: 'm4a1',
    primaryAtt: defaultAttachments('m4a1'),
    secondary: 'm9',
    secondaryAtt: defaultAttachments('m9'),
    lethal: 'frag',
    tactical: 'smoke',
  };
}

/** Validate a loadout coming from an untrusted client; fills invalid parts with defaults. */
export function sanitizeLoadout(l) {
  const d = defaultLoadout();
  if (!l || typeof l !== 'object') return d;
  const out = { ...d };
  const fixAtt = (wid, att) => {
    const w = WEAPONS[wid];
    const a = defaultAttachments(wid);
    if (att && typeof att === 'object') {
      if (w.optics.includes(att.optic)) a.optic = att.optic;
      if (w.muzzles.includes(att.muzzle)) a.muzzle = att.muzzle;
      if (w.grips.includes(att.grip)) a.grip = att.grip;
    }
    return a;
  };
  if (WEAPONS[l.primary] && WEAPONS[l.primary].slot === 'primary') out.primary = l.primary;
  if (WEAPONS[l.secondary] && WEAPONS[l.secondary].slot === 'secondary') out.secondary = l.secondary;
  out.primaryAtt = fixAtt(out.primary, l.primaryAtt);
  out.secondaryAtt = fixAtt(out.secondary, l.secondaryAtt);
  out.lethal = 'frag';
  out.tactical = 'smoke';
  return out;
}

/** Effective recoil/ads stats after attachments. */
export function weaponHandling(weaponId, att = {}) {
  const w = WEAPONS[weaponId];
  const optic = OPTICS[att.optic] || OPTICS[w.defaultOptic];
  const muzzle = MUZZLES[att.muzzle] || MUZZLES[w.defaultMuzzle];
  const grip = GRIPS[att.grip] || GRIPS.none;
  return {
    recoilV: w.recoil.v * muzzle.recoilV * grip.recoilV,
    recoilH: w.recoil.h * muzzle.recoilH * grip.recoilH,
    adsTime: w.ads * optic.adsTimeMult * grip.adsTimeMult,
    zoom: optic.zoom,
    magnification: optic.magnification || 1,
    pip: optic.pip,
    suppressed: muzzle.suppressed,
    optic, muzzle, grip,
  };
}

// UI stat bars (0..1) for the loadout screen.
export function weaponStatBars(w) {
  const clamp = (v) => Math.max(0.05, Math.min(1, v));
  const dps = (w.damage[0] * w.pellets * w.rpm) / 60;
  return {
    damage: clamp((w.damage[0] * w.pellets) / 130),
    fireRate: clamp(w.rpm / 1100),
    range: clamp(w.range[1] / 500),
    accuracy: clamp(1 - w.spread.hip / 7.5),
    control: clamp(1 - w.recoil.v / 3.5),
    mobility: clamp((w.moveSpeed - 0.78) / 0.28),
    dps: clamp(dps / 600),
  };
}

/** Compact numeric ids for network snapshots. */
export const WEAPON_INDEX = Object.fromEntries(WEAPON_LIST.map((w, i) => [w.id, i]));
export function weaponByIndex(i) {
  return WEAPON_LIST[i] || null;
}
