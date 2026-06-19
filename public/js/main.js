/**

 * main.js — 大厅、渲染循环、输入；游戏计算由服务器完成，客户端只收 game:state

 */

import { Network } from './Network.js';

import { GameLogic } from './GameLogic.js';

import { GameSync } from './GameSync.js';

import { MapRenderer } from './MapRenderer.js';

import { AimDial } from './AimDial.js';

import { BANDS, BUILD_COSTS, visibleColor, normalizeAngle } from './constants.js';

/** 建设按钮显示顺序（太阳能板提前，避免手机横向滚动看不到） */
const BUILD_ORDER = ['wall', 'mirror', 'lens', 'solar', 'attack_tower', 'lead'];



const $ = (sel) => document.querySelector(sel);

const $$ = (sel) => document.querySelectorAll(sel);



const SESSION_KEY = 'phyfog_session';



const net = new Network();
const gameSync = new GameSync();

let game = null;

let renderer = null;

let localPlayerIdx = 0;

let mapData = null;

let selectedBand = 'visible';

let visibleEnergy = 5;

let buildMode = null;

let buildEnergyInput = 20;

let mirrorBuildAngle = 45;
let lensBuildFocal = 5;

let relocateMode = false;

let aimDial = null;
/** @type {'aim'|'mirrorBuild'} */
let dialMode = 'aim';

let radioMode = 'message';

let radioMessage = '';

let radioEnergyAmount = 5;

let animId = null;

let towerListDirty = true;
let statusBarDirty = true;

let rejoinAttempted = false;

/** 大厅席位在线状态 { playerIndex, nickname, disconnected } */
let roomPlayerStatus = [];

const DISCONNECT_NOTICE_MS = 30000;
let disconnectNoticeTimer = null;
let connectionPendingSince = null;



function getServerUrl() {
  return window.location.origin.replace(/\/$/, '');
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
    $('#connStatus').textContent = '已连接';
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
  $('#connStatus').textContent = '已连接';
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
  /* 已自动连接当前站点，无需显示服务器地址 */
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

  if (game) {
    statusBarDirty = true;
    updateStatusBar();
  }

});



function getDisplayGameTime() {
  return gameSync.getGameTime(game);
}

function applyServerState(state) {
  if (!gameSync.apply(game, state, { localPlayerIdx })) return;
  setSyncOverlay(false);
  $('#pauseOverlay').classList.toggle('hidden', !game.paused);
  towerListDirty = true;
  statusBarDirty = true;
}

/** 将本地实时瞄准角度同步到服务器（不等待 ack） */
function uploadLocalRotation() {
  if (!game) return;
  const aim = game.getAimRotation(localPlayerIdx);
  if (!aim) return;
  net.sendAction({
    type: 'rotateSync',
    angle: aim.angle,
    towerKey: aim.towerKey,
  }, { noAck: true });
}

net.on('game:start', (data) => {

  data.players.forEach(p => {

    if (p.id) net._socketToIndex[p.id] = p.playerIndex;

  });

  net.roomJoined = true;
  localPlayerIdx = resolveLocalPlayerIdx(data.players);

  gameSync.reset();
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

  net.roomJoined = true;
  localPlayerIdx = resolveLocalPlayerIdx(data.players);

  gameSync.reset();
  setSyncOverlay(false);

  syncRoomPlayerStatus(data.players);



  if (!game) {

    startGame(data.mapData, data.players);

  } else {

    showScreen('gameScreen');

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (renderer && game) renderer.resize(game.gridSize, game.cellSize);
      });
    });

  }

  if (data.state) {

    applyServerState(data.state);

  }

  if (data.paused) {

    $('#pauseOverlay').classList.remove('hidden');

  } else {

    $('#pauseOverlay').classList.add('hidden');

  }

  saveSession();

  toast('已重新加入对局');

});



net.on('game:state', (state) => {

  applyServerState(state);

});

