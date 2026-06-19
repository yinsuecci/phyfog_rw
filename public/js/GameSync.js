/**
 * GameSync.js — 客户端状态同步（纯服务器权威）
 *
 * 时间：锚点 + 插值，单调递增（不回跳）
 */
export class GameSync {
  constructor() {
    this.lastSeq = 0;
    this.lastRecvAt = 0;
    this._anchorGameTime = null;
    this._anchorClientMs = 0;
    /** 上次显示的 gameTime，保证 HUD 永不回退 */
    this._displayTime = 0;
  }

  reset() {
    this.lastSeq = 0;
    this.lastRecvAt = 0;
    this._anchorGameTime = null;
    this._anchorClientMs = 0;
    this._displayTime = 0;
  }

  _acceptSeq(state) {
    if (state.stateSeq == null) return true;
    if (state.stateSeq <= this.lastSeq) return false;
    this.lastSeq = state.stateSeq;
    return true;
  }

  _syncTimeAnchor(gameTime) {
    if (gameTime == null) return;
    const now = Date.now();
    this._anchorGameTime = gameTime;
    this._anchorClientMs = now;
    this._displayTime = Math.max(this._displayTime, gameTime);
  }

  apply(game, state, { localPlayerIdx = null } = {}) {
    if (!game || !state) return false;
    if (!this._acceptSeq(state)) return false;

    this.lastRecvAt = Date.now();

    const kind = state.kind ?? (state.cells != null ? 'full' : 'clock');
    if (kind === 'clock') {
      game.applyClock(state);
    } else {
      game.applyState(state, { preserveRotationFor: localPlayerIdx });
    }
    this._syncTimeAnchor(state.gameTime ?? game.gameTime);
    return true;
  }

  /** 误差过大时软同步到服务器时间，不阻塞游戏 */
  softResync(game) {
    if (!game || this._anchorGameTime == null) return;
    const serverT = this._anchorGameTime;
    if (game.gameTime > serverT + 0.25) {
      game.gameTime = serverT;
    }
    this._displayTime = serverT;
  }

  isStale(thresholdMs = 10000) {
    return this.lastRecvAt > 0 && Date.now() - this.lastRecvAt > thresholdMs;
  }

  getGameTime(game) {
    if (!game) return 0;
    if (game.paused || game.winner != null) {
      return Math.max(this._displayTime, game.gameTime);
    }
    let t = game.gameTime;
    if (this._anchorGameTime != null) {
      const elapsed = (Date.now() - this._anchorClientMs) / 1000;
      t = this._anchorGameTime + Math.min(elapsed, 0.08);
    }
    if (t > game.gameTime + 0.3) t = game.gameTime + 0.08;
    this._displayTime = Math.max(this._displayTime, t);
    return this._displayTime;
  }
}
