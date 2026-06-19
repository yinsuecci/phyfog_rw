/**
 * GameLogic.js — 游戏状态（客户端仅用于渲染；权威计算在服务器 serverGame.mjs）
 */
import { BANDS, BUILD_COSTS, cellKey, normalizeAngle, INVULNERABLE_TYPES, DEFAULT_FIRE_COOLDOWN } from './constants.js';
import { RayCaster } from './RayCaster.js';
import { VisionGrid } from './VisionGrid.js';

export class GameLogic {
  constructor(mapData, network) {
    this.network = network;
    this.mapData = mapData;
    this.gridSize = mapData.settings.gridSize;
    this.cellSize = mapData.settings.cellSize;
    this.visibilityRange = mapData.settings.visibilityRange || 5;
    this.winConditions = mapData.settings.winConditions || mapData.winConditions || {
      captureAllBeacons: true,
      destroyEnemyMainTower: true,
    };
    this.cells = {};
    this.beacons = [];
    this.players = [];
    this.gameTime = 0;
    this.paused = false;
    this.activeRays = [];
    this.winner = null;
    this.messages = [];
    this._initFromMap();
    this.rayCaster = new RayCaster({
      gridSize: this.gridSize,
      cells: this.cells,
      players: this.players,
      beacons: this.beacons,
      isAlly: (a, b) => this.isAlly(a, b),
      getVisionGrid: (idx) => this.players[idx]?.visionGrid,
    });
  }

  _initFromMap() {
    const md = this.mapData;
    (md.elements || []).forEach(el => {
      const key = cellKey(el.x, el.y);
      const copy = { ...el, maxHp: el.hp ?? 100, hp: el.hp ?? 100 };
      if (copy.type === 'mirror' || copy.type === 'lens') {
        copy.invulnerable = true;
        if (copy.type === 'mirror') {
          copy.angle = normalizeAngle(copy.angle ?? 45);
        }
      }
      if (copy.type === 'attack_tower' && copy.owner == null) {
        copy.owner = null;
      }
      if (copy.type === 'solar') {
        if (copy.owner == null) copy.owner = null;
        copy.playerBuilt = copy.playerBuilt ?? false;
      }
      this.cells[key] = copy;
    });

    const beaconList = md.beacons?.length
      ? md.beacons
      : (md.elements || []).filter(e => e.type === 'beacon');
    beaconList.forEach(b => {
      const key = cellKey(b.x, b.y);
      if (!this.cells[key]) {
        this.cells[key] = {
          type: 'beacon', x: b.x, y: b.y,
          activationThreshold: b.activationThreshold || 10,
        };
      }
      this.beacons.push({
        key, x: b.x, y: b.y, owner: null,
        activationThreshold: b.activationThreshold || 10,
      });
    });

    const mapPlayers = md.players || [];
    const count = Math.max(mapPlayers.length, md.settings?.playerCount || 2);

    for (let i = 0; i < count; i++) {
      const mp = mapPlayers[i] || mapPlayers[0] || { x: 10, y: 10, angle: 0, hp: 100, color: '#3b82f6' };
      this.players.push({
        id: mp.id ?? i + 1,
        playerIndex: i,
        nickname: `P${i + 1}`,
        towerX: mp.x,
        towerY: mp.y,
        angle: mp.angle ?? 0,
        hp: mp.hp ?? 100,
        maxHp: mp.hp ?? 100,
        energy: md.settings?.initialEnergy ?? 100,
        alive: true,
        color: mp.color || ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b'][i],
        activeTower: { type: 'main' },
        capturedTowers: [],
        fireCooldownSec: md.settings?.fireCooldown ?? DEFAULT_FIRE_COOLDOWN,
        fireCooldownUntil: 0,
        visionGrid: new VisionGrid(this.gridSize),
        sharedVisionFrom: new Set(),
      });
      this._initVision(i);
    }
  }

  setNicknames(lobbyPlayers) {
    lobbyPlayers.forEach(lp => {
      const p = this.players[lp.playerIndex];
      if (p) p.nickname = lp.nickname;
    });
  }

