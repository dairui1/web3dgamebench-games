// Canyon Strike - deterministic procedural world model.
// Pure data + maths (no three.js import) so simulation and rendering share it.
import { clamp, fbm, hash2, lerp, mixc, smoothstep, Rand } from './rng';

export const CHUNK = 32; // metres per streamed chunk
export const VIEW = 4; // chunk radius kept resident (9x9 grid)
export const SEG = 8; // quads per chunk edge
export const Q = CHUNK / SEG;
export const BOUND = 470; // gameplay radius in metres
export const DAY_LENGTH = 480; // seconds for one 24h cycle (8 real minutes)
export const TOWN = { x: 0, z: 0 };

/** The canyon road: a washed out gravel route running east-west. */
export function roadZ(x: number): number {
  return 8 * Math.sin(x * 0.0052) + 4 * Math.sin(x * 0.0131 + 1.7) + 2 * Math.sin(x * 0.031 + 0.4);
}
/** The river: braided with the road's neighbourhood, crossing it twice. */
export function riverZ(x: number): number {
  return roadZ(x) - 56 + 62 * Math.sin(x * 0.0045 + 2.0);
}
/** Badlands uplift mask (red rock mesas to the east). */
export function badMask(x: number, z: number): number {
  return smoothstep(90, 220, x) * (0.55 + 0.45 * fbm(x * 0.004, z * 0.004, 2));
}

function ridge(x: number, z: number): number {
  const d = Math.abs(z - riverZ(x));
  return Math.pow(clamp((d - 44) / 155, 0, 1), 1.7) * 92;
}

/** Height before roads/ponds are carved: used as a reference surface. */
export function raw(x: number, z: number): number {
  let h = (fbm(x * 0.0031 + 11.3, z * 0.0031 + 7.7, 4) - 0.5) * 34;
  h += (fbm(x * 0.0125 + 3.1, z * 0.0125 + 5.5, 2) - 0.5) * 7.5;
  h += ridge(x, z);
  h += badMask(x, z) * 14;
  return h;
}

export function roadLevel(x: number): number {
  return raw(x, roadZ(x));
}
export function riverLevel(x: number): number {
  return raw(x, riverZ(x)) - 1.9;
}
/** Flatten the approach of the road into the town plaza. */
export const PLAZA = { x: 0, z: roadZ(0) + 4 };
export const PLAZA_LEVEL = raw(PLAZA.x, PLAZA.z);

export interface Water {
  x: number;
  z: number;
  r: number;
  depth: number;
  level: number;
  kind: 'pond' | 'lake';
}

/** Six named surface-water bodies that feed the wetlands. */
export const waters: Water[] = [
  { kind: 'pond', x: -150, z: riverZ(-150) + 14, r: 26, depth: 3.4, level: 0 },
  { kind: 'pond', x: -60, z: riverZ(-60) - 20, r: 19, depth: 3.0, level: 0 },
  { kind: 'pond', x: 62, z: riverZ(62) + 17, r: 22, depth: 3.1, level: 0 },
  { kind: 'lake', x: 190, z: riverZ(190) - 34, r: 40, depth: 4.4, level: 0 },
  { kind: 'pond', x: -268, z: riverZ(-268) + 20, r: 23, depth: 3.2, level: 0 },
  { kind: 'pond', x: 320, z: riverZ(320) + 26, r: 20, depth: 3.0, level: 0 },
];
for (const w of waters) w.level = raw(w.x, w.z) - w.depth * 0.62;

/** Terrain height including road flattening and water carved bowls. */
export function ground(x: number, z: number): number {
  let h = raw(x, z);
  const dr = Math.abs(z - riverZ(x));
  if (dr < 17) h -= 4.2 * (1 - smoothstep(3, 17, dr));
  for (let i = 0; i < waters.length; i++) {
    const w = waters[i];
    const dx = x - w.x;
    const dz = z - w.z;
    const rr = w.r + 13;
    if (dx * dx + dz * dz < rr * rr) {
      const d = Math.sqrt(dx * dx + dz * dz);
      h -= w.depth * (1 - (d / rr) * (d / rr));
    }
  }
  const drd = Math.abs(z - roadZ(x));
  if (drd < 27) {
    const w = 0.94 * (1 - smoothstep(5.5, 27, drd));
    h = lerp(h, roadLevel(x), w);
  }
  const dpx = x - PLAZA.x;
  const dpz = z - PLAZA.z;
  const dp = Math.sqrt(dpx * dpx + dpz * dpz);
  if (dp < 40) {
    const w = 0.92 * (1 - smoothstep(22, 40, dp));
    h = lerp(h, PLAZA_LEVEL, w);
  }
  return h;
}

