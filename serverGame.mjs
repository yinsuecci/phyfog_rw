import { pathToFileURL } from 'url';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
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

function buildRoomState(room) {
  if (!room.gameLogic) return null;
  room.stateSeq = (room.stateSeq ?? 0) + 1;
  return {
    ...room.gameLogic.serialize(),
    stateSeq: room.stateSeq,
    serverTime: Date.now(),
  };
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

  room.gameLogic.handleAction(playerIndex, action);
  return { ok: true };
}

export function setRoomPaused(room, paused) {
  room.paused = !!paused;
  if (room.gameLogic) room.gameLogic.paused = room.paused;
}

export function broadcastRoomState(io, roomCode, room) {
  const state = buildRoomState(room);
  if (!state) return null;
  room.lastGameState = state;
  io.to(roomCode).emit('game:state', state);
  return state;
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