  /** 初始化 / 刷新玩家视野二维数组 */
  _initVision(playerIdx) {
    const p = this.players[playerIdx];
    if (!p) return;
    const vg = p.visionGrid || new VisionGrid(this.gridSize);
    vg.reset();
    const pos = this.getActiveTowerPos(playerIdx);
    vg.revealCircle(pos.x, pos.y, this.visibilityRange);
    this._ensureOwnTowersVisible(playerIdx, vg);
    p.visionGrid = vg;
  }

  /** 自己的主光塔与当前控制塔格子永远可见 */
  _ensureOwnTowersVisible(playerIdx, vg) {
    const p = this.players[playerIdx];
    vg.set(p.towerX, p.towerY, true);
    const pos = this.getActiveTowerPos(playerIdx);
    vg.set(pos.x, pos.y, true);
  }

  _revealCell(playerIdx, x, y) {
    const p = this.players[playerIdx];
    if (!p?.visionGrid) return;
    p.visionGrid.set(x, y, true);
    this._ensureOwnTowersVisible(playerIdx, p.visionGrid);
  }

  _revealKey(playerIdx, key) {
    const [x, y] = key.split(',').map(Number);
    this._revealCell(playerIdx, x, y);
  }

  getActiveTowerPos(playerIdx) {
    const p = this.players[playerIdx];
    if (p.activeTower?.type === 'attack' && p.activeTower.key) {
      const el = this.cells[p.activeTower.key];
      if (el) return { x: el.x, y: el.y, angle: el.angle ?? 0 };
    }
    return { x: p.towerX, y: p.towerY, angle: p.angle };
  }

  isAlly(a, b) {
    return a === b;
  }

  rotate(playerIdx, delta) {
    const p = this.players[playerIdx];
    if (!p?.alive || this.paused) return;
    if (p.activeTower?.type === 'attack' && p.activeTower.key) {
      const el = this.cells[p.activeTower.key];
      if (el) el.angle = normalizeAngle((el.angle || 0) + delta);
    } else {
      p.angle = normalizeAngle(p.angle + delta);
    }
  }

  /** 读取当前瞄准角度（主塔或正在控制的进攻塔） */
  getAimRotation(playerIdx) {
    const p = this.players[playerIdx];
    if (!p) return null;
    if (p.activeTower?.type === 'attack' && p.activeTower.key) {
      const el = this.cells[p.activeTower.key];
      return { towerKey: p.activeTower.key, angle: normalizeAngle(el?.angle ?? 0) };
    }
    return { towerKey: null, angle: normalizeAngle(p.angle ?? 0) };
  }

  /** 保存本地玩家整组旋转（快照后恢复，避免被服务器覆盖） */
  captureRotationSnapshot(playerIdx) {
    const p = this.players[playerIdx];
    if (!p) return null;
    const snap = { mainAngle: normalizeAngle(p.angle ?? 0) };
    Object.entries(this.cells).forEach(([key, el]) => {
      if (el.type === 'attack_tower' && el.owner === playerIdx) {
        if (!snap.attackTowers) snap.attackTowers = {};
        snap.attackTowers[key] = normalizeAngle(el.angle ?? 0);
      }
    });
    return snap;
  }

  restoreRotationSnapshot(playerIdx, snap) {
    if (!snap) return;
    const p = this.players[playerIdx];
    if (!p) return;
    p.angle = snap.mainAngle;
    if (snap.attackTowers) {
      Object.entries(snap.attackTowers).forEach(([key, angle]) => {
        if (this.cells[key]) this.cells[key].angle = angle;
      });
    }
  }

  /** 服务器：应用客户端上报的绝对角度 */
  syncRotation(playerIdx, { angle, towerKey }) {
    const p = this.players[playerIdx];
    if (!p?.alive || this.paused) return { ok: false, error: '无法旋转' };
    const a = normalizeAngle(angle);
    if (towerKey) {
      if (!this._ownsAttackTower(playerIdx, towerKey)) {
        return { ok: false, error: '无权控制该塔' };
      }
      const el = this.cells[towerKey];
      if (!el) return { ok: false, error: '塔不存在' };
      el.angle = a;
    } else {
      p.angle = a;
    }
    return { ok: true };
  }

