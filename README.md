# The Big Snowball Fight

A browser-based, turn-based 3D snowball fight. Each turn, pick a direction and an angle, then time the power meter and release. The snowball flies on a ballistic arc pushed by the wind, and the goal is to hit your friends' avatars. First to 5 hits wins.

## Play

Open `index.html` in a modern browser (it loads Three.js r160 from jsDelivr). No build step.

- **On one device:** add friends (pass the device) and/or computer players, then start.
- **Online:** rooms use the claude.ai Artifact `room` capability, so they only work when the page is opened as a published Artifact on claude.ai. Create a room, share the 4-letter code, and friends join with it.

### Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Aim left / right | ← → (or A/D), or drag the view | ◀ ▶ |
| Angle up / down | ↑ ↓ (or W/S), or drag the view | ▲ ▼ |
| Aim at next friend | Tab | ◎ |
| Charge and throw | Hold Space, release | Hold the throw button, release |

## How it works

- `index.html` holds everything: scene (Three.js), avatars, deterministic physics (`simulate`, fixed 1/120 s step, gravity, wind, trees, snow walls), turn logic, CPU players and the online layer.
- **Online sync without a server:** each player publishes their state as room presence (name, colour, position, aim, score, last throw). Turn order is everyone sorted by join time; the turn counter is the highest one anyone has seen. The thrower decides whether their throw hit and publishes the throw inputs plus the result; other clients replay the same arc locally. A hit player moves themselves to a new spot.
- Wind is derived from the room seed and the turn number, so every client sees the same wind.

## Ideas for next steps

- A small Node/WebSocket server so online play works outside claude.ai.
- Terrain hills and cover that blocks line of sight.
- Power-ups (giant snowball, ice ball), team mode, emotes.
