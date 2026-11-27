// Turn-based mode in the browser. The server decides every throw; this replays what it reports
// (same inputs, same physics, cut at the server's step count) and shows the result.
import {
  clamp, angDiff, DT, PITCH_MIN, PITCH_MAX, HIT_POINTS, HEAVY_MAX, PACK_MS, SLOW_WINDOW, SLOW_SPEED, HOLD_MS,
  simulate, windFor, clampMove, standOk, MOVE_RADIUS,
} from '../../shared/physics.js';
import { S } from '../common/state.js';
import { $, num, safeName, safeColor, toast } from '../common/dom.js';
import { NET, api } from '../common/net.js';
import { audio, sfx } from '../common/audio.js';
import {
  THREE, camera, puff, ball, preview, ring, moveRing, moveFill, marker, markerMat, easeCamera, updateParticles, showPreview, fadeBlockingTrees,
} from '../common/scene.js';
import { addPlayer, removePlayer, animateAvatar, updateTags, followed } from '../common/players.js';
import { THROW_DURATION, THROW_RELEASE_LEFT } from '../common/avatarAnimation.js';
import { showOver, hideOver, overWinner } from '../common/over.js';
import { T, resetT, curPlayer, currentWind, canControl, canMove, hiddenFromNext } from './state.js';
import { renderHUD, refreshControls, updateReadout } from './hud.js';
import { initInput } from './input.js';

/* ---------- aiming helpers ---------- */
function faceTarget(p, idx) {
  const opp = S.players.filter((o) => o !== p); if (!opp.length) return Math.atan2(-p.x, -p.z);
  opp.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
  const t = opp[((idx % opp.length) + opp.length) % opp.length];
  return Math.atan2(t.x - p.x, t.z - p.z);
}
// Your aim stays where you left it last throw, so you can adjust from there. First throw faces the nearest friend.
function startYaw(p) { return p.lastAim ? p.lastAim.yaw : faceTarget(p, 0); }

let lastAimSent = 0;
function sendAim(force) {
  const p = curPlayer(); if (!p || !p.local || !NET.code) return;
  const now = performance.now(); if (!force && now - lastAimSent < 100) return; lastAimSent = now;
  api('aim', { yaw: +p.yaw.toFixed(3), pitch: +p.pitch.toFixed(3) }).catch(() => {});
}

/* ---------- turn flow ---------- */
function onTurnStart() {
  const p = curPlayer(); if (!p) return;
  T.charging = false; T.chargeT = 0; T.power = 0; T.targetIdx = 0;
  if (p.local) {
    T.aimYaw = p.lastAim ? p.lastAim.yaw : faceTarget(p, 0) + (Math.random() - 0.5) * 0.5;
    T.aimPitch = p.lastAim ? p.lastAim.pitch : 35 * Math.PI / 180;
    p.yaw = T.aimYaw; p.pitch = T.aimPitch;
    sendAim(true);
  }
  T.phase = 'move'; T.moveTo = { x: p.x, z: p.z };
  if (p.local && S.players.length > 1) { toast('Your turn!'); sfx.tick(); }
  renderHUD();
}

function confirmMove() {
  const p = curPlayer(); if (!canMove()) return;
  const to = clampMove(p, T.moveTo);
  const stay = Math.hypot(to.x - p.x, to.z - p.z) < 0.05;
  if (!stay && !standOk(to.x, to.z, S.map, S.players.filter((o) => o !== p))) { toast("You can't stand there", '', 1000); return; }
  audio();
  T.sending = true;
  api('move', { x: +(stay ? p.x : to.x).toFixed(3), z: +(stay ? p.z : to.z).toFixed(3) })
    .then(() => { T.phase = 'aim'; T.aimYaw = startYaw(p); sendAim(true); })
    .catch((e) => toast(e.message, '', 1600))
    .finally(() => { T.sending = false; renderHUD(); });
}

function packNow() {
  const p = curPlayer();
  if (!canControl() || T.charging || (p.heavy || 1) > 1) return;
  audio();
  T.sending = true;
  api('pack').catch((e) => toast(e.message, '', 1600)).finally(() => { T.sending = false; });
}
function showPack(p, level) {
  p.packT = PACK_MS / 1000; T.packUntil = performance.now() + PACK_MS;
  puff(p.x, 0.3, p.z, 24, 2); sfx.pack();
  toast(p.name + ' packs a heavy snowball', 'Next hit counts ×' + level, 1400);
  renderHUD();
}

