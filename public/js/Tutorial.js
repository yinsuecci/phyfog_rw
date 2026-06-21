/**
 * Tutorial.js — 引导式新手教程
 */
import { shortestAngleDiff } from './AimDial.js';

export const TUTORIAL_STEPS = [
  {
    title: '欢迎来到 PhyFog',
    body: '你操控 P1（蓝色主光塔）。友军 P2（绿色）在侧翼协同；敌方 P3（红色）在对岸。本教程将介绍五种波段与各类光学建筑。',
    advance: 'manual',
  },
  {
    title: '界面与瞄准',
    body: '左侧选择波段与建设；中间为战场（战争迷雾内才可操作）；右下角圆盘可精确瞄准。← → 键也可旋转炮塔。',
    highlight: '.game-sidebar',
    advance: 'manual',
  },
  {
    title: '无线电',
    body: '无线电几乎无消耗，能穿透大多数障碍，用于向友军 P2 传递消息或能量。请选中「无线电」并向 P2 方向发射一次。',
    highlight: '#bandButtons',
    advance: 'bandFire',
    bandId: 'radio',
    selectBand: 'radio',
  },
  {
    title: '红外线',
    body: '红外线较窄，命中格子会扩大你的视野，适合侦察。选中「红外线」并向地图中央发射一次。',
    highlight: '#bandButtons',
    advance: 'bandFire',
    bandId: 'infrared',
    selectBand: 'infrared',
  },
  {
    title: '可见光 · 调整能量',
    body: '可见光伤害与颜色随能量 1–10J 变化（低→红，高→蓝紫）。请将能量调到 8J 或以上（侧栏滑条或手机底部条）。',
    highlight: '#visibleSlider',
    advance: 'visibleEnergy',
    minEnergy: 8,
    selectBand: 'visible',
  },
  {
    title: '可见光 · 发射',
    body: '用当前可见光向右侧靶墙或信标方向试射，观察光带颜色与伤害。',
    highlight: '#btnFire',
    advance: 'bandFire',
    bandId: 'visible',
    selectBand: 'visible',
  },
  {
    title: '紫外光',
    body: '紫外光带宽大、单发成本高，适合直线高伤。选中「紫外光」并发射一次。',
    highlight: '#bandButtons',
    advance: 'bandFire',
    bandId: 'ultraviolet',
    selectBand: 'ultraviolet',
  },
  {
    title: '平面镜',
    body: '平面镜反射除 γ 射线外的所有光。侧栏选「平面镜」，用右下角橙色圆盘定方向，在空格子放置。',
    highlight: '.sidebar-build',
    advance: 'build',
    buildType: 'mirror',
  },
  {
    title: '透镜',
    body: '透镜不改变 γ 射线，但可使其它波段在焦点格获得 2 倍伤害。放置一枚透镜（可调焦距滑条）。',
    highlight: '.sidebar-build',
    advance: 'build',
    buildType: 'lens',
  },
  {
    title: '太阳能板',
    body: '太阳能板被光线首次照射后归属该玩家，并周期性产出能量。在视野内放置一块太阳能板。',
    highlight: '.sidebar-build',
    advance: 'build',
    buildType: 'solar',
  },
  {
    title: '进攻塔',
    body: '进攻塔可建设或占领，切换后从该塔瞄准发射。投入能量建设一座进攻塔（HP 为投入一半）。',
    highlight: '.sidebar-build',
    advance: 'build',
    buildType: 'attack_tower',
  },
  {
    title: '信标',
    body: '信标需用可见光激活：照射能量 ≥ 阈值即占领。用 ≥8J 可见光照射地图上的信标（📡）直至点亮为你的颜色。',
    highlight: '#gameCanvas',
    advance: 'beacon',
    selectBand: 'visible',
  },
  {
    title: 'γ 射线',
    body: 'γ 射线穿透一切；对生命值 ≤ 一半的目标直接处决，否则造成一半最大生命伤害。选中「γ射线」准备进攻。',
    highlight: '#bandButtons',
    advance: 'manual',
    selectBand: 'gamma',
  },
  {
    title: '消灭敌军 P3',
    body: '瞄准红色 P3 主光塔发射 γ 射线。可能需要 1–2 发。击毁 P3 即完成战斗教学。',
    highlight: '#aimDial',
    advance: 'enemyDead',
    enemyIndex: 2,
    selectBand: 'gamma',
  },
  {
    title: '教程完成',
    body: '你已了解各波段与建筑。返回首页创建房间、导入地图，与好友联机对战吧！',
    advance: 'finish',
    nextLabel: '返回首页',
  },
];

export class Tutorial {
  constructor({ steps, overlayEl, onExit, getGame, onStepChange, getCtx }) {
    this.steps = steps;
    this.overlayEl = overlayEl;
    this.onExit = onExit;
    this.getGame = getGame;
    this.onStepChange = onStepChange;
    this.getCtx = getCtx;
    this.idx = 0;
    this._active = false;
    this._startAngle = 0;
    this._rotateBaselineSet = false;
    this._firesByBand = {};
    this._builds = new Set();

    this.spotlight = overlayEl?.querySelector('#tutorialSpotlight');
    this.stepLabel = overlayEl?.querySelector('#tutorialStepLabel');
    this.titleEl = overlayEl?.querySelector('#tutorialTitle');
    this.bodyEl = overlayEl?.querySelector('#tutorialBody');
    this.nextBtn = overlayEl?.querySelector('#tutorialNext');
    this.skipBtn = overlayEl?.querySelector('#tutorialSkip');

    this.nextBtn?.addEventListener('click', () => this.tryAdvance());
    this.skipBtn?.addEventListener('click', () => this.exit());
    window.addEventListener('resize', () => {
      const step = this.steps[this.idx];
      if (step) this._positionSpotlight(step.highlight);
    });
  }

