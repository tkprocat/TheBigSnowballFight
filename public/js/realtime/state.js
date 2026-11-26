// Realtime state in the browser: your aim, what you are pressing, server snapshots for smoothing,
// and the snowballs on screen.
import { S } from '../common/state.js';

export const R = {
  yaw: 0, pitch: 0.3, vel: { x: 0, z: 0 }, sprinting: false,
  keys: { f: 0, b: 0, l: 0, r: 0, sprint: 0 }, stick: { x: 0, y: 0 },
  fixSeen: null,
  snaps: [],             // recent server snapshots: { at (local ms), pos: Map id -> [x, z, yaw, pitch] }
  loose: new Map(),      // loose snowballs on the snow: id -> { x, z, mesh }
  flights: new Map(),    // snowballs in the air: n -> { sim, t, mesh, thrower, end }
  lastInput: 0, inputBusy: false,
};

export function resetR() {
  Object.assign(R, { vel: { x: 0, z: 0 }, sprinting: false, keys: { f: 0, b: 0, l: 0, r: 0, sprint: 0 }, stick: { x: 0, y: 0 }, fixSeen: null, snaps: [], lastInput: 0, inputBusy: false });
}

export const me = () => S.players.find((p) => p.local) || null;
export const canPlay = () => S.screen === 'game' && S.mode === 'realtime' && !S.over && !!me();
