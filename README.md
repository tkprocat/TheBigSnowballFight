# The Big Snowball Fight

A browser-based 3D snowball fight for 2 to 16 players, in two modes the host picks in the lobby. Head hits score 2 points, body hits 1. The host picks how a round is won: first to 5, 10 or 20 points, or the most points after 3, 5 or 10 minutes (a tie when time runs out goes to sudden death: play on until someone leads alone).

- **Turn-based:** one player at a time. Hit someone and they hop to a new spot. First walk up to 5 m (duck behind a wall, a tree or another player to hide from whoever throws next), then pick a direction and an angle, time the power meter and release. The snowball flies on a ballistic arc pushed by the wind. Head hits get a slow-motion critical-hit camera. Instead of throwing, you can spend your turn packing a heavy snowball: your next hit counts triple. You can hold one at a time, it flies a bit shorter, the wind moves it less, and you drop it if someone hits you first.
- **Realtime:** everyone at once, on a map four times the size, built for up to 16 players: a castle in the middle (an outer wall with towers and two gates, and inside it a keep of tall walls whose gates face the other way, so you walk round to get in), three outposts in different shapes (a small fort, an L-shaped bunker, a U-shaped trench or a ring of snowmen), loose walls and corners, trees and snowmen to hide behind. Walls come in three heights: low ones hide your body, and tall ones (darker) hide you completely and stop straight throws: step out to throw, or lob one high over the top (slow, and easy to see coming). Run around, pick snowballs up off the snow (walk over a gold ring; some spots hold a pile of 2 or 3, and you take as many as you can carry, up to 3; you start with none; the dots above your head show how many you have, and flash gold if you walk onto a pile while already full), and throw whenever you like. An emptied spot comes back somewhere else after 2 seconds. Hold Shift to sprint, 60% faster, but while you sprint you can't aim or throw. Getting hit doesn't move you: you stay where you are, protected for a moment (you flicker while it lasts). A hit feed under the scores shows who hit whom, so everyone can follow the fight. No power meter (every throw goes at the same speed, so you only aim), no wind and no heavy snowballs. Throws leave the hand a little lower than in turn-based, and a snowball that clips both head and body counts as a body hit, so head shots are rarer (about 1 hit in 5).

Quick chat (fixed lines and emotes: wave, dance, cheer) works in the lobby and in the game.

## Run it

```
npm start
```

Then open http://localhost:3000. Node 22 or newer (the oldest Node LTS still supported), no dependencies, no build step. Set `PORT` to change the port, `ADMIN_TOKEN` to turn on the admin dashboard, and `STATS_DIR` to keep statistics (see below). To play with friends over the internet, deploy to any Node host or run the Docker image below.

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
    environment:
      ADMIN_TOKEN: change-me-to-a-long-random-string # turns on the admin dashboard at /admin
    volumes:
      - snowball-data:/data # anonymous statistics

volumes:
  snowball-data:
