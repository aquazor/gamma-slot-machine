import { memo, useCallback, useEffect, useRef, useState } from 'react';

import {
  API,
  type BitsDraft,
  type BitsReward,
  bitsRewardLabel,
  draftFromBitsReward,
} from './types';

function BitsRewards() {
  const [bitsList, setBitsList] = useState<BitsReward[]>([]);
  const [bitsDrafts, setBitsDrafts] = useState<Record<string, BitsDraft>>({});
  const [bitsSaving, setBitsSaving] = useState<Record<string, boolean>>({});
  const [bitsErrors, setBitsErrors] = useState<Record<string, string>>({});
  const [collapsed, setCollapsed] = useState<boolean>(true);

  const seqRef = useRef(0);
  const bumpSeq = useCallback(() => ++seqRef.current, []);
  const isStaleSeq = useCallback((seq: number) => seq !== seqRef.current, []);

  useEffect(() => {
    const seq = bumpSeq();

    fetch(`${API}/roulette/bits-rewards`)
      .then((res) => res.json())
      .then((data) => {
        if (isStaleSeq(seq)) {
          return;
        }

        const list: BitsReward[] = Array.isArray(data.rewards) ? data.rewards : [];

        setBitsList(list);
        setBitsDrafts((prev) => {
          const next = { ...prev };

          for (const reward of list) {
            if (!(reward.key in next)) {
              next[reward.key] = draftFromBitsReward(reward);
            }
          }

          return next;
        });
      })
      .catch(() => {
        // leave the list empty — section just won't render
      });
  }, [bumpSeq, isStaleSeq]);

  const updateBitsDraft = (key: string, field: keyof BitsDraft, value: string): void => {
    setBitsDrafts((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  };

  const isBitsDirty = (reward: BitsReward): boolean => {
    const draft = bitsDrafts[reward.key];

    return Boolean(draft) && Number(draft.bits) !== reward.bits;
  };

  const saveBitsConfig = async (reward: BitsReward): Promise<void> => {
    const key = reward.key;
    const draft = bitsDrafts[key];

    if (!draft) {
      return;
    }

    const seq = bumpSeq();

    setBitsSaving((prev) => ({ ...prev, [key]: true }));
    setBitsErrors((prev) => ({ ...prev, [key]: '' }));

    try {
      const res = await fetch(`${API}/roulette/bits-rewards/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, bits: Number(draft.bits) }),
      }).then((r) => r.json());

      if (res.error) {
        setBitsErrors((prev) => ({ ...prev, [key]: res.error }));

        return;
      }

      if (Array.isArray(res.rewards) && !isStaleSeq(seq)) {
        setBitsList(res.rewards);

        const updated = (res.rewards as BitsReward[]).find((r) => r.key === key);

        if (updated) {
          setBitsDrafts((prev) => ({ ...prev, [key]: draftFromBitsReward(updated) }));
        }
      }
    } catch {
      setBitsErrors((prev) => ({ ...prev, [key]: 'Could not reach the server' }));
    } finally {
      setBitsSaving((prev) => ({ ...prev, [key]: false }));
    }
  };

  if (bitsList.length === 0) {
    return null;
  }

  return (
    <section className="set-section">
      <button className="set-heading set-heading--toggle" onClick={() => setCollapsed((prev) => !prev)}>
        <span className={`set-chevron ${collapsed ? '' : 'is-open'}`}>▸</span>
        Bits rewards
      </button>

      {!collapsed && (
        <>
          <p className="set-muted set-obs">
            Not a Twitch reward — just how a plain <code>cheer&lt;amount&gt;</code> in chat
            maps to a roll. One shared ladder for loot and spawn tiers — highest threshold met
            wins.
          </p>

          <div className="set-rewards set-rewards--bits">
            {bitsList.map((reward) => {
              const draft = bitsDrafts[reward.key] ?? draftFromBitsReward(reward);
              const dirty = isBitsDirty(reward);

              return (
                <div className="set-reward" key={reward.key}>
                  <div className="set-reward-info">
                    <span className="set-reward-title">{bitsRewardLabel(reward)}</span>
                  </div>

                  <div className="set-reward-config">
                    <label className="set-reward-field">
                      Bits ≥
                      <input
                        className="set-reward-input"
                        type="number"
                        min={1}
                        value={draft.bits}
                        onChange={(event) =>
                          updateBitsDraft(reward.key, 'bits', event.target.value)
                        }
                      />
                    </label>

                    {dirty && (
                      <button
                        className="set-btn set-btn--primary set-reward-save"
                        onClick={() => saveBitsConfig(reward)}
                        disabled={bitsSaving[reward.key]}
                      >
                        {bitsSaving[reward.key] ? 'Saving…' : 'Save'}
                      </button>
                    )}
                  </div>

                  {bitsErrors[reward.key] && (
                    <p className="set-reward-error">{bitsErrors[reward.key]}</p>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

export default memo(BitsRewards);
