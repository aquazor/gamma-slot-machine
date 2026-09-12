import { memo, useState } from 'react';

// Curated by hand from git history — not auto-generated, so entries read
// like something a streamer would actually care about instead of raw
// commit messages. Add a new { date, items } entry (newest first) when
// something worth mentioning ships.
const CHANGELOG: { date: string; items: string[] }[] = [
  {
    date: '2026-09-13',
    items: [
      'New subs, resubs and gift subs now always roll loot: 2 items for a single sub, 3 items for a multi-sub gift (any size)',
    ],
  },
  {
    date: '2026-09-12',
    items: [
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
