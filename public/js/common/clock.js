// The round's goal as text for the HUD: "First to 10", "3:42 left", or "Sudden death!". `hurry` is true in the
// last 30 seconds of a timed round.
import { S } from './state.js';
import { describeWin, clockText } from '../../shared/win.js';

export function roundGoal() {
  if (S.win && S.win.type === 'time') {
    if (S.suddenDeath) return { text: 'Sudden death! Next lead wins', hurry: true };
    const left = S.timeEnds ? S.timeEnds - performance.now() : 0;
    return { text: clockText(left) + ' left', hurry: left < 30000 };
  }
  return { text: describeWin(S.win), hurry: false };
}
