import { memo } from 'react';

import type { RouletteStatus } from './types';

interface Props {
  roulette: RouletteStatus | null;
  triggerBusy: boolean;
  selectPreset: (name: string) => void;
  selectSpawnTier: (name: string) => void;
  manualRoll: (count: number) => void;
  manualSpawn: (category: 'mutants' | 'enemies', rolls: number) => void;
}

function RouletteControls({
  roulette,
  triggerBusy,
  selectPreset,
  selectSpawnTier,
  manualRoll,
  manualSpawn,
}: Props) {
  return (
    <section className="set-section">
      <h2 className="set-heading">Roulette</h2>

      {roulette && roulette.presets?.length > 0 && (
        <div className="set-presets">
          <span className="set-muted">Loot tier</span>
          <div className="set-preset-group">
            {roulette.presets.map((name) => (
              <button
                key={name}
                className={`set-preset ${roulette.preset === name ? 'is-active' : ''}`}
                onClick={() => selectPreset(name)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}

      {roulette && roulette.spawnTiers?.length > 0 && (
        <div className="set-presets">
          <span className="set-muted">Spawn tier</span>
          <div className="set-preset-group">
            {roulette.spawnTiers.map((name) => (
              <button
                key={name}
                className={`set-preset ${roulette.spawnTier === name ? 'is-active' : ''}`}
                onClick={() => selectSpawnTier(name)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="set-trigger">
        <span className="set-muted">Manual roll</span>
        {[1, 2, 3].map((n) => (
          <button
            key={n}
            className="set-btn"
            onClick={() => manualRoll(n)}
            disabled={triggerBusy}
          >
            {n} item{n > 1 ? 's' : ''}
          </button>
        ))}
      </div>

      <div className="set-trigger">
        <span className="set-muted">Manual spawn</span>
        <button
          className="set-btn"
          onClick={() => manualSpawn('mutants', 1)}
          disabled={triggerBusy}
        >
          Mutants
        </button>
        <button
          className="set-btn"
          onClick={() => manualSpawn('mutants', 3)}
          disabled={triggerBusy}
        >
          Mutants ×3
        </button>
        <button
          className="set-btn"
          onClick={() => manualSpawn('enemies', 1)}
          disabled={triggerBusy}
        >
          Enemies
        </button>
        <button
          className="set-btn"
          onClick={() => manualSpawn('enemies', 3)}
          disabled={triggerBusy}
        >
          Enemies ×3
        </button>
      </div>

      {typeof roulette?.queued === 'number' && roulette.queued > 0 && (
        <p className="set-muted">{roulette.queued} roll(s) queued</p>
      )}
    </section>
  );
}

export default memo(RouletteControls);
