// Lobbies, turns and throws on the server. Run with: node --test
import test from 'node:test';
import assert from 'node:assert';
process.env.BOT_DELAY_MS = '0';
const { actions, rooms, findMember, viewFor, cleanName } = await import('../server.js');
const { HIT_POINTS } = await import('../public/physics.js');

const act = (name, code, token, body = {}) => {
  const { room, member } = findMember(code, token);
  return actions[name](body, room, member);
};
function lobby(n = 2) {
  const host = actions.create({ name: 'Allan', color: '#2f7de1' });
  const others = [];
  for (let i = 1; i < n; i++) others.push(actions.join({ code: host.code, name: 'Friend ' + i }));
  return { host, others, room: rooms.get(host.code) };
}
const current = (room) => room.players[room.cur];

test('create and join by code, case-insensitive; bad codes are refused', () => {
  const { host, room } = lobby(1);
  assert.match(host.code, /^[A-Z]{4}$/);
  const j = actions.join({ code: host.code.toLowerCase(), name: 'Bo' });
  assert.strictEqual(j.code, host.code);
  assert.strictEqual(room.players.length, 2);
  assert.strictEqual(room.host.token, host.token);
  assert.throws(() => actions.join({ code: 'ZZZZ' }), /No room/);
  assert.throws(() => findMember(host.code, 'nope'), /Unknown/);
});

