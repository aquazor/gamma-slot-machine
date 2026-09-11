import { useCallback, useEffect, useRef, useState } from 'react';
import './Settings.css';

import Navbar from './Navbar';

const API = 'http://localhost:7770';

interface TwitchStatus {
  connected: boolean;
  login: string | null;
}

interface EventSubStatus {
  running: boolean;
  connected: boolean;
  sessionId: string | null;
}

interface RouletteStatus {
  overlayPresent: boolean;
  preset: string;
  presets: string[];
  spawnTier: string;
  spawnTiers: string[];
  queued: number;
}

interface Reward {
  id: string;
  key: string;
  title: string;
  cost: number;
  enabled: boolean;
  kind: 'loot' | 'spawn';
  category: 'mutants' | 'enemies' | null;
  count: number | null;
  rolls: number | null;
  maxPerUserPerStream: number | null;
  cooldownSeconds: number | null;
}

interface RewardDraft {
  cost: string;
  maxPerUserPerStream: string;
  cooldownSeconds: string;
}

function draftFromReward(reward: Reward): RewardDraft {
  return {
    cost: String(reward.cost),
    maxPerUserPerStream:
      reward.maxPerUserPerStream != null ? String(reward.maxPerUserPerStream) : '',
    cooldownSeconds: reward.cooldownSeconds != null ? String(reward.cooldownSeconds) : '',
  };
}

interface BitsReward {
  key: string;
  bits: number;
  kind: 'loot' | 'spawn';
  count: number | null;
  category: 'mutants' | 'enemies' | null;
  rolls: number | null;
}

interface BitsDraft {
  bits: string;
}

function draftFromBitsReward(reward: BitsReward): BitsDraft {
  return { bits: String(reward.bits) };
}

function bitsRewardLabel(reward: BitsReward): string {
  return reward.kind === 'spawn'
    ? `Spawn ${reward.category === 'enemies' ? 'Enemies' : 'Mutants'}${
        reward.rolls && reward.rolls > 1 ? ` ×${reward.rolls}` : ''
      }`
    : `Loot Roll ×${reward.count ?? 1}`;
}

interface EnemyFaction {
  key: string;
  label: string;
  icon: string | null;
  enabled: boolean;
}

interface DeviceFlow {
  userCode: string;
  verificationUri: string;
}

