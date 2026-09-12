# GAMMA Loot Roulette

A local Windows app for S.T.A.L.K.E.R.: GAMMA streamers. It ships as a single
`.exe` (Node.js server + React frontend) and does two things:

- **Weapon/Armor Slot Machine** (`/`) — a manual, spin-to-decide loadout
  roller for weapons, outfits and helmets. Roll a loadout, then hand it
  straight to your character in-game with one click.
- **Loot Roulette** (`/overlay` + `/settings`) — a Twitch-integrated
  roulette. Subs, resubs, gift subs, bit cheers and channel-point
  redemptions trigger a slot-machine roll live on stream, which then hands
  the streamer loot or spawns a hostile squad / mutant pack in-game.

Everything runs locally — there's no external server, no data leaves the
streamer's PC except the direct calls to Twitch's own API.

## How the Loot Roulette works

```
Twitch (EventSub)  →  server.cjs / roulette.cjs  →  command.txt  →  Lua bridge (in-game)
                              │
                              └──  Server-Sent Events  →  /overlay (OBS Browser Source)
```

1. A Twitch event comes in over EventSub (WebSocket) — a sub, gift sub,
   cheer, or a channel-point redemption.
2. `roulette.cjs` decides what the event should roll: a loot item, or a
   mutant/enemy spawn (see `enemies.cjs` + `enemies.data.json` for the spawn
   pools and per-faction toggles).
3. The result is pushed to the `/overlay` page over Server-Sent Events, so
   the slot-machine animation plays live in OBS, and written as plain-text
   commands to `command.txt` inside the GAMMA mod folder.
4. A Lua script polling that file in-game (`add_weapon.script`, not part of
   this repo — copied into the mod's `gamedata/scripts/` once) reads the
   commands and gives the item / spawns the squad.

The `/settings` page is where the streamer connects their Twitch account,
tunes channel-point reward cost/limits/cooldowns, enables or disables enemy
factions, and manually triggers a roll for testing.

## Requirements

- Node.js (LTS) for development
- A running GAMMA installation with this mod's Lua bridge script installed
  (see below) if you want commands to actually reach the game
- A Twitch account for the streamer to connect (Device Code flow — no
  client secret needed)

## Development

```bash
npm install
npm run dev      # Vite dev server for the frontend
node server.cjs  # Express backend on http://localhost:7770
```

Open `http://localhost:5173` (or whatever port Vite picks) for the slot
machine, `/settings` and `/overlay` for the Twitch-side pages. The frontend
talks to the backend directly at `http://localhost:7770`.

Useful checks while working on the frontend:

```bash
npx tsc -b        # type-check
npx eslint .      # lint
npx vite build    # production build
```

## Twitch setup

The app registers itself with a public Twitch Client ID (`config.cjs`) using
the OAuth **Device Code Flow** — no client secret is embedded in the
distributed `.exe`. On `/settings`, clicking "Connect Twitch" shows a code to
enter at twitch.tv/activate; once approved, the app stores the access/refresh
token pair under `%USERPROFILE%\.gamma-slot-machine\`.

Scopes requested: `bits:read`, `channel:read:subscriptions`,
`channel:manage:redemptions`.

Channel-point rewards are created and kept in sync automatically
(`twitch-rewards.cjs`) — their structure (title, category, roll count) is
fixed in `config.cjs`; only cost, per-user limit, cooldown and enabled state
are streamer-editable from `/settings`, stored as overrides next to the
token file so they survive reinstalls of the app itself.

## Installing the in-game Lua bridge

This repo only produces `command.txt` — reading it in-game needs a Lua
script (`add_weapon.script`) copied into the mod's own folder structure:

```
<GAMMA>/mods/GAMMA Randomizer Slot Machine by rip_perri/gamedata/scripts/bridge/command.txt
```

The script polls that file every couple of seconds and clears it once
processed. It is maintained and copied in manually rather than tracked in
this repo, since it lives inside the (large, MO2-managed) GAMMA install.

## Building the distributable `.exe`

```bash
npm run package
```

This bundles the server with esbuild, generates a Node.js Single
Executable Application, injects the frontend build, and applies the app
icon via Resource Hacker. Output goes to `build/GAMMA Slot Machine.exe`.
Requires Node.js, Resource Hacker, and `esbuild`/`postject`/`rcedit`
(already in `devDependencies`).

## Project layout

```
src/
  App.tsx           manual weapon/armor slot machine (/)
  Overlay.tsx        OBS browser-source overlay (/overlay)
  Settings.tsx        Twitch connection + roulette settings (/settings)
  settings/           Settings page split by section (rewards, bits, factions, ...)
  constants/          static weapon/outfit/helmet data for the manual slot machine

server.cjs            Express server — HTTP API + Twitch EventSub wiring
roulette.cjs           picks what an event rolls (loot vs. spawn)
enemies.cjs / enemies.data.json   mutant & enemy spawn pools, per-faction toggles
twitch-auth.cjs        Device Code auth flow, token storage/refresh
twitch-eventsub.cjs    Twitch EventSub WebSocket client
twitch-rewards.cjs     channel-point reward creation/sync + streamer overrides
bits-rewards.cjs       bits-cheer → roll threshold ladder
gamma-bridge.cjs       finds the GAMMA install, writes command.txt
config.cjs             Twitch client id/scopes, reward definitions, bits tiers
```