  /** 其他玩家旋转广播（不影响本地玩家） */
  applyRemoteRotation(playerIdx, { angle, towerKey }) {
    const p = this.players[playerIdx];
    if (!p) return;
    const a = normalizeAngle(angle);
    if (towerKey) {
      const el = this.cells[towerKey];
      if (el) el.angle = a;
    } else {
      p.angle = a;
    }
  }

  /** 主光塔易位：消耗 40J，移动到视野内空格 */
  relocateMain(playerIdx, x, y) {
    const p = this.players[playerIdx];
    if (!p?.alive || this.paused) return { ok: false, error: '无法易位' };
    if (p.activeTower?.type !== 'main') return { ok: false, error: '请先切换到主光塔' };
    const cost = 40;
    if (p.energy < cost) return { ok: false, error: '需要 40J 能量' };
    if (!this.canSee(playerIdx, x, y)) return { ok: false, error: '目标不在视野内' };
    const key = cellKey(x, y);
    if (this.cells[key]) return { ok: false, error: '格子已占用' };
    if (this.players.some((pl, i) => i !== playerIdx && pl.alive && pl.towerX === x && pl.towerY === y)) {
      return { ok: false, error: '无法移到其它光塔上' };
    }
    p.energy -= cost;
    p.towerX = x;
    p.towerY = y;
    if (p.visionGrid) {
      p.visionGrid.revealCircle(x, y, this.visibilityRange);
      p.visionGrid.set(x, y, true);
      this._ensureOwnTowersVisible(playerIdx, p.visionGrid);
    }
    return { ok: true };
  }

  switchTower(playerIdx, towerType, key) {
    const p = this.players[playerIdx];
    if (!p) return;
    if (towerType === 'main') {
      p.activeTower = { type: 'main' };
    } else if (towerType === 'attack' && this._ownsAttackTower(playerIdx, key)) {
      p.activeTower = { type: 'attack', key };
    }
    const pos = this.getActiveTowerPos(playerIdx);
    p.visionGrid?.revealCircle(pos.x, pos.y, this.visibilityRange);
    this._ensureOwnTowersVisible(playerIdx, p.visionGrid);
  }

  /** 玩家拥有（建造或占领）的进攻塔 */
  _ownsAttackTower(playerIdx, key) {
    const p = this.players[playerIdx];
    if (!p) return false;
    if (p.capturedTowers.includes(key)) return true;
    const el = this.cells[key];
    return el?.type === 'attack_tower' && el.owner === playerIdx;
  }

  getOwnedAttackTowers(playerIdx) {
    const p = this.players[playerIdx];
    if (!p) return [];
    const keys = new Set(p.capturedTowers);
    Object.entries(this.cells).forEach(([key, el]) => {
      if (el.type === 'attack_tower' && el.owner === playerIdx) keys.add(key);
    });
    return [...keys].map(key => {
      const el = this.cells[key];
      if (!el) return null;
      const built = el.owner === playerIdx && el.playerBuilt;
      return { key, x: el.x, y: el.y, label: built ? '自建' : '占领', angle: el.angle ?? 0 };
    }).filter(Boolean);
  }

  _registerAttackTower(playerIdx, key) {
    const p = this.players[playerIdx];
    if (!p || p.capturedTowers.includes(key)) return;
    p.capturedTowers.push(key);
  }

