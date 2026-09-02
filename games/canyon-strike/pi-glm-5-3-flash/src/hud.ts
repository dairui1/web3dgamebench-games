// DOM-based HUD: health, weapons, objective, target markers, screens.

import * as THREE from 'three';
import { clamp } from './utils';

export interface MarkerView {
  el: HTMLDivElement;
  offscreen: boolean;
}

export class Hud {
  readonly root: HTMLDivElement;

  private healthBar: HTMLDivElement;
  private healthText: HTMLDivElement;
  private missileText: HTMLDivElement;
  private scoreText: HTMLDivElement;
  private objectiveText: HTMLDivElement;
  private speedText: HTMLDivElement;
  private altText: HTMLDivElement;
  private lockBox: HTMLDivElement;
  private lockLabel: HTMLDivElement;
  private warnMissile: HTMLDivElement;
  private warnTerrain: HTMLDivElement;
  private hitMarker: HTMLDivElement;
  private vignette: HTMLDivElement;
  private centerReticle: HTMLDivElement;
  private msg: HTMLDivElement;
  private msgSub: HTMLDivElement;
  private overlay: HTMLDivElement;
  private overlayTitle: HTMLDivElement;
  private overlayBody: HTMLDivElement;
  private overlayBtn: HTMLButtonElement;
  private pauseTag: HTMLDivElement;
  private markers = new Map<number, HTMLDivElement>();
  private targetList: HTMLDivElement;

  private vignetteAlpha = 0;
  private hitMarkerAlpha = 0;

