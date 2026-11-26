// The lobby screen: invite link, mode choice, players and bots, watching instead of playing.
import { MAX_PLAYERS } from '../../shared/physics.js';
import { S } from './state.js';
import { $, toast, safeName, safeColor } from './dom.js';
import { NET, api } from './net.js';
import { audio } from './audio.js';

const MODE_NAME = { turn: 'Turn-based', realtime: 'Realtime' };

function inviteLink(code) { return location.origin + location.pathname + '?room=' + code; }

export function showLobby(v) {
  S.screen = 'lobby';
  $('#menu').hidden = true; $('#game').hidden = true; $('#over').hidden = true; $('#lobby').hidden = false; $('#chatPanel').hidden = true;
  $('#lobbyCode').textContent = v.code;
  $('#lobbyLink').textContent = inviteLink(v.code);
  const isHost = v.host === v.you;
  const mode = v.mode === 'realtime' ? 'realtime' : 'turn';
  for (const b of document.querySelectorAll('.modeBtn')) {
    b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    b.disabled = !isHost;
  }
  // how to win: the host picks, everyone sees it
  const win = v.win || { type: 'points', points: 10 };
  for (const b of document.querySelectorAll('#winRow button')) {
    const n = Number(b.dataset.n);
    b.setAttribute('aria-pressed', String(b.dataset.type === win.type && n === (win.type === 'time' ? win.minutes : win.points)));
    b.disabled = !isHost;
  }
  // bot difficulty: the host picks, everyone sees it (only shown when there are bots)
  const level = v.botLevel || 'normal';
  for (const b of document.querySelectorAll('#winRow button'))
    b.onclick = () => {
      const n = Number(b.dataset.n);
      api('setWin', b.dataset.type === 'time' ? { type: 'time', minutes: n } : { type: 'points', points: n }).catch((e) => toast(e.message, '', 1800));
    };
  for (const b of document.querySelectorAll('#botLevelRow button')) { b.setAttribute('aria-pressed', String(b.dataset.level === level)); b.disabled = !isHost; }
  $('#botLevelRow').hidden = !v.players.some((p) => p.cpu);
  const ul = $('#lobbyList'); ul.textContent = '';
  for (const p of v.players) {
    const li = document.createElement('li');
    const d = document.createElement('span'); d.className = 'dot'; d.style.background = safeColor(p.color);
    const n = document.createElement('span'); n.textContent = safeName(p.name) + (p.id === v.you ? ' (you)' : '');
    li.append(d, n);
    if (p.id === v.host) { const c = document.createElement('span'); c.className = 'crown'; c.textContent = 'Host'; li.appendChild(c); }
    if (p.cpu) { const c = document.createElement('span'); c.className = 'tagcpu'; c.textContent = 'Computer'; li.appendChild(c); }
    else if (!p.online) { const c = document.createElement('span'); c.className = 'tagcpu'; c.textContent = 'Away'; li.appendChild(c); }
    if (isHost && p.cpu) {
      const x = document.createElement('button'); x.className = 'x'; x.textContent = '×'; x.setAttribute('aria-label', 'Remove ' + safeName(p.name));
      x.onclick = () => api('removeBot', { id: p.id }).catch((e) => toast(e.message, '', 1800));
      li.appendChild(x);
    }
    ul.appendChild(li);
  }
  const specs = v.spectators || [];
  $('#watchList').hidden = !specs.length;
  $('#watchList').textContent = specs.length ? 'Watching: ' + specs.map((s) => safeName(s.name) + (s.id === v.host ? ' (host)' : '') + (s.id === v.you ? ' (you)' : '')).join(', ') : '';
  $('#lobbyBot').hidden = $('#lobbyBot4').hidden = !isHost;
  $('#lobbyBot').disabled = $('#lobbyBot4').disabled = v.players.length >= MAX_PLAYERS;
  $('#lobbyWatch').textContent = v.watching ? 'Take a seat' : 'Watch instead';
  $('#lobbyStart').hidden = !isHost;
  $('#lobbyStart').disabled = v.players.length < 2;
  $('#lobbyNote').textContent = isHost
    ? (v.players.length < 2 ? 'Waiting for friends. Share the code, or add a computer player.' : `Everyone here? Start ${MODE_NAME[mode].toLowerCase()} when you are ready.`)
    : `${MODE_NAME[mode]}. Waiting for the host to start the game.`;
}

export function initLobby(onLeave) {
  for (const b of document.querySelectorAll('.modeBtn'))
    b.onclick = () => api('setMode', { mode: b.dataset.mode }).catch((e) => toast(e.message, '', 1800));
  $('#lobbyBot').onclick = () => api('addBot').catch((e) => toast(e.message, '', 1800));
  $('#lobbyBot4').onclick = () => api('addBot', { count: 4 }).catch((e) => toast(e.message, '', 1800));
  for (const b of document.querySelectorAll('#winRow button'))
    b.onclick = () => {
      const n = Number(b.dataset.n);
      api('setWin', b.dataset.type === 'time' ? { type: 'time', minutes: n } : { type: 'points', points: n }).catch((e) => toast(e.message, '', 1800));
    };
  for (const b of document.querySelectorAll('#botLevelRow button'))
    b.onclick = () => api('setBotLevel', { level: b.dataset.level }).catch((e) => toast(e.message, '', 1800));
  $('#lobbyWatch').onclick = () => api('spectate').catch((e) => toast(e.message, '', 1800));
  $('#lobbyStart').onclick = () => { audio(); api('start').catch((e) => toast(e.message, '', 1800)); };
  $('#lobbyLeave').onclick = onLeave;
  $('#copyLink').onclick = () => {
    const link = inviteLink(NET.code || '');
    // phones: the system share sheet (messages, chat apps); elsewhere, copy the link
    if (navigator.share && matchMedia('(pointer: coarse)').matches) { navigator.share({ title: 'The Big Snowball Fight', text: 'Join my snowball fight: lobby ' + NET.code, url: link }).catch(() => {}); return; }
    navigator.clipboard.writeText(link).then(() => toast('Invite link copied', '', 1200, true), () => {
      const r = document.createRange(); r.selectNodeContents($('#lobbyLink')); const s = getSelection(); s.removeAllRanges(); s.addRange(r);
      toast('Link selected, copy it from there', '', 1600);
    });
  };
}