export function slopeAt(x: number, z: number): number {
  const e = 2.2;
  const gx = (ground(x + e, z) - ground(x - e, z)) / (2 * e);
  const gz = (ground(x, z + e) - ground(x, z - e)) / (2 * e);
  return Math.sqrt(gx * gx + gz * gz);
}

/** Is the spot covered by standing water? */
export function waterAt(x: number, z: number): number {
  const rl = riverLevel(x);
  if (Math.abs(z - riverZ(x)) < 11.5 && ground(x, z) < rl + 0.9) return rl;
  for (let i = 0; i < waters.length; i++) {
    const w = waters[i];
    const dx = x - w.x;
    const dz = z - w.z;
    if (dx * dx + dz * dz < w.r * w.r && ground(x, z) < w.level + 0.7) return w.level;
  }
  return -1e9;
}

export type Biome = 'town' | 'wetland' | 'sage' | 'rock' | 'alpine' | 'badlands';
export type Surface = 'road' | 'gravel' | 'sand' | 'mud' | 'grass' | 'rock' | 'snow';

export function biomeAt(x: number, z: number): Biome {
  const h = ground(x, z);
  if (Math.hypot(x - PLAZA.x, z - PLAZA.z) < 62) return 'town';
  if (h > 62) return 'alpine';
  if (badMask(x, z) > 0.35) return 'badlands';
  if (Math.abs(z - riverZ(x)) < 26 || waterAt(x, z) > -1e8) return 'wetland';
  if (h > 34 || slopeAt(x, z) > 0.62) return 'rock';
  return 'sage';
}

export function surfaceAt(x: number, z: number, h?: number, sl?: number): Surface {
  const hh = h === undefined ? ground(x, z) : h;
  const ss = sl === undefined ? slopeAt(x, z) : sl;
  if (Math.abs(z - roadZ(x)) < 7.4 || Math.hypot(x - PLAZA.x, z - PLAZA.z) < 26) return 'gravel';
  if (waterAt(x, z) > -1e8 || hh < waterAt(x, z) + 2.2) return 'mud';
  if (hh > 60) return 'snow';
  if (ss > 0.72) return 'rock';
  if (hh < 6 && Math.abs(z - riverZ(x)) < 20) return 'sand';
  if (hh > 40) return 'rock';
  return 'grass';
}

const COL = {
  snow: 0xe6ecf0,
  ice: 0xc3d6de,
  rock: 0x7c7168,
  darkRock: 0x565049,
  redRock: 0x9d5f41,
  redDark: 0x7a4530,
  grass: 0x6c7d4b,
  grassDry: 0x9a9160,
  sage: 0x87906a,
  mud: 0x6a5d46,
  sand: 0xc1ab7f,
  gravel: 0x9b8f79,
  road: 0xa3957c,
  wet: 0x4f6a45,
};

/** Terrain vertex colour (also used by the minimap). */
export function groundColor(x: number, z: number, h: number, sl: number): number {
  const v = fbm(x * 0.055, z * 0.055, 2);
  const bad = badMask(x, z);
  let c: number;
  const surf = surfaceAt(x, z, h, sl);
  switch (surf) {
    case 'gravel':
      c = mixc(COL.gravel, COL.road, 0.35 + 0.4 * v);
      break;
    case 'mud':
      c = mixc(COL.mud, COL.wet, 0.3 + 0.4 * v);
      break;
    case 'sand':
      c = mixc(COL.sand, COL.gravel, 0.25 * v);
      break;
    case 'rock':
      c = mixc(COL.darkRock, COL.rock, 0.35 + 0.5 * v);
      break;
    case 'snow':
      c = mixc(COL.ice, COL.snow, 0.5 + 0.5 * v);
      break;
    default:
      c = mixc(COL.grass, COL.grassDry, smoothstep(0, 26, h) * 0.6 + 0.35 * v);
      c = mixc(c, COL.sage, 0.3 * v);
      break;
  }
  if (bad > 0.1 && surf !== 'snow') c = mixc(c, COL.redRock, bad * 0.72);
  if (h > 48) c = mixc(c, COL.snow, smoothstep(48, 66, h));
  if (sl > 0.85) c = mixc(c, bad > 0.4 ? COL.redDark : COL.darkRock, 0.55);
  return c;
}

// ---------------------------------------------------------------- sites ------
export type SiteId = 'th' | 'outpost' | 'refinery' | 'lab' | 'comms';

export interface SiteDef {
  id: SiteId;
  name: string;
  short: string;
  x: number;
  z: number;
  radius: number; // capture radius
  kind: 'townhall' | 'outpost' | 'refinery' | 'lab' | 'comms';
  power: number; // + generates, - consumes
  startOwned: boolean;
  hp: number;
  turret: number;
  desc: string;
}

