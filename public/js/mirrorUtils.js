/**
 * mirrorUtils.js — 平面镜（格心 + 角度）线段几何
 */
import { degToRad } from './constants.js';

const MIRROR_HALF = 0.42;

/** 镜面反射线段：中心在格心，沿 angle 方向 */
export function getMirrorSegment(el) {
  const cx = el.x + 0.5;
  const cy = el.y + 0.5;
  const rad = degToRad(el.angle ?? 45);
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  return {
    x1: cx - ux * MIRROR_HALF,
    y1: cy - uy * MIRROR_HALF,
    x2: cx + ux * MIRROR_HALF,
    y2: cy + uy * MIRROR_HALF,
  };
}

/** 线段 (px,py)→(qx,qy) 与镜面求交 */
export function segmentMirrorHit(px, py, qx, qy, el) {
  const seg = getMirrorSegment(el);
  const hit = _segIntersect(px, py, qx, qy, seg.x1, seg.y1, seg.x2, seg.y2);
  if (!hit) return null;
  return { ...hit, key: `${el.x},${el.y}` };
}

function _segIntersect(x1, y1, x2, y2, x3, y3, x4, y4) {
  const d = (x2 - x1) * (y4 - y3) - (y2 - y1) * (x4 - x3);
  if (Math.abs(d) < 1e-12) return null;
  const t = ((x3 - x1) * (y4 - y3) - (y3 - y1) * (x4 - x3)) / d;
  const u = ((x3 - x1) * (y2 - y1) - (y3 - y1) * (x2 - x1)) / d;
  if (t < 1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  const tc = Math.max(0, Math.min(1, t));
  return {
    t: tc,
    px: x1 + tc * (x2 - x1),
    py: y1 + tc * (y2 - y1),
  };
}

/** 在交点处按镜面角度反射方向 */
export function reflectAtMirror(dx, dy, el) {
  const rad = degToRad(el.angle ?? 45);
  const ux = Math.cos(rad);
  const uy = Math.sin(rad);
  let nx = -uy;
  let ny = ux;
  if (dx * nx + dy * ny > 0) { nx = -nx; ny = -ny; }
  const dot = dx * nx + dy * ny;
  let rdx = dx - 2 * dot * nx;
  let rdy = dy - 2 * dot * ny;
  const len = Math.hypot(rdx, rdy) || 1;
  return { dx: rdx / len, dy: rdy / len };
}
