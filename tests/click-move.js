/**
 * Click-to-move checks for GameEngine. Uses a fake canvas so npm test
 * can run without a browser. Drawing is a no-op; movement and hit tests are real.
 */
function mockCtx() {
  const grad = () => ({ addColorStop() {} });
  const fn = () => {};
  return new Proxy(
    {
      measureText: () => ({ width: 24 }),
      createLinearGradient: grad,
      createRadialGradient: grad,
    },
    {
      get(target, prop) {
        if (prop in target) return target[prop];
        if (prop === 'canvas') return {};
        return fn;
      },
      set(target, prop, value) {
        target[prop] = value;
        return true;
      },
    }
  );
}

function mockCanvas() {
  return {
    width: 400,
    height: 300,
    style: {},
    getContext: () => mockCtx(),
    addEventListener() {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 300 }),
  };
}

function miniCase() {
  return {
    hostNpc: { id: 'host', name: '主持人', sprite: 'daisy' },
    suspects: [],
    maps: [
      {
        id: 'room',
        name: '测试间',
        width: 400,
        height: 300,
        theme: 'hq',
        spawn: { x: 50, y: 80 },
        walls: [{ x: 0, y: 180, w: 400, h: 30 }],
        doors: [{ id: 'out', x: 360, y: 70, w: 30, h: 40, label: '出门', targetMap: 'room', targetX: 50, targetY: 40 }],
        zones: [],
        items: [{ id: 'clue', x: 300, y: 40, w: 40, h: 40, name: '线索' }],
        npcs: [{ id: 'host', x: 80, y: 50 }],
      },
    ],
  };
}

function run(record) {
  const GameEngine = require('../public/js/game-engine');
  const canvas = mockCanvas();
  const hits = [];
  const engine = new GameEngine(canvas, {
    onInteract: (near) => hits.push(near && near.type),
    onPrompt: () => {},
  });
  engine.loadCase(miniCase(), { evidence: [], viewed: [], interviewed: [] }, 1);

  const startX = engine.player.x;
  engine.keys = { d: true, arrowright: true };
  engine.step(0.2);
  record('move-1', 'keyboard no longer moves the detective', engine.player.x === startX && !engine.dest, String(engine.player.x));

  engine.handlePointer(220, 80);
  record('move-2', 'floor click sets a walk target', !!(engine.dest && Math.abs(engine.dest.x - 220) < 1 && engine.pending == null), JSON.stringify(engine.dest));
  for (let i = 0; i < 40; i++) engine.step(0.05);
  record('move-3', 'detective walks toward the clicked floor point', engine.player.x > 150, String(Math.round(engine.player.x)));

  engine.player.x = 50;
  engine.player.y = 100;
  engine.dest = null;
  engine.pending = null;
  hits.length = 0;
  engine.handlePointer(50, 260);
  for (let i = 0; i < 50; i++) engine.step(0.05);
  record(
    'move-4',
    'walk stops at a wall instead of passing through',
    engine.player.y < 180 && engine.player.y > 120 && engine.player.x === 50,
    `x=${engine.player.x} y=${Math.round(engine.player.y)}`
  );

  engine.player.x = 270;
  engine.player.y = 60;
  engine.dest = null;
  engine.pending = null;
  hits.length = 0;
  engine.handlePointer(320, 60);
  record(
    'move-5',
    'clicking a clue already in range opens it immediately',
    hits[0] === 'item' && engine.pending == null,
    hits.join(',')
  );

  engine.player.x = 50;
  engine.player.y = 60;
  engine.dest = null;
  engine.pending = null;
  hits.length = 0;
  engine.handlePointer(320, 60);
  record('move-6', 'clicking a distant clue starts a walk toward it', engine.pending && engine.pending.id === 'clue' && engine.dest, engine.pending && engine.pending.id);
  for (let i = 0; i < 80 && !hits.length; i++) engine.step(0.05);
  record('move-7', 'walking up to a clue then opens it', hits[0] === 'item', hits.join(',') || `x=${Math.round(engine.player.x)}`);

  engine.player.x = 70;
  engine.player.y = 50;
  engine.dest = null;
  engine.pending = null;
  hits.length = 0;
  engine.handlePointer(80, 36);
  record('move-8', 'clicking the host in range opens the host', hits[0] === 'host', hits.join(','));
}

module.exports = { run };
