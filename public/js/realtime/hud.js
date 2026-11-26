// Realtime HUD: scores (leader first), your snowballs, your angle, and hints.
import { WIN_SCORE } from '../../shared/physics.js';
import { CARRY_MAX } from '../../shared/realtimeRules.js';
import { S } from '../common/state.js';
import { $ } from '../common/dom.js';
import { NET } from '../common/net.js';
import { renderScores, followed, watchHint } from '../common/players.js';
import { R, me, canPlay } from './state.js';
import { locked } from './input.js';

const finePointer = matchMedia('(hover:hover) and (pointer:fine)');
let lastKey = '';

export function renderHUD(force = false) {
  if (S.screen !== 'game' || S.mode !== 'realtime') return;
  const p = me();
  const key = S.players.map((q) => q.id + q.score + (q.away ? 'a' : '')).join() + (p ? p.ammo : '') + S.over + S.watching + S.followId;
  if (!force && key === lastKey) return;
  lastKey = key;
  renderScores({ sorted: true, cur: p, follow: S.watching ? followed() : null, limit: innerWidth < 520 ? 4 : 8, keep: [p, S.watching ? followed() : null] });
  const box = $('#ammo'); box.textContent = '';
  box.hidden = !p;
  if (p) {
    for (let i = 0; i < CARRY_MAX; i++) { const b = document.createElement('i'); if (i >= p.ammo) b.className = 'empty'; box.appendChild(b); }
    box.setAttribute('aria-label', p.ammo + ' of ' + CARRY_MAX + ' snowballs');
  }
}

// Every frame: banner, meter and hints.
export function updateReadout() {
  const p = me();
  const leader = [...S.players].sort((a, b) => b.score - a.score)[0];
  let main = '';
  if (S.over) main = 'Round over';
  else if (S.watching) main = leader ? leader.name + ' leads' : '';
  else if (p && performance.now() < (R.splatUntil || 0)) main = 'Splat!';
  else if (R.sprinting) main = 'Sprinting!';
  else if (p && p.ammo === 0) main = 'Pick up snowballs!';
  else main = 'First to ' + WIN_SCORE;
  if ($('#turnMain').textContent !== main) $('#turnMain').textContent = main;
  const sub = 'Lobby ' + NET.code + (S.watching ? ' · ' + watchHint() : '');
  if ($('#turnSub').textContent !== sub) $('#turnSub').textContent = sub;
  $('#meter').style.visibility = 'hidden';
  $('#angleTxt').textContent = 'Angle ' + Math.round(R.pitch * 180 / Math.PI) + '°';
  $('#powerTxt').textContent = p ? p.ammo + ' / ' + CARRY_MAX + ' snowballs' : '';
  const play = canPlay();
  $('#controls').style.opacity = play ? 1 : 0.45;
  $('#throwBtn').disabled = !play || !p.ammo || R.sprinting;
  if ($('#throwBtn').textContent !== 'THROW') $('#throwBtn').textContent = 'THROW';
  const needLock = play && finePointer.matches && !locked();
  $('#lockHint').hidden = !needLock;
  if (needLock) $('#lockHint').textContent = 'Click to play · WASD run · Shift sprint · mouse aims · click to throw';
  $('#hint').hidden = !play || !finePointer.matches || needLock;
  $('#hint').textContent = 'WASD run · Shift sprint (no throwing) · mouse aims (up and down for distance) · click or Space to throw · walk over snowballs to pick them up · Esc frees the mouse';
}
