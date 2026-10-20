# Escape Angry Head

A multiplayer horror-maze escape for the browser, built with **Three.js** and **Colyseus** for Bloxity. Giant screaming **Angry Heads** roam twelve haunted mazes (and the BOSS's throne room). Run through each maze to the glowing **EXIT** before a head catches you: if one does, it's a "HAHA!" jumpscare and back to your checkpoint. Escaping a stage pays **Coins** (double the first time) and opens the next one. Coins buy gear (coils, a jetpack, wings, a slap, a rocket launcher...), hats that multiply your Coins, boosts, and the chance to **become an Angry Head yourself** and hunt the other players. It clones the Roblox game *[Escape Angry Head](https://www.roblox.com/games/16867505761/Escape-Angry-Head)* (see the video in `reference/`).

**There are no in-app purchases.** Everything is bought with Coins.

It shares its engine with the other Legion games (server, Bloxity login and avatars, the top games' character animation and lighting, profiles, saves; forked from Troll Easy Tower). The heads, the mazes, the lobby, the HUD and the soundtrack are new.

## Project layout

| Folder | What it is |
|---|---|
| `client/` | Vite + Three.js client: `main.js` (player physics, trusses, coils / jetpack / wings, slime / ice / lava floors, the electrified wall tops, getting caught and the revive, runs, checkpoints, coins, keys, the EXIT, hitting heads, the morph, other players, network, camera), `heads.js` (the Angry Head model built in code, its moving jaw / eyes / brows, the heads drawn from the server's snapshots, the jumpscare), `world.js` (the lobby and the thirteen mazes, every collider), `props.js` (each theme's props), `materials.js` (every texture, drawn in code), `gear.js` (tool and hat models), `engine.js` (renderer, skies and moods, lights), `fx.js` (quality, particles), `audio.js` (music and sounds), `ui.js` + `index.html` (HUD and panels) |
| `server/` | Colyseus 0.18 server: the `angry` room (`HeadRoom.js`: runs, checkpoints, coins, keys, escapes, catches, revives, the shop, rewards), `heads.js` (the head AI), profiles, leaderboards, play stats |
| `shared/` | `config.js` (stages, head types, gear, hats, prices, rewards) and `maze.js` (every maze generated from a fixed seed: walls, the path, checkpoints, heads, coins, keys, bridges, lookouts, floor hazards; the lobby layout), used by both sides |

## Run it locally

Needs Node 20 or newer. Double-click `start-local.bat`, or:

```sh
npm install          # installs client and server too
npm run build        # builds the client into client/dist
npm start            # server + game on http://localhost:2653
```

For development run `npm run dev:server` and `npm run dev:client`, then open http://localhost:5219 (the client talks to the server on port 2653; `VITE_SERVER_URL` overrides that). Dev builds (or a build with `VITE_QA=1`) expose `window.__qa` (teleport, enter a stage, an autopilot that plays a stage, screenshots of the jumpscare...). Restart the server after changing `shared/`.

## Gameplay

- **The lobby** is a haunted hall: the **stage doors** along the north wall (Stage 1 on the left, the red **BOSS** door on the right; a green-arrow trail leads from the spawn to Stage 1), the **Shop** of gear in glass cases down the west wall, the **"Become the Angry Head"** board and its green pad, the **Free Items** booth (the limited Scythe and Invisibility Potion, free after 20 and 35 minutes of play), the **hats** on the south wall, the **Top Coins / Most Escapes / Top Scares** boards, the codes board, and in the middle a dead tree hung with cages, a giant jack-o'-lantern and the Headless Horseman.
- **A stage**: walk through its door. You start in a safe room (the red carpet and the star pad: your first checkpoint) with the stage's board ("Stage 1: Basement") and a portal home (or press the orange **Lobby** button on the left any time in a stage: it asks first, and your checkpoint is kept). The maze is through the doorway: concrete corridors 24 studs high, the heads somewhere inside. Find the **EXIT** (a beam of green light over the walls shows roughly where it is).
  - **Checkpoints**: red-carpet **safe rooms** along the way (the pad turns green). No head can come in while you are in one (they can pass through an empty one, so they roam the whole maze instead of getting stuck in one stretch of it), and a head that chased you in backs off into the side corridors instead of waiting at the door. Get caught and you're back at the last one you reached.
  - **Green arrows** on the floor at some junctions on the way to the EXIT (every junction in Stage 1, fewer later).
  - **Lookouts**: a truss between two red wooden pillars (the reference's) up to a deck on top of the wall: safe, and you can see over the maze. **Bridges** (Stage 2 on): a plank bridge along the top of the walls, a shortcut no head can follow, with gaps to jump on later stages; jump down at the end.
  - The **wall tops are electrified**: try to walk along them and you're zapped back down.
  - **Coins** lie in the dead ends (a risk!) and along the way. **Keys**: the Hospital, the Playroom, the Ice Cave and the Attic lock their EXIT until you find the golden key (the BOSS needs three).
  - Floors: **slime** (slows you down), **ice** (slippery), **lava cracks** (jump them, or it's back to the checkpoint).
- **The heads** (the server moves them; everyone in a maze sees the same ones): each wanders the corridors until it sees you down a corridor or hears you close by, then hunts you down the shortest way through the maze, screaming. Lose it for a few seconds and it gives up and searches where it last saw you. The **Furious Head** (red) sprints in bursts and pants in between; the **Giant Head** fills the corridor; the **Ghost Head** floats slowly through walls; the **Angry Queen** (the BOSS) always knows where you are. When a head is after you the screen's edges pulse red, an arrow points at it, a heartbeat thumps faster as it closes in and the music turns into a chase.
- **Getting caught**: the head lunges into the camera ("Haha!"), and you're back at your checkpoint; the head that got you cackles and vanishes home in a puff, so it is never waiting where you come back. **"Keep going?"** puts you back where you were for a few Coins (3 to 33).
- **Escaping** pays the stage's Coins (15 to 230, the BOSS 400), **x2 the first time**, and opens the next stage; the ESCAPED! card counts down into it. The BOSS door opens after 6 escapes.

| # | Stage | Size | Heads | Extras | Coins |
|---|---|---|---|---|---|
| 1 | Basement | 8x8 | 2 | lookouts, every junction arrowed | 15 |
| 2 | Storage Rooms | 9x9 | 3 | the first bridge | 20 |
| 3 | The Sewers | 9x10 | 3 | slime | 30 |
| 4 | Boiler Room | 10x10 | 2 + a Furious Head | | 40 |
| 5 | Haunted Library | 10x11 | 3 + Furious | a bridge with a gap | 55 |
| 6 | Abandoned Hospital | 11x11 | 2 + Furious + Ghost | a key | 70 |
| 7 | Creepy Kitchen | 11x12 | 2 + 2 Furious | slime | 90 |
| 8 | Toy Playroom | 12x12 | 2 + Furious + Giant | a key | 110 |
| 9 | Midnight Graveyard | 12x13 | 2 + Furious + Ghost + Giant | night | 135 |
| 10 | Frozen Ice Cave | 13x13 | 3 + Furious + Giant | ice, a key | 160 |
| 11 | Lava Dungeon | 13x14 | 2 + 2 Furious + Giant + Ghost | lava cracks | 190 |
| 12 | The Attic | 14x14 | 3 + 2 Furious + Giant + Ghost | a key | 230 |
| BOSS | The Throne | 11x11, open | the Angry Queen + 3 | three keys | 400 |

The heads get a little faster each stage (12.5 up to 16.5 studs/s): a plain head is always slower than you walk (18), a Furious Head's bursts are faster than walking but slower than your sprint, and slime and ice slow the heads down as well (ghosts float over them).

- **Gear** (one in your hand at a time; Coins): Speed Coil (25, +35% speed), Gravity Coil (60, floaty high jumps), Troll Slap (120, slaps a head away, it's dazed for 3 s; or slap players), Jetpack (200, hold Jump to fly up), Angel Wings (350, glide and jump again in mid-air), Super Coil (700, faster and higher), Rocket Launcher (1,200, blast a head from far away), and the limited Scythe and Invisibility Potion (free after 20 / 35 minutes of play, or 2,500 / 3,000).
- **Hats** multiply your Coins: Pumpkin Hat x1.1 (100), Angry Mask x1.25 (400), Valkyrie Helm x1.5 (1,000), Dominus x2 (2,500).
- **Become the Angry Head** (100 Coins, the reference's): you turn into a giant head; go into any stage you've opened and catch the players running through it (+5 Coins each).
- **Boosts** (the quick buttons on the left, like the reference's): Guide Arrows for 45 s (20: glowing arrows all the way to the EXIT), No Damage for 1 minute (40), Jump Higher for 1 minute (15); x2 Coins for 15 minutes (150); x2 Coins forever (5,000). Trails.
- **Rewards**: playtime gifts at 1, 3, 5, 8, 12, 15, 20, 25, 30, 45 and 60 minutes (a chip under your Coins counts down to the next one; tap it to claim), daily rewards for a 7-day streak (a Pumpkin Hat on day 7; they pop up after your first escape, never in a maze), codes (`ANGRY`, `HEAD`, `ESCAPE`, `LEGION`, `BLOXITY`, `RELEASE`), Friend Boost (+10% Coins per Bloxity friend in the server, up to +50%).
- **The line at the top** always says what to do next ("Go through the Stage 3 door!", "Find the key (0/1), then the EXIT!", "RUN! A head is after you!").

## Controls

| Action | Keyboard / mouse | Controller | Touch |
|---|---|---|---|
| Move | WASD / arrows | Left stick | Joystick |
| Jump / jetpack / glide | Space | A | JUMP |
| Sprint | Shift | LT/RT | Sprint |
| Use your tool / a prompt | Click, E or F | X | the tool button |
| Tools | 1-9 | LB / RB | Hotbar |
| Climb a truss | Walk into it | Push into it | Push into it |
| Camera | Drag, wheel to zoom | Right stick, D-pad | Drag |

On phones and controllers the camera swings round behind you as you run (on or off in Settings).

## Sound

- **Music**, "Angry Head Chase": an original code-generated 128 BPM piece in A minor. It creeps in (a music box picking out the chords, pizzicato bass, a clock ticking), stalks (a heartbeat kick, a wobbly theremin tune, an organ), chases (four-on-the-floor kick, snare, hats, driving strings, a plucky lead), breaks down to a ghostly choir and chases again an octave up; 64 bars. The lobby is gentle, a maze adds the stalking layers, and a head after you brings the whole chase in, with a heartbeat that speeds up as it closes in.
- All effects synthesized: the heads' scream and "HA-HA-HA!", growls, the stage sting, creaky doors, keys, coins, rockets and booms, slaps and slashes, the escape fanfare, footsteps on concrete, planks, trusses, ice, grass, snow, carpet, metal and slime.

## Graphics and performance

- **The heads**: our own cartoon Angry Head, built in code as one mesh (a big round face, a blonde bowl cut with thick locks, bulging eyes, angry brows, a red-lipped mouth screaming wide open with rows of teeth and a tongue). The jaw, the pupils and the brows move in the vertex shader: the jaw chomps as it hunts and cackles when it gets you, the eyes follow you, and the head bobs, squashes and rocks as it bounds along. Five looks: blonde, the furious red one, the grey giant, the see-through blue ghost and the crowned queen. One draw call each.
- **Thirteen themes**, each with its own walls and floor drawn in code (concrete, planks, bricks, riveted metal, bookshelves, hospital tiles, kitchen tiles, toy blocks, hedges, ice, stone, wallpaper), its own props in the dead ends (crates and barrels, boilers and pipes, bookshelves and candles, beds, fridges, teddy bears and ducks, tombstones, ice crystals, braziers...), sky and fog (an overcast basement, a moonlit graveyard, a red lava glow...), caged wall lamps that flicker, posters ("RUN!", "DON'T LOOK BACK", "MISSING"), cobwebs. Every wall and floor has a normal map, so bricks, planks and rivets catch the light.
- The **lighting is the top games'** (hemisphere 1.1, ambient 0.45, sun 1.5, PCF shadows, no tone mapping) everywhere; a place's mood only tints it.
- **Built for weak PCs and phones**: only matte (Lambert) and unlit materials, no reflections, no environment map, no post-processing (the vignette and the chase edges are CSS; the jumpscare is a second pass over the frame). Each maze's walls, floors, trims and props are merged per material (a handful of draw calls), and only the place you're in is drawn; the lamps of a place are one point cloud, the coins one instanced mesh, the bats one mesh moved in the vertex shader. Every shader is compiled and every texture uploaded behind the loading screen. Phones and weak PCs start on Low.
- **Quality presets** (Settings): Low draws at 1x pixel ratio with its shaders built without any shadow code (about half the per-pixel work on a phone); Medium 1.25x with 1024 shadows; High 2x with 2048 shadows. If the frame rate drops the game steps down on its own, but only by fading shadows out, never by rebuilding shaders mid-game.
- Each head has a soft coloured glow on the floor under it (red, blue for the ghost, pink for the queen) that flares while it hunts you, its eyes burn red (icy blue for the ghost, gold for the Queen) while it is after you, and it kicks up dust when it lands from a bound.
- Every caged wall lamp throws a soft, flickering beam of light down to the floor (one mesh per maze; Medium and High only).

## Multiplayer and saves

- One shared `angry` room (up to 24 players). Movement is client-side. The heads are simulated on the server, only in the mazes someone is in, and each maze's heads are sent 20 times a second only to the players in it; clients draw them 110 ms in the past, smoothly between snapshots, and decide when they're caught by what they see. Runs, checkpoints, coins, keys, escapes (a run must take at least 8 s or 12% of the stage's par time, so teleporting can't cheat it), pickups (each sent with a fresh position; if the server is missing a key when you reach the EXIT it tells your game, and the key shows up again), catches, revives, hits, the morph's catches and every purchase are checked by the server.
- Progress is saved per browser or per Bloxity account: MongoDB on Legion (`MONGODB_URI`), `server/data/profiles.json` locally; saved within 1.5 s of escapes and purchases and every 10 s.
- Play stats: `GET /api/stats?key=<stats key>&days=7` (the key is in `server/STATS_KEY.local.txt`, not in the repo; locally the stats are open): session lengths (phones and desktop apart), how far players get, deaths, escapes, purchases, FPS.

## Deploy (Bloxity hosting)

Pushing `main` (prod) or `dev` runs `.github/workflows/deploy.yml`: server image `ghcr.io/asivixlp44-cmyk/escape-angry-head-server`, Legion rollout, client upload. Play at https://escape-angry-head.play.bloxity.io once the app `escape-angry-head` exists on hosting.bloxity.io and the repo has the `LEGION_DEPLOY_TOKEN` secret.