function throwNow() {
  const p = curPlayer(); if (!p || T.busy) return;
  const power = T.power;
  T.charging = false;
  p.yaw = T.aimYaw; p.pitch = T.aimPitch;
  p.lastAim = { yaw: p.yaw, pitch: p.pitch, power };
  // The server decides the result and sends it to everyone, us included; we animate it when it arrives.
  T.sending = true;
  api('throw', { yaw: p.yaw, pitch: p.pitch, power })
    .catch((e) => toast(e.message, '', 1800))
    .finally(() => { T.sending = false; });
}

function startCharge() { if (canMove()) { confirmMove(); return; } if (!canControl() || T.charging) return; audio(); T.charging = true; T.chargeT = 0; T.power = 0; $('#throwBtn').classList.add('on'); }
function releaseCharge() { $('#throwBtn').classList.remove('on'); if (!T.charging) return; if (!canControl()) { T.charging = false; return; } throwNow(); }
function cancelCharge() { T.charging = false; $('#throwBtn').classList.remove('on'); }
// Tab / ◎: during the move step, stay where you are (and go on to aiming); while aiming, face the next opponent.
function nextTarget() { if (canMove()) { const p = curPlayer(); T.moveTo = { x: p.x, z: p.z }; confirmMove(); return; } if (!canControl()) return; T.targetIdx++; T.aimYaw = faceTarget(curPlayer(), T.targetIdx); }

initInput({ startCharge, releaseCharge, cancelCharge, nextTarget, packNow });

/* ---------- flights ---------- */
function startFlight(thrower, sim, hitId, part, onDone, heavy = 1) {
  const flightT = (sim.n - 1) * DT;
  T.flights.push({ thrower, sim, hitId, part: hitId ? part : null, heavy, onDone, t: 0, windup: THROW_DURATION - THROW_RELEASE_LEFT, phase: 'fly', hold: 0, slowFrom: part === 'head' && hitId ? Math.max(0, flightT - SLOW_WINDOW) : Infinity });
  T.busy = true;
  thrower.armT = THROW_DURATION;
  sfx.throw();
}

function updateFlights(dt) {
  const f = T.flights[0];
  if (!f) { ball.visible = false; return; }
  if (f.phase === 'fly') {
    // the ball leaves the hand at the release point; the flight keeps its own clock, so a thrower who left can't stall it
    if (f.windup > 0) { f.windup -= dt; ball.visible = false; return; }
    // critical-hit camera: the last stretch of a head shot plays slowed down
    const slow = f.t >= f.slowFrom;
    f.t += dt * (slow ? SLOW_SPEED : 1);
    document.body.classList.toggle('killcam', slow);
    const i = Math.min(f.sim.n - 1, Math.floor(f.t / DT));
    ball.visible = true; ball.scale.setScalar(f.heavy > 1 ? 1 + (f.heavy - 1) * 0.6 : 1);
    ball.position.set(f.sim.pts[i * 3], f.sim.pts[i * 3 + 1], f.sim.pts[i * 3 + 2]);
    if (i >= f.sim.n - 1) {
      f.phase = 'impact'; f.hold = HOLD_MS[f.part || 'miss'] / 1000;
      const e = f.sim.end; ball.visible = false;
      T.impactAt = new THREE.Vector3(e.x, e.y, e.z);
      const victim = f.hitId && S.byId.get(f.hitId);
      if (victim) {
        const pts = (HIT_POINTS[f.part] || 1) * (f.heavy || 1);
        victim.hitT = 1.2; sfx.hit();
        if (f.part === 'head') {
          puff(e.x, e.y, e.z, 90, 6); victim.hatT = 1.6; sfx.crit();
          toast('HEADSHOT!', f.thrower.name + ' nails ' + victim.name + ' · +' + pts, 1900);
        } else {
          puff(e.x, e.y, e.z, 60, 5); victim.avatar.userData.splat.visible = true;
          toast(f.thrower.name + ' got ' + victim.name + '!', '+' + pts + (victim.local ? ' · You hop to a new spot' : ''));
        }
      } else {
        puff(e.x, Math.max(e.y, 0.2), e.z, 30, 3); sfx.thud();
        if (f.thrower.local) toast(['Missed!', 'So close!', 'Splat… on the snow', 'Wide!'][Math.floor(Math.random() * 4)], '', 1000);
      }
    }
  } else {
    f.hold -= dt;
    if (f.hold <= 0) {
      T.flights.shift();
      const victim = f.hitId && S.byId.get(f.hitId);
      if (victim) victim.avatar.userData.splat.visible = false;
      T.impactAt = null; document.body.classList.remove('killcam');
      T.busy = T.flights.length > 0;
      f.onDone && f.onDone();
    }
  }
}