export const sites: SiteDef[] = [
  {
    id: 'th',
    name: 'Town Hall',
    short: 'TH',
    x: PLAZA.x,
    z: PLAZA.z + 20,
    radius: 16,
    kind: 'townhall',
    power: 80,
    startOwned: true,
    hp: 1100,
    turret: 2,
    desc: 'Seat of the canyon council. Generator, drop-off and rally.',
  },
  {
    id: 'outpost',
    name: 'Solar Outpost',
    short: 'OUT',
    x: -232,
    z: roadZ(-232) - 24,
    radius: 16,
    kind: 'outpost',
    power: 30,
    startOwned: false,
    hp: 620,
    turret: 1,
    desc: 'Panel farm and battery shed. Adds +30 power and one worker.',
  },
  {
    id: 'refinery',
    name: 'Water Refinery',
    short: 'REF',
    x: 244,
    z: roadZ(244) + 30,
    radius: 17,
    kind: 'refinery',
    power: -20,
    startOwned: false,
    hp: 700,
    turret: 1,
    desc: 'Old processing plant. +3.2 water/s, battery bank, ammo line.',
  },
  {
    id: 'lab',
    name: 'Research Lab',
    short: 'LAB',
    x: -128,
    z: riverZ(-128) - 44,
    radius: 16,
    kind: 'lab',
    power: -30,
    startOwned: false,
    hp: 560,
    turret: 0,
    desc: 'Off-road bunker. Unlocks Gunners, Napalm and field repairs.',
  },
  {
    id: 'comms',
    name: 'Comms Array',
    short: 'CMS',
    x: 148,
    z: riverZ(148) + 58,
    radius: 16,
    kind: 'comms',
    power: -15,
    startOwned: false,
    hp: 520,
    turret: 0,
    desc: 'Repeater mast. Long range radar and a forward rally point.',
  },
];

// ----------------------------------------------------------- resource nodes --
export interface ResNode {
  id: number;
  kind: 'petrol' | 'water';
  x: number;
  z: number;
  amount: number;
  max: number;
  label: string;
}

export const resNodes: ResNode[] = [
  { id: 1, kind: 'petrol', x: -74, z: roadZ(-74) + 26, amount: 460, max: 460, label: 'West Fuel Cache' },
  { id: 2, kind: 'water', x: 96, z: roadZ(96) - 22, amount: 520, max: 520, label: 'East Water Cache' },
  { id: 3, kind: 'petrol', x: -206, z: roadZ(-206) + 34, amount: 380, max: 380, label: 'Spilled Tanker' },
  { id: 4, kind: 'petrol', x: 188, z: roadZ(188) + 40, amount: 400, max: 400, label: 'Depot Sump' },
  { id: 5, kind: 'water', x: -4, z: 0, amount: 9999, max: 9999, label: 'River Ford' },
  { id: 6, kind: 'water', x: -150, z: 0, amount: 9999, max: 9999, label: 'Cattail Pond Shore' },
];
// river / pond nodes sit on the water itself
resNodes[4].z = riverZ(resNodes[4].x) + 9;
resNodes[5].x = waters[0].x;
resNodes[5].z = waters[0].z + waters[0].r * 0.5;

// ------------------------------------------------------------------- POIs ----
export interface Poi {
  kind: 'camp' | 'cache' | 'ruin' | 'water' | 'prop' | 'bridge' | 'dam';
  x: number;
  z: number;
  r: number;
  label: string;
}

export const pois: Poi[] = [];

export type StructType =
  | 'hangar'
  | 'barracks'
  | 'mess'
  | 'fueldepot'
  | 'tower'
  | 'watertank'
  | 'silo'
  | 'containers'
  | 'shed'
  | 'billboard'
  | 'pylon'
  | 'house'
  | 'diner'
  | 'church'
  | 'overpass'
  | 'mill'
  | 'corral'
  | 'section'
  | 'headframe'
  | 'bridge'
  | 'dam'
  | 'spillway'
  | 'mast'
  | 'radome'
  | 'traincar'
  | 'windmill'
  | 'truck'
  | 'bus'
  | 'tent'
  | 'shanty'
  | 'cratepile'
  | 'barrelpile'
  | 'debris'
  | 'rubble'
  | 'wallseg'
  | 'culvert';

export interface StructDef {
  t: StructType;
  x: number;
  z: number;
  ry: number;
  s: number;
  r: number; // collision / footprint radius
  poi: number; // index into pois, or -1
}

export const structs: StructDef[] = [];

function addPoi(kind: Poi['kind'], x: number, z: number, r: number, label: string): number {
  pois.push({ kind, x, z, r, label });
  return pois.length - 1;
}
function S(t: StructType, x: number, z: number, ry = 0, s = 1, r = 6, poi = -1): void {
  structs.push({ t, x, z, ry, s, r, poi });
}

