/**
 * AimDial.js — 瞄准圆盘：长按拖转 + 八方向锁定
 */
import { normalizeAngle } from './constants.js';

export const AIM_SNAP_DIRS = [0, 45, 90, 135, 180, 225, 270, 315];

export function shortestAngleDiff(from, to) {
  let d = normalizeAngle(to) - normalizeAngle(from);
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

export function lerpAngle(from, to, maxStep) {
  const diff = shortestAngleDiff(from, to);
  if (Math.abs(diff) <= maxStep) return normalizeAngle(to);
  return normalizeAngle(from + Math.sign(diff) * maxStep);
}

export class AimDial {
  constructor(rootEl, { onAngleChange, getAngle }) {
    this.root = rootEl;
    this.ring = rootEl?.querySelector('.aim-dial-ring');
    this.indicator = rootEl?.querySelector('.aim-dial-indicator');
    this.arrowsBox = rootEl?.querySelector('.aim-dial-arrows');
    this.onAngleChange = onAngleChange;
    this.getAngle = getAngle;
    this.snapTarget = null;
    this.activeSnap = null;
    this._dragging = false;
    this._pointerId = null;
    this._longPressTimer = null;
    this._lastUpload = 0;
    if (this.root) this._buildArrows();
    this._bind();
  }

  _buildArrows() {
    if (!this.arrowsBox) return;
    this.arrowsBox.innerHTML = '';
    AIM_SNAP_DIRS.forEach((deg) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'aim-snap-btn';
      btn.dataset.deg = String(deg);
      btn.style.setProperty('--deg', `${deg}deg`);
      btn.style.setProperty('--pos', `${deg + 90}deg`);
      btn.setAttribute('aria-label', `${deg}°`);
      btn.innerHTML = '<span>▲</span>';
      btn.addEventListener('pointerdown', (e) => e.stopPropagation());
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.snapTarget = deg;
        this.activeSnap = deg;
        this._updateSnapHighlight();
      });
      this.arrowsBox.appendChild(btn);
    });
  }

  _bind() {
    if (!this.ring) return;
    this.ring.addEventListener('pointerdown', (e) => this._onDown(e));
    this.ring.addEventListener('pointermove', (e) => this._onMove(e));
    this.ring.addEventListener('pointerup', (e) => this._onUp(e));
    this.ring.addEventListener('pointercancel', (e) => this._onUp(e));
    this.ring.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    this._pointerId = e.pointerId;
    try { this.ring.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    clearTimeout(this._longPressTimer);
    this._longPressTimer = setTimeout(() => {
      this._dragging = true;
      this.snapTarget = null;
      this.root?.classList.add('is-aiming');
      this._applyPointerAngle(e);
    }, 280);
  }

  _onMove(e) {
    if (e.pointerId !== this._pointerId) return;
    if (!this._dragging) return;
    e.preventDefault();
    this._applyPointerAngle(e);
  }

  _onUp(e) {
    if (e.pointerId !== this._pointerId) return;
    clearTimeout(this._longPressTimer);
    this._pointerId = null;
    this._dragging = false;
    this.root?.classList.remove('is-aiming');
    try { this.ring.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  }

  _applyPointerAngle(e) {
    const angle = this._pointerToAngle(e);
    this._emitAngle(angle, true);
    this.updateIndicator(angle);
  }

  _pointerToAngle(e) {
    const rect = this.ring.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    return normalizeAngle(Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI));
  }

  _emitAngle(angle, force) {
    const now = Date.now();
    if (!force && now - this._lastUpload < 40) return;
    this._lastUpload = now;
    this.onAngleChange?.(normalizeAngle(angle));
  }

  updateIndicator(angle) {
    if (!this.indicator) return;
    this.indicator.style.transform = `rotate(${normalizeAngle(angle)}deg)`;
  }

  syncFromGame() {
    const a = this.getAngle?.();
    if (a != null) this.updateIndicator(a);
  }

  tickSnap() {
    if (this.snapTarget == null) return false;
    const cur = this.getAngle?.() ?? 0;
    const next = lerpAngle(cur, this.snapTarget, 14);
    this._emitAngle(next, Math.abs(shortestAngleDiff(next, this.snapTarget)) < 1);
    this.updateIndicator(next);
    if (Math.abs(shortestAngleDiff(next, this.snapTarget)) < 0.6) {
      this._emitAngle(this.snapTarget, true);
      this.updateIndicator(this.snapTarget);
      this.snapTarget = null;
    }
    return true;
  }

  _updateSnapHighlight() {
    this.arrowsBox?.querySelectorAll('.aim-snap-btn').forEach((btn) => {
      btn.classList.toggle('active', Number(btn.dataset.deg) === this.activeSnap);
    });
  }

  reset() {
    this.snapTarget = null;
    this.activeSnap = null;
    this._updateSnapHighlight();
  }
}
