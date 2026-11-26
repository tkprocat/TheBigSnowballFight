// Players in the 3D scene (both modes): avatars, name tags, speech bubbles, the score list, and the
// animation every avatar shares (throwing arm, emotes, hat popping off, hit wobble, idle bob).
import { makeMap, angDiff, clamp } from '../../shared/physics.js';
import { S } from './state.js';
import { $ } from './dom.js';
import { THREE, camera, makeAvatar, disposeAvatar, buildMapMeshes } from './scene.js';

const EMOTE_LABEL = { wave: '👋 Wave', dance: '🕺 Dance', cheer: '🙌 Cheer' };
export { EMOTE_LABEL };

export function addPlayer(o) {
  const p = Object.assign({ x: 0, z: 0, yaw: 0, pitch: 0.6, score: 0, heavy: 1, ammo: 0, local: false, cpu: false, hitT: 0, armT: 0, packT: 0, emote: null, emoteT: 0, init: false }, o);
  p.avatar = makeAvatar(p.color);
  const tag = document.createElement('div'); tag.className = 'ntag';
  const dot = document.createElement('i'); dot.style.background = p.color; tag.appendChild(dot);
  const sp = document.createElement('span'); tag.appendChild(sp); p.tagName = sp;
  $('#tags').appendChild(tag); p.tag = tag;
  const bub = document.createElement('div'); bub.className = 'bubble'; bub.hidden = true; $('#tags').appendChild(bub); p.bubble = bub;
  S.players.push(p); S.byId.set(p.id, p);
  return p;
}
export function removePlayer(p) { disposeAvatar(p.avatar); p.tag.remove(); p.bubble.remove(); S.byId.delete(p.id); S.players = S.players.filter((q) => q !== p); }
export function clearPlayers() { for (const p of [...S.players]) removePlayer(p); }

// `size`: 'small' (turn-based) or 'large' (realtime); `piles`: decorative snowballs behind the walls.
export function setMap(seed, size = 'small', piles = true) { S.seed = seed; S.map = makeMap(seed, size); buildMapMeshes(S.map, piles); }

// The player the camera is on: your own, or for a spectator whoever they follow (Tab cycles).
export function followed() {
  const mine = S.players.find((p) => p.local);
  if (mine) return mine;
  if (!S.players.length) return null;
  return S.players[((S.follow % S.players.length) + S.players.length) % S.players.length];
}

// Show a quick-chat line or an emote over a player.
export function showSay(p, what, lines) {
  if (what.line != null) { p.bubble.textContent = lines[what.line]; p.bubbleUntil = performance.now() + 2800; }
  else { p.emote = what.emote; p.emoteT = 2; p.bubble.textContent = EMOTE_LABEL[what.emote].split(' ')[0]; p.bubbleUntil = performance.now() + 2000; }
}

