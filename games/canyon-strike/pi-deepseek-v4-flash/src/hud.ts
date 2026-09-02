// Canvas HUD: crosshair, lock brackets, radar, compass, readouts, warnings.

import * as THREE from 'three';
import { clamp, lerp } from './math';
import type { GroundKind } from './types';

export type HUDPhase = 'strike' | 'extract' | 'over';

export interface HUDSnapshot {
  time: number;
  camera: THREE.PerspectiveCamera;
  playerPos: THREE.Vector3;
  playerYaw: number;
  speed: number; // m/s
  altAGL: number;
  hp: number;
  maxHp: number;
  missiles: number;
  flares: number;
  gunHeat: number;
  throttle: number;
  autoThrottle: boolean;
  phase: HUDPhase;
  objective: string;
  lock?: { name: string; dist: number; hp: number; maxHp: number; primary: boolean; kind: string; pos: THREE.Vector3 };
  lockTime: number;
  targets: { kind: string; pos: THREE.Vector3; alive: boolean; primary: boolean; name: string }[];
  enemyMissiles: THREE.Vector3[];
  shells: { pos: THREE.Vector3; vel: THREE.Vector3 }[];
  extraction?: THREE.Vector3;
  terrainClearance: number;
  destroyedCount: number;
  quotaTotal: number;
}

const TYPE_NAMES: Record<string, string> = {
  sam: 'SAM SITE',
  aa: 'AAA GUN',
  radar: 'RADAR',
  mortar: 'MORTAR',
  fighter: 'BANDIT',
};

export class HUD {
  private dpr = 1;
  private w = 0;
  private h = 0;
  private flash = 0;
  private flashLabel: string | null = null;
  private flashLabelT = 0;
  private shakeT = 0;
  private lastLockBeep = -10;
  private point = new THREE.Vector3();
  private proj = new THREE.Vector3();

  constructor(private ctx: CanvasRenderingContext2D) {}

