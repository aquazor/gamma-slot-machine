import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { API } from './types';

export interface ChanceItem {
  key: string;
  label: string;
  description?: string;
  icon?: string | null;
  enabled: boolean;
  chance: number; // fraction 0-1, e.g. 0.033 = 3.3%
}

function percentFromChance(chance: number): string {
  return String(Math.round(chance * 1000) / 10); // one decimal, e.g. 3.3
}

interface Props<T extends ChanceItem> {
  // Endpoint group (GET list + POST toggle / chance / reset) — see
  // utils/chance-routes.cjs on the backend.
  path: string;
  // Property the endpoints return the list under ("perks", "bonuses", ...).
  responseKey: string;
  title: string;
  intro: ReactNode;
  resetConfirm: string;
  footer?: (items: T[]) => ReactNode;
}

/*
 * One /tweaking card: a list of items, each with an enable checkbox and a
 * chance % field. Shared by spawn bonuses (both rosters), positive effects
 * and negative effects.
 */
function ChanceSection<T extends ChanceItem>({
  path,
  responseKey,
  title,
  intro,
  resetConfirm,
  footer,
}: Props<T>) {
  const basePath = `${API}${path}`;
  const [items, setItems] = useState<T[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [resetting, setResetting] = useState<boolean>(false);

  const seqRef = useRef(0);
  const bumpSeq = useCallback(() => ++seqRef.current, []);
  const isStaleSeq = useCallback((seq: number) => seq !== seqRef.current, []);

  const listFrom = useCallback(
    (data: Record<string, unknown> | undefined): T[] | null => {
      const list = data?.[responseKey];

      return Array.isArray(list) ? (list as T[]) : null;
    },
    [responseKey],
  );

  // Seeds a draft for any item that doesn't have one yet — never
  // overwrites an existing draft. Toggling one checkbox (or saving
  // another item's chance) must not clobber an unsaved edit sitting in a
  // different item's % field.
  const seedDrafts = useCallback((list: T[]) => {
    setDrafts((prev) => {
      const next = { ...prev };

      for (const item of list) {
        if (!(item.key in next)) {
          next[item.key] = percentFromChance(item.chance);
        }
      }

      return next;
    });
  }, []);

  useEffect(() => {
    const seq = bumpSeq();

    fetch(basePath)
      .then((res) => res.json())
      .then((data) => {
        if (isStaleSeq(seq)) {
          return;
        }

        const list = listFrom(data) ?? [];

        setItems(list);
        seedDrafts(list);
      })
      .catch(() => {
        // leave the list empty — section just won't render
      });
  }, [basePath, bumpSeq, isStaleSeq, listFrom, seedDrafts]);

  const post = (action: string, body?: object) =>
    fetch(`${basePath}/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    }).then((r) => r.json());

  const toggleItem = async (key: string, enabled: boolean): Promise<void> => {
    const seq = bumpSeq();

    setItems((prev) => prev.map((i) => (i.key === key ? { ...i, enabled } : i)));

    const list = listFrom(await post('toggle', { key, enabled }));

    // Only `enabled` can change from a toggle — sync that, but leave
    // every item's chance draft untouched (see seedDrafts).
    if (list && !isStaleSeq(seq)) {
      setItems(list);
    }
  };

  const isDirty = (item: T): boolean =>
    drafts[item.key] !== undefined && drafts[item.key] !== percentFromChance(item.chance);

  const saveChance = async (item: T): Promise<void> => {
    const key = item.key;
    const draft = drafts[key];
    const percent = Number(draft);

    if (draft === undefined || !Number.isFinite(percent)) {
      return;
    }

    const seq = bumpSeq();

    setSaving((prev) => ({ ...prev, [key]: true }));
    setErrors((prev) => ({ ...prev, [key]: '' }));

    try {
      const res = await post('chance', { key, chance: percent / 100 });

      if (res.error) {
        setErrors((prev) => ({ ...prev, [key]: res.error }));

        return;
      }

      const list = listFrom(res);

      if (list && !isStaleSeq(seq)) {
        setItems(list);

        // Re-sync only THIS item's draft (the server clamps to 0-100, so
        // what got saved may differ slightly from what was typed) — every
        // other item's draft is left exactly as the user has it.
        const updated = list.find((i) => i.key === key);

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
    if (!window.confirm(resetConfirm)) {
      return;
    }

    const seq = bumpSeq();

    setResetting(true);

    try {
      const list = listFrom(await post('reset'));

      if (list && !isStaleSeq(seq)) {
        setItems(list);
        setDrafts({});
        seedDrafts(list);
        setErrors({});
      }
    } finally {
      setResetting(false);
    }
  };

  if (items.length === 0) {
    return null;
  }

  return (
    <section className="set-section">
      <div className="set-section-header">
        <h2 className="set-heading">{title}</h2>

        <button
          className="set-btn set-section-reset"
          onClick={restoreDefaults}
          disabled={resetting}
        >
          {resetting ? 'Restoring…' : 'Restore defaults'}
        </button>
      </div>

      <p className="set-muted">{intro}</p>

      <div className="set-rewards">
        {items.map((item) => {
          const draft = drafts[item.key] ?? percentFromChance(item.chance);
          const dirty = isDirty(item);

          return (
            <div className="set-reward" key={item.key}>
              <div className="set-reward-info">
                <input
                  className="set-checkbox"
                  type="checkbox"
                  checked={item.enabled}
                  onChange={(event) => toggleItem(item.key, event.target.checked)}
                />
                {item.icon && <img className="set-reward-icon" src={item.icon} alt="" />}
                <span className="set-reward-title">{item.label}</span>
                {item.description && <span className="set-muted">{item.description}</span>}
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
                      setDrafts((prev) => ({ ...prev, [item.key]: event.target.value }))
                    }
                  />
                </label>

                {dirty && (
                  <button
                    className="set-btn set-btn--primary set-reward-save"
                    onClick={() => saveChance(item)}
                    disabled={saving[item.key]}
                  >
                    {saving[item.key] ? 'Saving…' : 'Save'}
                  </button>
                )}
              </div>

              {errors[item.key] && <p className="set-reward-error">{errors[item.key]}</p>}
            </div>
          );
        })}
      </div>

      {footer?.(items)}
    </section>
  );
}

export default ChanceSection;
