// Realtime mode in the browser. You run where you like (predicted here, checked by the server), aim with the
// mouse, and throw when you hold a snowball. The server decides every pickup and every hit; snowballs in the air
// are replayed here from the server's throw (no wind, same physics) and land where the server says they did.
import { clamp, DT, PITCH_MIN, PITCH_MAX, HIT_POINTS, simulate } from '../../shared/physics.js';
import { CALM, RT_SIM, THROW_POWER, THROW_COOLDOWN_MS, RUN_SPEED, SPRINT_SPEED, moveStep } from '../../shared/realtimeRules.js';
import { S } from '../common/state.js';
import { num, safeName, safeColor, toast } from '../common/dom.js';
import { api } from '../common/net.js';
import { audio, sfx } from '../common/audio.js';
import { THREE, scene, puff, preview, ring, marker, markerMat, easeCamera, fadeBlockingTrees, updateParticles, showPreview, makeBallMesh, removeMesh } from '../common/scene.js';
import { addPlayer, removePlayer, animateAvatar, updateTags, followed } from '../common/players.js';
import { showOver, hideOver } from '../common/over.js';
import { addFeed, clearFeed } from '../common/feed.js';
import { R, resetR, me, canPlay } from './state.js';
import { applySnapshot, interpolate, sendInput } from './net.js';
import { initInput, runDir, wantSprint, unlock } from './input.js';
import { renderHUD, updateReadout } from './hud.js';

/* ---------- throwing ---------- */
// Every throw goes at the same speed: you only aim (direction and angle). Click, Space or the button throws.
let nextThrow = 0;
function throwNow() {
  const p = me();
  if (!canPlay()) return;
  if (!p.ammo) { toast('No snowballs', 'Walk over one to pick it up', 1200); return; }
  if (R.sprinting) { toast("Can't throw while sprinting", 'Let go of Shift', 900); return; }
  const now = performance.now();
  if (now < nextThrow) return;
  nextThrow = now + THROW_COOLDOWN_MS + 60; // a little slack, so the server never finds it too soon
  audio();
  p.armT = 0.35;
  sendInput(true).then(() => api('throw', { yaw: R.yaw, pitch: R.pitch })).catch((e) => toast(e.message, '', 1000));
}

initInput({ throwNow });

/* ---------- snowballs ---------- */
// Loose snowballs get a gold ring on the snow, so they don't look like the piles behind the walls.
const pickRingGeo = new THREE.RingGeometry(0.32, 0.42, 28);
const pickRingMat = new THREE.MeshBasicMaterial({ color: 0xffc83a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false });
// A pile of 1-3 snowballs: one, two side by side, or two with one on top.
const PILE_SPOTS = [[], [[0, 0, 0]], [[-0.17, 0, 0], [0.17, 0, 0.04]], [[-0.17, 0, 0], [0.17, 0, 0.04], [0, 0.26, 0.02]]];
function makePile(n) {
  const g = new THREE.Group();
  for (const [x, y, z] of PILE_SPOTS[n]) { const m = makeBallMesh(1.4); m.position.set(x, y, z); g.add(m); }
  scene.add(g);
  return g;
}
function syncLoose(list) {
  const ids = new Set();
  for (const row of list) {
    if (!Array.isArray(row)) continue;
    const [id, x, z] = row, n = clamp(Math.floor(num(row[3], 1)), 1, 3); ids.add(id);
    let b = R.loose.get(id);
    if (b && b.n !== n) { removeMesh(b.mesh); b.mesh = makePile(n); b.mesh.position.set(b.x, 0.2, b.z); b.n = n; } // someone took some
    if (!b) {
      const mesh = makePile(n);
      mesh.position.set(num(x), 0.2, num(z));
      mesh.rotation.y = (id * 2.3) % 6.28;
      const ringMesh = new THREE.Mesh(pickRingGeo, pickRingMat);
      ringMesh.rotation.x = -Math.PI / 2; ringMesh.position.set(num(x), 0.04, num(z));
      ringMesh.scale.setScalar(n > 1 ? 1.25 : 1);
      scene.add(ringMesh);
      R.loose.set(id, { x: num(x), z: num(z), n, mesh, ring: ringMesh });
    }
  }
  for (const [id, b] of R.loose) if (!ids.has(id)) { removeMesh(b.mesh); removeMesh(b.ring); R.loose.delete(id); }
}

function onEvents(events) {
  for (const e of events) {
    if (!e || typeof e !== 'object') continue;
    if (e.t === 'throw') startFlight(e);
    else if (e.t === 'end') {
      const f = R.flights.get(e.n);
      if (f) f.end = e;
    } else if (e.t === 'pick') {
      const p = S.byId.get(e.by);
      if (p && p.local) sfx.pick();
    }
  }
}

