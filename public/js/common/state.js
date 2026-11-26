// What every screen and mode shares: which screen is up, the room's map, and the players in the 3D scene.
// Each mode keeps its own state in its own folder.
export const S = {
  screen: 'menu',     // 'menu' | 'lobby' | 'game'
  mode: null,         // 'turn' | 'realtime' while a game is on screen
  seed: 1, map: null,
  players: [], byId: new Map(),
  over: false,
  watching: false,    // spectating: no player of our own
  followId: null,     // the player a spectator's camera follows (Tab, or tap a name); null = the default
};
