/**

 * main.js — 大厅、渲染循环、输入；游戏计算由服务器完成，客户端只收 game:state

 */

import { Network } from './Network.js';

import { GameLogic } from './GameLogic.js';

import { MapRenderer } from './MapRenderer.js';

import { BANDS, BUILD_COSTS } from './constants.js';



const $ = (sel) => document.querySelector(sel);

const $$ = (sel) => document.querySelectorAll(sel);



const SESSION_KEY = 'phyfog_session';



const net = new Network();

let game = null;

let renderer = null;

let localPlayerIdx = 0;

let mapData = null;

let selectedBand = 'visible';

let visibleEnergy = 5;

let buildMode = null;

let buildEnergyInput = 20;

let mirrorBuildAngle = 45;

let radioMode = 'message';

let radioMessage = '';

let radioEnergyAmount = 5;

let animId = null;

let towerListDirty = true;

let rejoinAttempted = false;
let lastStateRecvAt = 0;
let lastStateSeq = 0;
let lastServerWallTime = 0;
let lastServerGameTime = 0;
let lastServerSyncAt = 0;

/** 大厅席位在线状态 { playerIndex, nickname, disconnected } */
let roomPlayerStatus = [];

const DISCONNECT_NOTICE_MS = 30000;
let disconnectNoticeTimer = null;
let connectionPendingSince = null;



function getServerUrl() {

  const v = $('#serverUrl')?.value.trim();

  return v || window.location.origin;

}



function getNickname() {

  return $('#nicknameCreate')?.value.trim()

    || $('#nicknameJoin')?.value.trim()

    || loadSession()?.nickname

    || '';

}



function saveSession() {

  if (!net.roomCode) return;

  sessionStorage.setItem(SESSION_KEY, JSON.stringify({

    serverUrl: getServerUrl(),

    roomCode: net.roomCode,

    nickname: getNickname(),

    playerIndex: net.playerIndex,

    inGame: !!game,

  }));

}



function loadSession() {

  try {

    return JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');

  } catch {

    return null;

  }

}



function clearSession() {

  sessionStorage.removeItem(SESSION_KEY);

}



function connectNetwork() {
  const url = getServerUrl().replace(/\/$/, '') || window.location.origin;
  if (net.socket?.connected && net.serverUrl === url) {
    clearDisconnectNotice();
    $('#connStatus').textContent = '已连接 ' + url;
    $('#connStatus').className = 'conn-status ok';
    return url;
  }
  clearDisconnectNoticeTimer();
  if (!connectionPendingSince) connectionPendingSince = Date.now();
  net.connect(url);
  $('#connStatus').textContent = '连接中…';
  $('#connStatus').className = 'conn-status';
  return url;
}

async function ensureConnected() {
  connectNetwork();
  await net.waitForConnect();
}



function restoreSessionFields() {

  const saved = loadSession();

  if (!saved) return;

  if (saved.serverUrl && $('#serverUrl')) $('#serverUrl').value = saved.serverUrl;

  if (saved.nickname) {

    if ($('#nicknameCreate')) $('#nicknameCreate').value = saved.nickname;

    if ($('#nicknameJoin')) $('#nicknameJoin').value = saved.nickname;

  }

  if (saved.roomCode && $('#roomCodeInput')) $('#roomCodeInput').value = saved.roomCode;

}



restoreSessionFields();
connectionPendingSince = Date.now();
connectNetwork();
net.on('connect', onSocketConnected);
net.on('disconnect', onSocketDisconnected);
net.on('connect_error', onSocketConnectError);



function clearDisconnectNoticeTimer() {
  if (disconnectNoticeTimer) {
    clearTimeout(disconnectNoticeTimer);
    disconnectNoticeTimer = null;
  }
}

function clearDisconnectNotice() {
  clearDisconnectNoticeTimer();
  connectionPendingSince = null;
}

function scheduleDisconnectNotice(message) {
  clearDisconnectNoticeTimer();
  if (!connectionPendingSince) connectionPendingSince = Date.now();
  const elapsed = Date.now() - connectionPendingSince;
  const delay = Math.max(0, DISCONNECT_NOTICE_MS - elapsed);
  disconnectNoticeTimer = setTimeout(() => {
    if (net.socket?.connected) return;
    $('#connStatus').textContent = '已断线';
    $('#connStatus').className = 'conn-status err';
    toast(message, true);
  }, delay);
}

