// Realtime input. Desktop: click the view to lock the mouse, WASD to run (hold Shift to sprint), the mouse to aim,
// click (or Space) to throw (Esc frees the mouse). Touch: the stick bottom left to run (push it to the edge to
// sprint), drag the view to aim, tap the big button to throw. Every handler is ignored in turn-based mode.
import { clamp, PITCH_MIN, PITCH_MAX } from '../../shared/physics.js';
import { S } from '../common/state.js';
import { $ } from '../common/dom.js';
import { canvas } from '../common/scene.js';
import { R, canPlay } from './state.js';

const on = () => S.screen === 'game' && S.mode === 'realtime';
const KEYS = { KeyW: 'f', ArrowUp: 'f', KeyS: 'b', ArrowDown: 'b', KeyA: 'l', ArrowLeft: 'l', KeyD: 'r', ArrowRight: 'r', ShiftLeft: 'sprint', ShiftRight: 'sprint' };
export const locked = () => document.pointerLockElement === canvas;
export function unlock() { if (locked()) document.exitPointerLock(); }

// Ask for the mouse lock. The canvas gets focus first (a request from an unfocused page can fail with
// "WrongDocumentError"), and a refused request is caught: after a failure, mouse play falls back to dragging to aim
// and clicking to throw, and the next click tries the lock again.
export let lockFailed = false;
const fine = matchMedia('(hover:hover) and (pointer:fine)');
export function requestLock() {
  // only a seated player in a realtime game: spectators (a watching host too) keep their cursor for names and menus
  if (!fine.matches || locked() || S.watching || S.mode !== 'realtime' || !S.players.some((p) => p.local)) return;
  try { window.focus(); canvas.focus({ preventScroll: true }); } catch {}
  const fail = () => { lockFailed = true; };
  try { const r = canvas.requestPointerLock(); if (r && typeof r.catch === 'function') r.catch(fail); } catch { fail(); }
}
document.addEventListener('pointerlockerror', () => { lockFailed = true; });
document.addEventListener('pointerlockchange', () => { if (locked()) lockFailed = false; });

function turn(dx, dy, k) {
  R.yaw -= dx * k;
  if (!R.sprinting) R.pitch = clamp(R.pitch - dy * k * 0.8, PITCH_MIN, PITCH_MAX); // sprinting: steer only, no aiming
}

// `act` is the game's actions: { throwNow }.
export function initInput(act) {
  addEventListener('keydown', (e) => {
    if (!on() || e.target.tagName === 'INPUT') return;
    if (KEYS[e.code]) { R.keys[KEYS[e.code]] = 1; e.preventDefault(); }
    else if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) act.throwNow(); }
  });
  addEventListener('keyup', (e) => {
    if (!on()) return;
    if (KEYS[e.code]) R.keys[KEYS[e.code]] = 0;
  });
  addEventListener('blur', () => { R.keys = { f: 0, b: 0, l: 0, r: 0, sprint: 0 }; });

  // mouse: lock on click, then move to aim and click to throw
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (!on() || !canPlay()) return;
    if (e.pointerType === 'mouse') {
      if (locked()) { if (e.button === 0) act.throwNow(); return; }
      requestLock();
      // no lock (yet): drag to aim; a click that doesn't drag throws once the lock has failed before
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, mouse: true };
      try { canvas.setPointerCapture(e.pointerId); } catch { /* a lock request in progress can refuse capture */ }
      return;
    }
    // touch: drag to aim
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!on()) return;
    if (locked()) { turn(e.movementX, e.movementY, 0.0025); return; }
    if (drag && e.pointerId === drag.id) { turn(e.clientX - drag.x, e.clientY - drag.y, 0.006); drag.x = e.clientX; drag.y = e.clientY; }
  });
  canvas.addEventListener('pointerup', (e) => {
    if (!on()) return;
    if (drag && e.pointerId === drag.id) {
      if (drag.mouse && lockFailed && !locked() && e.button === 0 && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) act.throwNow();
      drag = null;
    }
  });
  canvas.addEventListener('pointercancel', () => { drag = null; });

  // touch stick
  const stick = $('#stick'), knob = $('#stickKnob');
  let sp = null;
  const setStick = (e) => {
    const r = stick.getBoundingClientRect(), rad = r.width / 2;
    let x = (e.clientX - r.left - rad) / rad, y = (e.clientY - r.top - rad) / rad;
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    R.stick = { x, y };
    knob.style.transform = `translate(${(x * rad * 0.6).toFixed(1)}px,${(y * rad * 0.6).toFixed(1)}px)`;
  };
  const stickOff = () => { sp = null; R.stick = { x: 0, y: 0 }; knob.style.transform = ''; };
  stick.addEventListener('pointerdown', (e) => { if (!on()) return; e.preventDefault(); sp = e.pointerId; stick.setPointerCapture(e.pointerId); setStick(e); });
  stick.addEventListener('pointermove', (e) => { if (sp === e.pointerId) setStick(e); });
  stick.addEventListener('pointerup', stickOff); stick.addEventListener('pointercancel', stickOff); stick.addEventListener('lostpointercapture', stickOff);

  // the big button
  const tb = $('#throwBtn');
  tb.addEventListener('pointerdown', (e) => { if (!on()) return; e.preventDefault(); act.throwNow(); });
}

// Do you want to sprint? Shift, or the stick pushed all the way to its edge.
export const wantSprint = () => !!R.keys.sprint || Math.hypot(R.stick.x, R.stick.y) > 0.95;

// Which way you are running this frame, in world space (length up to 1).
export function runDir() {
  const f = R.keys.f - R.keys.b - R.stick.y, sd = R.keys.l - R.keys.r - R.stick.x;
  const y = R.yaw;
  let dx = Math.sin(y) * f + Math.cos(y) * sd, dz = Math.cos(y) * f - Math.sin(y) * sd;
  const l = Math.hypot(dx, dz); if (l > 1) { dx /= l; dz /= l; }
  return { dx, dz };
}
