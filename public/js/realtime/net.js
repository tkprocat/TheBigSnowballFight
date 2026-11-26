// Realtime syncing: apply server snapshots, smooth other players between them, and report where you are.
// The server is the authority: when it refuses a position it bumps your `fix` and you snap to its spot.
import { clamp, PITCH_MIN, PITCH_MAX } from '../../shared/physics.js';
import { INPUT_MS, CARRY_MAX } from '../../shared/realtimeRules.js';
import { S } from '../common/state.js';
import { num } from '../common/dom.js';
import { api } from '../common/net.js';
import { R, me } from './state.js';

const DELAY_MS = 110; // others are drawn this far in the past, between two snapshots

// A snapshot from the server: [id, x, z, yaw, pitch, ammo, score, fix, shield, charging] per player, loose balls.
// `events` (throw / end / pick) are handed to `onEvents`.
export function applySnapshot(snap, onEvents, onLoose) {
  if (!snap || !Array.isArray(snap.p)) return;
  const pos = new Map();
  for (const row of snap.p) {
    if (!Array.isArray(row)) continue;
    const [id, x, z, yaw, pitch, ammo, score, fix, shield, charging] = row;
    const p = S.byId.get(id);
    if (!p) continue;
    p.ammo = clamp(Math.floor(num(ammo)), 0, CARRY_MAX);
    p.score = clamp(Math.floor(num(score)), 0, 99);
    p.shield = !!shield;
    p.charging = !!charging;
    if (p.local) {
      if (fix !== R.fixSeen) { R.fixSeen = fix; p.x = num(x, p.x); p.z = num(z, p.z); p.rx = p.x; p.rz = p.z; }
    } else pos.set(id, [num(x), num(z), num(yaw), clamp(num(pitch, 0.5), PITCH_MIN, PITCH_MAX)]);
  }
  R.snaps.push({ at: performance.now(), pos });
  while (R.snaps.length > 30) R.snaps.shift();
  if (Array.isArray(snap.b)) onLoose(snap.b);
  if (Array.isArray(snap.e) && snap.e.length) onEvents(snap.e);
}

// Put everyone else where they were DELAY_MS ago, between the two snapshots around that moment.
export function interpolate(now) {
  const t = now - DELAY_MS, snaps = R.snaps;
  if (!snaps.length) return;
  let a = snaps[0], b = snaps[0];
  for (let i = snaps.length - 1; i >= 0; i--) if (snaps[i].at <= t) { a = snaps[i]; b = snaps[i + 1] || snaps[i]; break; }
  const k = b === a ? 1 : clamp((t - a.at) / (b.at - a.at), 0, 1);
  for (const p of S.players) {
    if (p.local) continue;
    const pa = a.pos.get(p.id), pb = b.pos.get(p.id) || pa;
    if (!pa || !pb) continue;
    // a jump (hit and moved, or just joined) is not smoothed
    const jump = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) > 3;
    const kk = jump ? 1 : k;
    p.x = pa[0] + (pb[0] - pa[0]) * kk; p.z = pa[1] + (pb[1] - pa[1]) * kk;
    let dy = pb[2] - pa[2]; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    p.yaw = pa[2] + dy * kk; p.pitch = pa[3] + (pb[3] - pa[3]) * kk;
  }
}

// Tell the server where you are, about 20 times a second (or right now with `force`, before a throw).
export function sendInput(force = false) {
  const p = me(); if (!p) return Promise.resolve();
  const now = performance.now();
  if (!force && (now - R.lastInput < INPUT_MS || R.inputBusy)) return Promise.resolve();
  R.lastInput = now; R.inputBusy = true;
  return api('input', { x: +p.x.toFixed(3), z: +p.z.toFixed(3), yaw: +R.yaw.toFixed(3), pitch: +R.pitch.toFixed(3), sprint: R.sprinting })
    .catch(() => {}).finally(() => { R.inputBusy = false; });
}
