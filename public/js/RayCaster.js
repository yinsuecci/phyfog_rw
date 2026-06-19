/**
 * RayCaster.js — 光线投射（镜面边线段相交反射、透镜暴击圈）
 */
import { BANDS, cellKey, degToRad, normalizeAngle } from './constants.js';
import { segmentMirrorHit, reflectAtMirror } from './mirrorUtils.js';

const MAX_STEPS = 2000;
const STEP = 0.05;
const FOCUS_TOL = 0.55;

export class RayCaster {
  constructor(ctx) {
    this.ctx = ctx;
    this._mirrorList = null;
  }

  _getMirrors() {
    if (!this._mirrorList) {
      this._mirrorList = Object.values(this.ctx.cells).filter((el) => el.type === 'mirror');
    }
    return this._mirrorList;
  }

  invalidateMirrors() {
    this._mirrorList = null;
  }

  traceFullPath(origin, angleDeg, bandId, bandEnergy, shooterIdx, options = {}) {
    const band = BANDS[bandId];
    const energy = bandEnergy ?? band.cost ?? 1;
    const gs = this.ctx.gridSize;

    let x = origin.x + 0.5;
    let y = origin.y + 0.5;
    let dx = Math.cos(degToRad(normalizeAngle(angleDeg)));
    let dy = Math.sin(degToRad(normalizeAngle(angleDeg)));
    const dirLen = Math.hypot(dx, dy) || 1;
    dx /= dirLen;
    dy /= dirLen;

    const path = [{ x, y, crit: false }];
    const hits = [];
    const mirrorHits = [];
    const visionReveals = [];
    const allyContacts = [];
    const beaconUpdates = [];
    const passedLenses = [];
    const solarClaims = [];
    const usedMirrors = new Set();
    const shootOriginKey = options.shootOriginKey ?? null;
    let messages = options.radioMessage;
    let radioEnergy = options.radioEnergy || 0;

    const pushPoint = (px, py) => {
      const gx = Math.floor(px);
      const gy = Math.floor(py);
      const crit = this._isCritAt(px, py, passedLenses)
        || this._isCritAtCell(gx, gy, passedLenses);
      const last = path[path.length - 1];
      if (!last || Math.hypot(last.x - px, last.y - py) > 0.012) {
        path.push({ x: px, y: py, crit });
      }
    };

    let lastGx = -1;
    let lastGy = -1;

    for (let step = 0; step < MAX_STEPS; step++) {
      const nx = x + dx * STEP;
      const ny = y + dy * STEP;

      if (bandId !== 'gamma') {
        const mirrorHit = this._findMirrorHit(x, y, nx, ny, usedMirrors);
        if (mirrorHit) {
          pushPoint(mirrorHit.px, mirrorHit.py);
          mirrorHits.push({
            x: mirrorHit.el.x,
            y: mirrorHit.el.y,
            angle: mirrorHit.el.angle,
            px: mirrorHit.px,
            py: mirrorHit.py,
          });
          usedMirrors.add(mirrorHit.key);
          const refl = reflectAtMirror(dx, dy, mirrorHit.el);
          dx = refl.dx;
          dy = refl.dy;
          x = mirrorHit.px + dx * 1e-4;
          y = mirrorHit.py + dy * 1e-4;
          continue;
        }
      }

      x = nx;
      y = ny;
      pushPoint(x, y);

      const gx = Math.floor(x);
      const gy = Math.floor(y);
      if (gx < 0 || gy < 0 || gx >= gs || gy >= gs) break;

      if (gx !== lastGx || gy !== lastGy) {
        lastGx = gx;
        lastGy = gy;
        const stop = this._processCell(gx, gy, x, y, band, bandId, energy, shooterIdx, shootOriginKey, {
          hits, visionReveals, allyContacts, beaconUpdates, passedLenses, solarClaims,
        }, (contact) => {
          allyContacts.push(contact);
          messages = null;
          radioEnergy = 0;
        }, () => ({ message: messages, energy: radioEnergy }));
        if (stop) break;
      }
    }

    return {
      path, hits, mirrorHits, visionReveals, allyContacts, beaconUpdates, solarClaims,
      bandId, energy, passedLenses,
    };
  }

  _findMirrorHit(x0, y0, x1, y1, usedMirrors) {
    let best = null;
    for (const el of this._getMirrors()) {
      const key = `${el.x},${el.y}`;
      if (usedMirrors.has(key)) continue;
      const hit = segmentMirrorHit(x0, y0, x1, y1, el);
      if (!hit) continue;
      if (!best || hit.t < best.t) {
        best = { ...hit, el, key };
      }
    }
    return best;
  }

