/**
 * serverGame.mjs — 服务器权威游戏循环
 *
 * - 固定 30Hz 仿真步长（时间匀速，不受 setInterval 抖动影响）
 * - kind=clock 每 tick 广播 gameTime
 * - kind=full 操作后 + 每 800ms（视野用原始二维数组编码）
 */
import { pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const SIM_HZ = 30;
const FIXED_DT = 1 / SIM_HZ;
const TICK_MS = Math.floor(1000 / SIM_HZ);
const FULL_STATE_INTERVAL_MS = 800;

let GameLogicClass = null;

async function loadGameLogic() {
  if (!GameLogicClass) {
    const mod = await import(pathToFileURL(join(__dirname, 'public/js/GameLogic.js')).href);
    GameLogicClass = mod.GameLogic;
  }
  return GameLogicClass;
}

function lobbyNicknames(room) {
  return room.players
    .filter((p) => !p.disconnected)
    .map((p) => ({ playerIndex: p.playerIndex, nickname: p.nickname }));
}

function nextStateSeq(room) {
  room.stateSeq = (room.stateSeq ?? 0) + 1;
  return room.stateSeq;
}

function onlinePlayers(room) {
  return room.players.filter((p) => p.id && !p.disconnected);
}

function buildClockPayload(room, seq) {
  const gl = room.gameLogic;
  return {
    kind: 'clock',
    stateSeq: seq,
    serverTime: Date.now(),
    gameTime: gl.gameTime,
    paused: gl.paused,
    winner: gl.winner,
  };
}

function buildFullPayloadFromSnap(snap, seq, viewerPlayerIndex) {
  const players = snap.players.map((p, i) => {
    if (i === viewerPlayerIndex) return p;
    return { ...p, visionGrid: null };
  });
  return {
    kind: 'full',
    ...snap,
    players,
    stateSeq: seq,
    serverTime: Date.now(),
  };
}

function buildFullPayload(room, seq, viewerPlayerIndex) {
  return buildFullPayloadFromSnap(room.gameLogic.serialize(), seq, viewerPlayerIndex);
}

export function broadcastClock(io, roomCode, room) {
  if (!room.gameLogic) return null;
  const seq = nextStateSeq(room);
  const payload = buildClockPayload(room, seq);
  for (const pl of onlinePlayers(room)) {
    io.to(pl.id).emit('game:state', payload);
  }
  room.lastClockState = payload;
  return payload;
}

export function broadcastFullState(io, roomCode, room) {
  if (!room.gameLogic) return null;

  const seq = nextStateSeq(room);
  const snap = room.gameLogic.serialize();
  const serverTime = Date.now();

  for (const pl of onlinePlayers(room)) {
    io.to(pl.id).emit('game:state', buildFullPayloadFromSnap(snap, seq, pl.playerIndex));
  }

  room.lastGameState = { kind: 'full', ...snap, stateSeq: seq, serverTime };
  room.lastFullBroadcastMs = serverTime;
  room.dirty = false;
  return room.lastGameState;
}

export function broadcastRoomState(io, roomCode, room) {
  return broadcastFullState(io, roomCode, room);
}

export function markRoomDirty(room) {
  room.dirty = true;
}

export async function startRoomGame(room) {
  const GameLogic = await loadGameLogic();
  room.gameLogic = new GameLogic(room.mapData, null);
  room.gameLogic.setNicknames(lobbyNicknames(room));
  room.gameLogic.paused = !!room.paused;
  room.stateSeq = 0;
  room._simAccumulator = 0;
  room._lastTickMs = null;
  room.lastGameState = null;
  room.lastClockState = null;
  room.lastFullBroadcastMs = 0;
  room.dirty = true;
}

export function stopRoomGame(room) {
  room.gameLogic = null;
  room.lastGameState = null;
  room.lastClockState = null;
  room._simAccumulator = 0;
  room._lastTickMs = null;
  room.stateSeq = 0;
  room.dirty = false;
}

export function handleRoomAction(room, playerIndex, action) {
  if (!room.gameLogic || !room.gameStarted) {
    return { ok: false, error: '对局未开始' };
  }
  if (room.paused || room.gameLogic.paused) {
    return { ok: false, error: '游戏已暂停' };
  }
  const player = room.gameLogic.players[playerIndex];
  if (!player?.alive) {
    return { ok: false, error: '玩家不可用' };
  }
  if (!action?.type) {
    return { ok: false, error: '无效操作' };
  }

  const result = room.gameLogic.handleAction(playerIndex, action);
  if (result?.ok !== false && action.type !== 'rotateSync') {
    markRoomDirty(room);
  }
  return result?.ok === false ? result : { ok: true, rotationOnly: action.type === 'rotateSync' };
}

export function broadcastPlayerRotation(io, roomCode, room, fromPlayerIndex) {
  if (!room.gameLogic) return;
  const aim = room.gameLogic.getAimRotation(fromPlayerIndex);
  if (!aim) return;
  const payload = {
    playerIndex: fromPlayerIndex,
    angle: aim.angle,
    towerKey: aim.towerKey,
  };
  for (const pl of onlinePlayers(room)) {
    if (pl.playerIndex === fromPlayerIndex) continue;
    if (!pl.id || pl.disconnected) continue;
    io.to(pl.id).emit('game:rotation', payload);
  }
}

export function setRoomPaused(room, paused) {
  room.paused = !!paused;
  if (room.gameLogic) room.gameLogic.paused = room.paused;
  markRoomDirty(room);
}

export function getRejoinState(room, playerIndex) {
  if (!room.gameLogic) return room.lastGameState;
  const seq = room.stateSeq ?? 0;
  return buildFullPayload(room, seq, playerIndex);
}

/** 固定步长仿真 + 时钟广播；全量快照按需 */
export function tickRooms(rooms, io) {
  const now = Date.now();

  for (const [code, room] of rooms) {
    if (!room.gameStarted || !room.gameLogic) continue;

    if (room.paused || room.gameLogic.winner != null) {
      broadcastClock(io, code, room);
      continue;
    }

    const last = room._lastTickMs ?? now;
    let frameDt = Math.min((now - last) / 1000, 0.1);
    room._lastTickMs = now;
    room._simAccumulator = (room._simAccumulator ?? 0) + frameDt;

    while (room._simAccumulator >= FIXED_DT) {
      room.gameLogic.tick(FIXED_DT);
      room._simAccumulator -= FIXED_DT;
    }

    broadcastClock(io, code, room);

    const sinceFull = now - (room.lastFullBroadcastMs ?? 0);
    if (room.dirty || sinceFull >= FULL_STATE_INTERVAL_MS) {
      broadcastFullState(io, code, room);
    }
  }
}

export function getTickMs() {
  return TICK_MS;
}