function onSocketConnected() {
  clearDisconnectNotice();
  $('#connStatus').textContent = '已连接 ' + getServerUrl();
  $('#connStatus').className = 'conn-status ok';
  tryAutoRejoin();
}

function onSocketDisconnected() {
  rejoinAttempted = false;
  net.roomJoined = false;
  if (!connectionPendingSince) connectionPendingSince = Date.now();
  $('#connStatus').textContent = '连接中…';
  $('#connStatus').className = 'conn-status';
  scheduleDisconnectNotice('与服务器断线');
}

function onSocketConnectError(d) {
  if (!connectionPendingSince) connectionPendingSince = Date.now();
  $('#connStatus').textContent = '连接中…';
  $('#connStatus').className = 'conn-status';
  scheduleDisconnectNotice('无法连接服务器: ' + (d?.message || ''));
}



$('#serverUrl').addEventListener('change', () => connectNetwork());

function resolveLocalPlayerIdx(players) {
  const me = (players || []).find(p => p.id === net.id);
  if (me) return me.playerIndex;
  return net.playerIndex ?? 0;
}

function updateLobbyControls() {
  $('#hostControls').style.display = 'flex';
  $('#btnStartGame').style.display = net.isHost ? 'block' : 'none';
  const returnBtn = $('#btnReturnLobby');
  if (returnBtn) returnBtn.style.display = net.isHost ? '' : 'none';
}

function setSyncOverlay(show, text) {
  const el = $('#syncOverlay');
  const txt = $('#syncOverlayText');
  if (!el) return;
  if (txt && text) txt.textContent = text;
  el.classList.toggle('hidden', !show);
}



async function tryAutoRejoin() {

  if (rejoinAttempted) return;

  const saved = loadSession();

  if (!saved?.roomCode || !saved?.nickname) return;

  rejoinAttempted = true;

  try {
    await net.waitForConnect();
  } catch {
    rejoinAttempted = false;
    return;
  }

  const res = await net.rejoinRoom(saved.roomCode, saved.nickname, saved.playerIndex);

  if (!res?.ok) {

    rejoinAttempted = false;

    return;

  }

  updateLobbyServerHint();

  $('#lobbyRoomCode').textContent = res.roomCode;

  if (res.inGame) {

    // game:rejoin 事件会恢复游戏界面

    return;

  }

  showScreen('lobbyScreen');

}



// ── Screens ──

function showScreen(id) {

  $$('.screen').forEach(s => s.classList.remove('active'));

  $(`#${id}`)?.classList.add('active');

}



// ── Lobby ──

$('#btnCreate').addEventListener('click', () => {

  $('#createPanel').classList.toggle('hidden');

  $('#joinPanel').classList.add('hidden');

});



$('#btnJoin').addEventListener('click', () => {

  $('#joinPanel').classList.toggle('hidden');

  $('#createPanel').classList.add('hidden');

});



$('#mapFile').addEventListener('change', async (e) => {

  const file = e.target.files[0];

  if (!file) return;

  try {

    mapData = JSON.parse(await file.text());

    $('#mapFileName').textContent = file.name;

  } catch {

    toast('地图 JSON 解析失败', true);

  }

});



$('#btnDoCreate').addEventListener('click', async () => {

  const nickname = $('#nicknameCreate').value.trim();

  if (!nickname) return toast('请输入昵称', true);

  if (!mapData) return toast('请先导入地图', true);

  try {
    await ensureConnected();
  } catch {
    return toast('无法连接服务器', true);
  }

  const res = await net.createRoom(nickname, mapData);

  if (!res.ok) return toast(res.error, true);

  localPlayerIdx = res.playerIndex ?? 0;

  saveSession();

  showScreen('lobbyScreen');

  updateLobbyServerHint();

  $('#lobbyTitle').textContent = '等待玩家加入…';

});



