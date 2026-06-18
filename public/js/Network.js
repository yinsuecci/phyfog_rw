/**
 * Network.js — Socket.io 连接（服务器权威同步）
 */
export class Network {
  constructor(serverUrl) {
    this.serverUrl = serverUrl || window.location.origin;
    this.socket = null;
    /** 是否为房间创建者（仅大厅：开始游戏、返回大厅） */
    this.isHost = false;
    this.playerIndex = 0;
    this.roomCode = null;
    this.roomJoined = false;
    this.handlers = {};
    this._socketToIndex = {};
  }

  waitForConnect(timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      if (this.socket?.connected) {
        resolve();
        return;
      }
      const timer = setTimeout(() => {
        this.socket?.off('connect', onConnect);
        reject(new Error('连接服务器超时'));
      }, timeoutMs);
      const onConnect = () => {
        clearTimeout(timer);
        this.socket?.off('connect', onConnect);
        resolve();
      };
      this.socket?.on('connect', onConnect);
    });
  }

  connect(serverUrl) {
    const nextUrl = (serverUrl || this.serverUrl || window.location.origin).replace(/\/$/, '');
    if (this.socket?.connected && this.serverUrl === nextUrl) {
      return this;
    }
    this.serverUrl = nextUrl;
    if (this.socket) this.socket.disconnect();

    this.socket = io(this.serverUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 8,
    });

    this.socket.on('connect', () => {
      this.roomJoined = false;
      this._emit('connect', { url: this.serverUrl });
    });
    this.socket.on('disconnect', (reason) => {
      this.roomJoined = false;
      this._emit('disconnect', { reason });
    });
    this.socket.on('connect_error', (err) => this._emit('connect_error', { message: err.message }));
    this.socket.on('lobby:update', (d) => this._emit('lobby:update', d));
    this.socket.on('game:start', (d) => this._emit('game:start', d));
    this.socket.on('game:paused', (d) => this._emit('game:paused', d));
    this.socket.on('game:state', (d) => this._emit('game:state', d));
    this.socket.on('game:return-lobby', () => this._emit('game:return-lobby'));
    this.socket.on('game:rejoin', (d) => this._emit('game:rejoin', d));
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
          this.roomJoined = true;
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
          this.roomJoined = true;
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
          this.roomJoined = true;
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
    if (!this.socket?.connected || !this.roomJoined) return false;
    this.socket.emit('game:action', action);
    return true;
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