net.on('game:rotation', ({ playerIndex, angle, towerKey }) => {
  if (!game || playerIndex === localPlayerIdx) return;
  game.applyRemoteRotation(playerIndex, { angle, towerKey });
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

  buildBandUI();

  buildBuildUI();

  towerListDirty = true;

  showScreen('gameScreen');

  // 等布局完成后再量 canvas（双 rAF 确保 flex 高度已计算）
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (renderer && game) renderer.resize(game.gridSize, game.cellSize);
    });
  });

  updateHUD();

  $('#gameRoomCode').textContent = net.roomCode;

  updateLobbyControls();



  updateTowerListUI();

  updateStatusBar();

  saveSession();

  startGameLoop();

  initAimDial();
  aimDial?.syncFromGame();

}



function startGameLoop() {

  if (animId) cancelAnimationFrame(animId);

  function frame(now) {

    if (game) {

      if (gameSync.isStale(10000)) {
        gameSync.softResync(game);
      }
      const disconnected = !net.socket?.connected || !net.roomJoined;
      setSyncOverlay(disconnected, disconnected ? '连接已断开，正在重连…' : '');

      game.pruneExpiredRays();
      aimDial?.tickSnap();
      if (dialMode === 'mirrorBuild') {
        aimDial?.updateIndicator(mirrorBuildAngle);
      } else {
        aimDial?.syncFromGame();
      }
      renderer.render(game, localPlayerIdx, getDisplayGameTime());
      updateSolarInfoPanel();

      updateHUD();

      if (statusBarDirty) {
        statusBarDirty = false;
        updateStatusBar();
      }

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

  renderer?.destroy();
  renderer = null;

  gameSync.reset();

  aimDial?.reset();
  relocateMode = false;

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
  const overlayTouch = $('#fireCdOverlayTouch');

  if (!game) return;

  const p = game.players[localPlayerIdx];

  if (!p) return;

  const cdSec = p.fireCooldownSec ?? 5;

  const remaining = Math.max(0, (p.fireCooldownUntil ?? 0) - getDisplayGameTime());

  const ratio = cdSec > 0 ? remaining / cdSec : 0;

  const onCd = remaining > 0.02;

  if (overlay) overlay.style.width = `${ratio * 100}%`;
  if (overlayTouch) overlayTouch.style.width = `${ratio * 100}%`;

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
      updateVisibleBandPanels();

    });

    box.appendChild(btn);

  });

  updateVisibleBandPanels();

}



function updateVisibleBandPanels() {
  const show = selectedBand === 'visible';
  $('#visibleSlider')?.classList.toggle('hidden', !show);
  $('#mobileVisibleBar')?.classList.toggle('is-visible', show);
}

const VISIBLE_ENERGY_NAMES = ['红', '橙', '黄', '绿', '蓝', '靛', '紫', '紫+', '紫++', '高紫'];

function setVisibleEnergy(val) {
  visibleEnergy = Math.max(1, Math.min(10, val));
  const slider = $('#visibleEnergy');
  if (slider) slider.value = String(visibleEnergy);
  const label = `${visibleEnergy}J ${VISIBLE_ENERGY_NAMES[visibleEnergy - 1] || ''}`;
  const valEl = $('#visibleEnergyVal');
  const color = visibleColor(visibleEnergy);
  const pct = ((visibleEnergy - 1) / 9) * 100;
  if (valEl) {
    valEl.textContent = label;
    valEl.style.color = color;
  }
  if (slider) {
    slider.value = String(visibleEnergy);
    slider.style.accentColor = color;
  }
  const desktopFill = $('#visibleEnergyFill');
  if (desktopFill) {
    desktopFill.style.width = `${pct}%`;
    desktopFill.style.background = color;
  }
  const mobileVal = $('#mobileVisibleEnergyVal');
  if (mobileVal) {
    mobileVal.textContent = label;
    mobileVal.style.color = color;
  }
  const fill = $('#mobileVisibleFill');
  const thumb = $('#mobileVisibleThumb');
  const track = $('#mobileVisibleTrack');
  if (fill) {
    fill.style.width = `${pct}%`;
    fill.style.background = color;
  }
  if (thumb) {
    thumb.style.left = `${pct}%`;
    thumb.style.borderColor = color;
    thumb.style.boxShadow = `0 0 0 3px ${color}44`;
  }
  if (track) track.setAttribute('aria-valuenow', String(visibleEnergy));
  $$('.mobile-visible-step').forEach((btn, i) => {
    btn.classList.toggle('active', i + 1 === visibleEnergy);
    if (i + 1 === visibleEnergy) btn.style.borderColor = color;
    else btn.style.borderColor = '';
  });
}

