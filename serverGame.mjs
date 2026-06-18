import { pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TICK_HZ = 30;
const TICK_MS = Math.floor(1000 / TICK_HZ);

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

function buildRoomState(room, viewerPlayerIndex = null, fixedSeq = null, fixedServerTime = null) {
  if (!room.gameLogic) return null;
  if (fixedSeq == null) {
    room.stateSeq = (room.stateSeq ?? 0) + 1;
  }
  const seq = fixedSeq ?? room.stateSeq;
  const serialized = room.gameLogic.serialize();
  if (viewerPlayerIndex != null) {
    serialized.players = serialized.players.map((p, i) => {
      if (i === viewerPlayerIndex) return p;
      return { ...p, visionGrid: null };
    });
  }
  return {
    ...serialized,
    stateSeq: seq,
    serverTime: fixedServerTime ?? Date.now(),
  };
}

export function broadcastRoomState(io, roomCode, room) {
  if (!room.gameLogic) return null;
  room.stateSeq = (room.stateSeq ?? 0) + 1;
  const seq = room.stateSeq;
  const serverTime = Date.now();
  const base = room.gameLogic.serialize();

  for (const pl of room.players) {
    if (!pl.id || pl.disconnected) continue;
    const players = base.players.map((p, i) => {
      if (i === pl.playerIndex) return p;
      return { ...p, visionGrid: null };
    });
    io.to(pl.id).emit('game:state', {
      ...base,
      players,
      stateSeq: seq,
      serverTime,
    });
  }

  room.lastGameState = { ...base, stateSeq: seq, serverTime };
  return room.lastGameState;
}

export async function startRoomGame(room) {
  const GameLogic = await loadGameLogic();
  room.gameLogic = new GameLogic(room.mapData, null);
  room.gameLogic.setNicknames(lobbyNicknames(room));
  room.gameLogic.paused = !!room.paused;
  room.stateSeq = 0;
  room._lastTickMs = Date.now();
  room.lastGameState = buildRoomState(room);
}

export function stopRoomGame(room) {
  room.gameLogic = null;
  room.lastGameState = null;
  room._lastTickMs = null;
  room.stateSeq = 0;
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
  return result?.ok === false ? result : { ok: true };
}

export function setRoomPaused(room, paused) {
  room.paused = !!paused;
  if (room.gameLogic) room.gameLogic.paused = room.paused;
}

export function getRejoinState(room, playerIndex) {
  if (!room.gameLogic) return room.lastGameState;
  return buildRoomState(room, playerIndex);
}

export function tickRooms(rooms, io) {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (!room.gameStarted || !room.gameLogic) continue;
    if (room.paused || room.gameLogic.winner != null) continue;
    const last = room._lastTickMs ?? now;
    const dt = Math.min((now - last) / 1000, 0.1);
    room._lastTickMs = now;
    room.gameLogic.tick(dt);
    broadcastRoomState(io, code, room);
  }
}

export function getTickMs() {
  return TICK_MS;
}
