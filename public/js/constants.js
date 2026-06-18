/**
 * constants.js — 游戏常量：波段、建设、元素规则
 */

export const DEFAULT_FIRE_COOLDOWN = 5;

export const BANDS = {
  radio: {
    id: 'radio',
    label: '无线电',
    cost: 0.2,
    width: 0.6,
    color: '#e5e7eb',
    rayDuration: 500,
    pulse: false,
    penetrates: true,
    damagesHp: false,
    revealsVision: false,
    allyInteract: true,
  },
  infrared: {
    id: 'infrared',
    label: '红外线',
    cost: 0.5,
    width: 0.85,
    color: '#6b7280',
    rayDuration: 550,
    pulse: false,
    penetrates: false,
    damagesHp: true,
    revealsVision: true,
    allyInteract: false,
  },
  visible: {
    id: 'visible',
    label: '可见光',
    costMin: 1,
    costMax: 10,
    width: 2.5,
    rayDuration: 320,
    pulse: false,
    penetrates: false,
    damagesHp: true,
    revealsVision: false,
    allyInteract: false,
    colorByEnergy: true,
  },
  ultraviolet: {
    id: 'ultraviolet',
    label: '紫外光',
    cost: 15,
    width: 4,
    rayDuration: 380,
    colorLeft: '#3b82f6',
    colorRight: '#a855f7',
    pulse: false,
    penetrates: false,
    damagesHp: true,
    revealsVision: false,
    allyInteract: false,
  },
  gamma: {
    id: 'gamma',
    label: 'γ射线',
    cost: 50,
    width: 6,
    color: '#ffffff',
    rayDuration: 800,
    pulse: true,
    penetrates: true,
    damagesHp: true,
    gammaRule: true,
    revealsVision: false,
    allyInteract: false,
  },
};

/** 免疫一切伤害的元素类型 */
export const INVULNERABLE_TYPES = new Set(['mirror', 'lens']);

export const BUILD_COSTS = {
  wall: { label: '墙壁', baseCost: 0, hpFromEnergy: true },
  lead: { label: '铅板', baseCost: 40, hp: 9999 },
  attack_tower: { label: '进攻塔', baseCost: 0, hpFromHalfEnergy: true },
  mirror: { label: '平面镜', baseCost: 10, hp: 20 },
  lens: { label: '透镜', baseCost: 5, hp: 15 },
  solar: { label: '太阳能板', baseCost: 10, hp: 3, energyPer10s: 2, conversionRate: 0.6, safeThreshold: 3 },
};

export const ELEMENT_DEFAULTS = {
  wall: { hp: 100 },
  mirror: { hp: 30, angle: 45 },
  lens: { hp: 20, focal: 5 },
  solar: { hp: 50, energyPer10s: 10, conversionEnergy: 30 },
  lead: { hp: 9999 },
  attack_tower: { hp: 80, angle: 0 },
  beacon: { activationThreshold: 10 },
};

/** 可见光能量 1–10J → 红橙黄绿蓝靛紫（低→高） */
const VISIBLE_SPECTRUM = [
  [255, 0, 0],       // 1 红
  [255, 127, 0],     // 2 橙
  [255, 255, 0],     // 3 黄
  [0, 200, 0],       // 4 绿
  [0, 100, 255],     // 5 蓝
  [75, 0, 130],      // 6 靛
  [148, 0, 211],     // 7 紫
  [180, 50, 220],    // 8
  [200, 80, 235],    // 9
  [220, 120, 255],   // 10 高紫
];

export function visibleColor(energy, brighten = false) {
  const e = Math.max(1, Math.min(10, Math.round(energy)));
  const c = VISIBLE_SPECTRUM[e - 1];
  let [r, g, b] = c;
  if (brighten) {
    r = Math.min(255, r + 80);
    g = Math.min(255, g + 80);
    b = Math.min(255, b + 80);
  }
  return `rgb(${r},${g},${b})`;
}

export function cellKey(x, y) {
  return `${x},${y}`;
}

export function parseKey(key) {
  const [x, y] = key.split(',').map(Number);
  return { x, y };
}

export function degToRad(d) {
  return (d * Math.PI) / 180;
}

export function radToDeg(r) {
  return (r * 180) / Math.PI;
}

export function normalizeAngle(deg) {
  return ((deg % 360) + 360) % 360;
}
