// Turn-based input: arrows/WASD walk the move marker or aim, Space charges and throws, Tab picks the next target,
// H packs, drag on the view to aim, tap the snow to pick where to walk. Every handler is ignored in realtime mode.
import { clamp, PITCH_MIN, PITCH_MAX, clampMove } from '../../shared/physics.js';
import { S } from '../common/state.js';
import { $ } from '../common/dom.js';
import { THREE, canvas, camera } from '../common/scene.js';
import { T, curPlayer, canControl, canMove } from './state.js';

const on = () => S.screen === 'game' && S.mode === 'turn';
const KEYMAP = { ArrowLeft: 'l', KeyA: 'l', ArrowRight: 'r', KeyD: 'r', ArrowUp: 'u', KeyW: 'u', ArrowDown: 'd', KeyS: 'd' };

// `act` is the game's actions: { startCharge, releaseCharge, cancelCharge, nextTarget, packNow }.
export function initInput(act) {
  addEventListener('keydown', (e) => {
    if (!on() || e.target.tagName === 'INPUT') return;
    if (KEYMAP[e.code]) { T.held[KEYMAP[e.code]] = 1; e.preventDefault(); }
    else if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) act.startCharge(); }
    else if (e.code === 'Tab' && !S.watching) { e.preventDefault(); act.nextTarget(); }
    else if (e.code === 'KeyH' && !e.repeat) act.packNow();
  });
  addEventListener('keyup', (e) => {
    if (!on()) return;
    if (KEYMAP[e.code]) T.held[KEYMAP[e.code]] = 0;
    else if (e.code === 'Space') act.releaseCharge();
  });
  addEventListener('blur', () => { T.held = { l: 0, r: 0, u: 0, d: 0 }; });
  for (const b of document.querySelectorAll('.pb[data-k]')) {
    const k = b.dataset.k;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.setPointerCapture(e.pointerId); T.held[k] = 1; b.classList.add('on'); });
    const up = () => { T.held[k] = 0; b.classList.remove('on'); };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
  }
  $('#bTarget').addEventListener('click', act.nextTarget);
  $('#packBtn').addEventListener('click', act.packNow);
  const tb = $('#throwBtn');
  tb.addEventListener('pointerdown', (e) => { if (!on()) return; e.preventDefault(); tb.setPointerCapture(e.pointerId); act.startCharge(); });
  tb.addEventListener('pointerup', () => { if (on()) act.releaseCharge(); });
  tb.addEventListener('pointercancel', () => { if (on()) act.cancelCharge(); });

  // drag on the 3D view to aim; a tap (no drag) during the move step picks where to walk
  let drag = null;
  const raycaster = new THREE.Raycaster(), groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), ndc = new THREE.Vector2();
  canvas.addEventListener('pointerdown', (e) => { if (!on() || !canControl()) return; drag = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || !on() || !canControl()) return;
    T.aimYaw -= (e.clientX - drag.x) * 0.005;
    if (!canMove()) T.aimPitch = clamp(T.aimPitch + (e.clientY - drag.y) * 0.004, PITCH_MIN, PITCH_MAX);
    drag.x = e.clientX; drag.y = e.clientY;
  });
  canvas.addEventListener('pointerup', (e) => {
    if (drag && on() && canMove() && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 8) {
      const r = canvas.getBoundingClientRect();
      ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, camera);
      const hit = raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3());
      if (hit) T.moveTo = clampMove(curPlayer(), { x: hit.x, z: hit.z });
    }
    drag = null;
  });
  canvas.addEventListener('pointercancel', () => { drag = null; });
}
