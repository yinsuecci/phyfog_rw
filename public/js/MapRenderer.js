/**
 * MapRenderer.js — 相机锁定控制塔、战争迷雾、光束渲染
 */
import { BANDS, visibleColor } from './constants.js';
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
    /** 玩家手动缩放倍率（滚轮），不可平移 */
    this.userZoom = 1;
    this.userZoomMin = 0.35;
    this.userZoomMax = 3.5;
    /** 选中的透镜 { x, y, focal } */
    this.selectedLens = null;
  }

  setUserZoom(delta) {
    this.userZoom = Math.max(this.userZoomMin, Math.min(this.userZoomMax, this.userZoom + delta));
  }

  resetUserZoom() {
    this.userZoom = 1;
  }

  selectLensAt(game, localPlayerIdx, gx, gy) {
    const key = `${gx},${gy}`;
    const el = game.cells[key];
    if (el?.type === 'lens' && game.canSee(localPlayerIdx, gx, gy)) {
      this.selectedLens = { x: gx, y: gy, focal: el.focal || 5 };
      return true;
    }
    this.selectedLens = null;
    return false;
  }

  clearLensSelection() {
    this.selectedLens = null;
  }

  resize(gridSize, cellSize) {
    this.gridSize = gridSize;
    this.cellSize = cellSize;
    this._resizeViewport();
    window.addEventListener('resize', () => this._resizeViewport());
  }

  _resizeViewport() {
    if (!this.wrapEl) return;
    const w = this.wrapEl.clientWidth;
    const h = this.wrapEl.clientHeight;
    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
  }

  /** 更新相机：中心锁定控制塔，缩放仅由滚轮控制 */
  _updateCamera(game, localPlayerIdx) {
    const pos = game.getActiveTowerPos(localPlayerIdx);
    const cs = this.cellSize;
    const towerWx = (pos.x + 0.5) * cs;
    const towerWy = (pos.y + 0.5) * cs;

    this.camera.x = towerWx;
    this.camera.y = towerWy;
    this.camera.zoom = Math.max(0.08, Math.min(this.userZoom, 6));
  }

  /** 世界坐标 → 屏幕坐标 */
  worldToScreen(wx, wy) {
    const { x, y, zoom } = this.camera;
    const vw = this.canvas.width;
    const vh = this.canvas.height;
    return {
      x: (wx - x) * zoom + vw / 2,
      y: (wy - y) * zoom + vh / 2,
    };
  }

  /** 屏幕坐标 → 世界坐标 */
  screenToWorld(sx, sy) {
    const { x, y, zoom } = this.camera;
    const vw = this.canvas.width;
    const vh = this.canvas.height;
    return {
      x: (sx - vw / 2) / zoom + x,
      y: (sy - vh / 2) / zoom + y,
    };
  }

  screenToGrid(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const w = this.screenToWorld(sx, sy);
    return {
      x: Math.floor(w.x / this.cellSize),
      y: Math.floor(w.y / this.cellSize),
    };
  }

  render(game, localPlayerIdx) {
    this._resizeViewport();
    this._updateCamera(game, localPlayerIdx);

    const ctx = this.ctx;
    const cs = this.cellSize;
    const gs = game.gridSize;
    const vw = this.canvas.width;
    const vh = this.canvas.height;
    const local = game.players[localPlayerIdx];
    const vg = local?.visionGrid;

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

    // 网格
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

    // 先画可见内容
    for (let gy = minGy; gy <= maxGy; gy++) {
      for (let gx = minGx; gx <= maxGx; gx++) {
        if (!game.canSee(localPlayerIdx, gx, gy)) continue;
        const key = `${gx},${gy}`;
        const el = game.cells[key];
        if (el) this._drawElement(el, cs, game, localPlayerIdx);
      }
    }

    game.beacons.forEach(b => {
      if (game.canSee(localPlayerIdx, b.x, b.y)) {
        this._drawBeacon(b, cs, game.players[b.owner]);
      }
    });

    game.players.forEach((p, i) => {
      if (!p.alive) return;
      const visible = game.canSee(localPlayerIdx, p.towerX, p.towerY);
      if (!visible) return;
      const isControlled = i === localPlayerIdx;
      const onAttack = isControlled && p.activeTower?.type === 'attack' && p.activeTower.key;
      if (onAttack) {
        this._drawTower(p.towerX, p.towerY, 0, cs, p.color, 'P' + (i + 1), false, false);
      } else {
        this._drawTower(p.towerX, p.towerY, p.angle, cs, p.color, 'P' + (i + 1), isControlled, true);
      }
    });

    // 视野圈（当前控制塔）
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

    // 战争迷雾：覆盖不可见格子
    for (let gy = minGy; gy <= maxGy; gy++) {
      for (let gx = minGx; gx <= maxGx; gx++) {
        if (game.canSee(localPlayerIdx, gx, gy)) continue;
        ctx.fillStyle = 'rgba(0,0,0,0.92)';
        ctx.fillRect(gx * cs, gy * cs, cs, cs);
      }
    }

    // 透镜聚焦圈（在迷雾之上，点击选中后显示）
    if (this.selectedLens) {
      const el = game.cells[`${this.selectedLens.x},${this.selectedLens.y}`];
      if (el?.type === 'lens' && game.canSee(localPlayerIdx, this.selectedLens.x, this.selectedLens.y)) {
        const focal = el.focal ?? this.selectedLens.focal ?? 5;
        this._drawFocusCircle(ctx, cs, this.selectedLens.x, this.selectedLens.y, focal, true);
      } else {
        this.selectedLens = null;
      }
    }

    ctx.restore();

    // HUD
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`缩放 ${Math.round(this.userZoom * 100)}%`, vw - 8, vh - 8);
    ctx.textAlign = 'left';
    const lensHint = this.selectedLens
      ? `透镜聚焦圈 f=${game.cells[`${this.selectedLens.x},${this.selectedLens.y}`]?.focal ?? '?'}格`
      : '滚轮缩放 · 点击透镜显示聚焦圈';
    ctx.fillText(lensHint, 8, vh - 8);
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
        const seg = getMirrorSegment(el);
        ctx.strokeStyle = '#c0d8f0';
        ctx.lineWidth = 3 / this.camera.zoom;
        ctx.beginPath();
        ctx.moveTo(seg.x1 * cs, seg.y1 * cs);
        ctx.lineTo(seg.x2 * cs, seg.y2 * cs);
        ctx.stroke();
        break;
      }
      case 'lens': {
        const isSel = this.selectedLens?.x === el.x && this.selectedLens?.y === el.y;
        ctx.strokeStyle = isSel ? '#a5f3fc' : '#67e8f9';
        ctx.lineWidth = (isSel ? 3 : 2) / this.camera.zoom;
        ctx.beginPath(); ctx.arc(cx, cy, cs * 0.28, 0, Math.PI * 2); ctx.stroke();
        if (isSel) {
          ctx.fillStyle = 'rgba(103,232,249,0.15)';
          ctx.fill();
        }
        break;
      }
      case 'solar':
        ctx.fillStyle = '#fbbf2444'; ctx.fillRect(x + pad, y + pad, cs - pad * 2, cs - pad * 2);
        ctx.fillStyle = '#fbbf24'; ctx.font = `${cs * 0.35}px sans-serif`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('☀', cx, cy); break;
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

    if (el.hp != null && el.maxHp) {
      const ratio = Math.max(0, el.hp / el.maxHp);
      ctx.fillStyle = ratio > 0.5 ? '#3fb950' : '#f85149';
      ctx.fillRect(x + 2, y + cs - 5, (cs - 4) * ratio, 3);
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
    // 格心标记
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

