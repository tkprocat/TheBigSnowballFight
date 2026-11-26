# The Big Snowball Fight

A browser-based, turn-based 3D snowball fight. Each turn, first walk up to 5 m (duck behind a wall, a tree or another player to hide from whoever throws next), then pick a direction and an angle, time the power meter and release. The snowball flies on a ballistic arc pushed by the wind, and the goal is to hit your friends' avatars. Hit someone and they hop to a new spot. First to 5 hits wins.

## Run it

```
npm start
```

Then open http://localhost:3000. Node 18 or newer, no dependencies, no build step. Set `PORT` to change the port. To play with friends over the internet, deploy to any Node host or run the Docker image below.

## Docker

Every push to `main` publishes an image to the GitHub Container Registry (see `.github/workflows/build.yml`):

```
docker run -p 3000:3000 ghcr.io/tkprocat/thebigsnowballfight
```

With Docker Compose:

```yaml
services:
  web:
    image: ghcr.io/tkprocat/thebigsnowballfight:latest
    init: true
    restart: unless-stopped
    ports:
      - "3000:3000"
```

Lobbies live in memory, so a restart ends games in progress.

## Playing

- **Online:** press **Create a lobby** and send friends the 4-letter code or the invite link (`?room=CODE`). The host can add computer players and starts the game. Friends can also join a game that's already going. Each turn has a 30 second limit; if time runs out, the game throws for you.
- **On one device:** add friends (pass the device) and/or computer players on the start screen.

### Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Pick where to walk (move step) | Arrows, or tap the snow; Space to go, Tab to stay | ◀ ▲ ▼ ▶ or tap; the big button to go, ◎ to stay |
| Aim left / right | ← → (or A/D), or drag the view | ◀ ▶ |
| Angle up / down | ↑ ↓ (or W/S), or drag the view | ▲ ▼ |
| Aim at next friend | Tab | ◎ |
| Charge and throw | Hold Space, release | Hold the throw button, release |

## How it works

- `public/physics.js` holds the game rules and physics (fixed 1/120 s steps, gravity, wind, trees, snow walls, spawn points, the computer player's aim). It is shared by the browser and the server.
- `server.js` runs lobbies. Clients send actions to `POST /api/<action>` and get room updates over Server-Sent Events from `GET /events`. The server is the authority: it checks whose turn it is, keeps moves inside the 5 m ring and out of walls and trees, simulates each throw, decides hits and scores, moves hit players, runs bots and the turn timer.
- `public/index.html` is the Three.js client. It replays each throw the server reports (same inputs, same physics, cut at the server's step count) and shows the server's result.
- Wind comes from the lobby's seed and the turn number, so everyone sees the same wind.

## Tests

```
npm test
```

CI runs the tests on Node 18 and 24 and builds the Docker image for every pull request.
