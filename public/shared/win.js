// How a round is won, shared by the server (which decides) and the browser (which shows it).
// The host picks in the lobby: first to N points, or the most points when time runs out. A tie when time runs out
// goes to sudden death: play on until one player leads on their own.
import { WIN_SCORE } from './physics.js';

export const WIN_POINTS = [5, 10, 20];
export const WIN_MINUTES = [3, 5, 10];
export const DEFAULT_WIN = Object.freeze({ type: 'points', points: WIN_SCORE });

// A clean win setting from whatever a client sent, or null if it isn't one of the choices.
export function cleanWin(w) {
  if (!w || typeof w !== 'object') return null;
  if (w.type === 'points' && WIN_POINTS.includes(w.points)) return { type: 'points', points: w.points };
  if (w.type === 'time' && WIN_MINUTES.includes(w.minutes)) return { type: 'time', minutes: w.minutes };
  return null;
}

// Short text for the setting: "First to 10" or "5 minutes".
export function describeWin(w) {
  return w && w.type === 'time' ? w.minutes + ' minutes' : 'First to ' + ((w && w.points) || WIN_SCORE);
}

// Has someone won? `endsAt` is when a timed round's clock runs out (ms, same clock as `now`).
// Returns { winner, reason: 'points' | 'time' }, { suddenDeath: true } (time's up but the lead is shared), or null.
export function checkWinner(players, win, endsAt, now) {
  if (!players.length) return null;
  if (!win || win.type !== 'time') {
    const target = (win && win.points) || WIN_SCORE;
    const w = players.find((p) => p.score >= target);
    return w ? { winner: w, reason: 'points' } : null;
  }
  if (endsAt == null || now < endsAt) return null;
  const top = Math.max(...players.map((p) => p.score));
  const leaders = players.filter((p) => p.score === top);
  return leaders.length === 1 ? { winner: leaders[0], reason: 'time' } : { suddenDeath: true };
}

// "3:07" for a number of milliseconds.
export function clockText(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}