  shoot(playerIdx, bandId, bandEnergy, radioPayload, aimAngle) {
    const p = this.players[playerIdx];
    if (!p?.alive || this.paused) return null;
    if (this.gameTime < (p.fireCooldownUntil ?? 0)) return null;
    const band = BANDS[bandId];
    let cost = band.cost ?? bandEnergy;
    if (bandId === 'visible') cost = bandEnergy;
    if (p.energy < cost) return null;

    p.energy -= cost;
    const pos = this.getActiveTowerPos(playerIdx);
    const shootOriginKey = p.activeTower?.type === 'attack' && p.activeTower.key
      ? p.activeTower.key
      : cellKey(p.towerX, p.towerY);
    const fireAngle = aimAngle != null
      ? normalizeAngle(aimAngle)
      : normalizeAngle(pos.angle ?? p.angle);
    const result = this.rayCaster.traceFullPath(
      { x: pos.x, y: pos.y },
      fireAngle,
      bandId, cost, playerIdx,
      {
        radioMessage: radioPayload?.message,
        radioEnergy: radioPayload?.energy || 0,
        shootOriginKey,
      }
    );

    this._applyRayResult(result, playerIdx);
    const cd = p.fireCooldownSec ?? DEFAULT_FIRE_COOLDOWN;
    p.fireCooldownUntil = this.gameTime + cd;
    const duration = BANDS[bandId]?.rayDuration ?? 600;
    const ray = { ...result, id: Date.now() + Math.random(), expireAt: Date.now() + duration };
    this.activeRays.push(ray);
    return ray;
  }

  _applyRayResult(result, shooterIdx) {
    const p = this.players[shooterIdx];

    result.visionReveals?.forEach(key => this._revealKey(shooterIdx, key));

    result.allyContacts?.forEach(({ allyIdx, message, energy }) => {
      const ally = this.players[allyIdx];
      if (!ally) return;
      ally.sharedVisionFrom.add(shooterIdx);
      this._mergeVision(allyIdx, shooterIdx);
      if (message) this.messages.push({ from: shooterIdx, to: allyIdx, text: message, time: this.gameTime });
      if (energy > 0) ally.energy += energy;
    });

    result.solarClaims?.forEach(({ key, owner }) => {
      const el = this.cells[key];
      if (el?.type === 'solar' && el.owner == null) {
        el.owner = owner;
      }
    });

    result.hits?.forEach(hit => {
      if (hit.type === 'player_tower' && hit.playerIdx != null) {
        const target = this.players[hit.playerIdx];
        if (!target) return;
        if (hit.execute) target.hp = 0;
        else if (hit.damage) target.hp -= hit.damage;
        if (target.hp <= 0) { target.alive = false; target.hp = 0; }
        return;
      }
      const el = this.cells[hit.key];
      if (!el) return;

      if (INVULNERABLE_TYPES.has(el.type) || el.invulnerable) return;

      if (hit.capture && el.type === 'attack_tower') {
        el.owner = shooterIdx;
        el.playerBuilt = el.playerBuilt || false;
        this._registerAttackTower(shooterIdx, hit.key);
        return;
      }

      if (hit.convert && el.type === 'solar') {
        p.energy += Math.floor((result.energy || 1) * (el.conversionRate ?? 0.6));
        return;
      }
      if (hit.noDamage) return;
      if (hit.gamma) {
        if (hit.execute) el.hp = 0;
        else el.hp = (el.hp ?? 100) - (hit.damage || 0);
      } else if (hit.damage) {
        el.hp = (el.hp ?? 100) - hit.damage;
      }
      if (el.hp <= 0) {
        if (el.type === 'attack_tower' && el.owner != null) {
          const owner = this.players[el.owner];
          if (owner) owner.capturedTowers = owner.capturedTowers.filter(k => k !== hit.key);
        }
        delete this.cells[hit.key];
        this.rayCaster.invalidateMirrors();
      }
    });

    result.beaconUpdates?.forEach(({ key, owner, energy }) => {
      const beacon = this.beacons.find(b => b.key === key);
      if (!beacon) return;
      if (beacon.owner == null || energy > (beacon.charge || 0)) {
        beacon.owner = owner;
        beacon.charge = energy;
      }
    });

    this._checkWin();
  }

  _mergeVision(aIdx, bIdx) {
    const a = this.players[aIdx];
    const b = this.players[bIdx];
    if (!a?.visionGrid || !b?.visionGrid) return;
    for (let y = 0; y < this.gridSize; y++) {
      for (let x = 0; x < this.gridSize; x++) {
        if (b.visionGrid.get(x, y)) a.visionGrid.set(x, y, true);
        if (a.visionGrid.get(x, y)) b.visionGrid.set(x, y, true);
      }
    }
    this._ensureOwnTowersVisible(aIdx, a.visionGrid);
    this._ensureOwnTowersVisible(bIdx, b.visionGrid);
  }

