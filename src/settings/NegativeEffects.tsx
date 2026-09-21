import { memo, useCallback, useEffect, useRef, useState } from 'react';

import { API, type NegativeEffect } from './types';

function percentFromChance(chance: number): string {
  return String(Math.round(chance * 1000) / 10); // one decimal, e.g. 3.3
}

function NegativeEffects() {
  const [effects, setEffects] = useState<NegativeEffect[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [resetting, setResetting] = useState<boolean>(false);

  const seqRef = useRef(0);
  const bumpSeq = useCallback(() => ++seqRef.current, []);
  const isStaleSeq = useCallback((seq: number) => seq !== seqRef.current, []);

  // Seeds a draft for any effect that doesn't have one yet — never
  // overwrites an existing draft, same reasoning as SpawnBonuses.
  const seedDrafts = useCallback((list: NegativeEffect[]) => {
    setDrafts((prev) => {
      const next = { ...prev };

      for (const effect of list) {
        if (!(effect.key in next)) {
          next[effect.key] = percentFromChance(effect.chance);
        }
      }

      return next;
    });
  }, []);

  useEffect(() => {
    const seq = bumpSeq();

    fetch(`${API}/roulette/negative-effects`)
      .then((res) => res.json())
      .then((data) => {
        if (isStaleSeq(seq)) {
          return;
        }

        const list: NegativeEffect[] = Array.isArray(data.effects) ? data.effects : [];

        setEffects(list);
        seedDrafts(list);
      })
      .catch(() => {
        // leave the list empty — section just won't render
      });
  }, [bumpSeq, isStaleSeq, seedDrafts]);

  const toggleEffect = async (key: string, enabled: boolean): Promise<void> => {
    const seq = bumpSeq();

    setEffects((prev) => prev.map((e) => (e.key === key ? { ...e, enabled } : e)));

    const res = await fetch(`${API}/roulette/negative-effects/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, enabled }),
    }).then((r) => r.json());

    // Only `enabled` can change from a toggle — sync that, but leave
    // every effect's chance draft untouched (see seedDrafts).
    if (Array.isArray(res.effects) && !isStaleSeq(seq)) {
      setEffects(res.effects);
    }
  };

  const isDirty = (effect: NegativeEffect): boolean =>
    drafts[effect.key] !== undefined && drafts[effect.key] !== percentFromChance(effect.chance);

  const saveChance = async (effect: NegativeEffect): Promise<void> => {
    const key = effect.key;
    const draft = drafts[key];
    const percent = Number(draft);

    if (draft === undefined || !Number.isFinite(percent)) {
      return;
    }

    const seq = bumpSeq();

    setSaving((prev) => ({ ...prev, [key]: true }));
    setErrors((prev) => ({ ...prev, [key]: '' }));

    try {
      const res = await fetch(`${API}/roulette/negative-effects/chance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, chance: percent / 100 }),
      }).then((r) => r.json());

      if (res.error) {
        setErrors((prev) => ({ ...prev, [key]: res.error }));

        return;
      }

      if (Array.isArray(res.effects) && !isStaleSeq(seq)) {
        setEffects(res.effects);

        // Re-sync only THIS effect's draft (the server clamps to 0-100, so
        // what got saved may differ slightly from what was typed) — every
        // other effect's draft is left exactly as the user has it.
        const updated = (res.effects as NegativeEffect[]).find((e) => e.key === key);

        if (updated) {
          setDrafts((prev) => ({ ...prev, [key]: percentFromChance(updated.chance) }));
        }
      }
    } catch {
      setErrors((prev) => ({ ...prev, [key]: 'Could not reach the server' }));
    } finally {
      setSaving((prev) => ({ ...prev, [key]: false }));
    }
  };

  const restoreDefaults = async (): Promise<void> => {
    if (
      !window.confirm(
        'Restore all negative effects to their default chances and re-enable them all?',
      )
    ) {
      return;
    }

    const seq = bumpSeq();

    setResetting(true);

    try {
      const res = await fetch(`${API}/roulette/negative-effects/reset`, { method: 'POST' }).then(
        (r) => r.json(),
      );

      if (Array.isArray(res.effects) && !isStaleSeq(seq)) {
        setEffects(res.effects);
        setDrafts({});
        seedDrafts(res.effects);
        setErrors({});
      }
    } finally {
      setResetting(false);
    }
  };

  if (effects.length === 0) {
    return null;
  }

  return (
    <section className="set-section">
      <div className="set-section-header">
        <h2 className="set-heading">Negative Effects</h2>

        <button
          className="set-btn set-section-reset"
          onClick={restoreDefaults}
          disabled={resetting}
        >
          {resetting ? 'Restoring…' : 'Restore defaults'}
        </button>
      </div>

      <p className="set-muted">
        A negative effect roll picks one of these at random (weighted odds among the ones
        enabled below).
      </p>

      <div className="set-rewards">
        {effects.map((effect) => {
          const draft = drafts[effect.key] ?? percentFromChance(effect.chance);
          const dirty = isDirty(effect);

          return (
            <div className="set-reward" key={effect.key}>
              <div className="set-reward-info">
                <input
                  className="set-checkbox"
                  type="checkbox"
                  checked={effect.enabled}
                  onChange={(event) => toggleEffect(effect.key, event.target.checked)}
                />
                {effect.icon && <img className="set-reward-icon" src={effect.icon} alt="" />}
                <span className="set-reward-title">{effect.label}</span>
                {effect.description && <span className="set-muted">{effect.description}</span>}
              </div>

              <div className="set-reward-config">
                <label className="set-reward-field">
                  Chance %
                  <input
                    className="set-reward-input"
                    type="number"
                    min={0}
                    max={100}
                    step={0.1}
                    value={draft}
                    onChange={(event) =>
                      setDrafts((prev) => ({ ...prev, [effect.key]: event.target.value }))
                    }
                  />
                </label>

                {dirty && (
                  <button
                    className="set-btn set-btn--primary set-reward-save"
                    onClick={() => saveChance(effect)}
                    disabled={saving[effect.key]}
                  >
                    {saving[effect.key] ? 'Saving…' : 'Save'}
                  </button>
                )}
              </div>

              {errors[effect.key] && <p className="set-reward-error">{errors[effect.key]}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default memo(NegativeEffects);
