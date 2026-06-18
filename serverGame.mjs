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
  room._lastTickMs = Date.now();
  room.lastGameState = room.gameLogic.serialize();
}

export function stopRoomGame(room) {
  room.gameLogic = null;
  room.lastGameState = null;
  room._lastTickMs = null;
}

export function handleRoomAction(room, playerIndex, action) {
  if (!room.gameLogic || !room.gameStarted) {
    return { ok: false, error: '对局未开始' };
  }
  room.gameLogic.handleAction(playerIndex, action);
  room.lastGameState = room.gameLogic.serialize();
  return { ok: true };
}

export function setRoomPaused(room, paused) {
  room.paused = !!paused;
  if (room.gameLogic) room.gameLogic.paused = room.paused;
}

export function broadcastRoomState(io, roomCode, room) {
  if (!room.gameLogic) return null;
  const state = room.gameLogic.serialize();
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