  build(playerIdx, type, x, y, energyInput, mirrorAngle, lensFocal) {
    const p = this.players[playerIdx];
    if (!p?.alive || this.paused) return { ok: false, error: '无法建设' };
    if (!this.canSee(playerIdx, x, y)) return { ok: false, error: '不在视野内' };
    const key = cellKey(x, y);
    if (this.cells[key]) return { ok: false, error: '格子已占用' };
    if (this.players.some(pl => pl.towerX === x && pl.towerY === y)) {
      return { ok: false, error: '无法在光塔上建设' };
    }
    const cfg = BUILD_COSTS[type];
    if (!cfg) return { ok: false, error: '未知建筑' };
    let cost = cfg.baseCost;
    let hp = cfg.hp ?? 20;
    if (cfg.hpFromEnergy) { cost = energyInput; hp = energyInput; }
    else if (cfg.hpFromHalfEnergy) { cost = energyInput; hp = Math.floor(energyInput / 2); }
    if (p.energy < cost) return { ok: false, error: '能量不足' };
    p.energy -= cost;
    const el = { type, x, y, hp, maxHp: hp, owner: playerIdx, playerBuilt: type === 'solar' };
    if (type === 'mirror') {
      el.angle = mirrorAngle ?? 45;
      el.invulnerable = true;
    }
    if (type === 'lens') {
      const f = Number(lensFocal);
      el.focal = Number.isFinite(f) ? Math.max(2, Math.min(10, Math.round(f))) : 5;
      el.invulnerable = true;
    }
    if (type === 'solar') { el.energyPer10s = 2; el.conversionRate = 0.6; el.hp = 3; el.maxHp = 3; }
    if (type === 'attack_tower') {
      el.angle = 0;
      el.owner = playerIdx;
      el.playerBuilt = true;
    }
    this.cells[key] = el;
    if (type === 'attack_tower') this._registerAttackTower(playerIdx, key);
    this.rayCaster.invalidateMirrors();
    return { ok: true, key };
  }

  tick(dt) {
    if (this.paused || this.winner != null) return;
    this.gameTime += dt;
    // 每 10 秒太阳能产出
    if (!this._lastSolarTick) this._lastSolarTick = 0;
    if (this.gameTime - this._lastSolarTick >= 10) {
      this._lastSolarTick = this.gameTime;
      Object.values(this.cells).forEach(el => {
        if (el.type === 'solar' && el.owner != null) {
          const owner = this.players[el.owner];
          if (owner?.alive) owner.energy += el.energyPer10s ?? 2;
        }
      });
    }
    this.activeRays = this.activeRays.filter(r => r.expireAt > Date.now());
  }

  _checkWin() {
    const alive = this.players.filter(p => p.alive);
    if (this.winConditions.destroyEnemyMainTower !== false && alive.length === 1) {
      this.winner = alive[0].playerIndex;
      return;
    }
    if (this.winConditions.captureAllBeacons !== false && this.beacons.length > 0) {
      const owners = new Set(this.beacons.map(b => b.owner).filter(o => o != null));
      if (owners.size === 1 && this.beacons.every(b => b.owner != null)) {
        this.winner = [...owners][0];
      }
    }
  }

  canSee(playerIdx, x, y) {
    const p = this.players[playerIdx];
    if (!p?.visionGrid) return false;
    if (p.towerX === x && p.towerY === y) return true;
    const pos = this.getActiveTowerPos(playerIdx);
    if (pos.x === x && pos.y === y) return true;
    return p.visionGrid.get(x, y);
  }

  getVisionRadius(playerIdx) {
    const p = this.players[playerIdx];
    if (!p?.visionGrid) return this.visibilityRange;
    const pos = this.getActiveTowerPos(playerIdx);
    const explored = p.visionGrid.boundingRadius(pos.x, pos.y);
    return Math.max(this.visibilityRange, explored + 1);
  }

