// Entry point: the menu, connecting to a lobby, and handing the game to the room's mode
// (../turnbased/game.js or ../realtime/game.js). Each mode module has the same shape:
//   enter(view)  a game in this mode just came on screen       onView(view)  every full room update
//   onEvent(name, data)  named events ('aim', 'rt')            frame(dt, time)  every animation frame
//   exit()  the game left the screen
import { COLORS } from '../../shared/physics.js';
import { S } from './state.js';
import { $, toast, lsGet, lsSet, safeName } from './dom.js';
import { NET, api, connect, checkServer, sessGet, leaveOnline } from './net.js';
import { audio, toggleMute, isMuted } from './audio.js';
import { canvas, orbitCamera, updateParticles, render } from './scene.js';
import { clearPlayers, setMap, followNext } from './players.js';
import { initChat, onSay, toggleChat } from './chat.js';
import { showLobby, initLobby } from './lobby.js';
import { hideOver } from './over.js';
import turn from '../turnbased/game.js';
import realtime from '../realtime/game.js';
import { R } from '../realtime/state.js';
import { T } from '../turnbased/state.js';

const MODES = { turn, realtime };
let active = null;

/* ---------- you ---------- */
const me = { name: lsGet('sb_name', ''), color: lsGet('sb_color', COLORS[0]) };
if (!me.name) me.name = 'Player ' + (1 + Math.floor(Math.random() * 99));
function saveMe() {
  me.name = safeName($('#nameIn').value || me.name);
  lsSet('sb_name', me.name); lsSet('sb_color', me.color);
}
function renderSwatches() {
  const box = $('#swatches'); box.textContent = '';
  for (const c of COLORS) {
    const b = document.createElement('button'); b.className = 'sw'; b.style.background = c; b.setAttribute('aria-label', 'Colour ' + c); b.setAttribute('aria-pressed', String(c === me.color));
    b.onclick = () => { me.color = c; saveMe(); renderSwatches(); };
    box.appendChild(b);
  }
}
$('#nameIn').value = me.name;
$('#nameIn').addEventListener('input', saveMe);
renderSwatches();

/* ---------- lobby and game ---------- */
// Someone joined or left, or the host changed (sent by the server as plain names, shown as text).
function onNotice(d) {
  if (!d || typeof d !== 'object') return;
  const parts = [];
  if (d.joined) parts.push(safeName(d.joined) + ' joined' + (d.watching ? ' to watch' : ''));
  if (d.left) parts.push(safeName(d.left) + ' left');
  if (d.host) parts.push(d.host === NET.id ? 'You are the host now' : safeName(d.hostName) + ' is the host now');
  if (parts.length) toast(parts.join(' · '), '', 2200, true);
}

const handlers = {
  view: onView,
  event(name, d) {
    if (name === 'say') onSay(d);
    else if (name === 'notice') onNotice(d);
    else if (active) active.onEvent(name, d);
  },
  lost() { showMenu(); toast('Lost the lobby', 'It may have expired. Create a new one.', 2600); },
};