  _processCell(gx, gy, x, y, band, bandId, energy, shooterIdx, shootOriginKey, bags, onAlly, getRadio) {
    const key = cellKey(gx, gy);
    if (band.revealsVision) bags.visionReveals.push(key);

    const playerIdx = this.ctx.players.findIndex((p) =>
      p.alive && p.towerX === gx && p.towerY === gy
    );

    if (band.allyInteract && playerIdx >= 0 && playerIdx !== shooterIdx &&
        this.ctx.isAlly(shooterIdx, playerIdx)) {
      const radio = getRadio();
      onAlly({ allyIdx: playerIdx, message: radio.message, energy: radio.energy });
    }

    const el = this.ctx.cells[key];

    if (el?.type === 'lens' && bandId !== 'gamma') {
      if (!bags.passedLenses.some((l) => l.x === gx && l.y === gy)) {
        bags.passedLenses.push({ x: gx, y: gy, focal: el.focal ?? 5 });
      }
    }

    if (playerIdx >= 0 && playerIdx !== shooterIdx && bandId !== 'radio') {
      if (band.gammaRule) {
        bags.hits.push({ key, type: 'player_tower', playerIdx, gamma: true, ...this._gammaDamage(this.ctx.players[playerIdx]) });
        return true;
      }
      if (band.damagesHp) {
        const crit = this._isCritAtCell(gx, gy, bags.passedLenses);
        bags.hits.push({ key, type: 'player_tower', playerIdx, damage: crit ? energy * 2 : energy, crit });
        return true;
      }
    }

    if (!el) return false;

    if (el.type === 'beacon' && bandId === 'visible' && energy >= (el.activationThreshold || 10)) {
      bags.beaconUpdates.push({ key, owner: shooterIdx, energy });
    }

    if (el.type === 'lead') {
      bags.hits.push({ key, type: 'lead', blocked: true });
      return true;
    }

    if (el.type === 'mirror' || el.type === 'lens') {
      return false;
    }

    if (el.type === 'wall' && bandId === 'gamma') {
      bags.hits.push({ key, type: 'wall', gamma: true, ...this._gammaDamage(el) });
      return false;
    }
    if (el.type === 'wall') {
      const crit = this._isCritAtCell(gx, gy, bags.passedLenses);
      bags.hits.push({ key, type: 'wall', damage: crit ? energy * 2 : energy, crit });
      return true;
    }
    if (el.type === 'attack_tower') {
      if (key === shootOriginKey) return false;
      if (bandId === 'visible' && el.owner !== shooterIdx) {
        bags.hits.push({ key, type: 'attack_tower', capture: true });
        return true;
      }
      if (band.damagesHp && bandId !== 'gamma') {
        const crit = this._isCritAtCell(gx, gy, bags.passedLenses);
        bags.hits.push({ key, type: el.type, damage: crit ? energy * 2 : energy, crit });
        return true;
      }
      return false;
    }
    if (el.type === 'solar') {
      if (el.owner == null && !bags.solarClaims.some((c) => c.key === key)) {
        bags.solarClaims.push({ key, owner: shooterIdx });
      }
      if (el.playerBuilt && energy < 3 && bandId !== 'gamma') {
        bags.hits.push({ key, type: 'solar', convert: true, noDamage: true });
        return true;
      }
      if (band.damagesHp && bandId !== 'gamma') {
        const crit = this._isCritAtCell(gx, gy, bags.passedLenses);
        bags.hits.push({ key, type: 'solar', damage: crit ? energy * 2 : energy, crit });
        return true;
      }
      return false;
    }
    if (band.gammaRule) {
      bags.hits.push({ key, type: el.type, gamma: true, ...this._gammaDamage(el) });
      return false;
    }
    if (band.damagesHp) {
      const crit = this._isCritAtCell(gx, gy, bags.passedLenses);
      bags.hits.push({ key, type: el.type, damage: crit ? energy * 2 : energy, crit });
      return true;
    }
    return false;
  }

  /** 以格子中心判定是否在透镜聚焦圈上（与编辑器聚焦圈一致） */
  _isCritAtCell(gx, gy, passedLenses) {
    return this._isCritAt(gx + 0.5, gy + 0.5, passedLenses);
  }

  _isCritAt(px, py, passedLenses) {
    for (const l of passedLenses) {
      const dist = Math.hypot(px - (l.x + 0.5), py - (l.y + 0.5));
      if (Math.abs(dist - l.focal) < FOCUS_TOL) return true;
    }
    return false;
  }

  _gammaDamage(el) {
    const hp = el.hp ?? 100;
    const maxHp = el.maxHp ?? hp;
    if (hp <= maxHp / 2) return { execute: true, damage: hp };
    return { execute: false, damage: Math.ceil(maxHp / 2) };
  }
}
