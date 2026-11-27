// The admin dashboard and the anonymous statistics. Run with: node --test
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
process.env.BOT_DELAY_MS = '0';
const { actions, rooms, findMember, server } = await import('../server.js');
const { resetStats, statsSummary, openStats, closeStats, lobbyCreated } = await import('../stats.js');
const { tokenOk, liveSummary } = await import('../admin.js');

const act = (name, code, token, body = {}) => {
  const { room, member } = findMember(code, token);
  return actions[name](body, room, member);
};
const stop = (room) => { clearTimeout(room.clock); clearTimeout(room.botTimer); clearTimeout(room.endTimer); if (room.rt) clearInterval(room.rt.timer); };

// A turn-based timed round with two people and a bot, which `b` wins when the clock has run out.
function playTimedRound() {
  const host = actions.create({ name: 'Secret Name' });
  const friend = actions.join({ code: host.code, name: 'Other Name' });
  act('addBot', host.code, host.token);
  act('setWin', host.code, host.token, { type: 'time', minutes: 3 });
  act('start', host.code, host.token);
  const room = rooms.get(host.code);
  const a = room.players.find((p) => p.token === host.token), b = room.players.find((p) => p.token === friend.token);
  room.map = { walls: [], trees: [], deco: [] };
  for (const p of room.players) { p.x = 0; p.z = 0; }
  b.z = 20;
  a.score = 1; b.score = 4;
  room.endsAt = Date.now() - 1;
  room.cur = room.players.indexOf(a); room.busyUntil = 0; room.phase = 'aim';
  assert.throws(() => act('throw', host.code, host.token, { yaw: Math.PI, pitch: 0.5, power: 0.1 }), /Time/);
  assert.deepStrictEqual(room.over, { winner: b.id, reason: 'time' });
  stop(room);
  return { host, friend, room };
}

test('statistics count lobbies, started and finished games, people and bots, without names', () => {
  resetStats();
  const { host, room } = playTimedRound();
  let s = statsSummary();
  assert.strictEqual(s.lobbies, 1);
  assert.strictEqual(s.started, 1);
  assert.strictEqual(s.finished, 1);
  assert.strictEqual(s.botWins, 0);
  assert.deepStrictEqual(s.players, { 2: 1 });
  assert.strictEqual(s.modes.turn.avgHumans, 2);
  assert.strictEqual(s.modes.turn.avgBots, 1);
  assert.strictEqual(s.recent[0].how, 'time');
  assert.strictEqual(s.recent[0].winner, 'human');
  assert.strictEqual(s.days.at(-1).started, 1);

  // a rematch everyone walks away from counts as abandoned, once
  act('again', host.code, host.token);
  stop(room);
  for (const p of [...room.players]) if (!p.cpu) act('leave', host.code, p.token);
  assert.ok(!rooms.has(host.code));
  s = statsSummary();
  assert.strictEqual(s.started, 2);
  assert.strictEqual(s.rematches, 1);
  assert.strictEqual(s.abandoned, 1);
  assert.strictEqual(s.finished, 1);
  assert.strictEqual(s.recent[0].how, 'abandoned');
  assert.strictEqual(s.recent[0].humans, 2, 'the people who played, though they have all left');
  assert.strictEqual(s.recent[0].bots, 1);

  const text = JSON.stringify(s);
  assert.ok(!text.includes('Secret') && !text.includes('Other') && !text.includes(host.code), 'no names or codes');
});

