# GAMMA Loot Roulette

Repository: <https://github.com/aquazor/gamma-slot-machine/tree/dev>

A local Windows app for S.T.A.L.K.E.R.: GAMMA streamers. It ships as a single
`.exe` (Node.js server + React frontend) and does two things:

- **Weapon/Armor Slot Machine** (`/`, deprecated) — a manual, spin-to-decide
  loadout roller for weapons, outfits and helmets. Superseded by the
  Twitch-integrated roulette below, kept around for now.
- **Loot Roulette** (`/overlay` + `/settings` + `/tweaking`) — a
  Twitch-integrated roulette. Channel-point redemptions, bits power-ups,
  subs, resubs and gift subs trigger a slot-machine roll live on stream,
  landing on one of three outcomes: loot for the streamer, a hostile squad /
  mutant pack spawn, or a positive effect (temporary invulnerability, a cash
  drop, free ammo, or a medical item).

Everything runs locally — there's no external server, no data leaves the
streamer's PC except the direct calls to Twitch's own API.

## How the Loot Roulette works

```
Twitch (EventSub)  →  server.cjs / roulette.cjs  →  command.txt  →  Lua bridge (in-game)
                              │
                              └──  Server-Sent Events  →  /overlay (OBS Browser Source)
```

1. A Twitch event comes in over EventSub (WebSocket) — a sub, gift sub, a
   bits power-up redemption, or a channel-point redemption.
2. `roulette.cjs` decides what the event should roll: a loot item, a
   mutant/enemy spawn, or a positive effect. Spawns can roll one of two ways
   (switchable live in Settings):
   - **Random mode** (`enemies.cjs` + `enemies.data.json`) — independently
     rolls 1-3 groups, each with its own count.
   - **Count Roll mode** (`enemies-mode2.cjs` + `enemies.mode2.data.json`,
     default) — one dual-slot roll (how many + which group), with a chance
     of a bonus (double count, +2, or a tier upgrade).
   Positive effects (`positive-effects.cjs` + `positive-effects.data.json`)
   are a separate dual-slot roll: which effect (Immortality / Give Ammo /
   Give Money / Medicine), then that effect's own rolled value, with its own
   chance of a bonus.
3. The result is pushed to the `/overlay` page over Server-Sent Events, so
   the slot-machine animation plays live in OBS, and written as plain-text
   commands to `command.txt` inside the GAMMA mod folder.
4. A Lua script polling that file in-game (`slot_machine_bridge.script`, not part of
   this repo — copied into the mod's `gamedata/scripts/` once) reads the
   commands and gives the item, spawns the squad, or applies the effect
   (temporary god mode, money, ammo, or a medical item).

The `/settings` page is where the streamer connects their Twitch account,
tunes channel-point reward cost/limits/cooldowns, switches spawn/roll mode,
enables or disables enemy factions, and manually triggers a roll for
testing. Spawn-bonus and positive-effect chances (enable/disable, per-effect
odds, "Restore defaults") live on their own `/tweaking` page, linked from
Settings and the navbar.

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

**Testing backend logic without starting the server:** `server.cjs` has real
side effects on `require()` (binds port 7770, connects to live Twitch
EventSub) — never `require('./server.cjs')` or run it if you already have an
instance running. Test the actual game/roll logic directly instead:

```bash
node -e "const roulette = require('./roulette.cjs'); console.log(roulette.planForEvent({kind: 'manual'}, null))"
```

`roulette.cjs`, `positive-effects.cjs`, `enemies.cjs`, `enemies-mode2.cjs`
and `config.cjs` are all safe to `require()` directly this way — pure logic,
no ports, no network.

## Twitch setup

The app registers itself with a public Twitch Client ID (`config.cjs`) using
the OAuth **Device Code Flow** — no client secret is embedded in the
distributed `.exe`. On `/settings`, clicking "Connect Twitch" shows a code to
enter at twitch.tv/activate; once approved, the app stores the access/refresh
token pair under `%USERPROFILE%\.gamma-slot-machine\`.

Scopes requested: `bits:read`, `channel:read:subscriptions`,
`channel:manage:redemptions`. `bits:read` is kept solely for Bits Power-up
redemption events — the old bits-cheer roll trigger was removed, so plain
`channel.cheer` is no longer subscribed to.

Channel-point rewards are created and kept in sync automatically
(`twitch-rewards.cjs`) — their structure (title, category, roll count) is
fixed in `config.cjs`; only cost, per-user limit, cooldown and enabled state
are streamer-editable from `/settings`, stored as overrides next to the
token file so they survive reinstalls of the app itself.

Bits Power-ups (`CUSTOM_POWER_UPS` in `config.cjs`) are matched by title the
same way, but Twitch has no create/update/delete API for them yet — the
streamer creates each one by hand on the Twitch dashboard, using the exact
title shown in the in-app `/bits-guide` walkthrough. A bits power-up redemption
always rolls the best case: max count (3) and a guaranteed bonus wherever
one can land.

## Installing the in-game Lua bridge

This repo only produces `command.txt` — reading it in-game needs a Lua
script (`slot_machine_bridge.script`) copied into the mod's own folder structure:

```
<GAMMA>/mods/GAMMA Randomizer Slot Machine by rip_perri/gamedata/scripts/bridge/command.txt
```

The script polls that file every couple of seconds and clears it once
processed, dispatching each line by its prefix: `WEAPON` / `OUTFIT` /
`HELMET` (loot), `SPAWN` (mutants/squads), `GODMODE` / `MONEY` / `AMMO_MAGS`
/ `MEDKIT` (positive effects), and `MSG` (the in-game notification text). It
is maintained and copied in manually rather than tracked in this repo, since
it lives inside the (large, MO2-managed) GAMMA install.

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
  App.tsx              manual weapon/armor slot machine (/, deprecated)
  Overlay.tsx          OBS browser-source overlay (/overlay)
  Settings.tsx         Twitch connection + roulette settings (/settings)
  Tweaking.tsx         spawn-bonus / positive-effect chance tuning (/tweaking)
  About.tsx            what this app does, setup steps, GitHub link (/about)
  BitsGuide.tsx        step-by-step Custom Power-ups setup guide (/bits-guide)
  Navbar.tsx           top nav shared by every page
  api.ts               shared API base URL (http://localhost:7770)
  settings/            Settings page split by section (rewards, integrations, factions, ...)
  constants/           static weapon/outfit/helmet data for the manual slot machine

server.cjs             Express server — HTTP API + Twitch EventSub wiring
roulette.cjs           picks what an event rolls (loot / spawn / positive effect) and runs the delivery queue
enemy-pool.cjs         shared spawn-pool factory (faction toggles, group rolling) behind both spawn modes
enemies.cjs / enemies.data.json               "Random" spawn mode — independent per-group rolls
enemies-mode2.cjs / enemies.mode2.data.json   "Count Roll" spawn mode — dual-slot count+species roll, spawn bonuses
positive-effects.cjs / positive-effects.data.json   Immortality / Give Ammo / Give Money / Medicine roll outcome
twitch-auth.cjs        Device Code auth flow, token storage/refresh
twitch-eventsub.cjs    Twitch EventSub WebSocket client
twitch-rewards.cjs     channel-point reward creation/sync + streamer overrides
gamma-bridge.cjs       finds the GAMMA install, writes command.txt
config.cjs             Twitch client id/scopes, channel-point + bits power-up reward definitions
```
