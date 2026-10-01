import { memo, useEffect, useState } from 'react';

import { API } from './types';
import type { RouletteStatus } from './types';

interface Props {
  roulette: RouletteStatus | null;
  triggerBusy: boolean;
  selectPreset: (name: string) => void;
  selectSpawnTier: (name: string) => void;
  toggleLabsMode: (enabled: boolean) => void;
  manualRoll: (count: number, forceBonus?: boolean) => void;
  manualSpawn: (category: 'mutants' | 'enemies', forceBonus?: boolean) => void;
  manualPerk: (forceBonus?: boolean) => void;
  manualNegativeEffect: (forceBonus?: boolean) => void;
}

function RouletteControls({
  roulette,
  triggerBusy,
  selectPreset,
  selectSpawnTier,
  toggleLabsMode,
  manualRoll,
  manualSpawn,
  manualPerk,
  manualNegativeEffect,
}: Props) {
  const [gunAttachments, setGunAttachments] = useState<boolean>(false);
  const [gunAttachmentsBusy, setGunAttachmentsBusy] = useState<boolean>(false);

  useEffect(() => {
    fetch(`${API}/roulette/gun-attachments`)
      .then((res) => res.json())
      .then((data) => setGunAttachments(Boolean(data.enabled)))
      .catch(() => {
        // leave the default (on)
      });
  }, []);

  const toggleGunAttachments = async (): Promise<void> => {
    const next = !gunAttachments;

    setGunAttachmentsBusy(true);
    setGunAttachments(next);

    try {
      const res = await fetch(`${API}/roulette/gun-attachments/toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      }).then((r) => r.json());

      setGunAttachments(Boolean(res.enabled));
    } catch {
      setGunAttachments(!next);
    } finally {
      setGunAttachmentsBusy(false);
    }
  };

  return (
    <section className="set-section">
      <h2 className="set-heading">Roulette</h2>

      {roulette && (
        <div className="set-presets">
          <span className="set-muted">Spawn roster</span>
          <div className="set-preset-group">
            <button
              className={`set-preset ${!roulette.labsMode ? 'is-active' : ''}`}
              onClick={() => toggleLabsMode(false)}
            >
              Count Roll
            </button>
            <button
              className={`set-preset ${roulette.labsMode ? 'is-active' : ''}`}
              onClick={() => toggleLabsMode(true)}
            >
              Count Roll (LABS)
              <span
                className="set-hint"
                tabIndex={0}
                data-tip="Monolith, ISG and Sin can spawn on all tiers. More balanced spawn roster for Labs."
                onClick={(event) => event.stopPropagation()}
              >
                ?
              </span>
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
        <button
          className="set-btn"
          onClick={() => manualRoll(3, true)}
          disabled={triggerBusy}
        >
          3 items + bonus
        </button>

        <label className="set-auto-activate">
          <input
            className="set-checkbox"
            type="checkbox"
            checked={gunAttachments}
            onChange={toggleGunAttachments}
            disabled={gunAttachmentsBusy}
          />
          Roll guns with attachments (bonus)
        </label>
      </div>

      <div className="set-trigger">
        <span className="set-muted">Manual spawn Mutants</span>
        <button
          className="set-btn"
          onClick={() => manualSpawn('mutants')}
          disabled={triggerBusy}
        >
          Mutants
        </button>
        <button
          className="set-btn"
          onClick={() => manualSpawn('mutants', true)}
          disabled={triggerBusy}
        >
          Mutants + bonus
        </button>
      </div>

      <div className="set-trigger">
        <span className="set-muted">Manual spawn Squads</span>
        <button
          className="set-btn"
          onClick={() => manualSpawn('enemies')}
          disabled={triggerBusy}
        >
          Squads
        </button>
        <button
          className="set-btn"
          onClick={() => manualSpawn('enemies', true)}
          disabled={triggerBusy}
        >
          Squads + bonus
        </button>
      </div>

      <div className="set-trigger">
        <span className="set-muted">Manual positive effect</span>
        <button className="set-btn" onClick={() => manualPerk()} disabled={triggerBusy}>
          Positive Effects
        </button>
        <button
          className="set-btn"
          onClick={() => manualPerk(true)}
          disabled={triggerBusy}
        >
          Positive Effects + bonus
        </button>
      </div>

      <div className="set-trigger">
        <span className="set-muted">Manual negative effect</span>
        <button
          className="set-btn"
          onClick={() => manualNegativeEffect()}
          disabled={triggerBusy}
        >
          Negative Effects
        </button>
        <button
          className="set-btn"
          onClick={() => manualNegativeEffect(true)}
          disabled={triggerBusy}
        >
          Negative Effects + bonus
        </button>
      </div>

      {typeof roulette?.queued === 'number' && roulette.queued > 0 && (
        <p className="set-muted">{roulette.queued} roll(s) queued</p>
      )}
    </section>
  );
}

export default memo(RouletteControls);