  serialize() {
    return {
      gridSize: this.gridSize,
      cellSize: this.cellSize,
      visibilityRange: this.visibilityRange,
      cells: this.cells,
      beacons: this.beacons,
      players: this.players.map(p => ({
        ...p,
        visionGrid: p.visionGrid?.toArray() ?? null,
        sharedVisionFrom: [...p.sharedVisionFrom],
        capturedTowers: [...p.capturedTowers],
      })),
      gameTime: this.gameTime,
      paused: this.paused,
      activeRays: this.activeRays,
      winner: this.winner,
      messages: this.messages.slice(-5),
    };
  }

  /**
   * 轻量时钟同步（~30Hz）：不重建视野网格
   * @returns {boolean}
   */
  applyClock(state) {
    if (!state) return false;
    if (state.gameTime != null) {
      const drift = this.gameTime - state.gameTime;
      if (drift > 0.35) {
        this.gameTime = state.gameTime;
      } else {
        this.gameTime = Math.max(this.gameTime, state.gameTime);
      }
    }
    this.paused = !!state.paused;
    this.winner = state.winner ?? null;
    return true;
  }

  /** 客户端本地剔除过期光束（clock 包不再携带 rays，避免 30Hz 重传路径） */
  pruneExpiredRays(now = Date.now()) {
    if (!this.activeRays?.length) return;
    this.activeRays = this.activeRays.filter((r) => r.expireAt > now);
  }

  /**
   * 完整快照（客户端专用）。gameTime 不允许回退。
   * @returns {boolean}
   */
  applyState(state, opts = {}) {
    if (!state) return false;
    const preserveIdx = opts.preserveRotationFor;
    const rotSnap = preserveIdx != null ? this.captureRotationSnapshot(preserveIdx) : null;

    this.cells = state.cells;
    this.beacons = state.beacons;
    if (state.gameTime != null) {
      this.gameTime = Math.max(this.gameTime, state.gameTime);
    }
    this.paused = !!state.paused;
    this.activeRays = state.activeRays || [];
    this.winner = state.winner ?? null;
    this.messages = state.messages || [];

    this.players = state.players.map((p, i) => {
      const prev = this.players[i];
      let visionGrid;
      if (p.visionGrid?.length) {
        visionGrid = VisionGrid.fromArray(this.gridSize, p.visionGrid);
      }
      if (!visionGrid || visionGrid.visibleCount() === 0) {
        if (prev?.visionGrid?.visibleCount() > 0) {
          visionGrid = prev.visionGrid;
        } else {
          visionGrid = new VisionGrid(this.gridSize);
          visionGrid.revealCircle(p.towerX, p.towerY, this.visibilityRange);
          visionGrid.set(p.towerX, p.towerY, true);
        }
      }
      return {
        ...p,
        visionGrid,
        sharedVisionFrom: new Set(p.sharedVisionFrom || []),
        capturedTowers: [...(p.capturedTowers || [])],
      };
    });
    if (rotSnap != null) {
      this.restoreRotationSnapshot(preserveIdx, rotSnap);
    }
    this.rayCaster.invalidateMirrors();
    return true;
  }

  handleAction(fromPlayerIndex, action) {
    switch (action.type) {
      case 'rotateSync':
        return this.syncRotation(fromPlayerIndex, action);
      case 'rotate':
        if (action.angle != null) {
          return this.syncRotation(fromPlayerIndex, action);
        }
        this.rotate(fromPlayerIndex, action.delta);
        return { ok: true };
      case 'shoot': {
        const ray = this.shoot(
          fromPlayerIndex, action.bandId, action.bandEnergy, action.radioPayload, action.aimAngle
        );
        return ray ? { ok: true } : { ok: false, error: '无法发射（冷却/能量/暂停）' };
      }
      case 'build':
        return this.build(
          fromPlayerIndex, action.buildType, action.x, action.y,
          action.energyInput, action.mirrorAngle, action.lensFocal
        );
      case 'switchTower':
        this.switchTower(fromPlayerIndex, action.towerType, action.key);
        return { ok: true };
      case 'relocateMain':
        return this.relocateMain(fromPlayerIndex, action.x, action.y);
      default:
        return { ok: false, error: '未知操作' };
    }
  }
}
