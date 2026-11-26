// The round-over popup, shared by both modes.
import { S } from './state.js';
import { $ } from './dom.js';
import { NET } from './net.js';
import { sfx } from './audio.js';

export function showOver(winner) {
  if (S.over) return;
  S.over = true; sfx.win();
  $('#overTitle').textContent = winner.name + ' wins!';
  $('#overSub').textContent = [...S.players].sort((a, b) => b.score - a.score).map((p) => p.name + ' ' + p.score).join(' · ');
  const canAgain = !!(NET.view && NET.view.host === NET.id);
  $('#againBtn').hidden = !canAgain;
  if (!canAgain) $('#overSub').textContent += ' · Waiting for the host to start the next round';
  $('#over').hidden = false;
}

export function hideOver() { S.over = false; $('#over').hidden = true; }