// Everything about an avatar except where it stands. `o.arm` is the throwing arm's wind-up target when charging
// (null otherwise); `o.yaw` is the way it faces; `o.speed` (m/s, optional) drives the walk cycle.
export function animateAvatar(p, dt, time, o) {
  const a = p.avatar, u = a.userData;
  a.rotation.y += angDiff(a.rotation.y, o.yaw) * Math.min(1, dt * 10);
  // walking: legs and the free arm swing in step, a little bob and lean, all fading in and out with speed
  const speed = o.speed || 0;
  p.walkK = (p.walkK || 0) + (clamp(speed / 5, 0, 1) - (p.walkK || 0)) * Math.min(1, dt * 10);
  p.walkPh = ((p.walkPh || 0) + speed * dt * 2.4) % (Math.PI * 2);
  const wk = p.walkK, swing = Math.sin(p.walkPh);
  u.legs[0].rotation.x = swing * 0.75 * wk; u.legs[1].rotation.x = -swing * 0.75 * wk;
  u.freeArm.rotation.x = swing * 0.6 * wk;
  let target = o.arm != null ? o.arm : -swing * 0.5 * wk;
  if (p.packT > 0) { p.packT -= dt; target = 0.6 + Math.sin(p.packT * 14) * 0.5; } // rolling the snowball
  if (p.emoteT > 0 && o.arm == null && !(p.armT > 0)) {
    p.emoteT -= dt;
    if (p.emote === 'wave') { target = Math.PI; u.throwArm.rotation.z = -0.25 - Math.sin(p.emoteT * 12) * 0.5; }
    else if (p.emote === 'cheer') target = Math.PI;
    if (p.emoteT <= 0) { p.emote = null; u.throwArm.rotation.z = -0.25; }
  }
  if (p.armT > 0) { p.armT -= dt; target = p.armT > 0.25 ? 2.6 : -1.5; }
  u.throwArm.rotation.x += (target - u.throwArm.rotation.x) * Math.min(1, dt * (p.armT > 0 ? 25 : 8));
  u.handBall.visible = o.hasBall !== false && !(p.armT > 0 && p.armT <= 0.25);
  u.handBall.scale.setScalar(p.heavy > 1 ? 1 + (p.heavy - 1) * 0.6 : 1);
  if (p.hatT > 0) {
    p.hatT -= dt; const k = 1.6 - p.hatT;
    u.hat.position.set(0, 1.77 + k * 3.2 - k * k * 2.6, -k * 1.4); u.hat.rotation.set(-k * 7, k * 3, 0);
    if (p.hatT <= 0) { u.hat.position.set(0, 1.77, 0); u.hat.rotation.set(0, 0, 0); }
  }
  if (p.hitT > 0) { p.hitT -= dt; u.body.rotation.x = -Math.sin(p.hitT * 9) * 0.35 * p.hitT; }
  else { u.body.rotation.x = 0; u.body.position.y = Math.sin(time * 2 + p.x) * 0.02; }
  if (p.emote === 'dance' && p.emoteT > 0) { u.body.rotation.y = Math.sin(p.emoteT * 9) * 0.6; u.body.position.y = Math.abs(Math.sin(p.emoteT * 12)) * 0.25; }
  else if (p.emote === 'cheer' && p.emoteT > 0) { u.body.position.y = Math.abs(Math.sin(p.emoteT * 8)) * 0.3; u.body.rotation.y = 0; }
  else u.body.rotation.y = 0;
  if (p.packT > 0) u.body.rotation.x = 0.35; // crouch while packing
  if (wk > 0.01 && !(p.hitT > 0)) { u.body.position.y += Math.abs(Math.cos(p.walkPh)) * 0.07 * wk; u.body.rotation.x += 0.1 * wk; }
  // see-through while protected after a hit (realtime)
  const ghost = !!p.shield && Math.sin(time * 20) > 0;
  if (a.visible === ghost) a.visible = !ghost;
}

const tmpV = new THREE.Vector3();
// Name tags and speech bubbles over heads. `hide` is a player whose tag would be in the way (your own, while aiming).
export function updateTags(hide, label) {
  const w = innerWidth, h = innerHeight;
  for (const p of S.players) {
    tmpV.set(p.avatar.position.x, p.avatar.position.y + 2.45, p.avatar.position.z).project(camera);
    const vis = S.screen === 'game' && tmpV.z < 1 && Math.abs(tmpV.x) < 1.1 && Math.abs(tmpV.y) < 1.1;
    p.tag.hidden = !vis || p === hide;
    if (vis) {
      p.tag.style.left = ((tmpV.x + 1) / 2 * w).toFixed(1) + 'px'; p.tag.style.top = ((1 - tmpV.y) / 2 * h).toFixed(1) + 'px';
      const text = label(p);
      if (p.tagName.textContent !== text) p.tagName.textContent = text;
    }
    const showB = vis && p.bubbleUntil > performance.now();
    p.bubble.hidden = !showB;
    if (showB) { p.bubble.style.left = p.tag.style.left; p.bubble.style.top = (parseFloat(p.tag.style.top) - 30) + 'px'; }
  }
}

// The score list at the top left. `o.cur` gets the gold outline; `o.tags(p)` adds small labels after the name;
// `o.sorted` puts the leader first; `o.limit` shows at most that many rows (always including `o.cur`).
export function renderScores(o = {}) {
  const box = $('#scoreHud'); box.textContent = '';
  let list = o.sorted ? [...S.players].sort((a, b) => b.score - a.score) : S.players;
  // with lots of players, show the leaders and yourself
  if (o.limit && list.length > o.limit) { const top = list.slice(0, o.limit); if (o.cur && !top.includes(o.cur)) top[o.limit - 1] = o.cur; list = top; }
  for (const p of list) {
    const d = document.createElement('div'); d.className = 'sc' + (p === o.cur ? ' cur' : '');
    const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = p.color;
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = p.name + (p.local ? ' (you)' : '') + (p.away ? ' (away)' : '');
    const pts = document.createElement('span'); pts.className = 'pts'; pts.textContent = p.score;
    d.append(dot, nm);
    for (const [cls, text] of (o.tags ? o.tags(p) : [])) { const t = document.createElement('span'); t.className = cls; t.textContent = text; d.appendChild(t); }
    d.append(pts); box.appendChild(d);
  }
}