/* ---------- updates from the server ---------- */
function onAim(d) {
  const p = d && S.byId.get(d.id);
  if (!p || (p.local && canControl())) return;
  p.yaw = num(d.yaw, p.yaw); p.pitch = num(d.pitch, p.pitch);
}

function syncFromView(v) {
  if (S.mode !== 'turn') return;
  const ids = new Set(v.players.map((p) => p.id));
  for (const p of [...S.players]) if (!ids.has(p.id)) removePlayer(p);
  // a new throw to show?
  const th = v.lastThrow;
  const fresh = th && th.n > T.seenN;
  const ordered = [];
  for (const vp of v.players) {
    let p = S.byId.get(vp.id);
    if (!p) p = addPlayer({ id: vp.id, name: safeName(vp.name), color: safeColor(vp.color), local: vp.id === v.you && !v.watching, x: num(vp.x), z: num(vp.z) });
    p.name = safeName(vp.name); p.cpu = !!vp.cpu; p.away = !vp.online; p.heavy = clamp(Math.floor(num(vp.heavy, 1)), 1, HEAVY_MAX);
    if (!p.hold) { p.x = num(vp.x, p.x); p.z = num(vp.z, p.z); }
    // don't show points before the snowball lands
    const pending = (T.pendingHits.get(p.id) || 0) + (fresh && th.hit && th.by === p.id ? (HIT_POINTS[th.part] || 1) * clamp(Math.floor(num(th.heavy, 1)), 1, HEAVY_MAX) : 0);
    p.score = clamp(Math.floor(num(vp.score)), 0, 99) - pending;
    if (!(p.local && canControl())) { p.yaw = num(vp.yaw, p.yaw); p.pitch = num(vp.pitch, p.pitch); }
    ordered.push(p);
  }
  S.players = ordered;
  if (fresh) { T.seenN = th.n; showServerThrow(th); }
  const pk = v.lastPack;
  if (pk && typeof pk === 'object' && num(pk.n) > T.seenPack) {
    const firstSight = T.seenPack < 0;
    T.seenPack = num(pk.n);
    const pp = S.byId.get(pk.by);
    if (pp && !firstSight) showPack(pp, clamp(Math.floor(num(pk.heavy, 2)), 2, HEAVY_MAX));
  }
  T.turn = Math.floor(num(v.turn));
  if (!T.busy) T.windTurn = T.turn;
  T.nextId = typeof v.next === 'string' ? v.next : null;
  T.turnDeadline = v.turnLeft == null ? 0 : Date.now() + num(v.turnLeft);
  const ci = S.players.findIndex((p) => p.id === v.cur);
  if (!T.busy) T.cur = ci < 0 ? 0 : ci; // keep the thrower highlighted until their snowball lands
  if (!v.over && S.over) hideOver();
  if (v.over && !S.over && !T.busy) { const w = overWinner(v.over); if (w) { showOver(w, v.over.reason); renderHUD(); } }
  const key = v.round + ':' + v.turn + ':' + v.cur;
  if (!T.busy && !v.over && key !== T.turnKey) { T.turnKey = key; onTurnStart(); }
  if (!T.busy && v.phase === 'aim' && T.phase === 'move') { T.phase = 'aim'; const cp = curPlayer(); if (cp && cp.local) T.aimYaw = startYaw(cp); }
  renderHUD();
}

function showServerThrow(th) {
  const thrower = S.byId.get(th.by);
  if (!thrower) return;
  const victim = th.hit ? S.byId.get(th.hit) : null;
  if (victim && th.from) { victim.x = num(th.from.x); victim.z = num(th.from.z); victim.hold = true; }
  thrower.x = num(th.x); thrower.z = num(th.z); thrower.yaw = num(th.yaw);
  T.windTurn = Math.floor(num(th.turn));
  const part = th.part === 'head' ? 'head' : 'body';
  const heavy = clamp(Math.floor(num(th.heavy, 1)), 1, HEAVY_MAX);
  const pts = HIT_POINTS[part] * heavy;
  if (victim) T.pendingHits.set(thrower.id, (T.pendingHits.get(thrower.id) || 0) + pts);
  const sim = simulate({ x: num(th.x), z: num(th.z) }, num(th.yaw), clamp(num(th.pitch), PITCH_MIN, PITCH_MAX), clamp(num(th.power), 0, 1),
    windFor(S.seed, Math.floor(num(th.turn))), [], S.map, clamp(Math.floor(num(th.steps, 600)), 1, 1200), null, heavy);
  startFlight(thrower, sim, victim ? victim.id : null, part, () => {
    if (victim) { const left = (T.pendingHits.get(thrower.id) || 0) - pts; if (left > 0) T.pendingHits.set(thrower.id, left); else T.pendingHits.delete(thrower.id); }
    if (victim) { victim.hold = false; puff(victim.x, 1, victim.z, 30, 3); }
    if (NET.view) syncFromView(NET.view);
  }, heavy);
}

