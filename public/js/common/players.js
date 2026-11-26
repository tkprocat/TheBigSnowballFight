// Players in the 3D scene (both modes): avatars, name tags, speech bubbles, the score list, and the
// animation every avatar shares (throwing arm, emotes, hat popping off, hit wobble, idle bob).
import { makeMap } from '../../shared/physics.js';
import { S } from './state.js';
import { $ } from './dom.js';
import { THREE, camera, makeAvatar, disposeAvatar, buildMapMeshes } from './scene.js';
export { animateAvatar } from './avatarAnimation.js';

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

// The player the camera is on: your own, or for a spectator whoever they follow (Tab, or tap their name).
export function followed() {
  const mine = S.players.find((p) => p.local);
  if (mine) return mine;
  return S.byId.get(S.followId) || S.players[0] || null;
}
// Spectators: follow the next player (Tab).
export function followNext() {
  if (!S.players.length) return;
  const i = S.players.indexOf(followed());
  S.followId = S.players[(i + 1) % S.players.length].id;
}
const coarse = matchMedia('(pointer: coarse)');
export const watchHint = () => 'watching (' + (coarse.matches ? 'tap a name to follow' : 'Tab or click a name to follow') + ')';

// Show a quick-chat line or an emote over a player.
export function showSay(p, what, lines) {
  if (what.line != null) { p.bubble.textContent = lines[what.line]; p.bubbleUntil = performance.now() + 2800; }
  else { p.emote = what.emote; p.emoteT = 2; p.bubble.textContent = EMOTE_LABEL[what.emote].split(' ')[0]; p.bubbleUntil = performance.now() + 2000; }
}

const tmpV = new THREE.Vector3();
// Name tags and speech bubbles over heads. `hide` is a player whose tag would be in the way (your own, while aiming).
// Tags fade and shrink with distance and hide past ~40 m, except for the leader and the player the camera is on,
// and they're kept inside the screen edges, so big games stay readable.
export function updateTags(hide, label) {
  const w = innerWidth, h = innerHeight;
  const leader = S.players.reduce((a, b) => (!a || b.score > a.score ? b : a), null), on = followed();
  for (const p of S.players) {
    tmpV.set(p.avatar.position.x, p.avatar.position.y + 2.45, p.avatar.position.z);
    const d = tmpV.distanceTo(camera.position), keep = p === leader || p === on;
    tmpV.project(camera);
    const vis = S.screen === 'game' && tmpV.z < 1 && Math.abs(tmpV.x) < 1.1 && Math.abs(tmpV.y) < 1.1 && (d < 42 || keep);
    p.tag.hidden = !vis || p === hide;
    if (vis) {
      const x = Math.min(w - 60, Math.max(60, (tmpV.x + 1) / 2 * w)), y = Math.max(28, (1 - tmpV.y) / 2 * h);
      p.tag.style.left = x.toFixed(1) + 'px'; p.tag.style.top = y.toFixed(1) + 'px';
      const scale = Math.max(0.7, Math.min(1, 1.15 - d / 70)), alpha = keep ? 1 : Math.max(0.35, Math.min(1, 1.6 - d / 30));
      p.tag.style.transform = 'translate(-50%,-100%) scale(' + scale.toFixed(2) + ')'; p.tag.style.opacity = alpha.toFixed(2);
      const text = label(p);
      if (p.tagName.textContent !== text) p.tagName.textContent = text;
    }
    const showB = vis && p.bubbleUntil > performance.now();
    p.bubble.hidden = !showB;
    if (showB) { p.bubble.style.left = p.tag.style.left; p.bubble.style.top = (parseFloat(p.tag.style.top) - 30) + 'px'; }
  }
}

// The score list at the top left. `o.cur` gets the gold outline; `o.follow` (spectators) gets a blue one;
// `o.tags(p)` adds small labels after the name; `o.sorted` puts the leader first; `o.limit` shows at most that
// many rows, always including the players in `o.keep` and then the leaders. Spectators tap a row to follow.
export function renderScores(o = {}) {
  const box = $('#scoreHud'); box.textContent = '';
  let list = o.sorted ? [...S.players].sort((a, b) => b.score - a.score) : S.players;
  if (o.limit && list.length > o.limit) {
    const keep = new Set((o.keep || []).filter(Boolean));
    const byScore = [...list].sort((a, b) => b.score - a.score);
    for (const p of byScore) { if (keep.size >= o.limit) break; keep.add(p); }
    list = list.filter((p) => keep.has(p));
  }
  box.classList.toggle('pick', S.watching);
  for (const p of list) {
    const d = document.createElement('div'); d.className = 'sc' + (p === o.cur ? ' cur' : '') + (p === o.follow ? ' follow' : '');
    d.dataset.id = p.id;
    const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = p.color;
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = p.name + (p.away ? ' (away)' : '');
    const pts = document.createElement('span'); pts.className = 'pts'; pts.textContent = p.score;
    d.append(dot, nm);
    if (p.local) { const y = document.createElement('span'); y.className = 'youtag'; y.textContent = 'you'; d.appendChild(y); }
    for (const [cls, text] of (o.tags ? o.tags(p) : [])) { const t = document.createElement('span'); t.className = cls; t.textContent = text; d.appendChild(t); }
    d.append(pts); box.appendChild(d);
  }
}
