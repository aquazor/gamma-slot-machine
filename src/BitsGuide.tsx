import { useState } from 'react';
import './Settings.css';
import './BitsGuide.css';

import Navbar from './Navbar';
import { copyToClipboard } from './settings/clipboard';

const POWER_UP_TITLES = ['[SPIN] Spawn Squads', '[SPIN] Spawn Mutants', '[SPIN] Loot Roll'];

const STEPS = [
  {
    image: '/bits-guide/bits-guide-step1.jpg',
    text: 'Click your profile icon, then Creator Dashboard.',
  },
  {
    image: '/bits-guide/bits-guide-step2.jpg',
    text: 'In the left sidebar: Viewer Rewards → Power-ups & Channel Points, then Manage Power-ups & Channel Points.',
  },
  {
    image: '/bits-guide/bits-guide-step3.jpg',
    text: 'Scroll down to Custom Power-ups and click Create a Custom Power-up.',
  },
  {
    image: '/bits-guide/bits-guide-step4.jpg',
    text: 'Copy one of the three names below, paste it as the Power-up Name, and set any Bits cost you like (10-10,000 — it isn’t checked).',
    showNames: true,
  },
  {
    image: '/bits-guide/bits-guide-step5.jpg',
    text: 'Cooldowns & limits are optional. Click Create — then repeat for the other two names.',
  },
  {
    image: '/bits-guide/bits-guide-step6.jpg',
    text: 'Once all three are created, they should show up enabled in your Custom Power-ups list — you’re done.',
  },
];

interface PowerUpNamesProps {
  copiedTitle: string | null;
  onCopy: (title: string) => void;
}

function PowerUpNames({ copiedTitle, onCopy }: PowerUpNamesProps) {
  return (
    <div className="set-rewards set-rewards--powerups">
      {POWER_UP_TITLES.map((title) => (
        <div className="set-reward" key={title}>
          <span className="set-reward-title">{title}</span>
          <button className="set-btn set-obs-copy" onClick={() => onCopy(title)}>
            {copiedTitle === title ? 'Copied!' : 'Copy name'}
          </button>
        </div>
      ))}
    </div>
  );
}

export default function BitsGuide() {
  const [copiedTitle, setCopiedTitle] = useState<string | null>(null);

  const copyTitle = async (title: string): Promise<void> => {
    await copyToClipboard(title);

    setCopiedTitle(title);
    window.setTimeout(() => setCopiedTitle((prev) => (prev === title ? null : prev)), 1500);
  };

  return (
    <>
      <Navbar />

      <div className="set-root">
        <div className="set-card">
          <a className="set-back" href="/settings">
            ← Back to Settings
          </a>

          <h1 className="set-title">Bits Power-ups Setup Guide</h1>

          <p className="set-muted bits-guide-intro">
            Twitch doesn&apos;t let apps create Custom Power-ups yet, so these three have to
            be made by hand, once, from your Creator Dashboard — about a minute each.
          </p>

          <ol className="bits-guide-steps">
            {STEPS.map((step) => (
              <li className="bits-guide-step" key={step.image}>
                <p className="bits-guide-step-text">{step.text}</p>
                {step.showNames && (
                  <div className="bits-guide-step-names">
                    <PowerUpNames copiedTitle={copiedTitle} onCopy={copyTitle} />
                  </div>
                )}
                <img src={step.image} alt={step.text} />
              </li>
            ))}
          </ol>
        </div>
      </div>
    </>
  );
}
