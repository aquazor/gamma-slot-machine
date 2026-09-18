import { memo, useState } from 'react';

// Curated by hand from git history — not auto-generated, so entries read
// like something a streamer would actually care about instead of raw
// commit messages. Add a new { date, items } entry (newest first) when
// something worth mentioning ships.
const CHANGELOG: { date: string; items: string[] }[] = [
  {
    date: '2026-09-17',
    items: [
      'Added a "Mod install" section in Settings — install or uninstall the mod directly into your Anomaly folder in one click, with a native folder browser for GAMMA/Anomaly if auto-detection can\'t find them. Manual installs into GAMMA\\mods keep working too',
      'Fixed loot, spawns and Positive Effects not being delivered when launching the game directly (bypassing the GAMMA launcher/MO2) instead of only when launched normally',
      'Added a short delay right after starting or loading a game before anything queued gets delivered, so other mods have time to finish their own startup first',
      'The app\'s console now shows a clear warning if it can\'t find your GAMMA or Anomaly folder, and if an install/uninstall attempt fails',
      'Channel-point rewards no longer force themselves back on every time the app restarts if you\'d turned them off — added an "Auto-activate on startup/connect" checkbox in Settings for streamers who want that behavior back',
    ],
  },
  {
    date: '2026-09-15',
    items: [
      'Spawn Bonuses and Positive Effects settings moved off the main Settings page onto their own new "Tweaking" page — linked from the navbar and from a shortcut on Settings itself',
      'Positive Effects now show the same card layout as Spawn Bonuses, with each effect\'s own roll chance editable as a percentage, not just enable/disable',
      'Added a "Restore defaults" button to both the Spawn Bonuses and Positive Effects sections — resets every chance and re-enables everything in one click',
      'Removed the old Bits/cheer chat-command reward system entirely; Bits Power-ups (the native Twitch kind) are untouched and still work exactly the same',
      'Fixed Give Ammunition\'s in-game message showing a garbled symbol instead of "×", and renamed its wording from "mag(s)" to "pack(s)"',
      'The Bits Power-ups list in Settings and the setup guide now include "[SPIN] Positive Effects", which had been missing since that reward was added',
      'Bits Power-ups now always roll the best case: Spawn Squads/Mutants and Loot Roll always give the max of 3, and every Power-up that can land a bonus (spawn bonuses and positive effects) always lands one',
    ],
  },
  {
    date: '2026-09-14',
    items: [
      'Added a second spawn mode, "Count Roll" — one reel rolls how many, a separate reel rolls what shows up, instead of Random\'s independent per-item rolls; switch between them in Settings, and it\'s now the default mode for new sessions',
      'Count Roll spawns have a chance of a bonus: double the count, +2 to the count, or a Tier Upgrade (spawns something from the tier above instead) — each shown right on the overlay, and each can be toggled on/off separately in Settings',
      'A multi-sub gift bomb in Count Roll mode now always lands a bonus, picked from whichever bonuses are currently enabled',
      'The overlay glows gold and pulses when a bonus lands, so it reads as special at a glance',
      'Manual spawn buttons in Settings collapse to one button per category while Count Roll is active (the ×2/×3 versions only make sense in Random mode)',
      'Fixed a bug where disabling a squad in Settings while on one spawn mode wouldn\'t carry over to the other mode — squad on/off is now shared between Random and Count Roll',
      'Count Roll now shows a separate spinning reel for the count, landing on the roll before any bonus (e.g. "x2 (x2 bonus)") with the final total shown underneath — matches the species reel next to it',
      'Bonus chances are now editable per bonus in Settings, as a percentage — and the values you set now survive a server restart',
      'If enabled bonus chances add up to 100% or more, a bonus always lands and each one gets its fair share proportional to its own chance — instead of the first bonus in the list quietly hogging all the odds',
      'The Tier Upgrade bonus result now reads "(Tier upgrade)" on the overlay instead of "(RARE bonus)"',
      'Fixed a bug in Settings where editing one bonus\'s chance and then toggling a different bonus\'s checkbox could silently discard the unsaved edit',
      'Added a new roll outcome, "Positive Effects" — Immortality, Give Ammunition, Give Money, or Medicine, picked at random (weighted odds among whichever ones are enabled in Settings). Triggered by its own channel-point reward and bits power-up ("[SPIN] Positive Effects"), and now also part of the random pool subs/resubs/gift subs can land on',
      'Positive Effects now roll a second reel for the specific amount — how many seconds of Immortality, how many magazines of ammo, how much money, or which medical item — instead of a single fixed value every time',
      'Positive Effects now have their own chance of a bonus on top: extra seconds or doubled duration for Immortality, +1/+2 magazines for Give Ammunition, doubled or extra cash for Give Money, and an extra medical item for Medicine — shown right on the overlay',
    ],
  },
  {
    date: '2026-09-13',
    items: [
      'Channel-point rewards consolidated to 3: Spawn Squads, Spawn Mutants, Loot Roll — each now rolls a random 1-3 instead of needing separate x1/x3 rewards',
      'Subs, resubs and gift subs now roll loot OR a squad OR a mutant pack (equal odds), with a random 1-3 count — a multi-sub gift still always rolls exactly 3',
      'Sin, UNISG and Monolith are now Expert-tier only, and shown under their own "Expert tier only" heading in Settings',
      'Manual spawn buttons in Settings split into separate Mutants / Squads rows, each with ×1/×2/×3',
      'Added support for Twitch Custom Power-ups (bits) — create one manually on Twitch named "[SPIN] Spawn Squads" / "[SPIN] Spawn Mutants" / "[SPIN] Loot Roll" and it rolls that category, random 1-3, same as its channel-point counterpart',
      'Added a step-by-step Bits Power-ups Setup Guide page (linked from Settings and the navbar), with screenshots and one-click copy buttons for each reward name',
      'The overlay now shows a colored badge for what triggered the roll — Channel Points, Bits, New Sub, Resub, Gift Sub, or Manual — so look-alike rewards from different sources are easy to tell apart',
    ],
  },
  {
    date: '2026-09-12',
    items: [
      'New subs, resubs and gift subs now always roll loot: 2 items for a single sub, 3 items for a multi-sub gift (any size)',
      'Channel-point reward titles on Twitch now start with "[SPIN]" so they stand out in your rewards list',
      'Fixed a bug where restarting the server could briefly show the wrong enabled/disabled state in Settings',
      'Added Sin and UNISG as spawnable enemy factions',
      'Settings page redesigned: clearer collapsible sections, an active-rewards counter, fewer background requests',
      'More reliable Twitch reconnects after the app has been closed for a long time',
    ],
  },
  {
    date: '2026-09-11',
    items: [
      'Added mutant pack and hostile squad spawns, with Basic/Advanced/Expert tiers',
      'More enemy factions and bits/channel-point spawn rewards',
    ],
  },
  {
    date: '2026-09-09',
    items: [
      'Channel-point rewards for the loot roulette, with editable cost/limit/cooldown',
      'Loot tier presets and a one-click enable/disable switch for all rewards',
    ],
  },
  {
    date: '2026-09-08',
    items: [
      'First Twitch integration: connect your account, and subs/gift subs/bits/channel points trigger the roulette live',
      'Added the Settings page and the OBS browser-source overlay',
    ],
  },
  {
    date: '2026-08-26 — 2026-09-02',
    items: [
      'Core loot system: weapons, outfits and helmets with icons, ammo fixes, visual polish',
    ],
  },
];

function Changelog() {
  const [collapsed, setCollapsed] = useState<boolean>(true);

  return (
    <section className="set-section">
      <button
        className="set-heading set-heading--toggle"
        onClick={() => setCollapsed((prev) => !prev)}
      >
        <span className={`set-chevron ${collapsed ? '' : 'is-open'}`}>▸</span>
        Changelog
      </button>

      {!collapsed && (
        <div className="set-changelog">
          {CHANGELOG.map((entry) => (
            <div className="set-changelog-entry" key={entry.date}>
              <div className="set-changelog-date">{entry.date}</div>
              <ul className="set-changelog-items">
                {entry.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default memo(Changelog);