/* ---------- every frame ---------- */
let lastAimPub = 0;
function updateAim(dt) {
  const p = curPlayer();
  if (canMove()) {
    // arrows walk the marker, relative to the way the camera faces
    const f = T.held.u - T.held.d, sd = T.held.l - T.held.r;
    if (f || sd) {
      const y = T.aimYaw, sp = 4.5 * dt;
      T.moveTo = clampMove(p, { x: T.moveTo.x + (Math.sin(y) * f + Math.cos(y) * sd) * sp, z: T.moveTo.z + (Math.cos(y) * f - Math.sin(y) * sd) * sp });
    }
  } else if (canControl()) {
    T.aimYaw += (T.held.l - T.held.r) * 1.1 * dt;
    T.aimPitch = clamp(T.aimPitch + (T.held.u - T.held.d) * 0.7 * dt, PITCH_MIN, PITCH_MAX);
    if (Math.abs(angDiff(p.yaw, T.aimYaw)) > 1e-4 || Math.abs(p.pitch - T.aimPitch) > 1e-4) {
      p.yaw = T.aimYaw; p.pitch = T.aimPitch;
      const now = performance.now();
      if (now - lastAimPub > 100) { lastAimPub = now; sendAim(true); }
    }
  }
  if (T.charging) {
    T.chargeT += dt;
    const ph = (T.chargeT / 1.3) % 2; T.power = ph < 1 ? ph : 2 - ph;
  }
  updateReadout();
}

function updatePreview() {
  const p = curPlayer();
  const moving = !!(p && canMove());
  moveRing.visible = moveFill.visible = marker.visible = moving;
  if (moving) {
    moveRing.position.x = moveFill.position.x = p.x; moveRing.position.z = moveFill.position.z = p.z;
    marker.position.set(T.moveTo.x, 0, T.moveTo.z);
    const ok = Math.hypot(T.moveTo.x - p.x, T.moveTo.z - p.z) < 0.05 || standOk(T.moveTo.x, T.moveTo.z, S.map, S.players.filter((o) => o !== p));
    const hid = hiddenFromNext(T.moveTo);
    markerMat.color.set(!ok ? 0xe2434b : hid ? 0x2bb673 : 0xffc83a);
  }
  if (!p || !canControl() || moving) { preview.visible = false; return; }
  showPreview(simulate(p, T.aimYaw, T.aimPitch, T.charging ? T.power : 0.5, { x: 0, z: 0 }, [], S.map, 54));
}

function updateAvatars(dt, time) {
  const cp = curPlayer();
  for (const p of S.players) {
    const a = p.avatar;
    if (!p.init) { a.position.set(p.x, 0, p.z); p.init = true; }
    // A distant hit respawn is a relocation, not a walk across the arena during the next turn.
    if (Math.hypot(p.x - a.position.x, p.z - a.position.z) > MOVE_RADIUS + 0.5) a.position.set(p.x, 0, p.z);
    const dx = p.x - a.position.x, dz = p.z - a.position.z, dist = Math.hypot(dx, dz);
    const step = Math.min(dist, dt * 4.5);
    const vx = dist > 0.01 && dt > 0 ? dx / dist * step / dt : 0;
    const vz = dist > 0.01 && dt > 0 ? dz / dist * step / dt : 0;
    if (dist > 0.01) { a.position.x += dx / dist * step; a.position.z += dz / dist * step; }
    else { a.position.x = p.x; a.position.z = p.z; }
    a.position.y = 0;
    animateAvatar(p, dt, time, {
      yaw: (p === cp && p.local) ? T.aimYaw : p.yaw,
      speed: Math.hypot(vx, vz), vx, vz,
      arm: p === cp && T.charging ? 0.5 + T.power * 2.2 : null,
    });
  }
  if (cp) { ring.visible = true; ring.position.x = cp.avatar.position.x; ring.position.z = cp.avatar.position.z; const s = 1 + Math.sin(time * 4) * 0.08; ring.scale.set(s, s, s); }
  else ring.visible = false;
}