test('names are cleaned and colours are unique', () => {
  assert.strictEqual(cleanName('  Bo‮b\u0000  '), 'Bob');
  assert.strictEqual(cleanName('a'.repeat(40)).length, 14);
  assert.strictEqual(cleanName('   ', 'Player 2'), 'Player 2');
  const { host, room } = lobby(1);
  actions.join({ code: host.code, name: 'Copycat', color: '#2f7de1' });
  assert.notStrictEqual(room.players[1].color, room.players[0].color);
  actions.join({ code: host.code, name: 'Odd', color: 'red; background:url(x)' });
  assert.match(room.players[2].color, /^#[0-9a-f]{6}$/);
});

test('only the host can add bots and start; starting needs 2 players', () => {
  const { host, others, room } = lobby(1);
  assert.throws(() => act('start', host.code, host.token), /at least 2/);
  const friend = actions.join({ code: host.code, name: 'Bo' });
  assert.throws(() => act('addBot', host.code, friend.token), /Only the host/);
  assert.throws(() => act('start', host.code, friend.token), /Only the host/);
  act('addBot', host.code, host.token);
  assert.strictEqual(room.players.filter((p) => p.cpu).length, 1);
  act('start', host.code, host.token);
  assert.ok(room.started);
  assert.throws(() => act('addBot', host.code, host.token), /before the game starts/);
  assert.ok(others.length === 0);
});

test('throws: only on your turn, results decided by the server, turn moves on', () => {
  const { host, others, room } = lobby(3);
  act('start', host.code, host.token);
  const p = current(room);
  const notP = room.players.find((q) => q !== p);
  assert.throws(() => act('throw', host.code, notP.token, { yaw: 0, pitch: 0.5, power: 0.5 }), /not your turn/);
  assert.throws(() => act('throw', host.code, p.token, { yaw: 'x', pitch: 0.5, power: 0.5 }), /Bad throw/);
  const turn = room.turn;
  act('throw', host.code, p.token, { yaw: 1, pitch: 0.5, power: 0.4 });
  assert.strictEqual(room.turn, turn + 1);
  assert.strictEqual(room.lastThrow.by, p.id);
  assert.strictEqual(room.lastThrow.n, 1);
  assert.notStrictEqual(current(room), p);
  // the next player must wait until the snowball has landed
  assert.throws(() => act('throw', host.code, current(room).token, { yaw: 0, pitch: 0.5, power: 0.5 }), /Wait/);
  assert.ok(others.length === 2);
});

test('hits score by body part, move the victim, and reaching 10 wins the round', () => {
  const { host, room } = lobby(2);
  act('start', host.code, host.token);
  room.map = { walls: [], trees: [], deco: [] };
  const [a, b] = room.players;
  const parts = new Set();
  let guard = 0;
  while (!room.over && guard++ < 50) {
    // stand b 3 m in front of a, then find a lob that hits
    let hit = false;
    for (let pw = 0; pw <= 1 && !hit && !room.over; pw += 0.02) {
      room.cur = 0; room.busyUntil = 0; room.phase = 'aim';
      b.x = a.x; b.z = a.z + 3;
      const before = a.score;
      act('throw', host.code, a.token, { yaw: 0, pitch: 0.2 + (guard % 3) * 0.12, power: pw });
      hit = room.lastThrow.hit === b.id;
      if (hit) {
        parts.add(room.lastThrow.part);
        assert.strictEqual(a.score - before, room.lastThrow.part === 'head' ? 2 : 1);
        assert.deepStrictEqual(room.lastThrow.from, { x: a.x, z: a.z + 3 });
        assert.ok(Math.hypot(b.x - a.x, b.z - (a.z + 3)) > 0.01, 'victim moved');
      } else assert.strictEqual(room.lastThrow.part, null);
    }
  }
  assert.ok(a.score >= 10);
  assert.ok(parts.has('head') || parts.has('body'));
  assert.deepStrictEqual(room.over, { winner: a.id });
  assert.throws(() => act('throw', host.code, b.token, { yaw: 0, pitch: 0.5, power: 0.5 }), /over/);
  assert.throws(() => act('again', host.code, b.token), /Only the host/);
  act('again', host.code, host.token);
  assert.strictEqual(room.over, null);
  assert.ok(room.players.every((p) => p.score === 0));
});

test('move once per turn, inside your ring, then throw', () => {
  const { host, room } = lobby(2);
  act('start', host.code, host.token);
  room.map = { walls: [], trees: [], deco: [] };
  const p = current(room), other = room.players.find((q) => q !== p);
  other.x = p.x + 3; other.z = p.z;
  assert.strictEqual(room.phase, 'move');
  assert.throws(() => act('move', host.code, other.token, { x: 0, z: 0 }), /not your turn/);
  assert.throws(() => act('move', host.code, p.token, { x: 'a', z: 0 }), /Bad move/);
  assert.throws(() => act('move', host.code, p.token, { x: other.x, z: other.z }), /stand there/);
  const from = { x: p.x, z: p.z };
  act('move', host.code, p.token, { x: p.x - 50, z: p.z });
  assert.ok(Math.abs(Math.hypot(p.x - from.x, p.z - from.z) - 5) < 0.01, 'clamped to 5 m');
  assert.strictEqual(room.phase, 'aim');
  assert.throws(() => act('move', host.code, p.token, { x: p.x, z: p.z }), /already moved/);
  act('throw', host.code, p.token, { yaw: 0, pitch: 0.5, power: 0.3 });
  assert.strictEqual(room.phase, 'move', 'next player starts by moving');
  assert.strictEqual(viewFor(room, p).next, p.id, 'with two players, you are next after them');
});

test('packing a heavy snowball uses your turn and multiplies your next hit; getting hit drops it', () => {
  const { host, room } = lobby(2);
  act('start', host.code, host.token);
  room.map = { walls: [], trees: [], deco: [] };
  const [a, b] = room.players;
  room.cur = 0; room.busyUntil = 0;
  assert.throws(() => act('pack', host.code, b.token), /not your turn/);
  act('pack', host.code, a.token);
  assert.strictEqual(a.heavy, 2);
  assert.strictEqual(current(room), b, 'packing ends your turn');
  assert.deepStrictEqual(room.lastPack, { n: 1, by: a.id, heavy: 2 });
  room.cur = 0; room.busyUntil = 0; act('pack', host.code, a.token);
  assert.strictEqual(a.heavy, 3);
  room.cur = 0; room.busyUntil = 0;
  assert.throws(() => act('pack', host.code, a.token), /as heavy as it gets/);
  // find a hitting heavy throw: points are multiplied, and the heavy ball is used up
  let hit = false;
  for (let pw = 0; pw <= 1 && !hit; pw += 0.02) {
    room.cur = 0; room.busyUntil = 0; room.phase = 'aim'; a.heavy = 3; a.score = 0;
    b.x = a.x; b.z = a.z + 3;
    act('throw', host.code, a.token, { yaw: 0, pitch: 0.25, power: pw });
    hit = room.lastThrow.hit === b.id;
    assert.strictEqual(room.lastThrow.heavy, 3);
    assert.strictEqual(a.heavy, 1, 'used up');
    if (hit) assert.strictEqual(a.score, HIT_POINTS[room.lastThrow.part] * 3);
  }
  assert.ok(hit);
  // b had packed, then got hit: dropped
  b.heavy = 2;
  hit = false;
  for (let pw = 0; pw <= 1 && !hit; pw += 0.02) {
    room.cur = 0; room.busyUntil = 0; room.phase = 'aim';
    b.x = a.x; b.z = a.z + 3;
    act('throw', host.code, a.token, { yaw: 0, pitch: 0.25, power: pw });
    hit = room.lastThrow.hit === b.id;
  }
  assert.ok(hit);
  assert.strictEqual(b.heavy, 1, 'dropped when hit');
});

test('quick chat only sends the fixed lines and emotes, and is rate limited', () => {
  const { host, others, room } = lobby(2);
  const res = { lines: [], write(x) { this.lines.push(x); }, end() {} };
  room.players[1].clients.add(res);
  act('say', host.code, host.token, { line: 0 });
  act('say', host.code, host.token, { emote: 'dance' });
  assert.match(res.lines.join(''), /event: say\ndata: \{"id":"[0-9a-f]+","line":0\}/);
  assert.match(res.lines.join(''), /"emote":"dance"/);
  assert.throws(() => act('say', host.code, host.token, { line: 99 }), /Unknown/);
  assert.throws(() => act('say', host.code, host.token, { emote: '<script>' }), /Unknown/);
  assert.throws(() => act('say', host.code, host.token, { line: '1' }), /Unknown/);
  act('say', host.code, host.token, { line: 1 });
  act('say', host.code, host.token, { line: 2 });
  assert.throws(() => act('say', host.code, host.token, { line: 3 }), /Slow down/);
  void others;
});

test('views show positions and scores, never tokens', () => {
  const { host, room } = lobby(2);
  act('start', host.code, host.token);
  const v = viewFor(room, room.players[1]);
  assert.strictEqual(v.you, room.players[1].id);
  assert.strictEqual(v.host, room.players[0].id);
  assert.strictEqual(v.players.length, 2);
  assert.ok(!JSON.stringify(v).includes(host.token));
  assert.ok(typeof v.cur === 'string' && v.turnLeft > 0);
});

test('joining mid-game gives you a spot; leaving keeps the turn order sane', () => {
  const { host, others, room } = lobby(3);
  act('start', host.code, host.token);
  const late = actions.join({ code: host.code, name: 'Late' });
  const lp = room.players.at(-1);
  assert.ok(lp.placed && room.players.length === 4);
  const cur = current(room);
  const leaver = room.players.find((p) => p !== cur && !p.cpu);
  act('leave', host.code, leaver.token);
  assert.strictEqual(current(room), cur, 'current player unchanged when someone else leaves');
  act('leave', host.code, cur.token);
  assert.ok(current(room) && current(room) !== cur);
  void late; void others;
});

test('bots throw on their own turn; a room with no people left is removed', async () => {
  const { host, room } = lobby(1);
  act('addBot', host.code, host.token);
  act('start', host.code, host.token);
  room.cur = 0; room.busyUntil = 0;
  act('throw', host.code, host.token, { yaw: 0, pitch: 0.5, power: 0.3 });
  assert.ok(current(room).cpu, "now it is the bot's turn");
  // the bot waits for the snowball to land, walks for 0.9 s, then aims for 1.3 s before throwing (BOT_DELAY_MS=0 here)
  await new Promise((r) => setTimeout(r, 8000));
  assert.strictEqual(room.throwN, 2, 'the bot threw');
  assert.strictEqual(room.lastThrow.by, room.players[1].id);
  act('leave', host.code, host.token);
  assert.ok(!rooms.has(host.code));
});
