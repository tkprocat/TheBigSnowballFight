// Anonymous statistics: lobbies made, games started and how they ended, how many people and bots played, how long.
// No names, codes, tokens or addresses are ever recorded, only counts and times.
// With STATS_DIR set, every event is appended as one JSON line to STATS_DIR/stats.jsonl and read back at startup,
// so the totals survive restarts (the Docker image sets STATS_DIR=/data: mount a volume there). Without it, the
// totals live in memory only.
//   {"t":"2026-11-27T13:00:00.000Z","e":"lobby"}
//   {"t":…,"e":"start","mode":"turn","humans":2,"bots":1,"spectators":0,"win":"points","rematch":false}
//   {"t":…,"e":"end","mode":"turn","humans":2,"bots":1,"ms":184000,"how":"points","winner":"human"}
// `how` is "points", "time" or "abandoned" (everyone left, or the room was forgotten mid-game; winner is null).
import fs from 'node:fs';
import path from 'node:path';

const DAYS = 30; // per-day counts kept for the dashboard
const RECENT = 50; // finished games listed on the dashboard

let totals, stream = null, file = null;

function emptyMode() { return { started: 0, finished: 0, abandoned: 0, ms: 0, humans: 0, bots: 0 }; }

// Start again with nothing counted (tests use it too).
export function resetStats() {
  totals = {
    since: null, lobbies: 0, started: 0, rematches: 0, finished: 0, abandoned: 0, botWins: 0,
    modes: {}, // mode -> emptyMode()
    players: {}, // people in a started game -> how many games
    days: {}, // 'YYYY-MM-DD' -> { lobbies, started, finished, abandoned, humans }
    recent: [], // the last finished or abandoned games, newest first
  };
}
resetStats();

const day = (t) => String(t).slice(0, 10);
const num = (v) => (Number.isFinite(v) && v >= 0 ? Math.round(v) : 0);

// Count one event. The same code counts live events and the lines read back from the file.
function apply(ev) {
  if (!ev || typeof ev.t !== 'string') return;
  if (!totals.since) totals.since = ev.t;
  const d = (totals.days[day(ev.t)] ||= { lobbies: 0, started: 0, finished: 0, abandoned: 0, humans: 0 });
  if (ev.e === 'lobby') { totals.lobbies++; d.lobbies++; return; }
  const m = (totals.modes[String(ev.mode)] ||= emptyMode());
  if (ev.e === 'start') {
    totals.started++; d.started++; m.started++;
    if (ev.rematch) totals.rematches++;
    const h = num(ev.humans);
    totals.players[h] = (totals.players[h] || 0) + 1;
    d.humans += h;
  } else if (ev.e === 'end') {
    const abandoned = ev.how === 'abandoned';
    if (abandoned) { totals.abandoned++; d.abandoned++; m.abandoned++; }
    else {
      totals.finished++; d.finished++; m.finished++;
      m.ms += num(ev.ms); m.humans += num(ev.humans); m.bots += num(ev.bots);
      if (ev.winner === 'bot') totals.botWins++;
    }
    totals.recent.unshift({ t: ev.t, mode: ev.mode, humans: num(ev.humans), bots: num(ev.bots), ms: num(ev.ms), how: ev.how, winner: ev.winner ?? null });
    if (totals.recent.length > RECENT) totals.recent.length = RECENT;
  }
}

function record(ev) {
  ev = { t: new Date().toISOString(), ...ev };
  apply(ev);
  if (stream) stream.write(JSON.stringify(ev) + '\n');
}

// Read what's already in STATS_DIR/stats.jsonl, then keep appending to it. Called once by server.js at startup.
export function openStats(dir = process.env.STATS_DIR) {
  if (!dir) return null;
  file = path.join(dir, 'stats.jsonl');
  try {
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(file)) {
      const buf = fs.readFileSync(file);
      for (const line of buf.toString('utf8').split('\n')) {
        if (!line) continue;
        try { apply(JSON.parse(line)); } catch { /* a half-written last line: skip it */ }
      }
      // The file must end with a newline before we append, or the next event would be glued onto the last line.
      // A complete last line just gets its newline; a half-written one is cut off.
      if (buf.length && buf[buf.length - 1] !== 0x0a) {
        const start = buf.lastIndexOf(0x0a) + 1;
        let whole = false;
        try { JSON.parse(buf.subarray(start).toString('utf8')); whole = true; } catch {}
        if (whole) fs.appendFileSync(file, '\n');
        else fs.truncateSync(file, start);
      }
    }
    stream = fs.createWriteStream(file, { flags: 'a' });
    stream.on('error', (e) => { console.error('Stats file:', e.message); stream = null; });
  } catch (e) {
    console.error(`Stats: can't use ${file} (${e.message}); keeping them in memory only`);
    stream = null;
  }
  return file;
}

export function closeStats() { if (stream) stream.end(); stream = null; file = null; }

const count = (room) => {
  const humans = room.players.filter((p) => !p.cpu).length;
  return { humans, bots: room.players.length - humans };
};

export function lobbyCreated() { record({ e: 'lobby' }); }

// A round starts: the first game in a lobby, or a rematch.
export function roundStarted(room, rematch = false) {
  room.roundStartedAt = Date.now();
  record({ e: 'start', mode: room.mode, ...count(room), spectators: room.spectators.length, win: room.win?.type || 'points', rematch });
}

// A round ends with a winner, or `abandoned` when the room goes away mid-round. Counted once per round.
export function roundEnded(room, abandoned = false) {
  if (!room.roundStartedAt) return;
  const winner = abandoned ? null : room.players.find((p) => room.over && p.id === room.over.winner);
  record({
    e: 'end', mode: room.mode, ...count(room), ms: Date.now() - room.roundStartedAt,
    how: abandoned ? 'abandoned' : room.over?.reason || 'points',
    winner: winner ? (winner.cpu ? 'bot' : 'human') : null,
  });
  room.roundStartedAt = null;
}

// What the dashboard shows: totals, per mode averages, the last DAYS days and the latest games.
export function statsSummary() {
  const days = [];
  const today = new Date();
  for (let i = DAYS - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 864e5).toISOString().slice(0, 10);
    days.push({ day: d, ...(totals.days[d] || { lobbies: 0, started: 0, finished: 0, abandoned: 0, humans: 0 }) });
  }
  const modes = {};
  for (const [name, m] of Object.entries(totals.modes))
    modes[name] = {
      started: m.started, finished: m.finished, abandoned: m.abandoned,
      avgMs: m.finished ? Math.round(m.ms / m.finished) : null,
      avgHumans: m.finished ? +(m.humans / m.finished).toFixed(1) : null,
      avgBots: m.finished ? +(m.bots / m.finished).toFixed(1) : null,
    };
  return {
    persisted: !!stream, since: totals.since,
    lobbies: totals.lobbies, started: totals.started, rematches: totals.rematches,
    finished: totals.finished, abandoned: totals.abandoned, botWins: totals.botWins,
    modes, players: totals.players, days, recent: totals.recent,
  };
}