function initMobileVisibleBar() {
  const track = $('#mobileVisibleTrack');
  const steps = $('#mobileVisibleSteps');
  if (!track || !steps) return;

  steps.innerHTML = '';
  for (let i = 1; i <= 10; i++) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mobile-visible-step';
    btn.textContent = String(i);
    btn.setAttribute('aria-label', `${i}焦耳`);
    bindTap(btn, () => setVisibleEnergy(i));
    steps.appendChild(btn);
  }

  const pickEnergy = (clientX) => {
    const rect = track.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    setVisibleEnergy(Math.round(ratio * 9) + 1);
  };

  track.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    track.setPointerCapture(e.pointerId);
    pickEnergy(e.clientX);
  });
  track.addEventListener('pointermove', (e) => {
    if (!track.hasPointerCapture(e.pointerId)) return;
    e.preventDefault();
    pickEnergy(e.clientX);
  });
  track.addEventListener('pointerup', (e) => {
    try { track.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  });
  track.addEventListener('pointercancel', (e) => {
    try { track.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  });
}

function initControlSliders() {
  bindRangeSlider($('#visibleEnergy'), (e) => {
    setVisibleEnergy(parseInt(e.target.value, 10));
  });
  initMobileVisibleBar();
  setVisibleEnergy(visibleEnergy);
  updateVisibleBandPanels();
  bindRangeSlider($('#buildEnergy'), (e) => {
    buildEnergyInput = parseInt(e.target.value, 10) || 10;
    $('#buildEnergyVal').textContent = buildEnergyInput + 'J';
  });
  bindRangeSlider($('#lensBuildFocal'), (e) => {
    lensBuildFocal = parseInt(e.target.value, 10) || 5;
    $('#lensBuildFocalVal').textContent = lensBuildFocal;
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

  BUILD_ORDER.forEach((id) => {
    const cfg = BUILD_COSTS[id];
    if (!cfg) return;

    const btn = document.createElement('button');

    btn.className = 'build-btn';

    btn.textContent = cfg.label;

    bindTap(btn, () => {

      buildMode = buildMode === id ? null : id;

      $$('.build-btn').forEach(x => x.classList.remove('active'));

      if (buildMode) {
        btn.classList.add('active');
        setRelocateMode(false);
      }

      const cfgItem = BUILD_COSTS[id];

      $('#buildEnergyPanel').classList.toggle('hidden', !buildMode || !cfgItem?.hpFromEnergy && !cfgItem?.hpFromHalfEnergy);

      $('#lensBuildPanel').classList.toggle('hidden', buildMode !== 'lens');
      updateDialForBuildMode();

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
  el.addEventListener('change', onInput);
  el.addEventListener('pointerdown', stop);
  el.addEventListener('pointermove', stop);
  el.addEventListener('touchstart', stop, { passive: false });
  el.addEventListener('touchmove', stop, { passive: false });
}

function handleCanvasTap(clientX, clientY) {
  if (!game || !renderer) return;
  const { x, y } = renderer.screenToGrid(clientX, clientY);

  if (relocateMode) {
    sendAction({ type: 'relocateMain', x, y });
    setRelocateMode(false);
    return;
  }

  if (buildMode) {
    const payload = { type: 'build', buildType: buildMode, x, y, energyInput: buildEnergyInput };
    if (buildMode === 'mirror') payload.mirrorAngle = mirrorBuildAngle;
    if (buildMode === 'lens') payload.lensFocal = lensBuildFocal;
    sendAction(payload);
    return;
  }

  const cellEl = game.cells[`${x},${y}`];
  if (cellEl?.type === 'solar' && game.canSee(localPlayerIdx, x, y)) {
    if (renderer.selectedSolar?.x === x && renderer.selectedSolar?.y === y) {
      renderer.clearSolarSelection();
    } else {
      renderer.selectSolarAt(game, localPlayerIdx, x, y);
      renderer.clearLensSelection();
    }
    updateSolarInfoPanel();
    return;
  }

  renderer.clearSolarSelection();
  updateSolarInfoPanel();

  if (renderer.selectLensAt(game, localPlayerIdx, x, y)) {
    const el = game.cells[`${x},${y}`];
    if (el) renderer.selectedLens = { x, y, focal: el.focal ?? 5 };
    return;
  }
  renderer.clearLensSelection();
}

function setRelocateMode(on) {
  relocateMode = !!on;
  const btn = $('#btnRelocateMain');
  if (btn) btn.classList.toggle('active', relocateMode);
  if (relocateMode) {
    buildMode = null;
    $$('.build-btn').forEach((x) => x.classList.remove('active'));
    $('#buildEnergyPanel')?.classList.add('hidden');
    $('#lensBuildPanel')?.classList.add('hidden');
    updateDialForBuildMode();
    toast('点击视野内空格移动主光塔 (40J)');
  }
}

function updateSolarInfoPanel() {
  const panel = $('#solarInfoPanel');
  const text = $('#solarInfoText');
  if (!panel || !text || !game) return;
  const sel = renderer?.selectedSolar;
  if (!sel) {
    panel.classList.add('hidden');
    return;
  }
  const el = game.cells[`${sel.x},${sel.y}`];
  if (!el || el.type !== 'solar') {
    panel.classList.add('hidden');
    return;
  }
  const per10 = el.energyPer10s ?? 2;
  const rate = el.conversionRate ?? 0.6;
  const owner = el.owner != null ? game.players[el.owner] : null;
  panel.classList.remove('hidden');
  text.innerHTML = `位置 (${sel.x}, ${sel.y})<br>`
    + `每 <strong>10 秒</strong> 产出 <strong>${per10}J</strong><br>`
    + `低能转化倍率 <strong>${rate}</strong>（可见光 &lt;3J 照射）<br>`
    + `归属：${owner ? (owner.nickname || `P${el.owner + 1}`) : '中立'}`;
}

function setLocalAimAbsolute(angle) {
  if (!game || game.paused) return;
  const a = normalizeAngle(angle);
  const aim = game.getAimRotation(localPlayerIdx);
  if (!aim) return;
  if (aim.towerKey) {
    const el = game.cells[aim.towerKey];
    if (el) el.angle = a;
  } else {
    game.players[localPlayerIdx].angle = a;
  }
  uploadLocalRotation();
}

function updateDialForBuildMode() {
  const dialEl = $('#aimDial');
  const hint = dialEl?.querySelector('.aim-dial-hint');
  if (buildMode === 'mirror') {
    dialMode = 'mirrorBuild';
    dialEl?.classList.remove('hidden');
    if (hint) hint.textContent = '镜面方向';
    aimDial?.reset();
    aimDial?.updateIndicator(mirrorBuildAngle);
  } else if (buildMode) {
    dialMode = 'aim';
    dialEl?.classList.add('hidden');
  } else {
    dialMode = 'aim';
    dialEl?.classList.remove('hidden');
    if (hint) hint.textContent = '长按瞄准';
    aimDial?.syncFromGame();
  }
}

function initAimDial() {
  const el = $('#aimDial');
  if (!el) return;
  if (!aimDial) {
    aimDial = new AimDial(el, {
      getAngle: () => (dialMode === 'mirrorBuild' ? mirrorBuildAngle : getLocalAimAngle()),
      onAngleChange: (angle) => {
        if (dialMode === 'mirrorBuild') {
          mirrorBuildAngle = Math.round(normalizeAngle(angle));
        } else {
          setLocalAimAbsolute(angle);
        }
      },
    });
  }
  updateDialForBuildMode();
}

document.addEventListener('keydown', (e) => {
  if (!game || game.paused) return;
  if (e.key === 'ArrowLeft') sendAction({ type: 'rotate', delta: -5 });
  if (e.key === 'ArrowRight') sendAction({ type: 'rotate', delta: 5 });
  if (e.key === ' ') { e.preventDefault(); fire(); }
});

bindTap($('#btnFire'), fire);
bindTap($('#btnFireTouch'), fire);

bindTap($('#btnRelocateMain'), () => {
  if (!game || game.paused) return;
  setRelocateMode(!relocateMode);
});

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

  sendAction({ type: 'shoot', bandId: selectedBand, bandEnergy, radioPayload, aimAngle: getLocalAimAngle() });

}



function getLocalAimAngle() {
  return game?.getAimRotation(localPlayerIdx)?.angle ?? 0;
}

function sendAction(action) {

  if (!game) return;

  if (!net.socket?.connected || !net.roomJoined) {
    toast('未连接到房间，正在重连…', true);
    tryAutoRejoin();
    return;
  }

  if (action.type === 'rotate') {
    game.rotate(localPlayerIdx, action.delta);
    uploadLocalRotation();
    aimDial?.syncFromGame();
    return;
  }

  if (action.type === 'relocateMain') {
    net.sendAction(action).then((res) => {
      if (res && !res.ok) toast(res.error || '易位失败', true);
      else towerListDirty = true;
    });
    return;
  }

  if (action.type === 'shoot' && action.aimAngle == null) {
    action.aimAngle = getLocalAimAngle();
  }

  net.sendAction(action).then((res) => {
    if (res && !res.ok) toast(res.error || '操作被拒绝', true);
  });

  towerListDirty = true;

}



// 滚轮缩放 + 触控平移/捏合缩放
const canvasWrap = $('#canvasWrap');

const gameCanvas = $('#gameCanvas');

const canvasPointers = new Map();
let canvasPanActive = false;
let canvasLastPinchDist = null;

function getPinchDistance() {
  const pts = [...canvasPointers.values()];
  if (pts.length < 2) return null;
  return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
}

if (canvasWrap) {

  canvasWrap.addEventListener('wheel', (e) => {

    if (!game || !renderer) return;

    e.preventDefault();

    const delta = e.deltaY < 0 ? 0.08 : -0.08;

    renderer.setUserZoom(delta);

  }, { passive: false });

  canvasWrap.addEventListener('pointerdown', (e) => {
    if (e.target.closest?.('.mobile-controls')) return;
    canvasPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (canvasPointers.size === 2) {
      canvasLastPinchDist = getPinchDistance();
      canvasPanActive = false;
    }
  });

  canvasWrap.addEventListener('pointermove', (e) => {
    if (!game || !renderer || !canvasPointers.has(e.pointerId)) return;
    const prev = canvasPointers.get(e.pointerId);
    canvasPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (canvasPointers.size >= 2) {
      const dist = getPinchDistance();
      if (dist != null && canvasLastPinchDist != null) {
        renderer.setUserZoom((dist - canvasLastPinchDist) * 0.004);
      }
      canvasLastPinchDist = dist;
      canvasPanActive = false;
      return;
    }

    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    if (Math.hypot(dx, dy) > 6) canvasPanActive = true;
    if (canvasPanActive) {
      renderer.addUserPan(-dx / renderer.camera.zoom, -dy / renderer.camera.zoom);
    }
  });

  const endCanvasPointer = (e) => {
    canvasPointers.delete(e.pointerId);
    if (canvasPointers.size < 2) canvasLastPinchDist = null;
    if (canvasPointers.size === 0) canvasPanActive = false;
  };

  canvasWrap.addEventListener('pointerup', endCanvasPointer);
  canvasWrap.addEventListener('pointercancel', endCanvasPointer);
}

bindTap($('#btnZoomIn'), () => { if (renderer) renderer.setUserZoom(0.12); });
bindTap($('#btnZoomOut'), () => { if (renderer) renderer.setUserZoom(-0.12); });

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
    if (moved > 14 || canvasPanActive) return;
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
  aimDial?.syncFromGame();

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
initAimDial();

showScreen('entryScreen');


