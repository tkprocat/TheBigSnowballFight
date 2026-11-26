// Audio: a tiny synth that starts after the first interaction.
import { lsGet, lsSet } from './dom.js';

let actx = null, muted = lsGet('sb_muted', false);
export const isMuted = () => muted;
export function toggleMute() { muted = !muted; lsSet('sb_muted', muted); return muted; }

export function audio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { actx = null; } }
  if (actx && actx.state === 'suspended') actx.resume();
  return actx;
}
function noise(dur, f0, f1, gain, q = 1) {
  if (muted) return; const a = audio(); if (!a) return;
  const len = Math.floor(a.sampleRate * dur), buf = a.createBuffer(1, len, a.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = a.createBufferSource(); src.buffer = buf;
  const bp = a.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = q; bp.frequency.setValueAtTime(f0, a.currentTime); bp.frequency.exponentialRampToValueAtTime(f1, a.currentTime + dur);
  const g = a.createGain(); g.gain.value = gain;
  src.connect(bp).connect(g).connect(a.destination); src.start();
}
function tone(f, dur, gain, type = 'sine', f1 = f) {
  if (muted) return; const a = audio(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain(); o.type = type;
  o.frequency.setValueAtTime(f, a.currentTime); o.frequency.exponentialRampToValueAtTime(f1, a.currentTime + dur);
  g.gain.setValueAtTime(gain, a.currentTime); g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
  o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + dur);
}
export const sfx = {
  throw: () => noise(0.35, 400, 2000, 0.5, 0.8),
  thud: () => { noise(0.18, 900, 200, 0.7, 0.7); },
  hit: () => { noise(0.25, 1200, 300, 0.9, 0.6); tone(520, 0.15, 0.15, 'triangle', 780); setTimeout(() => tone(780, 0.2, 0.12, 'triangle', 1040), 110); },
  win: () => [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.3, 0.15, 'triangle'), i * 140)),
  tick: () => tone(900, 0.05, 0.05, 'square'),
  pick: () => { noise(0.08, 1500, 700, 0.35, 1.5); tone(660, 0.08, 0.06, 'triangle', 990); },
  pack: () => { noise(0.25, 300, 600, 0.4, 1.2); setTimeout(() => noise(0.25, 300, 600, 0.4, 1.2), 300); setTimeout(() => noise(0.25, 300, 600, 0.4, 1.2), 600); },
  crit: () => { tone(220, 0.5, 0.2, 'sawtooth', 110); setTimeout(() => [880, 1175, 1568].forEach((f, i) => setTimeout(() => tone(f, 0.25, 0.12, 'triangle'), i * 90)), 150); },
};
