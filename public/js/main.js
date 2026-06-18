/**

 * main.js — 大厅、游戏循环、输入、网络同步

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

let lastSync = 0;

let animId = null;

let towerListDirty = true;

let rejoinAttempted = false;

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
  clearDisconnectNoticeTimer();
  if (!connectionPendingSince) connectionPendingSince = Date.now();
  const url = getServerUrl();
  net.connect(url);
  $('#connStatus').textContent = '连接中…';
  $('#connStatus').className = 'conn-status';
  return url;
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

$('#serverUrl').addEventListener('blur', () => connectNetwork());



async function tryAutoRejoin() {

  if (rejoinAttempted) return;

  const saved = loadSession();

  if (!saved?.roomCode || !saved?.nickname) return;

  rejoinAttempted = true;

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

  connectNetwork();

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

  connectNetwork();

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

  $('#btnStartGame').style.display = net.isHost ? 'block' : 'none';

  if (game) updateStatusBar();

});



net.on('game:start', (data) => {

  net.hostId = data.hostId;

  data.players.forEach(p => {

    if (p.id) net._socketToIndex[p.id] = p.playerIndex;

  });

  localPlayerIdx = net.playerIndex;

  syncRoomPlayerStatus(data.players);

  startGame(data.mapData, data.players);

});



net.on('game:rejoin', (data) => {

  net.hostId = data.hostId;

  data.players.forEach(p => {

    if (p.id) net._socketToIndex[p.id] = p.playerIndex;

  });

  localPlayerIdx = net.playerIndex;

  syncRoomPlayerStatus(data.players);



  if (!game) {

    startGame(data.mapData, data.players, { skipInitialBroadcast: true });

  }

  if (data.state) {

    game.applyState(data.state);

    if (net.isHost) broadcastState();

    towerListDirty = true;

  }

  if (data.paused) {

    game.paused = true;

    $('#pauseOverlay').classList.remove('hidden');

  }

  showScreen('gameScreen');

  saveSession();

  toast('已重新加入对局');

});



net.on('game:state', (state) => {

  if (net.isHost) return;

  game?.applyState(state);

  towerListDirty = true;

  updateStatusBar();

});



net.on('game:action', ({ from, action }) => {

  if (!net.isHost || !game) return;

  const pIdx = net._socketToIndex?.[from] ?? action.playerIndex ?? -1;

  if (pIdx < 0) return;

  game.handleAction(pIdx, action);

  broadcastState();

});



net.on('game:paused', ({ paused }) => {

  if (game) game.paused = paused;

  $('#pauseOverlay').classList.toggle('hidden', !paused);

});



net.on('game:return-lobby', () => {

  stopGameLoop();

  clearSession();

  showScreen('lobbyScreen');

  toast('已返回大厅');

});



net.on('game:host-waiting', (d) => toast(d.message, true));

net.on('game:host-restored', (d) => {

  net.hostId = d.hostId;

  toast('房主已重连');

});



net.on('room:host-left', (d) => {

  toast(d.message, true);

  clearSession();

  showScreen('entryScreen');

  stopGameLoop();

});

net.on('player:disconnected', (d) => toast(d.message, true));



// ── Game start ──

function startGame(md, lobbyPlayers, opts = {}) {

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

  $('#hostControls').style.display = net.isHost ? 'flex' : 'none';



  if (net.isHost && !opts.skipInitialBroadcast) broadcastState();



  updateTowerListUI();

  updateStatusBar();

  saveSession();

  startGameLoop();

}



function startGameLoop() {

  if (animId) cancelAnimationFrame(animId);

  let last = performance.now();

  function frame(now) {

    const dt = (now - last) / 1000;

    last = now;

    if (game) {

      if (net.isHost) {

        game.tick(dt);

        if (now - lastSync > 50) {

          broadcastState();

          lastSync = now;

        }

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

}



function broadcastState() {

  if (!net.isHost || !game) return;

  net.sendState(game.serialize());

}



// ── HUD ──

function updateHUD() {

  if (!game) return;

  const p = game.players[localPlayerIdx];

  if (!p) return;

  $('#hudEnergy').textContent = Math.floor(p.energy) + ' J';

  $('#hudTime').textContent = formatTime(game.gameTime);

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

  const remaining = Math.max(0, (p.fireCooldownUntil ?? 0) - game.gameTime);

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

  return game.gameTime >= (p.fireCooldownUntil ?? 0);

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

  const payload = { ...action, playerIndex: localPlayerIdx };



  if (!net.isHost && game) {

    if (action.type === 'switchTower') {

      game.switchTower(localPlayerIdx, action.towerType, action.key);

      renderer?.resetUserZoom();

    } else if (action.type === 'rotate') {

      game.rotate(localPlayerIdx, action.delta);

    }

  }



  if (net.isHost) {

    game.handleAction(localPlayerIdx, action);

    if (action.type === 'switchTower') renderer?.resetUserZoom();

    broadcastState();

  } else {

    net.sendAction(payload);

  }

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

  if (!net.isHost) return;

  game.paused = !game.paused;

  net.pauseGame(game.paused);

  $('#pauseOverlay').classList.toggle('hidden', !game.paused);

});



bindTap($('#btnReturnLobby'), () => {

  if (net.isHost) net.returnToLobby();

});



bindTap($('#btnResume'), () => {

  if (net.isHost) { game.paused = false; net.pauseGame(false); $('#pauseOverlay').classList.add('hidden'); }

});



function toast(msg, isError = false) {

  const el = $('#toast');

  el.textContent = msg;

  el.className = 'toast show' + (isError ? ' error' : '');

  setTimeout(() => el.classList.remove('show'), 3000);

}



initControlSliders();

showScreen('entryScreen');


