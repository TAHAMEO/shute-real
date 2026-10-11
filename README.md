# SHUTE REAL — Tactical Combat

A realistic first-person military shooter in the style of Arma 3, Escape from Tarkov and
Squad. It runs in the browser on **Kali Linux** (and any other Linux, Windows or macOS) and
uses GPU 3D graphics through WebGL 2. Play **solo against AI bots** or **multiplayer with
your friends** over your local network or the internet.

![Highland Valley](docs/screenshots/valley.png)

## Features

- **3 large maps**, generated from fixed seeds so every player gets exactly the same world:
  - **Highland Valley** (1.6 km): golden-hour grassland ringed by mountains, with tall pines, granite boulders, a farm, a radio hill, ruins, a hamlet and an army camp.
  - **Forest Outpost** (1.2 km): a timber village, a fortified compound of T-walls, containers and guard towers, a sawmill and dense birch and spruce forest.
  - **Ashen Ridge** (2 km): an overcast alpine plateau with jagged rock spires, a research outpost and a mysterious signal tower with a red glow. Long sight lines suit snipers.
- **29 guns plus equipment**, each modelled in 3D with its own handling:
  - **Assault rifles:** M4A1, HK416, AK-47, AK-74M, SCAR-H, AUG A3, F2000, G36C
  - **SMGs:** MP5A3, P90, Vector .45, UMP45, MP7
  - **LMGs:** M249 SAW, PKM
  - **Marksman rifles:** SVD Dragunov, Mk14 EBR, M110 SASS
  - **Sniper rifles:** M24, AWM, Barrett M82A1
  - **Shotguns:** Remington 870, M1014, Saiga-12
  - **Pistols:** Glock 18C, M9, M1911, Desert Eagle, .357 Revolver
  - **Equipment:** frag grenades, smoke grenades and a combat knife
- **Attachments:**
  - Optics: iron sights, red dot, holographic sight, 4x ACOG, PSO-1 and an 8x sniper scope. Magnified optics show a real zoomed picture inside the lens.
  - Compensator and suppressor.
  - Vertical and angled grips.
- **Realistic ballistics:**
  - Bullet travel time and bullet drop, with scope zeroing from 100 to 1000 m.
  - Penetration through wood and sheet metal.
  - Damage drop-off with distance; headshot, body and limb damage zones.
  - Recoil, weapon sway, spread that grows with movement, and aim down sights.
  - Bolt-action and pump-action cycling, plus magazine and shell-by-shell reloads.
- **Movement:**
  - Sprint, crouch, prone, jump and lean (Q/E).
  - Fall damage.
  - Footstep sounds that change with the surface.
- **"Ultra" graphics:**
  - Physically based materials and image-based lighting.
  - Sharp sun shadows near and far.
  - Ambient occlusion (GTAO), god rays, bloom, aerial fog and filmic tone mapping.
  - SMAA anti-aliasing.
  - Wind-animated grass and trees, and dynamic clouds.
  - Muzzle flashes that light the scene, tracers, impacts, decals, shell casings, explosions and smoke.
- **Competitive-shooter features:**
  - Free-for-all and team deathmatch.
  - Kill feed, scoreboard (Tab), hit markers, damage direction indicators, compass, minimap and full map (M).
  - Spawn protection, assists, kill streaks and multi-kills.
  - Chat (T, or Y for team chat) and a loadout editor with a 3D weapon preview.
- **AI bots in three difficulties:**
  - They path-find around obstacles, take cover, strafe and use burst fire.
  - They hear gunfire, hunt you down and throw grenades.
- **Procedural audio:** every gunshot, echo, footstep and ambient sound is synthesised in code. Sounds are positional, and distant shots echo and arrive late.
- **No downloads during play:** everything is generated in code. The only dependencies are `three` (3D) and `ws` (WebSockets).

## Quick start on Kali Linux

```bash
git clone https://github.com/TAHAMEO/shute-real.git
cd shute-real
./install.sh      # installs Node.js if needed + the game, adds a menu launcher
./start.sh        # starts the server and opens the game
```

`start.sh` starts the game server and opens the game in your browser in app mode. You can
also open `http://localhost:7777` yourself in Firefox or Chromium. If you open the address
yourself, click the game window to lock the mouse, then press **Esc** to get the cursor back.