test('statistics are appended to STATS_DIR/stats.jsonl and read back after a restart', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snowstats-'));
  resetStats();
  const file = openStats(dir);
  playTimedRound();
  closeStats();
  return new Promise((resolve) => setTimeout(resolve, 50)).then(() => {
    const lines = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    assert.deepStrictEqual(lines.map((l) => l.e), ['lobby', 'start', 'end']);
    assert.ok(!fs.readFileSync(file, 'utf8').includes('Name'), 'no names in the file');
    fs.appendFileSync(file, '{"t":"2026-01-01T00:00:00.000Z","e":"lob'); // a torn last line is skipped
    resetStats();
    openStats(dir);
    const s = statsSummary();
    assert.strictEqual(s.lobbies, 1);
    assert.strictEqual(s.finished, 1);
    assert.ok(s.persisted);
    // the torn line is cut off, so the next event is a line of its own and survives another restart
    lobbyCreated();
    closeStats();
    return new Promise((resolve) => setTimeout(resolve, 50));
  }).then(() => {
    assert.ok(!fs.readFileSync(file, 'utf8').includes('"e":"lob"'), 'the torn line is gone');
    resetStats();
    openStats(dir);
    assert.strictEqual(statsSummary().lobbies, 2, 'the event written after the torn line is read back');
    closeStats();
    // a complete last line that only lost its newline is kept, and gets its newline
    fs.appendFileSync(file, '{"t":"2026-01-02T00:00:00.000Z","e":"lobby"}');
    resetStats();
    openStats(dir);
    closeStats();
    assert.ok(fs.readFileSync(file, 'utf8').endsWith('"e":"lobby"}\n'));
    resetStats();
    openStats(dir);
    assert.strictEqual(statsSummary().lobbies, 3);
    closeStats();
    // a game still running when the server stopped is counted as abandoned at the next start, once
    fs.appendFileSync(file, '{"t":"2026-01-03T00:00:00.000Z","e":"start","mode":"realtime","humans":3,"bots":0}\n');
    resetStats();
    openStats(dir);
    const s2 = statsSummary();
    assert.strictEqual(s2.started, 2);
    assert.strictEqual(s2.abandoned, 1);
    assert.strictEqual(s2.modes.realtime.abandoned, 1);
    assert.strictEqual(s2.recent[0].how, 'time', 'not listed among the latest games: nothing is known about it');
    closeStats();
  }).then(() => new Promise((resolve) => setTimeout(resolve, 50))).then(() => {
    assert.ok(fs.readFileSync(file, 'utf8').includes('"restart":true'), 'written to the file');
    resetStats();
    openStats(dir);
    assert.strictEqual(statsSummary().abandoned, 1, 'not counted again on the next start');
    closeStats();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test("a rematch doesn't see the last round's deadline, and every start gets one end", () => {
  resetStats();
  const { host, friend, room } = playTimedRound();
  // down to one seat: the friend leaves and the bot goes
  act('leave', host.code, friend.token);
  act('removeBot', host.code, host.token, { id: room.players.find((p) => p.cpu).id });
  act('again', host.code, host.token);
  assert.strictEqual(room.over, null, 'the rematch is not over before it starts');
  assert.ok(room.endsAt > Date.now(), 'it has its own deadline');
  stop(room);
  act('leave', host.code, host.token);
  const s = statsSummary();
  assert.strictEqual(s.started, 2);
  assert.strictEqual(s.finished + s.abandoned, 2, 'no start left without an end');
});

test('the live summary counts rooms, people, bots and spectators', () => {
  for (const r of rooms.values()) stop(r);
  rooms.clear();
  const host = actions.create({ name: 'H' });
  actions.join({ code: host.code, name: 'F' });
  act('addBot', host.code, host.token, { count: 2 });
  const other = actions.create({ name: 'Solo' });
  act('spectate', other.code, other.token);
  const live = liveSummary();
  assert.strictEqual(live.rooms, 2);
  assert.strictEqual(live.lobbies, 2);
  assert.strictEqual(live.humans, 3);
  assert.strictEqual(live.bots, 2);
  const row = live.list.find((r) => r.code === host.code);
  assert.deepStrictEqual([row.humans, row.bots, row.spectators, row.state], [2, 2, 0, 'lobby']);
  assert.ok(!JSON.stringify(live).includes('"H"') && !JSON.stringify(live).includes(host.token));
});

test('the admin token is checked in constant time and must be set', () => {
  assert.strictEqual(tokenOk('abc', ''), false);
  assert.strictEqual(tokenOk('', 'abc'), false);
  assert.strictEqual(tokenOk('abd', 'abc'), false);
  assert.strictEqual(tokenOk('abc', 'abc'), true);
});

test('over HTTP: off without ADMIN_TOKEN, 401 with a wrong token, data with the right one', async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    delete process.env.ADMIN_TOKEN;
    assert.strictEqual((await fetch(base + '/admin')).status, 404);
    assert.strictEqual((await fetch(base + '/api/admin')).status, 404);
    process.env.ADMIN_TOKEN = 'let-me-in';
    const page = await fetch(base + '/admin');
    assert.strictEqual(page.status, 200);
    assert.match(await page.text(), /Admin token/);
    assert.strictEqual((await fetch(base + '/api/admin')).status, 401);
    assert.strictEqual((await fetch(base + '/api/admin', { headers: { Authorization: 'Bearer nope' } })).status, 401);
    const ok = await fetch(base + '/api/admin', { headers: { Authorization: 'Bearer let-me-in' } });
    assert.strictEqual(ok.status, 200);
    const d = await ok.json();
    assert.ok(d.ok && d.live && d.stats && Array.isArray(d.stats.days));
    assert.strictEqual((await fetch(base + '/api/admin', { method: 'POST', headers: { Authorization: 'Bearer let-me-in' } })).status, 405);
    for (let i = 0; i < 10; i++) await fetch(base + '/api/admin', { headers: { Authorization: 'Bearer wrong' } });
    assert.strictEqual((await fetch(base + '/api/admin', { headers: { Authorization: 'Bearer let-me-in' } })).status, 429, 'too many wrong tokens');
  } finally {
    delete process.env.ADMIN_TOKEN;
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
});