$('#btnDoJoin').addEventListener('click', async () => {

  const nickname = $('#nicknameJoin').value.trim();

  const roomCode = $('#roomCodeInput').value.trim();

  if (!nickname || roomCode.length !== 6) return toast('请输入昵称和6位房间号', true);

  try {
    await ensureConnected();
  } catch {
    return toast('无法连接服务器', true);
  }

  const res = await net.joinRoom(roomCode, nickname);

  if (!res.ok) return toast(res.error, true);

  localPlayerIdx = res.playerIndex ?? 0;

  saveSession();

  showScreen('lobbyScreen');

  updateLobbyServerHint();

});



function updateLobbyServerHint() {

  const url = getServerUrl();

  $('#lobbyServerHint').textContent = '服务器: ' + url;

}



$('#btnReady').addEventListener('click', () => {

  const btn = $('#btnReady');

  const ready = btn.dataset.ready !== 'true';

  btn.dataset.ready = ready;

  btn.textContent = ready ? '取消准备' : '准备';

  btn.classList.toggle('ready', ready);

  net.setReady(ready);

});



$('#btnStartGame').addEventListener('click', async () => {

  const res = await net.startGame();

  if (!res?.ok) toast(res?.error || '无法开始', true);

});



// ── Network events ──

function syncRoomPlayerStatus(players) {
  roomPlayerStatus = (players || []).map(p => ({
    playerIndex: p.playerIndex,
    nickname: p.nickname,
    disconnected: !!p.disconnected,
    isHost: !!p.isHost,
  }));
}

net.on('lobby:update', (data) => {

  net._socketToIndex = {};

  data.players.forEach(p => {

    if (p.id) net._socketToIndex[p.id] = p.playerIndex;

  });

  syncRoomPlayerStatus(data.players);

  $('#lobbyRoomCode').textContent = data.roomCode;

  updateLobbyServerHint();

  const list = $('#playerList');

  list.innerHTML = '';

  data.players.forEach(p => {

    const li = document.createElement('li');

    const tag = p.disconnected ? '断线' : (p.ready ? '已准备' : '未准备');

    const cls = p.disconnected ? '' : (p.ready ? 'ready-tag' : '');

    li.innerHTML = `<span>P${p.playerIndex + 1} ${p.nickname}${p.isHost ? ' 👑' : ''}</span><span class="${cls}">${tag}</span>`;

    list.appendChild(li);

  });

  updateLobbyControls();

  if (game) updateStatusBar();

});



function getDisplayGameTime() {
  if (!game) return 0;
  if (game.paused || game.winner != null) return game.gameTime;
  if (!lastServerSyncAt) return game.gameTime;
  const elapsed = (Date.now() - lastServerSyncAt) / 1000;
  return lastServerGameTime + elapsed;
}

function applyServerState(state) {
  if (!game || !state) return;
  const seqNewer = state.stateSeq == null || state.stateSeq > lastStateSeq;
  const timeNewer = state.serverTime == null || state.serverTime >= lastServerWallTime;
  if (!seqNewer && !timeNewer) return;
  if (state.stateSeq != null) lastStateSeq = state.stateSeq;
  if (state.serverTime != null) lastServerWallTime = state.serverTime;
  game.applyState(state);
  lastServerGameTime = state.gameTime ?? game.gameTime;
  lastServerSyncAt = Date.now();
  lastStateRecvAt = lastServerSyncAt;
  setSyncOverlay(false);
  $('#pauseOverlay').classList.toggle('hidden', !game.paused);
  towerListDirty = true;
  updateStatusBar();
}

net.on('game:start', (data) => {

  data.players.forEach(p => {

    if (p.id) net._socketToIndex[p.id] = p.playerIndex;

  });

  localPlayerIdx = resolveLocalPlayerIdx(data.players);

  lastStateSeq = 0;
  lastServerWallTime = 0;
  lastServerGameTime = 0;
  lastServerSyncAt = 0;

  setSyncOverlay(false);

  syncRoomPlayerStatus(data.players);

  startGame(data.mapData, data.players);

  if (data.state) {
    applyServerState(data.state);
  }

});



