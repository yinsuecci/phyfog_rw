/**
 * Network.js — Socket.io 连接（支持自定义服务器地址，跨网加入）
 */
export class Network {
  constructor(serverUrl) {
    this.serverUrl = serverUrl || window.location.origin;
    this.socket = null;
    this.isHost = false;
    this.playerIndex = 0;
    this.roomCode = null;
    this.hostId = null;
    this.handlers = {};
    this._socketToIndex = {};
  }

  connect(serverUrl) {
    if (serverUrl) this.serverUrl = serverUrl.replace(/\/$/, '');
    if (this.socket) this.socket.disconnect();

    this.socket = io(this.serverUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 8,
    });

    this.socket.on('connect', () => this._emit('connect', { url: this.serverUrl }));
    this.socket.on('disconnect', (reason) => this._emit('disconnect', { reason }));
    this.socket.on('connect_error', (err) => this._emit('connect_error', { message: err.message }));
    this.socket.on('lobby:update', (d) => this._emit('lobby:update', d));
    this.socket.on('game:start', (d) => this._emit('game:start', d));
    this.socket.on('game:paused', (d) => this._emit('game:paused', d));
    this.socket.on('game:state', (d) => this._emit('game:state', d));
    this.socket.on('game:action', (d) => this._emit('game:action', d));
    this.socket.on('game:return-lobby', () => this._emit('game:return-lobby'));
    this.socket.on('game:rejoin', (d) => this._emit('game:rejoin', d));
    this.socket.on('game:host-waiting', (d) => this._emit('game:host-waiting', d));
    this.socket.on('game:host-restored', (d) => this._emit('game:host-restored', d));
    this.socket.on('room:host-left', (d) => this._emit('room:host-left', d));
    this.socket.on('player:disconnected', (d) => this._emit('player:disconnected', d));
    return this;
  }

  on(event, fn) {
    this.handlers[event] = fn;
    return this;
  }

  _emit(event, data) {
    this.handlers[event]?.(data);
  }

  createRoom(nickname, mapData) {
    return new Promise((resolve) => {
      this.socket.emit('room:create', { nickname, mapData }, (res) => {
        if (res?.ok) {
          this.isHost = true;
          this.roomCode = res.roomCode;
          this.playerIndex = res.playerIndex;
        }
        resolve(res);
      });
    });
  }

  joinRoom(roomCode, nickname) {
    return new Promise((resolve) => {
      this.socket.emit('room:join', { roomCode, nickname }, (res) => {
        if (res?.ok) {
          this.isHost = res.isHost;
          this.roomCode = res.roomCode;
          this.playerIndex = res.playerIndex;
        }
        resolve(res);
      });
    });
  }

  rejoinRoom(roomCode, nickname, playerIndex) {
    return new Promise((resolve) => {
      this.socket.emit('room:rejoin', { roomCode, nickname, playerIndex }, (res) => {
        if (res?.ok) {
          this.isHost = res.isHost;
          this.roomCode = res.roomCode;
          this.playerIndex = res.playerIndex;
        }
        resolve(res);
      });
    });
  }

  setReady(ready) {
    this.socket.emit('lobby:ready', { ready });
  }

  startGame() {
    return new Promise((resolve) => {
      this.socket.emit('game:start', (res) => resolve(res));
    });
  }

  sendAction(action) {
    this.socket.emit('game:action', action);
  }

  sendState(state) {
    if (this.isHost) this.socket.emit('game:state', state);
  }

  pauseGame(paused) {
    this.socket.emit('game:pause', { paused });
  }

  returnToLobby() {
    this.socket.emit('game:return-lobby');
  }

  get id() {
    return this.socket?.id;
  }
}