```

Lobbies live in memory, so a restart ends games in progress.

## Admin dashboard and statistics

Set `ADMIN_TOKEN` to a long random string (for example `openssl rand -hex 24`) and open `/admin`. Paste the token once (it stays in that browser tab only) and the page shows, refreshing every 5 seconds:

- **Live:** every open room: its code, mode, lobby/playing/over, how many people are seated and connected, bots, spectators, round, win setting, top score, how long the round and the room have been going, and how long it's been idle.
- **Statistics:** lobbies created, games started (and rematches), finished and abandoned, how often a bot wins, games started per day for the last 30 days, average game length and players per mode, how many people play per game, and the latest 50 games.

Without `ADMIN_TOKEN`, `/admin` is a 404. The data comes from `GET /api/admin` with `Authorization: Bearer <token>`; after 10 wrong tokens in 10 minutes an address is refused for a while. Behind a reverse proxy (nginx, Caddy, Traefik…), set `TRUST_PROXY=1` so that count is kept per visitor, from the address the proxy adds to `X-Forwarded-For`, rather than for the proxy as a whole (where anyone could lock you out). Leave it unset when visitors reach the server directly.

The statistics are anonymous: no names, lobby codes, tokens or IP addresses, only counts and times. With `STATS_DIR` set, each event is one JSON line appended to `STATS_DIR/stats.jsonl` and read back at startup, so totals survive restarts. The Docker image sets `STATS_DIR=/data`; mount a volume there (as above) or the file goes away with the container. Without `STATS_DIR` (plain `npm start`), statistics are kept in memory only. To start counting again, delete the file.

## Playing

Press **Create a lobby** and send friends the 4-letter code or the invite link (`?room=CODE`). The host picks the mode, can add computer players (one at a time or four at once) and pick how good they are (Easy, Normal or Hard), and starts the game. Everyone sees a note when someone joins or leaves, and who hosts if the host leaves. On a phone, Copy invite link opens the share sheet. Friends can join a game that's already going. Playing alone? Create a lobby and add computer players.

Anyone in the lobby can press **Watch instead** to give up their seat and spectate (Tab, or tap or click a name in the score list, to follow someone). The host stays host while watching, so for testing you can watch bots play each other. Someone joining a full room (16 seated players) becomes a spectator.

In turn-based, everyone starts within reach of everyone else, and while you aim the readout shows how far away the player you face is. Each turn has a 30 second limit; if time runs out, the game throws for you. Your direction and angle stay where you left them after each throw, and a dark mark on the power meter shows your last power.

### Turn-based controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Pick where to walk (move step) | Arrows, or tap the snow; Space to go, Tab to stay | ◀ ▲ ▼ ▶ or tap; the big button to go, ◎ to stay |
| Aim left / right | ← → (or A/D), or drag the view | ◀ ▶ |
| Angle up / down | ↑ ↓ (or W/S), or drag the view | ▲ ▼ |
| Aim at next friend | Tab | ◎ |
| Charge and throw | Hold Space, release | Hold the throw button, release |
| Pack a heavy snowball (uses your turn) | H | Pack ×3 button |
| Quick chat | C | 💬 |

### Realtime controls

| Action | Keyboard and mouse | Touch |
| --- | --- | --- |
| Start (locks the mouse) | Click the view; Esc frees the mouse | |
| Run | WASD (or arrows) | The stick bottom left |
| Sprint (no aiming or throwing) | Hold Shift | Push the stick all the way to its edge |
| Aim (direction, and angle for distance) | Move the mouse | Drag the view |
| Throw | Click (or Space) | Tap the throw button |
| Pick up a snowball | Walk over it | Walk over it |
| Quick chat | C | 💬 |

Every realtime throw goes at the same speed, so there is no power meter: the angle alone sets how far it goes (about 38 m at most). The dotted arc and the ring on the snow show where your throw would land.

## How it works

- `public/shared/physics.js` holds the game rules and physics (fixed 1/120 s steps, gravity, wind, trees, snow walls, snowmen, the two maps (the large realtime one with its forts), spawn points, hit tests, the turn-based computer player's aim). `public/shared/realtimeRules.js` adds the realtime rules: running and sliding along walls, loose snowballs, stepping a snowball in flight, and the realtime bots' aim. Both are shared by the browser and the server.
- `server.js` runs lobbies (modes, bots, spectators, chat). Clients send actions to `POST /api/<action>` and get room updates over Server-Sent Events from `GET /events`. `rooms.js` holds what both modes share (members, views, sending updates).
- `admin.js` serves the admin dashboard (`admin/index.html`, `GET /api/admin`), and `stats.js` keeps the anonymous statistics.
- `modes/turnbased/` is the turn-based game on the server: whose turn it is, keeping moves inside the 5 m ring and out of walls and trees, simulating each throw, scores, the turn timer, and the bots (`bots.js`).
- `modes/realtime/` is the realtime game on the server, a 30-per-second tick that sends positions 15 times a second. The server is the authority on everything that scores, to make cheating hard: it owns snowball counts, pickups, the throw cooldown, scores and protection after a hit, and it steps every snowball in flight against where players stand right now and decides each hit. Browsers report where they are (refused if faster than running or through a wall, and the player snaps back) and ask to throw: a throw carries only a direction (every throw goes at the same speed) and starts from where the server has you. Bots (`bots.js`) pick up, look for someone in sight, and throw through the same checks. Bots pause while nobody has the room open.
- `public/index.html` and `style.css` are the page; `public/js/` is the Three.js client as plain ES modules (no build step):
  - `common/`: `app.js` (entry: menu, connecting, handing the game to the room's mode), `scene.js` (3D scene and avatars), `players.js` (players in the scene, name tags, scores), `lobby.js`, `chat.js`, `net.js`, `audio.js`, `over.js`, `dom.js`
  - `turnbased/`: replays each throw the server reports (same inputs, same physics, cut at the server's step count) and shows the server's result. Wind comes from the lobby's seed and the turn number, so everyone sees the same wind.
  - `realtime/`: predicts your own running, smooths everyone else between server updates, replays snowballs from the server's throws and lands them where the server says.

## Tests

```
npm test
```

CI runs the tests on Node 22 and 26 (the oldest and newest supported LTS) and builds the Docker image for every pull request.
