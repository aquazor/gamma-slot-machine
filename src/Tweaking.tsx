import './Settings.css';

import Navbar from './Navbar';
import PositiveEffects from './settings/PositiveEffects';
import NegativeEffects from './settings/NegativeEffects';
import SpawnBonuses from './settings/SpawnBonuses';

export default function Tweaking() {
  return (
    <>
      <Navbar />

      <div className="set-root">
        <div className="set-card">
          <a className="set-back" href="/settings">
            ← Back to Settings
          </a>

          <h1 className="set-title">🎛️ Tweaking</h1>

          <SpawnBonuses />

          <PositiveEffects />

          <NegativeEffects />
        </div>
      </div>
    </>
  );
}