async function hostLobby() {
  saveMe(); audio();
  try { connect(await api('create', { name: me.name, color: me.color }), handlers); }
  catch (e) { toast(e.message, '', 2200); }
}
async function joinLobby(code) {
  code = (code || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  if (code.length !== 4) { toast('Enter the 4-letter code', '', 1400); return; }
  saveMe(); audio();
  try { connect(await api('join', { code, name: me.name, color: me.color }), handlers); }
  catch (e) { toast(e.message, '', 2200); }
}

function onView(v) {
  S.watching = !!v.watching;
  S.win = v.win || null; S.suddenDeath = !!v.suddenDeath;
  S.timeEnds = typeof v.timeLeft === 'number' ? performance.now() + v.timeLeft : 0;
  document.body.classList.toggle('watching', S.watching);
  if (!v.started) {
    if (active) exitGame();
    showLobby(v);
    return;
  }
  const mode = Object.hasOwn(MODES, v.mode) ? v.mode : 'turn';
  if (!active || S.mode !== mode || S.seed !== v.seed) {
    if (active) exitGame();
    clearPlayers();
    setMap(v.seed, v.map === 'large' ? 'large' : 'small', mode !== 'realtime');
    S.mode = mode; S.over = false;
    document.body.dataset.mode = mode;
    showGame();
    active = MODES[mode];
    active.enter(v);
  }
  active.onView(v);
}

function exitGame() {
  if (active) active.exit();
  active = null;
  clearPlayers(); S.mode = null; hideOver();
}

function showGame() {
  S.screen = 'game';
  $('#menu').hidden = true; $('#lobby').hidden = true; $('#game').hidden = false; $('#over').hidden = true;
  canvas.focus({ preventScroll: true });
}
function showMenu() {
  if (NET.code) leaveOnline();
  exitGame();
  S.screen = 'menu'; S.watching = false; S.followId = null; document.body.classList.remove('watching');
  $('#menu').hidden = false; $('#lobby').hidden = true; $('#game').hidden = true; $('#over').hidden = true; $('#chatPanel').hidden = true; $('#gameMenu').hidden = true; $('#lobbyFeed').textContent = '';
}

initChat();
initLobby(showMenu);
$('#hostBtn').onclick = hostLobby;
$('#joinBtn').onclick = () => joinLobby($('#codeIn').value);
$('#codeIn').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinLobby($('#codeIn').value); });
// ☰ in a game asks first: a stray tap shouldn't end your game
const closeGameMenu = () => { $('#gameMenu').hidden = true; };
$('#menuBtn').onclick = () => { $('#gameMenu').hidden = false; $('#resumeBtn').focus(); };
$('#resumeBtn').onclick = closeGameMenu;
$('#leaveBtn').onclick = () => { closeGameMenu(); showMenu(); };
$('#gameMenu').addEventListener('click', (e) => { if (e.target.id === 'gameMenu') closeGameMenu(); });
$('#overMenuBtn').onclick = showMenu;
$('#againBtn').onclick = () => {
  if (active && active.lockNow) active.lockNow(); // realtime: grab the mouse while this click counts as a gesture
  api('again').catch((e) => toast(e.message, '', 1800));
};
$('#muteBtn').onclick = () => { $('#muteBtn').textContent = toggleMute() ? '🔇' : '🔊'; };
$('#muteBtn').textContent = isMuted() ? '🔇' : '🔊';

addEventListener('keydown', (e) => {
  if (S.screen !== 'game' || e.target.tagName === 'INPUT') return;
  if (e.code === 'KeyC' && !e.repeat) toggleChat();
  // spectators: Tab follows the next player
  else if (e.code === 'Tab' && S.watching) { e.preventDefault(); followNext(); }
});
// spectators: tap or click a name in the score list to follow that player
$('#scoreHud').addEventListener('click', (e) => {
  const row = e.target.closest('.sc');
  if (!S.watching || !row || !S.byId.has(row.dataset.id)) return;
  S.followId = row.dataset.id;
  if (active && active.onFollow) active.onFollow();
});

(async () => {
  const note = $('#onlineNote');
  if (!(await checkServer())) {
    note.textContent = 'This page needs the game server to play (see the README: npm start).';
    return;
  }
  note.textContent = 'Create a lobby and send friends the code or invite link. Joining works mid-game too.';
  $('#hostBtn').disabled = false; $('#joinBtn').disabled = false;
  const q = new URLSearchParams(location.search).get('room');
  if (q) {
    // came from an invite link: say so, and make Join the obvious button
    const code = q.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    $('#codeIn').value = code;
    note.textContent = "You're invited to lobby " + code + '. Pick a name and colour, then press Join.';
    $('#joinBtn').classList.add('primary'); $('#hostBtn').classList.remove('primary');
    $('#joinBtn').textContent = 'Join lobby ' + code;
  }
  const saved = sessGet();
  if (saved) connect(saved, handlers);
})();

/* ---------- main loop ---------- */
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  const time = now / 1000;
  if (active && S.screen === 'game') active.frame(dt, time);
  else { orbitCamera(time, dt); updateParticles(dt, null); }
  render();
  requestAnimationFrame(frame);
}
setMap(42);
requestAnimationFrame(frame);

// test hook for automated checks
window.__sb = { S, NET, R, T, get mode() { return active; } };
