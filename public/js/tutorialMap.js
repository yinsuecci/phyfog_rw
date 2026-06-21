/** 教程地图：P1 你 · 友军 P2 · 敌军 P3 + 信标与练习空间 */
export const TUTORIAL_MAP = {
  version: '1.3',
  meta: { name: '新手教程', editor: 'tutorial' },
  settings: {
    gridSize: 48,
    cellSize: 28,
    initialEnergy: 280,
    visibilityRange: 12,
    playerCount: 3,
    teamCount: 2,
    teams: [
      { id: 1, name: '蓝队', color: '#3b82f6' },
      { id: 2, name: '红队', color: '#ef4444' },
    ],
    fireCooldown: 3,
    defaultHp: {
      player_tower: 100,
      attack_tower: 80,
      solar: 50,
      wall: 100,
    },
    defaultBeaconActivation: 8,
    winConditions: {
      captureAllBeacons: false,
      destroyEnemyMainTower: false,
    },
  },
  players: [
    { id: 1, teamId: 1, x: 6, y: 20, angle: 0, hp: 100, color: '#3b82f6' },
    { id: 2, teamId: 1, x: 10, y: 28, angle: 330, hp: 100, color: '#22c55e' },
    { id: 3, teamId: 2, x: 42, y: 20, angle: 180, hp: 30, color: '#ef4444' },
  ],
  elements: [
    { type: 'beacon', x: 30, y: 20, activationThreshold: 8 },
    { type: 'wall', x: 34, y: 18, hp: 40 },
    { type: 'wall', x: 34, y: 19, hp: 40 },
    { type: 'wall', x: 34, y: 20, hp: 40 },
    { type: 'wall', x: 34, y: 21, hp: 40 },
    { type: 'wall', x: 34, y: 22, hp: 40 },
    { type: 'wall', x: 22, y: 14, hp: 30 },
    { type: 'wall', x: 23, y: 14, hp: 30 },
  ],
  beacons: [{ x: 30, y: 20, activationThreshold: 8 }],
};