// --- landmark POIs laid out along the road, west to east --------------------
{
  // Ruined overpass where the canyon road climbs the talus (1 of 5 ruins)
  const ox = -330;
  addPoi('ruin', ox, roadZ(ox) + 4, 26, 'Ruined Overpass');
  S('overpass', ox, roadZ(ox) + 2, 0.1, 1, 20, pois.length - 1);
  S('rubble', ox + 22, roadZ(ox + 22) + 8, 0.6, 1, 4);

  // Half-buried homestead row (5 houses) + collapsed bridge + debris field
  const hx = [-286, -238, -168, -104, 300];
  for (let i = 0; i < hx.length; i++) {
    const x = hx[i];
    const z = roadZ(x) + (i % 2 === 0 ? 30 : -34);
    addPoi('ruin', x, z, 10, 'Half-buried House ' + (i + 1));
    S('house', x, z, 0.3 + i * 0.7, 1, 6, pois.length - 1);
  }

  // Old Truss Bridge over the river, walkable deck, near town
  const bx = -4.2;
  addPoi('bridge', bx, riverZ(bx), 16, 'Old Truss Bridge');
  S('bridge', bx, riverZ(bx), Math.PI / 2, 1, 9, pois.length - 1);

  // Concrete dam + spillway downstream (feeds the wetlands)
  const dx = 268;
  addPoi('dam', dx, riverZ(dx), 20, 'Concrete Dam');
  S('dam', dx, riverZ(dx), Math.PI / 2, 1, 14, pois.length - 1);
  S('spillway', dx + 12, riverZ(dx) + 8, Math.PI / 2, 1, 8);

  // Ghost town: diner, church, mill, section house, corral
  const gx = 148;
  addPoi('ruin', gx, roadZ(gx) - 26, 30, 'Ghost Town "Dry Gulch"');
  const gp = pois.length - 1;
  S('diner', gx - 18, roadZ(gx - 18) - 26, 0.2, 1, 7, gp);
  S('church', gx + 6, roadZ(gx + 6) - 34, -0.3, 1, 8, gp);
  S('mill', gx + 26, roadZ(gx + 26) - 22, 0.5, 1, 8, gp);
  S('section', gx - 4, roadZ(gx - 4) - 12, 1.4, 1, 6, gp);
  S('corral', gx + 16, roadZ(gx + 16) - 4, 1.2, 1, 7, gp);
  S('bus', gx - 28, roadZ(gx - 28) - 14, 0.8, 1, 5, gp);

  // Wrecked train car + tanker spill (petrol flavour)
  const tx = 60;
  addPoi('ruin', tx, roadZ(tx) + 16, 14, 'Wrecked Rail Car');
  S('traincar', tx, roadZ(tx) + 16, 0.06, 1, 8, pois.length - 1);
  S('barrelpile', tx + 12, roadZ(tx + 12) + 22, 0.4, 1, 4);
  S('truck', -74, roadZ(-74) + 34, 1.1, 1, 4);

  // Abandoned windmill and grain silos
  const wx = -186;
  addPoi('prop', wx, roadZ(wx) - 30, 14, 'Abandoned Windmill');
  S('windmill', wx, roadZ(wx) - 30, 0, 1, 6, pois.length - 1);
  S('silo', wx + 14, roadZ(wx + 14) - 24, 0, 1, 5);
  S('silo', wx + 21, roadZ(wx + 21) - 22, 0, 1, 5);
  S('headframe', -392, roadZ(-392) + 40, 0.4, 1, 8);

  // Radio mast and radar dome on the ridge
  addPoi('prop', 356, riverZ(356) + 70, 14, 'Ridge Radio Mast');
  S('mast', 356, riverZ(356) + 70, 0, 1, 6, pois.length - 1);
  S('radome', 372, riverZ(372) + 62, 0, 1, 7);

  // Hostile camps (3)
  const camps: [number, number, string][] = [
    [-350, riverZ(-350) + 30, 'Ridge Camp'],
    [104, roadZ(104) + 62, 'Trestle Camp'],
    [-118, roadZ(-118) - 74, 'Arroyo Camp'],
  ];
  for (const [cx, cz, name] of camps) {
    addPoi('camp', cx, cz, 22, name);
    const p = pois.length - 1;
    S('tent', cx - 8, cz - 5, 0.4, 1, 4, p);
    S('tent', cx + 7, cz + 3, -0.9, 1, 4, p);
    S('tent', cx - 1, cz + 11, 2.1, 1, 4, p);
    S('shanty', cx + 13, cz - 9, 0.2, 1, 5, p);
    S('cratepile', cx - 13, cz + 6, 0.7, 1, 3, p);
    S('barrelpile', cx + 3, cz - 12, 0.1, 1, 3, p);
    S('wallseg', cx - 18, cz - 16, 0.2, 1, 3);
    S('wallseg', cx + 18, cz - 14, -0.4, 1, 3);
  }

  // Supply caches (4) - hidden stores worth credits
  const cch: [number, number][] = [[-46, -58], [70, 52], [206, -64], [-256, 46]];
  for (let i = 0; i < cch.length; i++) {
    const x = cch[i][0];
    const z = roadZ(x) + cch[i][1];
    addPoi('cache', x, z, 8, 'Supply Cache ' + (i + 1));
    S('cratepile', x, z, i * 0.8, 1, 3, pois.length - 1);
    S('debris', x + 5, z - 4, 1.2, 1, 2);
  }

  // Water bodies registered as POIs
  const wnames = ['Cattail Pond', 'Willow Pool', 'Mirror Pond', 'Dry Hollow Lake', 'Snag Pond', 'East Spring'];
  for (let i = 0; i < waters.length; i++) addPoi('water', waters[i].x, waters[i].z, waters[i].r, wnames[i]);

  // 14 scattered rock formations + 20 roadside props, seeded scatter
  const rnd = new Rand(90210);
  for (let i = 0; i < 14; i++) {
    const x = rnd.r(-430, 430);
    const z = roadZ(x) + rnd.r(-95, 95);
    addPoi('prop', x, z, 6, 'Rock Formation ' + (i + 1));
    S('debris', x, z, rnd.r(0, 6.28), 1 + rnd.u(), 3 + rnd.r(0, 3), pois.length - 1);
  }
  const propNames = ['Rusty Barrel', 'Ammo Crate', 'Dead Tree', 'Telephone Pole', 'Hay Bale', 'Farm Plough', 'Oil Drum', 'Signpost'];
  for (let i = 0; i < 20; i++) {
    const x = -420 + i * 42 + rnd.r(-9, 9);
    const z = roadZ(x) + (i % 2 === 0 ? 1 : -1) * rnd.r(9, 26);
    addPoi('prop', x, z, 4, propNames[i % propNames.length]);
    const t: StructType = i % 4 === 0 ? 'barrelpile' : i % 4 === 1 ? 'cratepile' : i % 4 === 2 ? 'debris' : 'culvert';
    S(t, x, z, rnd.r(0, 6.28), 1, 3, pois.length - 1);
  }

  // Power line pylons following the road
  for (let x = -300; x <= 300; x += 60) S('pylon', x, roadZ(x) - 40, 0, 1, 4);

  // Town outskirts: two billboards and a fuel depot
  S('billboard', -40, roadZ(-40) + 15, 0.1, 1, 4);
  S('billboard', 130, roadZ(130) - 16, Math.PI - 0.2, 1, 4);
  S('fueldepot', 34, roadZ(34) + 30, 0.3, 1, 8);
  S('culvert', -120, roadZ(-120) + 9, 1.57, 1, 3);
  S('culvert', 210, roadZ(210) + 9, 1.57, 1, 3);
}