  resize(w: number, h: number, dpr: number): void {
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  flashDamage(label: string): void {
    this.flash = Math.min(1.2, this.flash + 0.6);
    this.flashLabel = label;
    this.flashLabelT = 1.6;
  }

  addShake(amount: number): void {
    this.shakeT = Math.max(this.shakeT, amount * 0.7);
  }

  draw(s: HUDSnapshot): void {
    const ctx = this.ctx;
    const w = this.w;
    const h = this.h;
    ctx.clearRect(0, 0, w, h);
    this.flash = Math.max(0, this.flash - 1 / 60);
    this.flashLabelT = Math.max(0, this.flashLabelT - 1 / 60);
    this.shakeT = Math.max(0, this.shakeT - 1 / 60);

    const shakeAmt = this.shakeT > 0 ? Math.sin(s.time * 55) * this.shakeT * 3 : 0;
    if (Math.abs(shakeAmt) > 0.1) ctx.translate(shakeAmt, Math.cos(s.time * 47) * this.shakeT * 3);

    this.drawCrosshair(ctx, s);
    if (s.lock) this.drawLock(ctx, s);
    this.drawTargetMarkers(ctx, s);
    this.drawRadar(ctx, s);
    this.drawCompass(ctx, s);
    this.drawReadouts(ctx, s);
    this.drawIncoming(ctx, s);
    this.drawExtractionArrow(ctx, s);
    this.drawWarnings(ctx, s);
    this.drawVignette(ctx, s);
    this.drawDamageFlash(ctx, s);
    this.drawObjective(ctx, s);
  }

  private project(s: HUDSnapshot, world: THREE.Vector3, out: THREE.Vector3): boolean {
    this.point.copy(world);
    this.point.project(s.camera);
    out.set(((this.point.x + 1) / 2) * this.w, ((1 - this.point.y) / 2) * this.h, this.point.z);
    return this.point.z < 1 && this.point.z > -1;
  }

  private drawCrosshair(ctx: CanvasRenderingContext2D, s: HUDSnapshot): void {
    const cx = this.w / 2;
    const cy = this.h / 2;
    const col = this.lockColor(s);
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.9;
    const r = 26;
    for (let i = 0; i < 4; i++) {
      const ang = (i / 4) * Math.PI * 2 + Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
      ctx.lineTo(cx + Math.cos(ang) * (r + 13), cy + Math.sin(ang) * (r + 13));
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx, cy, 2.2, 0, Math.PI * 2);
    ctx.fillStyle = col;
    ctx.fill();
    ctx.globalAlpha = 1;
    // gun heat arc under crosshair
    if (s.gunHeat > 0.02) {
      ctx.strokeStyle = s.gunHeat > 0.8 ? '#ff5544' : '#ffd76a';
      ctx.lineWidth = 4;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.arc(cx, cy + 20, 34, Math.PI * 0.15, Math.PI * 0.15 + Math.PI * 1.7 * s.gunHeat);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  private lockColor(s: HUDSnapshot): string {
    if (!s.lock) return 'rgba(255,255,255,0.75)';
    const frac = clamp(s.lockTime / 0.9, 0, 1);
    if (s.lock.primary) return `rgba(255,190,60,${0.5 + frac * 0.5})`;
    return frac >= 1 ? `rgba(255,80,60,${0.7 + Math.sin(s.time * 14) * 0.3})` : `rgba(255,210,80,${0.4 + frac * 0.5})`;
  }

  private drawLock(ctx: CanvasRenderingContext2D, s: HUDSnapshot): void {
    const l = s.lock!;
    if (!this.project(s, l.pos, this.proj)) return;
    const px = this.proj.x;
    const py = this.proj.y;
    const frac = clamp(s.lockTime / 0.9, 0, 1);
    const size = clamp(14000 / Math.max(60, l.dist), 26, 160);
    ctx.strokeStyle = this.lockColor(s);
    ctx.lineWidth = 2.4;
    ctx.globalAlpha = 0.95;
    // brackets
    const c = size;
    const g = size * 0.22;
    ctx.beginPath();
    ctx.moveTo(px - g, py - c); ctx.lineTo(px - c, py - c); ctx.lineTo(px - c, py - g);
    ctx.moveTo(px + g, py - c); ctx.lineTo(px + c, py - c); ctx.lineTo(px + c, py - g);
    ctx.moveTo(px - g, py + c); ctx.lineTo(px - c, py + c); ctx.lineTo(px - c, py + g);
    ctx.moveTo(px + g, py + c); ctx.lineTo(px + c, py + c); ctx.lineTo(px + c, py + g);
    ctx.stroke();
    // corner ticks sweep while locking
    if (frac < 1) {
      ctx.strokeStyle = 'rgba(255,214,90,0.9)';
      const sweep = Math.PI * 2 * frac;
      ctx.beginPath();
      ctx.arc(px, py, size * 0.85, -Math.PI / 2, -Math.PI / 2 + sweep);
      ctx.lineWidth = 3;
      ctx.stroke();
    }
    // info card
    ctx.globalAlpha = 1;
    const lk = s.lock!;
    const name = (lk.name || TYPE_NAMES[lk.kind] || 'TARGET').toUpperCase();
    ctx.font = '700 15px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = l.primary ? '#ffc453' : '#ff8a6a';
    ctx.fillText(name, px, py - c - 14);
    ctx.font = '600 13px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText(`${Math.round(l.dist)} m`, px, py - c - 0);
    ctx.font = '700 12px ui-monospace, monospace';
    ctx.fillStyle = l.hp / l.maxHp > 0.35 ? '#7ee07e' : '#ff5544';
    ctx.fillText(`INTEGRITY ${Math.max(0, Math.round((l.hp / l.maxHp) * 100))}%`, px, py - c + 46);
    if (frac >= 1 && s.missiles > 0) {
      ctx.font = '800 18px ui-monospace, monospace';
      const pulse = 0.6 + Math.sin(s.time * 10) * 0.4;
      ctx.fillStyle = `rgba(255,70,50,${clamp(pulse, 0.35, 0.95)})`;
      ctx.fillText('FOX 2', px, py + c + 52);
      ctx.strokeStyle = `rgba(255,70,50,${clamp(pulse, 0.35, 0.95)})`;
      ctx.lineWidth = 2;
      ctx.strokeRect(px - 44, py + c + 38, 88, 22);
    }
  }

  private drawTargetMarkers(ctx: CanvasRenderingContext2D, s: HUDSnapshot): void {
    const camPos = s.camera.getWorldPosition(new THREE.Vector3());
    for (const t of s.targets) {
      if (!t.alive) continue;
      const dist = t.pos.distanceTo(camPos);
      if (dist > 4200) continue;
      // skip lock target (drawn above)
      if (s.lock && t.pos.distanceTo(s.lock.pos) < 1) continue;
      this.project(s, t.pos, this.proj);
      if (this.proj.z > 1 || this.proj.z < -1) continue;
      const px = this.proj.x;
      const py = this.proj.y;
      const isPrimary = t.primary;
      const col = isPrimary ? 'rgba(255,190,60,0.92)' : 'rgba(255,120,90,0.85)';
      const sz = isPrimary ? 9 : 7;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      if (isPrimary) {
        ctx.beginPath();
        ctx.moveTo(px, py - sz); ctx.lineTo(px + sz, py); ctx.lineTo(px, py + sz); ctx.lineTo(px - sz, py);
        ctx.closePath();
        ctx.stroke();
        // pulsing
        const pulse = 1 + Math.sin(s.time * 6 + px) * 0.25;
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(px, py, sz * pulse * 1.6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        ctx.beginPath();
        ctx.arc(px, py, sz, 0, Math.PI * 2);
        ctx.stroke();
      }
      // range label for primary
      if (isPrimary) {
        ctx.font = '600 11px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillStyle = col;
        ctx.fillText(String(Math.round(dist)), px, py - sz - 4);
      }
    }
  }

  private drawRadar(ctx: CanvasRenderingContext2D, s: HUDSnapshot): void {
    const R = 118;
    const cx = this.w - R - 26;
    const cy = R + 30;
    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = 'rgba(120,220,120,0.7)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.28;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 0.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
    ctx.stroke();
    ctx.globalAlpha = 0.9;
    // sweep
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R * 0.97, s.time * 2.1, s.time * 2.1 + 0.7, false);
    ctx.fillStyle = 'rgba(120,220,120,0.15)';
    ctx.fill();

    const range = 3600;
    const sinY = Math.sin(s.playerYaw);
    const cosY = Math.cos(s.playerYaw);
    // heading-up radar: forward = (−sinθ, −cosθ), right = (cosθ, −sinθ)
    const blip = (relx: number, relz: number): { x: number; y: number } => {
      const d = Math.hypot(relx, relz);
      if (d < 1) return { x: 0, y: 0 };
      const fwd = -relx * sinY - relz * cosY;
      const right = relx * cosY - relz * sinY;
      const r = Math.min((d / range) * R, R * 0.97);
      return { x: (right / d) * r, y: (-fwd / d) * r };
    };
    for (const t of s.targets) {
      if (!t.alive) continue;
      const b = blip(t.pos.x - s.playerPos.x, t.pos.z - s.playerPos.z);
      const d = Math.hypot(t.pos.x - s.playerPos.x, t.pos.z - s.playerPos.z);
      if (d > range) continue;
      ctx.fillStyle = t.primary ? '#ffd64a' : '#ff7050';
      ctx.fillRect(cx + b.x - 2.4, cy + b.y - 2.4, 4.8, 4.8);
    }
    if (s.extraction) {
      const b = blip(s.extraction.x - s.playerPos.x, s.extraction.z - s.playerPos.z);
      ctx.fillStyle = '#3ee06a';
      ctx.beginPath();
      ctx.arc(cx + b.x, cy + b.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.font = '600 10px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(160,230,160,0.8)';
    ctx.fillText('RDR', cx, cy + R + 13);
  }

  private drawCompass(ctx: CanvasRenderingContext2D, s: HUDSnapshot): void {
    const w = this.w;
    const cx = w / 2;
    const y = 52;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 1.4;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.arc(cx, y, 34, Math.PI, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    const heading = ((s.playerYaw * 180 / Math.PI) + 360) % 360;
    // tick strip
    ctx.font = '600 11px ui-monospace, monospace';
    ctx.textAlign = 'center';
    const ticks = 12;
    for (let i = -ticks; i <= ticks; i++) {
      const deg = roundTo5(i * 5 + heading);
      const rad = deg * Math.PI / 180;
      const tx = cx + Math.sin(rad) * 46;
      const ty = y - Math.cos(rad) * 46 + 12;
      void tx;
      void ty;
    }
    // strip style: small ladder below compass
    ctx.font = '600 11px ui-monospace, monospace';
    for (let i = -8; i <= 8; i++) {
      const deg = heading + i * 10;
      const nx = cx + i * 15;
      if (nx < 30 || nx > w - 30) continue;
      const label = normalizeDeg(deg);
      const isCardinal = Math.abs(label % 90) < 1e-6;
      ctx.fillStyle = isCardinal ? 'rgba(255,255,255,0.95)' : 'rgba(255,255,255,0.5)';
      ctx.fillText(cardinal(label), nx, y + 44);
      ctx.fillRect(nx - 0.5, y + 22, 1, isCardinal ? 10 : 5);
    }
    ctx.font = '700 14px ui-monospace, monospace';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(`${Math.round(normalizeDeg(heading))}°`, cx, y + 66);
    ctx.restore();
  }

  private drawReadouts(ctx: CanvasRenderingContext2D, s: HUDSnapshot): void {
    const w = this.w;
    const h = this.h;
    ctx.textAlign = 'left';
    ctx.font = '700 15px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    // speed
    const kmh = Math.round(s.speed * 3.6);
    ctx.fillText(`${kmh}`, 28, h - 40);
    ctx.font = '600 10px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('KM/H', 82, h - 37);
    ctx.font = '700 15px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.fillText(`${Math.max(0, Math.round(s.altAGL))}`, 28, h - 18);
    ctx.font = '600 10px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('ALT (AGL)', 82, h - 15);

    // throttle
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(26, h - 64); ctx.lineTo(26, h - 108);
    ctx.stroke();
    ctx.strokeStyle = s.autoThrottle ? '#7ee07e' : '#ffd76a';
    ctx.beginPath();
    const th = clamp(s.throttle, 0, 1);
    ctx.moveTo(26, h - 108 + (1 - th) * 44);
    ctx.lineTo(26, h - 64);
    ctx.stroke();

    // ammo
    ctx.textAlign = 'right';
    ctx.font = '700 22px ui-monospace, monospace';
    ctx.fillStyle = s.missiles > 8 ? '#ffb03c' : '#ff5544';
    ctx.fillText(`◉ ${s.missiles}`, w - 28, h - 40);
    ctx.font = '600 11px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('MISSILES', w - 28 - 64, h - 44);
    ctx.font = '700 18px ui-monospace, monospace';
    ctx.fillStyle = s.flares > 3 ? '#9fd8ff' : '#ff5544';
    ctx.fillText(`✦ ${s.flares}`, w - 28, h - 18);
    ctx.font = '600 11px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fillText('FLARES', w - 28 - 52, h - 22);

    // HP bar bottom center
    const bw = 240;
    const bx = w / 2 - bw / 2;
    const by = h - 30;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(bx - 2, by - 2, bw + 4, 10);
    const frac = clamp(s.hp / s.maxHp, 0, 1);
    ctx.fillStyle = frac > 0.5 ? '#4ade80' : frac > 0.25 ? '#facc15' : '#ef4444';
    ctx.fillRect(bx, by, bw * frac, 6);
    if (s.hp <= 25) {
      const pulse = Math.sin(s.time * 8) > 0 ? 'rgba(239,68,68,' : 'rgba(239,68,68,0.2)';
      ctx.strokeStyle = pulse + '0.8)';
      ctx.lineWidth = 2;
      ctx.strokeRect(bx - 3, by - 3, bw + 6, 12);
    }
  }

  private drawIncoming(ctx: CanvasRenderingContext2D, s: HUDSnapshot): void {
    const w = this.w;
    const h = this.h;
    const camPos = s.camera.getWorldPosition(new THREE.Vector3());
    let warningMissile: THREE.Vector3 | null = null;
    let nearest = 1e9;
    for (const mp of s.enemyMissiles) {
      const d = mp.distanceTo(s.playerPos);
      if (d > 2200) continue;
      if (d < nearest) {
        nearest = d;
        warningMissile = mp;
      }
      this.project(s, mp, this.proj);
      if (this.proj.z > 1) continue;
      const px = this.proj.x;
      const py = this.proj.y;
      ctx.fillStyle = '#ff5040';
      if (px < 8) this.drawEdgeArrow(ctx, px, py, 0.9);
      else if (px > w - 8) this.drawEdgeArrow(ctx, px, py, -0.9);
      else if (py < 8) this.drawEdgeArrow(ctx, px, py, 0.9);
      else if (py > h - 8) this.drawEdgeArrow(ctx, px, py, -0.9);
    }
    for (const sh of s.shells) {
      const d = sh.pos.distanceTo(s.playerPos);
      if (d > 340) continue;
      // descending mortar shell nearby
      if (sh.vel.y < 0) {
        ctx.fillStyle = 'rgba(255,160,60,0.85)';
        this.project(s, sh.pos, this.proj);
        if (this.proj.z <= 1 && this.proj.z >= -1) {
          ctx.beginPath();
          ctx.arc(this.proj.x, this.proj.y, 3.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
    if (warningMissile) {
      const d = nearest;
      ctx.globalAlpha = 0.8 + Math.sin(s.time * 18) * 0.2;
      ctx.font = '800 30px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff3b30';
      ctx.fillText('⚠ MISSILE', w / 2, 120);
      ctx.font = '600 14px ui-monospace, monospace';
      ctx.fillStyle = '#ffcf5a';
      ctx.fillText(`INBOUND ${Math.round(d)} m`, w / 2, 146);
      // direction arrow toward missile
      this.project(s, warningMissile, this.proj);
      const fromX = w / 2;
      const fromY = 150;
      const dirX = this.proj.x - fromX;
      const dirY = this.proj.y - fromY;
      const len = Math.hypot(dirX, dirY) || 1;
      const ang = Math.atan2(dirY, dirX);
      const ax = fromX + Math.cos(ang) * 90;
      const ay = fromY + Math.sin(ang) * 60;
      ctx.save();
      ctx.translate(ax, ay);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(14, 0); ctx.lineTo(-7, -8); ctx.lineTo(-7, 8);
      ctx.closePath();
      ctx.fillStyle = '#ff3b30';
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 1;
    }
    void camPos;
  }

  private drawEdgeArrow(ctx: CanvasRenderingContext2D, px: number, py: number, dir: number): void {
    ctx.save();
    ctx.translate(clamp(px, 20, this.w - 20), clamp(py, 20, this.h - 20));
    ctx.rotate(dir);
    ctx.beginPath();
    ctx.moveTo(10, 0); ctx.lineTo(-6, -8); ctx.lineTo(-6, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  private drawExtractionArrow(ctx: CanvasRenderingContext2D, s: HUDSnapshot): void {
    if (!s.extraction || s.phase !== 'extract') return;
    const w = this.w;
    const h = this.h;
    const ex = s.extraction;
    const d = ex.distanceTo(s.playerPos);
    this.project(s, ex, this.proj);
    const inView = this.proj.z > -1 && this.proj.z < 1;
    let ang: number;
    let px: number;
    let py: number;
    if (inView) {
      px = this.proj.x;
      py = this.proj.y;
      ang = Math.atan2(this.proj.y - h / 2, this.proj.x - w / 2);
    } else {
      // edge arrow
      const camDir = s.camera.getWorldDirection(new THREE.Vector3());
      ang = Math.atan2(ex.z - s.playerPos.z, ex.x - s.playerPos.x);
      const camAng = Math.atan2(ex.z - camDir.z - s.playerPos.z, ex.x - camDir.x - s.playerPos.x);
      void camAng;
      // simpler: use projection when behind → show at edge pointing toward it
      const angTo = Math.atan2(ex.z - s.playerPos.z, ex.x - s.playerPos.x) - s.playerYaw * -1;
      void angTo;
      if (this.proj.z > 1) {
        px = w / 2 - Math.cos(ang) * 300;
        py = h / 2 + Math.sin(ang) * 300;
        px = clamp(px, 30, w - 30);
        py = clamp(py, 90, h - 30);
      } else {
        px = this.proj.x;
        py = this.proj.y;
      }
      ang = Math.atan2(py - h / 2, px - w / 2);
    }
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(ang);
    ctx.fillStyle = '#37e06a';
    ctx.strokeStyle = 'rgba(55,224,106,0.6)';
    const pulse = 1 + Math.sin(s.time * 6) * 0.15;
    ctx.scale(pulse, pulse);
    ctx.beginPath();
    ctx.moveTo(22, 0); ctx.lineTo(-8, -12); ctx.lineTo(-8, 12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.font = '600 15px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#37e06a';
    ctx.fillText(`EXTRACTION ${Math.round(d)} m`, w / 2, h - 56);
    ctx.font = '600 11px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(55,224,106,0.75)';
    ctx.fillText('FLY THROUGH THE GREEN ZONE', w / 2, h - 40);
  }

  private drawWarnings(ctx: CanvasRenderingContext2D, s: HUDSnapshot): void {
    const w = this.w;
    const h = this.h;
    if (s.terrainClearance < 60) {
      const urgency = clamp(1 - s.terrainClearance / 60, 0, 1);
      const pulse = Math.sin(s.time * 10) > 0 ? 1 : 0.35;
      ctx.globalAlpha = pulse * (0.4 + urgency * 0.6);
      ctx.font = '800 30px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ff8a00';
      ctx.fillText('PULL UP!', w / 2, h * 0.62);
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(w / 2, h / 2, 40 + urgency * 30, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff8a00';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (s.hp <= 30) {
      const pulse = Math.sin(s.time * 7) > 0 ? 0.25 : 0.08;
      const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.15, w / 2, h / 2, Math.min(w, h) * 0.6);
      grad.addColorStop(0, 'rgba(255,40,20,0)');
      grad.addColorStop(1, `rgba(255,40,20,${pulse})`);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);
    }
  }

  private drawVignette(ctx: CanvasRenderingContext2D, s: HUDSnapshot): void {
    const w = this.w;
    const h = this.h;
    const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.max(w, h) * 0.72);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,0.42)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
  }

  private drawDamageFlash(ctx: CanvasRenderingContext2D, s: HUDSnapshot): void {
    if (this.flash <= 0) return;
    const w = this.w;
    const h = this.h;
    const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.2, w / 2, h / 2, Math.max(w, h) * 0.7);
    grad.addColorStop(0, 'rgba(255,30,15,0)');
    grad.addColorStop(1, `rgba(255,30,15,${clamp(this.flash * 0.5, 0, 0.55)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);
    if (this.flashLabel && this.flashLabelT > 0) {
      ctx.font = '800 24px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(255,90,70,${Math.min(1, this.flashLabelT)})`;
      ctx.fillText(this.flashLabel, w / 2, h * 0.3);
    }
    void s;
  }

  private drawObjective(ctx: CanvasRenderingContext2D, s: HUDSnapshot): void {
    const w = this.w;
    ctx.font = '600 14px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 4;
    ctx.strokeText(s.objective, w / 2, 24);
    ctx.fillStyle = s.phase === 'extract' ? '#7ee07e' : '#ffd76a';
    ctx.fillText(s.objective, w / 2, 24);
  }
}

function normalizeDeg(d: number): number {
  let x = d % 360;
  if (x < 0) x += 360;
  return x;
}

function roundTo5(v: number): number {
  return Math.round(v / 5) * 5;
}

function cardinal(deg: number): string {
  const d = normalizeDeg(deg);
  const names = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return names[Math.round(d / 22.5) % 16];
}

export type { GroundKind };
export { lerp };