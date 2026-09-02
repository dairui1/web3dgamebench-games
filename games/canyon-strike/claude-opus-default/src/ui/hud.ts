import * as THREE from 'three';
import type { Combatant } from '../game/types';
import { clamp, clamp01 } from '../core/mathutil';

export interface HudFrame {
  camera: THREE.PerspectiveCamera;
  playerPos: THREE.Vector3;
  playerQuat: THREE.Quaternion;
  speed: number;
  altitude: number;
  agl: number;
  throttle: number;
  burner: number;
  hp: number;
  maxHp: number;
  missiles: number;
  maxMissiles: number;
  flares: number;
  gunAmmo: number;
  gunHeat: number;
  overheated: boolean;
  gLoad: number;
  combatants: Combatant[];
  lockTarget: Combatant | null;
  lockProgress: number;
  locked: boolean;
  leadPoint: THREE.Vector3 | null;
  waypoint: THREE.Vector3 | null;
  waypointLabel: string;
  missileThreat: { dist: number; pos: THREE.Vector3 } | null;
  pullUp: boolean;
  stall: boolean;
  outOfBounds: number | null;
  hitMarker: number;
  time: number;
  alive: boolean;
}

const AMBER = '#ffcf6b';
const GREEN = '#7dfab4';
const RED = '#ff6a5e';
const CYAN = '#8fe6ff';