/** Nearest POI index for a spot (used by tooltips / labels). */
export function nearestPoi(x: number, z: number): Poi | null {
  let best: Poi | null = null;
  let bd = 1e9;
  for (const p of pois) {
    const d = Math.hypot(p.x - x, p.z - z) - p.r;
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return bd < 30 ? best : null;
}

// ------------------------------------------------------ structure footprints -
/** Static collision circles derived from the structure list. */
export const obstacles: { x: number; z: number; r: number }[] = [];
for (const s of structs) if (s.r > 0) obstacles.push({ x: s.x, z: s.z, r: s.r * 0.85 });
const dynObs: { x: number; z: number; r: number; id: number }[] = [];
let dynId = 1;
export function addObstacle(x: number, z: number, r: number): number {
  const id = dynId++;
  dynObs.push({ x, z, r, id });
  navMarkArea(x, z, r + 2, true);
  return id;
}
export function delObstacle(id: number): void {
  const k = dynObs.findIndex((o) => o.id === id);
  if (k >= 0) {
    const o = dynObs[k];
    dynObs.splice(k, 1);
    navRebuildArea(o.x, o.z, o.r + 3);
  }
}
export function solidAt(x: number, z: number): boolean {
  for (const o of obstacles) {
    const dx = x - o.x;
    const dz = z - o.z;
    if (dx * dx + dz * dz < o.r * o.r) return true;
  }
  for (const o of dynObs) {
    const dx = x - o.x;
    const dz = z - o.z;
    if (dx * dx + dz * dz < o.r * o.r) return true;
  }
  return false;
}

// ------------------------------------------------------------- vegetation ----
export interface Veg {
  t: 'pine' | 'juniper' | 'sage' | 'grass' | 'reed' | 'cattail' | 'rock' | 'dead' | 'cactus' | 'flower' | 'aspen';
  x: number;
  z: number;
  s: number;
  ry: number;
}

/** Deterministic scatter of flora for one chunk (lattice jitter, no storage). */
export function vegForChunk(cx: number, cz: number): Veg[] {
  const out: Veg[] = [];
  const x0 = cx * CHUNK;
  const z0 = cz * CHUNK;
  const step = 6;
  for (let gx = 0; gx < CHUNK / step; gx++) {
    for (let gz = 0; gz < CHUNK / step; gz++) {
      const ix = Math.floor(x0 / step) + gx;
      const iz = Math.floor(z0 / step) + gz;
      const jx = hash2(ix * 3 + 1, iz * 7 + 3);
      const jy = hash2(ix * 5 + 9, iz * 11 + 5);
      const x = x0 + (gx + jx) * step;
      const z = z0 + (gz + jy) * step;
      if (Math.abs(x) > BOUND + 60 || Math.abs(z) > BOUND + 90) continue;
      const h = ground(x, z);
      if (h < waterAt(x, z) + 0.5) continue; // in open water
      const sl = slopeAt(x, z);
      const bm = biomeAt(x, z);
      const d = hash2(ix * 13 + 2, iz * 17 + 8);
      if (solidAt(x, z)) continue;
      const ry = hash2(ix + 40, iz + 61) * Math.PI * 2;

      if (bm === 'wetland' || (Math.abs(z - riverZ(x)) < 20 && h < riverLevel(x) + 2.4)) {
        if (d < 0.5) out.push({ t: 'reed', x, z, s: 0.8 + d * 1.4, ry });
        else if (d < 0.62) out.push({ t: 'cattail', x, z, s: 0.9 + d, ry });
        else if (d < 0.72) out.push({ t: 'aspen', x, z, s: 0.8 + d * 0.5, ry });
        continue;
      }
      if (bm === 'alpine') {
        if (sl < 0.8 && d < 0.2) out.push({ t: 'pine', x, z, s: 0.7 + d, ry });
        if (d > 0.94) out.push({ t: 'rock', x, z, s: 0.8 + d, ry });
        continue;
      }
      if (bm === 'rock') {
        if (d < 0.3) out.push({ t: 'pine', x, z, s: 0.75 + d * 1.2, ry });
        else if (d < 0.42) out.push({ t: 'juniper', x, z, s: 0.7 + d, ry });
        else if (d > 0.9) out.push({ t: 'rock', x, z, s: 0.9 + d * 1.6, ry });
        else if (d > 0.6 && d < 0.72) out.push({ t: 'dead', x, z, s: 0.9 + d * 0.6, ry });
        continue;
      }
      if (bm === 'badlands') {
        if (d < 0.12) out.push({ t: 'cactus', x, z, s: 0.8 + d, ry });
        else if (d < 0.2) out.push({ t: 'dead', x, z, s: 0.8 + d, ry });
        else if (d < 0.42) out.push({ t: 'sage', x, z, s: 0.7 + d, ry });
        else if (d > 0.95) out.push({ t: 'rock', x, z, s: 0.8 + d, ry });
        continue;
      }
      // sagebrush valley floor
      if (sl > 0.85) {
        if (d > 0.9) out.push({ t: 'rock', x, z, s: 0.9 + d, ry });
        continue;
      }
      if (d < 0.16) out.push({ t: 'sage', x, z, s: 0.75 + d * 1.6, ry });
      else if (d < 0.2) out.push({ t: 'juniper', x, z, s: 0.8 + d, ry });
      else if (d < 0.235 && bm === 'town') out.push({ t: 'flower', x, z, s: 1, ry });
      else if (d < 0.3 && Math.abs(z - roadZ(x)) > 9) out.push({ t: 'grass', x, z, s: 0.8 + d * 1.4, ry });
      else if (d > 0.985) out.push({ t: 'rock', x, z, s: 0.7 + d, ry });
    }
  }
  return out;
}

// ------------------------------------------------------------------ nav -----
export const NAV_CELL = 6;
export const NAV_N = Math.ceil((BOUND * 2) / NAV_CELL);
const nav = new Uint8Array(NAV_N * NAV_N);

export function navIdx(x: number, z: number): number {
  const cx = Math.floor((x + BOUND) / NAV_CELL);
  const cz = Math.floor((z + BOUND) / NAV_CELL);
  if (cx < 0 || cz < 0 || cx >= NAV_N || cz >= NAV_N) return -1;
  return cz * NAV_N + cx;
}
export function navCellXZ(i: number): [number, number] {
  const cx = i % NAV_N;
  const cz = Math.floor(i / NAV_N);
  return [cx * NAV_CELL - BOUND + NAV_CELL / 2, cz * NAV_CELL - BOUND + NAV_CELL / 2];
}
function cellBad(i: number): boolean {
  const [x, z] = navCellXZ(i);
  if (Math.abs(x) > BOUND || Math.abs(z) > BOUND) return true;
  if (slopeAt(x, z) > 0.8) return true;
  if (waterAt(x, z) > -1e8 && ground(x, z) < waterAt(x, z) + 0.4) return true;
  if (solidAt(x, z)) return true;
  return false;
}
export function navInit(): void {
  for (let i = 0; i < nav.length; i++) nav[i] = cellBad(i) ? 1 : 0;
}
function navMarkArea(x: number, z: number, r: number, blocked: boolean): void {
  const c0 = Math.max(0, Math.floor((x - r + BOUND) / NAV_CELL));
  const c1 = Math.min(NAV_N - 1, Math.floor((x + r + BOUND) / NAV_CELL));
  const r0 = Math.max(0, Math.floor((z - r + BOUND) / NAV_CELL));
  const r1 = Math.min(NAV_N - 1, Math.floor((z + r + BOUND) / NAV_CELL));
  for (let cz = r0; cz <= r1; cz++) for (let cx = c0; cx <= c1; cx++) nav[cz * NAV_N + cx] = blocked ? 1 : 0;
}
function navRebuildArea(x: number, z: number, r: number): void {
  const c0 = Math.max(0, Math.floor((x - r + BOUND) / NAV_CELL));
  const c1 = Math.min(NAV_N - 1, Math.floor((x + r + BOUND) / NAV_CELL));
  const r0 = Math.max(0, Math.floor((z - r + BOUND) / NAV_CELL));
  const r1 = Math.min(NAV_N - 1, Math.floor((z + r + BOUND) / NAV_CELL));
  for (let cz = r0; cz <= r1; cz++)
    for (let cx = c0; cx <= c1; cx++) {
      const i = cz * NAV_N + cx;
      nav[i] = cellBad(i) ? 1 : 0;
    }
}
export function navBlockedAt(x: number, z: number): boolean {
  const i = navIdx(x, z);
  if (i < 0) return true;
  return nav[i] === 1;
}

/** Open the nav grid at a spot (ramps, doors, destroyed walls, bridge decks). */
export function navClearArea(x: number, z: number, r: number): void {
  const c0 = Math.max(0, Math.floor((x - r + BOUND) / NAV_CELL));
  const c1 = Math.min(NAV_N - 1, Math.floor((x + r + BOUND) / NAV_CELL));
  const r0 = Math.max(0, Math.floor((z - r + BOUND) / NAV_CELL));
  const r1 = Math.min(NAV_N - 1, Math.floor((z + r + BOUND) / NAV_CELL));
  for (let cz = r0; cz <= r1; cz++) for (let cx = c0; cx <= c1; cx++) nav[cz * NAV_N + cx] = 0;
}

/** A* on the coarse grid; returns a flat [x,z,...] waypoint list. */
export function findPath(sx: number, sz: number, tx: number, tz: number, limit = 5200): number[] {
  const si = navIdx(sx, sz);
  let ti = navIdx(tx, tz);
  if (si < 0 || ti < 0) return [tx, tz];
  if (nav[ti] === 1) {
    // snap the goal to the nearest open cell
    let best = -1;
    let bd = 1e9;
    for (let r = 1; r <= 4 && best < 0; r++) {
      for (let a = 0; a < 24 && best < 0; a++) {
        const ang = (a / 24) * Math.PI * 2;
        const px = tx + Math.cos(ang) * r * NAV_CELL;
        const pz = tz + Math.sin(ang) * r * NAV_CELL;
        const j = navIdx(px, pz);
        if (j >= 0 && nav[j] === 0) {
          const d = Math.hypot(px - tx, pz - tz);
          if (d < bd) {
            bd = d;
            best = j;
          }
        }
      }
    }
    if (best < 0) return [tx, tz];
    ti = best;
  }
  if (si === ti) return [tx, tz];
  const g = new Float32Array(NAV_N * NAV_N).fill(1e9);
  const f = new Float32Array(NAV_N * NAV_N).fill(1e9);
  const from = new Int32Array(NAV_N * NAV_N).fill(-1);
  const closed = new Uint8Array(NAV_N * NAV_N);
  const open: number[] = [si];
  const inOpen = new Uint8Array(NAV_N * NAV_N);
  inOpen[si] = 1;
  g[si] = 0;
  const hx = Math.floor((navCellXZ(ti)[0] + BOUND) / NAV_CELL);
  const hz = Math.floor((navCellXZ(ti)[1] + BOUND) / NAV_CELL);
  const heapPush = (i: number) => {
    open.push(i);
    inOpen[i] = 1;
    let c = open.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (f[open[p]] <= f[open[c]]) break;
      const t = open[p];
      open[p] = open[c];
      open[c] = t;
      c = p;
    }
  };
  const heapPop = (): number => {
    const top = open[0];
    const last = open.pop() as number;
    inOpen[top] = 0;
    if (open.length) {
      open[0] = last;
      let c = 0;
      for (;;) {
        const l = c * 2 + 1;
        const r = l + 1;
        let m = c;
        if (l < open.length && f[open[l]] < f[open[m]]) m = l;
        if (r < open.length && f[open[r]] < f[open[m]]) m = r;
        if (m === c) break;
        const t = open[m];
        open[m] = open[c];
        open[c] = t;
        c = m;
      }
    }
    return top;
  };
  const cx = (i: number) => i % NAV_N;
  const cz = (i: number) => Math.floor(i / NAV_N);
  const NBR: number[][] = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  f[si] = Math.abs(cx(si) - hx) + Math.abs(cz(si) - hz);
  let steps = 0;
  let found = false;
  while (open.length && steps++ < limit) {
    const cur = heapPop();
    if (cur === ti) {
      found = true;
      break;
    }
    closed[cur] = 1;
    const ccx = cx(cur);
    const ccz = cz(cur);
    for (let k = 0; k < 8; k++) {
      const dx = NBR[k][0];
      const dz = NBR[k][1];
      const nx = ccx + dx;
      const nz = ccz + dz;
      if (nx < 0 || nz < 0 || nx >= NAV_N || nz >= NAV_N) continue;
      const ni = nz * NAV_N + nx;
      if (nav[ni] === 1 || closed[ni] === 1) continue;
      if (dx !== 0 && dz !== 0) {
        if (nav[ccz * NAV_N + nx] === 1 && nav[nz * NAV_N + ccx] === 1) continue;
      }
      const cost = dx !== 0 && dz !== 0 ? 1.4142 : 1;
      const ng = g[cur] + cost;
      if (ng < g[ni]) {
        g[ni] = ng;
        from[ni] = cur;
        f[ni] = ng + Math.abs(nx - hx) + Math.abs(nz - hz);
        if (!inOpen[ni]) heapPush(ni);
        else {
          let c = open.indexOf(ni);
          while (c > 0) {
            const p = (c - 1) >> 1;
            if (f[open[p]] <= f[open[c]]) break;
            const t = open[p];
            open[p] = open[c];
            open[c] = t;
            c = p;
          }
        }
      }
    }
  }
  if (!found) {
    // partial path towards the goal, else straight line
    let best = si;
    let bd = 1e9;
    for (let i = 0; i < nav.length; i++) {
      if (closed[i] !== 1) continue;
      const [px, pz] = navCellXZ(i);
      const d = Math.hypot(px - tx, pz - tz);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best === si) return [tx, tz];
    ti = best;
  }
  const cells: number[] = [];
  let cur = ti;
  while (cur >= 0 && cur !== si) {
    cells.push(cur);
    cur = from[cur];
  }
  cells.reverse();
  const pts: number[] = [];
  for (const i of cells) {
    const [px, pz] = navCellXZ(i);
    pts.push(px, pz);
  }
  pts.push(tx, tz);
  // string pull: drop waypoints that are visible past
  const out: number[] = [];
  let ai = 0;
  let bi = 2;
  const ax = (): number => (ai === 0 ? sx : pts[ai - 2]);
  const az = (): number => (ai === 0 ? sz : pts[ai - 1]);
  while (bi < pts.length) {
    if (!los(ax(), az(), pts[bi], pts[bi + 1])) {
      out.push(pts[bi - 2], pts[bi - 1]);
      ai = bi;
    }
    bi += 2;
  }
  out.push(tx, tz);
  return out;
}