const want = new THREE.Vector3(), look = new THREE.Vector3(), tmpV = new THREE.Vector3();
function updateCamera(dt) {
  // spectators may follow someone else between turns; otherwise the camera is on whoever's turn it is
  const p = S.watching && !T.flights.length && !T.impactAt && S.followId ? followed() : curPlayer();
  if (!p) return;
  let k = 3;
  const f = T.flights[0];
  if (f && f.part === 'head' && (f.t >= f.slowFrom || f.phase === 'impact')) {
    // critical-hit camera: a side view of the victim, head and shoulders in frame, as the ball arrives
    const yaw = f.thrower.yaw, e = f.sim.end, v = S.byId.get(f.hitId), vx = v ? v.avatar.position.x : e.x, vz = v ? v.avatar.position.z : e.z;
    want.set(vx + Math.cos(yaw) * 3.4 - Math.sin(yaw) * 1.4, 1.75, vz - Math.sin(yaw) * 3.4 - Math.cos(yaw) * 1.4);
    look.set(vx, 1.45, vz); k = 9;
  } else if (f && f.phase === 'fly' && ball.visible) {
    const yaw = f.thrower.yaw;
    want.set(ball.position.x - Math.sin(yaw) * 7, Math.max(2.2, ball.position.y + 2.6), ball.position.z - Math.cos(yaw) * 7);
    look.copy(ball.position); k = 5;
  } else if (T.impactAt) {
    want.copy(camera.position); look.copy(T.impactAt); k = 4;
  } else {
    const yaw = p.local && p === curPlayer() ? T.aimYaw : p.yaw;
    const ax = p.avatar.position.x, az = p.avatar.position.z;
    if (canMove()) {
      want.set(ax - Math.sin(yaw) * 9, 9, az - Math.cos(yaw) * 9);
      look.set(ax + Math.sin(yaw) * 3, 0, az + Math.cos(yaw) * 3); k = 3;
    } else {
      // straight behind the thrower, so the middle of the screen is exactly where the throw goes
      want.set(ax - Math.sin(yaw) * 6.5, 3.8, az - Math.cos(yaw) * 6.5);
      look.set(ax + Math.sin(yaw) * 12, 1.2, az + Math.cos(yaw) * 12); k = 4;
    }
  }
  easeCamera(want, look, k, dt);
  fadeBlockingTrees(ball.visible ? ball.position : (T.impactAt || p.avatar.position), dt);
  // wind arrow relative to camera heading (held still while the head-shot camera swings round)
  if (document.body.classList.contains('killcam')) return;
  const w = currentWind();
  camera.getWorldDirection(tmpV);
  const rel = angDiff(Math.atan2(tmpV.x, tmpV.z), w.a);
  $('#windArrow').style.transform = 'rotate(' + (-rel * 180 / Math.PI).toFixed(1) + 'deg)';
  $('#windArrow').style.opacity = w.s < 0.05 ? 0.3 : 1;
}

let lastHud = 0;
export default {
  enter(v) {
    resetT();
    T.seenN = v.lastThrow ? v.lastThrow.n : 0;
    T.seenPack = v.lastPack ? num(v.lastPack.n) : 0; // packs from before we arrived aren't shown; every later one is
    T.windTurn = Math.floor(num(v.turn));
    $('#meter').style.visibility = '';
  },
  onView: syncFromView,
  onFollow: renderHUD,
  onEvent(name, d) { if (name === 'aim') onAim(d); },
  frame(dt, time) {
    updateAim(dt);
    updateFlights(dt);
    updatePreview();
    updateAvatars(dt, time);
    updateParticles(dt, currentWind());
    updateCamera(dt);
    // while you aim, your own name tag would sit right on the line of fire, so hide it
    updateTags(T.phase === 'aim' && !T.flights.length && !T.impactAt ? curPlayer() : null,
      (p) => p.name + ' · ' + p.score + (p.heavy > 1 ? ' · ×' + p.heavy : ''));
    const now = performance.now();
    if (now - lastHud > 250) { lastHud = now; refreshControls(); }
  },
  exit() {
    resetT();
    ball.visible = preview.visible = ring.visible = moveRing.visible = moveFill.visible = marker.visible = false;
    document.body.classList.remove('killcam');
  },
};