export class Hud {
  /** Extra bottom padding so the radar clears on-screen touch controls. */
  touchInset = 0;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private v = new THREE.Vector3();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.resize();
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
  }

  private project(p: THREE.Vector3, cam: THREE.PerspectiveCamera): { x: number; y: number; front: boolean } {
    this.v.copy(p).project(cam);
    const front = this.v.z < 1;
    return {
      x: (this.v.x * 0.5 + 0.5) * this.w,
      y: (-this.v.y * 0.5 + 0.5) * this.h,
      front,
    };
  }

  draw(f: HudFrame): void {
    const c = this.ctx;
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.w, this.h);
    if (!f.alive) return;
    c.lineWidth = 1.6;
    c.font = '600 13px ui-monospace, "SF Mono", Menlo, monospace';
    c.textBaseline = 'middle';

    this.drawPitchLadder(f);
    this.drawTargets(f);
    this.drawReticle(f);
    this.drawTapes(f);
    this.drawRadar(f);
    this.drawWarnings(f);
  }

  // --- horizon + pitch ladder ---------------------------------------------
  private drawPitchLadder(f: HudFrame): void {
    const c = this.ctx;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(f.playerQuat);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(f.playerQuat);
    const pitch = Math.asin(clamp(fwd.y, -1, 1));
    const roll = Math.atan2(right.y, new THREE.Vector3(0, 1, 0).applyQuaternion(f.playerQuat).y);
    const cx = this.w / 2;
    const cy = this.h / 2;
    const pxPerRad = this.h / (f.camera.fov * (Math.PI / 180));

    c.save();
    c.translate(cx, cy);
    c.rotate(roll);
    c.globalAlpha = 0.75;
    c.strokeStyle = GREEN;
    c.fillStyle = GREEN;

    const width = Math.min(this.w * 0.34, 300);
    for (let deg = -60; deg <= 60; deg += 10) {
      const y = (pitch - deg * (Math.PI / 180)) * pxPerRad;
      if (Math.abs(y) > this.h * 0.55) continue;
      const half = deg === 0 ? width : width * 0.55;
      c.globalAlpha = deg === 0 ? 0.85 : 0.5;
      c.beginPath();
      if (deg === 0) {
        c.moveTo(-half, y);
        c.lineTo(-half * 0.18, y);
        c.moveTo(half * 0.18, y);
        c.lineTo(half, y);
      } else {
        const tick = deg > 0 ? 9 : -9;
        if (deg < 0) c.setLineDash([9, 7]);
        c.moveTo(-half, y);
        c.lineTo(-half * 0.25, y);
        c.moveTo(half * 0.25, y);
        c.lineTo(half, y);
        c.setLineDash([]);
        c.moveTo(-half, y);
        c.lineTo(-half, y + tick);
        c.moveTo(half, y);
        c.lineTo(half, y + tick);
      }
      c.stroke();
      if (deg !== 0) {
        c.globalAlpha = 0.55;
        c.textAlign = 'right';
        c.fillText(`${Math.abs(deg)}`, -half - 6, y);
        c.textAlign = 'left';
        c.fillText(`${Math.abs(deg)}`, half + 6, y);
      }
    }
    c.restore();

    // Flight path marker (velocity vector).
    const fpm = this.project(
      new THREE.Vector3().copy(f.playerPos).addScaledVector(fwd, 260),
      f.camera
    );
    if (fpm.front) {
      c.save();
      c.globalAlpha = 0.85;
      c.strokeStyle = GREEN;
      c.beginPath();
      c.arc(fpm.x, fpm.y, 7, 0, Math.PI * 2);
      c.moveTo(fpm.x - 15, fpm.y);
      c.lineTo(fpm.x - 7, fpm.y);
      c.moveTo(fpm.x + 7, fpm.y);
      c.lineTo(fpm.x + 15, fpm.y);
      c.moveTo(fpm.x, fpm.y - 7);
      c.lineTo(fpm.x, fpm.y - 14);
      c.stroke();
      c.restore();
    }
  }

  // --- gun reticle ---------------------------------------------------------
  private drawReticle(f: HudFrame): void {
    const c = this.ctx;
    const cx = this.w / 2;
    const cy = this.h / 2;
    c.save();
    c.strokeStyle = f.overheated ? RED : AMBER;
    c.globalAlpha = 0.9;
    c.beginPath();
    c.moveTo(cx - 26, cy);
    c.lineTo(cx - 10, cy);
    c.moveTo(cx + 10, cy);
    c.lineTo(cx + 26, cy);
    c.moveTo(cx, cy - 26);
    c.lineTo(cx, cy - 10);
    c.moveTo(cx, cy + 10);
    c.lineTo(cx, cy + 26);
    c.stroke();
    c.beginPath();
    c.arc(cx, cy, 3, 0, Math.PI * 2);
    c.stroke();

    // Gun heat arc.
    if (f.gunHeat > 0.02) {
      c.strokeStyle = f.overheated ? RED : '#ffb04d';
      c.lineWidth = 3;
      c.beginPath();
      c.arc(cx, cy, 32, -Math.PI / 2, -Math.PI / 2 + f.gunHeat * Math.PI * 2);
      c.stroke();
      c.lineWidth = 1.6;
    }

    // Lead pipper.
    if (f.leadPoint) {
      const p = this.project(f.leadPoint, f.camera);
      if (p.front) {
        c.strokeStyle = '#fff';
        c.globalAlpha = 0.95;
        c.beginPath();
        c.arc(p.x, p.y, 9, 0, Math.PI * 2);
        c.moveTo(p.x - 3, p.y);
        c.lineTo(p.x + 3, p.y);
        c.stroke();
      }
    }
    c.restore();

    if (f.hitMarker > 0) {
      c.save();
      c.globalAlpha = clamp01(f.hitMarker);
      c.strokeStyle = '#ffffff';
      c.lineWidth = 2.4;
      const r = 12 + (1 - clamp01(f.hitMarker)) * 8;
      c.beginPath();
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        c.moveTo(cx + sx * r * 0.45, cy + sy * r * 0.45);
        c.lineTo(cx + sx * r, cy + sy * r);
      }
      c.stroke();
      c.restore();
    }
  }

  // --- target boxes --------------------------------------------------------
  private drawTargets(f: HudFrame): void {
    const c = this.ctx;
    for (const t of f.combatants) {
      if (!t.alive || t.faction === 'player') continue;
      const dist = f.playerPos.distanceTo(t.position);
      const isLockTarget = t === f.lockTarget;
      // Keep the glass readable: minor emplacements only box up close.
      const maxRange = t.isObjective || t.kind === 'fighter' ? 3400 : t.kind === 'sam' ? 1800 : 1100;
      if (dist > maxRange && !isLockTarget) continue;
      const p = this.project(t.position, f.camera);
      if (!p.front) continue;
      const isLock = isLockTarget;
      const size = clamp(2600 / Math.max(60, dist), 9, 46);
      const col = t.kind === 'fighter' ? RED : t.isObjective ? AMBER : '#ff9f6b';
      c.save();
      c.globalAlpha = isLock ? 1 : 0.55;
      c.strokeStyle = col;
      c.lineWidth = isLock ? 2 : 1.3;
      c.beginPath();
      c.rect(p.x - size, p.y - size, size * 2, size * 2);
      c.stroke();

      if (t.isObjective) {
        c.globalAlpha = isLock ? 1 : 0.7;
        c.beginPath();
        c.moveTo(p.x, p.y - size - 9);
        c.lineTo(p.x - 6, p.y - size - 2);
        c.lineTo(p.x + 6, p.y - size - 2);
        c.closePath();
        c.fillStyle = col;
        c.fill();
      }

      if (isLock) {
        // Health bar + label.
        const bw = size * 2;
        c.fillStyle = 'rgba(0,0,0,0.45)';
        c.fillRect(p.x - size, p.y + size + 6, bw, 4);
        c.fillStyle = t.hp / t.maxHp > 0.35 ? col : RED;
        c.fillRect(p.x - size, p.y + size + 6, bw * clamp01(t.hp / t.maxHp), 4);
        c.fillStyle = col;
        c.textAlign = 'left';
        c.fillText(`${t.label}`, p.x + size + 8, p.y - size + 2);
        c.fillText(`${Math.round(dist)}m`, p.x + size + 8, p.y - size + 18);

        // Lock brackets closing in.
        const s = size + 26 * (1 - clamp01(f.lockProgress));
        c.strokeStyle = f.locked ? RED : GREEN;
        c.lineWidth = 2;
        c.globalAlpha = f.locked ? 0.95 : 0.8;
        const arm = s * 0.45;
        c.beginPath();
        for (const [sx, sy] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ]) {
          c.moveTo(p.x + sx * s, p.y + sy * s - sy * arm);
          c.lineTo(p.x + sx * s, p.y + sy * s);
          c.lineTo(p.x + sx * s - sx * arm, p.y + sy * s);
        }
        c.stroke();
        if (f.locked) {
          c.fillStyle = RED;
          c.textAlign = 'center';
          c.fillText('LOCK', p.x, p.y - s - 12);
        }
      }
      c.restore();
    }

    // Off-screen arrow for the current lock target.
    if (f.lockTarget && f.lockTarget.alive) {
      const p = this.project(f.lockTarget.position, f.camera);
      const off =
        !p.front || p.x < 40 || p.x > this.w - 40 || p.y < 40 || p.y > this.h - 40;
      if (off) this.drawEdgeArrow(f, f.lockTarget.position, RED, 'TGT');
    }
  }

  private drawEdgeArrow(f: HudFrame, worldPos: THREE.Vector3, color: string, label: string): void {
    const c = this.ctx;
    const cx = this.w / 2;
    const cy = this.h / 2;
    const p = this.project(worldPos, f.camera);
    let dx = p.x - cx;
    let dy = p.y - cy;
    if (!p.front) {
      dx = -dx;
      dy = -dy;
    }
    const len = Math.hypot(dx, dy) || 1;
    const margin = Math.min(this.w, this.h) * 0.34;
    const x = cx + (dx / len) * margin;
    const y = cy + (dy / len) * margin;
    const ang = Math.atan2(dy, dx);
    c.save();
    c.translate(x, y);
    c.rotate(ang);
    c.fillStyle = color;
    c.globalAlpha = 0.9;
    c.beginPath();
    c.moveTo(14, 0);
    c.lineTo(-6, 8);
    c.lineTo(-6, -8);
    c.closePath();
    c.fill();
    c.restore();
    c.save();
    c.fillStyle = color;
    c.globalAlpha = 0.8;
    c.textAlign = 'center';
    c.fillText(label, x, y + 20);
    c.restore();
  }

  // --- speed / altitude tapes ---------------------------------------------
  private drawTapes(f: HudFrame): void {
    const c = this.ctx;
    const cy = this.h / 2;
    const left = Math.max(56, this.w * 0.13);
    const right = this.w - Math.max(56, this.w * 0.13);
    c.save();
    c.strokeStyle = GREEN;
    c.fillStyle = GREEN;
    c.globalAlpha = 0.9;

    // Speed box.
    c.textAlign = 'right';
    c.strokeRect(left - 74, cy - 13, 68, 26);
    c.fillText(`${Math.round(f.speed * 1.94)}`, left - 12, cy);
    c.globalAlpha = 0.6;
    c.fillText('KTS', left - 12, cy - 26);

    // Altitude box.
    c.globalAlpha = 0.9;
    c.textAlign = 'left';
    c.strokeRect(right + 6, cy - 13, 74, 26);
    c.fillText(`${Math.round(f.altitude)}`, right + 12, cy);
    c.globalAlpha = 0.6;
    c.fillText('ALT m', right + 12, cy - 26);

    // Radar altitude bar.
    const barH = 130;
    const agl = clamp01(f.agl / 600);
    c.globalAlpha = 0.35;
    c.strokeRect(right + 88, cy - barH / 2, 8, barH);
    c.globalAlpha = 0.85;
    c.fillStyle = f.agl < 90 ? RED : GREEN;
    c.fillRect(right + 88, cy + barH / 2 - agl * barH, 8, agl * barH);

    // Throttle bar.
    c.fillStyle = GREEN;
    c.globalAlpha = 0.35;
    c.strokeRect(left - 82, cy - barH / 2, 8, barH);
    c.globalAlpha = 0.85;
    c.fillStyle = f.burner > 0.05 ? '#ff9f4d' : GREEN;
    c.fillRect(left - 82, cy + barH / 2 - f.throttle * barH, 8, f.throttle * barH);
    c.globalAlpha = 0.6;
    c.textAlign = 'center';
    c.fillStyle = GREEN;
    c.fillText(f.burner > 0.5 ? 'A/B' : 'THR', left - 78, cy + barH / 2 + 16);

    // G load.
    c.globalAlpha = 0.7;
    c.textAlign = 'right';
    c.fillText(`${f.gLoad.toFixed(1)}G`, left - 12, cy + 30);
    c.restore();
  }

  // --- radar ---------------------------------------------------------------
  private drawRadar(f: HudFrame): void {
    const c = this.ctx;
    const r = Math.min(84, this.w * 0.11);
    const cx = this.w - r - 26;
    const cy = this.h - r - 26 - this.touchInset;
    const range = 3000;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(f.playerQuat);
    const heading = Math.atan2(fwd.x, -fwd.z);

    c.save();
    c.globalAlpha = 0.28;
    c.fillStyle = '#04120c';
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 0.55;
    c.strokeStyle = GREEN;
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.moveTo(cx - r, cy);
    c.lineTo(cx + r, cy);
    c.moveTo(cx, cy - r);
    c.lineTo(cx, cy + r);
    c.stroke();
    c.globalAlpha = 0.3;
    c.beginPath();
    c.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
    c.stroke();

    const plot = (pos: THREE.Vector3): { x: number; y: number; clamped: boolean } => {
      const dx = pos.x - f.playerPos.x;
      const dz = pos.z - f.playerPos.z;
      // Rotate into aircraft frame (nose up).
      const rx = dx * Math.cos(-heading) - dz * Math.sin(-heading);
      const rz = dx * Math.sin(-heading) + dz * Math.cos(-heading);
      let px = (rx / range) * r;
      let py = (rz / range) * r;
      const d = Math.hypot(px, py);
      const clamped = d > r - 4;
      if (clamped) {
        px = (px / d) * (r - 4);
        py = (py / d) * (r - 4);
      }
      return { x: cx + px, y: cy + py, clamped };
    };

    for (const t of f.combatants) {
      if (!t.alive || t.faction === 'player') continue;
      const p = plot(t.position);
      c.globalAlpha = p.clamped ? 0.4 : 0.95;
      c.fillStyle = t.kind === 'fighter' ? RED : t.isObjective ? AMBER : '#ff9f6b';
      if (t.kind === 'fighter') {
        c.beginPath();
        c.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
        c.fill();
      } else {
        c.fillRect(p.x - 2.6, p.y - 2.6, 5.2, 5.2);
      }
    }

    if (f.waypoint) {
      const p = plot(f.waypoint);
      c.globalAlpha = 0.95;
      c.fillStyle = CYAN;
      c.beginPath();
      c.moveTo(p.x, p.y - 5);
      c.lineTo(p.x + 4, p.y);
      c.lineTo(p.x, p.y + 5);
      c.lineTo(p.x - 4, p.y);
      c.closePath();
      c.fill();
    }

    // Own ship.
    c.globalAlpha = 1;
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(cx, cy - 6);
    c.lineTo(cx + 4, cy + 5);
    c.lineTo(cx - 4, cy + 5);
    c.closePath();
    c.fill();
    c.globalAlpha = 0.6;
    c.fillStyle = GREEN;
    c.textAlign = 'center';
    c.fillText('3.0 km', cx, cy + r + 14);
    c.restore();
  }

  // --- waypoint + warnings -------------------------------------------------
  private drawWarnings(f: HudFrame): void {
    const c = this.ctx;

    if (f.waypoint) {
      const p = this.project(f.waypoint, f.camera);
      const dist = f.playerPos.distanceTo(f.waypoint);
      const on = p.front && p.x > 30 && p.x < this.w - 30 && p.y > 30 && p.y < this.h - 30;
      if (on) {
        c.save();
        c.strokeStyle = CYAN;
        c.fillStyle = CYAN;
        c.globalAlpha = 0.9;
        c.beginPath();
        c.moveTo(p.x, p.y - 13);
        c.lineTo(p.x + 11, p.y);
        c.lineTo(p.x, p.y + 13);
        c.lineTo(p.x - 11, p.y);
        c.closePath();
        c.stroke();
        c.textAlign = 'center';
        c.globalAlpha = 0.85;
        c.fillText(`${f.waypointLabel}  ${(dist / 1000).toFixed(1)}km`, p.x, p.y + 28);
        c.restore();
      } else {
        this.drawEdgeArrow(f, f.waypoint, CYAN, `${f.waypointLabel} ${(dist / 1000).toFixed(1)}km`);
      }
    }

    const cx = this.w / 2;
    const blink = Math.sin(f.time * 12) > -0.2;

    if (f.missileThreat && blink) {
      const c2 = this.ctx;
      c2.save();
      c2.fillStyle = RED;
      c2.textAlign = 'center';
      c2.font = '700 20px ui-monospace, Menlo, monospace';
      c2.fillText('MISSILE', cx, this.h * 0.26);
      c2.restore();
      this.drawEdgeArrow(f, f.missileThreat.pos, RED, 'INBOUND');
    }

    if (f.pullUp && blink) {
      c.save();
      c.fillStyle = RED;
      c.textAlign = 'center';
      c.font = '700 22px ui-monospace, Menlo, monospace';
      c.fillText('PULL UP', cx, this.h * 0.72);
      c.restore();
    }

    if (f.stall) {
      c.save();
      c.fillStyle = AMBER;
      c.textAlign = 'center';
      c.font = '700 16px ui-monospace, Menlo, monospace';
      c.fillText('LOW SPEED', cx, this.h * 0.62);
      c.restore();
    }

    if (f.outOfBounds !== null) {
      c.save();
      c.fillStyle = RED;
      c.textAlign = 'center';
      c.font = '700 20px ui-monospace, Menlo, monospace';
      c.fillText('LEAVING MISSION AREA', cx, this.h * 0.2);
      c.font = '700 30px ui-monospace, Menlo, monospace';
      c.fillText(`${Math.ceil(f.outOfBounds)}`, cx, this.h * 0.2 + 34);
      c.restore();
    }
  }
}