export default function Settings() {
  const [twitch, setTwitch] = useState<TwitchStatus>({ connected: false, login: null });
  const [eventSub, setEventSub] = useState<EventSubStatus | null>(null);
  const [roulette, setRoulette] = useState<RouletteStatus | null>(null);
  const [rewardList, setRewardList] = useState<Reward[]>([]);
  const [bitsList, setBitsList] = useState<BitsReward[]>([]);
  const [factions, setFactions] = useState<EnemyFaction[]>([]);

  // one editable draft per reward — seeded from the server once, then left
  // alone across background refreshes so typing isn't clobbered mid-edit
  const [rewardDrafts, setRewardDrafts] = useState<Record<string, RewardDraft>>({});
  const [rewardSaving, setRewardSaving] = useState<Record<string, boolean>>({});
  const [rewardErrors, setRewardErrors] = useState<Record<string, string>>({});
  const [rewardToggling, setRewardToggling] = useState<Record<string, boolean>>({});

  // collapsed by default — editable reward lists, hidden so nothing gets
  // bumped by accident; expand with the arrow next to the heading
  const [rewardsCollapsed, setRewardsCollapsed] = useState<boolean>(true);
  const [bitsCollapsed, setBitsCollapsed] = useState<boolean>(true);

  const [bitsDrafts, setBitsDrafts] = useState<Record<string, BitsDraft>>({});
  const [bitsSaving, setBitsSaving] = useState<Record<string, boolean>>({});
  const [bitsErrors, setBitsErrors] = useState<Record<string, string>>({});

  const [flow, setFlow] = useState<DeviceFlow | null>(null);
  const [authState, setAuthState] = useState<string>('idle');
  const [busy, setBusy] = useState<boolean>(false);
  const [ready, setReady] = useState<boolean>(false);
  const [reachable, setReachable] = useState<boolean>(true);

  const pollTimer = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [t, e, r, rw, f, br] = await Promise.all([
        fetch(`${API}/twitch/status`).then((res) => res.json()),
        fetch(`${API}/twitch/eventsub/status`).then((res) => res.json()),
        fetch(`${API}/roulette/status`).then((res) => res.json()),
        fetch(`${API}/twitch/rewards`).then((res) => res.json()),
        fetch(`${API}/roulette/enemies`).then((res) => res.json()),
        fetch(`${API}/roulette/bits-rewards`).then((res) => res.json()),
      ]);

      setTwitch(t);
      setEventSub(e);
      setRoulette(r);

      const rewardsList: Reward[] = Array.isArray(rw.rewards) ? rw.rewards : [];

      setRewardList(rewardsList);
      setRewardDrafts((prev) => {
        const next = { ...prev };

        for (const reward of rewardsList) {
          if (!(reward.key in next)) {
            next[reward.key] = draftFromReward(reward);
          }
        }

        return next;
      });

      const bitsRewardsList: BitsReward[] = Array.isArray(br.rewards) ? br.rewards : [];

      setBitsList(bitsRewardsList);
      setBitsDrafts((prev) => {
        const next = { ...prev };

        for (const reward of bitsRewardsList) {
          if (!(reward.key in next)) {
            next[reward.key] = draftFromBitsReward(reward);
          }
        }

        return next;
      });

      setFactions(Array.isArray(f.factions) ? f.factions : []);
      setReachable(true);
    } catch {
      setReachable(false);
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    refresh();

    const interval = window.setInterval(refresh, 4000);

    return () => {
      window.clearInterval(interval);

      if (pollTimer.current) {
        window.clearTimeout(pollTimer.current);
      }
    };
  }, [refresh]);

  const pollAuth = useCallback(() => {
    pollTimer.current = window.setTimeout(async () => {
      try {
        const res = await fetch(`${API}/twitch/auth/poll-status`).then((r) => r.json());

        setAuthState(res.status);

        if (res.status === 'connected') {
          setFlow(null);
          refresh();

          return;
        }

        if (res.status === 'error') {
          setFlow(null);

          return;
        }
      } catch {
        // ignore
      }

      pollAuth();
    }, 2500);
  }, [refresh]);

  const connect = async (): Promise<void> => {
    setBusy(true);

    try {
      const res = await fetch(`${API}/twitch/auth/start`, { method: 'POST' }).then((r) =>
        r.json(),
      );

      setFlow({ userCode: res.userCode, verificationUri: res.verificationUri });
      setAuthState('pending');

      window.open(res.verificationUri, '_blank', 'noopener');

      pollAuth();
    } catch {
      setAuthState('error');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (): Promise<void> => {
    if (
      !window.confirm('Disconnect Twitch? The roulette will stop reacting to events.')
    ) {
      return;
    }

    await fetch(`${API}/twitch/disconnect`, { method: 'POST' });

    setFlow(null);
    setAuthState('idle');
    refresh();
  };

  const [triggerBusy, setTriggerBusy] = useState<boolean>(false);

  const manualRoll = async (count: number): Promise<void> => {
    setTriggerBusy(true);

    try {
      await fetch(`${API}/roulette/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user: 'Streamer', count }),
      });
    } finally {
      setTriggerBusy(false);
      refresh();
    }
  };

  const manualSpawn = async (
    category: 'mutants' | 'enemies',
    rolls: number,
  ): Promise<void> => {
    setTriggerBusy(true);

    try {
      await fetch(`${API}/roulette/trigger`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'spawn',
          category,
          rolls,
          user: 'Streamer',
        }),
      });
    } finally {
      setTriggerBusy(false);
      refresh();
    }
  };

  const selectPreset = async (name: string): Promise<void> => {
    if (!roulette || roulette.preset === name) {
      return;
    }

    setRoulette({ ...roulette, preset: name });

    await fetch(`${API}/roulette/preset`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ preset: name }),
    });

    refresh();
  };

  const selectSpawnTier = async (name: string): Promise<void> => {
    if (!roulette || roulette.spawnTier === name) {
      return;
    }

    setRoulette({ ...roulette, spawnTier: name });

    await fetch(`${API}/roulette/spawn-tier`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: name }),
    });

    refresh();
  };

  const toggleFaction = async (key: string, enabled: boolean): Promise<void> => {
    setFactions((prev) => prev.map((f) => (f.key === key ? { ...f, enabled } : f)));

    const res = await fetch(`${API}/roulette/enemies/toggle`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ group: key, enabled }),
    }).then((r) => r.json());

    if (Array.isArray(res.factions)) {
      setFactions(res.factions);
    }
  };

  const updateRewardDraft = (
    key: string,
    field: keyof RewardDraft,
    value: string,
  ): void => {
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
            draft.maxPerUserPerStream.trim() === ''
              ? null
              : Number(draft.maxPerUserPerStream),
          cooldownSeconds:
            draft.cooldownSeconds.trim() === '' ? null : Number(draft.cooldownSeconds),
        }),
      }).then((r) => r.json());

      if (res.error) {
        setRewardErrors((prev) => ({ ...prev, [key]: res.error }));

        return;
      }

      if (Array.isArray(res.rewards)) {
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
    setRewardToggling((prev) => ({ ...prev, [reward.key]: true }));

    try {
      const res = await fetch(`${API}/twitch/rewards/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: reward.key, enabled: !reward.enabled }),
      }).then((r) => r.json());

      if (Array.isArray(res.rewards)) {
        setRewardList(res.rewards);
      }
    } finally {
      setRewardToggling((prev) => ({ ...prev, [reward.key]: false }));
      refresh();
    }
  };

  const [rewardsBusy, setRewardsBusy] = useState<boolean>(false);

  const setRewardsEnabled = async (enabled: boolean): Promise<void> => {
    setRewardsBusy(true);

    try {
      const res = await fetch(`${API}/twitch/rewards/enabled`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      }).then((r) => r.json());

      if (Array.isArray(res.rewards)) {
        setRewardList(res.rewards);
      }
    } finally {
      setRewardsBusy(false);
      refresh();
    }
  };

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

      if (Array.isArray(res.rewards)) {
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

  const [copied, setCopied] = useState<boolean>(false);

  const copyOverlayUrl = async (): Promise<void> => {
    const url = `${API}/overlay`;

    try {
      await navigator.clipboard.writeText(url);
    } catch {
      const area = document.createElement('textarea');
      area.value = url;
      area.style.position = 'fixed';
      area.style.opacity = '0';

      document.body.appendChild(area);
      area.select();

      try {
        document.execCommand('copy');
      } catch {
        // clipboard unavailable
      }

      area.remove();
    }

    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <>
      <Navbar />

      <div className="set-root">
        <div className="set-card">
          <h1 className="set-title">🎰 Loot Roulette — Settings</h1>

          {!ready ? (
            <div className="set-loading">
              <span className="set-spinner" />
              Loading…
            </div>
          ) : !reachable ? (
            <div className="set-loading">
              Can’t reach the server on <code>{API}</code>. Is it running?
            </div>
          ) : (
            <>
              {/* ---- INTEGRATIONS ---- */}

              <section className="set-section">
                <h2 className="set-heading">Integrations</h2>

                <div className="set-integration">
                  <h3 className="set-subheading">Twitch</h3>

                  {twitch.connected ? (
                    <>
                      <div className="set-row">
                        <span className="set-badge set-badge--ok">Connected</span>
                        <span className="set-muted">as {twitch.login}</span>
                        <button className="set-btn" onClick={disconnect}>
                          Disconnect
                        </button>
                      </div>

                      <div className="set-row">
                        <span
                          className={`set-badge ${
                            eventSub?.connected ? 'set-badge--ok' : 'set-badge--off'
                          }`}
                        >
                          {eventSub?.connected ? 'Listening' : 'Not listening'}
                        </span>
                        <span className="set-muted">
                          subs · resubs · gift subs · bits · channel points
                        </span>
                      </div>
                    </>
                  ) : (
                    <div className="set-row">
                      <span className="set-badge set-badge--off">Not connected</span>
                      <button
                        className="set-btn set-btn--primary"
                        onClick={connect}
                        disabled={busy}
                      >
                        {busy ? 'Starting…' : 'Connect Twitch'}
                      </button>
                    </div>
                  )}

                  {flow && (
                    <div className="set-flow">
                      <p>
                        Open <strong>{flow.verificationUri}</strong> and enter this code:
                      </p>
                      <div className="set-code">{flow.userCode}</div>
                      <p className="set-muted">
                        {authState === 'pending'
                          ? 'Waiting for you to approve on Twitch…'
                          : authState}
                      </p>
                    </div>
                  )}
                </div>

                <div className="set-integration">
                  <h3 className="set-subheading">OBS overlay</h3>

                  <div className="set-row">
                    <span
                      className={`set-badge ${
                        roulette?.overlayPresent ? 'set-badge--ok' : 'set-badge--off'
                      }`}
                    >
                      {roulette?.overlayPresent ? 'Connected' : 'Not open'}
                    </span>
                  </div>

                  <div className="set-obs">
                    <span className="set-muted">Browser Source URL</span>
                    <code>{API}/overlay</code>
                    <button className="set-btn set-obs-copy" onClick={copyOverlayUrl}>
                      {copied ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                </div>
              </section>

              {/* ---- CHANNEL POINTS ---- */}

              <section className="set-section">
                <button
                  className="set-heading set-heading--toggle"
                  onClick={() => setRewardsCollapsed((prev) => !prev)}
                >
                  <span className={`set-chevron ${rewardsCollapsed ? '' : 'is-open'}`}>▸</span>
                  Channel point rewards
                </button>

                {!rewardsCollapsed && (rewardList.length > 0 ? (
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
                                    updateRewardDraft(
                                      reward.key,
                                      'cost',
                                      event.target.value,
                                    )
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
                                    updateRewardDraft(
                                      reward.key,
                                      'cooldownSeconds',
                                      event.target.value,
                                    )
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
                              <p className="set-reward-error">
                                {rewardErrors[reward.key]}
                              </p>
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
                    {twitch.connected
                      ? 'Rewards will be created automatically once the connection has the channel-points permission — reconnect Twitch if you just updated.'
                      : 'Connect Twitch to create the reward.'}
                  </p>
                ))}

                {!rewardsCollapsed && (
                  <p className="set-muted set-obs">
                    Redemptions stay in your Twitch queue — fulfill or refund them
                    manually in the Stream Manager.
                  </p>
                )}
              </section>

              {/* ---- BITS REWARDS ---- */}

              {bitsList.length > 0 && (
                <section className="set-section">
                  <button
                    className="set-heading set-heading--toggle"
                    onClick={() => setBitsCollapsed((prev) => !prev)}
                  >
                    <span className={`set-chevron ${bitsCollapsed ? '' : 'is-open'}`}>▸</span>
                    Bits rewards
                  </button>

                  {!bitsCollapsed && (
                    <>
                      <p className="set-muted set-obs">
                        Not a Twitch reward — just how a plain{' '}
                        <code>cheer&lt;amount&gt;</code> in chat maps to a roll. One shared
                        ladder for loot and spawn tiers — highest threshold met wins.
                      </p>

                      <div className="set-rewards set-rewards--bits">
                        {bitsList.map((reward) => {
                          const draft = bitsDrafts[reward.key] ?? draftFromBitsReward(reward);
                          const dirty = isBitsDirty(reward);

                          return (
                            <div className="set-reward" key={reward.key}>
                              <div className="set-reward-info">
                                <span className="set-reward-title">
                                  {bitsRewardLabel(reward)}
                                </span>
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
              )}

              {/* ---- ROULETTE ---- */}

              <section className="set-section">
                <h2 className="set-heading">Roulette</h2>

                {roulette && roulette.presets?.length > 0 && (
                  <div className="set-presets">
                    <span className="set-muted">Loot tier</span>
                    <div className="set-preset-group">
                      {roulette.presets.map((name) => (
                        <button
                          key={name}
                          className={`set-preset ${
                            roulette.preset === name ? 'is-active' : ''
                          }`}
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
                          className={`set-preset ${
                            roulette.spawnTier === name ? 'is-active' : ''
                          }`}
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

              {/* ---- ENEMY FACTIONS ---- */}

              {factions.length > 0 && (
                <section className="set-section">
                  <h2 className="set-heading">Enemy factions</h2>

                  <p className="set-muted">
                    Turn off any faction you don't want spawned as a hostile squad —
                    applies to every tier.
                  </p>

                  <div className="set-factions">
                    {factions.map((faction) => (
                      <label className="set-faction" key={faction.key}>
                        <input
                          type="checkbox"
                          checked={faction.enabled}
                          onChange={(event) =>
                            toggleFaction(faction.key, event.target.checked)
                          }
                        />
                        {faction.icon && <img src={faction.icon} alt="" />}
                        <span>{faction.label}</span>
                      </label>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
