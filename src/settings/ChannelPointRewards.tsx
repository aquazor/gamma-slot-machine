import { memo, useCallback, useEffect, useRef, useState } from 'react';

import { API, draftFromReward, type Reward, type RewardDraft } from './types';

interface Props {
  twitchConnected: boolean;
}

function ChannelPointRewards({ twitchConnected }: Props) {
  const [rewardList, setRewardList] = useState<Reward[]>([]);
  const [loaded, setLoaded] = useState<boolean>(false);

  // one editable draft per reward — seeded from the server once, then left
  // alone across background refreshes so typing isn't clobbered mid-edit
  const [rewardDrafts, setRewardDrafts] = useState<Record<string, RewardDraft>>({});
  const [rewardSaving, setRewardSaving] = useState<Record<string, boolean>>({});
  const [rewardErrors, setRewardErrors] = useState<Record<string, string>>({});
  const [rewardToggling, setRewardToggling] = useState<Record<string, boolean>>({});
  const [rewardsBusy, setRewardsBusy] = useState<boolean>(false);

  // collapsed by default — editable list, hidden so nothing gets bumped by
  // accident; expand with the arrow next to the heading
  const [collapsed, setCollapsed] = useState<boolean>(true);

  // Guards this component's own concurrent requests (initial load racing a
  // quick save/toggle right after mount) — not shared with any other section.
  const seqRef = useRef(0);
  const bumpSeq = useCallback(() => ++seqRef.current, []);
  const isStaleSeq = useCallback((seq: number) => seq !== seqRef.current, []);

  const seedDrafts = useCallback((list: Reward[]) => {
    setRewardDrafts((prev) => {
      const next = { ...prev };

      for (const reward of list) {
        if (!(reward.key in next)) {
          next[reward.key] = draftFromReward(reward);
        }
      }

      return next;
    });
  }, []);

  useEffect(() => {
    const seq = bumpSeq();
    let timer: number | null = null;
    let cancelled = false;

    // The server's boot-time ensureRewards() (create/sync on Twitch, e.g.
    // re-enabling everything after a restart) runs asynchronously and
    // doesn't block the server starting up. If this page loads while
    // that's still in flight, the reward list can reflect Twitch's
    // pre-sync state (wrong enabled/cost/etc, not just missing) — the
    // server flags this via `syncing: true`. Retry while it's syncing
    // instead of settling on a stale snapshot; a hard cap keeps this from
    // spinning forever if sync genuinely fails.
    const MAX_ATTEMPTS = 8;
    const RETRY_DELAY_MS = 1500;

    const load = (attempt: number) => {
      fetch(`${API}/twitch/rewards`)
        .then((res) => res.json())
        .then((data) => {
          if (isStaleSeq(seq) || cancelled) {
            return;
          }

          const list: Reward[] = Array.isArray(data.rewards) ? data.rewards : [];

          if (data.syncing && twitchConnected && attempt < MAX_ATTEMPTS) {
            timer = window.setTimeout(() => load(attempt + 1), RETRY_DELAY_MS);

            return;
          }

          setRewardList(list);
          seedDrafts(list);
          setLoaded(true);
        })
        .catch(() => {
          if (!isStaleSeq(seq) && !cancelled) {
            setLoaded(true);
          }
        });
    };

    load(0);

    return () => {
      cancelled = true;

      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
    // Re-fetch whenever the Twitch connection flips (connect creates the
    // rewards on Twitch's side; disconnect can change what's live).
  }, [bumpSeq, isStaleSeq, seedDrafts, twitchConnected]);

  const updateRewardDraft = (key: string, field: keyof RewardDraft, value: string): void => {
    setRewardDrafts((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  };

  const isRewardDirty = (reward: Reward): boolean => {
    const draft = rewardDrafts[reward.key];

    if (!draft) {
      return false;
    }

    const cost = Number(draft.cost);
    const maxPerUser =
      draft.maxPerUserPerStream.trim() === '' ? null : Number(draft.maxPerUserPerStream);
    const cooldown =
      draft.cooldownSeconds.trim() === '' ? null : Number(draft.cooldownSeconds);

    return (
      cost !== reward.cost ||
      maxPerUser !== reward.maxPerUserPerStream ||
      cooldown !== reward.cooldownSeconds
    );
  };

  const saveRewardConfig = async (key: string): Promise<void> => {
    const draft = rewardDrafts[key];

    if (!draft) {
      return;
    }

    const seq = bumpSeq();

    setRewardSaving((prev) => ({ ...prev, [key]: true }));
    setRewardErrors((prev) => ({ ...prev, [key]: '' }));

    try {
      const res = await fetch(`${API}/twitch/rewards/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key,
          cost: Number(draft.cost),
          maxPerUserPerStream:
            draft.maxPerUserPerStream.trim() === '' ? null : Number(draft.maxPerUserPerStream),
          cooldownSeconds:
            draft.cooldownSeconds.trim() === '' ? null : Number(draft.cooldownSeconds),
        }),
      }).then((r) => r.json());

      if (res.error) {
        setRewardErrors((prev) => ({ ...prev, [key]: res.error }));

        return;
      }

      if (Array.isArray(res.rewards) && !isStaleSeq(seq)) {
        setRewardList(res.rewards);

        const updated = (res.rewards as Reward[]).find((r) => r.key === key);

        if (updated) {
          setRewardDrafts((prev) => ({ ...prev, [key]: draftFromReward(updated) }));
        }
      }
    } catch {
      setRewardErrors((prev) => ({ ...prev, [key]: 'Could not reach the server' }));
    } finally {
      setRewardSaving((prev) => ({ ...prev, [key]: false }));
    }
  };

  const toggleRewardEnabled = async (reward: Reward): Promise<void> => {
    const seq = bumpSeq();

    setRewardToggling((prev) => ({ ...prev, [reward.key]: true }));

    try {
      const res = await fetch(`${API}/twitch/rewards/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: reward.key, enabled: !reward.enabled }),
      }).then((r) => r.json());

      if (Array.isArray(res.rewards) && !isStaleSeq(seq)) {
        setRewardList(res.rewards);
      }
    } finally {
      setRewardToggling((prev) => ({ ...prev, [reward.key]: false }));
    }
  };

  const setRewardsEnabled = async (enabled: boolean): Promise<void> => {
    const seq = bumpSeq();

    setRewardsBusy(true);

    try {
      const res = await fetch(`${API}/twitch/rewards/enabled`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      }).then((r) => r.json());

      if (Array.isArray(res.rewards) && !isStaleSeq(seq)) {
        setRewardList(res.rewards);
      }
    } finally {
      setRewardsBusy(false);
    }
  };

  if (!loaded) {
    return null;
  }

  return (
    <section className="set-section">
      <button className="set-heading set-heading--toggle" onClick={() => setCollapsed((prev) => !prev)}>
        <span className={`set-chevron ${collapsed ? '' : 'is-open'}`}>▸</span>
        Channel point rewards
        {rewardList.length > 0 && (
          <span className="set-heading-count">
            {rewardList.filter((reward) => reward.enabled).length}/{rewardList.length} active
          </span>
        )}
      </button>

      {!collapsed &&
        (rewardList.length > 0 ? (
          <>
            <div className="set-rewards">
              {rewardList.map((reward) => {
                const draft = rewardDrafts[reward.key] ?? draftFromReward(reward);
                const dirty = isRewardDirty(reward);

                return (
                  <div className="set-reward" key={reward.id}>
                    <div className="set-reward-info">
                      <span
                        className={`set-badge ${
                          reward.enabled ? 'set-badge--ok' : 'set-badge--off'
                        }`}
                      >
                        {reward.enabled ? 'Live' : 'Disabled'}
                      </span>
                      <span className="set-reward-title">{reward.title}</span>
                      <button
                        className="set-btn set-reward-toggle"
                        onClick={() => toggleRewardEnabled(reward)}
                        disabled={rewardToggling[reward.key]}
                      >
                        {rewardToggling[reward.key]
                          ? 'Working…'
                          : reward.enabled
                            ? 'Disable'
                            : 'Enable'}
                      </button>
                    </div>

                    <div className="set-reward-config">
                      <label className="set-reward-field">
                        Cost
                        <input
                          className="set-reward-input"
                          type="number"
                          min={1}
                          value={draft.cost}
                          onChange={(event) =>
                            updateRewardDraft(reward.key, 'cost', event.target.value)
                          }
                        />
                      </label>

                      <label className="set-reward-field">
                        Max / user
                        <input
                          className="set-reward-input"
                          type="number"
                          min={1}
                          placeholder="no limit"
                          value={draft.maxPerUserPerStream}
                          onChange={(event) =>
                            updateRewardDraft(
                              reward.key,
                              'maxPerUserPerStream',
                              event.target.value,
                            )
                          }
                        />
                      </label>

                      <label className="set-reward-field">
                        Cooldown (s)
                        <input
                          className="set-reward-input"
                          type="number"
                          min={0}
                          placeholder="none"
                          value={draft.cooldownSeconds}
                          onChange={(event) =>
                            updateRewardDraft(reward.key, 'cooldownSeconds', event.target.value)
                          }
                        />
                      </label>

                      {dirty && (
                        <button
                          className="set-btn set-btn--primary set-reward-save"
                          onClick={() => saveRewardConfig(reward.key)}
                          disabled={rewardSaving[reward.key]}
                        >
                          Save
                        </button>
                      )}
                    </div>

                    {rewardErrors[reward.key] && (
                      <p className="set-reward-error">{rewardErrors[reward.key]}</p>
                    )}
                  </div>
                );
              })}
            </div>

            {rewardList.some((reward) => reward.enabled) ? (
              <button
                className="set-btn"
                onClick={() => setRewardsEnabled(false)}
                disabled={rewardsBusy}
              >
                {rewardsBusy ? 'Working…' : 'Disable rewards'}
              </button>
            ) : (
              <button
                className="set-btn set-btn--primary"
                onClick={() => setRewardsEnabled(true)}
                disabled={rewardsBusy}
              >
                {rewardsBusy ? 'Working…' : 'Enable rewards'}
              </button>
            )}
          </>
        ) : (
          <p className="set-muted">
            {twitchConnected
              ? 'Rewards will be created automatically once the connection has the channel-points permission — reconnect Twitch if you just updated.'
              : 'Connect Twitch to create the reward.'}
          </p>
        ))}

      {!collapsed && (
        <p className="set-muted set-obs">
          Redemptions stay in your Twitch queue — fulfill or refund them manually in the
          Stream Manager.
        </p>
      )}
    </section>
  );
}

export default memo(ChannelPointRewards);