function startFlight(e) {
  const thrower = S.byId.get(e.by);
  const sim = simulate({ x: num(e.x), z: num(e.z) }, num(e.yaw), clamp(num(e.pitch), PITCH_MIN, PITCH_MAX), clamp(num(e.power), 0, 1), CALM, [], S.map, 1200, null, 1, RT_SIM);
  const mesh = makeBallMesh(1); mesh.visible = false;
  R.flights.set(e.n, { sim, t: 0, mesh, thrower, end: null, wait: 0 });
  if (thrower) { if (!thrower.local) thrower.armT = 0.35; thrower.yaw = num(e.yaw, thrower.yaw); }
  sfx.throw();
}

function land(f) {
  const e = f.end, victim = e.hit ? S.byId.get(e.hit) : null;
  const x = num(e.x), y = num(e.y), z = num(e.z);
  if (victim) {
    const pts = HIT_POINTS[e.part === 'head' ? 'head' : 'body'];
    victim.hitT = 1.2; sfx.hit();
    if (victim.local) R.splatUntil = performance.now() + 1500;
    if (e.part === 'head') { puff(x, y, z, 80, 6); victim.hatT = 1.6; sfx.crit(); } else puff(x, y, z, 50, 5);
    const by = f.thrower;
    addFeed(by, victim, e.part === 'head' ? 'head' : 'body', pts); // everyone sees who hit whom
    if (by && by.local) toast(e.part === 'head' ? 'HEADSHOT!' : 'Got ' + victim.name + '!', '+' + pts, 1100);
    else if (victim.local) toast((by ? by.name : 'Someone') + ' got you!', e.part === 'head' ? 'Right on the head' : '+' + pts + ' to them', 1300);
  } else { puff(x, Math.max(y, 0.2), z, 24, 3); sfx.thud(); }
}

function updateFlights(dt) {
  for (const [n, f] of R.flights) {
    if (f.thrower && f.thrower.armT > 0.25) { f.mesh.visible = false; continue; } // still winding up
    f.t += dt;
    const last = f.end ? clamp(Math.floor(num(f.end.steps)), 1, f.sim.n - 1) : f.sim.n - 1;
    const i = Math.min(last, Math.floor(f.t / DT));
    f.mesh.visible = true;
    f.mesh.position.set(f.sim.pts[i * 3], f.sim.pts[i * 3 + 1], f.sim.pts[i * 3 + 2]);
    if (i >= last) {
      if (f.end) { land(f); removeMesh(f.mesh); R.flights.delete(n); }
      else if ((f.wait += dt) > 2) { removeMesh(f.mesh); R.flights.delete(n); } // never heard back
    }
  }
}

function clearBalls() {
  for (const b of R.loose.values()) { removeMesh(b.mesh); removeMesh(b.ring); }
  for (const f of R.flights.values()) removeMesh(f.mesh);
  R.loose.clear(); R.flights.clear();
}

/* ---------- full room updates ---------- */
function syncFromView(v) {
  const ids = new Set(v.players.map((p) => p.id));
  for (const p of [...S.players]) if (!ids.has(p.id)) removePlayer(p);
  const ordered = [];
  for (const vp of v.players) {
    let p = S.byId.get(vp.id);
    if (!p) {
      p = addPlayer({ id: vp.id, name: safeName(vp.name), color: safeColor(vp.color), local: vp.id === v.you && !v.watching, x: num(vp.x), z: num(vp.z) });
      p.rx = p.x; p.rz = p.z;
      if (p.local) { R.yaw = Math.atan2(-p.x, -p.z); } // start facing the middle
    }
    p.name = safeName(vp.name); p.cpu = !!vp.cpu; p.away = !vp.online;
    p.score = clamp(Math.floor(num(vp.score)), 0, 99);
    ordered.push(p);
  }
  S.players = ordered;
  if (v.rt) applySnapshot(v.rt, () => {}, syncLoose);
  if (!v.over && S.over) { hideOver(); clearFeed(); } // a new round starts with a clean feed
  if (v.over && !S.over) { const w = S.byId.get(v.over.winner); if (w) { unlock(); showOver(w); } }
  renderHUD(true);
}

