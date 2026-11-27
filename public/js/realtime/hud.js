// Realtime HUD: scores (leader first), your snowballs, your angle, and hints.
import { CARRY_MAX, PICKUP_R } from '../../shared/realtimeRules.js';
import { THREE, camera } from '../common/scene.js';
import { S } from '../common/state.js';
import { $, toast } from '../common/dom.js';
import { NET } from '../common/net.js';
import { renderScores, followed, watchHint } from '../common/players.js';
import { roundGoal } from '../common/clock.js';
import { R, me, canPlay } from './state.js';
import { locked, lockFailed } from './input.js';

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
  if (p) {
    for (let i = 0; i < CARRY_MAX; i++) { const b = document.createElement('i'); if (i >= p.ammo) b.className = 'empty'; box.appendChild(b); }
    box.setAttribute('aria-label', p.ammo + ' of ' + CARRY_MAX + ' snowballs');
  }
}

// Every frame: your snowballs float above your head (placeAmmo hides them when you're off screen or not playing).
// Walking onto a pile while you already carry CARRY_MAX flashes them gold, once per pile, so you know why nothing
// was picked up.
const head = new THREE.Vector3();
let onPile = null, flashOff = 0;
export function placeAmmo() {
  const box = $('#ammo'), p = me();
  let show = !!p && p.avatar && S.screen === 'game';
  if (show) {
    const a = p.avatar.position;
    head.set(a.x, a.y + 2.3, a.z).project(camera);
    show = head.z < 1 && Math.abs(head.x) < 1 && Math.abs(head.y) < 1;
    if (show) {
      box.style.left = ((head.x + 1) / 2 * innerWidth).toFixed(1) + 'px';
      box.style.top = ((1 - head.y) / 2 * innerHeight).toFixed(1) + 'px';
    }
    // the pile you're standing on (the client's own position, so the flash comes right away)
    let pile = null;
    for (const [id, b] of R.loose) if (Math.hypot(b.x - a.x, b.z - a.z) < PICKUP_R) { pile = id; break; }
    if (pile !== null && pile !== onPile && p.ammo >= CARRY_MAX) {
      box.classList.remove('full'); void box.offsetWidth; box.classList.add('full'); // restart the flash
      clearTimeout(flashOff); flashOff = setTimeout(() => box.classList.remove('full'), 700);
    }
    onPile = pile;
  }
  if (box.hidden === show) box.hidden = !show;
}

// Every frame: banner, meter and hints.
export function updateReadout() {
  const p = me();
  const leader = [...S.players].sort((a, b) => b.score - a.score)[0];
  let main = '';
  if (S.over) main = 'Round over';
  else if (S.watching) main = leader ? leader.name + ' leads' : '';
  else if (performance.now() < (R.goUntil || 0)) main = 'Get ready…';
  else if (p && performance.now() < (R.splatUntil || 0)) main = 'Splat!';
  else if (R.sprinting) main = 'Sprinting!';
  else if (p && p.ammo === 0) main = 'Pick up snowballs!';
  else main = roundGoal().text;
  if ($('#turnMain').textContent !== main) $('#turnMain').textContent = main;
  $('#turnMain').classList.toggle('hurry', !S.over && roundGoal().hurry);
  // the clock stays in view even while the banner says something else
  // The lobby code, then the clock (or sudden death), then the spectator hint, as separate pieces: on phones only
  // the lobby code is hidden, so the clock stays in view whatever the banner says.
  const goal = roundGoal(), timed = S.win && S.win.type === 'time';
  const parts = [['code', 'Lobby ' + NET.code]];
  if (timed && main !== goal.text) parts.push(['goal', goal.text]);
  if (S.watching) parts.push(['hint', watchHint()]);
  const key = parts.map((p) => p[1]).join('|');
  if ($('#turnSub').dataset.key !== key) {
    const sub = $('#turnSub'); sub.textContent = ''; sub.dataset.key = key;
    for (const [cls, text] of parts) { const s = document.createElement('span'); s.className = 'sub-' + cls; s.textContent = text; sub.appendChild(s); } // the ' · ' between them is CSS
  }
  $('#turnSub').classList.toggle('hurry', timed && !S.over && goal.hurry);
  $('#meter').style.visibility = 'hidden';
  $('#angleTxt').textContent = 'Angle ' + Math.round(R.pitch * 180 / Math.PI) + '°';
  $('#powerTxt').textContent = p ? p.ammo + ' / ' + CARRY_MAX + ' snowballs' + (R.landsAt != null ? ' · lands ' + Math.round(R.landsAt) + ' m' : '') : '';
  const play = canPlay();
  $('#controls').style.opacity = play ? 1 : 0.45;
  $('#throwBtn').disabled = !play || !p.ammo || R.sprinting;
  if ($('#throwBtn').textContent !== 'THROW') { $('#throwBtn').textContent = 'THROW'; $('#throwBtn').setAttribute('aria-label', 'Throw'); }
  // the start countdown: 3, 2, 1, GO!
  const goLeft = (R.goUntil || 0) - performance.now();
  const count = goLeft > 0 ? Math.ceil(goLeft / 1000) : (goLeft > -700 ? 0 : null);
  if (count !== R.lastCount) { R.lastCount = count; if (count != null) toast(count > 0 ? String(count) : 'GO!', count > 0 ? 'Get ready: pick up snowballs at GO' : '', count > 0 ? 1100 : 800); }
  const needLock = play && finePointer.matches && !locked();
  $('#lockHint').hidden = !needLock;
  if (needLock) $('#lockHint').textContent = lockFailed
    ? 'Mouse lock unavailable: drag to aim · click to throw · WASD run (click again to retry the lock)'
    : 'Click to play · WASD run · Shift sprint · mouse aims · click to throw';
  $('#hint').hidden = !play || !finePointer.matches || needLock;
  $('#hint').textContent = 'WASD run · Shift sprint (no throwing) · mouse aims (up and down for distance) · click or Space to throw · walk over snowballs to pick them up · Esc frees the mouse';
}
