/**
 * MapRenderer.js — 相机锁定控制塔、战争迷雾、光束渲染
 */
import { BANDS, visibleColor, normalizeAngle } from './constants.js';
import { getMirrorSegment } from './mirrorUtils.js';

export class MapRenderer {
  constructor(canvas, wrapEl) {
    this.canvas = canvas;
    this.wrapEl = wrapEl;
    this.ctx = canvas.getContext('2d');
    this.cellSize = 30;
    this.gridSize = 100;
    this.pulsePhase = 0;
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.userZoom = 1;
    this.userZoomMin = 0.35;
    this.userZoomMax = 3.5;
    this.userPan = { x: 0, y: 0 };
    this._panLimit = 1200;
    this.selectedOptics = null;
    this.selectedSolar = null;
    this._displayTime = 0;
    this._viewportW = 0;
    this._viewportH = 0;
    this._dpr = 1;
    /** 本地平滑显示角度（仅渲染，不改游戏状态） */
    this._smoothAngles = {};
  }

  _smoothAngle(key, targetDeg) {
    const target = normalizeAngle(targetDeg);
    let cur = this._smoothAngles[key];
    if (cur == null) {
      this._smoothAngles[key] = target;
      return target;
    }
    let diff = target - cur;
    while (diff > 180) diff -= 360;
    while (diff < -180) diff += 360;
    if (Math.abs(diff) < 0.25) cur = target;
    else cur += diff * 0.55;
    cur = normalizeAngle(cur);
    this._smoothAngles[key] = cur;
    return cur;
  }

  setUserZoom(delta) {
    this.userZoom = Math.max(this.userZoomMin, Math.min(this.userZoomMax, this.userZoom + delta));
  }

  resetUserZoom() {
    this.userZoom = 1;
    this.userPan = { x: 0, y: 0 };
  }

  addUserPan(dx, dy) {
    const lim = this._panLimit * this.userZoom;
    this.userPan.x = Math.max(-lim, Math.min(lim, this.userPan.x + dx));
    this.userPan.y = Math.max(-lim, Math.min(lim, this.userPan.y + dy));
  }

  selectOpticsAt(game, localPlayerIdx, gx, gy) {
    const key = `${gx},${gy}`;
    const el = game.cells[key];
    if ((el?.type === 'mirror' || el?.type === 'lens') && game.canSee(localPlayerIdx, gx, gy)) {
      this.selectedOptics = { x: gx, y: gy, type: el.type, focal: el.focal || 5 };
      return true;
    }
    this.selectedOptics = null;
    return false;
  }

  clearOpticsSelection() {
    this.selectedOptics = null;
  }

  /** @deprecated */
  selectLensAt(game, localPlayerIdx, gx, gy) {
    return this.selectOpticsAt(game, localPlayerIdx, gx, gy)
      && this.selectedOptics?.type === 'lens';
  }

  /** @deprecated */
  clearLensSelection() {
    this.clearOpticsSelection();
  }

  get selectedLens() {
    return this.selectedOptics?.type === 'lens' ? this.selectedOptics : null;
  }

  set selectedLens(v) {
    this.selectedOptics = v ? { ...v, type: 'lens' } : null;
  }

  selectSolarAt(game, localPlayerIdx, gx, gy) {
    const el = game.cells[`${gx},${gy}`];
    if (el?.type === 'solar' && game.canSee(localPlayerIdx, gx, gy)) {
      this.selectedSolar = { x: gx, y: gy };
      return el;
    }
    this.selectedSolar = null;
    return null;
  }

  clearSolarSelection() {
    this.selectedSolar = null;
  }

  resize(gridSize, cellSize) {
    this.gridSize = gridSize;
    this.cellSize = cellSize;
    if (!this._resizeObserver && this.wrapEl && typeof ResizeObserver !== 'undefined') {
      this._resizeObserver = new ResizeObserver(() => this._resizeViewport());
      this._resizeObserver.observe(this.wrapEl);
    }
    if (!this._onWindowResize) {
      this._onWindowResize = () => this._resizeViewport();
      window.addEventListener('resize', this._onWindowResize);
    }
    this._viewportW = 0;
    this._viewportH = 0;
    this._resizeViewport();
  }

