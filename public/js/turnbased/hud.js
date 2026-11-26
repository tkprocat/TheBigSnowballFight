// Turn-based HUD: scores, the turn banner and timer, wind, the pack button, the move/aim readout and power meter.
import { TURN_LIMIT, HEAVY_MULT, MOVE_RADIUS, angDiff } from '../../shared/physics.js';
import { S } from '../common/state.js';
import { $ } from '../common/dom.js';
import { NET } from '../common/net.js';
import { renderScores, followed, watchHint } from '../common/players.js';
import { T, curPlayer, nextPlayer, currentWind, canControl, canMove, hiddenFromNext } from './state.js';

export function renderHUD() {
  if (S.screen !== 'game' || S.mode !== 'turn') return;
  const cur = curPlayer(), next = nextPlayer();
  const me = S.players.find((p) => p.local);
  renderScores({
    cur, follow: S.watching ? followed() : null,
    // with lots of players: whoever's turn it is, who's next, you, then the leaders
    limit: innerWidth < 520 ? 5 : 8, keep: [cur, next, me],
    tags: (p) => [
      ...(p.heavy > 1 ? [['heavytag', '×' + p.heavy]] : []),
      ...(p === next && p !== cur ? [['nexttag', 'next']] : []),
    ],
  });
  renderTurnBanner();
  const w = currentWind();
  $('#windVal').textContent = w.s < 0.05 ? 'Calm' : Math.round(w.s * 6) + ' km/h';
  refreshControls();
}

// The bits that change by themselves over time (called a few times a second).
export function refreshControls() {
  const mine = canControl();
  $('#controls').style.opacity = mine ? 1 : 0.45;
  $('#throwBtn').disabled = !mine;
  updatePackBtn();
  $('#hint').hidden = !mine;
  $('#hint').textContent = canMove() ? 'Arrows or tap the snow to pick a spot · Space to move there · Tab to stay' : '← → aim · ↑ ↓ angle · Tab next target · hold Space to throw · H to pack a heavy snowball';
  renderTurnBanner();
}

function updatePackBtn() {
  const p = curPlayer(), lvl = p ? (p.heavy || 1) : 1;
  $('#packBtn').textContent = lvl > 1 ? 'Packed ×' + lvl : 'Pack ×' + HEAVY_MULT;
  $('#packBtn').disabled = !canControl() || T.charging || lvl > 1;
  $('#packBtn').classList.toggle('armed', lvl > 1); // your next hit counts triple
}

function renderTurnBanner() {
  const p = curPlayer(); if (!p) { $('#turnMain').textContent = ''; return; }
  let main;
  if (S.over) main = 'Round over';
  else if (T.busy) main = T.flights[0] && T.flights[0].thrower.local ? 'Your throw!' : 'Incoming!';
  else if (p.local) main = 'Your turn' + (T.phase === 'move' ? ': move' : ': throw');
  else main = p.name + (T.phase === 'move' ? ' is moving…' : ' is aiming…');
  // the turn timer sits in the main banner, and turns red for the last 10 seconds
  const left = Math.max(0, Math.ceil((T.turnDeadline - Date.now()) / 1000));
  const timing = !T.busy && !S.over && T.turnDeadline && left <= TURN_LIMIT;
  if (timing) main += ' · ' + left + 's';
  $('#turnMain').textContent = main;
  $('#turnMain').classList.toggle('hurry', !!timing && left <= 10 && p.local);
  $('#turnSub').textContent = 'Lobby ' + NET.code + (S.watching ? ' · ' + watchHint() : '');
}

// The opponent closest to where you're aiming (within about 20°), and how far away they are.
function facingOpponent(p, yaw) {
  let best = null;
  for (const o of S.players) {
    if (o === p) continue;
    const off = Math.abs(angDiff(yaw, Math.atan2(o.x - p.x, o.z - p.z)));
    if (off < 0.35 && (!best || off < best.off)) best = { p: o, off, d: Math.hypot(o.x - p.x, o.z - p.z) };
  }
  return best;
}

// The readout above the meter, every frame.
export function updateReadout() {
  const p = curPlayer();
  $('#meterFill').style.width = (T.power * 100).toFixed(1) + '%';
  const last = p && p.local ? p.lastAim : null;
  $('#meterLast').hidden = !last;
  if (last) $('#meterLast').style.left = (last.power * 100).toFixed(1) + '%';
  if (canMove()) {
    const d = Math.hypot(T.moveTo.x - p.x, T.moveTo.z - p.z);
    $('#angleTxt').textContent = (innerWidth < 520 ? '' : 'Walk ') + d.toFixed(1) + ' of ' + MOVE_RADIUS + ' m';
    const hid = hiddenFromNext(T.moveTo), n = nextPlayer();
    $('#powerTxt').textContent = hid == null ? '' : (hid ? 'Hidden from ' + n.name : n.name + ' can see you');
    $('#throwBtn').innerHTML = d < 0.05 ? 'STAY<br>HERE' : 'MOVE<br>HERE';
    $('#meter').style.visibility = 'hidden';
  } else {
    const showPitch = p ? (p.local ? T.aimPitch : p.pitch) : T.aimPitch;
    const facing = p && p.local ? facingOpponent(p, T.aimYaw) : null;
    $('#angleTxt').textContent = 'Angle ' + Math.round(showPitch * 180 / Math.PI) + '°' + (facing ? ' · ' + facing.p.name + ' ' + Math.round(facing.d) + ' m' : '');
    $('#powerTxt').textContent = 'Power ' + Math.round(T.power * 100) + '%' + (last && !T.charging ? ' (last ' + Math.round(last.power * 100) + '%)' : '');
    if ($('#throwBtn').textContent !== 'HOLDTO THROW') $('#throwBtn').innerHTML = 'HOLD<br>TO THROW';
    $('#meter').style.visibility = '';
  }
}
