// Turn-based state and the questions everything else asks about it (whose turn, can I act, the wind).
import { windFor, lineBlocked } from '../../shared/physics.js';
import { S } from '../common/state.js';

export const T = {
  cur: 0, turn: 0, windTurn: 0, phase: 'move', nextId: null, turnDeadline: 0, turnKey: '',
  aimYaw: 0, aimPitch: 35 * Math.PI / 180, charging: false, chargeT: 0, power: 0, targetIdx: 0,
  held: { l: 0, r: 0, u: 0, d: 0 }, moveTo: { x: 0, z: 0 },
  flights: [], busy: false, impactAt: null, packUntil: 0, sending: false,
  seenN: 0, seenPack: -1, pendingHits: new Map(),
};

export function resetT() {
  Object.assign(T, {
    cur: 0, turn: 0, windTurn: 0, phase: 'move', nextId: null, turnDeadline: 0, turnKey: '', charging: false, chargeT: 0, power: 0, targetIdx: 0,
    held: { l: 0, r: 0, u: 0, d: 0 }, flights: [], busy: false, impactAt: null, packUntil: 0, sending: false,
    seenN: 0, seenPack: -1, pendingHits: new Map(),
  });
}

export const curPlayer = () => S.players[T.cur] || null;
export const nextPlayer = () => S.byId.get(T.nextId) || null;
// The wind on screen: the current turn's, but the thrower's while their snowball is still flying.
export const currentWind = () => windFor(S.seed, T.windTurn);
export function canControl() {
  const p = curPlayer();
  return S.screen === 'game' && S.mode === 'turn' && !T.busy && !S.over && !T.sending && performance.now() > T.packUntil && !!p && p.local;
}
export const canMove = () => canControl() && T.phase === 'move';

// Would the next thrower have a clear line to this spot? Other players and obstacles block it.
export function hiddenFromNext(spot) {
  const p = curPlayer(), n = nextPlayer();
  if (!p || !n || n === p) return null;
  return lineBlocked(n, spot, S.map, S.players.filter((o) => o !== p && o !== n));
}