  get active() {
    return this._active;
  }

  start() {
    this._active = true;
    this.idx = 0;
    this._rotateBaselineSet = false;
    this._firesByBand = {};
    this._builds = new Set();
    this.overlayEl?.classList.remove('hidden');
    this._showStep(0);
  }

  exit() {
    this._active = false;
    this.overlayEl?.classList.add('hidden');
    this.onExit?.();
  }

  onGameAction(action, ctx) {
    if (!this._active) return;
    const game = this.getGame?.();
    if (!game) return;

    if (action.type === 'shoot' && ctx?.selectedBand) {
      const id = ctx.selectedBand;
      this._firesByBand[id] = (this._firesByBand[id] || 0) + 1;
    }
    if (action.type === 'build' && action.buildType) {
      this._builds.add(action.buildType);
    }

    this._checkStep(game, ctx);
  }

  onRotate(ctx) {
    if (!this._active) return;
    const game = this.getGame?.();
    if (!game) return;
    this._checkStep(game, ctx);
  }

  tick(ctx) {
    if (!this._active) return;
    const game = this.getGame?.();
    if (!game) return;
    const step = this.steps[this.idx];
    if (step?.advance === 'rotate' && !this._rotateBaselineSet) {
      this._startAngle = game.getAimRotation(0)?.angle ?? 0;
      this._rotateBaselineSet = true;
    }
    this._checkStep(game, ctx);
  }

  _checkStep(game, ctx) {
    const step = this.steps[this.idx];
    if (!step) return;

    let done = false;

    switch (step.advance) {
      case 'rotate': {
        const angle = game.getAimRotation(0)?.angle ?? 0;
        done = Math.abs(shortestAngleDiff(this._startAngle, angle)) >= (step.minRotateDelta ?? 10);
        break;
      }
      case 'bandFire':
        done = (this._firesByBand[step.bandId] || 0) >= 1;
        break;
      case 'visibleEnergy':
        done = (ctx?.visibleEnergy ?? 0) >= (step.minEnergy ?? 8);
        break;
      case 'build':
        done = this._builds.has(step.buildType);
        break;
      case 'beacon':
        done = game.beacons?.some((b) => b.owner === 0) ?? false;
        break;
      case 'enemyDead': {
        const idx = step.enemyIndex ?? 2;
        done = !game.players[idx]?.alive;
        break;
      }
      default:
        break;
    }

    if (done) this._setNextEnabled(true);
  }

  tryAdvance() {
    const step = this.steps[this.idx];
    if (!step) return;

    if (step.advance === 'finish') {
      this.exit();
      return;
    }

    if (step.advance !== 'manual' && this.nextBtn?.disabled) return;

    if (this.idx >= this.steps.length - 1) {
      this.exit();
      return;
    }

    this.idx += 1;
    this._rotateBaselineSet = false;
    this._showStep(this.idx);
  }

  _showStep(i) {
    const step = this.steps[i];
    if (!step) return;
    const ctx = this.getCtx?.() || {};

    if (this.stepLabel) {
      this.stepLabel.textContent = `${i + 1} / ${this.steps.length}`;
    }
    if (this.titleEl) this.titleEl.textContent = step.title;
    if (this.bodyEl) this.bodyEl.textContent = step.body;

    const manual = step.advance === 'manual' || step.advance === 'finish';
    this._setNextEnabled(manual);
    if (this.nextBtn) {
      this.nextBtn.textContent = step.nextLabel || (step.advance === 'finish' ? '返回首页' : '下一步');
    }

    this.onStepChange?.(step);

    const game = this.getGame?.();
    if (game) this._checkStep(game, ctx);
    requestAnimationFrame(() => this._positionSpotlight(step.highlight));
  }

  _setNextEnabled(enabled) {
    if (!this.nextBtn) return;
    this.nextBtn.disabled = !enabled;
    this.nextBtn.classList.toggle('disabled', !enabled);
  }

  _positionSpotlight(selector) {
    if (!this.spotlight) return;

    if (!selector) {
      this.spotlight.classList.add('hidden');
      return;
    }

    const el = document.querySelector(selector);
    const r = el?.getBoundingClientRect();
    if (!el || el.classList.contains('hidden') || !r?.width) {
      this.spotlight.classList.add('hidden');
      return;
    }

    const pad = 8;
    this.spotlight.classList.remove('hidden');
    this.spotlight.style.left = `${Math.max(0, r.left - pad)}px`;
    this.spotlight.style.top = `${Math.max(0, r.top - pad)}px`;
    this.spotlight.style.width = `${r.width + pad * 2}px`;
    this.spotlight.style.height = `${r.height + pad * 2}px`;
  }
}