  destroy() {
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
  }

  _measureWrap() {
    if (!this.wrapEl) return { w: 1, h: 1 };
    const rect = this.wrapEl.getBoundingClientRect();
    let w = Math.floor(rect.width);
    let h = Math.floor(rect.height);
    if (w < 2 || h < 2) {
      w = Math.max(w, this.wrapEl.clientWidth | 0);
      h = Math.max(h, this.wrapEl.clientHeight | 0);
    }
    return { w: Math.max(1, w), h: Math.max(1, h) };
  }

  _resizeViewport() {
    if (!this.wrapEl || !this.canvas) return;
    const { w, h } = this._measureWrap();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (w === this._viewportW && h === this._viewportH && dpr === this._dpr) return;

    this._viewportW = w;
    this._viewportH = h;
    this._dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
  }

  _viewSize() {
    return { w: this._viewportW || 1, h: this._viewportH || 1 };
  }

  _updateCamera(game, localPlayerIdx) {
    const p = game.players[localPlayerIdx];
    const pos = p
      ? game.getActiveTowerPos(localPlayerIdx)
      : { x: game.gridSize / 2, y: game.gridSize / 2, angle: 0 };
    const cs = this.cellSize;
    this.camera.x = (pos.x + 0.5) * cs + this.userPan.x;
    this.camera.y = (pos.y + 0.5) * cs + this.userPan.y;
    this.camera.zoom = Math.max(0.08, Math.min(this.userZoom, 6));
  }

  worldToScreen(wx, wy) {
    const { x, y, zoom } = this.camera;
    const { w: vw, h: vh } = this._viewSize();
    return {
      x: (wx - x) * zoom + vw / 2,
      y: (wy - y) * zoom + vh / 2,
    };
  }

  screenToWorld(sx, sy) {
    const { x, y, zoom } = this.camera;
    const { w: vw, h: vh } = this._viewSize();
    return {
      x: (sx - vw / 2) / zoom + x,
      y: (sy - vh / 2) / zoom + y,
    };
  }

  screenToGrid(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const scaleX = this._viewportW / (rect.width || 1);
    const scaleY = this._viewportH / (rect.height || 1);
    const w = this.screenToWorld(sx * scaleX, sy * scaleY);
    return {
      x: Math.floor(w.x / this.cellSize),
      y: Math.floor(w.y / this.cellSize),
    };
  }

  render(game, localPlayerIdx, displayTime = 0) {
    if (!game) return;
    this._displayTime = displayTime;
    this._resizeViewport();
    this._updateCamera(game, localPlayerIdx);

    const ctx = this.ctx;
    const cs = this.cellSize;
    const gs = game.gridSize;
    const { w: vw, h: vh } = this._viewSize();

    const seeCache = new Map();
    const canSee = (gx, gy) => {
      const k = gx * 100000 + gy;
      if (seeCache.has(k)) return seeCache.get(k);
      const v = game.canSee(localPlayerIdx, gx, gy);
      seeCache.set(k, v);
      return v;
    };

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, vw, vh);

    ctx.save();
    ctx.translate(vw / 2, vh / 2);
    ctx.scale(this.camera.zoom, this.camera.zoom);
    ctx.translate(-this.camera.x, -this.camera.y);

    const viewWorldR = Math.max(vw, vh) / this.camera.zoom / 2 + cs * 2;
    const minGx = Math.max(0, Math.floor((this.camera.x - viewWorldR) / cs));
    const maxGx = Math.min(gs - 1, Math.ceil((this.camera.x + viewWorldR) / cs));
    const minGy = Math.max(0, Math.floor((this.camera.y - viewWorldR) / cs));
    const maxGy = Math.min(gs - 1, Math.ceil((this.camera.y + viewWorldR) / cs));