net.on('game:rejoin', (data) => {

  data.players.forEach(p => {

    if (p.id) net._socketToIndex[p.id] = p.playerIndex;

  });

  localPlayerIdx = resolveLocalPlayerIdx(data.players);

  lastStateSeq = 0;
  lastServerWallTime = 0;
  lastServerGameTime = 0;
  lastServerSyncAt = 0;

  setSyncOverlay(false);

  syncRoomPlayerStatus(data.players);



  if (!game) {

    startGame(data.mapData, data.players);

  }

  if (data.state) {

    applyServerState(data.state);

  }

  if (data.paused) {

    $('#pauseOverlay').classList.remove('hidden');

  } else {

    $('#pauseOverlay').classList.add('hidden');

  }

  showScreen('gameScreen');

  saveSession();

  toast('已重新加入对局');

});



net.on('game:state', (state) => {

  applyServerState(state);

});



net.on('game:paused', ({ paused }) => {

  $('#pauseOverlay').classList.toggle('hidden', !paused);

});



net.on('game:return-lobby', () => {

  stopGameLoop();

  clearSession();

  showScreen('lobbyScreen');

  toast('已返回大厅');

});



net.on('player:disconnected', (d) => toast(d.message, true));



// ── Game start ──

function startGame(md, lobbyPlayers) {

  game = new GameLogic(md, net);

  game.setNicknames(lobbyPlayers);

  renderer = new MapRenderer($('#gameCanvas'), $('#canvasWrap'));

  renderer.resize(game.gridSize, game.cellSize);



  buildBandUI();

  buildBuildUI();

  towerListDirty = true;

  updateHUD();



  showScreen('gameScreen');

  $('#gameRoomCode').textContent = net.roomCode;

  updateLobbyControls();



  updateTowerListUI();

  updateStatusBar();

  saveSession();

  startGameLoop();

}



function startGameLoop() {

  if (animId) cancelAnimationFrame(animId);

  function frame(now) {

    if (game) {

      if (lastStateRecvAt > 0 && now - lastStateRecvAt > 4000) {

        setSyncOverlay(true, '等待服务器同步状态…');

      }

      renderer.render(game, localPlayerIdx);

      updateHUD();

      updateStatusBar();

      if (towerListDirty) updateTowerListUI();

      if (game.winner != null) showWinOverlay();

    }

    animId = requestAnimationFrame(frame);

  }

  animId = requestAnimationFrame(frame);

}



function stopGameLoop() {

  if (animId) cancelAnimationFrame(animId);

  animId = null;

  game = null;

  renderer = null;

  lastStateRecvAt = 0;

  lastStateSeq = 0;
  lastServerWallTime = 0;
  lastServerGameTime = 0;
  lastServerSyncAt = 0;

}



// ── HUD ──

function updateHUD() {

  if (!game) return;

  const p = game.players[localPlayerIdx];

  if (!p) return;

  $('#hudEnergy').textContent = Math.floor(p.energy) + ' J';

  $('#hudTime').textContent = formatTime(getDisplayGameTime());

  updateFireCooldownUI();

}



function updateFireCooldownUI() {

  const btn = $('#btnFire');

  const touchBtn = $('#btnFireTouch');

  const overlay = $('#fireCdOverlay');

  if (!game) return;

  const p = game.players[localPlayerIdx];

  if (!p) return;

  const cdSec = p.fireCooldownSec ?? 5;

  const remaining = Math.max(0, (p.fireCooldownUntil ?? 0) - getDisplayGameTime());

  const ratio = cdSec > 0 ? remaining / cdSec : 0;

  const onCd = remaining > 0.02;

  if (overlay) overlay.style.width = `${ratio * 100}%`;

  if (btn) btn.disabled = onCd;

  if (touchBtn) touchBtn.disabled = onCd;

}



function canFireNow() {

  if (!game || game.paused) return false;

  const p = game.players[localPlayerIdx];

  if (!p?.alive) return false;

  return getDisplayGameTime() >= (p.fireCooldownUntil ?? 0);

}



