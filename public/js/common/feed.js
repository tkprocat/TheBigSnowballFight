// The hit feed in the upper left, under the scores: "● Frosty ➜ ● Blizzard  HEAD +2", so everyone can follow the
// fight. Newest on top, a few at a time, each fading out after a few seconds. Names are set as text, never HTML.
import { $ } from './dom.js';

const KEEP_MS = 6000;

// `by` and `victim` are players ({ name, color, local }); `part` is 'head' or 'body'; `pts` the points scored.
export function addFeed(by, victim, part, pts) {
  const box = $('#killFeed');
  const row = document.createElement('div');
  row.className = 'kf' + (by && by.local ? ' mine' : '') + (victim.local ? ' me' : '');
  const who = (p) => {
    const s = document.createElement('span'); s.className = 'who' + (p.local ? ' you' : '');
    const dot = document.createElement('i'); dot.style.background = p.color;
    s.append(dot, document.createTextNode(p.name));
    return s;
  };
  const arrow = document.createElement('span'); arrow.className = 'arrow'; arrow.textContent = '➜';
  const tag = document.createElement('span'); tag.className = 'kfpts' + (part === 'head' ? ' head' : ''); tag.textContent = (part === 'head' ? 'HEAD +' : '+') + pts;
  row.append(by ? who(by) : document.createTextNode('?'), arrow, who(victim), tag);
  box.prepend(row);
  const max = innerWidth < 520 ? 3 : 4;
  while (box.children.length > max) box.lastChild.remove();
  setTimeout(() => { row.classList.add('gone'); setTimeout(() => row.remove(), 500); }, KEEP_MS);
}

export function clearFeed() { $('#killFeed').textContent = ''; }
