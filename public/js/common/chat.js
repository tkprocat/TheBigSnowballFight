// Quick chat: fixed lines and emotes, in the lobby and in the game, for players and spectators.
import { CHAT_LINES, EMOTES } from '../../shared/physics.js';
import { S } from './state.js';
import { $, toast, safeName, safeColor } from './dom.js';
import { NET, api } from './net.js';
import { audio, sfx } from './audio.js';
import { showSay, EMOTE_LABEL } from './players.js';

function say(what) {
  audio();
  api('say', what).catch((e) => toast(e.message, '', 1200));
}

export function onSay(d) {
  if (!d || typeof d !== 'object') return;
  const line = Number.isInteger(d.line) && d.line >= 0 && d.line < CHAT_LINES.length ? d.line : null;
  const emote = EMOTES.includes(d.emote) ? d.emote : null;
  if (line == null && !emote) return;
  const what = line != null ? { line } : { emote };
  if (S.screen === 'lobby') {
    const v = NET.view, vp = v && [...v.players, ...(v.spectators || [])].find((q) => q.id === d.id);
    const li = document.createElement('li');
    const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = safeColor(vp && vp.color);
    const t = document.createElement('span'); t.textContent = safeName(vp && vp.name) + ': ' + (line != null ? CHAT_LINES[line] : EMOTE_LABEL[emote]);
    li.append(dot, t); $('#lobbyFeed').prepend(li);
    if (d.id !== NET.id) toast(t.textContent, '', 1800, true); // the feed may be below the fold on a phone
    while ($('#lobbyFeed').children.length > 20) $('#lobbyFeed').lastChild.remove();
    return;
  }
  const p = S.byId.get(d.id);
  if (p) { showSay(p, what, CHAT_LINES); if (line != null) sfx.tick(); }
  else if (line != null) { // a spectator spoke
    const vs = NET.view && (NET.view.spectators || []).find((q) => q.id === d.id);
    toast(safeName(vs && vs.name) + ': ' + CHAT_LINES[line], '', 1800, true);
  }
}

function closePanel() { $('#chatPanel').hidden = true; $('#chatBtn').setAttribute('aria-expanded', 'false'); }

function buildChat(box, emoteBox) {
  CHAT_LINES.forEach((l, i) => { const b = document.createElement('button'); b.textContent = l; b.onclick = () => { say({ line: i }); closePanel(); }; box.appendChild(b); });
  if (emoteBox) EMOTES.forEach((e) => { const b = document.createElement('button'); b.textContent = EMOTE_LABEL[e]; b.onclick = () => { say({ emote: e }); closePanel(); }; emoteBox.appendChild(b); });
}

export function initChat() {
  buildChat($('#chatLines'), $('#chatEmotes'));
  buildChat($('#lobbyChatLines'), null);
  $('#chatBtn').onclick = () => { const open = $('#chatPanel').hidden; $('#chatPanel').hidden = !open; $('#chatBtn').setAttribute('aria-expanded', String(open)); };
}
export const toggleChat = () => $('#chatBtn').click();