/** Line of sight over the nav grid (for path simplification and shooting). */
export function los(x0: number, z0: number, x1: number, z1: number): boolean {
  const d = Math.hypot(x1 - x0, z1 - z0);
  const n = Math.min(220, Math.ceil(d / (NAV_CELL * 0.7)));
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const x = lerp(x0, x1, t);
    const z = lerp(z0, z1, t);
    if (navBlockedAt(x, z)) return false;
  }
  return true;
}

/** Road-following helper: spawn markers hug the canyon road. */
export function roadPoint(x: number): [number, number] {
  return [x, roadZ(x)];
}

export const spawnPoints: { x: number; z: number; name: string }[] = [
  { x: -BOUND + 6, z: roadZ(-BOUND + 6), name: 'West Road' },
  { x: BOUND - 6, z: roadZ(BOUND - 6), name: 'East Road' },
  { x: -350, z: riverZ(-350) + 30, name: 'Ridge Camp' },
  { x: 104, z: roadZ(104) + 62, name: 'Trestle Camp' },
  { x: -118, z: roadZ(-118) - 74, name: 'Arroyo Camp' },
  { x: 0, z: -BOUND - 40, name: 'South Draw' },
  { x: 30, z: BOUND + 30, name: 'North Rim' },
];

navInit();
