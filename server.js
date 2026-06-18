/**

 * PhyFog Radiant War — Socket.io 房间服务器

 * 房主权威：物理由房主计算，状态广播给房间内所有玩家

 */

const express = require('express');

const http = require('http');

const { Server } = require('socket.io');

const path = require('path');



const PORT = process.env.PORT || 3000;

const app = express();

const server = http.createServer(app);

const io = new Server(server, { cors: { origin: '*' } });



app.use(express.static(path.join(__dirname, 'public')));

app.get('/map-editor.html', (_req, res) => {

  res.sendFile(path.join(__dirname, 'map-editor.html'));

});

app.get('/NGROK.md', (_req, res) => {

  res.sendFile(path.join(__dirname, 'NGROK.md'));

});



/** @type {Map<string, Room>} */

const rooms = new Map();



function generateRoomCode() {

  let code;

  do {

    code = String(Math.floor(100000 + Math.random() * 900000));

  } while (rooms.has(code));

  return code;

}



function getRoomList(room) {

  return room.players.map(p => ({

    id: p.id,

    nickname: p.nickname,

    ready: p.ready,

    isHost: p.playerIndex === room.hostPlayerIndex,

    playerIndex: p.playerIndex,

    disconnected: !!p.disconnected,

  }));

}



function broadcastLobby(roomCode) {

  const room = rooms.get(roomCode);

  if (!room) return;

  io.to(roomCode).emit('lobby:update', {

    roomCode,

    players: getRoomList(room),

    mapName: room.mapData?.meta?.name || '自定义地图',

    playerCount: room.mapData?.settings?.playerCount || room.players.length,

    gameStarted: room.gameStarted,

  });

}



function claimPlayerSlot(room, socketId, nickname, preferredIndex) {

  const maxPlayers = room.mapData?.settings?.playerCount || 8;

  const nick = nickname.trim().slice(0, 16);



  const byNick = room.players.find(p => p.nickname === nick && p.disconnected);

  if (byNick) {

    byNick.id = socketId;

    byNick.disconnected = false;

    byNick.nickname = nick;

    return byNick.playerIndex;

  }



  if (preferredIndex != null && preferredIndex >= 0 && preferredIndex < maxPlayers) {

    const occupant = room.players.find(p => p.playerIndex === preferredIndex);

    if (!occupant) {

      room.players.push({

        id: socketId,

        nickname: nick,

        ready: true,

        playerIndex: preferredIndex,

        disconnected: false,

      });

      return preferredIndex;

    }

    if (occupant.disconnected) {

      occupant.id = socketId;

      occupant.disconnected = false;

      occupant.nickname = nick;

      return preferredIndex;

    }

  }



  const freeDisconnected = room.players.find(p => p.disconnected);

  if (freeDisconnected) {

    freeDisconnected.id = socketId;

    freeDisconnected.disconnected = false;

    freeDisconnected.nickname = nick;

    return freeDisconnected.playerIndex;

  }



  if (!room.gameStarted && room.players.length < maxPlayers) {

    const playerIndex = room.players.length;

    room.players.push({

      id: socketId,

      nickname: nick,

      ready: false,

      playerIndex,

      disconnected: false,

    });

    return playerIndex;

  }



  return -1;

}



function tryRestoreHost(room, socketId, playerIndex) {

  if (!room.hostDisconnected) return false;

  if (playerIndex !== room.hostPlayerIndex) return false;

  room.hostId = socketId;

  room.hostDisconnected = false;

  io.to(room.code).emit('game:host-restored', { hostId: socketId });

  return true;

}