    ctx.strokeStyle = '#1e1e1e';
    ctx.lineWidth = 1 / this.camera.zoom;
    for (let i = minGx; i <= maxGx + 1; i++) {
      ctx.beginPath();
      ctx.moveTo(i * cs, minGy * cs);
      ctx.lineTo(i * cs, (maxGy + 1) * cs);
      ctx.stroke();
    }
    for (let j = minGy; j <= maxGy + 1; j++) {
      ctx.beginPath();
      ctx.moveTo(minGx * cs, j * cs);
      ctx.lineTo((maxGx + 1) * cs, j * cs);
      ctx.stroke();
    }

    for (let gy = minGy; gy <= maxGy; gy++) {
      for (let gx = minGx; gx <= maxGx; gx++) {
        if (!canSee(gx, gy)) continue;
        const el = game.cells[`${gx},${gy}`];
        if (el) this._drawElement(el, cs, game, localPlayerIdx);
      }
    }

    game.beacons.forEach(b => {
      if (canSee(b.x, b.y)) this._drawBeacon(b, cs, game.players[b.owner]);
    });

    game.players.forEach((p, i) => {
      if (!p?.alive) return;
      if (!canSee(p.towerX, p.towerY)) return;
      const isControlled = i === localPlayerIdx;
      const onAttack = isControlled && p.activeTower?.type === 'attack' && p.activeTower.key;
      if (onAttack) {
        this._drawTower(p.towerX, p.towerY, 0, cs, p.color, 'P' + (i + 1), false, false);
        const atkEl = game.cells[p.activeTower.key];
        if (atkEl) {
          const atkAngle = isControlled
            ? (atkEl.angle ?? 0)
            : this._smoothAngle(`remote-atk-${i}-${p.activeTower.key}`, atkEl.angle ?? 0);
          this._drawTower(atkEl.x, atkEl.y, atkAngle, cs, p.color, '⚔', true, true);
        }
      } else {
        const angle = isControlled
          ? p.angle
          : this._smoothAngle(`remote-main-${i}`, p.angle);
        this._drawTower(p.towerX, p.towerY, angle, cs, p.color, 'P' + (i + 1), isControlled, true);
      }
    });

    const local = game.players[localPlayerIdx];
    if (local?.alive) {
      const pos = game.getActiveTowerPos(localPlayerIdx);
      const cx = (pos.x + 0.5) * cs;
      const cy = (pos.y + 0.5) * cs;
      const r = game.visibilityRange * cs;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(88,166,255,0.2)';
      ctx.lineWidth = 1.5 / this.camera.zoom;
      ctx.stroke();
    }

    this.pulsePhase += 0.08;
    (game.activeRays || []).forEach(ray => this._drawRay(ray, cs));

    for (let gy = minGy; gy <= maxGy; gy++) {
      for (let gx = minGx; gx <= maxGx; gx++) {
        if (canSee(gx, gy)) continue;
        ctx.fillStyle = 'rgba(0,0,0,0.92)';
        ctx.fillRect(gx * cs, gy * cs, cs, cs);
      }
    }

    if (this.selectedOptics?.type === 'lens') {
      const el = game.cells[`${this.selectedOptics.x},${this.selectedOptics.y}`];
      if (el?.type === 'lens' && canSee(this.selectedOptics.x, this.selectedOptics.y)) {
        const focal = el.focal ?? this.selectedOptics.focal ?? 5;
        this._drawFocusCircle(ctx, cs, this.selectedOptics.x, this.selectedOptics.y, focal, true);
      } else {
        this.selectedOptics = null;
      }
    }

