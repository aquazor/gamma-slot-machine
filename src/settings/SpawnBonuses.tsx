import { memo, useCallback, useEffect, useRef, useState } from 'react';

import { API, type SpawnBonus } from './types';

function percentFromChance(chance: number): string {
  return String(Math.round(chance * 1000) / 10); // one decimal, e.g. 3.3
}

// "Count Roll" mode only — these toggles/chances have no effect while
// "Random" is active, since Random has no concept of bonuses at all.
function SpawnBonuses() {
  const [bonuses, setBonuses] = useState<SpawnBonus[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [resetting, setResetting] = useState<boolean>(false);

  const seqRef = useRef(0);
  const bumpSeq = useCallback(() => ++seqRef.current, []);
  const isStaleSeq = useCallback((seq: number) => seq !== seqRef.current, []);

  // Seeds a draft for any bonus that doesn't have one yet — never
  // overwrites an existing draft. Toggling one bonus's checkbox (or
  // saving another one's chance) must not clobber an unsaved edit
  // sitting in a different bonus's % field.
  const seedDrafts = useCallback((list: SpawnBonus[]) => {
    setDrafts((prev) => {
      const next = { ...prev };

      for (const bonus of list) {
        if (!(bonus.key in next)) {
          next[bonus.key] = percentFromChance(bonus.chance);
        }
      }

      return next;
    });
  }, []);

  useEffect(() => {
    const seq = bumpSeq();

    fetch(`${API}/roulette/bonuses`)
      .then((res) => res.json())
      .then((data) => {
        if (isStaleSeq(seq)) {
          return;
        }

        const list: SpawnBonus[] = Array.isArray(data.bonuses) ? data.bonuses : [];

        setBonuses(list);
        seedDrafts(list);
      })
      .catch(() => {
        // leave the list empty — section just won't render
      });
  }, [bumpSeq, isStaleSeq, seedDrafts]);

  const toggleBonus = async (key: string, enabled: boolean): Promise<void> => {
    const seq = bumpSeq();

    setBonuses((prev) => prev.map((b) => (b.key === key ? { ...b, enabled } : b)));

    const res = await fetch(`${API}/roulette/bonuses/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, enabled }),
    }).then((r) => r.json());

    // Only `enabled` can change from a toggle — sync that, but leave
    // every bonus's chance draft untouched (see seedDrafts).
    if (Array.isArray(res.bonuses) && !isStaleSeq(seq)) {
      setBonuses(res.bonuses);
    }
  };

  const isDirty = (bonus: SpawnBonus): boolean =>
    drafts[bonus.key] !== undefined && drafts[bonus.key] !== percentFromChance(bonus.chance);

  const saveChance = async (bonus: SpawnBonus): Promise<void> => {
    const key = bonus.key;
    const draft = drafts[key];
    const percent = Number(draft);

    if (draft === undefined || !Number.isFinite(percent)) {
      return;
    }

    const seq = bumpSeq();

    setSaving((prev) => ({ ...prev, [key]: true }));
    setErrors((prev) => ({ ...prev, [key]: '' }));

    try {
      const res = await fetch(`${API}/roulette/bonuses/chance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, chance: percent / 100 }),
      }).then((r) => r.json());

      if (res.error) {
        setErrors((prev) => ({ ...prev, [key]: res.error }));

        return;
      }

      if (Array.isArray(res.bonuses) && !isStaleSeq(seq)) {
        setBonuses(res.bonuses);

        // Re-sync only THIS bonus's draft (the server clamps to 0-100,
        // so what got saved may differ slightly from what was typed) —
        // every other bonus's draft is left exactly as the user has it.
        const updated = (res.bonuses as SpawnBonus[]).find((b) => b.key === key);

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
        'Restore all spawn bonuses to their default chances and re-enable them all?',
      )
    ) {
      return;
    }

    const seq = bumpSeq();

    setResetting(true);

    try {
      const res = await fetch(`${API}/roulette/bonuses/reset`, { method: 'POST' }).then((r) =>
        r.json(),
      );

      if (Array.isArray(res.bonuses) && !isStaleSeq(seq)) {
        setBonuses(res.bonuses);
        setDrafts({});
        seedDrafts(res.bonuses);
        setErrors({});
      }
    } finally {
      setResetting(false);
    }
  };

  if (bonuses.length === 0) {
    return null;
  }

  const totalPercent =
    Math.round(bonuses.filter((b) => b.enabled).reduce((sum, b) => sum + b.chance, 0) * 1000) /
    10;

  return (
    <section className="set-section">
      <div className="set-section-header">
        <h2 className="set-heading">Spawn bonuses (Count Roll)</h2>

        <button
          className="set-btn set-section-reset"
          onClick={restoreDefaults}
          disabled={resetting}
        >
          {resetting ? 'Restoring…' : 'Restore defaults'}
        </button>
      </div>

      <p className="set-muted">
        Chance of a bonus on a Count Roll spawn — has no effect while Random is active.
      </p>

      <div className="set-rewards">
        {bonuses.map((bonus) => {
          const draft = drafts[bonus.key] ?? percentFromChance(bonus.chance);
          const dirty = isDirty(bonus);

          return (
            <div className="set-reward" key={bonus.key}>
              <div className="set-reward-info">
                <input
                  className="set-checkbox"
                  type="checkbox"
                  checked={bonus.enabled}
                  onChange={(event) => toggleBonus(bonus.key, event.target.checked)}
                />
                <span className="set-reward-title">{bonus.label}</span>
                {bonus.description && <span className="set-muted">{bonus.description}</span>}
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
                      setDrafts((prev) => ({ ...prev, [bonus.key]: event.target.value }))
                    }
                  />
                </label>

                {dirty && (
                  <button
                    className="set-btn set-btn--primary set-reward-save"
                    onClick={() => saveChance(bonus)}
                    disabled={saving[bonus.key]}
                  >
                    {saving[bonus.key] ? 'Saving…' : 'Save'}
                  </button>
                )}
              </div>

              {errors[bonus.key] && <p className="set-reward-error">{errors[bonus.key]}</p>}
            </div>
          );
        })}
      </div>

      <p className={`set-muted ${totalPercent > 100 ? 'set-bonus-total--over' : ''}`}>
        Total enabled chance: {totalPercent}%
        {totalPercent > 100 &&
          ' — over 100%, so a bonus always lands and each one splits the pie by its own share instead of by no-bonus odds'}
      </p>
    </section>
  );
}

export default memo(SpawnBonuses);