function updateStatusBar() {

  if (!game) return;

  const playersBox = $('#statusPlayers');

  const beaconsBox = $('#statusBeacons');

  if (!playersBox || !beaconsBox) return;

  const lobbyByIdx = {};

  roomPlayerStatus.forEach(lp => { lobbyByIdx[lp.playerIndex] = lp; });

  playersBox.innerHTML = '';

  game.players.forEach((p, i) => {

    const lobby = lobbyByIdx[i];

    let onlineLabel = '空位';

    let dotClass = 'offline';

    if (lobby) {

      if (lobby.disconnected) {

        onlineLabel = '断线';

        dotClass = 'disconnected';

      } else {

        onlineLabel = '在线';

        dotClass = 'online';

      }

    }

    const maxHp = p.maxHp ?? 100;

    const hpRatio = Math.max(0, Math.min(1, (p.hp ?? 0) / maxHp));

    const hpColor = hpRatio > 0.5 ? 'var(--success)' : (hpRatio > 0.25 ? '#f59e0b' : 'var(--danger)');

    const card = document.createElement('div');

    card.className = 'player-status-card'

      + (i === localPlayerIdx ? ' is-local' : '')

      + (!p.alive ? ' is-dead' : '');

    card.innerHTML = `

      <span class="player-status-dot ${dotClass}" title="${onlineLabel}"></span>

      <span class="player-status-color" style="background:${p.color}"></span>

      <div class="player-status-info">

        <span class="player-status-name">P${i + 1} ${p.nickname || ''}</span>

        <span class="player-status-meta">

          <span>${onlineLabel}</span>

          <span>${Math.floor(p.hp ?? 0)}/${Math.floor(maxHp)} HP</span>

        </span>

      </div>

      <div class="player-hp-bar" title="生命值">

        <div class="player-hp-fill" style="width:${hpRatio * 100}%;background:${hpColor}"></div>

      </div>

    `;

    playersBox.appendChild(card);

  });

  beaconsBox.innerHTML = '';

  if (!game.beacons?.length) {

    beaconsBox.innerHTML = '<span class="beacon-status-empty">无信标</span>';

    return;

  }

  game.beacons.forEach((b, idx) => {

    const owner = b.owner != null ? game.players[b.owner] : null;

    const chip = document.createElement('span');

    chip.className = 'beacon-status-chip' + (owner ? ' captured' : ' neutral');

    const dotColor = owner?.color ?? 'var(--muted)';

    const ownerLabel = owner ? `P${b.owner + 1}` : '中立';

    chip.innerHTML = `
      <span class="beacon-dot" style="background:${dotColor}"></span>
      <span>信标${idx + 1}</span>
      <span style="color:${owner ? owner.color : 'var(--muted)'}">${owner ? (owner.nickname || ownerLabel) : '中立'}</span>
    `;

    beaconsBox.appendChild(chip);

  });

}



function formatTime(t) {

  const m = Math.floor(t / 60);

  const s = Math.floor(t % 60);

  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

}



function showWinOverlay() {

  const w = game.players[game.winner];

  $('#winText').textContent = w ? `${w.nickname} 获胜！` : '游戏结束';

  $('#winOverlay').classList.remove('hidden');

}



// ── Band UI ──

function buildBandUI() {

  const box = $('#bandButtons');

  box.innerHTML = '';

  Object.values(BANDS).forEach(b => {

    const btn = document.createElement('button');

    btn.className = 'band-btn' + (b.id === selectedBand ? ' active' : '');

    const cost = b.cost ?? `${b.costMin}-${b.costMax}`;

    btn.innerHTML = `<span>${b.label}</span><span class="cost">${cost}J</span>`;

    bindTap(btn, () => {

      selectedBand = b.id;

      $$('.band-btn').forEach(x => x.classList.remove('active'));

      btn.classList.add('active');

      $('#visibleSlider').classList.toggle('hidden', b.id !== 'visible');

      $('#radioPanel').classList.toggle('hidden', b.id !== 'radio');

    });

    box.appendChild(btn);

  });

}



function initControlSliders() {
  bindRangeSlider($('#visibleEnergy'), (e) => {
    visibleEnergy = parseInt(e.target.value, 10);
    const names = ['红', '橙', '黄', '绿', '蓝', '靛', '紫', '紫+', '紫++', '高紫'];
    $('#visibleEnergyVal').textContent = visibleEnergy + 'J ' + (names[visibleEnergy - 1] || '');
  });
  bindRangeSlider($('#buildEnergy'), (e) => {
    buildEnergyInput = parseInt(e.target.value, 10) || 10;
    $('#buildEnergyVal').textContent = buildEnergyInput + 'J';
  });
  bindRangeSlider($('#mirrorBuildAngle'), (e) => {
    mirrorBuildAngle = parseInt(e.target.value, 10) || 0;
    $('#mirrorBuildAngleVal').textContent = mirrorBuildAngle + '°';
  });
  $('#radioMsg')?.addEventListener('input', (e) => { radioMessage = e.target.value; });
  $('#radioEnergyAmt')?.addEventListener('input', (e) => { radioEnergyAmount = parseInt(e.target.value, 10) || 0; });
  $$('input[name="radioMode"]').forEach(r => {
    r.addEventListener('change', () => { radioMode = r.value; });
  });
}