    ctx.restore();

    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`缩放 ${Math.round(this.userZoom * 100)}%`, vw - 8, vh - 8);
    ctx.textAlign = 'left';
    const sel = this.selectedOptics;
    const selEl = sel ? game.cells[`${sel.x},${sel.y}`] : null;
    let hint = '滚轮/双指缩放 · 单指拖屏 · 点击平面镜/透镜选中';
    if (selEl?.type === 'lens') {
      hint = `透镜 f=${selEl.focal ?? '?'}格${selEl.uvGrade ? ' · 已镀膜' : ' · 可升级镀膜'}`;
    } else if (selEl?.type === 'mirror') {
      hint = `平面镜 ${Math.round(selEl.angle ?? 0)}°${selEl.uvGrade ? ' · 已镀膜' : ' · 可升级镀膜'}`;
    }
    ctx.fillText(hint, 8, vh - 8);
  }

  _drawElement(el, cs, game, localPlayerIdx) {
    const x = el.x * cs, y = el.y * cs;
    const cx = x + cs / 2, cy = y + cs / 2;
    const pad = cs * 0.1;
    const ctx = this.ctx;
    const local = game.players[localPlayerIdx];
    const activeAttackKey = local?.activeTower?.type === 'attack' ? local.activeTower.key : null;
    const elKey = `${el.x},${el.y}`;

    switch (el.type) {
      case 'wall':
        ctx.fillStyle = '#444'; ctx.fillRect(x + pad, y + pad, cs - pad * 2, cs - pad * 2); break;
      case 'lead':
        ctx.fillStyle = '#222'; ctx.fillRect(x + pad, y + pad, cs - pad * 2, cs - pad * 2);
        ctx.strokeStyle = '#555'; ctx.lineWidth = 1 / this.camera.zoom;
        ctx.strokeRect(x + pad, y + pad, cs - pad * 2, cs - pad * 2); break;
      case 'mirror': {
        const isSel = this.selectedOptics?.type === 'mirror'
          && this.selectedOptics.x === el.x && this.selectedOptics.y === el.y;
        const seg = getMirrorSegment(el);
        ctx.strokeStyle = el.uvGrade ? '#fbbf24' : '#c0d8f0';
        ctx.lineWidth = (el.uvGrade ? 4 : 3) / this.camera.zoom;
        ctx.beginPath();
        ctx.moveTo(seg.x1 * cs, seg.y1 * cs);
        ctx.lineTo(seg.x2 * cs, seg.y2 * cs);
        ctx.stroke();
        if (isSel && !el.uvGrade) {
          ctx.strokeStyle = 'rgba(165,243,252,0.7)';
          ctx.lineWidth = 5 / this.camera.zoom;
          ctx.beginPath();
          ctx.moveTo(seg.x1 * cs, seg.y1 * cs);
          ctx.lineTo(seg.x2 * cs, seg.y2 * cs);
          ctx.stroke();
        }
        break;
      }
      case 'lens': {
        const isSel = this.selectedOptics?.type === 'lens'
          && this.selectedOptics.x === el.x && this.selectedOptics.y === el.y;
        ctx.strokeStyle = el.uvGrade ? '#fbbf24' : (isSel ? '#a5f3fc' : '#67e8f9');
        ctx.lineWidth = (el.uvGrade ? 3 : isSel ? 3 : 2) / this.camera.zoom;
        ctx.beginPath();
        ctx.arc(cx, cy, cs * 0.28, 0, Math.PI * 2);
        ctx.stroke();
        if (el.uvGrade) {
          ctx.fillStyle = 'rgba(251,191,36,0.22)';
          ctx.fill();
        } else if (isSel) {
          ctx.fillStyle = 'rgba(103,232,249,0.15)';
          ctx.fill();
        }
        break;
      }
      case 'solar': {
        const isSel = this.selectedSolar?.x === el.x && this.selectedSolar?.y === el.y;
        if (isSel) {
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = 2 / this.camera.zoom;
          ctx.strokeRect(x + 1, y + 1, cs - 2, cs - 2);
        }
        ctx.fillStyle = '#fbbf2444';
        ctx.fillRect(x + pad, y + pad, cs - pad * 2, cs - pad * 2);
        if (el.owner != null) {
          const owner = game.players[el.owner];
          if (owner) {
            const tag = 'P' + (el.owner + 1);
            const tagW = Math.max(cs * 0.58, cs * 0.22 * tag.length);
            const tagH = cs * 0.26;
            const tagX = cx - tagW / 2;
            const tagY = y + 1;
            ctx.fillStyle = owner.color;
            if (typeof ctx.roundRect === 'function') {
              ctx.beginPath();
              ctx.roundRect(tagX, tagY, tagW, tagH, 3 / this.camera.zoom);
              ctx.fill();
            } else {
              ctx.fillRect(tagX, tagY, tagW, tagH);
            }
            ctx.strokeStyle = 'rgba(255,255,255,0.85)';
            ctx.lineWidth = 1 / this.camera.zoom;
            ctx.stroke();
            ctx.fillStyle = '#fff';
            ctx.font = `bold ${Math.max(9, cs * 0.19)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(tag, cx, tagY + tagH / 2);
          }
        }
        ctx.fillStyle = '#fbbf24';
        ctx.font = `${cs * 0.32}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('☀', cx, cy + cs * 0.06);
        break;
      }
      case 'attack_tower': {
        const owner = el.owner != null ? game.players[el.owner] : null;
        const color = owner?.color ?? '#94a3b8';
        const isActive = activeAttackKey === elKey;
        this._drawTower(el.x, el.y, el.angle || 0, cs, color, '⚔', isActive, true);
        break;
      }
      case 'beacon':
        this._drawBeacon({ x: el.x, y: el.y }, cs, null); break;
    }

    if (el.hp != null && el.maxHp && el.type !== 'mirror' && el.type !== 'lens') {
      const ratio = Math.max(0, el.hp / el.maxHp);
      ctx.fillStyle = ratio > 0.5 ? '#3fb950' : '#f85149';
      ctx.fillRect(x + 2, y + cs - 7, (cs - 4) * ratio, 3);
    }
    if (el.type === 'solar') {
      const prog = (this._displayTime % 10) / 10;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(x + 2, y + cs - 3, cs - 4, 2);
      ctx.fillStyle = '#fbbf24';
      ctx.fillRect(x + 2, y + cs - 3, (cs - 4) * prog, 2);
    }
  }

  _drawBeacon(b, cs, owner) {
    const cx = b.x * cs + cs / 2, cy = b.y * cs + cs / 2;
    const color = owner?.color || '#a855f7';
    this.ctx.strokeStyle = color;
    this.ctx.lineWidth = 1.5 / this.camera.zoom;
    this.ctx.beginPath(); this.ctx.arc(cx, cy, cs * 0.35, 0, Math.PI * 2); this.ctx.stroke();
    this.ctx.fillStyle = color + '44';
    this.ctx.beginPath();
    this.ctx.moveTo(cx, cy - cs * 0.28);
    this.ctx.lineTo(cx + cs * 0.2, cy);
    this.ctx.lineTo(cx, cy + cs * 0.28);
    this.ctx.lineTo(cx - cs * 0.2, cy);
    this.ctx.closePath(); this.ctx.fill();
  }

  _drawFocusCircle(ctx, cs, gx, gy, focal, selected) {
    const lx = (gx + 0.5) * cs;
    const ly = (gy + 0.5) * cs;
    const focusR = focal * cs;
    ctx.beginPath();
    ctx.arc(lx, ly, focusR, 0, Math.PI * 2);
    ctx.fillStyle = selected ? 'rgba(103, 232, 249, 0.12)' : 'rgba(103, 232, 249, 0.06)';
    ctx.fill();
    ctx.strokeStyle = selected ? '#67e8f9' : 'rgba(103, 232, 249, 0.5)';
    ctx.lineWidth = (selected ? 2.5 : 1.5) / this.camera.zoom;
    ctx.setLineDash([6 / this.camera.zoom, 4 / this.camera.zoom]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#67e8f9';
    ctx.beginPath();
    ctx.arc(lx, ly, 3 / this.camera.zoom, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawTower(gx, gy, angle, cs, color, label, active, showPointer = true) {
    const cx = gx * cs + cs / 2, cy = gy * cs + cs / 2;
    const ctx = this.ctx;
    ctx.fillStyle = color + (active ? 'aa' : '55');
    ctx.strokeStyle = color;
    ctx.lineWidth = (active ? 3 : 2) / this.camera.zoom;
    ctx.beginPath(); ctx.arc(cx, cy, cs * 0.32, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (showPointer) {
      const rad = angle * Math.PI / 180;
      ctx.beginPath(); ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(rad) * cs * 0.4, cy + Math.sin(rad) * cs * 0.4);
      ctx.stroke();
    }
    ctx.fillStyle = '#fff'; ctx.font = `bold ${Math.max(10, cs * 0.22)}px sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, cx, cy);
  }

  _drawRay(ray, cs) {
    if (!ray.path?.length) return;
    const band = BANDS[ray.bandId];
    const ctx = this.ctx;
    const w = (band?.width ?? 2) / this.camera.zoom;
    const pulse = band?.pulse ? (1 + Math.sin(this.pulsePhase * 3) * 0.3) : 1;

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const drawPath = () => {
      ray.path.forEach((pt, i) => {
        const px = pt.x * cs, py = pt.y * cs;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
    };

    if (ray.bandId === 'ultraviolet') {
      ctx.lineWidth = w * pulse;
      for (let i = 1; i < ray.path.length; i++) {
        const a = ray.path[i - 1], b = ray.path[i];
        const grad = ctx.createLinearGradient(a.x * cs, a.y * cs, b.x * cs, b.y * cs);
        grad.addColorStop(0, band.colorLeft);
        grad.addColorStop(1, band.colorRight);
        ctx.strokeStyle = grad;
        ctx.beginPath();
        ctx.moveTo(a.x * cs, a.y * cs);
        ctx.lineTo(b.x * cs, b.y * cs);
        ctx.stroke();
      }
    } else if (ray.bandId === 'visible') {
      for (let i = 1; i < ray.path.length; i++) {
        const a = ray.path[i - 1];
        const b = ray.path[i];
        const crit = !!(a.crit || b.crit);
        ctx.lineWidth = crit ? w * 1.5 : w;
        ctx.strokeStyle = visibleColor(ray.energy || 5, crit);
        if (crit) {
          ctx.shadowColor = visibleColor(ray.energy || 5, true);
          ctx.shadowBlur = 12 / this.camera.zoom;
        }
        ctx.beginPath();
        ctx.moveTo(a.x * cs, a.y * cs);
        ctx.lineTo(b.x * cs, b.y * cs);
        ctx.stroke();
        ctx.shadowBlur = 0;
      }
    } else if (ray.bandId === 'gamma') {
      ctx.lineWidth = w * pulse;
      ctx.strokeStyle = '#fff';
      ctx.shadowColor = '#fff'; ctx.shadowBlur = 10 / this.camera.zoom;
      ctx.beginPath(); drawPath(); ctx.stroke();
      ctx.shadowBlur = 0;
    } else if (ray.bandId === 'radio') {
      ctx.lineWidth = w;
      ctx.strokeStyle = band.color;
      ctx.globalAlpha = 0.95;
      ctx.beginPath(); drawPath(); ctx.stroke();
      ctx.globalAlpha = 1;
    } else if (ray.bandId === 'infrared') {
      ctx.lineWidth = w;
      ctx.strokeStyle = band.color;
      ctx.globalAlpha = 0.85;
      ctx.beginPath(); drawPath(); ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      ctx.lineWidth = w;
      ctx.strokeStyle = band?.color || '#fff';
      ctx.beginPath(); drawPath(); ctx.stroke();
    }
  }
}
