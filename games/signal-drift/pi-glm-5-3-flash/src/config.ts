/** Central tuning constants for Signal Drift. */

export const SEED = 94721;

export const PALETTE = {
  fog: 0x244553,
  skyZenith: 0x0a1118,
  skyMid: 0x14303c,
  skyHorizon: 0x244553,
  cloudDeep: 0x1d2b36,
  cloudCrest: 0x47707f,
  cyan: 0x59f2ff,
  amber: 0xffb347,
  red: 0xff4d5e,
  white: 0xeaf6ff,
  hull: 0x9aa7b0,
  hullDark: 0x39434c,
  rust: 0x5a4638,
};

export const FLIGHT = {
  baseSpeed: 36,
  boostSpeed: 58,
  accel: 34,
  yawRate: 1.55,
  pitchRate: 1.05,
  maxPitch: 0.62,
  bankMax: 0.9,
  steerLerp: 7.5,
  floorY: 13,
  ceilY: 152,
};

export const PLAY = {
  startCharge: 100,
  drain: 2.8,
  boostDrainMult: 2.1,
  offCourseDrain: 2.5,
  offCourseDist: 235,
  offCourseRearm: 175,
  cellCharge: 24,
  cellMagnetRadius: 15,
  cellPickupRadius: 4.8,
  cellMagnetSpeed: 30,
  relayCharge: 20,
  hitCharge: 16,
  surgeCharge: 9,
  surgeCooldown: 1.0,
  lightningCharge: 12,
  invulnTime: 1.5,
};

export const SCORE = {
  cell: 15,
  relay: 250,
  finish: 1000,
  timePar: 800,
  timeBonusRate: 2,
};

export const GATE = {
  ringRadius: 15,
  restoreRadius: 13.2,
  tube: 1.1,
};

export const EXTRACT = {
  radius: 16,
  restoreRadius: 14.2,
};

export const CAMERA = {
  dist: 11.5,
  height: 3.8,
  lookAhead: 11,
  fovBase: 60,
  fovBoost: 74,
  posLerp: 5.2,
};

export const LIGHTNING = {
  intervalMin: 7,
  intervalMax: 13,
  warnTime: 1.05,
  strikeTime: 0.55,
  fadeTime: 0.5,
  damageRadius: 16,
  maxHeight: 95,
};