function buildBuildUI() {

  const box = $('#buildButtons');

  box.innerHTML = '';

  Object.entries(BUILD_COSTS).forEach(([id, cfg]) => {

    const btn = document.createElement('button');

    btn.className = 'build-btn';

    btn.textContent = cfg.label;

    bindTap(btn, () => {

      buildMode = buildMode === id ? null : id;

      $$('.build-btn').forEach(x => x.classList.remove('active'));

      if (buildMode) btn.classList.add('active');

      const cfgItem = BUILD_COSTS[id];

      $('#buildEnergyPanel').classList.toggle('hidden', !buildMode || !cfgItem?.hpFromEnergy && !cfgItem?.hpFromHalfEnergy);

      $('#mirrorBuildPanel').classList.toggle('hidden', buildMode !== 'mirror');

      if (buildMode !== 'lens') renderer?.clearLensSelection();

    });

    box.appendChild(btn);

  });

}



// ── Input ──

/** 按钮点按（鼠标 + 触控） */
function bindTap(el, handler) {
  if (!el) return;
  el.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    handler(e);
  });
}

/** 长按连续触发（旋转炮台） */
function bindHold(el, handler, intervalMs = 80) {
  if (!el) return;
  let timer = null;
  const tick = (e) => {
    e.preventDefault();
    handler(e);
  };
  const start = (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    tick(e);
    timer = setInterval(() => handler(e), intervalMs);
  };
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };
  el.addEventListener('pointerdown', start);
  el.addEventListener('pointerup', stop);
  el.addEventListener('pointerleave', stop);
  el.addEventListener('pointercancel', stop);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

/** 滑块在横向滚动侧栏内可正常拖动 */
function bindRangeSlider(el, onInput) {
  if (!el) return;
  const stop = (e) => e.stopPropagation();
  el.addEventListener('input', onInput);
  el.addEventListener('pointerdown', stop);
  el.addEventListener('touchstart', stop, { passive: true });
  el.addEventListener('touchmove', stop, { passive: true });
}

function handleCanvasTap(clientX, clientY) {
  if (!game || !renderer) return;
  const { x, y } = renderer.screenToGrid(clientX, clientY);

  if (buildMode) {
    const payload = { type: 'build', buildType: buildMode, x, y, energyInput: buildEnergyInput };
    if (buildMode === 'mirror') payload.mirrorAngle = mirrorBuildAngle;
    sendAction(payload);
    return;
  }

  if (renderer.selectLensAt(game, localPlayerIdx, x, y)) {
    const el = game.cells[`${x},${y}`];
    if (el) renderer.selectedLens = { x, y, focal: el.focal ?? 5 };
    return;
  }
  renderer.clearLensSelection();
}

document.addEventListener('keydown', (e) => {
  if (!game || game.paused) return;
  if (e.key === 'ArrowLeft') sendAction({ type: 'rotate', delta: -5 });
  if (e.key === 'ArrowRight') sendAction({ type: 'rotate', delta: 5 });
  if (e.key === ' ') { e.preventDefault(); fire(); }
});

bindTap($('#btnFire'), fire);
bindTap($('#btnFireTouch'), fire);

const rotateLeft = () => {
  if (!game || game.paused) return;
  sendAction({ type: 'rotate', delta: -5 });
};
const rotateRight = () => {
  if (!game || game.paused) return;
  sendAction({ type: 'rotate', delta: 5 });
};

bindHold($('#btnRotateL'), rotateLeft);
bindHold($('#btnRotateR'), rotateRight);



