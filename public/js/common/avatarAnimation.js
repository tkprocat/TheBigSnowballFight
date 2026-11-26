// Presentation only: joint poses never change player positions, aim, cooldowns or hit detection.
import { angDiff, clamp } from '../../shared/physics.js';

// Keep the existing 100 ms visual wind-up; give the arm longer to finish and recover.
export const THROW_DURATION = 0.5;
export const THROW_RELEASE_LEFT = THROW_DURATION - 0.1;
const TAU = Math.PI * 2;
const mix = (a, b, k) => a + (b - a) * k;
const ease = (k) => { k = clamp(k, 0, 1); return k * k * (3 - 2 * k); };
const damp = (a, b, rate, dt) => mix(a, b, 1 - Math.exp(-rate * dt));

// o: aim yaw, optional charge-arm angle, ball ownership, and rendered movement speed/vx/vz in m/s.
export function animateAvatar(p, dt, time, o) {
  const a = p.avatar, u = a.userData;
  dt = Math.max(0, dt);
  a.rotation.y += angDiff(a.rotation.y, o.yaw) * (1 - Math.exp(-14 * dt));

  // Distance drives the stride, so stopping at a wall also stops the feet. Blend the pose separately.
  const speed = clamp(o.speed || 0, 0, 12);
  p.walkSpeed = damp(p.walkSpeed || 0, speed, 12, dt);
  p.walkK = damp(p.walkK || 0, clamp(speed / 4, 0, 1), 12, dt);
  p.walkPh = ((p.walkPh || 0) + p.walkSpeed * dt * 1.9) % TAU;
  const wk = p.walkK, run = clamp((p.walkSpeed - 5) / 4.6, 0, 1);
  const sy = Math.sin(a.rotation.y), cy = Math.cos(a.rotation.y);
  const forward = speed > 0.05 ? (o.vx == null ? 1 : (o.vx * sy + o.vz * cy) / speed) : 0;
  const side = speed > 0.05 && o.vx != null ? (o.vx * cy - o.vz * sy) / speed : 0;
  p.walkForward = damp(p.walkForward || 0, clamp(forward, -1, 1), 10, dt);
  p.walkSide = damp(p.walkSide || 0, clamp(side, -1, 1), 10, dt);
  const fwd = p.walkForward, strafe = p.walkSide;
  for (let i = 0; i < 2; i++) {
    const step = Math.sin(p.walkPh + i * Math.PI), lift = Math.max(0, step);
    u.legs[i].rotation.set(-step * (0.65 + run * 0.2) * fwd * wk, strafe * 0.35 * wk, step * 0.4 * strafe * wk);
    u.knees[i].rotation.x = (0.12 + lift * (0.8 + run * 0.45)) * wk;
    u.boots[i].rotation.x = -u.knees[i].rotation.x * 0.45 + Math.min(0, step) * 0.18 * wk;
  }
  const swing = Math.sin(p.walkPh), idle = Math.sin(time * 2 + p.x) * (1 - wk);
  u.body.position.y = idle * 0.015 + (1 - Math.cos(p.walkPh * 2)) * (0.025 + run * 0.02) * wk;
  u.body.rotation.set((0.06 + run * 0.09) * fwd * wk, 0, -strafe * (0.07 + run * 0.04) * wk);
  u.upper.rotation.set(0, swing * 0.045 * wk, -swing * 0.035 * wk);
  u.freeArm.rotation.set(-swing * (0.5 + run * 0.2) * wk, 0, 0.25);
  u.elbows[1].rotation.x = -0.15 - run * 0.55;

  // Carry the snowball in front of the jacket rather than swinging it through the snow.
  const carrying = o.hasBall !== false;
  let shoulder = o.arm != null ? o.arm : carrying ? -0.35 - swing * 0.12 * wk : swing * 0.5 * wk;
  let elbow = o.arm != null ? -1.1 : carrying ? -0.65 : -0.15 - run * 0.55;
  let roll = -0.25;
  if (p.packT > 0) {
    p.packT = Math.max(0, p.packT - dt);
    shoulder = -0.6 + Math.sin(p.packT * 14) * 0.22; elbow = -0.9;
    u.freeArm.rotation.x = -0.65 - Math.sin(p.packT * 14) * 0.2;
    u.elbows[1].rotation.x = -0.9; u.upper.rotation.x = 0.22;
  }
  if (p.emoteT > 0 && o.arm == null && !(p.armT > 0)) {
    p.emoteT = Math.max(0, p.emoteT - dt);
    if (p.emote === 'wave') { shoulder = Math.PI; elbow = -0.3; roll = -0.25 - Math.sin(p.emoteT * 12) * 0.5; }
    else if (p.emote === 'cheer') {
      shoulder = Math.PI; elbow = -0.2;
      u.freeArm.rotation.x = Math.PI; u.elbows[1].rotation.x = -0.2;
      u.body.position.y += Math.abs(Math.sin(p.emoteT * 8)) * 0.2;
    } else if (p.emote === 'dance') {
      u.upper.rotation.y = Math.sin(p.emoteT * 9) * 0.6;
      u.body.position.y += Math.abs(Math.sin(p.emoteT * 12)) * 0.18;
    }
    if (!p.emoteT) p.emote = null;
  }

  const throwing = p.armT > 0;
  if (throwing) {
    if (!p.throwPose || p.armT > (p.animArmT || 0) + 0.001) {
      p.throwPose = [u.throwArm.rotation.x, u.elbows[0].rotation.x, u.upper.rotation.y, u.upper.rotation.x];
    }
    p.armT = Math.max(0, p.armT - dt);
    const t = THROW_DURATION - p.armT;
    // Shoulder travels over the head, through release, then across the chest. Angles above pi keep that
    // arc continuous instead of sending the hand down through the legs on its way from back to front.
    const keys = [
      [0, ...p.throwPose],
      [0.045, 2.35, -1.3, -0.32, -0.08],
      [0.1, 4.65, -0.12, 0.12, 0.08],
      [0.19, 5.55, -0.6, 0.38, 0.14],
      [THROW_DURATION, TAU + shoulder, elbow, 0, 0],
    ];
    let i = 1; while (i < keys.length - 1 && t > keys[i][0]) i++;
    const from = keys[i - 1], to = keys[i], k = ease((t - from[0]) / (to[0] - from[0]));
    shoulder = mix(from[1], to[1], k); elbow = mix(from[2], to[2], k);
    u.upper.rotation.y += mix(from[3], to[3], k);
    u.upper.rotation.x += mix(from[4], to[4], k);
    const brace = Math.sin(Math.PI * clamp(t / THROW_DURATION, 0, 1));
    u.freeArm.rotation.x = mix(u.freeArm.rotation.x, -0.9, brace);
    u.freeArm.rotation.z += brace * 0.25;
    roll -= brace * 0.2;
    u.throwArm.rotation.x = Math.atan2(Math.sin(shoulder), Math.cos(shoulder));
    u.elbows[0].rotation.x = elbow;
  } else {
    p.throwPose = null;
    u.throwArm.rotation.x = damp(u.throwArm.rotation.x, shoulder, 12, dt);
    u.elbows[0].rotation.x = damp(u.elbows[0].rotation.x, elbow, 12, dt);
  }
  p.animArmT = p.armT;
  u.throwArm.rotation.z = roll;
  u.handBall.visible = carrying && !(throwing && p.armT <= THROW_RELEASE_LEFT);
  u.handBall.scale.setScalar(p.heavy > 1 ? 1 + (p.heavy - 1) * 0.6 : 1);

  if (p.hatT > 0) {
    p.hatT = Math.max(0, p.hatT - dt); const k = 1.6 - p.hatT;
    u.hat.position.set(0, 1.77 + k * 3.2 - k * k * 2.6, -k * 1.4); u.hat.rotation.set(-k * 7, k * 3, 0);
    if (!p.hatT) { u.hat.position.set(0, 1.77, 0); u.hat.rotation.set(0, 0, 0); }
  }
  if (p.hitT > 0) {
    p.hitT = Math.max(0, p.hitT - dt);
    u.upper.rotation.x -= Math.sin(p.hitT * 9) * 0.35 * p.hitT;
  }
  const ghost = !!p.shield && Math.sin(time * 20) > 0;
  a.visible = !ghost;
}
