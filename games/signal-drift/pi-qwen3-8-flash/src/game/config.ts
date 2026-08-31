/**
 * Signal Drift - central place for tuning values, palette and copy.
 * Everything gameplay-relevant lives here so the run can be balanced quickly.
 */

export const SEED = 94721;

/** Fixed logical size of the relay field. */
export const FIELD = {
  /** Soft upper flight limit (storm shear above this). */
  ceiling: 108,
  /** Soft lower flight limit (cloud shear below this). */
  floor: -58,
  /** Visible cloud deck. */
  deck: -74,
  /** Half-extent of the world that stays "loaded" around the craft. */
  corridorHalfWidth: 190,
};

export const PALETTE = {
  skyHigh: 0x05070c,
  skyMid: 0x0b1a26,
  skyLow: 0x1d3a46,
  horizon: 0x35566b,
  cloud: 0xaebfc9,
  cloudWarm: 0xd9c6a8,
  metal: 0x2b3540,
  metalDark: 0x151c22,
  cyan: 0x4ff2ff,
  ice: 0xbdf0ff,
  amber: 0xffb545,
  amberDeep: 0xff7b2e,
  magenta: 0xff3d82,
  violet: 0x8f7bff,
  green: 0x6bffb0,
  white: 0xf2fbff,
};

export const TUNING = {
  charge: {
    max: 100,
    start: 100,
    /** Passive drain per second while flying. */
    drain: 3.35,
    /** Extra drain per second while boosting. */
    boostDrain: 6.0,
    /** Per charge cell collected. */
    cell: 5.5,
    /** Restoring a relay refills this much. */
    relayBonus: 22,
    /** Cost of one hazard impact. */
    impact: 9,
    /** Drain per second while grinding the shear bands. */
    shear: 13,
    /** Below this the HUD screams. */
    critical: 24,
  },
  flight: {
    /** Absolute minimum forward speed - the courier never stalls. */
    minSpeed: 17,
    cruiseSpeed: 40,
    maxSpeed: 55,
    boostSpeed: 76,
    throttleRate: 1.15,
    /** Yaw rate rad/s at full stick. */
    yawRate: 1.35,
    pitchRate: 1.0,
    rollRate: 2.1,
    /** Exponential responsiveness of control surfaces. */
    controlResponse: 6.2,
    /** How quickly velocity snaps to the nose direction (lower = driftier). */
    grip: 2.55,
    /** Gust strength from storm cells. */
    gust: 12,
    knockback: 26,
    /** Seconds of immunity after an impact. */
    iframes: 0.85,
    bankFactor: 0.55,
  },
  gates: {
    relayRadius: 25,
    /** Detection aperture, slightly smaller than the ring. */
    relayAperture: 23,
    extractionRadius: 34,
    extractionAperture: 32,
  },
  score: {
    cell: 100,
    relay: 600,
    extraction: 1500,
    /** Bonus per whole second shaved off par time. */
    timeBonus: 26,
    parSeconds: 78,
    chargeBonus: 12,
    cleanRun: 1200,
    impactPenalty: 45,
  },
  hazards: {
    sweeperCount: 5,
    drifterCount: 11,
    arcCount: 4,
    /** Radius added around a hazard body for collisions. */
    pad: 0.6,
  },
  cells: {
    count: 46,
    pickupRadius: 7.5,
    /** Seconds before a collected cell is simply gone (no respawn). */
    magnetRadius: 15,
  },
  camera: {
    fovBase: 62,
    fovBoost: 20,
    distance: 21,
    height: 6.4,
    lag: 9.5,
    lookLag: 12,
  },
};

export const OBJECTIVE = {
  ready: 'STAND BY',
  relay: (n: number) => `RESTORE RELAY 0${n}`,
  cells: 'RECOVER CHARGE CELLS',
  extraction: 'RUN THE EXTRACTION RING',
  won: 'SIGNAL RESTORED',
  lost: 'COURIER LOST',
} as const;