function fire() {

  if (!canFireNow()) return;

  let bandEnergy = visibleEnergy;

  let radioPayload = null;

  if (selectedBand === 'visible') bandEnergy = visibleEnergy;

  if (selectedBand === 'radio') {

    radioPayload = radioMode === 'message'

      ? { message: radioMessage }

      : { energy: radioEnergyAmount };

  }

  sendAction({ type: 'shoot', bandId: selectedBand, bandEnergy, radioPayload });

}



function sendAction(action) {

  if (!game) return;

  if (!net.socket?.connected || !net.roomJoined) {
    toast('未连接到房间，正在重连…', true);
    tryAutoRejoin();
    return;
  }

  // 轻量本地预测：旋转/切塔立即有反馈，最终以服务器 state 为准
  if (action.type === 'rotate') {
    game.rotate(localPlayerIdx, action.delta);
  } else if (action.type === 'switchTower') {
    game.switchTower(localPlayerIdx, action.towerType, action.key);
    renderer?.resetUserZoom();
  }

  const noAck = action.type === 'rotate';
  net.sendAction(action, { noAck }).then((res) => {
    if (res && !res.ok) toast(res.error || '操作被拒绝', true);
  });

  towerListDirty = true;

}



// 滚轮缩放（不可拖屏平移）

const canvasWrap = $('#canvasWrap');

const gameCanvas = $('#gameCanvas');

if (canvasWrap) {

  canvasWrap.addEventListener('wheel', (e) => {

    if (!game || !renderer) return;

    e.preventDefault();

    const delta = e.deltaY < 0 ? 0.08 : -0.08;

    renderer.setUserZoom(delta);

  }, { passive: false });

}

if (gameCanvas) {
  let canvasPointerId = null;
  let canvasDownX = 0;
  let canvasDownY = 0;

  gameCanvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    canvasPointerId = e.pointerId;
    canvasDownX = e.clientX;
    canvasDownY = e.clientY;
    try { gameCanvas.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  });

  gameCanvas.addEventListener('pointerup', (e) => {
    if (canvasPointerId == null || e.pointerId !== canvasPointerId) return;
    canvasPointerId = null;
    try { gameCanvas.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    const moved = Math.hypot(e.clientX - canvasDownX, e.clientY - canvasDownY);
    if (moved > 14) return;
    if (e.target.closest?.('.mobile-controls')) return;
    handleCanvasTap(e.clientX, e.clientY);
  });

  gameCanvas.addEventListener('pointercancel', () => {
    canvasPointerId = null;
  });
}



function updateTowerListUI() {

  towerListDirty = false;

  const box = $('#attackTowerList');

  if (!box || !game) return;

  const p = game.players[localPlayerIdx];

  const towers = game.getOwnedAttackTowers(localPlayerIdx);

  const activeKey = p?.activeTower?.type === 'attack' ? p.activeTower.key : null;



  box.innerHTML = '';

  if (towers.length === 0) {

    box.innerHTML = '<p class="tower-list-empty">暂无进攻塔（建造或用可见光占领）</p>';

    return;

  }



  towers.forEach((t, i) => {

    const btn = document.createElement('button');

    btn.className = 'tower-list-btn' + (activeKey === t.key ? ' active' : '');

    btn.innerHTML = `<span>⚔️ 进攻塔${i + 1} <span class="coords">(${t.x},${t.y}) ${t.label}</span></span><span>切换</span>`;

    bindTap(btn, () => {

      sendAction({ type: 'switchTower', towerType: 'attack', key: t.key });

      renderer?.clearLensSelection();

    });

    box.appendChild(btn);

  });

}



bindTap($('#btnSwitchMain'), () => {

  sendAction({ type: 'switchTower', towerType: 'main' });

  renderer?.clearLensSelection();

});



bindTap($('#btnPause'), () => {

  if (!game) return;

  net.pauseGame(!game.paused);

});



bindTap($('#btnReturnLobby'), () => {

  if (!net.isHost) return toast('仅房间创建者可返回大厅', true);

  net.returnToLobby();

});



bindTap($('#btnResume'), () => {

  if (!game) return;

  net.pauseGame(false);

});



function toast(msg, isError = false) {

  const el = $('#toast');

  el.textContent = msg;

  el.className = 'toast show' + (isError ? ' error' : '');

  setTimeout(() => el.classList.remove('show'), 3000);

}



initControlSliders();

showScreen('entryScreen');