/* ---------- every frame ---------- */
function updateMe(dt) {
  const p = me();
  if (!p) return;
  if (canPlay()) {
    // ease toward the speed you want, so starting and stopping look natural (about a quarter second)
    const { dx, dz } = runDir(), v = R.vel, k = Math.min(1, dt * 12);
    const sprint = wantSprint() && (dx || dz), top = sprint ? SPRINT_SPEED : RUN_SPEED;
    v.x += (dx * top - v.x) * k; v.z += (dz * top - v.z) * k;
    // you count as sprinting (no aiming or throwing) while Shift is held, and until you've slowed back down
    R.sprinting = !!sprint || Math.hypot(v.x, v.z) > RUN_SPEED * 1.05;
    if (Math.hypot(v.x, v.z) > 0.05) {
      const others = S.players.filter((o) => o !== p);
      const to = moveStep(p, v.x / SPRINT_SPEED, v.z / SPRINT_SPEED, dt, S.map, others, SPRINT_SPEED);
      // blocked or sliding along something: keep only the speed we actually got
      if (dt > 0) { v.x = (to.x - p.x) / dt; v.z = (to.z - p.z) / dt; }
      p.x = to.x; p.z = to.z;
    } else { v.x = v.z = 0; }
    p.yaw = R.yaw; p.pitch = R.pitch;
    sendInput();
  }
}

function updateAvatars(dt, time) {
  for (const p of S.players) {
    const a = p.avatar;
    if (!p.init) { a.position.set(p.x, 0, p.z); p.init = true; }
    const moved = Math.hypot(p.x - a.position.x, p.z - a.position.z);
    a.position.set(p.x, 0, p.z);
    animateAvatar(p, dt, time, {
      speed: dt > 0 && moved < 2 ? moved / dt : 0,
      yaw: p.local ? R.yaw : p.yaw,
      arm: p.charging ? 2.0 : null, // bots wind up before they throw
      hasBall: p.ammo > 0 || p.armT > 0,
    });
  }
  // loose snowballs bob a little so they're easy to spot
  for (const b of R.loose.values()) b.mesh.position.y = 0.2 + Math.abs(Math.sin(time * 2.5 + b.x)) * 0.12;
}

// Your aim: the arc your throw would take, and a ring where it would come down.
function updatePreview() {
  const p = me();
  if (!p || !canPlay() || !p.ammo || R.sprinting) { preview.visible = marker.visible = false; R.landsAt = null; return; }
  const sim = simulate(p, R.yaw, R.pitch, THROW_POWER, CALM, [], S.map, 1200, null, 1, RT_SIM);
  showPreview(sim, true);
  marker.visible = true;
  marker.position.set(sim.end.x, Math.max(0, sim.end.y - 0.15), sim.end.z);
  markerMat.color.set(0xffc83a);
  R.landsAt = Math.hypot(sim.end.x - p.x, sim.end.z - p.z);
}

const want = new THREE.Vector3(), look = new THREE.Vector3(), ahead = new THREE.Vector3();
const SHOULDER = 0.85; // metres the camera sits to the right of the player
function updateCamera(dt) {
  const p = followed();
  if (!p) return;
  const yaw = p.local ? R.yaw : p.yaw, pitch = p.local ? R.pitch : p.pitch;
  const ax = p.avatar.position.x, az = p.avatar.position.z;
  // over the right shoulder (so your own body doesn't hide what you aim at), tilting a little with the aim so a
  // high lob looks up. The camera and its look point shift sideways together, so the view stays parallel to the aim.
  const tilt = clamp((pitch - 0.35) * 4, -1, 3);
  const fx = Math.sin(yaw), fz = Math.cos(yaw), rx = -fz * SHOULDER, rz = fx * SHOULDER;
  want.set(ax - fx * 6 + rx, 3.7 - tilt * 0.3, az - fz * 6 + rz);
  look.set(ax + fx * 12 + rx, 1.2 + tilt, az + fz * 12 + rz);
  easeCamera(want, look, p.local ? 14 : 6, dt);
  // trees between the camera and a point a little ahead of you fade, so they don't hide you or your aim
  ahead.set(ax + fx * 7, 0, az + fz * 7);
  fadeBlockingTrees(ahead, dt);
  const s = 1 + Math.sin(performance.now() / 250) * 0.08;
  ring.visible = !!p.local; ring.position.set(ax, 0.04, az); ring.scale.set(s, s, s);
}

export default {
  enter() {
    resetR(); clearBalls(); clearFeed();
    preview.visible = marker.visible = false;
  },
  onView: syncFromView,
  onFollow() { renderHUD(true); },
  onEvent(name, d) {
    if (name !== 'rt') return;
    applySnapshot(d, onEvents, syncLoose);
    renderHUD();
  },
  frame(dt, time) {
    interpolate(performance.now());
    updateMe(dt);
    updateFlights(dt);
    updatePreview();
    updateAvatars(dt, time);
    updateParticles(dt, null);
    updateCamera(dt);
    updateTags(me(), (p) => p.name + ' · ' + p.score);
    updateReadout();
  },
  exit() {
    unlock(); clearBalls(); resetR(); clearFeed();
    preview.visible = marker.visible = ring.visible = false;
  },
};

