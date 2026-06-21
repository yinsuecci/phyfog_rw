/**

 * mapFormat.js — 地图 JSON 读写格式归一化（编辑器导出 / 游戏导入）

 */



const TEAM_PALETTE = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#a855f7', '#ec4899'];



export function defaultTeams(count) {

  const n = Math.max(2, Math.min(6, count));

  return Array.from({ length: n }, (_, i) => ({

    id: i + 1,

    name: `队伍${i + 1}`,

    color: TEAM_PALETTE[i % TEAM_PALETTE.length],

  }));

}



export function normalizeMapData(raw) {

  if (!raw || typeof raw !== 'object') {

    throw new Error('文件格式无效');

  }



  const data = Array.isArray(raw) ? { elements: raw } : raw;

  const settings = { ...(data.settings || {}) };



  const gridSize = Number(settings.gridSize ?? data.gridSize ?? 100);

  if (!Number.isFinite(gridSize) || gridSize < 10 || gridSize > 500) {

    throw new Error('无效的 gridSize（需 10–500）');

  }



  const cellSize = Number(settings.cellSize ?? data.cellSize ?? 30);

  const playerCount = Math.max(

    1,

    Math.min(8, Number(settings.playerCount ?? data.playerCount ?? data.players?.length ?? 2))

  );



  const teamCount = Math.max(

    2,

    Math.min(6, Number(settings.teamCount ?? settings.teams?.length ?? 2))

  );



  let teams = Array.isArray(settings.teams) && settings.teams.length

    ? settings.teams.map((t, i) => ({

      id: Number(t.id ?? i + 1),

      name: String(t.name || `队伍${i + 1}`).slice(0, 16),

      color: t.color || TEAM_PALETTE[i % TEAM_PALETTE.length],

    }))

    : defaultTeams(teamCount);



  teams = teams.slice(0, 6).map((t, i) => ({

    id: t.id ?? i + 1,

    name: t.name || `队伍${i + 1}`,

    color: t.color || TEAM_PALETTE[i % TEAM_PALETTE.length],

  }));



  const defaultHp = {

    player_tower: Number(settings.defaultHp?.player_tower ?? data.defaultHp?.player_tower ?? 100),

    attack_tower: Number(settings.defaultHp?.attack_tower ?? data.defaultHp?.attack_tower ?? 80),

    solar: Number(settings.defaultHp?.solar ?? data.defaultHp?.solar ?? 50),

    wall: Number(settings.defaultHp?.wall ?? data.defaultHp?.wall ?? 100),

  };



  const defaultBeaconActivation = Number(

    settings.defaultBeaconActivation ?? data.defaultBeaconActivation ?? 10

  );



  const wc = settings.winConditions || data.winConditions || {};

  const winConditions = {

    captureAllBeacons: wc.captureAllBeacons !== false,

    destroyEnemyMainTower: wc.destroyEnemyMainTower !== false,

  };



  const elements = [];

  const seen = new Set();



  const pushElement = (el) => {

    if (!el?.type || el.x == null || el.y == null) return;

    const x = Number(el.x);

    const y = Number(el.y);

    if (!Number.isFinite(x) || !Number.isFinite(y)) return;

    if (x < 0 || y < 0 || x >= gridSize || y >= gridSize) return;

    const key = `${x},${y}`;

    if (seen.has(key)) return;

    seen.add(key);



    const copy = { ...el, type: el.type, x, y };

    if (copy.type === 'mirror') copy.angle = Number(copy.angle ?? 45);

    if (copy.type === 'lens') copy.focal = Number(copy.focal ?? 5);

    if ((copy.type === 'mirror' || copy.type === 'lens') && el.uvGrade) {
      copy.uvGrade = true;
    }

    if (copy.type === 'beacon' && copy.activationThreshold == null) {

      copy.activationThreshold = defaultBeaconActivation;

    }

    elements.push(copy);

  };



  (data.elements || []).forEach(pushElement);



  (data.beacons || []).forEach((b) => {

    pushElement({

      type: 'beacon',

      x: b.x,

      y: b.y,

      activationThreshold: b.activationThreshold ?? defaultBeaconActivation,

    });

  });



  const importedPlayers = Array.isArray(data.players) ? data.players : [];

  const teamById = (id) => teams.find((t) => t.id === id);



  const players = [];

  for (let i = 0; i < playerCount; i++) {

    const ip = importedPlayers[i] || {};

    const teamId = Number(ip.teamId ?? ip.team ?? teams[i % teams.length].id);

    const team = teamById(teamId);

    players.push({

      id: ip.id ?? i + 1,

      teamId,

      x: ip.x,

      y: ip.y,

      angle: ip.angle,

      hp: ip.hp,

      color: ip.color || team?.color || TEAM_PALETTE[i % TEAM_PALETTE.length],

    });

  }



  return {

    version: data.version || '1.3',

    meta: data.meta || { name: 'PhyFog Map' },

    settings: {

      gridSize,

      cellSize,

      initialEnergy: Number(settings.initialEnergy ?? data.initialEnergy ?? 100),

      visibilityRange: Number(settings.visibilityRange ?? settings.visibility ?? data.visibility ?? 5),

      playerCount,

      teamCount: teams.length,

      teams,

      defaultHp,

      defaultBeaconActivation,

      winConditions,

    },

    winConditions,

    elements,

    players,

    beacons: elements.filter((e) => e.type === 'beacon').map((b) => ({

      x: b.x,

      y: b.y,

      activationThreshold: b.activationThreshold ?? defaultBeaconActivation,

    })),

    elementDescriptions: data.elementDescriptions,

  };

}