### Graphics performance (important for Kali in a VM)

The game needs **hardware 3D acceleration**. In VirtualBox or VMware, enable 3D
acceleration in the VM's display settings and install the guest additions. Without a GPU the
browser renders on the CPU (SwiftShader or llvmpipe). The game detects this and drops to the
**Low** preset, but it will still be slow.

- **Chromium:** `start.sh` passes `--ignore-gpu-blocklist`, because Linux drivers are often blocklisted.
- **Firefox:** if WebGL is disabled, set `webgl.force-enabled = true` in `about:config`.
- **Graphics presets:** Low, Medium, High and Ultra are under **Settings → Graphics**.
  - Ultra adds 4096 shadow maps, dense grass, AO and god rays.
  - If your frame rate is low, lower **Render scale** or **Grass density**.

## Playing with friends

1. One player runs `./start.sh` (or `./server.sh` on a machine that only hosts).
2. The server prints the addresses to share, for example:
   ```
   Play on this computer:   http://localhost:7777
   Friends on your network: http://192.168.1.23:7777
   ```
3. Friends open the network address in their browser, go to **Multiplayer** and join a room.
   They can also create their own room with a map, mode, bot count and difficulty.

Two public rooms are always available:
- "Highland Valley · TDM" with 8 bots
- "Forest Outpost · FFA" with 6 bots

Bots fill empty slots and leave to make room for human players.

**Over the internet:** forward TCP port 7777 on the host's router, or use a VPN mesh such
as Tailscale or ZeroTier. With a VPN, everyone connects to the host's VPN IP.

Server options:
```bash
./server.sh --port 7777 --name "Friday Night Ops"     # dedicated server
PORT=8000 ./start.sh                                   # different port
```

## Controls

| Key | Action | Key | Action |
|---|---|---|---|
| W A S D | Move | Mouse 1 | Fire |
| Shift | Sprint | Mouse 2 | Aim down sights |
| Space | Jump / stand up | R | Reload |
| C / Ctrl | Crouch | B | Fire mode (auto/burst/semi) |
| Z | Prone | 1 / 2 / wheel | Primary / sidearm |
| Q / E | Lean left / right | G | Throw frag grenade |
| PageUp / PageDown | Scope zeroing | 4 / H | Throw smoke grenade |
| Tab | Scoreboard | V | Knife |
| M | Map | T / Y | Chat / team chat |
| I | Inspect weapon | F1 | Toggle HUD |
| Esc | Pause menu (loadout, settings, leave) | | |

## Project layout

```
server/      Node.js HTTP + WebSocket game server (rooms, lobby)
shared/      code used by both server and browser:
             world generation, terrain, collision, physics, hitboxes,
             weapons, game rules (room.js), bot AI (bot.js), navigation (nav.js)
client/      the game (Three.js): engine/ (renderer, input, audio), world/ (sky, terrain,
             grass, trees, rocks, buildings), game/ (player, weapons, viewmodel, effects,
             networking), models/ (procedural guns and soldiers), ui/ (menus, HUD)
client/dev/  developer preview pages (weapons, soldiers, vegetation, audio, UI, world)
tests/       unit + integration tests (npm test)
tools/       headless-browser screenshot and play-test scripts
```

The server runs the authoritative match: it validates hits, damage and fire rate, and it
simulates bots and grenades. Solo mode runs the same match code in your browser, so solo
works without a server.

## Development

```bash
npm test                     # unit + integration tests
npm run dev                  # server with caching disabled
node tools/play-test.mjs --url http://localhost:7777/      # headless solo smoke test
node tools/mp-test.mjs       # multiplayer end-to-end test
```

Developer pages (served by the server):
- `/dev/world.html?map=valley&poi=farm`
- `/dev/weapons.html`
- `/dev/soldiers.html`
- `/dev/vegetation.html`
- `/dev/audio.html`
- `/dev/ui.html`

## Credits and licenses

- Game code: MIT.
- [three.js](https://threejs.org): MIT.
- [ws](https://github.com/websockets/ws): MIT.
- Fonts Rajdhani and Barlow Condensed: SIL Open Font License, see `client/fonts/`.

All models, textures and sounds are generated procedurally by the game's own code.
