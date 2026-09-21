import { memo } from 'react';

import type { RouletteStatus } from './types';

interface Props {
  roulette: RouletteStatus | null;
  triggerBusy: boolean;
  selectPreset: (name: string) => void;
  selectSpawnTier: (name: string) => void;
  selectRollMode: (mode: 'random' | 'count-roll') => void;
  manualRoll: (count: number) => void;
  manualSpawn: (category: 'mutants' | 'enemies', rolls: number) => void;
  manualPerk: () => void;
  manualNegativeEffect: () => void;
}

function RouletteControls({
  roulette,
  triggerBusy,
  selectPreset,
  selectSpawnTier,
  selectRollMode,
  manualRoll,
  manualSpawn,
  manualPerk,
  manualNegativeEffect,
}: Props) {
  return (
    <section className="set-section">
      <h2 className="set-heading">Roulette</h2>

      {roulette && (
        <div className="set-presets">
          <span className="set-muted">Spawn roll mode</span>
          <div className="set-preset-group">
            <button
              className={`set-preset ${roulette.rollMode === 'random' ? 'is-active' : ''}`}
              onClick={() => selectRollMode('random')}
            >
              Random
            </button>
            <button
              className={`set-preset ${roulette.rollMode === 'count-roll' ? 'is-active' : ''}`}
              onClick={() => selectRollMode('count-roll')}
            >
              Count Roll
            </button>
          </div>
        </div>
      )}

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
        <span className="set-muted">Manual spawn Mutants</span>
        {(roulette?.rollMode === 'count-roll' ? [1] : [1, 2, 3]).map((n) => (
          <button
            key={n}
            className="set-btn"
            onClick={() => manualSpawn('mutants', n)}
            disabled={triggerBusy}
          >
            {n === 1 ? 'Mutants' : `Mutants ×${n}`}
          </button>
        ))}
      </div>

      <div className="set-trigger">
        <span className="set-muted">Manual spawn Squads</span>
        {(roulette?.rollMode === 'count-roll' ? [1] : [1, 2, 3]).map((n) => (
          <button
            key={n}
            className="set-btn"
            onClick={() => manualSpawn('enemies', n)}
            disabled={triggerBusy}
          >
            {n === 1 ? 'Squads' : `Squads ×${n}`}
          </button>
        ))}
      </div>

      <div className="set-trigger">
        <span className="set-muted">Manual positive effect</span>
        <button className="set-btn" onClick={() => manualPerk()} disabled={triggerBusy}>
          Positive Effects
        </button>
      </div>

      <div className="set-trigger">
        <span className="set-muted">Manual negative effect</span>
        <button className="set-btn" onClick={() => manualNegativeEffect()} disabled={triggerBusy}>
          Negative Effects
        </button>
      </div>

      {typeof roulette?.queued === 'number' && roulette.queued > 0 && (
        <p className="set-muted">{roulette.queued} roll(s) queued</p>
      )}
    </section>
  );
}

export default memo(RouletteControls);