  constructor(private container: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div id="hud-top">
        <div id="hud-objective">
          <div class="hud-label">OBJECTIVE</div>
          <div id="objective-text">Destroy all SAM sites</div>
        </div>
        <div id="hud-score">
          <div class="hud-label">SCORE</div>
          <div id="score-text">0</div>
          <div id="targets-left"></div>
        </div>
      </div>
      <div id="hud-left">
        <div class="hud-label">HULL</div>
        <div id="health-track"><div id="health-bar"></div></div>
        <div id="health-text" class="hud-value">100</div>
      </div>
      <div id="hud-right">
        <div class="hud-label">MSL <span id="missile-text">24</span></div>
        <div id="flight-data">
          <div class="hud-value"><span class="hud-label">SPD</span> <span id="speed-text">0</span></div>
          <div class="hud-value"><span class="hud-label">ALT</span> <span id="alt-text">0</span></div>
        </div>
      </div>
      <div id="center-reticle"></div>
      <div id="lock-box"><div id="lock-label">LOCKING</div></div>
      <div id="hit-marker"></div>
      <div id="warn-missile" class="warn hidden">⚠ MISSILE — BREAK!</div>
      <div id="warn-terrain" class="warn hidden">▲ PULL UP ▲</div>
      <div id="msg-wrap"><div id="msg"></div><div id="msg-sub"></div></div>
      <div id="vignette"></div>
      <div id="pause-tag" class="hidden">— PAUSED —</div>
      <div id="overlay">
        <div id="overlay-title">CANYON STRIKE</div>
        <div id="overlay-body"></div>
        <button id="overlay-btn">TAKE OFF</button>
      </div>
    `;
    this.container.appendChild(this.root);

    const q = <T extends HTMLElement = HTMLDivElement>(sel: string): T => {
      const el = this.root.querySelector(sel);
      if (!el) throw new Error(`missing HUD element ${sel}`);
      return el as T;
    };
    this.healthBar = q('#health-bar');
    this.healthText = q('#health-text');
    this.missileText = q('#missile-text');
    this.scoreText = q('#score-text');
    this.objectiveText = q('#objective-text');
    this.speedText = q('#speed-text');
    this.altText = q('#alt-text');
    this.lockBox = q('#lock-box');
    this.lockLabel = q('#lock-label');
    this.warnMissile = q('#warn-missile');
    this.warnTerrain = q('#warn-terrain');
    this.hitMarker = q('#hit-marker');
    this.vignette = q('#vignette');
    this.centerReticle = q('#center-reticle');
    this.msg = q('#msg');
    this.msgSub = q('#msg-sub');
    this.overlay = q('#overlay');
    this.overlayTitle = q('#overlay-title');
    this.overlayBody = q('#overlay-body');
    this.overlayBtn = q<HTMLButtonElement>('#overlay-btn');
    this.pauseTag = q('#pause-tag');
    this.targetList = q('#targets-left');

    this.overlayBtn.dataset.uiButton = '1';
  }

  onStart(cb: () => void): void {
    this.overlayBtn.addEventListener('click', () => {
      cb();
    });
    // Also allow Enter to start / restart.
    window.addEventListener('keydown', (e) => {
      if (
        e.key === 'Enter' &&
        !this.overlay.classList.contains('hidden')
      ) {
        cb();
      }
    });
  }

  showStart(): void {
    this.overlayTitle.textContent = 'CANYON STRIKE';
    this.overlayBody.innerHTML = `
      <p>Penetrate Rustfall Canyon. Destroy all <b>6 SAM sites</b>, then reach the
      <b>extraction zone</b> at the canyon's end.</p>
      <p class="controls">
        <b>W/S</b> or <b>↑/↓</b> pitch &nbsp;·&nbsp; <b>A/D</b> or <b>←/→</b> roll (bank to turn)<br/>
        <b>Q/E</b> rudder &nbsp;·&nbsp; <b>Shift/Ctrl</b> throttle<br/>
        <b>Space</b> or <b>Left-click</b> gun &nbsp;·&nbsp; <b>F</b> or <b>Right-click</b> missile (hold lock)<br/>
        <b>P</b> pause &nbsp;·&nbsp; touch devices: on-screen stick &amp; buttons
      </p>
    `;
    this.overlayBtn.textContent = 'TAKE OFF';
    this.overlay.classList.remove('hidden');
  }

  showEnd(win: boolean, score: number, kills: number, time: number): void {
    this.overlayTitle.textContent = win
      ? 'MISSION ACCOMPLISHED'
      : 'MISSION FAILED';
    const mins = Math.floor(time / 60);
    const secs = Math.floor(time % 60);
    this.overlayBody.innerHTML = `
      <p>${win
        ? 'All SAM sites destroyed. You slipped the canyon and reached extraction.'
        : 'Your aircraft was lost over Rustfall Canyon.'}</p>
      <p class="stats">Score <b>${score}</b> &nbsp;·&nbsp; Kills <b>${kills}</b> &nbsp;·&nbsp; Time <b>${mins}:${String(secs).padStart(2, '0')}</b></p>
    `;
    this.overlayBtn.textContent = 'FLY AGAIN';
    this.overlay.classList.remove('hidden');
  }

  hideOverlay(): void {
    this.overlay.classList.add('hidden');
  }

  setPaused(p: boolean): void {
    this.pauseTag.classList.toggle('hidden', !p);
  }

  setHealth(hp: number, max: number): void {
    const t = clamp(hp / max, 0, 1);
    this.healthBar.style.width = `${t * 100}%`;
    this.healthBar.style.background =
      t > 0.55 ? '#69d173' : t > 0.25 ? '#e8c04a' : '#e4574f';
    this.healthText.textContent = String(Math.max(0, Math.ceil(hp)));
  }

  setMissiles(n: number): void {
    this.missileText.textContent = String(n);
  }

  setScore(score: number): void {
    this.scoreText.textContent = String(score);
  }

  setTargetsLeft(text: string): void {
    this.targetList.textContent = text;
  }

  setObjective(text: string, highlight = false): void {
    this.objectiveText.textContent = text;
    this.objectiveText.style.color = highlight ? '#ffe27a' : '#f6f5ef';
  }

  setFlight(speed: number, alt: number): void {
    this.speedText.textContent = String(Math.round(speed * 3.6));
    this.altText.textContent = String(Math.max(0, Math.round(alt)));
  }

  setLock(state: 'none' | 'locking' | 'locked', screenPos: THREE.Vector2 | null, progress: number): void {
    if (state === 'none' || !screenPos) {
      this.lockBox.classList.add('hidden');
      return;
    }
    this.lockBox.classList.remove('hidden');
    this.lockBox.style.transform = `translate(${screenPos.x}px, ${screenPos.y}px)`;
    this.lockBox.classList.toggle('locked', state === 'locked');
    this.lockLabel.textContent = state === 'locked' ? 'LOCKED' : 'LOCKING';
    this.lockBox.style.setProperty('--lock-progress', String(clamp(progress, 0, 1)));
  }

  setReticleVisible(v: boolean): void {
    this.centerReticle.classList.toggle('hidden', !v);
  }

  setMissileWarning(on: boolean): void {
    this.warnMissile.classList.toggle('hidden', !on);
  }

  setTerrainWarning(on: boolean): void {
    this.warnTerrain.classList.toggle('hidden', !on);
  }

  flashDamage(amount01: number): void {
    this.vignetteAlpha = clamp(this.vignetteAlpha + amount01, 0, 0.85);
  }

  showHitMarker(): void {
    this.hitMarkerAlpha = 1;
  }

  /** Transient center message, auto-hides after `time` seconds. */
  showMessage(text: string, sub = '', time = 3): void {
    this.msg.textContent = text;
    this.msgSub.textContent = sub;
    this.msg.parentElement?.classList.add('visible');
    window.setTimeout(() => {
      this.msg.parentElement?.classList.remove('visible');
    }, time * 1000);
  }

  addMarker(id: number, primary: boolean): void {
    const el = document.createElement('div');
    el.className = primary ? 'marker primary' : 'marker';
    this.root.appendChild(el);
    this.markers.set(id, el);
  }

  removeMarker(id: number): void {
    const el = this.markers.get(id);
    if (el) {
      el.remove();
      this.markers.delete(id);
    }
  }

  clearMarkers(): void {
    for (const el of this.markers.values()) el.remove();
    this.markers.clear();
  }

  /** Project world positions into screen space for markers. */
  updateMarkers(
    camera: THREE.Camera,
    items: { id: number; pos: THREE.Vector3; alive: boolean; primary: boolean }[],
  ): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const v = new THREE.Vector3();
    for (const item of items) {
      const el = this.markers.get(item.id);
      if (!el) continue;
      if (!item.alive) {
        el.style.display = 'none';
        continue;
      }
      v.copy(item.pos).project(camera);
      const behind = v.z > 1;
      if (behind) {
        el.style.display = 'none';
        continue;
      }
      const x = (v.x * 0.5 + 0.5) * w;
      const y = (-v.y * 0.5 + 0.5) * h;
      const off = x < 40 || x > w - 40 || y < 40 || y > h - 40;
      if (off && !item.primary) {
        el.style.display = 'none';
        continue;
      }
      el.style.display = 'block';
      const cx = clamp(x, 46, w - 46);
      const cy = clamp(y, 46, h - 46);
      el.style.transform = `translate(${cx}px, ${cy}px)`;
      el.classList.toggle('offscreen', off);
    }
  }

  update(dt: number): void {
    if (this.vignetteAlpha > 0) {
      this.vignetteAlpha = Math.max(0, this.vignetteAlpha - dt * 1.4);
      this.vignette.style.opacity = String(this.vignetteAlpha);
    }
    if (this.hitMarkerAlpha > 0) {
      this.hitMarkerAlpha = Math.max(0, this.hitMarkerAlpha - dt * 3.5);
      this.hitMarker.style.opacity = String(this.hitMarkerAlpha);
      this.hitMarker.style.transform = `translate(-50%, -50%) scale(${1.6 - this.hitMarkerAlpha * 0.6})`;
    }
  }
}
