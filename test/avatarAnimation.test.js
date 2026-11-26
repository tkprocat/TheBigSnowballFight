import test from 'node:test';
import assert from 'node:assert/strict';
import { animateAvatar, THROW_DURATION } from '../public/js/common/avatarAnimation.js';

// The pose driver has no renderer/DOM dependency; exercise its transitions with joint transforms.
function joint() {
  const xyz = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { Object.assign(this, { x, y, z }); } });
  return { rotation: xyz(), position: xyz() };
}
function player() {
  const avatar = joint();
  avatar.userData = {
    body: joint(), upper: joint(), throwArm: joint(), freeArm: joint(), hat: joint(),
    legs: [joint(), joint()], knees: [joint(), joint()], boots: [joint(), joint()], elbows: [joint(), joint()],
    handBall: { visible: true, scale: { setScalar() {} } },
  };
  return { avatar, x: 0, z: 0, heavy: 1, armT: 0 };
}
const idle = { yaw: 0, speed: 0, hasBall: false };
function frames(p, count, options = idle, dt = 1 / 60) {
  for (let i = 0; i < count; i++) animateAvatar(p, dt, i * dt, options);
}

test('a throw releases at 100 ms and never shows a replacement ball during recovery', () => {
  const p = player(), u = p.avatar.userData;
  p.armT = THROW_DURATION;
  animateAvatar(p, 0.05, 0.05, { ...idle, hasBall: true });
  assert.equal(u.handBall.visible, true);
  animateAvatar(p, 0.051, 0.101, { ...idle, hasBall: true });
  assert.equal(u.handBall.visible, false);
  assert.ok(u.throwArm.rotation.x < -1.4, 'arm is extended forward at release');
  animateAvatar(p, 0.399, 0.5, { ...idle, hasBall: true });
  assert.equal(p.armT, 0);
  assert.equal(u.handBall.visible, false, 'no one-frame ball flash when recovery ends');
  frames(p, 90);
  assert.ok(Math.abs(u.throwArm.rotation.x) < 0.001, 'returns to empty-hand idle');
});

test('strafe and backward steps follow travel direction while aim stays forward', () => {
  const side = player(), back = player();
  frames(side, 60, { ...idle, speed: 6, vx: 6, vz: 0 });
  frames(back, 60, { ...idle, speed: 6, vx: 0, vz: -6 });
  assert.ok(side.walkSide > 0.99);
  assert.ok(Math.abs(side.avatar.userData.legs[0].rotation.z) > 0.1);
  assert.ok(back.walkForward < -0.99);
  assert.equal(side.avatar.rotation.y, 0);
  assert.equal(back.avatar.rotation.y, 0);
  assert.equal(side.avatar.position.x, 0, 'animation does not change gameplay position');
});

test('stopping settles the gait, and turns take the short path across the yaw seam', () => {
  const p = player();
  frames(p, 60, { ...idle, speed: 9.6, vx: 0, vz: 9.6 });
  frames(p, 90);
  assert.ok(p.walkK < 1e-6);
  assert.ok(Math.abs(p.avatar.userData.knees[0].rotation.x) < 1e-6);
  p.avatar.rotation.y = Math.PI - 0.01;
  animateAvatar(p, 1 / 60, 2, { ...idle, yaw: -Math.PI + 0.01 });
  assert.ok(p.avatar.rotation.y > Math.PI - 0.01);
  assert.ok(p.avatar.rotation.y < Math.PI + 0.01);
});

test('locomotion settles to the same pose envelope at 30 and 120 fps', () => {
  const slow = player(), fast = player(), options = { ...idle, speed: 6, vx: 0, vz: 6 };
  frames(slow, 60, options, 1 / 30);
  frames(fast, 240, options, 1 / 120);
  assert.ok(Math.abs(slow.walkK - fast.walkK) < 1e-8);
  assert.ok(Math.abs(slow.walkPh - fast.walkPh) < 0.16, 'stride does not race at high frame rates');
});

test('emotes, packing and hit recovery leave no stale tilt or accumulated bob', () => {
  const p = player(), u = p.avatar.userData;
  p.emote = 'wave'; p.emoteT = 0.2; p.hitT = 0.15; p.packT = 0.15; p.hatT = 0.15;
  frames(p, 120);
  assert.equal(p.emote, null);
  assert.equal(u.throwArm.rotation.z, -0.25);
  assert.equal(u.upper.rotation.x, 0);
  assert.ok(Math.abs(u.body.position.y) <= 0.015);
  assert.equal(u.hat.position.y, 1.77);
});