io.on('connection', (socket) => {

  let currentRoom = null;



  socket.on('room:create', ({ nickname, mapData }, ack) => {

    if (!nickname?.trim() || !mapData) {

      return ack?.({ ok: false, error: '需要昵称和地图数据' });

    }

    const roomCode = generateRoomCode();

    const room = {

      code: roomCode,

      hostId: socket.id,

      hostPlayerIndex: 0,

      mapData,

      players: [{

        id: socket.id,

        nickname: nickname.trim().slice(0, 16),

        ready: false,

        playerIndex: 0,

        disconnected: false,

      }],

      gameStarted: false,

      paused: false,

      lastGameState: null,

      hostDisconnected: false,

    };

    rooms.set(roomCode, room);

    currentRoom = roomCode;

    socket.join(roomCode);

    ack?.({ ok: true, roomCode, isHost: true, playerIndex: 0 });

    broadcastLobby(roomCode);

  });



  socket.on('room:join', ({ roomCode, nickname }, ack) => {

    const room = rooms.get(roomCode);

    if (!room) return ack?.({ ok: false, error: '房间不存在' });

    if (room.gameStarted) {

      return ack?.({ ok: false, error: '游戏进行中，请刷新页面自动重连' });

    }

    const maxPlayers = room.mapData?.settings?.playerCount || 8;

    if (room.players.filter(p => !p.disconnected).length >= maxPlayers) {

      return ack?.({ ok: false, error: '房间已满' });

    }

    const playerIndex = room.players.length;

    room.players.push({

      id: socket.id,

      nickname: nickname.trim().slice(0, 16),

      ready: false,

      playerIndex,

      disconnected: false,

    });

    currentRoom = roomCode;

    socket.join(roomCode);

    ack?.({ ok: true, roomCode, isHost: false, playerIndex });

    broadcastLobby(roomCode);

  });



  socket.on('room:rejoin', ({ roomCode, nickname, playerIndex: preferredIndex }, ack) => {

    const room = rooms.get(roomCode);

    if (!room) return ack?.({ ok: false, error: '房间不存在' });



    const slot = claimPlayerSlot(room, socket.id, nickname, preferredIndex);

    if (slot < 0) return ack?.({ ok: false, error: '无可用席位' });



    currentRoom = roomCode;

    socket.join(roomCode);



    const isHost = tryRestoreHost(room, socket.id, slot) || room.hostId === socket.id;



    if (room.gameStarted) {

      ack?.({

        ok: true,

        roomCode,

        isHost,

        playerIndex: slot,

        inGame: true,

        paused: room.paused,

      });

      socket.emit('game:rejoin', {

        mapData: room.mapData,

        players: getRoomList(room),

        hostId: room.hostId,

        state: room.lastGameState,

        paused: room.paused,

        playerIndex: slot,

      });

      broadcastLobby(roomCode);

      return;

    }



    ack?.({ ok: true, roomCode, isHost, playerIndex: slot, inGame: false });

    broadcastLobby(roomCode);

  });



  socket.on('lobby:ready', ({ ready }) => {

    const room = rooms.get(currentRoom);

    if (!room) return;

    const p = room.players.find(pl => pl.id === socket.id);

    if (p) p.ready = !!ready;

    broadcastLobby(currentRoom);

  });



  socket.on('game:start', (ack) => {

    const room = rooms.get(currentRoom);

    if (!room || room.hostId !== socket.id) {

      return ack?.({ ok: false, error: '仅房主可开始' });

    }

    if (!room.players.filter(p => !p.disconnected).every(p => p.ready)) {

      return ack?.({ ok: false, error: '尚有玩家未准备' });

    }

    room.gameStarted = true;

    room.paused = false;

    io.to(currentRoom).emit('game:start', {

      mapData: room.mapData,

      players: getRoomList(room),

      hostId: room.hostId,

    });

    ack?.({ ok: true });

  });



  socket.on('game:pause', ({ paused }) => {

    const room = rooms.get(currentRoom);

    if (!room || room.hostId !== socket.id) return;

    room.paused = !!paused;

    io.to(currentRoom).emit('game:paused', { paused: room.paused });

  });



  socket.on('game:action', (action) => {

    const room = rooms.get(currentRoom);

    if (!room || !room.gameStarted || room.hostDisconnected) return;

    if (socket.id !== room.hostId) {

      io.to(room.hostId).emit('game:action', { from: socket.id, action });

    } else {

      socket.to(currentRoom).emit('game:action', { from: socket.id, action });

    }

  });



  socket.on('game:state', (state) => {

    const room = rooms.get(currentRoom);

    if (!room || room.hostId !== socket.id) return;

    room.lastGameState = state;

    socket.to(currentRoom).emit('game:state', state);

  });



  socket.on('game:return-lobby', () => {

    const room = rooms.get(currentRoom);

    if (!room || room.hostId !== socket.id) return;

    room.gameStarted = false;

    room.paused = false;

    room.lastGameState = null;

    room.players.forEach(p => { p.ready = false; });

    io.to(currentRoom).emit('game:return-lobby');

    broadcastLobby(currentRoom);

  });



  socket.on('disconnect', () => {

    if (!currentRoom) return;

    const room = rooms.get(currentRoom);

    if (!room) return;



    const player = room.players.find(p => p.id === socket.id);

    const wasHost = room.hostId === socket.id;



    if (player) {

      player.disconnected = true;

      player.id = null;

    }



    const activeCount = room.players.filter(p => !p.disconnected).length;



    if (activeCount === 0) {

      rooms.delete(currentRoom);

      return;

    }



    if (wasHost && room.gameStarted) {

      room.hostDisconnected = true;

      room.hostId = null;

      io.to(currentRoom).emit('game:host-waiting', { message: '房主断线，等待重连…' });

      broadcastLobby(currentRoom);

      return;

    }



    if (!wasHost) {

      io.to(currentRoom).emit('player:disconnected', {

        playerId: socket.id,

        message: '有玩家断线（可刷新重连）',

      });

    }

    broadcastLobby(currentRoom);

  });

});



server.listen(PORT, () => {

  console.log(`PhyFog server running at http://localhost:${PORT}`);

});


