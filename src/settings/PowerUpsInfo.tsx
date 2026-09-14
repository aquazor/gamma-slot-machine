import { memo, useState } from 'react';

import { copyToClipboard } from './clipboard';

// Purely informational — Twitch's Custom Power-ups have no create/manage
// API yet (only a read-only list), so there's nothing here to configure
// from this app. The titles below must match roulette.cjs's
// CUSTOM_POWER_UPS exactly (case-sensitive) for a redemption to be
// recognized; the Bits price is set on Twitch and doesn't matter here.
const POWER_UPS = [
  { title: '[SPIN] Spawn Squads', does: 'Spawns 1-3 hostile squads' },
  { title: '[SPIN] Spawn Mutants', does: 'Spawns 1-3 mutant packs' },
  { title: '[SPIN] Loot Roll', does: 'Rolls 1-3 loot items' },
  { title: '[SPIN] Positive Effects', does: 'Rolls one of the four positive effects' },
];

function PowerUpsInfo() {
  const [collapsed, setCollapsed] = useState<boolean>(true);
  const [copiedTitle, setCopiedTitle] = useState<string | null>(null);

  const copyTitle = async (title: string): Promise<void> => {
    await copyToClipboard(title);

    setCopiedTitle(title);
    window.setTimeout(() => setCopiedTitle((prev) => (prev === title ? null : prev)), 1500);
  };

  return (
    <section className="set-section">
      <button
        className="set-heading set-heading--toggle"
        onClick={() => setCollapsed((prev) => !prev)}
      >
        <span className={`set-chevron ${collapsed ? '' : 'is-open'}`}>▸</span>
        Bits power-ups
      </button>

      {!collapsed && (
        <>
          <p className="set-muted">
            Twitch Custom Power-ups aren&apos;t created or managed from here — Twitch
            doesn&apos;t offer that yet, only reading a list back. Create each one by hand
            under your channel&apos;s Viewer Rewards → Custom Power-ups, using the exact
            title below (the Bits price is entirely up to you, it isn&apos;t checked).
          </p>

          <p className="set-muted">
            New to Custom Power-ups? There&apos;s a full step-by-step guide with
            screenshots for creating these on Twitch.
          </p>

          <a className="set-link" href="/bits-guide">
            <span className="set-link-icon">📖</span>
            Bits power-ups setup guide
          </a>

          <div className="set-rewards set-rewards--powerups">
            {POWER_UPS.map((powerUp) => (
              <div className="set-reward" key={powerUp.title}>
                <span className="set-reward-title">{powerUp.title}</span>
                <p className="set-muted">{powerUp.does}, random each time.</p>
                <button
                  className="set-btn set-obs-copy"
                  onClick={() => copyTitle(powerUp.title)}
                >
                  {copiedTitle === powerUp.title ? 'Copied!' : 'Copy name'}
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export default memo(PowerUpsInfo);
