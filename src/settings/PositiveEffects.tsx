import { memo, useCallback, useEffect, useRef, useState } from 'react';

import { API, type Perk } from './types';

function percentFromChance(chance: number): string {
  return String(Math.round(chance * 1000) / 10); // one decimal, e.g. 3.3
}

function PositiveEffects() {
  const [perks, setPerks] = useState<Perk[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [resetting, setResetting] = useState<boolean>(false);

  const seqRef = useRef(0);
  const bumpSeq = useCallback(() => ++seqRef.current, []);
  const isStaleSeq = useCallback((seq: number) => seq !== seqRef.current, []);

  // Seeds a draft for any perk that doesn't have one yet — never
  // overwrites an existing draft, same reasoning as SpawnBonuses.
  const seedDrafts = useCallback((list: Perk[]) => {
    setDrafts((prev) => {
      const next = { ...prev };

      for (const perk of list) {
        if (!(perk.key in next)) {
          next[perk.key] = percentFromChance(perk.chance);
        }
      }

      return next;
    });
  }, []);

  useEffect(() => {
    const seq = bumpSeq();

    fetch(`${API}/roulette/perks`)
      .then((res) => res.json())
      .then((data) => {
        if (isStaleSeq(seq)) {
          return;
        }

        const list: Perk[] = Array.isArray(data.perks) ? data.perks : [];

        setPerks(list);
        seedDrafts(list);
      })
      .catch(() => {
        // leave the list empty — section just won't render
      });
  }, [bumpSeq, isStaleSeq, seedDrafts]);

  const togglePerk = async (key: string, enabled: boolean): Promise<void> => {
    const seq = bumpSeq();

    setPerks((prev) => prev.map((p) => (p.key === key ? { ...p, enabled } : p)));

    const res = await fetch(`${API}/roulette/perks/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, enabled }),
    }).then((r) => r.json());

    // Only `enabled` can change from a toggle — sync that, but leave
    // every perk's chance draft untouched (see seedDrafts).
    if (Array.isArray(res.perks) && !isStaleSeq(seq)) {
      setPerks(res.perks);
    }
  };

  const isDirty = (perk: Perk): boolean =>
    drafts[perk.key] !== undefined && drafts[perk.key] !== percentFromChance(perk.chance);

  const saveChance = async (perk: Perk): Promise<void> => {
    const key = perk.key;
    const draft = drafts[key];
    const percent = Number(draft);

    if (draft === undefined || !Number.isFinite(percent)) {
      return;
    }

    const seq = bumpSeq();

    setSaving((prev) => ({ ...prev, [key]: true }));
    setErrors((prev) => ({ ...prev, [key]: '' }));

    try {
      const res = await fetch(`${API}/roulette/perks/chance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, chance: percent / 100 }),
      }).then((r) => r.json());

      if (res.error) {
        setErrors((prev) => ({ ...prev, [key]: res.error }));

        return;
      }

      if (Array.isArray(res.perks) && !isStaleSeq(seq)) {
        setPerks(res.perks);

        // Re-sync only THIS perk's draft (the server clamps to 0-100, so
        // what got saved may differ slightly from what was typed) — every
        // other perk's draft is left exactly as the user has it.
        const updated = (res.perks as Perk[]).find((p) => p.key === key);

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
        'Restore all positive effects to their default chances and re-enable them all?',
      )
    ) {
      return;
    }

    const seq = bumpSeq();

    setResetting(true);

    try {
      const res = await fetch(`${API}/roulette/perks/reset`, { method: 'POST' }).then((r) =>
        r.json(),
      );

      if (Array.isArray(res.perks) && !isStaleSeq(seq)) {
        setPerks(res.perks);
        setDrafts({});
        seedDrafts(res.perks);
        setErrors({});
      }
    } finally {
      setResetting(false);
    }
  };

  if (perks.length === 0) {
    return null;
  }

  return (
    <section className="set-section">
      <div className="set-section-header">
        <h2 className="set-heading">Positive Effects</h2>

        <button
          className="set-btn set-section-reset"
          onClick={restoreDefaults}
          disabled={resetting}
        >
          {resetting ? 'Restoring…' : 'Restore defaults'}
        </button>
      </div>

      <p className="set-muted">
        A positive effect roll picks one of these at random (weighted odds among the ones
        enabled below).
      </p>

      <div className="set-rewards">
        {perks.map((perk) => {
          const draft = drafts[perk.key] ?? percentFromChance(perk.chance);
          const dirty = isDirty(perk);

          return (
            <div className="set-reward" key={perk.key}>
              <div className="set-reward-info">
                <input
                  className="set-checkbox"
                  type="checkbox"
                  checked={perk.enabled}
                  onChange={(event) => togglePerk(perk.key, event.target.checked)}
                />
                {perk.icon && <img className="set-reward-icon" src={perk.icon} alt="" />}
                <span className="set-reward-title">{perk.label}</span>
                {perk.description && <span className="set-muted">{perk.description}</span>}
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
                      setDrafts((prev) => ({ ...prev, [perk.key]: event.target.value }))
                    }
                  />
                </label>

                {dirty && (
                  <button
                    className="set-btn set-btn--primary set-reward-save"
                    onClick={() => saveChance(perk)}
                    disabled={saving[perk.key]}
                  >
                    {saving[perk.key] ? 'Saving…' : 'Save'}
                  </button>
                )}
              </div>

              {errors[perk.key] && <p className="set-reward-error">{errors[perk.key]}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export default memo(PositiveEffects);
